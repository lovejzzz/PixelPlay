"use client";

import { useEffect } from "react";
import { SHORTCUTS } from "../../lib/shortcuts";

/**
 * Keyboard-shortcut help modal — opens via ? (Shift+/) key. Escape +
 * click-outside + ✕ all dismiss. Extracted from page.tsx in Phase 15
 * fire #90.
 */
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[65] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-farm-ink animate-modal-in border-2 border-farm-wood w-full max-w-lg max-h-[80vh] overflow-y-auto p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="font-pixel text-lg text-farm-grass leading-snug">⌨ Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="text-farm-parchment/70 hover:text-farm-parchment text-xl leading-none px-2 ml-2 shrink-0"
            title="Close"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="space-y-4">
          {SHORTCUTS.map((group) => (
            <div key={group.title} className="space-y-1.5">
              <h3 className="text-xs font-pixel text-farm-parchment uppercase tracking-wider opacity-80">
                {group.title}
              </h3>
              <div className="border border-farm-wood/40">
                {group.entries.map((entry, i) => (
                  <div
                    key={`${group.title}-${i}`}
                    className={`flex items-center gap-3 px-2 py-1.5 text-xs ${
                      i % 2 === 0 ? "bg-farm-ink/40" : ""
                    }`}
                  >
                    <span className="font-mono text-farm-grass shrink-0 min-w-[10rem]">
                      {entry.keys}
                    </span>
                    <span className="opacity-80">{entry.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
