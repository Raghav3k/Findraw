import { apiUrl, apiWebSocketUrl } from "../apiUrls";

export type EventSubStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "revoked";

export type TwitchSession = {
  configured: boolean;
  authenticated: boolean;
  eventSubStatus: EventSubStatus;
  user: null | { id: string; login: string; displayName: string };
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

export type LiveEvent =
  | { type: "twitch-session"; payload: TwitchSession }
  | { type: "chat-message"; payload: LiveChatMessage }
  | { type: "correct-guess"; payload: { roundId: string; solver: SolvedViewer } }
  | { type: "leaderboard"; payload: LeaderboardEntry[] }
  | { type: "round-started"; payload: { roundId: string; target: number } }
  | { type: "round-ended"; payload: { roundId: string; reason: string } };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(url), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status})`);
  return body as T;
}

export const twitchEventsUrl = () => apiUrl("/api/events");
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
export const fetchLeaderboard = async () => {
  const result = await request<LeaderboardEntry[]>("/api/leaderboard");
  return Array.isArray(result) ? result : [];
};
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
