import JSZip from "jszip";

/**
 * Slices a sprite-sheet image into rows × cols frames and returns each as a
 * data URL (PNG). The sheet is assumed to have evenly-spaced cells filling
 * the entire image.
 */
export async function sliceSheet(
  url: string,
  cols: number,
  rows: number
): Promise<string[]> {
  const img = await loadImage(url);
  const frameW = img.naturalWidth / cols;
  const frameH = img.naturalHeight / rows;

  const frames: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(frameW);
      canvas.height = Math.round(frameH);
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        img,
        Math.round(c * frameW),
        Math.round(r * frameH),
        Math.round(frameW),
        Math.round(frameH),
        0,
        0,
        canvas.width,
        canvas.height
      );
      frames.push(canvas.toDataURL("image/png"));
    }
  }
  return frames;
}

/**
 * Builds a Phaser-compatible JSON Hash atlas describing each frame's bbox
 * in the source sheet. Works for any cols × rows grid.
 */
export function buildAtlasJson(opts: {
  imageName: string;
  imageWidth: number;
  imageHeight: number;
  cols: number;
  rows: number;
  frameNames?: string[];
}) {
  const { imageName, imageWidth, imageHeight, cols, rows, frameNames } = opts;
  const fW = Math.round(imageWidth / cols);
  const fH = Math.round(imageHeight / rows);
  const frames: Record<string, unknown> = {};
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const name = frameNames?.[i] ?? `frame_${i}`;
      frames[name] = {
        frame: { x: c * fW, y: r * fH, w: fW, h: fH },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: fW, h: fH },
        sourceSize: { w: fW, h: fH },
      };
      i++;
    }
  }
  return {
    frames,
    meta: {
      app: "Pixel Play",
      image: imageName,
      format: "RGBA8888",
      size: { w: imageWidth, h: imageHeight },
      scale: "1",
    },
  };
}

/** Suggest semantic frame names for known pose layouts. */
export function frameNames(
  pose: "single" | "directions" | "walk-cycle" | "full-sheet",
  perspective: "top-down" | "side-view"
): string[] {
  if (pose === "single") return ["frame_0"];
  if (pose === "walk-cycle") return ["walk_0", "walk_1", "walk_2", "walk_3"];
  if (pose === "directions") {
    return perspective === "side-view"
      ? ["right", "left"]
      : ["south", "north", "west", "east"];
  }
  // full-sheet
  if (perspective === "side-view") {
    const out: string[] = [];
    for (const dir of ["right", "left"]) {
      for (let f = 0; f < 4; f++) out.push(`${dir}_walk_${f}`);
    }
    return out;
  }
  const out: string[] = [];
  for (const dir of ["south", "north", "west", "east"]) {
    for (let f = 0; f < 4; f++) out.push(`${dir}_walk_${f}`);
  }
  return out;
}

/**
 * Builds a ZIP containing each frame as a separate PNG plus an atlas.json
 * for engines that prefer a single image + metadata.
 */
export async function buildSpriteZip(opts: {
  fullSheetUrl: string;
  cols: number;
  rows: number;
  imageWidth: number;
  imageHeight: number;
  baseName: string;
  pose: "single" | "directions" | "walk-cycle" | "full-sheet";
  perspective: "top-down" | "side-view";
}): Promise<Blob> {
  const { fullSheetUrl, cols, rows, imageWidth, imageHeight, baseName, pose, perspective } = opts;
  const names = frameNames(pose, perspective);
  const frames = await sliceSheet(fullSheetUrl, cols, rows);

  const zip = new JSZip();
  // Full sheet (whole image)
  zip.file(`${baseName}.png`, dataUrlToBytes(fullSheetUrl));
  // Per-frame PNGs
  for (let i = 0; i < frames.length; i++) {
    const name = names[i] ?? `frame_${i}`;
    zip.file(`frames/${name}.png`, dataUrlToBytes(frames[i]));
  }
  // Atlas (Phaser / TexturePacker JSON Hash compatible).
  const atlas = buildAtlasJson({
    imageName: `${baseName}.png`,
    imageWidth,
    imageHeight,
    cols,
    rows,
    frameNames: names,
  });
  zip.file(`${baseName}.atlas.json`, JSON.stringify(atlas, null, 2));

  // Tiled tileset (.tsx) for engines that prefer that format.
  zip.file(
    `${baseName}.tsx`,
    buildTiledTilesetXml({
      imageName: `${baseName}.png`,
      imageWidth,
      imageHeight,
      cols,
      rows,
      name: baseName,
    })
  );

  return await zip.generateAsync({ type: "blob" });
}

/**
 * Tiled tileset (.tsx) XML for a sprite sheet. Each cell becomes a tile
 * in a regular grid. Game devs using Tiled or any of the engines that
 * import .tsx (Godot's Tiled importer, MonoGame, etc.) can drop this in.
 */
export function buildTiledTilesetXml(opts: {
  imageName: string;
  imageWidth: number;
  imageHeight: number;
  cols: number;
  rows: number;
  name: string;
}): string {
  const { imageName, imageWidth, imageHeight, cols, rows, name } = opts;
  const tileWidth = Math.round(imageWidth / cols);
  const tileHeight = Math.round(imageHeight / rows);
  const tileCount = cols * rows;
  const safeName = (name || "tileset").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.10" name="${safeName}" tilewidth="${tileWidth}" tileheight="${tileHeight}" tilecount="${tileCount}" columns="${cols}">
 <image source="${imageName}" width="${imageWidth}" height="${imageHeight}"/>
</tileset>
`;
}

function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.split(",")[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
