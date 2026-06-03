# Grammar Dojo

A mobile app for learning English with short daily grammar exercises, using examples from a
developer's world (code, docs, error messages). Answers are checked and explained by a self-hosted
LLM (Ollama). Mobile app: Expo (React Native). Backend: Python + FastAPI.

> Full project handoff lives in the Obsidian vault (not in this repo).

## Structure

```
backend/   FastAPI service (Python)
mobile/    Expo app (React Native + TypeScript)
```

## Status

- **Phase 0 — done:** skeleton + phone↔backend connectivity (mock `/echo`, now removed).
- **Phase 1 — current:** real chat backed by a self-hosted LLM (Ollama). Backend exposes
  `GET /health` and `POST /chat`; the app is a simple chat screen.

### Ollama (one-time)

```bash
brew install ollama           # or download from ollama.ai
ollama serve                  # start the server (keep running)
ollama pull llama3.2          # download a model (set the same name in backend/.env)
```

Model name is read from `OLLAMA_MODEL` in `backend/.env` (default `llama3.2`). See `.env.example`.

### Run the backend

```bash
cd backend
python3 -m venv .venv          # first time only
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Health check: `curl http://localhost:8000/health` → `{"status":"ok"}`
Chat check: `curl -X POST localhost:8000/chat -H 'Content-Type: application/json' -d '{"message":"hi"}'`

### Run the mobile app

```bash
cd mobile
npm install
npx expo start
```

Open **Expo Go** on a phone connected to the **same Wi-Fi** and scan the QR code.

> The app talks to the backend over the MacBook's **local IP** (e.g. `http://10.239.241.128:8000`),
> not `localhost` — set it in `mobile/services/api.ts`.

### Done when

With Ollama running and a model pulled: type a question in the app → get a sensible answer from
the model. (If Ollama is down, the app shows a clear error instead of crashing.)
