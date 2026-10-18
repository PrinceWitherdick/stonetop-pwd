import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rollHazardDamage } from "../../module/combat/attack-flow.js";

// A hazard's damage (Book I, Dangers p.383) on the SHARED damage card: the tags ride a nameless weapon
// record, the one thing Apply reads armor and piercing off, and nobody is recorded as having struck.

const SCOPE = "stonetop-pwd";
let created;

beforeEach(() => {
	created = [];
	globalThis.Roll = class {
		constructor(formula) { this.formula = formula; }
		async evaluate() { this.total = 7; this.dice = []; return this; }
	};
	globalThis.CONST = { TOKEN_DISPOSITIONS: { FRIENDLY: 1, NEUTRAL: 0, HOSTILE: -1 } };
	globalThis.ChatMessage = {
		create: vi.fn(async (data) => { created.push(data); return data; }),
		getSpeaker: () => { throw new Error("a hazard has no actor to speak for it"); },
	};
	globalThis.game = { ...globalThis.game, user: { isGM: true, targets: new Set() }, settings: { get: () => "roll" } };
});

afterEach(() => {
	delete globalThis.Roll;
	delete globalThis.ChatMessage;
	delete globalThis.CONST;
	delete globalThis.Dialog;
});

const card = () => created.at(-1);
const flag = () => card()?.flags?.[SCOPE]?.damage;
const VAHID = { uuid: "Scene.s.Token.v", name: "Vahid", actorId: "vahid", disposition: 0, hasActor: true };
const NEST = { name: "Crinwin nest", formula: "1d8+2", ignoresArmor: false, piercing: 3, tags: ["3 piercing", "messy", "forceful"] };

describe("rollHazardDamage", () => {
	it("posts the shared damage card at its targets, armor clause on the weapon Apply reads", async () => {
		const results = await rollHazardDamage(NEST, { targets: [VAHID], shiftKey: true });
		expect(results.map(r => r.raw)).toEqual([7]);
		expect(flag().results[0]).toMatchObject({ uuid: "Scene.s.Token.v", name: "Vahid", raw: 7 });
		expect(flag().weapon).toEqual({ name: "", piercing: 3, ignoresArmor: false });
		expect(card().content).toContain("Apply damage");
		// The tags' fiction (messy, forceful) on the card, and the line's tags in each row's fine print.
		expect(card().content).toContain("stonetop-attack-forceful");
		expect(card().content).toContain("3 piercing");
	});

	it("speaks as the hazard and records nobody as having struck", async () => {
		await rollHazardDamage({ ...NEST, ignoresArmor: true }, { targets: [VAHID], shiftKey: true });
		expect(card().speaker).toEqual({ alias: "Crinwin nest" });
		expect(card().content).toContain("Crinwin nest: damage");
		expect(flag().attackerUuid).toBe("");
		expect(flag().weapon.ignoresArmor).toBe(true);
	});

	it("rolls the number alone, with no Apply, when it catches nobody", async () => {
		const results = await rollHazardDamage(NEST, { targets: [], shiftKey: true });
		expect(results).toEqual([expect.objectContaining({ raw: 7 })]);
		expect(card().content).not.toContain("Apply damage");
	});

	it("asks off-guard and precautions every time, both unticked, whatever the window setting", async () => {
		// The client setting says not to ask; p.383's judgement asks anyway.
		globalThis.game.settings = { get: () => false };
		let data;
		globalThis.Dialog = vi.fn(function (d) { data = d; this.render = vi.fn(); });
		const pending = rollHazardDamage(NEST, { targets: [VAHID] });
		await vi.waitFor(() => expect(globalThis.Dialog).toHaveBeenCalled());
		expect(data.content).toContain("It caught them off-guard: roll with advantage");
		expect(data.content).toContain("took precautions: roll with disadvantage");
		expect(data.content).not.toMatch(/name="offer-hazardOffGuard" checked/);
		expect(data.content).not.toMatch(/name="offer-hazardPrecautions" checked/);
		// Cancelled: nothing is rolled.
		data.close();
		expect(await pending).toBeNull();
		expect(created).toHaveLength(0);
	});

	it("rolls nothing without a formula", async () => {
		expect(await rollHazardDamage({ name: "Fog" }, { targets: [VAHID], shiftKey: true })).toBeNull();
		expect(created).toHaveLength(0);
	});
});
