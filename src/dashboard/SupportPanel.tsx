import { useState } from "react";
import {
  SHORTCUT_LABELS,
  type KeyboardShortcuts,
  type ShortcutAction,
} from "./keyboardShortcuts";
import { usePersistentState } from "../ui/usePersistentState";
import type { TwitchSession } from "../twitch/twitchApi";
import { getArtistMixPacks, type ArtistWordMix } from "./artistWordPacks";
import type { CommunityPack } from "../community/communityPacksApi";

type SupportTab = "word-mix" | "settings";

type SupportPanelProps = {
  wordMix: ArtistWordMix;
  communityPacks: CommunityPack[];
  roundActive: boolean;
  onOpenWordMix: () => void;
  hoverMenuDelay: number;
  hoverMenusEnabled: boolean;
  onHoverMenuDelayChange: (delay: number) => void;
  onHoverMenusEnabledChange: (enabled: boolean) => void;
  shortcuts: KeyboardShortcuts;
  onShortcutChange: (action: ShortcutAction, key: string) => void;
  onShortcutsReset: () => void;
  twitchSession: TwitchSession;
  connectionNotice: string;
};

export function SupportPanel({
  wordMix,
  communityPacks,
  roundActive,
  onOpenWordMix,
  hoverMenuDelay,
  hoverMenusEnabled,
  onHoverMenuDelayChange,
  onHoverMenusEnabledChange,
  shortcuts,
  onShortcutChange,
  onShortcutsReset,
  twitchSession,
  connectionNotice,
}: SupportPanelProps) {
  const [activeTab, setActiveTab] = useState<SupportTab>("word-mix");
  const [showTimer, setShowTimer] = usePersistentState("settings.showTimer", true);
  const [chatSounds, setChatSounds] = usePersistentState("settings.chatSounds", false);
  const [confirmEnd, setConfirmEnd] = usePersistentState("settings.confirmEnd", true);
  const shortcutActions = Object.keys(shortcuts) as ShortcutAction[];

  const selectedPacks = getArtistMixPacks(wordMix, communityPacks);
  const selectedChips = wordMix.packIds.flatMap((id) => {
    if (id === "general-mixed") return [{ id, kind: "general", label: "All general interests" }];
    const pack = selectedPacks.find((candidate) => candidate.id === id);
    return pack ? [{ id, kind: pack.kind, label: pack.label }] : [];
  });

  return (
    <section className="feed-card support-card">
      <div className="support-tabs" role="tablist" aria-label="Word mix and settings">
        <button aria-selected={activeTab === "word-mix"} className={activeTab === "word-mix" ? "active" : ""} onClick={() => setActiveTab("word-mix")} role="tab" type="button">
          <span className="material-symbols-outlined">style</span>Word Mix
        </button>
        <button aria-selected={activeTab === "settings"} className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")} role="tab" type="button">
          <span className="material-symbols-outlined">settings</span>Settings
        </button>
      </div>

      {activeTab === "word-mix" ? (
        <div className="support-panel-content artist-word-mix-panel" role="tabpanel">
          <div className="artist-word-mix-chips compact">
            {selectedChips.map((chip) => <span className={chip.kind} key={chip.id}>{chip.label}</span>)}
          </div>
          <button className="artist-word-mix-change" disabled={roundActive} onClick={onOpenWordMix} type="button">
            <span className="material-symbols-outlined">tune</span>
            <strong>{roundActive ? "Finish this word to change" : "Change word mix"}</strong>
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
        </div>
      ) : (
        <div className="support-panel-content settings-panel" role="tabpanel">
          <div className="setting-row twitch-setting-row">
            <div className="twitch-setting-copy">
              <strong>Twitch chat</strong>
              <p>{twitchSession.authenticated
                ? `Connected as ${twitchSession.user?.displayName ?? "streamer"}. Chat is ${twitchSession.eventSubStatus}.`
                : "Connect the streamer's account from the home profile to receive live guesses."}</p>
            </div>
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
