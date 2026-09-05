import { describe, it, expect, beforeEach } from "vitest";
import { groupPeople, peopleGroupOf, personNote } from "../../module/utils/people-groups.js";

// WHO IS A NEIGHBOUR, and who decides.
//
// The people chooser offers the village's own lists, and every one of its answers has to agree with
// the steading sheet: a person filed under Neighbors there and offered under Residents here is a
// window telling the table something about their own world that is not true.
//
// The three signals are asked in a fixed order (roster, then folder, then the Home on the sheet),
// and the order is the whole of the behaviour: each one is right where the one before it is silent,
// and each one can contradict the next. That is what this suite pins.

/** An NPC as the world holds one. `home: ""` is the shape a brand new NPC actually has. */
const npc = (name, { home = "", occupation = "", folder = null, id = name } = {}) => ({
	id, name, type: "npc", folder: folder ? { name: folder } : null,
	system: { home, occupation },
});

const pc = (name, playbook = "") => ({
	id: name, name, type: "character", system: { playbook: { name: playbook } },
});

/** A world holding a steading whose two rosters point at these actors. */
function worldWith({ residents = [], neighbors = [], loose = [] } = {}) {
	const rows = list => list.map(actor => ({ id: actor.id, uuid: `Actor.${actor.id}`, name: actor.name }));
	const steading = {
		id: "steading", name: "Stonetop", type: "stonetop",
		getFlag: () => ({ residents: rows(residents), neighbors: rows(neighbors) }),
	};
	const actors = [steading, ...residents, ...neighbors, ...loose];
	actors.get = id => actors.find(actor => actor.id === id) ?? null;
	global.game.actors = actors;
	return steading;
}

beforeEach(() => { global.game.actors = undefined; });

describe("which list somebody is on", () => {
	it("puts a player character with the players, wherever they are filed", () => {
		expect(peopleGroupOf(pc("Pim", "The Lightbearer"))).toBe("players");
	});

	// ⚠ THE ROSTER OUTRANKS THE SHEET, and this is the case that proves it: somebody the table has
	// deliberately filed as a resident, whose Home says they came from Marshedge. The list is an
	// answer a person gave on purpose; the Home is a fact about them that does not decide it.
	it("takes the steading's own roster over anything written on the sheet", () => {
		const marrec = npc("Marrec", { home: "Marshedge" });
		worldWith({ residents: [marrec] });
		const [group] = groupPeople([{ id: "a", name: marrec.name, actor: marrec }]);
		expect(group.key).toBe("residents");
	});

	// The second signal: the row has been taken off the sheet, but the folder they were made in
	// still says what they were made as.
	it("falls back to the people folder for somebody no longer on a roster", () => {
		const npcInFolder = npc("Tamsin", { folder: "Neighbors of Stonetop" });
		worldWith({ loose: [npcInFolder] });
		expect(peopleGroupOf(npcInFolder)).toBe("neighbors");
	});

	// And the last: the field's OWN rule, written where the field is written (npcHome), not
	// guessed at here. A blank Home is the village itself.
	it("reads a blank Home as the village, and a filled one as somewhere else", () => {
		expect(peopleGroupOf(npc("Quill"))).toBe("residents");
		expect(peopleGroupOf(npc("Tovia", { home: "Gordin's Delve" }))).toBe("neighbors");
	});

	// A name on a board with no sheet behind it is somebody the map is about, and has to stay
	// offered: dropping them would leave a hole in a list whose whole job is to be complete.
	it("offers somebody with no sheet at all under everyone else", () => {
		expect(peopleGroupOf(null)).toBe("others");
	});

	it("keeps a monster off the village's lists", () => {
		expect(peopleGroupOf({ id: "m", name: "Gnarl", type: "monster" })).toBe("others");
	});
});

describe("the lists a chooser is given", () => {
	it("drops the lists nobody is on", () => {
		const groups = groupPeople([
			{ id: "1", name: "Pim", actor: pc("Pim") },
			{ id: "2", name: "Quill", actor: npc("Quill") },
		]);
		expect(groups.map(group => group.key)).toEqual(["players", "residents"]);
	});

	it("names each list the way the steading sheet does", () => {
		const [players] = groupPeople([{ id: "1", name: "Pim", actor: pc("Pim") }]);
		expect(players.label).toBe("Players");
		expect(players.icon).toBeTruthy();
	});

	// The order the world happens to hold its actors in is not an order anybody can predict, and a
	// list of two dozen names in it is a list you have to read all of.
	it("puts every list in name order", () => {
		const [residents] = groupPeople([
			{ id: "1", name: "Tovia", actor: npc("Tovia") },
			{ id: "2", name: "Aerin", actor: npc("Aerin") },
			{ id: "3", name: "Maeve", actor: npc("Maeve") },
		]);
		expect(residents.people.map(person => person.name)).toEqual(["Aerin", "Maeve", "Tovia"]);
	});

	it("hands each person back with the fields they arrived with", () => {
		const [group] = groupPeople([{ id: "n1", name: "Quill", hint: "the smith", actor: npc("Quill") }]);
		expect(group.people[0]).toMatchObject({ id: "n1", name: "Quill", hint: "the smith" });
	});

	it("is safe on nothing at all", () => {
		expect(groupPeople([])).toEqual([]);
		expect(groupPeople(null)).toEqual([]);
	});
});

describe("who somebody is, in one line", () => {
	it("says a player character's playbook", () => {
		expect(personNote(pc("Pim", "The Lightbearer"))).toBe("The Lightbearer");
	});

	it("says a resident's trade, and not that they live in Stonetop", () => {
		expect(personNote(npc("Quill", { occupation: "smith", home: "Stonetop" }))).toBe("smith");
	});

	// The home is worth saying precisely when it is not the village, which is what tells two
	// similarly named people apart on the Neighbors list.
	it("says where a neighbour is from, beside their trade", () => {
		expect(personNote(npc("Tovia", { occupation: "trader", home: "Marshedge" }))).toBe("trader, Marshedge");
	});

	it("says nothing about somebody with nothing written down", () => {
		expect(personNote(npc("Pell"))).toBe("");
		expect(personNote(null)).toBe("");
	});
});
