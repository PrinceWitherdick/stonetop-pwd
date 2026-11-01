// The one reading of "does this character's insert hold lore option X" (module/actors/character/insert-lore.js),
// which a Thrall's Marks, a Ghost's Bodysnatcher and the manifestation's insert guard all ask.

import { describe, expect, it } from "vitest";
import { SYSTEM_ID } from "../../../module/system-id.js";
import { holdsLoreOption, isLoreFollowerRecord, wornInsertSlug } from "../../../module/actors/character/insert-lore.js";
import { hasThrallMark } from "../../../module/actors/character/thrall-marks.js";

const wearing = (slug, counts = {}) => ({ flags: { [SYSTEM_ID]: { postDeathInsert: { slug }, postDeathLore: { counts } } } });

describe("holdsLoreOption", () => {
	it("holds a marked option of the insert worn", () => {
		const ghost = wearing("ghost", { "consequences:bodysnatcher": 1 });
		expect(wornInsertSlug(ghost)).toBe("ghost");
		expect(holdsLoreOption(ghost, "consequences:bodysnatcher", { insert: "ghost" })).toBe(true);
	});

	it("does not hold an unmarked option, another insert's option, or anything without an insert named", () => {
		const ghost = wearing("ghost", { "consequences:bodysnatcher": 0, "marks:ravenous": 1 });
		expect(holdsLoreOption(ghost, "consequences:bodysnatcher", { insert: "ghost" })).toBe(false);
		expect(holdsLoreOption(ghost, "marks:ravenous", { insert: "thrall" })).toBe(false);
		expect(holdsLoreOption(ghost, "marks:ravenous")).toBe(false);
		expect(holdsLoreOption(null, "marks:ravenous", { insert: "thrall" })).toBe(false);
		expect(holdsLoreOption(wearing(undefined, { "marks:ravenous": 1 }), "marks:ravenous", { insert: "thrall" })).toBe(false);
	});

	it("is what hasThrallMark asks", () => {
		const thrall = wearing("thrall", { "marks:ravenous": 1 });
		expect(hasThrallMark(thrall, "ravenous")).toBe(true);
		expect(hasThrallMark(thrall, "a-festering-rot")).toBe(false);
		expect(hasThrallMark(thrall, "")).toBe(false);
		expect(hasThrallMark(wearing("revenant", { "marks:ravenous": 1 }), "ravenous")).toBe(false);
	});
});

describe("isLoreFollowerRecord", () => {
	it("knows a lore option's card by its sourceUuid", () => {
		expect(isLoreFollowerRecord({ sourceUuid: "post-death:home-to-vermin" })).toBe(true);
		expect(isLoreFollowerRecord({ sourceUuid: "Actor.abc" })).toBe(false);
		expect(isLoreFollowerRecord(null)).toBe(false);
	});
});
