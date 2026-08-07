import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

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

export type CategoryPickerDomain = {
  id: string;
  label: string;
  groups: CategoryPickerGroup[];
};

type CategoryPickerWindowProps = {
  disabled?: boolean;
  domains: CategoryPickerDomain[];
  isOptionActive?: (optionId: string) => boolean;
  label: string;
  lockedNote?: string;
  onChange: (categoryId: string) => void;
  onReset?: () => void;
  onSelectAll?: () => void;
  selectedId: string;
  selectedArtwork: string;
  selectedKicker: string;
  selectedOption: CategoryPickerOption;
  selectedLabels?: string[];
};

export function CategoryPickerWindow({
  disabled = false,
  domains,
  isOptionActive,
  label,
  lockedNote,
  onChange,
  onReset,
  onSelectAll,
  selectedId,
  selectedArtwork,
  selectedKicker,
  selectedOption,
  selectedLabels = [],
}: CategoryPickerWindowProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [activeDomainId, setActiveDomainId] = useState<string>(domains[0]?.id);

  useEffect(() => {
    if (domains.length > 0 && !domains.find(d => d.id === activeDomainId)) {
      setActiveDomainId(domains[0].id);
    }
  }, [domains, activeDomainId]);

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
    if (!q) return activeDomain.groups;
    return activeDomain.groups
      .map((group) => {
        const matchingOptions = group.options.filter(
          (opt) => opt.label.toLowerCase().includes(q) || opt.description.toLowerCase().includes(q) || group.label.toLowerCase().includes(q)
        );
        if (matchingOptions.length === 0) return null;
        return { ...group, options: matchingOptions };
      })
      .filter(Boolean) as CategoryPickerGroup[];
  }, [domains, activeDomainId, query]);

  const [shakeError, setShakeError] = useState(false);

  const handleClose = () => {
    if (selectedOption.id === "empty") {
      setShakeError(true);
      setTimeout(() => setShakeError(false), 500);
      return;
    }
    setOpen(false);
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
        onClick={() => setOpen(true)}
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
                <span className="category-art" data-category={selectedOption.id}>
                  <img alt={`${selectedOption.label} category artwork`} src={selectedArtwork} />
                </span>

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
                      {selectedId === "all" ? (
                        <span className="chip active-all">🎲 All Decks Shuffled</span>
                      ) : selectedLabels.length > 0 ? (
                        selectedLabels.map((lbl, idx) => (
                          <span className="chip" key={idx}>{lbl}</span>
                        ))
                      ) : (
                        <span className="chip" style={selectedOption.id === "empty" ? { background: "#f2bcae", borderColor: "rgba(186, 75, 50, 0.4)" } : {}}>
                          {selectedOption.label}
                        </span>
                      )}
                    </div>
                    {selectedOption.id === "empty" ? (
                      <div className={shakeError ? "shake-error" : ""} style={{ color: "#ba4b32", fontSize: "11.5px", marginTop: "4px", fontWeight: 700, lineHeight: 1.3, fontFamily: '"Inter", sans-serif', transition: "all 0.2s ease" }}>
                        Please select at least one deck before exiting.
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="domain-tabs">
                  {domains.map((domain) => (
                    <button
                      key={domain.id}
                      className={`domain-tab ${activeDomainId === domain.id ? "active" : ""}`}
                      onClick={() => setActiveDomainId(domain.id)}
                      type="button"
                    >
                      {domain.label}
                    </button>
                  ))}
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
