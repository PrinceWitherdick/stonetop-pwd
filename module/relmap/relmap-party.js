// "The Party": a board of its own, seeded with the player characters and with what they answered
// about each other during the introductions.
//
// WHAT IT IS AND WHY IT IS A PAGE. Asked for as "I don't want to have to manually add the party
// members, I want them to automatically be on their own sheet named The Party", with a Vampire v5
// relationship-map sheet as the picture: everybody round a ring, and an arrow each way between two
// people so that how they see each other can be read at a glance.
//
// It could have been a computed VIEW, and briefly was. The user chose a real page, and the choice
// buys something a view cannot: the table can arrange it. A face stays where somebody drags it, a
// caption can be rewritten in the words the table actually uses, and a line nobody wants can be
// rubbed out. The cost is that it is stored, so it can drift from the Chronicle, and everything
// below is about making that drift the reader's own rather than an accident.
//
// ⚠ THREE RULES, AND ALL THREE ARE ABOUT NOT UNDOING SOMEBODY'S WORK.
//  • It only ever ADDS. It never removes a person, never removes a line, and never moves anybody who
//    is already placed. A board that re-seated itself on open would throw away the arrangement the
//    table built, which is the whole reason it is a page rather than a view.
//  • It matches by IDENTITY, never by the words. Each seeded line carries the KEY of the answer it
//    was drawn from (`origin`, see relmap-store.js), so a caption somebody has rewritten is still
//    that answer's line and does not get a duplicate drawn beside it.
//  • It stops the moment the page is gone. Deleting the board is an answer, and a board that came
//    back on the next open would be a board nobody could be rid of. The mark that says "this map
//    has had its party board" lives on the ENTRY, so it survives the page it describes.
//
// ⚠ WHY NOT COUNTING, WHICH IS WHAT THIS DID. "How many of A's answers about B are drawn" decides
// how many are missing only while the list can grow at the END, and it cannot: `introRegards` hands
// a pair's answers back grouped BY STEP, so an old "Bonds & ties" answer that somebody has just
// pointed at a person with "Match answers to people" is inserted in the MIDDLE of that list. The
// tail the board then added was a second copy of a step-6 line it already had, and the answer the
// reader had just matched was never drawn at all -- on the very press whose whole purpose is to
// draw it. Keys cannot go wrong that way, because nothing about them depends on the order.

import { isIntroEdge, isSafeId, nodeIdentity, seatArrivals } from "./relmap-store.js";
import { RELMAP_SRC_INTROS } from "./relmap-store.js";

/**
 * The flag, on the ENTRY, that says this map has already been given its party board.
 *
 * ⚠ ON THE ENTRY AND NOT ON THE PAGE, which is the whole of what makes the board deletable. A mark
 * on the page vanishes with the page, so "never made" and "made and then rubbed out" would read the
 * same and the next open would put it straight back. Nested inside the map's own flag rather than
 * beside it, so one flag still says everything this system knows about the entry.
 */
export const RELMAP_PARTY_MARK = "partyBoard";

/**
 * The flag, on the PAGE, that says which board is the party board.
 *
 * BY A FLAG AND NOT BY ITS NAME. The page is renameable like any other, and a table that calls it
 * "The Six" or "Us" must not thereby get a second one on the next open.
 */
export const RELMAP_PARTY_FLAG = "relationshipPartyBoard";

/**
 * What seeding or topping up the party board would ADD to a graph.
 *
 * PURE, and separate from the writing, so what the caller reports is what was actually built rather
 * than a second guess at it. Hands back the new nodes and edges as plain maps, which the caller
 * either folds into a brand new page's graph or turns into leaf patches for an existing one -- the
 * same answer either way, so the board a map is created with and the board it grows into cannot
 * come apart.
 *
 * `marks` IS THE THIRD PART, and it is bookkeeping rather than news: the keys to write onto lines a
 * board already carries, so that a board drawn before keys existed is only ever guessed about once.
 * See `adoptBareLines`. It is not counted in `addedLines`, and a pass that produces nothing else has
 * nothing to announce.
 *
 * @param {object} graph  the board as it stands, normalized. `emptyGraph()` when creating.
 * @param {Array<{id, uuid, name, img}>} pcs  the party, in the order they should be seated.
 * @param {Map<string, Map<string, Array<{key, label, said, ink}>>>} regards  from `introRegards`:
 *   from-uuid -> to-uuid -> one entry per answer that names them.
 * @param {Function} newId  id minter, injected so the result is testable.
 * @returns {{nodes, edges, marks, addedPeople: number, addedLines: number}}
 */
export function partyBoardPlan(graph, pcs = [], regards = new Map(), newId = () => foundry.utils.randomID()) {
	const nodes = {};
	const edges = {};
	const marks = {};

	const byIdentity = new Map();
	for (const [id, node] of Object.entries(graph?.nodes ?? {})) byIdentity.set(nodeIdentity(node), id);

	const party = (pcs ?? []).filter(pc => pc?.uuid);
	// Only the ones who are not already here: `seatArrivals` seats everybody it is handed, and who
	// is wanted is this board's own question -- somebody already on it must not be seated twice.
	const arriving = party.filter(pc => !byIdentity.has(nodeIdentity(pc)));
	const seating = seatArrivals(graph, arriving, newId);
	Object.assign(nodes, seating.nodes);
	for (const [id, node] of Object.entries(seating.nodes)) byIdentity.set(nodeIdentity(node), id);
	const addedPeople = seating.seated.length;

	// The lines this seeder itself wrote, per direction, in a stable order. ⚠ ONLY ITS OWN: a line
	// the table drew by hand between two player characters is theirs and says nothing about which
	// answers are drawn. Sorted by id so that two clients adopting the same legacy board pair its
	// lines with the same answers, which object order alone does not promise.
	const drawn = new Map();
	for (const [id, edge] of Object.entries(graph?.edges ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
		if (!isIntroEdge(edge)) continue;
		const key = `${edge.a}>${edge.b}`;
		drawn.set(key, [...(drawn.get(key) ?? []), { id, origin: edge.origin ?? "", note: edge.note ?? "" }]);
	}

	let addedLines = 0;
	for (const from of party) {
		const said = regards?.get?.(from.uuid);
		if (!said) continue;
		const a = byIdentity.get(nodeIdentity(from));
		if (!a) continue;
		for (const to of party) {
			if (to.uuid === from.uuid) continue;
			const lines = said.get(to.uuid) ?? [];
			const b = byIdentity.get(nodeIdentity(to));
			if (!b || a === b || !lines.length) continue;
			const already = drawn.get(`${a}>${b}`) ?? [];
			// BY KEY, so an answer is recognised wherever it has landed in the list rather than by
			// how many are drawn -- see the note at the top of this file for the bug that was.
			const known = new Set(already.map(edge => edge.origin).filter(Boolean));
			const missing = lines.filter(line => !known.has(line.key));
			// Whatever the lines nobody can name turn out to have been. Everything left after that
			// is genuinely new.
			for (const line of adoptBareLines(already, missing, marks)) {
				const id = newId();
				if (!isSafeId(id)) continue;
				edges[id] = {
					a, b,
					label: line.label ?? "",
					ink: line.ink,
					// ONE WAY, always: this line is what the first person answered about the second
					// and says nothing whatever about what the second answered back. That arrives, or
					// does not, as its own line pointing the other way, and the pair of them is the
					// whole point of the board.
					dir: "a-b",
					// THE WHOLE OF WHAT WAS WRITTEN, question and answer both, where the caption is
					// only as much of the question as the board has room for. It is the line's note,
					// so it is in the tooltip and in the editor when somebody opens the line.
					note: line.said ?? "",
					src: RELMAP_SRC_INTROS,
					// WHICH ANSWER THIS IS, and the whole of why the next open can leave it alone.
					origin: line.key ?? "",
				};
				addedLines += 1;
			}
		}
	}

	return { nodes, edges, marks, addedPeople, addedLines };
}

/**
 * Account for the lines on this board that carry no key, and hand back what is genuinely new.
 *
 * ⚠ WHAT THIS IS FOR IS EVERY BOARD THAT ALREADY EXISTS. Keys arrived after the party board did, so
 * every line seeded before them is unnamed -- and matched by key alone, the next open would draw the
 * whole board over again. This pairs each of those with the answer it was drawn from ONCE, writes
 * the key onto it, and from then on that board is matched by identity like any other.
 *
 * ⚠ BY THE WRITING, WHICH IS THE ONE PLACE THAT IS ALLOWED. Everywhere else in this file the words
 * are off limits, because a caption is the table's to rewrite; here the alternative is worse -- an
 * unadopted board is guessed about on every open forever -- and this runs once. The note carries the
 * question and the answer whole, so on the boards nobody has edited (which is nearly all of them)
 * the pairing is exact rather than a guess at all.
 *
 * BY POSITION FOR THE REST, which is precisely what the counting rule this replaced always did: a
 * line whose note has been rewritten is taken as the first answer still unaccounted for. It can be
 * wrong once, on one line, on a board somebody had already edited -- and then it is settled, where
 * before it was re-decided every time the map was opened.
 *
 * A LINE WITH NOTHING TO NAME IT IS LEFT AS IT IS. An answer with no key of its own (a caller that
 * had none to give) cannot mark anything, so the line stays bare and is paired again next time --
 * exactly the behaviour that was there before keys existed.
 *
 * @param {Array<{id, origin, note}>} already  this pair's seeded lines, in id order — which is not
 *        the order they were drawn in (the ids are random), only an order every client agrees on.
 * @param {Array<{key, said}>} missing  the answers with no keyed line, in reading order.
 * @param {object} marks  collects `edge id -> key`; written by the caller in the same update.
 * @returns {Array} the answers that still have no line at all.
 */
function adoptBareLines(already, missing, marks) {
	const spare = [...missing];
	for (const edge of already) {
		if (edge.origin || !spare.length) continue;
		const found = spare.findIndex(line => (line.said ?? "") === edge.note);
		const [line] = spare.splice(found < 0 ? 0 : found, 1);
		if (line?.key) marks[edge.id] = line.key;
	}
	return spare;
}
