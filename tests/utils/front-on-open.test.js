import { describe, it, expect, beforeEach, vi } from "vitest";
import { FrontOnOpen, attachFrontOnOpen } from "../../module/utils/front-on-open.js";
import { StepperDialog } from "../../module/dialogs/StepperDialog.js";

// FrontOnOpen floats a window on top AS IT OPENS, and then leaves the stack alone.
//
// The second half is the part worth pinning, because nothing about a window looks wrong when it
// gets it wrong. Callers hang this off `_render`, and an AppV1 window re-renders for reasons that
// have nothing to do with the reader: a companion window writing to the same data, a hook, a
// background job. Raising on each of those reads as "float as it opens" right up until two of this
// system's own windows are open on the same trip, and then the walkthrough jumps over the popped
// -out travel map on the very gesture that map exists for.

/** An app with the little of the Application surface FrontOnOpen touches. */
function fakeApp({ element = { id: "frame" } } = {}) {
	return { element, bringToTop: vi.fn() };
}

describe("floating a window as it opens", () => {
	it("brings it to the top", () => {
		const app = fakeApp();
		new FrontOnOpen(app).start();
		expect(app.bringToTop).toHaveBeenCalledTimes(1);
	});

	it("does NOT bring it up again when it re-renders", () => {
		// The regression: a re-render is not an appearance. Anything that re-raises here steals
		// the stack from whatever window drove the render.
		const app = fakeApp();
		const front = new FrontOnOpen(app);
		front.start();
		front.apply();
		front.apply();
		expect(app.bringToTop).toHaveBeenCalledTimes(1);
	});

	it("floats it again once it has been closed and reopened", () => {
		const app = fakeApp();
		const front = new FrontOnOpen(app);
		front.start();
		front.stop();
		front.start();
		expect(app.bringToTop).toHaveBeenCalledTimes(2);
	});

	it("does not spend the float on a render that has painted no frame yet", () => {
		// Called before there is an element, this must stay armed rather than count as the open,
		// or the window would appear underneath whatever it was opened from.
		const app = fakeApp({ element: null });
		const front = new FrontOnOpen(app);
		front.apply();
		expect(app.bringToTop).not.toHaveBeenCalled();

		app.element = { id: "frame" };
		front.apply();
		expect(app.bringToTop).toHaveBeenCalledTimes(1);
	});

	it("reads a jQuery element the same as a bare one", () => {
		const app = fakeApp({ element: Object.assign([{ id: "frame" }], { jquery: "3.x" }) });
		new FrontOnOpen(app).apply();
		expect(app.bringToTop).toHaveBeenCalledTimes(1);
	});

	it("falls back to bringToFront for an ApplicationV2", () => {
		const app = { element: { id: "frame" }, bringToFront: vi.fn() };
		new FrontOnOpen(app).apply();
		expect(app.bringToFront).toHaveBeenCalledTimes(1);
	});
});

describe("attachFrontOnOpen, for a dialog that cannot have its own subclass", () => {
	/** A `new Dialog(...)`-shaped app: the three methods the wrapper replaces. */
	function dialogApp() {
		return {
			element: { id: "frame" },
			rendered: false,
			bringToTop: vi.fn(),
			_render: vi.fn(async () => {}),
			activateListeners: vi.fn(),
			close: vi.fn(async () => {}),
		};
	}

	it("floats it once across a first render and every render after", async () => {
		const app = dialogApp();
		attachFrontOnOpen(app);
		await app._render(true, {});
		app.activateListeners({});
		await app._render(false, {});
		expect(app.bringToTop).toHaveBeenCalledTimes(1);
	});

	it("re-arms on close, so the next open floats", async () => {
		const app = dialogApp();
		attachFrontOnOpen(app);
		await app._render(true, {});
		await app.close();
		await app._render(true, {});
		expect(app.bringToTop).toHaveBeenCalledTimes(2);
	});

	it("attaches once, however many times it is asked", () => {
		const app = dialogApp();
		expect(attachFrontOnOpen(app)).toBe(attachFrontOnOpen(app));
	});
});

describe("a walkthrough re-rendering under a window the GM is using", () => {
	// Where this actually bit. The Expedition walkthrough re-renders whenever the trip changes,
	// including when the change was made in its own popped-out travel map, and every one of those
	// renders used to throw it over the map.
	class Walkthrough extends StepperDialog {
		get _steps() { return [{ key: "one", title: "One" }, { key: "two", title: "Two", isFinal: true }]; }
	}

	let renders;

	beforeEach(() => {
		renders = 0;
		global.Application.prototype._render = async function () { renders += 1; };
	});

	function walkthrough() {
		const app = new Walkthrough();
		app.element = [{ querySelector: () => null }];
		app.bringToTop = vi.fn();
		app.setPosition = vi.fn();
		return app;
	}

	it("floats as it opens, then stays where the GM left it", async () => {
		const app = walkthrough();
		await app._render(true, {});
		expect(app.bringToTop).toHaveBeenCalledTimes(1);

		// Three renders driven from elsewhere: a pick in the map window, and the step nav being
		// re-bound each time. None of them is the GM asking for this window.
		await app._render(false, {});
		app._bindStepNav({ find: () => ({ on: () => {} }) });
		await app._render(false, {});
		expect(app.bringToTop).toHaveBeenCalledTimes(1);
		expect(renders).toBe(3);
	});
});
