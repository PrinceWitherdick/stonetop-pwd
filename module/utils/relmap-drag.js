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
 * Where a portrait has been carried to, written for the stylesheet to fold into its own transform.
 *
 * TWO CUSTOM PROPERTIES AND NOT AN INLINE `transform`, and this is the whole reason the drop lands
 * where the gesture said it would. A node is positioned by its CENTRE, which the stylesheet does
 * with the `translate(-50%, -50%)` that the geometry trimming the lines is written against. An
 * inline `transform` REPLACES that declaration rather than adding to it, so writing one un-centres
 * the portrait for the length of the gesture: it jumps half its own width down and right the
 * instant the threshold is crossed, rides that far off the lines still drawn to its true centre,
 * and snaps back the moment the transform is dropped on release, which reads as the release
 * teleporting the portrait onto the cursor. Two variables leave the centring where it is written,
 * once, and cost the same one composited style write per frame.
 */
function writeTravel(el, x, y) {
	el.style.setProperty?.("--relmap-drag-x", `${x}px`);
	el.style.setProperty?.("--relmap-drag-y", `${y}px`);
}

/** No travel at all, so the node is painted from its own coordinates again. */
function clearTravel(el) {
	el.style.removeProperty?.("--relmap-drag-x");
	el.style.removeProperty?.("--relmap-drag-y");
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
 * @param {Function} handlers.onPickEdge `id => void` — a line taken hold of, by a click on the
 *                                      stroke itself or on the words set in it. NOT "opened": what
 *                                      this raises is the bar over the line (utils/relmap-tie-bar.js),
 *                                      and the dialog behind it is one button further on.
 * @param {Function} handlers.onPickNone `() => void` — a click that landed on the board and on
 *                                      nothing on it, which is how a reader lets a line go.
 * @param {Function} handlers.onRemove  `id => void` — Delete pressed on a focused portrait.
 * @param {Function} handlers.canEdit   `() => boolean` — re-asked per gesture, because a map's
 *                                      ownership can change while a board is open.
 * @param {Function} handlers.canMove   `() => boolean` — whether a PORTRAIT may be picked up,
 *                                      asked separately from `canEdit` and defaulting to it. The
 *                                      narrow views work the portraits out for themselves and write
 *                                      none of them, so on those boards a drag would have nowhere
 *                                      to be remembered and would spring back; every other gesture
 *                                      (open a sheet, open a line) still means what it always did.
 *                                      Refused at the press, so the click a press becomes still
 *                                      opens the sheet.
 * @param {Function} handlers.canRemove `() => boolean` — whether Delete on a focused portrait may
 *                                      take that person off the map. Its own question and not part
 *                                      of `canEdit`: on a board that seats itself, Delete would be
 *                                      the ONE writing gesture the keyboard still offered, and the
 *                                      destructive one — a reader tabbing round a six-face view and
 *                                      pressing it would rub that person and every line touching
 *                                      them (including the ones the view is not drawing) off the
 *                                      shared map. Defaults to `canEdit`, which is what a board the
 *                                      reader can rearrange means.
 * @returns {Function} teardown.
 */
export function wireRelmapDrag(root, {
	surface, nodeAt, onMove, onNudge, onDragMove, onDragEnd, onLink, onLinkFrom, onOpen, onPickEdge,
	onPickNone, onRemove,
	canEdit = () => true,
	canMove = canEdit,
	canRemove = canEdit,
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
			clearTravel(finished.el);
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
			writeTravel(drag.el, x, y);
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
		// A board that places its own portraits is not one they can be dragged about on. Returning
		// here and not consuming the event is what keeps the press working as a CLICK: the sheet
		// still opens, and the only thing missing is the drag that had nowhere to go.
		if (!handle && !canMove()) return;

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
		// Asked BEFORE the teardown, because the teardown needs the answer: the right to edit can
		// be taken away while a drag is in the air, and a drop that is going to be refused has to
		// put the lines back rather than leave them where the pointer stopped.
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
		// THE WORDS FIRST AND THE STROKE SECOND, though either one takes hold of the same line: a
		// caption sits IN its stroke, so the two overlap, and a reader aiming at the writing has
		// aimed at the writing. (In practice the caption layer is drawn over the line layer and
		// wins the hit test anyway; the order here says so out loud rather than relying on it.)
		const words = ev.target.closest?.("[data-relmap-edge]");
		if (words) { ev.preventDefault(); if (canEdit()) onPickEdge?.(words.dataset.relmapEdge); return; }
		// THE STROKE ITSELF, which is a line with no caption's only target at all -- and the whole
		// of "click a line and start typing" for one, since there is nothing written on it to aim
		// at. What is actually clicked is the invisible wide stroke laid over the painted one; see
		// the board partial for why the painted stroke cannot take the click itself.
		const stroke = ev.target.closest?.("[data-relmap-hit]");
		if (stroke) { ev.preventDefault(); if (canEdit()) onPickEdge?.(stroke.dataset.relmapHit); return; }
		const face = ev.target.closest?.("[data-relmap-open]");
		if (face) { ev.preventDefault(); onOpen?.(face.dataset.relmapOpen); return; }
		// NOTHING ON THE BOARD. Not `preventDefault`: a press on bare paper is the pan surface's,
		// and this is only the window being told that whatever was being held has been let go.
		//
		// ⚠ ASKED AFFIRMATIVELY: did this land ON THE BOARD. These listeners are on the VIEWPORT,
		// which holds the board PLUS chrome -- the tie bar floats in it, and its own swatches arrive
		// here. Written as a list of chrome to skip, the next thing put in the viewport reads as
		// "clicked bare paper" and closes the bar under the press operating it, which is the fault
		// this guard exists for, rediscovered once per widget.
		if (board.contains?.(ev.target)) onPickNone?.();
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
		// A CAPTION IS NOT A REAL BUTTON ANY MORE, so Enter and Space have to be handed to it. It
		// is an SVG `<text>` wearing `role="button"` and a `tabindex` — every caption on the board
		// shares one SVG root, for reasons the board partial gives, and a hundred HTML buttons over
		// the top of it were exactly what that merge got rid of. Everything else about it (the
		// click, the tooltip, the accessible name) already worked without one.
		if (ev.key === "Enter" || ev.key === " ") {
			const words = ev.target.closest?.("[data-relmap-edge]");
			if (words) {
				ev.preventDefault();
				ev.stopPropagation();
				// The SAME thing the click does, and the element it came from goes with it: a
				// reader who pressed Enter on a caption and then thought better of the bar has to
				// be put back on that caption rather than at the top of the window.
				if (canEdit()) onPickEdge?.(words.dataset.relmapEdge, ev.target);
				return;
			}
		}
		const face = ev.target.closest?.("[data-relmap-open]");
		// ⚠ THE BOARD CLAIMS THESE KEYS, NOT THE PORTRAIT. Anchoring on the face alone was a real
		// hole: a portrait carries TWO tab stops — the face and, right beside it, the link handle,
		// which is a SIBLING so `closest("[data-relmap-open]")` walks straight past it — and every
		// caption is a third, an SVG `<text role="button" tabindex="0">` whose own branch above
		// claims Enter and Space and nothing else. A reader tabbing this board therefore alternates
		// between a stop that swallows Delete and one that does not, which is the worst possible
		// shape for a key with the consequence below.
		const mine = face ?? ev.target.closest?.("[data-relmap-edge], [data-relmap-handle]");
		if (!mine) return;
		const step = ev.shiftKey ? NUDGE_FINE : NUDGE_STEP;
		const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
		if (ev.key !== "Delete" && !move) return;

		// ⚠ SWALLOWED FIRST, PERMISSION ASKED SECOND, and the order is the whole of it. Every
		// `return` before this pair hands the key on to core's KeyboardManager, which binds keydown
		// in the BUBBLE phase and never looks at `defaultPrevented` — so a refusal here is not "the
		// board ignores that key", it is "the scene behind this window gets it". Delete is bound to
		// deleting the selected placeables, with no confirmation: a GM with three tokens selected,
		// focused anywhere on a board they may not rearrange, pressing Delete to mean "take this
		// off" would lose three tokens off the scene. The arrows pan the canvas.
		//
		// (Core's `KeyboardManager#hasFocus` does not save us here: it counts a BUTTON only when it
		// is inside a form, and this window is an AppV1 dialog with no form in its template, so the
		// face and the handle both read as unfocused. An SVG `<text>` is not an HTMLElement at all.)
		//
		// The caption branch above already had this right. This one did not, and grew two more ways
		// to be wrong the day `canMove` and `canRemove` arrived: the guards were written where the
		// action is decided rather than where the event is claimed.
		ev.preventDefault();
		ev.stopPropagation();
		// Claimed on behalf of the board, but a caption and a handle have nothing to do with a
		// portrait's Delete or its nudge. They stop the key and do nothing with it.
		if (!face) return;
		if (!canEdit()) return;
		const id = face.dataset.relmapOpen;

		// Taking somebody off the map answers to its OWN question, not to `canEdit`. See
		// `canRemove`: on a board that places its own portraits this would otherwise be the one
		// writing gesture the keyboard still offered, and the destructive one.
		if (ev.key === "Delete") {
			if (canRemove()) onRemove?.(id);
			return;
		}

		// The arrow keys are the keyboard's drag, so they answer to the same question a drag does.
		if (!canMove()) return;
		const spot = nodeAt?.(id);
		if (!spot) return;
		(onNudge ?? onMove)?.(id, { x: spot.x + move[0], y: spot.y + move[1] });
	});

	return () => { end(); };
}
