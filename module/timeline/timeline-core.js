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
import { historyYear } from "../seasons/campaign-year.js";

/** The steading's own track. Player tracks are keyed by actor id. */
export const TIMELINE_TRACK_STEADING = "steading";

/** Prefix on every track page's `chronicleKey`, so the Chronicle's other keys cannot collide. */
export const TIMELINE_KEY_PREFIX = "timeline:";

/** Where entries that carry no readable season are gathered. See `groupByPeriod`. */
export const UNDATED_PERIOD_KEY = "undated";

/** The suffix on a year-only period's key ("-9:year"): a year whose season nobody remembers. */
const YEAR_ONLY_PERIOD = "year";

/**
 * What wrote an entry. EVERY ROW IS STORED: there are no derived rows any more.
 *
 * `hand` was typed by somebody. Every other source is a MILESTONE the system wrote when the thing
 * happened -- a Seasons Change, a level gained, a kill, an expedition home, a site visited, a death,
 * a lasting wound, an arcanum, a follower gained or lost -- and each is an ordinary entry that can be
 * edited or deleted like a typed one. The source is what the reader's "Filter" menu and the card's
 * kind chip read.
 *
 * ⚠ ORDER IS THE FILTER MENU'S ORDER (less `season`, which is no card; see TIMELINE_SEASON_SOURCE).
 * And a new source must be added HERE, or `normalizeEntry` files every row it writes as hand-typed.
 */
export const TIMELINE_SOURCES = [
	"hand", "season", "levelup", "kills", "expedition", "site", "death", "wound", "arcana", "follower",
];

/** The source of the one row per season that collects a character's kills. See `addKills`. */
export const TIMELINE_KILLS_SOURCE = "kills";

/**
 * The source of the one row per season a Seasons Change writes (timeline-season-entry.js).
 *
 * ⚠ NOT A CARD. Its gains and Surplus print INSIDE that season's heading (user's call, 2026-10-03:
 * a card repeating the season it was filed under said nothing the heading did not), so it is in no
 * Filter menu, wears no kind colour and cannot be borrowed as a tag. See `TIMELINE_CARD_SOURCES`.
 */
export const TIMELINE_SEASON_SOURCE = "season";

/** The sources that print as CARDS: every one but the season's, which prints in its heading. */
export const TIMELINE_CARD_SOURCES = TIMELINE_SOURCES.filter(source => source !== TIMELINE_SEASON_SOURCE);

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
		// STORED, and allowed below 1: a timeline holds the table's history from before play.
		year:      historyYear(raw?.year),
		season,
		// "Some time that year": a blank season that still has a year. Only ever true on a blank
		// season, so a row given a season later reads as that season and nothing else.
		yearOnly:  !season && raw?.yearOnly === true,
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
		// What a milestone row IS, so the same event recorded twice patches the row it already wrote
		// instead of adding a second (`levelup:4`, `expedition:<trip id>`). Blank on a typed entry.
		// See `upsertByKey`.
		key:       String(raw?.key ?? "").trim(),
		// The foes on a kills row, one name per kill. Empty on every other kind.
		foes:      Array.isArray(raw?.foes) ? raw.foes.map(f => String(f ?? "").trim()).filter(Boolean) : [],
		// The ONE tag a typed row wears: a kind's id it borrows, or a custom tag's id. Blank for none,
		// and never read on a milestone row, whose source is its kind. See timeline-tags.js.
		tag:       String(raw?.tag ?? "").replace(/\./g, "").trim(),
	};
}

/** Two string lists, equal item for item. */
function sameList(a, b) {
	return a.length === b.length && a.every((item, i) => item === b[i]);
}

/** Two normalised entries, equal field for field. `foes` is a list, so it is compared by value. */
function sameEntry(a, b) {
	return Object.keys(a).every(k => (k === "foes" ? sameList(a.foes, b.foes) : a[k] === b[k]));
}

/**
 * Every entry, normalised.
 *
 * Nothing is dropped. A roster drops a nameless row because a row that names nobody is not a
 * roster entry, but a timeline entry with no title is still a dated thing that happened, and the
 * card renders its body instead. The one row left out is a leftover (`isLeftover`), which is not an
 * entry at all.
 */
export function readEntries(raw) {
	if (Array.isArray(raw)) return raw.map(normalizeEntry);
	// A page stores its entries KEYED BY ID (TimelinePageModel).
	if (!raw || typeof raw !== "object") return [];
	return Object.entries(raw)
		.filter(([, entry]) => !isLeftover(entry))
		.map(([id, entry], index) => normalizeEntry({ ...entry, id: entry?.id || id }, index));
}

/**
 * Is this stored row a LEFTOVER rather than an entry? Every row is first written whole, its own `id`
 * with it (`writeEntries`, `migrateData`). A row stored with no id was never written whole: it is
 * what a field-by-field patch leaves behind when it lands after another client deleted that row.
 * It is the row somebody deleted, so it stays deleted.
 */
export function isLeftover(entry) {
	return !String(entry?.id ?? "").trim();
}

/** Entries as a page stores them: one key per entry, the key its id. */
export function entriesById(entries) {
	return Object.fromEntries(readEntries(entries).map(entry => [entry.id, entry]));
}

/**
 * What it takes to turn one list of entries into another, ENTRY BY ENTRY: each entry added (whole),
 * each one changed (only the fields that changed), each one gone.
 *
 * This is what lets a write touch only what it changed. Two clients writing the same track at once
 * -- a GM's kill and a player's level-up, a player retitling one row while another adds a row --
 * then each land their own keys, where a whole-list write would have the last one back erase the
 * other's work.
 *
 * @returns {{added: Record<string, object>, changed: Record<string, object>, removed: string[]}|null}
 *   null when the two are the same.
 */
export function entriesDiff(stored, next) {
	const was = new Map(readEntries(stored).map(entry => [entry.id, entry]));
	const now = readEntries(next);
	const added = {};
	const changed = {};
	for (const entry of now) {
		const old = was.get(entry.id);
		was.delete(entry.id);
		if (!old) { added[entry.id] = entry; continue; }
		if (sameEntry(old, entry)) continue;
		changed[entry.id] = Object.fromEntries(Object.keys(entry)
			.filter(key => (key === "foes" ? !sameList(old.foes, entry.foes) : old[key] !== entry[key]))
			.map(key => [key, entry[key]]));
	}
	const removed = [...was.keys()];
	if (!Object.keys(added).length && !Object.keys(changed).length && !removed.length) return null;
	return { added, changed, removed };
}

/**
 * The one number an entry sorts on within its own period. Ties break on `createdAt` and then on
 * `id`, so the order is total and a repaint never shuffles two entries past each other.
 */
function withinPeriod(a, b) {
	return (a.order - b.order) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id);
}

/** Slots in a year's rank: its year-only period first, then the four seasons in SEASON_IDS order. */
const RANK_SLOTS = SEASON_IDS.length + 1;

/**
 * The rank of the period an entry belongs to. The seasons follow each other in SEASON_IDS order,
 * the clock's own; a year whose season is unknown ranks ahead of that year's Spring, since nothing
 * says it came later. Undated entries rank below everything, so they head the timeline, before even
 * the oldest history.
 *
 * Not `seasonRank` (current-season.js): that is the CLOCK's rank and floors the year at 1, where a
 * timeline holds years before play.
 */
export function periodRank(entry) {
	const year = historyYear(entry?.year);
	const index = SEASON_IDS.indexOf(entry?.season);
	if (index >= 0) return year * RANK_SLOTS + index + 1;
	return entry?.yearOnly ? year * RANK_SLOTS : -Infinity;
}

/**
 * The period key an entry files under: the clock's own "<year>:<season>" shape (seasonStampKey), so a
 * timeline period and a once-per-season marker cannot disagree about what "that season" is called.
 * Written out rather than called because the clock's key floors the year at 1 and a timeline holds
 * history. A year whose season is unknown files as "<year>:year"; nothing undated has a year at all.
 */
export function periodKey(entry) {
	if (SEASON_IDS.includes(entry?.season)) return `${historyYear(entry.year)}:${entry.season}`;
	return entry?.yearOnly ? `${historyYear(entry.year)}:${YEAR_ONLY_PERIOD}` : UNDATED_PERIOD_KEY;
}

/**
 * The facts a period carries, every one of them a function of the key and so answerable from any
 * single entry filed under it. Shared with the aggregate board, which builds its rows from the
 * union of several tracks and must not work them out a second way.
 */
export function periodFacts(entry) {
	return {
		key:      periodKey(entry),
		// null, not 0, for the undated block: 0 is a real year now (the one before play began).
		year:     entry?.season || entry?.yearOnly ? historyYear(entry.year) : null,
		season:   entry?.season ?? "",
		yearOnly: !entry?.season && !!entry?.yearOnly,
		rank:     periodRank(entry),
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
	if (sameEntry(merged, before)) return { entries, changed: null };

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

/**
 * Write a milestone ONCE: add it if no row carries its `key`, and otherwise patch only the fields
 * named in `refresh` (or leave the row alone when there are none).
 *
 * This is what lets a milestone be recorded from wherever it happens without each caller asking
 * "did I already?": a level gained twice in one evening (a correction, a reload mid-dialog) is
 * still one "Reached level 4". Only the fields in `refresh` follow a re-record -- the GM may have
 * re-dated or retitled the row, and a refresh must not undo that.
 *
 * An entry with no key is simply added.
 *
 * @returns {{entries, added, changed}}  `added` or `changed` is the row written; both null when
 *          nothing moved.
 */
export function upsertByKey(list, entry, { refresh = [], makeId = () => "" } = {}) {
	const key = String(entry?.key ?? "").trim();
	const entries = readEntries(list);
	const found = key ? entries.find(e => e.key === key) : null;
	if (!found) {
		const { entries: next, added } = addEntry(entries, entry, makeId);
		return { entries: next, added, changed: null };
	}
	const changes = Object.fromEntries(refresh.filter(field => field in (entry ?? {})).map(field => [field, entry[field]]));
	if (!Object.keys(changes).length) return { entries, added: null, changed: null };
	const { entries: next, changed } = patchEntry(entries, found.id, changes);
	return { entries: next, added: null, changed };
}

/**
 * Add kills to the ONE row that collects them for a season.
 *
 * ⚠ FOUND BY ITS DATE, NOT BY A KEY. The row IS "the kills of Summer, Year Two", the same way a
 * Seasons Change row is that season's; a key minted from the date would keep collecting for the
 * season it named after a GM re-dated the row, which is a row sitting in one season holding another
 * season's kills.
 *
 * @param {Array}    list
 * @param {{season: string, year: number}} when
 * @param {string[]} names  One name per kill. Blank names are dropped.
 * @param {object}   [meta]  Extra fields for a NEW row (createdAt, authorId).
 * @returns {{entries, added, changed}}
 */
export function addKills(list, { season = "", year = 1 } = {}, names = [], meta = {}, makeId = () => "") {
	const slain = (Array.isArray(names) ? names : []).map(n => String(n ?? "").trim()).filter(Boolean);
	const entries = readEntries(list);
	if (!slain.length) return { entries, added: null, changed: null };
	const when = normalizeEntry({ season, year });
	const row = entries.find(e => e.source === TIMELINE_KILLS_SOURCE && e.season === when.season && e.year === when.year);
	if (row) {
		const { entries: next, changed } = patchEntry(entries, row.id, { foes: [...row.foes, ...slain] });
		return { entries: next, added: null, changed };
	}
	const { entries: next, added } = addEntry(entries, {
		...meta, season: when.season, year: when.year, source: TIMELINE_KILLS_SOURCE, title: "", foes: slain,
	}, makeId);
	return { entries: next, added, changed: null };
}

/** How many kills a track's rows hold between them. */
export function killTotal(entries) {
	return readEntries(entries)
		.filter(e => e.source === TIMELINE_KILLS_SOURCE)
		.reduce((sum, e) => sum + e.foes.length, 0);
}

/**
 * A kills row's foes counted by name, in the order each name first fell: "Crinwin" ×3 then
 * "Bandit Chief". Names compare exactly; the token names a table sees are what is stored.
 *
 * @returns {Array<{name: string, count: number}>}
 */
export function foeSummary(foes) {
	const counts = new Map();
	for (const raw of Array.isArray(foes) ? foes : []) {
		const name = String(raw ?? "").trim();
		if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return [...counts].map(([name, count]) => ({ name, count }));
}

/** The most kills one "Name ×N" line may stand for, so a typo cannot mint ten thousand. */
export const MAX_KILLS_PER_LINE = 99;

/** A kills row's foes, one line per name: "Crinwin ×3" for repeats. */
export function foeLines(foes) {
	return foeSummary(foes).map(({ name, count }) => (count > 1 ? `${name} ×${count}` : name));
}

/** A kills row's foes as editable text, one line per name. */
export function foesToLines(foes) {
	return foeLines(foes).join("\n");
}

/**
 * The text of the "Slain" field back into one name per kill. A line may end in "×3" or "x3" (with or
 * without a space before the number) to stand for that many; anything else is one kill named by the
 * line.
 *
 * ⚠ A LETTER X COUNTS ONLY WITH A SPACE BEFORE IT: "Crinwin x3", never the last letter of a name.
 * "Max 3" is one foe called Max 3, not three called Ma. The "×" sign is never a letter, so it needs
 * no space ("Crinwin×3").
 */
export function linesToFoes(text) {
	const foes = [];
	for (const raw of String(text ?? "").split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		const match = line.match(/^(.*?)(?:\s*×|\s+x)\s*(\d+)$/i);
		const name = match ? match[1].trim() : line;
		const count = match ? Math.min(MAX_KILLS_PER_LINE, Math.max(1, Number(match[2]) || 1)) : 1;
		if (!name) continue;
		for (let i = 0; i < count; i++) foes.push(name);
	}
	return foes;
}
