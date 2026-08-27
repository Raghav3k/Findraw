import {
  COMMUNITY_REPORT_QUARANTINE_THRESHOLD,
  CommunityPackValidationError,
  publicCommunityPack,
  validateCommunityPackInput,
  validateCommunityReportInput,
} from "../../../shared/communityPacks.mjs";

const TWITCH_SCOPES = ["user:read:chat"];
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ROOM_MESSAGE_BYTE_LIMIT = 256 * 1024;
const ROOM_MAX_DRAWING_OPERATIONS = 500;
const ROOM_MAX_DRAWING_POINTS = 8000;
const ROOM_MAX_POINTS_PER_OPERATION = 900;
const ROOM_COORDINATE_LIMIT = 10000;
const ROOM_RATE_LIMITS = {
  all: { limit: 260, windowMs: 10000 },
  guess: { limit: 5, windowMs: 4000 },
  "drawing-preview": { limit: 24, windowMs: 1000 },
  "drawing-sync": { limit: 4, windowMs: 1000 },
  control: { limit: 20, windowMs: 10000 },
};

const json = (body, init = {}) => new Response(JSON.stringify(body), {
  ...init,
  headers: {
    "Content-Type": "application/json",
    ...corsHeaders(init.request),
    ...(init.headers || {}),
  },
});

const corsHeaders = (request) => {
  const origin = request?.headers?.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Vary": "Origin",
  };
};

const normalizeGuess = (value) => value
  .normalize("NFKD")
  .replace(/\p{Diacritic}/gu, "")
  .toLocaleLowerCase("en")
  .replace(/&/g, " and ")
  .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
  .trim()
  .replace(/\s+/g, " ");

const pointsForPosition = (position) => {
  if (position === 1) return 100;
  if (position === 2) return 80;
  if (position === 3) return 60;
  return 50;
};

const normalizeRoomCode = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
const normalizePlayerName = (value) => String(value || "").trim().toLocaleLowerCase("en");
const roomPromptKey = (prompt) => `${prompt.categoryId || "custom"}:${String(prompt.answer || "").toLowerCase()}`;
const getRoomMessageByteLength = (data) => {
  if (typeof data === "string") return encoder.encode(data).byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return data?.byteLength || data?.size || 0;
};
const clampNumber = (value, min, max, fallback = min) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};
const sanitizeColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : "#11131c";
const sanitizeDrawPoint = (point) => {
  if (!Array.isArray(point) || point.length < 2) return null;
  return [
    clampNumber(point[0], -ROOM_COORDINATE_LIMIT, ROOM_COORDINATE_LIMIT, 0),
    clampNumber(point[1], -ROOM_COORDINATE_LIMIT, ROOM_COORDINATE_LIMIT, 0),
    clampNumber(point[2], 0, 1, 0.5),
  ];
};
const sanitizeDrawingOperations = (operations) => {
  if (!Array.isArray(operations)) return [];
  const sanitized = [];
  let remainingPoints = ROOM_MAX_DRAWING_POINTS;
  for (const operation of operations.slice(-ROOM_MAX_DRAWING_OPERATIONS)) {
    if (!operation || typeof operation !== "object") continue;
    if (operation.type === "brush" || operation.type === "eraser") {
      if (remainingPoints <= 0) continue;
      const pointLimit = Math.min(ROOM_MAX_POINTS_PER_OPERATION, remainingPoints);
      const points = Array.isArray(operation.points)
        ? operation.points.slice(-pointLimit).map(sanitizeDrawPoint).filter(Boolean)
        : [];
      if (!points.length) continue;
      remainingPoints -= points.length;
      if (operation.type === "eraser") {
        sanitized.push({
          type: "eraser",
          points,
          size: clampNumber(operation.size, 1, 120, 18),
        });
      } else {
        const style = ["marker", "pencil", "dotted"].includes(operation.style) ? operation.style : "marker";
        sanitized.push({
          type: "brush",
          style,
          points,
          color: sanitizeColor(operation.color),
          opacity: clampNumber(operation.opacity, 1, 100, 100),
          strokeWidth: clampNumber(operation.strokeWidth, 1, 80, 8),
          complete: Boolean(operation.complete),
        });
      }
      continue;
    }
    if (operation.type === "fill") {
      sanitized.push({
        type: "fill",
        x: clampNumber(operation.x, -ROOM_COORDINATE_LIMIT, ROOM_COORDINATE_LIMIT, 0),
        y: clampNumber(operation.y, -ROOM_COORDINATE_LIMIT, ROOM_COORDINATE_LIMIT, 0),
        color: sanitizeColor(operation.color),
        opacity: clampNumber(operation.opacity, 1, 100, 100),
      });
      continue;
    }
    if (operation.type === "shape") {
      const shape = ["line", "dotted-line", "arrow", "rectangle", "ellipse"].includes(operation.shape) ? operation.shape : "line";
      const start = sanitizeDrawPoint(operation.start);
      const end = sanitizeDrawPoint(operation.end);
      if (!start || !end) continue;
      sanitized.push({
        type: "shape",
        shape,
        start: [start[0], start[1]],
        end: [end[0], end[1]],
        color: sanitizeColor(operation.color),
        opacity: clampNumber(operation.opacity, 1, 100, 100),
        strokeWidth: clampNumber(operation.strokeWidth, 1, 80, 8),
      });
    }
  }
  return sanitized;
};
const maskedRoomAnswer = (answer) => Array.from(String(answer || ""))
  .map((character) => character === " " ? "  " : "_")
  .join(" ");
const publicRoomState = (room) => ({
  ...room,
  answer: room.answer
    ? room.phase === "results"
      ? { ...room.answer, aliases: [] }
      : { ...room.answer, answer: null, aliases: [], mask: maskedRoomAnswer(room.answer.answer) }
    : null,
  choices: (room.choices || []).map((choice, index) => ({
    categoryId: choice.categoryId || `slot-${index}`,
    answer: "",
    aliases: [],
  })),
});

const sanitizePrompt = (prompt) => ({
  answer: String(prompt?.answer || "").trim().slice(0, 80),
  aliases: Array.isArray(prompt?.aliases) ? prompt.aliases.map((item) => String(item).trim().slice(0, 80)).filter(Boolean).slice(0, 8) : [],
  categoryId: String(prompt?.categoryId || "custom").trim().slice(0, 80) || "custom",
});

const getNextRoomTurn = (room) => {
  const playerCount = Math.max(1, room.players.length);
  const totalTurns = playerCount * room.roundsPerPlayer;
  const nextTurnIndex = room.turnIndex + 1;
  if (nextTurnIndex >= totalTurns) return null;
  return {
    turnIndex: nextTurnIndex,
    roundIndex: Math.floor(nextTurnIndex / playerCount),
    drawerId: room.players[nextTurnIndex % playerCount]?.id || room.players[0]?.id || null,
  };
};

const createEmptyRoomState = (code, host) => ({
  code,
  hostId: host.id,
  players: [host],
  phase: "lobby",
  categorySelection: "all",
  roundSeconds: 90,
  maxPlayers: 8,
  choices: [],
  choiceVotes: {},
  answer: null,
  drawerId: null,
  turnIndex: 0,
  roundIndex: 0,
  roundsPerPlayer: 3,
  endAt: null,
  guesses: [],
  solved: [],
  recentPromptKeys: [],
  drawingOperations: [],
  updatedAt: Date.now(),
});

const communityShareAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const randomCommunityToken = (byteLength = 32) => {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const randomCommunityShareCode = () => Array.from(
  crypto.getRandomValues(new Uint8Array(10)),
  (byte) => communityShareAlphabet[byte % communityShareAlphabet.length],
).join("");
const hashCommunityToken = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value || "")));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export class FindrawCommunity {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/community-packs" && request.method === "POST") return this.createPack(request);
      const reportMatch = url.pathname.match(/^\/api\/community-packs\/([^/]+)\/report$/);
      if (reportMatch && request.method === "POST") return this.reportPack(request, reportMatch[1]);
      const packMatch = url.pathname.match(/^\/api\/community-packs\/([^/]+)$/);
      if (packMatch && request.method === "GET") return this.getPack(request, packMatch[1]);
      if (packMatch && request.method === "PUT") return this.updatePack(request, packMatch[1]);
      return json({ error: "Community pack route not found." }, { status: 404, request });
    } catch (error) {
      if (error instanceof CommunityPackValidationError) {
        return json({ error: error.message, field: error.field }, { status: error.status, request });
      }
      console.error("Community pack request failed", error);
      return json({ error: "Community pack request failed." }, { status: 500, request });
    }
  }

  async createPack(request) {
    const body = await request.json().catch(() => ({}));
    const input = validateCommunityPackInput(body, { extraBlockedTerms: this.env.COMMUNITY_BLOCKED_TERMS });
    const editToken = randomCommunityToken();
    const editTokenHash = await hashCommunityToken(editToken);
    let pack;
    await this.state.storage.transaction(async (storage) => {
      let shareCode = randomCommunityShareCode();
      while (await storage.get(`community-share:${shareCode}`)) shareCode = randomCommunityShareCode();
      const now = new Date().toISOString();
      pack = {
        id: crypto.randomUUID(),
        ...input,
        visibility: "unlisted",
        status: "published",
        shareCode,
        editTokenHash,
        reportCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await storage.put(`community-pack:${pack.id}`, pack);
      await storage.put(`community-share:${shareCode}`, pack.id);
    });
    return json({ pack: publicCommunityPack(pack), editToken }, { status: 201, request });
  }

  async getPack(request, shareCodeValue) {
    const shareCode = String(shareCodeValue || "").trim().toUpperCase();
    const id = await this.state.storage.get(`community-share:${shareCode}`);
    const pack = id ? await this.state.storage.get(`community-pack:${id}`) : null;
    if (!pack || pack.status !== "published") return json({ error: "Community pack not found." }, { status: 404, request });
    return json({ pack: publicCommunityPack(pack) }, { request });
  }

  async updatePack(request, id) {
    const pack = await this.state.storage.get(`community-pack:${id}`);
    if (!pack) return json({ error: "Community pack not found." }, { status: 404, request });
    const editToken = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (await hashCommunityToken(editToken) !== pack.editTokenHash) {
      return json({ error: "The edit token is invalid." }, { status: 403, request });
    }
    const body = await request.json().catch(() => ({}));
    const input = validateCommunityPackInput(body, { extraBlockedTerms: this.env.COMMUNITY_BLOCKED_TERMS });
    Object.assign(pack, input, { updatedAt: new Date().toISOString() });
    await this.state.storage.put(`community-pack:${id}`, pack);
    return json({ pack: publicCommunityPack(pack) }, { request });
  }

  async reportPack(request, id) {
    const body = await request.json().catch(() => ({}));
    const input = validateCommunityReportInput(body);
    const reporterScope = request.headers.get("CF-Connecting-IP") || input.reporterKey;
    const reportKeyHash = await hashCommunityToken(`${this.env.SESSION_SECRET || "findraw-worker"}:community-report:${reporterScope}`);
    let result;
    await this.state.storage.transaction(async (storage) => {
      const pack = await storage.get(`community-pack:${id}`);
      if (!pack) {
        result = { type: "not-found" };
        return;
      }
      const reportStorageKey = `community-report:${id}:${reportKeyHash}`;
      if (await storage.get(reportStorageKey)) {
        result = { type: "ok", duplicate: true, status: pack.status };
        return;
      }
      await storage.put(reportStorageKey, {
        id: crypto.randomUUID(),
        reason: input.reason,
        details: input.details,
        reporterKeyHash,
        createdAt: new Date().toISOString(),
      });
      pack.reportCount = Number(pack.reportCount || 0) + 1;
      if (pack.reportCount >= COMMUNITY_REPORT_QUARANTINE_THRESHOLD) pack.status = "quarantined";
      pack.updatedAt = new Date().toISOString();
      await storage.put(`community-pack:${id}`, pack);
      result = { type: "ok", duplicate: false, status: pack.status };
    });
    if (result.type === "not-found") return json({ error: "Community pack not found." }, { status: 404, request });
    return json({ ok: true, duplicate: result.duplicate, status: result.status }, { request });
  }
}

export class FindrawRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Map();
    this.room = null;
    this.ready = this.restore();
  }

  async restore() {
    this.room = await this.state.storage.get("room") || null;
  }

  async fetch(request) {
    await this.ready;
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
    const url = new URL(request.url);
    if (url.pathname.endsWith("/live")) return this.liveSocket(request);
    if (url.pathname.endsWith("/state")) return json({ room: this.room ? publicRoomState(this.room) : null }, { request });
    return json({ error: "Room route not found" }, { status: 404, request });
  }

  liveSocket(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ error: "Expected websocket upgrade." }, { status: 426, request });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    server.addEventListener("message", (event) => this.handleSocketMessage(server, event.data).catch((error) => {
      try { server.send(JSON.stringify({ type: "error", error: error.message || "Room request failed" })); } catch {}
    }));
    server.addEventListener("close", () => this.disconnect(server).catch(() => {}));
    server.addEventListener("error", () => this.disconnect(server).catch(() => {}));
    server.send(JSON.stringify({ type: "hello", payload: { connected: true } }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleSocketMessage(socket, data) {
    const messageSize = getRoomMessageByteLength(data);
    if (messageSize > ROOM_MESSAGE_BYTE_LIMIT) {
      try { socket.close(1009, "Room message is too large."); } catch {}
      return;
    }
    const message = JSON.parse(typeof data === "string" ? data : await new Response(data).text());
    if (message.type === "join") return this.join(socket, message.payload || {});
    const client = this.clients.get(socket);
    if (!client || !this.room) return;
    if (!this.allowRoomMessage(client, "all")) throw new Error("Slow down a little.");
    if (message.type === "guess" && !this.allowRoomMessage(client, "guess")) throw new Error("Guesses are coming in too fast.");
    if (message.type === "drawing-preview" && !this.allowRoomMessage(client, "drawing-preview")) return;
    if (message.type === "drawing-sync" && !this.allowRoomMessage(client, "drawing-sync")) return;
    if (!["guess", "drawing-preview", "drawing-sync"].includes(message.type) && !this.allowRoomMessage(client, "control")) throw new Error("Room changes are coming in too fast.");
    if (message.type === "select-categories") return this.hostOnly(client, () => this.updateSelection(message.payload));
    if (message.type === "room-settings") return this.hostOnly(client, () => this.updateSettings(message.payload));
    if (message.type === "transfer-leader") return this.hostOnly(client, () => this.transferLeader(message.payload));
    if (message.type === "leave-room") return this.leaveRoom(socket);
    if (message.type === "start-game") return this.hostOnly(client, () => this.startGame(message.payload));
    if (message.type === "set-choices") return this.hostOnly(client, () => this.setChoices(message.payload));
    if (message.type === "choose-word") return this.drawerOnly(client, () => this.chooseWord(message.payload));
    if (message.type === "choice-vote") return this.submitChoiceVote(client, message.payload);
    if (message.type === "guess") return this.submitGuess(client, message.payload);
    if (message.type === "drawing-preview") return this.drawerOnly(client, () => this.previewDrawing(socket, message.payload));
    if (message.type === "drawing-sync") return this.drawerOnly(client, () => this.syncDrawing(message.payload));
  }

  allowRoomMessage(client, key) {
    const rule = ROOM_RATE_LIMITS[key];
    if (!rule) return true;
    const now = Date.now();
    client.rateLimits ||= {};
    const bucket = client.rateLimits[key];
    if (!bucket || bucket.resetAt <= now) {
      client.rateLimits[key] = { count: 1, resetAt: now + rule.windowMs };
      return true;
    }
    if (bucket.count >= rule.limit) return false;
    bucket.count += 1;
    return true;
  }

  async join(socket, payload) {
    const code = normalizeRoomCode(payload.code);
    const createRequested = payload.create === true;
    const player = {
      id: String(payload.clientId || "").slice(0, 80),
      name: String(payload.name || "Player").trim().slice(0, 20) || "Player",
      score: 0,
      connectedAt: Date.now(),
    };
    if (code.length !== 6 || !player.id) throw new Error("A valid 6-character room code and player id are required.");
    if (!this.room) {
      if (!createRequested) throw new Error("Room not found. Check the code or ask the host to create it first.");
      this.room = createEmptyRoomState(code, player);
    }
    else {
      if (createRequested) throw new Error("That room code is already in use. Create a new room and try again.");
      const alreadyInRoom = this.room.players.some((item) => item.id === player.id);
      const nameTaken = this.room.players.some((item) => (
        item.id !== player.id && normalizePlayerName(item.name) === normalizePlayerName(player.name)
      ));
      if (nameTaken) throw new Error("That name is already taken in this room.");
      if (!alreadyInRoom && this.room.players.length >= (this.room.maxPlayers || 8)) throw new Error("That room is full.");
      this.room.players = this.room.players.some((item) => item.id === player.id)
        ? this.room.players.map((item) => item.id === player.id ? { ...item, name: player.name } : item)
        : [...this.room.players, player];
      this.room.updatedAt = Date.now();
    }
    this.clients.set(socket, { id: player.id, name: player.name, rateLimits: {} });
    await this.save();
    this.broadcastState();
  }

  async disconnect(socket) {
    await this.leaveRoom(socket);
  }

  async leaveRoom(socket) {
    const client = this.clients.get(socket);
    this.clients.delete(socket);
    if (!client || !this.room) return;
    const wasHost = this.room.hostId === client.id;
    const wasDrawer = this.room.drawerId === client.id;
    const players = this.room.players.filter((player) => player.id !== client.id);
    if (!players.length) {
      this.room = null;
      await this.state.storage.delete("room");
      await this.state.storage.deleteAlarm();
      return;
    }

    const nextHostId = wasHost ? players[0].id : this.room.hostId;
    const shouldResetRound = wasDrawer || (this.room.phase !== "lobby" && players.length < 2);
    this.room = {
      ...this.room,
      players,
      hostId: nextHostId,
      drawerId: shouldResetRound ? null : this.room.drawerId,
      phase: shouldResetRound ? "lobby" : this.room.phase,
      answer: shouldResetRound ? null : this.room.answer,
      choices: shouldResetRound ? [] : this.room.choices,
      choiceVotes: shouldResetRound ? {} : this.room.choiceVotes || {},
      guesses: shouldResetRound ? [] : this.room.guesses,
      solved: shouldResetRound ? [] : this.room.solved,
      endAt: shouldResetRound ? null : this.room.endAt,
      drawingOperations: shouldResetRound ? [] : this.room.drawingOperations,
      updatedAt: Date.now(),
    };
    if (shouldResetRound) await this.state.storage.deleteAlarm();
    await this.save();
    this.broadcastState();
  }

  async save() {
    await this.state.storage.put("room", this.room);
  }

  hostOnly(client, action) {
    if (client.id !== this.room.hostId) throw new Error("Only the party leader can do that.");
    return action();
  }

  drawerOnly(client, action) {
    if (client.id !== this.room.drawerId) throw new Error("Only the drawer can do that.");
    return action();
  }

  async updateSelection(payload) {
    if (this.room.phase !== "lobby") return;
    this.room.categorySelection = String(payload?.selection || "all").slice(0, 600);
    this.room.updatedAt = Date.now();
    await this.save();
    this.broadcastState();
  }

  async updateSettings(payload) {
    if (!["lobby", "finished"].includes(this.room.phase)) return;
    const maxPlayers = Math.max(this.room.players.length, Math.min(16, Math.max(2, Number(payload?.maxPlayers || this.room.maxPlayers || 8))));
    const roundsPerPlayer = Math.min(10, Math.max(1, Number(payload?.roundsPerPlayer || this.room.roundsPerPlayer || 3)));
    const roundSeconds = Math.min(300, Math.max(15, Number(payload?.roundSeconds || this.room.roundSeconds || 90)));
    this.room.maxPlayers = maxPlayers;
    this.room.roundsPerPlayer = roundsPerPlayer;
    this.room.roundSeconds = roundSeconds;
    this.room.updatedAt = Date.now();
    await this.save();
    this.broadcastState();
  }

  async transferLeader(payload) {
    if (!["lobby", "finished"].includes(this.room.phase)) return;
    const hostId = String(payload?.hostId || "");
    if (!this.room.players.some((player) => player.id === hostId)) return;
    this.room.hostId = hostId;
    this.room.updatedAt = Date.now();
    await this.save();
    this.broadcastState();
  }

  async startGame(payload) {
    if (!this.room || this.room.players.length < 2) return;
    const drawerId = this.room.players[0]?.id || null;
    this.room = {
      ...this.room,
      phase: "choosing",
      drawerId,
      turnIndex: 0,
      roundIndex: 0,
      roundsPerPlayer: this.room.roundsPerPlayer || 3,
      answer: null,
      choices: this.sanitizeChoices(payload?.choices),
      choiceVotes: {},
      guesses: [],
      solved: [],
      endAt: null,
      drawingOperations: [],
      players: this.room.players.map((player) => ({ ...player, score: 0 })),
      updatedAt: Date.now(),
    };
    await this.state.storage.deleteAlarm();
    await this.save();
    this.broadcastState();
  }

  async setChoices(payload) {
    if (!this.room || this.room.phase !== "choosing") return;
    this.room.choices = this.sanitizeChoices(payload?.choices);
    this.room.choiceVotes = {};
    this.room.updatedAt = Date.now();
    await this.save();
    this.broadcastState();
  }

  sanitizeChoices(choices) {
    return Array.isArray(choices) ? choices.map(sanitizePrompt).filter((item) => item.answer).slice(0, 3) : [];
  }

  async chooseWord(payload) {
    if (this.room.phase !== "choosing") return;
    const answer = sanitizePrompt(payload?.answer);
    if (!answer.answer) return;
    this.room = {
      ...this.room,
      phase: "drawing",
      answer,
      choiceVotes: {},
      guesses: [],
      solved: [],
      endAt: Date.now() + this.room.roundSeconds * 1000,
      drawingOperations: [],
      recentPromptKeys: [...this.room.recentPromptKeys, roomPromptKey(answer)].slice(-32),
      updatedAt: Date.now(),
    };
    await this.save();
    await this.state.storage.setAlarm(this.room.endAt);
    this.broadcastState();
  }

  getWinningChoiceIndex(votes) {
    const counts = (this.room.choices || []).map((_, index) => Object.values(votes || {}).filter((vote) => vote === index).length);
    return counts.reduce((bestIndex, count, index) => count > counts[bestIndex] ? index : bestIndex, 0);
  }

  async submitChoiceVote(client, payload) {
    if (!this.room || this.room.phase !== "choosing" || client.id === this.room.drawerId) return;
    const choiceIndex = Math.trunc(Number(payload?.choiceIndex));
    if (!Number.isFinite(choiceIndex) || choiceIndex < 0 || choiceIndex >= (this.room.choices || []).length) return;
    const choiceVotes = { ...(this.room.choiceVotes || {}), [client.id]: choiceIndex };
    const eligibleVoters = this.room.players.filter((player) => player.id !== this.room.drawerId);
    const votedCount = Object.keys(choiceVotes).filter((playerId) => eligibleVoters.some((player) => player.id === playerId)).length;
    if (votedCount >= eligibleVoters.length) {
      const answer = this.room.choices[this.getWinningChoiceIndex(choiceVotes)];
      if (answer) return this.chooseWord({ answer });
    }
    this.room.choiceVotes = choiceVotes;
    this.room.updatedAt = Date.now();
    await this.save();
    this.broadcastState();
  }

  async submitGuess(client, payload) {
    if (this.room.phase !== "drawing" || !this.room.answer || client.id === this.room.drawerId) return;
    const text = String(payload?.text || "").trim().slice(0, 80);
    if (!text) return;
    const aliases = [this.room.answer.answer, ...(this.room.answer.aliases || [])].map(normalizeGuess);
    const correct = aliases.includes(normalizeGuess(text));
    const alreadySolved = this.room.solved.some((item) => item.playerId === client.id);
    const remainingRatio = this.room.endAt ? Math.max(0, this.room.endAt - Date.now()) / (this.room.roundSeconds * 1000) : 0;
    const points = correct && !alreadySolved ? Math.round(100 + remainingRatio * 300) : 0;
    const entry = {
      id: crypto.randomUUID(),
      playerId: client.id,
      playerName: client.name,
      text,
      correct: correct && !alreadySolved,
      createdAt: Date.now(),
    };
    const drawerBonus = correct && !alreadySolved ? 50 : 0;
    this.room.guesses = [...this.room.guesses.slice(-30), entry];
    if (correct && !alreadySolved) {
      this.room.solved = [...this.room.solved, { playerId: client.id, playerName: client.name, points, solvedAt: Date.now() }];
      this.room.players = this.room.players.map((player) => {
        if (player.id === client.id) return { ...player, score: player.score + points };
        if (player.id === this.room.drawerId) return { ...player, score: player.score + drawerBonus };
        return player;
      });
    }
    const guessers = this.room.players.filter((player) => player.id !== this.room.drawerId);
    if (guessers.length > 0 && this.room.solved.length >= guessers.length) await this.finishTurn();
    else {
      this.room.updatedAt = Date.now();
      await this.save();
      this.broadcastState();
    }
  }

  async syncDrawing(payload) {
    if (this.room.phase !== "drawing") return;
    const operations = sanitizeDrawingOperations(payload?.operations);
    this.room.drawingOperations = operations;
    this.room.updatedAt = Date.now();
    await this.save();
    this.broadcastState();
  }

  previewDrawing(senderSocket, payload) {
    if (this.room.phase !== "drawing") return;
    const operation = payload?.operation ? sanitizeDrawingOperations([payload.operation]).at(0) || null : null;
    for (const [socket] of [...this.clients.entries()]) {
      if (socket === senderSocket) continue;
      try {
        socket.send(JSON.stringify({ type: "drawing-preview", payload: { operation } }));
      } catch {
        this.clients.delete(socket);
      }
    }
  }

  async finishTurn() {
    if (!this.room || this.room.phase !== "drawing") return;
    this.room.phase = "results";
    this.room.endAt = null;
    this.room.updatedAt = Date.now();
    await this.save();
    await this.state.storage.setAlarm(Date.now() + 10000);
    this.broadcastState();
  }

  async advanceTurn() {
    if (!this.room) return;
    const next = getNextRoomTurn(this.room);
    if (!next) {
      this.room = { ...this.room, phase: "finished", answer: null, choices: [], choiceVotes: {}, drawerId: null, endAt: null, drawingOperations: [], updatedAt: Date.now() };
      await this.state.storage.deleteAlarm();
      await this.save();
      this.broadcastState();
      return;
    }
    this.room = {
      ...this.room,
      phase: "choosing",
      ...next,
      answer: null,
      choices: [],
      choiceVotes: {},
      guesses: [],
      solved: [],
      endAt: null,
      drawingOperations: [],
      updatedAt: Date.now(),
    };
    await this.state.storage.deleteAlarm();
    await this.save();
    this.broadcastState();
  }

  async alarm() {
    await this.ready;
    if (!this.room) return;
    if (this.room.phase === "drawing") await this.finishTurn();
    else if (this.room.phase === "results") await this.advanceTurn();
  }

  stateForClient(client) {
    if (!this.room) return null;
    const state = client?.id === this.room.drawerId ? this.room : publicRoomState(this.room);
    return {
      ...state,
      drawingOperations: this.room.drawingOperations || [],
    };
  }

  broadcastState() {
    for (const [socket, client] of [...this.clients.entries()]) {
      try {
        socket.send(JSON.stringify({ type: "room-state", payload: this.stateForClient(client) }));
      } catch {
        this.clients.delete(socket);
      }
    }
  }
}

const base64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomToken = (bytes = 24) => {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return base64Url(data);
};

async function encryptionKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptJson(secret, value) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await encryptionKey(secret);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(value)));
  return { iv: base64Url(iv), data: base64Url(new Uint8Array(encrypted)) };
}

async function decryptJson(secret, stored) {
  if (!stored?.iv || !stored?.data) return null;
  const decode = (value) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
  const key = await encryptionKey(secret);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(stored.iv) }, key, decode(stored.data));
  return JSON.parse(decoder.decode(decrypted));
}

async function twitchFetch(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Twitch request failed (${response.status})`);
  return body;
}

export class FindrawSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sseClients = new Set();
    this.wsClients = new Set();
    this.eventSubSocket = null;
    this.eventSubStatus = "disconnected";
    this.eventSubSessionId = null;
    this.lastEventSubMessageAt = null;
    this.lastChatMessageAt = null;
    this.lastEventSubClose = null;
    this.lastError = null;
    this.keepaliveTimer = null;
    this.reconnectTimer = null;
    this.processedMessageIds = new Set();
    this.currentRound = null;
    this.twitchSession = null;
    this.ready = this.restore();
  }

  async restore() {
    this.twitchSession = await this.loadTwitchSession();
    this.currentRound = await this.state.storage.get("currentRound") || null;
    if (this.twitchSession) {
      try {
        await this.validSession();
        this.connectEventSub().catch((error) => {
          console.error("EventSub restore failed", error.message);
          this.setEventSubStatus("disconnected");
        });
      } catch (error) {
        console.error("Saved Twitch session could not be restored", error.message);
        this.twitchSession = null;
      }
    }
  }

  configured() {
    return Boolean(this.env.TWITCH_CLIENT_ID && this.env.TWITCH_CLIENT_SECRET && this.env.SESSION_SECRET);
  }

  async fetch(request) {
    await this.ready;
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json({ ok: true }, { request });
      if (url.pathname === "/auth/twitch/start") return this.startTwitchAuth(request, url);
      if (url.pathname === "/auth/twitch/callback") return this.finishTwitchAuth(request, url);
      if (url.pathname === "/api/twitch/session") return json(this.sessionSummary(), { request });
      if (url.pathname === "/api/twitch/disconnect" && request.method === "POST") return this.disconnectTwitch(request);
      if (url.pathname === "/api/twitch/reconnect" && request.method === "POST") return this.reconnectTwitch(request);
      if (url.pathname === "/api/twitch/debug") return json(this.debugSummary(), { request });
      if (url.pathname === "/api/live") return this.liveSocket(request);
      if (url.pathname === "/api/events") return this.events(request);
      if (url.pathname === "/api/leaderboard") return json(await this.getLeaderboard(), { request });
      if (url.pathname === "/api/round/start" && request.method === "POST") return this.startRound(request);
      if (url.pathname === "/api/round/end" && request.method === "POST") return this.endRound(request);
      if (url.pathname === "/api/points/adjust" && request.method === "POST") return this.adjustViewerPoints(request);
      return json({ error: "Not found" }, { status: 404, request });
    } catch (error) {
      console.error(error);
      return json({ error: error.message || "Request failed" }, { status: 500, request });
    }
  }

  sessionSummary() {
    return {
      configured: this.configured(),
      authenticated: Boolean(this.twitchSession),
      eventSubStatus: this.eventSubStatus,
      user: this.twitchSession ? {
        id: this.twitchSession.userId,
        login: this.twitchSession.login,
        displayName: this.twitchSession.displayName,
      } : null,
    };
  }

  broadcast(event) {
    const chunk = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    for (const writer of [...this.sseClients]) {
      writer.write(chunk).catch(() => this.sseClients.delete(writer));
    }
    const payload = JSON.stringify(event);
    for (const socket of [...this.wsClients]) {
      try {
        socket.send(payload);
      } catch {
        this.wsClients.delete(socket);
      }
    }
  }

  publishSession() {
    this.broadcast({ type: "twitch-session", payload: this.sessionSummary() });
  }

  setEventSubStatus(status) {
    this.eventSubStatus = status;
    this.publishSession();
  }

  rememberError(error) {
    this.lastError = {
      message: error?.message || String(error),
      at: new Date().toISOString(),
    };
  }

  debugSummary() {
    return {
      configured: this.configured(),
      authenticated: Boolean(this.twitchSession),
      eventSubStatus: this.eventSubStatus,
      eventSubSessionId: this.eventSubSessionId,
      lastEventSubMessageAt: this.lastEventSubMessageAt,
      lastChatMessageAt: this.lastChatMessageAt,
      lastEventSubClose: this.lastEventSubClose,
      lastError: this.lastError,
      currentRound: this.currentRound ? {
        id: this.currentRound.id,
        status: this.currentRound.status,
        answer: this.currentRound.answer,
        target: this.currentRound.target,
        solvers: this.currentRound.solvers.length,
      } : null,
      liveClients: this.sseClients.size + this.wsClients.size,
      sseClients: this.sseClients.size,
      webSocketClients: this.wsClients.size,
      user: this.twitchSession ? {
        id: this.twitchSession.userId,
        login: this.twitchSession.login,
        displayName: this.twitchSession.displayName,
      } : null,
    };
  }

  clearEventSubTimers() {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.keepaliveTimer = null;
    this.reconnectTimer = null;
  }

  scheduleKeepaliveDeadline(seconds = 30) {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = setTimeout(() => {
      try { this.eventSubSocket?.close(); } catch {}
    }, (seconds + 10) * 1000);
  }

  async loadTwitchSession() {
    if (!this.env.SESSION_SECRET) return null;
    const stored = await this.state.storage.get("twitchSession");
    if (!stored) return null;
    return decryptJson(this.env.SESSION_SECRET, stored);
  }

  async saveTwitchSession(session) {
    await this.state.storage.put("twitchSession", await encryptJson(this.env.SESSION_SECRET, session));
  }

  async clearTwitchSession() {
    await this.state.storage.delete("twitchSession");
  }

  async validSession() {
    if (!this.twitchSession) return null;
    if (this.twitchSession.expiresAt < Date.now() + 60_000) await this.refreshSession();
    if (Date.now() - (this.twitchSession.validatedAt || 0) > 60 * 60 * 1000) {
      const validation = await twitchFetch("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: `OAuth ${this.twitchSession.accessToken}` },
      });
      this.twitchSession = {
        ...this.twitchSession,
        userId: validation.user_id,
        login: validation.login,
        expiresAt: Date.now() + validation.expires_in * 1000,
        validatedAt: Date.now(),
      };
      await this.saveTwitchSession(this.twitchSession);
    }
    return this.twitchSession;
  }

  async refreshSession() {
    if (!this.twitchSession?.refreshToken) return null;
    const body = new URLSearchParams({
      client_id: this.env.TWITCH_CLIENT_ID,
      client_secret: this.env.TWITCH_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: this.twitchSession.refreshToken,
    });
    const token = await twitchFetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    this.twitchSession = {
      ...this.twitchSession,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || this.twitchSession.refreshToken,
      expiresAt: Date.now() + token.expires_in * 1000,
      validatedAt: Date.now(),
    };
    await this.saveTwitchSession(this.twitchSession);
    return this.twitchSession;
  }

  async subscribeToChat(sessionId) {
    const session = await this.validSession();
    return twitchFetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Client-Id": this.env.TWITCH_CLIENT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "channel.chat.message",
        version: "1",
        condition: {
          broadcaster_user_id: session.userId,
          user_id: session.userId,
        },
        transport: { method: "websocket", session_id: sessionId },
      }),
    });
  }

  async connectEventSub(url = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30", shouldSubscribe = true) {
    if (!this.twitchSession) return;
    this.clearEventSubTimers();
    try { this.eventSubSocket?.close(); } catch {}
    this.eventSubSessionId = null;
    this.setEventSubStatus("connecting");

    const socket = new WebSocket(url);
    this.eventSubSocket = socket;
    socket.addEventListener("message", (event) => {
      this.handleEventSubMessage(event.data, shouldSubscribe).catch((error) => {
        console.error("EventSub message failed", error.message);
        this.rememberError(error);
      });
    });
    socket.addEventListener("close", (event) => {
      if (this.eventSubSocket !== socket || !this.twitchSession) return;
      this.lastEventSubClose = {
        code: event.code,
        reason: event.reason || "",
        wasClean: event.wasClean,
        at: new Date().toISOString(),
      };
      this.setEventSubStatus("reconnecting");
      this.reconnectTimer = setTimeout(() => this.connectEventSub().catch(console.error), 3000);
    });
    socket.addEventListener("error", (event) => {
      console.error("EventSub socket error");
      this.rememberError({ message: `EventSub socket error (${event.type})` });
    });
  }

  async handleEventSubMessage(data, shouldSubscribe) {
    const raw = typeof data === "string" ? data : await new Response(data).text();
    const envelope = JSON.parse(raw);
    this.lastEventSubMessageAt = new Date().toISOString();
    const messageType = envelope.metadata?.message_type;
    if (messageType === "session_welcome") {
      this.eventSubSessionId = envelope.payload.session.id;
      this.scheduleKeepaliveDeadline(envelope.payload.session.keepalive_timeout_seconds);
      if (shouldSubscribe) await this.subscribeToChat(envelope.payload.session.id);
      this.setEventSubStatus("connected");
      return;
    }
    if (messageType === "session_keepalive") {
      this.scheduleKeepaliveDeadline();
      return;
    }
    if (messageType === "session_reconnect") {
      await this.connectEventSub(envelope.payload.session.reconnect_url, false);
      return;
    }
    if (messageType === "revocation") {
      this.setEventSubStatus("revoked");
      return;
    }
    if (messageType === "notification") {
      this.scheduleKeepaliveDeadline();
      if (!this.rememberMessage(envelope.metadata.message_id)) return;
      if (envelope.payload.subscription.type === "channel.chat.message") {
        this.lastChatMessageAt = new Date().toISOString();
        await this.processChatMessage(envelope.payload.event);
      }
    }
  }

  rememberMessage(messageId) {
    if (this.processedMessageIds.has(messageId)) return false;
    this.processedMessageIds.add(messageId);
    if (this.processedMessageIds.size > 2000) {
      this.processedMessageIds = new Set([...this.processedMessageIds].slice(-1000));
    }
    return true;
  }

  async processChatMessage(event) {
    const message = {
      id: event.message_id,
      userId: event.chatter_user_id,
      name: event.chatter_user_name || event.chatter_user_login,
      message: event.message?.text || "",
      color: event.color || null,
    };
    this.broadcast({ type: "chat-message", payload: message });

    if (!this.currentRound || this.currentRound.status !== "playing") return;
    if (this.currentRound.solvedUserIds.includes(message.userId)) return;
    if (!this.currentRound.answers.includes(normalizeGuess(message.message))) return;

    const position = this.currentRound.solvers.length + 1;
    const points = pointsForPosition(position);
    this.currentRound.solvedUserIds.push(message.userId);
    const solver = { userId: message.userId, name: message.name, points, position };
    this.currentRound.solvers.push(solver);
    await this.state.storage.put("currentRound", this.currentRound);
    await this.adjustPoints({
      channelId: this.twitchSession.userId,
      userId: message.userId,
      displayName: message.name,
      delta: points,
      reason: `Correct guess (#${position})`,
      roundId: this.currentRound.id,
    });
    this.broadcast({ type: "correct-guess", payload: { roundId: this.currentRound.id, solver } });
    this.broadcast({ type: "leaderboard", payload: await this.getLeaderboard() });
    if (this.currentRound.solvers.length >= this.currentRound.target) {
      this.currentRound.status = "ended";
      await this.state.storage.put("currentRound", this.currentRound);
      this.broadcast({ type: "round-ended", payload: { roundId: this.currentRound.id, reason: "target-reached" } });
    }
  }

  async startTwitchAuth(request, url) {
    if (!this.configured()) return new Response("Twitch is not configured.", { status: 503, headers: corsHeaders(request) });
    const state = randomToken();
    const requestedReturnTo = String(url.searchParams.get("returnTo") || "");
    const returnTo = ["/auto-draw", "/draw", "/room"].includes(requestedReturnTo) ? requestedReturnTo : "/draw";
    const states = await this.state.storage.get("oauthStates") || {};
    const now = Date.now();
    for (const [key, entry] of Object.entries(states)) {
      if (entry.expiresAt < now) delete states[key];
    }
    states[state] = { expiresAt: now + 10 * 60 * 1000, returnTo };
    await this.state.storage.put("oauthStates", states);

    const authUrl = new URL("https://id.twitch.tv/oauth2/authorize");
    authUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: this.env.TWITCH_CLIENT_ID,
      redirect_uri: this.env.TWITCH_REDIRECT_URI,
      scope: TWITCH_SCOPES.join(" "),
      state,
    });
    return Response.redirect(authUrl.toString(), 302);
  }

  async finishTwitchAuth(request, url) {
    const state = String(url.searchParams.get("state") || "");
    const code = String(url.searchParams.get("code") || "");
    const states = await this.state.storage.get("oauthStates") || {};
    const stateEntry = states[state];
    delete states[state];
    await this.state.storage.put("oauthStates", states);
    if (!code || !state || !stateEntry || stateEntry.expiresAt < Date.now()) {
      return new Response("The Twitch sign-in state was invalid or expired.", { status: 400, headers: corsHeaders(request) });
    }

    const body = new URLSearchParams({
      client_id: this.env.TWITCH_CLIENT_ID,
      client_secret: this.env.TWITCH_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.env.TWITCH_REDIRECT_URI,
    });
    const token = await twitchFetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const validation = await twitchFetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${token.access_token}` },
    });
    const users = await twitchFetch(`https://api.twitch.tv/helix/users?id=${validation.user_id}`, {
      headers: { Authorization: `Bearer ${token.access_token}`, "Client-Id": this.env.TWITCH_CLIENT_ID },
    });
    this.twitchSession = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      validatedAt: Date.now(),
      userId: validation.user_id,
      login: validation.login,
      displayName: users.data?.[0]?.display_name || validation.login,
    };
    await this.saveTwitchSession(this.twitchSession);
    await this.connectEventSub();
    return Response.redirect(`${this.env.FRONTEND_URL}${stateEntry.returnTo}?twitch=connected`, 302);
  }

  async disconnectTwitch(request) {
    this.twitchSession = null;
    this.currentRound = null;
    this.clearEventSubTimers();
    try { this.eventSubSocket?.close(); } catch {}
    this.eventSubSocket = null;
    await this.clearTwitchSession();
    await this.state.storage.delete("currentRound");
    this.setEventSubStatus("disconnected");
    return json({ ok: true }, { request });
  }

  async reconnectTwitch(request) {
    if (!this.twitchSession) return json(this.sessionSummary(), { request });
    try {
      await this.validSession();
      await this.connectEventSub();
      return json(this.sessionSummary(), { request });
    } catch (error) {
      this.rememberError(error);
      this.setEventSubStatus("disconnected");
      return json({ error: error.message || "Could not reconnect Twitch chat." }, { status: 500, request });
    }
  }

  liveSocket(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ error: "Expected websocket upgrade." }, { status: 426, request });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.wsClients.add(server);
    server.send(JSON.stringify({ type: "twitch-session", payload: this.sessionSummary() }));
    server.addEventListener("close", () => this.wsClients.delete(server));
    server.addEventListener("error", () => this.wsClients.delete(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  events(request) {
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    this.sseClients.add(writer);
    writer.write(encoder.encode(`data: ${JSON.stringify({ type: "twitch-session", payload: this.sessionSummary() })}\n\n`)).catch(() => this.sseClients.delete(writer));
    request.signal.addEventListener("abort", () => {
      this.sseClients.delete(writer);
      writer.close().catch(() => undefined);
    });
    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        ...corsHeaders(request),
      },
    });
  }

  async getPointsData() {
    return await this.state.storage.get("points") || { version: 1, channels: {}, ledger: [] };
  }

  async adjustPoints({ channelId, userId, displayName, delta, reason, roundId }) {
    const data = await this.getPointsData();
    const channel = data.channels[channelId] || {};
    const current = channel[userId] || { displayName, score: 0 };
    channel[userId] = { displayName, score: Math.max(0, current.score + delta) };
    data.channels[channelId] = channel;
    data.ledger.push({
      id: crypto.randomUUID(),
      channelId,
      userId,
      displayName,
      delta,
      reason,
      roundId: roundId || null,
      createdAt: new Date().toISOString(),
    });
    data.ledger = data.ledger.slice(-5000);
    await this.state.storage.put("points", data);
    return channel[userId];
  }

  async getLeaderboard(channelId = this.twitchSession?.userId) {
    if (!channelId) return [];
    const data = await this.getPointsData();
    return Object.entries(data.channels[channelId] || {})
      .map(([userId, value]) => ({ userId, ...value }))
      .sort((first, second) => second.score - first.score)
      .slice(0, 100);
  }

  async startRound(request) {
    const body = await request.json().catch(() => ({}));
    const answer = String(body.answer || "").trim();
    const aliases = Array.isArray(body.aliases) ? body.aliases : [];
    const target = Math.min(100, Math.max(1, Number(body.target) || 10));
    if (!answer) return json({ error: "An answer is required." }, { status: 400, request });
    this.currentRound = {
      id: crypto.randomUUID(),
      status: "playing",
      answer,
      answers: [...new Set([answer, ...aliases].map(normalizeGuess).filter(Boolean))],
      target,
      solvers: [],
      solvedUserIds: [],
      startedAt: Date.now(),
    };
    await this.state.storage.put("currentRound", this.currentRound);
    this.broadcast({ type: "round-started", payload: { roundId: this.currentRound.id, target } });
    return json({ roundId: this.currentRound.id }, { request });
  }

  async endRound(request) {
    if (this.currentRound) {
      this.currentRound.status = "ended";
      await this.state.storage.put("currentRound", this.currentRound);
      this.broadcast({ type: "round-ended", payload: { roundId: this.currentRound.id, reason: "manual" } });
    }
    return json({ ok: true }, { request });
  }

  async adjustViewerPoints(request) {
    if (!this.twitchSession) return json({ error: "Connect Twitch first." }, { status: 401, request });
    const body = await request.json().catch(() => ({}));
    const userId = String(body.userId || "");
    const displayName = String(body.displayName || "");
    const delta = Math.trunc(Number(body.delta));
    if (!userId || !displayName || !Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 10000) {
      return json({ error: "A valid viewer and adjustment are required." }, { status: 400, request });
    }
    const viewer = await this.adjustPoints({
      channelId: this.twitchSession.userId,
      userId,
      displayName,
      delta,
      reason: String(body.reason || "Streamer adjustment").slice(0, 120),
      roundId: this.currentRound?.id,
    });
    const leaderboard = await this.getLeaderboard(this.twitchSession.userId);
    this.broadcast({ type: "leaderboard", payload: leaderboard });
    return json({ viewer, leaderboard }, { request });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/community-packs")) {
      const id = env.FINDRAW_COMMUNITY.idFromName("catalog");
      return env.FINDRAW_COMMUNITY.get(id).fetch(request);
    }
    const roomMatch = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{6})\/(live|state)$/);
    if (roomMatch) {
      const id = env.FINDRAW_ROOM.idFromName(normalizeRoomCode(roomMatch[1]));
      return env.FINDRAW_ROOM.get(id).fetch(request);
    }
    const id = env.FINDRAW_SESSION.idFromName("main");
    return env.FINDRAW_SESSION.get(id).fetch(request);
  },
};
