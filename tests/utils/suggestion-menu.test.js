// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSuggestionMenu, closeSuggestionMenu } from "../../module/utils/suggestion-menu.js";
import { placeFixedPopup } from "../../module/utils/autocomplete.js";
import { readRepo as read } from "../fakes/css.js";

// The menu an "Add …" button drops instead of a row of suggestion chips (user, 2026-11-07): the threat
// editor's GM moves and Create Monster's book prompts.

const ITEMS = [
	{ value: "Burn the fields", label: "Burn the fields" },
	{ value: "Take a hostage", label: "Take a hostage", used: true },
	{ value: "Sow fear", label: "Sow fear", hint: "quietly" },
];

let button, onPick;
const menu = () => document.querySelector(".stonetop-suggestion-menu");
const items = () => [...menu().querySelectorAll('[role="menuitem"]')];
const key = k => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
const open = () => openSuggestionMenu(button, { heading: "Suggested for Ancient Evil", blankLabel: "Blank GM move", items: ITEMS, onPick });

beforeEach(() => {
	globalThis.foundry ??= {};
	foundry.utils ??= {};
	foundry.utils.escapeHTML ??= s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
	document.body.innerHTML = `<button type="button" aria-haspopup="menu" aria-expanded="false">Add GM move</button>`;
	button = document.querySelector("button");
	onPick = vi.fn();
});
afterEach(() => closeSuggestionMenu());

describe("the suggestion menu", () => {
	it("lists a blank row first, then the suggestions under their heading", () => {
		open();
		expect(menu().getAttribute("role")).toBe("menu");
		expect(items().map(li => li.textContent)).toEqual(["Blank GM move", "Burn the fields", "Take a hostageadded", "Sow fearquietly"]);
		expect(menu().querySelector(".stonetop-suggestion-menu-heading").textContent).toBe("Suggested for Ancient Evil");
		expect(button.getAttribute("aria-expanded")).toBe("true");
	});

	it("draws an item's icon before its words, in the class and colour it was given", () => {
		openSuggestionMenu(button, {
			blankLabel: "New chip", onPick,
			items: [{ value: "dead", label: "Dead", icon: "fa-skull", iconClass: "stonetop-relmap-ink--crimson", iconStyle: "--relmap-ink-raw:#123456" }],
		});
		const icon = items()[1].querySelector(".stonetop-suggestion-menu-icon");
		expect(icon.classList.contains("stonetop-relmap-ink--crimson")).toBe(true);
		expect(icon.getAttribute("style")).toBe("--relmap-ink-raw:#123456");
		expect(icon.getAttribute("aria-hidden")).toBe("true");
		expect(icon.querySelector("i").className).toBe("fas fa-skull");
		expect(icon.nextElementSibling.textContent).toBe("Dead");
		// No icon asked for, none drawn: every other menu is as it was.
		expect(items()[0].querySelector(".stonetop-suggestion-menu-icon")).toBeNull();
	});

	it("puts focus on the first item, so the keyboard can start at once", () => {
		open();
		expect(document.activeElement).toBe(items()[0]);
	});

	it("hands back null for the blank row and the value for a suggestion", () => {
		open();
		items()[0].click();
		expect(onPick).toHaveBeenLastCalledWith(null);
		expect(menu()).toBeNull();
		open();
		items()[1].click();
		expect(onPick).toHaveBeenLastCalledWith("Burn the fields");
	});

	it("will not add a suggestion that is already on the list", () => {
		open();
		items()[2].click();
		expect(onPick).not.toHaveBeenCalled();
		expect(menu()).not.toBeNull();
	});

	it("moves with the arrows past the added one, picks with Enter, and gives focus back", () => {
		open();
		key("ArrowDown");
		key("ArrowDown");
		expect(document.activeElement.textContent).toBe("Sow fearquietly");
		key("Enter");
		expect(onPick).toHaveBeenCalledWith("Sow fear");
		expect(document.activeElement).toBe(button);
		expect(button.getAttribute("aria-expanded")).toBe("false");
	});

	it("closes on Escape without picking, and on a second press of its button", () => {
		open();
		key("Escape");
		expect(menu()).toBeNull();
		expect(onPick).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(button);
		open();
		open();
		expect(menu()).toBeNull();
	});

	it("closes on a press anywhere else", () => {
		open();
		document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
		expect(menu()).toBeNull();
	});

	it("goes with its button's window, and only that window, so no window has to put it away", () => {
		const hooks = new Map();
		let nextId = 0;
		const saved = globalThis.Hooks;
		globalThis.Hooks = {
			on: (name, fn) => { hooks.set(name, [...(hooks.get(name) ?? []), [++nextId, fn]]); return nextId; },
			off: (name, id) => hooks.set(name, (hooks.get(name) ?? []).filter(([i]) => i !== id)),
		};
		const fire = (name, app) => (hooks.get(name) ?? []).forEach(([, fn]) => fn(app));
		try {
			const other = document.createElement("div");
			document.body.appendChild(other);
			open();
			// Another window closing leaves it open (V1 apps carry a jQuery element).
			fire("closeApplication", { element: { jquery: true, 0: other } });
			expect(menu()).not.toBeNull();
			fire("closeApplicationV2", { element: document.body });
			expect(menu()).toBeNull();
			// And it lets the hooks go once closed.
			expect([...hooks.values()].every(list => list.length === 0)).toBe(true);
		} finally {
			globalThis.Hooks = saved;
		}
	});
});

describe("placing the popup", () => {
	const rect = { top: 0, bottom: 0, left: 0, width: 0 };
	const at = (top, bottom, left = 20, width = 100) => ({ ...rect, top, bottom, left, width });

	it("opens down under a button with room, at least as wide as asked and inside the window", () => {
		const popup = document.createElement("ul");
		placeFixedPopup(popup, at(100, 120, window.innerWidth - 50), { maxHeight: 300, openUpBelow: 180, minHeight: 100, minWidth: 360 });
		expect(popup.style.top).toBe("122px");
		expect(popup.style.bottom).toBe("auto");
		expect(popup.style.width).toBe("360px");
		expect(popup.style.left).toBe(`${window.innerWidth - 368}px`);
	});

	it("opens up when the room below is cramped, matching the field's width without a minimum", () => {
		const popup = document.createElement("ul");
		const h = window.innerHeight;
		placeFixedPopup(popup, at(h - 40, h - 20), { maxHeight: 250, openUpBelow: 160, minHeight: 80 });
		expect(popup.style.top).toBe("auto");
		expect(popup.style.bottom).toBe("42px");
		expect(popup.style.maxHeight).toBe(`${Math.min(250, h - 42)}px`);
		expect(popup.style.width).toBe("100px");
		expect(popup.style.left).toBe("20px");
	});
});

describe("the windows that use it", () => {
	it("drops the threat editor's chips for a menu on Add GM move", () => {
		const hbs = read("templates/dialogs/threat-editor.hbs");
		expect(hbs).not.toContain("threat-suggested");
		expect(hbs).toMatch(/key="gmMoves"[^}]*menu=this\.suggestedMoves\.length/);
		expect(read("templates/dialogs/partials/threat-string-list.hbs")).toMatch(/\{\{#if this\.menu\}\} aria-haspopup="menu"/);
		expect(read("module/threats/threat-editor-dialog.js")).toMatch(/openSuggestionMenu\(button/);
	});

	it("drops Create Monster's book-prompt chips for a menu on Add a move", () => {
		const hbs = read("templates/dialogs/create-monster.hbs");
		expect(hbs).not.toContain("cm-move-suggestion");
		expect(hbs).toMatch(/class="cm-move-add" aria-haspopup="menu"/);
		expect(read("module/dialogs/CreateMonsterDialog.js")).toMatch(/openSuggestionMenu\(add/);
	});

	// The menu closes with its button's window, so a window closing it by hand would close
	// another window's menu too.
	it("leaves the menu to close itself when a window closes", () => {
		for (const file of ["module/threats/threat-editor-dialog.js", "module/dialogs/CreateMonsterDialog.js", "module/sites/create-site-dialog.js"]) {
			expect(read(file)).not.toContain("closeSuggestionMenu");
		}
	});
});
