import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
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
import { hasApiBaseUrl } from "../apiUrls";
import {
  createClientId,
  createEmptyRoom,
  createRoomCode,
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

const DEFAULT_ROOM_CODE = "ROOM";
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
  const [roomCodeInput, setRoomCodeInput] = usePersistentState("room.lastCode", DEFAULT_ROOM_CODE);
  const [entryMode, setEntryMode] = useState<RoomEntryMode>("create");
  const [joinedCode, setJoinedCode] = useState("");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [roomTransport, setRoomTransport] = useState<"none" | "online" | "local">("none");
  const [roomConnectionStatus, setRoomConnectionStatus] = useState<"connecting" | "connected" | "offline">("offline");
  const [showRoomDetails, setShowRoomDetails] = useState(false);
  const [guess, setGuess] = useState("");
  const [customWord, setCustomWord] = useState("");
  const [customWordError, setCustomWordError] = useState("");
  const [notice, setNotice] = useState("Create or join a local room to test the flow.");
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [canvasColor, setCanvasColor] = usePersistentState("room.canvas.background", "#FFF2CF");
  const [gridSize, setGridSize] = usePersistentState("room.grid.size", 24);
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
    ? Math.max(0, Math.ceil((room.endAt - Date.now()) / 1000))
    : room?.roundSeconds ?? 90;
  const totalTurns = room ? Math.max(1, room.players.length) * room.roundsPerPlayer : 0;
  const currentTurnNumber = room && room.turnIndex >= 0 ? Math.min(totalTurns, room.turnIndex + 1) : 0;
  const winner = room?.phase === "finished" ? sortedPlayers[0] ?? null : null;

  const saveRoom = (nextRoom: RoomState) => {
    if (roomTransport === "online") {
      setRoom(nextRoom);
      return;
    }
    writeRoom(nextRoom);
    setRoom(nextRoom);
  };

  const joinRoom = (event?: FormEvent) => {
    event?.preventDefault();
    const code = entryMode === "create" ? createRoomCode() : normalizeRoomCode(roomCodeInput);
    if (!code) {
      setNotice("Enter a room code to join.");
      return;
    }
    const player = createPlayer(clientId, playerName);
    onlineRoomRef.current?.close();
    onlineRoomRef.current = null;
    if (hasApiBaseUrl) {
      setRoomCodeInput(code);
      setJoinedCode(code);
      setRoomTransport("online");
      setNotice(entryMode === "create" ? `Created online room ${code}.` : `Joining online room ${code}.`);
      onlineRoomRef.current = connectOnlineRoom(code, player.id, player.name, {
        onState: (nextRoom) => {
          setRoom(nextRoom);
          setNotice(`Online room ${nextRoom.code} is synced.`);
        },
        onStatus: setRoomConnectionStatus,
        onError: setNotice,
      });
      if (!onlineRoomRef.current) setNotice("Online room server is unavailable.");
      return;
    }
    const existing = readRoom(code);
    const nextRoom = existing
      ? {
        ...existing,
        players: existing.players.some((item) => item.id === player.id)
          ? existing.players.map((item) => item.id === player.id ? { ...item, name: player.name } : item)
          : [...existing.players, player],
      }
      : createEmptyRoom(code, player);
    setRoomCodeInput(code);
    setJoinedCode(code);
    setRoomTransport("local");
    saveRoom(nextRoom);
    setNotice(entryMode === "create" ? `Created room ${code}.` : existing ? `Joined room ${code}.` : `Created room ${code}.`);
  };

  useEffect(() => () => onlineRoomRef.current?.close(), []);

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
    onlineRoomRef.current?.sendChoices(pickRoomChoices(room.categorySelection, room.recentPromptKeys));
  }, [isHost, room, roomTransport]);

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
    const choices = pickRoomChoices(room.categorySelection, room.recentPromptKeys);
    if (roomTransport === "online") {
      onlineRoomRef.current?.sendStartGame(choices);
      setNotice("Game started. The first drawer is choosing a word.");
      return;
    }
    saveRoom({
      ...room,
      phase: "choosing",
      drawerId,
      turnIndex: 0,
      roundIndex: 0,
      roundsPerPlayer: 3,
      answer: null,
      choices,
      guesses: [],
      solved: [],
      players: room.players.map((player) => ({ ...player, score: 0 })),
    });
    setNotice("Game started. The first drawer is choosing a word.");
  };

  const startDrawingWithAnswer = (answer: CategoryPrompt) => {
    if (!room || !isDrawer || room.phase !== "choosing") return;
    if (!answer) return;
    if (roomTransport === "online") {
      onlineRoomRef.current?.sendChosenWord(answer);
      return;
    }
    saveRoom({
      ...room,
      phase: "drawing",
      answer,
      guesses: [],
      solved: [],
      endAt: Date.now() + room.roundSeconds * 1000,
      recentPromptKeys: [...room.recentPromptKeys, roomPromptKey(answer)].slice(-32),
    });
  };

  const chooseWord = (choiceIndex: number) => {
    const answer = room?.choices[choiceIndex];
    if (answer) startDrawingWithAnswer(answer);
  };

  const submitCustomWord = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!room || !isDrawer || room.phase !== "choosing") return;
    const answer = customWord.trim().slice(0, 60);
    if (!answer) {
      setCustomWordError("Enter a word or phrase first.");
      return;
    }
    setCustomWord("");
    setCustomWordError("");
    startDrawingWithAnswer({ answer, aliases: [], categoryId: "custom" });
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
      saveRoom({ ...room, phase: "finished", answer: null, choices: [], drawerId: null, endAt: null });
      return;
    }
    saveRoom({
      ...room,
      phase: "choosing",
      ...next,
      answer: null,
      choices: pickRoomChoices(room.categorySelection, room.recentPromptKeys),
      guesses: [],
      solved: [],
      endAt: null,
    });
  };

  const syncDrawingOperations = (operations: DrawingOperation[]) => {
    if (roomTransport === "online" && isDrawer) onlineRoomRef.current?.sendDrawingOperations(operations);
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
        <WorkspaceIdentity connected={roomConnectionStatus === "connected"} configured={hasApiBaseUrl} displayName={playerName} onModes={() => onNavigate("/")} returnTo="/room" subtitle={hasApiBaseUrl ? "Online room beta" : "Local room fallback"} />

        <section className="source-card room-player-card">
          <header className="source-card-header"><div><span className="source-eyebrow">Players</span><h2>{room?.code ?? "No room"}</h2></div><span className="source-status">{room?.players.length ?? 0}</span></header>
          <div className="room-player-list">
            {sortedPlayers.length ? sortedPlayers.map((player, index) => (
              <span className={player.id === room?.drawerId ? "drawer" : ""} key={player.id}>
                <b><i>{index + 1}</i>{player.name}</b>
                <small>{player.id === room?.hostId ? `Host - ${player.score}` : player.id === room?.drawerId ? `Drawing - ${player.score}` : `${player.score} pts`}</small>
              </span>
            )) : <p>No players yet.</p>}
          </div>
          {room && isHost && (room.phase === "lobby" || room.phase === "finished") ? (
            <button className="room-start-button" disabled={room.players.length < 2} onClick={startGame} type="button">
              <span className="material-symbols-outlined">play_arrow</span>{room.phase === "finished" ? "Start New Game" : "Start Game"}
            </button>
          ) : null}
        </section>

        {!room ? (
          <section className="source-card room-join-card">
            <header className="source-card-header"><div><span className="source-eyebrow">Room desk</span><h2>{entryMode === "create" ? "Create a room" : "Join a room"}</h2></div><span className="source-status ready"><i />{hasApiBaseUrl ? "Online" : "Local"}</span></header>
            <form className="room-join-form" onSubmit={joinRoom}>
              <div className="room-entry-toggle" role="group" aria-label="Create or join a room">
                <button className={entryMode === "create" ? "active" : ""} onClick={() => setEntryMode("create")} type="button">
                  <span className="material-symbols-outlined">add_circle</span>Create room
                </button>
                <button className={entryMode === "join" ? "active" : ""} onClick={() => setEntryMode("join")} type="button">
                  <span className="material-symbols-outlined">login</span>Join room
                </button>
              </div>
              <label><span>Name</span><input maxLength={20} onChange={(event) => setPlayerName(event.target.value)} value={playerName} /></label>
              {entryMode === "join" ? (
                <label><span>Room code</span><input autoComplete="off" maxLength={6} onChange={(event) => setRoomCodeInput(normalizeRoomCode(event.target.value))} placeholder="ENTER CODE" value={roomCodeInput} /></label>
              ) : (
                <div className="room-code-preview">
                  <span className="material-symbols-outlined">tag</span>
                  <p><strong>Code generated after create</strong><small>Share it from Room details once you are inside.</small></p>
                </div>
              )}
              <button type="submit"><span className="material-symbols-outlined">{entryMode === "create" ? "add_circle" : "login"}</span>{entryMode === "create" ? "Create room" : "Join room"}</button>
            </form>
            <p className="room-note">{notice}</p>
          </section>
        ) : (
          <section className="source-card camera-source-card room-camera-card">
            <header className="source-card-header">
              <div>
                <span className="source-eyebrow">Camera frame</span>
                <h2>{showRoomDetails ? "Room details" : isDrawer ? "Your secret word" : "Drawer on camera"}</h2>
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
                  <small className="camera-instruction">Share this code with friends</small>
                  <strong>{room.code}</strong>
                  <span className="room-note">{hasApiBaseUrl ? "Online room" : "Local fallback"} - {roomConnectionStatus}</span>
                  <div className="room-details-list">
                    <span><b>Players</b><strong>{room.players.length}</strong></span>
                    <span><b>Round</b><strong>{Math.min(3, room.roundIndex + 1)}/3</strong></span>
                    <span><b>Turn</b><strong>{currentTurnNumber}/{totalTurns || "?"}</strong></span>
                    <span><b>Leader</b><strong>{room.players.find((player) => player.id === room.hostId)?.name ?? "Host"}</strong></span>
                  </div>
                </div>
              ) : room.phase === "drawing" && isDrawer && room.answer ? (
                <div className="camera-prompt-copy">
                  <strong style={{ fontSize: Math.max(26, Math.min(60, 440 / Math.max(1, room.answer.answer.length))) + "px", lineHeight: 1.15 }}>{room.answer.answer}</strong>
                </div>
              ) : room.phase === "choosing" && isDrawer ? (
                <div className="custom-word-card room-word-card">
                  <small className="camera-instruction">Keep this area covered by your camera in OBS</small>
                  <strong>Choose or use a custom word</strong>
                  <div className="room-camera-choice-list">
                    {room.choices.map((choice, index) => (
                      <button key={`${choice.categoryId}-${choice.answer}`} onClick={() => chooseWord(index)} type="button">{choice.answer}</button>
                    ))}
                  </div>
                  <form onSubmit={submitCustomWord}>
                    <input
                      aria-label="Custom room word or phrase"
                      autoComplete="off"
                      maxLength={60}
                      onChange={(event) => {
                        setCustomWord(event.target.value);
                        if (customWordError) setCustomWordError("");
                      }}
                      placeholder="Type a secret word..."
                      type="text"
                      value={customWord}
                    />
                    <button type="submit">Use now</button>
                  </form>
                  {customWordError ? <span className="custom-word-error">{customWordError}</span> : null}
                </div>
              ) : (
                <div className="custom-word-card room-word-card">
                  <small className="camera-instruction">Keep this area covered by your camera in OBS</small>
                  <strong>{room.phase === "finished" && winner ? `${winner.name} wins` : room.phase === "choosing" ? `${drawer?.name ?? "Drawer"} is choosing` : "Waiting for the round"}</strong>
                  <span className="room-note">{room.phase === "finished" && winner ? `${winner.score} points after 3 rounds.` : `Round ${room.roundIndex + 1}/3 - Turn ${currentTurnNumber}/${totalTurns || "?"}`}</span>
                </div>
              )}
            </div>
          </section>
        )}
      </aside>

      <div aria-label="Resize room setup panel" aria-orientation="vertical" aria-valuemax={520} aria-valuemin={260} aria-valuenow={sourceRailWidth} className="layout-resizer source-rail-resizer" onPointerDown={(event) => startResize("source", event)} role="separator" />

      <main className="dashboard-shell room-shell">
        <section className="dashboard-grid room-grid">
          <div className="main-column room-main-column">
            <section className="prompt-board room-prompt-board">
              <div className="round-word-mask">
                {room?.phase === "drawing" && isDrawer ? room.answer?.answer.toUpperCase() : maskedAnswer(room?.answer?.answer ?? null)}
              </div>
              <span className="prompt-solve-count">{room?.phase ?? "offline"}</span>
            </section>

            <section className="canvas-card room-canvas-card">
              <header className="room-canvas-header">
                <div className="timer">
                  {`${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`}
                </div>
              </header>
              {room?.phase === "choosing" ? (
                <div className="room-choice-board">
                  <span className="source-eyebrow">Word choice</span>
                  <h2>{isDrawer ? "Pick from the camera panel" : `${drawer?.name ?? "Drawer"} is choosing`}</h2>
                </div>
              ) : (
                <ExcalidrawStage
                  canvasColor={canvasColor}
                  gridSize={gridSize}
                  hoverMenuDelay={500}
                  hoverMenusEnabled
                  onCanvasColorChange={setCanvasColor}
                  onGridSizeChange={setGridSize}
                  shortcuts={DEFAULT_KEYBOARD_SHORTCUTS}
                  externalOperations={room?.drawingOperations}
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
    </div>
  );
}
