import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// System-wide invariant: MOVING BETWEEN TABS NEVER RESIZES A SHEET.
//
// A window that re-fits itself to whichever tab you land on grows and shrinks under the
// cursor as you browse, and throws away a size the user picked by hand. The NPC sheet did
// this (a `_fitHeight()` bound to every tab-strip click) until it was removed; the other
// tabbed sheets never did, and this is what keeps it that way — the mistake is an easy one
// to make again, because per-tab refitting looks tidy when you only consider one tab.
//
// It regresses SILENTLY: the sheet still works, it just moves. Nothing about a screenshot or
// a passing render test would catch it, so it is pinned here at the source level.
//
// What makes "never refit" safe is that a tab which outgrows its frame scrolls internally
// rather than being cut off — asserted per-sheet in the CSS checks at the bottom.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(HERE, "../..", rel), "utf8");

/** Comments discuss refitting at length, and name the very things being asserted on. */
const code = (rel) => read(rel).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

// Every sheet in the system that presents tabs, however they are built: the three that
// declare `tabs:` in defaultOptions, plus the arcanum, whose edit mode uses the shared
// left-hand guide rail instead.
const TABBED_SHEETS = [
	["character", "module/actors/character/StonetopCharacterSheet.js"],
	["steading", "module/actors/steading/StonetopSteadingSheet.js"],
	["NPC", "module/actors/npc/StonetopNpcSheet.js"],
	["GM Toolkit", "module/actors/gmtoolkit/StonetopGmToolkitSheet.js"],
	["arcanum", "module/item/StonetopArcanumSheet.js"],
];

// Anything that reads as "a tab control" next to anything that reads as "resize the window".
const TAB_THEN_RESIZE = /(sheet-tabs|tab-rail|_onChangeTab|data-tab)[\s\S]{0,240}(setPosition|_fitHeight)/;
const RESIZE_THEN_TAB = /(setPosition|_fitHeight)[\s\S]{0,240}(sheet-tabs|tab-rail|_onChangeTab|data-tab)/;

describe("tab switching never resizes a sheet", () => {
	for (const [name, rel] of TABBED_SHEETS) {
		it(`the ${name} sheet does not refit when a tab is chosen`, () => {
			const src = code(rel);
			expect(src).not.toMatch(TAB_THEN_RESIZE);
			expect(src).not.toMatch(RESIZE_THEN_TAB);
		});
	}

	it("the shared guide rail does not resize its window either", () => {
		// Used by the arcanum sheet and by four dialogs; a refit added here would reach all
		// of them at once, which is exactly the kind of change that gets made without
		// realising a SHEET is on the other end of it.
		expect(code("module/utils/guide-rail.js")).not.toMatch(/setPosition/);
	});
});

describe("...and a tab too tall for its frame scrolls instead of being cut off", () => {
	const CSS = read("styles/stonetop.css").replace(/\/\*[\s\S]*?\*\//g, "");
	// This is the other half of the contract. Without it, "never refit" would mean a tall
	// tab silently loses its bottom edge on a sheet the user has not resized.
	//
	// WHERE that scrollport sits differs by sheet, and the difference is deliberate. Three of
	// them pin a header and scroll the active TAB beneath it, so each tab keeps its own offset.
	// The GM Toolkit scrolls as one unit instead — its banner is a name the window title bar
	// already carries, so it goes up with the text — and its scrollport is the container that
	// holds banner and tab body together. Either way a tall tab cannot be cut off, which is the
	// only thing this block is asserting.
	const SCROLLPORTS = [
		["character", /\.pbta\.sheet\.actor\.character \.stonetop-sheet-layout \.sheet-body > \.tab\.active:not\(\.notes\)\s*\{[^}]*overflow-y:\s*auto/],
		["steading", /\.steading-sheet \.sheet-body > \.tab\.active:not\(\.notes\)\s*\{[^}]*overflow-y:\s*auto/],
		["NPC", /\.stonetop-npc-sheet \.sheet-body > \.tab\.active:not\(\.notes\)\s*\{[^}]*overflow-y:\s*auto/],
		["GM Toolkit", /\.stonetop-gm-toolkit-container\s*\{[^}]*overflow-y:\s*auto/],
	];
	for (const [name, rx] of SCROLLPORTS) {
		it(`the ${name} sheet has a scrollport a tall tab cannot outgrow`, () => {
			expect(CSS).toMatch(rx);
		});
	}
});

describe("the tab rail sizes to its own content", () => {
	const CSS = read("styles/stonetop.css").replace(/\/\*[\s\S]*?\*\//g, "");
	const rail = CSS.match(/\.stonetop \.sheet-tabs\.stonetop-tab-rail\s*\{([^}]*)\}/)?.[1] ?? "";

	it("restates `height`, which pbta would otherwise pin to its horizontal strip's 37px", () => {
		// pbta ships `.pbta.sheet .tabs { height: 37px }` for its own horizontal tab bar.
		// That selector is three classes — the same weight as ours — and the character and
		// steading frames carry `.pbta.sheet`, so for any property we leave unstated pbta's
		// value simply wins. With `height` unstated the rail rendered 37px against 330px of
		// content: one tab shown, the rest scrolled out of reach behind a hidden scrollbar
		// (`scrollbar-width: none`), at every window size. Measured 0 of 9 character tabs.
		expect(rail, "the rail's rule is gone").toBeTruthy();
		expect(rail).toMatch(/height:\s*auto/);
	});

	it("still caps itself so it cannot hang past a short window's bottom", () => {
		// `height: auto` must not undo the cap — the two do different jobs.
		expect(rail).toMatch(/max-height:\s*max\(/);
	});

	it("cannot sit lower than a third of the way down the window", () => {
		// The rail hangs off the sheet's own header banner, which is a good anchor only while
		// the window is tall enough to make it one. The NPC is the counter-example: portrait,
		// name and a line of prose put the banner's bottom nearly halfway down a window that
		// is `height: "auto"` and stops just past the details block, so three tabs landed in
		// the bottom third with empty frame above them. `--st-rail-max-depth` is the ceiling;
		// it bites only when the measured anchor is lower, so a tall sheet on a tall window
		// keeps the banner anchor untouched.
		expect(rail).toMatch(/--st-rail-max-depth:\s*\d+%/);
		expect(rail).toMatch(/--st-rail-anchor:\s*max\([^;]*min\(var\(--st-rail-top[^;]*--st-rail-max-depth/);
		expect(rail).toMatch(/top:\s*var\(--st-rail-anchor\)/);
	});

	it("caps its MIDDLE, not its top, so the panel's own height is counted", () => {
		// Capping the top read wrong on the sheet the cap was written for. The rail is a panel
		// with a height of its own: a 154px four-tab NPC rail topped at a third of a 400px
		// window has its midpoint at 52% and its bottom at 72% — 132px of empty frame above,
		// 114px below — which the eye reads as centred, not as a third of the way down.
		// Measured in a browser against this stylesheet. Half the rail's height has to come
		// off the cap, and `--st-rail-height` is what tab-rail.js stamps for it.
		expect(rail).toMatch(
			/--st-rail-anchor:[^;]*calc\(\s*var\(--st-rail-max-depth\)\s*-\s*var\(--st-rail-height,\s*0px\)\s*\/\s*2\s*\)/
		);
	});

	it("falls back to the plain top-anchored cap before the rail has been measured", () => {
		// `--st-rail-height` is stamped on the frame a frame AFTER the render (the first one
		// lands while core's fadeIn still has the window at `display: none`, where everything
		// measures 0). Without a zero fallback the whole `calc()` is invalid at that moment,
		// which takes `--st-rail-anchor` with it and drops the rail to `top: auto` — static
		// position, at the frame's top-left, on top of the sheet.
		expect(rail).toMatch(/var\(--st-rail-height,\s*0px\)/);
	});

	it("subtracts the SAME anchor from its height cap that it positions against", () => {
		// Reserving room for the unclamped banner anchor while sitting at the clamped one
		// leaves the panel short by the difference: tabs scroll out of reach behind a hidden
		// scrollbar with visible window left below them. Both must read `--st-rail-anchor`.
		expect(rail).toMatch(/max-height:\s*max\(96px,\s*calc\(100% - var\(--st-rail-anchor\)\)\)/);
		expect(rail, "an unclamped --st-rail-top is still being subtracted").not.toMatch(
			/max-height:[^;]*--st-rail-top/
		);
	});

	it("disappears with the rest of the sheet when the window is collapsed", () => {
		// Double-clicking the header collapses a window to its title bar, which core does by
		// hiding `.window-content`. The rail is a sibling of that element out on the frame, so
		// it is not hidden and not clipped: without this rule a stub of panel stayed floating
		// below the collapsed bar, trimmed to the `max(96px, ...)` floor above rather than
		// away. Must out-specify our own `display: flex` (three classes) and pbta's
		// `.pbta.sheet .tabs` (three) — five classes does it without `!important`.
		expect(CSS).toMatch(
			/\.stonetop\.stonetop-has-tab-rail\.minimized \.sheet-tabs\.stonetop-tab-rail\s*\{[^}]*display:\s*none/
		);
	});
});

describe("every actor sheet has a height floor", () => {
	const CSS = read("styles/stonetop.css").replace(/\/\*[\s\S]*?\*\//g, "");
	// Core clamps a resize against the COMPUTED min-height, never options.minHeight:
	//   const minH = parseInt(styles.minHeight) || (pop ? MIN_WINDOW_HEIGHT : 0);
	// so the CSS rule is the one that actually holds a drag. Without it the fallback is
	// core's MIN_WINDOW_HEIGHT of 50px — which pbta happened to cover for the character and
	// steading frames (`.pbta.sheet.actor`) but NOT for the monster or NPC, whose frames
	// carry no `pbta` class.
	const FLOORS = [
		["character", /\.window-app\.stonetop\.sheet\.actor\.character[^{]*\{[^}]*min-height:\s*\d+px/],
		["steading", /\.window-app\.stonetop\.sheet\.actor\.steading[^{]*\{[^}]*min-height:\s*\d+px/],
		["monster", /\.window-app\.stonetop\.sheet\.actor\.monster\s*\{[^}]*min-height:\s*\d+px/],
		["npc", /\.window-app\.stonetop\.sheet\.actor\.npc\s*\{[^}]*min-height:\s*\d+px/],
		["gm-toolkit", /\.window-app\.stonetop\.sheet\.actor\.gm-toolkit\s*\{[^}]*min-height:\s*\d+px/],
	];
	for (const [name, rx] of FLOORS) {
		it(`the ${name} sheet cannot be dragged below its floor`, () => {
			expect(CSS).toMatch(rx);
		});
	}

	// The option is not what core reads, but sheet-size.js's save guard does read it, so a
	// drift between the two would quietly let an under-floor height be stored.
	const OPTION = [
		["character", "module/actors/character/StonetopCharacterSheet.js", 620],
		["steading", "module/actors/steading/StonetopSteadingSheet.js", 620],
		["monster", "module/actors/monster/StonetopMonsterSheet.js", 480],
		["npc", "module/actors/npc/StonetopNpcSheet.js", 400],
		["gm-toolkit", "module/actors/gmtoolkit/StonetopGmToolkitSheet.js", 420],
	];
	for (const [name, rel, px] of OPTION) {
		it(`the ${name} sheet's minHeight option matches its CSS floor (${px}px)`, () => {
			expect(read(rel)).toMatch(new RegExp(`minHeight:\\s*${px}\\b`));
			expect(CSS).toMatch(new RegExp(`\\.actor\\.${name}[^{]*\\{[^}]*min-height:\\s*${px}px`));
		});
	}
});
