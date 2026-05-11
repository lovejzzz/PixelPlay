"use client";

import type { Prefab } from "../../types";

export function PrefabLibrary({
  prefabs,
  onDelete,
  onSync,
}: {
  prefabs: Record<string, Prefab>;
  onDelete: (id: string) => void;
  onSync: (id: string) => void;
}) {
  const list = Object.values(prefabs).sort((a, b) => a.createdAt - b.createdAt);
  if (list.length === 0) return null;
  return (
    <div className="border-2 border-farm-wood/60 bg-farm-ink/30 p-2 text-xs space-y-1">
      <div className="flex items-center justify-between mb-1">
        <span className="font-pixel text-farm-sky">📦 Prefabs ({list.length})</span>
        <span className="opacity-50 text-[10px]">drag onto canvas to instantiate</span>
      </div>
      {list.map((p) => (
        <div
          key={p.id}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-pwf-prefab-id", p.id);
            e.dataTransfer.effectAllowed = "copy";
          }}
          className="flex items-center gap-2 p-1 cursor-grab hover:bg-farm-wood/20"
        >
          <span className="opacity-40 select-none">📦</span>
          <span className="flex-1 truncate" title={p.name}>{p.name}</span>
          <span className="opacity-50 tabular-nums">{p.items.length} items</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSync(p.id); }}
            title="Push master changes to all instances of this prefab"
            className="px-1 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
          >
            🔄
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!confirm(`Delete prefab "${p.name}"? Existing instances stay.`)) return;
              onDelete(p.id);
            }}
            className="px-1 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

