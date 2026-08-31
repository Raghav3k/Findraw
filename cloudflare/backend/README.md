# Findraw Cloudflare backend

**Security migration:** before deploying, follow [the security release checklist](../../docs/SECURITY_CHECKLIST_2026-09-01.md). Production now uses HttpOnly cookie sessions through a Pages service binding, not direct browser requests to workers.dev. The Twitch callback must use the frontend origin. Turnstile keys and the Pages binding require configuration; missing protection fails closed. Older direct-worker setup examples below are historical and do not override that checklist.

This Worker is the Cloudflare replacement for `server/index.mjs`.

It exposes the same routes:

- `GET /health`
- `GET /auth/twitch/start`
- `GET /auth/twitch/callback`
- `GET /api/twitch/session`
- `POST /api/twitch/disconnect`
- `GET /api/events`
- `GET /api/leaderboard`
- `GET /api/channel/status`
- `GET /api/channel/legacy-backups` (authenticated, own channel only)
- `POST /api/round/start`
- `POST /api/round/end`
- `POST /api/points/adjust`
- `POST /api/community-packs`
- `GET /api/community-packs/:shareCode`
- `PUT /api/community-packs/:id`
- `POST /api/community-packs/:id/report`

## Cloudflare secrets

Channel records are stored in `FindrawChannel` (`FINDRAW_CHANNEL`, migration v5),
separately from browser-specific encrypted OAuth sessions. See
[channel persistence](../../docs/CHANNEL_PERSISTENCE.md) before deploying this change.

Set these secrets on the Worker:

```powershell
wrangler secret put TWITCH_CLIENT_ID
wrangler secret put TWITCH_CLIENT_SECRET
wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` should be a long random value. Twitch tokens are encrypted before being stored in Durable Object storage.

Community packs launch as unlisted share-code packs. Creation returns a one-time edit token that the frontend must keep on the creator's device. Tags use an open vocabulary, with up to eight normalized tags attached to one pack. Set the optional `COMMUNITY_BLOCKED_TERMS` secret to a comma-separated list of additional high-confidence terms rejected during submission.

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
