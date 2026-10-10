import { describe, it, expect } from "vitest";
import {
	knowThingsRollChoices, advantageRollOptions, KNOW_THINGS_STAT, KNOW_THINGS_ADVANTAGE_MOVES,
} from "../../../module/actors/character/arcana-identify.js";
import { layModes } from "../../../module/utils/roll-mode.js";

describe("knowThingsRollChoices", () => {
	it("gives a plain +INT roll and no dialog to a character with none of the moves", () => {
		const choices = knowThingsRollChoices(["Know Things", "Defy Danger", "Clash"]);
		expect(choices.stats).toEqual(["int"]);
		expect(choices.advantageMoves).toEqual([]);
		expect(choices.hasChoice).toBe(false);
	});

	it("offers +WIS to Well-Read (\"roll +WIS to Know Things instead of +INT\")", () => {
		const choices = knowThingsRollChoices(["Know Things", "Well-Read"]);
		expect(choices.stats).toEqual(["int", "wis"]);
		expect(choices.statGrants).toEqual(["Well-Read"]);
		expect(choices.hasChoice).toBe(true);
	});

	it("offers advantage for Polyglot and Naturalist, together when both are owned", () => {
		expect(knowThingsRollChoices(["Polyglot"]).advantageMoves).toEqual(["Polyglot"]);
		expect(knowThingsRollChoices(["Naturalist"]).advantageMoves).toEqual(["Naturalist"]);
		expect(knowThingsRollChoices(["Naturalist", "Polyglot"]).advantageMoves)
			.toEqual(KNOW_THINGS_ADVANTAGE_MOVES);
	});

	it("combines a stat grant with an advantage grant", () => {
		const choices = knowThingsRollChoices(["Well-Read", "Polyglot"]);
		expect(choices.stats).toEqual(["int", "wis"]);
		expect(choices.advantageMoves).toEqual(["Polyglot"]);
		expect(choices.hasChoice).toBe(true);
	});

	it("ignores grants keyed to other moves", () => {
		// Skill at Arms grants DEX on Clash, not on Know Things.
		const choices = knowThingsRollChoices(["Skill at Arms", "Wild Speech", "Purifying Flames"]);
		expect(choices.stats).toEqual(["int"]);
		expect(choices.hasChoice).toBe(false);
	});

	it("never repeats a stat or re-offers the default", () => {
		const choices = knowThingsRollChoices(["Well-Read", "Well-Read"]);
		expect(choices.stats).toEqual(["int", "wis"]);
		expect(choices.stats[0]).toBe(KNOW_THINGS_STAT);
	});

	it("takes plain names, so it never needs an actor", () => {
		expect(() => knowThingsRollChoices()).not.toThrow();
		expect(knowThingsRollChoices().hasChoice).toBe(false);
	});
});

// A claimed advantage folded into the roll mode the character already carries, as a roll's options, keeping
// the sides that spoke: a cancelled pair must stay cancelled when a debility is laid on afterwards, since one
// side each way cancels however many of each there are (p.230).
describe("advantageRollOptions", () => {
	// Book I p.230: "When you make a roll with both advantage and disadvantage, they cancel each
	// other out" and "Advantage/disadvantage don't 'stack.' They're binary."
	it("leaves the character's own roll mode alone when nothing is claimed", () => {
		for (const mode of ["normal", "adv", "dis"]) expect(advantageRollOptions(mode, false).rollMode).toBe(mode);
	});

	it("upgrades a normal roll", () => {
		expect(advantageRollOptions("normal", true).rollMode).toBe("adv");
	});

	it("cancels against disadvantage rather than overriding it", () => {
		expect(advantageRollOptions("dis", true).rollMode).toBe("normal");
	});

	it("does not stack on advantage the character already has", () => {
		expect(advantageRollOptions("adv", true).rollMode).toBe("adv");
	});

	it("keeps a cancelled pair cancelled under a debility laid on after it", () => {
		const options = advantageRollOptions("dis", true);
		expect(options).toMatchObject({ rollMode: "normal", modeBase: "dis", modeSources: ["adv"] });
		expect(layModes(options, ["dis"]).rollMode).toBe("normal");
	});
});
