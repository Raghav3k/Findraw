# Findraw handoff: changes since the last Cloudflare deployment

> Historical handoff. For the current release, follow
> [SECURITY_CHECKLIST_2026-09-01.md](SECURITY_CHECKLIST_2026-09-01.md).
> The cookie-authentication migration replaces the bearer-session and Worker
> callback instructions below. Register the Pages callback and configure real
> Turnstile keys before deploying the matching frontend and backend.

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

### 5. Weekly points and hosted reward sessions

- Findraw Points remain channel-specific but now run as Monday-to-Monday UTC
  weekly placements so new viewers get a fresh competitive start.
- Completed weeks are archived rather than deleted, and streamers can attach
  optional placement rewards and mark them fulfilled manually.
- Added optional hosted sessions inside Artist Mode rather than as a separate
  home-page game mode.
- A hosted session has its own temporary standings while the same correct guess
  also contributes to the current weekly placement.
- Hosted-session setup starts with five reward slots, but streamers can add or
  delete positions as needed (up to 20); remaining positions renumber after a
  deletion.
- Streamers can start/end a session, inspect final standings, keep session
  history, and mark rewards fulfilled.
- Session and Weekly now have dedicated tabs in the leaderboard panel.
- Both the local Express storage and the Cloudflare Durable Object points schema
  support active sessions and history.

### 6. Twitch chat score commands

- OAuth now requests both `user:read:chat` and `user:write:chat`.
- Added `!finpoints` for current weekly points and rank, including reset timing.
- Added `!finsession` for the viewer's current hosted-session score and rank.
- Added `!finrewards` for the active hosted session's rewards, falling back to
  configured weekly placement rewards when no hosted rewards are active.
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

### 9. Weekly scoring lifecycle

- Existing version-2 channel scores migrate into the current weekly season on
  first access.
- New ledger entries record their `weekId`.
- Weekly rollover is deterministic and lazy: the first read or score after
  Monday 00:00 UTC archives the previous season and opens the new one.
- Simulated local test bots still exercise the feed and solved UI but no longer
  write to real weekly or hosted-session standings.

### 10. Room Mode word-system parity

- Replaced Room Mode's legacy category selector with the same Games, General,
  and Community Word Mix window used by Artist Mode.
- Artist and Room now share the same pack-balanced prompt picker. Room ballots
  contain three distinct choices, balance selected packs, and avoid both
  recently played words and recently presented losing choices.
- Room word feedback is converted into bounded selection weights, so poorly
  rated prompts become less likely without being permanently removed.
- Online rooms synchronize a sanitized snapshot of the selected packs to the
  room Durable Object. Cloudflare generates every voting ballot; browsers can
  no longer submit their own ballot or an arbitrary chosen answer.
- Pack contents remain private in the Durable Object. Non-drawers receive only
  pack labels/counts and concealed voting slots, while the drawer receives the
  three current choices.
- Existing Room voting, rotating drawers, speed-based party scoring, drawing
  synchronization, and round-result flow remain unchanged.

### 11. Central site identity

- Added one site-level identity provider shared by Home, Artist Mode, Auto Draw,
  and Room Mode. Twitch session state is fetched once and updated from one live
  event subscription instead of each mode maintaining a separate identity copy.
- A connected Twitch display name/avatar is now the resolved identity throughout
  the site. The persistent editable guest name is used only while disconnected.
- Room seats are created from that resolved identity, and each workspace shows
  the same compact current-identity marker.

### 12. Room reconnection and Twitch ownership

- Online Room seats now have a persistent browser player ID plus a separate
  reconnect secret. Only the browser holding that secret can reclaim the seat.
- A dropped socket reserves its player, score, and leader/drawer role for 30
  seconds. The client retries transient WebSocket failures automatically, and a
  page refresh rejoins the last online room after site identity finishes loading.
- Explicitly leaving clears the remembered room and removes the seat immediately.
- Twitch guesses in an online room now belong to the party leader's isolated
  Twitch session for the whole game. Drawer rotation no longer switches the
  Twitch channel or starts competing browser-side rounds.
- The Room Durable Object starts/ends the leader's chat round and receives its
  correct solvers through an internal callback. Public Room state exposes only
  the leader label, chat status, and solver list; browser session keys, seat
  secrets, prompt packs, and the internal Twitch round ID remain private.
- Transferring leadership between games also transfers Twitch ownership to the
  new leader's browser session.

### 13. Room entry flow and public matchmaking

- Room Mode now opens a dedicated choice page instead of dropping directly into
  the drawing workspace. Its two primary routes are Public Multiplayer and
  Create Room.
- Private room creation has its own setup page for the shared Word Mix, maximum
  players, rounds per player, and drawing time. Joining by private code is also
  kept on that setup page.
- Setup is handed to the play route through a short-lived session launch intent.
  The gameplay workspace no longer contains create/join forms or editable room
  settings; its left rail is focused on players plus the camera/secret-word frame.
- Added `FindrawMatchmaker`, a Cloudflare Durable Object that serializes public
  matching, reuses an available lobby, or allocates a new six-character room.
- Matchmaking reserves the player's protected Room seat before returning the
  room code, avoiding first-player room-creation races. Two public reservations
  receive the same lobby until it fills or leaves the lobby phase.
- Public rooms have a separate visual treatment and status panel, standard
  eight-player/three-round/90-second rules, a default balanced Word Mix, and
  automatically start shortly after at least two connected players are present.
- Public matches do not attach to the first player's Twitch channel. Private
  rooms retain the leader-owned Twitch chat integration.
- Public matchmaking is deliberately unavailable in the browser-only local
  fallback. Local development can still create private same-browser rooms.
- Room entry, private setup, multiplayer search, and both play variants now use
  the same ruled-paper background color and line treatment as the rest of the
  Findraw site; the setup form remains a foreground yellow paper sheet.
- Development builds expose `Test with 5 bots` on the Multiplayer page. It opens
  the public layout locally with five randomized, visibly labelled test bots
  that auto-start, vote, make imperfect guesses, and occasionally solve. The
  control is compiled out of production and does not write Twitch/weekly points.

### 14. Account-owned channel persistence (2026-08-30)

- Added `FindrawChannel` / `FINDRAW_CHANNEL` and migration `v5`. Authentication
  stays browser-isolated, while points, weekly archives, hosted sessions and
  rewards are now shared by the streamer's verified Twitch ID across devices.
- Added atomic scoring, channel-wide round ownership, confirmed takeover,
  duplicate-event protection and channel-wide command-reply deduplication.
- Legacy `main` and browser data are imported non-destructively per channel.
  Conflicting sources are preserved for review, not summed or overwritten.
- See [CHANNEL_PERSISTENCE.md](CHANNEL_PERSISTENCE.md) for migration behaviour,
  limitations, verification and the required post-deployment account tests.

## Deployment cautions

1. **Deploy the frontend and Worker as one release.** The new frontend sends a
   browser-session key and the new Worker requires it for Twitch/session routes.
2. **Existing Twitch connections must reconnect once.** Old tokens only have
   `user:read:chat`; command replies require `user:write:chat`.
3. **No new Twitch client ID or secret is required.** Keep the existing secrets
   and registered callback URLs.
4. **The Community Durable Object migration has not reached production yet.**
   The next Worker deployment will apply the configured `v3` class migration.
5. **Legacy channel records now have a non-destructive migration.** The v5
   gateway imports that streamer's records from `main` and the current browser.
   Conflicts remain backed up for review; tokens are not migrated between browsers.
6. **Browser auth and channel data are separate.** Clearing site data requires a
   new login, but reconnecting the same Twitch account restores its shared channel
   records. Old browser records whose identifier was already lost need operator recovery.
7. **Room frontend and Worker must be released together.** The Room WebSocket
   protocol now sends `word-mix` snapshots and asks the Durable Object to create
   ballots; the removed client-supplied category/choice messages are not used by
   the new frontend.
8. **The latest Room client and Worker are another paired protocol change.** The
   join message now includes a reconnect secret, and online Twitch solvers are
   delivered through the Room Durable Object. Deploying only one side will break
   new Room joins or leave the Twitch panel unsynchronized.
9. **Public matchmaking adds Durable Object migration `v4`.** Deploy the Worker
   before exposing the Multiplayer route in Pages; it requires the new
   `FINDRAW_MATCHMAKER` binding and the internal public-seat reservation route.
10. **Channel persistence adds migration `v5`.** Deploy the `FINDRAW_CHANNEL`
    binding before the matching frontend and review migration warnings. Do not
    roll back to browser-local scoring after the channel store receives writes.

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
- Room Word Mix selection passed the production TypeScript/Vite build, and a
  Durable Object lifecycle test confirmed three distinct server-generated
  choices, private pack contents, public pack summaries, and concealed ballots
  for non-drawers.
- The Room lifecycle checker now also confirms protected seat recovery, preserved
  scores and host identity, private-state filtering, stable leader-owned Twitch
  round startup, solver delivery, round shutdown, and two-player public lobby
  assignment.
- Browser QA covered the Room choice page, private setup, shared Word Mix modal,
  multiplayer search state, launch handoff, and the focused play workspace with
  the old create/join controls absent.
- Artist Settings was visually checked with an existing old-scope Twitch token;
  it correctly showed the reconnect requirement and disabled the command toggle.
- Cloudflare deployment history and the active Worker binding list were checked
  to establish the baseline above.
