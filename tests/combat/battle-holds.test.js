import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	battleHoldsToFill, battleHoldsContent, askBattleHolds, offerBattleHolds, installBattleHolds,
	spendSurpriseForRoll, regainSurpriseOnHit, PREPARE_A_WELCOME,
} from "../../module/combat/battle-holds.js";

// The Marshal going into battle: Stentorian's "hold 2 Command" and Front Line Leader's "hold 2
// Presence" (when leading a crew in). Both tracks count what is HELD, so holding them full is max.

function marshal({ moves = ["Stentorian", "Front Line Leader"], held = {}, id = "m" } = {}) {
	const tracks = { ...held };
	const titles = { "Stentorian": "Command", "Front Line Leader": "Presence", "Prepare a Welcome": "Surprise" };
	const actor = {
		id, name: "Maddoc", type: "character",
		items: moves.map(name => ({ type: "move", name, flags: {}, system: { resource: { max: 2, title: titles[name] ?? "Hold" } } })),
		typedActor: {
			moveResources: {
				getMoveResources: () => tracks,
				setUses: vi.fn(async (move, value) => { tracks[move] = value; }),
			},
		},
	};
	return { actor, tracks };
}

let saved;
let posted;
beforeEach(() => {
	saved = { ChatMessage: globalThis.ChatMessage, document: globalThis.document };
	posted = [];
	globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: ({ actor }) => ({ alias: actor.name }) };
	globalThis.document = { createElement: () => ({}) };
});
afterEach(() => {
	globalThis.ChatMessage = saved.ChatMessage;
	globalThis.document = saved.document;
});

describe("battleHoldsToFill", () => {
	it("lists each battle hold that is not full, a fresh Marshal's included (they hold none yet)", () => {
		const { actor } = marshal({ held: { "Front Line Leader": 1 } });
		expect(battleHoldsToFill(actor)).toEqual([
			{ move: "Stentorian", title: "Command", max: 2, held: 0 },
			{ move: "Front Line Leader", title: "Presence", max: 2, held: 1 },
		]);
	});

	it("asks nothing of a track already full, or a character without the moves", () => {
		expect(battleHoldsToFill(marshal({ held: { "Stentorian": 2, "Front Line Leader": 2 } }).actor)).toEqual([]);
		expect(battleHoldsToFill(marshal({ moves: [] }).actor)).toEqual([]);
	});

	it("quotes Front Line Leader's crew clause, since the sheet cannot see it", () => {
		const { actor } = marshal({ held: { "Stentorian": 2 } });
		expect(battleHoldsContent(actor, battleHoldsToFill(actor))).toContain("if you are leading your crew into battle");
	});
});

describe("offerBattleHolds", () => {
	it("fills the ticked holds up and says so", async () => {
		const { actor, tracks } = marshal();
		const moves = await offerBattleHolds(actor, { ask: async (_a, holds) => holds.filter(h => h.move === "Stentorian") });
		expect(moves).toEqual(["Stentorian"]);
		expect(tracks).toEqual({ "Stentorian": 2 });
		expect(posted[0].content).toContain("goes into battle holding 2 Command");
	});

	it("writes nothing when they decline", async () => {
		const { actor, tracks } = marshal({ held: { "Stentorian": 1 } });
		expect(await offerBattleHolds(actor, { ask: async () => [] })).toEqual([]);
		expect(tracks).toEqual({ "Stentorian": 1 });
		expect(posted).toEqual([]);
	});
});

describe("askBattleHolds", () => {
	it("takes the ticked rows on the affirmative button, and nothing on the other", async () => {
		const { actor } = marshal();
		const holds = battleHoldsToFill(actor);
		const form = { querySelectorAll: () => [{ value: "1" }] };
		let spec;
		const DialogV2 = { wait: vi.fn(async s => { spec = s; return s.buttons[0].callback(null, { form }); }) };
		expect(await askBattleHolds(actor, holds, { DialogV2 })).toEqual([holds[1]]);
		expect(spec.buttons.map(b => b.action)).toEqual(["hold", "skip"]);
		DialogV2.wait = vi.fn(async s => s.buttons[1].callback());
		expect(await askBattleHolds(actor, holds, { DialogV2 })).toEqual([]);
		DialogV2.wait = vi.fn(async () => null);
		expect(await askBattleHolds(actor, holds, { DialogV2 })).toEqual([]);
	});
});

describe("installBattleHolds", () => {
	let savedGame;
	beforeEach(() => { savedGame = { user: globalThis.game.user, users: globalThis.game.users }; });
	afterEach(() => { globalThis.game.user = savedGame.user; globalThis.game.users = savedGame.users; });

	it("asks on the Marshal's own player's screen when they join a fight", async () => {
		let fire;
		const hooks = { on: (_name, fn) => { fire = fn; return 1; }, off: vi.fn() };
		const offer = vi.fn(async () => []);
		installBattleHolds({ hooks, offer });
		const { actor } = marshal();
		const gm = { id: "gm", isGM: true, active: true, character: null };
		const player = { id: "p1", isGM: false, active: true, character: actor };
		actor.testUserPermission = () => true;
		globalThis.game.users = [gm, player];

		globalThis.game.user = gm;
		fire({ actor });
		expect(offer).not.toHaveBeenCalled();

		globalThis.game.user = player;
		fire({ actor });
		expect(offer).toHaveBeenCalledWith(actor);
	});
});

// Prepare a Welcome: "Once battle is joined, spend 1 Surprise to reveal a ploy ... and roll +INT: on a
// 10+ ... regain 1 Surprise". Rolling it is the spend.
describe("Prepare a Welcome's Surprise", () => {
	const welcome = { name: PREPARE_A_WELCOME };
	const planner = held => marshal({ moves: [PREPARE_A_WELCOME], held: { [PREPARE_A_WELCOME]: held } });

	it("spends 1 Surprise as it is rolled, and names it on the card", async () => {
		const { actor, tracks } = planner(2);
		expect(await spendSurpriseForRoll(actor, welcome)).toBe("Spent 1 Surprise (1 left)");
		expect(tracks[PREPARE_A_WELCOME]).toBe(1);
	});

	it("still rolls with none held, and says so rather than blocking", async () => {
		const { actor, tracks } = planner(0);
		expect(await spendSurpriseForRoll(actor, welcome)).toBe("No Surprise held to spend");
		expect(tracks[PREPARE_A_WELCOME]).toBe(0);
	});

	it("regains 1 on a 10+, never past the track, and nothing on a 7-9", async () => {
		const { actor, tracks } = planner(1);
		expect(await regainSurpriseOnHit(actor, welcome, "partial")).toBe(false);
		expect(await regainSurpriseOnHit(actor, welcome, "success")).toBe(true);
		expect(tracks[PREPARE_A_WELCOME]).toBe(2);
		expect(await regainSurpriseOnHit(actor, welcome, "success")).toBe(false);
	});

	it("leaves every other move alone", async () => {
		const { actor } = planner(2);
		expect(await spendSurpriseForRoll(actor, { name: "Clash" })).toBeNull();
		expect(await regainSurpriseOnHit(actor, { name: "Clash" }, "success")).toBe(false);
	});
});
