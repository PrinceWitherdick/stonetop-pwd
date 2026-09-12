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
import { readRepo as read, readCss, declarations } from "../../fakes/css.js";
import { renderRoster } from "../../fakes/hbs.js";
import { WARD_SIGNS } from "../../../module/actors/character/blessed-marks.js";

const MARKS_HBS = read("templates/dialogs/blessed-marks.hbs");
const MARKS_JS  = read("module/actors/character/dialogs/BlessedMarksDialog.js");
const CSS       = readCss();

/** The marks window, rendered over a context. */
const render = (context) => renderRoster(MARKS_HBS, context);

/** One kind's panel, in the shape getData builds them. */
function panel({ key, label, rows = [], canAdd = true, signs = null }) {
	return {
		key, label, rule: `${label} does something…`, icon: "fa-shield-halved",
		rows, hasRows: rows.length > 0,
		canAdd, signs,
	};
}

/** One ward panel holding one row, which is all these assertions need around the toggle. */
function wardWindow({ sign = "repelled", editable = true, pickedSign = "repelled" } = {}) {
	return render({
		editable,
		hasGroups: true,
		railed: false,
		activeTab: "ward",
		// One suggestion list for every panel's add bar, named by id from each of them.
		listId: "stonetop-marks-suggestions", suggestions: [],
		tabs: [],
		groups: [panel({
			key: "ward", label: "Ward or binding", canAdd: editable,
			signs: WARD_SIGNS.map(s => ({ ...s, selected: s.key === pickedSign })),
			rows: [{
				id: "w1", name: "the north gate", note: "", img: "", imgStyle: "", linked: false,
				pips: null, notePlaceholder: "Who or what the signs affect…",
				signs: WARD_SIGNS.map(s => ({ ...s, active: s.key === sign })),
				signUnset: !sign,
			}],
		})],
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

describe("the add bar's sign picker", () => {
	it("offers both, defaulting visibly to the ward", () => {
		const html = wardWindow();
		expect(html).toMatch(/<select class="stonetop-marks-sign"/);
		expect(html).toMatch(/<option value="repelled" selected>Ward<\/option>/);
		expect(html).toMatch(/<option value="trapped">Binding<\/option>/);
	});

	// It lives in the ward's OWN panel now, so the four kinds that ask no such question simply do
	// not render it — where the single shared add row had to hide it as a picker moved, and got a
	// dedicated `[hidden]` CSS rule to make that stick against core's `select` styling.
	it("appears in no panel but the ward's", () => {
		const html = render({
			editable: true, hasGroups: true, railed: true, activeTab: "barkskin",
			listId: "stonetop-marks-suggestions", suggestions: [],
			tabs: [{ key: "barkskin", title: "Barkskin", icon: "fa-shield-halved", selected: true }],
			groups: [panel({ key: "barkskin", label: "Barkskin" })],
		});
		expect(html).toContain("stonetop-marks-add-btn");   // the bar is there
		expect(html).not.toContain("stonetop-marks-sign");  // the question is not
	});

	// The kind is the panel you are standing in, so there is nothing to pick it with and no state
	// in which a name has been typed and the kind has not been chosen. The old `<select>`, the
	// warning it needed ("Pick which mark you are laying first") and the show/hide that followed it
	// are all gone together; leaving any one of them behind is how this half-reverts.
	it("is the only picker left, the kind being the panel", () => {
		expect(MARKS_JS).not.toContain("stonetop-marks-kind");
		expect(MARKS_JS).not.toContain("_syncSignPicker");
		expect(MARKS_JS).not.toContain("blessedMarks.noKind");
		expect(wardWindow()).not.toContain("stonetop-marks-kind");
		// The kind comes off the panel the bar sits in, both when typed and when dropped.
		expect(MARKS_JS).toMatch(/panel\.dataset\.markKind/);
	});

	// `_lay` promises that warding three doorways against the same thing does not mean re-picking
	// each time, and it finishes with a full re-render — so the answer has to survive one. It did
	// not: `getData` rebuilt the bar from the constants, so the sign fell back to "repelled" and
	// the second doorway was quietly stored as a Ward where the player had said Binding.
	it("keeps the last picked sign across the re-render that follows a mark", () => {
		expect(MARKS_JS).toMatch(/this\._addSign\s*=/);
		expect(MARKS_JS).toMatch(/WARD_SIGNS\.some\(s => s\.key === this\._addSign\)/);
		// And the re-render shows it: the picker is built from that remembered answer, not the default.
		expect(wardWindow({ pickedSign: "trapped" }))
			.toMatch(/<option value="trapped" selected>Binding<\/option>/);
	});
});

// The add bars' failure mode, in a second place: a renamed class binds nothing and throws nothing,
// so the toggle reads as a dead control rather than an unwired one.
describe("what the dialog binds", () => {
	it("listens for the class the row actually renders", () => {
		expect(wardWindow()).toContain('class="stonetop-mark-sign-btn');
		expect(MARKS_JS).toContain('closest(".stonetop-mark-sign-btn")');
	});

	it("reads the picker the add bar actually renders", () => {
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

	// Core's `body.game .app select` sets a width these would otherwise inherit, which left the
	// name field with none of the slack. The picker no longer needs a `[hidden]` rule beside this
	// one: it is rendered in the ward's panel and in no other, rather than shown and hidden as a
	// kind picker moved.
	it("keeps the picker from eating the name field's slack", () => {
		const sign = declarations(CSS, ".stonetop-marks-sign");
		expect(sign).toMatch(/flex:\s*0 0 auto/);
		expect(sign).toMatch(/max-width:/);
	});
});
