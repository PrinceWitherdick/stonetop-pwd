// Loyal to the End (the Ranger's Animal Companion insert, Book I p.143) is a follower's roll, and the
// follower rules mark XP on its 6- ("If they roll a 6-, the player marks XP"). The Death's Door no-XP
// house rule is for the PC's own dying and does not reach the companion (user ruling, 2026-10-18):
// the roll goes out without `noXpOnMiss`, so rollStat's ordinary miss XP applies.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { LOYAL_TO_THE_END } from "../../../module/actors/character/companion-bond.js";

// Only the dice are stood in for: the test reads what the roll was handed.
const rollStat = vi.hoisted(() => vi.fn(async () => ({ total: 4 })));
vi.mock("../../../module/utils/roll-engine.js", async importOriginal => ({ ...(await importOriginal()), rollStat }));

function sheetFor(char, actor) {
	actor.typedActor = char;
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	return new (createStonetopCharacterSheetClass(Base))();
}

beforeEach(() => rollStat.mockClear());

describe("Loyal to the End marks XP on a 6-", () => {
	it("rolls +0 without noXpOnMiss, with advantage while the companion holds Loyalty", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-ranger", name: "The Ranger" });
		await sheetFor(char, actor)._resolveFollowerFate("roll", { name: "Bran", loyalty: 2, follower: "animal-companion", slug: "" });

		expect(rollStat).toHaveBeenCalledTimes(1);
		const options = rollStat.mock.calls[0][2];
		expect(options).toMatchObject({ statValue: 0, moveName: LOYAL_TO_THE_END, rollMode: "adv" });
		expect(options).not.toHaveProperty("noXpOnMiss");
		expect(options.moveResults.failure.value).toContain("Bran is injured");
	});

	it("rolls plain with no Loyalty, still marking XP on a miss", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-ranger", name: "The Ranger" });
		await sheetFor(char, actor)._resolveFollowerFate("roll", { name: "Bran", loyalty: 0, follower: "animal-companion", slug: "" });
		const options = rollStat.mock.calls[0][2];
		expect(options.rollMode).toBe("normal");
		expect(options.noXpOnMiss).toBeUndefined();
	});
});
