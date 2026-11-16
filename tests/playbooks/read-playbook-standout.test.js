import { describe, it, expect } from "vitest";
import { buildPageRuns, H, BOX, B, BI, I } from "../fakes/pdf-page-builder.js";
import { ITEM_FLAG_SCOPE } from "../../module/system-id.js";
import { layoutDocument } from "../../module/playbooks/pdf/layout.js";
import { readPlaybook, assemblePlaybook } from "../../module/playbooks/pdf/read-playbook.js";
import {
	normalizeBundle, bundleToItemData, itemsToBundle, emptyBundle, possessionChoicesFrom, possessionChoicesText, possessionBonusFrom, advancementToFlags,
} from "../../module/playbooks/homebrew-bundle.js";

// What the live import of the Standout (2026-11-12) read wrong, rebuilt on a page of our own words:
// a 52pt emblem beside the prose, which ran three of its lines together; a starting move printed as
// a section of its own with "When you Level Up, switch to a different playbook" under it; a damage box
// of "d6/d8" that a possession raises; and a possession holding its own pick of ◇ weapons.
function starter() {
	return buildPageRuns([{ columns: [
		{ x: 30, lines: [
			H("Your Finest Hour"),
			["When you ", BI("give it everything"), ", roll +3 instead."],
			["Nobody can"],
			["interfere or save you."],
			{ gap: 10 },
			["When you ", B("Level Up"), ", switch to a different playbook."],
			["Make introductions as normal."],
			{ gap: 10 },
			H("Stats", "Assign these scores: +1, +1, +1, +0, +0, -1."),
			["d6/d8"],
			["HP (max 16)"],
			{ gap: 10 },
			H("Special possessions", "(Pick 1)"),
			BOX(B("Weapons of War"), " (Choose 1)"),
			{ indent: 10, tokens: BOX({ t: "u", f: "ding" }, " Sword, iron (", I("close"), ", +1 damage)") },
			{ indent: 10, tokens: BOX({ t: "uu", f: "ding" }, " Long Spear (", I("reach"), ", 2 piercing") },
			{ indent: 10, tokens: BOX({ t: "u", f: "ding" }, " Bow (", I("far"), "; ", { t: "l", f: "ding" }, " low ammo)") },
			BOX(B("Determination"), ": increase your damage to a d8 and your max HP by 4"),
			BOX(B("Kit"), ": rope, ", { t: "u", f: "ding" }, " prybar,"),
			[{ t: "u", f: "ding" }, " hacksaws, etc."],
			{ gap: 10 },
			H("Moves", "You start with Your Finest Hour, plus the move from your background."),
		] },
		{ x: 423, lines: [
			H("The Starter", "", 24),
			[I("Somebody has to go first.")],
			H("Background", "(Choose 1)"),
			BOX(B("THE VETERAN")),
			["You have seen a fight or two."],
			["You get one of the following moves: Frosty from the Heavy, or Ambush from the Fox"],
			{ gap: 10 },
			H("Instinct", "(Choose 1)"),
			BOX(B("DUTY")),
			["To do what's required of you."],
		] },
		// The emblem: one 52pt "?" in the corner, its baseline among Your Finest Hour's lines.
		{ x: 700, y: 80, lines: [{ size: 52, tokens: [{ t: "?", f: "heading" }] }] },
	] }]);
}

describe("the Standout's page", () => {
	it("an emblem far bigger than the prose beside it doesn't run the prose's lines together", () => {
		const doc = layoutDocument(starter());
		const lines = doc.pages[0].columns.flatMap(c => c.lines.map(l => l.text));
		expect(lines).toContain("Nobody can");
		expect(lines).toContain("interfere or save you.");
		const { draft } = readPlaybook(starter());
		const move = draft.blocks.find(b => b.title === "Your Finest Hour");
		expect(move.text).toContain("Nobody can interfere");
		// And the emblem is not read as words anywhere.
		expect(draft.blocks.some(b => /(^|\s)\?$/.test(b.text ?? ""))).toBe(false);
	});

	it("the starting move named in Moves is sure, and the Level Up line is lifted out of it", () => {
		const { draft } = readPlaybook(starter());
		const move = draft.blocks.find(b => b.title === "Your Finest Hour");
		expect(move.kind).toBe("startingMove");
		expect(move.unsure).toBe(false);
		expect(move.text).not.toMatch(/Level Up/);
		expect(draft.fields.advancement).toMatchObject({ switchPlaybook: true, options: [] });
		expect(draft.fields.advancement.note).toMatch(/^When you Level Up, switch to a different playbook\./);
	});

	it("d6/d8 that a possession raises: starts at d6, and nothing is asked", () => {
		const { draft, report } = readPlaybook(starter());
		expect(draft.confirm.find(q => q.key === "damage")).toBeUndefined();
		expect(draft.fields.damage).toBe("d6");
		expect(report.sections.some(s => /Determination.*d8/.test(s))).toBe(true);
	});

	it("a load diamond opening a line is kept; the checkbox before it isn't", () => {
		const { bundle } = normalizeBundle(assemblePlaybook(readPlaybook(starter()).draft).bundle);
		const opts = bundle.playbook.possessions.options;
		expect(opts.find(o => o.label === "Kit").description).toBe("rope, ◇ prybar, ◇ hacksaws, etc.");
		expect(opts.find(o => o.label === "Weapons of War").description).toMatch(/^\(Choose 1\)\n- ◇ Sword/);
	});

	it("the playbook Item: a sub-pick of gear, Determination's bonus, Level Up as a change of playbook", () => {
		const { bundle } = normalizeBundle(assemblePlaybook(readPlaybook(starter()).draft).bundle);
		expect(bundle.playbook.advancement.switchPlaybook).toBe(true);
		const data = bundleToItemData(bundle, { slug: "homebrew-the-starter", source: "pdf" }).playbook;
		const flags = data.flags[ITEM_FLAG_SCOPE];
		const weapons = flags.specialPossessions.options.find(o => o.slug === "weapons-of-war");
		expect(weapons.description).toBe("");
		expect(weapons.choices).toMatchObject({ pickNote: "Choose 1", pickCount: 1, gear: true });
		expect(weapons.choices.options.map(o => o.slug)).toEqual(["sword", "long-spear", "bow"]);
		// The bracket the page left open is closed; the bow's ○ is its ammo track.
		expect(weapons.choices.options[1].label).toMatch(/2 piercing\)$/);
		expect(weapons.choices.options[2].resource).toEqual({ max: 1, title: null, labels: [] });
		const det = flags.specialPossessions.options.find(o => o.slug === "determination");
		expect(det).toMatchObject({ hpBonus: 4, damageDie: "d8" });
		expect(flags.advancement).toEqual({ switchPlaybook: true, replacesUsual: false, note: bundle.playbook.advancement.note, options: [] });
	});
});

describe("a possession's own pick and bonus", () => {
	it("reads a counted list of bullets, and writes it back the same way", () => {
		const text = "Your old kit (Choose 2)\n- ◇ Sword\n- ◇ Axe\n- ◇ Bow";
		const c = possessionChoicesFrom(text);
		expect(c).toEqual({ lead: "Your old kit", pickNote: "Choose 2", pickCount: 2, options: ["◇ Sword", "◇ Axe", "◇ Bow"] });
		expect(possessionChoicesFrom(possessionChoicesText(c.lead, c))).toEqual(c);
	});

	it("isn't a pick without a count, or with one bullet", () => {
		expect(possessionChoicesFrom("Tools:\n- a saw\n- a hammer")).toBeNull();
		expect(possessionChoicesFrom("(Choose 1)\n- a saw")).toBeNull();
	});

	it("reads max HP and the damage die off its words", () => {
		expect(possessionBonusFrom("increase your damage to a d8 and your max HP by 4")).toEqual({ hpBonus: 4, damageDie: "d8" });
		expect(possessionBonusFrom("+2 max HP while you wear it")).toEqual({ hpBonus: 2 });
		expect(possessionBonusFrom("a rope, 50 feet")).toEqual({});
	});

	it("comes back to the same bundle from the Item", () => {
		const { bundle } = normalizeBundle(assemblePlaybook(readPlaybook(starter()).draft).bundle);
		const data = bundleToItemData(bundle, { slug: "homebrew-the-starter", source: "pdf" }).playbook;
		const back = itemsToBundle({ name: data.name, system: data.system, flags: data.flags }, []);
		const weapons = back.playbook.possessions.options.find(o => o.label === "Weapons of War");
		expect(weapons.description).toBe(bundle.playbook.possessions.options.find(o => o.label === "Weapons of War").description.replace("2 piercing\n", "2 piercing)\n"));
		expect(back.playbook.advancement.switchPlaybook).toBe(true);
	});
});

describe("a Level Up that switches playbook, in the bundle", () => {
	it("drops any advances: a character never marks one", () => {
		const { bundle, issues } = normalizeBundle({ ...emptyBundle(), playbook: { ...emptyBundle().playbook, name: "X", advancement: { switchPlaybook: true, replacesUsual: true, options: ["Increase your max HP to 20."] } }, moves: [] });
		expect(bundle.playbook.advancement).toMatchObject({ switchPlaybook: true, replacesUsual: false, options: [] });
		expect(issues.some(i => /switches to a different playbook/.test(i.message))).toBe(true);
	});

	it("is stored even with no advances", () => {
		expect(advancementToFlags({ switchPlaybook: true, note: "Switch.", options: [] })).toEqual({ switchPlaybook: true, replacesUsual: false, note: "Switch.", options: [] });
		expect(advancementToFlags({ options: [], note: "" })).toBeNull();
		// A note typed with no advances survives the save, so the Builder reopens with it.
		expect(advancementToFlags({ options: [], note: "At level 3 you may change playbook." })).toEqual({ replacesUsual: false, note: "At level 3 you may change playbook.", options: [] });
	});
});
