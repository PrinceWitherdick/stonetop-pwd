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

function makeChar({ hp = 20, adjustment = 0, playbook = true } = {}) {
	const builder = new FakeActorBuilder().withHp(hp, 20).withMaxHpAdjustment(adjustment);
	if (playbook) builder.withPlaybook("the-heavy", "The Heavy");
	const actor = builder.build();
	const charBuilder = new TestCharacterBuilder(actor);
	if (playbook) charBuilder.addPlaybook(HEAVY_PLAYBOOK);
	return { char: charBuilder.build(), actor };
}

describe("the permanent max-HP adjustment in the snapshot", () => {
	it("leaves max HP at the playbook's number when there is no adjustment", async () => {
		const snap = await makeChar().char.buildSnapshot();
		expect(snap.vitals.hp.max).toBe(20);
		expect(snap.vitals.hpBase).toBe(20);
	});

	// "The ring wounds your soul, reducing your max HP by 4" (Hungering Maw of Hlad).
	it("takes the cost off the derived max, and reports the underived one alongside", async () => {
		const snap = await makeChar({ adjustment: -4 }).char.buildSnapshot();
		expect(snap.vitals.hp.max).toBe(16);
		expect(snap.vitals.hpBase).toBe(20);
	});

	// "Gain unholy resilience: increase your max HP by 2" (Creepy Cave).
	it("adds a boon the same way", async () => {
		const snap = await makeChar({ adjustment: 2 }).char.buildSnapshot();
		expect(snap.vitals.hp.max).toBe(22);
	});

	it("clamps current HP to the lowered max", async () => {
		const snap = await makeChar({ hp: 20, adjustment: -4 }).char.buildSnapshot();
		expect(snap.vitals.hp.value).toBe(16);
	});

	// Floored for the same reason the Thrall's Marks are: 0 max HP is permanent dying.
	it("never drops max HP below 1", async () => {
		const snap = await makeChar({ adjustment: -50 }).char.buildSnapshot();
		expect(snap.vitals.hp.max).toBe(1);
	});

	it("reports no base to build on without a playbook", async () => {
		const snap = await makeChar({ playbook: false }).char.buildSnapshot();
		expect(snap.vitals.hpBase).toBe(0);
	});

	// The floor fires on the BASE, so a derived max driven to 0 or below still reports a base of 1
	// — and the adjustment has to be measured against that same 1, because it is the number the
	// sheet renders into the field and hands back to setMaxHp. Measuring the max off the un-floored
	// number instead made the hand-set round trip land somewhere else entirely.
	describe("when the derived max has been driven below 1", () => {
		// A playbook contributing nothing stands in for the real routes there: a Thrall's max-HP
		// Marks, or a deep enough insert penalty. All three reach it by the same subtraction.
		const makeSpent = ({ adjustment = 0 } = {}) => {
			const actor = new FakeActorBuilder().withHp(1, 20).withMaxHpAdjustment(adjustment)
				.withPlaybook("the-heavy", "The Heavy").build();
			const char = new TestCharacterBuilder(actor)
				.addPlaybook({ ...HEAVY_PLAYBOOK, hp: 0 })
				.build();
			return { char, actor };
		};

		it("still reports a base of 1", async () => {
			const snap = await makeSpent().char.buildSnapshot();
			expect(snap.vitals.hpBase).toBe(1);
			expect(snap.vitals.hp.max).toBe(1);
		});

		it("round-trips a hand-set max through the base the sheet showed", async () => {
			const { char, actor } = makeSpent();
			const base = (await char.buildSnapshot()).vitals.hpBase;   // what data-hp-base carries
			await char.setMaxHp(5, { base });
			expect(actor.system.attributes.hp.adjustment).toBe(4);
			// The number typed is the number that comes back — it used to render as 4.
			expect((await char.buildSnapshot()).vitals.hp.max).toBe(5);
		});

		it("keeps the floor when the adjustment cannot lift it", async () => {
			const snap = await makeSpent({ adjustment: -3 }).char.buildSnapshot();
			expect(snap.vitals.hp.max).toBe(1);
		});
	});
});

describe("StonetopCharacter.setMaxHp", () => {
	it("stores the difference from the derived max, not the number typed", async () => {
		const { char, actor } = makeChar();
		expect(await char.setMaxHp(18, { base: 20 })).toBe(18);
		expect(actor.system.attributes.hp.adjustment).toBe(-2);
	});

	// The whole point of storing a delta: the scar keeps its size as the character grows.
	it("keeps its size when the derived max later rises", async () => {
		const { char, actor } = makeChar();
		await char.setMaxHp(18, { base: 20 });

		// A move bonus raises the playbook number underneath the adjustment.
		const raised = new TestCharacterBuilder(actor)
			.addPlaybook({ ...HEAVY_PLAYBOOK, hp: 24 })
			.build();
		expect((await raised.buildSnapshot()).vitals.hp.max).toBe(22);
	});

	it("typing the derived number back in clears the adjustment", async () => {
		const { char, actor } = makeChar({ adjustment: -2 });
		await char.setMaxHp(20, { base: 20 });
		expect(actor.system.attributes.hp.adjustment).toBe(0);
	});

	it("takes current HP down with a lowered max, and leaves it alone otherwise", async () => {
		const { char, actor } = makeChar({ hp: 20 });
		await char.setMaxHp(18, { base: 20 });
		expect(actor.system.attributes.hp.value).toBe(18);

		await char.setMaxHp(24, { base: 20 });
		expect(actor.system.attributes.hp.value).toBe(18);
	});

	it("refuses to set a max of 0 or less", async () => {
		const { char, actor } = makeChar();
		expect(await char.setMaxHp(0, { base: 20 })).toBe(1);
		expect(actor.system.attributes.hp.adjustment).toBe(-19);
	});

	// No playbook means no derived number to sit on top of, so the typed value is the max.
	it("writes the stored max directly when there is nothing derived behind it", async () => {
		const { char, actor } = makeChar({ playbook: false });
		expect(await char.setMaxHp(12, { base: 0 })).toBe(12);
		expect(actor.system.attributes.hp.max).toBe(12);
		expect(actor.system.attributes.hp.adjustment).toBe(0);
	});

	it("falls back to the snapshot's base when the caller doesn't know it", async () => {
		const { char, actor } = makeChar();
		expect(await char.setMaxHp(17)).toBe(17);
		expect(actor.system.attributes.hp.adjustment).toBe(-3);
	});

	it("reads the adjustment back", async () => {
		const { char } = makeChar({ adjustment: -4 });
		expect(char.maxHpAdjustment).toBe(-4);
	});

	it("is what computedMaxHp reports", async () => {
		const { char } = makeChar();
		await char.setMaxHp(18, { base: 20 });
		expect(await char.computedMaxHp()).toBe(18);
	});
});
