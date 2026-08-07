import { useEffect, useRef, useState, type FormEvent } from "react";
import type { EventSubStatus } from "../twitch/twitchApi";
import { WorkspaceIdentity } from "../ui/WorkspaceIdentity";
import { AUTO_DRAW_ASSETS } from "../autoDraw/autoDrawAssets";

export type ChatMessage = {
  id: string;
  message: string;
  name: string;
};

type StreamSourceSidebarProps = {
  configured: boolean;
  connected: boolean;
  displayName: string | null;
  messages: ChatMessage[];
  onModes: () => void;
  roundActive: boolean;
  word: string;
  chatStatus: EventSubStatus;
  onUseCustomWord: (word: string) => boolean;
  preparedCustomWord: string | null;
};

export function StreamSourceSidebar({ configured, connected, displayName, messages, onModes, roundActive, word, chatStatus, onUseCustomWord, preparedCustomWord }: StreamSourceSidebarProps) {
  const [customWord, setCustomWord] = useState("");
  const [customWordError, setCustomWordError] = useState("");
  const [showAssetImage, setShowAssetImage] = useState(false);
  const chatConnected = chatStatus === "connected";
  const chatListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShowAssetImage(false);
  }, [word, roundActive]);

  const matchedAsset = roundActive 
    ? AUTO_DRAW_ASSETS.find(asset => asset.answer.toLowerCase() === word.toLowerCase())
    : undefined;

  useEffect(() => {
    if (chatListRef.current) {
      chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
    }
  }, [messages]);

  const submitCustomWord = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customWord.trim()) {
      setCustomWordError("Enter a word or phrase first.");
      return;
    }
    if (onUseCustomWord(customWord)) {
      setCustomWord("");
      setCustomWordError("");
    }
  };

  return (
    <aside className="stream-sidebar" aria-label="Stream sources">
      <WorkspaceIdentity connected={connected} configured={configured} displayName={displayName} modeName="Artist Mode" onModes={onModes} returnTo="/draw" subtitle="Artist sketchbook" />

      <section className="source-card camera-source-card">
        <header className="source-card-header">
          <div>
            <span className="source-eyebrow">Camera frame</span>
            <h2>Artist on camera</h2>
          </div>
          <span className={`source-status ${roundActive ? "ready" : ""}`}>
            <i />{roundActive ? "Round live" : "Standby"}
          </span>
        </header>

        <div className={`camera-preview ${roundActive ? "source-selected round-prompt-visible" : "custom-word-position"}`}>
          {roundActive && matchedAsset && (
            <button 
              type="button" 
              onClick={() => setShowAssetImage(!showAssetImage)} 
              className="asset-image-toggle" 
              title={showAssetImage ? "Hide reference image" : "Show reference image"}
            >
              <span className="material-symbols-outlined">
                {showAssetImage ? 'visibility_off' : 'photo'}
              </span>
            </button>
          )}
          {roundActive ? (
            showAssetImage && matchedAsset ? (
              <div className="camera-asset-image">
                <img src={matchedAsset.imageUrl} alt={word} />
              </div>
            ) : (
              <div className="camera-prompt-copy">
                <strong style={{ fontSize: Math.max(26, Math.min(60, 440 / Math.max(1, word.length))) + 'px', lineHeight: 1.15 }}>{word}</strong>
              </div>
            )
          ) : (
            <div className="custom-word-card">
              <small className="camera-instruction">Keep this area covered by your camera in OBS</small>
              <strong>Use a custom word</strong>
              <form onSubmit={submitCustomWord}>
                <input
                  aria-label="Custom word or phrase"
                  autoComplete="off"
                  maxLength={60}
                  onChange={(event) => {
                    setCustomWord(event.target.value);
                    if (customWordError) setCustomWordError("");
                  }}
                  placeholder="Type a secret word..."
                  type="text"
                  value={customWord}
                />
                <button type="submit">Use next</button>
              </form>
              {customWordError ? <span className="custom-word-error">{customWordError}</span> : null}
              {preparedCustomWord ? (
                <div className="custom-word-ready">
                  <span className="material-symbols-outlined">check_circle</span>
                  <span style={{ flex: 1 }}><small>Ready for next round</small><strong>{preparedCustomWord}</strong></span>
                  <button 
                    type="button" 
                    title="Cancel custom word"
                    onClick={() => onUseCustomWord("")}
                    style={{ background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer', display: 'flex' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#c96f69' }}>close</span>
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <section className="source-card chat-source-card">
        <header className="source-card-header">
          <div>
            <span className="source-eyebrow">Audience notes</span>
            <h2>Guess feed</h2>
          </div>
          <span className={`source-status ${chatConnected ? "ready" : ""}`}>
            <i />{chatConnected ? "Chat live" : chatStatus === "reconnecting" ? "Reconnecting" : "Twitch offline"}
          </span>
        </header>

        <div className="source-chat-list" aria-live="polite" ref={chatListRef}>
          {messages.length > 0 ? messages.map(({ id, message, name }) => (
            <div className="source-chat-message" key={id}>
              <span>{name.slice(0, 1)}</span>
              <p><strong>{name}</strong>{message}</p>
            </div>
          )) : (
            <div className="source-empty-state">
              <span className="material-symbols-outlined">forum</span>
              <strong>Guesses land here</strong>
              <small>{chatConnected ? "Start a word and watch the page fill up." : "Connect Twitch from Settings to receive chat."}</small>
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}
