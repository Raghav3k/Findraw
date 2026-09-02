// Read-only quota audit. Run from the repository root: node scripts/audit-cloudflare-usage.mjs
// Success-path logical operations, NOT measured Cloudflare billing/CPU/hibernation.
// Transactions below are sequential in-memory fixtures, not a concurrency/rollback test.
import worker, { FindrawChannel, FindrawSession, FindrawRoom } from '../cloudflare/backend/src/index.js';
import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { channelPointsStorage } from '../shared/channelPointsStorage.mjs';
const out = console.log;
console.info = () => {};
globalThis.fetch = async () => { throw new Error('External network disabled in quota audit'); };
let counts;
const reset = () => counts = { worker: 0, doRequests: 0, gets: 0, puts: 0, deletes: 0, putBytes: 0, keys: {} };
reset();
function storage() {
  const values = new Map();
  const obj = {
    values,
    async get(key) { counts.gets++; return structuredClone(values.get(key)); },
    async put(key, value) {
      counts.puts++; counts.putBytes += Buffer.byteLength(JSON.stringify(value));
      counts.keys[key] = (counts.keys[key] || 0) + 1;
      values.set(key, structuredClone(value));
    },
    async delete(key) { counts.deletes++; return values.delete(key); },
    async list({ prefix = '' } = {}) { return new Map([...values].filter(([key]) => key.startsWith(prefix))); },
    async transaction(fn) { return fn(obj); },
    async setAlarm() { counts.puts++; },
    async deleteAlarm() { counts.deletes++; },
  };
  return obj;
}
const env = {};
function binding(Class) {
  const objects = new Map();
  return {
    objects, idFromName: x => x, idFromString: x => x,
    get(id) {
      if (!objects.has(id)) objects.set(id, new Class({ id, storage: storage() }, env));
      const object = objects.get(id);
      return { fetch(request) { counts.doRequests++; return object.fetch(request); } };
    },
  };
}
env.FINDRAW_SESSION = binding(FindrawSession);
env.FINDRAW_CHANNEL = binding(FindrawChannel);
const key = 'quota-audit-browser-123456789012345678901234';
env.FINDRAW_SESSION.get(`browser:${key}`);
const session = env.FINDRAW_SESSION.objects.get(`browser:${key}`);
await session.ready;
session.twitchSession = { userId: '111', login: 'test', displayName: 'Test', profileImageUrl: 'https://example.invalid/avatar.png', scopes: [], expiresAt: Date.now() + 86400000, validatedAt: Date.now() };
async function request(url, body, method) {
  counts.worker++;
  const response = await worker.fetch(new Request(`https://audit.invalid${url}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { 'X-Findraw-Session': key, 'Content-Type': 'application/json', Origin: 'https://findraw.pages.dev' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return response;
}
async function measure(name, fn) { reset(); await fn(); out(JSON.stringify({ name, ...counts })); }
await request('/api/weekly-points'); // Prime one-time migration and weekly initialization.
await request('/api/round/start', { answer: 'cat', target: 20, controllerId: 'audit' });
await measure('one polling pair', async () => { await request('/api/weekly-points'); await request('/api/artist-session'); });
await measure('polling pair + two preflights', async () => {
  for (const url of ['/api/weekly-points', '/api/artist-session']) { await request(url, undefined, 'OPTIONS'); await request(url); }
});
const guess = (id, text, userId) => session.processChatMessage({ broadcaster_user_id: '111', message_id: id, chatter_user_id: userId, chatter_user_name: 'Viewer', message: { text } });
await measure('wrong Twitch guess', () => guess('wrong1', 'dog', 'v1'));
await measure('correct Twitch guess', () => guess('right1', 'cat', 'v1'));
await measure('duplicate correct Twitch guess', () => guess('right1', 'cat', 'v1'));
session.twitchSession.scopes = ['user:write:chat'];
session.sendTwitchChatMessage = async () => {};
await measure('finpoints command', () => guess('cmd1', '!finpoints', 'v2'));
await measure('manual adjustment', () => request('/api/points/adjust', { userId: 'v1', displayName: 'Viewer', delta: 1 }));
const channel = env.FINDRAW_CHANNEL.objects.get('channel:111');
const base = await channelPointsStorage(channel.state.storage).get('points');
for (const viewers of [100, 1000, 5000]) {
  for (const weeks of [0, 20, 52]) {
    const data = structuredClone(base);
    const participants = Object.fromEntries(Array.from({ length: viewers }, (_, i) => [`${100000000 + i}`, { displayName: `Viewer_${i}`, score: 1000 }]));
    data.weeklyChannels['111'].participants = participants;
    data.weeklyHistory = Array.from({ length: weeks }, (_, i) => ({ ...data.weeklyChannels['111'], weekId: `archive-${i}`, status: 'completed', participants: structuredClone(participants) }));
    const row = data.ledger[0];
    data.ledger = Array.from({ length: 5000 }, (_, i) => ({ ...row, id: crypto.randomUUID(), userId: `${100000000+i%viewers}` }));
    out(JSON.stringify({ name: 'synthetic points blob', viewers, archivedWeeks: weeks, ledgerEntries: 5000, bytes: Buffer.byteLength(JSON.stringify(data)) }));
  }
}
const room = new FindrawRoom({ id: 'ABCDEF', storage: storage() }, env);
await room.ready;
const socket = { send() {} };
room.socketSessionKeys.set(socket, key);
await room.join(socket, { code: 'ABCDEF', create: true, clientId: 'a', name: 'A', reconnectToken: '1234567890123456789012345' });
room.room.phase = 'drawing'; room.room.drawerId = 'a'; room.room.answer = { answer: 'cat', aliases: [] }; room.room.endAt = Date.now()+90000;
await measure('room wrong guess', () => room.submitGuess({ id: 'b', name: 'B' }, { text: 'dog' }));
await measure('room drawing sync', () => room.syncDrawing({ operations: [] }));
await measure('room preview', () => room.previewDrawing(socket, { operation: null }));
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [{ file: path.join(dir,e.name), bytes: statSync(path.join(dir,e.name)).size }]);
}
for (const dir of ['public', 'dist']) {
  const files = walk(dir), types = {};
  for (const f of files) { const type = path.extname(f.file); types[type] ||= { count: 0, bytes: 0 }; types[type].count++; types[type].bytes += f.bytes; }
  out(JSON.stringify({ name: 'local assets', dir, count: files.length, bytes: files.reduce((s,f)=>s+f.bytes,0), types, largest: files.sort((a,b)=>b.bytes-a.bytes).slice(0,3) }));
}
