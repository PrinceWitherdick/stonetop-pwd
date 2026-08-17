// Lift the vertical tab rail out of the sheet body and onto the window frame, so it hangs
// OFF the sheet's right edge rather than sitting inside the content area — the shape
// dnd5e's character sheet uses (`nav.tabs.tabs-right`: absolutely positioned at `left: 100%`
// on the application element, outside the window body).
//
// This cannot be done from the template alone. An AppV1 sheet renders entirely into
// `.window-content`, and our sheets need that element to keep `overflow-y: auto` — it is the
// last-resort scroller for a window dragged shorter than the tab body's floor — so a rail
// left inside it is simply clipped at the window's edge.
//
// The template therefore renders the rail inside the form, where Foundry finds and binds it
// normally, and this helper moves the already-bound node out to the frame. Nothing breaks in
// the move: `Application#_activateCoreListeners` binds the Tabs controller against
// `.window-content` and runs BEFORE `activateListeners`, so by the time we relocate, the
// controller is holding a direct reference to this exact element — and relocating a node
// neither detaches its listeners nor invalidates that reference. `Tabs#activate` looks up
// its nav items and its panels from two independently stored roots, so the rail no longer
// being an ancestor-sibling of `.sheet-body` costs nothing either.
//
// Re-renders are the one wrinkle. `Application#_replaceHTML` only replaces the CONTENTS of
// `.window-content`, so a rail already lifted onto the frame is a sibling of that element and
// survives untouched while a fresh rail arrives inside the new form. Clear the old one first
// or every render strands another copy on the frame.
//
// Hanging outside the window also means nothing keeps the rail on screen, so this file measures
// two things and stamps both on the frame for the stylesheet to act on: `--st-rail-top` (how far
// down the rail starts, off the sheet's own header banner) and `stonetop-tab-rail-left` (which
// edge it hangs off, when the right-hand one runs out of viewport). See `railTopFor` and
// `railHangsLeft` below — both pure, both with a failure mode that renders perfectly and puts
// the rail somewhere useless.

/**
 * Move a sheet's tab rail from its rendered position inside the form out onto the window
 * frame. Safe to call on a sheet with no rail (does nothing) and on every render.
 * @param {Application} app   The sheet being rendered.
 * @param {jQuery|HTMLElement} html   The inner form handed to activateListeners.
 */
/** Which form's render a mounted rail came from — see the idempotency guard below. */
const RAIL_SOURCE = Symbol("stonetop.tabRailSource");

export function mountTabRail(app, html) {
	const frame = app?.element?.[0] ?? app?.element;
	const form  = html?.[0] ?? html;
	if (!(frame instanceof HTMLElement) || !(form instanceof HTMLElement)) return;

	// Idempotency guard. Called twice for the same render — and `activateListeners` is not
	// guaranteed to run only once per render — the naive version destroys the rail: the first
	// call moves it to the frame, and the second sees it there, discards it as stale, then
	// finds nothing left in the form to replace it with. Remembering which form a mounted rail
	// came from tells the two cases apart, since every render brings a brand new form element.
	const mounted = frame.querySelector(":scope > nav.stonetop-tab-rail");
	if (mounted && mounted[RAIL_SOURCE] === form) {
		stampRailTop(frame, form);
		watchRailSide(app, frame);
		return;
	}

	// Drop the rail this sheet lifted out on a PREVIOUS render (see above).
	for (const stale of frame.querySelectorAll(":scope > nav.stonetop-tab-rail")) stale.remove();

	// A sheet can render without one — a character with no playbook yet shows the "Create
	// Character" call-to-action instead of the tabbed body — so the marker has to come OFF
	// again, not just go on. Otherwise assigning and then clearing a playbook leaves the
	// frame claiming a rail it no longer has.
	const rail = form.querySelector("nav.stonetop-tab-rail");
	// Marks the frame as carrying a rail: the styles hang the nav outside the window from
	// there, and a window whose content is clipped would clip the rail away with it.
	frame.classList.toggle("stonetop-has-tab-rail", !!rail);
	if (!rail) {
		frame.classList.remove("stonetop-tab-rail-left");
		return;
	}
	rail[RAIL_SOURCE] = form;
	frame.appendChild(rail);
	stampRailTop(frame, form);
	watchRailSide(app, frame);
}

/** Gap between the sheet header and the top of the rail — dnd5e's `+ 1rem`, in px. */
const RAIL_HEADER_GAP = 16;

/**
 * How far below the frame's top the rail should start, in UNTRANSFORMED pixels.
 *
 * Both rects come from `getBoundingClientRect`, which reports post-transform pixels — but the
 * number is written into `--st-rail-top` and consumed by `top:` on a child of the transformed
 * frame, where it is scaled a SECOND time. Dividing the measured distance back out is what
 * keeps the units consistent. Without it, a sheet at `position.scale` 1.5 (or a client running
 * a 150% Interface Scale) starts its rail half again too far down the window, and drags the
 * companion `max-height: max(96px, calc(100% - var(--st-rail-top)))` down with it, so a rail
 * that fits perfectly well begins to scroll.
 *
 * The scale is derived from the frame's own two widths rather than from `app.position.scale`,
 * so however many transforms are stacked upstream, they land in one number.
 *
 * `scrolledBy` is added back AFTER the divide, not before: it is already an untransformed number
 * (`scrollTop` always is), where the two rects are not. It is zero on every sheet whose header is
 * pinned, which is all of them but the GM Toolkit — that frame scrolls as a single unit with its
 * banner inside the scroll, and the rail is mounted on the window FRAME, outside it. Without this
 * term a re-render landing while the sheet is scrolled measures the banner where it has ridden up
 * to and stamps the rail there with it; on the toolkit that is every threat, hazard and site
 * write. Reading the anchor's at-rest position instead makes the stamp the same number at any
 * offset, so the rail simply does not move.
 *
 * Pure, and exported, so the arithmetic can be tested without a browser.
 * @param {{bottom: number}} anchorRect       The sheet header banner's client rect.
 * @param {{top: number, width: number}} frameRect   The window frame's client rect.
 * @param {number} frameOffsetWidth           The frame's untransformed border-box width.
 * @param {number} [scrolledBy]               How far the anchor has been scrolled up inside the
 *   frame, in untransformed px — see `scrolledAwayBy`.
 * @returns {number} px
 */
export function railTopFor(anchorRect, frameRect, frameOffsetWidth, scrolledBy = 0) {
	const scale = (frameOffsetWidth && frameRect.width / frameOffsetWidth) || 1;
	return Math.round((anchorRect.bottom - frameRect.top) / scale + scrolledBy) + RAIL_HEADER_GAP;
}

/**
 * How far `anchor` has been scrolled up by scrollports between it and `frame`.
 *
 * Summed over the whole chain rather than taken from the nearest scrolling ancestor: a sheet can
 * nest scrollports (`.window-content` carries a last-resort `overflow-y: auto` on top of whatever
 * the sheet's own scroller is), and only the total says where the anchor sits at rest.
 *
 * `scrollTop` is 0 on a non-scrolling element, so this reads as 0 on every pinned-header sheet
 * without asking for computed overflow — cheaper than `scrollParent`, and it cannot pick the
 * wrong one of two.
 *
 * @param {HTMLElement} anchor  the header banner being measured.
 * @param {HTMLElement} frame   the window frame; the walk stops below it.
 * @returns {number} px
 */
function scrolledAwayBy(anchor, frame) {
	let total = 0;
	for (let el = anchor.parentElement; el && el !== frame; el = el.parentElement) total += el.scrollTop;
	return total;
}

/**
 * Should the rail hang off the window's LEFT edge instead of its right?
 *
 * The rail lives OUTSIDE the window, and core lets a window sit flush against the right edge of
 * the viewport — `setPosition` clamps left to `Math.max(window.innerWidth - scaledWidth, 0)`.
 * Drag any sheet fully right, or open the 960px-wide character sheet on a 1024px browser window,
 * and the default `left: 100%` puts every tab past `innerWidth` where nothing can reach them.
 * There is no horizontal strip to fall back to either: the classic tab strip is behind an
 * off-by-default client setting. So flip when the rail no longer fits on the right and the left
 * has more room to offer.
 *
 * Reads only the FRAME's box. An absolutely positioned rail contributes nothing to that, so the
 * answer is the same in both states and the decision cannot oscillate frame to frame.
 *
 * Pure, and exported, for the same reason as `railTopFor`.
 * @param {{left: number, right: number}} frameRect
 * @param {number} railWidth
 * @param {number} viewportWidth
 * @returns {boolean}
 */
export function railHangsLeft(frameRect, railWidth, viewportWidth) {
	const spaceRight = viewportWidth - frameRect.right;
	return railWidth > spaceRight && frameRect.left > spaceRight;
}

/**
 * Set `--st-rail-top`: how far down the window the rail starts.
 *
 * dnd5e hangs its rail off the bottom of the sheet's own header banner — the portrait /
 * name / level block — not off the window's title bar:
 *
 *     nav.tabs { top: calc(var(--dnd5e-sheet-header-height) + 1rem); }   (v2/actors.less)
 *
 * with that variable a flat 170px. Ours are content-sized (a two-line name, a steading with
 * no portrait, an NPC header that collapses when there is no art), so there is no constant to
 * write down and the anchor is measured instead. Same rule, same 1rem, live numbers.
 *
 * On a sheet's FIRST render the frame is still `display: none` — `_injectHTML` does
 * `html.hide().fadeIn(200)`, and the fade's first tick lands after this runs — so everything
 * measures 0. Measuring on the next frame instead of now covers that, by which point the fade
 * has restored display and `setPosition` has sized the window. Re-renders keep the stamped
 * value on the frame (only `.window-content` is replaced), so nothing flickers while we wait —
 * and deferring keeps these `getBoundingClientRect` reads out of the same task as the
 * `appendChild` above, which would otherwise force a synchronous reflow on every render.
 * @param {HTMLElement} frame
 * @param {HTMLElement} form
 */
function stampRailTop(frame, form) {
	requestAnimationFrame(() => {
		// The edge is picked whatever happens to the top: a rail whose anchor cannot be found or
		// measured still has to be ON SCREEN, and it retries for itself.
		stampRailSide(frame);
		const anchor = form.querySelector(".stonetop-sheet-header, .steading-header");
		if (!anchor) return;
		const anchorRect = anchor.getBoundingClientRect();
		if (!anchorRect.height) return; // not laid out yet — see above
		const top = railTopFor(anchorRect, frame.getBoundingClientRect(), frame.offsetWidth,
			scrolledAwayBy(anchor, frame));
		// Writing a custom property invalidates style for the whole frame subtree, so don't
		// when it would not change anything — the common case on a re-render.
		const px = `${top}px`;
		if (frame.style.getPropertyValue("--st-rail-top") !== px) frame.style.setProperty("--st-rail-top", px);
	});
}

/** How many frames to keep waiting for a first-render fade to give the rail a width. */
const RAIL_MEASURE_RETRIES = 4;

/**
 * Measure the mounted rail and mark the frame with the edge it should hang off, so the
 * stylesheet can mirror it. The decision itself is `railHangsLeft`, above.
 * @param {HTMLElement} frame
 * @param {number} [retries]  Frames left to wait for a measurable rail.
 */
function stampRailSide(frame, retries = RAIL_MEASURE_RETRIES) {
	const rail = frame?.querySelector?.(":scope > nav.stonetop-tab-rail");
	if (!rail) return;
	const railWidth = rail.getBoundingClientRect().width;
	if (!railWidth) {
		// A sheet's FIRST render is still `display: none` behind `_injectHTML`'s fadeIn, so
		// everything measures 0. Unlike the top — which the frame keeps from the previous render
		// and re-stamps on the next one — the edge has no useful previous value on a first open,
		// and getting it wrong there is the case that hides the tabs. So wait a few frames for
		// the fade rather than settling for the default edge.
		if (retries > 0) requestAnimationFrame(() => stampRailSide(frame, retries - 1));
		return;
	}
	const left = railHangsLeft(frame.getBoundingClientRect(), railWidth, window.innerWidth);
	frame.classList.toggle("stonetop-tab-rail-left", left);
}

/**
 * Re-check the rail's edge whenever the window MOVES or RESIZES, not only when it re-renders.
 *
 * Dragging a sheet to the right edge is the ordinary way to lose the rail, and a drag never
 * re-renders — Foundry drives it entirely through `setPosition`, one call per frame. Wrapping
 * that on the instance is the tightest hook for it: it costs nothing on sheets with no rail
 * (never installed), and it dies with the sheet. Coalesced to one measurement per frame, since
 * a drag calls in at 60Hz and this reads layout.
 * @param {Application} app
 * @param {HTMLElement} frame
 */
function watchRailSide(app, frame) {
	if (app._stonetopRailSideWatched) return;
	app._stonetopRailSideWatched = true;
	const base = app.setPosition.bind(app);
	let queued = false;
	app.setPosition = function (options) {
		const position = base(options);
		if (!queued) {
			queued = true;
			requestAnimationFrame(() => {
				queued = false;
				stampRailSide(app.element?.[0] ?? frame);
			});
		}
		return position;
	};
}
