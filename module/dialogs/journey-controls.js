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
 */
export function bindJourneyControls(root, { pick, showTier, zoom = null, toScene = null } = {}) {
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

	if (!zoom) return;
	for (const btn of root.querySelectorAll(".stonetop-journey-zoom")) {
		btn.addEventListener("click", () => zoom(btn.dataset.key));
	}
}

/**
 * What a click on a hotspot MEANS, for the pins, the edge arrows and the destination list alike.
 *
 * One rule in one place: a `slug` names a place and chooses it, while a bare `tier` is an edge
 * arrow off the side of the map and only zooms out. Both surfaces read the same dataset off the
 * same partials, so both have to agree about this or the same arrow does two different things.
 *
 * @param {DOMStringMap|object} data  A hotspot's dataset: `{ slug, tier }`, either may be absent.
 */
export function journeyPick({ slug, tier } = {}, { pick, showTier } = {}) {
	if (slug) pick("destination", slug);
	else if (tier) showTier(tier);
}
