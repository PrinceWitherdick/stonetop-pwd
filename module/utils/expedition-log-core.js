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

/**
 * Fold another GM's write into this window's copy of the log, keeping what each of them changed.
 *
 * The log is one world setting written whole, so two GMs on one trip each hold a copy and each
 * write puts theirs back over the other's. Merged against `base` (the last log this window knew
 * the world to hold), a change only one side made survives: theirs where they changed something,
 * ours where only we did. Where both changed the same answer, theirs wins, which is also what the
 * world setting already says.
 *
 * Trips, and any other list whose every item carries an `id` (Chart a Course's rows), merge item
 * by item, so a trip or a row added on either side is kept and one deleted on either side stays
 * gone. Any other list is one answer and is taken whole.
 *
 * `currentId` stays OURS. It is which trip THIS window is on, kept in the setting only so a
 * reopen lands there, and another GM switching trips must not move this window with them. When
 * our trip is gone from the merged log, `normalizeLog` falls back as it does for any stale id.
 *
 * @param {object} base    the log as last read from, or written to, the world setting
 * @param {object} mine    this window's copy, which may hold writes still on their way
 * @param {object} theirs  the log the other GM just wrote
 * @returns {{currentId: string|null, list: object[]}}
 */
export function mergeLogs(base, mine, theirs) {
	const b = normalizeLog(base), m = normalizeLog(mine), t = normalizeLog(theirs);
	return normalizeLog({ currentId: m.currentId, list: mergeValue(b.list, m.list, t.list) });
}

/** Whether two logs (or any two answers in one) hold the same thing, ignoring key order. */
export function sameLog(a, b) {
	return sameValue(a, b);
}

const isPlainObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const hasIds = list => Array.isArray(list) && list.every(item => isPlainObject(item) && typeof item.id === "string" && item.id);

// An absent key and an `undefined` one are the same answer: the setting is stored as JSON,
// which drops the second, so a copy that still has it must not read as changed.
function sameValue(a, b) {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
	}
	if (!isPlainObject(a) || !isPlainObject(b)) return false;
	return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => sameValue(a[key], b[key]));
}

function mergeValue(base, mine, theirs) {
	if (sameValue(theirs, base)) return mine;
	if (sameValue(mine, base) || sameValue(mine, theirs)) return theirs;
	if (isPlainObject(mine) && isPlainObject(theirs)) {
		const was = isPlainObject(base) ? base : {};
		const out = {};
		for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
			const value = mergeValue(was[key], mine[key], theirs[key]);
			if (value !== undefined) out[key] = value;
		}
		return out;
	}
	if (hasIds(mine) && hasIds(theirs)) return mergeById(hasIds(base) ? base : [], mine, theirs);
	return theirs;
}

// In their order, then anything we added that they have not seen. An item one side deleted stays
// deleted, even when the other side changed it meanwhile.
function mergeById(base, mine, theirs) {
	const was   = new Map(base.map(item => [item.id, item]));
	const ours  = new Map(mine.map(item => [item.id, item]));
	const their = new Set(theirs.map(item => item.id));
	const out = [];
	for (const item of theirs) {
		if (ours.has(item.id)) out.push(mergeValue(was.get(item.id), ours.get(item.id), item));
		else if (!was.has(item.id)) out.push(item);
	}
	for (const item of mine) {
		if (!their.has(item.id) && !was.has(item.id)) out.push(item);
	}
	return out;
}
