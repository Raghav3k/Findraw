export type DockBoundary = "left" | "right";

export const DOCK_RAIL_RESIZE_EVENT = "findraw:dock-rail-resize";
export const SOURCE_RAIL_SNAP_POINTS = [320, 380, 460];
export const SIDE_RAIL_SNAP_POINTS = [280, 340, 400];

export function snapDockRailWidth(width: number, points: number[], threshold = 10) {
  const snapPoint = points.find((point) => Math.abs(point - width) <= threshold);
  return snapPoint === undefined ? { snapped: false, width } : { snapped: true, width: snapPoint };
}

export function resizeDockBoundary(boundary: DockBoundary, previousWidth: number, nextWidth: number) {
  if (previousWidth === nextWidth) return;
  window.dispatchEvent(new CustomEvent(DOCK_RAIL_RESIZE_EVENT, { detail: { boundary, previousWidth, nextWidth } }));
}
