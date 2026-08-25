import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePersistentState } from "./usePersistentState";
import { DOCK_RAIL_RESIZE_EVENT, type DockBoundary } from "./dockRailResize";

type Direction = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type PanelSize = { width?: number; height?: number; anchor?: "left" | "center" | "right"; boundary?: DockBoundary };
type ResizeState = { direction: Direction; pointerId: number; startX: number; startY: number; startWidth: number; startHeight: number; maxWidth: number; widthSnapPoints: number[]; heightSnapPoints: number[] };
type DragState = { active: boolean; pointerId: number; startX: number; startY: number; left: number; top: number; width: number; height: number };
type SnapAxis = "width" | "height" | "both" | null;

const handles: Array<{ direction: Direction; label: string }> = [
  { direction: "n", label: "top" }, { direction: "ne", label: "top right" },
  { direction: "e", label: "right" }, { direction: "se", label: "bottom right" },
  { direction: "s", label: "bottom" }, { direction: "sw", label: "bottom left" },
  { direction: "w", label: "left" }, { direction: "nw", label: "top left" },
];
const MIN_DOCK_PANEL_HEIGHT = 88;
const DRAG_START_DISTANCE = 5;

type DockContextValue = {
  draggingId: string | null;
  editing: boolean;
  getAssignedPanelId: (slotId: string) => string;
  getPanelSize: (panelId: string) => PanelSize;
  getTarget: (panelId: string) => HTMLElement | null;
  hoveredSlotId: string | null;
  isSnapping: (panelId: string) => boolean;
  registerSlot: (slotId: string, element: HTMLElement | null) => void;
  resetLayout: () => void;
  setDraggingId: (panelId: string | null) => void;
  setHoveredSlotId: (slotId: string | null) => void;
  setPanelSize: (panelId: string, size: PanelSize) => void;
  swapIntoSlot: (panelId: string, slotId: string) => void;
  toggleEditing: () => void;
};

const DockContext = createContext<DockContextValue | null>(null);

export function DockLayout({ children, panelIds, slotIds, storageKey }: { children: ReactNode; panelIds: string[]; slotIds: string[]; storageKey: string }) {
  const panelIdsRef = useRef(panelIds);
  const slotIdsRef = useRef(slotIds);
  const stablePanelIds = panelIdsRef.current;
  const stableSlotIds = slotIdsRef.current;
  const [storedOrder, setStoredOrder] = usePersistentState<string[]>(`${storageKey}.order`, stablePanelIds);
  const [sizes, setSizes] = usePersistentState<Record<string, PanelSize>>(`${storageKey}.sizes`, {});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [hoveredSlotId, setHoveredSlotId] = useState<string | null>(null);
  const [snappingIds, setSnappingIds] = useState<string[]>([]);
  const [slotRevision, setSlotRevision] = useState(0);
  const slotsRef = useRef(new Map<string, HTMLElement>());
  const snapTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current);
  }, []);

  const order = useMemo(() => {
    const valid = storedOrder.filter((id, index) => stablePanelIds.includes(id) && storedOrder.indexOf(id) === index);
    return [...valid, ...stablePanelIds.filter((id) => !valid.includes(id))].slice(0, stableSlotIds.length);
  }, [stablePanelIds, stableSlotIds.length, storedOrder]);

  useEffect(() => {
    const followBoundary = (event: Event) => {
      const { boundary, previousWidth, nextWidth } = (event as CustomEvent<{ boundary: DockBoundary; previousWidth: number; nextWidth: number }>).detail;
      const contracting = nextWidth < previousWidth;
      const delta = nextWidth - previousWidth;
      setSizes((current) => {
        let changed = false;
        const next = { ...current };
        stableSlotIds.forEach((slotId, index) => {
          const slot = slotsRef.current.get(slotId);
          const railBoundary = slot?.closest<HTMLElement>("[data-dock-boundary]")?.dataset.dockBoundary;
          if (railBoundary !== boundary) return;
          const panelId = order[index];
          const size = panelId ? current[panelId] : undefined;
          if (!panelId || !size?.width) return;

          if (size.boundary === boundary || size.anchor === boundary) {
            next[panelId] = { ...size, width: Math.max(180, Math.min(nextWidth, size.width + delta)) };
            changed = true;
          } else if (contracting && nextWidth <= size.width) {
            next[panelId] = { ...size, width: nextWidth, anchor: boundary, boundary };
            changed = true;
          }
        });
        return changed ? next : current;
      });
    };
    window.addEventListener(DOCK_RAIL_RESIZE_EVENT, followBoundary);
    return () => window.removeEventListener(DOCK_RAIL_RESIZE_EVENT, followBoundary);
  }, [order, setSizes, stableSlotIds]);

  useEffect(() => {
    if (order.length !== storedOrder.length || order.some((id, index) => id !== storedOrder[index])) setStoredOrder(order);
  }, [order, setStoredOrder, storedOrder]);

  const registerSlot = useCallback((slotId: string, element: HTMLElement | null) => {
    const previous = slotsRef.current.get(slotId);
    if (element) slotsRef.current.set(slotId, element);
    else slotsRef.current.delete(slotId);
    if (previous !== element) setSlotRevision((revision) => revision + 1);
  }, []);

  const getAssignedPanelId = useCallback((slotId: string) => order[stableSlotIds.indexOf(slotId)] ?? stablePanelIds[stableSlotIds.indexOf(slotId)] ?? "", [order, stablePanelIds, stableSlotIds]);
  const getPanelSize = useCallback((panelId: string) => sizes[panelId] ?? {}, [sizes]);
  const setPanelSize = useCallback((panelId: string, size: PanelSize) => {
    setSizes((current) => {
      const next = { ...current, [panelId]: { ...current[panelId], ...size } };
      if (size.height === undefined) return next;

      const targetIndex = order.indexOf(panelId);
      const targetSlot = targetIndex >= 0 ? slotsRef.current.get(stableSlotIds[targetIndex]) : null;
      const rail = targetSlot?.parentElement;
      if (!targetSlot || !rail) return next;
      const renderedTargetHeight = targetSlot.getBoundingClientRect().height;
      if (Math.abs(size.height - renderedTargetHeight) < .5) return next;
      const railSlots = Array.from(rail.querySelectorAll<HTMLElement>(":scope > [data-dock-slot-id]"));
      const siblings = railSlots.filter((slot) => slot !== targetSlot);
      if (siblings.length === 0) return next;

      const slotHeights = railSlots.map((slot) => slot.getBoundingClientRect().height);
      const availableHeight = slotHeights.reduce((sum, height) => sum + height, 0);
      const targetHeight = Math.min(
        Math.max(MIN_DOCK_PANEL_HEIGHT, size.height),
        availableHeight - siblings.length * MIN_DOCK_PANEL_HEIGHT,
      );
      const remainingHeight = Math.max(0, availableHeight - targetHeight);
      const siblingHeights = siblings.map((slot) => slot.getBoundingClientRect().height);
      const flexibleHeight = Math.max(0, remainingHeight - siblings.length * MIN_DOCK_PANEL_HEIGHT);
      const weights = siblingHeights.map((height) => Math.max(1, height - MIN_DOCK_PANEL_HEIGHT));
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

      next[panelId] = { ...next[panelId], height: targetHeight };
      siblings.forEach((slot, index) => {
        const siblingId = getAssignedPanelId(slot.dataset.dockSlotId ?? "");
        if (!siblingId) return;
        const height = MIN_DOCK_PANEL_HEIGHT + flexibleHeight * (weights[index] / totalWeight);
        next[siblingId] = { ...current[siblingId], height };
      });
      return next;
    });
  }, [getAssignedPanelId, order, setSizes, stableSlotIds]);
  const getTarget = useCallback((panelId: string) => {
    const slotId = stableSlotIds[order.indexOf(panelId)];
    return slotId ? slotsRef.current.get(slotId) ?? null : null;
  }, [order, stableSlotIds, slotRevision]);
  const swapIntoSlot = useCallback((panelId: string, slotId: string) => {
    const targetIndex = stableSlotIds.indexOf(slotId);
    if (targetIndex < 0) return;
    const sourceIndex = order.indexOf(panelId);
    if (sourceIndex < 0 || sourceIndex === targetIndex) return;
    const displacedId = order[targetIndex];
    const next = [...order];
    [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
    setSizes((current) => {
      const resized = { ...current };
      stableSlotIds.forEach((currentSlotId, index) => {
        const slotHeight = slotsRef.current.get(currentSlotId)?.getBoundingClientRect().height;
        const nextPanelId = next[index];
        if (nextPanelId && slotHeight) resized[nextPanelId] = { ...current[nextPanelId], height: slotHeight };
      });
      return resized;
    });
    setStoredOrder(next);
    setSnappingIds([panelId, displacedId].filter(Boolean));
    if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current);
    snapTimerRef.current = window.setTimeout(() => {
      setSnappingIds([]);
      snapTimerRef.current = null;
    }, 320);
  }, [order, setSizes, setStoredOrder, stableSlotIds]);

  const isSnapping = useCallback((panelId: string) => snappingIds.includes(panelId), [snappingIds]);
  const resetLayout = useCallback(() => {
    setStoredOrder([...stablePanelIds]);
    setSizes({});
    setSnappingIds([]);
    window.dispatchEvent(new CustomEvent("findraw:reset-dock-layout"));
  }, [setSizes, setStoredOrder, stablePanelIds]);
  const toggleEditing = useCallback(() => {
    setEditing((current) => !current);
    setDraggingId(null);
    setHoveredSlotId(null);
  }, []);

  const value = useMemo<DockContextValue>(() => ({ draggingId, editing, getAssignedPanelId, getPanelSize, getTarget, hoveredSlotId, isSnapping, registerSlot, resetLayout, setDraggingId, setHoveredSlotId, setPanelSize, swapIntoSlot, toggleEditing }), [draggingId, editing, getAssignedPanelId, getPanelSize, getTarget, hoveredSlotId, isSnapping, registerSlot, resetLayout, setPanelSize, swapIntoSlot, toggleEditing]);
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

export function DockRail({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`dock-rail ${className}`}>{children}</div>;
}

export function DockControls() {
  const context = useContext(DockContext);
  if (!context) throw new Error("DockControls must be inside DockLayout.");
  return <div className={`dock-layout-controls ${context.editing ? "editing" : ""}`}>
    <button className="dock-layout-edit-button" onClick={context.toggleEditing} type="button">
      <span className="material-symbols-outlined">{context.editing ? "check" : "dashboard_customize"}</span>
      {context.editing ? "Done arranging" : "Arrange panels"}
    </button>
    {context.editing ? <button aria-label="Reset panel layout" className="dock-layout-reset-button" onClick={context.resetLayout} title="Reset panel layout" type="button"><span className="material-symbols-outlined">restart_alt</span></button> : null}
  </div>;
}

export function DockSlot({ id }: { id: string }) {
  const context = useContext(DockContext);
  if (!context) throw new Error("DockSlot must be inside DockLayout.");
  const assignedId = context.getAssignedPanelId(id);
  const size = context.getPanelSize(assignedId);
  const setRef = useCallback((element: HTMLDivElement | null) => context.registerSlot(id, element), [context.registerSlot, id]);
  const slotStyle = size.height ? { flex: `1 1 ${size.height}px`, height: `${size.height}px` } : undefined;
  return <div className={`dock-slot ${context.hoveredSlotId === id ? "drop-target" : ""}`} data-dock-slot-id={id} ref={setRef} style={slotStyle} />;
}

function snapDimension(value: number, points: number[], threshold = 11) {
  const nearest = points.reduce<{ distance: number; value: number } | null>((best, point) => {
    const distance = Math.abs(point - value);
    return !best || distance < best.distance ? { distance, value: point } : best;
  }, null);
  return nearest && nearest.distance <= threshold ? { value: nearest.value, snapped: true } : { value, snapped: false };
}

function useResize({ currentSize, heightSnapPoints = () => [], maxWidth, minHeight, minWidth, onChange, widthSnapPoints = () => [] }: { currentSize: PanelSize; heightSnapPoints?: () => number[]; maxWidth: () => number; minHeight: number; minWidth: number; onChange: (size: PanelSize) => void; widthSnapPoints?: () => number[] }) {
  const [resize, setResize] = useState<ResizeState | null>(null);
  const [snapAxis, setSnapAxis] = useState<SnapAxis>(null);
  const currentSizeRef = useRef(currentSize);
  const onChangeRef = useRef(onChange);
  useEffect(() => { currentSizeRef.current = currentSize; }, [currentSize]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => {
    if (!resize) return;
    let frame: number | null = null;
    let pendingEvent: PointerEvent | null = null;
    const applyMove = () => {
      frame = null;
      const event = pendingEvent;
      pendingEvent = null;
      if (!event || event.pointerId !== resize.pointerId) return;
      const deltaX = event.clientX - resize.startX;
      const deltaY = event.clientY - resize.startY;
      const next: PanelSize = { ...currentSizeRef.current };
      let widthSnapped = false;
      let heightSnapped = false;
      if (resize.direction.includes("e") || resize.direction.includes("w")) {
        const rawWidth = Math.min(resize.maxWidth, Math.max(minWidth, resize.startWidth + (resize.direction.includes("w") ? -deltaX : deltaX)));
        const snappedWidth = snapDimension(rawWidth, resize.widthSnapPoints);
        next.width = snappedWidth.value;
        widthSnapped = snappedWidth.snapped;
        next.anchor = resize.direction.includes("w") ? "right" : "left";
      }
      if (resize.direction.includes("n") || resize.direction.includes("s")) {
        const rawHeight = Math.min(window.innerHeight * 1.5, Math.max(minHeight, resize.startHeight + (resize.direction.includes("n") ? -deltaY : deltaY)));
        const snappedHeight = snapDimension(rawHeight, resize.heightSnapPoints);
        next.height = snappedHeight.value;
        heightSnapped = snappedHeight.snapped;
      }
      setSnapAxis(widthSnapped && heightSnapped ? "both" : widthSnapped ? "width" : heightSnapped ? "height" : null);
      onChangeRef.current(next);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== resize.pointerId) return;
      pendingEvent = event;
      if (frame === null) frame = window.requestAnimationFrame(applyMove);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId !== resize.pointerId) return;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        applyMove();
      }
      setResize(null);
      setSnapAxis(null);
      document.body.classList.remove("resizing-dock-panel");
      delete document.body.dataset.dockResizeDirection;
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
    };
  }, [minHeight, minWidth, resize]);

  const beginResize = (direction: Direction, event: ReactPointerEvent<HTMLDivElement>, rectangle: DOMRect) => {
    event.preventDefault();
    event.stopPropagation();
    const maximumWidth = maxWidth();
    setResize({ direction, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startWidth: rectangle.width, startHeight: rectangle.height, maxWidth: maximumWidth, widthSnapPoints: [...widthSnapPoints(), maximumWidth * .5, maximumWidth * .75, maximumWidth], heightSnapPoints: heightSnapPoints() });
    document.body.classList.add("resizing-dock-panel");
    document.body.dataset.dockResizeDirection = direction;
  };
  return { beginResize, resizing: resize !== null, snapAxis };
}

function ResizeHandles({ label, onBegin }: { label: string; onBegin: (direction: Direction, event: ReactPointerEvent<HTMLDivElement>) => void }) {
  return <>{handles.map(({ direction, label: edgeLabel }) => <div aria-label={`Resize ${label} from ${edgeLabel}`} className={`dock-resize-handle ${direction} ${direction.length === 2 ? "corner" : "edge"}`} key={direction} onPointerDown={(event) => onBegin(direction, event)} role="separator" />)}</>;
}

export function DockPanel({ children, id, label }: { children: ReactNode; id: string; label: string }) {
  const context = useContext(DockContext);
  if (!context) throw new Error("DockPanel must be inside DockLayout.");
  const target = context.getTarget(id);
  const size = context.getPanelSize(id);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hoverSlotRef = useRef<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  useEffect(() => () => document.body.classList.remove("dragging-dock-panel"), []);
  const updateSize = useCallback((next: PanelSize) => {
    const boundary = target?.closest<HTMLElement>("[data-dock-boundary]")?.dataset.dockBoundary as DockBoundary | undefined;
    const attached = Boolean(boundary && next.width && (next.anchor === boundary || next.width >= (target?.clientWidth ?? Infinity) - 2));
    context.setPanelSize(id, { ...next, boundary: attached ? boundary : undefined });
  }, [context.setPanelSize, id, target]);
  const getHeightSnapPoints = useCallback(() => {
    const rail = target?.parentElement;
    if (!rail) return [];
    const railHeight = rail.clientHeight;
    const siblingHeights = Array.from(rail.querySelectorAll<HTMLElement>("[data-dock-slot-id]"))
      .filter((slot) => slot !== target)
      .map((slot) => slot.getBoundingClientRect().height);
    return [...siblingHeights, railHeight * .25, railHeight / 3, railHeight * .5, railHeight * .75];
  }, [target]);
  const { beginResize, resizing, snapAxis } = useResize({ currentSize: size, heightSnapPoints: getHeightSnapPoints, maxWidth: () => target?.clientWidth ?? window.innerWidth, minHeight: MIN_DOCK_PANEL_HEIGHT, minWidth: 180, onChange: updateSize });

  useEffect(() => {
    if (!drag) return;
    let frame: number | null = null;
    let pendingPoint: { x: number; y: number } | null = null;
    const applyMove = () => {
      frame = null;
      const point = pendingPoint;
      pendingPoint = null;
      if (!point || !shellRef.current) return;
      shellRef.current.style.setProperty("--dock-drag-x", `${point.x - drag.startX}px`);
      shellRef.current.style.setProperty("--dock-drag-y", `${point.y - drag.startY}px`);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_START_DISTANCE) return;
        setDrag((current) => current ? { ...current, active: true } : null);
        context.setDraggingId(id);
        document.body.classList.add("dragging-dock-panel");
      }
      pendingPoint = { x: event.clientX, y: event.clientY };
      if (frame === null) frame = window.requestAnimationFrame(applyMove);
      const slotId = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-dock-slot-id]")?.dataset.dockSlotId ?? null;
      if (slotId !== hoverSlotRef.current) {
        hoverSlotRef.current = slotId;
        context.setHoveredSlotId(slotId);
      }
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return;
      if (drag.active && hoverSlotRef.current) context.swapIntoSlot(id, hoverSlotRef.current);
      if (frame !== null) window.cancelAnimationFrame(frame);
      shellRef.current?.style.removeProperty("--dock-drag-x");
      shellRef.current?.style.removeProperty("--dock-drag-y");
      hoverSlotRef.current = null;
      context.setHoveredSlotId(null);
      context.setDraggingId(null);
      document.body.classList.remove("dragging-dock-panel");
      setDrag(null);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
    };
  }, [context.setDraggingId, context.setHoveredSlotId, context.swapIntoSlot, drag?.active, drag?.pointerId, id]);

  if (!target) return null;
  const style = {
    ...(size.width ? { width: `${size.width}px`, maxWidth: "100%" } : { width: "100%" }),
    height: "100%",
    marginLeft: size.anchor === "right" ? "auto" : size.anchor === "center" ? "auto" : 0,
    marginRight: size.anchor === "left" ? "auto" : size.anchor === "center" ? "auto" : 0,
    ...(drag?.active ? { position: "fixed", left: `${drag.left}px`, top: `${drag.top}px`, width: `${drag.width}px`, maxWidth: "none", height: `${drag.height}px`, margin: 0, zIndex: 220 } : {}),
  } as CSSProperties;
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!context.editing) return;
    if (event.button !== 0) return;
    const targetElement = event.target as HTMLElement;
    if (!targetElement.closest(".source-card-header, .card-title, [data-dock-drag-handle]") || targetElement.closest("button, input, select, textarea, a")) {
      return;
    }
    const rectangle = event.currentTarget.getBoundingClientRect();
    event.preventDefault();
    hoverSlotRef.current = null;
    setDrag({ active: false, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height });
  };

  return createPortal(<div aria-label={`${label} dock panel`} className={`dock-panel-shell ${context.editing ? "layout-editing" : ""} ${context.draggingId === id ? "dragging" : ""} ${context.isSnapping(id) ? "snapping" : ""} ${resizing ? "resizing" : ""} ${snapAxis ? `resize-snap resize-snap-${snapAxis}` : ""}`} onPointerDownCapture={onPointerDown} ref={shellRef} style={style}>{children}{context.editing ? <ResizeHandles label={label} onBegin={(direction, event) => { const rectangle = shellRef.current?.getBoundingClientRect(); if (rectangle) beginResize(direction, event, rectangle); }} /> : null}</div>, target, id);
}

export function ResizableSurface({ children, className = "", label, storageKey }: { children: ReactNode; className?: string; label: string; storageKey: string }) {
  const dockContext = useContext(DockContext);
  const [size, setSize] = usePersistentState<PanelSize>(`${storageKey}.size`, {});
  const ref = useRef<HTMLDivElement | null>(null);
  const getSurfaceHeightSnaps = useCallback(() => {
    const parentHeight = ref.current?.parentElement?.clientHeight ?? window.innerHeight;
    return [96, 160, 240, 320, 480, 640, parentHeight * .25, parentHeight * .5, parentHeight * .75];
  }, []);
  useEffect(() => {
    const reset = () => setSize({});
    window.addEventListener("findraw:reset-dock-layout", reset);
    return () => window.removeEventListener("findraw:reset-dock-layout", reset);
  }, [setSize]);
  const { beginResize, resizing, snapAxis } = useResize({ currentSize: size, heightSnapPoints: getSurfaceHeightSnaps, maxWidth: () => ref.current?.parentElement?.clientWidth ?? window.innerWidth, minHeight: 64, minWidth: 280, onChange: setSize });
  const style = { ...(size.width ? { width: `${size.width}px`, maxWidth: "100%" } : { width: "100%" }), ...(size.height ? { height: `${size.height}px` } : {}), marginInline: "auto" } as CSSProperties;
  return <div className={`resizable-surface ${className} ${dockContext?.editing ? "layout-editing" : ""} ${resizing ? "resizing" : ""} ${snapAxis ? `resize-snap resize-snap-${snapAxis}` : ""}`} ref={ref} style={style}>{children}{dockContext?.editing ? <ResizeHandles label={label} onBegin={(direction, event) => { const rectangle = ref.current?.getBoundingClientRect(); if (rectangle) beginResize(direction, event, rectangle); }} /> : null}</div>;
}
