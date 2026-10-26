/**
 * Foundry's tooltip (game.tooltip) goes by the pointer, not the DOM: it opens on pointerenter and
 * closes on pointerleave, and an element taken out of the page never gets its pointerleave. Until
 * the pointer moves again, a tooltip on a swapped-out or re-rendered element hangs where it was.
 * These are the one place this system deals with that.
 */

const TOOLTIPPED = "[data-tooltip-text], [data-tooltip-html], [data-tooltip]:not([data-tooltip=''])";

/**
 * Replace `from` with `to` in place, and take the tooltip across: if `from` owned it (open, or
 * still waiting to open under the pointer), take it down, and put `to`'s up only if the pointer
 * was on `from`, so an element left by a click elsewhere opens no tooltip where nobody points.
 * Hover is read before the swap: the browser re-reads it only on the next frame.
 */
export function replaceKeepingTooltip(from, to) {
	const tt = game.tooltip;
	const pointed = !!from.matches?.(":hover");
	const owned = !!tt && (tt.element === from || (!tt.element && pointed));
	from.replaceWith(to);
	if (!owned) return;
	tt.deactivate();
	if (pointed) tt.activate(to);
}

/**
 * Take the tooltip down if it is open on an element inside `root` (and, given a `selector`, inside
 * a match of it), ahead of a re-render that will take that element out of the page. Returns the
 * element it was on, for restoreTooltip should the re-render not happen after all, or null.
 */
export function dropTooltipWithin(root, selector = null) {
	const tt = game.tooltip;
	const el = tt?.element;
	if (!el || !root?.contains?.(el) || (selector && !el.closest?.(selector))) return null;
	tt.deactivate();
	return el;
}

/** Put the tooltip back on `el` if it is still in the page, under the pointer, and no other has it. */
export function restoreTooltip(el) {
	const tt = game.tooltip;
	if (!tt || !el || el.isConnected === false || tt.element || !el.matches?.(":hover")) return;
	tt.activate(el);
}

/**
 * After any window renders: a tooltip left on an element the render took out of the page comes
 * down, and opens on the tooltipped element under the pointer now (read a frame later, once the
 * browser has re-read hover), as Foundry would on the pointer's next move.
 */
export function dropOrphanedTooltip() {
	const tt = game.tooltip;
	const el = tt?.element;
	if (!el || el.isConnected) return;
	tt.deactivate();
	requestAnimationFrame(() => {
		if (tt.element) return;
		const target = [...document.querySelectorAll(":hover")].pop()?.closest?.(TOOLTIPPED);
		if (target) tt.activate(target);
	});
}

/** Register dropOrphanedTooltip for every window, V1 and V2. Call once, in init. */
export function registerOrphanedTooltipCleanup() {
	Hooks.on("renderApplication", dropOrphanedTooltip);
	Hooks.on("renderApplicationV2", dropOrphanedTooltip);
}
