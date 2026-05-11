"use client";

import type { Asset } from "../../types";

/**
 * Session-trash modal — shows recently-deleted assets, restore-one or
 * empty-all. Trash is in-memory only (stripped before IDB persist), so
 * reloading the page clears it. Extracted from page.tsx in Phase 15
 * fire #90.
 */
export function TrashModal({
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
        className="bg-farm-ink animate-modal-in border-2 border-farm-wood w-full max-w-2xl max-h-[80vh] overflow-y-auto p-5 space-y-4"
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
