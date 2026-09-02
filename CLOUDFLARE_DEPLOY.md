# Cloudflare Pages deployment

Findraw is prepared for a free Cloudflare Pages frontend deployment.

## Pages build settings

Use these settings when creating the Cloudflare Pages project:

- Framework preset: None or Vite
- Build command: `pnpm build:cloudflare`
- Build output directory: `dist`
- Root directory: repository root
- Node version: `22.16.0` from `.node-version`
- PNPM version: set `PNPM_VERSION=10.34.1` in Cloudflare if the build image does not honor `packageManager`

The production build copies the small assets that remain under `public/` into `dist/`.

## Assets

Findraw no longer needs an external R2 asset origin. Do not add an asset-base environment variable to Pages. The old image bucket can be disabled and deleted after a deployment of this build has been verified.

## Backend Worker

The Twitch/live-chat backend has a Worker + Durable Object migration in `cloudflare/backend`. Deploy that Worker first, then set this Pages variable:

- `VITE_API_BASE_URL=https://findraw-backend.YOUR_SUBDOMAIN.workers.dev`

The backend Worker requires these secrets:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `SESSION_SECRET`

Also update `FRONTEND_URL` and `TWITCH_REDIRECT_URI` in `cloudflare/backend/wrangler.toml` before deploying. The Twitch Developer Console callback URL must match `TWITCH_REDIRECT_URI`.
