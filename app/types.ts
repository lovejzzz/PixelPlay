/**
 * Shared data-model types — extracted from `app/page.tsx` in Phase 15
 * fire #87 to make the 9,697-line file navigable. Pure type declarations:
 * importing this module has zero runtime cost, so client + server +
 * Node tests can import freely. UI-state shapes (ChatMessage, AgentMsg,
 * RightTab, SceneUiByProject, SettingsPrefs) stay in page.tsx for now —
 * they're tightly coupled to the React tree and would force types.ts
 * to import React.
 *
 * Naming: keep one symbol per concern, no namespacing. Match the names
 * already used across the codebase (`Asset`, `Scene`, etc.) so the
 * extraction is a pure move — no search-and-replace at call sites.
 */
import type { SpriteBounds } from "./lib/sprites";

// ─── Enums (string unions) ─────────────────────────────────────────────

export type AssetType = "character" | "item" | "tile" | "building" | "creature" | "ui";
export type Perspective = "top-down" | "side-view";
export type Pose = "single" | "directions" | "walk-cycle" | "full-sheet";
export type Quality = "low" | "medium" | "high";
export type Mode = "generate" | "edit";
export type StylePreset = "cozy" | "snes-jrpg" | "gameboy" | "nes" | "monochrome";

/** UI-level generation modes. Character keeps pose / walk-cycle controls;
 *  Item is anything else single-sprite; Scene runs split-items + auto-compose.
 *  Internal Asset.assetType stays in the older 6-value union for backwards
 *  compat with legacy assets in IDB. */
export type GenMode = "character" | "item" | "scene";

// ─── Asset ─────────────────────────────────────────────────────────────

export type Asset = {
  id: string;
  prompt: string;
  /** Optional user-set name; falls back to prompt for display. */
  name?: string;
  /** User-set tags for filtering / organization. */
  tags?: string[];
  assetType: AssetType;
  perspective: Perspective;
  pose: Pose;
  rawUrl: string;
  pixelUrl: string;
  gridSize: number;
  sourceSize: string;
  cols: number;
  rows: number;
  editedFrom?: string;
  createdAt: number;
  /** Set when a multi-frame sheet's cells came back too similar to be useful. */
  lowVariety?: boolean;
  /** Soft-delete marker. Set by deleteAsset; cleared by restoreAsset.
   *  Stripped before persisting to IDB so trash is session-only. Scene
   *  items continue to resolve trashed assets until the trash is emptied. */
  trashedAt?: number;
  /** Vector embedding (text-embedding-3-small, 1536 dims) over
   *  `name + prompt + tags`. Generated fire-and-forget after asset
   *  creation. Used by the gallery's semantic-search fallback. ~6 KB. */
  embedding?: number[];
  /** Bounding box of the visible non-transparent pixels in the asset's
   *  rendered image, as fractions [0, 1] of the image dimensions.
   *  Computed once at generation time via canvas pixel-analysis so the
   *  relation resolver can use the actual visible top edge instead of
   *  guessing from `scale × longest_canvas_edge` (gpt-image-1 returns
   *  sprites with unpredictable transparent padding — a "lamp" might be
   *  90% sprite + 10% padding, or 60% sprite + 40% padding). */
  bounds?: SpriteBounds;
  /** Coarse semantic label used by Phase 14 room-type validation +
   *  surface-aware placement. One of the values exported by
   *  `app/lib/classify.mjs` (bedding, seating, table, storage, kitchen,
   *  electronics, decor, clothing, tool, book, food, plant, container,
   *  lighting, art, toy, weapon, vehicle, other). Auto-filled by
   *  classifyAssets() after generation. */
  category?: string;
  /** Named placement zones on this asset's surface, as bbox fractions
   *  [0,1] of the image. Used by the relation resolver to snap an "on"-
   *  placement to a specific named surface (top, shelf-top, etc.) when
   *  the host has multiple. Auto-filled by anchorAssets() after
   *  generation for surface-bearing categories (storage, seating,
   *  table, kitchen, container); empty for everything else. */
  anchors?: Array<{ name: string; x: number; y: number; w: number; h: number }>;
};

// ─── Style / Recipe / Project metadata ────────────────────────────────

export type ProjectStyle = {
  text: string;
  refUrl: string | null;
  preset: StylePreset;
};

/** A saved snapshot of the FORGE form values, replay-able with one click.
 *  Inspired by Hermes Agent's SKILL.md procedural memory. */
export type Recipe = {
  id: string;
  name: string;
  description?: string;
  mode: GenMode;
  prompt: string;
  perspective: Perspective;
  pose?: Pose;
  quality: Quality;
  variants: number;
  gridSize: number;
  /** When set, replaces the project-level style.text on apply. */
  styleOverride?: string;
  createdAt: number;
  usageCount: number;
};

// ─── Scene primitives ──────────────────────────────────────────────────

export type SceneItem = {
  id: string;
  assetId: string;
  /** Center point in scene coordinates. */
  x: number;
  y: number;
  /** Fraction of scene's longest edge. 0.2 = item ~204px in a 1024 scene. */
  scale: number;
  z: number;
  /** For multi-frame assets, whether the walk-cycle plays in edit-view. */
  animating?: boolean;
  /** When true, blocks the player in Play Mode (collision). */
  solid?: boolean;
  /** Mirror horizontally when rendering. */
  flipX?: boolean;
  /** Mirror vertically when rendering. */
  flipY?: boolean;
  /** Rotation in degrees, clockwise. */
  rotation?: number;
  /** Player can pick this up by walking onto it (Play Mode). */
  pickable?: boolean;
  /** Door / portal: walking onto this in Play Mode switches the active scene. */
  linkSceneId?: string;
  /** NPC patrol — character walks between waypoints in Play Mode. */
  patrol?: { points: Array<{ x: number; y: number }>; loop: boolean; speed: number };
  /** Optional speech bubble shown above this character/creature in Play
   *  Mode when the player walks within ~32 px. */
  dialogue?: string;
  /** Render anchor. "bottom" places the item by its feet (the layout y
   *  becomes the ground line); "center" places by the midpoint (legacy).
   *  Default is "center" so existing scenes don't shift. New items spawned
   *  by composeSceneFromAssets opt into "bottom" so trees, cabins and
   *  characters all sit on the same ground line. */
  anchor?: "bottom" | "center";
  /** Compositional relationship to another SceneItem in the same scene.
   *  Set by composeSceneFromAssets when /api/scene-layout returns a
   *  relation hint (lamp on nightstand, painting above bed, etc.). The
   *  Player's y-sort uses this to override pure-y depth so a lamp at a
   *  visually-higher y still draws OVER its host nightstand. */
  relationTo?: string;
  relationWhere?: "on" | "above" | "beside" | "in-front";
  /** Special asset-less item kinds. */
  kind?: "trigger" | "light" | "emitter" | "sound";
  /** Message fired into the play-mode log when the player enters a trigger zone. */
  triggerMessage?: string;
  /** Message fired when the player presses E near this item in Play mode.
   *  Differs from triggerMessage in that it requires a button press, not
   *  proximity alone, so it suits "use" interactions (sit, examine, type). */
  useMessage?: string;
  /** Asset id to swap-render this item to for ~1.5 s after use. e.g. a
   *  "desk with monitor on" alt for a "desk" item. Optional; if unset,
   *  the item keeps its original look during use. */
  useStateAssetId?: string;
  /** Point-light parameters (when kind === "light"). */
  light?: { radius: number; color: string; intensity: number };
  /** Particle emitter parameters (when kind === "emitter"). */
  emitter?: { kind: "sparkle" | "smoke"; rate: number; lifetime: number };
  /** Sound parameters (when kind === "sound"). */
  sound?: { url: string; volume: number; loop: boolean };
  /** ID of the prefab this instance was spawned from (or whose master it is). */
  prefabId?: string;
  /** ID of the master item inside the prefab.items array this instance maps to. */
  prefabSourceId?: string;
};

export type TileLayer = {
  id: string;
  name: string;
  tileAssetId: string;
  cells: Array<{ x: number; y: number }>;
  visible: boolean;
};

export type TileGrid = {
  tileSize: number;
  layers: TileLayer[];
};

export type Scene = {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Optional asset id of a tile to use as repeating background. */
  backgroundTileId?: string;
  items: SceneItem[];
  /** Painted tile layers (Phase-4 tile painting tool). */
  tileGrid?: TileGrid;
  /** Fallback flat-color background derived from the scene's parsed
   *  context at compose-time. Renders as the bottom layer under any
   *  tile grid layers so an empty / partly-erased scene isn't a void. */
  autoBackgroundColor?: string;
  /** Granular room/place type returned by extractScene (Phase 14):
   *  bedroom / kitchen / forest / desert / workshop / etc. Used by
   *  the item-room validation badge. One of the values exported by
   *  `app/lib/extractScene.mjs` ROOM_TYPES. */
  roomType?: string;
  /** 0 = midnight, 0.5 = noon, 1 = midnight again. Tints play view. */
  daytime?: number;
  /** Items that failed to generate when the scene was composed. Surfaced
   *  as a "⚠ N failed" badge so users can retry. Cleared once retried. */
  failedItems?: Array<{ name: string; error: string }>;
  createdAt: number;
};

// ─── Prefab ────────────────────────────────────────────────────────────

export type Prefab = {
  id: string;
  name: string;
  /** Master items — each instance clones from these. */
  items: SceneItem[];
  createdAt: number;
};

// ─── Project (top-level) ───────────────────────────────────────────────

export type Project = {
  id: string;
  name: string;
  style: ProjectStyle;
  assets: Record<string, Asset>;
  scenes: Record<string, Scene>;
  prefabs?: Record<string, Prefab>;
  /** Per-project markdown blob — naming conventions, palette, recurring
   *  characters, things learned. Soft-cap ~2200 chars. Frozen-into-prompt
   *  pattern: appended to every generation's system message so the model
   *  learns the project's quirks. Modeled after Hermes Agent's MEMORY.md. */
  memory?: string;
  /** Saved form-state recipes. Hermes-style procedural memory: bundle a
   *  successful FORGE pattern as a one-click "apply this preset" so the
   *  user can replay similar generations without re-typing. */
  recipes?: Record<string, Recipe>;
  /** When ON, the active scene opens a Supabase Realtime broadcast
   *  channel and syncs `updateScene` calls between tabs / collaborators.
   *  Off by default. Requires `NEXT_PUBLIC_SUPABASE_URL` +
   *  `NEXT_PUBLIC_SUPABASE_ANON_KEY` env vars to be set at build time. */
  syncEnabled?: boolean;
  createdAt: number;
};
