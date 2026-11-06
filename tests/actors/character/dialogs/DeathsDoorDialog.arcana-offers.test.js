import { describe, it, expect, vi, beforeEach } from "vitest";
import Handlebars from "handlebars";
import { DeathsDoorDialog } from "../../../../module/actors/character/dialogs/DeathsDoorDialog.js";
import { DEATHS_DOOR_STATE } from "../../../../module/actors/character/deaths-door.js";
import {
	CARVINGS_IN_A_CAVE, RUNE_LADEN_SCALES, boundSoulsOffer, scalesTenPlusOffer,
} from "../../../../module/actors/character/deaths-door-arcana-offers.js";
import { readRepo } from "../../../fakes/css.js";
import { escHtml } from "../../../../module/utils/strings.js";

// Arcana audit 2026-11-04 (MAJ-6, MNA-14): two arcana that OFFER a way through Death's Door.
//   Rune-laden Scales, PROOF AGAINST HARM (Book II p.563): "you may mark a consequence before you roll to
//     automatically get a 10+".
//   Carvings in a cave, Shell Game of Souls (Book II p.510): "When you roll a 6- on Death's Door, you can release a
//     bound soul ... you survive as if you rolled a 7-9."

const markArcanumConsequence = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../../../module/actors/character/arcana-seeker-moves.js", async importOriginal => ({
	...(await importOriginal()), markArcanumConsequence,
}));
const endBattleJoyUnrolled = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../../../module/combat/battle-joy-offer.js", async importOriginal => ({
	...(await importOriginal()), endBattleJoyUnrolled,
}));

const SCALES = JSON.parse(readRepo("packs/src/stonetop-arcana/major/rune-laden-scales.json")).flags.stonetop;
const PROOF_BOX = 3;   // INDOMITABLE, MAGNET, POWER SINK, PROOF AGAINST HARM: the fourth □ on the back

function hero({ state = DEATHS_DOOR_STATE.DYING, owned = [], leads = [], boxes = {}, worn = true, souls = 0 } = {}) {
	const character = {
		_actor: { id: "hero-1", name: "Wren" },
		deathsDoorState: state,
		setDeathsDoorState: vi.fn(async s => { character.deathsDoorState = s; }),
		setArcanumResource: vi.fn(async (slug, n) => { character._inventory.resources[slug] = n; }),
		clearUnstoppableCircles: vi.fn(async () => 0),
		deathsDoorRollOptions: () => ({ statChoices: [{ stat: "", label: "+nothing" }], penalty: 0, hardToKill: false, unstoppableMarks: 0 }),
		_inventory: {
			checked:   { [RUNE_LADEN_SCALES]: worn },
			resources: { [CARVINGS_IN_A_CAVE]: souls },
		},
		_arcana: {
			ownedSlugs: new Set(owned),
			leadSlugs:  new Set(leads),
			boxStates:  boxes,
			getArcanum: async slug => (slug === RUNE_LADEN_SCALES ? { slug, ...SCALES } : null),
		},
	};
	return character;
}

function windowOn(character) {
	const dialog = new DeathsDoorDialog(character, () => {});
	dialog.renderIfOpen = vi.fn();
	dialog.render = vi.fn();
	dialog._post = vi.fn(async () => {});
	dialog._rollWatch = () => ({ kind: "none" });
	dialog._claimRoll = vi.fn(async () => true);
	dialog._noteRoll = vi.fn(async () => {});
	dialog._releaseRoll = vi.fn(async () => {});
	dialog._land = vi.fn(async () => {});
	return dialog;
}

function draw(data) {
	const hb = Handlebars.create();
	hb.registerHelper("or", (...a) => a.slice(0, -1).some(Boolean));
	hb.registerHelper("eq", (a, b) => a === b);
	hb.registerHelper("localize", (key, options) => (Object.keys(options?.hash ?? {}).length
		? game.i18n.format(key, options.hash) : game.i18n.localize(key)));
	hb.registerHelper("escapeHtml", value => escHtml(value));
	hb.registerPartial("stonetop.deaths-door-outcomes", readRepo("templates/dialogs/partials/deaths-door-outcomes.hbs"));
	hb.registerPartial("stonetop.deaths-door-dictates", readRepo("templates/dialogs/partials/deaths-door-dictates.hbs"));
	hb.registerPartial("stonetop.post-death-choices", "");
	return hb.compile(readRepo("templates/dialogs/deaths-door.hbs"))(data);
}

const proof = { [`${RUNE_LADEN_SCALES}:back:${PROOF_BOX}`]: true };

beforeEach(() => {
	markArcanumConsequence.mockReset().mockResolvedValue(true);
	endBattleJoyUnrolled.mockClear();
});

describe("Rune-laden Scales: a Consequence for a 10+ (MAJ-6)", () => {
	it("is on offer only once PROOF AGAINST HARM is ticked, on a card held, with a Consequence left", async () => {
		expect(SCALES.back.description.split("□").length - 1).toBeGreaterThan(PROOF_BOX);
		expect(await scalesTenPlusOffer(hero({ owned: [RUNE_LADEN_SCALES], boxes: proof })))
			.toMatchObject({ slug: RUNE_LADEN_SCALES, name: "Rune-laden Scales", worn: true, consequencesLeft: 5 });
		expect(await scalesTenPlusOffer(hero({ owned: [RUNE_LADEN_SCALES] }))).toBeNull();
		expect(await scalesTenPlusOffer(hero({ owned: [RUNE_LADEN_SCALES], leads: [RUNE_LADEN_SCALES], boxes: proof }))).toBeNull();
		expect(await scalesTenPlusOffer(hero({ boxes: proof }))).toBeNull();
		// Every Consequence marked: there is nothing left to pay with.
		const all = { ...proof };
		for (let i = PROOF_BOX + 1; i < PROOF_BOX + 1 + 7; i++) all[`${RUNE_LADEN_SCALES}:back:${i}`] = true;
		expect(await scalesTenPlusOffer(hero({ owned: [RUNE_LADEN_SCALES], boxes: all }))).toBeNull();
	});

	it("draws a note and a footer button on the roll step, and flags Scales the inventory doesn't mark worn", async () => {
		const dialog = windowOn(hero({ owned: [RUNE_LADEN_SCALES], boxes: proof, worn: false }));
		await dialog._readScalesOffer();
		const data = dialog.getData();
		expect(data.scalesOffer.text).toContain("<strong>Rune-laden Scales</strong>");
		expect(data.scalesOffer.notWorn).not.toBe("");
		const html = draw(data);
		expect(html).toContain("deaths-door-scales-btn");
		expect(html).toContain(data.scalesOffer.button);
		// Flagged, never blocked: the button is there and enabled.
		expect(html).not.toMatch(/deaths-door-scales-btn[^>]*disabled/);

		const plain = windowOn(hero());
		await plain._readScalesOffer();
		expect(plain.getData().scalesOffer).toBeNull();
		expect(draw(plain.getData())).not.toContain("deaths-door-scales-btn");
	});

	it("marks the Consequence through the one pick, then lands a 10+ with no dice", async () => {
		const character = hero({ owned: [RUNE_LADEN_SCALES], boxes: proof });
		const dialog = windowOn(character);
		await dialog._onScalesTenPlus();
		expect(dialog._claimRoll).toHaveBeenCalledOnce();
		expect(markArcanumConsequence).toHaveBeenCalledWith(character._actor, RUNE_LADEN_SCALES);
		expect(markArcanumConsequence.mock.invocationCallOrder[0]).toBeLessThan(dialog._land.mock.invocationCallOrder[0]);
		expect(dialog._land).toHaveBeenCalledWith("success");
		expect(dialog._landed).toBe("success");
		expect(dialog._rolledTotal).toBeNull();
		expect(dialog._tierNote).toContain("Rune-laden Scales");
		expect(dialog._post).toHaveBeenCalledWith("Rune-laden Scales", expect.stringContaining("Wren"));
		expect(endBattleJoyUnrolled).toHaveBeenCalledOnce();
	});

	it("lands nothing, and gives the Door back, when no Consequence is marked", async () => {
		markArcanumConsequence.mockResolvedValue(false);
		const dialog = windowOn(hero({ owned: [RUNE_LADEN_SCALES], boxes: proof }));
		await dialog._onScalesTenPlus();
		expect(dialog._land).not.toHaveBeenCalled();
		expect(dialog._releaseRoll).toHaveBeenCalled();
		expect(dialog._landed).toBeNull();
		expect(endBattleJoyUnrolled).not.toHaveBeenCalled();
	});

	it("asks nothing when the offer has gone since the window drew it", async () => {
		const dialog = windowOn(hero({ owned: [RUNE_LADEN_SCALES] }));
		await dialog._onScalesTenPlus();
		expect(dialog._claimRoll).not.toHaveBeenCalled();
		expect(markArcanumConsequence).not.toHaveBeenCalled();
	});
});

describe("Carvings in a cave: a bound soul through the Last Door (MNA-14)", () => {
	it("is on offer while the card is held and its Souls track holds one", () => {
		expect(boundSoulsOffer(hero({ owned: [CARVINGS_IN_A_CAVE], souls: 2 }))).toEqual({ slug: CARVINGS_IN_A_CAVE, souls: 2 });
		expect(boundSoulsOffer(hero({ owned: [CARVINGS_IN_A_CAVE], souls: 0 }))).toBeNull();
		expect(boundSoulsOffer(hero({ souls: 2 }))).toBeNull();
		expect(boundSoulsOffer(hero({ owned: [CARVINGS_IN_A_CAVE], leads: [CARVINGS_IN_A_CAVE], souls: 2 }))).toBeNull();
	});

	it("is drawn beside the fates on a 6- still waiting on its fate, and not without a soul", () => {
		const dialog = windowOn(hero({ state: DEATHS_DOOR_STATE.FATE_PENDING, owned: [CARVINGS_IN_A_CAVE], souls: 1 }));
		expect(dialog._step).toBe("result");
		const data = dialog.getData();
		expect(data.soulsOffer.text).toContain("1 bound");
		const html = draw(data);
		expect(html).toContain("deaths-door-release-soul-btn");
		// Beside the fates, never instead of them.
		expect(html).toContain("deaths-door-fate-btn");

		const none = windowOn(hero({ state: DEATHS_DOOR_STATE.FATE_PENDING, owned: [CARVINGS_IN_A_CAVE], souls: 0 }));
		expect(none.getData().soulsOffer).toBeNull();
		expect(draw(none.getData())).not.toContain("deaths-door-release-soul-btn");
	});

	it("survives as a 7-9 and takes one soul off the track", async () => {
		const character = hero({ state: DEATHS_DOOR_STATE.FATE_PENDING, owned: [CARVINGS_IN_A_CAVE], souls: 2 });
		const dialog = windowOn(character);
		await dialog._onReleaseSoul();
		expect(character.deathsDoorState).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
		expect(character.setArcanumResource).toHaveBeenCalledWith(CARVINGS_IN_A_CAVE, 1, expect.any(Object));
		expect(dialog._landed).toBe("partial");
		expect(dialog._post).toHaveBeenCalledOnce();
		const data = dialog.getData();
		expect(data.isWeak).toBe(true);
		expect(data.isMiss).toBe(false);
		expect(data.soulsOffer).toBeNull();

		// Once: the 6- is no longer waiting on its fate.
		await dialog._onReleaseSoul();
		expect(character.setArcanumResource).toHaveBeenCalledOnce();
	});

	it("survives nothing when the soul can't be taken off the track, and waits while a boost is still to spend", async () => {
		const character = hero({ state: DEATHS_DOOR_STATE.FATE_PENDING, owned: [CARVINGS_IN_A_CAVE], souls: 2 });
		character.setArcanumResource.mockRejectedValueOnce(new Error("no permission"));
		const dialog = windowOn(character);
		await dialog._onReleaseSoul();
		expect(character.deathsDoorState).toBe(DEATHS_DOOR_STATE.FATE_PENDING);
		expect(dialog._post).not.toHaveBeenCalled();
		expect(dialog.getData().soulsOffer).not.toBeNull();

		const pending = hero({ state: DEATHS_DOOR_STATE.FATE_PENDING, owned: [CARVINGS_IN_A_CAVE], souls: 2 });
		const waiting = windowOn(pending);
		waiting._boostsPending = true;
		await waiting._onReleaseSoul();
		expect(pending.setArcanumResource).not.toHaveBeenCalled();
		expect(pending.deathsDoorState).toBe(DEATHS_DOOR_STATE.FATE_PENDING);
	});

	it("releases nothing off a 6- whose fate is already taken, or before the tier has landed", async () => {
		const dying = hero({ owned: [CARVINGS_IN_A_CAVE], souls: 2 });
		await windowOn(dying)._onReleaseSoul();
		expect(dying.setArcanumResource).not.toHaveBeenCalled();
		expect(dying.setDeathsDoorState).not.toHaveBeenCalled();
	});
});
