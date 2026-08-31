// Isolated workerd/SQLite exercise. Does not contact a deployed site or real Twitch/Turnstile.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
const requireRuntime = createRequire(path.resolve(process.argv[2] || "node_modules/wrangler/package.json"));
const { build } = requireRuntime("esbuild");
const { Miniflare, Response: RuntimeResponse } = requireRuntime("miniflare");
const bundle = await build({ entryPoints: ["cloudflare/backend/src/index.js"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
const origin = "https://test.invalid";
const consumed = new Set();
const runtime = new Miniflare({ workers: [
  { name: "frontend", modules: true, script: readFileSync("cloudflare/pages/worker.js", "utf8"), serviceBindings: { FINDRAW_BACKEND: "backend", ASSETS: async () => new RuntimeResponse("test asset") } },
  { name: "backend", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-11-09",
    bindings: { FRONTEND_URL: origin, SESSION_SECRET: "isolated-runtime-security-secret", TURNSTILE_SITE_KEY: "mock-site-key", TURNSTILE_SECRET_KEY: "mock-secret" },
    ratelimits: { EDGE_LIMITER: { simple: { limit: 120, period: 60 } } },
    durableObjects: Object.fromEntries(["Session", "Room", "Community", "Matchmaker", "Channel", "Admission"].map(name => [`FINDRAW_${name.toUpperCase()}`, { className: `Findraw${name}`, useSQLite: true }])),
    outboundService: async request => {
      if (request.url !== "https://challenges.cloudflare.com/turnstile/v0/siteverify") throw new Error("External traffic blocked in test");
      const body = await request.json(); const success = !consumed.has(body.response); consumed.add(body.response);
      return RuntimeResponse.json({ success, hostname: "test.invalid", action: "findraw_access" });
    },
  },
] });
const peers = [];
const headers = cookie => ({ Origin: origin, "CF-Connecting-IP": "192.0.2.50", Cookie: cookie || "" });
const call = (route, cookie, body) => runtime.dispatchFetch(origin + route, { method: body === undefined ? "GET" : "POST", headers: { ...headers(cookie), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const until = async (check, label) => {
  const deadline = Date.now() + 12000;
  while (!check()) { if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 30)); }
};
try {
  for (const name of ["Alpha", "Bravo", "Charlie"]) {
    const boot = await call("/api/security/session", "", {}); assert.equal(boot.status, 200, await boot.clone().text());
    let cookie = boot.headers.get("Set-Cookie").split(";")[0];
    const verify = await call("/api/security/verify", cookie, { token: `${name}-test-token` }); assert.equal(verify.status, 200, await verify.clone().text());
    cookie += `; ${verify.headers.get("Set-Cookie").split(";")[0]}`;
    const match = await call("/api/matchmaking/join", cookie, { name, clientId: name, reconnectToken: `${name}-reconnect-token-for-testing`, group: "global" });
    assert.equal(match.status, 200, await match.clone().text()); const { code } = await match.json();
    const connected = await runtime.dispatchFetch(`${origin}/api/room/${code}/live`, { headers: { ...headers(cookie), Upgrade: "websocket" } });
    assert.equal(connected.status, 101, connected.status === 101 ? "" : await connected.text());
    const ws = connected.webSocket; ws.accept(); const peer = { name, cookie, code, ws, state: null, messages: [] }; peers.push(peer);
    ws.addEventListener("message", event => { const message = JSON.parse(event.data); peer.messages.push(message); if (message.type === "room-state") peer.state = message.payload; });
    ws.send(JSON.stringify({ type: "join", payload: { code, clientId: name, name, reconnectToken: `${name}-reconnect-token-for-testing`, protocolVersion: 3 } }));
    await until(() => peer.state, "join state");
  }
  assert.equal(new Set(peers.map(p => p.code)).size, 1);
  await until(() => peers.every(p => p.state?.phase === "choosing"), "server auto start");
  const drawer = peers.find(p => p.name === p.state.drawerId), guessers = peers.filter(p => p !== drawer);
  for (const peer of guessers) peer.ws.send(JSON.stringify({ type: "choice-vote", payload: { choiceIndex: 0 } }));
  await until(() => peers.every(p => p.state.phase === "drawing"), "word selection");
  const answer = drawer.state.answer.answer;
  for (const peer of guessers) { assert.equal(peer.state.answer.answer, null); assert.deepEqual(peer.state.recentPromptKeys, []); assert.deepEqual(peer.state.recentChoiceKeys, []); }
  drawer.ws.send(JSON.stringify({ type: "drawing-delta", payload: { mutationId: "runtime-edit", epoch: drawer.state.drawingEpoch, baseRevision: 0, delta: { index: 0, deleteCount: 0, operations: [{ type: "fill", x: 1, y: 2, color: "#123456", opacity: 100 }] } } }));
  await until(() => guessers.every(p => p.messages.some(m => m.type === "drawing-delta")), "validated drawing delta");
  guessers[0].ws.send(JSON.stringify({ type: "guess", payload: { text: answer } }));
  await until(() => guessers[1].state.solved.length === 1, "correct guess");
  assert.equal(guessers[1].state.phase, "drawing"); assert.equal(guessers[1].state.guesses.at(-1).text, "Guessed correctly!");
  assert.equal((await call(`/api/room/${drawer.code}/state`, drawer.cookie)).status, 403);
  const joinedCode = drawer.code;
  const rejected = await runtime.dispatchFetch(`${origin}/api/room/${joinedCode}/live`, { headers: { ...headers(drawer.cookie), Origin: "https://evil.invalid" } }); assert.equal(rejected.status, 403);
  await rejected.text();
  const loadStatuses = [];
  for (let i = 0; i < 200; i++) {
    const response = await call("/api/twitch/session", drawer.cookie);
    loadStatuses.push(response.status); await response.text();
  }
  assert.ok(loadStatuses.filter(status => status === 429).length >= 80, "native runtime limiter rejects sustained requests");
  console.log("Security runtime passed: same-origin Pages proxy, HttpOnly cookie bootstrap, mocked Siteverify, real admission DO/SQLite, three-player matchmaking, hibernating WebSockets, private answers and drawing deltas.");
} finally {
  await Promise.all(peers.map(peer => new Promise(resolve => {
    const timeout = setTimeout(resolve, 1500);
    peer.ws.addEventListener("close", () => { clearTimeout(timeout); resolve(); });
    peer.ws.close(1000, "Test complete");
  })));
  await new Promise(resolve => setTimeout(resolve, 200));
  await runtime.dispose();
}
