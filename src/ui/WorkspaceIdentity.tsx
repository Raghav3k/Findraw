import { useEffect, useRef, useState } from "react";
import { twitchAuthStartUrl } from "../apiUrls";

type WorkspaceIdentityProps = {
  connected: boolean;
  configured: boolean;
  displayName: string | null;
  modeName: string;
  onModes: () => void;
  returnTo: string;
  subtitle: string;
};

export function WorkspaceIdentity({ connected, configured, displayName, modeName, onModes, returnTo, subtitle }: WorkspaceIdentityProps) {
  const profileName = displayName?.trim() || "Streamer";
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
    <div className="workspace-identity">
      <div className="brand-block source-brand">
        <h1>Findraw</h1>
        <p>{subtitle}</p>
      </div>
      <div className="workspace-identity-actions">
        <div className="workspace-profile-menu-wrap" ref={profileRef}>
          <button aria-expanded={open} aria-haspopup="dialog" aria-label="Open profile details" className="workspace-profile" onClick={() => setOpen((current) => !current)} type="button">
            <span className="workspace-profile-avatar material-symbols-outlined" aria-hidden="true">person</span>
            <span className="workspace-profile-copy">
              <small>{connected ? "Twitch" : "Local profile"}</small>
              <strong>{profileName}</strong>
            </span>
          </button>
          {open ? (
            <section aria-label="Profile details" className="workspace-profile-menu" role="dialog">
              <header>
                <div className="workspace-profile-menu-person">
                  <span className="workspace-profile-avatar material-symbols-outlined" aria-hidden="true">person</span>
                  <div><small>Your profile</small><strong>{profileName}</strong></div>
                </div>
                <button aria-label="Close profile details" className="workspace-profile-close" onClick={() => setOpen(false)} type="button">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </header>
              <div className="workspace-profile-details">
                <div><span>Current workspace</span><strong>{modeName}</strong></div>
                <div><span>Twitch account</span><strong className={connected ? "connected" : ""}>{connected ? "Connected" : configured ? "Not connected" : "Setup unknown"}</strong></div>
              </div>
              <p>{connected ? "Your Twitch display name and live chat are ready in this workspace." : "Connect Twitch to show your account name and receive live chat."}</p>
              <div className="workspace-profile-menu-actions">
                <button onClick={() => window.location.assign(twitchAuthStartUrl(returnTo))} type="button">
                  <span className="material-symbols-outlined">link</span>
                  {connected ? "Reconnect Twitch" : "Connect Twitch"}
                </button>
                <button onClick={onModes} type="button">
                  <span className="material-symbols-outlined">apps</span>
                  Browse game modes
                </button>
              </div>
            </section>
          ) : null}
        </div>
        <button aria-label="Back to game modes" className="workspace-mode-button" onClick={onModes} title="Game modes" type="button">
          <span className="material-symbols-outlined">apps</span>
          <span>Modes</span>
        </button>
      </div>
    </div>
  );
}
