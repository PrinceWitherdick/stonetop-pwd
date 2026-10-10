import { describe, it, expect, vi } from "vitest";
import { crewMemberHpMax, followerRoster, followerRosterOf, partyFollowersOf } from "../../../module/actors/character/follower-roster.js";
import { ANIMAL_COMPANION_MOVE } from "../../../module/actors/character/animal-companion.js";

// Who a character's followers are, read from their flags and playbook rather than off a sheet, so
// the camp and the expedition answer with any sheet open or none, and with any sheet class in use.

const WOLF_DEF = { types: [{ slug: "wolf", label: "Wolf", hp: 6, armor: 1, damage: "d6", traits: [] }] };
const actorWith = (items = []) => ({ name: "Rhianna", items });

describe("followerRoster", () => {
	it("reads each kind that is present, with its HP and its party toggle", () => {
		const sf = {
			animalCompanion: { type: "wolf", name: "Fang", hpCurrent: 2 },
			crew: { name: "The Wolves", size: 4 },
			inventory: { addedSpecial: ["horse", "goat"] },
			beastHp: { horse: 3 },
			beastParty: { horse: true },
			customFollowers: {
				b: { name: "Bryn", hpMax: 5, order: 2, party: true },
				a: { name: "Aled", hpMax: 4, order: 1, dead: true },
			},
		};
		const roster = followerRoster(actorWith([{ type: "move", name: ANIMAL_COMPANION_MOVE }]), sf, {
			crewDef: {}, companionDef: WOLF_DEF, crewStats: { memberHp: 7 },
		});
		expect(roster.map(f => [f.ftype, f.slug, f.name, f.party])).toEqual([
			["animal-companion", "", "Fang", true],
			["crew", "", "The Wolves", true],
			["beast", "goat", "Goat", false],
			["beast", "horse", "Horse", true],
			["custom", "a", "Aled", false],
			["custom", "b", "Bryn", true],
		]);
		const by = Object.fromEntries(roster.map(f => [`${f.ftype}:${f.slug}`, f]));
		expect(by["animal-companion:"]).toMatchObject({ hpMax: 6, hpCurrent: 2 });
		expect(by["crew:"]).toMatchObject({ isGroup: true, memberHp: 7, hpMax: null });
		expect(by["beast:horse"]).toMatchObject({ hpMax: 10, hpCurrent: 3 });
		expect(by["custom:a"].dead).toBe(true);
		expect(by["custom:b"]).toMatchObject({ hpMax: 5, hpCurrent: 5 });
	});

	it("leaves out a companion whose move is not owned, and a crew with no definition", () => {
		const sf = { animalCompanion: { type: "wolf" }, crew: { name: "The Wolves" } };
		expect(followerRoster(actorWith(), sf, { companionDef: WOLF_DEF })).toEqual([]);
	});

	it("takes a hand-set Max HP over the derived one, as the card does", () => {
		const sf = { inventory: { addedSpecial: ["horse"] }, beastDetails: { horse: { hpMax: "14" } }, beastHp: { horse: 20 } };
		expect(followerRoster(actorWith(), sf)[0]).toMatchObject({ hpMax: 14, hpCurrent: 14 });
		expect(crewMemberHpMax({ crew: { details: { hpMax: "9" } } }, { memberHp: 6 })).toBe(9);
		expect(crewMemberHpMax({ crew: { details: { hpMax: "" } } }, { memberHp: 6 })).toBe(6);
	});

	it("leaves out a Servant batch that broke free (Book II p.561: no longer followers)", () => {
		const sf = { customFollowers: {
			s: { name: "Deep Ones", hpMax: 3, order: 1, party: true, brokenFree: true },
			r: { name: "Ring of Daagon", hpMax: 0, order: 2, party: true },
		} };
		expect(followerRoster(actorWith(), sf).map(f => f.slug)).toEqual(["r"]);
	});
});

describe("followerRosterOf", () => {
	it("falls back on what the flags alone say when the playbook can't be read", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const flags = { "stonetop-pwd": { customFollowers: { h: { name: "Hound", party: true } } } };
			const actor = { name: "Rhianna", items: [], flags, getFlag: () => undefined, typedActor: { playbook: async () => { throw new Error("no pack"); } } };
			expect((await followerRosterOf(actor)).map(f => f.name)).toEqual(["Hound"]);
			expect((await partyFollowersOf(actor)).map(f => f.name)).toEqual(["Hound"]);
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});
