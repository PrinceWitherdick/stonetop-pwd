import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The Seasons Change window (StonetopSteadingSheet#_showSeasonDialog) and its close-out
// (#_saveSeasonChange). The Chronicle page and the clock are the seasons modules' own business
// (seasons-chronicle.test.js, steading-header-season.test.js); here it is only what the
// close-out hands them.
const { recordSeasonsChange, recordCurrentSeason } = vi.hoisted(() => ({
	recordSeasonsChange: vi.fn(async () => null),
	recordCurrentSeason: vi.fn(async () => {}),
}));
vi.mock("../../../module/seasons/seasons-chronicle.js", async importOriginal => ({
	...(await importOriginal()), recordSeasonsChange,
}));
vi.mock("../../../module/seasons/current-season.js", async importOriginal => ({
	...(await importOriginal()), recordCurrentSeason,
}));

const { createStonetopSteadingSheetClass, refreshUpkeepAfford, militiaLead } = await import("../../../module/actors/steading/StonetopSteadingSheet.js");
const { readRepo, readCss, declarations } = await import("../../fakes/css.js");

const SHEET = readRepo("module/actors/steading/StonetopSteadingSheet.js");

/** The source of one `const name = … => {` arrow in the window, up to its closing `};` at that indent. */
function arrowBody(src, head) {
	const at = src.indexOf(head);
	expect(at, head).toBeGreaterThan(-1);
	const indent = src.slice(src.lastIndexOf("\n", at) + 1, at);
	return src.slice(at, src.indexOf(`\n${indent}};`, at));
}

/** The upkeep wiring's loop in the window's render callback, whole. */
function upkeepLoop() {
	const at = SHEET.indexOf("for (const due of upkeeps) {");
	expect(at).toBeGreaterThan(-1);
	const indent = SHEET.slice(SHEET.lastIndexOf("\n", at) + 1, at);
	return SHEET.slice(at, SHEET.indexOf(`\n${indent}}\n`, at));
}

/** A steading the close-out can write through: Fortunes 2, Surplus 1, no muster to lapse. */
function fakeSteading(overrides = {}) {
	return {
		getStatValue: vi.fn(stat => ({ fortunes: 2, surplus: 1, population: 0 })[stat] ?? 0),
		musterLapseChanges: () => null,
		applyChanges: vi.fn(async () => {}),
		torsBlessingFlags: () => ({}),
		openingFortunes: vi.fn(() => null),
		...overrides,
	};
}

/** A sheet with only what the close-out reads: its actor and its steading. */
function sheetFor(steading) {
	const actor = { id: "st1", name: "Stonetop", type: "stonetop", typedActor: steading, getFlag: () => undefined };
	const Base = class {
		get actor() { return actor; }
		render() {}
	};
	const Sheet = createStonetopSteadingSheetClass(Base);
	return new Sheet();
}

/** The window's root as the close-out reads it: no gains ticked, no notes. */
const emptyRoot = () => ({ querySelectorAll: () => [], querySelector: () => null });

beforeEach(() => {
	globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
	recordSeasonsChange.mockClear();
	recordCurrentSeason.mockClear();
});
afterEach(() => { delete globalThis.ui; });

// The Chronicle files the Fortunes the season OPENED with, noted when the roll was made or the
// reset taken (StonetopSteading#openingFortunes), not whatever the window read when it was opened:
// one opened early to look would file a mid-play figure.
describe("the Seasons Change Chronicle entry's Fortunes", () => {
	it("files the season's opening Fortunes over the live figure", async () => {
		const steading = fakeSteading({ openingFortunes: vi.fn(() => -1) });
		await sheetFor(steading)._saveSeasonChange("summer", emptyRoot(), 1, 2);
		expect(steading.openingFortunes).toHaveBeenCalledWith(2, "summer");
		expect(recordSeasonsChange).toHaveBeenCalledWith(expect.objectContaining({ seasonId: "summer", year: 2, fortunes: -1 }));
	});

	// Read before the gains' write, which is what can move the steading under it.
	it("reads the opening figure before the gains are applied", async () => {
		const steading = fakeSteading({ openingFortunes: vi.fn(() => 1) });
		await sheetFor(steading)._saveSeasonChange("summer", emptyRoot(), 1, 2);
		expect(steading.openingFortunes.mock.invocationCallOrder[0])
			.toBeLessThan(steading.applyChanges.mock.invocationCallOrder[0]);
	});

	// Noted as 0 is a real figure, not "nothing noted".
	it("keeps an opening Fortunes of 0", async () => {
		const steading = fakeSteading({ openingFortunes: vi.fn(() => 0) });
		await sheetFor(steading)._saveSeasonChange("summer", emptyRoot(), 1, 2);
		expect(recordSeasonsChange).toHaveBeenCalledWith(expect.objectContaining({ fortunes: 0 }));
	});

	// Nothing noted: the window never saw the roll nor the reset, so the live figure is still the
	// season's own.
	it("falls back to the live Fortunes when none was noted", async () => {
		const steading = fakeSteading({ getStatValue: vi.fn(stat => (stat === "fortunes" ? 3 : 0)) });
		await sheetFor(steading)._saveSeasonChange("autumn", emptyRoot(), 0, 2);
		expect(recordSeasonsChange).toHaveBeenCalledWith(expect.objectContaining({ fortunes: 3 }));
	});
});

// An upkeep's Pay button follows the live Surplus: the window is drawn off the Surplus it opened
// with, and a harvest or a yield taken in the same window can raise it, so Pay is drawn hidden
// rather than left out and shown when it can be afforded, without a reopen.
describe("an upkeep's Pay button in the Seasons Change window", () => {
	it("is drawn either way, hidden while short, beside a could-not-pay note shown only then", () => {
		const html = arrowBody(SHEET, "const upkeepHtml = due => {");
		expect(html).toMatch(/data-action="pay-upkeep" data-upkeep-slug="\$\{_esc\(due\.slug\)\}"\$\{hidden\(short\)\}>/);
		expect(html).toContain(`data-upkeep-short="\${_esc(due.slug)}"\${hidden(!short)}`);
		// Neither is left out of the markup any more on a short Surplus.
		expect(html).not.toContain(`\${short ? "" :`);
		expect(html).not.toContain("short && copy.shortNote");
	});

	it("quotes the Surplus in a live cell", () => {
		const at = SHEET.indexOf("const upkeepBlock = ");
		expect(at).toBeGreaterThan(-1);
		expect(SHEET.slice(at, SHEET.indexOf("`;", at))).toContain(`Surplus: <strong data-season-stat="surplus">\${surplus}</strong>`);
		// Every cell, not the first: the rail's and each upkeep's.
		expect(SHEET).toContain("root.querySelectorAll(`[data-season-${attr}=\"${key}\"]`).forEach(");
	});

	it("is refreshed from the window's stats hook, unless settled or in flight", () => {
		expect(SHEET).toContain("for (const refresh of liveRefreshers) refresh();");
		const loop = upkeepLoop();
		expect(loop).toMatch(/liveRefreshers\.push\(\(\) => \{\s*if \(!payBtn \|\| busy \|\| this\._stonetopSteading\.seasonStepApplied\(due\.key, year, seasonId\)\) return;\s*refreshUpkeepAfford\(\{ payBtn, shortNote \}, this\._stonetopSteading\.getStatValue\("surplus"\) >= due\.surplus\);/);
		// busy is raised by settle and lowered by every give-back: the throw's and the short one's.
		expect(loop).toMatch(/const settle = \(\) => \{\s*busy = true;/);
		expect(loop).toMatch(/const reopen = \(\) => \{\s*busy = false;/);
		expect(loop).toMatch(/shortUnlock: \(\) => \{\s*busy = false;/);
	});

	// `.stonetop-season-btn` sets `display: flex`, which out-specifies the UA's `[hidden]`.
	it("can actually be hidden", () => {
		expect(declarations(readCss(), ".stonetop-season-btn[hidden]")).toMatch(/display:\s*none/);
	});
});

describe("refreshUpkeepAfford", () => {
	it("offers Pay and hides the could-not-pay note once the Surplus covers it", () => {
		const payBtn = { hidden: true, disabled: true };
		const shortNote = { hidden: false };
		refreshUpkeepAfford({ payBtn, shortNote }, true);
		expect(payBtn).toEqual({ hidden: false, disabled: false });
		expect(shortNote.hidden).toBe(true);
	});

	it("takes Pay back off, and says why, when the Surplus falls short again", () => {
		const payBtn = { hidden: false, disabled: false };
		const shortNote = { hidden: true };
		refreshUpkeepAfford({ payBtn, shortNote }, false);
		expect(payBtn.hidden).toBe(true);
		expect(shortNote.hidden).toBe(false);
	});

	// The watch's copy carries no note: an upkeep without one still swaps its button.
	it("works without a note", () => {
		const payBtn = { hidden: true, disabled: false };
		refreshUpkeepAfford({ payBtn, shortNote: null }, true);
		expect(payBtn.hidden).toBe(false);
	});
});

// The Well-Trained Militia's drill, the same way: drawn but hidden when short, and offered as the
// live Surplus rises, with the tactics note's lead-in swapped to match.
describe("the Well-Trained Militia's drill in the Seasons Change window", () => {
	const militia = () => {
		const at = SHEET.indexOf("// The militia's summer.");
		expect(at).toBeGreaterThan(-1);
		return SHEET.slice(at, SHEET.indexOf("// A Surplus roll button:", at));
	};

	it("is drawn either way, hidden with its actions row while short", () => {
		const at = SHEET.indexOf("const militiaBlock = drillsDue");
		expect(at).toBeGreaterThan(-1);
		const block = SHEET.slice(at, SHEET.indexOf(`: "";`, at));
		expect(block).toContain(`<div class="stonetop-season-actions"\${surplus >= 1 ? "" : " hidden"}>`);
		expect(block).toContain(`data-action="drill-militia"\${surplus >= 1 ? "" : " hidden"}>`);
		expect(block).toContain("<span data-militia-lead>${militiaLead(surplus >= 1)}</span>");
		expect(block).not.toContain(`\${surplus >= 1 ? \`<div`);
	});

	it("leads its tactics note by whether the drills can be paid for", () => {
		expect(militiaLead(true)).toBe("Or skip");
		expect(militiaLead(false)).toBe("No Surplus for the drills");
	});

	it("is refreshed from the window's stats hook, unless settled or in flight", () => {
		const body = militia();
		expect(body).toMatch(/liveRefreshers\.push\(\(\) => \{\s*if \(!drillMilitiaBtn \|\| militiaBusy\s*\|\| this\._stonetopSteading\.seasonStepApplied\(MILITIA_SEASON_STEP, year, seasonId\)\) return;/);
		expect(body).toContain("refreshUpkeepAfford({ payBtn: drillMilitiaBtn, shortNote: null }, affordable);");
		expect(body).toContain("drillActions.hidden = !affordable;");
		expect(body).toContain("militiaLeadEl.textContent = militiaLead(affordable);");
		// Raised by the settle, lowered by every give-back: the short one, the throw's, the tactic's.
		expect(body).toMatch(/const settleMilitia = \(\) => \{\s*militiaBusy = true;/);
		expect(body).toMatch(/shortUnlock: \(\) => \{\s*militiaBusy = false;/);
		expect(body).toMatch(/unlock: \(\) => \{\s*militiaBusy = false;/);
		expect(body).toMatch(/catch \(err\) \{\s*militiaBusy = false;/);
	});
});
