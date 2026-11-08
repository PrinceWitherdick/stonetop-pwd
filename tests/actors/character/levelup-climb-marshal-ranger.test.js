import { describe, expect, it } from "vitest";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";
import { moveMarkBudget } from "../../../module/actors/character/move-mark-budget.js";
import { crewIsExceptional, crewIsInured } from "../../../module/actors/character/follower-masters.js";

// Level Up audit 2026-11-06, PBB-7 / L18: two climbs end to end through the real engine
// (getLevelUpData, then applyLevelUp), checking the level-tied rules at every step.
//  - The Marshal through Veteran Crew twice and Heroes to the Last twice, "Each time you take this move,
//    pick 1" (Book I pp.126-127), each option once: the crew's line at the end.
//  - A Beast-Bonded Ranger from 1st level to 12th: "Mark 1 action at 1st level, then another at 3rd,
//    5th, 7th, and 9th" (Book I p.129), and nothing after.

const marks = actor => actor.getFlag(STONETOP_SCOPE, "moves.moveMarks") ?? {};

// A move with no choice of its own to make (no stat, no foreign pick, no marks), first by name order.
const plain = moves => moves.find(m => m.cap == null && !m.crossPlaybook && !m.markOptions?.length);

async function budgetHolds(char, label) {
	const { movelist } = await char.buildSnapshot();
	expect(movelist.levelMovesShortfall, `${label}: short`).toBe(0);
	expect(movelist.levelMovesOverage, `${label}: over`).toBe(0);
}

describe("the Marshal through Veteran Crew and Heroes to the Last, twice each", () => {
	// The take, at the level it is taken, and the pick made for it (null: a move with no marks).
	const PLAN = [
		[2, "Veteran Crew", "tags"],
		[3, "Veteran Crew", "crew-damage"],
		[4, "Speak Softly", null],
		[5, "Take the Measure", null],
		[6, "Heroes to the Last", "exceptional"],
		[7, "Heroes to the Last", "crew-hp"],
	];

	it("asks one pick per take, each option once, and the crew's line adds up", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-marshal", name: "The Marshal", level: 1,
			flags: { crew: { name: "The Wolves", tags: ["brave", "hardy"], instinct: "To take needless risks", cost: "Merry-making, as a group" } },
		});
		for (const [level, name, slug] of PLAN) {
			const data = await char.getLevelUpData();
			expect(data.newLevel).toBe(level);
			const entry = data.availableMoves.find(m => m.name === name);
			expect(entry, `${name} offered at level ${level}`).toBeTruthy();
			// "(Requires level 6+ and Veteran Crew)": never offered before 6th.
			if (level < 6) expect(data.availableMoves.map(m => m.name)).not.toContain("Heroes to the Last");
			if (slug) {
				// The mark step's allowance: the budget this take reaches, less the marks already made.
				const used = Object.values(marks(actor)[name] ?? {}).reduce((n, v) => n + v.length, 0);
				expect(moveMarkBudget(entry.markBudget, entry.ownedIds.length + 1) - used, `${name} at ${level}`).toBe(1);
				// An option already taken has no box left (each once, as printed).
				for (const [taken, list] of Object.entries(marks(actor)[name] ?? {})) {
					const opt = entry.markOptions.find(o => o.slug === taken);
					expect(list.length).toBe(opt.marks);
				}
			}
			const result = await char.applyLevelUp(entry.compendiumId, null,
				slug ? { marks: { moveName: name, picks: [{ slug }] } } : null);
			expect(result.applied).toBe(true);
			await budgetHolds(char, `${name} at ${level}`);
		}

		// Each pick noted at the level it was taken.
		expect(marks(actor)["Heroes to the Last"]).toEqual({
			exceptional: [expect.objectContaining({ level: 6 })], "crew-hp": [expect.objectContaining({ level: 7 })],
		});
		// Both moves are now held as many times as they print boxes, so neither is offered again.
		const next = await char.getLevelUpData();
		expect(next.availableMoves.map(m => m.name)).not.toContain("Veteran Crew");
		expect(next.availableMoves.map(m => m.name)).not.toContain("Heroes to the Last");

		// HP 6 each (insert p.144) +4 (Heroes); d6 to d8 (Veteran Crew); +2 when exceptional; 2 tags owed more.
		const stats = await char._crewStatsFor(await char.playbook(), char._buildOwnedMovesMap());
		expect(stats).toMatchObject({ memberHp: 10, damageDie: "d8", rollMod: 2, tagBonus: 2 });
		expect(crewIsExceptional(actor)).toBe(true);
		expect(crewIsInured(actor)).toBe(false);
	});
});

describe("a Beast-Bonded Ranger from 1st level to 12th", () => {
	it("is asked for one more companion action at 3rd, 5th, 7th and 9th, and never again", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-ranger", name: "The Ranger", level: 1,
			flags: { "background.selected": "beast-bonded", "background.markedActions": ["call-back"] },
		});
		const askedAt = [];
		for (let level = 2; level <= 12; level++) {
			const data = await char.getLevelUpData();
			expect(data.newLevel).toBe(level);
			const companionActions = data.companionActions
				? data.companionActions.options.filter(o => !o.marked).slice(0, data.companionActions.allowance).map(o => o.slug)
				: null;
			if (companionActions) {
				expect(data.companionActions.allowance, `allowance at ${level}`).toBe(1);
				askedAt.push(level);
			}
			const move = plain(data.availableMoves);
			expect(move, `a move to take at ${level}`).toBeTruthy();
			const result = await char.applyLevelUp(move.compendiumId, null, companionActions ? { companionActions } : null);
			expect(result.applied).toBe(true);
			const marked = actor.getFlag(STONETOP_SCOPE, "background.markedActions");
			expect(marked.length, `actions marked at ${level}`).toBe(1 + askedAt.length);
		}
		expect(askedAt).toEqual([3, 5, 7, 9]);
		expect(new Set(actor.getFlag(STONETOP_SCOPE, "background.markedActions")).size).toBe(5);
	});
});
