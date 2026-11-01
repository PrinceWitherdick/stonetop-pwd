import { describe, it, expect } from "vitest";
import {
	STEP_STATE, makeSetupSteps, updateSetupStep, stepStateIcon, setupOverallFraction, setupSummary,
} from "../../module/dialogs/world-setup-steps.js";

// The step model behind the first-load setup window. The work it narrates runs
// concurrently, so "how far along overall" is a real calculation and gets tested here
// rather than being trapped inside the dialog.

const DEFS = [
	{ key: "art", label: "Book art" },
	{ key: "journals", label: "Journals" },
	{ key: "monsters", label: "Monsters" },
	{ key: "treasures", label: "Treasures" },
];

describe("makeSetupSteps", () => {
	it("starts everything pending with no fraction", () => {
		const steps = makeSetupSteps(DEFS);
		expect(steps).toHaveLength(4);
		expect(steps.every(s => s.state === STEP_STATE.PENDING)).toBe(true);
		// null, not 0: "running but unmeasurable" has to be distinguishable from "0% done".
		expect(steps.every(s => s.fraction === null)).toBe(true);
	});
});

describe("updateSetupStep", () => {
	it("patches only the named step and only the named keys", () => {
		const steps = makeSetupSteps(DEFS);
		const next = updateSetupStep(steps, "journals", { state: STEP_STATE.RUNNING, detail: "Reading" });
		expect(next[1]).toMatchObject({ state: STEP_STATE.RUNNING, detail: "Reading", fraction: null });
		expect(next[0]).toBe(steps[0]);
		// The input is untouched, so a renderer can compare old against new.
		expect(steps[1].state).toBe(STEP_STATE.PENDING);
	});

	it("leaves state alone when only the detail moves", () => {
		let steps = makeSetupSteps(DEFS);
		steps = updateSetupStep(steps, "monsters", { state: STEP_STATE.RUNNING, fraction: 0.4 });
		steps = updateSetupStep(steps, "monsters", { detail: "142 of 200" });
		expect(steps[2]).toMatchObject({ state: STEP_STATE.RUNNING, fraction: 0.4, detail: "142 of 200" });
	});

	it("returns the same array for an unknown key or a no-op patch", () => {
		const steps = makeSetupSteps(DEFS);
		expect(updateSetupStep(steps, "nope", { state: STEP_STATE.DONE })).toBe(steps);
		expect(updateSetupStep(steps, "art", { state: STEP_STATE.PENDING })).toBe(steps);
	});
});

describe("setupOverallFraction", () => {
	it("counts a settled step in full whatever its outcome", () => {
		let steps = makeSetupSteps(DEFS);
		steps = updateSetupStep(steps, "art", { state: STEP_STATE.DONE });
		steps = updateSetupStep(steps, "journals", { state: STEP_STATE.SKIPPED });
		// A failed step is finished work too — a bar frozen at 50% forever reads as a hang.
		steps = updateSetupStep(steps, "monsters", { state: STEP_STATE.FAILED });
		expect(setupOverallFraction(steps)).toBeCloseTo(0.75);
	});

	it("counts a running step by its own reported fraction", () => {
		let steps = makeSetupSteps(DEFS);
		steps = updateSetupStep(steps, "art", { state: STEP_STATE.DONE });
		steps = updateSetupStep(steps, "journals", { state: STEP_STATE.RUNNING, fraction: 0.5 });
		expect(setupOverallFraction(steps)).toBeCloseTo(0.375);
	});

	it("treats an indeterminate running step as no progress yet", () => {
		let steps = makeSetupSteps(DEFS);
		steps = updateSetupStep(steps, "art", { state: STEP_STATE.RUNNING });
		expect(setupOverallFraction(steps)).toBe(0);
	});

	it("clamps a bad fraction rather than overshooting the bar", () => {
		let steps = makeSetupSteps([DEFS[0]]);
		steps = updateSetupStep(steps, "art", { state: STEP_STATE.RUNNING, fraction: 4 });
		expect(setupOverallFraction(steps)).toBe(1);
		steps = updateSetupStep(steps, "art", { fraction: -2 });
		expect(setupOverallFraction(steps)).toBe(0);
	});

	it("is complete with no steps at all", () => {
		expect(setupOverallFraction([])).toBe(1);
	});
});

describe("stepStateIcon", () => {
	it("gives each state its own glyph, and spins only while running", () => {
		expect(stepStateIcon(STEP_STATE.PENDING)).toBe("fa-circle");
		expect(stepStateIcon(STEP_STATE.RUNNING)).toContain("fa-spin");
		expect(stepStateIcon(STEP_STATE.DONE)).toBe("fa-circle-check");
		expect(stepStateIcon(STEP_STATE.SKIPPED)).toBe("fa-circle-minus");
		expect(stepStateIcon(STEP_STATE.FAILED)).toBe("fa-circle-exclamation");
	});

	it("falls back to the pending glyph for anything unrecognised", () => {
		expect(stepStateIcon(undefined)).toBe("fa-circle");
	});
});

describe("setupSummary", () => {
	it("reports readiness when nothing failed", () => {
		const steps = makeSetupSteps(DEFS).map(s => ({ ...s, state: STEP_STATE.SKIPPED }));
		expect(setupSummary(steps)).toContain("ready");
	});

	// The post-update journal refresh shares the window but is not a world being set up.
	it("closes on the caller's own line when one is given", () => {
		const steps = makeSetupSteps(DEFS).map(s => ({ ...s, state: STEP_STATE.DONE }));
		expect(setupSummary(steps, "Your journals are up to date.")).toBe("Your journals are up to date.");
	});

	it("still reports a failure over the caller's line", () => {
		const steps = updateSetupStep(makeSetupSteps(DEFS), "art", { state: STEP_STATE.FAILED });
		expect(setupSummary(steps, "Your journals are up to date.")).toContain("try again");
	});

	it("names the failure count and promises a retry", () => {
		let steps = makeSetupSteps(DEFS).map(s => ({ ...s, state: STEP_STATE.DONE }));
		steps = updateSetupStep(steps, "monsters", { state: STEP_STATE.FAILED });
		const summary = setupSummary(steps);
		expect(summary).toContain("1 step");
		expect(summary).toContain("try again");
	});
});
