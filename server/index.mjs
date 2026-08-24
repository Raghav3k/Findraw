import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import WebSocket from "ws";
import {
  adjustPoints,
  clearTwitchSession,
  getLeaderboard,
  loadTwitchSession,
  saveTwitchSession,
} from "./storage.mjs";

const app = express();
const port = Number(process.env.PORT || 3000);
const frontendUrl = process.env.FRONTEND_URL || "http://127.0.0.1:5173";
const twitchRedirectUri = process.env.TWITCH_REDIRECT_URI || "http://localhost:3000/auth/twitch/callback";
const twitchScopes = ["user:read:chat"];
const configured = () => Boolean(
  process.env.TWITCH_CLIENT_ID
  && process.env.TWITCH_CLIENT_SECRET
  && process.env.SESSION_SECRET,
);

app.use(express.json({ limit: "32kb" }));

const sseClients = new Set();
const oauthStates = new Map();
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

const sessionSummary = () => ({
  configured: configured(),
  authenticated: Boolean(twitchSession),
  eventSubStatus,
  user: twitchSession ? {
    id: twitchSession.userId,
    login: twitchSession.login,
    displayName: twitchSession.displayName,
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
    expiresAt: Date.now() + token.expires_in * 1000,
    validatedAt: Date.now(),
  };
  await saveTwitchSession(twitchSession);
  return twitchSession;
};

const validSession = async () => {
  if (!twitchSession) return null;
  if (twitchSession.expiresAt < Date.now() + 60_000) await refreshSession();
  if (Date.now() - (twitchSession.validatedAt || 0) > 60 * 60 * 1000) {
    const validation = await twitchFetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${twitchSession.accessToken}` },
    });
    twitchSession = {
      ...twitchSession,
      userId: validation.user_id,
      login: validation.login,
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

const processChatMessage = async (event) => {
  const message = {
    id: event.message_id,
    userId: event.chatter_user_id,
    name: event.chatter_user_name || event.chatter_user_login,
    message: event.message?.text || "",
    color: event.color || null,
  };
  broadcast({ type: "chat-message", payload: message });

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
  await adjustPoints({
    channelId: twitchSession.userId,
    userId: message.userId,
    displayName: message.name,
    delta: points,
    reason: `Correct guess (#${position})`,
    roundId: currentRound.id,
  });
  broadcast({ type: "correct-guess", payload: { roundId: currentRound.id, solver } });
  broadcast({
    type: "leaderboard",
    payload: await getLeaderboard(twitchSession.userId),
  });
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
  const state = crypto.randomBytes(24).toString("hex");
  const requestedReturnTo = String(request.query.returnTo || "");
  const returnTo = ["/auto-draw", "/draw", "/room"].includes(requestedReturnTo) ? requestedReturnTo : "/draw";
  oauthStates.set(state, { expiresAt: Date.now() + 10 * 60 * 1000, returnTo });
  for (const [key, entry] of oauthStates) {
    if (entry.expiresAt < Date.now()) oauthStates.delete(key);
  }

  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: process.env.TWITCH_CLIENT_ID,
    redirect_uri: twitchRedirectUri,
    scope: twitchScopes.join(" "),
    state,
  });
  response.redirect(url.toString());
});

app.get("/auth/twitch/callback", async (request, response) => {
  try {
    const state = String(request.query.state || "");
    const stateEntry = oauthStates.get(state);
    oauthStates.delete(state);
    if (!request.query.code || !state || !stateEntry || stateEntry.expiresAt < Date.now()) {
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
    twitchSession = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      validatedAt: Date.now(),
      userId: validation.user_id,
      login: validation.login,
      displayName: users.data?.[0]?.display_name || validation.login,
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

app.post("/api/round/start", (request, response) => {
  const answer = String(request.body.answer || "").trim();
  const aliases = Array.isArray(request.body.aliases) ? request.body.aliases : [];
  const target = Math.min(100, Math.max(1, Number(request.body.target) || 10));
  if (!answer) return response.status(400).json({ error: "An answer is required." });
  currentRound = {
    id: crypto.randomUUID(),
    status: "playing",
    answer,
    answers: new Set([answer, ...aliases].map(normalizeGuess).filter(Boolean)),
    target,
    solvers: [],
    solvedUserIds: new Set(),
    startedAt: Date.now(),
  };
  broadcast({ type: "round-started", payload: { roundId: currentRound.id, target } });

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
        color: ["#FF5733", "#33FF57", "#3357FF", "#F033FF", "#33FFF0"][Math.floor(Math.random() * 5)]
      }).catch(console.error);
    }, 400);
  }

  response.json({ roundId: currentRound.id });
});

app.post("/api/round/end", (_request, response) => {
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
  response.json({ viewer, leaderboard });
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
