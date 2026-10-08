import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Escape-to-cancel is ONE slot for the whole page, and every board that drags arms and disarms it: the
// standings boards, the map window and the steading sheet's map panel. These drive it through the
// capture listener it puts on `window`, which is wired lazily on the first drag and so needs a fresh
// copy of the module per test.

let keydown;

beforeEach(() => {
	vi.resetModules();
	keydown = null;
	globalThis.window = { addEventListener: (type, fn) => { if (type === "keydown") keydown = fn; } };
});

afterEach(() => {
	delete globalThis.window;
});

const load = () => import("../../module/utils/relationship-board.js");

function escape(target = null) {
	const ev = {
		key: "Escape", target, defaultPrevented: false, stopped: false,
		preventDefault() { ev.defaultPrevented = true; },
		stopPropagation() { ev.stopped = true; },
	};
	keydown?.(ev);
	return ev;
}

describe("Escape during a drag", () => {
	it("cancels the drag that is live, and swallows the key", async () => {
		const { beginCancellableDrag } = await load();
		const cancel = vi.fn();
		beginCancellableDrag(cancel);
		const ev = escape();
		expect(cancel).toHaveBeenCalledTimes(1);
		expect(ev.stopped).toBe(true);
	});

	it("lets the key go once that drag has ended", async () => {
		const { beginCancellableDrag, endCancellableDrag } = await load();
		const cancel = vi.fn();
		beginCancellableDrag(cancel);
		endCancellableDrag(cancel);
		const ev = escape();
		expect(cancel).not.toHaveBeenCalled();
		expect(ev.stopped).toBe(false);
	});

	// Two boards open: the second re-renders, its teardown runs its exit, and the drag still under way
	// on the first must keep its Escape. Lost, the key reaches core's dismiss.
	it("is not disarmed by another board's exit", async () => {
		const { beginCancellableDrag, endCancellableDrag } = await load();
		const mine = vi.fn();
		beginCancellableDrag(mine);
		endCancellableDrag(() => {});
		escape();
		expect(mine).toHaveBeenCalledTimes(1);
	});

	// A drag started while a "Draw lines" pick holds Escape, then ended: the pick must have it back.
	it("hands Escape back to the gesture under a drag that has ended", async () => {
		const { beginCancellableDrag, endCancellableDrag } = await load();
		const pick = vi.fn();
		const drag = vi.fn();
		beginCancellableDrag(pick);
		beginCancellableDrag(drag);
		endCancellableDrag(drag);
		const ev = escape();
		expect(drag).not.toHaveBeenCalled();
		expect(pick).toHaveBeenCalledTimes(1);
		expect(ev.stopped).toBe(true);
	});

	it("cancels only the latest gesture, once", async () => {
		const { beginCancellableDrag } = await load();
		const pick = vi.fn();
		const drag = vi.fn();
		beginCancellableDrag(pick);
		beginCancellableDrag(drag);
		escape();
		expect(drag).toHaveBeenCalledTimes(1);
		expect(pick).not.toHaveBeenCalled();
		escape();
		expect(pick).toHaveBeenCalledTimes(1);
	});

	// A pick holds Escape with no button down; one pressed in another window is that window's.
	it("lets an Escape go by that the gesture does not claim", async () => {
		const { beginCancellableDrag } = await load();
		const pick = vi.fn();
		const elsewhere = {};
		beginCancellableDrag(pick, { owns: ev => ev.target !== elsewhere });
		const ev = escape(elsewhere);
		expect(pick).not.toHaveBeenCalled();
		expect(ev.stopped).toBe(false);
		escape();
		expect(pick).toHaveBeenCalledTimes(1);
	});
});
