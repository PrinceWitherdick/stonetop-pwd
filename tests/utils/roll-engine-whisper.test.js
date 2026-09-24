import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeActorBuilder } from "../fakes/FakeActorBuilder.js";
import { rollStat } from "../../module/utils/roll-engine.js";

/**
 * rollStat's `whisper`: a card for its player and the GM only, as Struggle as One posts every roll
 * until the GM shares them (Book I p.329). Core takes the mode from toMessage's SECOND argument, and
 * each core spells it differently.
 */

let calls;
const release = globalThis.game?.release;

beforeEach(() => {
	calls = [];
	global.game.settings = { get: vi.fn(() => "publicroll") };
	global.ChatMessage = { getSpeaker: vi.fn(() => ({ alias: "Aeliana" })), create: vi.fn() };
	global.Roll = class {
		constructor(formula) { this.formula = formula; this.total = 8; this.dice = [{ results: [{ result: 4 }, { result: 4 }] }]; }
		async evaluate() { return this; }
		async toMessage(data, options) { calls.push({ data, options }); }
	};
});

afterEach(() => {
	global.game.release = release;
});

const actor = () => new FakeActorBuilder().withXp(0, 8).withLevel(1).build();

describe("rollStat's whisper", () => {
	it("posts to the named users, in v14's spelling", async () => {
		global.game.release = { generation: 14 };
		await rollStat("str", actor(), { whisper: ["gm", "player-1", ""] });
		expect(calls[0].data.whisper).toEqual(["gm", "player-1"]);
		expect(calls[0].options).toEqual({ messageMode: "gm" });
	});

	it("falls back to the legacy private roll on v13", async () => {
		global.game.release = { generation: 13 };
		await rollStat("str", actor(), { whisper: ["gm"] });
		expect(calls[0].options).toEqual({ rollMode: "gmroll" });
	});

	it("leaves an ordinary roll to the table's own chat mode", async () => {
		await rollStat("str", actor());
		expect(calls[0].data.whisper).toBeUndefined();
		expect(calls[0].options).toEqual({});
	});
});
