import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BECAME_THREAT_FLAG, canBecomeThreat, makeThreatOf, monsterDataFrom, threatSeedFrom,
} from "../../module/campaign/become-threat.js";
import { BecomeThreatDialog } from "../../module/campaign/BecomeThreatDialog.js";
import { leftPlayRecord } from "../../module/campaign/left-play.js";
import { isOutOfPlay } from "../../module/actors/character/deaths-door-actor.js";
import { campaignMenuEntries } from "../../module/campaign/campaign-actor-menu.js";

// Book I p.584: "When a PC descends into villainy and monstrosity, they stop becoming a PC and become a threat
// under the GM's control. Write them up as both a threat (page 282) and a monster (page 391)". p.481: a follower
// whose breakup is messy "might very well become a threat".

const SCOPE = "stonetop-pwd";

function actor(data) {
	const a = {
		flags: {},
		...data,
		update: vi.fn(async changes => {
			for (const [path, value] of Object.entries(changes)) {
				const parts = path.split(".");
				const last = parts.pop();
				let node = a;
				for (const p of parts) node = node[p] ??= {};
				node[last] = value;
			}
		}),
	};
	return a;
}

const villain = () => actor({
	id: "vahid", uuid: "Actor.vahid", name: "Vahid", img: "vahid.webp", type: "character",
	system: { attributes: { hp: { max: 18 }, armor: { value: 1 }, damage: { value: "d6" } } },
});
const spirit = () => actor({ id: "wind", uuid: "Actor.wind", name: "Wind Spirit", type: "npc", system: { instinct: "to frolic" } });

let user;
beforeEach(() => { user = { isGM: true }; global.game.user = user; });
afterEach(() => { delete global.game.user; });

describe("who can become a threat", () => {
	it("is the GM's call, for a PC in play or an NPC", () => {
		expect(canBecomeThreat(villain())).toBe(true);
		expect(canBecomeThreat(spirit())).toBe(true);
		expect(canBecomeThreat(actor({ type: "monster" }))).toBe(false);
		expect(canBecomeThreat(actor({ type: "character", flags: { [SCOPE]: { deathsDoor: "dead" } } }))).toBe(false);
		user.isGM = false;
		expect(canBecomeThreat(villain())).toBe(false);
	});

	// BECAME_THREAT_FLAG names the page they became, "so it is not made twice by accident": while that page is
	// there they are not offered again; once it is deleted they are.
	it("is not offered twice while the threat they became is still written up", () => {
		const wind = spirit();
		wind.flags[SCOPE] = { [BECAME_THREAT_FLAG]: "JournalEntry.t.JournalEntryPage.p" };
		expect(canBecomeThreat(wind, user, { pageExists: uuid => uuid === "JournalEntry.t.JournalEntryPage.p" })).toBe(false);
		expect(canBecomeThreat(wind, user, { pageExists: () => false })).toBe(true);
		expect(canBecomeThreat(spirit(), user, { pageExists: () => true })).toBe(true);
	});
});

describe("the write-up", () => {
	it("seeds the threat with the name, the type's moves, and the way back to the actor", () => {
		const seed = threatSeedFrom(villain(), { type: "villain", proximity: "homefront" });
		expect(seed).toMatchObject({ name: "Vahid", type: "villain", proximity: "homefront" });
		expect(seed.gmMoves.length).toBeGreaterThan(0);
		expect(seed.description).toContain("@UUID[Actor.vahid]{Vahid}");
		expect(seed.description).toContain("p.584");
		expect(threatSeedFrom(spirit(), { type: "magicalEntity" }).description).toContain("p.481");
		expect(threatSeedFrom(spirit(), { type: "nonsense" }).type).toBe("villain");
	});

	it("seeds the monster from the sheet's HP, armor and damage", () => {
		const data = monsterDataFrom(villain());
		expect(data).toMatchObject({ name: "Vahid", type: "monster", img: "vahid.webp" });
		expect(data.system.attributes).toMatchObject({ hp: { value: 18, max: 18 }, armor: { value: 1 }, damage: { value: "d6", rollFormula: "d6" } });
	});
});

describe("making the threat", () => {
	it("writes a PC up as a threat and a monster, links them, and takes the PC out of play", async () => {
		const vahid = villain();
		const page = { uuid: "JournalEntry.t.JournalEntryPage.p", update: vi.fn() };
		const create = vi.fn(async () => page);
		const monster = { uuid: "Actor.m" };
		const createActor = vi.fn(async () => monster);
		const result = await makeThreatOf(vahid, { type: "villain", monster: true, outOfPlay: true }, { steading: {}, create, createActor });
		expect(result).toEqual({ page, monster });
		expect(createActor).toHaveBeenCalledWith(expect.objectContaining({ type: "monster" }), { stonetopMonsterBuilt: true });
		expect(page.update).toHaveBeenCalledWith({ "system.linkedMonsterUuid": "Actor.m" });
		expect(vahid.flags[SCOPE][BECAME_THREAT_FLAG]).toBe(page.uuid);
		expect(leftPlayRecord(vahid)).toMatchObject({ how: "villain", threatUuid: page.uuid });
		expect(isOutOfPlay(vahid)).toBe(true);
	});

	it("writes a follower up as a threat alone when the monster is unticked", async () => {
		const wind = spirit();
		const createActor = vi.fn();
		await makeThreatOf(wind, { type: "magicalEntity", monster: false, outOfPlay: true }, { steading: {}, create: async () => ({ uuid: "p" }), createActor });
		expect(createActor).not.toHaveBeenCalled();
		expect(leftPlayRecord(wind)).toBeNull();
	});

	it("needs a steading to file the threat under", async () => {
		expect(await makeThreatOf(villain(), {}, { steading: null, create: vi.fn() })).toBeNull();
	});
});

describe("the window", () => {
	it("ticks the monster and out of play for a PC (p.584), and neither for a follower (p.481)", () => {
		expect(new BecomeThreatDialog(villain()).getData().state).toMatchObject({ monster: true, outOfPlay: true, instinct: "" });
		const follower = new BecomeThreatDialog(spirit()).getData();
		expect(follower.isPc).toBe(false);
		expect(follower.state).toMatchObject({ monster: false, instinct: "to frolic", type: "villain" });
	});
});

describe("the Actors sidebar menu", () => {
	const row = id => ({ dataset: { entryId: id } });

	it("offers Retire to an owner, and the threat and Return to Play to the GM", () => {
		const vahid = villain();
		vahid.isOwner = true;
		const gone = actor({ id: "gone", type: "character", flags: { [SCOPE]: { leftPlay: { how: "left" } } } });
		global.game.actors = new Map([["vahid", vahid], ["gone", gone]]);
		try {
			const [retire, threat, back] = campaignMenuEntries();
			expect(retire.visible(row("vahid"))).toBe(true);
			expect(threat.visible(row("vahid"))).toBe(true);
			expect(back.visible(row("vahid"))).toBe(false);
			expect(retire.visible(row("gone"))).toBe(false);
			expect(back.visible(row("gone"))).toBe(true);
			user.isGM = false;
			expect(retire.visible(row("vahid"))).toBe(true);
			expect(threat.visible(row("vahid"))).toBe(false);
			expect(back.visible(row("gone"))).toBe(false);
		} finally {
			delete global.game.actors;
		}
	});
});
