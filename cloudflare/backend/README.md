# Findraw Cloudflare backend

This Worker is the Cloudflare replacement for `server/index.mjs`.

It exposes the same routes:

- `GET /health`
- `GET /auth/twitch/start`
- `GET /auth/twitch/callback`
- `GET /api/twitch/session`
- `POST /api/twitch/disconnect`
- `GET /api/events`
- `GET /api/leaderboard`
- `POST /api/round/start`
- `POST /api/round/end`
- `POST /api/points/adjust`

## Cloudflare secrets

Set these secrets on the Worker:

```powershell
wrangler secret put TWITCH_CLIENT_ID
wrangler secret put TWITCH_CLIENT_SECRET
wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` should be a long random value. Twitch tokens are encrypted before being stored in Durable Object storage.

## URLs

Update `cloudflare/backend/wrangler.toml`:

- `FRONTEND_URL`: your Cloudflare Pages URL for Findraw
- `TWITCH_REDIRECT_URI`: this Worker's `/auth/twitch/callback` URL

Then set the same callback URL inside the Twitch Developer Console.

On the Pages project, set:

- `VITE_API_BASE_URL`: the deployed Worker origin, for example `https://findraw-backend.YOUR_SUBDOMAIN.workers.dev`

## Deploy

From `cloudflare/backend`:

```powershell
wrangler deploy
```

Durable Objects are available on Cloudflare's Free plan with the SQLite storage backend, but live Twitch EventSub WebSocket/SSE usage can consume the free daily Worker/Durable Object limits during long streams.
