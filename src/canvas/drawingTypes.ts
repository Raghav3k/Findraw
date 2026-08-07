export type BrushStyle = "marker" | "pencil" | "dotted";
export type ShapeTool = "line" | "dotted-line" | "arrow" | "rectangle" | "ellipse";
export type CanvasTool = "freedraw" | "eraser" | "fill" | ShapeTool;

export type DrawPoint = [number, number, number];

export type BrushOperation = {
  type: "brush";
  style: BrushStyle;
  points: DrawPoint[];
  color: string;
  opacity: number;
  strokeWidth: number;
  complete: boolean;
};

export type EraserOperation = {
  type: "eraser";
  points: DrawPoint[];
  size: number;
};

export type FillOperation = {
  type: "fill";
  x: number;
  y: number;
  color: string;
  opacity: number;
};

export type ShapeOperation = {
  type: "shape";
  shape: ShapeTool;
  start: [number, number];
  end: [number, number];
  color: string;
  opacity: number;
  strokeWidth: number;
};
export type DrawingOperation = BrushOperation | EraserOperation | FillOperation | ShapeOperation;

export type LayerContexts = {
  visible: CanvasRenderingContext2D;
  ink: CanvasRenderingContext2D;
  fill: CanvasRenderingContext2D;
};

export const DEFAULT_QUICK_COLORS = ["#11131c", "#ffdb58", "#08f5ff"];



