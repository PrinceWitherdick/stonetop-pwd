import { describe, it, expect } from "vitest";
import {
	OATHS_FLAG, BINDING_ARBITRATION,
	canBindOaths, showOaths, readOaths, addOath, removeOath, noteOath, setOathBroken, brokenCount,
} from "../../../module/actors/character/oaths.js";

const actorWith = (...items) => ({ items });
const move = name => ({ type: "move", name });

describe("who can hold somebody to an oath", () => {
	it("counts Binding Arbitration", () => {
		expect(canBindOaths(actorWith(move(BINDING_ARBITRATION)))).toBe(true);
	});

	// A switched-off Binding Arbitration witnesses no new oath (2026-10-18 Judge re-audit).
	it("does NOT count a switched-off Binding Arbitration", () => {
		expect(canBindOaths(actorWith({ ...move(BINDING_ARBITRATION), flags: { "stonetop-pwd": { learned: false } } }))).toBe(false);
	});

	// Truth or Consequences is its requirement and a different move: it makes somebody answer
	// honestly once, on the spot, and leaves nothing behind to list.
	it("does NOT count Truth or Consequences on its own", () => {
		expect(canBindOaths(actorWith(move("Truth or Consequences")))).toBe(false);
		expect(canBindOaths(actorWith())).toBe(false);
		expect(canBindOaths(null)).toBe(false);
	});

	it("only counts MOVES, not anything else named the same", () => {
		expect(canBindOaths(actorWith({ type: "item", name: BINDING_ARBITRATION }))).toBe(false);
	});
});

describe("whether the oaths half renders at all", () => {
	it("shows for a Judge who owns the move, with nobody sworn yet", () => {
		expect(showOaths({ owns: true, count: 0 })).toBe(true);
	});

	it("keeps showing while oaths stand on a sheet that lost the move", () => {
		expect(showOaths({ owns: false, count: 1 })).toBe(true);
	});

	it("stays off an ordinary sheet", () => {
		expect(showOaths({ owns: false, count: 0 })).toBe(false);
	});
});

describe("the stored list", () => {
	it("normalises a row, with broken defaulting to false", () => {
		expect(readOaths([{ id: "o", name: " Gethin ", note: " to bring the herd back " }])[0]).toEqual({
			id: "o", name: "Gethin", uuid: "", note: "to bring the herd back", broken: false,
		});
	});

	// This drives an advantage claim, so a hand-edited world holding the string "false" must not
	// read as "they broke it"; only an explicit yes does, and it lands as a hard boolean.
	it("coerces broken to a hard boolean, reading only an explicit yes as broken", () => {
		expect(readOaths([{ name: "a", broken: "false" }])[0].broken).toBe(false);
		expect(readOaths([{ name: "a", broken: "no" }])[0].broken).toBe(false);
		expect(readOaths([{ name: "a", broken: 0 }])[0].broken).toBe(false);
		expect(readOaths([{ name: "a", broken: 1 }])[0].broken).toBe(true);
		expect(readOaths([{ name: "a", broken: "true" }])[0].broken).toBe(true);
		expect(readOaths([{ name: "a", broken: true }])[0].broken).toBe(true);
	});

	it("survives garbage and drops nameless rows", () => {
		expect(readOaths(null)).toEqual([]);
		expect(readOaths([null, { name: "" }, { name: "Gethin" }])).toHaveLength(1);
	});

	it("gives an id-less row its own positional handle, distinct from a brand's", () => {
		expect(readOaths([{ name: "One" }])[0].id).toBe("oath-0");
	});

	// The user's ruling: one row per oath. "When you bear witness to someone's promise or oath" is
	// per promise, and one person can swear several and break only one of them.
	it("keeps a second oath from the same person as its own row", () => {
		let n = 0;
		const id = () => `o${n++}`;
		const first = addOath([], { name: "Gethin", uuid: "Actor.g", note: "to bring the herd back" }, id).entries;
		const second = addOath(first, { name: "gethin", uuid: "Actor.g", note: "to wed Aeronwen" }, id);
		expect(second.added).toMatchObject({ id: "o1", note: "to wed Aeronwen" });
		expect(second.entries).toHaveLength(2);
		expect(addOath(second.entries, { name: "Gethin" }, id).entries).toHaveLength(3);
		expect(addOath(second.entries, { name: "  " }, id).added).toBeNull();
	});

	it("releases one row by its own handle", () => {
		const { entries } = addOath([], { name: "Gethin" }, () => "o");
		expect(removeOath(entries, "o").removed).toMatchObject({ name: "Gethin" });
		expect(removeOath(entries, "nope").removed).toBeNull();
	});

	it("re-words what was sworn, and reports no change when it did not move", () => {
		const { entries } = addOath([], { name: "Gethin", note: "the herd" }, () => "o");
		expect(noteOath(entries, "o", "the herd").changed).toBeNull();
		expect(noteOath(entries, "o", "the whole herd").changed).toMatchObject({ note: "the whole herd" });
	});

	it("marks an oath broken and back again, and counts the broken ones", () => {
		const { entries } = addOath([], { name: "Gethin" }, () => "o");
		const broken = setOathBroken(entries, "o", true);
		expect(broken.changed).toMatchObject({ broken: true });
		expect(brokenCount(broken.entries)).toBe(1);
		// Untick is the release the move describes, once they admit the wrong and suffer for it.
		expect(setOathBroken(broken.entries, "o", false).changed).toMatchObject({ broken: false });
		// ...and re-ticking what is already ticked writes nothing.
		expect(setOathBroken(broken.entries, "o", true).changed).toBeNull();
	});
});

describe("the names the gate matches on", () => {
	it("spells the move exactly as the packs do", () => {
		expect(BINDING_ARBITRATION).toBe("Binding Arbitration");
	});

	it("keys the flag on oaths", () => {
		expect(OATHS_FLAG).toBe("oaths");
	});
});
