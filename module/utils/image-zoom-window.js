// A resizable Foundry window that shows one picture, and lets the reader zoom and pan around it.
//
// Core's ImagePopout (utils/foundry-compat.js#imagePopout) is the right window for a PORTRAIT:
// it measures the picture, opens at its size, and scales it to whatever the window is resized to.
// It is the wrong window for a page-sized diagram, because "as large as the window" is as large
// as it ever gets — a 2000px flowchart in a 900px-tall window is at 45%, and the boxes are the
// part you cannot read. Opening the file in a browser tab (which is what the Core Loop tab used
// to do) does give a real zoom, at the price of throwing the reader out of the game to get it.
//
// So: a window inside Foundry, resizable and draggable like every other, whose picture is drawn
// at an explicit pixel width and placed at an explicit pixel offset. Wheel zooms about the cursor,
// drag moves the picture anywhere at all, and double-click toggles fit and full size. There is no
// toolbar (user, 2026-08-16): the window is the picture, and a row of magnifiers with a percentage
// and a line of instructions took height from the only thing anybody opens it for.
//
// The picture is POSITIONED, not scrolled (user, 2026-08-16). A scroll container can only reach
// what is inside its own content box, so it pins a picture to its edges and cannot be dragged past
// them — and it grows scrollbars, which is furniture on a window that is meant to be a page of
// line art and nothing else. An absolutely-placed image with a left/top this file sets has no
// edges to be pinned to: the reader drags a corner of the flowchart into the middle of the window
// and leaves it there. The only bound is the sliver clampPan keeps in view, so a picture shoved
// away can always be caught again — and double-click brings it back to the middle regardless.
//
// The zoom arithmetic lives in image-zoom.js; this file is the window around it.
import { StonetopDialog } from "./stonetop-dialog.js";
import { openOrFocus } from "./open-or-focus.js";
import { anchoredOffset, centreOffset, clampPan, clampZoom, fitScale, stepZoom } from "./image-zoom.js";
import { pickPointOnImage, watchPointsOnImage } from "./pick-point-on-image.js";

const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/image-zoom.hbs";

// Which overlay children are CONTROLS rather than scenery, for a caller that says nothing. Two
// attributes and not one, because a caller's overlay may want a control that names no place — the
// travel maps' edge arrows carry a tier and an empty slug — and a button that reads as live has to
// be live. See `_onPanStart` for why the pan handler needs to recognise them too.
//
// A CALLER MAY WIDEN IT (`controls`), and one does. This selector is the whole of what tells a
// press on a pin from a press on open map, so an overlay that grows a kind of control neither
// attribute names gets a button that cannot be clicked at all: the pan takes a pointer capture,
// the click is retargeted to the viewport, and the delegate below never sees it. The default stays
// what it always was, so nothing that does not ask changes.
const DEFAULT_CONTROLS = "[data-slug], [data-tier]";

export class ImageZoomWindow extends StonetopDialog {
	constructor({ src = "", alt = "", onPick = null, controls = DEFAULT_CONTROLS } = {}, options = {}) {
		super(options);
		this._src = src;
		// An optional layer drawn OVER the picture, in the picture's own coordinates.
		//
		// Trusted authored HTML whose children position themselves in PERCENTAGES: this window
		// sizes the layer to the painted picture on every zoom and every pan, so a child at
		// "40%, 60%" stays on the same speck of the map at any magnification, while anything it
		// declares in pixels (a pin, a stroke width) keeps that size and stays crisp. Empty for
		// every caller that only wants to read a picture, which is all of them but the travel maps.
		//
		// Starts empty and is filled through `setOverlay`, which is how the one caller that draws
		// over a picture (the travel maps) keeps its pins in step with the route.
		this._overlayHtml = "";
		// Called with the DATASET of an overlay element the reader clicked, where one is clickable.
		// Whatever the caller wrote onto its own markup arrives verbatim; this window knows nothing
		// about what any of it means, which is what lets one overlay carry marks that do different
		// things (a place to travel to, a map to switch to, a write-up to open).
		this._onPick = onPick;
		// Which overlay children are controls. See DEFAULT_CONTROLS.
		this._controls = controls || DEFAULT_CONTROLS;
		// Live only while `pickPoint` is waiting for a click. Aborting it is how a window that
		// closes mid-gesture settles the promise somebody is awaiting and takes the global keydown
		// listener back off; see `pickPoint`.
		this._picking = null;
		// And the standing counterpart: how `watchPoints` is taken back off again, which a window
		// has to do on close for the same reason — its listeners are on markup that is about to go.
		this._watching = null;
		// The picture's own accessible name. Not the window title, which the caller passes through
		// `options.title` — a screen reader that has already read the title should not hear it again
		// as the image's description, but an empty alt on the one piece of content in the window is
		// worse still, so callers hand both in and this one describes the PICTURE.
		this._alt = alt;

		// Natural size, learned from the image itself once it has loaded. Every scale below is a
		// multiple of this, so until it arrives there is nothing to compute and _applyZoom no-ops.
		this._naturalWidth = 0;
		this._naturalHeight = 0;

		this._scale = 1;
		// Where the picture's top-left corner sits, measured from the viewport's top-left. Negative
		// on either axis is ordinary and not an error: it is a picture larger than the window, or
		// one the reader has dragged up and to the left.
		this._offset = { x: 0, y: 0 };
		// True while the picture is sized and centred to the window, which is how it opens: the
		// window then re-fits on every resize. The first deliberate zoom OR drag turns it off, so a
		// reader who has put one corner where they want it and then drags the window bigger gets
		// more of that corner rather than being yanked back out to the whole page.
		this._fitting = true;

		// The viewport's size in pixels, remembered rather than asked for.
		//
		// Every paint writes `img.style.width/left/top`, and every one of the numbers it writes
		// is derived from these two. Reading them back off the element in the same breath —
		// which is what `this._view.clientWidth` in `_applyZoom` amounted to — makes the browser
		// flush the layout it was just handed, once per paint. On the wheel that is once a notch;
		// on a drag it is once per `pointermove`, which is 60-120 forced reflows a second for as
		// long as the reader holds the picture. So the size is measured where it actually changes
		// (the ResizeObserver, and once when the image lands) and read from here everywhere else.
		this._viewW = 0;
		this._viewH = 0;

		// Pan state, live only between pointerdown and pointerup.
		this._pan = null;
		this._resizeObserver = null;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: "stonetop-image-zoom",
			classes: ["stonetop", "stonetop-image-zoom"],
			template: TEMPLATE,
			width: 780,
			height: 720,
			resizable: true,
		});
	}

	getData() {
		return { src: this._src, alt: this._alt, overlay: this._overlayHtml };
	}

	activateListeners(html) {
		super.activateListeners(html);
		// ONE root element (AppV1 hands `html` as a jQuery wrapping the template's root).
		const root = html[0];
		// Everything below points into the render being REPLACED, and this render may have no
		// viewport at all — a subclass whose template draws a "that map isn't in this world" panel
		// instead of a picture. Dropped first, and unconditionally, so the early return leaves
		// nothing aimed at nodes that have left the document: a stale `_overlay` takes the next
		// `setOverlay`'s markup into a detached div where nobody will ever see it, and a stale
		// observer goes on firing as its element is torn out, re-fitting against a 0x0 viewport.
		this._resizeObserver?.disconnect();
		this._resizeObserver = null;
		// A standing watch is aimed at those same nodes, and it also holds the crosshair class on
		// one of them: left alone it would go on swallowing clicks on a viewport nobody can see,
		// and the caller would never learn its picture had been rebuilt underneath it.
		this.stopWatchingPoints();
		this._view = null;
		this._img = null;
		this._overlay = null;
		// The viewport IS that root, since the toolbar row went and left nothing to wrap it
		// against. `querySelector` only ever looks at DESCENDANTS, so asking the root for the
		// viewport by class returns null and every listener below is silently skipped: no wheel,
		// no drag, and no fit. Match the root itself first, and keep the descendant lookup for a
		// template that grows a wrapper back.
		this._view = root.matches?.(".stonetop-image-zoom-view")
			? root
			: root.querySelector(".stonetop-image-zoom-view");
		this._img = this._view?.querySelector(".stonetop-image-zoom-img");
		if (!this._view || !this._img) return;
		this._overlay = this._view.querySelector(".stonetop-image-zoom-overlay");

		// Delegated, so swapping the layer's contents (setOverlay) never has to rebind anything.
		// The layer itself takes no pointer events and only its clickable children do, so a drag
		// that starts on open map still pans — which is the gesture this window exists for.
		//
		// Both attributes travel, and neither is required. `data-slug` names a place; `data-tier`
		// names a picture to move to. A control may carry one, the other, or both, and the caller
		// decides what to do with what it gets — which is the only way a control that names no
		// place (an edge arrow) can do anything at all from in here.
		if (this._overlay && this._onPick) {
			this._overlay.addEventListener("click", ev => {
				const picked = ev.target.closest?.(this._controls);
				if (!picked || !this._overlay.contains(picked)) return;
				// The whole dataset, spread into a plain object so what the caller gets is
				// inspectable rather than a live DOMStringMap on a node about to be replaced.
				// Matching the selector IS the gate: an element the caller marked as a control is
				// one, whatever it happens to carry, and reading two named attributes here meant a
				// third kind of mark could not be added to an overlay without editing this file.
				//
				// THE EVENT GOES WITH IT, because a modifier is part of what a click said: the
				// travel maps read the shift key off a pin to tell "go there instead" from "go
				// there as well", and a dataset alone cannot carry that.
				this._onPick({ ...picked.dataset }, ev);
			});
		}

		// A cached picture — the second open of the same diagram, which is the common case — is
		// already `complete` by the time listeners run and will never fire `load` again. Miss that
		// and the window opens at 100% with no natural size and no way to reach fit.
		if (this._img.complete && this._img.naturalWidth) this._onImageLoaded();
		else this._img.addEventListener("load", () => this._onImageLoaded(), { once: true });

		// Not passive: the whole point is to preventDefault the page scroll and zoom instead.
		this._view.addEventListener("wheel", this._onWheel.bind(this), { passive: false });
		this._view.addEventListener("pointerdown", this._onPanStart.bind(this));
		this._view.addEventListener("pointermove", this._onPanMove.bind(this));
		this._view.addEventListener("pointerup", this._onPanEnd.bind(this));
		this._view.addEventListener("pointercancel", this._onPanEnd.bind(this));
		this._view.addEventListener("dblclick", this._onDoubleClick.bind(this));

		this._watchViewportSize();
	}

	/**
	 * Re-fit while the window is being dragged bigger, rather than once it is let go.
	 *
	 * AppV1 only calls `_onResize` on mouse-UP, so hanging the re-fit off that leaves the picture
	 * the old size for the whole drag and then snapping — which reads as the window being broken
	 * until you release it. A ResizeObserver on the viewport follows the drag frame by frame, and
	 * also catches the resizes AppV1 never reports at all (a maximise, a `setPosition` from code).
	 *
	 * Observing the VIEWPORT and not the image is what keeps this from feeding back: the viewport
	 * takes its size from the window, the image takes its size from here, and in fit mode there
	 * are no scrollbars to appear and change the answer.
	 */
	_watchViewportSize() {
		this._measureView();
		const Observer = globalThis.ResizeObserver;
		if (!Observer || !this._view) return;
		this._resizeObserver?.disconnect();
		// Measured FIRST, and unconditionally: the cached size is what `clampPan` bounds a drag
		// against, so it has to keep up with a resize whether or not the picture is re-fitting.
		this._resizeObserver = new Observer(() => {
			this._measureView();
			if (this._fitting) this._fitToWindow();
		});
		this._resizeObserver.observe(this._view);
	}

	/** Read the viewport's size — the one place that touches the DOM for it. */
	_measureView() {
		if (!this._view) return;
		this._viewW = this._view.clientWidth;
		this._viewH = this._view.clientHeight;
	}

	_onImageLoaded() {
		this._naturalWidth = this._img?.naturalWidth ?? 0;
		this._naturalHeight = this._img?.naturalHeight ?? 0;
		this._measureView();
		this._fitToWindow();
	}

	/** The size the picture is actually drawn at, in window pixels, at the current scale. */
	_painted() {
		const width = Math.floor(this._naturalWidth * this._scale);
		// From the WIDTH and the aspect ratio, not from natural height times scale: the height is
		// `auto`, so the browser derives it from the floored width, and centring against a height
		// computed any other way would sit the picture a pixel or two off its own middle.
		const height = this._naturalWidth ? Math.round(width * this._naturalHeight / this._naturalWidth) : 0;
		return { width, height };
	}

	/** Size the picture to the window and put it in the middle, until somebody zooms or drags. */
	_fitToWindow() {
		if (!this._view) return;
		this._fitting = true;
		this._scale = fitScale({
			imageWidth: this._naturalWidth,
			imageHeight: this._naturalHeight,
			viewWidth: this._viewW,
			viewHeight: this._viewH,
		});
		// Measured once and handed on: `_applyZoom` needs the same two numbers, and this runs
		// once per frame of a window-resize drag.
		const painted = this._painted();
		this._offset = centreOffset({
			paintedWidth: painted.width,
			paintedHeight: painted.height,
			viewWidth: this._viewW,
			viewHeight: this._viewH,
		});
		this._applyZoom(painted);
	}

	/**
	 * Zoom to a scale, keeping `anchor` (a point in viewport coordinates — the cursor, or the
	 * middle of the view when there isn't one) over the same part of the picture.
	 */
	_zoomTo(scale, anchor = null) {
		const from = this._scale;
		const to = clampZoom(scale);
		// AFTER the early return: a zoom that lands on the scale the picture is already at moved
		// nothing, so it is no more a deliberate placement than a press that never dragged. Clearing
		// the flag first would leave a picture still sized and centred to the window claiming it had
		// been placed by hand — a wheel notch at the zoom clamp, or a double-click on a page whose
		// fit is already 1:1, and the window quietly stops re-fitting on resize.
		if (to === from) return;
		this._fitting = false;
		this._scale = to;
		const x = anchor?.x ?? this._viewW / 2;
		const y = anchor?.y ?? this._viewH / 2;
		this._offset = {
			x: anchoredOffset({ offset: this._offset.x, pointer: x, from, to }),
			y: anchoredOffset({ offset: this._offset.y, pointer: y, from, to }),
		};
		this._applyZoom();
	}

	/**
	 * Paint the current scale and position.
	 *
	 * An explicit pixel WIDTH, rather than a transform: a transform scales what was painted, so the
	 * picture would be resampled from its fitted size rather than redrawn from the file, and a
	 * flowchart zoomed in on would go soft exactly when the reader wanted the small print.
	 *
	 * FLOOR, not round, for the same width. A fitted picture is by definition the size of the
	 * viewport, and rounding UP puts it a pixel over on the axis it was fitted to — which is a
	 * hairline of the picture hidden past an edge that is meant to be showing all of it. Rounding
	 * down cannot overflow either axis (the fit is the smaller of the two ratios), and a pixel is
	 * a pixel.
	 */
	_applyZoom(painted = this._painted()) {
		if (!this._img || !this._naturalWidth) return;
		const { width, height } = painted;
		this._img.style.width = `${width}px`;
		this._img.style.height = "auto";
		// Clamped here rather than in the pan handler, so that a zoom-out that leaves the picture
		// off in a corner is caught as well as a drag that does. Against the REMEMBERED viewport
		// size — see the note on `_viewW`: asking the element here would flush the layout the two
		// style writes above just dirtied, on every frame of a drag.
		this._offset = {
			x: clampPan({ offset: this._offset.x, painted: width, view: this._viewW }),
			y: clampPan({ offset: this._offset.y, painted: height, view: this._viewH }),
		};
		this._img.style.left = `${Math.round(this._offset.x)}px`;
		this._img.style.top = `${Math.round(this._offset.y)}px`;
		// The layer gets the picture's box exactly — including an explicit HEIGHT, which the image
		// itself never carries (it is `auto`, derived by the browser from the width). A percentage
		// `top` inside the layer resolves against ITS height, so leaving that `auto` would collapse
		// it to nothing and stack every pin along the picture's top edge.
		if (this._overlay) {
			this._overlay.style.width = `${width}px`;
			this._overlay.style.height = `${height}px`;
			this._overlay.style.left = `${Math.round(this._offset.x)}px`;
			this._overlay.style.top = `${Math.round(this._offset.y)}px`;
		}
	}

	/**
	 * Replace the overlay's contents without disturbing the zoom or the pan.
	 *
	 * What a caller needs once the reader picks something INSIDE this window: re-rendering the
	 * Application would re-run `_fitToWindow` and throw away the corner they had zoomed into, which
	 * is exactly the state they were using when they clicked.
	 */
	setOverlay(html = "") {
		this._overlayHtml = html;
		if (this._overlay) this._overlay.innerHTML = html;
	}

	/**
	 * Ask the reader to click a point ON THE PICTURE, and answer where they clicked as a
	 * percentage of it.
	 *
	 * Measured against the OVERLAY, not the viewport: the overlay is sized and placed onto the
	 * painted picture on every zoom and every pan (`_applyZoom`), so its box is the picture's box
	 * at whatever magnification and offset the reader has put it at. The viewport is where the
	 * events arrive, because a pan takes a pointer capture there. See pick-point-on-image.js.
	 *
	 * Zoom and pan stay live throughout, which is the point of picking from this window rather
	 * than from the panel: the reader wheels down to the valley they mean and then clicks it.
	 *
	 * @returns {Promise<{left: number, top: number}|null>}  null if they cancelled, or the window
	 *          closed with the gesture still armed.
	 */
	async pickPoint() {
		const target = this._overlay ?? this._img;
		if (!this._view || !target) return null;
		// A second call supersedes the first, rather than leaving two gestures armed over one
		// picture, both swallowing the same click and only one of them being awaited.
		this._picking?.abort();
		const picking = new AbortController();
		this._picking = picking;
		try {
			return await pickPointOnImage({ listenOn: this._view, measure: target, signal: picking.signal });
		} finally {
			if (this._picking === picking) this._picking = null;
		}
	}

	/**
	 * Stay armed over the picture and report every click on it, until the caller stops.
	 *
	 * THE STANDING COUNTERPART OF `pickPoint`, measured against the same two elements and for the
	 * same reasons: the overlay is the picture's own box at whatever zoom and pan the reader has
	 * put it at, and the viewport is where the events arrive once a pan has taken a pointer capture
	 * there. What differs is only how long it lasts — one answer, or a run of them.
	 *
	 * ONE AT A TIME. A second call supersedes the first rather than leaving two watchers over one
	 * picture reporting the same click twice, which is the same rule `pickPoint` follows and for
	 * the same reason.
	 *
	 * @param {object} handlers  `{ onPoint, onUndo, ignore, undoIgnore }` — see
	 *                           utils/pick-point-on-image.js `watchPointsOnImage`.
	 * @returns {Function} stop watching.
	 */
	watchPoints(handlers = {}) {
		this.stopWatchingPoints();
		const target = this._overlay ?? this._img;
		if (!this._view || !target) return () => {};
		this._watching = watchPointsOnImage({ ...handlers, listenOn: this._view, measure: target });
		return () => this.stopWatchingPoints();
	}

	/** Take the watch off, if there is one. Safe to call when there is not. */
	stopWatchingPoints() {
		this._watching?.();
		this._watching = null;
	}

	/** Where a pointer event landed, relative to the viewport's own top-left. */
	_anchorFor(ev) {
		const rect = this._view?.getBoundingClientRect?.();
		if (!rect) return null;
		return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
	}

	_onWheel(ev) {
		if (!ev.deltaY) return;
		ev.preventDefault();
		this._zoomTo(stepZoom(this._scale, ev.deltaY < 0 ? 1 : -1), this._anchorFor(ev));
	}

	/**
	 * Left-drag moves the picture. Pointer capture, so a fast drag that leaves the window keeps
	 * moving it — and, more to the point, so the pointerup still arrives when the cursor is out
	 * over the canvas and the picture doesn't stay stuck to it.
	 *
	 * A press that landed on an overlay control starts no pan, and the reason is the capture and
	 * not politeness. `setPointerCapture` on `this._view` RETARGETS every later event from that
	 * pointer — including the `pointerup`, from which the browser derives the `click` — at the
	 * capturing element. `this._view` is an ancestor of the overlay, so capturing here makes the
	 * click fire at the viewport, `closest(PICK_SELECTOR)` find nothing, and the delegated handler
	 * above never run: every pin in the window is dead, on a dead-centre click that never moved a
	 * pixel. Releasing the capture on pointerup does not undo it, because the click inherits its
	 * target from the already-retargeted pointerup. So the press has to be recognised as a click
	 * on a control BEFORE the capture is taken.
	 */
	_onPanStart(ev) {
		if (ev.button !== 0 || !this._view) return;
		const control = ev.target?.closest?.(this._controls);
		if (control && this._overlay?.contains(control)) return;
		ev.preventDefault();
		this._pan = {
			id: ev.pointerId,
			x: ev.clientX,
			y: ev.clientY,
			offsetX: this._offset.x,
			offsetY: this._offset.y,
		};
		this._view.classList.add("stonetop-image-zoom-view--panning");
		this._view.setPointerCapture?.(ev.pointerId);
	}

	/**
	 * The picture follows the cursor one-for-one: grab it here, it is still under here.
	 *
	 * From the offset the drag STARTED at plus the total travel, never from the last position plus
	 * a delta — the clamp in _applyZoom would otherwise be eating a pixel off each move, and a drag
	 * along an edge would creep away from the cursor.
	 */
	_onPanMove(ev) {
		if (!this._pan || ev.pointerId !== this._pan.id) return;
		const dx = ev.clientX - this._pan.x;
		const dy = ev.clientY - this._pan.y;
		// A press that never moved is not a placement: it leaves the picture fitted, so a window
		// resized afterwards still re-fits rather than being stuck where a stray click left it.
		if (dx || dy) this._fitting = false;
		this._offset = { x: this._pan.offsetX + dx, y: this._pan.offsetY + dy };
		this._applyZoom();
	}

	_onPanEnd(ev) {
		if (!this._pan || ev.pointerId !== this._pan.id) return;
		this._view.releasePointerCapture?.(ev.pointerId);
		this._view.classList.remove("stonetop-image-zoom-view--panning");
		this._pan = null;
	}

	/** The gesture everyone tries first: out to the whole page, in to full size, under the cursor. */
	_onDoubleClick(ev) {
		ev.preventDefault();
		if (this._fitting) this._zoomTo(1, this._anchorFor(ev));
		else this._fitToWindow();
	}

	async close(options = {}) {
		this._resizeObserver?.disconnect();
		this._resizeObserver = null;
		// A gesture still waiting for a click on a picture that is about to leave the screen. Its
		// caller is awaiting the answer, so it is told there isn't one rather than being left
		// holding a promise that can no longer settle.
		this._picking?.abort();
		this._picking = null;
		this.stopWatchingPoints();
		return super.close(options);
	}
}

/**
 * Open (or re-focus) the zoom window for one picture.
 *
 * `key` gives the window its id, so a second click on the same picture raises the window that is
 * already showing it rather than stacking an identical one on top — while two DIFFERENT pictures
 * get two windows, which is the whole point of a spread you are reading across.
 *
 * Returns null for an empty src: the caller's picture simply isn't there yet, and an empty window
 * saying so is worse than nothing happening.
 */
export function openImageZoom({ src, title = "", key = "", onPick = null } = {}) {
	if (!src) return null;
	const id = `stonetop-image-zoom-${key || "image"}`;
	return openOrFocus(id, () => {
		const app = new ImageZoomWindow({ src, alt: title, onPick }, { id, title });
		app.render(true);
		return app;
	});
}
