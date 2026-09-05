import { describe, it, expect } from "vitest";
import {
	RELMAP_KINS, RELMAP_KIN_CHILD, RELMAP_KIN_DEFAULT, RELMAP_KIN_NONE, RELMAP_KIN_PARENT,
	RELMAP_KIN_PARTNER, RELMAP_KIN_UNSET, generationOf, guessKin, households, isKin, kinTies,
	normalizeKin, readKin, unmarkedKin,
} from "../../module/utils/relmap-kin.js";
import { graphOf as boardOf } from "../fakes/relmap-graph.js";

// Which lines on a relationship map say FAMILY, and the household they add up to.
//
// Two claims are worth holding here, and both are about the map being somebody's own writing rather
// than a form they filled in:
//
//  • the guess reads the caption the way the caption is written, first person about the second, and
//    it does not go off on a word that merely CONTAINS one of its own; and
//  • it never overrules an answer a reader has already given, including "not a family tie", which
//    is the answer somebody gives precisely when the caption is misleading.

/** This file's ties read `[a, b, kin, label]`; the stored shape is tests/fakes/relmap-graph.js. */
const graphOf = (people, ties = []) =>
	boardOf(people, ties.map(([a, b, kin, label = ""]) => [a, b, { kin, label }]));

describe("what a family tie is", () => {
	it("reads anything it does not know as not-family", () => {
		expect(normalizeKin("cousin")).toBe(RELMAP_KIN_DEFAULT);
		expect(normalizeKin(undefined)).toBe(RELMAP_KIN_DEFAULT);
		expect(normalizeKin(RELMAP_KIN_PARENT)).toBe(RELMAP_KIN_PARENT);
		expect(isKin(RELMAP_KIN_NONE)).toBe(false);
		expect(isKin(RELMAP_KIN_PARTNER)).toBe(true);
	});

	// THE DISTINCTION "find family ties" RESTS ON. A line nobody has been asked about is not the
	// same as a line somebody has looked at and called not-family, even though both draw as
	// nothing. Collapse them and the button overturns that answer every time it is pressed.
	it("tells a line nobody has answered for from one answered with a firm no", () => {
		expect(readKin(undefined)).toBe(RELMAP_KIN_UNSET);
		expect(readKin("")).toBe(RELMAP_KIN_UNSET);
		expect(readKin(RELMAP_KIN_NONE)).toBe(RELMAP_KIN_NONE);
		expect(RELMAP_KINS).not.toContain(RELMAP_KIN_UNSET);
	});

	// A newer version's key is an ANSWER, not an absence: it can only have come from somebody
	// marking that line on a client that knows a tie this one does not.
	it("treats a tie it has never heard of as answered, not as unanswered", () => {
		expect(readKin("half-sibling")).toBe(RELMAP_KIN_NONE);
	});
});

describe("guessing a family tie from the writing on a line", () => {
	// The caption is written about the FIRST person and aimed at the second, the way the field's
	// own placeholder is ("secretly in love with"), so "mother" means the first is the second's.
	it("reads a caption first-person-about-the-second", () => {
		expect(guessKin("her mother")).toBe(RELMAP_KIN_PARENT);
		expect(guessKin("his son")).toBe(RELMAP_KIN_CHILD);
		expect(guessKin("wife")).toBe(RELMAP_KIN_PARTNER);
		expect(guessKin("stepfather")).toBe(RELMAP_KIN_PARENT);
		expect(guessKin("adopted daughter")).toBe(RELMAP_KIN_CHILD);
	});

	// ⚠ THE ONE THAT MATTERS. "smothered" contains "mother", and a substring match would mark a
	// murder as a birth. Whole words only, and the compounds worth catching are spelled out in the
	// word list where they can be argued with.
	it("does not go off on a word that merely contains one of its own", () => {
		expect(guessKin("smothered her at the mill")).toBe(RELMAP_KIN_NONE);
		expect(guessKin("childhood friends")).toBe(RELMAP_KIN_NONE);
		expect(guessKin("sonorous, and knows it")).toBe(RELMAP_KIN_NONE);
	});

	it("says nothing about a line that says nothing about family", () => {
		expect(guessKin("")).toBe(RELMAP_KIN_NONE);
		expect(guessKin(null)).toBe(RELMAP_KIN_NONE);
		expect(guessKin("secretly in love with")).toBe(RELMAP_KIN_NONE);
	});

	// The word at the HEAD of the phrase is the one the sentence is about.
	it("takes the earliest word when a caption names two", () => {
		expect(guessKin("mother of his son")).toBe(RELMAP_KIN_PARENT);
		expect(guessKin("son of her mother")).toBe(RELMAP_KIN_CHILD);
	});
});

describe("which lines the finder offers to mark", () => {
	const graph = graphOf(["a", "b", "c", "d"], [
		["a", "b", RELMAP_KIN_UNSET, "her mother"],
		["b", "c", RELMAP_KIN_NONE, "smothered him, and everyone knows the word"],
		["c", "d", RELMAP_KIN_UNSET, "drinks with"],
		["a", "d", RELMAP_KIN_PARENT, "her father"],
	]);

	it("offers only the unanswered lines whose writing names a tie", () => {
		expect(unmarkedKin(graph)).toEqual([{ id: "e00", kin: RELMAP_KIN_PARENT }]);
	});

	// The line called "not a family tie" was called that BY somebody, and its caption is exactly
	// the misleading kind that made them bother. Pressing the button again must not undo it.
	it("leaves a line somebody has already answered for alone, a firm no included", () => {
		// The reader looked at "her mother", decided it was somebody's turn of phrase and not a
		// birth, and said so. Pressing the button a second time must not put it back.
		const answered = {
			...graph,
			edges: { ...graph.edges, e00: { ...graph.edges.e00, kin: RELMAP_KIN_NONE } },
		};
		expect(unmarkedKin(answered)).toEqual([]);
	});
});

describe("the family a map's lines describe", () => {
	it("collapses parent and child into one direction", () => {
		const ties = kinTies(graphOf(["ma", "kid"], [["kid", "ma", RELMAP_KIN_CHILD]]));
		expect(ties.parents.get("kid")).toEqual(["ma"]);
		expect(ties.children.get("ma")).toEqual(["kid"]);
	});

	// Somebody drew the tie twice from both ends and got one of them backwards. There is no
	// generation order that satisfies both, so one is dropped, and WHICH is decided by the line ids
	// rather than by the order a flag merge left the object in.
	it("drops the reverse of a descent already recorded, the same way on every client", () => {
		const both = graphOf(["a", "b"], [
			["a", "b", RELMAP_KIN_PARENT],
			["b", "a", RELMAP_KIN_PARENT],
		]);
		const ties = kinTies(both);
		expect(ties.parents.get("b")).toEqual(["a"]);
		expect(ties.parents.has("a")).toBe(false);
	});

	it("draws one bar for a couple however many times the tie was drawn", () => {
		const ties = kinTies(graphOf(["a", "b"], [
			["a", "b", RELMAP_KIN_PARTNER],
			["b", "a", RELMAP_KIN_PARTNER],
		]));
		expect(ties.partners).toEqual([["a", "b"]]);
	});

	it("keeps out everybody no family line touches", () => {
		const ties = kinTies(graphOf(["ma", "kid", "stranger"], [["ma", "kid", RELMAP_KIN_PARENT]]));
		expect(ties.people).toEqual(["kid", "ma"]);
	});
});

describe("which generation everybody is in", () => {
	it("counts down from whoever has no recorded parents", () => {
		const ties = kinTies(graphOf(["gran", "ma", "kid"], [
			["gran", "ma", RELMAP_KIN_PARENT],
			["ma", "kid", RELMAP_KIN_PARENT],
		]));
		const rows = generationOf(ties);
		expect(rows.get("gran")).toBe(0);
		expect(rows.get("ma")).toBe(1);
		expect(rows.get("kid")).toBe(2);
	});

	// The two rules pull against each other: levelling a couple can push their children down, and
	// that can push a grandchild down again. Relaxed together rather than applied once each.
	it("seats partners on one row, and pushes what hangs off them down to suit", () => {
		const ties = kinTies(graphOf(["gran", "ma", "pa", "kid"], [
			["gran", "ma", RELMAP_KIN_PARENT],
			["ma", "pa", RELMAP_KIN_PARTNER],
			["pa", "kid", RELMAP_KIN_PARENT],
		]));
		const rows = generationOf(ties);
		// `pa` has no parents at all and would sit at the top on his own; his wife's line puts him
		// beside her instead, and his child one row below both of them.
		expect(rows.get("pa")).toBe(rows.get("ma"));
		expect(rows.get("kid")).toBe(rows.get("ma") + 1);
	});

	// ⚠ A loop cannot settle, so the relaxation spends its whole budget pushing people down and
	// they come out at rows sixteen, seventeen and eighteen. Drawn as given that is a chart
	// nineteen generations tall with three people at the bottom of it.
	it("does not let a loop of parents inflate the chart", () => {
		const ties = kinTies(graphOf(["a", "b", "c"], [
			["a", "b", RELMAP_KIN_PARENT],
			["b", "c", RELMAP_KIN_PARENT],
			["c", "a", RELMAP_KIN_PARENT],
		]));
		const rows = [...generationOf(ties).values()];
		expect(Math.max(...rows)).toBe(2);
		expect(new Set(rows).size).toBe(3);
	});
});

describe("the households a map describes", () => {
	const ties = kinTies(graphOf(["ma", "pa", "kid", "other"], [
		["ma", "pa", RELMAP_KIN_PARTNER],
		["ma", "kid", RELMAP_KIN_PARENT],
		["pa", "kid", RELMAP_KIN_PARENT],
		["ma", "other", RELMAP_KIN_PARENT],
	]));

	// ONE household for a couple and their children, not a bar beside a separate descent from the
	// same two people: the bar is what the children hang from.
	it("gathers a couple and the children they share into one", () => {
		const shared = households(ties).find(home => home.parents.join("|") === "ma|pa");
		expect(shared.children).toEqual(["kid"]);
	});

	it("keeps a child by one recorded parent in a household of their own", () => {
		const alone = households(ties).find(home => home.parents.join("|") === "ma");
		expect(alone.children).toEqual(["other"]);
	});

	// Two people who share a child are ONE household, whether or not anybody ever drew the line
	// between them -- which is what lets the drawing run a bar between them. That it does is
	// relmap-tree's own test; that they are one household is this one.
	it("gathers two parents of one child into one household with no partner line", () => {
		const bare = kinTies(graphOf(["ma", "pa", "kid"], [
			["ma", "kid", RELMAP_KIN_PARENT],
			["pa", "kid", RELMAP_KIN_PARENT],
		]));
		expect(households(bare)).toHaveLength(1);
		expect(households(bare)[0].parents).toEqual(["ma", "pa"]);
	});
});
