// The 11-13 play-through of the imported playbooks' mechanics, second round: what a homebrew move does to
// OTHER rolls (move-words.js#rollBendsFrom, homebrew-roll-bends.js), its armor and damage, a roll printed
// inside a background, a background's follower, and a Minor Arcana draw.

import { describe, it, expect } from "vitest";
import { rollBendsFrom, armorFromWords, damageFromWords, backgroundRollFrom, backgroundFollowerFrom, occultDrawFrom, insertMovesInHumanGuise } from "../../module/playbooks/move-words.js";
import { composeDamageFormula, stepFormulaDice } from "../../module/utils/damage.js";
import { bendRides, homebrewBackgroundOf, backgroundFollowerOffer, homebrewRollBends, homebrewBlowOffers } from "../../module/actors/character/homebrew-roll-bends.js";
import { occultDrawsOwed } from "../../module/actors/character/occult-draw.js";
import { normalizeBundle, bundleToItemData, itemsToBundle, emptyBundle } from "../../module/playbooks/homebrew-bundle.js";
import { SYSTEM_ID } from "../../module/system-id.js";

const bend = words => rollBendsFrom(words).map(({ text, ...rest }) => rest);
const hbFlags = (extra = {}) => ({ [SYSTEM_ID]: { homebrewPlaybook: "homebrew-the-tester", ...extra } });

describe("a homebrew move that changes another move's roll", () => {
	it("swaps the stat on the move it names, and only there", () => {
		expect(bend("When you Seek Insight within a dream or vision, you may roll with +CHA instead of +WIS.")).toEqual([{ kind: "stat", stat: "cha", moves: ["Seek Insight"] }]);
		expect(bend("So long as you hold Fear you may strike out, using fear as a weapon, to Clash with +CHA.")).toEqual([{ kind: "stat", stat: "cha", moves: ["Clash"], whileHolding: "Fear" }]);
		// A roll of the move's own, with its tiers, is not a bend; nor a stat with no move named.
		expect(bend("When you enter a dream, you roll +CHA: on a 10+, you do it; on a 7-9, it sours.")).toEqual([]);
	});

	it("gives advantage, a 6- as a 7-9, a flat +N or a fixed number, on the moves named or any", () => {
		expect(bend("When you Know Things you have advantage so long as it deals with death.")).toEqual([{ kind: "advantage", moves: ["Know Things"] }]);
		expect(bend("When you forage in ruins or deep caverns you have advantage.")).toEqual([{ kind: "advantage", moves: ["Forage"] }]);
		expect(bend("While doing something well-practiced through your station, treat a 6- as a 7-9.")).toEqual([{ kind: "missAsPartial", moves: null }]);
		expect(bend("For any moves you make in the attempt, roll +3 instead of rolling as normal.")).toEqual([{ kind: "statValue", value: 3, moves: null }]);
		expect(bend("When you transform you may add +1 to any roll and mark Doom.")).toEqual([{ kind: "modifier", value: 1, moves: null, marks: "Doom", whileTransformed: true }]);
		expect(bend("Spend Memory to Persuade with advantage (if it makes sense).")).toEqual([{ kind: "advantage", moves: ["Persuade"], spends: "Memory" }]);
		// "disadvantage" is no advantage.
		expect(bend("Receive disadvantage when you Defy Danger until you rest.")).toEqual([]);
	});

	it("rides the roll it names, Persuade either way, or any roll", () => {
		expect(bendRides({ moves: ["Persuade"] }, "Persuade (vs. NPCs)")).toBe(true);
		expect(bendRides({ moves: ["Seek Insight"] }, "Know Things")).toBe(false);
		expect(bendRides({ moves: null }, "Clash")).toBe(true);
		expect(bendRides({ moves: null }, "")).toBe(false);
	});

	it("comes from LEARNED homebrew moves and the homebrew background taken, never a book's", () => {
		const actor = { items: [
			{ id: "a", type: "move", name: "Dead Head", flags: hbFlags(), system: { description: "<p>When you Know Things you have advantage.</p>" } },
			{ id: "b", type: "move", name: "Off", flags: hbFlags({ learned: false }), system: { description: "<p>When you Clash you have advantage.</p>" } },
			{ id: "c", type: "move", name: "Book", flags: {}, system: { description: "<p>When you Clash you have advantage.</p>" } },
		] };
		const playbook = { slug: "homebrew-the-tester", backgrounds: [{ slug: "cursed", label: "Cursed", description: "<p>You may add +1 to any roll and mark Doom.</p>", setup: { resources: [{ key: "cursed-doom", label: "Doom", max: 3 }] } }] };
		const background = homebrewBackgroundOf(playbook, "cursed");
		expect(background.resources).toEqual([{ key: "cursed-doom", label: "Doom", max: 3 }]);
		expect(homebrewRollBends(actor, background).map(b => b.source)).toEqual(["Dead Head", "Cursed"]);
		expect(homebrewBackgroundOf({ slug: "the-fox", backgrounds: playbook.backgrounds }, "cursed")).toBeNull();
	});

	// The background's words are read once, on the record every reader of its rules takes.
	it("carries the background's words, and reads whether its insert's moves come in human guise", () => {
		const playbook = { slug: "homebrew-the-tester", backgrounds: [{ slug: "cursed", label: "Cursed", description: "<p>You have access to your <em>monster moves</em> in your human guise.</p>" }] };
		const background = homebrewBackgroundOf(playbook, "cursed");
		expect(background.words).toContain("in your human guise");
		expect(background.words).not.toContain("<");
		expect(insertMovesInHumanGuise(background.words)).toBe(true);
		expect(insertMovesInHumanGuise("Only while you wear the form.")).toBe(false);
		expect(insertMovesInHumanGuise(undefined)).toBe(false);
	});
});

describe("a homebrew move's armor and damage", () => {
	it("reads Formless's unarmored armor and a flat bonus, not a conditional one", () => {
		expect(armorFromWords("You can squeeze through tight spaces. Also gain +1 Armor when you go unarmored thanks to supernatural resilience.")).toEqual({ unarmored: 1 });
		expect(armorFromWords("You gain +1 armor.")).toEqual({ armor: 1 });
		expect(armorFromWords("You gain +2 armor while touching the earth.")).toBeNull();
	});

	it("reads Deadly's die step and a move's extra damage, offered unticked in the damage window", () => {
		expect(damageFromWords("When you deal damage with the intent to kill, increase all damage dice by one size.")).toEqual({ dieStep: 1 });
		expect(damageFromWords("When you strike from hiding, you deal +1d4 damage.")).toEqual({ dice: "1d4" });
		const actor = { items: [{ id: "d", type: "move", name: "Deadly", flags: hbFlags(), system: { description: "<p>Increase all damage dice by one size.</p>" } }] };
		expect(homebrewBlowOffers(actor)).toEqual([expect.objectContaining({ key: "hb-dmg-d", dieStep: 1, applied: false, label: "Deadly: damage dice one size larger" })]);
	});

	it("steps every die of the blow, the weapon's and the added ones, capped at d12", () => {
		expect(stepFormulaDice("d8+3", 1)).toBe("d10+3");
		expect(composeDamageFormula("1d8+3", { extraDice: [{ key: "x", dice: "1d4", pill: "P" }, { key: "hb", dieStep: 1, pill: "Deadly" }] })).toBe("1d10+3+1d6");
		expect(stepFormulaDice("d12+1d10", 1)).toBe("d12+1d12");
		expect(composeDamageFormula("d6", { extraDice: [] })).toBe("d6");
	});
});

describe("a roll printed inside a background", () => {
	const moonBlessed = "Those very creatures comfort you.\n\nGain the Child of the Night move, and work with the GM to create a monstrous follower. They start with loyalty 2. When you ***whisper the name of a monstrous follower under a moon-lit sky***, roll +CHA: on a 10+, they are at your side; on a 7-9, they will be here soon; on a 6-, they appear when the GM says so.\n\nNote that your monstrous followers may have monstrous instincts.";

	it("is found from the sentence its trigger opens", () => {
		const r = backgroundRollFrom(moonBlessed);
		expect(r.paragraph.startsWith("When you ***whisper")).toBe(true);
		expect(r.before.endsWith("They start with loyalty 2.")).toBe(true);
		expect(r.after).toBe("Note that your monstrous followers may have monstrous instincts.");
		expect(backgroundRollFrom("When you ***reveal your darkest self*** you may add +1 to any roll.")).toBeNull();
	});

	it("becomes a move the background gives and only it, printed once, kept through a save", async () => {
		const raw = emptyBundle();
		raw.playbook.name = "The Tester";
		raw.playbook.backgrounds = [
			{ label: "Moon Blessed", description: moonBlessed, moves: ["Child of the Night"], moveChoice: [], possessions: [], track: null },
			{ label: "Grave Tender", description: "You bury the dead.", moves: [], moveChoice: [], possessions: [], track: null },
		];
		raw.moves = [{ name: "Child of the Night", description: "You speak with beasts." }];
		const { bundle } = normalizeBundle(raw);
		const lifted = bundle.moves.find(m => m.name === "Moon Blessed");
		expect(lifted).toMatchObject({ rollType: "cha", background: "Moon Blessed", results: { success: "They are at your side." } });
		expect(bundle.playbook.backgrounds[0].moves).toEqual(["Child of the Night", "Moon Blessed"]);
		expect(bundle.playbook.backgrounds[0].description).not.toContain("whisper");
		expect(bundle.playbook.backgrounds[0].description).toContain("You get the ***Moon Blessed*** move.");
		const items = bundleToItemData(bundle, { slug: "homebrew-the-tester" });
		const item = items.moves.find(m => m.name === "Moon Blessed");
		expect(item.system.requirement).toEqual({ background: "moon-blessed", note: "Moon Blessed background" });
		const back = itemsToBundle(items.playbook, items.moves);
		expect(back.moves.find(m => m.name === "Moon Blessed").background).toBe("Moon Blessed");
		// The save's own note isn't read back as the GM's: a re-import took it for a hand edit to keep.
		expect(back.moves.find(m => m.name === "Moon Blessed").requires).toBe("");
		const { diffBundles } = await import("../../module/playbooks/homebrew-bundle.js");
		expect(diffBundles(bundle, back).lines).toEqual([]);
		// Read again, nothing more is lifted: the background no longer prints the roll.
		expect(normalizeBundle(back).bundle.moves.filter(m => m.name === "Moon Blessed")).toHaveLength(1);
	});
});

describe("a background's follower and a move's Minor Arcana draw", () => {
	it("reads the follower and its Loyalty, offered until one made from it is on the sheet", () => {
		expect(backgroundFollowerFrom("work with the GM to create a monstrous follower. They start with loyalty 2.")).toEqual({ kind: "monstrous follower", loyalty: 2 });
		const playbook = { slug: "homebrew-the-tester", backgrounds: [{ slug: "moon-blessed", label: "Moon Blessed", description: "<p>Create a monstrous follower. They start with loyalty 2.</p>" }] };
		expect(backgroundFollowerOffer(playbook, "moon-blessed", {})).toEqual({ slug: "moon-blessed", background: "Moon Blessed", kind: "monstrous follower", loyalty: 2 });
		expect(backgroundFollowerOffer(playbook, "moon-blessed", { f1: { fromBackground: "moon-blessed" } })).toBeNull();
	});

	it("reads Occult Interest's draw, owed until drawn", () => {
		expect(occultDrawFrom("Draw three random Minor Arcana and choose one; you have unlocked its secrets.")).toEqual({ count: 3 });
		const item = { id: "o", type: "move", name: "Occult Interest", flags: hbFlags(), system: { description: "<p>Draw three random Minor Arcana and choose one.</p>" } };
		expect([...occultDrawsOwed({ items: [item], flags: {} })]).toEqual([["Occult Interest", 3]]);
		expect([...occultDrawsOwed({ items: [item], flags: { [SYSTEM_ID]: { occultDraws: { "Occult Interest": "the-jar" } } } })]).toEqual([]);
	});
});
