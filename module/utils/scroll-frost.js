// Gate for the frosted seam between a sheet's pinned header and the tab scrolling under it
// (the band itself is `.stonetop-sheet-layout .sheet-body::before` in stonetop.css).
//
// It has to be gated, not simply painted. A band that is always there blurs the top of the
// tab's first row even when nothing has scrolled anywhere, which reads as a rendering fault
// rather than a depth cue. So the class goes on only while the active tab is off its top.
//
// Why JS at all: the band cannot live inside the scrollport (each tab is its own, and the
// band would scroll away with the content), so it sits on `.sheet-body` — outside every
// scroller — and CSS has no way to ask "is my descendant scrolled". A scroll-driven
// animation (`animation-timeline: scroll()`) resolves against the animated element's own
// scrolling ancestor, which for the band is the window, not the tab.

/** Below this many pixels the tab is still visually at rest — no seam to soften. */
const AT_REST = 1;

/**
 * Read the active tab's offset and mark the body that holds the band.
 * Queried from `root` on every call rather than captured: the frame outlives the form, so a
 * handler bound to it once would otherwise be pointing at a previous render's elements.
 * @param {HTMLElement} root  Anything containing the sheet layout (frame or form).
 */
function refresh(root) {
	for (const body of root?.querySelectorAll?.(".stonetop-sheet-layout .sheet-body") ?? []) {
		const tab = body.querySelector(":scope > .tab.active");
		body.classList.toggle("is-scrolled", (tab?.scrollTop ?? 0) > AT_REST);
	}
}

/**
 * Scroll handler. The event's target IS the scrolled tab, so this reads one `scrollTop` and
 * touches one class list — no queries — on a listener that fires per frame of a scroll gesture.
 *
 * Declared once at module scope rather than as a closure over the form, which is what lets the
 * duplicate-bind guard work: `addEventListener` de-duplicates identical
 * (type, listener, capture) triples, so re-binding on a second `activateListeners` for the same
 * render is a no-op instead of stacking another handler on the layout.
 *
 * Inactive tabs are ignored: `_restoreScrollPositions` writes `scrollTop` on every tab, not
 * just the visible one, and those events must not stamp the band from a hidden tab's offset.
 */
function onScroll(ev) {
	const tab = ev.target;
	if (!(tab instanceof HTMLElement) || !tab.classList.contains("tab") || !tab.classList.contains("active")) return;
	const body = tab.parentElement;
	if (body?.classList.contains("sheet-body")) body.classList.toggle("is-scrolled", tab.scrollTop > AT_REST);
}

/** Marks a frame whose tab-rail watcher is already bound — see the guard below. */
const RAIL_WATCH = Symbol("stonetop.scrollFrostRailWatch");

/**
 * Wire the frosted seam for a sheet. Safe on a sheet that has no tab layout (does nothing)
 * and on every render.
 * @param {Application} app   The sheet being rendered.
 * @param {jQuery|HTMLElement} html   The inner form handed to activateListeners.
 */
export function mountScrollFrost(app, html) {
	const frame = app?.element?.[0] ?? app?.element;
	const form  = html?.[0] ?? html;
	if (!(form instanceof HTMLElement)) return;
	const layout = form.querySelector(".stonetop-sheet-layout");
	if (!layout) return;

	// `scroll` does not bubble, but it does CAPTURE, so one listener on the layout hears
	// every tab — including the ones this render has never shown. Bound to the form's own
	// layout, so it is replaced along with the form and never accumulates. `onScroll` is a
	// module-level function rather than a closure so that a second `activateListeners` for
	// the same render re-registers an identical triple, which the DOM discards.
	layout.addEventListener("scroll", onScroll, { capture: true, passive: true });

	// Switching tabs swaps which scrollport is under the band, and the browser hands the
	// incoming tab back the offset it was left at, so the band has to be re-read then too.
	// Bound to the window FRAME, which is the one node that outlives a re-render AND
	// contains the nav in either layout: the modern rail has been lifted onto the frame by
	// mountTabRail, and the classic strip is still inside `.window-content`, a frame
	// descendant. Hence the guard: bind the watcher once per window, not once per render.
	if (frame instanceof HTMLElement && !frame[RAIL_WATCH]) {
		frame[RAIL_WATCH] = true;
		// Capture, and on the next frame: the Tabs controller moves `.active` on the click
		// that follows, so reading in the same tick would measure the outgoing tab.
		frame.addEventListener("click", ev => {
			// `nav.sheet-tabs`, not `nav.stonetop-tab-rail`: both layouts' navs carry it (the
			// rail is `class="sheet-tabs tabs stonetop-tab-rail"`), and this listener is bound
			// ONCE for the life of the window. A selector chosen from the layout setting at
			// bind time would freeze at whatever the layout was on first render and stop
			// matching the moment the user flipped it, leaving the band stuck on the outgoing
			// tab's scroll state. It has to match both, statically.
			if (!ev.target?.closest?.("nav.sheet-tabs")) return;
			requestAnimationFrame(() => refresh(frame));
		}, true);
	}

	// A re-render rebuilds the tabs and Foundry puts their scroll offsets back, so the band's
	// state has to be recomputed rather than assumed clear. Only on the next frame:
	// `_restoreScrollPositions` runs AFTER `activateListeners`, so reading now would measure a
	// freshly built tab still pinned at 0 — and a fresh form carries no `is-scrolled` to clear.
	requestAnimationFrame(() => refresh(form));
}

/**
 * The same gate for a lone scrollport that carries its own band, a sticky `::before` pinned to
 * its top edge (the Outfit window's two lists): `is-scrolled` on the scroller itself while it is
 * off its top. The scroller is the one being watched, so there is no tab to look up.
 * @param {HTMLElement} scroller
 */
export function mountScrollerFrost(scroller) {
	if (!scroller?.addEventListener) return;
	const mark = () => scroller.classList.toggle("is-scrolled", scroller.scrollTop > AT_REST);
	scroller.addEventListener("scroll", mark, { passive: true });
	// Core puts a kept offset back AFTER activateListeners (scrollY), so read again next frame.
	mark();
	globalThis.requestAnimationFrame?.(mark);
}
