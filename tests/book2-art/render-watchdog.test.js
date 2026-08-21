import { describe, it, expect } from "vitest";
import { readRepo as read } from "../fakes/css.js";

// Rasterising a page is the one thing this import does whose honest duration is measured in
// minutes, and for a long time it was judged by the same stopwatch as a callback that either
// fires immediately or never fires at all.
//
// What that cost, on a real import: 543 of 545 pictures came through, and the two that did not
// were BOTH of the Book II regional maps, both at exactly 60 seconds, both with the same message
// ("timed out after 60s: render assets/maps/book2-vicinity.webp"). They are the only two region
// rows either rulebook has, so the run's region-render failure rate was 100% while everything
// else in it succeeded — which is what rules out bad luck and points at the clock.
//
// Nothing here can time a render. What it CAN do is hold the shipped constants against the case
// that died, so the budget can never quietly fall back under it.
//
// Reads the SHIPPED macro command rather than the toolchain source, because the shipped command
// is what a world executes and the source lives in a different repo entirely.

const COMMAND = JSON.parse(read("packs/src/stonetop-macros/import-book2-art.json")).command;

/** One numeric CONFIG value, read off the shipped macro. */
function config(key) {
	const m = new RegExp(`\\b${key}:\\s*(\\d+)`).exec(COMMAND);
	expect(m, `CONFIG.${key} is not in the shipped macro`).toBeTruthy();
	return Number(m[1]);
}

/** The budget renderRegion computes, restated here so the test fails if the shape of it moves. */
const budgetFor = (mp) => Math.max(config("OP_TIMEOUT_MS"), Math.round(mp * config("RENDER_MS_PER_MP")));

// Both rulebooks ship as 2-up spreads, and the macro reads that off the paper and logs it:
// "edition: spreads, 792x612pt". A region row on one of those renders the WHOLE spread.
const SPREAD_PT = { w: 792, h: 612 };

describe("the page-render watchdog", () => {
	it("is a separate budget from the hang detector, not the same number reused", () => {
		expect(config("RENDER_MS_PER_MP")).toBeGreaterThan(0);
		// Per MEGAPIXEL, so it cannot be confused with a flat millisecond bound of its own.
		expect(COMMAND).toContain("RENDER_MS_PER_MP");
		expect(COMMAND).toContain("Math.max(CONFIG.OP_TIMEOUT_MS, Math.round(mp * CONFIG.RENDER_MS_PER_MP))");
	});

	it("gives a 300 dpi spread minutes rather than the flat 60 seconds that killed it", () => {
		const scale = config("PAGEMAP_DPI") / 72;
		const mp = (SPREAD_PT.w * scale) * (SPREAD_PT.h * scale) / 1e6;
		// ~8.4 MP. The failing renders were exactly this.
		expect(mp).toBeGreaterThan(8);
		// Comfortably past where they died, with room for hardware slower than the one that
		// reported this. A budget that merely cleared 60s would be the same bug with a new number.
		expect(budgetFor(mp)).toBeGreaterThan(3 * 60_000);
	});

	it("still floors at the hang detector, so a small render behaves exactly as it always did", () => {
		// A 1-up page at 72 dpi is well under a megapixel; nothing about it should have changed.
		expect(budgetFor(0.5)).toBe(config("OP_TIMEOUT_MS"));
	});

	it("is measured off the VIEWPORT, because a small region of a big page costs the big page", () => {
		// The canvas is only the crop, but pdf.js rasterises the page it was handed and lets the
		// canvas bounds clip it. Budgeting from the crop would under-fund every region row.
		expect(COMMAND).toContain("const mp = (viewport.width * viewport.height) / 1e6;");
	});

	it("guards both ways a page can be rendered", () => {
		// Both branches go through the one helper that owns the watchdog, so neither can acquire a
		// budget the other lacks: the lone page (every rulebook row) drawing straight into the
		// crop, and each half of a stitched 1-up pair drawing onto a sheet of its own.
		expect(COMMAND).toContain("await renderPage(p, { canvasContext: ctx, viewport, transform: [1, 0, 0, 1, dx, dy] }, label, budget);");
		expect(COMMAND).toContain(`await renderPage(p, { canvasContext: one.getContext("2d"), viewport }, label, budget);`);
		expect(COMMAND).toContain("await withTimeout(task.promise, label, budget);");
	});

	// A Promise.race abandons the loser; it does not end it. For a callback that never fires that
	// costs nothing, but an abandoned page raster keeps a page-sized buffer and a core busy while
	// the loop moves on to the next of 545 pictures — so the row that blew its budget goes on
	// taxing every row after it. The longer budgets above make that abandoned work minutes long,
	// which is what turns a pre-existing untidiness into something worth code.
	it("stops a render that blew its budget rather than leaving it running", () => {
		expect(COMMAND).toContain("task.cancel?.()");
		// Cancelling rejects task.promise, and nothing is awaiting it by then. Swallowed at the
		// source, or it surfaces as an unhandled rejection in the middle of a long import.
		expect(COMMAND).toContain("task.promise?.catch?.(() => {})");
	});

	it("releases the half-drawn sheet when a pair render fails", () => {
		// ~17 MB at 300 dpi, on the way out of a loop with hundreds of pictures left to do. The
		// success path already zeroes it; the throw path used to walk past it.
		expect(COMMAND).toMatch(/one\.width = one\.height = 0;\s*throw e;/);
	});

	it("does not re-impose the flat bound from outside renderRegion", () => {
		// The call site used to wrap the whole render in the 60s watchdog. Leaving that in place
		// would make every budget computed inside unreachable, which is a fix that reads as one.
		expect(COMMAND).not.toContain("withTimeout(renderRegion(");
		expect(COMMAND).toContain("canvas = downscale(await renderRegion(sheet, want),");
	});

	it("names what it is rendering even where no manifest row supplies a filename", () => {
		// The poster-map path calls renderRegion with a hand-built `want` that has no `out`, so a
		// label built from `want.out` alone reports "render undefined" in the one place a GM is
		// most likely to paste the log back.
		expect(COMMAND).toContain("const what = want.out || want.label ||");
		expect(COMMAND).toContain("label: `map page ${pageNum}`");
	});
});
