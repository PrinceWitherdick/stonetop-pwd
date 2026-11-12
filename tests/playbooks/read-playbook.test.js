import { describe, it, expect } from "vitest";
import { readPlaybook, assemblePlaybook } from "../../module/playbooks/pdf/read-playbook.js";
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
		expect(pb.origin).toEqual([{ region: "Stonetop", names: ["Ade", "Bryn", "Cai", "Dafydd", "Efa"] }, { region: "Gordin's Delve", names: [] }]);
	});

	it("reads moves: starting, repeatable, required, rolled, with a track", () => {
		const byName = Object.fromEntries(bundle.moves.map(m => [m.name, m]));
		expect(byName.Prod).toMatchObject({ starting: true, rollType: "int", resource: { max: 3, title: "Doubt" } });
		expect(byName.Prod.description).toMatch(/^When you \*\*\*prod something\*\*\*, roll \+INT/);
		expect(byName.Prod.results).toEqual({ success: "it breaks", partial: "it wobbles", failure: "it bites." });
		expect(byName["Improved Stat"]).toMatchObject({ repeatMax: 3, starting: false });
		expect(byName["Prod and Poke"]).toMatchObject({ level: 6, requires: "Requires level 6+ and Prod", requiresMoves: ["Prod"] });
		expect(byName["Prod and Poke"].description).toContain("\n- Ask a question\n- Take a step back");
		expect(pb.startingMovesNote).toBe("You start with Prod and 1 of your choice.");
	});

	it("reads possessions, their boxed-in options, and skips the write-in", () => {
		expect(pb.possessions.pickCount).toBe(1);
		expect(pb.possessions.options.map(o => o.label)).toEqual(["Tester's kit", "Notebook", "Weapons"]);
		expect(pb.possessions.options[0].description).toBe("levers, ◇a mallet");
		expect(pb.possessions.options[1].description).toMatch(/^\(○○○ uses\)/);
		expect(pb.possessions.options[2].description).toContain("\n- Spear, iron (close)\n- Sling (near)");
	});

	it("turns its own question block into lore sections, one per prompt", () => {
		const belonging = pb.lore.filter(l => l.title === "Belonging");
		expect(belonging[0].description).toMatch(/\(choose 1 or 2\)$/);
		expect(belonging[0].options.map(o => o.freeText ? `✎${o.description}` : o.description)).toEqual(["… ignored you", "… doted on you", "✎Something else"]);
		expect(belonging[1]).toMatchObject({ description: "Tell us, where do you go to think?", options: [{ freeText: true }] });
	});

	it("reads the Introductions' third turn and both question rounds", () => {
		expect(pb.introductions).toEqual({
			step3: "tell us what you broke.",
			step4: ["Who mended it?", "Who blamed you for it?"],
			step6: ["Which of you laughed?"],
		});
	});

	it("skips the stock inventory sheet and reads an insert's moves as moves", () => {
		expect(report.pages[2]).toMatch(/stock inventory sheet \(skipped\)/);
		const tinker = bundle.moves.find(m => m.name === "Tinker");
		expect(tinker).toMatchObject({ starting: false, requires: `From the playbook's "Tester's Toolbox"` });
		expect(pb.notes).toContain("The tools inside you.");
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
		expect(readPlaybook(tester()).draft.confirm).toEqual([]);
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
