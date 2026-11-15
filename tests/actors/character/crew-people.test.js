import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	applyCrewRowPatch, crewMemberOf, crewMemberPersonData, crewPersonOccupation, crewPersonReconcile, crewPersonTraits,
	crewPersonTraitsFollowRoster, crewRowWriteBack, ensureCrewMemberPeople, markCrewPersonDead, onUpdateActorCrewPerson,
	onItemChangeCrewSheets, onUpdateActorCrewRoster, onUpdateActorCrewSheets, releaseCrewPerson, replaceCrewPerson,
	syncCrewMemberPeople, CREW_SHEET_REDRAW_MS,
} from "../../../module/actors/character/crew-people.js";
import { MAKER_STAGGER_MS, sweepOnce, sweepQueued } from "../../../module/actors/character/follower-actors.js";
import { followerCardFor, followerMasterIndex } from "../../../module/actors/character/follower-masters.js";

// A Marshal's NAMED crew members each get a Person (an npc in Followers) so they can go on the
// relationship map and carry hearts toward the PCs. Name and face sync both ways; tag and traits
// follow the roster; the link is `personUuid` on the row, which the follower machinery must NOT
// read as the crew card's own actor.

const SYS = "stonetop-pwd";
const CTX = { characterName: "Pim", crewName: "" };

let created, docs;

function makeCharacter(individuals = [], extra = {}) {
	const character = {
		id: "pc1",
		uuid: "Actor.pc1",
		type: "character",
		name: "Pim",
		isOwner: true,
		ownership: { default: 0, user1: 3 },
		flags: { [SYS]: { crew: { name: "", individuals } } },
		update: vi.fn(async (data) => {
			const rows = data[`flags.${SYS}.crew.individuals`];
			if (rows) character.flags[SYS].crew.individuals = rows;
		}),
		testUserPermission: () => true,
		...extra,
	};
	character.documentName = "Actor";
	docs.set(character.uuid, character);
	return character;
}

function makePerson(uuid, { name = "Wren", img = "", flags = {}, system = {}, ...rest } = {}) {
	const person = {
		uuid, id: uuid.split(".").pop(), documentName: "Actor", type: "npc", name, img,
		isOwner: true, system: { occupation: "", traits: "", ...system },
		flags: { [SYS]: { crewMember: { characterUuid: "Actor.pc1" }, ...flags } },
		update: vi.fn(async () => {}),
		delete: vi.fn(async () => {}),
		...rest,
	};
	docs.set(uuid, person);
	return person;
}

beforeEach(() => {
	created = [];
	docs = new Map();
	globalThis.CONST = { TOKEN_DISPLAY_MODES: { HOVER: 30 }, TOKEN_DISPOSITIONS: { FRIENDLY: 1 } };
	globalThis.game = {
		user: { id: "user1" },
		users: { contents: [{ id: "user1", active: true }] },
		folders: [{ type: "Actor", name: "Followers", id: "fold1" }],
	};
	globalThis.fromUuidSync = vi.fn((uuid) => docs.get(uuid) ?? null);
	globalThis.Folder = { canUserCreate: () => true, create: vi.fn(async () => ({ id: "fold1" })) };
	globalThis.Actor = {
		canUserCreate: vi.fn(() => true),
		create: vi.fn(async (data) => {
			const actor = { ...data, documentName: "Actor", uuid: `Actor.new${created.length}`, delete: vi.fn(async () => {}) };
			created.push(actor);
			return actor;
		}),
	};
});

describe("the Person's words", () => {
	it("says whose crew they are on", () => {
		expect(crewPersonOccupation("Pim", "")).toBe("Pim's crew");
		expect(crewPersonOccupation("Pim", "The Grey Company")).toBe("The Grey Company (Pim's crew)");
	});

	it("runs tag and traits together, skipping blanks", () => {
		expect(crewPersonTraits({ tag: "tough", traits: ["loyal", " ", "scarred"] })).toBe("tough, loyal, scarred");
		expect(crewPersonTraits({})).toBe("");
	});
});

describe("crewMemberPersonData", () => {
	it("makes a plain Person: no stat block, no follower-card link, a linked friendly token", () => {
		const data = crewMemberPersonData({ name: "Wren", tag: "tough", traits: ["loyal"] },
			{ characterUuid: "Actor.pc1", characterName: "Pim", folder: "fold1", ownership: { user1: 3 } });

		expect(data).toMatchObject({
			name: "Wren", type: "npc", folder: "fold1", ownership: { user1: 3 },
			system: { occupation: "Pim's crew", traits: "tough, loyal", hasStats: false },
			prototypeToken: { actorLink: true, disposition: 1 },
		});
		expect(data.flags[SYS].crewMember).toEqual({ characterUuid: "Actor.pc1", made: true });
		// The follower machinery must never read this Person as the crew card's group actor.
		expect(data.flags[SYS].followerOrigin).toBeUndefined();
		expect(data.img).toBeTruthy();
	});

	it("wears the row's own face and crop when it has one", () => {
		const frame = { src: "a.webp", rect: [0, 0, 1, 1] };
		const data = crewMemberPersonData({ name: "Wren", img: "a.webp", portraitFrame: frame }, { characterUuid: "Actor.pc1" });
		expect(data.img).toBe("a.webp");
		expect(data.flags[SYS].portraitFrame).toEqual(frame);
	});
});

describe("crewPersonReconcile", () => {
	const stamped = (fields) => ({ crewMemberCard: { name: "Wren", img: "", frame: null, occupation: "Pim's crew", traits: "tough", ...fields } });

	it("is null when the two already agree", () => {
		const person = makePerson("Actor.p1", { flags: stamped({}), system: { occupation: "Pim's crew", traits: "tough" } });
		expect(crewPersonReconcile(person, { name: "Wren", tag: "tough", personUuid: "Actor.p1" }, CTX)).toBeNull();
	});

	it("pushes a rename on the roster to the Person", () => {
		const person = makePerson("Actor.p1", { flags: stamped({}), system: { occupation: "Pim's crew", traits: "tough" } });
		const step = crewPersonReconcile(person, { name: "Wren the Bold", tag: "tough" }, CTX);
		expect(step.personUpdate.name).toBe("Wren the Bold");
		expect(step.rowPatch).toBeNull();
	});

	it("pulls a rename on the Person's sheet back to the roster", () => {
		const person = makePerson("Actor.p1", { name: "Wrenna", flags: stamped({}), system: { occupation: "Pim's crew", traits: "tough" } });
		const step = crewPersonReconcile(person, { name: "Wren", tag: "tough" }, CTX);
		expect(step.rowPatch).toEqual({ name: "Wrenna" });
		expect(step.personUpdate[`flags.${SYS}.crewMemberCard`].name).toBe("Wrenna");
	});

	it("pulls a face chosen on the Person's sheet, and pushes one chosen on the roster", () => {
		const pulled = crewPersonReconcile(
			makePerson("Actor.p1", { img: "face.webp", flags: stamped({}), system: { occupation: "Pim's crew", traits: "tough" } }),
			{ name: "Wren", tag: "tough" }, CTX);
		expect(pulled.rowPatch).toEqual({ img: "face.webp" });

		const pushed = crewPersonReconcile(
			makePerson("Actor.p2", { flags: stamped({}), system: { occupation: "Pim's crew", traits: "tough" } }),
			{ name: "Wren", tag: "tough", img: "roster.webp" }, CTX);
		expect(pushed.personUpdate.img).toBe("roster.webp");
		expect(pushed.rowPatch).toBeNull();
	});

	it("leaves occupation and traits typed on the Person's own sheet alone", () => {
		const person = makePerson("Actor.p1", { flags: stamped({}), system: { occupation: "Smith", traits: "grim" } });
		const step = crewPersonReconcile(person, { name: "Wren", tag: "quick" }, CTX);
		expect(step?.personUpdate?.["system.occupation"]).toBeUndefined();
		expect(step?.personUpdate?.["system.traits"]).toBeUndefined();
	});

	it("lets the roster win a name for a Person just linked by hand, but keeps that Person's face", () => {
		// No stamp yet: the Person was made before the crew knew them.
		const person = makePerson("Actor.p1", { name: "Old Wren", img: "their-face.webp", flags: {}, system: { occupation: "Smith" } });
		const step = crewPersonReconcile(person, { name: "Wren" }, CTX);
		expect(step.personUpdate.name).toBe("Wren");
		expect(step.rowPatch).toEqual({ img: "their-face.webp" });
		expect(step.personUpdate["system.occupation"]).toBeUndefined();
	});
});

describe("writing a row back", () => {
	it("finds the member by their Person after the roster shifted", () => {
		const rows = [{ name: "Ash", personUuid: "Actor.a" }, { name: "Wren", personUuid: "Actor.w", img: "x.webp", portraitFrame: {} }];
		const next = crewRowWriteBack(rows, "Actor.w", { name: "Wrenna", img: "" });
		expect(next[1]).toEqual({ name: "Wrenna", personUuid: "Actor.w" });
		expect(next[0]).toBe(rows[0]);
		expect(crewRowWriteBack(rows, "Actor.gone", { name: "x" })).toBeNull();
	});

	it("keeps everything else on the row", () => {
		expect(applyCrewRowPatch({ name: "A", tag: "t", traits: ["x"], personUuid: "u" }, { name: "B" }))
			.toEqual({ name: "B", tag: "t", traits: ["x"], personUuid: "u" });
	});
});

describe("ensureCrewMemberPeople", () => {
	it("makes a Person for each named member and links them on the row, quietly", async () => {
		const character = makeCharacter([{ name: "Wren", tag: "tough" }, { name: "Ash" }]);
		expect(await ensureCrewMemberPeople(character)).toBe(2);
		expect(created.map(a => a.name)).toEqual(["Wren", "Ash"]);
		expect(created[0].ownership).toEqual({ default: 0, user1: 3 });
		const [[data, options]] = character.update.mock.calls;
		expect(data[`flags.${SYS}.crew.individuals`].map(r => r.personUuid)).toEqual(["Actor.new0", "Actor.new1"]);
		expect(data[`flags.${SYS}.crew.individuals`][0].tag).toBe("tough");
		expect(options).toEqual({ stonetopLedger: true });
	});

	it("costs nothing when everybody is linked, and never remakes a deleted Person", async () => {
		// Actor.gone resolves to nothing: deleting a member's Person is a decision that sticks.
		const character = makeCharacter([{ name: "Wren", personUuid: "Actor.gone" }]);
		expect(await ensureCrewMemberPeople(character)).toBe(0);
		expect(globalThis.Actor.create).not.toHaveBeenCalled();
	});

	it("waits for somebody who may create actors", async () => {
		globalThis.Actor.canUserCreate = vi.fn(() => false);
		expect(await ensureCrewMemberPeople(makeCharacter([{ name: "Wren" }]))).toBe(0);
		expect(globalThis.Actor.create).not.toHaveBeenCalled();
	});

	it("deletes its own copy when the member was linked while it was making one", async () => {
		const character = makeCharacter([{ name: "Wren" }]);
		globalThis.Actor.create = vi.fn(async (data) => {
			// Another client linked Wren in the meantime.
			character.flags[SYS].crew.individuals = [{ name: "Wren", personUuid: "Actor.theirs" }];
			const actor = { ...data, uuid: "Actor.mine", delete: vi.fn(async () => {}) };
			created.push(actor);
			return actor;
		});
		expect(await ensureCrewMemberPeople(character)).toBe(0);
		expect(created[0].delete).toHaveBeenCalled();
		expect(character.update).not.toHaveBeenCalled();
	});
});

describe("syncCrewMemberPeople", () => {
	it("writes the Person with the sync flag (so the hook skips it) and pulls edits onto the row", async () => {
		const person = makePerson("Actor.p1", {
			name: "Wrenna",
			flags: { crewMemberCard: { name: "Wren", img: "", frame: null, occupation: "Pim's crew", traits: "" } },
			system: { occupation: "Pim's crew", traits: "" },
		});
		const character = makeCharacter([{ name: "Wren", personUuid: "Actor.p1" }]);
		expect(await syncCrewMemberPeople(character)).toBe(1);
		expect(person.update.mock.calls[0][1]).toEqual({ stonetopLedger: true, stonetopCrewSync: true });
		expect(character.flags[SYS].crew.individuals[0].name).toBe("Wrenna");
	});

	it("leaves a Person who is no longer on this crew alone", async () => {
		const person = makePerson("Actor.p1", { name: "Other", flags: { crewMember: { characterUuid: "Actor.someoneElse" } } });
		const character = makeCharacter([{ name: "Wren", personUuid: "Actor.p1" }]);
		expect(await syncCrewMemberPeople(character)).toBe(0);
		expect(person.update).not.toHaveBeenCalled();
	});
});

describe("onUpdateActorCrewPerson", () => {
	it("ignores its own writes, other users' edits and anything but a name or a face", () => {
		const person = makePerson("Actor.p1");
		makeCharacter([{ name: "Wren", personUuid: "Actor.p1" }]);
		onUpdateActorCrewPerson(person, { name: "X" }, { stonetopCrewSync: true }, "user1");
		onUpdateActorCrewPerson(person, { name: "X" }, {}, "someoneElse");
		onUpdateActorCrewPerson(person, { system: { notes: "x" } }, {}, "user1");
		expect(globalThis.fromUuidSync).not.toHaveBeenCalled();
	});
});

describe("onUpdateActorCrewRoster", () => {
	const personFor = () => makePerson("Actor.p1", {
		flags: { crewMemberCard: { name: "Wren", img: "", frame: null, occupation: "Pim's crew", traits: "" } },
		system: { occupation: "Pim's crew", traits: "" },
	});

	it("carries a roster rename to the Person on the client that made it", async () => {
		const person = personFor();
		const character = makeCharacter([{ name: "Wrenna", personUuid: "Actor.p1" }]);
		onUpdateActorCrewRoster(character, { flags: { [SYS]: { crew: { individuals: [] } } } }, {}, "user1");
		await vi.waitFor(() => expect(person.update).toHaveBeenCalled());
		expect(person.update.mock.calls[0][0].name).toBe("Wrenna");
		expect(person.update.mock.calls[0][1]).toEqual({ stonetopLedger: true, stonetopCrewSync: true });
	});

	// Its own roster write-back is marked, so it never plans the same sync again over what it just wrote.
	it("marks the sync's own roster write, and skips a roster write so marked", async () => {
		const person = makePerson("Actor.p1", {
			name: "Wrenna",
			flags: { crewMemberCard: { name: "Wren", img: "", frame: null, occupation: "Pim's crew", traits: "" } },
			system: { occupation: "Pim's crew", traits: "" },
		});
		const character = makeCharacter([{ name: "Wren", personUuid: "Actor.p1" }]);
		await syncCrewMemberPeople(character);
		const [, options] = character.update.mock.calls.at(-1);
		expect(options).toEqual({ stonetopCrewSync: true });
		person.update.mockClear();
		character.flags[SYS].crew.individuals = [{ name: "Wrenny", personUuid: "Actor.p1" }];
		onUpdateActorCrewRoster(character, { flags: { [SYS]: { crew: { individuals: [] } } } }, options, "user1");
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(person.update).not.toHaveBeenCalled();
	});

	it("ignores another user's edit, an edit outside the roster, and a character it cannot write", async () => {
		const person = personFor();
		const character = makeCharacter([{ name: "Wrenna", personUuid: "Actor.p1" }]);
		const roster = { flags: { [SYS]: { crew: { individuals: [] } } } };
		onUpdateActorCrewRoster(character, roster, {}, "someoneElse");
		onUpdateActorCrewRoster(character, { flags: { [SYS]: { crew: { individualsHp: { 0: 2 } } } } }, {}, "user1");
		onUpdateActorCrewRoster(person, { name: "X" }, {}, "user1");
		character.isOwner = false;
		onUpdateActorCrewRoster(character, roster, {}, "user1");
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(person.update).not.toHaveBeenCalled();
	});
});

describe("one sweep at a time per character", () => {
	it("runs the crew sweeps one after the other, so neither builds its rows from a stale read", async () => {
		const person = makePerson("Actor.p1", {
			flags: { crewMemberCard: { name: "Wren", img: "", frame: null, occupation: "Pim's crew", traits: "" } },
			system: { occupation: "Pim's crew", traits: "" },
			name: "Wrenna",
		});
		const character = makeCharacter([{ name: "Wren", personUuid: "Actor.p1" }, { name: "Ash" }]);
		// Both started by the same render: the sync's row write must land on the rows the make
		// pass wrote, not the other way round.
		const [made, synced] = await Promise.all([ensureCrewMemberPeople(character), syncCrewMemberPeople(character)]);
		expect(made).toBe(1);
		expect(synced).toBe(1);
		expect(person.update).toHaveBeenCalled();
		expect(character.flags[SYS].crew.individuals.map(r => [r.name, r.personUuid]))
			.toEqual([["Wrenna", "Actor.p1"], ["Ash", "Actor.new0"]]);
	});

	it("shares one pass between two asks of a kind still waiting its turn", async () => {
		const character = makeCharacter([{ name: "Wren" }]);
		const [first, second] = await Promise.all([ensureCrewMemberPeople(character), ensureCrewMemberPeople(character)]);
		expect([first, second]).toEqual([1, 1]);
		expect(created).toHaveLength(1);
	});

	it("a waiting pass runs the newest ask's plan, once", async () => {
		const older = vi.fn(async () => 1);
		const newer = vi.fn(async () => 2);
		const [a, b] = await Promise.all([sweepOnce("pcW", "k", older), sweepOnce("pcW", "k", newer)]);
		expect([a, b]).toEqual([2, 2]);
		expect(older).not.toHaveBeenCalled();
		expect(newer).toHaveBeenCalledTimes(1);
	});

	// The running pass planned before the edit, so dropping the new ask would leave the edit uncarried.
	it("an ask while a pass of its kind is RUNNING runs once more after it", async () => {
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const ran = [];
		const first = sweepOnce("pcR", "k", async () => { ran.push("first"); await gate; return 1; });
		await vi.waitFor(() => expect(ran).toEqual(["first"]));
		expect(sweepQueued("pcR", "k")).toBe(false);
		const second = sweepOnce("pcR", "k", async () => { ran.push("second"); return 1; });
		expect(sweepQueued("pcR", "k")).toBe(true);
		release();
		expect(await Promise.all([first, second])).toEqual([1, 1]);
		expect(ran).toEqual(["first", "second"]);
	});

	it("carries a second roster rename made while the first one's sync is still writing", async () => {
		const stamp = name => ({ crewMemberCard: { name, img: "", frame: null, occupation: "Pim's crew", traits: "" } });
		const a = makePerson("Actor.a", { name: "Ash", flags: stamp("Ash"), system: { occupation: "Pim's crew", traits: "" } });
		const b = makePerson("Actor.b", { name: "Bree", flags: stamp("Bree"), system: { occupation: "Pim's crew", traits: "" } });
		const character = makeCharacter([{ name: "Asha", personUuid: "Actor.a" }, { name: "Bree", personUuid: "Actor.b" }]);
		let release;
		// The first write waits until the second rename is in; any after it land at once.
		a.update = vi.fn()
			.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
			.mockImplementation(async () => {});
		const first = syncCrewMemberPeople(character);
		await vi.waitFor(() => expect(a.update).toHaveBeenCalled());
		character.flags[SYS].crew.individuals = [{ name: "Asha", personUuid: "Actor.a" }, { name: "Breena", personUuid: "Actor.b" }];
		const second = syncCrewMemberPeople(character);
		release();
		await Promise.all([first, second]);
		expect(b.update).toHaveBeenCalled();
		expect(b.update.mock.calls[0][0].name).toBe("Breena");
	});

	// Sweeps started by one render wait this client's turn once between them, not once each.
	it("waits this client's makerRank turn once for sweeps queued together", async () => {
		vi.useFakeTimers();
		try {
			globalThis.game.users = { contents: [{ id: "user0", active: true }, { id: "user1", active: true }] };
			const character = { id: "pcT", testUserPermission: () => true };
			const ran = [];
			const runs = ["a", "b", "c"].map(kind => sweepOnce(character, kind, async () => { ran.push(kind); return 1; }));
			await vi.advanceTimersByTimeAsync(MAKER_STAGGER_MS);
			expect(ran).toEqual(["a", "b", "c"]);
			await Promise.all(runs);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("leaving the crew", () => {
	it("a death marks the Person Dead and takes them off the crew", async () => {
		const person = makePerson("Actor.p1");
		await markCrewPersonDead({ name: "Wren", personUuid: "Actor.p1" });
		const [[data]] = person.update.mock.calls;
		expect(data["system.status"]).toBe("dead");
		expect(Object.keys(data).some(k => k.includes("crewMember"))).toBe(true);
	});

	it("a removal deletes the Person or lets them stand alone, as asked", async () => {
		const kept = makePerson("Actor.k");
		await releaseCrewPerson({ personUuid: "Actor.k" }, { remove: false });
		expect(kept.delete).not.toHaveBeenCalled();
		expect(kept.update).toHaveBeenCalled();

		const gone = makePerson("Actor.g");
		await releaseCrewPerson({ personUuid: "Actor.g" }, { remove: true });
		expect(gone.delete).toHaveBeenCalled();
	});

	// Left marked, a Person nobody may delete would sit outside every "Link a Person" list for good.
	it("a removal asking to delete a Person this user may not delete takes them off the crew instead, and says so", async () => {
		const warn = vi.fn();
		globalThis.ui = { notifications: { warn } };
		const kept = makePerson("Actor.k2", { canUserModify: () => false });
		await releaseCrewPerson({ personUuid: "Actor.k2" }, { remove: true });
		expect(kept.delete).not.toHaveBeenCalled();
		expect(Object.keys(kept.update.mock.calls[0][0]).some(k => k.includes("crewMember"))).toBe(true);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("stay as a Person"));

		const stuck = makePerson("Actor.s", { delete: vi.fn(async () => { throw new Error("no"); }) });
		await releaseCrewPerson({ personUuid: "Actor.s" }, { remove: true });
		expect(stuck.update).toHaveBeenCalled();
	});

	it("linking a hand-made Person deletes the one the crew made, but never one linked by hand", async () => {
		const character = makeCharacter([]);
		const made = makePerson("Actor.made", { flags: { crewMember: { characterUuid: "Actor.pc1", made: true } } });
		await replaceCrewPerson("Actor.made", character);
		expect(made.delete).toHaveBeenCalled();

		const linked = makePerson("Actor.linked");
		await replaceCrewPerson("Actor.linked", character);
		expect(linked.delete).not.toHaveBeenCalled();
	});
});

describe("the follower machinery", () => {
	it("does not take a member's Person for the crew card's own actor", () => {
		const character = makeCharacter([{ name: "Wren", personUuid: "Actor.p1" }]);
		character.flags[SYS].crew.name = "The Grey Company";
		const person = makePerson("Actor.p1");
		expect(followerMasterIndex({ characters: [character], actors: [person] }).size).toBe(0);
	});

	it("gives a member's Person no follower card (their sheet reads the crew through crewMemberOf)", () => {
		const character = makeCharacter([{ name: "Wren", personUuid: "Actor.p1" }]);
		const person = makePerson("Actor.p1");
		expect(followerCardFor(person, { characters: [character], resolve: (u) => docs.get(u) ?? null })).toBeNull();
	});
});

describe("crewMemberOf", () => {
	it("finds the character and the row that point at this Person", () => {
		const row = { name: "Wren", tag: "brave", personUuid: "Actor.p1" };
		const character = makeCharacter([{ name: "Ifan", personUuid: "Actor.p0" }, row]);
		const found = crewMemberOf(makePerson("Actor.p1"));
		expect(found.character).toBe(character);
		expect(found.row).toBe(row);
	});

	it("is null for a Person no row points at, on no crew, or whose character is gone", () => {
		makeCharacter([{ name: "Wren" }]);
		expect(crewMemberOf(makePerson("Actor.p1"))).toBeNull();
		expect(crewMemberOf(makePerson("Actor.p2", { flags: { crewMember: null } }))).toBeNull();
		const stray = makePerson("Actor.p3");
		stray.flags[SYS].crewMember = { characterUuid: "Actor.gone" };
		expect(crewMemberOf(stray)).toBeNull();
	});
});

describe("crewPersonTraitsFollowRoster", () => {
	it("holds while the traits are the roster's, or empty", () => {
		expect(crewPersonTraitsFollowRoster(makePerson("Actor.p1", {
			system: { traits: "brave, sings" }, flags: { crewMemberCard: { traits: "brave, sings" } },
		}))).toBe(true);
		expect(crewPersonTraitsFollowRoster(makePerson("Actor.p2"))).toBe(true);
	});

	it("lets go once the traits were typed on the Person", () => {
		expect(crewPersonTraitsFollowRoster(makePerson("Actor.p1", {
			system: { traits: "hums when nervous" }, flags: { crewMemberCard: { traits: "brave" } },
		}))).toBe(false);
	});
});

describe("redrawing a crew member's open sheet", () => {
	const sheet = (rendered) => ({ rendered, render: vi.fn() });
	// The open windows, as Foundry files them: each person's sheet, pointing back at its actor.
	const openSheets = (...people) => {
		globalThis.ui = { windows: Object.fromEntries(people.map((p, i) => [i, Object.assign(p.sheet, { actor: p })])) };
	};

	it("redraws the open sheets of that character's crew on any change to the character", () => {
		const character = makeCharacter([{ name: "Wren", personUuid: "Actor.p1" }]);
		const mine = makePerson("Actor.p1", { sheet: sheet(true) });
		const closed = makePerson("Actor.p2", { sheet: sheet(false) });
		const other = makePerson("Actor.p3", { sheet: sheet(true) });
		other.flags[SYS].crewMember = { characterUuid: "Actor.pc2" };
		openSheets(mine, closed, other);
		onUpdateActorCrewSheets(character, { flags: { [SYS]: { crew: { individualsHp: { 0: 2 } } } } });
		expect(mine.sheet.render).toHaveBeenCalledWith(false);
		expect(closed.sheet.render).not.toHaveBeenCalled();
		expect(other.sheet.render).not.toHaveBeenCalled();
		// Heroes to the Last's picks live with the move marks, not under `crew`.
		onUpdateActorCrewSheets(character, { flags: { [SYS]: { "moves.moveMarks.Heroes to the Last.inured": [1] } } });
		expect(mine.sheet.render).toHaveBeenCalledTimes(2);
	});

	it("redraws them once when the character learns or drops a batch of moves", () => {
		vi.useFakeTimers();
		try {
			const character = makeCharacter([{ name: "Wren", personUuid: "Actor.p1" }]);
			const mine = makePerson("Actor.p1", { sheet: sheet(true) });
			openSheets(mine);
			// A batch create fires one hook per item; the sheet draws once for the lot.
			for (let i = 0; i < 20; i++) onItemChangeCrewSheets({ parent: character });
			expect(mine.sheet.render).not.toHaveBeenCalled();
			vi.advanceTimersByTime(CREW_SHEET_REDRAW_MS);
			expect(mine.sheet.render).toHaveBeenCalledTimes(1);
			onItemChangeCrewSheets({ parent: null });
			onItemChangeCrewSheets({ parent: mine });
			vi.advanceTimersByTime(CREW_SHEET_REDRAW_MS);
			expect(mine.sheet.render).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("forgets a crew card the character's sheet was still building, so the redraw reads the change", () => {
		const forgetCrewCard = vi.fn();
		const character = makeCharacter([{ name: "Wren", personUuid: "Actor.p1" }], { _sheet: { forgetCrewCard } });
		const mine = makePerson("Actor.p1", { sheet: sheet(true) });
		openSheets(mine);
		onUpdateActorCrewSheets(character, { name: "Pimm" });
		expect(forgetCrewCard).toHaveBeenCalledBefore(mine.sheet.render);
	});

	// The `sheet` getter builds a whole character sheet; one never built has no crew card in flight.
	it("never builds the character's sheet just to forget its crew card", () => {
		const character = makeCharacter([{ name: "Wren", personUuid: "Actor.p1" }]);
		const built = vi.fn();
		Object.defineProperty(character, "sheet", { get: built });
		const mine = makePerson("Actor.p1", { sheet: sheet(true) });
		openSheets(mine);
		onUpdateActorCrewSheets(character, { name: "Pimm" });
		expect(built).not.toHaveBeenCalled();
		expect(mine.sheet.render).toHaveBeenCalled();
	});

	it("leaves them be when the update is not to a character", () => {
		makeCharacter([{ name: "Wren", personUuid: "Actor.p1" }]);
		const mine = makePerson("Actor.p1", { sheet: sheet(true) });
		openSheets(mine);
		onUpdateActorCrewSheets(mine, { name: "Wrenna" });
		expect(mine.sheet.render).not.toHaveBeenCalled();
	});
});
