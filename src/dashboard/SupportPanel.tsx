import { useState } from "react";
import {
  SHORTCUT_LABELS,
  type KeyboardShortcuts,
  type ShortcutAction,
} from "./keyboardShortcuts";
import {
  getCategory,
  UNIFIED_DOMAINS,
  GAME_TITLES,
  type CategorySelection,
  type WordCategory,
} from "./gameData";
import { usePersistentState } from "../ui/usePersistentState";
import type { TwitchSession } from "../twitch/twitchApi";
import { CategoryPickerWindow } from "../ui/CategoryPickerWindow";

type SupportTab = "categories" | "settings";

const SKETCHED_GAME_CATEGORIES = new Set([
  "clash-of-clans",
  "clash-royale",
  "deadlock",
  "fortnite",
  "minecraft",
  "rainbow-six-siege",
  "valorant",
]);



type SupportPanelProps = {
  currentCategoryId: string;
  selectedCategoryId: CategorySelection;
  randomCategory: WordCategory;
  roundActive: boolean;
  onCategoryChange: (categoryId: string) => void;
  onSelectAll: () => void;
  onResetCategories: () => void;
  hoverMenuDelay: number;
  hoverMenusEnabled: boolean;
  onHoverMenuDelayChange: (delay: number) => void;
  onHoverMenusEnabledChange: (enabled: boolean) => void;
  shortcuts: KeyboardShortcuts;
  onShortcutChange: (action: ShortcutAction, key: string) => void;
  onShortcutsReset: () => void;
  twitchSession: TwitchSession;
  connectionNotice: string;
  onConnectTwitch: () => void;
  onDisconnectTwitch: () => void;
};

export function SupportPanel({
  currentCategoryId,
  selectedCategoryId,
  randomCategory,
  roundActive,
  onCategoryChange,
  onSelectAll,
  onResetCategories,
  hoverMenuDelay,
  hoverMenusEnabled,
  onHoverMenuDelayChange,
  onHoverMenusEnabledChange,
  shortcuts,
  onShortcutChange,
  onShortcutsReset,
  twitchSession,
  connectionNotice,
  onConnectTwitch,
  onDisconnectTwitch,
}: SupportPanelProps) {
  const [activeTab, setActiveTab] = useState<SupportTab>("categories");
  const [showTimer, setShowTimer] = usePersistentState("settings.showTimer", true);
  const [chatSounds, setChatSounds] = usePersistentState("settings.chatSounds", false);
  const [confirmEnd, setConfirmEnd] = usePersistentState("settings.confirmEnd", true);
  const shortcutActions = Object.keys(shortcuts) as ShortcutAction[];

  const selectedTokens = selectedCategoryId.split(",").filter(Boolean);
  const isCategoryOptionActive = (optionId: string) => {
    if (selectedCategoryId === "random") return optionId === "random";
    if (selectedTokens.includes(optionId)) return true;
    if (optionId === "all" && selectedTokens.includes("all")) return true;
    if (optionId.startsWith("game:") && selectedTokens.includes(optionId)) return true;
    return false;
  };

  const selectedCategory = selectedCategoryId === "random" || selectedTokens.length > 1
    ? randomCategory
    : getCategory(selectedCategoryId) ?? randomCategory;
  const currentCategory = getCategory(currentCategoryId);
  const selectedCategoryArtwork = selectedCategory.id === "random" || selectedTokens.length > 1
    ? "/category-art/random.jpg"
    : `/category-art/${selectedCategory.id.replace("game:", "")}.jpg`;

  return (
    <section className="feed-card support-card">
      <div className="support-tabs" role="tablist" aria-label="Categories and settings">
        <button aria-selected={activeTab === "categories"} className={activeTab === "categories" ? "active" : ""} onClick={() => setActiveTab("categories")} role="tab" type="button">
          <span className="material-symbols-outlined">category</span>Categories
        </button>
        <button aria-selected={activeTab === "settings"} className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")} role="tab" type="button">
          <span className="material-symbols-outlined">settings</span>Settings
        </button>
      </div>

      {activeTab === "categories" ? (
        <div className="support-panel-content category-panel" role="tabpanel">
          <div className="active-categories-panel">
            <CategoryPickerWindow
              disabled={roundActive}
              domains={UNIFIED_DOMAINS}
              isOptionActive={isCategoryOptionActive}
              label="All categories"
              lockedNote="Finish or end the current word to change decks."
              onChange={(categoryId) => onCategoryChange(categoryId as CategorySelection)}
              onReset={onResetCategories}
              onSelectAll={onSelectAll}
              selectedId={selectedTokens.length === 1 ? selectedTokens[0] : selectedTokens.length === 0 ? "empty" : ""}
              selectedArtwork={selectedCategoryArtwork}
              selectedKicker={`Round deck`}
              selectedOption={{
                id: selectedTokens.length === 0 ? "empty" : (selectedCategory?.id ?? "custom"),
                label: selectedTokens.length === 0 ? "No Decks Selected" : selectedTokens.length > 1 ? `${selectedTokens.length} Decks Selected` : (selectedCategory?.name ?? "Custom Mix"),
                description: selectedTokens.length === 0 ? "Please select at least one deck." : selectedTokens.length > 1 ? "Custom deck mix" : (selectedCategory?.description ?? ""),
                icon: selectedTokens.length === 0 ? "warning" : (selectedCategory?.icon ?? "category"),
                accent: selectedTokens.length === 0 ? "#e6a283" : (selectedCategory?.accent ?? "#83c5e6"),
              }}
            />
            
            <div className="category-preview-selection">
              <span className="selection-title">Active Selection</span>
              <div className="selection-chips scrollable" style={{ maxHeight: "150px", overflowY: "auto" }}>
                {selectedTokens.length > 0 ? (
                  selectedTokens.map((token, idx) => {
                    let lbl = token;
                    if (token === "all") lbl = "🎲 All Decks Shuffled";
                    else if (token.startsWith("game:")) {
                      const game = GAME_TITLES.find(g => g.id === token.slice(5));
                      lbl = game ? `All ${game.label}` : token;
                    } else {
                      lbl = getCategory(token)?.name ?? token;
                    }
                    return <span className="chip" key={idx}>{lbl}</span>;
                  })
                ) : (
                  <span className="chip empty" style={{ background: "#f2bcae", borderColor: "rgba(186, 75, 50, 0.4)" }}>No decks selected</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="support-panel-content settings-panel" role="tabpanel">
          <div className="setting-row twitch-setting-row">
            <div className="twitch-setting-copy">
              <strong>Twitch chat</strong>
              <p>{!twitchSession.configured
                ? "Add your Twitch Client ID and Secret to the local .env file."
                : twitchSession.authenticated
                  ? `Connected as ${twitchSession.user?.displayName ?? "streamer"}. Chat is ${twitchSession.eventSubStatus}.`
                  : "Connect the streamer's account to receive live guesses."}</p>
            </div>
            <button
              className={`twitch-connect-button ${twitchSession.authenticated ? "disconnect" : ""}`}
              disabled={!twitchSession.configured}
              onClick={twitchSession.authenticated ? onDisconnectTwitch : onConnectTwitch}
              type="button"
            >
              <span className="material-symbols-outlined">{twitchSession.authenticated ? "link_off" : "link"}</span>
              {twitchSession.authenticated ? "Disconnect" : "Connect Twitch"}
            </button>
            {connectionNotice ? <p className="connection-notice">{connectionNotice}</p> : null}
          </div>
          <div className="setting-row">
            <div><strong>Show round timer</strong><p>Keep the countdown above the canvas.</p></div>
            <label className="switch"><input checked={showTimer} onChange={(event) => setShowTimer(event.target.checked)} type="checkbox" /><span /></label>
          </div>
          <div className="setting-row">
            <div><strong>Chat sounds</strong><p>Play a cue for new guesses.</p></div>
            <label className="switch"><input checked={chatSounds} onChange={(event) => setChatSounds(event.target.checked)} type="checkbox" /><span /></label>
          </div>
          <div className="setting-row">
            <div><strong>Confirm end round</strong><p>Prevent accidental round endings.</p></div>
            <label className="switch"><input checked={confirmEnd} onChange={(event) => setConfirmEnd(event.target.checked)} type="checkbox" /><span /></label>
          </div>
          <div className={`setting-row hover-options-setting ${hoverMenusEnabled ? "" : "disabled"}`}>
            <div><strong>Hover options</strong><p>Open tool panels after a custom delay.</p></div>
            <div className="hover-options-controls">
              <label className="switch"><input checked={hoverMenusEnabled} onChange={(event) => onHoverMenusEnabledChange(event.target.checked)} type="checkbox" /><span /></label>
              <label className="hover-delay-control">
                <input aria-label="Hover opening delay" className="themed-range" disabled={!hoverMenusEnabled} max="1200" min="100" onChange={(event) => onHoverMenuDelayChange(Number(event.target.value))} step="100" type="range" value={hoverMenuDelay} />
                <b>{hoverMenuDelay} ms</b>
              </label>
            </div>
          </div>

          <div className="shortcut-settings-header">
            <div><strong>Keyboard shortcuts</strong><p>Focus a key field and press the replacement key.</p></div>
            <button onClick={onShortcutsReset} type="button">Reset</button>
          </div>
          <div className="shortcut-settings-grid">
            {shortcutActions.map((action) => (
              <label key={action}>
                <span>{SHORTCUT_LABELS[action]}</span>
                <input
                  aria-label={`${SHORTCUT_LABELS[action]} shortcut`}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => {
                    if (event.key === "Tab") return;
                    event.preventDefault();
                    const key = event.key === " " ? "Space" : event.key;
                    onShortcutChange(action, key);
                    event.currentTarget.blur();
                  }}
                  readOnly
                  value={shortcuts[action].toUpperCase()}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}