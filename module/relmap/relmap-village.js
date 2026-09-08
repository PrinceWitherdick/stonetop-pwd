// The village's own board: everybody on the steading's Residents roster, seated without anybody
// having to add them one at a time.
//
// WHAT IT IS, and how it differs from the party board beside it. That one is a page this system
// MAKES; this one is a page the map already HAS -- the board every map is created with, named after
// the map itself. Asked for as "for this Stonetop page, can we make all the residents of Stonetop
// appear automatically on that map", and the answer had to land on the board the table was already
// looking at rather than on a third tab beside it. So the first board is ADOPTED: marked as the
// village board once, and topped up from the roster from then on.
//
// WHO COUNTS AS A RESIDENT is not decided here. It is the steading sheet's own Residents list, read
// by the caller (actors/steading/steading-people.js), because that table IS the village's list of
// itself and a second opinion about who lives in Stonetop is the one thing this must not invent.
//
// ⚠ FOUR RULES. The first three are the party board's, word for word, and for the same reasons
// (relmap/relmap-party.js states them at length).
//  • It only ever ADDS. Nobody is moved, nobody is taken off, and a face stays where it was dragged.
//  • It seats a ring only onto an EMPTY board. On a board somebody has arranged, a newcomer is
//    dropped into whatever space is left, because re-seating the ring would move everyone else.
//  • It stops for good once the board is gone: the mark that says "this map has had its village"
//    lives on the ENTRY, so deleting the board is an answer that sticks.
//  • AND IT REMEMBERS WHO IT HAS ALREADY GIVEN, which the party board has no need of. A party is
//    four people and losing one is an accident; a village is thirty, and a GM who takes the miller
//    off this board means it. Without the ledger the next open would put him straight back, every
//    time, and the only way to be rid of him would be to delete the board. So every resident this
//    board has been handed is written down beside the graph, and the automatic pass offers only the
//    ones it has never handed over. Pressing the button asks for all of them again, which is what
//    makes a removal recoverable.

import { nodeIdentity, seatArrivals } from "./relmap-store.js";

/**
 * The flag, on the PAGE, that says which board is the village board and who it has been given.
 *
 * BY A FLAG AND NOT BY ITS NAME, for the reason the party board's is: the page is renameable like
 * any other, and a table that calls it "Home" must not thereby get a second one.
 *
 * `{ seated: [identity, …] }` — the ledger above. It rides in the marker rather than in a flag of
 * its own so that "which board is this" and "what has it been given" cannot come apart.
 */
export const RELMAP_VILLAGE_FLAG = "relationshipVillageBoard";

/**
 * The flag, on the ENTRY, that says this map has already been given its village.
 *
 * ⚠ ON THE ENTRY AND NOT ON THE PAGE, exactly as the party board's mark is: a mark on the page
 * vanishes with the page, so "never seated" and "seated and then rubbed out" would read the same
 * and the next open would put the whole village back.
 */
export const RELMAP_VILLAGE_MARK = "villageBoard";

/**
 * What seating the village on a board would ADD to it.
 *
 * PURE, and separate from the writing, so what the caller reports is what was actually put there
 * rather than a second guess at it. Hands back the new nodes as a plain map, which the caller turns
 * into leaf patches, plus the ledger to store beside them.
 *
 * @param {object} graph  the board as it stands, normalized.
 * @param {Array<{uuid, name, img}>} people  the roster, in the order they should be seated.
 * @param {object} [options]
 * @param {string[]} [options.seated]  identities this board has been given before.
 * @param {Function} [newId]  id minter, injected so the result is testable.
 * @returns {{nodes: object, addedPeople: number, seated: string[]}}
 */
export function villageBoardPlan(graph, people = [], { seated = [] } = {},
	newId = () => foundry.utils.randomID()) {
	const nodes = {};
	const onBoard = new Set(Object.values(graph?.nodes ?? {}).map(nodeIdentity));
	const given = new Set(Array.isArray(seated) ? seated : []);
	const villagers = (people ?? []).filter(person => person?.uuid);

	// Who this pass is actually about: everybody on the roster who is not already on the board and
	// has never been given to it. The ledger is what makes taking somebody off the board STICK --
	// there is no "offer the whole roster again" any more, so a resident deliberately removed stays
	// removed, and the way back is to drag them on or add them by hand.
	const wanted = villagers.filter(person => {
		const identity = nodeIdentity(person);
		if (onBoard.has(identity)) return false;
		return !given.has(identity);
	});

	const seating = seatArrivals(graph, wanted, newId);
	Object.assign(nodes, seating.nodes);
	const seatedNow = new Set(seating.seated);
	const addedPeople = seating.seated.length;

	// The ledger this pass leaves behind: everybody it has been given before, plus every resident
	// the board now holds — the ones just seated AND the ones somebody had already put there by
	// hand. That last part is what stops the board arguing with the table about a resident who was
	// added by hand and then taken off again.
	const ledger = new Set([...given, ...seatedNow]);
	for (const person of villagers) {
		const identity = nodeIdentity(person);
		if (onBoard.has(identity)) ledger.add(identity);
	}

	return { nodes, addedPeople, seated: [...ledger] };
}
