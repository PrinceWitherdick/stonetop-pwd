// The party mark walking the route line on an off-canvas map, after the GM travels a leg: the GM's
// map windows (TravelMapWindow) and the players' Shared Route window. The redraw has already put the
// mark where the party now stands; this only plays the way there, then leaves it exactly there.
//
// Frame-driven rather than a keyframes animation because the path is the route's own curve, which
// CSS cannot follow. Asks `prefersReducedMotion()` first, as every timed motion must.
// Guarded by tests/dialogs/journey-walk.test.js.

import { prefersReducedMotion } from "../utils/reduced-motion.js";
import { drawnLegs, legPoint } from "../utils/route-path.js";
import { clampInt } from "../utils/clamp-int.js";

const WALK_SECONDS_PER_LEG = 0.9;
const WALK_SECONDS_MAX = 1.6;

// One walk per map surface: a second step before the first has finished ends the first where it
// was headed (`cancelWalk` puts the mark at that walk's end) and walks on from there, rather than
// racing it. So a double press jumps the rest of the first leg; following the curve from a mark
// stopped mid-leg would need the old walk's path, which a redraw has already replaced.
const walking = new WeakMap();

/**
 * The drawn legs between `fromCount` and `toCount` (counts of `legs`, not of route legs) sampled
 * into `[{ left, top }]`, first point where the party was and last where it now is. Walks the
 * legs backwards when `toCount` is the smaller. [] when there is nothing to walk.
 */
export function walkPoints(legs, fromCount, toCount, perLeg = 24) {
	if (!Array.isArray(legs) || !legs.length) return [];
	const a = clampInt(fromCount, 0, legs.length), b = clampInt(toCount, 0, legs.length);
	if (a === b) return [];
	const steps = Math.max(2, Math.trunc(perLeg) || 2);
	const forward = b > a;
	const run = forward ? legs.slice(a, b) : legs.slice(b, a).reverse();
	const points = [];
	run.forEach((leg, i) => {
		for (let s = i ? 1 : 0; s <= steps; s++) {
			const t = s / steps;
			points.push(legPoint(leg, forward ? t : 1 - t));
		}
	});
	return points;
}

/** Ease in and out, over 0..1. */
const ease = t => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

/** How long a walk of `from` to `to` route legs lasts, in seconds. Shared with the canvas mark. */
export function walkSeconds(from, to) {
	return Math.min(WALK_SECONDS_MAX, WALK_SECONDS_PER_LEG * Math.abs((Number(to) || 0) - (Number(from) || 0)));
}

/**
 * Where along `points` ({ left, top }) the mark stands at time `t` (0..1), eased, at one pace by
 * distance so a short leg and a long one take their share. The canvas mark (hooks/
 * ExpeditionRouteOverlay.js) reuses it with scene pixels in `left`/`top`.
 */
export function walkTrack(points) {
	const along = [0];
	for (let i = 1; i < points.length; i++) {
		along.push(along[i - 1] + Math.hypot(points[i].left - points[i - 1].left, points[i].top - points[i - 1].top));
	}
	const length = along.at(-1) ?? 0;
	return t => {
		if (points.length < 2) return points[0] ?? null;
		const goal = ease(Math.min(Math.max(t, 0), 1)) * length;
		let i = 1;
		while (i < along.length - 1 && along[i] < goal) i++;
		const span = along[i] - along[i - 1];
		const f = span ? (goal - along[i - 1]) / span : 1;
		const a = points[i - 1], b = points[i];
		return { left: a.left + (b.left - a.left) * f, top: a.top + (b.top - a.top) * f };
	};
}

/**
 * Walk the `.stonetop-journey-party` mark under `root` from route leg count `from` to `to`, along
 * `legs` (the map's `path.legs`), using `reach` (`path.reach`) to turn route legs into drawn legs.
 * Returns true when a walk started. Ends on the mark's own `left`/`top` as the template wrote them.
 */
export function walkPartyMarker(root, { legs, reach, from, to } = {}) {
	cancelWalk(root);
	const mark = root?.querySelector?.(".stonetop-journey-party");
	if (!mark || prefersReducedMotion()) return false;
	const frame = globalThis.requestAnimationFrame;
	if (typeof frame !== "function" || !Array.isArray(reach)) return false;
	const points = walkPoints(legs, drawnLegs(reach, from), drawnLegs(reach, to));
	if (points.length < 2) return false;

	const track = walkTrack(points);
	const end = { left: mark.style.left, top: mark.style.top };
	const place = ({ left, top }) => {
		mark.style.left = `${left.toFixed(2)}%`;
		mark.style.top = `${top.toFixed(2)}%`;
	};
	const finish = () => {
		mark.style.left = end.left;
		mark.style.top = end.top;
		walking.delete(root);
	};
	const seconds = walkSeconds(from, to);
	const state = { frame: null, finish };
	let started = null;
	const step = now => {
		started ??= now;
		const t = Math.min(1, (now - started) / (seconds * 1000));
		if (t >= 1 || !mark.isConnected) return finish();
		place(track(t));
		state.frame = frame(step);
	};
	// Stood at the start before the first paint, so the mark never flashes at the destination.
	place(points[0]);
	walking.set(root, state);
	state.frame = frame(step);
	return true;
}

/**
 * After a redraw of the map under `root`: walk the mark when the same line is drawn (`was` and `now`
 * are the map's `path` before and after) and only the party's place on it moved. A different line,
 * or a mark appearing or going, is no walk. Returns true when a walk started.
 */
export function walkOnRedraw(root, was, now) {
	const from = was?.walked?.reached, to = now?.walked?.reached;
	if (typeof from !== "number" || typeof to !== "number" || from === to || was.d !== now.d) return false;
	return walkPartyMarker(root, { legs: now.legs, reach: now.reach, from, to });
}

/** Stop a walk under `root`, leaving its mark where the template put it. */
export function cancelWalk(root) {
	const state = root ? walking.get(root) : null;
	if (!state) return;
	if (state.frame !== null) globalThis.cancelAnimationFrame?.(state.frame);
	state.finish();
}
