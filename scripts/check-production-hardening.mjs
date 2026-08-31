import assert from "node:assert/strict";
import { FindrawRoom, FindrawSession, FindrawChannel } from "../cloudflare/backend/src/index.js";
import { channelPointsStorage } from "../shared/channelPointsStorage.mjs";
import { prunePointsHistory } from "../shared/pointsRetention.mjs";
import { pickWordChoices } from "../shared/wordQueue.mjs";

function storage() {
  const values = new Map();
  return {
    values, writes: [], alarm: null,
    async get(key) { return structuredClone(values.get(key)); },
    async put(key, value) { this.writes.push(key); values.set(key, structuredClone(value)); },
    async delete(key) { this.writes.push(key); values.delete(key); },
    async list({ prefix = "" } = {}) { return structuredClone(new Map([...values].filter(([key]) => key.startsWith(prefix)))); },
    async getAlarm() { return this.alarm; },
    async setAlarm(value) { this.alarm = value; },
    async deleteAlarm() { this.alarm = null; },
    async transaction(fn) { return fn(this); },
  };
}
function socket() {
  return {
    messages: [], attachment: null,
    serializeAttachment(value) { this.attachment = structuredClone(value); },
    deserializeAttachment() { return structuredClone(this.attachment); },
    send(value) { this.messages.push(JSON.parse(value)); },
    close() { this.closed = true; },
  };
}
const clock = Date.now;
let now = Date.UTC(2026, 7, 31, 12);
Date.now = () => now;
try {
  const old = new Date(now - 61 * 86_400_000).toISOString();
  const recent = new Date(now).toISOString();
  const pending = { id: "pending", channelId: "111", status: "completed", endedAt: old, rewards: [{ reward: "Gift a sub", fulfilled: false }], participants: { one: { displayName: "One", score: 100 } } };
  const data = { version: 3, channels: {}, weeklyChannels: { "111": { channelId: "111", weekId: "2026-08-31", participants: { one: { displayName: "One", score: 100 } } } },
    weeklyHistory: [], activeSessions: {}, sessionHistory: [pending, { ...pending, id: "fulfilled", rewards: [{ reward: "Gift a sub", fulfilled: true }] }, { ...pending, id: "recent", endedAt: recent, rewards: [] }],
    ledger: [{ id: "old", createdAt: old }, { id: "new", createdAt: recent }] };
  assert.equal(prunePointsHistory(data, now), true);
  assert.deepEqual(data.sessionHistory.map((row) => row.id), ["pending", "recent"]);
  assert.deepEqual(data.ledger.map((row) => row.id), ["new"]);
  assert.equal(data.weeklyChannels["111"].participants.one.score, 100);
  assert.equal(prunePointsHistory(data, now), false);

  const db = storage();
  await db.put("points", data);
  let adapter = channelPointsStorage(db);
  assert.deepEqual(await adapter.get("points"), data);
  await adapter.put("points", data);
  assert.equal(await db.get("points"), undefined, "legacy blob is replaced atomically");
  assert.equal(await db.get("points-layout"), 4);
  adapter = channelPointsStorage(db);
  assert.deepEqual(await adapter.get("points"), data, "split storage round trips every field");
  db.writes = [];
  await adapter.put("points", await adapter.get("points"));
  assert.equal(db.writes.length, 0, "unchanged reads/saves do not write");
  const changed = await adapter.get("points");
  changed.weeklyChannels["111"].participants.one.score++;
  await adapter.put("points", changed);
  assert.equal(db.writes.length, 1, "one score change writes one participant bucket");
  assert.ok(!db.writes.some((key) => key.includes("sessionHistory")), "score updates do not rewrite reward history");
  // Large populations no longer make a single unbounded DO value.
  for (let i = 0; i < 12000; i++) changed.weeklyChannels["111"].participants[`viewer-${i}`] = { displayName: "🙂".repeat(40), score: i };
  await adapter.put("points", changed);
  assert.ok([...db.values.entries()].filter(([key]) => key.startsWith("points-v4:")).every(([, value]) => Buffer.byteLength(JSON.stringify(value)) < 200_000));
  const restored = await channelPointsStorage(db).get("points");
  assert.equal(Object.keys(restored.weeklyChannels["111"].participants).length, 12001);
  assert.equal(restored.weeklyChannels["111"].participants["viewer-11999"].displayName, "🙂".repeat(40));

  const maintenanceDb = storage();
  const expired = { ...data, weeklyChannels: {}, ledger: [{ id: "expiring", createdAt: recent }], sessionHistory: [pending, { ...pending, id: "done", endedAt: recent, rewards: [] }] };
  await maintenanceDb.put("channelId", "111");
  await channelPointsStorage(maintenanceDb).put("points", expired);
  assert.ok(maintenanceDb.alarm > now, "history cleanup is scheduled without browser polling");
  const beforeMaintenance = now;
  now += 62 * 86_400_000;
  maintenanceDb.alarm = null;
  const maintenance = new FindrawChannel({ storage: maintenanceDb }, {});
  await maintenance.alarm();
  const cleaned = await channelPointsStorage(maintenanceDb).get("points");
  assert.deepEqual(cleaned.sessionHistory.map((row) => row.id), ["pending"]);
  assert.equal(cleaned.ledger.length, 0);
  assert.equal(maintenanceDb.alarm, null, "no endless timer when only protected rewards remain");
  now = beforeMaintenance;

  const packs = [{ id: "animals", words: [{ answer: "Cat" }, { answer: "Dog" }] }, { id: "nature", words: [{ answer: "Rain" }, { answer: "Dog" }] }];
  const choices = pickWordChoices(packs, ["pack-animals:cat"], 3, false, () => 0);
  assert.equal(choices[0].categoryId, "pack-nature", "balance away from recently used packs");
  assert.equal(new Set(choices.map((entry) => entry.answer)).size, 3, "avoid duplicate choices across packs");
  assert.equal(pickWordChoices([], [], 3).length, 0);
  assert.equal(pickWordChoices(packs, [], 99).length, 3, "small catalogs terminate without duplicate answers");

  const roomDb = storage();
  const sockets = [socket(), socket()];
  const state = { storage: roomDb, getWebSockets: () => sockets.filter((entry) => !entry.closed) };
  let room = new FindrawRoom(state, {});
  await room.ready;
  const reserve = async (id) => room.reservePublicSeat(new Request("https://internal/matchmake-seat", { method: "POST", body: JSON.stringify({ code: "ABC234", clientId: id, name: id, reconnectToken: `${id}-reconnect-token-long-enough`, browserSessionKey: `${id}-browser-key-long-enough` }) }));
  await reserve("first"); await reserve("second");
  assert.ok(room.room.promptPacks.length >= 1, "public categories originate on the server");
  for (const [i, id] of ["first", "second"].entries()) {
    await room.join(sockets[i], { code: "ABC234", clientId: id, name: id, reconnectToken: `${id}-reconnect-token-long-enough`, protocolVersion: 2 });
  }
  const startAt = room.room.publicStartAt;
  assert.equal(startAt, now + 3500);
  room = new FindrawRoom(state, {}); await room.ready;
  assert.equal(room.clients.size, 2, "hibernation restores client identities");
  now = startAt; await room.alarm();
  assert.equal(room.room.phase, "choosing", "public start does not require the host browser timer");
  await assert.rejects(room.updateSettings({ roundSeconds: 300 }), /server-managed/);
  await assert.rejects(room.updateWordMix({ packs: [] }), /server-managed/);
  now += 20_001; await room.alarm();
  assert.equal(room.room.phase, "drawing", "non-voters cannot stall the match indefinitely");
  const operations = [{ type: "fill", x: 10, y: 10, color: "#123456", opacity: 100 }];
  roomDb.writes = [];
  await room.syncDrawing({ operations });
  assert.deepEqual(roomDb.writes, ["room:drawingJournal"]);
  assert.equal(sockets[0].messages.at(-1).type, "drawing-committed");
  roomDb.writes = [];
  await room.submitGuess({ id: "second", name: "second" }, { text: "not-the-answer" });
  assert.deepEqual(roomDb.writes, ["room:guesses"]);
  assert.equal("drawingOperations" in sockets[0].messages.at(-1).payload, false);
  const endAt = room.room.endAt;
  await room.disconnect(sockets[1]); sockets[1].closed = true;
  room = new FindrawRoom(state, {}); await room.ready;
  assert.deepEqual(room.room.drawingOperations, operations);
  assert.equal(room.room.endAt, endAt);
  now += 30_001; await room.alarm();
  assert.equal(room.room.players.length, 1, "disconnect expiry survives hibernation");
  assert.equal(room.room.phase, "lobby");
  await room.disconnect(sockets[0]); sockets[0].closed = true;
  now += 30_001; await room.alarm();
  assert.equal(room.room, null);
  assert.equal(roomDb.values.size, 0, "empty rooms remove transient room data");
  await reserve("abandoned"); now += 30_001; await room.alarm();
  assert.equal(room.room, null, "never-connected matchmaking reservations expire");

  const sessionDb = storage();
  const session = new FindrawSession({ storage: sessionDb }, {}); await session.ready;
  let closed = false;
  session.eventSubSocket = { close() { closed = true; } };
  session.twitchSession = { userId: "111" };
  await session.alarm();
  assert.equal(closed, true);
  assert.equal(session.twitchSession.userId, "111", "idle chat stops without logging out");
  console.log("Production hardening checks passed: retention, split storage, zero-write reads, large populations, hibernation restore, deadlines, room cleanup and idle chat.");
} finally { Date.now = clock; }
