// The step model behind the first-load setup progress window (WorldSetupDialog).
//
// Its own leaf module because the shape is worth testing without Foundry: the window
// narrates work that runs CONCURRENTLY (the journal chain, the bestiary import and the
// treasure import all start at once), so "how far along is this overall" is a real
// calculation rather than a counter, and the dialog should not be the only place it
// exists. The dialog renders whatever these functions return; nothing here touches the DOM.

import { countOf } from "../utils/plural.js";

/** Lifecycle of a single setup step. */
export const STEP_STATE = Object.freeze({
	PENDING: "pending",
	RUNNING: "running",
	DONE:    "done",
	SKIPPED: "skipped",
	FAILED:  "failed",
});

/**
 * How every one-time import's opening paragraph ends, whether the world is brand new or an
 * established one being given a library it never had (hooks/WorldSetup.js#setupLead).
 */
export const ONE_TIME_IMPORT_CLOSE = "This only happens once. You can carry on while it finishes.";

/**
 * The paragraph a brand-new world's first load opens with. Here rather than in the dialog so
 * the orchestrator that picks a run's wording (hooks/WorldSetup.js) and the dialog's own
 * fallback read the one sentence.
 */
export const FIRST_LOAD_LEAD = "Stonetop is filling your new world with its journals, monsters and treasures. "
	+ ONE_TIME_IMPORT_CLOSE;

/** A step that will never move again — done, deliberately skipped, or given up on. */
const SETTLED = new Set([STEP_STATE.DONE, STEP_STATE.SKIPPED, STEP_STATE.FAILED]);

/**
 * Build the initial step list from `{ key, label }` definitions.
 *
 * `fraction` is null until the step reports one, which is how the bar tells "running,
 * no idea how far" (an indeterminate sweep) from "running, 40% through".
 */
export function makeSetupSteps(defs = []) {
	return defs.map(({ key, label }) => ({
		key, label,
		state: STEP_STATE.PENDING,
		detail: "",
		fraction: null,
	}));
}

/**
 * Font Awesome glyph for a step's state. Here rather than in the template so the row's
 * icon is a lookup instead of a five-branch conditional inside a class attribute.
 */
export function stepStateIcon(state) {
	switch (state) {
		case STEP_STATE.DONE:    return "fa-circle-check";
		case STEP_STATE.SKIPPED: return "fa-circle-minus";
		case STEP_STATE.FAILED:  return "fa-circle-exclamation";
		case STEP_STATE.RUNNING: return "fa-spinner fa-spin";
		default:                 return "fa-circle";
	}
}

/**
 * A copy of `steps` with `key`'s fields patched. Returns the SAME array when the key is
 * unknown or nothing actually changed, so a caller can cheaply skip a re-render.
 *
 * Only the keys present in `patch` are written — `updateSetupStep(s, "x", { detail: "…" })`
 * leaves the step's state and fraction alone, which is what lets a long step report detail
 * without restating that it is still running.
 */
export function updateSetupStep(steps, key, patch = {}) {
	const index = steps.findIndex(s => s.key === key);
	if (index < 0) return steps;
	const current = steps[index];
	const next = { ...current, ...patch };
	if (Object.keys(patch).every(k => Object.is(current[k], next[k]))) return steps;
	const out = steps.slice();
	out[index] = next;
	return out;
}

/**
 * Overall completion, 0–1. Every step carries equal weight; a running step contributes
 * its own reported fraction (0 while indeterminate), and a settled one contributes fully
 * whether it succeeded, was skipped, or failed — a failed step is finished work, and a bar
 * that stalls at 80% forever because one import failed reads as a hang.
 */
export function setupOverallFraction(steps) {
	if (!steps.length) return 1;
	const done = steps.reduce((sum, s) => {
		if (SETTLED.has(s.state)) return sum + 1;
		if (s.state !== STEP_STATE.RUNNING) return sum;
		return sum + Math.max(0, Math.min(1, Number(s.fraction) || 0));
	}, 0);
	return Math.max(0, Math.min(1, done / steps.length));
}

/**
 * The closing line for a finished run: how many steps landed, and whether any failed.
 * Skipped steps are deliberately not counted as failures — "nothing to import" is a
 * normal outcome on a world that already has the content.
 *
 * `doneLine` replaces the success line, for a run that is not a world being set up (the
 * journal refresh after an update says what it refreshed instead).
 */
export function setupSummary(steps, doneLine = "Your world is ready.") {
	const failed = steps.filter(s => s.state === STEP_STATE.FAILED);
	if (failed.length) {
		return `Setup finished, but ${countOf(failed.length, "step")} did not complete. `
			+ "The next time you load this world it will try again.";
	}
	return doneLine;
}
