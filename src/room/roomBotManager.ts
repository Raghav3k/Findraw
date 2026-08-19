import { useEffect, useRef } from "react";
import type { RoomGuess, RoomPlayer, RoomState } from "./localRoomState";
import { normalizeGuess, roomPromptKey } from "./localRoomState";
import { connectOnlineRoom, type OnlineRoomClient } from "./onlineRoomClient";

export type BotProfile = {
  id: string;
  name: string;
};

export const ROOM_BOT_PROFILES: BotProfile[] = [
  { id: "bot-pixel-1", name: "PixelBot" },
  { id: "bot-doodle-2", name: "DoodleBob" },
  { id: "bot-sketchy-3", name: "SketchyAI" },
  { id: "bot-artie-4", name: "Artie" },
  { id: "bot-quirk-5", name: "QuirkBot" },
];

export const isBotPlayer = (playerId: string) => (
  ROOM_BOT_PROFILES.some((bot) => bot.id === playerId) || playerId.startsWith("bot-")
);

const WRONG_GUESSES = [
  "is it a dog?",
  "looks like a tree",
  "cat?",
  "car?",
  "a circle?",
  "hmm...",
  "house?",
  "sword?",
  "maybe an apple?",
  "hat?",
  "bird?",
  "banana?",
  "a box?",
  "robot?",
  "sun?",
  "star?",
  "pizza?",
  "dragon?",
  "cloud?",
  "fish?",
  "boat?",
  "flower?",
  "guitar?",
  "clock?",
  "sandwich?",
  "pencil?",
  "mountain?",
];

type UseRoomBotsParams = {
  room: RoomState | null;
  isHost: boolean;
  roomTransport: "online" | "local" | "none";
  testBotsEnabled: boolean;
  onSaveLocalRoom: (nextRoom: RoomState) => void;
};

export function useRoomBots({
  room,
  isHost,
  roomTransport,
  testBotsEnabled,
  onSaveLocalRoom,
}: UseRoomBotsParams) {
  const onlineBotsRef = useRef<Map<string, OnlineRoomClient>>(new Map());
  const timersRef = useRef<number[]>([]);
  const roomRef = useRef(room);
  roomRef.current = room;
  const onSaveLocalRoomRef = useRef(onSaveLocalRoom);
  onSaveLocalRoomRef.current = onSaveLocalRoom;
  const activePhaseKeyRef = useRef<string>("");

  const clearBotTimers = () => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
  };

  // 1. Manage Online Bot WebSocket connections
  useEffect(() => {
    if (!testBotsEnabled || !isHost || roomTransport !== "online" || !room?.code) {
      for (const client of onlineBotsRef.current.values()) client.close();
      onlineBotsRef.current.clear();
      return;
    }

    const currentCode = room.code;
    for (const bot of ROOM_BOT_PROFILES) {
      if (onlineBotsRef.current.has(bot.id)) continue;
      const client = connectOnlineRoom(currentCode, bot.id, bot.name, {
        onState: () => undefined,
        onDrawingPreview: () => undefined,
        onStatus: () => undefined,
        onError: () => undefined,
      });
      if (client) onlineBotsRef.current.set(bot.id, client);
    }

    return () => {
      for (const client of onlineBotsRef.current.values()) client.close();
      onlineBotsRef.current.clear();
    };
  }, [isHost, room?.code, roomTransport, testBotsEnabled]);

  // 2. Ensure Local Room has 5 bots in lobby
  useEffect(() => {
    if (!testBotsEnabled || !isHost || roomTransport !== "local" || !room) return;
    if (room.phase !== "lobby") return;

    const existingBotIds = new Set(room.players.map((p) => p.id));
    const missingBots: RoomPlayer[] = ROOM_BOT_PROFILES.filter((b) => !existingBotIds.has(b.id)).map((bot, index) => ({
      id: bot.id,
      name: bot.name,
      score: 0,
      connectedAt: Date.now() + (index + 1) * 50,
    }));

    if (missingBots.length > 0) {
      onSaveLocalRoomRef.current({
        ...room,
        maxPlayers: Math.max(room.maxPlayers ?? 8, room.players.length + missingBots.length),
        players: [...room.players, ...missingBots],
      });
    }
  }, [isHost, room?.phase, roomTransport, testBotsEnabled]);

  // 3. Bot behaviors triggered when phase or turn changes
  const currentPhaseKey = room ? `${room.code}:${room.turnIndex}:${room.phase}:${room.drawerId}` : "";

  useEffect(() => {
    if (!testBotsEnabled || !isHost || !room) {
      clearBotTimers();
      activePhaseKeyRef.current = "";
      return;
    }

    // Only initiate phase behaviors when the phase/turn actually changes
    if (activePhaseKeyRef.current === currentPhaseKey) return;
    activePhaseKeyRef.current = currentPhaseKey;
    clearBotTimers();

    // A. CHOOSING PHASE: Bots vote on mystery slots
    if (room.phase === "choosing" && room.choices.length > 0) {
      const choiceCount = room.choices.length;
      const drawerId = room.drawerId;
      const botPlayers = room.players.filter((p) => isBotPlayer(p.id) && p.id !== drawerId);

      botPlayers.forEach((bot, index) => {
        // Staggered realistic voting delays (e.g. 800ms, 1400ms, 2000ms, 2600ms, 3200ms)
        const delay = 600 + (index * 600) + Math.floor(Math.random() * 500);
        const slot = Math.floor(Math.random() * choiceCount);

        const timer = window.setTimeout(() => {
          const currentRoom = roomRef.current;
          if (!currentRoom || currentRoom.phase !== "choosing") return;

          if (roomTransport === "online") {
            onlineBotsRef.current.get(bot.id)?.sendChoiceVote(slot);
          } else if (roomTransport === "local") {
            // Local mode state update
            const nextVotes = { ...(currentRoom.choiceVotes ?? {}), [bot.id]: slot };
            const eligible = currentRoom.players.filter((p) => p.id !== currentRoom.drawerId);
            const votedCount = Object.keys(nextVotes).filter((pid) => eligible.some((p) => p.id === pid)).length;
            const counts = currentRoom.choices.map((_, idx) => Object.values(nextVotes).filter((v) => v === idx).length);
            const winningIndex = counts.reduce((best, count, idx) => count > counts[best] ? idx : best, 0);
            const winningChoice = currentRoom.choices[winningIndex];

            if (votedCount >= eligible.length && winningChoice) {
              onSaveLocalRoomRef.current({
                ...currentRoom,
                phase: "drawing",
                answer: winningChoice,
                choiceVotes: {},
                guesses: [],
                solved: [],
                endAt: Date.now() + currentRoom.roundSeconds * 1000,
                recentPromptKeys: [...currentRoom.recentPromptKeys, roomPromptKey(winningChoice)].slice(-32),
              });
            } else {
              onSaveLocalRoomRef.current({ ...currentRoom, choiceVotes: nextVotes });
            }
          }
        }, delay);

        timersRef.current.push(timer);
      });
    }

    // B. DRAWING PHASE: Bots chat with wrong guesses and solve after time
    if (room.phase === "drawing" && room.answer?.answer) {
      const rawAnswer = room.answer.answer;
      const drawerId = room.drawerId;
      const botPlayers = room.players.filter((p) => isBotPlayer(p.id) && p.id !== drawerId);

      botPlayers.forEach((bot, botIndex) => {
        // Schedule 1 or 2 wrong guesses per bot during drawing
        const wrongGuessDelay1 = 2500 + (botIndex * 2800) + Math.floor(Math.random() * 3000);
        const wrongTimer1 = window.setTimeout(() => {
          const currentRoom = roomRef.current;
          if (!currentRoom || currentRoom.phase !== "drawing") return;
          const text = WRONG_GUESSES[Math.floor(Math.random() * WRONG_GUESSES.length)];

          if (roomTransport === "online") {
            onlineBotsRef.current.get(bot.id)?.sendGuess(text);
          } else if (roomTransport === "local") {
            const guessEntry: RoomGuess = {
              id: `bot-guess-${Date.now()}-${bot.id}`,
              playerId: bot.id,
              playerName: bot.name,
              text,
              correct: false,
              createdAt: Date.now(),
            };
            onSaveLocalRoomRef.current({
              ...currentRoom,
              guesses: [...currentRoom.guesses.slice(-30), guessEntry],
            });
          }
        }, wrongGuessDelay1);
        timersRef.current.push(wrongTimer1);

        // Chance to solve correctly after 8s - 25s
        const willSolve = Math.random() < 0.70;
        if (willSolve) {
          const solveDelay = 7000 + (botIndex * 4000) + Math.floor(Math.random() * 5000);
          const solveTimer = window.setTimeout(() => {
            const currentRoom = roomRef.current;
            if (!currentRoom || currentRoom.phase !== "drawing") return;

            if (roomTransport === "online") {
              onlineBotsRef.current.get(bot.id)?.sendGuess(rawAnswer);
            } else if (roomTransport === "local") {
              const alreadySolved = currentRoom.solved.some((s) => s.playerId === bot.id);
              if (alreadySolved) return;
              const remainingRatio = currentRoom.endAt ? Math.max(0, currentRoom.endAt - Date.now()) / (currentRoom.roundSeconds * 1000) : 0;
              const points = Math.round(100 + remainingRatio * 300);
              const guessEntry: RoomGuess = {
                id: `bot-guess-win-${Date.now()}-${bot.id}`,
                playerId: bot.id,
                playerName: bot.name,
                text: rawAnswer,
                correct: true,
                createdAt: Date.now(),
              };
              const drawerBonus = 50;
              const nextSolved = [...currentRoom.solved, { playerId: bot.id, playerName: bot.name, points, solvedAt: Date.now() }];
              const guessers = currentRoom.players.filter((p) => p.id !== currentRoom.drawerId);
              const allSolved = nextSolved.length >= guessers.length;

              onSaveLocalRoomRef.current({
                ...currentRoom,
                phase: allSolved ? "results" : currentRoom.phase,
                endAt: allSolved ? null : currentRoom.endAt,
                guesses: [...currentRoom.guesses.slice(-30), guessEntry],
                solved: nextSolved,
                players: currentRoom.players.map((p) => {
                  if (p.id === bot.id) return { ...p, score: p.score + points };
                  if (p.id === currentRoom.drawerId) return { ...p, score: p.score + drawerBonus };
                  return p;
                }),
              });
            }
          }, solveDelay);
          timersRef.current.push(solveTimer);
        }
      });
    }

    return () => {
      // Intentionally keep timers across re-renders within the same phase; phase change clears them above
    };
  }, [currentPhaseKey, isHost, roomTransport, testBotsEnabled]);

  return {
    botProfiles: ROOM_BOT_PROFILES,
  };
}
