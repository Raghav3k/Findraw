export type FeedbackMode = "artist" | "room" | "autoDraw";
export type WordFeedbackContext = "experience" | "skip";
export type WordExperienceFeedbackRating = "very_good" | "mid" | "bad";
export type WordSkipFeedbackReason = "not_interested" | "not_fun" | "unrecognized";
export type WordFeedbackRating = WordExperienceFeedbackRating | WordSkipFeedbackReason;

export type WordFeedbackTarget = {
  answer: string;
  categoryId: string;
  difficulty?: "easy" | "medium" | "hard";
};

export type WordFeedbackStats = {
  shown: number;
  submitted: number;
  veryGood: number;
  mid: number;
  bad: number;
  notInterested: number;
  notFun: number;
  unrecognized: number;
  skipped: number;
  lastFeedbackAt: number;
};

export type WordFeedbackMap = Record<string, WordFeedbackStats>;
type StoredWordFeedbackStats = Partial<WordFeedbackStats> & { good?: number };

export const getWordFeedbackKey = (target: WordFeedbackTarget) => (
  `${target.categoryId}:${target.answer.toLocaleLowerCase("en")}`
);

export const emptyWordFeedbackStats = (): WordFeedbackStats => ({
  shown: 0,
  submitted: 0,
  veryGood: 0,
  mid: 0,
  bad: 0,
  notInterested: 0,
  notFun: 0,
  unrecognized: 0,
  skipped: 0,
  lastFeedbackAt: 0,
});

export const normalizeWordFeedbackStats = (stats?: StoredWordFeedbackStats): WordFeedbackStats => ({
  shown: stats?.shown ?? 0,
  submitted: stats?.submitted ?? 0,
  veryGood: stats?.veryGood ?? 0,
  mid: stats?.mid ?? stats?.good ?? 0,
  bad: stats?.bad ?? 0,
  notInterested: stats?.notInterested ?? 0,
  notFun: stats?.notFun ?? 0,
  unrecognized: stats?.unrecognized ?? 0,
  skipped: stats?.skipped ?? 0,
  lastFeedbackAt: stats?.lastFeedbackAt ?? 0,
});

export const recordWordFeedback = (
  feedback: WordFeedbackMap,
  target: WordFeedbackTarget,
  rating: WordFeedbackRating | "skip",
): WordFeedbackMap => {
  const key = getWordFeedbackKey(target);
  const current = normalizeWordFeedbackStats(feedback[key]);
  const next: WordFeedbackStats = {
    ...current,
    shown: current.shown + 1,
    lastFeedbackAt: Date.now(),
  };

  if (rating === "skip") {
    next.skipped += 1;
  } else {
    next.submitted += 1;
    if (rating === "very_good") next.veryGood += 1;
    else if (rating === "mid") next.mid += 1;
    else if (rating === "not_interested") next.notInterested += 1;
    else if (rating === "not_fun") next.notFun += 1;
    else if (rating === "unrecognized") next.unrecognized += 1;
    else next.bad += 1;
  }

  return {
    ...feedback,
    [key]: next,
  };
};

export const shouldPromptForWordFeedback = (
  feedback: WordFeedbackMap,
  target: WordFeedbackTarget,
  roundsSincePrompt: number,
) => {
  if (target.difficulty === "easy" || roundsSincePrompt < 5) return false;
  const storedStats = feedback[getWordFeedbackKey(target)];
  if (!storedStats) return target.difficulty === "hard" && roundsSincePrompt >= 7;

  const stats = normalizeWordFeedbackStats(storedStats);
  const badSignals = stats.bad + stats.notFun + stats.unrecognized + stats.skipped;
  const strongSignals = stats.veryGood;
  if (badSignals >= 2 && badSignals >= strongSignals) return true;
  if (target.difficulty === "hard" && roundsSincePrompt >= 8 && stats.submitted < 2) return true;
  if (target.difficulty === "medium" && roundsSincePrompt >= 10 && stats.bad > stats.veryGood) return true;
  return false;
};
