import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { applyOperation, composeLayers, renderOperationHistory } from "./drawingEngine";
import type {
  BrushStyle,
  CanvasTool,
  DrawPoint,
  DrawingOperation,
  FillOperation,
  LayerContexts,
  ShapeTool,
} from "./drawingTypes";
import { createNativeEraserTrail, getSvgPathFromStroke } from "./strokeRenderers";

type DrawingCanvasOptions = {
  activeTool: CanvasTool;
  activeColor: string;
  brushStyle: BrushStyle;
  opacity: number;
  strokeWidth: number;
  eraserSize: number;
  externalOperations?: DrawingOperation[];
  liveOperation?: DrawingOperation | null;
  onOperationsChange?: (operations: DrawingOperation[]) => void;
  onLiveOperation?: (operation: DrawingOperation | null) => void;
};

const isShapeTool = (tool: CanvasTool): tool is ShapeTool => (["line", "dotted-line", "arrow", "rectangle", "ellipse"] as CanvasTool[]).includes(tool);

type ShapeModifiers = {
  shift: boolean;
  ctrl: boolean;
};

const getShapeBounds = (shape: ShapeTool, anchor: DrawPoint, pointer: DrawPoint, modifiers: ShapeModifiers) => {
  let deltaX = pointer[0] - anchor[0];
  let deltaY = pointer[1] - anchor[1];

  if (modifiers.shift) {
    if (shape === "line" || shape === "dotted-line" || shape === "arrow") {
      const length = Math.hypot(deltaX, deltaY);
      const angleStep = Math.PI / 4;
      const angle = Math.round(Math.atan2(deltaY, deltaX) / angleStep) * angleStep;
      deltaX = Math.cos(angle) * length;
      deltaY = Math.sin(angle) * length;
    } else {
      const size = Math.max(Math.abs(deltaX), Math.abs(deltaY));
      deltaX = (Math.sign(deltaX) || 1) * size;
      deltaY = (Math.sign(deltaY) || 1) * size;
    }
  }

  if (modifiers.ctrl) {
    return {
      start: [anchor[0] - deltaX, anchor[1] - deltaY] as [number, number],
      end: [anchor[0] + deltaX, anchor[1] + deltaY] as [number, number],
    };
  }

  return {
    start: [anchor[0], anchor[1]] as [number, number],
    end: [anchor[0] + deltaX, anchor[1] + deltaY] as [number, number],
  };
};

type GestureSnapshot = {
  ink: ImageData;
  fill: ImageData;
};

export const useDrawingCanvas = ({
  activeTool,
  activeColor,
  brushStyle,
  opacity,
  strokeWidth,
  eraserSize,
  externalOperations,
  liveOperation,
  onOperationsChange,
  onLiveOperation,
}: DrawingCanvasOptions) => {
  const [eraserTrailPath, setEraserTrailPath] = useState("");
  const drawingSurfaceRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fillCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const operationsRef = useRef<DrawingOperation[]>([]);
  const liveOperationRef = useRef<DrawingOperation | null>(null);
  const redoOperationsRef = useRef<DrawingOperation[]>([]);
  const currentPointsRef = useRef<DrawPoint[]>([]);
  const gestureSnapshotRef = useRef<GestureSnapshot | null>(null);
  const drawingRef = useRef(false);
  const activePointerRef = useRef<number | null>(null);
  const shapeModifiersRef = useRef<ShapeModifiers>({ shift: false, ctrl: false });
  const devicePixelRatioRef = useRef(1);
  const eraserTrailRef = useRef<ReturnType<typeof createNativeEraserTrail> | null>(null);
  const eraserTrailAnimationRef = useRef<number | null>(null);
  const lastLiveOperationAtRef = useRef(0);

  const getLayerContexts = useCallback((): LayerContexts | null => {
    const visible = canvasRef.current?.getContext("2d");
    const ink = inkCanvasRef.current?.getContext("2d");
    const fill = fillCanvasRef.current?.getContext("2d");
    return visible && ink && fill ? { visible, ink, fill } : null;
  }, []);

  const renderOperations = useCallback((operations = operationsRef.current) => {
    const layers = getLayerContexts();
    if (!layers) return;
    renderOperationHistory(layers, operations, devicePixelRatioRef.current);
    if (liveOperationRef.current) {
      applyOperation(layers, liveOperationRef.current);
      composeLayers(layers);
    }
  }, [getLayerContexts]);

  useEffect(() => {
    if (!externalOperations) return;
    operationsRef.current = externalOperations;
    redoOperationsRef.current = [];
    renderOperations(externalOperations);
  }, [externalOperations, renderOperations]);

  useEffect(() => {
    liveOperationRef.current = liveOperation ?? null;
    renderOperations();
  }, [liveOperation, renderOperations]);

  const publishOperations = useCallback(() => {
    onOperationsChange?.([...operationsRef.current]);
  }, [onOperationsChange]);

  const publishLiveOperation = useCallback((operation: DrawingOperation | null, force = false) => {
    if (!onLiveOperation) return;
    const now = performance.now();
    if (!force && now - lastLiveOperationAtRef.current < 50) return;
    lastLiveOperationAtRef.current = now;
    onLiveOperation(operation);
  }, [onLiveOperation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const surface = drawingSurfaceRef.current;
    if (!canvas || !surface) return;
    if (!inkCanvasRef.current) inkCanvasRef.current = document.createElement("canvas");
    if (!fillCanvasRef.current) fillCanvasRef.current = document.createElement("canvas");

    const resize = () => {
      const rectangle = surface.getBoundingClientRect();
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rectangle.width * ratio));
      const height = Math.max(1, Math.round(rectangle.height * ratio));
      const canvases = [canvas, inkCanvasRef.current!, fillCanvasRef.current!];
      if (canvases.every((item) => item.width === width && item.height === height)) return;
      devicePixelRatioRef.current = ratio;
      canvases.forEach((item) => {
        item.width = width;
        item.height = height;
      });
      renderOperations();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [renderOperations]);

  const getPointFromClient = useCallback((clientX: number, clientY: number, pressure = 0.5): DrawPoint => {
    const rectangle = drawingSurfaceRef.current!.getBoundingClientRect();
    return [clientX - rectangle.left, clientY - rectangle.top, pressure > 0 ? pressure : 0.5];
  }, []);

  const getPoint = useCallback((event: ReactPointerEvent<HTMLDivElement>): DrawPoint => (
    getPointFromClient(event.clientX, event.clientY, event.pressure)
  ), [getPointFromClient]);

  const getCoalescedPoints = useCallback((event: ReactPointerEvent<HTMLDivElement>): DrawPoint[] => {
    const nativeEvent = event.nativeEvent;
    const samples = typeof nativeEvent.getCoalescedEvents === "function"
      ? nativeEvent.getCoalescedEvents()
      : [nativeEvent];
    const source = samples.length ? samples : [nativeEvent];
    return source.map((sample) => getPointFromClient(sample.clientX, sample.clientY, sample.pressure));
  }, [getPointFromClient]);

  const createCurrentOperation = useCallback((points: DrawPoint[], complete = false): DrawingOperation => {
    if (activeTool === "eraser") return { type: "eraser", points, size: eraserSize };
    if (isShapeTool(activeTool)) {
      const first = points[0];
      const last = points.at(-1) ?? first;
      const bounds = getShapeBounds(activeTool, first, last, shapeModifiersRef.current);
      return {
        type: "shape",
        shape: activeTool,
        start: bounds.start,
        end: bounds.end,
        color: activeColor,
        opacity,
        strokeWidth,
      };
    }
    return {
      type: "brush",
      style: brushStyle,
      points,
      color: activeColor,
      opacity,
      strokeWidth,
      complete,
    };
  }, [activeColor, activeTool, brushStyle, eraserSize, opacity, strokeWidth]);

  const restoreGestureSnapshot = useCallback(() => {
    const layers = getLayerContexts();
    const snapshot = gestureSnapshotRef.current;
    if (!layers || !snapshot) return;
    layers.ink.save();
    layers.ink.setTransform(1, 0, 0, 1, 0, 0);
    layers.ink.putImageData(snapshot.ink, 0, 0);
    layers.ink.restore();
    layers.fill.save();
    layers.fill.setTransform(1, 0, 0, 1, 0, 0);
    layers.fill.putImageData(snapshot.fill, 0, 0);
    layers.fill.restore();
    const ratio = devicePixelRatioRef.current;
    layers.ink.setTransform(ratio, 0, 0, ratio, 0, 0);
    layers.fill.setTransform(ratio, 0, 0, ratio, 0, 0);
    composeLayers(layers);
  }, [getLayerContexts]);

  const renderCurrentGesture = useCallback(() => {
    const layers = getLayerContexts();
    if (!layers || !currentPointsRef.current.length) return;
    restoreGestureSnapshot();
    applyOperation(layers, createCurrentOperation(currentPointsRef.current));
    composeLayers(layers);
  }, [createCurrentOperation, getLayerContexts, restoreGestureSnapshot]);

  const updateEraserTrailPath = useCallback(() => {
    const trail = eraserTrailRef.current;
    if (!trail) {
      setEraserTrailPath("");
      return false;
    }
    const outline = trail.getStrokeOutline(5);
    if (!outline.length) {
      setEraserTrailPath("");
      return false;
    }
    setEraserTrailPath(getSvgPathFromStroke(outline));
    return true;
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    shapeModifiersRef.current = { shift: event.shiftKey, ctrl: event.ctrlKey };
    event.currentTarget.focus();
    if (activeTool === "fill") {
      const point = getPoint(event);
      const operation: FillOperation = { type: "fill", x: point[0], y: point[1], color: activeColor, opacity };
      const layers = getLayerContexts();
      if (layers) {
        applyOperation(layers, operation);
        composeLayers(layers);
        operationsRef.current.push(operation);
        redoOperationsRef.current = [];
        publishOperations();
      }
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    drawingRef.current = true;
    currentPointsRef.current = [getPoint(event)];

    const layers = getLayerContexts();
    if (layers) {
      const { width, height } = layers.ink.canvas;
      gestureSnapshotRef.current = {
        ink: layers.ink.getImageData(0, 0, width, height),
        fill: layers.fill.getImageData(0, 0, width, height),
      };
    }

    if (activeTool === "eraser") {
      if (eraserTrailAnimationRef.current !== null) cancelAnimationFrame(eraserTrailAnimationRef.current);
      const trail = createNativeEraserTrail();
      const point = currentPointsRef.current[0];
      trail.addPoint([point[0], point[1], performance.now()]);
      eraserTrailRef.current = trail;
    }
    renderCurrentGesture();
  }, [activeColor, activeTool, getLayerContexts, getPoint, opacity, publishOperations, renderCurrentGesture]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current || activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    shapeModifiersRef.current = { shift: event.shiftKey, ctrl: event.ctrlKey };
    const samples = getCoalescedPoints(event);
    let addedPoint = false;
    for (const point of samples) {
      const previous = currentPointsRef.current.at(-1);
      if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 0.2) continue;
      currentPointsRef.current.push(point);
      addedPoint = true;
      if (activeTool === "eraser") {
        eraserTrailRef.current?.addPoint([point[0], point[1], performance.now()]);
      }
    }
    if (!addedPoint) return;
    if (activeTool === "eraser") updateEraserTrailPath();
    renderCurrentGesture();
    publishLiveOperation(createCurrentOperation([...currentPointsRef.current], false));
  }, [activeTool, createCurrentOperation, getCoalescedPoints, publishLiveOperation, renderCurrentGesture, updateEraserTrailPath]);

  const finishGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!drawingRef.current || activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    shapeModifiersRef.current = { shift: event.shiftKey, ctrl: event.ctrlKey };
    const point = getPoint(event);
    const previous = currentPointsRef.current.at(-1);
    if (!cancelled && (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) >= 0.2)) {
      currentPointsRef.current.push(point);
    }

    restoreGestureSnapshot();
    if (!cancelled && currentPointsRef.current.length) {
      const operation = createCurrentOperation([...currentPointsRef.current], true);
      const layers = getLayerContexts();
      if (layers) {
        applyOperation(layers, operation);
        composeLayers(layers);
        operationsRef.current.push(operation);
        redoOperationsRef.current = [];
        publishOperations();
      }
    }

    publishLiveOperation(null, true);
    drawingRef.current = false;
    activePointerRef.current = null;
    currentPointsRef.current = [];
    gestureSnapshotRef.current = null;

    if (activeTool === "eraser") {
      const trail = eraserTrailRef.current;
      if (trail) {
        trail.close();
        trail.options.keepHead = false;
        const animateTrail = () => {
          if (updateEraserTrailPath()) eraserTrailAnimationRef.current = requestAnimationFrame(animateTrail);
          else {
            eraserTrailRef.current = null;
            eraserTrailAnimationRef.current = null;
          }
        };
        eraserTrailAnimationRef.current = requestAnimationFrame(animateTrail);
      }
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, [activeTool, createCurrentOperation, getLayerContexts, getPoint, publishOperations, restoreGestureSnapshot, updateEraserTrailPath]);

  const undo = useCallback(() => {
    if (drawingRef.current || !operationsRef.current.length) return;
    const operation = operationsRef.current.pop();
    if (operation) redoOperationsRef.current.push(operation);
    renderOperations();
    publishOperations();
  }, [publishOperations, renderOperations]);

  const redo = useCallback(() => {
    if (drawingRef.current || !redoOperationsRef.current.length) return;
    const operation = redoOperationsRef.current.pop();
    if (operation) operationsRef.current.push(operation);
    renderOperations();
    publishOperations();
  }, [publishOperations, renderOperations]);

  const clearCanvas = useCallback(() => {
    if (drawingRef.current) return;
    operationsRef.current = [];
    redoOperationsRef.current = [];
    renderOperations();
    publishOperations();
  }, [publishOperations, renderOperations]);


  useEffect(() => {
    if (activeTool !== "eraser") return;
    const size = Math.ceil(eraserSize + 4);
    const cursorCanvas = document.createElement("canvas");
    cursorCanvas.width = size;
    cursorCanvas.height = size;
    const context = cursorCanvas.getContext("2d");
    if (!context) return;
    context.lineWidth = 1;
    context.beginPath();
    context.arc(size / 2, size / 2, eraserSize / 2, 0, Math.PI * 2);
    context.fillStyle = "rgba(255, 255, 255, 0.6)";
    context.fill();
    context.strokeStyle = "#11131c";
    context.stroke();
    drawingSurfaceRef.current?.style.setProperty(
      "--detail-eraser-cursor",
      `url(${cursorCanvas.toDataURL()}) ${size / 2} ${size / 2}, auto`,
    );
    return () => { drawingSurfaceRef.current?.style.removeProperty("--detail-eraser-cursor"); };
  }, [activeTool, eraserSize]);

  useEffect(() => () => {
    if (eraserTrailAnimationRef.current !== null) cancelAnimationFrame(eraserTrailAnimationRef.current);
  }, []);

  return {
    canvasRef,
    drawingSurfaceRef,
    eraserTrailPath,
    handlePointerDown,
    handlePointerMove,
    finishGesture,
    undo,
    redo,
    clearCanvas,
  };
};





