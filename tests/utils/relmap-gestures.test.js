import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireRelmapDrag } from "../../module/utils/relmap-drag.js";
import { fakeSurface, pointerBoard } from "../fakes/pointer-board.js";

// The LISTENER PLUMBING on a relationship map, as opposed to the arithmetic behind it, which
// relmap-drag.test.js measures. Its own file because it needs a DOM stand-in and a set of globals
// that the arithmetic tests are better off without.
//
// WHAT THIS IS ACTUALLY FOR. The board's two non-drag routes — click a portrait to open its sheet,
// click the handle to be asked who to link to — were dead, and dead in a way no manual pass in the
// default state would find: a board nobody may edit never arms a drag at all, so the bug only
// existed for the owner, which is who does everything else on a map. The cause was one
// line of ordering. `setPointerCapture` RETARGETS every later event from that pointer at the
// capturing element, including the pointerup the browser derives the `click` from, and releasing
// it does not undo that. Taking the capture at pointerdown — while the press was still only ARMED
// and might never become a drag — therefore aimed every click at the viewport, where `closest`
// finds no portrait. utils/zoom-pan-surface.js sets the same trap out where it refuses to pan from
// a control; this board fell into it anyway.
//
// So the assertions are about WHEN the capture is taken, not about the retarget: no fake can
// reproduce a browser quirk faithfully enough to be worth asserting against, but "not while merely
// armed" is a rule the production code either keeps or does not.

const wire = (board, over = {}) => {
	const handlers = {
		surface: fakeSurface(),
		nodeAt: vi.fn(id => ({ x: 20, y: 30, id })),
		onMove: vi.fn(), onNudge: vi.fn(), onDragMove: vi.fn(), onDragEnd: vi.fn(),
		onLink: vi.fn(), onLinkFrom: vi.fn(), onOpen: vi.fn(), onPickEdge: vi.fn(),
		onPickNone: vi.fn(), onRemove: vi.fn(), onArm: vi.fn(),
		canEdit: () => true,
		...over,
	};
	return { handlers, teardown: wireRelmapDrag(board.root, handlers) };
};

/** A press, a travel and a release, followed by the click a real browser would derive from it. */
function press(board, target, { to = null, pointerId = 1 } = {}) {
	board.view.emit("pointerdown", target, { pointerId, clientX: 0, clientY: 0 });
	if (to) {
		board.view.emit("pointermove", target, { pointerId, clientX: to[0], clientY: to[1] });
		board.flush();
	}
	board.view.emit("pointerup", target, { pointerId, clientX: to?.[0] ?? 0, clientY: to?.[1] ?? 0 });
	return board.view.emit("click", target, { pointerId });
}

describe("a press that never travels", () => {
	let board;
	beforeEach(() => {
		board = pointerBoard();
		board.view.setPointerCapture = vi.fn();
		board.view.releasePointerCapture = vi.fn();
	});
	afterEach(() => board.destroy());

	// THE BUG THIS FILE EXISTS TO CATCH. Capture while armed and the click lands on the viewport.
	it("takes no pointer capture, because the capture would eat its click", () => {
		const { teardown } = wire(board);
		board.view.emit("pointerdown", board.portraits.n1.face, { clientX: 0, clientY: 0 });
		expect(board.view.setPointerCapture).not.toHaveBeenCalled();
		teardown();
	});

	it("opens the portrait it was made on", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.portraits.n1.face);
		expect(handlers.onOpen).toHaveBeenCalledWith("n1");
		expect(handlers.onMove).not.toHaveBeenCalled();
		teardown();
	});

	// The other non-drag route, and the one a keyboard user reaches by pressing Enter on the same
	// control: the handle is a real button, so a click on it has to ask who to link to.
	it("asks the handle who to link to", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.portraits.n1.handle);
		expect(handlers.onLinkFrom).toHaveBeenCalledWith("n1");
		expect(handlers.onOpen).not.toHaveBeenCalled();
		teardown();
	});

	// A press below the lift threshold is still not a drag. Worth its own case because the fix is
	// about the ARMED window specifically, and a threshold of zero would pass the test above.
	it("still opens the portrait after a twitch too small to be a drag", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.portraits.n1.face, { to: [2, 1] });
		expect(board.view.setPointerCapture).not.toHaveBeenCalled();
		expect(handlers.onOpen).toHaveBeenCalledWith("n1");
		expect(handlers.onMove).not.toHaveBeenCalled();
		teardown();
	});
});

describe("a press that becomes a drag", () => {
	let board;
	beforeEach(() => {
		board = pointerBoard();
		board.view.setPointerCapture = vi.fn();
		board.view.releasePointerCapture = vi.fn();
	});
	afterEach(() => board.destroy());

	// The capture still has to be taken, or a fast drag stops being followed the moment the cursor
	// leaves the window and the pointerup never arrives at all. Only later than it used to be.
	it("takes the capture at the moment the threshold is crossed", () => {
		const { teardown } = wire(board);
		board.view.emit("pointerdown", board.portraits.n1.face, { clientX: 0, clientY: 0 });
		expect(board.view.setPointerCapture).not.toHaveBeenCalled();
		board.view.emit("pointermove", board.portraits.n1.face, { clientX: 40, clientY: 0 });
		expect(board.view.setPointerCapture).toHaveBeenCalledWith(1);
		teardown();
	});

	it("writes the move it was, and does not also open the sheet", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.portraits.n1.face, { to: [40, 0] });
		expect(handlers.onMove).toHaveBeenCalledWith("n1", { x: 24, y: 30 });
		expect(handlers.onOpen).not.toHaveBeenCalled();
		teardown();
	});

	// NOT ONE MADE MID-PAN. The right button drags the board from anywhere on it, lines included
	// (utils/zoom-pan-surface.js), so a left press with the right one still held is a press made
	// while the whole board is sliding. Arming a drag under that moves a portrait and the ground it
	// stands on at once, and the pan's capture ends the drag wherever it has got to -- an edit to a
	// shared map from a press that was only meant to steady the hand.
	it("arms nothing when the board is already being panned with the other button", () => {
		const { handlers, teardown } = wire(board);
		board.view.emit("pointerdown", board.portraits.n1.face, { buttons: 3, clientX: 0, clientY: 0 });
		board.view.emit("pointermove", board.portraits.n1.face, { clientX: 40, clientY: 0 });
		board.flush();
		expect(handlers.onDragMove).not.toHaveBeenCalled();
		expect(board.view.setPointerCapture).not.toHaveBeenCalled();
		teardown();
	});

	// The click after a drag is swallowed by a flag rather than by the capture's retargeting, so
	// that exactly ONE click is eaten. A flag that stayed armed would eat the reader's next real
	// press, which is the same class of dead-click bug in the other direction.
	it("swallows one click and no more", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.portraits.n1.face, { to: [40, 0] });
		expect(handlers.onOpen).not.toHaveBeenCalled();
		board.view.emit("click", board.portraits.n1.face);
		expect(handlers.onOpen).toHaveBeenCalledWith("n1");
		teardown();
	});

	// ⚠ AND NOT EVEN WHEN THE ONE CLICK NEVER ARRIVES. utils/zoom-pan-surface.js swallows the click
	// derived from a press that CAUGHT A SLIDING BOARD -- in the capture phase, on this same
	// element, and ahead of this module's handler, which therefore never runs and never spends its
	// own flag. Drag a portrait with the press that stopped a glide and both modules mean to eat
	// that click; only one of them gets to, and the flag left behind ate the reader's NEXT click,
	// on a stroke, a caption or bare paper. So the flag is dropped by the next PRESS as well, which
	// is the first moment this module can tell its click was taken.
	it("gives up a swallow whose click was taken away by the board underneath", () => {
		const { handlers, teardown } = wire(board);
		board.view.emit("pointerdown", board.portraits.n1.face, { clientX: 0, clientY: 0 });
		board.view.emit("pointermove", board.portraits.n1.face, { clientX: 40, clientY: 0 });
		board.flush();
		board.view.emit("pointerup", board.portraits.n1.face, { clientX: 40, clientY: 0 });
		// ...and no click: the surface ate it in the capture phase.
		//
		// ⚠ ON A CAPTION AND NOT ON A FACE, and that is what makes this a test. A press that arms a
		// drag of its own clears the flag on its way past, so the fault heals itself on any press
		// that happens to land on a portrait -- and the reader who meets it is the one whose next
		// press is a LOOK rather than a move: at a line, at the words on it, at bare paper. Those
		// arm nothing, and under the fault they did nothing either.
		press(board, board.captions.e1.words);
		expect(handlers.onPickEdge).toHaveBeenCalledWith("e1");
		teardown();
	});

	// AND THE TRASH CAN GOES WITH IT. The click that was taken away is also the click that would
	// have put an armed can away (`onArm(null)` covers every click on the board), so a can armed
	// before the drag would otherwise sit there through a gesture that had nothing to do with it.
	it("puts an armed trash can away once it learns its click was taken", () => {
		const { handlers, teardown } = wire(board);
		board.view.emit("pointerdown", board.portraits.n1.face, { clientX: 0, clientY: 0 });
		board.view.emit("pointermove", board.portraits.n1.face, { clientX: 40, clientY: 0 });
		board.flush();
		board.view.emit("pointerup", board.portraits.n1.face, { clientX: 40, clientY: 0 });
		handlers.onArm.mockClear();
		board.view.emit("pointerdown", board.portraits.n1.face, { clientX: 0, clientY: 0 });
		expect(handlers.onArm).toHaveBeenCalledWith(null);
		teardown();
	});

	// And an ordinary drag, whose click DOES arrive, asks for nothing of the sort on the next press:
	// the flag was spent where it was meant to be, and a press that dismissed a can the reader had
	// just armed would be the button closing itself.
	it("asks for nothing extra on the press after a swallow that was spent", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.portraits.n1.face, { to: [40, 0] });
		handlers.onArm.mockClear();
		board.view.emit("pointerdown", board.portraits.n1.face, { clientX: 0, clientY: 0 });
		expect(handlers.onArm).not.toHaveBeenCalled();
		teardown();
	});

	// An Escape or a lost pointer ends the drag with no click to follow, so nothing may be left
	// armed: the flag is set by the RELEASE, which is the only exit a click comes after.
	it("leaves nothing armed when the drag is cancelled instead of released", () => {
		const { handlers, teardown } = wire(board);
		board.view.emit("pointerdown", board.portraits.n1.face, { clientX: 0, clientY: 0 });
		board.view.emit("pointermove", board.portraits.n1.face, { clientX: 40, clientY: 0 });
		board.view.emit("pointercancel", board.portraits.n1.face, {});
		press(board, board.portraits.n1.face);
		expect(handlers.onOpen).toHaveBeenCalledWith("n1");
		teardown();
	});

	// THE SECOND BUG THIS FILE EXISTS TO CATCH, and it was visible on every single drag. A node is
	// centred on its own coordinates by a `translate(-50%, -50%)` in the stylesheet, which is also
	// what the line geometry is trimmed against. Writing `style.transform` to carry it REPLACES
	// that declaration instead of adding to it, so the portrait jumped half its own width down and
	// right the instant the threshold was crossed, rode the whole drag that far off the lines still
	// drawn to its centre, and snapped back onto the cursor when the transform was dropped on
	// release. Custom properties the stylesheet folds into its own transform leave the centring
	// alone, so the rule is: travel is written as variables, and `transform` is never touched.
	it("carries the portrait by variables, leaving the stylesheet's centring in place", () => {
		const { teardown } = wire(board);
		board.view.emit("pointerdown", board.portraits.n1.face, { clientX: 0, clientY: 0 });
		board.view.emit("pointermove", board.portraits.n1.face, { clientX: 40, clientY: 12 });
		board.flush();
		expect(board.portraits.n1.style["--relmap-drag-x"]).toBe("40px");
		expect(board.portraits.n1.style["--relmap-drag-y"]).toBe("12px");
		expect(board.portraits.n1.style.transform).toBeUndefined();
		teardown();
	});

	// The write on release moves the node's own coordinates, so the travel has to be gone by then
	// or it is counted twice and the portrait lands at double the distance.
	it("takes the travel back off once the drag is over", () => {
		const { teardown } = wire(board);
		press(board, board.portraits.n1.face, { to: [40, 12] });
		expect(board.portraits.n1.style["--relmap-drag-x"]).toBeUndefined();
		expect(board.portraits.n1.style["--relmap-drag-y"]).toBeUndefined();
		teardown();
	});

	it("drops a line onto the portrait under the cursor", () => {
		const { handlers, teardown } = wire(board);
		board.setHits([board.portraits.n2.face]);
		press(board, board.portraits.n1.handle, { to: [40, 0] });
		expect(handlers.onLink).toHaveBeenCalledWith("n1", "n2");
		expect(handlers.onLinkFrom).not.toHaveBeenCalled();
		teardown();
	});
});

// ── The person a half-drawn line is over ────────────────────────────────────
//
// A line dragged out of a handle used to be drawn into empty space: the reader found out whether
// they had hit anybody by letting go. A portrait is 72px on a board that can be zoomed out to hold
// forty of them, so that is a real question, and the answer is cheap to give while the pointer is
// still down.
//
// WHAT THESE ARE ACTUALLY GUARDING is that the mark and the drop are the SAME answer. A ring that
// lit somebody the release then did not link to would be worse than no ring at all — the reader
// would have been told the wrong thing rather than left to guess — so the two are resolved through
// one function, and these press the same fake hits through both ends of the gesture.
describe("a line being dragged towards somebody", () => {
	let board;
	beforeEach(() => {
		board = pointerBoard();
		board.view.setPointerCapture = vi.fn();
		board.view.releasePointerCapture = vi.fn();
	});
	afterEach(() => board.destroy());

	/** Press the handle, travel, and paint the frame that travel queued. */
	function drawTowards(to, { pointerId = 1 } = {}) {
		board.view.emit("pointerdown", board.portraits.n1.handle, { pointerId, clientX: 0, clientY: 0 });
		board.view.emit("pointermove", board.portraits.n1.handle, { pointerId, clientX: to[0], clientY: to[1] });
		board.flush();
	}

	const lit = () => Object.entries(board.portraits)
		.filter(([, el]) => el.classList.contains("is-link-target"))
		.map(([id]) => id);

	it("rings the portrait the line would land on", () => {
		const { teardown } = wire(board);
		board.setHits([board.portraits.n2.face]);
		drawTowards([40, 0]);
		expect(lit()).toEqual(["n2"]);
		teardown();
	});

	// The name under a face is a target too — it is inside the node the drop resolves to — and a
	// board zoomed out far enough to read is a board where the name is most of what the cursor can
	// find. The ring has to appear there as well, or the mark says "miss" on a drop that will hit.
	it("rings them from their name as readily as from their face", () => {
		const { teardown } = wire(board);
		board.setHits([board.portraits.n2.name]);
		drawTowards([40, 0]);
		expect(lit()).toEqual(["n2"]);
		teardown();
	});

	// ⚠ THE ONE THAT MATTERS. Nobody is a valid target for a line out of their own handle, and the
	// drop has always known that; a ring that lit the person the line came FROM would promise a
	// link the release then refuses, which is the exact mismatch this pair of marks exists to
	// avoid.
	it("never rings the person the line came from", () => {
		const { handlers, teardown } = wire(board);
		board.setHits([board.portraits.n1.face]);
		drawTowards([40, 0]);
		expect(lit()).toEqual([]);
		board.view.emit("pointerup", board.portraits.n1.handle, { clientX: 40, clientY: 0 });
		expect(handlers.onLink).not.toHaveBeenCalled();
		teardown();
	});

	it("moves the ring on when the pointer moves on, and takes it off over empty board", () => {
		const { teardown } = wire(board);
		board.setHits([board.portraits.n2.face]);
		drawTowards([40, 0]);
		expect(lit()).toEqual(["n2"]);

		board.setHits([]);
		board.view.emit("pointermove", board.portraits.n1.handle, { clientX: 60, clientY: 0 });
		board.flush();
		expect(lit()).toEqual([]);
		teardown();
	});

	// Every exit, not just the release: an Escape, a lost pointer or a teardown mid-gesture would
	// otherwise leave somebody ringed for a line nobody is drawing any more.
	const EXITS = [
		["released onto them", b => b.view.emit("pointerup", b.portraits.n1.handle, { clientX: 40, clientY: 0 })],
		["cancelled", b => b.view.emit("pointercancel", b.portraits.n1.handle, {})],
		["lost with the pointer", b => b.view.emit("lostpointercapture", b.portraits.n1.handle, {})],
	];
	for (const [how, finish] of EXITS) {
		it(`takes the ring off again when the drag is ${how}`, () => {
			const { teardown } = wire(board);
			board.setHits([board.portraits.n2.face]);
			drawTowards([40, 0]);
			expect(lit()).toEqual(["n2"]);
			finish(board);
			expect(lit()).toEqual([]);
			teardown();
		});
	}

	it("leaves nobody ringed when the window is torn down mid-gesture", () => {
		const { teardown } = wire(board);
		board.setHits([board.portraits.n2.face]);
		drawTowards([40, 0]);
		teardown();
		expect(lit()).toEqual([]);
	});

	// Moving a PORTRAIT is not drawing a line, and rings nobody: the drop writes coordinates, and
	// whoever the cursor happens to pass over on the way has nothing to do with it.
	it("rings nobody while a portrait is only being moved", () => {
		const { teardown } = wire(board);
		board.setHits([board.portraits.n2.face]);
		board.view.emit("pointerdown", board.portraits.n1.face, { clientX: 0, clientY: 0 });
		board.view.emit("pointermove", board.portraits.n1.face, { clientX: 40, clientY: 0 });
		board.flush();
		expect(lit()).toEqual([]);
		teardown();
	});
});

describe("a board the reader may not edit", () => {
	let board;
	beforeEach(() => {
		board = pointerBoard();
		board.view.setPointerCapture = vi.fn();
		board.view.releasePointerCapture = vi.fn();
	});
	afterEach(() => board.destroy());

	// Reading is not editing, but it is not nothing either: a read-only board still opens sheets.
	// This is also the state the original bug HID in — a board that arms no drag captures no
	// pointer, so its clicks worked, which is why a player's view looked fine.
	it("still opens a portrait, while moving nothing", () => {
		const { handlers, teardown } = wire(board, { canEdit: () => false });
		press(board, board.portraits.n1.face, { to: [40, 0] });
		expect(handlers.onOpen).toHaveBeenCalledWith("n1");
		expect(handlers.onMove).not.toHaveBeenCalled();
		expect(board.view.setPointerCapture).not.toHaveBeenCalled();
		teardown();
	});

	it("refuses the link picker, which would offer an edit it cannot make", () => {
		const { handlers, teardown } = wire(board, { canEdit: () => false });
		press(board, board.portraits.n1.handle);
		expect(handlers.onLinkFrom).not.toHaveBeenCalled();
		teardown();
	});
});

// ── Opening a link from its caption ─────────────────────────────────────────
//
// THE WORDS ARE THE BUTTON now, and not in the HTML sense. Every caption on the board shares one
// svg — a hundred separate roots of text-on-a-path is what made the map crawl — so there is no
// element left to be a real `<button>`: a wrapper would be either the caption's enormous bounding
// box, which would swallow every click meant for the faces underneath, or a second element to keep
// in step with the glyphs. The `<text>` wears `role="button"` and a `tabindex` instead, and the one
// ── Taking hold of a line ────────────────────────────────────────────────────
//
// A LINE WITH NOTHING WRITTEN ON IT HAD NO TARGET AT ALL. The caption was the only thing on a line a
// reader could aim at, so a line drawn without one could be reached from neither the mouse nor the
// keyboard -- and the one gesture that would put writing on it is a click on the line. The painted
// stroke cannot take the click itself (four screen pixels, in a layer that refuses pointer events so
// that a drag on bare board pans it), so the target is a second invisible stroke laid over it.
describe("the stroke of a line", () => {
	let board;
	beforeEach(() => {
		board = pointerBoard();
		board.view.setPointerCapture = vi.fn();
		board.view.releasePointerCapture = vi.fn();
	});
	afterEach(() => board.destroy());

	it("takes hold of its line when the stroke is clicked", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.strokes.e1.hit);
		expect(handlers.onPickEdge).toHaveBeenCalledWith("e1");
		teardown();
	});

	// The invisible one and never the painted one. A test that pressed the painted stroke would
	// pass on a fake that let anything be clicked, and prove nothing about the board that ships.
	it("says nothing when the painted stroke is pressed, which cannot be", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.strokes.e1);
		expect(handlers.onPickEdge).not.toHaveBeenCalled();
		teardown();
	});

	it("offers nothing to a reader who may not write", () => {
		const { handlers, teardown } = wire(board, { canEdit: () => false });
		press(board, board.strokes.e1.hit);
		expect(handlers.onPickEdge).not.toHaveBeenCalled();
		teardown();
	});
});

// ── Letting go ──────────────────────────────────────────────────────────────
//
// The board is the surface a reader clicks around on while they are talking, so letting go of a
// line has to be as easy as taking hold of one: an X on the bar would be the only way out of a
// thing that opens on a click.
describe("a click that lands on nothing", () => {
	let board;
	beforeEach(() => {
		board = pointerBoard();
		board.view.setPointerCapture = vi.fn();
		board.view.releasePointerCapture = vi.fn();
	});
	afterEach(() => board.destroy());

	it("lets go of whatever was being held", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.board);
		expect(handlers.onPickNone).toHaveBeenCalled();
		teardown();
	});

	/**
	 * The same press, as A REAL BROWSER delivers it once the pan surface has hold of the pointer.
	 *
	 * ⚠ THIS IS THE ONLY SHAPE THAT EVER HAPPENS ON PAPER. `press` above emits the click at the
	 * thing pressed, which is what a browser does for a press the pan surface let alone -- a
	 * portrait, a caption, the bar. Bare paper is never let alone: it IS the pan, so the surface
	 * captures the pointer on the way down, and the capture retargets the pointerup and the click
	 * it is derived from at the VIEWPORT. The test that asserted the tie bar could be dismissed was
	 * written in the other shape, and so passed for a year against a window in which clicking away
	 * from an open bar did nothing whatever.
	 */
	const pressUnderCapture = ({ to = [0, 0] } = {}) => {
		board.view.emit("pointerdown", board.board, { pointerId: 1, clientX: 0, clientY: 0 });
		board.view.emit("pointerup", board.view, { pointerId: 1, clientX: to[0], clientY: to[1] });
		return board.view.emit("click", board.view, { pointerId: 1, clientX: to[0], clientY: to[1] });
	};

	it("lets go even though the pan has taken the click's target away", () => {
		const { handlers, teardown } = wire(board);
		pressUnderCapture();
		expect(handlers.onPickNone).toHaveBeenCalled();
		teardown();
	});

	// A PAN IS NOT A LET-GO. Dragging the board about with a line's bar open is reading the map --
	// the bar rides along with the board it points at -- so the one gesture a reader makes most
	// while a bar is up must not be the one that puts the line down.
	it("keeps hold of the line while the board is being panned", () => {
		const { handlers, teardown } = wire(board);
		pressUnderCapture({ to: [80, 40] });
		expect(handlers.onPickNone).not.toHaveBeenCalled();
		teardown();
	});

	// ⚠ THE PRESS ON BARE PAPER IS THE PAN SURFACE'S. Claiming it here would take the board's own
	// drag away, and the board would stop moving.
	it("does not claim the press, which belongs to the pan", () => {
		const { teardown } = wire(board);
		const ev = press(board, board.board);
		expect(ev.defaultPrevented).toBe(false);
		teardown();
	});

	// ⚠ THE BAR IS INSIDE THE VIEWPORT, so every swatch and every arrow on it arrives at this same
	// delegated handler. Unclaimed, each of them would read as "clicked the board and nothing on
	// it" and close the bar under the press that was operating it.
	it("is not what a press on the bar itself means", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.tiebar);
		expect(handlers.onPickNone).not.toHaveBeenCalled();
		expect(handlers.onPickEdge).not.toHaveBeenCalled();
		teardown();
	});
});

// THE MOUSE'S ROUTE TO TAKING SOMEBODY OFF, which for a long time did not exist: it was Delete on
// a focused portrait and nothing else, a gesture with nothing on screen to say it was there. A
// right press on a face asks for that person's trash can; the button is the thing that removes.
//
// ⚠ THE RIGHT BUTTON IS ALSO THE PAN, from anywhere on the board and deliberately so
// (utils/zoom-pan-surface.js: a press aimed at open paper lands on one of a hundred lines, so the
// right button asks nothing about what is under it). The two share the gesture, and what separates
// them is TRAVEL — which is why every case here is a pair.
describe("a right press on a portrait", () => {
	let board;
	beforeEach(() => {
		board = pointerBoard();
		board.view.setPointerCapture = vi.fn();
		board.view.releasePointerCapture = vi.fn();
	});
	afterEach(() => board.destroy());

	/**
	 * A right press and its release, in the shape a real browser delivers under the pan's capture.
	 *
	 * The release is emitted at the VIEWPORT rather than at the face, which is the whole reason the
	 * production code remembers who was pressed at pointerdown: by the time the pointerup arrives
	 * the pan surface has captured the pointer, and the capture retargets it. Reading the person off
	 * the release would find nobody, every time, in every real browser and in no test written the
	 * easy way. (The same trap `pressUnderCapture` above was written to stop repeating.)
	 */
	const rightPress = (target, { to = [0, 0] } = {}) => {
		board.view.emit("pointerdown", target, { button: 2, pointerId: 1, clientX: 0, clientY: 0 });
		board.view.emit("pointerup", board.view, { button: 2, pointerId: 1, clientX: to[0], clientY: to[1] });
	};

	it("asks for that person's trash can", () => {
		const { handlers, teardown } = wire(board);
		rightPress(board.portraits.n1.face);
		expect(handlers.onArm).toHaveBeenCalledWith("n1");
		teardown();
	});

	// The name under the face is part of the node, and a reader aiming at a small circle very often
	// hits the words instead. `closest` walks up to the portrait from either.
	it("takes the name under the face as the same person", () => {
		const { handlers, teardown } = wire(board);
		rightPress(board.portraits.n2.name);
		expect(handlers.onArm).toHaveBeenCalledWith("n2");
		teardown();
	});

	// AND A RIGHT DRAG IS A PAN, even one that began on somebody's face. Without this the gesture
	// a reader makes most — shoving the board about to see the rest of it — would leave a delete
	// button open on whoever happened to be under the hand when they started.
	it("is a pan and nothing else once it travels", () => {
		const { handlers, teardown } = wire(board);
		rightPress(board.portraits.n1.face, { to: [80, 40] });
		expect(handlers.onArm).not.toHaveBeenCalled();
		teardown();
	});

	// ⚠ AND A PRESS MADE TO STOP A SLIDING BOARD IS NOT THE READER POINTING AT ANYBODY. The right
	// button catches a glide exactly as the left one does (utils/zoom-pan-surface.js), and a press
	// that meant "stop" stayed put by definition -- so read as this gesture it arms a delete button
	// on whichever portrait happened to be gliding under the cursor at that instant, which is a
	// person the reader never aimed at and very often one they have never looked at. The surface's
	// own click swallow rules the mirror image of this out for the left button.
	it("arms nobody from a press that was only stopping the board", () => {
		const { handlers, teardown } = wire(board, { surface: fakeSurface({ caughtGlide: true }) });
		rightPress(board.portraits.n1.face);
		expect(handlers.onArm).not.toHaveBeenCalled();
		teardown();
	});

	// Nothing on a board this reader may only look at: the trash can is not printed for them, so
	// arming one would be a press that promises a button nobody will ever see.
	it("asks for nothing where the removal would be refused", () => {
		const { handlers, teardown } = wire(board, { canRemove: () => false });
		rightPress(board.portraits.n1.face);
		expect(handlers.onArm).not.toHaveBeenCalled();
		teardown();
	});

	// Bare paper, a caption, the bar: a right press anywhere but a portrait is only ever the pan.
	it("arms nobody from a press that landed on no one", () => {
		const { handlers, teardown } = wire(board);
		rightPress(board.board);
		rightPress(board.captions.e1.words);
		expect(handlers.onArm).not.toHaveBeenCalled();
		teardown();
	});

	// ⚠ AND IT ARMS NO DRAG. The left button is what picks a portrait up; a right press that also
	// did would leave two gestures fighting over one pointer, and the pan would slide the board out
	// from under the portrait it was moving.
	it("does not pick the portrait up", () => {
		const { handlers, teardown } = wire(board);
		board.view.emit("pointerdown", board.portraits.n1.face, { button: 2, clientX: 0, clientY: 0 });
		board.view.emit("pointermove", board.portraits.n1.face, { clientX: 40, clientY: 0 });
		board.flush();
		expect(board.view.setPointerCapture).not.toHaveBeenCalled();
		expect(handlers.onDragMove).not.toHaveBeenCalled();
		teardown();
	});

	// A press the system took away never finished. Left set, its note would arm a trash can on the
	// NEXT release anywhere on the board, on somebody the reader never pointed at.
	it("forgets a press that was cancelled", () => {
		const { handlers, teardown } = wire(board);
		board.view.emit("pointerdown", board.portraits.n1.face, { button: 2, pointerId: 1, clientX: 0, clientY: 0 });
		board.view.emit("pointercancel", board.view, { pointerId: 1 });
		board.view.emit("pointerup", board.view, { button: 2, pointerId: 1, clientX: 0, clientY: 0 });
		expect(handlers.onArm).not.toHaveBeenCalled();
		teardown();
	});
});

// THE TRASH CAN ITSELF, once a right press has put one on somebody.
describe("the trash can on a portrait", () => {
	let board;
	beforeEach(() => {
		board = pointerBoard();
		board.view.setPointerCapture = vi.fn();
		board.view.releasePointerCapture = vi.fn();
	});
	afterEach(() => board.destroy());

	it("takes that person off, and does not open their sheet on the way", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.portraits.n1.bin);
		expect(handlers.onRemove).toHaveBeenCalledWith("n1");
		expect(handlers.onOpen).not.toHaveBeenCalled();
		teardown();
	});

	// ⚠ AND IT IS THE ONE PRESS THAT DOES NOT ALSO PUT THE CAN AWAY. Every other click on this
	// board does, which is how the button closes; disarming on this one would be the window
	// clearing the mark in the same breath as the removal it is about.
	it("is not also a click that puts itself away", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.portraits.n1.bin);
		expect(handlers.onArm).not.toHaveBeenCalled();
		teardown();
	});

	// EVERY OTHER CLICK CLOSES IT. A control that appears on a gesture has to disappear on the next
	// thing the reader does, or a board clicked around for an evening wears a delete button on half
	// the people on it.
	const AWAY = [
		["a face", b => b.portraits.n1.face],
		["bare board", b => b.board],
		["a caption", b => b.captions.e1.words],
		["the link handle", b => b.portraits.n1.handle],
	];
	for (const [what, pick] of AWAY) {
		it(`is put away by a click on ${what}`, () => {
			const { handlers, teardown } = wire(board);
			press(board, pick(board));
			expect(handlers.onArm).toHaveBeenCalledWith(null);
			teardown();
		});
	}

	// ⚠ THE PRESS ON IT MUST NOT ARM A DRAG OF THE PERSON IT IS ABOUT. The can sits INSIDE the
	// node, so without a guard a hand that shifts three pixels between press and release carries
	// that portrait across the board instead — and the click the button was waiting for is eaten as
	// the tail of a drag.
	it("does not pick the portrait up, and keeps its own click", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.portraits.n1.bin, { to: [40, 0] });
		expect(handlers.onMove).not.toHaveBeenCalled();
		expect(board.view.setPointerCapture).not.toHaveBeenCalled();
		expect(handlers.onRemove).toHaveBeenCalledWith("n1");
		teardown();
	});

	it("removes nobody on a board the reader may not edit", () => {
		const { handlers, teardown } = wire(board, { canRemove: () => false });
		press(board, board.portraits.n1.bin);
		expect(handlers.onRemove).not.toHaveBeenCalled();
		teardown();
	});
});

// thing a real button gave for free has to be handed to it here.
describe("a caption, which is a button only by manners", () => {
	let board;
	beforeEach(() => {
		board = pointerBoard();
		board.view.setPointerCapture = vi.fn();
		board.view.releasePointerCapture = vi.fn();
	});
	afterEach(() => board.destroy());

	it("takes hold of its link when the words are clicked", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.captions.e1.words);
		expect(handlers.onPickEdge).toHaveBeenCalledWith("e1");
		teardown();
	});

	// ⚠ THE ONE A REAL BUTTON WOULD HAVE GIVEN FOR FREE. Without this the board is unusable from a
	// keyboard: a caption can be tabbed to and then does nothing at all.
	for (const key of ["Enter", " "]) {
		it(`takes hold of its link on ${key === " " ? "Space" : key}`, () => {
			const { handlers, teardown } = wire(board);
			const ev = board.view.emit("keydown", board.captions.e1.words, { key });
			// ⚠ AND HANDS BACK THE ELEMENT IT CAME FROM. A reader who pressed Enter on a caption and
			// then dismissed the bar with Escape has to be put back on that caption; the bar cannot
			// work out where they came from, so the gesture that raised it has to say.
			expect(handlers.onPickEdge).toHaveBeenCalledWith("e1", board.captions.e1.words);
			expect(ev.defaultPrevented).toBe(true);
			teardown();
		});
	}

	// stopPropagation as well as preventDefault, for the reason every other key on this board does
	// it: core's KeyboardManager is listening behind the window.
	it("keeps the key away from the scene behind the window", () => {
		const { teardown } = wire(board);
		const ev = board.view.emit("keydown", board.captions.e1.words, { key: "Enter" });
		expect(ev.propagationStopped).toBe(true);
		teardown();
	});

	it("does nothing on a board this reader may not edit", () => {
		const { handlers, teardown } = wire(board, { canEdit: () => false });
		board.view.emit("keydown", board.captions.e1.words, { key: "Enter" });
		press(board, board.captions.e1.words);
		expect(handlers.onPickEdge).not.toHaveBeenCalled();
		teardown();
	});

	// A key pressed anywhere else on the board is still the board's own business: the arrow keys
	// nudge a portrait, and Enter on a handle asks who to link to.
	it("leaves every other key where it was going", () => {
		const { handlers, teardown } = wire(board);
		board.view.emit("keydown", board.captions.e1.words, { key: "ArrowLeft" });
		expect(handlers.onNudge).not.toHaveBeenCalled();
		expect(handlers.onPickEdge).not.toHaveBeenCalled();
		teardown();
	});
});

// ⚠ A KEY THIS BOARD REFUSES IS NOT A KEY IT IGNORES.
//
// Core's KeyboardManager binds keydown in the BUBBLE phase and never looks at `defaultPrevented`,
// so every `return` taken before `stopPropagation` hands the press on to the scene behind this
// window. Delete there is bound to deleting the SELECTED PLACEABLES, with no confirmation. That
// makes the refusals this board makes -- a reader who may not edit, and the views that place their
// own portraits and so may not be rearranged or removed from -- the exact cases where the key must
// be swallowed hardest, which is the opposite of how they were first written.
describe("a key the board refuses", () => {
	let board;
	beforeEach(() => { board = pointerBoard(); });
	afterEach(() => board.destroy());

	const REFUSALS = [
		["a reader who may not edit", { canEdit: () => false }],
		["a view that places its own portraits", { canMove: () => false, canRemove: () => false }],
	];

	for (const [who, over] of REFUSALS) {
		for (const key of ["Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
			it(`keeps ${key} away from the scene for ${who}`, () => {
				const { handlers, teardown } = wire(board, over);
				const ev = board.view.emit("keydown", board.portraits.n1.face, { key });
				expect(ev.defaultPrevented).toBe(true);
				expect(ev.propagationStopped).toBe(true);
				// And it still did nothing to the map.
				expect(handlers.onRemove).not.toHaveBeenCalled();
				expect(handlers.onNudge).not.toHaveBeenCalled();
				teardown();
			});
		}
	}

	// Taking somebody off the map is its OWN question, asked separately from moving them: on a view
	// that seats itself, Delete would otherwise be the one writing gesture the keyboard still offered
	// -- and the destructive one.
	it("still removes somebody on a board the reader may rearrange", () => {
		const { handlers, teardown } = wire(board);
		board.view.emit("keydown", board.portraits.n1.face, { key: "Delete" });
		expect(handlers.onRemove).toHaveBeenCalledWith("n1");
		teardown();
	});

	it("refuses the delete but keeps the nudge, and the other way about", () => {
		const noRemove = wire(board, { canRemove: () => false });
		board.view.emit("keydown", board.portraits.n1.face, { key: "Delete" });
		board.view.emit("keydown", board.portraits.n1.face, { key: "ArrowLeft" });
		expect(noRemove.handlers.onRemove).not.toHaveBeenCalled();
		expect(noRemove.handlers.onNudge).toHaveBeenCalled();
		noRemove.teardown();

		const noMove = wire(board, { canMove: () => false });
		board.view.emit("keydown", board.portraits.n1.face, { key: "Delete" });
		board.view.emit("keydown", board.portraits.n1.face, { key: "ArrowLeft" });
		expect(noMove.handlers.onRemove).toHaveBeenCalledWith("n1");
		expect(noMove.handlers.onNudge).not.toHaveBeenCalled();
		noMove.teardown();
	});

	// A key this board has no use for is not this board's to swallow: the reader may be trying to
	// type into something else, or to reach one of core's own shortcuts.
	it("lets a key it has no use for go where it was going", () => {
		const { teardown } = wire(board);
		const ev = board.view.emit("keydown", board.portraits.n1.face, { key: "k" });
		expect(ev.defaultPrevented).toBe(false);
		expect(ev.propagationStopped).toBe(false);
		teardown();
	});

	// \u26a0 EVERY TAB STOP ON THE BOARD, not just the portrait. A person carries TWO of them -- the
	// face and, right beside it as a SIBLING, the link handle -- and every caption is a third. The
	// first version of this guard was anchored on the face alone, so a reader tabbing the board
	// alternated between a stop that swallowed Delete and one that handed it to the scene.
	const STOPS = [
		["the link handle", b => b.portraits.n1.handle],
		["a caption", b => b.captions.e1.words],
	];
	for (const [what, pick] of STOPS) {
		for (const key of ["Delete", "ArrowLeft"]) {
			it(`keeps ${key} away from the scene from ${what} too`, () => {
				const { handlers, teardown } = wire(board);
				const ev = board.view.emit("keydown", pick(board), { key });
				expect(ev.defaultPrevented).toBe(true);
				expect(ev.propagationStopped).toBe(true);
				// Claimed on the board's behalf and then dropped: neither of these is a portrait,
				// so there is nothing for the key to do.
				expect(handlers.onRemove).not.toHaveBeenCalled();
				expect(handlers.onNudge).not.toHaveBeenCalled();
				teardown();
			});
		}
	}

	// ⚠ THE NEWEST TAB STOP, AND THE ONLY ONE WHERE THE KEY MEANS SOMETHING. A button that says
	// "take them off" is the button a reader will press Delete on, and it is the one place on this
	// board where that key means exactly what the control under it means. It carries no
	// `data-relmap-open` -- it is a SIBLING of the face, not a descendant -- so it has to be read
	// off the can itself, and swallowing the key without acting on it (which is what the board did
	// at first) is the shape a reader cannot tell from the board being broken.
	it("takes somebody off the map from Delete on their trash can", () => {
		const { handlers, teardown } = wire(board);
		const ev = board.view.emit("keydown", board.portraits.n1.bin, { key: "Delete" });
		expect(ev.defaultPrevented).toBe(true);
		expect(ev.propagationStopped).toBe(true);
		expect(handlers.onRemove).toHaveBeenCalledWith("n1");
		teardown();
	});

	// It answers to the removal's own question and not to `canEdit`, exactly as the click on the
	// same button does: a board that places its own portraits offers no way to take one off.
	it("refuses Delete on the trash can where the board may not be rearranged", () => {
		const { handlers, teardown } = wire(board, { canRemove: () => false });
		const ev = board.view.emit("keydown", board.portraits.n1.bin, { key: "Delete" });
		// STILL SWALLOWED. A refusal here must never mean "the scene behind this window gets it".
		expect(ev.defaultPrevented).toBe(true);
		expect(ev.propagationStopped).toBe(true);
		expect(handlers.onRemove).not.toHaveBeenCalled();
		teardown();
	});

	// An arrow on the can is claimed and dropped: the can is not a portrait, and nudging the person
	// it is about from a button that means "remove them" would be a second gesture on one control.
	it("claims an arrow on the trash can and does nothing with it", () => {
		const { handlers, teardown } = wire(board);
		const ev = board.view.emit("keydown", board.portraits.n1.bin, { key: "ArrowLeft" });
		expect(ev.defaultPrevented).toBe(true);
		expect(ev.propagationStopped).toBe(true);
		expect(handlers.onRemove).not.toHaveBeenCalled();
		expect(handlers.onNudge).not.toHaveBeenCalled();
		teardown();
	});

	// And nothing off the board at all is still nothing to do with this handler.
	it("leaves a key pressed on the bare viewport alone", () => {
		const { teardown } = wire(board);
		const ev = board.view.emit("keydown", board.view, { key: "Delete" });
		expect(ev.defaultPrevented).toBe(false);
		expect(ev.propagationStopped).toBe(false);
		teardown();
	});
});
