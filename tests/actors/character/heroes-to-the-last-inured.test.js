// Heroes to the Last's "They are inured to terror & horror" (heroes-to-the-last.json, `inured`). Nothing
// rolls off it, so it is shown: a read-only chip on the crew card, a note beside the crew's Spend
// Loyalty "Overcome their fear", and one in the crew's Order Followers window. Read the way the
// exceptional pick is (follower-masters.js#crewIsInured): only on a LEARNED copy.

import { afterEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { crewIsInured, crewInuredNote, CREW_INURED_NOTE, HEROES_TO_THE_LAST } from "../../../module/actors/character/follower-masters.js";
import { OrderFollowersDialog } from "../../../module/actors/character/dialogs/OrderFollowersDialog.js";

const marshal = name => sourceMovesFor("The Marshal").find(d => d.name === name);
const CREW = { name: "The Wolves", tags: ["brave"], instinct: "x", cost: "y", loyalty: 2 };
const pick = level => ({ stat: "", level });

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

async function marshalWithHeroes(marks = {}) {
	const made = buildLiveCharacter({ slug: "the-marshal", name: "The Marshal", level: 6, flags: { crew: { ...CREW }, "moves.moveMarks": marks } });
	await made.char.addMove(marshal("Veteran Crew")._id);
	const htl = await made.char.addMove(marshal(HEROES_TO_THE_LAST)._id);
	return { ...made, htl, sheet: sheetFor(made.char, made.actor) };
}

async function crewCard({ char, sheet }) {
	const snap = await char.buildSnapshot();
	return sheet._buildFollowersData(await char.playbook(), null, snap.crewBonuses).crew;
}

afterEach(() => { vi.restoreAllMocks(); delete globalThis.Dialog; });

describe("Heroes to the Last: inured to terror & horror", () => {
	it("the move ships the pick", () => {
		expect(marshal(HEROES_TO_THE_LAST).system.markOptions.find(o => o.slug === "inured")?.label).toBe("They are inured to terror & horror");
	});

	it("reads the pick only on a learned copy", async () => {
		const made = await marshalWithHeroes({ [HEROES_TO_THE_LAST]: { inured: [pick(6)] } });
		expect(crewIsInured(made.actor)).toBe(true);
		expect(crewInuredNote(made.actor)).toBe(CREW_INURED_NOTE);
		await made.htl.setFlag(STONETOP_SCOPE, "learned", false);
		expect(crewIsInured(made.actor)).toBe(false);
		expect(crewInuredNote(made.actor)).toBe("");
		const other = await marshalWithHeroes({ [HEROES_TO_THE_LAST]: { exceptional: [pick(6)] } });
		expect(crewIsInured(other.actor)).toBe(false);
	});

	it("puts the chip on the crew card", async () => {
		const made = await marshalWithHeroes({ [HEROES_TO_THE_LAST]: { inured: [pick(6)] } });
		const card = await crewCard(made);
		expect(card.inured).toBe(true);
		expect(card.inuredHint).toContain(HEROES_TO_THE_LAST);
		expect((await crewCard(await marshalWithHeroes())).inured).toBe(false);
	});

	it("notes it beside Spend Loyalty's 'Overcome their fear', for the crew alone", async () => {
		const opened = [];
		globalThis.Dialog = class { constructor(data) { opened.push(data); } render() { return this; } };
		const made = await marshalWithHeroes({ [HEROES_TO_THE_LAST]: { inured: [pick(6)] } });
		made.sheet._onSpendLoyalty("crew", "", "The Wolves");
		expect(opened.at(-1).content).toMatch(/Overcome their fear to do as you say <em class="stonetop-spend-note">\(Inured to terror &amp; horror\)<\/em>/);
		await made.actor.update({ [`flags.${STONETOP_SCOPE}.customFollowers.f1`]: { name: "Andras", loyalty: 1 } });
		made.sheet._onSpendLoyalty("custom", "f1", "Andras");
		expect(opened.at(-1).content).not.toContain("stonetop-spend-note");
	});

	it("rides into the crew's Order Followers window", async () => {
		const opened = [];
		vi.spyOn(OrderFollowersDialog.prototype, "render").mockImplementation(function () { opened.push(this); return this; });
		const made = await marshalWithHeroes({ [HEROES_TO_THE_LAST]: { inured: [pick(6)] } });
		await made.sheet.orderFollower({ name: "The Wolves", tags: [], moves: [] }, { ftype: "crew", slug: "" });
		expect(opened.at(-1).getData().inuredNote).toBe(CREW_INURED_NOTE);
		const plain = new OrderFollowersDialog({ name: "Vahid" }, { name: "Andalau" }, () => {});
		expect(plain.getData().inuredNote).toBe("");
	});
});
