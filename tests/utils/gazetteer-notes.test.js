import { describe, it, expect } from "vitest";
import {
	alreadyOpened, gazetteerRefTail, openGazetteerEntriesToPlayers, ownershipRaises,
	worldGazetteerEntry, worldGazetteerIndex,
} from "../../module/utils/gazetteer-notes.js";
import { TRAVEL_PLACES } from "../../module/data/travel-times.js";

// Bridging travel-times' COMPENDIUM journal ids to the WORLD copies a map Note can actually
// link, and opening those copies far enough that linking one does not delete the pin from every
// player's map.

globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };

/** A world JournalEntry stand-in carrying the stamp `fromCompendium` leaves behind. */
function worldEntry(id, source, ownership = { default: 0 }, flags = {}) {
	return { id, name: `entry-${id}`, ownership, flags, _stats: { compendiumSource: source } };
}

/** The same, after a previous run of this pass has opened it up once. */
const openedBefore = (id, ownership) =>
	worldEntry(id, "x", ownership, { "stonetop-pwd": { gazetteerPinOpened: true } });

/** What one raise looks like: the ownership, and the stamp that makes it a one-time favour. */
const raise = (id) => ({ _id: id, "ownership.default": 1, "flags.stonetop-pwd.gazetteerPinOpened": true });

const packRef = (systemId, journalId) => `Compendium.${systemId}.stonetop-journal.JournalEntry.${journalId}`;

describe("finding the world copy of a gazetteer entry", () => {
	it("matches the stamp the journal seed leaves behind", () => {
		const entry = worldEntry("world1", packRef("stonetop-pwd", "6yScslDfqrcCQ6CJ"));
		const index = worldGazetteerIndex([entry]);
		expect(worldGazetteerEntry("6yScslDfqrcCQ6CJ", index)).toBe(entry);
	});

	it("still matches a world seeded before the package was renamed", () => {
		// The stamp carries whatever id the system was installed under at seed time, and it is
		// the same entry. Keying on the tail is the rule the seeder itself uses.
		const entry = worldEntry("world1", packRef("stonetop_pwd", "6yScslDfqrcCQ6CJ"));
		const index = worldGazetteerIndex([entry]);
		expect(worldGazetteerEntry("6yScslDfqrcCQ6CJ", index)).toBe(entry);
	});

	it("reads the legacy sourceId flag as well as the modern stamp", () => {
		const legacy = { id: "w2", ownership: { default: 0 }, flags: { core: { sourceId: packRef("stonetop-pwd", "vwP9YSr3qrc4Tq7k") } } };
		expect(worldGazetteerEntry("vwP9YSr3qrc4Tq7k", worldGazetteerIndex([legacy]))).toBe(legacy);
	});

	it("answers null rather than guessing", () => {
		const index = worldGazetteerIndex([worldEntry("w1", packRef("stonetop-pwd", "aaaaaaaaaaaaaaaa"))]);
		expect(worldGazetteerEntry("6yScslDfqrcCQ6CJ", index)).toBe(null);
		expect(worldGazetteerEntry(null, index)).toBe(null);
		// A world that never imported the journals: every pin stays a plain label.
		expect(worldGazetteerEntry("6yScslDfqrcCQ6CJ", worldGazetteerIndex([]))).toBe(null);
	});

	it("ignores a journal the GM wrote themselves", () => {
		expect(worldGazetteerIndex([{ id: "hand", name: "My notes", ownership: {} }]).size).toBe(0);
	});

	it("keeps the original when a GM has duplicated an entry", () => {
		const first = worldEntry("w1", packRef("stonetop-pwd", "6yScslDfqrcCQ6CJ"));
		const copy = worldEntry("w2", packRef("stonetop-pwd", "6yScslDfqrcCQ6CJ"));
		expect(worldGazetteerEntry("6yScslDfqrcCQ6CJ", worldGazetteerIndex([first, copy]))).toBe(first);
	});

	it("builds its key off ids the travel graph actually carries", () => {
		const withJournals = TRAVEL_PLACES.filter(p => p.journalId);
		expect(withJournals.length).toBeGreaterThan(10);
		for (const place of withJournals) {
			expect(gazetteerRefTail(place.journalId)).toBe(`stonetop-journal.JournalEntry.${place.journalId}`);
		}
	});
});

describe("opening an entry far enough that its pin survives", () => {
	it("raises a GM-only entry to LIMITED and no further", () => {
		// LIMITED is the least that keeps the pin on a player's map. OBSERVER would hand them the
		// GM's write-up of a place the party may not have reached.
		expect(ownershipRaises([worldEntry("w1", "x")])).toEqual([raise("w1")]);
	});

	it("never lowers an entry the GM opened wider, it only records it", () => {
		// OBSERVER is a GM handing the table a place's write-up. The ownership is untouched; the
		// row is the stamp alone, so the entry counts as dealt with and is never argued with.
		const observed = worldEntry("w1", "x", { default: 2 });
		expect(ownershipRaises([observed])).toEqual([{ _id: "w1", "flags.stonetop-pwd.gazetteerPinOpened": true }]);
	});

	it("catches up a world that ran an older pass, once, then goes quiet", async () => {
		// The gap the stamp would otherwise leave. A world marked before the stamp existed has
		// entries sitting at LIMITED with no record of who put them there, so closing one would
		// be undone on the next load. One stamp-only write settles them, and the load after that
		// writes nothing at all.
		const already = worldEntry("w1", "x", { default: 1 });
		const batches = [];
		await openGazetteerEntriesToPlayers([already], { update: d => batches.push(d) });
		expect(batches).toEqual([[{ _id: "w1", "flags.stonetop-pwd.gazetteerPinOpened": true }]]);

		let calls = 0;
		await openGazetteerEntriesToPlayers([openedBefore("w1", { default: 1 })], { update: () => { calls++; } });
		expect(calls).toBe(0);
	});

	it("writes every entry in one batch", async () => {
		const entries = ["a", "b", "c"].map(id => worldEntry(id, "x"));
		const batches = [];
		const safe = await openGazetteerEntriesToPlayers(entries, { update: d => { batches.push(d); } });
		expect(batches).toHaveLength(1);
		expect(batches[0]).toEqual([raise("a"), raise("b"), raise("c")]);
		expect([...safe]).toEqual(entries);
	});

	it("never re-opens an entry the GM has since closed", async () => {
		// The trap this stamp exists for. A GM hits the share button and sets a place back to
		// NONE; without the stamp the very next load reads that as "still at the seeded default"
		// and raises it again, putting the name back in every player's sidebar. Worse, the share
		// dialog tests for OBSERVER, so it goes on reporting the entry as hidden.
		const shut = openedBefore("w1", { default: 0 });
		expect(alreadyOpened(shut)).toBe(true);
		expect(ownershipRaises([shut])).toEqual([]);

		let calls = 0;
		const safe = await openGazetteerEntriesToPlayers([shut], { update: () => { calls++; } });
		expect(calls).toBe(0);
		// And its pin must not link to it either: a note pointed at something a player cannot see
		// vanishes from their map entirely, which is worse than a name they cannot click.
		expect(safe.has(shut)).toBe(false);
	});

	it("still vouches for an entry it opened before and the GM has left open", async () => {
		const open = openedBefore("w1", { default: 1 });
		let calls = 0;
		const safe = await openGazetteerEntriesToPlayers([open], { update: () => { calls++; } });
		expect(calls).toBe(0);
		expect(safe.has(open)).toBe(true);
	});

	it("reads the stamp under an older package id too", () => {
		// A world opened up before the rename carries the stamp spelled the old way, and it is
		// the same promise. Missing it would re-open every place that world's GM had closed.
		const legacy = worldEntry("w1", "x", { default: 0 }, { stonetop_pwd: { gazetteerPinOpened: true } });
		expect(alreadyOpened(legacy)).toBe(true);
		expect(ownershipRaises([legacy])).toEqual([]);
	});

	it("refuses to vouch for an entry whose write failed", async () => {
		// THE POINT OF THE RETURN VALUE. Core hides a linked note from a reader without LIMITED
		// on its target, so a pin linked to an entry that stayed GM-only is a pin gone from every
		// player's map, label and all. An unlinked pin is merely not clickable.
		const stuck = worldEntry("stuck", "x");
		const open = worldEntry("open", "x", { default: 2 });
		const safe = await openGazetteerEntriesToPlayers([stuck, open], {
			update: () => { throw new Error("no permission"); },
		});
		expect(safe.has(stuck)).toBe(false);
		expect(safe.has(open)).toBe(true);
	});
});
