# Findraw security implementation and release checklist

Status: code implemented and locally verified; **not deployed and not a production security certification**.

This checklist supersedes older bearer-session and direct workers.dev setup instructions. Existing Twitch connections must be re-authorized after deployment. Channel scores/rewards are retained; no channel history was deleted by this change.

## The requested 22 items

Checked items below mean implemented and verified in the local production code path. Unchecked items need external configuration or verification, not a fabricated checkmark.

- [x] **1. API and WebSocket authorization.** Public routes have explicit method/body contracts. Channel actions derive the channel from the authenticated Twitch session. Room settings/start/leadership require the host; drawing requires the drawer. Internal DO APIs are not publicly routed. See the role matrix below.
- [x] **2. Server-authoritative gameplay.** Room words, turns, scoring and deadlines are server-owned. Late guesses/drawing are rejected even when an alarm is delayed. Artist-mode owners intentionally retain manual control of their own channel scores/rewards.
- [x] **3. Strict public schemas.** Unknown fields/messages, wrong types, unsafe identifiers, overlong strings/arrays and invalid numeric ranges are rejected. HTTP contracts are in `shared/security.mjs`; nested drawing/word-pack schemas are validated too. Internal binding contracts remain trusted server-to-server calls with ownership/domain checks.
- [x] **4. Endpoint limits.** Native Worker IP limiting before DO routing, plus persistent IP/session admission counters for login, verification, matchmaking, creation, content and writes.
- [x] **5. Per-WebSocket limits.** Overall, join, guess/chat, preview, drawing-commit and control limits. Unjoined messages are limited; reconnecting is also limited at admission. A bounded processing queue prevents unbounded queued work.
- [x] **6. Payload limits before expensive work.** HTTP JSON is streamed with a 128 KiB ceiling before parsing; declared size cannot bypass the streamed check. Room messages are limited to 256 KiB before JSON parsing. Drawing operations/points are bounded. URLs are bounded too.
- [ ] **7. Turnstile live setup.** Widget and server-side Siteverify are implemented; success, hostname, action and session binding are checked. Unit/runtime tests use mocked verification, including failure cases. **Real production keys, allowed hostname and an actual browser challenge must still be configured/verified.** Missing configuration fails closed.
- [x] **8. Room expiry/cleanup.** Unjoined sockets expire after 15 seconds; reserved/disconnected seats after 30 seconds; connected idle lobbies/finished rooms after 20 minutes; rooms have a 12-hour maximum lifetime. Empty rooms clear drawing/room storage. Existing rooms receive an expiry on restoration.
- [x] **9. Concurrent admission caps.** Three rooms per session/account, twelve per IP; eight admitted connections per session/account and sixty-four per IP. Room-local cap: 32 connections, at most two per browser session. Twitch live transports also have a four-per-session cap. Unique connection leases are released on close/leave/rejected upgrade and expire as a fallback. IP limits must be tuned for shared networks; they are not proof of one human per IP.
- [x] **10. Award idempotency.** Existing durable channel-award deduplication and solved-player checks remain. Manual score adjustments now carry a request ID and reuse durable receipt protection inside the channel transaction.
- [x] **11. Secret-word protection.** No selected/recent-choice keys in guesser state. Correct-guess text is replaced on the server; solved players cannot leak it through another ordinary guess. Room-linked Twitch debug output no longer exposes the answer. Results/drawer views can deliberately reveal the answer.
- [x] **12. WebSocket handshake protection.** Allowed Origin and a signed, expiring, server-issued HttpOnly cookie are required before room routing; room admission additionally requires human verification. Reconnect seat tokens remain required after the handshake. URL room code must match the join message.
- [x] **13. Safe text rendering.** React text rendering retained; no arbitrary user HTML introduced. Schemas reject dangerous control/bidirectional characters and limit content. CSP added for production output. This does not claim content moderation can recognize every offensive word.
- [x] **14. Database injection safety.** Structured DO storage operations retained; no user-built SQL. Actual SQLite runtime tests pass.
- [x] **15. Public/private room state.** Explicit allowlist replaces internal-object spreading. New internal fields default to private. Unauthenticated/nonmember HTTP room-state polling is removed; state is delivered through admitted room connections.
- [x] **16. Reconnect backoff.** Room and Twitch browser transports use bounded exponential retry; room retries include jitter and reset after receiving room state rather than just opening a socket. Policy closures stop automatic room retries. Backend Twitch reconnection now backs off with jitter too.
- [x] **17. Abuse logging.** Sampled structured rejection/disconnection logs contain timestamp, action, room where relevant, pseudonymous IP/session hashes and violation counts. Floods do not generate one log per rejected packet. Cookies/tokens/raw request bodies are not logged; ordinary Twitch chat text is excluded from diagnostic logs.
- [x] **18. Temporary sanctions.** Rate throttling/rejection, connection closure after repeated invalid actions, and a room session cooldown. Admission limits continue to apply across reconnects and isolate restarts. This is layered abuse resistance, not a guarantee against distributed botnets.
- [x] **19. Emergency feature switches.** `DISABLE_NEW_ROOMS=1` blocks private creation and public matchmaking; `DISABLE_COMMUNITY_WRITES=1` pauses publishing/editing/report writes. Existing gameplay need not be stopped. Changes require a Worker configuration deployment.
- [ ] **20. Cloudflare dashboard/zone protection.** Worker rate-limit binding and private backend routing are configured in source and dry-run checked. **Actual WAF/Free Managed Rules/Bot Fight Mode/zone rate rules are not inspected or configured.** These depend on a domain/zone you control; don't assume rules on a custom domain cover a separately exposed workers.dev hostname. Bot Fight Mode is not a substitute for message validation.
- [x] **21. Adversarial tests.** Tests cover fake channel/host/drawer actions, duplicate scoring, answer leaks, late actions, malformed settings/messages, oversize bodies, invalid origins, unauthorized room reads, mismatched room codes, cooldowns, OAuth fixation/replay/rotation, expiry, verification failures and admission caps. Production regression tests remain enabled.
- [x] **22. Controlled local abuse test.** A deterministic 200-request test proves rejected traffic avoids session-DO work (195 blocked with a test threshold of five). Another bounded 200-request exercise runs against native workerd rate limiting alongside real SQLite/three-player WebSockets. **This is not a high-concurrency capacity benchmark or a deployed multi-region abuse test.** Repeat in an isolated staging environment before unrestricted public access.

## Additional findings from the audit

- [x] **OAuth session fixation:** initiation state is stored server-side, bound to the signed browser cookie, consumed once, and followed by session rotation. Attacker-chosen `client` URL keys and `X-Findraw-Session` headers cannot select public authenticated sessions.
- [x] **Credential exposure:** production authentication is no longer stored in JavaScript local storage or WebSocket URLs. Cookie flags: HttpOnly, Secure, SameSite=Lax, Path=/, host-only. Seven-day expiry; encrypted session records receive expiry cleanup. The browser reads no session credential.
- [x] **Logout:** calls Twitch's revocation endpoint, clears local credentials, closes old live connections and rotates the browser cookie. If Twitch is unavailable, local logout still succeeds and the UI reports that provider revocation needs manual completion in Twitch Connections. A network outage cannot be honestly marked as successful provider revocation.
- [x] **Account switching and login failures:** old session transports are closed on rotation; callbacks cannot be replayed. Fixed-text friendly failure page provides retry/back links without reflecting OAuth input.
- [x] **Private room access:** public HTTP state reads are denied; admitted members receive filtered state. A private room code remains an invitation secret, not a password-protected-room feature.
- [x] **Attacker-selected object keys:** arbitrary public matchmaking groups are rejected; room URL/join codes are bound together; authenticated session IDs are server-issued.
- [x] **Community publishing/report abuse:** verification and persistent action quotas added. A few reports flag a pack for review instead of automatically unpublishing another creator's content. Owner edit-token checks remain. A full moderator review UI is a future product feature, not implemented here.
- [x] **Browser security headers:** production output includes CSP, frame protection, no-referrer and nosniff; API responses are non-cacheable. Before adding ads, use isolated/sandboxed integrations and review CSP rather than allowing arbitrary scripts site-wide.
- [x] **Dependency audit:** Vite updated from 5.0.12 to 6.4.3; patched PostCSS/nanoid constraints and lockfile installed. Final npm audit reports zero known advisories across 235 dependencies. This is a point-in-time audit, not a guarantee against future advisories.
- [x] **Deployment boundary:** Pages serves `/api/*` and `/auth/*` through a private Worker service binding. Backend workers.dev and preview routes are disabled in configuration. The loopback Node development server remains a separate local-only server and must never be exposed as the production backend. The legacy public Cloudflare SSE endpoint is retired; production uses authenticated WebSockets.

## Authorization matrix

| Surface | Who may use it | Enforcement |
|---|---|---|
| Health | Anyone | Static response, no DO lookup |
| Session bootstrap | Allowed-origin browser | Native IP limiter; server-issued cookie |
| Verification | Valid browser session | Body schema, IP/session quota, server-side Siteverify |
| OAuth start/callback | Same initiating browser | Cookie, expiring signed state, stored one-use transaction, rotation |
| Twitch identity/debug/live/logout | Own browser session; Twitch auth for live | Cookie routes to own session; no browser-selected authenticated key |
| Leaderboards/reward/score/round APIs | Connected streamer, own channel only | Server-validated Twitch identity; private channel binding; transaction/ownership checks |
| Manual score corrections | Same streamer | Bounded delta and request-ID deduplication |
| Community read | Browser session with share code | Bounded path, published-state check |
| Community creation/report | Human-verified browser | IP/session action quotas and strict schemas |
| Community edit | Above plus owner edit token | Hashed token comparison |
| Public matchmaking | Human-verified browser | Fixed group, admission quotas, server-managed room defaults |
| Private room creation | Human-verified browser | Admission/creation quota, new-room switch, room code binding |
| Room join/reconnect | Admitted browser with room code and own seat token | Cookie, human proof, leases, capacity, token hash |
| Room settings/start/leader/takeover | Current host | Server role check; public rooms reject host custom settings |
| Drawing preview/sync/delta | Current drawer during active turn | Server role/phase/deadline, schema, bounds, revision checks |
| Guess/vote | Eligible current room member | Server identity, phase/deadline, solved-player/choice checks |
| Internal channel/session/matchmaker actions | Private service/DO binding only | No public gateway route |

## Deployment gates — do not skip

- [ ] In Pages, add service binding **FINDRAW_BACKEND → findraw-backend** for the intended environment. The build generates `_worker.js` and `_routes.json` so static assets remain static.
- [ ] Register **https://findraw.pages.dev/auth/twitch/callback** in Twitch Developer Console (or the exact custom frontend origin if changed). Update `FRONTEND_URL` and `TWITCH_REDIRECT_URI` together. Keep localhost redirects only for intentional local development.
- [ ] Create a production Turnstile widget for the frontend hostname. Set Worker `TURNSTILE_SITE_KEY` and secret `TURNSTILE_SECRET_KEY`. Keep `SESSION_SECRET` and Twitch secrets server-side. Do not use dummy test keys for production.
- [ ] Deploy backend migration **v6-security** and the matching frontend together during a controlled maintenance window. Old frontend bearer credentials intentionally stop working. Do not deploy only one half of this authentication migration.
- [ ] Verify backend workers.dev/preview/other routes are not an alternate public entry; verify the Pages proxy and actual CF-Connecting-IP behavior online.
- [ ] Reconnect Twitch and test login/logout/account switch with two real browsers/accounts, then a private room and a public match. Test a real Turnstile challenge and an expired/failed challenge. Inspect browser console for CSP issues with existing asset/embed hosts.
- [ ] Inspect/configure available zone WAF rules for the production custom domain; test that security challenges do not break OAuth, API calls or WebSocket upgrades.
- [ ] Run a bounded staging abuse/load test with measured Worker/DO requests, CPU, storage and logs; tune shared-IP limits for your expected audience. Configure usage alerts and test both emergency switches. Native edge limiting is deliberately backed by persistent admission limits, not treated as a globally exact accounting counter.

## Verification commands

```powershell
pnpm check:production
pnpm check:security
pnpm build:cloudflare
pnpm audit --json
node scripts/check-security-runtime.mjs C:/Users/bonam/AppData/Roaming/npm/node_modules/wrangler/package.json
# From cloudflare/backend (dry run only):
wrangler deploy --dry-run --outdir ../../node_modules/.cache/findraw-security-build
```

The runtime script blocks external services and uses mock Siteverify, three synthetic players, isolated SQLite and hibernating WebSockets. It does not use production tokens or write production data. Older direct-bearer HTTP runtime scripts are not evidence for the new cookie boundary; use the new security runtime script for this migration.

Build warning still present: the main JS chunk is over 500 KiB. It is a performance follow-up, not a failed security test.
