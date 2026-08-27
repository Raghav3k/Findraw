import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  createCommunityPack,
  getCommunityPack,
  reportCommunityPack,
  updateCommunityPack,
  type CommunityPack,
  type CommunityPackInput,
  type CommunityReportReason,
} from "../community/communityPacksApi";
import {
  ARTIST_GAME_PACKS,
  ARTIST_GENERAL_PACKS,
  GENERAL_MIXED_PACK_ID,
  normalizeArtistWordMix,
  type ArtistPackKind,
  type ArtistWordMix,
  type ArtistWordPack,
} from "./artistWordPacks";
import { ArtistGameMark } from "./ArtistGameMark";

type Step = "kind" | "packs" | "community-form" | "community-report";
type CommunityFormState = { title: string; description: string; tags: string; words: string };

type ArtistWordMixPickerProps = {
  communityEditTokens: Record<string, string>;
  communityPacks: CommunityPack[];
  creatorName: string;
  initialMix: ArtistWordMix;
  open: boolean;
  reportedCommunityPackIds: string[];
  reporterKey: string;
  required?: boolean;
  onApply: (mix: ArtistWordMix) => void;
  onClose: () => void;
  onCommunityEditTokensChange: (tokens: Record<string, string>) => void;
  onCommunityPacksChange: (packs: CommunityPack[]) => void;
  onCommunityPackReported: (packId: string) => void;
};

const emptyCommunityForm = (): CommunityFormState => ({ title: "", description: "", tags: "", words: "" });
const upsertCommunityPack = (packs: CommunityPack[], next: CommunityPack) => [...packs.filter((pack) => pack.id !== next.id), next];
const communityArtistId = (packId: string) => `community-${packId}`;

export function ArtistWordMixPicker({
  communityEditTokens,
  communityPacks,
  creatorName,
  initialMix,
  onApply,
  onClose,
  onCommunityEditTokensChange,
  onCommunityPacksChange,
  onCommunityPackReported,
  open,
  reportedCommunityPackIds,
  reporterKey,
  required = false,
}: ArtistWordMixPickerProps) {
  const activeCommunityPacks = useMemo(
    () => communityPacks.filter((pack) => pack.status === "published" && !reportedCommunityPackIds.includes(pack.id)),
    [communityPacks, reportedCommunityPackIds],
  );
  const [draft, setDraft] = useState<ArtistWordMix>(() => required ? { kind: "general", packIds: [] } : normalizeArtistWordMix(initialMix, activeCommunityPacks));
  const [browseKind, setBrowseKind] = useState<ArtistPackKind>(initialMix.kind === "mixed" ? "game" : initialMix.kind);
  const [query, setQuery] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [step, setStep] = useState<Step>(required ? "kind" : "packs");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editingPackId, setEditingPackId] = useState<string | null>(null);
  const [communityForm, setCommunityForm] = useState<CommunityFormState>(emptyCommunityForm);
  const [reportTarget, setReportTarget] = useState<CommunityPack | null>(null);
  const [reportReason, setReportReason] = useState<CommunityReportReason>("offensive");
  const [reportDetails, setReportDetails] = useState("");

  useEffect(() => {
    if (!open) return;
    const normalized = normalizeArtistWordMix(initialMix, activeCommunityPacks);
    setDraft(required ? { kind: "general", packIds: [] } : normalized);
    setBrowseKind(normalized.kind === "mixed" ? "game" : normalized.kind);
    setQuery("");
    setJoinCode("");
    setStep(required ? "kind" : "packs");
    setMessage("");
    setError("");
  }, [open, required]);

  const standardPacks = browseKind === "game" ? ARTIST_GAME_PACKS : ARTIST_GENERAL_PACKS;
  const visibleStandardPacks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en");
    if (!normalizedQuery) return standardPacks;
    return standardPacks.filter((pack) => `${pack.label} ${pack.description}`.toLocaleLowerCase("en").includes(normalizedQuery));
  }, [query, standardPacks]);
  const visibleCommunityPacks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en");
    if (!normalizedQuery) return activeCommunityPacks;
    return activeCommunityPacks.filter((pack) => (
      `${pack.title} ${pack.description} ${pack.creatorName} ${pack.tags.map((tag) => `${tag.label} ${tag.key}`).join(" ")}`
        .toLocaleLowerCase("en")
        .includes(normalizedQuery)
    ));
  }, [activeCommunityPacks, query]);
  const canApply = draft.packIds.length > 0;
  const selectedOptions = useMemo(() => draft.packIds.flatMap((id) => {
    if (id === GENERAL_MIXED_PACK_ID) return [{ id, label: "All General", kind: "general" as ArtistPackKind }];
    const standard = [...ARTIST_GAME_PACKS, ...ARTIST_GENERAL_PACKS].find((pack) => pack.id === id);
    if (standard) return [{ id, label: standard.label, kind: standard.kind }];
    const community = activeCommunityPacks.find((pack) => communityArtistId(pack.id) === id);
    return community ? [{ id, label: community.title, kind: "community" as ArtistPackKind }] : [];
  }), [activeCommunityPacks, draft.packIds]);

  const chooseKind = (kind: ArtistPackKind) => {
    setBrowseKind(kind);
    setQuery("");
    setMessage("");
    setError("");
    setStep("packs");
  };

  const togglePack = (packId: string) => {
    setDraft((current) => {
      if (current.packIds.includes(packId)) return { ...current, packIds: current.packIds.filter((id) => id !== packId) };
      let selected = current.packIds;
      if (packId === GENERAL_MIXED_PACK_ID) selected = selected.filter((id) => ARTIST_GENERAL_PACKS.every((pack) => pack.id !== id));
      if (ARTIST_GENERAL_PACKS.some((pack) => pack.id === packId)) selected = selected.filter((id) => id !== GENERAL_MIXED_PACK_ID);
      return { ...current, packIds: [...selected, packId] };
    });
  };

  const apply = () => {
    onApply(normalizeArtistWordMix(draft, activeCommunityPacks));
    onClose();
  };

  const joinCommunityPack = async () => {
    if (!joinCode.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { pack } = await getCommunityPack(joinCode.trim());
      onCommunityPacksChange(upsertCommunityPack(communityPacks, pack));
      const artistId = communityArtistId(pack.id);
      setDraft((current) => ({ ...current, packIds: [...new Set([...current.packIds, artistId])] }));
      setJoinCode("");
      setMessage(`${pack.title} was added and selected.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not add that community pack.");
    } finally {
      setBusy(false);
    }
  };

  const openCreateForm = () => {
    setEditingPackId(null);
    setCommunityForm(emptyCommunityForm());
    setError("");
    setMessage("");
    setStep("community-form");
  };

  const openEditForm = (pack: CommunityPack) => {
    setEditingPackId(pack.id);
    setCommunityForm({
      title: pack.title,
      description: pack.description,
      tags: pack.tags.map((tag) => tag.label).join(", "),
      words: pack.words.map((word) => `${word.answer}${word.aliases?.length ? ` | ${word.aliases.join(", ")}` : ""}`).join("\n"),
    });
    setError("");
    setMessage("");
    setStep("community-form");
  };

  const parseCommunityForm = (): CommunityPackInput => ({
    title: communityForm.title,
    description: communityForm.description,
    creatorName,
    tags: communityForm.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    words: communityForm.words.split(/\r?\n/).map((line) => {
      const [answer = "", aliases = ""] = line.split("|");
      const parsedAliases = aliases.split(",").map((alias) => alias.trim()).filter(Boolean);
      return parsedAliases.length ? { answer: answer.trim(), aliases: parsedAliases } : { answer: answer.trim() };
    }).filter((word) => word.answer),
  });

  const saveCommunityPack = async () => {
    setBusy(true);
    setError("");
    try {
      const input = parseCommunityForm();
      if (editingPackId) {
        const editToken = communityEditTokens[editingPackId];
        if (!editToken) throw new Error("This browser does not have the edit token for that pack.");
        const { pack } = await updateCommunityPack(editingPackId, editToken, input);
        onCommunityPacksChange(upsertCommunityPack(communityPacks, pack));
        setMessage(`${pack.title} was updated.`);
      } else {
        const { pack, editToken } = await createCommunityPack(input);
        onCommunityPacksChange(upsertCommunityPack(communityPacks, pack));
        onCommunityEditTokensChange({ ...communityEditTokens, [pack.id]: editToken });
        setDraft((current) => ({ ...current, packIds: [...new Set([...current.packIds, communityArtistId(pack.id)])] }));
        setMessage(`${pack.title} was created. Share code: ${pack.shareCode}`);
      }
      setStep("packs");
      setQuery("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save this community pack.");
    } finally {
      setBusy(false);
    }
  };

  const openReportForm = (pack: CommunityPack) => {
    setReportTarget(pack);
    setReportReason("offensive");
    setReportDetails("");
    setError("");
    setStep("community-report");
  };

  const submitReport = async () => {
    if (!reportTarget) return;
    setBusy(true);
    setError("");
    try {
      await reportCommunityPack(reportTarget.id, { reason: reportReason, reporterKey, details: reportDetails });
      onCommunityPackReported(reportTarget.id);
      const artistId = communityArtistId(reportTarget.id);
      setDraft((current) => ({ ...current, packIds: current.packIds.filter((id) => id !== artistId) }));
      setMessage(`${reportTarget.title} was reported and hidden on this browser.`);
      setReportTarget(null);
      setStep("packs");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not submit this report.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const heading = step === "kind"
    ? "What should your stream draw?"
    : step === "community-form"
      ? editingPackId ? "Edit community pack" : "Create a community pack"
      : step === "community-report"
        ? "Report community pack"
        : browseKind === "game" ? "Choose your games" : browseKind === "community" ? "Community packs" : "Choose general interests";

  return createPortal(
    <div className="artist-word-mix-layer">
      <div className="artist-word-mix-backdrop" />
      <section aria-label="Choose your Artist Mode word mix" aria-modal="true" className="artist-word-mix-window" role="dialog">
        <header className="artist-word-mix-header">
          <div>
            <small>{browseKind === "community" ? "Community library" : "Artist Mode setup"}</small>
            <h2>{heading}</h2>
            {step !== "packs" ? <p>{step === "kind"
              ? "Start with any source, then combine packs from Games, General and Community."
              : step === "community-form"
                ? "Tags are open-ended. Put one word or phrase on each line; aliases can follow a | symbol."
                : step === "community-report"
                  ? "Your report hides this pack locally and helps quarantine unsafe community content."
                  : ""}</p> : null}
          </div>
          {!required ? <button aria-label="Close word mix" className="artist-word-mix-close" onClick={onClose} type="button"><span className="material-symbols-outlined">close</span></button> : null}
        </header>

        {step === "kind" ? (
          <div className="artist-word-kind-grid three-options">
            <KindCard className="gaming" icon="sports_esports" kicker="Reviewed game packs" label="Gaming Worlds" onClick={() => chooseKind("game")}>Familiar words from games you and your chat already know.</KindCard>
            <KindCard className="general" icon="auto_awesome" kicker="Reviewed general packs" label="General Fun" onClick={() => chooseKind("general")}>Simple animals, food, places, entertainment and everyday things.</KindCard>
            <KindCard className="community" icon="diversity_3" kicker="Created by the community" label="Community Packs" onClick={() => chooseKind("community")}>Join niche collections by share code or make a custom pack for your audience.</KindCard>
          </div>
        ) : null}

        {step === "packs" ? (
          <div className="artist-word-pack-step">
            <div className="artist-word-mix-toolbar">
              <button className="artist-word-back" onClick={() => setStep("kind")} type="button"><span className="material-symbols-outlined">arrow_back</span>Change type</button>
              <div className="artist-word-kind-switch three-options" role="tablist" aria-label="Word mix type">
                <button aria-selected={browseKind === "game"} className={browseKind === "game" ? "active" : ""} onClick={() => chooseKind("game")} role="tab" type="button"><span className="material-symbols-outlined">sports_esports</span>Games</button>
                <button aria-selected={browseKind === "general"} className={browseKind === "general" ? "active" : ""} onClick={() => chooseKind("general")} role="tab" type="button"><span className="material-symbols-outlined">auto_awesome</span>General</button>
                <button aria-selected={browseKind === "community"} className={browseKind === "community" ? "active" : ""} onClick={() => chooseKind("community")} role="tab" type="button"><span className="material-symbols-outlined">diversity_3</span>Community</button>
              </div>
              <span>{draft.packIds.length} selected</span>
            </div>

            <div className={`artist-word-selection-tray ${selectedOptions.length ? "has-selection" : ""}`}>
              <strong>Selected mix</strong>
              <div>{selectedOptions.length ? selectedOptions.map((option) => <button className={option.kind} key={option.id} onClick={() => togglePack(option.id)} title={`Remove ${option.label}`} type="button">{option.label}<span className="material-symbols-outlined">close</span></button>) : <span>Pick from any tab — your choices stay here.</span>}</div>
              <button className="artist-word-selection-clear" disabled={!selectedOptions.length} onClick={() => setDraft((current) => ({ ...current, packIds: [] }))} type="button">Clear<span className="material-symbols-outlined">backspace</span></button>
            </div>

            {browseKind === "community" ? (
              <>
                <div className="community-pack-actions">
                  <form onSubmit={(event) => { event.preventDefault(); void joinCommunityPack(); }}>
                    <span className="material-symbols-outlined">key</span>
                    <input aria-label="Community pack share code" maxLength={10} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="Enter share code" value={joinCode} />
                    <button disabled={busy || !joinCode.trim()} type="submit">Add pack</button>
                  </form>
                  <button className="community-create-button" onClick={openCreateForm} type="button"><span className="material-symbols-outlined">add</span>Create pack</button>
                </div>
                <label className="artist-game-search community-search">
                  <span className="material-symbols-outlined">search</span>
                  <input onChange={(event) => setQuery(event.target.value)} placeholder="Search your community library or tags..." type="search" value={query} />
                </label>
                {message ? <p className="community-pack-message success">{message}</p> : null}
                {error ? <p className="community-pack-message error">{error}</p> : null}
                <div className="artist-word-pack-grid community-pack-grid scrollable">
                  {visibleCommunityPacks.map((pack) => (
                    <CommunityPackCard active={draft.packIds.includes(communityArtistId(pack.id))} canEdit={Boolean(communityEditTokens[pack.id])} key={pack.id} onEdit={() => openEditForm(pack)} onReport={() => openReportForm(pack)} onToggle={() => togglePack(communityArtistId(pack.id))} pack={pack} />
                  ))}
                  {visibleCommunityPacks.length === 0 ? (
                    <div className="artist-game-empty community-empty"><span className="material-symbols-outlined">diversity_3</span><strong>Your community library is empty</strong><p>Add an unlisted pack using its share code or create the first pack for your community.</p></div>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                {browseKind === "game" ? <label className="artist-game-search"><span className="material-symbols-outlined">search</span><input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder="Search reviewed games..." type="search" value={query} /></label> : null}
                <div className="artist-word-pack-grid scrollable">
                  {browseKind === "general" ? <PackButton active={draft.packIds.includes(GENERAL_MIXED_PACK_ID)} onClick={() => togglePack(GENERAL_MIXED_PACK_ID)} pack={{ id: GENERAL_MIXED_PACK_ID, label: "All", description: "Use every familiar pack in the reviewed General collection.", kind: "general", icon: "select_all", accent: "#f2d98b", words: [] }} /> : null}
                  {visibleStandardPacks.map((pack) => <PackButton active={draft.packIds.includes(pack.id)} key={pack.id} onClick={() => togglePack(pack.id)} pack={pack} />)}
                  {visibleStandardPacks.length === 0 ? <div className="artist-game-empty"><span className="material-symbols-outlined">search_off</span><strong>No reviewed game pack yet</strong><p>Try another title. New Standard packs are added only after review.</p></div> : null}
                </div>
              </>
            )}

            <footer className="artist-word-mix-footer">
              <p>{!canApply ? "Choose at least one pack from Games, General or Community." : "Selections from every tab will be combined into one balanced word queue."}</p>
              <button disabled={!canApply} onClick={apply} type="button">Use selected mix <span className="material-symbols-outlined">check</span></button>
            </footer>
          </div>
        ) : null}

        {step === "community-form" ? <CommunityPackForm busy={busy} error={error} form={communityForm} isEditing={Boolean(editingPackId)} onBack={() => setStep("packs")} onChange={setCommunityForm} onSave={() => void saveCommunityPack()} /> : null}

        {step === "community-report" && reportTarget ? (
          <div className="community-report-step">
            <button className="artist-word-back" onClick={() => setStep("packs")} type="button"><span className="material-symbols-outlined">arrow_back</span>Back to packs</button>
            <div className="community-report-card"><span className="material-symbols-outlined">flag</span><div><small>Community-created pack</small><h3>{reportTarget.title}</h3><p>by {reportTarget.creatorName}</p></div></div>
            <label className="community-form-field"><span>Reason</span><select onChange={(event) => setReportReason(event.target.value as CommunityReportReason)} value={reportReason}><option value="offensive">Offensive content</option><option value="hate-or-harassment">Hate or harassment</option><option value="sexual-content">Sexual content</option><option value="spam">Spam</option><option value="incorrect-tags">Incorrect tags</option><option value="other">Other</option></select></label>
            <label className="community-form-field"><span>Details <small>optional</small></span><textarea maxLength={300} onChange={(event) => setReportDetails(event.target.value)} placeholder="What should moderators know?" value={reportDetails} /></label>
            {error ? <p className="community-pack-message error">{error}</p> : null}
            <footer className="artist-word-mix-footer"><p>The pack will be hidden for you immediately after reporting.</p><button className="community-report-submit" disabled={busy} onClick={() => void submitReport()} type="button">Submit report <span className="material-symbols-outlined">flag</span></button></footer>
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

function KindCard({ children, className, icon, kicker, label, onClick }: { children: string; className: string; icon: string; kicker: string; label: string; onClick: () => void }) {
  return <button className={`artist-word-kind-card ${className}`} onClick={onClick} type="button"><span className="material-symbols-outlined">{icon}</span><small>{kicker}</small><strong>{label}</strong><p>{children}</p><b>Open <span className="material-symbols-outlined">arrow_forward</span></b></button>;
}

function PackButton({ active, onClick, pack }: { active: boolean; onClick: () => void; pack: ArtistWordPack }) {
  const mark = pack.kind === "game"
    ? <span className="artist-game-mark-wrap"><ArtistGameMark packId={pack.id} />{active ? <span className="artist-game-mark-check material-symbols-outlined">check</span> : null}</span>
    : <span className="material-symbols-outlined">{active ? "check" : pack.icon}</span>;
  return <button aria-pressed={active} className={`artist-word-pack-card ${active ? "active" : ""}`} onClick={onClick} style={{ "--pack-accent": pack.accent } as CSSProperties} type="button">{mark}<span><strong>{pack.label}</strong><small>{pack.description}</small></span></button>;
}

function CommunityPackCard({ active, canEdit, onEdit, onReport, onToggle, pack }: { active: boolean; canEdit: boolean; onEdit: () => void; onReport: () => void; onToggle: () => void; pack: CommunityPack }) {
  return (
    <article className={`community-pack-card ${active ? "active" : ""}`}>
      <button aria-pressed={active} className="community-pack-select" onClick={onToggle} type="button"><span className="material-symbols-outlined">{active ? "check" : "diversity_3"}</span><span><strong>{pack.title}</strong><small>by {pack.creatorName} · {pack.words.length} words</small></span></button>
      <div className="community-pack-tags">{pack.tags.slice(0, 4).map((tag) => <span key={tag.key}>#{tag.label}</span>)}</div>
      <footer><span>Code {pack.shareCode}</span><div>{canEdit ? <button aria-label={`Edit ${pack.title}`} onClick={onEdit} type="button"><span className="material-symbols-outlined">edit</span></button> : null}<button aria-label={`Report ${pack.title}`} onClick={onReport} type="button"><span className="material-symbols-outlined">flag</span></button></div></footer>
    </article>
  );
}

function CommunityPackForm({ busy, error, form, isEditing, onBack, onChange, onSave }: { busy: boolean; error: string; form: CommunityFormState; isEditing: boolean; onBack: () => void; onChange: (form: CommunityFormState) => void; onSave: () => void }) {
  const wordCount = form.words.split(/\r?\n/).filter((line) => line.trim()).length;
  const tagCount = form.tags.split(",").filter((tag) => tag.trim()).length;
  return (
    <div className="community-form-step scrollable">
      <button className="artist-word-back" onClick={onBack} type="button"><span className="material-symbols-outlined">arrow_back</span>Back to community packs</button>
      <div className="community-form-grid">
        <label className="community-form-field"><span>Pack title</span><input maxLength={60} onChange={(event) => onChange({ ...form, title: event.target.value })} placeholder="Example: Friendly Astrophysics" value={form.title} /></label>
        <label className="community-form-field"><span>Tags <small>{tagCount}/8 · comma separated</small></span><input onChange={(event) => onChange({ ...form, tags: event.target.value })} placeholder="science, space, beginner, custom..." value={form.tags} /></label>
        <label className="community-form-field full"><span>Description <small>optional</small></span><input maxLength={240} onChange={(event) => onChange({ ...form, description: event.target.value })} placeholder="Tell people what kind of words are inside without revealing them." value={form.description} /></label>
        <label className="community-form-field full words"><span>Words and phrases <small>{wordCount}/100 · minimum 8</small></span><textarea onChange={(event) => onChange({ ...form, words: event.target.value })} placeholder={"Heart\nBlood Cell\nBlack Hole | blackhole\nTelescope"} value={form.words} /></label>
      </div>
      <div className="community-safety-note"><span className="material-symbols-outlined">verified_user</span><p><strong>Keep it safe and drawable.</strong> Community packs stay separate from Standard. Offensive, sexual, hateful, abusive or spam content can be rejected, reported and quarantined.</p></div>
      {error ? <p className="community-pack-message error">{error}</p> : null}
      <footer className="artist-word-mix-footer"><p>Your edit token stays on this browser. New packs are unlisted and shared by code.</p><button disabled={busy || wordCount < 8 || tagCount === 0 || tagCount > 8 || form.title.trim().length < 3} onClick={onSave} type="button">{isEditing ? "Save changes" : "Create pack"}<span className="material-symbols-outlined">{isEditing ? "save" : "add"}</span></button></footer>
    </div>
  );
}
