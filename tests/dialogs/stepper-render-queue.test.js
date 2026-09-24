import { describe, it, expect, vi, afterEach } from "vitest";

// Core AppV1 DROPS a render asked for while one is still drawing. A walkthrough step with a slow
// getData (the Expedition route's map art, the Outfit step's per-PC snapshots) held that window
// open long enough for a second Next to land in it: `_step` moved on, the screen did not, and the
// Next after that skipped a step. StepperDialog now remembers the ask and draws once more.

const { StepperDialog } = await import("../../module/dialogs/StepperDialog.js");

const STATES = Application.RENDER_STATES;

/** A stepper whose core render waits on `release()`, like a slow getData. */
function slowStepper() {
	const drawn = [];
	let release;
	const d = Object.create(StepperDialog.prototype);
	d._step = 0;
	d._frontOnOpen = { apply() {}, start() {}, stop() {} };
	d._state = STATES.RENDERED;
	Object.defineProperty(d, "_steps", { get: () => [{ key: "a" }, { key: "b" }, { key: "c" }] });
	d.render = force => { d._render(force).catch(() => {}); return d; };
	vi.spyOn(Application.prototype, "_render").mockImplementation(async function () {
		if (this._state === STATES.RENDERING) return;
		this._state = STATES.RENDERING;
		const step = this._step;
		await new Promise(resolve => { release = resolve; });
		drawn.push(step);
		this._state = STATES.RENDERED;
	});
	return { d, drawn, release: () => release() };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

afterEach(() => vi.restoreAllMocks());

describe("a render asked for while one is drawing", () => {
	it("is drawn once the first lands, showing the step the cursor is on", async () => {
		const { d, drawn, release } = slowStepper();
		d._advance();                // draws step 1 ...
		d._advance();                // ... and this Next lands mid-draw
		expect(d._step).toBe(2);

		release(); await tick();
		expect(drawn).toEqual([1]);
		release(); await tick();
		expect(drawn).toEqual([1, 2]);
		expect(d._renderedStep).toBe(2);
	});

	it("collapses several asks into one redraw", async () => {
		const { d, drawn, release } = slowStepper();
		d.render(false);
		d.render(false);
		d.render(false);
		release(); await tick();
		release(); await tick();
		expect(drawn).toEqual([0, 0]);
	});

	it("records the step it drew, not the one the cursor moved to meanwhile", async () => {
		const { d, release } = slowStepper();
		d._advance();
		d._step = 2;                 // moved without a render of its own
		release(); await tick();
		expect(d._renderedStep).toBe(1);
	});

	// An auto-height wizard changes size between steps; it stays centred over where the last step
	// stood rather than growing down from its top edge (LevelUpDialog's pattern).
	it("centres an auto-height wizard's new step on the old one", async () => {
		const { d, release } = slowStepper();
		Object.defineProperty(d, "_autoHeight", { get: () => true });
		d._renderedStep = 0;
		d.position = { left: 100, top: 200, width: 400, height: 300 };   // centre (300, 350)
		d.setPosition = vi.fn(pos => {
			if (pos.height === "auto") d.position = { ...d.position, height: 500 };
			else Object.assign(d.position, pos);
		});
		d._advance();
		release(); await tick();
		expect(d.position).toMatchObject({ left: 100, top: 100, width: 400, height: 500 });
	});

	it("leaves it where it is on a redraw of the same step", async () => {
		const { d, release } = slowStepper();
		Object.defineProperty(d, "_autoHeight", { get: () => true });
		d._renderedStep = 0;
		d.position = { left: 100, top: 200, width: 400, height: 300 };
		d.setPosition = vi.fn(pos => { if (pos.height === "auto") d.position = { ...d.position, height: 500 }; });
		d.render(false);
		release(); await tick();
		expect(d.setPosition).toHaveBeenCalledTimes(1);
		expect(d.position.top).toBe(200);
	});

	// Core will not close a window mid-render, so the one way the window is not up when the draw
	// ends is a draw that failed. A forced redraw of that would reopen what errored.
	it("does not redraw a window whose draw failed", async () => {
		const { d } = slowStepper();
		let calls = 0;
		Application.prototype._render.mockImplementation(async function () {
			calls++;
			this._state = STATES.RENDERING;
			await tick();
			this._state = STATES.ERROR;
			throw new Error("getData failed");
		});
		d.render(false);
		d.render(true);
		await tick(); await tick();
		expect(calls).toBe(1);
	});
});
