import { describe, it, expect } from "vitest";
import {
	BUNDLE_FORMAT, BUNDLE_VERSION, emptyBundle, normalizeBundle, bundleToItemData, itemsToBundle, bundleForExport, diffBundles, mergeReimport, writeInsAsBlanks, blankWriteIn, statCapFrom, markOptionsFrom, holdOnRollFrom,
} from "../../module/playbooks/homebrew-bundle.js";
import { formatPlaybookText, formatPlaybookInline, playbookTextFromHtml } from "../../module/playbooks/playbook-text.js";
import { isHomebrewPlaybookItem, homebrewMoveSlug } from "../../module/playbooks/playbook-catalog.js";

// An original test playbook (none of it from a published one), using every field.
function testerBundle(over = {}) {
	return {
		format: BUNDLE_FORMAT,
		version: 1,
		playbook: {
			name: "The Tester",
			slug: "homebrew-the-tester",
			published: true,
			summary: "Pokes at things to see what breaks.",
			complexity: "Low",
			description: "Every village needs someone who asks why.",
			notes: "When you Level Up, you may swap playbooks instead.",
			statsNote: "Assign these scores: +1, +1, +1, +0, +0, -1.",
			hp: 16,
			damage: "d6",
			instinctLabel: "drive",
			backgrounds: [
				{ label: "The Prober", description: "You test the ice.\n\nYou get the ***Prod*** move.", moves: ["Prod"] },
				{ label: "The Borrower", description: "You learned from others.", moveChoice: ["Prod", "Frosty"] },
			],
			instincts: [{ word: "Curiosity", description: "To find out." }],
			appearance: [["young", "old"], ["quiet", "loud"]],
			origin: [{ region: "Stonetop", names: ["Ade", "Bryn"] }],
			possessions: { pickCount: 1, options: [{ label: "Tester's kit", description: "levers, ◇ a mallet", preselected: true }, { label: "Notebook", description: "pages" }] },
			startingMovesNote: "You start with Prod and 1 of your choice.",
			moveChoices: [{ label: "Choose one", options: ["Prod", "Poke"] }],
			moveGroups: [{ label: "Poking", moves: ["Prod", "Poke"] }],
			lore: [{ title: "Belonging", description: "When you were young they... (choose 1 or 2)", options: [{ description: "... ignored you", max: 1 }, { description: "Who?", freeText: true }] }],
			introductions: { step3: "Tell us what you broke.", step4: ["Who mended it?"], step6: ["Which of you laughed?"] },
		},
		moves: [
			{ name: "Prod", starting: true, description: "When you ***prod something***, roll +INT:\n- it creaks\n- it cracks", rollType: "int", results: { success: "It breaks.", partial: "It wobbles.", failure: "It bites." }, resource: { max: 3, title: "Doubt" } },
			{ name: "Poke", description: "Like Prod, but gentler.", level: 6, requires: "Requires level 6+ and Prod", requiresMoves: ["Prod"], repeatMax: 3 },
		],
		...over,
	};
}

describe("normalizeBundle refuses what is not a bundle", () => {
	it("refuses no object, a wrong format mark and a newer version", () => {
		expect(normalizeBundle(null).bundle).toBeNull();
		expect(normalizeBundle({ format: "something-else", version: 1 }).bundle).toBeNull();
		const newer = normalizeBundle({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION + 1 });
		expect(newer.bundle).toBeNull();
		expect(newer.issues[0].message).toMatch(/newer version/);
	});
});

describe("normalizeBundle repairs and reports", () => {
	it("keeps a well-formed bundle whole", () => {
		const { bundle, issues } = normalizeBundle(testerBundle());
		expect(bundle.playbook.name).toBe("The Tester");
		expect(bundle.playbook.instinctLabel).toBe("Drive");
		expect(bundle.moves.map(m => m.name)).toEqual(["Prod", "Poke"]);
		expect(bundle.moves[1]).toMatchObject({ level: 6, repeatMax: 3, requiresMoves: ["Prod"] });
		// Frosty is another playbook's move: kept, and reported.
		expect(bundle.playbook.backgrounds[1].moveChoice).toEqual(["Prod", "Frosty"]);
		expect(issues.map(i => i.message).join(" | ")).toMatch(/background "The Borrower" gives moves from other playbooks: Frosty/);
	});

	it("clamps a merged-glyph HP (160) and flags an unusual one", () => {
		const big = normalizeBundle(testerBundle({ playbook: { ...testerBundle().playbook, hp: 160 } }));
		expect(big.bundle.playbook.hp).toBe(40);
		expect(big.issues.some(i => /more than 40/.test(i.message))).toBe(true);
		const odd = normalizeBundle(testerBundle({ playbook: { ...testerBundle().playbook, hp: 30 } }));
		expect(odd.bundle.playbook.hp).toBe(30);
		expect(odd.issues.some(i => /unusual/.test(i.message))).toBe(true);
	});

	it("resets a damage value that is not a die", () => {
		const { bundle, issues } = normalizeBundle(testerBundle({ playbook: { ...testerBundle().playbook, damage: "2d20" } }));
		expect(bundle.playbook.damage).toBe("d6");
		expect(issues.some(i => /not a die/.test(i.message))).toBe(true);
	});

	it("keeps the first of two moves with one name, and drops nameless ones", () => {
		const { bundle, issues } = normalizeBundle(testerBundle({ moves: [{ name: "Prod" }, { name: "prod" }, { description: "no name" }] }));
		expect(bundle.moves.map(m => m.name)).toEqual(["Prod"]);
		expect(issues.filter(i => i.severity === "check").length).toBeGreaterThanOrEqual(2);
	});

	it("drops a roll type that is not a stat or 'ask', and a resource with no pips", () => {
		const { bundle } = normalizeBundle(testerBundle({ moves: [{ name: "X", rollType: "luck", resource: { max: 0 } }] }));
		expect(bundle.moves[0]).toMatchObject({ rollType: "", resource: null });
	});

	it("never keeps a slug that is not a homebrew one, or an image path that is not a picture", () => {
		const { bundle } = normalizeBundle(testerBundle({ playbook: { ...testerBundle().playbook, slug: "the-fox", img: "javascript:alert(1)" } }));
		expect(bundle.playbook.slug).toBe("");
		expect(bundle.playbook.img).toBe("");
	});
});

describe("nothing imported is stored as live markup", () => {
	const evil = "<img src=x onerror=alert(1)><script>steal()</script>";

	it("escapes every raw-drawn field: backgrounds, possessions, lore, moves", () => {
		const raw = testerBundle();
		raw.playbook.backgrounds[0].label = evil;
		raw.playbook.backgrounds[0].description = evil;
		raw.playbook.possessions.options[0].description = evil;
		raw.playbook.lore[0].options[0].description = evil;
		raw.moves[0].description = evil;
		const { bundle } = normalizeBundle(raw);
		const { playbook, moves } = bundleToItemData(bundle, { slug: "homebrew-the-tester" });
		const stored = JSON.stringify([playbook, moves]);
		// The words survive as visible text; no tag does.
		expect(stored).not.toMatch(/<img|<script/i);
		expect(stored).toContain("&lt;script&gt;");
	});

	it("formats only the markup we add", () => {
		expect(formatPlaybookText("When you ***act***:\n- one\n- two")).toBe("<p>When you <strong><em>act</em></strong>:</p><ul><li>one</li><li>two</li></ul>");
		expect(formatPlaybookInline("a & b <i>")).toBe("a &amp; b &lt;i&gt;");
	});

	it("reads a shipped move's HTML back into the text a GM would type", () => {
		const html = "<p>When you <strong><em>get the drop</em></strong>, roll:</p><ul><li>Deal +1d4 damage</li><li>Slip away</li></ul>";
		const txt = playbookTextFromHtml(html);
		expect(txt).toBe("When you ***get the drop***, roll:\n\n- Deal +1d4 damage\n- Slip away");
		expect(formatPlaybookText(txt)).toBe(html);
	});
});

describe("bundle ⇄ Items", () => {
	const { bundle } = normalizeBundle(testerBundle());
	const { playbook, moves } = bundleToItemData(bundle, { slug: "homebrew-the-tester", source: "json" });

	it("writes a homebrew playbook the catalog recognises, in the shipped playbooks' shape", () => {
		expect(isHomebrewPlaybookItem(playbook)).toBe(true);
		const f = playbook.flags.stonetop;
		expect(f).toMatchObject({ hp: 16, damage: "d6", instinctLabel: "Drive", homebrew: { published: true, source: "json" } });
		expect(f.backgrounds[0]).toMatchObject({ slug: "the-prober", label: "The Prober", moves: ["Prod"] });
		expect(f.backgrounds[1].setup.choices[0]).toMatchObject({ apply: "move", options: [{ value: "Prod" }, { value: "Frosty" }] });
		expect(f.specialPossessions).toMatchObject({ pickCount: 1, preselected: ["tester-s-kit"] });
		expect(f.specialPossessions.options[0].description).toBe("levers, ◇ a mallet");
		// A write-in among options to tick is one more to tick, with a blank to fill in (writeInsAsBlanks).
		expect(f.lore[0].options[1]).not.toHaveProperty("type");
		expect(f.lore[0].options[1].description).toMatch(/___$/);
		expect(f.moves.choices).toEqual([{ label: "Choose one", options: ["Prod", "Poke"] }]);
	});

	it("writes moves linked by display name and flagged as homebrew", () => {
		const prod = moves.find(m => m.name === "Prod");
		expect(prod.system).toMatchObject({ moveType: "playbook", playbook: "The Tester", isStartingMove: true, rollType: "int", repeatMax: null });
		expect(prod.system.moveResults.success).toEqual({ label: "10+", value: "It breaks." });
		expect(prod.system.resource).toEqual({ max: 3, title: "Doubt", labels: [] });
		expect(homebrewMoveSlug(prod)).toBe("homebrew-the-tester");
		const poke = moves.find(m => m.name === "Poke");
		expect(poke.system.requirement).toEqual({ level: 6, moves: ["Prod"], note: "Requires level 6+ and Prod" });
		expect(poke.system.repeatMax).toBe(3);
	});

	it("round-trips: Items back to a bundle, and that bundle to the same Items", () => {
		const back = itemsToBundle({ ...playbook, system: { ...playbook.system } }, moves);
		const again = bundleToItemData(normalizeBundle(bundleForExport(back)).bundle, { slug: "homebrew-the-tester", source: "json" });
		expect(again.playbook.flags).toEqual(playbook.flags);
		const byName = list => Object.fromEntries(list.map(m => [m.name, m.system]));
		expect(byName(again.moves)).toEqual(byName(moves));
	});

	it("an empty bundle normalizes without throwing", () => {
		const { bundle, issues } = normalizeBundle(emptyBundle());
		expect(bundle.playbook.hp).toBe(16);
		expect(issues.some(i => /no name/.test(i.message))).toBe(true);
	});
});

describe("what changed between two versions", () => {
	it("names added, dropped and reworded moves, and changed numbers", () => {
		const v1 = normalizeBundle(testerBundle()).bundle;
		const raw = testerBundle();
		raw.playbook.hp = 18;
		raw.moves = [{ ...raw.moves[0], description: "Reworded." }, { name: "Nudge", description: "New." }];
		const v2 = normalizeBundle(raw).bundle;
		const { lines, changedMoves } = diffBundles(v1, v2);
		expect(lines).toEqual(expect.arrayContaining(["Max HP: 16 → 18", "New moves: Nudge", "No longer there (moves): Poke", "Changed moves: Prod"]));
		expect(changedMoves).toEqual(["Prod"]);
		expect(diffBundles(v1, v1).lines).toEqual([]);
	});
});

describe("what a move's own words make it do", () => {
	it("a stat move gets the cap Level Up needs to ask which stat", () => {
		expect(statCapFrom("Each time you take this move, increase one of your stats by 1 (to a max of +2).")).toBe(2);
		expect(statCapFrom("Increase one of your stats by +1 (to a max of +3).")).toBe(3);
		expect(statCapFrom("Increase your damage die to a d8.")).toBeNull();
		const { bundle } = normalizeBundle(testerBundle({ moves: [{ name: "Improved Stat", description: "Increase one of your stats by 1 (to a max of +2).", repeatMax: 3 }] }));
		expect(bundle.moves[0].cap).toBe(2);
		expect(bundleToItemData(bundle, { slug: "homebrew-the-tester" }).moves[0].system).toMatchObject({ cap: 2, repeatMax: 3 });
	});

	it("'Mark one:' and its bullets become mark boxes; a write-in bullet is left as words", () => {
		const description = "Something small makes you exceptional. Mark one:\n- You're the best at games of chance.\n- You can safely wander the forest alone.\n- (discuss with GM)\n\nWhile acting on it, roll with advantage.";
		expect(markOptionsFrom(description)).toEqual({ labels: ["You're the best at games of chance.", "You can safely wander the forest alone."], count: 1 });
		const { bundle } = normalizeBundle(testerBundle({ moves: [{ name: "Eccentricity", description }] }));
		const sys = bundleToItemData(bundle, { slug: "homebrew-the-tester" }).moves[0].system;
		expect(sys.markOptions).toEqual([
			{ slug: "you-re-the-best-at-games-of-chance", label: "You're the best at games of chance.", marks: 1 },
			{ slug: "you-can-safely-wander-the-forest-alone", label: "You can safely wander the forest alone.", marks: 1 },
		]);
		expect(sys.markBudget).toEqual({ base: 1, perExtra: 1 });
		expect(markOptionsFrom("Spend Doubt to:\n- ask\n- step back")).toBeNull();
	});

	it("what the GM fills in wins over the words, and survives a round trip", () => {
		const { bundle } = normalizeBundle(testerBundle({ moves: [{ name: "Grow", description: "to a max of +2 nothing", cap: 3, marks: ["a", "b"], markCount: 2 }] }));
		expect(bundle.moves[0]).toMatchObject({ cap: 3, marks: ["a", "b"], markCount: 2 });
		const items = bundleToItemData(bundle, { slug: "homebrew-the-tester" });
		const back = itemsToBundle(items.playbook, items.moves);
		expect(normalizeBundle(bundleForExport(back)).bundle.moves[0]).toMatchObject({ cap: 3, marks: ["a", "b"], markCount: 2 });
	});
});

describe("what a background gives besides moves", () => {
	it("possessions on top of the pick, by this playbook's own slugs, and a track of its own", () => {
		const raw = testerBundle();
		raw.playbook.backgrounds[0].possessions = ["the Tester’s Kit", "Telescope"];
		raw.playbook.backgrounds[0].track = { label: "Doom", max: 3 };
		const { bundle, issues } = normalizeBundle(raw);
		expect(issues.map(i => i.message).join(" | ")).toMatch(/gives "Telescope", which isn't one of this playbook's special possessions/);
		const bg = bundleToItemData(bundle, { slug: "homebrew-the-tester" }).playbook.flags.stonetop.backgrounds[0];
		expect(bg.extraPossessions).toEqual(["tester-s-kit"]);
		expect(bg.setup.resources).toEqual([{ key: "the-prober-doom", label: "Doom", max: 3, value: 0 }]);
	});

	it("round-trips them", () => {
		const raw = testerBundle();
		raw.playbook.backgrounds[0].possessions = ["Notebook"];
		raw.playbook.backgrounds[0].track = { label: "Doom", max: 3 };
		const items = bundleToItemData(normalizeBundle(raw).bundle, { slug: "homebrew-the-tester" });
		const back = normalizeBundle(bundleForExport(itemsToBundle(items.playbook, items.moves))).bundle;
		expect(back.playbook.backgrounds[0]).toMatchObject({ possessions: ["Notebook"], track: { label: "Doom", max: 3 } });
	});
});

describe("what a roll holds, read off a move's words", () => {
	it("reads each tier's hold of the track's own currency", () => {
		expect(holdOnRollFrom("roll +CHA: on a 10+, hold 3 Fear; on a 7-9, hold 1 Fear.", "Fear")).toEqual({ success: 3, partial: 1 });
		expect(holdOnRollFrom("on a 7+, they appear but hold 1 Reign; on a 10+, hold 2 Reign; on a 6-, hold no Reign", "Reign")).toEqual({ success: 2, partial: 1 });
		expect(holdOnRollFrom("on a 10+, hold 2 Readiness", "Fear")).toBeNull();
		expect(holdOnRollFrom("When you take this on, hold 2 Surprises.", "Surprises")).toBeNull();
	});

	it("is written on the move's track, and the GM's numbers win", () => {
		const { bundle } = normalizeBundle(testerBundle());
		const prod = bundleToItemData(bundle, { slug: "homebrew-the-tester" }).moves.find(m => m.name === "Prod");
		expect(prod.system.resource.holdOnRoll).toBeUndefined();
		const raw = testerBundle({ moves: [{ name: "Scare", description: "roll +CHA: on a 10+, hold 3 Fear; on a 7-9, hold 1 Fear.", rollType: "cha", resource: { max: 4, title: "Fear" } }] });
		const scare = bundleToItemData(normalizeBundle(raw).bundle, { slug: "homebrew-the-tester" }).moves[0];
		expect(scare.system.resource.holdOnRoll).toEqual({ success: 3, partial: 1 });
		raw.moves[0].resource.holdOnRoll = { success: 2, partial: 0 };
		expect(normalizeBundle(raw).bundle.moves[0].resource.holdOnRoll).toEqual({ success: 2 });
	});
});

describe("a write-in among options to tick", () => {
	it("becomes one more to tick, with a blank to fill", () => {
		const opts = writeInsAsBlanks([
			{ description: "… ignored you", max: 1, freeText: false },
			{ description: "Something else", max: 1, freeText: true },
		]);
		expect(opts[1]).toEqual({ description: "Something else: ___", max: 1, freeText: false });
	});

	it("keeps a nested choice's stem, and a blank already written", () => {
		expect(blankWriteIn("To devour: something else")).toBe("To devour: ___");
		expect(blankWriteIn("Adopted by ___")).toBe("Adopted by ___");
		expect(blankWriteIn("Who? (write in)")).toBe("Who? ___");
	});

	it("leaves a list of nothing but write-ins as questions to answer in words", () => {
		const opts = [{ description: "Your answer", max: 1, freeText: true }];
		expect(writeInsAsBlanks(opts)).toBe(opts);
	});
});

describe("what changed since the saved version", () => {
	it("is nothing, for a playbook saved and read straight back", () => {
		const { bundle } = normalizeBundle(testerBundle());
		const { playbook, moves } = bundleToItemData(bundle, { slug: "homebrew-the-tester", source: "pdf" });
		const back = itemsToBundle({ ...playbook, system: { ...playbook.system, slug: "homebrew-the-tester" } }, moves);
		expect(diffBundles(back, bundle).lines).toEqual([]);
	});

	it("still names a move whose words changed", () => {
		const before = testerBundle();
		const after = testerBundle();
		after.moves[1].description = "Like Prod, but much gentler.";
		expect(diffBundles(before, after).lines).toEqual(["Changed moves: Poke"]);
	});
});

describe("importing a newer version over the GM's own work", () => {
	const base = () => testerBundle();
	it("keeps what the GM changed where the new version says what the old one did", () => {
		const mine = base();
		mine.moves[1].description = "Fixed by the GM.";
		mine.playbook.summary = "The GM's own blurb.";
		const theirs = base();
		theirs.moves[0].description = "When you ***prod something***, roll +INT, harder.";
		const { bundle, kept, replaced } = mergeReimport({ base: base(), mine, theirs });
		expect(bundle.moves.find(m => m.name === "Poke").description).toBe("Fixed by the GM.");
		expect(bundle.moves.find(m => m.name === "Prod").description).toMatch(/harder/);
		expect(bundle.playbook.summary).toBe("The GM's own blurb.");
		expect(kept).toEqual(expect.arrayContaining(['move "Poke"', "the playbook's summary"]));
		expect(replaced).toEqual([]);
	});

	it("puts the new words in where both changed, and says so", () => {
		const mine = base();
		mine.moves[0].description = "The GM's Prod.";
		const theirs = base();
		theirs.moves[0].description = "The new PDF's Prod.";
		const { bundle, replaced } = mergeReimport({ base: base(), mine, theirs });
		expect(bundle.moves.find(m => m.name === "Prod").description).toBe("The new PDF's Prod.");
		expect(replaced).toEqual(['move "Prod"']);
	});

	it("keeps a move the GM added and leaves out one the GM deleted", () => {
		const mine = base();
		mine.moves.push({ name: "House Rule", description: "The table's own." });
		mine.moves = mine.moves.filter(m => m.name !== "Poke");
		const { bundle } = mergeReimport({ base: base(), mine, theirs: base() });
		expect(bundle.moves.map(m => m.name).sort()).toEqual(["House Rule", "Prod"]);
	});

	it("never takes the publish switch, picture or slug from the PDF", () => {
		const mine = base();
		mine.playbook.published = false;
		mine.playbook.img = "worlds/x/stranger.webp";
		const { bundle } = mergeReimport({ base: base(), mine, theirs: base() });
		expect(bundle.playbook).toMatchObject({ published: false, img: "worlds/x/stranger.webp", slug: "homebrew-the-tester" });
	});
});
