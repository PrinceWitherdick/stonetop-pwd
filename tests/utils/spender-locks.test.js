// Each pool's spend takes the spender's turn itself (utils/spender-queue.js), so two spends of a character's
// last point pressed at once, from two different cards, pay once between them, whoever calls the spend.

import { describe, it, expect, vi } from "vitest";
import { SYSTEM_ID } from "../../module/system-id.js";
import { spendInspiration, INSPIRATION_FLAG } from "../../module/actors/character/inspiration.js";
import { spendHeldReadiness } from "../../module/fight/follower-readiness.js";
import { takeBackHeld } from "../../module/actors/character/MoveResources.js";
import { FRONT_LINE_LEADER, spendPresence } from "../../module/actors/character/front-line-presence.js";
import { READINESS_FLAG } from "../../module/combat/defend-readiness.js";

// A write that lands a moment later, as a server round trip does: the window two unlocked reads race in.
const later = () => new Promise(resolve => setTimeout(resolve, 0));

/** A character holding `flags` on its system scope, and `tracks` on its move resources. */
function character({ flags = {}, tracks = {}, moves = [] } = {}) {
	const scoped = { ...flags };
	return {
		type: "character", uuid: `Actor.${Math.random()}`, name: "Wren",
		flags: { [SYSTEM_ID]: scoped },
		items: moves.map(name => ({ type: "move", name, system: { resource: { max: 3 } }, flags: {} })),
		getFlag: (scope, key) => scoped[key],
		setFlag: vi.fn(async (scope, key, value) => { await later(); scoped[key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { await later(); delete scoped[key]; }),
		typedActor: { moveResources: {
			getMoveResources: () => tracks,
			setUses: vi.fn(async (move, value) => { await later(); tracks[move] = value; }),
		} },
		tracks,
	};
}

describe("two spends of the last point at once", () => {
	it("Inspiration pays once", async () => {
		const wren = character({ flags: { [INSPIRATION_FLAG]: 1 } });
		expect(await Promise.all([spendInspiration(wren), spendInspiration(wren)])).toEqual([true, false]);
		expect(wren.unsetFlag).toHaveBeenCalledTimes(1);
		expect(wren.setFlag).not.toHaveBeenCalled();
	});

	it("Readiness pays once", async () => {
		const wren = character({ flags: { [READINESS_FLAG]: 1 } });
		expect(await Promise.all([spendHeldReadiness(wren, 1), spendHeldReadiness(wren, 1)])).toEqual([true, null]);
		expect(wren.setFlag).toHaveBeenCalledTimes(1);
		expect(wren.flags[SYSTEM_ID][READINESS_FLAG]).toBe(0);
	});

	it("a held track pays once", async () => {
		const wren = character({ tracks: { "Safety First": 1 }, moves: ["Safety First"] });
		expect(await Promise.all([takeBackHeld(wren, "Safety First", 1), takeBackHeld(wren, "Safety First", 1)])).toEqual([1, 0]);
		expect(wren.typedActor.moveResources.setUses).toHaveBeenCalledTimes(1);
		expect(wren.tracks["Safety First"]).toBe(0);
	});

	it("Presence pays once", async () => {
		const wren = character({ tracks: { [FRONT_LINE_LEADER]: 1 }, moves: [FRONT_LINE_LEADER] });
		expect(await Promise.all([spendPresence(wren), spendPresence(wren)])).toEqual([{ from: 1, to: 0 }, null]);
		expect(wren.typedActor.moveResources.setUses).toHaveBeenCalledTimes(1);
	});
});
