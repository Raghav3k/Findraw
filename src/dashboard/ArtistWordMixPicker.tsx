import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  ARTIST_GAME_PACKS,
  ARTIST_GENERAL_PACKS,
  DEFAULT_ARTIST_WORD_MIX,
  GENERAL_MIXED_PACK_ID,
  normalizeArtistWordMix,
  type ArtistPackKind,
  type ArtistWordMix,
  type ArtistWordPack,
} from "./artistWordPacks";

type Step = "kind" | "packs";

type ArtistWordMixPickerProps = {
  initialMix: ArtistWordMix;
  open: boolean;
  required?: boolean;
  onApply: (mix: ArtistWordMix) => void;
  onClose: () => void;
};

export function ArtistWordMixPicker({ initialMix, onApply, onClose, open, required = false }: ArtistWordMixPickerProps) {
  const [draft, setDraft] = useState(() => normalizeArtistWordMix(initialMix));
  const [query, setQuery] = useState("");
  const [step, setStep] = useState<Step>(required ? "kind" : "packs");

  useEffect(() => {
    if (!open) return;
    setDraft(normalizeArtistWordMix(initialMix));
    setQuery("");
    setStep(required ? "kind" : "packs");
  }, [initialMix, open, required]);

  const availablePacks = draft.kind === "game" ? ARTIST_GAME_PACKS : ARTIST_GENERAL_PACKS;
  const visiblePacks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en");
    if (!normalizedQuery) return availablePacks;
    return availablePacks.filter((pack) => `${pack.label} ${pack.description}`.toLocaleLowerCase("en").includes(normalizedQuery));
  }, [availablePacks, query]);
  const canApply = draft.kind === "general" || draft.packIds.length > 0;

  const chooseKind = (kind: ArtistPackKind) => {
    setDraft((current) => current.kind === kind ? current : (kind === "general" ? DEFAULT_ARTIST_WORD_MIX : { kind: "game", packIds: [] }));
    setQuery("");
    setStep("packs");
  };

  const togglePack = (packId: string) => {
    setDraft((current) => {
      if (current.kind === "general" && packId === GENERAL_MIXED_PACK_ID) return DEFAULT_ARTIST_WORD_MIX;
      const withoutMixed = current.packIds.filter((id) => id !== GENERAL_MIXED_PACK_ID);
      const selected = withoutMixed.includes(packId)
        ? withoutMixed.filter((id) => id !== packId)
        : [...withoutMixed, packId];
      if (current.kind === "general" && selected.length === 0) return DEFAULT_ARTIST_WORD_MIX;
      return { ...current, packIds: selected };
    });
  };

  const apply = () => {
    const next = normalizeArtistWordMix(draft);
    onApply(next);
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div className="artist-word-mix-layer">
      <div className="artist-word-mix-backdrop" />
      <section aria-label="Choose your Artist Mode word mix" aria-modal="true" className="artist-word-mix-window" role="dialog">
        <header className="artist-word-mix-header">
          <div>
            <small>Artist Mode setup</small>
            <h2>{step === "kind" ? "What should your stream draw?" : draft.kind === "game" ? "Choose your games" : "Choose general interests"}</h2>
            <p>{step === "kind" ? "Pick a starting point. You can change it whenever a round is not active." : "Choose as many as you like. Every pack uses familiar, drawable words."}</p>
          </div>
          {!required ? <button aria-label="Close word mix" className="artist-word-mix-close" onClick={onClose} type="button"><span className="material-symbols-outlined">close</span></button> : null}
        </header>

        {step === "kind" ? (
          <div className="artist-word-kind-grid">
            <button className="artist-word-kind-card gaming" onClick={() => chooseKind("game")} type="button">
              <span className="material-symbols-outlined">sports_esports</span>
              <small>For game communities</small>
              <strong>Gaming Worlds</strong>
              <p>Familiar words from games you and your chat already know.</p>
              <b>Choose games <span className="material-symbols-outlined">arrow_forward</span></b>
            </button>
            <button className="artist-word-kind-card general" onClick={() => chooseKind("general")} type="button">
              <span className="material-symbols-outlined">auto_awesome</span>
              <small>Easy to jump into</small>
              <strong>General Fun</strong>
              <p>Simple animals, food, places, entertainment and everyday things.</p>
              <b>Choose interests <span className="material-symbols-outlined">arrow_forward</span></b>
            </button>
          </div>
        ) : null}

        {step === "packs" ? (
          <div className="artist-word-pack-step">
            <div className="artist-word-mix-toolbar">
              <button className="artist-word-back" onClick={() => setStep("kind")} type="button"><span className="material-symbols-outlined">arrow_back</span>Change type</button>
              <div className="artist-word-kind-switch" role="tablist" aria-label="Word mix type">
                <button aria-selected={draft.kind === "game"} className={draft.kind === "game" ? "active" : ""} onClick={() => chooseKind("game")} role="tab" type="button">Games</button>
                <button aria-selected={draft.kind === "general"} className={draft.kind === "general" ? "active" : ""} onClick={() => chooseKind("general")} role="tab" type="button">General</button>
              </div>
              <span>{draft.kind === "general" && draft.packIds.includes(GENERAL_MIXED_PACK_ID) ? "Mixed selected" : `${draft.packIds.length} selected`}</span>
            </div>

            {draft.kind === "game" ? (
              <label className="artist-game-search">
                <span className="material-symbols-outlined">search</span>
                <input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder="Search reviewed games..." type="search" value={query} />
              </label>
            ) : null}

            <div className="artist-word-pack-grid scrollable">
              {draft.kind === "general" ? (
                <PackButton
                  active={draft.packIds.includes(GENERAL_MIXED_PACK_ID)}
                  onClick={() => togglePack(GENERAL_MIXED_PACK_ID)}
                  pack={{ id: GENERAL_MIXED_PACK_ID, label: "Mixed", description: "A balanced shuffle from every familiar General pack.", kind: "general", icon: "casino", accent: "#f2d98b", words: [] }}
                />
              ) : null}
              {visiblePacks.map((pack) => <PackButton active={draft.packIds.includes(pack.id)} key={pack.id} onClick={() => togglePack(pack.id)} pack={pack} />)}
              {visiblePacks.length === 0 ? (
                <div className="artist-game-empty">
                  <span className="material-symbols-outlined">search_off</span>
                  <strong>No reviewed game pack yet</strong>
                  <p>Try another title. Topic requests will be added after the core experience is validated.</p>
                </div>
              ) : null}
            </div>

            <footer className="artist-word-mix-footer">
              <p>{draft.kind === "game" && !canApply ? "Choose at least one game." : "No obscure or hard words are included in this reviewed collection."}</p>
              <button disabled={!canApply} onClick={apply} type="button">Use selected mix <span className="material-symbols-outlined">check</span></button>
            </footer>
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

function PackButton({ active, onClick, pack }: { active: boolean; onClick: () => void; pack: ArtistWordPack }) {
  return (
    <button aria-pressed={active} className={`artist-word-pack-card ${active ? "active" : ""}`} onClick={onClick} style={{ "--pack-accent": pack.accent } as CSSProperties} type="button">
      <span className="material-symbols-outlined">{active ? "check" : pack.icon}</span>
      <span><strong>{pack.label}</strong><small>{pack.description}</small></span>
    </button>
  );
}
