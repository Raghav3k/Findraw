export type DrawingDelta<T> = { index: number; deleteCount: number; operations: T[] };
export function drawingDelta<T>(before: T[], after: T[]): DrawingDelta<T>;
export function applyDrawingDelta<T>(before: T[], delta: DrawingDelta<T>): T[];
