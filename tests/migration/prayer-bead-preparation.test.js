import { describe, it, expect, vi } from "vitest";
import { adoptAllPrayerBeadPips } from "../../module/migration/prayer-bead-preparation.js";

// The sweep hands each character to StonetopCharacter#adoptPrayerBeadPips (tested in bolster.test.js) and
// counts the ones it wrote to.
describe("adoptAllPrayerBeadPips", () => {
	const actor = (type, wrote) => ({ type, typedActor: { adoptPrayerBeadPips: vi.fn(async () => wrote) } });

	it("asks every character, and counts the ones moved", async () => {
		const actors = [actor("character", true), actor("character", false), actor("npc", true)];
		expect(await adoptAllPrayerBeadPips({ actors })).toBe(1);
		expect(actors[1].typedActor.adoptPrayerBeadPips).toHaveBeenCalled();
		expect(actors[2].typedActor.adoptPrayerBeadPips).not.toHaveBeenCalled();
	});
});
