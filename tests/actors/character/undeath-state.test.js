import { describe, expect, it } from "vitest";
import {
	DEATHS_DOOR_STATE, ZERO_HP_MOVES, isDeathsDoorCard, isUndeathCard, isZeroHpMoveCard, lostToTheGm, stateOnTakingInsert,
} from "../../../module/actors/character/deaths-door.js";
import { isOutOfPlay } from "../../../module/actors/character/deaths-door-actor.js";
import { canCamp } from "../../../module/camp/camp-store.js";
import { ROLLED_FLAG, rolledRecord } from "../../../module/utils/counted-tier.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { readRepo } from "../../fakes/css.js";

/**
 * R-HP: taking an insert at the Door is coming back, not getting up. Whoever takes one while dying, owing a
 * fate or dead returns out of the action at 0 HP; "Back on your feet" is what brings them up.
 */
describe("stateOnTakingInsert", () => {
	it("returns anyone at the Door out of the action, at 0 HP", () => {
		for (const state of [DEATHS_DOOR_STATE.DYING, DEATHS_DOOR_STATE.FATE_PENDING, DEATHS_DOOR_STATE.DEAD]) {
			expect(stateOnTakingInsert(state), state).toEqual({ state: DEATHS_DOOR_STATE.OUT_OF_ACTION, atTheDoor: true });
		}
	});

	it("leaves the living up and the out-of-action where they are", () => {
		expect(stateOnTakingInsert(null)).toEqual({ state: null, atTheDoor: false });
		expect(stateOnTakingInsert(DEATHS_DOOR_STATE.OUT_OF_ACTION))
			.toEqual({ state: DEATHS_DOOR_STATE.OUT_OF_ACTION, atTheDoor: false });
	});
});

/** B6: how the card words someone who left play without passing the Last Door. */
describe("lostToTheGm", () => {
	const dead = DEATHS_DOOR_STATE.DEAD;

	it("names a Ghost or Revenant who marked the Final Consequence a monster", () => {
		expect(lostToTheGm({ state: dead, insertSlug: "ghost", finalConsequence: true })).toBe("monster");
		expect(lostToTheGm({ state: dead, insertSlug: "revenant", finalConsequence: true })).toBe("monster");
	});

	// Their Terrible Purpose fulfilled: they did pass through the Last Door.
	it("leaves a Ghost or Revenant who is dead without it to the plain card", () => {
		expect(lostToTheGm({ state: dead, insertSlug: "ghost" })).toBeNull();
	});

	it("names a dead Thrall (Unholy Vessel) a threat", () => {
		expect(lostToTheGm({ state: dead, insertSlug: "thrall" })).toBe("threat");
	});

	it("says nothing for anyone not dead, or dead with no insert", () => {
		expect(lostToTheGm({ state: DEATHS_DOOR_STATE.OUT_OF_ACTION, insertSlug: "ghost", finalConsequence: true })).toBeNull();
		expect(lostToTheGm({ state: dead })).toBeNull();
	});
});

/** B6: out of play is `dead`, whatever insert is worn. */
describe("isOutOfPlay, and the party lists that ask it", () => {
	const actor = flags => {
		const a = new FakeActorBuilder().withFlags(flags).build();
		a.type = "character";
		return a;
	};

	it("counts a Ghost lost to the Final Consequence out, where its past-death kind still said 'ghost'", () => {
		const lost = actor({ deathsDoor: DEATHS_DOOR_STATE.DEAD, postDeathInsert: { slug: "ghost" } });
		expect(isOutOfPlay(lost)).toBe(true);
		expect(canCamp(lost)).toBe(false);
	});

	it("keeps a dispersed Ghost, a Thrall and the living in play", () => {
		for (const flags of [
			{ deathsDoor: DEATHS_DOOR_STATE.OUT_OF_ACTION, postDeathInsert: { slug: "ghost" } },
			{ postDeathInsert: { slug: "thrall" } },
			{},
		]) {
			expect(isOutOfPlay(actor(flags))).toBe(false);
			expect(canCamp(actor(flags))).toBe(true);
		}
		expect(isOutOfPlay(null)).toBe(false);
	});

	// The four party lists ask the one rule, never the display kind.
	it("is what the struggle, the expedition and the PC asks filter on", () => {
		for (const file of ["module/struggle/StruggleSetupDialog.js", "module/dialogs/ExpeditionDialog.js", "module/pc-asks/pc-ask-flow.js"]) {
			const src = readRepo(file);
			expect(src, file).toMatch(/!isOutOfPlay\(/);
			expect(src, file).not.toMatch(/actorPastDeathKind\([^)]*\)\s*!==\s*"dead"/);
		}
	});
});

/** B9: the insert moves' cards are settled by their window, like Death's Door's. */
describe("isUndeathCard / isZeroHpMoveCard", () => {
	const cardOf = move => {
		const store = { [ROLLED_FLAG]: rolledRecord("", { moveName: move }) };
		return { getFlag: (scope, key) => (scope === "stonetop-pwd" ? store[key] : undefined) };
	};

	it("knows Undying, Tethered and Dark Succor's cards, and keeps Death's Door its own", () => {
		for (const slug of ["revenant", "ghost", "thrall"]) {
			const card = cardOf(ZERO_HP_MOVES[slug].name);
			expect(isUndeathCard(card), slug).toBe(true);
			expect(isZeroHpMoveCard(card), slug).toBe(true);
			// Impetuous Youth's "give it your all" is offered by Death's Door's window alone.
			expect(isDeathsDoorCard(card), slug).toBe(false);
		}
		const door = cardOf(ZERO_HP_MOVES.null.name);
		expect(isUndeathCard(door)).toBe(false);
		expect(isZeroHpMoveCard(door)).toBe(true);
		expect(isZeroHpMoveCard(cardOf("Defy Danger"))).toBe(false);
		expect(isZeroHpMoveCard(null)).toBe(false);
	});

	it("keeps Burn Brightly and the GM's Shift off every 0-HP move's card, Death's Door's included", () => {
		const main = readRepo("stonetop.js");
		expect(main).toMatch(/if \(!alreadyBurned\) \{[^}]*?if \(isZeroHpMoveCard\(message\)\) return;/);
		// Death's Door's window writes its tier the moment it lands and never reads the card again, so a GM's
		// Shift there relabelled the card and left the sheet on the old tier (audit DD-2).
		expect(main).toMatch(/const showShift = game\.user\.isGM && getSetting\("chatShiftButtons"\) && !isZeroHpMoveCard\(message\);/);
	});
});
