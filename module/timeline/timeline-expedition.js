// AN EXPEDITION, ON THE TIMELINES OF EVERYONE WHO WENT.
//
// Pure: who went, where they were bound, and the row that says so. The writing is next door, in
// timeline-expedition-record.js, which reads the trip out of the expedition log and puts this row
// on each thread.
//
// WHO SAYS WHEN. The GM does. The Expedition walkthrough (dialogs/ExpeditionDialog.js) ASKS on the
// first Next into Running the Journey whether they are setting out now (stamping the season and who
// went), and on the first Next into the homecoming whether they are home (writing the row). Each step
// also keeps a control to stamp, redo or clear it. Stepping back, or jumping by the table of contents,
// is reading the walkthrough rather than making the trip, and asks nothing. The Return Triumphant move
// (actors/steading/return-triumphant.js) marks the trip triumphant once it has been made, from
// whichever surface it was opened on; from the steading sheet, only a trip that came home this
// season (timeline-expedition-record.js#cameHomeNow).
//
// ONE ROW PER TRIP PER THREAD, keyed by the trip, dated the season they came HOME (the trip is
// something that happened to them once it was over). The season they set out in is said in the row,
// so a trip that ran from summer into autumn reads that way. Returning Triumphant after the row is
// written updates its words rather than adding a second.

import { escHtml, joinNames } from "../utils/strings.js";
import { format, localize } from "../utils/i18n.js";
import { periodLabel } from "../seasons/current-season.js";
import { travelPlace } from "../data/travel-times.js";
import { normalizeJourney } from "../utils/travel-route.js";
import { customStops } from "../utils/custom-route.js";

/** Who went: every character not ticked out of this trip's party (the Outfit step's chips). */
export function expeditionParty(trip, characters = []) {
	const out = trip?.partyOut ?? {};
	return characters.filter(pc => pc?.id && !out[pc.id]);
}

/**
 * Who set out, written onto the trip the moment it sets out: `[{ id, name }]`.
 *
 * Read at the homecoming instead, a PC who died on the road had already left play and fell off the
 * row of the trip they died on, and a PC rolled up after the party left was credited with it.
 */
export function partySnapshot(trip, characters = []) {
	return expeditionParty(trip, characters).map(pc => ({ id: pc.id, name: String(pc.name ?? "") }));
}

/**
 * Who a trip's row is for: `{ actors, names }`. The party as it set out (`trip.party`), dead included,
 * less anyone ticked out since; their names off the sheet where it still exists, else as they were
 * when they left. A trip that set out before the snapshot existed falls back to everyone in play who
 * is not ticked out, which is what it always read.
 *
 * @param {object} trip
 * @param {Actor[]} allCharacters  every player character, in play or not
 * @param {Actor[]} inPlay         the characters still in play (the fallback's list)
 */
export function tripCredits(trip, allCharacters = [], inPlay = allCharacters) {
	const out = trip?.partyOut ?? {};
	if (!Array.isArray(trip?.party)) {
		const party = expeditionParty(trip, inPlay);
		return { actors: party, names: party.map(pc => pc.name) };
	}
	const byId = new Map(allCharacters.filter(pc => pc?.id).map(pc => [pc.id, pc]));
	const went = trip.party.filter(p => p?.id && !out[p.id]);
	return {
		actors: went.map(p => byId.get(p.id)).filter(Boolean),
		names:  went.map(p => byId.get(p.id)?.name || p.name).filter(Boolean),
	};
}

/**
 * Where a trip was bound, by name: the far end of a drawn way when one is ticked on, else the
 * picked destination. "" when it was bound nowhere the books name.
 *
 * Off the trip's stored journey alone, the way the route step reads it (`normalizeJourney`), so a
 * trip can be named from outside the walkthrough with nothing open.
 */
export function tripBoundToName(trip) {
	const { start, destination, custom } = normalizeJourney(trip?.journey);
	const stops = custom?.on ? customStops(start, custom) : [];
	const place = stops.length > 1 ? travelPlace(stops.at(-1).slug) : travelPlace(destination);
	return place?.name ?? "";
}

/**
 * The row an expedition writes.
 *
 * @param {object} opts
 * @param {string} opts.tripId
 * @param {string} opts.label        The trip's name as the walkthrough calls it (expeditionLabel).
 * @param {string} [opts.place]      Where they were bound, by name.
 * @param {{season: string, year: number}|null} [opts.setOut]  When they left, if it was stamped.
 * @param {boolean} [opts.triumphant]  They Returned Triumphant.
 * @param {string[]} [opts.partyNames]
 * @param {boolean} [opts.redate]  The GM said they came home NOW: the row moves to this season.
 * @param {string|null} [opts.retitleFrom]  The title this trip's rows were last written with. A row
 *        still wearing it takes the trip's new name; one the GM retitled keeps theirs.
 */
export function expeditionMilestone({ tripId, label, place = "", setOut = null, triumphant = false, partyNames = [], redate = false, retitleFrom = null } = {}) {
	const lines = [];
	if (setOut?.season) lines.push(format("stonetop.timeline.milestone.expeditionSetOut", { when: periodLabel(setOut) }));
	if (partyNames.length) lines.push(format("stonetop.timeline.milestone.expeditionParty", { names: joinNames(partyNames) }));
	if (triumphant) lines.push(localize("stonetop.timeline.milestone.expeditionTriumphant"));
	const title = String(label ?? "");
	// The words may change after the row is written (a triumph, a renamed destination). The date
	// moves only when the GM redoes the homecoming, and the title only while it is still ours.
	const refresh = ["body", "place"];
	if (redate) refresh.push("season", "year");
	const retitle = typeof retitleFrom === "string" && retitleFrom !== title;
	if (retitle) refresh.push("title");
	return {
		// The row's id is the trip's, not a random one: two GMs recording the same homecoming at once
		// each add it under the same id, which the keyed page holds as one row, not two.
		id:     `expedition-${tripId}`,
		source: "expedition",
		key:    `expedition:${tripId}`,
		// Just the trip's name: the card's Expedition chip already says what kind of row it is.
		title,
		place:  String(place ?? ""),
		body:   lines.map(line => `<p>${escHtml(line)}</p>`).join(""),
		refresh,
		...(retitle ? { refreshWhile: { title: retitleFrom } } : {}),
	};
}
