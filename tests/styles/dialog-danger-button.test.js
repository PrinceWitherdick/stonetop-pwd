import { describe, it, expect } from "vitest";
import { readCss, readRepo, stripComments } from "../fakes/css.js";

// THE RED CONFIRM, and the two things about it that fail silently.
//
// A Stonetop dialog paints EVERY button in its body as the slate primary pill — one rule, near the
// top of the stylesheet, scoped to `.stonetop-themed` window content. That is right for a confirm
// and wrong for the one confirm that destroys work nobody can get back: deleting a relationship
// map page takes its whole cast and every line drawn between them, and beside a plain "Keep this
// page" the two buttons looked identical.
//
// ⚠ WHY THIS FILE EXISTS. Both halves of the fix are invisible when they break.
//
// The CSS half is decided by ORDER. The slate rule is (0,4,1) and the danger rule matches it
// exactly, so the danger rule only wins because it sits later in the file. Move it up — sorting
// the stylesheet, or filing it beside the other `--danger` buttons a few thousand lines down and
// then moving THOSE — and the button goes back to slate with nothing logged.
//
// The JS half is a string. DialogV2 sets a footer button's className verbatim from `class` in its
// config; misspell it and the button renders perfectly, in slate, and no test that checks the
// dialog's behaviour notices.

const CSS = readCss();

const SLATE = ":is(.application, .window-app).stonetop-themed .window-content button:not([type=checkbox])";
const DANGER = "button.stonetop-dialog-btn--danger";

describe("the destructive confirm in a Stonetop dialog", () => {
	it("is painted from the red family, not by a colour typed at the rule", () => {
		const at = CSS.indexOf(DANGER);
		expect(at).toBeGreaterThan(-1);
		const body = CSS.slice(CSS.indexOf("{", at), CSS.indexOf("}", at));
		// The same three tokens every other destructive control in the system reads. Named
		// rather than spelled: the high-contrast mode re-points these, and a literal would
		// leave this one button behind at 4-point-something to one.
		expect(body).toMatch(/background:\s*var\(--st-red-bg\)/);
		expect(body).toMatch(/border:\s*1px solid var\(--st-red-border\)/);
		expect(body).toMatch(/color:\s*var\(--st-red-text\)/);
	});

	it("says so on hover too", () => {
		expect(CSS).toContain(`${DANGER}:hover`);
		const at = CSS.indexOf(`${DANGER}:hover`);
		const body = CSS.slice(CSS.indexOf("{", at), CSS.indexOf("}", at));
		// Border and ink restated, not just the fill: the slate hover rule above sets its own
		// border-color, and inheriting THAT under a red fill is the one combination neither
		// palette accounts for.
		expect(body).toMatch(/background:\s*var\(--st-red-bg-hover\)/);
		expect(body).toMatch(/border-color:\s*var\(--st-red-border\)/);
		expect(body).toMatch(/color:\s*var\(--st-red-text\)/);
	});

	it("sits after the slate rule it has to beat, which is the only reason it wins", () => {
		const slate = CSS.indexOf(SLATE);
		expect(slate).toBeGreaterThan(-1);
		expect(CSS.indexOf(DANGER)).toBeGreaterThan(slate);
	});

	it("reaches our own dialogs and the allowlisted core windows alike", () => {
		// `.stonetop` is what a DialogV2 of ours carries; `.stonetop-themed` is the marker on the
		// core windows we skin. A destructive confirm belongs in red in either.
		const at = CSS.indexOf(DANGER);
		const prelude = CSS.slice(CSS.lastIndexOf("*/", at) + 2, at);
		expect(prelude).toContain(".stonetop,");
		expect(prelude).toContain(".stonetop-themed");
	});
});

describe("the relationship map's page delete", () => {
	const SRC = stripComments(readRepo("module/dialogs/RelationshipMapWindow.js"));

	it("wears the danger class on the button that commits it", () => {
		expect(SRC).toMatch(/action: "drop",[\s\S]{0,200}class: "stonetop-dialog-btn--danger"/);
	});

	it("leaves the button that keeps the page alone", () => {
		// One red button in the footer, or the colour stops meaning anything.
		const at = SRC.indexOf("pages.deleteCancel");
		const line = SRC.slice(SRC.lastIndexOf("{", at), SRC.indexOf("}", at));
		expect(line).not.toContain("danger");
	});
});
