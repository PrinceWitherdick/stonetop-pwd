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
// stylesheet and fails on a fifth. A period's heading IS coloured by its season (user's call,
// 2026-10-01, so the seasons are easy to spot), but with the timeline's OWN four colours
// (`--st-timeline-season-*`), and its name and glyph still say which season it is. See
// season-inks-exclusive.

import { SEASON_IDS, seasonLabel } from "../seasons/seasons-change-reminders.js";
import { yearLabel } from "../seasons/seasons-chronicle.js";
import { yearsAgo } from "../seasons/campaign-year.js";
import { periodLabel } from "../seasons/current-season.js";
import { localize, format } from "../utils/i18n.js";
import { enrichHTML } from "../utils/foundry-compat.js";
import {
	TIMELINE_CARD_SOURCES, TIMELINE_KILLS_SOURCE, TIMELINE_SEASON_SOURCE, UNDATED_PERIOD_KEY, foeLines,
	groupByPeriod, killTotal, periodFacts, periodKey, periodRank, readEntries, sortEntries,
} from "./timeline-core.js";
import { customTagStyle, filterKey, indexCustomTags, isKindTag, liveTag } from "./timeline-tags.js";

/**
 * What each kind of row is called and the glyph it wears, in the card's chip and in the reader's
 * "Filter" menu. A kind is ALWAYS named in words beside its glyph: an icon alone is a guess for a
 * reader on a magnifier, and the chip is the one thing that says a row was written by the system.
 *
 * ⚠ NO SEASON-NAMED KEYS OR CLASSES. The Seasons Change row is not a card at all: it prints inside
 * its season's heading (`seasonNotes`, below), so it has no chip, no colour and no Filter line.
 */
export const KIND_META = {
	hand:       { icon: "fa-feather-pointed" },
	levelup:    { icon: "fa-angles-up" },
	kills:      { icon: "fa-skull" },
	expedition: { icon: "fa-person-hiking" },
	site:       { icon: "fa-mountain-sun" },
	death:      { icon: "fa-door-open" },
	wound:      { icon: "fa-bandage" },
	arcana:     { icon: "fa-wand-sparkles" },
	follower:   { icon: "fa-user-group" },
};

/** The chip on one card: its glyph and its name. */
export function kindChip(source) {
	const kind = KIND_META[source] ? source : "hand";
	return { kind, icon: KIND_META[kind].icon, label: localize(`stonetop.timeline.kind.${kind}`), style: "" };
}

/** The glyph every custom tag wears. Its name and colour are what tell one from another. */
export const CUSTOM_TAG_ICON = "fa-tag";

/** A custom tag's chip: its name in its colour, `kind` "custom", the colour in `style`. */
export function customTagChip(tag) {
	return { kind: "custom", icon: CUSTOM_TAG_ICON, label: tag.name, style: customTagStyle(tag.colour) };
}

/**
 * The chip a TYPED row wears for its tag, or null for none: a borrowed kind's own chip, or a custom
 * tag's name in its colour (`kind` "custom", the colour in `style`). See timeline-tags.js.
 */
export function tagChip(entry, tagIndex) {
	const tag = liveTag(entry, tagIndex);
	if (!tag) return null;
	if (isKindTag(tag)) return kindChip(tag);
	return customTagChip(indexCustomTags(tagIndex).get(tag));
}

/**
 * Every kind the "Filter" menu offers, in TIMELINE_CARD_SOURCES order, each marked shown or hidden for
 * this reader, and then the world's custom tags by name. A custom tag's line hides the typed rows
 * wearing it; `source` is its id, which is what the reader's hidden list stores.
 *
 * @param {string[]} hidden  The sources (and custom tag ids) this reader unticked.
 * @param {Array<{id, name, colour}>} [tags]  The world's custom tags.
 */
export function kindMenu(hidden = [], tags = []) {
	const off = new Set(hidden);
	const kinds = TIMELINE_CARD_SOURCES.map(source => ({
		source,
		kind:  source,
		icon:  KIND_META[source]?.icon ?? KIND_META.hand.icon,
		label: localize(`stonetop.timeline.show.${source}`),
		style: "",
		shown: !off.has(source),
	}));
	const custom = [...indexCustomTags(tags).values()].map(tag => ({
		source: tag.id,
		...customTagChip(tag),
		shown:  !off.has(tag.id),
	}));
	return [...kinds, ...custom];
}

/**
 * The aggregate's threads, as the "Filter" menu's second section offers them: every track, in the
 * board's own order, each marked shown or hidden for this reader. A steading's thread wears the
 * house, a character's the figure, so the two read apart before the name is read.
 *
 * @param {Array<{trackId, trackKind?, name}>} tracks  Every track, hidden or not.
 * @param {string[]} [hiddenTracks]  The track ids this reader unticked.
 */
export function threadMenu(tracks = [], hiddenTracks = []) {
	const off = new Set(hiddenTracks);
	return tracks.map(track => ({
		trackId: track.trackId,
		icon:    track.trackKind === "steading" ? "fa-house-chimney" : "fa-user",
		label:   track.name,
		shown:   !off.has(track.trackId),
	}));
}

/**
 * The threads a PLAYER'S aggregate hides before they have chosen any (user, 2026-10-03): every one
 * but their own characters', so the full timeline opens on their own story and the Filter menu's
 * count says the rest is there to tick back on. Stonetop's thread is never "theirs", even for a
 * player who owns the steading. A reader with no character of their own hides nothing: a board of
 * nothing but a filter would read as a broken one.
 *
 * @param {Array<{trackId, trackKind?}>} tracks  Every track on the board.
 * @param {(track) => boolean} ownsTrack  Is this thread one of the reader's characters?
 * @returns {string[]} The track ids to hide.
 */
export function defaultHiddenTracks(tracks = [], ownsTrack = () => false) {
	const mine = new Set(tracks
		.filter(track => track.trackKind !== "steading" && ownsTrack(track))
		.map(track => track.trackId));
	if (!mine.size) return [];
	return tracks.map(track => track.trackId).filter(id => !mine.has(id));
}

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
 * The classes a season's HEADING wears to take that season's colour: the shared shape and the one
 * season's modifier. Empty for the undated block, which has no season and stays uncoloured.
 * Named for the clock's own ids ("autumn"), unlike the glyph above: no art file is involved.
 */
export function seasonColourClass(seasonId) {
	if (!SEASON_IDS.includes(seasonId)) return "";
	return `stonetop-timeline-season stonetop-timeline-season--${seasonId}`;
}

/** A kills row's foes as one line: "Crinwin ×3, Bandit Chief". */
export function killSummaryText(foes) {
	return foeLines(foes).join(", ");
}

/** One entry, ready to print. `body` stays raw for the host to enrich. */
function cardVM(entry, { canEdit = false, tags = null } = {}) {
	const isAuto = entry.source !== "hand";
	// A typed row wears a chip only when it carries a tag; a milestone always wears its kind's.
	const chip = isAuto ? kindChip(entry.source) : tagChip(entry, tags);
	const isKills = entry.source === TIMELINE_KILLS_SOURCE;
	const killCount = isKills ? entry.foes.length : 0;
	return {
		id:        entry.id,
		// A kills row the GM never titled reads as what it is, counted.
		title:     entry.title || (isKills ? format("stonetop.timeline.kills.title", { count: killCount }) : ""),
		place:     entry.place,
		placeUuid: entry.placeUuid,
		// Only a place that IS a document gets a link. Everything else is a name somebody typed,
		// and a link to nowhere reads as a broken one.
		placeLinked: !!entry.placeUuid,
		body:      entry.body,
		kind:      chip?.kind ?? "hand",
		kindIcon:  chip?.icon ?? KIND_META.hand.icon,
		kindLabel: chip?.label ?? "",
		// A custom tag's colour, one value per skin (timeline-tags.js#customTagStyle). "" otherwise.
		kindStyle: chip?.style ?? "",
		// A row the system wrote for itself rather than one somebody typed. It wears its kind's chip,
		// so a reader can always tell the record from what they wrote. Every row is STORED, so an
		// auto row is edited and removed exactly like a typed one.
		isAuto,
		// A TYPED row wearing a tag: the same chip and colour, on a row somebody wrote.
		isTagged:  !isAuto && !!chip,
		wearsChip: !!chip,
		killSummary: isKills ? killSummaryText(entry.foes) : "",
		canEdit,
	};
}

/** Is this the row a Seasons Change wrote, which prints in its season's heading rather than as a card? */
export function isSeasonRow(entry) {
	return entry?.source === TIMELINE_SEASON_SOURCE;
}

/**
 * A Seasons Change row, as its season's HEADING prints it: the gains, the Surplus and any notes
 * (the body timeline-season-entry.js wrote, or whatever a GM rewrote it to), under the season's name.
 *
 * The title is printed only where a GM changed it: as written it IS the season's name, which the
 * heading has just said. `trackId` rides along because a heading on the aggregate sits in no lane,
 * and the window's delegated listener reads the thread a click belongs to off the nearest one.
 */
function seasonNoteVM(entry, { canEdit = false, trackId = "" } = {}) {
	const title = String(entry.title ?? "").trim();
	return {
		id:      entry.id,
		trackId,
		title:   title && entry.season && title !== seasonLabel(entry.season) ? title : "",
		body:    entry.body,
		canEdit,
	};
}

/** A note with nothing to print and no way to write in it would be an empty box in the heading. */
function noteHasRoom(note) {
	return !!(note.title || note.body || note.canEdit);
}

/**
 * How long before now a period from BEFORE PLAY was: "10 years ago". Only history wears it (a stored
 * year below 1); a season the table played through is placed by its own date, and every one of them
 * saying how long ago it was would bury the headings in arithmetic.
 *
 * @param {number|null} year     The period's stored year; null for the undated block.
 * @param {number}      nowYear  The stored year the clock is in.
 */
export function agoLabel(year, nowYear) {
	if (year === null || year >= 1) return "";
	// The clock never reads below 1, so a year from before play is always at least one year back.
	const back = Math.max(1, yearsAgo(year, nowYear));
	return back === 1 ? localize("stonetop.timeline.yearAgo") : format("stonetop.timeline.yearsAgo", { count: back });
}

/** One period block, with whatever it holds. `startsYear` and `above` are set by the builders. */
function periodVM(period, entries, opts, seasonNotes = []) {
	const undated = period.key === UNDATED_PERIOD_KEY;
	return {
		key:         period.key,
		label:       periodLabel(period),
		// A year whose season nobody remembers says so where the season's name would be.
		seasonLabel: period.season ? seasonLabel(period.season)
			: (period.yearOnly ? localize("stonetop.timeline.seasonUnknown") : ""),
		yearLabel:   undated ? "" : yearLabel(period.year),
		agoLabel:    undated ? "" : agoLabel(period.year, opts.nowYear ?? 1),
		// null for the undated block: 0 is a real year (the one before play began).
		year:        undated ? null : period.year,
		yearOnly:    !!period.yearOnly,
		// A year with nothing written in it, opened only so an Age's band has its first or last year
		// to lie under (`withAgeMarks`): its year chip is drawn, and no season after it.
		ageMark:     !!period.ageMark,
		glyphClass:  seasonGlyphClass(period.season),
		seasonClass: seasonColourClass(period.season),
		undated,
		startsYear:  false,
		above:       true,
		entries:     entries.map(e => cardVM(e, opts)),
		// What the Seasons Change recorded, printed inside the heading (timeline-period-head.hbs).
		seasonNotes,
	};
}

/**
 * Mark where each year begins, and which side of a sideways axis each period's cards hang on.
 *
 * A year heading opens at the first dated period and wherever the year moves on, so a long campaign
 * reads in years first and seasons within them. The undated block is before every year and opens
 * none. Sides alternate period by period, the slide-deck timeline the reader asked for: one season's
 * cards above the line, the next season's below, so neighbours never crowd each other.
 */
function markYearsAndSides(periods) {
	let lastYear = null;
	// An Age's bare year has no cards to hang, so it takes no turn in the alternation.
	let side = 0;
	periods.forEach((period) => {
		if (!period.ageMark) period.above = side++ % 2 === 0;
		if (period.undated) return;
		period.startsYear = period.year !== lastYear;
		lastYear = period.year;
	});
	return periods;
}

/**
 * The periods with a bare year added for each of `years` (stored) that none of them is in: what
 * lets an Age whose first or last year nobody wrote anything in still be drawn (user, 2026-10-07:
 * "show an age even without timeline entries"). Its key is its own, never a real period's, and it
 * ranks where a year-only period of that year would, before its Spring.
 *
 * @param {Array<{year: number|null, rank: number}>} periods  Period facts, any order.
 * @param {number[]} years
 * @returns {Array}  Sorted by rank, the marks holding no entries.
 */
export function withAgeMarks(periods, years = []) {
	const have = new Set(periods.map(period => period.year).filter(year => year !== null));
	const marks = [];
	for (const year of new Set(years)) {
		if (!Number.isFinite(year) || have.has(year)) continue;
		marks.push({
			key: `${year}:${AGE_MARK_PERIOD}`, year, season: "", yearOnly: false, ageMark: true,
			rank: periodRank({ year, yearOnly: true }), entries: [],
		});
	}
	// Sorted even with no marks: the full timeline hands in its periods in the order the tracks
	// first met them, and leans on this for chronology.
	return [...periods, ...marks].sort((a, b) => a.rank - b.rank);
}

/** The suffix on an Age's bare year's key ("-40:age"), apart from the year-only period's "year". */
const AGE_MARK_PERIOD = "age";

/**
 * One track as its own timeline: every period it has anything in, oldest first.
 *
 * `count` and `killTotal` are of the WHOLE track, before the reader's filter: hiding kills must not
 * make a character read as never having killed anything, and an empty track is told apart from a
 * fully filtered one (`isEmpty` against `allHidden`). Nothing prints `killTotal` at present (the
 * toolbar's "N slain" chip came off at the user's request, 2026-10-03); it is kept for when it returns.
 *
 * @param {{trackId, name, entries, actor?}} track
 * @param {{canEdit?: boolean, hidden?: string[], tags?: Array, nowYear?: number, ageYears?: number[]}} [opts]
 *        `tags` = the world's custom tags (timeline-tag-store.js#worldCustomTags); a typed row wearing
 *        one it cannot find wears none. `nowYear` = the clock's stored year, which history's "N years
 *        ago" counts from. `ageYears` = the stored years an Age starts or ends in, each given a bare
 *        year if nothing is written in it (timeline-ages.js#ageMarkYears).
 */
export function buildTrackVM(track, opts = {}) {
	const all = readEntries(track?.entries ?? []);
	const off = new Set(opts.hidden ?? []);
	const tags = indexCustomTags(opts.tags);
	// A season's own row is never filtered: it is no card, and it has no line in the Filter menu to
	// bring it back by (a reader who hid "Seasons Change" before it moved keeps that in their setting).
	// One with nothing to print is dropped instead, so it opens no empty season.
	const noteOpts = { canEdit: !!opts.canEdit, trackId: track?.trackId ?? "" };
	const shown = all.filter(e => isSeasonRow(e)
		? noteHasRoom(seasonNoteVM(e, noteOpts))
		: !off.has(filterKey(e, tags)));
	const periods = withAgeMarks(groupByPeriod(shown), opts.ageYears);
	const cardOpts = { ...opts, tags };
	return {
		trackId:   track?.trackId ?? "",
		name:      track?.name ?? "",
		portrait:  track?.actor?.img ?? "",
		isEmpty:   !all.length,
		allHidden: all.length > 0 && !shown.length,
		count:     all.length,
		killTotal: killTotal(all),
		periods:   markYearsAndSides(periods.map(p => periodVM(
			p,
			p.entries.filter(e => !isSeasonRow(e)),
			cardOpts,
			p.entries.filter(isSeasonRow).map(e => seasonNoteVM(e, noteOpts)),
		))),
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
 * TWO SHAPES OF THE SAME CELLS. `periods[].lanes[]` is the board read down (a row per season), and
 * `swimlanes[].cells[]` is it read across (a row per thread, a column per season). Handlebars cannot
 * index one by the other, so the transposition happens here -- and the cells are the SAME objects in
 * both, so enriching one shape enriches the other.
 *
 * A Seasons Change row goes to its season's HEADING, not its thread's lane: the heading spans the
 * whole board, and what Stonetop put its season into is the season's news. It still belongs to its
 * thread, so hiding Stonetop's thread hides it with the rest of that thread.
 *
 * A thread the reader unticked in the Filter menu (`hiddenTracks`) is dropped whole: no head, no
 * lane, and a season only it had anything in goes with it. Its rows still count towards `isEmpty`,
 * so a board whose every written thread is hidden reads as filtered (`allHidden`), not as unwritten.
 *
 * @param {Array<{trackId, name, entries, actor?}>} tracks
 * @param {{canEdit?: (trackId: string) => boolean, hidden?: string[], hiddenTracks?: string[],
 *          tags?: Array, nowYear?: number, ageYears?: number[]}} [opts]  `ageYears` as buildTrackVM's.
 */
export function buildAggregateVM(allTracks = [], opts = {}) {
	const canEdit = opts.canEdit ?? (() => false);
	const off = new Set(opts.hidden ?? []);
	const offTracks = new Set(opts.hiddenTracks ?? []);
	const tags = indexCustomTags(opts.tags);
	const tracks = allTracks.filter(track => !offTracks.has(track?.trackId));
	// Every thread's rows, hidden or not: what tells "nothing written" from "all of it filtered".
	// The shown threads add theirs in the pass below; a hidden thread is only counted.
	let total = 0;
	for (const track of allTracks) {
		if (offTracks.has(track?.trackId)) total += readEntries(track?.entries ?? []).length;
	}

	// One pass over every track: the periods in play, keyed so a season shared by three tracks is
	// one row, and at the same time each track's entries bucketed under that same key.
	//
	// Bucketing here rather than filtering each track's whole list again per cell is what keeps the
	// board linear in the number of entries. Filtering per cell is periods x tracks x entries, which
	// on twenty seasons across five threads is ten thousand key builds to place five hundred cards.
	const byKey = new Map();
	const laneBuckets = new Map();
	const laneFacts = new Map();
	const notesByKey = new Map();
	for (const track of tracks) {
		const all = sortEntries(track?.entries ?? []);
		total += all.length;
		const buckets = new Map();
		laneBuckets.set(track.trackId, buckets);
		laneFacts.set(track.trackId, { count: all.length });
		for (const entry of all) {
			const note = isSeasonRow(entry)
				? seasonNoteVM(entry, { canEdit: canEdit(track.trackId), trackId: track.trackId })
				: null;
			if (note ? !noteHasRoom(note) : off.has(filterKey(entry, tags))) continue;
			const key = periodKey(entry);
			if (!byKey.has(key)) byKey.set(key, periodFacts(entry));
			if (note) {
				if (!notesByKey.has(key)) notesByKey.set(key, []);
				notesByKey.get(key).push(note);
				continue;
			}
			if (!buckets.has(key)) buckets.set(key, []);
			buckets.get(key).push(entry);
		}
	}

	// Whether anything written is SHOWN, asked before an Age's bare years are added: a board of
	// nothing but those is still a board the Filter menu has emptied.
	const written = byKey.size;
	const periods = markYearsAndSides(withAgeMarks([...byKey.values()], opts.ageYears).map(period => ({
		...periodVM(period, [], { nowYear: opts.nowYear }, notesByKey.get(period.key) ?? []),
		// The lane, not the block, holds the cards here: a row of this table is one season across
		// every thread, and each cell is what that thread did in it.
		lanes: tracks.map(track => {
			const entries = laneBuckets.get(track.trackId)?.get(period.key) ?? [];
			return {
				trackId: track.trackId,
				name:    track.name,
				isEmpty: !entries.length,
				entries: entries.map(e => cardVM(e, { canEdit: canEdit(track.trackId), tags })),
			};
		}),
	})));

	// Read across, a cell opens the year its season does: the swimlanes draw that year's rule before it.
	for (const period of periods) {
		for (const lane of period.lanes) {
			lane.opensYear = period.startsYear;
			// An Age's bare year: its rule is drawn, and no cell after it.
			lane.ageMark = period.ageMark;
		}
	}

	const heads = tracks.map(t => ({
		trackId:  t.trackId,
		name:     t.name,
		portrait: t.actor?.img ?? "",
		playbook: t.playbook ?? "",
		count:    laneFacts.get(t.trackId)?.count ?? 0,
	}));

	return {
		tracks: heads,
		periods,
		swimlanes: heads.map((head, index) => ({ ...head, cells: periods.map(period => period.lanes[index]) })),
		isEmpty:   total === 0,
		allHidden: total > 0 && !written,
	};
}

/**
 * Enrich every card's body, in place, for whichever shape the host built.
 *
 * The view model stays pure so the three hosts can build it without awaiting anything; this is the
 * one Foundry-only step, and it lives here so a card gaining a second enriched field reaches all
 * three hosts rather than whichever one was remembered.
 *
 * A card with an empty body is skipped rather than enriched to "": most milestone rows have none,
 * and a campaign's worth of them is hundreds of round trips that can only give back what they were
 * handed. The rest go out together, since they do not depend on each other.
 *
 * @param {{periods: Array}} vm  From buildTrackVM or buildAggregateVM. Mutated in place.
 * @returns {Promise<object>} The same vm, for chaining.
 */
export async function enrichTrackVM(vm) {
	const cards = [];
	for (const period of vm?.periods ?? []) {
		for (const card of period.entries ?? []) cards.push(card);
		for (const lane of period.lanes ?? []) cards.push(...lane.entries);
		// A season's notes in its heading carry a body like a card's, and are enriched the same way.
		cards.push(...(period.seasonNotes ?? []));
	}
	await Promise.all(cards.map(async (card) => {
		card.enrichedBody = card.body ? await enrichHTML(card.body, {}) : "";
	}));
	return vm;
}
