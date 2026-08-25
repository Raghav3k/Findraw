import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ExcalidrawStage } from "../canvas/ExcalidrawStage";
import { StreamSourceSidebar, type ChatMessage } from "./StreamSourceSidebar";
import { SupportPanel } from "./SupportPanel";
import { twitchAuthStartUrl } from "../apiUrls";
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  type ShortcutAction,
} from "./keyboardShortcuts";
import { usePersistentState } from "../ui/usePersistentState";
import { DockLayout, DockPanel, DockSlot, ResizableSurface } from "../ui/DockLayout";
import { resizeDockBoundary } from "../ui/dockRailResize";
import {
  adjustViewerPoints,
  disconnectTwitch,
  endServerRound,
  fetchLeaderboard,
  fetchTwitchSession,
  connectLiveEvents,
  startServerRound,
  type LeaderboardEntry,
  type SolvedViewer,
  type TwitchSession,
} from "../twitch/twitchApi";
import {
  DEFAULT_WORD_SECONDS,
  MAX_CORRECT_GUESSERS,
  RANDOM_CATEGORY,
  getPromptKey,
  pickNextPrompt,
  removeCategorySelectionChip,
  toggleCategorySelectionOption,
  type CategoryPrompt,
  type CategorySelection,
} from "./gameData";
import { WordFeedbackModal } from "../feedback/WordFeedbackModal";
import {
  recordWordFeedback,
  shouldPromptForWordFeedback,
  type WordFeedbackContext,
  type WordFeedbackMap,
  type WordFeedbackRating,
  type WordFeedbackTarget,
} from "../feedback/wordFeedback";

type RoundStatus = "idle" | "playing" | "ended";
type RevealMode = "random" | "sequence";

type ResizeState = {
  panel: "source" | "side";
  startX: number;
  startWidth: number;
  lastWidth: number;
};

const mixChannel = (start: number, end: number, amount: number) => Math.round(start + (end - start) * amount);
const mixColor = (start: [number, number, number], end: [number, number, number], amount: number) => (
  `rgb(${mixChannel(start[0], end[0], amount)}, ${mixChannel(start[1], end[1], amount)}, ${mixChannel(start[2], end[2], amount)})`
);

const getPromptBoardColor = (correctGuesses: number, target: number) => {
  const progress = Math.min(1, correctGuesses / Math.max(1, target));
  const orange: [number, number, number] = [255, 225, 175];
  const green: [number, number, number] = [193, 225, 193];
  return mixColor(orange, green, progress);
};


type DashboardProps = { onNavigate: (path: string) => void };

export function Dashboard({ onNavigate }: DashboardProps) {
  const [sourceRailWidth, setSourceRailWidth] = usePersistentState("layout.sourceRailWidth", 380);
  const [sidePanelWidth, setSidePanelWidth] = usePersistentState("layout.sidePanelWidth", 280);
  const [canvasColor, setCanvasColor] = usePersistentState("canvas.background", "#FFF2CF");
  const [gridSize, setGridSize] = usePersistentState("grid.size", 24);
  const [hoverMenusEnabled, setHoverMenusEnabled] = usePersistentState("hover.enabled", true);
  const [hoverMenuDelay, setHoverMenuDelay] = usePersistentState("hover.delay", 500);
  const [shortcuts, setShortcuts] = usePersistentState("keyboard.shortcuts", { ...DEFAULT_KEYBOARD_SHORTCUTS });
  const [wordDurationSeconds, setWordDurationSeconds] = usePersistentState("round.wordDuration", DEFAULT_WORD_SECONDS);
  const [autoRevealSeconds, setAutoRevealSeconds] = usePersistentState("round.autoRevealInterval", 30);
  const [revealMode, setRevealMode] = usePersistentState<RevealMode>("round.revealMode", "random");
  const [correctGuessTarget, setCorrectGuessTarget] = usePersistentState("round.correctGuessTarget", 10);
  const [revealAnswerOnTimeout, setRevealAnswerOnTimeout] = usePersistentState("round.revealOnTimeout", true);
  const [testBotsEnabled, setTestBotsEnabled] = usePersistentState("round.testBotsEnabled", true);
  const [selectedCategoryId, setSelectedCategoryId] = usePersistentState<CategorySelection>("round.category", "domain:general");
  const [wordFeedback, setWordFeedback] = usePersistentState<WordFeedbackMap>("feedback.artist.words", {});
  const [roundStatus, setRoundStatus] = useState<RoundStatus>("idle");
  const [currentPrompt, setCurrentPrompt] = useState<CategoryPrompt>(() => pickNextPrompt(selectedCategoryId, [], { feedback: wordFeedback, mode: "artist" }));
  const [feedbackTarget, setFeedbackTarget] = useState<WordFeedbackTarget | null>(null);
  const [feedbackContext, setFeedbackContext] = useState<WordFeedbackContext>("experience");
  const feedbackRoundsSinceAutoRef = useRef(0);
  const pendingFeedbackActionRef = useRef<(() => void) | null>(null);
  const roundStartTimeRef = useRef(Date.now());
  const strokeCountRef = useRef(0);
  const recentPromptKeysRef = useRef<string[]>([getPromptKey(currentPrompt)]);
  const [secondsRemaining, setSecondsRemaining] = useState(wordDurationSeconds);
  const [revealedLetters, setRevealedLetters] = useState<number[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [solvedViewers, setSolvedViewers] = useState<SolvedViewer[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [twitchSession, setTwitchSession] = useState<TwitchSession>({
    configured: false,
    authenticated: false,
    eventSubStatus: "disconnected",
    user: null,
  });
  const [connectionNotice, setConnectionNotice] = useState("");
  const activeRoundIdRef = useRef<string | null>(null);
  const [roundSettingsOpen, setRoundSettingsOpen] = useState(false);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const roundSettingsRef = useRef<HTMLDivElement | null>(null);
  const roundActive = roundStatus === "playing";

  useEffect(() => {
    try {
      const migrationKey = "findraw.migrations.white-canvas-v2";
      if (window.localStorage.getItem(migrationKey)) return;
      if (canvasColor.toUpperCase() === "#FBEFD7") setCanvasColor("#FFFFFF");
      window.localStorage.setItem(migrationKey, "1");
    } catch {
      // Keep the current session usable when storage is unavailable.
    }
  }, [canvasColor, setCanvasColor]);

  useEffect(() => {
    try {
      const migrationKey = "findraw.migrations.cream-canvas-v3";
      if (window.localStorage.getItem(migrationKey)) return;
      if (["#FFFFFF", "#FBEFD7"].includes(canvasColor.toUpperCase())) {
        setCanvasColor("#FFF2CF");
      }
      window.localStorage.setItem(migrationKey, "1");
    } catch {
      // Keep the current session usable when storage is unavailable.
    }
  }, [canvasColor, setCanvasColor]);

  const maskedPrompt = roundStatus === "idle"
    ? "_ _ _ _ _"
    : Array.from(currentPrompt.answer)
      .map((character, index) => {
        if (character === " ") return "\u00a0\u00a0";
        return revealedLetters.includes(index) ? character.toUpperCase() : "_";
      })
      .join(" ");
  const formattedTime = `${Math.floor(secondsRemaining / 60).toString().padStart(2, "0")}:${(secondsRemaining % 60).toString().padStart(2, "0")}`;
  const promptBoardColor = getPromptBoardColor(solvedViewers.length, correctGuessTarget);

  const revealAllLetters = useCallback(() => {
    setRevealedLetters(Array.from(currentPrompt.answer)
      .map((character, index) => character === " " ? -1 : index)
      .filter((index) => index >= 0));
  }, [currentPrompt.answer]);

  const revealLetterByMode = useCallback(() => {
    setRevealedLetters((current) => {
      const availableLetters = Array.from(currentPrompt.answer)
        .map((character, index) => character === " " || current.includes(index) ? -1 : index)
        .filter((index) => index >= 0);
      if (availableLetters.length === 0) return current;
      const nextIndex = revealMode === "random"
        ? availableLetters[Math.floor(Math.random() * availableLetters.length)]
        : availableLetters[0];
      return [...current, nextIndex];
    });
  }, [currentPrompt.answer, revealMode]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = resizeStateRef.current;
      if (!resize) return;
      const delta = event.clientX - resize.startX;
      if (resize.panel === "source") {
        const nextWidth = Math.max(280, Math.min(520, resize.startWidth + delta));
        resizeDockBoundary("right", resize.lastWidth, nextWidth);
        resize.lastWidth = nextWidth;
        setSourceRailWidth(nextWidth);
      } else {
        const nextWidth = Math.max(230, Math.min(420, resize.startWidth - delta));
        resizeDockBoundary("left", resize.lastWidth, nextWidth);
        resize.lastWidth = nextWidth;
        setSidePanelWidth(nextWidth);
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

  useEffect(() => {
    if (!roundSettingsOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!roundSettingsRef.current?.contains(event.target as Node)) setRoundSettingsOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePress);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [roundSettingsOpen]);

  useEffect(() => {
    if (roundStatus === "idle") setSecondsRemaining(wordDurationSeconds);
  }, [roundStatus, wordDurationSeconds]);

  useEffect(() => {
    if (!roundActive) return;
    const timer = window.setInterval(() => {
      setSecondsRemaining((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [roundActive]);

  useEffect(() => {
    if (!roundActive || secondsRemaining > 0) return;
    if (revealAnswerOnTimeout) revealAllLetters();
    void endServerRound();
    setRoundStatus("ended");
  }, [revealAllLetters, revealAnswerOnTimeout, roundActive, secondsRemaining]);

  useEffect(() => {
    if (!roundActive) return;
    const timer = window.setInterval(revealLetterByMode, autoRevealSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRevealSeconds, revealLetterByMode, roundActive, currentPrompt.answer]);

  useEffect(() => {
    if (roundActive && solvedViewers.length >= correctGuessTarget) {
      revealAllLetters();
      void endServerRound();
      setRoundStatus("ended");
    }
  }, [correctGuessTarget, revealAllLetters, roundActive, solvedViewers.length]);

  useEffect(() => {
    let active = true;
    Promise.all([fetchTwitchSession(), fetchLeaderboard()])
      .then(([session, entries]) => {
        if (!active) return;
        setTwitchSession(session);
        setLeaderboard(entries);
      })
      .catch((error: Error) => {
        if (active) setConnectionNotice(`Local server unavailable: ${error.message}`);
      });

    const disconnectLiveEvents = connectLiveEvents((event) => {
      if (event.type === "twitch-session") setTwitchSession(event.payload);
      if (event.type === "chat-message") {
        setChatMessages((current) => [...current.slice(-49), event.payload]);
      }
      if (event.type === "correct-guess" && event.payload.roundId === activeRoundIdRef.current) {
        setSolvedViewers((current) => current.some((viewer) => viewer.userId === event.payload.solver.userId)
          ? current
          : [...current, event.payload.solver]);
      }
      if (event.type === "leaderboard") setLeaderboard(Array.isArray(event.payload) ? event.payload : []);
      if (event.type === "round-started") activeRoundIdRef.current = event.payload.roundId;
      if (event.type === "round-ended" && event.payload.roundId === activeRoundIdRef.current) {
        setRoundStatus("ended");
      }
    }, () => {
      setTwitchSession((current) => current.authenticated
        ? { ...current, eventSubStatus: "reconnecting" }
        : current);
    });
    return () => {
      active = false;
      disconnectLiveEvents();
    };
  }, []);

  const rememberPrompt = (prompt: CategoryPrompt) => {
    recentPromptKeysRef.current = [...recentPromptKeysRef.current, getPromptKey(prompt)].slice(-24);
    return prompt;
  };

  const chooseNextPrompt = (selection: CategorySelection = selectedCategoryId) => {
    return rememberPrompt(pickNextPrompt(selection, recentPromptKeysRef.current, { feedback: wordFeedback, mode: "artist" }));
  };

  const openWordFeedback = (prompt: CategoryPrompt = currentPrompt) => {
    if (prompt.categoryId === "custom" || prompt.answer.startsWith("Error:")) return;
    setFeedbackContext("experience");
    setFeedbackTarget({
      answer: prompt.answer,
      categoryId: prompt.categoryId,
      difficulty: prompt.difficulty,
    });
  };

  const submitWordFeedback = (rating: WordFeedbackRating | "skip") => {
    if (!feedbackTarget) return;
    setWordFeedback((current) => recordWordFeedback(current, feedbackTarget, rating));
    setFeedbackTarget(null);
    const pendingAction = pendingFeedbackActionRef.current;
    pendingFeedbackActionRef.current = null;
    pendingAction?.();
  };

  const closeWordFeedback = () => {
    setFeedbackTarget(null);
    const pendingAction = pendingFeedbackActionRef.current;
    pendingFeedbackActionRef.current = null;
    pendingAction?.();
  };

  const maybeOpenAutomaticFeedback = (prompt: CategoryPrompt = currentPrompt, afterFeedback?: () => void) => {
    if (prompt.categoryId === "custom" || prompt.answer.startsWith("Error:")) return false;
    feedbackRoundsSinceAutoRef.current += 1;
    const target: WordFeedbackTarget = {
      answer: prompt.answer,
      categoryId: prompt.categoryId,
      difficulty: prompt.difficulty,
    };
    const durationSeconds = Math.max(0, (Date.now() - roundStartTimeRef.current) / 1000);
    const strokeCount = strokeCountRef.current;
    const chatSolved = solvedViewers.length >= correctGuessTarget;

    if (!shouldPromptForWordFeedback(wordFeedback, target, feedbackRoundsSinceAutoRef.current, {
      durationSeconds,
      strokeCount,
      chatSolved,
      didSkip: false,
      instantSkip: false,
    })) return false;

    feedbackRoundsSinceAutoRef.current = 0;
    pendingFeedbackActionRef.current = afterFeedback ?? null;
    setFeedbackContext("experience");
    setFeedbackTarget(target);
    return true;
  };

  const preparePrompt = (prompt: CategoryPrompt) => {
    setCurrentPrompt(prompt);
    setRevealedLetters([]);
    setChatMessages([]);
    setSolvedViewers([]);
    setSecondsRemaining(wordDurationSeconds);
  };

  const beginPrompt = async (prompt: CategoryPrompt) => {
    activeRoundIdRef.current = null;
    roundStartTimeRef.current = Date.now();
    strokeCountRef.current = 0;
    preparePrompt(prompt);
    setRoundStatus("playing");
    if (!twitchSession.authenticated || twitchSession.eventSubStatus !== "connected") {
      setConnectionNotice(twitchSession.configured
        ? "Started locally. Connect Twitch when you want live chat guesses."
        : "Started locally. Twitch backend setup is unavailable.");
      return;
    }
    try {
      const { roundId } = await startServerRound(prompt.answer, Math.max(1, Number(correctGuessTarget) || 1), prompt.aliases, testBotsEnabled);
      activeRoundIdRef.current = roundId;
      setConnectionNotice("");
    } catch (error) {
      setConnectionNotice(error instanceof Error ? `Started locally. Live chat could not start: ${error.message}` : "Started locally. Live chat could not start.");
    }
  };

  const startRound = () => {
    const prompt = roundStatus === "ended" ? chooseNextPrompt() : currentPrompt;
    void beginPrompt(prompt);
  };

  const skipWord = () => {
    if (roundActive) {
      void endServerRound();
      setRoundStatus("ended");

      const prompt = currentPrompt;
      const target: WordFeedbackTarget = {
        answer: prompt.answer,
        categoryId: prompt.categoryId,
        difficulty: prompt.difficulty,
      };
      const durationSeconds = Math.max(0, (Date.now() - roundStartTimeRef.current) / 1000);
      const strokeCount = strokeCountRef.current;
      const isInstant = durationSeconds < 3 || strokeCount === 0;

      // Silently record skip in background so priority queue ranking stays accurate without UI spam
      if (target.categoryId !== "custom" && !target.answer.startsWith("Error:")) {
        setWordFeedback((current) => recordWordFeedback(current, target, "skip"));
      }

      // Only prompt for skip feedback if medium/hard, not instant, streamer drew strokes, and cooldown met
      if (target.difficulty !== "easy" && !isInstant && strokeCount > 0 && target.categoryId !== "custom" && !target.answer.startsWith("Error:")) {
        feedbackRoundsSinceAutoRef.current += 1;
        const shouldPrompt = shouldPromptForWordFeedback(wordFeedback, target, feedbackRoundsSinceAutoRef.current, {
          didSkip: true,
          durationSeconds,
          strokeCount,
          instantSkip: false,
        });
        if (shouldPrompt) {
          feedbackRoundsSinceAutoRef.current = 0;
          pendingFeedbackActionRef.current = () => void beginPrompt(chooseNextPrompt());
          setFeedbackContext("skip");
          setFeedbackTarget(target);
          return;
        }
      }

      void beginPrompt(chooseNextPrompt());
    }
  };

  const selectCategory = (categoryId: string) => {
    if (categoryId === "random") {
      setSelectedCategoryId("random");
      if (!roundActive) {
        preparePrompt(chooseNextPrompt("random"));
        setRoundStatus("idle");
      }
      return;
    }
    
    const nextSelection = toggleCategorySelectionOption(selectedCategoryId, categoryId, "artist", "");
    setSelectedCategoryId(nextSelection);
    if (!roundActive) {
      preparePrompt(chooseNextPrompt(nextSelection));
      setRoundStatus("idle");
    }
  };

  const removeCategoryChip = (chipId: string) => {
    const nextSelection = removeCategorySelectionChip(selectedCategoryId, chipId, "artist", "");
    setSelectedCategoryId(nextSelection);
    if (!roundActive) {
      preparePrompt(chooseNextPrompt(nextSelection));
      setRoundStatus("idle");
    }
  };

  const applyCategorySelection = (selectionId: CategorySelection) => {
    setSelectedCategoryId(selectionId);
    if (!roundActive) {
      preparePrompt(chooseNextPrompt(selectionId || "all"));
      setRoundStatus("idle");
    }
  };

  const selectAllCategories = () => {
    const allGameTokens = "all"; // or we could specify all the tokens, but let's use "all" to match AutoDraw's logic if possible, or just "random"
    setSelectedCategoryId("all");
    if (!roundActive) {
      preparePrompt(chooseNextPrompt("all"));
      setRoundStatus("idle");
    }
  };

  const resetMixCategories = () => {
    setSelectedCategoryId("");
    if (!roundActive) {
      setRoundStatus("idle");
    }
  };



  const useCustomWord = (value: string) => {
    const answer = value.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!answer) {
      if (!roundActive && currentPrompt.categoryId === "custom") {
        preparePrompt(chooseNextPrompt(selectedCategoryId || "all"));
        setRoundStatus("idle");
      }
      return true;
    }
    if (roundActive) return false;
    const prompt = rememberPrompt({ answer, categoryId: "custom" });
    preparePrompt(prompt);
    setRoundStatus("idle");
    setConnectionNotice("Custom word is ready for the next round.");
    return true;
  };

  const endRound = () => {
    if (!roundActive) return;
    void endServerRound();
    maybeOpenAutomaticFeedback();
    setRoundStatus("ended");
  };

  const connectTwitch = () => window.location.assign(twitchAuthStartUrl());

  const disconnectFromTwitch = async () => {
    try {
      await disconnectTwitch();
      setTwitchSession(await fetchTwitchSession());
      setLeaderboard([]);
      setConnectionNotice("Twitch disconnected.");
    } catch (error) {
      setConnectionNotice(error instanceof Error ? error.message : "Could not disconnect Twitch.");
    }
  };

  const rewardViewer = async (viewer: SolvedViewer) => {
    try {
      const result = await adjustViewerPoints(viewer, 25);
      setLeaderboard(result.leaderboard);
      setConnectionNotice(`Added 25 Findraw points to ${viewer.name}.`);
    } catch (error) {
      setConnectionNotice(error instanceof Error ? error.message : "Could not update points.");
    }
  };

  const startResize = (panel: ResizeState["panel"], event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStateRef.current = {
      panel,
      startX: event.clientX,
      startWidth: panel === "source" ? sourceRailWidth : sidePanelWidth,
      lastWidth: panel === "source" ? sourceRailWidth : sidePanelWidth,
    };
    document.body.classList.add("resizing-panels");
  };

  const updateShortcut = (action: ShortcutAction, key: string) => {
    setShortcuts((current) => {
      const normalizedKey = key.toLowerCase();
      const collision = (Object.keys(current) as ShortcutAction[])
        .find((item) => item !== action && current[item].toLowerCase() === normalizedKey);
      const next = { ...current, [action]: normalizedKey };
      if (collision) next[collision] = current[action];
      return next;
    });
  };

  return (
    <DockLayout panelIds={["artist-camera", "artist-chat", "artist-support", "artist-solved", "artist-leaderboard"]} slotIds={["artist-left-1", "artist-left-2", "artist-right-1", "artist-right-2", "artist-right-3"]} storageKey="artist.dock.v2">
    <div
      className="dashboard-layout"
      style={{
        "--source-rail-width": `${sourceRailWidth}px`,
        "--side-panel-width": `${sidePanelWidth}px`,
      } as CSSProperties}
    >
      <header className="mobile-topbar">
        <div className="mobile-logo">Findraw</div>
        <div className="mobile-status">
          <span>{formattedTime}</span>
          <span className="material-symbols-outlined">radio_button_checked</span>
          <span className="material-symbols-outlined pulse">timer</span>
        </div>
      </header>

      <StreamSourceSidebar category={currentPrompt.categoryId} chatStatus={twitchSession.eventSubStatus} configured={twitchSession.configured} connected={twitchSession.authenticated} displayName={twitchSession.user?.displayName ?? null} messages={chatMessages} onDisconnectTwitch={() => void disconnectFromTwitch()} onModes={() => onNavigate("/")} onUseCustomWord={useCustomWord} preparedCustomWord={currentPrompt.categoryId === "custom" ? currentPrompt.answer : null} roundActive={roundActive} word={currentPrompt.answer} />
      <div aria-label="Resize source panel" className="layout-resizer source-rail-resizer" onPointerDown={(event) => startResize("source", event)} role="separator" />

      <main className="dashboard-shell">
        <div className="watermark">ARTIST&apos;S COPY</div>

        <section className="dashboard-grid">
          <div className="main-column">
            <ResizableSurface className="fixed-prompt-surface" label="guess bar" storageKey="artist.guessBar.v2">
            <div className="prompt-bar-row">
              <section
                className={`prompt-board ${solvedViewers.length > 0 ? "has-correct-guess" : ""}`}
                key={`${currentPrompt.categoryId}-${currentPrompt.answer}-${solvedViewers.length}`}
                style={{ "--prompt-board-color": promptBoardColor } as CSSProperties}
              >
                <div aria-label="Masked round word" className="round-word-mask" style={{ fontSize: `clamp(16px, ${65 / Math.max(1, maskedPrompt.length)}vw, 44px)` }}>{maskedPrompt}</div>
                <span className="prompt-solve-count">{solvedViewers.length}/{correctGuessTarget}</span>
                <button aria-label="Give word feedback" className="word-feedback-trigger" onClick={() => openWordFeedback()} title="Give word feedback" type="button">
                  <span className="material-symbols-outlined">rate_review</span>
                </button>
              </section>
              <div className="prompt-settings-wrap" ref={roundSettingsRef}>
                <button
                  aria-expanded={roundSettingsOpen}
                  aria-label="Word timer settings"
                  className={`prompt-settings-button ${roundSettingsOpen ? "active" : ""}`}
                  onClick={() => setRoundSettingsOpen((current) => !current)}
                  title="Word settings"
                  type="button"
                >
                  <span className="material-symbols-outlined">tune</span>
                </button>
                <div className={`prompt-settings-popover ${roundSettingsOpen ? "open" : ""}`} role="dialog" aria-label="Word settings">
                  <header>
                    <div><small>Game flow</small><strong>Word settings</strong></div>
                    <button aria-label="Close word settings" onClick={() => setRoundSettingsOpen(false)} type="button"><span className="material-symbols-outlined">close</span></button>
                  </header>
                  <label className="prompt-setting-control">
                    <span><strong>Time per word</strong><small>Every new or skipped word gets a fresh timer.</small></span>
                    <div className="prompt-number-field">
                      <input aria-label="Time per word in seconds" max="600" min="60" onChange={(event) => setWordDurationSeconds(Math.min(600, Math.max(60, event.currentTarget.valueAsNumber || 60)))} step="30" type="number" value={wordDurationSeconds} />
                      <span>sec</span>
                    </div>
                  </label>
                  <label className="prompt-setting-control">
                    <span><strong>Automatic reveal</strong><small>Reveal one hidden letter at this interval.</small></span>
                    <div className="prompt-number-field">
                      <input aria-label="Automatic reveal interval in seconds" max="90" min="10" onChange={(event) => setAutoRevealSeconds(Math.min(90, Math.max(10, event.currentTarget.valueAsNumber || 10)))} step="5" type="number" value={autoRevealSeconds} />
                      <span>sec</span>
                    </div>
                  </label>
                  <div className="prompt-setting-control">
                    <span><strong>Reveal order</strong><small>Choose where the next revealed letter comes from.</small></span>
                    <div className="reveal-mode-toggle" role="group" aria-label="Reveal order">
                      <button className={revealMode === "random" ? "active" : ""} onClick={() => setRevealMode("random")} type="button">Random</button>
                      <button className={revealMode === "sequence" ? "active" : ""} onClick={() => setRevealMode("sequence")} type="button">In order</button>
                    </div>
                  </div>
                  <label className="prompt-setting-control">
                    <span><strong>Correct guess target</strong><small>The word completes when this many unique chatters solve it.</small></span>
                    <div className="prompt-number-field wide-unit">
                      <input aria-label="Correct guess target" disabled={roundActive} max={MAX_CORRECT_GUESSERS} min="1" onChange={(event) => setCorrectGuessTarget(isNaN(event.currentTarget.valueAsNumber) ? ("" as any) : Math.min(MAX_CORRECT_GUESSERS, event.currentTarget.valueAsNumber))} type="number" value={correctGuessTarget} />
                      <span>solves</span>
                    </div>
                  </label>
                  <label className="prompt-setting-control">
                    <span><strong>Simulate chat (Bots)</strong><small>Automatically send test guesses during the round.</small></span>
                    <input aria-label="Enable test bots" checked={testBotsEnabled} onChange={(e) => setTestBotsEnabled(e.target.checked)} type="checkbox" />
                  </label>
                  <div className="prompt-setting-toggle">
                    <span><strong>Reveal on timeout</strong><small>Show the full answer when the word timer ends.</small></span>
                    <label className="switch"><input checked={revealAnswerOnTimeout} onChange={(event) => setRevealAnswerOnTimeout(event.target.checked)} type="checkbox" /><span /></label>
                  </div>
                  <p className="prompt-settings-note">Points are awarded by solve position: first place earns the most.</p>
                </div>
              </div>
            </div>
            </ResizableSurface>

            <ResizableSurface className="fixed-canvas-surface" label="drawing canvas" storageKey="artist.canvas.v2">
            <section className="canvas-card">
              <div className="solve-bar"><span style={{ width: `${Math.min(100, (solvedViewers.length / correctGuessTarget) * 100)}%` }} /></div>
              <div className="canvas-header simplified-canvas-header">
                <div className={`timer ${secondsRemaining <= 10 && roundActive ? "timer-warning" : ""}`}>{formattedTime}</div>
              </div>
              <ExcalidrawStage canvasColor={canvasColor} gridSize={gridSize} hoverMenuDelay={hoverMenuDelay} hoverMenusEnabled={hoverMenusEnabled} onCanvasColorChange={setCanvasColor} onGridSizeChange={setGridSize} onOperationsChange={(ops) => { strokeCountRef.current = ops.length; }} shortcuts={shortcuts} />
            </section>
            </ResizableSurface>

            <section className="round-controls" aria-label="Round controls">
              <button className="control primary" disabled={roundActive} onClick={startRound} type="button"><span className="material-symbols-outlined">play_arrow</span>{roundStatus === "ended" ? "Next Word" : "Start Word"}</button>
              <button className="control gold" disabled={!roundActive} onClick={skipWord} type="button"><span className="material-symbols-outlined">skip_next</span>Skip Word</button>
              <button className="control ghost" disabled={!roundActive} onClick={revealLetterByMode} type="button"><span className="material-symbols-outlined">lightbulb</span>Reveal Letter</button>
              <button className="control danger" disabled={!roundActive} onClick={endRound} type="button"><span className="material-symbols-outlined">stop</span>End Word</button>
            </section>
          </div>

          <div aria-label="Resize help panel" className="layout-resizer side-panel-resizer" onPointerDown={(event) => startResize("side", event)} role="separator" />

          <aside className="side-column dock-rail" data-dock-boundary="left" aria-label="Live game data">
            <DockSlot id="artist-right-1" />
            <DockSlot id="artist-right-2" />
            <DockSlot id="artist-right-3" />
            <DockPanel id="artist-support" label="categories and settings">
            <SupportPanel
              onCategoryChange={selectCategory}
              onCategoryChipRemove={removeCategoryChip}
              onCategorySelectionApply={applyCategorySelection}
              onSelectAll={selectAllCategories}
              onResetCategories={resetMixCategories}
              randomCategory={RANDOM_CATEGORY}
              roundActive={roundActive}
              selectedCategoryId={selectedCategoryId}
              hoverMenuDelay={hoverMenuDelay}
              hoverMenusEnabled={hoverMenusEnabled}
              onHoverMenuDelayChange={setHoverMenuDelay}
              onHoverMenusEnabledChange={setHoverMenusEnabled}
              onShortcutChange={updateShortcut}
              onShortcutsReset={() => setShortcuts({ ...DEFAULT_KEYBOARD_SHORTCUTS })}
              shortcuts={shortcuts}
              twitchSession={twitchSession}
              connectionNotice={connectionNotice}
              onConnectTwitch={connectTwitch}
              onDisconnectTwitch={() => void disconnectFromTwitch()}
            />
            </DockPanel>

            <DockPanel id="artist-solved" label="solved guesses">
            <section className="feed-card solved-card">
              <div className="card-title gold-title"><h3><span className="material-symbols-outlined">check_circle</span>Solved</h3><b>{solvedViewers.length}/{correctGuessTarget}</b></div>
              <div className="solver-list">
                {solvedViewers.length > 0
                  ? solvedViewers.map((viewer) => <span key={viewer.userId}>{viewer.name}<span><b>+{viewer.points}</b><button aria-label={`Add 25 points to ${viewer.name}`} className="solver-bonus-button" onClick={() => void rewardViewer(viewer)} title="Add 25 Findraw points" type="button">+25</button></span></span>)
                  : <p className="solver-empty">No correct guesses yet.</p>}
              </div>
            </section>
            </DockPanel>

            <DockPanel id="artist-leaderboard" label="leaderboard">
            <section className="feed-card leaderboard-card">
              <div className="card-title"><h3>Leaderboard</h3><span className="material-symbols-outlined trophy">emoji_events</span></div>
              <ol className="leaderboard">
                {leaderboard.map(({ userId, displayName, score }, index) => (
                  <li key={userId}><span><b>{index + 1}</b>{displayName}</span><strong>{score.toLocaleString()}</strong></li>
                ))}
              </ol>
            </section>
            </DockPanel>
          </aside>
        </section>
      </main>
      <WordFeedbackModal
        context={feedbackContext}
        modeLabel="Artist Mode"
        onClose={closeWordFeedback}
        onSubmit={submitWordFeedback}
        target={feedbackTarget}
      />
    </div>
    </DockLayout>
  );
}
