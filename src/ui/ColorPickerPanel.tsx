import { PointerEvent, useEffect, useRef, useState } from "react";

type ColorPickerPanelProps = {
  defaultColor: string;
  label: string;
  onChange: (color: string) => void;
  value: string;
};

type EyeDropperInstance = {
  open: () => Promise<{ sRGBHex: string }>;
};

type EyeDropperConstructor = new () => EyeDropperInstance;

type HsvColor = {
  h: number;
  s: number;
  v: number;
};

const ARTIST_SWATCHES = [
  "#11131c", "#ffffff", "#d94b45", "#f2ce59",
  "#e9905f", "#8f5d3b", "#4f8f5b", "#2f9a95",
  "#4d9dcc", "#286c99", "#7a64b0", "#c2578c",
];


function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHex(hex: string) {
  const trimmed = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed.split("").map((char) => `${char}${char}`).join("")}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(trimmed)) return `#${trimmed}`.toLowerCase();
  return null;
}

function hexToRgb(hex: string) {
  const normalized = normalizeHex(hex) ?? "#ff3366";
  const value = normalized.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsv(r: number, g: number, b: number): HsvColor {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === red) h = ((green - blue) / delta) % 6;
    else if (max === green) h = (blue - red) / delta + 2;
    else h = (red - green) / delta + 4;
    h *= 60;
  }

  return {
    h: h < 0 ? h + 360 : h,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function hsvToRgb({ h, s, v }: HsvColor) {
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = v - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (h < 60) [red, green, blue] = [chroma, x, 0];
  else if (h < 120) [red, green, blue] = [x, chroma, 0];
  else if (h < 180) [red, green, blue] = [0, chroma, x];
  else if (h < 240) [red, green, blue] = [0, x, chroma];
  else if (h < 300) [red, green, blue] = [x, 0, chroma];
  else [red, green, blue] = [chroma, 0, x];

  return {
    r: (red + match) * 255,
    g: (green + match) * 255,
    b: (blue + match) * 255,
  };
}

function hexToHsv(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}

function hsvToHex(color: HsvColor) {
  const { r, g, b } = hsvToRgb(color);
  return rgbToHex(r, g, b);
}

export function ColorPickerPanel({ defaultColor, label, onChange, value }: ColorPickerPanelProps) {
  const normalizedValue = normalizeHex(value) ?? "#ff3366";
  const [hexDraft, setHexDraft] = useState(normalizedValue.toUpperCase());
  const [hsv, setHsv] = useState(() => hexToHsv(normalizedValue));
  const hsvRef = useRef(hsv);
  const lastEmittedHexRef = useRef(normalizedValue);
  const eyedropperSupported = typeof window !== "undefined" && "EyeDropper" in window;

  useEffect(() => {
    setHexDraft(normalizedValue.toUpperCase());
    if (normalizedValue === lastEmittedHexRef.current) return;

    const nextHsv = hexToHsv(normalizedValue);
    const stableHsv = nextHsv.s < 0.01 || nextHsv.v < 0.01
      ? { ...nextHsv, h: hsvRef.current.h }
      : nextHsv;
    hsvRef.current = stableHsv;
    setHsv(stableHsv);
  }, [normalizedValue]);

  const commitColor = (nextColor: string) => {
    const normalized = normalizeHex(nextColor);
    if (!normalized) return;
    const nextHsv = hexToHsv(normalized);
    const stableHsv = nextHsv.s < 0.01 || nextHsv.v < 0.01
      ? { ...nextHsv, h: hsvRef.current.h }
      : nextHsv;
    hsvRef.current = stableHsv;
    lastEmittedHexRef.current = normalized;
    setHsv(stableHsv);
    setHexDraft(normalized.toUpperCase());
    onChange(normalized);
  };

  const updateFromHsv = (nextHsv: HsvColor) => {
    const clampedHsv = {
      h: clamp(nextHsv.h, 0, 359),
      s: clamp(nextHsv.s, 0, 1),
      v: clamp(nextHsv.v, 0, 1),
    };
    const nextHex = hsvToHex(clampedHsv);
    hsvRef.current = clampedHsv;
    lastEmittedHexRef.current = nextHex;
    setHsv(clampedHsv);
    setHexDraft(nextHex.toUpperCase());
    onChange(nextHex);
  };

  const updateFromAreaPointer = (event: PointerEvent<HTMLDivElement>, capture = false) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const s = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const v = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1);
    if (capture && !event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    updateFromHsv({ ...hsvRef.current, s, v });
  };
  const pickFromScreen = async () => {
    const EyeDropper = (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
    if (!EyeDropper) return;
    try {
      const result = await new EyeDropper().open();
      commitColor(result.sRGBHex);
    } catch {
      // Escape and cancelled selections intentionally leave the current color unchanged.
    }
  };

  return (
    <div className="sketch-color-picker-modal" aria-label={`${label} picker`}>
      <div className="tape-effect" />
      <div className="sketch-picker-header">
        <div>
          <span>Color mixer</span>
          <h2>{label}</h2>
        </div>
        <div 
          className="sketch-header-swatch"
          style={{ backgroundColor: normalizedValue }}
          aria-label={`Selected ${normalizedValue}`}
        />
      </div>
      <div className="sketch-canvas-container">
        <div 
          className="sketch-saturation-area"
          onPointerDown={(event) => updateFromAreaPointer(event, true)}
          onPointerMove={(event) => {
            if (event.buttons === 1) updateFromAreaPointer(event);
          }}
          style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        >
          <div className="sketch-canvas-white-overlay" />
          <div className="sketch-canvas-black-overlay" />
          <div 
            className="sketch-canvas-reticle"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
          />
        </div>
        <label className="sketch-hue-slider">
          <span>Hue</span>
          <input
            aria-label="Hue"
            className="sketch-hue-range"
            style={{ "--thumb-color": `hsl(${hsv.h} 100% 50%)` } as React.CSSProperties}
            max="359"
            min="0"
            onChange={(event) => updateFromHsv({ ...hsvRef.current, h: Number(event.currentTarget.value) })}
            type="range"
            value={Math.round(hsv.h)}
          />
        </label>
      </div>
      <div className="sketch-presets">
        <h3>Quick colors</h3>
        <div className="sketch-presets-list">
          {ARTIST_SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`sketch-preset-btn ${normalizedValue === swatch ? 'active' : ''}`}
              style={{ backgroundColor: swatch }}
              onClick={() => commitColor(swatch)}
              aria-label={`Select color ${swatch}`}
            />
          ))}
        </div>
      </div>
      <div className="sketch-tools-row">
        <div className="sketch-tools-group">
          <button className="sketch-button sketch-icon-button" disabled={!eyedropperSupported} onClick={pickFromScreen} title="Pick from screen" type="button">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0" }}>colorize</span>
          </button>
        </div>
        <div className="sketch-hex-container">
          <label>Hex</label>
          <div className="sketch-hex-input-group">
            <input 
              className="sketch-hex-input"
              type="text"
              maxLength={7}
              value={hexDraft}
              onBlur={() => setHexDraft(normalizedValue.toUpperCase())}
              onChange={(event) => {
                const next = event.target.value.toUpperCase();
                setHexDraft(next);
                commitColor(next);
              }}
            />
            <button className="sketch-button sketch-action-button" onClick={() => commitColor(defaultColor)} title="Restore default">
              RST
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
