import { useEffect, useRef } from "react";
import { roomPromptKey, type RoomGuess, type RoomPlayer, type RoomState } from "./localRoomState";

const BOT_NAMES = ["PixelBot", "DoodleBob", "SketchyAI", "Artie", "QuirkBot", "Inkling", "Scribble", "Mochi"];
const WRONG_GUESSES = ["a cloud?", "maybe a chair", "banana?", "looks like a fish", "robot?", "a tiny house?", "is it a hat?", "hmm...", "a sword?", "pizza?"];

export const isRoomTestBot = (playerId: string) => playerId.startsWith("test-bot-");

export function createRoomTestBots(count = 5): RoomPlayer[] {
  return BOT_NAMES
    .map((name) => ({ name, order: crypto.getRandomValues(new Uint32Array(1))[0] }))
    .sort((first, second) => first.order - second.order)
    .slice(0, count)
    .map(({ name }, index) => ({ id: `test-bot-${index + 1}-${name.toLowerCase()}`, name, score: 0, connectedAt: Date.now() + index + 1 }));
}

export function useLocalRoomTestBots(room: RoomState | null, onSave: (room: RoomState) => void) {
  const roomRef = useRef(room);
  const saveRef = useRef(onSave);
  roomRef.current = room;
  saveRef.current = onSave;
  const phaseKey = room?.testBots ? `${room.code}:${room.turnIndex}:${room.phase}:${room.drawerId}` : "";

  useEffect(() => {
    if (!room?.testBots || !phaseKey) return;
    const timers: number[] = [];
    const schedule = (action: () => void, delay: number) => timers.push(window.setTimeout(action, delay));

    if (room.phase === "choosing" && room.choices.length) {
      const bots = room.players.filter((player) => isRoomTestBot(player.id) && player.id !== room.drawerId);
      bots.forEach((bot, index) => schedule(() => {
        const current = roomRef.current;
        if (!current || current.phase !== "choosing" || current.choiceVotes[bot.id] !== undefined) return;
        const choiceIndex = Math.floor(Math.random() * current.choices.length);
        const votes = { ...current.choiceVotes, [bot.id]: choiceIndex };
        const eligible = current.players.filter((player) => player.id !== current.drawerId);
        const allVoted = eligible.every((player) => votes[player.id] !== undefined);
        if (!allVoted) return saveRef.current({ ...current, choiceVotes: votes });
        const counts = current.choices.map((_, choice) => Object.values(votes).filter((vote) => vote === choice).length);
        const winner = counts.reduce((best, value, choice) => value > counts[best] ? choice : best, 0);
        const answer = current.choices[winner];
        saveRef.current({
          ...current,
          phase: "drawing",
          answer,
          choiceVotes: {},
          guesses: [],
          solved: [],
          endAt: Date.now() + current.roundSeconds * 1000,
          recentPromptKeys: [...current.recentPromptKeys, roomPromptKey(answer)].slice(-32),
        });
      }, 450 + index * 420 + Math.floor(Math.random() * 250)));
    }

    if (room.phase === "drawing" && room.answer?.answer) {
      const bots = room.players.filter((player) => isRoomTestBot(player.id) && player.id !== room.drawerId);
      const solvers = [...bots].sort(() => Math.random() - .5).slice(0, Math.min(bots.length, 1 + Math.floor(Math.random() * 2)));
      bots.forEach((bot, index) => schedule(() => {
        const current = roomRef.current;
        if (!current || current.phase !== "drawing" || current.solved.some((entry) => entry.playerId === bot.id)) return;
        const guess: RoomGuess = { id: crypto.randomUUID(), playerId: bot.id, playerName: bot.name, text: WRONG_GUESSES[Math.floor(Math.random() * WRONG_GUESSES.length)], correct: false, createdAt: Date.now() };
        saveRef.current({ ...current, guesses: [...current.guesses.slice(-30), guess] });
      }, 1800 + index * 650 + Math.floor(Math.random() * 500)));
      solvers.forEach((bot, index) => schedule(() => {
        const current = roomRef.current;
        if (!current || current.phase !== "drawing" || current.solved.some((entry) => entry.playerId === bot.id)) return;
        const remainingRatio = current.endAt ? Math.max(0, current.endAt - Date.now()) / (current.roundSeconds * 1000) : 0;
        const points = Math.round(100 + remainingRatio * 300);
        const guess: RoomGuess = { id: crypto.randomUUID(), playerId: bot.id, playerName: bot.name, text: current.answer?.answer || "", correct: true, createdAt: Date.now() };
        saveRef.current({
          ...current,
          guesses: [...current.guesses.slice(-30), guess],
          solved: [...current.solved, { playerId: bot.id, playerName: bot.name, points, solvedAt: Date.now() }],
          players: current.players.map((player) => player.id === bot.id ? { ...player, score: player.score + points } : player.id === current.drawerId ? { ...player, score: player.score + 50 } : player),
        });
      }, 5000 + index * 2300 + Math.floor(Math.random() * 1000)));
    }

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phaseKey]);
}
