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

Cloudflare Pages injects `CF_PAGES=1`; the Vite config also respects `FINDRAW_SKIP_PUBLIC=1`. The Cloudflare build skips copying the local `public/` asset folder so the Git repo and upload stay small.

## Assets

The app requires an external asset origin for Cloudflare Pages because the build skips the large local `public/` folder:

- `VITE_ASSET_BASE_URL=https://pub-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.r2.dev`

Use the R2 bucket **Public Development URL** or a custom public domain. Do not use the S3 API URL ending in `r2.cloudflarestorage.com/findraw-assets`; browsers cannot load public images from that private API endpoint.

If this value is empty locally, asset URLs stay relative, which is best for local development. For production without committing `public/`, upload the `public/auto-draw` and `public/category-art` contents to Cloudflare R2, a CDN bucket, or another static asset host, then set `VITE_ASSET_BASE_URL` to that public origin.

## Twitch backend

The current Twitch integration uses `server/index.mjs`, Express, local file storage, Server-Sent Events, and an outbound Twitch EventSub WebSocket. That server is not part of the static Pages deployment. The live deployed frontend will still load, but Twitch chat features need a later Cloudflare Worker/Durable Object migration or another hosted Node backend.

## Backend Worker

The Twitch/live-chat backend has a Worker + Durable Object migration in `cloudflare/backend`. Deploy that Worker first, then set this Pages variable:

- `VITE_API_BASE_URL=https://findraw-backend.YOUR_SUBDOMAIN.workers.dev`

The backend Worker requires these secrets:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `SESSION_SECRET`

Also update `FRONTEND_URL` and `TWITCH_REDIRECT_URI` in `cloudflare/backend/wrangler.toml` before deploying. The Twitch Developer Console callback URL must match `TWITCH_REDIRECT_URI`.
