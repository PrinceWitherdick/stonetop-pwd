// A homebrew playbook's own Level Up (the Familiar Face's "mark one of the following instead of the
// usual effect"): its advances marked at Level Up or by hand, what they do to max HP, the damage die
// and a stat, the level's move budget, and the Level Up window's steps for them.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";
import { STONETOP_SCOPE, HOMEBREW_ADVANCES_FLAG } from "../../../module/actors/character/StonetopFlags.js";
import { LevelUpDialog } from "../../../module/actors/character/dialogs/LevelUpDialog.js";
import { advancementToFlags } from "../../../module/playbooks/homebrew-bundle.js";

let priorSettings;
beforeEach(() => { priorSettings = game.settings; game.settings ??= { get: () => undefined }; });
afterEach(() => { game.settings = priorSettings; });

const OPTIONS = [
	"Increase one of your stats (to a max of +2).",
	"Increase your max HP to 22.",
	"Increase your damage die to a d10.",
	"Choose a new move from your playbook.",
	"Work with the GM to choose a move from any other playbook.",
	"Learn a song nobody else knows.",
];
const ADVANCEMENT = advancementToFlags({ replacesUsual: true, options: OPTIONS, note: "At level 3, you may change playbooks." });
const slugOf = kind => ADVANCEMENT.options.find(o => o.kind === kind).slug;

// The Fox, given a Level Up of its own, as a homebrew playbook carries one (StonetopPlaybook#advancement).
function foxWithAdvancement({ level = 1, stats, advancement = ADVANCEMENT } = {}) {
	const built = buildLiveCharacter({ slug: "the-fox", name: "The Fox", level, ...(stats ? { stats } : {}) });
	const repo = built.char._playbookRepo;
	built.char._playbookRepo = { findBySlug: async slug => ({ ...(await repo.findBySlug(slug)), advancement }) };
	return built;
}
const marked = actor => actor.flags?.[STONETOP_SCOPE]?.[HOMEBREW_ADVANCES_FLAG] ?? {};
const budget = async char => {
	const { movelist } = await char.buildSnapshot();
	return [movelist.levelMovesShortfall, movelist.levelMovesOverage];
};

describe("a homebrew playbook's own advances, on the character", () => {
	it("Level Up offers them, and the ones marked already; none once every one is marked", async () => {
		const { char, actor } = foxWithAdvancement();
		const data = await char.getLevelUpData();
		expect(data.advancement).toMatchObject({ replacesUsual: true, note: "At level 3, you may change playbooks." });
		expect(data.advancement.options.map(o => o.marked)).toEqual(OPTIONS.map(() => false));
		actor.flags[STONETOP_SCOPE] = { ...(actor.flags[STONETOP_SCOPE] ?? {}), [HOMEBREW_ADVANCES_FLAG]: Object.fromEntries(ADVANCEMENT.options.map(o => [o.slug, { level: 1 }])) };
		expect((await char.getLevelUpData()).advancement).toBeNull();
	});

	it("max HP to a number: the playbook's HP rises to it, and the level owes no move", async () => {
		const { char, actor } = foxWithAdvancement();
		const before = await char.computedMaxHp();
		const base = (await char.playbook()).hp;
		const res = await char.applyLevelUp(null, null, { advance: { slug: slugOf("hp") } }, { fromLevel: 1 });
		expect(res.applied).toBe(true);
		expect(marked(actor)[slugOf("hp")]).toEqual({ level: 2, atLevelUp: true });
		expect(await char.computedMaxHp()).toBe(before + (22 - base));
		expect(await budget(char)).toEqual([0, 0]);
	});

	it("a damage die: the die it names, unless something gives a bigger one", async () => {
		const { char } = foxWithAdvancement();
		await char.applyLevelUp(null, null, { advance: { slug: slugOf("damage") } }, { fromLevel: 1 });
		expect(await char.computedDamageDie()).toBe("d10");
	});

	it("a stat: raised by 1 to the advance's max, and lowered again when it is unmarked", async () => {
		const { char, actor } = foxWithAdvancement({ stats: { str: 1, dex: 2, int: 0, wis: 0, con: 1, cha: -1 } });
		await char.applyLevelUp(null, null, { advance: { slug: slugOf("stat"), stat: "str" } }, { fromLevel: 1 });
		expect(actor.system.stats.str.value).toBe(2);
		expect(marked(actor)[slugOf("stat")]).toMatchObject({ stat: "str", atLevelUp: true });
		await char.unmarkHomebrewAdvance(slugOf("stat"));
		expect(actor.system.stats.str.value).toBe(1);
		expect(marked(actor)[slugOf("stat")]).toBeUndefined();
	});

	it("won't raise a stat past the advance's max, and marks nothing then", async () => {
		const { char, actor } = foxWithAdvancement({ stats: { str: 1, dex: 2, int: 0, wis: 0, con: 1, cha: -1 } });
		globalThis.ui ??= {};
		ui.notifications = { warn: vi.fn() };
		expect(await char.markHomebrewAdvance(slugOf("stat"), { stat: "dex" })).toBe(false);
		expect(actor.system.stats.dex.value).toBe(2);
		expect(ui.notifications.warn).toHaveBeenCalledWith(expect.stringMatching(/already at \+2/));
	});

	it("an advance refused at Apply (its stat at the cap meanwhile) is named as failed, not passed off as done", async () => {
		const { char, actor } = foxWithAdvancement({ stats: { str: 1, dex: 2, int: 0, wis: 0, con: 1, cha: -1 } });
		globalThis.ui ??= {};
		ui.notifications = { warn: vi.fn() };
		const res = await char.applyLevelUp(null, null, { advance: { slug: slugOf("stat"), stat: "dex" } }, { fromLevel: 1 });
		expect(res.failed).toContain("advance");
		expect(marked(actor)[slugOf("stat")]).toBeUndefined();
	});

	it("taken beside the usual move (not replacing it), an advance is not that level's pick", async () => {
		const alongside = advancementToFlags({ replacesUsual: false, options: OPTIONS });
		const { char } = foxWithAdvancement({ advancement: alongside });
		await char.applyLevelUp(null, null, { advance: { slug: slugOf("hp") } }, { fromLevel: 1 });
		// The level's move is still owed.
		expect((await budget(char))[0]).toBe(1);
	});

	it("go with the playbook when it changes, a stat advance's +1 with them", async () => {
		const { char, actor } = foxWithAdvancement({ stats: { str: 1, dex: 0, int: 0, wis: 0, con: 1, cha: -1 } });
		await char.markHomebrewAdvance(slugOf("stat"), { stat: "str" });
		await char.markHomebrewAdvance(slugOf("hp"));
		expect(actor.system.stats.str.value).toBe(2);
		await char.clearPlaybookData("The Fox");
		expect(marked(actor)).toEqual({});
		expect(actor.system.stats.str.value).toBe(1);
	});

	it("marked by hand before play, an advance spends no level", async () => {
		const { char, actor } = foxWithAdvancement();
		expect(await char.markHomebrewAdvance(slugOf("note"))).toBe(true);
		expect(marked(actor)[slugOf("note")]).toEqual({ level: 1 });
		expect(await budget(char)).toEqual([0, 0]);
		// Marked once only.
		expect(await char.markHomebrewAdvance(slugOf("note"))).toBe(false);
	});
});

function makeDialog(advancement = { replacesUsual: true, note: "", options: ADVANCEMENT.options.map(o => ({ ...o, marked: false })) }) {
	const char = { applyLevelUp: vi.fn().mockResolvedValue({ applied: true }), getForeignMovesForLevelUp: vi.fn().mockResolvedValue([]) };
	const data = {
		level: 1, newLevel: 2, cost: 8, xp: 8, xpRemaining: 0, playbookName: "The Neighbour", needsInvocation: false,
		availableMoves: [{ compendiumId: "m1", name: "Gossip", description: "" }], lockedMoves: [], availableInvocations: [],
		stats: [{ key: "str", name: "Strength", abbr: "STR", value: 2 }, { key: "dex", name: "Dexterity", abbr: "DEX", value: 0 }],
		advancement,
	};
	const dlg = new LevelUpDialog(char, data, vi.fn());
	dlg.close = vi.fn();
	dlg.render = vi.fn();
	return { dlg, char };
}

describe("the Level Up window, for a playbook with its own advances", () => {
	it("asks for an advance first, and won't go on without one", () => {
		const { dlg } = makeDialog();
		expect(dlg._adjacentStep(+1)).toBe("advance");
		dlg._step = "advance";
		const ctx = dlg.getData();
		expect(ctx.isAdvance).toBe(true);
		expect(ctx.canContinue).toBe(false);
		expect(ctx.advanceStep.intro).toMatch(/instead of the usual new move/);
		expect(ctx.advanceStep.options.map(o => o.existingLabel)).toEqual([
			"Pick the stat next", "Max HP to 22", "Damage die d10", "Pick the move next", "Agree the move next", "The table settles it",
		]);
	});

	it("an advance marked at an earlier level can't be picked again", () => {
		const opts = ADVANCEMENT.options.map((o, i) => ({ ...o, marked: i === 1 }));
		const { dlg } = makeDialog({ replacesUsual: true, note: "", options: opts });
		dlg._step = "advance";
		const row = dlg.getData().advanceStep.options[1];
		expect(row.disabled).toBe(true);
		expect(row.existingLabel).not.toBe("Max HP to 22");
	});

	it("max HP: no move step, and Apply marks it with no move", async () => {
		const { dlg, char } = makeDialog();
		dlg._step = "advance";
		dlg._selectedAdvance = slugOf("hp");
		expect(dlg._adjacentStep(+1)).toBeUndefined();
		await dlg._apply();
		const [moveId, , choices] = char.applyLevelUp.mock.calls[0];
		expect(moveId).toBeNull();
		expect(choices).toEqual({ advance: { slug: slugOf("hp"), stat: null } });
	});

	it("a stat: the stat step, capped at the advance's max", async () => {
		const { dlg, char } = makeDialog();
		dlg._selectedAdvance = slugOf("stat");
		dlg._step = "advance";
		expect(dlg._adjacentStep(+1)).toBe("advanceStat");
		dlg._step = "advanceStat";
		const ctx = dlg.getData();
		expect(ctx.isStat).toBe(true);
		expect(ctx.statCap).toBe(2);
		expect(ctx.statOptions.find(s => s.key === "str").atCap).toBe(true);
		dlg._selectedAdvanceStat = "dex";
		await dlg._apply();
		expect(char.applyLevelUp.mock.calls[0][2]).toEqual({ advance: { slug: slugOf("stat"), stat: "dex" } });
	});

	it("a stat advance taken beside Improved Stat (not replacing the move) asks each for its own stat", async () => {
		const { dlg, char } = makeDialog({ replacesUsual: false, note: "", options: ADVANCEMENT.options.map(o => ({ ...o, marked: false })) });
		dlg._data.availableMoves = [{ compendiumId: "imp", name: "Improved Stat", description: "", cap: 2 }];
		dlg._selectedAdvance = slugOf("stat");
		dlg._step = "advanceStat";
		dlg._selectedAdvanceStat = "dex";
		dlg._selectedMoveId = "imp";
		dlg._step = "move";
		expect(dlg._adjacentStep(+1)).toBe("stat");
		dlg._step = "stat";
		const ctx = dlg.getData();
		// The move's own cap, its own pick, and the advance's +1 to DEX already counted.
		expect(ctx.statCap).toBe(2);
		expect(ctx.statOptions.find(s => s.key === "dex").value).toBe(1);
		expect(ctx.statOptions.some(s => s.selected)).toBe(false);
		dlg._selectedStat = "dex";
		await dlg._apply();
		expect(char.applyLevelUp.mock.calls[0][2]).toEqual({ advance: { slug: slugOf("stat"), stat: "dex" }, stat: "dex", cap: 2 });
	});

	it("a move from this playbook: the move step; from another: the agreed step", () => {
		const { dlg } = makeDialog();
		dlg._selectedAdvance = slugOf("move");
		dlg._step = "advance";
		expect(dlg._adjacentStep(+1)).toBe("move");
		dlg._selectedAdvance = slugOf("otherMove");
		dlg._selectedMoveId = "__agreed__";
		expect(dlg._adjacentStep(+1)).toBe("agreed");
	});

	it("a playbook whose advances come on top of the move keeps the move step", () => {
		const { dlg } = makeDialog({ replacesUsual: false, note: "", options: ADVANCEMENT.options.map(o => ({ ...o, marked: false })) });
		dlg._selectedAdvance = slugOf("hp");
		dlg._step = "advance";
		expect(dlg._adjacentStep(+1)).toBe("move");
	});

	it("the book's Level Up is untouched", () => {
		const { dlg } = makeDialog(null);
		expect(dlg._adjacentStep(+1)).toBe("move");
	});
});

// The Standout's "When you Level Up, switch to a different playbook": a playbook to start on.
describe("a playbook whose Level Up switches to a different playbook", () => {
	const SWITCH = advancementToFlags({ switchPlaybook: true, note: "When you Level Up, switch to a different playbook.", options: [] });

	it("Level Up hears of it, with no advances to mark", async () => {
		const built = buildLiveCharacter({ slug: "the-fox", name: "The Fox" });
		const repo = built.char._playbookRepo;
		built.char._playbookRepo = { findBySlug: async slug => ({ ...(await repo.findBySlug(slug)), advancement: SWITCH }) };
		expect((await built.char.getLevelUpData()).advancement).toEqual({ switchPlaybook: true, replacesUsual: false, note: SWITCH.note, options: [] });
	});

	it("the window: no move step, the switch step is the last, and Apply takes the level and says to switch", async () => {
		const { dlg, char } = makeDialog({ switchPlaybook: true, replacesUsual: false, note: SWITCH.note, options: [] });
		expect(dlg._adjacentStep(+1)).toBe("advance");
		dlg._step = "advance";
		const ctx = dlg.getData();
		expect(ctx.isLastStep).toBe(true);
		expect(ctx.canContinue).toBe(true);
		expect(ctx.advanceStep.intro).toMatch(/switch to a different playbook/);
		expect(ctx.applyLabel).toBe("Level Up and pick a playbook");
		await dlg._apply();
		const [moveId, , choices] = char.applyLevelUp.mock.calls[0];
		expect(moveId).toBeNull();
		expect(choices).toBeNull();
		expect(dlg._onDone).toHaveBeenCalledWith(null, expect.objectContaining({ applied: true, switchPlaybook: true }));
	});
});

describe("a homebrew special possession that raises max HP and the damage die", () => {
	it("counts while held, and not before", async () => {
		const built = buildLiveCharacter({ slug: "the-fox", name: "The Fox" });
		const repo = built.char._playbookRepo;
		const det = { slug: "determination", label: "Determination", description: "increase your damage to a d8 and your max HP by 4", hpBonus: 4, damageDie: "d8" };
		built.char._playbookRepo = { findBySlug: async slug => {
			const pb = await repo.findBySlug(slug);
			return { ...pb, damage: "d6", specialPossessions: { ...pb.specialPossessions, options: [...(pb.specialPossessions?.options ?? []), det] } };
		} };
		const hp = await built.char.computedMaxHp();
		expect(await built.char.computedDamageDie()).toBe("d6");
		await built.char.selectPossession("determination");
		expect(await built.char.computedMaxHp()).toBe(hp + 4);
		expect(await built.char.computedDamageDie()).toBe("d8");
	});
});
