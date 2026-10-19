// StonetopCharacter#setCreationMarks works out every pick in memory and writes ONCE. What it stores
// must be exactly what the old run of writes stored: one write per option taken off, then for each
// pick a setCountMark (budget, own boxes and the background's box clamped against the SAVED marks)
// and a second write stamping it. The old run is kept here, verbatim, as the reference.

import { describe, it, expect } from "vitest";
import { buildLiveCharacter, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { markEntries } from "../../../module/actors/character/pfg-marks.js";

const VETERAN_CREW = "Veteran Crew";
const WELL_VERSED  = "Well Versed";

// The sequential setCreationMarks this one replaced, through the character's own writers.
async function sequentialCreationMarks(char, moveName, optionSlugs, replaceLimit = Infinity) {
	const res = char.moveResources;
	const was = char._creationMarkEntries(moveName, replaceLimit);
	const bySlug = new Map();
	for (const { slug, index } of was) bySlug.set(slug, [...(bySlug.get(slug) ?? []), index]);
	for (const [slug, indexes] of bySlug) {
		const entries = markEntries(res.getMarks()[moveName]?.[slug]);
		for (const index of indexes.sort((a, b) => b - a)) entries.splice(index, 1);
		await char._actor.update(res.markUpdate(moveName, slug, entries));
	}
	for (const optionSlug of (optionSlugs ?? []).filter(Boolean)) {
		const current = markEntries(res.getMarks()[moveName]?.[optionSlug]).length;
		await char.setCountMark(moveName, optionSlug, current + 1);
		const entries = markEntries(res.getMarks()[moveName]?.[optionSlug]);
		if (entries.length <= current) continue;
		entries[entries.length - 1] = { ...entries[entries.length - 1], level: 1, creation: true };
		await char._actor.update(res.markUpdate(moveName, optionSlug, entries));
	}
}

const moveItem = (playbook, name) => {
	const doc = sourceMovesFor(playbook).find(d => d.name === name);
	return { name: doc.name, type: "move", system: structuredClone(doc.system) };
};

// A 3rd-level Marshal holding Veteran Crew `copies` times (a budget of one pick a copy), with
// onboarding's mark, a level-up mark, a box ticked by hand at 1st level, a legacy count, and another
// move's marks beside them.
const marshal = (copies = 2) => buildLiveCharacter({
	slug: "the-marshal", name: "The Marshal", level: 3, seedStartingMoves: false,
	items: Array.from({ length: copies }, () => moveItem("The Marshal", VETERAN_CREW)),
	flags: {
		"moves.moveMarks": {
			[VETERAN_CREW]: {
				tags: [{ stat: "", level: 1, creation: true }, { stat: "", level: 2 }],
				"crew-hp": [{ stat: "", level: 1 }],
				"crew-damage": 0,
			},
			"Potential for Greatness": { str: [{ stat: "str", level: 2 }] },
		},
	},
});

// A Patriot Seeker: Well Versed's Things Below is the background's box, outside the budget.
const patriot = moveMarks => buildLiveCharacter({
	slug: "the-seeker", name: "The Seeker",
	flags: {
		"background.selected": "patriot",
		"moves.backgroundAnswers": { [WELL_VERSED]: { label: "Well Versed in", value: "the Things Below" } },
		"moves.moveMarks": { [WELL_VERSED]: moveMarks },
	},
});

const storedFlags = actor => structuredClone(actor.flags["stonetop-pwd"]);

// Runs both on fresh copies of one fixture; the batched one must store the same and write once.
async function expectSameAsSequential(make, moveName, picks, replaceLimit) {
	const old = make();
	await sequentialCreationMarks(old.char, moveName, picks, replaceLimit);
	const now = make();
	await now.char.setCreationMarks(moveName, picks, replaceLimit);
	expect(storedFlags(now.actor)).toStrictEqual(storedFlags(old.actor));
	expect(now.actor.update).toHaveBeenCalledTimes(old.actor.update.mock.calls.length ? 1 : 0);
	return now.actor.getFlag("stonetop-pwd", "moves.moveMarks")?.[moveName];
}

describe("setCreationMarks stores what the old run of writes stored, in one write", () => {
	it("replaces onboarding's marks and clamps each pick against the ones before it", async () => {
		// Only the stamped tag goes (the hand-ticked crew-hp is not read as onboarding's once one is
		// stamped), so the level-2 tag and crew-hp leave one pick of 3: crew-damage takes it, the
		// second finds its one box taken, and the last two are past the budget.
		const marks = await expectSameAsSequential(() => marshal(3), VETERAN_CREW, ["crew-damage", "crew-damage", "tags", "crew-hp"]);
		expect(marks["crew-damage"]).toEqual([{ stat: "", level: 1, creation: true }]);
		expect(marks.tags).toEqual([{ stat: "", level: 2 }]);
		expect(marks["crew-hp"]).toEqual([{ stat: "", level: 1 }]);
		// With 2 copies the budget is already spent.
		expect((await expectSameAsSequential(() => marshal(2), VETERAN_CREW, ["crew-damage"]))["crew-damage"]).toEqual([]);
		// With 4, two picks of the same option each see the one before.
		expect((await expectSameAsSequential(() => marshal(4), VETERAN_CREW, ["tags", "tags", "tags"])).tags).toHaveLength(3);
	});

	it("frees budget by taking a mark off, for a pick that needs it", async () => {
		await expectSameAsSequential(marshal, VETERAN_CREW, ["crew-hp", "tags"]);
		await expectSameAsSequential(marshal, VETERAN_CREW, ["tags"], 1);
	});

	it("only clears on an empty list, and writes nothing when there is nothing to do", async () => {
		await expectSameAsSequential(marshal, VETERAN_CREW, []);
		await expectSameAsSequential(() => patriot({ fae: [{ stat: "", level: 3 }] }), WELL_VERSED, [""]);
	});

	it("refuses the background's box and keeps a legacy count's shape as setCountMark writes it", async () => {
		const marks = await expectSameAsSequential(() => patriot({ wild: 1 }), WELL_VERSED, ["things-below", "wild", "fae"]);
		expect(marks["things-below"]).toEqual([]);
		await expectSameAsSequential(() => patriot({ fae: [{ stat: "", level: 1 }] }), WELL_VERSED, ["makers"]);
	});
});
