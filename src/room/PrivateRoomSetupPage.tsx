import { useEffect, useState, type FormEvent } from "react";
import { ArtistWordMixPicker } from "../dashboard/ArtistWordMixPicker";
import {
  DEFAULT_ARTIST_WORD_MIX,
  getArtistMixLabel,
  getArtistMixWordCount,
  normalizeArtistWordMix,
  type ArtistWordMix,
} from "../dashboard/artistWordPacks";
import type { CommunityPack } from "../community/communityPacksApi";
import { useSiteIdentity } from "../identity/SiteIdentity";
import { WorkspaceIdentity } from "../ui/WorkspaceIdentity";
import { usePersistentState } from "../ui/usePersistentState";
import { normalizeRoomCode, ROOM_CODE_LENGTH } from "./localRoomState";
import { writeRoomLaunch } from "./roomLaunch";

export function PrivateRoomSetupPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { displayName } = useSiteIdentity();
  const [wordMix, setWordMix] = usePersistentState<ArtistWordMix>("room.wordMix.v1", DEFAULT_ARTIST_WORD_MIX);
  const [roundsPerPlayer, setRoundsPerPlayer] = usePersistentState("room.setup.rounds", 3);
  const [roundSeconds, setRoundSeconds] = usePersistentState("room.setup.seconds", 90);
  const [maxPlayers, setMaxPlayers] = usePersistentState("room.setup.players", 8);
  const [communityPacks, setCommunityPacks] = usePersistentState<CommunityPack[]>("artist.communityPacks.v1", []);
  const [communityEditTokens, setCommunityEditTokens] = usePersistentState<Record<string, string>>("artist.communityEditTokens.v1", {});
  const [reportedCommunityPackIds, setReportedCommunityPackIds] = usePersistentState<string[]>("artist.reportedCommunityPacks.v1", []);
  const [communityReporterKey, setCommunityReporterKey] = usePersistentState("artist.communityReporterKey.v1", "");
  const [wordMixOpen, setWordMixOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const activePacks = communityPacks.filter((pack) => pack.status === "published" && !reportedCommunityPackIds.includes(pack.id));
  const normalizedMix = normalizeArtistWordMix(wordMix, activePacks);

  useEffect(() => {
    if (communityReporterKey) return;
    setCommunityReporterKey(typeof window.crypto?.randomUUID === "function" ? window.crypto.randomUUID() : `browser-${Date.now()}`);
  }, [communityReporterKey, setCommunityReporterKey]);

  const createRoom = () => {
    writeRoomLaunch({ kind: "private-create", maxPlayers, roundSeconds, roundsPerPlayer, wordMix: normalizedMix });
    onNavigate("/room/play");
  };
  const joinRoom = (event: FormEvent) => {
    event.preventDefault();
    if (joinCode.length !== ROOM_CODE_LENGTH) return;
    writeRoomLaunch({ kind: "private-join", code: joinCode });
    onNavigate("/room/play");
  };

  return <main className="room-flow-page room-private-setup-page">
    <div className="room-flow-paper">
      <WorkspaceIdentity onModes={() => onNavigate("/room")} subtitle="Private room setup" />
      <div className="room-setup-heading"><div><span className="source-eyebrow">Friends table</span><h1>Prepare your room</h1><p>Set the table before anyone joins. You can share the code from the play page.</p></div><span className="material-symbols-outlined">tune</span></div>
      <section className="room-setup-grid">
        <div className="room-setup-card room-mix-setup-card">
          <header><span className="material-symbols-outlined">category</span><div><small>Word Mix</small><h2>{getArtistMixLabel(normalizedMix, activePacks)}</h2></div></header>
          <p>{getArtistMixWordCount(normalizedMix, activePacks).toLocaleString()} prompts balanced across the chosen packs.</p>
          <button onClick={() => setWordMixOpen(true)} type="button">Choose categories <span className="material-symbols-outlined">arrow_forward</span></button>
        </div>
        <div className="room-setup-card room-rules-card">
          <header><span className="material-symbols-outlined">rule</span><div><small>Table rules</small><h2>Game settings</h2></div></header>
          <div className="room-rule-fields">
            <label><span>Players</span><input max={16} min={2} onChange={(event) => setMaxPlayers(Number(event.target.value))} type="number" value={maxPlayers} /><small>2–16</small></label>
            <label><span>Rounds per player</span><input max={10} min={1} onChange={(event) => setRoundsPerPlayer(Number(event.target.value))} type="number" value={roundsPerPlayer} /><small>1–10</small></label>
            <label><span>Drawing time</span><select onChange={(event) => setRoundSeconds(Number(event.target.value))} value={roundSeconds}><option value={60}>60 seconds</option><option value={75}>75 seconds</option><option value={90}>90 seconds</option><option value={120}>120 seconds</option><option value={180}>180 seconds</option></select><small>Per turn</small></label>
          </div>
        </div>
      </section>
      <div className="room-setup-actions"><button className="secondary" onClick={() => onNavigate("/room")} type="button">Back</button><button className="primary" onClick={createRoom} type="button"><span className="material-symbols-outlined">add_circle</span>Create and enter room</button></div>
      <form className="room-join-strip" onSubmit={joinRoom}><div><span className="material-symbols-outlined">link</span><span><b>Joining a friend?</b><small>Enter their private room code.</small></span></div><input aria-label="Private room code" maxLength={ROOM_CODE_LENGTH} onChange={(event) => setJoinCode(normalizeRoomCode(event.target.value))} placeholder="ABC123" value={joinCode} /><button disabled={joinCode.length !== ROOM_CODE_LENGTH} type="submit">Join room</button></form>
    </div>
    <ArtistWordMixPicker
      communityEditTokens={communityEditTokens}
      communityPacks={communityPacks}
      contextLabel="Room Mode"
      creatorName={displayName}
      initialMix={normalizedMix}
      onApply={(mix) => { setWordMix(mix); setWordMixOpen(false); }}
      onClose={() => setWordMixOpen(false)}
      onCommunityEditTokensChange={setCommunityEditTokens}
      onCommunityPacksChange={setCommunityPacks}
      onCommunityPackReported={(packId) => setReportedCommunityPackIds((current) => current.includes(packId) ? current : [...current, packId])}
      open={wordMixOpen}
      promptOwner="your room"
      reportedCommunityPackIds={reportedCommunityPackIds}
      reporterKey={communityReporterKey}
    />
  </main>;
}
