import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ExcalidrawStage } from "../canvas/ExcalidrawStage";
import type { DrawingOperation } from "../canvas/drawingTypes";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../dashboard/keyboardShortcuts";
import {
  getActiveSelectionChips,
  getCategoryDomains,
  getSelectionTokens,
  isCategorySelectionOptionActive,
  removeCategorySelectionChip,
  toggleCategorySelectionOption,
  type CategoryPrompt,
  type CategorySelection,
} from "../dashboard/gameData";
import { CategorySelectionTools } from "../dashboard/CategorySelectionTools";
import { CategoryPickerWindow } from "../ui/CategoryPickerWindow";
import { WorkspaceIdentity } from "../ui/WorkspaceIdentity";
import { usePersistentState } from "../ui/usePersistentState";
import { WordFeedbackModal } from "../feedback/WordFeedbackModal";
import {
  recordWordFeedback,
  shouldPromptForWordFeedback,
  type WordFeedbackMap,
  type WordFeedbackRating,
  type WordFeedbackTarget,
} from "../feedback/wordFeedback";
import { hasApiBaseUrl } from "../apiUrls";
import {
  createClientId,
  createEmptyRoom,
  createRoomCode,
  deleteRoom,
  maskedAnswer,
  normalizeGuess,
  normalizeRoomCode,
  pickRoomChoices,
  readRoom,
  roomPromptKey,
  roomStorageKey,
  writeRoom,
  type RoomGuess,
  type RoomPlayer,
  type RoomState,
} from "./localRoomState";
import { connectOnlineRoom, type OnlineRoomClient } from "./onlineRoomClient";

type RoomModePageProps = {
  onNavigate: (path: string) => void;
};

type ResizeState = {
  panel: "source" | "side";
  startX: number;
  startWidth: number;
};

const DEFAULT_ROOM_CODE = "";
type RoomEntryMode = "create" | "join";

const createPlayer = (id: string, name: string): RoomPlayer => ({
  id,
  name: name.trim().slice(0, 20) || "Player",
  score: 0,
  connectedAt: Date.now(),
});

const getDrawer = (room: RoomState | null) => room?.players.find((player) => player.id === room.drawerId) ?? null;

const getNextTurn = (room: RoomState) => {
  const playerCount = Math.max(1, room.players.length);
  const totalTurns = playerCount * room.roundsPerPlayer;
  const nextTurnIndex = room.turnIndex + 1;
  if (nextTurnIndex >= totalTurns) return null;
  return {
    turnIndex: nextTurnIndex,
    roundIndex: Math.floor(nextTurnIndex / playerCount),
    drawerId: room.players[nextTurnIndex % playerCount]?.id ?? room.players[0]?.id ?? null,
  };
};

export function RoomModePage({ onNavigate }: RoomModePageProps) {
  const [clientId] = useState(createClientId);
  const [sourceRailWidth, setSourceRailWidth] = usePersistentState("room.layout.leftRailWidth", 320);
  const [sidePanelWidth, setSidePanelWidth] = usePersistentState("room.layout.rightRailWidth", 300);
  const [playerName, setPlayerName] = usePersistentState("room.playerName", "Streamer");
  const [roomCodeInput, setRoomCodeInput] = useState(DEFAULT_ROOM_CODE);
  const [joinedCode, setJoinedCode] = useState("");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [roomTransport, setRoomTransport] = useState<"none" | "online" | "local">("none");
  const [roomConnectionStatus, setRoomConnectionStatus] = useState<"connecting" | "connected" | "offline">("offline");
  const [showRoomDetails, setShowRoomDetails] = useState(false);
  const [roomCodeRevealed, setRoomCodeRevealed] = useState(false);
  const [leaderPickerOpen, setLeaderPickerOpen] = useState(false);
  const [guess, setGuess] = useState("");
  const [liveDrawingOperation, setLiveDrawingOperation] = useState<DrawingOperation | null>(null);
  const [notice, setNotice] = useState("");
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [skipRoomExitConfirm, setSkipRoomExitConfirm] = usePersistentState("room.exit.skipConfirm", false);
  const [canvasColor, setCanvasColor] = usePersistentState("room.canvas.background", "#FFF2CF");
  const [gridSize, setGridSize] = usePersistentState("room.grid.size", 24);
  const [wordFeedback, setWordFeedback] = usePersistentState<WordFeedbackMap>("feedback.room.words", {});
  const [feedbackTarget, setFeedbackTarget] = useState<WordFeedbackTarget | null>(null);
  const feedbackRoundsSinceAutoRef = useRef(5);
  const lastAutoFeedbackTurnRef = useRef<string | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const onlineRoomRef = useRef<OnlineRoomClient | null>(null);

  const localPlayer = room?.players.find((player) => player.id === clientId) ?? null;
  const drawer = getDrawer(room);
  const isHost = room?.hostId === clientId;
  const isDrawer = room?.drawerId === clientId;
  const sortedPlayers = useMemo(() => (
    (room?.players ?? []).slice().sort((first, second) => second.score - first.score)
  ), [room?.players]);
  const activeSelectionChips = useMemo(() => getActiveSelectionChips(room?.categorySelection ?? "all", "room"), [room?.categorySelection]);
  const selectedTokens = getSelectionTokens(room?.categorySelection ?? "all");
  const secondsRemaining = room?.phase === "drawing" && room.endAt
    ? Math.max(0, Math.ceil((room.endAt - timerNow) / 1000))
    : room?.roundSeconds ?? 90;
  const totalTurns = room ? Math.max(1, room.players.length) * room.roundsPerPlayer : 0;
  const currentTurnNumber = room && room.turnIndex >= 0 ? Math.min(totalTurns, room.turnIndex + 1) : 0;
  const winner = room?.phase === "finished" ? sortedPlayers[0] ?? null : null;
  const roomMaxPlayers = room?.maxPlayers ?? 8;
  const roomLeader = room?.players.find((player) => player.id === room.hostId) ?? null;
  const canEditRoomDetails = Boolean(room && isHost && (room.phase === "lobby" || room.phase === "finished"));
  const roomChoiceVotes = room?.choiceVotes ?? {};
  const eligibleChoiceVoters = room ? room.players.filter((player) => player.id !== room.drawerId) : [];
  const localChoiceVote = localPlayer ? roomChoiceVotes[localPlayer.id] : undefined;
  const choiceVoteCounts = room?.choices.map((_, index) => (
    Object.values(roomChoiceVotes).filter((vote) => vote === index).length
  )) ?? [];
  const submittedChoiceVotes = Object.keys(roomChoiceVotes).filter((playerId) => eligibleChoiceVoters.some((player) => player.id === playerId)).length;

  const leaveLocalRoom = useCallback((roomToLeave: RoomState) => {
    const players = roomToLeave.players.filter((player) => player.id !== clientId);
    if (!players.length) {
      deleteRoom(roomToLeave.code);
      return;
    }
    const wasHost = roomToLeave.hostId === clientId;
    const wasDrawer = roomToLeave.drawerId === clientId;
    const shouldResetRound = wasDrawer || (roomToLeave.phase !== "lobby" && players.length < 2);
    writeRoom({
      ...roomToLeave,
      players,
      hostId: wasHost ? players[0].id : roomToLeave.hostId,
      drawerId: shouldResetRound ? null : roomToLeave.drawerId,
      phase: shouldResetRound ? "lobby" : roomToLeave.phase,
      answer: shouldResetRound ? null : roomToLeave.answer,
      choices: shouldResetRound ? [] : roomToLeave.choices,
      choiceVotes: shouldResetRound ? {} : roomToLeave.choiceVotes ?? {},
      guesses: shouldResetRound ? [] : roomToLeave.guesses,
      solved: shouldResetRound ? [] : roomToLeave.solved,
      endAt: shouldResetRound ? null : roomToLeave.endAt,
      drawingOperations: shouldResetRound ? [] : roomToLeave.drawingOperations,
    });
  }, [clientId]);

  const leaveCurrentRoom = useCallback((navigateHome = false) => {
    const roomToLeave = room;
    if (roomToLeave) {
      if (roomTransport === "online") onlineRoomRef.current?.sendLeaveRoom();
      else leaveLocalRoom(roomToLeave);
    }
    onlineRoomRef.current?.close();
    onlineRoomRef.current = null;
    setRoom(null);
    setJoinedCode("");
    setRoomTransport("none");
    setRoomConnectionStatus("offline");
    setShowRoomDetails(false);
    setRoomCodeRevealed(false);
    setLiveDrawingOperation(null);
    setGuess("");
    setNotice(roomToLeave ? `Left room ${roomToLeave.code}.` : "");
    if (navigateHome) onNavigate("/");
  }, [leaveLocalRoom, onNavigate, room, roomTransport]);

  const requestExitToHome = useCallback(() => {
    if (room && !skipRoomExitConfirm) {
      setConfirmExitOpen(true);
      return;
    }
    leaveCurrentRoom(true);
  }, [leaveCurrentRoom, room, skipRoomExitConfirm]);

  const saveRoom = (nextRoom: RoomState) => {
    if (roomTransport === "online") {
      setRoom(nextRoom);
      return;
    }
    writeRoom(nextRoom);
    setRoom(nextRoom);
  };

  const enterRoom = (mode: RoomEntryMode, event?: FormEvent) => {
    event?.preventDefault();
    let code = mode === "create" ? createRoomCode() : normalizeRoomCode(roomCodeInput);
    if (!code) {
      setNotice("Enter a room code to join.");
      return;
    }
    while (mode === "create" && !hasApiBaseUrl && readRoom(code)) code = createRoomCode();
    const player = createPlayer(clientId, playerName);
    onlineRoomRef.current?.close();
    onlineRoomRef.current = null;
    if (hasApiBaseUrl) {
      setRoomCodeInput(mode === "create" ? "" : code);
      setJoinedCode(code);
      setRoomTransport("online");
      setShowRoomDetails(false);
      setRoomCodeRevealed(false);
      setNotice(mode === "create" ? `Created online room ${code}.` : `Joining online room ${code}.`);
      onlineRoomRef.current = connectOnlineRoom(code, player.id, player.name, {
        onState: (nextRoom) => {
          setRoom(nextRoom);
          if ((nextRoom.drawingOperations?.length ?? 0) > 0) setLiveDrawingOperation(null);
          setNotice(`Online room ${nextRoom.code} is synced.`);
        },
        onDrawingPreview: setLiveDrawingOperation,
        onStatus: setRoomConnectionStatus,
        onError: setNotice,
      });
      if (!onlineRoomRef.current) setNotice("Online room server is unavailable.");
      return;
    }
    const existing = readRoom(code);
    if (mode === "join" && !existing) {
      setNotice(`No local room found for ${code}. Check the code or create a new room.`);
      return;
    }
    if (mode === "join" && existing && !existing.players.some((item) => item.id === player.id) && existing.players.length >= (existing.maxPlayers ?? 8)) {
      setNotice(`Room ${code} is full.`);
      return;
    }
    const nextRoom = existing
      ? {
        ...existing,
        maxPlayers: existing.maxPlayers ?? 8,
        players: existing.players.some((item) => item.id === player.id)
          ? existing.players.map((item) => item.id === player.id ? { ...item, name: player.name } : item)
          : [...existing.players, player],
      }
      : createEmptyRoom(code, player);
    setRoomCodeInput(mode === "create" ? "" : code);
    setJoinedCode(code);
    setRoomTransport("local");
    setShowRoomDetails(false);
    setRoomCodeRevealed(false);
    saveRoom(nextRoom);
    setNotice(mode === "create" ? `Created room ${code}.` : `Joined room ${code}.`);
  };

  const createRoom = () => enterRoom("create");
  const joinRoom = (event?: FormEvent) => enterRoom("join", event);
  const copyRoomCode = async () => {
    if (!room) return;
    await navigator.clipboard.writeText(room.code);
    setNotice(`Copied room code ${room.code}.`);
  };
  const updateRoomSettings = (settings: { roundsPerPlayer?: number; maxPlayers?: number }) => {
    if (!room || !canEditRoomDetails) return;
    const nextRounds = Math.min(10, Math.max(1, Math.round(settings.roundsPerPlayer ?? room.roundsPerPlayer)));
    const nextMaxPlayers = Math.min(16, Math.max(room.players.length, Math.max(2, Math.round(settings.maxPlayers ?? roomMaxPlayers))));
    if (roomTransport === "online") {
      onlineRoomRef.current?.sendRoomSettings({ roundsPerPlayer: nextRounds, maxPlayers: nextMaxPlayers });
      return;
    }
    saveRoom({ ...room, roundsPerPlayer: nextRounds, maxPlayers: nextMaxPlayers });
  };
  const transferRoomLeader = (hostId: string) => {
    if (!room || !canEditRoomDetails || !room.players.some((player) => player.id === hostId)) return;
    setLeaderPickerOpen(false);
    if (roomTransport === "online") {
      onlineRoomRef.current?.sendRoomLeader(hostId);
      return;
    }
    saveRoom({ ...room, hostId });
  };

  useEffect(() => () => onlineRoomRef.current?.close(), []);

  useEffect(() => {
    setTimerNow(Date.now());
    const timer = window.setInterval(() => setTimerNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [room?.code]);

  useEffect(() => {
    if (room?.phase !== "drawing" || isDrawer) setLiveDrawingOperation(null);
  }, [isDrawer, room?.phase]);

  useEffect(() => {
    if (!joinedCode || roomTransport !== "local") return;
    const sync = (event: StorageEvent) => {
      if (event.key !== roomStorageKey(joinedCode) || !event.newValue) return;
      setRoom(JSON.parse(event.newValue) as RoomState);
    };
    window.addEventListener("storage", sync);
    const timer = window.setInterval(() => {
      const latest = readRoom(joinedCode);
      if (latest) setRoom(latest);
    }, 500);
    return () => {
      window.removeEventListener("storage", sync);
      window.clearInterval(timer);
    };
  }, [joinedCode, roomTransport]);

  useEffect(() => {
    if (roomTransport === "online") return;
    if (!room || !isHost || room.phase !== "drawing" || !room.endAt || Date.now() < room.endAt) return;
    saveRoom({ ...room, phase: "results", endAt: null });
  }, [isHost, room, roomTransport, secondsRemaining]);

  useEffect(() => {
    if (roomTransport === "online") return;
    if (!room || !isHost || room.phase !== "drawing" || !room.answer) return;
    const guessers = room.players.filter((player) => player.id !== room.drawerId);
    if (guessers.length > 0 && room.solved.length >= guessers.length) {
      saveRoom({ ...room, phase: "results", endAt: null });
    }
  }, [isHost, room, roomTransport]);

  useEffect(() => {
    if (roomTransport === "online") return;
    if (!room || !isHost || room.phase !== "results") return;
    const timer = window.setTimeout(() => advanceTurn(room), 2500);
    return () => window.clearTimeout(timer);
  }, [isHost, room, roomTransport]);

  useEffect(() => {
    if (roomTransport !== "online" || !room || !isHost || room.phase !== "choosing" || room.choices.length > 0) return;
    onlineRoomRef.current?.sendChoices(pickRoomChoices(room.categorySelection, room.recentPromptKeys, 3, wordFeedback));
  }, [isHost, room, roomTransport]);

  useEffect(() => {
    if (!room?.answer || room.phase !== "results") return;
    const turnKey = `${room.code}:${room.turnIndex}:${room.answer.categoryId}:${room.answer.answer}`;
    if (lastAutoFeedbackTurnRef.current === turnKey) return;
    lastAutoFeedbackTurnRef.current = turnKey;
    feedbackRoundsSinceAutoRef.current += 1;
    const target: WordFeedbackTarget = {
      answer: room.answer.answer,
      categoryId: room.answer.categoryId,
      difficulty: room.answer.difficulty,
    };
    if (!shouldPromptForWordFeedback(wordFeedback, target, feedbackRoundsSinceAutoRef.current)) return;
    feedbackRoundsSinceAutoRef.current = 0;
    setFeedbackTarget(target);
  }, [room?.answer, room?.code, room?.phase, room?.turnIndex, wordFeedback]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = resizeStateRef.current;
      if (!resize) return;
      const delta = event.clientX - resize.startX;
      if (resize.panel === "source") {
        setSourceRailWidth(Math.max(260, Math.min(520, resize.startWidth + delta)));
      } else {
        setSidePanelWidth(Math.max(250, Math.min(460, resize.startWidth - delta)));
      }
    };
    const stopResize = () => {
      resizeStateRef.current = null;
      document.body.classList.remove("resizing-panels");
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [setSidePanelWidth, setSourceRailWidth]);

  const startResize = (panel: ResizeState["panel"], event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStateRef.current = {
      panel,
      startX: event.clientX,
      startWidth: panel === "source" ? sourceRailWidth : sidePanelWidth,
    };
    document.body.classList.add("resizing-panels");
  };

  const updateSelection = (optionId: string) => {
    if (!room || room.phase !== "lobby") return;
    const nextSelection = optionId === "all"
      ? "all"
      : toggleCategorySelectionOption(room.categorySelection, optionId, "room", "");
    if (roomTransport === "online") {
      onlineRoomRef.current?.sendCategorySelection(nextSelection || "all");
      return;
    }
    saveRoom({ ...room, categorySelection: nextSelection || "all" });
  };

  const removeSelectionChip = (chipId: string) => {
    if (!room || room.phase !== "lobby") return;
    const nextSelection = removeCategorySelectionChip(room.categorySelection, chipId, "room", "all");
    if (roomTransport === "online") {
      onlineRoomRef.current?.sendCategorySelection(nextSelection || "all");
      return;
    }
    saveRoom({ ...room, categorySelection: nextSelection || "all" });
  };

  const applySelection = (selectionId: string) => {
    if (!room || room.phase !== "lobby") return;
    if (roomTransport === "online") {
      onlineRoomRef.current?.sendCategorySelection(selectionId || "all");
      return;
    }
    saveRoom({ ...room, categorySelection: selectionId || "all" });
  };

  const startGame = () => {
    if (!room || !isHost || room.players.length < 2) return;
    const drawerId = room.players[0]?.id ?? null;
    const choices = pickRoomChoices(room.categorySelection, room.recentPromptKeys, 3, wordFeedback);
    if (roomTransport === "online") {
      onlineRoomRef.current?.sendStartGame(choices);
      setNotice("Game started. Players are voting on the word.");
      return;
    }
    saveRoom({
      ...room,
      phase: "choosing",
      drawerId,
      turnIndex: 0,
      roundIndex: 0,
      roundsPerPlayer: room.roundsPerPlayer,
      answer: null,
      choices,
      choiceVotes: {},
      guesses: [],
      solved: [],
      players: room.players.map((player) => ({ ...player, score: 0 })),
    });
    setNotice("Game started. Players are voting on the word.");
  };

  const getWinningChoiceIndex = (votes: Record<string, number>) => {
    if (!room?.choices.length) return -1;
    const counts = room.choices.map((_, index) => Object.values(votes).filter((vote) => vote === index).length);
    return counts.reduce((bestIndex, count, index) => count > counts[bestIndex] ? index : bestIndex, 0);
  };

  const voteForChoice = (choiceIndex: number) => {
    if (!room || room.phase !== "choosing" || isDrawer || !localPlayer || !room.choices[choiceIndex]) return;
    if (roomTransport === "online") {
      onlineRoomRef.current?.sendChoiceVote(choiceIndex);
      return;
    }
    const nextVotes = { ...(room.choiceVotes ?? {}), [localPlayer.id]: choiceIndex };
    const eligibleVoters = room.players.filter((player) => player.id !== room.drawerId);
    const votedCount = Object.keys(nextVotes).filter((playerId) => eligibleVoters.some((player) => player.id === playerId)).length;
    const winningIndex = getWinningChoiceIndex(nextVotes);
    const winningChoice = room.choices[winningIndex];
    if (votedCount >= eligibleVoters.length && winningChoice) {
      saveRoom({
        ...room,
        phase: "drawing",
        answer: winningChoice,
        choiceVotes: {},
        guesses: [],
        solved: [],
        endAt: Date.now() + room.roundSeconds * 1000,
        recentPromptKeys: [...room.recentPromptKeys, roomPromptKey(winningChoice)].slice(-32),
      });
      return;
    }
    saveRoom({ ...room, choiceVotes: nextVotes });
  };

  const submitGuess = (event: FormEvent) => {
    event.preventDefault();
    if (!room || room.phase !== "drawing" || !room.answer || !localPlayer || isDrawer) return;
    const text = guess.trim().slice(0, 80);
    if (!text) return;
    if (roomTransport === "online") {
      onlineRoomRef.current?.sendGuess(text);
      setGuess("");
      return;
    }
    const aliases = [room.answer.answer, ...(room.answer.aliases ?? [])].map(normalizeGuess);
    const correct = aliases.includes(normalizeGuess(text));
    const alreadySolved = room.solved.some((item) => item.playerId === localPlayer.id);
    const remainingRatio = room.endAt ? Math.max(0, room.endAt - Date.now()) / (room.roundSeconds * 1000) : 0;
    const points = correct && !alreadySolved ? Math.round(100 + remainingRatio * 300) : 0;
    const guessEntry: RoomGuess = {
      id: `guess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      playerId: localPlayer.id,
      playerName: localPlayer.name,
      text,
      correct: correct && !alreadySolved,
      createdAt: Date.now(),
    };
    const drawerBonus = correct && !alreadySolved ? 50 : 0;
    saveRoom({
      ...room,
      guesses: [...room.guesses.slice(-30), guessEntry],
      solved: correct && !alreadySolved
        ? [...room.solved, { playerId: localPlayer.id, playerName: localPlayer.name, points, solvedAt: Date.now() }]
        : room.solved,
      players: room.players.map((player) => {
        if (player.id === localPlayer.id) return { ...player, score: player.score + points };
        if (player.id === room.drawerId) return { ...player, score: player.score + drawerBonus };
        return player;
      }),
    });
    setGuess("");
  };

  const advanceTurn = (roomToAdvance = room) => {
    if (!roomToAdvance || !isHost) return;
    const room = roomToAdvance;
    const next = getNextTurn(room);
    if (!next) {
      saveRoom({ ...room, phase: "finished", answer: null, choices: [], choiceVotes: {}, drawerId: null, endAt: null });
      return;
    }
    saveRoom({
      ...room,
      phase: "choosing",
      ...next,
      answer: null,
      choices: pickRoomChoices(room.categorySelection, room.recentPromptKeys, 3, wordFeedback),
      choiceVotes: {},
      guesses: [],
      solved: [],
      endAt: null,
    });
  };

  const syncDrawingOperations = useCallback((operations: DrawingOperation[]) => {
    if (roomTransport === "online" && isDrawer) onlineRoomRef.current?.sendDrawingOperations(operations);
  }, [isDrawer, roomTransport]);

  const syncLiveDrawingOperation = useCallback((operation: DrawingOperation | null) => {
    if (roomTransport === "online" && isDrawer) onlineRoomRef.current?.sendDrawingPreview(operation);
  }, [isDrawer, roomTransport]);

  const openWordFeedback = () => {
    if (!room?.answer || room.answer.answer.startsWith("Error:")) return;
    setFeedbackTarget({
      answer: room.answer.answer,
      categoryId: room.answer.categoryId,
      difficulty: room.answer.difficulty,
    });
  };

  const submitWordFeedback = (rating: WordFeedbackRating | "skip") => {
    if (!feedbackTarget) return;
    setWordFeedback((current) => recordWordFeedback(current, feedbackTarget, rating));
    setFeedbackTarget(null);
  };

  const selectedOption = {
    id: selectedTokens.length === 0 ? "empty" : room?.categorySelection ?? "all",
    label: selectedTokens.length === 0 ? "No Decks Selected" : selectedTokens.length > 1 ? `${selectedTokens.length} Decks Selected` : activeSelectionChips[0]?.label ?? "All decks shuffled",
    description: "Room mode word pool",
    icon: "groups",
    accent: activeSelectionChips[0]?.accent ?? "#83c5e6",
  };

  return (
    <div className="dashboard-layout room-mode-page" style={{ "--source-rail-width": `${sourceRailWidth}px`, "--side-panel-width": `${sidePanelWidth}px` } as CSSProperties}>
      <aside className="stream-sidebar room-sidebar" aria-label="Room setup">
        <WorkspaceIdentity connected={roomConnectionStatus === "connected"} configured={hasApiBaseUrl} displayName={playerName} onModes={requestExitToHome} returnTo="/room" subtitle={hasApiBaseUrl ? "Online room beta" : "Local room fallback"} />

        <section className="source-card room-player-card">
          <header className="source-card-header">
            <div><span className="source-eyebrow">Players</span><h2>{room ? "Room lobby" : "No room"}</h2></div>
            <div className="room-player-header-actions">
              {room ? (
                <button className="room-panel-exit-button" onClick={() => leaveCurrentRoom(false)} title="Leave this room" type="button">
                  <span className="material-symbols-outlined">logout</span>
                  <span>Exit room</span>
                </button>
              ) : null}
              <span className="source-status">{room?.players.length ?? 0}</span>
            </div>
          </header>
          <div className="room-player-list">
            {sortedPlayers.length ? sortedPlayers.map((player, index) => (
              <span className={player.id === room?.drawerId ? "drawer" : ""} key={player.id}>
                <b><i>{index + 1}</i>{player.name}</b>
                <small>{player.id === room?.hostId ? `Host - ${player.score}` : player.id === room?.drawerId ? `Drawing - ${player.score}` : `${player.score} pts`}</small>
              </span>
            )) : <p>No players yet.</p>}
          </div>
        </section>

        {!room ? (
          <section className="source-card room-join-card">
            <header className="source-card-header"><div><span className="source-eyebrow">Room desk</span><h2>Room</h2></div><span className="source-status ready"><i />{hasApiBaseUrl ? "Online" : "Local"}</span></header>
            <form className="room-join-form" onSubmit={joinRoom}>
              <button onClick={createRoom} type="button"><span className="material-symbols-outlined">add_circle</span>Create room</button>
              <button type="submit"><span className="material-symbols-outlined">login</span>Join room</button>
              <label><span>Room code</span><input autoComplete="off" inputMode="numeric" maxLength={4} onChange={(event) => setRoomCodeInput(normalizeRoomCode(event.target.value))} placeholder="Enter code" value={roomCodeInput} /></label>
            </form>
            {notice ? <p className="room-note">{notice}</p> : null}
          </section>
        ) : (
          <section className="source-card camera-source-card room-camera-card">
            <header className="source-card-header">
              <div>
                <span className="source-eyebrow">Camera frame</span>
                <h2>{showRoomDetails ? "Room details" : isDrawer ? "Word panel" : "Drawer on camera"}</h2>
              </div>
              <span className={`source-status ${room.phase === "drawing" ? "ready" : ""}`}><i />{room.phase === "drawing" ? "Round live" : room.phase}</span>
            </header>
            <div className={`camera-preview ${room.phase === "drawing" && isDrawer ? "source-selected round-prompt-visible" : "custom-word-position"}`}>
              <button
                className="asset-image-toggle room-details-toggle"
                onClick={() => setShowRoomDetails((current) => !current)}
                title={showRoomDetails ? "Show word panel" : "Show room details"}
                type="button"
              >
                <span className="material-symbols-outlined">{showRoomDetails ? "visibility" : "meeting_room"}</span>
              </button>
              {showRoomDetails ? (
                <div className="custom-word-card room-word-card room-details-card">
                  <div className="room-code-share">
                    <button className="room-code-cover" onClick={() => setRoomCodeRevealed((current) => !current)} type="button">
                      {roomCodeRevealed ? <span className="room-code-text">{room.code}</span> : <span className="room-code-mask" aria-label="Room code hidden" />}
                    </button>
                    <button className="room-code-copy" onClick={copyRoomCode} title="Copy room code" type="button">
                      <span className="material-symbols-outlined">content_copy</span>
                    </button>
                  </div>
                  <div className="room-details-list">
                    <label>
                      <b>Max players</b>
                      <input disabled={!canEditRoomDetails} max={16} min={Math.max(2, room.players.length)} onChange={(event) => updateRoomSettings({ maxPlayers: Number(event.target.value) })} type="number" value={roomMaxPlayers} />
                    </label>
                    <label>
                      <b>Rounds</b>
                      <input disabled={!canEditRoomDetails} max={10} min={1} onChange={(event) => updateRoomSettings({ roundsPerPlayer: Number(event.target.value) })} type="number" value={room.roundsPerPlayer} />
                    </label>
                    <div className="room-leader-control">
                      <button disabled={!canEditRoomDetails} onClick={() => setLeaderPickerOpen((current) => !current)} type="button">
                        <b>Leader</b><strong>{roomLeader?.name ?? "Host"}</strong>
                      </button>
                      {leaderPickerOpen && canEditRoomDetails ? (
                        <div className="room-leader-picker">
                          {room.players.map((player) => (
                            <button className={player.id === room.hostId ? "active" : ""} key={player.id} onClick={() => transferRoomLeader(player.id)} type="button">
                              <span>{player.name}</span><small>{player.id === room.hostId ? "Leader" : "Make leader"}</small>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : room.phase === "drawing" && isDrawer && room.answer ? (
                <div className="camera-prompt-copy">
                  <strong style={{ fontSize: Math.max(26, Math.min(60, 440 / Math.max(1, room.answer.answer.length))) + "px", lineHeight: 1.15 }}>{room.answer.answer}</strong>
                </div>
              ) : (
                <div className="custom-word-card room-word-card">
                  <small className="camera-instruction">Keep this area covered by your camera in OBS</small>
                  <strong>{room.phase === "finished" && winner ? `${winner.name} wins` : room.phase === "choosing" ? "Players are voting" : "Waiting for the round"}</strong>
                  {isHost && (room.phase === "lobby" || room.phase === "finished") ? (
                    <button className="room-start-button room-lobby-start-button" disabled={room.players.length < 2} onClick={startGame} type="button">
                      <span className="material-symbols-outlined">play_arrow</span>{room.phase === "finished" ? "Start New Game" : "Start Game"}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        )}
      </aside>
      {confirmExitOpen ? (
        <div className="room-exit-backdrop" role="presentation">
          <section aria-label="Exit room confirmation" aria-modal="true" className="room-exit-dialog" role="dialog">
            <span className="material-symbols-outlined">logout</span>
            <h2>Exit room?</h2>
            <p>You will leave the current room and return to the mode page.</p>
            <label className="room-exit-skip">
              <input checked={skipRoomExitConfirm} onChange={(event) => setSkipRoomExitConfirm(event.target.checked)} type="checkbox" />
              <span>Do not show this again</span>
            </label>
            <div className="room-exit-actions">
              <button onClick={() => setConfirmExitOpen(false)} type="button">No</button>
              <button className="danger" onClick={() => leaveCurrentRoom(true)} type="button">Yes</button>
            </div>
          </section>
        </div>
      ) : null}

      <div aria-label="Resize room setup panel" aria-orientation="vertical" aria-valuemax={520} aria-valuemin={260} aria-valuenow={sourceRailWidth} className="layout-resizer source-rail-resizer" onPointerDown={(event) => startResize("source", event)} role="separator" />

      <main className="dashboard-shell room-shell">
        <section className="dashboard-grid room-grid">
          <div className="main-column room-main-column">
            <section className="prompt-board room-prompt-board">
              <div className="round-word-mask">
                {room?.phase === "drawing" && isDrawer ? room.answer?.answer.toUpperCase() : room?.answer?.mask ?? maskedAnswer(room?.answer?.answer ?? null)}
              </div>
              <button aria-label="Give word feedback" className="word-feedback-trigger" disabled={!room?.answer} onClick={openWordFeedback} title="Give word feedback" type="button">
                <span className="material-symbols-outlined">rate_review</span>
              </button>
            </section>

            <section className="canvas-card room-canvas-card">
              <header className="room-canvas-header">
                <span className="room-round-indicator">Round {room ? Math.min(room.roundsPerPlayer, room.roundIndex + 1) : 1}/{room?.roundsPerPlayer ?? 3}</span>
                <div className="timer">
                  {`${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`}
                </div>
              </header>
              {room?.phase === "choosing" ? (
                <div className="room-choice-board">
                  <span className="source-eyebrow">Word vote</span>
                  <h2>{isDrawer ? "Words on the table" : "Pick a mystery slot"}</h2>
                  <p>{isDrawer ? "Players vote without seeing the words. The top slot becomes your drawing prompt." : `${drawer?.name ?? "Drawer"} can see the words. You only choose a slot.`}</p>
                  <div className="room-choice-list" role="list">
                    {room.choices.map((choice, index) => {
                      const voteCount = choiceVoteCounts[index] ?? 0;
                      const selected = localChoiceVote === index;
                      return (
                        <button
                          className={selected ? "selected" : ""}
                          disabled={isDrawer || !localPlayer}
                          key={`${choice.categoryId}-${choice.answer}-${index}`}
                          onClick={() => voteForChoice(index)}
                          type="button"
                        >
                          <span className="room-choice-slot">Slot {index + 1}</span>
                          <strong>{isDrawer ? choice.answer : "Hidden word"}</strong>
                          <small>{voteCount} vote{voteCount === 1 ? "" : "s"}</small>
                        </button>
                      );
                    })}
                  </div>
                  <span className="room-choice-progress">{submittedChoiceVotes}/{eligibleChoiceVoters.length} players voted</span>
                </div>
              ) : (
                <ExcalidrawStage
                  key={`${room?.code ?? "offline"}-${room?.turnIndex ?? 0}-${room?.phase ?? "empty"}-${room?.drawerId ?? "none"}`}
                  canvasColor={canvasColor}
                  gridSize={gridSize}
                  hoverMenuDelay={500}
                  hoverMenusEnabled
                  onCanvasColorChange={setCanvasColor}
                  onGridSizeChange={setGridSize}
                  shortcuts={DEFAULT_KEYBOARD_SHORTCUTS}
                  externalOperations={isDrawer && room?.phase === "drawing" ? undefined : room?.drawingOperations}
                  liveOperation={!isDrawer ? liveDrawingOperation : null}
                  onLiveOperation={syncLiveDrawingOperation}
                  onOperationsChange={syncDrawingOperations}
                  readOnly={room?.phase === "drawing" && !isDrawer}
                />
              )}
              {room?.phase === "drawing" && !isDrawer ? (
                <div className="room-viewer-note">
                  <span className="material-symbols-outlined">visibility</span>
                  Watching {drawer?.name ?? "the drawer"} draw live.
                </div>
              ) : null}
            </section>
          </div>

          <div aria-label="Resize room activity panel" aria-orientation="vertical" aria-valuemax={460} aria-valuemin={250} aria-valuenow={sidePanelWidth} className="layout-resizer side-panel-resizer" onPointerDown={(event) => startResize("side", event)} role="separator" />

          <aside className="side-column room-side-column" aria-label="Room activity">
            <section className={`feed-card support-card room-category-card ${categoriesOpen ? "" : "collapsed"}`}>
              <div className="support-tabs" role="tablist" aria-label="Room categories">
                <button aria-expanded={categoriesOpen} aria-selected="true" className="active" onClick={() => setCategoriesOpen((current) => !current)} role="tab" type="button">
                  <span className="material-symbols-outlined">category</span>Categories
                  <span className="material-symbols-outlined">{categoriesOpen ? "expand_less" : "expand_more"}</span>
                </button>
              </div>
              {categoriesOpen ? <div className="support-panel-content category-panel" role="tabpanel">
                <div className="active-categories-panel">
                  <CategoryPickerWindow
                    currentSelection={room?.categorySelection ?? "all"}
                    disabled={!room || !isHost || room.phase !== "lobby"}
                    domains={getCategoryDomains("room")}
                    isOptionActive={(optionId) => isCategorySelectionOptionActive(room?.categorySelection ?? "all", optionId, "room")}
                    lockedNote="Only the host can change decks in the lobby."
                    onApplySelection={applySelection}
                    onChange={updateSelection}
                    onRemoveChip={removeSelectionChip}
                    onReset={() => room && saveRoom({ ...room, categorySelection: "" })}
                    onSelectAll={() => room && saveRoom({ ...room, categorySelection: "all" })}
                    profileStorageKey="room"
                    selectedChips={activeSelectionChips}
                    selectedId={selectedTokens.length === 1 ? selectedTokens[0] : selectedTokens.length === 0 ? "empty" : ""}
                    selectedOption={selectedOption}
                  />
                  <CategorySelectionTools chips={activeSelectionChips} disabled={!room || !isHost || room.phase !== "lobby"} mode="room" onRemoveChip={removeSelectionChip} />
                </div>
              </div> : null}
            </section>

            <section className="feed-card room-guess-card">
              <div className="card-title"><h3><span className="material-symbols-outlined">forum</span>Room chat</h3><b>{room?.guesses.length ?? 0}</b></div>
              <div className="room-guess-list scrollable">
                {room?.guesses.length ? room.guesses.slice().reverse().map((item) => (
                  <p className={item.correct ? "correct" : ""} key={item.id}><strong>{item.playerName}</strong>{item.correct ? "guessed correctly" : item.text}</p>
                )) : null}
              </div>
              <form className="room-guess-form" onSubmit={submitGuess}>
                <input disabled={!room || room.phase !== "drawing" || isDrawer} onChange={(event) => setGuess(event.target.value)} placeholder={isDrawer ? "Drawer cannot guess" : "Chat or guess..."} value={guess} />
                <button disabled={!guess.trim()} type="submit"><span className="material-symbols-outlined">send</span></button>
              </form>
            </section>
          </aside>
        </section>
      </main>
      <WordFeedbackModal
        modeLabel="Room Mode"
        onClose={() => setFeedbackTarget(null)}
        onSubmit={submitWordFeedback}
        target={feedbackTarget}
      />
    </div>
  );
}
