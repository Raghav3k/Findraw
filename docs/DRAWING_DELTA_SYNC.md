# Drawing deltas and durable batching

Implemented in the actual Cloudflare room server and browser room client. No
deployment or live-data changes were performed during implementation.

## Network protocol (v3)

- The server advertises `drawingProtocol: 3`. Modern clients send a splice
  (`index`, `deleteCount`, changed `operations`) against an epoch and base revision.
  Append, undo, redo, middle edits and clear use the same operation.
- Epochs identify a drawing round independently of its turn index, which can repeat
  in another game. The server checks drawer permission, shape, size, rate limits
  and revision before accepting edits. Existing drawing sanitization still applies.
- Canonical deltas are broadcast to v3 clients. v2 clients retain committed full
  drawing events; v1 clients retain room snapshots. A new client talking to an older
  server falls back to its old full-sync protocol.
- Full snapshots are used for initial join/reconnect and revision mismatch recovery,
  not for every normal stroke. Duplicate/stale revisions cannot apply an edit twice.
- The browser coalesces edits for 100 ms, spaces batches at least 300 ms apart, and
  permits only one unacknowledged batch. Changes during that wait are retained as
  the latest desired drawing. Rate-limited edits receive a retryable snapshot instead
  of being silently dropped. An acknowledgement timeout reconnects for recovery.
- Live previews still travel while the pointer moves (existing ~50 ms throttle).
  Released previews remain briefly visible until the committed batch replaces them;
  preview IDs prevent an older commit from clearing a newer in-progress stroke.

These are **operation/stroke deltas**, not pixel diffs. Editing an unfinished stroke
can resend that stroke's point list, but does not require resending previous strokes.

## Persistence and recovery

- `room:drawingOperations` stores an epoch/revision/full-checkpoint envelope.
- `room:drawingJournal` stores the bounded list of changes since that checkpoint.
  A normal accepted batch updates one journal key, not the whole canvas or room.
- At 32 batches or 64 KiB of journal data, a transaction replaces the checkpoint
  and removes the journal. Full checkpoints are occasional, not per-stroke.
- Acknowledgements and broadcasts follow successful persistence. There is no
  unflushed acknowledged drawing kept only in memory, and no periodic drawing timer
  that prevents idle room hibernation.
- Loading a room replays its checkpoint and journal. Old array-based checkpoints
  and embedded drawings migrate before journaling. New-round resets replace the
  checkpoint, journal and room metadata transactionally.
- Identical updates write nothing. Rapid edits can share one durable batch; normal
  isolated strokes still need a durable write. Compaction adds checkpoint/deletion
  work, so this is a reduction strategy, not a claim of zero or mathematically minimal
  database writes. Closing a page before its latest batch is acknowledged can still
  lose those unacknowledged local edits.

The checkpoint format changes: after deploying and migrating rooms, do not roll the
Worker back to code that expects only arrays in `room:drawingOperations`. Older
frontends remain supported; storage rollback requires an explicit migration or
forward fix. Empty-room cleanup removes both drawing keys.

## Checks

- `node scripts/check-drawing-deltas.mjs`: splice semantics, semantic equality,
  70-batch restore/compaction, failed writes, legacy migration, duplicate/stale edits,
  drawer authorization, old-client support, batching, backpressure and turn reset.
- `node scripts/check-drawing-runtime.mjs`: actual TypeScript browser transport with
  real WebSockets against an isolated local Wrangler on port 8793. Covers live
  previews before commits, ten rapid edits becoming one batch, append/undo/redo/clear
  deltas and reconnect. Refuses non-local URLs.
- Existing v2 runtime tests remain in `scripts/check-room-runtime.mjs`.
- `pnpm check:production` includes the deterministic delta checks and TypeScript.

Real player load/cost measurement and deployment remain separate release checks.
