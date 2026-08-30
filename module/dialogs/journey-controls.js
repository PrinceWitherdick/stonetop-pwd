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
 * @param {Function} [handlers.clearDrawn] `()` — throws the hand-drawn marks away, which is also
 *                                        what ends the drawing: the marks ARE the mode.
 *
 * NO HANDLER FOR THE TWO ENDS OF THE JOURNEY ANY MORE. There was a "Setting out from Stonetop"
 * button here that armed the next click, and an × that un-picked the destination. Both are gone,
 * and with them the row they sat in: the trip is planned by clicking the picture and taken apart by
 * right-clicking it (ExpeditionDialog `_undoJourneyMark`), which the surfaces arm for themselves
 * off the journey. What is left in this file is the chrome AROUND the map — which map, and the
 * three acts that are about something other than the trip.
 */
export function bindJourneyControls(root, {
	showTier, zoom = null, toScene = null, placeSite = null, clearDrawn = null,
} = {}) {
	if (!root) return;

	// Both things that change the map: the tabs, and the "show me the map that DOES draw this"
	// button the readout offers when this one cannot draw the route (utils/route-path.js offMapNote).
	// Two selectors rather than a bare `[data-tier]`, because the edge arrows on the pin layer
	// carry that attribute too and are delegated instead, through `journeyPick`.
	for (const tab of root.querySelectorAll(".stonetop-journey-tier, .stonetop-journey-elsewhere")) {
		tab.addEventListener("click", () => showTier(tab.dataset.tier));
	}

	// Only ever ONE of these in a surface, unlike the tier tabs: it is a single act on a single
	// scene, and the partial renders it only for a GM with a route to draw. It rides the end of the
	// map-tab row beside "put a site on the map" (user, 2026-08-24) — both are acts on the picture
	// showing here rather than facts about the trip, and the row of facts they used to sit above
	// has gone.
	if (toScene) {
		root.querySelector(".stonetop-journey-to-scene")?.addEventListener("click", () => toScene());
	}

	// Also one per surface, and GM-only in the partial: the button opens a chooser and then arms
	// the map for a click, and both halves of that write to a journal a player cannot touch.
	if (placeSite) {
		root.querySelector(".stonetop-journey-place-site")?.addEventListener("click", () => placeSite());
	}

	// Throw away a way laid out by hand (utils/custom-route.js), which is also the way OUT of
	// drawing it: there is no mode to switch off, only marks, and this takes the lot. The ONE
	// control on this screen that is not a gesture on the picture, and it earns that: undoing
	// thirty marks one right-click at a time is not a thing to ask of anybody.
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
 * One rule in one place: a `siteUuid` is one of the GM's own written-up places, a `slug` names a
 * place the books charted, and a `tier` is an edge arrow off the side of the map. Both surfaces read
 * the same dataset off the same partials, so both have to agree about this or the same arrow does
 * two different things.
 *
 * AN ARROW DOES BOTH, WHEN IT NAMES A PLACE (user, 2026-08-25). Only a pin on the edge carries a
 * tier at all, and the whole of what one says is "the road goes on, off this paper, that way" — so
 * following it has to actually go there. The two Vicinity arrows that name one place used to pick it
 * and stay put, which left a GM who had just chosen Gordin's Delve staring at a map Gordin's Delve is
 * not drawn on, while the third arrow beside them ("To Steplands & Marshedge", which names two places
 * and so can only zoom) moved out to the World's End as asked. One arrow, one meaning: it picks what
 * it names AND it moves out a tier, which is what TRAVEL_EXITS has always said it meant.
 *
 * THE PICK IS AWAITED FIRST, and the order is the whole of why this is not two independent calls.
 * Writing the destination is what re-decides which map the panel is pinned to (`_setJourneyPlace`),
 * and on a trip out of Stonetop it decides on the VICINITY — because the Vicinity does draw both
 * ends, the far one being this very arrow. Zooming before that lands would be the pick undoing the
 * zoom a moment later, silently, with nothing on screen to say why the map came back.
 *
 * AN ARROW POINTING PAST EVERY MAP still only picks, and needs no arm of its own: the Lygos arrow's
 * tier is `beyond`, which is a group in the destination list rather than a picture, and both
 * surfaces' `showTier` already refuse a tier no map draws.
 *
 * A SITE IS A PLACE ON THE WAY, and no longer a link to a journal (user, 2026-08-24). Tapping one
 * used to open its write-up, which made the GM's own barrow the ONE mark on this map that could not
 * be part of the journey drawn across it — on a screen whose whole purpose is saying how the party
 * gets somewhere, and where the somewhere is very often that barrow. It goes to the planner now
 * exactly as a lettered place does, and lays a stop on the way there. The write-up is still one
 * click away on the steading's Sites tab, which is where it is written and where it belongs.
 *
 * A SITE IS TESTED FIRST because it is the only one of the three that names something outside the
 * travel table: a site pin carries no slug and no tier, so the order costs nothing today, and it
 * says which reading wins should a pin ever come to carry both.
 *
 * WHAT EITHER KIND OF PLACE MEANS IS DECIDED IN THE PLANNER, never here. On a trip with no start it
 * says where the party sets out from; with a start, a plain click puts the far end of the way there
 * and a SHIFT-click adds it as another stop — so the event comes through, because the modifier is
 * half of what the click said. Three readings of one click, and none of them lives in this file.
 * Keeping that decision in the planner is what lets the popout, whose handler is bound once in its
 * constructor and never rebound, still get the right answer after the first mark goes down; and
 * this function having no second opinion of its own is what stops the two from ever giving
 * different ones.
 *
 * @param {DOMStringMap|object} data  A hotspot's dataset: `{ siteUuid, slug, tier }`, any absent.
 * @param {Event|null} ev             the click itself, for the modifiers on it.
 */
export async function journeyPick({ siteUuid, slug, tier } = {}, { showTier, markSite = null, markPlace = null } = {}, ev = null) {
	if (siteUuid) return markSite?.(siteUuid, ev);
	// The bare arrow ("To Steplands & Marshedge"), which renders `data-slug=""` and has only ever
	// meant "move out a tier", and every mark that names nothing at all.
	if (!slug) return tier ? showTier(tier) : undefined;
	await markPlace?.(slug, ev);
	if (tier) return showTier(tier);
	return undefined;
}

/**
 * Wire the right-click ladder onto the rows of the destination list.
 *
 * BECAUSE THE LIST IS THE MAP, IN A WORLD THAT NEVER IMPORTED THE BOOK ART. Right-clicking the
 * picture is what takes a trip back a step now — the last mark, then the destination, then the
 * start (ExpeditionDialog `_undoJourneyMark`) — and that is the whole way back, since the row of
 * controls that used to offer one is gone. A GM with no map on disk would otherwise have a trip
 * they could set and never un-set: no picture to right-click, and so no way to reach the state
 * where the next click says where the party is. The rows already answer the forward gesture; this
 * is the same bargain the other way.
 *
 * ONLY THE ROWS, not the whole step. A right-click means "take one thing back" and it should be
 * asked over something that IS the trip; over the readout or the hint text it would be the
 * browser's own menu going missing for no reason. The map inside this root is not double-bound
 * either: its own watch takes the event in the bubble phase and swallows it before this delegate
 * would see it (utils/pick-point-on-image.js), and where that watch is not armed there is nothing
 * to take back anyway.
 *
 * DELEGATED ON A ROOT THAT OUTLIVES THE ROWS, exactly as the site removal below is: the panel
 * re-renders on every gesture, so a listener bound per row would be gone after the first one.
 *
 * @param {HTMLElement|null} root
 * @param {Function} undo  `()` — takes the trip back one step.
 */
export function bindJourneyUndo(root, undo) {
	delegateContextMenu(root, undo, ".stonetop-journey-row", () => undo());
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
	delegateContextMenu(root, remove, ".stonetop-journey-site", pin => remove(pin.dataset.siteUuid));
}

/**
 * One right-click gesture, delegated on a root that outlives what it acts on.
 *
 * Both binders here want the same four things and for the same reasons -- the `contains` check
 * (a `closest` can walk out of a detached root), and `preventDefault` + `stopPropagation` so the
 * browser menu stays shut and the canvas behind a dialog does not open its own on the way past.
 * Written once, because those are exactly the details that drift when a second copy is edited:
 * two right-click handlers on one root have to agree about what they swallow or they fight.
 *
 * @param {HTMLElement|null} root
 * @param {Function|null} fn    the callback; a missing one binds nothing at all
 * @param {string} selector     what under `root` the gesture belongs to
 * @param {Function} run        `(hit) => void` -- given the matched element
 */
function delegateContextMenu(root, fn, selector, run) {
	if (!root || !fn) return;
	root.addEventListener("contextmenu", ev => {
		const hit = ev.target.closest?.(selector);
		if (!hit || !root.contains(hit)) return;
		ev.preventDefault();
		ev.stopPropagation();
		run(hit);
	});
}
