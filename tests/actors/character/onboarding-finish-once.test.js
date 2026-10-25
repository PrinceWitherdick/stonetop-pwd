import { describe, it, expect, vi } from "vitest";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";

// Finishing character creation commits a long chain of awaits — items, portrait, actor
// fields, and the character's row on the steading's Player Characters roster — with the
// Finish button live for every one of them. A second click landing mid-commit used to run
// the whole chain again: duplicate starting gear, and a second roster row written before
// the first one had landed.

/** A dialog stub with just the members the finish path touches. */
function makeDialog({ onComplete } = {}) {
	const d = Object.create(CharacterOnboardingDialog.prototype);
	d._completed = false;
	d._selections = { moves: [] };
	d._steps = [{}];
	d._step = 0;
	d._isStepComplete = () => true;
	d._clearPopups = vi.fn();
	d._onComplete = onComplete ?? vi.fn(async () => {});
	d.close = vi.fn();
	d.render = vi.fn();
	return d;
}

describe("finishing onboarding exactly once", () => {
	it("ignores a second Finish click while the first is still committing", async () => {
		// Resolved by hand, so both clicks land while the commit is genuinely in flight —
		// which is the window a real double-click hits.
		let release;
		const onComplete = vi.fn(() => new Promise(resolve => { release = resolve; }));
		const d = makeDialog({ onComplete });

		const first = d._confirm();
		const second = d._confirm();
		release();
		await Promise.all([first, second]);

		expect(onComplete).toHaveBeenCalledTimes(1);
	});

	// The last step's Skip completes the flow the same way Finish does, so it carries the
	// same guard — including against a Skip that follows a click on Finish.
	it("ignores Skip once the flow has finished", async () => {
		const d = makeDialog();
		d._completed = true;

		await d._skip();

		expect(d._onComplete).not.toHaveBeenCalled();
		expect(d._clearPopups).not.toHaveBeenCalled();
	});

	it("still finishes on the first click", async () => {
		const d = makeDialog();

		await d._confirm();

		expect(d._onComplete).toHaveBeenCalledTimes(1);
		expect(d.close).toHaveBeenCalled();
	});
});

// Back closes the walkthrough and reopens the picker. The button stays live while the window
// fades out, and core's close() returns at once for a window already closing, so a double-click
// opened two pickers sharing one DOM id.
describe("stepping back to the picker exactly once", () => {
	it("reopens the picker once on a double-click of Back", async () => {
		const d = makeDialog();
		d._onBack = vi.fn();
		d.close = vi.fn(() => new Promise(resolve => setTimeout(resolve, 5)));

		await Promise.all([d._goBack(), d._goBack()]);

		expect(d._onBack).toHaveBeenCalledTimes(1);
		expect(d._suppressOnClose).toBe(true);
	});
});

// A commit that throws used to leave `_completed` set: the window stayed up with Finish dead.
describe("a finish that fails", () => {
	it("hands Finish back, says so, and keeps the window open", async () => {
		const error = vi.fn();
		const savedUi = global.ui;
		global.ui = { notifications: { error, warn: vi.fn(), info: vi.fn() } };
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const onComplete = vi.fn()
				.mockRejectedValueOnce(new Error("server said no"))
				.mockResolvedValueOnce(undefined);
			const d = makeDialog({ onComplete });

			await d._confirm();
			expect(d._completed).toBe(false);
			expect(d.close).not.toHaveBeenCalled();
			expect(error).toHaveBeenCalledTimes(1);

			await d._confirm();
			expect(onComplete).toHaveBeenCalledTimes(2);
			expect(d.close).toHaveBeenCalledTimes(1);
		} finally {
			global.ui = savedUi;
			consoleError.mockRestore();
		}
	});

	it("does the same for the last page's Skip", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const d = makeDialog({ onComplete: vi.fn(async () => { throw new Error("nope"); }) });
			await d._skip();
			expect(d._completed).toBe(false);
			expect(d.close).not.toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	});
});
