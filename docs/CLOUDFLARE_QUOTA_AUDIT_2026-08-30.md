# Findraw: Cloudflare free-tier capacity audit

Date: 2026-08-30. Scope: whole-site infrastructure, traffic, storage, assets and quota-related abuse exposure.

## Verdict

Do not open the current local candidate to unrestricted public traffic on the assumption that the free tier has ample headroom. Its largest problem is **unnecessary always-active Durable Objects**, followed by score-write amplification, public admission controls and oversized assets.

Cloudflare remains a viable architecture. The session/channel isolation should be retained; reverting to a shared `main` session would reintroduce privacy and account-switching problems. However, free-tier capacity is finite even after optimization, especially while each connected streamer needs an outbound Twitch chat socket.

This review changes no application behavior, data or deployment. It adds this report and a repeatable, in-memory diagnostic script.

### Evidence and limits of this audit

- Inspected the current working tree at HEAD `0cec9a9`, including existing uncommitted channel-persistence and room changes.
- Rechecked Cloudflare deployment history read-only. The latest Worker deployment remains `e3f874e0-c008-44ee-a28a-8c2e96f5531e`, created August 21, 2026. The handoff documents `4136cb7` as its practical baseline. **The local candidate and the live Worker are not equivalent.** Capacity scenarios below describe the local candidate, not measured production traffic.
- Verified current official Cloudflare documentation; sources accompany relevant facts.
- Executed application methods with synthetic identities and in-memory storage. Counted Worker entries, DO fetches, storage calls and serialized JSON sizes. These are success-path code measurements, not Cloudflare's metered rows, CPU, duration or a distributed load test.
- Inventoried local assets and the historical R2 upload manifest. Did not list or alter real channel records.
- Did not retrieve account-wide billing/usage analytics, R2's current inventory/cache hit ratio, active dashboard security rules, the exact deployed Pages bundle, or other applications' usage. Account plan settings and remaining quotas still require dashboard confirmation. No guaranteed visitor limit or post-optimization capacity can be certified without these measurements.

## 1. Which Cloudflare products Findraw uses

| Component | Work done | What consumes quota |
| --- | --- | --- |
| Pages | Serves the React site, CSS, JS and bundled files | Builds/file limits; ordinary static requests are not backend requests |
| R2 | Auto Draw images and uploaded category art | Stored bytes, object GET/HEAD operations, uploads/list operations |
| Backend Worker | Routes API calls, OAuth, matchmaking and socket upgrades | HTTP requests, CPU, subrequests |
| `FindrawSession` DO | Browser-specific Twitch identity, chat socket, live events, round controller | Active duration, socket messages, storage, internal calls |
| `FindrawChannel` DO | Channel-owned weekly points, sessions, rewards, deduplication | Read/write operations, internal requests, processing duration |
| `FindrawRoom` DO | Shared multiplayer room, guesses, drawing, timers | Duration, incoming messages, full-state writes, alarms |
| `FindrawMatchmaker` DO | Places players into a public room | Join requests, room lookups/reservations and pointer writes |
| `FindrawCommunity` DO | Shared word-pack catalog and reports | Reads, writes, retained packs/report records |

The five classes are configured as **SQLite-backed Durable Objects** in `cloudflare/backend/wrangler.toml`. Using their `storage.get/put` methods does **not** mean this app uses the separate Workers KV product. No D1, Queues, Workers AI, Images transformation or Stream binding is configured here; their advertised free allowances do not add capacity to these DOs.

Twitch viewers who stay on Twitch are different from Findraw website visitors: their chat arrives through the streamer's existing EventSub connection. Each Twitch viewer does not create a Findraw browser/session object. Rendering canvas frames, local word selection, the browser countdown and local test bots are browser work—not a Cloudflare call for every frame. Local `pnpm dev` backend work is also not remote Worker usage; locally loaded production R2 URLs can still consume R2 reads.

## 2. Relevant free-tier allowances

| Meter | Free allowance | Impact when exhausted or exceeded |
| --- | --- | --- |
| Worker HTTP requests | 100,000/day, shared account allowance | Backend requests fail |
| Worker CPU | 10 ms per HTTP request | Individual expensive requests can fail even below daily allowance |
| DO requests | 100,000/day | DO operations fail |
| DO active duration | 13,000 GB-seconds/day | Real-time backend becomes unavailable |
| SQLite DO rows read | 5,000,000/day | Reads fail |
| SQLite DO rows written | 100,000/day | Writes fail; alarms/deletes also consume this meter |
| SQLite DO stored data | 5 GB total on Free | Storage capacity constraint, not a daily refill |
| R2 Standard storage | 10 GB-month/month | Usage above allowance can be billed |
| R2 Class A | 1,000,000 operations/month | Upload/list/write overage can be billed |
| R2 Class B | 10,000,000 operations/month | Read/HEAD overage can be billed |
| R2 internet transfer | No egress charge | Does not make object operations free |
| Pages static requests | Free and unlimited when no Functions run | Not the bottleneck for the static frontend |
| Pages builds | 500/month, one concurrent build, 20-minute timeout | Build/deployment constraint |
| Pages files | 20,000/site; 25 MiB per file | Oversized deployment fails |
| Workers Logs, if enabled | 200,000 events/day, 3-day retention | Separate observability allowance |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Pages static pricing](https://developers.cloudflare.com/pages/functions/pricing/), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

Daily limits reset at 00:00 UTC, or **05:30 India time**. They are not per room or per streamer. Other projects can consume the same account allowances. Workers/DO Free exhaustion is not the same as R2's billable allowance: “everything is on Free” is not a universal zero-spend cap. See the Workers, DO and R2 sources above.

Other relevant ceilings: Worker memory 128 MB and compressed script size 3 MB; DO key plus serialized value 2 MB; DO request CPU has its own documented 30-second default, not the router's 10 ms. Network waiting is not CPU time. Cloudflare's DO limits page currently has inconsistent per-object storage wording between its table and FAQ; this report relies on the consistent 5 GB account limit and 2 MB value limit, not a disputed per-object number. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

### Counting connections correctly

A WebSocket upgrade is one Worker request; its subsequent messages are not additional Worker HTTP requests. Incoming DO WebSocket messages receive a 20:1 request-billing ratio; DO HTTP calls count separately. Outgoing socket messages are not charged as requests. Analytics can display raw message counts, so do not compare those directly with billed request equivalents. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## 3. Critical: active duration is the first likely bottleneck

### What the code currently does

1. `src/identity/SiteIdentity.tsx:40` opens a live-event connection globally, including on the home page and for disconnected guests.
2. `src/twitch/twitchApi.ts:72` turns that into a production `/api/live` WebSocket.
3. `cloudflare/backend/src/index.js:1794` accepts it with `server.accept()`. The object cannot hibernate while that socket remains connected.
4. Artist, Auto Draw and Room Mode open additional live-event connections (`Dashboard.tsx:342`, `AutoDrawPage.tsx:124`, `RoomModePage.tsx:408`). These normally address the same browser object, so they duplicate traffic/handling **but not that object's duration**.
5. The shared room socket also uses standard `accept()` (`index.js:552`). Eight distinct guest browsers in one room therefore keep approximately **nine** objects active: eight session objects and the room object.
6. Authenticated sessions additionally establish an outbound Twitch EventSub socket. Closing a UI socket alone does not solve that object's lifecycle; chat must be explicitly demand-managed.

Standard sockets accrue duration while connected. Hibernation-compatible server sockets can remain connected without idle duration, but outbound WebSockets and pending timers prevent hibernation. Switching API names alone is insufficient: client attachments, event handlers, restoration and disconnect deadlines need a lifecycle refactor. [WebSocket hibernation documentation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

### Capacity arithmetic

Cloudflare accounts for 128 MB allocated per active object, using 0.128 GB in its examples. Thus:

```text
one active object-hour = 0.128 × 3,600 = 460.8 GB-s
daily free object-hours = 13,000 / 460.8 = 28.21
duration estimate = 460.8 × sum of active object-hours
```

Allocation and duration source: [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/). The calculations and scenarios below are Findraw estimates.

| Current-candidate scenario in one quota day | Active object-hours | Duration | Daily allowance used |
| --- | ---: | ---: | ---: |
| One streamer/browser open for 6 hours | 6 | 2,765 GB-s | 21% |
| Four streamer browsers for 6 hours each | 24 | 11,059 GB-s | 85% |
| Five streamer browsers for 6 hours each | 30 | 13,824 GB-s | 106% |
| One 8-player room for 2 hours | 18 | 8,294 GB-s | 64% |
| Two 8-player rooms for 2 hours each | 36 | 16,589 GB-s | 128% |
| 100 distinct home-page browsers, 15 minutes each | 25 | 11,520 GB-s | 89% |
| 500 distinct home-page browsers, 5 minutes each | 41.67 | 19,200 GB-s | 148% |

Assumptions: connections remain open; browsers use different session keys; there is no other account usage. Extra channel/matchmaker work, reconnects and lingering outbound chat can only reduce this headroom. Same-browser tabs share session identity: do not count their overlapping session duration twice. These are duration-only estimates, not promises that all other quotas fit.

With no other usage, one continuously occupied 8-player room reaches this duration budget after roughly **3 hours 8 minutes**. Four such rooms reach it in about **47 minutes**. A fast internet connection does not change this.

### Priority fixes

- Do not create a persistent Twitch/session socket for an unauthenticated guest or a home-page identity badge. Use a bounded identity fetch and explicit state updates.
- Share one event connection among interested components per browser; reference-count consumers.
- Gate Twitch chat connection on actual need, with clear start/stop and reconnect semantics. Preserve an explicitly desired command bot, but count its connected hours.
- Refactor room sockets to hibernation handlers; replace disconnect `setTimeout` state with persisted deadlines/alarms. Do not lose host migration, seat security or round state when the object sleeps.
- Close unused room sockets on leaving the room; add idle lobby/finished-room deadlines.

Removing guest session sockets alone reduces the modeled 8-player room from nine continuously active objects to one: about **89% less base duration** in that scenario. Two guest rooms for two hours become about 1,843 GB-s rather than 16,589, before other activity. Actual hibernation savings must then be measured; busy drawing rooms are not idle all the time. Five independent six-hour Twitch connections can still exceed Free even after guest optimizations.

## 4. Measured request and storage amplification

Run `node scripts/audit-cloudflare-usage.mjs` from the repository root. It uses in-memory fixtures, blocks external fetches, and does not access production data.

| Tested operation after initial migration | Worker entries | Internal DO fetches | Logical gets | Logical puts |
| --- | ---: | ---: | ---: | ---: |
| Weekly-points + hosted-session polling pair | 2 | 4 | 6 | 3 |
| Same pair with two OPTIONS preflights | 4 | 6 | 6 | 3 |
| Ordinary incorrect Twitch guess | 0 | 0 | 0 | 0 |
| Accepted correct Twitch guess | 0 | 4 | 14 | 10 |
| Same user's duplicate solve, same warm controller | 0 | 0 | 0 | 0 |
| Successful `!finpoints` command | 0 | 2 | 6 | 4 |
| Manual points adjustment | 1 | 5 | 15 | 9 |
| Wrong room guess | 0 | 0 | 0 | 1 |
| Committed room drawing sync | 0 | 0 | 0 | 1 |
| Room drawing preview | 0 | 0 | 0 | 0 |

Twitch/room rows exclude the incoming WebSocket event itself; apply the message meter separately. Lifecycle, token refresh, imports, round start/end, alarms and real room callbacks add work. Tests bypass actual WebSocket dispatch, storage caching and persistence, so puts are **logical storage calls, not a claim of exact billed SQLite rows**. The asynchronous storage API buffers/coalesces some operations; measure real metrics before setting production limits. [Storage API behavior](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

### Idle Artist polling

`src/dashboard/Dashboard.tsx:336` polls two endpoints every 15 seconds while the authenticated page is visible. That means 240 pairs/hour:

- 480 main Worker requests/hour, before preflights.
- 960 internal DO requests/hour, before preflights.
- 720 logical put calls/hour, despite no new scores.
- Initial loads, focus refreshes and gameplay are additional.

Production uses a separate API origin and a custom session header. `corsHeaders` does not set `Access-Control-Max-Age`; browser default preflight caching is only five seconds. With two preflights per polling pair, the modeled totals become **960 Worker and 1,440 DO requests/hour**. Browser traces must verify the actual cache behavior. [Preflight cache default](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Max-Age).

Why these reads write: `FindrawChannel.fetch` always rewrites `channelId`; leaderboard, weekly-summary and viewer-standing helpers always rewrite the entire `points` value, even if the week has not changed (`index.js:1864`, `1873`, `1885`, `2238`). This is present in the new persistence implementation and should be optimized before wider rollout.

Fix: initialize channel identity once; make unchanged reads read-only; persist weekly rollover only when it occurs. Combine the two page reads into one versioned channel snapshot, fetch history only when needed, and use targeted updates or bounded slower reconciliation rather than perpetual duplicate full histories. Cache preflight safely and handle OPTIONS in the router before DO dispatch. Do not put private identity/points responses into a shared public CDN cache.

### Correct guesses

The ten puts comprise four repeated `channelId` writes, three full `points` writes, and one each for channel round, browser round and recent scoring event IDs. The score mutation is followed by three separate calls to fetch leaderboard, weekly summary and active hosted session (`index.js:1632`). A room-linked Twitch solve adds its room notification/write.

Fix: atomically apply the award/deduplication and return the updated summary in the **same channel operation**. Derive related UI snapshots from that result. Do not defer durable points/reward writes to an unreliable browser timer just to reduce quota. Keep transaction safety, duplicate protection, channel ownership and rollback tests.

### Drawing and guesses

`useDrawingCanvas.ts:140` throttles preview to roughly 20 updates/second while moving, with forced boundary updates. Preview broadcasts do not write storage. Completed strokes/undo/redo/clear send the whole operation list; each accepted sync saves the whole room. Wrong room guesses also save/broadcast the whole room, including its drawing.

Useful existing protections: 256 KiB incoming room-message cap; 500 operations/8,000 points maximum after sanitization; preview/sync/guess rate limits; host/drawer authority checks. These must be preserved. But a rate limit does not make all allowed traffic affordable, and rejection inside a DO does not erase the incoming request/message cost.

Illustrative busy-room hour: 30 completed strokes/minute + seven guessers submitting two guesses/minute = about **2,640 room writes/hour**, before lifecycle activity. Continuous 20 Hz preview contributes around **3,600 DO request equivalents/hour**, plus sync/guess messages. Real activity includes drawing pauses; this is a declared workload, not observed user behavior.

Fix: use sequence-numbered drawing deltas, coalesced bounded previews, periodic recovery snapshots and chat/score deltas. Checkpoint drawing less frequently where losing a short preview is acceptable; keep authoritative scoring durable. Add client-side payload limits/compaction so a legitimate large drawing does not repeatedly exceed the server cap on reconnect.

### Reusable model

Let `A` = visible authenticated Artist page-hours, `G` = accepted Twitch solves, `C` = successful points commands, `J` = manual adjustments, `D` = committed room drawings, `Q` = room guesses.

```text
Worker HTTP ≈ (480 to 960) × A + joins/auth/initial loads/retries/other APIs
DO requests ≈ (960 to 1,440) × A + 4G + 2C + 5J
              + incoming socket messages / 20 + other DO calls/alarms
Logical puts ≈ 720A + 10G + 4C + 9J + D + Q + lifecycle/import/token writes
```

Examples: 24 Artist page-hours and 2,000 correct guesses yield approximately 37,280 logical puts before other work. Ten thousand correct guesses alone produce 100,000 logical puts under the measured path. **This is a planning warning, not a guaranteed billing threshold.** Request, write, duration and value-size limits must all be satisfied; optimizing one does not reset the others.

## 5. Persistent data can hit the single-value ceiling first

Channel `points` is one value containing current standings, up to 5,000 ledger entries, up to 260 weekly archives, active hosted sessions and up to 200 session-history records. Participant counts are not globally bounded. Weekly reset changes standings but does not delete retained history. Legacy originals/backups also occupy storage.

Synthetic JSON sizes from the harness, with a full 5,000-entry ledger and no large hosted-session history:

| Participants each week | Archived weeks | Points JSON size |
| ---: | ---: | ---: |
| 100 | 20 | 1.41 MB |
| 1,000 | 20 | 2.44 MB |
| 1,000 | 52 | 4.17 MB |
| 5,000 | 20 | 7.06 MB |

These are JSON byte sizes, not Cloudflare's exact structured-clone encoding. The exact failure threshold needs a real storage-runtime boundary test. Nevertheless, the design can outgrow a single value well before the account reaches 5 GB. The documented combined key/value ceiling is 2 MB. [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

Fix: normalize into bounded records/tables for channel/week/player scores, hosted-session participants, rewards and scoring events; index leaderboard queries; paginate history and archive/export under a defined retention policy. Indexes themselves add write costs, so measure the chosen schema. Keep a tested, recoverable migration. Do not discard unfulfilled rewards or deduplication safety just to trim storage.

## 6. Asset audit

Local inventory: **6,005 files, 3,535,351,957 bytes (3.54 decimal GB)** across the two upload roots. The historical successful-upload manifest has the same count/bytes, last entry August 9. This is evidence of what was uploaded then, not proof of today's bucket occupancy.

Of this, Auto Draw PNGs account for about 3.48 GB. Examples still referenced by the catalog:

- `valorant/maps/basic-training.png`: 72,897,954 bytes.
- `valorant/maps/the-range-2.png`: 72,897,954 bytes.
- `arc-raiders/maps/the-blue-gate-thebluegate.png`: 43,722,117 bytes.

At a constant 3.54 GB with no other objects/buckets, storage would use about 35% of the R2 free storage allowance. New art, duplicate versions, backups and unrelated buckets consume the rest. The large PNGs are particularly bad for user downloads, decoded browser memory and round-start latency even though R2 transfer has no egress charge.

Auto Draw loads the selected image plus a reusable cloud sprite; I did not find a loop fetching the entire art library on every visit. Its catalog metadata is eagerly bundled. The existing ordinary local build contains a 1.26 MB JS bundle and the full 3.5 GB public tree. `build:cloudflare` correctly disables public copying; accidentally uploading the ordinary build encounters oversized Pages assets. This review did not rebuild or overwrite `dist`.

`VITE_ASSET_BASE_URL` is an `r2.dev` URL. Cloudflare labels that endpoint development-only and rate-limits it; production caching/access controls require a connected custom domain. There is no defensible fixed production RPS budget for this development URL in the cited page. [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/).

Recommendations:

1. Produce display-size WebP/AVIF runtime assets, retain source originals outside the public runtime upload set, and establish a per-file byte budget. Keep visual quality checked; do not blindly recompress originals.
2. Use a properly connected R2 custom domain/cache policy, or evaluate a compact optimized Pages-hosted asset set. Do not CNAME to `r2.dev` as a shortcut.
3. Keep versioned/hashed URLs and immutable caching. The uploader already sets a one-year cache header, but a reused filename is not content versioning. Its completion log skips already-seen keys, so changed files under the same key also need a content-aware upload strategy.
4. Upload an explicit runtime manifest, not every file recursively; the uploader currently has no runtime-only filter.
5. Lazy-load mode/catalog code where practical. This improves startup rather than directly fixing the DO quota.

R2 read examples: 10,000 visits × 30 uncached object fetches = 300,000 Class B operations/month; 100,000 visits × 100 = 10 million. Browser/CDN cache hits reduce origin GETs; HEAD/revalidation and cache misses add operations. These assumptions must be validated with bucket metrics. Uploading 6,005 objects once is small; needless whole-library uploads and old-version retention are avoidable.

## 7. Public traffic and failure recovery need budgets

| Exposure | Code evidence | Required control |
| --- | --- | --- |
| Idle sockets can pin objects without gameplay | Session/room sockets accepted before useful work or room join | Admission limits, identity validation before expensive allocation, idle socket timeout, bounded concurrent rooms/sessions |
| Repeated matchmaking/room creation | Matchmaker's 1.5-second cooldown uses client-generated session keys; public group is client-selectable | Server-enforced admission/rate limits across identities; allowlisted queues; creation caps |
| Reserved public seats never connect | `reservePublicSeat` persists a seat without a reservation-expiry alarm | Short reservation TTL, persistent cleanup, reclaim empty lobbies |
| Disconnect cleanup depends on memory | 30-second `setTimeout`; normal last-player removal deletes the room, but no general orphan sweep | Alarm-based deadlines and idle/finished-room TTL |
| Anonymous word-pack writes | One shared catalog object; validation/edit tokens exist but creation has no app-wide budget | Request-size caps before JSON parsing; create/report throttles; storage/retention policy |
| Connection failure retries | Session reconnect every 2 sec; room retry capped at 5 sec; Twitch reconnect 3 sec | Jittered exponential backoff, retry budget, offline pause and friendly capacity screen |
| Verbose chat logging | Every incoming Twitch message logged with text; several command lifecycle logs | Configurable diagnostics, sampled aggregate metrics, redact private content/tokens |

For scale: 100 failing session sockets retrying once every two seconds offer about **180,000 upgrade attempts/hour**. Two subscriptions per page can double offered retries. This is offered traffic, not a claim that Cloudflare accepts/bills every attempt after exhaustion.

CORS currently reflects origins. Restricting it and validating WebSocket origins helps browser abuse, but CORS is not authentication or a complete bot defense. Application-level rejection still uses Worker/DO capacity; use appropriate edge protection where available, plus server-side admission. Dashboard WAF/bot rules were not inspected, so their presence/absence is unknown.

Public start/vote/idle deadlines should be server-controlled, not dependent on a particular client remaining open. That improves reliability and bounds how long unfinished rooms stay alive. Existing room message limits are useful but are not a global concurrent-room cap.

An incidental correctness defect: `reportPack` calculates `reportKeyHash` but writes undefined `reporterKeyHash` (`index.js:488`). First reports can fail instead of being stored. Flagged only; not fixed in this audit.

## 8. Prioritized work before public testing

1. **Stop unnecessary active objects:** guest/home-page socket gating; shared per-browser subscription; explicit Twitch chat demand/lifecycle. Highest immediate quota benefit.
2. **Make reads cheap:** remove unchanged writes, combine snapshots, trim polling/preflights/history payloads. Return score results from one transaction instead of refetching three times.
3. **Bound public demand:** concurrent admission caps, room reservations/idle expiry, creation throttles, payload caps, reconnect backoff and a capacity UI. Preserve existing host/drawer protections.
4. **Refactor room lifecycle:** hibernating sockets and durable deadlines, then measure idle versus busy rooms.
5. **Split channel storage:** bounded indexed records with a safe migration, pagination and reward-aware retention.
6. **Prepare production asset delivery:** optimized runtime images and production-safe caching/domain, validate upload/build pipeline.
7. **Measure and set release limits:** real usage telemetry, controlled workload tests and a written daily budget. Do not call the capacity issue solved on the basis of a successful build or local bot demo.

A starting engineering budget is to target at most 50% of each daily allowance in a representative test, retaining headroom for bursts, retries and other apps. This is a proposed operating policy, not Cloudflare's rule. Do not install a new always-active global monitoring DO just to monitor quota; use platform analytics and sampled/batched counters.

## 9. Verification needed to finish operational capacity planning

Capture account-wide and Findraw-specific baselines, then run a small controlled test on an isolated staging setup without real reward data:

- Worker requests, errors, CPU p50/p95/p99 and preflight share.
- DO active duration by class; raw WebSocket messages versus billed-equivalent requests; storage rows read/written and stored bytes.
- R2 stored bytes, Class A/B operations, cache hit ratio and largest/most-requested objects.
- Logs enablement, sampling, retention and daily event consumption.
- Other applications using the same allowances; actual Workers/R2 billing configuration.

Test a guest home page, authenticated idle Artist, guest 2/8/16-player rooms, continuous versus bursty drawing, busy Twitch chat with known correct-guess counts, two browsers on one channel, multiple channels, duplicate events, reconnect storms, abandoned reservations and room cleanup. Check calendar/week rollover, large-history records, transaction failure and exactly-once rewards/scoring. Use staged load with a hard stop below remaining quotas; do not stress-test the production free account into an outage.

Acceptance examples: guest home idle produces no persistent session duration; ordinary summary reads produce no writes; one browser does not create duplicate event subscriptions; dormant rooms sleep/expire; retries taper off; score writes stay atomic; error states do not falsely acknowledge persisted rewards. Compare measured per-unit usage with the formulas above and publish conservative caps based on the smallest remaining allowance.

**Bottom line:** optimize and bound the current candidate before a broad public test. The biggest near-term savings are available without removing working features, but a sustained multi-streamer/multi-room service cannot be promised to fit the free tier indefinitely. If measured demand exceeds the optimized budget, the choice is explicit usage caps or a separately approved paid capacity plan—not hoping quotas reset before users notice.
