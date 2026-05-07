/**
 * Single source of truth for the keyboard shortcuts surfaced in the
 * help modal. Shortcut handlers themselves live next to the features
 * (FORGE textarea in `app/page.tsx`, scene-editor effect in `page.tsx`,
 * Play-mode listeners in `app/components/ScenePlayer.tsx`). When you
 * add or change a handler, update the matching entry here so the
 * help modal stays accurate.
 */

export type ShortcutEntry = {
  /** Human-readable key combo, e.g. "⌘ + Enter" or "Shift + Click". */
  keys: string;
  description: string;
};

export type ShortcutGroup = {
  title: string;
  entries: ShortcutEntry[];
};

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "FORGE",
    entries: [
      { keys: "Enter", description: "Submit prompt" },
      { keys: "⌘ / Ctrl + Enter", description: "Submit prompt (modifier-friendly)" },
      { keys: "Shift + Enter", description: "Insert newline in prompt" },
      { keys: "↑ / ↓", description: "Cycle through previous prompts" },
    ],
  },
  {
    title: "Scene editor",
    entries: [
      { keys: "⌘ / Ctrl + Z", description: "Undo last scene change" },
      { keys: "⌘ / Ctrl + Shift + Z", description: "Redo" },
      { keys: "⌘ / Ctrl + C", description: "Copy selected items" },
      { keys: "⌘ / Ctrl + V", description: "Paste items from clipboard" },
      { keys: "⌘ / Ctrl + D", description: "Duplicate selected item" },
      { keys: "⌘ / Ctrl + ] / [", description: "Bring forward / send backward" },
      { keys: "Arrow keys", description: "Nudge selected item by snap step" },
      { keys: "Backspace / Delete", description: "Delete selected item" },
      { keys: "Escape", description: "Clear selection" },
      { keys: "Middle-click drag", description: "Pan camera" },
      { keys: "Shift + Click", description: "Toggle item in multi-select" },
    ],
  },
  {
    title: "Play mode",
    entries: [
      { keys: "WASD / Arrows", description: "Walk the player character" },
      { keys: "E", description: "Interact with nearest usable item" },
    ],
  },
  {
    title: "Global",
    entries: [
      { keys: "?", description: "Open this shortcuts help modal" },
    ],
  },
];
