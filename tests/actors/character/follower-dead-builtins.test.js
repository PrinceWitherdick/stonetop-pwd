import { describe, it, expect } from "vitest";
import { followerDeadPath, followerMarkedDead, followerReviveUpdate } from "../../../module/actors/character/follower-fate.js";
import { customFollowerOutOfOrders } from "../../../module/fight/follower-fight.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

// "Dead" from the 0-HP fate (Book I p.469) is kept on the card of every single follower, not only a custom
// one: a companion, an initiate or a beast keeps a Fallen card that takes no orders, until healed above 0.

describe("followerDeadPath", () => {
	it("records a custom follower's on its record and the built-ins' on their card's details", () => {
		expect(followerDeadPath("custom", "a1")).toBe("customFollowers.a1.dead");
		expect(followerDeadPath("animal-companion")).toBe("animalCompanion.details.dead");
		expect(followerDeadPath("initiate", "enfys")).toBe("initiateDetails.enfys.dead");
		expect(followerDeadPath("beast", "hound")).toBe("beastDetails.hound.dead");
	});

	it("leaves a roster row and the crew to their rosters", () => {
		expect(followerDeadPath("crew")).toBeNull();
		expect(followerDeadPath("crew-member")).toBeNull();
		expect(followerDeadPath("custom")).toBeNull();
	});
});

describe("a built-in follower marked dead", () => {
	const flags = { animalCompanion: { details: { dead: true } }, initiateDetails: { enfys: { dead: true } } };

	it("takes no orders", () => {
		expect(followerMarkedDead(flags, "animal-companion")).toBe(true);
		expect(customFollowerOutOfOrders(flags, "animal-companion", "")).toBe(true);
		expect(customFollowerOutOfOrders(flags, "initiate", "enfys")).toBe(true);
		expect(customFollowerOutOfOrders(flags, "initiate", "olwin")).toBe(false);
	});

	it("comes back when healed above 0, and nothing is written for one who was not marked", () => {
		expect(followerReviveUpdate("animal-companion", "", 3, flags)).toEqual({ [`flags.${SYSTEM_ID}.animalCompanion.details.dead`]: false });
		expect(followerReviveUpdate("initiate", "enfys", 1, flags)).toEqual({ [`flags.${SYSTEM_ID}.initiateDetails.enfys.dead`]: false });
		expect(followerReviveUpdate("initiate", "enfys", 0, flags)).toBeNull();
		expect(followerReviveUpdate("beast", "hound", 4, flags)).toBeNull();
	});
});
