import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireRelmapDrag } from "../../module/utils/relmap-drag.js";
import { fakeSurface, pointerBoard } from "../fakes/pointer-board.js";

// The LISTENER PLUMBING on a relationship map, as opposed to the arithmetic behind it, which
// relmap-drag.test.js measures. Its own file because it needs a DOM stand-in and a set of globals
// that the arithmetic tests are better off without.
//
// WHAT THIS IS ACTUALLY FOR. The board's two non-drag routes — click a portrait to open its sheet,
// click the handle to be asked who to link to — were dead, and dead in a way no manual pass in the
// default state would find: a locked board never arms a drag at all, so the bug only existed once
// the reader unlocked the board, which is the state they do everything else in. The cause was one
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
		onLink: vi.fn(), onLinkFrom: vi.fn(), onOpen: vi.fn(), onEditEdge: vi.fn(), onRemove: vi.fn(),
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
		board.view.emit("pointerdown", board.portraits.n1, { clientX: 0, clientY: 0 });
		expect(board.view.setPointerCapture).not.toHaveBeenCalled();
		teardown();
	});

	it("opens the portrait it was made on", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.portraits.n1);
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
		press(board, board.portraits.n1, { to: [2, 1] });
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
		board.view.emit("pointerdown", board.portraits.n1, { clientX: 0, clientY: 0 });
		expect(board.view.setPointerCapture).not.toHaveBeenCalled();
		board.view.emit("pointermove", board.portraits.n1, { clientX: 40, clientY: 0 });
		expect(board.view.setPointerCapture).toHaveBeenCalledWith(1);
		teardown();
	});

	it("writes the move it was, and does not also open the sheet", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.portraits.n1, { to: [40, 0] });
		expect(handlers.onMove).toHaveBeenCalledWith("n1", { x: 24, y: 30 });
		expect(handlers.onOpen).not.toHaveBeenCalled();
		teardown();
	});

	// The click after a drag is swallowed by a flag rather than by the capture's retargeting, so
	// that exactly ONE click is eaten. A flag that stayed armed would eat the reader's next real
	// press, which is the same class of dead-click bug in the other direction.
	it("swallows one click and no more", () => {
		const { handlers, teardown } = wire(board);
		press(board, board.portraits.n1, { to: [40, 0] });
		expect(handlers.onOpen).not.toHaveBeenCalled();
		board.view.emit("click", board.portraits.n1);
		expect(handlers.onOpen).toHaveBeenCalledWith("n1");
		teardown();
	});

	// An Escape or a lost pointer ends the drag with no click to follow, so nothing may be left
	// armed: the flag is set by the RELEASE, which is the only exit a click comes after.
	it("leaves nothing armed when the drag is cancelled instead of released", () => {
		const { handlers, teardown } = wire(board);
		board.view.emit("pointerdown", board.portraits.n1, { clientX: 0, clientY: 0 });
		board.view.emit("pointermove", board.portraits.n1, { clientX: 40, clientY: 0 });
		board.view.emit("pointercancel", board.portraits.n1, {});
		press(board, board.portraits.n1);
		expect(handlers.onOpen).toHaveBeenCalledWith("n1");
		teardown();
	});

	it("drops a line onto the portrait under the cursor", () => {
		const { handlers, teardown } = wire(board);
		board.setHits([board.portraits.n2]);
		press(board, board.portraits.n1.handle, { to: [40, 0] });
		expect(handlers.onLink).toHaveBeenCalledWith("n1", "n2");
		expect(handlers.onLinkFrom).not.toHaveBeenCalled();
		teardown();
	});
});

describe("a locked board", () => {
	let board;
	beforeEach(() => {
		board = pointerBoard();
		board.view.setPointerCapture = vi.fn();
		board.view.releasePointerCapture = vi.fn();
	});
	afterEach(() => board.destroy());

	// Reading is not editing, but it is not nothing either: a locked board still opens sheets.
	// This is also the state the original bug HID in — a locked board arms no drag, so it captured
	// no pointer and its clicks worked, which is why the default view looked fine.
	it("still opens a portrait, while moving nothing", () => {
		const { handlers, teardown } = wire(board, { canEdit: () => false });
		press(board, board.portraits.n1, { to: [40, 0] });
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
