import { describe, it, expect, vi } from "vitest";
import {
	ARCANA_AUDIT_1104_OPTION, ARCANA_AUDIT_1104_SETTLES, AUDIT_SETTLES_KEY, arcanaAudit1104Update,
	onPreCreateActorAudit1104, onPreUpdateActorAudit1104, settleAllArcanaAudit1104, settleArcanaAudit1104,
	settleOwnArcanaAudit1104,
} from "../../module/migration/arcana-audit-1104.js";
import { BEFORE_OPTION } from "../../module/timeline/timeline-watch.js";
import { STONETOP_SCOPE } from "../../module/actors/character/StonetopFlags.js";

// The mummified hand's three crystals (Book II p.536) and the blade's Blaze / Silver Branch starting
// ticked (pp.534, 538): each character's stored counts move once, and the markers that say so land in
// the same write.

const ALL_MARKERS = Object.fromEntries(ARCANA_AUDIT_1104_SETTLES.map(c => [c.marker, true]));

/** A character whose `update` applies dotted flag paths to its own bag (MERGING objects, as Foundry does). */
function character({ arcana = {}, inventory = {}, isOwner = true, type = "character" } = {}) {
	const bag = { arcana: structuredClone(arcana), inventory: structuredClone(inventory) };
	const actor = {
		type, isOwner,
		flags: { [STONETOP_SCOPE]: bag },
		getFlag(scope, path) {
			if (scope !== STONETOP_SCOPE) return undefined;
			return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), bag);
		},
		update: vi.fn(async (data) => {
			for (const [path, value] of Object.entries(data)) {
				const keys = path.replace(`flags.${STONETOP_SCOPE}.`, "").split(".");
				const last = keys.pop();
				const parent = keys.reduce((o, k) => (o[k] ??= {}), bag);
				parent[last] = value && typeof value === "object" && !Array.isArray(value) ? { ...(parent[last] ?? {}), ...value } : value;
			}
		}),
	};
	actor.updateSource = vi.fn(data => actor.update(data));
	return actor;
}
const bagOf = actor => actor.flags[STONETOP_SCOPE];

describe("arcanaAudit1104Update / settleArcanaAudit1104", () => {
	it("raises the hand's old whole-step 1 to 3, and steps Blaze and the Silver Branch back by one", async () => {
		const pc = character({
			arcana: { unlock: { "mummified-hand:soak-crystal": 1, "mummified-hand:learn-name": 1, "x:y": 1 } },
			inventory: { resources: { "rusty-steel-blade": 3, "treasure-map": 1, "other": 2 } },
		});
		expect(await settleArcanaAudit1104(pc)).toBe(true);
		expect(pc.update).toHaveBeenCalledTimes(1);
		const [, options] = pc.update.mock.calls[0];
		expect(options).toMatchObject({ stonetopLedger: true, [ARCANA_AUDIT_1104_OPTION]: true });
		expect(bagOf(pc).arcana.unlock).toEqual({ "mummified-hand:soak-crystal": 3, "mummified-hand:learn-name": 1, "x:y": 1 });
		expect(bagOf(pc).inventory.resources).toEqual({ "rusty-steel-blade": 2, "treasure-map": 0, "other": 2 });
		expect(bagOf(pc).arcana[AUDIT_SETTLES_KEY]).toEqual(ALL_MARKERS);
	});

	it("does nothing twice: a second settle finds the markers", async () => {
		const pc = character({ inventory: { resources: { "rusty-steel-blade": 5 } } });
		await settleArcanaAudit1104(pc);
		expect(await settleArcanaAudit1104(pc)).toBe(false);
		expect(bagOf(pc).inventory.resources["rusty-steel-blade"]).toBe(4);
		expect(pc.update).toHaveBeenCalledTimes(1);
	});

	it("leaves a 0, a missing count and a hand count other than 1 alone, but still stamps", async () => {
		const pc = character({
			arcana: { unlock: { "mummified-hand:soak-crystal": 0 } },
			inventory: { resources: { "rusty-steel-blade": 0 } },
		});
		const data = arcanaAudit1104Update(pc);
		expect(Object.keys(data)).toEqual([`flags.${STONETOP_SCOPE}.arcana.${AUDIT_SETTLES_KEY}`]);
		await settleArcanaAudit1104(pc);
		// A count written after the stamp is a new-card count and is never moved.
		bagOf(pc).inventory.resources["treasure-map"] = 1;
		bagOf(pc).arcana.unlock["mummified-hand:soak-crystal"] = 1;
		expect(await settleArcanaAudit1104(pc)).toBe(false);
		expect(bagOf(pc).inventory.resources["treasure-map"]).toBe(1);
		expect(bagOf(pc).arcana.unlock["mummified-hand:soak-crystal"]).toBe(1);
	});

	it("settles only the changes a character has not had yet", async () => {
		const [first] = ARCANA_AUDIT_1104_SETTLES;
		const done = Object.fromEntries(ARCANA_AUDIT_1104_SETTLES.filter(c => c !== first).map(c => [c.marker, true]));
		const pc = character({
			arcana: { unlock: { "mummified-hand:soak-crystal": 1 }, [AUDIT_SETTLES_KEY]: done },
			inventory: { resources: { "rusty-steel-blade": 2 } },
		});
		await settleArcanaAudit1104(pc);
		expect(bagOf(pc).arcana.unlock["mummified-hand:soak-crystal"]).toBe(3);
		expect(bagOf(pc).inventory.resources["rusty-steel-blade"]).toBe(2);
		expect(bagOf(pc).arcana[AUDIT_SETTLES_KEY]).toEqual(ALL_MARKERS);
	});

	it("passes over anything that is not a character", async () => {
		const npc = character({ type: "npc", inventory: { resources: { "rusty-steel-blade": 2 } } });
		expect(await settleArcanaAudit1104(npc)).toBe(false);
		expect(npc.update).not.toHaveBeenCalled();
	});
});

describe("the sweeps", () => {
	it("the GM's covers every character and counts the writes", async () => {
		const actors = [character(), character({ type: "npc" }), character()];
		expect(await settleAllArcanaAudit1104({ actors })).toBe(2);
		expect(await settleAllArcanaAudit1104({ actors })).toBe(0);
	});

	it("a player's covers only the characters they own", async () => {
		const mine = character();
		const theirs = character({ isOwner: false });
		expect(await settleOwnArcanaAudit1104({ actors: [mine, theirs] })).toBe(1);
		expect(theirs.update).not.toHaveBeenCalled();
	});
});

describe("the hooks", () => {
	it("stamps a new character on the way in, and settles an old export", () => {
		const fresh = character();
		onPreCreateActorAudit1104(fresh);
		expect(bagOf(fresh).arcana[AUDIT_SETTLES_KEY]).toEqual(ALL_MARKERS);

		const old = character({ inventory: { resources: { "treasure-map": 2 } } });
		onPreCreateActorAudit1104(old);
		expect(bagOf(old).inventory.resources["treasure-map"]).toBe(1);

		const copy = character({ arcana: { [AUDIT_SETTLES_KEY]: ALL_MARKERS }, inventory: { resources: { "treasure-map": 2 } } });
		onPreCreateActorAudit1104(copy);
		expect(copy.updateSource).not.toHaveBeenCalled();
	});

	it("keeps the settle's own write off the timeline, and nobody else's", () => {
		const settle = { [ARCANA_AUDIT_1104_OPTION]: true, [BEFORE_OPTION]: { snapshot: 1 } };
		onPreUpdateActorAudit1104(null, {}, settle);
		expect(BEFORE_OPTION in settle).toBe(false);
		const other = { [BEFORE_OPTION]: { snapshot: 1 } };
		onPreUpdateActorAudit1104(null, {}, other);
		expect(other[BEFORE_OPTION]).toEqual({ snapshot: 1 });
	});
});
