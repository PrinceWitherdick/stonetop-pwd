import { describe, it, expect, onTestFinished } from "vitest";
import { inBattle } from "../../module/fight/in-battle.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// "Is this character in a fight": any combat in the world with them standing in it on a map.

describe("inBattle", () => {
	const wren = { id: "wren" };

	it("counts a character standing in any combat, by actor id, a linked token's or a synthetic one's", () => {
		expect(inBattle(wren, [{ combatants: [{ actorId: "wren", tokenId: "t1" }] }])).toBe(true);
		expect(inBattle(wren, [{ combatants: [{ actor: { id: "wren" }, tokenId: "t1" }] }])).toBe(true);
		expect(inBattle(wren, [{ combatants: [{ actorId: "bram", tokenId: "t2" }] }])).toBe(false);
		expect(inBattle(wren, [])).toBe(false);
		expect(inBattle(null, [{ combatants: [{ actorId: "wren", tokenId: "t1" }] }])).toBe(false);
	});

	// FGT-5: the old Character Introductions left a roster Combat in the world, every character added by actor
	// alone. Counted, it put every character "in battle" for good (Unstoppable fought on after a trap).
	it("does not count a combatant with no token: the old Introductions roster is not a fight", () => {
		const roster = { combatants: [{ actorId: "wren", tokenId: null }, { actorId: "bram" }] };
		expect(inBattle(wren, [roster])).toBe(false);
		expect(inBattle(wren, [roster, { combatants: [{ actorId: "wren", tokenId: "t1" }] }])).toBe(true);
		// Dropped into a fight by actor alone (the old window joined whatever Combat was running): still no token.
		expect(inBattle(wren, [{ combatants: [{ actorId: "bram", tokenId: "t2" }, { actorId: "wren", tokenId: null }] }])).toBe(false);
	});

	// With the Fight tab on, every new Combat is stamped; one already running when the tab was turned on is not,
	// and is still the fight its characters are in (Unstoppable, Inspiration's "once battle is joined").
	it("with the Fight tab on, counts a stamped fight and a Combat that was running before the tab was", () => {
		const settings = globalThis.game.settings;
		onTestFinished(() => { globalThis.game.settings = settings; });
		globalThis.game.settings = { get: (_scope, key) => key === "fightTab" };
		const combatants = [{ actorId: "wren", tokenId: "t1" }];
		expect(inBattle(wren, [{ combatants }])).toBe(true);
		expect(inBattle(wren, [{ flags: { [SYSTEM_ID]: { fight: { v: 1 } } }, combatants }])).toBe(true);
		expect(inBattle(wren, [{ combatants: [{ actorId: "wren", tokenId: null }] }])).toBe(false);
	});
});
