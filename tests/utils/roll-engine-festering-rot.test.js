import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeActorBuilder } from "../fakes/FakeActorBuilder.js";

// TH-2: a Thrall's A FESTERING ROT, "When you roll doubles, something on your person is ruined. The GM
// will tell you what, and how." (Book I p.153). A note on the card when the two KEPT dice match; the die
// advantage or disadvantage dropped neither makes nor breaks the pair (the user's ruling, 2026-10-27).

const remind = vi.hoisted(() => vi.fn(async () => false));
vi.mock("../../module/actors/character/WouldBeHeroAsterisk.js", () => ({ maybeRemindPotentialForGreatness: remind }));

const { rollStat, keptDoubles } = await import("../../module/utils/roll-engine.js");

let calls;
let faces;
beforeEach(() => {
	calls = [];
	faces = [{ result: 4 }, { result: 4 }];
	global.game.settings = { get: vi.fn(() => "publicroll") };
	global.ChatMessage = { getSpeaker: vi.fn(() => ({ alias: "Vess" })), create: vi.fn() };
	global.Roll = class {
		constructor(formula) { this.formula = formula; this.total = 8; this.dice = [{ results: faces }]; }
		async evaluate() { return this; }
		async toMessage(data) { calls.push(data); return { id: "card-1" }; }
	};
});

const thrall = (marked = true) => new FakeActorBuilder().withXp(0, 8).withLevel(1)
	.withFlags({ "postDeathInsert.slug": "thrall", "postDeathLore.counts": { "marks:a-festering-rot": marked ? 1 : 0 } })
	.build();

describe("keptDoubles", () => {
	it("reads the two kept dice only", () => {
		expect(keptDoubles({ dice: [{ results: [{ result: 3 }, { result: 3 }] }] })).toBe(true);
		expect(keptDoubles({ dice: [{ results: [{ result: 3 }, { result: 5 }] }] })).toBe(false);
		// 3d6kh2: the dropped 3 makes no pair with the kept one, and the kept 5s are a pair.
		expect(keptDoubles({ dice: [{ results: [{ result: 3, active: false, discarded: true }, { result: 3 }, { result: 5 }] }] })).toBe(false);
		expect(keptDoubles({ dice: [{ results: [{ result: 2, active: false, discarded: true }, { result: 5 }, { result: 5 }] }] })).toBe(true);
		// A total given rather than rolled ("as if you rolled a 12+") has no dice.
		expect(keptDoubles({ dice: [] })).toBe(false);
	});
});

describe("A Festering Rot on the roll card", () => {
	it("notes doubles for a Thrall with the Mark", async () => {
		await rollStat("wis", thrall(), { moveName: "Defy Danger" });
		expect(calls[0].flavor).toContain("stonetop-roll-festering-notice");
		expect(calls[0].flavor).toContain("something on your person is ruined");
	});

	it("says nothing without doubles, or without the Mark", async () => {
		faces = [{ result: 4 }, { result: 5 }];
		await rollStat("wis", thrall(), { moveName: "Defy Danger" });
		faces = [{ result: 4 }, { result: 4 }];
		await rollStat("wis", thrall(false), { moveName: "Defy Danger" });
		expect(calls.map(c => c.flavor).some(f => f.includes("stonetop-roll-festering-notice"))).toBe(false);
	});
});
