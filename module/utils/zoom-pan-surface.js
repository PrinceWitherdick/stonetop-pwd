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
import { GLIDE_WINDOW_MS, glideStep, throwVelocity, worthGliding } from "./pan-glide.js";
import { prefersReducedMotion } from "./reduced-motion.js";

export class ZoomPanSurface {
	/**
	 * @param {object} spec
	 * @param {HTMLElement} spec.view     The window the board is seen through. Events land here.
	 * @param {HTMLElement} spec.content  The board itself, positioned and scaled by this class.
	 * @param {number} spec.naturalWidth  The board's notional size, in CSS pixels at 1:1.
	 * @param {number} spec.naturalHeight
	 * @param {string} [spec.controls]    Selector for children a LEFT press must NOT pan from.
	 * @param {string} [spec.menus]       Selector for children a RIGHT press must not pan from
	 *                                    either: chrome floating OVER the board, which a reader
	 *                                    aims at rather than drags. They keep the browser's own
	 *                                    menu too, where the host has left one. Everything else
	 *                                    pans on a right drag, `controls` included: that is the
	 *                                    whole point of the right button.
	 * @param {Function} [spec.onChange]  Called after every paint, for a caller that has its own
	 *                                    pixel-sized furniture to keep in step.
	 */
	constructor({ view, content, naturalWidth, naturalHeight, controls = "", menus = "", onChange = null } = {}) {
		this._view = view ?? null;
		this._content = content ?? null;
		this._naturalWidth = Number(naturalWidth) || 0;
		this._naturalHeight = Number(naturalHeight) || 0;
		this._controls = controls;
		this._menus = menus;
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
		// The frame a pending pan is waiting on, so many pointer moves collapse into one paint.
		this._frameId = 0;
		// The tail of the pointer's journey, for reading the speed off a release. Trimmed to the
		// window utils/pan-glide.js reads, so a minute-long drag keeps a dozen samples and not
		// several thousand.
		this._marks = [];
		// The throw still being paid out, `{ velocity, at }`, and the frame it is waiting on.
		this._glide = null;
		this._glideId = 0;
		// Whether the press now under way was made to CATCH a sliding board. See `_onCaughtClick`.
		this._caught = false;
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
			["contextmenu", this._onContextMenu.bind(this)],
			// ⚠ CAPTURE, and the only listener here that is. It has to reach the click BEFORE the
			// board's own handlers do, since its whole job is to take that one click away from
			// them. See `_onCaughtClick`.
			["click", this._onCaughtClick.bind(this), { capture: true }],
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
		if (this._frameId) {
			globalThis.cancelAnimationFrame?.(this._frameId);
			this._frameId = 0;
		}
		this._stopGlide();
		if (this._view && this._bound) {
			// ⚠ THE OPTIONS GO BACK TOO. `removeEventListener` matches on the CAPTURE flag as well
			// as the type and the function, so dropping the third argument here would leave the
			// capturing click listener wired to a dead surface on every window that is closed.
			for (const [type, handler, opts] of this._bound) {
				this._view.removeEventListener(type, handler, opts);
			}
		}
		this._bound = null;
		this._pan = null;
		this._marks = [];
		this._sized = false;
	}

	get scale() { return this._scale; }
	get offset() { return { ...this._offset }; }
	/**
	 * The viewport's own size, from the measurement this surface already keeps up to date.
	 *
	 * Here so that chrome placing itself over the board does not have to measure the viewport
	 * for itself. `_measure` is the one place that touches the DOM for this and a ResizeObserver
	 * keeps it fresh, so asking costs nothing -- while a `getBoundingClientRect` on every painted
	 * frame of a pan is a forced layout of the whole board per frame.
	 */
	get viewSize() { return { width: this._viewW, height: this._viewH }; }
	/**
	 * The board this surface is showing has become a different SIZE.
	 *
	 * Not a thing a picture ever does, which is why the size arrived in the constructor and is
	 * otherwise treated as a constant. A DOM board can: the relationship map's sheet grows with the
	 * number of people on it, so somebody else adding a portrait can change it under an open window.
	 *
	 * Only re-fits when the reader has not placed the board themselves. Somebody who has zoomed
	 * into a corner to read it keeps their corner; re-fitting under them would throw away the very
	 * thing they were looking at, which is the rule the whole live-update path is built on.
	 */
	setNaturalSize(width, height) {
		const w = Number(width) || 0;
		const h = Number(height) || 0;
		if (!w || !h || (w === this._naturalWidth && h === this._naturalHeight)) return;
		this._naturalWidth = w;
		this._naturalHeight = h;
		this._sized = false;
		if (this._fitting) this.fit();
		else this.apply();
	}

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
		// A board being put back where it belongs is not one that should still be drifting.
		this._stopGlide();
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
		// A zoom picks a point and holds it under the cursor. A throw still paying out would drag
		// that point straight back off it, so the throw ends here.
		this._stopGlide();
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
		// TRANSFORM ONLY. The other three are constants of the board this surface was handed, so
		// re-setting a width that cannot have changed is three needless style invalidations on every
		// frame of a drag. A pan reaches this once per PAINTED frame rather than once per pointer
		// event (see `_schedule`) — a 125Hz mouse delivers more moves than the browser paints, and
		// each surplus one would cost the whole `onChange` chain behind this as well as the write.
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
		// Before the zoom rather than inside it: a notch that lands on the scale the board is
		// already at (the ends of the range) still means the reader has taken hold of the board.
		this._stopGlide();
		this.zoomTo(stepZoom(this._scale, ev.deltaY < 0 ? 1 : -1), this.anchorFor(ev));
	}

	/**
	 * A drag moves the board, with either button. Pointer capture, so a fast drag that leaves the
	 * window keeps moving it and the pointerup still arrives when the cursor is out over the canvas.
	 *
	 * A LEFT PRESS THAT LANDED ON A CONTROL STARTS NO PAN, and the reason is the capture rather
	 * than politeness. `setPointerCapture` RETARGETS every later event from that pointer —
	 * including the pointerup the browser derives the `click` from — at the capturing element. The
	 * viewport is an ancestor of every node on the board, so capturing here makes the click fire at
	 * the viewport, `closest()` find nothing, and every portrait in the window dead on a click that
	 * never moved a pixel. Releasing the capture on pointerup does not undo it: the click inherits
	 * its target from the already-retargeted pointerup. So the press has to be recognised BEFORE
	 * the capture.
	 *
	 * AND THAT IS EXACTLY WHY THERE IS A RIGHT-DRAG (user, 2026-09-06). The rule above is sound and
	 * it is also, from the reader's chair, the board refusing to move: the controls it steps aside
	 * for are a web of lines laid over the whole diagram, so a press aimed at open paper that lands
	 * a few pixels onto a stroke does nothing at all, and the harder you try the more lines there
	 * are to hit. The right button skips the question. It pans from wherever it is pressed, because
	 * a right press derives no `click` for the retargeting to spoil: what it derives is the
	 * `contextmenu` this surface shuts anyway (see `_onContextMenu`). Only `menus` refuses it, and
	 * only for chrome standing OVER the board — a panel the reader is aiming at, which must not
	 * slide the ground out from under the press that was meant for its buttons.
	 */
	_onPanStart(ev) {
		if (!this._view || this._pan) return;
		// ⚠ BEFORE EVERY GUARD BELOW, and on any button. Catching a sliding board is not a pan and
		// has nothing to do with whether this press is allowed to become one: a hand put down on a
		// moving board stops it, whether it landed on open paper, on a portrait, or on a line. A
		// glide that could only be stopped by pressing the right kind of thing would be a board
		// that ignores you, which is the exact complaint the right-drag below exists to answer.
		const caught = this._stopGlide();
		// ⚠ BUT ONLY A LEFT PRESS ARMS THE FLAG, because only a left press derives the `click` the
		// flag exists to be spent on. A right or middle press derives none (a `contextmenu` and an
		// `auxclick` respectively), so arming on one leaves a `true` with nothing to consume it --
		// and `_onCaughtClick` would then eat the next click that arrives without a press of its
		// own in front of it, which is exactly what a keyboard activation of a portrait or a button
		// on this board is. The write itself is unconditional, so a press that caught nothing still
		// clears whatever the one before it left behind.
		this._caught = caught && ev.button === 0;
		const right = ev.button === 2;
		if (ev.button !== 0 && !right) return;
		// ONE BUTTON AT A TIME. A right press while a portrait is already being dragged with the
		// left is not a pan: it would slide the board out from under the drag and leave the two
		// gestures fighting over the same pointer. `buttons` counts everything held, so anything
		// past the single bit for the button that was just pressed means another was already down.
		// A host that reports no `buttons` at all (the tests' fake events) compares false and pans.
		if (ev.buttons > 2) return;
		const refuse = right ? this._menus : this._controls;
		if (refuse && ev.target?.closest?.(refuse)) return;
		ev.preventDefault();
		this._pan = {
			id: ev.pointerId,
			x: ev.clientX,
			y: ev.clientY,
			offsetX: this._offset.x,
			offsetY: this._offset.y,
		};
		// The trail starts at the press, so a flick made of a single move still has two points to
		// take a speed from. Every earlier drag's marks go with it.
		this._marks = [{ t: this._now(), x: ev.clientX, y: ev.clientY }];
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
		// ⚠ MARKED PER EVENT, and deliberately NOT inside the coalesced paint below. The speed of a
		// throw is a fact about the hand, not about how often the browser got round to drawing: a
		// trail sampled once per painted frame would read a 125Hz mouse at half its real rate on a
		// good machine and at a quarter of it on a machine that was busy, so the same flick would
		// glide a different distance depending on what else the tab was doing.
		this._mark(ev);
		// ⚠ ONCE PER PAINTED FRAME, not once per pointer event. `apply` says it plainly: a 125Hz
		// mouse delivers more moves than the browser paints, and every surplus one costs the whole
		// `onChange` chain behind it as well as the transform -- on the relationship map that is a
		// board query and a class sweep per event. The node drag beside this (utils/relmap-drag.js)
		// coalesces the same way and for the same reason. Zoom and `fit` stay synchronous: they are
		// one-shot, and a frame's delay on them would be felt.
		this._schedule();
	}

	/**
	 * Paint the pending offset on the next frame, and only once however many moves arrive first.
	 *
	 * Off the bare global, as utils/relmap-drag.js schedules its own coalesced paint: one convention
	 * for the two things batching against the same board. A host with no `requestAnimationFrame`
	 * paints synchronously rather than not at all.
	 */
	_schedule() {
		if (this._frameId) return;
		if (typeof globalThis.requestAnimationFrame !== "function") {
			this.apply();
			return;
		}
		this._frameId = globalThis.requestAnimationFrame(() => {
			this._frameId = 0;
			// The surface may have been torn down between the request and the frame.
			if (this._bound) this.apply();
		});
	}

	_onPanEnd(ev) {
		if (!this._pan || ev.pointerId !== this._pan.id) return;
		this._view.releasePointerCapture?.(ev.pointerId);
		this._view.classList.remove("stonetop-zoom-pan--panning");
		this._pan = null;
		// The release carries a position of its own, and on a fast flick it is the last few pixels
		// of the throw. `_mark` shrugs off a host that gave us no coordinates to read.
		this._mark(ev);
		// The last move may still be waiting on a frame, and the pointer is gone: paint where it
		// finished rather than leaving the board a few pixels behind where it was let go.
		this._paintNow();
		// A CANCEL IS NOT A THROW. It is the platform taking the gesture away (a system gesture, a
		// pen leaving the tablet, a window losing the pointer), and finishing it off with a flourish
		// the reader never asked for would be the board moving on its own.
		if (ev.type === "pointercancel") { this._marks = []; return; }
		this._startGlide(throwVelocity(this._marks, this._now()));
		this._marks = [];
	}

	/** Add one point to the trail a throw is read from, and drop the ones that have aged out. */
	_mark(ev) {
		if (!Number.isFinite(ev?.clientX) || !Number.isFinite(ev?.clientY)) return;
		const t = this._now();
		this._marks.push({ t, x: ev.clientX, y: ev.clientY });
		// Only to keep a long drag from hoarding thousands of points: which of the survivors count
		// is `throwVelocity`'s question, asked again against the moment of the RELEASE. Hence the
		// floor of two, so trimming can never be what decides a throw.
		while (this._marks.length > 2 && t - this._marks[0].t > GLIDE_WINDOW_MS) this._marks.shift();
	}

	/** The clock the trail and the glide are both timed on. */
	_now() {
		return globalThis.performance?.now?.() ?? Date.now();
	}

	/** Drop any pending frame and paint immediately. */
	_paintNow() {
		if (!this._frameId) return;
		globalThis.cancelAnimationFrame?.(this._frameId);
		this._frameId = 0;
		this.apply();
	}

	/**
	 * Let a thrown board keep going (user, 2026-09-06: "it slides a bit depending on velocity").
	 *
	 * WHAT IT IS FOR, beyond feeling nice. A relationship map is bigger than any window it is ever
	 * seen through, and the way a reader crosses it is a series of drags: grab, haul, let go, grab
	 * again. Without a glide, the reach of one gesture is the width of the window minus wherever the
	 * hand started, so getting from one end of a wide board to the other is four or five hauls, each
	 * one re-grabbing paper that has stopped dead. A throw turns those into one flick and a wait,
	 * and it turns "how far did I move it" into a thing the hand can aim with rather than measure.
	 *
	 * REFUSED OUTRIGHT WHERE LESS MOTION WAS ASKED FOR. Content that keeps moving after the reader
	 * stopped moving it is exactly what that setting is about, and here it costs nothing to honour:
	 * the drag itself is untouched, the board simply stops where it was let go, which is what it did
	 * before this existed.
	 */
	_startGlide(velocity) {
		if (!this._bound || !worthGliding(velocity) || prefersReducedMotion()) return;
		this._glide = { velocity, at: this._now() };
		this._askGlideFrame();
	}

	/** Book the next frame of the slide. */
	_askGlideFrame() {
		if (typeof globalThis.requestAnimationFrame !== "function") {
			// A host with no frames to hang an animation on gets no animation. `_schedule` paints
			// synchronously in the same spot because a pan MUST land where the pointer left it; a
			// glide is the opposite, a thing that only exists as motion, so there is nothing to
			// paint in one go and the board simply stops where it was let go.
			this._stopGlide();
			return;
		}
		this._glideId = globalThis.requestAnimationFrame(() => {
			this._glideId = 0;
			this._glideFrame();
		});
	}

	_glideFrame() {
		// Torn down, or caught, between the request and the frame.
		if (!this._bound || !this._glide) return;
		const now = this._now();
		const { dx, dy, velocity } = glideStep({ velocity: this._glide.velocity, dt: now - this._glide.at });
		this._glide.at = now;
		this._glide.velocity = velocity;

		const wanted = { x: this._offset.x + dx, y: this._offset.y + dy };
		this._offset = { ...wanted };
		this.apply();

		// ⚠ AN AXIS THE CLAMP HELD IS AN AXIS THAT IS DONE. `apply` writes the bounded offset back,
		// so a board that has reached the end of its travel comes out of it somewhere other than
		// where this frame asked for. Kept alive, the glide would spend its whole remaining second
		// grinding against that edge while the reader waits for a board that has already stopped
		// (and, worse, holding the two axes hostage: a throw that runs off the right-hand edge would
		// stop climbing as well). Zeroed per axis, a diagonal throw that reaches one wall keeps
		// sliding along it, which is what every other surface a reader has ever thrown does.
		if (this._offset.x !== wanted.x) this._glide.velocity.x = 0;
		if (this._offset.y !== wanted.y) this._glide.velocity.y = 0;

		if (!worthGliding(this._glide.velocity)) this._stopGlide();
		else this._askGlideFrame();
	}

	/**
	 * End any slide still under way, and say whether there was one.
	 *
	 * The answer is what `_onPanStart` reads to tell a press that CAUGHT the board from a press that
	 * simply landed on a board sitting still, and it is the only way to tell them apart: by the time
	 * the click arrives the glide is long gone.
	 */
	_stopGlide() {
		const running = this._glide !== null;
		if (this._glideId) {
			globalThis.cancelAnimationFrame?.(this._glideId);
			this._glideId = 0;
		}
		this._glide = null;
		return running;
	}

	/**
	 * The click that stopped a sliding board opens nothing.
	 *
	 * ⚠ WHY IT IS WORTH TAKING A CLICK AWAY. Stopping a glide is a press, and a press on this board
	 * is also how a portrait is opened, a line is picked up and a tie bar is dismissed. So without
	 * this, reaching out to halt a board mid-slide opens whichever face happened to be sailing under
	 * the cursor at that instant -- a dialog for somebody the reader was not even looking at, from a
	 * gesture that meant "stop". Every surface with momentum on it does the same thing: the tap that
	 * catches the scroll is consumed by the catching.
	 *
	 * `stopImmediatePropagation`, not `stopPropagation`, because the handlers being held off are on
	 * this same element: utils/relmap-drag.js wires its click to the viewport too, and at the target
	 * a plain stopPropagation would not keep the event from the listeners beside this one.
	 *
	 * ONE CLICK ONLY, and only after a LEFT press that actually caught something. The flag is written
	 * by every `_onPanStart`, so a press on a still board clears whatever the last one left behind;
	 * and it is armed only where a click is actually coming, so a right press that stopped the board
	 * cannot leave a `true` behind for the next innocent click to walk into. See `_onPanStart`.
	 */
	_onCaughtClick(ev) {
		if (!this._caught) return;
		this._caught = false;
		ev.stopImmediatePropagation?.();
		ev.preventDefault?.();
	}

	/**
	 * The browser's own menu, kept shut over the board.
	 *
	 * UNCONDITIONAL, and not "only once a right-drag has actually moved something", because the two
	 * cannot be told apart in time. Which end of the press this event arrives on is a PLATFORM
	 * convention: measured in Chromium on Windows it comes after the pointerup, and elsewhere it
	 * comes with the press. So a menu suppressed only once a drag had begun would still flash open
	 * under the cursor on one of them, on every single right press, before the reader had moved a
	 * pixel.
	 *
	 * AND IT DOES NOT LEAN ON THE HOST FOR IT. Foundry disables right-click across the whole
	 * document (`Game#activateListeners`), so inside the app this is belt and braces — but a
	 * surface whose own gesture only works because somebody else's listener happens to be there is
	 * one core release away from flashing a menu on every pan. `menus` is the way out for chrome
	 * that wants its press left alone, and it is the same list that refuses the pan: a menu offered
	 * over a board already sliding would be the worst of both.
	 */
	_onContextMenu(ev) {
		if (this._menus && ev.target?.closest?.(this._menus)) return;
		ev.preventDefault();
	}

	/** The gesture everyone tries first: out to the whole board, in to full size, under the cursor. */
	_onDoubleClick(ev) {
		if (this._controls && ev.target?.closest?.(this._controls)) return;
		ev.preventDefault();
		if (this._fitting) this.zoomTo(1, this.anchorFor(ev));
		else this.fit();
	}
}
