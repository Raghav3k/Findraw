import {
  COMMUNITY_REPORT_QUARANTINE_THRESHOLD,
  CommunityPackValidationError,
  publicCommunityPack,
  validateCommunityPackInput,
  validateCommunityReportInput,
} from "../../../shared/communityPacks.mjs";
import {
  ensureWeeklySeason,
  findWeeklySeason,
  normalizePlacementRewards,
  publicWeeklySeason,
  weeklyPointsSummary,
  weeklyStandings,
} from "../../../shared/weeklyPoints.mjs";

import builtinWordPacks from "../../../shared/builtinWordPacks.json" with { type: "json" };
import { channelPointsStorage } from "../../../shared/channelPointsStorage.mjs";
import { pickWordChoices } from "../../../shared/wordQueue.mjs";
import { applyDrawingDelta } from "../../../shared/drawingDelta.mjs";
import { DurableDrawing, DRAWING_JOURNAL_KEY } from "../../../shared/durableDrawing.mjs";
import { prunePointsHistory } from "../../../shared/pointsRetention.mjs";
import { SecurityError, validateSocketMessage, validateRoomSettings, boundedJson, validateHttpBody, httpSchemaKey } from "../../../shared/security.mjs";
import { issueSession, readSession, checkOrigin, edgeGate, admission, releaseAdmission, requireHuman, verifyHuman, randomId, privateHash, logSecurityViolation, loginErrorResponse } from "./security.js";
export { FindrawAdmission } from "./security.js";

const TWITCH_SCOPES = ["user:read:chat", "user:write:chat"];
const TWITCH_CHAT_COMMANDS = new Set(["!finpoints", "!finsession", "!finrewards"]);
const logTwitchCommand = (stage, details = {}) => {
  console.info(`[Twitch command] ${stage}`, { at: new Date().toISOString(), ...details });
};
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ROOM_MESSAGE_BYTE_LIMIT = 256 * 1024;
const ROOM_MAX_DRAWING_OPERATIONS = 500;
const ROOM_MAX_DRAWING_POINTS = 8000;
const ROOM_MAX_POINTS_PER_OPERATION = 900;
const ROOM_COORDINATE_LIMIT = 10000;
const ROOM_RATE_LIMITS = {
  join: { limit: 3, windowMs: 15000 },
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
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...corsHeaders(init.request),
    ...(init.headers || {}),
  },
});

const corsHeaders = (request) => {
  const origin = request?.headers?.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Findraw-Session",
    "Access-Control-Max-Age": "3600",
    "Access-Control-Allow-Credentials": "true",
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

const ordinal = (position) => {
  const remainder = position % 100;
  if (remainder >= 11 && remainder <= 13) return `${position}th`;
  if (position % 10 === 1) return `${position}st`;
  if (position % 10 === 2) return `${position}nd`;
  if (position % 10 === 3) return `${position}rd`;
  return `${position}th`;
};

const emptyPointsData = () => ({ version: 3, channels: {}, weeklyChannels: {}, weeklyHistory: [], ledger: [], activeSessions: {}, sessionHistory: [] });
const normalizePointsData = (value) => ({
  ...emptyPointsData(),
  ...(value && typeof value === "object" ? value : {}),
  version: 3,
  channels: value?.channels && typeof value.channels === "object" ? value.channels : {},
  weeklyChannels: value?.weeklyChannels && typeof value.weeklyChannels === "object" ? value.weeklyChannels : {},
  weeklyHistory: Array.isArray(value?.weeklyHistory) ? value.weeklyHistory : [],
  ledger: Array.isArray(value?.ledger) ? value.ledger : [],
  activeSessions: value?.activeSessions && typeof value.activeSessions === "object" ? value.activeSessions : {},
  sessionHistory: Array.isArray(value?.sessionHistory) ? value.sessionHistory : [],
});
// A legacy browser can contain several accounts. Never export another channel's data.
const channelPointsSnapshot = (value, channelId) => {
  const data = normalizePointsData(value);
  return {
    ...emptyPointsData(),
    channels: data.channels[channelId] ? { [channelId]: data.channels[channelId] } : {},
    weeklyChannels: data.weeklyChannels[channelId] ? { [channelId]: data.weeklyChannels[channelId] } : {},
    activeSessions: data.activeSessions[channelId] ? { [channelId]: data.activeSessions[channelId] } : {},
    weeklyHistory: data.weeklyHistory.filter((entry) => entry.channelId === channelId),
    sessionHistory: data.sessionHistory.filter((entry) => entry.channelId === channelId),
    ledger: data.ledger.filter((entry) => entry.channelId === channelId),
  };
};
const hasChannelRecords = (data, channelId) => Boolean(
  Object.keys(data.channels[channelId] || {}).length ||
  Object.keys(data.weeklyChannels[channelId]?.participants || {}).length ||
  data.weeklyChannels[channelId]?.rewards?.length || data.activeSessions[channelId] ||
  data.weeklyHistory.length || data.sessionHistory.length || data.ledger.length
);
const CHANNEL_API = {
  "GET /api/leaderboard": "getLeaderboard",
  "GET /api/weekly-points": "weeklyPointsSummary",
  "POST /api/weekly-points/rewards": "setWeeklyRewards",
  "POST /api/weekly-points/reward": "setWeeklyReward",
  "GET /api/artist-session": "artistSessionSummary",
  "POST /api/artist-session/start": "startArtistSession",
  "POST /api/artist-session/end": "endArtistSession",
  "POST /api/artist-session/reward": "setArtistSessionReward",
  "POST /api/points/adjust": "adjustViewerPoints",
};
const publicArtistSession = (session) => session ? {
  id: session.id,
  name: session.name,
  status: session.status,
  startedAt: session.startedAt,
  endedAt: session.endedAt || null,
  rewards: session.rewards,
  standings: Object.entries(session.participants || {})
    .map(([userId, value]) => ({ userId, ...value }))
    .sort((first, second) => second.score - first.score || first.displayName.localeCompare(second.displayName)),
} : null;
const normalizeSessionRewards = (value) => {
  const positions = new Set();
  return (Array.isArray(value) ? value : []).slice(0, 20).flatMap((entry) => {
    const position = Math.trunc(Number(entry?.position));
    const reward = String(entry?.reward || "").trim().replace(/\s+/g, " ").slice(0, 100);
    if (position < 1 || position > 20 || !reward || positions.has(position)) return [];
    positions.add(position);
    return [{ position, reward, fulfilled: false }];
  }).sort((first, second) => first.position - second.position);
};

const normalizeRoomCode = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const randomRoomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join("");
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
const sanitizePrompt = (prompt) => ({
  answer: String(prompt?.answer || "").trim().slice(0, 80),
  aliases: Array.isArray(prompt?.aliases) ? prompt.aliases.map((item) => String(item).trim().slice(0, 80)).filter(Boolean).slice(0, 8) : [],
  categoryId: String(prompt?.categoryId || "custom").trim().slice(0, 80) || "custom",
});

const sanitizeRoomWordPacks = (value) => (Array.isArray(value) ? value : []).slice(0, 24).flatMap((pack) => {
  const id = String(pack?.id || "").trim().replace(/[^a-z0-9-]/gi, "").slice(0, 80);
  const label = String(pack?.label || id).trim().replace(/\s+/g, " ").slice(0, 60);
  const kind = ["general", "game", "community"].includes(pack?.kind) ? pack.kind : "general";
  const seen = new Set();
  const words = (Array.isArray(pack?.words) ? pack.words : []).slice(0, 160).flatMap((word) => {
    const prompt = { ...sanitizePrompt({ ...word, categoryId: `pack-${id}` }), weight: clampNumber(word?.weight, .35, 1.35, 1) };
    const key = normalizeGuess(prompt.answer);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [prompt];
  });
  return id && words.length ? [{ id, label: label || id, kind, words }] : [];
});

const sanitizeRoomWordMix = (mix, packs) => {
  const availableIds = new Set(packs.map((pack) => pack.id));
  const packIds = [...new Set((Array.isArray(mix?.packIds) ? mix.packIds : []).map((id) => String(id).slice(0, 80)))]
    .filter((id) => id === "general-mixed" || availableIds.has(id))
    .slice(0, 24);
  const kinds = new Set(packs.map((pack) => pack.kind));
  return { kind: kinds.size === 1 ? [...kinds][0] : "mixed", packIds: packIds.length ? packIds : packs.map((pack) => pack.id) };
};

const hashRoomSeatToken = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`findraw-room-seat:${String(value || "")}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const pickRoomWordChoices = (room, count = 3) => pickWordChoices(room.promptPacks, [...(room.recentPromptKeys || []), ...(room.recentChoiceKeys || [])], count, true);

const roomStateForClient = (room, revealChoices) => {
  // Allowlist: newly added server fields are private until explicitly reviewed.
  const fields = ["code", "visibility", "hostId", "players", "phase", "wordMix", "twitchOwnerName", "twitchOwnerConnected", "twitchScoringConflict", "twitchSolvers", "roundSeconds", "maxPlayers", "choiceVotes", "drawerId", "turnIndex", "roundIndex", "roundsPerPlayer", "endAt", "solved", "drawingOperations", "drawingEpoch", "drawingRevision", "updatedAt", "phaseDeadline", "publicStartAt"];
  const publicRoom = Object.fromEntries(fields.filter(key => Object.hasOwn(room, key)).map(key => [key, room[key]]));
  return {
    ...publicRoom,
    recentPromptKeys: [], recentChoiceKeys: [],
    // Never transport a successful answer to another guesser, even if the UI hides it.
    guesses: (room.guesses || []).map(guess => ({ ...guess, text: guess.correct ? "Guessed correctly!" : guess.text })),
    wordMixReady: Boolean(room.promptPacks?.length),
    wordMixPacks: (room.promptPacks || []).map((pack) => ({ id: pack.id, label: pack.label, kind: pack.kind, wordCount: pack.words.length })),
    answer: room.answer
      ? revealChoices || room.phase === "results"
        ? { ...room.answer, aliases: room.phase === "results" ? [] : room.answer.aliases }
        : { ...room.answer, answer: null, aliases: [], mask: maskedRoomAnswer(room.answer.answer) }
      : null,
    choices: revealChoices ? room.choices || [] : (room.choices || []).map((choice, index) => ({
      categoryId: choice.categoryId || `slot-${index}`,
      answer: "",
      aliases: [],
    })),
  };
};

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
  visibility: "private",
  hostId: host.id,
  players: [host],
  phase: "lobby",
  wordMix: { kind: "general", packIds: ["general-mixed"] },
  promptPacks: [],
  seatTokens: {},
  playerSessionKeys: {},
  twitchOwnerSessionKey: null,
  twitchOwnerName: host.name,
  twitchOwnerConnected: false,
  twitchRoundId: null,
  twitchSolvers: [],
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
  recentChoiceKeys: [],
  drawingOperations: [],
  updatedAt: Date.now(),
  expiresAt: Date.now() + 12 * 3600000,
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
      // Reports request review; a small group cannot automatically unpublish someone else's work.
      if (pack.reportCount >= COMMUNITY_REPORT_QUARANTINE_THRESHOLD) pack.needsReview = true;
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
    this.socketSessionKeys = new Map();
    this.scheduledAlarm = null;
    this.operations = Promise.resolve();
    this.savedRoomParts = new Map();
    this.drawing = new DurableDrawing(state.storage);
    this.room = null;
    this.ready = this.restore();
  }

  async restore() {
    this.room = await this.state.storage.get("room") || null;
    this.scheduledAlarm = await this.state.storage.getAlarm?.() || null;
    for (const socket of this.state.getWebSockets?.() || []) {
      const attachment = socket.deserializeAttachment();
      this.socketSessionKeys.set(socket, attachment?.sessionKey || null);
      if (attachment?.client) this.clients.set(socket, attachment.client);
    }
    if (this.room) {
      this.room.wordMix ||= { kind: "general", packIds: ["general-mixed"] };
      this.room.promptPacks ||= [];
      this.room.recentChoiceKeys ||= [];
      this.room.seatTokens ||= {};
      this.room.playerSessionKeys ||= {};
      this.room.twitchSolvers ||= [];
      await this.drawing.load(this.room.drawingOperations || []);
      this.room.drawingOperations = this.drawing.operations;
      this.room.drawingEpoch = this.drawing.epoch;
      this.room.drawingRevision = this.drawing.revision;
      for (const field of ["guesses", "promptPacks"]) {
        const part = await this.state.storage.get(`room:${field}`);
        if (part !== undefined) { this.room[field] = part; this.savedRoomParts.set(field, JSON.stringify(part)); }
      }
      if (this.room.visibility === "public" && !this.room.promptPacks.length) this.room.promptPacks = sanitizeRoomWordPacks(builtinWordPacks.filter((pack) => pack.kind === "general"));
      // Recover seats after a deployment that disconnects the old standard sockets.
      const connected = new Set([...this.clients.values()].map((client) => client.id));
      let changed = this.drawing.needsCheckpoint;
      if (!this.room.expiresAt) { this.room.expiresAt = Date.now() + 12 * 3600000; changed = true; }
      for (const player of this.room.players) {
        if (!connected.has(player.id) && !player.disconnectedAt) {
          player.disconnectedAt = Date.now();
          changed = true;
        }
      }
      if (this.room.phase === "choosing" && !this.room.phaseDeadline) { this.room.phaseDeadline = Date.now() + 20_000; changed = true; }
      if (this.room.phase === "results" && !this.room.phaseDeadline) { this.room.phaseDeadline = Date.now() + 10_000; changed = true; }
      if (changed) await this.save();
    }
  }

  async fetch(request) {
    await this.ready;
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
    const url = new URL(request.url);
    if (url.pathname.endsWith("/live")) return this.liveSocket(request);
    if (url.pathname.endsWith("/matchmake-seat") && request.method === "POST") return this.enqueue(() => this.reservePublicSeat(request));
    if (url.pathname.endsWith("/twitch-solver") && request.method === "POST") return this.receiveTwitchSolver(request);
    if (url.pathname.endsWith("/twitch-stopped") && request.method === "POST") {
      const { roundId } = await request.json();
      if (this.room?.twitchRoundId === roundId) {
        this.room.twitchOwnerConnected = false;
        this.room.twitchScoringConflict = true;
        await this.save();
        this.broadcastState();
      }
      return json({ ok: true }, { request });
    }
    if (url.pathname.endsWith("/state")) return json({ room: this.room ? roomStateForClient(this.room, false) : null }, { request });
    return json({ error: "Room route not found" }, { status: 404, request });
  }

  liveSocket(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ error: "Expected websocket upgrade." }, { status: 426, request });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if ((this.state.getWebSockets?.().length || this.clients.size) >= 32) return json({ error: "Too many room connections." }, { status: 429, request });
    const sessionKey = validClientSessionKey(request.headers.get("X-Findraw-Session"));
    if (!sessionKey) return json({ error: "Authenticated browser session required." }, { status: 401, request });
    if ([...this.socketSessionKeys.values()].filter(key => key === sessionKey).length >= 2) return json({ error: "Close another connection to this room first." }, { status: 429, request });
    this.state.acceptWebSocket(server);
    this.socketSessionKeys.set(server, sessionKey);
    server.serializeAttachment({ sessionKey, roomCode: new URL(request.url).pathname.split("/")[3].toUpperCase(), ipHash: request.headers.get("X-Findraw-IP-Hash"), lease: JSON.parse(request.headers.get("X-Findraw-Admission") || "null"), joinedBy: Date.now() + 15_000 });
    this.state.waitUntil(this.scheduleAlarm());
    server.send(JSON.stringify({ type: "hello", payload: { connected: true, drawingProtocol: 3 } }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleSocketMessage(socket, data) {
    const metadata = socket.deserializeAttachment?.() || {};
    if (metadata.violations >= 5) return;
    const budget = this.clients.get(socket) || metadata.budget || { rateLimits: {} };
    if (!this.allowRoomMessage(budget, "all")) throw new SecurityError("Message limit exceeded.", 429);
    socket.serializeAttachment?.({ ...metadata, budget });
    const messageSize = getRoomMessageByteLength(data);
    if (messageSize > ROOM_MESSAGE_BYTE_LIMIT) {
      try { socket.close(1009, "Room message is too large."); } catch {}
      return;
    }
    const message = validateSocketMessage(JSON.parse(typeof data === "string" ? data : await new Response(data).text()));
    if (message.type === "join") {
      if (!this.allowRoomMessage(budget, "join")) throw new SecurityError("Join limit exceeded.", 429);
      if (metadata.roomCode && metadata.roomCode !== message.payload.code.toUpperCase()) throw new SecurityError("Room code mismatch.");
      return this.join(socket, message.payload);
    }
    const client = this.clients.get(socket);
    if (!client || !this.room) return;
    socket.serializeAttachment?.({ ...metadata, sessionKey: this.socketSessionKeys.get(socket), client });
    if (this.room.phase === "drawing" && this.room.endAt <= Date.now()) { await this.finishTurn(); return; }
    if (message.type === "choice-vote" && this.room.phaseDeadline <= Date.now()) return;
    if (message.type === "guess" && !this.allowRoomMessage(client, "guess")) throw new Error("Guesses are coming in too fast.");
    if (message.type === "drawing-preview" && !this.allowRoomMessage(client, "drawing-preview")) return;
    if (["drawing-sync", "drawing-delta"].includes(message.type) && !this.allowRoomMessage(client, "drawing-sync")) {
      if (message.type === "drawing-delta") this.sendDrawingSnapshot(socket, message.payload?.mutationId, 1000);
      return;
    }
    if (!["guess", "drawing-preview", "drawing-sync", "drawing-delta"].includes(message.type) && !this.allowRoomMessage(client, "control")) throw new Error("Room changes are coming in too fast.");
    if (message.type === "drawing-resync") return this.sendDrawingSnapshot(socket);
    if (message.type === "drawing-delta") return this.drawerOnly(client, () => this.acceptDrawingDelta(socket, message.payload));
    if (message.type === "word-mix") return this.hostOnly(client, () => this.updateWordMix(message.payload));
    if (message.type === "room-settings") return this.hostOnly(client, () => this.updateSettings(message.payload));
    if (message.type === "transfer-leader") return this.hostOnly(client, () => this.transferLeader(message.payload));
    if (message.type === "twitch-takeover") return this.hostOnly(client, async () => {
      if (this.room.phase !== "drawing" || !this.room.twitchScoringConflict) return;
      await this.startRoomTwitchRound(this.room.answer, true);
      await this.save();
      this.broadcastState();
    });
    if (message.type === "leave-room") return this.leaveRoom(socket);
    if (message.type === "start-game" && this.room.visibility !== "public") return this.hostOnly(client, () => this.startGame(message.payload));
    if (message.type === "choice-vote") return this.submitChoiceVote(client, message.payload);
    if (message.type === "guess") return this.submitGuess(client, message.payload);
    if (message.type === "drawing-preview") return this.drawerOnly(client, () => this.previewDrawing(socket, message.payload));
    if (message.type === "drawing-sync") return this.drawerOnly(client, () => this.syncDrawing(message.payload));
  }

  enqueue(operation) {
    const run = this.operations.then(async () => { await this.ready; return operation(); });
    this.operations = run.catch(() => undefined);
    return run;
  }

  async webSocketMessage(socket, data) {
    this.pendingMessages ||= 0;
    if (this.pendingMessages >= 32) { try { socket.close(1008, "Too many queued messages"); } catch {} return; }
    this.pendingMessages++;
    return this.enqueue(async () => {
      try { await this.handleSocketMessage(socket, data); }
      catch (error) {
        const metadata = socket.deserializeAttachment?.() || {};
        metadata.violations = (metadata.violations || 0) + 1;
        socket.serializeAttachment?.(metadata);
        if (metadata.violations >= 5) {
          if (metadata.sessionKey) await this.state.storage.put(`blocked:${metadata.sessionKey}`, Date.now() + 60000);
          logSecurityViolation({ action: "room-message", room: this.room?.code, ipHash: metadata.ipHash || null, sessionHash: metadata.sessionKey ? await privateHash(this.env, metadata.sessionKey).catch(() => null) : null }, 429);
          try { socket.close(1008, "Abuse cooldown. Wait one minute."); } catch {}
        } else { try { socket.send(JSON.stringify({ type: "error", error: "Invalid or excessive room action." })); } catch {} }
      }
      finally {
        this.pendingMessages--;
        const client = this.clients.get(socket);
        if (client) socket.serializeAttachment({ ...(socket.deserializeAttachment?.() || {}), sessionKey: this.socketSessionKeys.get(socket), client });
      }
    });
  }

  webSocketClose(socket, code) {
    try { socket.close(code === 1005 ? 1000 : code); } catch {}
    return this.enqueue(() => this.disconnect(socket));
  }

  webSocketError(socket) {
    try { socket.close(1011, "Connection error"); } catch {}
    return this.enqueue(() => this.disconnect(socket));
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
    const session = this.socketSessionKeys.get(socket);
    if (session && (await this.state.storage.get(`blocked:${session}`)) > Date.now()) throw new SecurityError("Room cooldown active.", 429);
    if (createRequested && this.env.DISABLE_NEW_ROOMS === "1") throw new SecurityError("New rooms are temporarily paused.", 503);
    if (createRequested && this.env.FINDRAW_ADMISSION) {
      await admission(this.env, `session:${session}`, "create");
      const ipHash = socket.deserializeAttachment?.()?.ipHash;
      if (ipHash) await admission(this.env, `ip:${ipHash}`, "create");
    }
    const player = {
      id: String(payload.clientId || "").slice(0, 80),
      name: String(payload.name || "Player").trim().slice(0, 20) || "Player",
      score: 0,
      connectedAt: Date.now(),
    };
    const reconnectToken = String(payload.reconnectToken || "").slice(0, 200);
    if (code.length !== 6 || !player.id || reconnectToken.length < 20) throw new Error("A valid room code and reconnect identity are required.");
    const seatTokenHash = await hashRoomSeatToken(reconnectToken);
    const browserSessionKey = this.socketSessionKeys.get(socket);
    const existingClient = this.clients.get(socket);
    if (existingClient) throw new Error("This connection has already joined a room.");
    if (!this.room) {
      if (!createRequested) throw new Error("Room not found. Check the code or ask the host to create it first.");
      this.room = createEmptyRoomState(code, player);
      this.room.seatTokens[player.id] = seatTokenHash;
      this.room.playerSessionKeys[player.id] = browserSessionKey;
      this.room.twitchOwnerSessionKey = browserSessionKey;
      this.room.twitchOwnerName = player.name;
    }
    else {
      if (createRequested) throw new Error("That room code is already in use. Create a new room and try again.");
      const alreadyInRoom = this.room.players.some((item) => item.id === player.id);
      if (this.room.visibility === "public" && !alreadyInRoom) throw new Error("Use matchmaking to join a public room.");
      const expectedSeatToken = this.room.seatTokens?.[player.id];
      if (alreadyInRoom && expectedSeatToken && expectedSeatToken !== seatTokenHash) throw new Error("That room seat belongs to another browser.");
      const nameTaken = this.room.players.some((item) => (
        item.id !== player.id && normalizePlayerName(item.name) === normalizePlayerName(player.name)
      ));
      if (nameTaken) throw new Error("That name is already taken in this room.");
      if (!alreadyInRoom && this.room.players.length >= (this.room.maxPlayers || 8)) throw new Error("That room is full.");
      this.room.seatTokens ||= {};
      this.room.seatTokens[player.id] = seatTokenHash;
      if (browserSessionKey) this.room.playerSessionKeys[player.id] = browserSessionKey;
      this.room.players = this.room.players.some((item) => item.id === player.id)
        ? this.room.players.map((item) => item.id === player.id ? { ...item, name: player.name, disconnectedAt: null } : item)
        : [...this.room.players, player];
      if (this.room.hostId === player.id) this.room.twitchOwnerName = player.name;
      this.room.updatedAt = Date.now();
    }
    this.clients.set(socket, { id: player.id, name: player.name, protocolVersion: [2, 3].includes(payload.protocolVersion) ? payload.protocolVersion : 1, rateLimits: {} });
    socket.serializeAttachment?.({ ...(socket.deserializeAttachment?.() || {}), sessionKey: browserSessionKey, client: this.clients.get(socket) });
    await this.save();
    this.broadcastState(true);
  }

  async reservePublicSeat(request) {
    const body = await request.json().catch(() => ({}));
    const code = normalizeRoomCode(body.code);
    const player = {
      id: String(body.clientId || "").slice(0, 80),
      name: String(body.name || "Player").trim().slice(0, 20) || "Player",
      score: 0,
      connectedAt: Date.now(),
      disconnectedAt: Date.now(),
    };
    const reconnectToken = String(body.reconnectToken || "").slice(0, 200);
    const browserSessionKey = validClientSessionKey(body.browserSessionKey);
    if (code.length !== 6 || !player.id || reconnectToken.length < 20 || !browserSessionKey) {
      return json({ error: "A valid public player identity is required." }, { status: 400, request });
    }
    if (this.room && this.room.visibility !== "public") return json({ error: "Room code is already in use." }, { status: 409, request });
    const seatTokenHash = await hashRoomSeatToken(reconnectToken);
    if (!this.room) {
      this.room = createEmptyRoomState(code, player);
      this.room.visibility = "public";
      this.room.maxPlayers = 8;
      this.room.roundSeconds = 90;
      this.room.roundsPerPlayer = 3;
      this.room.promptPacks = sanitizeRoomWordPacks(builtinWordPacks.filter((pack) => pack.kind === "general"));
      this.room.seatTokens[player.id] = seatTokenHash;
      this.room.playerSessionKeys[player.id] = browserSessionKey;
      this.room.twitchOwnerSessionKey = browserSessionKey;
      this.room.twitchOwnerName = player.name;
    } else {
      if (this.room.phase !== "lobby" || this.room.players.length >= (this.room.maxPlayers || 8)) {
        return json({ error: "Public room is no longer available." }, { status: 409, request });
      }
      const existingPlayer = this.room.players.find((entry) => entry.id === player.id);
      if (existingPlayer && this.room.seatTokens?.[player.id] !== seatTokenHash) {
        return json({ error: "That public seat belongs to another browser." }, { status: 403, request });
      }
      if (this.room.players.some((entry) => entry.id !== player.id && normalizePlayerName(entry.name) === normalizePlayerName(player.name))) {
        player.name = `${player.name.slice(0, 16)} ${this.room.players.length + 1}`.slice(0, 20);
      }
      this.room.seatTokens[player.id] = seatTokenHash;
      this.room.playerSessionKeys[player.id] = browserSessionKey;
      this.room.players = existingPlayer
        ? this.room.players.map((entry) => entry.id === player.id ? { ...entry, name: player.name } : entry)
        : [...this.room.players, player];
    }
    this.room.updatedAt = Date.now();
    await this.save();
    this.broadcastState();
    return json({ room: roomStateForClient(this.room, false) }, { request });
  }

  async releaseSocketAdmission(socket) {
    const attachment = socket.deserializeAttachment?.() || {};
    if (!attachment.lease) return;
    const lease = attachment.lease; delete attachment.lease; socket.serializeAttachment(attachment);
    try { await releaseAdmission(this.env, lease); } catch { console.warn("[Security] admission release deferred to lease expiry"); }
  }

  async disconnect(socket) {
    await this.releaseSocketAdmission(socket);
    const client = this.clients.get(socket);
    this.clients.delete(socket);
    this.socketSessionKeys.delete(socket);
    if (!client || !this.room || [...this.clients.values()].some((entry) => entry.id === client.id)) return;
    this.room.players = this.room.players.map((player) => player.id === client.id ? { ...player, disconnectedAt: Date.now() } : player);
    this.room.updatedAt = Date.now();
    await this.save();
    this.broadcastState();
  }

  async leaveRoom(socket) {
    await this.releaseSocketAdmission(socket);
    const client = this.clients.get(socket);
    this.clients.delete(socket);
    this.socketSessionKeys.delete(socket);
    if (!client || !this.room) return;
    socket.serializeAttachment?.({ sessionKey: null });
    try { socket.close(1000, "Left room"); } catch {}
    await this.removePlayer(client.id);
  }

  async removePlayer(playerId) {
    if (!this.room) return;
    for (const [socket, client] of this.clients) {
      if (client.id !== playerId) continue;
      await this.releaseSocketAdmission(socket);
      this.clients.delete(socket);
      this.socketSessionKeys.delete(socket);
      socket.serializeAttachment?.({});
      try { socket.close(1000, "Seat removed"); } catch {}
    }
    const wasHost = this.room.hostId === playerId;
    const wasDrawer = this.room.drawerId === playerId;
    if (wasHost || wasDrawer) await this.endRoomTwitchRound();
    const players = this.room.players.filter((player) => player.id !== playerId);
    if (!players.length) {
      this.room = null;
      await this.state.storage.delete("room");
      for (const field of ["drawingOperations", "guesses", "promptPacks"]) await this.state.storage.delete(`room:${field}`);
      await this.state.storage.delete(DRAWING_JOURNAL_KEY);
      this.drawing = new DurableDrawing(this.state.storage);
      this.savedRoomParts.clear();
      await this.state.storage.deleteAlarm();
      this.scheduledAlarm = null;
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
    delete this.room.seatTokens?.[playerId];
    delete this.room.playerSessionKeys?.[playerId];
    if (wasHost) {
      this.room.twitchOwnerSessionKey = this.room.playerSessionKeys?.[nextHostId] || null;
      this.room.twitchOwnerName = players.find((player) => player.id === nextHostId)?.name || "Party leader";
    }
    if (shouldResetRound) this.room.phaseDeadline = null;
    await this.save();
    this.broadcastState();
  }

  async save() {
    this.updatePublicStartDeadline();
    const resetDrawing = this.drawing.needsCheckpoint || !this.drawing.epoch || this.room.drawingEpoch !== this.drawing.epoch ||
      JSON.stringify(this.room.drawingOperations || []) !== JSON.stringify(this.drawing.operations);
    if (resetDrawing) {
      this.room.drawingEpoch = this.room.drawingEpoch && this.room.drawingEpoch !== this.drawing.epoch ? this.room.drawingEpoch : crypto.randomUUID();
      this.room.drawingRevision = 0;
    }
    const metadata = { ...this.room };
    delete metadata.drawingOperations;
    for (const field of ["guesses", "promptPacks"]) {
      await this.saveRoomPart(field);
      delete metadata[field];
    }
    if (resetDrawing) await this.drawing.reset(this.room.drawingOperations || [], this.room.drawingEpoch, (storage) => storage.put("room", metadata));
    else await this.state.storage.put("room", metadata);
    await this.scheduleAlarm();
  }

  async saveRoomPart(field) {
    const value = this.room[field] || [];
    const encoded = JSON.stringify(value);
    if (this.savedRoomParts.get(field) !== encoded) {
      await this.state.storage.put(`room:${field}`, value);
      this.savedRoomParts.set(field, encoded);
    }
  }

  updatePublicStartDeadline() {
    if (!this.room) return;
    const eligible = this.room.visibility === "public" && this.room.phase === "lobby" &&
      this.room.players.filter((player) => !player.disconnectedAt).length >= 2 && this.room.promptPacks.length >= 1;
    this.room.publicStartAt = eligible ? this.room.publicStartAt || Date.now() + 3500 : null;
  }

  async scheduleAlarm() {
    const deadlines = [];
    if (this.room) {
      if (this.room.expiresAt) deadlines.push(this.room.expiresAt);
      if (["lobby", "finished"].includes(this.room.phase)) deadlines.push(this.room.updatedAt + 20 * 60000);
      for (const player of this.room.players) if (player.disconnectedAt) deadlines.push(player.disconnectedAt + 30_000);
      if (this.room.phase === "drawing" && this.room.endAt) deadlines.push(this.room.endAt);
      if (["choosing", "results"].includes(this.room.phase) && this.room.phaseDeadline) deadlines.push(this.room.phaseDeadline);
      if (this.room.publicStartAt) deadlines.push(this.room.publicStartAt);
    }
    for (const socket of this.state.getWebSockets?.() || []) {
      const attachment = socket.deserializeAttachment();
      if (!attachment?.client && attachment?.joinedBy) deadlines.push(attachment.joinedBy);
    }
    const next = deadlines.length ? Math.min(...deadlines) : null;
    if (next === this.scheduledAlarm) return;
    if (next !== null) await this.state.storage.setAlarm(Math.max(Date.now() + 1, next));
    else await this.state.storage.deleteAlarm();
    this.scheduledAlarm = next;
  }

  hostOnly(client, action) {
    if (client.id !== this.room.hostId) throw new Error("Only the party leader can do that.");
    return action();
  }

  drawerOnly(client, action) {
    if (client.id !== this.room.drawerId) throw new Error("Only the drawer can do that.");
    return action();
  }

  async updateWordMix(payload) {
    if (this.room.visibility === "public") throw new Error("Public matches use server-managed categories.");
    if (!["lobby", "results", "finished"].includes(this.room.phase)) return;
    const packs = sanitizeRoomWordPacks(payload?.packs);
    if (!packs.length) throw new Error("Choose at least one word pack before starting the game.");
    this.room.promptPacks = packs;
    this.room.wordMix = sanitizeRoomWordMix(payload?.mix, packs);
    this.room.updatedAt = Date.now();
    await this.save();
    this.broadcastState();
  }

  async updateSettings(payload) {
    validateRoomSettings(payload);
    if (this.room.visibility === "public") throw new Error("Public matches use server-managed rules.");
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

  async startRoomTwitchRound(answer, takeover = false) {
    if (this.room?.visibility === "public") return;
    const sessionKey = validClientSessionKey(this.room?.twitchOwnerSessionKey);
    this.room.twitchRoundId = null;
    this.room.twitchSolvers = [];
    this.room.twitchOwnerConnected = false;
    this.room.twitchScoringConflict = false;
    if (!sessionKey || !this.env.FINDRAW_SESSION) return;
    try {
      const id = this.env.FINDRAW_SESSION.idFromName(`browser:${sessionKey}`);
      const stub = this.env.FINDRAW_SESSION.get(id);
      const summaryResponse = await stub.fetch(new Request("https://findraw.internal/internal/room-chat"));
      const summary = await summaryResponse.json();
      if (!summary.authenticated) return;
      const response = await stub.fetch(new Request("https://findraw.internal/api/round/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: answer.answer, aliases: answer.aliases || [], target: 100, roomCode: this.room.code, ...(takeover ? { takeover: true } : {}) }),
      }));
      const result = await response.json();
      this.room.twitchScoringConflict = result.code === "ROUND_OWNED";
      if (response.ok && result.roundId) {
        this.room.twitchRoundId = result.roundId;
        this.room.twitchOwnerConnected = true;
      }
    } catch (error) {
      console.error("Room Twitch round could not start", error?.message || error);
    }
  }

  async endRoomTwitchRound() {
    const sessionKey = validClientSessionKey(this.room?.twitchOwnerSessionKey);
    if (!sessionKey || !this.room?.twitchRoundId || !this.env.FINDRAW_SESSION) return;
    try {
      const id = this.env.FINDRAW_SESSION.idFromName(`browser:${sessionKey}`);
      await this.env.FINDRAW_SESSION.get(id).fetch(new Request("https://findraw.internal/api/round/end", {
        method: "POST", body: JSON.stringify({ roundId: this.room.twitchRoundId }),
      }));
    } catch (error) {
      console.error("Room Twitch round could not end", error?.message || error);
    }
    this.room.twitchRoundId = null;
  }

  async receiveTwitchSolver(request) {
    const body = await request.json().catch(() => ({}));
    if (!this.room || this.room.phase !== "drawing" || body.roundId !== this.room.twitchRoundId) return json({ ok: false }, { status: 409, request });
    const solver = body.solver && typeof body.solver === "object" ? body.solver : null;
    if (!solver?.userId || this.room.twitchSolvers.some((entry) => entry.userId === solver.userId)) return json({ ok: true }, { request });
    this.room.twitchSolvers = [...this.room.twitchSolvers, {
      userId: String(solver.userId).slice(0, 80),
      name: String(solver.name || "Viewer").slice(0, 40),
      points: Math.max(0, Math.trunc(Number(solver.points) || 0)),
      position: Math.max(1, Math.trunc(Number(solver.position) || 1)),
    }].slice(0, 100);
    this.room.updatedAt = Date.now();
    await this.save();
    this.broadcastState();
    return json({ ok: true }, { request });
  }

  async transferLeader(payload) {
    if (!["lobby", "finished"].includes(this.room.phase)) return;
    const hostId = String(payload?.hostId || "");
    if (!this.room.players.some((player) => player.id === hostId)) return;
    this.room.hostId = hostId;
    this.room.twitchOwnerSessionKey = this.room.playerSessionKeys?.[hostId] || null;
    this.room.twitchOwnerName = this.room.players.find((player) => player.id === hostId)?.name || "Party leader";
    this.room.updatedAt = Date.now();
    await this.save();
    this.broadcastState();
  }

  async startGame(payload) {
    if (!this.room || !["lobby", "finished"].includes(this.room.phase) || this.room.players.filter((player) => !player.disconnectedAt).length < 2) return;
    const choices = pickRoomWordChoices(this.room, 3);
    if (choices.length < 3) throw new Error("This word mix does not have enough available words.");
    const drawerId = this.room.players[0]?.id || null;
    this.room = {
      ...this.room,
      phase: "choosing",
      phaseDeadline: Date.now() + 20_000,
      drawerId,
      turnIndex: 0,
      roundIndex: 0,
      roundsPerPlayer: this.room.roundsPerPlayer || 3,
      answer: null,
      choices,
      recentChoiceKeys: [...(this.room.recentChoiceKeys || []), ...choices.map(roomPromptKey)].slice(-32),
      choiceVotes: {},
      guesses: [],
      solved: [],
      twitchSolvers: [],
      twitchRoundId: null,
      endAt: null,
      drawingOperations: [],
      players: this.room.players.map((player) => ({ ...player, score: 0 })),
      updatedAt: Date.now(),
    };
    await this.save();
    this.broadcastState();
  }

  async chooseWord(payload) {
    if (this.room.phase !== "choosing") return;
    const answer = sanitizePrompt(payload?.answer);
    if (!answer.answer) return;
    this.room = {
      ...this.room,
      phase: "drawing",
      drawingEpoch: crypto.randomUUID(),
      drawingRevision: 0,
      answer,
      choiceVotes: {},
      guesses: [],
      solved: [],
      endAt: Date.now() + this.room.roundSeconds * 1000,
      drawingOperations: [],
      recentPromptKeys: [...this.room.recentPromptKeys, roomPromptKey(answer)].slice(-32),
      updatedAt: Date.now(),
    };
    await this.startRoomTwitchRound(answer);
    await this.save();
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
    if (this.room.endAt <= Date.now()) { await this.finishTurn(); return; }
    // Solved players must not leak the answer through subsequent ordinary chat.
    if (this.room.solved.some(item => item.playerId === client.id)) return;
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
      text: correct ? "Guessed correctly!" : text,
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
      if (correct && !alreadySolved) await this.save();
      else await this.saveRoomPart("guesses");
      this.broadcastState();
    }
  }

  async syncDrawing(payload) {
    if (this.room.phase !== "drawing") return;
    if (this.room.endAt <= Date.now()) { await this.finishTurn(); return; }
    const operations = sanitizeDrawingOperations(payload?.operations);
    const committed = await this.drawing.commit(operations);
    const update = committed ? { ...committed, previewId: String(payload?.previewId || "").slice(0, 80) || null } : null;
    if (!update) return;
    this.room.drawingOperations = this.drawing.operations;
    this.room.drawingEpoch = this.drawing.epoch;
    this.room.drawingRevision = this.drawing.revision;
    this.room.updatedAt = Date.now();
    const message = JSON.stringify({ type: "drawing-committed", payload: { operations, turnIndex: this.room.turnIndex } });
    for (const [socket, client] of this.clients) {
      try {
        socket.send(client.protocolVersion === 3 ? JSON.stringify({ type: "drawing-delta", payload: update }) : client.protocolVersion === 2 ? message : JSON.stringify({ type: "room-state", payload: this.stateForClient(client) }));
      } catch { this.state.waitUntil?.(this.enqueue(() => this.disconnect(socket))); }
    }
  }

  sendDrawingSnapshot(socket, mutationId, retryAfterMs = 0) {
    socket.send(JSON.stringify({ type: "drawing-snapshot", payload: { epoch: this.drawing.epoch, revision: this.drawing.revision, operations: this.drawing.operations, mutationId, retryAfterMs } }));
  }

  async acceptDrawingDelta(socket, payload) {
    if (this.room?.phase === "drawing" && this.room.endAt <= Date.now()) { await this.finishTurn(); return; }
    const mutationId = String(payload?.mutationId || "").slice(0, 80);
    if (this.room.phase !== "drawing" || payload?.epoch !== this.drawing.epoch || payload?.baseRevision !== this.drawing.revision) {
      return this.sendDrawingSnapshot(socket, mutationId);
    }
    const candidate = applyDrawingDelta(this.drawing.operations, payload.delta);
    if (candidate.length > ROOM_MAX_DRAWING_OPERATIONS + 1) throw new Error("Drawing operation limit exceeded.");
    await this.syncDrawing({ operations: candidate, previewId: payload.previewId });
    socket.send(JSON.stringify({ type: "drawing-ack", payload: { mutationId, epoch: this.drawing.epoch, revision: this.drawing.revision } }));
  }

  previewDrawing(senderSocket, payload) {
    if (this.room.phase !== "drawing") return;
    if (this.room.endAt <= Date.now()) return;
    const operation = payload?.operation ? sanitizeDrawingOperations([payload.operation]).at(0) || null : null;
    for (const [socket] of [...this.clients.entries()]) {
      if (socket === senderSocket) continue;
      try {
        socket.send(JSON.stringify({ type: "drawing-preview", payload: { operation, previewId: String(payload?.previewId || "").slice(0, 80) || null } }));
      } catch {
        this.state.waitUntil?.(this.enqueue(() => this.disconnect(socket)));
      }
    }
  }

  async finishTurn() {
    if (!this.room || this.room.phase !== "drawing") return;
    await this.endRoomTwitchRound();
    this.room.phase = "results";
    this.room.phaseDeadline = Date.now() + 10_000;
    this.room.endAt = null;
    this.room.updatedAt = Date.now();
    await this.save();
    this.broadcastState();
  }

  async advanceTurn() {
    if (!this.room) return;
    const next = getNextRoomTurn(this.room);
    if (!next) {
      this.room = { ...this.room, phase: "finished", answer: null, choices: [], choiceVotes: {}, drawerId: null, endAt: null, drawingOperations: [], updatedAt: Date.now() };
      await this.save();
      this.broadcastState();
      return;
    }
    const choices = pickRoomWordChoices(this.room, 3);
    this.room = {
      ...this.room,
      phase: "choosing",
      phaseDeadline: Date.now() + 20_000,
      ...next,
      answer: null,
      choices,
      recentChoiceKeys: [...(this.room.recentChoiceKeys || []), ...choices.map(roomPromptKey)].slice(-32),
      choiceVotes: {},
      guesses: [],
      solved: [],
      twitchSolvers: [],
      twitchRoundId: null,
      endAt: null,
      drawingOperations: [],
      updatedAt: Date.now(),
    };
    await this.save();
    this.broadcastState();
  }

  async alarm() {
    return this.enqueue(async () => {
      this.scheduledAlarm = null;
      const now = Date.now();
      if (this.room && ((this.room.expiresAt && this.room.expiresAt <= now) || (["lobby", "finished"].includes(this.room.phase) && this.room.updatedAt + 20 * 60000 <= now))) {
        for (const player of [...this.room.players]) await this.removePlayer(player.id);
      }
      for (const socket of this.state.getWebSockets?.() || []) {
        const attachment = socket.deserializeAttachment();
        if (!attachment?.client && attachment?.joinedBy <= now) {
          await this.releaseSocketAdmission(socket);
          socket.serializeAttachment({});
          socket.close(1008, "Join deadline expired");
        }
      }
      for (const player of [...(this.room?.players || [])]) {
        if (player.disconnectedAt && player.disconnectedAt + 30_000 <= now) await this.removePlayer(player.id);
      }
      if (this.room?.phase === "lobby" && this.room.publicStartAt && this.room.publicStartAt <= now) await this.startGame();
      else if (this.room?.phase === "choosing" && this.room.phaseDeadline <= now) {
        const answer = this.room.choices[this.getWinningChoiceIndex(this.room.choiceVotes)];
        if (answer) await this.chooseWord({ answer });
      }
      else if (this.room?.phase === "drawing" && this.room.endAt <= now) await this.finishTurn();
      else if (this.room?.phase === "results" && this.room.phaseDeadline <= now) await this.advanceTurn();
      await this.scheduleAlarm();
    });
  }

  stateForClient(client) {
    if (!this.room) return null;
    const state = roomStateForClient(this.room, client?.id === this.room.drawerId);
    return {
      ...state,
      drawingOperations: this.room.drawingOperations || [],
    };
  }

  broadcastState(includeDrawing = false) {
    for (const [socket, client] of [...this.clients.entries()]) {
      try {
        const payload = this.stateForClient(client);
        if (!includeDrawing && client.protocolVersion >= 2 && payload?.drawingOperations?.length) delete payload.drawingOperations;
        socket.send(JSON.stringify({ type: "room-state", payload }));
      } catch {
        this.state.waitUntil?.(this.enqueue(() => this.disconnect(socket)));
      }
    }
  }
}

const base64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (value) => Uint8Array.from(atob(String(value).replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
export class FindrawMatchmaker {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.recentJoins = new Map();
  }

  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
    if (request.method !== "POST") return json({ error: "Matchmaking route not found." }, { status: 404, request });
    const browserSessionKey = validClientSessionKey(request.headers.get("X-Findraw-Session"));
    const body = await request.json().catch(() => ({}));
    const clientId = String(body.clientId || "").slice(0, 80);
    const reconnectToken = String(body.reconnectToken || "").slice(0, 200);
    const name = String(body.name || "Player").trim().slice(0, 20) || "Player";
    if (!browserSessionKey || !clientId || reconnectToken.length < 20) {
      return json({ error: "A valid browser identity is required for matchmaking." }, { status: 400, request });
    }
    const previousJoinAt = this.recentJoins.get(browserSessionKey) || 0;
    if (Date.now() - previousJoinAt < 1500) return json({ error: "Please wait a moment before searching again." }, { status: 429, request });
    this.recentJoins.set(browserSessionKey, Date.now());
    if (this.recentJoins.size > 2000) this.recentJoins = new Map([...this.recentJoins].slice(-1000));

    let code = normalizeRoomCode(await this.state.storage.get("waitingRoomCode"));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (code.length !== 6) code = randomRoomCode();
      const id = this.env.FINDRAW_ROOM.idFromName(code);
      const stub = this.env.FINDRAW_ROOM.get(id);
      if (attempt === 0 && await this.roomCannotAcceptPlayer(stub)) code = randomRoomCode();
      const roomId = this.env.FINDRAW_ROOM.idFromName(code);
      const roomStub = this.env.FINDRAW_ROOM.get(roomId);
      const response = await roomStub.fetch(new Request(`https://findraw.internal/api/room/${code}/matchmake-seat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, clientId, reconnectToken, name, browserSessionKey }),
      }));
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.room) {
        const playerCount = result.room.players?.length || 1;
        const maxPlayers = result.room.maxPlayers || 8;
        if (playerCount >= maxPlayers) await this.state.storage.delete("waitingRoomCode");
        else await this.state.storage.put("waitingRoomCode", code);
        return json({ code, playerCount, maxPlayers }, { request });
      }
      if (response.status !== 409) return json({ error: result.error || "Public matchmaking failed." }, { status: response.status, request });
      code = randomRoomCode();
    }
    return json({ error: "No public room is available right now. Please try again." }, { status: 503, request });
  }

  async roomCannotAcceptPlayer(stub) {
    if (!stub || !normalizeRoomCode(await this.state.storage.get("waitingRoomCode"))) return false;
    try {
      const response = await stub.fetch(new Request("https://findraw.internal/api/room/state"));
      const result = await response.json();
      const room = result.room;
      return Boolean(room && (room.visibility !== "public" || room.phase !== "lobby" || room.players.length >= (room.maxPlayers || 8)));
    } catch {
      return true;
    }
  }
}

const randomToken = (bytes = 24) => {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return base64Url(data);
};
const OAUTH_RETURN_PATHS = new Set(["/", "/draw", "/room"]);

async function oauthStateKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const validClientSessionKey = (value) => {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9_-]{20,160}$/.test(normalized) ? normalized : null;
};

async function createOAuthState(secret, returnTo, clientSessionKey) {
  const payload = base64Url(encoder.encode(JSON.stringify({ returnTo, clientSessionKey, expiresAt: Date.now() + 10 * 60 * 1000, nonce: randomToken(16) })));
  const key = await oauthStateKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return `${payload}.${base64Url(signature)}`;
}

async function readOAuthState(secret, state) {
  try {
    const [payload, encodedSignature] = String(state || "").split(".");
    if (!payload || !encodedSignature) return null;
    const key = await oauthStateKey(secret);
    const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(encodedSignature), encoder.encode(payload));
    if (!valid) return null;
    const value = JSON.parse(decoder.decode(fromBase64Url(payload)));
    if (!OAUTH_RETURN_PATHS.has(value.returnTo) || !validClientSessionKey(value.clientSessionKey) || value.expiresAt < Date.now()) return null;
    return value;
  } catch {
    return null;
  }
}

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
    this.commandUserCooldowns = new Map();
    this.commandResponseQueue = Promise.resolve();
    this.pendingCommandResponses = 0;
    this.lastCommandResponseAt = 0;
    this.ready = this.restore();
  }

  async restore() {
    // The retired shared object is a read-only migration source, not a chat bot.
    if (this.env.FINDRAW_SESSION && this.state.id?.toString() === this.env.FINDRAW_SESSION.idFromName("main").toString()) return;
    this.twitchSession = await this.loadTwitchSession();
    this.currentRound = await this.state.storage.get("currentRound") || null;
    // Restoring identity is read-only. Chat starts only for a live mode or room.
  }

  configured() {
    return Boolean(this.env.TWITCH_CLIENT_ID && this.env.TWITCH_CLIENT_SECRET && this.env.SESSION_SECRET);
  }

  async fetch(request) {
    // Only the authenticated gateway can call this through an internal binding.
    if (new URL(request.url).pathname === "/internal/install-session" && request.method === "POST") {
      await this.ready;
      this.twitchSession = await request.json();
      await this.saveTwitchSession(this.twitchSession);
      return json({ ok: true });
    }
    if (new URL(request.url).pathname === "/internal/channel-legacy") {
      const { channelId } = await request.json();
      return json(channelPointsSnapshot(await this.state.storage.get("points"), channelId));
    }
    if (new URL(request.url).pathname === "/internal/round-displaced") {
      const { channelId, roundId } = await request.json();
      const round = await this.state.storage.get("currentRound");
      if (round?.channelId === channelId && round.id === roundId) {
        round.status = "ended";
        this.currentRound = round;
        await this.state.storage.put("currentRound", round);
        this.broadcast({ type: "round-ended", payload: { roundId, reason: "taken-over" } });
      }
      return json({ ok: true });
    }
    await this.ready;
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
    const url = new URL(request.url);
    try {
      if (!this.isChannelStore && CHANNEL_API[`${request.method} ${url.pathname}`]) return await this.forwardChannelApi(request);
      if (url.pathname === "/api/channel/status" && request.method === "GET") {
        return json(this.twitchSession ? await this.channelCall("status") : { authenticated: false }, { request });
      }
      if (url.pathname === "/api/channel/legacy-backups" && request.method === "GET") {
        return json(await this.channelCall("legacy-backups"), { request });
      }
      if (url.pathname === "/health") return json({ ok: true }, { request });
      if (url.pathname === "/auth/twitch/start") return this.startTwitchAuth(request, url);
      if (url.pathname === "/auth/twitch/callback") return await this.finishTwitchAuth(request, url);
      if (url.pathname === "/api/twitch/session") return json(this.sessionSummary(), { request });
      if (url.pathname === "/internal/room-chat") {
        if (this.twitchSession) {
          await this.validSession();
          if (!this.eventSubSocket) await this.connectEventSub();
          await this.state.storage.setAlarm(Date.now() + 30_000);
        }
        return json(this.sessionSummary(), { request });
      }
      if (url.pathname === "/api/twitch/disconnect" && request.method === "POST") return await this.disconnectTwitch(request);
      if (url.pathname === "/api/twitch/reconnect" && request.method === "POST") return this.reconnectTwitch(request);
      if (url.pathname === "/api/twitch/chat-commands" && request.method === "POST") return this.setTwitchChatCommands(request);
      if (url.pathname === "/api/twitch/debug") return json(this.debugSummary(), { request });
      if (url.pathname === "/api/live") return await this.liveSocket(request);
      if (url.pathname === "/api/events") return await this.events(request);
      if (url.pathname === "/api/leaderboard") return json(await this.getLeaderboard(), { request });
      if (url.pathname === "/api/weekly-points") return this.weeklyPointsSummary(request);
      if (url.pathname === "/api/weekly-points/rewards" && request.method === "POST") return this.setWeeklyRewards(request);
      if (url.pathname === "/api/weekly-points/reward" && request.method === "POST") return this.setWeeklyReward(request);
      if (url.pathname === "/api/artist-session") return this.artistSessionSummary(request);
      if (url.pathname === "/api/artist-session/start" && request.method === "POST") return this.startArtistSession(request);
      if (url.pathname === "/api/artist-session/end" && request.method === "POST") return this.endArtistSession(request);
      if (url.pathname === "/api/artist-session/reward" && request.method === "POST") return this.setArtistSessionReward(request);
      if (url.pathname === "/api/round/start" && request.method === "POST") return await this.startRound(request);
      if (url.pathname === "/api/round/end" && request.method === "POST") return await this.endRound(request);
      if (url.pathname === "/api/points/adjust" && request.method === "POST") return this.adjustViewerPoints(request);
      return json({ error: "Not found" }, { status: 404, request });
    } catch (error) {
      console.error(error);
      return json({ error: error.message || "Request failed", code: error.code }, { status: error.status || 500, request });
    }
  }

  async channelCall(action, payload = {}, expectedChannelId = this.twitchSession?.userId) {
    const session = await this.validSession();
    if (!session || session.userId !== expectedChannelId) {
      throw Object.assign(new Error("Connect Twitch again before accessing channel data."), { status: 401 });
    }
    if (!this.env.FINDRAW_CHANNEL) throw new Error("Channel storage is unavailable. Deploy the matching backend migration.");
    const channelId = session.userId;
    const ownerId = this.state.id.toString();
    const stub = this.env.FINDRAW_CHANNEL.get(this.env.FINDRAW_CHANNEL.idFromName(`channel:${channelId}`));
    const call = async (actionName, value) => {
      const response = await stub.fetch(new Request("https://findraw.internal/channel", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, ownerId, action: actionName, payload: value }),
      }));
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error || "Channel request failed."), { status: response.status, code: result.code });
      return result;
    };
    if (!await this.state.storage.get(`channel-imported:${channelId}`)) {
      const legacy = await this.env.FINDRAW_SESSION.get(this.env.FINDRAW_SESSION.idFromName("main")).fetch(
        new Request("https://findraw.internal/internal/channel-legacy", { method: "POST", body: JSON.stringify({ channelId }) })
      );
      if (!legacy.ok) throw new Error("Could not read the legacy channel backup. Please retry.");
      await call("import", { source: "legacy-main", data: await legacy.json() });
      await call("import", { source: ownerId, data: channelPointsSnapshot(await this.state.storage.get("points"), channelId) });
      await this.state.storage.put(`channel-imported:${channelId}`, true);
    }
    if (this.twitchSession?.userId !== channelId) throw Object.assign(new Error("The Twitch account changed. Please retry."), { status: 409 });
    return call(action, payload);
  }

  async forwardChannelApi(request) {
    const path = new URL(request.url).pathname;
    if (!this.twitchSession) {
      if (request.method !== "GET") return json({ error: "Connect Twitch first." }, { status: 401, request });
      return json(path === "/api/leaderboard" ? [] : path === "/api/weekly-points" ? { current: null, history: [] } : { active: null, history: [] }, { request });
    }
    const payload = await this.channelCall("api", {
      path, method: request.method, body: request.method === "POST" ? await request.json() : {},
    });
    if (request.method === "POST") {
      this.broadcast({ type: "leaderboard", payload: await this.getLeaderboard() });
      this.broadcast({ type: "weekly-points", payload: await this.getWeeklyPointsSummary() });
      this.broadcast({ type: "artist-session", payload: await this.getActiveArtistSession() });
    }
    return json(payload, { request });
  }

  sessionSummary() {
    return {
      configured: this.configured(),
      authenticated: Boolean(this.twitchSession),
      eventSubStatus: this.eventSubStatus,
      canSendChat: Boolean(this.twitchSession?.scopes?.includes("user:write:chat")),
      chatCommandsEnabled: this.twitchSession?.chatCommandsEnabled !== false,
      user: this.twitchSession ? {
        id: this.twitchSession.userId,
        login: this.twitchSession.login,
        displayName: this.twitchSession.displayName,
        profileImageUrl: this.twitchSession.profileImageUrl || null,
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
      canSendChat: Boolean(this.twitchSession?.scopes?.includes("user:write:chat")),
      chatCommandsEnabled: this.twitchSession?.chatCommandsEnabled !== false,
      eventSubSessionId: this.eventSubSessionId,
      lastEventSubMessageAt: this.lastEventSubMessageAt,
      lastChatMessageAt: this.lastChatMessageAt,
      lastEventSubClose: this.lastEventSubClose,
      lastError: this.lastError,
      currentRound: this.currentRound ? {
        id: this.currentRound.id,
        status: this.currentRound.status,
        answer: this.currentRound.roomCode ? null : this.currentRound.answer,
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
        profileImageUrl: this.twitchSession.profileImageUrl || null,
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
    session.browserExpiresAt ||= Date.now() + 7 * 86400000;
    await this.state.storage.put("twitchSession", await encryptJson(this.env.SESSION_SECRET, session));
    const alarm = await this.state.storage.getAlarm?.();
    if (!alarm || alarm > session.browserExpiresAt) await this.state.storage.setAlarm?.(session.browserExpiresAt);
  }

  async clearTwitchSession() {
    await this.state.storage.delete("twitchSession");
  }

  async validSession() {
    if (!this.twitchSession) return null;
    if (this.twitchSession.browserExpiresAt && this.twitchSession.browserExpiresAt <= Date.now()) {
      this.twitchSession = null; await this.clearTwitchSession();
      this.clearEventSubTimers(); try { this.eventSubSocket?.close(); } catch {} this.eventSubSocket = null;
      for (const socket of this.wsClients) { try { socket.close(1008, "Session expired. Sign in again."); } catch {} }
      return null;
    }
    if (this.twitchSession.expiresAt < Date.now() + 60_000) await this.refreshSession();
    const shouldValidate = Date.now() - (this.twitchSession.validatedAt || 0) > 60 * 60 * 1000;
    if (shouldValidate || !this.twitchSession.profileImageUrl || !Array.isArray(this.twitchSession.scopes)) {
      const validation = await twitchFetch("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: `OAuth ${this.twitchSession.accessToken}` },
      });
      const users = await twitchFetch(`https://api.twitch.tv/helix/users?id=${validation.user_id}`, {
        headers: { Authorization: `Bearer ${this.twitchSession.accessToken}`, "Client-Id": this.env.TWITCH_CLIENT_ID },
      });
      const user = users.data?.[0];
      this.twitchSession = {
        ...this.twitchSession,
        userId: validation.user_id,
        login: validation.login,
        displayName: user?.display_name || validation.login,
        profileImageUrl: user?.profile_image_url || null,
        scopes: Array.isArray(validation.scopes) ? validation.scopes : [],
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
      scopes: Array.isArray(token.scope) ? token.scope : this.twitchSession.scopes,
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
      this.eventSubAttempts = Math.min((this.eventSubAttempts || 0) + 1, 6);
      const delay = Math.min(60000, 1000 * 2 ** this.eventSubAttempts) + Math.random() * 1000;
      this.reconnectTimer = setTimeout(() => this.connectEventSub().catch(() => console.warn("Twitch reconnect failed")), delay);
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
      this.eventSubAttempts = 0;
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
    const channelId = this.twitchSession?.userId;
    if (!channelId || (event.broadcaster_user_id && event.broadcaster_user_id !== channelId)) return;
    const message = {
      id: event.message_id,
      userId: event.chatter_user_id,
      name: event.chatter_user_name || event.chatter_user_login,
      message: event.message?.text || "",
      color: event.color || null,
    };
    if (this.env.TWITCH_DEBUG === "true" || TWITCH_CHAT_COMMANDS.has(message.message.trim().toLowerCase())) console.info("[Twitch chat] received", {
      at: new Date().toISOString(),
      user: message.name,
      messageId: message.id,
      command: TWITCH_CHAT_COMMANDS.has(message.message.trim().toLowerCase()) ? message.message.trim().toLowerCase() : null,
      messageLength: message.message.length,
    });
    this.broadcast({ type: "chat-message", payload: message });
    await this.handleChatCommand(message);

    if (!this.currentRound || this.currentRound.status !== "playing") return;
    if (this.currentRound.solvedUserIds.includes(message.userId)) return;
    if (!this.currentRound.answers.includes(normalizeGuess(message.message))) return;

    const pendingRound = this.currentRound;
    if (pendingRound.channelId !== channelId) return;
    const result = await this.channelCall("solve", { roundId: pendingRound.id, message }, channelId);
    if (!result.accepted) return;
    // A concurrent account switch or new round must not be overwritten by this event.
    if (this.twitchSession?.userId !== channelId || this.currentRound?.id !== pendingRound.id) return;
    const { solver, round } = result;
    this.currentRound = round;
    await this.state.storage.put("currentRound", round);
    this.broadcast({ type: "correct-guess", payload: { roundId: round.id, solver } });
    if (round.roomCode && this.env.FINDRAW_ROOM) {
      try {
        const id = this.env.FINDRAW_ROOM.idFromName(round.roomCode);
        await this.env.FINDRAW_ROOM.get(id).fetch(new Request(`https://findraw.internal/api/room/${round.roomCode}/twitch-solver`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roundId: round.id, solver }),
        }));
      } catch (error) {
        console.error("Room Twitch solver could not be delivered", error?.message || error);
      }
    }
    this.broadcast({ type: "leaderboard", payload: await this.getLeaderboard() });
    this.broadcast({ type: "weekly-points", payload: await this.getWeeklyPointsSummary() });
    this.broadcast({ type: "artist-session", payload: await this.getActiveArtistSession() });
    if (round.status === "ended") {
      this.broadcast({ type: "round-ended", payload: { roundId: round.id, reason: "target-reached" } });
    }
  }

  async startTwitchAuth(request, url) {
    if (!this.configured()) return new Response("Twitch is not configured.", { status: 503, headers: corsHeaders(request) });
    const requestedReturnTo = String(url.searchParams.get("returnTo") || "");
    const returnTo = OAUTH_RETURN_PATHS.has(requestedReturnTo) ? requestedReturnTo : "/";
    const clientSessionKey = validClientSessionKey(request.headers.get("X-Findraw-Session"));
    if (!clientSessionKey) return new Response("A browser session is required.", { status: 400, headers: corsHeaders(request) });
    const state = await createOAuthState(this.env.SESSION_SECRET, returnTo, clientSessionKey);
    await this.state.storage.put("oauthPending", { hash: await hashCommunityToken(state), expiresAt: Date.now() + 600000 });

    const authUrl = new URL("https://id.twitch.tv/oauth2/authorize");
    authUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: this.env.TWITCH_CLIENT_ID,
      redirect_uri: this.env.TWITCH_REDIRECT_URI,
      scope: TWITCH_SCOPES.join(" "),
      state,
      ...(url.searchParams.get("switch") === "1" ? { force_verify: "true" } : {}),
    });
    return Response.redirect(authUrl.toString(), 302);
  }

  async finishTwitchAuth(request, url) {
    const state = String(url.searchParams.get("state") || "");
    const code = String(url.searchParams.get("code") || "");
    const stateEntry = await readOAuthState(this.env.SESSION_SECRET, state);
    const pending = await this.state.storage.get("oauthPending");
    if (!code || !stateEntry || pending?.expiresAt <= Date.now() || pending?.hash !== await hashCommunityToken(state)) {
      return new Response("The Twitch sign-in state was invalid or expired.", { status: 400, headers: corsHeaders(request) });
    }

    await this.state.storage.delete("oauthPending");
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
    // End the previous account's scoring round before replacing its credentials.
    await this.releaseChannelRound();
    this.currentRound = null;
    await this.state.storage.delete("currentRound");
    this.twitchSession = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      validatedAt: Date.now(),
      userId: validation.user_id,
      login: validation.login,
      displayName: users.data?.[0]?.display_name || validation.login,
      profileImageUrl: users.data?.[0]?.profile_image_url || null,
      scopes: Array.isArray(validation.scopes) ? validation.scopes : (Array.isArray(token.scope) ? token.scope : []),
      chatCommandsEnabled: true,
    };
    await this.saveTwitchSession(this.twitchSession);
    const rotated = await issueSession(request, this.env);
    const destination = this.env.FINDRAW_SESSION.get(this.env.FINDRAW_SESSION.idFromName(`browser:${rotated.sid}`));
    const installed = await destination.fetch(new Request("https://session.internal/internal/install-session", { method: "POST", body: JSON.stringify(this.twitchSession) }));
    if (!installed.ok) throw new Error("Session could not be installed.");
    await this.clearTwitchSession(); this.twitchSession = null;
    this.clearEventSubTimers(); try { this.eventSubSocket?.close(); } catch {} this.eventSubSocket = null;
    for (const socket of this.wsClients) { try { socket.close(1008, "Session rotated. Reload."); } catch {} }
    this.wsClients.clear();
    return new Response(null, { status: 302, headers: { Location: `${this.env.FRONTEND_URL}${stateEntry.returnTo}?twitch=connected`, "Set-Cookie": rotated.header, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }

  async disconnectTwitch(request) {
    // Drain forwarded request bodies before responding (workerd stream lifetime).
    if (!request.bodyUsed) await request.arrayBuffer();
    await this.releaseChannelRound();
    let revoked = true;
    if (this.twitchSession?.accessToken) {
      try {
        const response = await fetch("https://id.twitch.tv/oauth2/revoke", { method: "POST", signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.env.TWITCH_CLIENT_ID, token: this.twitchSession.accessToken }) });
        revoked = response.ok;
      } catch { revoked = false; }
    }
    this.twitchSession = null;
    this.currentRound = null;
    this.clearEventSubTimers();
    try { this.eventSubSocket?.close(); } catch {}
    this.eventSubSocket = null;
    await this.clearTwitchSession();
    await this.state.storage.delete("currentRound");
    this.setEventSubStatus("disconnected");
    for (const socket of this.wsClients) { try { socket.close(1008, "Signed out"); } catch {} } this.wsClients.clear();
    const rotated = await issueSession(request, this.env);
    return json({ ok: true, revoked, ...(!revoked ? { warning: "Signed out of Findraw; Twitch revocation failed. Remove Findraw in Twitch Connections to revoke access." } : {}) }, { request, headers: { "Set-Cookie": rotated.header } });
  }

  async reconnectTwitch(request) {
    if (!request.bodyUsed) await request.arrayBuffer();
    if (!this.twitchSession) return json(this.sessionSummary(), { request });
    try {
      await this.validSession();
      await this.connectEventSub();
      await this.state.storage.setAlarm(Date.now() + 30_000);
      return json(this.sessionSummary(), { request });
    } catch (error) {
      this.rememberError(error);
      this.setEventSubStatus("disconnected");
      return json({ error: error.message || "Could not reconnect Twitch chat." }, { status: 500, request });
    }
  }

  async setTwitchChatCommands(request) {
    if (!this.twitchSession) return json({ error: "Connect Twitch first." }, { status: 401, request });
    const body = await request.json().catch(() => ({}));
    this.twitchSession = { ...this.twitchSession, chatCommandsEnabled: Boolean(body.enabled) };
    await this.saveTwitchSession(this.twitchSession);
    this.publishSession();
    return json(this.sessionSummary(), { request });
  }

  async liveSocket(request) {
    if (!await this.validSession()) return json({ error: "Connect Twitch first." }, { status: 401, request });
    if (this.wsClients.size + this.sseClients.size >= 4) return json({ error: "Too many live connections." }, { status: 429, request });
    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ error: "Expected websocket upgrade." }, { status: 426, request });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.wsClients.add(server);
    // This transport is server-to-browser only; no client commands are accepted.
    server.addEventListener("message", () => server.close(1008, "Read-only live transport"));
    try { if (!this.eventSubSocket) await this.connectEventSub(); }
    catch { this.wsClients.delete(server); server.close(1011, "Chat unavailable"); return json({ error: "Chat could not connect. Please retry." }, { status: 503, request }); }
    server.send(JSON.stringify({ type: "twitch-session", payload: this.sessionSummary() }));
    const lease = JSON.parse(request.headers.get("X-Findraw-Admission") || "null");
    const lifetime = setTimeout(() => server.close(1000, "Refresh live connection"), 12 * 3600000 - 60000);
    let released = false;
    const closed = () => {
      clearTimeout(lifetime);
      this.wsClients.delete(server);
      if (!released) { released = true; this.state.waitUntil(releaseAdmission(this.env, lease).catch(() => console.warn("Live admission release deferred to expiry"))); }
      this.state.waitUntil(this.scheduleChatIdle());
    };
    server.addEventListener("close", closed);
    server.addEventListener("error", closed);
    return new Response(null, { status: 101, webSocket: client });
  }

  async events(request) {
    if (!await this.validSession()) return json({ error: "Connect Twitch first." }, { status: 401, request });
    if (this.wsClients.size + this.sseClients.size >= 4) return json({ error: "Too many live connections." }, { status: 429, request });
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    this.sseClients.add(writer);
    if (!this.eventSubSocket) await this.connectEventSub();
    writer.write(encoder.encode(`data: ${JSON.stringify({ type: "twitch-session", payload: this.sessionSummary() })}\n\n`)).catch(() => this.sseClients.delete(writer));
    request.signal.addEventListener("abort", () => {
      this.sseClients.delete(writer);
      writer.close().catch(() => undefined);
      this.state.waitUntil(this.scheduleChatIdle());
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
    const data = normalizePointsData(await this.state.storage.get("points"));
    if (prunePointsHistory(data)) await this.state.storage.put("points", data);
    return data;
  }

  async adjustPoints({ channelId, userId, displayName, delta, reason, roundId, scoreKey }) {
    if (!this.isChannelStore) throw new Error("Scoring must run in the channel store.");
    if (scoreKey) {
      const previous = await this.state.storage.get(`score:${scoreKey}`);
      if (previous) return previous;
    }
    const data = await this.getPointsData();
    const week = ensureWeeklySeason(data, channelId);
    const current = week.participants[userId] || { displayName, score: 0 };
    week.participants[userId] = { displayName, score: Math.max(0, current.score + delta) };
    data.ledger.push({
      id: crypto.randomUUID(),
      channelId,
      userId,
      displayName,
      delta,
      reason,
      roundId: roundId || null,
      weekId: week.weekId,
      createdAt: new Date().toISOString(),
    });
    data.ledger = data.ledger.slice(-5000);
    const activeSession = data.activeSessions[channelId];
    if (activeSession?.status === "active") {
      const participant = activeSession.participants[userId] || { displayName, score: 0 };
      activeSession.participants[userId] = { displayName, score: Math.max(0, participant.score + delta) };
    }
    await this.state.storage.put("points", data);
    if (scoreKey) await this.state.storage.put(`score:${scoreKey}`, week.participants[userId]);
    return week.participants[userId];
  }

  async scheduleChatIdle() {
    if (this.wsClients.size || this.sseClients.size) return;
    await this.state.storage.setAlarm?.(Date.now() + 30_000);
  }

  async alarm() {
    await this.ready;
    const expiry = this.twitchSession?.browserExpiresAt;
    if (expiry && expiry <= Date.now()) {
      await this.clearTwitchSession(); await this.state.storage.delete("currentRound");
      this.twitchSession = null; this.currentRound = null; this.clearEventSubTimers();
      try { this.eventSubSocket?.close(); } catch {} this.eventSubSocket = null;
      for (const socket of this.wsClients) { try { socket.close(1008, "Session expired"); } catch {} }
      this.wsClients.clear(); for (const writer of this.sseClients) writer.close().catch(() => {}); this.sseClients.clear();
      return;
    }
    if (this.wsClients.size || this.sseClients.size) { if (expiry) await this.state.storage.setAlarm(expiry); return; }
    if (this.currentRound?.roomCode && this.currentRound.status === "playing" && this.currentRound.expiresAt > Date.now()) {
      await this.state.storage.setAlarm(this.currentRound.expiresAt);
      return;
    }
    await this.releaseChannelRound();
    if (this.currentRound?.status === "playing") {
      this.currentRound.status = "ended";
      await this.state.storage.put("currentRound", this.currentRound);
    }
    this.clearEventSubTimers();
    const socket = this.eventSubSocket;
    this.eventSubSocket = null;
    try { socket?.close(); } catch {}
    this.setEventSubStatus("disconnected");
    if (expiry) await this.state.storage.setAlarm(expiry);
  }

  async getLeaderboard(channelId = this.twitchSession?.userId) {
    if (!channelId) return [];
    if (!this.isChannelStore) return this.channelCall("leaderboard", {}, channelId);
    const data = await this.getPointsData();
    const previousWeek = data.weeklyChannels[channelId]?.weekId;
    const standings = weeklyStandings(ensureWeeklySeason(data, channelId).participants);
    if (data.weeklyChannels[channelId].weekId !== previousWeek) await this.state.storage.put("points", data);
    return standings;
  }

  async getViewerStanding(channelId, userId) {
    if (!this.isChannelStore) return this.channelCall("standing", { userId }, channelId);
    const data = await this.getPointsData();
    const previousWeek = data.weeklyChannels[channelId]?.weekId;
    const season = ensureWeeklySeason(data, channelId);
    const standings = weeklyStandings(season.participants, Number.MAX_SAFE_INTEGER);
    if (season.weekId !== previousWeek) await this.state.storage.put("points", data);
    const index = standings.findIndex((entry) => entry.userId === userId);
    return index < 0
      ? { userId, displayName: null, score: 0, rank: null, weekId: season.weekId, endsAt: season.endsAt }
      : { ...standings[index], rank: index + 1, weekId: season.weekId, endsAt: season.endsAt };
  }

  async getWeeklyPointsSummary(channelId = this.twitchSession?.userId) {
    if (!channelId) return { current: null, history: [] };
    if (!this.isChannelStore) return this.channelCall("weekly", {}, channelId);
    const data = await this.getPointsData();
    const previousWeek = data.weeklyChannels[channelId]?.weekId;
    const summary = weeklyPointsSummary(data, channelId);
    if (data.weeklyChannels[channelId].weekId !== previousWeek) await this.state.storage.put("points", data);
    return summary;
  }

  async weeklyPointsSummary(request) {
    return json(await this.getWeeklyPointsSummary(), { request });
  }

  async setWeeklyRewards(request) {
    if (!this.twitchSession) return json({ error: "Connect Twitch first." }, { status: 401, request });
    const body = await request.json().catch(() => ({}));
    const data = await this.getPointsData();
    const season = findWeeklySeason(data, this.twitchSession.userId, String(body.weekId || ""));
    if (!season) return json({ error: "Weekly result not found." }, { status: 404, request });
    season.rewards = normalizePlacementRewards(body.rewards);
    await this.state.storage.put("points", data);
    const summary = weeklyPointsSummary(data, this.twitchSession.userId);
    this.broadcast({ type: "weekly-points", payload: summary });
    return json({ season: publicWeeklySeason(season), summary }, { request });
  }

  async setWeeklyReward(request) {
    if (!this.twitchSession) return json({ error: "Connect Twitch first." }, { status: 401, request });
    const body = await request.json().catch(() => ({}));
    const data = await this.getPointsData();
    const season = findWeeklySeason(data, this.twitchSession.userId, String(body.weekId || ""));
    if (!season) return json({ error: "Weekly result not found." }, { status: 404, request });
    const position = Math.trunc(Number(body.position));
    season.rewards = normalizePlacementRewards(season.rewards).map((reward) => reward.position === position
      ? { ...reward, fulfilled: Boolean(body.fulfilled) }
      : reward);
    await this.state.storage.put("points", data);
    const summary = weeklyPointsSummary(data, this.twitchSession.userId);
    this.broadcast({ type: "weekly-points", payload: summary });
    return json({ season: publicWeeklySeason(season), summary }, { request });
  }

  async sendTwitchChatMessage(message, replyParentMessageId, expectedChannelId = this.twitchSession?.userId) {
    const session = await this.validSession();
    if (session?.userId !== expectedChannelId) return;
    if (!session?.scopes?.includes("user:write:chat")) throw new Error("Reconnect Twitch to enable chat command replies.");
    logTwitchCommand("sending reply", {
      broadcaster: session.login,
      replyParentMessageId: replyParentMessageId || null,
      message: String(message).slice(0, 500),
    });
    const result = await twitchFetch("https://api.twitch.tv/helix/chat/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Client-Id": this.env.TWITCH_CLIENT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        broadcaster_id: session.userId,
        sender_id: session.userId,
        message: String(message).slice(0, 500),
        ...(replyParentMessageId ? { reply_parent_message_id: replyParentMessageId } : {}),
      }),
    });
    const status = result.data?.[0];
    if (!status) throw new Error("Twitch returned no send status for the chat reply.");
    if (status.is_sent === false) {
      throw new Error(`${status.drop_reason?.code || "dropped"}: ${status.drop_reason?.message || "Twitch did not send the chat reply."}`);
    }
    logTwitchCommand("reply accepted by Twitch", { messageId: status.message_id || null });
    return status;
  }

  enqueueCommandResponse(message, replyParentMessageId, expectedChannelId = this.twitchSession?.userId) {
    if (this.pendingCommandResponses >= 20) {
      logTwitchCommand("reply dropped before sending", { reason: "queue-full", pendingCommandResponses: this.pendingCommandResponses });
      return Promise.resolve();
    }
    this.pendingCommandResponses += 1;
    logTwitchCommand("reply queued", { replyParentMessageId, pendingCommandResponses: this.pendingCommandResponses });
    this.commandResponseQueue = this.commandResponseQueue
      .then(async () => {
        const delay = Math.max(0, this.lastCommandResponseAt + 1_100 - Date.now());
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        await this.sendTwitchChatMessage(message, replyParentMessageId, expectedChannelId);
        this.lastCommandResponseAt = Date.now();
      })
      .catch((error) => {
        console.error("[Twitch command] reply failed", {
          at: new Date().toISOString(),
          replyParentMessageId,
          error: error.message,
        });
        this.rememberError(error);
      })
      .finally(() => { this.pendingCommandResponses -= 1; });
    return this.commandResponseQueue;
  }

  async handleChatCommand(message) {
    const channelId = this.twitchSession?.userId;
    const command = message.message.trim().toLocaleLowerCase("en").split(/\s+/)[0];
    if (!TWITCH_CHAT_COMMANDS.has(command)) return;
    logTwitchCommand("recognized", {
      command,
      user: message.name,
      messageId: message.id,
      enabled: this.twitchSession?.chatCommandsEnabled !== false,
      scopes: Array.isArray(this.twitchSession?.scopes) ? this.twitchSession.scopes : [],
    });
    if (this.twitchSession?.chatCommandsEnabled === false) {
      logTwitchCommand("ignored", { command, user: message.name, reason: "commands-disabled" });
      return;
    }
    if (!this.twitchSession?.scopes?.includes("user:write:chat")) {
      logTwitchCommand("ignored", { command, user: message.name, reason: "missing-user:write:chat" });
      return;
    }
    const claim = await this.channelCall("claim-command", { userId: message.userId, messageId: message.id }, channelId);
    if (!claim.accepted) return;
    if (this.twitchSession?.userId !== channelId) return;
    const cooldownKey = `${this.twitchSession.userId}:${message.userId}`;
    const cooldownUntil = this.commandUserCooldowns.get(cooldownKey) || 0;
    if (cooldownUntil > Date.now()) {
      logTwitchCommand("ignored", { command, user: message.name, reason: "cooldown", retryInMs: cooldownUntil - Date.now() });
      return;
    }
    this.commandUserCooldowns.set(cooldownKey, Date.now() + 15_000);

    let reply;
    if (command === "!finpoints") {
      const standing = await this.getViewerStanding(this.twitchSession.userId, message.userId);
      reply = standing.rank
        ? `[Findraw] @${message.name} You have ${standing.score} points and are ${ordinal(standing.rank)} this week. Weekly points reset Monday at 00:00 UTC.`
        : `[Findraw] @${message.name} You have no weekly Findraw Points yet. Weekly points reset Monday at 00:00 UTC.`;
    } else {
      const session = await this.getActiveArtistSession(this.twitchSession.userId);
      if (command === "!finsession" && !session) {
        reply = `[Findraw] @${message.name} No reward session is active right now.`;
      } else if (command === "!finsession") {
        const index = session.standings.findIndex((entry) => entry.userId === message.userId);
        reply = index >= 0
          ? `[Findraw] @${message.name} You have ${session.standings[index].score} session points and are ${ordinal(index + 1)}.`
          : `[Findraw] @${message.name} You have no points in this session yet.`;
      } else {
        const weekly = await this.getWeeklyPointsSummary(this.twitchSession.userId);
        const rewards = session?.rewards?.length ? session.rewards : weekly.current?.rewards || [];
        const label = session?.rewards?.length ? `${session.name} rewards` : "Weekly rewards";
        reply = `[Findraw] @${message.name} ${rewards.length ? `${label}: ${rewards.map((reward) => `${ordinal(reward.position)}: ${reward.reward}`).join(" | ")}` : "No hosted-session or weekly rewards are listed right now."}`;
      }
    }
    if (this.twitchSession?.userId !== channelId) return;
    return this.enqueueCommandResponse(reply, message.id, channelId);
  }

  async getActiveArtistSession(channelId = this.twitchSession?.userId) {
    if (!channelId) return null;
    if (!this.isChannelStore) return this.channelCall("active-session", {}, channelId);
    const data = await this.getPointsData();
    return publicArtistSession(data.activeSessions[channelId]);
  }

  async artistSessionSummary(request) {
    if (!this.twitchSession) return json({ active: null, history: [] }, { request });
    const data = await this.getPointsData();
    return json({
      active: publicArtistSession(data.activeSessions[this.twitchSession.userId]),
      history: data.sessionHistory.filter((session) => session.channelId === this.twitchSession.userId).reverse().map(publicArtistSession),
    }, { request });
  }

  async startArtistSession(request) {
    if (!this.twitchSession) return json({ error: "Connect Twitch before starting a hosted session." }, { status: 401, request });
    const body = await request.json().catch(() => ({}));
    const data = await this.getPointsData();
    const channelId = this.twitchSession.userId;
    if (data.activeSessions[channelId]?.status === "active") return json({ error: "End the current session before starting another one." }, { status: 409, request });
    const rewards = normalizeSessionRewards(body.rewards);
    if (!rewards.some((reward) => reward.position === 1)) return json({ error: "Add a first-place reward before starting the session." }, { status: 400, request });
    const session = {
      id: crypto.randomUUID(),
      channelId,
      name: String(body.name || "Hosted session").trim().replace(/\s+/g, " ").slice(0, 60) || "Hosted session",
      status: "active",
      startedAt: new Date().toISOString(),
      endedAt: null,
      rewards,
      participants: {},
    };
    data.activeSessions[channelId] = session;
    await this.state.storage.put("points", data);
    const publicSession = publicArtistSession(session);
    this.broadcast({ type: "artist-session", payload: publicSession });
    return json({ session: publicSession }, { request });
  }

  async endArtistSession(request) {
    if (!this.twitchSession) return json({ error: "Connect Twitch first." }, { status: 401, request });
    const data = await this.getPointsData();
    const channelId = this.twitchSession.userId;
    const session = data.activeSessions[channelId];
    if (!session) return json({ error: "No hosted session is active." }, { status: 404, request });
    session.status = "completed";
    session.endedAt = new Date().toISOString();
    data.sessionHistory.push(session);
    delete data.activeSessions[channelId];
    await this.state.storage.put("points", data);
    const publicSession = publicArtistSession(session);
    this.broadcast({ type: "artist-session", payload: null });
    return json({ session: publicSession }, { request });
  }

  async setArtistSessionReward(request) {
    if (!this.twitchSession) return json({ error: "Connect Twitch first." }, { status: 401, request });
    const body = await request.json().catch(() => ({}));
    const data = await this.getPointsData();
    const session = data.sessionHistory.find((entry) => entry.channelId === this.twitchSession.userId && entry.id === String(body.sessionId || ""));
    if (!session) return json({ error: "Session result not found." }, { status: 404, request });
    const reward = session.rewards.find((entry) => entry.position === Math.trunc(Number(body.position)));
    if (reward) reward.fulfilled = Boolean(body.fulfilled);
    await this.state.storage.put("points", data);
    return json({ session: publicArtistSession(session) }, { request });
  }

  async startRound(request) {
    const body = await request.json().catch(() => ({}));
    const answer = String(body.answer || "").trim();
    const aliases = Array.isArray(body.aliases) ? body.aliases : [];
    const target = Math.min(100, Math.max(1, Number(body.target) || 10));
    const roomCode = normalizeRoomCode(body.roomCode);
    if (!answer) return json({ error: "An answer is required." }, { status: 400, request });
    if (!this.twitchSession) return json({ error: "Connect Twitch before starting live scoring." }, { status: 401, request });
    const channelId = this.twitchSession.userId;
    const controllerId = roomCode.length === 6 ? `room:${roomCode}` : String(body.controllerId || "legacy").slice(0, 100);
    const candidate = {
      id: crypto.randomUUID(),
      status: "playing",
      answer,
      answers: [...new Set([answer, ...aliases].map(normalizeGuess).filter(Boolean))],
      target,
      roomCode: roomCode.length === 6 ? roomCode : null,
      solvers: [],
      solvedUserIds: [],
      startedAt: Date.now(),
      testBots: body.testBots === true,
    };
    const { round, displaced } = await this.channelCall("start-round", { round: candidate, controllerId, takeover: body.takeover === true }, channelId);
    if (this.twitchSession?.userId !== channelId) {
      await this.releaseChannelRound(round);
      return json({ error: "Account changed while starting the round." }, { status: 409, request });
    }
    this.currentRound = round;
    await this.state.storage.put("currentRound", this.currentRound);
    await this.scheduleChatIdle();
    if (displaced) {
      if (displaced.roomCode && this.env.FINDRAW_ROOM) {
        try {
          const room = this.env.FINDRAW_ROOM.get(this.env.FINDRAW_ROOM.idFromName(displaced.roomCode));
          await room.fetch(new Request(`https://findraw.internal/api/room/${displaced.roomCode}/twitch-stopped`, {
            method: "POST", body: JSON.stringify({ roundId: displaced.roundId }),
          })).then((response) => response.arrayBuffer());
        } catch (error) { console.error("Could not notify the previous Twitch room", error.message); }
      }
      if (displaced.ownerId === this.state.id.toString()) {
        this.broadcast({ type: "round-ended", payload: { roundId: displaced.roundId, reason: "taken-over" } });
      } else {
        try {
          const oldOwner = this.env.FINDRAW_SESSION.get(this.env.FINDRAW_SESSION.idFromString(displaced.ownerId));
          await oldOwner.fetch(new Request("https://findraw.internal/internal/round-displaced", {
            method: "POST", body: JSON.stringify({ channelId, roundId: displaced.roundId }),
          })).then((response) => response.arrayBuffer());
        } catch (error) { console.error("Could not notify the previous scoring browser", error.message); }
      }
    }
    this.broadcast({ type: "round-started", payload: { roundId: round.id, target, controllerId } });
    return json({ roundId: round.id }, { request });
  }

  async endRound(request) {
    const body = await request.json().catch(() => ({}));
    const round = this.currentRound;
    if (body.controllerId && round?.controllerId !== body.controllerId) return json({ ok: true }, { request });
    if (body.roundId && round?.id !== body.roundId) return json({ ok: true }, { request });
    await this.releaseChannelRound(round);
    if (round && this.currentRound?.id === round.id) {
      round.status = "ended";
      await this.state.storage.put("currentRound", round);
      this.broadcast({ type: "round-ended", payload: { roundId: round.id, reason: "manual" } });
    }
    await this.scheduleChatIdle();
    return json({ ok: true }, { request });
  }

  async releaseChannelRound(round = this.currentRound) {
    if (!round?.channelId) return;
    // Revoked/expired credentials must not prevent logout. Releasing an owned lock
    // does not read or mutate scores and needs only the server-held owner identity.
    if (!this.env.FINDRAW_CHANNEL) return;
    const channelId = round.channelId;
    const stub = this.env.FINDRAW_CHANNEL.get(this.env.FINDRAW_CHANNEL.idFromName(`channel:${channelId}`));
    const response = await stub.fetch(new Request("https://findraw.internal/channel", {
      method: "POST", body: JSON.stringify({ channelId, ownerId: this.state.id.toString(),
        action: "end-round", payload: { roundId: round.id } }),
    }));
    await response.arrayBuffer();
    if (!response.ok) console.error("Could not release channel round; its lease will expire.");
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
      scoreKey: body.requestId ? `adjust:${body.requestId}` : undefined,
    });
    const leaderboard = await this.getLeaderboard(this.twitchSession.userId);
    this.broadcast({ type: "leaderboard", payload: leaderboard });
    const weeklyPoints = await this.getWeeklyPointsSummary(this.twitchSession.userId);
    this.broadcast({ type: "weekly-points", payload: weeklyPoints });
    this.broadcast({ type: "artist-session", payload: await this.getActiveArtistSession() });
    return json({ viewer, leaderboard, weeklyPoints }, { request });
  }
}

// Reuse the points/reward handlers, but never restore OAuth or open a chat connection
// here. The only caller is a validated browser session through a private DO binding.
export class FindrawChannel extends FindrawSession {
  async restore() {}

  constructor(state, env) {
    super(state, env);
    this.isChannelStore = true;
    this.operations = Promise.resolve();
  }

  async alarm() {
    const run = this.operations.then(() => this.state.storage.transaction(async (storage) => {
      const adapter = channelPointsStorage(storage);
      const data = normalizePointsData(await adapter.get("points"));
      const channelId = await storage.get("channelId");
      if (channelId) ensureWeeklySeason(data, channelId);
      prunePointsHistory(data);
      await adapter.put("points", data);
    }));
    this.operations = run.catch(() => undefined);
    return run;
  }

  async fetch(request) {
    // Read the stream in its own request context, not a previous request's queue.
    let input;
    try { input = await request.json(); }
    catch { return json({ error: "Invalid channel request." }, { status: 400 }); }
    const run = this.operations.then(async () => {
      try {
        if (!/^\d+$/.test(input.channelId || "") || !input.ownerId) {
          return json({ error: "A verified channel identity is required." }, { status: 401 });
        }
        return await this.state.storage.transaction(async (storage) => {
          const channelId = await storage.get("channelId");
          if (channelId && channelId !== input.channelId) throw Object.assign(new Error("Channel identity mismatch."), { status: 403 });
          if (!channelId) await storage.put("channelId", input.channelId);
          // Each transaction receives its own context, never mutable shared identity.
          const context = Object.create(this);
          context.state = { storage: channelPointsStorage(storage) };
          context.twitchSession = { userId: input.channelId };
          return context.dispatch(input);
        });
      } catch (error) {
        return json({ error: error.message || "Channel operation failed.", code: error.code }, { status: error.status || 500 });
      }
    });
    // Never retain a Response stream in a cross-request promise chain.
    this.operations = run.then(() => undefined, () => undefined);
    return run;
  }

  async dispatch({ channelId, ownerId, action, payload = {} }) {
    const storage = this.state.storage;
    if (action === "import") {
      const source = payload.source;
      if (source !== "legacy-main" && source !== ownerId) throw new Error("Invalid legacy source.");
      const receiptKey = `migration:${source}`;
      const previous = await storage.get(receiptKey);
      if (previous) return json(previous);
      const incoming = channelPointsSnapshot(payload.data, channelId);
      const current = await this.getPointsData();
      let status = "empty";
      if (hasChannelRecords(incoming, channelId)) {
        // Retain the original snapshot even after a successful import.
        await storage.put(`legacy-backup:${source}`, incoming);
        if (!hasChannelRecords(current, channelId)) {
          await storage.put("points", incoming);
          status = "imported";
        } else if (JSON.stringify(channelPointsSnapshot(current, channelId)) === JSON.stringify(incoming)) {
          status = "duplicate";
        } else {
          status = "needs-review";
          await storage.put("migrationConflicts", (await storage.get("migrationConflicts") || 0) + 1);
        }
      }
      const receipt = { status, at: new Date().toISOString() };
      await storage.put(receiptKey, receipt);
      return json(receipt);
    }
    if (action === "status") {
      const round = await storage.get("scoringRound");
      return json({ authenticated: true, channelId, shared: true,
        migrationConflicts: await storage.get("migrationConflicts") || 0,
        activeElsewhere: Boolean(round && round.status === "playing" && round.ownerId !== ownerId && round.expiresAt > Date.now()),
      });
    }
    if (action === "legacy-backups") {
      const backups = await storage.list({ prefix: "legacy-backup:" });
      return json({ channelId, backups: [...backups.values()] });
    }
    if (action === "claim-command") {
      const claims = await storage.get("commandClaims") || [];
      const current = claims.filter((claim) => claim.until > Date.now());
      if (current.some((claim) => claim.userId === payload.userId || claim.messageId === payload.messageId)) return json({ accepted: false });
      current.push({ userId: payload.userId, messageId: payload.messageId, until: Date.now() + 15_000 });
      await storage.put("commandClaims", current.slice(-1000));
      return json({ accepted: true });
    }
    if (action === "leaderboard") return json(await this.getLeaderboard());
    if (action === "weekly") return json(await this.getWeeklyPointsSummary());
    if (action === "standing") return json(await this.getViewerStanding(channelId, payload.userId));
    if (action === "active-session") return json(await this.getActiveArtistSession());
    if (action === "api") {
      const method = CHANNEL_API[`${payload.method} ${payload.path}`];
      if (!method) throw Object.assign(new Error("Channel operation not allowed."), { status: 404 });
      if (method === "getLeaderboard") return json(await this.getLeaderboard());
      const request = new Request(`https://findraw.internal${payload.path}`, {
        method: payload.method, ...(payload.method === "POST" ? { body: JSON.stringify(payload.body || {}) } : {}),
      });
      const response = await this[method](request);
      if (!response.ok) {
        const body = await response.json();
        throw Object.assign(new Error(body.error), { status: response.status });
      }
      return response;
    }
    if (action === "start-round") {
      const previous = await storage.get("scoringRound");
      if (previous?.status === "playing" && previous.expiresAt > Date.now() &&
          (previous.ownerId !== ownerId || previous.controllerId !== payload.controllerId) && payload.takeover !== true) {
        throw Object.assign(new Error("Another browser or game is scoring for this channel. Take over to end its round and start here."), { status: 409, code: "ROUND_OWNED" });
      }
      const round = { ...payload.round, ownerId, controllerId: payload.controllerId,
        channelId, expiresAt: Date.now() + 15 * 60_000 };
      await storage.put("scoringRound", round);
      return json({ round, displaced: previous?.status === "playing" ? { ownerId: previous.ownerId, roundId: previous.id, roomCode: previous.roomCode } : null });
    }
    if (action === "end-round") {
      const round = await storage.get("scoringRound");
      if (round?.ownerId === ownerId && (!payload.roundId || round.id === payload.roundId)) {
        round.status = "ended";
        await storage.put("scoringRound", round);
      }
      return json({ ok: true });
    }
    if (action === "solve") {
      const round = await storage.get("scoringRound");
      if (!round || round.id !== payload.roundId || round.ownerId !== ownerId ||
          round.status !== "playing" || round.expiresAt <= Date.now() ||
          !round.answers.includes(normalizeGuess(payload.message.message))) return json({ accepted: false });
      const message = payload.message;
      if (round.solvedUserIds.includes(message.userId)) return json({ accepted: false });
      // Event IDs are persistent across retries, round changes and browser takeovers.
      const recentEvents = await storage.get("recentScoringEvents") || [];
      if (recentEvents.includes(message.id)) return json({ accepted: false });
      const position = round.solvers.length + 1;
      const solver = { userId: message.userId, name: message.name, points: pointsForPosition(position), position };
      if (!round.testBots) await this.adjustPoints({ channelId, userId: message.userId,
        displayName: message.name, delta: solver.points, reason: `Correct guess (#${position})`,
        roundId: round.id });
      round.solvedUserIds.push(message.userId);
      round.solvers.push(solver);
      if (round.solvers.length >= round.target) round.status = "ended";
      await storage.put("scoringRound", round);
      // Bound replay bookkeeping; round.solvedUserIds is the authoritative
      // per-round guard, while this survives reconnects/takeovers and restarts.
      await storage.put("recentScoringEvents", [...recentEvents, message.id].slice(-5000));
      return json({ accepted: true, solver, round });
    }
    throw Object.assign(new Error("Unknown channel operation."), { status: 404 });
  }
}

export default {
  async fetch(request, env) {
    let leased = null;
    const audit = { action: "unknown", room: null, ipHash: null, sessionHash: null };
    try {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true }, { request });
    if (url.pathname === "/api/events") return json({ error: "This legacy transport is retired. Reload Findraw to use the secured live connection." }, { status: 410, request });
    if (request.url.length > 4096) throw new SecurityError("Request URL too long.", 414);
    const queryFields = url.pathname === "/auth/twitch/start" ? ["returnTo", "switch"] : url.pathname === "/auth/twitch/callback" ? ["state", "code", "error", "error_description"] : [];
    if ([...url.searchParams.keys()].some(key => !queryFields.includes(key) || url.searchParams.getAll(key).length !== 1)) throw new SecurityError("Unexpected query fields.");
    if (url.pathname === "/auth/twitch/start" && ((url.searchParams.has("returnTo") && !OAUTH_RETURN_PATHS.has(url.searchParams.get("returnTo"))) || (url.searchParams.has("switch") && url.searchParams.get("switch") !== "1"))) throw new SecurityError("Invalid login options.");
    const readable = new Set(["/api/security/config", "/api/twitch/session", "/api/twitch/debug", "/api/live", "/api/events", "/api/leaderboard", "/api/weekly-points", "/api/artist-session", "/api/channel/status", "/api/channel/legacy-backups", "/auth/twitch/start", "/auth/twitch/callback"]);
    if (request.method === "GET" && !readable.has(url.pathname) && !/^\/api\/(room\/[A-Za-z0-9]{6}\/(live|state)|community-packs\/[A-Za-z0-9-]{1,80})$/.test(url.pathname)) throw new SecurityError("Not found.", 404);
    audit.action = url.pathname.startsWith("/api/room/") ? "room-connect" : url.pathname.startsWith("/api/community-packs") ? "community" : readable.has(url.pathname) ? url.pathname : "write";
    audit.room = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{6})\//)?.[1] || null;
    const mutation = ["POST", "PUT", "DELETE"].includes(request.method);
    const upgrade = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
    checkOrigin(request, env, mutation || upgrade);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
    if (url.pathname.startsWith("/internal/") || url.pathname === "/channel") return json({ error: "Not found" }, { status: 404, request });
    const ipHash = await edgeGate(request, env);
    audit.ipHash = ipHash;
    let sessionKey = await readSession(request, env);
    let newCookie = null;
    if (!sessionKey && ["/api/twitch/session", "/api/security/session", "/auth/twitch/start"].includes(url.pathname)) {
      const issued = await issueSession(request, env); sessionKey = issued.sid; newCookie = issued.header;
    }
    if (!sessionKey) throw new SecurityError("Session expired. Reload and reconnect.", 401);
    audit.sessionHash = await privateHash(env, sessionKey);
    if (mutation) {
      const body = await boundedJson(request); validateHttpBody(request, body);
      audit.action = httpSchemaKey(request);
      request = new Request(request.url, { method: request.method, headers: request.headers, body: JSON.stringify(body) });
    } else if (request.method !== "GET") throw new SecurityError("Method not allowed.", 405);
    // Public caller headers must never select an authenticated Durable Object.
    const headers = new Headers(request.headers); headers.set("X-Findraw-Session", sessionKey); headers.delete("X-Findraw-Admission");
    headers.set("X-Findraw-IP-Hash", ipHash);
    request = new Request(request, { headers });
    if (url.pathname === "/api/security/session" || url.pathname === "/api/security/config") {
      return json({ ok: true, siteKey: env.TURNSTILE_SITE_KEY || null }, { request, headers: newCookie ? { "Set-Cookie": newCookie } : {} });
    }
    if (url.pathname === "/api/security/verify") {
      await admission(env, `ip:${ipHash}`, "verify");
      await admission(env, `session:${sessionKey}`, "verify");
      const { token } = await request.json();
      return json({ ok: true }, { request, headers: { "Set-Cookie": await verifyHuman(request, env, sessionKey, token) } });
    }
    const gated = (upgrade && url.pathname.startsWith("/api/room/")) || url.pathname === "/api/matchmaking/join" || (mutation && url.pathname.startsWith("/api/community-packs"));
    if (gated) await requireHuman(request, env, sessionKey);
    const action = upgrade ? "upgrade" : url.pathname === "/auth/twitch/start" ? "login" : url.pathname === "/api/matchmaking/join" ? "matchmake" : url.pathname.endsWith("/report") ? "report" : url.pathname.startsWith("/api/community-packs") ? "content" : "write";
    if (mutation || upgrade || action === "login") {
      const room = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{6})\/live$/)?.[1]?.toUpperCase() || (upgrade ? "$live" : undefined);
      if (room) leased = { room, id: randomId(), keys: [] };
      await admission(env, `ip:${ipHash}`, action, room, 12, leased?.id); if (leased) leased.keys.push(`ip:${ipHash}`);
      await admission(env, `session:${sessionKey}`, action, room, 3, leased?.id); if (leased) leased.keys.push(`session:${sessionKey}`);
      if (upgrade) {
        const owner = env.FINDRAW_SESSION.get(env.FINDRAW_SESSION.idFromName(`browser:${sessionKey}`));
        const identity = await (await owner.fetch(new Request("https://identity.internal/api/twitch/session"))).json();
        if (identity.user?.id) { await admission(env, `account:${identity.user.id}`, action, room, 3, leased?.id); if (leased) leased.keys.push(`account:${identity.user.id}`); }
      }
    }
    if ((env.DISABLE_NEW_ROOMS === "1" && url.pathname === "/api/matchmaking/join") || (env.DISABLE_COMMUNITY_WRITES === "1" && mutation && url.pathname.startsWith("/api/community-packs"))) throw new SecurityError("This feature is temporarily paused.", 503);
    if (url.pathname.startsWith("/api/community-packs")) {
      const id = env.FINDRAW_COMMUNITY.idFromName("catalog");
      return env.FINDRAW_COMMUNITY.get(id).fetch(request);
    }
    if (url.pathname === "/api/matchmaking/join") {
      const id = env.FINDRAW_MATCHMAKER.idFromName("public:global");
      return env.FINDRAW_MATCHMAKER.get(id).fetch(request);
    }
    const roomMatch = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{6})\/(live|state)$/);
    if (roomMatch) {
      if (roomMatch[2] === "state") throw new SecurityError("Join the room to view its state.", 403);
      const id = env.FINDRAW_ROOM.idFromName(normalizeRoomCode(roomMatch[1]));
      const roomHeaders = new Headers(request.headers); roomHeaders.set("X-Findraw-Admission", JSON.stringify(leased));
      const response = await env.FINDRAW_ROOM.get(id).fetch(new Request(request, { headers: roomHeaders }));
      if (response.status !== 101) await releaseAdmission(env, leased);
      return response;
    }
    let clientSessionKey = sessionKey;
    if (url.pathname === "/auth/twitch/callback") {
      const stateEntry = await readOAuthState(env.SESSION_SECRET, url.searchParams.get("state"));
      if (stateEntry?.clientSessionKey !== sessionKey) throw new SecurityError("Sign-in browser does not match. Please retry login.", 403);
    }
    if (!clientSessionKey) return json({ error: "A browser session is required." }, { status: 400, request });
    const id = env.FINDRAW_SESSION.idFromName(`browser:${clientSessionKey}`);
    const sessionHeaders = new Headers(request.headers); sessionHeaders.set("X-Findraw-Admission", JSON.stringify(leased));
    const result = await env.FINDRAW_SESSION.get(id).fetch(new Request(request, { headers: sessionHeaders }));
    if (result.status !== 101) await releaseAdmission(env, leased);
    if (url.pathname.startsWith("/auth/") && result.status >= 400) { await result.arrayBuffer(); return loginErrorResponse(result.status); }
    if (newCookie && result.status !== 101) {
      const responseHeaders = new Headers(result.headers); responseHeaders.append("Set-Cookie", newCookie);
      return new Response(result.body, { status: result.status, headers: responseHeaders });
    }
    return result;
    } catch (error) {
      try { await releaseAdmission(env, leased); } catch {}
      audit.ipHash ||= error.ipHash || null;
      logSecurityViolation(audit, error.status || 500);
      if (new URL(request.url).pathname.startsWith("/auth/")) return loginErrorResponse(error.status || 500);
      return json({ error: error instanceof SecurityError ? error.message : "Request could not be completed." }, { status: error.status || 500, request, headers: error.status === 429 ? { "Retry-After": "60" } : {} });
    }
  },
};
