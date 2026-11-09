// Arcana audit 2026-11-04, slice MNA (Book II pp.508-523): the card data fixes, pinned against the
// pack sources so a later edit that undoes one fails here. Engine support for the new fields
// (`path`, `rollUses`, the display-only glyph label) is ENG's and tested with the engine.
import { describe, it, expect } from "vitest";
import { loadArcanaPackDocs } from "../fakes/sourcePack.js";
import { arcanaSummon } from "../../module/data/arcana-summons.js";
import { buildCustomFollower } from "../../module/data/follower-build.js";
import { condensedArcanumMove, parseArcanumFrontMoves } from "../../module/data/arcana-moves.js";
import { moveBodyHtml } from "../../module/utils/move-tiers.js";
import { decodeEntities } from "../../module/utils/strings.js";

const DOCS = loadArcanaPackDocs();
const card = slug => {
	const doc = DOCS.find(d => d.flags?.stonetop?.slug === slug);
	if (!doc) throw new Error(`no card ${slug}`);
	return doc.flags.stonetop;
};
const plain = html => decodeEntities(String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
const rowsOf = html => Object.fromEntries([...html.matchAll(/data-tier="(\w+)"[\s\S]*?tier-text">([\s\S]*?)<\/span><\/li>/g)]
	.map(([, key, row]) => [key, plain(row)]));
const GLYPH_LABEL = /<span class="stonetop-glyph-label">([○◇□]+)<\/span>/g;
// The glyphs a card's text still turns into marks: everything outside a display-only label.
const liveGlyphs = html => (String(html).replace(GLYPH_LABEL, "").match(/[○◇□]+/g) ?? []);

describe("MNA-1 / A1: either/or unlocks carry one path per alternative", () => {
	const CASES = {
		"a-folktale":                ["herbalist-teacher", "gwir-nettle-spirit"],
		"small-strange-book":        ["fae-help", "risk-recipe"],
		"clear-natural-pool":        ["experiment-at-pool", "firsthand-account"],
		"strange-skull-and-antlers": ["learn-name", "call-spirits"],
	};
	for (const [slug, slugs] of Object.entries(CASES)) {
		it(`${slug}: every option is its own path, slugs unchanged`, () => {
			const options = card(slug).front.unlock.requirements.filter(r => r.type === "option");
			expect(options.map(o => o.slug)).toEqual(slugs);
			const paths = options.map(o => o.path);
			expect(paths.every(p => typeof p === "string" && p.length > 0)).toBe(true);
			expect(new Set(paths).size).toBe(options.length);
		});
	}

	it("leaves the all-of cards unpathed", () => {
		for (const slug of ["old-scroll-case", "oversized-codex", "time-worn-missive", "huge-wooden-sphere"]) {
			expect(card(slug).front.unlock.requirements.some(r => r.path), slug).toBe(false);
		}
	});
});

describe("MNA-2: the oversized codex's size marker", () => {
	const back = () => card("oversized-codex").back.description;

	it("prints the book's \"(else, it's ◇◇ at most)\" as a display-only label", () => {
		expect(back()).toContain("encase a person (else, it's <span class=\"stonetop-glyph-label\">◇◇</span> at most)");
	});

	it("has no markable track left on its back (the old ○○ is gone)", () => {
		expect(back()).not.toContain("○");
		expect(liveGlyphs(back())).toEqual([]);
	});
});

describe("MNA-3: the old scroll case's condensed move", () => {
	const move = () => card("old-scroll-case").back.move;

	it("absorbs on a 7+ and drains the ingot on a 7-9, as Book II p.508 prints", () => {
		const rows = rowsOf(moveBodyHtml(move().description, null));
		expect(rows.success).toMatch(/absorb the power and gain 1d8 HP/);
		expect(rows.partial).toMatch(/the aetherium is drained/);
		// "until you roll a 6- on any move" is when the spell ends, not a 6- rung.
		expect(Object.keys(rows).sort()).toEqual(["partial", "success"]);
		expect(move().description).not.toMatch(/on a 10\+/i);
		expect(condensedArcanumMove(move()).roll).toBe("con");
	});

	it("keeps the spell's WIS advantage and the 1d8 HP lost when it ends", () => {
		const text = plain(move().description);
		expect(text).toContain("gain advantage on any rolls with WIS");
		expect(text).toContain("When the spell ends , you lose 1d8 HP");
	});
});

describe("MNA-4 / MNA-12 / MNA-17: the summons", () => {
	it("gives the dool spirit its printed d6 (Book II p.514)", () => {
		const dool = arcanaSummon("scroll-and-bone-flute").followers[0];
		expect(dool.damage).toMatch(/^feast on fear d6 /);
		expect(card("scroll-and-bone-flute").back.description).toContain("feast on fear d6");
	});

	it("makes the mantle wraiths a group of three, 13 HP each (Book II p.512)", () => {
		const input = arcanaSummon("tattered-mantle").followers[0];
		const built = buildCustomFollower(input);
		expect(built.isGroup).toBe(true);
		expect(built.size).toBe(3);
		expect(built.hpMax).toBe(13);
		expect(built.tags.some(t => /group/i.test(t))).toBe(false);
	});

	it("whispers to the wearer, on the card and the follower", () => {
		expect(arcanaSummon("tattered-mantle").followers[0].moves).toContain("Whisper their longings to the wearer");
		const mantle = card("tattered-mantle");
		expect(mantle.back.description).toContain("Whisper their longings to the wearer");
		expect(mantle.back.description + arcanaSummon("tattered-mantle").followers[0].moves).not.toContain("weaver");
		expect(mantle.front.description).toContain("human teeth sewn into the fringe like decorative beads");
	});

	it("starts the andalau at 1 Loyalty (Book II p.523)", () => {
		expect(buildCustomFollower(arcanaSummon("cracked-flute").followers[0]).loyalty).toBe(1);
	});

	it("drops the cloak's empty Special qualities label", () => {
		expect(card("cloak-richly-embroidered").back.description).not.toContain("Special qualities");
	});
});

describe("MNA-7 / MNA-17: the clear natural pool", () => {
	it("prints 7 Strain (Book II p.514)", () => {
		expect(card("clear-natural-pool").back.resource).toMatchObject({ max: 7, title: "Strain" });
	});

	it("tosses the blooded metal, on the back and its condensed move", () => {
		const back = card("clear-natural-pool").back;
		expect(back.description).toContain("toss the blooded metal into the pool");
		expect(back.move.name).toContain("toss the blooded metal into the pool");
		expect(back.description + back.move.name).not.toContain("bladed");
	});
});

describe("MNA-8 / A9: the time-worn missive's pouch", () => {
	const pouch = () => card("time-worn-missive").back.item;

	it("draws all 12 printed uses and rolls how many are in it (1d4+8)", () => {
		expect(pouch().resource).toMatchObject({ max: 12, rollUses: "1d4+8", title: null });
	});

	it("has blank pips and keeps the Value in the note, not on a pip", () => {
		expect(pouch().resource.labels).toEqual([]);
		expect(pouch().note).toBe("1d4+8 uses, Value 2");
	});

	it("drops the unprinted warm, magical tags", () => {
		expect(pouch().note).not.toMatch(/warm|magical/);
		expect(pouch().weight).toBe(1);
	});
});

describe("MNA-9: what the condensed moves roll", () => {
	it("rolls nothing for the two summons (the flute's +CHA is the front practice)", () => {
		for (const slug of ["scroll-and-bone-flute", "cracked-flute"]) {
			const move = card(slug).back.move;
			expect(move.rollType, slug).toBeNull();
			expect(condensedArcanumMove(move).roll, slug).toBeNull();
		}
	});

	it("rolls the wolf pelt with no stat (Book II p.523, \"Name your quarry and roll\")", () => {
		const move = card("wolf-pelt").back.move;
		expect(move.rollType).toBe("nothing");
		expect(condensedArcanumMove(move).roll).toBe("nothing");
	});

	it("still finds the cracked flute's practice roll on its front", () => {
		const front = card("cracked-flute").front;
		expect(parseArcanumFrontMoves(front.unlock.description, { prefix: "~unlock" }).map(m => m.roll)).toEqual(["cha"]);
	});
});

describe("MNA-10: condensed moves keep the book's clauses", () => {
	it("stretched vellum rolls 1d10+CON when the spell works (p.521)", () => {
		expect(card("stretched-vellum").back.move.description).toContain("When the spell works, roll 1d10+CON.");
	});

	it("crumbling arch keeps the 7-9's powerful entities (p.520)", () => {
		expect(card("crumbling-arch").back.move.description).toContain("but powerful entities can force themselves to ignore it");
	});

	it("gold ring keeps the psychic beacon (p.516)", () => {
		expect(plain(card("gold-ring").back.move.description)).toContain("the ring also shines like a psychic beacon");
	});

	it("sealed cave keeps both triggers and puts the +WIS on willing yourself on (p.519)", () => {
		const move = card("sealed-cave").back.move;
		const text = plain(move.description);
		expect(text).toContain("or to harm the peacebond glyphs themselves , you hesitate");
		expect(text).toMatch(/will yourself to continue , lose 1d4 HP and roll \+WIS/);
		expect(condensedArcanumMove(move).roll).toBe("wis");
		const rows = rowsOf(moveBodyHtml(move.description, null));
		expect(rows.partial).toContain("disadvantage on any rolls to commit violence (including damage)");
		expect(rows.failure).toContain("mark dazed");
	});

	it("time-worn missive's +INT is the second way, without the ink (p.517)", () => {
		const move = card("time-worn-missive").back.move;
		const text = plain(move.description);
		expect(text).toMatch(/^A passage opens between the portals/);
		expect(text).toMatch(/Without the ink: when you stand before one portal .* mark a debility to manifest those sigils/);
		expect(text).toMatch(/then invoke the axiom of local contagion , roll \+INT/);
		expect(condensedArcanumMove(move).roll).toBe("int");
		const rows = rowsOf(moveBodyHtml(move.description, null));
		expect(rows.success).toContain("The portals open, but close as soon as your focus falters");
		expect(rows.failure).toContain("pass out from the strain");
	});
});

describe("MNA-13 / A7: summon Loyalty on the card is display-only", () => {
	for (const slug of ["tattered-mantle", "scroll-and-bone-flute", "cloak-richly-embroidered", "cracked-flute"]) {
		it(`${slug}: (Loyalty ○○○) is a glyph label, and the back has no markable glyph left`, () => {
			const back = card(slug).back.description;
			expect(back).toContain("(Loyalty <span class=\"stonetop-glyph-label\">○○○</span>)");
			expect(liveGlyphs(back)).toEqual([]);
		});
	}
});

describe("MNA-15 / A11: small counts", () => {
	it("small strange book: the wine skin is a back item with 5 uses, magical (p.509)", () => {
		const back = card("small-strange-book").back;
		expect(back.item).toMatchObject({ name: "Skin of Old Mother's Wine", weight: null, note: "<em>magical</em>" });
		expect(back.item.resource).toMatchObject({ max: 5, labels: [] });
		// The lost-memories track stays the back's own.
		expect(back.resource).toMatchObject({ max: 6, title: "Lost memories" });
	});

	it("huge wooden sphere: the tonic's 3 uses ride the item, which prints no weight (p.513)", () => {
		const back = card("huge-wooden-sphere").back;
		expect(back.resource).toBeNull();
		expect(back.item).toMatchObject({ name: "Ffyrnig Tonic", weight: null, note: "<em>magical</em>" });
		expect(back.item.resource).toMatchObject({ max: 3 });
	});

	it("richly woven rug: \"hold Terror\" is a □, the back's first (p.512)", () => {
		const back = card("richly-woven-rug").back.description;
		expect(back).toContain("<strong>□ Terror</strong>");
		expect(back.match(/□/g)).toHaveLength(1);
		expect(back).not.toContain("○");
	});
});

describe("MNA-16: the unlock lead is printed once", () => {
	const LEADS = {
		"giants-dormitory":    "You can learn this spell, but",
		"grim-peat-mound":     "It is young and eager",
		"rune-etched-pillars": "You can unlock their secrets",
		"path-in-the-woods":   "set forth upon the trail at midsummer",
		"the-key":             "so much as it unlocks you",
	};
	for (const [slug, lead] of Object.entries(LEADS)) {
		it(`${slug}: in the unlock lead, not the front's description`, () => {
			const front = card(slug).front;
			expect(plain(front.unlock.description)).toContain(lead);
			expect(plain(front.description)).not.toContain(lead);
			// No front move printed in the text that moved, so no ~front:n handle shifts.
			expect(parseArcanumFrontMoves(front.description)).toEqual([]);
		});
	}

	it("keeps the book's bold triggers in the moved leads", () => {
		expect(card("giants-dormitory").front.unlock.description).toContain("<strong><em>enter the dormitory</em></strong>");
		expect(card("path-in-the-woods").front.unlock.description).toContain("<strong><em>set forth upon the trail at midsummer</em></strong>");
	});

	it("huge wooden sphere: the lead is no longer repeated as a text requirement", () => {
		const unlock = card("huge-wooden-sphere").front.unlock;
		expect(unlock.requirements.filter(r => r.type === "text").map(r => r.content)).toEqual(["And then…"]);
		expect(unlock.requirements.filter(r => r.type === "option").map(r => r.slug)).toEqual([
			"dig-up-clean", "study-glyphs", "acquire-ffyrnig-root", "acquire-boar-bile", "risk-recipe",
		]);
	});
});
