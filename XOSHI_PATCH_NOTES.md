# Xoshi XI — Sibili interaction patch

Keeps the Sibili-style Playwright architecture.

Changes:
- Direct replies open the tweet URL before interacting.
- Tweet IDs are extracted from `/status/<id>` links directly.
- Reply composer uses multiple selectors.
- Reply/send interactions retain overlay handling and click fallbacks.
- No credentials, cookies, browser profiles, or secrets are included.

Changed file:
- x-agent/run_cycle.ts
