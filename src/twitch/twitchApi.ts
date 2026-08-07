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
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status})`);
  return body as T;
}

export const fetchTwitchSession = () => request<TwitchSession>("/api/twitch/session");
export const fetchLeaderboard = () => request<LeaderboardEntry[]>("/api/leaderboard");
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
