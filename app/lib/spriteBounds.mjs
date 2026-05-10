/**
 * Pure RGBA bounds analyzer. Pulled into its own .mjs file (no TypeScript,
 * no imports) so it's directly importable from a Node test script without
 * a TS compiler step. Both the browser wrapper in sprites.ts and the
 * test harness import this same function.
 *
 * Inspects each pixel's alpha channel and returns the tightest bounding
 * box of pixels with alpha > threshold, expressed as fractions [0, 1] of
 * the image's width and height.
 *
 * @param {Uint8ClampedArray | Uint8Array | number[]} data - RGBA buffer
 *        of length width * height * 4.
 * @param {number} width
 * @param {number} height
 * @param {number} [alphaThreshold=16] - alpha values <= this count as
 *        transparent (anti-aliased fringes don't expand the bbox).
 * @returns {{ top: number, bottom: number, left: number, right: number }}
 *        Bounds as fractions of width/height. `top` and `left` are the
 *        position of the first non-transparent pixel; `bottom` and
 *        `right` are EXCLUSIVE (one past the last non-transparent
 *        pixel) so `(right - left) * width` gives the visible width.
 *        For a fully transparent image, returns the full canvas
 *        ({0, 1, 0, 1}) so downstream callers can degrade gracefully.
 */
export function analyzeBoundsFromRGBA(data, width, height, alphaThreshold = 16) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const rowOff = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[rowOff + x * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return { top: 0, bottom: 1, left: 0, right: 1 };
  }
  return {
    top: minY / height,
    bottom: (maxY + 1) / height,
    left: minX / width,
    right: (maxX + 1) / width,
  };
}
