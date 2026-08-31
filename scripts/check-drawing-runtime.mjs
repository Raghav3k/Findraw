// Exercises the actual browser transport against a separate local Cloudflare runtime.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import WebSocket from "ws";
import { drawingDelta, applyDrawingDelta } from "../shared/drawingDelta.mjs";
const base = process.env.FINDRAW_TEST_URL || "http://127.0.0.1:8793";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error("Only an isolated local runtime is allowed.");
const peers = [], sockets = [], packets = [], errors = [];
class RecordedSocket extends WebSocket {
  constructor(url) { super(url); sockets.push(this); }
  send(data) { packets.push(JSON.parse(String(data))); super.send(data); }
}
const code = ts.transpileModule(fs.readFileSync("src/room/onlineRoomClient.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {}, require: (id) => id.includes("drawingDelta") ? { drawingDelta, applyDrawingDelta } : { apiWebSocketUrl: (path) => `${base.replace("http", "ws")}${path}?client=runtime-browser-session-123456789` }, WebSocket: RecordedSocket, crypto, structuredClone, window: { setTimeout, clearTimeout } };
vm.runInNewContext(code, context);
const until = async (check, label, timeout = 12000) => {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() > deadline) throw new Error(`Timed out: ${label}; ${errors.join("; ")}`); await new Promise((resolve) => setTimeout(resolve, 25)); }
};
const stroke = (x) => ({ type: "fill", x, y: 2, color: "#123456", opacity: 100 });
try {
  const suffix = Date.now().toString(36);
  for (const n of [1, 2]) {
    const id = `delta-${suffix}-${n}`;
    const token = `${id}-long-reconnect-token`;
    const response = await fetch(`${base}/api/matchmaking/join`, { method: "POST", headers: { "Content-Type": "application/json", "X-Findraw-Session": `${id}-browser-session-long` }, body: JSON.stringify({ clientId: id, name: id, reconnectToken: token }) });
    assert.equal(response.status, 200, await response.clone().text());
    const match = await response.json();
    const peer = { id, preview: null, state: null };
    peer.client = context.exports.connectOnlineRoom(match.code, id, token, id, { onState: (state) => { peer.state = state; }, onDrawingPreview: (preview) => { peer.preview = preview; }, onStatus() {}, onError: (error) => errors.push(error) });
    peers.push(peer);
  }
  await until(() => peers.every((peer) => peer.state?.phase === "choosing"), "server auto-start");
  const drawer = peers.find((peer) => peer.id === peer.state.drawerId);
  const viewer = peers.find((peer) => peer !== drawer);
  viewer.client.sendChoiceVote(0);
  await until(() => peers.every((peer) => peer.state?.phase === "drawing"), "word vote");
  const preview = { type: "brush", style: "marker", points: [[1, 1, 0.5], [2, 2, 0.5]], color: "#123456", opacity: 100, strokeWidth: 8, complete: false };
  drawer.client.sendDrawingPreview(preview);
  await until(() => viewer.preview?.type === "brush", "live preview before any committed drawing");
  assert.equal(viewer.state.drawingOperations.length, 0);
  for (let i = 1; i <= 10; i++) drawer.client.sendDrawingOperations(Array.from({ length: i }, (_, x) => stroke(x)));
  drawer.client.sendDrawingPreview(null);
  await until(() => viewer.state.drawingOperations.length === 10 && !viewer.preview, "coalesced durable batch and preview replacement");
  const firstCount = packets.filter((packet) => packet.type === "drawing-delta").length;
  assert.equal(firstCount, 1, "ten immediate canvas callbacks produce one batch");
  drawer.client.sendDrawingOperations([...viewer.state.drawingOperations, stroke(10)]);
  await until(() => viewer.state.drawingOperations.length === 11, "append");
  assert.equal(packets.filter((packet) => packet.type === "drawing-delta").at(-1).payload.delta.operations.length, 1);
  drawer.client.sendDrawingOperations(viewer.state.drawingOperations.slice(0, 10));
  await until(() => viewer.state.drawingOperations.length === 10, "undo");
  drawer.client.sendDrawingOperations([...viewer.state.drawingOperations, stroke(10)]);
  await until(() => viewer.state.drawingOperations.length === 11, "redo");
  const viewerSocket = sockets.find((socket) => socket.readyState === WebSocket.OPEN && sockets.indexOf(socket) === peers.indexOf(viewer));
  viewerSocket.close();
  const initialSockets = sockets.length;
  await until(() => sockets.length > initialSockets, "reconnect socket");
  await until(() => packets.filter((packet) => packet.type === "join").length >= 3 && sockets.at(-1).readyState === WebSocket.OPEN, "rejoin");
  drawer.client.sendDrawingOperations([]);
  await until(() => viewer.state.drawingOperations.length === 0, "clear after reconnect");
  assert.equal(packets.filter((packet) => packet.type === "drawing-sync").length, 0, "modern clients never upload full-canvas syncs");
  assert.deepEqual(errors, []);
  console.log("Drawing runtime checks passed: actual browser client, live preview, ten-to-one batching, append/undo/redo/clear deltas and reconnect.");
} finally { for (const peer of peers) peer.client.close(); }
