import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ExcalidrawStage } from "../canvas/ExcalidrawStage";
import type { DrawingOperation } from "../canvas/drawingTypes";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../dashboard/keyboardShortcuts";
import type { CategoryPrompt } from "../dashboard/gameData";
import {
  DEFAULT_ARTIST_WORD_MIX,
  getArtistMixLabel,
  getArtistMixWordCount,
  getWordMixPackSnapshots,
  normalizeArtistWordMix,
  type ArtistWordMix,
} from "../dashboard/artistWordPacks";
import type { CommunityPack } from "../community/communityPacksApi";
import { WorkspaceIdentity } from "../ui/WorkspaceIdentity";
import { usePersistentState } from "../ui/usePersistentState";
import { DockControls, DockLayout, DockPanel, DockSlot, ResizableSurface } from "../ui/DockLayout";
import { resizeDockBoundary, SIDE_RAIL_SNAP_POINTS, snapDockRailWidth, SOURCE_RAIL_SNAP_POINTS } from "../ui/dockRailResize";
import {
  connectLiveEvents,
  endServerRound,
  reconnectTwitchChat,
  startServerRound,
  type SolvedViewer,
} from "../twitch/twitchApi";
import { TWITCH_SOLVER_PREVIEW } from "../twitch/twitchSolverPreview";
import {
  recordWordFeedback,
  type WordFeedbackMap,
  type WordFeedbackRating,
  type WordFeedbackTarget,
} from "../feedback/wordFeedback";
import { hasApiBaseUrl } from "../apiUrls";
import {
  createClientId,
  createRoomReconnectToken,
  createEmptyRoom,
  createRoomCode,
  deleteRoom,
  maskedAnswer,
  normalizeGuess,
  normalizeRoomState,
  normalizeRoomCode,
  pickRoomChoices,
  readRoom,
  ROOM_CODE_LENGTH,
  roomPromptKey,
  roomStorageKey,
  writeRoom,
  type RoomGuess,
  type RoomPlayer,
  type RoomState,
} from "./localRoomState";
import { connectOnlineRoom, type OnlineRoomClient } from "./onlineRoomClient";
import { useSiteIdentity } from "../identity/SiteIdentity";
import { clearRoomLaunch, readRoomLaunch, type RoomLaunchIntent } from "./roomLaunch";
import { createRoomTestBots, isRoomTestBot, useLocalRoomTestBots } from "./roomTestBots";

type RoomModePageProps = {
  onNavigate: (path: string) => void;
};

type ResizeState = {
  element: HTMLDivElement;
  panel: "source" | "side";
  startX: number;
  startWidth: number;
  lastWidth: number;
};

type RoomEntryMode = "create" | "join";
const createPlayer = (id: string, name: string): RoomPlayer => ({
  id,
  name: name.trim().slice(0, 20) || "Player",
  score: 0,
  connectedAt: Date.now(),
});

const normalizePlayerName = (name: string) => name.trim().toLocaleLowerCase("en");
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
  const { displayName: playerName, ready: identityReady, setTwitchSession, twitchSession } = useSiteIdentity();
  const [clientId] = useState(createClientId);
  const [roomReconnectToken] = useState(createRoomReconnectToken);
  const [launchIntent] = useState(readRoomLaunch);
  const [lastOnlineRoomCode, setLastOnlineRoomCode] = usePersistentState("room.lastOnlineCode.v1", "");
  const [sourceRailWidth, setSourceRailWidth] = usePersistentState("room.layout.leftRailWidth", 320);
  const [sidePanelWidth, setSidePanelWidth] = usePersistentState("room.layout.rightRailWidth", 300);
  const [joinedCode, setJoinedCode] = useState("");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [roomTransport, setRoomTransport] = useState<"none" | "online" | "local">("none");
  const [roomConnectionStatus, setRoomConnectionStatus] = useState<"connecting" | "connected" | "offline">("offline");
  const [guess, setGuess] = useState("");
  const [liveDrawingOperation, setLiveDrawingOperation] = useState<DrawingOperation | null>(null);
  const [notice, setNotice] = useState("");
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [twitchPanelOpen, setTwitchPanelOpen] = useState(false);
  const [twitchSolvers, setTwitchSolvers] = useState<SolvedViewer[]>([]);
  const [twitchNotice, setTwitchNotice] = useState("");
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [skipRoomExitConfirm, setSkipRoomExitConfirm] = usePersistentState("room.exit.skipConfirm", false);
  const [canvasColor, setCanvasColor] = usePersistentState("room.canvas.background", "#FFF2CF");
  const [gridSize, setGridSize] = usePersistentState("room.grid.size", 24);
  const [wordFeedback, setWordFeedback] = usePersistentState<WordFeedbackMap>("feedback.room.words", {});
  const [roomWordMix] = usePersistentState<ArtistWordMix>("room.wordMix.v1", DEFAULT_ARTIST_WORD_MIX);
  const [communityPacks] = usePersistentState<CommunityPack[]>("artist.communityPacks.v1", []);
  const [reportedCommunityPackIds, setReportedCommunityPackIds] = usePersistentState<string[]>("artist.reportedCommunityPacks.v1", []);
  const [resultsEndAt, setResultsEndAt] = useState<number | null>(null);
  const [currentRoundRating, setCurrentRoundRating] = useState<WordFeedbackRating | null>(null);
  const [finishedSummaryDismissed, setFinishedSummaryDismissed] = useState(false);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const onlineRoomRef = useRef<OnlineRoomClient | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const activeTwitchRoundIdRef = useRef<string | null>(null);
  const startedTwitchRoundKeyRef = useRef<string | null>(null);
  const roomRoundRef = useRef({ phase: "", turnIndex: -1 });
  const roomTransportRef = useRef<"none" | "online" | "local">("none");
  const createdOnlineRoomRef = useRef<string | null>(null);
  const restoreAttemptedRef = useRef(false);
  const pendingRoomSetupRef = useRef<RoomLaunchIntent | null>(null);
  const localBotAutoStartRef = useRef<string | null>(null);

  const roomPlayers = room?.players ?? [];
  const connectedRoomPlayers = roomPlayers.filter((player) => !player.disconnectedAt);
  const roomChoices = room?.choices ?? [];
  const roomGuesses = room?.guesses ?? [];
  const roomSolved = room?.solved ?? [];
  const roomAnswerText = typeof room?.answer?.answer === "string" ? room.answer.answer : "";
  const localPlayer = roomPlayers.find((player) => player.id === clientId) ?? null;
  const drawer = getDrawer(room);
  const isHost = room?.hostId === clientId;
  const isDrawer = room?.drawerId === clientId;
  const sortedPlayers = useMemo(() => (
    (room?.players ?? []).slice().sort((first, second) => second.score - first.score)
  ), [room?.players]);
  const activeCommunityPacks = communityPacks.filter((pack) => pack.status === "published" && !reportedCommunityPackIds.includes(pack.id));
  const activeRoomWordMix = normalizeArtistWordMix(room?.wordMix ?? roomWordMix, activeCommunityPacks);
  const roomWordMixLabel = getArtistMixLabel(activeRoomWordMix, activeCommunityPacks);
  const roomWordCount = getArtistMixWordCount(activeRoomWordMix, activeCommunityPacks);
  const displayedRoomWordMixLabel = room?.wordMixPacks?.length
    ? room.wordMixPacks.length <= 3 ? room.wordMixPacks.map((pack) => pack.label).join(" + ") : `${room.wordMixPacks.slice(0, 2).map((pack) => pack.label).join(" + ")} + ${room.wordMixPacks.length - 2} more`
    : roomWordMixLabel;
  const displayedRoomWordCount = room?.wordMixPacks?.reduce((sum, pack) => sum + pack.wordCount, 0) ?? roomWordCount;
  const roomPackLabels = new Map((room?.wordMixPacks ?? []).map((pack) => [`pack-${pack.id}`, pack.label]));
  const getRoomCategoryLabel = (categoryId?: string) => roomPackLabels.get(categoryId || "") || String(categoryId || "General").replace(/^pack-/, "").replace(/^[^:]+:/, "").replace(/[-_]/g, " ");
  const secondsRemaining = room?.phase === "drawing" && room.endAt
    ? Math.max(0, Math.ceil((room.endAt - timerNow) / 1000))
    : room?.roundSeconds ?? 90;
  const resultsSecondsRemaining = resultsEndAt
    ? Math.max(0, Math.ceil((resultsEndAt - timerNow) / 1000))
    : 10;
  const totalTurns = room ? Math.max(1, roomPlayers.length) * room.roundsPerPlayer : 0;
  const currentTurnNumber = room && room.turnIndex >= 0 ? Math.min(totalTurns, room.turnIndex + 1) : 0;
  const winner = room?.phase === "finished" ? sortedPlayers[0] ?? null : null;
  const winningPlayers = winner ? sortedPlayers.filter((player) => player.score === winner.score) : [];
  const finishedTitle = winningPlayers.length > 1 ? "It's a tie!" : winner ? `${winner.name} wins!` : "Game complete";
  const roomChoiceVotes = room?.choiceVotes ?? {};
  const eligibleChoiceVoters = roomPlayers.filter((player) => player.id !== room?.drawerId);
  const localChoiceVote = localPlayer ? roomChoiceVotes[localPlayer.id] : undefined;
  const choiceVoteCounts = roomChoices.map((_, index) => (
    Object.values(roomChoiceVotes).filter((vote) => vote === index).length
  ));
  const submittedChoiceVotes = Object.keys(roomChoiceVotes).filter((playerId) => eligibleChoiceVoters.some((player) => player.id === playerId)).length;
  const twitchLive = roomTransport === "online"
    ? Boolean(room?.twitchOwnerConnected)
    : twitchSession.authenticated && twitchSession.eventSubStatus === "connected";
  const activeTwitchSolvers = roomTransport === "online" ? room?.twitchSolvers ?? [] : twitchSolvers;
  const twitchSolversForDisplay = activeTwitchSolvers.length > 0
    ? activeTwitchSolvers
    : import.meta.env.DEV ? TWITCH_SOLVER_PREVIEW : [];
  const showingTwitchPreview = import.meta.env.DEV && activeTwitchSolvers.length === 0;

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
    setLastOnlineRoomCode("");
    setLiveDrawingOperation(null);
    createdOnlineRoomRef.current = null;
    setGuess("");
    setNotice(roomToLeave ? `Left room ${roomToLeave.code}.` : "");
    if (navigateHome) onNavigate("/room");
  }, [leaveLocalRoom, onNavigate, room, roomTransport, setLastOnlineRoomCode]);

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

  const advanceTurn = useCallback((roomToAdvance = room) => {
    if (!roomToAdvance || !isHost) return;
    const currentRoom = roomToAdvance;
    const next = getNextTurn(currentRoom);
    if (!next) {
      saveRoom({ ...currentRoom, phase: "finished", answer: null, choices: [], choiceVotes: {}, drawerId: null, endAt: null });
      return;
    }
    const choices = pickRoomChoices(currentRoom.wordMix, [...currentRoom.recentPromptKeys, ...currentRoom.recentChoiceKeys], 3, activeCommunityPacks, wordFeedback);
    saveRoom({
      ...currentRoom,
      phase: "choosing",
      ...next,
      answer: null,
      choices,
      recentChoiceKeys: [...currentRoom.recentChoiceKeys, ...choices.map(roomPromptKey)].slice(-32),
      choiceVotes: {},
      guesses: [],
      solved: [],
      endAt: null,
    });
  }, [activeCommunityPacks, isHost, room, wordFeedback]);

  const enterRoom = (mode: RoomEntryMode, event?: FormEvent, restoredCode?: string, setup?: RoomLaunchIntent | null) => {
    event?.preventDefault();
    let code = mode === "create" ? createRoomCode() : normalizeRoomCode(restoredCode ?? "");
    if (code.length !== ROOM_CODE_LENGTH) {
      setNotice(`Enter the full ${ROOM_CODE_LENGTH}-character room code to join.`);
      return;
    }
    while (mode === "create" && !hasApiBaseUrl && readRoom(code)) code = createRoomCode();
    const player = createPlayer(clientId, playerName);
    onlineRoomRef.current?.close();
    onlineRoomRef.current = null;
    if (hasApiBaseUrl) {
      let hasSyncedRoom = false;
      pendingRoomSetupRef.current = mode === "create" ? setup ?? null : null;
      createdOnlineRoomRef.current = mode === "create" ? code : null;
      setJoinedCode(code);
      setRoomTransport("online");
      setNotice(mode === "create" ? `Created online room ${code}.` : `Joining online room ${code}.`);
      onlineRoomRef.current = connectOnlineRoom(code, player.id, roomReconnectToken, player.name, {
        onState: (nextRoom) => {
          if (!nextRoom) return;
          hasSyncedRoom = true;
          setRoom(normalizeRoomState(nextRoom));
          setLastOnlineRoomCode(nextRoom.code);
          setNotice(`Online room ${nextRoom.code} is synced.`);
        },
        onDrawingPreview: setLiveDrawingOperation,
        onStatus: setRoomConnectionStatus,
        onError: (message) => {
          setNotice(message);
          if (hasSyncedRoom) return;
          onlineRoomRef.current?.close();
          onlineRoomRef.current = null;
          setRoom(null);
          setJoinedCode("");
          setRoomTransport("none");
          setRoomConnectionStatus("offline");
          setLastOnlineRoomCode("");
        },
      }, { create: mode === "create" });
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
    if (existing?.players.some((item) => item.id !== player.id && normalizePlayerName(item.name) === normalizePlayerName(player.name))) {
      setNotice("That name is already taken in this room.");
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
      : {
        ...createEmptyRoom(code, player, setup?.kind === "public-bots" ? createRoomTestBots() : []),
        visibility: setup?.kind === "public-bots" ? "public" as const : "private" as const,
        testBots: setup?.kind === "public-bots",
        wordMix: normalizeArtistWordMix(setup?.wordMix ?? roomWordMix, activeCommunityPacks),
        maxPlayers: setup?.maxPlayers ?? 8,
        roundSeconds: setup?.roundSeconds ?? 90,
        roundsPerPlayer: setup?.roundsPerPlayer ?? 3,
      };
    setJoinedCode(code);
    setRoomTransport("local");
    saveRoom(nextRoom);
    setNotice(mode === "create" ? `Created room ${code}.` : `Joined room ${code}.`);
  };

  useEffect(() => {
    if (!identityReady || restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    if (launchIntent?.kind === "private-create") enterRoom("create", undefined, undefined, launchIntent);
    else if (launchIntent?.kind === "public-bots") enterRoom("create", undefined, undefined, launchIntent);
    else if (launchIntent?.code && (launchIntent.kind === "private-join" || launchIntent.kind === "public")) enterRoom("join", undefined, launchIntent.code, launchIntent);
    else if (hasApiBaseUrl && normalizeRoomCode(lastOnlineRoomCode).length === ROOM_CODE_LENGTH) enterRoom("join", undefined, lastOnlineRoomCode);
    clearRoomLaunch();
  }, [identityReady, lastOnlineRoomCode, launchIntent]);
  const copyRoomCode = async () => {
    if (!room) return;
    await navigator.clipboard.writeText(room.code);
    setNotice(`Copied room code ${room.code}.`);
  };
  useEffect(() => () => onlineRoomRef.current?.close(), []);

  useEffect(() => {
    if (!room || roomTransport !== "online" || !isHost || createdOnlineRoomRef.current !== room.code) return;
    const setup = pendingRoomSetupRef.current;
    const mix = normalizeArtistWordMix(setup?.wordMix ?? roomWordMix, activeCommunityPacks);
    onlineRoomRef.current?.sendWordMix(mix, getWordMixPackSnapshots(mix, activeCommunityPacks, wordFeedback));
    onlineRoomRef.current?.sendRoomSettings({
      maxPlayers: setup?.maxPlayers ?? 8,
      roundsPerPlayer: setup?.roundsPerPlayer ?? 3,
      roundSeconds: setup?.roundSeconds ?? 90,
    });
    pendingRoomSetupRef.current = null;
    createdOnlineRoomRef.current = null;
  }, [activeCommunityPacks, isHost, room, roomTransport, roomWordMix, wordFeedback]);


  useEffect(() => {
    roomRoundRef.current = { phase: room?.phase ?? "", turnIndex: room?.turnIndex ?? -1 };
  }, [room?.phase, room?.turnIndex]);

  useEffect(() => {
    roomTransportRef.current = roomTransport;
  }, [roomTransport]);

  useEffect(() => {
    if (roomTransport !== "local" || !twitchSession.authenticated) return;
    const closeLiveEvents = connectLiveEvents((event) => {
      if (roomTransportRef.current === "online") return;
      if (event.type === "round-started" && roomRoundRef.current.phase === "drawing") {
        activeTwitchRoundIdRef.current = event.payload.roundId;
      }
      if (event.type === "correct-guess" && event.payload.roundId === activeTwitchRoundIdRef.current) {
        setTwitchSolvers((current) => current.some((viewer) => viewer.userId === event.payload.solver.userId)
          ? current
          : [...current, event.payload.solver]);
      }
    });
    return () => {
      closeLiveEvents();
    };
  }, [roomTransport, twitchSession.authenticated, twitchSession.user?.id]);

  useEffect(() => {
    setTwitchSolvers([]);
    setTwitchNotice("");
    activeTwitchRoundIdRef.current = null;
  }, [room?.code, room?.turnIndex]);

  useEffect(() => {
    if (roomTransport === "online") return;
    if (!room || room.phase !== "drawing" || !isDrawer || !roomAnswerText || !twitchLive) return;
    const roundKey = `${room.code}:${room.turnIndex}`;
    if (startedTwitchRoundKeyRef.current === roundKey) return;
    startedTwitchRoundKeyRef.current = roundKey;
    setTwitchNotice("");
    void startServerRound(roomAnswerText, 100, room.answer?.aliases ?? [], false)
      .then(({ roundId }) => {
        if (startedTwitchRoundKeyRef.current !== roundKey || roomRoundRef.current.phase !== "drawing") {
          void endServerRound();
          return;
        }
        activeTwitchRoundIdRef.current = roundId;
        setTwitchNotice("");
      })
      .catch((error) => {
        if (startedTwitchRoundKeyRef.current === roundKey) startedTwitchRoundKeyRef.current = null;
        setTwitchNotice(error instanceof Error ? error.message : "Twitch guesses could not start.");
      });
  }, [isDrawer, room, roomAnswerText, roomTransport, twitchLive]);

  useEffect(() => {
    if (roomTransport === "online") return;
    if (room?.phase === "drawing" || !startedTwitchRoundKeyRef.current) return;
    startedTwitchRoundKeyRef.current = null;
    activeTwitchRoundIdRef.current = null;
    void endServerRound().catch(() => undefined);
  }, [room?.phase, roomTransport]);

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
      setRoom(normalizeRoomState(JSON.parse(event.newValue)));
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
    const guessers = roomPlayers.filter((player) => player.id !== room.drawerId);
    if (guessers.length > 0 && roomSolved.length >= guessers.length) {
      saveRoom({ ...room, phase: "results", endAt: null });
    }
  }, [isHost, room, roomPlayers, roomSolved.length, roomTransport]);

  useEffect(() => {
    if (room?.phase === "results") {
      setResultsEndAt((current) => current ?? (Date.now() + 10000));
    } else {
      setResultsEndAt(null);
    }
  }, [room?.phase, room?.turnIndex]);

  useEffect(() => {
    if (room?.phase === "finished") setFinishedSummaryDismissed(false);
  }, [room?.phase, room?.turnIndex]);

  useEffect(() => {
    if (room?.phase === "choosing" || room?.phase === "drawing") {
      setCurrentRoundRating(null);
    }
  }, [room?.phase, room?.turnIndex]);

  useEffect(() => {
    if (roomTransport === "online") return;
    if (!room || !isHost || room.phase !== "results" || !resultsEndAt) return;
    if (Date.now() >= resultsEndAt) {
      advanceTurn(room);
    }
  }, [advanceTurn, isHost, resultsEndAt, room, roomTransport, timerNow]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [roomGuesses.length]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = resizeStateRef.current;
      if (!resize) return;
      const delta = event.clientX - resize.startX;
      if (resize.panel === "source") {
        const snapped = snapDockRailWidth(Math.max(260, Math.min(520, resize.startWidth + delta)), SOURCE_RAIL_SNAP_POINTS);
        const nextWidth = snapped.width;
        resize.element.classList.toggle("divider-snap", snapped.snapped);
        resizeDockBoundary("right", resize.lastWidth, nextWidth);
        resize.lastWidth = nextWidth;
        setSourceRailWidth(nextWidth);
      } else {
        const snapped = snapDockRailWidth(Math.max(250, Math.min(460, resize.startWidth - delta)), SIDE_RAIL_SNAP_POINTS);
        const nextWidth = snapped.width;
        resize.element.classList.toggle("divider-snap", snapped.snapped);
        resizeDockBoundary("left", resize.lastWidth, nextWidth);
        resize.lastWidth = nextWidth;
        setSidePanelWidth(nextWidth);
      }
    };
    const stopResize = () => {
      resizeStateRef.current?.element.classList.remove("divider-snap");
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
      element: event.currentTarget,
      panel,
      startX: event.clientX,
      startWidth: panel === "source" ? sourceRailWidth : sidePanelWidth,
      lastWidth: panel === "source" ? sourceRailWidth : sidePanelWidth,
    };
    document.body.classList.add("resizing-panels");
  };

  const startGame = () => {
    if (!room || !isHost || roomPlayers.length < 2) return;
    const drawerId = roomPlayers[0]?.id ?? null;
    const choices = pickRoomChoices(room.wordMix, [...room.recentPromptKeys, ...room.recentChoiceKeys], 3, activeCommunityPacks, wordFeedback);
    if (roomTransport === "online") {
      onlineRoomRef.current?.sendStartGame();
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
      recentChoiceKeys: [...room.recentChoiceKeys, ...choices.map(roomPromptKey)].slice(-32),
      choiceVotes: {},
      guesses: [],
      solved: [],
      players: roomPlayers.map((player) => ({ ...player, score: 0 })),
    });
    setNotice("Game started. Players are voting on the word.");
  };

  useLocalRoomTestBots(room, saveRoom);

  useEffect(() => {
    if (!room?.testBots || room.visibility !== "public" || roomTransport !== "local" || !isHost || room.phase !== "lobby" || connectedRoomPlayers.length < 2) {
      localBotAutoStartRef.current = null;
      return;
    }
    const key = `${room.code}:${connectedRoomPlayers.length}`;
    if (localBotAutoStartRef.current === key) return;
    localBotAutoStartRef.current = key;
    const timer = window.setTimeout(startGame, 1800);
    return () => window.clearTimeout(timer);
  }, [connectedRoomPlayers.length, isHost, room?.code, room?.phase, room?.testBots, room?.visibility, roomTransport]);

  const getWinningChoiceIndex = (votes: Record<string, number>) => {
    if (!roomChoices.length) return -1;
    const counts = roomChoices.map((_, index) => Object.values(votes).filter((vote) => vote === index).length);
    return counts.reduce((bestIndex, count, index) => count > counts[bestIndex] ? index : bestIndex, 0);
  };

  const voteForChoice = (choiceIndex: number) => {
    if (!room || room.phase !== "choosing" || isDrawer || !localPlayer || !roomChoices[choiceIndex]) return;
    if (roomTransport === "online") {
      onlineRoomRef.current?.sendChoiceVote(choiceIndex);
      return;
    }
    const nextVotes = { ...(room.choiceVotes ?? {}), [localPlayer.id]: choiceIndex };
    const eligibleVoters = roomPlayers.filter((player) => player.id !== room.drawerId);
    const votedCount = Object.keys(nextVotes).filter((playerId) => eligibleVoters.some((player) => player.id === playerId)).length;
    const winningIndex = getWinningChoiceIndex(nextVotes);
    const winningChoice = roomChoices[winningIndex];
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
    if (!roomAnswerText) return;
    const aliases = [roomAnswerText, ...(room.answer.aliases ?? [])].map(normalizeGuess);
    const correct = aliases.includes(normalizeGuess(text));
    const alreadySolved = roomSolved.some((item) => item.playerId === localPlayer.id);
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
      guesses: [...roomGuesses.slice(-30), guessEntry],
      solved: correct && !alreadySolved
        ? [...roomSolved, { playerId: localPlayer.id, playerName: localPlayer.name, points, solvedAt: Date.now() }]
        : roomSolved,
      players: roomPlayers.map((player) => {
        if (player.id === localPlayer.id) return { ...player, score: player.score + points };
        if (player.id === room.drawerId) return { ...player, score: player.score + drawerBonus };
        return player;
      }),
    });
    setGuess("");
  };

  const syncDrawingOperations = useCallback((operations: DrawingOperation[]) => {
    if (roomTransport === "online" && isDrawer) onlineRoomRef.current?.sendDrawingOperations(operations);
  }, [isDrawer, roomTransport]);

  const syncLiveDrawingOperation = useCallback((operation: DrawingOperation | null) => {
    if (roomTransport === "online" && isDrawer) onlineRoomRef.current?.sendDrawingPreview(operation);
  }, [isDrawer, roomTransport]);

  const rateCurrentRoundWord = (rating: WordFeedbackRating) => {
    if (!room?.answer || !roomAnswerText || roomAnswerText.startsWith("Error:")) return;
    setCurrentRoundRating(rating);
    const target: WordFeedbackTarget = {
      answer: roomAnswerText,
      categoryId: room.answer.categoryId,
      difficulty: room.answer.difficulty,
    };
    const nextFeedback = recordWordFeedback(wordFeedback, target, rating);
    setWordFeedback(nextFeedback);
    if (roomTransport === "online" && isHost) {
      onlineRoomRef.current?.sendWordMix(activeRoomWordMix, getWordMixPackSnapshots(activeRoomWordMix, activeCommunityPacks, nextFeedback));
    }
  };

  return (
    <DockLayout panelIds={["room-players", "room-control", "room-support", "room-chat"]} slotIds={["room-left-1", "room-left-2", "room-right-1", "room-right-2"]} storageKey="room.dock.v2">
    <div className={`dashboard-layout room-mode-page ${room?.visibility === "public" ? "public-room-play" : "private-room-play"}`} style={{ "--source-rail-width": `${sourceRailWidth}px`, "--side-panel-width": `${sidePanelWidth}px` } as CSSProperties}>
      <aside className="stream-sidebar room-sidebar dock-rail" data-dock-boundary="right" aria-label="Room setup">
        <WorkspaceIdentity onModes={requestExitToHome} subtitle={room?.visibility === "public" ? "Public multiplayer" : hasApiBaseUrl ? "Private room" : "Local room fallback"} />
        <DockControls />
        <DockSlot id="room-left-1" />
        <DockSlot id="room-left-2" />

        <DockPanel id="room-players" label="players">
        <section className="source-card room-player-card">
          <header className="source-card-header">
            <div><span className="source-eyebrow">Players</span><h2>{room ? "Room lobby" : "No room"}</h2></div>
            <div className="room-player-header-actions">
              {room ? (
                <>
                  {room.visibility !== "public" ? <button className="room-panel-code-button" onClick={copyRoomCode} title="Copy room code" type="button"><span>{room.code}</span><span className="material-symbols-outlined">content_copy</span></button> : null}
                  <button className="room-panel-exit-button" onClick={() => leaveCurrentRoom(true)} title="Leave this room" type="button"><span className="material-symbols-outlined">logout</span><span>Exit room</span></button>
                </>
              ) : null}
              <span className="source-status">{roomPlayers.length}</span>
            </div>
          </header>
          <div className="room-player-list">
            {sortedPlayers.length ? sortedPlayers.map((player, index) => (
              <span className={`${player.id === room?.drawerId ? "drawer" : ""}${player.disconnectedAt ? " reconnecting" : ""}${isRoomTestBot(player.id) ? " bot-player" : ""}`} key={player.id}>
                <b><i>{index + 1}</i>{player.name}{isRoomTestBot(player.id) ? <em className="bot-tag">BOT</em> : null}</b>
                <small>{player.disconnectedAt ? "Reconnecting…" : player.id === room?.hostId ? `Host - ${player.score}` : player.id === room?.drawerId ? `Drawing - ${player.score}` : `${player.score} pts`}</small>
              </span>
            )) : <p>No players yet.</p>}
          </div>
        </section>
        </DockPanel>

        <DockPanel id="room-control" label="camera and word">
          <section className="source-card camera-source-card room-camera-card">
            <header className="source-card-header">
              <div><span className="source-eyebrow">Camera frame</span><h2>{isDrawer ? "Word panel" : "Drawer on camera"}</h2></div>
              <span className={`source-status ${room?.phase === "drawing" ? "ready" : ""}`}><i />{room?.phase === "drawing" ? "Round live" : room?.phase ?? roomConnectionStatus}</span>
            </header>
            <div className={`camera-preview ${room?.phase === "drawing" && isDrawer ? "source-selected round-prompt-visible" : "custom-word-position"}`}>
              {room?.phase === "drawing" && isDrawer && room.answer ? (
                <div className="camera-prompt-copy"><strong style={{ fontSize: Math.max(26, Math.min(60, 440 / Math.max(1, roomAnswerText.length))) + "px", lineHeight: 1.15 }}>{roomAnswerText}</strong></div>
              ) : (
                <div className="custom-word-card room-word-card">
                  <small className="camera-instruction">Keep this area covered by your camera in OBS</small>
                  <strong>{!room ? "Connecting to the table" : room.phase === "finished" && winner ? `${winner.name} wins` : room.phase === "choosing" ? "Players are voting" : room.visibility === "public" && room.phase === "lobby" ? connectedRoomPlayers.length < 2 ? "Waiting for public players" : "Match starting shortly" : "Waiting for the round"}</strong>
                  {room?.visibility !== "public" && isHost && (room?.phase === "lobby" || room?.phase === "finished") ? (
                    <button className="room-start-button room-lobby-start-button" disabled={roomPlayers.length < 2 || room.wordMixReady === false} onClick={startGame} type="button"><span className="material-symbols-outlined">play_arrow</span>{room.phase === "finished" ? "Start New Game" : "Start Game"}</button>
                  ) : null}
                  {!room ? <button className="room-start-button room-lobby-start-button" onClick={() => onNavigate("/room")} type="button"><span className="material-symbols-outlined">arrow_back</span>Choose a room</button> : null}
                </div>
              )}
            </div>
            {notice ? <p className="room-note">{notice}</p> : null}
          </section>
        </DockPanel>
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
            <ResizableSurface className="fixed-prompt-surface" label="guess bar" storageKey="room.guessBar.v2">
            <section className="prompt-board room-prompt-board">
              <div className="round-word-mask">
                {room?.answer?.mask ?? maskedAnswer(roomAnswerText || null)}
              </div>
            </section>
            </ResizableSurface>

            <ResizableSurface className="fixed-canvas-surface" label="drawing canvas" storageKey="room.canvas.v2">
            <section className="canvas-card room-canvas-card">
              <header className="room-canvas-header">
                <span className="room-round-indicator">Round {room ? Math.min(room.roundsPerPlayer, room.roundIndex + 1) : 1}/{room?.roundsPerPlayer ?? 3}</span>
                <div className="timer">
                  {`${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`}
                </div>
              </header>
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
              {room?.phase === "drawing" && !isDrawer ? (
                <div className="room-viewer-note">
                  <span className="material-symbols-outlined">visibility</span>
                  Watching {drawer?.name ?? "the drawer"} draw live.
                </div>
              ) : null}
            </section>
            </ResizableSurface>
          </div>

          <div aria-label="Resize room activity panel" aria-orientation="vertical" aria-valuemax={460} aria-valuemin={250} aria-valuenow={sidePanelWidth} className="layout-resizer side-panel-resizer" onPointerDown={(event) => startResize("side", event)} role="separator" />

          <aside className="side-column room-side-column dock-rail" data-dock-boundary="left" aria-label="Room activity">
            <DockSlot id="room-right-1" />
            <DockSlot id="room-right-2" />
            <DockPanel id="room-support" label={room?.visibility === "public" ? "public table" : "categories and Twitch"}>
            {room?.visibility === "public" ? (
              <section className="feed-card room-public-table-card">
                <header><span className="material-symbols-outlined">public</span><div><small>Public multiplayer</small><h3>Open table</h3></div><b>{connectedRoomPlayers.length}/{room.maxPlayers}</b></header>
                <div className="room-public-table-status"><i className={roomConnectionStatus === "connected" ? "live" : ""}/><span><strong>{roomConnectionStatus === "connected" ? "Matched and connected" : "Reconnecting to match"}</strong><small>{room.phase === "lobby" ? connectedRoomPlayers.length < 2 ? "Waiting for another player" : "Starting automatically" : `Game ${room.phase}`}</small></span></div>
                <div className="room-word-mix-summary"><span className="material-symbols-outlined">shuffle</span><div><small>Public Word Mix</small><strong>{displayedRoomWordMixLabel || "All General"}</strong><p>{displayedRoomWordCount.toLocaleString()} balanced prompts.</p></div></div>
                <p className="room-public-safety"><span className="material-symbols-outlined">health_and_safety</span>Keep chat friendly. Leave the table if another player makes the room uncomfortable.</p>
              </section>
            ) : <section className={`feed-card support-card room-category-card ${categoriesOpen || twitchPanelOpen ? "" : "collapsed"}`}>
              <div className="support-tabs" role="tablist" aria-label="Room categories and Twitch guesses">
                <button aria-expanded={categoriesOpen} aria-selected={categoriesOpen} className={categoriesOpen ? "active" : ""} onClick={() => { setCategoriesOpen((current) => !current); setTwitchPanelOpen(false); }} role="tab" type="button">
                  <span className="material-symbols-outlined">category</span>Word Mix
                  <span className="material-symbols-outlined">{categoriesOpen ? "expand_less" : "expand_more"}</span>
                </button>
                <button aria-expanded={twitchPanelOpen} aria-selected={twitchPanelOpen} className={twitchPanelOpen ? "active twitch" : "twitch"} onClick={() => { setTwitchPanelOpen((current) => !current); setCategoriesOpen(false); }} role="tab" type="button">
                  <span className="material-symbols-outlined">live_tv</span>Twitch chat
                  <span className={`room-twitch-live-dot ${twitchLive ? "live" : ""}`} aria-hidden="true" />
                </button>
              </div>
              {categoriesOpen ? <div className="support-panel-content category-panel" role="tabpanel">
                <div className="room-word-mix-summary">
                  <span className="material-symbols-outlined">shuffle</span>
                  <div><small>Current mix</small><strong>{displayedRoomWordMixLabel || "All General"}</strong><p>{displayedRoomWordCount.toLocaleString()} words balanced across the selected packs.</p></div>
                  <small className="room-word-mix-lock">Chosen before the room opened.</small>
                </div>
              </div> : null}
              {twitchPanelOpen ? (
                <div className="support-panel-content room-twitch-panel" role="tabpanel">
                  <header>
                    <div><strong>Correct from chat</strong>{showingTwitchPreview ? <small>Test preview</small> : roomTransport === "online" ? <small>via {room?.twitchOwnerName || "party leader"}</small> : null}</div>
                    <span className={`room-twitch-total ${twitchSolversForDisplay.length ? "live" : ""}`}><b>{twitchSolversForDisplay.length}</b><small>total</small></span>
                  </header>
                  <div className="room-twitch-solvers scrollable" aria-live="polite">
                    {twitchSolversForDisplay.length ? twitchSolversForDisplay.map((solver) => (
                      <div className="room-twitch-solver" key={solver.userId}>
                        <span>{solver.position <= 3 ? ["🥇", "🥈", "🥉"][solver.position - 1] : `#${solver.position}`}</span>
                        <strong>{solver.name}</strong>
                      </div>
                    )) : <p className="room-twitch-empty">No correct guesses yet</p>}
                  </div>
                  {twitchNotice ? <p className="room-twitch-notice">{twitchNotice}</p> : null}
                  {room?.twitchScoringConflict ? <p className="room-twitch-notice">Another browser or game controls this channel's live scoring.</p> : null}
                  {roomTransport === "online" && isHost && room?.twitchScoringConflict && room.phase === "drawing" ? (
                    <button className="room-twitch-action" onClick={() => {
                      if (window.confirm("End the other game's Twitch scoring round and take over here? Existing channel points and rewards will be kept.")) onlineRoomRef.current?.sendTwitchTakeover();
                    }} type="button">Take over Twitch scoring</button>
                  ) : null}
                  {roomTransport === "online" && !isHost && !twitchLive ? (
                    <p className="room-twitch-notice">The party leader needs to connect or reconnect Twitch.</p>
                  ) : !twitchSession.authenticated ? (
                    <p className="room-twitch-notice">Connect Twitch from the home profile.</p>
                  ) : !twitchLive ? (
                    <button className="room-twitch-action" onClick={() => { void reconnectTwitchChat().then(setTwitchSession).catch((error) => setTwitchNotice(error instanceof Error ? error.message : "Could not reconnect Twitch.")); }} type="button">
                      <span className="material-symbols-outlined">refresh</span>Reconnect chat
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>}
            </DockPanel>

            <DockPanel id="room-chat" label="room chat">
            <section className="feed-card room-guess-card">
              <div className="card-title"><h3><span className="material-symbols-outlined">forum</span>Room chat</h3><b>{roomGuesses.length}</b></div>
              <div className="room-guess-list scrollable" ref={chatScrollRef}>
                {roomGuesses.length ? roomGuesses.map((item) => (
                  <p className={item.correct ? "correct" : ""} key={item.id}><strong>{item.playerName}</strong>{item.correct ? "guessed correctly" : item.text}</p>
                )) : null}
              </div>
              <form className="room-guess-form" onSubmit={submitGuess}>
                <input disabled={!room || room.phase !== "drawing" || isDrawer} onChange={(event) => setGuess(event.target.value)} placeholder={isDrawer ? "Drawer cannot guess" : "Chat or guess..."} value={guess} />
                <button disabled={!guess.trim()} type="submit"><span className="material-symbols-outlined">send</span></button>
              </form>
            </section>
            </DockPanel>
          </aside>
        </section>
      </main>
      {room?.phase === "choosing" ? (
        <div className="room-choice-layer" role="presentation">
          <div className="room-choice-backdrop" />
          <section aria-label="Word vote" aria-modal="true" className="room-choice-dialog" role="dialog">
            <header className="room-choice-header">
              <span className="source-eyebrow">Word vote</span>
              <h2>{isDrawer ? "Words on the table" : "Pick a mystery slot"}</h2>
              <p>
                {isDrawer
                  ? "Players vote without seeing the words. The top slot becomes your drawing prompt."
                  : `${drawer?.name ?? "Drawer"} can see the words. You only choose a slot.`}
              </p>
            </header>
            <div className="room-choice-list" role="list">
              {roomChoices.map((choice, index) => {
                const voteCount = choiceVoteCounts[index] ?? 0;
                const selected = localChoiceVote === index;
                const categoryName = getRoomCategoryLabel(choice.categoryId);

                return (
                  <button
                    className={`room-choice-card ${selected ? "selected" : ""}`}
                    disabled={isDrawer || !localPlayer}
                    key={`${choice.categoryId}-${choice.answer}-${index}`}
                    onClick={() => voteForChoice(index)}
                    type="button"
                  >
                    <div className="room-choice-card-header">
                      <span className="room-choice-slot"><b>{index + 1}</b> Slot {index + 1}</span>
                      <span className="room-choice-category-tag">{categoryName}</span>
                    </div>

                    <div className="room-choice-word-container">
                      {isDrawer ? (
                        <strong className="room-choice-word">{choice.answer}</strong>
                      ) : (
                        <div className="room-choice-mystery-cover">
                          <span className="mystery-icon">?</span>
                          <small className="mystery-label">Mystery Word</small>
                        </div>
                      )}
                    </div>

                    <span className="room-choice-votes-badge">
                      <span className="material-symbols-outlined">how_to_vote</span>
                      {voteCount} vote{voteCount === 1 ? "" : "s"}
                    </span>
                    {selected ? <span aria-hidden="true" className="room-choice-selected-mark"><span className="material-symbols-outlined">check</span></span> : null}
                  </button>
                );
              })}
            </div>
            <footer className="room-choice-footer">
              <div className="room-choice-progress" style={{ "--vote-progress": `${eligibleChoiceVoters.length ? (submittedChoiceVotes / eligibleChoiceVoters.length) * 100 : 0}%` } as CSSProperties}>
                <span className="room-choice-progress-copy"><span className="material-symbols-outlined">groups</span><strong>{submittedChoiceVotes} of {eligibleChoiceVoters.length}</strong> players voted</span>
                <span aria-hidden="true" className="room-choice-progress-track"><span /></span>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
      {room?.phase === "results" ? (
        <div className="room-choice-layer room-results-layer" role="presentation">
          <div className="room-choice-backdrop" />
          <section aria-label="Round results" aria-modal="true" className="room-choice-dialog room-results-dialog" role="dialog">
            <header className="room-results-header">
              <span className="source-eyebrow">Round Over</span>
              <h2>The word was</h2>
              <div className="room-results-word-card">
                <span className="category-pill">{getRoomCategoryLabel(room.answer?.categoryId)}</span>
                <strong className="revealed-word">{roomAnswerText.toUpperCase()}</strong>
              </div>
            </header>
            <div className="room-results-body">
              <div className="room-results-feedback-bar">
                <span className="feedback-bar-title"><span className="material-symbols-outlined">reviews</span><span><strong>Rate this word</strong><small>How did this prompt play?</small></span></span>
                <div className="feedback-rating-pills">
                  <button
                    className={`rating-pill pill-good ${currentRoundRating === "very_good" ? "active" : ""}`}
                    onClick={() => rateCurrentRoundWord("very_good")}
                    title="Good word / fun to draw & guess"
                    type="button"
                  >
                    <span className="rating-dot dot-green" />
                    <span>Good</span>
                  </button>
                  <button
                    className={`rating-pill pill-mid ${currentRoundRating === "mid" ? "active" : ""}`}
                    onClick={() => rateCurrentRoundWord("mid")}
                    title="Okay / average word"
                    type="button"
                  >
                    <span className="rating-dot dot-yellow" />
                    <span>Mid</span>
                  </button>
                  <button
                    className={`rating-pill pill-bad ${currentRoundRating === "bad" ? "active" : ""}`}
                    onClick={() => rateCurrentRoundWord("bad")}
                    title="Bad / difficult or unenjoyable word"
                    type="button"
                  >
                    <span className="rating-dot dot-red" />
                    <span>Bad</span>
                  </button>
                </div>
              </div>

              <div className="room-results-scoreboard">
                <div className="room-results-score-list scrollable">
                  {sortedPlayers.map((player) => {
                    const solvedEntry = room.solved.find((s) => s.playerId === player.id);
                    const isPlayerDrawer = player.id === room.drawerId;
                    const solveRank = solvedEntry ? room.solved.findIndex((s) => s.playerId === player.id) + 1 : 0;
                    const roundPoints = solvedEntry
                      ? solvedEntry.points
                      : isPlayerDrawer
                        ? room.solved.length * 50
                        : 0;

                    return (
                      <div className={`room-results-player-item ${solvedEntry ? "solved" : isPlayerDrawer ? "drawer" : ""}`} key={player.id}>
                        <div className="player-meta">
                          <span className="player-rank-icon">
                            {isPlayerDrawer ? "🎨" : solveRank === 1 ? "🥇" : solveRank === 2 ? "🥈" : solveRank === 3 ? "🥉" : solvedEntry ? "✅" : "❌"}
                          </span>
                          <span className="player-name"><b>{player.name}</b><small>{isPlayerDrawer ? "Made the drawing" : solvedEntry ? `${solveRank}${solveRank === 1 ? "st" : solveRank === 2 ? "nd" : solveRank === 3 ? "rd" : "th"} to solve` : "Didn't solve"}</small></span>
                          {isPlayerDrawer && <small className="role-tag">Drawer</small>}
                        </div>
                        <div className="score-meta">
                          <span className={`round-gain ${roundPoints > 0 ? "gain-positive" : "gain-zero"}`}>
                            {roundPoints > 0 ? `+${roundPoints} pts` : "0 pts"}
                          </span>
                          <small className="total-badge">Total: {player.score} pts</small>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <footer className="room-results-footer">
              <span className="room-results-timer">
                <span className="material-symbols-outlined">timer</span>
                Next round in {resultsSecondsRemaining}s...
              </span>
              {isHost && (
                <button className="room-results-skip-button" onClick={() => advanceTurn(room)} type="button">
                  <span className="material-symbols-outlined">skip_next</span>Next Round Now
                </button>
              )}
            </footer>
          </section>
        </div>
      ) : null}
      {room?.phase === "finished" && !finishedSummaryDismissed ? (
        <div className="room-choice-layer room-finished-layer" role="presentation">
          <div className="room-choice-backdrop" />
          <section aria-label="Final standings" aria-modal="true" className="room-choice-dialog room-finished-dialog" role="dialog">
            <header className="room-finished-header">
              <span className="source-eyebrow">Game complete</span>
              <span aria-hidden="true" className="room-finished-trophy">🏆</span>
              <h2>{finishedTitle}</h2>
              <p>{room.roundsPerPlayer} round{room.roundsPerPlayer === 1 ? "" : "s"} per player completed</p>
            </header>
            <div className="room-finished-standings scrollable">
              {sortedPlayers.map((player, index) => {
                const tiedForFirst = player.score === winner?.score;
                return (
                  <div className={`room-finished-player ${tiedForFirst ? "winner" : ""}`} key={player.id}>
                    <span className="room-finished-rank">{tiedForFirst ? "🏆" : index + 1}</span>
                    <span className="room-finished-player-name"><b>{player.name}</b><small>{player.id === room.hostId ? "Party leader" : `Final place #${index + 1}`}</small></span>
                    <strong>{player.score}<small> pts</small></strong>
                  </div>
                );
              })}
            </div>
            <footer className="room-finished-actions">
              <button className="room-finished-room-button" onClick={() => setFinishedSummaryDismissed(true)} type="button">
                <span className="material-symbols-outlined">meeting_room</span>Back to room
              </button>
              {isHost ? (
                <button className="room-results-skip-button" disabled={room.wordMixReady === false} onClick={startGame} type="button">
                  <span className="material-symbols-outlined">replay</span>Play Again
                </button>
              ) : null}
            </footer>
          </section>
        </div>
      ) : null}
    </div>
    </DockLayout>
  );
}
