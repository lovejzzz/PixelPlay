"use client";

import { useEffect, useRef, useState } from "react";
import { sliceSheet } from "../lib/sprites";

export type CanvasAsset = {
  id: string;
  rawUrl: string;
  pixelUrl: string;
  cols: number;
  rows: number;
  /** "WxH" of the source. */
  sourceSize: string;
};

export type CanvasItem = {
  id: string;
  assetId: string;
  x: number; // center
  y: number;
  scale: number; // fraction of longest scene edge
  z: number;
  animating?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  /** Degrees clockwise. */
  rotation?: number;
  /** Player can pick this up by walking onto it (Play Mode). */
  pickable?: boolean;
  /** Door / portal: walking onto this in Play Mode switches the active scene. */
  linkSceneId?: string;
  /** NPC patrol — character walks between waypoints in Play Mode. */
  patrol?: { points: Array<{ x: number; y: number }>; loop: boolean; speed: number };
  /** Special asset-less item kinds. */
  kind?: "trigger" | "light" | "emitter" | "sound";
  /** Message fired into the play-mode log when the player enters a trigger zone. */
  triggerMessage?: string;
  /** Point-light parameters (when kind === "light"). */
  light?: { radius: number; color: string; intensity: number };
  emitter?: { kind: "sparkle" | "smoke"; rate: number; lifetime: number };
  sound?: { url: string; volume: number; loop: boolean };
  /** Prefab linkage. */
  prefabId?: string;
  prefabSourceId?: string;
  /** Render anchor. "bottom" → render with translate(-50%, -100%) so the
   *  item's feet sit at (x, y); "center" → translate(-50%, -50%) (legacy). */
  anchor?: "bottom" | "center";
};

export type CanvasTileLayer = {
  id: string;
  name: string;
  tileAssetId: string;
  cells: Array<{ x: number; y: number }>;
  visible: boolean;
};
export type CanvasTileGrid = {
  tileSize: number;
  layers: CanvasTileLayer[];
};
export type CanvasScene = {
  width: number;
  height: number;
  backgroundTileId?: string;
  items: CanvasItem[];
  tileGrid?: CanvasTileGrid;
  daytime?: number;
};

export function SceneCanvas({
  scene,
  assets,
  selectedItemIds,
  onSelectionChange,
  onMoveItem,
  onMoveItems,
  onScaleItem,
  onRotateItem,
  paintMode = "off",
  activeTileLayerId,
  onPaintCell,
  onEraseCell,
  onFillRect,
  onDropPrefab,
  onDropAsset,
  snap = 0,
  zoom = 1,
}: {
  scene: CanvasScene;
  assets: Record<string, CanvasAsset>;
  selectedItemIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onMoveItem: (id: string, x: number, y: number) => void;
  /** Called for group moves; preferred over onMoveItem when present. */
  onMoveItems?: (updates: Array<{ id: string; x: number; y: number }>) => void;
  onScaleItem?: (id: string, scale: number) => void;
  onRotateItem?: (id: string, rotationDeg: number) => void;
  /** Tile painting mode: "off" disables; "paint" stamps active layer's tile; "erase" removes. */
  paintMode?: "off" | "paint" | "erase" | "fillrect";
  /** Active tile-grid layer the paint/erase gesture writes into. */
  activeTileLayerId?: string | null;
  onPaintCell?: (layerId: string, x: number, y: number) => void;
  onEraseCell?: (layerId: string, x: number, y: number) => void;
  /** Drag-from-corner gesture: paints a filled rectangle of cells on pointerup. */
  onFillRect?: (layerId: string, x0: number, y0: number, x1: number, y1: number) => void;
  /** Called when a prefab is dropped from the prefab library. */
  onDropPrefab?: (prefabId: string, x: number, y: number) => void;
  /** Called when an asset is dragged from the gallery into the scene. */
  onDropAsset?: (assetId: string, x: number, y: number) => void;
  /** Snap-to-grid pixel size (0 = off). */
  snap?: number;
  /** Display zoom factor (1 = fit-to-container, 2 = 2× pixel-perfect, etc.). */
  zoom?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<
    | {
        kind: "move";
        itemId: string;
        pointerId: number;
        offsetX: number;
        offsetY: number;
        /** Other selected items to move alongside the primary one (group move). */
        groupStart?: Array<{ id: string; x: number; y: number }>;
        /** Anchor (the primary item's start position) for delta calculation. */
        anchorX?: number;
        anchorY?: number;
      }
    | { kind: "resize"; itemId: string; pointerId: number; corner: Corner; startScale: number; startDist: number }
    | { kind: "rotate"; itemId: string; pointerId: number; startAngle: number; startRotation: number }
    | { kind: "pan"; pointerId: number; startClientX: number; startClientY: number; startScrollLeft: number; startScrollTop: number; scroller: HTMLElement }
    | { kind: "rubber"; pointerId: number; startX: number; startY: number; curX: number; curY: number }
    | { kind: "paint"; pointerId: number; mode: "paint" | "erase"; layerId: string }
    | { kind: "fillrect"; pointerId: number; layerId: string; startX: number; startY: number; curX: number; curY: number }
    | null
  >(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const [snapGuide, setSnapGuide] = useState<{ x?: number; y?: number } | null>(null);

  function findScroller(): HTMLElement | null {
    let el: HTMLElement | null = containerRef.current;
    while (el) {
      const overflow = window.getComputedStyle(el).overflow;
      if (overflow === "auto" || overflow === "scroll") return el;
      el = el.parentElement;
    }
    return null;
  }

  // Convert pointer event to scene coordinates (accounting for the rendered
  // CSS scale).
  function pointToScene(clientX: number, clientY: number): { x: number; y: number } {
    const c = containerRef.current!;
    const rect = c.getBoundingClientRect();
    const scaleX = scene.width / rect.width;
    const scaleY = scene.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function snapTo(v: number): number {
    if (!snap || snap <= 1) return v;
    return Math.round(v / snap) * snap;
  }

  function onItemPointerDown(e: React.PointerEvent, item: CanvasItem) {
    if (e.button !== 0) return; // primary button only
    e.stopPropagation();

    // Shift-click toggles membership; plain click replaces selection unless
    // the item is already part of a multi-selection (don't break the group).
    const already = selectedItemIds.includes(item.id);
    if (e.shiftKey) {
      onSelectionChange(
        already ? selectedItemIds.filter((id) => id !== item.id) : [...selectedItemIds, item.id]
      );
    } else if (!already) {
      onSelectionChange([item.id]);
    }

    const { x, y } = pointToScene(e.clientX, e.clientY);
    // If the primary item is part of a multi-selection, capture starting
    // positions of every other selected item so the group moves together.
    const finalSelection = e.shiftKey
      ? already
        ? selectedItemIds.filter((id) => id !== item.id)
        : [...selectedItemIds, item.id]
      : already
      ? selectedItemIds
      : [item.id];
    const groupStart =
      finalSelection.length > 1 && onMoveItems
        ? scene.items
            .filter((it) => finalSelection.includes(it.id) && it.id !== item.id)
            .map((it) => ({ id: it.id, x: it.x, y: it.y }))
        : undefined;
    setDrag({
      kind: "move",
      itemId: item.id,
      pointerId: e.pointerId,
      offsetX: x - item.x,
      offsetY: y - item.y,
      groupStart,
      anchorX: item.x,
      anchorY: item.y,
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function pointToCell(clientX: number, clientY: number): { x: number; y: number } {
    const { x, y } = pointToScene(clientX, clientY);
    const ts = scene.tileGrid?.tileSize || 32;
    return { x: Math.floor(x / ts), y: Math.floor(y / ts) };
  }

  function onCanvasPointerDown(e: React.PointerEvent) {
    if (e.target !== e.currentTarget) return; // bubbled from a child
    // Paint mode: stamp the active layer's tile (or erase) under the cursor.
    if (paintMode !== "off" && activeTileLayerId && (onPaintCell || onEraseCell || onFillRect)) {
      if (e.button !== 0) return;
      e.preventDefault();
      const { x, y } = pointToCell(e.clientX, e.clientY);
      if (paintMode === "fillrect") {
        // Just track the start corner; preview rectangle renders during move,
        // commit happens on pointerup.
        setDrag({
          kind: "fillrect",
          pointerId: e.pointerId,
          layerId: activeTileLayerId,
          startX: x,
          startY: y,
          curX: x,
          curY: y,
        });
      } else {
        if (paintMode === "paint" && onPaintCell) onPaintCell(activeTileLayerId, x, y);
        else if (paintMode === "erase" && onEraseCell) onEraseCell(activeTileLayerId, x, y);
        setDrag({
          kind: "paint",
          pointerId: e.pointerId,
          mode: paintMode === "paint" ? "paint" : "erase",
          layerId: activeTileLayerId,
        });
      }
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    // Middle button → pan the scroll container.
    if (e.button === 1) {
      const scroller = findScroller();
      if (!scroller) return;
      e.preventDefault();
      setDrag({
        kind: "pan",
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startScrollLeft: scroller.scrollLeft,
        startScrollTop: scroller.scrollTop,
        scroller,
      });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    // Primary button on empty canvas → start a rubber-band rectangle.
    const { x, y } = pointToScene(e.clientX, e.clientY);
    setDrag({
      kind: "rubber",
      pointerId: e.pointerId,
      startX: x,
      startY: y,
      curX: x,
      curY: y,
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onRotatePointerDown(e: React.PointerEvent, item: CanvasItem) {
    e.stopPropagation();
    if (!selectedItemIds.includes(item.id)) onSelectionChange([item.id]);
    const { x, y } = pointToScene(e.clientX, e.clientY);
    const startAngle = Math.atan2(y - item.y, x - item.x);
    setDrag({
      kind: "rotate",
      itemId: item.id,
      pointerId: e.pointerId,
      startAngle,
      startRotation: item.rotation || 0,
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onHandlePointerDown(
    e: React.PointerEvent,
    item: CanvasItem,
    corner: Corner
  ) {
    e.stopPropagation();
    if (!selectedItemIds.includes(item.id)) onSelectionChange([item.id]);
    const { x, y } = pointToScene(e.clientX, e.clientY);
    const dist = Math.hypot(x - item.x, y - item.y);
    setDrag({
      kind: "resize",
      itemId: item.id,
      pointerId: e.pointerId,
      corner,
      startScale: item.scale,
      startDist: dist || 1,
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const sc = pointToScene(e.clientX, e.clientY);
    setCoords({ x: Math.round(sc.x), y: Math.round(sc.y) });
    if (!drag || drag.pointerId !== e.pointerId) return;

    if (drag.kind === "move") {
      let newX = snapTo(Math.max(0, Math.min(scene.width, sc.x - drag.offsetX)));
      let newY = snapTo(Math.max(0, Math.min(scene.height, sc.y - drag.offsetY)));
      // Snap to nearby other items' centers (within 6 scene px on each axis).
      const SNAP_DIST = 6;
      let guideX: number | undefined;
      let guideY: number | undefined;
      let bestX = SNAP_DIST + 1;
      let bestY = SNAP_DIST + 1;
      for (const other of scene.items) {
        if (other.id === drag.itemId) continue;
        const dx = Math.abs(newX - other.x);
        if (dx < bestX) {
          bestX = dx;
          guideX = other.x;
        }
        const dy = Math.abs(newY - other.y);
        if (dy < bestY) {
          bestY = dy;
          guideY = other.y;
        }
      }
      if (guideX !== undefined) newX = guideX;
      if (guideY !== undefined) newY = guideY;
      setSnapGuide(guideX !== undefined || guideY !== undefined ? { x: guideX, y: guideY } : null);
      if (drag.groupStart && drag.anchorX !== undefined && drag.anchorY !== undefined && onMoveItems) {
        const dx = newX - drag.anchorX;
        const dy = newY - drag.anchorY;
        const updates = [
          { id: drag.itemId, x: newX, y: newY },
          ...drag.groupStart.map((g) => ({
            id: g.id,
            x: Math.max(0, Math.min(scene.width, g.x + dx)),
            y: Math.max(0, Math.min(scene.height, g.y + dy)),
          })),
        ];
        onMoveItems(updates);
      } else {
        onMoveItem(drag.itemId, newX, newY);
      }
    } else if (drag.kind === "resize" && onScaleItem) {
      const item = scene.items.find((it) => it.id === drag.itemId);
      if (!item) return;
      const dist = Math.hypot(sc.x - item.x, sc.y - item.y);
      const factor = dist / drag.startDist;
      const nextScale = Math.max(0.03, Math.min(0.8, drag.startScale * factor));
      onScaleItem(drag.itemId, nextScale);
    } else if (drag.kind === "rotate" && onRotateItem) {
      const item = scene.items.find((it) => it.id === drag.itemId);
      if (!item) return;
      const angle = Math.atan2(sc.y - item.y, sc.x - item.x);
      const deltaDeg = ((angle - drag.startAngle) * 180) / Math.PI;
      let next = drag.startRotation + deltaDeg;
      // Wrap into [-180, 180].
      next = ((next + 180) % 360) - 180;
      // Snap to 15° when shift held — scene canvas state doesn't see modifier
      // here; keep continuous rotation. User can refine via numeric input later.
      onRotateItem(drag.itemId, next);
    } else if (drag.kind === "pan") {
      drag.scroller.scrollLeft = drag.startScrollLeft - (e.clientX - drag.startClientX);
      drag.scroller.scrollTop = drag.startScrollTop - (e.clientY - drag.startClientY);
    } else if (drag.kind === "paint") {
      const { x, y } = pointToCell(e.clientX, e.clientY);
      if (drag.mode === "paint" && onPaintCell) onPaintCell(drag.layerId, x, y);
      else if (drag.mode === "erase" && onEraseCell) onEraseCell(drag.layerId, x, y);
    } else if (drag.kind === "fillrect") {
      const { x, y } = pointToCell(e.clientX, e.clientY);
      setDrag({ ...drag, curX: x, curY: y });
    } else if (drag.kind === "rubber") {
      setDrag({ ...drag, curX: sc.x, curY: sc.y });
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!drag) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setSnapGuide(null);
    if (drag.kind === "rubber") {
      const x0 = Math.min(drag.startX, drag.curX);
      const x1 = Math.max(drag.startX, drag.curX);
      const y0 = Math.min(drag.startY, drag.curY);
      const y1 = Math.max(drag.startY, drag.curY);
      // Treat a tiny "drag" as a click that clears selection.
      if (x1 - x0 < 4 && y1 - y0 < 4) {
        onSelectionChange([]);
      } else {
        const hits = scene.items
          .filter((it) => it.x >= x0 && it.x <= x1 && it.y >= y0 && it.y <= y1)
          .map((it) => it.id);
        onSelectionChange(hits);
      }
    } else if (drag.kind === "fillrect" && onFillRect) {
      onFillRect(drag.layerId, drag.startX, drag.startY, drag.curX, drag.curY);
    }
    setDrag(null);
  }

  const sortedItems = [...scene.items].sort((a, b) => a.z - b.z);
  const longest = Math.max(scene.width, scene.height);

  const bg = scene.backgroundTileId ? assets[scene.backgroundTileId] : null;

  // Grid overlay style: shown when snap is active.
  const gridStyle: React.CSSProperties =
    snap && snap > 1
      ? {
          backgroundImage: `
            linear-gradient(to right, rgba(124, 184, 107, 0.15) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(124, 184, 107, 0.15) 1px, transparent 1px)
          `,
          backgroundSize: `${(snap / scene.width) * 100}% ${(snap / scene.height) * 100}%`,
        }
      : {};

  return (
    <div
      className="relative mx-auto"
      style={{ width: `${zoom * 100}%`, maxWidth: scene.width * zoom }}
    >
      <div
        ref={containerRef}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setCoords(null)}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={(e) => {
          if (
            (onDropAsset && e.dataTransfer.types.includes("application/x-pwf-asset-id")) ||
            (onDropPrefab && e.dataTransfer.types.includes("application/x-pwf-prefab-id"))
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          const prefabId = e.dataTransfer.getData("application/x-pwf-prefab-id");
          if (prefabId && onDropPrefab) {
            e.preventDefault();
            const { x, y } = pointToScene(e.clientX, e.clientY);
            onDropPrefab(prefabId, snapTo(x), snapTo(y));
            return;
          }
          if (!onDropAsset) return;
          const id = e.dataTransfer.getData("application/x-pwf-asset-id");
          if (!id) return;
          e.preventDefault();
          const { x, y } = pointToScene(e.clientX, e.clientY);
          onDropAsset(id, snapTo(x), snapTo(y));
        }}
        className="relative bg-checker border-2 border-farm-wood select-none"
        style={{
          width: "100%",
          aspectRatio: `${scene.width} / ${scene.height}`,
          touchAction: "none",
          ...(bg
            ? {
                backgroundImage: `url(${bg.pixelUrl})`,
                backgroundRepeat: "repeat",
                backgroundSize: "12.5%",
                imageRendering: "pixelated",
              }
            : {}),
          ...gridStyle,
        }}
      >
        {/* Tile-grid layers — render below items. */}
        {scene.tileGrid &&
          scene.tileGrid.layers.map((layer) => {
            if (!layer.visible) return null;
            const tileAsset = layer.tileAssetId ? assets[layer.tileAssetId] : null;
            if (!tileAsset) return null;
            const ts = scene.tileGrid!.tileSize;
            const widthPct = (ts / scene.width) * 100;
            const heightPct = (ts / scene.height) * 100;
            return (
              <div
                key={layer.id}
                className="absolute inset-0 pointer-events-none"
                style={{ zIndex: -1 }}
              >
                {layer.cells.map((c, i) => (
                  <img
                    key={`${c.x},${c.y},${i}`}
                    src={tileAsset.pixelUrl}
                    alt=""
                    draggable={false}
                    className="absolute pixelated"
                    style={{
                      left: `${(c.x * ts / scene.width) * 100}%`,
                      top: `${(c.y * ts / scene.height) * 100}%`,
                      width: `${widthPct}%`,
                      height: `${heightPct}%`,
                    }}
                  />
                ))}
              </div>
            );
          })}
        {/* Grid overlay during paint mode so user sees cell boundaries. */}
        {paintMode !== "off" && scene.tileGrid && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `linear-gradient(to right, rgba(167, 216, 232, 0.3) 1px, transparent 1px), linear-gradient(to bottom, rgba(167, 216, 232, 0.3) 1px, transparent 1px)`,
              backgroundSize: `${(scene.tileGrid.tileSize / scene.width) * 100}% ${
                (scene.tileGrid.tileSize / scene.height) * 100
              }%`,
              zIndex: 0,
            }}
          />
        )}
        {sortedItems.map((item) => {
          const isSelectedItem = selectedItemIds.includes(item.id);
          if (item.kind === "emitter" || item.kind === "sound") {
            const sizePx = item.scale * longest;
            const leftPct = (item.x / scene.width) * 100;
            const topPct = (item.y / scene.height) * 100;
            const widthPct = (sizePx / scene.width) * 100;
            const isEmitter = item.kind === "emitter";
            return (
              <div
                key={item.id}
                onPointerDown={(e) => onItemPointerDown(e, item)}
                className={`absolute cursor-grab active:cursor-grabbing flex items-center justify-center bg-farm-grass/10 border-2 border-dashed ${
                  isSelectedItem ? "border-farm-grass" : "border-farm-grass/40 hover:border-farm-grass"
                }`}
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  aspectRatio: "1 / 1",
                  transform: "translate(-50%, -50%)",
                  zIndex: item.z,
                }}
                title={isEmitter ? "Particle emitter" : "Sound trigger"}
              >
                <span className="text-xl pointer-events-none">{isEmitter ? "✨" : "🔊"}</span>
              </div>
            );
          }
          if (item.kind === "light") {
            const sizePx = item.scale * longest;
            const leftPct = (item.x / scene.width) * 100;
            const topPct = (item.y / scene.height) * 100;
            const widthPct = (sizePx / scene.width) * 100;
            const color = item.light?.color || "#ffd47a";
            return (
              <div
                key={item.id}
                onPointerDown={(e) => onItemPointerDown(e, item)}
                className={`absolute cursor-grab active:cursor-grabbing flex items-center justify-center bg-white/0 border-2 ${
                  isSelectedItem ? "border-farm-grass" : "border-farm-grass/40 hover:border-farm-grass"
                }`}
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  aspectRatio: "1 / 1",
                  borderRadius: "50%",
                  transform: "translate(-50%, -50%)",
                  zIndex: item.z,
                  boxShadow: `0 0 12px 2px ${color}`,
                }}
                title={`Point light: ${color}`}
              >
                <span className="text-xl pointer-events-none">💡</span>
              </div>
            );
          }
          if (item.kind === "trigger") {
            const sizePx = item.scale * longest;
            const leftPct = (item.x / scene.width) * 100;
            const topPct = (item.y / scene.height) * 100;
            const widthPct = (sizePx / scene.width) * 100;
            return (
              <div
                key={item.id}
                onPointerDown={(e) => onItemPointerDown(e, item)}
                className={`absolute cursor-grab active:cursor-grabbing flex items-center justify-center bg-farm-sky/10 border-2 ${
                  isSelectedItem
                    ? "border-farm-sky"
                    : "border-farm-sky/40 hover:border-farm-sky"
                }`}
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  aspectRatio: "1 / 1",
                  transform: "translate(-50%, -50%)",
                  zIndex: item.z,
                }}
                title={item.triggerMessage || "trigger zone"}
              >
                <span className="text-2xl pointer-events-none">⚡</span>
                {item.triggerMessage && (
                  <span className="absolute bottom-0 left-0 right-0 text-[10px] text-farm-sky bg-farm-ink/80 px-1 truncate pointer-events-none">
                    {item.triggerMessage}
                  </span>
                )}
              </div>
            );
          }
          const asset = assets[item.assetId];
          if (!asset) return null;
          const sizePx = item.scale * longest;
          const leftPct = (item.x / scene.width) * 100;
          const topPct = (item.y / scene.height) * 100;
          const widthPct = (sizePx / scene.width) * 100;
          const isSelected = isSelectedItem;
          return (
            <SceneItemView
              key={item.id}
              item={item}
              asset={asset}
              isSelected={isSelected}
              isHovered={item.id === hoverId && !isSelected}
              leftPct={leftPct}
              topPct={topPct}
              widthPct={widthPct}
              onPointerDown={(e) => onItemPointerDown(e, item)}
              onHandleDown={(e, corner) => onHandlePointerDown(e, item, corner)}
              onRotateDown={(e) => onRotatePointerDown(e, item)}
              onHover={(h) => setHoverId(h ? item.id : null)}
              showHandles={isSelected && !!onScaleItem}
            />
          );
        })}

        {/* Patrol waypoints — show for selected items that have a patrol. */}
        {selectedItemIds.length === 1 &&
          (() => {
            const sel = scene.items.find((it) => it.id === selectedItemIds[0]);
            if (!sel?.patrol || sel.patrol.points.length === 0) return null;
            const pts = [{ x: sel.x, y: sel.y }, ...sel.patrol.points];
            const segs: Array<[typeof pts[0], typeof pts[0]]> = [];
            for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
            if (sel.patrol.loop && pts.length > 1) {
              segs.push([pts[pts.length - 1], pts[0]]);
            }
            return (
              <svg
                className="absolute inset-0 pointer-events-none"
                viewBox={`0 0 ${scene.width} ${scene.height}`}
                preserveAspectRatio="none"
                style={{ width: "100%", height: "100%" }}
              >
                {segs.map(([p, q], i) => (
                  <line
                    key={i}
                    x1={p.x}
                    y1={p.y}
                    x2={q.x}
                    y2={q.y}
                    stroke="rgba(167, 216, 232, 0.7)"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                  />
                ))}
                {sel.patrol.points.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r={6} fill="#a7d8e8" stroke="#2b1810" strokeWidth={2} />
                    <text
                      x={p.x}
                      y={p.y + 4}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#2b1810"
                      fontWeight="bold"
                    >
                      {i + 1}
                    </text>
                  </g>
                ))}
              </svg>
            );
          })()}
        {snapGuide && snapGuide.x !== undefined && (
          <div
            className="absolute pointer-events-none bg-farm-grass/60"
            style={{
              left: `${(snapGuide.x / scene.width) * 100}%`,
              top: 0,
              width: 1,
              height: "100%",
            }}
          />
        )}
        {snapGuide && snapGuide.y !== undefined && (
          <div
            className="absolute pointer-events-none bg-farm-grass/60"
            style={{
              top: `${(snapGuide.y / scene.height) * 100}%`,
              left: 0,
              height: 1,
              width: "100%",
            }}
          />
        )}

        {/* Fill-rect preview — yellow tinted rectangle covering full cells. */}
        {drag?.kind === "fillrect" && scene.tileGrid && (() => {
          const ts = scene.tileGrid.tileSize;
          const xa = Math.min(drag.startX, drag.curX);
          const xb = Math.max(drag.startX, drag.curX);
          const ya = Math.min(drag.startY, drag.curY);
          const yb = Math.max(drag.startY, drag.curY);
          const px = xa * ts;
          const py = ya * ts;
          const pw = (xb - xa + 1) * ts;
          const ph = (yb - ya + 1) * ts;
          const leftPct = (px / scene.width) * 100;
          const topPct = (py / scene.height) * 100;
          const widthPct = (pw / scene.width) * 100;
          const heightPct = (ph / scene.height) * 100;
          return (
            <div
              className="absolute pointer-events-none border-2 border-yellow-400/80 bg-yellow-300/20"
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${widthPct}%`,
                height: `${heightPct}%`,
              }}
            />
          );
        })()}

        {/* Coords readout — bottom-right corner of canvas */}
        {drag?.kind === "rubber" && (() => {
          const x0 = Math.min(drag.startX, drag.curX);
          const x1 = Math.max(drag.startX, drag.curX);
          const y0 = Math.min(drag.startY, drag.curY);
          const y1 = Math.max(drag.startY, drag.curY);
          const leftPct = (x0 / scene.width) * 100;
          const topPct = (y0 / scene.height) * 100;
          const widthPct = ((x1 - x0) / scene.width) * 100;
          const heightPct = ((y1 - y0) / scene.height) * 100;
          return (
            <div
              className="absolute pointer-events-none border border-farm-grass bg-farm-grass/10"
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${widthPct}%`,
                height: `${heightPct}%`,
              }}
            />
          );
        })()}
        {coords && (
          <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-farm-ink/80 border border-farm-wood/60 text-[10px] font-mono opacity-80 pointer-events-none">
            {coords.x}, {coords.y}
          </div>
        )}
      </div>
    </div>
  );
}

type Corner = "tl" | "tr" | "bl" | "br";

function SceneItemView({
  item,
  asset,
  isSelected,
  isHovered,
  leftPct,
  topPct,
  widthPct,
  onPointerDown,
  onHandleDown,
  onRotateDown,
  onHover,
  showHandles,
}: {
  item: CanvasItem;
  asset: CanvasAsset;
  isSelected: boolean;
  isHovered: boolean;
  leftPct: number;
  topPct: number;
  widthPct: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onHandleDown: (e: React.PointerEvent, corner: Corner) => void;
  onRotateDown: (e: React.PointerEvent) => void;
  onHover: (hovered: boolean) => void;
  showHandles: boolean;
}) {
  const isMultiFrame = (asset.cols || 1) * (asset.rows || 1) > 1;
  const [frames, setFrames] = useState<string[] | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const playing = !!item.animating && isMultiFrame;

  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    (async () => {
      if (!frames) {
        try {
          const sliced = await sliceSheet(asset.rawUrl, asset.cols, asset.rows);
          if (cancelled) return;
          setFrames(sliced);
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playing, frames, asset]);

  useEffect(() => {
    if (!playing || !frames) return;
    const id = setInterval(() => setFrameIdx((i) => (i + 1) % frames.length), 1000 / 8);
    return () => clearInterval(id);
  }, [playing, frames]);

  const src = playing && frames ? frames[frameIdx] : asset.pixelUrl;
  const ringClass = isSelected
    ? "ring-2 ring-farm-grass"
    : isHovered
    ? "ring-1 ring-farm-grass/40"
    : "";

  const rot = item.rotation || 0;
  const anchor = item.anchor || "center";
  const baseTranslate =
    anchor === "bottom" ? "translate(-50%, -100%)" : "translate(-50%, -50%)";
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      className={`absolute cursor-grab active:cursor-grabbing ${ringClass}`}
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        width: `${widthPct}%`,
        zIndex: item.z,
        transform: rot ? `${baseTranslate} rotate(${rot}deg)` : baseTranslate,
        // For bottom-anchor, sort items by their FOOT y, not center y, so
        // characters in front of buildings render on top correctly. We do
        // this via z-index here in the render layer; the actual sort is
        // a property of how the parent walks the items. Add a small bias.
        transformOrigin: anchor === "bottom" ? "50% 100%" : "50% 50%",
      }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="pixelated w-full h-auto block"
        style={
          item.flipX || item.flipY
            ? { transform: `scale(${item.flipX ? -1 : 1}, ${item.flipY ? -1 : 1})` }
            : undefined
        }
      />

      {/* Rotation handle — above the bbox, line connecting to it */}
      {showHandles && (
        <div
          onPointerDown={onRotateDown}
          title="Rotate"
          style={{
            position: "absolute",
            top: -28,
            left: "50%",
            transform: "translateX(-50%)",
            width: 14,
            height: 14,
            background: "#a7d8e8",
            border: "2px solid #2b1810",
            borderRadius: "50%",
            cursor: "grab",
          }}
        />
      )}
      {showHandles && (
        <div
          style={{
            position: "absolute",
            top: -22,
            left: "50%",
            width: 1,
            height: 22,
            background: "rgba(167, 216, 232, 0.6)",
            transform: "translateX(-50%)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Corner resize handles */}
      {showHandles && (
        <>
          {(["tl", "tr", "bl", "br"] as const).map((corner) => (
            <ResizeHandle
              key={corner}
              corner={corner}
              onPointerDown={(e) => onHandleDown(e, corner)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function ResizeHandle({
  corner,
  onPointerDown,
}: {
  corner: Corner;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const pos: React.CSSProperties = {
    position: "absolute",
    width: 12,
    height: 12,
    background: "#7cb86b",
    border: "2px solid #2b1810",
    cursor:
      corner === "tl" || corner === "br" ? "nwse-resize" : "nesw-resize",
  };
  if (corner === "tl") Object.assign(pos, { top: -6, left: -6 });
  if (corner === "tr") Object.assign(pos, { top: -6, right: -6 });
  if (corner === "bl") Object.assign(pos, { bottom: -6, left: -6 });
  if (corner === "br") Object.assign(pos, { bottom: -6, right: -6 });
  return <div onPointerDown={onPointerDown} style={pos} />;
}
