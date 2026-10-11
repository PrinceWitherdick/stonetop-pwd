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
import { holdTravel } from "./relmap-geometry.js";

/**
 * Everything on the board that is a gesture of its own, so that a press on it is not a press on
 * open paper. The selection box starts only from open paper: a Shift press on a portrait is a
 * portrait's gesture, and one on a line is a line's.
 */
const CLAIMED = "[data-relmap-node], [data-relmap-handle], [data-relmap-remove], [data-relmap-edge], "
	+ "[data-relmap-hit], [data-relmap-action], [data-relmap-group], [data-relmap-group-hit]";

/** A group's name or its outline's click target, and the group it belongs to. */
export function groupPressed(target) {
	const el = target?.closest?.("[data-relmap-group], [data-relmap-group-hit]");
	if (!el) return null;
	return { el, id: el.dataset?.relmapGroup ?? el.dataset?.relmapGroupHit ?? "" };
}

/** Whether a click or a key asked to ADD TO the selection rather than to do the ordinary thing. */
const addsToSelection = ev => !!(ev?.shiftKey || ev?.ctrlKey || ev?.metaKey);

/**
 * Whether a press starts a SELECTION BOX: a left press, with Shift held, on open paper.
 *
 * ⚠ EXPORTED FOR THE PAN SURFACE, WHICH HAS TO GIVE THE SAME ANSWER. utils/zoom-pan-surface.js takes
 * every left press on open paper for a pan, and it is wired before this file is. It is told to stand
 * aside (`yields`) on exactly the presses this function names; two spellings of the question would
 * leave a press both of them refused (nothing happens) or both of them took (the board slides while
 * the box is drawn).
 *
 * SHIFT AND NOT A PLAIN DRAG, although Foundry's own canvas draws its box on a plain left drag. On
 * this board a plain left drag on paper has always MOVED THE BOARD, and the table has its hands used
 * to that; a selection box is the rarer gesture, so it is the one that asks for a key.
 */
export function pressStartsBox(ev, opts) {
	return !!ev?.shiftKey && pressStartsDraw(ev, opts);
}

/**
 * Whether a press could start drawing a GROUP'S BOX: a plain left press on open paper. Asked only
 * while the group tool is armed (the window says when), and by the pan surface as well, for the
 * reason `pressStartsBox` gives: two spellings of one question would let a press both pan and draw.
 */
export function pressStartsDraw(ev, { view, board } = {}) {
	if (ev?.button !== 0) return false;
	const target = ev.target;
	if (!target || !(target === view || !!board?.contains?.(target))) return false;
	return !target.closest?.(CLAIMED);
}

/** The rectangle two corners make, in board percentages, whichever way round they were given. */
function boxOf(a, b) {
	return {
		left: Math.min(a.left, b.left), right: Math.max(a.left, b.left),
		top: Math.min(a.top, b.top), bottom: Math.max(a.top, b.top),
	};
}

/** `base` and `more` as one list, each id once, in the order they were chosen. */
function unionOf(base, more) {
	return [...new Set([...base, ...more])];
}

const sameList = (a, b) => !!a && !!b && a.length === b.length && a.every((id, i) => id === b[i]);

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
 * @param {Function} handlers.onOpen    `id => void` — a portrait DOUBLE-clicked, or activated from
 *                                      the keyboard. A single click on a face does not open a
 *                                      sheet: see the click and dblclick handlers for why.
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
 *
 * ── SEVERAL PEOPLE AT ONCE (user, 2026-09-27: "select multiple people at once to move them") ──
 *
 * THE SELECTION IS THE WINDOW'S, and this layer only asks for it and hands it back. It is marked on
 * the portraits, which a repaint replaces, so the window keeps the list and paints it again.
 *
 * @param {Function} handlers.selected  `() => string[]` — who is selected right now.
 * @param {Function} handlers.onSelect  `(ids, {final}) => void` — make exactly these the selection.
 *                                      `final` is false for the frames of a selection box still
 *                                      being drawn, so the window can say the count out loud once
 *                                      rather than on every frame.
 * @param {Function} handlers.nodesIn   `({left, top, right, bottom}) => string[]` — who is standing
 *                                      inside a box drawn in board percentages.
 * @param {Function} handlers.onGroupMove `(moves) => void` — several people let go of together,
 *                                      `moves` being `{id: {x, y}}`. ONE call, so the window can
 *                                      make it one write and one step of the undo.
 * @param {Function} handlers.onGroupDragMove `(moves) => void` — where they all are RIGHT NOW,
 *                                      once per painted frame. The group's `onDragMove`.
 * @param {Function} handlers.onGroupDragEnd `(restore) => void` — that gesture is over. `restore`
 *                                      is `{id: {x, y}}` to put the lines back to when it was
 *                                      abandoned, and null when the drop is being written.
 * @param {Function} handlers.onGroupNudge `(moves) => void` — one arrow key on a face that is one
 *                                      of several selected: everybody's new spot at once. The
 *                                      group's `onNudge`; without it, each is nudged on its own.
 *
 * ── NAMED GROUPS ("The hunters"), drawn round some people ──
 *
 * A GROUP IS MOVED BY CARRYING ITS PEOPLE. Dragging its name or its outline is the selection's own
 * group move (`onGroupMove` and the rest above), carrying whoever `groupMembers` names; this layer
 * never learns where an outline is, because the window redraws it from where its people are.
 *
 * @param {Function} handlers.groupMembers `id => string[]` — who is in a group.
 * @param {Function} handlers.onPickGroup `(id, from) => void` — a group's name or outline clicked,
 *                                      or Enter on its name. `from` is the element, for Escape to
 *                                      put the focus back on.
 * @param {Function} handlers.onRemoveGroup `id => void` — Delete on a group's name.
 * @param {Function} handlers.drawing   `() => boolean` — whether the group tool is armed, so that a
 *                                      plain press on open paper draws a box instead of panning.
 * @param {Function} handlers.onDrawn   `ids => void` — that box let go of, with who is inside it;
 *                                      or null for a draw abandoned (Escape, a lost pointer).
 *
 * ── DRAWING LINES (user, 2026-10-07: "more, easier ways to draw these lines... The little chain
 *    circle is kind of small and hard to click") ──
 *
 * The handle is no longer the only way to start a line. Alt held on a face drags a line out of it
 * instead of moving them, and while the "Draw lines" tool is armed EVERY face is a handle: a drag draws
 * a line, and a click picks somebody and the next click on somebody else joins the two (the AIM, a band
 * that follows the pointer with no button held).
 *
 * @param {Function} handlers.linkBand  `(fromId, at, toId) => string` — the `d` of the half-drawn
 *                                      line from a person to the pointer at `at` (board percentages),
 *                                      or to `toId` when it is over somebody. The window's, because
 *                                      the radius it trims to is the window's; without it the band
 *                                      runs from the centre.
 * @param {Function} handlers.linking   `() => boolean` — whether the "Draw lines" tool is armed.
 * @param {Function} handlers.onLinkPicked `(id|null) => void` — the tool's first click picked this
 *                                      person to draw from, or the pick was let go.
 * @param {Function} handlers.onStopLinking `() => void` — Escape on the board with the tool armed and
 *                                      nobody picked: stand the tool down.
 * @returns {Function} teardown, carrying `stopAiming()` for a window that stands the tool down itself.
 */
export function wireRelmapDrag(root, {
	surface, nodeAt, onMove, onNudge, onDragMove, onDragEnd, onLink, onLinkFrom, onOpen, onPickEdge,
	onPickNone, onRemove, onArm,
	seatAt, onSeatMove, onSeat, onSeatEnd, onSeatNudge,
	selected = () => [], onSelect, nodesIn, onGroupMove, onGroupDragMove, onGroupDragEnd, onGroupNudge,
	groupMembers, onPickGroup, onRemoveGroup, drawing = () => false, onDrawn,
	linkBand, linking = () => false, onLinkPicked, onStopLinking,
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
	// AND THE SAME NOTE CARRIED TWO CLICKS FURTHER ON, for the DOUBLE click.
	//
	// A `dblclick` is made of the two clicks before it, and the tail of a drag is a real click as
	// far as the browser is concerned — so dragging a portrait and then clicking it ONCE fires a
	// double click, and would open a sheet on a gesture the reader made as a single click, right
	// after moving that very face. `swallowClick` cannot answer for it: it is spent by the click it
	// was set for, which runs before the dblclick that click goes on to form.
	//
	// So the last two clicks are remembered, oldest first, and a double click made from either of
	// them is dropped. A COUNT OF TWO and not a flag that simply stands until used: a swallowed
	// click that never pairs with anything (the reader waited, or clicked elsewhere) must not sit
	// there to eat a genuine double click made minutes later.
	let lastClicks = [false, false];
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

	/**
	 * The selection box, drawn the way the rubber band is and for the same reasons: in the board's
	 * own 0-100 space, so it stays on the paper it was started on through a zoom, with a stroke that
	 * stays the same width on screen whatever the scale.
	 */
	const marquee = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	marquee.setAttribute("class", "stonetop-relmap-marquee");
	marquee.setAttribute("viewBox", "0 0 100 100");
	marquee.setAttribute("preserveAspectRatio", "none");
	marquee.setAttribute("aria-hidden", "true");
	const marqueeBox = document.createElementNS("http://www.w3.org/2000/svg", "path");
	marqueeBox.setAttribute("vector-effect", "non-scaling-stroke");
	marquee.appendChild(marqueeBox);

	/**
	 * One portrait's element, by id. Walked and read off `dataset`, never found with a selector built
	 * out of a stored id: an id goes into a selector as TEXT, and the first one carrying a colon or a
	 * quote is a syntax error. The window's own sweeps make the same choice.
	 */
	function nodeEl(id) {
		for (const el of board.querySelectorAll?.("[data-relmap-node]") ?? []) {
			if (el.dataset?.relmapNode === id) return el;
		}
		return null;
	}

	/**
	 * Everybody a press on `id` picks up: the whole selection when they are part of it, and
	 * otherwise nobody but them (null).
	 *
	 * A PORTRAIT OUTSIDE THE SELECTION MOVES ON ITS OWN, and the selection is left as it was. The
	 * reader who picked four people and then straightens up somebody else's seat has not changed
	 * their mind about the four.
	 */
	function groupFor(id, spot, el) {
		const chosen = selected?.() ?? [];
		if (chosen.length < 2 || !chosen.includes(id)) return null;
		const group = [];
		for (const other of chosen) {
			const at = other === id ? spot : nodeAt?.(other);
			const own = other === id ? el : nodeEl(other);
			if (at && own) group.push({ id: other, el: own, from: { left: at.x, top: at.y } });
		}
		return group.length > 1 ? group : null;
	}

	/** Where everybody in a group lands for one travel, as the `{id: {x, y}}` the window takes. */
	function movesOf(group, moved) {
		const moves = {};
		for (const member of group) {
			moves[member.id] = { x: member.from.left + moved.left, y: member.from.top + moved.top };
		}
		return moves;
	}

	/** Where everybody in a group started, the same way, for an abandoned drag to go back to. */
	function restoreOf(group) {
		return movesOf(group, { left: 0, top: 0 });
	}

	/**
	 * Whether a drag CARRIES PEOPLE: a portrait (`node`, with everybody selected beside it in `group`
	 * when it is one of several) or a group's name (`group`, which is its members and nobody else).
	 * The two share every frame and the drop; only a lone portrait reads `id`, `el` and `from`, and
	 * only where `group` is not set.
	 */
	function carries(d) {
		return d?.kind === "node" || d?.kind === "group";
	}

	/**
	 * The travel `travelled` measures, held so that nobody being carried goes past reach
	 * (`holdTravel`). Held HERE, where both the frame and the drop ask, so what the reader watches
	 * is what gets written: a portrait that followed the pointer past the rail and was then put back
	 * on release is the very snap-back the rail was widened to get rid of.
	 */
	function heldTravel(d, clientX, clientY) {
		const moved = travelled(d, clientX, clientY);
		if (!moved) return null;
		return holdTravel(moved, (d.group ?? [d]).map(member => member.from));
	}

	/** Who is inside the box from where it was started to this point, added to who was chosen before. */
	function boxed(d, clientX, clientY) {
		const at = surface.pointToPercent?.({ clientX, clientY });
		if (!at) return null;
		const rect = boxOf(d.start, at);
		return { rect, ids: unionOf(d.base, nodesIn?.(rect) ?? []) };
	}

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
		for (const el of document.elementsFromPoint?.(clientX, clientY) ?? []) {
			// ⚠ THE FIRST THING NOT ON THIS BOARD ENDS THE SEARCH. The stack runs all the way down, so a
			// portrait underneath another window laid over the map is still in it: taken from there, a
			// line let go of over that window was drawn to somebody the reader could not see, and the
			// ring promising it had lit them straight through the window as well.
			if (view.contains?.(el) === false) return null;
			const node = el.closest?.("[data-relmap-node]");
			if (node && node.dataset.relmapNode !== exclude) return node;
		}
		return null;
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
	 * The half-drawn line from `id` (standing at `from`) to the pointer at `at`, or to `over` once it
	 * is over somebody. The window trims it to the rims (`linkBand`), so it leaves the face where the
	 * line it becomes will leave it, rather than lying over the face from its centre.
	 */
	function bandFor(id, from, at, over) {
		if (linkBand) return linkBand(id, at, over?.dataset?.relmapNode ?? null) ?? "";
		return `M ${from.left},${from.top} L ${at.left},${at.top}`;
	}

	/**
	 * THE "DRAW LINES" TOOL'S FIRST CLICK: who a line is being drawn FROM, with no button held, and
	 * where the pointer last was (null from the keyboard, which draws no band). The band follows the
	 * pointer, and the next click on somebody else draws the line.
	 */
	let aim = null;

	/** Pick `id` to draw from. */
	function startAim(id, clientX = null, clientY = null) {
		endAim();
		aim = { id, clientX, clientY };
		// Escape lets the pick go, through the page's one Escape watcher, so the key never reaches
		// core's dismiss and closes the window instead. See relationship-board.js. Only an Escape
		// aimed at this board's window, or at nothing in particular: no button is down, and the GM
		// may have gone off to another window, whose own Escape must still work there.
		beginCancellableDrag(cancelAim, { owns: aimOwnsEscape });
		nodeEl(id)?.classList.add("is-link-source");
		onLinkPicked?.(id);
		if (clientX !== null) schedule();
	}

	/** Let the pick go, on every way out: a line drawn, Escape, a click on paper, the tool put down. */
	function endAim() {
		if (!aim) return;
		aim = null;
		endCancellableDrag(cancelAim);
		for (const el of board.querySelectorAll?.(".is-link-source") ?? []) el.classList.remove("is-link-source");
		markLinkTarget(null);
		rubber.remove();
		onLinkPicked?.(null);
	}

	const cancelAim = () => endAim();

	/** Whether an Escape is the pick's: pressed with the focus in the board's window, or nowhere. */
	function aimOwnsEscape(ev) {
		const target = ev?.target;
		if (!target || target === globalThis.document?.body || target === globalThis.document?.documentElement) return true;
		const frame = view?.closest?.(".app, .application") ?? view;
		return frame?.contains?.(target) ?? true;
	}

	/**
	 * One frame of the aim. ⚠ A REPAINT REPLACES THE BOARD'S CONTENTS (never the board itself), and it
	 * is not held back for an aim the way it is for a drag, since no button is down. So the band is put
	 * back on the board and the mark back on whoever the source is NOW, every frame.
	 */
	function paintAim() {
		if (!linking?.() || !canEdit()) { endAim(); return; }
		const source = nodeEl(aim.id);
		const spot = nodeAt?.(aim.id);
		if (!source || !spot) { endAim(); return; }
		if (!source.classList.contains("is-link-source")) source.classList.add("is-link-source");
		if (aim.clientX === null) return;
		const at = surface.pointToPercent({ clientX: aim.clientX, clientY: aim.clientY });
		const over = nodeUnder(aim.clientX, aim.clientY, aim.id);
		if (!board.contains?.(rubber)) board.appendChild(rubber);
		if (at) rubberLine.setAttribute("d", bandFor(aim.id, { left: spot.x, top: spot.y }, at, over));
		markLinkTarget(over);
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
		endCancellableDrag(cancelDrag);
		if (frameId) { cancelAnimationFrame(frameId); frameId = 0; }
		if (!finished) return null;
		try { view.releasePointerCapture?.(finished.pointerId); } catch { /* already gone */ }
		// EVERY PORTRAIT BEING CARRIED, which is one unless a selection is: each wears the travel and
		// the mark, and each has to be put down.
		for (const el of finished.group?.map(member => member.el) ?? (finished.el ? [finished.el] : [])) {
			clearTravel(el);
			el.classList.remove("is-dragging");
		}
		// Before the band is taken off the board, and on EVERY exit rather than on the release:
		// Escape, a lost pointer and a teardown mid-drag all leave a portrait ringed for a line
		// nobody is drawing any more, and the ring would then sit there until the next repaint.
		markLinkTarget(null);
		rubber.remove();
		marquee.remove();
		board.classList.remove("is-dragging");
		board.classList.remove("is-boxing");
		// After the class is off, so anything the window does in response reads a board that is no
		// longer busy. Only for a drag that actually started: an armed press redrew nothing.
		if (finished.started && carries(finished)) {
			if (finished.group) onGroupDragEnd?.(committed ? null : restoreOf(finished.group));
			else onDragEnd?.(finished.id, committed ? null : { x: finished.from.left, y: finished.from.top });
		}
		// A BOX LET GO OF ANY OTHER WAY THAN BY LETTING GO puts the selection back as it was. It has
		// been painted frame by frame as the box grew, and Escape means "not that".
		if (finished.started && finished.kind === "box" && !committed) {
			onSelect?.(finished.draws ? finished.before : finished.base, { final: true });
			// And an abandoned GROUP box is said to be abandoned, so the tool stands down.
			if (finished.draws) onDrawn?.(null);
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

	// THIS BOARD'S OWN HANDLE on the one Escape slot the page has, so this board's exits disarm only a
	// drag this board armed. See `endCancellableDrag`.
	const cancelDrag = () => end();

	/**
	 * How far a carried portrait has travelled, in board percentages: where on the board the pointer is
	 * NOW, less where on the board it was pressed.
	 *
	 * ⚠ TWO PLACES ON THE BOARD, AND NOT THE SCREEN TRAVEL. The wheel zooms the board under a drag --
	 * zooming out to find where somebody is going is the obvious thing to do while carrying them -- and
	 * pixels travelled at one scale but converted at another dropped the portrait well away from the
	 * cursor. Two points on the board stay true whatever the scale and the pan did between them. A
	 * surface that could not place the press falls back to the travel.
	 */
	function travelled(d, clientX, clientY) {
		const now = d.grab ? surface.pointToPercent?.({ clientX, clientY }) : null;
		if (now) return { left: now.left - d.grab.left, top: now.top - d.grab.top };
		return surface.deltaToPercent?.(d.dx, d.dy) ?? null;
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
		if (!drag) { if (aim) paintAim(); return; }
		if (!drag.started) return;
		if (carries(drag) && (drag.group || drag.el)) {
			// Where the drop would land, worked out the way the drop works it out (`heldTravel`), and
			// only then turned back into window pixels, at the scale painted NOW, for the transform.
			const moved = heldTravel(drag, drag.clientX, drag.clientY);
			const screen = moved ? surface.percentToDelta?.(moved.left, moved.top) : null;
			const { x, y } = dragTranslation({
				dx: screen?.dx ?? drag.dx, dy: screen?.dy ?? drag.dy, scale: surface.scale,
			});
			// A transform, not left/top: it composites instead of re-laying out every node on the
			// board on every frame of the drag. The SAME travel on everybody being carried, which
			// is what keeps a group in the shape it was picked up in.
			for (const member of drag.group ?? [drag]) writeTravel(member.el, x, y);
			// A GROUP'S LINES COME WITH IT IN ONE CALL, so a line between two of them is worked out
			// once, with both of its ends already where they are going.
			if (drag.group) {
				if (moved) onGroupDragMove?.(movesOf(drag.group, moved));
				return;
			}
			// AND THE LINES COME WITH IT. Without this the portrait moves and every line attached
			// to it stays pinned to the spot it was picked up from until the pointer is released,
			// which reads as the map not having noticed the drag. Reported from the same travel
			// the drop will use, so what the reader watches settle is where it lands.
			//
			// Deliberately in the SAME rAF as the transform: the two have to be painted in one
			// frame or the line lags a frame behind its own portrait, which is the fault this is
			// here to fix, only smaller.
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
			if (at) rubberLine.setAttribute("d", bandFor(drag.id, drag.from, at, over));
			markLinkTarget(over);
		} else if (drag.kind === "box") {
			const got = boxed(drag, drag.clientX, drag.clientY);
			if (!got) return;
			const { rect, ids } = got;
			marqueeBox.setAttribute("d",
				`M ${rect.left},${rect.top} H ${rect.right} V ${rect.bottom} H ${rect.left} Z`);
			// WHO IS IN IT, SHOWN AS IT GROWS, so the reader lets go when the right people are lit
			// rather than finding out afterwards. Handed over only when the answer CHANGES: a box
			// dragged across open paper is sixty frames a second of the same list, and each one
			// handed over is a sweep of every portrait on the board.
			if (!sameList(ids, drag.shown)) {
				drag.shown = ids;
				onSelect?.(ids, { final: false });
			}
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
		// A SELECTION BOX, on a Shift press on open paper. The pan surface has already stood aside
		// for exactly this press (`pressStartsBox` is the one question both of them ask), so nothing
		// else is going to take it. Asked of `canMove` as well: a box selects people to MOVE, and a
		// board that refuses moving them has nothing for it to do.
		// AND A GROUP'S BOX IS THE SAME BOX, drawn with no Shift while the group tool is armed. It
		// selects nobody when it is let go: whoever is inside becomes the group (`onDrawn`).
		const draws = !!drawing?.() && pressStartsDraw(ev, { view, board });
		if ((draws || pressStartsBox(ev, { view, board })) && canMove()) {
			const start = surface.pointToPercent?.({ clientX: ev.clientX, clientY: ev.clientY });
			if (!start) return;
			// ⚠ PREVENTED, unlike every other press this layer arms. Shift and a drag is the browser's
			// own gesture for selecting TEXT, and the names under the faces are text: without this the
			// box is drawn over a page going blue under it. A press on open paper has no default a
			// reader could miss (no focus to take, no button to press), and the click still arrives.
			ev.preventDefault?.();
			drag = {
				kind: "box",
				pointerId: ev.pointerId,
				startX: ev.clientX, startY: ev.clientY,
				clientX: ev.clientX, clientY: ev.clientY,
				dx: 0, dy: 0,
				start,
				// Who was chosen before the box: it ADDS to them, which is what holding Shift says. A
				// group's box starts from nobody, and gives the selection back as it was when let go.
				base: draws ? [] : [...(selected?.() ?? [])],
				before: [...(selected?.() ?? [])],
				draws,
				shown: null,
				started: false,
			};
			swallowClick = false;
			return;
		}
		// ⚠ A GROUP'S NAME OR OUTLINE PICKS UP EVERYBODY IN IT, and moves them as the selection is
		// moved: one travel, one write, one step of the undo. Not consumed, so a press that never
		// travels is still the CLICK that raises the group's bar.
		const pressedGroup = groupPressed(ev.target);
		if (pressedGroup) {
			if (!canMove()) return;
			const members = [];
			for (const id of groupMembers?.(pressedGroup.id) ?? []) {
				const at = nodeAt?.(id);
				const own = nodeEl(id);
				if (at && own) members.push({ id, el: own, from: { left: at.x, top: at.y } });
			}
			if (!members.length) return;
			// A KIND OF ITS OWN, and NO `id`, `el` or `from`: those are one portrait's, and a group's
			// name is nobody. Lent the first member's, every path that reads them without asking about
			// `group` first would act on one arbitrary person. What it shares with a selection carried
			// by a face is the carrying (`carries`), which only ever reads `group`.
			drag = {
				kind: "group",
				pointerId: ev.pointerId,
				startX: ev.clientX, startY: ev.clientY,
				clientX: ev.clientX, clientY: ev.clientY,
				dx: 0, dy: 0,
				grab: surface.pointToPercent?.({ clientX: ev.clientX, clientY: ev.clientY }) ?? null,
				group: members,
				started: false,
			};
			swallowClick = false;
			return;
		}
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
		// A FACE THAT DRAWS A LINE INSTEAD OF MOVING: with Alt held, or anywhere while the "Draw lines"
		// tool is armed. A line is not a move, so this answers to `canEdit` (asked above) and not to
		// `canMove`, as the handle always has.
		const linksFrom = !handle && (!!ev.altKey || !!linking?.());
		// A board that places its own portraits is not one they can be dragged about on. Returning
		// here and not consuming the event is what keeps the press working as a CLICK: the sheet
		// still opens, and the only thing missing is the drag that had nowhere to go.
		if (!handle && !linksFrom && !canMove()) return;

		const id = handle ? handle.dataset.relmapHandle : node.dataset.relmapNode;
		const spot = nodeAt?.(id);
		if (!spot) return;
		const links = !!handle || linksFrom;

		drag = {
			kind: links ? "link" : "node",
			id,
			el: links ? null : node,
			pointerId: ev.pointerId,
			startX: ev.clientX, startY: ev.clientY,
			clientX: ev.clientX, clientY: ev.clientY,
			dx: 0, dy: 0,
			from: { left: spot.x, top: spot.y },
			// Where on the BOARD the press landed, which is what the drop is measured from. See `travelled`.
			grab: surface.pointToPercent?.({ clientX: ev.clientX, clientY: ev.clientY }) ?? null,
			// EVERYBODY ELSE COMING ALONG, when the face pressed is one of several selected. Worked out
			// at the press, for the reason `from` is: by the release the board has been redrawn.
			group: links ? null : groupFor(id, spot, node),
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
		// the pointercancel, the teardown, or the first move made with no button held, whichever
		// arrives. That last one is the release that happened somewhere else; see pointermove.
		swallowClick = false;
	});

	view.addEventListener("pointermove", ev => {
		// THE AIM FOLLOWS THE POINTER WITH NO BUTTON DOWN, one frame at a time like a drag.
		if (!drag && aim) {
			aim.clientX = ev.clientX;
			aim.clientY = ev.clientY;
			schedule();
			return;
		}
		if (!drag || ev.pointerId !== drag.pointerId) return;
		drag.dx = ev.clientX - drag.startX;
		drag.dy = ev.clientY - drag.startY;
		drag.clientX = ev.clientX;
		drag.clientY = ev.clientY;
		if (!drag.started) {
			// ⚠ A PRESS WHOSE BUTTON IS NO LONGER DOWN WAS LET GO SOMEWHERE THIS BOARD NEVER HEARD. Nothing
			// is captured while a press is merely armed (see pointerdown), so a release a pixel or two past
			// the edge of the viewport went to whatever was there instead. Left armed, the next pass of
			// the cursor over the board lifted the portrait with no button held and carried it about,
			// every live update waited behind `is-dragging`, and the next click anywhere dropped it. A
			// host that reports no `buttons` at all (the tests' fake events) compares false and carries on.
			if (ev.buttons === 0) { end(); return; }
			if (!isLiftedDrag(drag.dx, drag.dy)) return;
			drag.started = true;
			// A REAL DRAG PUTS A PICK DOWN: the band and the Escape slot are the drag's now.
			endAim();
			// NOW, and not at pointerdown: a fast drag has to keep being followed once the cursor
			// leaves the window, and the pointerup has to arrive even if it happens out over the
			// scene canvas. Taken only here, so an unmoved press keeps its own click (see above).
			view.setPointerCapture?.(drag.pointerId);
			beginCancellableDrag(cancelDrag);
			board.classList.add("is-dragging");
			// The rubber band belongs to ONE of the three gestures. A caption being slid is marked
			// the way a portrait being carried is -- on the element itself, for the stylesheet --
			// and a band drawn from nowhere to the cursor would be this board's one gesture that
			// looked like a different one.
			if (drag.kind === "link") board.appendChild(rubber);
			else if (drag.kind === "box") {
				board.appendChild(marquee);
				// Its own cursor: a hand that grabs says the board is moving, and it is not.
				board.classList.add("is-boxing");
			}
			else for (const el of drag.group?.map(member => member.el) ?? [drag.el]) el?.classList.add("is-dragging");
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

		if (carries(finished)) {
			// From the RELEASE position and the place on the board the press landed, as the preview is
			// and for the reason `travelled` gives: the scale may no longer be the one it was pressed at.
			const moved = heldTravel(finished, dropX, dropY);
			if (!moved) return;
			if (finished.group) {
				onGroupMove?.(movesOf(finished.group, moved));
				return;
			}
			onMove?.(finished.id, {
				x: finished.from.left + moved.left,
				y: finished.from.top + moved.top,
			});
			return;
		}

		if (finished.kind === "box") {
			// Who is in the box where it was LET GO, for the reason every other drop here reads the
			// release: the last frame before it may never have been painted.
			const got = boxed(finished, dropX, dropY);
			if (finished.draws) {
				// The box was lit as it grew by borrowing the selection's marks; they go back to what
				// they were, and whoever was inside becomes the group.
				onSelect?.(finished.before, { final: false });
				onDrawn?.(got?.ids ?? finished.shown ?? []);
				return;
			}
			onSelect?.(got?.ids ?? finished.shown ?? finished.base, { final: true });
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
		// EVERY CLICK GOES ON THE END OF THE PAIR, swallowed or not, because a double click is made
		// of the two before it and the dblclick handler has to be able to ask about both.
		lastClicks = [lastClicks[1], swallowClick];
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
		// A GROUP'S NAME OR OUTLINE raises its bar. With Shift (or Ctrl, Cmd) it puts everybody in the
		// group into the selection instead, which is the quick way to move "the hunters" somewhere
		// AND keep them selected, or to start a second group from the first.
		const grouped = groupPressed(ev.target);
		if (grouped) {
			ev.preventDefault();
			if (!canEdit()) return;
			if (addsToSelection(ev)) {
				if (canMove()) onSelect?.(unionOf(selected?.() ?? [], groupMembers?.(grouped.id) ?? []), { final: true });
				return;
			}
			onPickGroup?.(grouped.id, grouped.el.matches?.("[data-relmap-group]") ? grouped.el : null);
			return;
		}
		// SHIFT, CTRL OR CMD ON SOMEBODY PUTS THEM IN THE SELECTION, or takes them out of it. Ahead of
		// the face below, and asked of the whole PERSON rather than only the face, so the name hung
		// under a portrait answers as the portrait does. It is also the keyboard's way to a selection:
		// Shift+Enter on a face arrives here as a click with Shift held (`detail` 0), and a plain Enter
		// goes on opening the sheet.
		//
		// Asked of `canMove`, because a selection is only for moving people together: on a board that
		// refuses the move, a mark on the face would promise something no gesture can deliver.
		const person = addsToSelection(ev) ? ev.target.closest?.("[data-relmap-node]") : null;
		if (person) {
			ev.preventDefault();
			if (canEdit() && canMove()) {
				const id = person.dataset.relmapNode;
				const chosen = selected?.() ?? [];
				onSelect?.(chosen.includes(id) ? chosen.filter(other => other !== id) : [...chosen, id], { final: true });
			}
			return;
		}
		// ⚠ A SINGLE CLICK ON A FACE OPENS NOTHING ANY MORE (user, 2026-09-10). The board is the
		// surface a whole table clicks around on while talking -- pointing at people, taking hold
		// of the lines between them -- and a face that threw a character sheet up over the map on
		// every one of those was the map covering itself. The sheet is on the DOUBLE click now,
		// below; this branch still CLAIMS the click, so it never falls through to `onPickNone` and
		// a line the reader is holding is not let go by a press on somebody's face.
		//
		// ⚠ EXCEPT FROM THE KEYBOARD, WHICH HAS NO DOUBLE. The face is a real `<button>`, so Enter
		// and Space on it arrive here as a click and are the only route a reader who does not use
		// a pointer has to a sheet at all. A keyboard-activated click carries `detail === 0`; every
		// click a mouse makes counts from 1. Read affirmatively -- an event stand-in with no
		// `detail` at all is not a keyboard press and must not be taken for one.
		const face = ev.target.closest?.("[data-relmap-open]");
		// WITH "DRAW LINES" ARMED, A CLICK ON A FACE IS THE TOOL'S, from the mouse and the keyboard
		// alike: the first picks who to draw from, the next on somebody else draws the line, and the
		// same face again lets the pick go. Enter on a face draws lines instead of opening a sheet
		// while the tool is on; the double click still opens one.
		if (face && linking?.() && canEdit()) {
			ev.preventDefault();
			const id = face.dataset.relmapOpen;
			if (aim && aim.id !== id) {
				const from = aim.id;
				endAim();
				onLink?.(from, id);
			} else if (aim) endAim();
			else if (ev.detail === 0) startAim(id);
			else startAim(id, ev.clientX, ev.clientY);
			return;
		}
		if (face) {
			ev.preventDefault();
			if (ev.detail === 0) onOpen?.(face.dataset.relmapOpen);
			return;
		}
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
		if (isPaper(ev.target) && (stayedPut || board.contains?.(ev.target))) {
			endAim();
			onPickNone?.();
			// AND THE SELECTION IS LET GO WITH IT, by the same click and for the same reason: letting go
			// has to be as easy as taking hold. Not on a click with Shift held, which says "adding",
			// and not when there is nothing selected, which would be a sweep of the board for nothing.
			if (!addsToSelection(ev) && (selected?.() ?? []).length) onSelect?.([], { final: true });
		}
	});

	// ── The sheet ───────────────────────────────────────────────────────────
	//
	// A PORTRAIT'S SHEET IS A DOUBLE CLICK. The board is talked over and clicked around on, and a
	// sheet thrown up by every single click on a face buried the map under itself; the click above
	// says the rest of it.
	//
	// On the browser's own `dblclick` rather than on a count of clicks kept here, so the pair is
	// judged by the reader's OWN system settings -- the double-click speed they set once, and the
	// slop a shaking hand is allowed between the two presses. A timer written into this file would
	// be one more number to get right for the one person at this table who most needs it right.
	//
	// ⚠ AND THE PAN SURFACE ALREADY KNOWS TO KEEP OFF. A double click on bare paper zooms the board
	// between fit and full size (utils/zoom-pan-surface.js), and it refuses that on anything in
	// `BOARD_CONTROLS` -- which names `[data-relmap-open]`. So this gesture is not shared with the
	// zoom, and a reader opening a sheet does not also find the board has jumped.
	view.addEventListener("dblclick", ev => {
		// ⚠ NOT A DOUBLE CLICK IF EITHER HALF OF IT WAS THE TAIL OF A DRAG. See `lastClicks`.
		// Spent here, so the pair that follows is judged on its own.
		const drags = lastClicks[0] || lastClicks[1];
		lastClicks = [false, false];
		if (drags) return;
		// NOR ONE MADE WITH SHIFT HELD, whose two clicks have just put somebody in the selection and
		// taken them out again. That is a reader choosing people, not asking for a sheet.
		if (addsToSelection(ev)) return;
		const face = ev.target.closest?.("[data-relmap-open]");
		if (!face) return;
		ev.preventDefault();
		onOpen?.(face.dataset.relmapOpen);
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
		// ESCAPE PUTS A SELECTION DOWN, and is the board's then and not the scene's. Claimed only
		// while something IS selected and nothing is being carried: a live drag has Escape already
		// (relationship-board.js, in the capture phase, ahead of this), and with nobody selected the
		// key has nothing to do here and goes on to whatever core does with it. Only from the BOARD:
		// the tie bar floats in this viewport too, and its Escape is its own.
		// AND IT STANDS AN ARMED GROUP TOOL DOWN, first, since that is the last thing the reader asked for.
		// AND THE "DRAW LINES" TOOL THE SAME WAY, once nobody is picked (a pick's own Escape is the
		// capture-phase one, and lets only the pick go).
		if (ev.key === "Escape" && !drag && !aim && isPaper(ev.target) && linking?.()) {
			ev.preventDefault();
			ev.stopPropagation();
			onStopLinking?.();
			return;
		}
		if (ev.key === "Escape" && !drag && isPaper(ev.target) && drawing?.()) {
			ev.preventDefault();
			ev.stopPropagation();
			onDrawn?.(null);
			return;
		}
		if (ev.key === "Escape" && !drag && isPaper(ev.target) && (selected?.() ?? []).length) {
			ev.preventDefault();
			ev.stopPropagation();
			onSelect?.([], { final: true });
			return;
		}
		// A GROUP'S NAME, which is a `div` wearing `role="button"`: Enter and Space are handed to it
		// as they are to a caption, and the arrows and Delete are claimed below with everything else.
		const groupName = ev.target.closest?.("[data-relmap-group]");
		if (groupName && (ev.key === "Enter" || ev.key === " ")) {
			ev.preventDefault();
			ev.stopPropagation();
			// From the keyboard, so the bar takes the focus: there is no pointer to reach it with.
			if (canEdit()) onPickGroup?.(groupName.dataset.relmapGroup, groupName, { keyboard: true });
			return;
		}
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
		// ⚠ AND A GROUP'S NAME IS A TAB STOP TOO, whose Delete means "rub this group out". Left out
		// of this list, that Delete would reach the scene and take the GM's selected tokens with it.
		const mine = face
			?? ev.target.closest?.("[data-relmap-edge], [data-relmap-handle], [data-relmap-remove], [data-relmap-group]");
		if (!mine) return;
		const step = ev.shiftKey ? NUDGE_FINE : NUDGE_STEP;
		const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
		if (ev.key !== "Delete" && !move) {
			// ⚠ ENTER AND SPACE ARE KEPT FROM THE SCENE TOO, though this board does nothing with them.
			// They are the face's, the handle's and the can's own keys -- a button activates on them,
			// which is the keyboard's way to a sheet, a line and a removal -- and core has them as well:
			// Space pauses the game for the whole table, and a button outside a form is not focus as far
			// as core is concerned (the paragraph below). Stopped and NOT prevented, so the button under
			// the key still activates. The steading sheet's panel sits inside that sheet's form and was
			// safe already; the map's own window has no form at all.
			if (ev.key === "Enter" || ev.key === " ") ev.stopPropagation();
			return;
		}

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
		// One arrow step for everybody it carries, held as a unit at the rail (`holdTravel`), so they
		// arrive in the shape they set out in. MORE THAN ONE IN ONE CALL, for the reason a group drag
		// is one: a line between two of them is drawn once with both ends moved, rather than swung
		// from one end and then the other. A group's name is always one call, however many stand.
		const nudge = (ids, { asOne = false } = {}) => {
			const spots = [];
			for (const member of ids) {
				const spot = nodeAt?.(member);
				if (spot) spots.push([member, spot]);
			}
			if (!spots.length) return;
			const held = holdTravel({ left: move[0], top: move[1] }, spots.map(([, spot]) => ({ left: spot.x, top: spot.y })));
			const moves = {};
			for (const [member, spot] of spots) moves[member] = { x: spot.x + held.left, y: spot.y + held.top };
			if (onGroupNudge && (asOne || spots.length > 1)) onGroupNudge(moves);
			else for (const [member, at] of Object.entries(moves)) (onNudge ?? onMove)?.(member, at);
		};
		// A GROUP'S NAME: Delete rubs the group out (its people stay), and the arrows move everybody
		// in it together, held at the rail as a unit like any selection.
		if (groupName) {
			if (!canEdit()) return;
			const id = groupName.dataset.relmapGroup;
			if (ev.key === "Delete") { onRemoveGroup?.(id); return; }
			if (canMove()) nudge(groupMembers?.(id) ?? [], { asOne: true });
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
		// AND THEY CARRY THE SAME PEOPLE A DRAG WOULD: the whole selection when the focused face is
		// one of it, and otherwise that face alone.
		const chosen = selected?.() ?? [];
		nudge(chosen.length > 1 && chosen.includes(id) ? chosen : [id]);
	});

	const teardown = () => { endAim(); end(); };
	// For the window, which stands the "Draw lines" tool down from its own footer, outside this board.
	teardown.stopAiming = () => endAim();
	return teardown;
}
