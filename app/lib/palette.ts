/**
 * Color-palette enforcement: snap every pixel of an image to the nearest
 * color in a target palette. For pixel art this enforces authenticity
 * against a known-good color set (NES, GameBoy, Pico-8, etc.) regardless of
 * what gpt-image-1 actually returned.
 *
 * Distance metric: weighted RGB (heavier on green; matches human perception
 * better than naive Euclidean and is faster than CIELAB conversion).
 */

export type RGB = [number, number, number];

export type Palette = {
  id: string;
  name: string;
  colors: RGB[];
};

// ---------- built-in palettes ----------

/** Original Game Boy: 4 shades of green. */
export const GAMEBOY: Palette = {
  id: "gameboy",
  name: "Game Boy (4 greens)",
  colors: [
    [15, 56, 15],
    [48, 98, 48],
    [139, 172, 15],
    [155, 188, 15],
  ],
};

/** Pico-8: classic 16-color fantasy console palette. */
export const PICO8: Palette = {
  id: "pico8",
  name: "Pico-8 (16)",
  colors: [
    [0, 0, 0], [29, 43, 83], [126, 37, 83], [0, 135, 81],
    [171, 82, 54], [95, 87, 79], [194, 195, 199], [255, 241, 232],
    [255, 0, 77], [255, 163, 0], [255, 236, 39], [0, 228, 54],
    [41, 173, 255], [131, 118, 156], [255, 119, 168], [255, 204, 170],
  ],
};

/** Authentic NES 54-color palette (the on-screen-capable subset). */
export const NES: Palette = {
  id: "nes",
  name: "NES (54)",
  colors: [
    [124, 124, 124], [0, 0, 252], [0, 0, 188], [68, 40, 188],
    [148, 0, 132], [168, 0, 32], [168, 16, 0], [136, 20, 0],
    [80, 48, 0], [0, 120, 0], [0, 104, 0], [0, 88, 0],
    [0, 64, 88], [0, 0, 0],
    [188, 188, 188], [0, 120, 248], [0, 88, 248], [104, 68, 252],
    [216, 0, 204], [228, 0, 88], [248, 56, 0], [228, 92, 16],
    [172, 124, 0], [0, 184, 0], [0, 168, 0], [0, 168, 68],
    [0, 136, 136], [0, 0, 0],
    [248, 248, 248], [60, 188, 252], [104, 136, 252], [152, 120, 248],
    [248, 120, 248], [248, 88, 152], [248, 120, 88], [252, 160, 68],
    [248, 184, 0], [184, 248, 24], [88, 216, 84], [88, 248, 152],
    [0, 232, 216], [120, 120, 120],
    [252, 252, 252], [164, 228, 252], [184, 184, 248], [216, 184, 248],
    [248, 184, 248], [248, 164, 192], [240, 208, 176], [252, 224, 168],
    [248, 216, 120], [216, 248, 120], [184, 248, 184], [184, 248, 216],
    [0, 252, 252], [216, 216, 216],
  ],
};

/** Pure black-and-white. */
export const MONO: Palette = {
  id: "mono",
  name: "Monochrome (B&W)",
  colors: [
    [0, 0, 0],
    [255, 255, 255],
  ],
};

export const BUILT_IN_PALETTES: Palette[] = [GAMEBOY, PICO8, NES, MONO];

// ---------- snap algorithm ----------

/**
 * Snap an image's colors to the given palette, preserving alpha. Returns
 * a new PNG data URL. Pixels with alpha < 8 stay transparent.
 */
export async function applyPalette(
  url: string,
  palette: Palette,
  options: { alphaThreshold?: number } = {}
): Promise<string> {
  const { alphaThreshold = 8 } = options;
  const img = await loadImage(url);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);

  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  // Pre-pack palette as Float32 for speed.
  const pal = palette.colors;
  const N = pal.length;

  // Distance cache keyed by 16-bit color (R6G6B4 quantized) to skip recomputing.
  const cache = new Map<number, number>();

  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a < alphaThreshold) {
      px[i + 3] = 0;
      continue;
    }
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const key = ((r >> 2) << 10) | ((g >> 2) << 4) | (b >> 4);
    let idx = cache.get(key);
    if (idx === undefined) {
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < N; k++) {
        const dr = r - pal[k][0];
        const dg = g - pal[k][1];
        const db = b - pal[k][2];
        // Weighted distance — eyes are most sensitive to green.
        const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      idx = best;
      cache.set(key, idx);
    }
    const c = pal[idx];
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = 255;
  }

  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Extract the N most-common colors from an image (a "scrubbed" k-means
 * approximation). Used so users can upload a reference image and have
 * its palette extracted automatically.
 */
export async function extractPalette(
  url: string,
  count: number = 16
): Promise<RGB[]> {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  // Downscale so we don't iterate millions of pixels for a small palette.
  const maxDim = 256;
  const ratio = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  // Bucket by quantized color (R5G5B5).
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 32) continue;
    const r = data[i] >> 3;
    const g = data[i + 1] >> 3;
    const b = data[i + 2] >> 3;
    const key = (r << 10) | (g << 5) | b;
    const e = buckets.get(key);
    if (e) {
      e.r += data[i];
      e.g += data[i + 1];
      e.b += data[i + 2];
      e.n++;
    } else {
      buckets.set(key, { r: data[i], g: data[i + 1], b: data[i + 2], n: 1 });
    }
  }

  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, count);
  return sorted.map((e) => [
    Math.round(e.r / e.n),
    Math.round(e.g / e.n),
    Math.round(e.b / e.n),
  ]);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}
