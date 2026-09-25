import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
	AID_MOVE, INTERFERE_MOVE, PERSUADE_PC_MOVE,
	answerListHtml, answerRowHtml, answerSentence, asksAtTier, askPill, choiceForOption, findPcAnswer,
	heldSource, isPcAskMove, mayAnswer, offersChoice, persuadeTierActions, waitingSentence,
} from "../../module/pc-asks/pc-ask-rules.js";

// Aid, Interfere and Persuade (vs. PCs) are settled by someone other than the character making
// them. These are the rules and words; pc-ask-flow.test.js drives the documents.

const ask = move => ({ move, byId: "aeliana", byName: "Aeliana", targetId: "bram", targetName: "Bram" });

// The moves' own printed lists, as the compendium ships them.
const source = slug => JSON.parse(fs.readFileSync(path.resolve(`packs/src/stonetop-items/basic-moves/${slug}.json`), "utf8"));
const printedItems = slug => [...source(slug).system.description.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);

describe("which moves ask", () => {
	it("is the three basic moves, and not a custom move that shares a name", () => {
		for (const name of [AID_MOVE, INTERFERE_MOVE, PERSUADE_PC_MOVE]) {
			expect(isPcAskMove({ type: "move", name, system: { moveType: "basic" } }), name).toBe(true);
			// A player's own move is the custom-move flag, not moveType "other" (owns-move.js#isPlayerAuthoredMove).
			expect(isPcAskMove({ type: "move", name, system: { moveType: "other" }, flags: { "stonetop-pwd": { custom: true } } }), name).toBe(false);
			// ...so the book's move, stored as "other" with no flag (a GM's drop), is still the book's.
			expect(isPcAskMove({ type: "move", name, system: { moveType: "other" } }), name).toBe(true);
			// A custom move from before the rename still carries its flag under the old scope...
			expect(isPcAskMove({ type: "move", name, system: { moveType: "other" }, flags: { stonetop_pwd: { custom: true } } }), name).toBe(false);
			// ...until the item is cut over, when the new scope is authoritative.
			expect(isPcAskMove({ type: "move", name, system: { moveType: "other" }, flags: { stonetop_pwd: { custom: true }, "stonetop-pwd": { __migratedFrom: "stonetop_pwd" } } }), name).toBe(true);
		}
		expect(isPcAskMove({ type: "move", name: "Defy Danger", system: { moveType: "basic" } })).toBe(false);
	});

	// The names are the compendium's, character for character: a typo here and nothing ever asks.
	it("names each move as the compendium does", () => {
		expect(source("aid").name).toBe(AID_MOVE);
		expect(source("interfere").name).toBe(INTERFERE_MOVE);
		expect(source("persuade-pcs").name).toBe(PERSUADE_PC_MOVE);
	});

	it("asks nothing on a 6-, and Aid, which has no roll, always asks", () => {
		expect(asksAtTier(INTERFERE_MOVE, "failure")).toBe(false);
		expect(asksAtTier(INTERFERE_MOVE, "partial")).toBe(true);
		expect(asksAtTier(PERSUADE_PC_MOVE, "failure")).toBe(false);
		expect(asksAtTier(AID_MOVE, null)).toBe(true);
	});
});

describe("who answers", () => {
	it("is the GM for Aid, and only the GM", () => {
		expect(mayAnswer(ask(AID_MOVE), { isGM: true })).toBe(true);
		expect(mayAnswer(ask(AID_MOVE), { ownsTarget: true })).toBe(false);
	});

	// A GM owns every character, so can answer for a player who has stepped away.
	it("is the other character's player, or a GM, for Interfere and Persuade", () => {
		for (const move of [INTERFERE_MOVE, PERSUADE_PC_MOVE]) {
			expect(mayAnswer(ask(move), { ownsTarget: true })).toBe(true);
			expect(mayAnswer(ask(move), { isGM: true })).toBe(true);
			expect(mayAnswer(ask(move), {})).toBe(false);
		}
	});

	// Two answers given at once would each lay their effect, with nothing to say which stands.
	it("is not the GM while the character's player is here to answer", () => {
		for (const move of [INTERFERE_MOVE, PERSUADE_PC_MOVE]) {
			expect(mayAnswer(ask(move), { isGM: true, ownsTarget: true, playerHere: true })).toBe(false);
			expect(mayAnswer(ask(move), { ownsTarget: true, playerHere: true })).toBe(true);
		}
		expect(mayAnswer(ask(AID_MOVE), { isGM: true, playerHere: true })).toBe(true);
	});
});

describe("the printed options", () => {
	it("reads each of Aid's and Interfere's bullets as its choice, by its words", () => {
		expect(printedItems("aid").map(item => choiceForOption(AID_MOVE, item))).toEqual(["more", "advantage"]);
		expect(printedItems("interfere").map(item => choiceForOption(INTERFERE_MOVE, item))).toEqual(["anyway", "relent"]);
	});

	it("offers Persuade's refusals by tier: say how on a 10+, counter-offer on a 7-9", () => {
		expect(offersChoice(PERSUADE_PC_MOVE, "refuse", "success")).toBe(true);
		expect(offersChoice(PERSUADE_PC_MOVE, "refuse", "partial")).toBe(false);
		expect(offersChoice(PERSUADE_PC_MOVE, "counter", "partial")).toBe(true);
		expect(offersChoice(PERSUADE_PC_MOVE, "agree", "failure")).toBe(false);
	});
});

describe("the answer list", () => {
	const items = printedItems("interfere");

	it("turns the move's own bullets into buttons for the one answering", () => {
		const html = answerListHtml({ ask: ask(INTERFERE_MOVE), items, tier: "success", canAnswer: true });
		expect(html).toContain(`data-pc-answer="anyway"`);
		expect(html).toContain(`data-pc-answer="relent"`);
		// The book's words are the labels: the list is not restated anywhere else.
		expect(html).toContain(items[0]);
		expect(html).not.toContain("stonetop-pc-ask-status");
	});

	it("shows everyone else the options and who decides", () => {
		const html = answerListHtml({ ask: ask(INTERFERE_MOVE), items, tier: "partial", canAnswer: false });
		expect(html).not.toContain("data-pc-answer");
		expect(html).toContain("Bram picks 1.");
	});

	it("marks the pick and fades the rest once answered", () => {
		const html = answerListHtml({ ask: ask(INTERFERE_MOVE), items, tier: "success", answered: "anyway", canAnswer: true });
		expect(html).not.toContain("data-pc-answer");
		expect(html).toMatch(/is-chosen[^>]*>[^]*Do it anyway/);
		expect(html).toContain("is-passed");
		expect(html).toContain("Bram does it anyway, with disadvantage on their next roll.");
	});

	it("leaves the list as printed on a tier that asks nothing", () => {
		expect(answerListHtml({ ask: ask(INTERFERE_MOVE), items, tier: "failure", canAnswer: true })).toBeNull();
	});

	it("says the GM picks on an Aid card for a player", () => {
		const html = answerListHtml({ ask: ask(AID_MOVE), items: printedItems("aid"), canAnswer: false });
		expect(html).toContain("The GM picks 1.");
	});
});

describe("Persuade's answer row", () => {
	it("offers the tier's two answers to the pressed character's player", () => {
		const html = answerRowHtml({ ask: ask(PERSUADE_PC_MOVE), tier: "success", canAnswer: true });
		expect(html).toContain("Do it, and mark XP");
		expect(html).toContain("Refuse, and say how Aeliana could convince you");
		expect(answerRowHtml({ ask: ask(PERSUADE_PC_MOVE), tier: "partial", canAnswer: true })).toContain("Refuse, or make a counter-offer");
	});

	it("is posted saying who decides, one row per tier that asks", () => {
		const rows = persuadeTierActions(ask(PERSUADE_PC_MOVE));
		expect(Object.keys(rows)).toEqual(["success", "partial"]);
		expect(rows.success).toContain(`data-pc-ask-tier="success"`);
		expect(rows.success).toContain("Bram decides.");
	});

	it("becomes the answer once given", () => {
		const html = answerRowHtml({ ask: ask(PERSUADE_PC_MOVE), tier: "partial", answered: "agree", canAnswer: true });
		expect(html).toContain("Bram does what Aeliana wanted, and marks XP.");
		expect(html).not.toContain("<button");
	});
});

describe("the words", () => {
	it("names what promised a held mode", () => {
		expect(heldSource(ask(AID_MOVE))).toBe("Aeliana's Aid");
		expect(heldSource(ask(INTERFERE_MOVE))).toBe("Interfered with by Aeliana");
	});

	it("puts the helper's exposure in both of Aid's answers", () => {
		for (const choice of ["more", "advantage"]) {
			expect(answerSentence(ask(AID_MOVE), choice)).toContain("Aeliana is exposed to any risk, cost, or consequence of it.");
		}
	});

	it("names the target on the roll's pill", () => {
		expect(askPill(ask(INTERFERE_MOVE))).toBe("Foiling Bram");
		expect(askPill(ask(PERSUADE_PC_MOVE))).toBe("Pressing Bram");
	});

	it("escapes a name typed into a character", () => {
		const html = answerListHtml({ ask: { ...ask(INTERFERE_MOVE), targetName: "<b>Bram</b>" }, items: printedItems("interfere"), tier: "success" });
		expect(html).toContain("&lt;b&gt;Bram&lt;/b&gt; picks 1.");
		expect(waitingSentence(ask(PERSUADE_PC_MOVE))).toBe("Bram decides.");
	});
});

describe("finding the answer", () => {
	const message = (id, answer) => ({ id, answer });
	const read = m => m.answer ?? null;

	it("is the message whose answer points at the card", () => {
		const log = [message("m1"), message("m2", { to: "other", choice: "relent" }), message("m3", { to: "ask", choice: "anyway" })];
		expect(findPcAnswer(log, "ask", read)).toEqual({ message: log[2], choice: "anyway" });
		expect(findPcAnswer({ contents: log }, "ask", read)?.choice).toBe("anyway");
	});

	it("is nothing for an unanswered card", () => {
		expect(findPcAnswer([message("m1")], "ask", read)).toBeNull();
		expect(findPcAnswer([], "", read)).toBeNull();
	});
});
