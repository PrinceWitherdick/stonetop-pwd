import { describe, it, expect, vi, afterEach } from "vitest";
import { Window } from "happy-dom";
import { CreateMonsterDialog } from "../../module/dialogs/CreateMonsterDialog.js";
import {
	CREATE_MONSTER_WINDOW_CLASS, CREATE_MONSTER_RESTORE_KIND, NEW_MONSTER_KEY, reopenCreateMonster,
} from "../../module/dialogs/create-monster-restore.js";
import { rosterHandlebars } from "../fakes/hbs.js";
import { readRepo } from "../fakes/css.js";

// Make a Monster comes back after a reload (dialogs/create-monster-restore.js): the worksheet lives
// only in its form, so it is read off the form for the save and written back into the next one.

const HBS = readRepo("templates/dialogs/create-monster.hbs");

/** The real worksheet drawn into a page, and a dialog holding it as its element. */
function drawn(extra = {}) {
	const dialog = Object.assign(new CreateMonsterDialog(), extra);
	const window = new Window();
	window.document.body.innerHTML = rosterHandlebars().compile(HBS)(dialog.getData());
	const form = window.document.querySelector(".create-monster");
	dialog.element = [form];
	return { dialog, form };
}

afterEach(() => { delete game.user; });

describe("the Make a Monster restore", () => {
	it("watches the class that actually draws the window, under one key", () => {
		expect(CreateMonsterDialog.name).toBe(CREATE_MONSTER_WINDOW_CLASS);
		expect(new CreateMonsterDialog().restoreKey).toBe(`${CREATE_MONSTER_RESTORE_KIND}:${NEW_MONSTER_KEY}`);
	});

	it("comes back with every field, tick, move and attack, on the section it was on", () => {
		const { dialog, form } = drawn();
		form.querySelector('[name="name"]').value = "Bog Hound";
		form.querySelector('[name="instinct"]').value = "To drag the lost under";
		const size = form.querySelector('input[name="size"]:not(:checked)');
		size.checked = true;
		const tick = form.querySelector('input[name="nature"]');
		tick.checked = true;
		dialog._addMoveCard(form, { name: "Lunge", description: "From the reeds." });
		const card = dialog._addAttackCard(form);
		card.querySelector(".cm-attack-name").value = "Bite";
		card.querySelector(".cm-attack-tag").checked = true;
		dialog._activeTab = "moves";
		const view = JSON.parse(JSON.stringify(dialog.restoreView));

		const { dialog: back, form: fresh } = drawn();
		back._takeRestoredView(view);
		back._applySelections(fresh, back._pendingSelections);
		const sel = back._readSelections(fresh);
		expect(sel).toEqual(view.sel);
		expect(sel.name).toBe("Bog Hound");
		expect(sel.size).toBe(size.value);
		expect(sel.natureTags).toEqual([tick.value]);
		expect(sel.moves).toEqual([{ name: "Lunge", description: "From the reeds." }]);
		expect(sel.extraAttacks).toEqual([{ name: "Bite", die: "", tags: [card.querySelector(".cm-attack-tag").value] }]);
		expect(back._activeTab).toBe("moves");
	});

	it("saves what it last read when there is no form to read, never a blank worksheet", () => {
		const { dialog, form } = drawn();
		form.querySelector('[name="name"]').value = "Bog Hound";
		expect(dialog.restoreView.sel.name).toBe("Bog Hound");
		dialog.element = [];
		expect(dialog.restoreView.sel.name).toBe("Bog Hound");
		expect(new CreateMonsterDialog().restoreView).toBeNull();
	});

	it("ignores a saved view that doesn't read", () => {
		const back = new CreateMonsterDialog();
		back._takeRestoredView({ tab: "nowhere", sel: ["nonsense"], name: 7 });
		expect(back._pendingSelections).toBeUndefined();
		expect(back._activeTab).toBe("concept");
		expect(back._name).toBe("");
	});

	it("reopens for a GM only, and for its own key only", async () => {
		game.user = { isGM: true };
		expect(await reopenCreateMonster("createMonster:new")).toBeInstanceOf(CreateMonsterDialog);
		expect(await reopenCreateMonster("createHazard:new")).toBeNull();
		game.user = { isGM: false };
		expect(await reopenCreateMonster("createMonster:new")).toBeNull();
	});

	// Nothing awaits the worksheet's answer but to know it: it makes the stat block itself, so the one a
	// reload brings back creates the monster exactly as the one before it would have.
	it("makes the monster itself when the restored worksheet is finished", async () => {
		const { dialog, form } = drawn();
		form.querySelector('[name="name"]').value = "Bog Hound";
		const view = JSON.parse(JSON.stringify(dialog.restoreView));
		const { dialog: back, form: fresh } = drawn();
		back._takeRestoredView(view);
		back._applySelections(fresh, back._pendingSelections);
		const created = { sheet: { render: vi.fn() } };
		vi.stubGlobal("Actor", { create: vi.fn(async () => created) });
		back._resolveWith = vi.fn();
		await back._submit(fresh);
		expect(Actor.create).toHaveBeenCalledTimes(1);
		expect(Actor.create.mock.calls[0][0].name).toBe("Bog Hound");
		expect(back._resolveWith).toHaveBeenCalledWith(created);
		vi.unstubAllGlobals();
	});
});
