import { describe, it, expect, vi } from "vitest";
import { monsterTokenSizeUpdate, sizeMonsterTokens, MONSTER_TOKEN_SIZE_SWEEP } from "../../module/migration/monster-token-size.js";
import { oncePerVersion } from "../../module/migration/once-per-version.js";

// A world's large and huge monsters were made with 1x1 prototype tokens. They grow to 2x2 and 3x3,
// but only while still 1x1, and only the prototype: tokens already on a scene are left as placed.

const monster = (size, token = {}) => ({ type: "monster", name: size || "medium", system: { size }, prototypeToken: { width: 1, height: 1, ...token } });

describe("monsterTokenSizeUpdate", () => {
	it("grows a large monster to 2x2 and a huge one to 3x3", () => {
		expect(monsterTokenSizeUpdate(monster("large"))).toEqual({ "prototypeToken.width": 2, "prototypeToken.height": 2 });
		expect(monsterTokenSizeUpdate(monster("huge"))).toEqual({ "prototypeToken.width": 3, "prototypeToken.height": 3 });
		// A token with no footprint recorded is the default 1x1.
		expect(monsterTokenSizeUpdate({ type: "monster", system: { size: "huge" }, prototypeToken: {} }))
			.toEqual({ "prototypeToken.width": 3, "prototypeToken.height": 3 });
	});

	it("leaves tiny, small and medium creatures at one square", () => {
		for (const size of ["tiny", "small", ""]) expect(monsterTokenSizeUpdate(monster(size))).toBeNull();
	});

	it("leaves a footprint somebody already set, and anything that is not a monster", () => {
		expect(monsterTokenSizeUpdate(monster("large", { width: 4, height: 4 }))).toBeNull();
		expect(monsterTokenSizeUpdate(monster("huge", { width: 2, height: 2 }))).toBeNull();
		expect(monsterTokenSizeUpdate({ ...monster("large"), type: "npc" })).toBeNull();
	});
});

describe("sizeMonsterTokens", () => {
	it("writes each monster that needs it, once, and touches nothing else", async () => {
		const big = { ...monster("huge"), update: vi.fn(async () => {}) };
		const small = { ...monster("small"), update: vi.fn(async () => {}) };
		expect(await sizeMonsterTokens({ actors: [big, small] })).toBe(1);
		expect(big.update).toHaveBeenCalledWith({ "prototypeToken.width": 3, "prototypeToken.height": 3 });
		expect(small.update).not.toHaveBeenCalled();
	});

	it("writes the rest when one refuses, then throws so the sweep is tried again", async () => {
		const broken = { ...monster("large"), name: "Broken", update: vi.fn(async () => { throw new Error("locked"); }) };
		const fine = { ...monster("large"), name: "Fine", update: vi.fn(async () => {}) };
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(sizeMonsterTokens({ actors: [broken, fine] })).rejects.toThrow(/Broken/);
		expect(fine.update).toHaveBeenCalled();
		spy.mockRestore();
	});

	// Once per WORLD: after the first sweep a 1x1 large monster is a GM's choice, so the next
	// version's run leaves it.
	it("runs once per world, not again under a later version", async () => {
		const realGame = globalThis.game;
		let stored = {};
		const world = version => ({
			...realGame,
			system: { version },
			settings: {
				get: (_ns, key) => (key === "repairSweepVersions" ? stored : undefined),
				set: (_ns, key, value) => { if (key === "repairSweepVersions") stored = value; return Promise.resolve(value); },
			},
		});
		try {
			globalThis.game = world("1.7.1");
			const first = { ...monster("large"), update: vi.fn(async () => {}) };
			await oncePerVersion(MONSTER_TOKEN_SIZE_SWEEP, () => sizeMonsterTokens({ actors: [first] }));
			expect(first.update).toHaveBeenCalledTimes(1);

			globalThis.game = world("1.8.0");
			const setBack = { ...monster("large"), update: vi.fn(async () => {}) };
			await oncePerVersion(MONSTER_TOKEN_SIZE_SWEEP, () => sizeMonsterTokens({ actors: [setBack] }));
			expect(setBack.update).not.toHaveBeenCalled();
		} finally {
			globalThis.game = realGame;
		}
	});
});
