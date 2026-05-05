// Client-side pixel-snap post-process: load image, downscale with smoothing
// off, then upscale back to display size for crisp pixels. Optionally quantize
// to a small palette.

export type PixelateOptions = {
  /** Horizontal pixel grid size. */
  gridSize?: number;
  /** Vertical pixel grid size. Defaults to gridSize (square). */
  gridSizeY?: number;
  /** Final canvas longest-edge size in CSS pixels. Defaults to 512. */
  outputSize?: number;
  /** If set, snap colors to this many levels per channel (e.g. 6 → ~216 colors). */
  paletteLevels?: number;
  /** Trim near-white background to transparent if true. */
  removeBackground?: boolean;
};

export async function pixelateImageUrl(
  url: string,
  opts: PixelateOptions = {}
): Promise<string> {
  const {
    gridSize = 96,
    gridSizeY = gridSize,
    outputSize = 512,
    paletteLevels = 0,
    removeBackground = false,
  } = opts;

  const img = await loadImage(url);
  const gW = gridSize;
  const gH = gridSizeY;

  // Step 1: draw at small (grid) size with smoothing OFF.
  const small = document.createElement("canvas");
  small.width = gW;
  small.height = gH;
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(img, 0, 0, gW, gH);

  // Step 2 (optional): palette quantize and/or background removal.
  if (paletteLevels > 0 || removeBackground) {
    const data = sctx.getImageData(0, 0, gW, gH);
    const px = data.data;
    const step = paletteLevels > 0 ? 255 / (paletteLevels - 1) : 0;
    for (let i = 0; i < px.length; i += 4) {
      if (paletteLevels > 0) {
        px[i] = Math.round(Math.round(px[i] / step) * step);
        px[i + 1] = Math.round(Math.round(px[i + 1] / step) * step);
        px[i + 2] = Math.round(Math.round(px[i + 2] / step) * step);
      }
      if (removeBackground) {
        // Treat near-white pixels as background.
        if (px[i] > 240 && px[i + 1] > 240 && px[i + 2] > 240) {
          px[i + 3] = 0;
        }
      }
    }
    sctx.putImageData(data, 0, 0);
  }

  // Step 3: upscale with nearest-neighbor to final size, preserving aspect.
  const longest = Math.max(gW, gH);
  const outW = Math.round((gW / longest) * outputSize);
  const outH = Math.round((gH / longest) * outputSize);
  const big = document.createElement("canvas");
  big.width = outW;
  big.height = outH;
  const bctx = big.getContext("2d")!;
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(small, 0, 0, outW, outH);

  return big.toDataURL("image/png");
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
