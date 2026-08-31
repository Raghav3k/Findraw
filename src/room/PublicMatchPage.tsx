import { useState } from "react";
import { hasApiBaseUrl } from "../apiUrls";
import { useSiteIdentity } from "../identity/SiteIdentity";
import { WorkspaceIdentity } from "../ui/WorkspaceIdentity";
import { createClientId, createRoomReconnectToken } from "./localRoomState";
import { findPublicMatch } from "./matchmakingApi";
import { writeRoomLaunch } from "./roomLaunch";

export function PublicMatchPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { displayName } = useSiteIdentity();
  const [status, setStatus] = useState<"idle" | "searching" | "error">("idle");
  const [message, setMessage] = useState("");

  const findMatch = async () => {
    setStatus("searching");
    setMessage("Looking for an open table…");
    try {
      const match = await findPublicMatch({ clientId: createClientId(), reconnectToken: createRoomReconnectToken(), name: displayName });
      writeRoomLaunch({ kind: "public", code: match.code });
      onNavigate("/room/play");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "A match could not be found.");
    }
  };

  const enterBotTest = () => {
    writeRoomLaunch({ kind: "public-bots" });
    onNavigate("/room/play");
  };

  return <main className="room-flow-page room-match-page">
    <div className="room-flow-paper">
      <WorkspaceIdentity onModes={() => onNavigate("/room")} subtitle="Public multiplayer" />
      <section className="room-match-stage">
        <div className="room-match-orbit" aria-hidden="true"><i/><i/><i/><span className="material-symbols-outlined">public</span></div>
        <span className="source-eyebrow">Quick play</span>
        <h1>Find a public table</h1>
        <p>We’ll place you with available players. Public tables use Findraw’s balanced General Word Mix and standard 90-second rounds.</p>
        <div className="room-public-rules"><span><b>8</b><small>players max</small></span><span><b>3</b><small>rounds each</small></span><span><b>90</b><small>seconds</small></span></div>
        <button disabled={!hasApiBaseUrl || status === "searching"} onClick={() => { void findMatch(); }} type="button"><span className="material-symbols-outlined">{status === "searching" ? "progress_activity" : "travel_explore"}</span>{status === "searching" ? "Finding a table…" : "Find match"}</button>
        {import.meta.env.DEV ? <button className="room-bot-test-button" onClick={enterBotTest} type="button"><span className="material-symbols-outlined">smart_toy</span>Test with 5 bots</button> : null}
        {!hasApiBaseUrl ? <p className="room-match-message error">Public matchmaking requires the Cloudflare Room backend. Private local rooms remain available for development.</p> : message ? <p className={`room-match-message ${status}`}>{message}</p> : null}
        <button className="room-match-private-link" onClick={() => onNavigate("/room/private")} type="button">Playing with friends? Create a private room</button>
      </section>
    </div>
  </main>;
}
