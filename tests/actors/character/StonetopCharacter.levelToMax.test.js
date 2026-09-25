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
import { readRepo } from "../../fakes/css.js";


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
	// Never offered below its level gate: the source move's requirement.level is at most the
	// level this advance reaches.
	const pickSource = sourceMovesFor(data.playbookName).find(d => d._id === pick.compendiumId);
	expect(pickSource, `${pick.name} is a ${data.playbookName} move`).toBeTruthy();
	expect(pickSource.system?.requirement?.level ?? 1, `${pick.name} offered at level ${data.newLevel}`)
		.toBeLessThanOrEqual(data.newLevel);
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
	// A move was always gained, unless it replaced one (Book I p.529): then the original went.
	expect(ownedMoveNames(actor)).toContain(pick.name);
	if (pick.replaces) expect(ownedMoveNames(actor)).not.toContain(pick.replaces);
	else expect(moveCount(actor)).toBeGreaterThan(movesBefore);

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

	// The sheet's move budget holds at every step: one pick per level gained, no more, no fewer.
	// The other half of an "either X OR Y" taken here (the Fox's Skill at Arms, the Heavy's
	// Uncanny Reflexes) is one of those picks, not a second starting move the budget skips.
	const { movelist } = await char.buildSnapshot();
	expect(movelist.levelMovesShortfall, `${data.playbookName} short after ${pick.name} at level ${data.newLevel}`).toBe(0);
	expect(movelist.levelMovesOverage, `${data.playbookName} over after ${pick.name} at level ${data.newLevel}`).toBe(0);

	return { name: pick.name, level: data.newLevel, cap: pick.cap, cross: !!pick.crossPlaybook, invocation, marked: choices?.marks?.moveName ?? null };
}

// Names of every advanced move reachable WITHOUT crossing playbooks: its whole
// requirement.moves chain (and one of its requirement.anyMoves, if it has any) stays
// in-playbook and its stat gate is met by `finalStats`.
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
		const anyOf = req?.anyMoves ?? [];
		if (ok && anyOf.length) ok = anyOf.some(r => homeNames.has(r) && reachable(byName.get(r), stack));
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
			// taken. A move given up for its replacement (Bulwark, for A Mighty Rampart) was
			// taken too; it just isn't owned any more.
			const mustOwn = inHomeReachableAdvanced(pb.name, finalStats);
			const retired = new Set(actor.items.map(i => i.system?.replaces).filter(Boolean));
			const missed = [...mustOwn].filter(name => !owned.has(name) && !retired.has(name));
			expect(missed).toEqual([]);

			// Anything still locked is locked ONLY because it needs a move from another
			// playbook that we never picked up, never because a same-playbook advance got
			// stranded. (The Ranger's Alpha needs Wild Speech OR the Blessed's Spirit Tongue, so
			// the climb's Wild Speech unlocks it.)
			for (const locked of exhausted.lockedMoves) {
				const src = sourceMovesFor(pb.name).find(d => d.name === locked.name);
				const reqMoves = src?.system?.requirement?.moves ?? [];
				const anyOf = src?.system?.requirement?.anyMoves ?? [];
				const homeNames = new Set(sourceMovesFor(pb.name).map(d => d.name));
				const crossOnlyPrereq = reqMoves.some(r => !owned.has(r) && !homeNames.has(r)) ||
					(anyOf.length > 0 && anyOf.every(r => !owned.has(r) && !homeNames.has(r)));
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

	// Book: "You start with Ambush OR Skill at Arms; Danger Sense OR Perceptive" (the Fox), and
	// "Armored OR Uncanny Reflexes" (the Heavy). The half not started with is a level-up pick
	// like any other: offered, taken, counted, and not labelled a starting move.
	it.each([
		["the-fox", "The Fox", ["Ambush", "Danger Sense"], ["Skill at Arms", "Perceptive"]],
		["the-heavy", "The Heavy", ["Armored"], ["Uncanny Reflexes"]],
	])("%s: the climb takes the other half of each either/or as a level-up pick", async (slug, name, started, others) => {
		const { char, actor } = buildLiveCharacter({ slug, name });
		expect(ownedMoveNames(actor).filter(n => [...started, ...others].includes(n)).sort()).toEqual([...started].sort());
		vi.spyOn(char, "selectPossession").mockResolvedValue(undefined);
		const picks = [];
		for (let guard = 0; guard < 400; guard++) {
			const step = await levelUpOnce(char, actor);
			if (!step) break;
			picks.push(step.name);
		}
		for (const other of others) expect(picks).toContain(other);
		const { movelist } = await char.buildSnapshot();
		const label = n => movelist.playbookMoves.find(m => m.name === n);
		for (const n of started) expect(label(n).sourceLabel).toBe("Starting move");
		for (const n of others) expect(label(n)).toMatchObject({ owned: true, isStarting: false, sourceLabel: null });
	});

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

	// Book I, the Ranger's Alpha: "(Requires level 6+, and Wild Speech or Spirit Tongue)".
	// Either one unlocks it; neither leaves it locked.
	it("Ranger: Alpha needs Wild Speech OR Spirit Tongue, and either one unlocks it", async () => {
		const rangerId  = (name) => sourceMovesFor("The Ranger").find(d => d.name === name)._id;
		const spiritTongueId = sourceMovesFor("The Blessed").find(d => d.name === "Spirit Tongue")._id;

		// A level-6 Ranger with neither: Alpha is locked, and says what would unlock it.
		const neither = buildLiveCharacter({ slug: "the-ranger", name: "The Ranger", level: 6 });
		const locked = (await neither.char.getLevelUpData()).lockedMoves.find(m => m.name === "Alpha");
		expect(locked).toBeTruthy();
		expect(locked.requiresLabel).toBe("Wild Speech or Spirit Tongue; level 6+");

		// Wild Speech alone is enough.
		const { char: withWild } = buildLiveCharacter({ slug: "the-ranger", name: "The Ranger", level: 6 });
		await withWild.addMove(rangerId("Wild Speech"));
		expect((await withWild.getLevelUpData()).availableMoves.map(m => m.name)).toContain("Alpha");

		// So is Spirit Tongue alone, learned from the Blessed through Worldly.
		const { char, actor } = buildLiveCharacter({ slug: "the-ranger", name: "The Ranger", level: 6 });
		await char.applyLevelUp(rangerId("Worldly"), null, {
			crossPlaybook: true, foreignMoveId: spiritTongueId, grantsPossession: null,
		});
		const spiritTongue = actor.items.find(i => i.name === "Spirit Tongue");
		expect(spiritTongue).toBeTruthy();
		expect(spiritTongue.flags["stonetop-pwd"].grantedBy).toMatchObject({ move: "Worldly" });
		expect(ownedMoveNames(actor)).not.toContain("Wild Speech");
		expect((await char.getLevelUpData()).availableMoves.map(m => m.name)).toContain("Alpha");
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

// Book I p.529: "If a move replaces a different move, then it requires the one it
// replaces. If a player takes such a move, they lose the original move and any benefits it
// conferred." And p.528: "A move that requires a specific playbook is never available to
// other playbooks. No one but the Heavy can take Dangerous."
describe("StonetopCharacter level-up — replacing moves and playbook-locked moves", () => {
	const judgeMove = (name) => sourceMovesFor("The Judge").find(d => d.name === name)._id;

	it("taking A Mighty Rampart gives up Bulwark, which is not offered again", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-judge", name: "The Judge", level: 5 });
		await char.applyLevelUp(judgeMove("Bulwark"), null, null);
		expect(ownedMoveNames(actor)).toContain("Bulwark");

		await char.applyLevelUp(judgeMove("A Mighty Rampart"), null, null);

		expect(ownedMoveNames(actor)).toContain("A Mighty Rampart");
		expect(ownedMoveNames(actor)).not.toContain("Bulwark");
		const data = await char.getLevelUpData();
		const offered = [...data.availableMoves, ...data.lockedMoves].map(m => m.name);
		expect(offered).not.toContain("Bulwark");
	});

	it("un-ticking A Mighty Rampart hands Bulwark back", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-judge", name: "The Judge", level: 5 });
		await char.applyLevelUp(judgeMove("Bulwark"), null, null);
		await char.applyLevelUp(judgeMove("A Mighty Rampart"), null, null);
		const rampart = actor.items.find(i => i.name === "A Mighty Rampart");

		await char.removeMove(rampart._id);

		expect(ownedMoveNames(actor)).toContain("Bulwark");
		expect(ownedMoveNames(actor)).not.toContain("A Mighty Rampart");
	});

	it("a replacing move ticked without its original retires nothing, so un-ticking it restores nothing", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-judge", name: "The Judge", level: 6 });
		const rampart = await char.addMove(judgeMove("A Mighty Rampart"));
		await char.removeMove(rampart._id);
		expect(ownedMoveNames(actor)).not.toContain("Bulwark");
	});

	it("a Would-be Hero can't take Big Damn Hero without In Over Your Head", async () => {
		const wbhMove = (name) => sourceMovesFor("The Would-Be Hero").find(d => d.name === name)._id;
		const { char, actor } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero", level: 6 });
		expect(ownedMoveNames(actor)).not.toContain("In Over Your Head");

		let data = await char.getLevelUpData();
		expect(data.availableMoves.map(m => m.name)).not.toContain("Big Damn Hero");
		const locked = data.lockedMoves.find(m => m.name === "Big Damn Hero");
		expect(locked.requiresLabel).toBe("level 6+; replaces In Over Your Head");

		await char.applyLevelUp(wbhMove("In Over Your Head"), null, null);
		data = await char.getLevelUpData();
		expect(data.availableMoves.map(m => m.name)).toContain("Big Damn Hero");
	});

	it("a cross-playbook pick never offers Dangerous or Potential for Greatness", async () => {
		const { char } = buildLiveCharacter({ slug: "the-fox", name: "The Fox", level: 6 });
		const foreign = await char.getForeignMovesForLevelUp({ playbooks: "any" }, 7);
		const names = foreign.map(m => m.name);
		expect(names).not.toContain("Dangerous");
		expect(names).not.toContain("Potential for Greatness");
		expect(names.length).toBeGreaterThan(0);
	});
});

describe("StonetopCharacter.applyLevelUp — refuses a stale or unaffordable level-up", () => {
	const heavyMove = (name) => sourceMovesFor("The Heavy").find(d => d.name === name)._id;

	it("writes nothing when the character has left the level the choices were built for", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level: 3, xp: 50 });
		const before = moveCount(actor);

		const result = await char.applyLevelUp(heavyMove("Berserker"), null, null, { fromLevel: 2 });

		expect(result).toEqual({ applied: false, reason: "level" });
		expect(actor.system.attributes.level.value).toBe(3);
		expect(actor.system.attributes.xp.value).toBe(50);
		expect(moveCount(actor)).toBe(before);
	});

	it("writes nothing without the 6 + 2×level XP it costs", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level: 3, xp: 11 });
		const before = moveCount(actor);

		const result = await char.applyLevelUp(heavyMove("Berserker"), null, null, { fromLevel: 3 });

		expect(result).toEqual({ applied: false, reason: "xp" });
		expect(actor.system.attributes.level.value).toBe(3);
		expect(actor.system.attributes.xp.value).toBe(11);
		expect(moveCount(actor)).toBe(before);
	});

	it("spends exactly the cost when the XP is there", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level: 3, xp: 12 });

		const result = await char.applyLevelUp(heavyMove("Berserker"), null, null, { fromLevel: 3 });

		expect(result).toEqual({ applied: true });
		expect(actor.system.attributes.level.value).toBe(4);
		expect(actor.system.attributes.xp.value).toBe(0);
	});

	it("canLevelUp reads the 6 + 2×level threshold", () => {
		expect(buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level: 3, xp: 11 }).char.canLevelUp).toBe(false);
		expect(buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level: 3, xp: 12 }).char.canLevelUp).toBe(true);
	});
});

// Level Up step 4, Book I p.528: "If you are the Blessed (or have a sacred pouch) and your new
// level is even, increase your max Stock by 1."
describe("Sacred pouch max Stock grows at even levels, the Seeker's included", () => {
	const POUCH = "sacred-pouch";
	// The Seeker's pouch as the pack prints it: its growth rule is playbook data, not code.
	const seekerPouch = { options: JSON.parse(readRepo("packs/src/stonetop-items/playbooks/the-seeker.json"))
		.flags.stonetop.specialPossessions.options.filter(o => o.slug === POUCH) };
	const blessedPouch = { options: [{ slug: POUCH, resource: { max: 3 },
		usesBonus: { evenLevelBonus: 1, moveBonus: [{ moveName: "Big Magic", perInstance: 2 }] } }] };
	const seekerAt = (grantedAt) => buildLiveCharacter({
		slug: "the-seeker", name: "The Seeker",
		flags: grantedAt == null ? {} : { "possessions.grantedAtLevel": { [POUCH]: grantedAt } },
	}).char;
	const max = (char, possessions, level, owned = new Map()) =>
		char.computePossessionMaxUses(possessions, owned, level)[POUCH] ?? possessions.options[0].resource.max;

	it("the Blessed's matches the book's Blodwen: level 6 holds 6", () => {
		const { char } = buildLiveCharacter({ slug: "the-blessed", name: "The Blessed" });
		expect(max(char, blessedPouch, 6)).toBe(6);
	});

	it("the Seeker's starts at 3 and gains 1 at each even level from the one it arrived at", () => {
		const char = seekerAt(3);
		expect(max(char, seekerPouch, 3)).toBe(3);
		expect(max(char, seekerPouch, 4)).toBe(4);
		expect(max(char, seekerPouch, 5)).toBe(4);
		expect(max(char, seekerPouch, 6)).toBe(5);
	});

	it("taken on an even level-up, it gains that level's +1 at once (step 3 before step 4)", () => {
		expect(max(seekerAt(2), seekerPouch, 2)).toBe(4);
	});

	it("Big Magic learned through Initiate adds its +2", () => {
		const owned = new Map([["Big Magic", [{}]]]);
		expect(max(seekerAt(4), seekerPouch, 4, owned)).toBe(6);
	});

	// Granted before the level was recorded: counted from level 2, the first Initiate can be
	// taken at. Reading it flat left a level-8 Seeker at 3 Stock.
	it("a pouch with no recorded level counts from level 2, Initiate's earliest", () => {
		expect(max(seekerAt(null), seekerPouch, 8)).toBe(7);
		expect(max(seekerAt(null), seekerPouch, 3)).toBe(4);
	});

	it("Initiate of the Secret Arts records the level the pouch arrived at", async () => {
		const initiateId = sourceMovesFor("The Seeker").find(d => d.name === "Initiate of the Secret Arts")._id;
		const { char, actor } = buildLiveCharacter({ slug: "the-seeker", name: "The Seeker", level: 3 });
		vi.spyOn(char, "selectPossession").mockResolvedValue(undefined);
		await char.applyLevelUp(initiateId, null, { crossPlaybook: true, foreignMoveId: null, grantsPossession: POUCH });
		expect(actor.getFlag("stonetop-pwd", "possessions.grantedAtLevel")).toEqual({ [POUCH]: 4 });
	});

	it("sacredPouchMax works it out without a snapshot (the chat card's Spend button)", async () => {
		const { char } = buildLiveCharacter({ slug: "the-seeker", name: "The Seeker", level: 6,
			flags: { "possessions.grantedAtLevel": { [POUCH]: 4 } } });
		expect(await char.sacredPouchMax()).toBe(5);
	});
});

// Level Up step 5, Book I p.528: "If you are the Lightbearer (or have Invoke the Sun God) and
// your new level is even, choose a new invocation."
describe("Invocations for a character with Invoke the Sun God who isn't the Lightbearer", () => {
	const invokeTheSunGod = () => {
		const raw = sourceMovesFor("The Lightbearer").find(d => d.name === "Invoke the Sun God");
		return { name: raw.name, type: "move", system: structuredClone(raw.system) };
	};

	it("draws on the Lightbearer's list", async () => {
		const { char } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero", items: [invokeTheSunGod()] });
		const source = await char.invocationSource();
		expect(source.options.length).toBeGreaterThan(0);
	});

	it("has none without the move", async () => {
		const { char } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero" });
		expect(await char.invocationSource()).toBeNull();
	});

	it("is owed a new one on an even level", async () => {
		const { char } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero", level: 3, items: [invokeTheSunGod()] });
		const data = await char.getLevelUpData();
		expect(data.needsInvocation).toBe(true);
		expect(data.availableInvocations.length).toBeGreaterThan(0);
	});

	it("without the move, an even level still carries the list (for a pick of it this level) but asks for none", async () => {
		const { char } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero", level: 3 });
		const data = await char.getLevelUpData();
		expect(data.needsInvocation).toBe(false);
		expect(data.availableInvocations.length).toBeGreaterThan(0);
	});

	it("an odd level carries nothing", async () => {
		const { char } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero", level: 2, items: [invokeTheSunGod()] });
		const data = await char.getLevelUpData();
		expect(data.needsInvocation).toBe(false);
		expect(data.availableInvocations).toEqual([]);
	});
});

// The Ranger's Beast-Bonded background: "Mark 1 action at 1st level, then another at 3rd,
// 5th, 7th, and 9th."
describe("Beast-Bonded companion actions at level-up", () => {
	const ranger = ({ level, marked = [] }) => buildLiveCharacter({
		slug: "the-ranger", name: "The Ranger", level,
		flags: { "background.selected": "beast-bonded", "background.markedActions": marked },
	});

	it("asks for one more action on reaching 3rd level", async () => {
		const { char } = ranger({ level: 2, marked: ["call-back"] });
		const data = await char.getLevelUpData();
		expect(data.companionActions.allowance).toBe(1);
		expect(data.companionActions.options.find(o => o.slug === "call-back").marked).toBe(true);
	});

	it("asks for nothing on a level without one", async () => {
		const { char } = ranger({ level: 3, marked: ["call-back", "gauge-distance"] });
		expect((await char.getLevelUpData()).companionActions).toBeNull();
	});

	it("catches up an action skipped at an earlier level", async () => {
		const { char } = ranger({ level: 3, marked: ["call-back"] });
		expect((await char.getLevelUpData()).companionActions.allowance).toBe(1);
	});

	it("records the pick with the level-up", async () => {
		const { char, actor } = ranger({ level: 2, marked: ["call-back"] });
		const move = (await char.getLevelUpData()).availableMoves[0];
		await char.applyLevelUp(move.compendiumId, null, { companionActions: ["sense-emotion"] });
		expect(actor.getFlag("stonetop-pwd", "background.markedActions")).toEqual(["call-back", "sense-emotion"]);
	});
});

describe("A retired move learned through Versatile comes back as Versatile's", () => {
	it("keeps its Granted by when the replacing move is un-ticked, or its own Versatile is un-learned", async () => {
		const versatileId = sourceMovesFor("The Would-Be Hero").find(d => d.name === "Versatile")._id;
		const judge = (name) => sourceMovesFor("The Judge").find(d => d.name === name)._id;
		const { char, actor } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero", level: 5 });
		const cross = { crossPlaybook: true, grantsPossession: null };
		await char.applyLevelUp(versatileId, null, { ...cross, foreignMoveId: judge("Bulwark") });
		const v1 = actor.items.find(i => i.name === "Versatile");
		await char.applyLevelUp(versatileId, null, { ...cross, foreignMoveId: judge("A Mighty Rampart") });
		const v2 = actor.items.filter(i => i.name === "Versatile").find(i => i._id !== v1._id);
		expect(ownedMoveNames(actor)).not.toContain("Bulwark");

		// Un-learning the second Versatile takes its Rampart, which hands Bulwark back.
		await char.removeMove(v2._id);
		const bulwark = actor.items.find(i => i.name === "Bulwark");
		expect(bulwark).toBeTruthy();
		expect(ownedMoveNames(actor)).not.toContain("A Mighty Rampart");
		expect(bulwark.flags["stonetop-pwd"].grantedBy).toMatchObject({ move: "Versatile", instanceId: v1._id });
	});

	it("does not come back once the Versatile that granted it is gone", async () => {
		const versatileId = sourceMovesFor("The Would-Be Hero").find(d => d.name === "Versatile")._id;
		const judge = (name) => sourceMovesFor("The Judge").find(d => d.name === name)._id;
		const { char, actor } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero", level: 5 });
		const cross = { crossPlaybook: true, grantsPossession: null };
		await char.applyLevelUp(versatileId, null, { ...cross, foreignMoveId: judge("Bulwark") });
		const v1 = actor.items.find(i => i.name === "Versatile");
		await char.applyLevelUp(versatileId, null, { ...cross, foreignMoveId: judge("A Mighty Rampart") });
		const v2 = actor.items.filter(i => i.name === "Versatile").find(i => i._id !== v1._id);

		await char.removeMove(v1._id);
		await char.removeMove(v2._id);
		expect(ownedMoveNames(actor)).not.toContain("Bulwark");
		expect(ownedMoveNames(actor)).not.toContain("A Mighty Rampart");
	});
});
