import { describe, it, expect } from "vitest";
import { readCss, readRepo, stripComments, declarations } from "../fakes/css.js";

// THE TIMELINE'S STYLING, in the places where it fails silently.
//
// A timeline is a season-shaped thing, and this system reserves its season colours for exactly one
// surface. A nested scrollport still scrolls, so the toolbar quietly leaves the top of the page
// rather than staying pinned. And the aggregate's columns line up only because two separate rows
// agree about one width, which nothing else checks.

const CSS = readCss();

/** The timeline's own block, from its first rule to the accessibility family that must stay last. */
const BLOCK = (() => {
	const from = CSS.indexOf(".stonetop-timeline-mount");
	const to = CSS.indexOf(":root.stonetop-no-texture");
	expect(from, "the timeline block is missing entirely").toBeGreaterThan(-1);
	expect(to, "the accessibility family is missing").toBeGreaterThan(from);
	return CSS.slice(from, to);
})();

/**
 * One declared value off a rule body.
 *
 * `declarations` hands back the rule's TEXT (the union of every rule naming the selector), not a
 * parsed object, so each assertion below would otherwise be its own regex. Answers null both for a
 * selector with no rule and for a rule that never sets the property, which is what makes the
 * "is missing entirely" messages worth writing.
 */
function value(selector, property) {
	const body = declarations(CSS, selector);
	if (!body) return null;
	const match = body.match(new RegExp(`(?:^|[;{])\\s*${property}\\s*:\\s*([^;}]+)`));
	return match ? match[1].trim() : null;
}

describe("the timeline and the season inks", () => {
	// THE HARD RULE. The four season inks belong to the steading header's clock and nothing else;
	// steading-header-season.test.js tallies every read in the whole stylesheet and fails on a
	// fifth. This is the local half of that: a timeline is the surface most likely to reach for
	// them, so it says so where somebody adding a rule here will read it.
	it("spends no season ink of its own", () => {
		const reads = BLOCK.match(/var\(--stonetop-season-\w+-ink/g) ?? [];
		expect(reads, "the timeline block reads a season ink; colour a period with "
			+ "--st-warm-hover-bg and let the season's NAME say which season").toEqual([]);
	});

	// The door back: a per-season class hook with no rules behind it is an invitation to fill it in
	// with the inks later.
	it("leaves no per-season class hook behind for somebody to colour in", () => {
		const hooks = BLOCK.match(/\.stonetop-timeline[\w-]*--(?:spring|summer|autumn|fall|winter)/g) ?? [];
		expect(hooks).toEqual([]);
	});

	// The glyph is how a period is told apart at a glance, and it is the location journals' own
	// season mark (`.stonetop-season-entry` plus a `.stonetop-season--<id>` modifier) rather than a
	// second drawing of the same idea.
	//
	// Both shapes of the timeline wear it because both include the SAME heading partial -- the spine
	// block and the aggregate's row head. That is what is checked here: the glyph in the one place
	// it is written, and both hosts reaching for it rather than spelling their own.
	it("marks a period with the season glyph the journals already use", () => {
		expect(
			readRepo("templates/dialogs/partials/timeline-period-head.hbs"),
			"the shared period heading does not wear the season glyph",
		).toContain("stonetop-season-entry");

		for (const rel of [
			"templates/dialogs/partials/timeline-period.hbs",
			"templates/dialogs/timeline.hbs",
		]) {
			expect(readRepo(rel), `${rel} does not use the shared period heading`)
				.toContain('{{> "stonetop.timeline-period-head"}}');
		}
	});

	// "autumn" is what the clock says; "fall" is what the art and the stylesheet have. The swap is
	// made in exactly one place on this side, and a second copy is how it comes to be forgotten.
	it("maps autumn onto fall in one place only", () => {
		// Comments stripped: the rule is explained in prose directly above the line that carries
		// it, and counting the explanation would make this fail on its own documentation.
		const source = stripComments(readRepo("module/timeline/timeline-view.js"));
		expect(source.match(/"fall"/g) ?? [], "the autumn-to-fall swap is written more than once")
			.toHaveLength(1);
	});
});

describe("the tab has to give the panel a definite height", () => {
	const CHAIN = [
		".pbta.sheet.actor.character .stonetop-sheet-layout .sheet-body > .tab.active.timeline",
		".steading-sheet .sheet-body > .tab.active.timeline",
		".pbta.sheet.actor.character .tab.timeline .sheet-tab",
		".steading-sheet .tab.timeline .sheet-tab",
		".stonetop-timeline-mount",
	];

	// `.stonetop-timeline` is a two-row grid whose lower row is `1fr`. An indefinite chain anywhere
	// above resolves that row to zero, and the symptom is a toolbar with nothing under it.
	it("says height 100% out loud on every link of the chain, on both sheets", () => {
		for (const sel of CHAIN) {
			expect(value(sel, "height"), `${sel} does not set a height`).toBe("100%");
		}
	});

	// ONE SCROLLPORT, NOT TWO. Both sheets give every other tab its own scroll
	// (`.tab.active:not(.notes)`), and inheriting that here nests two scrollbars down one column:
	// the tab's, which carries the toolbar off the top of the page, and the panel's, which is the
	// one that should move.
	it("clips at the tab so the panel owns the only scroll", () => {
		for (const sel of CHAIN.slice(0, 2)) {
			expect(value(sel, "overflow"), `${sel} must clip, not scroll`).toBe("hidden");
		}
		expect(value(".stonetop-timeline-scroll", "overflow-y")).toBe("auto");
	});

	// The clip above only holds if it actually WINS. Each `:not()` costs a class of specificity, so
	// the steading's every-other-tab rule (three of them) outranks the timeline's own selector no
	// matter how far down the file it sits, and `overflow-y: auto` comes back with the toolbar
	// scrolling off the top. The exclusion has to be named in the broad rule, not overridden below.
	it("excludes the timeline from the steading's every-other-tab scrollport", () => {
		const broad = stripComments(CSS)
			.split("}")
			.map(block => block.split("{")[0].trim())
			.filter(sel => sel.includes(".sheet-body > .tab.active:not("));
		expect(broad.length, "the every-other-tab scrollport rules moved").toBeGreaterThan(0);
		const steading = broad.filter(sel => sel.includes(".steading-sheet"));
		expect(steading.length, "the steading's scrollport rule moved").toBe(1);
		expect(
			steading[0],
			"the steading's tab scrollport must exclude .timeline by name: extra :not()s outrank "
			+ "the timeline's own rule, so an override further down the file silently loses",
		).toContain(":not(.timeline)");
	});

	// ⚠ `min-height: 0` on a grid child is load-bearing: without it the row refuses to shrink below
	// its content and the scrollbar never appears at all.
	it("lets the scrolling row shrink below its content", () => {
		expect(value(".stonetop-timeline-scroll", "min-height")).toBe("0");
		expect(value(".stonetop-timeline", "min-height")).toBe("0");
	});

	// The toolbar is the auto row and the spine is the 1fr one. An auto lower row would size to its
	// content and push the scroll out to whatever holds the panel instead.
	it("pins the toolbar and gives the rest to the spine", () => {
		expect(value(".stonetop-timeline", "grid-template-rows")).toBe("auto 1fr");
	});
});

describe("the aggregate's columns", () => {
	// The header row of names and every season row are separate flex rows, and they line up only
	// because the gutter at the head of each is the same width. Declared once, in one shared rule,
	// so the two cannot drift; this is what stops somebody widening one of them alone.
	it("keeps the season gutter one width, declared once for both rows", () => {
		const spacer = value(".stonetop-timeline-lane-spacer", "width");
		expect(spacer, "the lane spacer has no width").toBeTruthy();
		expect(value(".stonetop-timeline-row-head", "width"), "the two gutters have drifted apart")
			.toBe(spacer);
		expect(value(".stonetop-timeline-row-head", "flex"))
			.toBe(value(".stonetop-timeline-lane-spacer", "flex"));
	});

	// Every lane takes an equal share, so the number of threads is a fact about the world rather
	// than about this stylesheet. `flex: 1 1 0` and not `1 1 auto`: an auto basis sizes each lane
	// to its own longest card and the columns stop being columns.
	it("gives every thread an equal share, whatever the world has", () => {
		expect(value(".stonetop-timeline-lane", "flex")).toBe("1 1 0");
		expect(value(".stonetop-timeline-lane-head", "flex")).toBe("1 1 0");
	});

	// The single-track spine draws a rule and a dot per card. Inside a lane those would be a
	// second, meaningless rule down the middle of every column.
	it("takes the single-track spine off the cards inside a lane", () => {
		expect(value(".stonetop-timeline-board .stonetop-timeline-cards", "border-left")).toBe("none");
		expect(value(".stonetop-timeline-board .stonetop-timeline-card::before", "content")).toBe("none");
	});
});

describe("telling the record from the bookkeeping", () => {
	// A row the system wrote for itself has to be distinguishable from one somebody typed WITHOUT
	// reading it, and by more than one signal: a reader who cannot pick the dashed edge out still
	// has the quieter ink, and the badge says it in words.
	it("draws an auto row differently from a typed one", () => {
		expect(value(".stonetop-timeline-card--auto", "border-style"),
			"an auto row is not marked out by its edge").toBe("dashed");
		expect(value(".stonetop-timeline-card--auto", "color"),
			"an auto row is not marked out by its ink").toBeTruthy();
		expect(readRepo("templates/dialogs/partials/timeline-card.hbs"))
			.toContain("stonetop.timeline.auto.badge");
	});
});

describe("the entry dialog", () => {
	// ⚠ The dialog is `_autoHeight`, so it re-fits the window to its content on every render. A
	// textarea with no ceiling grows the window past the bottom of the screen.
	it("caps the account field, which is the only thing in it that can grow", () => {
		expect(value(".stonetop-timeline-entry-body", "max-height")).toBeTruthy();
	});
});

describe("where the block sits", () => {
	// The accessibility family has to be the last thing in the file: its plain rules win on order
	// rather than on specificity. high-contrast.test.js guards that from its own side; this guards
	// it from the side that actually breaks it, which is somebody appending a new feature's block.
	it("sits above the accessibility family, not after it", () => {
		expect(CSS.indexOf(".stonetop-timeline-mount"))
			.toBeLessThan(CSS.indexOf(":root.stonetop-no-texture"));
	});
});
