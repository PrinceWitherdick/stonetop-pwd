import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
	SUMMON_BOX_GATES, followerReadinessBonus, summonBlocker, summonBlockedMessage, summonHeldElsewhere,
	summonHeldElsewhereText, summonHoldersBySource, summonRealised,
} from "../../../module/data/arcana-summon-gates.js";
import { buildCustomFollower } from "../../../module/data/follower-build.js";
import { arcanaSummon } from "../../../module/data/arcana-summons.js";
import { boxIndexBefore } from "../../../module/utils/glyphs.js";

// Arcana audit 2026-11-04, fixer SKR: A4 (every summon waits on a realised back; the Demonhide Cloak also on
// its "becomes a follower" Consequence), A16 (a gold caution when another character has the same follower),
// MNB-12 (the Bronze Protector's +1 Readiness on a 7+ Defend).

const SCOPE = "stonetop-pwd";
const DEMONHIDE = JSON.parse(fs.readFileSync(path.resolve("packs/src/stonetop-arcana/major/demonhide-cloak.json"), "utf8")).flags.stonetop;

describe("A4: a summon waits on its card's back being realised", () => {
	it("needs the card identified, then unlocked", () => {
		expect(summonBlocker("metal-man", { identified: false, unlocked: true })).toBe("identify");
		expect(summonBlocker("metal-man", { identified: true, unlocked: false })).toBe("unlock");
		expect(summonBlocker("metal-man", { identified: true, unlocked: true })).toBeNull();
		// A homebrew card's slug follows the same rule: nothing is special-cased but the Cloak.
		expect(summonRealised("my-homebrew-charm", { identified: true, unlocked: false })).toBe(false);
		expect(summonRealised("my-homebrew-charm", { identified: true, unlocked: true })).toBe(true);
	});

	it("holds the Demonhide Cloak until the Consequence that makes it a follower is ticked, found by its words", () => {
		const back = DEMONHIDE.back.description;
		const index = boxIndexBefore(back, SUMMON_BOX_GATES["demonhide-cloak"]);
		expect(index).toBeGreaterThanOrEqual(0);
		const state = { identified: true, unlocked: true, backDescription: back };
		expect(summonBlocker("demonhide-cloak", { ...state, boxStates: {} })).toBe("box");
		// Another Consequence ticked is not this one.
		expect(summonBlocker("demonhide-cloak", { ...state, boxStates: { [`demonhide-cloak:back:${index - 1}`]: true } })).toBe("box");
		expect(summonBlocker("demonhide-cloak", { ...state, boxStates: { [`demonhide-cloak:back:${index}`]: true } })).toBeNull();
	});

	it("says what to do in words the player can act on", () => {
		expect(summonBlockedMessage("identify", { title: "A metal man", names: "Bronze Protector" })).toMatch(/^Identify A metal man first/);
		expect(summonBlockedMessage("unlock", { slug: "ring-of-daagon" })).toContain("last mark");
		expect(summonBlockedMessage("unlock", { title: "A metal man", names: "Bronze Protector" }))
			.toBe("Unlock the mysteries of A metal man first: then Bronze Protector becomes a follower.");
		expect(summonBlockedMessage("box", { slug: "demonhide-cloak", title: "Demonhide Cloak", names: "The Cloak" }))
			.toContain("You begin to hear the voices");
	});
});

describe("A16: the same follower already serving another character", () => {
	const actor = (id, name, followers, type = "character") => ({
		id, name, type, getFlag: (scope, key) => (scope === SCOPE && key === "customFollowers" ? followers : undefined),
	});
	const protector = arcanaSummon("metal-man").followers;

	it("finds another character's follower by its sourceUuid, never this character's own", () => {
		const actors = [
			actor("me", "Wren", { a: { name: "Bronze Protector", sourceUuid: "metal-man:bronze-protector" } }),
			actor("bram", "Bram", { b: { name: "Old Clank", sourceUuid: "metal-man:bronze-protector" } }),
			actor("cora", "Cora", { c: { name: "Someone else", sourceUuid: "other:thing" } }),
			actor("npc", "A steading", { d: { sourceUuid: "metal-man:bronze-protector" } }, "steading"),
		];
		expect(summonHeldElsewhere(actors, "me", protector, { scope: SCOPE }))
			.toEqual([{ actorId: "bram", actorName: "Bram", followerName: "Old Clank" }]);
	});

	it("ignores a fallen one and a repeatable summon (a fresh Servant batch each time)", () => {
		const actors = [actor("bram", "Bram", {
			b: { name: "Bronze Protector", sourceUuid: "metal-man:bronze-protector", dead: true },
			s: { name: "Servants", sourceUuid: "ring-of-daagon:servant-of-daagon" },
		})];
		expect(summonHeldElsewhere(actors, "me", protector, { scope: SCOPE })).toEqual([]);
		expect(summonHeldElsewhere(actors, "me", [{ name: "Servants", sourceUuid: "ring-of-daagon:servant-of-daagon", repeatable: true }], { scope: SCOPE })).toEqual([]);
	});

	it("words the caution as a flag, not a refusal", () => {
		expect(summonHeldElsewhereText([])).toBe("");
		const text = summonHeldElsewhereText([
			{ actorName: "Bram", followerName: "Astor" }, { actorName: "Cora", followerName: "Halix" },
		]);
		expect(text).toMatch(/^Bram already has Astor & Cora already has Halix as a follower\./);
		expect(text).toContain("GM's call");
	});

	it("reads one holders map for several cards, in the order the actors come", () => {
		const actors = [
			actor("bram", "Bram", { b: { name: "", sourceUuid: "metal-man:bronze-protector" } }),
			actor("cora", "Cora", { c: { name: "Astor", sourceUuid: "blackwood-fetishes:astor" } }),
		];
		const holders = summonHoldersBySource(actors, "me", { scope: SCOPE });
		const wanted = [{ name: "Astor", sourceUuid: "blackwood-fetishes:astor" }, ...protector];
		expect(summonHeldElsewhere([], "me", wanted, { holders })).toEqual([
			{ actorId: "bram", actorName: "Bram", followerName: "Bronze Protector" },
			{ actorId: "cora", actorName: "Cora", followerName: "Astor" },
		]);
	});
});

describe("MNB-12: the Bronze Protector holds +1 Readiness on a 7+ Defend", () => {
	it("is on the metal man's summon row, and carried onto the follower it makes", () => {
		const row = arcanaSummon("metal-man").followers[0];
		expect(row.readinessBonus).toBe(1);
		const record = buildCustomFollower(row);
		expect(record.readinessBonus).toBe(1);
		expect(followerReadinessBonus(record)).toBe(1);
	});

	it("is found for a Protector summoned before the record carried it, and is 0 for everyone else", () => {
		expect(followerReadinessBonus({ name: "Bronze Protector", sourceUuid: "metal-man:bronze-protector" })).toBe(1);
		expect(followerReadinessBonus({ name: "Astor", sourceUuid: "blackwood-fetishes:astor" })).toBe(0);
		expect(followerReadinessBonus({ name: "Hari" })).toBe(0);
		expect(buildCustomFollower({ name: "Hari" })).not.toHaveProperty("readinessBonus");
	});
});
