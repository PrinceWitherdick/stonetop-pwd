import { describe, expect, it, beforeEach } from "vitest";
import { getWalkthroughResume, patchWalkthroughResume, reopenOpenWalkthroughs } from "../../module/dialogs/walkthrough-resume.js";
import { ExpeditionDialog } from "../../module/dialogs/ExpeditionDialog.js";

// The Run an Expedition walkthrough joins the session-zero pair on the reload-resume
// record: a browser refresh never runs close(), so an `open: true` left behind means the
// window was up when the page unloaded, and the next load reopens it at the step the GM
// was reading. These tests pin both halves — the record the dialog keeps, and the reopen
// hooks/Ready.js drives through reopenOpenWalkthroughs().

let store;
let opened;

// A dialog instance WITHOUT running the constructor: the resume methods only touch
// `_step` and the settings store, and skipping the constructor keeps the FrontOnOpen /
// Application machinery (which the unit-test globals only stub) out of the way.
function dialogAt(step) {
	const dialog = Object.create(ExpeditionDialog.prototype);
	dialog._step = step;
	dialog._frontOnOpen = { stop: () => {} };
	dialog._resolve = null;
	return dialog;
}

beforeEach(() => {
	store   = { walkthroughResume: {} };
	opened  = [];
	global.game = {
		world:    { id: "world-a" },
		stonetop: {
			openExpedition:    () => { opened.push("expedition"); },
			openIntroductions: () => { opened.push("introductions"); },
			openSpringBurst:   () => { opened.push("springBurst"); },
		},
		settings: {
			get: (_ns, key) => store[key],
			set: (_ns, key, value) => { store[key] = value; return Promise.resolve(value); },
		},
	};
	// openThenRendered waits for the app's render hook (or a 3s timeout). Fire the
	// callback on the next microtask so the tests don't sit out the fallback timer.
	global.Hooks = { once: (_hook, fn) => { queueMicrotask(fn); return 1; }, on: () => {}, off: () => {} };
	// StepperDialog.close() chains to Application's; the shared test global is a bare class.
	global.Application.prototype.close = () => Promise.resolve();
});

describe("ExpeditionDialog reload-resume record", () => {
	it("records the open flag and the current step on render", () => {
		dialogAt(4)._saveResume();
		expect(getWalkthroughResume("expedition")).toEqual({ open: true, step: 4, stepKey: "requisition" });
	});

	it("records the step's KEY as well as its index, so an inserted step cannot shift it", () => {
		// An index is a place in a list this system edits: inserting "The route" as the second step
		// moved nine later steps down one, and a GM who reloaded mid-walkthrough came back to the
		// step BEFORE the one they left, silently, because the range check still passed.
		const dialog = dialogAt(4);
		dialog._saveResume();
		const saved = getWalkthroughResume("expedition");
		expect(saved.stepKey).toBe(dialog._steps[4].key);

		// A record written BEFORE that insert, when "running" was the fifth step. Its index is now
		// stale by exactly one and its key is not, so restoring by key has to move it forward.
		expect(dialog._steps[4].key).toBe("requisition");
		expect(dialog._steps[5].key).toBe("running");
		store.walkthroughResume = { "world-a": { expedition: { open: true, step: 4, stepKey: "running" } } };
		const reopened = dialogAt(0);
		reopened._restoreStep();
		expect(reopened._steps[reopened._step].key).toBe("running");
		expect(reopened._step).toBe(5);
	});

	it("falls back to the index for a record with no key, or a step since renamed", () => {
		store.walkthroughResume = { "world-a": { expedition: { open: true, step: 2 } } };
		const byIndex = dialogAt(0);
		byIndex._restoreStep();
		expect(byIndex._step).toBe(2);

		store.walkthroughResume = { "world-a": { expedition: { open: true, step: 2, stepKey: "gone" } } };
		const missing = dialogAt(0);
		missing._restoreStep();
		expect(missing._step).toBe(2);
	});

	it("skips the write when the recorded position is unchanged", () => {
		dialogAt(4)._saveResume();
		const before = store.walkthroughResume;
		dialogAt(4)._saveResume();
		// Same object identity: patchWalkthroughResume always clones, so a rewrite would swap it.
		expect(store.walkthroughResume).toBe(before);
	});

	it("reopens at the recorded step", () => {
		patchWalkthroughResume("expedition", { open: true, step: 7 });
		const dialog = dialogAt(0);
		dialog._restoreStep();
		expect(dialog._step).toBe(7);
	});

	it("stays on the first step when nothing is recorded", () => {
		const dialog = dialogAt(0);
		dialog._restoreStep();
		expect(dialog._step).toBe(0);
	});

	it("ignores a step index that no longer exists", () => {
		// A step dropped from the walkthrough must not strand the window past its end.
		patchWalkthroughResume("expedition", { open: true, step: 99 });
		const dialog = dialogAt(0);
		dialog._restoreStep();
		expect(dialog._step).toBe(0);
	});

	it("clears the open flag on a deliberate close, keeping the step", async () => {
		// A reload skips close() entirely — that asymmetry is what tells the next load
		// the window was up rather than dismissed. The step survives for a manual reopen.
		const dialog = dialogAt(4);
		dialog._saveResume();          // what each render does
		await dialog.close();
		expect(getWalkthroughResume("expedition")).toEqual({ open: false, step: 4, stepKey: "requisition" });
	});
});

describe("reopenOpenWalkthroughs with an expedition", () => {
	it("reopens the walkthrough that was open at unload", async () => {
		patchWalkthroughResume("expedition", { open: true, step: 4 });
		await reopenOpenWalkthroughs();
		expect(opened).toEqual(["expedition"]);
	});

	it("leaves a closed walkthrough closed", async () => {
		patchWalkthroughResume("expedition", { open: false, step: 4 });
		await reopenOpenWalkthroughs();
		expect(opened).toEqual([]);
	});

	it("does NOT reopen it in a different world", async () => {
		patchWalkthroughResume("expedition", { open: true, step: 4 });
		global.game.world = { id: "world-b" };
		await reopenOpenWalkthroughs();
		expect(opened).toEqual([]);
	});

	it("opens it last so it lands frontmost over a session-zero walkthrough", async () => {
		patchWalkthroughResume("introductions", { open: true, phase: 2 });
		patchWalkthroughResume("expedition", { open: true, step: 4 });
		await reopenOpenWalkthroughs();
		expect(opened).toEqual(["introductions", "expedition"]);
	});

	it("does not mistake an expedition-only world record for the pre-world-keying flat shape", async () => {
		// migrateFlatWalkthroughResume folds legacy top-level records under this world. A
		// world whose id collides with a walkthrough key must not be swallowed by it.
		global.game.world = { id: "springBurst" };
		patchWalkthroughResume("expedition", { open: true, step: 4 });
		await reopenOpenWalkthroughs();
		expect(opened).toEqual(["expedition"]);
		expect(store.walkthroughResume.springBurst).toEqual({ expedition: { open: true, step: 4 } });
	});
});
