import { describe, it, expect } from "vitest";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";

// A gear-bearing `choices` bundle (the Heavy's Weapons of war): choosing which weapons you
// own and marking which you're carrying are two separate states, so giving one up has to
// drop its ◇ carry mark — otherwise re-choosing it later would silently re-add its weight.
const WEAPONS_PLAYBOOK = {
	slug: "test-weapons-pb",
	name: "Test Weapons",
	specialPossessions: {
		pickCount: 0,
		preselected: ["weapons-of-war"],
		options: [{
			slug: "weapons-of-war",
			label: "Weapons of war",
			choices: {
				pickCount: 3, gear: true,
				options: [
					{ slug: "sword",     label: "◇ Sword, iron" },
					{ slug: "battleaxe", label: "◇ Battleaxe, iron" },
					{ slug: "crossbow",  label: "◇ Crossbow" },
					{ slug: "maul",      label: "◇◇ Maul" },
					{ slug: "token",     label: "A token of affection" },
				],
			},
		}],
	},
};

function makeChar({ picked = [], carried = {}, inventory = {} } = {}) {
	const builder = new FakeActorBuilder()
		.withPlaybook("test-weapons-pb", "Test Weapons")
		.withFlag("possessions.subChoices", { "weapons-of-war": picked })
		.withFlag("possessions.choiceCarried", carried);
	for (const [key, value] of Object.entries(inventory)) builder.withFlag(`inventory.${key}`, value);
	const actor = builder.build();
	return new TestCharacterBuilder(actor).addPlaybook(WEAPONS_PLAYBOOK).build();
}

const inv = (char, key) => char._actor.getFlag("stonetop-pwd", `inventory.${key}`);

describe("StonetopCharacter — choice-gear carry marks", () => {
	it("setChoiceGearCarried records the ◇ without touching the picks", async () => {
		const char = makeChar({ picked: ["sword"] });
		await char.setChoiceGearCarried("weapons-of-war", "sword", true);
		expect(char.possessions.isChoiceCarried("weapons-of-war", "sword")).toBe(true);
		expect(char.possessions.subChoices["weapons-of-war"]).toEqual(["sword"]);
	});

	it("deselectSubChoice drops the weapon's carry mark with it", async () => {
		const char = makeChar({ picked: ["sword"], carried: { "weapons-of-war:sword": true } });
		await char.deselectSubChoice("weapons-of-war", "sword");
		expect(char.possessions.subChoices["weapons-of-war"]).toEqual([]);
		expect(char.possessions.isChoiceCarried("weapons-of-war", "sword")).toBe(false);
	});

	it("setPossessionSubChoices drops carry marks for picks it replaces away", async () => {
		const char = makeChar({
			picked: ["sword", "battleaxe"],
			carried: { "weapons-of-war:sword": true, "weapons-of-war:battleaxe": true },
		});
		// Re-running onboarding with a different loadout.
		await char.setPossessionSubChoices("weapons-of-war", ["sword", "crossbow"]);
		expect(char.possessions.isChoiceCarried("weapons-of-war", "sword")).toBe(true);
		expect(char.possessions.isChoiceCarried("weapons-of-war", "battleaxe")).toBe(false);
		expect(char.possessions.isChoiceCarried("weapons-of-war", "crossbow")).toBe(false);
	});
});

// Have What You Need (Book I p.326, "something from your special possessions"; p.327, Sawyl's
// lantern): a chosen weapon ticked in the field moves undefined marks onto it, exactly as a
// possession's granted gear does, and setting it down hands back what it drew.
describe("StonetopCharacter: choice gear marked in the field (POS-1)", () => {
	it("draws its weight from the undefined ◇ and records the draw", async () => {
		const char = makeChar({ picked: ["maul"], inventory: { regularPool: 3 } });
		await char.setChoiceGearCarried("weapons-of-war", "maul", true);
		expect(char.possessions.isChoiceCarried("weapons-of-war", "maul")).toBe(true);
		expect(inv(char, "regularPool")).toBe(1);
		expect(inv(char, "drawn")).toEqual({ "weapons-of-war:maul": 2 });
	});

	it("hands back exactly what it drew when set down", async () => {
		const char = makeChar({ picked: ["maul"], inventory: { regularPool: 1 } });
		await char.setChoiceGearCarried("weapons-of-war", "maul", true);   // only 1 to draw
		expect(inv(char, "regularPool")).toBe(0);
		await char.setChoiceGearCarried("weapons-of-war", "maul", false);
		expect(char.possessions.isChoiceCarried("weapons-of-war", "maul")).toBe(false);
		expect(inv(char, "regularPool")).toBe(1);
		expect(inv(char, "drawn") ?? {}).not.toHaveProperty("weapons-of-war:maul");
	});

	it("gives nothing back for gear marked at Outfit (no draw record)", async () => {
		const char = makeChar({ picked: ["sword"], carried: { "weapons-of-war:sword": true }, inventory: { regularPool: 2 } });
		await char.setChoiceGearCarried("weapons-of-war", "sword", false);
		expect(inv(char, "regularPool")).toBe(2);
	});

	it("a small row draws one undefined □", async () => {
		const char = makeChar({ picked: ["token"], inventory: { smallPool: 2, regularPool: 2 } });
		await char.setChoiceGearCarried("weapons-of-war", "token", true);
		expect(inv(char, "smallPool")).toBe(1);
		expect(inv(char, "regularPool")).toBe(2);
	});

	// Un-picking a weapon drops its carry mark (deselectSubChoice), and with it what the mark drew.
	it("hands back what it drew when the weapon is un-picked while carried", async () => {
		const char = makeChar({ picked: ["maul", "token"], inventory: { regularPool: 3, smallPool: 1 } });
		await char.setChoiceGearCarried("weapons-of-war", "maul", true);
		expect(inv(char, "regularPool")).toBe(1);
		await char.deselectSubChoice("weapons-of-war", "maul");
		expect(char.possessions.isChoiceCarried("weapons-of-war", "maul")).toBe(false);
		expect(inv(char, "regularPool")).toBe(3);
		expect(inv(char, "drawn") ?? {}).not.toHaveProperty("weapons-of-war:maul");
	});

	it("hands back every dropped row's draw, each to its own pool, when picks are replaced", async () => {
		const char = makeChar({ picked: ["maul", "sword", "token"], inventory: { regularPool: 4, smallPool: 1 } });
		await char.setChoiceGearCarried("weapons-of-war", "maul", true);
		await char.setChoiceGearCarried("weapons-of-war", "sword", true);
		await char.setChoiceGearCarried("weapons-of-war", "token", true);
		expect(inv(char, "regularPool")).toBe(1);
		expect(inv(char, "smallPool")).toBe(0);
		await char.setPossessionSubChoices("weapons-of-war", ["crossbow"]);
		expect(inv(char, "regularPool")).toBe(4);
		expect(inv(char, "smallPool")).toBe(1);
		expect(Object.keys(inv(char, "drawn") ?? {})).toEqual([]);
	});

	it("ticking a row already carried draws nothing more", async () => {
		const char = makeChar({ picked: ["sword"], carried: { "weapons-of-war:sword": true }, inventory: { regularPool: 2 } });
		await char.setChoiceGearCarried("weapons-of-war", "sword", true);
		expect(inv(char, "regularPool")).toBe(2);
	});
});
