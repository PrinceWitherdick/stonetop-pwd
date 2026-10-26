import { describe, it, expect, beforeEach, vi } from "vitest";
import { openOrFocus } from "../../module/utils/open-or-focus.js";

// Opening a window that may already be open. The case that matters most is the one core cannot see: a
// window minted a moment ago whose first render is still awaiting something of its own, which is not in
// `ui.windows` and not `rendered` yet. Every test uses its own id, because the module remembers what it
// minted for the length of the file.

const STATES = Application.RENDER_STATES;

class Win extends Application {
	constructor(id, state = STATES.NONE) {
		super();
		this.id = id;
		this._state = state;
		this.bringToTop = vi.fn();
		this.maximize = vi.fn();
	}

	get rendered() { return this._state === STATES.RENDERED; }
}

beforeEach(() => {
	globalThis.ui = { ...globalThis.ui, windows: {} };
});

describe("opening a window that may already be open", () => {
	it("brings the open one to the front instead of opening a second", () => {
		const shown = new Win("front", STATES.RENDERED);
		ui.windows[1] = shown;
		const open = vi.fn();
		expect(openOrFocus("front", open)).toBe(shown);
		expect(open).not.toHaveBeenCalled();
		expect(shown.bringToTop).toHaveBeenCalledTimes(1);
	});

	it("opens one when none is showing", () => {
		const made = new Win("fresh");
		const open = vi.fn(() => made);
		expect(openOrFocus("fresh", open)).toBe(made);
		expect(open).toHaveBeenCalledTimes(1);
	});

	// A double click on the macro: the first window is still inside its own render -- seating the party
	// and the village -- when the second asks, nowhere in `ui.windows`, and not rendered.
	it("hands back the window still opening rather than minting a second with the same id", () => {
		const open = vi.fn(() => new Win("twice"));
		const first = openOrFocus("twice", open);
		first._state = STATES.RENDERING;
		expect(openOrFocus("twice", open)).toBe(first);
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("opens afresh once the window it minted has closed", () => {
		const open = vi.fn(() => new Win("again"));
		const first = openOrFocus("again", open);
		first._state = STATES.CLOSED;
		expect(openOrFocus("again", open)).not.toBe(first);
		expect(open).toHaveBeenCalledTimes(2);
	});

	it("opens afresh once the window it minted has failed to render", () => {
		const open = vi.fn(() => new Win("broken"));
		const first = openOrFocus("broken", open);
		first._state = STATES.ERROR;
		expect(openOrFocus("broken", open)).not.toBe(first);
	});

	// A sheet the reader may not view warns and returns from its render without drawing anything, which
	// looks exactly like a window still waiting to draw. Held for ever, every later press would hand back
	// that dead window, and nothing would open until a reload.
	it("opens afresh once a window it minted has sat undrawn for longer than any window waits", () => {
		vi.useFakeTimers();
		try {
			const open = vi.fn(() => new Win("stuck"));
			const first = openOrFocus("stuck", open);
			vi.advanceTimersByTime(2000);
			expect(openOrFocus("stuck", open)).toBe(first);
			vi.advanceTimersByTime(60000);
			expect(openOrFocus("stuck", open)).not.toBe(first);
			expect(open).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("still hands back a window part-way through drawing, however long the draw takes", () => {
		vi.useFakeTimers();
		try {
			const open = vi.fn(() => new Win("slow"));
			const first = openOrFocus("slow", open);
			first._state = STATES.RENDERING;
			vi.advanceTimersByTime(60000);
			expect(openOrFocus("slow", open)).toBe(first);
			expect(open).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	// An opener that reads its data before minting (the level-up window): a second press during the read
	// gets the same promise, not a second read and a second window.
	it("hands back an async opener's promise while it is still awaiting", async () => {
		let resolve;
		const win = new Win("async-wait", STATES.RENDERING);
		const open = vi.fn(() => new Promise(r => { resolve = r; }));
		const first = openOrFocus("async-wait", open);
		expect(openOrFocus("async-wait", open)).toBe(first);
		resolve(win);
		expect(await first).toBe(win);
		// The window it resolved to is still drawing, so it is the one handed back now.
		expect(openOrFocus("async-wait", open)).toBe(win);
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("forgets an async opener that failed, so the next press tries again", async () => {
		const open = vi.fn().mockRejectedValueOnce(new Error("read failed")).mockResolvedValue(null);
		await expect(openOrFocus("async-fail", open)).rejects.toThrow("read failed");
		await openOrFocus("async-fail", open);
		expect(open).toHaveBeenCalledTimes(2);
	});

	// An opener whose read hangs (a pack that never answers) must not leave the button dead until a reload.
	it("lets go of an async opener that never settles, after a while", () => {
		vi.useFakeTimers();
		try {
			const open = vi.fn(() => new Promise(() => {}));
			const first = openOrFocus("async-hang", open);
			vi.advanceTimersByTime(5000);
			expect(openOrFocus("async-hang", open)).toBe(first);
			vi.advanceTimersByTime(30000);
			expect(openOrFocus("async-hang", open)).not.toBe(first);
			expect(open).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("opens again for an async opener that settled with no window", async () => {
		const open = vi.fn(() => Promise.resolve(null));
		await openOrFocus("async", open);
		await openOrFocus("async", open);
		expect(open).toHaveBeenCalledTimes(2);
	});

	// Raised and left collapsed, the press looks like it did nothing at all.
	it("restores a minimized window as well as raising it", () => {
		const shown = new Win("small", STATES.RENDERED);
		shown._minimized = true;
		ui.windows[2] = shown;
		openOrFocus("small", vi.fn());
		expect(shown.maximize).toHaveBeenCalledTimes(1);
		expect(shown.bringToTop).toHaveBeenCalledTimes(1);
	});
});
