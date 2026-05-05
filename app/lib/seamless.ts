/**
 * Make a tile texture seamlessly tileable using the classic offset+blend
 * technique:
 *
 * 1. Shift the tile by half its width and half its height (with wrap-around).
 *    This moves the original edges to the center of the new image — that's
 *    where the seams now are.
 * 2. Blur a thin cross through the center, smoothing out the seam pixels.
 *    The original edges of the new image are clean (they came from the
 *    interior of the source).
 *
 * For pixel art, blur trades crispness for tileability. Best for natural
 * textures (grass, dirt, water). Geometric tiles (bricks, planks) will lose
 * a bit of sharpness near where the original seam was.
 */
export async function makeSeamless(url: string): Promise<string> {
  const img = await loadImage(url);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const halfW = W / 2;
  const halfH = H / 2;
  const seamPx = Math.max(8, Math.round(W * 0.05));

  // Build the offset image first.
  const offset = document.createElement("canvas");
  offset.width = W;
  offset.height = H;
  const ox = offset.getContext("2d")!;
  ox.imageSmoothingEnabled = false;
  // Draw four copies, offset by ±half. Together these tile the source twice.
  ox.drawImage(img, -halfW, -halfH);
  ox.drawImage(img, halfW, -halfH);
  ox.drawImage(img, -halfW, halfH);
  ox.drawImage(img, halfW, halfH);

  // Now blur a center cross to soften the seam.
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const out_x = out.getContext("2d")!;
  out_x.imageSmoothingEnabled = false;
  out_x.drawImage(offset, 0, 0);

  // Blur a horizontal strip through the seam.
  out_x.save();
  out_x.beginPath();
  out_x.rect(0, halfH - seamPx, W, seamPx * 2);
  out_x.clip();
  out_x.filter = `blur(${Math.round(seamPx / 3)}px)`;
  out_x.drawImage(offset, 0, 0);
  out_x.restore();

  // And a vertical strip.
  out_x.save();
  out_x.beginPath();
  out_x.rect(halfW - seamPx, 0, seamPx * 2, H);
  out_x.clip();
  out_x.filter = `blur(${Math.round(seamPx / 3)}px)`;
  out_x.drawImage(offset, 0, 0);
  out_x.restore();

  return out.toDataURL("image/png");
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
