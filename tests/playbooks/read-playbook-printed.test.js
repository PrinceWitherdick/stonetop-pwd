import { describe, it, expect } from "vitest";
import { buildPageRuns, H, BOX, TICK, B, BI, PIPS } from "../fakes/pdf-page-builder.js";
import { readPlaybook, assemblePlaybook } from "../../module/playbooks/pdf/read-playbook.js";

// What a playbook printed to PDF taught the reader (the Abhorsen-in-Waiting, 2026-11-14, read back
// through its glyph table), rebuilt on a page of our own: a move's caps name over two lines, and
// one with a footnote's asterisk; a footnote set small under the moves; bullets drawn as marks, so
// a bullet's next line can start with a capital; a currency one move holds and others spend; a
// question section opening on words of its own, each question named by a bold line, set with a
// hanging indent and a row of dashes; an introduction whose step number sits between two lines.

const DOT = { t: "•", f: "ding" };
const DIGIT = n => ({ tokens: [{ t: String(n), f: "heading", size: 9 }] });
// A bullet as a printed PDF has it: the mark, and its words set in from it.
const BUL = text => [{ tokens: [DOT] }, { gap: -9.5 }, { indent: 9, tokens: [text] }];

const PAGE = buildPageRuns([{ columns: [
	{ x: 30, lines: [
		H("The Bell"),
		["Every village has a bell, and every"],
		["bell a keeper. Most call you simply:"],
		["the ringer."],
		{ gap: 6 },
		[B("Care of the Bell")],
		["The bell is… (choose 1)"],
		BOX("… old as the village"),
		BOX("… newly cast"),
		{ gap: 6 },
		["When the bell rings, the whole of"],
		{ indent: 9, tokens: ["the valley hears it… (choose"] },
		{ indent: 9, tokens: ["2 or 3)"] },
		BOX("… even the dead"),
		BOX("… only the faithful"),
		["-----"],
		BOX("… when it first rang upon the"),
	] },
	{ x: 220, lines: [
		H("Introductions"),
		DIGIT(4), { gap: -9.5 },
		{ indent: 18, tokens: ["On your next turn, answer one of these."] },
		BOX("Who rings with you?"),
		BOX("Do you have a plan to find a new bell or a"),
		["replacement rope?"],
		DIGIT(6), { gap: -9.5 },
		{ indent: 18, tokens: ["On your next turn, ask one of these."] },
		BOX("Which of you hears the bell?"),
		{ indent: 18, tokens: ["Go around again. Ask another"] },
		{ gap: -4.5 }, DIGIT(7), { gap: -5 },
		{ indent: 18, tokens: ["or pass."] },
	] },
	{ x: 423, lines: [
		H("The Bellringer", "", 24),
		["Keeper of the village bell. A second sentence."],
		H("Background", "(Choose 1)"),
		BOX(B("THE HEIR")),
		["You were raised in the tower, and have inherited an Old Rope, go mark that move now."],
		BOX(B("THE WANDERER")),
		["You have a belfry in addition to your usual choice of special possessions (go mark it now)."],
		H("Special possessions", "(Pick 1)"),
		BOX(B("Belfry"), ": a tower and its stair."),
		BOX(B("Bell hammer"), ": heavy."),
	] },
] }, { columns: [
	{ x: 27, lines: [
		H("Moves", "You start with Toll."),
		TICK(B("TOLL")),
		["When you ", BI("ring the bell"), ", hold 2 Peal. Roll +WIS: on a 10+, choose two; on a 7-9, choose one:"],
		...BUL("Everyone within earshot stops to listen"),
		{ indent: 9, tokens: ["and turns to the tower"] },
		...BUL("The dead within earshot lie still"),
		...BUL("Bring one listener with you to the"),
		{ indent: 9, tokens: ["Last Bell immediately"] },
		["On a 6-, the bell cracks."],
		BOX(B("I CAN'T STOP RINGING")),
		[B("THE BELLS")],
		["When you ", BI("ring through the night"), ", spend 4 Peal and mark XP."],
		BOX(B("OLD ROPE"), " ", PIPS(2)),
		["You have a rope (2 uses, slow) that never frays."],
		BOX(B("THE RINGER'S DOOR"), " *"),
		["(Requires level 6+ and Toll)"],
		["When you are dying, ring once more."],
		BOX(B("I DON'T SLEEP")),
		["You never sleep."],
		{ tokens: ["* The first time you use any move marked with an asterisk, cross off the bell."], size: 7 },
	] },
] }], { shuffle: true });

const read = readPlaybook(PAGE);
const { bundle } = assemblePlaybook(read.draft);
const move = name => bundle.moves.find(m => m.name === name);
const lore = title => bundle.playbook.lore.find(l => l.title === title);

describe("reading a playbook printed to PDF", () => {
	it("title-cases a caps name without capitalising after an apostrophe", () => {
		expect(move("I Don't Sleep")).toBeTruthy();
	});

	it("joins a caps name that runs over two lines", () => {
		expect(move("I Can't Stop Ringing the Bells")?.description).toMatch(/^When you \*\*\*ring through the night\*\*\*/);
	});

	it("keeps a footnote's asterisk on the move's name, and reads its requirement", () => {
		expect(move("The Ringer's Door*")).toMatchObject({ level: 6, requiresMoves: ["Toll"], description: "When you are dying, ring once more." });
	});

	it("reads a footnote set small as a note, not as the last move's words", () => {
		expect(move("I Don't Sleep").description).toBe("You never sleep.");
		expect(bundle.playbook.notes).toMatch(/Footnote:\n\* The first time you use any move marked with an asterisk/);
	});

	it("tells a marked bullet's next line from a new bullet, whatever its first letter", () => {
		expect(move("Toll").description).toContain(
			"- Everyone within earshot stops to listen and turns to the tower\n- The dead within earshot lie still\n- Bring one listener with you to the Last Bell immediately");
	});

	it("gives a currency held with no track printed a track as big as any move counts", () => {
		expect(move("Toll").resource).toMatchObject({ title: "Peal", max: 4 });
	});

	it("names a pip track by its uses when the move counts them", () => {
		expect(move("Old Rope").resource).toMatchObject({ title: "Uses", max: 2 });
	});

	it("names a question by its bold line, and keeps the section's opening words as a note", () => {
		expect(lore("Care of the Bell")).toMatchObject({ description: "The bell is… (choose 1)" });
		const note = read.draft.blocks.find(b => b.kind === "note" && b.title === "The Bell");
		expect(note.text).toBe("Every village has a bell, and every bell a keeper. Most call you simply: the ringer.");
	});

	it("carries a hanging indent on, drops a row of dashes, and gives a blank after \"upon the\" back", () => {
		const q = bundle.playbook.lore.find(l => /the valley hears/.test(l.description));
		expect(q.description).toBe("When the bell rings, the whole of the valley hears it… (choose 2 or 3)");
		expect(q.options.map(o => o.description)).toEqual(["… even the dead", "… only the faithful", "… when it first rang upon the ___"]);
	});

	it("reads an introduction's question back at the column's edge, and a step number set under its line", () => {
		expect(bundle.playbook.introductions.step4).toEqual(["Who rings with you?", "Do you have a plan to find a new bell or a replacement rope?"]);
		expect(bundle.playbook.introductions.step6).toEqual(["Which of you hears the bell?"]);
	});

	it("links a background's move it says to mark, and a possession it gives on top of the pick", () => {
		const bg = label => bundle.playbook.backgrounds.find(b => b.label === label);
		expect(bg("The Heir").moves).toEqual(["Old Rope"]);
		expect(bg("The Wanderer").possessions).toEqual(["Belfry"]);
	});
});
