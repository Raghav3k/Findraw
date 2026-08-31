# Release checkpoint — 2026-09-01

The source checkpoint is prepared for GitHub. No Cloudflare release was made
during this preparation: real Turnstile setup and Twitch callback registration
still need account access.

## Verified

- GitHub remote: `Raghav3k/Findraw`, production branch `main`.
- Cloudflare Pages project: `findraw`, `https://findraw.pages.dev`.
- Pages automatically deploys pushes; the checkpoint uses `[CF-Pages-Skip]`
  to prevent releasing the frontend before the matching backend is ready.
- Existing Wrangler login can manage Workers and Pages, but the Turnstile
  widget API returns HTTP 403 for that login.
- Backend secret names present: `SESSION_SECRET`, `TWITCH_CLIENT_ID`,
  `TWITCH_CLIENT_SECRET`. No `TURNSTILE_SECRET_KEY` is configured.
- Pages currently has no production service binding. Root `wrangler.toml`
  now declares `FINDRAW_BACKEND` pointing to `findraw-backend`; the declaration
  takes effect on the next Pages deployment.
- `pnpm check:production` and `pnpm build:cloudflare` passed. The existing
  large JavaScript chunk warning remains.

## Resume deployment

1. Sign into Cloudflare and configure a real managed Turnstile widget for
   `findraw.pages.dev`. Set backend `TURNSTILE_SITE_KEY` and secret
   `TURNSTILE_SECRET_KEY` securely; never commit the secret.
2. Register `https://findraw.pages.dev/auth/twitch/callback` in the existing
   Twitch application's redirect URLs. Preserve intentional localhost entries.
3. Rebuild/check the exact release and deploy `findraw-backend` with migration
   `v6-security`, then the matching Pages frontend and service binding.
4. Verify same-origin cookies, real Turnstile, Twitch reconnect/login/logout,
   room creation/joining and absence of a public backend bypass.
5. Complete the remaining live checks in
   [SECURITY_CHECKLIST_2026-09-01.md](SECURITY_CHECKLIST_2026-09-01.md).

The existing public Pages address does not require a purchased domain.
Low traffic is not a substitute for release configuration or abuse protection.
