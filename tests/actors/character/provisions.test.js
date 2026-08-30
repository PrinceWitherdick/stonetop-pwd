import { describe, expect, it } from "vitest";
import { readProvisionsYield, grantProvisions, PROVISIONS_SLUG } from "../../../module/actors/character/provisions.js";
import { CharacterInventory } from "../../../module/actors/character/CharacterInventory.js";
import { StonetopFlags } from "../../../module/actors/character/StonetopFlags.js";
import { OutfitItemBuilder } from "../../../module/model/OutfitItem.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { FakeInventoryRepository } from "../../fakes/FakeInventoryRepository.js";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";

// Forage's four options, exactly as the compendium move prints them. Two pay in provisions and
// two do not, which is the whole job of readProvisionsYield.
const FORAGE_OPTIONS = [
	"You acquire ◇ provisions (1d6 uses)",
	"You acquire an extra 1d6 uses of provisions",
	"You discover something interesting or useful",
	"You avoid danger or risk (else, there is some)",
];

function inventoryOf(actor) {
	return new CharacterInventory(new StonetopFlags(actor, "inventory"));
}

function makeActor(flags = {}) {
	return new FakeActorBuilder().withPlaybook("the-heavy", "The Heavy").withFlags(flags).build();
}

// ── reading the option ───────────────────────────────────────────────────────

describe("readProvisionsYield", () => {
	it("reads Forage's two paying options and leaves the other two alone", () => {
		expect(FORAGE_OPTIONS.map(readProvisionsYield).map(p => p?.formula ?? null))
			.toEqual(["1d6", "1d6", null, null]);
	});

	// The ◇ is the only thing separating "acquire provisions" from "acquire an EXTRA 1d6 uses":
	// the first is a new point of load, the second tops up a pack already on your back.
	it("claims a point of load only for the option that prints the ◇", () => {
		expect(readProvisionsYield(FORAGE_OPTIONS[0]).claimsLoad).toBe(true);
		expect(readProvisionsYield(FORAGE_OPTIONS[1]).claimsLoad).toBe(false);
	});

	it("needs BOTH a mention of provisions and a count", () => {
		expect(readProvisionsYield("You acquire ◇ provisions")).toBeNull();
		expect(readProvisionsYield("Roll 1d6 and consult the table")).toBeNull();
		expect(readProvisionsYield("")).toBeNull();
		expect(readProvisionsYield(null)).toBeNull();
	});

	// The parentheticals the catalog gear actually carries — the same reader serves them, which is
	// what lets a goat grow a Harvest button without anyone wiring goats up by hand.
	it("reads the printed formulas, normalising them for Foundry's Roll", () => {
		expect(readProvisionsYield("butcher for ◇ provisions (d6+10 uses)").formula).toBe("1d6+10");
		expect(readProvisionsYield("Harvest 1d4+4 &#9671; Provisions; those who partake…").formula).toBe("1d4+4");
		expect(readProvisionsYield("harvest as ◇ Provisions (3 uses, <em>fragile</em>)").formula).toBe("3");
	});

	// A fixed number is a formula Foundry's Roll accepts too, so it flows down the same path — but
	// there is no die to throw, and the button says so ("Take 6 uses", not "Roll 6 uses").
	it("says whether there is really a die to throw", () => {
		expect(readProvisionsYield("butcher for ◇ Provisions (6 uses)")).toMatchObject({ formula: "6", isRoll: false });
		expect(readProvisionsYield("You acquire ◇ provisions (1d6 uses)")).toMatchObject({ formula: "1d6", isRoll: true });
	});

	// A beast's stat line leads with numbers that are not on offer. The count only counts when
	// "use(s)" or "provisions" is the very next word, which is what skips the HP and the damage die.
	it("takes the count being offered, not the beast's HP or damage die", () => {
		expect(readProvisionsYield("HP 3, d4 damage; butcher for ◇ Provisions (6 uses)").formula).toBe("6");
		expect(readProvisionsYield("HP 6, d4 damage; butcher for ◇ Provisions (d6+10 uses)").formula).toBe("1d6+10");
		// A horse is not food — nothing in its line mentions provisions at all.
		expect(readProvisionsYield("HP 10, d6+3 damage (<em>hand</em>, <em>close</em>, <em>forceful</em>)")).toBeNull();
	});
});

// ── the larder ───────────────────────────────────────────────────────────────

describe("grantProvisions", () => {
	it("puts the row on the sheet, marks the ◇, and records the uses", async () => {
		const actor = makeActor();
		const result = await grantProvisions(actor, 4, { carry: true });

		const inv = inventoryOf(actor);
		expect(inv.addedSpecial).toContain(PROVISIONS_SLUG);
		expect(inv.checked[PROVISIONS_SLUG]).toBe(true);
		expect(inv.resources[PROVISIONS_SLUG]).toBe(4);
		expect(inv.resourceMax[PROVISIONS_SLUG]).toBe(4);
		expect(result).toEqual({ gained: 4, held: 4, max: 4 });
	});

	// Forage's second option is "an EXTRA 1d6 uses" — the same pack, more food in it, and no
	// second ◇ of load.
	it("tops up an existing larder without claiming a second ◇", async () => {
		const actor = makeActor();
		await grantProvisions(actor, 4, { carry: true });
		await grantProvisions(actor, 3);

		const inv = inventoryOf(actor);
		expect(inv.resources[PROVISIONS_SLUG]).toBe(7);
		expect(inv.resourceMax[PROVISIONS_SLUG]).toBe(7);
		expect(inv.addedSpecial.filter(s => s === PROVISIONS_SLUG)).toHaveLength(1);
	});

	// The empty circles left by what has been eaten are the record of eating it, so capacity
	// holds where it is rather than shrinking to what is left.
	it("keeps capacity at its high-water mark when some has been eaten", async () => {
		const actor = makeActor();
		await grantProvisions(actor, 5, { carry: true });
		await inventoryOf(actor).setResource(PROVISIONS_SLUG, 1);   // ate four
		await grantProvisions(actor, 2);

		const inv = inventoryOf(actor);
		expect(inv.resources[PROVISIONS_SLUG]).toBe(3);
		expect(inv.resourceMax[PROVISIONS_SLUG]).toBe(5);
	});

	it("does nothing for a haul of nothing", async () => {
		const actor = makeActor();
		expect(await grantProvisions(actor, 0)).toBeNull();
		expect(await grantProvisions(actor, NaN)).toBeNull();
		expect(inventoryOf(actor).addedSpecial).not.toContain(PROVISIONS_SLUG);
	});
});

// ── tossing what's left to the crows ─────────────────────────────────────────

describe("removing the provisions row", () => {
	// Book I p.89: "You've still got 1 use of provisions left, but it's not like raw liver or
	// heart keeps well. You toss what's left to the crows." The ✕ on the row is that, so it has
	// to take the uses with it — a later Forage starts a fresh larder, not that leftover 1.
	it("takes the uses, the capacity and the ◇ mark with it", async () => {
		const actor = makeActor();
		await grantProvisions(actor, 6, { carry: true });
		await inventoryOf(actor).removeSpecial(PROVISIONS_SLUG);

		const inv = inventoryOf(actor);
		expect(inv.addedSpecial).not.toContain(PROVISIONS_SLUG);
		expect(inv.checked[PROVISIONS_SLUG]).toBeUndefined();
		expect(inv.resources[PROVISIONS_SLUG]).toBeUndefined();
		expect(inv.resourceMax[PROVISIONS_SLUG]).toBeUndefined();
	});

	it("leaves a re-foraged larder holding only the new haul", async () => {
		const actor = makeActor();
		await grantProvisions(actor, 6, { carry: true });
		await inventoryOf(actor).removeSpecial(PROVISIONS_SLUG);
		await grantProvisions(actor, 2, { carry: true });

		expect(inventoryOf(actor).resources[PROVISIONS_SLUG]).toBe(2);
	});
});

// ── what the sheet draws ─────────────────────────────────────────────────────

describe("buildSnapshot — the provisions track", () => {
	const PROVISIONS = new OutfitItemBuilder()
		.withSlug(PROVISIONS_SLUG).withName("Provisions").withWeight(1)
		.withInventoryColumn("regular").withSpecial(true)
		.withResource({ max: 12, title: null, labels: [] })
		.build();

	function snapshotFor(flags) {
		return new TestCharacterBuilder(makeActor(flags))
			.withInventoryRepo(new FakeInventoryRepository([PROVISIONS]))
			.build().buildSnapshot();
	}

	const rowIn = snap => snap.inventory.outfit.regularItems.find(i => i.slug === PROVISIONS_SLUG);

	// The printed Inventory insert has no Provisions row (Book I p.89 names only Supplies, More
	// supplies and Even more supplies), so neither does the sheet until a Forage pays out.
	it("is absent until something has been foraged", async () => {
		expect(rowIn(await snapshotFor({}))).toBeUndefined();
	});

	// The acquired capacity is the whole reason resourceMax exists: 12 is Forage's own ceiling
	// (2d6, p.89), not the item's, and a 4-use haul should draw four circles rather than four
	// filled ones adrift in twelve.
	it("draws as many circles as the larder actually holds", async () => {
		const snap = await snapshotFor({
			"inventory.addedSpecial": [PROVISIONS_SLUG],
			"inventory.resources":    { [PROVISIONS_SLUG]: 4 },
			"inventory.resourceMax":  { [PROVISIONS_SLUG]: 4 },
		});
		expect(rowIn(snap).resource).toMatchObject({ max: 4, current: 4 });
		expect(rowIn(snap).isAddedSpecial).toBe(true);   // keeps its removable ✕
	});

	// A pig is 1d6+10 and the Ranger's trapping gear makes a single Forage 2d6+1, so the printed
	// 12 has to be a fallback the stored capacity can exceed, not a clamp.
	it("lets an acquired capacity exceed the number printed on the item", async () => {
		const snap = await snapshotFor({
			"inventory.addedSpecial": [PROVISIONS_SLUG],
			"inventory.resources":    { [PROVISIONS_SLUG]: 16 },
			"inventory.resourceMax":  { [PROVISIONS_SLUG]: 16 },
		});
		expect(rowIn(snap).resource).toMatchObject({ max: 16, current: 16 });
	});

	it("falls back to the item's printed max when nothing has been stored", async () => {
		const snap = await snapshotFor({ "inventory.addedSpecial": [PROVISIONS_SLUG] });
		expect(rowIn(snap).resource.max).toBe(12);
	});
});
