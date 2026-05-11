/**
 * Look up an Asset by id, preferring an explicit `override` record
 * over the React-closure-captured `closure` record. Used by the
 * fire-and-forget enrichers (embedAssets, classifyAssets,
 * analyzeBoundsForAssets, anchorAssets) to handle the stale-closure
 * case from the bulk handleSubmit path:
 *
 *   setAssets((a) => ({ ...a, ...updates }));  // queued, not synchronous
 *   void embedAssets(newIds, updates);          // closure `assets` is STALE
 *
 * Without the `override` parameter, the helper closed over the
 * pre-setAssets `assets` and silently skipped the newly-created ids.
 * Pass `updates` (the same record we just merged into state) so the
 * helper sees the fresh records.
 *
 * For keys present in both override and closure, override wins. For
 * keys present only in closure, closure wins. For keys present in
 * neither, returns undefined. (We never want to surprise a caller with
 * a phantom undefined value from a partial override.)
 *
 * Pure ESM so the runtime test can import it directly without booting
 * a React tree.
 */
export function freshAsset(closure, override, id) {
  if (!id) return undefined;
  if (override && Object.prototype.hasOwnProperty.call(override, id)) {
    return override[id];
  }
  return closure ? closure[id] : undefined;
}
