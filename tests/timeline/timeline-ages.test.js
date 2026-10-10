import { describe, it, expect } from "vitest";
import { readCss, readRepo } from "../fakes/css.js";

// THE AGES: named runs of years the GM lays over the timeline (user, 2026-10-07), stored as
// campaign-relative years, stacked when they overlap, each given a colour no Age has worn before.

const {
	normalizeAge, normalizeAges, agesToStored, agesInView, stackAges, ageStrip,
	nextAgeColour, ageColourAt, hexHue, hslHex, cleanAgeName, AGE_NAME_MAX,
} = await import("../../module/timeline/timeline-ages.js");
const { readDraftRow, suggestedStart, restartDraft, unseenAges } = await import("../../module/dialogs/TimelineAgesDialog.js");
const { ageMarkYears } = await import("../../module/timeline/timeline-ages.js");
const { buildAggregateVM, buildTrackVM, withAgeMarks } = await import("../../module/timeline/timeline-view.js");

const stops = (...years) => years.map(year => ({ year, label: `Year ${year}` }));

describe("normalizeAges", () => {
	it("keeps a named, dated, coloured Age and drops one missing any of the three", () => {
		const ages = normalizeAges({
			a: { name: "The Age of Embers", from: -40, to: -2, colour: "#7B31A7" },
			b: { name: "  ", from: 1, colour: "#123456" },
			c: { name: "No start", colour: "#123456" },
			d: { name: "No colour", from: 3, colour: "purple" },
		});
		expect(ages).toEqual([{ id: "a", name: "The Age of Embers", from: -40, to: -2, colour: "#7b31a7" }]);
	});

	it("swaps an end typed before its start, and reads a blank end as still running", () => {
		expect(normalizeAge({ name: "Backwards", from: 10, to: 4, colour: "#111111" }, "x"))
			.toMatchObject({ from: 4, to: 10 });
		expect(normalizeAge({ name: "Now", from: 2, to: "", colour: "#111111" }, "y").to).toBeNull();
	});

	it("orders by start, a closed Age before a running one that starts the same year", () => {
		const ages = normalizeAges([
			{ id: "late", name: "Late", from: 5, colour: "#111111" },
			{ id: "open", name: "Open", from: 1, to: null, colour: "#111111" },
			{ id: "shut", name: "Shut", from: 1, to: 3, colour: "#111111" },
		]);
		expect(ages.map(a => a.id)).toEqual(["shut", "open", "late"]);
	});

	it("round-trips through the stored shape, keyed by id", () => {
		const stored = agesToStored([{ id: "a", name: "A", from: 1, to: 2, colour: "#111111" }]);
		expect(stored).toEqual({ a: { id: "a", name: "A", from: 1, to: 2, colour: "#111111" } });
		expect(normalizeAges(stored)).toEqual(Object.values(stored));
	});

	it("cleans a name to one capped line", () => {
		expect(cleanAgeName("  The\n Age   of\tAsh ")).toBe("The Age of Ash");
		expect(cleanAgeName("x".repeat(200))).toHaveLength(AGE_NAME_MAX);
	});
});

describe("agesInView", () => {
	const ages = normalizeAges([
		{ id: "embers", name: "Embers", from: -40, to: -2, colour: "#111111" },
		{ id: "now", name: "Now", from: 1, colour: "#222222" },
		{ id: "gap", name: "Gap", from: 50, to: 60, colour: "#333333" },
	]);

	it("runs each Age between the first and last years shown inside it", () => {
		const view = agesInView(ages, stops(-30, -10, 1, 3, 7));
		expect(view.map(a => [a.id, a.first, a.last, a.start, a.end])).toEqual([
			["embers", -30, -10, 0, 1],
			["now", 1, 7, 2, 4],
		]);
	});

	it("leaves out an Age with no year shown", () => {
		expect(agesInView(ages, stops(1, 2)).map(a => a.id)).toEqual(["now"]);
	});
});

describe("stackAges", () => {
	it("keeps back-to-back Ages on one row", () => {
		const { items, rows } = stackAges([{ start: 0, end: 2 }, { start: 3, end: 5 }]);
		expect(rows).toBe(1);
		expect(items.map(i => i.row)).toEqual([0, 0]);
	});

	it("gives an Age inside another, or sharing a year with it, a row of its own", () => {
		const { items, rows } = stackAges([{ start: 0, end: 9 }, { start: 2, end: 4 }, { start: 9, end: 12 }, { start: 5, end: 6 }]);
		expect(rows).toBe(2);
		expect(items.map(i => i.row)).toEqual([0, 1, 1, 1]);
	});

	it("stacks by what is SHOWN, so Ages that overlap only off screen share a row", () => {
		const ages = normalizeAges([
			{ id: "a", name: "A", from: 1, to: 5, colour: "#111111" },
			{ id: "b", name: "B", from: 3, to: 9, colour: "#222222" },
		]);
		expect(ageStrip(ages, stops(1, 8)).rows).toBe(1);
		expect(ageStrip(ages, stops(1, 4, 8)).rows).toBe(2);
	});
});

describe("nextAgeColour", () => {
	it("never hands out the same colour twice as the walk moves on", () => {
		let seq = 0;
		const seen = new Set();
		for (let i = 0; i < 50; i++) {
			const next = nextAgeColour({ seq });
			expect(next.seq).toBeGreaterThan(seq);
			seq = next.seq;
			expect(seen.has(next.hex)).toBe(false);
			seen.add(next.hex);
		}
	});

	it("steps past a hue the world already wears", () => {
		const first = ageColourAt(0);
		const next = nextAgeColour({ seq: 0, inUse: [first] });
		expect(next.hex).not.toBe(first);
		expect(next.seq).toBeGreaterThan(1);
	});

	it("is a valid hex the custom-tag colouring accepts", () => {
		expect(ageColourAt(7)).toMatch(/^#[0-9a-f]{6}$/);
		expect(hslHex(0, 1, 0.5)).toBe("#ff0000");
		expect(Math.round(hexHue("#00ff00"))).toBe(120);
		expect(hexHue("#777777")).toBeNull();
	});
});

describe("the editor's rows", () => {
	it("reads the typed years as stored ones and a blank last year as still running", () => {
		const read = readDraftRow({ id: "a", name: " Embers ", fromText: "-3", toText: "", colour: "#7B31A7" });
		expect(read.age).toEqual({ id: "a", name: "Embers", from: -3, to: null, colour: "#7b31a7" });
	});

	it("refuses a row without a name or a first year", () => {
		expect(readDraftRow({ id: "a", name: "", fromText: "1" }).error).toBe("name");
		expect(readDraftRow({ id: "a", name: "A", fromText: "" }).error).toBe("from");
	});

	it("opens a new Age the year after the latest one to end, else on the clock's year", () => {
		expect(suggestedStart([{ name: "A", fromText: "1", toText: "4" }, { name: "B", fromText: "2", toText: "" }], 9)).toBe(5);
		expect(suggestedStart([], 9)).toBe(9);
	});

	it("reads the typed years against the start year the draft was written in", () => {
		expect(readDraftRow({ id: "a", name: "A", fromText: "1240", toText: "1246" }, 1240).age)
			.toMatchObject({ from: 1, to: 7 });
	});

	it("re-expresses the draft's years when the start year moves, keeping text that is no year", () => {
		const rows = restartDraft([{ id: "a", fromText: "1240", toText: "" }, { id: "b", fromText: "12", toText: "x" }], 1240, 1247);
		expect(rows.map(row => [row.fromText, row.toText])).toEqual([["1247", ""], ["19", "x"]]);
	});

	it("brings in an Age saved elsewhere, never one this draft has held", () => {
		const ages = [{ id: "a", name: "A", from: 1, to: null, colour: "#000000" }, { id: "b", name: "B", from: 2, to: 3, colour: "#111111" }];
		expect(unseenAges(ages, new Set(["a"])).map(row => row.id)).toEqual(["b"]);
	});
});

describe("the strip in the timeline", () => {
	it("is drawn after the column, in its cell, and each band is placed by the script", () => {
		const main = readRepo("templates/dialogs/timeline.hbs");
		expect(main).toMatch(/class="stonetop-timeline-ages"/);
		expect(main).toMatch(/data-age-first="\{\{first\}\}" data-age-last="\{\{last\}\}"/);
		const css = readCss();
		expect(css).toMatch(/\.stonetop-timeline > \.stonetop-timeline-scroll \{\s*grid-row: 2;\s*grid-column: 1;/);
		expect(css).toMatch(/\.stonetop-timeline-ages \{[^}]*grid-row: 2;[^}]*pointer-events: none;/);
	});

	it("never animates a band's place: core's button transition would trail it behind its years", () => {
		expect(readCss()).toMatch(/\.stonetop-timeline-age \{[^}]*transition: none;/);
	});
});

// AN AGE WITH NOTHING WRITTEN IN IT (user, 2026-10-07: "show an age even without timeline
// entries"): its first and last years are opened as bare years, the separator alone, so its band has
// years to lie under.
describe("an Age's bare years", () => {
	const entry = (over = {}) => ({ id: "e1", year: 1, season: "spring", order: 0, title: "A thing", ...over });

	it("asks for each Age's first year, and its last if it has ended", () => {
		const ages = normalizeAges([
			{ id: "a", name: "A", from: -40, to: -20, colour: "#111111" },
			{ id: "b", name: "B", from: 1, colour: "#222222" },
		]);
		expect(ageMarkYears(ages)).toEqual([-40, -20, 1]);
	});

	it("opens only the years nothing is written in, in year order, before that year's seasons", () => {
		const periods = withAgeMarks([{ key: "1:spring", year: 1, rank: 7 }, { key: "undated", year: null, rank: -Infinity }], [-40, 1]);
		expect(periods.map(p => p.key)).toEqual(["undated", "-40:age", "1:spring"]);
		expect(periods[1]).toMatchObject({ ageMark: true, entries: [] });
	});

	it("gives a single thread a bare year that opens a year and takes no side", () => {
		const vm = buildTrackVM({ trackId: "pc", entries: [entry(), entry({ id: "e2", season: "summer" })] }, { ageYears: [-40] });
		const [mark, spring, summer] = vm.periods;
		expect(mark).toMatchObject({ ageMark: true, startsYear: true, year: -40, entries: [] });
		// The alternation is the seasons' own, as if the bare year were not there.
		expect([spring.above, summer.above]).toEqual([true, false]);
	});

	it("gives the board a bare year whose cells open its rule and hold nothing", () => {
		const vm = buildAggregateVM([{ trackId: "a", name: "A", entries: [entry()] }], { ageYears: [-40] });
		expect(vm.periods[0].ageMark).toBe(true);
		expect(vm.swimlanes[0].cells[0]).toMatchObject({ ageMark: true, opensYear: true, isEmpty: true });
	});

	// The board gathers its periods in the order the threads first meet them; with no Age to add, it
	// must still come out oldest first.
	it("lays the board's periods oldest first with no Age to mark", () => {
		const vm = buildAggregateVM([
			{ trackId: "a", name: "A", entries: [entry({ year: 2 })] },
			{ trackId: "b", name: "B", entries: [entry({ id: "e2", year: 1 })] },
		], { ageYears: [] });
		expect(vm.periods.map(p => p.year)).toEqual([1, 2]);
	});

	it("never makes a board the Filter menu has emptied read as written", () => {
		const vm = buildAggregateVM([{ trackId: "a", name: "A", entries: [entry({ source: "kills" })] }], { hidden: ["kills"], ageYears: [-40] });
		expect(vm.allHidden).toBe(true);
	});

	it("draws the separator alone in all four shapes, and gives no bare year a season column", () => {
		const main = readRepo("templates/dialogs/timeline.hbs");
		expect(main).toContain("{{#if startsYear}} auto{{/if}}{{#unless ageMark}} minmax(15rem, 19rem){{/unless}}");
		expect(main).toContain("{{#if startsYear}} auto{{/if}}{{#unless ageMark}} minmax(15rem, 1fr){{/unless}}");
		expect(main.match(/\{\{#unless ageMark\}\}/g).length).toBeGreaterThanOrEqual(5);
		expect(readRepo("templates/dialogs/partials/timeline-hperiod.hbs")).toMatch(/\{\{#unless ageMark\}\}\s*<li class="stonetop-timeline-hperiod/);
		expect(readRepo("templates/dialogs/partials/timeline-period.hbs")).toMatch(/\{\{#unless ageMark\}\}\s*<section class="stonetop-timeline-period"/);
	});
});
