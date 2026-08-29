# Findraw handoff: changes since the last Cloudflare deployment

Date prepared: 2026-08-29

## Deployment baseline

Cloudflare reports the current production Worker deployment as version
`e3f874e0-c008-44ee-a28a-8c2e96f5531e`, uploaded at
`2026-08-21T18:29:09.047Z`.

That timestamp is immediately after Git commit `4136cb7` (`Fix room lifecycle
and secure room codes`), and the deployed binding list matches that revision:
it has `FINDRAW_ROOM` and `FINDRAW_SESSION`, but not the later
`FINDRAW_COMMUNITY` binding. Treat `4136cb7` as the practical production
baseline unless a separate unrecorded Pages/Worker upload is discovered.

The changes below include commits `89708d5` through `6e792fd` plus the working
tree completed after `6e792fd`.

## What changed

### 1. Dockable and resizable game workspaces

- Added constrained dock layouts for Artist, Auto Draw, and Room modes.
- Panels can be rearranged and resized while staying inside safe layout bounds.
- Divider resizing has snap points and clearer snap feedback.
- Scrollable panels use the shared Findraw scrollbar treatment.

### 2. Artist word mix rebuilt

- Replaced the previous deep category-selection flow with a simpler multi-pack
  word mix.
- Standard content is separated into Games and General interests.
- Multiple packs can be combined without a spoiler/preview step.
- Selected packs are shown as removable chips and can be cleared together.
- The initial standard game set was expanded, including Minecraft, Valorant,
  Fortnite, League of Legends, GTA V, Deadlock, Clash Royale, and Clash of
  Clans, with intentionally recognizable drawing words.
- General interests use familiar pools such as Animals, Food, Places, Movies &
  TV, Music, Sports, and Everyday; `All` is optional rather than preselected.
- Pack cards and selection states were redesigned within the existing visual
  theme.

### 3. Community word packs

- Added user-created packs with flexible free-form tags rather than a fixed tag
  taxonomy.
- Community packs remain separate from reviewed Standard packs.
- Added create, edit-token, share-code, lookup, and report flows.
- Added input validation, blocked-term moderation hooks, duplicate-report
  handling, and review states.
- Added the `FINDRAW_COMMUNITY` Durable Object binding and the `v3` migration in
  `wrangler.toml`.

### 4. Twitch identity and browser isolation

- Moved Twitch identity to the home-page profile area and redesigned connect,
  switch-account, and log-out interactions.
- Twitch display name and profile image now represent the site identity when
  connected; the local profile remains a clear disconnected fallback.
- OAuth state now carries the originating browser-session key.
- API calls, SSE, and WebSocket connections send a persistent
  `X-Findraw-Session`/`client` key.
- Cloudflare now routes each browser session to its own `FindrawSession`
  Durable Object instead of sharing the single `main` object between every
  streamer.
- Twitch session validation refreshes the current display name, profile image,
  granted scopes, and token expiry.

### 5. Permanent points and hosted reward sessions

- Permanent Findraw points remain channel-specific and continue accumulating in
  ordinary/chill play.
- Added optional hosted sessions inside Artist Mode rather than as a separate
  home-page game mode.
- A hosted session has its own temporary standings while the same correct guess
  also contributes to permanent points.
- Streamers can define rewards for positions 1 through 5, start/end a session,
  inspect final standings, keep session history, and mark rewards fulfilled.
- Session and Points now have dedicated tabs in the leaderboard panel.
- Both the local Express storage and the Cloudflare Durable Object points schema
  support active sessions and history.

### 6. Twitch chat score commands

- OAuth now requests both `user:read:chat` and `user:write:chat`.
- Added `!finpoints` for permanent points and overall rank.
- Added `!finsession` for the viewer's current hosted-session score and rank.
- Added `!finrewards` for the active session's configured rewards.
- Replies are posted through the connected streamer account and are attached to
  the requesting chat message.
- Added a 15-second per-viewer cooldown, a paced outgoing queue, a queue-size
  guard, Twitch drop-reason handling, and targeted diagnostic logs.
- Artist Settings includes an on/off switch, command labels, permission status,
  and a forced Twitch reconnect action when the existing token lacks
  `user:write:chat`.

### 7. Chat presentation and settings cleanup

- Chatter names now receive stable colors from a restrained Findraw palette, so
  the same name stays recognizable without depending on arbitrary Twitch colors.
- The color behavior is shared by Artist Mode and Auto Draw.
- Removed settings that were displayed but did not affect behavior, leaving the
  functional hover options, shortcuts, Twitch state, and command controls.

### 8. Local/Cloudflare parity

- The local Express backend and Cloudflare Worker implement the same hosted
  sessions, score commands, Twitch scopes, command toggle, cooldown behavior,
  and session summaries.
- Local testing uses `http://localhost:3000/auth/twitch/callback`; production
  uses the configured Workers callback.

## Deployment cautions

1. **Deploy the frontend and Worker as one release.** The new frontend sends a
   browser-session key and the new Worker requires it for Twitch/session routes.
2. **Existing Twitch connections must reconnect once.** Old tokens only have
   `user:read:chat`; command replies require `user:write:chat`.
3. **No new Twitch client ID or secret is required.** Keep the existing secrets
   and registered callback URLs.
4. **The Community Durable Object migration has not reached production yet.**
   The next Worker deployment will apply the configured `v3` class migration.
5. **The old `main` Durable Object is not automatically migrated.** Existing
   test points, session data, or Twitch tokens stored in that object will not
   automatically appear in the new per-browser objects. Decide whether that
   pre-release data needs preserving before production deployment.
6. **Browser identity is persistent per browser profile.** Clearing site data or
   using a different browser creates a different backend session and therefore a
   separate streamer workspace under the current design.

## Recommended release order

1. Confirm whether data in the old `main` Durable Object can be treated as test
   data or needs a one-time migration.
2. Build the frontend and run the Worker dry-run validation.
3. Deploy the Worker and Pages frontend back-to-back.
4. Open the production site, reconnect Twitch, and confirm that Settings shows
   chat commands enabled.
5. Test `!finpoints`, `!finsession`, and `!finrewards` from Twitch chat.
6. Verify community-pack creation/reporting and one complete hosted reward
   session before announcing the release.

## Verification completed before this checkpoint

- TypeScript and Vite production build completed successfully.
- Local Express, storage, and Cloudflare Worker files passed JavaScript syntax
  checks.
- Artist Settings was visually checked with an existing old-scope Twitch token;
  it correctly showed the reconnect requirement and disabled the command toggle.
- Cloudflare deployment history and the active Worker binding list were checked
  to establish the baseline above.
