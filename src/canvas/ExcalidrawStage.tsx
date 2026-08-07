import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { DrawingToolbar } from "./DrawingToolbar";
import { DEFAULT_QUICK_COLORS, type BrushStyle, type CanvasTool, type ShapeTool } from "./drawingTypes";
import { useDrawingCanvas } from "./useDrawingCanvas";
import type { KeyboardShortcuts, ShortcutAction } from "../dashboard/keyboardShortcuts";
import { usePersistentState } from "../ui/usePersistentState";

type ExcalidrawStageProps = {
  canvasColor: string;
  gridSize: number;
  hoverMenuDelay: number;
  hoverMenusEnabled: boolean;
  onCanvasColorChange: (color: string) => void;
  onGridSizeChange: (size: number) => void;
  shortcuts: KeyboardShortcuts;
};

const isEditableTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return element?.matches("input, textarea, select, [contenteditable='true']") ?? false;
};

const parseHexColor = (color: string) => {
  const match = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const;
};

const relativeLuminance = (color: readonly number[]) => {
  const channels = color.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};


const contrastRatio = (first: readonly number[], second: readonly number[]) => {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
};

const resolveGridColor = (canvasColor: string, preferredColor: string) => {
  const canvas = parseHexColor(canvasColor);
  const preferred = parseHexColor(preferredColor);
  if (!canvas || !preferred || contrastRatio(canvas, preferred) >= 2) return preferredColor;
  const black = [17, 19, 28] as const;
  const white = [255, 255, 255] as const;
  return contrastRatio(canvas, black) >= contrastRatio(canvas, white) ? "#11131c" : "#ffffff";
};
export function ExcalidrawStage({ canvasColor, gridSize, hoverMenuDelay, hoverMenusEnabled, onCanvasColorChange, onGridSizeChange, shortcuts }: ExcalidrawStageProps) {
  const [activeTool, setActiveTool] = useState<CanvasTool>("freedraw");
  const [brushStyle, setBrushStyle] = usePersistentState<BrushStyle>("brush.style", "marker");
  const [activeColor, setActiveColor] = usePersistentState("drawing.activeColor", "#11131c");
  const [fillColor, setFillColor] = usePersistentState("drawing.fillColor", "#d94b45");
  const [quickColors, setQuickColors] = usePersistentState("drawing.quickColors", [...DEFAULT_QUICK_COLORS]);
  const [opacity, setOpacity] = usePersistentState("brush.opacity", 100);
  const [strokeWidth, setStrokeWidth] = usePersistentState("brush.size", 2);
  const [eraserSize, setEraserSize] = usePersistentState("eraser.size", 12);
  const [gridActive, setGridActive] = usePersistentState("grid.enabled", false);
  const [gridColor, setGridColor] = usePersistentState("grid.color", "#11131c");
  const [gridOpacity, setGridOpacity] = usePersistentState("grid.opacity", 8);
  const [clearingCanvas, setClearingCanvas] = useState(false);
  const resolvedGridColor = resolveGridColor(canvasColor, gridColor);

  useEffect(() => {
    try {
      const migrationKey = "findraw.migrations.grid-opacity-v2";
      if (window.localStorage.getItem(migrationKey)) return;
      if (gridOpacity === 8) setGridOpacity(16);
      window.localStorage.setItem(migrationKey, "1");
    } catch {
      // Keep the current session usable when storage is unavailable.
    }
  }, [gridOpacity, setGridOpacity]);

  const {
    canvasRef,
    drawingSurfaceRef,
    eraserTrailPath,
    handlePointerDown,
    handlePointerMove,
    finishGesture,
    undo,
    redo,
    clearCanvas,
  } = useDrawingCanvas({
    activeTool,
    activeColor: activeTool === "fill" ? fillColor : activeColor,
    brushStyle,
    opacity,
    strokeWidth,
    eraserSize,
  });

  const assignQuickColor = useCallback((index: number, color: string) => {
    setQuickColors((current) => current.map((item, itemIndex) => itemIndex === index ? color : item));
  }, []);

  const startClearSweep = useCallback(() => {
    if (!clearingCanvas) setClearingCanvas(true);
  }, [clearingCanvas]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const action = (Object.entries(shortcuts) as [ShortcutAction, string][])
        .find(([, assignedKey]) => assignedKey.toLowerCase() === key)?.[0];
      if (!action) return;
      event.preventDefault();

      if (action === "brush") setActiveTool("freedraw");
      else if (action === "eraser") setActiveTool("eraser");
      else if (action === "fill") setActiveTool("fill");
      else if (action === "color1") setActiveColor(quickColors[0]);
      else if (action === "color2") setActiveColor(quickColors[1]);
      else if (action === "color3") setActiveColor(quickColors[2]);
      else if (action === "undo") undo();
      else if (action === "redo") redo();
      else if (action === "grid") setGridActive((current) => !current);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [quickColors, redo, shortcuts, undo]);

  return (
    <div
      className="canvas-workbench"
      style={{
        "--canvas": canvasColor,
        "--grid-color": resolvedGridColor,
        "--grid-opacity": `${gridOpacity}%`,
        "--grid-size": `${gridSize}px`,
      } as CSSProperties}
    >
      <DrawingToolbar
        activeTool={activeTool}
        brushStyle={brushStyle}
        activeColor={activeColor}
        fillColor={fillColor}
        canvasColor={canvasColor}
        gridColor={gridColor}
        gridOpacity={gridOpacity}
        opacity={opacity}
        strokeWidth={strokeWidth}
        eraserSize={eraserSize}
        quickColors={quickColors}
        gridActive={gridActive}
        gridSize={gridSize}
        hoverMenuDelay={hoverMenuDelay}
        hoverMenusEnabled={hoverMenusEnabled}
        shortcuts={shortcuts}
        onToolChange={setActiveTool}
        onBrushStyleChange={setBrushStyle}
        onColorChange={setActiveColor}
        onFillColorChange={setFillColor}
        onCanvasColorChange={onCanvasColorChange}
        onEraserSizeChange={setEraserSize}
        onGridToggle={() => setGridActive((current) => !current)}
        onGridColorChange={setGridColor}
        onGridOpacityChange={setGridOpacity}
        onGridSizeChange={onGridSizeChange}
        onOpacityChange={setOpacity}
        onQuickColorAssign={assignQuickColor}
        onRedo={redo}
        onStrokeWidthChange={setStrokeWidth}
        onUndo={undo}
      />

      <div
        aria-label="Drawing canvas"
        className={`drawing-surface raster-drawing-surface ${gridActive ? "canvas-grid-active" : ""} ${activeTool === "eraser" ? "partial-eraser-active" : ""} ${activeTool === "fill" ? "fill-tool-active" : ""}`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerCancel={(event) => finishGesture(event, true)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishGesture(event)}
        ref={drawingSurfaceRef}
        role="application"
        tabIndex={0}
      >
        <button
          aria-label="Clear canvas"
          className="canvas-clear-button"
          disabled={clearingCanvas}
          onClick={startClearSweep}
          onPointerDown={(event) => event.stopPropagation()}
          title="Clear canvas"
          type="button"
        >
          <span className="material-symbols-outlined">delete_sweep</span>
        </button>
        <div className="canvas-shape-tools" aria-label="Shape tools" role="toolbar" onPointerDown={(event) => event.stopPropagation()}>
          {([
            ["line", "horizontal_rule", "Line"],
            ["dotted-line", "more_horiz", "Dotted line"],
            ["arrow", "east", "Arrow"],
            ["rectangle", "rectangle", "Rectangle"],
            ["ellipse", "circle", "Ellipse"],
          ] as [ShapeTool, string, string][]).map(([tool, icon, label]) => (
            <button aria-label={label} className={activeTool === tool ? "active" : ""} key={tool} onClick={() => setActiveTool(tool)} title={label} type="button">
              <span className="material-symbols-outlined">{icon}</span>
            </button>
          ))}
        </div>
        <canvas className="raster-drawing-canvas" ref={canvasRef} />
        {clearingCanvas && (
          <div aria-hidden="true" className="canvas-clear-animation">
            <div
              className={`canvas-clear-cover ${gridActive ? "with-grid" : ""}`}
              onAnimationEnd={() => {
                clearCanvas();
                setClearingCanvas(false);
              }}
            />
            <div className="canvas-clear-scanline" />
          </div>
        )}
        {activeTool === "eraser" && eraserTrailPath && (
          <svg aria-hidden="true" className="detail-eraser-trail" height="100%" width="100%">
            <path d={eraserTrailPath} fill="rgba(0, 0, 0, 0.2)" />
          </svg>
        )}
      </div>
    </div>
  );
}





