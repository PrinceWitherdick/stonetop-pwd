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
// `source.pick(...)` and then re-reads. Which map it is showing is its OWN state, deliberately: a
// window opened on the Vicinity keeps showing the Vicinity even when the panel behind it follows a
// destination out to the World's End, because the reader put it there.

import { ImageZoomWindow } from "../utils/image-zoom-window.js";
import { bindJourneyControls, journeyPick } from "./journey-controls.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { travelMap } from "../data/travel-times.js";
// Not the bare global: v13 moved it under foundry.applications.handlebars and deprecated that,
// and the shim picks whichever this core has.
import { renderTemplate } from "../utils/foundry-compat.js";

const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/travel-map.hbs";
// The two halves of the chrome, re-rendered in place by `sync`. The same partials the route step
// composes itself from, which is what keeps the window a peer of the panel rather than a copy.
const CONTROLS_TEMPLATE = "systems/stonetop-pwd/templates/dialogs/partials/expedition-journey-controls.hbs";
const ROUTE_TEMPLATE = "systems/stonetop-pwd/templates/dialogs/partials/expedition-journey-route.hbs";

export class TravelMapWindow extends ImageZoomWindow {
	/**
	 * @param {object} config
	 * @param {string} config.tier            which map this window shows
	 * @param {object} config.source          the planner behind it, supplying:
	 *   `build(tier)`  -> Promise of the journey context for that tier (the same object the route
	 *                     step renders), and
	 *   `pick(field, slug)` -> Promise, writing an origin or destination to the trip, and
	 *   `toScene()` -> Promise, putting the route on the reader's own scene or taking it back off.
	 * @param {object} config.journey         the first build's result, so the window opens populated
	 */
	constructor({ tier, source, journey } = {}, options = {}) {
		super({
			src: journey?.map?.src ?? "",
			alt: journey?.map?.alt ?? "",
			// Handed to the parent HERE and not in activateListeners: the parent binds its overlay
			// delegate only when it already has an onPick, and it binds during the very first
			// activateListeners — so setting this afterwards would leave the hotspots dead.
			//
			// Both halves of what a hotspot can carry, because the pin layer has two kinds of
			// control on it and only one of them names a place. An edge arrow with no `node` (the
			// "Steplands & Marshedge" one) renders `data-slug=""` and means "move out a tier", and
			// the panel's own handler has always read it that way — so without the `tier` arm that
			// arrow would sit here wearing a tooltip promising a zoom and do nothing at all.
			onPick: data => journeyPick(data, {
				pick: (field, slug) => this._pick(field, slug),
				showTier: tier => this.showTier(tier),
			}),
		}, options);
		this._tier = tier;
		this._source = source;
		this._journey = journey ?? null;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["stonetop", "stonetop-image-zoom", "stonetop-travel-map-app"],
			template: TEMPLATE,
			width: 900,
			height: 800,
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
	}

	/**
	 * The three controls around the picture, forwarded to the same planner the walkthrough uses.
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
			pick: (field, slug) => this._pick(field, slug),
			showTier: tier => this.showTier(tier),
			toScene: () => this._source?.toScene?.(),
		});
	}

	/**
	 * Write a choice through the planner, then re-read everything it changed.
	 *
	 * The planner is told WHICH window asked, so its own sweep over the open maps skips this one:
	 * every build is a graph solve, an art browse and a template render, and re-reading here and
	 * being re-read from over there is the same answer computed twice for one click.
	 */
	async _pick(field, slug) {
		await this._source?.pick?.(field, slug, this);
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
		// Two independent renders of the same journey: started together rather than one after the
		// other, since neither reads the other's markup.
		const [controlsHtml, routeHtml] = await Promise.all([
			chrome ? renderTemplate(CONTROLS_TEMPLATE, { journey: this._journey }) : null,
			foot ? renderTemplate(ROUTE_TEMPLATE, { journey: this._journey }) : null,
		]);
		if (chrome) chrome.innerHTML = controlsHtml;
		if (foot) foot.innerHTML = routeHtml;
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
