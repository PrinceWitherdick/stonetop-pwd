import { describe, it, expect, vi } from "vitest";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { FakeInventoryRepository } from "../../fakes/FakeInventoryRepository.js";
import { FakeArcanaRepository } from "../../fakes/FakeArcanaRepository.js";
import { OutfitItemBuilder } from "../../../module/model/OutfitItem.js";
import { backBoxChecked, unlockedArcanumArmor } from "../../../module/actors/character/CharacterArcana.js";

// Defend's "+1 Readiness on a 7+" rides a SHIELD (Book I p.216), and the answer to "is this
// character bearing one" used to be `inventory.checked["shield"]` — one hard-coded catalog slug.
// Every other shield in the game printed its Readiness clause on the sheet and granted nothing:
// the Judge's Makerglass shield and the Would-Be Hero's (gear choices, in a different flag
// store), the Shield of the Wisent Witch (an arcanum), and the makerglass shield treasure (an
// embedded custom item). Same root cause as the armor bug, in the parallel mechanic.

function outfitItem(slug, { armor = null, shield = false } = {}) {
	return new OutfitItemBuilder()
		.withSlug(slug).withName(slug).withWeight(1).withNote(null)
		.withInventoryColumn("regular").withResource(null)
		.withTwoCol(false).withSmallGrid(false).withBreakBefore(false)
		.withArmor(armor).withShield(shield)
		.build();
}

const JUDGE_LIKE = {
	slug: "test-judge",
	name: "Test Judge",
	specialPossessions: {
		pickCount: 0,
		preselected: ["symbol-of-authority"],
		options: [{
			slug: "symbol-of-authority",
			label: "Symbol of authority",
			choices: {
				pickCount: 2, gear: true,
				options: [
					{ slug: "makerglass-shield", label: "◇◇ Makerglass shield", armor: { modifier: 1 }, shield: true },
					{ slug: "maul",              label: "◇◇ Black iron maul" },
				],
			},
		}],
	},
};

const WISENT_SHIELD = {
	slug: "shield-of-the-wisent-witch",
	front: {
		title: "Shield of the Wisent Witch",
		item: {
			name: "Shield of the Wisent Witch", weight: 1,
			note: "<em>+1 armor, +1 Readiness on a 7+ to Defend</em>",
			inventoryColumn: "regular", armor: { modifier: 1 }, shield: true,
		},
		description: "<p>A shield of horn-oak.</p>",
		unlock: { description: "Unlock by…", requirements: [] },
	},
	back: { title: "Mysteries", item: null, description: "<p>More.</p>", resource: null, move: null, options: [] },
};

function makeChar({ playbook = null, checked = {}, carried = {}, picked = [], items = [], arcana = [], owned = [], actorItems = [] } = {}) {
	let b = new FakeActorBuilder()
		.withFlag("inventory.checked", checked)
		.withFlag("possessions.choiceCarried", carried)
		.withFlag("possessions.subChoices", { "symbol-of-authority": picked })
		.withFlag("arcana.owned", owned)
		.withFlag("arcana.identified", owned);
	if (playbook) b = b.withPlaybook(playbook.slug, playbook.name);
	for (const i of actorItems) b = b.addItem(i);
	const actor = b.build();
	let tb = new TestCharacterBuilder(actor)
		.withInventoryRepo(new FakeInventoryRepository(items))
		.withArcanaRepo(new FakeArcanaRepository(arcana));
	if (playbook) tb = tb.addPlaybook(playbook);
	return tb.build();
}

// -- bearsShield across all four gear stores ----------------------------------

describe("bearsShield", () => {
	it("sees the ordinary catalog shield", async () => {
		const char = makeChar({ items: [outfitItem("shield", { armor: { modifier: 1 }, shield: true })], checked: { shield: true } });
		expect(await char.bearsShield()).toBe(true);
	});

	it("sees a gear-choice shield (the Judge's Makerglass shield)", async () => {
		const char = makeChar({
			playbook: JUDGE_LIKE, picked: ["makerglass-shield"],
			carried: { "symbol-of-authority:makerglass-shield": true },
		});
		expect(await char.bearsShield()).toBe(true);
	});

	it("sees an arcanum shield (the Shield of the Wisent Witch)", async () => {
		const char = makeChar({
			arcana: [WISENT_SHIELD], owned: ["shield-of-the-wisent-witch"],
			checked: { "shield-of-the-wisent-witch": true },
		});
		expect(await char.bearsShield()).toBe(true);
	});

	it("sees a dropped treasure / write-in shield (an embedded custom item)", async () => {
		const char = makeChar({
			actorItems: [{ _id: "t1", type: "move", name: "A shield of makerglass", system: { moveType: "inventory-custom", shield: true, armor: { modifier: 1 } } }],
			checked: { t1: true },
		});
		expect(await char.bearsShield()).toBe(true);
	});

	it("is false when the shield is owned but not borne", async () => {
		const char = makeChar({ items: [outfitItem("shield", { shield: true })], checked: {} });
		expect(await char.bearsShield()).toBe(false);
		const judge = makeChar({ playbook: JUDGE_LIKE, picked: ["makerglass-shield"], carried: {} });
		expect(await judge.bearsShield()).toBe(false);
	});

	it("is false for armor that is not a shield", async () => {
		// A hauberk is armor but buys no Readiness — the flag, not the armor shape, decides.
		const char = makeChar({ items: [outfitItem("hauberk", { armor: { base: 2 } })], checked: { hauberk: true } });
		expect(await char.bearsShield()).toBe(false);
	});
});

describe("Defend readiness reflects the wider shield rule", () => {
	it("caps a gear-choice shield bearer at 4 and says so", async () => {
		const char = makeChar({
			playbook: JUDGE_LIKE, picked: ["makerglass-shield"],
			carried: { "symbol-of-authority:makerglass-shield": true },
		});
		const ctx = await char.defendReadinessContext();
		expect(ctx.hasShield).toBe(true);
		expect(ctx.cap).toBe(4);
	});

	it("caps an unshielded character at 3", async () => {
		const char = makeChar({ playbook: JUDGE_LIKE, picked: [], carried: {} });
		const ctx = await char.defendReadinessContext();
		expect(ctx.hasShield).toBe(false);
		expect(ctx.cap).toBe(3);
	});
});

// -- Unlock-driven armor ------------------------------------------------------

describe("armor raised by a ticked back-side mystery", () => {
	const SCALES = {
		slug: "rune-laden-scales",
		armorUnlocks: [{ label: "PROOF AGAINST HARM", armor: { base: 3 } }],
		front: {
			title: "Rune-laden Scales",
			item: { name: "Rune-laden Scales", weight: 1, note: "<em>2 armor, magical</em>", inventoryColumn: "regular", armor: { base: 2 } },
			description: "<p>Ancient scales.</p>",
			unlock: { description: "Unlock by…", requirements: [] },
		},
		back: {
			title: "Mysteries",
			item: null,
			// Two boxes before it, so the label lookup has to count rather than assume index 0.
			description: "<p><strong>□ INDOMITABLE</strong> …</p><p><strong>□ MAGNET</strong> …</p><p><strong>□ PROOF AGAINST HARM</strong> The Rune-laden Scales now provide you 3 armor.</p>",
			resource: null, move: null, options: [],
		},
	};

	const armorOf = async (char) => (await char.buildSnapshot()).vitals.armor;

	it("uses the printed 2 armor while the mystery is unticked", async () => {
		const char = makeChar({ arcana: [SCALES], owned: ["rune-laden-scales"], checked: { "rune-laden-scales": true } });
		expect(await armorOf(char)).toBe(2);
	});

	it("rises to 3 once PROOF AGAINST HARM is ticked", async () => {
		const char = makeChar({ arcana: [SCALES], owned: ["rune-laden-scales"], checked: { "rune-laden-scales": true } });
		// The third □ in the back text — index 2 — is Proof Against Harm's own.
		await char.setArcanumBoxChecked("rune-laden-scales", "back", 2, true);
		expect(await armorOf(char)).toBe(3);
	});

	it("is not fooled by a DIFFERENT mystery's box", async () => {
		const char = makeChar({ arcana: [SCALES], owned: ["rune-laden-scales"], checked: { "rune-laden-scales": true } });
		await char.setArcanumBoxChecked("rune-laden-scales", "back", 0, true); // INDOMITABLE
		expect(await armorOf(char)).toBe(2);
	});

	it("counts nothing at all when the scales are not worn", async () => {
		const char = makeChar({ arcana: [SCALES], owned: ["rune-laden-scales"], checked: {} });
		await char.setArcanumBoxChecked("rune-laden-scales", "back", 2, true);
		expect(await armorOf(char)).toBe(0);
	});

	describe("the label→box helpers", () => {
		const boxes = { "x:back:2": true };
		const text = "<p>□ ONE</p><p>□ TWO</p><p>□ THREE</p>";

		it("finds a box by its printed label", () => {
			expect(backBoxChecked(text, "x", "THREE", boxes)).toBe(true);
			expect(backBoxChecked(text, "x", "TWO", boxes)).toBe(false);
		});

		it("answers false for a label the card does not print", () => {
			expect(backBoxChecked(text, "x", "NOT HERE", boxes)).toBe(false);
		});

		it("takes the BEST armor rather than the last listed", () => {
			const item = {
				slug: "x", back: { description: text },
				armorUnlocks: [{ label: "THREE", armor: { base: 3 } }],
			};
			// The curio's own 2 loses to the ticked 3…
			expect(unlockedArcanumArmor(item, { armor: { base: 2 } }, boxes)).toEqual({ base: 3 });
			// …and a curio already worth more keeps its value.
			expect(unlockedArcanumArmor(item, { armor: { base: 4 } }, boxes)).toEqual({ base: 4 });
		});
	});
});

// -- Hand-set armor override --------------------------------------------------

describe("hand-set armor adjustment", () => {
	it("adds the banked delta to the derived total", async () => {
		const char = makeChar({
			items: [outfitItem("hauberk", { armor: { base: 2 } })],
			checked: { hauberk: true },
		});
		char._actor.system.attributes.armor = { value: 0, adjustment: 1 };
		expect((await char.buildSnapshot()).vitals.armor).toBe(3);
	});

	it("banks the DIFFERENCE, so the delta survives a change of gear", async () => {
		const char = makeChar({
			items: [outfitItem("hauberk", { armor: { base: 2 } })],
			checked: { hauberk: true },
		});
		char._actor.system.attributes.armor = { value: 0, adjustment: 0 };
		const update = vi.fn(async (data) => {
			char._actor.system.attributes.armor.adjustment = data["system.attributes.armor.adjustment"];
		});
		char._actor.update = update;
		await char.setArmor(4);
		// Derived 2, typed 4 → the stored delta is +2, not the absolute 4.
		expect(update).toHaveBeenCalledWith({ "system.attributes.armor.adjustment": 2 });
		expect((await char.buildSnapshot()).vitals.armor).toBe(4);
	});

	it("clears the adjustment when the derived number is typed back in", async () => {
		const char = makeChar({
			items: [outfitItem("hauberk", { armor: { base: 2 } })],
			checked: { hauberk: true },
		});
		char._actor.system.attributes.armor = { value: 0, adjustment: 3 };
		const update = vi.fn(async () => {});
		char._actor.update = update;
		await char.setArmor(2);
		expect(update).toHaveBeenCalledWith({ "system.attributes.armor.adjustment": 0 });
	});

	it("never renders a negative total, however deep the penalty", async () => {
		const char = makeChar({ items: [], checked: {} });
		char._actor.system.attributes.armor = { value: 0, adjustment: -5 };
		expect((await char.buildSnapshot()).vitals.armor).toBe(0);
	});

	// The clamp above is what made this go wrong: the derived armor used to be recovered by
	// subtracting the adjustment from the RENDERED total, which is only the derived number while
	// the clamp is not biting. Under a penalty deep enough to bottom the total out, that read the
	// derived armor as 5 (the penalty's own size) instead of 2, so typing 2 banked -3 and the
	// field came straight back to 0 — the box refusing the number the player just typed into it.
	it("banks the right delta even when a penalty has bottomed the total out", async () => {
		const char = makeChar({
			items: [outfitItem("hauberk", { armor: { base: 2 } })],
			checked: { hauberk: true },
		});
		char._actor.system.attributes.armor = { value: 0, adjustment: -5 };
		char._actor.update = vi.fn(async (data) => {
			char._actor.system.attributes.armor.adjustment = data["system.attributes.armor.adjustment"];
		});
		expect((await char.buildSnapshot()).vitals.armor).toBe(0);

		await char.setArmor(2);
		expect((await char.buildSnapshot()).vitals.armor).toBe(2);
	});

	it("reports the derived armor separately from the clamped total", async () => {
		const char = makeChar({
			items: [outfitItem("hauberk", { armor: { base: 2 } })],
			checked: { hauberk: true },
		});
		char._actor.system.attributes.armor = { value: 0, adjustment: -5 };
		const vitals = (await char.buildSnapshot()).vitals;
		// What the sheet's note promises clears the adjustment ("your gear and moves give 2").
		expect(vitals.armorBase).toBe(2);
		expect(vitals.armor).toBe(0);
	});
});

// -- Armored reaches every shield, not just the catalog one --------------------

describe("Armored and a shield's load", () => {
	// Being a shield means three things: it carries armor, it buys "+1 Readiness on a Defend
	// 7+", and Armored drops its ◇ cost. The first two were lifted to answer across all four
	// gear stores; the load stayed behind in the outfit mapper, so a Judge — whose Makerglass
	// shield is a gear CHOICE — still paid ◇◇ for it while Armored was doing nothing.
	const ARMORED = { type: "move", name: "Armored", system: { moveType: "playbook", shieldLoadReduction: 1 } };

	it("drops the Judge's gear-choice shield from 2 ◇ to 1 ◇", async () => {
		const char = makeChar({
			playbook: JUDGE_LIKE,
			picked: ["makerglass-shield"],
			carried: { "symbol-of-authority:makerglass-shield": true },
			actorItems: [ARMORED],
		});
		const rows = [...char._buildChoiceGearByPossession(JUDGE_LIKE).values()]
			.flatMap(b => [...b.regular, ...b.small]);
		const shield = rows.find(r => r.choiceSlug === "makerglass-shield");
		expect(shield.weight).toBe(1);
	});

	it("leaves a gear-choice weapon that is not a shield alone", async () => {
		const char = makeChar({
			playbook: JUDGE_LIKE,
			picked: ["maul"],
			carried: { "symbol-of-authority:maul": true },
			actorItems: [ARMORED],
		});
		const rows = [...char._buildChoiceGearByPossession(JUDGE_LIKE).values()]
			.flatMap(b => [...b.regular, ...b.small]);
		expect(rows.find(r => r.choiceSlug === "maul").weight).toBe(2);
	});

	it("leaves the shield at its printed cost without the move", async () => {
		const char = makeChar({
			playbook: JUDGE_LIKE,
			picked: ["makerglass-shield"],
			carried: { "symbol-of-authority:makerglass-shield": true },
		});
		const rows = [...char._buildChoiceGearByPossession(JUDGE_LIKE).values()]
			.flatMap(b => [...b.regular, ...b.small]);
		expect(rows.find(r => r.choiceSlug === "makerglass-shield").weight).toBe(2);
	});
});

// -- A dropped shield stays a shield ------------------------------------------

describe("addDroppedInventoryItem", () => {
	// The drop path forwarded every other gear field and dropped this one, so a makerglass
	// shield treasure re-planted on a sheet kept its armor and silently stopped buying
	// Readiness — the exact mechanic the shield flag exists for.
	it("keeps the shield flag when a shield treasure is re-planted", async () => {
		const char = makeChar({});
		const created = [];
		char._actor.createEmbeddedDocuments = async (_type, docs) => { created.push(...docs); return docs; };
		await char.addDroppedInventoryItem({
			name: "A shield of makerglass",
			system: { weight: 2, note: "2 armor, +1 Readiness on a 7+ to Defend", armor: { base: 2 }, shield: true },
		});
		expect(created).toHaveLength(1);
		expect(created[0].system.shield).toBe(true);
		expect(created[0].system.armor).toEqual({ base: 2 });
	});

	it("does not call an ordinary write-in a shield", async () => {
		const char = makeChar({});
		const created = [];
		char._actor.createEmbeddedDocuments = async (_type, docs) => { created.push(...docs); return docs; };
		await char.addDroppedInventoryItem({ name: "A coil of rope", system: { weight: 1 } });
		expect(created[0].system.shield).toBeUndefined();
	});
});
