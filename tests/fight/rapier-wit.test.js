// The Fox's Rapier Wit: "When you pierce an NPC's pride with a well-placed quip, they must do 1 (their
// choice): Attack, doing +1d4 damage if they hit but giving you advantage on your next roll against them /
// Stoop to your level and respond in kind / Spend a few moments fuming, sputtering, or controlling their
// temper". The posted card's "They attack" button records the NPC on the Fox, both halves owed: the Fox's
// next roll aimed at them has advantage, named, and their next hit on the Fox does +1d4, named. Each is
// spent by the one roll it was for.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
import { giveAdvantageCardHtml } from "../../module/actors/character/give-advantage.js";
import { wireRapierWit, rapierWitAttack, RAPIER_WIT_CARD_FLAG } from "../../module/actors/character/give-advantage-flow.js";
import {
	HERO_MOVES, RAPIER_WIT_FLAG, RAPIER_WIT_QUERY, recordRapierWit, rapierWitAgainst, spendRapierWitRoll, rapierWitOffers,
	rapierWitBlowOwed, spendRapierWitBlow, handleRapierWitQuery, foeAdvantage, clearRapierWit,
} from "../../module/fight/hero-moves.js";
import { StonetopCharacter } from "../../module/actors/character/StonetopCharacter.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { readRepo } from "../fakes/css.js";
import { installCombatChatFakes, uninstallCombatChatFakes, cardWithFlag, SCOPE } from "../fakes/combat-chat.js";

const { sufferEnemyAttack } = await import("../../module/combat/attack-flow.js");

/** A Fox holding the moves named, her flags read and written as Foundry's are. */
function fox({ moves = [HERO_MOVES.RAPIER_WIT], owner = true } = {}) {
	const flags = { [SYSTEM_ID]: {} };
	return {
		id: "fox", uuid: "Actor.fox", name: "Vesna", type: "character", isOwner: owner,
		system: { attributes: { armor: { value: 0 } } },
		items: moves.map(name => ({ type: "move", name, flags: {} })),
		flags,
		getFlag: (scope, key) => flags[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { flags[scope][key] = value; }),
	};
}

// Unlinked tokens: each foe is keyed by its token (fight/hero-moves.js#foeKey).
const OGRE = { uuid: "Scene.s.Token.ogre", name: "Ogre" };
const GOBLIN = { uuid: "Scene.s.Token.gob", name: "Goblin" };
const striker = foe => ({ uuid: foe.uuid, name: foe.name, type: "npc" });
const owedTo = (f, foe) => (f.flags[SYSTEM_ID][RAPIER_WIT_FLAG] ?? []).find(entry => entry.key === foe.uuid);

function card({ flags = {} } = {}) {
	const data = { [SYSTEM_ID]: { ...flags } };
	return {
		id: "msg1", flags: data,
		getFlag: (scope, key) => data[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { (data[scope] ??= {})[key] = value; }),
	};
}

describe("the posted card's button", () => {
	let saved;
	beforeEach(() => {
		saved = { ChatMessage: globalThis.ChatMessage, ui: globalThis.ui };
		globalThis.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) };
		globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
	});
	afterEach(() => { Object.assign(globalThis, saved); });

	const rendered = (f = fox()) => {
		const root = new Window().document.createElement("div");
		root.innerHTML = giveAdvantageCardHtml(f, HERO_MOVES.RAPIER_WIT);
		return { root, button: () => root.querySelector(".stonetop-rapier-wit") };
	};

	it("is on Rapier Wit's posted card for a Fox holding it learned, and wired from the chat hook", () => {
		expect(rendered().button()).not.toBeNull();
		expect(giveAdvantageCardHtml(fox({ moves: [] }), HERO_MOVES.RAPIER_WIT)).toBe("");
		const homebrew = { type: "move", name: HERO_MOVES.RAPIER_WIT, flags: { [SYSTEM_ID]: { custom: true } } };
		expect(giveAdvantageCardHtml(fox(), HERO_MOVES.RAPIER_WIT, homebrew)).toBe("");
		expect(readRepo("stonetop.js")).toContain("wireRapierWit(message, html);");
		expect(readRepo("stonetop.js")).toContain("CONFIG.queries[RAPIER_WIT_QUERY]");
	});

	it("records the targeted NPC on the Fox, both halves owed, and goes once pressed", async () => {
		const f = fox();
		const { root, button } = rendered(f);
		const message = card();
		wireRapierWit(message, root, { giver: f, usable: true, targets: () => [{ name: "Ogre", document: { uuid: OGRE.uuid } }], engaged: () => [] });
		button().click();
		await vi.waitFor(() => expect(message.getFlag(SYSTEM_ID, RAPIER_WIT_CARD_FLAG)).toEqual({ foe: "Ogre" }));
		expect(owedTo(f, OGRE)).toEqual({ key: OGRE.uuid, name: "Ogre", roll: true, blow: true });
		expect(globalThis.ChatMessage.create).toHaveBeenCalledTimes(1);

		// Drawn again, the card says who attacked instead of offering the button.
		const again = rendered(f);
		wireRapierWit(message, again.root, { giver: f, usable: true });
		expect(again.button()).toBeNull();
		expect(again.root.textContent).toContain("Ogre attacked");
	});

	it("is not offered to someone who cannot write the card and the Fox", () => {
		const { root, button } = rendered();
		wireRapierWit(card(), root, { giver: fox(), usable: false });
		expect(button()).toBeNull();
	});

	it("asks for a target with nobody targeted or fought, and records nothing", async () => {
		const f = fox();
		expect(await rapierWitAttack(card(), f, { targets: () => [], engaged: () => [] })).toBe(false);
		expect(globalThis.ui.notifications.info).toHaveBeenCalled();
		expect(f.setFlag).not.toHaveBeenCalled();
	});

	it("asks which foe among several, and falls back on the foes the Fox is fighting", async () => {
		const f = fox();
		const pick = vi.fn(async () => GOBLIN.uuid);
		expect(await rapierWitAttack(card(), f, { targets: () => [], engaged: () => [OGRE, GOBLIN], pick, resolve: () => null })).toBe(true);
		expect(pick).toHaveBeenCalledTimes(1);
		expect(owedTo(f, GOBLIN)).toMatchObject({ roll: true, blow: true });
		expect(owedTo(f, OGRE)).toBeUndefined();
	});

	it("records nothing for a Fox without Rapier Wit learned", async () => {
		expect(await recordRapierWit(fox({ moves: [] }), [OGRE])).toBe(false);
	});
});

describe("advantage on the Fox's next roll against them", () => {
	it("is imposed and named on a roll aimed at them, and spent by that roll", async () => {
		const f = fox();
		await recordRapierWit(f, [OGRE]);
		const self = { _actor: f };
		const first = StonetopCharacter.prototype._foldAimedModes.call(self, {}, [OGRE]);
		expect(first.options.conditionNotes).toContain(HERO_MOVES.RAPIER_WIT);
		expect(first.options.rollMode).toBe("adv");
		await first.spend();
		const second = StonetopCharacter.prototype._foldAimedModes.call(self, {}, [OGRE]);
		expect(second.options.conditionNotes ?? []).not.toContain(HERO_MOVES.RAPIER_WIT);
		// The other half is still owed: their next hit on the Fox.
		expect(owedTo(f, OGRE)).toMatchObject({ roll: false, blow: true });
	});

	it("names it on an attack's card too (foeAdvantage), and never against someone else", async () => {
		const f = fox();
		await recordRapierWit(f, [OGRE]);
		expect(foeAdvantage(f, [OGRE])).toBe(HERO_MOVES.RAPIER_WIT);
		expect(rapierWitAgainst(f, [GOBLIN])).toBeNull();
		expect(rapierWitAgainst(f, [OGRE, GOBLIN])).toBeNull();
		expect(await spendRapierWitRoll(f, [GOBLIN])).toBe(false);
	});

	it("is not owed once the move is no longer learned", async () => {
		const f = fox();
		await recordRapierWit(f, [OGRE]);
		f.items = [];
		expect(rapierWitAgainst(f, [OGRE])).toBeNull();
	});
});

describe("+1d4 on their next hit on the Fox", () => {
	const foxRow = { uuid: "Scene.s.Token.vesna" };
	const resolveTo = f => uuid => (uuid === foxRow.uuid ? { documentName: "Token", actor: f } : null);

	it("is a ticked line on that foe's damage window, spent when the blow is taken", async () => {
		const f = fox();
		await recordRapierWit(f, [OGRE]);
		const [line] = rapierWitOffers(striker(OGRE), [foxRow], { resolve: resolveTo(f) });
		expect(line).toMatchObject({ key: "rapierWit", dice: "1d4", applied: true, pill: "Rapier Wit +1d4" });
		expect(line.label).toContain("Vesna");
		await line.spend(striker(OGRE));
		expect(owedTo(f, OGRE)).toMatchObject({ roll: true, blow: false });
		expect(rapierWitOffers(striker(OGRE), [foxRow], { resolve: resolveTo(f) })).toEqual([]);
	});

	it("is not on a blow from another foe, nor on the foe's blow at someone else", async () => {
		const f = fox();
		await recordRapierWit(f, [OGRE]);
		expect(rapierWitOffers(striker(GOBLIN), [foxRow], { resolve: resolveTo(f) })).toEqual([]);
		const other = { uuid: "Scene.s.Token.bran" };
		const bran = { ...fox({ moves: [] }), id: "bran", name: "Bran" };
		const resolve = uuid => (uuid === other.uuid ? { documentName: "Token", actor: bran } : resolveTo(f)(uuid));
		expect(rapierWitOffers(striker(OGRE), [other], { resolve })).toEqual([]);
		// A blow at the Fox and another: one roll per card, so not against both.
		expect(rapierWitOffers(striker(OGRE), [foxRow, other], { resolve })).toEqual([]);
		expect(owedTo(f, OGRE)).toMatchObject({ blow: true });
	});

	it("is spent through the GM's client when this one cannot write the Fox", async () => {
		const f = fox({ owner: false });
		f.flags[SYSTEM_ID][RAPIER_WIT_FLAG] = [{ key: OGRE.uuid, name: "Ogre", roll: true, blow: true }];
		const gm = { query: vi.fn(async () => true) };
		expect(await spendRapierWitBlow(f, striker(OGRE), { gm, userId: "u1" })).toBe(true);
		expect(gm.query).toHaveBeenCalledWith(RAPIER_WIT_QUERY, { foxUuid: f.uuid, attackerUuid: OGRE.uuid, userId: "u1" }, expect.anything());
		expect(f.setFlag).not.toHaveBeenCalled();
	});

	it("the GM spends it only for whoever owns the one who struck", async () => {
		const saved = globalThis.game;
		try {
			const f = fox();
			f.flags[SYSTEM_ID][RAPIER_WIT_FLAG] = [{ key: OGRE.uuid, name: "Ogre", roll: true, blow: true }];
			const owner = { id: "u1", isGM: false };
			const stranger = { id: "u2", isGM: false };
			const users = { get: id => ({ u1: owner, u2: stranger })[id], activeGM: { id: "gm" } };
			globalThis.game = { user: { id: "gm", isGM: true }, users };
			const ogre = { ...striker(OGRE), testUserPermission: user => user === owner };
			const resolve = uuid => ({ [f.uuid]: f, [OGRE.uuid]: ogre })[uuid] ?? null;
			const data = { foxUuid: f.uuid, attackerUuid: OGRE.uuid };
			expect(await handleRapierWitQuery({ ...data, userId: "u2" }, {}, { users, resolve })).toBe(false);
			expect(rapierWitBlowOwed(f, ogre)).toBe(true);
			expect(await handleRapierWitQuery({ ...data, userId: "u1" }, {}, { users, resolve })).toBe(true);
			expect(rapierWitBlowOwed(f, ogre)).toBe(false);
		} finally {
			globalThis.game = saved;
		}
	});

	describe("on a counter-attack's damage card", () => {
		let posted;
		beforeEach(() => {
			posted = installCombatChatFakes({ user: { targets: new Set() } });
			globalThis.fromUuid = async () => ({ actor: { name: "Ogre", system: { attributes: { damage: { value: "club d8 (close)", rollFormula: "d8" } } } } });
		});
		afterEach(uninstallCombatChatFakes);
		const damageCard = () => cardWithFlag(posted, "damage");

		it("rides the foe's next blow on the Fox, named, then is spent", async () => {
			const f = fox();
			await recordRapierWit(f, [OGRE]);
			await sufferEnemyAttack(f, { targets: [OGRE] });
			const first = damageCard();
			expect(first.flags[SCOPE].damage.results[0].formula).toContain("1d4");
			expect(first.content).toContain("Rapier Wit +1d4");
			expect(owedTo(f, OGRE)).toMatchObject({ roll: true, blow: false });

			posted.length = 0;
			await sufferEnemyAttack(f, { targets: [OGRE] });
			expect(damageCard().flags[SCOPE].damage.results[0].formula).not.toContain("1d4");
		});

		it("is not on another foe's blow", async () => {
			const f = fox();
			await recordRapierWit(f, [OGRE]);
			await sufferEnemyAttack(f, { targets: [GOBLIN] });
			expect(damageCard().flags[SCOPE].damage.results[0].formula).not.toContain("1d4");
			expect(owedTo(f, OGRE)).toMatchObject({ blow: true });
		});
	});
});

// Fox re-audit, as Payback's grudges were ruled (the user's ruling, 2026-10-18): a quip at a NAMED foe (a
// linked actor) outlasts the fight; one at an unlinked token goes with it.
describe("when the fight ends", () => {
	const VILLAIN = { uuid: "Actor.villain", name: "Lord Ulm" };

	it("lets a quip at a token go and keeps one at a named foe until it is used", async () => {
		const f = fox();
		await recordRapierWit(f, [OGRE, VILLAIN]);
		await spendRapierWitRoll(f, [VILLAIN]);
		f.flags[SYSTEM_ID].harmedBy = ["Scene.s.Token.ogre"];
		expect(await clearRapierWit(f)).toBe(true);
		expect(f.flags[SYSTEM_ID][RAPIER_WIT_FLAG]).toEqual([{ key: VILLAIN.uuid, name: "Lord Ulm", roll: false, blow: true }]);
		// Nothing else on the Fox is touched.
		expect(f.flags[SYSTEM_ID].harmedBy).toEqual(["Scene.s.Token.ogre"]);
		expect(Object.keys(f.flags[SYSTEM_ID])).toEqual([RAPIER_WIT_FLAG, "harmedBy"]);
	});

	it("writes nothing when nothing is let go", async () => {
		const f = fox();
		expect(await clearRapierWit(f)).toBe(false);
		await recordRapierWit(f, [VILLAIN]);
		f.setFlag.mockClear();
		expect(await clearRapierWit(f)).toBe(false);
		expect(f.setFlag).not.toHaveBeenCalled();
	});
});
