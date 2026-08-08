const TWITCH_SCOPES = ["user:read:chat"];
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
    this.eventSubSocket = null;
    this.eventSubStatus = "disconnected";
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
  }

  publishSession() {
    this.broadcast({ type: "twitch-session", payload: this.sessionSummary() });
  }

  setEventSubStatus(status) {
    this.eventSubStatus = status;
    this.publishSession();
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
    await twitchFetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
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
    this.setEventSubStatus("connecting");

    const socket = new WebSocket(url);
    this.eventSubSocket = socket;
    socket.addEventListener("message", (event) => {
      this.handleEventSubMessage(event.data, shouldSubscribe).catch((error) => {
        console.error("EventSub message failed", error.message);
      });
    });
    socket.addEventListener("close", () => {
      if (this.eventSubSocket !== socket || !this.twitchSession) return;
      this.setEventSubStatus("reconnecting");
      this.reconnectTimer = setTimeout(() => this.connectEventSub().catch(console.error), 3000);
    });
    socket.addEventListener("error", () => {
      console.error("EventSub socket error");
    });
  }

  async handleEventSubMessage(data, shouldSubscribe) {
    const raw = typeof data === "string" ? data : await new Response(data).text();
    const envelope = JSON.parse(raw);
    const messageType = envelope.metadata?.message_type;
    if (messageType === "session_welcome") {
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
    const returnTo = ["/auto-draw", "/draw"].includes(requestedReturnTo) ? requestedReturnTo : "/draw";
    const forceVerify = url.searchParams.get("forceVerify") === "1" || url.searchParams.get("forceVerify") === "true";
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
      ...(forceVerify ? { force_verify: "true" } : {}),
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
    const id = env.FINDRAW_SESSION.idFromName("main");
    return env.FINDRAW_SESSION.get(id).fetch(request);
  },
};
