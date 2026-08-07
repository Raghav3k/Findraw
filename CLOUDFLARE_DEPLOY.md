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

The app supports an optional external asset origin:

- `VITE_ASSET_BASE_URL=https://your-asset-host.example.com`

If this value is empty, asset URLs stay relative, which is best for local development. For production without committing `public/`, upload the `public/auto-draw` and `public/category-art` contents to Cloudflare R2, a CDN bucket, or another static asset host, then set `VITE_ASSET_BASE_URL` to that origin.

## Twitch backend

The current Twitch integration uses `server/index.mjs`, Express, local file storage, Server-Sent Events, and an outbound Twitch EventSub WebSocket. That server is not part of the static Pages deployment. The live deployed frontend will still load, but Twitch chat features need a later Cloudflare Worker/Durable Object migration or another hosted Node backend.
