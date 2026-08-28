import { describe, it, expect } from "vitest";
import { readRepo as read } from "../../fakes/css.js";

// Standing Watch: "At the start of each season, the watch consumes 1 Surplus or it disbands."
//
// EVERY season, unlike the herd's summer/winter steps, and a genuine choice rather than a
// failure state: a steading that would rather keep the Surplus can let the watch go.

const SHEET = read("module/actors/steading/StonetopSteadingSheet.js");
const STEADING = read("module/actors/steading/StonetopSteading.js");

describe("the Standing Watch seasonal upkeep", () => {
	it("only appears once the watch has actually been raised", () => {
		expect(SHEET).toContain('this._hasImprovement("standingWatch")');
		expect(SHEET).toContain("_hasImprovement(slug) {");
	});

	// The herd's steps are summer/winter only; this one is not. The watch block is appended to
	// the season flow ONCE, outside the four-way branch on the season, which is what makes it
	// unconditional — so what this checks is that no branch closes the flow before the tail can
	// reach it. A branch that grew its own `</div>` would strand the watch outside the dialog.
	it("rides every season's flow, not just two of them", () => {
		const at = SHEET.indexOf("content += `${watchBlock}");
		expect(at).toBeGreaterThan(-1);
		// The append is the only place the flow is closed, and it sits after the season branch.
		expect(SHEET.slice(at, at + 200)).toContain("</div>");
		const branch = SHEET.slice(SHEET.indexOf("let content;"), at);
		expect(branch.match(/stonetop-season-flow/g) ?? []).toHaveLength(4);
		expect(branch).not.toContain("</div>`;");
	});

	it("offers both outcomes, and hides feeding when there is nothing to feed it with", () => {
		const at = SHEET.indexOf("const watchBlock =");
		expect(at).toBeGreaterThan(-1);
		const block = SHEET.slice(at, at + 1200);
		expect(block).toContain("surplus >= 1 ?");
		expect(block).toContain(`data-action="feed-watch"`);
		expect(block).toContain(`data-action="disband-watch"`);
	});

	// One step key for both buttons: answering the season's question either way closes it, so
	// a close+reopen can't feed the watch twice, nor feed it after disbanding it.
	it("settles one shared season step whichever way the table answers", () => {
		const at = SHEET.indexOf("const feedWatchBtn");
		expect(at).toBeGreaterThan(-1);
		const block = SHEET.slice(at, at + 2600);
		// Both answers close the SAME key: feeding closes it inside the one spendSurplus write,
		// disbanding writes the marker on its own (it spends nothing to close it).
		expect(block).toContain(`step: "standingWatch", year, seasonId`);
		expect(block).toContain(`setSeasonStepApplied("standingWatch", year, seasonId)`);
		expect(block).toContain(`_disableIfSeasonStepDone(feedWatchBtn, "standingWatch"`);
		expect(block).toContain(`_disableIfSeasonStepDone(disbandWatchBtn, "standingWatch"`);
	});

	// The herd feed and the Surplus roll in this same dialog can move Surplus after the window
	// was built, so the spend re-reads rather than writing back a stale count minus one. That
	// re-read lives in StonetopSteading#spendSurplus, which every seasonal spend goes through;
	// a null answer there means it could not be afforded and nothing was written.
	it("re-reads Surplus at click time", () => {
		const at = SHEET.indexOf("feedWatchBtn?.addEventListener");
		const block = SHEET.slice(at, at + 900);
		expect(block).toContain("spendSurplus(1,");
		expect(block).toContain("left === null");
		const spend = STEADING.indexOf("async spendSurplus(");
		expect(spend).toBeGreaterThan(-1);
		expect(STEADING.slice(spend, spend + 400)).toContain('this.getStatValue("surplus")');
	});

	// Disbanding runs the improvement's own revert, which is what takes "Standing Watch" back
	// off the Fortifications list and keeps the grant record honest for a later re-raise.
	it("disbands through the improvement revert rather than editing the list by hand", () => {
		const at = SHEET.indexOf("disbandWatchBtn?.addEventListener");
		const block = SHEET.slice(at, at + 900);
		expect(block).toContain(`setImprovementCompleted("standingWatch", false)`);
	});

	it("is styled, with the modifier declared after its base class", () => {
		const css = read("styles/stonetop.css");
		expect(css).toContain(".stonetop-season-btn--warn");
		// A `--mod` ties with its base on specificity, so the later rule is the one that wins.
		expect(css.indexOf(".stonetop-season-btn--warn"))
			.toBeGreaterThan(css.indexOf(".stonetop-season-btn {"));
	});
});
