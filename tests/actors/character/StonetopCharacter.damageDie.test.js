import { describe, expect, it } from "vitest";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";

const HEAVY_PLAYBOOK = {
	slug: "the-heavy",
	name: "The Heavy",
	hp: 20,
	damage: "d10",
	backgrounds: [],
	moves: { starting: [], choices: [] },
};

function makeChar({ damage = "d10", override = "", playbook = true } = {}) {
	const builder = new FakeActorBuilder().withDamage(damage, override);
	if (playbook) builder.withPlaybook("the-heavy", "The Heavy");
	const actor = builder.build();
	const charBuilder = new TestCharacterBuilder(actor);
	if (playbook) charBuilder.addPlaybook(HEAVY_PLAYBOOK);
	return { char: charBuilder.build(), actor };
}

describe("StonetopCharacter.damageDieOverride", () => {
	it("is null when nothing has been typed", () => {
		expect(makeChar().char.damageDieOverride).toBeNull();
	});

	it("reads back the stored override, normalized", () => {
		expect(makeChar({ override: "1d8" }).char.damageDieOverride).toBe("d8");
	});
});

describe("StonetopCharacter.setDamageDieOverride", () => {
	it("stores the die in both the override and the field the damage roller reads", async () => {
		const { char, actor } = makeChar();
		const effective = await char.setDamageDieOverride("d8");

		expect(effective).toBe("d8");
		expect(actor.update).toHaveBeenCalledWith({
			"system.attributes.damage.override": "d8",
			"system.attributes.damage.value": "d8",
		});
		expect(actor.system.attributes.damage).toEqual({ override: "d8", value: "d8" });
	});

	it("normalizes what the player typed", async () => {
		const { char, actor } = makeChar();
		expect(await char.setDamageDieOverride("8")).toBe("d8");
		expect(actor.system.attributes.damage.override).toBe("d8");
	});

	it("clearing it puts the playbook die back in both places", async () => {
		const { char, actor } = makeChar({ damage: "d8", override: "d8" });
		const effective = await char.setDamageDieOverride("");

		expect(effective).toBe("d10");
		expect(actor.system.attributes.damage).toEqual({ override: "", value: "d10" });
	});

	it("clearing it with no playbook behind it blanks the die rather than leaving the old one", async () => {
		const { char, actor } = makeChar({ damage: "d8", override: "d8", playbook: false });
		const effective = await char.setDamageDieOverride("");

		// There's no derived die to fall back to, so the cleared override has to leave the field
		// the roller reads empty: keeping "d8" there would go on rolling the die the player just
		// cleared, under a sheet input showing nothing.
		expect(effective).toBeNull();
		expect(actor.system.attributes.damage).toEqual({ override: "", value: "" });
	});

	it("treats an unusable value as a clear rather than persisting it", async () => {
		const { char, actor } = makeChar({ override: "d8" });
		await char.setDamageDieOverride("2d6");

		expect(actor.system.attributes.damage.override).toBe("");
	});

	it("the die it sets is the one the snapshot reports", async () => {
		const { char } = makeChar();
		await char.setDamageDieOverride("d6");

		const snap = await char.buildSnapshot();
		expect(snap.vitals.damage).toBe("d6");
		expect(snap.vitals.damageBase).toBe("d10");
	});
});

// The damage roller asks per ROLL — twice over on the counter-attack and multi-target paths — so
// it takes this instead of building a whole sheet snapshot for one string. That trade is only safe
// while the two give the SAME answer, which is what these pin: both read the one derivation in
// _derivedDamageDie, and a second copy of that rule is how the roller and the sheet come to
// disagree about what die a character rolls.
describe("StonetopCharacter.computedDamageDie", () => {
	it("agrees with the snapshot on the playbook's die", async () => {
		const { char } = makeChar();
		expect(await char.computedDamageDie()).toBe("d10");
		expect(await char.computedDamageDie()).toBe((await char.buildSnapshot()).vitals.damage);
	});

	it("agrees with the snapshot on a hand-typed override", async () => {
		const { char } = makeChar({ override: "d6" });
		expect(await char.computedDamageDie()).toBe("d6");
		expect(await char.computedDamageDie()).toBe((await char.buildSnapshot()).vitals.damage);
	});

	it("normalizes the override the same way the snapshot does", async () => {
		const { char } = makeChar({ override: "1d8" });
		expect(await char.computedDamageDie()).toBe("d8");
	});

	// No playbook means nothing to derive from. The roller falls back to the persisted field.
	it("has no answer without a playbook", async () => {
		const { char } = makeChar({ playbook: false });
		expect(await char.computedDamageDie()).toBeNull();
	});
});
