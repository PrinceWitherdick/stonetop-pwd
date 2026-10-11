// Send Them Back (the Ring of Daagon's servants, roll +CHA) is a +CHA roll like any other, so a
// marked Miserable puts it at disadvantage (Book I p.241: "disadvantage when rolling +CON or +CHA").
// Wounds audit #4: the sheet rolled it straight through rollStat, around the one seam every debility
// reaches a roll by (StonetopCharacter#applyDebilityRollMode), so it went out clean.
//
// Wave 3 audit DAA-1: it still went around everything else an ordinary roll takes, the sticky
// Advantage/Disadvantage selector, ongoing and the pre-roll window. It now rolls through
// StonetopCharacter#onDirectStatRoll after promptRoll, as Death's Door does, and carries its outcome
// buttons on the card (DAA-3) rather than opening a window at roll time. DAA-2: a batch that broke
// free is no longer anyone's to send back.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { promptRoll } from "../../../module/dialogs/RollDialog.js";
import { SERVANT_SOURCE_UUID } from "../../../module/data/servant-of-daagon.js";

// Only the dice and the pre-roll window are stood in for: the test reads what the roll was handed.
const rollStat = vi.hoisted(() => vi.fn(async () => ({ total: 10 })));
vi.mock("../../../module/utils/roll-engine.js", async importOriginal => ({ ...(await importOriginal()), rollStat }));
vi.mock("../../../module/dialogs/RollDialog.js", async importOriginal => ({
	...(await importOriginal()),
	promptRoll: vi.fn(async () => ({ situational: 0 })),
}));

const BATCH = { name: "Servants of Daagon", sourceUuid: SERVANT_SOURCE_UUID };

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

const seeker = (flags = {}) => buildLiveCharacter({
	slug: "the-seeker", name: "The Seeker", flags: { "customFollowers.deep-ones": BATCH, ...flags },
});

beforeEach(() => {
	rollStat.mockClear();
	promptRoll.mockClear();
	promptRoll.mockImplementation(async () => ({ situational: 0 }));
	global.ui = { notifications: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } };
});

describe("Send Them Back and the debilities", () => {
	it("rolls at disadvantage, and says why, while Miserable", async () => {
		const { char, actor } = seeker();
		actor.system.attributes.debilities.options.miserable.value = true;
		await sheetFor(char, actor)._onSendServantsBack("deep-ones", "the servants of Daagon");

		const [stat, , options] = rollStat.mock.calls[0];
		expect(stat).toBe("cha");
		expect(options.rollMode).toBe("dis");
		expect(options.stonetopDebility).toBe("Miserable");
		expect(options.moveName).toBe("Send Them Back");
	});

	it("rolls clean when nothing touching +CHA is marked", async () => {
		const { char, actor } = seeker();
		actor.system.attributes.debilities.options.weakened.value = true;
		await sheetFor(char, actor)._onSendServantsBack("deep-ones", "the servants of Daagon");

		const options = rollStat.mock.calls[0][2];
		expect(options.rollMode ?? "normal").not.toBe("dis");
		expect(options.stonetopDebility).toBeUndefined();
	});
});

describe("Send Them Back is an ordinary roll (DAA-1)", () => {
	it("takes the sheet's sticky Advantage and the character's ongoing", async () => {
		const { char, actor } = seeker({ rollMode: "adv" });
		actor.system.attributes.ongoing = { value: 1 };
		await sheetFor(char, actor)._onSendServantsBack("deep-ones");

		const options = rollStat.mock.calls[0][2];
		expect(options.rollMode).toBe("adv");
		expect(options.ongoing).toBe(1);
		expect(options.modifier).toBe(1);
	});

	it("asks the pre-roll window, and rolls nothing when it is backed out of", async () => {
		const { char, actor } = seeker();
		promptRoll.mockImplementationOnce(async () => null);
		await sheetFor(char, actor)._onSendServantsBack("deep-ones", null, { shiftKey: true });
		expect(promptRoll).toHaveBeenCalledWith(expect.objectContaining({ title: "Send Them Back", shiftKey: true }));
		expect(rollStat).not.toHaveBeenCalled();
	});

	it("carries the outcome buttons on the card for every tier (DAA-3)", async () => {
		const { char, actor } = seeker();
		await sheetFor(char, actor)._onSendServantsBack("deep-ones");
		const { tierActions } = rollStat.mock.calls[0][2];
		expect(tierActions.success).toContain('data-act="depart" data-slug="deep-ones"');
		expect(tierActions.partial).toContain('data-act="depart"');
		expect(tierActions.failure).toContain('data-act="free"');
	});

	it("does not roll for a batch that broke free: they are no longer followers (DAA-2)", async () => {
		const { char, actor } = seeker({ "customFollowers.deep-ones": { ...BATCH, brokenFree: true } });
		await sheetFor(char, actor)._onSendServantsBack("deep-ones");
		expect(promptRoll).not.toHaveBeenCalled();
		expect(rollStat).not.toHaveBeenCalled();
	});
});
