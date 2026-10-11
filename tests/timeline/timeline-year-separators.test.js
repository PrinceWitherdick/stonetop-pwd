// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import Handlebars from "handlebars";
import { readRepo, readCss, declarations } from "../fakes/css.js";

// ACROSS THE PAGE, A YEAR OPENS WITH A SEPARATOR, as it does read down (user, 2026-10-04): a column
// of its own with the year's chip (and in the swimlanes a red rule through it). Both Across shapes lay their columns out
// from the template's own list, so a separator the list forgot (or a rule cell a thread's row
// forgot) shifts every column after it one place. Rendered here, so the count is checked for real.

const CSS = readCss();

function render({ single, periods, tracks = [] }) {
	const hbs = Handlebars.create();
	hbs.registerHelper("localize", key => key);
	hbs.registerPartial("stonetop.timeline-period-head", "");
	hbs.registerPartial("stonetop.timeline-card", "");
	hbs.registerPartial("stonetop.timeline-lane-head", "");
	hbs.registerPartial("stonetop.timeline-period", "");
	hbs.registerPartial("stonetop.timeline-hperiod", readRepo("templates/dialogs/partials/timeline-hperiod.hbs"));
	hbs.registerPartial("stonetop.timeline-year-chip", readRepo("templates/dialogs/partials/timeline-year-chip.hbs"));
	const html = hbs.compile(readRepo("templates/dialogs/timeline.hbs"))({
		horizontal: true,
		single,
		timeline: {
			periods: periods.map(p => ({ ...p, lanes: tracks.map(t => ({ trackId: t, entries: [] })) })),
			tracks: tracks.map(trackId => ({ trackId })),
			swimlanes: tracks.map((trackId, index) => ({
				trackId,
				// As buildAggregateVM stamps them: a cell opens the year its season does.
				cells: periods.map(p => ({ trackId, entries: [], isEmpty: true, index, opensYear: p.startsYear })),
			})),
		},
	});
	const root = document.createElement("div");
	root.innerHTML = html;
	return root;
}

const PERIODS = [
	{ key: "u", undated: true, startsYear: false },
	{ key: "1s", year: 1, yearLabel: "Year One", yearCount: "Year One", yearTail: "", startsYear: true },
	{ key: "1u", year: 1, yearLabel: "Year One", yearCount: "Year One", yearTail: "", startsYear: false },
	{ key: "2s", year: 2, yearLabel: "Year Two", yearCount: "Year Two", yearTail: "", startsYear: true },
];

/** The grid's column list, off the inline custom property the template writes. */
function columns(el, prop) {
	const list = el.getAttribute("style").match(new RegExp(`${prop}:([^;]+);`))[1];
	return list.trim().split(/ (?=auto|minmax|15rem)/);
}

describe("year separators across the page", () => {
	it("opens each year on the single thread's axis with a column of its own", () => {
		const root = render({ single: true, periods: PERIODS });
		const track = root.querySelector(".stonetop-timeline-htrack");
		const items = [...track.children];
		expect(items.map(li => li.className.split(" ")[0])).toEqual([
			"stonetop-timeline-hperiod",
			"stonetop-timeline-hyear", "stonetop-timeline-hperiod",
			"stonetop-timeline-hperiod",
			"stonetop-timeline-hyear", "stonetop-timeline-hperiod",
		]);
		expect(track.querySelectorAll(".stonetop-timeline-hyear .stonetop-year-chip")[1].textContent).toBe("Year Two");
		// One listed column per item, the separators' sized to their chip.
		const cols = columns(track, "--timeline-hcols");
		expect(cols).toHaveLength(items.length);
		items.forEach((li, i) => expect(cols[i]).toBe(li.matches(".stonetop-timeline-hyear") ? "auto" : "minmax(min-content, 19rem)"));
	});

	it("gives every swimlane row a rule cell under each year's chip", () => {
		const root = render({ single: false, periods: PERIODS, tracks: ["a", "b"] });
		const swim = root.querySelector(".stonetop-timeline-swim");
		const cols = columns(swim, "--timeline-swim-cols");
		const cells = [...swim.children];
		// The heads row, from the second column (no corner cell: the stylesheet starts it there), then
		// one row per thread, each exactly as wide as the column list.
		const heads = cells.slice(0, cols.length - 1);
		const rows = [[null, ...heads]];
		for (let i = heads.length; i < cells.length; i += cols.length) rows.push(cells.slice(i, i + cols.length));
		expect(cells.length).toBe(cols.length * 3 - 1);
		expect(declarations(CSS, ".stonetop-timeline-swim > :first-child")).toMatch(/grid-column-start:\s*2/);
		expect(heads.map(c => c.className.split(" ")[0])).toEqual([
			"stonetop-timeline-swim-head",
			"stonetop-timeline-swim-year", "stonetop-timeline-swim-head",
			"stonetop-timeline-swim-head",
			"stonetop-timeline-swim-year", "stonetop-timeline-swim-head",
		]);
		for (const row of rows.slice(1)) {
			expect(row[0].matches(".stonetop-timeline-swim-lane-head")).toBe(true);
			row.forEach((cell, i) => {
				const separator = !!rows[0][i]?.matches(".stonetop-timeline-swim-year");
				expect(cell.matches(".stonetop-timeline-swim-year-rule"), `column ${i}`).toBe(separator);
				if (separator) expect(cols[i]).toBe("auto");
			});
		}
	});

	it("draws the swimlanes' separators in a 2px bright red, at the vertical heading's size", () => {
		for (const sel of [".stonetop-timeline-swim-year::after", ".stonetop-timeline-swim-year-rule"]) {
			expect(declarations(CSS, sel), sel).toMatch(/border-left:\s*2px solid var\(--st-red-border\)/);
		}
		// The single thread (only ever a sheet's tab) keeps the chip and draws NO red rule (user,
		// 2026-10-04).
		expect(CSS).not.toMatch(/\.stonetop-timeline-hyear(-node)?::(before|after)\s*\{[^}]*--st-red-border/);
		// No panel fill on the swimlanes' year cell: it showed as a grey box round the chip. But a
		// backing in the page's own colour, so the threads' rule cells scrolling up under the pinned
		// cell never show above the chip (user, 2026-10-04).
		expect(declarations(CSS, ".stonetop-timeline-swim-year")).toMatch(/background:\s*var\(--st-page\);/);
		for (const sel of [".stonetop-timeline-hyear-node", ".stonetop-timeline-swim-year"]) {
			expect(declarations(CSS, sel), sel).toMatch(/font-size:\s*1\.7em/);
		}
		expect(declarations(CSS, ".stonetop-timeline-htrack")).toContain("grid-template-columns: var(--timeline-hcols");
		expect(declarations(CSS, ".stonetop-timeline-swim")).toContain("grid-template-columns: var(--timeline-swim-cols");
	});
});

describe("the swimlanes' thread names scroll off with their lanes", () => {
	// Pinned at the left only: scrolled down, a name goes up and off with its lane rather than
	// sticking under the season heads while its box shrinks round it (user, 2026-10-04).
	it("does not pin a name's contents inside its cell", () => {
		expect(declarations(CSS, ".stonetop-timeline-swim-lane-head > *")).toBeNull();
		expect(declarations(CSS, ".stonetop-timeline-swim-lane-head")).toMatch(/left:\s*0/);
	});

	// The column heads always go under the row heads (user, 2026-10-04).
	it("stacks the names over the season heads and year separators", () => {
		const z = sel => Number(declarations(CSS, sel).match(/z-index:\s*(\d+)/)[1]);
		const names = z(".stonetop-timeline-swim-lane-head");
		expect(names).toBeGreaterThan(z(".stonetop-timeline-swim-head"));
		expect(names).toBeGreaterThan(z(".stonetop-timeline-swim-year"));
	});

	it("draws no corner cell over the names", () => {
		const root = render({ single: false, periods: PERIODS, tracks: ["a"] });
		expect(root.querySelector(".stonetop-timeline-swim-corner")).toBeNull();
		expect(CSS).not.toContain("stonetop-timeline-swim-corner");
	});
});

describe("a year before play's long name", () => {
	// "Four Years Before Year One" (user, 2026-10-10): the season heading holding it is wider than a
	// fixed 15rem column, and ran on over the next year's separator. Each Across column grows to its
	// head instead, floored at 15rem by the item (a floor on the TRACK would win over the content);
	// the Down board's fixed 170px column wraps the chip, and its year chip centres only when it fits.
	it("never lets a season's head outgrow its column", () => {
		expect(declarations(CSS, ".stonetop-timeline-hperiod")).toMatch(/min-width:\s*15rem/);
		expect(declarations(CSS, ".stonetop-timeline-swim-head")).toMatch(/min-width:\s*15rem/);
		const main = readRepo("templates/dialogs/timeline.hbs");
		expect(main).not.toContain("minmax(15rem,");
		expect(declarations(CSS, ".stonetop-timeline-row-head .stonetop-year-chip")).toMatch(/white-space:\s*normal/);
		expect(declarations(CSS, ".stonetop-timeline-row-head .stonetop-year-chip")).toMatch(/max-width:\s*100%/);
		expect(declarations(CSS, ".stonetop-timeline-year-cell")).toMatch(/justify-content:\s*safe center/);
	});

	// User, 2026-10-10: "keep the font size for 'Four Years' and make the 'Before Year One' much
	// smaller but still readable". The count stays the chip's own text; the tail is a small of its own,
	// half the chip's size but floored in rem, and a year of play has no tail at all.
	it("prints the count at the chip's size and the tail small", () => {
		const root = render({ single: true, periods: [
			{ key: "-3s", year: -3, yearLabel: "Four Years Before Year One", yearCount: "Four Years", yearTail: "Before Year One", startsYear: true },
			...PERIODS.slice(1),
		] });
		const [before, one] = root.querySelectorAll(".stonetop-timeline-hyear .stonetop-year-chip");
		expect(before.textContent).toBe("Four Years Before Year One");
		expect(before.querySelector(".stonetop-year-chip-tail").textContent).toBe("Before Year One");
		expect(one.querySelector(".stonetop-year-chip-tail")).toBeNull();
		const tail = declarations(CSS, ".stonetop-year-chip-tail");
		expect(tail).toMatch(/font-size:\s*max\(0\.55em,\s*0\.8rem\)/);
		expect(tail).toMatch(/white-space:\s*nowrap/);
	});

	it("splits every timeline year chip the same way", () => {
		expect(readRepo("templates/dialogs/partials/timeline-year-chip.hbs"))
			.toContain('<small class="stonetop-year-chip-tail">{{yearTail}}</small>');
		for (const f of ["timeline.hbs", "partials/timeline-period.hbs", "partials/timeline-hperiod.hbs"]) {
			const src = readRepo(`templates/dialogs/${f}`);
			expect(src, f).not.toContain('<span class="stonetop-year-chip">');
			expect(src, f).toContain("{{> stonetop.timeline-year-chip}}");
		}
	});

	// User, 2026-10-10: in a season's own heading the tail is cut to "BYO", the whole of it on hover.
	it("cuts the season heading's tail to BYO", () => {
		const hb = Handlebars.create();
		const head = hb.compile(readRepo("templates/dialogs/partials/timeline-period-head.hbs"));
		const chip = (vm) => {
			const root = document.createElement("div");
			root.innerHTML = head({ seasonLabel: "Spring", seasonNotes: [], ...vm });
			return root.querySelector(".stonetop-year-chip");
		};
		const before = chip({ yearCount: "Four Years", yearTail: "Before Year One", yearTailShort: "BYO" });
		expect(before.textContent).toBe("Four Years BYO");
		expect(before.querySelector(".stonetop-year-chip-tail abbr").dataset.tooltip).toBe("Before Year One");
		expect(chip({ yearCount: "Year Two", yearTail: "", yearTailShort: "" }).textContent).toBe("Year Two");
	});
});

describe("the single thread's stalks", () => {
	// A stalk runs from the cards all the way to their season's node, however tall the row of nodes
	// is (user, 2026-10-04: "the vertical line from the bottom of The first spring should connect to
	// the top of the Spring chip"), and a season without cards draws none.
	it("marks only a season with cards", () => {
		const hbs = Handlebars.create();
		hbs.registerPartial("stonetop.timeline-period-head", "");
		hbs.registerPartial("stonetop.timeline-card", "<li></li>");
		const tpl = hbs.compile(readRepo("templates/dialogs/partials/timeline-hperiod.hbs"));
		const root = document.createElement("ol");
		root.innerHTML = tpl({ key: "a", above: true, entries: [{}] }) + tpl({ key: "b", entries: [] });
		const [withCards, without] = root.querySelectorAll(".stonetop-timeline-hperiod");
		expect(withCards.matches(".stonetop-timeline-hperiod--cards")).toBe(true);
		expect(without.matches(".stonetop-timeline-hperiod--cards")).toBe(false);
	});

	it("runs the chip's own piece out to the node row's edge, clipped there", () => {
		expect(declarations(CSS, ".stonetop-timeline-hnode")).toMatch(/overflow-y:\s*clip/);
		expect(declarations(CSS, ".stonetop-timeline-hnode")).toMatch(/overflow-x:\s*visible/);
		expect(declarations(CSS, ".stonetop-timeline-hperiod--above .stonetop-timeline-hhead::before")).toMatch(/bottom:\s*100%/);
		expect(declarations(CSS, ".stonetop-timeline-hperiod--below .stonetop-timeline-hhead::before")).toMatch(/top:\s*100%/);
		expect(CSS).not.toContain(".stonetop-timeline-hcards:not(:empty)");
	});
});
