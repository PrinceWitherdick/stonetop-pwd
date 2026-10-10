import { describe, it, expect } from "vitest";
import { steadingSystemValue } from "../../../module/actors/steading/steading-system-value.js";
import { StonetopSteading } from "../../../module/actors/steading/StonetopSteading.js";
import { effectiveProsperity } from "../../../module/utils/world.js";

// The steading's mirrored flag copy first, then system: ONE reader, behind the steading's own
// getSystemValue and the Prosperity a character's gear works from.

const steading = ({ system = {}, mirror } = {}) => ({
	type: "stonetop",
	system,
	flags: { "stonetop-pwd": mirror === undefined ? {} : { steading: { system: mirror } } },
});

describe("steadingSystemValue", () => {
	it("reads the mirror first, then system, then the default", () => {
		const s = steading({ system: { attributes: { prosperity: { value: 1 }, surplus: { value: 2 } } }, mirror: { attributes: { prosperity: { value: 3 } } } });
		expect(steadingSystemValue(s, "attributes.prosperity.value")).toBe(3);
		expect(steadingSystemValue(s, "attributes.surplus.value")).toBe(2);
		expect(steadingSystemValue(s, "attributes.population.value", { defaultValue: 0 })).toBe(0);
		expect(steadingSystemValue(null, "attributes.prosperity.value", { defaultValue: 7 })).toBe(7);
	});

	// The two readers it replaced disagreed about a stored null; each keeps its answer.
	it("takes a null in the mirror as the answer, unless told to read past it", () => {
		const s = steading({ system: { attributes: { prosperity: { value: 2 } } }, mirror: { attributes: { prosperity: { value: null } } } });
		expect(steadingSystemValue(s, "attributes.prosperity.value")).toBeNull();
		expect(new StonetopSteading(s).getSystemValue("attributes.prosperity.value")).toBeNull();
		expect(steadingSystemValue(s, "attributes.prosperity.value", { nullIsMissing: true })).toBe(2);
		expect(effectiveProsperity(s)).toBe(2);
	});
});
