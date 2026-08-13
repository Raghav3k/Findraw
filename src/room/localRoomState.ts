import {
  getPromptsForMode,
  matchesCategorySelection,
  type CategoryPrompt,
  type CategorySelection,
} from "../dashboard/gameData";
import type { DrawingOperation } from "../canvas/drawingTypes";

export type RoomPhase = "lobby" | "choosing" | "drawing" | "results" | "finished";

export type RoomPlayer = {
  id: string;
  name: string;
  score: number;
  connectedAt: number;
};

export type RoomGuess = {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  correct: boolean;
  createdAt: number;
};

export type RoomSolved = {
  playerId: string;
  playerName: string;
  points: number;
  solvedAt: number;
};

export type RoomState = {
  code: string;
  hostId: string;
  players: RoomPlayer[];
  phase: RoomPhase;
  categorySelection: CategorySelection;
  roundSeconds: number;
  maxPlayers: number;
  choices: CategoryPrompt[];
  choiceVotes: Record<string, number>;
  answer: CategoryPrompt | null;
  drawerId: string | null;
  turnIndex: number;
  roundIndex: number;
  roundsPerPlayer: number;
  endAt: number | null;
  guesses: RoomGuess[];
  solved: RoomSolved[];
  recentPromptKeys: string[];
  drawingOperations?: DrawingOperation[];
};

export const ROOM_STORAGE_PREFIX = "findraw.room.v1.";

export const createClientId = () => {
  const key = "findraw.room.clientId";
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const id = `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  window.sessionStorage.setItem(key, id);
  return id;
};

export const normalizeRoomCode = (value: string) => (
  value.trim().replace(/\D/g, "").slice(0, 4)
);

export const createRoomCode = () => {
  let code = "";
  for (let index = 0; index < 4; index += 1) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
};

export const roomStorageKey = (code: string) => `${ROOM_STORAGE_PREFIX}${normalizeRoomCode(code)}`;

export const createEmptyRoom = (code: string, host: RoomPlayer): RoomState => ({
  code,
  hostId: host.id,
  players: [host],
  phase: "lobby",
  categorySelection: "all",
  roundSeconds: 90,
  maxPlayers: 8,
  choices: [],
  choiceVotes: {},
  answer: null,
  drawerId: null,
  turnIndex: 0,
  roundIndex: 0,
  roundsPerPlayer: 3,
  endAt: null,
  guesses: [],
  solved: [],
  recentPromptKeys: [],
});

export const readRoom = (code: string): RoomState | null => {
  try {
    const stored = window.localStorage.getItem(roomStorageKey(code));
    return stored ? JSON.parse(stored) as RoomState : null;
  } catch {
    return null;
  }
};

export const writeRoom = (room: RoomState) => {
  window.localStorage.setItem(roomStorageKey(room.code), JSON.stringify(room));
};

export const deleteRoom = (code: string) => {
  window.localStorage.removeItem(roomStorageKey(code));
};

export const roomPromptKey = (prompt: CategoryPrompt) => `${prompt.categoryId}:${prompt.answer.toLowerCase()}`;

export const pickRoomChoices = (selection: CategorySelection, recentKeys: string[], count = 3): CategoryPrompt[] => {
  const recent = new Set(recentKeys.slice(-32));
  const pool = getPromptsForMode("room")
    .filter((prompt) => matchesCategorySelection(prompt.category, selection))
    .map((prompt) => ({
      answer: prompt.answer,
      aliases: prompt.aliases,
      categoryId: prompt.category,
    }))
    .filter((prompt) => !recent.has(roomPromptKey(prompt)));

  const fallback = getPromptsForMode("room")
    .filter((prompt) => matchesCategorySelection(prompt.category, selection))
    .map((prompt) => ({
      answer: prompt.answer,
      aliases: prompt.aliases,
      categoryId: prompt.category,
    }));

  const choices = [...(pool.length ? pool : fallback)];
  for (let index = choices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [choices[index], choices[swapIndex]] = [choices[swapIndex], choices[index]];
  }
  return choices.slice(0, count);
};

export const normalizeGuess = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

export const maskedAnswer = (answer: string | null) => {
  if (!answer) return "_ _ _ _ _";
  return Array.from(answer)
    .map((character) => character === " " ? "  " : "_")
    .join(" ");
};
