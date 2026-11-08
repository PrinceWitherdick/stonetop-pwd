// readOptionDamage over the post-death inserts' own bullets, read off the SHIPPED pack text:
//  - B15: the Thrall's Urges 7-9, "Harm yourself (d6 damage, ignores armor) to regain control", had no
//    button, because "harm" was not among the verbs that say somebody is taking it.
//  - Bodysnatcher's 7-9, "They do it, but it costs you, lose 2d4 HP", is HP lost rather than damage dealt:
//    the reader's own, armor no object, and the button says so.

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { readOptionDamage } from "../../module/utils/damage.js";
import { firstOptionList } from "../../module/utils/chat.js";
import { stripHtmlToText } from "../../module/utils/strings.js";

const bullets = rel => (firstOptionList(JSON.parse(fs.readFileSync(path.resolve("packs/src/stonetop-items", rel), "utf8")).system.description)?.items ?? [])
	.map(stripHtmlToText);

describe("the Thrall's Urges", () => {
	it("grows a button on Harm yourself: d6, the Thrall's own, ignoring armor", () => {
		const [struggle, act, harm] = bullets("post-death-moves/thrall/urges.json");
		expect(harm).toMatch(/^Harm yourself/);
		expect(readOptionDamage(harm)).toMatchObject({ formula: "1d6", isRoll: true, self: true, ignoresArmor: true });
		expect(readOptionDamage(struggle)).toBeNull();
		expect(readOptionDamage(act)).toBeNull();
	});
});

describe("HP lost", () => {
	it("reads Bodysnatcher's 2d4 as the ghost's own HP, armor no object", () => {
		const [resist, costs] = bullets("post-death-moves/ghost/bodysnatcher.json");
		expect(readOptionDamage(resist)).toBeNull();
		expect(readOptionDamage(costs)).toEqual({
			formula: "2d4", isRoll: true, self: true, ignoresArmor: true, piercing: 0, tags: [], hpLoss: true,
		});
	});

	it("leaves HP somebody else loses, and a max HP, alone", () => {
		expect(readOptionDamage("They lose 1d4 HP")).toBeNull();
		expect(readOptionDamage("The foe loses 1d4 HP")).toBeNull();
		// Somebody else losing something else in the same line leaves the reader's own loss standing.
		expect(readOptionDamage("Lose 1d8 HP and mark a debility; the cloak loses 1 Charge, or it loses all of them")).toMatchObject({ formula: "1d8", hpLoss: true });
		expect(readOptionDamage("Reduce your max HP by 2")).toBeNull();
		// Damage still reads as damage, not as HP lost.
		expect(readOptionDamage("You take 1d6 damage and lose 1 HP").hpLoss).toBeUndefined();
	});

	// A bonus rides another roll and is refused; the HP the same line costs its reader is still owed.
	it("still reads the HP lost on a line whose damage is a bonus", () => {
		expect(readOptionDamage("Erupt in a flurry of violence (area, +2 damage, lose 2d4 HP)"))
			.toMatchObject({ formula: "2d4", self: true, hpLoss: true });
		expect(readOptionDamage("Deal 1d6 extra damage, but lose 1d4 HP")).toMatchObject({ formula: "1d4", hpLoss: true });
		expect(readOptionDamage("Deal +1d4 damage")).toBeNull();
	});
});
