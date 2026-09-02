# Production architecture hardening — 2026-08-31

These changes target the Cloudflare production implementation. Local fixtures are
verification of that implementation, not replacements for online multiplayer.
This document records the August 31 checkpoint. The image-driven experimental mode was subsequently moved out of the public project; R2 cleanup still requires a deliberate dashboard operation after the replacement frontend is deployed.

## Implemented

- Site identity observes live identity events without opening a connection. It
  fetches identity on initial load and when the page becomes visible again.
- Authenticated live modes share one ref-counted transport per page. Guests do
  not open Twitch feeds. Online rooms use their room socket, not an unused Twitch
  event feed.
- Cloudflare identity restoration no longer starts outgoing Twitch chat. Opening
  a live mode or starting private-room Twitch scoring activates it on demand.
  With no live viewers, chat shuts down after a 30-second grace period; active
  private-room scoring is preserved up to its bounded round lease. Login is kept.
  Commands are available while a live game/chat connection is active, not as an
  always-running bot after all game pages close.
- Artist cross-browser reconciliation polls every 60 seconds rather than 15;
  same-browser score events remain live. Visibility/reconnection also refreshes.
- CORS preflights terminate in the Worker, without invoking a Durable Object, and
  advertise a one-hour preflight cache lifetime (browser caps still apply).
- Rooms use `acceptWebSocket` and serialized socket attachments. Client identity,
  protocol version and rate-limit state survive hibernation. WebSocket mutations
  are serialized. A 32-socket room cap and 15-second unjoined-connection deadline
  bound unused connections within each room.
- Durable alarms replace disconnect timers: 30-second reconnect reservation,
  public auto-start after 3.5 seconds with two connected players, 20-second voting
  timeout, drawing deadline, and 10-second results transition. Empty rooms remove
  their transient data. Never-connected matchmaking reservations also expire.
- Public word packs/default rules originate on the server; clients cannot change
  them or directly join unreserved public seats. Private room customization stays.
- Artist, browser-local rooms and Cloudflare rooms use `shared/wordQueue.mjs` and
  `shared/builtinWordPacks.json`. Feedback weights still come from the existing
  pack-snapshot builder; private custom/community packs remain supported.
- Drawing, guesses and prompt catalogs are stored separately from room metadata.
  A wrong guess saves only the guess list; a drawing commit saves only changed
  drawing data. Modern clients receive revisioned deltas and do not receive
  the whole drawing again with every guess or stroke. Older clients retain full snapshots
  during a coordinated frontend/backend rollout.
- Channel points are migrated transactionally from one blob into bounded,
  independently change-detected records. Participant buckets, session/weekly
  metadata, history and ledger buckets do not all rewrite with each score.
  Stable reads avoid writes and avoid unnecessary re-encoding. Migration removes
  the replaced `points` key only in the same transaction that saves layout v4.
- Normal chat messages are no longer logged by default in the Worker. Command
  diagnostics and failures remain; `TWITCH_DEBUG=true` restores receive logging.

## Retention policy

`shared/pointsRetention.mjs` retains completed history and ledger data for 60 days.
The existing 5,000-entry ledger safety cap may keep less than 60 days at high volume.

Protected from automatic deletion:

- Current weekly standings and active hosted sessions.
- Completed weekly/session records with any unfulfilled non-empty reward.
- Undated legacy records, migration backups/conflict snapshots, and replay guards.

Automatic maintenance rolls non-empty expired weekly standings forward and cleans
eligible history. It coalesces expiry to daily boundaries, so deletion can occur
up to about one day after the 60-day cutoff. Alarms stop when no expirable data
remains. Existing untouched objects acquire this schedule when their points are
next written/migrated/rolled over; this release does not enumerate the account to
retroactively purge every dormant legacy object. The Express development store
uses the same retention policy on access/mutation, not Cloudflare alarms.

Marking an old pending reward fulfilled makes it eligible for expiry. No current
score is subtracted when its audit/history entry expires. Protected pending
records can continue to grow until fulfilled; retention is not a total-storage cap.

## Verification

- `pnpm check:production`: identity transport ownership, large-record round trips,
  bounded values with 12,000 synthetic participants, no-op writes, 60-day expiry,
  protected rewards, inactive maintenance, shared word queue, socket restoration,
  durable deadlines, session isolation, scoring deduplication and ownership.
- `node scripts/check-room-runtime.mjs`: run with a separate local Wrangler server
  on port 8793. Exercises real Cloudflare WebSockets, two-player matchmaking,
  server auto-start, voting, secret masking, drawing, guesses, scores and reconnect.
- `node scripts/check-channel-runtime.mjs <wrangler-package.json>`: uses the
  installed Wrangler esbuild/Miniflare dependencies and isolated in-memory SQLite
  to test migration, concurrent adjustments, weekly/session totals and rewards.
- `pnpm build:cloudflare`: deployable frontend build. As of the later mode separation, it no longer requires R2 asset URLs.
- `node scripts/audit-cloudflare-usage.mjs`: read-only synthetic operation audit.
  Its logical `get` count excludes rows returned by `list`; neither operation
  counts nor serialized bytes are metered Cloudflare billing or CPU measurements.

Observed fixture write counts: unchanged weekly/session poll pair 3 -> 0;
accepted Twitch guess 10 -> 5; points command 4 -> 1; manual adjustment 9 -> 2.
The fixture has no active hosted session; an active session adds its own changed
participant record. First migrations, rollover and maintenance have extra work.

The installed Wrangler 4.47.0 runtime used here supports compatibility dates only
through 2025-11-09. The configured production date remains 2026-08-07. These tests
cover the supported WebSocket/SQLite APIs; use a current Wrangler for the final
release verification. The Vite build still reports an oversized application chunk.

## Release gates and remaining work

1. Preserve secrets and review/export unresolved legacy migration conflicts.
2. Deploy the matching Worker and frontend together, including pending v5 binding
   migration from the channel-persistence release. Do not roll back to the old
   single-blob writer after v4 data migration; use a forward fix.
3. Test actual OAuth with two streamers, switching accounts, expiry/revocation and
   private-room chat. Synthetic fixtures cannot establish Twitch integration health.
4. Run a controlled multi-room load test and inspect actual duration, CPU, storage
   reads/writes and latency before setting a player limit. Hibernation reduces idle
   cost, not continuously active drawing cost. Revisioned stroke deltas and bounded
   drawing journaling are now implemented; see `DRAWING_DELTA_SYNC.md` for details.
5. Configure public abuse protection, moderation/report handling and cost monitoring
   before an unrestricted launch. Per-room limits are not a global bot/traffic cap.

The channel domain handlers still share the existing session class implementation;
storage and queue rules are separated, but a complete class/module refactor is not
part of this change. Record loading still reconstructs channel data in memory;
targeted SQL queries may be needed if measured large-channel read/CPU costs warrant
it. The experimental image library and its home-page catalog import were removed
in the later private-mode separation. No claim of unlimited/free hosting capacity
or readiness for 10,000 concurrent players follows from these checks.
