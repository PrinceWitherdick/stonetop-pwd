// End-to-end level-up climb: drives the REAL StonetopCharacter level-up engine
// (getLevelUpData → applyLevelUp) for every playbook from level 1 until the playbook's
// advancement options are exhausted — Stonetop has no maximum level (Book I, "Playing
// the Game": "There is no maximum level"), so "max level" is reaching the point where no
// pickable move remains. At every step it picks a valid move, supplies whatever
// selection the move demands (a stat for Improved/Superior Stat, a foreign move for the
// cross-playbook moves, an invocation on the Lightbearer's even levels), and asserts the
// pick was applied. This is the integration counterpart to the focused unit tests in
// StonetopCharacter.statIncrease / .crossPlaybook / dialogs.LevelUpDialog.

import { describe, it, expect, vi } from "vitest";
import {
	buildLiveCharacter, moveCount, ownedMoveNames, sourceMovesFor,
} from "../../fakes/LiveCharacter.js";
import { PLAYBOOKS, STAT_KEYS } from "../../fakes/sourcePack.js";
import { moveMarkBudget } from "../../../module/actors/character/move-mark-budget.js";


// Resolve whatever selection the picked move demands at acquisition: a stat for
// Improved/Superior Stat, a foreign move for cross-playbook moves, or the mark picks for a
// budgeted move (Veteran Crew / Heroes to the Last / Beast of Legend / Well Versed).
async function choicesFor(char, pick, newLevel, actor) {
	if (pick.cap != null) {
		// Improved/Superior Stat: raise a stat that's still below this move's cap.
		const stat = STAT_KEYS.find(k => (actor.system.stats[k]?.value ?? 0) < pick.cap) ?? "str";
		return { stat, cap: pick.cap };
	}
	if (pick.crossPlaybook) {
		const foreign = await char.getForeignMovesForLevelUp(pick.crossPlaybook, newLevel);
		return {
			crossPlaybook: true,
			foreignMoveId: foreign[0]?.compendiumId ?? null,
			grantsPossession: pick.crossPlaybook.grantsPossession ?? null,
		};
	}
	const choices = {};
	// A budgeted count-mark move just picked (Veteran Crew / Heroes to the Last / Beast of
	// Legend / Well Versed): spend this take's allowance on the first count options.
	if (pick.markOptions?.length) {
		const countOpts = pick.markOptions.filter(o => o.choice !== "stat");
		const allowance = moveMarkBudget(pick.markBudget, (pick.ownedIds?.length ?? 0) + 1) ?? 0;
		const picks = countOpts.slice(0, allowance).map(o => ({ slug: o.slug }));
		if (picks.length) choices.marks = { moveName: pick.name, picks };
	}
	return Object.keys(choices).length ? choices : null;
}

// One level-up: pick the first available move, make every required selection, apply, and
// assert the step landed (level +1, XP deducted, a move gained, selection recorded).
async function levelUpOnce(char, actor) {
	const data = await char.getLevelUpData();
	if (data.availableMoves.length === 0) return null;

	const levelBefore = actor.system.attributes.level.value;
	const xpBefore    = actor.system.attributes.xp.value;
	const cost        = 6 + levelBefore * 2;
	const movesBefore = moveCount(actor);
	const statChoicesBefore = Object.keys(actor.getFlag("stonetop-pwd", "improvedStatChoices") ?? {}).length;

	const pick = data.availableMoves[0];
	const invocation = data.needsInvocation ? data.availableInvocations[0].slug : null;
	const choices = await choicesFor(char, pick, data.newLevel, actor);

	await char.applyLevelUp(pick.compendiumId, invocation, choices);

		// A supplied mark pick (a budgeted move, or Potential for Greatness) actually landed.
		if (choices?.marks?.picks?.length) {
			const allMarks = actor.getFlag("stonetop-pwd", "moves.moveMarks") ?? {};
			const total = Object.values(allMarks[choices.marks.moveName] ?? {})
				.reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
			expect(total).toBeGreaterThan(0);
		}

	// Level + XP bookkeeping (cost = 6 + 2·level, per Book I).
	expect(actor.system.attributes.level.value).toBe(levelBefore + 1);
	expect(actor.system.attributes.xp.value).toBe(Math.max(0, xpBefore - cost));
	// A move was always gained.
	expect(moveCount(actor)).toBeGreaterThan(movesBefore);

	// The move's demanded selection was actually committed.
	if (pick.cap != null) {
		const after = Object.keys(actor.getFlag("stonetop-pwd", "improvedStatChoices") ?? {}).length;
		expect(after).toBe(statChoicesBefore + 1);
	}
	if (pick.crossPlaybook && choices.foreignMoveId) {
		const tagged = actor.items.some(i => i.flags?.["stonetop-pwd"]?.grantedBy?.move === pick.name);
		expect(tagged).toBe(true);
	}
	if (invocation) {
		expect(actor.getFlag("stonetop-pwd", "invocations.selected") ?? []).toContain(invocation);
	}

	return { name: pick.name, level: data.newLevel, cap: pick.cap, cross: !!pick.crossPlaybook, invocation, marked: choices?.marks?.moveName ?? null };
}

// Names of every advanced move reachable WITHOUT crossing playbooks: its whole
// requirement.moves chain stays in-playbook and its stat gate is met by `finalStats`.
// (Level gates only delay a move, they don't make it unreachable.) These MUST all be
// owned once the climb exhausts the playbook — anything missing would be lost content.
function inHomeReachableAdvanced(playbookName, finalStats) {
	const docs = sourceMovesFor(playbookName);
	const byName = new Map(docs.map(d => [d.name, d]));
	const homeNames = new Set(docs.map(d => d.name));
	const statMet = (req) => !req?.stats || STAT_KEYS.every(k => (req.stats[k] ?? 0) <= (finalStats[k] ?? 0));

	const memo = new Map();
	const reachable = (doc, stack) => {
		if (memo.has(doc.name)) return memo.get(doc.name);
		if (stack.has(doc.name)) return false; // cyclic prereq → treat as unreachable
		stack.add(doc.name);
		const req = doc.system?.requirement;
		let ok = statMet(req);
		for (const r of (req?.moves ?? [])) {
			if (!homeNames.has(r)) { ok = false; break; }   // needs a foreign move
			if (!reachable(byName.get(r), stack)) { ok = false; break; }
		}
		stack.delete(doc.name);
		memo.set(doc.name, ok);
		return ok;
	};

	return new Set(docs.filter(d => !d.system?.isStartingMove && reachable(d, new Set())).map(d => d.name));
}

describe("StonetopCharacter level-up climb — every playbook to exhaustion", () => {
	for (const pb of PLAYBOOKS) {
		it(`${pb.name}: climbs from level 1 until no move remains, making every selection`, async () => {
			const { char, actor } = buildLiveCharacter({ slug: pb.slug, name: pb.name });
			// The Seeker's Initiate of the Secret Arts grants the Sacred Pouch possession;
			// possession wiring is tested separately, so stub it here.
			vi.spyOn(char, "selectPossession").mockResolvedValue(undefined);

			const picks = [];
			for (let guard = 0; guard < 400; guard++) {
				const step = await levelUpOnce(char, actor);
				if (!step) break;
				picks.push(step);
			}

			const finalLevel = actor.system.attributes.level.value;
			const owned = new Set(ownedMoveNames(actor));
			const finalStats = Object.fromEntries(STAT_KEYS.map(k => [k, actor.system.stats[k].value]));

			// Exhausted: a further getLevelUpData offers nothing pickable, and every level
			// gained corresponds to exactly one pick.
			const exhausted = await char.getLevelUpData();
			expect(exhausted.availableMoves).toHaveLength(0);
			expect(picks).not.toHaveLength(0);
			expect(finalLevel).toBe(1 + picks.length);
			// Far beyond the level-6 "potent moves" tier — proving the climb really goes
			// "all the way up". (Smallest playbook exhausts in the mid-20s.)
			expect(finalLevel).toBeGreaterThanOrEqual(20);

			// "Not missing anything": every move reachable without crossing playbooks was
			// taken.
			const mustOwn = inHomeReachableAdvanced(pb.name, finalStats);
			const missed = [...mustOwn].filter(name => !owned.has(name));
			expect(missed).toEqual([]);

			// Anything still locked is locked ONLY because it needs a move from another
			// playbook that we never picked up (e.g. the Ranger's Alpha needs the Blessed's
			// Spirit Tongue) — never because a same-playbook advance got stranded.
			for (const locked of exhausted.lockedMoves) {
				const src = sourceMovesFor(pb.name).find(d => d.name === locked.name);
				const reqMoves = src?.system?.requirement?.moves ?? [];
				const homeNames = new Set(sourceMovesFor(pb.name).map(d => d.name));
				const crossOnlyPrereq = reqMoves.some(r => !owned.has(r) && !homeNames.has(r));
				expect(crossOnlyPrereq, `${pb.name} left "${locked.name}" locked without a cross-playbook reason`).toBe(true);
			}

			// Final stats are the DETERMINISTIC result of the standard creation array
			// (+2/+1/+1/0/0/-1, the +2 in STR) plus this climb's stat picks: Improved Stat ×3
			// raises the first stats still under +2 (DEX→+2, CON→+2, INT→+1), then Superior
			// Stat lifts STR to +3. Nothing exceeds the +3 Superior cap. (There is no
			// rules-canonical "max-level stat block" — a real player chooses which stats to
			// raise; these values follow from the test's "first stat under cap, STR-first"
			// strategy, so they pin the whole stat-application path end-to-end.)
			expect(finalStats).toEqual({ str: 3, dex: 2, con: 2, int: 1, wis: 0, cha: -1 });
			// The recorded stat-choice picks match the stat moves actually taken.
			expect(Object.keys(actor.getFlag("stonetop-pwd", "improvedStatChoices") ?? {}).length)
				.toBe(picks.filter(p => p.cap != null).length);

			// The mark step ran for every budgeted move taken (Veteran Crew / Heroes to the
			// Last / Beast of Legend / Well Versed).
			const allMarks = actor.getFlag("stonetop-pwd", "moves.moveMarks") ?? {};
			const markTotal = name => Object.values(allMarks[name] ?? {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
			for (const name of new Set(picks.filter(p => p.marked && p.marked === p.name).map(p => p.name))) {
				expect(markTotal(name), `${pb.name}: ${name} recorded no marks`).toBeGreaterThan(0);
			}
		});
	}
});

describe("StonetopCharacter level-up climb — per-rule guarantees", () => {
	const heavyMove = (name) => sourceMovesFor("The Heavy").find(d => d.name === name)._id;

	it("Improved Stat raises a stat only to +2, then Superior Stat lifts it to +3", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level: 6, stats: { str: 0 } });
		const improved = heavyMove("Improved Stat"); // cap 2
		const superior = heavyMove("Superior Stat"); // cap 3
		const str = () => actor.system.stats.str.value;

		await char.applyLevelUp(improved, null, { stat: "str", cap: 2 });
		expect(str()).toBe(1);
		await char.applyLevelUp(improved, null, { stat: "str", cap: 2 });
		expect(str()).toBe(2);
		await char.applyLevelUp(improved, null, { stat: "str", cap: 2 }); // already at cap → clamped
		expect(str()).toBe(2);
		await char.applyLevelUp(superior, null, { stat: "str", cap: 3 }); // Superior reaches +3
		expect(str()).toBe(3);

		// Each take recorded its own pick, keyed by the distinct new item id.
		expect(Object.values(actor.getFlag("stonetop-pwd", "improvedStatChoices"))).toEqual(["str", "str", "str", "str"]);
	});

	it("Ranger: a cross-playbook Worldly pick of Spirit Tongue unlocks Alpha (cross-playbook prerequisite)", async () => {
		const rangerId  = (name) => sourceMovesFor("The Ranger").find(d => d.name === name)._id;
		const spiritTongueId = sourceMovesFor("The Blessed").find(d => d.name === "Spirit Tongue")._id;

		// A level-6 Ranger who already has Wild Speech (Alpha's in-playbook prerequisite)
		// but not yet Spirit Tongue (its cross-playbook prerequisite).
		const { char, actor } = buildLiveCharacter({ slug: "the-ranger", name: "The Ranger", level: 6 });
		await char.addMove(rangerId("Wild Speech"));

		const before = await char.getLevelUpData();
		expect(before.availableMoves.map(m => m.name)).not.toContain("Alpha");
		expect(before.lockedMoves.map(m => m.name)).toContain("Alpha");

		// Take Worldly and learn Spirit Tongue from the Blessed.
		await char.applyLevelUp(rangerId("Worldly"), null, {
			crossPlaybook: true, foreignMoveId: spiritTongueId, grantsPossession: null,
		});
		const spiritTongue = actor.items.find(i => i.name === "Spirit Tongue");
		expect(spiritTongue).toBeTruthy();
		expect(spiritTongue.flags["stonetop-pwd"].grantedBy).toMatchObject({ move: "Worldly" });

		// Alpha is now learnable.
		const after = await char.getLevelUpData();
		expect(after.availableMoves.map(m => m.name)).toContain("Alpha");
	});

	it("Lightbearer: offers an invocation every even level and never re-offers a chosen or starting one", async () => {
		// Two starting invocations already chosen at creation.
		const seeded = ["bath-of-healing-light", "blinding-light"];
		const { char, actor } = buildLiveCharacter({
			slug: "the-lightbearer", name: "The Lightbearer",
			flags: { "invocations.selected": seeded },
		});

		const chosen = [];
		// Climb several levels; only even ones (newLevel 2,4,…) need an invocation.
		for (let i = 0; i < 6; i++) {
			const data = await char.getLevelUpData();
			const offered = data.availableInvocations.map(o => o.slug);
			if (data.needsInvocation) {
				// Never re-offers a starting or previously-chosen invocation.
				for (const s of [...seeded, ...chosen]) expect(offered).not.toContain(s);
				const pickInvo = offered[0];
				chosen.push(pickInvo);
				const move = data.availableMoves[0];
				const choices = move.cap != null ? { stat: "con", cap: move.cap } : null;
				await char.applyLevelUp(move.compendiumId, pickInvo, choices);
			} else {
				expect(data.newLevel % 2).toBe(1); // odd levels never ask for an invocation
				const move = data.availableMoves[0];
				const choices = move.cap != null ? { stat: "con", cap: move.cap } : null;
				await char.applyLevelUp(move.compendiumId, null, choices);
			}
		}

		const selected = actor.getFlag("stonetop-pwd", "invocations.selected");
		expect(selected).toEqual([...seeded, ...chosen]);
		expect(chosen.length).toBeGreaterThanOrEqual(3); // 3 even levels across 6 climbs
	});

	it("Seeker: Initiate of the Secret Arts learns a Blessed move and grants the Sacred Pouch", async () => {
		const initiateId = sourceMovesFor("The Seeker").find(d => d.name === "Initiate of the Secret Arts")._id;
		const { char, actor } = buildLiveCharacter({ slug: "the-seeker", name: "The Seeker", level: 2 });
		const grantSpy = vi.spyOn(char, "selectPossession").mockResolvedValue(undefined);

		const foreign = await char.getForeignMovesForLevelUp({ playbooks: ["The Blessed"] }, 3);
		expect(foreign.length).toBeGreaterThan(0);
		expect(foreign.every(m => m.playbook === "The Blessed")).toBe(true);

		await char.applyLevelUp(initiateId, null, {
			crossPlaybook: true, foreignMoveId: foreign[0].compendiumId, grantsPossession: "sacred-pouch",
		});

		expect(grantSpy).toHaveBeenCalledWith("sacred-pouch");
		const learned = actor.items.find(i => i.name === foreign[0].name);
		expect(learned.flags["stonetop-pwd"].grantedBy).toMatchObject({ move: "Initiate of the Secret Arts" });
	});
});
