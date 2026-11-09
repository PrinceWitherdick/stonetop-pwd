import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	settledAdjustment, mayHoldBoon, settleConsequenceBoonHp, CONSEQUENCE_BOON_HP_SWEEP, CONSEQUENCE_BOON_HP_FLAG,
} from "../../module/migration/consequence-boon-hp.js";
import { oncePerVersion } from "../../module/migration/once-per-version.js";

// Level Up audit 2026-11-06, PBB-2 / M2: the sheet now counts a marked Consequence's max HP and armor (the Redwood
// Effigy's "Gain +1 armor and +4 max HP", Book II p.571), which had to be typed in by hand before. A hand-set
// adjustment that is exactly the boon is taken back out, once per world, each character stamped; a bigger one is
// left alone and named to the GM.

const SCOPE = "stonetop-pwd";
const SETTING = "repairSweepVersions";
const realGame = globalThis.game;

let stored;
beforeEach(() => {
	stored = {};
	globalThis.game = {
		...realGame,
		system: { version: "1.7.1" },
		settings: {
			get: (_ns, key) => (key === SETTING ? stored : undefined),
			set: (_ns, key, value) => { if (key === SETTING) stored = value; return Promise.resolve(value); },
		},
	};
});
afterEach(() => { globalThis.game = realGame; });

/** A character with hand-set max HP and armor adjustments whose marked Consequences give `boonHp` and `boonArmor`. */
function character({ name = "Corvin", adjustment = 0, armorAdjustment = 0, boonHp = 0, boonArmor = 0, settled = false, type = "character" } = {}) {
	const actor = {
		type, name,
		system: { attributes: { hp: { value: 10, max: 20, adjustment }, armor: { adjustment: armorAdjustment } } },
		flags: { [SCOPE]: settled ? { [CONSEQUENCE_BOON_HP_FLAG]: true } : {} },
		typedActor: { arcanaConsequenceBoons: vi.fn(async () => ({ hp: boonHp, armor: boonArmor, versus: null })) },
		update: vi.fn(async data => {
			if ("system.attributes.hp.adjustment" in data) actor.system.attributes.hp.adjustment = data["system.attributes.hp.adjustment"];
			if ("system.attributes.armor.adjustment" in data) actor.system.attributes.armor.adjustment = data["system.attributes.armor.adjustment"];
			if (data[`flags.${SCOPE}.${CONSEQUENCE_BOON_HP_FLAG}`]) actor.flags[SCOPE][CONSEQUENCE_BOON_HP_FLAG] = true;
		}),
	};
	return actor;
}

describe("settledAdjustment", () => {
	it("takes the boon out of an adjustment that is exactly it", () => {
		expect(settledAdjustment(4, 4)).toBe(0);
		expect(settledAdjustment(1, 1)).toBe(0);
	});
	it("leaves an adjustment that can't have included it, may hold something else, or no boon at all", () => {
		expect(settledAdjustment(6, 4)).toBeNull();
		expect(settledAdjustment(2, 4)).toBeNull();
		expect(settledAdjustment(-3, 4)).toBeNull();
		expect(settledAdjustment(4, 0)).toBeNull();
	});
	it("flags one bigger than the boon for the GM to check", () => {
		expect(mayHoldBoon(6, 4)).toBe(true);
		expect(mayHoldBoon(4, 4)).toBe(false);
		expect(mayHoldBoon(6, 0)).toBe(false);
	});
});

describe("settleConsequenceBoonHp", () => {
	it("settles each character whose typed max HP or armor is its boon, stamps it, and tells the GM", async () => {
		const typed = character({ name: "Corvin", adjustment: 4, armorAdjustment: 1, boonHp: 4, boonArmor: 1 });
		const short = character({ name: "Mabyn", adjustment: 2, boonHp: 4 });
		const none  = character({ name: "Rhys", adjustment: 4, boonHp: 0 });
		const npc   = character({ type: "npc", adjustment: 4, boonHp: 4 });
		const notify = vi.fn(async () => {});
		expect(await settleConsequenceBoonHp({ actors: [typed, short, none, npc], notify })).toBe(1);
		expect(typed.system.attributes.hp.adjustment).toBe(0);
		expect(typed.system.attributes.armor.adjustment).toBe(0);
		expect(typed.update).toHaveBeenCalledWith(expect.objectContaining({ [`flags.${SCOPE}.${CONSEQUENCE_BOON_HP_FLAG}`]: true }), { stonetopLedger: true });
		for (const a of [short, none, npc]) expect(a.update).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledOnce();
		expect(notify.mock.calls[0][0]).toContain("Corvin: 4 max HP, 1 armor");
	});

	it("leaves an adjustment bigger than the boon alone and asks the GM to check it", async () => {
		const ruled = character({ name: "Wyn", adjustment: 6, boonHp: 2 });
		const notify = vi.fn(async () => {});
		expect(await settleConsequenceBoonHp({ actors: [ruled], notify })).toBe(0);
		expect(ruled.update).not.toHaveBeenCalled();
		expect(ruled.system.attributes.hp.adjustment).toBe(6);
		expect(notify.mock.calls[0][0]).toContain("Wyn: max HP typed as +6, the Consequence gives +2");
	});

	it("never reaches a stamped character, and runs once per world", async () => {
		const stamped = character({ adjustment: 4, boonHp: 4, settled: true });
		expect(await settleConsequenceBoonHp({ actors: [stamped], notify: vi.fn() })).toBe(0);
		const later = character({ adjustment: 4, boonHp: 4 });
		await oncePerVersion(CONSEQUENCE_BOON_HP_SWEEP, () => settleConsequenceBoonHp({ actors: [], notify: vi.fn() }));
		globalThis.game.system.version = "1.7.2";
		expect(await settleConsequenceBoonHp({ actors: [later], notify: vi.fn() })).toBe(0);
		expect(later.system.attributes.hp.adjustment).toBe(4);
	});
});
