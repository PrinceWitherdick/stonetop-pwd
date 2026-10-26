import { describe, it, expect } from "vitest";
import { readRepo as read } from "../../fakes/css.js";

// The settlement sheet is AppV1, which has no `data-action` dispatch of its own: one delegated
// listener looks each button's action up in the sheet's ACTIONS table, which names the method. A button whose action is
// missing from that table renders fine and does nothing when pressed, so every action the sheet's
// templates name has to be in the table, and every entry has to reach a method that exists.

const SHEET = read("module/actors/settlement/StonetopSettlementSheet.js");
const TEMPLATES = [
	"templates/actor/settlement.hbs",
	"templates/actor/settlement/settlement-header.hbs",
	"templates/actor/settlement/settlement-overview.hbs",
	"templates/actor/settlement/settlement-people.hbs",
	"templates/actor/settlement/settlement-moves.hbs",
	"templates/actor/settlement/settlement-list.hbs",
	"templates/actor/settlement/settlement-notes.hbs",
];

const table = SHEET.match(/const ACTIONS = \{([\s\S]*?)\n\};/)?.[1] ?? "";
const entries = new Map([...table.matchAll(/^\s*(\w+):\s*"(\w+)"/gm)].map(m => [m[1], m[2]]));
const named = new Set(TEMPLATES.flatMap(file => [...read(file).matchAll(/data-action="(\w+)"/g)].map(m => m[1])));

describe("the settlement sheet's buttons", () => {
	it("finds the actions table and the templates' actions", () => {
		expect(entries.size).toBeGreaterThan(0);
		expect(named.size).toBeGreaterThan(0);
	});

	it("has a handler for every action its templates name", () => {
		expect([...named].filter(action => !entries.has(action))).toEqual([]);
	});

	it("points every handler at a method the sheet defines", () => {
		const missing = [...entries.values()].filter(method => !new RegExp(`^\\t\\t(async )?${method}\\(`, "m").test(SHEET));
		expect(missing).toEqual([]);
	});
});

// The window header's wrench (utils/sheet-chrome.js), as on every other Stonetop actor sheet: off,
// an owner reads the sheet; on, it opens up. What changes in play (the notes) follows
// whether the user may write at all, not the wrench, as on Stonetop's own sheet.
describe("the settlement sheet's edit toggle", () => {
	const overview = read("templates/actor/settlement/settlement-overview.hbs");

	it("draws the header toggle and keys the edit view on it", () => {
		expect(SHEET).toMatch(/injectHeaderToggle\(this, "settlement"\)/);
		expect(SHEET).toMatch(/const editable = canWrite && this\._editMode;/);
	});

	// Stonetop's banner has no picture, and neither does this one (the user's call, 2026-10-14).
	it("draws no portrait in the banner", () => {
		expect(read("templates/actor/settlement/settlement-header.hbs")).not.toMatch(/<img|data-edit="img"/);
	});

	// Fortunes, Surplus and the debilities are Stonetop's alone (the user's call, 2026-10-14).
	it("draws no Fortunes, Surplus, debilities or home switch", () => {
		expect(overview).not.toMatch(/system\.home|steading-debilit|steading-surplus|fortunes/);
	});

	it("keeps the notes live without the wrench", () => {
		expect(read("templates/actor/settlement/settlement-notes.hbs")).toMatch(/\{\{#if canWrite\}\}\s*<prose-mirror/);
	});
});

// Core pins a <prose-mirror>'s content box absolutely to fill its host, so the host takes its height
// from the tab around it. Stonetop's own notes rule (which this editor also wears) is `flex: 1;
// min-height: 0`, so on a tab that is not a flex column the editor came out 0px tall: no box, and
// nothing to hover for core's edit pencil.
describe("the settlement Notes tab", () => {
	const CSS = read("styles/stonetop.css");

	// Stonetop's own Notes rules name this sheet too, rather than being restated for it.
	it("is a flex column while active, so the editor has a height to fill", () => {
		const rule = sel => {
			const at = CSS.indexOf(`${sel} {`);
			expect(at, sel).toBeGreaterThan(-1);
			return CSS.slice(at, CSS.indexOf("}", at));
		};
		const tab = rule(":is(.steading-sheet, .stonetop-settlement-sheet) .tab.notes.active");
		expect(tab).toMatch(/display: flex;/);
		expect(tab).toMatch(/flex-direction: column;/);
		expect(tab).toMatch(/min-height: 0;/);
		const panel = rule(":is(.steading-sheet, .stonetop-settlement-sheet) .tab.notes .sheet-tab");
		expect(panel).toMatch(/flex: 1;/);
		expect(panel).toMatch(/min-height: 0;/);
	});

	it("floors the editor at the same weight as Stonetop's rule, and after it", () => {
		const ours = CSS.indexOf(".stonetop-settlement-notes prose-mirror.steading-notes-editor {");
		expect(ours).toBeGreaterThan(CSS.indexOf(".steading-notes prose-mirror.steading-notes-editor {"));
		// Stonetop's own floor (`.steading-sheet .steading-notes prose-mirror.steading-notes-editor`).
		expect(CSS.slice(ours, CSS.indexOf("}", ours))).toMatch(/min-height: 14em/);
	});

	// Stonetop's notes always sit in the bordered editor box; a settlement reader gets the same box.
	it("gives a reader the editor's box", () => {
		expect(read("templates/actor/settlement/settlement-notes.hbs"))
			.toMatch(/class="steading-notes-editor stonetop-settlement-notes-read"><div class="editor-content">/);
	});
});

// The People tab is Stonetop's Residents table, one table labelled "Residents" (the user's call,
// 2026-10-19); who runs the place, its notable people and its groups moved to the Overview.
describe("the settlement People tab", () => {
	const people = read("templates/actor/settlement/settlement-people.hbs");
	const overview = read("templates/actor/settlement/settlement-overview.hbs");

	it("draws Stonetop's Residents table, and only that", () => {
		expect(people).toMatch(/steading-residents-section--residents/);
		expect(people).toMatch(/class="steading-residents-table steading-people-cards"/);
		expect(people).not.toMatch(/steading-players-section|steading-residents-section--neighbors/);
		expect(people).toMatch(/localize "stonetop\.settlement\.residents"/);
	});

	it("keeps who runs it, the notable people and the groups on the Overview", () => {
		for (const list of ["leaders", "groups"]) {
			expect(overview, list).toMatch(new RegExp(`data-list="${list}"`));
			expect(people, list).not.toMatch(new RegExp(`data-list="${list}"`));
		}
		expect(overview).toMatch(/\{\{system\.government\}\}/);
		expect(people).not.toMatch(/system\.government/);
	});

	// Resident cells write their NPC, never the form: a name would let core's submit try to.
	it("gives the resident cells no form name", () => {
		const cells = [...people.matchAll(/<input[^>]*data-resident-field[^>]*>/g)].map(m => m[0]);
		expect(cells.length).toBeGreaterThan(0);
		expect(cells.filter(cell => / name="/.test(cell))).toEqual([]);
	});
});

// The Overview reads as Stonetop's does, in edit mode too (the user's call, 2026-10-19): every list
// row is plain text, never a row of inputs; the wrench adds the red cross, and the row's text opens
// a window to change it. Nothing on a list row is bold, as nothing on Stonetop's is.
describe("the settlement Overview's rows", () => {
	const overview = read("templates/actor/settlement/settlement-overview.hbs");
	const list = read("templates/actor/settlement/settlement-list.hbs");
	const CSS = read("styles/stonetop.css");

	it("draws no inputs or textareas on the lists, in either mode", () => {
		for (const [file, src] of [["overview", overview], ["list", list]]) {
			expect(src, file).not.toMatch(/data-row-field|<textarea/);
		}
	});

	it("opens a row or Who runs it to edit from its text, with the wrench on", () => {
		expect(list).toMatch(/\{\{#if \.\.\/editable\}\} data-action="editRow"/);
		expect(overview.match(/data-action="editRow"/g)?.length).toBe(3);
		expect(overview).toMatch(/data-action="editGovernment"/);
	});

	it("never bolds a row's name", () => {
		expect(CSS).not.toMatch(/\.stonetop-settlement-row-title\s*\{[^}]*font-weight:\s*bold/);
		expect(overview + list).not.toMatch(/<strong>/);
	});
});

// ST-6: a resident's cells write their NPC, so they open only for a user who may write that NPC as
// well as the sheet; the write refuses a non-owner and a blank name rather than throwing.
describe("the settlement Residents cells", () => {
	const people = read("templates/actor/settlement/settlement-people.hbs");

	it("open only on a row whose NPC this user may write", () => {
		expect(people).not.toMatch(/\{\{#if @root\.editable\}\}\s*<input/);
		expect(people.match(/\{\{#if cellsEditable\}\}/g)?.length).toBe(3);
		expect(SHEET).toMatch(/const npc = resolved\.unresolved \? null : game\.actors\?\.get\(resolved\.id\);/);
		expect(SHEET).toMatch(/cellsEditable: editable && !!npc\?\.isOwner/);
	});

	it("refuse a write the NPC would refuse", () => {
		expect(SHEET).toMatch(/if \(!npc\.isOwner\) return refuse\("cannotEditResident"\);/);
		expect(SHEET).toMatch(/if \(field === "name" && !value\) return refuse\("residentNeedsName"\);/);
	});
});

// ST-8, ST-9, ST-10: the sheet's smaller guards.
describe("the settlement sheet's guards", () => {
	it("names only the settlements this user can see as a new Home", () => {
		expect(SHEET).toMatch(/settlementActors\(\)\.filter\(s => s\.visible\)\.map\(s => s\.name\)/);
	});

	it("takes no dropped Item, folder of Items or effect", () => {
		for (const method of ["_onDropItem", "_onDropFolder", "_onDropActiveEffect"]) {
			expect(SHEET, method).toMatch(new RegExp(`^\\t\\tasync ${method}\\(\\) \\{ return false; \\}`, "m"));
		}
	});

	it("says nothing about a resident just made here that a GM's hook listed first", () => {
		expect(SHEET).toMatch(/if \(!quiet\) ui\.notifications\?\.info\?\.\(format\(`\$\{KEY\}\.alreadyResident`/);
	});
});
