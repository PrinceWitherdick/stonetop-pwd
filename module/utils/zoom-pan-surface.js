// Wheel-zoom and drag-pan over a BOARD: an element with a fixed notional size that the reader
// moves around inside a window, the way utils/image-zoom-window.js moves a picture.
//
// WHY IT IS NOT THAT FILE. ImageZoomWindow is a window wrapped around a picture, and it carries
// things a board does not want (`pickPoint`, `watchPoints`, an overlay sized onto a photograph) and
// wants one thing it does not have: somewhere to put a diagram that has no natural size to learn
// from an image `load` event. It is also load-bearing for the travel maps and the book reader, so
// this is a NEW file over the same arithmetic rather than a refactor of that one. The two share
// utils/image-zoom.js, which is where the interesting half lives and is already pure and tested.
// ImageZoomWindow adopting this is a follow-up and an explicit non-goal here.
//
// THE ONE REAL DIFFERENCE, and it is deliberate. ImageZoomWindow sets an explicit pixel WIDTH and
// refuses a CSS transform, because scaling a bitmap resamples it and a flowchart zoomed into would
// go soft exactly when the reader wanted the small print. A board is not a bitmap. Its portraits,
// its strokes and its text are all redrawn by the browser at whatever scale they are given, so a
// transform costs no sharpness, composites instead of forcing a re-layout of every node on every
// frame of a drag, and scales the WHOLE diagram uniformly — which is what zooming a mind map has to
// mean. Fixed-size nodes on a shrinking board would pile into an unreadable heap the moment anyone
// zoomed out to see the whole web.

import { anchoredOffset, centreOffset, clampPan, clampZoom, fitScale, stepZoom } from "./image-zoom.js";

export class ZoomPanSurface {
	/**
	 * @param {object} spec
	 * @param {HTMLElement} spec.view     The window the board is seen through. Events land here.
	 * @param {HTMLElement} spec.content  The board itself, positioned and scaled by this class.
	 * @param {number} spec.naturalWidth  The board's notional size, in CSS pixels at 1:1.
	 * @param {number} spec.naturalHeight
	 * @param {string} [spec.controls]    Selector for children a press must NOT pan from.
	 * @param {Function} [spec.onChange]  Called after every paint, for a caller that has its own
	 *                                    pixel-sized furniture to keep in step.
	 */
	constructor({ view, content, naturalWidth, naturalHeight, controls = "", onChange = null } = {}) {
		this._view = view ?? null;
		this._content = content ?? null;
		this._naturalWidth = Number(naturalWidth) || 0;
		this._naturalHeight = Number(naturalHeight) || 0;
		this._controls = controls;
		this._onChange = onChange;

		this._scale = 1;
		// The board's top-left corner measured from the viewport's. Negative on either axis is
		// ordinary: a board larger than the window, or one dragged up and to the left.
		this._offset = { x: 0, y: 0 };
		// True while the board is sized and centred to the window, which is how it opens. The first
		// deliberate zoom or drag turns it off, so a reader who has put a corner where they want it
		// and then drags the window bigger gets more of that corner rather than being yanked out.
		this._fitting = true;

		// The viewport's size, REMEMBERED rather than asked for. Every paint derives its numbers
		// from these two, and reading them back off the element in the same breath makes the browser
		// flush the layout it was just handed — once per wheel notch, and once per pointermove for
		// as long as a drag lasts, which is 60-120 forced reflows a second.
		this._viewW = 0;
		this._viewH = 0;

		this._pan = null;
		this._observer = null;
		this._bound = null;
		// Whether the board's fixed width/height/origin have been written. See `_sizeContent`.
		this._sized = false;
	}

	/** Wire the listeners and put the board in the middle. */
	attach() {
		if (!this._view || !this._content) return this;
		// ONE table, read by both `attach` and `destroy`. Spelled out twice, a gesture added to one
		// list and not the other leaks a listener on every window that is opened and closed.
		// Not passive: the whole point is to preventDefault the page scroll and zoom instead.
		this._bound = [
			["wheel", this._onWheel.bind(this), { passive: false }],
			["pointerdown", this._onPanStart.bind(this)],
			["pointermove", this._onPanMove.bind(this)],
			["pointerup", this._onPanEnd.bind(this)],
			["pointercancel", this._onPanEnd.bind(this)],
			["dblclick", this._onDoubleClick.bind(this)],
		];
		for (const [type, handler, opts] of this._bound) {
			this._view.addEventListener(type, handler, opts);
		}

		// The board's own size never changes, so it is written ONCE here rather than on every
		// frame of every pan (see `apply`).
		this._sizeContent();

		// A board has no `load` event to wait for — its size is a constant this class was handed —
		// so unlike a picture it can be measured and fitted at once.
		this._watchViewportSize();
		this.fit();
		return this;
	}

	/** Take every listener back off. Safe to call twice, and on a surface that never attached. */
	destroy() {
		this._observer?.disconnect();
		this._observer = null;
		if (this._view && this._bound) {
			for (const [type, handler] of this._bound) this._view.removeEventListener(type, handler);
		}
		this._bound = null;
		this._pan = null;
		this._sized = false;
	}

	get scale() { return this._scale; }
	get offset() { return { ...this._offset }; }

	/**
	 * Follow the window as it is dragged bigger, rather than snapping once it is let go.
	 *
	 * AppV1 only reports a resize on mouse-UP, so hanging the re-fit off that leaves the board the
	 * old size for the whole drag and then jumps — which reads as the window being broken until you
	 * release it. A ResizeObserver follows it frame by frame and also catches the resizes AppV1
	 * never reports at all (a maximise, a setPosition from code).
	 */
	_watchViewportSize() {
		this._measure();
		const Observer = globalThis.ResizeObserver;
		if (!Observer) return;
		this._observer?.disconnect();
		// Measured FIRST and unconditionally: the remembered size is what clampPan bounds a drag
		// against, so it has to keep up whether or not the board is re-fitting.
		this._observer = new Observer(() => {
			this._measure();
			if (this._fitting) this.fit();
		});
		this._observer.observe(this._view);
	}

	/** The one place that touches the DOM for the viewport's size. */
	_measure() {
		if (!this._view) return;
		this._viewW = this._view.clientWidth;
		this._viewH = this._view.clientHeight;
	}

	/** The board's painted size in window pixels, at the current scale. */
	painted() {
		return {
			width: this._naturalWidth * this._scale,
			height: this._naturalHeight * this._scale,
		};
	}

	/** Size the board to the window and centre it, until somebody zooms or drags. */
	fit() {
		if (!this._view) return;
		this._fitting = true;
		this._scale = fitScale({
			imageWidth: this._naturalWidth,
			imageHeight: this._naturalHeight,
			viewWidth: this._viewW,
			viewHeight: this._viewH,
		});
		const { width, height } = this.painted();
		this._offset = centreOffset({
			paintedWidth: width, paintedHeight: height,
			viewWidth: this._viewW, viewHeight: this._viewH,
		});
		this.apply();
	}

	/** Zoom, keeping `anchor` (a point in viewport coordinates) over the same speck of board. */
	zoomTo(scale, anchor = null) {
		const from = this._scale;
		const to = clampZoom(scale);
		// After the early return: a zoom that lands on the scale the board is already at moved
		// nothing, so it is no more a deliberate placement than a press that never dragged.
		if (to === from) return;
		this._fitting = false;
		this._scale = to;
		const x = anchor?.x ?? this._viewW / 2;
		const y = anchor?.y ?? this._viewH / 2;
		this._offset = {
			x: anchoredOffset({ offset: this._offset.x, pointer: x, from, to }),
			y: anchoredOffset({ offset: this._offset.y, pointer: y, from, to }),
		};
		this.apply();
	}

	/** Paint the current scale and position. */
	apply() {
		if (!this._content || !this._naturalWidth) return;
		const { width, height } = this.painted();
		// Clamped here rather than in the pan handler, so a zoom-out that leaves the board off in a
		// corner is caught as well as a drag that does.
		this._offset = {
			x: clampPan({ offset: this._offset.x, painted: width, view: this._viewW }),
			y: clampPan({ offset: this._offset.y, painted: height, view: this._viewH }),
		};
		// TRANSFORM ONLY. The other three are constants of the board this surface was handed, and a
		// pan writes this path several times per painted frame — a 125Hz mouse delivers more moves
		// than the browser paints — so re-setting a width that cannot have changed is three
		// needless style invalidations on every one of them.
		if (!this._sized) this._sizeContent();
		this._content.style.transform =
			`translate(${this._offset.x}px, ${this._offset.y}px) scale(${this._scale})`;
		this._onChange?.(this);
	}

	/**
	 * The board's fixed size and origin, written once.
	 *
	 * Lazily as well as from `attach`, so a surface driven without one (a fit or a zoom before the
	 * listeners are wired) still paints against a sized board rather than a collapsed one.
	 */
	_sizeContent() {
		if (!this._content || !this._naturalWidth) return;
		const style = this._content.style;
		style.width = `${this._naturalWidth}px`;
		style.height = `${this._naturalHeight}px`;
		style.transformOrigin = "0 0";
		this._sized = true;
	}

	/**
	 * Where a pointer event landed, as a percentage of the BOARD.
	 *
	 * The conversion every gesture needs: a drop, a drag, a click on empty board. Returns null off
	 * the board or before the surface has been measured, rather than a percentage outside 0-100
	 * that a caller would have to know to distrust.
	 */
	pointToPercent(ev) {
		const rect = this._view?.getBoundingClientRect?.();
		const { width, height } = this.painted();
		if (!rect || !(width > 0) || !(height > 0)) return null;
		const x = ev.clientX - rect.left - this._offset.x;
		const y = ev.clientY - rect.top - this._offset.y;
		return { left: (x / width) * 100, top: (y / height) * 100 };
	}

	/** How far a travel in window pixels moves something measured in board percentages. */
	deltaToPercent(dx, dy) {
		const { width, height } = this.painted();
		if (!(width > 0) || !(height > 0)) return { left: 0, top: 0 };
		return { left: (dx / width) * 100, top: (dy / height) * 100 };
	}

	/** Where a pointer event landed, relative to the viewport's own top-left. */
	anchorFor(ev) {
		const rect = this._view?.getBoundingClientRect?.();
		if (!rect) return null;
		return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
	}

	_onWheel(ev) {
		if (!ev.deltaY) return;
		ev.preventDefault();
		this.zoomTo(stepZoom(this._scale, ev.deltaY < 0 ? 1 : -1), this.anchorFor(ev));
	}

	/**
	 * Left-drag moves the board. Pointer capture, so a fast drag that leaves the window keeps
	 * moving it and the pointerup still arrives when the cursor is out over the canvas.
	 *
	 * A PRESS THAT LANDED ON A CONTROL STARTS NO PAN, and the reason is the capture rather than
	 * politeness. `setPointerCapture` RETARGETS every later event from that pointer — including the
	 * pointerup the browser derives the `click` from — at the capturing element. The viewport is an
	 * ancestor of every node on the board, so capturing here makes the click fire at the viewport,
	 * `closest()` find nothing, and every portrait in the window dead on a click that never moved a
	 * pixel. Releasing the capture on pointerup does not undo it: the click inherits its target from
	 * the already-retargeted pointerup. So the press has to be recognised BEFORE the capture.
	 */
	_onPanStart(ev) {
		if (ev.button !== 0 || !this._view) return;
		if (this._controls && ev.target?.closest?.(this._controls)) return;
		ev.preventDefault();
		this._pan = {
			id: ev.pointerId,
			x: ev.clientX,
			y: ev.clientY,
			offsetX: this._offset.x,
			offsetY: this._offset.y,
		};
		this._view.classList.add("stonetop-zoom-pan--panning");
		this._view.setPointerCapture?.(ev.pointerId);
	}

	/**
	 * From the offset the drag STARTED at plus the total travel, never from the last position plus
	 * a delta: the clamp in `apply` would otherwise eat a pixel off each move, and a drag along an
	 * edge would creep away from the cursor.
	 */
	_onPanMove(ev) {
		if (!this._pan || ev.pointerId !== this._pan.id) return;
		const dx = ev.clientX - this._pan.x;
		const dy = ev.clientY - this._pan.y;
		// A press that never moved is not a placement: it leaves the board fitted, so a window
		// resized afterwards still re-fits rather than being stuck where a stray click left it.
		if (dx || dy) this._fitting = false;
		this._offset = { x: this._pan.offsetX + dx, y: this._pan.offsetY + dy };
		this.apply();
	}

	_onPanEnd(ev) {
		if (!this._pan || ev.pointerId !== this._pan.id) return;
		this._view.releasePointerCapture?.(ev.pointerId);
		this._view.classList.remove("stonetop-zoom-pan--panning");
		this._pan = null;
	}

	/** The gesture everyone tries first: out to the whole board, in to full size, under the cursor. */
	_onDoubleClick(ev) {
		if (this._controls && ev.target?.closest?.(this._controls)) return;
		ev.preventDefault();
		if (this._fitting) this.zoomTo(1, this.anchorFor(ev));
		else this.fit();
	}
}
