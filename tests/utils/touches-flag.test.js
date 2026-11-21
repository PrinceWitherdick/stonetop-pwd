import { describe, it, expect } from "vitest";
import { touchesFlag, touchesKey } from "../../module/utils/touches-flag.js";

describe("touchesFlag", () => {
	it("counts a write and a removal of the flag, and nothing else", () => {
		expect(touchesFlag({ flags: { "stonetop-pwd": { camp: {} } } }, "camp")).toBe(true);
		expect(touchesFlag({ flags: { "stonetop-pwd": { "-=camp": null } } }, "camp")).toBe(true);
		expect(touchesFlag({ flags: { "stonetop-pwd": { campfire: {} } } }, "camp")).toBe(false);
		expect(touchesFlag({ flags: { other: { camp: {} } } }, "camp")).toBe(false);
		expect(touchesFlag({ name: "x" }, "camp")).toBe(false);
		expect(touchesFlag(undefined, "camp")).toBe(false);
	});

	it("touchesKey reads a nested level", () => {
		expect(touchesKey({ "-=majorGrant": null }, "majorGrant")).toBe(true);
		expect(touchesKey({ major: "x" }, "majorGrant")).toBe(false);
		expect(touchesKey(null, "majorGrant")).toBe(false);
	});
});
