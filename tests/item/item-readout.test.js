import { describe, it, expect } from "vitest";
import { buildItemReadout, isGearItem } from "../../module/item/item-readout.js";
import { treasureItemData } from "../../module/utils/treasure-drops.js";
import { buildInventoryItemData } from "../../module/utils/inventory-item-data.js";
import { ARTIFACT_STATE } from "../../module/actors/character/artifact-identify.js";

// What an item's OWN sheet prints. The gap this closes: gear metadata lives under
// `flags.stonetop` on shipped catalog items and under `system.*` on anything authored in
// play, and the item sheet was reading only the flags half — so a hand-written item, a
// dropped treasure and a treasure's book write-up all showed nothing on their own card.
// The DOM is the sheet's; this is the rule.

/** A shipped catalog item, as packs/src/stonetop-items/inventory-items/*.json stores one. */
function catalogItem(flags = {}) {
	return {
		name: "Bow & iron arrows",
		type: "move",
		system: { moveType: "inventory" },
		flags: {
			stonetop: {
				slug: "bow-arrows",
				inventoryColumn: "regular",
				note: "<em>near</em>, x <em>piercing</em>",
				weight: 1,
				resource: { max: 2, title: null, labels: ["low ammo", "all out"] },
				...flags,
			},
		},
	};
}

describe("isGearItem", () => {
	it("counts both the catalog and the write-in inventory kinds", () => {
		expect(isGearItem({ type: "move", system: { moveType: "inventory" } })).toBe(true);
		expect(isGearItem({ type: "move", system: { moveType: "inventory-custom" } })).toBe(true);
	});

	it("does not count moves, arcana or other sub-types", () => {
		expect(isGearItem({ type: "move", system: { moveType: "basic" } })).toBe(false);
		expect(isGearItem({ type: "move", system: { moveType: "arcanum" } })).toBe(false);
		expect(isGearItem({ type: "playbook", system: {} })).toBe(false);
		expect(isGearItem(null)).toBe(false);
	});
});

describe("buildItemReadout — where the fields come from", () => {
	it("reads a shipped catalog item's load, tags and uses out of flags.stonetop", () => {
		const out = buildItemReadout(catalogItem());
		expect(out.isGear).toBe(true);
		expect(out.weight).toBe(1);
		expect(out.note).toBe("<em>near</em>, x <em>piercing</em>");
		expect(out.uses.max).toBe(2);
		expect(out.uses.marks.map(m => m.label)).toEqual(["low ammo", "all out"]);
	});

	it("reads a hand-written item's out of system.* — the half the sheet was missing", () => {
		const data = buildInventoryItemData({
			name: "Grappling hook", column: "regular", weight: 2,
			note: "<em>awkward</em>", resource: { max: 3, title: "Rope", labels: [] },
			moveType: "inventory-custom",
		});
		const out = buildItemReadout(data);
		expect(out.weight).toBe(2);
		expect(out.note).toBe("<em>awkward</em>");
		expect(out.uses).toMatchObject({ max: 3, title: "Rope" });
		expect(out.uses.marks).toHaveLength(3);
	});

	it("gives a small item no load, whichever side records the column", () => {
		expect(buildItemReadout(catalogItem({ inventoryColumn: "small", weight: 1 })).small).toBe(true);
		expect(buildItemReadout(catalogItem({ inventoryColumn: "small", weight: 1 })).weight).toBe(0);
		const written = buildInventoryItemData({ name: "Chalk", column: "small", moveType: "inventory-custom" });
		expect(buildItemReadout(written).small).toBe(true);
		expect(buildItemReadout(written).weight).toBe(0);
	});

	it("gives a move no gear furniture at all — its readout is its description", () => {
		const move = { name: "Defy Danger", type: "move", system: { moveType: "basic", description: "<p>When you…</p>", weight: 1 } };
		const out = buildItemReadout(move);
		expect(out.isGear).toBe(false);
		expect(out.weight).toBe(0);
		expect(out.uses).toBeNull();
		expect(out.armor).toBeNull();
		expect(out.description).toBe("<p>When you…</p>");
	});
});

describe("buildItemReadout — a Book II treasure", () => {
	const WHISKY = {
		name: "Firkin of fine whisky", section: "Marshedge", slug: "marshedge-whisky",
		column: "regular", weight: 1, note: "<em>valuable</em>", value: "3",
		uses: 4, usesLabel: "draughts",
		writeup: "<p>The good stuff, out of Marshedge.</p>",
	};

	it("prints the book's write-up that the character sheet already showed", () => {
		const out = buildItemReadout(treasureItemData(WHISKY));
		expect(out.isTreasure).toBe(true);
		expect(out.artifact.lore).toBe("<p>The good stuff, out of Marshedge.</p>");
		expect(out.note).toContain("Value 3");
		expect(out.uses.max).toBe(4);
		expect(out.uses.title).toBe("draughts");
	});
});

describe("buildItemReadout — a hidden artifact conceals the same as the gear row", () => {
	function hidden(state) {
		return {
			name: "Brass sphere", type: "move",
			system: {
				moveType: "inventory-custom", inventoryColumn: "regular", weight: 1,
				note: "<em>magical</em>, Value 2",
				resource: { max: 3, title: "hours", labels: [] },
				identifyState: state,
				artifactHint: "It hums when you hold it.",
				artifactLore: "<p>It opens the way below.</p>",
				artifactLead: "The Forgemistress would know.",
			},
		};
	}

	it("withholds tags, uses and the write-up while it is unknown", () => {
		const out = buildItemReadout(hidden(ARTIFACT_STATE.UNKNOWN));
		expect(out.note).toBe("");
		expect(out.uses).toBeNull();
		expect(out.artifact.lore).toBe("");
		expect(out.artifact.hint).toBe("It hums when you hold it.");
		expect(out.artifact.lead).toBe("The Forgemistress would know.");
		expect(out.artifact.concealed).toBe(true);
		// The ◇ load is never concealed — p.428 has them accounting for it on pickup.
		expect(out.weight).toBe(1);
	});

	it("hands over the tags and uses on a 7-9, the write-up still owed", () => {
		const out = buildItemReadout(hidden(ARTIFACT_STATE.PARTIAL));
		expect(out.note).toBe("<em>magical</em>, Value 2");
		expect(out.uses.max).toBe(3);
		expect(out.artifact.lore).toBe("");
		expect(out.artifact.loreOwed).toBe(true);
	});

	it("hands over everything at known, and drops the hint and the lead", () => {
		const out = buildItemReadout(hidden(ARTIFACT_STATE.KNOWN));
		expect(out.artifact.lore).toBe("<p>It opens the way below.</p>");
		expect(out.artifact.hint).toBe("");
		expect(out.artifact.lead).toBe("");
		expect(out.artifact.concealed).toBe(false);
	});

	it("shows the GM the whole thing, flagged as privileged", () => {
		const out = buildItemReadout(hidden(ARTIFACT_STATE.UNKNOWN), { viewerIsGM: true });
		expect(out.note).toBe("<em>magical</em>, Value 2");
		expect(out.artifact.lore).toBe("<p>It opens the way below.</p>");
		expect(out.artifact.gmPeeking).toBe(true);
	});

	it("conceals by default when the caller forgets to say who is looking", () => {
		expect(buildItemReadout(hidden(ARTIFACT_STATE.UNKNOWN)).artifact.lore).toBe("");
	});
});

describe("buildItemReadout — the armor chip", () => {
	it("prints an authored item's armor value, which nothing else on the card says", () => {
		const data = buildInventoryItemData({
			name: "Boiled leather", column: "regular", weight: 1, armor: { base: 1 },
			moveType: "inventory-custom",
		});
		expect(buildItemReadout(data).armor).toBe("1 armor");
	});

	it("prints a shield's modifier signed", () => {
		const data = buildInventoryItemData({
			name: "Buckler", column: "regular", weight: 1, armor: { modifier: 1 },
			moveType: "inventory-custom",
		});
		expect(buildItemReadout(data).armor).toBe("+1 armor");
	});

	it("stays quiet when the item's own tags already say it", () => {
		// The shipped Shield: "+1 armor, +1 Readiness on 7+ to Defend", plus the same value
		// structurally. Printing both would have one card say "+1 armor" twice.
		const shield = catalogItem({
			note: "+1 armor, +1 Readiness on 7+ to Defend", weight: 2, resource: undefined,
		});
		shield.name = "Shield";
		shield.system.armor = { modifier: 1 };
		expect(buildItemReadout(shield).armor).toBeNull();
	});

	// The shipped armours store their value under `flags.stonetop.armor`, not `system.armor` —
	// see packs/src/stonetop-items/inventory-items/hauberk-iron.json. Read out of `system` alone,
	// an Iron Hauberk showed no armour value anywhere on its own card: its tags say "messy" and
	// "cumbersome" and nothing said 2. Resolved through readInventoryItemData, flags first, the
	// same way the drop path has always resolved it.
	it("reads a shipped armour's value out of flags.stonetop", () => {
		const hauberk = catalogItem({
			note: "<em>messy</em>, <em>cumbersome</em>", weight: 2, resource: undefined,
			armor: { modifier: 2 },
		});
		hauberk.name = "Hauberk, iron";
		expect(buildItemReadout(hauberk).armor).toBe("+2 armor");

		const hides = catalogItem({ note: "1 armor, <em>warm</em>", armor: { base: 1 } });
		// Still quiet where the tags already say it, whichever store the number came out of.
		expect(buildItemReadout(hides).armor).toBeNull();
	});

	it("is absent on ordinary gear", () => {
		expect(buildItemReadout(catalogItem()).armor).toBeNull();
	});

	// The suppression reads the item's OWN note. Handed the CONCEALED one it ran backwards: a
	// withheld note is null, which matches no /armor/, so the unidentified artifact printed the
	// value the identified one hides. And the value is withheld with the tags either way — it IS
	// what a tag would say, so printing it hands over the one thing the ladder is holding back.
	it("withholds an artifact's value while its tags are withheld, and prints it after", () => {
		const sphere = (state) => ({
			name: "Brass buckler", type: "move",
			system: {
				moveType: "inventory-custom", inventoryColumn: "regular", weight: 1,
				note: "<em>magical</em>, Value 2", armor: { modifier: 1 }, identifyState: state,
			},
		});
		expect(buildItemReadout(sphere(ARTIFACT_STATE.UNKNOWN)).armor).toBeNull();
		expect(buildItemReadout(sphere(ARTIFACT_STATE.PARTIAL)).armor).toBe("+1 armor");
		expect(buildItemReadout(sphere(ARTIFACT_STATE.KNOWN)).armor).toBe("+1 armor");
		// The GM wrote it; they see it whole, like every other concealed field.
		expect(buildItemReadout(sphere(ARTIFACT_STATE.UNKNOWN), { viewerIsGM: true }).armor).toBe("+1 armor");
	});

	// Quiet where the tags say it, whatever the ladder is doing: the note the test reads is the
	// item's own, not the one this viewer has been handed.
	it("stays quiet on an identified artifact whose own tags already say it", () => {
		const hauberk = {
			name: "Rune-laden scales", type: "move",
			system: {
				moveType: "inventory-custom", inventoryColumn: "regular", weight: 2,
				note: "+2 armor, <em>magical</em>", armor: { modifier: 2 },
				identifyState: ARTIFACT_STATE.KNOWN,
			},
		};
		expect(buildItemReadout(hauberk).armor).toBeNull();
	});
});

describe("buildItemReadout — drawn tracks stay drawable", () => {
	it("caps the circles it draws but keeps the real max", () => {
		const item = {
			name: "Sacred pouch", type: "move",
			system: { moveType: "inventory-custom", resource: { max: 40, labels: [] } },
		};
		const out = buildItemReadout(item);
		expect(out.uses.max).toBe(40);
		expect(out.uses.marks).toHaveLength(12);
	});

	it("drops an empty track rather than drawing nothing in a chip", () => {
		const item = { name: "Rope", type: "move", system: { moveType: "inventory", resource: { max: 0 } } };
		expect(buildItemReadout(item).uses).toBeNull();
	});

	// Fifteen shipped playbook moves store a track of their own — Piety's Blessing, the Logbook's
	// two uses — and the move's text is what defines it ("hold 1 Blessing", "2 uses, slow"). The
	// ○ chip is gear furniture, gated like the load and the "small" chip: its tooltip says the
	// circles are ticked by whoever is CARRYING the thing, which is nobody for a move.
	it("keeps the gear chip off a move that carries a track of its own", () => {
		const piety = {
			name: "Piety", type: "move",
			system: { moveType: "playbook", resource: { max: 1, title: "Blessing" } },
		};
		expect(buildItemReadout(piety).uses).toBeNull();
		expect(buildItemReadout(piety).isGear).toBe(false);
	});
});
