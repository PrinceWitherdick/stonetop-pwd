// Moves (and one background) that let a character roll a different stat for a basic move
// (module/data/alt-stat-grants.js), and the sheet's stat picker that offers them.
//
// Two gaps from the 2026-09-25 Fox audit: every grant counted a move that was only ON the sheet,
// learned or not (an un-learned Skill at Arms still offered +DEX on Clash), and the Fox's The
// Natural ("When you Seek Insight, you may roll +INT instead of +WIS") offered nothing at all.

import { describe, it, expect, vi } from "vitest";
import { altStatGrantsFor, altStatGrantForMove } from "../../../module/data/alt-stat-grants.js";
import { knowThingsRollChoices } from "../../../module/actors/character/arcana-identify.js";
import { buildLiveCharacter, makeLiveItem } from "../../fakes/LiveCharacter.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";

const NATURAL = { playbook: "The Fox", background: "the-natural" };

describe("altStatGrantsFor", () => {
	it("grants off a learned move, and only the stat that move names", () => {
		const rows = altStatGrantsFor({ moveName: "Clash", defaultStat: "str" }, { learnedMoveNames: ["Skill at Arms"] });
		expect(rows.map(g => g.altStat)).toEqual(["dex"]);
		expect(altStatGrantsFor({ moveName: "Clash", defaultStat: "str" }, { learnedMoveNames: [] })).toEqual([]);
	});

	it("grants a blanket stat by the move's default stat (Laugh at Danger, every CON move)", () => {
		const rows = altStatGrantsFor({ moveName: "Anything", defaultStat: "con" }, { learnedMoveNames: ["Laugh at Danger"] });
		expect(rows.map(g => g.altStat)).toEqual(["cha"]);
	});

	it("grants The Natural's +INT on Seek Insight to a Fox who took it, and to no one else", () => {
		const seek = { moveName: "Seek Insight", defaultStat: "wis" };
		expect(altStatGrantsFor(seek, NATURAL).map(g => g.altStat)).toEqual(["int"]);
		expect(altStatGrantsFor(seek, { playbook: "The Fox", background: "a-life-of-crime" })).toEqual([]);
		// The slug alone is not the background: another playbook's slug of the same name is not it.
		expect(altStatGrantsFor(seek, { playbook: "The Heavy", background: "the-natural" })).toEqual([]);
		// ...and only on the move it names.
		expect(altStatGrantsFor({ moveName: "Know Things", defaultStat: "int" }, NATURAL)).toEqual([]);
	});

	it("never lets a background row answer for a move name that is missing", () => {
		expect(altStatGrantForMove(undefined)).toBeNull();
		expect(altStatGrantForMove("Skill at Arms")?.altStat).toBe("dex");
	});
});

describe("knowThingsRollChoices reads the same table", () => {
	it("takes the playbook and background through to the table's matching", () => {
		expect(knowThingsRollChoices(["Well-Read"], NATURAL).stats).toEqual(["int", "wis"]);
		expect(knowThingsRollChoices([], NATURAL).hasChoice).toBe(false);
	});
});

// ── The sheet's stat picker ────────────────────────────────────────────────────
function sheetFor(char, actor) {
	actor.typedActor = char;
	actor.items.get = id => actor.items.find(i => i._id === id);
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const sheet = new (createStonetopCharacterSheetClass(Base))();
	sheet._stonetopCharacter = char;
	return sheet;
}

const rollableFor = item => ({ closest: () => ({ dataset: { itemId: item._id } }) });
const basic = (name, rollType) => makeLiveItem({ name, type: "move", system: { moveType: "basic", rollType } });
const pbMove = (name, { learned = true } = {}) => makeLiveItem({
	name, type: "move", system: { moveType: "playbook", description: `<p>${name}'s text.</p>` },
	flags: learned ? undefined : { "stonetop-pwd": { learned: false } },
});

describe("the sheet's alternate-stat offer", () => {
	it("offers +DEX on Clash for a learned Skill at Arms, and nothing once it is switched off", async () => {
		const clash = basic("Clash", "str");
		const on = buildLiveCharacter({ slug: "the-fox", name: "The Fox", seedStartingMoves: false, items: [clash, pbMove("Skill at Arms")] });
		const offer = await sheetFor(on.char, on.actor)._altStatChoiceForRollable(rollableFor(clash));
		expect(offer.stats).toEqual(["str", "dex"]);
		expect(offer.grants.map(g => g.name)).toEqual(["Skill at Arms"]);

		const clash2 = basic("Clash", "str");
		const off = buildLiveCharacter({ slug: "the-fox", name: "The Fox", seedStartingMoves: false, items: [clash2, pbMove("Skill at Arms", { learned: false })] });
		expect(await sheetFor(off.char, off.actor)._altStatChoiceForRollable(rollableFor(clash2))).toBeNull();
	});

	it("does not offer +CHA on a CON move for an un-learned Laugh at Danger", async () => {
		const con = basic("Endure", "con");
		const { char, actor } = buildLiveCharacter({ slug: "the-fox", name: "The Fox", seedStartingMoves: false, items: [con, pbMove("Laugh at Danger", { learned: false })] });
		expect(await sheetFor(char, actor)._altStatChoiceForRollable(rollableFor(con))).toBeNull();
	});

	it("offers The Natural's +INT on Seek Insight, quoting the background's own sentence", async () => {
		const seek = basic("Seek Insight", "wis");
		const { char, actor } = buildLiveCharacter({
			slug: "the-fox", name: "The Fox", seedStartingMoves: false, items: [seek],
			flags: { "background.selected": "the-natural" },
		});
		const offer = await sheetFor(char, actor)._altStatChoiceForRollable(rollableFor(seek));
		expect(offer.stats).toEqual(["wis", "int"]);
		expect(offer.grants[0].name).toBe("The Natural");
		expect(offer.grants[0].system.description).toContain("roll +INT instead of +WIS");
		// Only the rule, not the character's life story.
		expect(offer.grants[0].system.description).not.toContain("You grew up around here");
	});

	it("offers nothing on Seek Insight to a Fox of another background", async () => {
		const seek = basic("Seek Insight", "wis");
		const { char, actor } = buildLiveCharacter({
			slug: "the-fox", name: "The Fox", seedStartingMoves: false, items: [seek],
			flags: { "background.selected": "a-life-of-crime" },
		});
		expect(await sheetFor(char, actor)._altStatChoiceForRollable(rollableFor(seek))).toBeNull();
	});
});
