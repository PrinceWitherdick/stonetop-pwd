import { describe, it, expect, vi } from "vitest";
import { installFightWatcher, tokenChangeCountsContact, actorChangeCountsBodies } from "../../module/fight/fight-watcher.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// What makes the fight on the map need recomputing, and what only needs redrawing.

function fakeHooks() {
	const listeners = new Map();
	let next = 0;
	return {
		listeners,
		on: (name, fn) => { const id = ++next; listeners.set(id, { name, fn }); return id; },
		off: (name, id) => { listeners.delete(id); },
		fire: (name, ...args) => { for (const { name: n, fn } of [...listeners.values()]) if (n === name) fn(...args); },
	};
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("which changes count", () => {
	it("counts a token moving, resizing, hiding or changing hands", () => {
		for (const key of ["x", "y", "width", "height", "hidden", "elevation", "level", "actorId", "actorLink", "disposition"]) {
			expect(tokenChangeCountsContact({ [key]: 1 }), key).toBe(true);
		}
		expect(tokenChangeCountsContact({ name: "Renamed", texture: {} })).toBe(false);
	});

	it("counts an actor's HP, armor or group numbers, however the change is spelled", () => {
		expect(actorChangeCountsBodies({ system: { attributes: { hp: { value: 2 } } } })).toBe(true);
		expect(actorChangeCountsBodies({ system: { count: 6 } })).toBe(true);
		expect(actorChangeCountsBodies({ "system.fightAsGroup": true })).toBe(true);
		expect(actorChangeCountsBodies({ "system.attributes.hp.value": 1 })).toBe(true);
		expect(actorChangeCountsBodies({ system: { attributes: { armor: { value: 2 } } } })).toBe(true);
		expect(actorChangeCountsBodies({ system: { attributes: { stats: { str: 2 } } } })).toBe(false);
		expect(actorChangeCountsBodies({ name: "x" })).toBe(false);
		// A parent written as one dotted key, and a path sharing only the start of a watched one.
		expect(actorChangeCountsBodies({ "system.attributes": { hp: { value: 1 } } })).toBe(true);
		expect(actorChangeCountsBodies({ system: { counter: 1 } })).toBe(false);
	});

	it("counts a character's crew or custom follower roster changing, and not their other flags", () => {
		expect(actorChangeCountsBodies({ flags: { [SYSTEM_ID]: { crew: { memberHp: [0, 6] } } } })).toBe(true);
		expect(actorChangeCountsBodies({ [`flags.${SYSTEM_ID}.customFollowers.warband.memberHp`]: [3] })).toBe(true);
		expect(actorChangeCountsBodies({ flags: { [SYSTEM_ID]: { notes: "x" } } })).toBe(false);
	});

	// FGT-7 / EDG-1: a brush with death takes a character out of the fight with no hit point changing.
	it("counts a character's Death's Door state, Unstoppable's stamp laid or lifted, and leaving play", () => {
		expect(actorChangeCountsBodies({ flags: { [SYSTEM_ID]: { deathsDoor: "dying" } } })).toBe(true);
		expect(actorChangeCountsBodies({ [`flags.${SYSTEM_ID}.deathsDoor`]: "out-of-action" })).toBe(true);
		expect(actorChangeCountsBodies({ flags: { [SYSTEM_ID]: { unstoppableFighting: true } } })).toBe(true);
		// v13 spells a lifted stamp as a deletion key.
		expect(actorChangeCountsBodies({ flags: { [SYSTEM_ID]: { "-=unstoppableFighting": null } } })).toBe(true);
		expect(actorChangeCountsBodies({ [`flags.${SYSTEM_ID}.-=unstoppableFighting`]: null })).toBe(true);
		// And a roster replaced outright, v13's `==` spelling.
		expect(actorChangeCountsBodies({ [`flags.${SYSTEM_ID}.==crew`]: { memberHp: [6] } })).toBe(true);
		expect(actorChangeCountsBodies({ flags: { [SYSTEM_ID]: { postDeathInsert: { slug: "ghost" } } } })).toBe(true);
		expect(actorChangeCountsBodies({ flags: { [SYSTEM_ID]: { leftPlay: { how: "retired" } } } })).toBe(true);
	});
});

describe("installFightWatcher", () => {
	it("recomputes once for a burst of changes, and redraws with it", async () => {
		const hooks = fakeHooks();
		const onEngagement = vi.fn();
		const onGeometry = vi.fn();
		installFightWatcher({ hooks, onEngagement, onGeometry });
		hooks.fire("updateToken", {}, { x: 100 });
		hooks.fire("updateToken", {}, { y: 100 });
		hooks.fire("createCombatant", {});
		await settle();
		expect(onEngagement).toHaveBeenCalledTimes(1);
		expect(onGeometry).toHaveBeenCalled();
	});

	it("ignores a token change that cannot change who is engaged", async () => {
		const hooks = fakeHooks();
		const onEngagement = vi.fn();
		installFightWatcher({ hooks, onEngagement });
		hooks.fire("updateToken", {}, { name: "Renamed" });
		hooks.fire("updateActor", {}, { system: { biography: "..." } });
		await settle();
		expect(onEngagement).not.toHaveBeenCalled();
	});

	it("listens to a player's targets, never a GM's", async () => {
		const hooks = fakeHooks();
		const onEngagement = vi.fn();
		installFightWatcher({ hooks, onEngagement });
		hooks.fire("targetToken", { isGM: true }, {}, true);
		await settle();
		expect(onEngagement).not.toHaveBeenCalled();
		hooks.fire("targetToken", { isGM: false }, {}, true);
		await settle();
		expect(onEngagement).toHaveBeenCalledTimes(1);
	});

	it("only redraws, without recomputing, as tokens slide and the map pans", async () => {
		const hooks = fakeHooks();
		const onEngagement = vi.fn();
		const onGeometry = vi.fn();
		installFightWatcher({ hooks, onEngagement, onGeometry });
		hooks.fire("refreshToken", {}, { refreshPosition: true });
		hooks.fire("canvasPan", {}, {});
		hooks.fire("refreshToken", {}, { refreshTooltip: true });
		await settle();
		expect(onEngagement).not.toHaveBeenCalled();
		expect(onGeometry).toHaveBeenCalledTimes(1);
	});

	it("keeps working after a callback throws", async () => {
		const hooks = fakeHooks();
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const onEngagement = vi.fn(() => { throw new Error("boom"); });
		installFightWatcher({ hooks, onEngagement });
		hooks.fire("canvasReady");
		await settle();
		hooks.fire("canvasReady");
		await settle();
		expect(onEngagement).toHaveBeenCalledTimes(2);
		error.mockRestore();
	});

	it("stops listening when told to", () => {
		const hooks = fakeHooks();
		const stop = installFightWatcher({ hooks });
		expect(hooks.listeners.size).toBeGreaterThan(0);
		stop();
		expect(hooks.listeners.size).toBe(0);
	});
});
