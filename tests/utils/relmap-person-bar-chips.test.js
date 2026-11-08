// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { CHIP_ICON_COLUMNS, RelmapPersonBar } from "../../module/utils/relmap-person-bar.js";
import { closeSuggestionMenu } from "../../module/utils/suggestion-menu.js";
import { RELMAP_CHIP_ICONS, RELMAP_INKS } from "../../module/relmap/relmap-store.js";

// THE PERSON BAR'S CHIPS ("Dead", "Noble"): the row of chips a person wears, Add chip's menu, and the
// form that makes or changes a chip. Drawn from the window template itself, so the markup under test
// is the markup that ships. The label field's half is relmap-person-bar.test.js's.

const ROOT = path.resolve(import.meta.dirname, "../..");
const WINDOW = fs.readFileSync(path.join(ROOT, "templates/dialogs/relationship-map.hbs"), "utf8");

const CONTEXT = {
	canEdit: true,
	inks: RELMAP_INKS.map(key => ({ key, name: key })),
	personBar: {
		label: "Label under the name", placeholder: "e.g. Iron Knight", maxLength: 80,
		chips: {
			add: "Add chip", newChip: "New chip…", menuHeading: "Chips",
			edit: "Change the chip {chip}", off: "Take {chip} off",
			name: "Chip name", namePlaceholder: "e.g. Noble", nameMax: 24,
			colour: "Chip colour", colourOwn: "A colour of your own", icon: "Chip icon", preview: "How it looks",
			save: "Save", cancel: "Cancel", delete: "Delete this chip",
			icons: [{ key: "", glyph: "fa-ban", name: "No icon" }, ...RELMAP_CHIP_ICONS.map(key => ({ key, glyph: key, name: key }))],
		},
	},
};

const DEAD = { id: "dead", name: "Dead", icon: "fa-skull", ink: "crimson" };
const NOBLE = { id: "c1", name: "Noble", icon: "fa-crown", ink: "#336699" };

let state, handlers, bar, el;
const $ = sel => el.querySelector(sel);
const $$ = sel => [...el.querySelectorAll(sel)];
const menu = () => document.querySelector(".stonetop-suggestion-menu");
const press = sel => $(sel).click();
const keydown = (target, key) => {
	const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
	target.dispatchEvent(ev);
	return ev;
};

beforeEach(() => {
	globalThis.foundry ??= {};
	foundry.utils ??= {};
	foundry.utils.escapeHTML ??= s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
	document.body.innerHTML = Handlebars.compile(WINDOW)(CONTEXT);
	el = document.querySelector(".stonetop-relmap-personbar");
	state = { node: { name: "Simon", subtitle: "" }, chips: [DEAD] };
	handlers = {
		surface: () => ({
			painted: () => ({ width: 1000, height: 800 }), offset: { x: 0, y: 0 }, viewSize: { width: 1000, height: 800 },
		}),
		personAt: vi.fn(id => (id === "n1" ? { node: state.node, at: { left: 50, top: 50 }, chips: state.chips } : null)),
		onField: vi.fn(() => Promise.resolve(true)),
		library: vi.fn(() => [DEAD, NOBLE]),
		onWear: vi.fn(() => Promise.resolve(true)),
		onTakeOff: vi.fn(() => Promise.resolve(true)),
		onSaveChip: vi.fn(() => Promise.resolve(true)),
		onDropChip: vi.fn(() => Promise.resolve(true)),
		onNeedName: vi.fn(),
		onNudged: vi.fn(),
	};
	bar = new RelmapPersonBar(document.body, handlers);
	el = document.querySelector(".stonetop-relmap-personbar");
});
afterEach(() => { closeSuggestionMenu(); bar.destroy(); });

describe("the chips a person wears", () => {
	it("shows each as a pill to press, with an x to take it off, named for a screen reader", () => {
		bar.open("n1");
		const pill = $(".stonetop-relmap-personbar-worn button.stonetop-relmap-chip");
		expect(pill.dataset.relmapPbar).toBe("chipedit");
		expect(pill.getAttribute("aria-label")).toBe("Change the chip Dead");
		expect(pill.querySelector("i").className).toBe("fas fa-skull");
		const off = $(".stonetop-relmap-personbar-chipoff");
		expect(off.getAttribute("aria-label")).toBe("Take Dead off");
		expect($(".stonetop-relmap-personbar-worn").hidden).toBe(false);
	});

	it("hides the row for somebody wearing none", () => {
		state.chips = [];
		bar.open("n1");
		expect($(".stonetop-relmap-personbar-worn").hidden).toBe(true);
	});

	it("takes a chip off with its x, and hands the focus to Add chip", () => {
		bar.open("n1");
		press(".stonetop-relmap-personbar-chipoff");
		expect(handlers.onTakeOff).toHaveBeenCalledWith("n1", "dead");
		expect(document.activeElement).toBe($("[data-relmap-pbar='chipadd']"));
	});

	it("repaints the row when the board changes under it, and only then", () => {
		bar.open("n1");
		const before = $(".stonetop-relmap-personbar-worn button");
		bar.refresh();
		expect($(".stonetop-relmap-personbar-worn button")).toBe(before);
		state.chips = [DEAD, NOBLE];
		bar.refresh();
		expect($$(".stonetop-relmap-personbar-worn button.stonetop-relmap-chip")).toHaveLength(2);
	});
});

describe("Add chip", () => {
	it("drops a menu led by New chip, with every chip there is and the worn ones marked", () => {
		bar.open("n1");
		press("[data-relmap-pbar='chipadd']");
		const rows = [...menu().querySelectorAll('[role="menuitem"]')];
		expect(rows.map(row => row.querySelector(".stonetop-autocomplete-value").textContent)).toEqual(["New chip…", "Dead", "Noble"]);
		expect(rows[1].getAttribute("aria-disabled")).toBe("true");
		expect(rows[2].querySelector(".stonetop-suggestion-menu-icon").className).toContain("stonetop-relmap-ink--custom");
		expect(rows[2].querySelector(".stonetop-suggestion-menu-icon").getAttribute("style")).toBe("--relmap-ink-raw:#336699");
	});

	it("puts a chip from the menu on the person", () => {
		bar.open("n1");
		press("[data-relmap-pbar='chipadd']");
		menu().querySelectorAll('[role="menuitem"]')[2].click();
		expect(handlers.onWear).toHaveBeenCalledWith("n1", NOBLE);
	});

	it("goes when the bar does", () => {
		bar.open("n1");
		press("[data-relmap-pbar='chipadd']");
		bar.close();
		expect(menu()).toBeNull();
	});
});

describe("the chip form", () => {
	const openNew = () => {
		bar.open("n1");
		press("[data-relmap-pbar='chipadd']");
		menu().querySelector('[role="menuitem"]').click();
	};

	it("opens empty from New chip, with the caret in the name and no Delete", () => {
		openNew();
		expect($(".stonetop-relmap-chipform").hidden).toBe(false);
		expect(document.activeElement).toBe($("[data-relmap-pbar='chipname']"));
		expect($("[data-relmap-pbar='chipdrop']").hidden).toBe(true);
		expect($("[data-relmap-pbar='chipink'][data-relmap-pbar-value='slate']").getAttribute("aria-checked")).toBe("true");
		expect($("[data-relmap-pbar='chipicon'][data-relmap-pbar-value='']").getAttribute("aria-checked")).toBe("true");
	});

	it("saves a new chip with the colour and icon chosen, and puts the form away", () => {
		openNew();
		$("[data-relmap-pbar='chipname']").value = "  Noble  ";
		press("[data-relmap-pbar='chipink'][data-relmap-pbar-value='ochre']");
		press("[data-relmap-pbar='chipicon'][data-relmap-pbar-value='fa-crown']");
		expect($(".stonetop-relmap-chipform-preview").innerHTML).toContain("fa-crown");
		// The press lights the one chosen, and only it.
		const lit = what => $$(`[data-relmap-pbar='${what}'][aria-checked='true']`).map(b => b.dataset.relmapPbarValue);
		expect(lit("chipicon")).toEqual(["fa-crown"]);
		expect(lit("chipink")).toEqual(["ochre"]);
		press("[data-relmap-pbar='chipsave']");
		expect(handlers.onSaveChip).toHaveBeenCalledWith("n1", null, { name: "Noble", icon: "fa-crown", ink: "ochre" });
		expect($(".stonetop-relmap-chipform").hidden).toBe(true);
	});

	it("saves on Enter in the name, and says so when there is no name", () => {
		openNew();
		keydown($("[data-relmap-pbar='chipname']"), "Enter");
		expect(handlers.onNeedName).toHaveBeenCalled();
		expect(handlers.onSaveChip).not.toHaveBeenCalled();
		$("[data-relmap-pbar='chipname']").value = "Outcast";
		keydown($("[data-relmap-pbar='chipname']"), "Enter");
		expect(handlers.onSaveChip).toHaveBeenCalledWith("n1", null, { name: "Outcast", icon: "", ink: "slate" });
	});

	it("opens on a worn chip as it is, with Delete, and changes that chip", () => {
		state.chips = [DEAD, NOBLE];
		bar.open("n1");
		press(".stonetop-relmap-personbar-worn button[data-relmap-pbar-value='c1']");
		expect($("[data-relmap-pbar='chipname']").value).toBe("Noble");
		expect($("[data-relmap-pbar='chipdrop']").hidden).toBe(false);
		// A colour of its own shows in the picker and lights none of the eight.
		expect($("[data-relmap-pbar='chiphex']").hidden).toBe(false);
		expect($$("[data-relmap-pbar='chipink'][aria-checked='true']")).toHaveLength(0);
		press("[data-relmap-pbar='chipicon'][data-relmap-pbar-value='fa-ghost']");
		press("[data-relmap-pbar='chipsave']");
		expect(handlers.onSaveChip).toHaveBeenCalledWith("n1", "c1", { name: "Noble", icon: "fa-ghost", ink: "#336699" });
	});

	it("asks to delete a chip, and stays open if the reader thinks better of it", async () => {
		bar.open("n1");
		press(".stonetop-relmap-personbar-worn button[data-relmap-pbar-value='dead']");
		handlers.onDropChip.mockResolvedValueOnce(false);
		press("[data-relmap-pbar='chipdrop']");
		await Promise.resolve();
		expect(handlers.onDropChip).toHaveBeenCalledWith("dead");
		expect($(".stonetop-relmap-chipform").hidden).toBe(false);
	});

	it("steps back one thing per Escape: the form, then the bar", () => {
		openNew();
		keydown($("[data-relmap-pbar='chipname']"), "Escape");
		expect($(".stonetop-relmap-chipform").hidden).toBe(true);
		expect(el.hidden).toBe(false);
		keydown($("[data-relmap-pbar='chipadd']"), "Escape");
		expect(el.hidden).toBe(true);
	});

	it("lets Enter press a button on the bar rather than closing it", () => {
		bar.open("n1");
		const ev = keydown($("[data-relmap-pbar='chipadd']"), "Enter");
		expect(ev.defaultPrevented).toBe(false);
		expect(el.hidden).toBe(false);
	});

	it("walks the icon grid with the arrows, a row at a time up and down", () => {
		openNew();
		const icons = $$("[data-relmap-pbar='chipicon']");
		icons[0].focus();
		keydown(icons[0], "ArrowDown");
		expect(document.activeElement).toBe(icons[CHIP_ICON_COLUMNS]);
		keydown(icons[CHIP_ICON_COLUMNS], "ArrowRight");
		expect(document.activeElement).toBe(icons[CHIP_ICON_COLUMNS + 1]);
	});

	it("is put away when the bar opens on somebody else", () => {
		openNew();
		bar.open("n1");
		expect($(".stonetop-relmap-chipform").hidden).toBe(false);
		bar.close();
		bar.open("n1");
		expect($(".stonetop-relmap-chipform").hidden).toBe(true);
	});
});
