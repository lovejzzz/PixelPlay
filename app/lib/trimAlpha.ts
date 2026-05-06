/**
 * Crop a PNG data URL to its alpha-bounded content rectangle.
 *
 * gpt-image-1 returns transparent-background sprites where the actual
 * silhouette can occupy anywhere from 30% to 90% of the 1024×1024 frame.
 * For scene composition this matters a lot: when we render an item at
 * `scale × longestEdge`, that math is interpreted as "PNG canvas size"
 * not "actual visual size". A pine tree's silhouette might fill its frame
 * 60%, a wooden cabin 85%; both rendered at scale=0.25 then look like
 * the tree is much smaller than the cabin even though their PNGs are the
 * same size.
 *
 * Trimming each PNG to its content bbox means `scale × longestEdge`
 * matches what the user actually sees.
 */
export async function trimAlphaToContent(
  dataUrl: string,
  alphaThreshold = 16
): Promise<{ url: string; trimmed: boolean; width: number; height: number }> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w === 0 || h === 0) {
    return { url: dataUrl, trimmed: false, width: w, height: h };
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a >= alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Entirely transparent (or all below threshold) — leave it alone.
  if (maxX < 0) return { url: dataUrl, trimmed: false, width: w, height: h };

  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  // Skip the round-trip if the image is essentially already tight (within
  // 2 px on every side). Saves a needless re-encode.
  if (minX <= 2 && minY <= 2 && w - 1 - maxX <= 2 && h - 1 - maxY <= 2) {
    return { url: dataUrl, trimmed: false, width: w, height: h };
  }

  const out = document.createElement("canvas");
  out.width = tw;
  out.height = th;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(c, minX, minY, tw, th, 0, 0, tw, th);
  return {
    url: out.toDataURL("image/png"),
    trimmed: true,
    width: tw,
    height: th,
  };
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
