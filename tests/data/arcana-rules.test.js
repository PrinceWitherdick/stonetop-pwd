import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	ARCANA_RIDERS, ARCANA_RULE_SLUGS, ARCANA_WEAPONS, isArcanumWeapon, noteArcanumBack, ruleBoxes, ruleMarked,
} from "../../module/data/arcana-rules.js";

// The per-card arcana rules name every box by its printed label, so a card whose printed boxes move
// (CharacterArcana.js#BOX_LAYOUT_CHANGES) moves the rule with it.

const PACKS = path.resolve(__dirname, "../../packs/src/stonetop-arcana");
const card = file => JSON.parse(fs.readFileSync(path.join(PACKS, file), "utf8")).flags.stonetop;

describe("the per-card arcana rules", () => {
	it("find a box again when the card's printed boxes move", () => {
		const doom = ARCANA_RIDERS.promiseOfDoom;
		noteArcanumBack(doom.slug, `<p>□ WHISPERS</p><p>□ ${doom.label}</p>`);
		expect(ruleBoxes(doom)).toEqual([1]);
		expect(ruleMarked({ "twisted-spear:back:1": true }, doom)).toBe(true);
		// Two boxes printed above it later: the same words, two boxes on.
		noteArcanumBack(doom.slug, `<p>□□ NEW</p><p>□ WHISPERS</p><p>□ ${doom.label}</p>`);
		expect(ruleBoxes(doom)).toEqual([3]);
		expect(ruleMarked({ "twisted-spear:back:1": true }, doom)).toBe(false);
	});

	it("keep only the backs of the cards they read", () => {
		expect(ARCANA_RULE_SLUGS).toEqual(expect.arrayContaining(["storm-markings", "twisted-spear", "norubas-ice-sphere", "redwood-effigy"]));
		expect(ARCANA_RULE_SLUGS).not.toContain("demonhide-cloak");
		noteArcanumBack("rusty-steel-blade", "<p>□ SOMETHING</p>");
		expect(ruleBoxes({ slug: "rusty-steel-blade", label: "SOMETHING" })).toEqual([]);
	});

	it("name each card's weapon as its realised side prints it", () => {
		const files = { flamingSword: "minor/rusty-steel-blade.json", aetheriumSpear: "minor/corroded-spearhead.json", thunderboltBow: "minor/bow-with-no-string.json" };
		for (const [key, file] of Object.entries(files)) expect(card(file).back.item.name).toBe(ARCANA_WEAPONS[key].name);
		expect(isArcanumWeapon({ slug: "corroded-spearhead", name: " aetherium spear " }, ARCANA_WEAPONS.aetheriumSpear)).toBe(true);
		expect(isArcanumWeapon({ slug: "corroded-spearhead", name: "Corroded spearhead" }, ARCANA_WEAPONS.aetheriumSpear)).toBe(false);
		expect(isArcanumWeapon(null, ARCANA_WEAPONS.aetheriumSpear)).toBe(false);
	});
});
