import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerVitalsMirrorHooks, mayMoveVitals, mayMoveSteadingGear, mayMoveMarks, FLAG_NOISE } from "../../../module/actors/character/vitals-mirror.js";
import { CLASHED_FLAG, HARMED_BY_FLAG, KNOCKED_DOWN_FLAG, ALPHA_FLAG } from "../../../module/fight/hero-moves.js";
import { StonetopCharacter } from "../../../module/actors/character/StonetopCharacter.js";
import { READINESS_FLAG } from "../../../module/combat/defend-readiness.js";
import { LEDGER_KEY } from "../../../module/utils/ledger-core.js";
import { CAMP_FLAG, CAMP_OWED_FLAG } from "../../../module/camp/camp-rules.js";
import { CAMP_HUNGER_FLAG } from "../../../module/camp/camp-store.js";
import { DEATHS_DOOR_FLAG, DEATHS_DOOR_ROLLING_FLAG, UNSTOPPABLE_FIGHTING_FLAG } from "../../../module/actors/character/deaths-door.js";
import { INSPIRATION_FLAG } from "../../../module/actors/character/inspiration.js";
import { BLESSING_FLAG } from "../../../module/actors/character/roll-boosts.js";
import { ONGOING_INVOCATION_FLAGS } from "../../../module/actors/character/ongoing-invocation.js";
import { HOLY_LIGHT_FLAG } from "../../../module/actors/character/holy-light.js";
import { MIRRORED_HP_PENALTY_FLAG } from "../../../module/actors/character/StonetopFlags.js";

// The stored armor and max HP are what the token bar, the Fight tab and the ledger read. They have to
// follow a change made with the character's sheet closed, on exactly one client: the one that made it.

function character({ id = "pim", owner = true } = {}) {
	const sync = vi.fn(async () => true);
	return {
		id, name: id, type: "character", isOwner: owner, pack: null, isToken: false,
		typedActor: { syncStoredVitals: sync },
		sync,
	};
}

describe("what moves a vital", () => {
	it("ignores the mirror's own write and a blow's damage", () => {
		expect(mayMoveVitals({ _id: "x", system: { attributes: { armor: { value: 2, unpierceable: 0 }, hp: { max: 20 } } } })).toBe(false);
		expect(mayMoveVitals({ system: { attributes: { hp: { value: 3 } } } })).toBe(false);
	});

	it("counts what the vitals are worked out from: a carried mark, the playbook, a level, the hand-set deltas", () => {
		expect(mayMoveVitals({ flags: { "stonetop-pwd": { inventory: { checked: { shield: true } } } } })).toBe(true);
		expect(mayMoveVitals({ system: { playbook: { slug: "the-heavy" } } })).toBe(true);
		expect(mayMoveVitals({ system: { attributes: { level: { value: 2 } } } })).toBe(true);
		expect(mayMoveVitals({ system: { attributes: { armor: { adjustment: 1 } } } })).toBe(true);
		expect(mayMoveVitals({ system: { attributes: { hp: { adjustment: -2 } } } })).toBe(true);
	});

	it("ignores what play writes over and over and no vital reads", () => {
		expect(mayMoveVitals({ name: "Pim", img: "pim.webp" })).toBe(false);
		expect(mayMoveVitals({ system: { attributes: { xp: { value: 3 }, wounds: [] } } })).toBe(false);
		for (const key of FLAG_NOISE) expect(mayMoveVitals({ flags: { "stonetop-pwd": { [key]: 1 } } })).toBe(false);
		expect(mayMoveVitals({ flags: { "stonetop-pwd": { "-=camp": null } } })).toBe(false);
		// The Death's Door roll in progress, written and cleared several times a roll (audit DD-6).
		expect(mayMoveVitals({ flags: { "stonetop-pwd": { deathsDoorRolling: { userId: "u", nonce: "n" } } } })).toBe(false);
		expect(mayMoveVitals({ flags: { "stonetop-pwd": { "-=deathsDoorRolling": null } } })).toBe(false);
	});

	// The keyed ledger's own writes: one entry per key, and the one-time conversion of an old
	// array ledger, which v13 spells as a forced replacement `==ledger`.
	it("ignores the ledger's keyed writes and its v13 replacement", () => {
		expect(mayMoveVitals({ flags: { "stonetop-pwd": { ledger: { abc: { action: "HP changed from 5 to 4" } } } } })).toBe(false);
		expect(mayMoveVitals({ flags: { "stonetop-pwd": { "==ledger": { abc: { action: "x" } } } } })).toBe(false);
	});

	it("spells each quiet flag as its owner does", () => {
		expect([...FLAG_NOISE].sort()).toEqual([
			READINESS_FLAG, LEDGER_KEY, CAMP_FLAG, CAMP_OWED_FLAG, CAMP_HUNGER_FLAG, DEATHS_DOOR_FLAG, DEATHS_DOOR_ROLLING_FLAG,
			UNSTOPPABLE_FIGHTING_FLAG, CLASHED_FLAG, HARMED_BY_FLAG, KNOCKED_DOWN_FLAG, ALPHA_FLAG,
			INSPIRATION_FLAG, BLESSING_FLAG, "invocations", ...ONGOING_INVOCATION_FLAGS, MIRRORED_HP_PENALTY_FLAG,
		].sort());
		// The Candle against the Dark's armor reads the light, so lighting it must re-mirror.
		expect(FLAG_NOISE.has(HOLY_LIGHT_FLAG)).toBe(false);
	});

	it("re-mirrors everyone when a Blessed lays or lifts a mark: Barkskin is armor on somebody else's sheet", () => {
		expect(mayMoveMarks({ flags: { "stonetop-pwd": { blessedMarks: [{ kind: "barkskin", uuid: "Actor.pim" }] } } })).toBe(true);
		expect(mayMoveMarks({ flags: { "stonetop-pwd": { inventory: { checked: { shield: true } } } } })).toBe(false);
	});

	it("counts the steading's Weapons of War, and nothing else about the steading", () => {
		expect(mayMoveSteadingGear({ flags: { "stonetop-pwd": { steading: { improvements: { "weapons-of-war": { completed: true } } } } } })).toBe(true);
		expect(mayMoveSteadingGear({ flags: { "stonetop-pwd": { steading: { fortifications: ["Weapons of war"] } } } })).toBe(true);
		expect(mayMoveSteadingGear({ flags: { "stonetop-pwd": { steading: { system: { attributes: { prosperity: { value: 2 } } } } } } })).toBe(false);
	});
});

describe("the vitals mirror hooks", () => {
	let handlers;
	beforeEach(() => {
		vi.useFakeTimers();
		handlers = {};
		globalThis.Hooks = {
			on: vi.fn((name, fn) => { handlers[name] = fn; }),
			once: vi.fn((name, fn) => { handlers[`once:${name}`] = fn; }),
		};
		globalThis.game = { ...(globalThis.game ?? {}), user: { id: "me" } };
		registerVitalsMirrorHooks();
	});
	afterEach(() => vi.useRealTimers());

	it("re-mirrors once a burst of item changes made here has settled", async () => {
		const pim = character();
		handlers.createItem({ parent: pim }, {}, "me");
		handlers.updateItem({ parent: pim }, {}, {}, "me");
		handlers.deleteItem({ parent: pim }, {}, "me");
		expect(pim.sync).not.toHaveBeenCalled();
		await vi.runAllTimersAsync();
		expect(pim.sync).toHaveBeenCalledTimes(1);
	});

	it("leaves a change somebody else made to their client", async () => {
		const pim = character();
		handlers.updateItem({ parent: pim }, {}, {}, "someone-else");
		handlers.updateActor(pim, { system: { attributes: { level: { value: 2 } } } }, {}, "someone-else");
		await vi.runAllTimersAsync();
		expect(pim.sync).not.toHaveBeenCalled();
	});

	it("does not answer its own write", async () => {
		const pim = character();
		handlers.updateActor(pim, { system: { attributes: { armor: { value: 2 }, hp: { max: 22 } } } }, {}, "me");
		await vi.runAllTimersAsync();
		expect(pim.sync).not.toHaveBeenCalled();
	});

	it("skips anything that is not a world character", async () => {
		const npc = { ...character(), type: "npc" };
		const packed = { ...character(), pack: "world.heroes" };
		const token = { ...character(), isToken: true };
		for (const actor of [npc, packed, token]) handlers.updateItem({ parent: actor }, {}, {}, "me");
		await vi.runAllTimersAsync();
		for (const actor of [npc, packed, token]) expect(actor.sync).not.toHaveBeenCalled();
	});

	describe("changes outside the character", () => {
		const weaponsOfWar = { flags: { "stonetop-pwd": { steading: { improvements: { "weapons-of-war": { completed: true } } } } } };
		const steading = { id: "stonetop", type: "stonetop" };
		const arcanum = { parent: null, type: "move", system: { moveType: "arcanum" } };

		function world(primary) {
			const pim = character({ id: "pim" });
			const cadi = character({ id: "cadi" });
			globalThis.game.actors = [pim, cadi, { ...character({ id: "wolf" }), type: "monster" }];
			globalThis.game.users = { activeGM: { id: primary ? "me" : "other-gm" } };
			return { pim, cadi };
		}

		it("re-mirrors every character on the primary GM's client when the steading earns Weapons of War", async () => {
			const { pim, cadi } = world(true);
			handlers.updateActor(steading, weaponsOfWar, {}, "a-player");
			await vi.runAllTimersAsync();
			expect(pim.sync).toHaveBeenCalledTimes(1);
			expect(cadi.sync).toHaveBeenCalledTimes(1);
		});

		it("leaves it to the primary GM, and ignores the rest of the steading", async () => {
			const others = world(false);
			handlers.updateActor(steading, weaponsOfWar, {}, "me");
			const mine = world(true);
			handlers.updateActor(steading, { flags: { "stonetop-pwd": { steading: { population: 3 } } } }, {}, "me");
			await vi.runAllTimersAsync();
			for (const actor of [others.pim, others.cadi, mine.pim, mine.cadi]) expect(actor.sync).not.toHaveBeenCalled();
		});

		it("re-mirrors every character when a world arcanum's record changes", async () => {
			const { pim, cadi } = world(true);
			handlers.updateItem(arcanum, {}, {}, "other-gm");
			await vi.runAllTimersAsync();
			expect(pim.sync).toHaveBeenCalledTimes(1);
			expect(cadi.sync).toHaveBeenCalledTimes(1);
		});
	});
});

describe("StonetopCharacter#syncStoredVitals", () => {
	// update() resolves to the document when the write changed it, as core's does; to nothing when it did not.
	function typed(attributes, computed, flags = {}) {
		const actor = { system: { attributes }, flags: { "stonetop-pwd": flags } };
		actor.update = vi.fn(async () => actor);
		return { self: { _actor: actor, computedVitals: async () => computed }, actor };
	}
	const sync = self => StonetopCharacter.prototype.syncStoredVitals.call(self);

	it("writes what is stale, in one ledger-silenced update", async () => {
		const { self, actor } = typed({ armor: { value: 0, unpierceable: 0 }, hp: { max: 18 } }, { armor: 2, unpierceable: 1, maxHp: 22 });
		expect(await sync(self)).toBe(true);
		expect(actor.update).toHaveBeenCalledWith({
			"system.attributes.armor.value": 2,
			"system.attributes.armor.unpierceable": 1,
			"system.attributes.armor.conditional": 0,
			"system.attributes.armor.conditionalSource": "",
			"system.attributes.hp.max": 22,
		}, { stonetopLedger: true });
	});

	it("carries the fiction-gated part of the armor and which move granted it", async () => {
		const { self, actor } = typed(
			{ armor: { value: 0, unpierceable: 0, conditional: 0, conditionalSource: "" }, hp: { max: 18 } },
			{ armor: 2, unpierceable: 0, conditional: 2, conditionalSource: "Barkskin", maxHp: 18 });
		expect(await sync(self)).toBe(true);
		expect(actor.update).toHaveBeenCalledWith({
			"system.attributes.armor.value": 2,
			"system.attributes.armor.unpierceable": 0,
			"system.attributes.armor.conditional": 2,
			"system.attributes.armor.conditionalSource": "Barkskin",
		}, { stonetopLedger: true });
	});

	it("writes again when only the move behind that armor changed", async () => {
		const { self, actor } = typed(
			{ armor: { value: 2, unpierceable: 0, conditional: 2, conditionalSource: "Barkskin" }, hp: { max: 18 } },
			{ armor: 2, unpierceable: 0, conditional: 0, conditionalSource: "", maxHp: 18 });
		expect(await sync(self)).toBe(true);
		expect(actor.update).toHaveBeenCalledWith(expect.objectContaining({
			"system.attributes.armor.conditional": 0,
			"system.attributes.armor.conditionalSource": "",
		}), { stonetopLedger: true });
	});

	it("writes only the half that moved", async () => {
		const { self, actor } = typed({ armor: { value: 2, unpierceable: 0 }, hp: { max: 18 } }, { armor: 2, unpierceable: 0, maxHp: 16 });
		await sync(self);
		expect(actor.update).toHaveBeenCalledWith({ "system.attributes.hp.max": 16 }, { stonetopLedger: true });
	});

	// Post-death audit B2: a Thrall's "Reduce your max HP by 2" Mark dropped the max under the HP they had.
	it("brings the HP down to a max that drops below it, in the same write", async () => {
		const { self, actor } = typed({ armor: { value: 2, unpierceable: 0 }, hp: { value: 18, max: 18 } }, { armor: 2, unpierceable: 0, maxHp: 16 });
		await sync(self);
		// Tagged as a cap, not a blow: the Battle Joy offer must not read it as blood spilled (wave 4 HP-3).
		expect(actor.update).toHaveBeenCalledWith({ "system.attributes.hp.max": 16, "system.attributes.hp.value": 16 }, { stonetopLedger: true, stonetopHpCeiling: true });
	});

	// Wave 4 HP-1: the sheet's getData used to write the computed numbers into the LIVE `system` on the
	// client that rendered it, so a comparison against `system` came out equal and nothing was stored.
	it("compares against the stored source, not numbers a render wrote into the live document", async () => {
		const { self, actor } = typed({ armor: { value: 3, unpierceable: 0 }, hp: { value: 18, max: 16 } }, { armor: 3, unpierceable: 0, maxHp: 16 });
		actor._source = { system: { attributes: { armor: { value: 2, unpierceable: 0 }, hp: { value: 18, max: 18 } } } };
		expect(await sync(self)).toBe(true);
		expect(actor.update).toHaveBeenCalledWith({
			"system.attributes.armor.value": 3,
			"system.attributes.armor.unpierceable": 0,
			"system.attributes.armor.conditional": 0,
			"system.attributes.armor.conditionalSource": "",
			"system.attributes.hp.max": 16,
			"system.attributes.hp.value": 16,
		}, { stonetopLedger: true, stonetopHpCeiling: true });
	});

	// #20: the clamp is HP lost, so it is logged, naming the Mark when one did it.
	it("files the HP a falling max takes, naming a post-death insert's Marks", async () => {
		const { self, actor } = typed({ armor: { value: 2, unpierceable: 0 }, hp: { value: 18, max: 18 } }, { armor: 2, unpierceable: 0, maxHp: 16, hpPenalty: 2 });
		self._postDeath = { activeSlug: "thrall" };
		await sync(self);
		const ledgerWrite = actor.update.mock.calls.map(([data]) => data).find(data => Object.keys(data).some(k => k.includes(".ledger.")));
		expect(Object.values(ledgerWrite).map(e => e.action))
			.toEqual(["HP changed from 18 to 16 (max HP fell to 16: the Thrall's Marks)"]);
	});

	// Another Mark taken long ago did not cause today's fall: the penalty the last max was built from
	// is the same one, so something else (a move unmarked, an arcanum's cost) lowered it.
	it("does not blame Marks that did not change since the last max was written", async () => {
		const { self, actor } = typed({ armor: { value: 2, unpierceable: 0 }, hp: { value: 18, max: 18 } },
			{ armor: 2, unpierceable: 0, maxHp: 16, hpPenalty: 2 }, { mirroredHpPenalty: 2 });
		self._postDeath = { activeSlug: "thrall" };
		await sync(self);
		const ledgerWrite = actor.update.mock.calls.map(([data]) => data).find(data => Object.keys(data).some(k => k.includes(".ledger.")));
		expect(Object.values(ledgerWrite).map(e => e.action)).toEqual(["HP changed from 18 to 16 (max HP fell to 16)"]);
	});

	it("records the penalty the max is built from, alongside the max", async () => {
		const { self, actor } = typed({ armor: { value: 2, unpierceable: 0 }, hp: { value: 9, max: 18 } }, { armor: 2, unpierceable: 0, maxHp: 16, hpPenalty: 2 });
		await sync(self);
		expect(actor.update).toHaveBeenCalledWith({ "system.attributes.hp.max": 16, "flags.stonetop-pwd.mirroredHpPenalty": 2 }, { stonetopLedger: true });
	});

	// Every owner client syncs; the one whose write arrives second changes nothing, and must not
	// file the same lost HP a second time.
	it("files nothing when its write changed nothing because another client got there first", async () => {
		const { self, actor } = typed({ armor: { value: 2, unpierceable: 0 }, hp: { value: 18, max: 18 } }, { armor: 2, unpierceable: 0, maxHp: 16 });
		actor.update = vi.fn(async () => undefined);
		await sync(self);
		expect(actor.update).toHaveBeenCalledTimes(1);
	});

	it("files a plain note when what lowered the max is not knowable", async () => {
		const { self, actor } = typed({ armor: { value: 2, unpierceable: 0 }, hp: { value: 18, max: 18 } }, { armor: 2, unpierceable: 0, maxHp: 16 });
		await sync(self);
		const ledgerWrite = actor.update.mock.calls.map(([data]) => data).find(data => Object.keys(data).some(k => k.includes(".ledger.")));
		expect(Object.values(ledgerWrite).map(e => e.action)).toEqual(["HP changed from 18 to 16 (max HP fell to 16)"]);
	});

	it("leaves HP under the new max where it is", async () => {
		const { self, actor } = typed({ armor: { value: 2, unpierceable: 0 }, hp: { value: 9, max: 18 } }, { armor: 2, unpierceable: 0, maxHp: 16 });
		await sync(self);
		expect(actor.update).toHaveBeenCalledWith({ "system.attributes.hp.max": 16 }, { stonetopLedger: true });
	});

	// Potential for Greatness raised the die to a d8 with the sheet closed: another hero's pile-on reads the
	// stored die (fight/damage-seed.js#attackerProfile), so it follows, in the vitals' own write.
	it("mirrors the damage die the character rolls in the same quiet write, and only when it differs", async () => {
		const { self, actor } = typed({ armor: { value: 2, unpierceable: 0 }, hp: { max: 18 }, damage: { value: "d6" } },
			{ armor: 2, unpierceable: 0, maxHp: 16, damage: "d8" });
		expect(await sync(self)).toBe(true);
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(actor.update).toHaveBeenCalledWith({ "system.attributes.hp.max": 16, "system.attributes.damage.value": "d8" }, { stonetopLedger: true });
		const settled = typed({ armor: { value: 2, unpierceable: 0 }, hp: { max: 18 }, damage: { value: " d8" } },
			{ armor: 2, unpierceable: 0, maxHp: 18, damage: "d8" });
		expect(await sync(settled.self)).toBe(false);
		expect(settled.actor.update).not.toHaveBeenCalled();
	});

	it("leaves the stored die alone with none to say (no playbook, no override), or from the sheet's numbers", async () => {
		const none = typed({ armor: { value: 0 }, hp: { max: 10 }, damage: { value: "d6" } }, { armor: 0, unpierceable: 0, maxHp: 0, damage: null });
		expect(await sync(none.self)).toBe(false);
		const sheet = typed({ armor: { value: 0 }, hp: { max: 10 }, damage: { value: "d6" } }, null);
		expect(await StonetopCharacter.prototype.syncStoredVitals.call(sheet.self, { armor: 0, unpierceable: 0, maxHp: 0 })).toBe(false);
	});

	it("leaves max HP alone with no playbook to derive it from", async () => {
		const { self, actor } = typed({ armor: { value: 0 }, hp: { max: 10 } }, { armor: 0, unpierceable: 0, maxHp: 0 });
		expect(await sync(self)).toBe(false);
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("writes no armor that is not a number (a custom move's bonus that is not one), but still the max HP", async () => {
		const { self, actor } = typed({ armor: { value: 2, unpierceable: 0 }, hp: { max: 18 } }, { armor: Number.NaN, unpierceable: 0, maxHp: 20 });
		await sync(self);
		expect(actor.update).toHaveBeenCalledWith({ "system.attributes.hp.max": 20 }, { stonetopLedger: true });
	});

	it("takes the numbers the sheet already worked out, rather than working them out again", async () => {
		const { self, actor } = typed({ armor: { value: 0, unpierceable: 0 }, hp: { max: 18 } }, null);
		self.computedVitals = vi.fn();
		expect(await StonetopCharacter.prototype.syncStoredVitals.call(self, { armor: 3, unpierceable: 0, maxHp: 18 })).toBe(true);
		expect(self.computedVitals).not.toHaveBeenCalled();
		expect(actor.update).toHaveBeenCalledWith({ "system.attributes.armor.value": 3, "system.attributes.armor.unpierceable": 0, "system.attributes.armor.conditional": 0, "system.attributes.armor.conditionalSource": "" }, { stonetopLedger: true });
		// null is "no snapshot": nothing to write.
		actor.update.mockClear();
		expect(await StonetopCharacter.prototype.syncStoredVitals.call(self, { armor: null, unpierceable: 0, maxHp: 0 })).toBe(false);
		expect(actor.update).not.toHaveBeenCalled();
	});
});
