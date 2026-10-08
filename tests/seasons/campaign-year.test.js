import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	MIN_HISTORY_YEAR, displayYear, historyYear, normalizeStartYear, startYear, startYearFor, storedYear, yearsAgo,
} from "../../module/seasons/campaign-year.js";
import { yearLabel } from "../../module/seasons/seasons-chronicle.js";
import { periodLabel } from "../../module/seasons/current-season.js";
import { campaignYearPreview } from "../../module/seasons/campaign-year-dialog.js";
import { planYearPageRenames } from "../../module/migration/season-year-page-names.js";
import { agoLabel, buildAggregateVM, buildTrackVM } from "../../module/timeline/timeline-view.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { readRepo } from "../fakes/css.js";

// What the campaign's years are CALLED. Every year is stored counted from the first year of play;
// one world setting names that year, and every label reads it. A GM who changes it moves every
// recorded year at once, history included, with nothing stored rewritten.

/** A world whose GM said play began in `start`. */
function worldStartingIn(start) {
	globalThis.game = { settings: { get: (_scope, key) => (key === "campaignStartYear" ? start : undefined) } };
}

afterEach(() => { delete globalThis.game; });

describe("the start year", () => {
	it("is 1 wherever nothing names it, so an old world still reads Year One", () => {
		expect(startYear()).toBe(1);
		expect(yearLabel(1)).toBe("Year One");
		globalThis.game = { settings: { get: () => { throw new Error("not registered"); } } };
		expect(startYear()).toBe(1);
	});

	it("is a whole year of at least 1", () => {
		expect(normalizeStartYear("1247")).toBe(1247);
		expect(normalizeStartYear(0)).toBe(1);
		expect(normalizeStartYear(-5)).toBe(1);
		expect(normalizeStartYear("abc")).toBe(1);
	});

	it("names stored years by it, and reads them back", () => {
		worldStartingIn(1247);
		expect(displayYear(1)).toBe(1247);
		expect(displayYear(3)).toBe(1249);
		expect(displayYear(-9)).toBe(1237);
		expect(storedYear(1237)).toBe(-9);
		expect(storedYear(displayYear(42))).toBe(42);
	});
});

describe("yearLabel", () => {
	it("spells the small years out and numbers the rest, as before", () => {
		worldStartingIn(5);
		expect(yearLabel(1)).toBe("Year Five");
		worldStartingIn(1247);
		expect(yearLabel(1)).toBe("Year 1247");
	});

	// History in a world that never named its start: "Year -9" would read as a typo.
	it("counts back from Year One for a year before play in an unnamed world", () => {
		expect(yearLabel(0)).toBe("One Year Before Year One");
		expect(yearLabel(-9)).toBe("Ten Years Before Year One");
	});

	it("names a timeline period whose season nobody knows by its year alone", () => {
		worldStartingIn(1247);
		expect(periodLabel({ season: "", year: -9, yearOnly: true })).toBe("Year 1237");
		expect(periodLabel({ season: "", year: 3 })).toBe("stonetop.timeline.beforeRecord");
	});
});

describe("history years", () => {
	it("go below the first year of play, but not without end", () => {
		expect(historyYear(-9)).toBe(-9);
		expect(historyYear(0)).toBe(0);
		expect(historyYear(-1e9)).toBe(MIN_HISTORY_YEAR);
		expect(historyYear("x")).toBe(1);
	});

	it("count years ago from the clock", () => {
		expect(yearsAgo(-9, 1)).toBe(10);
		expect(yearsAgo(3, 3)).toBe(0);
		expect(yearsAgo(5, 3)).toBe(0);
	});
});

describe("Set the Year", () => {
	// Asked as the year it is NOW: in the campaign's third year, "1249" means play began in 1247.
	it("works the start year out from the year it is now", () => {
		expect(startYearFor(1249, 3)).toBe(1247);
		expect(startYearFor(1, 1)).toBe(1);
	});

	it("refuses a year that would put play itself before year 1", () => {
		expect(startYearFor(2, 3)).toBeNull();
		const preview = campaignYearPreview("2", 3);
		expect(preview.start).toBeNull();
		expect(preview.text).toContain("tooEarly");
	});

	it("says what play's first year will be called", () => {
		expect(campaignYearPreview("1249", 3)).toEqual({ start: 1247, text: "stonetop.campaignYear.preview" });
		expect(campaignYearPreview("", 3).start).toBeNull();
		// An empty field asks for a year, rather than calling nothing "too early".
		expect(campaignYearPreview("", 3).text).toContain("empty");
		expect(campaignYearPreview("abc", 3).text).toContain("empty");
	});

	it("is on the bar's year menu and asked at the first spring", () => {
		expect(readRepo("module/seasons/time-banner.js")).toContain(`move:  "year"`);
		expect(readRepo("module/dialogs/SpringBurstDialog.js")).toContain("askYear: true");
		expect(readRepo("templates/dialogs/spring-burst.hbs")).toContain("stonetop-spring-year-input");
	});

	it("is a hidden world setting that announces the change to every client", () => {
		const settings = readRepo("module/settings.js");
		const block = settings.slice(settings.indexOf(`"campaignStartYear"`));
		expect(block.slice(0, 400)).toMatch(/scope: "world"[\s\S]*config: false[\s\S]*START_YEAR_CHANGED_HOOK/);
	});
});

describe("the Seasons Change journal's year pages", () => {
	const page = (id, name, year, stamped) => ({
		_id: id, name, flags: { [SYSTEM_ID]: { chronicleYear: year, ...(stamped ? { yearPageName: stamped } : {}) } },
	});

	it("follow the GM's new start year, and leave a hand-titled page alone", () => {
		worldStartingIn(1247);
		expect(planYearPageRenames([
			page("a", "Year One", 1),
			page("b", "Year 1300", 2, "Year 1300"),
			page("c", "Year Two, the long one", 2),
			page("d", "Year 1249", 3),
		])).toMatchObject([{ _id: "a", name: "Year 1247" }, { _id: "b", name: "Year 1248" }]);
	});

	// A GM's "Year 12" is the shape a start year would print, but no name this system gave the page.
	it("leave a hand-typed year title alone, though it looks generated", () => {
		worldStartingIn(1247);
		expect(planYearPageRenames([
			page("a", "Year 12", 3),
			page("b", "Year Three", 4),
			page("c", "Year 1300", 2, "Year 1290"),
		])).toEqual([]);
	});

	it("stamp each rename with the name it gave", () => {
		worldStartingIn(1247);
		expect(planYearPageRenames([page("a", "Year One", 1)])[0].flags[SYSTEM_ID].yearPageName).toBe("Year 1247");
	});
});

describe("the timeline's history", () => {
	const entry = (over = {}) => ({ id: "e1", year: 1, season: "spring", order: 0, title: "A thing", ...over });

	beforeEach(() => worldStartingIn(1247));

	it("says how long ago a year before play was, and only then", () => {
		expect(agoLabel(-9, 3)).toBe("stonetop.timeline.yearsAgo");
		expect(agoLabel(0, 1)).toBe("stonetop.timeline.yearAgo");
		expect(agoLabel(2, 3)).toBe("");
		expect(agoLabel(null, 3)).toBe("");
	});

	it("files history first, a year with no season under its own heading", () => {
		const vm = buildTrackVM({ trackId: "s", name: "Stonetop", entries: [
			entry({ id: "now" }),
			entry({ id: "lost", year: -9, season: "", yearOnly: true, title: "The Forest Folk vanish" }),
			entry({ id: "undated", season: "", title: "Nobody knows when" }),
		] }, { nowYear: 1 });
		expect(vm.periods.map(p => p.key)).toEqual(["undated", "-9:year", "1:spring"]);
		const lost = vm.periods[1];
		expect(lost).toMatchObject({
			yearLabel: "Year 1237", year: -9, yearOnly: true, startsYear: true, undated: false,
			seasonLabel: "stonetop.timeline.seasonUnknown", glyphClass: "",
		});
		expect(lost.agoLabel).toBe("stonetop.timeline.yearsAgo");
		expect(vm.periods[0]).toMatchObject({ year: null, undated: true, startsYear: false });
	});

	// Year 0 is a real year now, so nothing may treat it as "no year".
	it("opens a year at year 0 like any other", () => {
		const vm = buildAggregateVM([{ trackId: "s", name: "Stonetop", entries: [
			entry({ id: "a", year: 0, season: "winter" }),
			entry({ id: "b", year: 1, season: "spring" }),
		] }], { nowYear: 1 });
		expect(vm.periods.map(p => [p.year, p.startsYear])).toEqual([[0, true], [1, true]]);
		expect(vm.periods[0].agoLabel).toBe("stonetop.timeline.yearAgo");
	});

	it("prints the ago note in the period's year chip", () => {
		expect(readRepo("templates/dialogs/partials/timeline-period-head.hbs")).toContain("{{#if agoLabel}}");
	});
});
