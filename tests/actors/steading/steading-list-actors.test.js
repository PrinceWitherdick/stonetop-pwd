import { beforeEach, describe, expect, it } from "vitest";
import { steadingListActors } from "../../../module/actors/steading/steading-people.js";

// ONE ROSTER AT A TIME, which `steadingPeopleActors` beside it deliberately does not offer: that
// one is both lists at once, for a sheet asking "who is there to rate?".
//
// The caller this exists for is the relationship map's village board, which seats the people of
// STONETOP and nobody else. Reading the combined list there would put every neighbour on the
// village's own board — a mistake nothing downstream could detect, since a neighbour is a perfectly
// ordinary person to have on a map.

let actors;

/** A steading whose rosters point at these actors, in the order given. */
const steadingWith = lists => ({
	type: "stonetop",
	getFlag: (scope, key) => (scope === "stonetop-pwd" && key === "steading" ? lists : null),
});

const row = actor => ({ id: actor.id, uuid: actor.uuid, name: actor.name });
const npc = name => ({ id: name.toLowerCase(), uuid: `Actor.${name.toLowerCase()}`, name, type: "npc" });

beforeEach(() => {
	actors = [npc("Quill"), npc("Maeve"), npc("Gethin")];
	global.game.actors = {
		get: id => actors.find(a => a.id === id) ?? null,
		find: fn => actors.find(fn) ?? null,
		contents: actors,
	};
});

describe("one of the steading's rosters", () => {
	it("resolves the residents, in sheet order, and leaves the neighbours out", () => {
		const steading = steadingWith({
			residents: [row(actors[1]), row(actors[0])],
			neighbors: [row(actors[2])],
		});
		expect(steadingListActors("residents", steading).map(a => a.name)).toEqual(["Maeve", "Quill"]);
		expect(steadingListActors("neighbors", steading).map(a => a.name)).toEqual(["Gethin"]);
	});

	// A row whose actor has been deleted is a row with nobody behind it. It is skipped rather than
	// yielding null, or every caller would have to filter the list it was just handed.
	it("skips a row whose actor is gone, and a legacy text row", () => {
		const steading = steadingWith({
			residents: [row(actors[0]), { id: "ghost", uuid: "Actor.ghost", name: "Ghost" }, { name: "Old Bartholomew" }],
		});
		expect(steadingListActors("residents", steading).map(a => a.name)).toEqual(["Quill"]);
	});

	it("counts somebody listed twice only once", () => {
		const steading = steadingWith({ residents: [row(actors[0]), row(actors[0])] });
		expect(steadingListActors("residents", steading)).toHaveLength(1);
	});

	// No steading, no list, nothing to read: an empty list every time, never a throw. The map calls
	// this on open, and a world that has not made its steading yet must still be able to open a map.
	it("is safe on a world with no steading and on a list nobody has filled", () => {
		expect(steadingListActors("residents", null)).toEqual([]);
		expect(steadingListActors("residents", steadingWith({}))).toEqual([]);
		expect(steadingListActors("residents", steadingWith({ residents: "not a list" }))).toEqual([]);
	});
});
