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
 * How far an arrow key slides a focused CAPTION along its own line, as a share of that line.
 *
 * ⚠ A SHARE AND NOT A DISTANCE, which is the one difference from the portrait's step above: a
 * caption cannot leave its line, so what it moves along is the line's own length -- two percent of
 * a long stroke is a bigger step in pixels than two percent of a short one, and that is right.
 * The same key covers a line of any length in the same fifty presses.
 *
 * Kept HERE, beside the portrait's, so "how far is one key on this board" has one home; WHICH WAY
 * the key points is the window's, because only the geometry knows which way the line runs.
 */
export const SEAT_STEP = 0.02;
export const SEAT_FINE = 0.005;

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
 * @param {Function} handlers.seatAt    `id => number|null` — where along its line that link's
 *                                      caption is sitting NOW, as a share of the curve. Asked at
 *                                      the press so an abandoned slide has somewhere to go back to.
 * @param {Function} handlers.onSeatMove `(id, {left, top}) => void` — the pointer is HERE, in board
 *                                      percentages, once per painted frame, while a caption is
 *                                      being dragged along its line. It is the window that turns a
 *                                      point near a line into a place on it: this layer knows
 *                                      nothing about curves, and a second opinion about where a
 *                                      caption sits is exactly how the words and the hole cut for
 *                                      them come to disagree.
 * @param {Function} handlers.onSeat    `(id, {left, top}) => void` — and that is where it was let
 *                                      go. Committed on release.
 * @param {Function} handlers.onSeatEnd `(id, restore) => void` — that slide is over. `restore` is
 *                                      the seat to put the caption back to when the drag was
 *                                      abandoned, and null when the drop is being written.
 * @param {Function} handlers.onSeatNudge `(id, {dx, dy, step}) => void` — one arrow key on a
 *                                      focused caption. `dx`/`dy` are the direction the KEY points
 *                                      on screen, for the window to lay against the line's own
 *                                      direction: a caption on a near-vertical line answers to Up
 *                                      and Down, one on a horizontal to Left and Right, and the
 *                                      reader never has to work out which.
 * @param {Function} handlers.onLink    `(fromId, toId) => void` — a line dragged between two.
 * @param {Function} handlers.onLinkFrom `id => void` — the handle CLICKED rather than dragged.
 * @param {Function} handlers.onOpen    `id => void` — a portrait clicked without dragging.
 * @param {Function} handlers.onPickEdge `id => void` — a line taken hold of, by a click on the
 *                                      stroke itself or on the words set in it. NOT "opened": what
 *                                      this raises is the bar over the line (utils/relmap-tie-bar.js),
 *                                      and the dialog behind it is one button further on.
 * @param {Function} handlers.onPickNone `() => void` — a click that landed on the board and on
 *                                      nothing on it, which is how a reader lets a line go.
 * @param {Function} handlers.onRemove  `id => void` — take this person off the map. Reached two
 *                                      ways: Delete on a focused portrait, and the trash can a
 *                                      right press puts on one (see `onArm`).
 * @param {Function} handlers.onArm     `(id|null) => void` — show the trash can on one portrait,
 *                                      or on nobody. NOT a removal and never confirmed: it is the
 *                                      board saying which person the next press could take off.
 *                                      The window owns the mark rather than this layer, because
 *                                      the board's markup is the window's and a repaint replaces
 *                                      every portrait on it.
 * @param {Function} handlers.canEdit   `() => boolean` — re-asked per gesture, because a map's
 *                                      ownership can change while a board is open.
 * @param {Function} handlers.canMove   `() => boolean` — whether a PORTRAIT may be picked up,
 *                                      asked separately from `canEdit` and defaulting to it, so a
 *                                      board that draws its own seats could still refuse the drag
 *                                      while every other gesture (open a sheet, open a line) went
 *                                      on meaning what it always did. Refused at the press, so the
 *                                      click a press becomes still opens the sheet.
 * @param {Function} handlers.canRemove `() => boolean` — whether Delete on a focused portrait may
 *                                      take that person off the map. Its own question and not part
 *                                      of `canEdit`, for the same reason: Delete is the one writing
 *                                      gesture the keyboard offers and the destructive one, so a
 *                                      board that refuses drags must be able to refuse it too
 *                                      rather than inherit a yes. Defaults to `canEdit`, which is
 *                                      what a board the reader can rearrange means.
 * @returns {Function} teardown.
 */
export function wireRelmapDrag(root, {
	surface, nodeAt, onMove, onNudge, onDragMove, onDragEnd, onLink, onLinkFrom, onOpen, onPickEdge,
	onPickNone, onRemove, onArm,
	seatAt, onSeatMove, onSeat, onSeatEnd, onSeatNudge,
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
	// WHERE THE PRESS BEHIND THE CLICK LANDED, remembered because by the time the click arrives the
	// answer is gone: a press on bare paper is a pan, the pan surface captures the pointer, and the
	// capture RETARGETS the derived click at the viewport. See the click handler.
	let paperPress = null;
	// WHERE A RIGHT PRESS ON A PORTRAIT LANDED, and on whom, remembered for the release to judge.
	// See the pointerdown handler for why the gesture is built out of these two rather than out of
	// the `contextmenu` it so obviously wants to be.
	let rightPress = null;

	/**
	 * Whether an element is somewhere a click means "let go of whatever was being held".
	 *
	 * ⚠ ASKED AFFIRMATIVELY, and it has to stay that way. These listeners are on the VIEWPORT,
	 * which holds the board PLUS chrome -- the tie bar floats in it, and its own swatches arrive
	 * here. Written as a list of chrome to skip, the next thing put in the viewport reads as
	 * "clicked bare paper" and closes the bar under the press operating it, which is the fault this
	 * guard exists for, rediscovered once per widget. Chrome is always a real element mounted IN the
	 * viewport, so the viewport itself is the mat around a board that does not fill it: bare paper
	 * of a second kind, and not a way in for anything mounted there.
	 */
	const isPaper = el => el === view || !!board.contains?.(el);

	/** The rubber band a half-drawn line is shown as. Made once, reused, never re-rendered. */
	const rubber = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	rubber.setAttribute("class", "stonetop-relmap-rubber");
	rubber.setAttribute("viewBox", "0 0 100 100");
	rubber.setAttribute("preserveAspectRatio", "none");
	rubber.setAttribute("aria-hidden", "true");
	const rubberLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
	rubberLine.setAttribute("vector-effect", "non-scaling-stroke");
	rubber.appendChild(rubberLine);

	/** The portrait a half-drawn line is currently over, kept marked while it is. */
	let linkTarget = null;

	/**
	 * Who a line released at this point would join, or null.
	 *
	 * ONE RESOLVER FOR THE HIGHLIGHT AND FOR THE DROP, and that is the whole reason it is a
	 * function: a mark that lit a portrait the release then did not link to would be worse than no
	 * mark at all, since the reader would have been told the wrong answer rather than left to
	 * guess. Written once, both are the same answer by construction.
	 *
	 * elementsFromPoint and not elementFromPoint: the rubber band and the handle both ride under
	 * the cursor, and the topmost hit is not the portrait being aimed at. `exclude` is the person
	 * the line came FROM, who is not somebody it can be dropped on.
	 */
	function nodeUnder(clientX, clientY, exclude) {
		return (document.elementsFromPoint?.(clientX, clientY) ?? [])
			.map(el => el.closest?.("[data-relmap-node]"))
			.find(el => el && el.dataset.relmapNode !== exclude) ?? null;
	}

	/**
	 * Light the person the line would land on, and put out whoever was lit before.
	 *
	 * The early return is not a micro-optimisation: this is asked once per painted frame for the
	 * length of the drag, and a class removed and re-added every frame on the element under the
	 * cursor is a style invalidation per frame for no visible change at all.
	 *
	 * The rubber band is marked in the same breath, so the half-drawn line says the same thing its
	 * target does. Two marks for one fact, which is the rule the lit-web styling is already written
	 * to: there is a reader at this table on a magnifier, who may have only one of the two on
	 * screen at once.
	 */
	function markLinkTarget(el) {
		if (el === linkTarget) return;
		linkTarget?.classList?.remove("is-link-target");
		linkTarget = el ?? null;
		linkTarget?.classList?.add("is-link-target");
		if (linkTarget) rubber.classList?.add("is-over");
		else rubber.classList?.remove("is-over");
	}

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
		// Before the band is taken off the board, and on EVERY exit rather than on the release:
		// Escape, a lost pointer and a teardown mid-drag all leave a portrait ringed for a line
		// nobody is drawing any more, and the ring would then sit there until the next repaint.
		markLinkTarget(null);
		rubber.remove();
		board.classList.remove("is-dragging");
		// After the class is off, so anything the window does in response reads a board that is no
		// longer busy. Only for a drag that actually started: an armed press redrew nothing.
		if (finished.started && finished.kind === "node") {
			onDragEnd?.(finished.id, committed ? null : { x: finished.from.left, y: finished.from.top });
		}
		// THE SAME BARGAIN FOR A CAPTION, and it needs one for the same reason: the words have been
		// redrawn where the pointer left them, frame by frame, and an abandoned slide has nothing
		// else coming to put them back. `seat` is the share of the line it was picked up at, which
		// is null on a line whose caption the window could not find -- and null is also what says
		// "nothing to restore", so a slide that never really began asks for nothing.
		if (finished.started && finished.kind === "seat") {
			onSeatEnd?.(finished.id, committed ? null : finished.seat);
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
		} else if (drag.kind === "seat") {
			// THE POINTER'S OWN PLACE ON THE BOARD, and nothing worked out from the travel: a
			// caption is not carried a distance, it is put at a place ON ITS LINE, and the window
			// finds the nearest point of that line to this one. So the scale is already in it (the
			// surface converts against the board as painted) and there is no `dragTranslation` here.
			const at = surface.pointToPercent({ clientX: drag.clientX, clientY: drag.clientY });
			if (at) onSeatMove?.(drag.id, at);
		} else if (drag.kind === "link") {
			// ⚠ BOTH READS BEFORE EITHER WRITE. Layout is clean at the top of a rAF callback and
			// dirty the moment anything is written to the document, so a hit test taken after the band
			// had been re-pathed forced a full layout of the board on every frame of a link drag.
			// Neither of these two depends on the other, so the order costs nothing to keep.
			const at = surface.pointToPercent({ clientX: drag.clientX, clientY: drag.clientY });
			// AND WHO IT WOULD LAND ON. Without this the band is drawn into empty space and the
			// reader learns whether they hit anybody only by letting go: a portrait is 72px on a
			// board that can be zoomed out to fit forty of them, and the name under it counts as
			// a target too, so "am I on them" is a real question. Same frame as the band, so the
			// ring and the line it belongs to are never a frame out of step.
			const over = nodeUnder(drag.clientX, drag.clientY, drag.id);
			if (at) rubberLine.setAttribute("d", `M ${drag.from.left},${drag.from.top} L ${at.left},${at.top}`);
			markLinkTarget(over);
		}
	}

	function schedule() {
		if (!frameId) frameId = requestAnimationFrame(frame);
	}

	view.addEventListener("pointerdown", ev => {
		// ⚠ A SWALLOW STILL STANDING HERE IS ONE THE CLICK NEVER CAME FOR, and this is the only
		// place that can notice. `swallowClick` is armed by a release that ended a drag and spent
		// by the click the browser derives from it a moment later -- so at the next press it is
		// false in every ordinary case, and true only where that click never reached the handler
		// below. It has one way to happen: utils/zoom-pan-surface.js swallows the click derived
		// from a press that CAUGHT A SLIDING BOARD, in the capture phase, on this same element and
		// ahead of us. Drag a portrait with the press that stopped a glide and both modules mean to
		// eat that one click; only theirs runs, and the flag left behind would eat the reader's
		// NEXT click -- on a stroke, a caption, bare paper -- and the board would go quiet.
		//
		// AND THE TRASH CAN GOES WITH IT, for the same reason and one gesture late: the click that
		// was taken away is also the click that would have put an armed can away (see `onArm(null)`
		// in the click handler), and a press is the first moment we learn it never arrived.
		if (swallowClick) { swallowClick = false; onArm?.(null); }
		// BEFORE EVERY GUARD BELOW, because this is not about dragging at all: it is the note the
		// click handler reads to tell a let-go from a pan, and it has to be taken on the presses
		// that arm no drag -- which is every press on bare paper, the only kind that matters to it.
		paperPress = ev.button === 0 && isPaper(ev.target)
			? { x: ev.clientX, y: ev.clientY }
			: null;
		// AND THE OTHER BUTTON'S NOTE, taken here for the same reason: by the time the release
		// arrives there is no telling where the press began, and this gesture is entirely about
		// whether it stayed put.
		//
		// ⚠ IT IS NOT A `contextmenu` LISTENER, which is the obvious way to write "right-click a
		// portrait" and is unavailable twice over. Foundry preventDefaults contextmenu on the whole
		// document (`Game#activateListeners`), so there is no menu being replaced and no event any
		// part of this app is built to rely on; and by the time one would fire, the pan surface has
		// taken a pointer capture on the viewport, which retargets what the browser derives from
		// that pointer -- so the very portrait the gesture is about would not be its target. The
		// pointerdown and the pointerup are already ours, already arrive, and between them say
		// everything the gesture needs.
		//
		// THE RIGHT BUTTON ALSO PANS THE BOARD, from anywhere, deliberately (utils/zoom-pan-surface.js:
		// a press aimed at open paper lands on one of a hundred lines, so the right button asks
		// nothing about what is under it). That is not a conflict to resolve, it is the thing the
		// release measures: a right DRAG is a pan, and only a right press that went nowhere is the
		// reader pointing at somebody.
		//
		// ⚠ AND NOT WHEN THE PRESS WAS MADE TO STOP A SLIDING BOARD. A right press catches a glide
		// just as a left one does (utils/zoom-pan-surface.js), and a press that meant "stop" stayed
		// put by definition -- so without this it reads as the reader pointing at whichever portrait
		// happened to be gliding under the cursor at that instant, and a delete button appears on
		// somebody they never aimed at. The surface's own click swallow rules the mirror image of
		// this out for the left button; `caughtGlide` is that same answer, kept for every button.
		// Its pointerdown listener is attached before ours on this element, so it is already
		// written by the time we are asked.
		const rightNode = ev.button === 2 && !surface?.caughtGlide
			? ev.target.closest?.("[data-relmap-node]") : null;
		rightPress = rightNode
			? { id: rightNode.dataset.relmapNode, x: ev.clientX, y: ev.clientY }
			: null;
		if (ev.button !== 0 || drag || !canEdit()) return;
		// AND NOT WHILE THE BOARD ITSELF IS BEING DRAGGED. A left press made with the RIGHT button
		// already down is a press made mid-pan (utils/zoom-pan-surface.js: the right button drags
		// the board from anywhere, precisely so a line in the way cannot stop it). Arming a node
		// drag under that would move a portrait and the board it stands on at once, and the pan's
		// pointer capture ends this drag on release wherever it happens to have reached -- a real
		// edit to somebody else's map from a press that was only meant to steady the hand. The
		// surface refuses the mirror image of this for the same reason. A host reporting no
		// `buttons` compares false and drags, as the tests' fake events do.
		if (ev.buttons > 1) return;
		// ⚠ THE TRASH CAN IS NOT A PLACE TO PICK A PORTRAIT UP BY, and it sits INSIDE the node, so
		// without this the press that means "take them off" arms a drag of the person it is about:
		// a hand that shifts three pixels between press and release then moves them across the
		// board instead, and `swallowClick` eats the click the button was waiting for. Returning
		// rather than consuming leaves the click intact, which is the whole of what this button is.
		if (ev.target.closest?.("[data-relmap-remove]")) return;
		// ⚠ THE WORDS ON A LINE, WHICH ARE DRAGGED ALONG IT and are checked BEFORE the portraits
		// below for the reason the click handler checks them first: a caption sits IN its stroke,
		// so a press on the writing has aimed at the writing. It is not inside a node, so nothing
		// below would have armed on it anyway -- but a caption that ends up drawn over a portrait
		// (the spreader keeps them clear of faces; a hand-seated one may be asked to sit anywhere)
		// would otherwise pick that person up by their own name for the tie between them.
		//
		// A SLIDE IS NOT A PORTRAIT DRAG, so it answers to `canEdit` and not to `canMove`: a board
		// whose seats are drawn for it (the party, the village) is still a board whose captions the
		// table writes and arranges. `canEdit` was asked at the top of this handler.
		//
		// AND A PRESS THAT NEVER TRAVELS IS STILL A CLICK. Nothing is consumed here, so the caption
		// goes on opening the tie bar exactly as it did -- which is what a reader does to it far
		// more often than they move it.
		const words = ev.target.closest?.("[data-relmap-words]");
		if (words) {
			const id = words.dataset.relmapWords;
			// Where it is sitting now, taken at the press: an abandoned slide has to be able to put
			// the words back, and by the time it is abandoned the board has been redrawn many times.
			// A caption the window cannot place answers null, and arms nothing.
			// ⚠ A NUMBER, ASKED FOR AS ONE. `Number(null)` is zero and zero is a perfectly good seat,
			// so the obvious `>= 0` test arms a slide on a caption the window has just said it cannot
			// place -- and then hands that null back as the spot to restore an abandoned one to.
			const seat = seatAt?.(id);
			if (typeof seat !== "number" || !Number.isFinite(seat)) return;
			drag = {
				kind: "seat",
				id,
				// The GROUP and not the words, so a stylesheet marking a caption mid-slide has the
				// whole caption to mark. `end` takes the class off again on every exit.
				el: words.closest?.("[data-relmap-edge]") ?? words,
				seat,
				pointerId: ev.pointerId,
				startX: ev.clientX, startY: ev.clientY,
				clientX: ev.clientX, clientY: ev.clientY,
				// The travel, kept because the threshold is measured from it like every other
				// gesture's. There is no `from` beside it: a caption is not carried a DISTANCE from
				// anywhere, it is put at a place on its line, and the seat above is that place.
				dx: 0, dy: 0,
				started: false,
			};
			swallowClick = false;
			return;
		}
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
			// The rubber band belongs to ONE of the three gestures. A caption being slid is marked
			// the way a portrait being carried is -- on the element itself, for the stylesheet --
			// and a band drawn from nowhere to the cursor would be this board's one gesture that
			// looked like a different one.
			if (drag.kind === "link") board.appendChild(rubber);
			else drag.el?.classList.add("is-dragging");
		}
		// Only once the drag is real, or this would suppress ordinary presses on the board.
		ev.preventDefault();
		schedule();
	});

	view.addEventListener("pointerup", ev => {
		// THE RIGHT BUTTON LET GO, which arms no drag and so never reaches anything below. A press
		// that stayed on the portrait it started on puts that person's trash can on the board; one
		// that travelled was a pan of the board and means nothing about anybody.
		//
		// The threshold is the one a portrait drag lifts at, so "did this move" has a single answer
		// everywhere on this board. `canRemove` and not `canEdit`: the can is the only thing this
		// gesture can lead to, and a board that refuses the removal must not offer the button.
		if (ev.button === 2) {
			const press = rightPress;
			rightPress = null;
			const stayedPut = press && !isLiftedDrag(ev.clientX - press.x, ev.clientY - press.y);
			if (stayedPut && canRemove()) onArm?.(press.id);
			return;
		}
		// ANY OTHER BUTTON IS NOT THIS DRAG. A mouse reports ONE `pointerId` for every button on it,
		// so a middle or thumb click pressed mid-gesture releases with the live drag's own id and
		// would be taken for the end of it. `pointerdown` already refused to arm on those buttons;
		// honouring their release would drop the portrait wherever the cursor happened to be and
		// leave `swallowClick` armed to eat the reader's next real click. A drag ends when the
		// button that began it is let go, and touch and pen release as button 0 as well.
		if (ev.button !== 0) return;
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

		if (finished.kind === "seat") {
			// FROM THE RELEASE POSITION, like the link drop above it and for the same reason: the
			// moves are coalesced to one frame each, so the last of them before the release may
			// never have been processed and the caption would be written a frame behind the hand.
			const at = surface.pointToPercent({ clientX: dropX, clientY: dropY });
			if (at) onSeat?.(finished.id, at);
			return;
		}

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

		// THE SAME RESOLVER THE HIGHLIGHT USED, so the line lands on exactly the person the ring
		// promised it to. Asked again from the RELEASE position rather than reusing the last
		// marked one: the moves are coalesced to one frame each, so the pointer may have travelled
		// since the last frame was painted.
		const target = nodeUnder(dropX, dropY, finished.id);
		if (target) onLink?.(finished.id, target.dataset.relmapNode);
	});

	view.addEventListener("pointercancel", ev => {
		// A right press the system took away is not a press that stayed put; it is a press that
		// never finished. Cleared unconditionally, because the note is about one pointer at a time
		// and a stale one would arm a trash can on the NEXT release anywhere on the board.
		rightPress = null;
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
		// THE TRASH CAN FIRST OF ALL, and it is the one press on this board that does NOT also mean
		// "put that can away" -- everything below this line does.
		const bin = ev.target.closest?.("[data-relmap-remove]");
		if (bin) { ev.preventDefault(); if (canRemove()) onRemove?.(bin.dataset.relmapRemove); return; }
		// ⚠ AND EVERY OTHER CLICK PUTS IT AWAY, which is the whole of how it closes. A control that
		// appears on one gesture has to disappear on the next thing the reader does, or a board
		// clicked around for an evening ends up wearing a delete button on half the people on it --
		// and this is the surface a table clicks around on while talking. The same bargain the tie
		// bar strikes with `onPickNone` below, made here because it must cover the clicks that bar
		// never sees: a face, a caption, a stroke, the handle.
		onArm?.(null);
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
		// `isPaper` says what counts as bare paper and why it is asked affirmatively.
		//
		// AND THE PRESS ANSWERS FOR THE CLICK, because by then the click no longer knows where it
		// landed. Every press on bare paper starts a pan, the pan surface takes the pointer capture
		// to keep the pan alive off the edge of the window, and the capture RETARGETS the derived
		// click at the VIEWPORT. So the one gesture that lets a line go arrived at the one element
		// `board.contains` refuses, and a tie bar opened by a click could not be dismissed by
		// clicking away from it AT ALL: the route was here, wired, tested, and no click in a real
		// browser ever reached it.
		//
		// A PAN IS NOT A LET-GO, which is what the travel is measured for. Dragging the board about
		// with a line's bar open is reading the map, not putting the line down -- the bar rides
		// along with the board it points at -- so only a press that stayed put lets go. The
		// threshold is the one a portrait drag lifts at, so "did this move" has one answer here.
		const stayedPut = paperPress
			? !isLiftedDrag(ev.clientX - paperPress.x, ev.clientY - paperPress.y)
			: false;
		paperPress = null;
		if (isPaper(ev.target) && (stayedPut || board.contains?.(ev.target))) onPickNone?.();
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
		// ⚠ `[data-relmap-remove]` IS IN THIS LIST FOR THE REASON THE PARAGRAPH ABOVE GIVES, and it
		// is the newest tab stop on the board: a trash can that is showing is focusable, sits
		// beside the handle, and carries no `data-relmap-open` of its own. Left out, a reader who
		// tabbed onto it and pressed Delete -- the one key that means on that button exactly what
		// the button means -- would hand the keystroke to the scene behind this window.
		const mine = face
			?? ev.target.closest?.("[data-relmap-edge], [data-relmap-handle], [data-relmap-remove]");
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
		// ⚠ THE TRASH CAN ACTS, rather than only swallowing. It is the one tab stop on this board
		// whose Delete means exactly what the button under it means -- which is the reason the
		// paragraph above put it in `mine` at all -- and it carries no `data-relmap-open`, so
		// `face` is null on it and the portrait branch below would stop the key and drop it. The id
		// comes off the can itself: it names the person it is about, which is how the click handler
		// reads it too.
		const bin = ev.target.closest?.("[data-relmap-remove]");
		if (bin) {
			if (ev.key === "Delete" && canRemove()) onRemove?.(bin.dataset.relmapRemove);
			return;
		}
		// ⚠ AND A CAPTION SLIDES ALONG ITS LINE, which is the arrow keys' answer to the drag that
		// moves it -- the same bargain every other gesture on this board keeps, and the reason it
		// has to be kept here is that dragging a few words along a stroke is the hardest gesture on
		// the board to make with a hand that shakes, and one of the two people at this table reading
		// it is on a screen magnifier.
		//
		// THE KEY POINTS ON SCREEN AND THE LINE RUNS WHERE IT RUNS, so the direction is sent as it
		// was pressed and the window lays it against the curve: whichever pair of arrows points
		// along this line moves the words, and the reader never has to know which pair that is.
		// Delete is not offered here -- there is nothing on a caption for it to mean, and the
		// paragraph above says what happens to a key this handler does not claim.
		const said = ev.target.closest?.("[data-relmap-words]");
		if (said) {
			if (move && canEdit()) {
				onSeatNudge?.(said.dataset.relmapWords, {
					dx: Math.sign(move[0]), dy: Math.sign(move[1]),
					step: ev.shiftKey ? SEAT_FINE : SEAT_STEP,
				});
			}
			return;
		}
		// Claimed on behalf of the board, but a caption's group and a handle have nothing to do with
		// a portrait's Delete or its nudge. They stop the key and do nothing with it.
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
