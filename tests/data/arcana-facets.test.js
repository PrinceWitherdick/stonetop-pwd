import { describe, it, expect } from "vitest";
import {
	ARCANUM_KINDS, ARCANUM_TIERS, arcanumKinds, arcanumTier,
	isCarriedArcanumItem, isImmobileArcanumItem, isImplantedArcanumItem,
} from "../../module/data/arcana-facets.js";

const KIND_KEYS = ARCANUM_KINDS.map(k => k.key);
const TIER_KEYS = ARCANUM_TIERS.map(t => t.key);
import { ARCANA_SUMMONS } from "../../module/data/arcana-summons.js";
import { MAJOR_ARCANA_ICONS, isMajorArcanumItem } from "../../module/arcana-icons.js";
import { loadArcanaPackDocs } from "../fakes/sourcePack.js";

/** The shape arcanumKinds() reads, built from a pack doc's flags. */
function arcOf(doc) {
	const f = doc.flags?.stonetop ?? {};
	return { slug: f.slug, front: f.front ?? {}, back: f.back ?? {}, summon: f.summon ?? null };
}

describe("ARCANUM_KINDS", () => {
	it("is the three browser facets, in chip order", () => {
		expect(KIND_KEYS).toEqual(["relic", "power", "conduit"]);
	});

	it("gives every kind a label, icon and tooltip hint", () => {
		for (const kind of ARCANUM_KINDS) {
			expect(kind.label, kind.key).toBeTruthy();
			expect(kind.icon, kind.key).toMatch(/^fas fa-/);
			expect(kind.hint, kind.key).toBeTruthy();
		}
	});
});

describe("ARCANUM_TIERS", () => {
	it("is the Major / Minor chip pair", () => {
		expect(TIER_KEYS).toEqual(["major", "minor"]);
	});

	it("gives every tier a label, icon and tooltip hint", () => {
		for (const tier of ARCANUM_TIERS) {
			expect(tier.label, tier.key).toBeTruthy();
			expect(tier.hint, tier.key).toBeTruthy();
			// Solid weight only: the system loads no `far` anywhere, so a regular-weight
			// icon would render as an empty box.
			expect(tier.icon, tier.key).toMatch(/^fas fa-/);
		}
	});
});

describe("arcanumTier", () => {
	it("reads a shipped major off the icon allowlist", () => {
		expect(arcanumTier({ slug: "red-scepter" })).toBe("major");
		expect(arcanumTier({ slug: "wolf-pelt" })).toBe("minor");
	});

	it("honours a homebrew card's own major flag", () => {
		expect(arcanumTier({ slug: "my-card", major: true })).toBe("major");
		expect(arcanumTier({ slug: "my-card" })).toBe("minor");
	});

	it("calls an unknown or absent arcanum minor rather than throwing", () => {
		expect(arcanumTier(null)).toBe("minor");
		expect(arcanumTier({})).toBe("minor");
	});
});

describe("arcanumKinds", () => {
	it("reads Relic off a front item", () => {
		expect(arcanumKinds({ front: { item: { name: "A rusty knife" } } })).toEqual(["relic"]);
		expect(arcanumKinds({ front: { item: null } })).toEqual([]);
	});

	it("reads Power off a back move or a resource track", () => {
		expect(arcanumKinds({ back: { move: { name: "Speak the Word" } } })).toEqual(["power"]);
		expect(arcanumKinds({ back: { resource: { title: "Vitality" } } })).toEqual(["power"]);
	});

	it("ignores an empty move or resource husk", () => {
		expect(arcanumKinds({ back: { move: { name: "" }, resource: { title: "" } } })).toEqual([]);
	});

	it("reads Conduit off the shipped summon registry", () => {
		expect(arcanumKinds({ slug: "metal-man" })).toEqual(["conduit"]);
		expect(arcanumKinds({ slug: "red-scepter" })).toEqual([]);
	});

	it("reads Conduit off a homebrew summon, with no registry entry", () => {
		const arc = { slug: "my-charm", summon: { followers: [{ name: "Wisp" }] } };
		expect(arcanumKinds(arc)).toContain("conduit");
	});

	it("returns overlapping kinds in chip order — the facets are not buckets", () => {
		const arc = {
			slug:  "metal-man",
			front: { item: { name: "Metal man" } },
			back:  { move: { name: "Command it" } },
		};
		expect(arcanumKinds(arc)).toEqual(["relic", "power", "conduit"]);
	});

	it("survives a half-authored card with no front or back at all", () => {
		expect(arcanumKinds({ slug: "blank" })).toEqual([]);
		expect(arcanumKinds(null)).toEqual([]);
	});

	it("never reports a kind that isn't one of the three", () => {
		expect(arcanumKinds({ front: { item: { name: "x" } } })).not.toContain("cursed");
	});
});

describe("isImmobileArcanumItem", () => {
	// Book I p.437: "If it's too big to just carry on your person, give it the `immobile` tag."
	it("reads the tag out of the printed tag line", () => {
		expect(isImmobileArcanumItem({ note: "<em>immobile</em>" })).toBe(true);
		expect(isImmobileArcanumItem({ note: "<em>magical, beautiful, immobile</em>" })).toBe(true);
		expect(isImmobileArcanumItem({ note: "<em>IMMOBILE</em>" })).toBe(true);
	});

	it("is false for a curio you can pocket, and for nothing at all", () => {
		expect(isImmobileArcanumItem({ note: "<em>magical</em>" })).toBe(false);
		expect(isImmobileArcanumItem({ note: null })).toBe(false);
		expect(isImmobileArcanumItem(null)).toBe(false);
	});

	it("matches a whole word, so a tag that merely contains it doesn't count", () => {
		expect(isImmobileArcanumItem({ note: "<em>immobilizing</em>" })).toBe(false);
	});

	it("is independent of the implanted tag beside it", () => {
		const markings = { note: "<em>implanted, magical</em>" };
		expect(isImplantedArcanumItem(markings)).toBe(true);
		expect(isImmobileArcanumItem(markings)).toBe(false);
	});
});

describe("the shipped cards the book tags immobile", () => {
	const docs = loadArcanaPackDocs();

	it("finds all seven, front side, exactly as Appendix C prints them", () => {
		const immobile = docs
			.filter(d => isImmobileArcanumItem(d.flags.stonetop.front?.item))
			.map(d => d.flags.stonetop.slug).sort();
		expect(immobile).toEqual([
			"huge-wooden-sphere",
			"oversized-codex",
			"rusty-cauldron",
			"strange-skull-and-antlers",
			"sunken-tablet",
			"vein-of-milky-crystal",
			"whispering-word",
		]);
	});

	it("leaves the realised BACK item carriable — a place can still yield gear", () => {
		// The vein of milky crystal is immobile; the Moonstone you cut out of it is not.
		const vein = docs.find(d => d.flags.stonetop.slug === "vein-of-milky-crystal");
		expect(isImmobileArcanumItem(vein.flags.stonetop.front.item)).toBe(true);
		expect(isImmobileArcanumItem(vein.flags.stonetop.back.item)).toBe(false);
	});

	// THE CHIP AND THE SHEET HAVE TO AGREE, because a GM can have both on screen at once. The
	// Relic chip's hint reads, verbatim, "the arcanum itself is an item in your load" — and the
	// Inventory tab is what decides whether it goes there. The two were written out separately
	// and came apart: the chip excluded only the implanted, so all seven of these wore a promise
	// the sheet then refused. One predicate answers both now.
	it("gives none of the seven the Relic chip, since none can be in a load", () => {
		const chipped = docs
			.filter(d => isImmobileArcanumItem(d.flags.stonetop.front?.item))
			.filter(d => arcanumKinds(arcOf(d)).includes("relic"))
			.map(d => d.flags.stonetop.slug);
		expect(chipped).toEqual([]);
	});

	it("still chips an ordinary carried curio, so the rule did not just delete Relic", () => {
		const relics = docs.filter(d => arcanumKinds(arcOf(d)).includes("relic"));
		expect(relics.length).toBeGreaterThan(20);
	});

	// The predicate the two surfaces share, stated on its own so a fourth tag has one place to go.
	it("reads carriable off the printed tag, not off a list of slugs", () => {
		expect(isCarriedArcanumItem({ name: "A rusty knife" })).toBe(true);
		expect(isCarriedArcanumItem({ name: "A cave", note: "<em>immobile</em>" })).toBe(false);
		expect(isCarriedArcanumItem({ name: "Storm markings", note: "<em>implanted</em>" })).toBe(false);
		// Nothing to carry either way.
		expect(isCarriedArcanumItem({ name: "" })).toBe(false);
		expect(isCarriedArcanumItem(null)).toBe(false);
	});
});

describe("arcanumKinds over the shipped arcana", () => {
	const docs = loadArcanaPackDocs();

	it("finds all 82 shipped arcana", () => {
		expect(docs).toHaveLength(82);
	});

	it("splits the shipped cards 18 major / 64 minor, partitioning the list", () => {
		const tiers = docs.map(doc => arcanumTier(arcOf(doc)));
		expect(tiers.filter(t => t === "major")).toHaveLength(Object.keys(MAJOR_ARCANA_ICONS).length);
		expect(tiers.filter(t => t === "minor")).toHaveLength(64);
		// Unlike the kind chips, the tier chips are a true partition: every card is in
		// exactly one, so the two counts must add back up to the whole list.
		expect(tiers).toHaveLength(docs.length);
	});

	it("classifies every card, and leaves none of the three chips empty", () => {
		const counts = { relic: 0, power: 0, conduit: 0 };
		for (const doc of docs) for (const key of arcanumKinds(arcOf(doc))) counts[key] += 1;
		// Guards the browser against a facet that silently matches nothing — which would
		// look like a broken chip rather than an empty category.
		for (const key of KIND_KEYS) expect(counts[key], key).toBeGreaterThan(0);
		expect(counts.conduit).toBe(Object.keys(ARCANA_SUMMONS).length);
	});

	it("counts a major's prose Moves section as a Power, not just the structured field", () => {
		// These four grant every one of their moves as prose under a <h3>Moves</h3>; their
		// `back.move` field is null. Reading only that field called them powerless.
		for (const slug of ["hungering-maw-of-hlad", "ineffable-words", "redwood-effigy", "storm-markings"]) {
			const doc = docs.find(d => d.flags.stonetop.slug === slug);
			expect(doc.flags.stonetop.back.move, slug).toBeNull();
			expect(arcanumKinds(arcOf(doc)), slug).toContain("power");
		}
	});

	it("calls the two implanted majors a Power only — they are never in your load", () => {
		// The Relic chip promises "the arcanum itself is an item in your load". Storm Markings
		// course up and down your skin and the Ineffable Words are emblazoned on your soul, and
		// Book II tags both `implanted` for exactly that reason. They carry a `front.item` so
		// the card can print its tag line (pp.556, 566) — which is a NEW thing here; all four of
		// these majors used to have a null item and so read as Powers by accident. The two that
		// really are carried now say so, and the two that aren't are held out by their own tag.
		for (const slug of ["ineffable-words", "storm-markings"]) {
			const doc = docs.find(d => d.flags.stonetop.slug === slug);
			expect(doc.flags.stonetop.front.item.note, slug).toMatch(/implanted/);
			expect(arcanumKinds(arcOf(doc)), slug).toEqual(["power"]);
		}
		for (const slug of ["hungering-maw-of-hlad", "redwood-effigy"]) {
			const doc = docs.find(d => d.flags.stonetop.slug === slug);
			expect(arcanumKinds(arcOf(doc)), slug).toEqual(["relic", "power"]);
		}
	});

	it("gives every major the tag line the book prints under its title", () => {
		// Every major in Appendix D prints a tag line under its title. Five shipped with
		// `front.item: null`, and the sheet draws a card's tags from `front.item.note`, so those
		// five rendered with no tags at all: Ring of Daagon, Storm Markings, Ineffable Words,
		// Redwood Effigy, Hungering Maw of Hlad.
		const bare = docs
			.filter(d => isMajorArcanumItem(arcOf(d)) && !d.flags.stonetop.front.item?.note)
			.map(d => d.flags.stonetop.slug);
		expect(bare).toEqual([]);
	});

	it("leaves only the pure-lore cards with no kind at all", () => {
		const kindless = docs.filter(doc => arcanumKinds(arcOf(doc)).length === 0)
			.map(doc => doc.flags.stonetop.slug).sort();
		// A Folktale is a story, not a thing: no item, no move, no track, nothing to summon.
		// Pinned so a card that BECOMES kindless through an edit shows up as a failure here.
		expect(kindless).toEqual(["a-folktale"]);
	});
});
