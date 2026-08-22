// The expedition route, painted onto the Scene the table is looking at.
//
// The walkthrough's own map draws the way they go as an SVG stroke wearing a dash pattern, over a
// picture inside a dialog. This paints the same line onto the canvas: same curve, same cream
// ribbon, same red beads, same heads, at the size the whole room can see.
//
// IT IS PAINT, NOT DOCUMENTS. A Drawing has no dash pattern in its schema, so a dotted line made
// of Drawings would be a hundred tiny ellipses per route: a hundred placeables to create, a
// hundred to delete, a hundred sitting in the Drawings layer for a GM to catch with a marquee and
// drag off the map. The Scene instead carries ONE flag naming two places (utils/scene-route.js)
// and every client draws the line from it. That flag broadcasts like any other, so the players see
// it appear on their own canvas without this ever sending anything itself.
//
// WHERE IT SITS. In the `drawings` layer, which the interface group stacks ABOVE the map and BELOW
// the notes on both v13 and v14 (CONFIG.Canvas.layers, in that order). That is the stacking the
// walkthrough already uses for the same three things, and it is the one that matters: a route
// bead is allowed to cross the map, and it is not allowed to sit on top of a place's pin.
//
// It goes in as a plain child of the layer rather than of `layer.objects`, which is the container
// core fills with Drawing placeables and iterates as such. Nothing walks the layer's own children
// expecting them all to be placeables, and `_tearDown` destroys the lot, which is exactly the
// lifetime this wants.

import {
	ROUTE_CASE_WIDTH, ROUTE_DOT_SIZE,
	routeFlagTouched, routeInk, sceneRoutePlan,
} from "../utils/scene-route.js";
import { ROUTE_HEAD_EDGE as HEAD_EDGE, ROUTE_HEAD_POINTS as HEAD_POINTS } from "../utils/route-path.js";
import { warn } from "../utils/logger.js";

/** The Graphics we painted, so a redraw can take the old one down first. */
let _painted = null;

/**
 * Paint the active Scene's route, or take down whatever is there when it has none.
 *
 * Safe to call at any time and from anywhere: a canvas that is not ready, a Scene with no flag and
 * a Scene whose flag cannot be drawn all end the same way, with nothing on the map.
 */
export function refreshExpeditionRoute() {
	_erase();
	const layer = globalThis.canvas?.ready ? globalThis.canvas.drawings : null;
	if (!layer) return;

	try {
		const plan = sceneRoutePlan(globalThis.canvas.scene);
		if (!plan) return;
		const g = new PIXI.Graphics();
		g.eventMode = "none";
		g.interactiveChildren = false;
		// READ ONCE for the whole paint and handed down. `routeInk` reads the live stylesheet on
		// every call so a re-pointed token (a colour scheme flipped mid-session) reaches the next
		// paint rather than the next reload; asking it per bead and per head would be the same
		// answer fetched a dozen times for one picture.
		const ink = routeInk();
		_drawCase(g, plan.legs, ink);
		_drawDots(g, plan.dots, ink);
		for (const head of plan.heads) _drawHead(g, head, ink);
		// Added LAST, so a throw anywhere above leaves the map bare rather than leaving half a
		// line on it. A map with no route is the ordinary state of nearly every scene; a map with
		// the first two legs of one is a lie about where the party is going.
		_painted = layer.addChild(g);
	} catch (err) {
		// A route that cannot be drawn is a map with no line on it, which is the same thing the
		// reader sees for every scene that never had one. Not worth taking the canvas down for.
		warn("couldn't draw the expedition route on this scene", err);
		_erase();
	}
}

/** Take the painted line down, if there is one and it has not already been destroyed with a layer. */
function _erase() {
	if (_painted && !_painted.destroyed) _painted.destroy({ children: true });
	_painted = null;
}

/**
 * The ribbon: the route's own quadratics, stroked in cream.
 *
 * A continuous stroke rather than a run of cream beads under the red ones, which is what the
 * walkthrough's `stroke-dasharray: 0.1 7` on a 7px stroke amounts to anyway: at that period the
 * cream dots overlap into a ribbon, and the visible dotting is the 3.5px red riding on top of it.
 * Stroking it once is both the same picture and a great deal less arithmetic.
 */
function _drawCase(g, legs, ink) {
	if (!legs?.length) return;
	g.lineStyle({
		width: ROUTE_CASE_WIDTH,
		color: ink.case,
		alpha: ink.caseAlpha,
		cap: PIXI.LINE_CAP.ROUND,
		join: PIXI.LINE_JOIN.ROUND,
	});
	g.moveTo(legs[0].from.x, legs[0].from.y);
	for (const leg of legs) g.quadraticCurveTo(leg.control.x, leg.control.y, leg.to.x, leg.to.y);
	g.lineStyle(0);
}

/** The beads: one red dot every gap along the whole run, first stop included. */
function _drawDots(g, dots, ink) {
	g.beginFill(ink.ink, 1);
	for (const dot of dots) g.drawCircle(dot.x, dot.y, ROUTE_DOT_SIZE / 2);
	g.endFill();
}

/**
 * One arrowhead, turned to lie along the leg it belongs to.
 *
 * The angle arrives already worked out in the picture's real proportions (route-path.js), so
 * nothing here has to know about the map's shape: the canvas is measured in pixels, where the
 * direction the numbers describe and the direction a reader sees are the same direction.
 */
function _drawHead(g, { x, y, angle, size }, ink) {
	const turn = (Number(angle) || 0) * Math.PI / 180;
	const cos = Math.cos(turn), sin = Math.sin(turn);
	const points = HEAD_POINTS.map(([hx, hy]) => [
		x + (hx * cos - hy * sin) * size,
		y + (hx * sin + hy * cos) * size,
	]);
	// The cream edge first and the fill over it, which is what `paint-order: stroke` does in the
	// dialog: the head keeps the same halo the beads have without the edge eating into its point.
	g.lineStyle({
		width: size * HEAD_EDGE * 2,
		color: ink.case,
		alpha: ink.caseAlpha,
		join: PIXI.LINE_JOIN.ROUND,
	});
	g.beginFill(ink.ink, 1);
	g.drawPolygon(points.flat());
	g.endFill();
	g.lineStyle(0);
}

/**
 * Every reason the line has to be repainted, wired once.
 *
 * `canvasReady` covers arriving on the Scene at all, which includes both a GM activating it and a
 * player following them onto it. `updateScene` covers the flag changing under a canvas already up,
 * which is the case that has to reach the OTHER clients: the GM presses the button in their
 * walkthrough, the flag broadcasts, and every player's map grows the line without anything here
 * having sent a message.
 *
 * The update is filtered on the Scene being the one on screen and on the change actually touching
 * our flag, because a Scene is written to constantly (a token moves, the darkness changes) and a
 * repaint on each of those would be a repaint for nothing.
 */
export function registerExpeditionRouteHooks() {
	Hooks.on("canvasReady", () => refreshExpeditionRoute());
	// The canvas is coming down; the layer takes our Graphics with it, so let go of the handle
	// rather than reaching into a destroyed object on the next paint.
	Hooks.on("canvasTearDown", () => { _painted = null; });
	Hooks.on("updateScene", (scene, changes) => {
		if (scene?.id !== globalThis.canvas?.scene?.id) return;
		if (!routeFlagTouched(changes)) return;
		refreshExpeditionRoute();
	});
}
