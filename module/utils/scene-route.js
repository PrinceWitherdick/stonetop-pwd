// Putting an expedition's route onto the GM's own Scene of the same poster map.
//
// The walkthrough already draws the way they go, over a picture of the map inside a dialog. This
// is the same line on the table's map: the Scene the party is looking at, at the size the whole
// room can see, with the route running across it in the same cream ribbon and red beads.
//
// WHAT IS STORED IS THE TRIP, NOT THE LINE. The Scene carries a flag naming two places, and every
// client works the geometry out again from the travel graph. That is the same choice the trip's
// own record makes and for the same reason (see `expeditionAnswers` in settings.js): the graph is
// frozen compile-time data, so recomputing costs nothing, there is no snapshot to migrate, and a
// correction to the travel table reaches a route already on a Scene the next time anything draws
// it. It also means the line survives a GM resizing the Scene, which a saved run of pixels would
// not.
//
// WHY IT CAN REFUSE. A fraction like 0.708 means "70.8% of the way across the Vicinity", and it
// means nothing at all anywhere else. So this asks three questions before it will draw: is this
// Scene one of the poster maps, is it one of the two that the travel table charts courses across,
// and is its picture the SHAPE those fractions were measured against. Each has its own answer for
// the GM, because "nothing happened" is the one response none of them deserves.
//
// The arithmetic is in utils/route-path.js, shared with the dialog. The painting is in
// hooks/ExpeditionRouteOverlay.js. This module is the middle: what a Scene is allowed to show, and
// where on it the marks go.

import { SYSTEM_ID } from "../system-id.js";
import { format, localize } from "./i18n.js";
import { joinNames } from "./strings.js";
import {
	flagScopes, posterMapFor, posterMapSlugOf, sceneOrigin, scopedFlag,
} from "../book2-art/poster-map-catalog.js";
import { frameFitsImage, frameFor, travelMap, travelPlace } from "../data/travel-times.js";
import { MAP_PIN_ICON_SIZE } from "./map-pins.js";
import { journeyRoute, normalizeJourney } from "./travel-route.js";
import { offMapNote, routeDots, routePath, tierDrawing } from "./route-path.js";

/** The Scene flag one route lives in. */
export const SCENE_ROUTE_FLAG = "expeditionRoute";

/**
 * How heavily the line is drawn, in Scene pixels.
 *
 * ABSOLUTE RATHER THAN A SHARE OF THE MAP, to match the pins already standing on it: a marker's
 * icon is a flat MAP_PIN_ICON_SIZE on these Scenes because the poster maps are all built at one
 * fixed width. A route sized as a percentage would read as one drawing with those pins on the
 * Scene the catalog builds and as a different one on any other, which is the wrong way round: the
 * pins and the line are the same annotation layer and should hold their proportions to each other
 * before they hold anything to the picture.
 *
 * DERIVED FROM THAT ICON rather than written out beside it. The ribbon is a bit under half a pin
 * wide, which is what makes the line read as belonging to the same hand at any zoom — and a bare
 * 28 could not say so, so re-tuning the pins moved them out from under a route that stayed where
 * it was. tests/utils/scene-route.test.js holds the pair together.
 *
 * The proportions the three keep are the walkthrough's own, scaled up together. There the line is
 * one SVG stroke wearing `stroke-dasharray: 0.1 7`: a 7px cream stroke dashed so finely that it
 * reads as a continuous ribbon, with 3.5px red dots riding down the middle of it one stroke-width
 * apart. So the bead is half the ribbon and the gap is the ribbon, which is what these keep.
 */
export const ROUTE_CASE_WIDTH = MAP_PIN_ICON_SIZE * 0.4;
// DERIVED, not three magic numbers: the bead is half the ribbon and the gap is the ribbon, which
// is exactly what the walkthrough's `stroke-dasharray: 0.1 7` on a 7px case amounts to. Writing
// the relationship instead of the results is what keeps a change to the width carrying the other
// two with it.
export const ROUTE_DOT_SIZE = ROUTE_CASE_WIDTH / 2;
export const ROUTE_DOT_GAP = ROUTE_CASE_WIDTH;

/**
 * The arrowheads, on the same terms: absolute Scene pixels, sized against the pin standing beside
 * them rather than against the map. One short of every stop the route arrives at, the last of them
 * on the destination; the destination's is the larger, so it stays the loudest mark on the line
 * rather than becoming one of a row of identical chevrons.
 *
 * WRITTEN OUT rather than scaled off the ribbon, which the walkthrough's own two sizes (15px and
 * 11px on its 7px stroke, in styles/stonetop.css) would put at 60 and 44. These are a touch
 * heavier than that on purpose: on a 6000px poster the head has to read against the map's own
 * drawn hills at a zoom where the ribbon under it is a thread, and a straight scale of the
 * dialog's proportions loses it. The test below holds them between the ribbon and the pin, which
 * is the relationship that actually matters and the one a retune must not break.
 */
export const ROUTE_HEAD_SIZE = 64;
export const ROUTE_WAYPOINT_HEAD_SIZE = 46;

/**
 * The ink the route is drawn in, READ FROM THE STYLESHEET rather than copied out of it.
 *
 * "How this line looks" is one answer with two renderers: an SVG stroke in the walkthrough and a
 * PIXI path on the Scene. Two pictures of the same country in front of the same table have to
 * agree about the colour of the road, and a hex value written down twice is exactly the sort of
 * thing that quietly stops agreeing. So the stylesheet's `--stonetop-route-*` tokens are the one
 * authority and this reads them back, which also lets the route join the `--st-*` token system
 * the rest of the sheet is skinned through — a season palette or a dark variant now reaches it.
 *
 * FALLBACKS, and they matter: this is asked from a canvas draw that can run before the stylesheet
 * is applied, and from tests with no document at all. A miss returns the shipped values.
 * tests/utils/scene-route.test.js pins the fallbacks to the tokens, so the mirror cannot drift.
 *
 * NOT CACHED, deliberately, and that is what makes the paragraph above true rather than true-once.
 * The tokens can be re-pointed on a live document — a reader flips Foundry's colour scheme, a dark
 * variant lands — and an answer frozen for the session would go on painting the old ink until a
 * page reload, which is the exact opposite of the reason for reading the stylesheet at all. There
 * is nothing to cache around either: this is asked a handful of times per PAINT, and a paint
 * happens on arriving at a Scene or on the flag changing, not per frame. The painter reads it once
 * and hands it down (hooks/ExpeditionRouteOverlay.js), which is the whole of the saving a cache
 * was buying.
 */
export const ROUTE_INK_FALLBACK = Object.freeze({ ink: 0xb3261e, case: 0xf4ecd8, caseAlpha: 0.9 });

export function routeInk() {
	const body = globalThis.document?.body;
	if (!body || typeof globalThis.getComputedStyle !== "function") return ROUTE_INK_FALLBACK;

	const style = globalThis.getComputedStyle(body);
	const hex = (name) => {
		const found = /^#([0-9a-f]{6})$/i.exec(style.getPropertyValue(name)?.trim() ?? "");
		return found ? parseInt(found[1], 16) : null;
	};
	const ink = hex("--stonetop-route-ink");
	if (ink === null) return ROUTE_INK_FALLBACK;

	const alpha = Number(style.getPropertyValue("--stonetop-route-case-alpha"));
	return Object.freeze({
		ink,
		case: hex("--stonetop-route-case") ?? ROUTE_INK_FALLBACK.case,
		caseAlpha: Number.isFinite(alpha) && alpha > 0 ? alpha : ROUTE_INK_FALLBACK.caseAlpha,
	});
}

/**
 * The journey a Scene is currently showing, or null for one showing none.
 *
 * Read across every scope this package has shipped under, the same walk `posterMapSlugOf` does
 * next door and for the same reason: a Scene stamped under the old id must not read as bare.
 */
export function sceneJourney(scene) {
	const stored = scopedFlag(scene, SCENE_ROUTE_FLAG);
	if (!stored?.destination) return null;
	const { origin, destination } = normalizeJourney(stored);
	if (!destination) return null;
	// TWO PLACES, and nothing else. The flag used to carry the expedition's id and title as well,
	// which nothing ever read: state on a document that no reader can reach cannot be checked, and
	// a title copied here goes stale the moment the trip is renamed. What the line IS is the pair
	// of places; whose trip it was is the expedition record's to say.
	return { origin, destination };
}

/**
 * Did this Scene update touch the flag the route is drawn from?
 *
 * A Scene is written to constantly (a token moves, the darkness changes, a GM drags the nav bar),
 * and two separate watchers repaint off this one: the canvas overlay and the walkthrough's own
 * button label. Neither wants to run on any of the rest.
 *
 * Both spellings, because an unset arrives as the `-=` deletion key rather than as the key itself,
 * and every scope this package has shipped under, for the same reason `scopedFlag` walks them.
 */
export function routeFlagTouched(changes) {
	const flags = changes?.flags ?? {};
	return flagScopes()
		.some(scope => !!flags[scope]
			&& (SCENE_ROUTE_FLAG in flags[scope] || `-=${SCENE_ROUTE_FLAG}` in flags[scope]));
}

/** Is this Scene already showing exactly this journey? What the button's own label turns on. */
export function sceneShowsJourney(scene, journey) {
	const shown = sceneJourney(scene);
	if (!shown) return false;
	const want = normalizeJourney(journey);
	return shown.origin === want.origin && shown.destination === want.destination;
}

/**
 * Can this Scene carry this route, and if not, what is the reader supposed to do about it?
 *
 * Pure over a Scene-shaped object (`{ name, flags, width, height }`), so every branch below is
 * checkable without a canvas.
 *
 * IT ANSWERS FOR THE SCENE THE READER IS ON, not for the map the walkthrough happens to be
 * showing. Those come apart constantly and harmlessly: the panel follows the destination out to
 * the World's End while the table is still looking at the Vicinity, and most journeys are drawable
 * on either. Refusing because the two disagreed would be refusing something that works.
 *
 * @returns {{ok: true, tier, map, path, aspect}|{ok: false, reason: string, ...}}
 */
export function sceneRouteCheck(scene, route) {
	if (!scene) return { ok: false, reason: "no-scene" };
	if (!route?.legs?.length) return { ok: false, reason: "no-destination" };

	// The map that COULD take it, carried on every refusal below: it is the only part of a "no"
	// the reader can act on.
	const wanted = tierDrawing(route);
	const refuse = reason => ({ ok: false, reason, wanted, wantedName: travelMap(wanted)?.name ?? null });

	const slug = posterMapSlugOf(scene);
	if (!slug) return refuse("not-a-map");

	const tier = travelMap(slug);
	// A poster map this system knows, but not one the travel table charts across: the village and
	// the two town maps. They letter their own places and have no legs attached to any of them.
	if (!tier) return { ...refuse("wrong-map"), on: slug, onName: posterMapFor(slug)?.name ?? scene.name };

	const map = posterMapFor(slug);
	const width = Number(scene.width) || 0;
	const height = Number(scene.height) || 0;
	if (!(width > 0) || !(height > 0)) return refuse("no-size");

	// The same guard `posterMapPins` applies before laying a marker, asked here for the same
	// reason: a frame is a claim about the shape of a particular file, and a GM who saved their
	// own differently-trimmed scan over one of the names we know breaks that claim silently. A
	// map with no route on it is obviously missing one; a map with the route through the wrong
	// valleys looks finished and is worse than useless.
	const frame = frameFor(map.out);
	if (!frameFitsImage(frame, width / height, tier.printedAspect)) return refuse("wrong-shape");

	const aspect = width / height;
	const path = routePath(route, slug, frame, aspect);
	// Drawable map, undrawable journey: an end of it is somewhere this map does not put a pin.
	if (!path) return { ...refuse("off-map"), on: slug, onName: tier.name, note: offMapNote(slug, route) };

	return { ok: true, tier: slug, tierName: tier.name, path, aspect, width, height };
}

/**
 * Everything the painter needs, in Scene pixels: the beads, the ribbon under them, and the heads.
 *
 * Reads the Scene's own flag rather than taking a journey, because every client draws from what
 * the Scene says and only the one that pressed the button knows anything else. Returns null the
 * moment any part of the answer is missing, which is the ordinary state of nearly every Scene.
 */
export function sceneRoutePlan(scene) {
	const journey = sceneJourney(scene);
	if (!journey) return null;
	const check = sceneRouteCheck(scene, journeyRoute(journey));
	if (!check.ok) return null;

	const { path, aspect, width, height } = check;
	// OFFSET BY THE SCENE'S OWN ORIGIN, which is not (0,0) on a padded Scene. These marks go into
	// the drawings layer, whose coordinates are the canvas rectangle — the scene plus its padding
	// margin — while every fraction here is measured against the PICTURE. Ours are built unpadded,
	// where the two coincide, but a GM can add padding to a Scene afterwards and the failure is
	// silent: the whole route lands up and to the left of the country it names, with the map
	// untouched. The pins already standing on the same map are placed through the same helper for
	// the same reason (book2-art/poster-maps.js `planMarkerWrites`).
	const origin = sceneOrigin(scene);
	const at = point => ({
		x: origin.x + (point.left / 100) * width,
		y: origin.y + (point.top / 100) * height,
	});
	// The bead gap is a distance in PIXELS and the walk happens in percentages, so it converts
	// through the one axis percentages are anchored to. `routeDots` measures in the box's real
	// proportions, where one unit across is one unit down, so the width is the whole conversion.
	const gap = (ROUTE_DOT_GAP / width) * 100;

	// THREE RUNS OF POINTS, and nothing else: that is the whole of what the painter reads. The
	// journey, the tier and the tier's name used to ride along here too, unread by anything.
	return {
		// The ribbon, as the quadratics the dialog's SVG string describes. PIXI has no path
		// parser, so it gets the working rather than the write-up.
		legs: path.legs.map(leg => ({ from: at(leg.from), control: at(leg.control), to: at(leg.to) })),
		dots: routeDots(path.legs, aspect, gap).map(at),
		heads: path.arrows.map(head => ({
			...at(head),
			angle: head.angle,
			size: head.waypoint ? ROUTE_WAYPOINT_HEAD_SIZE : ROUTE_HEAD_SIZE,
		})),
	};
}

/**
 * Why a Scene will not take this route, in words the reader can act on.
 *
 * Every branch names a map, because "which map does draw it" is the only fact any of these
 * refusals leaves the reader able to use. `hasScene` says whether this world has built that map
 * yet, which decides whether the answer is "open it" or "import the book art first".
 */
export function sceneRouteRefusal(check, { hasScene = false } = {}) {
	const wanted = check?.wantedName;
	// Where to send them, once they know they are in the wrong place. A world that never imported
	// the book art has no Scene to open, and saying "open it" would send them looking for nothing.
	const goTo = wanted
		? hasScene
			? format("stonetop.expedition.route.goToOpen", { map: wanted })
			: localize("stonetop.expedition.route.goToImport")
		: "";

	switch (check?.reason) {
		case "no-scene":
			return localize("stonetop.expedition.route.noScene");
		case "no-destination":
			return localize("stonetop.expedition.route.noDestination");
		case "not-a-map":
			return localize("stonetop.expedition.route.notAMap") + goTo;
		case "wrong-map":
			return wanted
				? format("stonetop.expedition.route.wrongMap", { map: check.onName }) + goTo
				: format("stonetop.expedition.route.notCharted", { map: check.onName });
		case "no-size":
			return localize("stonetop.expedition.route.noSize");
		case "wrong-shape":
			return localize("stonetop.expedition.route.wrongShape");
		case "off-map": {
			const places = offMapNames(check.note);
			const missing = places
				? format("stonetop.expedition.route.offMapNamed", { map: check.onName, places })
				: format("stonetop.expedition.route.offMapWhole", { map: check.onName });
			return missing + goTo;
		}
		default:
			return localize("stonetop.expedition.route.refused");
	}
}

/**
 * The places a map cannot draw, as words.
 *
 * `offMapNote` hands back an ARRAY, deliberately — it computes geometry and has no business
 * knowing how a language joins a list. The joining is `joinNames`, the system's ONE list-joiner,
 * so these two surfaces (this file's refusal toast and the walkthrough's own readout) read like
 * every other "you got A, B & C" toast in the system rather than like each other. It used to word
 * its own pair off a key of its own, which both diverged from the house conjunction and silently
 * dropped a third name.
 */
export function offMapNames(note) {
	return joinNames(note?.names);
}

/**
 * Put a journey on a Scene, or take it off again.
 *
 * One write either way, and the flag is the whole of the state: the overlay redraws from it on
 * every client, including the players', because a Scene flag broadcasts and the point of this
 * button is the map the whole table is looking at.
 */
export async function showRouteOnScene(scene, journey) {
	const { origin, destination } = normalizeJourney(journey);
	if (!destination) return null;
	// ONE write, and it takes any LEGACY copy down on the way past. `scopedFlag` answers with the
	// first scope that holds one and walks the historical ids AHEAD of the pinned one, so a flag
	// left behind by a rename would otherwise outrank the route being drawn right now.
	// TWO PLACES in the payload; see `sceneJourney` for why nothing else goes in it.
	await scene.update({
		...routeFlagDeletions(scene, { except: SYSTEM_ID }),
		[`flags.${SYSTEM_ID}.${SCENE_ROUTE_FLAG}`]: { origin, destination },
	});
	return travelPlace(destination)?.name ?? destination;
}

/**
 * The `-=` deletion keys for every scope actually holding a route flag.
 *
 * WRITTEN AS AN UPDATE RATHER THAN `unsetFlag`, which is not a style choice: core validates a
 * flag scope against the ACTIVE package ids and throws for anything else, so `unsetFlag` cannot
 * reach a flag stamped under a system id this package no longer answers to. An explicit `-=` key
 * in an update goes around the validation, which is the same idiom the intro dialog uses to clear
 * its own draft buffer.
 *
 * Only the scopes that hold something, so an update is never issued for keys that were never
 * there.
 */
function routeFlagDeletions(scene, { except = null } = {}) {
	const flags = scene?.flags ?? {};
	const drop = {};
	for (const scope of flagScopes()) {
		if (scope === except) continue;
		if (flags[scope]?.[SCENE_ROUTE_FLAG]) drop[`flags.${scope}.-=${SCENE_ROUTE_FLAG}`] = null;
	}
	return drop;
}

/**
 * Take whatever route a Scene is showing back off it.
 *
 * EVERY SCOPE, not just the pinned one, and that asymmetry is the bug this is written around. The
 * read walks `flagScopes()` so a Scene stamped under an older id still reads as showing a route —
 * and this package has already been renamed twice, with `game.system.id` able to differ from
 * SYSTEM_ID again on a renamed install folder. Deleting under SYSTEM_ID alone removed a key that
 * had never been written: the panel went on saying "take it off the scene", the line went on
 * painting, and the button became a permanent no-op with no way through the UI to clear it.
 */
export async function clearRouteOnScene(scene) {
	if (!sceneJourney(scene)) return false;
	await scene.update(routeFlagDeletions(scene));
	return true;
}
