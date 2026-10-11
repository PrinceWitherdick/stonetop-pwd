import { describe, it, expect, vi } from "vitest";
import {
	carriedGearTags, chipsFrom, reminderChips, sameGearTags, normalizeReminders, WEARER_TAGS,
} from "../../../module/actors/character/gear-reminders.js";
import { StonetopCharacter } from "../../../module/actors/character/StonetopCharacter.js";

// What a character's carried gear says about THEM (a cumbersome hauberk, a warm cloak), gathered for
// the GM, and the reminders typed beside it.

const hauberk = { slug: "hauberk-iron", name: "Hauberk", note: "<em>warm</em>, <em>cumbersome</em>", armor: { base: 2 }, shield: false };
const cloak   = { slug: "cloak", name: "Cloak", note: "<em>warm</em>", armor: null, shield: false };
const maul    = { slug: "maul", name: "Maul", note: "<em>close</em>, <em>forceful</em>, <em>awkward</em>", armor: null, shield: false };
const wheel   = { slug: "wheel", name: "Spinning wheel", note: "cumbersome, fragile", armor: null, shield: false };
const robes   = { slug: "robes", name: "Giant-sized robes", note: "warm, clumsy", armor: null, shield: false };

const carried = (...items) => ({ items, marks: Object.fromEntries(items.map(i => [i.slug, true])) });

describe("carriedGearTags", () => {
	it("reads the catalog's <em> tag line and a treasure's bare one alike", () => {
		expect(carriedGearTags(carried(hauberk, robes))).toEqual([
			{ tag: "cumbersome", items: ["Hauberk"] },
			{ tag: "warm", items: ["Hauberk", "Giant-sized robes"] },
			{ tag: "clumsy", items: ["Giant-sized robes"] },
		]);
	});

	it("leaves out gear that is not carried", () => {
		const gear = { items: [hauberk, cloak], marks: { cloak: true } };
		expect(carriedGearTags(gear)).toEqual([{ tag: "warm", items: ["Cloak"] }]);
	});

	it("leaves out tags about the thing rather than its carrier", () => {
		expect(carriedGearTags(carried(maul))).toEqual([{ tag: "awkward", items: ["Maul"] }]);
	});

	it("lists tags in the shown order and each item once", () => {
		const tags = carriedGearTags(carried(cloak, maul, hauberk, { ...cloak }));
		expect(tags.map(t => t.tag)).toEqual(["cumbersome", "warm", "awkward"]);
		expect(tags.find(t => t.tag === "warm").items).toEqual(["Cloak", "Hauberk"]);
		expect(tags.every(t => WEARER_TAGS.includes(t.tag))).toBe(true);
	});

	it("reads only whole tags, not a word inside another or in prose", () => {
		expect(carriedGearTags(carried({ slug: "x", name: "Thing", note: "lukewarm, unbeautiful" }))).toEqual([]);
		const snowembers = { slug: "snowembers", name: "Snowembers", note: "Edible petals, warm even in deep winter, that turn to mush soon after picking." };
		expect(carriedGearTags(carried(snowembers))).toEqual([]);
		expect(carriedGearTags(carried({ slug: "y", name: "Robe", note: "Warm. " }))).toEqual([{ tag: "warm", items: ["Robe"] }]);
	});

	it("drops cumbersome from worn armor for an Armored owner, but not from other gear", () => {
		const tags = carriedGearTags(carried(hauberk, wheel), { ignoresCumbersomeArmor: true });
		expect(tags).toEqual([
			{ tag: "cumbersome", items: ["Spinning wheel"] },
			{ tag: "warm", items: ["Hauberk"] },
		]);
	});

	it("reads a gear choice's armor off its printed label when it carries no armor field", () => {
		const scale = { slug: "poss:scale", name: "Scale coat (2 armor, warm, cumbersome)", note: "Scale coat (2 armor, warm, cumbersome)", armor: null };
		expect(carriedGearTags(carried(scale), { ignoresCumbersomeArmor: true }).map(t => t.tag)).toEqual(["warm"]);
		const buckler = { slug: "poss:buckler", name: "Buckler", note: "+1 armor, cumbersome", armor: null };
		expect(carriedGearTags(carried(buckler), { ignoresCumbersomeArmor: true }).map(t => t.tag)).toEqual(["cumbersome"]);
	});

	it("keeps a hidden artifact's tags from the players", () => {
		const hidden = { ...hauberk, slug: "art", artifactState: "unknown" };
		expect(carriedGearTags(carried(hidden))).toEqual([]);
		expect(carriedGearTags(carried({ ...hidden, artifactState: "known" }))).not.toEqual([]);
	});

	it("is empty for no gear", () => {
		expect(carriedGearTags(null)).toEqual([]);
		expect(carriedGearTags({ items: [], marks: {} })).toEqual([]);
	});
});

describe("reminder chips", () => {
	it("gear chips first, naming the gear and quoting the book's gloss, then typed reminders", () => {
		const chips = chipsFrom([{ tag: "cumbersome", items: ["Hauberk"] }], [" Reeks of smoke ", ""]);
		expect(chips).toHaveLength(2);
		expect(chips[0]).toMatchObject({ kind: "gear", label: "Cumbersome", detail: "Hauberk" });
		expect(chips[0].tooltip).toContain("You're noisy, slow");
		expect(chips[1]).toMatchObject({ kind: "note", label: "Reeks of smoke" });
	});

	it("a tag the glossary does not define gets the gear's names alone", () => {
		expect(chipsFrom([{ tag: "clumsy", items: ["Robes"] }], [])[0].tooltip).toBe("Clumsy (Robes)");
	});

	it("reads a character's stored fields, and nothing off anyone else", () => {
		const system = { attributes: { gearTags: [{ tag: "warm", items: ["Cloak"] }] }, reminders: ["Owes Gwen"] };
		expect(reminderChips({ type: "character", system }).map(c => c.label)).toEqual(["Warm", "Owes Gwen"]);
		expect(reminderChips({ type: "monster", system })).toEqual([]);
		expect(reminderChips(null)).toEqual([]);
	});

	it("normalizes reminders and compares tag lists by content", () => {
		expect(normalizeReminders(["  a ", "", null, "b"])).toEqual(["a", "b"]);
		expect(sameGearTags([{ tag: "warm", items: ["Cloak"] }], [{ tag: "warm", items: ["Cloak"], _id: "x" }])).toBe(true);
		expect(sameGearTags([{ tag: "warm", items: ["Cloak"] }], [])).toBe(false);
	});
});

describe("syncStoredVitals mirrors the gear tags", () => {
	function character(storedTags) {
		const update = vi.fn(async () => true);
		const actor = {
			system: { attributes: { armor: { value: 2, unpierceable: 0, conditional: 0, conditionalSource: "" }, hp: { max: 0 }, gearTags: storedTags } },
			update,
		};
		return { self: { _actor: actor, syncStoredVitals: StonetopCharacter.prototype.syncStoredVitals }, update };
	}
	const vitals = { armor: 2, unpierceable: 0, conditional: 0, conditionalSource: "", maxHp: 0 };

	it("writes the tags when they changed", async () => {
		const { self, update } = character([]);
		await self.syncStoredVitals({ ...vitals, gearTags: [{ tag: "warm", items: ["Cloak"] }] });
		expect(update).toHaveBeenCalledWith({ "system.attributes.gearTags": [{ tag: "warm", items: ["Cloak"] }] }, { stonetopLedger: true });
	});

	it("writes nothing when they did not", async () => {
		const { self, update } = character([{ tag: "warm", items: ["Cloak"] }]);
		await self.syncStoredVitals({ ...vitals, gearTags: [{ tag: "warm", items: ["Cloak"] }] });
		expect(update).not.toHaveBeenCalled();
	});

	it("leaves them alone when the caller did not work them out", async () => {
		const { self, update } = character([{ tag: "warm", items: ["Cloak"] }]);
		await self.syncStoredVitals(vitals);
		expect(update).not.toHaveBeenCalled();
	});

	it("clears them when nothing carried has one any more", async () => {
		const { self, update } = character([{ tag: "warm", items: ["Cloak"] }]);
		await self.syncStoredVitals({ ...vitals, gearTags: [] });
		expect(update).toHaveBeenCalledWith({ "system.attributes.gearTags": [] }, { stonetopLedger: true });
	});
});
