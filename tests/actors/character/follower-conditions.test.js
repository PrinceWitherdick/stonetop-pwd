import { describe, it, expect, vi } from "vitest";
import {
	FOLLOWER_DEBILITIES, followerConditionsPath, followerConditions, addFollowerCondition, removeFollowerCondition, toggleFollowerCondition,
} from "../../../module/actors/character/follower-conditions.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

// "If you want, assign a debility to a follower as a temporary tag (weakened, dazed, or miserable), imposing
// disadvantage" (Book I p.243): kept as a follower's conditions, one list per follower, the companion's at the
// store Loyal to the End's "injured" already used.

function character(flags = {}) {
	const actor = {
		flags: { [SYSTEM_ID]: flags },
		setFlag: vi.fn(async (scope, path, value) => {
			const keys = path.split(".");
			let node = actor.flags[scope];
			for (const key of keys.slice(0, -1)) node = node[key] ??= {};
			node[keys.at(-1)] = value;
		}),
	};
	return actor;
}

describe("followerConditionsPath", () => {
	it("keeps the companion's where Loyal to the End put it, and everyone else's beside their details", () => {
		expect(followerConditionsPath("animal-companion")).toBe("animalCompanion.conditions");
		expect(followerConditionsPath("crew")).toBe("crew.details.conditions");
		expect(followerConditionsPath("initiate", "enfys")).toBe("initiateDetails.enfys.conditions");
		expect(followerConditionsPath("custom", "a1")).toBe("customFollowers.a1.conditions");
		expect(followerConditionsPath("nonsense")).toBeNull();
	});
});

describe("a follower's conditions", () => {
	it("are the book's three debilities to offer", () => {
		expect(FOLLOWER_DEBILITIES).toEqual(["weakened", "dazed", "miserable"]);
	});

	it("are added once, removed, and toggled", async () => {
		const pc = character({ customFollowers: { a1: { name: "Andras" } } });
		expect(await addFollowerCondition(pc, "custom", "a1", "dazed")).toBe(true);
		expect(await addFollowerCondition(pc, "custom", "a1", "dazed")).toBe(false);
		expect(followerConditions(pc.flags[SYSTEM_ID], "custom", "a1")).toEqual(["dazed"]);
		expect(await toggleFollowerCondition(pc, "custom", "a1", "miserable")).toBe(true);
		expect(await toggleFollowerCondition(pc, "custom", "a1", "dazed")).toBe(false);
		expect(followerConditions(pc.flags[SYSTEM_ID], "custom", "a1")).toEqual(["miserable"]);
		expect(await removeFollowerCondition(pc, "custom", "a1", "weakened")).toBe(false);
	});

	it("read the companion's injured beside a debility", async () => {
		const pc = character({ animalCompanion: { conditions: ["injured"] } });
		await addFollowerCondition(pc, "animal-companion", "", "weakened");
		expect(followerConditions(pc.flags[SYSTEM_ID], "animal-companion")).toEqual(["injured", "weakened"]);
	});
});
