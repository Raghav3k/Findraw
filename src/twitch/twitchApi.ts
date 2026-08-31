import { apiUrl, apiWebSocketUrl, backendSessionKey } from "../apiUrls";
import { secureFetch } from "../security/browserSecurity";

export type EventSubStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "revoked";

export type TwitchSession = {
  configured: boolean;
  authenticated: boolean;
  eventSubStatus: EventSubStatus;
  canSendChat: boolean;
  chatCommandsEnabled: boolean;
  user: null | { id: string; login: string; displayName: string; profileImageUrl: string | null };
};

export type LiveChatMessage = {
  id: string;
  userId: string;
  name: string;
  message: string;
  color?: string | null;
};

export type SolvedViewer = { userId: string; name: string; points: number; position: number };
export type LeaderboardEntry = { userId: string; displayName: string; score: number };
export type ArtistSessionReward = { position: number; reward: string; fulfilled: boolean };
export type ArtistSession = {
  id: string;
  name: string;
  status: "active" | "completed";
  startedAt: string;
  endedAt: string | null;
  rewards: ArtistSessionReward[];
  standings: LeaderboardEntry[];
};
export type WeeklyPointsSeason = {
  weekId: string;
  status: "active" | "completed";
  startsAt: string;
  endsAt: string;
  rewards: ArtistSessionReward[];
  standings: LeaderboardEntry[];
};
export type WeeklyPointsSummary = {
  current: WeeklyPointsSeason | null;
  history: WeeklyPointsSeason[];
};

export type LiveEvent =
  | { type: "twitch-session"; payload: TwitchSession }
  | { type: "chat-message"; payload: LiveChatMessage }
  | { type: "correct-guess"; payload: { roundId: string; solver: SolvedViewer } }
  | { type: "leaderboard"; payload: LeaderboardEntry[] }
  | { type: "weekly-points"; payload: WeeklyPointsSummary }
  | { type: "artist-session"; payload: ArtistSession | null }
  | { type: "round-started"; payload: { roundId: string; target: number; controllerId?: string } }
  | { type: "round-ended"; payload: { roundId: string; reason: string } };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await secureFetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || body.message || `Request failed (${response.status})`), { code: body.code, status: response.status });
  return body as T;
}

export const twitchEventsUrl = () => {
  const url = new URL(apiUrl("/api/events"), window.location.origin);
  return url.toString();
};
const liveObservers = new Set<(event: LiveEvent) => void>();
const liveSubscribers = new Set<{ event: (event: LiveEvent) => void; disconnect?: () => void }>();
let stopLiveTransport: (() => void) | null = null;

// Observing identity updates must not itself open a permanent connection.
export function observeLiveEvents(observer: (event: LiveEvent) => void) {
  liveObservers.add(observer);
  return () => { liveObservers.delete(observer); };
}

export function connectLiveEvents(onEvent: (event: LiveEvent) => void, onDisconnect?: () => void): () => void {
  const subscriber = { event: onEvent, disconnect: onDisconnect };
  liveSubscribers.add(subscriber);
  if (!stopLiveTransport) stopLiveTransport = openLiveTransport((event) => {
    for (const observer of liveObservers) observer(event);
    for (const listener of liveSubscribers) listener.event(event);
  }, () => {
    for (const listener of liveSubscribers) listener.disconnect?.();
  });
  return () => {
    liveSubscribers.delete(subscriber);
    if (!liveSubscribers.size) {
      stopLiveTransport?.();
      stopLiveTransport = null;
    }
  };
}

function openLiveTransport(
  onEvent: (event: LiveEvent) => void,
  onDisconnect?: () => void
): () => void {
  const webSocketUrl = apiWebSocketUrl("/api/live");
  if (!webSocketUrl) {
    const events = new EventSource(twitchEventsUrl());
    events.onmessage = (message) => onEvent(JSON.parse(message.data) as LiveEvent);
    events.onerror = () => onDisconnect?.();
    return () => events.close();
  }

  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let attempts = 0;

  const connect = () => {
    socket = new WebSocket(webSocketUrl);
    socket.onmessage = (message) => { attempts = 0; onEvent(JSON.parse(String(message.data)) as LiveEvent); };
    socket.onerror = () => socket?.close();
    socket.onclose = (event) => {
      if (stopped) return;
      onDisconnect?.();
      if (event?.code === 1008) return;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5));
      reconnectTimer = window.setTimeout(connect, delay + Math.random() * 500);
    };
  };

  connect();
  return () => {
    stopped = true;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    socket?.close();
  };
}
export const fetchTwitchSession = () => request<TwitchSession>("/api/twitch/session");
export const reconnectTwitchChat = () => request<TwitchSession>("/api/twitch/reconnect", { method: "POST" });
export const setTwitchChatCommands = (enabled: boolean) => request<TwitchSession>("/api/twitch/chat-commands", {
  method: "POST",
  body: JSON.stringify({ enabled }),
});
export const fetchLeaderboard = async () => {
  const result = await request<LeaderboardEntry[]>("/api/leaderboard");
  return Array.isArray(result) ? result : [];
};
export const fetchWeeklyPoints = () => request<WeeklyPointsSummary>("/api/weekly-points");
export const setWeeklyPointsRewards = (weekId: string, rewards: Array<Pick<ArtistSessionReward, "position" | "reward">>) => request<{ season: WeeklyPointsSeason; summary: WeeklyPointsSummary }>("/api/weekly-points/rewards", {
  method: "POST",
  body: JSON.stringify({ weekId, rewards }),
});
export const setWeeklyPointsRewardFulfilled = (weekId: string, position: number, fulfilled: boolean) => request<{ season: WeeklyPointsSeason; summary: WeeklyPointsSummary }>("/api/weekly-points/reward", {
  method: "POST",
  body: JSON.stringify({ weekId, position, fulfilled }),
});
export const fetchArtistSessions = () => request<{ active: ArtistSession | null; history: ArtistSession[] }>("/api/artist-session");
export const startArtistSession = (name: string, rewards: Array<Pick<ArtistSessionReward, "position" | "reward">>) => request<{ session: ArtistSession }>("/api/artist-session/start", {
  method: "POST",
  body: JSON.stringify({ name, rewards }),
});
export const endArtistSession = () => request<{ session: ArtistSession }>("/api/artist-session/end", { method: "POST" });
export const setArtistSessionReward = (sessionId: string, position: number, fulfilled: boolean) => request<{ session: ArtistSession }>("/api/artist-session/reward", {
  method: "POST",
  body: JSON.stringify({ sessionId, position, fulfilled }),
});
export const disconnectTwitch = async () => {
  const result = await request<{ ok: boolean; revoked?: boolean; warning?: string }>("/api/twitch/disconnect", { method: "POST" });
  if (result.revoked === false) throw new Error(result.warning || "Signed out, but Twitch revocation failed. Remove Findraw in Twitch Connections.");
  return result;
};
// A page instance is a separate scoring controller, even when browser auth is shared.
export const roundControllerId = crypto.randomUUID();
export const startServerRound = async (answer: string, target: number, aliases: string[] = [], testBots: boolean = false) => {
  const start = (takeover = false) => request<{ roundId: string }>("/api/round/start", {
    method: "POST", body: JSON.stringify({ answer, target, aliases, testBots, controllerId: roundControllerId, takeover }),
  });
  try { return await start(); }
  catch (error) {
    if ((error as { code?: string }).code === "ROUND_OWNED" && window.confirm("Another browser or game is scoring for this Twitch channel. End its round and take over here? Existing points and rewards will be kept.")) return start(true);
    throw error;
  }
};
export const endServerRound = () => request<{ ok: boolean }>("/api/round/end", {
  method: "POST", body: JSON.stringify({ controllerId: roundControllerId }),
});
export const fetchChannelStatus = () => request<{ authenticated: boolean; shared?: boolean; migrationConflicts?: number; activeElsewhere?: boolean }>("/api/channel/status");
export const downloadChannelBackups = async () => {
  const data = await request<unknown>("/api/channel/legacy-backups");
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "findraw-channel-legacy-backups.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const adjustViewerPoints = (viewer: Pick<SolvedViewer, "userId" | "name">, delta: number) => request<{ leaderboard: LeaderboardEntry[]; weeklyPoints: WeeklyPointsSummary }>("/api/points/adjust", {
  method: "POST",
  body: JSON.stringify({ userId: viewer.userId, displayName: viewer.name, delta, reason: "Streamer bonus", requestId: crypto.randomUUID() }),
});
