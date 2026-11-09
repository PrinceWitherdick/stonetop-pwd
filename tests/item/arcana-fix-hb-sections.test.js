import { describe, it, expect, vi } from "vitest";
import {
	insertMysteryHtml, insertConsequenceHtml, consequenceHtml, mysteryHtml, markTrackHtml,
	validateArcanumFlags, arcanumHasUnlockStep, consequenceTally,
} from "../../module/item/arcanum-edit.js";
import { parseArcanumMoves } from "../../module/data/arcana-moves.js";
import { consequenceBoxRange } from "../../module/actors/character/CharacterArcana.js";
import { arcanumCurse } from "../../module/data/arcana-curses.js";
import { arcanumKinds } from "../../module/data/arcana-facets.js";

// HB-2: the editor's Mystery / Consequence buttons used to append bare blocks to the end of the
// back, with no Moves or Consequences heading. Every parser the sheet runs on a major keys on those
// headings, so a guided-button major had no clickable mysteries, no Power chip, no curse badge and
// no Consequence ladder. These run the REAL parsers on what the buttons now write.

const press = (steps, start = "") => steps.reduce((html, step) => step(html), start);
const mystery = name => html => insertMysteryHtml(html, name);
const consequence = weight => html => insertConsequenceHtml(html, weight);

const card = back => ({
	slug: "arc-x", major: true,
	front: { title: "T", item: null, description: "", unlock: { description: markTrackHtml(4), requirements: [] } },
	back:  { title: "B", description: back, move: null, resource: null },
});

describe("HB-2: the Mystery and Consequence buttons write the sections the sheet reads", () => {
	it("a mystery and three consequences parse as a move and a Consequences range", () => {
		const back = press([mystery("STORM CALL"), consequence(1), consequence(2), consequence(1)]);
		const moves = parseArcanumMoves(back);
		expect(moves.map(m => [m.name, m.boxIndex])).toEqual([["STORM CALL", 0]]);
		// The mystery's □ is box 0; the consequences' four □ follow it.
		expect(consequenceBoxRange(back)).toEqual({ from: 1, to: 5 });
		expect(arcanumCurse(card(back))).not.toBeNull();
		expect(arcanumKinds(card(back))).toContain("power");
	});

	it("makes each heading once, Moves before Consequences, whatever order the buttons are pressed in", () => {
		const back = press([consequence(1), mystery("FIRST GIFT"), consequence(3), mystery("SECOND GIFT")], "<p>Intro.</p>");
		expect(back.match(/<h3>Moves<\/h3>/g)).toHaveLength(1);
		expect(back.match(/<h3>Consequences<\/h3>/g)).toHaveLength(1);
		expect(back.indexOf("<h3>Moves</h3>")).toBeLessThan(back.indexOf("<h3>Consequences</h3>"));
		expect(back.startsWith("<p>Intro.</p>")).toBe(true);
		// Both mysteries are moves, in the order pressed, ahead of every Consequence box.
		expect(parseArcanumMoves(back).map(m => [m.name, m.boxIndex])).toEqual([["FIRST GIFT", 0], ["SECOND GIFT", 1]]);
		expect(consequenceBoxRange(back)).toEqual({ from: 2, to: 6 });
		// One list, two items.
		expect(back.match(/<ul>/g)).toHaveLength(1);
		expect(consequenceTally(back)).toEqual({ consequences: 2, boxes: 4 });
	});

	it("adds a consequence inside an existing list, after its nested items", () => {
		const start = "<h3>Consequences</h3><ul><li>□ One<ul><li>□ Sub</li></ul></li></ul><p>After.</p>";
		const back = insertConsequenceHtml(start, 2);
		expect(back).toBe(`<h3>Consequences</h3><ul><li>□ One<ul><li>□ Sub</li></ul></li>${consequenceHtml(2)}</ul><p>After.</p>`);
		expect(consequenceBoxRange(back)).toEqual({ from: 0, to: 4 });
	});

	it("puts a list under a Consequences heading that has none yet, before the next heading", () => {
		const back = insertConsequenceHtml("<h3>Consequences</h3><p>Mark these.</p><h3>Notes</h3><p>n</p>", 1);
		expect(back).toBe(`<h3>Consequences</h3><p>Mark these.</p><ul>${consequenceHtml(1)}</ul><h3>Notes</h3><p>n</p>`);
	});

	it("adds a mystery at the end of an existing Moves section, not after the Consequences", () => {
		const start = `<h3>Moves</h3>${mysteryHtml("OLD ONE")}<h3>Consequences</h3><ul>${consequenceHtml(1)}</ul>`;
		const back = insertMysteryHtml(start, "NEW ONE");
		expect(parseArcanumMoves(back).map(m => m.name)).toEqual(["OLD ONE", "NEW ONE"]);
		expect(back.indexOf("NEW ONE")).toBeLessThan(back.indexOf("<h3>Consequences</h3>"));
	});

	it("consequence lines are list items weighted 1-3", () => {
		expect(consequenceHtml(2)).toMatch(/^<li>□□ /);
		expect(consequenceHtml(9)).toMatch(/^<li>□□□ /);
	});
});

describe("HB-4 / A14: the editor warns when nothing unlocks the card", () => {
	const flags = unlock => ({
		slug: "x",
		front: { title: "T", description: "<p>f</p>", unlock: { description: "", requirements: [], ...unlock } },
		back:  { title: "B", description: "<p>p</p>" },
	});
	const warned = f => validateArcanumFlags(f).some(i => i.level === "warn" && /Nothing on the front unlocks/.test(i.message));

	it("warns for a card with no option, no ○, no □ and no front tasks", () => {
		expect(arcanumHasUnlockStep(flags({}))).toBe(false);
		expect(warned(flags({}))).toBe(true);
	});

	it("counts each kind of step", () => {
		expect(warned(flags({ requirements: [{ type: "option", slug: "a", description: "Do it", max: 1 }] }))).toBe(false);
		expect(warned(flags({ description: "<p>○○○ When you make the last mark...</p>" }))).toBe(false);
		expect(warned(flags({ description: "<p>To unlock it, □ decipher it, □ find the key.</p>" }))).toBe(false);
		const tasks = { slug: "x", front: { title: "T", description: "<ul><li>□ Climb it</li><li>□ Name it</li></ul>", unlock: { description: "<p>When you've completed all the tasks, it unlocks.</p>", requirements: [] } }, back: { title: "B", description: "<p>p</p>" } };
		expect(warned(tasks)).toBe(false);
	});

	it("does not count a text row, or a display-only glyph", () => {
		expect(warned(flags({ requirements: [{ type: "text", content: "And then..." }] }))).toBe(true);
		expect(warned(flags({ description: '<p>Its <span class="stonetop-glyph-label">○○</span> mark.</p>' }))).toBe(true);
	});
});

describe("HB-14: Book I p.446 rubric warnings for majors (advice, never a block)", () => {
	const major = back => ({ slug: "x", major: true, front: { title: "T", description: "<p>f</p>", unlock: { description: "<p>○○○</p>", requirements: [] } }, back: { title: "B", description: back } });
	const messages = f => validateArcanumFlags(f).map(i => i.message);

	it("warns for □ on the back with no Consequences heading", () => {
		expect(messages(major("<p>□ A cost.</p>")).some(m => /no Consequences heading/.test(m))).toBe(true);
	});

	it("warns below 5 consequences and away from ~8 boxes; quiet on a card in range", () => {
		const few = press([consequence(1), consequence(1)]);
		const msgs = messages(major(few));
		expect(msgs.some(m => /5-10 Consequences.*has 2/.test(m))).toBe(true);
		expect(msgs.some(m => /about 8 .*has 2/.test(m))).toBe(true);
		const good = press([1, 2, 1, 2, 1, 1].map(consequence));
		expect(messages(major(good)).some(m => /Book I p\.446/.test(m))).toBe(false);
		expect(validateArcanumFlags(major(good)).every(i => i.level !== "error" || /Slug|title/.test(i.message))).toBe(true);
	});

	it("leaves minors alone", () => {
		const minor = { ...major("<p>□ A cost.</p>"), major: false };
		expect(messages(minor).some(m => /Consequences/.test(m))).toBe(false);
	});
});

describe("HB-10: the Inspire wizard's rolls go to the GM notes, not the front", () => {
	it("hands them on as gmNotes for the card's creation, with no second write", async () => {
		const { StonetopArcanaInspireDialog } = await import("../../module/item/StonetopArcanaInspireDialog.js");
		const created = { flags: { stonetop: {} }, update: vi.fn(async () => {}) };
		const onCreate = vi.fn(async () => created);
		const dlg = new StonetopArcanaInspireDialog({ onCreate });
		dlg.render = vi.fn();
		dlg.close = vi.fn();
		dlg._name = "The Lens";
		dlg._chosenLines = () => [{ label: "Drawback", text: "It hungers." }];
		await dlg._create();
		const [[payload]] = onCreate.mock.calls;
		expect(payload).not.toHaveProperty("front");
		expect(payload.gmNotes).toContain("It hungers.");
		expect(created.update).not.toHaveBeenCalled();
	});
});

describe("HB-14: the Power chip reads every way a back grants power", () => {
	it("an untitled but sized resource, an effect-only move, and a back item's resource", () => {
		expect(arcanumKinds({ back: { resource: { max: 3, title: "" } } })).toEqual(["power"]);
		expect(arcanumKinds({ back: { resource: { maxStat: "wis", title: "" } } })).toEqual(["power"]);
		expect(arcanumKinds({ back: { move: { name: "", description: "<p>Speak and it is so.</p>" } } })).toEqual(["power"]);
		expect(arcanumKinds({ back: { item: { name: "", resource: { max: 3, title: "" } } } })).toEqual(["power"]);
	});

	it("still ignores an empty husk", () => {
		expect(arcanumKinds({ back: { move: { name: "", description: "<p></p>" }, resource: { title: "", max: 0 } } })).toEqual([]);
	});
});
