import { sliceSheet } from "./sprites";

/**
 * Quick "are these cells actually different?" check for multi-frame assets.
 *
 * gpt-image-1 sometimes silently returns a 4×4 sheet where most cells are
 * near-identical (same pose repeated, or only minor jitter). For game use
 * that defeats the purpose. We slice the sheet, compute a coarse signature
 * per cell, and report which cells are too similar to their neighbors.
 *
 * Algorithm:
 * 1. Slice into cols × rows cells.
 * 2. For each cell, downscale to 16×16 RGB and store as a 768-byte vector.
 * 3. Compare each cell to its row-neighbor (walk-cycle frames should differ)
 *    and column-neighbor (different facing directions should differ).
 *    Count pairs whose distance is below SIM_THRESHOLD as "duplicate-ish".
 * 4. If >50% of within-row comparisons are duplicate-ish (or any column
 *    comparison is duplicate-ish), flag the asset.
 */
export type VarietyResult = {
  /** True if the sheet appears to have meaningfully different cells. */
  varied: boolean;
  /** Pairs of cell indices that look near-identical. */
  duplicatePairs: Array<[number, number]>;
  /** Average pairwise distance — useful for tooltips. */
  avgDistance: number;
  /** Total cells. 1 → not a multi-frame sheet. */
  cellCount: number;
};

const SIM_THRESHOLD = 22; // average per-channel diff. Tuned empirically.

export async function checkSheetVariety(
  sheetUrl: string,
  cols: number,
  rows: number
): Promise<VarietyResult> {
  const total = cols * rows;
  if (total <= 1) return { varied: true, duplicatePairs: [], avgDistance: 0, cellCount: total };

  let frames: string[] = [];
  try {
    frames = await sliceSheet(sheetUrl, cols, rows);
  } catch {
    return { varied: true, duplicatePairs: [], avgDistance: 0, cellCount: total };
  }

  // Compute 16×16 RGB signatures for every cell in parallel.
  const sigs = await Promise.all(frames.map((u) => signature(u)));

  // Build the comparison list: row-neighbors (j == i+1) AND col-neighbors
  // (j == i+cols). Only compare each pair once.
  const pairs: Array<{ i: number; j: number; rowSiblings: boolean }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      pairs.push({ i: r * cols + c, j: r * cols + c + 1, rowSiblings: true });
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      pairs.push({ i: r * cols + c, j: (r + 1) * cols + c, rowSiblings: false });
    }
  }

  let totalDist = 0;
  const duplicatePairs: Array<[number, number]> = [];
  let rowDupCount = 0;
  let colDup = false;
  let rowPairs = 0;
  for (const p of pairs) {
    const d = avgDist(sigs[p.i], sigs[p.j]);
    totalDist += d;
    if (d < SIM_THRESHOLD) {
      duplicatePairs.push([p.i, p.j]);
      if (p.rowSiblings) rowDupCount++;
      else colDup = true;
    }
    if (p.rowSiblings) rowPairs++;
  }

  const varied =
    !colDup && (rowPairs === 0 || rowDupCount / rowPairs <= 0.5);
  return {
    varied,
    duplicatePairs,
    avgDistance: totalDist / Math.max(1, pairs.length),
    cellCount: total,
  };
}

async function signature(dataUrl: string): Promise<Uint8ClampedArray> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, 16, 16);
  return ctx.getImageData(0, 0, 16, 16).data;
}

function avgDist(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  // Iterate RGB channels only (skip alpha). 16*16*3 = 768 samples.
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]);
    sum += Math.abs(a[i + 1] - b[i + 1]);
    sum += Math.abs(a[i + 2] - b[i + 2]);
    n += 3;
  }
  return sum / n;
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
