import type { CategoryPrompt } from "../dashboard/gameData";
import {
  DEFAULT_ARTIST_WORD_MIX,
  normalizeArtistWordMix,
  pickWordMixPrompts,
  type ArtistWordMix,
} from "../dashboard/artistWordPacks";
import type { CommunityPack } from "../community/communityPacksApi";
import type { WordFeedbackMap } from "../feedback/wordFeedback";
import type { DrawingOperation } from "../canvas/drawingTypes";
import type { SolvedViewer } from "../twitch/twitchApi";

export type RoomPhase = "lobby" | "choosing" | "drawing" | "results" | "finished";

export type RoomPlayer = {
  id: string;
  name: string;
  score: number;
  connectedAt: number;
  disconnectedAt?: number | null;
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

export type RoomAnswer = CategoryPrompt & {
  mask?: string;
};

export type RoomState = {
  code: string;
  visibility?: "private" | "public";
  testBots?: boolean;
  hostId: string;
  players: RoomPlayer[];
  phase: RoomPhase;
  wordMix: ArtistWordMix;
  wordMixReady?: boolean;
  wordMixPacks?: Array<{ id: string; label: string; kind: string; wordCount: number }>;
  twitchOwnerName?: string;
  twitchOwnerConnected?: boolean;
  twitchScoringConflict?: boolean;
  twitchSolvers?: SolvedViewer[];
  roundSeconds: number;
  maxPlayers: number;
  choices: CategoryPrompt[];
  choiceVotes: Record<string, number>;
  answer: RoomAnswer | null;
  drawerId: string | null;
  turnIndex: number;
  roundIndex: number;
  roundsPerPlayer: number;
  endAt: number | null;
  guesses: RoomGuess[];
  solved: RoomSolved[];
  recentPromptKeys: string[];
  recentChoiceKeys: string[];
  drawingOperations?: DrawingOperation[];
  drawingEpoch?: string;
  drawingRevision?: number;
};

export const ROOM_STORAGE_PREFIX = "findraw.room.v1.";
export const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_NUMBERS = "23456789";
const ROOM_CODE_CHARACTERS = `${ROOM_CODE_LETTERS}${ROOM_CODE_NUMBERS}`;

export const createClientId = () => {
  const key = "findraw.room.clientId.v2";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const id = typeof window.crypto?.randomUUID === "function" ? `player-${window.crypto.randomUUID()}` : `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  window.localStorage.setItem(key, id);
  return id;
};

export const createRoomReconnectToken = () => {
  const key = "findraw.room.reconnectToken.v1";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const token = typeof window.crypto?.randomUUID === "function"
    ? `${window.crypto.randomUUID()}-${window.crypto.randomUUID()}`
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, token);
  return token;
};

export const normalizeRoomCode = (value: string) => (
  value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, ROOM_CODE_LENGTH)
);

export const createRoomCode = () => {
  const randomCharacter = (characters: string) => {
    const value = new Uint32Array(1);
    window.crypto.getRandomValues(value);
    return characters[value[0] % characters.length];
  };
  const characters = [
    randomCharacter(ROOM_CODE_LETTERS),
    randomCharacter(ROOM_CODE_NUMBERS),
    ...Array.from({ length: ROOM_CODE_LENGTH - 2 }, () => randomCharacter(ROOM_CODE_CHARACTERS)),
  ];
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const value = new Uint32Array(1);
    window.crypto.getRandomValues(value);
    const swapIndex = value[0] % (index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
};

export const roomStorageKey = (code: string) => `${ROOM_STORAGE_PREFIX}${normalizeRoomCode(code)}`;

export const createEmptyRoom = (code: string, host: RoomPlayer, initialBots: RoomPlayer[] = []): RoomState => ({
  code,
  hostId: host.id,
  players: [host, ...initialBots],
  phase: "lobby",
  wordMix: DEFAULT_ARTIST_WORD_MIX,
  wordMixReady: true,
  roundSeconds: 90,
  maxPlayers: Math.max(8, 1 + initialBots.length),
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
  recentChoiceKeys: [],
});

export const readRoom = (code: string): RoomState | null => {
  try {
    const stored = window.localStorage.getItem(roomStorageKey(code));
    return stored ? normalizeRoomState(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
};

export const writeRoom = (room: RoomState) => {
  window.localStorage.setItem(roomStorageKey(room.code), JSON.stringify(normalizeRoomState(room)));
};

export const deleteRoom = (code: string) => {
  window.localStorage.removeItem(roomStorageKey(code));
};

export const roomPromptKey = (prompt: CategoryPrompt) => `${prompt.categoryId}:${prompt.answer.toLowerCase()}`;

export const pickRoomChoices = (mix: ArtistWordMix, recentKeys: string[], count = 3, communityPacks: CommunityPack[] = [], feedback?: WordFeedbackMap): CategoryPrompt[] => {
  const choices = pickWordMixPrompts(normalizeArtistWordMix(mix, communityPacks), recentKeys, count, communityPacks, feedback);
  for (let index = choices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [choices[index], choices[swapIndex]] = [choices[swapIndex], choices[index]];
  }
  return choices;
};

export const normalizeGuess = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

export const maskedAnswer = (answer: string | null) => {
  if (!answer) return "_ _ _ _ _";
  return Array.from(answer)
    .map((character) => character === " " ? "  " : "_")
    .join(" ");
};

export const normalizeRoomState = (room: Partial<RoomState> | null): RoomState | null => {
  if (!room?.code || !room.hostId) return null;
  return {
    code: room.code,
    visibility: room.visibility,
    testBots: Boolean(room.testBots),
    hostId: room.hostId,
    players: Array.isArray(room.players) ? room.players : [],
    phase: room.phase ?? "lobby",
    wordMix: normalizeArtistWordMix(room.wordMix ?? DEFAULT_ARTIST_WORD_MIX),
    wordMixReady: room.wordMixReady ?? true,
    wordMixPacks: Array.isArray(room.wordMixPacks) ? room.wordMixPacks : undefined,
    roundSeconds: room.roundSeconds ?? 90,
    maxPlayers: room.maxPlayers ?? 8,
    choices: Array.isArray(room.choices) ? room.choices : [],
    choiceVotes: room.choiceVotes ?? {},
    answer: room.answer ?? null,
    drawerId: room.drawerId ?? null,
    turnIndex: room.turnIndex ?? 0,
    roundIndex: room.roundIndex ?? 0,
    roundsPerPlayer: room.roundsPerPlayer ?? 3,
    endAt: room.endAt ?? null,
    guesses: Array.isArray(room.guesses) ? room.guesses : [],
    solved: Array.isArray(room.solved) ? room.solved : [],
    recentPromptKeys: Array.isArray(room.recentPromptKeys) ? room.recentPromptKeys : [],
    recentChoiceKeys: Array.isArray(room.recentChoiceKeys) ? room.recentChoiceKeys : [],
    drawingOperations: Array.isArray(room.drawingOperations) ? room.drawingOperations : [],
  };
};
