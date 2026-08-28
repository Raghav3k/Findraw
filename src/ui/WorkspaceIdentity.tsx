import { useEffect, useRef, useState } from "react";
import { twitchAuthStartUrl } from "../apiUrls";

type TwitchProfileMenuProps = {
  connected: boolean;
  configured: boolean;
  displayName: string | null;
  profileImageUrl?: string | null;
  chatStatus?: string;
  onDisconnectTwitch?: () => void;
  returnTo: string;
};

type WorkspaceIdentityProps = {
  onModes: () => void;
  subtitle: string;
};

export function TwitchProfileMenu({ connected, configured, displayName, profileImageUrl, chatStatus = "disconnected", onDisconnectTwitch, returnTo }: TwitchProfileMenuProps) {
  const profileName = connected ? displayName?.trim() || "Streamer" : "Guest";
  const [open, setOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="workspace-profile-menu-wrap" ref={profileRef}>
          <button aria-expanded={open} aria-haspopup="dialog" aria-label="Open profile details" className={`workspace-profile ${connected ? "twitch-connected" : "guest-profile"}`} onClick={() => setOpen((current) => !current)} type="button">
            <span className={`workspace-profile-avatar${connected && profileImageUrl ? " has-image" : " material-symbols-outlined"}`} aria-hidden="true">
              {connected && profileImageUrl ? <img alt="" src={profileImageUrl} /> : "person"}
            </span>
            <span className="workspace-profile-copy">
              <strong>{profileName}</strong>
              <span><i className={connected && chatStatus === "connected" ? "live" : ""} />{connected ? chatStatus === "connected" ? "Live chat connected" : chatStatus === "reconnecting" ? "Live chat reconnecting" : "Live chat offline" : "Playing locally"}</span>
            </span>
            <span className="workspace-profile-chevron material-symbols-outlined" aria-hidden="true">{open ? "expand_less" : "expand_more"}</span>
          </button>
          {open ? (
            <section aria-label="Profile details" className="workspace-profile-menu" role="dialog">
              <div className={`workspace-profile-live-status ${connected && chatStatus === "connected" ? "connected" : ""}`}>
                <i />
                <div>
                  <small>{connected ? "Live chat" : "Twitch"}</small>
                  <strong>{connected ? chatStatus === "connected" ? "Connected" : chatStatus === "reconnecting" ? "Reconnecting" : "Offline" : configured ? "Not connected" : "Setup unavailable"}</strong>
                </div>
              </div>
              <div className="workspace-profile-menu-actions">
                <button onClick={() => window.location.assign(twitchAuthStartUrl(returnTo, connected))} type="button">
                  <span className="material-symbols-outlined">link</span>
                  {connected ? "Switch Twitch Account" : "Connect Twitch"}
                </button>
                {connected && onDisconnectTwitch ? (
                  <button className="disconnect" onClick={onDisconnectTwitch} type="button">
                    <span className="material-symbols-outlined">link_off</span>
                    Log Out Twitch
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
    </div>
  );
}

export function WorkspaceIdentity({ onModes, subtitle }: WorkspaceIdentityProps) {
  return (
    <div className="workspace-identity">
      <div className="brand-block source-brand">
        <h1>Findraw</h1>
        <p>{subtitle}</p>
      </div>
      <div className="workspace-identity-actions">
        <button aria-label="Exit to game modes" className="workspace-mode-button workspace-exit-button" onClick={onModes} title="Exit" type="button">
          <span className="material-symbols-outlined">logout</span>
          <span>Exit</span>
        </button>
      </div>
    </div>
  );
}
