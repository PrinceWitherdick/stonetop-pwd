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
		expect(CSS.slice(ours, CSS.indexOf("}", ours))).toMatch(/min-height: 12em/);
	});
});
