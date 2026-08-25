// Text fields that hold as much as an author actually writes into them.
//
// A form lays a prose field out at whatever height reads well empty, and then somebody pastes
// four paragraphs of an arcanum's front text into it. The box does not move: the text scrolls
// inside three visible lines, and editing it means reading it through a slot. That is the state
// every rich field on the arcanum editor was in, because a `<prose-mirror>` cannot size itself to
// its content the way a block of text would — core absolutely positions the editable area
// (`inset: 0`) inside a container that takes its height from the host, so the content has no say
// in it at all. A `<textarea>` has the same problem for the same reason.
//
// So the height is measured and set here, twice over:
//
//   - the field FITS its content, on render and as you type, up to the ceiling its stylesheet
//     sets (past that it scrolls, as it must — a field is not a page);
//   - and it still carries a drag handle, because a fit is a guess about how much of a long
//     description you want on screen at once, and the author is the one who knows. A height that
//     was dragged is remembered and never fitted over.
//
// The floor and ceiling live in CSS (`min-height` / `max-height`), not here: they are part of how
// the field looks, they differ per surface, and reading them back means the two cannot drift.

/** The height we last set on a field, so a resize we did is not mistaken for one the author did. */
const FITTED = new WeakMap();

/** Fields the author has dragged to a height of their own. Never fitted again while they live. */
const DRAGGED = new WeakSet();

/** Both kinds of growable field, as one selector. */
const FIELDS = "textarea, prose-mirror";

/**
 * The height a growable field should take.
 *
 * Pure, so the clamping can be tested without a layout engine — and the clamping is the part that
 * goes wrong: a field that fits its content but ignores its ceiling grows a sheet off the bottom
 * of the screen, and one that ignores its floor collapses to nothing the moment it is emptied.
 *
 * @param   {object} o
 * @param   {number} o.content   Height the content needs (a scrollHeight).
 * @param   {number} [o.chrome]  Height of what surrounds it (borders, a toolbar) — a scrollHeight
 *                               covers padding but never these.
 * @param   {number} [o.min]     Floor, from the stylesheet.
 * @param   {number} [o.max]     Ceiling, from the stylesheet; Infinity when it sets none.
 * @returns {number}  Pixels.
 */
export function fittedHeight({ content = 0, chrome = 0, min = 0, max = Infinity } = {}) {
	const wanted = Math.ceil(Math.max(0, content) + Math.max(0, chrome));
	return Math.min(Math.max(wanted, Math.max(0, min)), max > 0 ? max : Infinity);
}

/** One computed length in px off an already-resolved style, or `fallback` when it is not a length. */
function px(style, prop, fallback) {
	const n = Number.parseFloat(style?.[prop]);
	return Number.isFinite(n) ? n : fallback;
}

/** One computed length in px, or `fallback` when it is `none` / unset / not a length. */
function cssPx(el, prop, fallback) {
	return px(el.ownerDocument?.defaultView?.getComputedStyle?.(el), prop, fallback);
}

/**
 * The floor and ceiling the stylesheet gives a field.
 *
 * ONE style resolution for the pair. A fit runs on every keystroke, and resolving the computed
 * style is the expensive half of it — asking twice for two properties off the same element pays
 * that twice for one answer.
 */
function bounds(el) {
	const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
	return { min: px(style, "minHeight", 0), max: px(style, "maxHeight", Infinity) };
}

/** Is this field on screen? A field in a hidden section measures 0 everywhere, which fits nothing. */
function shown(el) {
	return !!el.getClientRects?.().length;
}

function setHeight(el, px) {
	FITTED.set(el, px);
	el.style.height = `${px}px`;
}

/**
 * Fit a `<textarea>` to its text.
 * @returns {boolean}  Whether it could be measured.
 */
function fitTextarea(el) {
	if (!shown(el)) return false;
	const { min, max } = bounds(el);
	// Release the previous measurement first: scrollHeight is reported against the height already
	// set, so without this the field could only ever GROW — deleting a line would leave its gap.
	el.style.height = "auto";
	// scrollHeight covers the content and its padding but NOT the border, while the height being
	// set is a border-box one (Foundry sets border-box globally). Handing back a bare scrollHeight
	// therefore lands short and clips the last line by exactly the border.
	const chrome = el.offsetHeight - el.clientHeight;
	setHeight(el, fittedHeight({ content: el.scrollHeight, chrome, min, max }));
	return true;
}

/**
 * Fit a live `<prose-mirror>` to its content.
 *
 * The host is a flex column — core's toolbar, then `.editor-container` taking the rest — so the
 * chrome to add is whatever height the host has that the container does not. Both parts only
 * exist once the editor has gone live (`TextEditor.create` builds the container), which is why
 * this reports failure rather than guessing: the caller re-runs it on the host's `open` event.
 *
 * @returns {boolean}  Whether it could be measured.
 */
function fitRich(host) {
	const container = host.querySelector(".editor-container");
	const content = host.querySelector(".editor-content");
	if (!container || !content || !shown(host)) return false;
	const { min, max } = bounds(host);
	// Keep the caret's line where it is: releasing the height scrolls the content to fit the
	// floor, and the browser does not put that back when the box grows again.
	const scroll = content.scrollTop;
	host.style.height = "";
	const chrome = host.offsetHeight - container.offsetHeight;
	// The container carries a floor of its own (an editor with no clickable area cannot be typed
	// into). Sitting the host below chrome + that floor would overflow it, and the host clips.
	const floor = Math.max(min, chrome + cssPx(container, "minHeight", 0));
	setHeight(host, fittedHeight({ content: content.scrollHeight, chrome, min: floor, max }));
	content.scrollTop = scroll;
	return true;
}

/** Fit one field, whichever kind it is. */
const fit = el => (el.tagName === "PROSE-MIRROR" ? fitRich : fitTextarea)(el);

/**
 * Has the AUTHOR set this field's height? If so, stop fitting over it.
 *
 * A drag is told from our own sizing by the height itself: anything within a pixel of what we last
 * set is us. A zero-height report is a field in a section that is currently hidden, not a drag down
 * to nothing, so it is ignored rather than remembered.
 *
 * Asked again on the way into every fit rather than only from the ResizeObserver below, because an
 * observer reports a drag on the next frame and a fit can be asked for before that.
 */
function dragged(el, key, heights) {
	if (DRAGGED.has(el)) return true;
	const fitted = FITTED.get(el);
	const h = Math.round(el.getBoundingClientRect?.().height ?? 0);
	if (fitted == null || !h || Math.abs(h - fitted) <= 1) return false;
	DRAGGED.add(el);
	if (key) heights?.set(key, h);
	return true;
}

/**
 * Catch a drag that ends without the author touching the field again.
 *
 * ONE OBSERVER PER WIRING, handed back so the next one can drop it. A render replaces every field
 * under the root, and an observer holds its targets STRONGLY: left connected, each render's worth
 * of dead `<prose-mirror>` hosts — editor view, document, plugins, whole subtree — is pinned for
 * the life of the page, and the WeakMap/WeakSet above can never let go of them either. An observer
 * per field made that one leak per field per render.
 *
 * @returns {ResizeObserver|null}
 */
function watchDrags(fields) {
	if (typeof ResizeObserver !== "function") return null;
	const watch = new ResizeObserver(entries => {
		for (const { target } of entries) {
			const seen = WATCHED.get(target);
			if (seen) dragged(target, seen.key, seen.heights);
		}
	});
	for (const { el, key, heights } of fields) {
		WATCHED.set(el, { key, heights });
		watch.observe(el);
	}
	return watch;
}

/** What each observed field was wired with, so one observer can serve them all. */
const WATCHED = new WeakMap();

/**
 * Give every text field under `root` room to grow.
 *
 * The listeners go with the elements they are on, which a re-render throws away. The size observer
 * does not, so it is handed back: call the returned teardown before re-wiring the same surface, or
 * every render leaves its fields — and everything they hold — alive behind it.
 *
 * @param {HTMLElement} root
 * @param {object}   [opts]
 * @param {Map}      [opts.heights]  Dragged heights, keyed by `keyOf`. Owned by the caller so they
 *                                   survive a re-render, which replaces the elements themselves.
 * @param {Function} [opts.keyOf]    `(el) => string|null` — a field's identity across renders.
 * @returns {Function}  Drops the observation. Safe to call twice.
 */
export function wireGrowableFields(root, { heights = null, keyOf = null } = {}) {
	const fields = [];
	for (const el of root?.querySelectorAll?.(FIELDS) ?? []) {
		const key = keyOf?.(el) ?? null;
		const kept = key ? heights?.get(key) : null;
		if (kept) {
			DRAGGED.add(el);
			setHeight(el, kept);
		} else if (!fit(el) && el.tagName === "PROSE-MIRROR") {
			// Not live yet: core fires `open` on the host once the editor exists.
			el.addEventListener("open", () => { if (!dragged(el, key, heights)) fitRich(el); });
		}
		// `input` bubbles out of a contenteditable as readily as out of a textarea, so the one
		// listener on the field covers both kinds.
		el.addEventListener("input", () => { if (!dragged(el, key, heights)) fit(el); });
		fields.push({ el, key, heights });
	}
	const watch = watchDrags(fields);
	return () => watch?.disconnect();
}

/**
 * Re-fit the fields under `root` that can be measured now.
 *
 * For a form that shows one section at a time: a field in a hidden section measures nothing, so
 * it is still sitting at its floor when its section is finally shown.
 */
export function refitGrowableFields(root) {
	for (const el of root?.querySelectorAll?.(FIELDS) ?? []) {
		if (!dragged(el)) fit(el);
	}
}

/**
 * Fit ONE field to its text, whichever kind it is.
 *
 * For a surface that grows a field on a gesture of its own rather than on a wired `input` — the
 * relationship board opens a note and fits it once, and re-fits it when its own editor writes
 * back. That surface had a private copy of the textarea measurement, comments and all; two copies
 * of border-box arithmetic that subtle is one of them silently going wrong later.
 *
 * An author's own drag still wins, exactly as it does on the wired path.
 *
 * @returns {boolean}  Whether it could be measured (a field in a hidden section cannot).
 */
export function fitGrowableField(el) {
	if (!el || dragged(el)) return false;
	return fit(el);
}
