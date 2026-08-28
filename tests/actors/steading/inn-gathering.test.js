import { describe, it, expect } from "vitest";
import { readRepo as read } from "../../fakes/css.js";
import {
	innGatheringState, INN_MOVE, INN_SEASON_STEP,
} from "../../../module/actors/steading/inn-gathering.js";
import { DEBILITIES } from "../../../module/actors/steading/steading-debilities.js";

// The Inn: "Once per season, when you expend 1 Surplus and bring folks together at the inn
// (to talk, to celebrate, to recuperate), clear one of the steading's debilities."
//
// TWO costs, either of which can independently make the move unavailable, plus a seasonal cap.
// The window says which one is missing rather than showing a button that does nothing.

describe("innGatheringState", () => {
	const marked = ["lacking"];

	it("offers the gathering when there is a Surplus to spend and something to clear", () => {
		const s = innGatheringState({ surplus: 1, debilities: marked });
		expect(s.canGather).toBe(true);
		expect(s.reason).toBe("");
	});

	it("refuses without a Surplus", () => {
		const s = innGatheringState({ surplus: 0, debilities: marked });
		expect(s.canGather).toBe(false);
		expect(s.reason).toBe("surplus");
	});

	it("refuses when the steading has no debility to clear", () => {
		const s = innGatheringState({ surplus: 3, debilities: [] });
		expect(s.canGather).toBe(false);
		expect(s.reason).toBe("healthy");
	});

	it("refuses a second gathering in the same season", () => {
		const s = innGatheringState({ surplus: 3, done: true, debilities: marked });
		expect(s.canGather).toBe(false);
		expect(s.reason).toBe("done");
	});

	// A season already spent is the answer even when the steading is ALSO broke: it is the
	// blocker that will still be true after they go and find a Surplus.
	it("reports the seasonal cap ahead of the other blockers", () => {
		expect(innGatheringState({ surplus: 0, done: true, debilities: [] }).reason).toBe("done");
	});

	it("lists only the debilities actually marked, in the book's order", () => {
		expect(innGatheringState({ debilities: [] }).marked).toEqual([]);
		expect(innGatheringState({ debilities: ["malcontent", "diminished"] }).marked.map(d => d.id))
			.toEqual(["diminished", "malcontent"]);
	});
});

describe("how it is wired", () => {
	const INN = read("module/actors/steading/inn-gathering.js");
	const STEADING = read("module/actors/steading/StonetopSteading.js");
	const SHEET = read("module/actors/steading/StonetopSteadingSheet.js");
	const TPL = read("templates/actor/partials/steading-tab-improvements.hbs");

	it("caps the gathering at one per season, on the steading's own marker", () => {
		expect(INN).toContain("step: INN_SEASON_STEP, year, seasonId");
		expect(INN_SEASON_STEP).toBe("innGathering");
		// The marker rides the same single write as the spend, so the two cannot half-apply.
		expect(STEADING).toContain("seasonStepFlags(step, year, seasonId) {");
	});

	// The Surplus captured when the window opened can be stale: the sheet behind it stays live.
	// The re-read lives in the shared spendSurplus every seasonal spend goes through, which
	// answers null when the steading cannot afford it and writes nothing.
	it("re-reads Surplus at apply time rather than trusting the opening snapshot", () => {
		const at = INN.indexOf("async function _holdGathering");
		expect(at).toBeGreaterThan(-1);
		const body = INN.slice(at, at + 1200);
		expect(body).toContain("steading.spendSurplus(1,");
		expect(body).toContain("left === null");
		const spend = STEADING.indexOf("async spendSurplus(");
		expect(spend).toBeGreaterThan(-1);
		expect(STEADING.slice(spend, spend + 400)).toContain('this.getStatValue("surplus")');
	});

	// Spend, clear and marker go out as ONE update, so the ledger names the Inn once rather
	// than three times and the Surplus and debility card together.
	it("attributes its one write to the move, so the steading ledger says why", () => {
		expect(INN).toContain("stonetopMove: INN_MOVE");
		expect(INN).toContain("[debilityPath(picked.id)]: false");
		expect(INN_MOVE).toBe("Inn");
		const at = INN.indexOf("async function _holdGathering");
		expect(INN.slice(at).match(/await steading\./g) ?? []).toHaveLength(1);
	});

	// It rides the improvement card, not the Seasons Change flow: the trigger fires whenever
	// the fiction reaches for it during a season, and only the CAP is seasonal.
	it("hangs off the Inn's improvement card, once the inn is built", () => {
		expect(STEADING).toContain('innGathering: def.slug === "inn" && completed ? this._innGatheringView() : null');
		expect(TPL).toContain("{{#if innGathering}}");
		expect(TPL).toContain('data-action="inn-gathering"');
		expect(SHEET).toContain("_openInnGathering()");
	});

	it("is styled", () => {
		const css = read("styles/stonetop.css");
		for (const rule of [".steading-inn-gathering", ".steading-inn-gathering-btn", ".stonetop-inn-done"]) {
			expect(css, rule).toContain(rule);
		}
	});
});

describe("the shared debilities table", () => {
	// Three moves clear a debility, and each used to carry its own copy of this list with the
	// `detail` strings quoted straight into a dialog. One table, so they cannot drift apart.
	it("is the one source the three clearing moves read", () => {
		expect(DEBILITIES.map(d => d.id)).toEqual(["diminished", "lacking", "malcontent"]);
		for (const file of [
			"module/actors/steading/return-triumphant.js",
			"module/actors/character/rites-of-the-land.js",
			"module/actors/steading/inn-gathering.js",
		]) {
			expect(read(file), file).toContain("steading-debilities.js");
			// No local re-declaration left behind alongside the import.
			expect(read(file), file).not.toMatch(/^const DEBILITIES = \[/m);
		}
	});
});
