import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampWindow } from "../../module/camp/CampWindow.js";
import { StonetopDialog } from "../../module/utils/stonetop-dialog.js";

/**
 * Pressing a face in the camp window (module/camp/CampWindow.js#_onClick). The window is built
 * without rendering, and the click lands on a stand-in element that answers `closest` for the one
 * selector it carries.
 */

function clickOn(selector, dataset) {
	const hit = { dataset, closest: sel => (sel === selector ? hit : null) };
	return { target: hit, preventDefault: vi.fn() };
}

function sheetFor(id, { rendered = false } = {}) {
	return { id: `StonetopCharacterSheet-Actor-${id}`, rendered, render: vi.fn() };
}

function campWindowWith(actors) {
	vi.stubGlobal("game", { ...globalThis.game, actors: new Map(Object.entries(actors)) });
	const win = Object.create(CampWindow.prototype);
	win._queue = vi.fn();
	return win;
}

beforeEach(() => {
	globalThis.ui = { ...globalThis.ui, windows: {} };
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("a face at the fire", () => {
	it("opens that character's sheet, and writes nothing to the camp", () => {
		const sheet = sheetFor("bram");
		const win   = campWindowWith({ bram: { sheet } });
		const click = clickOn("[data-camp-sheet]", { campSheet: "bram" });
		win._onClick(click);
		expect(sheet.render).toHaveBeenCalledWith(true);
		expect(click.preventDefault).toHaveBeenCalled();
		expect(win._queue).not.toHaveBeenCalled();
	});

	// Core's own render(true) restores a minimized sheet and brings it to the front (a forced render
	// focuses), so a sheet already open is asked exactly the way a shut one is.
	it("asks a sheet already open to render too, which is what brings it forward", () => {
		const sheet = sheetFor("cora", { rendered: true });
		const win   = campWindowWith({ cora: { sheet } });
		win._onClick(clickOn("[data-camp-sheet]", { campSheet: "cora" }));
		expect(sheet.render).toHaveBeenCalledWith(true);
	});

	it("does nothing for a character who is no longer in the world", () => {
		const win = campWindowWith({});
		expect(() => win._onClick(clickOn("[data-camp-sheet]", { campSheet: "gone" }))).not.toThrow();
		expect(win._queue).not.toHaveBeenCalled();
	});
});

// No updateActor says a character was deleted, so a window over a camp whose host was deleted stayed
// up, open, until some other camp write happened along.
describe("the window's watch", () => {
	it("redraws (and so closes) when the host or anyone seated is deleted, and not for anyone else", () => {
		const handlers = {};
		vi.stubGlobal("Hooks", { on: (name, fn) => { handlers[name] = fn; return name; }, off: vi.fn() });
		const win = campWindowWith({});
		win._camp = { campId: "camp-1", hostId: "aeliana" };
		win._seated = new Set(["aeliana", "bram"]);
		win._hooks = null;
		win._scheduleRender = vi.fn();
		win._watch();
		handlers.deleteActor({ type: "character", id: "aeliana" });
		handlers.deleteActor({ type: "character", id: "bram" });
		expect(win._scheduleRender).toHaveBeenCalledTimes(2);
		handlers.deleteActor({ type: "character", id: "cora" });
		handlers.deleteActor({ type: "npc", id: "aeliana" });
		expect(win._scheduleRender).toHaveBeenCalledTimes(2);
	});
});

/**
 * The GM's roster line: one list in two halves (not at the fire, at it), and a button for each. The
 * list and its buttons are stand-ins carrying only what the window reads off them.
 */
describe("the GM's roster line", () => {
	const ROSTER = 'select[name="campRosterActor"]';

	function rosterPicking(id, half) {
		const buttons = ["add", "send-away"].map(action => ({ disabled: false, dataset: { campAction: action, campBlocked: `wants ${action}` } }));
		const select  = { selectedOptions: [{ value: id, dataset: { campRoster: half } }], parentElement: { querySelectorAll: () => buttons } };
		return { select, buttons };
	}

	/** A whole list over `names` ([id, half] pairs), showing the `picked`th of them, with its two buttons. */
	function rosterList(names, picked = 0) {
		const buttons = ["add", "send-away"].map(action => ({ disabled: false, dataset: { campAction: action, campBlocked: `wants ${action}` } }));
		const select  = {
			options: names.map(([value, half]) => ({ value, dataset: { campRoster: half } })),
			selectedIndex: picked,
			get selectedOptions() { return this.selectedIndex < 0 ? [] : [this.options[this.selectedIndex]]; },
			parentElement: { querySelectorAll: () => buttons },
		};
		return { select, buttons };
	}

	it("lets only the button that fits the pick be pressed, and has the other say why on hover", () => {
		const win = campWindowWith({});
		const { select, buttons: [bring, away] } = rosterPicking("bram", "send-away");
		win._onChange({ target: { closest: sel => (sel === ROSTER ? select : null) } });
		expect(bring.disabled).toBe(true);
		expect(bring.dataset.tooltip).toBe("wants add");
		expect(away.disabled).toBe(false);
		expect(away.dataset).not.toHaveProperty("tooltip");
		expect(win._queue).not.toHaveBeenCalled();
	});

	it("hands each button only someone from its own half of the list", () => {
		const bram = { id: "bram" };
		const win  = campWindowWith({ bram });
		const { select } = rosterPicking("bram", "send-away");
		Object.defineProperty(win, "element", { value: [{ querySelector: sel => (sel === ROSTER ? select : null) }] });
		expect(win._rosterPick("send-away")).toBe(bram);
		expect(win._rosterPick("add")).toBeNull();
	});

	// A player ticking a box redraws the whole window, and a redrawn list opens on its first name, with
	// Bring them pressable on somebody the GM never chose.
	it("keeps the GM's pick through a redraw somebody else's write caused", async () => {
		const names = [["dan", "add"], ["cora", "add"], ["bram", "send-away"]];
		const win   = campWindowWith({});
		const old   = rosterList(names, 1);
		const fresh = rosterList(names);
		let list = old.select;
		Object.defineProperty(win, "rendered", { value: true });
		Object.defineProperty(win, "element", {
			get: () => [{ querySelector: sel => (sel === ROSTER ? list : null), contains: () => false }],
		});
		const draw = vi.spyOn(StonetopDialog.prototype, "_render").mockImplementation(async () => { list = fresh.select; });
		try {
			await win._render(false);
		} finally {
			draw.mockRestore();
		}
		expect(fresh.select.selectedOptions[0].value).toBe("cora");
		expect(fresh.buttons.map(b => b.disabled)).toEqual([false, true]);
	});

	it("picks nobody once the character the GM picked has left the list", () => {
		const win = campWindowWith({});
		const { select, buttons } = rosterList([["dan", "add"], ["bram", "send-away"]]);
		win._keepRosterPick(select, "cora");
		expect(select.selectedOptions).toEqual([]);
		expect(buttons.map(b => b.disabled)).toEqual([true, true]);
	});

	// Somebody else brought Cora to the fire: the pick follows her, so Bring them switches off rather
	// than bringing whoever now heads the list.
	it("keeps the pick when that character has crossed to the other half", () => {
		const win = campWindowWith({});
		const { select, buttons } = rosterList([["dan", "add"], ["bram", "send-away"], ["cora", "send-away"]]);
		win._keepRosterPick(select, "cora");
		expect(select.selectedOptions[0].value).toBe("cora");
		expect(buttons.map(b => b.disabled)).toEqual([true, false]);
	});
});
