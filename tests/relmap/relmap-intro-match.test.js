import { describe, it, expect } from "vitest";
import {
	applyIntroPicks, applyPicksToFlagList, hasIntroAnswers, introAnswerRows, rowKey,
} from "../../module/relmap/relmap-intro-match.js";

// Matching introduction answers to the people they are about, on a world that ran its session zero
// before the answer step learned to ask.
//
// What has to hold: the rows are the same answers the Chronicle reads (through its reader, not a
// second walk of the blob), each one knows the slot it came out of so it can be written back, the
// guess is offered and never applied by itself, and a pick lands on the right record whichever of
// the three shapes an answer is stored in.

/** One PC as the Chronicle describes them. "the-fox" is a real slug, so the indexes resolve. */
const pc = (id, name, slug = "the-fox") => ({ id, uuid: `Actor.${id}`, name, slug });

const PIM = pc("pim", "Pim");
const SELA = pc("sela", "Sela");
const MARREC = pc("marrec", "Marrec");
const PARTY = [PIM, SELA, MARREC];

const say = (q, a, who) => (who ? { q, a, who } : { q, a });

describe("is there anything to match", () => {
	it("says so when somebody has recorded an answer", () => {
		expect(hasIntroAnswers(PARTY, { pim: { step6: { answers: [say(0, "Sela.")] } } })).toBe(true);
		expect(hasIntroAnswers(PARTY, { pim: { r4: say(0, "Sela.") } })).toBe(true);
	});

	// The button this gates would open an empty window on a world that never ran session zero.
	it("says no on a world with nothing recorded", () => {
		expect(hasIntroAnswers(PARTY, {})).toBe(false);
		expect(hasIntroAnswers(PARTY, { pim: { r1: "Just an introduction." } })).toBe(false);
		expect(hasIntroAnswers(PARTY, { pim: { step6: { answers: [say(0, "   ")] } } })).toBe(false);
		expect(hasIntroAnswers()).toBe(false);
	});
});

describe("every answer as a row to be matched", () => {
	it("offers the name the writing gives, as a guess", () => {
		const rows = introAnswerRows(PARTY, {
			pim: { step6: { answers: [say(0, "Sela, of course. She held the ladder.")] } },
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			writerId: "pim", writerName: "Pim", step: "step6",
			prompt: "Which one of you joined me in my latest hijinx?",
			who: "", guess: "sela", target: "sela",
		});
	});

	// ⚠ THE GUESS IS AN OFFER. Nothing is recorded until somebody saves, so `who` stays empty and
	// `target` is only what a control should START on.
	it("keeps the guess apart from what is recorded", () => {
		const rows = introAnswerRows(PARTY, {
			pim: { step6: { answers: [say(0, "Sela, of course.")] } },
		});
		expect(rows[0].who).toBe("");
		expect(rows[0].guess).toBe("sela");
	});

	// A pick somebody made is an answer, and is not re-guessed at every time the window opens.
	it("shows a recorded pick as recorded, and guesses nothing over it", () => {
		const rows = introAnswerRows(PARTY, {
			pim: { step6: { answers: [say(0, "Sela told me Marrec would never.", "marrec")] } },
		});
		expect(rows[0]).toMatchObject({ who: "marrec", guess: "", target: "marrec" });
	});

	// An answer about somebody outside the party is a row like any other, sitting on nobody. A list
	// that hid what it could not guess at would leave the reader wondering what it had decided.
	it("lists an answer that names nobody at the table", () => {
		const rows = introAnswerRows(PARTY, {
			pim: { step4: { answers: [say(0, "My sister Maeve, who took me in.")] } },
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ guess: "", target: "" });
	});

	// ⚠ THE SLOT TRAVELS WITH THE ANSWER, which is the whole of what makes a row writable again.
	it("says which slot each answer came out of", () => {
		const rows = introAnswerRows(PARTY, {
			pim: {
				step4: { answers: [say(0, "Sela. We were raised together."), say(1, "Marrec, always.")] },
				r6: say(0, "Sela, when nobody else would."),
			},
		});
		expect(rows.map(row => row.at)).toEqual([
			{ source: "step4", index: 0 },
			{ source: "step4", index: 1 },
			{ source: "r6", index: null },
		]);
		expect(rows[0].key).toBe(rowKey("pim", { source: "step4", index: 0 }));
		expect(new Set(rows.map(row => row.key)).size).toBe(3);
	});

	// ⚠ THROUGH THE CHRONICLE'S OWN READER, so the matcher cannot offer a row nothing draws: a
	// legacy round that duplicates a step entry is ONE answer, and is asked about once.
	it("asks once about an answer recorded twice", () => {
		const rows = introAnswerRows(PARTY, {
			pim: {
				step4: { answers: [say(0, "Sela. We were raised together.")] },
				r4: say(0, "Sela. We were raised together."),
			},
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].at).toEqual({ source: "step4", index: 0 });
	});

	// A pick left behind by a character who has since gone reads as nothing rather than as a target
	// off the board: the row falls back to the writing, which is what the map does too.
	it("ignores a pick that names nobody in the party", () => {
		const rows = introAnswerRows(PARTY, {
			pim: { step6: { answers: [say(0, "Sela, of course.", "gone-away")] } },
		});
		expect(rows[0]).toMatchObject({ who: "", guess: "sela" });
	});

	it("survives a party with nothing recorded, and no party at all", () => {
		expect(introAnswerRows(PARTY, {})).toEqual([]);
		expect(introAnswerRows()).toEqual([]);
	});
});

describe("writing the picks back", () => {
	const answers = () => ({
		pim: {
			step4: { answers: [say(0, "Sela. We were raised together."), say(1, "Marrec, always.")], passed: false },
			step6: { answers: [say(0, "I asked, and got a shrug.")], passed: false },
			r6: say(1, "Marrec, when nobody else would."),
		},
	});

	it("sets a pick on a list entry, leaving its neighbours alone", () => {
		const { answers: next, changed } = applyIntroPicks(answers(), [
			{ writerId: "pim", at: { source: "step4", index: 1 }, who: "marrec" },
		]);
		expect(changed).toBe(1);
		expect(next.pim.step4.answers[1]).toEqual({ q: 1, a: "Marrec, always.", who: "marrec" });
		expect(next.pim.step4.answers[0]).toEqual({ q: 0, a: "Sela. We were raised together." });
	});

	it("sets a pick on a legacy single-answer round", () => {
		const { answers: next, changed } = applyIntroPicks(answers(), [
			{ writerId: "pim", at: { source: "r6", index: null }, who: "marrec" },
		]);
		expect(changed).toBe(1);
		expect(next.pim.r6).toEqual({ q: 1, a: "Marrec, when nobody else would.", who: "marrec" });
	});

	// ⚠ A CLEARED PICK REMOVES THE KEY, so an answer nobody has matched looks exactly like one
	// recorded before matching existed. Absent and empty must not be two different states.
	it("takes a pick off again rather than storing an empty one", () => {
		const withPick = applyIntroPicks(answers(), [
			{ writerId: "pim", at: { source: "step6", index: 0 }, who: "sela" },
		]).answers;
		const { answers: next, changed } = applyIntroPicks(withPick, [
			{ writerId: "pim", at: { source: "step6", index: 0 }, who: "" },
		]);
		expect(changed).toBe(1);
		expect("who" in next.pim.step6.answers[0]).toBe(false);
	});

	// ⚠ A NEW BLOB. This is a world setting the Chronicle compiles from; a half-applied write left
	// behind by a failed save would be a record nobody could tell had changed.
	it("never touches the blob it was handed", () => {
		const before = answers();
		const snapshot = JSON.stringify(before);
		applyIntroPicks(before, [{ writerId: "pim", at: { source: "step4", index: 0 }, who: "sela" }]);
		expect(JSON.stringify(before)).toBe(snapshot);
	});

	it("counts nothing for a pick that changes nothing, or points nowhere", () => {
		expect(applyIntroPicks(answers(), [
			{ writerId: "pim", at: { source: "step4", index: 0 }, who: "" },
		]).changed).toBe(0);
		expect(applyIntroPicks(answers(), [
			{ writerId: "nobody", at: { source: "step4", index: 0 }, who: "sela" },
		]).changed).toBe(0);
		expect(applyIntroPicks(answers(), [
			{ writerId: "pim", at: { source: "step4", index: 9 }, who: "sela" },
		]).changed).toBe(0);
	});
});

describe("the same picks on a character's own flag", () => {
	const list = () => [say(0, "Sela. We were raised together."), say(1, "Marrec, always.")];

	// ⚠ BOTH COPIES GET WRITTEN. `introductionsAnswers` is a harvested mirror of this list, and the
	// harvest overwrites the setting from the flag whenever they differ: matching only the setting
	// would be undone the next time anybody opened the introductions.
	it("matches on the writing and sets the pick there", () => {
		const { list: next, changed } = applyPicksToFlagList(list(), [
			{ answer: "Marrec, always.", who: "marrec" },
		]);
		expect(changed).toBe(1);
		expect(next[1]).toEqual({ q: 1, a: "Marrec, always.", who: "marrec" });
	});

	// ⚠ ON THE WRITING AND NOT ON THE INDEX. The two lists are copies and their indexes do line up,
	// but a blob somebody has edited by hand is exactly the world this tool is for.
	it("finds the answer even when the lists have drifted apart", () => {
		const drifted = [say(4, "Something the GM typed."), ...list()];
		const { list: next } = applyPicksToFlagList(drifted, [
			{ answer: "Sela. We were raised together.", who: "sela" },
		]);
		expect(next[1].who).toBe("sela");
	});

	// Two identical answers cannot be told apart, and a pick put on the wrong one is a pick on
	// somebody else's sentence.
	it("refuses rather than guessing between two identical answers", () => {
		const twice = [say(0, "Sela."), say(2, "Sela.")];
		expect(applyPicksToFlagList(twice, [{ answer: "Sela.", who: "sela" }]).changed).toBe(0);
	});

	it("hands the same list back when nothing matched", () => {
		const before = list();
		const { list: next, changed } = applyPicksToFlagList(before, [
			{ answer: "An answer nobody wrote.", who: "sela" },
		]);
		expect(changed).toBe(0);
		expect(next).toBe(before);
	});
});
