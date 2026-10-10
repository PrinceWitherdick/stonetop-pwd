import { afterEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_ID } from "../../module/system-id.js";
import { CAMP_EXTRA, CAMP_STALE_MS, CAMP_STATE, CAMP_STATUS, SETTLE_REFUSAL, planExtra } from "../../module/camp/camp-rules.js";
import {
	applyCampShares, breakCamp, campMembers, campWriterId, hostCamp, joinCamp, managesCamp, onDeleteActorCamp, onUpdateActorCamp,
	openCamps, partyFollowerMouths, payPendingShares, registerCampHooks, sendAwayFromCamp, setCampChoices, settleCamp,
	stateOfCamp, takenFromCamp,
} from "../../module/camp/camp-store.js";
import { settleRefusalText } from "../../module/camp/camp-view.js";
import { campCharacter, campParty, restoreCampWorld } from "../fakes/camp.js";

/**
 * The camp's documents: sitting down, the choices made at the fire, settling, and paying each
 * share from exactly one client. The arithmetic behind all of it is camp-rules.test.js's.
 */

afterEach(restoreCampWorld);

const campOf = actor => actor.flags[SYSTEM_ID].camp;

/**
 * The writes that paid a share, as opposed to the claim written first that says whose client is
 * paying it (camp-store.js#payShare).
 */
const payments = actor => actor.update.mock.calls.filter(([, options]) => options?.stonetopMove === "Make Camp");

/** Aeliana hosting, Bram sitting with her, and Aeliana paying for both of them. */
async function readyToSettle(options = {}) {
	const party = campParty(options);
	const camp = await hostCamp(party.aeliana);
	await joinCamp(party.bram, camp);
	await setCampChoices(party.aeliana, { "offer.supplies": 2 });
	return { ...party, camp };
}

/** The same camp, settled by Aeliana's player, with every write so far forgotten. */
async function settled(options = {}) {
	const party = await readyToSettle(options);
	await settleCamp(party.camp);
	party.aeliana.update.mockClear();
	party.bram.update.mockClear();
	return party;
}

describe("sitting down at a camp", () => {
	it("opens a camp on its host, from what the host's own sheet knows", async () => {
		const { aeliana } = campParty({ aeliana: {
			marked: ["dazed"],
			outfit: [{ slug: "bedroll", checked: true }, { slug: "mess-kit", checked: false }],
			followers: { hound: { party: true }, mule: { party: false } },
		} });
		const camp = await hostCamp(aeliana);
		expect(camp.hostId).toBe("aeliana");
		expect(campOf(aeliana)).toMatchObject({
			id: camp.campId, host: "aeliana", status: CAMP_STATUS.OPEN,
			followers: 1, bedroll: true, messKit: false, benefit: "hp", debility: "dazed",
			vitals: { maxHp: 15, bedroll: true, messKit: false },
		});
		// Bookkeeping: the ledger hears about the camp when the share is paid, not before.
		expect(aeliana.update).toHaveBeenCalledWith(expect.any(Object), { stonetopLedger: true });
	});

	it("sits a member down without opening anything", async () => {
		const { aeliana, bram } = campParty();
		const camp = await hostCamp(aeliana);
		await joinCamp(bram, camp);
		expect(campOf(bram)).toMatchObject({ id: camp.campId, host: "aeliana", status: null, applied: false });
	});

	// Foundry merges a flag write into what is there, which is why a fresh record names every field.
	it("clears the last camp's choices from a character who sits down again", async () => {
		const { aeliana, bram } = campParty();
		await joinCamp(bram, await hostCamp(aeliana));
		await setCampChoices(bram, { ready: true, "offer.provisions": 2 });
		await joinCamp(bram, await hostCamp(aeliana));
		expect(campOf(bram)).toMatchObject({ ready: false, offer: { provisions: 0 } });
	});

	it("breaks up the camp a host walks away from, open or already broken up, and nothing else", async () => {
		const { aeliana, bram } = campParty();
		const left = await hostCamp(aeliana);
		await joinCamp(aeliana, await hostCamp(bram));
		expect(stateOfCamp(left)).toBe(CAMP_STATE.CANCELLED);

		const broken = await hostCamp(aeliana);
		await breakCamp(aeliana);
		await joinCamp(aeliana, await hostCamp(bram));
		expect(stateOfCamp(broken)).toBe(CAMP_STATE.CANCELLED);

		// Moving on again, from a camp they were only a guest at, keeps both broken up.
		await joinCamp(aeliana, await hostCamp(bram));
		expect(stateOfCamp(left)).toBe(CAMP_STATE.CANCELLED);
		expect(stateOfCamp(broken)).toBe(CAMP_STATE.CANCELLED);

		// A settled camp was eaten at, not broken up, and a member moving on breaks nothing.
		const { aeliana: host, bram: guest, camp } = await readyToSettle();
		await settleCamp(camp);
		await joinCamp(host, await hostCamp(guest));
		expect(campOf(host).leftCamps).toEqual([]);
		expect(stateOfCamp(camp)).not.toBe(CAMP_STATE.CANCELLED);
		expect(campOf(guest).leftCamps).toEqual([]);
	});

	it("brings every living follower marked as in the party, a group as its whole headcount", () => {
		const { aeliana } = campParty({ aeliana: { followers: {
			hound: { party: true },
			crew:  { party: true, isGroup: true, size: 5 },
			mule:  { party: false },
			lost:  { party: true, dead: true },
		} } });
		expect(partyFollowerMouths(aeliana)).toBe(6);
	});

	// A group at its two-member floor keeps a dead member's row, marked fallen (memberDead). The dead
	// eat nothing; a member who is only down at 0 HP still eats.
	it("does not feed a group member marked fallen, but still feeds one who is only down", () => {
		const { aeliana } = campParty({ aeliana: { followers: {
			band: { party: true, isGroup: true, size: 2, memberHp: [0, 0], memberDead: [true, null] },
		} } });
		expect(partyFollowerMouths(aeliana)).toBe(1);
	});
});

describe("finding camps and who is at them", () => {
	it("lists the camps still open, by their hosts", async () => {
		const { aeliana, bram } = campParty();
		const camp = await hostCamp(aeliana);
		await joinCamp(bram, camp);
		expect(openCamps()).toEqual([{ campId: camp.campId, hostId: "aeliana", hostName: "Aeliana" }]);
		expect(openCamps(Date.now() + CAMP_STALE_MS + 1000)).toEqual([]);
	});

	it("leaves the dead out of the camp they were sitting at", async () => {
		const cora = campCharacter({ id: "cora", name: "Cora", owners: ["player-1"], pastDeath: "dead" });
		const { aeliana } = campParty({ others: [cora] });
		const camp = await hostCamp(aeliana);
		cora.flags[SYSTEM_ID].camp = { id: camp.campId, host: "aeliana" };
		expect(campMembers(camp.campId, "aeliana").map(m => m.actorId)).toEqual(["aeliana"]);
	});

	it("seats a Ghost as Unliving", async () => {
		const dunstan = campCharacter({ id: "dunstan", name: "Dunstan", owners: ["player-1"], pastDeath: "ghost" });
		const { aeliana } = campParty({ others: [dunstan] });
		const camp = await hostCamp(aeliana);
		await joinCamp(dunstan, camp);
		expect(campOf(dunstan).eats).toBe(false);
		expect(campMembers(camp.campId, "aeliana").find(m => m.actorId === "dunstan").unliving).toBe(true);
	});

	// Post-death audit: Ravenous's "extra 1d4 provisions or uses of supplies" is rolled ONCE, as the
	// Thrall sits down, so every reader's window reads the same bill.
	it("rolls a Ravenous Thrall's 1d4 once, as they sit down, and bills the camp for it", async () => {
		const { aeliana, bram, toMessage } = campParty({ rolled: 3, bram: { pastDeath: "thrall", thrallMarks: ["ravenous"] } });
		const camp = await hostCamp(aeliana);
		expect(toMessage).not.toHaveBeenCalled();
		await joinCamp(bram, camp);
		expect(campOf(bram).hunger).toBe(3);
		expect(toMessage).toHaveBeenCalledTimes(1);
		expect(toMessage.mock.calls[0][0].flavor).toContain("Ravenous");
		const members = campMembers(camp.campId, "aeliana");
		campMembers(camp.campId, "aeliana");
		expect(toMessage).toHaveBeenCalledTimes(1);
		expect(members.find(m => m.actorId === "bram")).toMatchObject({ ravenous: true, nightmarish: false, slowToHeal: false });
		expect(campOf(aeliana).hunger).toBe(0);
	});

	// Send them away removes the camp record whole; bringing them back must not re-roll the bill.
	it("keeps a Ravenous Thrall's roll when they are sent away and brought back to the same fire", async () => {
		const { aeliana, bram, toMessage, act } = campParty({ rolled: 3, bram: { pastDeath: "thrall", thrallMarks: ["ravenous"] } });
		const camp = await hostCamp(aeliana);
		await joinCamp(bram, camp);
		act("gm");
		await sendAwayFromCamp(bram, camp);
		expect(campOf(bram)).toBeUndefined();
		await joinCamp(bram, camp);
		expect(toMessage).toHaveBeenCalledTimes(1);
		expect(campOf(bram).hunger).toBe(3);
		// Another fire is another meal, and rolls again.
		await joinCamp(bram, await hostCamp(aeliana));
		expect(toMessage).toHaveBeenCalledTimes(2);
	});

	// openedAt and the cold check used each machine's own clock, and a clock hours off read a camp
	// opened a minute ago as left cold.
	it("ages a camp on the server's clock, whatever this machine's clock says", async () => {
		const { aeliana } = campParty();
		game.time = { serverTime: 5_000_000 };
		const camp = await hostCamp(aeliana);
		expect(campOf(aeliana).openedAt).toBe(5_000_000);
		const clock = vi.spyOn(Date, "now").mockReturnValue(5_000_000 + CAMP_STALE_MS + 60_000);
		try {
			expect(stateOfCamp(camp)).toBe(CAMP_STATE.OPEN);
			expect(openCamps()).toHaveLength(1);
		} finally {
			clock.mockRestore();
		}
		game.time.serverTime = 5_000_000 + CAMP_STALE_MS + 1;
		expect(stateOfCamp(camp)).toBe(CAMP_STATE.COLD);
	});

	// A debility cleared by Recover while the camp sits open must not stay on offer.
	it("reads which debilities are marked live, and names them from the sheet", async () => {
		const { aeliana } = campParty();
		const camp = await hostCamp(aeliana);
		aeliana.system.attributes.debilities.options.miserable.value = true;
		expect(campMembers(camp.campId, "aeliana")[0].activeDebilities).toEqual([{ key: "miserable", name: "Miserable" }]);
	});

	// "Clear it as you would a debility": a marked Walk It Off box is on offer at the fire, read live.
	it("counts a Ranger's marked Walk It Off box among them", async () => {
		const { aeliana } = campParty({ aeliana: { moves: ["Walk It Off"] } });
		const held = {};
		aeliana.typedActor.moveResources = { getMoveResources: () => held };
		const camp = await hostCamp(aeliana);
		expect(campMembers(camp.campId, "aeliana")[0].activeDebilities).toEqual([]);
		held["Walk It Off"] = 1;
		expect(campMembers(camp.campId, "aeliana")[0].activeDebilities).toEqual([{ key: "walkItOff", name: "Walk It Off" }]);
	});
});

describe("who pays whose share", () => {
	// Death's Door's election: the assigned player, then a logged-in player owner, then a GM.
	it("is the player the character is assigned to, even when others own the sheet too", () => {
		const { bram } = campParty({ bram: { owners: ["player-1", "player-2"] } });
		expect(campWriterId(bram)).toBe("player-2");
	});

	it("falls to a GM while the character's player is away", () => {
		const { bram } = campParty({ bramOnline: false });
		expect(campWriterId(bram)).toBe("gm");
	});
});

describe("choices at the fire", () => {
	it("are written onto the character they belong to", async () => {
		const { aeliana } = campParty();
		await hostCamp(aeliana);
		await setCampChoices(aeliana, { "offer.supplies": 3, ready: true });
		expect(aeliana.update).toHaveBeenLastCalledWith(
			{ [`flags.${SYSTEM_ID}.camp.offer.supplies`]: 3, [`flags.${SYSTEM_ID}.camp.ready`]: true },
			{ stonetopLedger: true },
		);
		expect(campOf(aeliana)).toMatchObject({ ready: true, offer: { supplies: 3 } });
	});

	it("refuse a field nothing would ever read", async () => {
		const { aeliana } = campParty();
		await hostCamp(aeliana);
		await expect(setCampChoices(aeliana, { status: "settled" })).rejects.toThrow(/not a camp choice/);
	});
});

describe("going without", () => {
	// Book I p.335: going without costs the night's pick, never the seat at the fire.
	it("keeps the character at the camp, only not eating", async () => {
		const { aeliana, bram } = campParty();
		const camp = await hostCamp(aeliana);
		await joinCamp(bram, camp);
		await setCampChoices(bram, { eats: false });
		expect(campMembers(camp.campId, "aeliana").map(m => [m.actorId, m.record.eats])).toEqual([["aeliana", true], ["bram", false]]);
	});
});

describe("sending someone away", () => {
	it("takes a member away from the fire, choices and all", async () => {
		const { aeliana, bram } = campParty();
		const camp = await hostCamp(aeliana);
		await joinCamp(bram, camp);
		await setCampChoices(bram, { eats: false });
		await sendAwayFromCamp(bram, camp);
		expect(campOf(bram)).toBeUndefined();
		expect(campMembers(camp.campId, "aeliana").map(m => m.actorId)).toEqual(["aeliana"]);
	});

	// A camp without its host has nobody to settle it; Break up the camp is for that.
	it("never sends the host away", async () => {
		const { aeliana, camp } = await readyToSettle();
		await sendAwayFromCamp(aeliana, camp);
		expect(campOf(aeliana)).toMatchObject({ id: camp.campId, status: CAMP_STATUS.OPEN });
	});

	it("leaves alone a character already sitting at another fire", async () => {
		const { aeliana, bram } = campParty();
		const first  = await hostCamp(aeliana);
		const second = await hostCamp(bram);
		await sendAwayFromCamp(bram, first);
		expect(campOf(bram).id).toBe(second.campId);
	});

	// A settled camp's plan still counts them, and each share is paid against the character's own record:
	// taken away now, their food would never leave the pack and the night would never heal them.
	it("leaves everyone at the fire once the camp has settled", async () => {
		const { bram, camp } = await settled();
		await sendAwayFromCamp(bram, camp);
		expect(campOf(bram)).toMatchObject({ id: camp.campId });
	});

	it("tells a player's window when somebody else took their character from the fire", async () => {
		const { aeliana, bram } = campParty({ me: "player-2" });
		const camp = await hostCamp(aeliana);
		await joinCamp(bram, camp);
		expect(takenFromCamp(bram, camp.campId, "gm"), "still seated").toBe(false);
		await sendAwayFromCamp(bram, camp);
		expect(takenFromCamp(bram, camp.campId, "gm")).toBe(true);
		// Getting up themselves needs no telling, and nor does a character somebody else plays.
		expect(takenFromCamp(bram, camp.campId, "player-2")).toBe(false);
		expect(takenFromCamp(aeliana, "another-camp", "gm")).toBe(false);
	});
});

describe("breaking the camp up", () => {
	it("closes the camp on its host, and spends nothing anyone shared", async () => {
		const { aeliana } = await readyToSettle();
		expect(await breakCamp(aeliana)).toBe(true);
		expect(campOf(aeliana).status).toBe(CAMP_STATUS.CANCELLED);
		expect(aeliana.flags[SYSTEM_ID].inventory.resources.supplies).toBe(4);
	});

	// Break up waits on a confirm, and somebody else can settle the camp while it is up.
	it("will not break up a camp settled while its confirm was up, and a Break up landing anyway keeps the meal", async () => {
		const { aeliana, bram, camp, act } = await readyToSettle();
		await settleCamp(camp);
		expect(await breakCamp(aeliana)).toBe(false);
		expect(campOf(aeliana).status).toBe(CAMP_STATUS.SETTLED);
		// Crossing on the wire, the cancel lands on top of the plan all the same.
		aeliana.flags[SYSTEM_ID].camp.status = CAMP_STATUS.CANCELLED;
		expect(stateOfCamp(camp)).toBe(CAMP_STATE.SETTLED);
		act("player-2");
		await applyCampShares(aeliana);
		expect(campOf(bram).applied).toBe(true);
		expect(bram.system.attributes.hp.value).toBe(12);
	});
});

describe("settling the camp", () => {
	it("will not settle a camp that is over", async () => {
		const { aeliana, camp } = await readyToSettle();
		await breakCamp(aeliana);
		expect(await settleCamp(camp)).toEqual({ ok: false, reason: SETTLE_REFUSAL.CLOSED });
	});

	it("is for the host's player or a GM, and nobody else", async () => {
		const { camp, act } = await readyToSettle();
		act("player-2");
		expect(await settleCamp(camp)).toEqual({ ok: false, reason: SETTLE_REFUSAL.NOT_YOURS });
		act("gm");
		expect((await settleCamp(camp)).ok).toBe(true);
	});

	// A table that shares every sheet makes every player an owner of every character.
	it("is not for another player who merely owns the host too", async () => {
		const { aeliana, camp, act } = await readyToSettle({ aeliana: { owners: ["player-1", "player-2"] } });
		act("player-2");
		expect(managesCamp(aeliana)).toBe(false);
		expect(await settleCamp(camp)).toEqual({ ok: false, reason: SETTLE_REFUSAL.NOT_YOURS });
		expect(campOf(aeliana).status).toBe(CAMP_STATUS.OPEN);
		act("player-1");
		expect(managesCamp(aeliana)).toBe(true);
		act("gm");
		expect(managesCamp(aeliana)).toBe(true);
	});

	it("waits while anyone eating has no food, and writes nothing", async () => {
		const { aeliana, camp } = await readyToSettle();
		await setCampChoices(aeliana, { "offer.supplies": 1 });
		aeliana.update.mockClear();
		expect(await settleCamp(camp)).toEqual({ ok: false, reason: SETTLE_REFUSAL.SHORT });
		expect(aeliana.update).not.toHaveBeenCalled();
	});

	it("freezes the plan onto the host, then rolls the bedrolls, then tells the table", async () => {
		const { aeliana, camp, toMessage } = await readyToSettle({ bram: { outfit: [{ slug: "bedroll", checked: true }] } });
		aeliana.update.mockClear();
		expect((await settleCamp(camp)).ok).toBe(true);

		expect(aeliana.update).toHaveBeenCalledTimes(1);
		expect(campOf(aeliana).status).toBe(CAMP_STATUS.SETTLED);
		expect(campOf(aeliana).plan.map(entry => [entry.actorId, planExtra(entry, CAMP_EXTRA.BEDROLL)])).toEqual([["aeliana", 0], ["bram", 3]]);
		expect(toMessage).toHaveBeenCalledTimes(1);
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);

		// Nothing is said about a plan before it exists.
		expect(aeliana.update.mock.invocationCallOrder[0]).toBeLessThan(toMessage.mock.invocationCallOrder[0]);
		expect(toMessage.mock.invocationCallOrder[0]).toBeLessThan(ChatMessage.create.mock.invocationCallOrder[0]);
	});

	// CAMP-5. A Book II treasure is a write-in on the sheet, not an outfit row, so it is found among
	// every gear store (StonetopCharacter#_gearSources) by name, and only when its ◇ is marked.
	it("sits a character down with the fur-lined bedroll they carry, as a bedroll", async () => {
		const { aeliana, bram } = campParty({
			aeliana: { gear: [{ name: "A fur-lined bedroll", carried: true }] },
			bram:    { gear: [{ name: "A fur-lined bedroll", carried: false }] },
		});
		const camp = await hostCamp(aeliana);
		await joinCamp(bram, camp);
		expect(campOf(aeliana)).toMatchObject({ bedroll: true, vitals: { bedroll: true, furBedroll: true } });
		expect(campOf(bram)).toMatchObject({ bedroll: false, vitals: { bedroll: false, furBedroll: false } });
		// The sheet's numbers and the gear come from one pass of the model, not one each.
		expect(aeliana.typedActor.snapshotWithGear).toHaveBeenCalledTimes(1);
	});

	it("rolls one 1d6 for the fur-lined bedroll beside a plain one, and holds its advantage once paid", async () => {
		const { aeliana, camp, toMessage } = await readyToSettle({ aeliana: {
			outfit: [{ slug: "bedroll", checked: true }],
			gear:   [{ name: "A fur-lined bedroll", carried: true }],
		} });
		expect((await settleCamp(camp)).ok).toBe(true);
		const plan = campOf(aeliana).plan;
		expect(plan.map(entry => [entry.actorId, planExtra(entry, CAMP_EXTRA.BEDROLL), entry.furBedroll])).toEqual([["aeliana", 3, true], ["bram", 0, false]]);
		expect(toMessage).toHaveBeenCalledTimes(1);
		await applyCampShares(aeliana);
		expect(aeliana.flags[SYSTEM_ID].heldAdvantage).toEqual({ sources: ["A fur-lined bedroll"] });
		// Paid once: a second pass over the same camp lays nothing more.
		aeliana.update.mockClear();
		await applyCampShares(aeliana);
		expect(payments(aeliana)).toHaveLength(0);
	});

	// The Judge's Break Bread: one meal, so one 1d8 for each person eating, however many hold it.
	it("rolls Break Bread's 1d8 once for each person eating, when someone eating has it learned", async () => {
		const { aeliana, camp, toMessage } = await readyToSettle({ aeliana: { moves: ["Break Bread"] }, bram: { moves: ["Break Bread"] } });
		expect((await settleCamp(camp)).ok).toBe(true);
		expect(campOf(aeliana).plan.map(entry => [entry.actorId, planExtra(entry, CAMP_EXTRA.BREAK_BREAD)])).toEqual([["aeliana", 3], ["bram", 3]]);
		expect(toMessage).toHaveBeenCalledTimes(2);
		const flavors = toMessage.mock.calls.map(([data]) => data.flavor);
		expect(flavors).toHaveLength(2);
		for (const flavor of flavors) {
			expect(flavor).toContain("stonetop-roll-card");
			expect(flavor).toContain("Break Bread");
		}
		// Both dice in one request.
		expect(ChatMessage.implementation.createDocuments).toHaveBeenCalledTimes(1);
		expect(ChatMessage.implementation.createDocuments.mock.calls[0][0]).toHaveLength(2);
	});

	it("rolls no Break Bread when the host unticks the proper meal", async () => {
		const { aeliana, camp, toMessage } = await readyToSettle({ aeliana: { moves: ["Break Bread"] } });
		await setCampChoices(aeliana, { properMeal: false });
		await settleCamp(camp);
		expect(campOf(aeliana).plan.map(entry => planExtra(entry, CAMP_EXTRA.BREAK_BREAD))).toEqual([0, 0]);
		expect(toMessage).not.toHaveBeenCalled();
	});

	it("rolls no Break Bread for a holder who has switched the move off", async () => {
		const { aeliana, camp, toMessage } = await readyToSettle({ aeliana: { moves: [{ name: "Break Bread", learned: false }] } });
		await settleCamp(camp);
		expect(campOf(aeliana).plan.map(entry => planExtra(entry, CAMP_EXTRA.BREAK_BREAD))).toEqual([0, 0]);
		expect(toMessage).not.toHaveBeenCalled();
	});

	// The Lightbearer's Keep the Home-Fires Burning: "anyone who Makes Camp with you ... recovers
	// (extra) HP equal to your CHA", read live off the holder, and a fixed number, so no die.
	it("gives everyone at the fire the Home-Fires holder's CHA in extra HP, the holder too", async () => {
		const { aeliana, bram, camp, toMessage, act } = await readyToSettle({ bram: { moves: ["Keep the Home-Fires Burning"], cha: 2 } });
		await setCampChoices(bram, { eats: false });
		expect((await settleCamp(camp)).ok).toBe(true);
		expect(campOf(aeliana).plan.map(entry => [entry.actorId, planExtra(entry, CAMP_EXTRA.HOME_FIRES)])).toEqual([["aeliana", 2], ["bram", 2]]);
		expect(toMessage).not.toHaveBeenCalled();
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("Keep the Home-Fires Burning");

		// Bram went without food, so no pick: only the fire's 2.
		act("player-2");
		await applyCampShares(aeliana);
		expect(bram.system.attributes.hp.value).toBe(6);
	});

	it("gives no Home-Fires HP when the host unticks the hearth ash, or the holder has it switched off", async () => {
		const unticked = await readyToSettle({ aeliana: { moves: ["Keep the Home-Fires Burning"], cha: 3 } });
		await setCampChoices(unticked.aeliana, { hearthAsh: false });
		await settleCamp(unticked.camp);
		expect(campOf(unticked.aeliana).plan.map(entry => planExtra(entry, CAMP_EXTRA.HOME_FIRES))).toEqual([0, 0]);
		restoreCampWorld();

		const off = await readyToSettle({ aeliana: { moves: [{ name: "Keep the Home-Fires Burning", learned: false }], cha: 3 } });
		await settleCamp(off.camp);
		expect(campOf(off.aeliana).plan.map(entry => planExtra(entry, CAMP_EXTRA.HOME_FIRES))).toEqual([0, 0]);
	});

	// Auspicious Birth: "Clear it when you Make Camp or Convalesce."
	it("clears Auspicious Birth's marked circle, named on the card, and leaves an unmarked one alone", async () => {
		const circle = { key: "auspicious-birth", label: "Background circle", clearsOn: ["make-camp", "convalesce"] };
		const { aeliana, bram, camp } = await readyToSettle({
			aeliana: { background: { label: "Auspicious Birth", setupResources: [circle], marks: { "auspicious-birth": 1 } } },
			bram:    { background: { label: "Auspicious Birth", setupResources: [circle], marks: { "auspicious-birth": 0 } } },
		});
		await settleCamp(camp);
		expect(campOf(aeliana).plan.map(entry => entry.clears)).toEqual([
			[{ key: "auspicious-birth", name: "Auspicious Birth's background circle" }], [],
		]);
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("background circle");

		await applyCampShares(aeliana);
		expect(aeliana.flags[SYSTEM_ID].background.setupResources["auspicious-birth"]).toBe(0);
		expect(bram.update).not.toHaveBeenCalledWith(expect.objectContaining({
			[`flags.${SYSTEM_ID}.background.setupResources.auspicious-birth`]: 0,
		}), expect.anything());
	});

	it("pays nobody's share itself: the plan landing on every client is what does that", async () => {
		const { aeliana, bram, camp } = await readyToSettle();
		bram.update.mockClear();
		await settleCamp(camp);
		expect(aeliana.flags[SYSTEM_ID].inventory.resources.supplies).toBe(4);
		expect(bram.update).not.toHaveBeenCalled();
	});
});

describe("paying the shares", () => {
	it("pays the shares this client was elected for, and only those", async () => {
		const { aeliana, bram } = await settled();
		await applyCampShares(aeliana);
		expect(payments(aeliana)).toHaveLength(1);
		expect(aeliana.update).toHaveBeenCalledWith(expect.any(Object), { stonetopMove: "Make Camp" });
		expect(aeliana.flags[SYSTEM_ID].inventory.resources.supplies).toBe(2);
		expect(aeliana.system.attributes.hp.value).toBe(12);
		expect(campOf(aeliana).applied).toBe(true);
		expect(bram.update).not.toHaveBeenCalled();
	});

	// Post-death audit: Quicksilver Dreams gives everyone else at the fire held disadvantage.
	it("lays held disadvantage on everyone with a Quicksilver Dreams Thrall, and not on the Thrall", async () => {
		const { aeliana, bram, act } = await settled({ bram: { pastDeath: "thrall", thrallMarks: ["quicksilver-dreams"] } });
		await applyCampShares(aeliana);
		expect(aeliana.flags[SYSTEM_ID].heldDisadvantage).toEqual({ sources: ["Nightmares (Quicksilver Dreams)"] });
		act("player-2");
		await applyCampShares(aeliana);
		expect(bram.flags[SYSTEM_ID].heldDisadvantage).toBeUndefined();
		expect(campOf(bram).applied).toBe(true);
	});

	it("leaves each player to pay their own character's share", async () => {
		const { aeliana, bram, act } = await settled();
		act("player-2");
		await applyCampShares(aeliana);
		expect(payments(bram)).toHaveLength(1);
		expect(bram.system.attributes.hp.value).toBe(12);
		expect(aeliana.update).not.toHaveBeenCalled();
	});

	it("has a GM pay the share of a player who is away", async () => {
		const { aeliana, bram, act } = await settled({ bramOnline: false });
		act("gm");
		await applyCampShares(aeliana);
		expect(payments(bram)).toHaveLength(1);
		expect(aeliana.update).not.toHaveBeenCalled();
	});

	// The plan landing is itself an update that runs this again, before the first write is back.
	it("never pays a share twice, however many times it is asked at once", async () => {
		const { aeliana } = await settled();
		await Promise.all([applyCampShares(aeliana), applyCampShares(aeliana)]);
		await applyCampShares(aeliana);
		expect(payments(aeliana)).toHaveLength(1);
	});

	// Two clients can each think the election is theirs for a moment: a player connecting just as the
	// camp settles, before the GM's client has heard they are back.
	it("claims a share with this user's id first, and leaves one another logged-in client has claimed", async () => {
		const { aeliana, bram, act } = await settled({ bramOnline: false });
		act("gm");
		bram.flags[SYSTEM_ID].camp.paidBy = "player-1";
		await applyCampShares(aeliana);
		expect(bram.update).not.toHaveBeenCalled();
		// A claim by somebody who has since logged off is no claim.
		game.users.contents.find(u => u.id === "player-1").active = false;
		await applyCampShares(aeliana);
		expect(bram.update.mock.calls[0][0]).toEqual({ [`flags.${SYSTEM_ID}.camp.paidBy`]: "gm" });
		expect(campOf(bram)).toMatchObject({ applied: true, paidBy: "gm" });
		expect(payments(bram)).toHaveLength(1);
	});

	it("pays nothing when another client's claim has replaced this one's by the time it would pay", async () => {
		const { aeliana, bram, act } = await settled({ bramOnline: false });
		act("gm");
		const write = bram.update.getMockImplementation();
		bram.update.mockImplementationOnce(async (update, options) => {
			await write(update, options);
			bram.flags[SYSTEM_ID].camp.paidBy = "player-1";
		});
		await applyCampShares(aeliana);
		expect(payments(bram)).toHaveLength(0);
		expect(campOf(bram).applied).toBe(false);
		expect(bram.system.attributes.hp.value).toBe(4);
	});

	// The share lands as absolute numbers, so what the pack and the HP were before the followers were
	// read must not be what is written: a blow or a find in between would be undone.
	it("reads the pack and the HP after reading the followers, right before it writes", async () => {
		const party = campParty({ aeliana: { followers: { hound: { party: true, hpMax: 6, hpCurrent: 6 } } } });
		const { aeliana, bram } = party;
		const camp = await hostCamp(aeliana);
		await joinCamp(bram, camp);
		await setCampChoices(aeliana, { "offer.supplies": 3 });
		await settleCamp(camp);
		aeliana.typedActor.playbook = async () => {
			// While the followers are read: a blow lands, and somebody finds two more uses of supplies.
			aeliana.system.attributes.hp.value = 2;
			aeliana.flags[SYSTEM_ID].inventory.resources.supplies = 6;
			throw new Error("no playbook to read");
		};
		await applyCampShares(aeliana);
		expect(aeliana.system.attributes.hp.value).toBe(10);
		expect(aeliana.flags[SYSTEM_ID].inventory.resources.supplies).toBe(3);
	});

	it("does not pay a character who has since sat down at another camp", async () => {
		const { aeliana, bram, act } = await settled();
		bram.flags[SYSTEM_ID].camp.id = "another-camp";
		act("player-2");
		await applyCampShares(aeliana);
		expect(bram.update).not.toHaveBeenCalled();
	});

	it("pays nothing for a camp that has not been settled", async () => {
		const { aeliana } = await readyToSettle();
		aeliana.update.mockClear();
		await applyCampShares(aeliana);
		expect(aeliana.update).not.toHaveBeenCalled();
	});
});

describe("the world's watch on camps", () => {
	it("pays this client's shares when a host's camp is settled", async () => {
		const { aeliana } = await settled();
		onUpdateActorCamp(aeliana, { flags: { [SYSTEM_ID]: { camp: { status: CAMP_STATUS.SETTLED } } } });
		await vi.waitFor(() => expect(payments(aeliana)).toHaveLength(1));
	});

	it("redraws the camp cards in the log when a camp changes state", async () => {
		const card  = { getFlag: (scope, key) => (key === "campJoin" ? { campId: "camp-x", hostId: "aeliana" } : undefined) };
		const other = { getFlag: () => undefined };
		const { aeliana } = campParty({ messages: [other, card] });
		await hostCamp(aeliana);
		onUpdateActorCamp(aeliana, { flags: { [SYSTEM_ID]: { camp: { status: CAMP_STATUS.CANCELLED } } } });
		expect(ui.chat.updateMessage).toHaveBeenCalledTimes(1);
		expect(ui.chat.updateMessage).toHaveBeenCalledWith(card);
	});

	it("ignores an update that does not touch a camp", async () => {
		const { aeliana } = await settled();
		onUpdateActorCamp(aeliana, { system: { attributes: { hp: { value: 3 } } } });
		await Promise.resolve();
		expect(ui.chat.updateMessage).not.toHaveBeenCalled();
		expect(aeliana.update).not.toHaveBeenCalled();
	});

	// A card's button reads who is sitting at its camp as well as whether that camp is open, and a
	// host who moves to another fire writes only their own record, which names the new camp.
	it("redraws the camp cards when anybody sits down or gets up", async () => {
		const card = { getFlag: (scope, key) => (key === "campJoin" ? { campId: "camp-x", hostId: "aeliana" } : undefined) };
		const { aeliana, bram } = campParty({ messages: [card] });
		await joinCamp(bram, await hostCamp(aeliana));
		onUpdateActorCamp(bram, { flags: { [SYSTEM_ID]: { camp: { id: campOf(bram).id, host: "aeliana" } } } });
		// Getting up, in both cores' spellings of a removed key.
		onUpdateActorCamp(bram, { flags: { [SYSTEM_ID]: { "-=camp": null } } });
		onUpdateActorCamp(bram, { flags: { [SYSTEM_ID]: { camp: new foundry.data.operators.ForcedDeletion() } } });
		expect(ui.chat.updateMessage).toHaveBeenCalledTimes(3);
	});

	// No updateActor says a character was deleted, so the cards of the camp they hosted stayed open.
	it("redraws the camp cards when a seated character is deleted, and not for one at no camp", async () => {
		const handlers = {};
		const setupHooks = globalThis.Hooks;
		globalThis.Hooks = { on: (name, fn) => { handlers[name] = fn; }, once: () => {} };
		try {
			registerCampHooks();
			expect(handlers.deleteActor).toBe(onDeleteActorCamp);
		} finally {
			globalThis.Hooks = setupHooks;
		}
		const card = { getFlag: (scope, key) => (key === "campJoin" ? { campId: "camp-x", hostId: "aeliana" } : undefined) };
		const { aeliana, bram } = campParty({ messages: [card] });
		onDeleteActorCamp(bram);
		expect(ui.chat.updateMessage).not.toHaveBeenCalled();
		await hostCamp(aeliana);
		onDeleteActorCamp(aeliana);
		expect(ui.chat.updateMessage).toHaveBeenCalledWith(card);
	});

	it("leaves the cards alone for a choice made at the fire", async () => {
		const card = { getFlag: (scope, key) => (key === "campJoin" ? { campId: "camp-x", hostId: "aeliana" } : undefined) };
		const { aeliana } = campParty({ messages: [card] });
		await hostCamp(aeliana);
		onUpdateActorCamp(aeliana, { flags: { [SYSTEM_ID]: { camp: { ready: true } } } });
		expect(ui.chat.updateMessage).not.toHaveBeenCalled();
	});

	// Whoever the election now picks pays, and that can be a player as easily as a GM.
	it("has a player's client pay a share that has fallen to it when somebody connects", async () => {
		const handlers = {};
		const setupHooks = globalThis.Hooks;
		globalThis.Hooks = { on: (name, fn) => { handlers[name] = fn; }, once: () => {} };
		try {
			registerCampHooks();
			const { bram, act } = await settled({ bramOnline: false });
			game.users.contents.find(u => u.id === "player-2").active = true;
			act("player-2");
			handlers.userConnected();
			await vi.waitFor(() => expect(campOf(bram).applied).toBe(true));
		} finally {
			globalThis.Hooks = setupHooks;
		}
	});
});

describe("one client settles a camp", () => {
	// A GM and the host's player pressing at once would otherwise each roll the bedrolls and each
	// post a summary.
	it("is the host's own player's: a GM's press asks that client to do it", async () => {
		const { aeliana, camp, act, toMessage } = await readyToSettle({ bram: { outfit: [{ slug: "bedroll", checked: true }] } });
		act("gm");
		expect(await settleCamp(camp)).toEqual({ ok: true, plan: null });
		expect(campOf(aeliana).status).toBe(CAMP_STATUS.OPEN);
		expect(campOf(aeliana).settleAsk).toEqual(expect.stringMatching(/.+/));
		expect(toMessage).not.toHaveBeenCalled();

		act("player-1");
		onUpdateActorCamp(aeliana, { flags: { [SYSTEM_ID]: { camp: { settleAsk: campOf(aeliana).settleAsk } } } });
		await vi.waitFor(() => expect(ChatMessage.create).toHaveBeenCalledTimes(1));
		expect(campOf(aeliana).status).toBe(CAMP_STATUS.SETTLED);
		expect(toMessage).toHaveBeenCalledTimes(1);
	});

	it("never settles on a client that was not elected, whatever it hears", async () => {
		const { aeliana, camp, act } = await readyToSettle();
		act("gm");
		await settleCamp(camp);
		onUpdateActorCamp(aeliana, { flags: { [SYSTEM_ID]: { camp: { settleAsk: campOf(aeliana).settleAsk } } } });
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(campOf(aeliana).status).toBe(CAMP_STATUS.OPEN);
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	// With the host's player away, the election can fall to another player who owns the host but does
	// not play it; that client settles the GM's request all the same.
	it("is settled from a GM's request by the elected client, though its player does not play the host", async () => {
		const { aeliana, camp, act } = await readyToSettle({ aeliana: { owners: ["player-1", "player-2"] } });
		game.users.contents.find(u => u.id === "player-1").active = false;
		act("gm");
		expect(await settleCamp(camp)).toEqual({ ok: true, plan: null });
		act("player-2");
		onUpdateActorCamp(aeliana, { flags: { [SYSTEM_ID]: { camp: { settleAsk: campOf(aeliana).settleAsk } } } });
		await vi.waitFor(() => expect(campOf(aeliana).status).toBe(CAMP_STATUS.SETTLED));
	});

	it("tells the client that asked, and only that one, why the settling client could not settle", async () => {
		const { aeliana, camp, act } = await readyToSettle();
		act("gm");
		await settleCamp(camp);
		const ask = campOf(aeliana).settleAsk;
		// Before the host's player hears the request, the meal has come up short.
		campOf(aeliana).offer.supplies = 1;
		act("player-1");
		onUpdateActorCamp(aeliana, { flags: { [SYSTEM_ID]: { camp: { settleAsk: ask } } } });
		await vi.waitFor(() => expect(campOf(aeliana).settleRefused).toEqual({ ask, reason: SETTLE_REFUSAL.SHORT }));
		expect(campOf(aeliana).status).toBe(CAMP_STATUS.OPEN);
		expect(ui.notifications.warn).not.toHaveBeenCalled();
		// The GM's client hears the answer, once.
		act("gm");
		const answer = { flags: { [SYSTEM_ID]: { camp: { settleRefused: campOf(aeliana).settleRefused } } } };
		onUpdateActorCamp(aeliana, answer);
		onUpdateActorCamp(aeliana, answer);
		expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
		expect(ui.notifications.warn).toHaveBeenCalledWith(settleRefusalText(SETTLE_REFUSAL.SHORT));
	});

	it("settles once when pressed twice at once", async () => {
		const { aeliana, camp } = await readyToSettle();
		aeliana.update.mockClear();
		const results = await Promise.all([settleCamp(camp), settleCamp(camp)]);
		expect(results.filter(result => result.ok)).toHaveLength(1);
		expect(aeliana.update).toHaveBeenCalledTimes(1);
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
	});
});

describe("a share owed to a player who was away", () => {
	/** Settled with Bram's player away and no GM on, so nobody could pay Bram's share. Aeliana's is paid. */
	async function settledWhileBramAway() {
		const party = await settled({ bramOnline: false });
		game.users.contents.find(u => u.id === "gm").active = false;
		await applyCampShares(party.aeliana);
		return party;
	}

	/** Bram's player comes back, and their client looks for anything it owes. */
	async function bramReturns({ act }) {
		game.users.contents.find(u => u.id === "player-2").active = true;
		act("player-2");
		await payPendingShares();
	}

	// Sitting down writes a fresh record over the one the settled plan was kept on.
	it("is still paid after the host has sat down at a new camp", async () => {
		const party = await settledWhileBramAway();
		const { aeliana, bram } = party;
		const first = campOf(aeliana).id;
		await hostCamp(aeliana);
		expect(aeliana.flags[SYSTEM_ID].campOwed).toEqual([{ id: first, plan: [expect.objectContaining({ actorId: "bram" })] }]);
		await bramReturns(party);
		expect(bram.system.attributes.hp.value).toBe(12);
		expect(campOf(bram).applied).toBe(true);
	});

	it("is let go once every share of it is paid", async () => {
		const party = await settledWhileBramAway();
		await hostCamp(party.aeliana);
		await bramReturns(party);
		party.act("player-1");
		await hostCamp(party.aeliana);
		expect(party.aeliana.flags[SYSTEM_ID].campOwed).toEqual([]);
	});
});
