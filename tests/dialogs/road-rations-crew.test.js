import { afterEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_ID } from "../../module/system-id.js";
import { campParty, restoreCampWorld } from "../fakes/camp.js";
import { partyFollowersOf } from "../../module/actors/character/follower-roster.js";
import { RoadRationsDialog } from "../../module/dialogs/RoadRationsDialog.js";

// Who travels with a character is read from their flags and playbook (follower-roster.js, through
// StonetopCharacter#crewSource for the crew); here each test says who directly. Unset, nobody.
vi.mock("../../module/actors/character/follower-roster.js", async importOriginal => ({
	...(await importOriginal()),
	partyFollowersOf: vi.fn(async () => []),
}));

/**
 * THE CREW PAYS ITS OWN MOUTHS on the road too (the user's ruling; the Crew insert, Book I p.144:
 * "Supplies (4+Prosperity uses per crew member)"). Read and written through camp-store.js, the same
 * reads and writes Make Camp pays from (tests/camp/camp-crew-supplies.test.js).
 */

afterEach(() => {
	restoreCampWorld();
	partyFollowersOf.mockReset();
	partyFollowersOf.mockImplementation(async () => []);
});

const crewCard = { ftype: "crew", slug: "", party: true, name: "The Wolves", isGroup: true };

/** The GM's client, with Aeliana keeping the Wolves (six of them) and `supplies` in the crew's sets. */
function marshal(supplies, { packSupplies = 4, withParty = true } = {}) {
	const party = campParty({ me: "gm" });
	const rook = party.aeliana;
	rook.flags[SYSTEM_ID].crew = { name: "The Wolves", size: 6, supplies };
	rook.flags[SYSTEM_ID].inventory.resources.supplies = packSupplies;
	partyFollowersOf.mockImplementation(async actor => (actor === rook && withParty ? [crewCard] : []));
	return { ...party, rook };
}

describe("the days on the road, with a Marshal's crew", () => {
	it("eats the crew's days out of the crew's supplies, last member's set first, and nothing of the pack's for them", async () => {
		const { rook } = marshal([4, 4, 4, 0, 0, 0]);
		const d = new RoadRationsDialog([rook], { days: 1 });
		const data = await d.getData();
		// Aeliana and six crew: 7. The crew's 12 pay its 6; Aeliana's pack pays her 1.
		expect(data.rows[0]).toMatchObject({ crewHeld: 12, crewPays: 6, pays: 1 });
		await d._apply();
		expect(rook.flags[SYSTEM_ID].crew.supplies).toEqual([4, 2, 0, 0, 0, 0]);
		expect(rook.flags[SYSTEM_ID].inventory.resources.supplies).toBe(3);
		const card = ChatMessage.create.mock.calls.map(c => c[0].content).join("");
		expect(card).toContain("6 uses from the crew");
	});

	it("bills the packs for what the crew's supplies cannot cover", async () => {
		const { rook } = marshal([1, 1, 0, 0, 0, 0], { packSupplies: 8 });
		const d = new RoadRationsDialog([rook], { days: 1 });
		await d.getData();
		await d._apply();
		expect(rook.flags[SYSTEM_ID].crew.supplies).toEqual([0, 0, 0, 0, 0, 0]);
		// 7 to eat, 2 from the crew's supplies: the pack pays the other 5.
		expect(rook.flags[SYSTEM_ID].inventory.resources.supplies).toBe(3);
	});

	it("touches nothing of the crew's when the crew is not with the party", async () => {
		const { rook } = marshal([4, 4, 4, 4, 4, 4], { withParty: false });
		const d = new RoadRationsDialog([rook], { days: 2 });
		const data = await d.getData();
		expect(data.rows[0]).toMatchObject({ crewPays: 0, crewText: "", pays: 2 });
		await d._apply();
		expect(rook.flags[SYSTEM_ID].crew.supplies).toEqual([4, 4, 4, 4, 4, 4]);
		expect(rook.flags[SYSTEM_ID].inventory.resources.supplies).toBe(2);
	});
});
