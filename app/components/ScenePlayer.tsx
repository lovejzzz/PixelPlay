"use client";

import { useEffect, useRef, useState } from "react";
import { sliceSheet } from "../lib/sprites";
import type { CanvasAsset, CanvasItem, CanvasScene } from "./SceneCanvas";
import { AmbientLayer } from "./AmbientLayer";

/**
 * Play-mode runtime for a Scene. Renders a viewport that follows an active
 * character around the world. The player walks toward a clicked target or
 * via WASD/arrow keys at PLAYER_SPEED px/s, with the correct walk-cycle row
 * if the character is a full-sheet (4 dirs × 4 frames). Solid items block.
 */

export type PlayerSceneItem = CanvasItem & {
  solid?: boolean;
  pickable?: boolean;
  linkSceneId?: string;
  patrol?: { points: Array<{ x: number; y: number }>; loop: boolean; speed: number };
  triggerMessage?: string;
  useMessage?: string;
  kind?: "trigger" | "light" | "emitter" | "sound";
  light?: { radius: number; color: string; intensity: number };
  emitter?: { kind: "sparkle" | "smoke"; rate: number; lifetime: number };
  sound?: { url: string; volume: number; loop: boolean };
  /** Optional speech bubble shown in Play Mode when the player gets close. */
  dialogue?: string;
  /** "bottom" → translate(-50%, -100%); "center" → translate(-50%, -50%). */
  anchor?: "bottom" | "center";
};
export type PlayerScene = CanvasScene & { items: PlayerSceneItem[] };

const PLAYER_SPEED = 100; // pixels / second in scene coords
const ANIM_FPS = 8;
const FOLLOW_ZOOM = 2;
const PICKUP_RADIUS = 16; // scene px
const DIALOGUE_RADIUS = 32; // scene px — speech-bubble proximity
const USE_RADIUS = 24; // scene px — "Press E" interaction reach
const USE_DURATION = 1500; // ms — sprite swap + character freeze window
const TOAST_LIFETIME = 1500; // ms

export function ScenePlayer({
  scene,
  assets,
  activeCharacterId,
  onUpdateCharacterPos,
  onPortalEnter,
}: {
  scene: PlayerScene;
  assets: Record<string, CanvasAsset>;
  activeCharacterId: string | null;
  onUpdateCharacterPos: (id: string, x: number, y: number) => void;
  onPortalEnter?: (targetSceneId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<{ x: number; y: number } | null>(null);
  const dirRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [, forceTick] = useState(0);
  const lastTimeRef = useRef<number>(performance.now());
  const animFrameRef = useRef<number | null>(null);
  /** Lerped camera position (in scene-coords). Trails the player by a
   *  fraction each tick instead of snapping, so abrupt teleports / portals
   *  don't whip the camera. Clamped against scene bounds in render. */
  const cameraRef = useRef<{ x: number; y: number } | null>(null);

  const character = activeCharacterId ? scene.items.find((i) => i.id === activeCharacterId) : null;
  const charAsset = character ? assets[character.assetId] : null;

  // Position is held in a ref so the rAF loop doesn't tear with React state.
  const posRef = useRef<{ x: number; y: number }>(
    character ? { x: character.x, y: character.y } : { x: 0, y: 0 }
  );
  // If the character moved externally (e.g. user dragged in edit mode), sync.
  useEffect(() => {
    if (character) {
      posRef.current = { x: character.x, y: character.y };
      // Snap the camera to the new player so portals don't whip-pan.
      cameraRef.current = { x: character.x, y: character.y };
    }
  }, [activeCharacterId]);

  const facingRef = useRef<"south" | "north" | "west" | "east">("south");
  const movingRef = useRef(false);
  /** Timestamp (performance.now ms) of the last frame the player was moving.
   *  Used by the idle-bobble at render time to decide whether the player has
   *  been stationary long enough (>250 ms) to start the sine-wave bob. */
  const lastMovedAtRef = useRef(0);
  const frameIdxRef = useRef(0);
  /** "Using item" window — set when E fires, cleared after USE_DURATION ms.
   *  While set, the player is frozen at frame 0, can't move, and the target
   *  item renders its useStateAssetId (if any). */
  const usingRef = useRef<{ itemId: string; until: number } | null>(null);
  const frameAccumRef = useRef(0);
  // Picked-up items live for the play session only; reset when activeChar changes.
  const pickedIdsRef = useRef<Set<string>>(new Set());
  /** Door currently being stood on; null when not inside any. */
  const insidePortalRef = useRef<string | null>(null);
  /** Trigger currently being stood on; null when not inside any. */
  const insideTriggerRef = useRef<string | null>(null);
  /** Sound-trigger currently playing; null when not inside any. */
  const insideSoundRef = useRef<string | null>(null);
  /** Active <audio> elements per sound-trigger id. */
  const audiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [logEntries, setLogEntries] = useState<Array<{ id: string; text: string }>>([]);
  /** Per-NPC runtime state for patrol behavior. Keyed by item id. */
  const npcStateRef = useRef<
    Map<
      string,
      {
        x: number;
        y: number;
        idx: number;
        forward: boolean;
        facing: "south" | "north" | "west" | "east";
        moving: boolean;
        frameIdx: number;
        frameAccum: number;
      }
    >
  >(new Map());
  /** Cached sprite-sheet slices per NPC asset (keyed by asset.id). */
  const npcFramesRef = useRef<Map<string, string[][]>>(new Map());
  const npcFramesPendingRef = useRef<Set<string>>(new Set());
  function ensureNpcFrames(a: CanvasAsset) {
    if (npcFramesRef.current.has(a.id)) return;
    if (npcFramesPendingRef.current.has(a.id)) return;
    if ((a.cols || 1) * (a.rows || 1) <= 1) return;
    npcFramesPendingRef.current.add(a.id);
    sliceSheet(a.rawUrl, a.cols, a.rows)
      .then((flat) => {
        const grid: string[][] = [];
        for (let r = 0; r < a.rows; r++) grid.push(flat.slice(r * a.cols, (r + 1) * a.cols));
        npcFramesRef.current.set(a.id, grid);
      })
      .catch(() => {})
      .finally(() => npcFramesPendingRef.current.delete(a.id));
  }
  const [pickedTick, setPickedTick] = useState(0); // bumps to trigger re-render after pickup
  const [toasts, setToasts] = useState<Array<{ id: string; text: string; until: number }>>([]);
  useEffect(() => {
    pickedIdsRef.current = new Set();
    insidePortalRef.current = null;
    insideTriggerRef.current = null;
    insideSoundRef.current = null;
    // Stop any audio still playing from a prior session.
    for (const audio of audiosRef.current.values()) {
      try { audio.pause(); } catch {}
    }
    audiosRef.current = new Map();
    npcStateRef.current = new Map();
    setPickedTick(0);
    setToasts([]);
    setLogEntries([]);
  }, [activeCharacterId]);
  // Stop all audio when ScenePlayer unmounts.
  useEffect(() => {
    return () => {
      for (const audio of audiosRef.current.values()) {
        try { audio.pause(); } catch {}
      }
    };
  }, []);

  // Pre-slice the active character's sprite sheet once (or twice — full-sheet
  // is 4×4, walk-cycle is 1×4). For single pose, we just use the one image.
  const [frames, setFrames] = useState<string[][]>([]); // frames[row][col]
  useEffect(() => {
    if (!charAsset) {
      setFrames([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const cols = charAsset.cols || 1;
      const rows = charAsset.rows || 1;
      try {
        const flat = await sliceSheet(charAsset.rawUrl, cols, rows);
        if (cancelled) return;
        // Reshape into rows.
        const grid: string[][] = [];
        for (let r = 0; r < rows; r++) {
          grid.push(flat.slice(r * cols, (r + 1) * cols));
        }
        setFrames(grid);
      } catch {
        if (!cancelled) setFrames([[charAsset.pixelUrl]]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [charAsset?.id]);

  // Build collision rects in scene coordinates from solid items (excluding
  // the active character).
  function getColliders(): Array<{ x: number; y: number; w: number; h: number }> {
    const longest = Math.max(scene.width, scene.height);
    const out: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const it of scene.items) {
      if (!it.solid) continue;
      if (it.id === activeCharacterId) continue;
      const a = assets[it.assetId];
      if (!a) continue;
      const [iw, ih] = a.sourceSize.split("x").map(Number);
      const aspect = iw && ih ? iw / ih : 1;
      const w = it.scale * longest;
      const h = w / aspect;
      // Tighten the collision box: 60% of the visual bbox is closer to what
      // a player expects (sprites have transparent padding).
      const shrink = 0.6;
      out.push({
        x: it.x - (w * shrink) / 2,
        y: it.y - (h * shrink) / 2,
        w: w * shrink,
        h: h * shrink,
      });
    }
    return out;
  }

  // AABB collision check at proposed position. Player has its own bbox.
  function isBlocked(nx: number, ny: number): boolean {
    if (!character || !charAsset) return false;
    const longest = Math.max(scene.width, scene.height);
    const [iw, ih] = charAsset.sourceSize.split("x").map(Number);
    const aspect = iw && ih ? iw / ih / (charAsset.cols || 1) * (charAsset.rows || 1) : 1;
    const w = character.scale * longest * 0.4;
    const h = (character.scale * longest) / aspect * 0.5;
    const px = nx - w / 2;
    const py = ny - h / 2 + h * 0.4; // feet-aligned bbox
    const colliders = getColliders();
    for (const c of colliders) {
      if (px < c.x + c.w && px + w > c.x && py < c.y + c.h && py + h > c.y) return true;
    }
    return false;
  }

  // Main animation loop — runs while a character is active.
  useEffect(() => {
    if (!character || !charAsset) return;
    function step(now: number) {
      const dt = Math.min(50, now - lastTimeRef.current) / 1000; // clamp big gaps
      lastTimeRef.current = now;

      let dx = 0;
      let dy = 0;

      // Clear the using window if it expired so the player can move again.
      if (usingRef.current && now >= usingRef.current.until) {
        usingRef.current = null;
      }
      // Suppress all movement input while using an item — the character is
      // "doing the action" for the duration of the window.
      const isUsing = usingRef.current !== null;

      // Keyboard direction overrides click-to-walk while held.
      if (!isUsing && (dirRef.current.dx !== 0 || dirRef.current.dy !== 0)) {
        targetRef.current = null; // cancel click-target
        const len = Math.hypot(dirRef.current.dx, dirRef.current.dy) || 1;
        dx = (dirRef.current.dx / len) * PLAYER_SPEED * dt;
        dy = (dirRef.current.dy / len) * PLAYER_SPEED * dt;
      } else if (!isUsing && targetRef.current) {
        const tdx = targetRef.current.x - posRef.current.x;
        const tdy = targetRef.current.y - posRef.current.y;
        const dist = Math.hypot(tdx, tdy);
        if (dist < 2) {
          targetRef.current = null;
        } else {
          const speed = PLAYER_SPEED * dt;
          const stepDist = Math.min(speed, dist);
          dx = (tdx / dist) * stepDist;
          dy = (tdy / dist) * stepDist;
        }
      }

      // Determine facing from movement direction.
      if (dx !== 0 || dy !== 0) {
        movingRef.current = true;
        lastMovedAtRef.current = performance.now();
        // Pick the dominant axis. On a perfect diagonal (e.g. holding
        // Up+Right with equal magnitudes), the strict `>` flipped the
        // facing back and forth between adjacent ticks because tiny
        // floating-point drift made one side win. Sticky tiebreak:
        // keep the previous axis if both axes are tied — so a player
        // walking diagonally retains a stable walk-cycle direction
        // until the input clearly favours the other axis.
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        const prev = facingRef.current;
        const useX =
          ax > ay
            ? true
            : ay > ax
            ? false
            : prev === "east" || prev === "west";
        if (useX) {
          facingRef.current = dx > 0 ? "east" : "west";
        } else {
          facingRef.current = dy > 0 ? "south" : "north";
        }
      } else {
        movingRef.current = false;
      }

      // Try X then Y separately so we slide along walls.
      const cur = posRef.current;
      let nx = cur.x + dx;
      let ny = cur.y + dy;
      nx = Math.max(0, Math.min(scene.width, nx));
      ny = Math.max(0, Math.min(scene.height, ny));
      let next = { x: cur.x, y: cur.y };
      if (!isBlocked(nx, cur.y)) next.x = nx;
      if (!isBlocked(next.x, ny)) next.y = ny;
      posRef.current = next;

      // Pickup proximity check.
      let pickedThisFrame = false;
      for (const it of scene.items) {
        if (!it.pickable) continue;
        if (pickedIdsRef.current.has(it.id)) continue;
        if (it.id === activeCharacterId) continue;
        const dx = next.x - it.x;
        const dy = next.y - it.y;
        if (dx * dx + dy * dy <= PICKUP_RADIUS * PICKUP_RADIUS) {
          pickedIdsRef.current.add(it.id);
          pickedThisFrame = true;
          const toastId = crypto.randomUUID();
          const text = "picked up";
          setToasts((prev) => [...prev, { id: toastId, text, until: now + TOAST_LIFETIME }]);
        }
      }
      if (pickedThisFrame) setPickedTick((t) => t + 1);

      // Trigger zones — fire the message on entry, re-arm on exit.
      let stillInsideTrigger: string | null = null;
      for (const it of scene.items) {
        if (it.kind !== "trigger" || !it.triggerMessage) continue;
        const halfW = it.scale * Math.max(scene.width, scene.height) * 0.5;
        if (
          next.x >= it.x - halfW &&
          next.x <= it.x + halfW &&
          next.y >= it.y - halfW &&
          next.y <= it.y + halfW
        ) {
          stillInsideTrigger = it.id;
          if (insideTriggerRef.current !== it.id) {
            insideTriggerRef.current = it.id;
            const id = crypto.randomUUID();
            setLogEntries((prev) => [
              ...prev.slice(-9),
              { id, text: it.triggerMessage || "" },
            ]);
          }
          break;
        }
      }
      if (!stillInsideTrigger) insideTriggerRef.current = null;

      // Sound triggers — start audio on entry, pause on exit (if loop).
      let stillInsideSound: string | null = null;
      for (const it of scene.items) {
        if (it.kind !== "sound" || !it.sound) continue;
        const halfW = it.scale * Math.max(scene.width, scene.height) * 0.5;
        if (
          next.x >= it.x - halfW &&
          next.x <= it.x + halfW &&
          next.y >= it.y - halfW &&
          next.y <= it.y + halfW
        ) {
          stillInsideSound = it.id;
          if (insideSoundRef.current !== it.id) {
            insideSoundRef.current = it.id;
            // If a URL is provided, play; otherwise log a stub for testing.
            if (it.sound.url) {
              try {
                let audio = audiosRef.current.get(it.id);
                if (!audio) {
                  audio = new Audio(it.sound.url);
                  audio.volume = it.sound.volume;
                  audio.loop = it.sound.loop;
                  audiosRef.current.set(it.id, audio);
                }
                audio.currentTime = 0;
                void audio.play().catch(() => {});
              } catch {}
            }
            const id = crypto.randomUUID();
            setLogEntries((prev) => [
              ...prev.slice(-9),
              { id, text: `🔊 ${it.sound?.url || "(no audio)"}` },
            ]);
          }
          break;
        }
      }
      if (!stillInsideSound) {
        // Pause looping audio when player walks out.
        if (insideSoundRef.current) {
          const audio = audiosRef.current.get(insideSoundRef.current);
          if (audio && audio.loop) {
            try { audio.pause(); } catch {}
          }
        }
        insideSoundRef.current = null;
      }

      // Portal proximity — fires once on entry; re-arms when the player
      // walks out of every door's bbox.
      if (onPortalEnter) {
        let stillInside: string | null = null;
        for (const it of scene.items) {
          if (!it.linkSceneId) continue;
          if (it.id === activeCharacterId) continue;
          const dx = next.x - it.x;
          const dy = next.y - it.y;
          if (dx * dx + dy * dy <= PICKUP_RADIUS * PICKUP_RADIUS) {
            stillInside = it.id;
            if (insidePortalRef.current !== it.id) {
              insidePortalRef.current = it.id;
              onPortalEnter(it.linkSceneId);
            }
            break;
          }
        }
        if (!stillInside) insidePortalRef.current = null;
      }

      // Drop expired toasts.
      setToasts((prev) => {
        const stillAlive = prev.filter((t) => t.until > now);
        return stillAlive.length === prev.length ? prev : stillAlive;
      });

      // Advance walk-cycle frame counter while moving.
      if (movingRef.current) {
        frameAccumRef.current += dt;
        const period = 1 / ANIM_FPS;
        while (frameAccumRef.current > period) {
          frameAccumRef.current -= period;
          frameIdxRef.current = (frameIdxRef.current + 1) % 4;
        }
      } else {
        frameIdxRef.current = 0;
        frameAccumRef.current = 0;
      }

      // Step NPCs that have a patrol path.
      for (const it of scene.items) {
        if (!it.patrol || it.patrol.points.length === 0) continue;
        if (it.id === activeCharacterId) continue;
        const a = assets[it.assetId];
        if (!a) continue;
        ensureNpcFrames(a);
        let st = npcStateRef.current.get(it.id);
        if (!st) {
          st = {
            x: it.x,
            y: it.y,
            idx: 0,
            forward: true,
            facing: "south",
            moving: false,
            frameIdx: 0,
            frameAccum: 0,
          };
          npcStateRef.current.set(it.id, st);
        }
        const target = it.patrol.points[st.idx];
        if (!target) continue;
        const dxT = target.x - st.x;
        const dyT = target.y - st.y;
        const distT = Math.hypot(dxT, dyT);
        if (distT < 2) {
          // Reached waypoint — advance.
          if (it.patrol.loop) {
            st.idx = (st.idx + 1) % it.patrol.points.length;
          } else {
            // Ping-pong: when we hit either end, reverse direction.
            if (st.forward) {
              if (st.idx >= it.patrol.points.length - 1) st.forward = false;
              else st.idx++;
            } else {
              if (st.idx <= 0) st.forward = true;
              else st.idx--;
            }
          }
          st.moving = false;
        } else {
          const speed = it.patrol.speed * dt;
          const stepDist = Math.min(speed, distT);
          const nx = (dxT / distT) * stepDist;
          const ny = (dyT / distT) * stepDist;
          st.x += nx;
          st.y += ny;
          st.moving = true;
          if (Math.abs(nx) > Math.abs(ny)) st.facing = nx > 0 ? "east" : "west";
          else st.facing = ny > 0 ? "south" : "north";
        }
        if (st.moving) {
          st.frameAccum += dt;
          const period = 1 / ANIM_FPS;
          while (st.frameAccum > period) {
            st.frameAccum -= period;
            st.frameIdx = (st.frameIdx + 1) % 4;
          }
        } else {
          st.frameIdx = 0;
          st.frameAccum = 0;
        }
      }

      // Camera lerp — trail the player by 15% per tick. First tick snaps
      // to the player so we don't ease in from (0,0).
      if (!cameraRef.current) {
        cameraRef.current = { x: posRef.current.x, y: posRef.current.y };
      } else {
        const k = 0.15;
        cameraRef.current.x += (posRef.current.x - cameraRef.current.x) * k;
        cameraRef.current.y += (posRef.current.y - cameraRef.current.y) * k;
      }

      forceTick((t) => (t + 1) % 1024);
      animFrameRef.current = requestAnimationFrame(step);
    }
    lastTimeRef.current = performance.now();
    animFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    };
  }, [character?.id, charAsset?.id, scene.items.length]);

  // Persist the character's position back to scene state on unmount or
  // when the active character changes (so re-entering edit mode sees their
  // last walked-to position).
  useEffect(() => {
    return () => {
      if (character) {
        onUpdateCharacterPos(character.id, posRef.current.x, posRef.current.y);
      }
    };
  }, [character?.id]);

  // Keyboard handlers.
  useEffect(() => {
    function dirFor(key: string): { dx: number; dy: number } | null {
      switch (key) {
        case "ArrowLeft":
        case "a":
        case "A":
          return { dx: -1, dy: 0 };
        case "ArrowRight":
        case "d":
        case "D":
          return { dx: 1, dy: 0 };
        case "ArrowUp":
        case "w":
        case "W":
          return { dx: 0, dy: -1 };
        case "ArrowDown":
        case "s":
        case "S":
          return { dx: 0, dy: 1 };
      }
      return null;
    }
    function isEditableTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
    }
    const pressed = new Set<string>();
    function recompute() {
      let dx = 0;
      let dy = 0;
      if (pressed.has("left")) dx -= 1;
      if (pressed.has("right")) dx += 1;
      if (pressed.has("up")) dy -= 1;
      if (pressed.has("down")) dy += 1;
      dirRef.current = { dx, dy };
    }
    function tag(key: string): string | null {
      const d = dirFor(key);
      if (!d) return null;
      if (d.dx < 0) return "left";
      if (d.dx > 0) return "right";
      if (d.dy < 0) return "up";
      return "down";
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      const t = tag(e.key);
      if (!t) return;
      e.preventDefault();
      pressed.add(t);
      recompute();
    }
    function onKeyUp(e: KeyboardEvent) {
      const t = tag(e.key);
      if (!t) return;
      pressed.delete(t);
      recompute();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      pressed.clear();
      dirRef.current = { dx: 0, dy: 0 };
    };
  }, []);

  // E to use — fires the nearest usable item's useMessage into the play log.
  // Effect depends on scene.items so it always sees the latest set; the
  // handler reads posRef live so it picks the item nearest to the current
  // player position, not the one closest at mount time.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "e" && e.key !== "E") return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      // Find the nearest non-kind item with a non-empty useMessage within
      // USE_RADIUS scene-px of the player. Patrol NPCs use their live
      // runtime position; static items use their stored x/y.
      let best: PlayerSceneItem | null = null;
      let bestDist2 = USE_RADIUS * USE_RADIUS + 1;
      for (const it of scene.items) {
        if (it.kind) continue;
        if (!it.useMessage || !it.useMessage.trim()) continue;
        const ns = it.patrol ? npcStateRef.current.get(it.id) : undefined;
        const ix = ns?.x ?? it.x;
        const iy = ns?.y ?? it.y;
        const dx = ix - posRef.current.x;
        const dy = iy - posRef.current.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= USE_RADIUS * USE_RADIUS && d2 < bestDist2) {
          bestDist2 = d2;
          best = it;
        }
      }
      if (!best || !best.useMessage) return;
      e.preventDefault();
      const id = crypto.randomUUID();
      setLogEntries((prev) => [...prev.slice(-9), { id, text: best!.useMessage! }]);
      // Start the using window: freeze player + (if configured) swap the
      // item's sprite to its useStateAssetId for USE_DURATION ms.
      usingRef.current = {
        itemId: best.id,
        until: performance.now() + USE_DURATION,
      };
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scene.items]);

  // Click → walk-to.
  function onCanvasClick(e: React.MouseEvent) {
    const c = containerRef.current;
    if (!c || !character) return;
    const rect = c.getBoundingClientRect();
    const innerW = rect.width;
    const innerH = rect.height;
    // The container shows the scene at FOLLOW_ZOOM, so each rendered pixel
    // maps to (scene.width / innerW * FOLLOW_ZOOM) — compensate via
    // pointToScene that already accounts for inner CSS width.
    const sx = ((e.clientX - rect.left) / innerW) * scene.width;
    const sy = ((e.clientY - rect.top) / innerH) * scene.height;
    targetRef.current = { x: sx, y: sy };
  }

  if (!character || !charAsset) {
    return (
      <div className="border-2 border-farm-wood/60 bg-farm-ink/40 p-6 text-center text-sm opacity-70">
        Add a character to the scene first, then pick them as the active player.
      </div>
    );
  }

  // Render the scene at FOLLOW_ZOOM, panned so the character is centered.
  const longest = Math.max(scene.width, scene.height);
  const innerWidthPx = scene.width * FOLLOW_ZOOM;
  const innerHeightPx = scene.height * FOLLOW_ZOOM;

  // Choose the right walk frame based on facing + frame counter.
  let charSrc = charAsset.pixelUrl;
  const cols = charAsset.cols || 1;
  const rows = charAsset.rows || 1;
  if (frames.length > 0) {
    if (rows >= 4 && cols >= 4) {
      // Full sheet: rows = south/north/west/east, cols = walk frames.
      const rowMap: Record<typeof facingRef.current, number> = {
        south: 0,
        north: 1,
        west: 2,
        east: 3,
      };
      const r = rowMap[facingRef.current] ?? 0;
      const c = movingRef.current ? frameIdxRef.current % cols : 0;
      charSrc = frames[r]?.[c] || charSrc;
    } else if (cols >= 2 && rows === 1) {
      // Side-view sprite sheet (2-direction or 4-frame walk-cycle).
      // Mirror via CSS transform when facing west on a right-only sheet.
      const c = movingRef.current ? frameIdxRef.current % cols : 0;
      charSrc = frames[0]?.[c] || charSrc;
    }
  }

  // Mirror the sprite when the asset only has right-facing frames and the
  // player is moving west.
  const flipX = rows === 1 && cols === 4 && facingRef.current === "west";

  // Render order — y-sort painter algorithm. An item's depth is the
  // bottom edge of its sprite in scene coordinates: items "lower" on
  // screen draw on top of items "higher" up, so a tree behind the
  // player draws first and a tree in front draws over. The player and
  // moving NPCs use their RUNTIME y (posRef / npcStateRef) so they
  // re-stack as they walk; static items use their authored y. Items
  // anchored "bottom" already have y at the foot, so depth = y;
  // "center"-anchored items add half their approximate sprite height.
  // pickedTick is read here to ensure re-render when a pickup happens.
  void pickedTick;
  const depthOf = (it: PlayerSceneItem): number => {
    const isP = it.id === character.id;
    const ns = !isP && it.patrol ? npcStateRef.current.get(it.id) : undefined;
    const baseY = isP ? posRef.current.y : ns ? ns.y : it.y;
    return it.anchor === "bottom" ? baseY : baseY + it.scale * longest * 0.5;
  };
  const sortedItems = [...scene.items]
    .filter((it) => !pickedIdsRef.current.has(it.id))
    .sort((a, b) => depthOf(a) - depthOf(b));

  // The viewport "camera" centers on the player. We move the inner content,
  // not the outer frame.
  const viewW = 600;
  const viewH = 600;
  // Camera target = lerped player position (or raw position if the lerp
  // hasn't initialised yet, e.g. before the first rAF tick).
  const cam = cameraRef.current || posRef.current;
  // If the world is smaller than the viewport on an axis, center it instead
  // of following — otherwise the camera would push the world off-screen.
  let camX: number;
  let camY: number;
  if (innerWidthPx <= viewW) {
    camX = (viewW - innerWidthPx) / 2;
  } else {
    // Clamp so the camera never pushes past the world's edge.
    const target = -(cam.x * FOLLOW_ZOOM) + viewW / 2;
    const minX = viewW - innerWidthPx;
    camX = Math.max(minX, Math.min(0, target));
  }
  if (innerHeightPx <= viewH) {
    camY = (viewH - innerHeightPx) / 2;
  } else {
    const target = -(cam.y * FOLLOW_ZOOM) + viewH / 2;
    const minY = viewH - innerHeightPx;
    camY = Math.max(minY, Math.min(0, target));
  }

  return (
    <div
      className="relative mx-auto bg-farm-ink border-2 border-farm-wood overflow-hidden"
      style={{ width: viewW, height: viewH, maxWidth: "100%" }}
      onClick={onCanvasClick}
    >
      {/* Inner world — scaled to FOLLOW_ZOOM and translated by camera. */}
      <div
        ref={containerRef}
        className="absolute bg-checker"
        style={{
          width: innerWidthPx,
          height: innerHeightPx,
          transform: `translate(${camX}px, ${camY}px)`,
          backgroundSize: "12.5%",
          imageRendering: "pixelated",
          ...(scene.autoBackgroundColor
            ? { backgroundColor: scene.autoBackgroundColor }
            : {}),
          ...(scene.backgroundTileId && assets[scene.backgroundTileId]
            ? {
                backgroundImage: `url(${assets[scene.backgroundTileId].pixelUrl})`,
                backgroundRepeat: "repeat",
              }
            : {}),
        }}
      >
        {/* Tile-grid layers rendered below items, same as edit mode. */}
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
        {/* Ambient context particles — drifting dust / leaves / clouds
            tied to the scene's parsed context (inferred from
            autoBackgroundColor). Mounted above tile layers and below
            items so it reads as atmosphere, not as gameplay. */}
        <AmbientLayer autoBackgroundColor={scene.autoBackgroundColor} />
        {sortedItems.map((it) => {
          // Trigger zones + sound triggers are invisible in play mode.
          if (it.kind === "trigger" || it.kind === "sound") return null;
          // Particle emitters render a small loop of sparkles/smoke.
          if (it.kind === "emitter") {
            const em = it.emitter || { kind: "sparkle" as const, rate: 4, lifetime: 1.5 };
            const count = Math.max(2, Math.min(10, Math.round(em.rate * em.lifetime)));
            const widthPct = ((it.scale * longest) / scene.width) * 100;
            const leftPct = (it.x / scene.width) * 100;
            const topPct = (it.y / scene.height) * 100;
            const baseColor = em.kind === "sparkle" ? "#fff7c2" : "#7e7e7e";
            return (
              <div
                key={it.id}
                className="absolute pointer-events-none"
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  height: `${widthPct}%`,
                  transform: "translate(-50%, -50%)",
                  zIndex: it.z,
                }}
              >
                {Array.from({ length: count }).map((_, i) => {
                  // Deterministic pseudo-random offset based on index.
                  const r1 = ((i * 41) % 100) / 100;
                  const r2 = ((i * 73 + 7) % 100) / 100;
                  const dx = (r1 - 0.5) * 100;
                  const dy = (r2 - 0.5) * 100;
                  const delay = (i * em.lifetime) / count;
                  return (
                    <span
                      key={i}
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: "50%",
                        width: 4,
                        height: 4,
                        marginLeft: -2,
                        marginTop: -2,
                        background: baseColor,
                        borderRadius: "50%",
                        transform: `translate(${dx}%, ${dy}%)`,
                        animation: `pwf-${em.kind} ${em.lifetime}s ${delay}s infinite ease-out`,
                      }}
                    />
                  );
                })}
              </div>
            );
          }
          // Point lights render as a radial-gradient halo overlay.
          if (it.kind === "light") {
            const radius = it.light?.radius || 200;
            const color = it.light?.color || "#ffd47a";
            const intensity = Math.max(0, Math.min(1, it.light?.intensity ?? 0.7));
            const widthPct = ((radius * 2) / scene.width) * 100;
            const heightPct = ((radius * 2) / scene.height) * 100;
            const leftPct = (it.x / scene.width) * 100;
            const topPct = (it.y / scene.height) * 100;
            return (
              <div
                key={it.id}
                className="absolute pointer-events-none"
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                  transform: "translate(-50%, -50%)",
                  background: `radial-gradient(circle, ${color}${Math.round(intensity * 255)
                    .toString(16)
                    .padStart(2, "0")} 0%, transparent 70%)`,
                  mixBlendMode: "screen",
                  zIndex: it.z,
                }}
              />
            );
          }
          // While in the use window, swap this item's asset to its
          // useStateAssetId (if configured + the alt asset still exists).
          const useSwap =
            usingRef.current?.itemId === it.id &&
            it.useStateAssetId &&
            assets[it.useStateAssetId]
              ? assets[it.useStateAssetId]
              : null;
          const a = useSwap || assets[it.assetId];
          if (!a) return null;
          const isPlayer = it.id === character.id;
          const npcState =
            !isPlayer && it.patrol ? npcStateRef.current.get(it.id) : undefined;
          const widthPct = ((it.scale * longest) / scene.width) * 100;
          const renderX = isPlayer
            ? posRef.current.x
            : npcState
            ? npcState.x
            : it.x;
          // Idle bobble: when the player has been stationary for >250 ms,
          // add a 1-unit sine-wave bob (period 1200 ms) to renderY so the
          // sprite feels alive instead of frozen. Stops the moment they
          // start walking again because lastMovedAtRef is updated each
          // frame movement input is applied.
          const idleBobble =
            isPlayer && performance.now() - lastMovedAtRef.current > 250
              ? Math.sin((performance.now() * Math.PI) / 600)
              : 0;
          const renderY =
            (isPlayer
              ? posRef.current.y
              : npcState
              ? npcState.y
              : it.y) + idleBobble;
          const leftPct = (renderX / scene.width) * 100;
          const topPct = (renderY / scene.height) * 100;
          // Apply non-player rotation; the player stays upright. Patrol NPCs
          // also stay upright (otherwise direction-based facing fights it).
          const rot = !isPlayer && !npcState && it.rotation ? it.rotation : 0;

          // Pick the right src — player uses charSrc; patrol NPCs pick
          // their own row/col from cached frames; everyone else is static.
          let imgSrc = a.pixelUrl;
          let npcFlipX = Boolean(it.flipX);
          if (isPlayer) {
            imgSrc = charSrc;
          } else if (npcState) {
            const grid = npcFramesRef.current.get(a.id);
            if (grid) {
              if (a.rows >= 4 && a.cols >= 4) {
                const rowMap = { south: 0, north: 1, west: 2, east: 3 } as const;
                const r = rowMap[npcState.facing];
                const c = npcState.moving ? npcState.frameIdx % a.cols : 0;
                imgSrc = grid[r]?.[c] || imgSrc;
              } else if (a.cols >= 4 && a.rows === 1) {
                const c = npcState.moving ? npcState.frameIdx % a.cols : 0;
                imgSrc = grid[0]?.[c] || imgSrc;
                if (npcState.facing === "west") npcFlipX = !npcFlipX;
              }
            }
          }
          return (
            <div
              key={it.id}
              className="absolute pointer-events-none"
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${widthPct}%`,
                // y-sort painter — depth-based zIndex so the player and
                // moving NPCs correctly stack with static items as they
                // walk past each other. Same depth function as the sort
                // above; integer-rounded for the CSS zIndex.
                zIndex: Math.round(depthOf(it)),
                transform: (() => {
                  const baseT =
                    it.anchor === "bottom"
                      ? "translate(-50%, -100%)"
                      : "translate(-50%, -50%)";
                  return rot ? `${baseT} rotate(${rot}deg)` : baseT;
                })(),
                transformOrigin:
                  it.anchor === "bottom" ? "50% 100%" : "50% 50%",
              }}
            >
              {/* Soft shadow ellipse under any character/creature sprite
                  (player, patrol NPCs, plain character items in Play
                  mode). Rendered before the img so DOM order keeps it
                  visually beneath. ~60% sprite width, ~14% sprite
                  height; soft fade-out via radial-gradient gives the
                  blur look without a CSS filter. Adds a real depth
                  cue without needing any new image assets. */}
              {(isPlayer ||
                npcState !== undefined ||
                a.assetType === "character" ||
                a.assetType === "creature") && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: "50%",
                    bottom: 0,
                    width: "60%",
                    height: "14%",
                    transform: "translate(-50%, 50%)",
                    background:
                      "radial-gradient(ellipse, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0) 70%)",
                    borderRadius: "50%",
                  }}
                />
              )}
              <img
                src={imgSrc}
                alt=""
                draggable={false}
                className="pixelated w-full h-auto block"
                style={(() => {
                  const fx = isPlayer
                    ? Boolean(flipX) !== Boolean(it.flipX)
                    : npcFlipX;
                  const fy = Boolean(it.flipY);
                  return fx || fy
                    ? { transform: `scale(${fx ? -1 : 1}, ${fy ? -1 : 1})` }
                    : undefined;
                })()}
              />
            </div>
          );
        })}

        {/* Speech bubbles for nearby NPCs with dialogue. Re-evaluated each
            rAF tick (forceTick re-renders the whole component) so the
            bubble shows up smoothly as the player walks within range. */}
        {sortedItems
          .filter((it) => {
            if (!it.dialogue || it.dialogue.trim() === "") return false;
            if (it.id === character.id) return false; // never on the player itself
            const ns = it.patrol ? npcStateRef.current.get(it.id) : undefined;
            const ix = ns?.x ?? it.x;
            const iy = ns?.y ?? it.y;
            const dx = ix - posRef.current.x;
            const dy = iy - posRef.current.y;
            return dx * dx + dy * dy <= DIALOGUE_RADIUS * DIALOGUE_RADIUS;
          })
          .map((it) => {
            const ns = it.patrol ? npcStateRef.current.get(it.id) : undefined;
            const ix = ns?.x ?? it.x;
            const iy = ns?.y ?? it.y;
            // Shift the anchor upward by half the sprite height + a small
            // gap so the bubble sits above the NPC's head, not over it.
            const spriteH = it.scale * longest;
            const offsetSceneY = spriteH / 2 + 12;
            const leftPct = (ix / scene.width) * 100;
            const topPct = ((iy - offsetSceneY) / scene.height) * 100;
            return (
              <div
                key={`${it.id}-bubble`}
                className="absolute pointer-events-none"
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  transform: "translate(-50%, -100%)",
                  zIndex: it.z + 1000,
                }}
              >
                <div className="bg-white text-stone-900 text-[10px] px-2 py-1 border-2 border-stone-900 rounded-sm shadow whitespace-pre-wrap max-w-[160px]">
                  {it.dialogue}
                </div>
              </div>
            );
          })}

        {/* "Press E" hint — shown above the nearest usable item when the
            player is within USE_RADIUS. Only one hint visible at a time so
            the screen doesn't pile up bubbles for clustered items. */}
        {(() => {
          let bestId: string | null = null;
          let bestDist2 = USE_RADIUS * USE_RADIUS + 1;
          for (const it of sortedItems) {
            if (it.kind) continue;
            if (!it.useMessage || !it.useMessage.trim()) continue;
            const ns = it.patrol ? npcStateRef.current.get(it.id) : undefined;
            const ix = ns?.x ?? it.x;
            const iy = ns?.y ?? it.y;
            const dx = ix - posRef.current.x;
            const dy = iy - posRef.current.y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= USE_RADIUS * USE_RADIUS && d2 < bestDist2) {
              bestDist2 = d2;
              bestId = it.id;
            }
          }
          if (!bestId) return null;
          const it = sortedItems.find((x) => x.id === bestId);
          if (!it) return null;
          const ns = it.patrol ? npcStateRef.current.get(it.id) : undefined;
          const ix = ns?.x ?? it.x;
          const iy = ns?.y ?? it.y;
          const spriteH = it.scale * longest;
          const offsetSceneY = spriteH / 2 + 12;
          const leftPct = (ix / scene.width) * 100;
          const topPct = ((iy - offsetSceneY) / scene.height) * 100;
          return (
            <div
              key={`${it.id}-use-hint`}
              className="absolute pointer-events-none"
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                transform: "translate(-50%, -100%)",
                zIndex: it.z + 1001,
              }}
            >
              <div className="bg-farm-grass text-farm-ink text-[10px] px-2 py-0.5 border-2 border-farm-ink font-pixel">
                Press E
              </div>
            </div>
          );
        })()}
      </div>

      {scene.daytime !== undefined && scene.daytime !== 0.5 && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: daytimeTint(scene.daytime),
            mixBlendMode: "multiply",
            zIndex: 1000,
          }}
        />
      )}
      <div className="absolute top-1 left-1 px-2 py-0.5 bg-farm-ink/80 border border-farm-grass/60 text-[10px] text-farm-grass z-[1001]">
        ▶ PLAY · click to walk · WASD / arrows · {Math.round(posRef.current.x)},{Math.round(posRef.current.y)}
      </div>
      {toasts.length > 0 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="px-2 py-1 bg-farm-grass/90 border-2 border-farm-ink text-farm-ink text-xs font-pixel"
            >
              🛒 {t.text}
            </div>
          ))}
        </div>
      )}
      {logEntries.length > 0 && (
        <div className="absolute bottom-2 right-2 max-w-[60%] flex flex-col gap-1 pointer-events-none">
          {logEntries.slice(-5).map((e) => (
            <div
              key={e.id}
              className="px-2 py-1 bg-farm-ink/90 border border-farm-sky/60 text-farm-sky text-xs"
            >
              ⚡ {e.text}
            </div>
          ))}
        </div>
      )}
      {/* Inventory HUD — shows everything picked up in this play session. */}
      {(() => {
        const pickedItems = scene.items.filter((it) =>
          pickedIdsRef.current.has(it.id)
        );
        if (pickedItems.length === 0) return null;
        return (
          <div className="absolute top-1 right-1 max-w-[40%] flex flex-wrap-reverse gap-1 justify-end">
            {pickedItems.map((it) => {
              const a = assets[it.assetId];
              if (!a) return null;
              return (
                <div
                  key={it.id}
                  title={a.id}
                  className="w-8 h-8 bg-farm-ink/80 border border-farm-grass/70 flex items-center justify-center"
                >
                  <img src={a.pixelUrl} alt="" className="pixelated max-w-full max-h-full" />
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Mini-map — shown only when the world is bigger than the viewport
          on either axis. Each item is a tiny dot at its scene-coord
          position, downscaled into a 120×120 box. The current camera
          rectangle is overlaid as a thin outlined box. Re-rendered every
          rAF tick via the existing forceTick. */}
      {(innerWidthPx > viewW || innerHeightPx > viewH) && (() => {
        const MM = 120;
        const mmScale = MM / Math.max(scene.width, scene.height);
        const mmW = scene.width * mmScale;
        const mmH = scene.height * mmScale;
        // Visible scene region in scene coords (camera rect on the map).
        const visW = viewW / FOLLOW_ZOOM;
        const visH = viewH / FOLLOW_ZOOM;
        const visX0 = -camX / FOLLOW_ZOOM;
        const visY0 = -camY / FOLLOW_ZOOM;
        // Color per item kind for the dots. CanvasAsset doesn't carry the
        // asset's assetType so we color by kind / link only.
        const dotColor = (it: PlayerSceneItem): string => {
          if (it.id === character.id) return "#5fc46a"; // player → green
          if (it.kind === "light") return "#ffd47a";
          if (it.kind === "emitter") return "#fff7c2";
          if (it.linkSceneId) return "#ffa54a"; // door → orange
          if (it.patrol) return "#9fe0a8";       // patrolling NPC → green-ish
          return "#cfa580";                      // generic item
        };
        return (
          <div
            className="absolute bottom-2 right-2 bg-farm-ink/85 border-2 border-farm-wood/70 pointer-events-none z-[1002]"
            style={{ width: mmW + 2, height: mmH + 2 }}
            title="Mini-map (Play mode)"
          >
            {/* Items */}
            {sortedItems.map((it) => {
              if (it.kind === "trigger" || it.kind === "sound") return null;
              const ns = it.patrol ? npcStateRef.current.get(it.id) : undefined;
              const ix = it.id === character.id ? posRef.current.x : ns?.x ?? it.x;
              const iy = it.id === character.id ? posRef.current.y : ns?.y ?? it.y;
              const isPlayer = it.id === character.id;
              const size = isPlayer ? 4 : 3;
              return (
                <div
                  key={it.id}
                  style={{
                    position: "absolute",
                    left: ix * mmScale - size / 2 + 1,
                    top: iy * mmScale - size / 2 + 1,
                    width: size,
                    height: size,
                    background: dotColor(it),
                    borderRadius: isPlayer ? 0 : "50%",
                    boxShadow: isPlayer ? "0 0 0 1px rgba(0,0,0,0.6)" : undefined,
                  }}
                />
              );
            })}
            {/* Camera viewport rectangle */}
            <div
              style={{
                position: "absolute",
                left: visX0 * mmScale + 1,
                top: visY0 * mmScale + 1,
                width: visW * mmScale,
                height: visH * mmScale,
                border: "1px solid rgba(255,255,255,0.65)",
                pointerEvents: "none",
              }}
            />
          </div>
        );
      })()}
    </div>
  );
}

/**
 * Map daytime ∈ [0, 1] to a tint color.
 * 0/1 = midnight (dark navy, heavier alpha); 0.25/0.75 = dawn/dusk (warm,
 * light alpha); 0.5 = noon (transparent).
 */
function daytimeTint(d: number): string {
  // Lerp through 5 keyframes.
  const stops: Array<{ t: number; r: number; g: number; b: number; a: number }> = [
    { t: 0,    r: 50,  g: 60,  b: 110, a: 0.55 },
    { t: 0.25, r: 240, g: 160, b: 110, a: 0.25 },
    { t: 0.5,  r: 255, g: 255, b: 255, a: 0    },
    { t: 0.75, r: 230, g: 110, b: 90,  a: 0.30 },
    { t: 1,    r: 50,  g: 60,  b: 110, a: 0.55 },
  ];
  const clamped = Math.max(0, Math.min(1, d));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (clamped >= a.t && clamped <= b.t) {
      const f = (clamped - a.t) / (b.t - a.t);
      const r = Math.round(a.r + (b.r - a.r) * f);
      const g = Math.round(a.g + (b.g - a.g) * f);
      const bl = Math.round(a.b + (b.b - a.b) * f);
      const al = a.a + (b.a - a.a) * f;
      return `rgba(${r}, ${g}, ${bl}, ${al.toFixed(2)})`;
    }
  }
  return "rgba(255,255,255,0)";
}
