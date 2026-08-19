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
  const lastTurnKeyRef = useRef<string | null>(null);

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
      onSaveLocalRoom({
        ...room,
        maxPlayers: Math.max(room.maxPlayers ?? 8, room.players.length + missingBots.length),
        players: [...room.players, ...missingBots],
      });
    }
  }, [isHost, onSaveLocalRoom, room, roomTransport, testBotsEnabled]);

  // 3. Bot behaviors during Choosing and Drawing phases
  useEffect(() => {
    if (!testBotsEnabled || !isHost || !room) {
      clearBotTimers();
      return;
    }

    const turnKey = `${room.code}:${room.turnIndex}:${room.phase}:${room.drawerId}`;
    if (lastTurnKeyRef.current !== turnKey) {
      clearBotTimers();
      lastTurnKeyRef.current = turnKey;
    }

    // A. CHOOSING PHASE: Bots vote on slots
    if (room.phase === "choosing" && room.choices.length > 0) {
      const choiceCount = room.choices.length;
      const drawerId = room.drawerId;
      const botPlayers = room.players.filter((p) => isBotPlayer(p.id) && p.id !== drawerId);

      for (const bot of botPlayers) {
        if (room.choiceVotes?.[bot.id] !== undefined) continue;

        const delay = 700 + Math.floor(Math.random() * 2200) + (ROOM_BOT_PROFILES.findIndex((b) => b.id === bot.id) * 300);
        const slot = Math.floor(Math.random() * choiceCount);

        const timer = window.setTimeout(() => {
          if (roomTransport === "online") {
            onlineBotsRef.current.get(bot.id)?.sendChoiceVote(slot);
          } else if (roomTransport === "local") {
            // Local mode vote calculation
            const currentVotes = { ...(room.choiceVotes ?? {}), [bot.id]: slot };
            const eligible = room.players.filter((p) => p.id !== room.drawerId);
            const votedCount = Object.keys(currentVotes).filter((pid) => eligible.some((p) => p.id === pid)).length;
            const counts = room.choices.map((_, idx) => Object.values(currentVotes).filter((v) => v === idx).length);
            const winningIndex = counts.reduce((best, count, idx) => count > counts[best] ? idx : best, 0);
            const winningChoice = room.choices[winningIndex];

            if (votedCount >= eligible.length && winningChoice) {
              onSaveLocalRoom({
                ...room,
                phase: "drawing",
                answer: winningChoice,
                choiceVotes: {},
                guesses: [],
                solved: [],
                endAt: Date.now() + room.roundSeconds * 1000,
                recentPromptKeys: [...room.recentPromptKeys, roomPromptKey(winningChoice)].slice(-32),
              });
            } else {
              onSaveLocalRoom({ ...room, choiceVotes: currentVotes });
            }
          }
        }, delay);

        timersRef.current.push(timer);
      }
    }

    // B. DRAWING PHASE: Bots guess in chat
    if (room.phase === "drawing" && room.answer?.answer) {
      const rawAnswer = room.answer.answer;
      const drawerId = room.drawerId;
      const botPlayers = room.players.filter((p) => isBotPlayer(p.id) && p.id !== drawerId);

      // Schedule periodic random wrong guesses
      botPlayers.forEach((bot, botIndex) => {
        // Random wrong guesses during the round
        const wrongGuessDelay = 3000 + (botIndex * 3500) + Math.floor(Math.random() * 4000);
        const wrongTimer = window.setTimeout(() => {
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
            onSaveLocalRoom({
              ...room,
              guesses: [...room.guesses.slice(-30), guessEntry],
            });
          }
        }, wrongGuessDelay);
        timersRef.current.push(wrongTimer);

        // Chance to solve correctly after some seconds
        const willSolve = Math.random() < 0.65;
        if (willSolve) {
          const solveDelay = 8000 + (botIndex * 4000) + Math.floor(Math.random() * 6000);
          const solveTimer = window.setTimeout(() => {
            if (roomTransport === "online") {
              onlineBotsRef.current.get(bot.id)?.sendGuess(rawAnswer);
            } else if (roomTransport === "local") {
              const alreadySolved = room.solved.some((s) => s.playerId === bot.id);
              if (alreadySolved) return;
              const remainingRatio = room.endAt ? Math.max(0, room.endAt - Date.now()) / (room.roundSeconds * 1000) : 0;
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
              onSaveLocalRoom({
                ...room,
                guesses: [...room.guesses.slice(-30), guessEntry],
                solved: [...room.solved, { playerId: bot.id, playerName: bot.name, points, solvedAt: Date.now() }],
                players: room.players.map((p) => {
                  if (p.id === bot.id) return { ...p, score: p.score + points };
                  if (p.id === room.drawerId) return { ...p, score: p.score + drawerBonus };
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
      clearBotTimers();
    };
  }, [isHost, onSaveLocalRoom, room, roomTransport, testBotsEnabled]);

  return {
    botProfiles: ROOM_BOT_PROFILES,
  };
}
