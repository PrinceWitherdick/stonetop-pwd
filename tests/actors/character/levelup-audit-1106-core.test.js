// The 2026-11-06 Level Up audit, CORE fixes: keyboard focus and short card names (M1), "Choose my move
// later" (C2), owed Invocations caught up (C3), the insert-class hint and "Taken as a level pick" (C4),
// a replaced move's pick counted however it came (L5), an agreed move after a playbook change (L6), a
// move added while the window was open (L7), the away reminder's party (L10), a level undone by hand
// (L11), the Reset XP overview (L12), the cue on a sheet one can only view (L14), a greyed mark option's
// reason (L15) and the window's strings (L16).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { buildLiveCharacter, makeLiveItem, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { LEVEL_PICK_FLAG, RETIRED_COUNTED_PICK_FLAG } from "../../../module/actors/character/StonetopCharacter.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";
import { LevelUpDialog } from "../../../module/actors/character/dialogs/LevelUpDialog.js";
import { levelPickToggleFor, attachLevelPickToggles } from "../../../module/actors/character/level-pick-toggle.js";
import { LEARN_LATER, detectMilestones, snapshotFrom } from "../../../module/timeline/timeline-milestones.js";
import { grantLevelUpClaim, noteLevelUpLanded, resetLevelUpClaims } from "../../../module/actors/character/level-up-claim.js";
import { expeditionUnderwayFor } from "../../../module/campaign/level-up-at-home.js";
import { focusInto, focusNextWindow } from "../../../module/utils/focus-window.js";

let priorSettings;
beforeEach(() => { priorSettings = game.settings; game.settings ??= { get: () => undefined }; });
afterEach(() => { game.settings = priorSettings; });

const ROOT = process.cwd();
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const TEMPLATE = read("templates", "dialogs", "level-up.hbs");
const OTHER_CARD = read("templates", "dialogs", "partials", "level-up-other-card.hbs");

function renderDialog(context) {
	const hb = Handlebars.create();
	hb.registerHelper("localize", key => key);
	hb.registerHelper("moveBody", description => description);
	hb.registerPartial("stonetop.level-up-other-card", OTHER_CARD);
	return hb.compile(TEMPLATE)(context);
}

const flag = (item, key) => item?.flags?.[STONETOP_SCOPE]?.[key];
const idOf = (playbook, name) => sourceMovesFor(playbook).find(d => d.name === name)._id;
const levelOf = actor => actor.system.attributes.level.value;
const budget = async char => {
	const { movelist } = await char.buildSnapshot();
	return [movelist.levelMovesShortfall, movelist.levelMovesOverage];
};
// A plain move this level-up offers: no stat, no cross pick, no marks, not repeatable.
const plainPick = data => data.availableMoves.find(m => m.cap == null && !m.crossPlaybook && !m.markOptions?.length && !m.repeatable);

function makeDialog({ character = {}, data = {} } = {}) {
	const char = { applyLevelUp: vi.fn().mockResolvedValue({ applied: true }), getForeignMovesForLevelUp: vi.fn().mockResolvedValue([]), ...character };
	const levelUpData = {
		level: 2, newLevel: 3, cost: 10, xp: 12, xpRemaining: 2, playbookName: "The Fox", needsInvocation: false,
		availableMoves: [], lockedMoves: [], availableInvocations: [], stats: [], ...data,
	};
	const dlg = new LevelUpDialog(char, levelUpData, vi.fn());
	dlg.close = vi.fn();
	dlg.render = vi.fn();
	return { dlg, char };
}

describe("C2: Choose my move later (Book I p.529)", () => {
	it("takes the level with no move; the Moves tab then asks for it, and the timeline says so", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-fox", name: "The Fox", level: 1 });
		const before = actor.items.length;
		const res = await char.applyLevelUp(null, null, null, { fromLevel: 1, moveName: LEARN_LATER });
		expect(res.applied).toBe(true);
		expect(levelOf(actor)).toBe(2);
		expect(actor.items.length).toBe(before);
		expect(await budget(char)).toEqual([1, 0]);
		// Ticked on the Moves tab later, it is the level's pick.
		const pick = plainPick(await char.getLevelUpData());
		await char.addMove(pick.compendiumId);
		expect(await budget(char)).toEqual([0, 0]);
		const snap = level => snapshotFrom({ system: { attributes: { level: { value: level } } } });
		const rows = detectMilestones(snap(1), snap(2), { learned: LEARN_LATER });
		expect(rows[0]).toMatchObject({ bodyKey: "stonetop.timeline.milestone.learnLater" });
		expect(game.i18n.localize("stonetop.character.moves.levelMovesIncompleteHint")).toMatch(/Moves tab: turn on Edit, then tick/);
	});

	it("the move step offers the card, and Apply sends no move", async () => {
		const { dlg, char } = makeDialog({ data: { needsInvocation: true, invocationAllowance: 1, availableInvocations: [{ slug: "a", label: "A" }] } });
		dlg._step = "move";
		const html = renderDialog(dlg.getData());
		expect(html).toContain('data-compendium-id="__later__"');
		expect(html).toContain("stonetop.specialMoves.levelUp.laterTitle");
		expect(game.i18n.localize("stonetop.specialMoves.levelUp.laterHint")).toContain("page 529");
		dlg._selectedMoveId = "__later__";
		expect(dlg.getData().canContinue).toBe(true);
		// The Invocation step still runs (step 5 does not hang on the move).
		expect(dlg._adjacentStep(+1)).toBe("invocation");
		dlg._step = "invocation";
		dlg._selectedInvocations = ["a"];
		await dlg._apply();
		const [moveId, invocation, choices, opts] = char.applyLevelUp.mock.calls[0];
		expect(moveId).toBeNull();
		expect(invocation).toEqual(["a"]);
		expect(choices).toBeNull();
		expect(opts.moveName).toBe(LEARN_LATER);
	});
});

describe("C3: every owed Invocation is asked at Level Up (Book I p.146)", () => {
	const known = ["bath-of-healing-light", "blinding-light"];
	it("a level-4 Lightbearer knowing only 2 is asked for the 2 owed, even on an odd level", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-lightbearer", name: "The Lightbearer", level: 4, flags: { "invocations.selected": known } });
		const data = await char.getLevelUpData();
		expect(data.newLevel).toBe(5);
		expect(data.needsInvocation).toBe(true);
		expect(data.invocationAllowance).toBe(2); // 2 + floor(5 / 2) = 4 expected
		const picks = data.availableInvocations.slice(0, 2).map(o => o.slug);
		await char.applyLevelUp(plainPick(data).compendiumId, picks, null);
		expect(actor.getFlag(STONETOP_SCOPE, "invocations.selected")).toEqual([...known, ...picks]);
		// Caught up: the next (even) level asks for its one.
		const next = await char.getLevelUpData();
		expect([next.needsInvocation, next.invocationAllowance]).toEqual([true, 1]);
	});

	it("the step is multi-pick: Continue waits for every one, and Apply sends them all", async () => {
		const invs = [{ slug: "a", label: "A" }, { slug: "b", label: "B" }, { slug: "c", label: "C" }];
		const { dlg, char } = makeDialog({ data: { needsInvocation: true, invocationAllowance: 2, availableInvocations: invs, availableMoves: [{ compendiumId: "p1", name: "Harden" }] } });
		dlg._selectedMoveId = "p1";
		dlg._step = "invocation";
		dlg._selectedInvocations = ["a"];
		let ctx = dlg.getData();
		expect(ctx.canContinue).toBe(false);
		expect(ctx.invocationIntro).toContain("Choose 2 new Invocations");
		dlg._selectedInvocations = ["a", "b"];
		ctx = dlg.getData();
		expect(ctx.canContinue).toBe(true);
		expect(ctx.invocations.find(i => i.slug === "c").disabled).toBe(true);
		expect(ctx.invocationChosen).toBe("2 / 2 chosen");
		await dlg._apply();
		expect(char.applyLevelUp.mock.calls[0][1]).toEqual(["a", "b"]);
	});
});

describe("C4: insert-class hint, and 'Taken as a level pick' on the Moves tab", () => {
	it("the Agreed hint names an unlocked insert class (p.528) and the table's agreement (p.529)", () => {
		const hint = game.i18n.localize("stonetop.specialMoves.levelUp.agreedHint");
		expect(hint).toContain("insert class you've unlocked (Book I, page 528)");
		expect(hint).toContain("if everyone (not just you) agrees (page 529)");
	});

	it("a dropped move from another playbook can be named as a level's pick, and the budget counts it", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-fox", name: "The Fox", level: 1 });
		await char.applyLevelUp(null, null, null, { moveName: LEARN_LATER });
		const heavy = sourceMovesFor("The Heavy").find(d => d.name === "Cut from Granite");
		const [dropped] = await actor.createEmbeddedDocuments("Item", [{ name: heavy.name, type: "move", system: { ...structuredClone(heavy.system), moveType: "other" } }]);
		expect(await budget(char)).toEqual([1, 0]);
		expect(levelPickToggleFor(actor.items, [dropped._id])).toEqual({ itemId: dropped._id, on: false });
		await char.setLevelPick(dropped._id, true);
		expect(flag(actor.items.find(i => i._id === dropped._id), LEVEL_PICK_FLAG)).toBe(true);
		expect(await budget(char)).toEqual([0, 0]);
		expect(levelPickToggleFor(actor.items, [dropped._id])).toEqual({ itemId: dropped._id, on: true });
		await char.setLevelPick(dropped._id, false);
		expect(await budget(char)).toEqual([1, 0]);
	});

	it("never on a cross-playbook grant, and only in edit mode for someone who may write", () => {
		const granted = { _id: "g", type: "move", flags: { [STONETOP_SCOPE]: { grantedBy: { instanceId: "v", move: "Versatile" } } } };
		const own = { _id: "o", type: "move", flags: {} };
		const items = [granted, own];
		expect(levelPickToggleFor(items, ["g"])).toBeNull();
		const movelist = { learnedMoves: [{ ownedIds: ["g", "o"] }], otherMoves: [{ ownedId: "o" }] };
		attachLevelPickToggles(movelist, items, true);
		expect(movelist.learnedMoves[0].levelPickToggle).toEqual({ itemId: "o", on: false });
		expect(movelist.otherMoves[0].levelPickToggle).toEqual({ itemId: "o", on: false });
		attachLevelPickToggles(movelist, items, false);
		expect(movelist.otherMoves[0].levelPickToggle).toBeNull();
		const sheet = read("module", "actors", "character", "StonetopCharacterSheet.js");
		expect(sheet).toMatch(/attachLevelPickToggles\(context\.stonetop\.movelist, this\.actor\.items, !!\(context\.stonetop\.movesEdit && this\.isEditable\)\)/);
		expect(read("templates", "actor", "partials", "level-pick-toggle.hbs")).toContain('class="stonetop-level-pick-check" data-item-id="{{this.levelPickToggle.itemId}}"');
		for (const tpl of [["templates", "actor", "partials", "move-group.hbs"], ["templates", "actor", "partials", "tab-moves.hbs"]]) {
			expect(read(...tpl)).toContain('{{> "stonetop.level-pick-toggle"}}');
		}
		expect(read("stonetop.js")).toContain('"stonetop.level-pick-toggle":    "systems/stonetop-pwd/templates/actor/partials/level-pick-toggle.hbs"');
	});
});

describe("L5: a replaced move's pick is counted whichever route each half came by (Book I p.529)", () => {
	const dabbler = () => idOf("The Fox", "Dabbler");
	const bulwark = () => idOf("The Judge", "Bulwark");
	const rampart = () => idOf("The Judge", "A Mighty Rampart");

	it("a Bulwark from a cross move, replaced by an agreed Rampart, is not counted again", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-fox", name: "The Fox", level: 1 });
		await char.applyLevelUp(dabbler(), null, { crossPlaybook: true, foreignMoveId: bulwark(), grantsPossession: null });
		expect(actor.items.find(i => i.name === "Bulwark")).toBeTruthy();
		await char.applyLevelUp(null, null, { agreed: { foreignMoveId: rampart() } });
		expect(actor.items.find(i => i.name === "Bulwark")).toBeFalsy();
		const rampartItem = actor.items.find(i => i.name === "A Mighty Rampart");
		expect(flag(rampartItem, RETIRED_COUNTED_PICK_FLAG)).toBe(false);
		expect(await budget(char)).toEqual([0, 0]);
	});

	it("an agreed Bulwark replaced by a Rampart from a cross move is still a pick, and comes back agreed", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-fox", name: "The Fox", level: 1 });
		await char.applyLevelUp(null, null, { agreed: { foreignMoveId: bulwark() } });
		await char.applyLevelUp(dabbler(), null, { crossPlaybook: true, foreignMoveId: rampart(), grantsPossession: null });
		expect(actor.items.find(i => i.name === "Bulwark")).toBeFalsy();
		expect(await budget(char)).toEqual([0, 0]);
		// Un-learning Dabbler takes its Rampart, which hands Bulwark back as the agreed pick it was.
		await char.removeMove(actor.items.find(i => i.name === "Dabbler")._id);
		const back = actor.items.find(i => i.name === "Bulwark");
		expect(flag(back, LEVEL_PICK_FLAG)).toBe(true);
		expect(await budget(char)).toEqual([1, 0]);
	});

	it("a replacement retired before the stamp reads as it did (not through a cross pick)", () => {
		const { char } = buildLiveCharacter({
			slug: "the-fox", name: "The Fox", level: 1, seedStartingMoves: false,
			items: [makeLiveItem({ name: "A Mighty Rampart", type: "move", system: {}, flags: { [STONETOP_SCOPE]: { retiredMove: "Bulwark" } } })],
		});
		expect(char._retiredPickCount()).toBe(1);
	});
});

describe("L6: an agreed move of the playbook the character switched to is one pick", () => {
	it("is counted by the playbook row only", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-fox", name: "The Fox", level: 1 });
		const pick = plainPick(await char.getLevelUpData());
		// As if agreed while a Heavy, kept through the change to the Fox (clearPlaybookData keeps it).
		await char.addMove(pick.compendiumId, { flags: { [LEVEL_PICK_FLAG]: true } });
		await actor.update({ "system.attributes.level.value": 2 });
		expect(await budget(char)).toEqual([0, 0]);
	});
});

describe("L7: a move added while the window was open is not added twice", () => {
	it("refuses before anything is written, and the window goes back to the move step", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-fox", name: "The Fox", level: 1 });
		const pick = plainPick(await char.getLevelUpData());
		await char.addMove(pick.compendiumId); // ticked on the Moves tab meanwhile
		const count = actor.items.length;
		const res = await char.applyLevelUp(pick.compendiumId, null, null, { fromLevel: 1 });
		expect(res).toEqual({ applied: false, reason: "moveHeld" });
		expect([levelOf(actor), actor.items.length]).toEqual([1, count]);

		const fresh = { level: 1, newLevel: 2, availableMoves: [], lockedMoves: [], availableInvocations: [], stats: [] };
		const { dlg } = makeDialog({ character: {
			applyLevelUp: vi.fn().mockResolvedValue({ applied: false, reason: "moveHeld" }),
			getLevelUpData: vi.fn().mockResolvedValue(fresh),
		}, data: { availableMoves: [{ compendiumId: "p1", name: "Harden" }] } });
		const warn = vi.fn();
		globalThis.ui = { ...(globalThis.ui ?? {}), notifications: { warn, info: vi.fn(), error: vi.fn() } };
		dlg._selectedMoveId = "p1";
		dlg._step = "move";
		await dlg._apply();
		expect(warn.mock.calls[0][0]).toContain("Harden is already on the sheet");
		expect(dlg.close).not.toHaveBeenCalled();
		expect([dlg._step, dlg._selectedMoveId, dlg._data]).toEqual(["move", null, fresh]);
	});
});

describe("L10: the away reminder names only who set out", () => {
	it("leaves out a PC not on the trip's party list", () => {
		const trip = { id: "t1", title: "To the Delve", setOut: { season: "summer", year: 1 }, party: [{ id: "bram", name: "Bram" }] };
		expect(expeditionUnderwayFor("bram", { list: [trip] })?.label).toBe("To the Delve");
		expect(expeditionUnderwayFor("newcomer", { list: [trip] })).toBeNull();
		// A trip from before the snapshot: everyone not ticked out, as before.
		expect(expeditionUnderwayFor("newcomer", { list: [{ ...trip, party: undefined }] })).not.toBeNull();
	});
});

describe("L11: a level undone by hand can be claimed again at once", () => {
	afterEach(() => resetLevelUpClaims());
	it("a landed claim no longer holds the level once the GM's copy is back at it", () => {
		const actor = { uuid: "Actor.a", system: { attributes: { level: { value: 3 } } } };
		expect(grantLevelUpClaim(actor, 3, "player", 1000)).toBe(true);
		// Still in flight: another user is refused.
		expect(grantLevelUpClaim(actor, 3, "gm", 1100)).toBe(false);
		actor.system.attributes.level.value = 4;
		noteLevelUpLanded(actor);
		actor.system.attributes.level.value = 3; // the GM takes it back by hand
		expect(grantLevelUpClaim(actor, 3, "gm", 1200)).toBe(true);
		expect(grantLevelUpClaim(actor, 3, "player", 1300)).toBe(false);
	});
});

describe("L12: the overview under 'Reset XP to 0 on Level Up' (Book I p.582)", () => {
	it("says every point goes", () => {
		game.settings = { get: (_s, key) => (key === "xpResetOnLevelUp" ? true : undefined) };
		const { dlg } = makeDialog({ data: { xp: 14, cost: 10, xpRemaining: 0 } });
		const ctx = dlg.getData();
		expect(ctx.resetAside).toContain("all 14 XP is spent");
		expect(renderDialog(ctx)).toContain("stonetop-levelup-reset");
		game.settings = { get: () => undefined };
		expect(makeDialog({ data: { xp: 14, cost: 10 } }).dlg.getData().resetAside).toBe("");
	});
});

describe("L14: the Level Up cue on a sheet one can only view", () => {
	it("is a picture that says so, and the button is off", () => {
		const vitals = read("templates", "actor", "partials", "actor-vitals.hbs");
		expect(vitals).toMatch(/{{#if stonetop\.levelUpCanOpen}}\s*<a class="stonetop-levelup-icon" role="button" tabindex="0"/);
		expect(vitals).toMatch(/{{else if stonetop\.canLevelUp}}\s*<span class="stonetop-levelup-icon is-readonly" role="img"/);
		expect(read("templates", "actor", "partials", "tab-special-moves.hbs")).toContain("{{#unless stonetop.levelUpCanOpen}}disabled{{/unless}}");
		expect(read("module", "actors", "character", "StonetopCharacterSheet.js"))
			.toContain("context.stonetop.levelUpCanOpen = context.stonetop.canLevelUp && !!this.isEditable;");
	});
});

describe("L15 + L16: a greyed mark option says why in text; the window's words are translated", () => {
	const heroes = {
		compendiumId: "htl1", name: "Heroes to the Last", cap: null, crossPlaybook: null,
		markOptions: [
			{ slug: "inured", label: "They are inured", marks: 1 },
			{ slug: "crew-damage", label: "Increase their damage die one size (max d10)", marks: 2, crewDamageStep: 1, crewDamageCap: "d10" },
		],
		markBudget: { base: 1, perExtra: 1 }, ownedIds: ["h1"],
	};
	it("renders the reason under the option and ties it to the option", () => {
		const marks = { "Heroes to the Last": { "crew-damage": [{ stat: "", level: 6 }] } };
		const { dlg } = makeDialog({ data: { availableMoves: [heroes], marks, markCapState: { crewDamageDie: "d10" } } });
		dlg._selectedMoveId = "htl1";
		dlg._step = "marks";
		const ctx = dlg.getData();
		const opt = ctx.markStep.options.find(o => o.slug === "crew-damage");
		const html = renderDialog(ctx);
		expect(html).toContain(`aria-describedby="${opt.noteId}"`);
		expect(html).toContain(`<p class="stonetop-levelup-option-note" id="${opt.noteId}">Their damage die is already d10</p>`);
		expect(html).not.toContain("data-tooltip=");
		expect(ctx.markStep.chosenLabel).toBe("Heroes to the Last: 0 / 1 chosen");
		expect(opt.existingLabel).toBe("marked ×1");
	});

	it("the stat step's cap note and (max), and the companion count, come from en.json", () => {
		const stat = { compendiumId: "s1", name: "Improved Stat", cap: 2, crossPlaybook: null };
		const { dlg } = makeDialog({ data: { availableMoves: [stat], stats: [{ key: "str", name: "Strength", value: 2 }] } });
		dlg._selectedMoveId = "s1";
		dlg._step = "stat";
		const ctx = dlg.getData();
		expect(ctx.statCapLabel).toBe("Improved Stat: max +2");
		expect(renderDialog(ctx)).toContain("<em>(max)</em>");
		const src = read("templates", "dialogs", "level-up.hbs");
		for (const english of [" chosen</span>", "max +{{", "<em>(max)</em>"]) expect(src).not.toContain(english);
	});
});

describe("M1: the keyboard stays in the Level Up window", () => {
	it("every step's intro can take focus, and the overview's is the window's first stop", () => {
		const intros = TEMPLATE.match(/class="stonetop-levelup-intro(?: [^"]*)?"[^>]*>/g);
		// Nine steps: overview, a homebrew playbook's own advance, move, agreed, foreign, stat, marks, companion, invocation.
		expect(intros.length).toBe(9);
		for (const tag of intros) expect(tag).toContain('tabindex="-1" data-levelup-focus');
		expect(intros[0]).toContain("data-autofocus");
	});

	it("each move card is named by its move and described by its text", () => {
		const { dlg } = makeDialog({ data: { availableMoves: [{ compendiumId: "p1", name: "Harden", description: "<p>When you...</p>", requiresLabel: "level 6+" }] } });
		dlg._step = "move";
		const ctx = dlg.getData();
		const card = ctx.moves[0];
		const html = renderDialog(ctx);
		expect(html).toContain(`aria-labelledby="${card.nameId}" aria-describedby="${card.descId} ${card.reqId}"`);
		expect(html).toContain(`<span class="stonetop-levelup-move-name" id="${card.nameId}">Harden</span>`);
		expect(html).toContain(`id="${card.descId}"`);
	});

	it("finds the focused control again after a redraw", () => {
		const { dlg } = makeDialog();
		const card = { dataset: { compendiumId: "p1" }, matches: sel => sel === ".stonetop-levelup-pickable" };
		const check = { dataset: {}, matches: sel => sel === ".stonetop-levelup-locked-check" };
		dlg.element = [{ contains: () => true }];
		expect(dlg._focusSelectorFor(card)).toBe('.stonetop-levelup-pickable[data-compendium-id="p1"]');
		expect(dlg._focusSelectorFor(check)).toBe(".stonetop-levelup-locked-check");
		dlg.element = [{ contains: () => false }];
		expect(dlg._focusSelectorFor(card)).toBeNull();
	});

	it("after Apply, focus goes to a window that opened, else the sheet's Level field", async () => {
		const handlers = {};
		const hooks = { on: (name, fn) => { handlers[name] = fn; return name; }, off: vi.fn() };
		let fire;
		const setTimer = fn => { fire = fn; };
		const focused = [];
		const el = name => ({ name, focus: () => focused.push(name) });
		const root = map => ({ querySelector: sel => map[sel] ?? null });
		const sheet = { rendered: true, element: [root({ "input[name='system.attributes.level.value']": el("level") })] };
		const editor = { rendered: true, popOut: true, element: [root({ "[data-autofocus]": null, [FOCUS_ANY]: el("editor-first") })] };
		// The chat log and notifications redraw as applications too; they are not windows (live run).
		const chatLog = { rendered: true, popOut: false, element: [root({ [FOCUS_ANY]: el("chat") })] };
		const notices = { rendered: true, hasFrame: false, element: [root({ [FOCUS_ANY]: el("notices") })] };

		let done = focusNextWindow({ fallback: sheet, fallbackSelector: "input[name='system.attributes.level.value']", hooks, setTimer });
		handlers.renderApplication(sheet); // the sheet's own redraw is not a new window
		handlers.renderApplication(editor);
		handlers.renderApplication(chatLog);
		handlers.renderApplicationV2(notices);
		fire();
		await done;
		expect(focused).toEqual(["editor-first"]);

		done = focusNextWindow({ fallback: sheet, fallbackSelector: "input[name='system.attributes.level.value']", hooks, setTimer });
		fire();
		await done;
		expect(focused).toEqual(["editor-first", "level"]);
		expect(hooks.off).toHaveBeenCalled();
		expect(focusInto(null)).toBeNull();
	});
});

// The FOCUSABLE selector, as the fake root above is keyed by it.
import { FOCUSABLE as FOCUS_ANY } from "../../../module/utils/focus-window.js";
