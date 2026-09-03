// The gestures on a relationship map: moving a portrait, and dragging a line from one to another.
//
// POINTER EVENTS, NEVER HTML5 DnD, for the reasons utils/relationship-board.js sets out at length
// where it makes the same choice: sheets install capture-phase drop handlers that eat the payload,
// Gecko pastes an uncancelled drop's text into whatever input is under it (and this board has a
// live label field), and a native drag cannot be cancelled from the keyboard.
//
// TWO THRESHOLDS, ONE BORROWED. `isLiftedDrag` is imported rather than restated, so "how far is a
// drag" has one answer across the system. `isCommittedDrop` is deliberately NOT used here: it
// exists on the standings board because a card straddles two drop zones and a 4px twitch could
// rewrite a rating the reader never aimed at. This board has no zones — a portrait goes exactly
// where it is put — so a small deliberate nudge is a real edit and refusing it would be the bug.
// `liftsDrag`'s horizontal-dominance rule is left behind for the same kind of reason: it exists to
// give a vertical swipe back to a scrolling parent, and there is no scroller here.

import { beginCancellableDrag, endCancellableDrag, isLiftedDrag } from "./relationship-board.js";

// ── Escape ───────────────────────────────────────────────────────────────────────────
//
// Escape-to-cancel is IMPORTED, not restated: relationship-board.js owns the one capture-phase
// window listener and the discovery behind it (core's KeyboardManager binds keydown in the
// bubble phase and never checks `defaultPrevented`, so an Escape meant to abandon a half-drawn
// line would otherwise close every open window). A second copy here would be a second global
// Escape swallower with its own idea of which drag is live.

/** How far an arrow key nudges a focused portrait, as a percentage of the board. */
export const NUDGE_STEP = 1;
export const NUDGE_FINE = 0.25;

/**
 * How far a portrait has moved, in board percentages, given a pointer travel in SCREEN pixels.
 *
 * The board is scaled as a whole, so a hundred pixels of cursor is a hundred pixels of board only
 * at 1:1. Divide by the scale and the portrait stays under the cursor at any magnification; forget
 * to and it slides away faster the further in the reader has zoomed, which reads as the map
 * fighting them.
 */
export function dragTranslation({ dx = 0, dy = 0, scale = 1 } = {}) {
	const s = Number(scale) > 0 ? Number(scale) : 1;
	return { x: dx / s, y: dy / s };
}

/**
 * Wire every pointer gesture on one rendered board.
 *
 * @param {HTMLElement} root      The window's root element.
 * @param {object} handlers
 * @param {object} handlers.surface     The ZoomPanSurface, for pixel-to-percentage conversion.
 * @param {Function} handlers.nodeAt    `id => {x, y}` — where a portrait currently sits.
 * @param {Function} handlers.onMove    `(id, {x, y}) => void` — committed on release.
 * @param {Function} handlers.onNudge   `(id, {x, y}) => void` — one arrow key. SEPARATE from
 *                                      `onMove` because a held arrow repeats ~30 times a
 *                                      second and each of those must not be a document write.
 * @param {Function} handlers.onDragMove `(id, {x, y}) => void` — where the portrait is RIGHT NOW,
 *                                      once per painted frame, so the lines can travel with it.
 * @param {Function} handlers.onDragEnd `(id, restore) => void` — that gesture is over. `restore`
 *                                      is the spot to put the lines back to when the drag was
 *                                      abandoned, and null when the drop is being written.
 * @param {Function} handlers.onLink    `(fromId, toId) => void` — a line dragged between two.
 * @param {Function} handlers.onLinkFrom `id => void` — the handle CLICKED rather than dragged.
 * @param {Function} handlers.onOpen    `id => void` — a portrait clicked without dragging.
 * @param {Function} handlers.onEditEdge `id => void` — a label clicked.
 * @param {Function} handlers.onRemove  `id => void` — Delete pressed on a focused portrait.
 * @param {Function} handlers.canEdit   `() => boolean` — re-asked per gesture, because the lock
 *                                      can be turned while a board is open.
 * @returns {Function} teardown.
 */
export function wireRelmapDrag(root, {
	surface, nodeAt, onMove, onNudge, onDragMove, onDragEnd, onLink, onLinkFrom, onOpen, onEditEdge,
	onRemove,
	canEdit = () => true,
} = {}) {
	const board = root?.querySelector?.(".stonetop-relmap-board");
	const view = root?.querySelector?.(".stonetop-relmap-view");
	if (!board || !view) return () => {};

	let drag = null;
	let frameId = 0;
	// Set by a release that ENDED A REAL DRAG, and read by the one click the browser derives from
	// it. See the click handler for why the pointer capture is not left to do this on its own.
	let swallowClick = false;

	/** The rubber band a half-drawn line is shown as. Made once, reused, never re-rendered. */
	const rubber = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	rubber.setAttribute("class", "stonetop-relmap-rubber");
	rubber.setAttribute("viewBox", "0 0 100 100");
	rubber.setAttribute("preserveAspectRatio", "none");
	rubber.setAttribute("aria-hidden", "true");
	const rubberLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
	rubberLine.setAttribute("vector-effect", "non-scaling-stroke");
	rubber.appendChild(rubberLine);

	/**
	 * ONE exit for every way a drag can end: dropped, cancelled, Escape, or the pointer lost.
	 *
	 * State is cleared FIRST because `releasePointerCapture` fires `lostpointercapture`
	 * synchronously, which re-enters this function — the same order relationship-board.js keeps,
	 * and for the same reason.
	 *
	 * `committed` says whether a drop is going to be WRITTEN. It matters only to the live preview:
	 * the lines have been redrawn where the pointer left them, and an abandoned drag puts the
	 * portrait back without writing anything, so somebody has to put the lines back too.
	 */
	function end(committed = false) {
		const finished = drag;
		drag = null;
		endCancellableDrag();
		if (frameId) { cancelAnimationFrame(frameId); frameId = 0; }
		if (!finished) return null;
		try { view.releasePointerCapture?.(finished.pointerId); } catch { /* already gone */ }
		if (finished.el) {
			finished.el.style.transform = "";
			finished.el.classList.remove("is-dragging");
		}
		rubber.remove();
		board.classList.remove("is-dragging");
		// After the class is off, so anything the window does in response reads a board that is no
		// longer busy. Only for a drag that actually started: an armed press redrew nothing.
		if (finished.started && finished.kind === "node") {
			onDragEnd?.(finished.id, committed ? null : { x: finished.from.left, y: finished.from.top });
		}
		return finished;
	}

	/**
	 * All the per-sample work, once per PAINTED frame.
	 *
	 * A 125Hz mouse delivers two to eight pointermove events per frame the browser actually draws,
	 * and doing the arithmetic and the style write in the handler does all of it two to eight times
	 * for one visible result.
	 */
	function frame() {
		frameId = 0;
		if (!drag?.started) return;
		if (drag.kind === "node" && drag.el) {
			const { x, y } = dragTranslation({ dx: drag.dx, dy: drag.dy, scale: surface.scale });
			// A transform, not left/top: it composites instead of re-laying out every node on the
			// board on every frame of the drag.
			drag.el.style.transform = `translate(${x}px, ${y}px)`;
			// AND THE LINES COME WITH IT. Without this the portrait moves and every line attached
			// to it stays pinned to the spot it was picked up from until the pointer is released,
			// which reads as the map not having noticed the drag. Reported from the same travel
			// the drop will use, so what the reader watches settle is where it lands.
			//
			// Deliberately in the SAME rAF as the transform: the two have to be painted in one
			// frame or the line lags a frame behind its own portrait, which is the fault this is
			// here to fix, only smaller.
			const moved = surface.deltaToPercent?.(drag.dx, drag.dy);
			if (moved) {
				onDragMove?.(drag.id, {
					x: drag.from.left + moved.left,
					y: drag.from.top + moved.top,
				});
			}
		} else if (drag.kind === "link") {
			const at = surface.pointToPercent({ clientX: drag.clientX, clientY: drag.clientY });
			if (at) rubberLine.setAttribute("d", `M ${drag.from.left},${drag.from.top} L ${at.left},${at.top}`);
		}
	}

	function schedule() {
		if (!frameId) frameId = requestAnimationFrame(frame);
	}

	view.addEventListener("pointerdown", ev => {
		if (ev.button !== 0 || drag || !canEdit()) return;
		const handle = ev.target.closest?.("[data-relmap-handle]");
		const node = ev.target.closest?.("[data-relmap-node]");
		if (!handle && !node) return;

		const id = handle ? handle.dataset.relmapHandle : node.dataset.relmapNode;
		const spot = nodeAt?.(id);
		if (!spot) return;

		drag = {
			kind: handle ? "link" : "node",
			id,
			el: handle ? null : node,
			pointerId: ev.pointerId,
			startX: ev.clientX, startY: ev.clientY,
			clientX: ev.clientX, clientY: ev.clientY,
			dx: 0, dy: 0,
			from: { left: spot.x, top: spot.y },
			started: false,
		};
		// NO POINTER CAPTURE YET, and this is the whole reason the board's clicks work.
		// `setPointerCapture` RETARGETS every later event from that pointer — including the
		// pointerup the browser derives the `click` from — at the capturing element, and releasing
		// it on pointerup does not undo it: the click inherits its target from the already
		// retargeted pointerup. `view` is an ancestor of every portrait, so capturing on the way
		// past an ARMED press would make the click fire at the viewport, `closest()` find nothing,
		// and a plain click on a portrait open no sheet and a click on a handle open no picker.
		// utils/zoom-pan-surface.js sets the same trap out at length where it refuses to pan from
		// a control. So the capture is taken in `pointermove`, once the press is known to be a
		// drag; the moves before that are safe uncaptured because this listener is on `view` and
		// not on the portrait, and the threshold is a few pixels inside a full-window viewport.
		//
		// A press stalling ARMED forever is not a leak either: `drag` is cleared by the pointerup,
		// the pointercancel, or the teardown, whichever arrives.
		swallowClick = false;
	});

	view.addEventListener("pointermove", ev => {
		if (!drag || ev.pointerId !== drag.pointerId) return;
		drag.dx = ev.clientX - drag.startX;
		drag.dy = ev.clientY - drag.startY;
		drag.clientX = ev.clientX;
		drag.clientY = ev.clientY;
		if (!drag.started) {
			if (!isLiftedDrag(drag.dx, drag.dy)) return;
			drag.started = true;
			// NOW, and not at pointerdown: a fast drag has to keep being followed once the cursor
			// leaves the window, and the pointerup has to arrive even if it happens out over the
			// scene canvas. Taken only here, so an unmoved press keeps its own click (see above).
			view.setPointerCapture?.(drag.pointerId);
			beginCancellableDrag(() => end());
			board.classList.add("is-dragging");
			if (drag.kind === "node") drag.el?.classList.add("is-dragging");
			else board.appendChild(rubber);
		}
		// Only once the drag is real, or this would suppress ordinary presses on the board.
		ev.preventDefault();
		schedule();
	});

	view.addEventListener("pointerup", ev => {
		if (!drag || ev.pointerId !== drag.pointerId) return;
		// Never crossed the threshold. Tear down WITHOUT consuming the event, so the click
		// handlers below still see it and a press on a portrait still opens a sheet.
		if (!drag.started) { end(); return; }
		// It did, so the click this release is about to produce is the tail of a drag and not a
		// press on anything. Set HERE and not in `end`, which also runs for an Escape and a
		// pointercancel — neither of which is followed by a click, so a flag set there would sit
		// armed and eat the reader's next real one.
		swallowClick = true;
		// Resolved from the RELEASE position, synchronously: the moves are coalesced to one frame
		// each, so the last one or two before the release may never have been processed.
		const dropX = ev.clientX;
		const dropY = ev.clientY;
		// Asked BEFORE the teardown, because the teardown needs the answer: the lock can be turned
		// while a drag is in the air, and a drop that is going to be refused has to put the lines
		// back rather than leave them where the pointer stopped.
		const commit = canEdit();
		const finished = end(commit);
		if (!finished || !commit) return;

		if (finished.kind === "node") {
			// Straight from the SCREEN travel: `deltaToPercent` measures against the board's
			// PAINTED size, so the scale is already in it. Dividing by the scale first as well
			// would apply the correction twice and drop the portrait short.
			const moved = surface.deltaToPercent(finished.dx, finished.dy);
			onMove?.(finished.id, {
				x: finished.from.left + moved.left,
				y: finished.from.top + moved.top,
			});
			return;
		}

		// elementsFromPoint and not elementFromPoint: the rubber band and the handle both ride
		// under the cursor, and the topmost hit is not the portrait being aimed at.
		const target = (document.elementsFromPoint?.(dropX, dropY) ?? [])
			.map(el => el.closest?.("[data-relmap-node]"))
			.find(el => el && el.dataset.relmapNode !== finished.id);
		if (target) onLink?.(finished.id, target.dataset.relmapNode);
	});

	view.addEventListener("pointercancel", ev => {
		// Checked, or a second finger anywhere on the board kills a live drag.
		if (drag && ev.pointerId === drag.pointerId) end();
	});
	view.addEventListener("lostpointercapture", ev => {
		if (drag && ev.pointerId === drag.pointerId) end();
	});

	// ── Clicks ──────────────────────────────────────────────────────────────
	//
	// On `click` and deliberately not on pointerdown: a press that becomes a drag must not also
	// have opened a sheet on its way past.
	//
	// The flag rather than the pointer capture's retargeting, even though that would also swallow
	// this one. The capture is taken to keep a drag alive off the edge of the window, and the
	// retarget is a side effect of it; hanging "a drag does not also open a sheet" off that side
	// effect means the rule quietly dies the day the capture moves or a browser stops retargeting
	// the derived click. One boolean says it outright, and can be tested without a real DOM.
	view.addEventListener("click", ev => {
		if (swallowClick) { swallowClick = false; return; }
		const handle = ev.target.closest?.("[data-relmap-handle]");
		if (handle) { ev.preventDefault(); if (canEdit()) onLinkFrom?.(handle.dataset.relmapHandle); return; }
		const label = ev.target.closest?.("[data-relmap-edge]");
		if (label) { ev.preventDefault(); if (canEdit()) onEditEdge?.(label.dataset.relmapEdge); return; }
		const face = ev.target.closest?.("[data-relmap-open]");
		if (face) { ev.preventDefault(); onOpen?.(face.dataset.relmapOpen); }
	});

	// ── Keyboard ────────────────────────────────────────────────────────────
	//
	// Every gesture above has to have a non-drag route, or the board is unusable to anyone who does
	// not or cannot drag. Arrow keys nudge the focused portrait; the handle is a real button and
	// opens the same "link to whom" picker on Enter as it does on a click.
	//
	// stopPropagation, not just preventDefault: core's KeyboardManager would otherwise pan the
	// scene canvas behind this window on every arrow press.
	view.addEventListener("keydown", ev => {
		const face = ev.target.closest?.("[data-relmap-open]");
		if (!face || !canEdit()) return;
		const id = face.dataset.relmapOpen;

		if (ev.key === "Delete") {
			ev.preventDefault();
			ev.stopPropagation();
			onRemove?.(id);
			return;
		}

		const step = ev.shiftKey ? NUDGE_FINE : NUDGE_STEP;
		const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
		if (!move) return;
		ev.preventDefault();
		ev.stopPropagation();
		const spot = nodeAt?.(id);
		if (!spot) return;
		(onNudge ?? onMove)?.(id, { x: spot.x + move[0], y: spot.y + move[1] });
	});

	return () => { end(); };
}
