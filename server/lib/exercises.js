const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');

let exercises = [];
let knownMediaPaths = new Set();

function norm(value) {
  return (value == null ? '' : String(value)).toLowerCase().trim();
}

function loadDataset() {
  const file = path.join(DATA_DIR, 'exercises.json');
  if (!fs.existsSync(file)) {
    console.warn(
      `[exercises] No se encontró ${file}. Ejecuta "npm run setup:dataset" antes de arrancar el servidor.`
    );
    exercises = [];
    knownMediaPaths = new Set();
    return;
  }

  exercises = JSON.parse(fs.readFileSync(file, 'utf-8'));
  knownMediaPaths = new Set();
  // exercise.image ya viene como "images/xxxx.jpg" y exercise.gif_url como
  // "videos/xxxx.gif" (con el prefijo de carpeta incluido), según el schema
  // real del dataset — no hay que volver a anteponer "images/"/"videos/".
  for (const exercise of exercises) {
    if (exercise.image) knownMediaPaths.add(`/exercise-media/${exercise.image}`);
    if (exercise.gif_url) knownMediaPaths.add(`/exercise-media/${exercise.gif_url}`);
  }
  console.log(`[exercises] ${exercises.length} ejercicios cargados en memoria.`);
}

function toPublicShape(exercise) {
  return {
    name: exercise.name,
    category: exercise.category,
    body_part: exercise.body_part,
    equipment: exercise.equipment,
    target: exercise.target,
    muscle_group: exercise.muscle_group,
    secondary_muscles: exercise.secondary_muscles || [],
    instructions:
      (exercise.instructions && (exercise.instructions.en || exercise.instructions)) ||
      exercise.instruction_steps ||
      null,
    image: exercise.image ? `/exercise-media/${exercise.image}` : null,
    gif_url: exercise.gif_url ? `/exercise-media/${exercise.gif_url}` : null,
  };
}

function searchExercises(params = {}) {
  const { equipment, body_part, muscle_group, target, category, query, limit } = params;
  let results = exercises;

  const substringFilters = [
    ['equipment', equipment],
    ['body_part', body_part],
    ['target', target],
    ['category', category],
  ];
  for (const [field, value] of substringFilters) {
    if (value) {
      const needle = norm(value);
      results = results.filter((exercise) => norm(exercise[field]).includes(needle));
    }
  }

  if (muscle_group) {
    const needle = norm(muscle_group);
    results = results.filter(
      (exercise) =>
        norm(exercise.muscle_group).includes(needle) ||
        (exercise.secondary_muscles || []).some((muscle) => norm(muscle).includes(needle))
    );
  }

  if (query) {
    const needle = norm(query);
    results = results.filter((exercise) => norm(exercise.name).includes(needle));
  }

  const capped = Math.min(limit || 8, 20);
  return results.slice(0, capped).map(toPublicShape);
}

// Defensa contra alucinaciones: si el modelo devuelve una imagen/gif que no
// corresponde a ningún ejercicio real del dataset, se limpia antes de
// mandarla al frontend.
function sanitizeRoutine(routine) {
  if (!routine) return routine;
  for (const day of routine.days || []) {
    for (const exercise of day.exercises || []) {
      if (exercise.image && !knownMediaPaths.has(exercise.image)) exercise.image = null;
      if (exercise.gif_url && !knownMediaPaths.has(exercise.gif_url)) exercise.gif_url = null;
    }
  }
  return routine;
}

module.exports = { loadDataset, searchExercises, sanitizeRoutine };
