import { describe, it, expect } from "vitest";
import { combatantVitals, combatantReminders, vitalsLine, followerRoster, fightVitalsKey } from "../../module/fight/fight-vitals.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// The numbers on a Fight tab row: HP, armor, and how many of a group follower are standing.

const format = (key, data) => globalThis.game.i18n.format(key, data);

const crewToken = (origin = { characterUuid: "Actor.rhianna", ftype: "crew", slug: "" }) => ({
	id: "cCrew",
	actor: { flags: { [SYSTEM_ID]: { followerOrigin: origin } }, system: { attributes: { hp: { value: 3, max: 6 }, armor: { value: 1 } } } },
});
const rhianna = { uuid: "Actor.rhianna", flags: { [SYSTEM_ID]: { crew: { size: 5, memberHp: [0, 0] } } } };
const resolve = uuid => (uuid === rhianna.uuid ? rhianna : null);

describe("fight row numbers", () => {
	it("reads HP and armor, and prints them", () => {
		const vitals = combatantVitals(crewToken());
		expect(vitals).toEqual({ hp: 3, hpMax: 6, armor: 1, readiness: 0 });
		expect(vitalsLine(vitals, format)).toBe("HP 3/6 · Armor 1");
		expect(vitalsLine({ hp: 3, hpMax: null, armor: null }, format)).toBe("HP 3");
		expect(vitalsLine({ hp: 7, hpMax: 10, armor: 2, readiness: 2 }, format)).toBe("HP 7/10 · Armor 2 · Readiness 2");
		expect(vitalsLine({}, format)).toBe("");
	});

	it("counts a crew's standing members off the character it follows", () => {
		expect(followerRoster(crewToken(), { resolve })).toEqual({ standing: 3, size: 5 });
	});

	it("has no roster for a follower whose character is gone, or an actor that follows nobody", () => {
		expect(followerRoster(crewToken({ characterUuid: "Actor.gone", ftype: "crew" }), { resolve })).toBeNull();
		expect(followerRoster({ actor: { flags: {} } }, { resolve })).toBeNull();
		expect(followerRoster(crewToken(), { resolve: () => { throw new Error("embedded"); } })).toBeNull();
	});

	it("carries a character's gear tags and reminders, and nobody else's", () => {
		const hero = { id: "cHero", actor: { type: "character", system: { attributes: { hp: { value: 5, max: 10 }, armor: { value: 2 }, gearTags: [{ tag: "warm", items: ["Cloak"] }] }, reminders: ["Owes Gwen"] } } };
		expect(combatantReminders(hero).map(c => c.label)).toEqual(["Warm", "Owes Gwen"]);
		expect(combatantReminders({ actor: { type: "monster", system: { reminders: ["x"] } } })).toEqual([]);
	});

	it("changes its redraw key when a character's reminders change", () => {
		const hero = { id: "cHero", actor: { type: "character", system: { attributes: { hp: { value: 5, max: 10 }, armor: { value: 2 }, gearTags: [] }, reminders: [] } } };
		const combat = { combatants: [hero] };
		const before = fightVitalsKey(combat, { resolve });
		hero.actor.system.attributes.gearTags = [{ tag: "cumbersome", items: ["Hauberk"] }];
		const withTag = fightVitalsKey(combat, { resolve });
		expect(withTag).not.toBe(before);
		hero.actor.system.reminders = ["Reeks of smoke"];
		expect(fightVitalsKey(combat, { resolve })).not.toBe(withTag);
	});

	it("changes its redraw key when a crew member falls", () => {
		const combat = { combatants: [crewToken()] };
		const before = fightVitalsKey(combat, { resolve });
		rhianna.flags[SYSTEM_ID].crew.memberHp = [0, 0, 0];
		expect(fightVitalsKey(combat, { resolve })).not.toBe(before);
	});
});
