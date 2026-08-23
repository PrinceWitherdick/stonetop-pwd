// ── Expedition log: pure list operations ───────────────────────────────────────
// The Expedition walkthrough stores a growing log of trips:
//   { currentId: "<id>", list: [{ id, title, createdAt, …step notes }] }   (oldest first)
// These helpers keep that shape correct — normalize a raw setting blob, pick/switch
// the trip being edited, and add/delete trips — free of Foundry globals so they're
// unit-testable. ExpeditionDialog wires them to randomID/Date.now/setSetting; the
// recorded trips compile into the Chronicle (utils/chronicle-core.js).

// Each op returns a fresh top-level { currentId, list } so a caller can persist it
// without aliasing the cached setting. `ensureCurrent` additionally deep-clones the
// entries, since its caller mutates the returned entry in place.
const cloneEntry = e => structuredClone(e);

/**
 * Normalize a raw setting blob to { currentId, list }. A missing list becomes [];
 * a missing/stale currentId falls back to the most recent trip (or null when empty).
 */
export function normalizeLog(raw) {
	const list = Array.isArray(raw?.list) ? raw.list : [];
	let currentId = raw?.currentId ?? null;
	if (!list.some(e => e.id === currentId)) currentId = list.at(-1)?.id ?? null;
	return { currentId, list };
}

/**
 * A logged trip's display name: its own title, or "Expedition N" for one never named.
 *
 * The switcher, the asset a trip is holding on the steading sheet, and the Chronicle page
 * all have to call an unnamed trip something, and they have to call it the SAME thing:
 * an asset tagged "Expedition 2" against a switcher reading "Expedition 3" names no trip
 * at all. `index` is the trip's position in the log (oldest first).
 */
export function expeditionLabel(entry, index) {
	const title = String(entry?.title ?? "").trim();
	return title || `Expedition ${index + 1}`;
}

/**
 * Every logged trip's id to the name it is called by, in one Map.
 *
 * The steading copies a trip's name onto whatever that trip takes out of its stores, so it needs
 * the whole answer at once: what each trip is called NOW, and (by absence) which ids are no longer
 * trips at all. Built from `expeditionLabel`, so a copy and the switcher cannot word one trip two
 * ways. See StonetopSteading#reconcileHeldAssets.
 */
export function expeditionNames(log) {
	return new Map((log?.list ?? [])
		.map((entry, index) => [entry?.id, expeditionLabel(entry, index)])
		.filter(([id]) => id));
}

/** The trip currently being edited, or null when the log is empty. */
export function currentExpedition(log) {
	return log.list.find(e => e.id === log.currentId) ?? null;
}

/**
 * Guarantee a current trip. Returns { log, entry } where `log` is an independent
 * deep copy and `entry` is its current trip — created via `makeEntry()` (which
 * supplies a fresh { id, title, createdAt }) when the log is empty or nothing is
 * selected. The caller mutates `entry`, then persists `log`.
 */
export function ensureCurrent(log, makeEntry) {
	const next  = { currentId: log.currentId, list: log.list.map(cloneEntry) };
	let entry = next.list.find(e => e.id === next.currentId);
	if (!entry) {
		entry = makeEntry();
		next.list.push(entry);
		next.currentId = entry.id;
	}
	return { log: next, entry };
}

/** Append a new trip and select it. */
export function addExpedition(log, entry) {
	return { currentId: entry.id, list: [...log.list, entry] };
}

/** Switch which logged trip is current. No-op (returns the input) for an unknown id. */
export function selectExpedition(log, id) {
	if (!log.list.some(e => e.id === id)) return log;
	return { currentId: id, list: log.list };
}

/**
 * Remove a trip from the log. When the removed trip was current, selection falls to
 * the most recent remaining trip (or null when the log empties).
 */
export function deleteExpedition(log, id) {
	const list = log.list.filter(e => e.id !== id);
	const currentId = log.currentId === id ? (list.at(-1)?.id ?? null) : log.currentId;
	return { currentId, list };
}
