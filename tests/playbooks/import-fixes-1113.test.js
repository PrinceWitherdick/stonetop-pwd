// The 11-13 live run of the playbook importer on all four sample PDFs (Stranger, Familiar Face,
// Standout, Abhorsen), each finding's pure part, on words of our own:
//   · "(choose 1 to 3)" allows 3, not 1 (lore-pick-count.js).
//   · "on a 7+, … but hold 1 Reign; on a 10+, hold 2 Reign" reads the 10+ as "… but hold 2 Reign".
//   · a move's words read for its roll, results and track, typed by hand as imported (move-words.js),
//     a pip with no word beside it named by "once per expedition".
//   · a possession's "(○○○ uses)" a track, its listed gear inventory rows, in the book's shapes.
//   · a held possession's own "Choose 1" left unmade is owed, on its card.
//   · the borrowed-move notice names its moves, for the builder to drop when all are found.
//   · "Level Up to Level 3 or higher, you can change playbook" is `switchFromLevel: 3`, kept.
//   · the emblem beside the name: where to look (emblemRegion), and what in it is the emblem.

import { describe, it, expect } from "vitest";
import { pickCountRange, lorePickMax } from "../../module/actors/character/lore-pick-count.js";
import { parseTiersFromProse } from "../../module/utils/move-tiers.js";
import { rollFromWords, trackFromWords, heldFromWords, onceTitle, crossPlaybookFrom } from "../../module/playbooks/move-words.js";
import { possessionUsesFrom, possessionGearFrom, possessionRulesFrom } from "../../module/playbooks/possession-gear.js";
import { normalizeBundle, bundleToItemData, itemsToBundle, advancementToFlags, emptyBundle } from "../../module/playbooks/homebrew-bundle.js";
import { emblemRegion } from "../../module/playbooks/pdf/read-playbook.js";
import { emblemBox, inkToAlpha } from "../../module/playbooks/pdf/emblem-box.js";
import { buildLiveCharacter } from "../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs } from "../fakes/sourcePack.js";

describe("a count worded 'choose 1 to 3'", () => {
	it("allows up to 3", () => {
		expect(pickCountRange("Tell us, what do people call you now? (choose 1 to 3)")).toEqual({ min: 1, max: 3 });
		expect(lorePickMax({ description: "(choose 1 to 3)", options: [] })).toBe(3);
		// The others still read as before.
		expect(pickCountRange("(choose 1 or 2)")).toEqual({ min: 1, max: 2 });
		expect(pickCountRange("(choose 2)")).toEqual({ min: 2, max: 2 });
	});
});

describe("a 10+ that raises what a 7+ holds", () => {
	it("rewrites the hold instead of adding a second one", () => {
		const t = parseTiersFromProse("When you call forth a swarm roll +CHA: on a 7+, they appear and sew chaos on your behalf but hold 1 Reign; on a 10+, hold 2 Reign; on a 6-, they sew chaos but hold no Reign and mark XP.");
		expect(t.success.value).toBe("They appear and sew chaos on your behalf but hold 2 Reign.");
		expect(t.partial.value).toBe("They appear and sew chaos on your behalf but hold 1 Reign.");
	});

	it("leaves a 10+ holding something else as it was", () => {
		const t = parseTiersFromProse("When you rally, roll +CHA: on a 7+, hold 1 Courage; on a 10+, hold 2 Glory.");
		expect(t.success.value).toMatch(/Courage/);
		expect(t.success.value).toMatch(/Glory/);
	});
});

describe("a move's own words", () => {
	it("give its roll and results, as an import reads them", () => {
		expect(rollFromWords("When you ***are dying***, roll +WIS: on a 10+, you return to 1 HP; on a 7-9, you glimpse the Last Door; on a 6-, choose a dark fate.")).toEqual({
			rollType: "wis",
			results: { success: "You return to 1 HP.", partial: "You glimpse the Last Door.", failure: "Choose a dark fate." },
		});
		// A roll bending another move's is not this move's.
		expect(rollFromWords("When you taste blood and Seek Insight you may roll +CON.").rollType).toBe("");
	});

	it("give the track it holds by name, at the most it holds", () => {
		expect(heldFromWords("When you promise, hold 1 Reminder, or 2 Reminders if it puts your life at risk.")).toEqual({ title: "Reminder", max: 2 });
		expect(trackFromWords("When you take up your instrument, hold 2 Authority. Spend Authority 1-for-1 to:")).toEqual({ max: 2, title: "Authority", labels: [] });
		// Not stemmed: "Readiness" is a word ending in s, not a plural.
		expect(heldFromWords("On a 10+, hold 3 Readiness.").title).toBe("Readiness");
	});

	it("give a box for a thing done once a stretch of play, named by it", () => {
		expect(onceTitle("Once per expedition when you Have What You Need you may…")).toBe("Used this expedition");
		expect(trackFromWords("Once per session, you can mention something helpful.")).toEqual({ max: 1, title: "Used this session", labels: [] });
		expect(trackFromWords("You see in the dark.")).toBeNull();
	});
});

describe("a special possession's words", () => {
	it("open with its uses: a track, as the book's", () => {
		expect(possessionUsesFrom("(○○○ uses): ◇ nightshade oil (applied, dangerous). Spend a week to refresh 1 use.")).toEqual({ max: 3, title: null, labels: [] });
		expect(possessionUsesFrom("( ○○○○○ uses): expend a use to consult your collection.")).toEqual({ max: 5, title: null, labels: [] });
		expect(possessionUsesFrom("(○ per session) : Charcoal, bone charms, etc.")).toEqual({ max: 1, title: null, labels: [] });
		expect(possessionUsesFrom("paint, brushes, chisels, etc.")).toBeNull();
	});

	it("list gear as the Fox's Burglar's kit gives it: bare things small, ◇ things regular, a lantern's hours a track", () => {
		const fox = loadPlaybookPackDocs().find(d => d.system.slug === "the-fox").flags.stonetop.specialPossessions.options.find(o => o.slug === "burglars-kit");
		const ours = possessionGearFrom("picks, files, snippers, wire, ◇ prybars, ◇ hacksaws, ◇ a lantern (○○○○○ hours, *close, area*), ◇ a grappling hook, etc.");
		expect(ours.map(g => [g.name, g.column, g.weight ?? null, g.resource?.max ?? null]))
			.toEqual(fox.grantsItems.map(g => [g.name, g.column, g.weight ?? null, g.resource?.max ?? null]));
		expect(ours.find(g => g.name === "Lantern").resourceSuffix).toBe("hours, close, area");
	});

	it("keep a ◇ thing's tags as its note, and take one ◇ thing as gear", () => {
		expect(possessionGearFrom("spades, ◇ shovel (close, clumsy, forceful), incense, etc.")).toEqual([
			{ name: "Spades", column: "small" },
			{ name: "Shovel", column: "regular", weight: 1, note: "close, clumsy, forceful" },
			{ name: "Incense", column: "small" },
		]);
		expect(possessionGearFrom("(○○○ uses): ◇ nightshade oil (applied, dangerous, damage +1d4). Spend ~1 week to refresh.")).toEqual([
			{ name: "Nightshade oil", column: "regular", weight: 1, note: "applied, dangerous, damage +1d4" },
		]);
	});

	it("keep what they say after the list as the card's rule, as the book's Herb garden does", () => {
		expect(possessionRulesFrom("(○○○ uses): ◇ nightshade oil (*applied, dangerous*, damage +1d4). Spend ~1 week of careful work to refresh 1 use.")).toBe("Spend ~1 week of careful work to refresh 1 use.");
		expect(possessionRulesFrom("shears, herbs, seeds, etc. Each spring, d4 uses of bendis root (*reach*, *area*).")).toBe("Each spring, d4 uses of bendis root (*reach*, *area*).");
		expect(possessionRulesFrom("picks, files, ◇ prybars, etc.")).toBe("");
	});

	it("are not gear when they are a sentence", () => {
		expect(possessionGearFrom("( ○○○ uses): expend a use to know where to find ___, without having to Know Things; GM can veto.")).toBeNull();
		expect(possessionGearFrom("increase your damage to a d8 and your max HP by 4")).toBeNull();
		expect(possessionGearFrom("Some trinket or garb or other thing of great importance to you. Why is it important?")).toBeNull();
	});

	it("are stored on the playbook as a track and gear, and a possession with its own pick gives no gear", () => {
		const raw = emptyBundle();
		raw.playbook.name = "The Tester";
		raw.playbook.possessions = { pickCount: 1, pickNote: "Pick 1", options: [
			{ label: "Poisoner's kit", description: "(○○○ uses): ◇ nightshade oil (applied, dangerous). Spend a week to refresh 1 use." },
			{ label: "Weapons of War", description: "(Choose 1)\n- ◇ Sword, iron (close)\n- ◇ Battleaxe, iron (close, messy)" },
		] };
		const { bundle } = normalizeBundle(raw);
		const [kit, war] = bundleToItemData(bundle, { slug: "homebrew-the-tester" }).playbook.flags.stonetop.specialPossessions.options;
		expect(kit.resource).toEqual({ max: 3, title: null, labels: [] });
		expect(kit.grantsItems).toEqual([{ name: "Nightshade oil", column: "regular", weight: 1, note: "applied, dangerous" }]);
		expect(kit.rulesNote).toBe("Spend a week to refresh 1 use.");
		expect(war.choices).toBeTruthy();
		expect(war.grantsItems).toBeUndefined();
	});
});

describe("a held possession's own pick, left unmade", () => {
	const playbookData = { specialPossessions: { preselected: [], options: [
		{ slug: "weapons-of-war", label: "Weapons of War", choices: { pickCount: 1, options: [{ slug: "sword" }, { slug: "bow" }] } },
		{ slug: "spare-blades", label: "Spare blades", choices: { pickCount: 2, optional: true, options: [{ slug: "a" }, { slug: "b" }] } },
	] } };
	const char = subChoices => buildLiveCharacter({
		slug: "the-blessed", name: "The Blessed", level: 1,
		flags: { "possessions.selected": ["weapons-of-war", "spare-blades"], "possessions.subChoices": subChoices },
	}).char;

	it("is owed, on its card", () => {
		expect(char({}).possessionChoicesOwed(playbookData)).toEqual({ byMove: {}, bySlug: { "weapons-of-war": 1 }, inline: ["weapons-of-war"] });
	});

	it("is not owed once made, nor when the playbook says it can wait", () => {
		expect(char({ "weapons-of-war": ["sword"] }).possessionChoicesOwed(playbookData)).toEqual({ byMove: {}, bySlug: {}, inline: [] });
	});
});

describe("a background's moves from other playbooks", () => {
	it("are named on the notice, for the builder to drop when every one is found", () => {
		const raw = emptyBundle();
		raw.playbook.name = "The Tester";
		raw.playbook.backgrounds = [{ label: "The Veteran", description: "You get Frosty from the Heavy.", moves: [], moveChoice: ["Frosty", "We Happy Few"], possessions: [], track: null }];
		const { issues } = normalizeBundle(raw);
		expect(issues.find(i => i.borrowed)).toMatchObject({ severity: "check", borrowed: ["Frosty", "We Happy Few"] });
	});
});

describe("a change of playbook offered from a level on", () => {
	it("is kept through the Items and back, and dropped for a playbook whose Level Up IS a change", () => {
		const advancement = { replacesUsual: true, options: ["Increase your max HP to 15.", "Learn a song."], note: "From level 3, you can change playbooks.", switchFromLevel: 3 };
		const raw = emptyBundle();
		raw.playbook.name = "The Tester";
		raw.playbook.advancement = advancement;
		const { bundle } = normalizeBundle(raw);
		const items = bundleToItemData(bundle, { slug: "homebrew-the-tester" });
		expect(items.playbook.flags.stonetop.advancement.switchFromLevel).toBe(3);
		expect(itemsToBundle(items.playbook, items.moves).playbook.advancement).toEqual({ ...advancement, switchPlaybook: false });
		expect(advancementToFlags({ ...advancement, switchFromLevel: 0 }).switchFromLevel).toBeUndefined();
		raw.playbook.advancement = { switchPlaybook: true, switchFromLevel: 3, options: [], note: "" };
		expect(normalizeBundle(raw).bundle.playbook.advancement.switchFromLevel).toBe(0);
	});
});

describe("the emblem beside the playbook's name", () => {
	const name = { page: 1, size: 24, y: 50, title: "The Tester" };
	const pageRuns = { pages: [{ w: 792, h: 612, runs: [
		{ str: "The Tester", x: 423, y: 50, w: 150, size: 24, font: "f1" },
		{ str: "Some words that wrap beside it.", x: 423, y: 70, w: 340, size: 8, font: "f2" },
		{ str: "?", x: 730, y: 60, w: 20, size: 52, font: "f2" },
		{ str: "Background", x: 423, y: 110, w: 60, size: 10, font: "f1" },
	] }] };

	it("is looked for right of the name, above the next heading, the words there blanked but not a glyph emblem", () => {
		const region = emblemRegion(pageRuns, name, [name, { page: 1, title: "Background", y: 110, size: 10 }]);
		expect(region.page).toBe(1);
		expect(region.box).toEqual({ x0: 575, y0: 0, x1: 792, y1: 99 });
		expect(region.mask).toHaveLength(1);
		expect(region.mask[0].x0).toBe(422);
	});

	// A white image with a ring, a mark inside it, and a long rule across the bottom.
	function picture() {
		const width = 200, height = 120;
		const data = new Uint8ClampedArray(width * height * 4).fill(255);
		const ink = (x, y) => { const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; };
		for (let a = 0; a < 720; a++) {
			const t = a * Math.PI / 360;
			for (let r = 38; r <= 41; r++) ink(Math.round(100 + r * Math.cos(t)), Math.round(50 + r * Math.sin(t)));
		}
		for (let y = 40; y < 60; y++) for (let x = 92; x < 108; x++) ink(x, y);
		for (let x = 0; x < width; x++) { ink(x, 110); ink(x, 111); }
		return { width, height, data };
	}

	it("is the ring and what is in it, never the rule", () => {
		const box = emblemBox(picture(), { cell: 1, minPx: 20 });
		expect(box.x).toBeGreaterThanOrEqual(58);
		expect(box.x + box.w).toBeLessThanOrEqual(143);
		expect(box.y + box.h).toBeLessThan(100);
	});

	it("leaves out a speckled rule passing just under the ring, and keeps what pokes out at its side", () => {
		const img = picture();
		const ink = (x, y) => { const i = (y * img.width + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 0; };
		// Speckle a few pixels below the ring (bottom at 91): short dashes, and a chunk as tall as wide.
		for (let x = 60; x < 140; x += 6) for (let dx = 0; dx < 4; dx++) { ink(x + dx, 95); ink(x + dx, 96); }
		for (let y = 93; y < 97; y++) for (let x = 100; x < 104; x++) ink(x, y);
		// A tail past the ring's side, as tall as it is wide.
		for (let y = 70; y < 76; y++) for (let x = 142; x < 147; x++) ink(x, y);
		const box = emblemBox(img, { cell: 1, minPx: 20 });
		expect(box.y + box.h).toBeLessThanOrEqual(92);
		expect(box.x + box.w).toBe(147);
	});

	it("is nothing when there is no emblem-shaped ink", () => {
		const width = 50, height = 50;
		expect(emblemBox({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) })).toBeNull();
	});

	it("loses its paper and keeps its ink", () => {
		const img = { width: 2, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]) };
		inkToAlpha(img);
		expect(img.data[3]).toBe(0);
		expect(img.data[7]).toBe(255);
	});
});

describe("a move that takes a move from another playbook (the live play-through)", () => {
	it("is read as the book's Wild Soul is stored", () => {
		expect(crossPlaybookFrom("(Requires level 2+ and the Stranger) Take a move from the Blessed for which you qualify.")).toEqual({ playbooks: ["The Blessed"] });
		expect(crossPlaybookFrom("Take a move from the Would-Be Hero.")).toEqual({ playbooks: ["The Would-Be Hero"] });
		expect(crossPlaybookFrom("Choose a move from any other playbook.")).toEqual({ playbooks: "any" });
		expect(crossPlaybookFrom("When you take a moment, roll +WIS.")).toBeNull();
	});

	it("is stored on the move Item, so Level Up asks for the other playbook's move", () => {
		const raw = emptyBundle();
		raw.playbook.name = "The Tester";
		raw.moves = [
			{ name: "Witchcraft", description: "Take a move from the Blessed for which you qualify.", level: 2 },
			{ name: "Creeper", description: "You may appear beside another PC." },
		];
		const { moves } = bundleToItemData(normalizeBundle(raw).bundle, { slug: "homebrew-the-tester" });
		expect(moves.find(m => m.name === "Witchcraft").system.crossPlaybook).toEqual({ playbooks: ["The Blessed"] });
		expect(moves.find(m => m.name === "Creeper").system.crossPlaybook).toBeUndefined();
	});
});
