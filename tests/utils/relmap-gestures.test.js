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
		onPickNone: vi.fn(), onRemove: vi.fn(),
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

	// And nothing off the board at all is still nothing to do with this handler.
	it("leaves a key pressed on the bare viewport alone", () => {
		const { teardown } = wire(board);
		const ev = board.view.emit("keydown", board.view, { key: "Delete" });
		expect(ev.defaultPrevented).toBe(false);
		expect(ev.propagationStopped).toBe(false);
		teardown();
	});
});
