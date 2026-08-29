import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { supplyPursesFor, SUPPLY_PURPOSE } from "../../../module/actors/character/supply-cost.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";

/**
 * MAKE CAMP (Book I p.334). The bill and the spill are supply-cost.js's, and tested there; what
 * is tested here is what the MOVE does with them — who gets fed, what a fed camp buys, and the
 * one rule that is easy to get backwards: an unfed camp takes no benefit at all (p.335).
 */

function makeActor() {
	const actor = {
		name: "Aeliana",
		type: "character",
		system: { attributes: { hp: { value: 4, max: 15 } } },
		apps: {},
		flags: {},
		getFlag: vi.fn(() => ({})),
		update: vi.fn(async () => {}),
	};
	// The move batches everything it changes into ONE actor.update, so what it asks the character
	// for is update FRAGMENTS rather than writes. These mirror the real flag paths on
	// StonetopCharacter, so the assertions below read the write that actually lands.
	actor.typedActor = {
		inventoryResourceData: (slug, count) => ({ [resourcePath(slug)]: count }),
		rollModeData: (rollMode) => ({ [ROLL_MODE_PATH]: rollMode }),
	};
	return actor;
}

const resourcePath   = slug => `flags.${STONETOP_SCOPE}.inventory.resources.${slug}`;
const ROLL_MODE_PATH = `flags.${STONETOP_SCOPE}.rollMode`;

/**
 * The data of the one update the move lands - and proof that it IS one. A camp feeds from up to
 * five purses, heals, clears a debility and sets the night's advantage; each of those written on
 * its own would be a document write and a full sheet rebuild apiece, with half a camp left on the
 * sheet if one of them failed.
 */
function written(actor) {
	expect(actor.update).toHaveBeenCalledTimes(1);
	expect(actor.update.mock.calls[0][1]).toEqual({ stonetopMove: "Make Camp" });
	return actor.update.mock.calls[0][0];
}

function makeSheet(actor) {
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
		async _onDropItemCreate() {}
	};
	const sheet = new (createStonetopCharacterSheetClass(Base))();
	sheet._stonetopCharacter = actor.typedActor;
	return sheet;
}

// hp 4/15 → ½ max rounds UP to 8, so a fed HP pick takes them to 12.
const HP = { value: 4, max: 15 };
const HALF_MAX = 8;

function camp(carried) {
	return supplyPursesFor(carried, SUPPLY_PURPOSE.CAMP);
}

/** The arguments the dialog's confirm button hands over, with this test's defaults filled in. */
function campArgs(overrides = {}) {
	return {
		purses: camp({ supplies: 4 }), hp: HP, halfMax: HALF_MAX, debilities: [],
		people: 1, ...overrides,
	};
}

let rolled;

beforeEach(() => {
	rolled = 3;
	global.Roll = class {
		constructor(formula) { this.formula = formula; }
		async evaluate() { this.total = rolled; return this; }
		async toMessage() {}
	};
	global.ChatMessage = { create: vi.fn(), getSpeaker: vi.fn(() => ({})) };
});

afterEach(() => {
	delete global.Roll;
	delete global.ChatMessage;
});

// ── feeding the camp ─────────────────────────────────────────────────────────

describe("Make Camp — feeding the camp", () => {
	it("spends one use a head out of the supplies row", async () => {
		const actor = makeActor();
		await makeSheet(actor)._applyMakeCamp(campArgs({ people: 3 }));
		expect(written(actor)[resourcePath("supplies")]).toBe(1);
	});

	// "1 use can provide for up to four people" — the whole reason to haul a mess kit.
	it("stretches one use over four with a mess kit", async () => {
		const actor = makeActor();
		await makeSheet(actor)._applyMakeCamp(campArgs({ people: 4, messKit: true }));
		expect(written(actor)[resourcePath("supplies")]).toBe(3);
	});

	// The move provisions exist for (Book I p.89): at camp they are supplies, 1-for-1.
	it("eats the larder when provisions are what the player picked", async () => {
		const actor = makeActor();
		await makeSheet(actor)._applyMakeCamp(campArgs({
			purses: camp({ supplies: 4, provisions: 5 }), people: 2, preferred: "provisions",
		}));
		expect(written(actor)[resourcePath("provisions")]).toBe(3);
		expect(written(actor)).not.toHaveProperty(resourcePath("supplies"));
	});

	it("spills onto the supplies rows when the larder cannot cover the night", async () => {
		const actor = makeActor();
		await makeSheet(actor)._applyMakeCamp(campArgs({
			purses: camp({ supplies: 4, provisions: 2 }), people: 5, preferred: "provisions",
		}));
		expect(written(actor)[resourcePath("provisions")]).toBe(0);
		expect(written(actor)[resourcePath("supplies")]).toBe(1);
	});
});

// ── what a fed camp buys ─────────────────────────────────────────────────────

describe("Make Camp — the benefit", () => {
	// "Regain HP equal to ½ your max." Halves round UP: 15 → 8, not 7.
	it("regains half your max HP, rounded up", async () => {
		const actor = makeActor();
		await makeSheet(actor)._applyMakeCamp(campArgs({ benefit: "hp" }));
		expect(written(actor)["system.attributes.hp.value"]).toBe(12);
	});

	it("never heals past max", async () => {
		const actor = makeActor();
		await makeSheet(actor)._applyMakeCamp(campArgs({ hp: { value: 14, max: 15 }, benefit: "hp" }));
		expect(written(actor)["system.attributes.hp.value"]).toBe(15);
	});

	it("clears the chosen debility instead, when that is the pick", async () => {
		const actor = makeActor();
		await makeSheet(actor)._applyMakeCamp(campArgs({
			benefit: "debility", debility: "dazed",
			debilities: [{ key: "weakened", name: "Weakened" }, { key: "dazed", name: "Dazed" }],
		}));
		expect(written(actor)["system.attributes.debilities.options.dazed.value"]).toBe(false);
	});

	// The bedroll's printed "recover 1d6 extra HP when you Make Camp" — extra, so it stacks on
	// the ½-max pick rather than replacing it. 4 + 8 + a rolled 3 = 15.
	it("adds the bedroll's 1d6 on top of the HP pick", async () => {
		const actor = makeActor();
		rolled = 3;
		await makeSheet(actor)._applyMakeCamp(campArgs({ benefit: "hp", bedroll: true }));
		expect(written(actor)["system.attributes.hp.value"]).toBe(15);
	});

	it("sets the sheet's advantage when the night was peaceful", async () => {
		const actor = makeActor();
		await makeSheet(actor)._applyMakeCamp(campArgs({ peaceful: true }));
		expect(written(actor)[ROLL_MODE_PATH]).toBe("adv");
	});
});

// ── deprivation ──────────────────────────────────────────────────────────────

describe("Make Camp — an unfed camp", () => {
	// Book I p.335: "If PCs don't get food, drink, or rest, then at first the only consequence is
	// that they don't get to make a choice when they Make Camp." So a camp that cannot pay its own
	// bill takes NO benefit — not the HP, not the debility, not the bedroll, not the advantage.
	it("takes no benefit at all when the bill cannot be paid", async () => {
		const actor = makeActor();
		await makeSheet(actor)._applyMakeCamp(campArgs({
			purses: camp({ supplies: 1 }), people: 4, benefit: "hp", bedroll: true, peaceful: true,
		}));
		// What it had is still spent (the test below); what an unfed camp must not carry is any
		// part of the benefit, so the one write holds the spend and nothing else.
		expect(Object.keys(written(actor))).toEqual([resourcePath("supplies")]);
	});

	it("still spends everything it had before going short", async () => {
		const actor = makeActor();
		await makeSheet(actor)._applyMakeCamp(campArgs({ purses: camp({ supplies: 1 }), people: 4 }));
		expect(written(actor)[resourcePath("supplies")]).toBe(0);
	});

	// Nobody eating from THIS pack is not the same as going hungry: a character whose share was
	// covered by someone else still rests, and still picks.
	it("rests fine when nobody is eating out of this pack", async () => {
		const actor = makeActor();
		await makeSheet(actor)._applyMakeCamp(campArgs({ people: 0, benefit: "hp" }));
		expect(written(actor)).toEqual({ "system.attributes.hp.value": 12 });
	});
});
