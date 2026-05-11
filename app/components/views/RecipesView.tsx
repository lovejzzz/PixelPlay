"use client";

import type { GenMode, Recipe } from "../../types";
import { confirm as confirmDialog } from "../ConfirmDialog";

export function RecipesView({
  recipes,
  onApply,
  onDelete,
}: {
  recipes: Record<string, Recipe>;
  onApply: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const list = Object.values(recipes).sort(
    (a, b) => b.usageCount - a.usageCount || b.createdAt - a.createdAt
  );
  if (list.length === 0) {
    return (
      <div className="my-4 mx-auto max-w-xs text-center px-6 py-8 border-2 border-dashed border-farm-wood/40 bg-farm-ink/30">
        <div className="text-7xl mb-3 leading-none">📋</div>
        <p className="font-pixel text-sm text-farm-parchment mb-2">
          No recipes yet — save a prompt pattern
        </p>
        <p className="text-xs opacity-70">
          Tweak the FORGE form, then click 💾 next to the Type buttons to
          save it as a one-click recipe.
        </p>
      </div>
    );
  }
  const modeEmoji: Record<GenMode, string> = {
    item: "🌽",
    character: "🧑‍🌾",
    scene: "🎬",
  };
  return (
    <div className="space-y-2">
      {list.map((r) => (
        <div
          key={r.id}
          className="border-2 border-farm-wood/60 bg-farm-ink/30 p-2 space-y-1"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none">{modeEmoji[r.mode]}</span>
            <span className="font-pixel text-sm text-farm-grass flex-1 truncate">
              {r.name}
            </span>
            <span className="text-[10px] opacity-50 tabular-nums">
              {r.usageCount}× used
            </span>
            <button
              type="button"
              onClick={() => onApply(r.id)}
              title="Apply this recipe — fills the form with its values"
              className="text-xs px-2 py-0.5 border border-farm-grass text-farm-grass bg-farm-grass/10 hover:bg-farm-grass/20"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: "Delete recipe?",
                  body: `"${r.name}" will be removed from this project.`,
                  confirmLabel: "Delete recipe",
                });
                if (ok) onDelete(r.id);
              }}
              title="Delete recipe"
              className="text-xs px-1.5 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
            >
              ✕
            </button>
          </div>
          <div className="text-xs opacity-70 truncate" title={r.prompt}>
            {r.prompt || <span className="opacity-50">(no prompt)</span>}
          </div>
          {r.description && (
            <div className="text-[10px] opacity-50 italic">{r.description}</div>
          )}
        </div>
      ))}
    </div>
  );
}
