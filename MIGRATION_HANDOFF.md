# Findraw Cloudflare Migration Handoff

This document is the handoff guide for continuing the Findraw migration outside Codex.

## Current Project Locations

- Local original project: `D:\dev\projects\Findraw`
- Backup copy made before migration: `D:\dev\projects\Findraw_V1`
- GitHub repo: `https://github.com/Raghav3k/Findraw`
- Cloudflare backend project name used: `findraw-backend`

## What We Already Did

### 1. Cleaned Git History

The original `Findraw` repository was rewritten into a clean small Git history.

Current Git history:

```text
fd793d0 Add Cloudflare Worker backend migration
7399c2e Prepare Cloudflare Pages deployment
f8a1ae5 Initial cleaned Findraw snapshot
```

The heavy/runtime folders are intentionally not tracked:

```text
public/
node_modules/
dist/
.env
.findraw-data/
.tmp/
_edit_work/
*.log
```

Important: `public/` still exists locally for development, but it is ignored by Git and was not pushed to GitHub.

### 2. Pushed Clean Repo to GitHub

The cleaned project was pushed to:

```text
https://github.com/Raghav3k/Findraw
```

Local `main` tracks `origin/main`.

### 3. Prepared Frontend for Cloudflare Pages

Added:

- `pnpm build:cloudflare`
- `wrangler.toml` at repo root
- `.node-version`
- `scripts/run-cloudflare-build.mjs`
- `scripts/write-cloudflare-pages-files.mjs`
- `CLOUDFLARE_DEPLOY.md`
- `src/assetUrls.ts`

The frontend build skips copying `public/`, so the deployed frontend bundle is small.

Verified locally:

```powershell
pnpm build:cloudflare
```

This passed.

### 4. Prepared Backend for Cloudflare Workers

Added backend Worker project:

```text
cloudflare/backend/
```

Important files:

```text
cloudflare/backend/wrangler.toml
cloudflare/backend/src/index.js
cloudflare/backend/README.md
```

The Worker replaces the old local Express backend for:

- Twitch OAuth start/callback
- Twitch encrypted session storage
- Twitch EventSub WebSocket connection
- Server-Sent Events endpoint `/api/events`
- leaderboard/points storage
- round start/end
- correct guess events

It uses a Cloudflare Durable Object named:

```text
FINDRAW_SESSION
```

Verified locally with:

```powershell
wrangler deploy --dry-run --config cloudflare/backend/wrangler.toml
```

This passed locally.

## Current Cloudflare Status

You created a Cloudflare Worker project named:

```text
findraw-backend
```

The first deployment failed.

Most likely reason: Cloudflare is using the old API token:

```text
pathfinderv2 build token
```

That token belongs to the old project and Cloudflare showed missing permissions.

## Backend Worker Settings

In Cloudflare, for `findraw-backend`, use these settings:

```text
Project name: findraw-backend
Build command: leave empty
Deploy command: npx wrangler deploy --config cloudflare/backend/wrangler.toml
Root directory: /
```

If Cloudflare requires a build command, use:

```text
npm install
```

But ideally leave build command empty because Cloudflare already installs dependencies.

## Fix Needed: API Token

Do not use:

```text
pathfinderv2 build token
```

Create a new token for Findraw, preferably named:

```text
findraw build token
```

In Cloudflare, go to:

```text
findraw-backend -> Settings -> Build -> API token
```

Create or select a token that has Worker deploy permissions. The auto-created Workers Builds token is usually best.

After changing token, click:

```text
Retry build
```

If it fails again, scroll to the bottom of the build log and copy the final red error line.

## Backend Variables and Secrets

There are two categories: normal runtime variables and encrypted secrets.

### Normal Variables

In `cloudflare/backend/wrangler.toml`, these currently exist as placeholders:

```toml
[vars]
FRONTEND_URL = "https://findraw.pages.dev"
TWITCH_REDIRECT_URI = "https://findraw-backend.YOUR_SUBDOMAIN.workers.dev/auth/twitch/callback"
```

After deployment, replace these with the real URLs.

Example:

```toml
FRONTEND_URL = "https://findraw.pages.dev"
TWITCH_REDIRECT_URI = "https://findraw-backend.bonamsairaghaven.workers.dev/auth/twitch/callback"
```

Then commit and push the change:

```powershell
git add cloudflare/backend/wrangler.toml
git commit -m "Configure Cloudflare backend URLs"
git push
```

### Encrypted Secrets

In Cloudflare dashboard, go to:

```text
findraw-backend -> Settings -> Variables and Secrets
```

Add encrypted secrets:

```text
TWITCH_CLIENT_ID
TWITCH_CLIENT_SECRET
SESSION_SECRET
```

`SESSION_SECRET` should be a long random string.

Example local command to generate one:

```powershell
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
```

Do not commit real secrets to GitHub.

## Twitch Developer Console Setup

After backend Worker URL is final, open Twitch Developer Console and set OAuth redirect URL to exactly:

```text
https://findraw-backend.YOUR_SUBDOMAIN.workers.dev/auth/twitch/callback
```

This must match `TWITCH_REDIRECT_URI` exactly.

## Frontend Pages Setup

Create a separate Cloudflare Pages project from GitHub repo:

```text
Raghav3k/Findraw
```

Use these settings:

```text
Framework preset: Vite or None
Build command: pnpm build:cloudflare
Build output directory: dist
Root directory: repo root
```

Add environment variable:

```text
PNPM_VERSION = 10.34.1
```

After backend Worker is deployed, add this Pages environment variable:

```text
VITE_API_BASE_URL = https://findraw-backend.YOUR_SUBDOMAIN.workers.dev
```

Then redeploy Pages.

## Asset Storage Plan

Do not put assets in GitHub.

Use Cloudflare R2 later for these local folders:

```text
public/auto-draw/
public/category-art/
```

After assets are hosted, set this Pages environment variable:

```text
VITE_ASSET_BASE_URL = https://your-public-assets-url
```

The frontend already supports this through:

```text
src/assetUrls.ts
```

Until R2 is configured, the online frontend will load but asset-heavy image features may not display correctly unless assets are available at the expected URLs.

## Recommended Remaining Order

1. Fix `findraw-backend` API token in Cloudflare.
2. Retry backend Worker build.
3. Copy final Worker URL.
4. Update `cloudflare/backend/wrangler.toml` with real `FRONTEND_URL` and `TWITCH_REDIRECT_URI`.
5. Commit and push the URL config.
6. Add Worker encrypted secrets: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `SESSION_SECRET`.
7. Add exact Twitch callback URL in Twitch Developer Console.
8. Deploy/retry backend Worker.
9. Create Cloudflare Pages project for frontend.
10. Set Pages variables: `PNPM_VERSION`, `VITE_API_BASE_URL`.
11. Deploy frontend Pages.
12. Create R2 bucket for assets.
13. Upload `public/auto-draw` and `public/category-art` to R2/public asset host.
14. Set Pages variable `VITE_ASSET_BASE_URL`.
15. Redeploy frontend.
16. Test Twitch connect, live chat, rounds, leaderboard, and Auto Draw assets.

## Useful Commands

From project root:

```powershell
pnpm build:cloudflare
```

Backend dry run:

```powershell
wrangler deploy --dry-run --config cloudflare/backend/wrangler.toml
```

Backend deploy from local machine:

```powershell
wrangler deploy --config cloudflare/backend/wrangler.toml
```

Git status:

```powershell
git status --short --branch
```

Push changes:

```powershell
git push
```

## Important Notes

- Supabase is not needed right now.
- Cloudflare Durable Objects handle Twitch session, live round state, and leaderboard storage.
- Cloudflare R2 is the preferred asset storage choice because the rest of the stack is already Cloudflare.
- The old local Express server still exists in `server/` for local development.
- Production should use the Worker backend through `VITE_API_BASE_URL`.
- The GitHub repo is intentionally small and does not include assets.
