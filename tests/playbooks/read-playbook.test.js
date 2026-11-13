import { describe, it, expect } from "vitest";
import { readPlaybook, assemblePlaybook, INSERT_ALWAYS, INSERT_NONE } from "../../module/playbooks/pdf/read-playbook.js";
import { fontRole, layoutDocument } from "../../module/playbooks/pdf/layout.js";
import { normalizeBundle, bundleToItemData } from "../../module/playbooks/homebrew-bundle.js";
import { buildPageRuns } from "../fakes/pdf-page-builder.js";
import { tester } from "../fakes/tester-playbook-pdf.js";

/** What the reader hands back, with its draft assembled as read (the builder assembles it after review). */
const readAssembled = runs => {
	const read = readPlaybook(runs);
	return { ...read, bundle: read.draft ? assemblePlaybook(read.draft).bundle : null };
};

describe("fonts and layout", () => {
	it("knows the template's faces by name", () => {
		expect(fontRole("GLYMCF+ZapfDingbats")).toBe("dingbat");
		expect(fontRole("GDACDV+ITCZapfDingbatsMedium")).toBe("dingbat");
		expect(fontRole("Avara-Bold")).toBe("heading");
		expect(fontRole("IJYANZ+ACaslonPro-BoldItalic")).toBe("bolditalic");
		expect(fontRole("TIYIRJ+ACaslonPro-Semibold")).toBe("bold");
		expect(fontRole("DDCZPE+ACaslonPro-Regular")).toBe("body");
	});

	it("rebuilds columns and lines from positions, whatever order the runs arrive in", () => {
		const doc = layoutDocument(tester());
		const page1 = doc.pages[0].columns;
		expect(page1.map(c => Math.round(c.left))).toEqual([27, 203, 423, 599]);
		const instinct = page1[3].lines.find(l => l.text === "CURIOSITY");
		expect(instinct.lead).toMatchObject({ boxes: 1, ticked: false });
		const prod = doc.pages[1].columns[0].lines.find(l => l.text.startsWith("PROD Doubt"));
		expect(prod.lead.ticked).toBe(true);
		expect(prod.pips).toEqual([expect.objectContaining({ count: 3, label: "Doubt" })]);
	});

	it("reads an 'n' in a text face as the letter, not a checkbox", () => {
		const runs = buildPageRuns([{ columns: [{ x: 20, lines: [["n is for nothing"], ["more", " ", "lines"], ["and", " ", "more"], ["text", " ", "here"]] }] }]);
		const line = layoutDocument(runs).pages[0].columns[0].lines[0];
		expect(line.lead.boxes).toBe(0);
		expect(line.text).toBe("n is for nothing");
	});
});

describe("reading The Tester", () => {
	const { bundle, report } = readAssembled(tester());
	const pb = bundle.playbook;

	it("finds the name, the blurb and the stats box", () => {
		expect(pb.name).toBe("The Tester");
		expect(pb.description).toBe("Every village needs someone who asks why.");
		expect(pb.statsNote).toBe("Assign these scores: +1, +1, +1, +0, +0, -1.");
		expect(pb.damage).toBe("d8");
		expect(pb.hp).toBe(16);
	});

	it("reads backgrounds, with the moves they give and offer", () => {
		expect(pb.backgrounds.map(b => b.label)).toEqual(["The Prober", "The Borrower"]);
		expect(pb.backgrounds[0].moves).toEqual(["Prod"]);
		expect(pb.backgrounds[1].moveChoice).toEqual(["Frosty", "Poke"]);
	});

	it("reads instincts, looks and origins", () => {
		expect(pb.instinctLabel).toBe("Instinct");
		expect(pb.instincts).toEqual([{ word: "Curiosity", description: "To find out." }, { word: "Caution", description: "To look twice." }]);
		expect(pb.appearance).toEqual([["young", "old"], ["quiet", "loud", "hoarse"]]);
		expect(pb.origin).toEqual([
			{ region: "Stonetop", names: ["Ade", "Bryn", "Cai", "Dafydd", "Efa"], question: "", writeIn: false },
			{ region: "Gordin's Delve", names: [], question: "", writeIn: false },
		]);
	});

	it("reads moves: starting, repeatable, required, rolled, with a track", () => {
		const byName = Object.fromEntries(bundle.moves.map(m => [m.name, m]));
		expect(byName.Prod).toMatchObject({ starting: true, rollType: "int", resource: { max: 3, title: "Doubt" } });
		expect(byName.Prod.description).toMatch(/^When you \*\*\*prod something\*\*\*, roll \+INT/);
		// Read the way the sheet reads a move's tiers (move-tiers.js#parseTiersFromProse).
		expect(byName.Prod.results).toEqual({ success: "It breaks.", partial: "It wobbles.", failure: "It bites." });
		expect(byName["Improved Stat"]).toMatchObject({ repeatMax: 3, starting: false });
		expect(byName["Prod and Poke"]).toMatchObject({ level: 6, requires: "Requires level 6+ and Prod", requiresMoves: ["Prod"] });
		expect(byName["Prod and Poke"].description).toContain("\n- Ask a question\n- Take a step back");
		expect(pb.startingMovesNote).toBe("You start with Prod and 1 of your choice.");
	});

	it("reads possessions, their boxed-in options, and skips the write-in", () => {
		expect(pb.possessions.pickCount).toBe(1);
		expect(pb.possessions.options.map(o => o.label)).toEqual(["Tester's kit", "Notebook", "Weapons"]);
		expect(pb.possessions.options[0].description).toBe("levers, ◇ a mallet");
		expect(pb.possessions.options[1].description).toMatch(/^\(○○○ uses\)/);
		expect(pb.possessions.options[2].description).toContain("\n- Spear, iron (close)\n- Sling (near)");
	});

	it("turns its own question block into lore sections under its heading, each titled by its question", () => {
		const at = pb.lore.findIndex(l => l.title === "Belonging");
		// The heading, as a section with no options: character creation's umbrella over the questions.
		expect(pb.lore[at]).toMatchObject({ description: "", options: [] });
		const [first, second] = pb.lore.slice(at + 1, at + 3);
		expect(first.title).toBe("When you were young they …");
		expect(first.description).toMatch(/\(choose 1 or 2\)$/);
		expect(first.options.map(o => o.freeText ? `✎${o.description}` : o.description)).toEqual(["… ignored you", "… doted on you", "✎Something else"]);
		expect(second).toMatchObject({ title: "Where do you go to think?", description: "Tell us, where do you go to think?", options: [{ freeText: true }] });
	});

	it("reads the Introductions' third turn and both question rounds", () => {
		expect(pb.introductions).toEqual({
			step3: "tell us what you broke.",
			step4: ["Who mended it?", "Who blamed you for it?"],
			step6: ["Which of you laughed?"],
		});
	});

	it("skips the stock inventory sheet and keeps a part beside it as an insert of its own", () => {
		expect(report.pages[2]).toMatch(/stock inventory sheet \(skipped\)/);
		const tinker = bundle.moves.find(m => m.name === "Tinker");
		expect(tinker).toMatchObject({ starting: false, insert: "tester-s-toolbox", insertList: "" });
		expect(pb.inserts[0]).toMatchObject({ name: "Tester's Toolbox", description: "The tools inside you.", unlockedBy: "" });
		expect(pb.notes).not.toContain("The tools inside you.");
	});

	it("survives normalising into Items", () => {
		const { bundle: clean, issues } = normalizeBundle(bundle);
		expect(issues.filter(i => i.severity === "error")).toEqual([]);
		const { playbook, moves } = bundleToItemData(clean, { slug: "homebrew-the-tester", source: "pdf" });
		expect(playbook.flags.stonetop.homebrew.source).toBe("pdf");
		expect(moves.find(m => m.name === "Prod").system.description).toContain("<strong><em>prod something</em></strong>");
	});
});

describe("what the reader flags", () => {
	it("a Drive playbook calls them Drives", () => {
		expect(readAssembled(tester({ drive: true })).bundle.playbook.instinctLabel).toBe("Drive");
	});

	it("two HP numbers printed one over the other become a question with no answer picked", () => {
		const { draft } = readPlaybook(tester({ hp: ["HP (max 16)", "HP (max 10)"] }));
		const hp = draft.confirm.find(c => c.key === "hp");
		expect(hp).toMatchObject({ type: "number", value: null, choices: [16, 10] });
		expect(hp.why).toMatch(/two different numbers \(16 and 10\)/);
	});

	it("one plain HP, damage die and stats line ask nothing", () => {
		expect(readPlaybook(tester({ insert: "none" })).draft.confirm).toEqual([]);
	});

	it("a PDF with no text layer says so and reads nothing", () => {
		const { bundle, report } = readAssembled({ meta: {}, fonts: {}, pages: [{ w: 792, h: 612, runs: [] }, { w: 792, h: 612, runs: [] }] });
		expect(bundle).toBeNull();
		expect(report.noText).toBe(true);
	});

	it("never throws on nonsense", () => {
		expect(() => readPlaybook(null)).not.toThrow();
		expect(() => readPlaybook({ pages: [{ runs: [{ str: "x".repeat(80), x: 0, y: 0, w: 1, size: 8, font: "?" }] }] })).not.toThrow();
	});
});

describe("the PDF's own facts", () => {
	it("credits the creator the PDF names, all the way to the playbook Item", () => {
		const runs = tester();
		runs.meta.author = "A. Maker";
		const { bundle } = readAssembled(runs);
		expect(bundle.playbook.author).toBe("A. Maker");
		const { playbook } = bundleToItemData(normalizeBundle(bundle).bundle, { slug: "homebrew-the-tester" });
		expect(playbook.flags.stonetop.picker.author).toBe("A. Maker");
	});

	it("refuses a book: far more pages than a playbook has", () => {
		const runs = tester();
		runs.meta.pageCount = 300;
		const { draft, report } = readPlaybook(runs);
		expect(draft).toBeNull();
		expect(report).toMatchObject({ tooLong: true, pageCount: 300 });
	});

	it("warns, but reads, a PDF a little long for one playbook", () => {
		const runs = tester();
		runs.meta.pageCount = 9;
		const { draft, report } = readPlaybook(runs);
		expect(draft).not.toBeNull();
		expect(report.issues.map(i => i.message).join("\n")).toMatch(/9 pages/);
	});
});

describe("inserts", () => {
	const insertQ = draft => draft.confirm.find(c => c.insert);

	it("finds none in a playbook with no extra page, or only the stock pages", () => {
		for (const insert of ["none", "boilerplate"]) {
			const { draft, report } = readPlaybook(tester({ insert }));
			expect(draft.inserts).toEqual([]);
			expect(insertQ(draft)).toBeUndefined();
			expect(report.sections.join()).not.toMatch(/insert/);
		}
	});

	it("is sure of one set as the template sets it, and guesses the move that names it", () => {
		const { draft, report } = readPlaybook(tester({ insert: "titled" }));
		expect(draft.inserts).toHaveLength(1);
		expect(draft.inserts[0]).toMatchObject({ name: "Tester's Toolbox", page: 3, sure: true, guess: "Tooled Up" });
		expect(insertQ(draft)).toMatchObject({ type: "choice", value: "Tooled Up" });
		expect(insertQ(draft).label).toMatch(/Page 3 looks like an insert called "Tester's Toolbox"/);
		expect(report.pages[2]).toMatch(/the Tester's Toolbox insert \(Gadgets, Instinct, Tricks\)/);
	});

	it("asks, with no answer picked, about one it isn't sure of", () => {
		const { draft } = readPlaybook(tester({ insert: "plain" }));
		expect(draft.inserts[0]).toMatchObject({ sure: false, guess: "" });
		expect(insertQ(draft).value).toBeNull();
		expect(draft.blocks.filter(b => b.insert).every(b => b.unsure)).toBe(true);
	});

	it("reads its lists, its moves and what its moves' words add", () => {
		const { bundle } = readAssembled(tester({ insert: "titled" }));
		const ins = bundle.playbook.inserts[0];
		expect(ins).toMatchObject({ key: "tester-s-toolbox", unlockedBy: "Tooled Up", form: { enabled: true } });
		expect(ins.description).toBe("The tools inside you, waiting for a reason to come out and be used.");
		const [gadgets, instinct, tricks] = ins.lists;
		expect(gadgets).toMatchObject({ key: "gadgets", kind: "pick", pick: 2, prompt: "pick 2", bonusPicks: [{ move: "Extra Gear", count: 1 }] });
		// Printed ticked: pre-picked. Smaller boxes under "Lenses (pick 1)": choices of their own.
		expect(gadgets.options.map(o => `${o.preselected ? "+" : ""}${o.freeText ? "?" : ""}${o.description}`)).toEqual([
			"Spring Fist: d6+1 (close, forceful)", "Tin Plate: Armor 1", "+Humming", "Lenses: brass", "Lenses: glass", "?Lenses: something else", "?Something else",
		]);
		expect(instinct).toMatchObject({ kind: "pick", pick: 1, prompt: "pick 1, follow it to fold back up" });
		// "Each time you take this move, choose a new trick": one more trick per extra Tooled Up.
		expect(tricks).toMatchObject({ kind: "moves", pick: 1, perUnlock: 1 });
		const insertMoves = bundle.moves.filter(m => m.insert).map(m => `${m.name}${m.starting ? "*" : ""}@${m.insertList}`);
		expect(insertMoves).toEqual(["Unfold*@", "Extra Gear@tricks", "Whirr@tricks", "Clank@tricks"]);
	});

	it("keeps the insert's lists and moves out of the playbook's own", () => {
		const { bundle } = readAssembled(tester({ insert: "titled" }));
		const own = bundle.moves.filter(m => !m.insert).map(m => m.name);
		expect(own).toContain("Tooled Up");
		expect(own).not.toContain("Whirr");
		expect(bundle.playbook.lore.map(l => l.title)).not.toContain("Gadgets");
	});

	it("never lets an insert's Instinct take the playbook's instincts", () => {
		const { draft, bundle, report } = readAssembled(tester({ insert: "titled", frontInstinct: false }));
		expect(bundle.playbook.instincts).toEqual([]);
		expect(report.issues.map(i => i.message).join()).toMatch(/No "Instincts" section/);
		expect(draft.inserts[0].sure).toBe(true);
	});

	it("an answer picks the move that opens it, or none, or takes it apart again", () => {
		const read = () => readPlaybook(tester({ insert: "titled" })).draft;
		const answer = (draft, value) => { draft.confirm.find(c => c.insert).value = value; return assemblePlaybook(draft).bundle; };
		expect(answer(read(), "Prod").playbook.inserts[0].unlockedBy).toBe("Prod");
		expect(answer(read(), INSERT_ALWAYS).playbook.inserts[0].unlockedBy).toBe("");
		const apart = answer(read(), INSERT_NONE);
		expect(apart.playbook.inserts).toEqual([]);
		const whirr = apart.moves.find(m => m.name === "Whirr");
		expect(whirr.insert).toBeFalsy();
		expect(whirr.requires).toBe(`From the playbook's "Tester's Toolbox"`);
		expect(apart.playbook.lore.map(l => l.title)).toContain("Gadgets");
		expect(apart.playbook.notes).toContain("The tools inside you");
	});

	it("survives normalising into Items, its moves flagged", () => {
		const { bundle } = readAssembled(tester({ insert: "titled" }));
		const { bundle: clean, issues } = normalizeBundle(bundle);
		expect(issues).toEqual(expect.not.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/insert/) })]));
		const { playbook, moves } = bundleToItemData(clean, { slug: "homebrew-the-tester" });
		expect(playbook.flags.stonetop.inserts[0].lists.map(l => l.slug)).toEqual(["tester-s-toolbox-gadgets", "tester-s-toolbox-instinct", "tester-s-toolbox-tricks"]);
		expect(moves.find(m => m.name === "Whirr").flags["stonetop-pwd"].homebrewInsert).toEqual({ key: "tester-s-toolbox", list: "tricks" });
	});
});
