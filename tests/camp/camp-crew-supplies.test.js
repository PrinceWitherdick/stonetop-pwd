import { afterEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_ID } from "../../module/system-id.js";
import { CREW_SUPPLIES_SLUG } from "../../module/actors/character/supply-cost.js";
import { campLedger, coverTheRest, crewBill, freezeCampPlan, newCampRecord, spareUses } from "../../module/camp/camp-rules.js";
import { campSummaryRows, campWindowView } from "../../module/camp/camp-view.js";
import { applyCampShares, campMembers, hostCamp, partyCrewMouths, setCampChoices, settleCamp } from "../../module/camp/camp-store.js";
import { CAMP_STATE } from "../../module/camp/camp-rules.js";
import { campParty, restoreCampWorld, seat } from "../fakes/camp.js";
import { partyFollowersOf } from "../../module/actors/character/follower-roster.js";

// Who travels with a character is read from their flags and playbook (follower-roster.js, through
// StonetopCharacter#crewSource for the crew); here each test says who directly. Unset, nobody.
vi.mock("../../module/actors/character/follower-roster.js", async importOriginal => ({
	...(await importOriginal()),
	partyFollowersOf: vi.fn(async () => []),
}));

/**
 * THE CREW PAYS ITS OWN MOUTHS at Make Camp (the user's ruling; the Crew insert, Book I p.144: "Supplies
 * (4+Prosperity uses per crew member)"). The crew's meal comes out of the crew's own supplies first, and
 * only what they cannot cover falls to the packs at the fire. The window lists the crew's supplies as a
 * purse of the keeper's row, and the settled card names what came from where.
 */

afterEach(() => {
	restoreCampWorld();
	partyFollowersOf.mockReset();
	partyFollowersOf.mockImplementation(async () => []);
});

/** Rook, a Marshal hosting with a crew of `mouths` eating, whose crew's supplies hold `held`. */
const rook = ({ mouths = 6, followers = mouths, held = 8, choices = {}, ...over } = {}) => ({
	...seat({ id: "rook", name: "Rook", isHost: true, joinedAt: 1, carried: { supplies: 4 }, choices: { followers, crewMouths: mouths, ...choices }, ...over }),
	crew: { held },
});
const bram = (over = {}) => seat({ id: "bram", name: "Bram", joinedAt: 2, carried: { supplies: 4 }, ...over });

describe("the crew's meal, as arithmetic", () => {
	it("costs a use per crew mouth, or one per four over a mess kit, never more than the followers eating", () => {
		expect(crewBill(rook({ mouths: 6 }))).toBe(6);
		expect(crewBill(rook({ mouths: 6 }), true)).toBe(2);
		// The player stepped the followers down at the fire: the crew eats no more than are still eating.
		expect(crewBill(rook({ mouths: 6, followers: 4 }))).toBe(4);
		expect(crewBill(rook({ mouths: 0, followers: 2 }))).toBe(0);
	});

	it("pays the crew's mouths from the crew's supplies first, and leaves the packs only their own", () => {
		const ledger = campLedger([rook({ held: 8 })]);
		// Rook and six crew: 7 uses; the crew's supplies pay its 6, and Rook's own pack is still to pay 1.
		expect(ledger.bill).toBe(7);
		expect(ledger.offers[0].purses[0]).toMatchObject({ slug: CREW_SUPPLIES_SLUG, remaining: 8, n: 6, auto: true });
		expect(ledger.short).toBe(1);
		const paid = campLedger([rook({ held: 8, choices: { offer: { supplies: 1 } } })]);
		expect(paid.short).toBe(0);
		expect(paid.spends[0].spend).toEqual([
			{ slug: CREW_SUPPLIES_SLUG, label: "Crew supplies", n: 6 },
			{ slug: "supplies", label: "Supplies", n: 1 },
		]);
	});

	it("lets the packs cover what the crew's supplies cannot", () => {
		const ledger = campLedger([rook({ held: 2 })]);
		expect(ledger.offers[0].purses[0].n).toBe(2);
		expect(ledger.short).toBe(5);
		// Cover the rest draws on Rook's own pack, never on the crew's (whose share is set by the crew's meal).
		expect(spareUses(ledger, ledger.rows[0])).toBe(4);
		expect(coverTheRest(ledger, ledger.rows[0])).toMatchObject({ supplies: 4 });
		expect(coverTheRest(ledger, ledger.rows[0])).not.toHaveProperty(CREW_SUPPLIES_SLUG);
	});

	it("gives the packs' over-offer back before the crew's supplies", () => {
		const ledger = campLedger([rook({ held: 8, choices: { offer: { supplies: 1 } } }), bram({ choices: { offer: { supplies: 3 } } })]);
		// 8 mouths, 8 uses: the crew's 6 and Rook's 1 stand; Bram eats 1 of the 3 he offered.
		expect(ledger.spends.map(s => s.total)).toEqual([7, 1]);
		expect(ledger.spends[0].spend[0]).toMatchObject({ slug: CREW_SUPPLIES_SLUG, n: 6 });
	});

	it("feeds nothing from a crew that does not eat: none with the party, or nobody left on its roster", () => {
		const ledger = campLedger([rook({ mouths: 0, followers: 0, held: 8, choices: { offer: { supplies: 1 } } })]);
		expect(ledger.offers[0].purses.map(p => p.slug)).toEqual(["supplies"]);
		expect(ledger.spends[0].spend).toEqual([{ slug: "supplies", label: "Supplies", n: 1 }]);
	});

	it("counts the crew among the followers on sitting down, never more of them", () => {
		expect(newCampRecord({ id: "c", hostId: "rook", actorId: "rook", followers: 7, crewMouths: 6 }).crewMouths).toBe(6);
		expect(newCampRecord({ id: "c", hostId: "rook", actorId: "rook", followers: 3, crewMouths: 6 }).crewMouths).toBe(3);
	});
});

describe("the crew's supplies in the window and on the settled card", () => {
	const view = members => campWindowView({
		state: CAMP_STATE.OPEN, hostName: "Rook", ledger: campLedger(members), manages: true, editable: ["rook"], mine: ["rook"],
	});

	it("lists the crew's supplies as a purse with no stepper, saying what they pay", () => {
		const purse = view([rook({ held: 8 })]).rows[0].purses[0];
		expect(purse).toMatchObject({ slug: CREW_SUPPLIES_SLUG, label: "Crew supplies", remaining: 8, n: 6, auto: true, canAdd: false, canTake: false });
		expect(purse.autoText).toBe("Feeds the crew first: 6 uses for the crew's meal.");
		expect(view([rook({ held: 2 })]).rows[0].purses[0].autoText)
			.toBe("Feeds the crew first: 2 uses of the 6 its meal costs. The other 4 come out of the packs at the fire.");
		expect(view([rook({ held: 0 })]).rows[0].purses[0].autoText)
			.toBe("Empty, so the crew's meal (6 uses) comes out of the packs at the fire.");
	});

	it("draws the crew's purse in the window without steppers", async () => {
		const html = await renderTemplate("systems/stonetop-pwd/templates/dialogs/make-camp.hbs", view([rook({ held: 8 })]));
		expect(html).toContain("stonetop-camp-purse--crew");
		expect(html).toContain("Feeds the crew first: 6 uses for the crew&#x27;s meal.");
		expect(html).not.toContain(`data-slug="${CREW_SUPPLIES_SLUG}"`);
		expect(html).toContain('data-slug="supplies"');
	});

	it("names what came from the crew and what from the pack", () => {
		const ledger = campLedger([rook({ held: 8, choices: { offer: { supplies: 1 } } }), bram({ choices: { offer: { supplies: 1 } } })]);
		const rows = campSummaryRows(ledger, freezeCampPlan(ledger));
		expect(rows).toContainEqual({ label: "From Rook's crew and pack", value: "Crew supplies: 6 uses; Rook's pack: 1 use of supplies" });
		expect(rows).toContainEqual({ label: "From Bram's pack", value: "1 use of supplies" });
		const crewOnly = campLedger([rook({ mouths: 1, held: 8, choices: { eats: false } })]);
		expect(campSummaryRows(crewOnly, freezeCampPlan(crewOnly))).toContainEqual({ label: "From Rook's crew", value: "Crew supplies: 1 use" });
	});
});

describe("the crew's supplies, read and paid", () => {
	const crewCard = { ftype: "crew", slug: "", party: true, name: "The Wolves", isGroup: true };

	/** Rook's player hosting, Rook a keeper of the Wolves (six of them) with `supplies` in the crew's sets. */
	function marshal(supplies) {
		const party = campParty();
		const rookActor = party.aeliana;
		rookActor.flags[SYSTEM_ID].crew = { name: "The Wolves", size: 6, supplies };
		partyFollowersOf.mockImplementation(async actor => (actor === rookActor ? [crewCard] : []));
		return { ...party, rookActor };
	}

	it("counts the crew's mouths off the party, so a crew with no insert to draw it from eats nothing", () => {
		const { rookActor } = marshal([4, 4, 4, 4, 4, 4]);
		// The crew is on the roster only while there is a Crew insert to draw it from (crewSource): the
		// Marshal's own, or a borrowed one (a learned Crew).
		expect(partyCrewMouths(rookActor, [crewCard])).toBe(6);
		expect(partyCrewMouths(rookActor, [])).toBe(0);
		// Nobody left on the roster: no mouths.
		rookActor.flags[SYSTEM_ID].crew.size = 0;
		expect(partyCrewMouths(rookActor, [crewCard])).toBe(0);
		expect(partyCrewMouths(rookActor)).toBe(0);
	});

	it("reads what the crew's supplies hold live, set by set as the sheet draws them", async () => {
		const { rookActor } = marshal([4, 4, 9, 0, 0, 0, 4]);
		const camp = await hostCamp(rookActor);
		// A set holds no more than a ◇ (4 here), and a set past the roster is not drawn.
		expect(campMembers(camp.campId, camp.hostId)[0].crew).toEqual({ held: 12 });
		expect(rookActor.flags[SYSTEM_ID].camp).toMatchObject({ followers: 6, crewMouths: 6 });
	});

	it("eats the crew's meal out of the crew's supplies, last member's set first, and the rest from the pack", async () => {
		const { rookActor, bram: bramActor } = marshal([4, 4, 0, 0, 0, 0]);
		const camp = await hostCamp(rookActor);
		await setCampChoices(rookActor, { "offer.supplies": 1 });
		expect((await settleCamp(camp)).ok).toBe(true);
		const card = ChatMessage.create.mock.calls.map(c => c[0].content).join("");
		expect(card).toContain("Crew supplies: 6 uses;");
		await applyCampShares(rookActor);
		expect(rookActor.flags[SYSTEM_ID].crew.supplies).toEqual([2, 0, 0, 0, 0, 0]);
		expect(rookActor.flags[SYSTEM_ID].inventory.resources.supplies).toBe(3);
		expect(bramActor.update).not.toHaveBeenCalled();
	});

	it("has the pack pay for the crew when the crew's supplies run short", async () => {
		const { rookActor } = marshal([1, 1, 0, 0, 0, 0]);
		rookActor.flags[SYSTEM_ID].inventory.resources.supplies = 6;
		const camp = await hostCamp(rookActor);
		expect((await settleCamp(camp)).ok).toBe(false);
		await setCampChoices(rookActor, { "offer.supplies": 5 });
		expect((await settleCamp(camp)).ok).toBe(true);
		await applyCampShares(rookActor);
		expect(rookActor.flags[SYSTEM_ID].crew.supplies).toEqual([0, 0, 0, 0, 0, 0]);
		expect(rookActor.flags[SYSTEM_ID].inventory.resources.supplies).toBe(1);
	});
});
