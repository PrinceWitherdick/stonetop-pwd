import { beforeEach, describe, it, expect, vi } from "vitest";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { lookup } from "../../fakes/i18n.js";
import { readRepo } from "../../fakes/css.js";

// The header's "+" chip and the box it turns into each explain, on hover, what a reminder is and
// where the table sees it. Foundry's tooltip follows the pointer, not the DOM, so when the "+" is
// swapped for the box (and back) the sheet hands the tooltip across itself, open or still waiting
// to open, but only to an element the pointer is on; and a save, which re-renders the chip row,
// takes down any tooltip on it first (the box's, or the chip of a reminder being removed).

function fakeNode(name) {
	const node = {
		name,
		dataset: {},
		attrs: {},
		value: "",
		listeners: {},
		inDom: true,
		hovered: false,
		inChips: true,
		matches(sel) { return sel === ":hover" && this.hovered; },
		closest(sel) { return sel === ".stonetop-reminder-chips" && this.inChips ? {} : null; },
		setAttribute(k, v) { this.attrs[k] = v; },
		addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
		replaceWith(other) { this.inDom = false; other.inDom = true; },
		focus: vi.fn(),
		fire(type, ev = {}) { for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, stopPropagation() {}, ...ev }); },
	};
	node.inSheet = true;
	return node;
}

function fakeTooltip() {
	return {
		element: null,
		activate: vi.fn(function (el) { if (!el.inDom) return; this.element = el; }),
		deactivate: vi.fn(function () { this.element = null; }),
	};
}

function makeSheet() {
	const update = vi.fn(async () => {});
	const actor = { name: "Pim", system: { reminders: ["owes Gwen a favor"] }, items: [], update };
	const Base = class {
		get actor() { return actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
		element = [{ contains: el => !!el?.inSheet }];
	};
	return { sheet: new (createStonetopCharacterSheetClass(Base))(), update };
}

let input;
beforeEach(() => {
	input = null;
	global.document = { createElement: () => (input = fakeNode("input")) };
	const localize = k => lookup(k) ?? k;
	const format = (k, data) => localize(k).replace(/\{(\w+)\}/g, (_, n) => data?.[n] ?? `{${n}}`);
	global.game = { i18n: { localize, format }, tooltip: fakeTooltip() };
	global.ui = { notifications: { error: vi.fn() } };
});

describe("the reminder chips explain themselves", () => {
	it("the + chip's tooltip says what a reminder is and where it shows", () => {
		const hbs = readRepo("templates/actor/partials/reminder-chips.hbs");
		expect(hbs).toContain('data-tooltip-text="{{localize "stonetop.reminders.addChipTooltip" places=(localize "stonetop.reminders.places")}}"');
		expect(lookup("stonetop.reminders.addChipTooltip")).toContain("{places}");
		const places = lookup("stonetop.reminders.places");
		expect(places).toMatch(/roll card/);
		expect(places).toMatch(/Fight tab/);
		for (const k of ["addChipTooltip", "inputTooltip", "places"]) expect(lookup(`stonetop.reminders.${k}`)).not.toMatch(/—/);
	});

	it("the box carries its own tooltip: how to save it, and who sees it", () => {
		const { sheet } = makeSheet();
		sheet._onReminderChipAdd({ preventDefault() {}, currentTarget: fakeNode("chip") });
		// The one list of places, filled into the box's own sentence.
		expect(input.dataset.tooltipText).toContain(lookup("stonetop.reminders.places"));
		expect(input.dataset.tooltipText).not.toContain("{places}");
		expect(input.dataset.tooltipText).toMatch(/Enter/);
		expect(input.dataset.tooltipText).toMatch(/Escape/);
		expect(input.dataset.tooltipDirection).toBe("UP");
	});

	it("an open + tooltip moves onto the box, and back onto the + on Escape", () => {
		const { sheet } = makeSheet();
		const chip = fakeNode("chip");
		chip.hovered = true;
		game.tooltip.element = chip;
		sheet._onReminderChipAdd({ preventDefault() {}, currentTarget: chip });
		expect(game.tooltip.element).toBe(input);

		input.hovered = true;
		input.fire("keydown", { key: "Escape" });
		expect(chip.inDom).toBe(true);
		expect(game.tooltip.element).toBe(chip);
	});

	it("saving takes the box's tooltip down before the sheet re-renders", async () => {
		const { sheet, update } = makeSheet();
		const chip = fakeNode("chip");
		chip.hovered = true;
		game.tooltip.element = chip;
		sheet._onReminderChipAdd({ preventDefault() {}, currentTarget: chip });
		input.value = "reeks of smoke";
		input.fire("keydown", { key: "Enter" });
		expect(game.tooltip.element).toBe(null);
		await vi.waitFor(() => expect(update).toHaveBeenCalledWith({ "system.reminders": ["owes Gwen a favor", "reeks of smoke"] }));
	});

	it("leaving an empty box by clicking elsewhere takes its tooltip down and puts none on the +", () => {
		// Foundry has not yet run its delayed pointerleave, so the box still owns the tooltip; the
		// pointer is somewhere else, so the + gets nothing to hang open.
		const { sheet } = makeSheet();
		const chip = fakeNode("chip");
		chip.hovered = true;
		game.tooltip.element = chip;
		sheet._onReminderChipAdd({ preventDefault() {}, currentTarget: chip });
		expect(game.tooltip.element).toBe(input);

		input.hovered = false;
		input.fire("blur");
		expect(chip.inDom).toBe(true);
		expect(game.tooltip.element).toBe(null);
		expect(game.tooltip.activate).toHaveBeenCalledTimes(1); // only the hand-over onto the box
	});

	it("a + clicked before its tooltip opened still gives the box its tooltip", () => {
		// The tooltip is only waiting to open on the + (Foundry's pending timer); nothing is active.
		const { sheet } = makeSheet();
		const chip = fakeNode("chip");
		chip.hovered = true;
		sheet._onReminderChipAdd({ preventDefault() {}, currentTarget: chip });
		expect(game.tooltip.element).toBe(input);
	});

	it("a + clicked from the keyboard, with the pointer elsewhere, opens no tooltip", () => {
		const { sheet } = makeSheet();
		sheet._onReminderChipAdd({ preventDefault() {}, currentTarget: fakeNode("chip") });
		expect(game.tooltip.element).toBe(null);
		expect(game.tooltip.activate).not.toHaveBeenCalled();
	});

	it("a reminder's x has no tooltip of its own, only its spoken label", () => {
		const hbs = readRepo("templates/actor/partials/reminder-chips.hbs");
		const x = hbs.match(/<button type="button" class="stonetop-reminder-chip-remove"[^>]*>/)[0];
		expect(x).toContain('aria-label="{{localize "stonetop.reminders.remove" text=c.label}}"');
		expect(x).not.toMatch(/data-tooltip/);
	});

	it("removing a reminder takes its chip's tooltip down before the re-render", async () => {
		// Hovering the x sits inside the chip, so the chip's own tooltip is the one open.
		const { sheet, update } = makeSheet();
		const chip = fakeNode("reminder chip");
		const x = fakeNode("x");
		x.dataset.index = "0";
		game.tooltip.element = chip;
		await sheet._onReminderRemove({ preventDefault() {}, stopPropagation() {}, currentTarget: x });
		expect(game.tooltip.element).toBe(null);
		expect(update).toHaveBeenCalledWith({ "system.reminders": [] });
	});

	it("a save leaves a tooltip that is not on this sheet's chips alone", async () => {
		const { sheet } = makeSheet();
		const elsewhere = fakeNode("elsewhere");
		elsewhere.inSheet = false;
		game.tooltip.element = elsewhere;
		await sheet._saveReminders(["x"]);
		expect(game.tooltip.element).toBe(elsewhere);
	});

	it("a tooltip that was not on the + is left alone", () => {
		const { sheet } = makeSheet();
		const other = fakeNode("other");
		game.tooltip.element = other;
		sheet._onReminderChipAdd({ preventDefault() {}, currentTarget: fakeNode("chip") });
		expect(game.tooltip.element).toBe(other);
		expect(game.tooltip.activate).not.toHaveBeenCalled();
	});
});

describe("reminder writes build on each other", () => {
	it("an x clicked while the box holds text keeps both: the typed line saves, the struck one goes", async () => {
		const { sheet, update } = makeSheet();
		let landSave;
		const actor = sheet.actor;
		actor.system.reminders = ["owes Gwen a favor", "reeks of smoke"];
		update.mockImplementation(async data => {
			// The first write waits on the server; the second must not start from the old list.
			if (update.mock.calls.length === 1) await new Promise(res => { landSave = res; });
			actor.system.reminders = data["system.reminders"];
		});
		const chip = fakeNode("chip");
		sheet._onReminderChipAdd({ preventDefault() {}, currentTarget: chip });
		input.value = "lost a boot";
		input.fire("blur");
		const x = fakeNode("x");
		x.dataset.index = "0";
		const removing = sheet._onReminderRemove({ preventDefault() {}, stopPropagation() {}, currentTarget: x });
		await vi.waitFor(() => expect(landSave).toBeTypeOf("function"));
		landSave();
		await removing;
		expect(update).toHaveBeenCalledTimes(2);
		expect(actor.system.reminders).toEqual(["reeks of smoke", "lost a boot"]);
	});

	it("the same x clicked twice strikes its line once", async () => {
		const { sheet, update } = makeSheet();
		const actor = sheet.actor;
		actor.system.reminders = ["owes Gwen a favor", "reeks of smoke"];
		update.mockImplementation(async data => { actor.system.reminders = data["system.reminders"]; });
		const x = fakeNode("x");
		x.dataset.index = "0";
		const ev = { preventDefault() {}, stopPropagation() {}, currentTarget: x };
		await Promise.all([sheet._onReminderRemove(ev), sheet._onReminderRemove(ev)]);
		expect(actor.system.reminders).toEqual(["reeks of smoke"]);
		expect(update).toHaveBeenCalledTimes(1);
	});

	it("a save that fails puts the box's tooltip back while the pointer is still on it", async () => {
		const { sheet, update } = makeSheet();
		update.mockRejectedValue(new Error("offline"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		const chip = fakeNode("chip");
		chip.hovered = true;
		game.tooltip.element = chip;
		sheet._onReminderChipAdd({ preventDefault() {}, currentTarget: chip });
		input.hovered = true;
		input.value = "reeks of smoke";
		input.fire("keydown", { key: "Enter" });
		expect(game.tooltip.element).toBe(null);
		await vi.waitFor(() => expect(ui.notifications.error).toHaveBeenCalled());
		expect(game.tooltip.element).toBe(input);
	});
});
