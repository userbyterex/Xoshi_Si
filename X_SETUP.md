# X account setup

## New account

Create/authenticate the Xoshi account manually.

The agent uses Playwright for browser interaction.

### Local persistent profile

```bash
cd x-agent
npm install
npx playwright install chromium
npm run login
```

The login window opens in headed Chromium. Complete login and 2FA manually.

The profile is stored under:

```text
profiles/xoshi-main
```

That directory is ignored by Git.

## GitHub Actions

GitHub-hosted runners are ephemeral, so a local Chromium profile should not be
expected to persist between jobs.

For the hourly cloud workflow, provide the X session values as GitHub Secrets:

```text
TWITTER_AUTH_TOKEN
TWITTER_CT0
```

Never commit these values.

If X changes its authentication/session behavior, the login/session mechanism
may need updating. Do not bypass X security controls or automate CAPTCHA/2FA.

## Test

After configuring the secrets, run:

GitHub → Actions → Xoshi XI hourly cycle → Run workflow

Then mention `@xoshi_Si` from another account and inspect the reply.
