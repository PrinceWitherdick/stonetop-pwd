// Arcana audit 2026-11-04, slice MNB (Book II pp.524-539): the card data fixes, pinned against the
// pack sources so a later edit that undoes one fails here. Engine support for the new fields
// (`path`, the display-only glyph label) is ENG's and tested with the engine; the count settle that
// goes with A8 / A10 is tests/migration/arcana-audit-1104.test.js.
import { describe, it, expect } from "vitest";
import { loadArcanaPackDocs } from "../fakes/sourcePack.js";
import { arcanaSummon } from "../../module/data/arcana-summons.js";
import { arcanumUnlockedUnder } from "../../module/actors/character/CharacterArcana.js";
import { condensedArcanumMove } from "../../module/data/arcana-moves.js";
import { moveBodyHtml } from "../../module/utils/move-tiers.js";
import { decodeEntities } from "../../module/utils/strings.js";
import { followerRefresh, FOLLOWER_SUPERSEDED } from "../../module/migration/follower-refresh.js";
import { readRepo } from "../fakes/css.js";

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

describe("MNB-1 / A1: the silvery glass bottle's either/or unlock (p.529)", () => {
	const options = () => card("silvery-glass-bottle").front.unlock.requirements.filter(r => r.type === "option");

	it("prints the teacher as one path and the fill + drink boxes as another, keeping the old slug first", () => {
		expect(options().map(o => [o.slug, o.path])).toEqual([
			["find-teacher", "teacher"],
			["fill-and-drink", "brew"],
			["drink-contents", "brew"],
		]);
		expect(options()[1].description).toMatch(/steep in the dark for a fortnight\.$/);
		expect(options()[2].description).toMatch(/^… drink the contents/);
	});

	it("unlocks by either path, and not by half the brew", () => {
		const bottle = card("silvery-glass-bottle");
		const at = counts => arcanumUnlockedUnder(bottle, Object.fromEntries(Object.entries(counts).map(([k, v]) => [`silvery-glass-bottle:${k}`, v])));
		expect(at({ "find-teacher": 1 })).toBe(true);
		expect(at({ "fill-and-drink": 1, "drink-contents": 1 })).toBe(true);
		expect(at({ "fill-and-drink": 1 })).toBe(false);
		expect(at({})).toBe(false);
	});
});

describe("MNB-3 / A8: the mummified hand (p.536)", () => {
	it("counts three crystals on the front", () => {
		const soak = card("mummified-hand").front.unlock.requirements.find(r => r.slug === "soak-crystal");
		expect(soak.max).toBe(3);
	});

	it("makes the back's three \"mark one\" changes tick boxes, and has no other glyph there", () => {
		const back = card("mummified-hand").back.description;
		expect(back.match(/<li>□ /g)).toHaveLength(3);
		expect(liveGlyphs(back)).toEqual(["□", "□", "□"]);
		expect(back).not.toContain("○");
	});

	it("draws those boxes (and the rug's Terror box) as the printed ○", () => {
		const css = readRepo("styles/stonetop.css");
		expect(css).toContain('input[type=checkbox].stonetop-arcanum-box[data-arcanum-slug="mummified-hand"][data-context="back"]');
		expect(css).toContain('input[type=checkbox].stonetop-arcanum-box[data-arcanum-slug="richly-woven-rug"][data-context="back"][data-index="0"]');
		expect(css).toContain('form:has(.stonetop-arcanum-sheet-side[data-slug="mummified-hand"]) .stonetop-arcanum-sheet-back .stonetop-glyph--checkbox');
		expect(css).toContain('form:has(.stonetop-arcanum-sheet-side[data-slug="richly-woven-rug"]) .stonetop-arcanum-sheet-back .stonetop-glyph--checkbox');
	});
});

describe("MNB-4: the oversized crown prints no Cost (p.539)", () => {
	it("drops the invented Cost line and its circles; Loyalty stays the header track", () => {
		const back = card("oversized-crown").back;
		expect(back.description).not.toMatch(/Cost|gratitude/);
		expect(liveGlyphs(back.description)).toEqual([]);
		expect(back.resource).toMatchObject({ max: 3, title: "Loyalty" });
	});

	it("keeps the crown in the inventory after unlock (no renaming back item)", () => {
		expect(card("oversized-crown").back.item).toBeNull();
	});

	it("summons the Void elemental with no cost, and clears the old one off a summoned card", () => {
		const elemental = arcanaSummon("oversized-crown").followers[0];
		expect(elemental.cost).toBe("");
		const old = { sourceUuid: "oversized-crown:void-elemental", cost: FOLLOWER_SUPERSEDED["oversized-crown:void-elemental"].cost[0] };
		expect(followerRefresh(old)).toEqual({ cost: "" });
		expect(followerRefresh({ ...old, cost: "a song" })).toBeNull();
	});
});

describe("MNB-5 / MNB-6 / MNB-7: the book's tiers", () => {
	it("treasure map: 10+ pick 1; 7-9 pick 1 and the GM another; 6- all 3 (p.538)", () => {
		const back = card("treasure-map").back;
		expect(back.description).toContain("<strong>on a 10+</strong>, pick 1; <strong>on a 7-9</strong>, pick 1 and the GM picks another; <strong>on a 6-</strong>, all 3:");
		const rows = rowsOf(moveBodyHtml(back.move.description, null));
		expect(rows.success).toMatch(/^pick 1.?$/i);
		expect(rows.partial).toMatch(/^pick 1 and the GM picks another.?$/i);
		expect(rows.failure).toMatch(/^all 3/i);
	});

	it("prospector's tale: 10+ pick 1, or 2 and further damage; 7-9 pick 1 and further damage (p.533)", () => {
		const back = card("prospectors-tale").back;
		expect(back.description).toContain("<strong>On a 10+</strong>, pick 1, or 2 and further damage your voice; <strong>on a 7-9</strong>, pick 1 and further damage your voice:");
		const rows = rowsOf(moveBodyHtml(back.move.description, null));
		expect(rows.success).toMatch(/^pick 1, or 2 and further damage your voice.?$/i);
		expect(rows.partial).toMatch(/^pick 1 and further damage your voice/i);
	});

	it("metal puzzle box: the player picks, the GM adds one on a 7-9 (p.539)", () => {
		const back = card("metal-puzzle-box").back;
		expect(back.description).toContain("<strong>on a 10+</strong>, pick 1; <strong>on a 7-9</strong>, pick 1 and the GM picks another; <strong>on a 6-</strong>, all 3:");
		expect(back.description + back.move.description).not.toMatch(/GM picks [12]/);
		const rows = rowsOf(moveBodyHtml(back.move.description, null));
		expect(rows.success).toMatch(/^pick 1.?$/i);
		expect(rows.partial).toMatch(/^pick 1 and the GM picks another.?$/i);
	});
});

describe("MNB-8 / MNB-9 / MNB-10 / MNB-17: items and tracks", () => {
	it("gold butter lamp is lit using the magic butter, and is beautiful (p.527)", () => {
		const lamp = card("gold-butter-lamp");
		expect(lamp.front.item.note).toBe("<em>magical, beautiful, reach, area</em>");
		expect(lamp.back.description).toContain("<em>light the lamp using the magic butter and intone the mantra</em>");
		expect(lamp.back.move.name).toBe("When you light the lamp using the magic butter and intone the mantra");
	});

	it("beautiful scroll weighs ◇ and sits in the regular column (p.527)", () => {
		expect(card("beautiful-scroll").front.item).toMatchObject({ weight: 1, inventoryColumn: "regular" });
	});

	it("large wooden jar holds 9 Ire (p.525)", () => {
		expect(card("large-wooden-jar").back.resource).toMatchObject({ max: 9, title: "Ire" });
	});

	it("humble broom stays the broom after unlock, with the back's tags in its move (p.537)", () => {
		const broom = card("humble-broom");
		expect(broom.back.item).toBeNull();
		expect(broom.front.item.note).toBe("<em>magical, crude</em>");
		expect(broom.back.move.description).toContain("(<em>magical, area, near</em>)");
	});
});

describe("MNB-12 / A7: follower Loyalty in stat blocks is display-only", () => {
	for (const slug of ["rusty-cauldron", "beautiful-scroll", "metal-man", "stone-idol"]) {
		it(`${slug}: the Loyalty ○○○ is a label, and no ○ run is left to mark`, () => {
			const back = card(slug).back.description;
			expect(back).toMatch(/\(Loyalty:? <span class="stonetop-glyph-label">○○○<\/span>\)<\/p>$/);
			expect(liveGlyphs(back).filter(run => run.includes("○"))).toEqual([]);
		});
	}
});

describe("MNB-13: the disturbing mask's condensed move (p.529)", () => {
	it("rolls +CHA on the trigger the book gives it, and keeps the removal roll", () => {
		const move = card("disturbing-mask").back.move;
		expect(move.name).toBe("When you interact with an NPC known to whoever's visage you wear");
		expect(condensedArcanumMove(move).roll).toBe("cha");
		const text = plain(move.description);
		expect(text).toContain("spend Ken 1-for-1 to ask the GM");
		expect(text).toContain("When you remove the mask after wearing someone's visage, roll +CON");
		expect(text).toContain("the mask leaves lasting, distinctive scars");
	});
});

describe("MNB-14: condensed moves keep the book's clauses", () => {
	const text = slug => plain(card(slug).back.move.description);

	it("sunken tablet: the steading spends 1 Surplus to plant (p.524)", () => {
		expect(text("sunken-tablet")).toContain("if the steading spends 1 Surplus to plant in the fallow fields");
		expect(text("sunken-tablet")).toContain("or the extra crops fail and the extra Surplus is lost");
	});

	it("rusty steel blade: the Blaze die rises after you resolve the Clash (p.534)", () => {
		expect(text("rusty-steel-blade")).toContain("after you resolve the move and deal damage, increase the Blaze die one step");
	});

	it("corroded spearhead: no ammo to deplete, and the 6- drains it (p.531)", () => {
		expect(text("corroded-spearhead")).toContain("(and you cannot choose to deplete ammo)");
		expect(text("corroded-spearhead")).toContain("clear the last 3 check boxes on the front of this card");
	});

	it("bow with no string: snake eyes blows it up (p.532)", () => {
		expect(text("bow-with-no-string")).toContain("if you roll snake eyes to Let Fly, the bow explodes (3d6 damage, reach, area, forceful, loud)");
	});

	it("whispering word: an indestructible object costs 1 more pick (p.530)", () => {
		expect(text("whispering-word")).toContain("if the object was indestructible , pick 1 more");
	});

	it("runic branding iron: a 6- bars it until you Convalesce (p.534)", () => {
		expect(text("runic-branding-iron")).toContain("you cannot do this again until you Convalesce");
	});

	it("ragged fur cloak: sunlight, holy light or another wearer drains it (p.528)", () => {
		expect(text("ragged-fur-cloak")).toContain("When direct sunlight or holy light touches the cloak, or anyone but you dons it, it loses all its Charges");
	});

	it("silvery signet ring: advantage only to Persuade your follower(s) (p.535)", () => {
		expect(text("silvery-signet-ring")).toContain("When you Persuade your follower(s) while holding Authority, you have advantage");
	});
});

describe("MNB-15: the book's words", () => {
	it("fine ceramic urn: different materials show a seam (p.526)", () => {
		const back = card("fine-ceramic-urn").back;
		expect(back.description).toContain("Different materials will show a natural, gradient seam. Similar materials will fuse together seamlessly.");
		expect(back.move.description).toContain("different materials show a natural, gradient seam");
	});

	it("runic branding iron: \"cannot do this again until you Convalesce\" (p.534)", () => {
		expect(card("runic-branding-iron").back.description).toContain("you cannot do this again until you Convalesce.");
		expect(card("runic-branding-iron").back.description).not.toContain("must Convalesce");
	});

	it("silvery signet ring: \"a voice that all can hear\" (p.535)", () => {
		expect(card("silvery-signet-ring").back.description).toContain("speaking in a voice that all can hear");
	});

	it("stone idol: All-mighty Thistlewisk, card and follower, under the old summon id (p.538)", () => {
		expect(card("stone-idol").back.description).toContain("<strong>All-mighty Thistlewisk</strong>");
		const idol = arcanaSummon("stone-idol").followers[0];
		expect(idol.name).toBe("All-mighty Thistlewisk");
		expect(idol.sourceUuid).toBe("stone-idol:thistlewik");
	});

	it("rusty steel blade: \"rune-like sworls\" (p.534)", () => {
		expect(card("rusty-steel-blade").front.description).toContain("a pattern of rune-like sworls");
	});
});

describe("MNB-16 / A10: tracks whose first state comes ticked", () => {
	it("Blaze: 0 is nil, then 1d4, 1d6, 1d8, 1d10 (p.534)", () => {
		expect(card("rusty-steel-blade").back.resource).toMatchObject({ max: 4, title: "Blaze", labels: ["1d4", "1d6", "1d8", "1d10"] });
	});

	it("Silver Branch: 0 is fresh, then fading, bare (p.538)", () => {
		expect(card("treasure-map").back.resource).toMatchObject({ max: 2, labels: ["fading", "bare"] });
	});
});
