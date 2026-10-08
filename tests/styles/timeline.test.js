import { describe, it, expect } from "vitest";
import { readCss, readRepo, stripComments, declarations, ownRule, splitSelectorList } from "../fakes/css.js";
import { contrastRatio, parseColor } from "../fakes/contrast.js";
import { SEASON_IDS } from "../../module/seasons/seasons-change-reminders.js";
import { seasonColourClass } from "../../module/timeline/timeline-view.js";

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

	// The season headings DO wear a colour per season (user's call, 2026-10-01), so they are easy to
	// spot. These pin the terms: the only per-season hooks are the four the view hands out, each
	// pointing at the timeline's OWN token rather than at the clock's ink.
	it("colours a season heading with the timeline's own four colours, and only those", () => {
		const hooks = [...new Set(BLOCK.match(/\.stonetop-timeline[\w-]*--(?:spring|summer|autumn|fall|winter)\b/g) ?? [])];
		expect(hooks.sort()).toEqual(SEASON_IDS.map(id => `.stonetop-timeline-season--${id}`).sort());
		for (const id of SEASON_IDS) {
			expect(seasonColourClass(id)).toBe(`stonetop-timeline-season stonetop-timeline-season--${id}`);
			expect(value(`.stonetop-timeline-season--${id}`, "--tl-season")).toBe(`var(--st-timeline-season-${id})`);
		}
		expect(seasonColourClass("")).toBe("");
	});

	// Every host of the shared heading carries the class, or one layout would come out uncoloured.
	it("puts the season colour on every host of the period heading", () => {
		const hosts = {
			"templates/dialogs/partials/timeline-period.hbs": "stonetop-timeline-period-head",
			"templates/dialogs/partials/timeline-hperiod.hbs": "stonetop-timeline-hhead",
			"templates/dialogs/timeline.hbs": ["stonetop-timeline-row-head", "stonetop-timeline-swim-head"],
		};
		for (const [rel, classes] of Object.entries(hosts)) {
			const src = readRepo(rel);
			for (const cls of [classes].flat()) {
				const tag = src.match(new RegExp(`class="${cls}[^"]*"`))?.[0] ?? "";
				expect(tag, `${rel}: .${cls} does not wear seasonClass`).toContain("{{seasonClass}}");
				expect(declarations(CSS, `.${cls}.stonetop-timeline-season`), `.${cls} has no season rule`).toContain("var(--tl-season)");
			}
		}
	});

	// A player at this table reads through a magnifier: the heading's words hold 7:1 on the tint, and
	// its edge 3:1 against both the panel and its own tint, in all four skins.
	it("keeps every season heading legible in every skin", () => {
		const props = body => new Map([...(body ?? "").matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map(m => [m[1], m[2].trim()]));
		const mix = (a, b, pct) => {
			const A = parseColor(a).rgb, B = parseColor(b).rgb, f = pct / 100;
			return `rgb(${A.map((v, i) => v * f + B[i] * (1 - f)).join(", ")})`;
		};
		const light = props(ownRule(CSS, ":root"));
		const skins = {
			light,
			dark: new Map([...light, ...props(ownRule(CSS, ":root.stonetop-dark"))]),
			darkHigh: new Map([...light, ...props(ownRule(CSS, ":root.stonetop-dark")),
				...props(ownRule(CSS, ":root.stonetop-dark.stonetop-high-contrast"))]),
			lightHigh: new Map([...light, ...props(ownRule(CSS, ":root.stonetop-high-contrast"))]),
		};
		for (const [skin, p] of Object.entries(skins)) {
			const bg = p.get("--stonetop-bg"), text = p.get("--st-text"), wash = parseFloat(p.get("--st-timeline-season-wash"));
			for (const id of SEASON_IDS) {
				const edge = p.get(`--st-timeline-season-${id}`);
				expect(edge, `${skin} ${id}`).toBeTruthy();
				const fill = mix(edge, bg, wash);
				expect(contrastRatio(text, fill), `${skin} ${id}: words on the tint`).toBeGreaterThanOrEqual(7);
				expect(contrastRatio(edge, bg), `${skin} ${id}: edge on the panel`).toBeGreaterThanOrEqual(3);
				expect(contrastRatio(edge, fill), `${skin} ${id}: edge on its tint`).toBeGreaterThanOrEqual(3);
			}
		}
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
		expect(value(".stonetop-timeline-scroll", "overflow")).toBe("auto");
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

	// The toolbar is the first auto row, the spine the 1fr one, the year scrubber the last auto row.
	// An auto middle row would size to its content and push the scroll out to whatever holds the
	// panel instead.
	it("pins the toolbar and the scrubber and gives the rest to the spine", () => {
		expect(value(".stonetop-timeline", "grid-template-rows")).toBe("auto 1fr auto");
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

	// User, 2026-10-03: sixteen threads in an equal share of the window were a few words wide and
	// the chips sat on the text. A lane stops shrinking at a floor and the board grows past the
	// window instead; the heads share the floor so the names stay over their columns.
	it("never squeezes a lane below a readable width, and widens the board instead", () => {
		for (const sel of [".stonetop-timeline-board .stonetop-timeline-lane", ".stonetop-timeline-lane-heads .stonetop-timeline-lane-head"]) {
			expect(value(sel, "min-width"), sel).toBe("var(--timeline-lane-min)");
		}
		expect(value(".stonetop-timeline-board", "min-width")).toBe("var(--timeline-board-min)");
		expect(readRepo("templates/dialogs/timeline.hbs")).toMatch(/--timeline-lanes: \{\{timeline\.tracks\.length\}\}/);
		expect(value(".stonetop-timeline-card-kind", "max-width")).toBe("100%");
	});

	// User, 2026-10-03: in the vertical layout a year heading is larger than the season headings
	// under it, and its rule is red, in the red every skin tunes rather than a literal. 2px wide
	// (user, 2026-10-04).
	it("draws the vertical year heading large, over a 2px red rule", () => {
		expect(parseFloat(value(".stonetop-timeline-year", "font-size"))).toBeGreaterThan(1.3);
		expect(value(".stonetop-timeline-year::after", "border-top")).toBe("2px solid var(--st-red-text)");
	});

	// User, 2026-10-03: the year rides in the shared year chip, at the heading's own size.
	it("puts the vertical year heading in the year chip, full size", () => {
		expect(readRepo("templates/dialogs/partials/timeline-period.hbs"))
			.toContain('<h2 class="stonetop-timeline-year" data-year="{{year}}"{{#if ageMark}} data-age-mark{{/if}}><span class="stonetop-year-chip">{{yearLabel}}</span></h2>');
		expect(readRepo("templates/dialogs/timeline.hbs"))
			.toContain('<h2 class="stonetop-timeline-year" data-year="{{year}}"{{#if ageMark}} data-age-mark{{/if}}><span class="stonetop-timeline-year-cell"><span class="stonetop-year-chip">{{yearLabel}}</span></span></h2>');
		expect(value(".stonetop-timeline-year .stonetop-year-chip", "font-size")).toBe("inherit");
	});

	// User, 2026-10-03: on the board the year chip sits centred over the season column. The cell
	// holding it is the gutter's width and is what pins, so the chip stays centred when dragged across.
	it("centres the board's year chip over the season column", () => {
		expect(value(".stonetop-timeline-year-cell", "position")).toBe("sticky");
		expect(value(".stonetop-timeline-year-cell", "left")).toBe("0");
		expect(value(".stonetop-timeline-year-cell", "justify-content")).toBe("center");
		expect(value(".stonetop-timeline-year-cell", "width")).toBe(value(".stonetop-timeline-row-head", "width"));
		expect(value(".stonetop-timeline-year-cell .stonetop-year-chip", "position")).toBe("static");
	});

	// User, 2026-10-03: the same ground as the relationship map, plain page tone with no spirals.
	it("paints the timeline on the plain page, as the relationship map is", () => {
		expect(value(".stonetop-timeline", "background")).toBe("var(--st-page)");
		expect(value(".stonetop-relmap-view", "background")).toBe("var(--st-page)");
	});

	// User, 2026-10-03: dragged across, the year scrolled off and left only its rule. The chip pins
	// left like the season cells, and is opaque so the rule passing under does not strike it through.
	it("keeps the year chip in view, opaque, when the board is dragged across", () => {
		const sel = ".stonetop-timeline-year .stonetop-year-chip";
		expect(value(sel, "position")).toBe("sticky");
		expect(value(sel, "left")).toBe("0");
		expect(value(sel, "background")).toMatch(/var\(--stonetop-bg\)$/);
	});

	// User, 2026-10-03: a flat panel-colour strip beside each pinned season cell stood over the
	// textured paper as "an odd grey column" covering the cards. The corner lost its strip too
	// (user, 2026-10-04): it cut the thread names off 10px short of the season column's edge.
	// User, 2026-10-04: after a snap, rows with empty lanes peeked out from under the season cells.
	// A flex lane's border is part of its base size, so the empty lane's 2px edge made it wider than
	// its full neighbours and pushed the row out of line with the names the snap measures. Every lane
	// carries the edge; only the empty one paints it, and wins the tie by coming later.
	it("gives every Down lane the empty lane's edge width, so the rows line up with the names", () => {
		expect(value(".stonetop-timeline-board :where(.stonetop-timeline-lane)", "border-left")).toBe("2px solid transparent");
		expect(value(".stonetop-timeline-lane--empty", "border-left")).toBe("2px dotted var(--st-card-rule)");
		const at = sel => CSS.indexOf(`\n${sel} {`);
		expect(at(".stonetop-timeline-board :where(.stonetop-timeline-lane)")).toBeGreaterThan(-1);
		expect(at(".stonetop-timeline-lane--empty")).toBeGreaterThan(at(".stonetop-timeline-board :where(.stonetop-timeline-lane)"));
	});

	it("throws no flat strip beside a pinned season cell or the corner", () => {
		expect(value(".stonetop-timeline-row-head", "box-shadow")).toBeNull();
		expect(value(".stonetop-timeline-lane-spacer", "box-shadow")).toBeNull();
	});

	// User, 2026-10-03: in the vertical layout each thread's name sits centred over its column, and
	// a name too long for the lane still ellipsizes rather than spilling past both edges.
	it("centres each thread's name over its column", () => {
		expect(value(".stonetop-timeline-lane-heads .stonetop-timeline-lane-head", "justify-content")).toBe("center");
		expect(value(".stonetop-timeline-lane-name", "overflow")).toBe("hidden");
		expect(value(".stonetop-timeline-lane-name", "text-overflow")).toBe("ellipsis");
	});

	// User, 2026-10-04: the name (and a player's playbook under it) sits centred on the portrait's
	// middle. One box holds both, because the swimlanes pin a head's children one by one and two
	// pinned apart would line up by their tops.
	// User, 2026-10-04: read down, each thread's name is a card of its own, as each season is.
	it("draws each thread's head as its own card in the vertical layout", () => {
		const sel = ".stonetop-timeline-lane-heads .stonetop-timeline-lane-head";
		expect(value(sel, "border")).toBe("2px solid var(--st-card-rule)");
		expect(value(sel, "border-radius")).toBe("var(--st-radius)");
		expect(value(sel, "background")).toContain("var(--st-warm-hover-bg)");
		expect(value(".stonetop-timeline-lane-heads", "border-bottom")).toBeNull();
	});

	it("centres a thread's words on its portrait, as one box", () => {
		expect(value(".stonetop-timeline-lane-who", "display")).toBe("flex");
		expect(value(".stonetop-timeline-lane-who", "align-items")).toBe("center");
		expect(value(".stonetop-timeline-lane-label", "flex-direction")).toBe("column");
		expect(value(".stonetop-timeline-lane-playbook", "text-overflow")).toBe("ellipsis");
	});

	// User, 2026-10-03: a board wider than the window keeps its seasons on screen. The season cell
	// and the corner above it pin to the left, OPAQUE. Going down, the season cells and year chips
	// pass IN FRONT of the names row (user, 2026-10-04), whose band and corner wear the page's colour
	// rather than a grey box over it; the cards still pass under it.
	it("pins the season column at the left, opaque, in front of the names row", () => {
		for (const sel of [".stonetop-timeline-row-head", ".stonetop-timeline-lane-spacer"]) {
			expect(value(sel, "position"), sel).toBe("sticky");
			expect(value(sel, "left"), sel).toBe("0");
		}
		expect(value(".stonetop-timeline-row-head", "background")).toContain("var(--stonetop-bg)");
		expect(value(".stonetop-timeline-lane-spacer", "background")).toBe("var(--st-page)");
		expect(value(".stonetop-timeline-lane-heads", "background")).toBe("var(--st-page)");
		const band = Number(value(".stonetop-timeline-lane-heads", "z-index"));
		expect(band).toBeGreaterThan(0);
		// The row head's own rule, after the group it shares with the corner (which stays at 1, inside
		// the band's own stacking context).
		expect(Number(ownRule(CSS, ".stonetop-timeline-row-head").match(/z-index:\s*(\d+)/)[1])).toBeGreaterThan(band);
		expect(Number(value(".stonetop-timeline-year-cell", "z-index"))).toBeGreaterThan(band);
	});

	// User, 2026-10-03: a sticky `left: 0` pins inside any padding, so the lanes showed past the
	// pinned season cell's left edge. Down has no side padding on its column, and the pop-out none
	// on its content well, so the cell sits flush to the window's edge.
	it("pins the season column flush to the window's left edge", () => {
		const down = ".stonetop-timeline:not(.stonetop-timeline--horizontal) .stonetop-timeline-scroll";
		expect(value(down, "padding-left")).toBe("0");
		expect(value(down, "padding-right")).toBe("0");
		expect(value(".stonetop.stonetop-timeline-app .window-content", "padding")).toBe("0");
	});

	// The single-track spine draws a rule and a dot per card. Inside a lane those would be a
	// second, meaningless rule down the middle of every column.
	it("takes the single-track spine off the cards inside a lane", () => {
		expect(value(".stonetop-timeline-board .stonetop-timeline-cards", "border-left")).toBe("none");
		expect(value(".stonetop-timeline-board .stonetop-timeline-card::before", "content")).toBe("none");
	});
});

describe("telling the record from what the system wrote", () => {
	// A milestone (a level, a kill, a death) is the RECORD, not small print. It used to wear quieter
	// ink, a dashed edge and a 2xs faint badge, which is exactly what a player reading through a
	// magnifier cannot see. It is told apart by its kind named in words and a heavier edge instead,
	// at full ink.
	it("draws an auto row at full ink, told apart by its edge and a worded chip", () => {
		expect(value(".stonetop-timeline-card--auto", "color"),
			"an auto row must not dim its own ink").toBeNull();
		expect(value(".stonetop-timeline-card--auto", "border-style"),
			"a dashed edge is the faint signal this replaced").toBeNull();
		expect(value(".stonetop-timeline-card--auto", "border-left-width"),
			"an auto row is not marked out by its edge").toBeTruthy();
		expect(readRepo("templates/dialogs/partials/timeline-card.hbs"))
			.toContain("{{kindLabel}}");
	});

	it("keeps the kind chip readable", () => {
		expect(value(".stonetop-timeline-card-kind", "font-size")).toBe("var(--st-fs-xs)");
		expect(value(".stonetop-timeline-card-kind", "color")).not.toContain("faint");
	});
});

describe("the timeline laid across the page", () => {
	// Both layouts scroll both ways now, into the empty gutter the timeline is dragged off into (user,
	// 2026-10-01). What Down still must not do is let a too-wide card widen the CONTENT: that is how a
	// page ends up sliding under the reader's magnifier on its own. So Down's canvas is held to the
	// column, and only Across sizes to its seasons.
	it("scrolls both ways, but holds Down's content to the column's width", () => {
		expect(value(".stonetop-timeline-scroll", "overflow")).toBe("auto");
		expect(value(".stonetop-timeline-canvas", "width")).toBe("100%");
		expect(value(".stonetop-timeline-canvas", "grid-template-columns")).toBe("minmax(0, 1fr)");
		expect(value(".stonetop-timeline--horizontal .stonetop-timeline-canvas", "width")).toBe("fit-content");
		expect(value(".stonetop-timeline--horizontal .stonetop-timeline-canvas", "min-width")).toBe("100%");
	});

	// The gutter is ADDED round the timeline, never carved out of it, on all four sides.
	it("pads the canvas by the measured gutter on every side", () => {
		expect(value(".stonetop-timeline-canvas", "box-sizing")).toBe("content-box");
		expect(value(".stonetop-timeline-canvas", "padding"))
			.toBe("var(--drag-scroll-gutter-top, 0px) var(--drag-scroll-gutter-x, 0px) var(--drag-scroll-gutter-y, 0px) var(--drag-scroll-gutter-left, 0px)");
		expect(readRepo("templates/dialogs/timeline.hbs"))
			.toMatch(/stonetop-timeline-scroll"[^>]*>\s*\{\{!--[\s\S]*?--\}\}\s*<div class="stonetop-timeline-canvas">/);
	});

	// The aggregate's header row (the board's thread names, the swimlanes' season heads) is sticky at
	// the top, and must never slide down off that edge: no top inset on those two shapes, as the
	// window wires them no top gutter (user, 2026-10-03).
	it("keeps the aggregate's header row against the column's top edge", () => {
		expect(value(".stonetop-timeline-scroll > .stonetop-timeline-canvas:has(> .stonetop-timeline-board, > .stonetop-timeline-swim)", "margin-top"))
			.toBe("0");
		expect(readRepo("module/dialogs/TimelineWindow.js")).toContain("pinTop: !(roomAcrossLine && readAcross),");
	});

	// The swimlanes' thread names and the board's season cells are sticky at the left, and must never
	// slide right off that edge: no left pad on the column, no left gutter (user, 2026-10-03).
	it("keeps the aggregate's left column against the column's left edge", () => {
		expect(value(".stonetop-timeline-scroll:has(> .stonetop-timeline-canvas > .stonetop-timeline-swim)", "padding-left"))
			.toBe("0");
		expect(value(".stonetop-timeline:not(.stonetop-timeline--horizontal) .stonetop-timeline-scroll", "padding-left"))
			.toBe("0");
		expect(readRepo("module/dialogs/TimelineWindow.js")).toContain("pinLeft: !(roomAcrossLine && !readAcross),");
	});

	// The aggregate stops at its foot (user, 2026-10-05); a single thread read down does too. Read
	// across, a single thread's line can be dragged to the middle of the view, so it has room above
	// AND below it (user, 2026-10-07).
	it("stops the column at the timeline's foot, but for a single thread's line read across", () => {
		const src = readRepo("module/dialogs/TimelineWindow.js");
		expect(src).toContain("pinBottom: !(roomAcrossLine && readAcross),");
		expect(src).toContain("const roomAcrossLine = this.isSingleTrack;");
	});

	// THE WHEEL'S ZOOM goes on the picture and never on the canvas, whose padding is the drag gutter
	// (a share of the window). Down's canvas widens by the same scale, or a zoomed Down timeline only
	// re-wraps its cards bigger instead of growing as one picture the way the map's board does.
	it("zooms the picture inside the canvas, and widens Down's canvas with it", () => {
		expect(value(".stonetop-timeline-canvas > *", "zoom")).toBe("var(--wheel-zoom, 1)");
		expect(value(".stonetop-timeline-canvas", "zoom")).toBeNull();
		expect(value(".stonetop-timeline:not(.stonetop-timeline--horizontal) .stonetop-timeline-canvas", "width"))
			.toBe("calc(100% * var(--wheel-zoom, 1))");
	});

	// The line sits at one height all the way across only because every season shares the same
	// three rows.
	it("shares the three rows of the axis across every season", () => {
		expect(value(".stonetop-timeline-hperiod", "grid-template-rows")).toBe("subgrid");
		expect(value(".stonetop-timeline-htrack", "grid-template-rows")).toBe("auto auto auto");
	});

	// A sticky `top: 0` pins below the scroll box's top padding, leaving a strip the cards show through.
	it("keeps the pinned heads flush with the top of the scroll box", () => {
		expect(value(".stonetop-timeline-scroll", "padding")).toMatch(/^0\b/);
		expect(value(".stonetop-timeline-scroll > :first-child", "margin-top")).toBe("12px");
	});

	// Sticky cells with no fill let the cards slide visibly underneath them.
	it("pins the swimlane heads with an opaque fill", () => {
		for (const sel of [".stonetop-timeline-swim-lane-head", ".stonetop-timeline-swim-head"]) {
			expect(value(sel, "position"), `${sel} is not pinned`).toBe("sticky");
		}
		expect(value(".stonetop-timeline-swim-head", "background")).toContain("--stonetop-bg");
		expect(value(".stonetop-timeline-swim-lane-head::before", "background")).toContain("--stonetop-bg");
	});

	// The thread names wear the season heads' box: a 2px edge all round, rounded.
	it("boxes the swimlane thread names all round, like the season heads", () => {
		expect(value(".stonetop-timeline-swim-lane-head::before", "border")).toBe("2px solid var(--st-card-rule)");
		expect(value(".stonetop-timeline-swim-lane-head::before", "border-radius")).toBe("var(--st-radius)");
	});

	// The season heads showed through the 10px gaps between the names (user, 2026-10-04). The cell
	// is a page-coloured backing reaching half the row gap each way, and the box sits inside it by
	// exactly that reach. Never into the column gap: the seasons were cut off short of the box.
	it("backs the names so nothing shows through the gaps between them", () => {
		expect(value(".stonetop-timeline-swim", "gap")).toBe("10px");
		expect(value(".stonetop-timeline-swim-lane-head", "background")).toBe("var(--st-page)");
		expect(value(".stonetop-timeline-swim-lane-head", "margin-block")).toBe("-5px");
		expect(value(".stonetop-timeline-swim-lane-head", "margin")).toBeNull();
		expect(value(".stonetop-timeline-swim-lane-head::before", "inset")).toBe("5px 0");
		expect(value(".stonetop-timeline-swim-lane-head::before", "z-index")).toBe("-1");
	});

	// The scroll region is focusable so a keyboard can move it; it must show when it has focus.
	it("shows the keyboard on the scroll region", () => {
		expect(declarations(CSS, ".stonetop-timeline-scroll:focus-visible")).toContain("outline");
		expect(readRepo("templates/dialogs/timeline.hbs")).toMatch(/stonetop-timeline-scroll" tabindex="0"/);
	});
});

describe("in a sheet it runs edge to edge, like the relationship map's tab", () => {
	// User, 2026-10-01: no scrollbars, and out to the sheet's edge. The canvas carries a drag gutter
	// on every side, so the column ALWAYS overflows both ways; without this both bars are always drawn.
	// And in the pop-out window (user, 2026-10-03).
	it("hides the column's scrollbars on both sheets and in the pop-out", () => {
		for (const sel of [
			".pbta.sheet.actor.character .tab.timeline .stonetop-timeline-scroll",
			".steading-sheet .tab.timeline .stonetop-timeline-scroll",
			".stonetop-timeline-app .stonetop-timeline-scroll",
		]) expect(value(sel, "scrollbar-width"), sel).toBe("none");
	});

	it("drops the steading's 12px tab padding", () => {
		expect(value(".steading-sheet .tab.timeline .sheet-tab", "padding")).toBe("0");
	});

	// The steading shares the relationship map tab's three bleed rules (see
	// relationship-map-tab-bleed.test.js); each must name the timeline tab too.
	it("takes the map tab's bleed on the steading", () => {
		for (const sel of [
			".steading-sheet .sheet-wrapper:has(.tab.timeline.active)",
			".steading-sheet-layout:has(> .sheet-body > .tab.timeline.active)",
			".steading-sheet .sheet-body:has(> .tab.timeline.active)",
		]) expect(declarations(CSS, sel), sel).toBeTruthy();
		expect(value(".steading-sheet-layout:has(> .sheet-body > .tab.timeline.active)", "margin-inline")).toBe("-8px");
	});

	// Left over the form's 8px only (the moves sidebar is the right-hand neighbour), and the gutter
	// given back so the column meets the sidebar's rule.
	it("bleeds left and gives back the gutter on the character sheet", () => {
		expect(value(".pbta.sheet.actor.character .stonetop-sheet-layout:has(> .sheet-body > .tab.timeline.active)", "margin-left"))
			.toBe("-8px");
		expect(value(".pbta.sheet.actor.character .stonetop-sheet-layout .sheet-body:has(> .tab.timeline.active)", "scrollbar-gutter"))
			.toBe("auto");
	});
});

describe("the entry dialog", () => {
	// ⚠ The dialog is `_autoHeight`, so it re-fits the window to its content on every render. A
	// textarea with no ceiling grows the window past the bottom of the screen.
	it("caps the account field, which is the only thing in it that can grow", () => {
		expect(value(".stonetop-timeline-entry-body", "max-height")).toBeTruthy();
	});
});

describe("the pop-out looks like the tabs", () => {
	// ⚠ THE POP-OUT WEARS `.stonetop-themed` AND THE TABS DO NOT. That skin inks every label, p and
	// h1-h4 at (0,4,1) and paints every button slate at (0,4,1), so a timeline rule of one or two
	// classes is right in the sheet tabs and silently beaten in the pop-out. It happened to the
	// Layout strip, three toolbar buttons, the headings, the place line and the empty thread's
	// invite, each found by eye. So: every such element in the board's templates whose own rule sets
	// an ink or a fill must have a rule under the themed scope saying the same thing.
	const TEMPLATES = ["templates/dialogs/timeline.hbs", "templates/dialogs/partials/timeline-card.hbs",
		"templates/dialogs/partials/timeline-period.hbs", "templates/dialogs/partials/timeline-period-head.hbs",
		"templates/dialogs/partials/timeline-hperiod.hbs", "templates/dialogs/partials/timeline-lane-head.hbs"];
	const TEXT = /^(p|label|h[1-4])$/;
	const PALETTE = /stonetop-dark|stonetop-slate|stonetop-high-contrast|past-death/;
	const STATE = /:(hover|focus|focus-visible|focus-within|active|disabled|checked)\b/;

	/** The last compound of a selector, splitting on combinators outside parentheses. */
	function lastCompound(sel) {
		let depth = 0, cut = 0;
		for (let i = 0; i < sel.length; i++) {
			const ch = sel[i];
			if (ch === "(") depth++;
			else if (ch === ")") depth--;
			else if (depth === 0 && /[\s>+~]/.test(ch)) cut = i + 1;
		}
		return sel.slice(cut);
	}

	const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.flatMap(([, prelude, body]) => splitSelectorList(prelude).map(sel => ({ sel, body })));
	const names = (sel, cls) => new RegExp(`\\.${cls}(?![\\w-])`).test(sel);
	const last = (body, prop) => {
		const found = [...body.matchAll(new RegExp(`(?:^|[;{])\\s*${prop}\\s*:([^;]+)`, "g"))];
		return found.length ? found.at(-1)[1].trim().replace(/\s+/g, " ") : null;
	};

	const elements = TEMPLATES.flatMap(rel => [...stripComments(readRepo(rel))
		.matchAll(/<(p|label|h[1-4]|button)\b[^>]*\bclass="([^"]*)"/g)]
		// `{{…}}` out first: `period-title{{#if glyphClass}} …` would otherwise read as one word.
		.map(([, tag, cls]) => ({ rel, tag, classes: cls.replace(/\{\{[^}]*\}\}/g, " ").split(/\s+/)
			.filter(c => /^stonetop-timeline-[\w-]+$/.test(c)) })));

	it("found the elements it is about", () => {
		expect(elements.filter(e => TEXT.test(e.tag)).length).toBeGreaterThan(8);
		expect(elements.filter(e => e.tag === "button").length).toBeGreaterThan(5);
	});

	for (const { rel, tag, classes } of elements) {
		for (const cls of classes) {
			const props = TEXT.test(tag) ? ["color"] : ["background", "color"];
			for (const prop of props) {
				const base = RULES.filter(r => names(lastCompound(r.sel), cls) && !/stonetop-themed/.test(r.sel)
					&& !PALETTE.test(r.sel) && !STATE.test(r.sel) && last(r.body, prop));
				if (!base.length) continue;
				it(`restates ${cls}'s ${prop} under the themed scope (${rel.split("/").pop()} <${tag}>)`, () => {
					const want = last(base.at(-1).body, prop);
					const themed = RULES.filter(r => /stonetop-themed/.test(r.sel) && names(r.sel, cls)
						&& !STATE.test(r.sel) && last(r.body, prop));
					expect(themed.length, `nothing under .stonetop-themed sets ${prop} on .${cls}; the pop-out paints it the skin's way`)
						.toBeGreaterThan(0);
					expect(last(themed.at(-1).body, prop), `.${cls}'s ${prop} differs in the pop-out`).toBe(want);
				});
			}
		}
	}
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

// Core hands a window's buttons `transition: all 0.5s`, and the wheel's CSS `zoom` changes every
// metric of every button inside the picture, so each notch set every card's controls animating their
// size for half a second, laid out again on every frame (a trace of a long campaign: the zoom and the
// scrolling after it both stuttered on it). Colour only, as `.stonetop-cta` already learned.
describe("the zoomed picture's buttons", () => {
	it("transition colour only, never a metric", () => {
		const body = stripComments(BLOCK).match(/\.stonetop-timeline-card-actions\)\s*button\s*\{([^}]*)\}/)?.[1];
		expect(body, "the card controls' button rule is missing").toBeTruthy();
		const transition = body.match(/transition:\s*([^;]+);/)?.[1];
		expect(transition, "no transition named, so core's `all 0.5s` applies").toBeTruthy();
		for (const part of transition.split(",")) {
			expect(part.trim().split(/\s+/)[0]).toMatch(/^(background-color|border-color|color)$/);
		}
	});
});

describe("a season's name centred in its heading", () => {
	// "Summer" sat off centre in its chip (user, 2026-10-04): the journals' glyph is an inline picture
	// lowered into the line, which set the line box the word sat in. Here the glyph is a flex item and
	// the name its own span trimmed to its capitals, as every chip is centred.
	it("wraps the name in a span of its own", () => {
		expect(readRepo("templates/dialogs/partials/timeline-period-head.hbs"))
			.toMatch(/<span class="stonetop-timeline-period-name">\{\{#if undated\}\}\{\{label\}\}\{\{else\}\}\{\{seasonLabel\}\}\{\{\/if\}\}<\/span>/);
	});

	it("centres the glyph and the trimmed name on one flex line", () => {
		const title = declarations(CSS, ".stonetop-timeline-period-title");
		expect(title).toMatch(/display:\s*flex/);
		expect(title).toMatch(/align-items:\s*center/);
		expect(declarations(CSS, ".stonetop-timeline-period-title.stonetop-season-entry::before")).toMatch(/margin-right:\s*0/);
		const name = declarations(CSS, ".stonetop-timeline-period-name");
		expect(name).toMatch(/text-box:\s*trim-both cap alphabetic/);
		expect(name).toMatch(/padding:\s*var\(--st-trim-top\) 0 var\(--st-trim-bottom\)/);
	});
});
