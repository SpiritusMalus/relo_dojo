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

## Phase 0 — skeleton & connectivity

Goal: prove the phone and backend can talk. Backend exposes `GET /health` and a mock
`POST /echo`; the app sends text and shows the echoed reply.

### Run the backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Health check: `curl http://localhost:8000/health` → `{"status":"ok"}`

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

Type `hello` in the app → see `hello` returned from the backend.
