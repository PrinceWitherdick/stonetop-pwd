import { describe, it, expect } from "vitest";
import { readCss, readRepo, declarations, ownRule } from "../fakes/css.js";

// A FACE THAT CAME WITH ITS OWN RIM.
//
// Every portrait on the relationship map is a 72px circle inside a 3px border. A character who
// picked a playbook and never chose a picture wears the playbook badge instead, and every badge is
// a woodcut drawn INSIDE A HAND-DRAWN CIRCLE — so the board's border landed three pixels outside a
// ring that was already there, and the face read as a target rather than as somebody.
//
// ⚠ WHY THIS IS A STYLESHEET TEST AND NOT A RENDER ONE. The fix is one declaration, and the wrong
// version of it looks right in every test that can be written against markup: `border-color:
// transparent` also makes the doubling go away. What it also does is leave the art inset at 66px
// inside a ring of panel tone, visibly smaller than the portrait beside it — because everything
// here is `box-sizing: border-box` (core's reset), and only DROPPING the border lets the badge grow
// into the full 72px and put its painted ring exactly where the border was. The two spellings are a
// pixel apart in the source and six pixels apart on the board, and nothing logs the difference.
//
// The other half is that the three names have to agree across three files — `ownRing` in the window
// (module/dialogs/RelationshipMapWindow.js), `is-own-ring` in the markup, `is-own-ring` in the
// selector — and a rename of any one of them fails silently as a rim that simply stays.

const CSS = readCss();
const BOARD = readRepo("templates/dialogs/partials/relationship-map-board.hbs");
const WINDOW = readRepo("module/dialogs/RelationshipMapWindow.js");

const FACE = ".stonetop-relmap-face";
const OWN_RING = ".stonetop-relmap-node.is-own-ring:not(.is-missing) .stonetop-relmap-face";

describe("the relationship map's portrait rim", () => {
	// The thing being taken off. Stated here so the override below is measured against a rim that
	// really exists: if the base ever stops drawing one, this suite should say so rather than go on
	// asserting that a border nobody paints is being removed.
	it("is drawn on every face as a border, inside the circle's own 72px", () => {
		const face = declarations(CSS, FACE);
		expect(face).toMatch(/border\s*:\s*3px solid/);
		expect(face).toMatch(/width\s*:\s*72px/);
		expect(face).toMatch(/height\s*:\s*72px/);
	});

	// ⚠ THE WHOLE BORDER, not its colour. See the header: with `border-box` in force, only this
	// spelling grows the badge into the space the border held, which is what puts its drawn ring on
	// the same circle every other portrait's rim is on.
	it("comes off entirely for a face that brought its own ring", () => {
		const rule = ownRule(CSS, OWN_RING);
		expect(rule).toMatch(/border\s*:\s*none/);
		expect(rule).not.toMatch(/border-color/);
		expect(rule).not.toMatch(/transparent/);
	});

	// A missing person's rim is DASHED, and that dash is the only thing on the board saying their
	// actor has gone. Their stored picture can perfectly well be a badge — it is what they were
	// wearing when they were still here — so the exemption has to be spelt out or the mark
	// disappears exactly on the people it is for.
	it("stays on somebody whose actor has gone, whatever picture they left behind", () => {
		expect(CSS).toContain(OWN_RING);
		expect(declarations(CSS, ".stonetop-relmap-node.is-missing .stonetop-relmap-face"))
			.toMatch(/border-style\s*:\s*dashed/);
	});

	// The one class, spelt the same in all three places that have to agree about it.
	it("is asked for by the window, written by the template, and answered by the stylesheet", () => {
		expect(WINDOW).toContain("ownRing: hasOwnRingArt(");
		expect(BOARD).toContain("{{#if ownRing}} is-own-ring{{/if}}");
		expect(CSS).toContain(".stonetop-relmap-node.is-own-ring");
	});
});
