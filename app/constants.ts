/**
 * Shared module-scope constants — extracted from `app/page.tsx` in
 * Phase 15 fire #88 as part of the page.tsx decomposition. Pure data
 * only: no React, no DOM, no side effects. If you find yourself
 * adding logic here, it probably belongs in `app/lib/*` instead.
 *
 * Grouped by concern:
 *  - FORGE form options (GEN_MODES, PERSPECTIVES, POSES, QUALITIES,
 *    STYLE_PRESETS, VARIANT_OPTIONS, GRID_PRESETS)
 *  - Inline-edit placeholders (EDIT_EXAMPLES)
 *  - Storage keys (PROJECTS_IDB_KEY, etc.)
 *  - Soft caps + thresholds (PROJECT_MEMORY_CAP, MAX_HISTORY)
 *  - Keyword lists (BLOCKER_KEYWORDS, FLOATING_KEYWORDS)
 *  - Onboarding copy (ONBOARDING_STEPS)
 */
import type {
  AssetType,
  GenMode,
  Perspective,
  Pose,
  Quality,
  StylePreset,
} from "./types";

// ─── FORGE form option lists ───────────────────────────────────────────

export const GEN_MODES: {
  value: GenMode;
  label: string;
  emoji: string;
  hint: string;
}[] = [
  { value: "item", label: "Items", emoji: "🌽", hint: "One sprite — prop, tile, building, creature, anything" },
  { value: "character", label: "Characters", emoji: "🧑‍🌾", hint: "A single character — pose / walk-cycle options apply" },
  { value: "scene", label: "Scenes", emoji: "🎬", hint: "Multi-asset scene: parsed into 3-8 items, composed onto a scene canvas" },
];

export const PERSPECTIVES: { value: Perspective; label: string }[] = [
  { value: "top-down", label: "Top-down" },
  { value: "side-view", label: "2D side-view" },
];

export const POSES: { value: Pose; label: string; hint: string }[] = [
  { value: "single", label: "Single", hint: "one pose" },
  { value: "directions", label: "Directions", hint: "facing N/E/S/W in a row" },
  { value: "walk-cycle", label: "Walk cycle", hint: "4-frame walk anim" },
  { value: "full-sheet", label: "Full sheet", hint: "directions × walk frames" },
];

export const QUALITIES: { value: Quality; label: string; cost: string }[] = [
  { value: "low", label: "Low", cost: "~$0.01" },
  { value: "medium", label: "Med", cost: "~$0.04" },
  { value: "high", label: "High", cost: "~$0.16" },
];

export const STYLE_PRESETS: { value: StylePreset; label: string; hint: string }[] = [
  { value: "cozy", label: "Cozy", hint: "Stardew-like cozy farming RPG" },
  { value: "snes-jrpg", label: "SNES JRPG", hint: "16-bit Chrono Trigger / FF6 vibe" },
  { value: "gameboy", label: "Game Boy", hint: "4-shade green Game Boy palette" },
  { value: "nes", label: "NES", hint: "8-bit NES palette" },
  { value: "monochrome", label: "Mono", hint: "Single hue + b&w" },
];

export const VARIANT_OPTIONS = [1, 2, 4];
export const GRID_PRESETS = [0, 64, 96, 128];

// ─── Inline-edit placeholder rotation ─────────────────────────────────

/** Per-AssetType pool of "edit this asset" prompt examples that the
 *  AssetCard's ✏️ panel cycles through as the placeholder. */
export const EDIT_EXAMPLES: Record<AssetType, string[]> = {
  character: [
    "with red overalls",
    "wearing a wizard hat",
    "now holding a sword",
    "in winter clothes",
    "with a beard",
  ],
  item: [
    "now broken",
    "with sparkles",
    "now glowing",
    "in gold",
    "with a ribbon",
  ],
  tile: [
    "in autumn colors",
    "with cracks",
    "snow-covered",
    "covered in moss",
    "wet from rain",
  ],
  building: [
    "with a chimney",
    "windows lit at night",
    "covered in vines",
    "in ruins",
    "in red brick",
  ],
  creature: [
    "wearing a tiny hat",
    "now sleeping",
    "in a different color",
    "with bigger eyes",
    "with a saddle",
  ],
  ui: [
    "in red instead of blue",
    "with a glow",
    "smaller and cleaner",
    "with a number badge",
  ],
};

// ─── Storage keys ──────────────────────────────────────────────────────

export const PROJECTS_IDB_KEY = "projects";
export const CURRENT_ID_IDB_KEY = "currentProjectId";
/** Map of `projectId → { activeSceneId, selectedSceneItemIds }`. */
export const SCENE_UI_IDB_KEY = "sceneUi";
export const LEGACY_ASSETS_LS_KEY = "pwf:assets:v1";
export const LEGACY_ASSETS_IDB_KEY = "assets";
export const LEGACY_STYLE_LS_KEY = "pwf:project-style:v1";
export const HISTORY_KEY = "pwf:prompt-history:v1";

// ─── Caps & thresholds ────────────────────────────────────────────────

/** Soft cap for the project MEMORY blob, in chars. Inspired by Hermes
 *  Agent's 2200-char limit on MEMORY.md. */
export const PROJECT_MEMORY_CAP = 2200;

/** Max prompt-history entries kept in localStorage. The history powers
 *  the up-arrow recall in the FORGE textarea. */
export const MAX_HISTORY = 30;

// ─── Keyword lists ────────────────────────────────────────────────────

/** Items whose names match any of these get auto-solid:true at scene
 *  compose time, so the player walks around them in Play Mode. Hosted
 *  in constants.ts so the regex-builder in defaultSolidForName() stays
 *  data-driven. */
export const BLOCKER_KEYWORDS = [
  // Architecture / structures
  "cabin", "house", "cottage", "shack", "hut", "building", "tower",
  "shop", "store", "tavern", "barn", "shed", "windmill", "lighthouse",
  // Monuments / props that occupy ground space
  "statue", "fountain", "obelisk", "pillar", "column", "shrine",
  "gravestone", "tombstone", "headstone", "altar",
  // Trees / large vegetation
  "tree", "pine", "oak", "fir", "spruce", "birch", "willow", "palm",
  "bush", "shrub",
  // Rocks / boulders
  "boulder", "rock", "stone wall",
  // Heavy interior furniture (you can walk around but not through)
  "anvil", "workbench", "forge", "cauldron", "fireplace", "hearth",
  "dresser", "wardrobe", "armoire", "bookshelf", "bookcase",
  "bed", "sofa", "couch", "piano", "throne", "desk", "table",
];

/** Items whose names match any of these anchor to "center" (visually
 *  floating) instead of "bottom" (foot on ground line) when composed
 *  into a scene. Hanging / sky / suspended items. */
export const FLOATING_KEYWORDS = [
  "lantern", "moon", "sun", "cloud", "balloon", "kite", "star",
  "bird", "bat", "ghost", "spirit", "fairy",
  "chandelier", "ceiling", "hanging", "floating",
];

// ─── Onboarding modal copy ────────────────────────────────────────────

export const ONBOARDING_STEPS = [
  {
    title: "1 — Forge assets with AI",
    body: "Type a description in the FORGE panel on the left and hit Enter. Pixel Play calls your OpenAI key and returns pixel-art sprites — characters, tiles, scenes, and more.",
  },
  {
    title: "2 — Drag assets into a scene",
    body: "Switch to the Scenes tab on the right and drag any asset card onto the canvas. Resize, rotate, and layer items to build your game world.",
  },
  {
    title: "3 — Play mode",
    body: "Press the ▶ Play button to enter Play mode. Use WASD or arrow keys to walk your character around, interact with NPCs, pick up items, and step through portals.",
  },
  {
    title: "4 — Add your OpenAI key",
    body: "Click ⚙ Settings in the top-right corner and paste your OpenAI API key. Keys are stored only in your browser — never sent anywhere except api.openai.com.",
  },
] as const;
