const Anthropic = require('@anthropic-ai/sdk');
const { searchExercises, sanitizeRoutine } = require('./exercises');

let client;
function getClient() {
  if (!client) client = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno
  return client;
}
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const MAX_TOKENS = 8192;
const MAX_ITERATIONS = 6;
const MAX_HISTORY_MESSAGES = 20;
const MAX_RECENT_IMAGES = 2;

const SYSTEM_PROMPT = `Eres un entrenador personal experto integrado en una app de chat local.

FUENTE DE VERDAD: tienes la tool "search_exercises" que consulta una base de
datos local de ejercicios reales (nombre, músculo, equipo, imagen/gif reales).
Antes de proponer CUALQUIER ejercicio concreto, búscalo con "search_exercises"
y usa exactamente el mismo "name" e "image" que te devuelva. No inventes
ejercicios ni equipamiento que no exista en la base de datos. Si una búsqueda
no da resultados, prueba con términos más genéricos antes de rendirte.

DETECCIÓN DE INTENCIÓN (no interrogues innecesariamente):
- Si el usuario pega o describe una rutina existente, adáptala — no la
  regeneres desde cero salvo que te lo pidan.
- Si sube una foto de máquinas/gimnasio, identifica el equipamiento visible
  y busca con "search_exercises" filtrando por ese equipamiento. No preguntes
  "¿qué máquinas tienes?" si ya se ve en la foto.
- Si pide una "rutina rápida" o "de un día": full body, 5-7 ejercicios,
  30-45 minutos.
- Si pide una rutina semanal o de varios días: reparte por grupo muscular o
  push/pull/legs, usando el equipamiento disponible cuando se conozca.
- Pregunta "¿qué máquinas tienes?" solo si no hay ninguna pista (ni foto, ni
  contexto previo) y es imprescindible para continuar. Ante la duda, usa
  equipamiento genérico (barra, mancuernas, polea, peso corporal) antes de
  preguntar.

EDICIONES PUNTUALES: si el usuario pide un cambio sobre una rutina ya
propuesta ("cambia esta máquina", "quita el día de piernas", "más series"),
parte de la rutina que se te da como contexto (bloque "Contexto" del
sistema) y aplica solo ese cambio — no regeneres toda la rutina salvo que lo
pidan explícitamente.

ENTREGA DE RUTINAS: cuando definas o modifiques una rutina COMPLETA, llama
SIEMPRE a la tool "present_routine" con la estructura final. Es la única
forma válida de entregarla — nunca la escribas como texto plano ni como
bloque de código. Cada ejercicio de "present_routine" DEBE incluir "image",
"gif_url", "muscle_group" y "equipment" copiados literalmente del resultado
que te dio "search_exercises" para ese ejercicio (nunca los dejes vacíos ni
los inventes) — la interfaz muestra el GIF animado ("gif_url") como
visualización principal del ejercicio, con la imagen fija ("image") como
respaldo.

REGLA ESTRICTA: "present_routine" NUNCA puede ir vacía ni a medias. "days"
debe tener al menos un día, y cada día al menos los ejercicios que describas
en tu respuesta de texto — exactamente los mismos, con los mismos datos. Si
mencionas 4 ejercicios en el texto, "present_routine" debe traer esos mismos
4 ejercicios rellenados. Nunca envíes "days": [] ni un routine_name genérico
como "." — si no tienes todavía los datos completos de un ejercicio, vuelve
a llamar a "search_exercises" antes de llamar a "present_routine".

Después de llamar a "present_routine", escribe un mensaje breve en texto
explicando qué has hecho, sin repetir la rutina completa en texto.

Para dudas puntuales que no impliquen crear/editar una rutina, responde en
texto normal sin llamar a "present_routine".

Sé conciso y práctico. Responde en español salvo que el usuario escriba en
otro idioma.`;

const searchExercisesTool = {
  name: 'search_exercises',
  description:
    'Busca ejercicios reales en la base de datos local, filtrando por equipamiento, parte del cuerpo, músculo objetivo, categoría y/o texto libre. Úsala SIEMPRE antes de proponer un ejercicio concreto.',
  input_schema: {
    type: 'object',
    properties: {
      equipment: {
        type: 'string',
        description: "ej. 'barbell', 'dumbbell', 'cable', 'leg press machine', 'body weight'",
      },
      body_part: { type: 'string' },
      muscle_group: { type: 'string' },
      target: { type: 'string' },
      category: { type: 'string' },
      query: { type: 'string', description: 'texto libre para buscar en el nombre del ejercicio' },
      limit: { type: 'integer', description: 'máx resultados (por defecto 8, máx 20)' },
    },
    additionalProperties: false,
  },
};

const presentRoutineTool = {
  name: 'present_routine',
  description:
    'Entrega la rutina final estructurada para mostrarla en tarjetas visuales. Cada ejercicio debe estar anclado a un resultado real de search_exercises (mismo "name" e "image").',
  input_schema: {
    type: 'object',
    properties: {
      routine_name: { type: 'string' },
      notes: { type: 'string' },
      days: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            day_label: { type: 'string' },
            exercises: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  muscle_group: { type: 'string' },
                  equipment: { type: 'string' },
                  image: { type: 'string' },
                  gif_url: { type: 'string' },
                  sets: { type: 'integer' },
                  reps: { type: 'string' },
                  rest_seconds: { type: 'integer' },
                },
                required: ['name', 'image', 'sets', 'reps'],
                additionalProperties: false,
              },
            },
          },
          required: ['day_label', 'exercises'],
          additionalProperties: false,
        },
      },
    },
    required: ['routine_name', 'days'],
    additionalProperties: false,
  },
};

// Detecta strings "de verdad" (nombres de rutina/ejercicio) vs. basura que a
// veces se cuela cuando el modelo mete JSON/XML mal formado dentro de un
// campo de texto en vez de rellenar la estructura correcta.
function looksLikeGarbageText(value) {
  if (typeof value !== 'string') return true;
  if (value.length > 120) return true;
  return /[<>{}]|"day_label"|"exercises"|parameter name=/.test(value);
}

function isRoutineComplete(routine) {
  if (!routine || !Array.isArray(routine.days) || routine.days.length === 0) return false;
  if (looksLikeGarbageText(routine.routine_name)) return false;

  return routine.days.every((day) => {
    if (!Array.isArray(day.exercises) || day.exercises.length === 0) return false;
    return day.exercises.every(
      (exercise) =>
        exercise &&
        !looksLikeGarbageText(exercise.name) &&
        typeof exercise.image === 'string' &&
        exercise.image.length > 0 &&
        exercise.image.length < 200
    );
  });
}

function buildSystemBlocks(currentRoutine) {
  const blocks = [{ type: 'text', text: SYSTEM_PROMPT }];
  if (currentRoutine) {
    blocks.push({
      type: 'text',
      text: `Contexto: última rutina estructurada acordada con el usuario (JSON). Si piden un cambio puntual, parte de aquí:\n\n${JSON.stringify(
        currentRoutine
      )}`,
    });
  }
  return blocks;
}

// Estrategia simple para no dejar crecer el contexto sin límite: nos
// quedamos con los últimos N mensajes y sustituimos imágenes antiguas por un
// placeholder de texto (las imágenes consumen muchos tokens).
function trimHistory(messages) {
  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({ ...message }));
  let imagesSeen = 0;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const content = trimmed[i].content;
    if (!Array.isArray(content)) continue;
    trimmed[i].content = content.map((block) => {
      if (block.type !== 'image') return block;
      imagesSeen++;
      return imagesSeen > MAX_RECENT_IMAGES
        ? { type: 'text', text: '[imagen anterior omitida para ahorrar contexto]' }
        : block;
    });
  }
  return trimmed;
}

async function runConversation(rawMessages, currentRoutine) {
  const messages = trimHistory(rawMessages);
  let structuredRoutine = null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystemBlocks(currentRoutine),
      tools: [searchExercisesTool, presentRoutineTool],
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n\n');
      return { text, routine: structuredRoutine };
    }

    const toolUses = response.content.filter((block) => block.type === 'tool_use');
    const toolResults = [];

    for (const block of toolUses) {
      if (block.name === 'search_exercises') {
        const results = searchExercises(block.input);
        console.log('[tool] search_exercises', block.input, '->', results.length, 'resultados');
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(results),
        });
      } else if (block.name === 'present_routine') {
        if (isRoutineComplete(block.input)) {
          structuredRoutine = sanitizeRoutine(block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Rutina recibida, se mostrará al usuario en la interfaz.',
          });
        } else {
          console.warn('[tool] present_routine rechazada por incompleta:', JSON.stringify(block.input));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content:
              'Rechazada: "days" está vacío, algún día no tiene ejercicios, o algún campo de texto (routine_name o name) contiene datos corruptos/mal formados en vez de texto normal. Vuelve a llamar a "present_routine" desde cero con todos los días y ejercicios completos, con campos de texto simples (sin JSON ni etiquetas dentro), usando los resultados reales de "search_exercises".',
            is_error: true,
          });
        }
      } else {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Tool desconocida: ${block.name}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return {
    text: 'No he podido completar la respuesta tras varios intentos. ¿Puedes reformular tu petición?',
    routine: structuredRoutine,
  };
}

module.exports = {
  runConversation,
  SYSTEM_PROMPT,
  searchExercisesTool,
  presentRoutineTool,
  isRoutineComplete,
  trimHistory,
  MAX_ITERATIONS,
};
