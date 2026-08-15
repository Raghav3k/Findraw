import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  disconnectTwitch,
  endServerRound,
  fetchTwitchSession,
  connectLiveEvents,
  startServerRound,
  type LiveChatMessage,
  type SolvedViewer,
  type TwitchSession,
} from "../twitch/twitchApi";
import { usePersistentState } from "../ui/usePersistentState";
import { WorkspaceIdentity } from "../ui/WorkspaceIdentity";
import { CategoryPickerWindow } from "../ui/CategoryPickerWindow";
import { AutoDrawCanvas } from "./AutoDrawCanvas";
import { AUTO_DRAW_ASSETS } from "./autoDrawAssets";
import { GAME_TITLES, getActiveSelectionChips, getCategoryDomains, getSelectionTokens, isCategorySelectionOptionActive, matchesCategorySelection as matchesCategory, removeCategorySelectionChip, toggleCategorySelectionOption } from "../dashboard/gameData";
import { CategorySelectionTools } from "../dashboard/CategorySelectionTools";
import { WordFeedbackModal } from "../feedback/WordFeedbackModal";
import {
  getWordFeedbackKey,
  normalizeWordFeedbackStats,
  recordWordFeedback,
  shouldPromptForWordFeedback,
  type WordFeedbackMap,
  type WordFeedbackRating,
  type WordFeedbackTarget,
} from "../feedback/wordFeedback";

type Props = { onNavigate: (path: string) => void };
type Status = "idle" | "playing" | "paused" | "complete";
type GuessFeedback = "idle" | "wrong" | "correct";
type ResizeState = { panel: "source" | "side"; startX: number; startWidth: number };

const TRANSITION_MS = 900;
const EMPTY_TWITCH_SESSION: TwitchSession = { authenticated: false, configured: false, eventSubStatus: "disconnected", user: null };
const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const getAutoDrawFeedbackWeight = (feedback: WordFeedbackMap, asset: typeof AUTO_DRAW_ASSETS[number]) => {
  const storedStats = feedback[getWordFeedbackKey({ answer: asset.answer, categoryId: asset.category })];
  if (!storedStats) return 1;
  const stats = normalizeWordFeedbackStats(storedStats);
  if (stats.submitted + stats.skipped < 2) return 1;
  const positive = stats.veryGood * 1.05;
  const negative = stats.bad * 1.05 + stats.mid * 0.16 + stats.skipped * 0.28;
  const confidence = Math.min(1, Math.max(0.18, (stats.submitted + stats.skipped) / 10));
  return Math.min(1.28, Math.max(0.42, 1 + ((positive - negative) / Math.max(4, stats.submitted + stats.skipped + 3)) * confidence));
};

const weightedAutoDrawIndexes = (indexes: number[], feedback: WordFeedbackMap) => {
  return indexes
    .map((index) => {
      const weight = getAutoDrawFeedbackWeight(feedback, AUTO_DRAW_ASSETS[index]);
      return { index, rank: Math.random() ** (1 / Math.max(0.001, weight)) };
    })
    .sort((first, second) => second.rank - first.rank)
    .map((item) => item.index);
};

export function AutoDrawPage({ onNavigate }: Props) {
  const [sourceRailWidth, setSourceRailWidth] = usePersistentState("autoDraw.layout.leftRailWidth.artistAligned", 380);
  const [sidePanelWidth, setSidePanelWidth] = usePersistentState("autoDraw.layout.rightRailWidth.artistAligned", 280);
  const [selectedCategory, setSelectedCategory] = usePersistentState("autoDraw.category", "all");
  const [wordFeedback, setWordFeedback] = usePersistentState<WordFeedbackMap>("feedback.autoDraw.words", {});
  const availableIndexes = useMemo(() => {
    const indexes = AUTO_DRAW_ASSETS.flatMap((item, index) => matchesCategory(item.category, selectedCategory) ? [index] : []);
    return weightedAutoDrawIndexes(indexes.length === 0 ? AUTO_DRAW_ASSETS.map((_, index) => index) : indexes, wordFeedback);
  }, [selectedCategory, wordFeedback]);
  
  const [assetIndex, setAssetIndex] = useState(() => availableIndexes[0] ?? 0);

  // If selectedCategory changes, we might want to pick a new asset
  useEffect(() => {
    setAssetIndex(availableIndexes[0] ?? 0);
  }, [selectedCategory]);

  const [stageIndex, setStageIndex] = useState(0);
  const [transitionProgress, setTransitionProgress] = useState(1);
  const [status, setStatus] = useState<Status>("idle");
  const [guess, setGuess] = useState("");
  const [guessFocused, setGuessFocused] = useState(false);
  const [guessFeedback, setGuessFeedback] = useState<GuessFeedback>("idle");
  const [notice, setNotice] = useState("Press start when everyone is ready.");
  const [canvasResetToken, setCanvasResetToken] = useState(0);
  const [twitchSession, setTwitchSession] = useState<TwitchSession>(EMPTY_TWITCH_SESSION);
  const [feedbackTarget, setFeedbackTarget] = useState<WordFeedbackTarget | null>(null);
  const feedbackRoundsSinceAutoRef = useRef(5);
  const pendingFeedbackActionRef = useRef<(() => void) | null>(null);
  const [chatMessages, setChatMessages] = useState<LiveChatMessage[]>([]);
  const [solvers, setSolvers] = useState<SolvedViewer[]>([]);
  const frame = useRef<number | null>(null);
  const previous = useRef<number | null>(null);
  const transitionProgressRef = useRef(1);
  const activeRoundId = useRef<string | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const guessInputRef = useRef<HTMLInputElement>(null);
  const asset = AUTO_DRAW_ASSETS[assetIndex] ?? AUTO_DRAW_ASSETS[0];
  const maximumGuessStage = asset ? asset.stages.length - 2 : 0;
  const assetRef = useRef(asset);
  assetRef.current = asset;
  const aliases = useMemo(() => asset ? [asset.answer, ...(asset.aliases ?? [])].map(normalize) : [], [asset]);
  const twitchLive = twitchSession.authenticated && twitchSession.eventSubStatus === "connected";

  const closeLiveRound = async () => {
    if (!activeRoundId.current) return;
    activeRoundId.current = null;
    try { await endServerRound(); } catch { /* Local play remains available. */ }
  };

  const disconnectFromTwitch = async () => {
    await closeLiveRound();
    try {
      await disconnectTwitch();
      setTwitchSession(await fetchTwitchSession());
      setChatMessages([]);
      setSolvers([]);
      setNotice("Twitch disconnected. Drawing locally is still available.");
    } catch {
      setNotice("Could not disconnect Twitch.");
    }
  };

  useEffect(() => {
    let mounted = true;
    fetchTwitchSession().then((session) => { if (mounted) setTwitchSession(session); }).catch(() => undefined);
    const disconnectLiveEvents = connectLiveEvents((event) => {
      if (event.type === "twitch-session") setTwitchSession(event.payload);
      if (event.type === "chat-message") setChatMessages((current) => [...current.slice(-20), event.payload]);
      if (event.type === "correct-guess" && event.payload.roundId === activeRoundId.current) {
        activeRoundId.current = null;
        setSolvers((current) => [...current, event.payload.solver]);
        setGuess(assetRef.current.answer);
        setGuessFeedback("correct");
        transitionProgressRef.current = 1;
        setTransitionProgress(1);
        setStatus("complete");
        setNotice(`${event.payload.solver.name} solved it in chat.`);
      }
    }, () => setTwitchSession((current) => current.authenticated ? { ...current, eventSubStatus: "reconnecting" } : current));
    return () => { mounted = false; disconnectLiveEvents(); if (activeRoundId.current) void closeLiveRound(); };
  }, []);

  useEffect(() => {
    if (status !== "playing" || transitionProgressRef.current >= 1) { previous.current = null; return; }
    const tick = (time: number) => {
      const delta = Math.min(100, time - (previous.current ?? time));
      previous.current = time;
      const next = Math.min(1, transitionProgressRef.current + delta / TRANSITION_MS);
      transitionProgressRef.current = next;
      setTransitionProgress(next);
      if (next < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [stageIndex, status]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = resizeStateRef.current;
      if (!resize) return;
      const delta = event.clientX - resize.startX;
      if (resize.panel === "source") setSourceRailWidth(Math.max(280, Math.min(520, resize.startWidth + delta)));
      else setSidePanelWidth(Math.max(230, Math.min(420, resize.startWidth - delta)));
    };
    const stopResize = () => { resizeStateRef.current = null; document.body.classList.remove("resizing-panels"); };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [setSidePanelWidth, setSourceRailWidth]);

  const reset = (next: Status = "idle") => {
    void closeLiveRound();
    setStageIndex(0);
    transitionProgressRef.current = 1;
    setTransitionProgress(1);
    setGuess("");
    setGuessFocused(false);
    setGuessFeedback("idle");
    setSolvers([]);
    setChatMessages([]);
    setCanvasResetToken((value) => value + 1);
    setStatus(next);
    setNotice(next === "playing" ? "The first clue is being drawn." : "Press start when everyone is ready.");
  };

  const startDrawing = async () => {
    await closeLiveRound();
    reset("playing");
    if (!twitchLive) return;
    try {
      const result = await startServerRound(asset.answer, 1, asset.aliases);
      activeRoundId.current = result.roundId;
      setNotice("Drawing live. Twitch chat can guess now.");
    } catch { setNotice("Drawing locally. Live chat could not start."); }
  };

  const performNextDrawing = async () => {
    const queue = availableIndexes.length ? availableIndexes : AUTO_DRAW_ASSETS.map((_, index) => index);
    const position = queue.indexOf(assetIndex);
    const nextIdx = queue[(position + 1 + queue.length) % queue.length];
    const nextAsset = AUTO_DRAW_ASSETS[nextIdx];
    
    setAssetIndex(nextIdx);
    await closeLiveRound();
    reset("playing");
    
    if (!twitchLive) return;
    try {
      const result = await startServerRound(nextAsset.answer, 1, nextAsset.aliases);
      activeRoundId.current = result.roundId;
      setNotice("Drawing live. Twitch chat can guess now.");
    } catch { setNotice("Drawing locally. Live chat could not start."); }
  };

  const nextDrawing = async () => {
    if (maybeOpenAutomaticFeedback(() => void performNextDrawing())) return;
    await performNextDrawing();
  };

  const revealAnswer = () => {
    setStatus("complete");
    setGuessFeedback("idle");
    setNotice("The answer was revealed.");
    maybeOpenAutomaticFeedback();
    void closeLiveRound();
  };

  const openWordFeedback = () => {
    if (!asset) return;
    setFeedbackTarget({
      answer: asset.answer,
      categoryId: asset.category,
      difficulty: asset.difficulty === "Easy" ? "easy" : asset.difficulty === "Hard" ? "hard" : "medium",
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

  const maybeOpenAutomaticFeedback = (afterFeedback?: () => void) => {
    if (!asset) return false;
    feedbackRoundsSinceAutoRef.current += 1;
    const target: WordFeedbackTarget = {
      answer: asset.answer,
      categoryId: asset.category,
      difficulty: asset.difficulty === "Easy" ? "easy" : asset.difficulty === "Hard" ? "hard" : "medium",
    };
    if (!shouldPromptForWordFeedback(wordFeedback, target, feedbackRoundsSinceAutoRef.current)) return false;
    feedbackRoundsSinceAutoRef.current = 0;
    pendingFeedbackActionRef.current = afterFeedback ?? null;
    setFeedbackTarget(target);
    return true;
  };

  const isCategoryOptionActive = (optionId: string): boolean => {
    return isCategorySelectionOptionActive(selectedCategory, optionId, "autoDraw");
  };

  const chooseCategory = (toggledId: string) => {
    if (toggledId === "all") {
      setSelectedCategory("all");
      const first = AUTO_DRAW_ASSETS.findIndex((item) => matchesCategory(item.category, "all"));
      if (first >= 0) setAssetIndex(first);
      reset();
      return;
    }

    const nextSelection = toggleCategorySelectionOption(selectedCategory, toggledId, "autoDraw", "empty");

    setSelectedCategory(nextSelection);
    const first = AUTO_DRAW_ASSETS.findIndex((item) => matchesCategory(item.category, nextSelection));
    if (first >= 0) setAssetIndex(first);
    reset();
  };

  const selectAllCategories = () => {
    const allGameTokens = GAME_TITLES.map((g) => `game:${g.id}`).join(",");
    setSelectedCategory(allGameTokens);
    const first = AUTO_DRAW_ASSETS.findIndex((item) => matchesCategory(item.category, allGameTokens));
    if (first >= 0) setAssetIndex(first);
    reset();
  };

  const resetMixCategories = () => {
    setSelectedCategory("");
    reset();
  };

  const removeCategoryChip = (chipId: string) => {
    const nextSelection = removeCategorySelectionChip(selectedCategory, chipId, "autoDraw", "empty");
    setSelectedCategory(nextSelection);
    const first = AUTO_DRAW_ASSETS.findIndex((item) => matchesCategory(item.category, nextSelection));
    if (first >= 0) setAssetIndex(first);
    reset();
  };

  const applyCategorySelection = (selectionId: string) => {
    setSelectedCategory(selectionId);
    const first = AUTO_DRAW_ASSETS.findIndex((item) => matchesCategory(item.category, selectionId));
    if (first >= 0) setAssetIndex(first);
    reset();
  };

  const nextClue = () => {
    if (status === "idle") { void startDrawing(); return; }
    if (stageIndex < maximumGuessStage) {
      transitionProgressRef.current = 0;
      setTransitionProgress(0);
      setStageIndex((index) => index + 1);
      setStatus("playing");
      setNotice("A stronger clue is being added.");
    } else {
      void closeLiveRound();
      transitionProgressRef.current = 1;
      setTransitionProgress(1);
      setStatus("complete");
      setNotice(`The answer was ${asset.answer}.`);
    }
  };

  const submitGuess = () => {
    if (status !== "playing" && status !== "paused") return;
    if (aliases.includes(normalize(guess))) {
      void closeLiveRound();
      setGuess(asset.answer);
      setGuessFeedback("correct");
      transitionProgressRef.current = 1;
      setTransitionProgress(1);
      setStatus("complete");
      setNotice(`Correct. The answer is ${asset.answer}.`);
    } else {
      setGuessFeedback("idle");
      requestAnimationFrame(() => setGuessFeedback("wrong"));
      if (stageIndex < maximumGuessStage) {
        transitionProgressRef.current = 0;
        setTransitionProgress(0);
        setStageIndex((index) => Math.min(maximumGuessStage, index + 1));
        setStatus("playing");
      }
      setNotice(`${guess.trim() || "That"} is not the answer.`);
    }
  };

  const startResize = (panel: ResizeState["panel"], event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStateRef.current = { panel, startX: event.clientX, startWidth: panel === "source" ? sourceRailWidth : sidePanelWidth };
    document.body.classList.add("resizing-panels");
  };

  const currentStage = asset.stages[Math.min(stageIndex, maximumGuessStage)];
  const previousStageReveal = stageIndex === 0 ? 0 : asset.stages[Math.min(stageIndex - 1, maximumGuessStage)].reveal;
  const revealProgress = status === "complete"
    ? 1
    : status === "idle"
      ? 0
      : previousStageReveal + (currentStage.reveal - previousStageReveal) * transitionProgress;
  const revealPercent = Math.round(revealProgress * 100);
  const obscurity = Math.max(0, 100 - revealPercent);
  const typedCharacters = guess.replace(/\s/g, "").split("");
  const answerSlots = asset.answer.replace(/\s/g, "").length;
  const overflowCharacters = typedCharacters.slice(answerSlots);
  const selectedTokens = selectedCategory === "all" ? ["all"] : selectedCategory === "empty" ? [] : selectedCategory.split(",").filter(Boolean);
  const activeSelectionChips = useMemo(() => getActiveSelectionChips(selectedCategory, "autoDraw"), [selectedCategory]);

  const selectedLabel = selectedCategory === "all"
    ? "All Games Shuffled"
    : selectedCategory === ""
      ? "No Decks Selected"
      : selectedTokens.length === 1
        ? selectedTokens[0].startsWith("game:")
          ? `All ${GAME_TITLES.find((g) => g.id === selectedTokens[0].slice(5))?.label ?? selectedTokens[0].slice(5)}`
          : selectedTokens[0]
        : `${selectedTokens.length} Decks Selected`;

  const selectedIcon = selectedCategory === "" ? "warning" : selectedCategory === "all" ? "casino" : selectedTokens.length > 1 ? "style" : "sports_esports";
  const selectedCategoryOption = {
    id: selectedCategory === "" ? "empty" : selectedCategory,
    label: selectedLabel,
    description: selectedCategory === ""
      ? "Please select at least one deck."
      : selectedCategory === "all"
      ? "A shuffled mix from every Auto Draw deck."
      : `${selectedTokens.length} deck${selectedTokens.length === 1 ? "" : "s"} selected.`,
    icon: selectedIcon,
    accent: selectedCategory === "" ? "#e6a283" : (selectedTokens[0]?.startsWith("game:")
      ? GAME_TITLES.find((g) => g.id === selectedTokens[0].slice(5))?.accent ?? "#83c5e6"
      : "#83c5e6"),
  };

  return (
    <div className="dashboard-layout auto-draw-page auto-workspace" style={{ "--source-rail-width": `${sourceRailWidth}px`, "--side-panel-width": `${sidePanelWidth}px` } as CSSProperties}>
      <aside className="stream-sidebar auto-stream-sidebar" aria-label="Stream sources">
        <WorkspaceIdentity connected={twitchSession.authenticated} configured={twitchSession.configured} displayName={twitchSession.user?.displayName ?? null} onDisconnectTwitch={() => void disconnectFromTwitch()} onModes={() => onNavigate("/")} returnTo="/auto-draw" subtitle="Auto Draw sketchbook" />
        <section className="source-card camera-source-card">
          <header className="source-card-header"><div><span className="source-eyebrow">Camera frame</span><h2>Streamer camera</h2></div><span className="source-status ready"><i/>OBS</span></header>
          <div className="camera-preview auto-camera-preview"><span className="material-symbols-outlined">videocam</span><strong>Camera window</strong><small>Place your camera source over this frame in OBS.</small></div>
        </section>
        <section className="source-card chat-source-card auto-chat-source-card">
          <header className="source-card-header"><div><span className="source-eyebrow">Audience notes</span><h2>Twitch live chat</h2></div><span className={`source-status ${twitchLive ? "ready" : ""}`}><i/>{twitchLive ? "Live" : "Offline"}</span></header>
          <div className="source-chat-list" aria-live="polite">
            {chatMessages.length ? chatMessages.map((message) => <div className="source-chat-message" key={message.id}><span>{message.name.slice(0, 1)}</span><p><strong>{message.name}</strong>{message.message}</p></div>) : <div className="source-empty-state"><span className="material-symbols-outlined">forum</span><strong>Chat appears here</strong><small>{twitchLive ? "Start a drawing and audience guesses will arrive live." : "Connect Twitch from your profile to receive chat."}</small></div>}
            {solvers.map((solver) => <div className="auto-chat-solver" key={solver.userId}><span className="material-symbols-outlined">workspace_premium</span>{solver.name} solved it first</div>)}
          </div>
        </section>
      </aside>

      <div aria-label="Resize camera and chat panels" aria-orientation="vertical" aria-valuemax={520} aria-valuemin={280} aria-valuenow={sourceRailWidth} className="layout-resizer source-rail-resizer" onPointerDown={(event) => startResize("source", event)} role="separator"/>

      <main className="dashboard-shell auto-dashboard-shell">
        <section className="dashboard-grid auto-dashboard-grid">
          <div className="main-column auto-main-column">
            <div className={`prompt-board auto-guess-bar ${guessFeedback}${guessFocused ? " selected" : ""}${status === "idle" ? " disabled" : ""}`} onClick={() => { if (status === "playing" || status === "paused") guessInputRef.current?.focus(); }}>
              <div aria-hidden="true" className="auto-guess-letters" style={{ fontSize: `clamp(14px, ${45 / Math.max(1, status === "idle" ? 5 : asset.answer.length)}vw, 34px)` }}>
                {status === "idle" ? (
                  "     ".split("").map((_, index) => <span key={index}>_</span>)
                ) : (
                  <>
                    {asset.answer.split("").map((letter, index) => {
                      if (letter === " ") return <span className="auto-guess-space" key={`space-${index}`}/>;
                      const slotIndex = asset.answer.slice(0, index).replace(/\s/g, "").length;
                      const typed = status === "complete" ? letter : typedCharacters[slotIndex];
                      return <span className={typed ? "filled" : ""} key={index}>{typed ? typed.toUpperCase() : "_"}</span>;
                    })}
                    {status !== "complete" && overflowCharacters.map((letter, index) => <span className="auto-guess-overflow" key={`extra-${index}`}>{letter.toUpperCase()}</span>)}
                  </>
                )}
              </div>
              <button aria-label="Give word feedback" className="word-feedback-trigger auto-feedback-trigger" onClick={(event) => { event.stopPropagation(); openWordFeedback(); }} title="Give word feedback" type="button">
                <span className="material-symbols-outlined">rate_review</span>
              </button>
              <input aria-label="Type your AutoDraw answer" autoComplete="off" disabled={status === "idle" || status === "complete"} maxLength={80} onBlur={() => setGuessFocused(false)} onChange={(event) => { setGuess(event.target.value); if (guessFeedback === "wrong") setGuessFeedback("idle"); }} onFocus={() => setGuessFocused(true)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitGuess(); } }} ref={guessInputRef} value={guess}/>
            </div>
            <span aria-live="polite" className="auto-guess-announcement">{notice}</span>

            <section className="auto-canvas-card"><span className="auto-canvas-tape tape-left"/><span className="auto-canvas-tape tape-right"/>
              <div className="auto-stage-timer"><span>{obscurity}% obscured</span><strong>{status === "playing" ? `${obscurity}%` : status === "paused" ? "Paused" : status === "complete" ? "Revealed" : "Ready"}</strong></div>
              <div className="auto-canvas-wrap"><AutoDrawCanvas active={status !== "idle"} asset={asset} paused={status === "paused"} resetToken={canvasResetToken} stageIndex={status === "complete" ? asset.stages.length - 1 : stageIndex} stageProgress={status === "complete" ? 1 : transitionProgress}/>{status === "idle" && <div className="auto-canvas-empty"><span className="material-symbols-outlined">edit_note</span><strong>The page is waiting</strong><small>Start the round to cover the sketch in clouds.</small></div>}</div>
              <div aria-label={`${revealPercent} percent of the full reveal`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={revealPercent} className="auto-stage-progress" role="progressbar"><span style={{ width: `${revealPercent}%` }}/></div>
            </section>

            <section className="auto-controls" aria-label="AutoDraw controls">
              <button className="primary" onClick={() => status === "idle" ? void startDrawing() : void nextDrawing()} type="button">
                <span className="material-symbols-outlined">{status === "idle" ? "play_arrow" : "skip_next"}</span>
                {status === "idle" ? "Start round" : "Next round"}
              </button>
              
              <button disabled={status === "idle" || status === "complete"} onClick={revealAnswer} type="button">
                <span className="material-symbols-outlined">visibility</span>Reveal answer
              </button>
              
              <button disabled={status === "complete"} onClick={nextClue} type="button">
                <span className="material-symbols-outlined">fast_forward</span>Next clue
              </button>
              
              <button onClick={() => reset("idle")} type="button">
                <span className="material-symbols-outlined">stop</span>End round
              </button>
            </section>
          </div>

          <div aria-label="Resize right panels" aria-orientation="vertical" aria-valuemax={420} aria-valuemin={230} aria-valuenow={sidePanelWidth} className="layout-resizer side-panel-resizer" onPointerDown={(event) => startResize("side", event)} role="separator"/>

          <aside className="side-column auto-right-rail" aria-label="Round setup">
            <section className="feed-card support-card auto-category-card artist-category-copy">
              <div className="support-tabs" role="tablist" aria-label="AutoDraw categories"><button aria-selected="true" className="active" role="tab" type="button"><span className="material-symbols-outlined">category</span>Categories</button></div>
              <div className="support-panel-content category-panel" role="tabpanel">
                <div className="active-categories-panel">
                  <CategoryPickerWindow
                    currentSelection={selectedCategory}
                    disabled={status === "playing" || status === "paused"}
                    domains={getCategoryDomains("autoDraw")}
                    isOptionActive={isCategoryOptionActive}
                    lockedNote="Finish or reset the current drawing to change decks."
                    onApplySelection={applyCategorySelection}
                    onChange={chooseCategory}
                    onRemoveChip={removeCategoryChip}
                    onReset={resetMixCategories}
                    onSelectAll={selectAllCategories}
                    profileStorageKey="autoDraw"
                    selectedChips={activeSelectionChips}
                    selectedId={selectedCategory}
                    selectedOption={selectedCategoryOption}
                  />
                  <CategorySelectionTools
                    chips={activeSelectionChips}
                    disabled={status === "playing" || status === "paused"}
                    mode="autoDraw"
                    onRemoveChip={removeCategoryChip}
                  />
                  
                </div>
              </div>
            </section>
            <section aria-label="Reserved panel" className="feed-card auto-blank-panel"/>
          </aside>
        </section>
      </main>
      <WordFeedbackModal
        modeLabel="Auto Draw"
        onClose={closeWordFeedback}
        onSubmit={submitWordFeedback}
        target={feedbackTarget}
      />
    </div>
  );
}
