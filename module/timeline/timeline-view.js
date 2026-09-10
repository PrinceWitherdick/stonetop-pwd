// THE TIMELINE, SHAPED FOR A TEMPLATE.
//
// One view model, three hosts: the tab on a sheet, the aggregate window, and the journal page a
// track reads back as. They differ in how many tracks they are handed and in nothing else, which is
// what keeps the season a card is filed under from being worked out three times and drifting twice.
//
// Pure. Enriching an entry's body is async and Foundry-only, so the raw body rides in the model and
// the host enriches it; everything about WHICH period a card is in and WHAT that period is called
// is decided here, once.
//
// ⚠ THE SEASON INKS ARE NOT USED HERE, AND MUST NOT BE. The four `--stonetop-season-*-ink` tokens
// belong to the steading header's clock and nothing else; a test counts every read of them in the
// stylesheet and fails on a fifth. A period is marked by its season's NAME and its glyph, which is
// the same bargain the location journals' season headings already strike. See season-inks-exclusive.

import { SEASON_IDS, seasonLabel } from "../seasons/seasons-change-reminders.js";
import { yearLabel } from "../seasons/seasons-chronicle.js";
import { localize } from "../utils/i18n.js";
import { enrichHTML } from "../utils/foundry-compat.js";
import {
	UNDATED_PERIOD_KEY, groupByPeriod, isDerivedEntry, periodFacts, periodKey, sortEntries,
} from "./timeline-core.js";

/**
 * The CSS modifier a season's heading glyph wears.
 *
 * ⚠ "autumn" IS "fall" IN ART AND CSS. The clock says autumn, the icons and the stylesheet say
 * fall, and two places in this system already carry that swap (`seasonIconSrc`, and the Seasons
 * Change block builder). This is the third and must not be the one that forgets.
 */
export function seasonGlyphClass(seasonId) {
	if (!SEASON_IDS.includes(seasonId)) return "";
	return `stonetop-season--${seasonId === "autumn" ? "fall" : seasonId}`;
}

/**
 * What a period is called on the spine: the season, then the year it belongs to.
 *
 * The season leads because a run of blocks is read down a column and the season is what changes
 * between neighbours; the year is the constant that only sometimes moves. `yearLabel` is the same
 * function the Seasons Change journal titles its pages with, so a reader looking at both sees one
 * naming scheme rather than two.
 */
export function periodLabel({ season, year } = {}) {
	if (!season) return localize("stonetop.timeline.beforeRecord");
	return `${seasonLabel(season)}, ${yearLabel(year)}`;
}

/** One entry, ready to print. `body` stays raw for the host to enrich. */
function cardVM(entry, { canEdit = false } = {}) {
	// A row DERIVED from the change ledger, as against one stored on the page. The Seasons Change
	// row is stored and so is editable like any other; a ledger row is a view of another record and
	// has nothing here to edit. Refusing its controls in the model rather than in the template is
	// what keeps the three hosts from each having to remember.
	const derived = isDerivedEntry(entry);
	return {
		id:        entry.id,
		title:     entry.title,
		place:     entry.place,
		placeUuid: entry.placeUuid,
		// Only a place that IS a document gets a link. Everything else is a name somebody typed,
		// and a link to nowhere reads as a broken one.
		placeLinked: !!entry.placeUuid,
		body:      entry.body,
		// A row the system wrote for itself rather than one somebody typed. Rendered differently,
		// so a reader can always tell the record from the bookkeeping.
		isAuto:    entry.source !== "hand",
		canEdit:   canEdit && !derived,
	};
}

/** One period block, with whatever it holds. */
function periodVM(period, entries, opts) {
	return {
		key:         period.key,
		label:       periodLabel(period),
		seasonLabel: period.season ? seasonLabel(period.season) : "",
		yearLabel:   period.season ? yearLabel(period.year) : "",
		glyphClass:  seasonGlyphClass(period.season),
		undated:     period.key === UNDATED_PERIOD_KEY,
		entries:     entries.map(e => cardVM(e, opts)),
	};
}

/**
 * One track as its own timeline: every period it has anything in, oldest first.
 *
 * @param {{trackId, name, entries, actor?}} track
 * @param {{canEdit?: boolean}} [opts]
 */
export function buildTrackVM(track, opts = {}) {
	const periods = groupByPeriod(track?.entries ?? []);
	return {
		trackId: track?.trackId ?? "",
		name:    track?.name ?? "",
		portrait: track?.actor?.img ?? "",
		isEmpty: !periods.length,
		count:   periods.reduce((n, p) => n + p.entries.length, 0),
		periods: periods.map(p => periodVM(p, p.entries, opts)),
	};
}

/**
 * Every track under ONE spine: the aggregate.
 *
 * The periods are the UNION of what the tracks have between them, so a season in which only one
 * character did anything is still one row across the whole board and the threads stay level with
 * each other. A lane with nothing in that season renders empty rather than being dropped, which is
 * what makes the columns readable as columns.
 *
 * Tracks with no entries at all are kept as lanes: an empty column under a character's name is how
 * the reader sees there is a thread there to write in.
 *
 * @param {Array<{trackId, name, entries, actor?}>} tracks
 * @param {{canEdit?: (trackId: string) => boolean}} [opts]
 */
export function buildAggregateVM(tracks = [], opts = {}) {
	const canEdit = opts.canEdit ?? (() => false);

	// One pass over every track: the periods in play, keyed so a season shared by three tracks is
	// one row, and at the same time each track's entries bucketed under that same key.
	//
	// Bucketing here rather than filtering each track's whole list again per cell is what keeps the
	// board linear in the number of entries. Filtering per cell is periods x tracks x entries, which
	// on twenty seasons across five threads is ten thousand key builds to place five hundred cards.
	const byKey = new Map();
	const laneBuckets = new Map();
	const laneCounts = new Map();
	for (const track of tracks) {
		const entries = sortEntries(track?.entries ?? []);
		const buckets = new Map();
		laneBuckets.set(track.trackId, buckets);
		laneCounts.set(track.trackId, entries.length);
		for (const entry of entries) {
			const key = periodKey(entry);
			if (!byKey.has(key)) byKey.set(key, periodFacts(entry));
			if (!buckets.has(key)) buckets.set(key, []);
			buckets.get(key).push(entry);
		}
	}

	const periods = [...byKey.values()].sort((a, b) => a.rank - b.rank).map(period => ({
		...periodVM(period, [], {}),
		// The lane, not the block, holds the cards here: a row of this table is one season across
		// every thread, and each cell is what that thread did in it.
		lanes: tracks.map(track => {
			const entries = laneBuckets.get(track.trackId)?.get(period.key) ?? [];
			return {
				trackId: track.trackId,
				name:    track.name,
				isEmpty: !entries.length,
				entries: entries.map(e => cardVM(e, { canEdit: canEdit(track.trackId) })),
			};
		}),
	}));

	return {
		tracks: tracks.map(t => ({
			trackId:  t.trackId,
			name:     t.name,
			portrait: t.actor?.img ?? "",
			count:    laneCounts.get(t.trackId) ?? 0,
		})),
		periods,
		isEmpty: !periods.length,
	};
}

/**
 * Enrich every card's body, in place, for whichever shape the host built.
 *
 * The view model stays pure so the three hosts can build it without awaiting anything; this is the
 * one Foundry-only step, and it lives here so a card gaining a second enriched field reaches all
 * three hosts rather than whichever one was remembered.
 *
 * A card with an empty body is skipped rather than enriched to "": with auto-rows on, every ledger
 * row has one, and a season's worth of them is hundreds of round trips that can only give back what
 * they were handed. The rest go out together, since they do not depend on each other.
 *
 * @param {{periods: Array}} vm  From buildTrackVM or buildAggregateVM. Mutated in place.
 * @returns {Promise<object>} The same vm, for chaining.
 */
export async function enrichTrackVM(vm) {
	const cards = [];
	for (const period of vm?.periods ?? []) {
		for (const card of period.entries ?? []) cards.push(card);
		for (const lane of period.lanes ?? []) cards.push(...lane.entries);
	}
	await Promise.all(cards.map(async (card) => {
		card.enrichedBody = card.body ? await enrichHTML(card.body, {}) : "";
	}));
	return vm;
}
