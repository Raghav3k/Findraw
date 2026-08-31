import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import WebSocket from "ws";
import {
  adjustPoints,
  clearTwitchSession,
  createCommunityPack,
  endArtistSession,
  getArtistSession,
  getArtistSessionHistory,
  getCommunityPackByShareCode,
  getLeaderboard,
  getWeeklyPointsSummary,
  getViewerStanding,
  loadTwitchSession,
  reportCommunityPack,
  saveTwitchSession,
  setArtistSessionRewardFulfilled,
  setWeeklyRewardFulfilled,
  setWeeklyRewards,
  startArtistSession,
  updateCommunityPack,
} from "./storage.mjs";
import {
  CommunityPackValidationError,
  validateCommunityPackInput,
  validateCommunityReportInput,
} from "../shared/communityPacks.mjs";

const app = express();
const port = Number(process.env.PORT || 3000);
const frontendUrl = process.env.FRONTEND_URL || "http://127.0.0.1:5173";
const twitchRedirectUri = process.env.TWITCH_REDIRECT_URI || "http://localhost:3000/auth/twitch/callback";
const twitchScopes = ["user:read:chat", "user:write:chat"];
const configured = () => Boolean(
  process.env.TWITCH_CLIENT_ID
  && process.env.TWITCH_CLIENT_SECRET
  && process.env.SESSION_SECRET,
);

app.use(express.json({ limit: "32kb" }));

const sseClients = new Set();
const allowedOAuthReturnPaths = new Set(["/", "/auto-draw", "/draw", "/room"]);
const createOAuthState = (returnTo) => {
  const payload = Buffer.from(JSON.stringify({
    returnTo,
    expiresAt: Date.now() + 10 * 60 * 1000,
    nonce: crypto.randomBytes(16).toString("base64url"),
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
};
const readOAuthState = (state) => {
  try {
    const [payload, signature] = String(state || "").split(".");
    if (!payload || !signature) return null;
    const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!allowedOAuthReturnPaths.has(value.returnTo) || value.expiresAt < Date.now()) return null;
    return value;
  } catch {
    return null;
  }
};
const sendEvent = (response, event) => {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
};
const broadcast = (event) => {
  for (const client of sseClients) sendEvent(client, event);
};

let twitchSession = null;
let eventSubSocket = null;
let eventSubStatus = "disconnected";
let keepaliveTimer = null;
let reconnectTimer = null;
let processedMessageIds = new Set();
let currentRound = null;
const commandUserCooldowns = new Map();
let commandResponseQueue = Promise.resolve();
let pendingCommandResponses = 0;
let lastCommandResponseAt = 0;
const commandUserCooldownMs = 15_000;
const commandResponseGapMs = 1_100;
const maximumPendingCommandResponses = 20;
const twitchChatCommands = new Set(["!finpoints", "!finsession", "!finrewards"]);
const logTwitchCommand = (stage, details = {}) => {
  console.info(`[Twitch command] ${stage}`, { at: new Date().toISOString(), ...details });
};

const sessionSummary = () => ({
  configured: configured(),
  authenticated: Boolean(twitchSession),
  eventSubStatus,
  canSendChat: Boolean(twitchSession?.scopes?.includes("user:write:chat")),
  chatCommandsEnabled: twitchSession?.chatCommandsEnabled !== false,
  user: twitchSession ? {
    id: twitchSession.userId,
    login: twitchSession.login,
    displayName: twitchSession.displayName,
    profileImageUrl: twitchSession.profileImageUrl || null,
  } : null,
});

const publishSession = () => broadcast({ type: "twitch-session", payload: sessionSummary() });

const twitchFetch = async (url, options = {}) => {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || `Twitch request failed (${response.status})`);
  }
  return body;
};

const refreshSession = async () => {
  if (!twitchSession?.refreshToken) return null;
  const body = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    client_secret: process.env.TWITCH_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: twitchSession.refreshToken,
  });
  const token = await twitchFetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  twitchSession = {
    ...twitchSession,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || twitchSession.refreshToken,
    scopes: Array.isArray(token.scope) ? token.scope : twitchSession.scopes,
    expiresAt: Date.now() + token.expires_in * 1000,
    validatedAt: Date.now(),
  };
  await saveTwitchSession(twitchSession);
  return twitchSession;
};

const validSession = async () => {
  if (!twitchSession) return null;
  if (twitchSession.expiresAt < Date.now() + 60_000) await refreshSession();
  const shouldValidate = Date.now() - (twitchSession.validatedAt || 0) > 60 * 60 * 1000;
  if (shouldValidate || !twitchSession.profileImageUrl || !Array.isArray(twitchSession.scopes)) {
    const validation = await twitchFetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${twitchSession.accessToken}` },
    });
    const users = await twitchFetch(`https://api.twitch.tv/helix/users?id=${validation.user_id}`, {
      headers: { Authorization: `Bearer ${twitchSession.accessToken}`, "Client-Id": process.env.TWITCH_CLIENT_ID },
    });
    const user = users.data?.[0];
    twitchSession = {
      ...twitchSession,
      userId: validation.user_id,
      login: validation.login,
      displayName: user?.display_name || validation.login,
      profileImageUrl: user?.profile_image_url || null,
      scopes: Array.isArray(validation.scopes) ? validation.scopes : [],
      expiresAt: Date.now() + validation.expires_in * 1000,
      validatedAt: Date.now(),
    };
    await saveTwitchSession(twitchSession);
  }
  return twitchSession;
};

const setEventSubStatus = (status) => {
  eventSubStatus = status;
  publishSession();
};

const clearEventSubTimers = () => {
  if (keepaliveTimer) clearTimeout(keepaliveTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  keepaliveTimer = null;
  reconnectTimer = null;
};

const scheduleKeepaliveDeadline = (seconds = 30) => {
  if (keepaliveTimer) clearTimeout(keepaliveTimer);
  keepaliveTimer = setTimeout(() => {
    eventSubSocket?.terminate();
  }, (seconds + 10) * 1000);
};

const subscribeToChat = async (sessionId) => {
  const session = await validSession();
  await twitchFetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Client-Id": process.env.TWITCH_CLIENT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "channel.chat.message",
      version: "1",
      condition: {
        broadcaster_user_id: session.userId,
        user_id: session.userId,
      },
      transport: {
        method: "websocket",
        session_id: sessionId,
      },
    }),
  });
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

const sendTwitchChatMessage = async (message, replyParentMessageId, expectedChannelId = twitchSession?.userId) => {
  const session = await validSession();
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
      "Client-Id": process.env.TWITCH_CLIENT_ID,
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
};

const enqueueCommandResponse = (message, replyParentMessageId, expectedChannelId = twitchSession?.userId) => {
  if (pendingCommandResponses >= maximumPendingCommandResponses) {
    logTwitchCommand("reply dropped before sending", { reason: "queue-full", pendingCommandResponses });
    return Promise.resolve();
  }
  pendingCommandResponses += 1;
  logTwitchCommand("reply queued", { replyParentMessageId, pendingCommandResponses });
  commandResponseQueue = commandResponseQueue
    .then(async () => {
      const delay = Math.max(0, lastCommandResponseAt + commandResponseGapMs - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      await sendTwitchChatMessage(message, replyParentMessageId, expectedChannelId);
      lastCommandResponseAt = Date.now();
    })
    .catch((error) => console.error("[Twitch command] reply failed", {
      at: new Date().toISOString(),
      replyParentMessageId,
      error: error.message,
    }))
    .finally(() => { pendingCommandResponses -= 1; });
  return commandResponseQueue;
};

const handleChatCommand = async (message) => {
  const channelId = twitchSession?.userId;
  const command = message.message.trim().toLocaleLowerCase("en").split(/\s+/)[0];
  if (!twitchChatCommands.has(command)) return;
  logTwitchCommand("recognized", {
    command,
    user: message.name,
    messageId: message.id,
    enabled: twitchSession?.chatCommandsEnabled !== false,
    scopes: Array.isArray(twitchSession?.scopes) ? twitchSession.scopes : [],
  });
  if (twitchSession?.chatCommandsEnabled === false) {
    logTwitchCommand("ignored", { command, user: message.name, reason: "commands-disabled" });
    return;
  }
  if (!twitchSession?.scopes?.includes("user:write:chat")) {
    logTwitchCommand("ignored", { command, user: message.name, reason: "missing-user:write:chat" });
    return;
  }
  const cooldownKey = `${twitchSession.userId}:${message.userId}`;
  const cooldownUntil = commandUserCooldowns.get(cooldownKey) || 0;
  if (cooldownUntil > Date.now()) {
    logTwitchCommand("ignored", { command, user: message.name, reason: "cooldown", retryInMs: cooldownUntil - Date.now() });
    return;
  }
  commandUserCooldowns.set(cooldownKey, Date.now() + commandUserCooldownMs);

  let reply;
  if (command === "!finpoints") {
    const standing = await getViewerStanding(twitchSession.userId, message.userId);
    reply = standing.rank
      ? `[Findraw] @${message.name} You have ${standing.score} points and are ${ordinal(standing.rank)} this week. Weekly points reset Monday at 00:00 UTC.`
      : `[Findraw] @${message.name} You have no weekly Findraw Points yet. Weekly points reset Monday at 00:00 UTC.`;
  } else {
    const session = await getArtistSession(twitchSession.userId);
    if (command === "!finsession" && !session) {
      reply = `[Findraw] @${message.name} No reward session is active right now.`;
    } else if (command === "!finsession") {
      const index = session.standings.findIndex((entry) => entry.userId === message.userId);
      reply = index >= 0
        ? `[Findraw] @${message.name} You have ${session.standings[index].score} session points and are ${ordinal(index + 1)}.`
        : `[Findraw] @${message.name} You have no points in this session yet.`;
    } else {
      const weekly = await getWeeklyPointsSummary(twitchSession.userId);
      const rewards = session?.rewards?.length ? session.rewards : weekly.current?.rewards || [];
      const label = session?.rewards?.length ? `${session.name} rewards` : "Weekly rewards";
      reply = `[Findraw] @${message.name} ${rewards.length ? `${label}: ${rewards.map((reward) => `${ordinal(reward.position)}: ${reward.reward}`).join(" | ")}` : "No hosted-session or weekly rewards are listed right now."}`;
    }
  }
  if (twitchSession?.userId !== channelId) return;
  return enqueueCommandResponse(reply, message.id, channelId);
};

const processChatMessage = async (event) => {
  const channelId = twitchSession?.userId;
  if (event.broadcaster_user_id && event.broadcaster_user_id !== channelId) return;
  const message = {
    id: event.message_id,
    userId: event.chatter_user_id,
    name: event.chatter_user_name || event.chatter_user_login,
    message: event.message?.text || "",
    color: event.color || null,
  };
  console.info("[Twitch chat] received", {
    at: new Date().toISOString(),
    user: message.name,
    messageId: message.id,
    message: message.message.slice(0, 200),
  });
  broadcast({ type: "chat-message", payload: message });
  await handleChatCommand(message);

  if (channelId !== twitchSession?.userId) return;

  if (!currentRound || currentRound.status !== "playing") return;
  if (currentRound.solvedUserIds.has(message.userId)) return;
  if (!currentRound.answers.has(normalizeGuess(message.message))) return;

  const position = currentRound.solvers.length + 1;
  const points = pointsForPosition(position);
  currentRound.solvedUserIds.add(message.userId);
  const solver = {
    userId: message.userId,
    name: message.name,
    points,
    position,
  };
  currentRound.solvers.push(solver);
  const testMessage = event.findraw_test_bot === true;
  if (!testMessage) {
    await adjustPoints({
      channelId: twitchSession.userId,
      userId: message.userId,
      displayName: message.name,
      delta: points,
      reason: `Correct guess (#${position})`,
      roundId: currentRound.id,
    });
  }
  broadcast({ type: "correct-guess", payload: { roundId: currentRound.id, solver } });
  if (!testMessage) {
    broadcast({ type: "artist-session", payload: await getArtistSession(twitchSession.userId) });
    broadcast({
      type: "leaderboard",
      payload: await getLeaderboard(twitchSession.userId),
    });
    broadcast({ type: "weekly-points", payload: await getWeeklyPointsSummary(twitchSession.userId) });
  }
  if (currentRound.solvers.length >= currentRound.target) {
    currentRound.status = "ended";
    broadcast({ type: "round-ended", payload: { roundId: currentRound.id, reason: "target-reached" } });
  }
};

const rememberMessage = (messageId) => {
  if (processedMessageIds.has(messageId)) return false;
  processedMessageIds.add(messageId);
  if (processedMessageIds.size > 2000) {
    processedMessageIds = new Set([...processedMessageIds].slice(-1000));
  }
  return true;
};

const connectEventSub = async (url = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30", shouldSubscribe = true) => {
  if (!twitchSession) return;
  clearEventSubTimers();
  if (eventSubSocket) {
    eventSubSocket.removeAllListeners();
    eventSubSocket.close();
  }
  setEventSubStatus("connecting");
  const socket = new WebSocket(url);
  eventSubSocket = socket;

  socket.on("message", async (data) => {
    try {
      const envelope = JSON.parse(data.toString());
      const messageType = envelope.metadata?.message_type;
      if (messageType === "session_welcome") {
        scheduleKeepaliveDeadline(envelope.payload.session.keepalive_timeout_seconds);
        if (shouldSubscribe) await subscribeToChat(envelope.payload.session.id);
        setEventSubStatus("connected");
        return;
      }
      if (messageType === "session_keepalive") {
        scheduleKeepaliveDeadline();
        return;
      }
      if (messageType === "session_reconnect") {
        await connectEventSub(envelope.payload.session.reconnect_url, false);
        return;
      }
      if (messageType === "revocation") {
        setEventSubStatus("revoked");
        return;
      }
      if (messageType === "notification") {
        scheduleKeepaliveDeadline();
        if (!rememberMessage(envelope.metadata.message_id)) return;
        if (envelope.payload.subscription.type === "channel.chat.message") {
          await processChatMessage(envelope.payload.event);
        }
      }
    } catch (error) {
      console.error("EventSub message failed:", error.message);
    }
  });

  socket.on("close", () => {
    if (eventSubSocket !== socket || !twitchSession) return;
    setEventSubStatus("reconnecting");
    reconnectTimer = setTimeout(() => connectEventSub().catch(console.error), 3000);
  });
  socket.on("error", (error) => {
    console.error("EventSub socket error:", error.message);
  });
};

app.get("/health", (_request, response) => response.json({ ok: true }));

app.get("/auth/twitch/start", (request, response) => {
  if (!configured()) {
    response.status(503).send("Twitch is not configured. Add the required values to .env.");
    return;
  }
  const requestedReturnTo = String(request.query.returnTo || "");
  const returnTo = allowedOAuthReturnPaths.has(requestedReturnTo) ? requestedReturnTo : "/";
  const state = createOAuthState(returnTo);

  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: process.env.TWITCH_CLIENT_ID,
    redirect_uri: twitchRedirectUri,
    scope: twitchScopes.join(" "),
    state,
    ...(request.query.switch === "1" ? { force_verify: "true" } : {}),
  });
  response.redirect(url.toString());
});

app.get("/auth/twitch/callback", async (request, response) => {
  try {
    const state = String(request.query.state || "");
    const stateEntry = readOAuthState(state);
    if (!request.query.code || !stateEntry) {
      response.status(400).send("The Twitch sign-in state was invalid or expired.");
      return;
    }
    const body = new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      code: String(request.query.code),
      grant_type: "authorization_code",
      redirect_uri: twitchRedirectUri,
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
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Client-Id": process.env.TWITCH_CLIENT_ID,
      },
    });
    if (currentRound) broadcast({ type: "round-ended", payload: { roundId: currentRound.id, reason: "account-switched" } });
    currentRound = null;
    if (global.testBotTimer) clearInterval(global.testBotTimer);
    twitchSession = {
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
    await saveTwitchSession(twitchSession);
    await connectEventSub();
    response.clearCookie("findraw_oauth_state", { path: "/" });
    response.redirect(`${frontendUrl}${stateEntry.returnTo}?twitch=connected`);
  } catch (error) {
    console.error("Twitch callback failed:", error);
    response.status(500).send(`Twitch connection failed: ${error.message}`);
  }
});

app.get("/api/twitch/session", (_request, response) => response.json(sessionSummary()));
// The Express launcher is a single-streamer development server. Its points file
// is already keyed by Twitch channel, but it is not a multi-user auth deployment.
app.get("/api/channel/status", (_request, response) => response.json({ authenticated: Boolean(twitchSession), shared: false, migrationConflicts: 0 }));
app.get("/api/channel/legacy-backups", (_request, response) => response.status(404).json({ error: "Legacy browser migration applies to Cloudflare only." }));

app.post("/api/twitch/chat-commands", async (request, response) => {
  if (!twitchSession) return response.status(401).json({ error: "Connect Twitch first." });
  twitchSession = { ...twitchSession, chatCommandsEnabled: Boolean(request.body.enabled) };
  await saveTwitchSession(twitchSession);
  publishSession();
  response.json(sessionSummary());
});

const communityError = (response, error) => {
  if (error instanceof CommunityPackValidationError) {
    return response.status(error.status).json({ error: error.message, field: error.field });
  }
  console.error("Community pack request failed:", error);
  return response.status(500).json({ error: "Community pack request failed." });
};

app.post("/api/community-packs", async (request, response) => {
  try {
    const input = validateCommunityPackInput(request.body, { extraBlockedTerms: process.env.COMMUNITY_BLOCKED_TERMS });
    response.status(201).json(await createCommunityPack(input));
  } catch (error) {
    communityError(response, error);
  }
});

app.get("/api/community-packs/:shareCode", async (request, response) => {
  try {
    const pack = await getCommunityPackByShareCode(request.params.shareCode);
    if (!pack) return response.status(404).json({ error: "Community pack not found." });
    response.json({ pack });
  } catch (error) {
    communityError(response, error);
  }
});

app.put("/api/community-packs/:id", async (request, response) => {
  try {
    const editToken = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const input = validateCommunityPackInput(request.body, { extraBlockedTerms: process.env.COMMUNITY_BLOCKED_TERMS });
    const result = await updateCommunityPack(request.params.id, editToken, input);
    if (result.type === "not-found") return response.status(404).json({ error: "Community pack not found." });
    if (result.type === "forbidden") return response.status(403).json({ error: "The edit token is invalid." });
    response.json({ pack: result.pack });
  } catch (error) {
    communityError(response, error);
  }
});

app.post("/api/community-packs/:id/report", async (request, response) => {
  try {
    const input = validateCommunityReportInput(request.body);
    const result = await reportCommunityPack(request.params.id, {
      ...input,
      reporterScope: request.ip || request.socket.remoteAddress,
    });
    if (result.type === "not-found") return response.status(404).json({ error: "Community pack not found." });
    response.json({ ok: true, duplicate: result.duplicate, status: result.status });
  } catch (error) {
    communityError(response, error);
  }
});

app.post("/api/twitch/disconnect", async (_request, response) => {
  twitchSession = null;
  currentRound = null;
  clearEventSubTimers();
  if (eventSubSocket) eventSubSocket.close();
  eventSubSocket = null;
  setEventSubStatus("disconnected");
  await clearTwitchSession();
  response.json({ ok: true });
});

app.get("/api/events", (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();
  sseClients.add(response);
  sendEvent(response, { type: "twitch-session", payload: sessionSummary() });
  request.on("close", () => sseClients.delete(response));
});

app.get("/api/leaderboard", async (_request, response) => {
  if (!twitchSession) return response.json([]);
  response.json(await getLeaderboard(twitchSession.userId));
});

app.get("/api/weekly-points", async (_request, response) => {
  if (!twitchSession) return response.json({ current: null, history: [] });
  response.json(await getWeeklyPointsSummary(twitchSession.userId));
});

app.post("/api/weekly-points/rewards", async (request, response) => {
  if (!twitchSession) return response.status(401).json({ error: "Connect Twitch first." });
  const season = await setWeeklyRewards({
    channelId: twitchSession.userId,
    weekId: String(request.body.weekId || ""),
    rewards: request.body.rewards,
  });
  if (!season) return response.status(404).json({ error: "Weekly result not found." });
  const summary = await getWeeklyPointsSummary(twitchSession.userId);
  broadcast({ type: "weekly-points", payload: summary });
  response.json({ season, summary });
});

app.post("/api/weekly-points/reward", async (request, response) => {
  if (!twitchSession) return response.status(401).json({ error: "Connect Twitch first." });
  const season = await setWeeklyRewardFulfilled({
    channelId: twitchSession.userId,
    weekId: String(request.body.weekId || ""),
    position: Math.trunc(Number(request.body.position)),
    fulfilled: Boolean(request.body.fulfilled),
  });
  if (!season) return response.status(404).json({ error: "Weekly result not found." });
  const summary = await getWeeklyPointsSummary(twitchSession.userId);
  broadcast({ type: "weekly-points", payload: summary });
  response.json({ season, summary });
});

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

app.get("/api/artist-session", async (_request, response) => {
  if (!twitchSession) return response.json({ active: null, history: [] });
  response.json({
    active: await getArtistSession(twitchSession.userId),
    history: await getArtistSessionHistory(twitchSession.userId),
  });
});

app.post("/api/artist-session/start", async (request, response) => {
  if (!twitchSession) return response.status(401).json({ error: "Connect Twitch before starting a hosted session." });
  try {
    const rewards = normalizeSessionRewards(request.body.rewards);
    if (!rewards.some((reward) => reward.position === 1)) return response.status(400).json({ error: "Add a first-place reward before starting the session." });
    const session = await startArtistSession({
      channelId: twitchSession.userId,
      name: String(request.body.name || "Hosted session").trim().replace(/\s+/g, " ").slice(0, 60) || "Hosted session",
      rewards,
    });
    broadcast({ type: "artist-session", payload: session });
    response.json({ session });
  } catch (error) {
    response.status(409).json({ error: error.message || "A session is already active." });
  }
});

app.post("/api/artist-session/end", async (_request, response) => {
  if (!twitchSession) return response.status(401).json({ error: "Connect Twitch first." });
  const session = await endArtistSession(twitchSession.userId);
  if (!session) return response.status(404).json({ error: "No hosted session is active." });
  broadcast({ type: "artist-session", payload: null });
  response.json({ session });
});

app.post("/api/artist-session/reward", async (request, response) => {
  if (!twitchSession) return response.status(401).json({ error: "Connect Twitch first." });
  const session = await setArtistSessionRewardFulfilled({
    channelId: twitchSession.userId,
    sessionId: String(request.body.sessionId || ""),
    position: Math.trunc(Number(request.body.position)),
    fulfilled: Boolean(request.body.fulfilled),
  });
  if (!session) return response.status(404).json({ error: "Session result not found." });
  response.json({ session });
});

app.post("/api/round/start", (request, response) => {
  const controllerId = String(request.body.controllerId || "legacy").slice(0, 100);
  if (currentRound?.status === "playing" && currentRound.controllerId !== controllerId &&
      Date.now() - currentRound.startedAt < 15 * 60_000 && request.body.takeover !== true) {
    return response.status(409).json({ error: "Another tab is scoring. Take over to end its round and start here.", code: "ROUND_OWNED" });
  }
  const answer = String(request.body.answer || "").trim();
  const aliases = Array.isArray(request.body.aliases) ? request.body.aliases : [];
  const target = Math.min(100, Math.max(1, Number(request.body.target) || 10));
  if (!answer) return response.status(400).json({ error: "An answer is required." });
  if (currentRound?.status === "playing") broadcast({ type: "round-ended", payload: { roundId: currentRound.id, reason: "taken-over" } });
  currentRound = {
    id: crypto.randomUUID(),
    status: "playing",
    answer,
    answers: new Set([answer, ...aliases].map(normalizeGuess).filter(Boolean)),
    target,
    solvers: [],
    solvedUserIds: new Set(),
    startedAt: Date.now(),
    controllerId,
  };
  broadcast({ type: "round-started", payload: { roundId: currentRound.id, target, controllerId } });

  if (global.testBotTimer) clearInterval(global.testBotTimer);
  if (request.body.testBots) {
    global.testBotTimer = setInterval(() => {
      if (!currentRound || currentRound.status !== "playing") {
        clearInterval(global.testBotTimer);
        return;
      }
      const baseNames = ["AstroBot", "PixelPusher", "DrawDude", "Sketchy", "DoodleBob"];
      const name = baseNames[Math.floor(Math.random() * baseNames.length)] + "_" + Math.floor(Math.random() * 10000);
      const isCorrect = Math.random() < 0.40;
      const guessText = isCorrect ? answer : ["umm maybe", "is it a dog?", "I have no idea", "looks like", "almost there", "hello chat"][Math.floor(Math.random() * 6)] + " " + Math.random().toString(36).substring(7);
      processChatMessage({
        message_id: crypto.randomUUID(),
        chatter_user_id: "bot_" + name,
        chatter_user_name: name,
        message: { text: guessText },
        color: ["#FF5733", "#33FF57", "#3357FF", "#F033FF", "#33FFF0"][Math.floor(Math.random() * 5)],
        findraw_test_bot: true,
      }).catch(console.error);
    }, 400);
  }

  response.json({ roundId: currentRound.id });
});

app.post("/api/round/end", (request, response) => {
  if (request.body?.controllerId && currentRound?.controllerId !== request.body.controllerId) return response.json({ ok: true });
  if (currentRound) {
    currentRound.status = "ended";
    broadcast({ type: "round-ended", payload: { roundId: currentRound.id, reason: "manual" } });
  }
  response.json({ ok: true });
});

app.post("/api/points/adjust", async (request, response) => {
  if (!twitchSession) return response.status(401).json({ error: "Connect Twitch first." });
  const userId = String(request.body.userId || "");
  const displayName = String(request.body.displayName || "");
  const delta = Math.trunc(Number(request.body.delta));
  if (!userId || !displayName || !Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 10000) {
    return response.status(400).json({ error: "A valid viewer and adjustment are required." });
  }
  const viewer = await adjustPoints({
    channelId: twitchSession.userId,
    userId,
    displayName,
    delta,
    reason: String(request.body.reason || "Streamer adjustment").slice(0, 120),
    roundId: currentRound?.id,
  });
  const leaderboard = await getLeaderboard(twitchSession.userId);
  broadcast({ type: "leaderboard", payload: leaderboard });
  broadcast({ type: "artist-session", payload: await getArtistSession(twitchSession.userId) });
  const weeklyPoints = await getWeeklyPointsSummary(twitchSession.userId);
  broadcast({ type: "weekly-points", payload: weeklyPoints });
  response.json({ viewer, leaderboard, weeklyPoints });
});

const start = async () => {
  if (configured()) {
    try {
      twitchSession = await loadTwitchSession();
      if (twitchSession) {
        await validSession();
        await connectEventSub();
      }
    } catch (error) {
      console.error("Saved Twitch session could not be restored:", error.message);
      twitchSession = null;
    }
  }
  app.listen(port, "127.0.0.1", () => {
    console.log(`Findraw server running at http://127.0.0.1:${port}`);
  });
};

start();
