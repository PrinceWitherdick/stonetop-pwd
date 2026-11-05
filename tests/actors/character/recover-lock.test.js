// Recover's lock: "You can't gain this benefit again until you take more damage" (Book I p.78, p.246).
// The character's own lift on DAMAGE only, never on HP lost or a max-HP clamp (audit ROAD-5); and each
// follower body's own lock, set by Recover and lifted when that body's HP box drops (audit ROAD-4, E10).

import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { onPreUpdateActorRecoverLock } from "../../../module/actors/character/recover-lock.js";
import { recoverableBodies, recoverLockUpdate, recoverLockedIds, recoverUnlockChanges } from "../../../module/actors/character/follower-rest.js";
import { HP_CEILING_OPTION, HP_LOSS_OPTION } from "../../../module/actors/character/StonetopFlags.js";

const SCOPE = "stonetop-pwd";

let savedSet;
beforeEach(() => {
	savedSet = foundry.utils.setProperty;
	foundry.utils.setProperty = (obj, path, value) => {
		const parts = path.split(".");
		let node = obj;
		for (const key of parts.slice(0, -1)) node = node[key] ??= {};
		node[parts.at(-1)] = value;
		return true;
	};
});
afterEach(() => { foundry.utils.setProperty = savedSet; });

function pc({ hp = 10, spent = true, flags = {} } = {}) {
	const all = { recover: { spent }, ...flags };
	return {
		type: "character",
		system: { attributes: { hp: { value: hp } } },
		flags: { [SCOPE]: all },
		getFlag: (_scope, key) => foundry.utils.getProperty(all, key),
	};
}

describe("the character's own lock", () => {
	it("lifts on damage", () => {
		const changes = { system: { attributes: { hp: { value: 6 } } } };
		onPreUpdateActorRecoverLock(pc(), changes, {});
		expect(changes.flags[SCOPE].recover.spent).toBe(false);
	});

	it("stays on HP LOST (a Vessel's Stock, Lend Strength) and on a max-HP clamp", () => {
		for (const option of [HP_LOSS_OPTION, HP_CEILING_OPTION]) {
			const changes = { system: { attributes: { hp: { value: 6 } } } };
			onPreUpdateActorRecoverLock(pc(), changes, { [option]: true });
			expect(changes.flags?.[SCOPE]?.recover?.spent).toBeUndefined();
		}
	});

	it("stays on a heal", () => {
		const changes = { system: { attributes: { hp: { value: 12 } } } };
		onPreUpdateActorRecoverLock(pc(), changes, {});
		expect(changes.flags).toBeUndefined();
	});
});

describe("a follower body's lock", () => {
	const bodies = [
		{ id: "initiate:ash", name: "Ash", row: { follower: "initiate", slug: "ash" } },
		{ id: "crew::anon:1", name: "Hari", row: { follower: "crew-member", index: 1, slug: "" } },
	];

	it("is written per body and read back by id", () => {
		const update = recoverLockUpdate(bodies);
		expect(update).toEqual({
			[`flags.${SCOPE}.recoverFollowers.initiate:ash`]: { follower: "initiate", slug: "ash" },
			[`flags.${SCOPE}.recoverFollowers.crew::anon:1`]: { follower: "crew-member", slug: "", index: 1 },
		});
		const flags = { recoverFollowers: { "initiate:ash": { follower: "initiate", slug: "ash" }, "crew::anon:1": null } };
		expect([...recoverLockedIds(flags)]).toEqual(["initiate:ash"]);
		expect(recoverableBodies(flags, bodies).map(b => b.id)).toEqual(["crew::anon:1"]);
	});

	it("lifts when that body's HP box drops, an array row included", () => {
		const actor = pc({ flags: {
			initiatesHp: { ash: 6 },
			crew: { memberHp: [5, 5, 5] },
			recoverFollowers: {
				"initiate:ash": { follower: "initiate", slug: "ash" },
				"crew::anon:1": { follower: "crew-member", slug: "", index: 1 },
			},
		} });
		const changes = { flags: { [SCOPE]: { initiatesHp: { ash: 2 }, crew: { memberHp: [5, 5, 5] } } } };
		expect(recoverUnlockChanges(actor, changes)).toEqual(["initiate:ash"]);
		expect(changes.flags[SCOPE].recoverFollowers["initiate:ash"]).toBeNull();
		const blow = { flags: { [SCOPE]: { crew: { memberHp: [5, 1, 5] } } } };
		onPreUpdateActorRecoverLock(actor, blow, {});
		expect(blow.flags[SCOPE].recoverFollowers["crew::anon:1"]).toBeNull();
	});

	it("stays while the box rises or isn't written", () => {
		const actor = pc({ flags: { initiatesHp: { ash: 6 }, recoverFollowers: { "initiate:ash": { follower: "initiate", slug: "ash" } } } });
		const heal = { flags: { [SCOPE]: { initiatesHp: { ash: 8 } } } };
		expect(recoverUnlockChanges(actor, heal)).toEqual([]);
		expect(recoverUnlockChanges(actor, { flags: { [SCOPE]: { notes: "x" } } })).toEqual([]);
	});
});
