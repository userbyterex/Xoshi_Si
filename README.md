# Xoshi XI — Autonomous Finance & AI Agent

Xoshi XI (`@xoshi_Si`) is an autonomous X agent focused on:

- `$XOSHI`
- Robinhood Chain
- Stock Tokens / tokenized equities
- RWAs and tokenization
- crypto and DeFi
- AI agents / agentic finance
- market structure and public equities

The project is adapted from the useful Sibili agent architecture while being
cleaned for a fresh public repository.

## Core behavior

### Direct conversation
If someone mentions `@xoshi_Si`, Xoshi treats it as a direct conversational
request and attempts to answer it. Direct mentions have priority over the
normal radar.

### Language policy
Xoshi is multilingual and detects the language of the user message.

- English is the primary/default language.
- If the user writes in Spanish, answer in Spanish.
- French -> French.
- German -> German.
- Portuguese -> Portuguese.
- Italian -> Italian.
- Other languages -> answer in that language when confidently detected.
- Mixed-language messages -> normally answer in the dominant language.
- If uncertain -> English.

The language choice applies to direct replies and generated posts. Xoshi should
sound natural rather than translating mechanically.

### Financial safety
Xoshi is an informational/research agent. It must not fabricate:

- prices
- volume
- contracts
- partnerships
- listings
- holdings
- official affiliations
- breaking news

Current market data should come from a configured data source, not from the LLM
memory. Xoshi does not execute trades or place orders.

## Architecture

```text
                         X / Playwright
                               |
                    +----------+----------+
                    |                     |
             @xoshi_Si mention        Hourly radar
                    |                     |
                    +----------+----------+
                               |
                         Xoshi Router
                               |
                    +----------+----------+
                    |                     |
                 Groq                  Gemini
             conversation /          radar / classify /
              deep reasoning          fallback
                    |                     |
                    +----------+----------+
                               |
                        FastAPI Backend
                               |
                  Market / News / Onchain data
                         (optional APIs)
                               |
                           Memory
```

## Deployment

- **GitHub Actions**: runs the X/Playwright cycle every hour.
- **Google Cloud Run**: hosts the stateless FastAPI intelligence backend.
- **Groq + Gemini**: free-tier AI providers, subject to their current quotas.
- **Gist**: optional lightweight persistent memory.
- Browser credentials/profiles are never committed to the repository.

## Fresh setup

1. Create a new GitHub repository.
2. Upload the complete contents of this project.
3. Create a Google Cloud project and deploy the backend to Cloud Run.
4. Create Groq and Gemini API keys.
5. Create a new X account for Xoshi and authenticate it.
6. Configure GitHub Secrets.
7. Run the workflow manually.
8. Test by mentioning `@xoshi_Si`.

See:
- `RENDER_SETUP.md`
- `X_SETUP.md`
- `SECRETS.md`

## Local X login

For a local persistent browser profile:

```bash
cd x-agent
npm install
npx playwright install chromium
npm run login
```

This opens Chromium. Log into the new X account manually. The profile is stored
outside Git tracking under `profiles/xoshi-main` and is ignored by `.gitignore`.

For GitHub Actions, use X session secrets instead of committing a browser profile.
