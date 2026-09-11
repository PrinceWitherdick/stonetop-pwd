import { describe, it, expect, vi } from "vitest";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { FakeInventoryRepository } from "../../fakes/FakeInventoryRepository.js";
import { FakeArcanaRepository } from "../../fakes/FakeArcanaRepository.js";
import { OutfitItemBuilder } from "../../../module/model/OutfitItem.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";

// Every way a character can come by armor has to actually reach the armor total. Four of them
// did not: a gear-choice on a special possession (the Judge's Makerglass shield) whose carried
// mark lives in a different flag namespace, an armoured arcanum's curio (the Demonhide Cloak),
// a move poached out of another playbook (the Heavy's Cut from Granite), and — the one that made
// the rest invisible in play — the derived total itself, which was never written to the document
// the combat flow reads it from.
//
// Each of those printed its armor on the sheet, right beside a tick box, while contributing 0.

// -- Fixtures -----------------------------------------------------------------

function outfitItem(slug, armor, { special = false } = {}) {
	return new OutfitItemBuilder()
		.withSlug(slug).withName(slug).withWeight(1).withNote(null)
		.withInventoryColumn("regular").withResource(null)
		.withTwoCol(false).withSmallGrid(false).withBreakBefore(false)
		.withArmor(armor).withSpecial(special)
		.build();
}

// A playbook whose one possession bundles gear choices, two of which are armour — mirroring the
// Judge's "Symbol of authority" (a ◇◇ shield printed "+1 armor") and a worn piece alongside it.
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
				pickCount: 3, gear: true,
				options: [
					{ slug: "makerglass-shield", label: "◇◇ Makerglass shield (+1 armor)", armor: { modifier: 1 } },
					{ slug: "scale-coat",        label: "◇◇ Scale coat (2 armor)",         armor: { base: 2 } },
					{ slug: "maul",              label: "◇◇ Black iron maul" },
				],
			},
		}],
	},
};

const DEMONHIDE_CLOAK = {
	slug: "demonhide-cloak",
	front: {
		title: "Demonhide Cloak",
		item: {
			name: "Demonhide Cloak", weight: 1, note: "<em>1 armor, warm, magical</em>",
			inventoryColumn: "regular", armor: { base: 1 },
		},
		description: "<p>A tattered cloak.</p>",
		unlock: { description: "Unlock by…", requirements: [] },
	},
	back: {
		title: "Demonhide Cloak", item: null, description: "<p>More.</p>",
		resource: null, move: null, options: [],
	},
};

function makeChar({ playbook = null, checked = {}, carried = {}, picked = [], items = [], arcana = [], owned = [] } = {}) {
	let b = new FakeActorBuilder()
		.withFlag("inventory.checked", checked)
		.withFlag("possessions.choiceCarried", carried)
		.withFlag("possessions.subChoices", { "symbol-of-authority": picked })
		.withFlag("arcana.owned", owned)
		.withFlag("arcana.identified", owned);
	if (playbook) b = b.withPlaybook(playbook.slug, playbook.name);
	const actor = b.build();
	let tb = new TestCharacterBuilder(actor)
		.withInventoryRepo(new FakeInventoryRepository(items))
		.withArcanaRepo(new FakeArcanaRepository(arcana));
	if (playbook) tb = tb.addPlaybook(playbook);
	return tb.build();
}

const armorOf = async (char) => (await char.buildSnapshot()).vitals.armor;

// -- Gear choices on a special possession -------------------------------------

describe("armor from a special possession's gear choices", () => {
	it("counts a carried choice-gear shield (the Makerglass shield's +1)", async () => {
		const char = makeChar({
			playbook: JUDGE_LIKE,
			picked: ["makerglass-shield"],
			carried: { "symbol-of-authority:makerglass-shield": true },
		});
		expect(await armorOf(char)).toBe(1);
	});

	it("counts nothing for a shield that is chosen but left behind (◇ unticked)", async () => {
		const char = makeChar({ playbook: JUDGE_LIKE, picked: ["makerglass-shield"], carried: {} });
		expect(await armorOf(char)).toBe(0);
	});

	it("counts nothing for a shield that was never chosen, however the ◇ reads", async () => {
		const char = makeChar({
			playbook: JUDGE_LIKE,
			picked: [],
			carried: { "symbol-of-authority:makerglass-shield": true },
		});
		expect(await armorOf(char)).toBe(0);
	});

	it("applies the base/modifier split across the two stores: worn armor wins, the shield adds", async () => {
		const char = makeChar({
			playbook: JUDGE_LIKE,
			picked: ["makerglass-shield", "scale-coat"],
			carried: {
				"symbol-of-authority:makerglass-shield": true,
				"symbol-of-authority:scale-coat": true,
			},
			// A worn piece from the ordinary catalog too — the best BASE counts once (2, not 1+2).
			items: [outfitItem("thick-hides", { base: 1 })],
			checked: { "thick-hides": true },
		});
		expect(await armorOf(char)).toBe(3);
	});

	it("does not let a choice-gear key collide with an outfit slug of the same name", async () => {
		// The choice key is `possessionSlug:choiceSlug`, so an outfit item literally named
		// "makerglass-shield" is a separate thing and must not be equipped by the choice's ◇.
		const char = makeChar({
			playbook: JUDGE_LIKE,
			picked: ["makerglass-shield"],
			carried: { "symbol-of-authority:makerglass-shield": true },
			items: [outfitItem("makerglass-shield", { modifier: 5 })],
			checked: {},
		});
		expect(await armorOf(char)).toBe(1);
	});
});

// -- Arcana -------------------------------------------------------------------

describe("armor from an arcanum's curio", () => {
	it("counts an armored arcanum when its ◇ is marked", async () => {
		const char = makeChar({
			arcana: [DEMONHIDE_CLOAK], owned: ["demonhide-cloak"],
			checked: { "demonhide-cloak": true },
		});
		expect(await armorOf(char)).toBe(1);
	});

	it("counts nothing when the arcanum is owned but not carried", async () => {
		const char = makeChar({
			arcana: [DEMONHIDE_CLOAK], owned: ["demonhide-cloak"], checked: {},
		});
		expect(await armorOf(char)).toBe(0);
	});

	it("takes the best worn value rather than stacking a cloak with a hauberk", async () => {
		const char = makeChar({
			arcana: [DEMONHIDE_CLOAK], owned: ["demonhide-cloak"],
			items: [outfitItem("hauberk-iron", { base: 2 })],
			checked: { "demonhide-cloak": true, "hauberk-iron": true },
		});
		expect(await armorOf(char)).toBe(2);
	});
});

// -- Moves --------------------------------------------------------------------

describe("armor from a move's armorBonus", () => {
	// The Heavy's Cut from Granite, taken by a non-Heavy through a cross-playbook move. It was
	// counted by neither loop in _ownedMoveBonuses: the custom sweep is scoped to player-authored
	// moves, and the definition walk only ever reads the character's own playbook.
	const foreignMove = {
		_id: "foreign1", type: "move", name: "Cut from Granite",
		system: { moveType: "playbook", playbook: "The Heavy", armorBonus: 1, hpBonus: 2 },
		flags: {},
	};

	it("counts a foreign cross-playbook move's armor bonus", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("test-judge", "Test Judge")
			.withItems([foreignMove])
			.build();
		const char = new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([]))
			.addPlaybook(JUDGE_LIKE)
			.build();
		expect((await char.buildSnapshot()).vitals.armor).toBe(1);
	});

	it("counts a move from the character's OWN playbook exactly once, not twice", async () => {
		// The double-count guard. Here the move repository really does define the move for this
		// character's own playbook, so the definition walk claims it — and the foreign sweep has
		// to skip it by name, or the owned copy's armorBonus lands a second +1 on top.
		//
		// Registered through addPlaybookMove (the fake move REPOSITORY) rather than as a `moves`
		// key on the playbook: the definition walk reads getPlaybookMoves(), so a playbook-object
		// move would leave the repo empty and let the foreign sweep answer instead — which is
		// exactly the double-count this asserts against, passing for the wrong reason.
		const heavyLike = { ...JUDGE_LIKE, slug: "test-heavy", name: "Test Heavy" };
		const actor = new FakeActorBuilder()
			.withPlaybook("test-heavy", "Test Heavy")
			.withItems([{ ...foreignMove, system: { ...foreignMove.system, playbook: "Test Heavy" } }])
			.build();
		const char = new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([]))
			.addPlaybook(heavyLike)
			.addPlaybookMove({ _id: "def1", name: "Cut from Granite", system: { description: "<p>+1 armor.</p>", armorBonus: 1 } })
			.build();
		expect((await char.buildSnapshot()).vitals.armor).toBe(1);
	});
});

// -- The stored mirror --------------------------------------------------------

describe("StonetopCharacterSheet._syncStoredDerived", () => {
	// The armor input on the vitals partial is `disabled`, so it is never submitted and the
	// stored `attributes.armor.value` kept its schema initial of 0 forever. getData's setProperty
	// only mutates the in-memory DataModel of whoever rendered the sheet — but the combat flow
	// reads the stored number off the document, on a GM client that has never opened that sheet.
	const Sheet = createStonetopCharacterSheetClass(class { });
	const sync = Sheet.prototype._syncStoredDerived;

	function ctx({ computed, stored = 0, isOwner = true, isEditable = true, maxHp = 0, storedMaxHp = 0 }) {
		const update = vi.fn(async () => {});
		return {
			self: {
				_computedArmor: computed,
				_computedMaxHp: maxHp,
				isEditable,
				_computedUnpierceable: 0,
				actor: {
					isOwner,
					system: { attributes: { armor: { value: stored, unpierceable: 0 }, hp: { max: storedMaxHp } } },
					update,
				},
			},
			update,
		};
	}

	it("writes the derived armor onto the document, ledger-silenced", async () => {
		const { self, update } = ctx({ computed: 3, stored: 0 });
		await sync.call(self);
		expect(update).toHaveBeenCalledWith(
			{ "system.attributes.armor.value": 3, "system.attributes.armor.unpierceable": 0 },
			{ stonetopLedger: true });
	});

	it("writes a computed 0, so taking armor OFF is persisted too", async () => {
		// The reason this carries null rather than overloading 0 the way the max-HP mirror does:
		// an unarmored character is a real value, and must overwrite a stale stored 2.
		const { self, update } = ctx({ computed: 0, stored: 2 });
		await sync.call(self);
		expect(update).toHaveBeenCalledWith(
			{ "system.attributes.armor.value": 0, "system.attributes.armor.unpierceable": 0 },
			{ stonetopLedger: true });
	});

	it("mirrors a stale max HP and a stale armor in ONE write", async () => {
		// Two updates would mean two broadcasts and two more renders racing on one document,
		// and both numbers go stale together on the first open of an existing character.
		const { self, update } = ctx({ computed: 3, stored: 0, maxHp: 18, storedMaxHp: 10 });
		await sync.call(self);
		expect(update).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledWith({
			"system.attributes.hp.max": 18,
			"system.attributes.armor.value": 3,
			"system.attributes.armor.unpierceable": 0,
		}, { stonetopLedger: true });
	});

	it("does not write when the stored value already agrees", async () => {
		const { self, update } = ctx({ computed: 2, stored: 2 });
		await sync.call(self);
		expect(update).not.toHaveBeenCalled();
	});

	it("does nothing when there is no snapshot to mirror", async () => {
		const { self, update } = ctx({ computed: null, stored: 5 });
		await sync.call(self);
		expect(update).not.toHaveBeenCalled();
	});

	it("does not write on a sheet it may not edit (locked compendium, unlinked token)", async () => {
		for (const gate of [{ isOwner: false }, { isEditable: false }]) {
			const { self, update } = ctx({ computed: 3, stored: 0, ...gate });
			await sync.call(self);
			expect(update).not.toHaveBeenCalled();
		}
	});
});
