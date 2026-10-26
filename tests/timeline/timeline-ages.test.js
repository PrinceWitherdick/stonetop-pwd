import { describe, it, expect } from "vitest";
import { readCss, readRepo } from "../fakes/css.js";

// THE AGES: named runs of years the GM lays over the timeline (user, 2026-10-07), stored as
// campaign-relative years, stacked when they overlap, each given a colour no Age has worn before.

const {
	normalizeAge, normalizeAges, agesToStored, agesInView, stackAges, ageStrip,
	nextAgeColour, ageColourAt, hexHue, hslHex, cleanAgeName, AGE_NAME_MAX, BOOK_AGES, bookAgesToAdd,
	ageFillYears, AGE_YEAR_PITCH_REM, AGE_FONT_REM,
} = await import("../../module/timeline/timeline-ages.js");
const { MIN_HISTORY_YEAR } = await import("../../module/seasons/campaign-year.js");
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

describe("the book's Ages", () => {
	const text = key => ({ name: `Name ${key}`, when: `When ${key}` });

	it("are Book II's six, oldest first, back to back, the Current Age still running", () => {
		const { added } = bookAgesToAdd({ text });
		expect(added.map(age => age.id)).toEqual(BOOK_AGES.map(age => age.id));
		const lasting = added.filter(age => age.id !== "bookRecentMemory");
		lasting.slice(1).forEach((age, i) => expect(age.from).toBe(lasting[i].to + 1));
		expect(added.find(age => age.id === "bookCurrent").to).toBeNull();
		expect(added.find(age => age.id === "bookRecentMemory")).toMatchObject({ from: -9, to: 0 });
		expect(added[0].from).toBe(MIN_HISTORY_YEAR);
	});

	it("carry the book's words, each its own colour from the walk", () => {
		const { added, seq } = bookAgesToAdd({ text, seq: 3 });
		expect(added[0]).toMatchObject({ name: "Name primordial", when: "When primordial" });
		expect(new Set(added.map(age => age.colour)).size).toBe(added.length);
		expect(seq).toBeGreaterThan(3 + added.length - 1);
	});

	it("leave alone one the world already holds, and the GM's own Ages", () => {
		const ages = [{ id: "bookMakers", name: "Renamed", from: 1, to: 2, colour: "#111111" }];
		const { added } = bookAgesToAdd({ ages, text });
		expect(added.map(age => age.id)).not.toContain("bookMakers");
		expect(added).toHaveLength(BOOK_AGES.length - 1);
	});

	it("are named and worded in en.json", () => {
		const en = JSON.parse(readRepo("languages/en.json")).stonetop.timeline.ages;
		for (const { key } of BOOK_AGES) {
			expect(en.book[key].name).toBeTruthy();
			expect(en.book[key].when).toBeTruthy();
		}
	});

	it("keep their words through the editor while their years stay, and lose them once moved", () => {
		const age = normalizeAge({ id: "bookCurrent", name: "The Current Age", from: -400, to: null, colour: "#111111", when: "Starting a few centuries ago" });
		const [row] = unseenAges([age], new Set());
		expect(readDraftRow(row).age.when).toBe("Starting a few centuries ago");
		expect(readDraftRow({ ...row, fromText: "-40" }).age.when).toBeUndefined();
		expect(readDraftRow({ ...row, toText: "5" }).age.when).toBeUndefined();
	});
});

describe("the strip in the timeline", () => {
	it("is drawn after the column, in its cell, and each band is placed by the script", () => {
		const main = readRepo("templates/dialogs/timeline.hbs");
		expect(main).toMatch(/class="stonetop-timeline-ages"/);
		expect(main).toMatch(/data-age-first="\{\{this\.first\}\}" data-age-last="\{\{this\.last\}\}"/);
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

	it("shares an Age's name out over every bare year inside it, the year asking most keeping its own", () => {
		const written = [{ key: "1:spring", year: 1, rank: 7 }];
		const ages = [
			{ from: -40, to: -20, name: "The Time of the Barrow Builders" },
			{ from: -40, to: null, name: "Short" },
		];
		const marks = withAgeMarks(written, [-40, -30, -20, -10], ages);
		const at = year => marks.find(p => p.year === year && p.ageMark);
		// The Barrow Builders over three years, a third each; "Short" over all four, a quarter each.
		expect(at(-40)).toMatchObject({ ageRoom: "The Time of the Barrow Builders", ageRoomShare: 1 / 3 });
		expect(at(-20)).toMatchObject({ ageRoom: "The Time of the Barrow Builders", ageRoomShare: 1 / 3 });
		expect(at(-10)).toMatchObject({ ageRoom: "Short", ageRoomShare: 1 / 4 });
	});

	it("shares the name over the written years' separators only when an Age has no bare year", () => {
		const written = [
			{ key: "-41:winter", year: -41, rank: 20 },
			{ key: "-40:spring", year: -40, rank: 31 },
			{ key: "-40:winter", year: -40, rank: 34 },
			{ key: "1:spring", year: 1, rank: 70 },
		];
		const ages = [
			{ from: -41, to: -40, name: "The Long Winters" },
			{ from: -50, to: null, name: "Bare" },
		];
		const periods = withAgeMarks(written, [-50], ages);
		const at = key => periods.find(p => p.key === key);
		// Two written years, a half each, on the period that opens each year; never on a later season.
		expect(at("-41:winter")).toMatchObject({ ageRoom: "The Long Winters", ageRoomShare: 1 / 2 });
		expect(at("-40:spring")).toMatchObject({ ageRoom: "The Long Winters", ageRoomShare: 1 / 2 });
		expect(at("-40:winter").ageRoom).toBeUndefined();
		// An Age with a bare year keeps its name there, off its written years.
		expect(at("-50:age")).toMatchObject({ ageRoom: "Bare", ageRoomShare: 1 });
		expect(at("1:spring").ageRoom).toBeUndefined();
	});

	it("draws the name unseen in the bare year's separator, at its share, in all four shapes", () => {
		const vm = buildTrackVM({ trackId: "pc", entries: [entry()] }, { ageYears: [-40], ages: [{ from: -40, to: null, name: "The Current Age" }] });
		expect(vm.periods[0]).toMatchObject({ ageMark: true, ageRoom: "The Current Age", ageRoomShare: 1 });
		const room = `{{#if ageRoom}}<span class="stonetop-timeline-age-room" aria-hidden="true" style="--age-room-share: {{this.ageRoomShare}};">{{this.ageRoom}}</span>{{/if}}`;
		const count = path => readRepo(path).split(room).length - 1;
		expect(count("templates/dialogs/timeline.hbs")).toBe(2);
		expect(count("templates/dialogs/partials/timeline-period.hbs")).toBe(1);
		expect(count("templates/dialogs/partials/timeline-hperiod.hbs")).toBe(1);
		const css = readCss();
		const rule = selector => css.slice(css.indexOf(`${selector} {`)).split("}")[0];
		expect(rule(".stonetop-timeline-age-room")).toContain("visibility: hidden;");
		expect(rule(".stonetop-timeline-age-room")).toContain("font-size: calc(var(--timeline-age-font) * var(--age-room-share, 1));");
		expect(rule(".stonetop-timeline-age")).toContain("font-size: var(--timeline-age-font);");
		expect(css).toContain(`--timeline-age-font: calc(${AGE_FONT_REM}rem *`);
	});

	it("counts a bare year's pitch from the sizes the stylesheet draws it at", () => {
		// AGE_YEAR_PITCH_REM is copied from these by hand: a restyle that moves one must move it too,
		// or long names get too few in-between years again (or the timeline fills with empty ones).
		const css = readCss();
		const rule = selector => css.slice(css.indexOf(`${selector} {`)).split("}")[0];
		const rem = text => Number(text.match(/([\d.]+)rem/)[1]);
		const px = text => Number(text.match(/(\d+)px/)[1]) / 16;
		const spacer = rem(rule(".stonetop-timeline-hyear[data-age-mark]::before").match(/width: [^;]+/)[0]);
		const sidePad = px(rule(".stonetop-timeline-hyear").match(/padding: [^;]+/)[0]);
		expect(AGE_YEAR_PITCH_REM.across).toBe(spacer + 2 * sidePad);
		const floor = rem(rule(".stonetop-timeline-year[data-age-mark]").match(/min-height: [^;]+/)[0]);
		const gap = px(rule(".stonetop-timeline-year").match(/margin: [^;]+/)[0]);
		expect(AGE_YEAR_PITCH_REM.down).toBe(floor + gap);
	});

	it("gives a long-named Age years in between, round in the years as the world calls them", () => {
		const age = { from: -9999, to: -6001, name: "The Time of the Barrow Builders" };
		const years = ageFillYears(age, { pitch: AGE_YEAR_PITCH_REM.down, start: 1249 });
		expect(years.length).toBeGreaterThan(0);
		for (const year of years) {
			expect(year).toBeGreaterThan(age.from);
			expect(year).toBeLessThan(age.to);
			expect(Math.abs((year + 1248) % 100)).toBe(0);
		}
		expect(ageMarkYears([age], { pitch: AGE_YEAR_PITCH_REM.down, start: 1249 })).toEqual([-9999, ...years.sort((a, b) => a - b), -6001]);
	});

	it("gives none where its own years carry the name, more as the type grows, and a running Age to the clock", () => {
		const age = { from: -40, to: -20, name: "Short" };
		expect(ageFillYears(age, { pitch: AGE_YEAR_PITCH_REM.across })).toEqual([]);
		const long = { from: -400, to: null, name: "The Time of the Barrow Builders" };
		const small = ageFillYears(long, { pitch: AGE_YEAR_PITCH_REM.down, nowYear: 1 });
		const big = ageFillYears(long, { pitch: AGE_YEAR_PITCH_REM.down, nowYear: 1, fontScale: 2 });
		expect(big.length).toBeGreaterThan(small.length);
		for (const year of big) expect(year > -400 && year < 1).toBe(true);
		expect(ageFillYears({ from: 1, to: 2, name: "x".repeat(60) }, { pitch: 1 })).toEqual([]);
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
		expect(main).toContain("{{#if startsYear}} auto{{/if}}{{#unless ageMark}} minmax(min-content, 19rem){{/unless}}");
		expect(main).toContain("{{#if startsYear}} auto{{/if}}{{#unless ageMark}} minmax(min-content, 1fr){{/unless}}");
		expect(main.match(/\{\{#unless ageMark\}\}/g).length).toBeGreaterThanOrEqual(5);
		expect(readRepo("templates/dialogs/partials/timeline-hperiod.hbs")).toMatch(/\{\{#unless ageMark\}\}\s*<li class="stonetop-timeline-hperiod/);
		expect(readRepo("templates/dialogs/partials/timeline-period.hbs")).toMatch(/\{\{#unless ageMark\}\}\s*<section class="stonetop-timeline-period[{"]/);
	});
});
