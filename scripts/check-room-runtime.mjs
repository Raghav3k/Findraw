// Run against a separate local wrangler runtime, never against production.
import assert from "node:assert/strict";
import WebSocket from "ws";
const base = process.env.FINDRAW_TEST_URL || "http://127.0.0.1:8793";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error("Only a local test runtime is allowed.");
const peers = [];
async function match(id) {
  const response = await fetch(`${base}/api/matchmaking/join`, { method: "POST", headers: { "Content-Type": "application/json", "X-Findraw-Session": `${id}-browser-session-long-enough` }, body: JSON.stringify({ clientId: id, name: id, reconnectToken: `${id}-reconnect-token-long-enough` }) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
function join(code, id) {
  const messages = [];
  const ws = new WebSocket(`${base.replace("http", "ws")}/api/room/${code}/live?client=${id}-browser-session-long-enough`);
  const peer = { ws, messages };
  peers.push(peer);
  ws.on("message", (data) => messages.push(JSON.parse(data)));
  ws.on("open", () => ws.send(JSON.stringify({ type: "join", payload: { code, clientId: id, name: id, reconnectToken: `${id}-reconnect-token-long-enough`, protocolVersion: 2 } })));
  return peer;
}
async function until(check, label, timeout = 12000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
const latest = (peer) => peer.messages.filter((event) => event.type === "room-state").at(-1)?.payload;
try {
  const suffix = Date.now().toString(36);
  const oneId = `first-${suffix}`, twoId = `second-${suffix}`;
  const oneMatch = await match(oneId), twoMatch = await match(twoId);
  assert.equal(oneMatch.code, twoMatch.code);
  const one = join(oneMatch.code, oneId), two = join(twoMatch.code, twoId);
  await until(() => latest(one)?.players.length === 2 && latest(two)?.players.length === 2, "two joined players");
  await until(() => latest(two)?.phase === "choosing", "server public start");
  const voter = latest(one).drawerId === oneId ? two : one;
  const drawer = voter === two ? one : two;
  voter.ws.send(JSON.stringify({ type: "choice-vote", payload: { choiceIndex: 0 } }));
  await until(() => latest(drawer)?.phase === "drawing", "drawing turn");
  assert.equal(latest(voter).answer.answer, null, "guesser must not receive the secret");
  drawer.ws.send(JSON.stringify({ type: "drawing-sync", payload: { operations: [{ type: "fill", x: 2, y: 2, color: "#123456", opacity: 100 }] } }));
  await until(() => voter.messages.some((event) => event.type === "drawing-committed"), "committed drawing relay");
  voter.ws.send(JSON.stringify({ type: "guess", payload: { text: "a wrong guess" } }));
  await until(() => latest(drawer)?.guesses.length > 0, "guess relay");
  const voterId = voter === one ? oneId : twoId;
  voter.ws.close();
  await until(() => voter.ws.readyState === WebSocket.CLOSED, "disconnect");
  const rejoined = join(oneMatch.code, voterId);
  await until(() => latest(rejoined)?.drawingOperations?.length === 1, "reconnect drawing snapshot");
  assert.equal(latest(rejoined).players.filter((player) => player.id === voterId).length, 1);
  rejoined.ws.send(JSON.stringify({ type: "guess", payload: { text: latest(drawer).answer.answer } }));
  await until(() => latest(drawer)?.phase === "results", "correct guess ends turn");
  assert.ok(latest(drawer).players.find((player) => player.id === voterId).score >= 100);
  assert.equal(peers.flatMap((peer) => peer.messages).filter((event) => event.type === "error").length, 0);
  console.log("Cloudflare runtime checks passed: matchmaking, real WebSockets, server start, voting, drawing, hidden answer, guessing and reconnect snapshot.");
} finally { for (const peer of peers) peer.ws.close(); }
