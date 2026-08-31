# Channel persistence release (2026-08-30)

## Ownership

- `FindrawSession` remains per browser and stores encrypted Twitch credentials.
- `FindrawChannel`, bound as `FINDRAW_CHANNEL`, is named `channel:<Twitch user ID>`.
  It owns channel points, weekly archives, hosted sessions, rewards and scoring control.
- The session gateway obtains the channel ID from its validated Twitch identity.
  A browser-supplied channel ID cannot choose or modify someone else's channel.
- Channel operations use an explicit allowlist and run serially inside a Durable
  Object storage transaction. Tokens never enter channel storage or exports.
- The channel class shares the existing points/reward handler implementation with
  the session class, but overrides restoration: it never authenticates or connects
  to Twitch. Public score/reward routes are forwarded to the channel object.

## Behaviour

- The same Twitch account sees the same weekly scores, hosted sessions and reward
  history on a fresh browser/device. Signing out does not erase those records.
- Viewer keys are Twitch user IDs; a subsequent score updates their display name.
- One channel scoring round is active at a time. Controllers in different tabs,
  modes, rooms or browsers must explicitly take over an existing round.
- Takeover preserves points and rewards, ends the prior scoring round, and notifies
  the old browser/room. Private-room hosts can take over through the Twitch panel.
- Abandoned locks expire after 15 minutes. Scores are rejected after expiration.
  Normal rounds should end through the usual UI before that bound.
- Solve acceptance, positional points, hosted-session points and per-round
  duplicate guards commit together. A bounded list of the last 5,000 scoring
  message IDs also prevents recent event replays across restarts/round changes.
- Command replies read the same store and share a channel-wide cooldown so two
  browser connections do not reply twice. Queued replies cannot cross accounts.
- Artist standings refresh from the channel every 15 seconds while visible and
  on returning to the tab. This browser's own scoring still uses live events.
- Simulated scoring rounds do not write real channel or hosted-session points.

## Non-destructive legacy migration

On the first channel access from a browser, the authenticated gateway imports:

1. That channel's records from the retired shared `main` session object.
2. That channel's records from the current browser session object.

The first non-empty source initializes the channel store. Empty reads do not block
a later non-empty import. Each source gets a transactionally stored import receipt,
so retries and new logins do not apply it twice. All exports are filtered by channel.
The old `main` object no longer reconnects its saved Twitch account.

Original browser/main records remain untouched, and imported snapshots are also
backed up inside the channel object. If an additional non-empty source disagrees
with existing records, it is preserved separately and flagged **needs review**.
The system does not add totals together or silently overwrite a current channel.

Open Home's profile menu to see a conflict warning and download preserved records.
These exports contain channel scores/history only, not OAuth tokens or other
channels. Reconciliation of genuinely conflicting histories is deliberately a
manual follow-up after reviewing the exports; this release does not guess a merge.

A browser whose old site identifier was already lost cannot be automatically
discovered by the new gateway. Its orphaned old records require an operator-led
recovery if needed. Future site-data clearing does not affect shared channel records.

## Deployment

1. Preserve `SESSION_SECRET` and the existing OAuth configuration.
2. Run `node scripts/check-channel-persistence.mjs`,
   `node scripts/check-room-lifecycle.mjs`, `pnpm build`, and a Worker dry-run.
3. Deploy the Worker with migration **v5** (`FindrawChannel`), including earlier
   outstanding migrations, then publish the matching frontend.
4. Sign into the same Twitch account from two browser profiles. Verify identical
   standings/history, a takeover conflict, a successful confirmed takeover,
   logout/relogin, a new device, and isolation from a second Twitch account.
5. Inspect the profile's migration status before assuming historical totals were
   merged. Review any preserved legacy exports before resolving conflicts.

Do not roll back to browser-local scoring code after shared-store writes begin:
that would fork channel history again. Keep backups and use a forward fix.

The Express `pnpm dev` launcher remains single-streamer development tooling, with
a channel-keyed local points file. It is not the public multi-user auth server and
must not be used to certify cross-browser OAuth isolation. Automated tests use
isolated synthetic identities and transactional in-memory storage; a real two-account
Cloudflare smoke test is still required after deployment.

Validation in this workspace also exercised the actual local workerd/SQLite runtime
with an isolated synthetic-login fixture: cross-browser reads, concurrent duplicate
guesses, hosted-session points, channel isolation, takeover, logout and history all
passed. Browser QA covered the migration warning/export action and takeover
confirmation. No real OAuth tokens, production records or deployments were used.
