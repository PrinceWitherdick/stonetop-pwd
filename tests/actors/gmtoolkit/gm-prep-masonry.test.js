import { describe, it, expect, afterEach } from "vitest";
import { readRepo as read, readCss, declarations, ownRule } from "../../fakes/css.js";
import { packGmPrepGrid, wireGmPrepMasonry, GM_PREP_GRID_SELECTOR, GM_PREP_CARD_SELECTOR }
	from "../../../module/actors/gmtoolkit/gm-prep-masonry.js";

// The Sites tab's card grid, packed by measured height.
//
// The defect this closes: `.steading-threats-grid` is a CSS grid, and a grid couples its items
// into ROWS. A foundation-only site (about 80px) sitting beside a fully written-up one (about
// 560px) holds its row open for the difference, so the tab reads as a ragged, half-empty column.
// Measured against the real sheet at its 820px default, six sites left 160px of holes.
//
// The trap on the other side is a lone card. `repeat(auto-fit, ...)` COLLAPSES the empty track,
// so one card spans the full width today; wrapping a single packed column around it would halve
// it. That case is left flat on purpose, and is the assertion most likely to catch a "simplify"
// pass that drops the `colCount < 2` branch.

const MASONRY_JS = read("module/actors/gmtoolkit/gm-prep-masonry.js");
const PREP_JS    = read("module/actors/gmtoolkit/gm-prep-tabs.js");
const SHEET_JS   = read("module/actors/gmtoolkit/StonetopGmToolkitSheet.js");
const SITES_HBS  = read("templates/actor/partials/gm-toolkit-tab-sites.hbs");
const THREATS_HBS = read("templates/actor/partials/gm-toolkit-tab-threats.hbs");
const CSS = readCss();

/**
 * A DOM stand-in with the one thing tests/fakes/dom.js has no model of: LAYOUT. The packer reads
 * `offsetHeight` and `offsetLeft` off cards and hands columns back to the container, so heights
 * and x-positions are the whole input — everything else here exists only to carry them.
 *
 * `layout()` is what a browser does between the reset and the measure: it deals the flat cards
 * into `cols` tracks left to right, which is what `auto-fit` produces and what the packer reads
 * the column count back out of.
 */
const TRACK_X = [0, 393];
function fakeGrid(heights, { cols = 2 } = {}) {
	const mk = (className, tag) => {
		const el = {
			className, tag, children: [],
			offsetHeight: 0, offsetLeft: 0,
			appendChild(child) { el.children.push(child); return child; },
			append(...kids) { el.children.push(...kids); },
			replaceChildren(...kids) { el.children = [...kids]; },
			querySelectorAll: sel => (sel === GM_PREP_CARD_SELECTOR ? el.children.filter(c => c.isCard) : []),
		};
		return el;
	};
	globalThis.document = { createElement: tag => mk("", tag) };

	const cards = heights.map((h, i) => {
		const card = mk("threat-card-wrap");
		card.isCard = true;
		card.offsetHeight = h;
		card.index = i;
		return card;
	});
	const grid = mk("steading-threats-grid");
	grid.clientWidth = 770;
	grid.replaceChildren(...cards);
	// Flat layout: card i lands in track i % cols, which is what the packer counts.
	const layout = () => cards.forEach((card, i) => { card.offsetLeft = TRACK_X[i % cols]; });
	layout();
	// Re-laying out after every reset is what a real browser does; the packer resets before it
	// measures, so without this the second pack would read stale x-positions.
	const reset = grid.replaceChildren;
	grid.replaceChildren = (...kids) => { reset(...kids); if (kids.every(k => k.isCard)) layout(); };
	return { grid, cards };
}

/** Which cards ended up in which column, by their authored index. */
const columnsOf = grid => grid.children
	.filter(c => c.className === "steading-threats-col")
	.map(col => col.children.map(card => card.index));

afterEach(() => { delete globalThis.document; });

describe("prep-card grid packing", () => {
	it("fills the shortest column, so a short card never holds a row open", () => {
		// Row-aligned, these six pair up 0|1, 2|3, 4|5 and leave 74 + 54 + 32 = 160px of holes.
		const { grid } = fakeGrid([82, 156, 332, 386, 531, 563]);
		packGmPrepGrid(grid);

		const cols = columnsOf(grid);
		expect(cols).toEqual([[0, 2, 4], [1, 3, 5]]);
		// The point of the exercise: each column is a tight stack of its own cards' heights.
		const totals = cols.map(col => col.reduce((sum, i) => sum + [82, 156, 332, 386, 531, 563][i], 0));
		expect(totals).toEqual([945, 1105]);
	});

	it("puts a tall card's neighbour beside it rather than under the next row", () => {
		// One card taller than the rest of the list put together. Row-aligned it would leave a
		// vast hole; packed, every other card stacks in the other column.
		const { grid } = fakeGrid([900, 100, 100, 100]);
		expect(packGmPrepGrid(grid)).toBeUndefined();
		expect(columnsOf(grid)).toEqual([[0], [1, 2, 3]]);
	});

	it("leaves a lone card flat, so auto-fit's collapsed track still spans the full width", () => {
		const { grid, cards } = fakeGrid([82], { cols: 1 });
		packGmPrepGrid(grid);
		expect(grid.children).toEqual(cards);
		expect(columnsOf(grid)).toEqual([]);
	});

	it("leaves a one-track grid flat however many cards it holds", () => {
		// A narrow sheet: auto-fit gives one track, so every card already spans it.
		const { grid, cards } = fakeGrid([82, 156, 332], { cols: 1 });
		packGmPrepGrid(grid);
		expect(grid.children).toEqual(cards);
	});

	it("does not pack a hidden tab, and leaves no guard behind to stop it later", () => {
		// Cards in an inactive tab measure 0. Packing on those heights would put everything in
		// column one; setting the width guard would then hold that packing after the tab is shown.
		const { grid, cards } = fakeGrid([0, 0, 0]);
		packGmPrepGrid(grid);
		expect(grid.children).toEqual(cards);
		expect(grid._packedWidth).toBeUndefined();

		cards.forEach((card, i) => { card.offsetHeight = [82, 156, 332][i]; });
		packGmPrepGrid(grid);
		expect(columnsOf(grid)).toEqual([[0, 2], [1]]);
	});

	it("keeps an unmeasurable card in the tree rather than dropping it", () => {
		const { grid } = fakeGrid([82, 156, 0, 332]);
		packGmPrepGrid(grid);
		const kept = columnsOf(grid).flat();
		expect(kept).toHaveLength(4);
		expect(kept).toContain(2);
	});

	it("re-packs on demand, because folding a card changes height but not width", () => {
		const { grid, cards } = fakeGrid([82, 156, 332, 386]);
		const wiring = { repack: null };
		globalThis.ResizeObserver = class { observe() {} disconnect() {} };
		const root = { querySelectorAll: () => [grid] };
		Object.assign(wiring, wireGmPrepMasonry(root));
		expect(columnsOf(grid)).toEqual([[0, 2], [1, 3]]);

		// Card 0 unfolds to something enormous. Without the repack the width guard holds.
		cards[0].offsetHeight = 900;
		packGmPrepGrid(grid);
		expect(columnsOf(grid)).toEqual([[0, 2], [1, 3]]);
		wiring.repack();
		expect(columnsOf(grid)).toEqual([[0], [1, 2, 3]]);
		wiring.disconnect();
		delete globalThis.ResizeObserver;
	});
});

describe("what the packer is pointed at", () => {
	it("targets the grid and card classes both prep tabs actually emit", () => {
		expect(GM_PREP_GRID_SELECTOR).toBe(".steading-threats-grid");
		expect(GM_PREP_CARD_SELECTOR).toBe(".threat-card-wrap");
		for (const hbs of [SITES_HBS, THREATS_HBS]) {
			expect(hbs).toContain('class="steading-threats-grid"');
			expect(hbs).toContain('class="threat-card-wrap"');
		}
	});

	it("packs EVERY grid on a tab, which is what the Threats tab needs", () => {
		// Sites is one grid; Threats is four -- a grid per proximity band (Homefront / Nearby /
		// Distant) plus Hazards, each its own `.steading-threats-grid`. A `querySelector` here
		// would pack Homefront and leave the other three ragged, which is exactly the state the
		// tab was in, so the plural is the assertion.
		expect((THREATS_HBS.match(/class="steading-threats-grid"/g) ?? []).length).toBeGreaterThan(1);
		expect(MASONRY_JS).toContain("root.querySelectorAll(GM_PREP_GRID_SELECTOR)");
	});

	it("packs each of a tab's grids on its own, so one card's band stays full width", () => {
		// The Homefront band routinely holds a single threat while Nearby holds four. Packed as
		// one pool they would share a column count; packed per grid, the lone card keeps the full
		// width `auto-fit` gives it while its neighbour band still balances.
		globalThis.ResizeObserver = class { observe() {} disconnect() {} };
		const lone = fakeGrid([125], { cols: 1 });
		const band = fakeGrid([91, 204, 125, 229]);
		const wiring = wireGmPrepMasonry({ querySelectorAll: () => [lone.grid, band.grid] });

		expect(lone.grid.children).toEqual(lone.cards);   // untouched, still spanning the track
		expect(columnsOf(band.grid)).toEqual([[0, 2], [1, 3]]);
		wiring.disconnect();
		delete globalThis.ResizeObserver;
	});

	it("reads the column count off the page instead of restating the track width", () => {
		// The stylesheet is the only place `22rem` is written. A magic number here is the way
		// this silently stops matching the CSS the day the track width changes.
		expect(MASONRY_JS).toContain("offsetLeft");
		expect(MASONRY_JS).not.toMatch(/\d+\s*\*\s*16|minPx|22\s*\*|352|fitColumns/);
	});

	it("is wired on render and torn down on close", () => {
		expect(PREP_JS).toContain("this._gmPrepMasonry = wireGmPrepMasonry(root)");
		expect(PREP_JS).toContain("this._wireGmPrepMasonry(root)");
		// Folding a card is a class flip with no re-render, so the repack has to be asked for -
		// and for the ONE grid that changed, not every grid on the tab.
		expect(PREP_JS).toMatch(/this\._gmPrepMasonry\?\.repack\(\w+\.closest\(GM_PREP_GRID_SELECTOR\)\)/);
		expect(SHEET_JS).toContain("this._unwireGmPrepMasonry()");
	});
});

describe("the stylesheet's half of it", () => {
	it("still lets auto-fit decide the tracks", () => {
		const grid = declarations(CSS, ".stonetop .steading-threats-grid");
		expect(grid).toContain("repeat(auto-fit, minmax(min(100%, 22rem), 1fr))");
		expect(grid).toContain("gap: 1rem");
	});

	it("gives a packed column a stack of its own, at the grid's own gap", () => {
		const col = ownRule(CSS, ".stonetop .steading-threats-col");
		expect(col).toBeTruthy();
		expect(col).toContain("flex-direction: column");
		// Matching the grid's gap is what makes packed and unpacked read the same apart from
		// the closed holes.
		expect(col).toContain("gap: 1rem");
		// A card wider than its track would otherwise blow the column out (flex items floor at
		// their content width, not at zero).
		expect(col).toContain("min-width: 0");
	});
});
