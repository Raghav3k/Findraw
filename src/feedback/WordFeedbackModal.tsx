import type { WordFeedbackRating, WordFeedbackTarget } from "./wordFeedback";

type WordFeedbackModalProps = {
  modeLabel: string;
  onClose: () => void;
  onSubmit: (rating: WordFeedbackRating | "skip") => void;
  target: WordFeedbackTarget | null;
};

const FEEDBACK_OPTIONS: Array<{
  rating: WordFeedbackRating;
  image: string;
  label: string;
}> = [
  { rating: "very_good", image: "/feedback/mona-lisa-very-good.webp", label: "Insane Mona Lisa" },
  { rating: "good", image: "/feedback/mona-lisa-good.webp", label: "Okay Mona Lisa" },
  { rating: "bad", image: "/feedback/mona-lisa-bad.webp", label: "Child drawing" },
];

export function WordFeedbackModal({ modeLabel, onClose, onSubmit, target }: WordFeedbackModalProps) {
  if (!target) return null;

  return (
    <div className="word-feedback-layer" role="presentation">
      <button aria-label="Close word feedback" className="word-feedback-backdrop" onClick={onClose} type="button" />
      <section aria-label="Word feedback" aria-modal="true" className="word-feedback-dialog" role="dialog">
        <header>
          <small>{modeLabel} word feedback</small>
          <h2>How fun was this word to draw?</h2>
          <button aria-label="Close feedback" onClick={onClose} type="button">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <div className="word-feedback-word">
          <span>{target.categoryId}</span>
          <strong>{target.answer}</strong>
        </div>
        <div className="word-feedback-options">
          {FEEDBACK_OPTIONS.map((option) => (
            <button key={option.rating} onClick={() => onSubmit(option.rating)} type="button">
              <img alt="" src={option.image} />
              <strong>{option.label}</strong>
            </button>
          ))}
        </div>
        <button className="word-feedback-skip" onClick={() => onSubmit("skip")} type="button">
          Skip
        </button>
      </section>
    </div>
  );
}
