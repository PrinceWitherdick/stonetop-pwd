// @vitest-environment happy-dom
// Custom and world moves, wave 3 audit (CUS-1 .. CUS-7).
//
// CUS-1: opening a world move handed off to the authoring dialog for anyone, so a player holding it at
//        Observer got an editor whose Save was refused, and a copy on a character could be edited past
//        the GM-only authoring setting.
// CUS-2: a double-click on Save created the move twice.
// CUS-3: a player's or GM's own move sharing a book move's name borrowed that move's walkthrough
//        (MOVE_ROLL_INSTEAD) and its card extras (moveRollOptions / pick bonuses).
// CUS-4: a world move's editor did not say that copies already on sheets keep their old text.
// CUS-5: an Other Moves row with outcomes but no description showed nothing.
// CUS-6: "Create a move" showed on a sheet the viewer cannot write.
// CUS-7: fixed field ids collided when two authoring windows were open.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStonetopArcanumSheetClass } from "../../../module/item/StonetopArcanumSheet.js";
import { CustomMoveDialog, characterMoveSaver, worldMoveSaver } from "../../../module/actors/character/dialogs/CustomMoveDialog.js";
import { canAuthorCustomMovesOn } from "../../../module/utils/authoring-gates.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { HARD_TO_KILL } from "../../../module/actors/character/deaths-door.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = rel => readFileSync(resolve(ROOT, rel), "utf8");
const CUSTOM = { "stonetop-pwd": { custom: true } };

beforeEach(() => {
	global.ui = { notifications: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } };
});

describe("CUS-1: a world move opens its editor only for someone who may write it", () => {
	const sheetFor = item => {
		const Base = class { get item() { return item; } };
		return new (createStonetopArcanumSheetClass(Base))();
	};
	const worldMove = extra => ({ type: "move", system: { moveType: "other" }, flags: CUSTOM, isOwner: true, parent: null, ...extra });

	it("hands an owned world move to the editor", () => {
		expect(sheetFor(worldMove())._isCustomMoveHandoff()).toBe(true);
	});

	it("shows an Observer the move's card instead", () => {
		expect(sheetFor(worldMove({ isOwner: false }))._isCustomMoveHandoff()).toBe(false);
	});

	it("leaves a copy on a character to the sheet, behind the authoring setting", () => {
		expect(sheetFor(worldMove({ parent: { type: "character" } }))._isCustomMoveHandoff()).toBe(false);
	});
});

describe("CUS-2: Save is latched while the move is written", () => {
	it("creates the move once however fast Save is pressed twice", async () => {
		const Application = global.Application;
		Application.prototype.activateListeners ??= function () {};
		let finish;
		const saver = { create: vi.fn(() => new Promise(r => { finish = r; })), update: vi.fn() };
		const d = new CustomMoveDialog(saver);
		d.close = vi.fn();
		d._frontOnOpen = { start() {}, stop() {} };
		const root = document.createElement("div");
		root.innerHTML = `<input name="name" value="Reckless Charge"><button type="button" class="stonetop-custom-move-save"></button>`;
		d.activateListeners([root]);
		const save = root.querySelector(".stonetop-custom-move-save");
		save.click();
		save.click();
		await Promise.resolve();
		expect(saver.create).toHaveBeenCalledTimes(1);
		finish();
		await new Promise(r => setTimeout(r, 0));
		expect(d.close).toHaveBeenCalledTimes(1);
	});

	it("offers Save again when the name is missing and nothing was written", async () => {
		global.Application.prototype.activateListeners ??= function () {};
		const saver = { create: vi.fn(), update: vi.fn() };
		const d = new CustomMoveDialog(saver);
		d._frontOnOpen = { start() {}, stop() {} };
		d._selectTab = vi.fn();
		const root = document.createElement("div");
		root.innerHTML = `<input name="name" value=""><button type="button" class="stonetop-custom-move-save"></button>`;
		d.activateListeners([root]);
		const save = root.querySelector(".stonetop-custom-move-save");
		save.click();
		await new Promise(r => setTimeout(r, 0));
		expect(saver.create).not.toHaveBeenCalled();
		expect(save.disabled).toBe(false);
	});
});

describe("CUS-3: a player's own move named like a book move acts as itself", () => {
	function sheetWith(item) {
		const actor = { items: { get: id => (id === item._id ? item : null), filter: () => [] } };
		const Base = class {
			constructor() { this._actor = actor; }
			get actor() { return this._actor; }
			get isEditable() { return true; }
			render = vi.fn();
		};
		const sheet = new (createStonetopCharacterSheetClass(Base))();
		sheet._rollHardToKill = vi.fn(async () => {});
		sheet._guidedMoveForRollable = () => null;
		sheet._statChoiceMoveForRollable = () => null;
		sheet._altStatChoiceForRollable = async () => null;
		sheet._promptRollOptions = vi.fn(async () => ({ situational: 0 }));
		return sheet;
	}
	const rollableFor = item => ({
		closest: () => ({ dataset: { itemId: item._id } }),
		classList: { contains: () => true },
		dataset: { roll: "con" },
	});

	it("rolls a homebrew Hard to Kill as itself, not through the Death's Door walkthrough", async () => {
		const own = { _id: "own", type: "move", name: HARD_TO_KILL, flags: CUSTOM, system: {} };
		const sheet = sheetWith(own);
		const answer = await sheet._resolveMoveRollPrompts(rollableFor(own));
		expect(sheet._rollHardToKill).not.toHaveBeenCalled();
		expect(answer).toEqual({ situational: 0 });
	});

	it("still sends the book's Hard to Kill there", async () => {
		const book = { _id: "book", type: "move", name: HARD_TO_KILL, flags: {}, system: {} };
		const sheet = sheetWith(book);
		expect(await sheet._resolveMoveRollPrompts(rollableFor(book))).toBe("handled");
		expect(sheet._rollHardToKill).toHaveBeenCalled();
	});
});

describe("CUS-4: a world move's editor says copies on sheets keep their old text", () => {
	it("marks the world saver, and the editor draws the line only for it", () => {
		expect(worldMoveSaver().world).toBe(true);
		expect(characterMoveSaver({}).world).toBeFalsy();
		const hbs = read("templates/dialogs/custom-move.hbs");
		expect(hbs).toMatch(/\{\{#if worldMove\}\}\s*<p[^>]*>\{\{localize "stonetop\.character\.moves\.custom\.worldCopiesHint"\}\}<\/p>\s*\{\{\/if\}\}/);
		const en = JSON.parse(read("languages/en.json"));
		expect(en.stonetop.character.moves.custom.worldCopiesHint).toMatch(/keep their old text/);
	});

	it("hands the template its world flag and a per-window id suffix (CUS-7)", () => {
		global.Handlebars ??= { helpers: {} };
		Handlebars.helpers.statLabel ??= k => k.toUpperCase();
		const world = new CustomMoveDialog(worldMoveSaver());
		world.appId = 41;
		const own = new CustomMoveDialog(characterMoveSaver({}));
		own.appId = 42;
		expect(world.getData()).toMatchObject({ worldMove: true, uid: 41 });
		expect(own.getData()).toMatchObject({ worldMove: false, uid: 42 });
	});
});

describe("CUS-5: an Other Moves row shows outcomes stored with no description", () => {
	it("draws the body when there is either", () => {
		const hbs = read("templates/actor/partials/tab-moves.hbs");
		const other = hbs.slice(hbs.indexOf("stonetop.movelist.otherMoves"));
		expect(other).toContain('{{#if (or description moveResults)}}<div class="stonetop-item-description">{{{moveBody description moveResults}}}</div>{{/if}}');
	});
});

describe("CUS-6: authoring buttons only on a sheet the viewer can write", () => {
	it("needs both the authoring gate and a writable sheet", () => {
		const prior = global.game;
		global.game = { ...prior, user: { isGM: false }, settings: { get: () => false } };
		try {
			expect(canAuthorCustomMovesOn(true)).toBe(true);
			expect(canAuthorCustomMovesOn(false)).toBe(false);
			global.game.settings.get = () => true;   // GM-only authoring
			expect(canAuthorCustomMovesOn(true)).toBe(false);
		} finally {
			global.game = prior;
		}
		expect(read("module/actors/character/StonetopCharacterSheet.js"))
			.toContain("context.stonetop.canAuthorCustomMoves = canAuthorCustomMovesOn(this.isEditable);");
	});
});

describe("CUS-7: every field id in the authoring window is suffixed per window", () => {
	it("leaves no bare id or label target", () => {
		const hbs = read("templates/dialogs/custom-move.hbs");
		const ids = [...hbs.matchAll(/(?:id|for)="(stonetop-custom-move-[^"]*)"/g)].map(m => m[1]);
		expect(ids.length).toBeGreaterThan(20);
		for (const id of ids) expect(id).toMatch(/-\{\{uid\}\}$/);
	});
});
