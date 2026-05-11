"use client";

import { useRef } from "react";
import type { Project } from "../../types";
import { confirm as confirmDialog } from "../ConfirmDialog";

export function ProjectSwitcher({
  projects,
  currentId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onExport,
  onShare,
  onImport,
}: {
  projects: Record<string, Project>;
  currentId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onExport: () => void;
  onShare: () => void;
  onImport: (file: File) => void;
}) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const list = Object.values(projects).sort((a, b) => a.createdAt - b.createdAt);
  const current = projects[currentId];

  function handleCreate() {
    const name = prompt("New project name:", "")?.trim();
    if (name) onCreate(name);
  }
  function handleRename() {
    const name = prompt("Rename project:", current?.name)?.trim();
    if (name) onRename(name);
  }
  async function handleDelete() {
    if (!current) return;
    const ok = await confirmDialog({
      title: "Delete project?",
      body: `"${current.name}" and all of its assets, scenes, and recipes will be removed. This cannot be undone.`,
      confirmLabel: "Delete project",
    });
    if (!ok) return;
    onDelete();
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <select
        value={currentId}
        onChange={(e) => onSelect(e.target.value)}
        className="bg-farm-ink border border-farm-wood text-farm-parchment px-1 py-0.5 max-w-[140px]"
        title="Switch project"
      >
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            📁 {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleCreate}
        title="New project"
        className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
      >
        +
      </button>
      <button
        type="button"
        onClick={handleRename}
        title="Rename"
        className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
      >
        ✎
      </button>
      <button
        type="button"
        onClick={onExport}
        title="Export entire project (assets + scenes) as zip"
        className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
      >
        ⬇
      </button>
      <button
        type="button"
        onClick={onShare}
        title="Share link — uploads project zip and copies a public URL"
        className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
      >
        🔗
      </button>
      <button
        type="button"
        onClick={() => importInputRef.current?.click()}
        title="Import a project zip exported from Pixel Play"
        className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
      >
        📥
      </button>
      <input
        ref={importInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          // Reset so picking the same file twice still fires onChange.
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={handleDelete}
        title="Delete project"
        className="px-1.5 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
      >
        🗑
      </button>
    </div>
  );
}
