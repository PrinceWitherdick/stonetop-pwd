import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	FIGHT_STATES, fightStateOn, fightStateActive, setFightState, fightStateGlyph, fightStateForStem,
	shakeNervesOnMiss, revealOnAttack, WE_HAPPY_FEW,
} from "../../../module/actors/character/fight-states.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

// The three on/off states a fight turns on beside the Battle Joy: shaken nerves, the Storm Markings'
// anger, and being unseen. Their rules are enforced elsewhere (the roll path, the damage window); what
// is checked here is who has them, how they switch, and the two ways they switch on their own.

/** A character whose flags read back as Foundry's do, dotted paths and all. */
function hero({ moves = [], arcana = [], on = {}, type = "character", isOwner = true } = {}) {
	const bag = { arcana: { owned: arcana } };
	for (const [key, value] of Object.entries(on)) if (value) bag[FIGHT_STATES[key].flag] = true;
	const actor = {
		id: "h", name: "Hale", type, isOwner,
		items: moves.map(name => ({ type: "move", name, flags: {} })),
		flags: { [SYSTEM_ID]: bag },
		getFlag: (scope, path) => path.split(".").reduce((v, k) => v?.[k], actor.flags[scope]),
		setFlag: vi.fn(async (scope, key, value) => { actor.flags[scope][key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { delete actor.flags[scope][key]; }),
	};
	return actor;
}

let saved;
let posted;
beforeEach(() => {
	saved = globalThis.ChatMessage;
	posted = [];
	globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: ({ actor }) => ({ alias: actor.name }) };
});
afterEach(() => { globalThis.ChatMessage = saved; });

describe("who has them", () => {
	it("shows each glyph to whoever has its move or card", () => {
		expect(fightStateGlyph(hero({ moves: [WE_HAPPY_FEW] }), "nerves").show).toBe(true);
		expect(fightStateGlyph(hero({ arcana: ["storm-markings"] }), "roiling").show).toBe(true);
		expect(fightStateGlyph(hero({ moves: ["Catlike"] }), "unseen").show).toBe(true);
		expect(fightStateGlyph(hero({ moves: ["Stalker"] }), "unseen").show).toBe(true);
		for (const key of Object.keys(FIGHT_STATES)) expect(fightStateGlyph(hero(), key).show).toBe(false);
	});

	it("keeps a state that is still on in view on a sheet that lost what made it, so it can be put out", () => {
		expect(fightStateGlyph(hero({ on: { unseen: true } }), "unseen").show).toBe(true);
	});

	it("stops the Storm Markings' +1 once the card is gone, even with the state left on", () => {
		expect(fightStateActive(hero({ arcana: ["storm-markings"], on: { roiling: true } }), "roiling")).toBe(true);
		expect(fightStateActive(hero({ on: { roiling: true } }), "roiling")).toBe(false);
	});

	it("never counts for anyone but a character", () => {
		expect(fightStateActive(hero({ type: "npc", on: { nerves: true } }), "nerves")).toBe(false);
	});
});

describe("the glyph", () => {
	it("picks its sentences for on or off, writable or read-only", () => {
		const shaken = hero({ moves: [WE_HAPPY_FEW], on: { nerves: true } });
		expect(fightStateGlyph(shaken, "nerves", { editable: true })).toMatchObject({
			on: true, stem: "stonetop-nerves", onClass: "is-shaken",
			labelKey: "stonetop.nerves.onLabel", tooltipKey: "stonetop.nerves.onTooltip",
		});
		expect(fightStateGlyph(shaken, "nerves").tooltipKey).toBe("stonetop.nerves.readOnlyOn");
		expect(fightStateGlyph(hero({ moves: [WE_HAPPY_FEW] }), "nerves").tooltipKey).toBe("stonetop.nerves.readOnlyOff");
	});

	it("maps each stem back to its state, for the sheet's one click handler", () => {
		expect(fightStateForStem("stonetop-roiling")).toBe("roiling");
		expect(fightStateForStem("stonetop-battle-joy")).toBeNull();
	});

	it("switches, and reports only a real change", async () => {
		const hale = hero({ moves: ["Catlike"] });
		expect(await setFightState(hale, "unseen", true)).toBe(true);
		expect(fightStateOn(hale, "unseen")).toBe(true);
		expect(await setFightState(hale, "unseen", true)).toBe(false);
		expect(await setFightState(hale, "unseen", false)).toBe(true);
		expect(fightStateOn(hale, "unseen")).toBe(false);
	});
});

describe("We Happy Few's 6-", () => {
	const item = { name: WE_HAPPY_FEW };

	it("shakes the Marshal's nerves on a miss, and says so", async () => {
		const hale = hero({ moves: [WE_HAPPY_FEW] });
		expect(await shakeNervesOnMiss(hale, item, "failure")).toBe(true);
		expect(fightStateOn(hale, "nerves")).toBe(true);
		expect(posted[0].content).toContain("disadvantage on all rolls until they share their nerves");
	});

	it("leaves a hit, another move, and nerves already shaken alone", async () => {
		const hale = hero({ moves: [WE_HAPPY_FEW] });
		expect(await shakeNervesOnMiss(hale, item, "partial")).toBe(false);
		expect(await shakeNervesOnMiss(hale, { name: "Clash" }, "failure")).toBe(false);
		const shaken = hero({ moves: [WE_HAPPY_FEW], on: { nerves: true } });
		expect(await shakeNervesOnMiss(shaken, item, "failure")).toBe(false);
		expect(posted).toEqual([]);
	});
});

describe("attacking while unseen", () => {
	it("ends it, and says what gave them away", async () => {
		const hale = hero({ moves: ["Catlike"], on: { unseen: true } });
		expect(await revealOnAttack(hale, "Clash")).toBe(true);
		expect(fightStateOn(hale, "unseen")).toBe(false);
		expect(posted[0].content).toContain("attacks (Clash) and is no longer unseen");
	});

	it("says nothing for someone who was never hidden, or whose sheet this client cannot write", async () => {
		expect(await revealOnAttack(hero({ moves: ["Catlike"] }), "Clash")).toBe(false);
		expect(await revealOnAttack(hero({ on: { unseen: true }, isOwner: false }), "Clash")).toBe(false);
		expect(posted).toEqual([]);
	});
});
