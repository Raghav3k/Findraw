import { type CSSProperties } from "react";
import {
  type CategorySelectionChip,
  type FindrawModePool,
} from "./gameData";

type CategorySelectionToolsProps = {
  chips: CategorySelectionChip[];
  disabled?: boolean;
  mode: FindrawModePool;
  onRemoveChip: (chipId: string) => void;
};

export function CategorySelectionTools({
  chips,
  disabled = false,
  onRemoveChip,
}: CategorySelectionToolsProps) {
  return (
    <div className="category-side-tools">
      <section className="category-preview-selection category-side-active-selection">
        <span className="selection-title">Active Selection</span>
        <div className="selection-chips scrollable">
          {chips.map((chip) => (
            <span className={`chip ${chip.kind === "all" ? "active-all" : ""} ${chip.kind === "empty" ? "empty" : ""}`} key={chip.id} style={{ "--chip-accent": chip.accent } as CSSProperties}>
              {chip.label}
              {chip.tooltip ? <span className="chip-tooltip">{chip.tooltip}</span> : null}
              {chip.kind !== "empty" ? (
                <button aria-label={`Remove ${chip.label}`} disabled={disabled} onClick={() => onRemoveChip(chip.id)} type="button">
                  <span className="material-symbols-outlined">close</span>
                </button>
              ) : null}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
