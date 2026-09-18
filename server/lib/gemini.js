const { searchExercises, sanitizeRoutine } = require('./exercises');
const {
  SYSTEM_PROMPT,
  searchExercisesTool,
  presentRoutineTool,
  isRoutineComplete,
  trimHistory,
  MAX_ITERATIONS,
} = require('./anthropic');

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Gemini acepta un subconjunto de JSON Schema: no admite additionalProperties.
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties') continue;
    out[key] = toGeminiSchema(value);
  }
  return out;
}

const functionDeclarations = [searchExercisesTool, presentRoutineTool].map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: toGeminiSchema(tool.input_schema),
}));

function toGeminiParts(content) {
  if (typeof content === 'string') return content ? [{ text: content }] : [];
  return content
    .map((block) => {
      if (block.type === 'text') return { text: block.text };
      if (block.type === 'image') {
        return { inlineData: { mimeType: block.source.media_type, data: block.source.data } };
      }
      return null;
    })
    .filter(Boolean);
}

function toGeminiContents(messages) {
  return messages
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: toGeminiParts(message.content),
    }))
    .filter((message) => message.parts.length > 0);
}

function buildSystemText(currentRoutine) {
  if (!currentRoutine) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}\n\nContexto: última rutina estructurada acordada con el usuario (JSON). Si piden un cambio puntual, parte de aquí:\n\n${JSON.stringify(
    currentRoutine
  )}`;
}

async function callGemini(body) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Falta GEMINI_API_KEY en el archivo .env');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data.error && data.error.message) || `HTTP ${res.status}`;
    throw new Error(`Gemini: ${detail}`);
  }
  return data;
}

async function runConversation(rawMessages, currentRoutine) {
  const contents = toGeminiContents(trimHistory(rawMessages));
  let structuredRoutine = null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const data = await callGemini({
      systemInstruction: { parts: [{ text: buildSystemText(currentRoutine) }] },
      contents,
      tools: [{ functionDeclarations }],
      generationConfig: { maxOutputTokens: 8192 },
    });

    const candidate = data.candidates && data.candidates[0];
    const modelContent = candidate && candidate.content;
    if (!modelContent || !Array.isArray(modelContent.parts) || modelContent.parts.length === 0) {
      const reason = (candidate && candidate.finishReason) || (data.promptFeedback && data.promptFeedback.blockReason);
      throw new Error(`Gemini no devolvió respuesta${reason ? ` (${reason})` : ''}`);
    }

    // Se reenvía tal cual (incluye thoughtSignature, que Gemini exige en tool use).
    contents.push(modelContent);

    const calls = modelContent.parts.filter((part) => part.functionCall).map((part) => part.functionCall);

    if (calls.length === 0) {
      const text = modelContent.parts
        .filter((part) => part.text && !part.thought)
        .map((part) => part.text)
        .join('\n\n');
      return { text, routine: structuredRoutine };
    }

    const responseParts = [];
    for (const call of calls) {
      const args = call.args || {};
      let response;

      if (call.name === 'search_exercises') {
        const results = searchExercises(args);
        console.log('[tool] search_exercises', args, '->', results.length, 'resultados');
        response = { results };
      } else if (call.name === 'present_routine') {
        if (isRoutineComplete(args)) {
          structuredRoutine = sanitizeRoutine(args);
          response = { result: 'Rutina recibida, se mostrará al usuario en la interfaz.' };
        } else {
          console.warn('[tool] present_routine rechazada por incompleta:', JSON.stringify(args));
          response = {
            error:
              'Rechazada: "days" está vacío, algún día no tiene ejercicios, o algún campo de texto (routine_name o name) contiene datos corruptos/mal formados. Vuelve a llamar a "present_routine" desde cero con todos los días y ejercicios completos, con campos de texto simples, usando los resultados reales de "search_exercises".',
          };
        }
      } else {
        response = { error: `Tool desconocida: ${call.name}` };
      }

      responseParts.push({ functionResponse: { name: call.name, response } });
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  return {
    text: 'No he podido completar la respuesta tras varios intentos. ¿Puedes reformular tu petición?',
    routine: structuredRoutine,
  };
}

module.exports = { runConversation };
