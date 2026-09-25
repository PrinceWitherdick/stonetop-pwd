// Skins of fine whisky, "(○○ uses, grants advantage to Persuade)" (the Distillery, for the Fox, the
// Heavy, the Judge, the Lightbearer, the Marshal and the Seeker). The user's ruling: a pre-ticked
// line in the Persuade roll window. Kept ticked, advantage as a SOURCE (it nets with disadvantage)
// and 1 use marked after the dice; unticked, nothing. From the 2026-09-25 Fox audit, where the skin
// was a label on the sheet that bought nothing.

import { afterEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, makeLiveItem } from "../../fakes/LiveCharacter.js";
import { fineWhiskyOffer, isFineWhiskyName, isPersuadeMove, FINE_WHISKY_OFFER } from "../../../module/actors/character/fine-whisky.js";
import { promptRoll, tookOffer } from "../../../module/dialogs/RollDialog.js";

const SCOPE = "stonetop-pwd";

describe("which whisky counts", () => {
	it("is a skin of FINE whisky, by any of its spellings", () => {
		for (const name of ["Skins of fine whisky", "Fine whisky (advantage to Persuade)", "Fine whisky", "Whisky, skin, fine", "Skin of whisky, fine"]) {
			expect(isFineWhiskyName(name)).toBe(true);
		}
		for (const name of ["Whisky, skin", "Firkin of whisky, fine", "Barrel of whisky, fine", "Firkins", "", null]) {
			expect(isFineWhiskyName(name)).toBe(false);
		}
	});

	it("sweetens either Persuade and nothing else", () => {
		expect(isPersuadeMove("Persuade (vs. NPCs)")).toBe(true);
		expect(isPersuadeMove("Persuade (vs. PCs)")).toBe(true);
		expect(isPersuadeMove("Defy Danger")).toBe(false);
	});

	const skin = { slug: "w1", name: "Skins of fine whisky", ammoMax: 2 };
	it("is offered only CARRIED, and only with a use left", () => {
		expect(fineWhiskyOffer({ gear: [skin], marks: { w1: true }, resources: {} })).toMatchObject({ key: FINE_WHISKY_OFFER, slug: "w1", used: 0, max: 2, applied: true });
		expect(fineWhiskyOffer({ gear: [skin], marks: {}, resources: {} })).toBeNull();
		expect(fineWhiskyOffer({ gear: [skin], marks: { w1: true }, resources: { w1: 2 } })).toBeNull();
	});

	it("finds a granted skin by its grant's key, and reads a pre-track skin's uses off its possession", () => {
		const granted = { slug: "w2", name: "Something renamed", sourceKey: "Fine whisky (advantage to Persuade)", ammoMax: null, legacyUsed: 1 };
		expect(fineWhiskyOffer({ gear: [granted], marks: { w2: true } })).toMatchObject({ used: 1, max: 2 });
	});

	it("takes the line only when a window showed it and it stayed ticked", () => {
		const offer = { key: FINE_WHISKY_OFFER, applied: true };
		expect(tookOffer(offer, null)).toBe(false);
		expect(tookOffer(offer, [])).toBe(false);
		expect(tookOffer(offer, [FINE_WHISKY_OFFER])).toBe(true);
		expect(tookOffer(null, [FINE_WHISKY_OFFER])).toBe(false);
	});
});

// ── The roll window ──────────────────────────────────────────────────────────
describe("promptRoll's offered lines", () => {
	const offers = [{ key: FINE_WHISKY_OFFER, label: "Share a skin of fine whisky (spend 1 use): advantage" }];
	afterEach(() => { delete global.Dialog; });

	it("shows the line ticked, and reports it back only while it stays ticked", async () => {
		let data;
		global.Dialog = vi.fn(function (d) { data = d; this.render = vi.fn(); });
		const pending = promptRoll({ askMode: false, askModifier: true, offers });
		expect(data.content).toContain(`name="offer-${FINE_WHISKY_OFFER}" checked`);
		expect(data.content).toContain("Share a skin of fine whisky (spend 1 use): advantage");
		const box = { checked: false };
		const root = { querySelector: sel => (sel === `[name="offer-${FINE_WHISKY_OFFER}"]` ? box : { value: "0" }) };
		data.buttons.roll.callback([root]);
		expect(await pending).toEqual({ situational: 0, takenOffers: [] });
	});

	it("opens for the line alone when neither setting asks anything", async () => {
		let data;
		global.Dialog = vi.fn(function (d) { data = d; this.render = vi.fn(); });
		const pending = promptRoll({ askMode: false, askModifier: false, offers });
		expect(global.Dialog).toHaveBeenCalledTimes(1);
		expect(data.content).toContain(`name="offer-${FINE_WHISKY_OFFER}" checked`);
		expect(data.content).not.toContain('name="modifier"');
		const root = { querySelector: sel => (sel === `[name="offer-${FINE_WHISKY_OFFER}"]` ? { checked: true } : null) };
		data.buttons.roll.callback([root]);
		expect(await pending).toEqual({ situational: 0, takenOffers: [FINE_WHISKY_OFFER] });
	});

	it("takes nothing on a Shift-click: the dice and nothing else", async () => {
		global.Dialog = vi.fn();
		expect(await promptRoll({ shiftKey: true, askMode: false, askModifier: true, offers })).toEqual({ situational: 0, takenOffers: [] });
		expect(global.Dialog).not.toHaveBeenCalled();
	});

	it("keeps the answer's shape for a roll that offered nothing", async () => {
		expect(await promptRoll({ askMode: false, askModifier: false })).toEqual({ situational: 0 });
	});
});

// ── The roll ─────────────────────────────────────────────────────────────────
function persuader({ carried = true, used = 0, sticky = "normal", withSkin = true } = {}) {
	const persuade = { _id: "persuade-1", name: "Persuade (vs. NPCs)", type: "move", system: { rollType: "cha" }, roll: vi.fn(async () => ({ total: 8 })) };
	const whisky = makeLiveItem({
		name: "Skins of fine whisky", type: "move",
		system: { moveType: "inventory-custom", inventoryColumn: "small", sourcePossession: "distillery", sourceKey: "Fine whisky (advantage to Persuade)", resource: { max: 2 } },
	});
	const made = buildLiveCharacter({
		slug: "the-fox", name: "The Fox", seedStartingMoves: false,
		items: withSkin ? [whisky] : [],
		flags: { rollMode: sticky, inventory: { checked: { [whisky._id]: carried }, resources: used ? { [whisky._id]: used } : {} } },
	});
	const items = [...made.actor.items, persuade];
	items.get = id => items.find(i => i._id === id) ?? null;
	made.actor.items = items;
	return { ...made, persuade, whisky };
}
const rollPersuade = (char, prompted = {}) => char.onRoll({
	currentTarget: { closest: sel => (sel === ".item" ? { dataset: { itemId: "persuade-1" } } : null), getAttribute: () => null },
}, prompted);
const rolledWith = persuade => persuade.roll.mock.calls[0][0];
const usesMarked = (actor, whisky) => actor.flags[SCOPE].inventory?.resources?.[whisky._id];

describe("sharing a skin on Persuade", () => {
	it("offers the skin to the roll window", async () => {
		const { char, persuade } = persuader();
		expect((await char.rollOffers(persuade)).map(o => o.key)).toEqual([FINE_WHISKY_OFFER]);
		expect(await char.rollOffers({ name: "Defy Danger" })).toEqual([]);
		expect(await persuader({ carried: false }).char.rollOffers(persuade)).toEqual([]);
		expect(await persuader({ used: 2 }).char.rollOffers(persuade)).toEqual([]);
	});

	it("kept ticked: advantage, named on the card, and 1 use marked", async () => {
		const { char, actor, persuade, whisky } = persuader();
		await rollPersuade(char, { takenOffers: [FINE_WHISKY_OFFER] });
		expect(rolledWith(persuade).rollMode).toBe("adv");
		expect(rolledWith(persuade).conditionNotes).toContain("Fine whisky");
		expect(usesMarked(actor, whisky)).toBe(1);
	});

	it("unticked: nothing happens", async () => {
		const { char, actor, persuade, whisky } = persuader();
		await rollPersuade(char, { takenOffers: [] });
		expect(rolledWith(persuade).rollMode).toBe("normal");
		expect(usesMarked(actor, whisky)).toBeUndefined();
	});

	it("is a SOURCE: it nets with a disadvantage and the roll goes straight", async () => {
		const { char, persuade } = persuader({ sticky: "dis" });
		await rollPersuade(char, { takenOffers: [FINE_WHISKY_OFFER] });
		expect(rolledWith(persuade).rollMode).toBe("normal");
	});

	it("with no window asked, is not poured", async () => {
		const { char, actor, persuade, whisky } = persuader({ used: 1 });
		await rollPersuade(char);
		expect(rolledWith(persuade).rollMode).toBe("normal");
		expect(usesMarked(actor, whisky)).toBe(1);
	});

	it("does nothing for a character with no skin to share", async () => {
		const { char, persuade } = persuader({ withSkin: false });
		await rollPersuade(char, { takenOffers: [FINE_WHISKY_OFFER] });
		expect(rolledWith(persuade).rollMode).toBe("normal");
	});
});
