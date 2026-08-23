// The wiring for the journey partials, in one place because the MARKUP is in one place.
//
// `expedition-journey-controls.hbs` is rendered by two surfaces — the walkthrough's route step and
// the "see the whole map" popout — and both used to bind it themselves, once in jQuery and once in
// DOM, from the same three selectors. Adding a control then meant remembering the second file, and
// a surface that forgot got a button that reads as live and does nothing.
//
// Both surfaces re-render this markup rather than mutating it (the panel through a full render, the
// popout through `sync`), so these bind onto freshly created nodes every time and never accumulate.


/**
 * Every kind of mark the pin layer carries, as one selector.
 *
 * IT ANSWERS THREE QUESTIONS and has to give all three the same answer. It is what the popout hands
 * `ImageZoomWindow` as its `controls`, which decides both which overlay children are clickable at
 * all and which presses must NOT start a pan; and it is what the drawing mode passes as its
 * `ignore`, which decides which clicks already mean something and must not also become marks. A
 * mark left out of it is a button that cannot be pressed on one surface and one that lays a stray
 * point on top of itself on the other — so it is written once, here, beside the rule that says what
 * each of them means.
 */
export const JOURNEY_MARKS = "[data-slug], [data-tier], [data-site-uuid]";

/** The one mark that claims the right-click for itself: a site, which lifts back off with it. */
export const JOURNEY_RIGHT_CLICK_MARKS = "[data-site-uuid]";

/**
 * Wire the controls that sit around a journey map.
 *
 * @param {HTMLElement|null} root         Anything containing the controls partial. A missing one is
 *                                        a no-op, so a caller need not know whether the route step
 *                                        is the one on screen.
 * @param {object}   handlers
 * @param {Function} handlers.pick        `(field, slug)` — writes a choice through the planner.
 * @param {Function} handlers.showTier    `(tier)` — changes which map is showing.
 * @param {Function} [handlers.zoom]      `(tier)` — opens the popout. Omitted BY the popout, which
 *                                        is already the thing that button opens.
 * @param {Function} [handlers.toScene]   `()` — puts the route on the scene the reader is looking
 *                                        at, or takes it back off. Bound by BOTH surfaces, unlike
 *                                        `zoom`: the popout is a peer of the panel, and this button
 *                                        means exactly the same thing in either of them.
 * @param {Function} [handlers.placeSite] `()` — drops one of the GM's own written-up sites on the
 *                                        map showing HERE. Bound by both surfaces for the same
 *                                        reason as `toScene`, and the surface supplies the picture
 *                                        to click on, since that is the one thing they differ in.
 * @param {Function} [handlers.drawByHand] `(on)` — starts or stops laying the way out by hand.
 * @param {Function} [handlers.clearDrawn] `()` — throws away the marks and leaves the mode on.
 */
export function bindJourneyControls(root, {
	pick, showTier, zoom = null, toScene = null, placeSite = null,
	drawByHand = null, clearDrawn = null,
} = {}) {
	if (!root) return;

	root.querySelector(".stonetop-journey-origin")
		?.addEventListener("change", ev => pick("origin", ev.currentTarget.value));
	root.querySelector(".stonetop-journey-clear")
		?.addEventListener("click", () => pick("destination", ""));
	// Both things that change the map: the tabs, and the "show me the map that DOES draw this"
	// button the readout offers when this one cannot draw the route (utils/route-path.js offMapNote).
	// Two selectors rather than a bare `[data-tier]`, because the edge arrows on the pin layer
	// carry that attribute too and are delegated instead, through `journeyPick`.
	for (const tab of root.querySelectorAll(".stonetop-journey-tier, .stonetop-journey-elsewhere")) {
		tab.addEventListener("click", () => showTier(tab.dataset.tier));
	}

	// Only ever ONE of these in a surface, unlike the tier tabs: it is a single act on a single
	// scene, and the partial renders it only for a GM with a destination picked.
	if (toScene) {
		root.querySelector(".stonetop-journey-to-scene")?.addEventListener("click", () => toScene());
	}

	// Also one per surface, and GM-only in the partial: the button opens a chooser and then arms
	// the map for a click, and both halves of that write to a journal a player cannot touch.
	if (placeSite) {
		root.querySelector(".stonetop-journey-place-site")?.addEventListener("click", () => placeSite());
	}

	// Lay the way out by hand rather than by the table (utils/custom-route.js). A checkbox and not
	// a button, because it is a state the map stays in and not an act: while it is ticked, every
	// click on the picture is a mark, and the reader has to be able to see at a glance which of
	// those two maps they are looking at.
	if (drawByHand) {
		root.querySelector(".stonetop-journey-custom")
			?.addEventListener("change", ev => drawByHand(ev.currentTarget.checked));
	}
	// Its own control rather than the × beside the destination, which still means what it always
	// meant. Throwing the marks away and choosing where the party is bound are different acts, and
	// one button doing whichever depending on a checkbox is how a GM loses a route they had spent a
	// minute laying out.
	if (clearDrawn) {
		root.querySelector(".stonetop-journey-clear-drawn")?.addEventListener("click", () => clearDrawn());
	}

	if (!zoom) return;
	for (const btn of root.querySelectorAll(".stonetop-journey-zoom")) {
		btn.addEventListener("click", () => zoom(btn.dataset.key));
	}
}

/**
 * What a click on a hotspot MEANS, for the pins, the edge arrows, the sites and the destination
 * list alike.
 *
 * One rule in one place: a `siteUuid` is the GM's own prep and opens its write-up, a `slug` names
 * a place the books charted and chooses it, and a bare `tier` is an edge arrow off the side of the
 * map and only zooms out. Both surfaces read the same dataset off the same partials, so both have
 * to agree about this or the same arrow does two different things.
 *
 * A SITE IS TESTED FIRST because it is the only one of the three that names something outside the
 * travel table: a site pin carries no slug and no tier, so the order costs nothing today, and it
 * says which reading wins should a pin ever come to carry both.
 *
 * A PLACE GOES TO THE PLANNER, always, and what it MEANS is decided there rather than here.
 * Normally it sets where the party is bound. While the GM is laying the way out by hand it is a
 * STOP on that way instead, held with the shift key to add a leg rather than move the last one — so
 * the event comes through, because the modifier is half of what the click said. Keeping that
 * decision in the planner is what lets the popout, whose handler is bound once in its constructor
 * and never rebound, still get the right answer after the box is ticked; and this function having
 * no second opinion of its own is what stops the two from ever giving different ones.
 *
 * @param {DOMStringMap|object} data  A hotspot's dataset: `{ siteUuid, slug, tier }`, any absent.
 * @param {Event|null} ev             the click itself, for the modifiers on it.
 */
export function journeyPick({ siteUuid, slug, tier } = {}, { showTier, openSite = null, markPlace = null } = {}, ev = null) {
	if (siteUuid) openSite?.(siteUuid);
	else if (slug) markPlace?.(slug, ev);
	else if (tier) showTier(tier);
}

/**
 * Wire "take this site back off the map", on whichever surface is drawing the pins.
 *
 * A RIGHT-CLICK, and the pin's own tooltip says so. Lifting a pin is not deleting the site (the
 * write-up stays exactly where it was, on the Sites tab), so it does not want the confirm-and-warn
 * chrome the trash on that tab carries; but it is also not something to leave a visible × sitting
 * on every pin for, on a map whose whole point is that eleven labels do not collide. The tooltip
 * is where this map already teaches what a mark does.
 *
 * DELEGATED ON A ROOT THAT OUTLIVES THE PINS. Both surfaces replace the pin layer wholesale — the
 * panel by re-rendering, the popout through `setOverlay` — so a listener bound per pin would be
 * gone after the first placement.
 *
 * @param {HTMLElement|null} root
 * @param {Function} remove  `(uuid)` — takes that site off the map it is on.
 */
export function bindJourneySiteRemoval(root, remove) {
	if (!root || !remove) return;
	root.addEventListener("contextmenu", ev => {
		const pin = ev.target.closest?.(".stonetop-journey-site");
		if (!pin || !root.contains(pin)) return;
		ev.preventDefault();
		ev.stopPropagation();
		remove(pin.dataset.siteUuid);
	});
}

