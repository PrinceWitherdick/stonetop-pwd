/**
 * Hover preview for a small avatar thumbnail: a card holding the full-size image and the
 * person's name, shown while the pointer is over the thumbnail.
 *
 * Portaled to <body> and positioned `fixed`, NOT the wrapper-span + `::after` idiom this
 * codebase uses elsewhere for hover-to-enlarge. Every host for this one is a scrolling
 * table or a lane column, and an `overflow` ancestor clips a pseudo-element popup on both
 * axes (`overflow-y: auto` clips x too) — so the preview would be cut off exactly where
 * the rows are densest. Positioning against the viewport is what escapes those ancestors.
 *
 * The steading's Residents / Neighbors tables, the shared relationships component and the
 * arcana tab's card art all draw from here, so an enlarged image reads identically wherever
 * one is raised. The art differs only in which side it sits on, which is what the
 * `placement` and `variant` options carry.
 */

import { fullPortraitSrc } from "../book2-art/people-portraits.js";

const PREVIEW_CLASS = "stonetop-avatar-preview";
// The marker every body-portaled hover popup carries, so Reduce Motion can suppress the lot of
// them with one rule instead of a hand-kept list of class names (see styles/stonetop.css).
const HOVER_POPUP_CLASS = "stonetop-hover-popup";
/** Clearance from the thumbnail, and from the viewport edge. */
const GAP  = 8;
const EDGE = 8;

/* --- How big the enlarged image gets -------------------------------------------------
   The preview is fitted to the image's OWN aspect ratio inside the box below, rather than
   drawn into a fixed square. A square crops, and the thumbnails it enlarges are cropped
   `cover` from the top — so a tall, narrow portrait previewed at a fixed square showed the
   same top slice the thumbnail already showed, which is the one thing a "let me see the
   whole picture" hover has to avoid. Fitting means the popup is as tall as a tall image
   and as wide as a wide one, and nothing is ever cut off. */

/** Bounding box for the enlarged image itself, before the viewport has its say. */
const MAX_W = 224;
const MAX_H = 360;
/** Share of the window height the image may take, so a short window still fits the popup. */
const MAX_H_VH = 0.6;
/** Enlargement ceiling for art smaller than the box: past ~3x a raster preview is mush. */
const MAX_UPSCALE = 3;

/**
 * Fit `img` to its intrinsic ratio inside the budget above, and publish the result width to
 * the popup so the caption can size against it (see .stonetop-avatar-preview strong).
 *
 * Explicit pixels rather than `max-width`/`max-height` in CSS alone, because CSS sizing only
 * ever SHRINKS: `width: auto` cannot grow an image past its natural size, so a 44x44 icon
 * would preview at 44x44 and a hover-to-enlarge would not enlarge. Scaling here is what makes
 * the fit go both ways, up to MAX_UPSCALE. (Shrinking, Chromium does unaided — it transfers
 * the max-height through the intrinsic ratio, which is why the CSS pair is a faithful
 * fallback for anything bigger than the box. Measured, not assumed.)
 *
 * @returns {boolean} false when the intrinsic size isn't known yet, so the caller can wait
 *                    for the decode instead of committing to a guess.
 */
function fitPreviewImage(popup, img, nw, nh) {
	if (!(nw > 0) || !(nh > 0)) return false;
	// Deliberately the same expression as the CSS fallback's `min(60vh, 360px)`, so the two
	// paths can't disagree about how tall a preview is allowed to get.
	const maxH = Math.min(MAX_H, window.innerHeight * MAX_H_VH);
	const scale = Math.min(MAX_W / nw, maxH / nh, MAX_UPSCALE);
	const w = Math.max(1, Math.round(nw * scale));
	const h = Math.max(1, Math.round(nh * scale));
	img.style.width  = `${w}px`;
	img.style.height = `${h}px`;
	popup.style.setProperty("--st-avatar-preview-w", `${w}px`);
	return true;
}

/** There is only ever one preview, so tearing down is a query rather than bookkeeping. */
export function removeAvatarPreview() {
	document.querySelector(`.${PREVIEW_CLASS}`)?.remove();
}

/**
 * Take the preview down as soon as its thumbnail leaves the document.
 *
 * `mouseleave` is the ordinary teardown and it is enough while the thumbnail stays put. It is
 * not enough when the thumbnail is REMOVED from under the pointer, and this codebase now does
 * that constantly: closing a sheet with Escape, a re-render replacing the row, switching tabs,
 * folding a section shut, flipping a relationships section between table and board. None of
 * those move the pointer, so whether a `mouseleave` arrives at all comes down to whether the
 * browser synthesises a boundary event into a subtree it is already detaching — not something
 * to rest a popup's lifetime on. When it doesn't, the preview is portaled to <body> with
 * nothing left in the document to fire the listener, so it simply hangs there until the next
 * hover happens to clear it on its way in.
 *
 * Watching the anchor rather than hooking `closeApplication` because closing a window is only
 * one of those paths — the re-render and tab cases have no close to hook, and a detached
 * anchor is the one condition all of them share.
 *
 * One `isConnected` read per frame, for exactly as long as a preview is on screen: the loop
 * stops itself the moment the popup goes, whichever teardown got there first.
 *
 * Exported so the stop conditions are testable without a browser — it reads four properties
 * and calls one method, so a plain object stands in for either node.
 */
export function watchAnchor(popup, anchor) {
	if (typeof requestAnimationFrame !== "function") return;
	const tick = () => {
		// Already taken down (mouseleave, a fresh preview, an explicit remove) — stop watching.
		if (!popup.isConnected) return;
		if (!anchor.isConnected) { popup.remove(); return; }
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

/**
 * Where the popup sits relative to its anchor. Both flip to the opposite side when the
 * preferred one would run off the viewport, then clamp on both axes — a thumbnail near a
 * window edge is the common case, not the exception.
 *
 * "below" suits a row in a table: the popup is wider than the 26px portrait, so centring it
 * horizontally keeps it over the row it belongs to. "right" suits art at the left edge of a
 * card, where there is room beside it and stacking below would cover the card's own text.
 */
const PLACEMENTS = {
	below: (a, pw, ph) => {
		let top = a.bottom + GAP;
		if (top + ph > window.innerHeight - EDGE) top = a.top - ph - GAP;
		return { top, left: a.left + a.width / 2 - pw / 2 };
	},
	right: (a, pw, ph) => {
		let left = a.right + GAP;
		if (left + pw > window.innerWidth - EDGE) left = a.left - pw - GAP;
		return { top: a.top + a.height / 2 - ph / 2, left };
	},
};

/**
 * Put `popup` beside `anchor`. Split out from showAvatarPreview because a preview whose
 * image had not decoded yet is measured once on creation and AGAIN once the real size is
 * known — the second pass is the one that lands a tall image on screen rather than half
 * off the bottom of it.
 */
function placePreview(popup, anchor, placement) {
	// Measure the CLIPPING BOX, not the anchor. A portrait the user has framed
	// (module/utils/portrait-frame.js) is an image sized to several hundred percent and pushed
	// off its own origin; `overflow: hidden` clips what paints and what can be hovered, but it
	// does NOT shrink the border box, so measuring the image itself would put the preview a long
	// way from the face it belongs to. Unframed portraits are unaffected: the image fills its
	// box exactly, so the two rects agree.
	const host = anchor.closest?.(".stonetop-portrait-box") ?? anchor;
	const rect = host.getBoundingClientRect();
	const pw = popup.offsetWidth;
	const ph = popup.offsetHeight;
	const { top, left } = (PLACEMENTS[placement] ?? PLACEMENTS.below)(rect, pw, ph);
	popup.style.top  = `${Math.max(EDGE, Math.min(top, window.innerHeight - ph - EDGE))}px`;
	popup.style.left = `${Math.max(EDGE, Math.min(left, window.innerWidth - pw - EDGE))}px`;
}

/**
 * Show the preview for `anchor`, an <img> thumbnail. Its `src` is the image, its `data-name`
 * is the caption and its optional `data-subtitle` a quieter second line under it; without a
 * `src` there is nothing to enlarge and this is a no-op, which is what keeps it safe to point
 * at a placeholder icon.
 *
 * The subtitle exists because a thumbnail that already carried a `data-tooltip` cannot keep
 * it once it raises a preview — two popups would open on the same hover, over each other. The
 * steading's Player Characters portraits are that case (the tooltip was the playbook name), so
 * the fact moves into the preview rather than being lost.
 *
 * @param {HTMLImageElement} anchor
 * @param {object}  [options]
 * @param {"below"|"right"} [options.placement]  which side of the anchor to sit on
 * @param {string}  [options.variant]  extra class on the popup, for whatever else differs
 *                                     about it (e.g. "stonetop-avatar-preview--art", whose
 *                                     pop-in grows from the left edge to match `right`)
 */
export function showAvatarPreview(anchor, { placement = "below", variant = "" } = {}) {
	removeAvatarPreview();
	if (!anchor?.src) return null;

	// A People-of-Stonetop thumbnail is a SQUARE face cut from a standing figure, so previewing
	// its own src would just show the same crop bigger — and "let me see the whole picture" is
	// the entire point of the hover. Swap in the illustration it came from. Every surface wired
	// here gets that for free, with no template or data-producer change: the src is all it takes
	// to know. Anything else (a browsed file, a monster portrait) resolves to null and is
	// previewed as before.
	//
	// Read off the ATTRIBUTE rather than `.src`, which the DOM resolves to an absolute URL that
	// a query string or hash could hide the filename behind.
	const whole = fullPortraitSrc(anchor.getAttribute?.("src") ?? "");
	const popup = document.createElement("div");
	popup.className = variant
		? `${HOVER_POPUP_CLASS} ${PREVIEW_CLASS} ${variant}`
		: `${HOVER_POPUP_CLASS} ${PREVIEW_CLASS}`;
	const img = document.createElement("img");
	img.src = whole || anchor.src;
	img.alt = "";
	// The anchor is already painted on screen, so its intrinsic size is known long before
	// this second copy of the same src has decoded — read the shape off the thumbnail and
	// the popup opens at the right size on the first frame. The listener is the fallback
	// for the case that isn't true (a thumbnail still loading under the pointer); it fires
	// at most once and only re-measures a preview that is still up.
	//
	// Not available when we swapped the image: the thumbnail is square and the illustration is
	// not, so borrowing its ratio would open the popup as a square and letterbox the figure
	// into the very slice this swap exists to escape. Wait for the real decode instead.
	if (whole || !fitPreviewImage(popup, img, anchor.naturalWidth, anchor.naturalHeight)) {
		img.addEventListener("load", () => {
			if (!popup.isConnected) return;
			if (fitPreviewImage(popup, img, img.naturalWidth, img.naturalHeight)) {
				placePreview(popup, anchor, placement);
			}
		}, { once: true });
	}
	popup.appendChild(img);
	const name = anchor.dataset?.name?.trim();
	if (name) {
		const caption = document.createElement("strong");
		caption.textContent = name;
		popup.appendChild(caption);
	}
	const subtitle = anchor.dataset?.subtitle?.trim();
	if (subtitle) {
		const line = document.createElement("span");
		line.className = `${PREVIEW_CLASS}-sub`;
		line.textContent = subtitle;
		popup.appendChild(line);
	}
	// Appended before measuring: offsetWidth/offsetHeight are 0 until it is in the document.
	document.body.appendChild(popup);
	placePreview(popup, anchor, placement);

	// Above the window that raised it. Foundry writes an app's z-index inline as it brings
	// windows to front, so read it back rather than guessing a constant that a stack of open
	// sheets would climb past. !important because the popup is outside the app's subtree and
	// must not lose to anything the theme sets on body-level children.
	const z = Number.parseInt(anchor.closest(".app, .application")?.style?.zIndex, 10) || 0;
	popup.style.setProperty("z-index", String(Math.max(10000, z + 2)), "important");

	// Last, so the watchdog only ever runs for a preview that actually made it onto the screen.
	watchAnchor(popup, anchor);
	return popup;
}

// Every selector wired against a given root, so repeat calls share ONE pair of listeners
// instead of stacking their own. A root is a freshly rendered subtree, so an entry dies with
// the render that made it; the WeakMap is what keeps that automatic.
const WIRED_ROOTS = new WeakMap();

/**
 * Delegate the preview from `root` for every thumbnail matching `selector`.
 *
 * Capture phase, because mouseenter/mouseleave do NOT bubble — they are delivered to
 * ancestors on the way down only, so a delegated listener has to catch them there or see
 * nothing at all. (mouseover/mouseout do bubble, but they also fire on every move between
 * child elements, which would tear the preview down and rebuild it mid-hover.)
 *
 * Calling this more than once for the same root is normal — a character sheet wires its
 * follower faces, its arcana thumbs and its relationship portraits independently — so the
 * selectors are pooled rather than each getting its own listener pair. That matters because
 * a capture-phase mouseenter fires for every element the pointer crosses: one pooled
 * `closest` over the joined selector costs one ancestor walk per move, where N separate
 * wirings cost N.
 */
export function wireAvatarPreview(root, selector, options) {
	if (!root || !selector) return;
	const wired = WIRED_ROOTS.get(root);
	if (wired) {
		// A re-wire of the same selector (a second pass over one root) must not DOUBLE it —
		// but it must not be ignored either. The later call is the current wiring, so its
		// options replace what the entry was holding; dropping them would silently pin the
		// preview's placement and variant to whichever pass happened to run first.
		const existing = wired.entries.find(e => e.selector === selector);
		if (existing) existing.options = options;
		else {
			wired.entries.push({ selector, options });
			wired.joined = wired.entries.map(e => e.selector).join(", ");
		}
		return;
	}

	const state = { entries: [{ selector, options }], joined: selector };
	WIRED_ROOTS.set(root, state);
	// One walk to find the thumbnail, then a cheap `matches` on the element we already have
	// to say which wiring owns it (and so which options to show it with).
	const hit = ev => ev.target.closest?.(state.joined);
	root.addEventListener("mouseenter", ev => {
		const thumb = hit(ev);
		if (thumb) showAvatarPreview(thumb, state.entries.find(e => thumb.matches(e.selector))?.options);
	}, true);
	root.addEventListener("mouseleave", ev => {
		if (hit(ev)) removeAvatarPreview();
	}, true);
}
