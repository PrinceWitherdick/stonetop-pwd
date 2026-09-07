import { describe, it, expect } from "vitest";
import { readCss, declarations, readRepo, stripComments } from "../fakes/css.js";

// WHERE THE WORDS SIT INSIDE THE RELATIONSHIP MAP'S CONTROLS.
//
// ⚠ THEY USED TO BE A TOOLBAR, over the board; they are the footer's tool group now, under it.
// Nothing about the measuring changed with the move -- the same buttons, the same face, the same
// arithmetic -- but the token they spend is no longer declared on the row that holds them, and this
// file is where that is held to.
//
// ⚠ WHY THIS FILE EXISTS. Every one of those controls centres a LINE BOX, and in Libre Caslon Text
// the line box is not centred on the ink. The face carries an ascent of 0.958em over a descent of
// 0.272em, so the middle of its line falls 0.343em above the baseline, while the middle of its
// capitals (cap height 0.781em) falls 0.391em above it. The 0.048em between the two is enough to
// read: measured on the real bar, a tool button was leaving about 1.3px more paper under its label
// than over it, and a row of them looks like words sitting high in their boxes.
//
// The correction is one token, `--st-relmap-ink-lift`, declared on the WINDOW ROOT and spent by
// the tool buttons' labels. On the root and not on the row that holds them, which is the whole
// point of asserting it: the buttons have already moved once (the toolbar became the footer), and a
// token declared on whichever row happens to carry them today goes silently missing the next time
// one moves. Nothing about that fails loudly, and nothing renders differently enough for a
// screenshot diff to catch, which is why it is asserted here.
//
// ⚠ AND THE ICONS ARE LEFT ALONE. A Font Awesome glyph in these buttons already sits within a
// quarter-pixel of the centre; lifting it with the words would break what is right. So the button
// rule reaches its label by `> span` rather than moving the whole button's padding, and this file
// guards that too.
//
// Verified offline against core's own stylesheet at root 16, 20 and 24 (the harness is
// `relmap-exact-geom.mjs`): -0.0476em before, under 0.005em after, at every one of them.

const CSS = readCss();

const LIFT = "--st-relmap-ink-lift";

/** The value one selector declares for one property, across every rule that names it. */
function declared(selector, property) {
	const body = declarations(CSS, selector);
	if (body === null) return null;
	const found = [...body.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+);`, "g"))];
	return found.length ? found[found.length - 1][1].trim().replace(/\s+/g, " ") : null;
}

describe("the lift that centres the words on the relationship map's controls", () => {
	it("is declared once, on the window root, in em", () => {
		const value = declared(".stonetop-relmap", LIFT);
		expect(value).toBeTruthy();
		// ⚠ AND NOT ON A ROW INSIDE IT. It was the toolbar's; the toolbar is gone and the buttons
		// it dressed are in the footer, so a token declared on a row is a token one more move loses.
		expect(declared(".stonetop-relmap-bar", LIFT)).toBeNull();
		expect(declared(".stonetop-relmap-foot", LIFT)).toBeNull();
		// `em` and not `px`: the token is resolved against whatever element USES it, and the window
		// carries two different anchors at once. Core anchors a button's font-size in pixels while
		// the label beside it tracks the root, so a pixel lift would be right on one of them and
		// wrong on the other at every font scale but the default.
		expect(value).toMatch(/^0?\.0\d+em$/);
	});

	it("brings the tool buttons' labels down, and not their icons", () => {
		expect(declared(".stonetop-relmap-tool > span", "top")).toBe(`var(${LIFT}, 0)`);
		expect(declared(".stonetop-relmap-tool > span", "position")).toBe("relative");
		// The button itself keeps even padding: an uneven one would carry the icon down too.
		const padding = declared(".stonetop-relmap-tool", "padding");
		expect(padding).toBe("0.25em 0.7em");
		expect(declared(".stonetop-relmap-tool > i", "top")).toBeNull();
	});
});
// ── The two glyph-only buttons at the far end of the footer ─────────────────────────────────────────
//
// Undo and redo carry no words: the curved arrows are the pair every program draws them with, and
// WHICH change a press would take back is in the tooltip and the accessible name, which no button
// label could have held anyway. What that costs is a box that no longer sizes itself sensibly, and
// two separate faults follow from it -- both of the kind this file exists for, in that a browser
// renders them without complaint and no screenshot diff is going to fail:
//
//   1. THE BOX COLLAPSES. Every button here is as tall as its label's line box plus its
//      padding; with no label the box falls back to the icon's own line box, measured 23px against
//      31.4px for "Add someone" beside it -- a pair of small buttons floating in a taller row.
//   2. THE GLYPH SITS OFF CENTRE. Core's `body.game .app button > i` carries `margin-right: 3px`
//      to space an icon from the label that normally follows it, and with no label that margin is
//      welded to the right of the box being centred: the arrow paints ~1.5px LEFT of the middle.
//
// Both are fixed by arithmetic rather than by a pixel count, which is what makes them assertable
// here: the icon is given a content box of exactly the line box a label would have made (1.6em)
// in BOTH axes, and the padding is evened to 0.25em on all four sides, so the border box comes out
// square on its own -- the same 1.6em + 0.5em each way, plus a border that adds equally to each.
//
// Measured against core's own stylesheet (`relmap-history-square.mjs`): 31.391 x
// 31.391 at root 16, square to 0.000 at root 14, 20 and 24 as well, each time within 0.000 of the
// height of the tool beside it, with the icon's box dead on the button's centre in both axes.
describe("the square the history buttons are, having no words in them", () => {
	const PAIR = ".stonetop-relmap-history .stonetop-relmap-tool";

	it("evens the padding up, so the box is as tall as the row and as wide as it is tall", () => {
		// The ordinary tool padding is `0.25em 0.7em`: the 0.7em is the room a LABEL needs beside
		// its icon, and it is exactly what would make these two oblong.
		expect(declared(PAIR, "padding")).toBe("0.25em");
	});

	it("gives the glyph the square box a label's line box would have made", () => {
		// 1.6em each way, which is `line-height: 1.6` on `.stonetop-relmap-tool` said as a length:
		// the content box then matches a labelled button's in the one axis and is square in both.
		expect(declared(`${PAIR} > i`, "width")).toBe("1.6em");
		expect(declared(`${PAIR} > i`, "height")).toBe("1.6em");
		expect(declared(`${PAIR} > i`, "line-height")).toBe("1.6");
		expect(declared(".stonetop-relmap-tool", "line-height")).toBe("1.6");
	});

	it("takes core's icon-to-label margin back off, on every side", () => {
		// `margin: 0` rather than `margin-right: 0`, so a core change to any other side lands the
		// same way. Same fix, same reason, as `.stonetop-relmap-page-tool > i`.
		expect(declared(`${PAIR} > i`, "margin")).toBe("0");
		expect(declared(".stonetop-relmap-page-tool > i", "margin")).toBe("0");
	});

	it("centres the glyph's own box rather than a stretched column", () => {
		expect(declared(PAIR, "justify-items")).toBe("center");
	});

	it("is aimed at buttons that really do have nothing in them but an icon", () => {
		// The arithmetic above is only right while these two carry no label: put one back and the
		// icon keeps a 1.6em box while the word runs out of the square. So the markup is held to
		// it here, where the reason lives.
		const markup = stripComments(readRepo("templates/dialogs/relationship-map.hbs"));
		const pair = markup.match(/<span class="stonetop-relmap-history">[\s\S]*?<\/span>/)[0];
		expect(pair).toContain('data-relmap-action="undo"');
		expect(pair).toContain('data-relmap-action="redo"');
		expect(pair).not.toContain("<span>");
	});
});

// ── The tie bar's presses, which have the same fault for the same reason ────────────────────
//
// The strip that appears over a line the reader has clicked is seven controls, and not one of them
// puts a word after its icon: four glyph-only arrow squares, a glyph-only rubber, and three
// triggers whose caret comes LAST. Core's `body.game .app button > i { margin-right: 3px }` is on
// every one of those icons, so `justify-content: center` was centring a box with 3px of nothing
// welded to its right and every glyph on the bar painted about 1.5px left of where it belongs.
// Measured at 8x against the real Pro webfont (`relmap-tiebar-centre.mjs`): -1.531, -1.563, -1.531
// and -1.563px on the four arrows, -1.445, -1.695 and -1.547px on the three triggers. Zeroed, all
// of them land within 0.23px of centre at root 14 and 16 alike.
//
// The rubber had a SECOND fault on top of it, and one that leant the other way: it is `border-box`
// and 26px wide like the six beside it, and it carried `padding-left` alone -- room between the
// glyph and the divider rule it hangs off -- which narrows the content box and shoves it right.
// The trash printed 0.75px RIGHT of centre in a row of presses that were all 1.5px left. Evening
// the padding up costs no width, because it is spent inside a box whose size is already fixed.
//
// Guarded here rather than left to a screenshot for the reason the rest of this file exists: a
// browser renders all of it without complaint, and one and a half pixels is exactly the size of
// fault that reads as "the icons look off" without ever looking like a number.
describe("the icons on the tie bar, which carry no labels either", () => {
	const ICONS = [
		".stonetop-relmap-tiebar-btn > i",
		".stonetop-relmap-tiebar-inkopen > i",
		".stonetop-relmap-tiebar-dashopen > i",
		".stonetop-relmap-tiebar-sizeopen > i",
	];

	it.each(ICONS)("takes core's icon-to-label margin off %s, on every side", selector => {
		// `margin: 0` rather than `margin-right: 0`, so a core change to any other side lands the
		// same way. Same fix, same reason, as `.stonetop-relmap-page-tool > i` above.
		expect(declared(selector, "margin")).toBe("0");
	});

	it("pads the rubber on both sides, so its own divider gap does not push the glyph over", () => {
		// Not `padding: 0 0.35em`: the button's shorthand `padding: 0` is inherited from
		// `.stonetop-relmap-tiebar-btn`, and what matters is that the two sides MATCH.
		const left = declared(".stonetop-relmap-tiebar-rub", "padding-left");
		const right = declared(".stonetop-relmap-tiebar-rub", "padding-right");
		expect(left).toBe("0.35em");
		expect(right).toBe(left);
	});

	it("is aimed at presses that really do have no word after the icon", () => {
		// The whole correction is only right while these carry no trailing label: put one back and
		// core's margin is doing the job it was written for again. So the markup is held to it here.
		//
		// The seven presses that stand ON the bar, and not the rows in the panels underneath: those
		// hold `<span>` samples rather than `<i>` glyphs, so core's rule never reaches them, and the
		// one that does carry an icon (`inkpop-add`) puts a WORD after it and wants the margin kept.
		const markup = stripComments(readRepo("templates/dialogs/relationship-map.hbs"));
		const PRESSES = /data-relmap-tie="(?:dir|rub|inkopen|dashopen|sizeopen)"/;
		const found = [...markup.matchAll(/<button[\s\S]*?<\/button>/g)]
			.map(match => match[0]).filter(button => PRESSES.test(button));
		// Five and not seven: the four arrows are one {{#each}} over RELMAP_DIRS in the template.
		expect(found).toHaveLength(5);
		for (const button of found) {
			// Every press on the bar ends in either its icon or the mark that stands for its answer,
			// never in words -- except the size trigger, whose number IS its answer and is written
			// between the two icons rather than after either. Those are on `data-relmap-tie-mark`.
			const inside = button.replace(/^<button[\s\S]*?>/, "").replace(/<\/button>$/, "")
				.replace(/<span[^>]*data-relmap-tie-(?:mark|name)[\s\S]*?<\/span>/g, "");
			expect(inside.replace(/<[^>]*>/g, "").trim(), button).toBe("");
		}
	});
});
