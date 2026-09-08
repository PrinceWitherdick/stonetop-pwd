import Handlebars from "handlebars";
import { describe, it, expect, beforeAll } from "vitest";
import { readRepo, readCss, stripComments, declarations } from "../fakes/css.js";
import { ImprovementBuilderDialog, improvementCardSaver, improvementEditSaver } from "../../module/dialogs/ImprovementBuilderDialog.js";
import { MAX_REQUIREMENT_REPEAT } from "../../module/utils/improvement-def.js";
import { IMPROVEMENT_CATEGORIES, IMPROVEMENT_DEFINITIONS } from "../../module/actors/steading/StonetopSteading.js";

// The window that authors a steading improvement. The complaint it answers: the form that
// came before could not produce one of the book's own improvements. It offered a name, a
// category, a flavor line, one flat list of requirements and a paragraph of effect prose,
// so there was no way to write "requires 2 of the following", no way to write "either
// this, or all of these", and no way to say that completing it raises Fortunes.
//
// Then the complaint came back, about a form that could hold all of that but still could
// not comfortably WRITE one: a requirement was a line of a textarea, so a step taken five
// times meant typing it five times with the ordinals by hand; there was no way to mark the
// italics the playbook puts on every move name; nothing could be copied from the seventeen
// that already exist; and none of it could be seen until it had been saved.
//
// The template is asserted on rather than described, because the controls ARE the feature:
// a panel that lost its Fortunes box would still pass a test that only read the JS.

const CSS = readCss();
let markup;

beforeAll(async () => {
	// Foundry's `eq`, which the panels use to pick the one that renders unhidden.
	Handlebars.registerHelper("eq", (a, b) => a === b);
	const dialog = Object.create(ImprovementBuilderDialog.prototype);
	// The real card saver, so the "Start from" list under test is the one that ships
	// rather than a stand-in that could offer anything.
	dialog._saver = improvementCardSaver();
	dialog._activeTab = "improvement";
	markup = await renderTemplate("systems/stonetop-pwd/templates/dialogs/improvement-builder.hbs", dialog.getData());
});

describe("the improvement builder's panels", () => {
	it("splits authoring into the improvement, its requirements, its effect and a preview", () => {
		for (const tab of ["improvement", "requirements", "effect", "preview"]) {
			expect(markup).toContain(`data-tab="${tab}"`);
		}
		// Only the active panel is unhidden; the rest keep what is typed in them while
		// hidden, which is why the rail switches client-side rather than re-rendering.
		expect(markup.match(/class="stonetop-improvement-builder-section" data-tab="\w+" hidden/g)).toHaveLength(3);
	});

	it("offers every category chip the Improvements tab filters by, plus none", () => {
		expect(markup).toContain(`<option value="">None (always shown)</option>`);
		for (const category of IMPROVEMENT_CATEGORIES) {
			// Handlebars escapes the ampersand in "Hearth & Harvest" on the way out.
			const label = category.label.replace(/&/g, "&amp;");
			expect(markup).toContain(`<option value="${category.key}">${label}</option>`);
		}
	});
});

describe("requirement groups", () => {
	it("ships an empty group to clone, since groups are added after the render", () => {
		expect(markup).toContain("stonetop-improvement-builder-group-tpl");
		expect(markup).toContain("stonetop-improvement-builder-add-group");
	});

	it("lets a group ask for all of its items or only some of them", () => {
		expect(markup).toContain(`<option value="all">all of them</option>`);
		expect(markup).toContain(`<option value="min">at least</option>`);
		expect(markup).toContain("stonetop-improvement-builder-group-min");
	});

	it("lets a group be an alternative to the one above it, which is what an either/or is", () => {
		expect(markup).toContain("stonetop-improvement-builder-group-alt");
		expect(markup).toMatch(/Alternative to the group above/);
	});

	it("can be moved above or below its neighbours, since a removed group loses everything in it", () => {
		expect(markup).toContain("stonetop-improvement-builder-group-up");
		expect(markup).toContain("stonetop-improvement-builder-group-down");
	});
});

describe("requirement rows", () => {
	// The textarea this replaced could hold the same requirements, but every edit to one of
	// them was an edit to a line of prose: no way to move a step, and no way to say "five
	// times" except by typing it five times with the ordinals spelled out by hand.
	it("gives each requirement its own row, with controls to move and drop it", () => {
		expect(markup).toContain("stonetop-improvement-builder-row-tpl");
		expect(markup).toContain("stonetop-improvement-builder-req-text");
		expect(markup).toContain("stonetop-improvement-builder-add-row");
		for (const control of ["req-up", "req-down", "req-remove"]) {
			expect(markup).toContain(`stonetop-improvement-builder-${control}`);
		}
	});

	// Additional Housing, Raincatching, Stone Wall, Township and Weapons of War all repeat
	// one step several times; between them that is 25 of the book's checkboxes.
	it("repeats one requirement into several numbered boxes", () => {
		expect(markup).toContain("stonetop-improvement-builder-req-count");
		expect(markup).toMatch(/numbered \(1st\), \(2nd\)/);
		// The control's ceiling is the one itemsFromRows clamps to, not a second literal.
		expect(markup).toContain(`max="${MAX_REQUIREMENT_REPEAT}"`);
	});

	// A placeholder is not an accessible name, and it disappears as soon as anything is
	// typed. This window is used at a ~20px root by a screen-magnifier user.
	it("gives every requirement control a real label", () => {
		expect(markup).toContain(`aria-label="Requirement"`);
		expect(markup).toContain(`aria-label="How many boxes this requirement makes"`);
		for (const control of ["Move requirement up", "Move requirement down", "Remove requirement"]) {
			expect(markup).toContain(`aria-label="${control}"`);
		}
	});

	it("says how to write the italics the playbook puts on every move name", () => {
		expect(markup.match(/Wrap a move name in \*asterisks\* for italics/g)).toHaveLength(2);
	});

	// The heading field's placeholder shows the heading that would be WRITTEN for a group
	// left blank, and defaultSectionHeading decides that from how many boxes the group makes
	// ("2 of the following" vs "all of them"). Counting ROWS there, which is the natural
	// thing to write, had the placeholder promising "And then:" for a group whose saved
	// heading came out "And 2 of the following:", since one repeated row is several boxes.
	it("measures the written-for-you heading against boxes, not rows", () => {
		const source = stripComments(readRepo("module/dialogs/ImprovementBuilderDialog.js"));
		const call = source.match(/defaultSectionHeading\(\{[\s\S]*?\}\)/)[0];
		expect(call).toContain("itemsFromRows(this._readRows(group)).length");
	});
});

describe("starting from an improvement that already exists", () => {
	it("offers all seventeen of the book's, under a blank first entry", () => {
		expect(markup).toContain("stonetop-improvement-builder-source");
		expect(markup).toContain(`<option value="">A blank improvement</option>`);
		for (const def of IMPROVEMENT_DEFINITIONS) {
			expect(markup).toContain(`<option value="builtin:${def.slug}">${def.label}</option>`);
		}
	});

	it("warns that it replaces the form rather than adding to it", () => {
		expect(markup).toMatch(/It replaces what is in the form\./);
	});
});

describe("the preview panel", () => {
	it("holds a target for the card and says its boxes do nothing", () => {
		expect(markup).toContain("stonetop-improvement-builder-preview");
		expect(markup).toMatch(/The boxes here are inert\./);
	});
});

describe("the effect panel", () => {
	it("offers the four stats the steading's grant engine can move", () => {
		for (const stat of ["fortunes", "defenses", "prosperity", "population"]) {
			expect(markup).toContain(`name="grant-${stat}"`);
		}
	});

	it("offers the list and size changes the engine can apply and reverse", () => {
		expect(markup).toContain(`name="grant-resources"`);
		expect(markup).toContain(`name="grant-fortifications"`);
		expect(markup).toContain(`name="grant-remove-fortifications"`);
		expect(markup).toContain(`name="grant-set-population"`);
		for (const size of ["hamlet", "village", "town", "city"]) {
			expect(markup).toContain(`<option value="${size}">${size}</option>`);
		}
	});

	it("says the stat boxes are a change rather than a total, which is the easy mistake", () => {
		expect(markup).toMatch(/A change, not a total/);
	});
});

describe("both ways in reach the same window", () => {
	const dialogSource = stripComments(readRepo("module/dialogs/ImprovementBuilderDialog.js"));
	const cardEntry = stripComments(readRepo("module/dialogs/create-improvement-dialog.js"));
	const sheet = stripComments(readRepo("module/actors/steading/StonetopSteadingSheet.js"));

	it("writes to a journal card or to the open steading, and differs in nothing else", () => {
		expect(dialogSource).toContain("export function improvementCardSaver");
		expect(dialogSource).toContain("export function steadingImprovementSaver");
		expect(cardEntry).toContain("improvementCardSaver()");
		expect(sheet).toContain("steadingImprovementSaver(");
	});

	// Both entry points used to hand-roll a `new Dialog({content: "<form>…"})`, and the two
	// forms had already drifted (only one of them offered the requirement list at all).
	it("leaves no hand-rolled improvement form behind", () => {
		expect(cardEntry).not.toContain("new Dialog(");
		expect(sheet).not.toContain("Create Improvement");
		expect(sheet).not.toContain("improvementCategoryFieldHtml");
	});

	// Editing one already on the steading is the third target, and the same window: it opens
	// filled in (`editing`) and saves back over the improvement instead of minting one.
	it("edits an improvement already on the steading through the same window", () => {
		expect(dialogSource).toContain("export function improvementEditSaver");
		expect(dialogSource).toContain("updateCustomImprovement(slug, next)");
		expect(sheet).toContain("improvementEditSaver(");
		// The window opens on the improvement rather than blank.
		expect(dialogSource).toContain("if (this._saver.editing) this._fillFrom(root, this._saver.editing);");
	});
});

describe("the edit target", () => {
	const steading = {
		improvementDef: () => ({
			slug: "custom-roadbuilding", label: "Roadbuilding", category: "renown",
			flavor: "", effect: "", sections: [], grants: null,
		}),
		improvementNameTaken: () => false,
		customImprovements: [],
	};

	it("names the improvement in the window title and opens filled in", () => {
		const saver = improvementEditSaver(steading, "custom-roadbuilding");
		expect(saver.title).toBe("Edit Roadbuilding");
		expect(saver.submitLabel).toBe("Save changes");
		expect(saver.editing).toMatchObject({ name: "Roadbuilding", slug: "custom-roadbuilding" });

		const dialog = Object.create(ImprovementBuilderDialog.prototype);
		dialog._saver = saver;
		expect(dialog.title).toBe("Edit Roadbuilding");
	});

	// Its own name is not a clash with itself, or saving an edit that touched nothing else
	// would be refused as a duplicate of the very improvement being edited.
	it("excludes the improvement being edited from the name check", () => {
		const seen = [];
		const target = {
			...steading,
			improvementNameTaken: (name, opts) => { seen.push([name, opts]); return false; },
		};
		improvementEditSaver(target, "custom-roadbuilding").nameTaken("Roadbuilding");
		expect(seen).toEqual([["Roadbuilding", { except: "custom-roadbuilding" }]]);
	});

	it("has nothing to edit when the improvement is gone", () => {
		expect(improvementEditSaver({ improvementDef: () => null }, "custom-nope").editing).toBeNull();
	});
});

describe("the window's chrome", () => {
	it("scrolls the panel column rather than the window", () => {
		expect(declarations(CSS, ".stonetop-improvement-builder .window-content")).toContain("overflow: hidden");
		expect(ImprovementBuilderDialog.defaultOptions.scrollY)
			.toEqual([".stonetop-improvement-builder-main"]);
	});

	it("hides the at-least box and the either/or tick until they apply", () => {
		expect(declarations(CSS, ".is-hidden.stonetop-improvement-builder-group-min-wrap")).toContain("display: none");
		expect(declarations(CSS, ".is-hidden.stonetop-improvement-builder-group-alt")).toContain("display: none");
	});
});
