import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	unstampedFightingHeavies, grandfatherUnstoppableFighting, UNSTOPPABLE_FIGHTING_SWEEP,
} from "../../module/migration/unstoppable-fighting-grandfather.js";
import { oncePerVersion } from "../../module/migration/once-per-version.js";
import { keepsFightingAtZero } from "../../module/actors/character/unstoppable.js";
import { DEATHS_DOOR_STATE } from "../../module/actors/character/deaths-door.js";
import { buildLiveCharacter, makeLiveItem, sourceMovesFor } from "../fakes/LiveCharacter.js";

// Unstoppable fights on only for a Heavy "reduced to 0 HP in battle" (Book I p.114), read at the drop, which
// now stamps `unstoppableFighting`. A Heavy already down and fighting on when the release lands has no stamp,
// and the old rule read them as fighting: they are stamped, once per WORLD.

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

/** A Heavy with Unstoppable learned, at `hp` in `state`, stamped only when `stamp` is given. */
function heavy({ id = "heavy", hp = 0, state = DEATHS_DOOR_STATE.DYING, stamp = undefined, learned = true } = {}) {
	const def = sourceMovesFor("The Heavy").find(d => d.name === "Unstoppable");
	const unstoppable = makeLiveItem({ name: "Unstoppable", type: "move", system: structuredClone(def.system) });
	const flags = {};
	if (state) flags.deathsDoor = state;
	if (stamp !== undefined) flags.unstoppableFighting = stamp;
	const built = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", items: learned ? [unstoppable] : [], flags });
	built.actor.system.attributes.hp = { value: hp, max: 20 };
	built.actor.id = id;
	return built.actor;
}

describe("stamping the Heavies already fighting on at 0 HP", () => {
	it("picks a Heavy down and dying on Unstoppable with no stamp, and nobody else", () => {
		const down = heavy({ id: "down" });
		const up = heavy({ id: "up", hp: 5, state: null });
		const outOfAction = heavy({ id: "out", state: DEATHS_DOOR_STATE.OUT_OF_ACTION });
		const stamped = heavy({ id: "stamped", stamp: true });
		const noMove = heavy({ id: "plain", learned: false });
		expect(unstampedFightingHeavies([down, up, outOfAction, stamped, noMove]).map(a => a.id)).toEqual(["down"]);
	});

	it("stamps them fighting, quietly, and never runs again in a world that has run it", async () => {
		const down = heavy({ id: "down" });
		expect(keepsFightingAtZero(down)).toBe(false);
		const update = vi.spyOn(down, "update");
		await oncePerVersion(UNSTOPPABLE_FIGHTING_SWEEP, () => grandfatherUnstoppableFighting({ actors: [down] }));
		expect(update).toHaveBeenCalledWith({ [`flags.${SCOPE}.unstoppableFighting`]: true }, { stonetopLedger: true });
		expect(keepsFightingAtZero(down)).toBe(true);

		game.system.version = "1.7.2";
		const later = heavy({ id: "later" });
		const laterUpdate = vi.spyOn(later, "update");
		await oncePerVersion(UNSTOPPABLE_FIGHTING_SWEEP, () => grandfatherUnstoppableFighting({ actors: [later] }));
		expect(laterUpdate).not.toHaveBeenCalled();
	});
});

