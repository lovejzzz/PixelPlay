"use client";

import { useEffect, useState } from "react";
import type { Asset } from "../../types";
import {
  applyPalette,
  extractPalette,
  BUILT_IN_PALETTES,
  type Palette,
  type RGB,
} from "../../lib/palette";

/**
 * "Snap to palette" modal — applies a chosen palette to an asset's
 * pixel art and saves the result as a new asset (the apply callback
 * does the save). Built-in palettes are previewed in-modal; users can
 * also upload an image to extract a custom palette.
 *
 * Extracted from page.tsx in Phase 15 fire #90.
 */
export function PaletteModal({
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
        className="panel animate-modal-in bg-farm-ink p-4 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
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
