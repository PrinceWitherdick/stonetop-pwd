// ONE "book move, not homebrew" lookup (owns-move.js#bookMoveName). A move a player wrote that shares a
// book move's name (a homebrew "Know Things") acts as itself: every table keyed by the book's move names
// looks a move up through bookMoveName, which answers null for theirs.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_ID } from "../../../module/system-id.js";
import { bookMoveName, ownedLearnedBookMove } from "../../../module/actors/character/owns-move.js";
import { isPcAskMove } from "../../../module/pc-asks/pc-ask-rules.js";
import { attackMoveFor, grantedWeaponAttackFor } from "../../../module/combat/attack-flow.js";
import { spendSurpriseForRoll, PREPARE_A_WELCOME } from "../../../module/combat/battle-holds.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(HERE, "../../..", rel), "utf8");

const book = name => ({ type: "move", name, flags: {}, system: {} });
const homebrew = name => ({ type: "move", name, flags: { [SYSTEM_ID]: { custom: true } }, system: {} });

describe("bookMoveName", () => {
	it("is the move's name for the book's move and null for a player's own", () => {
		expect(bookMoveName(book("Know Things"))).toBe("Know Things");
		expect(bookMoveName(homebrew("Know Things"))).toBeNull();
		// A GM-dropped foreign move lands as "other", and is still the book's.
		expect(bookMoveName({ ...book("Ambush"), system: { moveType: "other" } })).toBe("Ambush");
	});

	it("takes the name a sheet row is read by, and a row with no item is the book's", () => {
		expect(bookMoveName(null, "Danu's Grasp")).toBe("Danu's Grasp");
		expect(bookMoveName(homebrew("Danu's Grasp"), "Danu's Grasp")).toBeNull();
		expect(bookMoveName(null)).toBeNull();
	});

	it("keys the book-move lookups: owned book move, a PC ask, a playbook attack, a granted weapon", () => {
		const actor = { items: [homebrew("Purifying Flames")] };
		expect(ownedLearnedBookMove(actor, "Purifying Flames")).toBeUndefined();
		expect(ownedLearnedBookMove({ items: [book("Purifying Flames")] }, "Purifying Flames")).toBeTruthy();
		expect(isPcAskMove(book("Aid"))).toBe(true);
		expect(isPcAskMove(homebrew("Aid"))).toBe(false);
		expect(attackMoveFor(book("Ambush"))).toBeTruthy();
		expect(attackMoveFor(homebrew("Ambush"))).toBeNull();
		// The basic moves are the book's whatever wrote them: nothing but Clash is called Clash.
		expect(attackMoveFor(homebrew("Clash"))).toBe(attackMoveFor(book("Clash")));
		expect(grantedWeaponAttackFor({ items: [book("Clash")] }, homebrew("Purifying Flames"))).toBeNull();
		expect(grantedWeaponAttackFor({ items: [book("Clash")] }, book("Purifying Flames"))).toBeTruthy();
	});
});

// The lookups that forgot the guard until it was one function (an intended change).
describe("the lookups that used to forget it", () => {
	it("a homebrew Prepare a Welcome spends no Surprise", async () => {
		const setUses = vi.fn(async () => {});
		const actor = {
			items: [{ ...book(PREPARE_A_WELCOME), system: { resource: { max: 2, title: "Surprise" } } }],
			typedActor: { moveResources: { getMoveResources: () => ({ [PREPARE_A_WELCOME]: 2 }), setUses } },
		};
		expect(await spendSurpriseForRoll(actor, homebrew(PREPARE_A_WELCOME))).toBeNull();
		expect(setUses).not.toHaveBeenCalled();
	});

	it("a homebrew Battle Joy, a move's use and roll effects key through it", () => {
		const character = read("module/actors/character/StonetopCharacter.js");
		expect(character).toContain("if (bookMoveName(item) !== BATTLE_JOY) return false;");
		const sheet = read("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toContain("await MOVE_USE_EFFECTS[bookMoveName(item)]?.(this);");
		expect(sheet).toContain("const effect = name ? MOVE_ROLL_EFFECTS[name] : null;");
		expect(sheet).toContain("MOVE_ROLL_INSTEAD[bookMoveName(insteadItem)]");
		expect(sheet).toContain("GUIDED_CHARACTER_MOVES[bookMoveName(item, name)]");
		// One guard: nothing outside owns-move.js asks the authorship question for a lookup of its own.
		expect(sheet).not.toContain("isPlayerAuthoredMove");
		expect(read("module/item/StonetopItem.js")).not.toContain("isPlayerAuthoredMove");
	});
});
