// Level Up audit 2026-11-06 (L18): climbs through the real level-up engine (getLevelUpData, then
// applyLevelUp) for the picks the full climb never makes, each followed level by level:
// - a foreign move that asks its own marks (Beast of Legend through Wild Soul, Book I p.107, p.131);
// - Invoke the Sun God through Versatile (p.139), owed an Invocation at each even level (p.528 step 5);
// - Crew through Dabbler and Animal Companion through Wild Soul, each with its insert (pp.143-144);
// - the Seeker's Sacred Pouch through Initiate of the Secret Arts (p.134), +1 each even level (p.528 step 4);
// - a Beast-Bonded Ranger to all 5 actions: "Mark 1 action at 1st level, then another at 3rd, 5th,
//   7th, and 9th" (p.129), and nothing more after;
// - and the move budget when a replacing move and the move it replaces came by different routes
//   (L5, written against the intended rule: p.529 "they lose the original move", the pick stays spent).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLiveCharacter, ownedMoveNames, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { LevelUpDialog } from "../../../module/actors/character/dialogs/LevelUpDialog.js";

let priorSettings;
beforeEach(() => { priorSettings = game.settings; game.settings ??= { get: () => undefined }; });
afterEach(() => { game.settings = priorSettings; vi.restoreAllMocks(); });

const SCOPE = "stonetop-pwd";
const idOf = (playbook, name) => sourceMovesFor(playbook).find(d => d.name === name)._id;
const level = actor => actor.system.attributes.level.value;

// A level-up that takes the first move asking nothing of its own (no stat, no foreign move, no
// marks), with any companion action and Invocation owed, as the window would ask them.
async function plainLevelUp(char) {
	const data = await char.getLevelUpData();
	const pick = data.availableMoves.find(m => m.cap == null && !m.crossPlaybook && !m.markOptions?.length);
	const choices = {};
	if (data.companionActions) {
		choices.companionActions = data.companionActions.options.filter(o => !o.marked).slice(0, data.companionActions.allowance).map(o => o.slug);
	}
	const invocation = data.needsInvocation ? data.availableInvocations[0].slug : null;
	const result = await char.applyLevelUp(pick.compendiumId, invocation, Object.keys(choices).length ? choices : null);
	expect(result.applied).toBe(true);
	return data;
}

// A level-up through the character's own cross-playbook move, learning `foreignName`.
async function crossLevelUp(char, crossName, foreignName, { marks = null, withInvocation = false } = {}) {
	const data = await char.getLevelUpData();
	const cross = data.availableMoves.find(m => m.name === crossName);
	expect(cross, `${crossName} offered at level ${data.newLevel}`).toBeTruthy();
	const foreign = (await char.getForeignMovesForLevelUp(cross.crossPlaybook, data.newLevel)).find(m => m.name === foreignName);
	expect(foreign, `${foreignName} offered through ${crossName} at level ${data.newLevel}`).toBeTruthy();
	const choices = {
		crossPlaybook: true, foreignMoveId: foreign.compendiumId, grantsPossession: cross.crossPlaybook.grantsPossession ?? null,
		...(marks ? { marks: { moveName: foreignName, picks: marks.map(slug => ({ slug })) } } : {}),
	};
	const invocation = withInvocation ? data.availableInvocations[0].slug : null;
	const result = await char.applyLevelUp(cross.compendiumId, invocation, choices);
	expect(result.applied).toBe(true);
	return { data, cross, foreign };
}

async function budget(char) {
	const { movelist } = await char.buildSnapshot();
	return { short: movelist.levelMovesShortfall, over: movelist.levelMovesOverage };
}

describe("a foreign move with its own marks: Beast of Legend through Wild Soul", () => {
	it("the window asks its Ranger options, the pick lands, and the second take is offered", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-blessed", name: "The Blessed" });
		await crossLevelUp(char, "Wild Soul", "Animal Companion");                     // 2
		await crossLevelUp(char, "Wild Soul", "Magnificent Specimen");                 // 3
		while (level(actor) < 5) await plainLevelUp(char);

		// The level-6 window: Wild Soul's foreign step offers Beast of Legend, and its mark step
		// asks the Ranger's options (LevelUpDialog#_markStepDescriptor).
		const data = await char.getLevelUpData();
		const wildSoul = data.availableMoves.find(m => m.name === "Wild Soul");
		// Wild Soul has 2 boxes and both are taken: the third Ranger move needs another route.
		expect(wildSoul).toBeUndefined();
		const offered = await char.getForeignMovesForLevelUp({ playbooks: "any" }, 6);
		const beast = offered.find(m => m.name === "Beast of Legend");
		expect(beast.markOptions.map(o => o.slug)).toEqual(["exceptional", "tough", "unique"]);

		const dlg = new LevelUpDialog(char, data, vi.fn());
		dlg._selectedMoveId = "__agreed__";
		dlg._agreedMoves = offered;
		dlg._agreedLoaded = true;
		dlg._selectedAgreedId = beast.compendiumId;
		const step = dlg._markStepDescriptor();
		expect(step).toMatchObject({ moveName: "Beast of Legend", allowance: 1 });

		await char.applyLevelUp(null, null, { agreed: { foreignMoveId: beast.compendiumId }, marks: { moveName: "Beast of Legend", picks: [{ slug: "tough" }] } });
		const marks = actor.getFlag(SCOPE, "moves.moveMarks")?.["Beast of Legend"] ?? {};
		expect(marks.tough).toHaveLength(1);
		// Repeatable ("Each time you take this move, pick 1", 2 boxes): offered again, once held.
		const again = (await char.getForeignMovesForLevelUp({ playbooks: "any" }, 7)).find(m => m.name === "Beast of Legend");
		expect(again.ownedIds).toHaveLength(1);
		expect(await budget(char)).toEqual({ short: 0, over: 0 });
	});
});

describe("Invoke the Sun God through Versatile", () => {
	it("learns one Invocation at each even level from the one it was taken at", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero" });
		await plainLevelUp(char);                                                            // 2
		await plainLevelUp(char);                                                            // 3
		expect(actor.getFlag(SCOPE, "invocations.selected") ?? []).toHaveLength(0);
		const { data } = await crossLevelUp(char, "Versatile", "Invoke the Sun God", { withInvocation: true }); // 4
		expect(data.availableInvocations.length).toBeGreaterThan(0);
		const known = () => actor.getFlag(SCOPE, "invocations.selected") ?? [];
		expect(known()).toHaveLength(1);
		expect(actor.getFlag(SCOPE, "invocations.grantedAtLevel")).toBe(4);
		const asked = {};
		for (let lvl = 5; lvl <= 10; lvl++) {
			const step = await plainLevelUp(char);
			asked[step.newLevel] = step.needsInvocation;
		}
		expect(asked).toEqual({ 5: false, 6: true, 7: false, 8: true, 9: false, 10: true });
		expect(known()).toHaveLength(4);
		expect(new Set(known()).size).toBe(4);
		expect(await budget(char)).toEqual({ short: 0, over: 0 });
	});
});

describe("Crew and Animal Companion taken from another playbook", () => {
	it("a Fox's Crew through Dabbler draws on the Crew insert, and Veteran Crew's pick lands", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-fox", name: "The Fox" });
		expect(await char.crewSource()).toBeNull();
		await crossLevelUp(char, "Dabbler", "Crew");                                         // 2
		expect((await char.crewSource())?.availableTags?.length).toBeGreaterThan(0);
		await crossLevelUp(char, "Dabbler", "Veteran Crew", { marks: ["crew-hp"] });        // 3
		expect(actor.getFlag(SCOPE, "moves.moveMarks")?.["Veteran Crew"]?.["crew-hp"]).toHaveLength(1);
		expect(ownedMoveNames(actor).filter(n => n === "Dabbler")).toHaveLength(2);
		expect(await budget(char)).toEqual({ short: 0, over: 0 });
	});

	it("a Blessed's Animal Companion through Wild Soul draws on the Animal Companion insert", async () => {
		const { char } = buildLiveCharacter({ slug: "the-blessed", name: "The Blessed" });
		expect(await char.companionSource()).toBeNull();
		await crossLevelUp(char, "Wild Soul", "Animal Companion");                           // 2
		expect((await char.companionSource())?.types?.length).toBeGreaterThan(0);
		expect(await budget(char)).toEqual({ short: 0, over: 0 });
	});
});

describe("the Seeker's Sacred Pouch through Initiate of the Secret Arts", () => {
	it("arrives at the level it was taken and grows by 1 at each even level after", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-seeker", name: "The Seeker" });
		await plainLevelUp(char);                                                            // 2
		expect(await char.holdsPossession("sacred-pouch")).toBe(false);
		await crossLevelUp(char, "Initiate of the Secret Arts", "Spirit Tongue");            // 3
		expect(await char.holdsPossession("sacred-pouch")).toBe(true);
		expect(actor.getFlag(SCOPE, "possessions.grantedAtLevel")?.["sacred-pouch"]).toBe(3);
		const max = {};
		max[3] = await char.sacredPouchMax();
		while (level(actor) < 10) { await plainLevelUp(char); max[level(actor)] = await char.sacredPouchMax(); }
		// "3 Stock ... as per the Blessed", +1 at 4, 6, 8, 10.
		expect(max).toEqual({ 3: 3, 4: 4, 5: 4, 6: 5, 7: 5, 8: 6, 9: 6, 10: 7 });
		expect(await budget(char)).toEqual({ short: 0, over: 0 });
	});
});

describe("a Beast-Bonded Ranger climbs to all 5 companion actions", () => {
	it("one more at 3rd, 5th, 7th and 9th, and nothing after", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-ranger", name: "The Ranger",
			flags: { "background.selected": "beast-bonded", "background.markedActions": ["call-back"] },
		});
		const owed = {};
		while (level(actor) < 14) {
			const step = await plainLevelUp(char);
			owed[step.newLevel] = step.companionActions?.allowance ?? 0;
		}
		expect(owed).toEqual({ 2: 0, 3: 1, 4: 0, 5: 1, 6: 0, 7: 1, 8: 0, 9: 1, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0 });
		expect(actor.getFlag(SCOPE, "background.markedActions")).toHaveLength(5);
	});
});

describe("L5: the budget when a replacing move and its original came by different routes", () => {
	const rampart = () => idOf("The Judge", "A Mighty Rampart");
	const bulwark = () => idOf("The Judge", "Bulwark");

	it("Bulwark through Versatile, then A Mighty Rampart agreed with the table: one pick a level", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero" });
		await crossLevelUp(char, "Versatile", "Bulwark");                                    // 2
		while (level(actor) < 5) await plainLevelUp(char);
		await char.applyLevelUp(null, null, { agreed: { foreignMoveId: rampart() } });       // 6
		expect(ownedMoveNames(actor)).not.toContain("Bulwark");
		expect(await budget(char)).toEqual({ short: 0, over: 0 });
	});

	it("Bulwark agreed with the table, then A Mighty Rampart through Versatile: one pick a level, and the original comes back counted", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero" });
		await char.applyLevelUp(null, null, { agreed: { foreignMoveId: bulwark() } });       // 2
		while (level(actor) < 5) await plainLevelUp(char);
		await crossLevelUp(char, "Versatile", "A Mighty Rampart");                           // 6
		expect(ownedMoveNames(actor)).not.toContain("Bulwark");
		expect(await budget(char)).toEqual({ short: 0, over: 0 });

		// Un-learning that Versatile hands Bulwark back, still the level-2 pick it was: only
		// level 6's pick is now missing.
		await char.removeMove(actor.items.find(i => i.name === "Versatile")._id);
		expect(ownedMoveNames(actor)).toContain("Bulwark");
		expect(await budget(char)).toEqual({ short: 1, over: 0 });
	});
});
