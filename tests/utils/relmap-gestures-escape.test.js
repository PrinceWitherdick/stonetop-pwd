import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ESCAPE ON THE MAP BOARD, driven through the page's one capture-phase watcher (relationship-board.js),
// which is wired lazily on `window` the first time a gesture claims the key. So each test loads fresh
// copies of the modules with a `window` stand-in in place, as tests/utils/cancellable-drag.test.js does.
//
// AUDIT 2026-11-03 (/fix-all): Escape was the drag's only once it had travelled, so an Escape with the
// button down and the hand still went on to core and closed the window; and the click the button still
// owed after an Escape landed on bare paper, letting go of the selection and the pick.

let keydown;
let board;
let fakes;

beforeEach(async () => {
	vi.resetModules();
	keydown = null;
	globalThis.window = { addEventListener: (type, fn) => { if (type === "keydown") keydown = fn; } };
	fakes = await import("../fakes/pointer-board.js");
	board = fakes.pointerBoard();
	board.view.setPointerCapture = vi.fn();
	board.view.releasePointerCapture = vi.fn();
});

afterEach(() => {
	board.destroy();
	delete globalThis.window;
});

function escape() {
	const ev = {
		key: "Escape", target: null, defaultPrevented: false, stopped: false,
		preventDefault() { ev.defaultPrevented = true; },
		stopPropagation() { ev.stopped = true; },
	};
	keydown?.(ev);
	return ev;
}

describe("Escape with the button still down", () => {
	it("is claimed by a press that has not travelled yet", () => {
		const { handlers, teardown } = fakes.wireBoard(board);
		const face = board.portraits.n1.face;
		board.view.emit("pointerdown", face, { pointerId: 1, clientX: 0, clientY: 0 });
		const ev = escape();
		expect(ev.stopped).toBe(true);
		// Let go where it was pressed: the press was called off, so it opens and picks nothing.
		board.view.emit("pointerup", face, { pointerId: 1, clientX: 0, clientY: 0 });
		board.view.emit("click", face, { pointerId: 1, detail: 0 });
		expect(handlers.onOpen).not.toHaveBeenCalled();
		teardown();
	});

	it("eats the click the release still makes after a drag is called off", () => {
		const onSelect = vi.fn();
		const { handlers, teardown } = fakes.wireBoard(board, { selected: () => ["n2"], onSelect });
		const face = board.portraits.n1.face;
		board.view.emit("pointerdown", face, { pointerId: 1, clientX: 0, clientY: 0 });
		board.view.emit("pointermove", face, { pointerId: 1, clientX: 40, clientY: 0 });
		board.flush();
		expect(escape().stopped).toBe(true);
		expect(handlers.onMove).not.toHaveBeenCalled();
		// The release lands somewhere else, so its click lands on what the two share: the board.
		board.view.emit("pointerup", board.board, { pointerId: 1, clientX: 40, clientY: 0 });
		board.view.emit("click", board.board, { pointerId: 1, detail: 1 });
		expect(handlers.onPickNone).not.toHaveBeenCalled();
		expect(onSelect).not.toHaveBeenCalledWith([], expect.anything());
		teardown();
	});

	it("leaves nothing standing for the next real click when no click came", () => {
		const { handlers, teardown } = fakes.wireBoard(board);
		const face = board.portraits.n1.face;
		board.view.emit("pointerdown", face, { pointerId: 1, clientX: 0, clientY: 0 });
		escape();
		// The next press clears the swallow nobody used, so its own click is heard.
		board.view.emit("pointerdown", face, { pointerId: 1, clientX: 0, clientY: 0 });
		board.view.emit("pointerup", face, { pointerId: 1, clientX: 0, clientY: 0 });
		board.view.emit("click", face, { pointerId: 1, detail: 0 });
		expect(handlers.onOpen).toHaveBeenCalledWith("n1");
		teardown();
	});
});
