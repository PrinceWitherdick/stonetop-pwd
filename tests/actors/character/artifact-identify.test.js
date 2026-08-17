import { describe, it, expect } from "vitest";
import {
	ARTIFACT_STATE,
	normalizeArtifactState,
	isConcealedArtifact,
	isArtifactUpgrade,
	artifactStateForTier,
	artifactVisibility,
	concealArtifactFields,
	knowThingsArtifactResults,
	seekInsightArtifactResults,
	ARTIFACT_INSIGHT_QUESTIONS,
	ARTIFACT_LEAD_SUGGESTIONS,
} from "../../../module/actors/character/artifact-identify.js";

// Identifying artifacts, Book I, Discoveries pp.430-431:
//   "If they Know Things about the artifact and get a 7+, then tell them some combo of what it
//    is, what it does, what it's worth, how they might activate it or sell it for its full
//    value, or how they might learn more. If the artifact has a custom move, then maybe you'd
//    give them some inkling of what it does on a 7-9, and give them the move's full text on a
//    10+."
//   "Once a PC figures an artifact out, give the player its tags, write-up, and any custom
//    moves, etc."

const NOTE = "fragile, magical, Value 3";
const USES = { max: 3, title: "hours", labels: [] };

describe("normalizeArtifactState", () => {
	it("reads every legal state back unchanged", () => {
		for (const s of Object.values(ARTIFACT_STATE)) expect(normalizeArtifactState(s)).toBe(s);
	});

	it("reads anything else as 'not an artifact'", () => {
		// The stored value is a plain StringField, so a hand-edited world or an older export can
		// hold anything at all. Falling back to NONE means such an item renders as ordinary gear
		// rather than as a permanently-unidentifiable one nobody can open.
		for (const junk of ["identified", "IDENTIFIED", null, undefined, 3, {}]) {
			expect(normalizeArtifactState(junk)).toBe(ARTIFACT_STATE.NONE);
		}
	});
});

describe("isConcealedArtifact", () => {
	it("is true only while something is still withheld", () => {
		expect(isConcealedArtifact(ARTIFACT_STATE.UNKNOWN)).toBe(true);
		expect(isConcealedArtifact(ARTIFACT_STATE.PARTIAL)).toBe(true);
		expect(isConcealedArtifact(ARTIFACT_STATE.KNOWN)).toBe(false);
		expect(isConcealedArtifact(ARTIFACT_STATE.NONE)).toBe(false);
	});
});

describe("artifactStateForTier", () => {
	it("settles the two hits and nothing else", () => {
		expect(artifactStateForTier("success")).toBe(ARTIFACT_STATE.KNOWN);
		// This system labels a 12+ "critical"; p.430 draws no line above 10+.
		expect(artifactStateForTier("critical")).toBe(ARTIFACT_STATE.KNOWN);
		expect(artifactStateForTier("partial")).toBe(ARTIFACT_STATE.PARTIAL);
		// A 6- is "the GM tells you nothing useful… but names a path" — no disclosure to write.
		expect(artifactStateForTier("failure")).toBeNull();
		expect(artifactStateForTier(undefined)).toBeNull();
	});
});

describe("isArtifactUpgrade", () => {
	it("lets a roll tell the character more", () => {
		expect(isArtifactUpgrade(ARTIFACT_STATE.UNKNOWN, ARTIFACT_STATE.PARTIAL)).toBe(true);
		expect(isArtifactUpgrade(ARTIFACT_STATE.PARTIAL, ARTIFACT_STATE.KNOWN)).toBe(true);
		expect(isArtifactUpgrade(ARTIFACT_STATE.UNKNOWN, ARTIFACT_STATE.KNOWN)).toBe(true);
	});

	it("refuses to take back what the player has already read", () => {
		// The Logbook's "treat the result as a 10+" and a GM Shift Down both rewrite a settled
		// card. Re-applying the lower tier would un-tell a write-up already read aloud.
		expect(isArtifactUpgrade(ARTIFACT_STATE.KNOWN, ARTIFACT_STATE.PARTIAL)).toBe(false);
		expect(isArtifactUpgrade(ARTIFACT_STATE.KNOWN, ARTIFACT_STATE.KNOWN)).toBe(false);
		expect(isArtifactUpgrade(ARTIFACT_STATE.PARTIAL, ARTIFACT_STATE.UNKNOWN)).toBe(false);
	});
});

describe("artifactVisibility", () => {
	it("hides nothing on ordinary gear", () => {
		const v = artifactVisibility(ARTIFACT_STATE.NONE);
		expect(v).toMatchObject({ concealed: false, showNote: true, showResource: true, showLore: true });
		// No hint or lead either: an item that isn't an artifact has no p.430 furniture at all.
		expect(v.showHint).toBe(false);
		expect(v.showLead).toBe(false);
	});

	it("withholds the tags and the uses track while the artifact is unknown", () => {
		const v = artifactVisibility(ARTIFACT_STATE.UNKNOWN);
		expect(v).toMatchObject({ concealed: true, showNote: false, showResource: false, showLore: false });
	});

	it("gives up the tags on a 7-9 but keeps the write-up owed", () => {
		// "tell them some combo of what it is… what it's worth" on any 7+, with the custom
		// move's full text held back for the 10+.
		const v = artifactVisibility(ARTIFACT_STATE.PARTIAL);
		expect(v).toMatchObject({ concealed: true, showNote: true, showResource: true, showLore: false });
	});

	it("opens everything at known", () => {
		const v = artifactVisibility(ARTIFACT_STATE.KNOWN);
		expect(v).toMatchObject({ concealed: false, showNote: true, showResource: true, showLore: true });
		// The hint is what STANDS IN for the tags; showing both would print the tease beside
		// its own answer.
		expect(v.showHint).toBe(false);
	});

	it("shows the GM everything they wrote, at every state", () => {
		for (const s of [ARTIFACT_STATE.UNKNOWN, ARTIFACT_STATE.PARTIAL]) {
			const v = artifactVisibility(s, { viewerIsGM: true });
			expect(v).toMatchObject({ showNote: true, showResource: true, showLore: true });
			expect(v.concealed).toBe(true);   // still concealed FROM THE PLAYER — the row says so
		}
	});

	it("conceals by default when the caller forgets to say who is looking", () => {
		expect(artifactVisibility(ARTIFACT_STATE.UNKNOWN).showNote).toBe(false);
	});
});

describe("concealArtifactFields", () => {
	const fields = { note: NOTE, resource: USES, hint: "It thrums faintly", lore: "<p>It opens doors.</p>", lead: "Old Gorlas would know" };

	it("passes ordinary gear straight through", () => {
		const out = concealArtifactFields({ ...fields, state: "" });
		expect(out.note).toBe(NOTE);
		expect(out.resource).toBe(USES);
		expect(out.isArtifact).toBe(false);
		expect(out.concealed).toBe(false);
		// hint/lead are meaningless without a state, so they're dropped rather than printed on
		// a row that has no "?" to explain them.
		expect(out.hint).toBe("");
		expect(out.lead).toBe("");
	});

	it("drops the hidden text entirely rather than flagging it", () => {
		// Concealment happens BEFORE the snapshot precisely so the withheld tags never reach the
		// rendered DOM — a player who opens the inspector must not find them sitting in an
		// attribute. Returning null (not the string plus a flag) is what guarantees that.
		const out = concealArtifactFields({ ...fields, state: ARTIFACT_STATE.UNKNOWN });
		expect(out.note).toBeNull();
		expect(out.resource).toBeNull();
		expect(out.lore).toBe("");
		expect(out.hint).toBe("It thrums faintly");
		expect(out.lead).toBe("Old Gorlas would know");
		expect(out).toMatchObject({ isArtifact: true, concealed: true, gmPeeking: false, loreOwed: false });
	});

	it("marks a 7-9 as owing its write-up", () => {
		const out = concealArtifactFields({ ...fields, state: ARTIFACT_STATE.PARTIAL });
		expect(out.note).toBe(NOTE);
		expect(out.resource).toBe(USES);
		expect(out.lore).toBe("");          // still owed
		expect(out.loreOwed).toBe(true);
	});

	it("hands everything over at known and stops teasing", () => {
		const out = concealArtifactFields({ ...fields, state: ARTIFACT_STATE.KNOWN });
		expect(out.note).toBe(NOTE);
		expect(out.lore).toBe("<p>It opens doors.</p>");
		expect(out.hint).toBe("");
		expect(out.lead).toBe("");
		expect(out.concealed).toBe(false);
	});

	it("tells the GM they're reading more than the owner is", () => {
		const out = concealArtifactFields({ ...fields, state: ARTIFACT_STATE.UNKNOWN }, { viewerIsGM: true });
		expect(out.note).toBe(NOTE);
		expect(out.lore).toBe("<p>It opens doors.</p>");
		expect(out.gmPeeking).toBe(true);
	});

	it("does not claim a GM peek once the artifact is open to everyone", () => {
		const out = concealArtifactFields({ ...fields, state: ARTIFACT_STATE.KNOWN }, { viewerIsGM: true });
		expect(out.gmPeeking).toBe(false);
	});

	it("survives an item with no artifact fields at all", () => {
		const out = concealArtifactFields({}, {});
		expect(out).toMatchObject({ state: "", isArtifact: false, concealed: false, note: null, resource: null });
	});
});

describe("the card text", () => {
	it("names all three tiers for both moves", () => {
		for (const results of [knowThingsArtifactResults(), seekInsightArtifactResults()]) {
			expect(Object.keys(results).sort()).toEqual(["failure", "partial", "success"]);
			for (const v of Object.values(results)) expect(v.length).toBeGreaterThan(0);
		}
	});

	it("keeps the 10+/7-9 line the book draws", () => {
		const r = knowThingsArtifactResults();
		expect(r.success).toMatch(/write-up|custom move/i);
		expect(r.partial).toMatch(/inkling|still owed/i);
		expect(r.failure).toMatch(/path|learn/i);
	});

	it("keeps Seek Insight's 3-and-1 question count", () => {
		const r = seekInsightArtifactResults();
		expect(r.success).toMatch(/3 questions/);
		expect(r.partial).toMatch(/1 question/);
	});
});

describe("the reference lists", () => {
	it("carries the six Seek Insight questions", () => {
		expect(ARTIFACT_INSIGHT_QUESTIONS).toHaveLength(6);
		expect(ARTIFACT_INSIGHT_QUESTIONS).toContain("What here is not what it appears to be?");
	});

	it("carries p.431's ways to leave a path forward", () => {
		expect(ARTIFACT_LEAD_SUGGESTIONS.length).toBeGreaterThanOrEqual(4);
		expect(ARTIFACT_LEAD_SUGGESTIONS.join(" ")).toMatch(/Make a Plan/);
		expect(ARTIFACT_LEAD_SUGGESTIONS.join(" ")).toMatch(/love letter/);
	});
});
