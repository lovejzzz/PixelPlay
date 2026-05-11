/**
 * Pure standalone helpers extracted from `app/page.tsx` in Phase 15
 * fire #89 — the third structural decomposition pass. Each function
 * is COPIED VERBATIM from the original page.tsx implementation to
 * preserve byte-equivalent behavior (procedural sprite pixels, slug
 * defaults, etc.). Don't optimize or tidy here without a regression
 * test — visual outputs in particular are signature-sensitive.
 *
 * Grouped by concern:
 *  - Form / project helpers
 *  - Solid-collision keyword checks
 *  - Procedural pixel-art sprites
 *  - Image / data-URL utilities
 *  - String / slug utilities
 *  - Recipe-pattern detection
 *  - Background-color picker from scene context
 */
import type {
  AssetType,
  GenMode,
  Project,
  ProjectStyle,
  StylePreset,
} from "../types";
import { BLOCKER_KEYWORDS } from "../constants";

// ─── Form / project helpers ──────────────────────────────────────────

export function gridLabel(g: number) {
  return g === 0 ? "Raw" : `${g}px`;
}

export function emptyStyle(presetOverride?: StylePreset): ProjectStyle {
  return { text: "", refUrl: null, preset: presetOverride || "cozy" };
}

export function newProject(name: string, presetOverride?: StylePreset): Project {
  return {
    id: crypto.randomUUID(),
    name,
    style: emptyStyle(presetOverride),
    assets: {},
    scenes: {},
    createdAt: Date.now(),
  };
}

// ─── Solid / collision keyword checks ────────────────────────────────

export function defaultSolid(t: AssetType): boolean {
  // Buildings, tiles-as-objects (rare), and creatures act as obstacles.
  // Items, UI icons, and characters are passable.
  return t === "building" || t === "creature";
}

/** Name-based blocker check — items whose descriptor contains a known
 *  "blocks the player" keyword (a tree, a cabin, a statue, a fountain,
 *  ...) become solid even when their assetType wouldn't trigger it.
 *  The motivation: a "tree" generated as assetType "item" should still
 *  block the player walking into it. Caller can OR this with the
 *  assetType-based `defaultSolid()` for the final value. */
export function defaultSolidForName(name: string | undefined): boolean {
  if (!name) return false;
  const s = name.toLowerCase();
  // Whole-word match against a curated keyword list. Use a regex with
  // word boundaries so "store" doesn't trigger on "tower", etc.
  return BLOCKER_KEYWORDS.some((k) => new RegExp(`\\b${k}\\b`, "i").test(s));
}

// ─── Procedural pixel-art sprites ────────────────────────────────────

/** Procedural 32×32 grass tile so every fresh scene has visible ground
 *  even before the user generates a real tile asset. */
export function makeGrassTileDataUrl(): string {
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
export function makeWoodFloorTileDataUrl(): string {
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
export function makeStoneFloorTileDataUrl(): string {
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
export function makeDefaultCharacterDataUrl(): string {
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

// ─── Image / data-URL utilities ──────────────────────────────────────

export function parseSize(s: string | undefined): [number, number] {
  if (!s) return [1024, 1024];
  const [w, h] = s.split("x").map(Number);
  return [w || 1024, h || 1024];
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function drawWithFlip(
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

export function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.split(",")[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function slugify(name: string): string {
  return (name || "scene").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scene";
}

export async function downscaleImage(url: string, maxSize: number): Promise<string> {
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

// ─── Recipe-pattern detection ────────────────────────────────────────

/** Whitespace-token set for Jaccard-overlap comparison. Drops 1- and
 *  2-char tokens (articles, prepositions) since they don't carry pattern
 *  signal — "a", "of", "to", etc. */
export function promptTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[\s.,;:!?()'"]+/)
      .filter((t) => t.length >= 3)
  );
}

export function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

export function detectRecipePattern(
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
export function sharedPrefix(strs: string[]): string {
  if (strs.length === 0) return "";
  let i = 0;
  const min = Math.min(...strs.map((s) => s.length));
  while (i < min && strs.every((s) => s.charCodeAt(i) === strs[0].charCodeAt(i))) i++;
  return strs[0].slice(0, i);
}

// ─── Scene-context background color ──────────────────────────────────

export function autoBackgroundColorForContext(
  context?: "interior" | "exterior" | "aerial"
): string | undefined {
  if (context === "interior") return "#c9a779";
  if (context === "exterior") return "#7cb86b";
  if (context === "aerial") return "#d6c08a";
  return undefined;
}
