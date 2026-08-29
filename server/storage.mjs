import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { COMMUNITY_REPORT_QUARANTINE_THRESHOLD, publicCommunityPack } from "../shared/communityPacks.mjs";

const dataDirectory = path.resolve(process.env.FINDRAW_DATA_DIRECTORY || ".findraw-data");
const tokenPath = path.join(dataDirectory, "twitch-session.json");
const pointsPath = path.join(dataDirectory, "points.json");
const communityPacksPath = path.join(dataDirectory, "community-packs.json");
let pointsQueue = Promise.resolve();
let communityPacksQueue = Promise.resolve();

const ensureDirectory = () => fs.mkdir(dataDirectory, { recursive: true });

const encryptionKey = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required");
  return crypto.createHash("sha256").update(secret).digest();
};

const writeJsonAtomic = async (target, value) => {
  await ensureDirectory();
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
    // Windows does not consistently replace an existing file with rename().
    // copyFile() does replace it, so use that as the cross-platform fallback.
    await fs.copyFile(temporary, target);
    await fs.rm(temporary, { force: true });
  }
};

export async function saveTwitchSession(session) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  await writeJsonAtomic(tokenPath, {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  });
}

export async function loadTwitchSession() {
  const temporaryTokenPath = `${tokenPath}.tmp`;
  const readSession = async (source) => {
    const stored = JSON.parse(await fs.readFile(source, "utf8"));
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(stored.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(stored.tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(stored.data, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8"));
  };

  try {
    const session = await readSession(temporaryTokenPath);
    // Recover a completed refresh that could not replace the old token file.
    await fs.copyFile(temporaryTokenPath, tokenPath);
    await fs.rm(temporaryTokenPath, { force: true });
    return session;
  } catch {
    // Ignore a missing or incomplete temporary file and try the last complete session.
  }

  try {
    return await readSession(tokenPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function clearTwitchSession() {
  await fs.rm(tokenPath, { force: true });
}

const emptyPoints = () => ({ version: 2, channels: {}, ledger: [], activeSessions: {}, sessionHistory: [] });

const normalizePoints = (value) => ({
  ...emptyPoints(),
  ...(value && typeof value === "object" ? value : {}),
  version: 2,
  channels: value?.channels && typeof value.channels === "object" ? value.channels : {},
  ledger: Array.isArray(value?.ledger) ? value.ledger : [],
  activeSessions: value?.activeSessions && typeof value.activeSessions === "object" ? value.activeSessions : {},
  sessionHistory: Array.isArray(value?.sessionHistory) ? value.sessionHistory : [],
});

const publicArtistSession = (session) => session ? {
  id: session.id,
  name: session.name,
  status: session.status,
  startedAt: session.startedAt,
  endedAt: session.endedAt ?? null,
  rewards: session.rewards,
  standings: Object.entries(session.participants || {})
    .map(([userId, value]) => ({ userId, ...value }))
    .sort((first, second) => second.score - first.score || first.displayName.localeCompare(second.displayName)),
} : null;

export async function loadPoints() {
  try {
    return normalizePoints(JSON.parse(await fs.readFile(pointsPath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyPoints();
    throw error;
  }
}

const mutatePoints = (operation) => {
  const queued = pointsQueue.then(async () => {
    const data = await loadPoints();
    const result = await operation(data);
    await writeJsonAtomic(pointsPath, data);
    return result;
  });
  pointsQueue = queued.catch(() => undefined);
  return queued;
};

export function adjustPoints({ channelId, userId, displayName, delta, reason, roundId }) {
  return mutatePoints(async (data) => {
    const channel = data.channels[channelId] ?? {};
    const current = channel[userId] ?? { displayName, score: 0 };
    channel[userId] = {
      displayName,
      score: Math.max(0, current.score + delta),
    };
    data.channels[channelId] = channel;
    data.ledger.push({
      id: crypto.randomUUID(),
      channelId,
      userId,
      displayName,
      delta,
      reason,
      roundId: roundId ?? null,
      createdAt: new Date().toISOString(),
    });
    data.ledger = data.ledger.slice(-5000);
    const activeSession = data.activeSessions[channelId];
    if (activeSession?.status === "active") {
      const participant = activeSession.participants[userId] ?? { displayName, score: 0 };
      activeSession.participants[userId] = {
        displayName,
        score: Math.max(0, participant.score + delta),
      };
    }
    return channel[userId];
  });
}

export async function getLeaderboard(channelId) {
  const data = await loadPoints();
  return Object.entries(data.channels[channelId] ?? {})
    .map(([userId, value]) => ({ userId, ...value }))
    .sort((first, second) => second.score - first.score)
    .slice(0, 100);
}

export async function getViewerStanding(channelId, userId) {
  const data = await loadPoints();
  const standings = Object.entries(data.channels[channelId] ?? {})
    .map(([entryUserId, value]) => ({ userId: entryUserId, ...value }))
    .sort((first, second) => second.score - first.score);
  const index = standings.findIndex((entry) => entry.userId === userId);
  return index < 0 ? { userId, displayName: null, score: 0, rank: null } : { ...standings[index], rank: index + 1 };
}

export async function getArtistSession(channelId) {
  const data = await loadPoints();
  return publicArtistSession(data.activeSessions[channelId]);
}

export async function getArtistSessionHistory(channelId) {
  const data = await loadPoints();
  return data.sessionHistory.filter((session) => session.channelId === channelId).slice(-20).reverse().map(publicArtistSession);
}

export function startArtistSession({ channelId, name, rewards }) {
  return mutatePoints(async (data) => {
    if (data.activeSessions[channelId]?.status === "active") throw new Error("End the current session before starting another one.");
    const session = {
      id: crypto.randomUUID(),
      channelId,
      name,
      status: "active",
      startedAt: new Date().toISOString(),
      endedAt: null,
      rewards,
      participants: {},
    };
    data.activeSessions[channelId] = session;
    return publicArtistSession(session);
  });
}

export function endArtistSession(channelId) {
  return mutatePoints(async (data) => {
    const session = data.activeSessions[channelId];
    if (!session) return null;
    session.status = "completed";
    session.endedAt = new Date().toISOString();
    data.sessionHistory.push(session);
    data.sessionHistory = data.sessionHistory.slice(-200);
    delete data.activeSessions[channelId];
    return publicArtistSession(session);
  });
}

export function setArtistSessionRewardFulfilled({ channelId, sessionId, position, fulfilled }) {
  return mutatePoints(async (data) => {
    const session = data.sessionHistory.find((entry) => entry.channelId === channelId && entry.id === sessionId);
    if (!session) return null;
    const reward = session.rewards.find((entry) => entry.position === position);
    if (!reward) return publicArtistSession(session);
    reward.fulfilled = fulfilled;
    return publicArtistSession(session);
  });
}

const emptyCommunityPacks = () => ({ version: 1, packs: {}, shareCodes: {} });
const tokenHash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const shareAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const createShareCode = () => Array.from(crypto.randomBytes(10), (byte) => shareAlphabet[byte % shareAlphabet.length]).join("");

async function loadCommunityPacks() {
  try {
    const stored = JSON.parse(await fs.readFile(communityPacksPath, "utf8"));
    return stored?.version === 1 ? stored : emptyCommunityPacks();
  } catch (error) {
    if (error?.code === "ENOENT") return emptyCommunityPacks();
    throw error;
  }
}

const mutateCommunityPacks = (operation) => {
  const queued = communityPacksQueue.then(async () => {
    const data = await loadCommunityPacks();
    const result = await operation(data);
    await writeJsonAtomic(communityPacksPath, data);
    return result;
  });
  communityPacksQueue = queued.catch(() => undefined);
  return queued;
};

export function createCommunityPack(input) {
  return mutateCommunityPacks(async (data) => {
    let shareCode = createShareCode();
    while (data.shareCodes[shareCode]) shareCode = createShareCode();
    const id = crypto.randomUUID();
    const editToken = crypto.randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    const pack = {
      id,
      ...input,
      visibility: "unlisted",
      status: "published",
      shareCode,
      editTokenHash: tokenHash(editToken),
      reportCount: 0,
      reportKeys: [],
      reports: [],
      createdAt: now,
      updatedAt: now,
    };
    data.packs[id] = pack;
    data.shareCodes[shareCode] = id;
    return { pack: publicCommunityPack(pack), editToken };
  });
}

export async function getCommunityPackByShareCode(value) {
  const shareCode = String(value || "").trim().toUpperCase();
  const data = await loadCommunityPacks();
  const pack = data.packs[data.shareCodes[shareCode]];
  if (!pack || pack.status !== "published") return null;
  return publicCommunityPack(pack);
}

const tokenMatches = (pack, editToken) => {
  const actual = Buffer.from(tokenHash(editToken));
  const expected = Buffer.from(String(pack?.editTokenHash || ""));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

export function updateCommunityPack(id, editToken, input) {
  return mutateCommunityPacks(async (data) => {
    const pack = data.packs[id];
    if (!pack) return { type: "not-found" };
    if (!tokenMatches(pack, editToken)) return { type: "forbidden" };
    Object.assign(pack, input, { updatedAt: new Date().toISOString() });
    return { type: "ok", pack: publicCommunityPack(pack) };
  });
}

export function reportCommunityPack(id, input) {
  return mutateCommunityPacks(async (data) => {
    const pack = data.packs[id];
    if (!pack) return { type: "not-found" };
    const reportIdentity = `${process.env.SESSION_SECRET || "findraw-local"}:community-report:${input.reporterScope || input.reporterKey}`;
    const reportKey = tokenHash(reportIdentity);
    pack.reportKeys = Array.isArray(pack.reportKeys) ? pack.reportKeys : [];
    pack.reports = Array.isArray(pack.reports) ? pack.reports : [];
    if (pack.reportKeys.includes(reportKey)) {
      return { type: "ok", duplicate: true, status: pack.status };
    }
    pack.reportKeys.push(reportKey);
    pack.reports.push({
      id: crypto.randomUUID(),
      reason: input.reason,
      details: input.details,
      reporterKeyHash: reportKey,
      createdAt: new Date().toISOString(),
    });
    pack.reportCount = pack.reportKeys.length;
    if (pack.reportCount >= COMMUNITY_REPORT_QUARANTINE_THRESHOLD) pack.status = "quarantined";
    pack.updatedAt = new Date().toISOString();
    return { type: "ok", duplicate: false, status: pack.status };
  });
}
