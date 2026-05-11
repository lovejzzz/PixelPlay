"use client";

import type { ProjectStyle, StylePreset } from "../../types";
import { PROJECT_MEMORY_CAP, STYLE_PRESETS } from "../../constants";

export function ProjectStyleSection({
  open,
  onToggle,
  style,
  onChangeText,
  onChangePreset,
  onClearRef,
  onUploadRef,
  hasConfig,
  memory,
  onChangeMemory,
  syncEnabled,
  onChangeSyncEnabled,
  syncStatus,
}: {
  open: boolean;
  onToggle: () => void;
  style: ProjectStyle;
  onChangeText: (text: string) => void;
  onChangePreset: (preset: StylePreset) => void;
  onClearRef: () => void;
  onUploadRef: (e: React.ChangeEvent<HTMLInputElement>) => void;
  hasConfig: boolean;
  /** The effective project memory blob (pulled from getEffectiveProjectMemory).
   *  May be empty string. */
  memory: string;
  onChangeMemory: (text: string) => void;
  syncEnabled: boolean;
  onChangeSyncEnabled: (enabled: boolean) => void;
  /** Live status of the active scene's Supabase Realtime channel. Drives
   *  the "● live" dot in the scene header — surfaced here so users can
   *  see why the toggle isn't doing what they expect (e.g. env vars not
   *  configured at build time). */
  syncStatus: "off" | "joining" | "live" | "error";
}) {
  const presetLabel = STYLE_PRESETS.find((p) => p.value === style.preset)?.label || "Cozy";
  return (
    <div className="border-2 border-farm-wood/60 bg-farm-ink/30">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-1 text-sm hover:bg-farm-wood/20"
      >
        <span>
          🎨 Project style — <span className="opacity-70">{presetLabel}</span>
          {hasConfig && <span className="text-farm-grass text-xs ml-1">active</span>}
        </span>
        <span className="opacity-60">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="p-3 space-y-2 text-sm border-t border-farm-wood/40">
          {/* Preset */}
          <div>
            <div className="text-xs opacity-70 mb-1">Preset:</div>
            <div className="flex flex-wrap gap-1">
              {STYLE_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => onChangePreset(p.value)}
                  title={p.hint}
                  className={`px-2 py-0.5 border text-xs ${
                    style.preset === p.value
                      ? "border-farm-grass text-farm-grass bg-farm-grass/10"
                      : "border-farm-wood/60"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <p className="opacity-70 text-xs">
            Style descriptor and reference are appended to every prompt.
          </p>
          <textarea
            value={style.text}
            onChange={(e) => onChangeText(e.target.value)}
            placeholder="e.g. muted earth tones, hand-drawn texture, soft outline"
            rows={2}
            className="w-full bg-farm-ink/60 border-2 border-farm-wood p-2 focus:outline-none focus:border-farm-grass resize-none"
          />
          <div className="flex items-center gap-2">
            {style.refUrl ? (
              <>
                <img src={style.refUrl} alt="style" className="pixelated w-12 h-12 object-contain bg-farm-ink" />
                <span className="opacity-70 text-xs flex-1">Style reference set</span>
                <button
                  type="button"
                  onClick={onClearRef}
                  className="text-xs px-2 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300"
                >
                  Clear
                </button>
              </>
            ) : (
              <label className="px-2 py-0.5 border border-farm-grass/70 text-farm-grass cursor-pointer hover:bg-farm-grass/10 text-xs">
                Upload reference image
                <input type="file" accept="image/*" className="hidden" onChange={onUploadRef} />
              </label>
            )}
          </div>

          {/* Real-time scene sync (Supabase Realtime). Off by default —
              when on, the active scene opens a broadcast channel so
              edits sync between tabs / collaborators. */}
          <div className="pt-2 border-t border-farm-wood/40">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={syncEnabled}
                onChange={(e) => onChangeSyncEnabled(e.target.checked)}
                className="accent-farm-grass"
              />
              <span>🌐 Real-time scene sync</span>
              {syncEnabled && syncStatus === "live" && (
                <span className="text-farm-grass">● live</span>
              )}
              {syncEnabled && syncStatus === "joining" && (
                <span className="opacity-60">connecting…</span>
              )}
              {syncEnabled && syncStatus === "error" && (
                <span className="text-red-400" title="Supabase env vars missing or channel error">
                  ✗ unavailable
                </span>
              )}
            </label>
            <p className="text-[10px] opacity-50 mt-1 leading-snug">
              Broadcasts each scene edit to other tabs or collaborators
              joined to the same scene. Requires Supabase env vars.
            </p>
          </div>

          {/* Project MEMORY blob — Hermes-style frozen-into-prompt knowledge. */}
          <div className="pt-2 border-t border-farm-wood/40 space-y-1">
            <div className="text-xs opacity-70">🧠 Project memory:</div>
            <textarea
              value={memory}
              onChange={(e) => onChangeMemory(e.target.value)}
              placeholder="Things learned about this project — naming conventions, palette, recurring characters… Edit me or let Pixel Play update it after good generations."
              rows={3}
              maxLength={PROJECT_MEMORY_CAP}
              className="w-full bg-farm-ink/60 border-2 border-farm-wood p-2 text-xs focus:outline-none focus:border-farm-grass resize-none"
            />
            <div
              className={`text-[10px] tabular-nums text-right ${
                memory.length > PROJECT_MEMORY_CAP * 0.9
                  ? "text-yellow-300"
                  : "opacity-50"
              }`}
            >
              {memory.length} / {PROJECT_MEMORY_CAP}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
