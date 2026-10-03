# Xoshi XI — Xuper Intelligence

Xoshi is an autonomous social-intelligence agent built from the useful Sibili architecture:
- FastAPI intelligence backend
- TypeScript + Playwright X agent
- Qwen-compatible LLM
- persistent memory via GitHub Gist
- GitHub Actions scheduled cycles
- optional Redis
- optional on-chain context

## Important security
Never commit:
- `.env`
- X cookies/tokens
- GitHub PATs
- browser profiles
- API keys

Before using this repository, revoke any credential that was previously exposed in a public repository.

## Architecture

X data -> Watch/Radar -> Xoshi Brain -> IGNORE / REPLY / POST
                         -> Social Graph
                         -> Memory
                         -> Self-learning

## Setup

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

### Agent

```bash
cd x-agent
npm install
npx playwright install --with-deps
npm start
```

Copy `.env.example` to `.env` and fill secrets locally.

## GitHub Actions

Set repository secrets:
- TWITTER_AUTH_TOKEN
- TWITTER_CT0
- QWEN_API_KEY
- GIST_ID
- GIST_TOKEN
- MOLTBOOK_API_KEY (optional)
- REDIS_URL (optional)

The workflow runs every 15 minutes and performs a bounded intelligence cycle.

## Philosophy

Xoshi should prefer relevance over volume:
- ignore low-value posts
- avoid repetitive replies
- prioritize meaningful conversations
- learn from engagement
- never expose secrets


## Xoshi XI — Finance / Markets Adaptation

This version keeps the useful Sibili-style agent loop — browser session, mentions,
proactive radar, backend intelligence, memory and scheduled execution — but adapts
the editorial domain to $XOSHI and financial/onchain topics.

### Core coverage
- $XOSHI ecosystem and community
- Robinhood Chain
- Stock Tokens
- tokenized real-world assets (RWAs)
- crypto markets
- public equities and market structure
- AI agents / agentic finance
- DeFi and onchain data
- stablecoins and tokenization

### Editorial behavior
Xoshi should separate:
1. verified facts,
2. source-attributed claims,
3. market observations,
4. uncertainty.

It should not fabricate prices, contracts, partnerships, listings, ownership,
or official relationships. Financial content is informational/research-oriented;
the agent does not execute trades.

### New-account sessions
Browser profiles remain local/secret and are never committed to GitHub. Each X
account can have its own Playwright persistent profile.

### Market-data adapters
`x-agent/finance/market_radar.ts` is intentionally provider-agnostic. Connect a
licensed/current data provider through environment variables rather than embedding
API credentials in source code.


## Direct mentions — @xoshi_Si

Direct mentions of `@xoshi_Si` have priority over the normal engagement filter.
When a user explicitly tags or names Xoshi, the agent attempts to answer the
question through the intelligence backend. If the backend is temporarily
unavailable, it uses a safe fallback asking what the user wants to know.

This is deliberately different from the proactive radar: **a direct mention is
a conversational request and should not be silently ignored.**


## Dual free AI router

Xoshi uses two providers:
- **Groq / `openai/gpt-oss-120b`**: direct mentions and higher-value reasoning.
- **Gemini / `gemini-3.7-flash`**: hourly radar/classification and fallback.

The router automatically falls back to the other provider if one is unavailable.
No billing key is required for the intended free-tier setup; provider quotas still
apply.

## Hourly operation

GitHub Actions runs Xoshi once every hour (`:07`). Direct mentions are handled
during each cycle and have priority. If near-real-time replies are required
between hourly cycles, use a separate always-on worker/webhook architecture.


## Deployment

Render is not used. The FastAPI intelligence backend is packaged for
**Google Cloud Run**. The X/Playwright agent remains on GitHub Actions and
runs hourly. See `CLOUD_RUN_SETUP.md`.
