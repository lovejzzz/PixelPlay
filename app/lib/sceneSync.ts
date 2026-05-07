/**
 * Real-time scene sync via Supabase Realtime broadcast channels. When
 * `syncEnabled` is on for a project, every active scene opens a channel
 * named `scene:<projectId>:<sceneId>` and broadcasts the full scene
 * snapshot on each local edit. Remote snapshots are routed back through
 * `updateScene(..., { record: false, remote: true })` so they don't
 * pollute the undo stack or echo back to the network.
 *
 * Requires `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * env vars at build time. When either is missing, `getSceneSyncClient`
 * returns null and the page falls back to local-only behavior silently.
 */
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;
let cachedKey = "";

/** A unique per-tab id used to filter our own broadcasts on receive. */
export const SYNC_PEER_ID =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export function getSceneSyncClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const cacheKey = `${url}::${key}`;
  if (cachedClient && cachedKey === cacheKey) return cachedClient;
  cachedClient = createClient(url, key, {
    realtime: { params: { eventsPerSecond: 10 } },
    auth: { persistSession: false },
  });
  cachedKey = cacheKey;
  return cachedClient;
}

export function sceneChannelName(projectId: string, sceneId: string): string {
  return `scene:${projectId}:${sceneId}`;
}

export type ScenePatchPayload<TScene = unknown> = {
  peerId: string;
  scene: TScene;
};

/** Open (or reuse) a broadcast channel for the given project+scene pair.
 *  Returns the channel + a teardown helper. The handler is invoked for
 *  remote scene snapshots (peerId !== SYNC_PEER_ID); local echoes are
 *  filtered out automatically. */
export function openSceneChannel<TScene = unknown>(
  client: SupabaseClient,
  projectId: string,
  sceneId: string,
  onRemoteScene: (scene: TScene) => void,
  onStatus?: (status: "joining" | "live" | "closed" | "error") => void,
): { channel: RealtimeChannel; close: () => void } {
  const name = sceneChannelName(projectId, sceneId);
  const channel = client.channel(name, {
    config: { broadcast: { self: false } },
  });
  channel.on("broadcast", { event: "scene" }, (msg) => {
    const payload = msg.payload as ScenePatchPayload<TScene> | undefined;
    if (!payload || payload.peerId === SYNC_PEER_ID) return;
    onRemoteScene(payload.scene);
  });
  onStatus?.("joining");
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") onStatus?.("live");
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onStatus?.("error");
    else if (status === "CLOSED") onStatus?.("closed");
  });
  return {
    channel,
    close: () => {
      try {
        client.removeChannel(channel);
      } catch {
        /* noop */
      }
      onStatus?.("closed");
    },
  };
}

/** Broadcast a scene snapshot on the given channel. Tagged with this
 *  tab's peerId so other tabs filter it back out. Fire-and-forget. */
export function broadcastScene<TScene>(
  channel: RealtimeChannel,
  scene: TScene,
): void {
  const payload: ScenePatchPayload<TScene> = { peerId: SYNC_PEER_ID, scene };
  void channel.send({ type: "broadcast", event: "scene", payload });
}
