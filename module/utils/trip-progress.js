// How far along its route a trip has got: the legs the party has travelled, for Running the
// journey's road panel and the banner's status chip (dialogs/ExpeditionDialog.js `_roadContext`).
//
// Stored on the trip as `progress = { reached, key }`. `key` is the `journeyKey` the count was
// written against, so a route changed since reads as 0 and an edit needs no reset code.
// Pure over its arguments. Guarded by tests/utils/trip-progress.test.js.

import { journeyKey } from "./travel-route.js";
import { format } from "./i18n.js";
import { clampInt } from "./clamp-int.js";

/** `{ reached, total, started, arrived }`, `reached` clamped to 0..total; a stale key or no route reads 0. */
export function tripProgress(trip, route) {
	const total = route?.legs?.length ?? 0;
	const stored = trip?.progress;
	const fresh = total > 0 && stored?.key === journeyKey(trip?.journey);
	const raw = fresh ? Math.trunc(Number(stored.reached)) : 0;
	const reached = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), total) : 0;
	return { reached, total, started: reached > 0, arrived: total > 0 && reached === total };
}

/** The `progress` to store after moving `step` legs (+1 or -1), or null when nothing changes or there is no route. */
export function steppedProgress(trip, route, step) {
	const { reached, total } = tripProgress(trip, route);
	if (!total || !Number.isInteger(step)) return null;
	const next = Math.min(Math.max(reached + step, 0), total);
	return next === reached ? null : { reached: next, key: journeyKey(trip?.journey) };
}

/**
 * One row per leg, in travel order. `state` is "walked" for a leg behind them, "next" for the one
 * ahead, "ahead" past it. `days` is the leg's least count when it is measured in days, else null.
 */
export function roadLegs(route, reached) {
	return (route?.legs ?? []).map((leg, index) => ({
		index,
		fromName:  leg.fromName,
		toName:    leg.toName,
		time:      leg.time ?? "",
		estimated: !!leg.estimated,
		days:      leg.unit === "days" && Number(leg.min) > 0 ? Number(leg.min) : null,
		state:     index < reached ? "walked" : index === reached ? "next" : "ahead",
	}));
}

/**
 * Where the party is, in one sentence: arrived, on a leg, at the start, or not yet set out. `legs`
 * carry `fromName`/`toName` in whichever names the reader is given: the GM's road panel passes its
 * own, the players' Shared Route window the share's (utils/shared-route.js `sharedRouteView`).
 */
export function roadWhere(legs, reached, { setOut = false } = {}) {
	const key = "stonetop.expedition.road";
	const total = legs?.length ?? 0;
	if (!total) return "";
	const at = clampInt(reached, 0, total);
	if (at === total) return format(`${key}.arrived`, { place: legs.at(-1).toName });
	if (at > 0) return format(`${key}.onLeg`, { n: at + 1, total, place: legs[at].toName });
	return format(`${key}.${setOut ? "atStart" : "notSetOut"}`, { place: legs[0].fromName });
}

/**
 * "planning" | "road" | "arrived" | "home". Home once the homecoming is stamped; arrived once every
 * leg is travelled; on the road once they set out or have travelled a leg; planning before that.
 * `progress` is `tripProgress(trip, route)`, passed by a caller that has it already.
 */
export function tripStatus(trip, route, progress = tripProgress(trip, route)) {
	if (trip?.timelineRecorded?.season) return "home";
	const { started, arrived } = progress;
	if (arrived) return "arrived";
	if (started || trip?.setOut?.season) return "road";
	return "planning";
}
