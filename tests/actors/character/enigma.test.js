import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
	isItinerantMystic, enigmaHeld, canSpendEnigma, enigmaAfterGain, wanderingEnigma, enigmaPaysForItem,
	enigmaForItem, enigmaUses, spendEnigma, gainEnigma,
	ENIGMA_KEY, ENIGMA_MAX, ENIGMA_START, WANDERING_ENIGMA,
} from "../../../module/actors/character/enigma.js";

// The Lightbearer's Itinerant Mystic: "hold 1 Enigma if you're gone for days, 2 if you're gone for weeks, or 3 if
// you're gone for months. At the very start of play, hold 3 Enigma. Spend Enigma 1-for-1 to: return ...; Know
// Things as if you rolled a 10+ ...; or Have What You Need to produce an oddly specific yet mundane item of
// Value 1 or less."

const SCOPE = "stonetop-pwd";

// A character whose background store is the one the Details tab's circles write (CharacterBackgrounds).
function mystic({ background = "itinerant-mystic", playbook = "The Lightbearer", enigma, type = "character" } = {}) {
	const setupResources = enigma === undefined ? {} : { [ENIGMA_KEY]: enigma };
	const actor = {
		id: "a1", name: "Ysolde", type,
		system: { playbook: { name: playbook } },
		flags: { [SCOPE]: { background: { selected: background, setupResources } } },
	};
	actor.typedActor = {
		background: {
			setSetupResource: vi.fn(async (key, value) => { actor.flags[SCOPE].background.setupResources[key] = value; }),
		},
	};
	return actor;
}

describe("isItinerantMystic", () => {
	it("is the Lightbearer's Itinerant Mystic background only", () => {
		expect(isItinerantMystic(mystic())).toBe(true);
		expect(isItinerantMystic(mystic({ background: "auspicious-birth" }))).toBe(false);
		expect(isItinerantMystic(mystic({ playbook: "The Seeker" }))).toBe(false);
		expect(isItinerantMystic(mystic({ type: "npc" }))).toBe(false);
		expect(isItinerantMystic(null)).toBe(false);
	});
});

describe("enigmaHeld", () => {
	it("reads the stored background track", () => {
		expect(enigmaHeld(mystic({ enigma: 5 }))).toBe(5);
		expect(enigmaHeld(mystic({ enigma: 0 }))).toBe(0);
	});

	it("holds the start of play's 3 while nothing is stored, as the Details tab shows", () => {
		expect(ENIGMA_START).toBe(3);
		expect(enigmaHeld(mystic())).toBe(3);
	});

	it("clamps to the track and is 0 for anyone else", () => {
		expect(enigmaHeld(mystic({ enigma: 40 }))).toBe(ENIGMA_MAX);
		expect(enigmaHeld(mystic({ enigma: -2 }))).toBe(0);
		expect(enigmaHeld(mystic({ background: "soul-on-fire", enigma: 4 }))).toBe(0);
		expect(canSpendEnigma(mystic({ enigma: 0 }))).toBe(false);
		expect(canSpendEnigma(mystic({ enigma: 1 }))).toBe(true);
	});
});

describe("gaining Enigma", () => {
	it("days 1, weeks 2, months 3", () => {
		expect(WANDERING_ENIGMA).toEqual({ days: 1, weeks: 2, months: 3 });
		expect(wanderingEnigma("days")).toBe(1);
		expect(wanderingEnigma("weeks")).toBe(2);
		expect(wanderingEnigma("months")).toBe(3);
		expect(wanderingEnigma("years")).toBe(0);
	});

	it("caps at the track's size", () => {
		expect(enigmaAfterGain(2, 3)).toBe(5);
		expect(enigmaAfterGain(8, 3)).toBe(ENIGMA_MAX);
		expect(enigmaAfterGain(ENIGMA_MAX, 1)).toBe(ENIGMA_MAX);
		expect(enigmaAfterGain(1, -4)).toBe(1);
	});

	it("writes through the background store, capped, and skips a full track", async () => {
		const a = mystic({ enigma: 7 });
		expect(await gainEnigma(a, 3)).toEqual({ before: 7, after: ENIGMA_MAX });
		expect(a.typedActor.background.setSetupResource).toHaveBeenCalledWith(ENIGMA_KEY, ENIGMA_MAX);
		a.typedActor.background.setSetupResource.mockClear();
		expect(await gainEnigma(a, 1)).toEqual({ before: ENIGMA_MAX, after: ENIGMA_MAX });
		expect(a.typedActor.background.setSetupResource).not.toHaveBeenCalled();
	});

	it("gives nothing to a character who is not an Itinerant Mystic", async () => {
		const a = mystic({ background: "auspicious-birth", enigma: 0 });
		expect(await gainEnigma(a, 2)).toBeNull();
		expect(a.typedActor.background.setSetupResource).not.toHaveBeenCalled();
	});
});

describe("spendEnigma", () => {
	it("takes 1 off the held count and answers what is left", async () => {
		const a = mystic({ enigma: 2 });
		expect(await spendEnigma(a)).toBe(1);
		expect(enigmaHeld(a)).toBe(1);
	});

	it("spends from the start of play's 3 when nothing is stored", async () => {
		const a = mystic();
		expect(await spendEnigma(a)).toBe(2);
		expect(a.typedActor.background.setSetupResource).toHaveBeenCalledWith(ENIGMA_KEY, 2);
	});

	it("writes nothing with none held", async () => {
		const a = mystic({ enigma: 0 });
		expect(await spendEnigma(a)).toBeNull();
		expect(a.typedActor.background.setSetupResource).not.toHaveBeenCalled();
	});
});

describe("Know Things source (enigmaUses)", () => {
	it("is held-count shaped: left = held, spent = what the track lacks", () => {
		expect(enigmaUses(mystic({ enigma: 4 }))).toEqual({ left: 4, max: ENIGMA_MAX, spent: ENIGMA_MAX - 4 });
	});

	it("draws no button for anyone else, and none at 0 held", () => {
		expect(enigmaUses(mystic({ background: "auspicious-birth", enigma: 3 }))).toBeNull();
		expect(enigmaUses(mystic({ enigma: 0 })).left).toBe(0);
	});

	// stonetop.js registers its hooks on import, so the wiring is read off the source.
	it("is one of the Know Things card's upgrade sources, read and spent through enigma.js", () => {
		const src = fs.readFileSync(path.resolve("stonetop.js"), "utf8");
		const body = name => src.slice(src.indexOf(`function ${name}(`), src.indexOf("\n}\n", src.indexOf(`function ${name}(`)));
		const sources = body("_knowThingsUpgradeSources");
		expect(sources).toContain("key: ENIGMA_KEY");
		expect(sources).toContain("read:  () => enigmaUses(actor)");
		expect(sources).toContain("spend: () => spendEnigma(actor)");
		// The button is drawn only for a source that reads a count above 0 (null for a non-Mystic).
		expect(body("_wireLogbook")).toContain(".filter(({ uses }) => uses && uses.left > 0);");
		expect(body("_upgradeKnowThings")).toContain("if (!now || now.left <= 0) return { upgraded: false, empty: true };");
	});
});

describe("Have What You Need with Enigma", () => {
	it("pays for an item of Value 1 or less, or one that prints no Value", () => {
		expect(enigmaPaysForItem({ value: 0 })).toBe(true);
		expect(enigmaPaysForItem({ value: 1 })).toBe(true);
		expect(enigmaPaysForItem({ value: null })).toBe(true);
		expect(enigmaPaysForItem({ value: 2 })).toBe(false);
	});

	it("never pays for a treasure, which is not mundane", () => {
		expect(enigmaPaysForItem({ value: 0, treasure: true })).toBe(false);
	});

	it("reads the Value off the item's tag line", () => {
		const a = mystic({ enigma: 2 });
		expect(enigmaForItem(a, { note: "<em>fragile</em>, Value 1" })).toBe(2);
		expect(enigmaForItem(a, { note: "" })).toBe(2);
		expect(enigmaForItem(a, { note: "fragile, Value 3" })).toBe(0);
		expect(enigmaForItem(a, { note: "Value 0", treasure: true })).toBe(0);
	});

	it("is offered only to an Itinerant Mystic holding Enigma", () => {
		expect(enigmaForItem(mystic({ enigma: 0 }), { note: "" })).toBe(0);
		expect(enigmaForItem(mystic({ background: "soul-on-fire", enigma: 3 }), { note: "" })).toBe(0);
	});
});
