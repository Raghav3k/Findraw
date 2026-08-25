export type DockBoundary = "left" | "right";

export const DOCK_RAIL_RESIZE_EVENT = "findraw:dock-rail-resize";

export function resizeDockBoundary(boundary: DockBoundary, previousWidth: number, nextWidth: number) {
  if (previousWidth === nextWidth) return;
  window.dispatchEvent(new CustomEvent(DOCK_RAIL_RESIZE_EVENT, { detail: { boundary, previousWidth, nextWidth } }));
}
