import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { CategorySelectionChip } from "../dashboard/gameData";
import { usePersistentState } from "./usePersistentState";

export type CategoryPickerOption = {
  id: string;
  label: string;
  description: string;
  icon: string;
  accent: string;
  count?: number;
};

export type CategoryPickerGroup = {
  id: string;
  label: string;
  options: CategoryPickerOption[];
};

export type CategoryPickerSection = {
  id: string;
  label: string;
  groups: CategoryPickerGroup[];
};

export type CategoryPickerDomain = {
  id: string;
  label: string;
  groups: CategoryPickerGroup[];
  sections?: CategoryPickerSection[];
};

type CategoryPickerWindowProps = {
  currentSelection?: string;
  disabled?: boolean;
  domains: CategoryPickerDomain[];
  isOptionActive?: (optionId: string) => boolean;
  lockedNote?: string;
  onApplySelection?: (selectionId: string) => void;
  onChange: (categoryId: string) => void;
  onRemoveChip?: (chipId: string) => void;
  onReset?: () => void;
  onSelectAll?: () => void;
  profileStorageKey?: string;
  selectedId: string;
  selectedOption: CategoryPickerOption;
  selectedChips?: CategorySelectionChip[];
};

type CategorySelectionProfile = {
  id: string;
  name: string;
  selection: string;
};

function inferDomainId(selection: string | undefined, domains: CategoryPickerDomain[]): string | undefined {
  const tokens = (selection ?? "").split(",").map((token) => token.trim()).filter(Boolean);
  if (tokens.includes("domain:general")) return domains.find((domain) => domain.id === "general")?.id;
  if (tokens.includes("domain:games") || tokens.some((token) => token.startsWith("game:"))) {
    return domains.find((domain) => domain.id === "games")?.id;
  }

  for (const token of tokens) {
    const domain = domains.find((domain) => (
      domain.groups.some((group) => group.options.some((option) => option.id === token))
    ));
    if (domain) return domain.id;
  }

  return domains[0]?.id;
}

function getDomainGroups(domain: CategoryPickerDomain | undefined): CategoryPickerGroup[] {
  if (!domain) return [];
  return domain.sections?.flatMap((section) => section.groups) ?? domain.groups;
}

function getDomainSections(domain: CategoryPickerDomain | undefined): CategoryPickerSection[] {
  if (!domain) return [];
  return domain.sections ?? [{ id: "all", label: "All", groups: domain.groups }];
}

function inferSectionId(selection: string | undefined, domain: CategoryPickerDomain | undefined): string | undefined {
  const sections = getDomainSections(domain);
  if (!sections.length) return undefined;
  const tokens = (selection ?? "").split(",").map((token) => token.trim()).filter(Boolean);
  if (!tokens.length) return sections[0].id;
  if (tokens.includes("domain:general") || tokens.includes("domain:games") || tokens.includes("all")) return sections[0].id;

  for (const token of tokens) {
    const section = sections.find((section) => (
      section.groups.some((group) => group.options.some((option) => option.id === token))
    ));
    if (section) return section.id;
  }

  return sections[0].id;
}

export function CategoryPickerWindow({
  currentSelection,
  disabled = false,
  domains,
  isOptionActive,
  lockedNote,
  onApplySelection,
  onChange,
  onRemoveChip,
  onReset,
  onSelectAll,
  profileStorageKey,
  selectedId,
  selectedOption,
  selectedChips,
}: CategoryPickerWindowProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [activeDomainId, setActiveDomainId] = useState<string>(inferDomainId(currentSelection ?? selectedId, domains) ?? domains[0]?.id);
  const [activeSectionId, setActiveSectionId] = useState<string | undefined>(() => {
    const domainId = inferDomainId(currentSelection ?? selectedId, domains) ?? domains[0]?.id;
    return inferSectionId(currentSelection ?? selectedId, domains.find((domain) => domain.id === domainId) ?? domains[0]);
  });
  const [profileName, setProfileName] = useState("");
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [profiles, setProfiles] = usePersistentState<CategorySelectionProfile[]>(
    profileStorageKey ? `categoryProfiles.${profileStorageKey}` : "categoryProfiles.disabled",
    [],
  );

  useEffect(() => {
    if (domains.length === 0) return;
    const activeDomain = domains.find(d => d.id === activeDomainId);
    if (!activeDomain) {
      setActiveDomainId(domains[0].id);
      setActiveSectionId(inferSectionId(currentSelection ?? selectedId, domains[0]));
      return;
    }
    const sections = getDomainSections(activeDomain);
    if (sections.length > 0 && !sections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId(sections[0].id);
    }
  }, [activeDomainId, activeSectionId, currentSelection, domains, selectedId]);

  const selectedList = useMemo(
    () => (selectedId === "all" || !selectedId ? ["all"] : selectedId.split(",").filter(Boolean)),
    [selectedId]
  );

  const checkActive = (optionId: string): boolean => {
    if (isOptionActive) return isOptionActive(optionId);
    if (selectedId === "all" && optionId === "all") return true;
    return selectedList.includes(optionId);
  };

  const filteredGroups = useMemo(() => {
    const activeDomain = domains.find(d => d.id === activeDomainId) || domains[0];
    if (!activeDomain) return [];
    const q = query.trim().toLowerCase();
    const section = getDomainSections(activeDomain).find((section) => section.id === activeSectionId);
    const groups = q ? getDomainGroups(activeDomain) : section?.groups ?? activeDomain.groups;
    return groups
      .map((group) => {
        if (!q) return group;
        const matchingOptions = group.options.filter(
          (opt) => opt.label.toLowerCase().includes(q) || opt.description.toLowerCase().includes(q) || group.label.toLowerCase().includes(q)
        );
        if (matchingOptions.length === 0) return null;
        return { ...group, options: matchingOptions };
      })
      .filter(Boolean) as CategoryPickerGroup[];
  }, [activeDomainId, activeSectionId, domains, query]);

  const [shakeError, setShakeError] = useState(false);
  const activeSelection = currentSelection ?? selectedId;
  const canUseProfiles = Boolean(profileStorageKey && onApplySelection);
  const canSaveProfile = canUseProfiles && !disabled && activeSelection !== "" && activeSelection !== "empty";

  const handleClose = () => {
    if (selectedOption.id === "empty") {
      setShakeError(true);
      setTimeout(() => setShakeError(false), 500);
      return;
    }
    setOpen(false);
  };

  const handleOpen = () => {
    const domainId = inferDomainId(currentSelection ?? selectedId, domains) ?? domains[0]?.id;
    const domain = domains.find((domain) => domain.id === domainId) ?? domains[0];
    setActiveDomainId(domainId);
    setActiveSectionId(inferSectionId(currentSelection ?? selectedId, domain));
    setOpen(true);
  };

  const changeDomain = (domainId: string) => {
    const domain = domains.find((domain) => domain.id === domainId);
    setActiveDomainId(domainId);
    setActiveSectionId(getDomainSections(domain)[0]?.id);
  };

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, selectedOption.id]);

  const toggleOption = (optionId: string) => {
    if (disabled) return;
    onChange(optionId);
  };

  const saveProfile = () => {
    if (!canSaveProfile) return;
    const name = profileName.trim().slice(0, 32) || selectedChips?.find((chip) => chip.kind !== "empty")?.label || "Saved pool";
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setProfiles((current) => [
      { id, name, selection: activeSelection },
      ...current.filter((profile) => profile.name.toLowerCase() !== name.toLowerCase()),
    ].slice(0, 12));
    setProfileName("");
    setProfilesOpen(true);
  };

  const applyProfile = (selection: string) => {
    if (disabled || !onApplySelection) return;
    onApplySelection(selection);
  };

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  return (
    <div className="category-picker">
      <button
        aria-expanded={open}
        className="preview-action-btn"
        disabled={disabled}
        onClick={handleOpen}
        type="button"
        style={{ marginBottom: "12px", width: "100%", padding: "10px", fontSize: "14px", fontWeight: "bold" }}
      >
        <span className="material-symbols-outlined">style</span>
        Select Decks
      </button>

      {lockedNote && disabled ? <p className="category-locked-note">{lockedNote}</p> : null}

      {open ? createPortal(
        <div className="category-window-layer" role="presentation">
          <button aria-label="Close category picker" className="category-window-backdrop" onClick={handleClose} type="button" />
          <section aria-label="Choose category" aria-modal="true" className="category-window" role="dialog">
            <header className="category-window-header">
              <div>
                <small>Sketchbook decks</small>
                <h2>Choose categories</h2>
              </div>
              <div className="category-window-search">
                <span className="material-symbols-outlined">search</span>
                <input
                  autoFocus
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search decks & games..."
                  type="text"
                  value={query}
                />
                {query ? (
                  <button aria-label="Clear search" onClick={() => setQuery("")} type="button">
                    <span className="material-symbols-outlined">close</span>
                  </button>
                ) : null}
              </div>
              <button aria-label="Apply selections" className="category-window-done" onClick={handleClose} type="button">
                Done
              </button>
              <button aria-label="Close category picker" className="category-window-close" onClick={handleClose} type="button">
                <span className="material-symbols-outlined">close</span>
              </button>
            </header>

            <div className="category-window-body">
              <aside className="category-window-sidebar">
                <div className="category-preview-meta">
                  <div className="category-preview-actions">
                    {onSelectAll ? (
                      <button className={`preview-action-btn ${selectedId === "all" ? "active-action" : ""}`} onClick={() => selectedId === "all" && onReset ? onReset() : onSelectAll()} type="button">
                        <span className="material-symbols-outlined">shuffle</span>
                        Randomize All
                      </button>
                    ) : null}
                    {onReset ? (
                      <button className="preview-action-btn alt" onClick={onReset} type="button">
                        <span className="material-symbols-outlined">deselect</span>
                        Deselect All
                      </button>
                    ) : null}
                  </div>

                  <div className="category-preview-selection">
                    <span className="selection-title">Active Selection</span>
                    <div className="selection-chips scrollable">
                      {selectedChips?.length ? (
                        selectedChips.map((chip) => (
                          <span
                            className={`chip ${chip.kind === "all" ? "active-all" : ""} ${chip.kind === "empty" ? "empty" : ""}`}
                            key={chip.id}
                            style={{ "--chip-accent": chip.accent } as CSSProperties}
                          >
                            {chip.label}
                            {onRemoveChip && chip.kind !== "empty" ? (
                              <button aria-label={`Remove ${chip.label}`} onClick={() => onRemoveChip(chip.id)} type="button">
                                <span className="material-symbols-outlined">close</span>
                              </button>
                            ) : null}
                          </span>
                        ))
                      ) : (
                        <>
                      {selectedId === "all" ? (
                        <span className="chip active-all">🎲 All Decks Shuffled</span>
                      ) : (
                        <span className="chip" style={selectedOption.id === "empty" ? { background: "#f2bcae", borderColor: "rgba(186, 75, 50, 0.4)" } : {}}>
                          {selectedOption.label}
                        </span>
                      )}
                        </>
                      )}
                    </div>
                    {selectedOption.id === "empty" ? (
                      <div className={shakeError ? "shake-error" : ""} style={{ color: "#ba4b32", fontSize: "11.5px", marginTop: "4px", fontWeight: 700, lineHeight: 1.3, fontFamily: '"Inter", sans-serif', transition: "all 0.2s ease" }}>
                        Please select at least one deck before exiting.
                      </div>
                    ) : null}
                  </div>

                  {canUseProfiles ? (
                    <div className={`category-profile-panel compact ${profilesOpen ? "open" : ""}`}>
                      <button className="category-profile-toggle" onClick={() => setProfilesOpen((current) => !current)} type="button">
                        <span className="material-symbols-outlined">folder_special</span>
                        Saved pools
                        <b>{profiles.length}</b>
                        <span className="material-symbols-outlined">{profilesOpen ? "expand_less" : "expand_more"}</span>
                      </button>
                      {profilesOpen ? (
                        <div className="category-profile-dropdown">
                          <div className="category-profile-save">
                            <input
                              aria-label="Saved pool name"
                              disabled={disabled}
                              maxLength={32}
                              onChange={(event) => setProfileName(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  saveProfile();
                                }
                              }}
                              placeholder="Pool name..."
                              type="text"
                              value={profileName}
                            />
                            <button aria-label="Save active pool" disabled={!canSaveProfile} onClick={saveProfile} type="button">
                              <span className="material-symbols-outlined">bookmark_add</span>
                            </button>
                          </div>
                          <div className="category-profile-list scrollable">
                            {profiles.length ? profiles.map((profile) => (
                              <div className="category-profile-item" key={profile.id}>
                                <button disabled={disabled} onClick={() => applyProfile(profile.selection)} type="button">
                                  <span className="material-symbols-outlined">folder_special</span>
                                  <strong>{profile.name}</strong>
                                </button>
                                <button aria-label={`Delete ${profile.name}`} onClick={() => setProfiles((current) => current.filter((item) => item.id !== profile.id))} type="button">
                                  <span className="material-symbols-outlined">delete</span>
                                </button>
                              </div>
                            )) : (
                              <p>No saved pools yet.</p>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="domain-tabs">
                  {domains.map((domain) => {
                    const active = activeDomainId === domain.id;
                    return (
                      <div className={`category-domain-stack ${active ? "open" : ""}`} key={domain.id}>
                        <button
                          className={`domain-tab ${active ? "active" : ""}`}
                          onClick={() => changeDomain(domain.id)}
                          type="button"
                        >
                          {domain.label}
                        </button>
                        {active ? (
                          <div className="category-section-tabs" aria-label={`${domain.label} sections`}>
                            {getDomainSections(domain).map((section) => (
                              <button
                                key={section.id}
                                className={`category-section-tab ${activeSectionId === section.id ? "active" : ""}`}
                                onClick={() => setActiveSectionId(section.id)}
                                type="button"
                              >
                                {section.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </aside>

              <div className="category-window-groups">
                {filteredGroups.map((group) => {
                  const isCollapsed = Boolean(collapsedGroups[group.id]);
                  const isFeatured = group.id === "featured";
                  return (
                    <section className={`category-window-group ${isCollapsed ? "collapsed" : ""}`} key={group.id}>
                      <button
                        aria-expanded={!isCollapsed}
                        className="category-window-group-title group-toggle-btn"
                        onClick={() => toggleGroupCollapse(group.id)}
                        type="button"
                      >
                        <div className="group-title-left">
                          {!isFeatured ? (
                            <span className={`material-symbols-outlined dropdown-chevron ${isCollapsed ? "collapsed" : ""}`}>
                              expand_more
                            </span>
                          ) : null}
                          <span className="game-title-text">{group.label}</span>
                        </div>
                        <span className="group-deck-count">
                          {group.options.length} {group.options.length === 1 ? "option" : "options"}
                        </span>
                      </button>

                      <div className={`category-options-wrapper ${isCollapsed ? "collapsed" : ""}`}>
                        <div className="category-options-inner">
                          <div className="category-window-options">
                            {group.options.map((option) => {
                              const active = checkActive(option.id);
                              return (
                                <button
                                  aria-pressed={active}
                                  className={active ? "active" : ""}
                                  key={option.id}
                                  onClick={() => toggleOption(option.id)}
                                  style={{ "--category-accent": option.accent } as CSSProperties}
                                  type="button"
                                >
                                  <span className="material-symbols-outlined">{active ? "check_box" : option.icon}</span>
                                  <span>
                                    <strong>{option.label}</strong>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
