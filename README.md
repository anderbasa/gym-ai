# gym-ai

Web sencilla para chatear con Claude y que te genere, adapte o modifique
rutinas de gimnasio, ancladas a un dataset real de ~1,324 ejercicios (nombre,
músculo, equipamiento, imagen). Puedes:

- Pegar/describir una rutina existente y pedir que la adapte.
- Subir una foto de las máquinas/equipamiento disponible.
- Pedir una rutina rápida de un día, o una rutina semanal completa.
- Pedir cambios puntuales ("cambia esta máquina por otra") sobre la rutina
  ya propuesta.

Todo el estado (historial de chat, rutina actual, rutinas guardadas) vive
**solo en tu navegador** (`localStorage`). El servidor no usa base de datos y
no guarda nada entre peticiones.

## Setup

```bash
npm install
npm run setup:dataset   # clona el dataset de ejercicios a data/ (~125MB, requiere git + internet)
cp .env.example .env    # si aún no tienes .env, y añade tu ANTHROPIC_API_KEY
npm start
```

Abre http://localhost:3000

### IA gratuita (Gemini)

En vez de la API de pago de Anthropic puedes usar la capa gratuita de Google
Gemini: crea una key gratis (sin tarjeta) en https://aistudio.google.com/apikey
y ponla en `.env` como `GEMINI_API_KEY`. Si está definida, el servidor usa
Gemini (`GEMINI_MODEL`, por defecto `gemini-3.5-flash`); si no, usa Claude.

## Estructura

- `server/` — Express: sirve el frontend, las imágenes del dataset, y el
  endpoint `POST /api/chat` que llama a la API de Claude con tool use.
- `public/` — frontend vanilla (HTML/CSS/JS, sin build step).
- `data/` — dataset de ejercicios (gitignorado, se genera con
  `npm run setup:dataset`). Ver `NOTICE.md` sobre la licencia de las
  imágenes.
- `scripts/setup-dataset.js` — descarga el dataset.

## Notas

- La API key nunca llega al navegador; el frontend solo habla con tu propio
  backend en `localhost`.
- Ver `NOTICE.md` para la atribución obligatoria de las imágenes de
  ejercicios (© Gym Visual).
