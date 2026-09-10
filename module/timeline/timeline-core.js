// THE TIMELINE, AS PURE DATA.
//
// A track is one thread of the campaign's story: Stonetop itself, or one player character. Each
// track holds dated entries, and a date here is the campaign clock's own pair -- a season and the
// year it belongs to (seasons/current-season.js) -- plus an `order` that says where the entry sits
// among the others in that same season. There are no day numbers: the book gives Stonetop seasons
// and years and nothing finer, and inventing a calendar to sort three entries is a worse trade than
// letting the table say which came first.
//
// Foundry-free end to end, so the sorting, the grouping and the list algebra are all testable
// without a document in sight. Everything that touches a JournalEntry lives in timeline-store.js.
//
// ⚠ THIS DELIBERATELY DOES NOT REUSE `createRoster` (actors/character/marked-people.js), which is
// the system's other pure list-of-records module and was the obvious candidate. Its identity is a
// person: `add` refuses a row whose name or uuid is already on the list, and `readList` drops a row
// with no name at all. Both are exactly right for a roster of the marked and exactly wrong here,
// where two entries in one season may perfectly well share a title and an untitled entry is just an
// entry you have not named yet. What IS carried across is its contract, which is the part worth
// having: every mutator returns `{ entries, added|removed|changed }` with a null result meaning
// "nothing moved", so a caller can skip a document write that would re-render every open sheet to
// no effect.

import { SEASON_IDS } from "../seasons/seasons-change-reminders.js";
import { campaignYear, seasonRank, seasonStampKey } from "../seasons/current-season.js";

/** The steading's own track. Player tracks are keyed by actor id. */
export const TIMELINE_TRACK_STEADING = "steading";

/** Prefix on every track page's `chronicleKey`, so the Chronicle's other keys cannot collide. */
export const TIMELINE_KEY_PREFIX = "timeline:";

/** Where entries that carry no readable season are gathered. See `groupByPeriod`. */
export const UNDATED_PERIOD_KEY = "undated";

/**
 * What wrote an entry.
 *
 * `hand` was typed by somebody; `season` is the row a Seasons Change records, which is stored and
 * can be edited like any other. `ledger` is the odd one: those rows are DERIVED at render time from
 * the change ledger and never stored, but they still pass through `normalizeEntry` on their way
 * into a view model, so the source has to be a value this file accepts or they would all come back
 * marked as hand-typed and read as somebody's own writing.
 */
export const TIMELINE_SOURCES = ["hand", "season", "ledger"];

/**
 * The sources whose rows are DERIVED: built at render time from another record, never stored,
 * and so with nothing here to edit.
 *
 * ⚠ ONE HOME FOR THIS FACT, deliberately. It is asked two ways -- of an entry, which knows its
 * own source, and of a bare id, which is all a click handler gets from a dataset. Those were
 * two independent tests (`source === "ledger"` in the view, `startsWith("ledger:")` in the
 * window) with the id convention enforced only by a comment, so a second derived source would
 * have come out editable in the window unless whoever added it remembered to prefix its ids too.
 * Both tests now read this list, and `derivedEntryId` is what mints the ids they recognise.
 */
export const TIMELINE_DERIVED_SOURCES = ["ledger"];

/** Is this row a view of another record rather than a stored entry? */
export function isDerivedEntry(entry) {
	return TIMELINE_DERIVED_SOURCES.includes(entry?.source);
}

/** The id a derived row carries, namespaced by its source so it cannot collide with a stored one. */
export function derivedEntryId(source, id) {
	return `${source}:${String(id ?? "")}`;
}

/** The same question asked of a bare id, which is all a delegated click handler has to go on. */
export function isDerivedEntryId(id) {
	const raw = String(id ?? "");
	return TIMELINE_DERIVED_SOURCES.some(source => raw.startsWith(`${source}:`));
}

/**
 * The `chronicleKey` a track's page is found by.
 *
 * Keyed rather than named, which is the rule every writer in The Chronicle follows: a page matched
 * by name loses its history the day somebody renames the character.
 *
 * @param {string} trackId  TIMELINE_TRACK_STEADING, or an actor id.
 */
export function trackKey(trackId) {
	return `${TIMELINE_KEY_PREFIX}${String(trackId ?? "").trim()}`;
}

/** The track id back out of a page key, or "" if that key is not one of ours. */
export function trackIdFromKey(key) {
	const raw = String(key ?? "");
	return raw.startsWith(TIMELINE_KEY_PREFIX) ? raw.slice(TIMELINE_KEY_PREFIX.length) : "";
}

/** A non-negative whole number, for `order`. */
function slot(value) {
	const n = Math.trunc(Number(value));
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * One stored entry, normalised.
 *
 * Defensive throughout even though a TypeDataModel validates on the way in: a page can be
 * hand-edited in the journal, imported from an older world, or reached before its model is
 * registered, and none of those should be able to put `undefined` into a template or throw on
 * `.trim()`.
 *
 * ⚠ DOTS ARE STRIPPED FROM THE ID. Ids reach `foundry.utils.getProperty` and dotted update paths
 * elsewhere in this system, and an id carrying a dot silently addresses a nested object instead of
 * a key. The same rule the relationship map's store states for its own ids.
 */
export function normalizeEntry(raw, index = 0) {
	const season = SEASON_IDS.includes(raw?.season) ? raw.season : "";
	const source = TIMELINE_SOURCES.includes(raw?.source) ? raw.source : "hand";
	return {
		id:        String(raw?.id ?? "").replace(/\./g, "").trim() || `entry-${index}`,
		year:      campaignYear(raw?.year),
		season,
		order:     slot(raw?.order),
		title:     String(raw?.title ?? "").trim(),
		place:     String(raw?.place ?? "").trim(),
		// The document that place IS, when somebody dropped one on the field. Optional and
		// usually empty: a party names places the book never did, and most of those are nowhere
		// in the world as a document. Kept as a bare uuid rather than a resolved name, so the
		// card can print a content link with nothing to await at render time.
		placeUuid: String(raw?.placeUuid ?? "").trim(),
		body:      String(raw?.body ?? ""),
		source,
		createdAt: Number(raw?.createdAt) || 0,
		authorId:  String(raw?.authorId ?? "").trim(),
	};
}

/**
 * Every entry, normalised.
 *
 * Nothing is dropped. A roster drops a nameless row because a row that names nobody is not a
 * roster entry, but a timeline entry with no title is still a dated thing that happened, and the
 * card renders its body instead.
 */
export function readEntries(raw) {
	if (!Array.isArray(raw)) return [];
	return raw.map(normalizeEntry);
}

/**
 * The one number an entry sorts on within its own period. Ties break on `createdAt` and then on
 * `id`, so the order is total and a repaint never shuffles two entries past each other.
 */
function withinPeriod(a, b) {
	return (a.order - b.order) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * The rank of the period an entry belongs to: `seasonRank`'s own number, so this file cannot drift
 * from the clock's idea of which season follows which. Undated entries rank -1, which is what
 * `seasonRank` already answers for an unstamped clock, and so sort before the first real season.
 */
export function periodRank(entry) {
	return entry?.season ? seasonRank({ season: entry.season, year: entry.year }) : -1;
}

/**
 * The period key an entry files under: the clock's own stamp key, so a timeline period and a
 * once-per-season marker cannot disagree about what "that season" is called.
 */
export function periodKey(entry) {
	return seasonStampKey(entry) || UNDATED_PERIOD_KEY;
}

/**
 * The facts a period carries, every one of them a function of the key and so answerable from any
 * single entry filed under it. Shared with the aggregate board, which builds its rows from the
 * union of several tracks and must not work them out a second way.
 */
export function periodFacts(entry) {
	return {
		key:    periodKey(entry),
		year:   entry?.season ? entry.year : 0,
		season: entry?.season ?? "",
		rank:   periodRank(entry),
	};
}

/**
 * ALREADY-NORMALISED entries in reading order. The internal form, for the callers that have just
 * normalised the list themselves and must not pay to do it again.
 */
function inOrder(entries) {
	return [...entries].sort((a, b) => (periodRank(a) - periodRank(b)) || withinPeriod(a, b));
}

/** Every entry in reading order: oldest period first, and within a period by `order`. */
export function sortEntries(entries) {
	return inOrder(readEntries(entries));
}

/**
 * Entries gathered into the periods a timeline draws: one block per season that has anything in it,
 * oldest first, with the undated block (if any) at the head.
 *
 * Empty seasons are NOT filled in. A campaign that played four sessions in one autumn and then
 * skipped a year should read as two blocks, not as six with four of them blank; the year label on
 * each block is what says time passed.
 *
 * @returns {Array<{key, year, season, rank, entries}>}
 */
export function groupByPeriod(entries) {
	const periods = new Map();
	for (const entry of sortEntries(entries)) {
		const key = periodKey(entry);
		if (!periods.has(key)) periods.set(key, { ...periodFacts(entry), entries: [] });
		periods.get(key).entries.push(entry);
	}
	return [...periods.values()].sort((a, b) => a.rank - b.rank);
}

/**
 * The entries already filed in one period, in order.
 *
 * ⚠ TAKES AN ALREADY-NORMALISED ARRAY, which every caller below has: each exported mutator opens
 * with `readEntries`. Going back through `sortEntries` here would re-normalise the whole list on
 * every call, and `renumber` calls this too -- so one `patchEntry` that re-dates an entry was
 * putting four full normalise-and-sort passes over the track to move one row.
 *
 * Filtered before it is sorted, for the same reason: the period is the small part.
 */
function periodMembers(entries, key) {
	return inOrder(entries.filter(e => periodKey(e) === key));
}

/**
 * Renumber one period's entries 0..n.
 *
 * Called after every move and every add, so `order` stays a dense run rather than drifting into
 * sparse values that a hand-edited page could collide on. Entries outside the period are returned
 * untouched and in their stored positions.
 */
function renumber(entries, key) {
	let next = 0;
	const ordered = new Map(periodMembers(entries, key).map(e => [e.id, next++]));
	return entries.map(e => (ordered.has(e.id) ? { ...e, order: ordered.get(e.id) } : e));
}

/**
 * Add an entry, appended to the end of its own period.
 *
 * `makeId` is injected rather than reaching for `foundry.utils.randomID`, which is what keeps this
 * module testable with no Foundry global in sight.
 */
export function addEntry(list, entry, makeId = () => "") {
	const entries = readEntries(list);
	const taken = new Set(entries.map(e => e.id));
	let index = entries.length;
	while (taken.has(`entry-${index}`)) index++;
	const next = normalizeEntry({ ...entry, id: entry?.id || makeId() }, index);
	if (taken.has(next.id)) return { entries, added: null };
	const key = periodKey(next);
	const last = periodMembers(entries, key).at(-1);
	const placed = { ...next, order: last ? last.order + 1 : 0 };
	return { entries: renumber([...entries, placed], key), added: placed };
}

/**
 * Drop one entry, and close the gap it leaves in its period.
 *
 * Cut by POSITION rather than by filtering on the id: `addEntry` refuses a duplicate id, but a
 * hand-edited page can still hold two entries spelling the same one, and a filter would delete
 * both for a single click.
 */
export function removeEntry(list, id) {
	const entries = readEntries(list);
	const at = entries.findIndex(e => e.id === id);
	if (at < 0) return { entries, removed: null };
	const removed = entries[at];
	const rest = entries.filter((_, i) => i !== at);
	return { entries: renumber(rest, periodKey(removed)), removed };
}

/**
 * Patch one entry's fields. `changed` is null when nothing actually moved, so re-saving an unedited
 * entry writes nothing.
 *
 * ⚠ RE-DATING AN ENTRY MOVES IT BETWEEN PERIODS, so both the period it left and the one it joined
 * are renumbered, and the entry lands at the END of its new period. Keeping its old `order` would
 * drop it into the middle of a season it has never been in, at a position that means nothing there.
 */
export function patchEntry(list, id, changes) {
	const entries = readEntries(list);
	const at = entries.findIndex(e => e.id === id);
	if (at < 0) return { entries, changed: null };
	const before = entries[at];
	const merged = normalizeEntry({ ...before, ...changes, id: before.id }, at);
	if (Object.keys(merged).every(k => merged[k] === before[k])) return { entries, changed: null };

	const fromKey = periodKey(before);
	const toKey = periodKey(merged);
	if (fromKey === toKey) {
		const patched = entries.map((e, i) => (i === at ? { ...merged, order: before.order } : e));
		return { entries: renumber(patched, toKey), changed: merged };
	}
	const last = periodMembers(entries.filter((_, i) => i !== at), toKey).at(-1);
	const moved = { ...merged, order: last ? last.order + 1 : 0 };
	const patched = entries.map((e, i) => (i === at ? moved : e));
	return { entries: renumber(renumber(patched, fromKey), toKey), changed: moved };
}

/**
 * Move an entry one place earlier (-1) or later (+1) WITHIN its season, which is the only ordering
 * the reader controls by hand. Crossing into another season is a re-dating, and that is what
 * `patchEntry` is for.
 *
 * `moved` is null at either end of a period, so the buttons can be disabled off the same answer
 * rather than each caller working out where the ends are.
 */
export function moveEntry(list, id, delta) {
	const entries = readEntries(list);
	const target = entries.find(e => e.id === id);
	if (!target) return { entries, moved: null };

	const key = periodKey(target);
	const members = periodMembers(entries, key);
	const at = members.findIndex(e => e.id === id);
	const to = at + (Number(delta) < 0 ? -1 : 1);
	if (to < 0 || to >= members.length) return { entries, moved: null };

	// Swap the two ORDERS rather than the two entries: the stored array's positions carry no
	// meaning here (periods interleave in it freely), so the reorder has to be written into the
	// field that does. `renumber` then flattens whatever the swap produced back to a dense run.
	const swap = new Map([[members[at].id, members[to].order], [members[to].id, members[at].order]]);
	const next = entries.map(e => (swap.has(e.id) ? { ...e, order: swap.get(e.id) } : e));
	return { entries: renumber(next, key), moved: target };
}
