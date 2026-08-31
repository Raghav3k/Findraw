import { WorkspaceIdentity } from "../ui/WorkspaceIdentity";
import { writeRoomLaunch } from "./roomLaunch";

export function RoomPortalPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const lastRoomCode = window.localStorage.getItem("room.lastOnlineCode.v1")?.replace(/^"|"$/g, "") || "";
  const resumeRoom = () => {
    writeRoomLaunch({ kind: "private-join", code: lastRoomCode });
    onNavigate("/room/play");
  };

  return <main className="room-flow-page room-portal-page">
    <div className="room-flow-paper">
      <WorkspaceIdentity onModes={() => onNavigate("/")} subtitle="Choose your table" />
      <section className="room-flow-hero">
        <span className="source-eyebrow">Room Mode</span>
        <h1>Who are you drawing with?</h1>
        <p>Jump into a public table or prepare a private room for friends.</p>
      </section>
      <section className="room-route-grid" aria-label="Room types">
        <button className="room-route-card multiplayer" onClick={() => onNavigate("/room/multiplayer")} type="button">
          <span className="room-route-number">01</span>
          <span className="material-symbols-outlined room-route-icon">public</span>
          <small>Quick play</small>
          <h2>Multiplayer</h2>
          <p>Find an open public table and play with new artists.</p>
          <strong>Find a match <span className="material-symbols-outlined">arrow_forward</span></strong>
        </button>
        <button className="room-route-card private" onClick={() => onNavigate("/room/private")} type="button">
          <span className="room-route-number">02</span>
          <span className="material-symbols-outlined room-route-icon">meeting_room</span>
          <small>Friends table</small>
          <h2>Create room</h2>
          <p>Choose the Word Mix and rules, then share a private code.</p>
          <strong>Set up a room <span className="material-symbols-outlined">arrow_forward</span></strong>
        </button>
      </section>
      {lastRoomCode ? <button className="room-resume-button" onClick={resumeRoom} type="button"><span className="material-symbols-outlined">history</span>Resume room <b>{lastRoomCode}</b></button> : null}
    </div>
  </main>;
}
