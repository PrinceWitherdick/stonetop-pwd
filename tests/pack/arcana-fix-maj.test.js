import { describe, it, expect } from "vitest";
import { loadArcanaPackDocs } from "../fakes/sourcePack.js";
import { findArcanumFrontMove, parseArcanumFrontMoves, parseArcanumMoves } from "../../module/data/arcana-moves.js";
import { BOX_LAYOUT_CHANGES, consequenceBoxRange, shiftedBoxes } from "../../module/actors/character/CharacterArcana.js";
import { consequenceParents } from "../../module/actors/character/arcana-seeker-moves.js";
import { arcanaSummon } from "../../module/data/arcana-summons.js";

// Arcana audit 2026-11-04, the major arcana (fixer MAJ): card data checked against Book II pp.540-575.

const DOCS = loadArcanaPackDocs();
const card = slug => DOCS.find(d => d.flags?.stonetop?.slug === slug)?.flags?.stonetop;
const backOf = slug => card(slug)?.back?.description ?? "";
const boxCount = html => (String(html).match(/□/g) ?? []).length;
const LABEL_RUN = /<span class="stonetop-glyph-label">([○◇]+)<\/span>/g;

describe("MAJ-3: the weights the book prints", () => {
	it.each([
		["twisted-spear", 2],              // p.542 ◇◇
		["shield-of-the-wisent-witch", 2], // p.554 ◇◇
		["rune-laden-scales", 2],          // p.562 ◇◇
	])("%s weighs %i", (slug, weight) => {
		expect(card(slug).front.item.weight).toBe(weight);
	});

	it.each(["whispering-rocks", "redwood-effigy"])("%s prints no ◇: weightless, as every other weightless card", slug => {
		// pp.550, 570 print them plain "magical". Weightless cards carry no column (CharacterArcana places them by weight).
		expect(card(slug).front.item).toMatchObject({ weight: null, inventoryColumn: null });
		expect(card(slug).front.item.armor).toBeUndefined();
	});
});

describe("MAJ-2: the Lidless Orb's five boxes (p.541)", () => {
	it("prints □ before POWER OF THE LIDLESS ORB and each of its four effects, ahead of the Consequences", () => {
		const back = backOf("staff-of-the-lidless-orb");
		expect(back).toContain("<strong>□ POWER OF THE LIDLESS ORB</strong>");
		expect(back.match(/<li>□ (?:Cast your sight|Hold the Orb before another|Hold the Orb before a mortal|Point the Orb)/g)).toHaveLength(4);
		expect(consequenceBoxRange(back)).toEqual({ from: 5, to: 5 + 9 });
		const [move] = parseArcanumMoves(back);
		expect(move.boxIndex).toBe(0);
		// The effects' own boxes are the card's to tick, not part of the options' words.
		expect(move.picks).toHaveLength(4);
		expect(move.picks.every(p => !p.startsWith("□"))).toBe(true);
	});

	it("registers the shift, so marks stored against the old text follow it", () => {
		const change = BOX_LAYOUT_CHANGES.find(c => c.slug === "staff-of-the-lidless-orb");
		expect(change).toMatchObject({ context: "back", from: 0, by: 5 });
		// "One of your eyes becomes strange", the old first box, lands on its own words in the new text.
		const moved = shiftedBoxes({ "staff-of-the-lidless-orb:back:0": true, "staff-of-the-lidless-orb:backCircle:0": true }, change);
		expect(moved["staff-of-the-lidless-orb:back:5"]).toBe(true);
		expect(moved["staff-of-the-lidless-orb:back:0"]).toBe(false);
		expect(moved["staff-of-the-lidless-orb:backCircle:0"]).toBe(true);
		expect(BOX_LAYOUT_CHANGES.filter(c => c.marker === change.marker)).toHaveLength(1);
	});
});

describe("MAJ-4: the Azure Hand's front miss marks no XP (p.574)", () => {
	it("reads 'instead of marking XP' as no XP on a 6-", () => {
		const front = card("azure-hand").front;
		const [move] = parseArcanumFrontMoves(front.description, { fallbackName: front.title });
		expect(move.noXpOnMiss).toBe(true);
		expect(findArcanumFrontMove(front, move.slug).noXpOnMiss).toBe(true);
	});

	it("still marks XP on a plain miss", () => {
		const [move] = parseArcanumFrontMoves("<p>When you <strong><em>poke it</em></strong>, roll +INT: on a 6-, mark XP and it bites.</p>");
		expect(move.noXpOnMiss).toBe(false);
	});
});

describe("MAJ-8: the Ring's CALL UP THE DEEP ONES rolls nothing (p.561)", () => {
	it("stops reading its roll and its options at the Servant's stat block, and its text at Send Them Back", () => {
		const [callUp] = parseArcanumMoves(backOf("ring-of-daagon"));
		expect(callUp.name).toBe("CALL UP THE DEEP ONES");
		expect(callUp.roll).toBeNull();
		expect(callUp.picks).toEqual([]);
		// The Servant and its 5d4 aspects are what the move calls up, so they stay in its text.
		expect(callUp.description).toContain("Servant of Daagon");
		expect(callUp.description).toContain("roll five d4s");
		expect(callUp.description).not.toContain("send them back");
	});

	it("leaves the Blackwood Fetishes' move, whose stat blocks close the section, as it was", () => {
		const [callForth] = parseArcanumMoves(backOf("blackwood-fetishes"));
		expect(callForth.name).toBe("CALL FORTH AND COMMAND");
		expect(callForth.roll).toBeNull();
		expect(callForth.description).toContain("<strong>Halix</strong>");
	});

	it("keeps a move's own roll and list when no stat block follows", () => {
		const eye = parseArcanumMoves(backOf("azure-hand")).find(m => m.name === "EYE OF THE STORM");
		expect(eye.roll).toBe("con");
		expect(eye.picks).toHaveLength(3);
	});
});

describe("MAJ-12: Storm Markings' last Consequence follows the terrible storm (p.567)", () => {
	it("is nested under 'A terrible storm begins to form', with no box added or lost", () => {
		const back = backOf("storm-markings");
		const range = consequenceBoxRange(back);
		const last = range.to - 1;
		expect(consequenceParents(back).get(last)).toEqual([last - 1]);
		expect(boxCount(back)).toBe(2 + 3 + 2 + 5);
	});
});

describe("MAJ-14 / A12: the Mindgem, the Wisent Shield and Halix", () => {
	it("Mindgem: □ The Mighty Servant heads the back, registered as a shift; the heart ◇ and helm ◇◇ are printed", () => {
		const mg = card("mindgem");
		expect(mg.back.description.startsWith("<h3>□ The Mighty Servant</h3>")).toBe(true);
		expect(BOX_LAYOUT_CHANGES).toContainEqual(expect.objectContaining({ slug: "mindgem", context: "back", from: 0, by: 1 }));
		expect(mg.front.description).toContain("Recover its ◇ \"heart,\"");
		// A ◇◇ run would be a markable track: this one is a weight, drawn and never ticked (A7).
		expect(mg.front.description).toContain("intricate <span class=\"stonetop-glyph-label\">◇◇</span> bronze helm");
		expect(boxCount(mg.front.description)).toBe(4);
	});

	it("Mindgem: says that sharing holders mark the one list, kept in step by hand (Book I p.442)", () => {
		expect(backOf("mindgem")).toMatch(/<h3>Consequences<\/h3><p><em>Sharing the Mindgem: [^<]*keep them in step by hand\.<\/em><\/p><ul>/);
	});

	it("the Wisent consequence keeps 'and become more so if they already were forceful' (p.555)", () => {
		expect(backOf("shield-of-the-wisent-witch")).toContain("(and become more so if they already were <em>forceful</em>)");
	});

	it("Halix: harmed only by silver or salt, and the host's weapon's tags vary (p.565), on the card and the summon", () => {
		const back = backOf("blackwood-fetishes");
		expect(back).toContain("host's weapon d6 (tags vary)");
		expect(back.match(/Manifest a ghostly presence \(harmed only by silver or salt\)/g)).toHaveLength(2);
		const halix = arcanaSummon("blackwood-fetishes").followers.find(f => f.name === "Halix");
		expect(halix.damage).toContain("host's weapon d6 (tags vary)");
		expect(halix.moves.split("\n")[0]).toBe("Manifest a ghostly presence (harmed only by silver or salt)");
	});
});

describe("A7: follower Loyalty on a major's card is drawn, never ticked", () => {
	it.each([
		["ring-of-daagon", 1],
		["mindgem", 1],
		["blackwood-fetishes", 2],
		["demonhide-cloak", 1],
	])("%s wraps its %i Loyalty run(s), and no ○○ run of a follower is left markable", (slug, n) => {
		const back = backOf(slug);
		const runs = [...back.matchAll(LABEL_RUN)].map(m => m[1]);
		expect(runs).toEqual(Array(n).fill("○○○"));
		expect(back).not.toMatch(/Loyalty ○/);
	});

	it("leaves the Demonhide Cloak's Guise a track, and it prints before the Loyalty (no later run shifts)", () => {
		const back = backOf("demonhide-cloak");
		expect(back).toContain("UNHOLY VISAGE ○○○</strong>");
		expect(back.indexOf("UNHOLY VISAGE ○○○")).toBeLessThan(back.indexOf("stonetop-glyph-label"));
	});
});
