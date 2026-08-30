// "See the whole map": the route planner, around a map as big as the reader wants it.
//
// The route step's own map is only as wide as the walkthrough's step column, and the books print
// these at 300 dpi — so the panel offers a way out to a full window. What that window shows is not
// a picture of the panel but a PEER of it: the same origin picker, the same map tabs, the same
// hotspots, the same readout, from the same partials, writing to the same trip. Pick a destination
// here and the walkthrough behind it already agrees, because there was only ever one place the
// answer lived.
//
// It is an ImageZoomWindow with chrome. Everything about wheel-zoom, drag-pan and fit belongs to
// that class and is inherited untouched; this adds the controls above and below the viewport, the
// pin layer over the picture, and the wiring that turns a click in here into a write over there.
//
// WHO OWNS WHAT. The trip's origin and destination live in the world setting, reached only through
// the ExpeditionDialog that opened this window — so this class never writes game state, it calls
// `source.markPlace(...)` / `source.drawMark(...)` / `source.undoMark(...)` and then re-reads. What
// this window has that the panel does not is the PICTURE: a 300 dpi map the reader can wheel into,
// which is where a point can be put exactly where they mean it rather than within a few miles of
// it. Which map it is showing is its OWN state, deliberately: a
// window opened on the Vicinity keeps showing the Vicinity even when the panel behind it follows a
// destination out to the World's End, because the reader put it there.

import { ImageZoomWindow } from "../utils/image-zoom-window.js";
import {
	JOURNEY_MARKS, JOURNEY_RIGHT_CLICK_MARKS,
	bindJourneyControls, bindJourneySiteRemoval, journeyPick,
} from "./journey-controls.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { openingSize } from "../utils/opening-size.js";
import { percentSpot, travelMap } from "../data/travel-times.js";
// Not the bare global: v13 moved it under foundry.applications.handlebars and deprecated that,
// and the shim picks whichever this core has.
import { renderTemplate } from "../utils/foundry-compat.js";

const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/travel-map.hbs";
// The two halves of the chrome, re-rendered in place by `sync`. The same partials the route step
// composes itself from, which is what keeps the window a peer of the panel rather than a copy.
const CONTROLS_TEMPLATE = "systems/stonetop-pwd/templates/dialogs/partials/expedition-journey-controls.hbs";
// The foot's two halves, in the order the template composes them: what a click on the picture does,
// then what the journey costs.
const DRAWHINT_TEMPLATE = "systems/stonetop-pwd/templates/dialogs/partials/expedition-journey-drawhint.hbs";
const ROUTE_TEMPLATE = "systems/stonetop-pwd/templates/dialogs/partials/expedition-journey-route.hbs";

// HOW BIG IT OPENS. The books print these maps at 300 dpi and this window exists to give one room,
// so it takes most of the screen rather than a fixed box every reader has to drag out again. The
// arithmetic is shared with the rulebook reader, which wants the same thing for the same reason
// (utils/opening-size.js); what is decided HERE is the one number the two disagree about.
//
// No wider than this much of its own height (user, 2026-08-24). On an ultrawide, 80% of the width
// is a letterbox: the maps are roughly landscape-page shaped, so the picture fits to the height and
// everything past that is white mat down both sides. Widening past 1.2 buys margin, not map. Only
// the DEFAULT is clamped - the frame stays resizable, so a reader who wants the whole width can
// drag it there.
const MAX_ASPECT = 1.2;

export class TravelMapWindow extends ImageZoomWindow {
	/**
	 * @param {object} config
	 * @param {string} config.tier            which map this window shows
	 * @param {object} config.source          the planner behind it, supplying:
	 *   `build(tier)`  -> Promise of the journey context for that tier (the same object the route
	 *                     step renders), and
	 *   `markPlace(slug, ev, from, tier)` / `drawMark(mark, opts, from)` / `undoMark(from)` ->
	 *                     Promise, the three gestures on the picture, written to the trip, and
	 *   `toScene()` -> Promise, putting the route on the reader's own scene or taking it back off,
	 *   `markSite(uuid, ev, from)` -> Promise, the same three gestures for one of the GM's own
	 *                     sites, which is a place on the way rather than a link to a journal, and
	 *   `placeSite({tier, frame, pickPoint})` -> Promise, dropping one of the GM's own sites on the
	 *                     map showing here, and `takeSiteOffMap(uuid)` -> Promise, lifting one.
	 * @param {object} config.journey         the first build's result, so the window opens populated
	 */
	constructor({ tier, source, journey } = {}, options = {}) {
		super({
			src: journey?.map?.src ?? "",
			alt: journey?.map?.alt ?? "",
			// The pin layer's third kind of mark, added to the parent's own two. It matters here
			// and not only in the delegate below: this selector is also what tells the pan handler
			// a press on a pin from a press on open map, so a site pin left out of it would take a
			// pointer capture on the viewport, have its click retargeted there, and be unclickable.
			controls: JOURNEY_MARKS,
			// Handed to the parent HERE and not in activateListeners: the parent binds its overlay
			// delegate only when it already has an onPick, and it binds during the very first
			// activateListeners — so setting this afterwards would leave the hotspots dead.
			//
			// Every kind of mark the layer carries, because they mean different things and only one
			// of them names a place. An edge arrow with no `node` (the "Steplands & Marshedge" one)
			// renders `data-slug=""` and means "move out a tier", and the panel's own handler has
			// always read it that way — so without the `tier` arm that arrow would sit here wearing
			// a tooltip promising a zoom and do nothing at all. `journeyPick` owns which wins.
			onPick: (data, ev) => journeyPick(data, {
				showTier: tier => this.showTier(tier),
				// The planner decides whether this is a destination or a stop on a drawn way, at
				// click time — which it has to be, since this handler is built once here and never
				// rebound, long before the first mark goes down. The tier is read at click time for
				// the same reason: this window's own tabs move it, and a way that does not exist
				// yet begins on the map the reader is actually looking at.
				markPlace: (slug, click) => this._through(source =>
					source.markPlace?.(slug, click, this, this._journey?.map?.tier ?? this._tier)),
				// One of the GM's own sites, which is a place on the way now rather than a link out
				// to a journal (user, 2026-08-24). It needs no tier from here: a site carries its
				// own, and the stop is laid at the site's recorded fraction rather than the
				// pointer's — so the same tap in this window and in the panel writes one number.
				markSite: (uuid, click) => this._through(source =>
					source.markSite?.(uuid, click, this)),
			}, ev),
		}, options);
		this._tier = tier;
		this._source = source;
		this._journey = journey ?? null;
	}

	static get defaultOptions() {
		const { width, height } = openingSize({ maxAspect: MAX_ASPECT });
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["stonetop", "stonetop-image-zoom", "stonetop-travel-map-app"],
			template: TEMPLATE,
			width,
			height,
		});
	}

	getData() {
		return {
			src: this._src,
			alt: this._alt,
			journey: this._journey,
			// Rendered by the caller (which owns the pin partial), so this window never has to know
			// what a hotspot looks like.
			overlay: this._journey?.pins ?? "",
		};
	}

	activateListeners(html) {
		// The picture's own listeners first: the inherited method finds the viewport as a
		// DESCENDANT here, since this template's root is the chrome column rather than the
		// viewport itself, and that fallback is the whole reason this template can exist.
		super.activateListeners(html);
		this._bindChrome(html[0]);
		// NOT in `_bindChrome`, which `sync` calls again on markup it has just replaced. This is
		// delegated on the window's ROOT, which survives every sync, so re-binding it there would
		// stack a second listener on each pick and a third on the next — and one right-click would
		// then ask to lift the same pin twice over.
		bindJourneySiteRemoval(html[0], uuid => this._removeSite(uuid));
	}

	/**
	 * The controls around the picture, forwarded to the same planner the walkthrough uses.
	 *
	 * SEPARATE FROM activateListeners because `sync` replaces this markup and has to re-bind it —
	 * and calling the whole of activateListeners again would hand the viewport a second set of
	 * wheel and pointer handlers, then a third, so every notch of the wheel would zoom twice.
	 * Hotspot clicks are not here at all: the parent delegates those from the overlay, which
	 * survives its own contents being swapped.
	 */
	_bindChrome(root) {
		// No `zoom`: this window IS what that button opens. `toScene` IS forwarded, because putting
		// the route on the table's map is the same act wherever it is asked for, and this window is
		// the surface a GM is most likely to be reading the route from when they think of it.
		bindJourneyControls(root, {
			showTier: tier => this.showTier(tier),
			toScene: () => this._source?.toScene?.(),
			placeSite: () => this._placeSite(),
			clearDrawn: () => this._through(source => source.clearDrawn?.(this)),
		});
		// And the picture itself, since the journey just re-read is what says whether this map
		// takes marks at all. Re-armed here rather than in `activateListeners` for that reason:
		// `sync` is what every mark comes back through, and the first one changes the answer.
		this._armDrawing();
	}

	/**
	 * Arm this window's own map for drawing, or leave it alone.
	 *
	 * WHAT A CLICK COULD MEAN HERE is the planner's answer and not this window's: `canDrawHere` and
	 * `canSetStart` are built per tier by `ExpeditionDialog._drawState`, off the same journey this
	 * window renders its chrome from, so the crosshair and the line under the map cannot come
	 * apart. They say no to a reader who may not draw, and no on a picture an existing way could
	 * never join — which matters most here, since this window keeps showing whatever tier it was
	 * opened on even after the panel has followed a destination out to the other one.
	 *
	 * The parent takes care of aiming: it listens on the viewport, where a pan's pointer capture
	 * retargets everything, and measures the overlay, which is the painted picture's own box at
	 * whatever zoom and pan the reader has put it at. So a mark laid here at 300 dpi is a mark in
	 * the same valley the panel's little map would have put it in.
	 */
	_armDrawing() {
		const custom = this._journey?.custom;
		const map = this._journey?.map;
		if (!map || !(custom?.canDrawHere || custom?.canSetStart)) {
			this.stopWatchingPoints();
			return;
		}
		// The crosshair belongs to the two states where the next click lands something — a way
		// already drawn, whose far end it moves, and a trip with no start, whose start it plants —
		// and the right-click to any trip with something left to peel back off it. Both are the
		// planner's answer, built per tier alongside `canDrawHere` (see `ExpeditionDialog`
		// `_drawState`) and read here rather than re-derived, so this window and the panel cannot
		// come to disagree about what a click on the same map would do.
		this.watchPoints({
			onPoint: (at, ev) => this._through(source => source.drawMark?.(
				percentSpot(at, map.frame), { append: !!ev.shiftKey, tier: map.tier }, this)),
			onUndo: custom.canUndo
				? () => this._through(source => source.undoMark?.(this))
				: null,
			crosshair: !!custom.crosshair,
			ignore: JOURNEY_MARKS,
			undoIgnore: JOURNEY_RIGHT_CLICK_MARKS,
		});
	}

	/**
	 * Do something through the planner, then re-read this window.
	 *
	 * The shape every gesture in here already had, written once: the panel owns the trip, so the
	 * act goes over there and the answer comes back through `sync` — and the planner is told which
	 * window asked, so its own sweep of the open maps skips the one about to re-read itself.
	 */
	async _through(act) {
		if (!this._source) return;
		await act(this._source);
		await this.sync();
	}

	/**
	 * Put one of the GM's own sites on this map.
	 *
	 * THE WINDOW SUPPLIES THE PICTURE, the planner supplies everything else. Which site, where it
	 * is filed and what a spot means are the panel's business (it owns the steading and the frame
	 * arithmetic); what only this surface can answer is "click on WHAT" — and here that is a
	 * zoomable, draggable 300 dpi map the reader can wheel down into before they commit, which is
	 * the whole reason a GM would place from this window rather than from the panel's own map.
	 *
	 * The frame comes off the journey this window is already holding rather than being re-derived:
	 * it is the registration of the exact file on screen, and asking for it again would be a second
	 * browse and a second decode to arrive at the number in hand.
	 */
	async _placeSite() {
		const map = this._journey?.map;
		if (!map) return;
		await this._source?.placeSite?.({
			tier: this._tier,
			frame: map.frame,
			pickPoint: () => this.pickPoint(),
		}, this);
		await this.sync();
	}

	/** Lift a pin back off this map, through the planner, then re-read. */
	async _removeSite(uuid) {
		await this._source?.takeSiteOffMap?.(uuid, this);
		await this.sync();
	}

	/**
	 * Show a different map.
	 *
	 * A full re-render, unlike `sync` below, because the PICTURE changes: the new map has its own
	 * size and its own framing, so the fit has to be recomputed from scratch. Losing the zoom is
	 * correct here — the reader asked for a different map, not for a different corner of this one.
	 */
	async showTier(tier) {
		if (!tier || tier === this._tier) return;
		// The same guard the panel's own tab handler applies (`ExpeditionDialog._showMapTier`).
		// Both surfaces render their controls from one dataset and journey-controls.js says they
		// "have to agree about this or the same arrow does two different things" — and without it
		// they did: an edge arrow naming a tier with no map left this window sitting on its
		// permanent "that map isn't in this world" panel while the panel correctly did nothing.
		if (!travelMap(tier)) return;
		const from = this._tier;
		this._tier = tier;
		this._journey = await this._source?.build?.(tier) ?? null;
		this._src = this._journey?.map?.src ?? "";
		this._alt = this._journey?.map?.alt ?? "";
		this._fitting = true;
		this._reidentify(tier);
		await this._source?.moved?.(from, tier, this);
		return this.render(false);
	}

	/**
	 * Let the window's IDENTITY follow the map, not just its picture.
	 *
	 * The id is what `openOrFocus` matches on and the title is what the frame says, and both were
	 * fixed at the tier the window was OPENED on. Left there, a window navigated to the World's End
	 * went on answering to `…-vicinity`: asking the panel for the Vicinity raised a window showing
	 * the other map, and asking it for the World's End matched no id at all and opened a SECOND
	 * window onto the same picture, with both of them writing picks to the same trip.
	 *
	 * AppV1 will not do either for us. `get id()` reads `options.id`, so that has to move for the
	 * lookup to follow; and `_replaceHTML` re-reads the title only while it still holds the `{{`
	 * placeholder, so a re-render leaves the old one in the bar.
	 */
	_reidentify(tier) {
		const id = travelMapId(tier);
		if (this.options) {
			this.options.id = id;
			this.options.title = this._alt;
		}
		const root = this.element?.[0];
		if (!root) return;
		root.id = id;
		const bar = root.querySelector?.(".window-title");
		if (bar) bar.textContent = this._alt;
	}

	/**
	 * Re-read the planner and redraw, WITHOUT touching the zoom or the pan.
	 *
	 * The pins and the readout are swapped in place rather than re-rendered, because a re-render
	 * would re-run `_fitToWindow` and throw away the corner the reader had zoomed into — which is
	 * precisely the view they were using when they clicked. Called after a pick made in here, and
	 * by the walkthrough after a pick made over there.
	 */
	async sync() {
		if (!this.rendered) return;
		this._journey = await this._source?.build?.(this._tier) ?? null;
		this.setOverlay(this._journey?.pins ?? "");
		const root = this.element?.[0];
		if (!root || !this._journey) return;

		// The chrome is re-rendered from the same partials the panel uses, so "what the controls
		// say" cannot drift from "what the panel says" — then re-bound, since it is new markup.
		const chrome = root.querySelector(".stonetop-travel-map-chrome");
		const foot = root.querySelector(".stonetop-travel-map-foot");
		// Independent renders of the same journey: started together rather than one after the
		// other, since none of them reads another's markup.
		const [controlsHtml, hintHtml, routeHtml] = await Promise.all([
			chrome ? renderTemplate(CONTROLS_TEMPLATE, { journey: this._journey }) : null,
			foot ? renderTemplate(DRAWHINT_TEMPLATE, { journey: this._journey }) : null,
			foot ? renderTemplate(ROUTE_TEMPLATE, { journey: this._journey }) : null,
		]);
		if (chrome) chrome.innerHTML = controlsHtml;
		// The same order the template lays them in, since this replaces the whole foot.
		if (foot) foot.innerHTML = `${hintHtml}${routeHtml}`;
		this._bindChrome(root);
	}
}

/** The singleton id for one tier's window. Shared with `_reidentify`, which moves it. */
export function travelMapId(tier) {
	return `stonetop-travel-map-${tier}`;
}

/**
 * Open (or re-focus) the travel map for one tier.
 *
 * Keyed by tier, so the two maps are two windows and a second click on the same tab raises the one
 * already showing it. Returns null when this world has no copy of that map, since a zoom window
 * around no picture is worse than the panel's own "run Import Book Art" line.
 *
 * The build happens INSIDE the factory, so re-focusing costs nothing: it is a Dijkstra solve, an
 * art browse, a `resolveTravelMap` and a pass over every hotspot on the map, and doing it ahead of
 * the already-open check meant a second click on "See the whole map" paid for all of it and then
 * threw the answer away.
 */
export async function openTravelMap({ tier, source } = {}) {
	const id = travelMapId(tier);
	return openOrFocus(id, async () => {
		const journey = await source?.build?.(tier);
		if (!journey?.map?.src) return null;
		const app = new TravelMapWindow({ tier, source, journey }, { id, title: journey.map.alt });
		app.render(true);
		return app;
	});
}
