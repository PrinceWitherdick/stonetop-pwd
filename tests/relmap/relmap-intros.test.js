import { describe, it, expect, beforeEach } from "vitest";
import {
	INTRO_STEP_INKS, introAnswerKey, introLine, introRegards, namedIn, questionAsPhrase,
} from "../../module/relmap/relmap-intros.js";
import { rowKey } from "../../module/relmap/relmap-intro-match.js";
import { RELMAP_LABEL_MAX } from "../../module/relmap/relmap-store.js";

// Reading the introduction answers the Chronicle holds, so the party view can draw them.
//
// ⚠ THIS USED TO BE AN IMPORT, AND THEN BRIEFLY THE 1-5 HEARTS. "Pull in ratings" wrote a line into
// the shared board for every rating anybody in the world had stored; it is gone, and so is every
// test about patches, minted ids and pressing the button twice. Then the hearts turned out to be
// the wrong record: the introductions are the Q&A saved to the Chronicle, and those are what this
// reads. What has to hold now is that it reads what the Chronicle reads, that it only ever joins
// two people whose NAME is actually in the writing, and that it never joins the wrong two.

const say = (q, a) => ({ q, a });

/** One PC as the Chronicle already describes them. "the-fox" is a real playbook slug, so the
 * question indexes below resolve to its real authored questions. */
const pc = (id, name, slug = "the-fox") => ({ id, uuid: `Actor.${id}`, name, slug });

beforeEach(() => {
	globalThis.game = {
		i18n: {
			localize: key => key,
			format: (key, data = {}) => (key === "stonetop.relmap.introLine"
				? `${data.question} ${data.answer}`
				: key),
		},
	};
});

describe("an authored question as a phrase about the pair", () => {
	// The caption on a line is read as a phrase about the two people it joins. A question in the
	// interrogative reads as neither, and spends its head on grammar the arrow already provides.
	it("strips the scaffolding and the question mark", () => {
		expect(questionAsPhrase("Which one of you has stayed my hand?")).toBe("has stayed my hand");
		expect(questionAsPhrase("Which of you trusts me not one bit?")).toBe("trusts me not one bit");
		expect(questionAsPhrase("Who taught you the secret ways?")).toBe("taught you the secret ways");
	});

	// ⚠ LONGEST OPENER FIRST, and it is load-bearing: matched against "Who " instead, this reads
	// "is your lover, spouse, or betrothed".
	it("takes the longest opening that fits", () => {
		expect(questionAsPhrase("Who is your lover, spouse, or betrothed?")).toBe("lover, spouse, or betrothed");
		expect(questionAsPhrase("Who is the wisest of the town elders?")).toBe("the wisest of the town elders");
	});

	// DELIBERATELY NOT STRIPPED. Cutting the head off these leaves a fragment with the possessive
	// gone, which is worse than the question standing whole.
	it("leaves a question it cannot cut cleanly exactly as it was written", () => {
		expect(questionAsPhrase("Whose forgiveness do you strive to earn?"))
			.toBe("Whose forgiveness do you strive to earn");
		expect(questionAsPhrase("To whom do you owe a debt that cannot be repaid?"))
			.toBe("To whom do you owe a debt that cannot be repaid");
	});

	it("survives being asked about nothing", () => {
		expect(questionAsPhrase()).toBe("");
		expect(questionAsPhrase("   ")).toBe("");
	});
});

describe("finding who an answer is about", () => {
	const PARTY = [pc("sela", "Sela"), pc("marrec", "Marrec"), pc("emrys", "Emrys Tal")];

	// ⚠ THE WHOLE OF WHAT JOINS TWO PEOPLE. An introduction answer is `{q, a}`: a question index
	// and free prose, with no field naming the other player character. The step-6 questions force
	// the naming ("Which one of you..."), and read against a real table's answers they do get named.
	it("answers with whoever the writing names", () => {
		expect(namedIn("I put it to Sela, who only nodded once.", PARTY)).toBe("Actor.sela");
	});

	// THE EARLIEST NAME WINS, the same rule `guessKin` follows next door. These are prose: the
	// person the sentence is about is the one it opens with, and anybody named later is scenery.
	it("takes the first person named, not the last", () => {
		expect(namedIn("Marrec, though Sela would tell it differently.", PARTY)).toBe("Actor.marrec");
	});

	// Players write "I asked Emrys", not "I asked Emrys Tal".
	it("finds somebody by their given name", () => {
		expect(namedIn("Emrys went quiet a moment.", PARTY)).toBe("Actor.emrys");
		expect(namedIn("Emrys Tal went quiet a moment.", PARTY)).toBe("Actor.emrys");
	});

	// ⚠ UNLESS TWO OF THEM SHARE IT. A guess that picked either would be a line asserting something
	// nobody said, so an ambiguous given name is no name at all and only the full one counts.
	it("refuses a given name two of the party answer to", () => {
		const twins = [pc("a", "Emrys Tal"), pc("b", "Emrys Vane")];
		expect(namedIn("Emrys said nothing.", twins)).toBe(null);
		expect(namedIn("Emrys Vane said nothing.", twins)).toBe("Actor.b");
	});

	// WHOLE WORDS ONLY. "Pim" inside "Pimble" is not Pim, and the boundary is a Unicode letter
	// class rather than `\b`, which is ASCII and fires in the middle of any accented name.
	it("does not find a name inside a longer word", () => {
		expect(namedIn("old Selanna keeps the mill.", [pc("s", "Sela")])).toBe(null);
		expect(namedIn("Renée said so.", [pc("r", "Renée")])).toBe("Actor.r");
	});

	it("answers with nobody where nobody on the list is named", () => {
		expect(namedIn("My sister Maeve, who took me in.", PARTY)).toBe(null);
		expect(namedIn("", PARTY)).toBe(null);
		expect(namedIn("Sela", [])).toBe(null);
	});
});

describe("one answer as a line", () => {
	it("captions with the question and keeps the whole of both beside it", () => {
		const line = introLine("Which one of you has stayed my hand?", "I put it to Sela.", "step6");
		expect(line.label).toBe("has stayed my hand");
		expect(line.said).toBe("Which one of you has stayed my hand? I put it to Sela.");
		expect(line.ink).toBe(INTRO_STEP_INKS.step6);
	});

	// TWO LENGTHS, AND BOTH ARE USED: the caption is cut to the board's bound so one long question
	// cannot run right across everybody else's lines, and the tooltip carries all of it.
	it("trims the caption to the board's bound", () => {
		const long = `Which one of you ${"x".repeat(RELMAP_LABEL_MAX + 20)}?`;
		const line = introLine(long, "Sela.", "step4");
		expect(line.label).toHaveLength(RELMAP_LABEL_MAX);
		expect(line.label.endsWith("\u2026")).toBe(true);
		expect(line.said).toContain("Sela.");
	});

	// ⚠ ON A WORD, and this was caught by running the real code over a real world rather than over
	// fixtures I wrote. It is a real authored question, and a flat cut at sixty ends it
	// "guide, prote", which reads as a rendering fault rather than as a caption that was too long.
	it("cuts a long question on a word, not through one", () => {
		const line = introLine(
			"Who is beloved by the goddess, your charge to nurture, guide, protect, or heal?",
			"Sela.", "step4",
		);
		expect(line.label).toBe("beloved by the goddess, your charge to nurture, guide\u2026");
		expect(line.label.length).toBeLessThanOrEqual(RELMAP_LABEL_MAX);
		// The whole of it is still on the line, which is what the tooltip shows.
		expect(line.said).toContain("protect, or heal?");
	});

	// A record whose question index is missing keeps a blank prompt, and a line with no caption
	// says nothing at all but its colour.
	it("falls back to the answer where there is no question", () => {
		expect(introLine("", "Sela, always.", "step4").label).toBe("Sela, always.");
	});

	// The two steps ask different kinds of question, so they are told apart at a glance. The
	// caption says which either way, so the colour is never the only carrier.
	it("colours the two steps differently", () => {
		expect(INTRO_STEP_INKS.step4).not.toBe(INTRO_STEP_INKS.step6);
	});
});

describe("every answer the party recorded about each other", () => {
	// "the-fox" step6[0] is "Which one of you joined me in my latest hijinx?";
	// step4[0] is "Who is your closest kin?".
	const PIM = pc("pim", "Pim");
	const SELA = pc("sela", "Sela");

	it("draws a line for an answer that names another player character", () => {
		const said = introRegards([PIM, SELA], {
			pim: { step6: { answers: [say(0, "Sela, of course. She held the ladder.")] } },
		});
		const lines = said.get("Actor.pim").get("Actor.sela");
		expect(lines).toHaveLength(1);
		expect(lines[0].label).toBe("joined me in my latest hijinx");
		expect(lines[0].ink).toBe(INTRO_STEP_INKS.step6);
	});

	// ⚠ THE ANSWER THAT NAMES AN NPC IS NOT A LINE. "My sister Maeve, who took me in" is a real
	// answer to a real question, and Maeve is not on this ring; a view whose whole promise is the
	// player characters must not invent an end for it.
	it("draws nothing for an answer that names nobody in the party", () => {
		const said = introRegards([PIM, SELA], {
			pim: { step4: { answers: [say(0, "My sister Maeve, who took me in.")] } },
		});
		expect(said.size).toBe(0);
	});

	// A person can be asked eight questions and name one friend in all of them.
	it("keeps every answer about the same person, not just the first", () => {
		const said = introRegards([PIM, SELA], {
			pim: {
				step4: { answers: [say(0, "Sela. We were raised together.")] },
				step6: { answers: [say(0, "Sela, of course."), say(2, "Sela, more than once.")] },
			},
		});
		expect(said.get("Actor.pim").get("Actor.sela")).toHaveLength(3);
	});

	// The pay-off: what one answered says nothing about what came back, so a pair who both wrote
	// about each other are two entries pointing opposite ways.
	it("keeps both sides of a pair who wrote about each other", () => {
		const said = introRegards([PIM, SELA], {
			pim: { step6: { answers: [say(3, "Sela. She has never trusted me.")] } },
			sela: { step6: { answers: [say(1, "Pim brings me every one of his problems.")] } },
		});
		expect(said.get("Actor.pim").get("Actor.sela")).toHaveLength(1);
		expect(said.get("Actor.sela").get("Actor.pim")).toHaveLength(1);
	});

	// Never themselves: a line from a person to themselves cannot be drawn, and the store refuses
	// one in any case.
	it("ignores somebody naming themselves", () => {
		const said = introRegards([PIM, SELA], {
			pim: { step6: { answers: [say(0, "Pim, alone as always.")] } },
		});
		expect(said.size).toBe(0);
	});

	// ⚠ THROUGH THE CHRONICLE'S OWN READER, so the map cannot show a bond the Chronicle page does
	// not. The legacy single-answer rounds fold in behind the step list; a world that ran the
	// introductions before the player-driven flow existed still has its answers read.
	it("reads the legacy single-answer rounds the Chronicle still reads", () => {
		const said = introRegards([PIM, SELA], {
			pim: { r6: say(0, "Sela, of course.") },
		});
		expect(said.get("Actor.pim").get("Actor.sela")).toHaveLength(1);
	});

	// ── The pick the introductions now record ──────────────────────────────────────────────────
	// The step asks "Who is this about?" beside the answer field and stores the actor id as `who`.
	// Where it is there it settles the question, because it is not a guess: somebody chose it.

	it("draws the line at whoever the writer picked, whatever the writing says", () => {
		const said = introRegards([PIM, SELA], {
			pim: { step6: { answers: [{ q: 0, a: "I asked her outright and she only laughed.", who: "sela" }] } },
		});
		expect(said.get("Actor.pim").get("Actor.sela")).toHaveLength(1);
	});

	// ⚠ THE PICK OUTRANKS THE PROSE. "Sela told me Marrec would never" names the wrong one first,
	// and a writer who chose from the list has already settled it.
	it("prefers the pick over the first name in the writing", () => {
		const MARREC = pc("marrec", "Marrec");
		const said = introRegards([PIM, SELA, MARREC], {
			pim: { step6: { answers: [{ q: 0, a: "Sela told me Marrec would never.", who: "marrec" }] } },
		});
		expect(said.get("Actor.pim").get("Actor.marrec")).toHaveLength(1);
		expect(said.get("Actor.pim").get("Actor.sela")).toBeUndefined();
	});

	// A pick pointing at somebody who is not on this board (a character since deleted, a record
	// carried in from another world) is refused, and the writing is read instead.
	it("falls back to the writing when the pick names nobody in the party", () => {
		const said = introRegards([PIM, SELA], {
			pim: { step6: { answers: [{ q: 0, a: "Sela, of course.", who: "gone-away" }] } },
		});
		expect(said.get("Actor.pim").get("Actor.sela")).toHaveLength(1);
	});

	// Somebody picking themselves is not a line, the same as somebody naming themselves.
	it("refuses a pick of the writer themselves", () => {
		const said = introRegards([PIM, SELA], {
			pim: { step6: { answers: [{ q: 0, a: "Nobody but me.", who: "pim" }] } },
		});
		expect(said.size).toBe(0);
	});

	// Every answer recorded before the picker existed has no `who` at all, and reads exactly as it
	// did: by the names in the writing.
	it("reads an answer recorded before the pick existed by its names, as before", () => {
		const said = introRegards([PIM, SELA], {
			pim: { step6: { answers: [say(0, "Sela, of course.")] } },
		});
		expect(said.get("Actor.pim").get("Actor.sela")).toHaveLength(1);
	});

	it("survives a party with nothing recorded, and no party at all", () => {
		expect(introRegards([PIM, SELA], {}).size).toBe(0);
		expect(introRegards([PIM], { pim: { step6: { answers: [say(0, "Sela.")] } } }).size).toBe(0);
		expect(introRegards().size).toBe(0);
	});
});

// ── Which answer a line came from ───────────────────────────────────────────────────────────────
//
// The party board stores its lines, so the next open has to be able to tell the answers already
// drawn from the ones that are not. It used to COUNT them, which is only right while the list grows
// at the end — and it does not: a pair's answers come back grouped by step, so an old "Bonds & ties"
// answer somebody has just pointed at a person is inserted in front of the step-6 lines already
// drawn. Each line carries the key of the answer it came from instead.

describe("the key that says which answer a line came from", () => {
	const PIM = pc("pim", "Pim");
	const SELA = pc("sela", "Sela");

	// THE SLOT AND NOT THE PROSE. The caption on a seeded line is the table's to rewrite, so a key
	// read out of the writing would make the board draw a duplicate the moment somebody did.
	it("names a recorded answer by the writer and the slot it is stored in", () => {
		expect(introAnswerKey("pim", { source: "step4", index: 2 })).toBe("pim::step4::2");
		// A legacy single-answer round has no index, and is still one answer with one key.
		expect(introAnswerKey("pim", { source: "r4", index: null })).toBe("pim::r4::");
	});

	// ⚠ THE SAME KEY THE MATCH WINDOW POSTS ITS FORM BACK AGAINST. Two spellings of "which answer
	// is this" is how a line the board drew comes to name a different answer from the one the
	// matcher wrote, and neither side would say so.
	it("is the very function the match window identifies its rows by", () => {
		expect(rowKey).toBe(introAnswerKey);
	});

	it("rides onto every line, naming the answer it was read from", () => {
		const said = introRegards([PIM, SELA], {
			pim: {
				step4: { answers: [say(0, "Sela, always.")] },
				step6: { answers: [say(0, "Sela, of course.")] },
			},
		});
		expect(said.get("Actor.pim").get("Actor.sela").map(line => line.key))
			.toEqual(["pim::step4::0", "pim::step6::0"]);
	});

	// A key is not something a caller has to have. Without one the board falls back to the pairing
	// it always did, so nothing here is a new way for a line to fail to be drawn.
	it("is blank on a line built without one", () => {
		expect(introLine("Who is your closest kin?", "Sela.", "step4").key).toBe("");
	});
});
