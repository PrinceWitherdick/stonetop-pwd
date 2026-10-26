import { describe, expect, it } from "vitest";
import { declarations, declared, ownRule, readCss, readRepo, splitSelectorList, stripComments } from "../fakes/css.js";
import { seat } from "../fakes/camp.js";
import { CAMP_STATE, campLedger } from "../../module/camp/camp-rules.js";
import { campWindowView } from "../../module/camp/camp-view.js";

/**
 * THE MAKE CAMP WINDOW WEARS THE SYSTEM'S OWN SKINS (templates/dialogs/make-camp.hbs).
 *
 * Every failure guarded here is silent. A checkbox that reaches no skin is drawn by Foundry core as
 * the browser's own box, in a window whose every other control is drawn; a radio gets the browser's
 * dot plus core's 2px drop; a class misspelled in the template renders perfectly, in the wrong
 * colour. Nothing is logged in any of those cases, which is how the window first shipped with all
 * three.
 */

const CSS = readCss();
const TEMPLATE_PATH = "systems/stonetop-pwd/templates/dialogs/make-camp.hbs";
const TEMPLATE = stripComments(readRepo("templates/dialogs/make-camp.hbs"));

const inputs = type => [...TEMPLATE.matchAll(new RegExp(`<input type="${type}"[^>]*>`, "g"))].map(m => m[0]);
const button = action => TEMPLATE.match(new RegExp(`<button[^>]*data-camp-action="${action}"[^>]*>`))?.[0] ?? "";

/** The selector lists of every rule that names `selector` as one of its entries. */
function listsNaming(selector) {
	return [...CSS.matchAll(/([^{}]+)\{[^{}]*\}/g)]
		.map(([, prelude]) => splitSelectorList(prelude))
		.filter(list => list.includes(selector));
}

describe("the camp window's controls", () => {
	it("draws every checkbox with the shared spiral skin", () => {
		const boxes = inputs("checkbox");
		expect(boxes.length).toBeGreaterThan(0);
		for (const box of boxes) expect(box).toContain('class="stonetop-check"');
		expect(declarations(CSS, ".stonetop-check")).toMatch(/background:\s*var\(--stonetop-checkbox-icon\)/);
		expect(declarations(CSS, ".stonetop-check:checked")).toMatch(/background:\s*var\(--stonetop-checkbox-checked-icon\)/);
	});

	it("draws every radio with the shared round skin", () => {
		const radios = inputs("radio");
		expect(radios.length).toBeGreaterThan(0);
		for (const radio of radios) expect(radio).toContain('class="stonetop-camp-radio"');
		// On the round-radio block the worksheet pick-1 radios share, not a copy of it beside the camp
		// rules: a copy drifts the first time the ring or the dot is retuned in only one place.
		expect(listsNaming(".stonetop-camp-radio").some(list => list.includes(".stonetop-cm-radio"))).toBe(true);
		expect(listsNaming(".stonetop-camp-radio:checked").some(list => list.includes(".stonetop-cm-radio:checked"))).toBe(true);
		expect(declarations(CSS, ".stonetop-camp-radio")).toMatch(/border-radius:\s*50%/);
	});

	it("seats each control on its label's first line, naming what core sets on it", () => {
		const seat = ownRule(CSS, ".stonetop-camp-check > input");
		expect(seat, "the seat rule is gone").toBeTruthy();
		// Core drops an app's radio 2px with `top`, and an unlayered rule only outranks that for the
		// properties it declares, so leaving `top` unsaid leaves every radio low.
		expect(declared(seat, "top")).toBe("0");
		expect(declared(seat, "margin")).toBe("calc((1lh - var(--st-check-size)) / 2) 0 0");
		// Both skins it seats are drawn at that one size.
		expect(declarations(CSS, ".stonetop-camp-radio")).toMatch(/height:\s*var\(--st-check-size\) !important/);
		expect(declarations(CSS, ".stonetop-camp-extra-check")).toMatch(/height:\s*var\(--st-check-size\) !important/);
		// `1lh` is read off the input's own leading, which is only the label's line once inherited.
		expect(declared(seat, "line-height")).toBe("inherit");
		expect(declared(seat, "font-size")).toBe("inherit");
		expect(declared(ownRule(CSS, ".stonetop-camp-check"), "align-items")).toBe("flex-start");
	});
});

describe("the camp window's buttons", () => {
	it("puts the dialogs' red confirm on Break up the camp, the one thing nobody can take back", () => {
		expect(button("break")).toContain("stonetop-dialog-btn--danger");
		expect([...TEMPLATE.matchAll(/stonetop-dialog-btn--danger/g)]).toHaveLength(1);
	});

	it("leaves Go without and Eat after all plain, since each one takes the other back", () => {
		expect(button("go-without")).toBeTruthy();
		expect(button("go-without")).not.toContain("danger");
		expect(button("eat")).toBeTruthy();
		expect(button("eat")).not.toContain("danger");
	});

	it("leaves Send them away plain, since Bring someone puts them straight back", () => {
		expect(button("send-away")).toBeTruthy();
		expect(button("send-away")).not.toContain("danger");
	});

	it("keeps a face that opens a sheet the size of the face", () => {
		// Core makes a button a block-level flex box, which fills the header and pushes the name aside.
		const face = ownRule(CSS, ".stonetop-camp-portrait-btn");
		expect(declared(face, "display")).toBe("inline-flex");
		expect(declared(face, "width")).toBe("auto");
		expect(declared(face, "min-height")).toBe("0");
		expect(declarations(CSS, ".stonetop-camp-portrait-btn:focus-visible")).toMatch(/outline:/);
	});

	it("paints no red of its own over the shared rule", () => {
		// Break up takes its red from the shared confirm alone, so no rule of the camp's names it at all.
		expect(listsNaming(".stonetop-camp-break")).toEqual([]);
		expect(listsNaming(".stonetop-guide-nav .stonetop-camp-break")).toEqual([]);
		expect(declarations(CSS, ".stonetop-camp-eating-btn") ?? "").not.toMatch(/--st-red-/);
		expect(declarations(CSS, ".stonetop-camp-without") ?? "").not.toMatch(/--st-red-/);
	});
});

describe("the camp window's cards", () => {
	it("fits as many columns as the window has room for, whoever is at the fire", () => {
		// auto-fill, not auto-fit: the column count follows the window, so a card never changes width
		// because someone sat down or got up beside it.
		const rows = ownRule(CSS, ".stonetop-camp-rows");
		expect(declared(rows, "display")).toBe("grid");
		expect(declared(rows, "grid-template-columns")).toMatch(/^repeat\(auto-fill, minmax\(min\(100%, [\d.]+em\), 1fr\)\)$/);
	});

	it("keeps each card's foot on its bottom edge, level with the card beside it", () => {
		const row = ownRule(CSS, ".stonetop-camp-row");
		expect(declared(row, "display")).toBe("flex");
		expect(declared(row, "flex-direction")).toBe("column");
		expect(declared(ownRule(CSS, ".stonetop-camp-row-foot"), "margin")).toMatch(/^auto /);
	});

	it("lets a card of sentences keep its own height beside a card of controls", async () => {
		const html = await renderTemplate(TEMPLATE_PATH, campWindowView({
			state: CAMP_STATE.OPEN, hostName: "Aeliana", manages: false, editable: ["bram"], mine: ["bram"],
			ledger: campLedger([seat({ id: "aeliana", name: "Aeliana", isHost: true }), seat({ id: "bram", name: "Bram", joinedAt: 2 })]),
		}));
		expect(html).toContain('<li class="stonetop-camp-row is-readonly" data-actor-id="aeliana">');
		expect(html).toContain('<li class="stonetop-camp-row is-mine" data-actor-id="bram">');
		// Stretched to the row, the sentences sat at the top of an empty box as tall as the controls.
		expect(declared(ownRule(CSS, ".stonetop-camp-row.is-readonly"), "align-self")).toBe("start");
	});

	it("marks a card going without by its edge's style and a gold line, leaving the reader's own edge its colour", async () => {
		const html = await renderTemplate(TEMPLATE_PATH, campWindowView({
			state: CAMP_STATE.OPEN, hostName: "Aeliana", manages: false, editable: ["bram"], mine: ["bram"],
			ledger: campLedger([seat({ id: "aeliana", name: "Aeliana", isHost: true }), seat({ id: "bram", name: "Bram", joinedAt: 2, choices: { eats: false } })]),
		}));
		expect(html).toContain('<li class="stonetop-camp-row is-mine is-going-without" data-actor-id="bram">');
		const edge = declarations(CSS, ".stonetop-camp-row.is-going-without");
		expect(edge).toMatch(/border-style:\s*dashed/);
		// `.is-mine` colours the edge; a colour here would hide whose card it is.
		expect(edge).not.toMatch(/border-color|border:/);
		// Gold is the stylesheet's caution: a cost somebody chose, not a failure.
		expect(declarations(CSS, ".stonetop-camp-without")).toMatch(/var\(--st-gold-/);
	});

	it("files the stepper line after the line it modifies, which is the only reason it wins", () => {
		// `.stonetop-camp-line--stepper` and `.stonetop-camp-line` are one class each, so whichever
		// sits later decides `flex-wrap`.
		expect(CSS.indexOf(".stonetop-camp-line--stepper {")).toBeGreaterThan(CSS.indexOf(".stonetop-camp-line {"));
	});
});
