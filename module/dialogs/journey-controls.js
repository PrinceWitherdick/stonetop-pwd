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
 */
export function bindJourneyControls(root, { pick, showTier, zoom = null } = {}) {
	if (!root) return;

	root.querySelector(".stonetop-journey-origin")
		?.addEventListener("change", ev => pick("origin", ev.currentTarget.value));
	root.querySelector(".stonetop-journey-clear")
		?.addEventListener("click", () => pick("destination", ""));
	for (const tab of root.querySelectorAll(".stonetop-journey-tier")) {
		tab.addEventListener("click", () => showTier(tab.dataset.tier));
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
