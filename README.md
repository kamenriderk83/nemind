# NeMind

NeMind is an AI-native graph thinking workspace. It pairs a structured React Flow canvas with an AI chat panel so a user can talk through an idea and accept graph patches into the map.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## AI providers

The app ships with two providers:

- `Mock provider`: works without keys and returns a demo graph patch.
- `DeepSeek`: set `DEEPSEEK_API_KEY` on the server before starting the app.

Optional:

```bash
DEEPSEEK_MODEL=deepseek-chat
```

## Deploy

Vercel is the quickest path for sharing NeMind with Mac users. Add these
environment variables in Vercel before deploying:

```bash
DEEPSEEK_API_KEY=your-server-side-key
DEEPSEEK_MODEL=deepseek-chat
```

On Vercel, maps and custom model choices are kept in each user's browser
storage. If you run NeMind on your own server and want server-side file storage,
set `NEMIND_DATA_DIR` to a persistent directory.

## MVP features

- Structured nodes and edges with React Flow.
- AI chat endpoint at `POST /api/ai/chat`.
- Zod validation for graph patches.
- Accept/reject patch preview before mutating the graph.
- Markdown list and Mermaid flowchart import.
- JSON import/export.
- Local-first persistence with immediate local storage and IndexedDB background sync.
