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

const { createStonetopSteadingSheetClass } = await import("../../../module/actors/steading/StonetopSteadingSheet.js");

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
	it("files the season's opening Fortunes over the figure it was handed", async () => {
		const steading = fakeSteading({ openingFortunes: vi.fn(() => -1) });
		await sheetFor(steading)._saveSeasonChange("summer", emptyRoot(), 2, 1, 2);
		expect(steading.openingFortunes).toHaveBeenCalledWith(2, "summer");
		expect(recordSeasonsChange).toHaveBeenCalledWith(expect.objectContaining({ seasonId: "summer", year: 2, fortunes: -1 }));
	});

	// Read before the gains' write, which is what can move the steading under it.
	it("reads the opening figure before the gains are applied", async () => {
		const steading = fakeSteading({ openingFortunes: vi.fn(() => 1) });
		await sheetFor(steading)._saveSeasonChange("summer", emptyRoot(), null, 1, 2);
		expect(steading.openingFortunes.mock.invocationCallOrder[0])
			.toBeLessThan(steading.applyChanges.mock.invocationCallOrder[0]);
	});

	// Noted as 0 is a real figure, not "nothing noted".
	it("keeps an opening Fortunes of 0", async () => {
		const steading = fakeSteading({ openingFortunes: vi.fn(() => 0) });
		await sheetFor(steading)._saveSeasonChange("summer", emptyRoot(), 2, 1, 2);
		expect(recordSeasonsChange).toHaveBeenCalledWith(expect.objectContaining({ fortunes: 0 }));
	});

	// Nothing noted: the window never saw the roll nor the reset, so the live figure is still the
	// season's own. The window's close-out hands nothing over.
	it("falls back to the live Fortunes when none was noted and none handed over", async () => {
		const steading = fakeSteading({ getStatValue: vi.fn(stat => (stat === "fortunes" ? 3 : 0)) });
		await sheetFor(steading)._saveSeasonChange("autumn", emptyRoot(), null, 0, 2);
		expect(recordSeasonsChange).toHaveBeenCalledWith(expect.objectContaining({ fortunes: 3 }));
	});
});
