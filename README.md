# Xoshi XI

Autonomous X agent built around the working Playwright architecture of Sibili/Oracleofsibili.

## What this version fixes

- Persistent GitHub Gist memory.
- Exact tweet-ID deduplication across workflow runs.
- Duplicate-text guard.
- Recent author conversation context is passed to the AI.
- Replies are recorded only after the reply action succeeds.
- Radar tweets are remembered so they are not reprocessed.
- Direct X composer URL for posts.
- Playwright overlay/click fallbacks.
- Stronger market-native editorial voice.
- No browser profile is stored in the repository.
- No `.env` file or `.env.example` is included.
- All credentials are supplied through GitHub Actions secrets.

## Required GitHub Actions secrets

`FASTAPI_URL`
`TWITTER_AUTH_TOKEN`
`TWITTER_CT0`
`GROQ_API_KEY`
`GEMINI_API_KEY`
`GIST_ID`
`GIST_TOKEN`

## Persistent memory

The agent stores `xoshi_memory.json` inside the configured GitHub Gist.

The memory contains:
- processed tweet IDs
- radar-seen tweet IDs
- author interactions
- previous replies
- last daily post
- last cycle

This means a new GitHub Actions runner can still know that it already replied to a tweet.

## Important

Do not commit real credentials, browser profiles, cookies, GitHub PATs or API keys.

The Playwright layer depends on the current X web UI. X can change selectors or challenge automated sessions; this project uses fallbacks but does not guarantee uninterrupted automation.

## Run locally

```bash
cd x-agent
npm install
npx playwright install chromium
npm run typecheck
npm run cycle
```

For GitHub Actions, use repository secrets instead of a local `.env`.

## Safe simulation

Set `DRY_RUN=true` to execute discovery, reply generation and composer filling
without publishing to X or writing Gist memory. A manual Actions dispatch
exposes the same option as the `dry_run` input. Use it after selector changes
or before enabling a new account session:

```bash
cd x-agent
DRY_RUN=true FASTAPI_URL=https://YOUR-SERVICE.onrender.com npm run cycle
```

The repository also includes deterministic local checks that do not contact X:

```bash
npm run typecheck
npm test
cd ../backend && python -m unittest discover -s tests -p 'test_*.py'
```

## Verified crypto project watchlist

Project posts are selected from DeFiLlama metrics and must pass provider-specific
token-security and rug-pull checks (GoPlus for EVM; GoPlus plus RugCheck for
Solana). The agent publishes at most three verified project posts in any rolling
24-hour window, never repeats a project within seven days, and adds one to three
category/chain hashtags. Source links and a non-endorsement disclaimer are
required by the backend and checked again by Playwright; missing or unknown scan
data or unavailable persistent memory means no post. Automated checks cannot
guarantee that a project will never rug. See [the full screening and source
policy](PROJECT_WATCH_POLICY.md).
