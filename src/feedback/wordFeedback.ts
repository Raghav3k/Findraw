export type FeedbackMode = "artist" | "room" | "autoDraw";
export type WordFeedbackRating = "very_good" | "good" | "bad";

export type WordFeedbackTarget = {
  answer: string;
  categoryId: string;
  difficulty?: "easy" | "medium" | "hard";
};

export type WordFeedbackStats = {
  shown: number;
  submitted: number;
  veryGood: number;
  good: number;
  bad: number;
  skipped: number;
  lastFeedbackAt: number;
};

export type WordFeedbackMap = Record<string, WordFeedbackStats>;

export const getWordFeedbackKey = (target: WordFeedbackTarget) => (
  `${target.categoryId}:${target.answer.toLocaleLowerCase("en")}`
);

export const emptyWordFeedbackStats = (): WordFeedbackStats => ({
  shown: 0,
  submitted: 0,
  veryGood: 0,
  good: 0,
  bad: 0,
  skipped: 0,
  lastFeedbackAt: 0,
});

export const recordWordFeedback = (
  feedback: WordFeedbackMap,
  target: WordFeedbackTarget,
  rating: WordFeedbackRating | "skip",
): WordFeedbackMap => {
  const key = getWordFeedbackKey(target);
  const current = feedback[key] ?? emptyWordFeedbackStats();
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
    else if (rating === "good") next.good += 1;
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
  const stats = feedback[getWordFeedbackKey(target)];
  if (!stats) return target.difficulty === "hard" && roundsSincePrompt >= 7;

  const badSignals = stats.bad + stats.skipped;
  const goodSignals = stats.veryGood + stats.good;
  if (badSignals >= 2 && badSignals >= goodSignals) return true;
  if (target.difficulty === "hard" && roundsSincePrompt >= 8 && stats.submitted < 2) return true;
  if (target.difficulty === "medium" && roundsSincePrompt >= 10 && stats.bad > stats.veryGood) return true;
  return false;
};
