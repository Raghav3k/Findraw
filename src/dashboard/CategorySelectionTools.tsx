import { useMemo, useState, type CSSProperties } from "react";
import {
  getCategoryModel,
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
  mode,
  onRemoveChip,
}: CategorySelectionToolsProps) {
  const [legendOpen, setLegendOpen] = useState(false);

  const colorItems = useMemo(() => (
    getCategoryModel(mode)
      .flatMap((domain) => domain.collections.map((collection) => ({
        id: `${domain.id}:${collection.id}`,
        label: collection.label,
        accent: collection.accent,
      })))
  ), [mode]);

  return (
    <div className="category-side-tools">
      <section className="category-preview-selection category-side-active-selection">
        <span className="selection-title">Active Selection</span>
        <div className="selection-chips scrollable">
          {chips.map((chip) => (
            <span className={`chip ${chip.kind === "all" ? "active-all" : ""} ${chip.kind === "empty" ? "empty" : ""}`} key={chip.id} style={{ "--chip-accent": chip.accent } as CSSProperties}>
              {chip.label}
              {chip.kind !== "empty" ? (
                <button aria-label={`Remove ${chip.label}`} disabled={disabled} onClick={() => onRemoveChip(chip.id)} type="button">
                  <span className="material-symbols-outlined">close</span>
                </button>
              ) : null}
            </span>
          ))}
        </div>
      </section>

      <div className="category-color-tools">
        <button aria-expanded={legendOpen} className="category-color-button" onClick={() => setLegendOpen((current) => !current)} type="button">
          <span className="material-symbols-outlined">palette</span>
          Color codes
        </button>
        {legendOpen ? (
          <section className="category-color-panel">
            {colorItems.map((item) => (
              <span className="category-color-item" key={item.id}>
                <i style={{ "--legend-accent": item.accent } as CSSProperties} />
                {item.label}
              </span>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}
