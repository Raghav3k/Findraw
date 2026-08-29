import { useState } from "react";
import {
  SHORTCUT_LABELS,
  type KeyboardShortcuts,
  type ShortcutAction,
} from "./keyboardShortcuts";
import type { TwitchSession } from "../twitch/twitchApi";
import { getArtistMixPacks, type ArtistWordMix } from "./artistWordPacks";
import type { CommunityPack } from "../community/communityPacksApi";
import { twitchAuthStartUrl } from "../apiUrls";

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
  onChatCommandsEnabledChange: (enabled: boolean) => Promise<void>;
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
  onChatCommandsEnabledChange,
}: SupportPanelProps) {
  const [activeTab, setActiveTab] = useState<SupportTab>("word-mix");
  const [chatCommandsBusy, setChatCommandsBusy] = useState(false);
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
          <div className="setting-row chat-command-setting">
            <div className="chat-command-copy">
              <strong>Allow command replies in Twitch chat</strong>
              <p>{!twitchSession.authenticated
                ? "Connect Twitch first to let viewers check their scores in chat."
                : twitchSession.canSendChat
                  ? twitchSession.chatCommandsEnabled
                    ? "On by default. Findraw replies through your streamer account, with one reply per viewer every 15 seconds."
                    : "Command replies are off. Viewers can still send normal guesses."
                  : "Reconnect Twitch once to allow Findraw to send command replies."}</p>
              <div className="chat-command-tags" aria-label="Available Twitch commands">
                <code>!finpoints</code><code>!finsession</code><code>!finrewards</code>
              </div>
              {twitchSession.authenticated && !twitchSession.canSendChat ? (
                <button className="twitch-connect-button" onClick={() => window.location.assign(twitchAuthStartUrl("/draw", true))} type="button">
                  <span className="material-symbols-outlined">sync</span>Reconnect to enable
                </button>
              ) : null}
            </div>
            <label className="switch">
              <input
                aria-label="Allow Twitch command replies"
                checked={twitchSession.canSendChat && twitchSession.chatCommandsEnabled}
                disabled={!twitchSession.authenticated || !twitchSession.canSendChat || chatCommandsBusy}
                onChange={async (event) => {
                  setChatCommandsBusy(true);
                  try { await onChatCommandsEnabledChange(event.target.checked); } finally { setChatCommandsBusy(false); }
                }}
                type="checkbox"
              />
              <span />
            </label>
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
