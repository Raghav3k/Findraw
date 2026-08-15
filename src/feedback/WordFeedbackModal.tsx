import type { WordFeedbackContext, WordFeedbackRating, WordFeedbackTarget } from "./wordFeedback";

type WordFeedbackModalProps = {
  context: WordFeedbackContext;
  modeLabel: string;
  onClose: () => void;
  onSubmit: (rating: WordFeedbackRating | "skip") => void;
  target: WordFeedbackTarget | null;
};

const EXPERIENCE_OPTIONS: Array<{
  rating: WordFeedbackRating;
  image: string;
  label: string;
}> = [
  { rating: "very_good", image: "/feedback/mona-lisa-very-good.webp", label: "Insane Mona Lisa" },
  { rating: "mid", image: "/feedback/mona-lisa-mid.webp", label: "Mid Mona Lisa" },
  { rating: "bad", image: "/feedback/mona-lisa-bad.webp", label: "Child drawing" },
];

const SKIP_OPTIONS: Array<{
  rating: WordFeedbackRating;
  icon: string;
  label: string;
}> = [
  { rating: "not_interested", icon: "do_not_disturb_on", label: "Not interested" },
  { rating: "not_fun", icon: "sentiment_dissatisfied", label: "Not a fun word" },
  { rating: "unrecognized", icon: "help", label: "What is that word?" },
];

export function WordFeedbackModal({ context, modeLabel, onClose, onSubmit, target }: WordFeedbackModalProps) {
  if (!target) return null;
  const isSkipContext = context === "skip";
  const title = isSkipContext ? "Why did you skip this word?" : "How fun was this word to draw?";

  return (
    <div className="word-feedback-layer" role="presentation">
      <button aria-label="Close word feedback" className="word-feedback-backdrop" onClick={onClose} type="button" />
      <section aria-label="Word feedback" aria-modal="true" className="word-feedback-dialog" role="dialog">
        <header>
          <small>{modeLabel} word feedback</small>
          <h2>{title}</h2>
          <button aria-label="Close feedback" onClick={onClose} type="button">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <div className="word-feedback-word">
          <span>{target.categoryId}</span>
          <strong>{target.answer}</strong>
        </div>
        <div className={`word-feedback-options word-feedback-options--${context}`}>
          {(isSkipContext ? SKIP_OPTIONS : EXPERIENCE_OPTIONS).map((option) => (
            <button key={option.rating} onClick={() => onSubmit(option.rating)} type="button">
              {"image" in option
                ? <img alt="" src={option.image} />
                : <span className="material-symbols-outlined">{option.icon}</span>}
              <strong>{option.label}</strong>
            </button>
          ))}
        </div>
        <button className="word-feedback-skip" onClick={() => onSubmit("skip")} type="button">
          Not now
        </button>
      </section>
    </div>
  );
}
