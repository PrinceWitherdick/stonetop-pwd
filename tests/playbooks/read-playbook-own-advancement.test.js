import { describe, it, expect } from "vitest";
import { buildPageRuns, H, BOX, TICK, B, BI, I } from "../fakes/pdf-page-builder.js";
import { readPlaybook, assemblePlaybook } from "../../module/playbooks/pdf/read-playbook.js";
import { normalizeBundle, bundleToItemData, MARK_WRITE_IN_LABEL } from "../../module/playbooks/homebrew-bundle.js";

// What the live import of a playbook that levels up its own way (the Familiar Face, 2026-11-12)
// read wrong or left out, rebuilt on a page of our own words: an HP the template printed twice,
// special possessions every character starts with (no boxes, a bold name per paragraph), a question
// per place of origin and a place to write in, a "Mark one:" list with a "(discuss with GM)" blank,
// things done "Once", and its own Level Up list, whose last option wraps back to the margin.
function neighbour() {
	const runs = buildPageRuns([{ columns: [
		{ x: 30, lines: [
			H("The Neighbour", "", 24),
			[I("Everyone has one. Yours is you.")],
			H("Stats", "Assign these scores: +1, +1, +1, +0, +0, -1."),
			["d6"],
			{ gap: 10 },
			H("Moves", "You start with Gossip and 1 move of your choice."),
			TICK(B("GOSSIP")),
			["When you ", BI("share what you heard"), ", ask the GM"],
			["one question."],
			{ gap: 10 },
			BOX(B("KNACK")),
			["There's one thing you do best. Mark one:"],
			BOX("Baking bread for the whole lane."),
			BOX("Finding what others have lost."),
			BOX("(discuss with GM)"),
			["While ", BI("doing your knack"), ", roll with advantage."],
			{ gap: 10 },
			BOX(B("HANDY")),
			["Once per session, you can mend something"],
			["that broke."],
		] },
		// Below the Stats and Moves lines, which run on across two columns as the template's do.
		{ x: 220, y: 300, lines: [
			H("Growing Older"),
			["When you ", BI("Level Up"), ", mark one of the following"],
			["(in any order) instead of the usual effect:"],
			BOX("Increase one of your stats (to a max of +2)."),
			BOX("Increase your max HP to 14."),
			BOX("Increase your damage die to a d8."),
			BOX("Choose a new move from your playbook."),
			BOX("Work with the GM to choose a move from"),
			["any other playbook, as long as you meet its"],
			["requirements."],
			{ gap: 10 },
			["When you ", BI("Level Up to Level 3 or higher"), ","],
			["you can change to another playbook."],
		] },
		{ x: 423, lines: [
			H("Background", "(Choose 1)"),
			BOX(B("WELL-KNOWN")),
			["Everyone knows your face."],
			{ gap: 10 },
			["Once, you can ", BI("call in a favour"), " from anyone"],
			["in the village."],
			{ gap: 10 },
			H("Place of origin, story, and name"),
			["Where were you before? Tell us more."],
			BOX(B("Stonetop"), ": What do you love about it?"),
			BOX(B("Marshedge"), ": Who did you leave behind?"),
			BOX(B("Tell Us"), ":      (discuss with GM)"),
		] },
		{ x: 599, lines: [
			H("Special possessions"),
			["You begin play with the following:"],
			{ gap: 10 },
			[B("Your trade's tools"), ", the things your work"],
			["needs. Who taught you to use them?"],
			{ gap: 10 },
			[B("A keepsake"), ", small and precious. Who"],
			["gave it to you?"],
		] },
	] }]);
	// The template's HP label, drawn twice on one spot: its own "16" as a white outline first, then
	// the ink the creator retyped. pdf.js hands runs over in the order they were drawn.
	runs.pages[0].runs.push(
		{ str: "HP (max 16)", x: 120, y: 87.5, w: 42, size: 8, font: "f3" },
		{ str: "HP (max 12)", x: 120, y: 87.5, w: 42, size: 8, font: "f3" },
	);
	return runs;
}

const read = () => {
	const { draft, report } = readPlaybook(neighbour());
	const { bundle } = assemblePlaybook(draft);
	return { draft, report, bundle: normalizeBundle(bundle).bundle };
};

describe("a playbook that levels up its own way", () => {
	it("takes the HP that shows when the box holds two, and asks nothing about it", () => {
		const { draft, report, bundle } = read();
		expect(bundle.playbook.hp).toBe(12);
		expect(draft.confirm.find(c => c.key === "hp")).toBeUndefined();
		expect(report.sections).toContain("HP (max 12): the 16 printed under it is the template's own, hidden by it");
	});

	it("still asks when the two numbers aren't drawn one on the other", () => {
		const runs = neighbour();
		runs.pages[0].runs.at(-1).y += 40;
		const { draft } = readPlaybook(runs);
		expect(draft.confirm.find(c => c.key === "hp")).toMatchObject({ value: null, choices: [16, 12] });
	});

	it("reads possessions with no boxes as ones every character starts with, nothing to pick", () => {
		const { bundle } = read();
		expect(bundle.playbook.possessions).toEqual({
			pickCount: 0,
			pickNote: "You begin play with the following:",
			options: [
				{ label: "Your trade's tools", description: "The things your work needs. Who taught you to use them?", preselected: true },
				{ label: "A keepsake", description: "Small and precious. Who gave it to you?", preselected: true },
			],
		});
		expect(bundle.playbook.notes).not.toMatch(/Special possessions/);
	});

	it("keeps each place's question with the place, and a place to write in", () => {
		const { bundle } = read();
		expect(bundle.playbook.originNote).toBe("Where were you before? Tell us more.");
		expect(bundle.playbook.origin).toEqual([
			{ region: "Stonetop", names: [], question: "What do you love about it?", writeIn: false },
			{ region: "Marshedge", names: [], question: "Who did you leave behind?", writeIn: false },
			{ region: "Somewhere else", names: [], question: "", writeIn: true },
		]);
		expect(bundle.playbook.notes).not.toMatch(/origin/i);
	});

	it("reads its own Level Up, the wrapped last option whole, and keeps the words as a note", () => {
		const { draft, report, bundle } = read();
		expect(bundle.playbook.advancement).toEqual({
			replacesUsual: true,
			options: [
				"Increase one of your stats (to a max of +2).",
				"Increase your max HP to 14.",
				"Increase your damage die to a d8.",
				"Choose a new move from your playbook.",
				"Work with the GM to choose a move from any other playbook, as long as you meet its requirements.",
			],
			note: "When you Level Up to Level 3 or higher, you can change to another playbook.",
			switchPlaybook: false,
		});
		expect(report.sections).toContain("Its own Level Up (5 advances) → Level Up");
		expect(bundle.playbook.notes).toContain("\n- Work with the GM to choose a move from any other playbook, as long as you meet its requirements.\n");
		// Placed: nothing left for the GM to settle about it.
		expect(draft.blocks.find(b => b.title === "Growing Older")).toMatchObject({ kind: "note", unsure: false });
	});

	it("stores what each advance does, for Level Up to act on", () => {
		const { bundle } = read();
		const { advancement } = bundleToItemData(bundle, { slug: "homebrew-the-neighbour" }).playbook.flags.stonetop;
		expect(advancement.replacesUsual).toBe(true);
		expect(advancement.options.map(({ slug, label, ...does }) => does)).toEqual([
			{ kind: "stat", max: 2 },
			{ kind: "hp", to: 14 },
			{ kind: "damage", die: "d8" },
			{ kind: "move" },
			{ kind: "otherMove" },
		]);
		expect(new Set(advancement.options.map(o => o.slug)).size).toBe(5);
	});

	it("makes a 'Mark one:' list the move's boxes, its '(discuss with GM)' one to write in, printed once", () => {
		const knack = read().bundle.moves.find(m => m.name === "Knack");
		expect(knack.marks).toEqual(["Baking bread for the whole lane.", "Finding what others have lost.", MARK_WRITE_IN_LABEL]);
		expect(knack.description).toBe("There's one thing you do best. Mark one:\n\nWhile ***doing your knack***, roll with advantage.");
	});

	it("gives a box to mark what is done once: a background's 'Once, you can', a move's 'Once per session'", () => {
		const { bundle } = read();
		expect(bundle.playbook.backgrounds[0].track).toEqual({ label: "Used", max: 1 });
		expect(bundle.moves.find(m => m.name === "Handy").resource).toMatchObject({ max: 1, title: "Used this session" });
		expect(bundle.moves.find(m => m.name === "Gossip").resource).toBeNull();
	});
});
