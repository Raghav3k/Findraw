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
import { ArtistWordMixPicker } from "./ArtistWordMixPicker";
import type { CommunityPack } from "../community/communityPacksApi";
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  type ShortcutAction,
} from "./keyboardShortcuts";
import { usePersistentState } from "../ui/usePersistentState";
import { DockLayout, DockPanel, DockSlot, ResizableSurface } from "../ui/DockLayout";
import { resizeDockBoundary, SIDE_RAIL_SNAP_POINTS, snapDockRailWidth, SOURCE_RAIL_SNAP_POINTS } from "../ui/dockRailResize";
import {
  adjustViewerPoints,
  endArtistSession,
  endServerRound,
  fetchArtistSessions,
  fetchWeeklyPoints,
  connectLiveEvents,
  setTwitchChatCommands,
  setArtistSessionReward,
  setWeeklyPointsRewardFulfilled,
  setWeeklyPointsRewards,
  startArtistSession,
  startServerRound,
  roundControllerId,
  type ArtistSession,
  type LeaderboardEntry,
  type SolvedViewer,
  type WeeklyPointsSeason,
  type WeeklyPointsSummary,
} from "../twitch/twitchApi";
import {
  DEFAULT_WORD_SECONDS,
  MAX_CORRECT_GUESSERS,
} from "./gameData";
import {
  DEFAULT_ARTIST_WORD_MIX,
  getArtistPromptKey,
  normalizeArtistWordMix,
  pickArtistPrompt,
  type ArtistPackPrompt,
  type ArtistWordMix,
} from "./artistWordPacks";
import { WordFeedbackModal } from "../feedback/WordFeedbackModal";
import {
  recordWordFeedback,
  shouldPromptForWordFeedback,
  type WordFeedbackContext,
  type WordFeedbackMap,
  type WordFeedbackRating,
  type WordFeedbackTarget,
} from "../feedback/wordFeedback";
import { useSiteIdentity } from "../identity/SiteIdentity";

type RoundStatus = "idle" | "playing" | "ended";
type RevealMode = "random" | "sequence";
type LeaderboardView = "session" | "points";

const DEFAULT_HOSTED_REWARD_SLOTS = 5;
const MAX_HOSTED_REWARD_SLOTS = 20;
const HOSTED_REWARD_SUGGESTIONS = [
  "Gift a subscription",
  "VIP for one week",
  "Choose the next word pack",
  "Request a word for the next round",
  "Shout-out on stream",
];

const getOrdinalLabel = (position: number) => {
  const lastTwoDigits = position % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return `${position}th`;
  if (position % 10 === 1) return `${position}st`;
  if (position % 10 === 2) return `${position}nd`;
  if (position % 10 === 3) return `${position}rd`;
  return `${position}th`;
};

const getHostedResultLimit = (session: ArtistSession) => Math.min(
  MAX_HOSTED_REWARD_SLOTS,
  Math.max(DEFAULT_HOSTED_REWARD_SLOTS, ...session.rewards.map((reward) => reward.position)),
);

type ResizeState = {
  element: HTMLDivElement;
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
  const { displayName: communityCreatorName, setTwitchSession, twitchSession } = useSiteIdentity();
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
  const [wordMix, setWordMix] = usePersistentState<ArtistWordMix>("artist.wordMix.v2", DEFAULT_ARTIST_WORD_MIX);
  const [wordMixOnboarded, setWordMixOnboarded] = usePersistentState("artist.wordMixOnboarded.v2", false);
  const [communityPacks, setCommunityPacks] = usePersistentState<CommunityPack[]>("artist.communityPacks.v1", []);
  const [communityEditTokens, setCommunityEditTokens] = usePersistentState<Record<string, string>>("artist.communityEditTokens.v1", {});
  const [reportedCommunityPackIds, setReportedCommunityPackIds] = usePersistentState<string[]>("artist.reportedCommunityPacks.v1", []);
  const [communityReporterKey, setCommunityReporterKey] = usePersistentState("artist.communityReporterKey.v1", "");
  const activeCommunityPacks = communityPacks.filter((pack) => pack.status === "published" && !reportedCommunityPackIds.includes(pack.id));
  const [wordFeedback, setWordFeedback] = usePersistentState<WordFeedbackMap>("feedback.artist.words", {});
  const [roundStatus, setRoundStatus] = useState<RoundStatus>("idle");
  const [currentPrompt, setCurrentPrompt] = useState<ArtistPackPrompt>(() => pickArtistPrompt(normalizeArtistWordMix(wordMix, activeCommunityPacks), [], activeCommunityPacks));
  const [wordMixOpen, setWordMixOpen] = useState(() => !wordMixOnboarded);
  const [feedbackTarget, setFeedbackTarget] = useState<WordFeedbackTarget | null>(null);
  const [feedbackContext, setFeedbackContext] = useState<WordFeedbackContext>("experience");
  const feedbackRoundsSinceAutoRef = useRef(0);
  const pendingFeedbackActionRef = useRef<(() => void) | null>(null);
  const roundStartTimeRef = useRef(Date.now());
  const strokeCountRef = useRef(0);
  const recentPromptKeysRef = useRef<string[]>([getArtistPromptKey(currentPrompt)]);
  const [secondsRemaining, setSecondsRemaining] = useState(wordDurationSeconds);
  const [revealedLetters, setRevealedLetters] = useState<number[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [solvedViewers, setSolvedViewers] = useState<SolvedViewer[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [weeklyPoints, setWeeklyPoints] = useState<WeeklyPointsSummary>({ current: null, history: [] });
  const [weeklyResult, setWeeklyResult] = useState<WeeklyPointsSeason | null>(null);
  const [weeklyRewards, setWeeklyRewards] = useState<string[]>(["", "", "", "", ""]);
  const [weeklyBusy, setWeeklyBusy] = useState(false);
  const [weeklyError, setWeeklyError] = useState("");
  const [artistSession, setArtistSession] = useState<ArtistSession | null>(null);
  const [sessionHistory, setSessionHistory] = useState<ArtistSession[]>([]);
  const [leaderboardView, setLeaderboardView] = useState<LeaderboardView>("session");
  const [sessionSetupOpen, setSessionSetupOpen] = useState(false);
  const [sessionResult, setSessionResult] = useState<ArtistSession | null>(null);
  const [sessionName, setSessionName] = useState("Community session");
  const [sessionRewards, setSessionRewards] = useState<string[]>(() => Array(DEFAULT_HOSTED_REWARD_SLOTS).fill(""));
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [connectionNotice, setConnectionNotice] = useState("");
  const activeRoundIdRef = useRef<string | null>(null);
  const [roundSettingsOpen, setRoundSettingsOpen] = useState(false);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const roundSettingsRef = useRef<HTMLDivElement | null>(null);
  const roundActive = roundStatus === "playing";

  useEffect(() => {
    if (communityReporterKey) return;
    setCommunityReporterKey(typeof window.crypto?.randomUUID === "function" ? window.crypto.randomUUID() : `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }, [communityReporterKey, setCommunityReporterKey]);

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
        const snapped = snapDockRailWidth(Math.max(280, Math.min(520, resize.startWidth + delta)), SOURCE_RAIL_SNAP_POINTS);
        const nextWidth = snapped.width;
        resize.element.classList.toggle("divider-snap", snapped.snapped);
        resizeDockBoundary("right", resize.lastWidth, nextWidth);
        resize.lastWidth = nextWidth;
        setSourceRailWidth(nextWidth);
      } else {
        const snapped = snapDockRailWidth(Math.max(230, Math.min(420, resize.startWidth - delta)), SIDE_RAIL_SNAP_POINTS);
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
    let refreshing = false;
    setWeeklyPoints({ current: null, history: [] });
    setLeaderboard([]);
    setArtistSession(null);
    setSessionHistory([]);
    if (!twitchSession.authenticated) return;
    const refreshChannel = () => {
      if (!active || refreshing) return;
      refreshing = true;
      void Promise.all([fetchWeeklyPoints(), fetchArtistSessions()])
      .then(([points, sessions]) => {
        if (!active) return;
        setWeeklyPoints(points);
        setLeaderboard(points.current?.standings || []);
        setArtistSession(sessions.active);
        setSessionHistory(sessions.history);
      })
      .catch((error: Error) => {
        if (active) setConnectionNotice(`Channel data unavailable: ${error.message}`);
      }).finally(() => { refreshing = false; });
    };
    refreshChannel();
    // Live events cover this browser's game; polling catches another browser's
    // channel-wide score/reward changes without opening a second chat connection.
    const refreshTimer = twitchSession.authenticated ? window.setInterval(() => {
      if (document.visibilityState === "visible") refreshChannel();
    }, 60_000) : null;
    const refreshOnFocus = () => { if (document.visibilityState === "visible") refreshChannel(); };
    document.addEventListener("visibilitychange", refreshOnFocus);

    const disconnectLiveEvents = connectLiveEvents((event) => {
      if (event.type === "twitch-session" && event.payload.eventSubStatus === "connected") refreshChannel();
      if (event.type === "chat-message") {
        setChatMessages((current) => [...current.slice(-49), event.payload]);
      }
      if (event.type === "correct-guess" && event.payload.roundId === activeRoundIdRef.current) {
        setSolvedViewers((current) => current.some((viewer) => viewer.userId === event.payload.solver.userId)
          ? current
          : [...current, event.payload.solver]);
      }
      if (event.type === "leaderboard") setLeaderboard(Array.isArray(event.payload) ? event.payload : []);
      if (event.type === "weekly-points") {
        setWeeklyPoints(event.payload);
        setLeaderboard(event.payload.current?.standings || []);
        setWeeklyResult((current) => current
          ? [event.payload.current, ...event.payload.history].find((season) => season?.weekId === current.weekId) || current
          : null);
      }
      if (event.type === "artist-session") setArtistSession(event.payload);
      if (event.type === "round-started" && event.payload.controllerId === roundControllerId) activeRoundIdRef.current = event.payload.roundId;
      if (event.type === "round-ended" && event.payload.roundId === activeRoundIdRef.current) {
        setRoundStatus("ended");
        if (event.payload.reason === "taken-over") setConnectionNotice("Live scoring moved to another browser or game. Your channel points are safe.");
      }
    }, () => {
      setTwitchSession((current) => current.authenticated
        ? { ...current, eventSubStatus: "reconnecting" }
        : current);
    });
    return () => {
      active = false;
      if (refreshTimer !== null) window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", refreshOnFocus);
      disconnectLiveEvents();
    };
  }, [twitchSession.user?.id]);

  const rememberPrompt = (prompt: ArtistPackPrompt) => {
    recentPromptKeysRef.current = [...recentPromptKeysRef.current, getArtistPromptKey(prompt)].slice(-24);
    return prompt;
  };

  const chooseNextPrompt = (mix: ArtistWordMix = wordMix, availableCommunityPacks: CommunityPack[] = activeCommunityPacks) => {
    return rememberPrompt(pickArtistPrompt(normalizeArtistWordMix(mix, availableCommunityPacks), recentPromptKeysRef.current, availableCommunityPacks));
  };

  const openWordFeedback = (prompt: ArtistPackPrompt = currentPrompt) => {
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

  const maybeOpenAutomaticFeedback = (prompt: ArtistPackPrompt = currentPrompt, afterFeedback?: () => void) => {
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

  const preparePrompt = (prompt: ArtistPackPrompt) => {
    setCurrentPrompt(prompt);
    setRevealedLetters([]);
    setChatMessages([]);
    setSolvedViewers([]);
    setSecondsRemaining(wordDurationSeconds);
  };

  const beginPrompt = async (prompt: ArtistPackPrompt) => {
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
      if ((error as { code?: string }).code === "ROUND_OWNED") {
        setRoundStatus("idle");
        setConnectionNotice("Scoring remains in the other browser or game. Start again if you want to take over.");
        return;
      }
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

  const applyWordMix = (nextMix: ArtistWordMix, availableCommunityPacks: CommunityPack[] = activeCommunityPacks) => {
    const normalized = normalizeArtistWordMix(nextMix, availableCommunityPacks);
    setWordMix(normalized);
    setWordMixOnboarded(true);
    if (!roundActive) {
      preparePrompt(chooseNextPrompt(normalized));
      setRoundStatus("idle");
    }
  };

  const markCommunityPackReported = (packId: string) => {
    const nextReportedIds = [...new Set([...reportedCommunityPackIds, packId])];
    const remainingPacks = communityPacks.filter((pack) => pack.id !== packId && pack.status === "published");
    setReportedCommunityPackIds(nextReportedIds);
    if (wordMix.packIds.includes(`community-${packId}`)) {
      applyWordMix({ ...wordMix, packIds: wordMix.packIds.filter((id) => id !== `community-${packId}`) }, remainingPacks);
    }
  };



  const useCustomWord = (value: string) => {
    const answer = value.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!answer) {
      if (!roundActive && currentPrompt.categoryId === "custom") {
        preparePrompt(chooseNextPrompt());
        setRoundStatus("idle");
      }
      return true;
    }
    if (roundActive) return false;
    const prompt = rememberPrompt({ answer, categoryId: "custom", difficulty: "easy" });
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

  const rewardViewer = async (viewer: SolvedViewer) => {
    try {
      const result = await adjustViewerPoints(viewer, 25);
      setLeaderboard(result.leaderboard);
      setWeeklyPoints(result.weeklyPoints);
      setConnectionNotice(`Added 25 weekly Findraw Points to ${viewer.name}.`);
    } catch (error) {
      setConnectionNotice(error instanceof Error ? error.message : "Could not update points.");
    }
  };

  const beginArtistSession = async () => {
    if (!twitchSession.authenticated) {
      setSessionError("Connect Twitch from the home profile before starting a hosted session.");
      return;
    }
    if (roundActive) {
      setSessionError("Finish the current word before starting a hosted session.");
      return;
    }
    setSessionBusy(true);
    setSessionError("");
    try {
      if (!sessionRewards[0].trim()) {
        setSessionError("Add a reward for first place before starting the session.");
        setSessionBusy(false);
        return;
      }
      const rewards = sessionRewards.flatMap((reward, index) => reward.trim() ? [{ position: index + 1, reward: reward.trim() }] : []);
      const result = await startArtistSession(sessionName.trim() || "Hosted session", rewards);
      setArtistSession(result.session);
      setLeaderboardView("session");
      setSessionSetupOpen(false);
      setConnectionNotice(`${result.session.name} is live. Session points also count toward this week's Findraw Points.`);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "The session could not be started.");
    } finally {
      setSessionBusy(false);
    }
  };

  const finishArtistSession = async () => {
    setSessionBusy(true);
    setSessionError("");
    try {
      const result = await endArtistSession();
      setArtistSession(null);
      setLeaderboardView("session");
      setSessionHistory((current) => [result.session, ...current.filter((session) => session.id !== result.session.id)].slice(0, 20));
      setSessionResult(result.session);
      setConnectionNotice("Hosted session ended. Its points remain in this week's Findraw leaderboard.");
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "The session could not be ended.");
    } finally {
      setSessionBusy(false);
    }
  };

  const updateSessionReward = async (session: ArtistSession, position: number, fulfilled: boolean) => {
    try {
      const result = await setArtistSessionReward(session.id, position, fulfilled);
      setSessionResult(result.session);
      setSessionHistory((current) => current.map((entry) => entry.id === result.session.id ? result.session : entry));
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "The reward status could not be saved.");
    }
  };

  const copySessionResults = async (session: ArtistSession) => {
    const lines = session.standings.slice(0, getHostedResultLimit(session)).map((entry, index) => {
      const reward = session.rewards.find((item) => item.position === index + 1);
      return `${index + 1}. ${entry.displayName} — ${entry.score} pts${reward ? ` — ${reward.reward}` : ""}`;
    });
    const text = [`${session.name} results`, ...lines].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setConnectionNotice("Session results copied.");
    } catch {
      setConnectionNotice("Results are ready, but the browser blocked copying.");
    }
  };

  const openWeeklyResult = (season: WeeklyPointsSeason) => {
    setWeeklyError("");
    setWeeklyResult(season);
    setWeeklyRewards(Array.from({ length: 5 }, (_, index) => season.rewards.find((reward) => reward.position === index + 1)?.reward || ""));
  };

  const saveWeeklyRewards = async () => {
    if (!weeklyResult) return;
    setWeeklyBusy(true);
    setWeeklyError("");
    try {
      const rewards = weeklyRewards.flatMap((reward, index) => reward.trim()
        ? [{ position: index + 1, reward: reward.trim() }]
        : []);
      const result = await setWeeklyPointsRewards(weeklyResult.weekId, rewards);
      setWeeklyPoints(result.summary);
      setWeeklyResult(result.season);
      setConnectionNotice(rewards.length ? "Weekly placement rewards saved." : "Weekly placement rewards cleared.");
    } catch (error) {
      setWeeklyError(error instanceof Error ? error.message : "Weekly rewards could not be saved.");
    } finally {
      setWeeklyBusy(false);
    }
  };

  const updateWeeklyReward = async (season: WeeklyPointsSeason, position: number, fulfilled: boolean) => {
    try {
      const result = await setWeeklyPointsRewardFulfilled(season.weekId, position, fulfilled);
      setWeeklyPoints(result.summary);
      setWeeklyResult(result.season);
    } catch (error) {
      setWeeklyError(error instanceof Error ? error.message : "Weekly reward status could not be saved.");
    }
  };

  const copyWeeklyResults = async (season: WeeklyPointsSeason) => {
    const lines = season.standings.slice(0, 5).map((entry, index) => {
      const reward = season.rewards.find((item) => item.position === index + 1);
      return `${index + 1}. ${entry.displayName} — ${entry.score} pts${reward ? ` — ${reward.reward}` : ""}`;
    });
    try {
      await navigator.clipboard.writeText([`Findraw week of ${season.weekId}`, ...lines].join("\n"));
      setConnectionNotice("Weekly results copied.");
    } catch {
      setConnectionNotice("Weekly results are ready, but the browser blocked copying.");
    }
  };

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

      <StreamSourceSidebar category={currentPrompt.categoryId} chatStatus={twitchSession.eventSubStatus} messages={chatMessages} onModes={() => onNavigate("/")} onUseCustomWord={useCustomWord} preparedCustomWord={currentPrompt.categoryId === "custom" ? currentPrompt.answer : null} roundActive={roundActive} word={currentPrompt.answer} />
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
            <DockPanel id="artist-support" label="word mix and settings">
            <SupportPanel
              communityPacks={activeCommunityPacks}
              roundActive={roundActive}
              wordMix={wordMix}
              onOpenWordMix={() => setWordMixOpen(true)}
              hoverMenuDelay={hoverMenuDelay}
              hoverMenusEnabled={hoverMenusEnabled}
              onHoverMenuDelayChange={setHoverMenuDelay}
              onHoverMenusEnabledChange={setHoverMenusEnabled}
              onShortcutChange={updateShortcut}
              onShortcutsReset={() => setShortcuts({ ...DEFAULT_KEYBOARD_SHORTCUTS })}
              shortcuts={shortcuts}
              twitchSession={twitchSession}
              connectionNotice={connectionNotice}
              onChatCommandsEnabledChange={async (enabled) => {
                try {
                  const session = await setTwitchChatCommands(enabled);
                  setTwitchSession(session);
                  setConnectionNotice(enabled ? "Chat point commands are on." : "Chat point commands are off.");
                } catch (error) {
                  setConnectionNotice(error instanceof Error ? error.message : "Could not update chat commands.");
                }
              }}
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
              <div aria-label="Score view" className="artist-score-tabs" role="tablist">
                <button aria-selected={leaderboardView === "session"} className={leaderboardView === "session" ? "active" : ""} onClick={() => setLeaderboardView("session")} role="tab" type="button"><span className="material-symbols-outlined">emoji_events</span>Session</button>
                <button aria-selected={leaderboardView === "points"} className={leaderboardView === "points" ? "active" : ""} onClick={() => setLeaderboardView("points")} role="tab" type="button"><span className="material-symbols-outlined">stars</span>Weekly</button>
              </div>
              {leaderboardView === "session" ? (
                artistSession ? (
                  <div className="artist-session-live-panel">
                    <div className="artist-session-live-heading"><span><small>Hosted session</small><strong>{artistSession.name}</strong></span><b>{artistSession.standings.length} players</b></div>
                    <p>Session scores also add to this week's Findraw Points.</p>
                    <ol className="leaderboard artist-session-standings">
                      {artistSession.standings.map(({ userId, displayName, score }, index) => <li key={userId}><span><b>{index + 1}</b>{displayName}</span><strong>{score.toLocaleString()}</strong></li>)}
                      {!artistSession.standings.length ? <li className="artist-session-empty">Waiting for the first correct guess</li> : null}
                    </ol>
                    <button className="artist-session-primary-action danger" disabled={sessionBusy || roundActive} onClick={() => void finishArtistSession()} title={roundActive ? "Finish the current word first" : "End hosted session"} type="button">End session</button>
                  </div>
                ) : (
                  <div className="artist-session-start-panel">
                    {sessionHistory.length ? (
                      <div className="artist-session-overview">
                        <div className="artist-session-overview-heading"><span><small>Last session</small><strong>{sessionHistory[0].name}</strong></span><time>{sessionHistory[0].endedAt ? new Date(sessionHistory[0].endedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Finished"}</time></div>
                        <div className="artist-session-last-winner"><span className="material-symbols-outlined">emoji_events</span><span><small>Winner</small><strong>{sessionHistory[0].standings[0]?.displayName || "No winner"}</strong></span><b>{sessionHistory[0].standings[0]?.score.toLocaleString() || "0"}<small>pts</small></b></div>
                        <div className="artist-session-overview-stats"><span><small>Players</small><strong>{sessionHistory[0].standings.length}</strong></span><span><small>Rewards given</small><strong>{sessionHistory[0].rewards.filter((reward) => reward.fulfilled).length}/{sessionHistory[0].rewards.length}</strong></span></div>
                        <button className="artist-session-view-result" onClick={() => setSessionResult(sessionHistory[0])} type="button">View results <span className="material-symbols-outlined">arrow_forward</span></button>
                        {sessionHistory.length > 1 ? <div className="artist-session-panel-history"><small>Earlier sessions</small>{sessionHistory.slice(1, 3).map((session) => <button key={session.id} onClick={() => setSessionResult(session)} type="button"><span>{session.name}</span><b>{session.standings[0]?.displayName || "No winner"}</b></button>)}</div> : null}
                      </div>
                    ) : (
                      <div className="artist-session-first-guide">
                        <span className="material-symbols-outlined">workspace_premium</span>
                        <strong>Run your first reward session</strong>
                        <ol><li><b>1</b><span>Set rewards for the winning places.</span></li><li><b>2</b><span>Start playing and let chat earn session points.</span></li><li><b>3</b><span>End the session, announce winners, and mark rewards given.</span></li></ol>
                      </div>
                    )}
                    <button className="artist-session-primary-action" disabled={!twitchSession.authenticated || roundActive} onClick={() => { setSessionError(""); setSessionSetupOpen(true); }} title={roundActive ? "Finish the current word first" : "Set up a hosted session"} type="button">Set up session</button>
                  </div>
                )
              ) : (
                <div className="artist-points-panel">
                  {weeklyPoints.current ? (
                    <div className="artist-session-live-heading">
                      <span><small>Weekly Findraw Points</small><strong>Week of {new Date(weeklyPoints.current.startsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</strong></span>
                      <b>Resets {new Date(weeklyPoints.current.endsAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</b>
                    </div>
                  ) : null}
                  <p>Correct guesses—including hosted-session guesses—count toward this weekly placement.</p>
                  <ol className="leaderboard">
                    {leaderboard.map(({ userId, displayName, score }, index) => <li key={userId}><span><b>{index + 1}</b>{displayName}</span><strong>{score.toLocaleString()}</strong></li>)}
                    {!leaderboard.length ? <li className="artist-session-empty">No weekly Findraw Points yet</li> : null}
                  </ol>
                  <button className="artist-session-primary-action" disabled={!twitchSession.authenticated || !weeklyPoints.current} onClick={() => weeklyPoints.current && openWeeklyResult(weeklyPoints.current)} type="button">Weekly rewards</button>
                  {weeklyPoints.history[0] ? <button className="artist-session-view-result" onClick={() => openWeeklyResult(weeklyPoints.history[0])} type="button">View last week <span className="material-symbols-outlined">arrow_forward</span></button> : null}
                </div>
              )}
            </section>
            </DockPanel>
          </aside>
        </section>
      </main>
      {sessionSetupOpen ? (
        <div className="artist-session-modal-backdrop" role="presentation">
          <section aria-labelledby="artist-session-setup-title" aria-modal="true" className="artist-session-modal" role="dialog">
            <header>
              <div><small>Artist Mode</small><h2 id="artist-session-setup-title">Start a hosted session</h2></div>
              <button aria-label="Close session setup" onClick={() => setSessionSetupOpen(false)} type="button"><span className="material-symbols-outlined">close</span></button>
            </header>
            <p className="artist-session-intro">Create the rewards before going live. Correct guesses count toward both the session standings and this week's Findraw Points.</p>
            <label className="artist-session-name-field">
              <span>Session name</span>
              <input maxLength={60} onChange={(event) => setSessionName(event.target.value)} placeholder="Community session" value={sessionName} />
            </label>
            <div className="artist-session-reward-fields hosted-reward-fields">
              {sessionRewards.map((reward, index) => (
                <div className="artist-session-reward-row" key={index}>
                  <b>{getOrdinalLabel(index + 1)}</b>
                  <input aria-label={`${getOrdinalLabel(index + 1)} place reward`} aria-required={index === 0} maxLength={100} onChange={(event) => setSessionRewards((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={HOSTED_REWARD_SUGGESTIONS[index] || "Optional reward"} value={reward} />
                  <button aria-label={`Delete ${getOrdinalLabel(index + 1)} reward slot`} className="artist-session-remove-reward" disabled={sessionRewards.length === 1} onClick={() => setSessionRewards((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))} title="Delete reward slot" type="button"><span className="material-symbols-outlined">remove_circle</span></button>
                </div>
              ))}
            </div>
            <button className="artist-session-add-reward" disabled={sessionRewards.length >= MAX_HOSTED_REWARD_SLOTS} onClick={() => setSessionRewards((current) => current.length >= MAX_HOSTED_REWARD_SLOTS ? current : [...current, ""])} type="button"><span className="material-symbols-outlined">add_circle</span>Add reward position</button>
            {sessionError ? <p className="artist-session-error" role="alert">{sessionError}</p> : null}
            <footer>
              <button className="secondary" onClick={() => setSessionSetupOpen(false)} type="button">Cancel</button>
              <button className="primary" disabled={sessionBusy} onClick={() => void beginArtistSession()} type="button">{sessionBusy ? "Starting…" : "Start session"}</button>
            </footer>
          </section>
        </div>
      ) : null}
      {sessionResult ? (
        <div className="artist-session-modal-backdrop" role="presentation">
          <section aria-labelledby="artist-session-results-title" aria-modal="true" className="artist-session-modal artist-session-results" role="dialog">
            <header>
              <div><small>Session complete</small><h2 id="artist-session-results-title">{sessionResult.name}</h2></div>
              <button aria-label="Close session results" onClick={() => setSessionResult(null)} type="button"><span className="material-symbols-outlined">close</span></button>
            </header>
            <div className="artist-session-results-note"><span className="material-symbols-outlined">verified</span><p><strong>Weekly points are saved</strong><small>These results are the hosted-session ranking only.</small></p></div>
            <ol className="artist-session-podium">
              {sessionResult.standings.slice(0, getHostedResultLimit(sessionResult)).map((entry, index) => {
                const reward = sessionResult.rewards.find((item) => item.position === index + 1);
                return <li className={index === 0 ? "winner" : ""} key={entry.userId}><b>{index + 1}</b><span><strong>{entry.displayName}</strong><small>{entry.score.toLocaleString()} session points</small>{reward ? <em>{reward.reward}</em> : null}</span>{reward ? <label><input checked={reward.fulfilled} onChange={(event) => void updateSessionReward(sessionResult, index + 1, event.target.checked)} type="checkbox" />Given</label> : null}</li>;
              })}
              {sessionResult.standings.length === 0 ? <li className="empty">No one scored during this session.</li> : null}
            </ol>
            {sessionError ? <p className="artist-session-error" role="alert">{sessionError}</p> : null}
            <footer>
              <button className="secondary" disabled={!sessionResult.standings.length} onClick={() => void copySessionResults(sessionResult)} type="button">Copy results</button>
              <button className="primary" onClick={() => setSessionResult(null)} type="button">Back to Chill</button>
            </footer>
          </section>
        </div>
      ) : null}
      {weeklyResult ? (
        <div className="artist-session-modal-backdrop" role="presentation">
          <section aria-labelledby="weekly-points-results-title" aria-modal="true" className="artist-session-modal artist-session-results" role="dialog">
            <header>
              <div><small>{weeklyResult.status === "active" ? "Current week" : "Week complete"}</small><h2 id="weekly-points-results-title">Weekly Findraw Points</h2></div>
              <button aria-label="Close weekly points" onClick={() => setWeeklyResult(null)} type="button"><span className="material-symbols-outlined">close</span></button>
            </header>
            <p className="artist-session-intro">Week of {new Date(weeklyResult.startsAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}. Rewards are optional and fulfilled manually by the streamer.</p>
            <div className="artist-session-rewards-heading"><span><strong>Placement rewards</strong><small>{weeklyResult.status === "active" ? "Set these now or after the week closes." : "Add or update rewards for the completed weekly standings."}</small></span></div>
            <div className="artist-session-reward-fields">
              {weeklyRewards.map((reward, index) => (
                <label key={index}><b>{["1st", "2nd", "3rd", "4th", "5th"][index]}</b><input maxLength={100} onChange={(event) => setWeeklyRewards((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder="Optional reward" value={reward} /></label>
              ))}
            </div>
            <ol className="artist-session-podium">
              {weeklyResult.standings.slice(0, 5).map((entry, index) => {
                const reward = weeklyResult.rewards.find((item) => item.position === index + 1);
                return <li className={index === 0 ? "winner" : ""} key={entry.userId}><b>{index + 1}</b><span><strong>{entry.displayName}</strong><small>{entry.score.toLocaleString()} weekly points</small>{reward ? <em>{reward.reward}</em> : null}</span>{reward && weeklyResult.status === "completed" ? <label><input checked={reward.fulfilled} onChange={(event) => void updateWeeklyReward(weeklyResult, index + 1, event.target.checked)} type="checkbox" />Given</label> : null}</li>;
              })}
              {!weeklyResult.standings.length ? <li className="empty">No one has scored in this week.</li> : null}
            </ol>
            {weeklyError ? <p className="artist-session-error" role="alert">{weeklyError}</p> : null}
            <footer>
              <button className="secondary" disabled={!weeklyResult.standings.length} onClick={() => void copyWeeklyResults(weeklyResult)} type="button">Copy standings</button>
              <button className="secondary" onClick={() => setWeeklyResult(null)} type="button">Close</button>
              <button className="primary" disabled={weeklyBusy} onClick={() => void saveWeeklyRewards()} type="button">{weeklyBusy ? "Saving…" : "Save rewards"}</button>
            </footer>
          </section>
        </div>
      ) : null}
      <WordFeedbackModal
        context={feedbackContext}
        modeLabel="Artist Mode"
        onClose={closeWordFeedback}
        onSubmit={submitWordFeedback}
        target={feedbackTarget}
      />
      <ArtistWordMixPicker
        communityEditTokens={communityEditTokens}
        communityPacks={communityPacks}
        creatorName={communityCreatorName}
        initialMix={wordMix}
        onApply={applyWordMix}
        onClose={() => setWordMixOpen(false)}
        onCommunityEditTokensChange={setCommunityEditTokens}
        onCommunityPacksChange={setCommunityPacks}
        onCommunityPackReported={markCommunityPackReported}
        open={wordMixOpen}
        reportedCommunityPackIds={reportedCommunityPackIds}
        reporterKey={communityReporterKey}
        required={!wordMixOnboarded}
      />
    </div>
    </DockLayout>
  );
}
