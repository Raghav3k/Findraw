import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { drawingDelta, applyDrawingDelta } from "../shared/drawingDelta.mjs";
import { DurableDrawing, DRAWING_CHECKPOINT_KEY, DRAWING_JOURNAL_KEY } from "../shared/durableDrawing.mjs";
import { FindrawRoom } from "../cloudflare/backend/src/index.js";

const stroke = (x) => ({ type: "fill", x, y: 2, color: "#123456", opacity: 100 });
for (const [before, after] of [[[], [stroke(1)]], [[stroke(1), stroke(2)], [stroke(1)]], [[stroke(1)], []], [[stroke(1)], [stroke(1), stroke(2)]], [[stroke(1), stroke(2), stroke(3)], [stroke(1), stroke(4), stroke(3)]]]) {
  assert.deepEqual(applyDrawingDelta(before, drawingDelta(before, after)), after);
}
assert.equal(drawingDelta([stroke(1)], [{ opacity: 100, color: "#123456", y: 2, x: 1, type: "fill" }]).operations.length, 0, "property order is not a drawing change");
for (const delta of [{ index: -1, deleteCount: 0, operations: [] }, { index: 0, deleteCount: 2, operations: [] }, { index: 0.5, deleteCount: 0, operations: [] }]) assert.throws(() => applyDrawingDelta([], delta));

function storage(initial = new Map()) {
  let values = structuredClone(initial);
  return {
    writes: [], fail: false,
    async get(key) { return structuredClone(values.get(key)); },
    async put(key, value) { if (this.fail) throw new Error("write failed"); this.writes.push(key); values.set(key, structuredClone(value)); },
    async delete(key) { if (this.fail) throw new Error("delete failed"); this.writes.push(key); values.delete(key); },
    async transaction(fn) {
      const draft = storage(values); draft.fail = this.fail;
      await fn(draft);
      values = draft.snapshot(); this.writes.push(...draft.writes);
    },
    snapshot() { return structuredClone(values); },
  };
}
const db = storage();
let drawing = new DurableDrawing(db);
await drawing.load();
await drawing.reset([], "round-one");
db.writes = [];
for (let i = 0; i < 70; i++) {
  await drawing.commit([...drawing.operations, stroke(i)]);
  const restored = new DurableDrawing(db); await restored.load();
  assert.deepEqual(restored.operations, drawing.operations, `restore batch ${i}`);
  assert.equal(restored.revision, i + 1);
  drawing = restored;
}
assert.equal(db.writes.filter((key) => key === DRAWING_CHECKPOINT_KEY).length, 2, "70 batches only need two full checkpoints");
assert.ok((await db.get(DRAWING_JOURNAL_KEY)).entries.length < 32);
db.writes = [];
assert.equal(await drawing.commit(drawing.operations), null);
assert.equal(db.writes.length, 0, "identical drawing does not write or advance revision");
const beforeFailure = structuredClone(drawing.operations);
db.fail = true;
await assert.rejects(drawing.commit([...beforeFailure, stroke(99)]), /write failed/);
assert.deepEqual(drawing.operations, beforeFailure, "failed persistence never becomes an accepted drawing");
await assert.rejects(drawing.reset([], "new-round"), /write failed/);
assert.equal(drawing.epoch, "round-one");
db.fail = false;
await drawing.commit([]);
drawing = new DurableDrawing(db); await drawing.load();
assert.deepEqual(drawing.operations, [], "clear survives restart");
await drawing.commit(beforeFailure);
await drawing.reset([], "round-two");
drawing = new DurableDrawing(db); await drawing.load();
assert.equal(drawing.epoch, "round-two"); assert.equal(drawing.revision, 0);
assert.deepEqual(drawing.operations, [], "old journal does not bleed into next round");
const legacyDb = storage(new Map([[DRAWING_CHECKPOINT_KEY, [stroke(7)]]]));
const legacy = new DurableDrawing(legacyDb);
await legacy.load(); assert.deepEqual(legacy.operations, [stroke(7)]);
await legacy.commit([stroke(7), stroke(8)]);
const migrated = new DurableDrawing(legacyDb); await migrated.load();
assert.deepEqual(migrated.operations, [stroke(7), stroke(8)], "first legacy edit persists an epoch before journaling");

const roomDb = storage();
const server = new FindrawRoom({ storage: roomDb }, {}); await server.ready;
await server.drawing.reset([], "protected-round");
server.room = { phase: "drawing", drawerId: "owner", turnIndex: 0, drawingOperations: [] };
const peer = (id, version) => {
  const result = { messages: [], send(text) { this.messages.push(JSON.parse(text)); }, serializeAttachment() {} };
  server.clients.set(result, { id, name: id, protocolVersion: version }); return result;
};
const owner = peer("owner", 3), viewer = peer("viewer", 3), oldViewer = peer("old", 2);
const edit = { mutationId: "edit-1", epoch: "protected-round", baseRevision: 0, delta: { index: 0, deleteCount: 0, operations: [stroke(1)] } };
await assert.rejects(server.handleSocketMessage(viewer, JSON.stringify({ type: "drawing-delta", payload: edit })), /Only the drawer/);
await server.acceptDrawingDelta(owner, edit);
assert.equal(server.drawing.revision, 1);
assert.equal(owner.messages.at(-1).type, "drawing-ack");
assert.equal(viewer.messages.at(-1).type, "drawing-delta");
assert.equal(oldViewer.messages.at(-1).type, "drawing-committed", "older clients still get compatible snapshots");
roomDb.writes = [];
await server.acceptDrawingDelta(owner, edit);
assert.equal(server.drawing.revision, 1);
assert.equal(roomDb.writes.length, 0, "duplicate base revision never writes twice");
assert.equal(owner.messages.at(-1).type, "drawing-snapshot");
await server.acceptDrawingDelta(owner, { ...edit, epoch: "previous-round", baseRevision: 1 });
assert.equal(roomDb.writes.length, 0, "old rounds cannot modify the current drawing");
roomDb.fail = true;
const messageCount = owner.messages.length;
await assert.rejects(server.acceptDrawingDelta(owner, { ...edit, baseRevision: 1, delta: { index: 1, deleteCount: 0, operations: [stroke(2)] } }), /write failed/);
assert.equal(owner.messages.length, messageCount, "no success acknowledgement is sent before durable storage");
assert.equal(server.drawing.revision, 1);

// Exercise the actual TypeScript client with deterministic sockets/timers.
const source = fs.readFileSync("src/room/onlineRoomClient.ts", "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let now = 0, timerId = 0;
const timers = new Map(), sockets = [];
const later = (fn, delay) => { timers.set(++timerId, { at: now + Math.max(0, delay), fn }); return timerId; };
const advance = (ms) => {
  const end = now + ms;
  while (true) {
    const [id, next] = [...timers].filter(([, entry]) => entry.at <= end).sort((a, b) => a[1].at - b[1].at)[0] || [];
    if (!next) break;
    now = next.at; timers.delete(id); next.fn();
  }
  now = end;
};
class Socket {
  static OPEN = 1;
  constructor() { this.listeners = {}; this.sent = []; this.readyState = 0; sockets.push(this); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, event) { for (const fn of this.listeners[name] || []) fn(event); }
  receive(message) { this.emit("message", { data: JSON.stringify(message) }); }
  send(message) { this.sent.push(JSON.parse(message)); }
  close() { this.readyState = 3; this.emit("close", { code: 1000 }); }
}
const context = { exports: {}, require: (id) => id.includes("drawingDelta") ? { drawingDelta, applyDrawingDelta } : id.includes("browserSecurity") ? { ensureHuman: async () => {} } : { apiWebSocketUrl: () => "ws://test" }, WebSocket: Socket, crypto, structuredClone, Date: class extends Date { static now() { return now; } }, window: { setTimeout: later, clearTimeout: (id) => timers.delete(id) } };
vm.runInNewContext(code, context);
const states = [], errors = [];
const client = context.exports.connectOnlineRoom("ABC234", "drawer", "token", "Drawer", { onState: (state) => states.push(state), onDrawingPreview() {}, onStatus() {}, onError: (message) => errors.push(message) });
await new Promise(setImmediate);
const ws = sockets[0]; ws.readyState = 1; ws.emit("open");
ws.receive({ type: "hello", payload: { drawingProtocol: 3 } });
const room = { phase: "drawing", drawerId: "drawer", drawingEpoch: "epoch", drawingRevision: 0, drawingOperations: [], turnIndex: 0 };
ws.receive({ type: "room-state", payload: room });
for (let i = 1; i <= 10; i++) client.sendDrawingOperations(Array.from({ length: i }, (_, index) => stroke(index)));
advance(100);
const changes = () => ws.sent.filter((entry) => entry.type === "drawing-delta");
assert.equal(changes().length, 1, "ten rapid edits become one batch/write");
const first = changes()[0].payload;
assert.equal(first.delta.operations.length, 10);
client.sendDrawingOperations([...first.delta.operations, stroke(10)]);
advance(1000); assert.equal(changes().length, 1, "backpressure allows only one unacknowledged batch");
ws.receive({ type: "drawing-delta", payload: { epoch: "epoch", baseRevision: 0, revision: 1, delta: first.delta } });
ws.receive({ type: "drawing-ack", payload: { mutationId: first.mutationId, epoch: "epoch", revision: 1 } });
advance(100);
const second = changes()[1].payload;
assert.equal(second.delta.operations.length, 1, "next batch sends only the new operation");
assert.equal(second.delta.index, 10);
ws.receive({ type: "drawing-delta", payload: { epoch: "epoch", baseRevision: 1, revision: 2, delta: second.delta } });
ws.receive({ type: "drawing-ack", payload: { mutationId: second.mutationId, epoch: "epoch", revision: 2 } });
client.sendDrawingOperations([]); advance(300);
const clear = changes().at(-1).payload;
assert.equal(clear.delta.operations.length, 0); assert.equal(clear.delta.deleteCount, 11);
ws.receive({ type: "drawing-snapshot", payload: { epoch: "epoch", revision: 2, operations: [...first.delta.operations, stroke(10)], mutationId: clear.mutationId, retryAfterMs: 1000 } });
const count = changes().length; advance(999); assert.equal(changes().length, count);
advance(1); assert.equal(changes().length, count + 1, "rate limited updates retry rather than silently disappear");
ws.receive({ type: "room-state", payload: { ...room, drawingEpoch: "next-round", drawingRevision: 0 } });
advance(6000); assert.equal(ws.readyState, 1, "turn reset cancels old acknowledgements and queued edits");
client.close(); assert.equal(timers.size, 0);
assert.equal(errors.length, 0);
console.log("Drawing delta checks passed: splice semantics, durable replay/checkpoints, failure safety, old storage, coalescing, backpressure, clear, throttled retry and turn reset.");
