import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const dataDirectory = path.resolve(".findraw-data");
const tokenPath = path.join(dataDirectory, "twitch-session.json");
const pointsPath = path.join(dataDirectory, "points.json");
let pointsQueue = Promise.resolve();

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

const emptyPoints = () => ({ version: 1, channels: {}, ledger: [] });

export async function loadPoints() {
  try {
    return JSON.parse(await fs.readFile(pointsPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyPoints();
    throw error;
  }
}

export function adjustPoints({ channelId, userId, displayName, delta, reason, roundId }) {
  const operation = pointsQueue.then(async () => {
    const data = await loadPoints();
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
    await writeJsonAtomic(pointsPath, data);
    return channel[userId];
  });
  pointsQueue = operation.catch(() => undefined);
  return operation;
}

export async function getLeaderboard(channelId) {
  const data = await loadPoints();
  return Object.entries(data.channels[channelId] ?? {})
    .map(([userId, value]) => ({ userId, ...value }))
    .sort((first, second) => second.score - first.score)
    .slice(0, 100);
}
