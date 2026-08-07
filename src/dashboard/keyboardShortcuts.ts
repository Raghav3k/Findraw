export type ShortcutAction =
  | "brush"
  | "eraser"
  | "fill"
  | "undo"
  | "redo"
  | "grid"
  | "color1"
  | "color2"
  | "color3";

export type KeyboardShortcuts = Record<ShortcutAction, string>;

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = {
  brush: "b",
  eraser: "e",
  fill: "f",
  undo: "z",
  redo: "r",
  grid: "g",
  color1: "1",
  color2: "2",
  color3: "3",
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  brush: "Brush",
  eraser: "Eraser",
  fill: "Fill",
  undo: "Undo",
  redo: "Redo",
  grid: "Toggle grid",
  color1: "Quick color 1",
  color2: "Quick color 2",
  color3: "Quick color 3",
};


