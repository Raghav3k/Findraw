// Public-boundary validation. Internal DO calls use trusted, separately checked contracts.
export class SecurityError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = () => { throw new SecurityError("Invalid request fields or values."); };
export const str = (max, min = 0) => value => typeof value === "string" && value.length >= min && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value);
export const num = (min, max, integer = true) => value => typeof value === "number" && Number.isFinite(value) && (!integer || Number.isSafeInteger(value)) && value >= min && value <= max;
const bool = value => typeof value === "boolean";
const choice = (...values) => value => values.includes(value);
const optional = test => value => value === undefined || test(value);
const nullable = test => value => value === null || test(value);
const arr = (test, max, min = 0) => value => Array.isArray(value) && value.length >= min && value.length <= max && value.every(test);
export const obj = shape => value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).every(key => Object.hasOwn(shape, key)) && Object.entries(shape).every(([key, test]) => test(value[key]));
const id = value => str(160, 1)(value) && /^[A-Za-z0-9_-]+$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
const point = value => Array.isArray(value) && value.length >= 2 && value.length <= 3 && num(-10000, 10000, false)(value[0]) && num(-10000, 10000, false)(value[1]) && (value[2] === undefined || num(0, 1, false)(value[2]));
const color = value => typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value);
const appearance = { color, opacity: num(1, 100, false), strokeWidth: num(1, 80, false) };
const operations = {
  brush: obj({ type: choice("brush"), style: choice("marker", "pencil", "dotted"), points: arr(point, 900), ...appearance, complete: bool }),
  eraser: obj({ type: choice("eraser"), points: arr(point, 900), size: num(1, 120, false) }),
  fill: obj({ type: choice("fill"), x: num(-10000, 10000, false), y: num(-10000, 10000, false), color, opacity: num(1, 100, false) }),
  shape: obj({ type: choice("shape"), shape: choice("line", "dotted-line", "arrow", "rectangle", "ellipse"), start: point, end: point, ...appearance }),
};
const operation = value => Boolean(value && Object.hasOwn(operations, value.type) && operations[value.type](value));
const drawing = value => arr(operation, 500)(value) && value.reduce((n, op) => n + (op.points?.length || 0), 0) <= 8000;
const word = obj({ answer: str(80, 1), aliases: optional(arr(str(80, 1), 8)), weight: optional(num(0, 100, false)) });
const pack = obj({ id: str(160, 1), label: str(100, 1), kind: choice("general", "game", "community"), words: arr(word, 2000, 1) });
const settings = obj({ maxPlayers: optional(num(2, 16)), roundsPerPlayer: optional(num(1, 10)), roundSeconds: optional(num(15, 300)) });
const empty = obj({});
export const WS_SCHEMAS = {
  join: obj({ code: value => typeof value === "string" && /^[A-Za-z0-9]{6}$/.test(value), clientId: id, reconnectToken: str(200, 20), name: str(20, 1), create: optional(bool), protocolVersion: optional(choice(1, 2, 3)) }),
  guess: obj({ text: str(80, 1) }),
  "room-settings": settings,
  "word-mix": obj({ mix: obj({ kind: choice("general", "game", "community", "mixed"), packIds: arr(str(160, 1), 50) }), packs: arr(pack, 50, 1) }),
  "choice-vote": obj({ choiceIndex: num(0, 2) }),
  "transfer-leader": obj({ hostId: id }),
  "drawing-preview": obj({ operation: nullable(operation), previewId: optional(nullable(str(80))) }),
  "drawing-sync": obj({ operations: drawing, previewId: optional(nullable(str(80))) }),
  "drawing-delta": obj({ mutationId: str(160, 1), epoch: str(160, 1), baseRevision: num(0, Number.MAX_SAFE_INTEGER), previewId: optional(nullable(str(80))), delta: obj({ index: num(0, 500), deleteCount: num(0, 500), operations: drawing }) }),
  "drawing-resync": empty, "leave-room": empty, "start-game": empty, "twitch-takeover": empty,
};
export function validateSocketMessage(value) {
  if (!obj({ type: str(40, 1), payload: optional(v => v !== null && typeof v === "object" && !Array.isArray(v)) })(value) ||
      !Object.hasOwn(WS_SCHEMAS, value.type) || !WS_SCHEMAS[value.type](value.payload || {})) fail();
  return value;
}
export function validateRoomSettings(value) { if (!settings(value)) fail(); }
const reward = obj({ position: num(1, 20), reward: str(200) });
const rewards = arr(reward, 20);
const packInput = obj({ title: str(60, 3), description: optional(str(240)), creatorName: str(40, 1), tags: arr(str(32, 1), 8, 1), words: arr(obj({ answer: str(60, 1), aliases: optional(arr(str(60, 1), 5)) }), 100, 8) });
export const HTTP_SCHEMAS = {
  "POST /api/matchmaking/join": obj({ clientId: id, reconnectToken: str(200, 20), name: str(20, 1), group: optional(choice("global")) }),
  "POST /api/security/session": empty,
  "POST /api/security/verify": obj({ token: str(2048, 1) }),
  "POST /api/twitch/disconnect": empty,
  "POST /api/twitch/reconnect": empty,
  "POST /api/twitch/chat-commands": obj({ enabled: bool }),
  "POST /api/round/start": obj({ answer: str(80, 1), aliases: optional(arr(str(80, 1), 8)), target: num(1, 10000), testBots: optional(bool), controllerId: optional(id), takeover: optional(bool) }),
  "POST /api/round/end": obj({ controllerId: optional(id) }),
  "POST /api/artist-session/start": obj({ name: str(100, 1), rewards }),
  "POST /api/artist-session/end": empty,
  "POST /api/artist-session/reward": obj({ sessionId: id, position: num(1, 20), fulfilled: bool }),
  "POST /api/weekly-points/rewards": obj({ weekId: str(32, 1), rewards }),
  "POST /api/weekly-points/reward": obj({ weekId: str(32, 1), position: num(1, 20), fulfilled: bool }),
  "POST /api/points/adjust": obj({ userId: id, displayName: str(40, 1), delta: num(-10000, 10000), reason: str(200), requestId: id }),
  "POST /api/community-packs": packInput,
  "PUT /api/community-packs/:id": packInput,
  "POST /api/community-packs/:id/report": obj({ reason: choice("offensive", "hate-or-harassment", "sexual-content", "spam", "incorrect-tags", "other"), reporterKey: str(160, 12), details: optional(str(300)) }),
};
export function httpSchemaKey(request) {
  let path = new URL(request.url).pathname;
  path = path.replace(/^\/api\/community-packs\/[^/]+\/report$/, "/api/community-packs/:id/report");
  if (request.method === "PUT") path = path.replace(/^\/api\/community-packs\/[^/]+$/, "/api/community-packs/:id");
  return `${request.method} ${path}`;
}
export async function boundedJson(request, limit = 128 * 1024) {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new SecurityError("Request too large.", 413);
  if (!request.body) return {};
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new SecurityError("JSON required.", 415);
  const reader = request.body.getReader(); const parts = []; let size = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new SecurityError("Request too large.", 413); } parts.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail(); }
}
export function validateHttpBody(request, body) {
  const schema = HTTP_SCHEMAS[httpSchemaKey(request)];
  if (!schema) throw new SecurityError("Endpoint or method not allowed.", 405);
  if (!schema(body)) fail();
}
