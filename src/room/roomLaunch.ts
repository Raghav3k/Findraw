import type { ArtistWordMix } from "../dashboard/artistWordPacks";

export type RoomLaunchIntent = {
  kind: "private-create" | "private-join" | "public" | "public-bots";
  code?: string;
  maxPlayers?: number;
  roundSeconds?: number;
  roundsPerPlayer?: number;
  wordMix?: ArtistWordMix;
  createdAt: number;
};

const ROOM_LAUNCH_KEY = "findraw.room.launch.v1";

export function writeRoomLaunch(intent: Omit<RoomLaunchIntent, "createdAt">) {
  window.sessionStorage.setItem(ROOM_LAUNCH_KEY, JSON.stringify({ ...intent, createdAt: Date.now() }));
}

export function readRoomLaunch(): RoomLaunchIntent | null {
  const stored = window.sessionStorage.getItem(ROOM_LAUNCH_KEY);
  if (!stored) return null;
  try {
    const intent = JSON.parse(stored) as RoomLaunchIntent;
    if (!intent?.kind || Date.now() - Number(intent.createdAt || 0) > 10 * 60 * 1000) return null;
    return intent;
  } catch {
    return null;
  }
}

export function clearRoomLaunch() {
  window.sessionStorage.removeItem(ROOM_LAUNCH_KEY);
}
