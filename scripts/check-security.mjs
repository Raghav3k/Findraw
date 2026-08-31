import assert from "node:assert/strict";
import worker, { FindrawRoom, FindrawSession } from "../cloudflare/backend/src/index.js";
import { issueSession, readSession, signClaim, readClaim, FindrawAdmission, verifyHuman, requireHuman } from "../cloudflare/backend/src/security.js";
import { validateSocketMessage, boundedJson, validateHttpBody } from "../shared/security.mjs";

function storage() {
  const data = new Map(); let alarm = null;
  return { data, async get(k) { return structuredClone(data.get(k)); }, async put(k, v) { data.set(k, structuredClone(v)); }, async delete(k) { data.delete(k); }, async deleteAll() { data.clear(); },
    async setAlarm(value) { alarm = value; }, async getAlarm() { return alarm; }, async deleteAlarm() { alarm = null; }, async transaction(fn) { return fn(this); } };
}
const socket = () => ({ attachment: {}, messages: [], send(value) { this.messages.push(JSON.parse(value)); }, close(code) { this.closed = code; }, serializeAttachment(value) { this.attachment = structuredClone(value); }, deserializeAttachment() { return structuredClone(this.attachment); } });
const room = new FindrawRoom({ storage: storage() }, {}); await room.ready;
const peers = [];
for (const name of ["Drawer", "Guesser", "Other"]) {
  const peer = socket(); peers.push(peer);
  await room.join(peer, { code: "ABC123", clientId: name, reconnectToken: `${name}-long-isolated-test-token`, name, create: name === "Drawer" });
}
room.room.drawerId = "Drawer"; room.room.phase = "choosing";
await room.chooseWord({ answer: { answer: "Elephant", aliases: ["Elephants"], categoryId: "animals" } });
room.room.recentChoiceKeys = ["animals:elephant", "animals:giraffe"];
room.room.futurePrivateField = "do-not-transmit";
let view = JSON.stringify(room.stateForClient({ id: "Guesser" }));
assert.ok(!/elephant|giraffe|do-not-transmit/i.test(view), "all secondary state fields must be private");
assert.ok(JSON.stringify(room.stateForClient({ id: "Drawer" })).includes("Elephant"));
await room.submitGuess({ id: "Guesser", name: "Guesser" }, { text: "Elephant" });
assert.equal(room.room.phase, "drawing");
assert.ok(!JSON.stringify(room.stateForClient({ id: "Other" })).toLowerCase().includes("elephant"));
const guesses = room.room.guesses.length;
await room.submitGuess({ id: "Guesser", name: "Guesser" }, { text: "Elephant" });
assert.equal(room.room.guesses.length, guesses, "solved players cannot leak answers through ordinary chat");
room.room.endAt = Date.now() - 5000;
await room.submitGuess({ id: "Other", name: "Other" }, { text: "Elephant" });
assert.equal(room.room.players.find(p => p.id === "Other").score, 0, "late guesses never award points");
assert.equal(room.room.phase, "results");
room.room.phase = "lobby";
await assert.rejects(room.updateSettings({ maxPlayers: "bad" }));
await assert.rejects(room.updateSettings({ roundsPerPlayer: 1.5 }));
await assert.rejects(room.updateSettings({ roundSeconds: 100000 }));
await room.updateSettings({ maxPlayers: 8, roundsPerPlayer: 3, roundSeconds: 90 });
await assert.rejects(room.handleSocketMessage(peers[1], JSON.stringify({ type: "room-settings", payload: { maxPlayers: 4 } })), /leader/);
room.room.phase = "drawing"; room.room.endAt = Date.now() + 90000;
await assert.rejects(room.handleSocketMessage(peers[1], JSON.stringify({ type: "drawing-sync", payload: { operations: [] } })), /drawer/);
for (const value of [null, [], { type: "fake-score", payload: { score: 999 } }, { type: "guess", payload: { text: "x", score: 99 } }, { type: "guess", payload: { text: "x".repeat(81) } }, { type: "guess", payload: { text: 23 } }, { type: "join", payload: { clientId: "__proto__" } }]) assert.throws(() => validateSocketMessage(value));
const unknown = socket(); unknown.serializeAttachment({ roomCode: "XYZ789" });
await assert.rejects(room.handleSocketMessage(unknown, JSON.stringify({ type: "join", payload: { code: "ABC123", clientId: "new", reconnectToken: "long-enough-reconnect-token", name: "New" } })), /mismatch/);
const oversized = socket(); await room.handleSocketMessage(oversized, "x".repeat(256 * 1024 + 1)); assert.equal(oversized.closed, 1009);
const flood = socket(); flood.serializeAttachment({ sessionKey: "isolated-flood-session-key" });
for (let i = 0; i < 5; i++) await room.webSocketMessage(flood, "not JSON");
assert.equal(flood.closed, 1008);
assert.ok(await room.state.storage.get("blocked:isolated-flood-session-key") > Date.now());
room.room.phase = "lobby"; room.room.updatedAt = Date.now() - 21 * 60000;
await room.alarm(); assert.equal(room.room, null, "connected idle room expires");

const env = { SESSION_SECRET: "synthetic-security-test-secret", FRONTEND_URL: "https://test.invalid", TWITCH_CLIENT_ID: "test-client", TWITCH_CLIENT_SECRET: "test-secret", TWITCH_REDIRECT_URI: "https://test.invalid/auth/twitch/callback" };
const objects = new Map(); let objectCalls = 0;
env.FINDRAW_SESSION = { idFromName: n => n, get(id) { objectCalls++; if (!objects.has(id)) objects.set(id, new FindrawSession({ id, storage: storage() }, env)); return objects.get(id); } };
env.FINDRAW_ADMISSION = { idFromName: n => n, get: () => ({ fetch: async () => Response.json({ ok: true }) }) };
env.EDGE_LIMITER = { limit: async () => ({ success: true }) };
const request = (path, options = {}) => new Request(`https://test.invalid${path}`, { ...options, headers: { Origin: "https://test.invalid", "CF-Connecting-IP": "192.0.2.1", ...options.headers } });
let session = await issueSession(request("/"), env);
let cookie = session.header.split(";")[0];
assert.match(session.header, /HttpOnly; SameSite=Lax/); assert.match(session.header, /; Secure/);
assert.equal(await readSession(request("/", { headers: { Cookie: cookie } }), env), session.sid);
assert.equal(await readSession(request("/", { headers: { "X-Findraw-Session": session.sid } }), env), null);
const expired = await signClaim(env.SESSION_SECRET, { purpose: "session", sid: session.sid, exp: Date.now() - 1 });
assert.equal(await readClaim(env.SESSION_SECRET, expired, "session"), null);
assert.equal((await worker.fetch(request("/api/leaderboard", { headers: { "X-Findraw-Session": session.sid } }), env)).status, 401);
assert.equal((await worker.fetch(request("/api/room/ABC123/state", { headers: { Cookie: cookie } }), env)).status, 403);
assert.equal((await worker.fetch(request("/api/live", { headers: { Cookie: cookie, Origin: "https://evil.invalid", Upgrade: "websocket" } }), env)).status, 403);
assert.equal((await worker.fetch(request("/api/live", { headers: { Cookie: cookie, Upgrade: "websocket", Origin: "" } }), env)).status, 403);
assert.equal((await worker.fetch(request("/api/matchmaking/join", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ clientId: "test", reconnectToken: "long-reconnect-token-for-tests", name: "Tester", group: "attacker-shard" }) }), env)).status, 400);
const tooBig = request("/api/community-packs", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(128 * 1024 + 1) });
await assert.rejects(boundedJson(tooBig), error => error.status === 413);
assert.throws(() => validateHttpBody(request("/api/points/adjust", { method: "POST" }), { userId: "x", delta: Infinity }));

// OAuth callbacks are browser-bound, one-use, and rotate to an unknown fresh session.
const start = await worker.fetch(request("/auth/twitch/start", { headers: { Cookie: cookie } }), env);
assert.equal(start.status, 302);
const state = new URL(start.headers.get("location")).searchParams.get("state");
const second = (await issueSession(request("/"), env)).header.split(";")[0];
const callbackPath = `/auth/twitch/callback?code=fake-code&state=${encodeURIComponent(state)}`;
assert.equal((await worker.fetch(request(callbackPath, { headers: { Cookie: second } }), env)).status, 403);
const nativeFetch = globalThis.fetch;
env.TURNSTILE_SITE_KEY = "mock-site-key"; env.TURNSTILE_SECRET_KEY = "mock-secret";
for (const result of [{ success: false }, { success: true, hostname: "evil.invalid", action: "findraw_access" }, { success: true, hostname: "test.invalid", action: "wrong_action" }]) {
  globalThis.fetch = async () => Response.json(result);
  await assert.rejects(verifyHuman(request("/"), env, session.sid, "fake-token"), error => error.status === 403);
}
globalThis.fetch = async () => Response.json({ success: true, hostname: "test.invalid", action: "findraw_access" });
const humanCookie = (await verifyHuman(request("/"), env, session.sid, "valid-fake-token")).split(";")[0];
await requireHuman(request("/", { headers: { Cookie: humanCookie } }), env, session.sid);
await assert.rejects(requireHuman(request("/", { headers: { Cookie: humanCookie } }), env, "different-session"));
globalThis.fetch = nativeFetch;
let revocations = 0;
globalThis.fetch = async url => {
  if (String(url).endsWith("/token")) return Response.json({ access_token: "fake-access", refresh_token: "fake-refresh", expires_in: 3600 });
  if (String(url).endsWith("/validate")) return Response.json({ user_id: "test-victim", login: "test", scopes: ["user:read:chat"], client_id: env.TWITCH_CLIENT_ID });
  if (String(url).includes("helix/users")) return Response.json({ data: [{ display_name: "Test", profile_image_url: "https://test.invalid/avatar" }] });
  if (String(url).endsWith("/revoke")) { revocations++; return new Response(null, { status: 200 }); }
  throw new Error("Unexpected network call blocked in security test");
};
try {
  const complete = await worker.fetch(request(callbackPath, { headers: { Cookie: cookie } }), env);
  assert.equal(complete.status, 302);
  const rotatedCookie = complete.headers.get("Set-Cookie").split(";")[0]; assert.notEqual(rotatedCookie, cookie);
  const oldIdentity = await (await worker.fetch(request("/api/twitch/session", { headers: { Cookie: cookie } }), env)).json(); assert.equal(oldIdentity.authenticated, false);
  const identity = await (await worker.fetch(request("/api/twitch/session", { headers: { Cookie: rotatedCookie } }), env)).json(); assert.equal(identity.user.id, "test-victim");
  assert.equal((await worker.fetch(request(callbackPath, { headers: { Cookie: cookie } }), env)).status, 400);
  const logout = await worker.fetch(request("/api/twitch/disconnect", { method: "POST", headers: { Cookie: rotatedCookie } }), env);
  assert.equal(logout.status, 200); assert.equal(revocations, 1);
} finally { globalThis.fetch = nativeFetch; }

// Small deterministic admission exercise, not a production capacity benchmark.
const admission = new FindrawAdmission({ storage: storage() });
for (let i = 0; i < 3; i++) assert.equal((await admission.fetch(new Request("https://internal/check", { method: "POST", body: JSON.stringify({ action: "upgrade", room: `room-${i}`, limit: 3 }) }))).status, 200);
assert.equal((await admission.fetch(new Request("https://internal/check", { method: "POST", body: JSON.stringify({ action: "upgrade", room: "room-4", limit: 3 }) }))).status, 429);
await admission.fetch(new Request("https://internal/check", { method: "POST", body: JSON.stringify({ action: "release", room: "room-0" }) }));
assert.equal((await admission.fetch(new Request("https://internal/check", { method: "POST", body: JSON.stringify({ action: "upgrade", room: "room-4", limit: 3 }) }))).status, 200, "leaving frees capacity");
let attempts = 0; objectCalls = 0;
env.EDGE_LIMITER = { limit: async () => ({ success: ++attempts <= 5 }) };
const statuses = [];
for (let i = 0; i < 200; i++) statuses.push((await worker.fetch(request("/api/twitch/session", { headers: { Cookie: cookie } }), env)).status);
assert.equal(statuses.filter(s => s === 429).length, 195); assert.equal(objectCalls, 5, "blocked requests never reach the session DO");
console.log("Security checks passed: private state, server deadlines, roles, schemas, payload bounds, sanctions, idle TTL, cookies, OAuth fixation/replay/rotation, logout revocation, admission caps and 200-request bounded abuse exercise (195 rejected before session DO).");
