import Handlebars from "handlebars";
import { describe, it, expect, beforeAll } from "vitest";
import { readRepo, readCss, stripComments, declarations } from "../fakes/css.js";
import { ImprovementBuilderDialog } from "../../module/dialogs/ImprovementBuilderDialog.js";
import { IMPROVEMENT_CATEGORIES } from "../../module/actors/steading/StonetopSteading.js";

// The window that authors a steading improvement. The complaint it answers: the form that
// came before could not produce one of the book's own improvements. It offered a name, a
// category, a flavor line, one flat list of requirements and a paragraph of effect prose,
// so there was no way to write "requires 2 of the following", no way to write "either
// this, or all of these", and no way to say that completing it raises Fortunes.
//
// The template is asserted on rather than described, because the controls ARE the feature:
// a panel that lost its Fortunes box would still pass a test that only read the JS.

const CSS = readCss();
let markup;

beforeAll(async () => {
	// Foundry's `eq`, which the panels use to pick the one that renders unhidden.
	Handlebars.registerHelper("eq", (a, b) => a === b);
	const dialog = Object.create(ImprovementBuilderDialog.prototype);
	dialog._saver = { submitLabel: "Create card", hint: "Author a reusable improvement card." };
	dialog._activeTab = "improvement";
	markup = await renderTemplate("systems/stonetop-pwd/templates/dialogs/improvement-builder.hbs", dialog.getData());
});

describe("the improvement builder's panels", () => {
	it("splits authoring into the improvement, its requirements and its effect", () => {
		for (const tab of ["improvement", "requirements", "effect"]) {
			expect(markup).toContain(`data-tab="${tab}"`);
		}
		// Only the active panel is unhidden; the rest keep what is typed in them while
		// hidden, which is why the rail switches client-side rather than re-rendering.
		expect(markup.match(/class="stonetop-improvement-builder-section" data-tab="\w+" hidden/g)).toHaveLength(2);
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

	it("takes one requirement per line, each of which becomes a check-off box", () => {
		expect(markup).toContain("stonetop-improvement-builder-group-items");
		expect(markup).toMatch(/One per line\. Each becomes a check-off box\./);
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
