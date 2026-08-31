import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { AutoDrawCanvas } from "../autoDraw/AutoDrawCanvas";
import { AUTO_DRAW_ASSETS } from "../autoDraw/autoDrawAssets";
import { ColorPickerPanel } from "../ui/ColorPickerPanel";
import { usePersistentState } from "../ui/usePersistentState";
import { TwitchProfileMenu } from "../ui/WorkspaceIdentity";
import { useSiteIdentity } from "../identity/SiteIdentity";

type ModeHomeProps = { onNavigate: (path: string) => void };

type AvatarColorTarget = "headColor" | "headAccent" | "bodyColor" | "bodyAccent";

export function ModeHome({ onNavigate }: ModeHomeProps) {
  const { disconnect, guestName: playerName, setGuestName: setPlayerName, twitchSession } = useSiteIdentity();
  const [avatarHeadColor, setAvatarHeadColor] = usePersistentState("room.avatar.headColor", "#f0ccd3");
  const [avatarHeadAccent, setAvatarHeadAccent] = usePersistentState("room.avatar.headAccent", "#ffe4a8");
  const [avatarBodyColor, setAvatarBodyColor] = usePersistentState("room.avatar.bodyColor", "#83c5e6");
  const [avatarBodyAccent, setAvatarBodyAccent] = usePersistentState("room.avatar.bodyAccent", "#d7e8c9");
  const [avatarHeadMode, setAvatarHeadMode] = usePersistentState<"plain" | "gradient">("room.avatar.headMode", "plain");
  const [avatarBodyMode, setAvatarBodyMode] = usePersistentState<"plain" | "gradient">("room.avatar.bodyMode", "plain");
  const [avatarHeadDominance, setAvatarHeadDominance] = usePersistentState("room.avatar.headDominance", 62);
  const [avatarBodyDominance, setAvatarBodyDominance] = usePersistentState("room.avatar.bodyDominance", 58);
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [avatarColorTarget, setAvatarColorTarget] = useState<AvatarColorTarget | null>(null);
  const avatarStyle = {
    "--avatar-head": avatarHeadColor,
    "--avatar-head-accent": avatarHeadMode === "gradient" ? avatarHeadAccent : avatarHeadColor,
    "--avatar-head-mix": `${avatarHeadDominance}%`,
    "--avatar-body": avatarBodyColor,
    "--avatar-body-accent": avatarBodyMode === "gradient" ? avatarBodyAccent : avatarBodyColor,
    "--avatar-body-mix": `${avatarBodyDominance}%`,
  } as CSSProperties;

  const avatarColorMap = {
    headColor: { defaultColor: "#f0ccd3", label: "Head color", setColor: setAvatarHeadColor, value: avatarHeadColor },
    headAccent: { defaultColor: "#ffe4a8", label: "Head blend", setColor: setAvatarHeadAccent, value: avatarHeadAccent },
    bodyColor: { defaultColor: "#83c5e6", label: "Body color", setColor: setAvatarBodyColor, value: avatarBodyColor },
    bodyAccent: { defaultColor: "#d7e8c9", label: "Body blend", setColor: setAvatarBodyAccent, value: avatarBodyAccent },
  };
  const activeColor = avatarColorTarget ? avatarColorMap[avatarColorTarget] : null;

  useEffect(() => {
    if (!avatarColorTarget) return;
    const closeColorPanel = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".mode-avatar-color-panel") || target.closest(".mode-avatar-chip-pair")) return;
      setAvatarColorTarget(null);
    };
    window.addEventListener("pointerdown", closeColorPanel);
    return () => window.removeEventListener("pointerdown", closeColorPanel);
  }, [avatarColorTarget]);

  const colorChip = (target: AvatarColorTarget) => (
    <button
      aria-label={`Edit ${avatarColorMap[target].label}`}
      className={avatarColorTarget === target ? "active" : ""}
      onClick={() => setAvatarColorTarget((current) => current === target ? null : target)}
      style={{ "--swatch-color": avatarColorMap[target].value } as CSSProperties}
      type="button"
    />
  );

  return <main className="mode-home"><div className="mode-home-paper">
    <header className="mode-home-header">
      <div className="mode-home-brand"><h1>Findraw</h1></div>
      <TwitchProfileMenu
        chatStatus={twitchSession.eventSubStatus}
        configured={twitchSession.configured}
        connected={twitchSession.authenticated}
        displayName={twitchSession.user?.displayName ?? null}
        profileImageUrl={twitchSession.user?.profileImageUrl ?? null}
        onDisconnectTwitch={() => { void disconnect(); }}
        returnTo="/"
      />
    </header>
    <section className="mode-grid" aria-label="Game modes">
      <button className="mode-card room-mode-card" onClick={() => onNavigate("/room")} type="button">
        <span className="mode-card-tape"/><div className="mode-card-preview room-preview" aria-hidden="true"><span className="room-preview-avatar one">A</span><span className="room-preview-avatar two">B</span><span className="room-preview-avatar three">C</span><span className="room-preview-board"><i/><i/><i/></span><span className="material-symbols-outlined room-preview-icon">groups</span></div>
        <span className="mode-card-number">01</span><div className="mode-card-copy"><span className="mode-card-label">Online multiplayer</span><h2>Room Mode</h2><p>Join a public table or create a private room for friends.</p><span className="mode-card-action">Choose a table <span className="material-symbols-outlined">arrow_forward</span></span></div>
      </button>
      <button className="mode-card artist-mode-card" onClick={() => onNavigate("/draw")} type="button">
        <span className="mode-card-tape"/><div className="mode-card-preview artist-preview" aria-hidden="true"><span className="material-symbols-outlined artist-preview-hand">stylus_note</span><span className="artist-preview-line line-one"/><span className="artist-preview-line line-two"/><span className="artist-preview-line line-three"/><span className="artist-preview-star">&#9733;</span></div>
        <span className="mode-card-number">02</span><div className="mode-card-copy"><span className="mode-card-label">Classic game</span><h2>Artist Mode</h2><p>You draw the secret word while Twitch chat races to solve it.</p><span className="mode-card-action">Open artist desk <span className="material-symbols-outlined">arrow_forward</span></span></div>
      </button>
      <button className="mode-card auto-mode-card" onClick={() => onNavigate("/auto-draw")} type="button">
        <span className="mode-card-tape"/><div className="mode-card-preview auto-preview" aria-hidden="true"><AutoDrawCanvas active asset={AUTO_DRAW_ASSETS[0]} stageIndex={2} stageProgress={0.72}/><span className="auto-preview-badge">3/6</span></div>
        <span className="mode-card-number">03</span><div className="mode-card-copy"><span className="mode-card-label">New game</span><h2>Auto Draw</h2><p>Findraw draws in timed stages. The streamer and chat guess together.</p><span className="mode-card-action">Try the practical proof <span className="material-symbols-outlined">arrow_forward</span></span></div>
      </button>
    </section>
    {!twitchSession.authenticated ? <section className="mode-temp-profile" aria-label="Guest player profile">
      <button className="mode-temp-avatar" onClick={() => setAvatarEditorOpen((current) => !current)} style={avatarStyle} title="Edit avatar" type="button"><i/><b/></button>
      <label><span>Guest name</span><input maxLength={20} onChange={(event) => setPlayerName(event.target.value)} placeholder="Player" value={playerName} /></label>
      {avatarEditorOpen ? (
        <div className="mode-avatar-popover">
          <div className="mode-avatar-editor-row">
            <div className="mode-avatar-editor-header"><span>Head</span><select onChange={(event) => setAvatarHeadMode(event.target.value as "plain" | "gradient")} value={avatarHeadMode}><option value="gradient">Gradient</option><option value="plain">Plain</option></select></div>
            <div className="mode-avatar-chip-pair">{colorChip("headColor")}{avatarHeadMode === "gradient" ? colorChip("headAccent") : null}</div>
            {avatarHeadMode === "gradient" ? <label className="mode-avatar-slider range-control" style={{ "--avatar-slider-left": avatarHeadColor, "--avatar-slider-right": avatarHeadAccent, "--avatar-slider-mix": `${avatarHeadDominance}%` } as CSSProperties}><span>Dominance</span><input className="themed-range" max={90} min={10} onChange={(event) => setAvatarHeadDominance(Number(event.target.value))} type="range" value={avatarHeadDominance} /><b>{avatarHeadDominance}%</b></label> : null}
          </div>
          <div className="mode-avatar-editor-row">
            <div className="mode-avatar-editor-header"><span>Body</span><select onChange={(event) => setAvatarBodyMode(event.target.value as "plain" | "gradient")} value={avatarBodyMode}><option value="gradient">Gradient</option><option value="plain">Plain</option></select></div>
            <div className="mode-avatar-chip-pair">{colorChip("bodyColor")}{avatarBodyMode === "gradient" ? colorChip("bodyAccent") : null}</div>
            {avatarBodyMode === "gradient" ? <label className="mode-avatar-slider range-control" style={{ "--avatar-slider-left": avatarBodyColor, "--avatar-slider-right": avatarBodyAccent, "--avatar-slider-mix": `${avatarBodyDominance}%` } as CSSProperties}><span>Dominance</span><input className="themed-range" max={90} min={10} onChange={(event) => setAvatarBodyDominance(Number(event.target.value))} type="range" value={avatarBodyDominance} /><b>{avatarBodyDominance}%</b></label> : null}
          </div>
          {activeColor ? (
            <div className={`mode-avatar-color-panel ${avatarColorTarget?.startsWith("body") ? "for-body" : "for-head"}`}>
              <ColorPickerPanel defaultColor={activeColor.defaultColor} label={activeColor.label} onChange={activeColor.setColor} value={activeColor.value} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section> : null}
  </div></main>;
}
