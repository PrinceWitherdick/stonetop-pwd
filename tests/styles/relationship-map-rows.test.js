import { describe, it, expect } from "vitest";
import { readCss, readRepo, declarations } from "../fakes/css.js";

// THE RELATIONSHIP MAP WINDOW IS A GRID, AND ITS ROWS ARE NAMED ONE BY ONE.
//
// ⚠ WHY THIS FILE EXISTS. The window used to be a grid relying on AUTO-PLACEMENT, and the day a
// child (the page strip) was added above the viewport, the board landed in an `auto` row and
// collapsed to ZERO HEIGHT: a window with a bar, a strip, and no map at all, from a change that
// never touched the viewport's own rule. Nothing logged, nothing threw, and every unit test in the
// feature went on passing — the markup was all present and correct, in a box no pixels high.
//
// A row has since been REMOVED as well: the toolbar over the board is gone, its buttons moved down
// into the footer, and the four rows that are left renumbered. That is the same fault from the
// other direction, which is why the count is asserted and not only the shape.
//
// It cannot happen again, because every child names its row. This suite is what holds that true:
// it checks that each element the template puts directly inside the root has a `grid-row`, that
// the numbers run 1..n without a gap or a repeat, and that the viewport's row is the `1fr` one
// (an `auto` row there sizes to the board's own 960px and pushes the window's scrollbar out
// instead of clipping).
//
// It also pins the single COLUMN. An implicit grid column is `minmax(auto, max-content)`, so it
// grows past the window to fit the widest row: twelve named boards measured 1825px of grid inside a
// 760px window, carrying the page tools off the right-hand edge. Every row here deals with not
// fitting in its own way (the strip scrolls, the footer wraps, the viewport clips), and all three
// of those need the column pinned to the width there actually is.

const CSS = readCss();
const WINDOW_TEMPLATE = readRepo("templates/dialogs/relationship-map.hbs");

const ROOT_RULE = declarations(CSS, ".stonetop-relmap");

/** The `grid-row` one selector declares, or null. */
function gridRow(selector) {
	const body = declarations(CSS, selector);
	const found = body?.match(/grid-row\s*:\s*([^;]+);/);
	return found ? found[1].trim() : null;
}

/**
 * Every class the template puts DIRECTLY inside the window's root, read off the template itself
 * rather than listed here.
 *
 * A list written out in this file would be a list that goes out of date the moment somebody adds a
 * sixth child, which is exactly the change this suite exists to catch. So it is read from the
 * markup: two-space indentation inside the root element is one level deep, which is the house
 * style the whole file is written in and is what makes this scannable without a parser.
 */
function directChildClasses() {
	const found = new Set();
	for (const line of WINDOW_TEMPLATE.split("\n")) {
		const m = line.match(/^ {2}<(?:div|p|section|nav)\s+class="(stonetop-relmap-[a-z-]+)/);
		if (m) found.add(m[1]);
	}
	return [...found];
}

describe("the relationship map window's grid", () => {
	it("is a grid with four rows and the viewport's the flexible one", () => {
		// The page strip, the viewport, the footer, and the live region. There is no toolbar row:
		// every button this window has now stands in the footer under the board.
		const rows = ROOT_RULE?.match(/grid-template-rows\s*:\s*([^;]+);/)?.[1].trim();
		expect(rows).toBe("auto 1fr auto auto");
	});

	// ⚠ The `1fr` must be the row the VIEWPORT is on. Those two facts live in two different rules,
	// which is exactly how they come apart.
	it("puts the viewport on the row that takes what is left", () => {
		const rows = ROOT_RULE.match(/grid-template-rows\s*:\s*([^;]+);/)[1].trim().split(/\s+/);
		const viewportRow = Number(gridRow(".stonetop-relmap-view"));
		expect(rows[viewportRow - 1]).toBe("1fr");
	});

	// The break this whole file is about: a child with no row of its own is placed automatically,
	// and auto-placement is what silently pushed the board onto a zero-height row.
	it("gives every direct child of the window a row of its own", () => {
		const children = directChildClasses();
		// A sanity floor on the scan itself: if the reading above ever stops finding the markup,
		// this suite must fail rather than quietly assert nothing at all.
		expect(children.length).toBeGreaterThanOrEqual(4);
		for (const cls of children) {
			expect(gridRow(`.${cls}`), `.${cls} has no grid-row`).toBeTruthy();
		}
	});

	it("numbers those rows 1 upwards with no gap and no two children sharing one", () => {
		const rows = directChildClasses().map(cls => Number(gridRow(`.${cls}`)));
		expect(new Set(rows).size).toBe(rows.length);
		expect([...rows].sort((a, b) => a - b)).toEqual(rows.map((_, i) => i + 1));
	});

	// An implicit column is `minmax(auto, max-content)` and grows past the window. Measured: a
	// twelve-board strip made the grid 1825px wide inside a 760px window.
	it("pins its one column to the width there actually is", () => {
		const columns = ROOT_RULE?.match(/grid-template-columns\s*:\s*([^;]+);/)?.[1].trim();
		expect(columns).toBe("minmax(0, 1fr)");
	});
});

describe("the page strip inside that row", () => {
	// The tabs keep their width and the strip scrolls. Left shrinkable, twelve boards were squeezed
	// to a few pixels of ellipsis each: the row fitted perfectly and no tab could be told from any
	// other, which is worse than a row that has to be scrolled.
	it("lets its tabs keep their width", () => {
		expect(declarations(CSS, ".stonetop-relmap-page")).toMatch(/flex\s*:\s*none/);
	});

	it("scrolls sideways rather than wrapping or pushing the tools off", () => {
		const strip = declarations(CSS, ".stonetop-relmap-pages-strip");
		expect(strip).toMatch(/overflow-x\s*:\s*auto/);
		// ⚠ `min-width: 0` is what actually lets it shrink: a flex item's floor is its own content,
		// so without it the strip refuses to be narrower than all its tabs and shoves the page tools
		// out of the window instead of scrolling.
		expect(strip).toMatch(/min-width\s*:\s*0/);
		expect(declarations(CSS, ".stonetop-relmap-pages-tools")).toMatch(/flex\s*:\s*none/);
	});

	// ⚠ IT SHRINKS BUT DOES NOT GROW. Grown to fill the row, the strip's right edge was the
	// window's right edge whether it held two tabs or twelve, and the plus that follows it went to
	// the far corner with it — nowhere near the names it adds to. Held to its content, the strip
	// ends where the last tab ends and the plus sits against it, which is where a new tab appears.
	it("holds the strip to the width of its tabs rather than growing it", () => {
		const strip = declarations(CSS, ".stonetop-relmap-pages-strip");
		expect(strip).toMatch(/flex\s*:\s*0\s+1\s+auto/);
	});

	// The other half of that placement: the row's leftover width is spent BETWEEN the plus and the
	// rename/delete pair, which is what reads the first as part of the strip and holds the other
	// two at the row's own right-hand corner. `align-self` because the row stretches its children
	// and this button no longer sits in the group that centres its own.
	it("spends the row's spare width after the plus, not before it", () => {
		const plus = declarations(CSS, ".stonetop-relmap-pages .stonetop-relmap-page-tool--new");
		expect(plus).toMatch(/margin\s*:\s*0\s+auto\s+0\s+0/);
		expect(plus).toMatch(/align-self\s*:\s*center/);
	});

	// Which tab is up is the most load-bearing thing on this row, and there is a reader at this
	// table on a screen magnifier for whom a two-tone difference between two words is no difference
	// at all. So it is said three ways: ink, weight, and an underline.
	it("marks the current tab by more than its colour", () => {
		const current = declarations(CSS, ".stonetop-relmap-page.is-current");
		expect(current).toMatch(/border-bottom-color\s*:/);
		expect(current).toMatch(/font-weight\s*:/);
		expect(current).toMatch(/color\s*:/);
	});
});

// ── Where a board stands, on the one control that says so ───────────────────────────────────────
//
// Every board of a map starts hidden, and the eye beside the pen shows one to the table. That eye
// is the ONLY place the strip says where a board stands: the tabs briefly carried a mark of their
// own, and it was one glyph too many on the row whose whole job is to say which board is up.
describe("a board the players can see", () => {
	// The tab is a single text child again, so nothing here may reintroduce a shape that only made
	// sense with a glyph beside the name.
	it("leaves the tabs carrying nothing but their name", () => {
		const tab = declarations(CSS, ".stonetop-relmap-page");
		expect(tab).not.toMatch(/grid-auto-flow/);
		expect(tab).toMatch(/text-overflow\s*:\s*ellipsis/);
	});

	// The eye is the one tool on this row that reports as well as acts, so it is the one that is
	// ever lit. Through the hover rule as well as under it, because the two tie on specificity and
	// the hover would otherwise take the ink straight back the moment a pointer crossed it.
	it("lights the eye on a board the table is looking at, hover included", () => {
		const lit = declarations(
			CSS,
			".stonetop-relmap-page-tool--seen:not(.is-hidden-board):focus-visible",
		);
		expect(lit).toMatch(/color\s*:/);
		expect(CSS.indexOf(".stonetop-relmap-page-tool--seen"))
			.toBeGreaterThan(CSS.indexOf(".stonetop-relmap-page-tool:hover"));
	});
});
