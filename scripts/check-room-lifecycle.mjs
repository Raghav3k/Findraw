import assert from "node:assert/strict";
import { FindrawMatchmaker, FindrawRoom } from "../cloudflare/backend/src/index.js";

const createStorage = () => {
  const values = new Map();
  return {
    values,
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async delete(key) { values.delete(key); },
    async setAlarm(value) { values.set("alarm", value); },
    async deleteAlarm() { values.delete("alarm"); },
    async transaction(fn) { return fn(this); },
  };
};

const createSocket = () => ({
  messages: [],
  send(message) { this.messages.push(JSON.parse(message)); },
});

const storage = createStorage();
const sessionRequests = [];
const env = {
  FINDRAW_SESSION: {
    idFromName: (name) => name,
    get: () => ({
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json().catch(() => null) : null;
        sessionRequests.push({ path: url.pathname, body });
        if (url.pathname === "/internal/room-chat") {
          return Response.json({ authenticated: true, eventSubStatus: "connected" });
        }
        if (url.pathname === "/api/round/start") return Response.json({ roundId: "twitch-round-1" });
        return Response.json({ ok: true });
      },
    }),
  },
};
const room = new FindrawRoom({ storage }, env);
await room.ready;

const ownerToken = "owner-reconnect-token-that-is-long-enough";
const ownerSession = "owner-browser-session-key-123456789";
const firstSocket = createSocket();
room.socketSessionKeys.set(firstSocket, ownerSession);
await room.join(firstSocket, {
  code: "AB23CD",
  clientId: "owner-player",
  reconnectToken: ownerToken,
  name: "Owner",
  create: true,
});
room.room.players[0].score = 725;
await room.save();

await room.disconnect(firstSocket);
assert.ok(room.room.players[0].disconnectedAt, "disconnect should reserve the seat briefly");

const reconnectedSocket = createSocket();
room.socketSessionKeys.set(reconnectedSocket, ownerSession);
await room.join(reconnectedSocket, {
  code: "AB23CD",
  clientId: "owner-player",
  reconnectToken: ownerToken,
  name: "Owner renamed",
});
assert.equal(room.room.players[0].score, 725, "reconnect should preserve the score");
assert.equal(room.room.players[0].disconnectedAt, null, "reconnect should restore the seat");
assert.equal(room.room.twitchOwnerName, "Owner renamed", "host identity should follow the restored seat");

const intruderSocket = createSocket();
await assert.rejects(
  room.join(intruderSocket, {
    code: "AB23CD",
    clientId: "owner-player",
    reconnectToken: "different-token-that-is-also-long-enough",
    name: "Intruder",
  }),
  /another browser/,
  "a different browser token must not take an occupied seat",
);

room.room.phase = "choosing";
await room.chooseWord({ answer: { answer: "Pikachu", aliases: ["Pika"], categoryId: "pokemon" } });
const startRequest = sessionRequests.find((entry) => entry.path === "/api/round/start");
assert.deepEqual(startRequest?.body, {
  answer: "Pikachu",
  aliases: ["Pika"],
  target: 100,
  roomCode: "AB23CD",
}, "the Room round should use the leader's Twitch session");
assert.equal(room.room.twitchOwnerConnected, true);

await room.receiveTwitchSolver(new Request("https://findraw.internal/api/room/AB23CD/twitch-solver", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    roundId: "twitch-round-1",
    solver: { userId: "viewer-1", name: "Viewer", points: 100, position: 1 },
  }),
}));
assert.equal(room.room.twitchSolvers.length, 1, "Twitch solvers should appear in the Room state");
assert.equal(roomStateHasPrivateData(room.stateForClient({ id: "owner-player" })), false);

await room.finishTurn();
assert.ok(sessionRequests.some((entry) => entry.path === "/api/round/end"), "finishing a turn should end the Room Twitch round");

env.FINDRAW_SESSION.get = () => ({ async fetch(request) {
  if (new URL(request.url).pathname === "/internal/room-chat") return Response.json({ authenticated: true, eventSubStatus: "connected" });
  const body = await request.json();
  return body.takeover
    ? Response.json({ roundId: "taken-over-room-round" })
    : Response.json({ error: "Another game owns scoring", code: "ROUND_OWNED" }, { status: 409 });
} });
room.room.phase = "drawing";
room.room.endAt = Date.now() + 90000;
const roomAnswer = { answer: "Pikachu", aliases: ["Pika"], categoryId: "pokemon" };
room.room.answer = roomAnswer;
await room.startRoomTwitchRound(roomAnswer);
assert.equal(room.room.twitchScoringConflict, true);
const guestSocket = createSocket();
room.clients.set(guestSocket, { id: "guest", name: "Guest" });
await assert.rejects(room.handleSocketMessage(guestSocket, JSON.stringify({ type: "twitch-takeover" })), /party leader/);
await room.handleSocketMessage(reconnectedSocket, JSON.stringify({ type: "twitch-takeover" }));
assert.equal(room.room.twitchScoringConflict, false);
assert.equal(room.room.twitchOwnerConnected, true);
await room.fetch(new Request("https://findraw.internal/api/room/AB23CD/twitch-stopped", {
  method: "POST", body: JSON.stringify({ roundId: "taken-over-room-round" }),
}));
assert.equal(room.room.twitchOwnerConnected, false);
assert.equal(room.room.twitchScoringConflict, true);

const publicRooms = new Map();
const publicEnv = {
  FINDRAW_ROOM: {
    idFromName: (code) => code,
    get: (code) => {
      if (!publicRooms.has(code)) publicRooms.set(code, new FindrawRoom({ storage: createStorage() }, {}));
      return publicRooms.get(code);
    },
  },
};
const matchmaker = new FindrawMatchmaker({ storage: createStorage() }, publicEnv);
const match = async (clientId, name, token) => {
  const response = await matchmaker.fetch(new Request("https://findraw.internal/api/matchmaking/join", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Findraw-Session": `${clientId}-browser-session-key-123456789` },
    body: JSON.stringify({ clientId, name, reconnectToken: token }),
  }));
  assert.equal(response.status, 200);
  return response.json();
};
const firstMatch = await match("public-player-one", "Public One", "public-player-one-reconnect-token-long");
const secondMatch = await match("public-player-two", "Public Two", "public-player-two-reconnect-token-long");
assert.equal(secondMatch.code, firstMatch.code, "available public players should be assigned to the same lobby");
const publicRoom = publicRooms.get(firstMatch.code);
await publicRoom.ready;
assert.equal(publicRoom.room.visibility, "public");
assert.equal(publicRoom.room.players.length, 2);
assert.equal(publicRoom.room.maxPlayers, 8);

console.log("Room lifecycle checks passed.");

function roomStateHasPrivateData(state) {
  return "seatTokens" in state || "playerSessionKeys" in state || "twitchOwnerSessionKey" in state || "twitchRoundId" in state;
}
