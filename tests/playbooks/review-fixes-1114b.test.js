// The second 11-14 review of the homebrew-playbook round, fixed: a "+3 instead" roll picks no stat, a
// requirement note hides only what it says in full, a tier that says the form DOESN'T come is not read as
// bringing it, and a possession's own pick is owed exactly when holdsPossession says it is held.

import { describe, it, expect, afterEach } from "vitest";
import { isFixedRollValue } from "../../module/utils/roll-types.js";
import { requirementLabel } from "../../module/actors/character/move-requirement.js";
import { insertFormRollFor } from "../../module/actors/character/tier-effects.js";
import { invalidatePlaybookCatalog } from "../../module/playbooks/playbook-catalog.js";
import { SYSTEM_ID, ITEM_FLAG_SCOPE } from "../../module/system-id.js";
import { buildLiveCharacter } from "../fakes/LiveCharacter.js";

describe("a number rolled instead of a stat", () => {
	it("is told from a stat", () => {
		expect(isFixedRollValue("+3")).toBe(true);
		expect(isFixedRollValue("-1")).toBe(true);
		for (const stat of ["con", "ask", "fortunes", "", null, undefined, 3]) expect(isFixedRollValue(stat)).toBe(false);
	});
});

describe("a requirement note", () => {
	it("hides a required move only when it names it whole, and the level only when it says that level", () => {
		expect(requirementLabel({ moves: ["Wild"], note: "Wildborn background, level 2 or later" }, { level: 6 }))
			.toBe("Wild; Wildborn background, level 2 or later; level 6+");
		expect(requirementLabel({ moves: ["Wild"], note: "Requires Wild, level 6+" }, { level: 6 })).toBe("Wild, level 6+");
		expect(requirementLabel({ moves: ["Otherkin"], note: "Requires level 6+ and Otherkin" }, { level: 6 })).toBe("level 6+ and Otherkin");
		expect(requirementLabel({ note: "level 16 only" }, { level: 6 })).toBe("level 16 only; level 6+");
	});
});

describe("which tiers put an insert's form on", () => {
	const SLUG = "homebrew-the-stranger";
	afterEach(() => { delete globalThis.game; invalidatePlaybookCatalog(); });
	const tiersOf = moveResults => {
		invalidatePlaybookCatalog();
		globalThis.game = { items: [{ type: "playbook", name: "The Stranger", system: { slug: SLUG }, flags: { [ITEM_FLAG_SCOPE]: { homebrew: { v: 1 }, inserts: [{ key: "mc", form: { enabled: true } }] } } }] };
		const item = { type: "move", name: "Metamorphosis", flags: { [SYSTEM_ID]: { homebrewPlaybook: SLUG, homebrewInsert: { key: "mc" } } }, system: { moveResults } };
		return insertFormRollFor({ type: "character", items: [item], system: { playbook: { slug: SLUG } } }, "Metamorphosis")?.tiers ?? null;
	};
	const v = value => ({ value });

	it("leaves out a tier that says it doesn't happen", () => {
		expect(tiersOf({ success: v("You transform."), partial: v("Take on its traits."), failure: v("You fail to transform, and the GM makes a move.") }))
			.toEqual({ success: true, partial: true, failure: false });
		expect(tiersOf({ success: v("You can't turn into it yet."), partial: v(""), failure: v("") })).toBeNull();
	});

	it("reads \"as a 7+\" as doing what that tier does, and nothing when that tier gives no form", () => {
		expect(tiersOf({ success: v("Take on its traits."), partial: v("Take on its traits."), failure: v("As a 7+ but you lose yourself.") }))
			.toEqual({ success: true, partial: true, failure: true });
		expect(tiersOf({ success: v("Hold 3."), partial: v("As a 10+, but the GM picks one."), failure: v("You transform, but badly.") }))
			.toEqual({ success: false, partial: false, failure: true });
	});
});

describe("a possession's own pick is owed when it is held", () => {
	const options = [
		{ slug: "laboratory", label: "Laboratory", specialItems: ["reagents"] },
		{ slug: "reagents", label: "Reagents", choices: { pickCount: 1, options: [{ slug: "salt" }, { slug: "sulphur" }] } },
		{ slug: "pouch", label: "Sacred Pouch", grantOnly: true, choices: { pickCount: 1, options: [{ slug: "a" }, { slug: "b" }] } },
	];
	const playbookData = { specialPossessions: { preselected: [], options } };
	const live = (selected, items = []) => buildLiveCharacter({
		slug: "the-seeker", name: "The Seeker", level: 1, items,
		flags: { "possessions.selected": selected, "possessions.subChoices": {} },
	}).char;

	it("counts one made by another possession's specialItems", () => {
		expect(live(["laboratory"]).possessionChoicesOwed(playbookData).inline).toEqual(["reagents"]);
	});

	it("leaves out a grant whose every granter is switched off", () => {
		const granter = { type: "move", name: "Initiate", system: { crossPlaybook: { grantsPossession: "pouch" } }, flags: { [SYSTEM_ID]: { learned: false } } };
		const char = live(["pouch"], [granter]);
		expect(char._grantSuspended("pouch", playbookData)).toBe(true);
		expect(char.possessionChoicesOwed(playbookData).inline).toEqual([]);
	});
});
