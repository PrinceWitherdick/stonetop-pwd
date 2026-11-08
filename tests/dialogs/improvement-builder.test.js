import Handlebars from "handlebars";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readRepo, readCss, stripComments, declarations } from "../fakes/css.js";
import { stubAsk, stubConfirm } from "../fakes/confirm.js";
import { mayClose } from "../../module/utils/close-guard.js";
import {
	ImprovementBuilderDialog,
	SECTIONS,
	editSavedNotice,
	improvementCardSaver,
	improvementEditSaver,
	journalImprovementSources,
	steadingImprovementSaver,
} from "../../module/dialogs/ImprovementBuilderDialog.js";
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

	// ⚠ AND AGAINST THE POSITION THE GROUP WILL HAVE, not the one it has. The save drops a group
	// with neither a heading nor a box (improvement-def.js#sectionsFromGroups), and the builder
	// OPENS with an empty group — so filling in the second one and leaving the first alone is the
	// ordinary way to use this window. Off the DOM index the field promised "And then:" for an
	// improvement that saved as "Requires all of the following:".
	it("numbers the written-for-you heading by the groups that will be kept", () => {
		const source = stripComments(readRepo("module/dialogs/ImprovementBuilderDialog.js"));
		const call = source.match(/defaultSectionHeading\(\{[\s\S]*?\}\)/)[0];
		expect(call).not.toContain("indexOf(group)");
		expect(call).toContain("index,");
		// An alternative needs a kept group above it to be an alternative to, which is the same
		// count and the same reason.
		expect(call).toContain("index > 0");
		// And the rule itself is `sectionsFromGroups`': boxes, or a heading somebody typed.
		const kept = source.slice(source.indexOf("_groupIsWritten(group) {"));
		expect(kept.slice(0, 300)).toContain("itemsFromRows(this._readRows(group)).length > 0");
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

// ── The audit pass (2026-10-03) ──────────────────────────────────────────────
// vitest runs under `node`, so these drive the dialog's methods against small stand-ins for
// the elements they touch. The DOM wiring itself (focus after a move or remove, the per-row
// labels, the placeholder colour) is driven in a real browser by
// z:/tmp/foundry-verify/improvement-builder-verify.mjs.

/** A stand-in element: only the members the code under test reaches for. */
function fakeEl(props = {}) {
	const attrs = {};
	return {
		disabled: false, value: "", hidden: true, textContent: "", id: "",
		setAttribute(k, v) { attrs[k] = String(v); },
		getAttribute: k => attrs[k] ?? null,
		removeAttribute(k) { delete attrs[k]; },
		focus: vi.fn(),
		attrs,
		...props,
	};
}

/** A root whose querySelector answers from a selector map. */
function fakeRoot(map = {}) {
	return { querySelector: sel => map[sel] ?? null, querySelectorAll: () => [] };
}

function dialogWith(saver) {
	const dialog = Object.create(ImprovementBuilderDialog.prototype);
	dialog._saver = saver;
	dialog._activeTab = "improvement";
	dialog._saving = false;
	return dialog;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("saving", () => {
	function saveRig(create, { name = "Roadbuilding", nameTaken } = {}) {
		const button = fakeEl();
		const field = fakeEl({ value: name });
		const error = fakeEl({ id: "err" });
		const root = fakeRoot({
			".stonetop-improvement-builder-save": button,
			"[name=name]": field,
			".stonetop-improvement-builder-name-error": error,
		});
		const dialog = dialogWith({ create, nameTaken });
		dialog._readDef = () => ({ name: name.trim() });
		dialog._selectTab = vi.fn();
		dialog.close = vi.fn();
		return { dialog, root, button, field, error };
	}

	// A double click on "Create card" wrote two homebrew pages, and on first use could make two
	// homebrew journals, because nothing stopped the second press while the first was writing.
	it("ignores a second press while the first is still writing, and greys the button", async () => {
		let finish;
		const create = vi.fn(() => new Promise(done => { finish = done; }));
		const { dialog, root, button } = saveRig(create);
		const first = dialog._save(root);
		const second = dialog._save(root);
		expect(create).toHaveBeenCalledTimes(1);
		expect(button.disabled).toBe(true);
		finish({ ok: true });
		await Promise.all([first, second]);
		expect(create).toHaveBeenCalledTimes(1);
		// A successful save is not a discard, so the close does not ask.
		expect(dialog.close).toHaveBeenCalledWith({ discard: true });
	});

	it("gives Save back when the write is refused, so the author can fix it and try again", async () => {
		const { dialog, root, button } = saveRig(vi.fn(async () => ({ ok: false, reason: "duplicate" })));
		await dialog._save(root);
		expect(button.disabled).toBe(false);
		expect(dialog._saving).toBe(false);
		expect(dialog.close).not.toHaveBeenCalled();
	});

	it("gives Save back when the write throws, and says so", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const said = vi.spyOn(ui.notifications, "error");
		const { dialog, root, button } = saveRig(vi.fn(async () => { throw new Error("no permission"); }));
		await dialog._save(root);
		expect(button.disabled).toBe(false);
		expect(dialog._saving).toBe(false);
		expect(said).toHaveBeenCalled();
		expect(logged).toHaveBeenCalled();
	});

	// A taken name used to get as far as the write, be refused there, and be reported only in a
	// notice that fades, with the window left on whatever panel Save was pressed from.
	it("stops a taken name at the window, on the name's own panel, with the reason beside the field", async () => {
		const create = vi.fn();
		const { dialog, root, field, error } = saveRig(create, { name: "Palisade", nameTaken: n => n === "Palisade" });
		await dialog._save(root);
		expect(create).not.toHaveBeenCalled();
		expect(dialog._selectTab).toHaveBeenCalledWith(root, "improvement");
		expect(field.focus).toHaveBeenCalled();
		expect(field.getAttribute("aria-invalid")).toBe("true");
		expect(field.getAttribute("aria-describedby")).toBe("err");
		expect(error.hidden).toBe(false);
		expect(error.textContent).toMatch(/already has an improvement called Palisade/);
	});

	it("says an empty name the same way", async () => {
		const create = vi.fn();
		const { dialog, root, field, error } = saveRig(create, { name: "  " });
		await dialog._save(root);
		expect(create).not.toHaveBeenCalled();
		expect(field.getAttribute("aria-invalid")).toBe("true");
		expect(error.textContent).toBe("Enter a name for the improvement.");
	});

	it("checks for a clash when the name field is left, but not for an empty one", () => {
		const taken = saveRig(vi.fn(), { name: "Palisade", nameTaken: () => true });
		taken.dialog._checkName(taken.root, { onlyTaken: true });
		expect(taken.field.getAttribute("aria-invalid")).toBe("true");

		const empty = saveRig(vi.fn(), { name: "" });
		empty.dialog._checkName(empty.root, { onlyTaken: true });
		expect(empty.field.getAttribute("aria-invalid")).toBeNull();
		expect(empty.error.hidden).toBe(true);
	});

	// The journal-card target declares no `nameTaken`: a reusable card keeps the book's name.
	it("lets the journal-card target keep any name", () => {
		expect(dialogWith(improvementCardSaver())._nameProblem("Palisade")).toBeNull();
	});
});

describe("work is not thrown away unasked", () => {
	// The window keeps no close() of its own: StonetopDialog's close-guard (utils/close-guard.js)
	// asks, reading the form through _workState and its wording from _discardCopy.
	it("leaves closing to the shared close-guard", () => {
		expect(Object.hasOwn(ImprovementBuilderDialog.prototype, "close")).toBe(false);
	});

	/** A builder opened on `before`, now holding `after`. */
	function written(saver, before = "{}", after = '{"name":"Mill"}') {
		const dialog = dialogWith(saver);
		dialog._pristineWork = before;
		dialog._workState = () => after;
		return dialog;
	}

	it("asks before closing over unsaved work, and stays open when the question is closed", async () => {
		const asked = stubAsk(null);
		expect(await mayClose(written(improvementCardSaver()))).toBe(false);
		const config = asked.mock.calls[0][0];
		expect(config.window.title).toBe("Discard this improvement?");
		expect(config.content).toContain("This improvement has not been saved.");
		// Discard alone: the question's own X keeps editing, and Enter presses nothing.
		expect(config.buttons.map(b => b.label)).toEqual(["Discard what I wrote"]);
		expect(config.buttons.some(b => b.default)).toBe(false);
	});

	it("closes on Discard", async () => {
		stubAsk("discard");
		expect(await mayClose(written(improvementCardSaver()))).toBe(true);
	});

	it("closes without asking when nothing was typed, or when the work was just saved", async () => {
		const asked = stubAsk(null);
		expect(await mayClose(written(improvementCardSaver(), "{}", "{}"))).toBe(true);
		expect(await mayClose(written(improvementCardSaver()), { discard: true })).toBe(true);
		expect(asked).not.toHaveBeenCalled();
	});

	it("names the edit's own loss when an edit is closed", async () => {
		const asked = stubAsk(null);
		await mayClose(written({ editing: { name: "Roadbuilding" } }));
		expect(asked.mock.calls[0][0].window.title).toBe("Discard your changes?");
	});

	it("reads no work before the form is drawn", () => {
		expect(dialogWith(improvementCardSaver())._workState()).toBeNull();
	});

	it("asks before Start from replaces a form with work in it", async () => {
		const asked = stubConfirm(false);
		const dialog = dialogWith(improvementCardSaver());
		dialog._sources = new Map([["builtin:palisade", { name: "Palisade" }]]);
		dialog._pristineWork = "{}";
		dialog._workState = () => '{"name":"Mill"}';
		dialog._fillFrom = vi.fn();
		const select = { value: "builtin:palisade" };
		await dialog._onPickSource(fakeRoot(), select);
		expect(asked).toHaveBeenCalledTimes(1);
		expect(asked.mock.calls[0][0].buttons[0].label).toBe("Replace it with Palisade");
		expect(dialog._fillFrom).not.toHaveBeenCalled();
		// Put back to its blank entry either way, so the same one can be picked again.
		expect(select.value).toBe("");
	});

	it("asks before removing a group that holds requirements, and not before an empty one", async () => {
		const dialog = dialogWith(improvementCardSaver());
		dialog._renumberGroups = vi.fn();
		dialog._groupNumber = () => 2;
		dialog._readRows = () => [{ text: "A", repeat: "1" }, { text: "B", repeat: "2" }];
		const group = () => ({ remove: vi.fn(), nextElementSibling: null, previousElementSibling: null });

		let asked = stubConfirm(false);
		dialog._groupIsWritten = () => true;
		const kept = group();
		await dialog._removeGroup(fakeRoot(), kept);
		expect(kept.remove).not.toHaveBeenCalled();
		expect(asked.mock.calls[0][0].content).toContain("3 requirements");
		expect(asked.mock.calls[0][0].buttons.map(b => b.label)).toEqual(["Remove group 2", "Keep it"]);

		asked = stubConfirm(false);
		dialog._groupIsWritten = () => false;
		const blank = group();
		await dialog._removeGroup(fakeRoot(), blank);
		expect(asked).not.toHaveBeenCalled();
		expect(blank.remove).toHaveBeenCalled();
	});
});

describe("saving an edit", () => {
	// The re-tick instruction rode in a notice that faded on a timer, taking the instruction with it.
	it("keeps a notice that asks for something on screen until it is dismissed", () => {
		const [message, options] = editSavedNotice({ label: "Palisade", grantsChanged: true, completed: true });
		expect(options).toEqual({ permanent: true });
		expect(message).toMatch(/un-tick it complete and tick it again/);
		expect(message).not.toMatch(/\u2014/);
	});

	it("lets a plain notice fade as usual", () => {
		expect(editSavedNotice({ label: "Palisade" })).toEqual(["Saved Palisade.", {}]);
		expect(editSavedNotice({ label: "Palisade", structureChanged: true })[1]).toEqual({});
		// Changed grants on an improvement that was never completed have applied nothing yet.
		expect(editSavedNotice({ label: "Palisade", grantsChanged: true, completed: false })[1]).toEqual({});
	});
});

describe("starting from a card in the journals", () => {
	// Node has no DOM, so the cards are found in the HTML by their attribute, decoded once the way
	// the browser's parser decodes it.
	const decode = s => s.replace(/&quot;/g, "\"").replace(/&#x27;|&#39;/g, "'")
		.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
	const parse = html => [...html.matchAll(/data-steading-improvement="([^"]*)"/g)]
		.map(m => ({ dataset: { steadingImprovement: decode(m[1]) } }));
	const payload = def => `<div class="stonetop-journal-improvement" data-steading-improvement="${
		JSON.stringify(def).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></div>`;
	let pageSerial = 0;
	const page = (html, extra = {}) => ({ uuid: `JournalEntry.x.JournalEntryPage.p${++pageSerial}`, _source: { text: { content: html } }, ...extra });

	// The seven Book II cards are baked into Location and Lore pages, in `system.sections[].body`
	// rather than `text.content`. A world seeded from the pack holds these same pages.
	it("finds the Book II cards wherever a page type keeps its prose", () => {
		const files = [
			"stonetop-locations/byways/the-makers-roads.json",
			"stonetop-locations/regions/the-foothills.json",
			"stonetop-locations/regions/the-great-wood.json",
			"stonetop-locations/settlements/barrier-pass.json",
			"stonetop-locations/settlements/the-golden-oak.json",
			"stonetop-lore/factions/green-lords.json",
			"stonetop-lore/factions/tempest-lords.json",
		].map(f => JSON.parse(readRepo(`packs/src/${f}`)));
		const journals = files.map(entry => ({ id: entry._id, pages: entry.pages.map(p => ({ uuid: p._id, _source: p })) }));
		const group = journalImprovementSources(journals, { parse, user: null });
		expect(group.label).toBe("Cards in the journals");
		expect(group.options).toHaveLength(7);
		for (const option of group.options) {
			expect(option.def.name).toBeTruthy();
			expect(option.def.sections.flatMap(s => s.items).length).toBeGreaterThan(0);
		}
	});

	it("reads a card through the drop path's normalizers", () => {
		const html = payload({
			name: "Roadbuilding", category: "not-a-category", flavor: "Dust.",
			sections: [{ heading: "Requires:", items: ["A surveyor", ""] }],
			grants: { stats: { prosperity: 1 } },
		});
		const [option] = journalImprovementSources([{ pages: [page(html)] }], { parse, user: null }).options;
		expect(option.def.category).toBe("");
		expect(option.def.sections[0].items).toEqual(["A surveyor"]);
		expect(option.def.grants?.stats?.prosperity).toBe(1);
		expect(option.value).toMatch(/^journal:/);
	});

	it("offers a card once however many pages carry it, and none the viewer cannot read", () => {
		const html = payload({ name: "Roadbuilding", sections: [{ items: ["A"] }] });
		const hidden = payload({ name: "Secret Works", sections: [{ items: ["B"] }] });
		const journals = [
			{ pages: [page(html), page(html)] },
			{ pages: [page(hidden, { testUserPermission: () => false })] },
		];
		const group = journalImprovementSources(journals, { parse, user: { id: "player" } });
		expect(group.options.map(o => o.label)).toEqual(["Roadbuilding"]);
	});

	it("is left out of the picker when the world has none", () => {
		expect(journalImprovementSources([], { parse, user: null })).toBeNull();
		expect(journalImprovementSources(undefined, { parse, user: null })).toBeNull();
	});

	it("is offered on the steading target, after the book's and the steading's own", () => {
		const source = stripComments(readRepo("module/dialogs/ImprovementBuilderDialog.js"));
		const steadingSaver = source.slice(source.indexOf("export function steadingImprovementSaver"));
		expect(steadingSaver.slice(0, 1600)).toContain("worldJournalCardSources()");
		// Read once per window, and cached across windows until a journal changes: the scan
		// walks every readable journal page.
		expect(source).toContain("this._sourceGroups = saver.sources?.() ?? [];");
		const groups = steadingImprovementSaver({ customImprovements: [] }).sources();
		expect(groups[0].label).toBe("From the playbook");
	});
});

describe("the audit's markup fixes", () => {
	it("hides the rail's and the banner's icons from screen readers", () => {
		expect(markup).toMatch(/stonetop-guide-toc-icon" aria-hidden="true"/);
		expect(markup).toMatch(/stonetop-improvement-builder-banner-icon" aria-hidden="true"/);
	});

	// The same saver hint sat under every panel's title.
	it("gives each panel its own banner subtitle", () => {
		const hints = SECTIONS.slice(1).map(s => s.hint);
		expect(new Set(hints).size).toBe(hints.length);
		expect(hints.every(Boolean)).toBe(true);
		expect(markup).toContain(`stonetop-improvement-builder-banner-sub">${improvementCardSaver().hint.replace(/'/g, "&#x27;")}`);
	});

	// A grant box showing "0" read as a 0 somebody had typed.
	it("hints the grant boxes as no change rather than as zero", () => {
		expect(markup).toContain(`name="grant-fortunes" step="1" placeholder="no change"`);
		expect(markup).not.toMatch(/name="grant-\w+" step="1" placeholder="0"/);
	});

	it("labels each group's heading field for real, and groups its rows", () => {
		expect(markup).toContain(`class="stonetop-improvement-builder-group-heading-label"`);
		expect(markup).toContain(`class="stonetop-improvement-builder-group" role="group"`);
		expect(markup).toContain(`class="stonetop-improvement-builder-rows" role="group"`);
	});

	it("has somewhere beside the name to say what is wrong with it, and somewhere on Preview for notes", () => {
		expect(markup).toMatch(/stonetop-improvement-builder-name-error" aria-live="polite" hidden/);
		expect(markup).toMatch(/stonetop-improvement-builder-preview-notes" aria-live="polite" hidden/);
	});

	// Moving the row that holds the pressed button out and back in drops the keyboard to <body>.
	it("moves the neighbour rather than the row holding the focused button", () => {
		const source = stripComments(readRepo("module/dialogs/ImprovementBuilderDialog.js"));
		const swap = source.slice(source.indexOf("function swapSibling"), source.indexOf("function keepMoveFocus"));
		expect(swap).toContain("el.after(sibling)");
		expect(swap).toContain("el.before(sibling)");
		expect(swap).not.toContain("sibling.before(el)");
	});

	it("paints placeholders muted and italic, and rings the focused control", () => {
		const placeholder = declarations(CSS, ".stonetop-improvement-builder .stonetop-improvement-builder-form :is(input, textarea)::placeholder");
		expect(placeholder).toContain("var(--st-text-muted");
		expect(placeholder).toContain("font-style: italic");
		const ring = declarations(CSS, ".stonetop-improvement-builder :is(button, select, input, textarea):focus-visible");
		expect(ring).toMatch(/outline: 2px solid var\(--st-on-dark-ink,/);
	});

	it("draws the row's box as a picture of one, not a control", () => {
		const box = declarations(CSS, ".stonetop-improvement-builder-req-box");
		expect(box).toContain("dashed");
		expect(box).toContain("pointer-events: none");
		expect(markup).toContain(`class="stonetop-improvement-builder-req-box" aria-hidden="true"`);
	});
});

describe("the improvement builder's ids", () => {
	// Two builders open at once (one per steading, or a card and an improvement) must not share an
	// id, or a label in the second focuses a field in the first and a screen reader reads the wrong
	// description. The prefix is in the template, so a new id or reference can't miss it.
	it("prefixes every id, label and description with the window's own uid", () => {
		const uid = markup.match(/id="(stonetop-ib-\d+)-/)?.[1];
		expect(uid).toBeTruthy();
		const refs = [...markup.matchAll(/\s(?:id|for|aria-describedby)="([^"]*)"/g)].map(m => m[1]);
		expect(refs.length).toBeGreaterThan(40);
		for (const ref of refs) expect(ref.startsWith(`${uid}-`), ref).toBe(true);
	});

	it("gives a second window ids of its own", async () => {
		const other = Object.create(ImprovementBuilderDialog.prototype);
		other._saver = improvementCardSaver();
		other._activeTab = "improvement";
		const second = await renderTemplate("systems/stonetop-pwd/templates/dialogs/improvement-builder.hbs", other.getData());
		const first = markup.match(/id="(stonetop-ib-\d+)-/)?.[1];
		expect(second).not.toContain(`id="${first}-`);
	});
});
