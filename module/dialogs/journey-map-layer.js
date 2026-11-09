// Everything drawn ON one regional map: the route line, a hotspot per place, the edge arrows, a
// hand-placed start and the numbered marks of a way drawn by hand.
//
// PURE, and out of ExpeditionDialog for that reason. Two kinds of reader draw this layer: the GM's
// walkthrough (and its "See the whole map" window), and the route a GM has shown the players
// (dialogs/SharedRouteWindow.js), which runs on a player's client with no walkthrough behind it.
// One builder, so a pin stands in the same valley and means the same thing on every surface.
//
// The GM's own sites are NOT built here. They are prep filed in a journal players cannot read, so
// the walkthrough builds them itself and hands them in as `sites`; a player's view passes none.

import { travelMap, placesOnMap, exitsOnMap, spotPercent } from "../data/travel-times.js";
import { formatTravelTime } from "../utils/travel-route.js";
import { offMapNote, routePath } from "../utils/route-path.js";
import { offMapNames } from "../utils/scene-route.js";
import { startMark, startTier } from "../utils/journey-start.js";
import { format, localize } from "../utils/i18n.js";

/**
 * Where a pin hangs its label, given where the pin itself sits on the picture.
 *
 * Both anchors read the same way: a label near an edge hangs INWARD, so it cannot spill out of the
 * picture and give whatever is showing it a horizontal scrollbar.
 *
 * Shared by every family of mark — the book's places, its edge arrows and the GM's own sites — so
 * there is one copy of these four numbers and a label lands on the same side of every pin.
 */
export function pinAnchors(left, top) {
	return {
		anchorH: left > 78 ? "right" : left < 22 ? "left" : "centre",
		anchorV: top > 84 ? "above" : "below",
	};
}

/**
 * A destination's travel time, for a pin label or a list row.
 *
 * TILDED WHERE ANY OF IT WAS MEASURED, which is the same mark the readout's own leg list wears and
 * it means the same thing: a journey setting out from a point the GM put down joins the book's
 * roads across a leg this system measured off the map (see `solveFrom`), so its total is the book's
 * times plus a guess.
 */
export function timeLabel(routes, slug) {
	const route = routes?.get?.(slug);
	if (!route?.legs?.length) return null;
	return `${route.estimated ? "~" : ""}${formatTravelTime(route.total)}`;
}

/**
 * The mark a hand-placed start stands at on one map, or null.
 *
 * ONLY ON ITS OWN MAP. The fraction it is stored as means one valley on the Vicinity and quite
 * another on the World's End, so the other tab draws nothing and the readout says where the
 * journey is instead (see `offMapNote`).
 *
 * IT WEARS "setting out" AND NOT ITS OWN NAME, because its name is "a point on The Vicinity" and
 * that is a sentence about the map rather than a label to stand on it.
 */
export function startPin(tier, frame, start) {
	const mark = startMark(start);
	if (!mark || startTier(start) !== tier) return null;
	const { left, top } = spotPercent(mark, frame);
	return {
		left, top,
		label: localize("stonetop.expedition.start.pinLabel"),
		...pinAnchors(left, top),
	};
}

/**
 * The off-map note with its prose already written, or null when the line drew fine.
 *
 * `offMapNote` answers in slugs and names; turning that into a sentence is this layer's job, and
 * doing it here rather than in the partial is what lets the "Show <other map>" button be the only
 * markup the template owns.
 */
export function offMapReadout(note) {
	if (!note) return null;
	const places = offMapNames(note);
	return {
		...note,
		// A route pinned to the other tab is not a place gone missing, and saying so would send the
		// reader hunting for one. It is fractions of the map it belongs to; naming that map, with the
		// button back to it, is the whole of the answer. WHICH pinning, though: the GM drew this way
		// on that map, or the party is standing on it. `drawn` tells them apart.
		sentence: note.elsewhere
			? format(
				note.drawn
					? "stonetop.expedition.route.panelDrawnOn"
					: "stonetop.expedition.route.panelStartOn",
				{ map: note.otherName ?? "" },
			)
			: places
				? format("stonetop.expedition.route.panelOffMap", { places })
				: localize("stonetop.expedition.route.panelNoMap"),
		showLabel: note.otherName
			? format("stonetop.expedition.route.panelShow", { map: note.otherName })
			: "",
	};
}

/**
 * Everything drawn on one map, ready for the pin layer: the picture's own registration, the route
 * line, and a hotspot per place.
 *
 * Built for a NAMED tier rather than for whichever one a surface is showing, because several
 * surfaces draw it and they can be looking at different maps.
 *
 * Returns null when there is no picture (`art`), which is the ordinary state of a world that never
 * imported the book art.
 *
 * `stops` is the hand-drawn way's own run of stops when there is one, which changes what some of
 * the marks MEAN rather than adding a fourth kind: a lettered place standing on the drawn way wears
 * its name and its number, and the far end of that way is where the party is bound whether or not
 * anything was ever picked from the list.
 *
 * @param {string} tier   which map
 * @param {object|null} art  `{ src, frame, aspect, ... }` for the file on screen
 * @param {object} opts
 * @param {Map}    opts.routes       the table solved from this trip's start, for pin times
 * @param {object|null} opts.route   the way they are going (`journeyRoute`)
 * @param {object} opts.start        where they set out from (`normalizeJourney().start`)
 * @param {string|null} opts.origin  that start's slug, when it is a lettered place
 * @param {string|null} opts.destination
 * @param {Array}  [opts.stops]      a drawn way's stops on THIS map (`customStops`)
 * @param {Array}  [opts.sites]      the GM's own site pins, already built; none for a player
 */
export function journeyMapLayer(tier, art, { routes, route, start, origin, destination, stops = [], sites = [] }) {
	if (!art) return null;
	const path = routePath(route, tier, art.frame, art.aspect);
	// Which lettered places stand on the drawn way. The origin is skipped: it is already drawn as
	// the origin, and calling it a stop as well would label it twice over.
	const onWay = new Set(stops.slice(1).map(stop => stop.slug).filter(Boolean));
	// The end of a drawn way is where they are bound. Falls back to the picked destination, which is
	// what it means with no way drawn.
	const bound = stops.length > 1 ? stops.at(-1).slug : destination;
	return {
		...art,
		tier,
		alt: `${travelMap(tier)?.name ?? "The region"}, from the Stonetop rulebooks`,
		path,
		// Only ever set when there is no line: what the reader gets instead of one.
		offMap: path ? null : offMapReadout(offMapNote(tier, route)),
		// Where they set out from, when that is a point the GM put down rather than a place the
		// books lettered. A lettered start is already drawn by its own pin below.
		start: startPin(tier, art.frame, start),
		// The bare marks of a hand-drawn way, each wearing the number the readout calls it by. Only
		// the ones the GM put down: a stop that landed on a lettered place is drawn by that place's
		// own pin below, lit up, rather than by a second mark on top of it.
		marks: stops
			.map((stop, i) => ({ stop, at: i }))
			.filter(({ stop }) => stop.mark && stop.spot)
			.map(({ stop, at }) => {
				const { left, top } = spotPercent(stop.spot, art.frame);
				// NO ANCHOR: a numeral has no name to hang, and stays inside the frame by being small.
				return { mark: stop.mark, left, top, isEnd: at === stops.length - 1 };
			}),
		spots: placesOnMap(tier).map(place => {
			const { left, top } = spotPercent(place.spots[tier], art.frame);
			const time = timeLabel(routes, place.slug);
			const isOrigin = place.slug === origin;
			const isChosen = place.slug === bound;
			const isStop = onWay.has(place.slug);
			return {
				slug: place.slug, name: place.name, left, top, time, isOrigin, isChosen, isStop,
				// Labels only where they carry the answer, so eleven of them cannot collide.
				showLabel: isOrigin || isChosen || isStop,
				tooltip: isOrigin ? `${place.name}, setting out` : time ? `${place.name}, ${time}` : place.name,
				...pinAnchors(left, top),
			};
		}),
		exits: exitsOnMap(tier).map(exit => {
			const { left, top } = spotPercent(exit, art.frame);
			const time = exit.node ? timeLabel(routes, exit.node) : null;
			return {
				...exit, left, top, time,
				isChosen: !!exit.node && exit.node === bound,
				isStop: !!exit.node && onWay.has(exit.node),
				tooltip: exit.node
					? `${exit.label}${time ? `, ${time}` : ""}`
					: `Zoom out to ${travelMap(exit.to)?.name ?? "the wider map"}`,
				...pinAnchors(left, top),
			};
		}),
		// The GM's own prep, on the same picture and by the same arithmetic. Last, because it is the
		// only one that is not the books'.
		sites,
	};
}
