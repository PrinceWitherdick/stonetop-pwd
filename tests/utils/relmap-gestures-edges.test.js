import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardEl, fakeSurface, pointerBoard, wireBoard as wire } from "../fakes/pointer-board.js";

// THE EDGES OF A GESTURE: what happens when something outside the board gets involved mid-press. The
// wheel zooming the board under a carried portrait, a release that lands just past the viewport, a
// window laid over the board where a line is let go, and the keys core wants for itself. Each of these
// used to leave the board doing something the reader did not ask for.

let board;
beforeEach(() => {
	board = pointerBoard();
	board.view.setPointerCapture = vi.fn();
	board.view.releasePointerCapture = vi.fn();
});
afterEach(() => board.destroy());

describe("a portrait carried while the board is zoomed", () => {
	// Pressed 10% in, carried 100 pixels, then the board zoomed in and slid under the cursor: the
	// pointer is now over 7.5% of the board, 2.5% short of where it was pressed. Screen travel converted
	// at the new scale said 5% the other way.
	it("lands under the cursor, not where the screen travel says", () => {
		const surface = fakeSurface();
		const { handlers, teardown } = wire(board, { surface });
		const face = board.portraits.n1.face;
		board.view.emit("pointerdown", face, { clientX: 100, clientY: 0 });
		board.view.emit("pointermove", face, { clientX: 200, clientY: 0 });
		board.flush();
		surface.per = 20;
		surface.off = 50;
		board.view.emit("pointerup", face, { clientX: 200, clientY: 0 });
		expect(handlers.onMove).toHaveBeenCalledWith("n1", { x: 17.5, y: 30 });
		teardown();
	});
});

describe("a press let go of somewhere the board never heard", () => {
	// Nothing is captured while a press is only armed, so a release just past the viewport arrives
	// elsewhere. The next move is made with no button held, and that is how the board learns of it.
	it("is forgotten on the first move made with no button held", () => {
		const { handlers, teardown } = wire(board);
		const face = board.portraits.n1.face;
		board.view.emit("pointerdown", face, { clientX: 0, clientY: 0 });
		board.view.emit("pointermove", face, { clientX: 1, clientY: 0, buttons: 0 });
		board.view.emit("pointermove", face, { clientX: 60, clientY: 0, buttons: 0 });
		board.flush();
		board.view.emit("pointerup", face, { clientX: 60, clientY: 0 });
		expect(handlers.onDragMove).not.toHaveBeenCalled();
		expect(handlers.onMove).not.toHaveBeenCalled();
		teardown();
	});
});

describe("a line let go of over something laid on top of the board", () => {
	it("draws no line to a portrait hidden underneath another window", () => {
		const { handlers, teardown } = wire(board);
		const handle = board.portraits.n1.handle;
		// Another window, which is nowhere inside this board, sitting over portrait n2.
		const sheet = boardEl({ cls: ["window-app"] });
		board.view.emit("pointerdown", handle, { clientX: 0, clientY: 0 });
		board.view.emit("pointermove", handle, { clientX: 40, clientY: 0 });
		board.flush();
		board.setHits([sheet, board.portraits.n2.face]);
		board.view.emit("pointerup", handle, { clientX: 40, clientY: 0 });
		expect(handlers.onLink).not.toHaveBeenCalled();
		teardown();
	});

	it("still draws one to a portrait the reader can see", () => {
		const { handlers, teardown } = wire(board);
		const handle = board.portraits.n1.handle;
		board.view.emit("pointerdown", handle, { clientX: 0, clientY: 0 });
		board.view.emit("pointermove", handle, { clientX: 40, clientY: 0 });
		board.flush();
		board.setHits([board.portraits.n2.face]);
		board.view.emit("pointerup", handle, { clientX: 40, clientY: 0 });
		expect(handlers.onLink).toHaveBeenCalledWith("n1", "n2");
		teardown();
	});
});

// ⚠ SPACE IS CORE'S PAUSE KEY, and core does not count a button outside a form as having the focus. A
// GM who tabbed to a face and pressed Space to open the sheet paused the game for the whole table.
describe("Enter and Space on a portrait's own buttons", () => {
	const BUTTONS = [
		["the face", b => b.portraits.n1.face],
		["the link handle", b => b.portraits.n1.handle],
		["the trash can", b => b.portraits.n1.bin],
		["the label under the name", b => b.portraits.n1.subtitle],
	];
	for (const [what, pick] of BUTTONS) {
		for (const key of ["Enter", " "]) {
			it(`keeps ${key === " " ? "Space" : key} on ${what} from the scene, and lets the button have it`, () => {
				const { handlers, teardown } = wire(board);
				const ev = board.view.emit("keydown", pick(board), { key });
				expect(ev.propagationStopped).toBe(true);
				// Not prevented: the button's own activation is what turns the key into its click.
				expect(ev.defaultPrevented).toBe(false);
				expect(handlers.onRemove).not.toHaveBeenCalled();
				expect(handlers.onNudge).not.toHaveBeenCalled();
				teardown();
			});
		}
	}
});
