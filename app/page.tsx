"use client";

import { useEffect, useRef, useState } from "react";
import { pixelateImageUrl } from "./lib/pixelate";
import { buildSpriteZip, sliceSheet } from "./lib/sprites";
import { checkSheetVariety } from "./lib/varietyCheck";
import { trimAlphaToContent } from "./lib/trimAlpha";
import { idbGet, idbSet } from "./lib/storage";
import {
  readUserProfile,
  patchUserProfile,
  streakedFields,
  type ForgeSample,
} from "./lib/userProfile";
import { makeSeamless } from "./lib/seamless";
import { rankBySimilarity } from "./lib/cosineSearch";
import type {
  ForgeAssetArgs,
  SetProjectMemoryArgs,
  ApplyRecipeArgs,
} from "./lib/agentTools";
import { SceneCanvas, type CanvasAsset } from "./components/SceneCanvas";
import { ScenePlayer } from "./components/ScenePlayer";
import JSZip from "jszip";
import {
  estimateImageCost,
  estimateChatCost,
  recordSpend,
  getSession,
  getProjectCost,
  formatDollars,
  type SessionState,
} from "./lib/cost";
import {
  applyPalette,
  extractPalette,
  BUILT_IN_PALETTES,
  type Palette,
  type RGB,
} from "./lib/palette";

// ----------------------------------------------------------- types

type AssetType = "character" | "item" | "tile" | "building" | "creature" | "ui";
type Perspective = "top-down" | "side-view";
type Pose = "single" | "directions" | "walk-cycle" | "full-sheet";
type Quality = "low" | "medium" | "high";
type Mode = "generate" | "edit";
type StylePreset = "cozy" | "snes-jrpg" | "gameboy" | "nes" | "monochrome";

type UserMessage = {
  role: "user";
  text: string;
  assetType: AssetType;
  perspective: Perspective;
  pose: Pose;
  mode: Mode;
};
type AssistantMessage = {
  role: "assistant";
  text: string;
  assetIds?: string[];
  error?: boolean;
};
type ChatMessage = UserMessage | AssistantMessage;

type Asset = {
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
};

type ProjectStyle = {
  text: string;
  refUrl: string | null;
  preset: StylePreset;
};

type SceneItem = {
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

type TileLayer = {
  id: string;
  name: string;
  tileAssetId: string;
  cells: Array<{ x: number; y: number }>;
  visible: boolean;
};
type TileGrid = {
  tileSize: number;
  layers: TileLayer[];
};

type Scene = {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Optional asset id of a tile to use as repeating background. */
  backgroundTileId?: string;
  items: SceneItem[];
  /** Painted tile layers (Phase-4 tile painting tool). */
  tileGrid?: TileGrid;
  /** 0 = midnight, 0.5 = noon, 1 = midnight again. Tints play view. */
  daytime?: number;
  /** Items that failed to generate when the scene was composed. Surfaced
   *  as a "⚠ N failed" badge so users can retry. Cleared once retried. */
  failedItems?: Array<{ name: string; error: string }>;
  createdAt: number;
};

type Prefab = {
  id: string;
  name: string;
  /** Master items — each instance clones from these. */
  items: SceneItem[];
  createdAt: number;
};

type Project = {
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
  createdAt: number;
};

/** A saved snapshot of the FORGE form values, replay-able with one click.
 *  Inspired by Hermes Agent's SKILL.md procedural memory. */
type Recipe = {
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

/** Soft cap for the project MEMORY blob, in chars. Inspired by Hermes
 *  Agent's 2200-char limit on MEMORY.md. */
const PROJECT_MEMORY_CAP = 2200;

type RightTab = "assets" | "scenes" | "recipes";

/** Concierge agent (Phase 10) — internal message representation rendered
 *  inside the agent drawer. Wire format sent to `/api/agent` is the
 *  OpenAI Chat Completions shape (`{role, content}`); tool calls become
 *  separate visual chips and tool results collapse into a synthesized
 *  `user` message in the wire history (per the roadmap's "next user
 *  message" design — see `streamAgentTurn`). */
type AgentMsg =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; streaming?: boolean }
  | { kind: "tool_call"; id: string; name: string; args: unknown }
  | { kind: "tool_result"; id: string; name: string; result: string }
  | { kind: "error"; text: string };

// ----------------------------------------------------------- constants

/** UI-level generation modes. Character keeps pose / walk-cycle controls;
 *  Item is anything else single-sprite; Scene runs split-items + auto-compose.
 *  Internal Asset.assetType stays in the older 6-value union for backwards
 *  compat with legacy assets in IDB. */
type GenMode = "character" | "item" | "scene";
const GEN_MODES: { value: GenMode; label: string; emoji: string; hint: string }[] = [
  { value: "item", label: "Items", emoji: "🌽", hint: "One sprite — prop, tile, building, creature, anything" },
  { value: "character", label: "Characters", emoji: "🧑‍🌾", hint: "A single character — pose / walk-cycle options apply" },
  { value: "scene", label: "Scenes", emoji: "🎬", hint: "Multi-asset scene: parsed into 3-8 items, composed onto a scene canvas" },
];

const PERSPECTIVES: { value: Perspective; label: string }[] = [
  { value: "top-down", label: "Top-down" },
  { value: "side-view", label: "2D side-view" },
];

const POSES: { value: Pose; label: string; hint: string }[] = [
  { value: "single", label: "Single", hint: "one pose" },
  { value: "directions", label: "Directions", hint: "facing N/E/S/W in a row" },
  { value: "walk-cycle", label: "Walk cycle", hint: "4-frame walk anim" },
  { value: "full-sheet", label: "Full sheet", hint: "directions × walk frames" },
];

const QUALITIES: { value: Quality; label: string; cost: string }[] = [
  { value: "low", label: "Low", cost: "~$0.01" },
  { value: "medium", label: "Med", cost: "~$0.04" },
  { value: "high", label: "High", cost: "~$0.16" },
];

const STYLE_PRESETS: { value: StylePreset; label: string; hint: string }[] = [
  { value: "cozy", label: "Cozy", hint: "Stardew-like cozy farming RPG" },
  { value: "snes-jrpg", label: "SNES JRPG", hint: "16-bit Chrono Trigger / FF6 vibe" },
  { value: "gameboy", label: "GameBoy", hint: "4-shade green monochrome" },
  { value: "nes", label: "NES", hint: "8-bit blocky pixels, NES palette" },
  { value: "monochrome", label: "Mono", hint: "high-contrast B&W pixel art" },
];

const VARIANT_OPTIONS = [1, 2, 4];
const GRID_PRESETS = [0, 64, 96, 128];

/** Per-asset-type example phrasings for the per-card ✏️ inline edit panel.
 *  Cycled as the placeholder so a new user has a fresh idea each second. */
const EDIT_EXAMPLES: Record<AssetType, string[]> = {
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

const PROJECTS_IDB_KEY = "projects";
const CURRENT_ID_IDB_KEY = "currentProjectId";
/** Map of `projectId → { activeSceneId, selectedSceneItemIds }`. */
const SCENE_UI_IDB_KEY = "sceneUi";
const LEGACY_ASSETS_LS_KEY = "pwf:assets:v1";
const LEGACY_ASSETS_IDB_KEY = "assets";
const LEGACY_STYLE_LS_KEY = "pwf:project-style:v1";

type SceneUiByProject = Record<
  string,
  {
    activeSceneId: string | null;
    /** Multi-select. Older sessions may have stored `selectedSceneItemId`. */
    selectedSceneItemIds?: string[];
    selectedSceneItemId?: string | null;
  }
>;

function gridLabel(g: number) {
  return g === 0 ? "Raw" : `${g}px`;
}

function emptyStyle(presetOverride?: StylePreset): ProjectStyle {
  return { text: "", refUrl: null, preset: presetOverride || "cozy" };
}

function newProject(name: string, presetOverride?: StylePreset): Project {
  return {
    id: crypto.randomUUID(),
    name,
    style: emptyStyle(presetOverride),
    assets: {},
    scenes: {},
    createdAt: Date.now(),
  };
}

// ----------------------------------------------------------- main

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text:
        "Welcome to Pixel Play. Pick Items / Characters / Scenes, describe what you want, and click FORGE. To tweak an existing asset, click ✏️ on its card and type the change.",
    },
  ]);
  const STARTER_PROMPTS: Array<{
    label: string;
    prompt: string;
    mode: GenMode;
    pose?: Pose;
    perspective?: Perspective;
  }> = [
    { label: "🌽 a magic glowing carrot", prompt: "a magic glowing carrot with sparkles", mode: "item" },
    { label: "🧑‍🌾 farmer walk-cycle", prompt: "a young farmer in overalls and a straw hat", mode: "character", pose: "walk-cycle" },
    { label: "🏠 cozy farmhouse", prompt: "a small cozy farmhouse with a chimney and red roof", mode: "item" },
    { label: "🟫 grass tile", prompt: "lush green grass with tiny flowers", mode: "item" },
    { label: "🎬 bedroom scene", prompt: "a cozy bedroom with all the furniture", mode: "scene" },
    { label: "🐔 sleepy chicken", prompt: "a fluffy little chicken sitting", mode: "item" },
  ];

  const [projects, setProjects] = useState<Record<string, Project>>({});
  const [currentId, setCurrentId] = useState<string>("");

  const [input, setInput] = useState("");
  const [genMode, setGenMode] = useState<GenMode>("item");
  const [perspective, setPerspective] = useState<Perspective>("top-down");
  const [pose, setPose] = useState<Pose>("single");
  const [gridSize, setGridSize] = useState(0);
  const [quality, setQuality] = useState<Quality>("medium");
  const [variants, setVariants] = useState(1);
  const [styleOpen, setStyleOpen] = useState(false);
  /** When ON and there's an active scene, generated items get dropped onto
   *  the scene immediately instead of just sitting in the gallery. */
  const [addToScene, setAddToScene] = useState(true);
  /** Per-card inline edit: which asset is currently being edited, and the
   *  prompt the user is typing. Hoisted so the card can be controlled and
   *  the actual /api/generate call is made by the parent. */
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [editingBusy, setEditingBusy] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("assets");
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [selectedSceneItemIds, setSelectedSceneItemIds] = useState<string[]>([]);
  /** Per-scene undo/redo stacks, in-memory only. Capped to 30 entries each. */
  const [sceneHistory, setSceneHistory] = useState<
    Record<string, { past: Scene[]; future: Scene[] }>
  >({});
  const [replacePrompt, setReplacePrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [search, setSearch] = useState("");
  /** When the substring search yields zero hits, we embed the query and
   *  rank by cosine similarity. `null` = inactive (fall back to substring);
   *  `[]` = ran but found nothing above threshold. */
  const [semanticIds, setSemanticIds] = useState<string[] | null>(null);
  const [semanticBusy, setSemanticBusy] = useState(false);
  const semanticTokenRef = useRef(0);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [session, setSessionState] = useState<SessionState>({ startedAt: Date.now(), cost: 0, calls: 0 });
  const [projectLifetime, setProjectLifetime] = useState<{ cost: number; calls: number }>({ cost: 0, calls: 0 });
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const [paletteAssetId, setPaletteAssetId] = useState<string | null>(null);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1); // -1 = not navigating
  const [sceneSnap, setSceneSnap] = useState(0); // 0 / 8 / 16 / 32
  const [sceneZoom, setSceneZoom] = useState(1); // 1 / 2 / 4
  const [paintMode, setPaintMode] = useState<"off" | "paint" | "erase" | "fillrect">("off");
  const [activeTileLayerId, setActiveTileLayerId] = useState<string | null>(null);
  const [playMode, setPlayMode] = useState(false);
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);
  /** True while a `?import=<id>` URL is being fetched + piped through
   *  importProject. Surfaces a spinner in the header so users know the
   *  app didn't just hang on first paint. */
  const [importingShared, setImportingShared] = useState(false);
  /** Multi-select mode for the gallery. When ON, AssetCards show a corner
   *  checkbox; when 1+ are selected, a bulk-action bar appears. */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [assetSort, setAssetSort] = useState<"newest" | "oldest" | "name" | "type">("newest");
  const [openaiKey, setOpenaiKey] = useState("");
  /** Image generation provider selector. "openai" routes FORGE through
   *  `/api/generate` (gpt-image-1, ~$0.04/image); "fal" routes through
   *  `/api/generate-fal` (Flux Schnell, ~$0.003/image). The wired-up
   *  dispatcher lands in a follow-up roadmap item. */
  const [imageProvider, setImageProvider] = useState<"openai" | "fal">("openai");
  const [falKey, setFalKey] = useState("");
  /** When the user clicks FORGE without a key, we stash the prompt here
   *  and pop the Settings modal. After they save a key the effect below
   *  replays the submit with the stashed prompt. */
  const [pendingSubmitPrompt, setPendingSubmitPrompt] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** In-memory clipboard for scene-item copy/paste. Survives across scenes
   *  in the same session but not across reloads (intentional — copy/paste
   *  shouldn't leak items between sessions). */
  const [sceneClipboard, setSceneClipboard] = useState<SceneItem[]>([]);
  /** Concierge agent drawer at the bottom of the FORGE panel. Toggled by
   *  the 🤖 Agent button in the panel header. Streams from `/api/agent`
   *  and renders user/assistant text + tool-call/tool-result chips inline.
   *  forge_asset tool calls queue here and pop one at a time when the
   *  FORGE form is idle (see useEffect below). */
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AgentMsg[]>([]);
  const [agentInput, setAgentInput] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [pendingAgentForges, setPendingAgentForges] = useState<
    Array<{ prompt: string; mode: GenMode; quality?: Quality }>
  >([]);
  const agentScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentProject = projects[currentId];
  const assets = currentProject?.assets || {};
  const scenes = currentProject?.scenes || {};
  const projectStyle = currentProject?.style || emptyStyle();
  const activeScene = activeSceneId ? scenes[activeSceneId] : null;
  const selectedSceneItem =
    activeScene && selectedSceneItemIds.length === 1
      ? activeScene.items.find((it) => it.id === selectedSceneItemIds[0]) || null
      : null;
  // Backwards-compat single-id alias for code paths that only handle one selection.
  const selectedSceneItemId =
    selectedSceneItemIds.length === 1 ? selectedSceneItemIds[0] : null;

  // ------------- project mutators (operate on current project) -------------

  function setAssets(updater: (a: Record<string, Asset>) => Record<string, Asset>) {
    setProjects((p) => {
      const cur = p[currentId];
      if (!cur) return p;
      return { ...p, [currentId]: { ...cur, assets: updater(cur.assets) } };
    });
  }

  function setProjectStyle(updater: (s: ProjectStyle) => ProjectStyle) {
    setProjects((p) => {
      const cur = p[currentId];
      if (!cur) return p;
      return { ...p, [currentId]: { ...cur, style: updater(cur.style) } };
    });
  }

  /** Write the project MEMORY blob. Trims to PROJECT_MEMORY_CAP chars
   *  (soft cap — preserves whatever fits and drops the rest). UI items
   *  in Phase 7 surface this via a textarea + auto-augmentation hooks. */
  function setProjectMemory(memory: string) {
    const trimmed = memory.length > PROJECT_MEMORY_CAP
      ? memory.slice(0, PROJECT_MEMORY_CAP)
      : memory;
    setProjects((p) => {
      const cur = p[currentId];
      if (!cur) return p;
      return { ...p, [currentId]: { ...cur, memory: trimmed || undefined } };
    });
  }

  /** Read the effective project memory. Migration shim: if the new
   *  `memory` field is undefined on legacy projects, fall back to the
   *  existing `style.text` blob as a seed. UI editors should copy the
   *  fallback into `memory` on first edit so the migration completes. */
  function getEffectiveProjectMemory(): string {
    const cur = projects[currentId];
    if (!cur) return "";
    if (typeof cur.memory === "string") return cur.memory;
    return cur.style?.text || "";
  }

  /** Save the current FORGE form state as a named recipe. Stores it on the
   *  current project. UI surface (save button + recipes tab) lands in
   *  later Phase-7 items; this is just the data hook. */
  function saveRecipe(name: string, description?: string) {
    const trimmedName = name.trim();
    if (!trimmedName || !currentId) return;
    const id = crypto.randomUUID();
    const recipe: Recipe = {
      id,
      name: trimmedName,
      description: description?.trim() || undefined,
      mode: genMode,
      prompt: input.trim(),
      perspective,
      pose: genMode === "character" ? pose : undefined,
      quality,
      variants,
      gridSize,
      styleOverride: projectStyle.text?.trim() || undefined,
      createdAt: Date.now(),
      usageCount: 0,
    };
    setProjects((p) => {
      const cur = p[currentId];
      if (!cur) return p;
      const recipes = { ...(cur.recipes || {}), [id]: recipe };
      return { ...p, [currentId]: { ...cur, recipes } };
    });
  }

  /** Replay a saved recipe by setting every relevant form state. Bumps
   *  `usageCount` on the recipe so the recipes-tab UI can sort by
   *  most-used. */
  function applyRecipe(id: string) {
    const cur = projects[currentId];
    const recipe = cur?.recipes?.[id];
    if (!recipe) return;
    setGenMode(recipe.mode);
    setInput(recipe.prompt);
    setPerspective(recipe.perspective);
    if (recipe.pose) setPose(recipe.pose);
    setQuality(recipe.quality);
    setVariants(recipe.variants);
    setGridSize(recipe.gridSize);
    if (typeof recipe.styleOverride === "string") {
      setProjectStyle((s) => ({ ...s, text: recipe.styleOverride || "" }));
    }
    // Bump usage count.
    setProjects((p) => {
      const proj = p[currentId];
      if (!proj || !proj.recipes?.[id]) return p;
      const next = { ...proj.recipes[id], usageCount: proj.recipes[id].usageCount + 1 };
      return {
        ...p,
        [currentId]: { ...proj, recipes: { ...proj.recipes, [id]: next } },
      };
    });
  }

  function deleteRecipe(id: string) {
    setProjects((p) => {
      const cur = p[currentId];
      if (!cur || !cur.recipes) return p;
      const { [id]: _drop, ...rest } = cur.recipes;
      return { ...p, [currentId]: { ...cur, recipes: rest } };
    });
  }

  function setScenes(updater: (s: Record<string, Scene>) => Record<string, Scene>) {
    setProjects((p) => {
      const cur = p[currentId];
      if (!cur) return p;
      return { ...p, [currentId]: { ...cur, scenes: updater(cur.scenes || {}) } };
    });
  }

  function updateScene(
    sceneId: string,
    updater: (s: Scene) => Scene,
    opts?: { record?: boolean }
  ) {
    const record = opts?.record !== false;
    setScenes((all) => {
      const s = all[sceneId];
      if (!s) return all;
      const next = updater(s);
      if (next === s) return all;
      if (record) {
        setSceneHistory((h) => {
          const e = h[sceneId] || { past: [], future: [] };
          return {
            ...h,
            [sceneId]: { past: [...e.past, s].slice(-30), future: [] },
          };
        });
      }
      return { ...all, [sceneId]: next };
    });
  }

  function undoScene(sceneId: string) {
    setSceneHistory((h) => {
      const e = h[sceneId] || { past: [], future: [] };
      if (e.past.length === 0) return h;
      const prev = e.past[e.past.length - 1];
      const newPast = e.past.slice(0, -1);
      // Push current to future and restore prev.
      setScenes((all) => {
        const cur = all[sceneId];
        if (!cur) return all;
        // Defer pushing future via the same effect — we have the snapshot.
        setSceneHistory((h2) => {
          const e2 = h2[sceneId] || { past: [], future: [] };
          return { ...h2, [sceneId]: { past: e2.past, future: [...e2.future, cur].slice(-30) } };
        });
        return { ...all, [sceneId]: prev };
      });
      return { ...h, [sceneId]: { past: newPast, future: e.future } };
    });
  }

  function redoScene(sceneId: string) {
    setSceneHistory((h) => {
      const e = h[sceneId] || { past: [], future: [] };
      if (e.future.length === 0) return h;
      const next = e.future[e.future.length - 1];
      const newFuture = e.future.slice(0, -1);
      setScenes((all) => {
        const cur = all[sceneId];
        if (!cur) return all;
        setSceneHistory((h2) => {
          const e2 = h2[sceneId] || { past: [], future: [] };
          return { ...h2, [sceneId]: { past: [...e2.past, cur].slice(-30), future: e2.future } };
        });
        return { ...all, [sceneId]: next };
      });
      return { ...h, [sceneId]: { past: e.past, future: newFuture } };
    });
  }

  function renameCurrentProject(name: string) {
    setProjects((p) => {
      const cur = p[currentId];
      if (!cur) return p;
      return { ...p, [currentId]: { ...cur, name } };
    });
  }

  function createProject(name: string) {
    // Seed the new project's style.preset from the user profile so that
    // a user who consistently picks GameBoy doesn't reset to "cozy" each
    // time they make a new project. Hermes-style cross-session memory.
    const profile = readUserProfile();
    const np = newProject(name, profile.preferredPreset);
    setProjects((p) => ({ ...p, [np.id]: np }));
    setCurrentId(np.id);
  }

  function deleteCurrentProject() {
    const remaining = Object.values(projects).filter((p) => p.id !== currentId);
    if (remaining.length === 0) {
      // Always keep at least one project. Replace with a fresh empty default.
      const np = newProject("Default");
      setProjects({ [np.id]: np });
      setCurrentId(np.id);
      return;
    }
    setProjects((p) => {
      const { [currentId]: _drop, ...rest } = p;
      return rest;
    });
    setCurrentId(remaining[0].id);
  }

  // ------------- hydration + persistence -------------

  // Prompt history (last 30) — recall with up/down arrow on the input.
  const HISTORY_KEY = "pwf:prompt-history:v1";
  const MAX_HISTORY = 30;
  const OPENAI_KEY_LS = "pixelplay:openai-key:v1";
  const FAL_KEY_LS = "pixelplay:fal-key:v1";
  const IMAGE_PROVIDER_LS = "pixelplay:image-provider:v1";
  const ONBOARDED_LS_KEY = "pixelplay:onboarded:v1";
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setPromptHistory(arr.slice(0, MAX_HISTORY));
      }
      const k = localStorage.getItem(OPENAI_KEY_LS);
      if (k) setOpenaiKey(k);
      const fk = localStorage.getItem(FAL_KEY_LS);
      if (fk) setFalKey(fk);
      const provider = localStorage.getItem(IMAGE_PROVIDER_LS);
      if (provider === "openai" || provider === "fal") setImageProvider(provider);
      // Show onboarding modal on first visit.
      if (!localStorage.getItem(ONBOARDED_LS_KEY)) setOnboardingOpen(true);
      // Cross-session user profile (Hermes USER.md analog) — seed form
      // defaults so a returning user starts where they left off.
      const profile = readUserProfile();
      if (profile.preferredMode) setGenMode(profile.preferredMode);
      if (profile.preferredQuality) setQuality(profile.preferredQuality);
      if (profile.preferredPerspective) setPerspective(profile.preferredPerspective);
    } catch {}
  }, []);

  // Sliding window of recent successful FORGE submissions. Promoted to
  // localStorage profile when STREAK_THRESHOLD identical-field samples
  // accumulate (handled inside `streakedFields`). Session-only.
  const forgeWindowRef = useRef<ForgeSample[]>([]);

  // Separate sliding window for recipe-suggestion detection: tracks the
  // last 10 successful FORGEs (mode + prompt), looks for 3+ same-mode
  // submissions with ≥60% prompt-token overlap, and pops a dismissible
  // "🪄 Save this pattern as a recipe?" toast.
  const forgeHistoryRef = useRef<Array<{ mode: GenMode; prompt: string; ts: number }>>([]);
  const [recipeSuggestion, setRecipeSuggestion] = useState<{
    mode: GenMode;
    prompt: string;
  } | null>(null);
  // Prompt-prefixes the user has explicitly dismissed; suppresses the
  // toast for the same pattern this session.
  const dismissedSuggestionsRef = useRef<Set<string>>(new Set());

  // Sliding window of recent FAILED generations. Hermes-style self-
  // improving prompt: when 3 entries share a prompt prefix, kick off
  // /api/synthesize-note to summarize the failure pattern as a one-line
  // bullet, then append it to the project MEMORY blob so subsequent
  // prompts learn to avoid the trap.
  const errorWindowRef = useRef<Array<{ prompt: string; error: string }>>([]);

  /** Push an error and, if the last 3 entries share a 12+-char prompt
   *  prefix (case-insensitive, trimmed), call the synthesize-note route
   *  and append its bullet to the project's MEMORY blob. The errors are
   *  cleared on success so the same trap doesn't fire repeatedly. */
  async function recordGenerationError(prompt: string, error: string) {
    const win = errorWindowRef.current;
    win.push({ prompt: prompt.trim(), error: error.slice(0, 400) });
    if (win.length > 10) win.shift();
    if (win.length < 3) return;
    const recent = win.slice(-3);
    const prefix = sharedPrefix(
      recent.map((e) => e.prompt.toLowerCase().trim())
    );
    if (prefix.length < 12) return;
    // Drop the matched group so the next 3 errors can fire a new note.
    errorWindowRef.current = win.slice(0, -3);
    try {
      const res = await fetch("/api/synthesize-note", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          errors: recent,
          existingMemory: getEffectiveProjectMemory(),
        }),
      });
      const data = (await res.json()) as { note?: string };
      const note = data.note?.trim();
      if (!note) return;
      // Append the bullet to the project's memory, capped at the soft limit.
      const cur = getEffectiveProjectMemory();
      // Skip if already present (don't duplicate the same lesson).
      if (cur.includes(note)) return;
      const merged = cur ? `${cur}\n${note}` : note;
      setProjectMemory(merged);
    } catch {
      /* network error — ignore, will retry on the next 3-strike */
    }
  }

  // Helper: build fetch headers including the user-supplied OpenAI key.
  function authHeaders(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (openaiKey.trim()) h["x-openai-key"] = openaiKey.trim();
    return h;
  }

  /** Build a small text snapshot of the current project for the agent's
   *  system prompt. Capped to a few KB so the agent has enough context to
   *  reference existing assets / scenes / recipes / memory without
   *  ballooning request size. */
  function buildAgentProjectContext(): string {
    const cur = projects[currentId];
    if (!cur) return "";
    const lines: string[] = [];
    lines.push(`Project: ${cur.name}`);
    const liveAssets = Object.values(cur.assets || {}).filter(
      (a) => !a.trashedAt
    );
    if (liveAssets.length > 0) {
      const previews = liveAssets
        .slice(0, 30)
        .map((a) => `- ${a.name || a.prompt} (${a.assetType})`)
        .join("\n");
      lines.push(`Assets (${liveAssets.length}):\n${previews}`);
    }
    const sceneList = Object.values(cur.scenes || {});
    if (sceneList.length > 0) {
      const names = sceneList
        .slice(0, 10)
        .map((s) => `- ${s.name}`)
        .join("\n");
      lines.push(`Scenes (${sceneList.length}):\n${names}`);
    }
    const recipeList = Object.values(cur.recipes || {});
    if (recipeList.length > 0) {
      const recipes = recipeList
        .slice(0, 10)
        .map((r) => `- ${r.name} (${r.mode})`)
        .join("\n");
      lines.push(`Recipes (${recipeList.length}):\n${recipes}`);
    }
    const mem = (cur.memory ?? cur.style?.text ?? "").trim();
    if (mem) lines.push(`Memory:\n${mem.slice(0, 600)}`);
    return lines.join("\n\n");
  }

  /** Convert the visual agent log to OpenAI Chat-Completions wire format.
   *  tool_call chips are dropped (we don't replay assistant tool_calls in
   *  the wire — the simplified design surfaces tool results as a
   *  synthesized user message instead, per the roadmap). tool_result
   *  chips collapse into one user message per contiguous run. */
  function buildWireFromLog(
    log: AgentMsg[]
  ): Array<{ role: "user" | "assistant"; content: string }> {
    const wire: Array<{ role: "user" | "assistant"; content: string }> = [];
    let pending: string[] = [];
    const flush = () => {
      if (pending.length === 0) return;
      wire.push({ role: "user", content: `Tool results:\n${pending.join("\n")}` });
      pending = [];
    };
    for (const m of log) {
      if (m.kind === "tool_result") {
        pending.push(`[${m.name}] ${m.result}`);
        continue;
      }
      flush();
      if (m.kind === "user") wire.push({ role: "user", content: m.text });
      else if (m.kind === "assistant" && m.text)
        wire.push({ role: "assistant", content: m.text });
    }
    flush();
    return wire;
  }

  /** Execute the tool calls the agent emitted in one turn. Returns
   *  `{id, name, result}` per call — `result` is a short text summary
   *  the agent reads back as feedback on the next turn. forge_asset
   *  queues a request via `pendingAgentForges` (the FORGE form fires
   *  asynchronously so the agent doesn't block on image generation);
   *  the others run synchronously against the project state. */
  async function executeAgentToolCalls(
    calls: Array<{ id: string; name: string; args: unknown }>
  ): Promise<Array<{ id: string; name: string; result: string }>> {
    const out: Array<{ id: string; name: string; result: string }> = [];
    const cur = projects[currentId];
    for (const tc of calls) {
      let result = "";
      try {
        const args = (tc.args && typeof tc.args === "object"
          ? tc.args
          : {}) as Record<string, unknown>;
        if (tc.name === "forge_asset") {
          const a = args as Partial<ForgeAssetArgs>;
          const prompt = typeof a.prompt === "string" ? a.prompt.trim() : "";
          const mode = a.mode;
          if (
            !prompt ||
            (mode !== "character" && mode !== "item" && mode !== "scene")
          ) {
            result =
              "Error: forge_asset requires `prompt` and `mode` (character|item|scene).";
          } else {
            const q =
              a.quality === "low" ||
              a.quality === "medium" ||
              a.quality === "high"
                ? a.quality
                : undefined;
            setPendingAgentForges((q2) => [...q2, { prompt, mode, quality: q }]);
            result = `Queued ${mode} forge: "${prompt.slice(0, 80)}"${
              q ? ` (${q})` : ""
            }.`;
          }
        } else if (tc.name === "list_assets") {
          const live = Object.values(cur?.assets || {}).filter(
            (a) => !a.trashedAt
          );
          const slim = live.slice(0, 100).map((a) => ({
            id: a.id,
            name: a.name || a.prompt,
            assetType: a.assetType,
            prompt: a.prompt,
          }));
          result = JSON.stringify(slim);
        } else if (tc.name === "set_project_memory") {
          const a = args as Partial<SetProjectMemoryArgs>;
          if (typeof a.memory !== "string") {
            result = "Error: set_project_memory requires `memory` string.";
          } else {
            setProjectMemory(a.memory);
            result = `Project memory updated (${Math.min(
              a.memory.length,
              PROJECT_MEMORY_CAP
            )} chars).`;
          }
        } else if (tc.name === "apply_recipe") {
          const a = args as Partial<ApplyRecipeArgs>;
          const ref = typeof a.recipe === "string" ? a.recipe.trim() : "";
          if (!ref) {
            result = "Error: apply_recipe requires `recipe` (id or name).";
          } else {
            const recipes = cur?.recipes || {};
            let recipe: Recipe | undefined = recipes[ref];
            if (!recipe) {
              const lower = ref.toLowerCase();
              recipe = Object.values(recipes).find(
                (r) => r.name.toLowerCase() === lower
              );
            }
            if (recipe) {
              applyRecipe(recipe.id);
              result = `Applied recipe: ${recipe.name} (${recipe.mode}).`;
            } else {
              const names = Object.values(recipes).map((r) => r.name);
              result = `No recipe matching "${ref}". Available: ${
                names.length > 0 ? names.join(", ") : "none"
              }.`;
            }
          }
        } else {
          result = `Unknown tool: ${tc.name}`;
        }
      } catch (err) {
        result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
      out.push({ id: tc.id, name: tc.name, result });
    }
    return out;
  }

  /** Stream one agent turn against `/api/agent`, render deltas + tool-call
   *  chips into the visual log, and — if the turn emitted any tool calls
   *  — execute them, append tool_result chips, and recurse with an
   *  extended history. The route's 8-turn cap prevents runaway loops. */
  async function streamAgentTurn(
    history: Array<{ role: "user" | "assistant"; content: string }>
  ) {
    setAgentMessages((m) => [
      ...m,
      { kind: "assistant", text: "", streaming: true },
    ]);

    const appendAssistantDelta = (delta: string) => {
      setAgentMessages((m) => {
        const next = [...m];
        for (let i = next.length - 1; i >= 0; i--) {
          const cur = next[i];
          if (cur.kind === "assistant" && cur.streaming) {
            next[i] = { ...cur, text: cur.text + delta };
            return next;
          }
        }
        return next;
      });
    };
    const finalizeAssistant = () => {
      setAgentMessages((m) =>
        m.map((cur) =>
          cur.kind === "assistant" && cur.streaming
            ? { ...cur, streaming: false }
            : cur
        )
      );
    };
    const insertToolCall = (id: string, name: string, args: unknown) => {
      setAgentMessages((m) => {
        // Insert the tool-call chip just before the streaming assistant
        // bubble so chips appear in the order the model emitted them.
        const next = [...m];
        const lastIdx = next.length - 1;
        if (
          lastIdx >= 0 &&
          next[lastIdx].kind === "assistant" &&
          next[lastIdx].streaming
        ) {
          next.splice(lastIdx, 0, { kind: "tool_call", id, name, args });
          return next;
        }
        next.push({ kind: "tool_call", id, name, args });
        return next;
      });
    };

    let turnAssistantText = "";
    const turnToolCalls: Array<{ id: string; name: string; args: unknown }> = [];
    let errored = false;

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          messages: history,
          projectContext: buildAgentProjectContext(),
        }),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        let parsed = "";
        try {
          parsed = (JSON.parse(errText) as { error?: string }).error || "";
        } catch {
          parsed = errText;
        }
        finalizeAssistant();
        setAgentMessages((m) => [
          ...m,
          {
            kind: "error",
            text: parsed || `Agent request failed (${res.status})`,
          },
        ]);
        setAgentBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data) continue;
            let evt: {
              type?: string;
              text?: string;
              id?: string;
              name?: string;
              args?: unknown;
              message?: string;
            };
            try {
              evt = JSON.parse(data);
            } catch {
              continue;
            }
            if (evt.type === "delta" && typeof evt.text === "string") {
              turnAssistantText += evt.text;
              appendAssistantDelta(evt.text);
            } else if (evt.type === "tool_call") {
              const id = evt.id || "";
              const name = evt.name || "";
              turnToolCalls.push({ id, name, args: evt.args });
              insertToolCall(id, name, evt.args);
            } else if (evt.type === "error") {
              setAgentMessages((m) => [
                ...m,
                { kind: "error", text: evt.message || "Agent error" },
              ]);
              errored = true;
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAgentMessages((m) => [
        ...m,
        { kind: "error", text: `Agent stream failed: ${msg}` },
      ]);
      errored = true;
    } finally {
      finalizeAssistant();
    }

    if (errored || turnToolCalls.length === 0) {
      setAgentBusy(false);
      return;
    }

    // Execute the turn's tool calls, render tool_result chips, then
    // recurse with the results threaded in as a synthesized user message.
    const results = await executeAgentToolCalls(turnToolCalls);
    setAgentMessages((m) => [
      ...m,
      ...results.map(
        (r) =>
          ({
            kind: "tool_result",
            id: r.id,
            name: r.name,
            result: r.result,
          }) as AgentMsg
      ),
    ]);
    const followUp: Array<{ role: "user" | "assistant"; content: string }> = [
      ...history,
    ];
    if (turnAssistantText.trim()) {
      followUp.push({ role: "assistant", content: turnAssistantText });
    }
    followUp.push({
      role: "user",
      content: `Tool results:\n${results
        .map((r) => `[${r.name}] ${r.result}`)
        .join("\n")}`,
    });
    await streamAgentTurn(followUp);
  }

  /** Send a user-typed agent message: pushes a user chip into the visual
   *  log, builds wire history from the prior log, and kicks off the
   *  streaming turn loop. Tool-call/result rounds are handled by
   *  `streamAgentTurn` via tail recursion. */
  async function sendAgentMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || agentBusy) return;
    if (!openaiKey.trim()) {
      setAgentMessages((m) => [
        ...m,
        { kind: "user", text: trimmed },
        {
          kind: "error",
          text: "No OpenAI key. Open ⚙ Settings and paste your key.",
        },
      ]);
      setAgentInput("");
      return;
    }
    const wireHistory = buildWireFromLog(agentMessages);
    wireHistory.push({ role: "user", content: trimmed });
    setAgentMessages((m) => [...m, { kind: "user", text: trimmed }]);
    setAgentInput("");
    setAgentBusy(true);
    await streamAgentTurn(wireHistory);
  }

  /** Pick the image-gen endpoint + headers based on the user's provider
   *  preference. Scene mode (`splitItems`) always routes to OpenAI since
   *  FAL has no scene parser; everything else honours the selector. */
  function imageGenRoute(opts: { splitItems?: boolean }): {
    url: string;
    headers: Record<string, string>;
    isFal: boolean;
  } {
    const useFal = imageProvider === "fal" && !opts.splitItems;
    if (useFal) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (falKey.trim()) headers["x-fal-key"] = falKey.trim();
      return { url: "/api/generate-fal", headers, isFal: true };
    }
    return { url: "/api/generate", headers: authHeaders(), isFal: false };
  }

  /** Fire-and-forget embedding pass for newly-created assets. Looks up
   *  each id at call time, builds a `name + prompt + tags` text, sends
   *  one batched embed request, then writes each vector back to its
   *  asset record. Quiet failure on no-key (route returns 401). */
  async function embedAssets(ids: string[]) {
    if (ids.length === 0) return;
    // Snapshot the texts up-front so we can match indexes to ids reliably.
    const samples = ids
      .map((id) => {
        const a = assets[id];
        if (!a || a.embedding) return null; // already embedded
        const text = [a.name || "", a.prompt || "", (a.tags || []).join(" ")]
          .filter(Boolean)
          .join(". ")
          .slice(0, 400);
        return text ? { id, text } : null;
      })
      .filter((x): x is { id: string; text: string } => !!x);
    if (samples.length === 0) return;
    try {
      const res = await fetch("/api/embed", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ texts: samples.map((s) => s.text) }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { embeddings?: number[][] };
      const embs = data.embeddings || [];
      if (embs.length !== samples.length) return;
      setAssets((a) => {
        const next = { ...a };
        samples.forEach((s, i) => {
          if (next[s.id] && embs[i]) {
            next[s.id] = { ...next[s.id], embedding: embs[i] };
          }
        });
        return next;
      });
    } catch {
      /* silent — semantic search just falls back to substring */
    }
  }

  /** Semantic-search fallback: when the substring search comes up empty
   *  AND we have at least one asset with an embedding, embed the query
   *  and rank by cosine similarity. Debounced 350ms; tokenised so a
   *  fast typer never sees stale results. Failure is silent — the UI
   *  just keeps showing the (empty) substring result. */
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setSemanticIds(null);
      setSemanticBusy(false);
      return;
    }
    const ql = q.toLowerCase();
    const allLive = Object.values(assets).filter((a) => !a.trashedAt);
    const hasSubstring = allLive.some((a) => {
      const hay = `${a.name || ""} ${a.prompt} ${(a.tags || []).join(" ")} ${a.assetType}`.toLowerCase();
      return hay.includes(ql);
    });
    if (hasSubstring) {
      setSemanticIds(null);
      setSemanticBusy(false);
      return;
    }
    const candidates = allLive.filter(
      (a): a is Asset & { embedding: number[] } => Array.isArray(a.embedding) && a.embedding.length > 0
    );
    if (candidates.length === 0) {
      setSemanticIds(null);
      setSemanticBusy(false);
      return;
    }
    const myToken = ++semanticTokenRef.current;
    setSemanticBusy(true);
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/embed", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ texts: [q] }),
        });
        if (!res.ok || semanticTokenRef.current !== myToken) return;
        const data = (await res.json()) as { embeddings?: number[][] };
        const qvec = data.embeddings?.[0];
        if (!qvec || semanticTokenRef.current !== myToken) return;
        const ranked = rankBySimilarity(candidates, qvec, { topK: 24, minScore: 0.25 });
        if (semanticTokenRef.current !== myToken) return;
        setSemanticIds(ranked.map((r) => r.id));
      } catch {
        /* silent — substring miss + semantic miss = empty state */
      } finally {
        if (semanticTokenRef.current === myToken) setSemanticBusy(false);
      }
    }, 350);
    return () => window.clearTimeout(handle);
  }, [search, assets]);

  function pushPromptHistory(p: string) {
    const trimmed = p.trim();
    if (!trimmed) return;
    setPromptHistory((cur) => {
      const next = [trimmed, ...cur.filter((x) => x !== trimmed)].slice(0, MAX_HISTORY);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    setHistoryIdx(-1);
  }

  useEffect(() => {
    (async () => {
      try {
        const fromIdb = await idbGet<Record<string, Project>>(PROJECTS_IDB_KEY);
        const savedCurrentId = await idbGet<string>(CURRENT_ID_IDB_KEY);

        if (fromIdb && Object.keys(fromIdb).length > 0) {
          // Backfill any legacy fields missing on older project records.
          const upgraded: Record<string, Project> = {};
          for (const [id, p] of Object.entries(fromIdb)) {
            upgraded[id] = { ...p, scenes: p.scenes || {} };
          }
          setProjects(upgraded);
          setCurrentId(savedCurrentId && upgraded[savedCurrentId] ? savedCurrentId : Object.keys(upgraded)[0]);
        } else {
          // Migrate legacy single-project storage if present.
          const legacyAssets = await idbGet<Record<string, Asset>>(LEGACY_ASSETS_IDB_KEY);
          let migratedAssets: Record<string, Asset> | null = legacyAssets || null;
          if (!migratedAssets) {
            const legacyLs = localStorage.getItem(LEGACY_ASSETS_LS_KEY);
            if (legacyLs) {
              try { migratedAssets = JSON.parse(legacyLs); } catch {}
            }
          }
          let migratedStyle: ProjectStyle = emptyStyle();
          const legacyStyle = localStorage.getItem(LEGACY_STYLE_LS_KEY);
          if (legacyStyle) {
            try {
              const parsed = JSON.parse(legacyStyle);
              migratedStyle = { ...emptyStyle(), ...parsed };
            } catch {}
          }
          const np = newProject("Default");
          np.assets = migratedAssets || {};
          np.style = migratedStyle;
          const seeded = { [np.id]: np };
          setProjects(seeded);
          setCurrentId(np.id);
          await idbSet(PROJECTS_IDB_KEY, seeded);
          await idbSet(CURRENT_ID_IDB_KEY, np.id);
          // Clean up legacy storage.
          localStorage.removeItem(LEGACY_ASSETS_LS_KEY);
          localStorage.removeItem(LEGACY_STYLE_LS_KEY);
        }
      } catch {
        // Storage unavailable — start in-memory with a default project.
        const np = newProject("Default");
        setProjects({ [np.id]: np });
        setCurrentId(np.id);
      }
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // Strip trashed assets before persisting — trash is session-only by
    // design (asset re-resurrection on reload would surprise users).
    const stripped: Record<string, Project> = {};
    for (const [pid, p] of Object.entries(projects)) {
      const cleanedAssets: Record<string, Asset> = {};
      for (const [aid, a] of Object.entries(p.assets || {})) {
        if (!a.trashedAt) cleanedAssets[aid] = a;
      }
      stripped[pid] = { ...p, assets: cleanedAssets };
    }
    idbSet(PROJECTS_IDB_KEY, stripped).catch(() => {});
  }, [projects, hydrated]);

  useEffect(() => {
    if (!hydrated || !currentId) return;
    idbSet(CURRENT_ID_IDB_KEY, currentId).catch(() => {});
  }, [currentId, hydrated]);

  // Restore the active scene + selected item for the current project on
  // hydration / project switch, then persist any further changes.
  useEffect(() => {
    if (!hydrated || !currentId) return;
    let cancelled = false;
    (async () => {
      try {
        const map = (await idbGet<SceneUiByProject>(SCENE_UI_IDB_KEY)) || {};
        if (cancelled) return;
        const saved = map[currentId];
        if (saved) {
          setActiveSceneId(saved.activeSceneId);
          // Migrate legacy single-id selection to the array form.
          if (Array.isArray(saved.selectedSceneItemIds)) {
            setSelectedSceneItemIds(saved.selectedSceneItemIds);
          } else if (saved.selectedSceneItemId) {
            setSelectedSceneItemIds([saved.selectedSceneItemId]);
          } else {
            setSelectedSceneItemIds([]);
          }
        } else {
          setActiveSceneId(null);
          setSelectedSceneItemIds([]);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, currentId]);

  useEffect(() => {
    if (!hydrated || !currentId) return;
    (async () => {
      try {
        const map = (await idbGet<SceneUiByProject>(SCENE_UI_IDB_KEY)) || {};
        map[currentId] = { activeSceneId, selectedSceneItemIds };
        await idbSet(SCENE_UI_IDB_KEY, map);
      } catch {}
    })();
  }, [hydrated, currentId, activeSceneId, selectedSceneItemIds]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Detect `?import=<id>` once after hydration and pipe the shared zip
  // through importProject. Clears the query param afterwards so a refresh
  // doesn't re-import. Ref-guarded so it only fires once per page load
  // even if the effect would otherwise re-run on hydrated→true transitions.
  const importedSharedRef = useRef(false);
  useEffect(() => {
    if (!hydrated || importedSharedRef.current) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("import");
    if (!id) return;
    importedSharedRef.current = true;
    (async () => {
      setImportingShared(true);
      try {
        const res = await fetch(`/api/share?id=${encodeURIComponent(id)}`);
        if (!res.ok) {
          alert(`Couldn't load shared project (HTTP ${res.status}).`);
          return;
        }
        const blob = await res.blob();
        const file = new File([blob], `${id}.zip`, { type: "application/zip" });
        await importProject(file);
      } catch (err) {
        alert(`Couldn't import shared project: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setImportingShared(false);
        // Clear the query param so a refresh doesn't re-trigger the import.
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete("import");
          window.history.replaceState({}, "", url.toString());
        } catch {}
      }
    })();
  }, [hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!agentOpen) return;
    agentScrollRef.current?.scrollTo({
      top: agentScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [agentMessages, agentOpen]);

  // Editor-style keyboard shortcuts when the scenes tab is active and an
  // item is selected. Shortcuts ignore focus-in-input/textarea so users can
  // still type freely in prompts and tag fields.
  useEffect(() => {
    function isEditableTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable
      );
    }
    function onKey(e: KeyboardEvent) {
      if (rightTab !== "scenes" || !activeScene) return;
      if (isEditableTarget(e.target)) return;

      const sel = selectedSceneItem;
      const step = sceneSnap > 0 ? sceneSnap : 1;

      if (e.key === "Escape") {
        if (selectedSceneItemIds.length > 0) {
          e.preventDefault();
          setSelectedSceneItemIds([]);
        }
        return;
      }

      const ctrl = e.metaKey || e.ctrlKey;
      // Undo / redo work regardless of selection.
      if (ctrl && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redoScene(activeScene.id);
        else undoScene(activeScene.id);
        return;
      }
      // Paste works without a selection — pastes from the clipboard.
      if (ctrl && (e.key === "v" || e.key === "V")) {
        if (sceneClipboard.length > 0) {
          e.preventDefault();
          pasteSceneItems();
        }
        return;
      }
      // Copy needs a selection — multi-select aware.
      if (ctrl && (e.key === "c" || e.key === "C")) {
        if (selectedSceneItemIds.length > 0) {
          e.preventDefault();
          copySceneItems(selectedSceneItemIds);
        }
        return;
      }

      if (!sel) return;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          moveSceneItem(activeScene.id, sel.id, Math.max(0, sel.x - step), sel.y);
          return;
        case "ArrowRight":
          e.preventDefault();
          moveSceneItem(activeScene.id, sel.id, Math.min(activeScene.width, sel.x + step), sel.y);
          return;
        case "ArrowUp":
          e.preventDefault();
          moveSceneItem(activeScene.id, sel.id, sel.x, Math.max(0, sel.y - step));
          return;
        case "ArrowDown":
          e.preventDefault();
          moveSceneItem(activeScene.id, sel.id, sel.x, Math.min(activeScene.height, sel.y + step));
          return;
        case "Backspace":
        case "Delete":
          e.preventDefault();
          deleteSceneItem(activeScene.id, sel.id);
          return;
        case "d":
        case "D":
          if (ctrl) {
            e.preventDefault();
            duplicateSceneItem(activeScene.id, sel.id);
          }
          return;
        case "]":
          if (ctrl) {
            e.preventDefault();
            bumpSceneItemZ(activeScene.id, sel.id, 1);
          }
          return;
        case "[":
          if (ctrl) {
            e.preventDefault();
            bumpSceneItemZ(activeScene.id, sel.id, -1);
          }
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rightTab, activeScene, selectedSceneItem, selectedSceneItemIds, sceneSnap, sceneClipboard]);

  // Refresh cost indicators on hydration / project switch.
  useEffect(() => {
    if (!hydrated) return;
    setSessionState(getSession());
    if (currentId) setProjectLifetime(getProjectCost(currentId));
  }, [hydrated, currentId]);

  // Replay a pending submit once the user saves a key in Settings. Either
  // key can unblock — handleSubmit re-checks against the active provider.
  useEffect(() => {
    if (!pendingSubmitPrompt || busy) return;
    if (!openaiKey.trim() && !falKey.trim()) return;
    const prompt = pendingSubmitPrompt;
    setPendingSubmitPrompt(null);
    void handleSubmit(null, prompt);
    // handleSubmit is a stable closure over the latest state in this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSubmitPrompt, openaiKey, falKey, busy]);

  // Pop the next agent-queued forge when the FORGE form is idle. Sets the
  // form's mode/quality first, then triggers handleSubmit via the existing
  // pendingSubmitPrompt replay path (so the no-key Settings popup still works).
  useEffect(() => {
    if (busy || pendingSubmitPrompt) return;
    if (pendingAgentForges.length === 0) return;
    const [head, ...rest] = pendingAgentForges;
    setPendingAgentForges(rest);
    setGenMode(head.mode);
    if (head.quality) setQuality(head.quality);
    setPendingSubmitPrompt(head.prompt);
  }, [busy, pendingSubmitPrompt, pendingAgentForges]);

  // ------------- handlers -------------

  async function handleSubmit(e: React.FormEvent | null, promptOverride?: string) {
    if (e) e.preventDefault();
    const prompt = (promptOverride ?? input).trim();
    if (!prompt || busy) return;

    const isCharacter = genMode === "character";
    const effectivePose = isCharacter ? pose : "single";
    const isScene = genMode === "scene";

    // No key yet → stash the prompt and pop Settings instead of letting
    // the request fail with a 401. The effect below replays once the key
    // is saved. Scene mode always needs the OpenAI key (FAL has no parser);
    // otherwise we ask for whichever key the active provider needs.
    const useFal = imageProvider === "fal" && !isScene;
    const requiredKey = useFal ? falKey : openaiKey;
    if (!requiredKey.trim()) {
      setPendingSubmitPrompt(prompt);
      setSettingsOpen(true);
      return;
    }

    setBusy(true);
    pushPromptHistory(prompt);
    setInput("");

    // Internal Asset.assetType: characters get "character" so existing
    // character-aware code (ensurePlayerCharacter, scene player, walk-cycle
    // detection) keeps working. Everything else collapses to "item".
    const newAssetType: AssetType = isCharacter ? "character" : "item";

    setMessages((m) => [
      ...m,
      { role: "user", text: prompt, assetType: newAssetType, perspective, pose: effectivePose, mode: "generate" },
    ]);
    setMessages((m) => [
      ...m,
      { role: "assistant", text: isScene ? "Parsing scene & forging items…" : "Forging pixels…" },
    ]);

    const referenceUrls: string[] = [];
    if (projectStyle.refUrl) referenceUrls.push(projectStyle.refUrl);

    try {
      // FAL Schnell only handles plain prompt + size + variants — drop the
      // perspective/pose/style framing the OpenAI route uses to enrich
      // prompts. Scene mode (`splitItems`) always routes through OpenAI.
      const route = imageGenRoute({ splitItems: isScene });
      const reqBody = route.isFal
        ? { prompt, quality, variants }
        : {
            prompt,
            assetType: newAssetType,
            perspective,
            pose: effectivePose,
            quality,
            variants,
            referenceUrls,
            projectStyle: projectStyle.text || undefined,
            stylePreset: projectStyle.preset,
            splitItems: isScene,
            projectMemory: getEffectiveProjectMemory() || undefined,
          };
      const res = await fetch(route.url, {
        method: "POST",
        headers: route.headers,
        body: JSON.stringify(reqBody),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const sourceSize: string = data.size || "1024x1024";
      const cols: number = data.cols || 1;
      const rows: number = data.rows || 1;

      // Split-items returns { items: [{name, url}, ...] }; otherwise { urls: [...] }.
      const generated: Array<{ name: string; url: string }> = isScene
        ? (data.items as Array<{ name: string; url: string }>) || []
        : ((data.urls as string[]) || []).map((url: string) => ({ name: prompt, url }));

      const newIds: string[] = [];
      const updates: Record<string, Asset> = {};
      for (const { name, url } of generated) {
        // For split-items single-frame items, trim transparent borders so
        // every sprite ends at its actual silhouette. This makes scaling
        // visually consistent across items (cabin vs tree vs barrel).
        // Skip for multi-frame sheets (would break the cell grid).
        let trimmedRaw = url;
        let trimmedSize = sourceSize;
        if (isScene && cols === 1 && rows === 1) {
          try {
            const t = await trimAlphaToContent(url);
            if (t.trimmed) {
              trimmedRaw = t.url;
              trimmedSize = `${t.width}x${t.height}`;
            }
          } catch {
            /* ignore — fall back to untrimmed */
          }
        }
        const pixelUrl = await applyPixelate(trimmedRaw, gridSize, trimmedSize);
        const id = crypto.randomUUID();
        updates[id] = {
          id,
          prompt: name,
          assetType: newAssetType,
          perspective,
          pose: effectivePose,
          rawUrl: trimmedRaw,
          pixelUrl,
          gridSize,
          sourceSize: trimmedSize,
          cols,
          rows,
          createdAt: Date.now(),
        };
        newIds.push(id);
      }
      setAssets((a) => ({ ...a, ...updates }));

      // Fire-and-forget vector indexing of the new assets so the gallery
      // search can do semantic match (~$0.0001 per asset).
      void embedAssets(newIds);

      // Variety check for multi-frame sheets.
      if (cols * rows > 1) {
        for (const [id, asset] of Object.entries(updates)) {
          checkSheetVariety(asset.rawUrl, cols, rows)
            .then((res) => {
              if (!res.varied) {
                setAssets((a) =>
                  a[id] ? { ...a, [id]: { ...a[id], lowVariety: true } } : a
                );
              }
            })
            .catch(() => {});
        }
      }

      // Cost tracking. FAL responses carry an authoritative `cost` field;
      // OpenAI responses don't, so we estimate from the price table.
      const sourceSizeForCost = (data.size || "1024x1024") as
        | "1024x1024"
        | "1024x1536"
        | "1536x1024";
      let spend = 0;
      let calls = 0;
      if (isScene) {
        spend += estimateChatCost();
        calls += 1;
        for (let i = 0; i < newIds.length; i++) {
          spend += estimateImageCost(quality, "1024x1024", 1);
          calls += 1;
        }
      } else if (route.isFal) {
        spend += typeof data.cost === "number" ? data.cost : 0;
        calls += 1;
      } else {
        spend += estimateImageCost(quality, sourceSizeForCost, newIds.length);
        calls += 1;
      }
      const rec = recordSpend(currentId, spend, calls, quality as "low" | "medium" | "high");
      setSessionState(rec.session);
      setProjectLifetime(rec.project);

      // Scene mode: auto-compose into a new scene. Pass through the parser's
      // context hint (interior/exterior/aerial) so the layout call knows
      // whether to hug walls vs. scatter on a landscape. Also pass any
      // per-item failures so they surface as a badge on the scene.
      if (isScene && newIds.length > 1) {
        const sceneFailures = (data.failures as Array<{ name: string; error: string }> | undefined) || undefined;
        await composeSceneFromAssets(prompt, newIds, updates, data.context, sceneFailures);
        const sceneRec = recordSpend(currentId, estimateChatCost(), 1, "chat");
        setSessionState(sceneRec.session);
        setProjectLifetime(sceneRec.project);
      }

      // Item mode + active scene + "Add to scene" checked: append each new
      // asset to the active scene at staggered positions.
      if (!isScene && addToScene && activeScene && newIds.length > 0) {
        const sceneId = activeScene.id;
        const cx = activeScene.width / 2;
        const cy = activeScene.height / 2;
        newIds.forEach((id, i) => {
          // Spread variants in a small fan so they don't perfectly overlap.
          const dx = (i - (newIds.length - 1) / 2) * 60;
          addAssetToScene(sceneId, id, cx + dx, cy);
        });
      }

      // Status message.
      const sceneSuffix =
        isScene && newIds.length > 1 ? ` — composed into 🎬 Scenes` : "";
      const addedSuffix =
        !isScene && addToScene && activeScene && newIds.length > 0
          ? ` — added to 🎬 ${activeScene.name}`
          : "";
      const verbDone = isScene
        ? `Forged ${newIds.length} item${newIds.length > 1 ? "s" : ""}: ${generated
            .map((g) => g.name)
            .join(", ")}${sceneSuffix}`
        : (() => {
            const variantsLabel = newIds.length > 1 ? ` × ${newIds.length}` : "";
            const poseLabel = effectivePose !== "single" ? ` (${effectivePose})` : "";
            const what = isCharacter ? "character" : "item";
            return `Forged ${what}${poseLabel}${variantsLabel} — ${quality}, ${gridLabel(gridSize)}${addedSuffix}.`;
          })();
      const failures = (data.failures as Array<{ name: string; error: string }> | undefined) || [];
      const failureNote =
        failures.length > 0
          ? `\n⚠ ${failures.length} item${failures.length > 1 ? "s" : ""} failed: ${failures
              .map((f) => f.name)
              .join(", ")}`
          : "";
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "assistant",
          text: verbDone + failureNote,
          assetIds: newIds,
        };
        return copy;
      });

      // Cross-session profile streak: a single successful FORGE doesn't
      // override saved preferences, but 5 in a row of the same value will.
      forgeWindowRef.current = [
        ...forgeWindowRef.current.slice(-9),
        { mode: genMode, quality, perspective },
      ];
      const promote = streakedFields(forgeWindowRef.current);
      if (Object.keys(promote).length > 0) {
        patchUserProfile(promote);
      }

      // Recipe-suggestion detector — push to history, look for a 3+
      // same-mode pattern with ≥60% prompt-token overlap, surface as a
      // dismissible toast.
      forgeHistoryRef.current = [
        ...forgeHistoryRef.current.slice(-9),
        { mode: genMode, prompt, ts: Date.now() },
      ];
      const pattern = detectRecipePattern(forgeHistoryRef.current);
      if (pattern) {
        const dismissKey = `${pattern.mode}:${pattern.prompt.slice(0, 30).toLowerCase()}`;
        if (!dismissedSuggestionsRef.current.has(dismissKey)) {
          setRecipeSuggestion(pattern);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", text: `Error: ${msg}`, error: true };
        return copy;
      });
      // Self-improving prompt: if 3 similar prompts in a row failed,
      // /api/synthesize-note synthesizes a "watch out" bullet and we
      // append it to the project MEMORY so future prompts learn.
      void recordGenerationError(prompt, msg);
    } finally {
      setBusy(false);
    }
  }

  /** Per-card inline edit. The user clicks ✏️ on an asset, types a small
   *  edit prompt, and we run /api/generate with the asset as a reference
   *  image. Result is added as a new asset (editedFrom set), so undo is
   *  trivial — just delete the new one. */
  async function editAssetInline(asset: Asset, editText: string) {
    const trimmed = editText.trim();
    if (!trimmed || editingBusy) return;
    setEditingBusy(true);
    setMessages((m) => [...m, { role: "user", text: `✏️ ${trimmed}`, assetType: asset.assetType, perspective: asset.perspective, pose: asset.pose, mode: "edit" }]);
    setMessages((m) => [...m, { role: "assistant", text: "Editing…" }]);
    const referenceUrls = [asset.rawUrl];
    if (projectStyle.refUrl) referenceUrls.push(projectStyle.refUrl);
    try {
      // FAL Schnell can't accept reference images, so an FAL-routed edit
      // is effectively a fresh single-image gen from the edit prompt.
      const route = imageGenRoute({});
      const reqBody = route.isFal
        ? { prompt: trimmed, quality, variants: 1 }
        : {
            prompt: trimmed,
            assetType: asset.assetType,
            perspective: asset.perspective,
            pose: "single" as const,
            quality,
            variants: 1,
            referenceUrls,
            projectStyle: projectStyle.text || undefined,
            stylePreset: projectStyle.preset,
            projectMemory: getEffectiveProjectMemory() || undefined,
          };
      const res = await fetch(route.url, {
        method: "POST",
        headers: route.headers,
        body: JSON.stringify(reqBody),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const url = ((data.urls as string[]) || [])[0];
      if (!url) throw new Error("No image returned");
      const sourceSize: string = data.size || asset.sourceSize;
      const cols: number = data.cols || 1;
      const rows: number = data.rows || 1;
      const pixelUrl = await applyPixelate(url, asset.gridSize, sourceSize);
      const id = crypto.randomUUID();
      const newAsset: Asset = {
        id,
        prompt: trimmed,
        name: `${asset.name || asset.prompt} (edit)`,
        assetType: asset.assetType,
        perspective: asset.perspective,
        pose: asset.pose,
        rawUrl: url,
        pixelUrl,
        gridSize: asset.gridSize,
        sourceSize,
        cols,
        rows,
        editedFrom: asset.id,
        createdAt: Date.now(),
      };
      setAssets((a) => ({ ...a, [id]: newAsset }));
      void embedAssets([id]);
      const editSpend = route.isFal
        ? (typeof data.cost === "number" ? data.cost : 0)
        : estimateImageCost(quality, "1024x1024", 1);
      const rec = recordSpend(currentId, editSpend, 1, quality as "low" | "medium" | "high");
      setSessionState(rec.session);
      setProjectLifetime(rec.project);
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "assistant",
          text: `Edited ${asset.name || asset.prompt}.`,
          assetIds: [id],
        };
        return copy;
      });
      // Close the inline editor on success.
      setEditingAssetId(null);
      setEditPrompt("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", text: `Edit failed: ${msg}`, error: true };
        return copy;
      });
      void recordGenerationError(trimmed, msg);
    } finally {
      setEditingBusy(false);
    }
  }

  // ------------- scene composition -------------

  async function composeSceneFromAssets(
    sceneName: string,
    assetIds: string[],
    fresh: Record<string, Asset>,
    context?: "interior" | "exterior" | "aerial",
    failedItems?: Array<{ name: string; error: string }>
  ) {
    const items = assetIds.map((id) => fresh[id]?.prompt || "item");
    let layout: Array<{ name: string; x: number; y: number; scale: number; z: number }> = [];
    try {
      const res = await fetch("/api/scene-layout", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          sceneDescription: sceneName,
          items,
          width: 1024,
          height: 1024,
          context,
          projectMemory: getEffectiveProjectMemory() || undefined,
        }),
      });
      const data = await res.json();
      layout = data.items || [];
    } catch {
      // heuristic fallback handled server-side; if even that failed, do it here
      layout = items.map((name, i) => ({
        name,
        x: 200 + (i % 4) * 200,
        y: 200 + Math.floor(i / 4) * 200,
        scale: 0.2,
        z: i,
      }));
    }

    // Snap placements to the scene's tileGrid size (or 32 default) so
    // scenes feel composed, not random. This matches the floor-tile cells
    // about to be painted by ensureGroundLayer below.
    const TILE_SIZE = 32;
    const snap = (n: number) => Math.round(n / TILE_SIZE) * TILE_SIZE;

    // Items that visually "float" should anchor by their center, not their
    // base — otherwise a hanging lantern's cord would be pinned to the
    // ground line. Keyword-based detection over the prompt name.
    const FLOATING_KEYWORDS = [
      "lantern", "moon", "sun", "cloud", "balloon", "kite", "star",
      "bird", "bat", "ghost", "spirit", "fairy",
      "chandelier", "ceiling", "hanging", "floating",
    ];
    const isFloating = (name: string) => {
      const lower = name.toLowerCase();
      return FLOATING_KEYWORDS.some((kw) => lower.includes(kw));
    };

    const sceneItems: SceneItem[] = assetIds.map((assetId, i) => {
      const placement = layout[i] || layout.find((p) => p.name === fresh[assetId]?.prompt);
      const asset = fresh[assetId];
      const isMultiFrame = (asset.cols || 1) * (asset.rows || 1) > 1;
      const itemName = asset?.prompt || "";
      const anchor: SceneItem["anchor"] = isFloating(itemName) ? "center" : "bottom";
      return {
        id: crypto.randomUUID(),
        assetId,
        x: snap(placement?.x ?? 512),
        y: snap(placement?.y ?? 512),
        scale: placement?.scale ?? 0.2,
        z: placement?.z ?? i,
        animating: isMultiFrame,
        solid: defaultSolid(asset.assetType),
        // Composed scenes use bottom-anchor so cabins/trees/characters all
        // sit on the same ground line. Floating items (moons, lanterns,
        // birds) override to center so the y is read as their middle.
        anchor,
      };
    });

    const scene: Scene = {
      id: crypto.randomUUID(),
      name: sceneName,
      width: 1024,
      height: 1024,
      items: sceneItems,
      failedItems: failedItems && failedItems.length > 0 ? failedItems : undefined,
      createdAt: Date.now(),
    };

    setScenes((s) => ({ ...s, [scene.id]: scene }));
    setActiveSceneId(scene.id);
    setRightTab("scenes");
    setSelectedSceneItemIds([]);
    // Drop a default ground layer in immediately so the scene isn't a void.
    // Use the parser's context hint plus the scene-name keywords so a
    // wizard's potion shop gets stone, a kitchen gets wood, a forest grass.
    ensureGroundLayer(scene.id, context, sceneName);
  }

  function addAssetToScene(sceneId: string, assetId: string, x: number, y: number) {
    const a = assets[assetId];
    if (!a) return;
    updateScene(sceneId, (s) => {
      const maxZ = s.items.reduce((m, it) => Math.max(m, it.z), 0);
      const isMultiFrame = (a.cols || 1) * (a.rows || 1) > 1;
      // Match the scene's predominant anchor so dragged-in items don't
      // visually clash with composed-scene items. Tally bottom vs center
      // among existing non-kind items; tie or empty → leave undefined
      // (which renders as "center" — the legacy default).
      const realItems = s.items.filter((it) => !it.kind);
      const bottomCount = realItems.filter((it) => it.anchor === "bottom").length;
      const centerCount = realItems.length - bottomCount;
      const inferredAnchor: SceneItem["anchor"] | undefined =
        bottomCount > centerCount ? "bottom" : undefined;
      const newItem: SceneItem = {
        id: crypto.randomUUID(),
        assetId,
        x,
        y,
        scale: 0.2,
        z: maxZ + 1,
        animating: isMultiFrame,
        solid: defaultSolid(a.assetType),
        anchor: inferredAnchor,
      };
      return { ...s, items: [...s.items, newItem] };
    });
  }

  function toggleSceneItemSolid(sceneId: string, itemId: string) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) => (it.id === itemId ? { ...it, solid: !it.solid } : it)),
    }));
  }

  function toggleSceneItemFlipX(sceneId: string, itemId: string) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) => (it.id === itemId ? { ...it, flipX: !it.flipX } : it)),
    }));
  }

  function toggleSceneItemFlipY(sceneId: string, itemId: string) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) => (it.id === itemId ? { ...it, flipY: !it.flipY } : it)),
    }));
  }

  function toggleSceneItemPickable(sceneId: string, itemId: string) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) => (it.id === itemId ? { ...it, pickable: !it.pickable } : it)),
    }));
  }

  function toggleSceneItemAnchor(sceneId: string, itemId: string) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) =>
        it.id === itemId
          ? { ...it, anchor: it.anchor === "bottom" ? "center" : "bottom" }
          : it
      ),
    }));
  }

  function setSceneItemLinkScene(sceneId: string, itemId: string, linkSceneId: string | undefined) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) =>
        it.id === itemId ? { ...it, linkSceneId: linkSceneId || undefined } : it
      ),
    }));
  }

  function setSceneItemPatrol(
    sceneId: string,
    itemId: string,
    patrol: SceneItem["patrol"]
  ) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) => (it.id === itemId ? { ...it, patrol } : it)),
    }));
  }

  function setSceneItemTriggerMessage(sceneId: string, itemId: string, msg: string) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) =>
        it.id === itemId ? { ...it, triggerMessage: msg } : it
      ),
    }));
  }

  function setSceneItemDialogue(sceneId: string, itemId: string, dialogue: string) {
    const trimmed = dialogue.trim();
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) =>
        it.id === itemId ? { ...it, dialogue: trimmed || undefined } : it
      ),
    }));
  }

  function setSceneItemUseMessage(sceneId: string, itemId: string, msg: string) {
    const trimmed = msg.trim();
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) =>
        it.id === itemId ? { ...it, useMessage: trimmed || undefined } : it
      ),
    }));
  }

  function setSceneItemUseStateAssetId(
    sceneId: string,
    itemId: string,
    altAssetId: string | undefined
  ) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) =>
        it.id === itemId
          ? { ...it, useStateAssetId: altAssetId || undefined }
          : it
      ),
    }));
  }

  // ------------- tile-grid mutators ------------------------------------

  function ensureTileGrid(s: Scene): TileGrid {
    if (s.tileGrid) return s.tileGrid;
    return { tileSize: 32, layers: [] };
  }

  function addTileLayer(sceneId: string, tileAssetId?: string) {
    updateScene(sceneId, (s) => {
      const tg = ensureTileGrid(s);
      const layer: TileLayer = {
        id: crypto.randomUUID(),
        name: `Layer ${tg.layers.length + 1}`,
        tileAssetId: tileAssetId || "",
        cells: [],
        visible: true,
      };
      return { ...s, tileGrid: { ...tg, layers: [...tg.layers, layer] } };
    });
  }

  function removeTileLayer(sceneId: string, layerId: string) {
    updateScene(sceneId, (s) => {
      if (!s.tileGrid) return s;
      const layers = s.tileGrid.layers.filter((l) => l.id !== layerId);
      return { ...s, tileGrid: { ...s.tileGrid, layers } };
    });
  }

  function renameTileLayer(sceneId: string, layerId: string, name: string) {
    updateScene(sceneId, (s) => {
      if (!s.tileGrid) return s;
      const layers = s.tileGrid.layers.map((l) =>
        l.id === layerId ? { ...l, name } : l
      );
      return { ...s, tileGrid: { ...s.tileGrid, layers } };
    });
  }

  function setLayerTileAsset(sceneId: string, layerId: string, tileAssetId: string) {
    updateScene(sceneId, (s) => {
      if (!s.tileGrid) return s;
      const layers = s.tileGrid.layers.map((l) =>
        l.id === layerId ? { ...l, tileAssetId } : l
      );
      return { ...s, tileGrid: { ...s.tileGrid, layers } };
    });
  }

  function toggleLayerVisible(sceneId: string, layerId: string) {
    updateScene(sceneId, (s) => {
      if (!s.tileGrid) return s;
      const layers = s.tileGrid.layers.map((l) =>
        l.id === layerId ? { ...l, visible: !l.visible } : l
      );
      return { ...s, tileGrid: { ...s.tileGrid, layers } };
    });
  }

  function reorderTileLayers(sceneId: string, fromIdx: number, toIdx: number) {
    updateScene(sceneId, (s) => {
      if (!s.tileGrid) return s;
      const layers = [...s.tileGrid.layers];
      if (fromIdx < 0 || fromIdx >= layers.length || toIdx < 0 || toIdx >= layers.length) return s;
      const [moved] = layers.splice(fromIdx, 1);
      layers.splice(toIdx, 0, moved);
      return { ...s, tileGrid: { ...s.tileGrid, layers } };
    });
  }

  function paintTileCell(sceneId: string, layerId: string, x: number, y: number) {
    updateScene(sceneId, (s) => {
      if (!s.tileGrid) return s;
      const layers = s.tileGrid.layers.map((l) => {
        if (l.id !== layerId) return l;
        if (l.cells.some((c) => c.x === x && c.y === y)) return l;
        return { ...l, cells: [...l.cells, { x, y }] };
      });
      return { ...s, tileGrid: { ...s.tileGrid, layers } };
    });
  }

  function eraseTileCell(sceneId: string, layerId: string, x: number, y: number) {
    updateScene(sceneId, (s) => {
      if (!s.tileGrid) return s;
      const layers = s.tileGrid.layers.map((l) => {
        if (l.id !== layerId) return l;
        const filtered = l.cells.filter((c) => !(c.x === x && c.y === y));
        if (filtered.length === l.cells.length) return l;
        return { ...l, cells: filtered };
      });
      return { ...s, tileGrid: { ...s.tileGrid, layers } };
    });
  }

  function fillTileRect(
    sceneId: string,
    layerId: string,
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ) {
    updateScene(sceneId, (s) => {
      if (!s.tileGrid) return s;
      const xa = Math.min(x0, x1);
      const xb = Math.max(x0, x1);
      const ya = Math.min(y0, y1);
      const yb = Math.max(y0, y1);
      const layers = s.tileGrid.layers.map((l) => {
        if (l.id !== layerId) return l;
        // Build a Set of "x,y" keys we already have; add any missing cells.
        const have = new Set(l.cells.map((c) => `${c.x},${c.y}`));
        const next = [...l.cells];
        for (let y = ya; y <= yb; y++) {
          for (let x = xa; x <= xb; x++) {
            const k = `${x},${y}`;
            if (!have.has(k)) {
              have.add(k);
              next.push({ x, y });
            }
          }
        }
        return { ...l, cells: next };
      });
      return { ...s, tileGrid: { ...s.tileGrid, layers } };
    });
  }

  function fillTileLayer(sceneId: string, layerId: string) {
    updateScene(sceneId, (s) => {
      if (!s.tileGrid) return s;
      const ts = s.tileGrid.tileSize;
      const cols = Math.ceil(s.width / ts);
      const rows = Math.ceil(s.height / ts);
      const cells: Array<{ x: number; y: number }> = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) cells.push({ x, y });
      }
      const layers = s.tileGrid.layers.map((l) =>
        l.id === layerId ? { ...l, cells } : l
      );
      return { ...s, tileGrid: { ...s.tileGrid, layers } };
    });
  }

  // ------------- prefab mutators ----------------------------------------

  function savePrefab(name: string, sourceItems: SceneItem[]) {
    if (sourceItems.length === 0 || !currentId) return;
    const prefabId = crypto.randomUUID();
    const items: SceneItem[] = sourceItems.map((it) => {
      // Each master item gets a stable internal id (different from the scene
      // instance id so future regenerations don't collide).
      const sourceId = crypto.randomUUID();
      return { ...it, id: sourceId, prefabId, prefabSourceId: sourceId };
    });
    const prefab: Prefab = { id: prefabId, name, items, createdAt: Date.now() };
    setProjects((p) => {
      const cur = p[currentId];
      if (!cur) return p;
      const prefabs = { ...(cur.prefabs || {}), [prefabId]: prefab };
      return { ...p, [currentId]: { ...cur, prefabs } };
    });
  }

  function deletePrefab(prefabId: string) {
    setProjects((p) => {
      const cur = p[currentId];
      if (!cur || !cur.prefabs) return p;
      const { [prefabId]: _drop, ...rest } = cur.prefabs;
      return { ...p, [currentId]: { ...cur, prefabs: rest } };
    });
  }

  function instantiatePrefab(sceneId: string, prefabId: string, dropX: number, dropY: number) {
    const cur = projects[currentId];
    const prefab = cur?.prefabs?.[prefabId];
    if (!prefab) return;
    // Center the prefab's bbox on the drop point.
    const xs = prefab.items.map((it) => it.x);
    const ys = prefab.items.map((it) => it.y);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const dx = dropX - cx;
    const dy = dropY - cy;
    updateScene(sceneId, (s) => {
      const maxZ = s.items.reduce((m, it) => Math.max(m, it.z), 0);
      const newItems: SceneItem[] = prefab.items.map((master, i) => ({
        ...master,
        id: crypto.randomUUID(),
        x: master.x + dx,
        y: master.y + dy,
        z: maxZ + 1 + i,
        prefabId: prefab.id,
        prefabSourceId: master.id,
      }));
      return { ...s, items: [...s.items, ...newItems] };
    });
  }

  /** Pull non-position fields from a prefab master into all instances. */
  function syncPrefabInstances(prefabId: string) {
    const cur = projects[currentId];
    const prefab = cur?.prefabs?.[prefabId];
    if (!prefab) return;
    const masterById = new Map(prefab.items.map((m) => [m.id, m]));
    setProjects((p) => {
      const c = p[currentId];
      if (!c) return p;
      const newScenes: Record<string, Scene> = {};
      for (const [sid, scene] of Object.entries(c.scenes)) {
        let mutated = false;
        const newItems = scene.items.map((it) => {
          if (it.prefabId !== prefabId || !it.prefabSourceId) return it;
          const master = masterById.get(it.prefabSourceId);
          if (!master) return it;
          mutated = true;
          // Keep position, z, and id; pull everything else from master.
          return {
            ...master,
            id: it.id,
            x: it.x,
            y: it.y,
            z: it.z,
            prefabId,
            prefabSourceId: it.prefabSourceId,
          };
        });
        newScenes[sid] = mutated ? { ...scene, items: newItems } : scene;
      }
      return { ...p, [currentId]: { ...c, scenes: newScenes } };
    });
  }

  function setTileSize(sceneId: string, tileSize: number) {
    updateScene(sceneId, (s) => {
      const tg = ensureTileGrid(s);
      return { ...s, tileGrid: { ...tg, tileSize } };
    });
  }

  function addPointLight(sceneId: string) {
    updateScene(sceneId, (s) => {
      const maxZ = s.items.reduce((m, it) => Math.max(m, it.z), 0);
      const item: SceneItem = {
        id: crypto.randomUUID(),
        assetId: "",
        x: s.width / 2,
        y: s.height / 2,
        scale: 0.18,
        z: maxZ + 1,
        kind: "light",
        light: { radius: 200, color: "#ffd47a", intensity: 0.7 },
      };
      return { ...s, items: [...s.items, item] };
    });
  }

  function setSceneItemLight(sceneId: string, itemId: string, light: SceneItem["light"]) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) => (it.id === itemId ? { ...it, light } : it)),
    }));
  }

  function addParticleEmitter(sceneId: string) {
    updateScene(sceneId, (s) => {
      const maxZ = s.items.reduce((m, it) => Math.max(m, it.z), 0);
      const item: SceneItem = {
        id: crypto.randomUUID(),
        assetId: "",
        x: s.width / 2,
        y: s.height / 2,
        scale: 0.12,
        z: maxZ + 1,
        kind: "emitter",
        emitter: { kind: "sparkle", rate: 4, lifetime: 1.5 },
      };
      return { ...s, items: [...s.items, item] };
    });
  }

  function setSceneItemEmitter(sceneId: string, itemId: string, emitter: SceneItem["emitter"]) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) => (it.id === itemId ? { ...it, emitter } : it)),
    }));
  }

  function addSoundTrigger(sceneId: string) {
    updateScene(sceneId, (s) => {
      const maxZ = s.items.reduce((m, it) => Math.max(m, it.z), 0);
      const item: SceneItem = {
        id: crypto.randomUUID(),
        assetId: "",
        x: s.width / 2,
        y: s.height / 2,
        scale: 0.15,
        z: maxZ + 1,
        kind: "sound",
        sound: { url: "", volume: 0.6, loop: false },
      };
      return { ...s, items: [...s.items, item] };
    });
  }

  function setSceneItemSound(sceneId: string, itemId: string, sound: SceneItem["sound"]) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) => (it.id === itemId ? { ...it, sound } : it)),
    }));
  }

  function setSceneDaytime(sceneId: string, daytime: number) {
    updateScene(sceneId, (s) => ({ ...s, daytime }), { record: false });
  }

  function addTriggerZone(sceneId: string) {
    updateScene(sceneId, (s) => {
      const maxZ = s.items.reduce((m, it) => Math.max(m, it.z), 0);
      const item: SceneItem = {
        id: crypto.randomUUID(),
        // Trigger zones don't render an asset, but we keep an empty assetId
        // for type compatibility — the kind/triggerMessage flag is what matters.
        assetId: "",
        x: s.width / 2,
        y: s.height / 2,
        scale: 0.18,
        z: maxZ + 1,
        kind: "trigger",
        triggerMessage: "Hello!",
      };
      return { ...s, items: [...s.items, item] };
    });
  }

  function clearSceneBackground(sceneId: string) {
    updateScene(sceneId, (s) => ({ ...s, backgroundTileId: undefined }));
  }

  function setSceneItemPos(sceneId: string, itemId: string, x: number, y: number) {
    // Skip history — position writebacks from Play Mode fire frequently and
    // shouldn't blow out the undo stack.
    updateScene(
      sceneId,
      (s) => ({
        ...s,
        items: s.items.map((it) => (it.id === itemId ? { ...it, x, y } : it)),
      }),
      { record: false }
    );
  }

  function rotateSceneItem(sceneId: string, itemId: string, deg: number) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) =>
        it.id === itemId ? { ...it, rotation: deg } : it
      ),
    }));
  }

  function moveSceneItems(
    sceneId: string,
    updates: Array<{ id: string; x: number; y: number }>
  ) {
    const map = new Map(updates.map((u) => [u.id, u]));
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) => {
        const u = map.get(it.id);
        return u ? { ...it, x: u.x, y: u.y } : it;
      }),
    }));
  }

  function moveSceneItem(sceneId: string, itemId: string, x: number, y: number) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) => (it.id === itemId ? { ...it, x, y } : it)),
    }));
  }

  function updateSceneItemScale(sceneId: string, itemId: string, scale: number) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) => (it.id === itemId ? { ...it, scale } : it)),
    }));
  }

  function bumpSceneItemZ(sceneId: string, itemId: string, delta: number) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) => (it.id === itemId ? { ...it, z: it.z + delta } : it)),
    }));
  }

  function toggleSceneItemAnimating(sceneId: string, itemId: string) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) =>
        it.id === itemId ? { ...it, animating: !it.animating } : it
      ),
    }));
  }

  /** Make sure the project has a tile asset usable for ground; create a
   *  procedural grass tile if there isn't one yet. Returns the tile asset id. */
  function ensureGroundTileAssetId(
    kind: "grass" | "wood" | "stone" = "grass"
  ): string {
    const labels = {
      grass: "grass (default)",
      wood: "wood floor (default)",
      stone: "stone floor (default)",
    } as const;
    const label = labels[kind];
    const existing = Object.values(assets).find(
      (a) => a.assetType === "tile" && a.name === label
    );
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    const url =
      kind === "wood"
        ? makeWoodFloorTileDataUrl()
        : kind === "stone"
        ? makeStoneFloorTileDataUrl()
        : makeGrassTileDataUrl();
    const tile: Asset = {
      id,
      prompt: `default ${kind} tile`,
      name: label,
      assetType: "tile",
      perspective: "top-down",
      pose: "single",
      rawUrl: url,
      pixelUrl: url,
      gridSize: 0,
      sourceSize: "32x32",
      cols: 1,
      rows: 1,
      createdAt: Date.now(),
    };
    setAssets((a) => ({ ...a, [id]: tile }));
    return id;
  }

  /** Add a fully-painted "Ground" tile layer to a scene if it doesn't have
   *  one yet. Called when scenes are created so they're never empty.
   *  Picks tile by context first (interior → wood/stone, aerial/exterior
   *  → grass) and refines via keyword match on the scene name when the
   *  basic context is too coarse (e.g. "wizard's potion shop" → stone). */
  function ensureGroundLayer(
    sceneId: string,
    context?: "interior" | "exterior" | "aerial",
    sceneNameHint?: string
  ) {
    const lower = (sceneNameHint || "").toLowerCase();
    const STONE_KEYWORDS = [
      "stone", "dungeon", "castle", "vault", "crypt", "cathedral",
      "temple", "wizard", "witch", "alchemy", "potion shop",
      "shrine", "tomb",
    ];
    const WOOD_KEYWORDS = [
      "kitchen", "bedroom", "library", "study", "tavern", "inn",
      "cabin interior", "cottage interior", "house interior",
    ];
    let kind: "grass" | "wood" | "stone";
    if (STONE_KEYWORDS.some((kw) => lower.includes(kw))) {
      kind = "stone";
    } else if (context === "interior") {
      kind = WOOD_KEYWORDS.some((kw) => lower.includes(kw)) ? "wood" : "wood";
    } else {
      kind = "grass";
    }
    const tileAssetId = ensureGroundTileAssetId(kind);
    updateScene(
      sceneId,
      (s) => {
        if (s.tileGrid && s.tileGrid.layers.length > 0) return s;
        const tileSize = 32;
        const cols = Math.ceil(s.width / tileSize);
        const rows = Math.ceil(s.height / tileSize);
        const cells: Array<{ x: number; y: number }> = [];
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) cells.push({ x, y });
        }
        const layer: TileLayer = {
          id: crypto.randomUUID(),
          name: "Ground",
          tileAssetId,
          cells,
          visible: true,
        };
        return {
          ...s,
          tileGrid: { tileSize, layers: [layer] },
        };
      },
      { record: false }
    );
  }

  /** Make sure the active scene has a player character. Three cascading
   *  cases: (1) one is already placed, do nothing; (2) the project has a
   *  character asset — drop it at scene center; (3) no character asset
   *  anywhere — generate a procedural placeholder, register it, place it. */
  function ensurePlayerCharacter(): string | null {
    if (!activeScene) return null;
    // (1) already placed
    const placed = activeScene.items.find(
      (it) => assets[it.assetId]?.assetType === "character"
    );
    if (placed) return placed.id;

    // (2) any character asset in project
    let charAssetId =
      Object.values(assets).find((a) => a.assetType === "character")?.id;

    // (3) generate a procedural placeholder
    if (!charAssetId) {
      charAssetId = crypto.randomUUID();
      const url = makeDefaultCharacterDataUrl();
      const placeholder: Asset = {
        id: charAssetId,
        prompt: "default placeholder character",
        name: "player (default)",
        assetType: "character",
        perspective: "top-down",
        pose: "single",
        rawUrl: url,
        pixelUrl: url,
        gridSize: 0,
        sourceSize: "64x64",
        cols: 1,
        rows: 1,
        createdAt: Date.now(),
      };
      setAssets((a) => ({ ...a, [charAssetId!]: placeholder }));
    }

    const newItemId = crypto.randomUUID();
    updateScene(
      activeScene.id,
      (s) => {
        const maxZ = s.items.reduce((m, it) => Math.max(m, it.z), 0);
        const item: SceneItem = {
          id: newItemId,
          assetId: charAssetId!,
          x: Math.round(s.width / 2),
          y: Math.round(s.height / 2),
          scale: 0.1,
          z: maxZ + 1,
          animating: false,
          solid: false,
        };
        return { ...s, items: [...s.items, item] };
      },
      { record: false }
    );
    return newItemId;
  }

  function copySceneItems(itemIds: string[]) {
    if (!activeScene || itemIds.length === 0) return;
    const items = activeScene.items.filter((it) => itemIds.includes(it.id));
    if (items.length === 0) return;
    setSceneClipboard(items);
  }

  function pasteSceneItems() {
    if (!activeScene || sceneClipboard.length === 0) return;
    const sceneId = activeScene.id;
    updateScene(sceneId, (s) => {
      const baseZ = s.items.reduce((m, it) => Math.max(m, it.z), 0);
      const pasted: SceneItem[] = sceneClipboard.map((src, i) => ({
        ...src,
        id: crypto.randomUUID(),
        x: Math.min(s.width - 8, Math.max(8, src.x + 32)),
        y: Math.min(s.height - 8, Math.max(8, src.y + 32)),
        z: baseZ + 1 + i,
      }));
      return { ...s, items: [...s.items, ...pasted] };
    });
    // Bounded set; this is fine.
    setSelectedSceneItemIds([]);
  }

  function duplicateSceneItem(sceneId: string, itemId: string) {
    updateScene(sceneId, (s) => {
      const orig = s.items.find((it) => it.id === itemId);
      if (!orig) return s;
      const maxZ = s.items.reduce((m, it) => Math.max(m, it.z), 0);
      const dup: SceneItem = {
        ...orig,
        id: crypto.randomUUID(),
        x: Math.min(s.width, orig.x + 32),
        y: Math.min(s.height, orig.y + 32),
        z: maxZ + 1,
      };
      return { ...s, items: [...s.items, dup] };
    });
  }

  function reorderSceneItems(sceneId: string, fromIdx: number, toIdx: number) {
    updateScene(sceneId, (s) => {
      // The list is presented in z-descending order (front-first), but items
      // store an absolute z. To reorder, we rebuild contiguous z-values.
      const sorted = [...s.items].sort((a, b) => b.z - a.z);
      if (fromIdx < 0 || fromIdx >= sorted.length || toIdx < 0 || toIdx >= sorted.length) return s;
      const [moved] = sorted.splice(fromIdx, 1);
      sorted.splice(toIdx, 0, moved);
      // Reassign z so highest list-index = 0 (back), lowest index = N-1 (front).
      const N = sorted.length;
      const renumbered = sorted.map((it, i) => ({ ...it, z: N - 1 - i }));
      return { ...s, items: renumbered };
    });
  }

  function deleteSceneItem(sceneId: string, itemId: string) {
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.filter((it) => it.id !== itemId),
    }));
    setSelectedSceneItemIds((cur) => cur.filter((id) => id !== itemId));
  }

  function deleteScene(sceneId: string) {
    setScenes((s) => {
      const { [sceneId]: _drop, ...rest } = s;
      return rest;
    });
    if (activeSceneId === sceneId) setActiveSceneId(null);
  }

  function duplicateScene(sceneId: string) {
    const src = scenes[sceneId];
    if (!src) return;
    const newId = crypto.randomUUID();
    // Items get fresh ids but keep assetIds and all other fields. Tile-grid
    // layers also get fresh ids so multi-layer reordering doesn't collide.
    const newItems: SceneItem[] = src.items.map((it) => ({
      ...it,
      id: crypto.randomUUID(),
    }));
    const newTileGrid: TileGrid | undefined = src.tileGrid
      ? {
          tileSize: src.tileGrid.tileSize,
          layers: src.tileGrid.layers.map((l) => ({ ...l, id: crypto.randomUUID() })),
        }
      : undefined;
    const copy: Scene = {
      ...src,
      id: newId,
      name: `${src.name} (copy)`,
      items: newItems,
      tileGrid: newTileGrid,
      // Don't carry forward the failed-items badge from the original.
      failedItems: undefined,
      createdAt: Date.now(),
    };
    setScenes((s) => ({ ...s, [newId]: copy }));
    setActiveSceneId(newId);
    setSelectedSceneItemIds([]);
  }

  function renameScene(sceneId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    updateScene(sceneId, (s) => ({ ...s, name: trimmed }), { record: false });
  }

  async function replaceSceneItem(
    sceneId: string,
    item: SceneItem,
    newPrompt: string
  ) {
    if (!newPrompt.trim()) return;
    const oldAsset = assets[item.assetId];
    if (!oldAsset) return;

    const referenceUrls: string[] = [];
    if (projectStyle.refUrl) referenceUrls.push(projectStyle.refUrl);

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        prompt: newPrompt,
        assetType: oldAsset.assetType,
        perspective: oldAsset.perspective,
        pose: "single",
        quality,
        variants: 1,
        referenceUrls,
        projectStyle: projectStyle.text || undefined,
        stylePreset: projectStyle.preset,
        projectMemory: getEffectiveProjectMemory() || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Replace failed: ${data.error || res.status}`);
      return;
    }
    const url = (data.urls as string[])[0];
    const sourceSize: string = data.size || "1024x1024";
    const cols: number = data.cols || 1;
    const rows: number = data.rows || 1;
    const pixelUrl = await applyPixelate(url, gridSize, sourceSize);
    const newAssetId = crypto.randomUUID();
    setAssets((a) => ({
      ...a,
      [newAssetId]: {
        id: newAssetId,
        prompt: newPrompt,
        assetType: oldAsset.assetType,
        perspective: oldAsset.perspective,
        pose: "single",
        rawUrl: url,
        pixelUrl,
        gridSize,
        sourceSize,
        cols,
        rows,
        createdAt: Date.now(),
      },
    }));
    updateScene(sceneId, (s) => ({
      ...s,
      items: s.items.map((it) => (it.id === item.id ? { ...it, assetId: newAssetId } : it)),
    }));
    const rec = recordSpend(currentId, estimateImageCost(quality, "1024x1024", 1), 1, quality as "low" | "medium" | "high");
    setSessionState(rec.session);
    setProjectLifetime(rec.project);
  }

  async function exportScene(sceneId: string) {
    const s = scenes[sceneId];
    if (!s) return;
    const assetsById = assets;

    // Composite render to a single canvas at scene resolution.
    const canvas = document.createElement("canvas");
    canvas.width = s.width;
    canvas.height = s.height;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // Painted tile layers (below items).
    if (s.tileGrid) {
      const ts = s.tileGrid.tileSize;
      for (const layer of s.tileGrid.layers) {
        if (!layer.visible) continue;
        const ta = assetsById[layer.tileAssetId];
        if (!ta) continue;
        const tileImg = await loadImg(ta.pixelUrl);
        for (const c of layer.cells) {
          ctx.drawImage(tileImg, c.x * ts, c.y * ts, ts, ts);
        }
      }
    }

    // Background tile if any.
    if (s.backgroundTileId) {
      const bg = assetsById[s.backgroundTileId];
      if (bg) {
        const bgImg = await loadImg(bg.pixelUrl);
        const tileSize = Math.round(s.width / 8);
        const pattern = ctx.createPattern(bgImg, "repeat");
        if (pattern) {
          ctx.save();
          ctx.scale(tileSize / bgImg.naturalWidth, tileSize / bgImg.naturalHeight);
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, s.width / (tileSize / bgImg.naturalWidth), s.height / (tileSize / bgImg.naturalHeight));
          ctx.restore();
        }
      }
    }

    // Sort by z, draw each item.
    const longest = Math.max(s.width, s.height);
    const sorted = [...s.items].sort((a, b) => a.z - b.z);
    for (const it of sorted) {
      const a = assetsById[it.assetId];
      if (!a) continue;
      const img = await loadImg(a.pixelUrl);
      const w = it.scale * longest;
      const aspect = img.naturalWidth / img.naturalHeight;
      const h = w / aspect;
      drawWithFlip(ctx, img, it.x, it.y, w, h, it.flipX, it.flipY, it.rotation, it.anchor);
    }

    const compositeDataUrl = canvas.toDataURL("image/png");

    // Build the JSON manifest.
    const manifest = {
      name: s.name,
      width: s.width,
      height: s.height,
      tileGrid: s.tileGrid || null,
      items: sorted.map((it) => {
        const a = assetsById[it.assetId];
        return {
          id: it.id,
          asset_filename: a ? `assets/${a.assetType}-${a.id.slice(0, 8)}.png` : null,
          asset_prompt: a?.prompt,
          x: Math.round(it.x),
          y: Math.round(it.y),
          scale: it.scale,
          z: it.z,
          animating: it.animating || false,
          flipX: it.flipX || false,
          flipY: it.flipY || false,
          rotation: it.rotation || 0,
          pickable: it.pickable || false,
          linkSceneId: it.linkSceneId || null,
          patrol: it.patrol || null,
          kind: it.kind || null,
          triggerMessage: it.triggerMessage || null,
          light: it.light || null,
          emitter: it.emitter || null,
          sound: it.sound || null,
          prefabId: it.prefabId || null,
          prefabSourceId: it.prefabSourceId || null,
          cols: a?.cols || 1,
          rows: a?.rows || 1,
        };
      }),
    };

    // Zip everything.
    const zip = new JSZip();
    zip.file(`${slugify(s.name)}-composite.png`, dataUrlToBytes(compositeDataUrl));
    zip.file(`${slugify(s.name)}-scene.json`, JSON.stringify(manifest, null, 2));
    const seenAssets = new Set<string>();
    for (const it of sorted) {
      const a = assetsById[it.assetId];
      if (!a || seenAssets.has(a.id)) continue;
      seenAssets.add(a.id);
      zip.file(`assets/${a.assetType}-${a.id.slice(0, 8)}.png`, dataUrlToBytes(a.rawUrl));
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(s.name)}-scene.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportTiledJson(sceneId: string) {
    const s = scenes[sceneId];
    if (!s) return;

    const tileSize = s.tileGrid?.tileSize ?? 32;
    const mapW = Math.ceil(s.width / tileSize);
    const mapH = Math.ceil(s.height / tileSize);
    const longest = Math.max(s.width, s.height);

    const layers: object[] = [];
    let nextLayerId = 1;
    let nextObjectId = 1;

    // One tilelayer per tile-grid layer.
    if (s.tileGrid) {
      for (const layer of s.tileGrid.layers) {
        const data = new Array<number>(mapW * mapH).fill(0);
        for (const cell of layer.cells) {
          if (cell.x >= 0 && cell.x < mapW && cell.y >= 0 && cell.y < mapH) {
            data[cell.y * mapW + cell.x] = 1;
          }
        }
        layers.push({
          type: "tilelayer",
          id: nextLayerId++,
          name: layer.name,
          width: mapW,
          height: mapH,
          x: 0,
          y: 0,
          visible: layer.visible,
          opacity: 1,
          data,
        });
      }
    }

    // One objectgroup for non-tile scene items.
    const objects: object[] = [];
    for (const it of s.items) {
      const a = assets[it.assetId];
      const itemSize = Math.round(it.scale * longest);
      const objX = Math.round(it.x - itemSize / 2);
      const objY = it.anchor === "bottom"
        ? Math.round(it.y - itemSize)
        : Math.round(it.y - itemSize / 2);
      objects.push({
        id: nextObjectId++,
        x: objX,
        y: objY,
        width: itemSize,
        height: itemSize,
        name: a?.name || (a?.prompt ?? "").slice(0, 40) || it.id.slice(0, 8),
        type: a?.assetType || it.kind || "unknown",
        rotation: it.rotation ?? 0,
        visible: true,
      });
    }
    if (objects.length > 0) {
      layers.push({
        type: "objectgroup",
        id: nextLayerId++,
        name: "Items",
        x: 0,
        y: 0,
        visible: true,
        opacity: 1,
        objects,
      });
    }

    const map = {
      tiledversion: "1.10.0",
      type: "map",
      orientation: "orthogonal",
      renderorder: "right-down",
      infinite: false,
      width: mapW,
      height: mapH,
      tilewidth: tileSize,
      tileheight: tileSize,
      nextlayerid: nextLayerId,
      nextobjectid: nextObjectId,
      layers,
    };

    const blob = new Blob([JSON.stringify(map, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(s.name)}.tmj`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function buildProjectZipBlob(): Promise<{ blob: Blob; slug: string } | null> {
    const project = projects[currentId];
    if (!project) return null;
    const zip = new JSZip();
    const projectSlug = slugify(project.name);

    // Top-level project manifest.
    const manifest = {
      name: project.name,
      style: project.style,
      memory: project.memory,
      assetCount: Object.keys(project.assets).length,
      sceneCount: Object.keys(project.scenes).length,
      recipeCount: project.recipes ? Object.keys(project.recipes).length : 0,
      exportedAt: new Date().toISOString(),
    };
    zip.file(`${projectSlug}.project.json`, JSON.stringify(manifest, null, 2));

    // Recipes — Hermes-style portable skill bundles. Stripped of `id` so
    // re-importing into the same project doesn't dedupe by id; importer
    // re-allocates fresh ids.
    if (project.recipes) {
      const recipeIndex = Object.values(project.recipes).map((r) => {
        const { id: _drop, ...rest } = r;
        return rest;
      });
      if (recipeIndex.length > 0) {
        zip.file(`recipes.json`, JSON.stringify(recipeIndex, null, 2));
      }
    }

    // Every asset as a PNG, plus a parallel .json with metadata (prompt, tags,
    // pose, type, etc.) so downstream tools can index them.
    const assetIndex: Array<Record<string, unknown>> = [];
    const atlas: Array<Record<string, unknown>> = [];
    for (const asset of Object.values(project.assets)) {
      const fileName = `${asset.assetType}-${asset.id.slice(0, 8)}.png`;
      zip.file(`assets/${fileName}`, dataUrlToBytes(asset.rawUrl));
      assetIndex.push({
        id: asset.id,
        file: `assets/${fileName}`,
        name: asset.name || asset.prompt,
        prompt: asset.prompt,
        type: asset.assetType,
        perspective: asset.perspective,
        pose: asset.pose,
        cols: asset.cols,
        rows: asset.rows,
        sourceSize: asset.sourceSize,
        tags: asset.tags || [],
        createdAt: asset.createdAt,
      });
      const cols = asset.cols || 1;
      const rows = asset.rows || 1;
      const [imgW, imgH] = parseSize(asset.sourceSize);
      const isCharacter = asset.assetType === "character" || asset.assetType === "creature";
      atlas.push({
        assetId: asset.id,
        name: asset.name || asset.prompt,
        assetType: asset.assetType,
        file: `assets/${fileName}`,
        frameWidth: Math.round(imgW / cols),
        frameHeight: Math.round(imgH / rows),
        cols,
        rows,
        pivotX: 0.5,
        pivotY: isCharacter ? 1.0 : 0.5,
      });
    }
    zip.file(`assets.index.json`, JSON.stringify(assetIndex, null, 2));
    zip.file(`atlas.json`, JSON.stringify(atlas, null, 2));

    // Each scene with its composite + manifest, referencing the existing
    // assets/ folder (no duplicate PNGs).
    for (const scene of Object.values(project.scenes)) {
      const sceneSlug = slugify(scene.name);
      const sorted = [...scene.items].sort((a, b) => a.z - b.z);

      // Composite render.
      const canvas = document.createElement("canvas");
      canvas.width = scene.width;
      canvas.height = scene.height;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      // Painted tile layers (below items).
      if (scene.tileGrid) {
        const ts = scene.tileGrid.tileSize;
        for (const layer of scene.tileGrid.layers) {
          if (!layer.visible) continue;
          const ta = project.assets[layer.tileAssetId];
          if (!ta) continue;
          const tileImg = await loadImg(ta.pixelUrl);
          for (const c of layer.cells) {
            ctx.drawImage(tileImg, c.x * ts, c.y * ts, ts, ts);
          }
        }
      }
      if (scene.backgroundTileId) {
        const bg = project.assets[scene.backgroundTileId];
        if (bg) {
          const bgImg = await loadImg(bg.pixelUrl);
          const tileSize = Math.round(scene.width / 8);
          const pattern = ctx.createPattern(bgImg, "repeat");
          if (pattern) {
            ctx.save();
            ctx.scale(tileSize / bgImg.naturalWidth, tileSize / bgImg.naturalHeight);
            ctx.fillStyle = pattern;
            ctx.fillRect(
              0,
              0,
              scene.width / (tileSize / bgImg.naturalWidth),
              scene.height / (tileSize / bgImg.naturalHeight)
            );
            ctx.restore();
          }
        }
      }
      const longest = Math.max(scene.width, scene.height);
      for (const it of sorted) {
        const a = project.assets[it.assetId];
        if (!a) continue;
        const img = await loadImg(a.pixelUrl);
        const w = it.scale * longest;
        const aspect = img.naturalWidth / img.naturalHeight;
        const h = w / aspect;
        drawWithFlip(ctx, img, it.x, it.y, w, h, it.flipX, it.flipY, it.rotation, it.anchor);
      }
      const compositeUrl = canvas.toDataURL("image/png");
      zip.file(`scenes/${sceneSlug}.composite.png`, dataUrlToBytes(compositeUrl));

      const sceneManifest = {
        name: scene.name,
        width: scene.width,
        height: scene.height,
        backgroundTile: scene.backgroundTileId
          ? `assets/${project.assets[scene.backgroundTileId]?.assetType}-${scene.backgroundTileId.slice(0, 8)}.png`
          : null,
        tileGrid: scene.tileGrid || null,
        items: sorted.map((it) => {
          const a = project.assets[it.assetId];
          return {
            id: it.id,
            asset_filename: a ? `assets/${a.assetType}-${a.id.slice(0, 8)}.png` : null,
            asset_name: a?.name || a?.prompt,
            x: Math.round(it.x),
            y: Math.round(it.y),
            scale: it.scale,
            z: it.z,
            animating: it.animating || false,
            flipX: it.flipX || false,
            flipY: it.flipY || false,
            rotation: it.rotation || 0,
            pickable: it.pickable || false,
            linkSceneId: it.linkSceneId || null,
            patrol: it.patrol || null,
            kind: it.kind || null,
            triggerMessage: it.triggerMessage || null,
            light: it.light || null,
            emitter: it.emitter || null,
            sound: it.sound || null,
            prefabId: it.prefabId || null,
            prefabSourceId: it.prefabSourceId || null,
            cols: a?.cols || 1,
            rows: a?.rows || 1,
          };
        }),
      };
      zip.file(`scenes/${sceneSlug}.scene.json`, JSON.stringify(sceneManifest, null, 2));
    }

    const blob = await zip.generateAsync({ type: "blob" });
    return { blob, slug: projectSlug };
  }

  async function exportProject() {
    const built = await buildProjectZipBlob();
    if (!built) return;
    const url = URL.createObjectURL(built.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${built.slug}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Builds the project zip in the browser, POSTs it as multipart/form-data
   *  to /api/share, and copies the returned public URL to the clipboard. */
  async function shareProject() {
    const built = await buildProjectZipBlob();
    if (!built) return;
    const form = new FormData();
    form.append("file", built.blob, `${built.slug}.zip`);
    let res: Response;
    try {
      res = await fetch("/api/share", { method: "POST", body: form });
    } catch (err) {
      alert(`Couldn't reach share endpoint: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      alert(data.error || `Share failed (HTTP ${res.status})`);
      return;
    }
    const data = (await res.json()) as { url: string; id: string };
    try {
      await navigator.clipboard.writeText(data.url);
      setShareToast("Link copied!");
    } catch {
      setShareToast(`Share link: ${data.url}`);
    }
    setTimeout(() => setShareToast(null), 3000);
  }

  /** Inverse of exportProject. Reads a `.zip` produced by Export and creates
   *  a new Project record with fresh ids (so re-importing the same zip never
   *  collides). Maps old asset/scene ids to the new ones in the items'
   *  assetId, linkSceneId, tileGrid.layers[].tileAssetId, and
   *  backgroundTileId fields. */
  async function importProject(file: File) {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (err) {
      alert(`Couldn't read zip: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const indexFile = zip.file("assets.index.json");
    if (!indexFile) {
      alert("This zip doesn't have assets.index.json — is it a Pixel Play export?");
      return;
    }
    type IndexEntry = {
      id: string;
      file: string;
      name?: string;
      prompt?: string;
      type?: string;
      perspective?: string;
      pose?: string;
      cols?: number;
      rows?: number;
      sourceSize?: string;
      tags?: string[];
      createdAt?: number;
    };
    const indexJson = await indexFile.async("string");
    let assetIndex: IndexEntry[];
    try {
      assetIndex = JSON.parse(indexJson) as IndexEntry[];
      if (!Array.isArray(assetIndex)) throw new Error("not an array");
    } catch {
      alert("assets.index.json is malformed");
      return;
    }

    // Project name — pulled from the first *.project.json if present.
    const projectFiles = Object.keys(zip.files).filter((p) => p.endsWith(".project.json"));
    let projectName = "Imported";
    if (projectFiles.length > 0) {
      try {
        const m = JSON.parse(await zip.file(projectFiles[0])!.async("string"));
        if (typeof m.name === "string" && m.name.trim()) projectName = m.name;
      } catch { /* keep default */ }
    }

    // Build assets: load each PNG → data URL, allocate fresh ids, build
    // both `oldId → newId` and `filename → newId` maps for later wiring.
    const newAssets: Record<string, Asset> = {};
    const oldIdToNewId = new Map<string, string>();
    const filenameToNewId = new Map<string, string>();
    for (const entry of assetIndex) {
      const f = zip.file(entry.file);
      if (!f) continue;
      const blob = await f.async("blob");
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const newId = crypto.randomUUID();
      const validTypes: AssetType[] = ["character", "item", "tile", "building", "creature", "ui"];
      const assetType: AssetType = validTypes.includes(entry.type as AssetType)
        ? (entry.type as AssetType)
        : "item";
      newAssets[newId] = {
        id: newId,
        prompt: entry.prompt || entry.name || "imported",
        name: entry.name,
        assetType,
        perspective: (entry.perspective === "side-view" ? "side-view" : "top-down") as Perspective,
        pose: (["single", "directions", "walk-cycle", "full-sheet"].includes(entry.pose || "")
          ? (entry.pose as Pose)
          : "single"),
        rawUrl: dataUrl,
        // No re-pixelate — use the raw both as raw and pixel; export already
        // captured the pixelated version on the rawUrl path so this matches
        // what the user originally saw.
        pixelUrl: dataUrl,
        gridSize: 0,
        sourceSize: entry.sourceSize || "1024x1024",
        cols: entry.cols || 1,
        rows: entry.rows || 1,
        tags: entry.tags || [],
        createdAt: entry.createdAt || Date.now(),
      };
      oldIdToNewId.set(entry.id, newId);
      filenameToNewId.set(entry.file, newId);
    }

    // Build scenes. Two-pass: first allocate fresh scene ids; second pass
    // wires items + tileGrid + backgroundTileId + cross-scene linkSceneId.
    type SceneManifestItem = Record<string, unknown> & {
      asset_filename?: string | null;
      linkSceneId?: string | null;
    };
    type SceneManifest = {
      name?: string;
      width?: number;
      height?: number;
      daytime?: number;
      backgroundTile?: string | null;
      tileGrid?: TileGrid | null;
      items?: SceneManifestItem[];
    };
    const sceneFiles = Object.keys(zip.files).filter((p) => p.startsWith("scenes/") && p.endsWith(".scene.json"));
    const oldSceneIdToNewId = new Map<string, string>();
    const sceneManifests: Array<{ newId: string; manifest: SceneManifest; oldId?: string }> = [];
    for (const path of sceneFiles) {
      const f = zip.file(path);
      if (!f) continue;
      let manifest: SceneManifest;
      try {
        manifest = JSON.parse(await f.async("string"));
      } catch {
        continue;
      }
      const newId = crypto.randomUUID();
      // Manifests don't include the original scene id directly; we key by
      // the file slug so cross-scene linkSceneId references can still match
      // when both sides exist in the same zip. Older exports may not have
      // an id; guard.
      const slugMatch = path.match(/^scenes\/(.+)\.scene\.json$/);
      const slugKey = slugMatch?.[1] || path;
      oldSceneIdToNewId.set(slugKey, newId);
      sceneManifests.push({ newId, manifest, oldId: slugKey });
    }

    const newScenes: Record<string, Scene> = {};
    for (const { newId, manifest } of sceneManifests) {
      const items: SceneItem[] = (manifest.items || []).map((raw) => {
        const filename = typeof raw.asset_filename === "string" ? raw.asset_filename : null;
        const assetId = (filename && filenameToNewId.get(filename)) || "";
        // linkSceneId in the export is the OLD id — try to resolve via slug.
        // We can't recover the slug from an old id alone; treat as best-effort.
        const linkRaw = typeof raw.linkSceneId === "string" ? raw.linkSceneId : null;
        const linkResolved =
          linkRaw && oldSceneIdToNewId.get(linkRaw)
            ? oldSceneIdToNewId.get(linkRaw)
            : undefined;
        return {
          id: crypto.randomUUID(),
          assetId,
          x: typeof raw.x === "number" ? raw.x : 512,
          y: typeof raw.y === "number" ? raw.y : 512,
          scale: typeof raw.scale === "number" ? raw.scale : 0.2,
          z: typeof raw.z === "number" ? raw.z : 0,
          animating: !!raw.animating,
          flipX: !!raw.flipX,
          flipY: !!raw.flipY,
          rotation: typeof raw.rotation === "number" ? raw.rotation : undefined,
          pickable: !!raw.pickable,
          linkSceneId: linkResolved,
          patrol: (raw.patrol as SceneItem["patrol"]) || undefined,
          kind: (raw.kind as SceneItem["kind"]) || undefined,
          triggerMessage: typeof raw.triggerMessage === "string" ? raw.triggerMessage : undefined,
          light: (raw.light as SceneItem["light"]) || undefined,
          emitter: (raw.emitter as SceneItem["emitter"]) || undefined,
          sound: (raw.sound as SceneItem["sound"]) || undefined,
          dialogue: typeof raw.dialogue === "string" ? raw.dialogue : undefined,
          solid: defaultSolid(newAssets[assetId]?.assetType || "item"),
        };
      });
      // Remap the tile grid's tileAssetId from old id to new.
      let tileGrid: TileGrid | undefined;
      if (manifest.tileGrid && manifest.tileGrid.layers) {
        tileGrid = {
          tileSize: manifest.tileGrid.tileSize,
          layers: manifest.tileGrid.layers.map((l) => ({
            ...l,
            id: crypto.randomUUID(),
            tileAssetId: oldIdToNewId.get(l.tileAssetId) || l.tileAssetId,
          })),
        };
      }
      // Background tile — manifest stores a filename.
      let backgroundTileId: string | undefined;
      if (typeof manifest.backgroundTile === "string") {
        backgroundTileId = filenameToNewId.get(manifest.backgroundTile);
      }
      newScenes[newId] = {
        id: newId,
        name: manifest.name || "Imported scene",
        width: manifest.width || 1024,
        height: manifest.height || 1024,
        items,
        tileGrid,
        backgroundTileId,
        daytime: typeof manifest.daytime === "number" ? manifest.daytime : undefined,
        createdAt: Date.now(),
      };
    }

    // Recipes — id-less in the export, re-allocated on import.
    const newRecipes: Record<string, Recipe> = {};
    const recipesFile = zip.file("recipes.json");
    if (recipesFile) {
      try {
        const raw = JSON.parse(await recipesFile.async("string"));
        if (Array.isArray(raw)) {
          for (const r of raw) {
            if (!r || typeof r !== "object") continue;
            const newId = crypto.randomUUID();
            // Validate the minimum shape; skip records that look broken.
            const validModes: GenMode[] = ["item", "character", "scene"];
            if (typeof r.name !== "string" || typeof r.prompt !== "string") continue;
            if (!validModes.includes(r.mode)) continue;
            newRecipes[newId] = {
              id: newId,
              name: r.name,
              description: typeof r.description === "string" ? r.description : undefined,
              mode: r.mode,
              prompt: r.prompt,
              perspective: r.perspective === "side-view" ? "side-view" : "top-down",
              pose: ["single", "directions", "walk-cycle", "full-sheet"].includes(r.pose) ? r.pose : undefined,
              quality: ["low", "medium", "high"].includes(r.quality) ? r.quality : "medium",
              variants: typeof r.variants === "number" ? r.variants : 1,
              gridSize: typeof r.gridSize === "number" ? r.gridSize : 0,
              styleOverride: typeof r.styleOverride === "string" ? r.styleOverride : undefined,
              createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
              usageCount: typeof r.usageCount === "number" ? r.usageCount : 0,
            };
          }
        }
      } catch {
        /* malformed recipes.json — skip silently */
      }
    }

    // Restore the project's MEMORY blob too if present in the manifest.
    let importedMemory: string | undefined;
    if (projectFiles.length > 0) {
      try {
        const m = JSON.parse(await zip.file(projectFiles[0])!.async("string"));
        if (typeof m.memory === "string" && m.memory.trim()) importedMemory = m.memory;
      } catch { /* ignore */ }
    }

    const newProj: Project = {
      id: crypto.randomUUID(),
      name: `${projectName} (import)`,
      style: emptyStyle(),
      assets: newAssets,
      scenes: newScenes,
      memory: importedMemory,
      recipes: Object.keys(newRecipes).length > 0 ? newRecipes : undefined,
      createdAt: Date.now(),
    };
    setProjects((p) => ({ ...p, [newProj.id]: newProj }));
    setCurrentId(newProj.id);
    setActiveSceneId(null);
    setSelectedSceneItemIds([]);
    const recipeCount = Object.keys(newRecipes).length;
    alert(
      `Imported "${newProj.name}" — ${Object.keys(newAssets).length} asset${
        Object.keys(newAssets).length === 1 ? "" : "s"
      }, ${Object.keys(newScenes).length} scene${
        Object.keys(newScenes).length === 1 ? "" : "s"
      }${recipeCount > 0 ? `, ${recipeCount} recipe${recipeCount === 1 ? "" : "s"}` : ""}.`
    );
  }

  function downloadPNG(asset: Asset) {
    const a = document.createElement("a");
    a.href = asset.pixelUrl;
    a.download = `${asset.assetType}-${asset.pose}-${asset.id.slice(0, 8)}.png`;
    a.click();
  }

  async function downloadFrames(asset: Asset) {
    const [w, h] = parseSize(asset.sourceSize);
    const baseName = `${asset.assetType}-${asset.pose}-${asset.id.slice(0, 8)}`;
    const blob = await buildSpriteZip({
      fullSheetUrl: asset.rawUrl,
      cols: asset.cols,
      rows: asset.rows,
      imageWidth: w,
      imageHeight: h,
      baseName,
      pose: asset.pose,
      perspective: asset.perspective,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function repixelate(asset: Asset, newGrid: number) {
    const pixelUrl = await applyPixelate(asset.rawUrl, newGrid, asset.sourceSize);
    setAssets((a) => ({ ...a, [asset.id]: { ...asset, pixelUrl, gridSize: newGrid } }));
  }

  async function applySeamless(asset: Asset) {
    if (asset.assetType !== "tile") return;
    const seamlessUrl = await makeSeamless(asset.rawUrl);
    const pixelUrl = await applyPixelate(seamlessUrl, asset.gridSize, asset.sourceSize);
    const id = crypto.randomUUID();
    setAssets((a) => ({
      ...a,
      [id]: {
        ...asset,
        id,
        rawUrl: seamlessUrl,
        pixelUrl,
        editedFrom: asset.id,
        prompt: `${asset.prompt} (seamless)`,
        createdAt: Date.now(),
      },
    }));
  }

  function renameAsset(id: string, name: string) {
    setAssets((a) => {
      const cur = a[id];
      if (!cur) return a;
      const trimmed = name.trim();
      return { ...a, [id]: { ...cur, name: trimmed || undefined } };
    });
  }

  function setAssetTags(id: string, tags: string[]) {
    setAssets((a) => {
      const cur = a[id];
      if (!cur) return a;
      const cleaned = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
      return { ...a, [id]: { ...cur, tags: cleaned.length > 0 ? cleaned : undefined } };
    });
  }

  async function applyPaletteToAsset(id: string, palette: Palette) {
    const a = assets[id];
    if (!a) return;
    const newRaw = await applyPalette(a.rawUrl, palette);
    const newPixel = await applyPixelate(newRaw, a.gridSize, a.sourceSize);
    const newId = crypto.randomUUID();
    setAssets((all) => ({
      ...all,
      [newId]: {
        ...a,
        id: newId,
        rawUrl: newRaw,
        pixelUrl: newPixel,
        prompt: `${a.prompt} (${palette.name})`,
        editedFrom: a.id,
        createdAt: Date.now(),
      },
    }));
  }

  function deleteAsset(id: string) {
    // Soft-delete: mark trashedAt so the asset hides from the gallery but
    // still resolves for any scene items still referencing it. Hard-delete
    // happens on emptyTrash().
    setAssets((a) => {
      if (!a[id]) return a;
      return { ...a, [id]: { ...a[id], trashedAt: Date.now() } };
    });
    // Close the inline edit panel if the user just trashed the asset
    // they were editing.
    if (editingAssetId === id) {
      setEditingAssetId(null);
      setEditPrompt("");
    }
  }

  function restoreAsset(id: string) {
    setAssets((a) => {
      if (!a[id]) return a;
      const { trashedAt: _drop, ...rest } = a[id];
      return { ...a, [id]: rest };
    });
  }

  function emptyTrash() {
    setAssets((a) => {
      const kept: Record<string, Asset> = {};
      for (const [id, asset] of Object.entries(a)) {
        if (!asset.trashedAt) kept[id] = asset;
      }
      return kept;
    });
  }

  function clearAll() {
    const count = Object.values(assets).filter((a) => !a.trashedAt).length;
    if (count === 0) return;
    if (!confirm(`Move all ${count} assets in "${currentProject?.name}" to trash?`)) return;
    const now = Date.now();
    setAssets((a) => {
      const next: Record<string, Asset> = {};
      for (const [id, asset] of Object.entries(a)) {
        next[id] = asset.trashedAt ? asset : { ...asset, trashedAt: now };
      }
      return next;
    });
  }

  // ------------- bulk-select operations on the gallery ------------------

  function toggleAssetSelected(id: string) {
    setSelectedAssetIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function bulkDeleteSelected() {
    const ids = Array.from(selectedAssetIds);
    if (ids.length === 0) return;
    setAssets((a) => {
      const now = Date.now();
      const next = { ...a };
      for (const id of ids) {
        if (next[id]) next[id] = { ...next[id], trashedAt: now };
      }
      return next;
    });
    setSelectedAssetIds(new Set());
    setSelectMode(false);
  }

  function bulkTagSelected() {
    const ids = Array.from(selectedAssetIds);
    if (ids.length === 0) return;
    const raw = prompt(`Add tags to ${ids.length} asset${ids.length > 1 ? "s" : ""} (comma-separated):`);
    if (!raw) return;
    const newTags = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (newTags.length === 0) return;
    setAssets((a) => {
      const next = { ...a };
      for (const id of ids) {
        if (!next[id]) continue;
        const existing = next[id].tags || [];
        const merged = [...new Set([...existing, ...newTags])];
        next[id] = { ...next[id], tags: merged };
      }
      return next;
    });
  }

  function bulkAddSelectedToScene() {
    if (!activeScene) return;
    const ids = Array.from(selectedAssetIds);
    if (ids.length === 0) return;
    const sceneId = activeScene.id;
    const cx = activeScene.width / 2;
    const cy = activeScene.height / 2;
    ids.forEach((id, i) => {
      // Fan around scene center so the items don't perfectly overlap.
      const dx = (i - (ids.length - 1) / 2) * 60;
      addAssetToScene(sceneId, id, cx + dx, cy);
    });
    setSelectedAssetIds(new Set());
    setSelectMode(false);
    setRightTab("scenes");
  }

  /** Open the inline edit panel on a specific asset card. The actual edit
   *  call goes through editAssetInline once the user submits a prompt. */
  function startInlineEdit(asset: Asset) {
    setEditingAssetId(asset.id);
    setEditPrompt("");
  }

  async function useAsProjectStyle(asset: Asset) {
    const small = await downscaleImage(asset.rawUrl, 256);
    setProjectStyle((s) => ({ ...s, refUrl: small }));
    setStyleOpen(true);
  }

  async function handleUploadStyleRef(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const small = await downscaleImage(dataUrl, 256);
    setProjectStyle((s) => ({ ...s, refUrl: small }));
    e.target.value = "";
  }

  const allAssets = Object.values(assets).filter((a) => !a.trashedAt);
  const trashedAssets = Object.values(assets)
    .filter((a) => !!a.trashedAt)
    .sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
  const allTags = [...new Set(allAssets.flatMap((a) => a.tags || []))].sort();
  const substringHits = allAssets.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const hay = `${a.name || ""} ${a.prompt} ${(a.tags || []).join(" ")} ${a.assetType}`.toLowerCase();
    return hay.includes(q);
  });
  // When substring finds nothing, fall back to the semantic-rank list (if
  // the effect populated it for this query). Tag filter still applies.
  const usingSemantic = !!(
    search && substringHits.length === 0 && semanticIds && semanticIds.length > 0
  );
  const baseList: Asset[] = usingSemantic
    ? (semanticIds as string[])
        .map((id) => assets[id])
        .filter((a): a is Asset => !!a && !a.trashedAt)
    : substringHits;
  const filteredAssets = baseList.filter((a) => {
    if (activeTags.length > 0) {
      const t = a.tags || [];
      if (!activeTags.every((x) => t.includes(x))) return false;
    }
    return true;
  });
  const recent = (() => {
    // Don't mutate filteredAssets in place; sort returns the same ref otherwise.
    const arr = [...filteredAssets];
    // Semantic-search results are already similarity-ranked; preserving
    // that order is the whole point of falling back to vector search.
    if (usingSemantic) return arr;
    switch (assetSort) {
      case "oldest":
        return arr.sort((a, b) => a.createdAt - b.createdAt);
      case "name":
        return arr.sort((a, b) =>
          (a.name || a.prompt).localeCompare(b.name || b.prompt)
        );
      case "type":
        // Group by assetType A-Z, then newest within each group.
        return arr.sort((a, b) => {
          if (a.assetType !== b.assetType) return a.assetType.localeCompare(b.assetType);
          return b.createdAt - a.createdAt;
        });
      case "newest":
      default:
        return arr.sort((a, b) => b.createdAt - a.createdAt);
    }
  })();
  const hasStyleConfig =
    projectStyle.text !== "" || projectStyle.refUrl !== null || projectStyle.preset !== "cozy";

  return (
    <main className="mx-auto max-w-7xl p-3 md:p-6 grid md:grid-cols-[1fr_1.2fr] gap-4 md:h-screen min-h-screen">
      {/* Chat panel */}
      <section className="panel flex flex-col p-3 md:p-4 min-h-[500px] md:min-h-0">
        <header className="border-b-2 border-farm-wood pb-2 mb-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="font-pixel text-2xl text-farm-grass">🎮 Pixel Play</h1>
              <p className="text-sm opacity-70">Pixel-art asset & scene studio</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <ProjectSwitcher
                  projects={projects}
                  currentId={currentId}
                  onSelect={setCurrentId}
                  onCreate={createProject}
                  onRename={renameCurrentProject}
                  onDelete={deleteCurrentProject}
                  onExport={exportProject}
                  onShare={shareProject}
                  onImport={importProject}
                />
                <button
                  onClick={() => setAgentOpen((v) => !v)}
                  title="Concierge agent — chat to drive FORGE via tool calls"
                  className={`px-2 py-1 text-xs border-2 bg-farm-ink/60 ${
                    agentOpen
                      ? "border-farm-grass text-farm-grass"
                      : "border-farm-wood hover:border-farm-grass hover:text-farm-grass"
                  }`}
                >
                  🤖 Agent
                </button>
                <button
                  onClick={() => setSettingsOpen(true)}
                  title="Settings — configure your OpenAI API key"
                  className="px-2 py-1 text-xs border-2 border-farm-wood bg-farm-ink/60 hover:border-farm-grass hover:text-farm-grass"
                >
                  ⚙ Settings
                </button>
              </div>
              <CostIndicator session={session} project={projectLifetime} />
              <StorageIndicator />
              {importingShared && (
                <div className="text-xs text-farm-grass flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 border-2 border-farm-grass border-t-transparent rounded-full animate-spin" />
                  Importing shared project…
                </div>
              )}
            </div>
          </div>
        </header>

        {hydrated && !openaiKey && (
          <div className="mb-3 flex items-center gap-3 px-3 py-2 border-2 border-yellow-500/60 bg-yellow-900/20 text-sm">
            <span className="text-xl leading-none">🔑</span>
            <div className="flex-1">
              <div className="text-yellow-200 font-medium">No OpenAI key yet</div>
              <div className="text-yellow-200/70 text-xs">Pixel Play needs your own OpenAI key to generate. Stored in your browser only.</div>
            </div>
            <button
              onClick={() => setSettingsOpen(true)}
              className="px-3 py-1.5 text-sm border border-yellow-300 bg-yellow-300/10 text-yellow-200 hover:bg-yellow-300/20"
            >
              Set key
            </button>
          </div>
        )}

        {/* Recipe-suggestion toast — auto-detected after 3+ same-mode
            FORGEs with ≥60% prompt-token overlap. Click Save → prompts
            for a name, snapshots the current form, switches to recipes
            tab. ✕ dismisses for this session. */}
        {recipeSuggestion && (
          <div className="mb-3 flex items-center gap-2 px-3 py-2 border-2 border-farm-grass/60 bg-farm-grass/10 text-xs">
            <span className="text-lg leading-none">🪄</span>
            <div className="flex-1 min-w-0">
              <div className="text-farm-grass font-medium">
                Save this pattern as a recipe?
              </div>
              <div className="opacity-70 italic truncate">
                {recipeSuggestion.prompt.slice(0, 80)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const name = prompt("Recipe name:")?.trim();
                if (!name) return;
                saveRecipe(name);
                setRightTab("recipes");
                setRecipeSuggestion(null);
              }}
              className="px-2 py-0.5 border border-farm-grass text-farm-grass bg-farm-grass/20 hover:bg-farm-grass/30"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                if (recipeSuggestion) {
                  const key = `${recipeSuggestion.mode}:${recipeSuggestion.prompt.slice(0, 30).toLowerCase()}`;
                  dismissedSuggestionsRef.current.add(key);
                }
                setRecipeSuggestion(null);
              }}
              title="Dismiss for this session"
              className="px-1.5 py-0.5 opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        <ProjectStyleSection
          open={styleOpen}
          onToggle={() => setStyleOpen((s) => !s)}
          style={projectStyle}
          onChangeText={(text) => setProjectStyle((s) => ({ ...s, text }))}
          onChangePreset={(preset) => setProjectStyle((s) => ({ ...s, preset }))}
          onClearRef={() => setProjectStyle((s) => ({ ...s, refUrl: null }))}
          onUploadRef={handleUploadStyleRef}
          hasConfig={hasStyleConfig}
          memory={getEffectiveProjectMemory()}
          onChangeMemory={setProjectMemory}
        />

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1 space-y-3 my-3">
          {messages.map((m, i) => (
            <ChatBubble
              key={i}
              message={m}
              assetIds={m.role === "assistant" ? m.assetIds : undefined}
              assets={assets}
            />
          ))}
          {messages.length === 1 && Object.keys(assets).length === 0 && (
            <div className="space-y-2 pt-2">
              <div className="text-xs opacity-60">Try one to get started:</div>
              <div className="flex flex-wrap gap-1.5">
                {STARTER_PROMPTS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => {
                      setInput(s.prompt);
                      setGenMode(s.mode);
                      if (s.pose) setPose(s.pose);
                      if (s.perspective) setPerspective(s.perspective);
                    }}
                    className="px-2 py-1 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass text-xs"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Agent drawer — collapsible Concierge chat. Toggle in panel
            header. Streams from `/api/agent`; each tool_call event surfaces
            as an inline chip. Tool execution is the next roadmap item;
            for now the chips are display-only. */}
        {agentOpen && (
          <AgentDrawer
            messages={agentMessages}
            input={agentInput}
            busy={agentBusy}
            scrollRef={agentScrollRef}
            onChangeInput={setAgentInput}
            onSend={() => sendAgentMessage(agentInput)}
            onClear={() => setAgentMessages([])}
            onClose={() => setAgentOpen(false)}
          />
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-2 text-sm">
          {/* Asset type — three modes: Character / Item / Scene */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider opacity-50">Type</div>
              <button
                type="button"
                onClick={() => {
                  const name = prompt("Recipe name:")?.trim();
                  if (!name) return;
                  saveRecipe(name);
                  setRightTab("recipes");
                }}
                title="Save current form values as a one-click recipe — replays mode, prompt, perspective, pose, quality, variants, pixel-snap, and style override."
                className="text-xs px-2 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
              >
                💾 Save as recipe
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {GEN_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setGenMode(m.value)}
                  title={m.hint}
                  className={`px-3 py-1 border-2 rounded-sm transition ${
                    genMode === m.value
                      ? "border-farm-grass bg-farm-grass/20 text-farm-grass"
                      : "border-farm-wood text-farm-parchment/70 hover:border-farm-parchment"
                  }`}
                >
                  {m.emoji} {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* "Add to scene" — only relevant when there's an active scene
              and we're generating a single item (not creating a new scene). */}
          {activeScene && genMode !== "scene" && (
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={addToScene}
                onChange={(e) => setAddToScene(e.target.checked)}
                className="accent-farm-grass"
              />
              <span>
                Add to scene{" "}
                <span className="opacity-60">🎬 {activeScene.name}</span>
              </span>
            </label>
          )}

          {/* Advanced options — collapsed by default to reduce noise */}
          <div className="border-t border-farm-wood/30 pt-1.5">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="w-full flex items-center justify-between text-[11px] uppercase tracking-wider opacity-60 hover:opacity-90 py-0.5"
            >
              <span>{advancedOpen ? "▾" : "▸"} Options</span>
              {!advancedOpen && (
                <span className="opacity-70 normal-case tracking-normal">
                  {PERSPECTIVES.find((p) => p.value === perspective)?.label}
                  {genMode === "character" && pose !== "single"
                    ? ` · ${POSES.find((p) => p.value === pose)?.label}`
                    : ""}
                  {" · "}
                  {QUALITIES.find((q) => q.value === quality)?.label}
                  {variants > 1 ? ` · ${variants}×` : ""}
                </span>
              )}
            </button>

            {advancedOpen && (
              <div className="mt-2 space-y-1.5 text-xs">
                <div className="flex flex-wrap items-center gap-2 opacity-90">
                  <span className="opacity-60 w-20 inline-block">View</span>
                  {PERSPECTIVES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPerspective(p.value)}
                      className={`px-2 py-0.5 border ${
                        perspective === p.value ? "border-farm-grass text-farm-grass" : "border-farm-wood/60"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {genMode === "character" && (
                  <div className="flex flex-wrap items-center gap-2 opacity-90">
                    <span className="opacity-60 w-20 inline-block">Pose</span>
                    {POSES.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setPose(p.value)}
                        title={p.hint}
                        className={`px-2 py-0.5 border ${
                          pose === p.value ? "border-farm-grass text-farm-grass" : "border-farm-wood/60"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 opacity-90">
                  <span className="opacity-60 w-20 inline-block">Pixel snap</span>
                  {GRID_PRESETS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGridSize(g)}
                      className={`px-2 py-0.5 border ${
                        gridSize === g ? "border-farm-grass text-farm-grass" : "border-farm-wood/60"
                      }`}
                    >
                      {gridLabel(g)}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 opacity-90">
                  <span className="opacity-60 w-20 inline-block">Quality</span>
                  {QUALITIES.map((q) => (
                    <button
                      key={q.value}
                      type="button"
                      onClick={() => setQuality(q.value)}
                      title={q.cost}
                      className={`px-2 py-0.5 border ${
                        quality === q.value ? "border-farm-grass text-farm-grass" : "border-farm-wood/60"
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 opacity-90">
                  <span className="opacity-60 w-20 inline-block">Variants</span>
                  {VARIANT_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setVariants(n)}
                      className={`px-2 py-0.5 border w-8 ${
                        variants === n ? "border-farm-grass text-farm-grass" : "border-farm-wood/60"
                      }`}
                    >
                      {n}×
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Prompt — primary input, the largest control on the form */}
          <div className="border-t-2 border-farm-wood pt-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-wider opacity-50">
                {genMode === "scene" ? "Scene description" : "Prompt"}
              </label>
              <span className="text-[10px] opacity-40">↑↓ history · ⏎ submit</span>
            </div>
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Submit on:
                  //   • Enter (no modifiers)
                  //   • ⌘+Enter (macOS) or Ctrl+Enter (Win/Linux) — redundant
                  //     shortcut for users with the modifier habit.
                  // Shift+Enter falls through to the textarea's default
                  // newline behavior. IME composition (Asian-language
                  // keyboards) sets isComposing — leave those alone.
                  if (
                    e.key === "Enter" &&
                    !e.nativeEvent.isComposing &&
                    (!e.shiftKey || e.metaKey || e.ctrlKey)
                  ) {
                    e.preventDefault();
                    handleSubmit(e as unknown as React.FormEvent);
                    return;
                  }
                  if (e.key === "ArrowUp" && promptHistory.length > 0 && (input === "" || historyIdx >= 0)) {
                    e.preventDefault();
                    const nextIdx = Math.min(historyIdx + 1, promptHistory.length - 1);
                    setHistoryIdx(nextIdx);
                    setInput(promptHistory[nextIdx]);
                    return;
                  }
                  if (e.key === "ArrowDown" && historyIdx >= 0) {
                    e.preventDefault();
                    const nextIdx = historyIdx - 1;
                    setHistoryIdx(nextIdx);
                    setInput(nextIdx < 0 ? "" : promptHistory[nextIdx]);
                    return;
                  }
                }}
                placeholder={
                  genMode === "scene"
                    ? "Describe a scene — e.g. 'a wizard's potion shop with magical items'"
                    : genMode === "character"
                    ? "e.g. a young farmer in overalls and a straw hat"
                    : "e.g. a sleepy orange tabby cat with a tiny scarf"
                }
                rows={2}
                disabled={busy}
                className="flex-1 bg-farm-ink/60 border-2 border-farm-wood p-2 text-lg text-farm-parchment focus:outline-none focus:border-farm-grass resize-none"
              />
              <button type="submit" disabled={busy || !input.trim()} className="btn-pixel">
                {busy ? "..." : "FORGE"}
              </button>
            </div>
          </div>
        </form>
      </section>

      {/* Right panel: Assets / Scenes tabs */}
      <section className="panel p-3 md:p-4 md:overflow-y-auto min-h-[500px] md:min-h-0">
        <header className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setRightTab("assets")}
              className={`px-3 py-1 border-2 font-pixel text-base ${
                rightTab === "assets"
                  ? "border-farm-sky text-farm-sky bg-farm-sky/10"
                  : "border-farm-wood/60 text-farm-parchment/70"
              }`}
            >
              📦 Assets {Object.keys(assets).length > 0 && <span className="opacity-60 text-xs ml-1">({Object.keys(assets).length})</span>}
            </button>
            <button
              type="button"
              onClick={() => setRightTab("scenes")}
              className={`px-3 py-1 border-2 font-pixel text-base ${
                rightTab === "scenes"
                  ? "border-farm-sky text-farm-sky bg-farm-sky/10"
                  : "border-farm-wood/60 text-farm-parchment/70"
              }`}
            >
              🎬 Scenes {Object.keys(scenes).length > 0 && <span className="opacity-60 text-xs ml-1">({Object.keys(scenes).length})</span>}
            </button>
            <button
              type="button"
              onClick={() => setRightTab("recipes")}
              className={`px-3 py-1 border-2 font-pixel text-base ${
                rightTab === "recipes"
                  ? "border-farm-sky text-farm-sky bg-farm-sky/10"
                  : "border-farm-wood/60 text-farm-parchment/70"
              }`}
            >
              📋 Recipes {currentProject?.recipes && Object.keys(currentProject.recipes).length > 0 && (
                <span className="opacity-60 text-xs ml-1">
                  ({Object.keys(currentProject.recipes).length})
                </span>
              )}
            </button>
          </div>
          {rightTab === "assets" && recent.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setSelectMode((v) => {
                    if (v) setSelectedAssetIds(new Set());
                    return !v;
                  });
                }}
                className={`text-xs px-2 py-1 border ${
                  selectMode
                    ? "border-farm-grass text-farm-grass bg-farm-grass/10"
                    : "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                }`}
                title={selectMode ? "Exit multi-select" : "Multi-select assets"}
              >
                {selectMode ? "✓ Selecting" : "☐ Select"}
              </button>
              <button
                onClick={clearAll}
                className="text-xs px-2 py-1 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
              >
                Clear all
              </button>
            </div>
          )}
        </header>

        {rightTab === "assets" ? (
          <>
            {allAssets.length > 0 && (
              <div className="space-y-2 mb-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="🔍 Search by name, prompt, tag, type…"
                    className="flex-1 bg-farm-ink/60 border border-farm-wood text-farm-parchment px-2 py-1 text-sm focus:outline-none focus:border-farm-grass"
                  />
                  <select
                    value={assetSort}
                    onChange={(e) =>
                      setAssetSort(e.target.value as "newest" | "oldest" | "name" | "type")
                    }
                    className="bg-farm-ink/60 border border-farm-wood text-farm-parchment text-xs px-1 py-1 focus:outline-none focus:border-farm-grass"
                    title="Sort assets"
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="name">Name A-Z</option>
                    <option value="type">Type</option>
                  </select>
                  {(search || activeTags.length > 0) && (
                    <button
                      onClick={() => {
                        setSearch("");
                        setActiveTags([]);
                      }}
                      className="text-xs px-2 py-1 border border-farm-wood/60 hover:border-farm-grass"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {(usingSemantic || semanticBusy) && (
                  <div className="text-xs">
                    {semanticBusy ? (
                      <span
                        className="inline-block px-2 py-0.5 border border-farm-wood/60 text-farm-parchment/70"
                        title="No exact match — searching by meaning…"
                      >
                        🧠 thinking…
                      </span>
                    ) : (
                      <span
                        className="inline-block px-2 py-0.5 border border-farm-grass/60 text-farm-grass"
                        title="No exact match — showing semantically similar assets"
                      >
                        🧠 semantic
                      </span>
                    )}
                  </div>
                )}
                {allTags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    <span className="opacity-60">Tags:</span>
                    {allTags.map((t) => {
                      const active = activeTags.includes(t);
                      return (
                        <button
                          key={t}
                          onClick={() =>
                            setActiveTags((cur) =>
                              cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
                            )
                          }
                          className={`px-2 py-0.5 border ${
                            active
                              ? "border-farm-grass text-farm-grass bg-farm-grass/10"
                              : "border-farm-wood/60 hover:border-farm-grass"
                          }`}
                        >
                          #{t}
                        </button>
                      );
                    })}
                  </div>
                )}
                {recent.length !== allAssets.length && (
                  <div className="text-xs opacity-60">
                    Showing {recent.length} of {allAssets.length}
                  </div>
                )}
              </div>
            )}
            {selectMode && selectedAssetIds.size > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 px-3 py-2 border-2 border-farm-grass/60 bg-farm-grass/5 text-xs">
                <span className="font-medium text-farm-grass">
                  {selectedAssetIds.size} selected
                </span>
                <button
                  type="button"
                  onClick={bulkDeleteSelected}
                  className="px-2 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
                  title="Move selected assets to trash"
                >
                  🗑 Delete {selectedAssetIds.size}
                </button>
                <button
                  type="button"
                  onClick={bulkTagSelected}
                  className="px-2 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                  title="Add comma-separated tags to all selected"
                >
                  🏷 Tag…
                </button>
                {activeScene && (
                  <button
                    type="button"
                    onClick={bulkAddSelectedToScene}
                    className="px-2 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                    title={`Drop selected onto 🎬 ${activeScene.name}`}
                  >
                    🎬 Add to scene {selectedAssetIds.size}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedAssetIds(new Set())}
                  className="ml-auto px-2 py-0.5 opacity-60 hover:opacity-100"
                  title="Deselect all"
                >
                  Clear selection
                </button>
              </div>
            )}
            {recent.length === 0 ? (
              <div className="opacity-60 text-center py-12">
                <div className="text-6xl mb-3">🌱</div>
                <p>{allAssets.length === 0 ? "Empty barn. Forge your first asset!" : "No assets match the filter."}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {recent.map((a) => (
                  <AssetCard
                    key={a.id}
                    asset={a}
                    onDownloadPNG={() => downloadPNG(a)}
                    onDownloadFrames={() => downloadFrames(a)}
                    onStartEdit={() => startInlineEdit(a)}
                    onUseAsProjectStyle={() => useAsProjectStyle(a)}
                    onRepixelate={(g) => repixelate(a, g)}
                    onMakeSeamless={() => applySeamless(a)}
                    onDelete={() => deleteAsset(a.id)}
                    onRename={(n) => renameAsset(a.id, n)}
                    onSetTags={(t) => setAssetTags(a.id, t)}
                    onApplyPalette={() => setPaletteAssetId(a.id)}
                    onDragStart={() => setDraggingAssetId(a.id)}
                    onDragEnd={() => setDraggingAssetId(null)}
                    onSetAsSceneBackground={() => {
                      if (activeScene && a.assetType === "tile") {
                        updateScene(activeScene.id, (s) => ({ ...s, backgroundTileId: a.id }));
                        setRightTab("scenes");
                      }
                    }}
                    sceneActive={!!activeScene}
                    editing={editingAssetId === a.id}
                    editingBusy={editingAssetId === a.id && editingBusy}
                    editPrompt={editingAssetId === a.id ? editPrompt : ""}
                    onChangeEditPrompt={setEditPrompt}
                    onSubmitEdit={() => editAssetInline(a, editPrompt)}
                    onCancelEdit={() => {
                      setEditingAssetId(null);
                      setEditPrompt("");
                    }}
                    selectMode={selectMode}
                    selected={selectedAssetIds.has(a.id)}
                    onToggleSelect={() => toggleAssetSelected(a.id)}
                  />
                ))}
              </div>
            )}
            {trashedAssets.length > 0 && (
              <button
                type="button"
                onClick={() => setTrashOpen(true)}
                className="mt-3 w-full text-xs px-2 py-1 border border-farm-wood/40 text-farm-parchment/60 hover:border-farm-grass hover:text-farm-grass"
                title="Recently deleted assets — click to restore or empty"
              >
                🗑 Trash ({trashedAssets.length})
              </button>
            )}
          </>
        ) : rightTab === "scenes" ? (
          <ScenesView
            scenes={scenes}
            assets={assets}
            activeSceneId={activeSceneId}
            onSelectScene={(id) => {
              setActiveSceneId(id);
              setSelectedSceneItemIds([]);
            }}
            onDeleteScene={deleteScene}
            onExportScene={exportScene}
            onExportTiledJson={exportTiledJson}
            activeScene={activeScene}
            selectedSceneItem={selectedSceneItem}
            selectedSceneItemIds={selectedSceneItemIds}
            onSelectSceneItem={(id) => setSelectedSceneItemIds(id ? [id] : [])}
            onSelectionChange={setSelectedSceneItemIds}
            onDropAsset={(assetId, x, y) =>
              activeScene && addAssetToScene(activeScene.id, assetId, x, y)
            }
            snap={sceneSnap}
            onSnapChange={setSceneSnap}
            zoom={sceneZoom}
            onZoomChange={setSceneZoom}
            onClearBackground={() => activeScene && clearSceneBackground(activeScene.id)}
            onDuplicateSceneItem={(id) => activeScene && duplicateSceneItem(activeScene.id, id)}
            onReorderSceneItems={(from, to) =>
              activeScene && reorderSceneItems(activeScene.id, from, to)
            }
            onToggleSolid={(id) => activeScene && toggleSceneItemSolid(activeScene.id, id)}
            onToggleFlipX={(id) => activeScene && toggleSceneItemFlipX(activeScene.id, id)}
            onToggleFlipY={(id) => activeScene && toggleSceneItemFlipY(activeScene.id, id)}
            onTogglePickable={(id) => activeScene && toggleSceneItemPickable(activeScene.id, id)}
            onToggleAnchor={(id) => activeScene && toggleSceneItemAnchor(activeScene.id, id)}
            onSetLinkScene={(id, linkId) =>
              activeScene && setSceneItemLinkScene(activeScene.id, id, linkId)
            }
            onSetPatrol={(id, patrol) =>
              activeScene && setSceneItemPatrol(activeScene.id, id, patrol)
            }
            onSetTriggerMessage={(id, msg) =>
              activeScene && setSceneItemTriggerMessage(activeScene.id, id, msg)
            }
            onSetDialogue={(id, d) =>
              activeScene && setSceneItemDialogue(activeScene.id, id, d)
            }
            onSetUseMessage={(id, m) =>
              activeScene && setSceneItemUseMessage(activeScene.id, id, m)
            }
            onSetUseStateAssetId={(id, altId) =>
              activeScene && setSceneItemUseStateAssetId(activeScene.id, id, altId)
            }
            onAddTriggerZone={() => activeScene && addTriggerZone(activeScene.id)}
            onAddPointLight={() => activeScene && addPointLight(activeScene.id)}
            onSetLight={(id, light) =>
              activeScene && setSceneItemLight(activeScene.id, id, light)
            }
            onAddParticleEmitter={() => activeScene && addParticleEmitter(activeScene.id)}
            onSetEmitter={(id, emitter) =>
              activeScene && setSceneItemEmitter(activeScene.id, id, emitter)
            }
            onAddSoundTrigger={() => activeScene && addSoundTrigger(activeScene.id)}
            onSetSound={(id, sound) =>
              activeScene && setSceneItemSound(activeScene.id, id, sound)
            }
            onSetDaytime={(d) => activeScene && setSceneDaytime(activeScene.id, d)}
            paintMode={paintMode}
            onPaintModeChange={setPaintMode}
            activeTileLayerId={activeTileLayerId}
            onActiveTileLayerChange={setActiveTileLayerId}
            onAddTileLayer={(tileAssetId) =>
              activeScene && addTileLayer(activeScene.id, tileAssetId)
            }
            onRemoveTileLayer={(layerId) =>
              activeScene && removeTileLayer(activeScene.id, layerId)
            }
            onRenameTileLayer={(layerId, name) =>
              activeScene && renameTileLayer(activeScene.id, layerId, name)
            }
            onSetLayerTileAsset={(layerId, tileAssetId) =>
              activeScene && setLayerTileAsset(activeScene.id, layerId, tileAssetId)
            }
            onToggleLayerVisible={(layerId) =>
              activeScene && toggleLayerVisible(activeScene.id, layerId)
            }
            onReorderTileLayers={(from, to) =>
              activeScene && reorderTileLayers(activeScene.id, from, to)
            }
            onPaintCell={(layerId, x, y) =>
              activeScene && paintTileCell(activeScene.id, layerId, x, y)
            }
            onEraseCell={(layerId, x, y) =>
              activeScene && eraseTileCell(activeScene.id, layerId, x, y)
            }
            onFillRect={(layerId, x0, y0, x1, y1) =>
              activeScene && fillTileRect(activeScene.id, layerId, x0, y0, x1, y1)
            }
            onFillLayer={(layerId) =>
              activeScene && fillTileLayer(activeScene.id, layerId)
            }
            onSetTileSize={(n) => activeScene && setTileSize(activeScene.id, n)}
            prefabs={currentProject?.prefabs || {}}
            onSavePrefab={(name, items) => savePrefab(name, items)}
            onDeletePrefab={(id) => deletePrefab(id)}
            onInstantiatePrefab={(prefabId, x, y) =>
              activeScene && instantiatePrefab(activeScene.id, prefabId, x, y)
            }
            onSyncPrefabInstances={(prefabId) => syncPrefabInstances(prefabId)}
            playMode={playMode}
            onPlayModeChange={setPlayMode}
            activeCharacterId={activeCharacterId}
            onActiveCharacterChange={setActiveCharacterId}
            onUpdateCharacterPos={(id, x, y) =>
              activeScene && setSceneItemPos(activeScene.id, id, x, y)
            }
            onPortalEnter={(targetSceneId) => {
              const target = scenes[targetSceneId];
              if (!target) return;
              setActiveSceneId(targetSceneId);
              // Pick the first character in the target scene as the new player.
              const candidate = target.items.find(
                (it) => assets[it.assetId]?.assetType === "character"
              );
              setActiveCharacterId(candidate?.id || null);
            }}
            onEnsurePlayer={ensurePlayerCharacter}
            onCopySelected={() => copySceneItems(selectedSceneItemIds)}
            onPaste={pasteSceneItems}
            clipboardSize={sceneClipboard.length}
            onClearFailedItems={(sceneId) =>
              updateScene(sceneId, (s) => ({ ...s, failedItems: undefined }), {
                record: false,
              })
            }
            onDuplicateScene={duplicateScene}
            onRenameScene={renameScene}
            onMoveSceneItem={(id, x, y) =>
              activeScene && moveSceneItem(activeScene.id, id, x, y)
            }
            onMoveSceneItems={(updates) =>
              activeScene && moveSceneItems(activeScene.id, updates)
            }
            onRotateSceneItem={(id, deg) =>
              activeScene && rotateSceneItem(activeScene.id, id, deg)
            }
            onUpdateSceneItemScale={(id, scale) =>
              activeScene && updateSceneItemScale(activeScene.id, id, scale)
            }
            onBumpSceneItemZ={(id, delta) =>
              activeScene && bumpSceneItemZ(activeScene.id, id, delta)
            }
            onToggleAnimating={(id) =>
              activeScene && toggleSceneItemAnimating(activeScene.id, id)
            }
            onDeleteSceneItem={(id) =>
              activeScene && deleteSceneItem(activeScene.id, id)
            }
            replacePrompt={replacePrompt}
            setReplacePrompt={setReplacePrompt}
            onReplaceItem={async () => {
              if (!activeScene || !selectedSceneItem) return;
              const p = replacePrompt.trim();
              if (!p) return;
              setReplacePrompt("");
              await replaceSceneItem(activeScene.id, selectedSceneItem, p);
            }}
          />
        ) : (
          <RecipesView
            recipes={currentProject?.recipes || {}}
            onApply={applyRecipe}
            onDelete={deleteRecipe}
          />
        )}
      </section>

      {paletteAssetId && assets[paletteAssetId] && (
        <PaletteModal
          asset={assets[paletteAssetId]}
          onClose={() => setPaletteAssetId(null)}
          onApply={async (palette) => {
            const id = paletteAssetId;
            setPaletteAssetId(null);
            if (id) await applyPaletteToAsset(id, palette);
          }}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          initialKey={openaiKey}
          initialFalKey={falKey}
          initialProvider={imageProvider}
          onClose={() => setSettingsOpen(false)}
          onSave={(prefs) => {
            setOpenaiKey(prefs.openaiKey);
            setFalKey(prefs.falKey);
            setImageProvider(prefs.imageProvider);
            try {
              if (prefs.openaiKey) localStorage.setItem(OPENAI_KEY_LS, prefs.openaiKey);
              else localStorage.removeItem(OPENAI_KEY_LS);
              if (prefs.falKey) localStorage.setItem(FAL_KEY_LS, prefs.falKey);
              else localStorage.removeItem(FAL_KEY_LS);
              localStorage.setItem(IMAGE_PROVIDER_LS, prefs.imageProvider);
            } catch {}
            setSettingsOpen(false);
          }}
        />
      )}

      {trashOpen && (
        <TrashModal
          trashed={trashedAssets}
          onClose={() => setTrashOpen(false)}
          onRestore={(id) => restoreAsset(id)}
          onEmpty={() => {
            if (trashedAssets.length === 0) return;
            if (!confirm(`Permanently delete ${trashedAssets.length} asset${trashedAssets.length > 1 ? "s" : ""}?`)) return;
            emptyTrash();
            setTrashOpen(false);
          }}
        />
      )}

      {onboardingOpen && (
        <OnboardingModal
          onClose={() => {
            try { localStorage.setItem(ONBOARDED_LS_KEY, "1"); } catch {}
            setOnboardingOpen(false);
          }}
        />
      )}
      {shareToast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 border-2 border-farm-grass bg-farm-ink text-farm-grass text-sm shadow-lg">
          🔗 {shareToast}
        </div>
      )}
    </main>
  );
}

// ----------------------------------------------------------- subcomponents

function ProjectSwitcher({
  projects,
  currentId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onExport,
  onShare,
  onImport,
}: {
  projects: Record<string, Project>;
  currentId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onExport: () => void;
  onShare: () => void;
  onImport: (file: File) => void;
}) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const list = Object.values(projects).sort((a, b) => a.createdAt - b.createdAt);
  const current = projects[currentId];

  function handleCreate() {
    const name = prompt("New project name:", "")?.trim();
    if (name) onCreate(name);
  }
  function handleRename() {
    const name = prompt("Rename project:", current?.name)?.trim();
    if (name) onRename(name);
  }
  function handleDelete() {
    if (!current) return;
    if (!confirm(`Delete project "${current.name}" and all its assets?`)) return;
    onDelete();
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <select
        value={currentId}
        onChange={(e) => onSelect(e.target.value)}
        className="bg-farm-ink border border-farm-wood text-farm-parchment px-1 py-0.5 max-w-[140px]"
        title="Switch project"
      >
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            📁 {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleCreate}
        title="New project"
        className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
      >
        +
      </button>
      <button
        type="button"
        onClick={handleRename}
        title="Rename"
        className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
      >
        ✎
      </button>
      <button
        type="button"
        onClick={onExport}
        title="Export entire project (assets + scenes) as zip"
        className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
      >
        ⬇
      </button>
      <button
        type="button"
        onClick={onShare}
        title="Share link — uploads project zip and copies a public URL"
        className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
      >
        🔗
      </button>
      <button
        type="button"
        onClick={() => importInputRef.current?.click()}
        title="Import a project zip exported from Pixel Play"
        className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
      >
        📥
      </button>
      <input
        ref={importInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          // Reset so picking the same file twice still fires onChange.
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={handleDelete}
        title="Delete project"
        className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
      >
        🗑
      </button>
    </div>
  );
}

function PaletteModal({
  asset,
  onClose,
  onApply,
}: {
  asset: Asset;
  onClose: () => void;
  onApply: (palette: Palette) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [customColors, setCustomColors] = useState<RGB[] | null>(null);

  // Generate a small preview per built-in palette so the user can compare.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, string> = {};
      for (const p of BUILT_IN_PALETTES) {
        try {
          out[p.id] = await applyPalette(asset.pixelUrl, p);
        } catch {
          // swallow
        }
      }
      if (!cancelled) setPreviews(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [asset.pixelUrl]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const url = reader.result as string;
      const colors = await extractPalette(url, 16);
      setCustomColors(colors);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function applyAndClose(p: Palette) {
    setBusy(true);
    onApply(p);
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-farm-ink/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel bg-farm-ink p-4 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-3 border-b border-farm-wood pb-2">
          <h3 className="font-pixel text-lg text-farm-grass">🎯 Snap to palette</h3>
          <button onClick={onClose} className="px-2 py-1 border border-farm-wood/60">
            ✕
          </button>
        </div>
        <p className="text-xs opacity-70 mb-3">
          Replaces every pixel in <span className="text-farm-grass">{asset.name || asset.prompt}</span>{" "}
          with the closest color in the chosen palette. Result saves as a new asset.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {BUILT_IN_PALETTES.map((p) => (
            <button
              key={p.id}
              disabled={busy}
              onClick={() => applyAndClose(p)}
              className="bg-farm-ink/60 border-2 border-farm-wood hover:border-farm-grass p-2 text-left disabled:opacity-50"
            >
              <div className="aspect-square bg-checker mb-1 overflow-hidden">
                {previews[p.id] ? (
                  <img src={previews[p.id]} alt="" className="pixelated w-full h-full" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs opacity-40">
                    rendering…
                  </div>
                )}
              </div>
              <div className="text-sm">{p.name}</div>
              <div className="flex gap-px mt-1 h-2">
                {p.colors.slice(0, 16).map((c, i) => (
                  <div
                    key={i}
                    className="flex-1"
                    style={{ background: `rgb(${c[0]}, ${c[1]}, ${c[2]})` }}
                  />
                ))}
              </div>
            </button>
          ))}

          <div className="bg-farm-ink/60 border-2 border-farm-wood/60 border-dashed p-2 text-sm">
            <div className="opacity-70 mb-2">Custom palette from image</div>
            <label className="px-2 py-1 border border-farm-grass/70 text-farm-grass cursor-pointer hover:bg-farm-grass/10 inline-block text-xs">
              Upload reference
              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            </label>
            {customColors && (
              <div className="mt-2 space-y-2">
                <div className="flex gap-px h-2">
                  {customColors.map((c, i) => (
                    <div
                      key={i}
                      className="flex-1"
                      style={{ background: `rgb(${c[0]}, ${c[1]}, ${c[2]})` }}
                    />
                  ))}
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    applyAndClose({ id: "custom", name: `Custom (${customColors.length})`, colors: customColors })
                  }
                  className="text-xs px-2 py-1 border border-farm-grass text-farm-grass hover:bg-farm-grass/10"
                >
                  Apply this palette
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type SettingsPrefs = {
  openaiKey: string;
  falKey: string;
  imageProvider: "openai" | "fal";
};

function SettingsModal({
  initialKey,
  initialFalKey,
  initialProvider,
  onClose,
  onSave,
}: {
  initialKey: string;
  initialFalKey: string;
  initialProvider: "openai" | "fal";
  onClose: () => void;
  onSave: (prefs: SettingsPrefs) => void;
}) {
  const [draft, setDraft] = useState(initialKey);
  const [falDraft, setFalDraft] = useState(initialFalKey);
  const [provider, setProvider] = useState<"openai" | "fal">(initialProvider);
  const [show, setShow] = useState(false);
  const [showFal, setShowFal] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [falTestStatus, setFalTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [falTestMsg, setFalTestMsg] = useState("");

  async function testConnection() {
    const key = draft.trim();
    if (!key) {
      setTestStatus("fail");
      setTestMsg("Enter a key first.");
      return;
    }
    setTestStatus("testing");
    setTestMsg("");
    try {
      const res = await fetch("/api/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-openai-key": key },
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setTestStatus("ok");
        setTestMsg("Connected. Key accepted by OpenAI.");
      } else {
        setTestStatus("fail");
        setTestMsg(data.error || "Unknown error");
      }
    } catch (err) {
      setTestStatus("fail");
      setTestMsg(err instanceof Error ? err.message : "Network error");
    }
  }

  async function testFalConnection() {
    const key = falDraft.trim();
    if (!key) {
      setFalTestStatus("fail");
      setFalTestMsg("Enter a key first.");
      return;
    }
    setFalTestStatus("testing");
    setFalTestMsg("");
    try {
      const res = await fetch("/api/test-fal-key", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-fal-key": key },
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setFalTestStatus("ok");
        setFalTestMsg("Connected. Key accepted by FAL.");
      } else {
        setFalTestStatus("fail");
        setFalTestMsg(data.error || "Unknown error");
      }
    } catch (err) {
      setFalTestStatus("fail");
      setFalTestMsg(err instanceof Error ? err.message : "Network error");
    }
  }

  // Reset status if the user edits the key after running a test.
  useEffect(() => {
    if (testStatus !== "idle") {
      setTestStatus("idle");
      setTestMsg("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  useEffect(() => {
    if (falTestStatus !== "idle") {
      setFalTestStatus("idle");
      setFalTestMsg("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [falDraft]);

  function commit(next?: Partial<SettingsPrefs>) {
    onSave({
      openaiKey: draft.trim(),
      falKey: falDraft.trim(),
      imageProvider: provider,
      ...next,
    });
  }
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-farm-ink border-2 border-farm-wood w-full max-w-lg p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-pixel text-xl text-farm-grass">⚙ Settings</h2>
            <p className="text-xs opacity-70 mt-1">
              Bring your own API key. Stored in your browser only — never sent anywhere except the chosen provider.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-farm-parchment/70 hover:text-farm-parchment text-xl leading-none px-2"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-2">
          <label className="block text-xs uppercase tracking-wide opacity-70">
            Image model
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            <label className="flex items-start gap-2 px-2 py-1.5 border border-farm-wood/60 hover:border-farm-grass cursor-pointer">
              <input
                type="radio"
                name="image-provider"
                value="openai"
                checked={provider === "openai"}
                onChange={() => setProvider("openai")}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-sm">OpenAI gpt-image-1</div>
                <div className="text-[11px] opacity-60">Highest quality. ~$0.04 / image. Sprite-sheets, refs, masks.</div>
              </div>
            </label>
            <label className="flex items-start gap-2 px-2 py-1.5 border border-farm-wood/60 hover:border-farm-grass cursor-pointer">
              <input
                type="radio"
                name="image-provider"
                value="fal"
                checked={provider === "fal"}
                onChange={() => setProvider("fal")}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-sm">FAL Flux Schnell <span className="opacity-60">(fast/cheap)</span></div>
                <div className="text-[11px] opacity-60">~$0.003 / image, ~2-5s. Single images only — no sprite-sheets.</div>
              </div>
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs uppercase tracking-wide opacity-70">
            OpenAI API key
          </label>
          <div className="flex gap-2">
            <input
              type={show ? "text" : "password"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="sk-proj-…"
              className="flex-1 bg-farm-bg/40 border border-farm-wood text-farm-parchment text-sm px-2 py-1.5 focus:outline-none focus:border-farm-grass font-mono"
              autoFocus
            />
            <button
              onClick={() => setShow((v) => !v)}
              className="px-2 py-1 text-xs border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
              title={show ? "Hide" : "Show"}
            >
              {show ? "🙈" : "👁"}
            </button>
            <button
              type="button"
              onClick={testConnection}
              disabled={testStatus === "testing" || !draft.trim()}
              className="px-2 py-1 text-xs border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass disabled:opacity-40 disabled:cursor-not-allowed"
              title="Verify the key against OpenAI"
            >
              {testStatus === "testing" ? "⏳" : "Test"}
            </button>
          </div>
          {testStatus !== "idle" && (
            <div
              className={
                "text-[11px] " +
                (testStatus === "ok"
                  ? "text-farm-grass"
                  : testStatus === "fail"
                  ? "text-red-300"
                  : "opacity-70")
              }
            >
              {testStatus === "testing" && "Testing…"}
              {testStatus === "ok" && `✓ ${testMsg}`}
              {testStatus === "fail" && `✗ ${testMsg}`}
            </div>
          )}
          <p className="text-[11px] opacity-60">
            Get a key at{" "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-farm-grass"
            >
              platform.openai.com/api-keys
            </a>
            . Image generation requires{" "}
            <a
              href="https://platform.openai.com/settings/organization/general"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-farm-grass"
            >
              organization verification
            </a>
            . Your key never leaves your browser except in requests to OpenAI's API.
          </p>
        </div>

        {provider === "fal" && (
          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wide opacity-70">
              FAL API key
            </label>
            <div className="flex gap-2">
              <input
                type={showFal ? "text" : "password"}
                value={falDraft}
                onChange={(e) => setFalDraft(e.target.value)}
                placeholder="fal-key-…"
                className="flex-1 bg-farm-bg/40 border border-farm-wood text-farm-parchment text-sm px-2 py-1.5 focus:outline-none focus:border-farm-grass font-mono"
              />
              <button
                onClick={() => setShowFal((v) => !v)}
                className="px-2 py-1 text-xs border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                title={showFal ? "Hide" : "Show"}
              >
                {showFal ? "🙈" : "👁"}
              </button>
              <button
                type="button"
                onClick={testFalConnection}
                disabled={falTestStatus === "testing" || !falDraft.trim()}
                className="px-2 py-1 text-xs border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass disabled:opacity-40 disabled:cursor-not-allowed"
                title="Verify the key against FAL"
              >
                {falTestStatus === "testing" ? "⏳" : "Test"}
              </button>
            </div>
            {falTestStatus !== "idle" && (
              <div
                className={
                  "text-[11px] " +
                  (falTestStatus === "ok"
                    ? "text-farm-grass"
                    : falTestStatus === "fail"
                    ? "text-red-300"
                    : "opacity-70")
                }
              >
                {falTestStatus === "testing" && "Testing…"}
                {falTestStatus === "ok" && `✓ ${falTestMsg}`}
                {falTestStatus === "fail" && `✗ ${falTestMsg}`}
              </div>
            )}
            <p className="text-[11px] opacity-60">
              Get a key at{" "}
              <a
                href="https://fal.ai/dashboard/keys"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-farm-grass"
              >
                fal.ai/dashboard/keys
              </a>
              . Stored in your browser only.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-farm-wood/40">
          <button
            onClick={() => {
              setDraft("");
              setFalDraft("");
              onSave({ openaiKey: "", falKey: "", imageProvider: provider });
            }}
            className="text-xs text-red-300 opacity-70 hover:opacity-100"
            title="Remove all saved keys"
          >
            Clear keys
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1 text-sm border border-farm-wood/60 hover:border-farm-grass"
            >
              Cancel
            </button>
            <button
              onClick={() => commit()}
              className="px-3 py-1 text-sm border border-farm-grass bg-farm-grass/20 text-farm-grass hover:bg-farm-grass/30"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrashModal({
  trashed,
  onClose,
  onRestore,
  onEmpty,
}: {
  trashed: Asset[];
  onClose: () => void;
  onRestore: (id: string) => void;
  onEmpty: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-farm-ink border-2 border-farm-wood w-full max-w-2xl max-h-[80vh] overflow-y-auto p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-pixel text-xl text-farm-grass">🗑 Trash</h2>
            <p className="text-xs opacity-70 mt-1">
              Recently deleted assets. Trash is cleared when you reload the page.
              Scenes still using a trashed asset will continue rendering it until trash is emptied.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-farm-parchment/70 hover:text-farm-parchment text-xl leading-none px-2"
            title="Close"
          >
            ×
          </button>
        </div>

        {trashed.length === 0 ? (
          <div className="opacity-60 text-center py-8">Nothing in trash.</div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {trashed.map((a) => (
              <div
                key={a.id}
                className="bg-farm-bg/40 border border-farm-wood/60 p-2 flex flex-col gap-1"
              >
                <div className="aspect-square bg-checker flex items-center justify-center overflow-hidden">
                  <img src={a.pixelUrl} alt={a.prompt} className="pixelated max-w-full max-h-full" />
                </div>
                <div className="text-[11px] truncate" title={a.name || a.prompt}>
                  {a.name || a.prompt}
                </div>
                <button
                  onClick={() => onRestore(a.id)}
                  className="text-[11px] px-1.5 py-0.5 border border-farm-grass/70 text-farm-grass hover:bg-farm-grass/10"
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}

        {trashed.length > 0 && (
          <div className="flex items-center justify-between pt-2 border-t border-farm-wood/40">
            <span className="text-xs opacity-60">{trashed.length} asset{trashed.length > 1 ? "s" : ""}</span>
            <button
              onClick={onEmpty}
              className="text-xs px-3 py-1 border border-red-700 text-red-300 hover:bg-red-700/20"
            >
              Empty trash
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const ONBOARDING_STEPS = [
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

function OnboardingModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const isLast = step === ONBOARDING_STEPS.length - 1;
  const { title, body } = ONBOARDING_STEPS[step];
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-farm-ink border-2 border-farm-wood w-full max-w-md p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="font-pixel text-lg text-farm-grass leading-snug">Welcome to Pixel Play</h2>
          <button
            onClick={onClose}
            className="text-farm-parchment/70 hover:text-farm-parchment text-xl leading-none px-2 ml-2 shrink-0"
            title="Dismiss"
          >
            ×
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-farm-parchment">{title}</p>
          <p className="text-sm opacity-80 leading-relaxed">{body}</p>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-1">
            {ONBOARDING_STEPS.map((_, i) => (
              <span
                key={i}
                className={`inline-block w-2 h-2 rounded-full ${i === step ? "bg-farm-grass" : "bg-farm-wood"}`}
              />
            ))}
          </div>
          {isLast ? (
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm border border-farm-grass text-farm-grass hover:bg-farm-grass/20 font-pixel"
            >
              Get started
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="px-4 py-1.5 text-sm border border-farm-wood text-farm-parchment hover:border-farm-grass hover:text-farm-grass"
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Concierge agent drawer — appears between the chat-history scroller
 *  and the FORGE form when toggled open. Renders the running message log
 *  (user / assistant / tool-call / error chips) and a small composer
 *  input. Tool execution itself lands in the next roadmap item; this
 *  drawer just streams text + surfaces tool-call chips. */
function AgentDrawer({
  messages,
  input,
  busy,
  scrollRef,
  onChangeInput,
  onSend,
  onClear,
  onClose,
}: {
  messages: AgentMsg[];
  input: string;
  busy: boolean;
  scrollRef: React.RefObject<HTMLDivElement>;
  onChangeInput: (v: string) => void;
  onSend: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="border-2 border-farm-wood bg-farm-ink/40 mb-3">
      <div className="flex items-center justify-between px-2 py-1 border-b border-farm-wood/60 text-xs">
        <span className="opacity-70">🤖 Concierge agent</span>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              disabled={busy}
              title="Clear conversation"
              className="px-1.5 py-0.5 opacity-60 hover:opacity-100 disabled:opacity-30"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close drawer"
            className="px-1.5 py-0.5 opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="max-h-48 overflow-y-auto px-2 py-2 space-y-1.5 text-xs"
      >
        {messages.length === 0 && (
          <p className="opacity-50 italic">
            Ask the agent for a batch — e.g. &ldquo;make me a cozy forest tileset&rdquo;.
          </p>
        )}
        {messages.map((m, i) => {
          if (m.kind === "user") {
            return (
              <div key={i} className="flex justify-end">
                <span className="px-2 py-1 bg-farm-grass/20 border border-farm-grass/60 text-farm-grass max-w-[85%] whitespace-pre-wrap">
                  {m.text}
                </span>
              </div>
            );
          }
          if (m.kind === "assistant") {
            return (
              <div key={i} className="flex justify-start">
                <span className="px-2 py-1 bg-farm-wood/30 border border-farm-wood max-w-[85%] whitespace-pre-wrap">
                  {m.text || (m.streaming ? "…" : "")}
                </span>
              </div>
            );
          }
          if (m.kind === "tool_call") {
            const preview = formatAgentToolPreview(m.name, m.args);
            return (
              <div key={i} className="flex justify-start">
                <span className="px-2 py-0.5 bg-farm-sky/15 border border-farm-sky/60 text-farm-sky font-mono">
                  ⚙ {m.name}
                  {preview ? `: ${preview}` : ""}
                </span>
              </div>
            );
          }
          if (m.kind === "tool_result") {
            const preview = m.result.length > 80
              ? `${m.result.slice(0, 80)}…`
              : m.result;
            return (
              <div key={i} className="flex justify-start">
                <span className="px-2 py-0.5 bg-farm-grass/10 border border-farm-grass/40 text-farm-grass/90 font-mono">
                  ↳ {m.name}: {preview}
                </span>
              </div>
            );
          }
          // error
          return (
            <div key={i} className="flex justify-start">
              <span className="px-2 py-0.5 bg-red-900/30 border border-red-500/60 text-red-300">
                ⚠ {m.text}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 p-2 border-t border-farm-wood/60">
        <input
          type="text"
          value={input}
          onChange={(e) => onChangeInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="Ask the agent…"
          disabled={busy}
          className="flex-1 bg-farm-ink/60 border border-farm-wood px-2 py-1 text-xs text-farm-parchment focus:outline-none focus:border-farm-grass disabled:opacity-50"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={busy || !input.trim()}
          className="px-3 py-1 text-xs border border-farm-grass text-farm-grass hover:bg-farm-grass/20 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

/** One-line summary for a tool-call chip, e.g. `forge_asset` shows the
 *  prompt; `apply_recipe` shows the recipe ref; `set_project_memory`
 *  shows the first chunk of the new memory. Falls back to the raw JSON
 *  arguments on unknown shapes. */
function formatAgentToolPreview(name: string, args: unknown): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<
    string,
    unknown
  >;
  if (name === "forge_asset") {
    const prompt = typeof a.prompt === "string" ? a.prompt : "";
    const mode = typeof a.mode === "string" ? a.mode : "";
    return [mode, prompt].filter(Boolean).join(" — ").slice(0, 80);
  }
  if (name === "apply_recipe") {
    return typeof a.recipe === "string" ? a.recipe.slice(0, 60) : "";
  }
  if (name === "set_project_memory") {
    return typeof a.memory === "string" ? a.memory.slice(0, 60) : "";
  }
  if (name === "list_assets") return "";
  try {
    return JSON.stringify(a).slice(0, 80);
  } catch {
    return "";
  }
}

/** Tiny "💾 142 MB / 2 GB" line in the header. Polls `navigator.storage
 *  .estimate()` every 30 s. Returns null silently if the browser doesn't
 *  expose the API (older Safari) — better to hide than show ?? values. */
function StorageIndicator() {
  const [usage, setUsage] = useState<number | null>(null);
  const [quota, setQuota] = useState<number | null>(null);
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return;
    let cancelled = false;
    async function fetchOnce() {
      try {
        const e = await navigator.storage.estimate();
        if (cancelled) return;
        setUsage(typeof e.usage === "number" ? e.usage : null);
        setQuota(typeof e.quota === "number" ? e.quota : null);
      } catch {
        /* ignore — quota API can throw on some private-mode contexts */
      }
    }
    fetchOnce();
    const id = setInterval(fetchOnce, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  if (usage == null || quota == null || quota <= 0) return null;
  const ratio = usage / quota;
  const tone =
    ratio > 0.95
      ? "text-red-300"
      : ratio > 0.8
      ? "text-yellow-300"
      : "opacity-60";
  return (
    <div
      className={`text-[10px] font-mono ${tone}`}
      title={`Browser storage: ${(usage / 1048576).toFixed(0)} MB used of ${(quota / 1073741824).toFixed(1)} GB available (${(ratio * 100).toFixed(1)}%)`}
    >
      💾 {formatStorageBytes(usage)} / {formatStorageBytes(quota)}
    </div>
  );
}

function formatStorageBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function CostIndicator({
  session,
  project,
}: {
  session: SessionState;
  project: { cost: number; calls: number; byTier?: { low: number; medium: number; high: number; chat: number } };
}) {
  const tier = project.byTier;
  const tooltip = [
    `This session: ${session.calls} calls`,
    `Project lifetime: ${project.calls} calls`,
    "",
    "Project breakdown:",
    tier ? `  Low: ${formatDollars(tier.low)}` : null,
    tier ? `  Medium: ${formatDollars(tier.medium)}` : null,
    tier ? `  High: ${formatDollars(tier.high)}` : null,
    tier ? `  Chat (parsing/layout): ${formatDollars(tier.chat)}` : null,
  ].filter(Boolean).join("\n");
  return (
    <div className="text-[11px] opacity-60 flex items-center gap-2" title={tooltip}>
      <span>💰 session {formatDollars(session.cost)}</span>
      {project.cost > 0 && (
        <span className="opacity-70">/ project {formatDollars(project.cost)}</span>
      )}
    </div>
  );
}

function RecipesView({
  recipes,
  onApply,
  onDelete,
}: {
  recipes: Record<string, Recipe>;
  onApply: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const list = Object.values(recipes).sort(
    (a, b) => b.usageCount - a.usageCount || b.createdAt - a.createdAt
  );
  if (list.length === 0) {
    return (
      <div className="opacity-60 text-center py-12 text-sm">
        <div className="text-6xl mb-3">📋</div>
        <p>No recipes yet.</p>
        <p className="text-xs mt-2 opacity-80">
          Tweak the form, then click 💾 next to the Type buttons to save it
          as a one-click recipe. Useful when you keep coming back to the
          same prompt pattern.
        </p>
      </div>
    );
  }
  const modeEmoji: Record<GenMode, string> = {
    item: "🌽",
    character: "🧑‍🌾",
    scene: "🎬",
  };
  return (
    <div className="space-y-2">
      {list.map((r) => (
        <div
          key={r.id}
          className="border-2 border-farm-wood/60 bg-farm-ink/30 p-2 space-y-1"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none">{modeEmoji[r.mode]}</span>
            <span className="font-pixel text-sm text-farm-grass flex-1 truncate">
              {r.name}
            </span>
            <span className="text-[10px] opacity-50 tabular-nums">
              {r.usageCount}× used
            </span>
            <button
              type="button"
              onClick={() => onApply(r.id)}
              title="Apply this recipe — fills the form with its values"
              className="text-xs px-2 py-0.5 border border-farm-grass text-farm-grass bg-farm-grass/10 hover:bg-farm-grass/20"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete recipe "${r.name}"?`)) onDelete(r.id);
              }}
              title="Delete recipe"
              className="text-xs px-1.5 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
            >
              ✕
            </button>
          </div>
          <div className="text-xs opacity-70 truncate" title={r.prompt}>
            {r.prompt || <span className="opacity-50">(no prompt)</span>}
          </div>
          {r.description && (
            <div className="text-[10px] opacity-50 italic">{r.description}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function ProjectStyleSection({
  open,
  onToggle,
  style,
  onChangeText,
  onChangePreset,
  onClearRef,
  onUploadRef,
  hasConfig,
  memory,
  onChangeMemory,
}: {
  open: boolean;
  onToggle: () => void;
  style: ProjectStyle;
  onChangeText: (text: string) => void;
  onChangePreset: (preset: StylePreset) => void;
  onClearRef: () => void;
  onUploadRef: (e: React.ChangeEvent<HTMLInputElement>) => void;
  hasConfig: boolean;
  /** The effective project memory blob (pulled from getEffectiveProjectMemory).
   *  May be empty string. */
  memory: string;
  onChangeMemory: (text: string) => void;
}) {
  const presetLabel = STYLE_PRESETS.find((p) => p.value === style.preset)?.label || "Cozy";
  return (
    <div className="border-2 border-farm-wood/60 bg-farm-ink/30">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-1 text-sm hover:bg-farm-wood/20"
      >
        <span>
          🎨 Project style — <span className="opacity-70">{presetLabel}</span>
          {hasConfig && <span className="text-farm-grass text-xs ml-1">active</span>}
        </span>
        <span className="opacity-60">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="p-3 space-y-2 text-sm border-t border-farm-wood/40">
          {/* Preset */}
          <div>
            <div className="text-xs opacity-70 mb-1">Preset:</div>
            <div className="flex flex-wrap gap-1">
              {STYLE_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => onChangePreset(p.value)}
                  title={p.hint}
                  className={`px-2 py-0.5 border text-xs ${
                    style.preset === p.value
                      ? "border-farm-grass text-farm-grass bg-farm-grass/10"
                      : "border-farm-wood/60"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <p className="opacity-70 text-xs">
            Style descriptor and reference are appended to every prompt.
          </p>
          <textarea
            value={style.text}
            onChange={(e) => onChangeText(e.target.value)}
            placeholder="e.g. muted earth tones, hand-drawn texture, soft outline"
            rows={2}
            className="w-full bg-farm-ink/60 border-2 border-farm-wood p-2 focus:outline-none focus:border-farm-grass resize-none"
          />
          <div className="flex items-center gap-2">
            {style.refUrl ? (
              <>
                <img src={style.refUrl} alt="style" className="pixelated w-12 h-12 object-contain bg-farm-ink" />
                <span className="opacity-70 text-xs flex-1">Style reference set</span>
                <button
                  type="button"
                  onClick={onClearRef}
                  className="text-xs px-2 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
                >
                  Clear
                </button>
              </>
            ) : (
              <label className="px-2 py-0.5 border border-farm-grass/70 text-farm-grass cursor-pointer hover:bg-farm-grass/10 text-xs">
                Upload reference image
                <input type="file" accept="image/*" className="hidden" onChange={onUploadRef} />
              </label>
            )}
          </div>

          {/* Project MEMORY blob — Hermes-style frozen-into-prompt knowledge. */}
          <div className="pt-2 border-t border-farm-wood/40 space-y-1">
            <div className="text-xs opacity-70">🧠 Project memory:</div>
            <textarea
              value={memory}
              onChange={(e) => onChangeMemory(e.target.value)}
              placeholder="Things learned about this project — naming conventions, palette, recurring characters… Edit me or let Pixel Play update it after good generations."
              rows={3}
              maxLength={PROJECT_MEMORY_CAP}
              className="w-full bg-farm-ink/60 border-2 border-farm-wood p-2 text-xs focus:outline-none focus:border-farm-grass resize-none"
            />
            <div
              className={`text-[10px] tabular-nums text-right ${
                memory.length > PROJECT_MEMORY_CAP * 0.9
                  ? "text-yellow-300"
                  : "opacity-50"
              }`}
            >
              {memory.length} / {PROJECT_MEMORY_CAP}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatBubble({
  message,
  assetIds,
  assets,
}: {
  message: ChatMessage;
  assetIds?: string[];
  assets: Record<string, Asset>;
}) {
  const isUser = message.role === "user";
  const isError = message.role === "assistant" && message.error;
  // Map an asset's stored assetType (which may be a legacy value like
  // "tile" or "creature") to a display chip for chat-message metadata.
  const typeMeta =
    message.role === "user"
      ? {
          character: { emoji: "🧑‍🌾", label: "Character" },
          item: { emoji: "🌽", label: "Item" },
          tile: { emoji: "🟫", label: "Tile" },
          building: { emoji: "🏠", label: "Building" },
          creature: { emoji: "🐔", label: "Creature" },
          ui: { emoji: "🔔", label: "UI Icon" },
        }[message.assetType as AssetType]
      : undefined;
  const renderedAssets = (assetIds || [])
    .map((id) => assets[id])
    .filter((a): a is Asset => Boolean(a));
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-3 py-2 border-2 ${
          isUser
            ? "bg-farm-grass/20 border-farm-grass"
            : isError
            ? "bg-red-900/40 border-red-700 text-red-200"
            : "bg-farm-wood/30 border-farm-wood"
        }`}
      >
        {typeMeta && message.role === "user" && (
          <div className="text-xs opacity-60 mb-1">
            {typeMeta.emoji} {typeMeta.label} · {message.perspective}
            {message.pose !== "single" ? ` · ${message.pose}` : ""}
            {message.mode === "edit" ? " · ✏️ edit" : ""}
          </div>
        )}
        <div className="text-lg leading-snug">{message.text}</div>
        {renderedAssets.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {renderedAssets.map((a) => (
              <div key={a.id} className="inline-block bg-farm-ink/40 p-1 border-2 border-farm-ink">
                <img
                  src={a.pixelUrl}
                  alt={a.prompt}
                  className="pixelated max-w-full max-h-48"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScenesView({
  scenes,
  assets,
  activeSceneId,
  onSelectScene,
  onDeleteScene,
  onExportScene,
  onExportTiledJson,
  activeScene,
  selectedSceneItem,
  selectedSceneItemIds,
  onSelectSceneItem,
  onSelectionChange,
  onDropAsset,
  snap,
  onSnapChange,
  zoom,
  onZoomChange,
  onClearBackground,
  onMoveSceneItem,
  onMoveSceneItems,
  onRotateSceneItem,
  onUpdateSceneItemScale,
  onBumpSceneItemZ,
  onToggleAnimating,
  onDeleteSceneItem,
  onDuplicateSceneItem,
  onReorderSceneItems,
  onToggleSolid,
  onToggleFlipX,
  onToggleFlipY,
  onTogglePickable,
  onToggleAnchor,
  onSetLinkScene,
  onSetPatrol,
  onSetTriggerMessage,
  onSetDialogue,
  onSetUseMessage,
  onSetUseStateAssetId,
  onAddTriggerZone,
  onAddPointLight,
  onSetLight,
  onAddParticleEmitter,
  onSetEmitter,
  onAddSoundTrigger,
  onSetSound,
  onSetDaytime,
  paintMode,
  onPaintModeChange,
  activeTileLayerId,
  onActiveTileLayerChange,
  onAddTileLayer,
  onRemoveTileLayer,
  onRenameTileLayer,
  onSetLayerTileAsset,
  onToggleLayerVisible,
  onReorderTileLayers,
  onPaintCell,
  onEraseCell,
  onFillRect,
  onFillLayer,
  onSetTileSize,
  prefabs,
  onSavePrefab,
  onDeletePrefab,
  onInstantiatePrefab,
  onSyncPrefabInstances,
  playMode,
  onPlayModeChange,
  activeCharacterId,
  onActiveCharacterChange,
  onUpdateCharacterPos,
  onPortalEnter,
  replacePrompt,
  setReplacePrompt,
  onReplaceItem,
  onEnsurePlayer,
  onCopySelected,
  onPaste,
  clipboardSize,
  onClearFailedItems,
  onDuplicateScene,
  onRenameScene,
}: {
  scenes: Record<string, Scene>;
  assets: Record<string, Asset>;
  activeSceneId: string | null;
  onSelectScene: (id: string | null) => void;
  onDeleteScene: (id: string) => void;
  onExportScene: (id: string) => void;
  onExportTiledJson: (id: string) => void;
  activeScene: Scene | null;
  selectedSceneItem: SceneItem | null;
  selectedSceneItemIds: string[];
  onSelectSceneItem: (id: string | null) => void;
  onSelectionChange: (ids: string[]) => void;
  onDropAsset: (assetId: string, x: number, y: number) => void;
  snap: number;
  onSnapChange: (n: number) => void;
  zoom: number;
  onZoomChange: (n: number) => void;
  onClearBackground: () => void;
  onMoveSceneItem: (id: string, x: number, y: number) => void;
  onMoveSceneItems: (updates: Array<{ id: string; x: number; y: number }>) => void;
  onRotateSceneItem: (id: string, deg: number) => void;
  onUpdateSceneItemScale: (id: string, scale: number) => void;
  onBumpSceneItemZ: (id: string, delta: number) => void;
  onToggleAnimating: (id: string) => void;
  onDeleteSceneItem: (id: string) => void;
  onDuplicateSceneItem: (id: string) => void;
  onReorderSceneItems: (from: number, to: number) => void;
  onToggleSolid: (id: string) => void;
  onToggleFlipX: (id: string) => void;
  onToggleFlipY: (id: string) => void;
  onTogglePickable: (id: string) => void;
  onToggleAnchor: (id: string) => void;
  onSetLinkScene: (id: string, linkId: string | undefined) => void;
  onSetPatrol: (id: string, patrol: SceneItem["patrol"]) => void;
  onSetTriggerMessage: (id: string, msg: string) => void;
  onSetDialogue: (id: string, dialogue: string) => void;
  onSetUseMessage: (id: string, msg: string) => void;
  onSetUseStateAssetId: (id: string, altAssetId: string | undefined) => void;
  onAddTriggerZone: () => void;
  onAddPointLight: () => void;
  onSetLight: (id: string, light: SceneItem["light"]) => void;
  onAddParticleEmitter: () => void;
  onSetEmitter: (id: string, emitter: SceneItem["emitter"]) => void;
  onAddSoundTrigger: () => void;
  onSetSound: (id: string, sound: SceneItem["sound"]) => void;
  onSetDaytime: (d: number) => void;
  paintMode: "off" | "paint" | "erase" | "fillrect";
  onPaintModeChange: (m: "off" | "paint" | "erase" | "fillrect") => void;
  activeTileLayerId: string | null;
  onActiveTileLayerChange: (id: string | null) => void;
  onAddTileLayer: (tileAssetId?: string) => void;
  onRemoveTileLayer: (layerId: string) => void;
  onRenameTileLayer: (layerId: string, name: string) => void;
  onSetLayerTileAsset: (layerId: string, tileAssetId: string) => void;
  onToggleLayerVisible: (layerId: string) => void;
  onReorderTileLayers: (from: number, to: number) => void;
  onPaintCell: (layerId: string, x: number, y: number) => void;
  onEraseCell: (layerId: string, x: number, y: number) => void;
  onFillRect: (layerId: string, x0: number, y0: number, x1: number, y1: number) => void;
  onFillLayer: (layerId: string) => void;
  onSetTileSize: (n: number) => void;
  prefabs: Record<string, Prefab>;
  onSavePrefab: (name: string, items: SceneItem[]) => void;
  onDeletePrefab: (prefabId: string) => void;
  onInstantiatePrefab: (prefabId: string, x: number, y: number) => void;
  onSyncPrefabInstances: (prefabId: string) => void;
  playMode: boolean;
  onPlayModeChange: (b: boolean) => void;
  activeCharacterId: string | null;
  onActiveCharacterChange: (id: string | null) => void;
  onUpdateCharacterPos: (id: string, x: number, y: number) => void;
  onPortalEnter: (targetSceneId: string) => void;
  replacePrompt: string;
  setReplacePrompt: (s: string) => void;
  onReplaceItem: () => void;
  /** Called when Play is clicked but the scene has no character. Should
   *  add one and return its id. Returns null if the call failed. */
  onEnsurePlayer: () => string | null;
  onCopySelected: () => void;
  onPaste: () => void;
  clipboardSize: number;
  onClearFailedItems: (sceneId: string) => void;
  onDuplicateScene: (sceneId: string) => void;
  onRenameScene: (sceneId: string, name: string) => void;
}) {
  const [failedItemsOpen, setFailedItemsOpen] = useState(false);
  const [editingSceneName, setEditingSceneName] = useState(false);
  /** Sound-trigger preview state. Holds the currently-playing item's id so
   *  the button can render ▶/⏸. Audio element lives in a ref so React
   *  re-renders don't restart playback. */
  const [previewingSoundId, setPreviewingSoundId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  // Stop preview when the panel closes / a different item is selected.
  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
    };
  }, []);
  const [sceneNameDraft, setSceneNameDraft] = useState("");
  const sceneList = Object.values(scenes).sort((a, b) => b.createdAt - a.createdAt);
  const canvasAssets: Record<string, CanvasAsset> = {};
  for (const [id, a] of Object.entries(assets)) {
    canvasAssets[id] = {
      id: a.id,
      rawUrl: a.rawUrl,
      pixelUrl: a.pixelUrl,
      cols: a.cols,
      rows: a.rows,
      sourceSize: a.sourceSize,
    };
  }
  const selectedAsset = selectedSceneItem ? assets[selectedSceneItem.assetId] : null;
  // Hierarchy still highlights a single row; use the first selection or none.
  const selectedSceneItemId =
    selectedSceneItemIds.length === 1 ? selectedSceneItemIds[0] : null;

  if (sceneList.length === 0) {
    return (
      <div className="opacity-60 text-center py-12">
        <div className="text-6xl mb-3">🎬</div>
        <p>No scenes yet.</p>
        <p className="text-xs mt-2">
          Try Generate + 🪄 Split items + Auto-compose.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Scene picker */}
      <div className="flex items-center gap-2 text-sm">
        {editingSceneName && activeScene ? (
          <input
            autoFocus
            type="text"
            value={sceneNameDraft}
            onChange={(e) => setSceneNameDraft(e.target.value)}
            onBlur={() => {
              if (activeScene && sceneNameDraft.trim()) {
                onRenameScene(activeScene.id, sceneNameDraft);
              }
              setEditingSceneName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (activeScene && sceneNameDraft.trim()) {
                  onRenameScene(activeScene.id, sceneNameDraft);
                }
                setEditingSceneName(false);
              } else if (e.key === "Escape") {
                setEditingSceneName(false);
              }
            }}
            className="bg-farm-ink border border-farm-grass text-farm-parchment px-2 py-1 flex-1 focus:outline-none"
          />
        ) : (
          <select
            value={activeSceneId || ""}
            onChange={(e) => onSelectScene(e.target.value || null)}
            className="bg-farm-ink border border-farm-wood text-farm-parchment px-2 py-1 flex-1"
          >
            <option value="">— pick a scene —</option>
            {sceneList.map((s) => (
              <option key={s.id} value={s.id}>
                🎬 {s.name} ({s.items.length} items)
              </option>
            ))}
          </select>
        )}
        {activeScene && !editingSceneName && (
          <>
            <button
              type="button"
              onClick={() => {
                setSceneNameDraft(activeScene.name);
                setEditingSceneName(true);
              }}
              title="Rename scene"
              className="px-2 py-1 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass text-xs"
            >
              ✎
            </button>
            <button
              type="button"
              onClick={() => onDuplicateScene(activeScene.id)}
              title={`Duplicate "${activeScene.name}"`}
              className="px-2 py-1 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass text-xs"
            >
              ⎘
            </button>
            {activeScene.failedItems && activeScene.failedItems.length > 0 && (
              <button
                type="button"
                onClick={() => setFailedItemsOpen(true)}
                title="Some items failed to generate. Click to review."
                className="px-2 py-1 border border-yellow-500/70 text-yellow-200 bg-yellow-900/20 hover:bg-yellow-900/40 text-xs"
              >
                ⚠ {activeScene.failedItems.length} failed
              </button>
            )}
            <button
              type="button"
              onClick={() => onExportScene(activeScene.id)}
              title="Export scene + assets as zip"
              className="px-2 py-1 border border-farm-grass text-farm-grass hover:bg-farm-grass/10 text-xs"
            >
              ⬇ Export
            </button>
            <button
              type="button"
              onClick={() => onExportTiledJson(activeScene.id)}
              title="Export scene as Tiled 1.10 JSON (.tmj)"
              className="px-2 py-1 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass text-xs"
            >
              ⬇ Tiled JSON
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete scene "${activeScene.name}"?`)) onDeleteScene(activeScene.id);
              }}
              className="px-2 py-1 border border-farm-wood/60 hover:border-red-700 hover:text-red-300 text-xs"
            >
              🗑
            </button>
          </>
        )}
      </div>

      {activeScene ? (
        <>
          {/* Play / Edit toggle + active character picker */}
          {(() => {
            const characterCandidates = activeScene.items
              .map((it) => ({ it, a: assets[it.assetId] }))
              .filter(({ a }) => a && a.assetType === "character");
            const autoPicked =
              activeCharacterId && characterCandidates.some(({ it }) => it.id === activeCharacterId)
                ? activeCharacterId
                : characterCandidates[0]?.it.id || null;
            return (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onPlayModeChange(false)}
                    className={`px-2 py-1 border ${
                      !playMode ? "border-farm-grass text-farm-grass bg-farm-grass/10" : "border-farm-wood/60"
                    }`}
                  >
                    ✎ Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      let playerId = autoPicked;
                      if (!playerId) {
                        // No character in scene — let the parent spawn or
                        // place one (and possibly synthesize a default).
                        playerId = onEnsurePlayer();
                      }
                      if (!playerId) return; // bail only if ensure failed
                      if (activeCharacterId !== playerId) onActiveCharacterChange(playerId);
                      onPlayModeChange(true);
                    }}
                    className={`px-2 py-1 border ${
                      playMode ? "border-farm-grass text-farm-grass bg-farm-grass/10" : "border-farm-wood/60"
                    }`}
                  >
                    ▶ Play
                  </button>
                </div>
                {playMode && characterCandidates.length > 0 && (
                  <label className="flex items-center gap-1 opacity-80">
                    <span>Player:</span>
                    <select
                      value={activeCharacterId || ""}
                      onChange={(e) => onActiveCharacterChange(e.target.value || null)}
                      className="bg-farm-ink border border-farm-wood text-farm-parchment px-1 py-0.5"
                    >
                      {characterCandidates.map(({ it, a }) => (
                        <option key={it.id} value={it.id}>
                          {a?.name || a?.prompt}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            );
          })()}

          {playMode ? (
            <ScenePlayer
              scene={activeScene}
              assets={canvasAssets}
              activeCharacterId={activeCharacterId}
              onUpdateCharacterPos={onUpdateCharacterPos}
              onPortalEnter={onPortalEnter}
            />
          ) : null}

          {!playMode && activeScene.backgroundTileId && assets[activeScene.backgroundTileId] && (
            <div className="flex items-center gap-2 text-xs opacity-80">
              <img
                src={assets[activeScene.backgroundTileId].pixelUrl}
                alt=""
                className="pixelated w-8 h-8 object-cover bg-farm-ink"
              />
              <span>
                Background: {assets[activeScene.backgroundTileId].name || assets[activeScene.backgroundTileId].prompt}
              </span>
              <button
                type="button"
                onClick={onClearBackground}
                className="px-2 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
              >
                Clear
              </button>
            </div>
          )}
          {!playMode && <>
          {/* Item-level toolbar — replaces the old keyboard-shortcut text
              with actual buttons that operate on the current selection. */}
          {(() => {
            const hasSel = !!selectedSceneItem;
            const selN = selectedSceneItemIds.length;
            const selId = selectedSceneItem?.id;
            const tbBtn = (extra = "") =>
              `px-1.5 py-0.5 border text-[11px] ${extra} ${
                hasSel
                  ? "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                  : "border-farm-wood/30 text-farm-parchment/40 cursor-not-allowed"
              }`;
            return (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="opacity-50 mr-1">Selected{selN > 1 ? ` (${selN})` : ""}:</span>
                <button
                  type="button"
                  disabled={!hasSel}
                  onClick={() => selId && onBumpSceneItemZ(selId, 1)}
                  title="Bring forward (⌘])"
                  className={tbBtn()}
                >
                  ⬆ Front
                </button>
                <button
                  type="button"
                  disabled={!hasSel}
                  onClick={() => selId && onBumpSceneItemZ(selId, -1)}
                  title="Send backward (⌘[)"
                  className={tbBtn()}
                >
                  ⬇ Back
                </button>
                <button
                  type="button"
                  disabled={!hasSel}
                  onClick={() => selId && onDuplicateSceneItem(selId)}
                  title="Duplicate (⌘D)"
                  className={tbBtn()}
                >
                  ⎘ Dup
                </button>
                <button
                  type="button"
                  disabled={selN === 0}
                  onClick={onCopySelected}
                  title={`Copy ${selN > 1 ? `${selN} items` : "item"} (⌘C)`}
                  className={`px-1.5 py-0.5 border text-[11px] ${
                    selN > 0
                      ? "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                      : "border-farm-wood/30 text-farm-parchment/40 cursor-not-allowed"
                  }`}
                >
                  📋 Copy
                </button>
                <button
                  type="button"
                  disabled={clipboardSize === 0}
                  onClick={onPaste}
                  title={
                    clipboardSize > 0
                      ? `Paste ${clipboardSize} item${clipboardSize > 1 ? "s" : ""} (⌘V)`
                      : "Clipboard is empty"
                  }
                  className={`px-1.5 py-0.5 border text-[11px] ${
                    clipboardSize > 0
                      ? "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                      : "border-farm-wood/30 text-farm-parchment/40 cursor-not-allowed"
                  }`}
                >
                  📌 Paste{clipboardSize > 0 ? ` (${clipboardSize})` : ""}
                </button>
                <button
                  type="button"
                  disabled={!hasSel}
                  onClick={() => selId && onDeleteSceneItem(selId)}
                  title="Delete (Del)"
                  className={`px-1.5 py-0.5 border text-[11px] ${
                    hasSel
                      ? "border-farm-wood/60 hover:border-red-700 hover:text-red-300"
                      : "border-farm-wood/30 text-farm-parchment/40 cursor-not-allowed"
                  }`}
                >
                  🗑
                </button>
                <span className="opacity-40 ml-1">Arrows nudge · Esc deselect</span>
              </div>
            );
          })()}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] opacity-70">
            <span className="opacity-60">💡 Drag from 📦 Assets onto canvas.</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onAddTriggerZone}
                title="Add an invisible trigger zone (fires a message when the player enters in Play Mode)"
                className="px-2 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
              >
                ⚡ + Trigger
              </button>
              <button
                type="button"
                onClick={onAddPointLight}
                title="Add a point light (radial glow in Play Mode)"
                className="px-2 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
              >
                💡 + Light
              </button>
              <button
                type="button"
                onClick={onAddParticleEmitter}
                title="Add a particle emitter (sparkle/smoke in Play Mode)"
                className="px-2 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
              >
                ✨ + Emitter
              </button>
              <button
                type="button"
                onClick={onAddSoundTrigger}
                title="Add a sound trigger (audio plays when player enters its bbox in Play Mode)"
                className="px-2 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
              >
                🔊 + Sound
              </button>
              <label className="flex items-center gap-1" title="0=midnight · 0.5=noon · 1=midnight">
                ☀️
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={activeScene.daytime ?? 0.5}
                  onChange={(e) => onSetDaytime(Number(e.target.value))}
                  className="accent-farm-grass w-20"
                />
              </label>
              <div className="flex items-center gap-1">
                <span>Snap:</span>
                {[0, 8, 16, 32].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onSnapChange(n)}
                    className={`px-1.5 py-0.5 border ${
                      snap === n ? "border-farm-grass text-farm-grass" : "border-farm-wood/60"
                    }`}
                  >
                    {n === 0 ? "Off" : `${n}px`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span>Zoom:</span>
                {[1, 2, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onZoomChange(n)}
                    className={`px-1.5 py-0.5 border ${
                      zoom === n ? "border-farm-grass text-farm-grass" : "border-farm-wood/60"
                    }`}
                  >
                    {n}×
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* Tile painting controls bar — Phase 4 tile painter. */}
          <TilePaintBar
            scene={activeScene}
            tileAssets={Object.values(assets).filter((a) => a.assetType === "tile")}
            paintMode={paintMode}
            onPaintModeChange={onPaintModeChange}
            activeTileLayerId={activeTileLayerId}
            onActiveTileLayerChange={onActiveTileLayerChange}
            onAddTileLayer={onAddTileLayer}
            onRemoveTileLayer={onRemoveTileLayer}
            onRenameTileLayer={onRenameTileLayer}
            onSetLayerTileAsset={onSetLayerTileAsset}
            onToggleLayerVisible={onToggleLayerVisible}
            onReorderTileLayers={onReorderTileLayers}
            onSetTileSize={onSetTileSize}
            onFillLayer={onFillLayer}
          />
          <div className="overflow-auto">
            <SceneCanvas
              scene={activeScene}
              assets={canvasAssets}
              selectedItemIds={selectedSceneItemIds}
              onSelectionChange={onSelectionChange}
              onMoveItem={onMoveSceneItem}
              onMoveItems={onMoveSceneItems}
              onScaleItem={onUpdateSceneItemScale}
              onRotateItem={onRotateSceneItem}
              paintMode={paintMode}
              activeTileLayerId={activeTileLayerId}
              onPaintCell={onPaintCell}
              onEraseCell={onEraseCell}
              onFillRect={onFillRect}
              onDropPrefab={onInstantiatePrefab}
              onDropAsset={onDropAsset}
              snap={snap}
              zoom={zoom}
            />
          </div>
          {/* Hierarchy panel */}
          <SceneHierarchy
            scene={activeScene}
            assets={assets}
            selectedItemId={selectedSceneItemId}
            onSelect={onSelectSceneItem}
            onReorder={onReorderSceneItems}
            onDelete={onDeleteSceneItem}
            onDuplicate={onDuplicateSceneItem}
            onToggleAnim={onToggleAnimating}
            onToggleSolid={onToggleSolid}
            onToggleFlipX={onToggleFlipX}
            onToggleFlipY={onToggleFlipY}
            onTogglePickable={onTogglePickable}
          />
          <PrefabLibrary
            prefabs={prefabs}
            onDelete={onDeletePrefab}
            onSync={onSyncPrefabInstances}
          />
          {selectedSceneItem && selectedSceneItem.kind === "emitter" ? (
            <div className="border-2 border-farm-grass/60 bg-farm-ink/40 p-2 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-2xl">✨</span>
                <div className="flex-1">
                  <div className="font-pixel text-base text-farm-grass">Particle emitter</div>
                </div>
                <button
                  onClick={() => onDeleteSceneItem(selectedSceneItem.id)}
                  className="px-2 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
              {(() => {
                const em = selectedSceneItem.emitter || { kind: "sparkle" as const, rate: 4, lifetime: 1.5 };
                return (
                  <>
                    <div className="flex items-center gap-1 text-xs">
                      <span>Kind:</span>
                      {(["sparkle", "smoke"] as const).map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => onSetEmitter(selectedSceneItem.id, { ...em, kind: k })}
                          className={`px-2 py-0.5 border ${
                            em.kind === k
                              ? "border-farm-grass text-farm-grass bg-farm-grass/10"
                              : "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                          }`}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      Rate:
                      <input
                        type="range"
                        min={1}
                        max={20}
                        step={1}
                        value={em.rate}
                        onChange={(e) =>
                          onSetEmitter(selectedSceneItem.id, { ...em, rate: Number(e.target.value) })
                        }
                        className="accent-farm-grass flex-1"
                      />
                      <span className="w-8 text-right tabular-nums">{em.rate}/s</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      Lifetime:
                      <input
                        type="range"
                        min={0.3}
                        max={4}
                        step={0.1}
                        value={em.lifetime}
                        onChange={(e) =>
                          onSetEmitter(selectedSceneItem.id, { ...em, lifetime: Number(e.target.value) })
                        }
                        className="accent-farm-grass flex-1"
                      />
                      <span className="w-10 text-right tabular-nums">{em.lifetime.toFixed(1)}s</span>
                    </label>
                  </>
                );
              })()}
            </div>
          ) : selectedSceneItem && selectedSceneItem.kind === "sound" ? (
            <div className="border-2 border-farm-grass/60 bg-farm-ink/40 p-2 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🔊</span>
                <div className="flex-1">
                  <div className="font-pixel text-base text-farm-grass">Sound trigger</div>
                  <div className="text-[10px] opacity-60">Plays audio when player enters bbox</div>
                </div>
                <button
                  onClick={() => onDeleteSceneItem(selectedSceneItem.id)}
                  className="px-2 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
              {(() => {
                const sn = selectedSceneItem.sound || { url: "", volume: 0.6, loop: false };
                return (
                  <>
                    <label className="flex flex-col gap-1 text-xs">
                      <span>Audio URL:</span>
                      <input
                        type="text"
                        value={sn.url}
                        onChange={(e) =>
                          onSetSound(selectedSceneItem.id, { ...sn, url: e.target.value })
                        }
                        placeholder="https://… (leave blank to stub a log entry)"
                        className="bg-farm-ink/60 border border-farm-wood text-farm-parchment px-2 py-1 focus:outline-none focus:border-farm-grass"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      Volume:
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={sn.volume}
                        onChange={(e) =>
                          onSetSound(selectedSceneItem.id, { ...sn, volume: Number(e.target.value) })
                        }
                        className="accent-farm-grass flex-1"
                      />
                      <span className="w-10 text-right tabular-nums">
                        {Math.round(sn.volume * 100)}%
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={sn.loop}
                        onChange={(e) =>
                          onSetSound(selectedSceneItem.id, { ...sn, loop: e.target.checked })
                        }
                        className="accent-farm-grass"
                      />
                      Loop
                    </label>
                    {(() => {
                      const isPreviewing = previewingSoundId === selectedSceneItem.id;
                      const stopPreview = () => {
                        if (previewAudioRef.current) {
                          previewAudioRef.current.pause();
                          previewAudioRef.current = null;
                        }
                        setPreviewingSoundId(null);
                      };
                      const startPreview = () => {
                        if (!sn.url) return;
                        // Stop anything already playing first.
                        if (previewAudioRef.current) {
                          previewAudioRef.current.pause();
                          previewAudioRef.current = null;
                        }
                        const a = new Audio(sn.url);
                        a.volume = sn.volume;
                        // Preview never loops, even if loop is on — preview is a one-shot.
                        a.loop = false;
                        a.onended = () => {
                          if (previewAudioRef.current === a) {
                            previewAudioRef.current = null;
                            setPreviewingSoundId(null);
                          }
                        };
                        a.onerror = () => {
                          if (previewAudioRef.current === a) {
                            previewAudioRef.current = null;
                            setPreviewingSoundId(null);
                          }
                          alert("Couldn't play this audio URL. Check that it's reachable and a supported format.");
                        };
                        previewAudioRef.current = a;
                        setPreviewingSoundId(selectedSceneItem.id);
                        void a.play().catch(() => {
                          // play() can reject on autoplay-policy or bad URL.
                          if (previewAudioRef.current === a) {
                            previewAudioRef.current = null;
                            setPreviewingSoundId(null);
                          }
                        });
                      };
                      return (
                        <button
                          type="button"
                          onClick={isPreviewing ? stopPreview : startPreview}
                          disabled={!sn.url}
                          title={
                            !sn.url
                              ? "Set an audio URL first"
                              : isPreviewing
                              ? "Stop preview"
                              : "Play this sound once at the configured volume"
                          }
                          className={`px-2 py-0.5 border text-xs ${
                            isPreviewing
                              ? "border-farm-grass text-farm-grass bg-farm-grass/10"
                              : "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          {isPreviewing ? "⏸ Stop" : "▶ Preview"}
                        </button>
                      );
                    })()}
                  </>
                );
              })()}
            </div>
          ) : selectedSceneItem && selectedSceneItem.kind === "light" ? (
            <div className="border-2 border-farm-grass/60 bg-farm-ink/40 p-2 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-2xl">💡</span>
                <div className="flex-1">
                  <div className="font-pixel text-base text-farm-grass">Point light</div>
                  <div className="text-[10px] opacity-60">
                    Radial glow rendered in play mode
                  </div>
                </div>
                <button
                  onClick={() => onDeleteSceneItem(selectedSceneItem.id)}
                  className="px-2 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
              {(() => {
                const light = selectedSceneItem.light || { radius: 200, color: "#ffd47a", intensity: 0.7 };
                return (
                  <>
                    <label className="flex items-center gap-2 text-xs">
                      Color:
                      <input
                        type="color"
                        value={light.color}
                        onChange={(e) =>
                          onSetLight(selectedSceneItem.id, { ...light, color: e.target.value })
                        }
                        className="bg-transparent w-8 h-6"
                      />
                      <span className="opacity-60 tabular-nums">{light.color}</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      Radius:
                      <input
                        type="range"
                        min={32}
                        max={800}
                        step={8}
                        value={light.radius}
                        onChange={(e) =>
                          onSetLight(selectedSceneItem.id, { ...light, radius: Number(e.target.value) })
                        }
                        className="accent-farm-grass flex-1"
                      />
                      <span className="w-12 text-right tabular-nums">{light.radius}px</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      Intensity:
                      <input
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.05}
                        value={light.intensity}
                        onChange={(e) =>
                          onSetLight(selectedSceneItem.id, { ...light, intensity: Number(e.target.value) })
                        }
                        className="accent-farm-grass flex-1"
                      />
                      <span className="w-10 text-right tabular-nums">
                        {Math.round(light.intensity * 100)}%
                      </span>
                    </label>
                    <div className="flex items-center gap-2 text-xs">
                      <span>Pos:</span>
                      <label className="flex items-center gap-1">
                        x
                        <input
                          type="number"
                          step={1}
                          value={Math.round(selectedSceneItem.x)}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isFinite(v)) return;
                            onMoveSceneItem(selectedSceneItem.id, v, selectedSceneItem.y);
                          }}
                          className="w-16 bg-farm-ink border border-farm-wood text-farm-parchment px-1 tabular-nums"
                        />
                      </label>
                      <label className="flex items-center gap-1">
                        y
                        <input
                          type="number"
                          step={1}
                          value={Math.round(selectedSceneItem.y)}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isFinite(v)) return;
                            onMoveSceneItem(selectedSceneItem.id, selectedSceneItem.x, v);
                          }}
                          className="w-16 bg-farm-ink border border-farm-wood text-farm-parchment px-1 tabular-nums"
                        />
                      </label>
                    </div>
                  </>
                );
              })()}
            </div>
          ) : selectedSceneItem && selectedSceneItem.kind === "trigger" ? (
            <div className="border-2 border-farm-grass/60 bg-farm-ink/40 p-2 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-2xl">⚡</span>
                <div className="flex-1">
                  <div className="font-pixel text-base text-farm-grass">Trigger zone</div>
                  <div className="text-[10px] opacity-60">
                    Invisible in play mode · fires message when player enters
                  </div>
                </div>
                <button
                  onClick={() => onDeleteSceneItem(selectedSceneItem.id)}
                  title="Remove trigger zone"
                  className="px-2 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
              <label className="flex flex-col gap-1 text-xs">
                <span>Trigger message:</span>
                <input
                  type="text"
                  value={selectedSceneItem.triggerMessage || ""}
                  onChange={(e) =>
                    onSetTriggerMessage(selectedSceneItem.id, e.target.value)
                  }
                  placeholder="e.g. 'You enter a dark cave.'"
                  className="bg-farm-ink/60 border border-farm-wood text-farm-parchment px-2 py-1 focus:outline-none focus:border-farm-grass"
                />
              </label>
              <div className="flex items-center gap-2 text-xs">
                <span>Pos:</span>
                <label className="flex items-center gap-1">
                  x
                  <input
                    type="number"
                    step={1}
                    value={Math.round(selectedSceneItem.x)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      onMoveSceneItem(selectedSceneItem.id, v, selectedSceneItem.y);
                    }}
                    className="w-16 bg-farm-ink border border-farm-wood text-farm-parchment px-1 tabular-nums"
                  />
                </label>
                <label className="flex items-center gap-1">
                  y
                  <input
                    type="number"
                    step={1}
                    value={Math.round(selectedSceneItem.y)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      onMoveSceneItem(selectedSceneItem.id, selectedSceneItem.x, v);
                    }}
                    className="w-16 bg-farm-ink border border-farm-wood text-farm-parchment px-1 tabular-nums"
                  />
                </label>
                <label className="flex items-center gap-1 ml-auto">
                  Size
                  <input
                    type="number"
                    min={5}
                    max={60}
                    step={1}
                    value={Math.round(selectedSceneItem.scale * 100)}
                    onChange={(e) => {
                      const pct = Number(e.target.value);
                      if (!Number.isFinite(pct)) return;
                      onUpdateSceneItemScale(
                        selectedSceneItem.id,
                        Math.max(0.05, Math.min(0.6, pct / 100))
                      );
                    }}
                    className="w-12 bg-farm-ink border border-farm-wood text-farm-parchment px-1 tabular-nums"
                  />
                  %
                </label>
              </div>
            </div>
          ) : selectedSceneItem && selectedAsset ? (
            <div className="border-2 border-farm-grass/60 bg-farm-ink/40 p-2 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <img
                  src={selectedAsset.pixelUrl}
                  alt=""
                  className="pixelated w-12 h-12 object-contain bg-farm-ink"
                />
                <div className="flex-1 truncate" title={selectedAsset.prompt}>
                  {selectedAsset.prompt}
                </div>
                <button
                  onClick={() => onDeleteSceneItem(selectedSceneItem.id)}
                  title="Remove from scene"
                  className="px-2 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
                >
                  ✕
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <label className="flex items-center gap-1 flex-1">
                  Size:
                  <input
                    type="range"
                    min={0.05}
                    max={0.6}
                    step={0.01}
                    value={selectedSceneItem.scale}
                    onChange={(e) =>
                      onUpdateSceneItemScale(selectedSceneItem.id, Number(e.target.value))
                    }
                    className="accent-farm-grass flex-1"
                  />
                  <input
                    type="number"
                    min={5}
                    max={60}
                    step={1}
                    value={Math.round(selectedSceneItem.scale * 100)}
                    onChange={(e) => {
                      const pct = Number(e.target.value);
                      if (!Number.isFinite(pct)) return;
                      onUpdateSceneItemScale(
                        selectedSceneItem.id,
                        Math.max(0.05, Math.min(0.6, pct / 100))
                      );
                    }}
                    className="w-12 bg-farm-ink border border-farm-wood text-farm-parchment px-1 text-right tabular-nums"
                    title="Scale (percent of canvas)"
                  />
                  <span>%</span>
                </label>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span>Pos:</span>
                <label className="flex items-center gap-1">
                  x
                  <input
                    type="number"
                    step={1}
                    value={Math.round(selectedSceneItem.x)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      onMoveSceneItem(selectedSceneItem.id, v, selectedSceneItem.y);
                    }}
                    className="w-16 bg-farm-ink border border-farm-wood text-farm-parchment px-1 tabular-nums"
                  />
                </label>
                <label className="flex items-center gap-1">
                  y
                  <input
                    type="number"
                    step={1}
                    value={Math.round(selectedSceneItem.y)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      onMoveSceneItem(selectedSceneItem.id, selectedSceneItem.x, v);
                    }}
                    className="w-16 bg-farm-ink border border-farm-wood text-farm-parchment px-1 tabular-nums"
                  />
                </label>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span>Layer:</span>
                <button
                  onClick={() => onBumpSceneItemZ(selectedSceneItem.id, -1)}
                  className="px-2 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                >
                  ⬇ Back
                </button>
                <button
                  onClick={() => onBumpSceneItemZ(selectedSceneItem.id, 1)}
                  className="px-2 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                >
                  ⬆ Front
                </button>
                <span className="opacity-60 ml-auto">z={selectedSceneItem.z}</span>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span>Flip:</span>
                <button
                  onClick={() => onToggleFlipX(selectedSceneItem.id)}
                  title="Flip horizontally"
                  className={`px-2 py-0.5 border ${
                    selectedSceneItem.flipX
                      ? "border-farm-grass text-farm-grass bg-farm-grass/10"
                      : "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                  }`}
                >
                  ▶◀ H
                </button>
                <button
                  onClick={() => onToggleFlipY(selectedSceneItem.id)}
                  title="Flip vertically"
                  className={`px-2 py-0.5 border ${
                    selectedSceneItem.flipY
                      ? "border-farm-grass text-farm-grass bg-farm-grass/10"
                      : "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                  }`}
                >
                  ▲▼ V
                </button>
                <button
                  onClick={() => onTogglePickable(selectedSceneItem.id)}
                  title={
                    selectedSceneItem.pickable
                      ? "Pickable: player picks this up on contact"
                      : "Mark as pickable"
                  }
                  className={`ml-2 px-2 py-0.5 border ${
                    selectedSceneItem.pickable
                      ? "border-farm-grass text-farm-grass bg-farm-grass/10"
                      : "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                  }`}
                >
                  🛒 Pickup
                </button>
                <button
                  onClick={() => onToggleAnchor(selectedSceneItem.id)}
                  title={
                    selectedSceneItem.anchor === "bottom"
                      ? "Anchor: BOTTOM (item's feet sit at y) — click to switch to center"
                      : "Anchor: CENTER (item's middle sits at y) — click to switch to bottom"
                  }
                  className={`px-2 py-0.5 border ${
                    selectedSceneItem.anchor === "bottom"
                      ? "border-farm-grass text-farm-grass bg-farm-grass/10"
                      : "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                  }`}
                >
                  {selectedSceneItem.anchor === "bottom" ? "◍ Bottom" : "⊕ Center"}
                </button>
              </div>

              {/* Door / portal — link to another scene in this project. */}
              <div className="flex items-center gap-2 text-xs">
                <span title="Walking onto this in Play Mode switches to the linked scene">
                  🚪 Door:
                </span>
                <select
                  value={selectedSceneItem.linkSceneId || ""}
                  onChange={(e) =>
                    onSetLinkScene(selectedSceneItem.id, e.target.value || undefined)
                  }
                  className="bg-farm-ink border border-farm-wood text-farm-parchment px-1 py-0.5 flex-1"
                >
                  <option value="">(not a door)</option>
                  {Object.values(scenes)
                    .filter((s) => s.id !== activeScene.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        🎬 {s.name}
                      </option>
                    ))}
                </select>
              </div>

              {/* NPC patrol path — only meaningful for characters/creatures. */}
              {(selectedAsset.assetType === "character" ||
                selectedAsset.assetType === "creature") && (
                <div className="text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span title="Walks between waypoints in Play Mode">🚶 Patrol:</span>
                    <button
                      type="button"
                      onClick={() => {
                        const cur = selectedSceneItem.patrol;
                        const next = {
                          points: [
                            ...(cur?.points || []),
                            { x: Math.round(selectedSceneItem.x), y: Math.round(selectedSceneItem.y) },
                          ],
                          loop: cur?.loop ?? true,
                          speed: cur?.speed ?? 60,
                        };
                        onSetPatrol(selectedSceneItem.id, next);
                      }}
                      className="px-2 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                    >
                      + Add waypoint at current pos
                    </button>
                    {selectedSceneItem.patrol && selectedSceneItem.patrol.points.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onSetPatrol(selectedSceneItem.id, undefined)}
                        className="px-2 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {selectedSceneItem.patrol && selectedSceneItem.patrol.points.length > 0 && (
                    <>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={selectedSceneItem.patrol.loop}
                            onChange={(e) =>
                              selectedSceneItem.patrol &&
                              onSetPatrol(selectedSceneItem.id, {
                                ...selectedSceneItem.patrol,
                                loop: e.target.checked,
                              })
                            }
                            className="accent-farm-grass"
                          />
                          loop
                        </label>
                        <label className="flex items-center gap-1">
                          speed
                          <input
                            type="number"
                            min={10}
                            max={400}
                            value={selectedSceneItem.patrol.speed}
                            onChange={(e) =>
                              selectedSceneItem.patrol &&
                              onSetPatrol(selectedSceneItem.id, {
                                ...selectedSceneItem.patrol,
                                speed: Math.max(1, Number(e.target.value) || 60),
                              })
                            }
                            className="w-16 bg-farm-ink border border-farm-wood text-farm-parchment px-1 tabular-nums"
                          />
                          px/s
                        </label>
                      </div>
                      <div className="space-y-0.5 max-h-32 overflow-y-auto">
                        {selectedSceneItem.patrol.points.map((p, i) => (
                          <div key={i} className="flex items-center gap-1 opacity-80">
                            <span className="opacity-60 w-6 tabular-nums">{i + 1}.</span>
                            <span className="tabular-nums">
                              ({Math.round(p.x)}, {Math.round(p.y)})
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const cur = selectedSceneItem.patrol;
                                if (!cur) return;
                                const next = {
                                  ...cur,
                                  points: cur.points.filter((_, idx) => idx !== i),
                                };
                                onSetPatrol(
                                  selectedSceneItem.id,
                                  next.points.length === 0 ? undefined : next
                                );
                              }}
                              className="ml-auto px-1 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* NPC dialogue — shown as a speech bubble in Play Mode when
                  the player walks within ~32 px of a character/creature. */}
              {(selectedAsset.assetType === "character" ||
                selectedAsset.assetType === "creature") && (
                <div className="text-xs space-y-1">
                  <label
                    className="flex items-center gap-2"
                    title="Shown above this NPC in Play Mode when the player gets close"
                  >
                    <span>💬 Dialogue:</span>
                  </label>
                  <textarea
                    value={selectedSceneItem.dialogue || ""}
                    onChange={(e) =>
                      onSetDialogue(selectedSceneItem.id, e.target.value)
                    }
                    placeholder="e.g. Welcome, traveler! (leave blank for none)"
                    rows={2}
                    className="w-full bg-farm-ink/60 border border-farm-wood text-farm-parchment px-2 py-1 resize-none focus:outline-none focus:border-farm-grass"
                  />
                </div>
              )}

              {/* Use message — shown when the player presses E near this item
                  in Play Mode. Available on ANY real item (including NPCs:
                  dialogue auto-triggers on proximity, useMessage waits for E). */}
              <div className="text-xs space-y-1">
                <label
                  className="flex items-center gap-2"
                  title="Shown when the player presses E within ~24 px in Play Mode"
                >
                  <span>🅴 Use prompt:</span>
                </label>
                <textarea
                  value={selectedSceneItem.useMessage || ""}
                  onChange={(e) =>
                    onSetUseMessage(selectedSceneItem.id, e.target.value)
                  }
                  placeholder="e.g. You sit at the desk and check email. (blank = not interactable)"
                  rows={2}
                  className="w-full bg-farm-ink/60 border border-farm-wood text-farm-parchment px-2 py-1 resize-none focus:outline-none focus:border-farm-grass"
                />
              </div>

              {/* Use-state alt asset — optional sprite swap during the ~1.5 s
                  after E fires. Pick another asset in the project to use as
                  the "active" pose (computer-on, drawer-open, mug-tilted). */}
              <div className="text-xs space-y-1">
                <label
                  className="flex items-center gap-2"
                  title="Briefly swap to this asset for ~1.5 s when the player presses E"
                >
                  <span>🎞 Use state:</span>
                </label>
                <select
                  value={selectedSceneItem.useStateAssetId || ""}
                  onChange={(e) =>
                    onSetUseStateAssetId(
                      selectedSceneItem.id,
                      e.target.value || undefined
                    )
                  }
                  className="w-full bg-farm-ink/60 border border-farm-wood text-farm-parchment px-2 py-1 focus:outline-none focus:border-farm-grass"
                >
                  <option value="">(no swap — keep original sprite)</option>
                  {Object.values(assets)
                    .filter(
                      (a) =>
                        !a.trashedAt &&
                        a.id !== selectedSceneItem.assetId
                    )
                    .sort((a, b) =>
                      (a.name || a.prompt).localeCompare(b.name || b.prompt)
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name || a.prompt}
                      </option>
                    ))}
                </select>
              </div>

              {(selectedAsset.cols || 1) * (selectedAsset.rows || 1) > 1 && (
                <div className="text-xs">
                  <button
                    onClick={() => onToggleAnimating(selectedSceneItem.id)}
                    className={`px-2 py-0.5 border ${
                      selectedSceneItem.animating
                        ? "border-farm-grass text-farm-grass bg-farm-grass/10"
                        : "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                    }`}
                  >
                    {selectedSceneItem.animating ? "⏸ Stop" : "▶ Animate"}
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={replacePrompt}
                  onChange={(e) => setReplacePrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onReplaceItem();
                    }
                  }}
                  placeholder="Replace with… (uses project style)"
                  className="flex-1 bg-farm-ink/60 border border-farm-wood p-1 text-sm focus:outline-none focus:border-farm-grass"
                />
                <button
                  onClick={onReplaceItem}
                  disabled={!replacePrompt.trim()}
                  className="px-2 py-0.5 border border-farm-grass text-farm-grass hover:bg-farm-grass/10 disabled:opacity-40"
                >
                  Replace
                </button>
              </div>
            </div>
          ) : selectedSceneItemIds.length > 1 ? (
            <div className="border-2 border-farm-grass/60 bg-farm-ink/40 p-2 text-xs flex items-center gap-2 flex-wrap">
              <span><span className="text-farm-grass">{selectedSceneItemIds.length}</span> items selected · drag to move group</span>
              <button
                type="button"
                onClick={() => {
                  const name = prompt("Name this prefab:", "")?.trim();
                  if (!name) return;
                  const items = activeScene.items.filter((it) =>
                    selectedSceneItemIds.includes(it.id)
                  );
                  if (items.length > 0) onSavePrefab(name, items);
                }}
                className="ml-auto px-2 py-0.5 border border-farm-grass/70 text-farm-grass hover:bg-farm-grass/10"
              >
                💾 Save as prefab
              </button>
            </div>
          ) : (
            <div className="text-xs opacity-60 text-center py-2">
              Click an item to select. Shift-click or drag-rectangle for multi-select. Middle-click drag to pan.
            </div>
          )}
          </>}
        </>
      ) : (
        <div className="opacity-60 text-center py-12">Pick a scene above.</div>
      )}

      {failedItemsOpen && activeScene && activeScene.failedItems && activeScene.failedItems.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setFailedItemsOpen(false)}
        >
          <div
            className="bg-farm-ink border-2 border-farm-wood w-full max-w-lg p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-pixel text-xl text-yellow-200">
                  ⚠ {activeScene.failedItems.length} item{activeScene.failedItems.length > 1 ? "s" : ""} failed
                </h2>
                <p className="text-xs opacity-70 mt-1">
                  These items were parsed from the scene description but their image generation didn't return. Retry below to try again.
                </p>
              </div>
              <button
                onClick={() => setFailedItemsOpen(false)}
                className="text-farm-parchment/70 hover:text-farm-parchment text-xl leading-none px-2"
                title="Close"
              >
                ×
              </button>
            </div>

            <ul className="space-y-1.5 text-sm max-h-72 overflow-y-auto pr-2">
              {activeScene.failedItems.map((f, i) => (
                <li key={i} className="border border-farm-wood/40 px-2 py-1.5 bg-farm-bg/30">
                  <div className="font-medium">{f.name}</div>
                  <div className="text-[10px] opacity-60 truncate" title={f.error}>
                    {f.error}
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between pt-2 border-t border-farm-wood/40">
              <button
                onClick={() => {
                  if (!activeScene) return;
                  onClearFailedItems(activeScene.id);
                  setFailedItemsOpen(false);
                }}
                className="text-xs opacity-60 hover:opacity-100"
                title="Hide the badge without retrying"
              >
                Dismiss
              </button>
              <button
                onClick={() => {
                  alert("Retry coming soon — for now, type the failed item names into a new Item generation and use 'Add to scene'.");
                }}
                className="text-xs px-3 py-1 border border-farm-grass bg-farm-grass/20 text-farm-grass hover:bg-farm-grass/30"
              >
                Retry (soon)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PrefabLibrary({
  prefabs,
  onDelete,
  onSync,
}: {
  prefabs: Record<string, Prefab>;
  onDelete: (id: string) => void;
  onSync: (id: string) => void;
}) {
  const list = Object.values(prefabs).sort((a, b) => a.createdAt - b.createdAt);
  if (list.length === 0) return null;
  return (
    <div className="border-2 border-farm-wood/60 bg-farm-ink/30 p-2 text-xs space-y-1">
      <div className="flex items-center justify-between mb-1">
        <span className="font-pixel text-farm-sky">📦 Prefabs ({list.length})</span>
        <span className="opacity-50 text-[10px]">drag onto canvas to instantiate</span>
      </div>
      {list.map((p) => (
        <div
          key={p.id}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-pwf-prefab-id", p.id);
            e.dataTransfer.effectAllowed = "copy";
          }}
          className="flex items-center gap-2 p-1 cursor-grab hover:bg-farm-wood/20"
        >
          <span className="opacity-40 select-none">📦</span>
          <span className="flex-1 truncate" title={p.name}>{p.name}</span>
          <span className="opacity-50 tabular-nums">{p.items.length} items</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSync(p.id); }}
            title="Push master changes to all instances of this prefab"
            className="px-1 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
          >
            🔄
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!confirm(`Delete prefab "${p.name}"? Existing instances stay.`)) return;
              onDelete(p.id);
            }}
            className="px-1 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function TilePaintBar({
  scene,
  tileAssets,
  paintMode,
  onPaintModeChange,
  activeTileLayerId,
  onActiveTileLayerChange,
  onAddTileLayer,
  onRemoveTileLayer,
  onRenameTileLayer,
  onSetLayerTileAsset,
  onToggleLayerVisible,
  onReorderTileLayers,
  onSetTileSize,
  onFillLayer,
}: {
  scene: Scene;
  tileAssets: Asset[];
  paintMode: "off" | "paint" | "erase" | "fillrect";
  onPaintModeChange: (m: "off" | "paint" | "erase" | "fillrect") => void;
  activeTileLayerId: string | null;
  onActiveTileLayerChange: (id: string | null) => void;
  onAddTileLayer: (tileAssetId?: string) => void;
  onRemoveTileLayer: (layerId: string) => void;
  onRenameTileLayer: (layerId: string, name: string) => void;
  onSetLayerTileAsset: (layerId: string, tileAssetId: string) => void;
  onToggleLayerVisible: (layerId: string) => void;
  onReorderTileLayers: (from: number, to: number) => void;
  onSetTileSize: (n: number) => void;
  onFillLayer: (layerId: string) => void;
}) {
  const tg = scene.tileGrid;
  const layers = tg?.layers || [];
  const activeLayer = activeTileLayerId
    ? layers.find((l) => l.id === activeTileLayerId)
    : null;

  return (
    <div className="border-2 border-farm-wood/60 bg-farm-ink/30 p-2 text-xs space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-pixel text-farm-sky">🎨 Tiles</span>
        <button
          type="button"
          onClick={() => onPaintModeChange(paintMode === "paint" ? "off" : "paint")}
          disabled={!activeLayer || !activeLayer.tileAssetId}
          title="Click+drag on canvas to stamp the active tile"
          className={`px-2 py-0.5 border ${
            paintMode === "paint"
              ? "border-farm-grass text-farm-grass bg-farm-grass/10"
              : "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          ✏️ Paint
        </button>
        <button
          type="button"
          onClick={() => onPaintModeChange(paintMode === "erase" ? "off" : "erase")}
          disabled={!activeLayer}
          className={`px-2 py-0.5 border ${
            paintMode === "erase"
              ? "border-farm-grass text-farm-grass bg-farm-grass/10"
              : "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          🧽 Erase
        </button>
        <button
          type="button"
          onClick={() => onPaintModeChange(paintMode === "fillrect" ? "off" : "fillrect")}
          disabled={!activeLayer || !activeLayer.tileAssetId}
          title="Drag from corner to corner to fill a rectangle of cells"
          className={`px-2 py-0.5 border ${
            paintMode === "fillrect"
              ? "border-farm-grass text-farm-grass bg-farm-grass/10"
              : "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          ▣ Fill rect
        </button>
        <button
          type="button"
          onClick={() => {
            if (!activeLayer) return;
            if (!confirm(`Fill every cell on layer "${activeLayer.name}" with the active tile?`)) return;
            onFillLayer(activeLayer.id);
          }}
          disabled={!activeLayer || !activeLayer.tileAssetId}
          title="Paint every cell on the active layer with the current tile"
          className="px-2 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ⬛ Fill layer
        </button>
        <label className="flex items-center gap-1 ml-auto">
          Tile size:
          <input
            type="number"
            min={8}
            max={256}
            step={4}
            value={tg?.tileSize || 32}
            onChange={(e) => onSetTileSize(Number(e.target.value) || 32)}
            className="w-14 bg-farm-ink border border-farm-wood text-farm-parchment px-1 tabular-nums"
          />
          px
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onAddTileLayer(tileAssets[0]?.id)}
          className="px-2 py-0.5 border border-farm-grass/70 text-farm-grass hover:bg-farm-grass/10"
        >
          + Layer
        </button>
        {layers.length === 0 && (
          <span className="opacity-60">Add a layer to start painting tiles.</span>
        )}
      </div>
      {layers.length > 0 && (
        <div className="space-y-0.5">
          {layers.map((l, idx) => {
            const isActive = l.id === activeTileLayerId;
            return (
              <div
                key={l.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-pwf-tile-layer", String(idx));
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("application/x-pwf-tile-layer")) {
                    e.preventDefault();
                  }
                }}
                onDrop={(e) => {
                  const from = Number(e.dataTransfer.getData("application/x-pwf-tile-layer"));
                  if (Number.isFinite(from) && from !== idx) onReorderTileLayers(from, idx);
                }}
                onClick={() => onActiveTileLayerChange(l.id)}
                className={`flex items-center gap-2 p-1 cursor-pointer ${
                  isActive
                    ? "bg-farm-sky/15 border-l-2 border-farm-sky"
                    : "hover:bg-farm-wood/20"
                }`}
              >
                <span className="opacity-40 cursor-grab select-none">☰</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleLayerVisible(l.id);
                  }}
                  title={l.visible ? "Hide" : "Show"}
                  className={`px-1 border ${
                    l.visible
                      ? "border-farm-grass text-farm-grass"
                      : "border-farm-wood/60 opacity-60"
                  }`}
                >
                  {l.visible ? "👁" : "—"}
                </button>
                <input
                  type="text"
                  value={l.name}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onRenameTileLayer(l.id, e.target.value)}
                  className="flex-1 bg-transparent border-b border-farm-wood/40 px-1 focus:outline-none focus:border-farm-grass"
                />
                <select
                  value={l.tileAssetId}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onSetLayerTileAsset(l.id, e.target.value)}
                  className="bg-farm-ink border border-farm-wood text-farm-parchment px-1 max-w-[140px]"
                >
                  <option value="">— pick a tile —</option>
                  {tileAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name || a.prompt}
                    </option>
                  ))}
                </select>
                <span className="opacity-50 tabular-nums">{l.cells.length}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!confirm(`Remove layer "${l.name}"?`)) return;
                    onRemoveTileLayer(l.id);
                  }}
                  className="px-1 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SceneHierarchy({
  scene,
  assets,
  selectedItemId,
  onSelect,
  onReorder,
  onDelete,
  onDuplicate,
  onToggleAnim,
  onToggleSolid,
  onToggleFlipX,
  onToggleFlipY,
  onTogglePickable,
}: {
  scene: Scene;
  assets: Record<string, Asset>;
  selectedItemId: string | null;
  onSelect: (id: string | null) => void;
  onReorder: (from: number, to: number) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onToggleAnim: (id: string) => void;
  onToggleSolid: (id: string) => void;
  onToggleFlipX: (id: string) => void;
  onToggleFlipY: (id: string) => void;
  onTogglePickable: (id: string) => void;
}) {
  const sorted = [...scene.items].sort((a, b) => b.z - a.z); // front first
  const [dragRow, setDragRow] = useState<number | null>(null);
  const [hoverRow, setHoverRow] = useState<number | null>(null);

  if (sorted.length === 0) return null;

  return (
    <div className="border-2 border-farm-wood/60 bg-farm-ink/30 p-2 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="opacity-70">📋 Items ({sorted.length}) — front to back</span>
        <span className="opacity-50 text-[10px]">drag to reorder</span>
      </div>
      <div className="space-y-0.5">
        {sorted.map((it, idx) => {
          const a = assets[it.assetId];
          const isMulti = (a?.cols || 1) * (a?.rows || 1) > 1;
          const isSelected = it.id === selectedItemId;
          return (
            <div
              key={it.id}
              draggable
              onDragStart={(e) => {
                setDragRow(idx);
                e.dataTransfer.effectAllowed = "move";
                // Mark this drag as a hierarchy reorder, not an asset-from-gallery drag.
                e.dataTransfer.setData("application/x-pwf-hierarchy", String(idx));
              }}
              onDragOver={(e) => {
                if (dragRow === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setHoverRow(idx);
              }}
              onDragLeave={() => {
                if (hoverRow === idx) setHoverRow(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragRow !== null && dragRow !== idx) {
                  onReorder(dragRow, idx);
                }
                setDragRow(null);
                setHoverRow(null);
              }}
              onDragEnd={() => {
                setDragRow(null);
                setHoverRow(null);
              }}
              onClick={() => onSelect(it.id)}
              className={`flex items-center gap-2 p-1 cursor-pointer ${
                isSelected
                  ? "bg-farm-grass/15 border-l-2 border-farm-grass"
                  : "hover:bg-farm-wood/20"
              } ${hoverRow === idx ? "ring-1 ring-farm-grass/40" : ""}`}
            >
              <span className="opacity-40 cursor-grab select-none">☰</span>
              {a && (
                <img
                  src={a.pixelUrl}
                  alt=""
                  className="pixelated w-6 h-6 object-contain bg-farm-ink/60 flex-shrink-0"
                />
              )}
              <span className="flex-1 truncate" title={a?.prompt}>
                {a?.name || a?.prompt || "(missing asset)"}
              </span>
              <span className="opacity-50 text-[10px] tabular-nums">
                z{it.z} · {Math.round(it.scale * 100)}%
              </span>
              {isMulti && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleAnim(it.id);
                  }}
                  title={it.animating ? "Stop animation" : "Play animation"}
                  className={`px-1 border ${
                    it.animating
                      ? "border-farm-grass text-farm-grass"
                      : "border-farm-wood/60"
                  }`}
                >
                  {it.animating ? "⏸" : "▶"}
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSolid(it.id);
                }}
                title={
                  it.solid
                    ? "Solid: blocks the player in Play Mode"
                    : "Passable: player walks through"
                }
                className={`px-1 border ${
                  it.solid ? "border-farm-grass text-farm-grass" : "border-farm-wood/60 opacity-60"
                }`}
              >
                {it.solid ? "🧱" : "·"}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFlipX(it.id);
                }}
                title={it.flipX ? "Flipped horizontally" : "Flip horizontally"}
                className={`px-1 border ${
                  it.flipX ? "border-farm-grass text-farm-grass" : "border-farm-wood/60 opacity-60"
                }`}
              >
                ▶◀
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFlipY(it.id);
                }}
                title={it.flipY ? "Flipped vertically" : "Flip vertically"}
                className={`px-1 border ${
                  it.flipY ? "border-farm-grass text-farm-grass" : "border-farm-wood/60 opacity-60"
                }`}
              >
                ▲▼
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePickable(it.id);
                }}
                title={it.pickable ? "Pickable in Play Mode" : "Not pickable"}
                className={`px-1 border ${
                  it.pickable ? "border-farm-grass text-farm-grass" : "border-farm-wood/60 opacity-60"
                }`}
              >
                🛒
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(it.id);
                }}
                title="Duplicate (⌘D)"
                className="px-1 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
              >
                ⎘
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(it.id);
                }}
                title="Delete (Del)"
                className="px-1 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AssetCard({
  asset,
  onDownloadPNG,
  onDownloadFrames,
  onStartEdit,
  onUseAsProjectStyle,
  onRepixelate,
  onMakeSeamless,
  onDelete,
  onRename,
  onSetTags,
  onApplyPalette,
  onDragStart,
  onDragEnd,
  onSetAsSceneBackground,
  sceneActive,
  editing,
  editingBusy,
  editPrompt,
  onChangeEditPrompt,
  onSubmitEdit,
  onCancelEdit,
  selectMode,
  selected,
  onToggleSelect,
}: {
  asset: Asset;
  onDownloadPNG: () => void;
  onDownloadFrames: () => void;
  /** Open the inline edit panel on this card. */
  onStartEdit: () => void;
  onUseAsProjectStyle: () => void;
  onRepixelate: (g: number) => void;
  onMakeSeamless: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onSetTags: (tags: string[]) => void;
  onApplyPalette: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onSetAsSceneBackground: () => void;
  sceneActive: boolean;
  /** True when this card is the one currently being inline-edited. */
  editing: boolean;
  editingBusy: boolean;
  editPrompt: string;
  onChangeEditPrompt: (s: string) => void;
  onSubmitEdit: () => void;
  onCancelEdit: () => void;
  /** When true, render a corner checkbox and let clicks toggle selection. */
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [w, h] = parseSize(asset.sourceSize);
  const aspect = `${w} / ${h}`;
  const isMultiFrame = (asset.cols || 1) * (asset.rows || 1) > 1;
  const isTile = asset.assetType === "tile";

  const [editingName, setEditingName] = useState(false);
  const [varietyExpanded, setVarietyExpanded] = useState(false);
  const [editExampleIdx, setEditExampleIdx] = useState(0);

  // Rotate through example edit phrasings as the placeholder while the
  // inline edit panel is open and the user hasn't typed anything yet.
  // ~2.2s per example so it doesn't feel jittery; pauses on input.
  useEffect(() => {
    if (!editing || editPrompt.length > 0) return;
    const id = setInterval(() => {
      setEditExampleIdx((i) => i + 1);
    }, 2200);
    return () => clearInterval(id);
  }, [editing, editPrompt]);

  // Pick an example list for this asset's type. Falls back to "item" for
  // any legacy assetType not in the table.
  const editExamples =
    EDIT_EXAMPLES[asset.assetType] || EDIT_EXAMPLES.item;
  const editPlaceholder = editExamples[editExampleIdx % editExamples.length];
  const [nameDraft, setNameDraft] = useState(asset.name || "");
  const [tagInput, setTagInput] = useState("");
  const [playing, setPlaying] = useState(false);
  const [frameIdx, setFrameIdx] = useState(0);
  const [frames, setFrames] = useState<string[] | null>(null);

  useEffect(() => {
    if (!playing || !frames) return;
    const id = setInterval(() => {
      setFrameIdx((i) => (i + 1) % frames.length);
    }, 1000 / 8);
    return () => clearInterval(id);
  }, [playing, frames]);

  async function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (!frames) {
      const sliced = await sliceSheet(asset.rawUrl, asset.cols, asset.rows);
      setFrames(sliced);
    }
    setFrameIdx(0);
    setPlaying(true);
  }

  function commitTagInput() {
    const v = tagInput.trim();
    if (!v) return;
    onSetTags([...(asset.tags || []), ...v.split(",").map((s) => s.trim()).filter(Boolean)]);
    setTagInput("");
  }
  function removeTag(t: string) {
    onSetTags((asset.tags || []).filter((x) => x !== t));
  }

  return (
    <div
      className={`group bg-farm-ink/60 border-2 p-2 flex flex-col gap-2 relative ${
        selectMode && selected
          ? "border-farm-grass ring-2 ring-farm-grass/40"
          : "border-farm-wood"
      } ${selectMode ? "cursor-pointer" : ""}`}
      draggable={!selectMode}
      onClick={(e) => {
        // In select mode, the card itself toggles selection — but ignore
        // clicks that originated on inner buttons / inputs / textarea so the
        // existing actions (✏️, 🎨, rename, etc.) still work.
        if (!selectMode) return;
        const t = e.target as HTMLElement;
        if (t.closest("button, input, textarea, select, a")) return;
        onToggleSelect();
      }}
      onDragStart={(e) => {
        if (selectMode) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("application/x-pwf-asset-id", asset.id);
        e.dataTransfer.effectAllowed = "copy";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      {selectMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          title={selected ? "Deselect" : "Select"}
          className={`absolute top-1 left-1 z-10 w-6 h-6 flex items-center justify-center text-sm border ${
            selected
              ? "bg-farm-grass text-farm-ink border-farm-grass"
              : "bg-farm-ink/80 border-farm-wood/60 hover:border-farm-grass"
          }`}
        >
          {selected ? "✓" : ""}
        </button>
      )}
      <button
        onClick={onDelete}
        title="Delete"
        className="absolute top-1 right-1 z-10 w-6 h-6 flex items-center justify-center text-sm bg-farm-ink/80 border border-farm-wood/60 opacity-0 group-hover:opacity-100 hover:border-red-700 hover:text-red-300 transition"
      >
        ✕
      </button>

      {isTile ? (
        <div
          style={{
            backgroundImage: `url(${asset.pixelUrl})`,
            backgroundSize: "33.333% 33.333%",
            backgroundRepeat: "repeat",
            imageRendering: "pixelated",
          }}
          className="aspect-square border border-farm-wood/40"
          title="3×3 tiled preview"
        />
      ) : (
        <div className="relative">
          <div
            style={{
              aspectRatio:
                playing && frames ? `${w / asset.cols} / ${h / asset.rows}` : aspect,
            }}
            className="bg-checker flex items-center justify-center overflow-hidden"
          >
            <img
              src={playing && frames ? frames[frameIdx] : asset.pixelUrl}
              alt={asset.prompt}
              className="pixelated max-w-full max-h-full"
            />
          </div>
          {isMultiFrame && (
            <button
              onClick={togglePlay}
              title={playing ? "Stop animation" : "Play animation"}
              className="absolute bottom-1 right-1 w-6 h-6 flex items-center justify-center text-xs bg-farm-ink/80 border border-farm-grass/70 text-farm-grass hover:bg-farm-grass/20"
            >
              {playing ? "⏸" : "▶"}
            </button>
          )}
          {isMultiFrame && asset.lowVariety && (
            <div className="absolute top-1 left-1 flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setVarietyExpanded((v) => !v);
                }}
                title="Frames look near-identical — gpt-image-1 didn't actually vary the cells. Click for retry options."
                className="px-1 py-0.5 text-[10px] bg-yellow-900/80 border border-yellow-500/70 text-yellow-200 hover:bg-yellow-900"
              >
                ⚠ low variety
              </button>
              {varietyExpanded && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    alert(
                      "Re-roll coming soon. For now: ✏️ this asset and prompt 'each frame visibly different — distinct poses, varied detail per cell', or drop pose to 1×1."
                    );
                    setVarietyExpanded(false);
                  }}
                  title="Regenerate this sheet (stub — feature coming)"
                  className="px-1.5 py-0.5 text-[10px] bg-farm-grass/20 border border-farm-grass/70 text-farm-grass hover:bg-farm-grass/30"
                >
                  🔄 Try again
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="space-y-1 p-2 border-2 border-farm-grass/70 bg-farm-grass/5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-farm-grass">
              ✏️ Edit this asset
            </span>
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={editingBusy}
              className="text-[11px] opacity-60 hover:opacity-100 px-1"
              title="Cancel"
            >
              ✕
            </button>
          </div>
          <textarea
            autoFocus
            value={editPrompt}
            disabled={editingBusy}
            onChange={(e) => onChangeEditPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (editPrompt.trim()) onSubmitEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelEdit();
              }
            }}
            placeholder={`e.g. ${editPlaceholder}`}
            rows={2}
            className="w-full text-xs bg-farm-ink/60 border border-farm-wood/60 text-farm-parchment px-2 py-1 resize-none focus:outline-none focus:border-farm-grass"
          />
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={onSubmitEdit}
              disabled={editingBusy || !editPrompt.trim()}
              className="text-[11px] px-2 py-0.5 border border-farm-grass bg-farm-grass/20 text-farm-grass hover:bg-farm-grass/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {editingBusy ? "Editing…" : "Apply ⏎"}
            </button>
          </div>
        </div>
      )}

      {editingName ? (
        <input
          autoFocus
          type="text"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            onRename(nameDraft);
            setEditingName(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRename(nameDraft);
              setEditingName(false);
            } else if (e.key === "Escape") {
              setNameDraft(asset.name || "");
              setEditingName(false);
            }
          }}
          placeholder={asset.prompt}
          className="text-xs bg-farm-ink/80 border border-farm-grass text-farm-parchment px-1 py-0.5 focus:outline-none"
        />
      ) : (
        <div
          onClick={() => {
            setNameDraft(asset.name || "");
            setEditingName(true);
          }}
          title="Click to rename"
          className="text-xs opacity-90 truncate cursor-text hover:text-farm-grass"
        >
          {asset.name || asset.prompt}
        </div>
      )}

      {(asset.perspective || asset.pose) && (
        <div className="text-[10px] opacity-50 truncate">
          {[
            asset.perspective,
            asset.pose && asset.pose !== "single" ? `${asset.cols}×${asset.rows} ${asset.pose}` : null,
            asset.editedFrom ? "✏️ edited" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}

      {/* Tags row */}
      <div className="flex flex-wrap items-center gap-1 text-[10px]">
        {(asset.tags || []).map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 bg-farm-grass/10 border border-farm-grass/60 text-farm-grass px-1"
          >
            #{t}
            <button onClick={() => removeTag(t)} className="opacity-60 hover:opacity-100">
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commitTagInput();
            }
          }}
          onBlur={commitTagInput}
          placeholder="+ tag"
          className="bg-transparent border-b border-farm-wood/40 px-1 py-0 w-12 focus:outline-none focus:border-farm-grass"
        />
      </div>

      <div className="flex items-center justify-between text-xs">
        <select
          value={asset.gridSize}
          onChange={(e) => onRepixelate(Number(e.target.value))}
          className="bg-farm-ink border border-farm-wood text-farm-parchment px-1"
          title="Pixel snap"
        >
          {GRID_PRESETS.map((g) => (
            <option key={g} value={g}>
              {gridLabel(g)}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          <button
            onClick={editing ? onCancelEdit : onStartEdit}
            title={editing ? "Cancel edit" : "Edit this asset"}
            className={`px-1.5 py-0.5 border ${
              editing
                ? "border-farm-grass text-farm-grass bg-farm-grass/10"
                : "border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
            }`}
          >
            ✏️
          </button>
          <button
            onClick={onUseAsProjectStyle}
            title="Use as project style reference"
            className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
          >
            🎨
          </button>
          <button
            onClick={onApplyPalette}
            title="Snap to palette (NES, GameBoy, Pico-8…)"
            className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
          >
            🎨🎯
          </button>
          {isTile && (
            <>
              <button
                onClick={onMakeSeamless}
                title="Make seamlessly tileable (offset+blend)"
                className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
              >
                🧵
              </button>
              {sceneActive && (
                <button
                  onClick={onSetAsSceneBackground}
                  title="Use as background for the active scene"
                  className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                >
                  🪟
                </button>
              )}
            </>
          )}
          <button
            onClick={onDownloadPNG}
            title="Download PNG"
            className="px-1.5 py-0.5 border border-farm-grass text-farm-grass hover:bg-farm-grass/10"
          >
            ⬇
          </button>
          {isMultiFrame && (
            <button
              onClick={onDownloadFrames}
              title="Download frames + atlas (zip)"
              className="px-1.5 py-0.5 border border-farm-grass text-farm-grass hover:bg-farm-grass/10"
            >
              📦
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------- helpers

/** Whitespace-token set for Jaccard-overlap comparison. Drops 1- and
 *  2-char tokens (articles, prepositions) since they don't carry pattern
 *  signal — "a", "of", "to", etc. */
function promptTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[\s.,;:!?()'"]+/)
      .filter((t) => t.length >= 3)
  );
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

/** Find a recurring pattern in the FORGE history: 3+ same-mode entries
 *  whose pairwise prompt-token Jaccard averages ≥ 0.6. Returns the most
 *  recent matching entry, or null. The user-facing toast asks if this
 *  should be saved as a one-click recipe. */
function detectRecipePattern(
  history: Array<{ mode: GenMode; prompt: string; ts: number }>
): { mode: GenMode; prompt: string } | null {
  if (history.length < 3) return null;
  const recent = history.slice(-10);
  const byMode = new Map<GenMode, typeof recent>();
  for (const e of recent) {
    const arr = byMode.get(e.mode) || [];
    arr.push(e);
    byMode.set(e.mode, arr);
  }
  for (const [, entries] of byMode) {
    if (entries.length < 3) continue;
    const last3 = entries.slice(-3);
    const tokSets = last3.map((e) => promptTokens(e.prompt));
    let total = 0;
    let pairs = 0;
    for (let i = 0; i < tokSets.length; i++) {
      for (let j = i + 1; j < tokSets.length; j++) {
        total += jaccardSim(tokSets[i], tokSets[j]);
        pairs++;
      }
    }
    if (pairs > 0 && total / pairs >= 0.6) {
      const last = last3[last3.length - 1];
      return { mode: last.mode, prompt: last.prompt };
    }
  }
  return null;
}

/** Longest common case-sensitive prefix across an array of strings.
 *  Used by the error-memory loop to detect that the user keeps trying
 *  similar phrasings that are blocked. */
function sharedPrefix(strs: string[]): string {
  if (strs.length === 0) return "";
  let i = 0;
  const min = Math.min(...strs.map((s) => s.length));
  while (
    i < min &&
    strs.every((s) => s.charCodeAt(i) === strs[0].charCodeAt(i))
  ) {
    i++;
  }
  return strs[0].slice(0, i);
}

function defaultSolid(t: AssetType): boolean {
  // Buildings, tiles-as-objects (rare), and creatures act as obstacles.
  // Items, UI icons, and characters are passable.
  return t === "building" || t === "creature";
}

/** Procedural 32×32 grass tile so every fresh scene has visible ground
 *  even before the user generates a real tile asset. */
function makeGrassTileDataUrl(): string {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#3f6e2e";
  ctx.fillRect(0, 0, 32, 32);
  // Deterministic pseudo-random blade specks so the tile actually looks
  // like grass when it tiles, not like a flat green square.
  let seed = 1234;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 80; i++) {
    const x = Math.floor(rand() * 32);
    const y = Math.floor(rand() * 32);
    const r = rand();
    ctx.fillStyle = r < 0.33 ? "#4f8a3a" : r < 0.66 ? "#2d521e" : "#5ea34b";
    ctx.fillRect(x, y, 1, r < 0.5 ? 2 : 1);
  }
  return c.toDataURL("image/png");
}

/** Procedural 32×32 wood-plank floor tile for interior scenes. */
function makeWoodFloorTileDataUrl(): string {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  // Two horizontal planks of 16 px each, slightly different shades.
  ctx.fillStyle = "#a07346";
  ctx.fillRect(0, 0, 32, 16);
  ctx.fillStyle = "#8c6238";
  ctx.fillRect(0, 16, 32, 16);
  // Plank seam (single-pixel dark line between rows).
  ctx.fillStyle = "#3f2a14";
  ctx.fillRect(0, 15, 32, 1);
  ctx.fillRect(0, 31, 32, 1);
  // Vertical board cuts so the planks read as boards, not slabs.
  ctx.fillRect(11, 0, 1, 16);
  ctx.fillRect(22, 16, 1, 16);
  // Subtle wood-grain specks.
  let seed = 4242;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 30; i++) {
    const x = Math.floor(rand() * 32);
    const y = Math.floor(rand() * 32);
    ctx.fillStyle = rand() < 0.5 ? "#754a22" : "#b48452";
    ctx.fillRect(x, y, rand() < 0.5 ? 2 : 1, 1);
  }
  return c.toDataURL("image/png");
}

/** Procedural 32×32 stone-floor tile for vault / dungeon / shop interiors. */
function makeStoneFloorTileDataUrl(): string {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#5e5a55";
  ctx.fillRect(0, 0, 32, 32);
  // 16-px stone blocks with mortar lines.
  ctx.fillStyle = "#3a3633";
  ctx.fillRect(0, 15, 32, 1);
  ctx.fillRect(15, 0, 1, 16);
  ctx.fillRect(7, 16, 1, 16);
  ctx.fillRect(23, 16, 1, 16);
  // Mottle.
  let seed = 9999;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(rand() * 32);
    const y = Math.floor(rand() * 32);
    const r = rand();
    ctx.fillStyle = r < 0.4 ? "#6f6b65" : r < 0.7 ? "#4a4642" : "#7a7670";
    ctx.fillRect(x, y, 1, 1);
  }
  return c.toDataURL("image/png");
}

/** Procedural 64×64 character placeholder so Play mode works even before
 *  the user has generated a real character. */
function makeDefaultCharacterDataUrl(): string {
  // 64×64 canvas drawn as a 32×32 logical sprite (2× nearest-neighbor) — a
  // cozy-preset straw-hat farmer. Composed via `pix(x, y, w?, h?)` so the
  // sprite is laid out in logical-pixel coordinates and stays crisp.
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const pix = (x: number, y: number, w = 1, h = 1) =>
    ctx.fillRect(x * 2, y * 2, w * 2, h * 2);

  // Palette tuned to the cozy preset (warm, low saturation, brown family).
  const SKIN = "#f4c89a";
  const SKIN_SHADOW = "#d8a878";
  const HAIR = "#3a2410";
  const HAT = "#c8a87a";
  const HAT_DARK = "#8a6a3a";
  const OVERALLS = "#6e4a2a";
  const OVERALLS_DARK = "#4a3018";
  const SHIRT = "#c44a2e";
  const BOOTS = "#2a1a08";
  const OUTLINE = "rgba(0,0,0,0.45)";

  // Soft ground shadow.
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  pix(11, 28, 10, 1);
  pix(12, 29, 8, 1);

  // Hair tufts (drawn FIRST so the hat brim covers the top).
  ctx.fillStyle = HAIR;
  pix(11, 9, 2, 1);  // left tuft below brim
  pix(19, 9, 2, 1);  // right tuft below brim

  // Head (skin).
  ctx.fillStyle = SKIN;
  pix(11, 9, 10, 5);   // main head block — overlaps the hair line slightly
  // Trim the corners so it reads more rounded.
  ctx.clearRect(22, 18, 2, 2);
  ctx.clearRect(38, 18, 2, 2);
  ctx.clearRect(22, 26, 2, 2);
  ctx.clearRect(38, 26, 2, 2);

  // Cheek shadow on the right.
  ctx.fillStyle = SKIN_SHADOW;
  pix(19, 12, 1, 1);
  pix(11, 12, 1, 1);

  // Eyes.
  ctx.fillStyle = "#1a1208";
  pix(13, 11, 1, 1);
  pix(18, 11, 1, 1);

  // Mouth.
  ctx.fillStyle = "#8a3018";
  pix(15, 13, 2, 1);

  // Hat brim — covers the top of the head; wide and flat.
  ctx.fillStyle = HAT;
  pix(9, 7, 14, 2);
  // Hat top — narrower, sitting on the brim.
  pix(12, 4, 8, 3);
  // Brim shadow line under the brim — sells the depth.
  ctx.fillStyle = HAT_DARK;
  pix(9, 9, 14, 1);
  // A single dark pixel at the band of the hat for a tiny ribbon detail.
  pix(13, 6, 6, 1);

  // Body / overalls.
  ctx.fillStyle = OVERALLS;
  pix(11, 14, 10, 8);
  // Bib opening showing red shirt underneath.
  ctx.fillStyle = SHIRT;
  pix(14, 14, 4, 3);
  // Bib straps — two thin verticals over the shoulders.
  ctx.fillStyle = OVERALLS;
  pix(13, 14, 1, 3);
  pix(18, 14, 1, 3);
  // Overall buttons (tiny).
  ctx.fillStyle = OVERALLS_DARK;
  pix(13, 17, 1, 1);
  pix(18, 17, 1, 1);

  // Arms (skin), tucked alongside the body.
  ctx.fillStyle = SKIN;
  pix(9, 15, 2, 5);
  pix(21, 15, 2, 5);

  // Legs / overalls continued.
  ctx.fillStyle = OVERALLS;
  pix(11, 22, 4, 4);
  pix(17, 22, 4, 4);
  // Center gap reads as "two legs"; explicitly clear it.
  ctx.clearRect(15 * 2, 22 * 2, 2 * 2, 4 * 2);
  // Knee shadow.
  ctx.fillStyle = OVERALLS_DARK;
  pix(11, 25, 4, 1);
  pix(17, 25, 4, 1);

  // Boots.
  ctx.fillStyle = BOOTS;
  pix(11, 26, 4, 2);
  pix(17, 26, 4, 2);

  // Outline pass — thin dark pixels on the silhouette edges to ground the
  // shape against light backgrounds. Drawn at 1 device-pixel for crispness.
  ctx.fillStyle = OUTLINE;
  // Head outline
  ctx.fillRect(11 * 2 - 1, 9 * 2, 1, 5 * 2);   // left
  ctx.fillRect(21 * 2, 9 * 2, 1, 5 * 2);       // right
  // Body outline
  ctx.fillRect(11 * 2 - 1, 14 * 2, 1, 8 * 2);  // left
  ctx.fillRect(21 * 2, 14 * 2, 1, 8 * 2);      // right
  return c.toDataURL("image/png");
}

function parseSize(s: string | undefined): [number, number] {
  if (!s) return [1024, 1024];
  const [w, h] = s.split("x").map(Number);
  return [w || 1024, h || 1024];
}

async function applyPixelate(rawUrl: string, gridSize: number, sourceSize: string | undefined) {
  if (gridSize === 0) return rawUrl;
  const [w, h] = parseSize(sourceSize);
  const ratio = w / h;
  return await pixelateImageUrl(rawUrl, {
    gridSize,
    gridSizeY: Math.round(gridSize / ratio),
    outputSize: 512,
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function drawWithFlip(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  w: number,
  h: number,
  flipX?: boolean,
  flipY?: boolean,
  rotationDeg?: number,
  anchor?: "bottom" | "center"
) {
  // Anchor offsets relative to the (cx, cy) point. center → image is
  // drawn so its centre lands on (cx, cy); bottom → image's bottom-centre
  // lands on (cx, cy), i.e. the y given is the ground line.
  const ay = anchor === "bottom" ? -h : -h / 2;
  if (!flipX && !flipY && !rotationDeg) {
    ctx.drawImage(img, cx - w / 2, cy + ay, w, h);
    return;
  }
  ctx.save();
  ctx.translate(cx, cy);
  if (rotationDeg) ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(img, -w / 2, ay, w, h);
  ctx.restore();
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.split(",")[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function slugify(name: string): string {
  return (name || "scene").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scene";
}

async function downscaleImage(url: string, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const ratio = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * ratio);
      const h = Math.round(img.naturalHeight * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = url;
  });
}
