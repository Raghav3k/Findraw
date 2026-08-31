import assert from "node:assert/strict";
import worker, { FindrawChannel, FindrawSession } from "../cloudflare/backend/src/index.js";
import { getWeeklyPeriod } from "../shared/weeklyPoints.mjs";
import { channelPointsStorage } from "../shared/channelPointsStorage.mjs";
import { issueSession } from "../cloudflare/backend/src/security.js";

function memoryStorage(initial = new Map()) {
  let values = structuredClone(initial);
  const storage = {
    async get(key) { return structuredClone(values.get(key)); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async delete(key) { return values.delete(key); },
    async list({ prefix = "" } = {}) { return structuredClone(new Map([...values].filter(([key]) => key.startsWith(prefix)))); },
    async transaction(operation) {
      const working = memoryStorage(values);
      const result = await operation(working);
      values = await working.list();
      return result;
    },
  };
  return storage;
}

const env = { SESSION_SECRET: "isolated-test-session-secret", FRONTEND_URL: "https://test.invalid", EDGE_LIMITER: { async limit() { return { success: true }; } }, FINDRAW_ADMISSION: { idFromName: name => name, get: () => ({ fetch: async () => Response.json({ ok: true }) }) } };
function binding(Class) {
  const states = new Map();
  const objects = new Map();
  return {
    idFromName: (name) => name,
    idFromString: (id) => id,
    states,
    get(id) {
      if (!states.has(id)) states.set(id, { id, storage: memoryStorage() });
      if (!objects.has(id)) objects.set(id, new Class(states.get(id), env));
      return objects.get(id);
    },
    restart(id) { objects.delete(id); return this.get(id); },
  };
}
env.FINDRAW_SESSION = binding(FindrawSession);
env.FINDRAW_CHANNEL = binding(FindrawChannel);

async function login(browser, channelId) {
  const key = `browser-key-${browser}-12345678901234567890`;
  const session = env.FINDRAW_SESSION.get(`browser:${key}`);
  await session.ready;
  session.twitchSession = { userId: channelId, login: `streamer${channelId}`, displayName: `Streamer ${channelId}`,
    profileImageUrl: "https://example.invalid/avatar.png", scopes: [], expiresAt: Date.now() + 86_400_000, validatedAt: Date.now() };
  return { key, session };
}
async function request(browser, path, body) {
  if (path === "/api/points/adjust") body = { reason: "Test adjustment", requestId: crypto.randomUUID(), ...body };
  const cookie = (await issueSession(new Request("https://test.invalid"), env, browser.key)).header.split(";")[0];
  const response = await worker.fetch(new Request(`https://test.invalid${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Cookie: cookie, Origin: "https://test.invalid", "CF-Connecting-IP": "192.0.2.1", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
  return { status: response.status, body: await response.json() };
}
const start = (browser, extras = {}) => request(browser, "/api/round/start", { answer: "cat", target: 10, controllerId: "artist-tab", ...extras });
const guess = (browser, messageId, userId = "viewer1", name = "Viewer") => browser.session.processChatMessage({
  broadcaster_user_id: browser.session.twitchSession.userId, message_id: messageId,
  chatter_user_id: userId, chatter_user_name: name, message: { text: "cat" },
});
const leaderboard = async (browser) => (await request(browser, "/api/leaderboard")).body;

const a = await login("a", "111");
const b = await login("b", "111");
const other = await login("other", "222");
assert.equal((await request(a, "/api/artist-session/start", { name: "Test session", rewards: [{ position: 1, reward: "Gift a sub" }] })).status, 200);
assert.equal((await request(b, "/api/artist-session")).body.active.name, "Test session");
assert.equal((await request(b, "/api/artist-session/start", { name: "Other session", rewards: [{ position: 1, reward: "Other" }] })).status, 409);
assert.equal((await start(a)).status, 200);
const clash = await start(b);
assert.equal(clash.status, 409);
assert.equal(clash.body.code, "ROUND_OWNED");
assert.equal((await start(a, { controllerId: "second-tab" })).status, 409, "tabs sharing OAuth still need takeover");

await Promise.all([guess(a, "event1"), guess(a, "event1"), guess(a, "event2", "viewer2", "Second viewer")]);
assert.deepEqual((await leaderboard(b)).map((row) => row.score), [100, 80]);
assert.deepEqual((await request(b, "/api/artist-session")).body.active.standings.map((row) => row.score), [100, 80]);
assert.deepEqual(await leaderboard(other), []);

// The boundary rejects a forged channel ID; valid adjustments target the authenticated channel.
assert.equal((await request(other, "/api/points/adjust", { channelId: "111", userId: "viewer1", displayName: "Other channel", delta: 7 })).status, 400);
await request(other, "/api/points/adjust", { userId: "viewer1", displayName: "Other channel", delta: 7 });
assert.equal((await leaderboard(other))[0].score, 7);
assert.equal((await leaderboard(a))[0].score, 100);

const newRound = await start(b, { takeover: true });
assert.equal(newRound.status, 200);
assert.equal(a.session.currentRound.status, "ended", "the displaced browser is notified");
await guess(a, "old-owner-event", "intruder");
assert.equal((await leaderboard(a)).length, 2, "the previous owner cannot score after takeover");
await request(a, "/api/round/end", { controllerId: "artist-tab" });
await guess(b, "event1");
assert.equal((await leaderboard(a))[0].score, 100, "a replay cannot score again in a new round");
await guess(b, "event3", "viewer1", "Renamed Viewer");
assert.equal((await leaderboard(a))[0].score, 200);
assert.equal((await leaderboard(a))[0].displayName, "Renamed Viewer");

env.FINDRAW_CHANNEL.restart("channel:111");
await guess(b, "event3");
assert.equal((await leaderboard(a))[0].score, 200, "restarts preserve both scores and deduplication");
await Promise.all(Array.from({ length: 12 }, () => request(a, "/api/points/adjust", { userId: "viewer1", displayName: "Renamed Viewer", delta: 1 })));
assert.equal((await leaderboard(b))[0].score, 212, "concurrent updates cannot lose points");

const replies = [];
for (const browser of [a, b]) {
  browser.session.twitchSession.scopes = ["user:write:chat"];
  browser.session.sendTwitchChatMessage = async (text, parent, channelId) => replies.push({ text, parent, channelId });
}
await Promise.all([a, b].map((browser) => browser.session.processChatMessage({ broadcaster_user_id: "111",
  message_id: "points-command", chatter_user_id: "viewer1", chatter_user_name: "Renamed Viewer", message: { text: "!finpoints" } })));
assert.equal(replies.length, 1, "multiple browser chat connections must send only one command reply");
assert.ok(replies[0].text.includes("212"));
assert.equal(replies[0].channelId, "111");
for (const browser of [a, b]) browser.session.twitchSession.scopes = [];

const queued = await login("queued-reply", "111");
let releaseReply;
queued.session.commandResponseQueue = new Promise((resolve) => { releaseReply = resolve; });
const queuedReply = queued.session.enqueueCommandResponse("Old channel's score", "queued-message", "111");
await login("queued-reply", "222");
releaseReply();
await queuedReply; // No Twitch fetch is possible: the new channel has no write scope/token.

const transactionState = env.FINDRAW_CHANNEL.states.get("channel:111");
const transaction = transactionState.storage.transaction;
transactionState.storage.transaction = (operation) => transaction(async (storage) => {
  await operation(storage);
  throw new Error("Simulated transaction failure");
});
assert.equal((await request(a, "/api/points/adjust", { userId: "viewer1", displayName: "Renamed Viewer", delta: 99 })).status, 500);
transactionState.storage.transaction = transaction;
assert.equal((await leaderboard(a))[0].score, 212, "failed writes must not leave partial scoring updates");

const finished = await request(b, "/api/artist-session/end", {});
assert.equal(finished.body.session.standings[0].score, 212);
const sessionId = finished.body.session.id;
await request(a, "/api/artist-session/reward", { sessionId, position: 1, fulfilled: true });
assert.equal((await request(b, "/api/artist-session")).body.history[0].rewards[0].fulfilled, true);
const weekId = (await request(b, "/api/weekly-points")).body.current.weekId;
await request(a, "/api/weekly-points/rewards", { weekId, rewards: [{ position: 1, reward: "Community game" }] });
await request(b, "/api/weekly-points/reward", { weekId, position: 1, fulfilled: true });
assert.equal((await request(a, "/api/weekly-points")).body.current.rewards[0].fulfilled, true);

await request(b, "/api/twitch/disconnect", {});
assert.deepEqual(await leaderboard(b), []);
assert.equal((await request(b, "/api/points/adjust", { userId: "viewer1", delta: 100, displayName: "Bad" })).status, 401);
assert.equal((await leaderboard(a))[0].score, 212, "logout must not erase channel data");
const fresh = await login("fresh-after-cleared-site-data", "111");
assert.equal((await leaderboard(fresh))[0].score, 212);
assert.equal((await request(fresh, "/api/artist-session")).body.history[0].id, sessionId);
await login("fresh-after-cleared-site-data", "222");
assert.equal((await leaderboard(fresh))[0].score, 7, "switching accounts loads only the new channel");

// Legacy imports are channel-filtered and receipt-protected; conflicting sources
// are retained for review instead of guessed/summed or silently discarded.
const main = env.FINDRAW_SESSION.get("main");
await main.state.storage.put("points", { channels: {
  "333": { legacy: { displayName: "Legacy", score: 75 } },
  "999": { secret: { displayName: "Private other channel", score: 999 } },
} });
const legacy = await login("legacy", "333");
await legacy.session.state.storage.put("points", { channels: { "333": { conflict: { displayName: "Conflict", score: 20 } } } });
assert.deepEqual(await leaderboard(legacy), [{ userId: "legacy", displayName: "Legacy", score: 75 }]);
assert.equal((await request(legacy, "/api/channel/status")).body.migrationConflicts, 1);
const backups = (await request(legacy, "/api/channel/legacy-backups")).body.backups;
assert.equal(backups.length, 2);
assert.ok(!JSON.stringify(backups).includes("Private other channel"));
const legacyAgain = await login("legacy-again", "333");
assert.equal((await leaderboard(legacyAgain))[0].score, 75);
assert.equal((await request(legacyAgain, "/api/channel/status")).body.migrationConflicts, 1);
assert.ok(await legacy.session.state.storage.get("points"), "legacy source is never deleted");
assert.equal((await request(legacy, "/internal/channel-legacy", { channelId: "999" })).status, 404);
assert.equal((await request(legacy, "/channel", { channelId: "999" })).status, 404);

const emptyFirst = await login("empty-first", "444");
assert.deepEqual(await leaderboard(emptyFirst), []);
const laterLegacy = await login("later-legacy", "444");
await laterLegacy.session.state.storage.put("points", { channels: { "444": { saved: { displayName: "Saved", score: 50 } } } });
assert.equal((await leaderboard(laterLegacy))[0].score, 50, "an empty browser read must not block a later real import");

assert.equal((await start(laterLegacy, { target: 1, testBots: true })).status, 200);
await guess(laterLegacy, "test-bot-event", "bot1");
assert.deepEqual((await leaderboard(laterLegacy)).map((row) => row.userId), ["saved"], "test rounds must not change real standings");
assert.equal((await start(laterLegacy)).status, 200);
const leaseState = env.FINDRAW_CHANNEL.states.get("channel:444");
const staleRound = await leaseState.storage.get("scoringRound");
staleRound.expiresAt = Date.now() - 1;
await leaseState.storage.put("scoringRound", staleRound);
assert.equal((await start(emptyFirst)).status, 200, "an abandoned expired round must not permanently lock a channel");

const state = env.FINDRAW_CHANNEL.states.get("channel:111");
const pointsStorage = channelPointsStorage(state.storage);
const data = await pointsStorage.get("points");
const previousPeriod = getWeeklyPeriod(Date.now() - 7 * 86_400_000);
data.weeklyChannels["111"] = { ...data.weeklyChannels["111"], ...previousPeriod };
await pointsStorage.put("points", data);
const rolled = (await request(a, "/api/weekly-points")).body;
assert.deepEqual(rolled.current.standings, []);
assert.equal(rolled.history[0].standings[0].score, 212);
assert.equal(rolled.history[0].rewards[0].fulfilled, true);

const direct = env.FINDRAW_CHANNEL.get("channel:111");
const identityMismatch = await direct.fetch(new Request("https://findraw.internal/channel", { method: "POST", body: JSON.stringify({ channelId: "222", ownerId: "test", action: "leaderboard" }) }));
assert.equal(identityMismatch.status, 403);
assert.deepEqual((await request(other, "/api/artist-session")).body.history, []);
const adjustmentAccount = await login("adjustment-retry", "555");
const adjustment = { userId: "viewer", displayName: "Viewer", delta: 10, requestId: "same-adjustment-request" };
await request(adjustmentAccount, "/api/points/adjust", adjustment);
await request(adjustmentAccount, "/api/points/adjust", adjustment);
assert.equal((await leaderboard(adjustmentAccount))[0].score, 10, "manual adjustment retries are idempotent");
console.log("Channel persistence checks passed: cross-browser reads, isolation, migration, ownership, duplicate scoring/adjustments, concurrency, rewards, logout, restart, account switching and rollover.");
