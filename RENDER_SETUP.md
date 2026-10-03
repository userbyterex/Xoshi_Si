# Render setup — Xoshi XI

## Backend
Create a **Web Service** from this repository. The included `render.yaml` can be used with Render Blueprint, or configure manually:

- Runtime: Python 3
- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Plan: Free
- Region: Frankfurt

Environment variables:

- `GROQ_API_KEY` — secret
- `GEMINI_API_KEY` — secret
- `GROQ_MODEL` = `openai/gpt-oss-120b`
- `GEMINI_MODEL` = `gemini-3.7-flash`

After deploy, test `https://YOUR-SERVICE.onrender.com/health`.

## GitHub Actions
Set repository secrets:

- `FASTAPI_URL` — the Render base URL, without `/health`
- `TWITTER_AUTH_TOKEN`
- `TWITTER_CT0`
- `GROQ_API_KEY`
- `GEMINI_API_KEY`
- optional `GIST_ID`
- optional `GIST_TOKEN`

The hourly workflow intentionally does **not** use npm dependency caching, because the project does not require a committed `package-lock.json`.
