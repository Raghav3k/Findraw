import { prunePointsHistory, nextPointsMaintenance } from "./pointsRetention.mjs";

const PREFIX = "points-v4:";
const MARKER = "points-layout";
// UTF-16 chunks remain comfortably below the DO value limit even with escaping.
const CHUNK_CHARS = 24_000;
const bucket = (value) => {
  let hash = 0;
  for (const char of String(value)) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return (hash >>> 0) % 32;
};

function segments(data) {
  const result = new Map();
  const put = (path, value) => { result.set(JSON.stringify(path), JSON.stringify(value)); };
  const participantSegments = (path, participants) => {
    const groups = new Map();
    for (const [id, participant] of Object.entries(participants || {})) {
      const key = bucket(id);
      if (!groups.has(key)) groups.set(key, {});
      groups.get(key)[id] = participant;
    }
    for (const [key, value] of groups) put([...path, "participants", key], value);
  };
  put(["base"], Object.fromEntries(Object.entries(data).filter(([key]) => !["channels", "weeklyChannels", "weeklyHistory", "activeSessions", "sessionHistory", "ledger"].includes(key))));
  for (const [id, participants] of Object.entries(data.channels || {})) participantSegments(["channels", id], participants);
  for (const field of ["weeklyChannels", "activeSessions", "weeklyHistory", "sessionHistory"]) {
    const array = field.endsWith("History");
    const entries = array ? (data[field] || []).map((entry) => [`${entry.channelId}:${entry.id || entry.weekId}`, entry]) : Object.entries(data[field] || {});
    if (array) put([field, "order"], entries.map(([id]) => id));
    for (const [id, entry] of entries) {
      const { participants, ...meta } = entry;
      put([field, id, "meta"], meta);
      participantSegments([field, id], participants);
    }
  }
  const ledgerGroups = new Map();
  for (const entry of data.ledger || []) {
    const key = bucket(entry.id);
    if (!ledgerGroups.has(key)) ledgerGroups.set(key, []);
    ledgerGroups.get(key).push(entry);
  }
  for (const [key, entries] of ledgerGroups) put(["ledger", key], entries.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id))));
  return result;
}

function encodeRecords(data) {
  const records = new Map();
  for (const [path, encoded] of segments(data)) {
    // Path encoding is ASCII and bounded by server-controlled IDs.
    const key = `${PREFIX}${encodeURIComponent(path)}:`;
    for (let offset = 0, index = 0; offset < encoded.length; offset += CHUNK_CHARS, index++) {
      records.set(`${key}${String(index).padStart(6, "0")}`, encoded.slice(offset, offset + CHUNK_CHARS));
    }
  }
  return records;
}

function decodeRecords(records) {
  const joined = new Map();
  for (const [key, value] of [...records].sort(([a], [b]) => a.localeCompare(b))) {
    const end = key.lastIndexOf(":");
    const path = decodeURIComponent(key.slice(PREFIX.length, end));
    joined.set(path, (joined.get(path) || "") + value);
  }
  const data = { channels: {}, weeklyChannels: {}, activeSessions: {}, weeklyHistory: {}, sessionHistory: {}, ledger: [] };
  const orders = {};
  for (const [path, value] of joined) {
    const [field, id, kind] = JSON.parse(path);
    const decoded = JSON.parse(value);
    if (field === "base") { Object.assign(data, decoded); continue; }
    if (field === "ledger") { data.ledger.push(...decoded); continue; }
    if (id === "order") { orders[field] = decoded; continue; }
    if (field === "channels") { Object.assign(data.channels[id] ||= {}, decoded); continue; }
    const entry = data[field][id] ||= { participants: {} };
    if (kind === "meta") Object.assign(entry, decoded);
    else Object.assign(entry.participants, decoded);
  }
  for (const field of ["weeklyHistory", "sessionHistory"]) data[field] = (orders[field] || []).map((id) => data[field][id]);
  data.ledger.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
  return data;
}

// Wrap the existing domain handlers inside their transaction. They still operate
// on one logical model; only changed, bounded records are actually written.
export function channelPointsStorage(storage) {
  let records;
  let loaded;
  let migrated = false;
  const adapter = Object.create(storage);
  adapter.delete = (...args) => storage.delete(...args);
  adapter.list = (...args) => storage.list(...args);
  adapter.get = async (key) => {
    if (key !== "points") return storage.get(key);
    if (loaded !== undefined) return structuredClone(loaded);
    migrated = await storage.get(MARKER) === 4;
    records = migrated ? await storage.list({ prefix: PREFIX }) : new Map();
    loaded = migrated ? decodeRecords(records) : await storage.get("points");
    return structuredClone(loaded);
  };
  adapter.put = async (key, value) => {
    if (key !== "points") return storage.put(key, value);
    if (!records) await adapter.get("points");
    prunePointsHistory(value);
    const next = encodeRecords(value);
    for (const [recordKey, encoded] of next) if (records.get(recordKey) !== encoded) await storage.put(recordKey, encoded);
    for (const recordKey of records.keys()) if (!next.has(recordKey)) await storage.delete(recordKey);
    if (!migrated) {
      await storage.put(MARKER, 4);
      // Transaction commits the replacement and removal together, never halfway.
      await storage.delete("points");
      migrated = true;
    }
    records = next;
    loaded = structuredClone(value);
    if (storage.getAlarm) {
      const next = nextPointsMaintenance(value);
      const current = await storage.getAlarm();
      if (next !== current) {
        if (next) await storage.setAlarm(next);
        else if (current) await storage.deleteAlarm();
      }
    }
  };
  return adapter;
}
