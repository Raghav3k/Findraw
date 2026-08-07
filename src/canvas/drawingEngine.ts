import type { DrawingOperation, LayerContexts } from "./drawingTypes";
import { drawLayerFloodFill } from "./floodFill";
import { drawBrushStroke, drawEraserStroke, drawShapeStroke } from "./strokeRenderers";

export const clearContext = (context: CanvasRenderingContext2D) => {
  const { width, height } = context.canvas;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.restore();
};

export const composeLayers = ({ visible, ink, fill }: LayerContexts) => {
  clearContext(visible);
  visible.save();
  visible.setTransform(1, 0, 0, 1, 0, 0);
  visible.drawImage(fill.canvas, 0, 0);
  visible.drawImage(ink.canvas, 0, 0);
  visible.restore();
};

export const applyOperation = (layers: LayerContexts, operation: DrawingOperation) => {
  if (operation.type === "brush") {
    drawBrushStroke(layers.ink, operation);
  } else if (operation.type === "eraser") {
    drawEraserStroke(layers.ink, operation);
    drawEraserStroke(layers.fill, operation);
  } else if (operation.type === "shape") {
    drawShapeStroke(layers.ink, operation);
  } else {
    drawLayerFloodFill(layers.fill, layers.ink, operation);
  }
};

export const renderOperationHistory = (
  layers: LayerContexts,
  operations: DrawingOperation[],
  pixelRatio: number,
) => {
  clearContext(layers.ink);
  clearContext(layers.fill);
  layers.ink.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  layers.fill.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  operations.forEach((operation) => applyOperation(layers, operation));
  composeLayers(layers);
};


