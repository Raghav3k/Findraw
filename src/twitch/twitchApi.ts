import { apiUrl, apiWebSocketUrl, backendSessionKey } from "../apiUrls";

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

export type LiveEvent =
  | { type: "twitch-session"; payload: TwitchSession }
  | { type: "chat-message"; payload: LiveChatMessage }
  | { type: "correct-guess"; payload: { roundId: string; solver: SolvedViewer } }
  | { type: "leaderboard"; payload: LeaderboardEntry[] }
  | { type: "artist-session"; payload: ArtistSession | null }
  | { type: "round-started"; payload: { roundId: string; target: number } }
  | { type: "round-ended"; payload: { roundId: string; reason: string } };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(url), {
    ...init,
    headers: { "Content-Type": "application/json", "X-Findraw-Session": backendSessionKey, ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status})`);
  return body as T;
}

export const twitchEventsUrl = () => {
  const url = new URL(apiUrl("/api/events"), window.location.origin);
  url.searchParams.set("client", backendSessionKey);
  return url.toString();
};
export function connectLiveEvents(
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

  const connect = () => {
    socket = new WebSocket(webSocketUrl);
    socket.onmessage = (message) => onEvent(JSON.parse(String(message.data)) as LiveEvent);
    socket.onerror = () => socket?.close();
    socket.onclose = () => {
      if (stopped) return;
      onDisconnect?.();
      reconnectTimer = window.setTimeout(connect, 2000);
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
export const disconnectTwitch = () => request<{ ok: boolean }>("/api/twitch/disconnect", { method: "POST" });
export const startServerRound = (answer: string, target: number, aliases: string[] = [], testBots: boolean = false) => request<{ roundId: string }>("/api/round/start", {
  method: "POST",
  body: JSON.stringify({ answer, target, aliases, testBots }),
});
export const endServerRound = () => request<{ ok: boolean }>("/api/round/end", { method: "POST" });
export const adjustViewerPoints = (viewer: Pick<SolvedViewer, "userId" | "name">, delta: number) => request<{ leaderboard: LeaderboardEntry[] }>("/api/points/adjust", {
  method: "POST",
  body: JSON.stringify({ userId: viewer.userId, displayName: viewer.name, delta, reason: "Streamer bonus" }),
});
