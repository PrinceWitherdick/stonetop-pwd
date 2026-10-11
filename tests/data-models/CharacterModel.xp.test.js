import { describe, it, expect, beforeAll } from "vitest";

// Nobody owes XP. A negative total typed on the sheet used to be stored as typed, and the next mark
// through adjustXp floored it at 0 first, so a +1 from -3 landed as +4.

let CharacterModel, clampNegativeXp;

beforeAll(async () => {
	globalThis.foundry ??= {};
	foundry.data ??= {};
	foundry.data.fields ??= new Proxy({}, { get: () => class { constructor(...args) { this.args = args; } } });
	foundry.abstract ??= {};
	foundry.abstract.TypeDataModel ??= class {};
	({ CharacterModel, clampNegativeXp } = await import("../../module/data-models/CharacterModel.js"));
});

describe("a negative XP total", () => {
	it("is written as 0, in either shape an update arrives in", () => {
		expect(clampNegativeXp({ system: { attributes: { xp: { value: -3 } } } }).system.attributes.xp.value).toBe(0);
		expect(clampNegativeXp({ "system.attributes.xp.value": -1 })["system.attributes.xp.value"]).toBe(0);
	});

	it("leaves a real total, and an update that does not touch XP, alone", () => {
		expect(clampNegativeXp({ system: { attributes: { xp: { value: 5 } } } }).system.attributes.xp.value).toBe(5);
		expect(clampNegativeXp({ name: "Wren" })).toEqual({ name: "Wren" });
		expect(clampNegativeXp(null)).toBeNull();
	});

	it("is clamped on the way into the document", async () => {
		const changes = { system: { attributes: { xp: { value: -2 } } } };
		await CharacterModel.prototype._preUpdate.call({}, changes, {}, null);
		expect(changes.system.attributes.xp.value).toBe(0);
	});
});
