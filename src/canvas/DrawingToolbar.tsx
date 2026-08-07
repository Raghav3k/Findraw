import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { DEFAULT_QUICK_COLORS, type BrushStyle, type CanvasTool } from "./drawingTypes";
import type { KeyboardShortcuts } from "../dashboard/keyboardShortcuts";
import { ColorPickerPanel } from "../ui/ColorPickerPanel";

type DrawingToolbarProps = {
  activeTool: CanvasTool;
  brushStyle: BrushStyle;
  activeColor: string;
  fillColor: string;
  canvasColor: string;
  gridColor: string;
  gridOpacity: number;
  opacity: number;
  strokeWidth: number;
  eraserSize: number;
  quickColors: string[];
  gridActive: boolean;
  gridSize: number;
  hoverMenuDelay: number;
  hoverMenusEnabled: boolean;
  shortcuts: KeyboardShortcuts;
  onToolChange: (tool: CanvasTool) => void;
  onBrushStyleChange: (style: BrushStyle) => void;
  onColorChange: (color: string) => void;
  onFillColorChange: (color: string) => void;
  onCanvasColorChange: (color: string) => void;
  onGridColorChange: (color: string) => void;
  onGridOpacityChange: (opacity: number) => void;
  onOpacityChange: (opacity: number) => void;
  onStrokeWidthChange: (width: number) => void;
  onEraserSizeChange: (size: number) => void;
  onQuickColorAssign: (index: number, color: string) => void;
  onGridToggle: () => void;
  onGridSizeChange: (size: number) => void;
  onUndo: () => void;
  onRedo: () => void;
};

type FlyoutKind = "brush" | "eraser";

export function DrawingToolbar({
  activeTool,
  brushStyle,
  activeColor,
  fillColor,
  canvasColor,
  gridColor,
  gridOpacity,
  opacity,
  strokeWidth,
  eraserSize,
  quickColors,
  gridActive,
  gridSize,
  hoverMenuDelay,
  hoverMenusEnabled,
  shortcuts,
  onToolChange,
  onBrushStyleChange,
  onColorChange,
  onFillColorChange,
  onCanvasColorChange,
  onGridColorChange,
  onGridOpacityChange,
  onOpacityChange,
  onStrokeWidthChange,
  onEraserSizeChange,
  onQuickColorAssign,
  onGridToggle,
  onGridSizeChange,
  onUndo,
  onRedo,
}: DrawingToolbarProps) {
  const [editingColor, setEditingColor] = useState<number | null>(null);
  const [brushMenuOpen, setBrushMenuOpen] = useState(false);
  const [brushMenuPinned, setBrushMenuPinned] = useState(false);
  const [eraserMenuOpen, setEraserMenuOpen] = useState(false);
  const [eraserMenuPinned, setEraserMenuPinned] = useState(false);
  const [gridMenuOpen, setGridMenuOpen] = useState(false);
  const [gridMenuPinned, setGridMenuPinned] = useState(false);
  const [canvasMenuOpen, setCanvasMenuOpen] = useState(false);
  const [canvasMenuPinned, setCanvasMenuPinned] = useState(false);
  const [fillMenuOpen, setFillMenuOpen] = useState(false);
  const [fillMenuPinned, setFillMenuPinned] = useState(false);
  const [colorMenuPinned, setColorMenuPinned] = useState(false);

  const brushMenuRef = useRef<HTMLDivElement | null>(null);
  const eraserMenuRef = useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const eraserHoverTimerRef = useRef<number | null>(null);
  const eraserHoldTimerRef = useRef<number | null>(null);
  const eraserCloseTimerRef = useRef<number | null>(null);
  const colorHoldTimerRef = useRef<number | null>(null);
  const colorHoverTimerRef = useRef<number | null>(null);
  const colorCloseTimerRef = useRef<number | null>(null);
  const gridMenuRef = useRef<HTMLDivElement | null>(null);
  const gridHoverTimerRef = useRef<number | null>(null);
  const gridHoldTimerRef = useRef<number | null>(null);
  const gridCloseTimerRef = useRef<number | null>(null);
  const canvasMenuRef = useRef<HTMLDivElement | null>(null);
  const canvasHoverTimerRef = useRef<number | null>(null);
  const canvasCloseTimerRef = useRef<number | null>(null);
  const fillMenuRef = useRef<HTMLDivElement | null>(null);
  const fillHoverTimerRef = useRef<number | null>(null);
  const fillHoldTimerRef = useRef<number | null>(null);
  const fillCloseTimerRef = useRef<number | null>(null);
  const holdActionTriggeredRef = useRef(false);

  useEffect(() => {
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!brushMenuRef.current?.contains(target)) {
        setBrushMenuPinned(false);
        setBrushMenuOpen(false);
      }
      if (!eraserMenuRef.current?.contains(target)) {
        setEraserMenuPinned(false);
        setEraserMenuOpen(false);
      }
      if (!gridMenuRef.current?.contains(target)) {
        setGridMenuPinned(false);
        setGridMenuOpen(false);
      }
      if (!canvasMenuRef.current?.contains(target)) {
        setCanvasMenuPinned(false);
        setCanvasMenuOpen(false);
      }
      if (!fillMenuRef.current?.contains(target)) {
        setFillMenuPinned(false);
        setFillMenuOpen(false);
      }
      if (!(target as Element).closest?.(".color-slot-wrap")) {
        setColorMenuPinned(false);
        setEditingColor(null);
      }
    };
    document.addEventListener("pointerdown", closeFromOutside);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      [hoverTimerRef, holdTimerRef, closeTimerRef, eraserHoverTimerRef, eraserHoldTimerRef, eraserCloseTimerRef, colorHoldTimerRef, colorHoverTimerRef, colorCloseTimerRef, gridHoverTimerRef, gridHoldTimerRef, gridCloseTimerRef, canvasHoverTimerRef, canvasCloseTimerRef, fillHoverTimerRef, fillHoldTimerRef, fillCloseTimerRef]
        .forEach((ref) => ref.current && window.clearTimeout(ref.current));
    };
  }, []);

  const scheduleMenu = useCallback((kind: FlyoutKind) => {
    if (!hoverMenusEnabled) return;
    const closeRef = kind === "brush" ? closeTimerRef : eraserCloseTimerRef;
    const hoverRef = kind === "brush" ? hoverTimerRef : eraserHoverTimerRef;
    const pinned = kind === "brush" ? brushMenuPinned : eraserMenuPinned;
    if (closeRef.current) window.clearTimeout(closeRef.current);
    if (pinned) return;
    if (hoverRef.current) window.clearTimeout(hoverRef.current);
    hoverRef.current = window.setTimeout(() => {
      kind === "brush" ? setBrushMenuOpen(true) : setEraserMenuOpen(true);
    }, hoverMenuDelay);
  }, [brushMenuPinned, eraserMenuPinned, hoverMenuDelay, hoverMenusEnabled]);

  const closeMenu = useCallback((kind: FlyoutKind) => {
    const hoverRef = kind === "brush" ? hoverTimerRef : eraserHoverTimerRef;
    const closeRef = kind === "brush" ? closeTimerRef : eraserCloseTimerRef;
    const pinned = kind === "brush" ? brushMenuPinned : eraserMenuPinned;
    if (hoverRef.current) window.clearTimeout(hoverRef.current);
    if (!pinned) {
      closeRef.current = window.setTimeout(() => {
        kind === "brush" ? setBrushMenuOpen(false) : setEraserMenuOpen(false);
      }, 200);
    }
  }, [brushMenuPinned, eraserMenuPinned]);

  const startMenuHold = useCallback((kind: FlyoutKind) => {
    holdActionTriggeredRef.current = false;
    const timerRef = kind === "brush" ? holdTimerRef : eraserHoldTimerRef;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      holdActionTriggeredRef.current = true;
      if (kind === "brush") {
        setBrushMenuPinned(true);
        setBrushMenuOpen(true);
      } else {
        setEraserMenuPinned(true);
        setEraserMenuOpen(true);
      }
    }, 500);
  }, []);

  const stopMenuHold = useCallback((kind: FlyoutKind) => {
    const timerRef = kind === "brush" ? holdTimerRef : eraserHoldTimerRef;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const scheduleGridMenu = useCallback(() => {
    if (!hoverMenusEnabled) return;
    if (gridCloseTimerRef.current) window.clearTimeout(gridCloseTimerRef.current);
    if (gridMenuPinned) return;
    if (gridHoverTimerRef.current) window.clearTimeout(gridHoverTimerRef.current);
    gridHoverTimerRef.current = window.setTimeout(() => setGridMenuOpen(true), hoverMenuDelay);
  }, [gridMenuPinned, hoverMenuDelay, hoverMenusEnabled]);

  const closeGridMenu = useCallback(() => {
    if (gridHoverTimerRef.current) window.clearTimeout(gridHoverTimerRef.current);
    if (!gridMenuPinned) gridCloseTimerRef.current = window.setTimeout(() => setGridMenuOpen(false), 200);
  }, [gridMenuPinned]);

  const startGridHold = useCallback(() => {
    holdActionTriggeredRef.current = false;
    if (gridHoldTimerRef.current) window.clearTimeout(gridHoldTimerRef.current);
    gridHoldTimerRef.current = window.setTimeout(() => {
      holdActionTriggeredRef.current = true;
      setGridMenuPinned(true);
      setGridMenuOpen(true);
    }, 500);
  }, []);

  const stopGridHold = useCallback(() => {
    if (gridHoldTimerRef.current) window.clearTimeout(gridHoldTimerRef.current);
    gridHoldTimerRef.current = null;
  }, []);

  const scheduleCanvasMenu = useCallback(() => {
    if (!hoverMenusEnabled) return;
    if (canvasCloseTimerRef.current) window.clearTimeout(canvasCloseTimerRef.current);
    if (canvasMenuPinned) return;
    if (canvasHoverTimerRef.current) window.clearTimeout(canvasHoverTimerRef.current);
    canvasHoverTimerRef.current = window.setTimeout(() => setCanvasMenuOpen(true), hoverMenuDelay);
  }, [canvasMenuPinned, hoverMenuDelay, hoverMenusEnabled]);

  const closeCanvasMenu = useCallback(() => {
    if (canvasHoverTimerRef.current) window.clearTimeout(canvasHoverTimerRef.current);
    if (!canvasMenuPinned) canvasCloseTimerRef.current = window.setTimeout(() => setCanvasMenuOpen(false), 200);
  }, [canvasMenuPinned]);

  const toggleCanvasMenu = useCallback(() => {
    const nextPinned = !canvasMenuPinned;
    setCanvasMenuPinned(nextPinned);
    setCanvasMenuOpen(nextPinned);
  }, [canvasMenuPinned]);
  const assignQuickColor = useCallback((index: number, color: string) => {
    onQuickColorAssign(index, color);
    onColorChange(color);
  }, [onColorChange, onQuickColorAssign]);

  const startColorHold = useCallback((index: number) => {
    holdActionTriggeredRef.current = false;
    if (colorHoldTimerRef.current) window.clearTimeout(colorHoldTimerRef.current);
    colorHoldTimerRef.current = window.setTimeout(() => {
      holdActionTriggeredRef.current = true;
      setColorMenuPinned(true);
      setEditingColor(index);
    }, 500);
  }, []);

  const stopColorHold = useCallback(() => {
    if (colorHoldTimerRef.current) window.clearTimeout(colorHoldTimerRef.current);
    colorHoldTimerRef.current = null;
  }, []);

  const activateToolFromTap = useCallback((tool: CanvasTool) => {
    if (holdActionTriggeredRef.current) {
      holdActionTriggeredRef.current = false;
      return;
    }
    onToolChange(tool);
  }, [onToolChange]);

  const toggleGridFromTap = useCallback(() => {
    if (holdActionTriggeredRef.current) {
      holdActionTriggeredRef.current = false;
      return;
    }
    onGridToggle();
  }, [onGridToggle]);

  const selectQuickColorFromTap = useCallback((color: string) => {
    if (holdActionTriggeredRef.current) {
      holdActionTriggeredRef.current = false;
      return;
    }
    onColorChange(color);
  }, [onColorChange]);

  const scheduleColorSlot = useCallback((index: number) => {
    if (!hoverMenusEnabled) return;
    if (colorCloseTimerRef.current) window.clearTimeout(colorCloseTimerRef.current);
    if (colorMenuPinned) return;
    if (colorHoverTimerRef.current) window.clearTimeout(colorHoverTimerRef.current);
    colorHoverTimerRef.current = window.setTimeout(() => setEditingColor(index), hoverMenuDelay);
  }, [colorMenuPinned, hoverMenuDelay, hoverMenusEnabled]);

  const closeColorSlot = useCallback((index: number) => {
    if (colorHoverTimerRef.current) window.clearTimeout(colorHoverTimerRef.current);
    if (colorMenuPinned) return;
    colorCloseTimerRef.current = window.setTimeout(() => {
      setEditingColor((current) => current === index ? null : current);
    }, 200);
  }, [colorMenuPinned]);

  const scheduleFillMenu = useCallback(() => {
    if (!hoverMenusEnabled) return;
    if (fillCloseTimerRef.current) window.clearTimeout(fillCloseTimerRef.current);
    if (fillMenuPinned) return;
    if (fillHoverTimerRef.current) window.clearTimeout(fillHoverTimerRef.current);
    fillHoverTimerRef.current = window.setTimeout(() => setFillMenuOpen(true), hoverMenuDelay);
  }, [fillMenuPinned, hoverMenuDelay, hoverMenusEnabled]);

  const closeFillMenu = useCallback(() => {
    if (fillHoverTimerRef.current) window.clearTimeout(fillHoverTimerRef.current);
    if (!fillMenuPinned) fillCloseTimerRef.current = window.setTimeout(() => setFillMenuOpen(false), 200);
  }, [fillMenuPinned]);

  const startFillHold = useCallback(() => {
    holdActionTriggeredRef.current = false;
    if (fillHoldTimerRef.current) window.clearTimeout(fillHoldTimerRef.current);
    fillHoldTimerRef.current = window.setTimeout(() => {
      holdActionTriggeredRef.current = true;
      setFillMenuPinned(true);
      setFillMenuOpen(true);
    }, 500);
  }, []);

  const stopFillHold = useCallback(() => {
    if (fillHoldTimerRef.current) window.clearTimeout(fillHoldTimerRef.current);
    fillHoldTimerRef.current = null;
  }, []);

  return (
    <aside className="draw-toolbar" aria-label="Drawing tools">
      <div className="tool-group">
        <div className="brush-tool-slot" onMouseEnter={() => scheduleMenu("brush")} onMouseLeave={() => closeMenu("brush")} ref={brushMenuRef}>
          <button
            className={`tool-button ${activeTool === "freedraw" ? "active" : ""}`}
            onClick={() => activateToolFromTap("freedraw")}
            onPointerCancel={() => stopMenuHold("brush")}
            onPointerDown={() => startMenuHold("brush")}
            onPointerLeave={() => stopMenuHold("brush")}
            onPointerUp={() => stopMenuHold("brush")}
           >
            <span className="material-symbols-outlined">{brushStyle === "pencil" ? "edit" : brushStyle === "dotted" ? "more_horiz" : "brush"}</span><span className="shortcut-badge">{shortcuts.brush.toUpperCase()}</span>
          </button>
          <div className={`brush-flyout ${brushMenuOpen ? "open" : ""}`} onMouseEnter={() => scheduleMenu("brush")} onMouseLeave={() => closeMenu("brush")} onPointerDown={(event) => event.stopPropagation()}>
            <div className="brush-style-picks" aria-label="Brush style" role="group">
              {([
                ["marker", "brush", "Marker"],
                ["pencil", "edit", "Pencil"],
                ["dotted", "more_horiz", "Dotted"],
              ] as [BrushStyle, string, string][]).map(([style, icon, label]) => (
                <button
                  className={`brush-style-pick ${brushStyle === style ? "active" : ""}`}
                  key={style}
                  onClick={() => {
                    onBrushStyleChange(style);
                    onToolChange("freedraw");
                  }}
                 >
                  <span className="material-symbols-outlined">{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <label className="brush-size-control range-control">
              <span>Brush size</span>
              <input className="themed-range" aria-label="Brush thickness" max="8" min="1" step="1" onChange={(event) => onStrokeWidthChange(Number(event.target.value))} type="range" value={strokeWidth} />
              <b>{Math.round(strokeWidth)}</b>
            </label>
            <label className="brush-size-control range-control">
              <span>Opacity</span>
              <input className="themed-range" aria-label="Brush opacity" max="100" min="10" onChange={(event) => onOpacityChange(Number(event.target.value))} type="range" value={opacity} />
              <b>{opacity}%</b>
            </label>
          </div>
        </div>

        <div className="eraser-tool-slot" onMouseEnter={() => scheduleMenu("eraser")} onMouseLeave={() => closeMenu("eraser")} ref={eraserMenuRef}>
          <button
            className={`tool-button ${activeTool === "eraser" ? "active" : ""}`}
            onClick={() => activateToolFromTap("eraser")}
            onPointerCancel={() => stopMenuHold("eraser")}
            onPointerDown={() => startMenuHold("eraser")}
            onPointerLeave={() => stopMenuHold("eraser")}
            onPointerUp={() => stopMenuHold("eraser")}
           >
            <span className="material-symbols-outlined">ink_eraser</span><span className="shortcut-badge">{shortcuts.eraser.toUpperCase()}</span>
          </button>
          <div className={`eraser-flyout brush-flyout ${eraserMenuOpen ? "open" : ""}`} onMouseEnter={() => scheduleMenu("eraser")} onMouseLeave={() => closeMenu("eraser")} onPointerDown={(event) => event.stopPropagation()}>
            <label className="brush-size-control range-control">
              <span>Eraser size</span>
              <input className="themed-range" aria-label="Eraser size" max="40" min="4" step="1" onChange={(event) => onEraserSizeChange(Number(event.target.value))} type="range" value={eraserSize} />
              <b>{eraserSize}</b>
            </label>
          </div>
        </div>

        <div className="fill-tool-slot" onMouseEnter={scheduleFillMenu} onMouseLeave={closeFillMenu} ref={fillMenuRef}>
          <button
            className={`tool-button fill-tool-button ${activeTool === "fill" ? "active" : ""}`}
            onClick={() => activateToolFromTap("fill")}
            onPointerCancel={stopFillHold}
            onPointerDown={startFillHold}
            onPointerLeave={stopFillHold}
            onPointerUp={stopFillHold}
           >
            <span className="material-symbols-outlined">format_color_fill</span><span className="shortcut-badge">{shortcuts.fill.toUpperCase()}</span>
            <span className="fill-color-dot" style={{ "--fill-color": fillColor } as CSSProperties} />
          </button>
          <div className={`fill-color-flyout brush-flyout ${fillMenuOpen ? "open" : ""}`} onMouseEnter={scheduleFillMenu} onMouseLeave={closeFillMenu} onPointerDown={(event) => event.stopPropagation()}>
            <ColorPickerPanel defaultColor="#d94b45" label="Fill color" onChange={onFillColorChange} value={fillColor} />
          </div>
        </div>
      </div>

      <div className="toolbar-divider" />
      <div className="swatches quick-colors" aria-label="Quick brush colors">
        {quickColors.map((color, index) => (
          <div className={`color-slot-wrap ${editingColor === index ? "editing" : ""}`} key={index} onMouseEnter={() => scheduleColorSlot(index)} onMouseLeave={() => closeColorSlot(index)}>
            <button
              aria-label={`Use quick color ${index + 1}`}
              className={`swatch color-slot ${activeColor === color ? "active" : ""}`}
              onClick={() => selectQuickColorFromTap(color)}
              onPointerCancel={stopColorHold}
              onPointerDown={() => startColorHold(index)}
              onPointerUp={stopColorHold}
              style={{ "--swatch": color } as CSSProperties}
              type="button"
            >
              <span className="shortcut-badge">{shortcuts[`color${index + 1}` as "color1" | "color2" | "color3"].toUpperCase()}</span>
            </button>
            <div className="color-slot-editor">
              <ColorPickerPanel
                defaultColor={DEFAULT_QUICK_COLORS[index]}
                label={`Quick color ${index + 1}`}
                onChange={(nextColor) => assignQuickColor(index, nextColor)}
                value={color}
              />
            </div>
          </div>
        ))}
      </div>


      <div className="toolbar-divider push" />
      <div className="tool-group history-tool-group">
        <button className="tool-button" onClick={onUndo}><span className="material-symbols-outlined">undo</span><span className="shortcut-badge">{shortcuts.undo.toUpperCase()}</span></button>
        <button className="tool-button" onClick={onRedo}><span className="material-symbols-outlined">redo</span><span className="shortcut-badge">{shortcuts.redo.toUpperCase()}</span></button>
        <div className="grid-tool-slot" onMouseEnter={scheduleGridMenu} onMouseLeave={closeGridMenu} ref={gridMenuRef}>
          <button className={`tool-button ${gridActive ? "active" : ""}`} onClick={toggleGridFromTap} onPointerCancel={stopGridHold} onPointerDown={startGridHold} onPointerLeave={stopGridHold} onPointerUp={stopGridHold}><span className="material-symbols-outlined">grid_on</span><span className="shortcut-badge">{shortcuts.grid.toUpperCase()}</span></button>
          <div className={`grid-flyout brush-flyout ${gridMenuOpen ? "open" : ""}`} onMouseEnter={scheduleGridMenu} onMouseLeave={closeGridMenu} onPointerDown={(event) => event.stopPropagation()}>
            <label className="brush-size-control range-control">
              <span>Grid size</span>
              <input aria-label="Grid size" className="themed-range" max="64" min="8" onChange={(event) => onGridSizeChange(Number(event.target.value))} step="2" type="range" value={gridSize} />
              <b>{gridSize}</b>
            </label>
            <ColorPickerPanel defaultColor="#11131c" label="Grid color" onChange={onGridColorChange} value={gridColor} />

            <label className="brush-size-control range-control">
              <span>Opacity</span>
              <input aria-label="Grid opacity" className="themed-range" max="50" min="1" onChange={(event) => onGridOpacityChange(Number(event.target.value))} type="range" value={gridOpacity} />
              <b>{gridOpacity}%</b>
            </label>
          </div>
        </div>
        <div className="canvas-color-tool-slot" onMouseEnter={scheduleCanvasMenu} onMouseLeave={closeCanvasMenu} ref={canvasMenuRef}>
          <button className="tool-button canvas-color-button" onClick={toggleCanvasMenu} style={{ "--canvas-choice": canvasColor } as CSSProperties}>
            <span aria-hidden="true" className="canvas-split-icon" />
          </button>
          <div className={`canvas-color-flyout brush-flyout ${canvasMenuOpen ? "open" : ""}`} onMouseEnter={scheduleCanvasMenu} onMouseLeave={closeCanvasMenu} onPointerDown={(event) => event.stopPropagation()}>
            <ColorPickerPanel defaultColor="#FFF2CF" label="Canvas color" onChange={onCanvasColorChange} value={canvasColor} />

          </div>
        </div>
      </div>
    </aside>
  );
}







