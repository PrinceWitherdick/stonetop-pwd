/**
 * The ward's repelled-or-trapped toggle, at the three joints where it can fail silently.
 *
 * Wards & Bindings asks for two things — who the signs affect, and whether those beings are
 * repelled or trapped — and the roster only ever recorded the first. The second is a field on the
 * ward row (see blessed-marks.js on why a field and not a sixth kind); this file guards the half
 * that lives in markup, which the data tests cannot see:
 *
 *  • the TEMPLATE renders both sides and flags the chosen one, and shows a read-only viewer the
 *    answer without a dead control to press;
 *  • the DIALOG binds the classes the template actually emits — the same silent-failure the add
 *    bars guard, since a renamed class binds nothing and throws nothing;
 *  • the CSS says which side is chosen, because the toggle's entire job is to be readable at a
 *    glance and a segmented pair with no active styling is two grey words.
 */
import { describe, it, expect } from "vitest";
import Handlebars from "handlebars";
import { readRepo as read, readCss, declarations } from "../../fakes/css.js";
import { WARD_SIGNS } from "../../../module/actors/character/blessed-marks.js";

const MARKS_HBS = read("templates/dialogs/blessed-marks.hbs");
const ROW_HBS   = read("templates/dialogs/partials/roster-row.hbs");
const ADD_HBS   = read("templates/dialogs/partials/roster-add.hbs");
const MARKS_JS  = read("module/actors/character/dialogs/BlessedMarksDialog.js");
const CSS       = readCss();

/** The marks window, rendered over a context. */
function render(context) {
	const hb = Handlebars.create();
	hb.registerPartial("stonetop.roster-row", ROW_HBS);
	hb.registerPartial("stonetop.roster-add", ADD_HBS);
	hb.registerHelper("localize", k => String(k));
	hb.registerHelper("eq", (a, b) => a === b);
	return hb.compile(MARKS_HBS)(context);
}

/** One ward group holding one row, which is all these assertions need around the toggle. */
function wardWindow({ sign = "repelled", editable = true } = {}) {
	return render({
		editable,
		hasGroups: true,
		groups: [{
			key: "ward", label: "Ward or binding", rule: "Sacred signs on a boundary…",
			empty: "Nothing is warded.",
			rows: [{
				id: "w1", name: "the north gate", note: "", img: "", imgStyle: "", linked: false,
				pips: null, notePlaceholder: "Who or what the signs affect…",
				signs: WARD_SIGNS.map(s => ({ ...s, active: s.key === sign })),
				signUnset: !sign,
			}],
		}],
		kinds: [{ key: "ward", label: "Ward or binding", subject: "place", signs: true }],
		canAdd: editable,
		defaultKind: "ward",
		signs: WARD_SIGNS,
		defaultSign: "repelled",
		signsOpen: true,
	});
}

describe("the ward's repelled-or-trapped toggle", () => {
	it("offers both sides of the choice on the row", () => {
		const html = wardWindow();
		for (const { label } of WARD_SIGNS) {
			expect(html, `no "${label}" on the row`).toContain(`>${label}</button>`);
		}
		expect(html).toMatch(/data-sign="repelled"/);
		expect(html).toMatch(/data-sign="trapped"/);
	});

	// Both buttons carry the row's handle, not the kind's: the click writes to ONE row, and a
	// button that carried the group's key would answer for every ward on the roster.
	it("hands each button the row it belongs to", () => {
		const html = wardWindow();
		const buttons = [...html.matchAll(/<button[^>]*class="stonetop-mark-sign-btn[^"]*"[^>]*>/g)];
		expect(buttons).toHaveLength(WARD_SIGNS.length);
		for (const [tag] of buttons) expect(tag).toContain('data-row-id="w1"');
	});

	it("marks the chosen side, and only that side", () => {
		const trapped = wardWindow({ sign: "trapped" });
		const active = [...trapped.matchAll(
			/<button[^>]*class="stonetop-mark-sign-btn is-active"[^>]*data-sign="([^"]+)"/g,
		)];
		expect(active.map(m => m[1])).toEqual(["trapped"]);
		// And the row is not left claiming the question is still open.
		expect(trapped).not.toContain("is-unset");
	});

	// Every ward laid before this field existed. The pair says the question is open rather than
	// looking like a control that merely happens to be off.
	it("shows a ward nobody has answered for as unset, with neither side chosen", () => {
		const html = wardWindow({ sign: "" });
		expect(html).toContain("stonetop-mark-sign is-unset");
		expect(html).not.toContain("is-active");
		expect(html).toContain("stonetop.blessedMarks.signUnset");
	});

	// A viewer who cannot write gets the ANSWER, not a widget that does nothing when pressed.
	it("shows a read-only viewer the chosen side alone", () => {
		const html = wardWindow({ sign: "trapped", editable: false });
		expect(html).toContain(">Binding</span>");
		expect(html).not.toContain("Ward</span>");
		expect(html).not.toContain("<button");
	});

	// The wrapper is dropped entirely, not left to `:empty` — the whitespace this template indents
	// with is a text node, so an empty-looking span would still have drawn its dashed box.
	it("renders no toggle at all for a read-only viewer of an unanswered ward", () => {
		const html = wardWindow({ sign: "", editable: false });
		expect(html).not.toContain("stonetop-mark-sign");
		// And the row is still there to look at.
		expect(html).toContain("the north gate");
	});
});

describe("the add row's sign picker", () => {
	it("offers both, defaulting visibly to the ward", () => {
		const html = wardWindow();
		expect(html).toMatch(/<select class="stonetop-marks-sign"/);
		expect(html).toMatch(/<option value="repelled" selected>Ward<\/option>/);
		expect(html).toMatch(/<option value="trapped">Binding<\/option>/);
	});

	// Rendered always, shown only for the ward — hidden rather than re-rendered, because the kind
	// picker changes on every glance through the list and a re-render drops a half-typed name.
	it("hides itself when the kind picker is not on the ward", () => {
		const html = render({
			editable: true, hasGroups: false, groups: [],
			kinds: [{ key: "barkskin", label: "Barkskin", subject: "person", signs: false }],
			canAdd: true, defaultKind: "barkskin",
			signs: WARD_SIGNS, defaultSign: "repelled", signsOpen: false,
		});
		expect(html).toMatch(/<select class="stonetop-marks-sign"[^>]*hidden/);
	});

	it("is followed by the kind picker rather than left behind by it", () => {
		expect(MARKS_JS).toMatch(/_syncSignPicker\(root\)/);
		// The change handler reads the kind picker and re-syncs off it. Matched as a block rather
		// than as one line, because the same handler now also remembers what was picked.
		expect(MARKS_JS).toMatch(/stonetop-marks-kind"\)[\s\S]{0,240}?this\._syncSignPicker\(root\)/);
	});

	// `_lay` promises that laying three marks in a row does not mean re-picking the kind and the
	// sign each time, and it finishes with a full re-render — so both have to survive one. They
	// did not: `getData` rebuilt the add row from the constants, so the kind fell back to
	// `kinds[0]` (never the ward, which MARK_KINDS lists last) and the sign to "repelled".
	it("keeps the last picked kind and sign across the re-render that follows a mark", () => {
		expect(MARKS_JS).toMatch(/this\._addKind\s*=/);
		expect(MARKS_JS).toMatch(/this\._addSign\s*=/);
		expect(MARKS_JS).toMatch(/kinds\.some\(k => k\.key === this\._addKind\)/);
		expect(MARKS_JS).toMatch(/WARD_SIGNS\.some\(s => s\.key === this\._addSign\)/);
	});
});

// The add bars' failure mode, in a second place: a renamed class binds nothing and throws nothing,
// so the toggle reads as a dead control rather than an unwired one.
describe("what the dialog binds", () => {
	it("listens for the class the row actually renders", () => {
		expect(wardWindow()).toContain('class="stonetop-mark-sign-btn');
		expect(MARKS_JS).toContain('closest(".stonetop-mark-sign-btn")');
	});

	it("reads the picker the add row actually renders", () => {
		expect(wardWindow()).toContain('class="stonetop-marks-sign"');
		expect(MARKS_JS).toContain('querySelector(".stonetop-marks-sign")');
	});

	// One click sets, and nothing un-sets: Loyalty is a quantity that goes both ways, this is a
	// choice the move requires you to have made. A two-way gesture here would let a click put a
	// ward back into the state only a pre-toggle row can honestly be in.
	it("sets the side clicked rather than toggling it off", () => {
		expect(MARKS_JS).toMatch(/_setSign\(id, sign\)\s*\{[\s\S]*?if \(!id \|\| !sign\) return;/);
		expect(MARKS_JS).toMatch(/setBlessedMarkSign\(id, sign\)/);
	});
});

describe("what the toggle looks like", () => {
	it("styles both the button and the read-only span", () => {
		expect(declarations(CSS, ".stonetop-mark-sign-btn")).toBeTruthy();
		expect(declarations(CSS, "button.stonetop-mark-sign-btn")).toBeTruthy();
		expect(declarations(CSS, "span.stonetop-mark-sign-btn")).toMatch(/cursor:\s*default/);
	});

	// The whole job of a segmented pair is to be readable at a glance; with no active styling it
	// is two grey words and the row still does not say which one it is.
	it("says which side is chosen", () => {
		const active = declarations(CSS, "button.stonetop-mark-sign-btn.is-active");
		expect(active).toBeTruthy();
		expect(active).toMatch(/background:/);
		expect(active).toMatch(/color:/);
	});

	// A modifier that sorts BEFORE its base loses the tie — see the BEM ordering note in the
	// stylesheet. Here that would mean the chosen side losing its ink to a passing cursor.
	it("declares the chosen side after the hover it has to beat", () => {
		const hover  = CSS.indexOf("button.stonetop-mark-sign-btn:hover");
		const active = CSS.indexOf("button.stonetop-mark-sign-btn.is-active");
		expect(hover).toBeGreaterThan(-1);
		expect(active).toBeGreaterThan(hover);
	});

	// `[hidden]` alone loses to core's `body.game .app select`, which is more specific — without
	// this the ward's picker sits in the add row asking about Barkskin.
	it("makes the add-row picker's hidden attribute stick", () => {
		expect(declarations(CSS, ".stonetop-marks-sign[hidden]")).toMatch(/display:\s*none/);
	});
});
