import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readRepo as read, readCss } from "../fakes/css.js";
import { FLASH_CLASS, SPIN_CLASS } from "../../module/utils/flash-highlight.js";

// The Die of Fate button on a walkthrough step, and the light it runs down the table the step
// prints.
//
// The GM Toolkit's move randomizer already had this beat (gm-toolkit/gm-move-drawer.js): the
// answer is drawn first, a light walks the printed list and lands on it, and the card goes out
// only then. The die is the same shape of question asked of a list already on screen, so it
// borrows the same effect rather than growing a second way of saying "this one".
//
// Two things have to hold for that to be an improvement rather than a flourish: the printed row
// must be findable from the roll (an index stamp, not the printed range, which is prose), and the
// card must WAIT — a whisper that posted at the click answers the question the light is still in
// the middle of asking, and the GM has no reason to watch the table at all.

// The route step browses the art folder on render; nothing here renders a map, but the module is
// imported. Same fake as the sibling expedition suites.
vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");
const { FATE_TABLES }      = await import("../../module/data/fate-tables.js");

const CSS = readCss();
const DIALOG_CODE = read("module/dialogs/ExpeditionDialog.js")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const steps    = Object.create(ExpeditionDialog.prototype)._steps;
const fateStep = key => steps.find(s => s.fate === key);

/** A dialog instance without the Application constructor, as the sibling suites build one. */
function dialog(stepKey = "running") {
	const d = Object.create(ExpeditionDialog.prototype);
	d._step  = steps.findIndex(s => s.key === stepKey);
	d._rolls = {};
	return d;
}

// The suite runs on `environment: "node"`, so the walk runs against the same five-line element
// stand-in the flash-highlight suite uses: a class list and a layout property is the whole of
// what it touches.
function fakeRow() {
	const set = new Set();
	return {
		classList: {
			add:      c => set.add(c),
			remove:   c => set.delete(c),
			contains: c => set.has(c),
		},
		get offsetWidth() { return 10; },
		offsetParent: {},
		lit:     () => set.has(FLASH_CLASS),
		passing: () => set.has(SPIN_CLASS),
	};
}

/**
 * The window as `_spinFateTo` reads it: a root that finds the printed table, and a table that
 * answers both the row query and the douse queries the walk makes against its scope.
 */
function fakeWindow(rows) {
	const list = {
		querySelectorAll: (sel) => {
			if (sel.startsWith(".")) {
				const wanted = sel.slice(1);
				return rows.filter(r => r.classList.contains(wanted));
			}
			return rows;
		},
	};
	return { element: [{ querySelector: () => list }], list };
}

// Long enough for the longest walk (twelve steps easing from 40ms to 240ms is about a second)
// and SHORTER than FLASH_MS, so the landing flash is still burning when it is asserted on. Running
// the clock to the end would put it out again — the light going out on its own is the point of it.
const WALK_MS = 3000;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("the printed table, as the walk finds it", () => {
	// Matched on the index rather than on the printed range: a range is prose ("2&ndash;3") that
	// the DOM hands back decoded. If the stamp goes, the walk stops finding its row — in silence,
	// with the card still posting — so it is guarded here as well as in the fate-tables suite.
	it("stamps every row of every table a step prints", () => {
		for (const step of steps.filter(s => s.fate)) {
			const stamps = step.body.match(/data-fate-row="\d+"/g) ?? [];
			expect(stamps, step.key).toHaveLength(FATE_TABLES[step.fate].rows.length);
			stamps.forEach((stamp, i) => expect(stamp).toBe(`data-fate-row="${i}"`));
		}
	});

	it("prints the table the step's own fate key names", () => {
		expect(fateStep("perilous").key).toBe("running");
		expect(fateStep("perilous").body).toContain("A danger springs on them, unavoidable.");
	});
});

describe("running the light down it", () => {
	it("lands on the row the die gave, and hands it the flash", async () => {
		const rows = [fakeRow(), fakeRow(), fakeRow(), fakeRow()];
		const d = dialog();
		Object.assign(d, fakeWindow(rows));

		const walking = d._spinFateTo(2);
		await vi.advanceTimersByTimeAsync(WALK_MS);

		expect(await walking).toBe(true);
		expect(rows[2].lit()).toBe(true);
		// And nothing is left wearing the walking light, on the landing row or anywhere else.
		expect(rows.some(r => r.passing())).toBe(false);
		expect(rows.filter(r => r.lit())).toHaveLength(1);
	});

	// One landing, one card. A second press abandons the first walk, and the roll it belonged to
	// is told so — see `beforePost` in utils/die-of-fate.js, which then posts nothing.
	it("tells a superseded walk it was superseded", async () => {
		const rows = [fakeRow(), fakeRow(), fakeRow(), fakeRow()];
		const d = dialog();
		Object.assign(d, fakeWindow(rows));

		const first = d._spinFateTo(1);
		const second = d._spinFateTo(3);
		await vi.advanceTimersByTimeAsync(WALK_MS);

		expect(await first).toBe(false);
		expect(await second).toBe(true);
		expect(rows[3].lit()).toBe(true);
		expect(rows[1].lit()).toBe(false);
	});

	// The card still goes out when there is no walk to make: a step whose table is not on the
	// page (a re-render mid-roll) must not swallow the answer the GM pressed the button for.
	it("reports success when the table is not on the page", async () => {
		const d = dialog();
		d.element = [{ querySelector: () => null }];
		await expect(d._spinFateTo(0)).resolves.toBe(true);
	});

	// Scoped to the LIST, not the window: the exploration rail beside it runs the same light off
	// its own die, and a scope taking in both would have each draw putting the other's answer out.
	it("scopes the walk to the table rather than to the window", () => {
		expect(DIALOG_CODE).toMatch(/landOn\(rows, index, \{ scope: list \}\)/);
		// Its OWN track, so a draw here and a draw on the rail beside it do not cancel each other.
		expect(DIALOG_CODE).toMatch(/this\._fateSpin \?\?= new SpinTrack\(\)/);
	});
});

describe("the roll behind it", () => {
	it("rolls the step's own table, and posts only once the light lands", async () => {
		const order = [];
		const rows = [fakeRow(), fakeRow(), fakeRow(), fakeRow()];
		const d = dialog();
		Object.assign(d, fakeWindow(rows));

		let seen = null;
		global.game = {
			...global.game,
			stonetop: {
				rollDieOfFate: async (table, { beforePost }) => {
					seen = table;
					order.push(await beforePost({ index: 2 }) === false ? "called off" : "walked");
					order.push("posted");
				},
			},
		};

		const rolling = d._rollFate();
		await vi.advanceTimersByTimeAsync(WALK_MS);
		await rolling;

		expect(seen).toBe(FATE_TABLES.perilous);
		expect(order).toEqual(["walked", "posted"]);
		expect(rows[2].lit()).toBe(true);
	});
});

describe("the paint", () => {
	// The wash, the fade and the motion-off fallback are the randomizer's, grouped with the other
	// surfaces that draw rather than copied — two copies are two things to keep in step with
	// FLASH_MS and with each other.
	it("takes its wash from the same rules the move randomizers use", () => {
		for (const cls of [SPIN_CLASS, FLASH_CLASS]) {
			const rule = CSS.match(
				new RegExp(`[^}]*\\.stonetop-exp-fatetable li\\.${cls}[^{]*\\{[^}]*\\}`)
			);
			expect(rule, cls).toBeTruthy();
			expect(rule[0]).toContain("stonetop-gm-move");
		}
	});
});
