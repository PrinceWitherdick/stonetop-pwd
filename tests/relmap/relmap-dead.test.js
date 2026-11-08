import { describe, it, expect } from "vitest";
import {
	RELMAP_DEAD_CHIP, changedDeath, deadArrivalPatch, deadChipPatch, isDeadActor, seatPatch, withDeadArrivals,
} from "../../module/relmap/relmap-dead.js";
import { addNodesPatch, normalizeGraph, relmapPath } from "../../module/relmap/relmap-store.js";

// THE DEAD CHIP, PUT ON BY THE ACTOR: who counts as dead, which updates can change it, and the patches
// that put it on a newcomer or bring a whole board in line. The hook's half is relmap-faces.test.js's.

const character = (deathsDoor, insert = null) => ({
	type: "character",
	flags: { "stonetop-pwd": { deathsDoor, ...(insert ? { postDeathInsert: { slug: insert } } : {}) } },
});
const npc = status => ({ type: "npc", system: { status }, flags: {} });

describe("who is dead", () => {
	it("is a character through the Last Door, and nobody merely dying or brought back", () => {
		expect(isDeadActor(character("dead"))).toBe(true);
		expect(isDeadActor(character("dying"))).toBe(false);
		expect(isDeadActor(character(null))).toBe(false);
		// A fate still owed by somebody who took an insert is not death (`effectiveDeathsDoorState`).
		expect(isDeadActor(character("fate-pending", "ghost"))).toBe(false);
	});

	it("is an NPC whose status says Dead, however it is spelled", () => {
		expect(isDeadActor(npc("dead"))).toBe(true);
		expect(isDeadActor(npc(" Dead "))).toBe(true);
		expect(isDeadActor(npc("retired"))).toBe(false);
		expect(isDeadActor(npc(""))).toBe(false);
	});

	it("is nobody else, and nothing that cannot say", () => {
		expect(isDeadActor({ type: "monster", system: { status: "dead" } })).toBe(false);
		expect(isDeadActor(null)).toBe(false);
	});
});

describe("which updates can change it", () => {
	it("hears the Death's Door flag however it is written, and an NPC's status", () => {
		expect(changedDeath({ flags: { "stonetop-pwd": { deathsDoor: "dead" } } })).toBe(true);
		expect(changedDeath({ "flags.stonetop-pwd.deathsDoor": null })).toBe(true);
		expect(changedDeath({ "flags.stonetop-pwd.-=deathsDoor": null })).toBe(true);
		expect(changedDeath({ system: { status: "dead" } })).toBe(true);
	});

	it("ignores everything else", () => {
		expect(changedDeath({ name: "Elroy" })).toBe(false);
		expect(changedDeath({ system: { attributes: { hp: { value: 3 } } } })).toBe(false);
		expect(changedDeath(null)).toBe(false);
	});
});

describe("a dead newcomer", () => {
	const actors = { "Actor.d": character("dead"), "Actor.l": character(null) };
	const resolve = uuid => actors[uuid] ?? null;
	const arriving = { n1: { uuid: "Actor.d" }, n2: { uuid: "Actor.l" }, n3: { name: "A plain circle" } };

	it("arrives wearing Dead, the chip defined on a board that has never had it", () => {
		const patch = deadArrivalPatch(normalizeGraph({}), arriving, { resolve });
		expect(patch[relmapPath("nodes", "n1", "chips", RELMAP_DEAD_CHIP)]).toBe(true);
		expect(Object.keys(patch).some(key => key.includes(".n2.") || key.includes(".n3."))).toBe(false);
		expect(patch[relmapPath("chips", RELMAP_DEAD_CHIP, "icon")]).toBe("fa-skull");
	});

	it("leaves a board's own Dead alone (it may have been recoloured)", () => {
		const graph = normalizeGraph({ chips: { dead: { name: "Fallen", icon: "fa-ghost", ink: "slate" } } });
		const patch = deadArrivalPatch(graph, arriving, { resolve });
		expect(Object.keys(patch)).toEqual([relmapPath("nodes", "n1", "chips", RELMAP_DEAD_CHIP)]);
	});

	it("writes nothing when nobody arriving is dead", () => {
		expect(deadArrivalPatch(normalizeGraph({}), { n2: { uuid: "Actor.l" } }, { resolve })).toEqual({});
	});

	it("is part of the one write that seats them, so no seating can leave it out", () => {
		const seating = { n1: { uuid: "Actor.d", name: "D" }, n2: { uuid: "Actor.l", name: "L" } };
		const patch = seatPatch(normalizeGraph({}), seating, { resolve });
		expect(patch).toMatchObject(addNodesPatch(seating));
		expect(patch[relmapPath("nodes", "n1", "chips", RELMAP_DEAD_CHIP)]).toBe(true);
		expect(patch[relmapPath("chips", RELMAP_DEAD_CHIP, "name")]).toBeTruthy();
		// Seating only the living writes nothing about the chip.
		expect(seatPatch(normalizeGraph({}), { n2: seating.n2 }, { resolve })).toEqual(addNodesPatch({ n2: seating.n2 }));
		expect(seatPatch(normalizeGraph({}), {}, { resolve })).toEqual({});
	});

	it("is the same on a board made whole", () => {
		const graph = withDeadArrivals({ nodes: { n1: { uuid: "Actor.d", name: "D" }, n2: { uuid: "Actor.l", name: "L" } } }, { resolve });
		const read = normalizeGraph(graph);
		expect(read.nodes.n1.chips).toEqual({ dead: true });
		expect(read.nodes.n2.chips).toEqual({});
		expect(read.chips.dead).toMatchObject({ icon: "fa-skull", ink: "crimson" });
	});
});

describe("bringing a board in line with one death", () => {
	const board = normalizeGraph({
		nodes: { a: { uuid: "Actor.d", name: "D" }, b: { uuid: "Actor.d", name: "D again" }, c: { uuid: "Actor.x", name: "X", chips: { dead: true } } },
		chips: { dead: { name: "Dead", icon: "fa-skull", ink: "crimson" } },
	});

	it("puts Dead on everyone standing for them who lacks it, and touches nobody else", () => {
		const patch = deadChipPatch(board, "Actor.d", true);
		expect(Object.keys(patch).sort()).toEqual([
			relmapPath("nodes", "a", "chips", "dead"), relmapPath("nodes", "b", "chips", "dead"),
		]);
	});

	it("takes it off when they are not dead, and does nothing when nothing differs", () => {
		const off = deadChipPatch(board, "Actor.x", false);
		expect(Object.keys(off).some(key => key.includes(".c.chips."))).toBe(true);
		expect(deadChipPatch(board, "Actor.x", true)).toBeNull();
		expect(deadChipPatch(board, "Actor.d", false)).toBeNull();
	});
});
