import { afterEach, describe, it, expect } from "vitest";
import {
	CONDEMNED_FLAG, CONDEMN, CENSURE, PROCLAMATION,
	ownsMoveNamed, canCondemn, showCondemn,
	readEntry, readCondemned, condemnKey,
	addCondemned, removeCondemned, noteCondemned,
	condemnersOf, condemnedContext, findBrandTarget, isBranded,
} from "../../../module/actors/character/condemn.js";

const actorWith = (...items) => ({ items });
const move = name => ({ type: "move", name });

describe("who can lay a brand", () => {
	it("counts Condemn", () => {
		expect(canCondemn(actorWith(move(CONDEMN)))).toBe(true);
	});

	// A switched-off Condemn lays no new brand (2026-10-18 Judge re-audit).
	it("does NOT count a switched-off Condemn", () => {
		expect(canCondemn(actorWith({ ...move(CONDEMN), flags: { "stonetop-pwd": { learned: false } } }))).toBe(false);
	});

	// Censure alone resolves on the spot and marks nobody; Proclamation widens Condemn's reach but
	// requires Censure rather than Condemn, so a Judge can own it with nothing to list.
	it("does NOT count Censure or Proclamation on their own", () => {
		expect(canCondemn(actorWith(move(CENSURE)))).toBe(false);
		expect(canCondemn(actorWith(move(PROCLAMATION), move(CENSURE)))).toBe(false);
	});

	it("says no for a character with none of them", () => {
		expect(canCondemn(actorWith(move("Bulwark")))).toBe(false);
		expect(canCondemn(actorWith())).toBe(false);
		expect(canCondemn(null)).toBe(false);
	});

	// The type check is the point: an inventory item or an arcanum sharing a move's name must not
	// earn the scales.
	it("only counts MOVES, not anything else named the same", () => {
		expect(canCondemn(actorWith({ type: "item", name: CONDEMN }))).toBe(false);
		expect(ownsMoveNamed(actorWith(move(CONDEMN)), CONDEMN)).toBe(true);
	});
});

describe("whether the scales render at all", () => {
	it("shows for a Judge who owns Condemn, branding nobody yet", () => {
		expect(showCondemn({ owns: true, count: 0 })).toBe(true);
	});

	// Drop a new playbook over a Judge and the move goes, but the flag doesn't — hide the scales
	// then and a standing brand can never be lifted.
	it("keeps showing while brands stand on a sheet that lost the move", () => {
		expect(showCondemn({ owns: false, count: 2 })).toBe(true);
	});

	it("stays off an ordinary sheet", () => {
		expect(showCondemn({ owns: false, count: 0 })).toBe(false);
		expect(showCondemn({ owns: false, count: undefined })).toBe(false);
	});
});

describe("reading stored brands", () => {
	it("normalises a row and trims it", () => {
		expect(readEntry({ id: "a", name: "  Brennan ", uuid: " Actor.x ", note: " thief " }))
			.toEqual({ id: "a", name: "Brennan", uuid: "Actor.x", note: "thief" });
	});

	// The store is a flag, which validates nothing — a hand-edited world must not put `undefined`
	// into the template or throw on a trim.
	it("survives garbage", () => {
		expect(readCondemned(null)).toEqual([]);
		expect(readCondemned("nope")).toEqual([]);
		expect(readCondemned([null, undefined, 7])).toEqual([]);
	});

	it("drops rows with no name, since they name nobody to dismiss", () => {
		expect(readCondemned([{ name: "" }, { name: "   " }, { name: "Brennan" }])).toHaveLength(1);
	});

	it("gives an id-less row a positional handle so it stays addressable", () => {
		const [a, b] = readCondemned([{ name: "One" }, { name: "Two" }]);
		expect(a.id).toBe("condemned-0");
		expect(b.id).toBe("condemned-1");
	});

	// The prefix is what keeps a faction named after a uuid from colliding with that actor. The
	// uuid is folded the way the tags fold it, so the key is the document, not the spelling of
	// the path that reached it; a row laid through an unlinked token keys on that token.
	it("keys an actor-backed row on the document it names and a name-only row on its name", () => {
		expect(condemnKey({ name: "Brennan", uuid: "Actor.x" })).toBe("uuid:x");
		expect(condemnKey({ name: "Brennan", uuid: "Scene.s.Token.t.Actor.x" })).toBe("uuid:token:Scene.s.Token.t");
		expect(condemnKey({ name: "The Claws" })).toBe("name:the claws");
		expect(condemnKey({ name: "x" })).not.toBe(condemnKey({ name: "n", uuid: "Actor.x" }));
	});
});

describe("laying a brand", () => {
	const ids = () => { let n = 0; return () => `id${n++}`; };

	it("adds a row and reports it", () => {
		const { entries, added } = addCondemned([], { name: "Brennan", uuid: "Actor.x" }, ids());
		expect(entries).toHaveLength(1);
		expect(added).toMatchObject({ name: "Brennan", uuid: "Actor.x", id: "id0" });
	});

	it("refuses a second brand on the same person, and changes nothing", () => {
		const first = addCondemned([], { name: "Brennan", uuid: "Actor.x" }, ids()).entries;
		const { entries, added } = addCondemned(first, { name: "Brennan", uuid: "Actor.x" }, ids());
		expect(added).toBeNull();
		expect(entries).toHaveLength(1);
	});

	// Reachable when an Actor is created after the name was branded: typing the name again resolves
	// to the Actor. That is the same person, so the name-only brand takes the link rather than a
	// second brand appearing beside it.
	it("links a name-only brand in place when the same name comes back with an actor", () => {
		const one = addCondemned([], { name: "The Claws", note: "raided the mill" }, ids()).entries;
		const result = addCondemned(one, { name: "the claws", uuid: "Actor.y" }, ids());
		expect(result.added).toBeNull();
		expect(result.changed).toMatchObject({ id: "id0", uuid: "Actor.y", note: "raided the mill" });
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].uuid).toBe("Actor.y");
	});

	// The other way round: the actor is gone (or the drop came from a compendium), so the name comes
	// back with no link, spelling somebody already branded.
	it("refuses a name-only brand spelling somebody already branded by link", () => {
		const one = addCondemned([], { name: "Brennan", uuid: "Actor.x" }, ids()).entries;
		expect(addCondemned(one, { name: "BRENNAN" }, ids()).added).toBeNull();
	});

	it("still brands two different actors who share a name", () => {
		const one = addCondemned([], { name: "Guard", uuid: "Actor.g1" }, ids()).entries;
		expect(addCondemned(one, { name: "Guard", uuid: "Actor.g2" }, ids()).added).not.toBeNull();
	});

	it("refuses a nameless brand", () => {
		expect(addCondemned([], { name: "   " }, ids()).added).toBeNull();
	});

	// Normalising at readEntry's default index would hand every id-less row `condemned-0`, and two
	// rows sharing an id means dismissing either dismisses whichever the find hits first.
	it("gives distinct handles to two rows even with no id source", () => {
		const one = addCondemned([], { name: "One" }).entries;
		const two = addCondemned(one, { name: "Two" }).entries;
		expect(two[0].id).not.toBe(two[1].id);
	});

	// readCondemned numbers id-less rows by their RAW stored index and then drops the nameless
	// ones, so the surviving row's positional id can sit ABOVE the filtered length — and normalising
	// the new row at that length walked straight into it. Two rows sharing an id means one Dismiss
	// click lifts both brands.
	it("skips a positional id the stored list has already used", () => {
		// One nameless row (dropped, but it still shifted the numbering) then a real one at raw
		// index 1 — so the list reads as a single entry called `condemned-1` at length 1.
		const stored = [{ name: "" }, { name: "Gethin" }];
		expect(readCondemned(stored).map(e => e.id)).toEqual(["condemned-1"]);

		const { entries } = addCondemned(stored, { name: "Aeronwen" });
		expect(new Set(entries.map(e => e.id)).size).toBe(2);
	});
});

describe("lifting a brand", () => {
	const list = [{ id: "a", name: "Brennan" }, { id: "b", name: "The Claws" }];

	it("removes the named row", () => {
		const { entries, removed } = removeCondemned(list, "a");
		expect(removed.name).toBe("Brennan");
		expect(entries.map(e => e.id)).toEqual(["b"]);
	});

	it("reports no-op for an id that matches nothing, so no write happens", () => {
		const { entries, removed } = removeCondemned(list, "nope");
		expect(removed).toBeNull();
		expect(entries).toHaveLength(2);
	});

	// addCondemned keeps fresh ids apart, but a hand-edited flag can still hold two rows spelling
	// the same one — and a filter on the id would take both people off the roster for one click.
	it("lifts ONE brand even when a stored list repeats an id", () => {
		const dupes = [{ id: "a", name: "Brennan" }, { id: "a", name: "Gethin" }];
		const { entries, removed } = removeCondemned(dupes, "a");
		expect(removed.name).toBe("Brennan");
		expect(entries.map(e => e.name)).toEqual(["Gethin"]);
	});
});

describe("re-wording why", () => {
	const list = [{ id: "a", name: "Brennan", note: "thief" }];

	it("patches one row", () => {
		const { entries, changed } = noteCondemned(list, "a", "  burned the mill  ");
		expect(changed.note).toBe("burned the mill");
		expect(entries[0].note).toBe("burned the mill");
	});

	// Notes save on blur; blurring an untouched field must not write a document update that
	// re-renders every sheet showing this actor.
	it("reports no-op when the text did not actually move", () => {
		expect(noteCondemned(list, "a", "thief").changed).toBeNull();
		expect(noteCondemned(list, "nope", "x").changed).toBeNull();
	});

	// Same reason removeCondemned cuts by position: one field's blur must not rewrite somebody
	// else's reason because a stored list repeated an id.
	it("rewords ONE row even when a stored list repeats an id", () => {
		const dupes = [{ id: "a", name: "Brennan", note: "thief" }, { id: "a", name: "Gethin", note: "arson" }];
		const { entries } = noteCondemned(dupes, "a", "burned the mill");
		expect(entries.map(e => e.note)).toEqual(["burned the mill", "arson"]);
	});
});

// A brand carrying a uuid tags that person's sheet; one carrying only a name tags nobody. The
// search is what keeps a typed name landing on the actor who already exists.
describe("finding the actor a typed name means", () => {
	const npc = (name, id = name) => ({ name, id, uuid: `Actor.${id}` });
	const world = [npc("Brennan the Claw", "brennan"), npc("Aeronwen", "aeronwen"), npc("Sioned", "sioned")];

	it("matches an exact name whatever the casing or spacing", () => {
		expect(findBrandTarget("  aeronwen ", world).match.id).toBe("aeronwen");
		expect(findBrandTarget("Brennan   the  Claw", world).match.id).toBe("brennan");
	});

	it("resolves a unique prefix — the whole point of searching", () => {
		expect(findBrandTarget("brennan", world).match.id).toBe("brennan");
	});

	it("resolves a unique substring", () => {
		expect(findBrandTarget("claw", world).match.id).toBe("brennan");
	});

	// Branding the wrong Aeronwen is worse than asking which, so a partial that fits several
	// people resolves to nobody and hands back the names to say back to the player.
	it("refuses to guess between several partial matches", () => {
		const many = [npc("Aeronwen", "a1"), npc("Aeronwen Ferch Bryn", "a2")];
		const { match, candidates } = findBrandTarget("aeron", many);
		expect(match).toBeNull();
		expect(candidates.map(a => a.id)).toEqual(["a1", "a2"]);
	});

	// But an EXACT name that several actors share (a world with four "Guard" NPCs) must still
	// brand somebody — the typed text carries nothing that could tell them apart, and refusing
	// would leave a name that can never be branded by typing at all.
	it("takes the first of several actors sharing the exact name, and flags it", () => {
		const guards = [npc("Guard", "g1"), npc("Guard", "g2")];
		const { match, ambiguous } = findBrandTarget("Guard", guards);
		expect(match.id).toBe("g1");
		expect(ambiguous).toBe(true);
	});

	it("prefers an exact match over a longer name that contains it", () => {
		const both = [npc("Bran the Elder", "elder"), npc("Bran", "bran")];
		expect(findBrandTarget("Bran", both).match.id).toBe("bran");
	});

	it("finds nobody for a name the world does not have, so the brand falls back to text", () => {
		expect(findBrandTarget("Nobody At All", world)).toEqual({ match: null, candidates: [], ambiguous: false });
	});

	it("survives an empty query and an empty world", () => {
		expect(findBrandTarget("", world).match).toBeNull();
		expect(findBrandTarget("   ", world).match).toBeNull();
		expect(findBrandTarget("Brennan", []).match).toBeNull();
		expect(findBrandTarget("Brennan", null).match).toBeNull();
		expect(findBrandTarget("Brennan", [null, { name: "" }]).match).toBeNull();
	});
});

// What keeps already-branded people out of the add field's suggestions.
describe("is this person already on the roster", () => {
	const brennan = { name: "Brennan the Claw", id: "brennan", uuid: "Actor.brennan" };

	it("recognises a brand that links to them", () => {
		expect(isBranded([{ id: "1", name: "Brennan the Claw", uuid: "Actor.brennan" }], brennan)).toBe(true);
	});

	// The roster the Judge is reading shows that name either way, so the list has to keep its
	// promise by name too — otherwise a second, near-identical row appears under a different key.
	it("recognises a name-only brand spelling them, whatever the casing", () => {
		expect(isBranded([{ id: "1", name: "  brennan THE claw " }], brennan)).toBe(true);
	});

	// The user's ruling: a brand laid through one unlinked token is on that token, not on the base
	// actor or its other tokens. One laid from the sidebar is on the actor and every token of it.
	it("matches a brand recorded against a token on that token only", () => {
		const brands = [{ id: "1", name: "B", uuid: "Scene.s.Token.t.Actor.brennan" }];
		expect(isBranded(brands, brennan)).toBe(false);
		expect(isBranded(brands, { name: "Brennan the Claw", id: "brennan", uuid: "Scene.s.Token.t.Actor.brennan" })).toBe(true);
		expect(isBranded(brands, { name: "Brennan the Claw", id: "brennan", uuid: "Scene.s.Token.u.Actor.brennan" })).toBe(false);
		expect(isBranded([{ id: "1", name: "B", uuid: "Actor.brennan" }],
			{ name: "x", id: "brennan", uuid: "Scene.s.Token.u.Actor.brennan" })).toBe(true);
	});

	it("leaves everyone else alone", () => {
		expect(isBranded([{ id: "1", name: "Sioned", uuid: "Actor.sioned" }], brennan)).toBe(false);
		expect(isBranded([], brennan)).toBe(false);
		expect(isBranded(null, brennan)).toBe(false);
		expect(isBranded([{ id: "1", name: "Brennan" }], null)).toBe(false);
	});

	// The looseness here is deliberate and must NOT leak into condemnersOf: a name-only brand
	// hides a name from the dropdown, but it must never put the tag on a document that merely
	// shares the spelling.
	it("is looser than the tag lookup, which still ignores name-only brands", () => {
		const brands = [{ id: "1", name: "Brennan the Claw" }];
		expect(isBranded(brands, brennan)).toBe(true);
		const judge = { name: "Aldric", type: "character" };
		expect(condemnersOf(brennan, [judge], () => brands)).toEqual([]);
	});
});

describe("who is holding a brand on this person", () => {
	const judge = (name, brands) => ({ name, type: "character", brands });
	const read = j => j.brands;
	const brennan = { uuid: "Actor.brennan", id: "brennan" };

	it("finds the Judge who branded them", () => {
		const aldric = judge("Aldric", [{ name: "Brennan", uuid: "Actor.brennan" }]);
		expect(condemnersOf(brennan, [aldric], read).map(j => j.name)).toEqual(["Aldric"]);
	});

	it("finds nobody when the brand names somebody else", () => {
		const aldric = judge("Aldric", [{ name: "Vera", uuid: "Actor.vera" }]);
		expect(condemnersOf(brennan, [aldric], read)).toEqual([]);
	});

	// A name-only brand ("the Claws") has no document to tag, so it must not match every actor
	// whose uuid happens to be missing.
	it("ignores name-only brands", () => {
		const aldric = judge("Aldric", [{ name: "The Claws" }]);
		expect(condemnersOf(brennan, [aldric], read)).toEqual([]);
		expect(condemnersOf({ uuid: "", id: "" }, [aldric], read)).toEqual([]);
	});

	// A brand laid from the sidebar names the actor, so every token of it wears the tag. One laid
	// through an unlinked token names that token alone (the user's ruling).
	it("tags every token of an actor branded from the sidebar, and only the token branded through one", () => {
		const fromSidebar = judge("Aldric", [{ name: "Brennan", uuid: "Actor.brennan" }]);
		const tokenSheet = { uuid: "Scene.s1.Token.t1.Actor.brennan", id: "brennan" };
		expect(condemnersOf(tokenSheet, [fromSidebar], read).map(j => j.name)).toEqual(["Aldric"]);

		const fromToken = judge("Aldric", [{ name: "Brennan", uuid: "Scene.s1.Token.t1.Actor.brennan" }]);
		expect(condemnersOf(tokenSheet, [fromToken], read).map(j => j.name)).toEqual(["Aldric"]);
		expect(condemnersOf(brennan, [fromToken], read)).toEqual([]);
		expect(condemnersOf({ uuid: "Scene.s1.Token.t2.Actor.brennan", id: "brennan" }, [fromToken], read)).toEqual([]);
	});

	it("never brands the Judge into their own header", () => {
		const self = { ...judge("Aldric", [{ name: "Aldric", uuid: "Actor.aldric" }]), uuid: "Actor.aldric", id: "aldric" };
		expect(condemnersOf(self, [self], read)).toEqual([]);
	});

	it("names both when two Judges have branded the same person", () => {
		const a = judge("Aldric", [{ name: "Brennan", uuid: "Actor.brennan" }]);
		const b = judge("Sioned", [{ name: "Brennan", uuid: "Actor.brennan" }]);
		expect(condemnedContext(brennan, { judges: [a, b], readFlag: read })).toEqual({
			condemned: true, by: ["Aldric", "Sioned"], byLabel: "Aldric, Sioned",
		});
	});

	it("answers a clean negative for an unbranded person", () => {
		expect(condemnedContext(brennan, { judges: [], readFlag: read }))
			.toEqual({ condemned: false, by: [], byLabel: "" });
	});

	// A pack actor is a different document from its world counterpart; matching the two would tag
	// every unmodified copy of a bestiary entry the moment one instance was condemned.
	it("never brands a compendium actor", () => {
		const packed = { uuid: "Compendium.x.Actor.brennan", id: "brennan", pack: "x" };
		const aldric = judge("Aldric", [{ name: "Brennan", uuid: "Actor.brennan" }]);
		expect(condemnedContext(packed, { judges: [aldric], readFlag: read }).condemned).toBe(false);
	});

	/**
	 * This runs in the getData of every character, NPC and monster sheet — on every HP tick, every
	 * note blur, and on every open sheet at once when a brand changes. A world with no Judge in it
	 * must therefore not pay a readCondemned (which rebuilds and trims every stored row) per
	 * character per render, so the world pool is pre-filtered to judges who have actually branded
	 * somebody and the whole thing bails when that leaves nothing.
	 */
	describe("the world pool it builds when none is injected", () => {
		const worldActor = (name, brands) => ({
			name, type: "character", uuid: `Actor.${name}`, id: name,
			flags: brands ? { "stonetop-pwd": { [CONDEMNED_FLAG]: brands } } : {},
			getFlag: (scope, key) => (scope === "stonetop-pwd" && key === CONDEMNED_FLAG ? brands : undefined),
		});
		afterEach(() => { delete globalThis.game; });

		it("reads no flags at all in a world where nobody has branded anyone", () => {
			const reads = [];
			const bare = worldActor("Pim", null);
			bare.getFlag = (...args) => { reads.push(args); return undefined; };
			globalThis.game = { actors: [bare, { name: "Rat", type: "npc" }] };

			expect(condemnedContext(brennan)).toEqual({ condemned: false, by: [], byLabel: "" });
			expect(reads, "the empty world must cost a property read, not a flag read").toEqual([]);
		});

		it("still finds the Judge who has one", () => {
			globalThis.game = {
				actors: [worldActor("Pim", null), worldActor("Aldric", [{ name: "Brennan", uuid: "Actor.brennan" }])],
			};

			expect(condemnedContext(brennan).by).toEqual(["Aldric"]);
		});
	});
});

// The gate is name-matched against the pack files, so a rename in either place silently stops
// showing the scales. This is the guard for that.
describe("the names and keys the feature matches on", () => {
	it("spells the moves exactly as the packs do", () => {
		expect(CONDEMN).toBe("Condemn");
		expect(CENSURE).toBe("Censure");
		expect(PROCLAMATION).toBe("Proclamation");
	});

	it("keys the flag on condemned", () => {
		expect(CONDEMNED_FLAG).toBe("condemned");
	});
});
