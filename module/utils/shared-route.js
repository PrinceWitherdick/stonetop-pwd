// The route a GM has SHOWN THE PLAYERS, outside the canvas.
//
// "Draw it on the scene" puts the way on a poster-map Scene, which reaches a player only while
// that Scene is the one in front of them, and reaches a player who cannot see the map not at all.
// So the walkthrough has a second, separate press, "Show players", which stores the trip in a
// world setting every client can read (`sharedRoute`, settings.js), posts a chat card with the
// legs written out, and lights a "See the route" button on the steading sheet. Both open
// dialogs/SharedRouteWindow.js: the map with the way drawn on it, and the same legs in words.
//
// WHAT IS STORED IS THE TRIP, as on the Scene flag (utils/scene-route.js `storedJourney`), plus
// the one thing a player's client cannot find out for itself: WHICH FILE the map is. The art
// folder can only be browsed by a GM (book2-art/travel-map-art.js), but any client can load the
// file once it is told the path, so the GM's client resolves it and hands it on.
//
// NEVER THE TRIP'S NOTES. The expedition log (`expeditionAnswers`) holds the GM's prep, so nothing
// here reads it on a player's behalf; the share carries only the route and the trip's title.
//
// Everything below is pure over its arguments except `readSharedRoute`, `shareRoute` and
// `stopSharingRoute`, which are the setting's one reader and two writers.

import { getObjectSetting, setWorldSetting } from "../settings.js";
import { travelMap, travelPlace } from "../data/travel-times.js";
import {
	journeyKey, journeyRoute, normalizeJourney, routeLine, routePhrase,
	solveFrom,
} from "./travel-route.js";
import { customStops, nearestPlace } from "./custom-route.js";
import { storedJourney } from "./scene-route.js";
import { escHtml, htmlToPlainText } from "./strings.js";
import { chartedLines } from "./chronicle-core.js";
import { format, localize } from "./i18n.js";
import { journeyMapLayer } from "../dialogs/journey-map-layer.js";

/** The world setting the shared route lives in. */
export const SHARED_ROUTE_SETTING = "sharedRoute";

/** The chat-message flag a share's card carries its own copy of the route under. */
export const SHARED_ROUTE_FLAG = "sharedRoute";

/**
 * Is this a share worth showing? A stored value with an id and a journey that still solves to a
 * route. `{}` is how "nothing is shared" is written, and junk is read the same way.
 */
export function isSharedRoute(value) {
	if (!value || typeof value !== "object" || !value.id) return false;
	return !!solvedJourney(value.journey).route?.legs?.length;
}

/**
 * The share's journey solved, ONCE per journey: the one route being shown is read on every
 * steading render and every walkthrough build, and the solve is pure over the stored journey
 * (the travel table is static). `routes` (every way out of the start, for the map layer) is
 * solved only when a map asks for it.
 */
let solved = { key: undefined, journey: null, route: null, routes: null };
function solvedJourney(journey) {
	const key = JSON.stringify(journey ?? null);
	if (solved.key !== key) solved = { key, journey, route: journeyRoute(journey), routes: null };
	return solved;
}
function solvedRoutes(journey) {
	const entry = solvedJourney(journey);
	entry.routes ??= solveFrom(normalizeJourney(journey).start);
	return entry.routes;
}

/** The route the players are being shown now, or null. */
export function readSharedRoute() {
	const value = getObjectSetting(SHARED_ROUTE_SETTING);
	return isSharedRoute(value) ? value : null;
}

/**
 * What a share stores, built from the trip the GM is on, the map it is drawn across, and that
 * map's resolved file (`resolveTravelMap`), or null where the world has no copy of it.
 *
 * `frame` is stored as resolved rather than recomputed on the player's side: it can be the full
 * frame instead of the printed crop where the file turned out not to be the shape it should be,
 * and only the GM's client measured it.
 *
 * Null when the trip describes no route.
 */
export function sharedRoutePayload({ trip, tier, art = null, requirements = null, now = Date.now(), id = null } = {}) {
	const journey = storedJourney(trip?.journey);
	if (!journey) return null;
	return {
		id: id ?? globalThis.foundry?.utils?.randomID?.() ?? String(now),
		sharedAt: now,
		expeditionId: trip?.id ?? null,
		title: String(trip?.title ?? "").trim(),
		journey,
		tier: tier ?? null,
		art: art?.src
			? { src: art.src, out: art.out ?? null, frame: art.frame ?? null, aspect: art.aspect ?? null }
			: null,
		// The Chart a Course lines, when the GM chose to send them (audit ruling E4): plain words,
		// already filled, grouped as the walkthrough groups them. Absent rather than empty when not
		// sent, so a reader can tell "none were chosen" from "none were shared".
		...(Array.isArray(requirements) && requirements.length ? { requirements } : {}),
	};
}

/**
 * The trip's Chart a Course lines as the players may read them, or [] when it has none.
 *
 * WHAT GOES, and the ruling it follows (audit ruling E4; Book I p.303, "Ideally, put this someplace
 * public so the players can see it, too"): every line the GM chose, requirements then challenges,
 * with its blank filled the way the walkthrough and the Chronicle fill it, by what the GM wrote in
 * that blank or else by the route. WHAT NEVER GOES: the notes, the intro, and a GM's answer under a
 * line that has no blank, which is what they said rather than what the line says.
 *
 * Plain text, because it is read aloud: the authored lines carry `&hellip;` and the like.
 *
 * @returns {Array<{label: string, lines: string[]}>}
 */
export function sharedRequirementLines(chart, route = null) {
	// The Chronicle's own resolver (utils/chronicle-core.js), so the lines and their filled blanks are
	// the ones the walkthrough and the Chronicle print. Only the lines go, never what was `said`.
	return chartedLines(chart, route)
		.map(group => ({ label: group.label, lines: group.entries.map(entry => htmlToPlainText(entry.line)).filter(Boolean) }))
		.filter(group => group.lines.length);
}

/**
 * Where the shared route stands against the trip the GM is on, for the walkthrough's button.
 *
 *   "none"   nothing is being shown
 *   "same"   this trip's way is what the players are being shown
 *   "stale"  something else is being shown: an older way of this trip, or another trip's
 *   "orphan" something is being shown, and this trip has no route to offer instead
 *
 * "orphan" is the scene button's lesson: a share outlives the trip that made it, so the button
 * must still offer to take it back off when there is nothing on this trip to show in its place.
 */
export function sharedRouteState(shared, { expeditionId = null, journey = null, hasRoute = false, title = null, requirements = null } = {}) {
	if (!shared) return "none";
	if (!hasRoute) return "orphan";
	const sameTrip = (shared.expeditionId ?? null) === (expeditionId ?? null);
	// A RENAMED TRIP IS AN OLDER SHARE (audit RTE-12): the title heads the players' window and the
	// card, so a share made under the old name goes on announcing it. Asked only when the caller
	// says what the trip is called now; `null` means "do not compare".
	const sameTitle = title === null || String(shared.title ?? "") === String(title ?? "").trim();
	// THE CHART A COURSE LINES SENT WITH IT, when they were: the GM changing them on Chart a Course
	// leaves the players reading the old ones. Asked only when the caller passes the lines as they
	// would go out now; a share sent without them has nothing here to go stale.
	const sameLines = requirements === null || !Array.isArray(shared.requirements)
		|| JSON.stringify(shared.requirements) === JSON.stringify(requirements);
	return sameTrip && sameTitle && sameLines && journeyKey(shared.journey) === journeyKey(journey) ? "same" : "stale";
}

/** Where a share's way ends, as a name, or null where it ends at a mark of the GM's own. */
export function sharedRouteDestination(route) {
	const last = route?.legs?.at(-1);
	return last?.to ? (travelPlace(last.to)?.name ?? last.toName ?? null) : null;
}

/**
 * One leg in words, for a screen reader as much as for the eye: "Stonetop to Marshedge, 2–3 days
 * (via the Roads)". An estimated leg says "about" where the walkthrough prints a tilde, because a
 * tilde read aloud is the word "tilde".
 */
export function sharedLegLine(leg) {
	const where = `${leg.fromName} to ${leg.toName}`;
	if (!leg.time) return where;
	const time = leg.estimated ? format("stonetop.expedition.shared.estimated", { time: leg.time }) : leg.time;
	return `${where}, ${time}${leg.via ? ` (via ${leg.via})` : ""}`;
}

/**
 * Everything the players' window and card say about one share, or null when it says nothing.
 *
 * The map layer is built by the same `journeyMapLayer` the walkthrough draws from, then thinned:
 * only the places that carry the answer (where they set out, where they are bound, the stops on a
 * drawn way) and the edge arrows that name one of them. The rest are hotspots in the GM's planner,
 * and on a picture that does nothing when clicked they would be eleven unlabelled dots for a
 * screen reader to step through.
 */
/**
 * The route with every bare mark named for the PLAYERS (audit RTE-6, ruling E17).
 *
 * On the GM's side a stop the GM put down is "point 2" (or the site it was laid on), which says
 * where it is only to someone looking at the numeral on the picture. A player reading the legs
 * aloud gets nothing from that, so each one is named by what the GM typed for it when they shared
 * the way, else by the nearest place the map letters: "near the Red Grove (point 2)". The numeral
 * stays, so the words and the badge on the map are still visibly the same stop. A start the GM put
 * down by hand is what the GM typed for it (the mark's `label`), else "a point near ..." in the same way.
 *
 * A copy: the route the GM's own surfaces read is not touched.
 */
export function publicRoute(route, { startLabel = "" } = {}) {
	if (!route?.legs?.length) return route;
	const tier = route.tier ?? null;
	const stops = Array.isArray(route.stops) ? route.stops : [];
	const stopAt = spot => stops.find(stop => stop.mark && stop.spot
		&& stop.spot.fx === spot?.fx && stop.spot.fy === spot?.fy) ?? null;
	const near = spot => nearestPlace(tier, spot)?.name ?? null;
	const markName = spot => {
		const stop = stopAt(spot);
		const place = stop?.label ? null : near(spot);
		const words = stop?.label
			|| (place ? format("stonetop.expedition.shared.near", { place }) : stop?.name ?? "");
		return stop?.mark ? format("stonetop.expedition.shared.markName", { name: words, mark: stop.mark }) : words;
	};
	const startName = spot => {
		const typed = String(startLabel ?? "").trim();
		if (typed) return typed;
		const place = near(spot);
		return place ? format("stonetop.expedition.shared.startNear", { place }) : null;
	};
	const legs = route.legs.map((leg, i) => {
		const named = { ...leg };
		if (!leg.from && leg.fromSpot) {
			// The first leg setting out from a mark is the START, which has no numeral; any later
			// leg's bare end is a stop of the way.
			// `||`, as the far end: markName answers "" (not null) for a bare mark with no place near it.
			named.fromName = (i === 0 && !stopAt(leg.fromSpot) ? startName(leg.fromSpot) : markName(leg.fromSpot))
				|| leg.fromName;
		}
		if (!leg.to && leg.toSpot) named.toName = markName(leg.toSpot) || leg.toName;
		return named;
	});
	return { ...route, legs };
}

/** The share's route with its marks named for the players (`publicRoute`), or null. */
function sharedPublicRoute(payload) {
	if (!isSharedRoute(payload)) return null;
	return publicRoute(solvedJourney(payload.journey).route, { startLabel: normalizeJourney(payload.journey).start.label ?? "" });
}

/** Where a share's way ends, as the players read it, or null: without building the whole view. */
export function sharedRoutePlace(payload) {
	return sharedRouteDestination(sharedPublicRoute(payload));
}

export function sharedRouteView(payload) {
	const route = sharedPublicRoute(payload);
	if (!route) return null;
	const place = sharedRouteDestination(route);
	const title = payload.title
		|| (place
			? format("stonetop.expedition.shared.title", { place })
			: localize("stonetop.expedition.shared.titleDrawn"));
	const line = routeLine(route);
	const phrase = routePhrase(route);
	return {
		id: payload.id,
		title,
		place,
		summary: `${line}: ${phrase}`,
		total: format("stonetop.expedition.shared.total", { phrase }),
		estimated: !!route.estimated,
		estimateNote: route.estimated
			? format("stonetop.expedition.draw.estimate", { map: travelMap(route.tier)?.name ?? "" })
			: "",
		legs: route.legs.map(leg => ({ text: sharedLegLine(leg), estimated: !!leg.estimated })),
		// The Chart a Course lines the GM chose to send, as words (audit ruling E4).
		requirements: readRequirements(payload.requirements),
		map: sharedRouteMap(payload, route),
	};
}

/** A share's requirement groups, read back tolerantly: `[{ label, lines: [string] }]`. */
function readRequirements(raw) {
	return (Array.isArray(raw) ? raw : [])
		.map(group => ({
			label: String(group?.label ?? "").trim(),
			lines: (Array.isArray(group?.lines) ? group.lines : []).map(line => String(line ?? "").trim()).filter(Boolean),
		}))
		.filter(group => group.lines.length);
}

/** The thinned map layer for a share, with its alt text, or null without a picture. */
function sharedRouteMap(payload, route) {
	const art = payload.art;
	if (!art?.src) return null;
	const { start, origin, destination, custom } = normalizeJourney(payload.journey);
	// The map the share was made on, falling back to the one a drawn way is pinned to.
	const tier = payload.tier ?? custom.tier ?? null;
	if (!travelMap(tier)) return null;
	const stops = custom.on && custom.tier === tier ? customStops(start, custom) : [];
	const layer = journeyMapLayer(tier, art, {
		routes: solvedRoutes(payload.journey), route, start, origin, destination, stops, sites: [],
	});
	if (!layer) return null;
	const legs = route.legs;
	return {
		...layer,
		alt: format("stonetop.expedition.shared.alt", {
			map: travelMap(tier)?.name ?? "",
			from: legs[0]?.fromName ?? "",
			to: legs.at(-1)?.toName ?? "",
		}),
		spots: layer.spots.filter(spot => spot.showLabel),
		exits: layer.exits.filter(exit => exit.isChosen || exit.isStop),
	};
}

/**
 * The chat card's body: the way in one line, how long it takes, the legs, and the button that
 * opens the map. The button only where there is a map to open; without one the card is the whole
 * of what there is to say, and says it.
 */
export function sharedRouteCardHtml(view) {
	if (!view) return "";
	const legs = view.legs.map(leg => `<li${leg.estimated ? ` class="is-estimate"` : ""}>${escHtml(leg.text)}</li>`).join("");
	const button = view.map
		? `<button type="button" class="stonetop-shared-route-open"><i class="fas fa-route" aria-hidden="true"></i> <span class="stonetop-chip-text">${escHtml(localize("stonetop.expedition.shared.seeRoute"))}</span></button>`
		: "";
	return `<div class="card-content stonetop-shared-route-card-body">`
		+ `<p class="stonetop-shared-route-summary">${escHtml(view.total)}</p>`
		+ `<ol class="stonetop-shared-route-legs" aria-label="${escHtml(localize("stonetop.expedition.shared.legs"))}">${legs}</ol>`
		+ (view.estimateNote ? `<p class="stonetop-shared-route-estimate">${escHtml(view.estimateNote)}</p>` : "")
		+ sharedRequirementsHtml(view.requirements)
		+ button
		+ `</div>`;
}

/**
 * The Chart a Course lines a share carries, as headed plain lists, or "" when it carries none.
 * Shared by the chat card and the players' window, so the two say the same words.
 */
export function sharedRequirementsHtml(groups) {
	if (!groups?.length) return "";
	const body = groups.map(group => {
		const items = group.lines.map(line => `<li>${escHtml(line)}</li>`).join("");
		return `<p class="stonetop-shared-route-reqhead">${escHtml(group.label)}</p>`
			+ `<ul class="stonetop-shared-route-reqs" aria-label="${escHtml(group.label)}">${items}</ul>`;
	}).join("");
	return `<section class="stonetop-shared-route-requirements" aria-label="${escHtml(localize("stonetop.expedition.shared.requirements"))}">`
		+ `<p class="stonetop-shared-route-reqtitle">${escHtml(localize("stonetop.expedition.shared.requirements"))}</p>`
		+ body
		+ `</section>`;
}

/** The steading sheet's "See the route" button, or null when nothing is being shown. */
export function sharedRouteChip(shared) {
	// The tooltip needs only the summary line, not the whole view and its map layer.
	const route = sharedPublicRoute(shared);
	if (!route) return null;
	return {
		label: localize("stonetop.expedition.shared.seeRoute"),
		tooltip: format("stonetop.expedition.shared.chipTip", { summary: `${routeLine(route)}: ${routePhrase(route)}` }),
	};
}

/**
 * The steading header's chip as markup, "" when nothing is being shown: what templates/actor/steading.hbs
 * prints on a full render and SharedRouteWindow `refreshSteadingRouteChip` swaps in place.
 */
export function sharedRouteChipHtml(chip) {
	if (!chip) return "";
	return `<button type="button" class="steading-header-route" data-action="see-shared-route"`
		+ ` data-tooltip="${escHtml(chip.tooltip)}" data-tooltip-direction="DOWN">`
		+ `<i class="fas fa-route" aria-hidden="true"></i> <span class="stonetop-chip-text">${escHtml(chip.label)}</span>`
		+ `</button>`;
}

/** Show the players this route. GM only, as every world-setting write is. */
export function shareRoute(payload) {
	if (!payload) return Promise.resolve();
	return setWorldSetting(SHARED_ROUTE_SETTING, payload);
}

/** Stop showing the players any route. */
export function stopSharingRoute() {
	return setWorldSetting(SHARED_ROUTE_SETTING, {});
}
