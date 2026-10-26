import { describe, expect, it } from "vitest";
import {
	buildChroniclePages,
	mergeChronicleSections,
	chronicleBodyHash,
	qaSourceKey,
	qaPairHash,
} from "../../module/utils/chronicle-core.js";
import { hashString } from "../../module/hooks/journal-sync-core.js";
import { INTRO_PLAYBOOK_DATA, SUPERSEDED_INTRO_QUESTIONS } from "../../module/dialogs/introductions-data.js";

// "Journal edit wins" (user, 2026-10-22). A Q&A pair the Chronicle wrote once is never written
// again after the GM edits or deletes it in the journal; one the GM has not touched follows its
// source (a reworded question, an answer corrected or deleted in the Introductions dialog).
// Prose already behaved this way; these also cover a cleared source taking its untouched text
// away, a deleted section staying deleted, and an editor's re-serialised body not freezing a
// section.

const blessed = { id: "pc1", name: "Ana", playbookName: "The Blessed", slug: "the-blessed" };

/** A Q&A section as the compiler emits it, with source keys (question index + answer). */
const qa = (heading, rows) => ({
	kind: "qa", heading, group: "glance",
	pairs:    rows.map(([, prompt, answer]) => ({ prompt, answer })),
	pairKeys: rows.map(([q, , answer]) => qaSourceKey(q, answer)),
});
const prose = (heading, body) => ({ kind: "prose", heading, group: "glance", body });
const pairsOf = (sections, heading) => sections.find(s => s.heading === heading)?.pairs ?? [];

/** Seed an empty page, then hand back what a later save starts from. */
function seeded(computed) {
	const first = mergeChronicleSections([], computed);
	return { sections: first.sections, proseManaged: first.proseManaged, qaManaged: first.qaManaged };
}
const again = (page, computed, extra = {}) => mergeChronicleSections(page.sections, computed, {
	proseManaged: page.proseManaged, qaManaged: page.qaManaged, ...extra,
});

describe("Q&A pairs: the journal edit wins", () => {
	const BONDS = "Bonds & ties";
	const first = [qa(BONDS, [[0, "Who is your kin?", "My sister."], [1, "Who taught you?", "Old Maren."]])];

	it("never stores the source keys on the page", () => {
		const page = seeded(first);
		expect(page.sections[0]).not.toHaveProperty("pairKeys");
		expect(page.sections[0].pairs).toEqual([
			{ prompt: "Who is your kin?", answer: "My sister." },
			{ prompt: "Who taught you?", answer: "Old Maren." },
		]);
		expect(Object.keys(page.qaManaged[BONDS])).toHaveLength(2);
	});

	it("does not bring back a pair the GM deleted in the journal", () => {
		const page = seeded(first);
		page.sections[0].pairs = [page.sections[0].pairs[1]];
		const next = again(page, first);
		expect(next.added).toBe(0);
		expect(pairsOf(next.sections, BONDS).map(p => p.answer)).toEqual(["Old Maren."]);
	});

	it("does not bring back the original beside a pair the GM edited", () => {
		const page = seeded(first);
		page.sections[0].pairs[0] = { prompt: "Who is your kin?", answer: "My sister, Wren." };
		const next = again(page, first);
		expect(next.added).toBe(0);
		expect(pairsOf(next.sections, BONDS).map(p => p.answer)).toEqual(["My sister, Wren.", "Old Maren."]);
	});

	it("does not recreate a section the GM deleted", () => {
		const page = seeded(first);
		page.sections = [];
		const next = again(page, first);
		expect(next.added).toBe(0);
		expect(next.sections).toEqual([]);
	});

	it("recreates a deleted section with only an answer it never wrote", () => {
		const page = seeded(first);
		page.sections = [];
		const later = [qa(BONDS, [...first[0].pairs.map((p, i) => [i, p.prompt, p.answer]), [2, "Who owes you?", "The miller."]])];
		const next = again(page, later);
		expect(next.added).toBe(1);
		expect(pairsOf(next.sections, BONDS)).toEqual([{ prompt: "Who owes you?", answer: "The miller." }]);
	});

	it("still adds an answer recorded later", () => {
		const page = seeded(first);
		const later = [qa(BONDS, [[0, "Who is your kin?", "My sister."], [1, "Who taught you?", "Old Maren."], [3, "Who fears you?", "Bram."]])];
		const next = again(page, later);
		expect(next.added).toBe(1);
		expect(pairsOf(next.sections, BONDS).map(p => p.answer)).toEqual(["My sister.", "Old Maren.", "Bram."]);
	});

	it("rewords an untouched pair in place when its question is reworded, without a duplicate", () => {
		const page = seeded(first);
		const reworded = [qa(BONDS, [[0, "Who is your kin, by blood?", "My sister."], [1, "Who taught you?", "Old Maren."]])];
		const next = again(page, reworded);
		expect(next.added).toBe(1);
		expect(pairsOf(next.sections, BONDS)).toEqual([
			{ prompt: "Who is your kin, by blood?", answer: "My sister." },
			{ prompt: "Who taught you?", answer: "Old Maren." },
		]);
		// ...and keeps following it: the next save changes nothing.
		expect(again({ ...page, ...next }, reworded).added).toBe(0);
	});

	it("follows an answer corrected in the Introductions dialog, in place", () => {
		const page = seeded(first);
		const corrected = [qa(BONDS, [[0, "Who is your kin?", "My brother."], [1, "Who taught you?", "Old Maren."]])];
		const next = again(page, corrected);
		expect(pairsOf(next.sections, BONDS).map(p => p.answer)).toEqual(["My brother.", "Old Maren."]);
	});

	it("removes an untouched pair whose answer was deleted in the dialog, and keeps an edited one", () => {
		const page = seeded(first);
		const fewer = [qa(BONDS, [[1, "Who taught you?", "Old Maren."]])];
		expect(pairsOf(again(page, fewer).sections, BONDS).map(p => p.answer)).toEqual(["Old Maren."]);

		page.sections[0].pairs[0] = { prompt: "Who is your kin?", answer: "My sister (GM note)." };
		expect(pairsOf(again(page, fewer).sections, BONDS).map(p => p.answer)).toEqual(["My sister (GM note).", "Old Maren."]);
	});

	it("takes the whole section away when every answer in it was deleted at the source", () => {
		const page = seeded(first);
		const next = again(page, [], { cleared: [BONDS] });
		expect(next.sections).toEqual([]);
		// A new answer later brings it back.
		const back = again({ ...page, ...next }, [qa(BONDS, [[2, "Who owes you?", "The miller."]])]);
		expect(pairsOf(back.sections, BONDS)).toEqual([{ prompt: "Who owes you?", answer: "The miller." }]);
	});

	it("brings a tracked pair still in a shipped older wording up to the current one", () => {
		// A page seeded before old wordings were recognised: the record says it wrote the CURRENT
		// text, while the page still shows the shipped older one.
		const current = { prompt: "Who is your lover/spouse/betrothed?", answer: "Tamsin." };
		const page = {
			sections:     [{ kind: "qa", heading: BONDS, group: "glance", pairs: [{ prompt: "Who is your lover, spouse, or betrothed?", answer: "Tamsin." }] }],
			proseManaged: {},
			qaManaged:    { [BONDS]: { [qaSourceKey(0, "Tamsin.")]: qaPairHash(current) } },
		};
		const now = [qa(BONDS, [[0, current.prompt, current.answer]])];
		const next = again(page, now);
		expect(next.kept).toBe(0);
		expect(pairsOf(next.sections, BONDS)).toEqual([{ prompt: "Who is your lover/spouse/betrothed?", answer: "Tamsin." }]);
	});

	it("counts a pair the GM kept from a newer source as kept, not as up to date", () => {
		const page = seeded(first);
		page.sections[0].pairs[0] = { prompt: "Who is your kin?", answer: "GM's words." };
		const reworded = [qa(BONDS, [[0, "Who is your kin, by blood?", "My sister."], [1, "Who taught you?", "Old Maren."]])];
		const next = again(page, reworded);
		expect(next.added).toBe(0);
		expect(next.kept).toBe(1);
	});

	describe("a page written before pairs were remembered", () => {
		it("seeds the record from the pairs already there, matching a GM's rewording by answer", () => {
			const legacy = [{ kind: "qa", heading: BONDS, group: "glance", pairs: [
				{ prompt: "Who do you love most?", answer: "Tamsin." },
				{ prompt: "A GM's own question", answer: "A GM's own answer." },
			] }];
			const computed = [qa(BONDS, [[2, "Who is your lover/spouse/betrothed?", "Tamsin."]])];
			const next = mergeChronicleSections(legacy, computed);
			expect(next.added).toBe(0);
			expect(pairsOf(next.sections, BONDS)).toEqual(legacy[0].pairs);
			expect(Object.keys(next.qaManaged[BONDS])).toEqual([qaSourceKey(2, "Tamsin.")]);

			// Once seeded, the GM deleting the pair is final.
			const page = { sections: [{ ...legacy[0], pairs: [legacy[0].pairs[1]] }], proseManaged: {}, qaManaged: next.qaManaged };
			expect(again(page, computed).added).toBe(0);
		});

		it("brings a pair in a wording a release shipped up to the current wording, once", () => {
			const legacy = [{ kind: "qa", heading: BONDS, group: "glance", pairs: [
				{ prompt: "Who most needs or deserves your protection?", answer: "Little Pell." },
				{ prompt: "Who is your lover, spouse, or betrothed?", answer: "Tamsin." },
			] }];
			const computed = [qa(BONDS, [
				[0, "Who is your lover/spouse/betrothed?", "Tamsin."],
				[1, "Who most needs/deserves your protection?", "Little Pell."],
			])];
			const next = mergeChronicleSections(legacy, computed);
			expect(next.added).toBe(2);
			// In place, so the page keeps the order it was read in.
			expect(pairsOf(next.sections, BONDS)).toEqual([
				{ prompt: "Who most needs/deserves your protection?", answer: "Little Pell." },
				{ prompt: "Who is your lover/spouse/betrothed?", answer: "Tamsin." },
			]);
			expect(again({ sections: next.sections, proseManaged: {}, qaManaged: next.qaManaged }, computed).added).toBe(0);
		});

		it("leaves the shipped wording alone when the answer beside it was changed in the journal", () => {
			const legacy = [{ kind: "qa", heading: BONDS, group: "glance", pairs: [
				{ prompt: "Who is your lover, spouse, or betrothed?", answer: "Tamsin, the miller's girl." },
			] }];
			const next = mergeChronicleSections(legacy, [qa(BONDS, [[0, "Who is your lover/spouse/betrothed?", "Tamsin."]])]);
			// Nothing matches the answer, so the recorded one is added beside the GM's own pair.
			expect(pairsOf(next.sections, BONDS)[0]).toEqual(legacy[0].pairs[0]);
		});

		it("adds the answers nothing on the page matches", () => {
			const legacy = [{ kind: "qa", heading: BONDS, group: "glance", pairs: [{ prompt: "Q", answer: "A" }] }];
			const next = mergeChronicleSections(legacy, [qa(BONDS, [[0, "Q", "A"], [1, "R", "B"]])]);
			expect(next.added).toBe(1);
			expect(pairsOf(next.sections, BONDS).map(p => p.answer)).toEqual(["A", "B"]);
		});
	});

	it("keys a pair by its question index, so a playbook change does not add a second copy", () => {
		const a1 = { step4: { answers: [{ q: 0, a: "Old Bemis." }] } };
		const before = buildChroniclePages({ pcs: [blessed], introAnswers: { pc1: a1 } })[0];
		const page = seeded(before.sections);
		const after = buildChroniclePages({ pcs: [{ ...blessed, playbookName: "The Heavy", slug: "the-heavy" }], introAnswers: { pc1: a1 } })[0];
		const next = again(page, after.sections);
		expect(pairsOf(next.sections, BONDS)).toHaveLength(1);
		expect(pairsOf(next.sections, BONDS)[0].answer).toBe("Old Bemis.");
	});
});

describe("shipped older question wordings", () => {
	it("names only questions a playbook still asks, and never the current wording as an old one", () => {
		const current = new Set(Object.values(INTRO_PLAYBOOK_DATA).flatMap(p => [...(p.step4 ?? []), ...(p.step6 ?? [])]));
		for (const [now, olds] of Object.entries(SUPERSEDED_INTRO_QUESTIONS)) {
			expect(current.has(now), now).toBe(true);
			for (const old of olds) expect(current.has(old), old).toBe(false);
		}
	});
});

describe("prose: cleared, deleted, re-serialised", () => {
	it("takes away an untouched section whose source was cleared, and keeps an edited one", () => {
		const page = seeded([prose("Introduction", "<p>Hi.</p>")]);
		const cleared = again(page, [], { cleared: ["Introduction"] });
		expect(cleared.sections).toEqual([]);
		expect(cleared.added).toBe(1);
		expect(cleared.proseManaged).not.toHaveProperty("Introduction");

		page.sections[0].body = "<p>Hi, says the GM.</p>";
		const kept = again(page, [], { cleared: ["Introduction"] });
		expect(kept.sections).toHaveLength(1);
		expect(kept.added).toBe(0);
	});

	it("brings a section back once its cleared source has text again", () => {
		const page = seeded([prose("Introduction", "<p>Hi.</p>")]);
		const cleared = again(page, [], { cleared: ["Introduction"] });
		const back = again({ ...page, ...cleared }, [prose("Introduction", "<p>Hello.</p>")]);
		expect(back.sections.map(s => s.body)).toEqual(["<p>Hello.</p>"]);
	});

	it("does not recreate a prose section the GM deleted", () => {
		const page = seeded([prose("Introduction", "<p>Hi.</p>")]);
		page.sections = [];
		const next = again(page, [prose("Introduction", "<p>Hi again.</p>")]);
		expect(next.sections).toEqual([]);
		expect(next.kept).toBe(1);
	});

	it("still follows its source after the editor re-saves &#x27; as an apostrophe", () => {
		const page = seeded([prose("Introduction", "<p>I&#x27;m Sa.</p>")]);
		page.sections[0].body = "<p>I'm Sa.</p>";
		const next = again(page, [prose("Introduction", "<p>I&#x27;m Sael.</p>")]);
		expect(next.added).toBe(1);
		expect(next.sections[0].body).toBe("<p>I&#x27;m Sael.</p>");
	});

	it("accepts the raw hash an older version stamped", () => {
		const body = "<p>I&#x27;m Sa.</p>";
		const page = { sections: [prose("Introduction", body)], proseManaged: { Introduction: hashString(body) }, qaManaged: {} };
		const next = again(page, [prose("Introduction", "<p>Newer.</p>")]);
		expect(next.sections[0].body).toBe("<p>Newer.</p>");
		expect(next.proseManaged.Introduction).toBe(chronicleBodyHash("<p>Newer.</p>"));
	});
});

describe("buildChroniclePages: what a page can lose", () => {
	it("names the headings whose source is empty", () => {
		const [page] = buildChroniclePages({ pcs: [blessed], introAnswers: { pc1: { r1: "Hi." } } });
		expect(page.cleared).toContain("Possessions & contribution");
		expect(page.cleared).toContain("Bonds & ties");
		expect(page.cleared).not.toContain("Introduction");
	});

	it("returns the pages with nothing in them only when asked", () => {
		expect(buildChroniclePages({ pcs: [blessed], introAnswers: {} })).toEqual([]);
		const pages = buildChroniclePages({ pcs: [blessed], introAnswers: {}, withEmpty: true });
		expect(pages.map(p => [p.key, p.sections.length])).toEqual([["pc1", 0], ["__spring__", 0]]);
	});
});
