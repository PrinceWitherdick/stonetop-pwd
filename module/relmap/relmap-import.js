// Pulling what the sheets already know onto a relationship map.
//
// The 1-5 hearts (utils/relationship-hearts.js) are a separate feature and stay one: this is a
// ONE-TIME IMPORT, not a live mirror. A mirror would give every line two sources of truth, so a
// label renamed on the map would be overwritten by a heart moved on a sheet, and neither surface
// could be called the record. Press the button, get a board seeded from what the table has actually
// judged, and from then on the map is the map.
//
// WHY IT IS WORTH DOING AT ALL, which is not the labour saved. The hearts table is ASYMMETRIC by
// design: each actor stores its OWN regard for the others, so Elena can rate Stefan trusted while
// Stefan rates Elena hostile. A sheet can only ever show one side of that. A map can show both at
// once, as two arrows that disagree — and that disagreement is the most interesting thing in the
// data. So a rating imports as a ONE-WAY link, and a pair who have both rated each other gets two,
// which the fan (relmap-geometry.js `fanBow`) already spreads apart.
//
// ⚠ THE SPARSE-STORAGE TRAP. An absent entry reads as neutral 3, so "every entry" is every pair of
// actors in the world. Only entries where a rating was actually STORED may import, which is exactly
// what `hasStoredRating` answers — and it asks about the rating rather than the entry, because
// ticking a visibility box or typing a note also creates one.

import { SETTLEMENTS } from "../data/settlements.js";
import { hasStoredRating, readRelationship } from "../utils/relationship-hearts.js";
import { freeSpot, ringsLayout } from "../utils/relmap-geometry.js";
import { partyCharacters } from "../utils/playbook-actors.js";
import { steadingPeopleActors } from "../actors/steading/steading-people.js";
import { addEdgePatch, addNodePatch, isSafeId, nodeIdentity, takenSpots } from "./relmap-store.js";

/** Which actor types keep a relationships table. The steading's is keyed differently — see below. */
const RATING_TYPES = ["character", "npc", "stonetop"];

/**
 * The three bands, as the board already reads them, mapped onto an ink.
 *
 * The SAME cut as `REL_LANES` in utils/relationship-board.js (hostile 1-2, neutral 3, trusted 4-5).
 * Not imported from there: that module reads `HEARTS_MAX` at evaluation time and importing it from
 * a leaf like this one is the load-order cycle its own header warns about. The cut is restated in
 * one place here, and a test holds the two to the same boundaries.
 */
export const IMPORT_BANDS = Object.freeze([
	Object.freeze({ key: "hostile", max: 2, ink: "rust" }),
	Object.freeze({ key: "neutral", max: 3, ink: "slate" }),
	Object.freeze({ key: "trusted", max: 5, ink: "sage" }),
]);

/**
 * Which band a rating falls in.
 *
 * ⚠ `Number(null)` is 0 and `Number("")` is 0, and 0 falls in the FIRST band — so the obvious
 * one-liner reads a rating that was never a number as HOSTILE. That is the worst wrong answer this
 * function could give: it puts a line on the board asserting an enmity nobody recorded. A rating
 * that is not a number is not a judgment at all, so it reads as the middle.
 * (utils/relmap-geometry.js `clampPct` carries the same guard, for the same reason.)
 */
export function bandFor(hearts) {
	const n = hearts === null || hearts === undefined || hearts === "" ? NaN : Number(hearts);
	if (!Number.isFinite(n)) return IMPORT_BANDS[1];
	return IMPORT_BANDS.find(band => n <= band.max) ?? IMPORT_BANDS[IMPORT_BANDS.length - 1];
}

/** The settlements, by slug — what a steading's ratings point at. */
const settlementBySlug = slug => SETTLEMENTS.find(s => s.slug === slug) ?? null;

/**
 * Every rating anybody in this world has actually stored, as flat rows.
 *
 * TWO KEY SPACES, because the sheets have two. A character's and an NPC's table is keyed by ACTOR
 * ID; the steading's "Other Settlements" is keyed by SETTLEMENT SLUG, and those name places with no
 * actor behind them. Both come out of here in the same shape, with `uuid` null for a settlement —
 * which the map already supports, being how a person nobody has made a sheet for is drawn.
 *
 * A row whose target cannot be resolved at all is dropped rather than guessed at: an id left behind
 * by a deleted actor is not somebody to put on a map.
 */
export function gatherRatings(actors = []) {
	const rows = [];
	for (const actor of actors) {
		if (!RATING_TYPES.includes(actor?.type)) continue;
		const table = actor.system?.relationships;
		if (!table || typeof table !== "object") continue;

		for (const [key, raw] of Object.entries(table)) {
			// The whole of the sparse-storage guard: a rating nobody made is not a line.
			if (!hasStoredRating(raw)) continue;
			const target = resolveTarget(actor, key);
			if (!target) continue;
			const { hearts, notes } = readRelationship(raw);
			rows.push({
				from: { uuid: actor.uuid, name: actor.name, img: actor.img ?? "" },
				to: target,
				hearts,
				notes: (notes ?? "").trim(),
			});
		}
	}
	return rows;
}

function resolveTarget(actor, key) {
	if (actor.type === "stonetop") {
		const settlement = settlementBySlug(key);
		// A place, not a person: no actor, so no uuid. Drawn as a plain named circle.
		return settlement ? { uuid: null, name: settlement.name, img: "" } : null;
	}
	const other = game.actors?.get?.(key) ?? null;
	return other ? { uuid: other.uuid, name: other.name, img: other.img ?? "" } : null;
}

/**
 * The whole cast the Stonetop sheet knows about: the player characters, and every person on any
 * steading's Residents and Neighbors rosters.
 *
 * THROUGH THE SHEET'S OWN TWO READERS, not a fresh scan of `game.actors`. `partyCharacters` already
 * decides what counts as a player character (the player-owned ones where there are any, all of them
 * otherwise), and `steadingPeopleActors` already resolves a roster row to its actor and de-dupes.
 * A second opinion here is how the map would come to disagree with the sheet it copied.
 *
 * EVERY steading, because a world may hold more than one and every other place in this system that
 * asks filters `game.actors` for the type rather than assuming a single one.
 *
 * Deliberately NOT "every NPC in the world": a world can carry a hundred and fifty NPC actors, and
 * a board with all of them on it is not a board. The rosters are the cast the table has actually
 * put on its steading sheet, which is what was asked for.
 */
export function gatherCast() {
	const people = [];
	const seen = new Set();
	const push = actor => {
		if (!actor || seen.has(actor.uuid)) return;
		seen.add(actor.uuid);
		people.push({ uuid: actor.uuid, name: actor.name, img: actor.img ?? "" });
	};

	for (const pc of partyCharacters()) push(pc);
	for (const steading of (game.actors?.contents ?? []).filter(a => a.type === "stonetop")) {
		for (const person of steadingPeopleActors(steading)) push(person);
	}
	return people;
}

/**
 * What adding a whole cast would write, and who it would leave alone.
 *
 * PEOPLE ONLY, no lines. Who knows whom is the thing the table is going to draw; putting everybody
 * on the board is only clearing the desk first. A version of this that also guessed at links would
 * be asserting relationships nobody recorded, which is what `importPlan` above is careful not to do
 * even when it HAS ratings to go on.
 *
 * The seating depends on whether the board is already in use. An empty one gets a proper concentric
 * layout, which is the poster look and fits any size of cast; a board somebody has already arranged
 * gets its newcomers slotted into whatever clear air is left, so nothing already placed moves.
 */
export function castPlan(graph, cast, newId = () => foundry.utils.randomID()) {
	const patch = {};
	const known = new Set(Object.values(graph.nodes ?? {}).map(nodeIdentity));
	const newcomers = (cast ?? []).filter(person => !known.has(nodeIdentity(person)));
	if (!newcomers.length) return { patch, added: 0, already: (cast ?? []).length };

	const wasEmpty = !Object.keys(graph.nodes ?? {}).length;
	const taken = takenSpots(graph);
	const seats = wasEmpty ? ringsLayout(newcomers.length) : [];

	let added = 0;
	newcomers.forEach((person, i) => {
		const id = newId();
		if (!isSafeId(id)) return;
		const spot = seats[i] ?? freeSpot(taken);
		const node = addNodePatch(id, {
			uuid: person.uuid, name: person.name, img: person.img,
			x: spot.left, y: spot.top,
		});
		if (!node) return;
		Object.assign(patch, node);
		taken.push(spot);
		added += 1;
	});

	return { patch, added, already: (cast ?? []).length - newcomers.length };
}

/**
 * What an import would ADD to `graph`, as one patch plus a tally of what it did.
 *
 * PURE, and separate from the writing, so the counts in the report are the counts that were
 * actually written rather than a second guess at them.
 *
 * IDEMPOTENT. A person already on the board is not added twice, and a link is skipped when one
 * already runs the same way between the same two — so pressing the button again after renaming half
 * the labels adds only what is genuinely new, and rewrites nothing.
 *
 * @param {object} graph  the map as it stands, normalized.
 * @param {Array}  rows   from `gatherRatings`.
 * @param {Function} newId  id minter, injected so the result is testable.
 */
export function importPlan(graph, rows, newId = () => foundry.utils.randomID()) {
	const patch = {};
	const byIdentity = new Map();
	for (const [id, node] of Object.entries(graph.nodes ?? {})) byIdentity.set(nodeIdentity(node), id);

	// Where the people added by this run are put. Seeded with everyone already placed, and grown as
	// it goes, so a run that adds eight people does not stack all eight on the same clear spot.
	const taken = takenSpots(graph);

	let addedPeople = 0;
	const ensureNode = person => {
		const identity = nodeIdentity(person);
		const existing = byIdentity.get(identity);
		if (existing) return existing;
		const id = newId();
		if (!isSafeId(id)) return null;
		const spot = freeSpot(taken);
		Object.assign(patch, addNodePatch(id, {
			uuid: person.uuid, name: person.name, img: person.img,
			x: spot.left, y: spot.top,
		}) ?? {});
		byIdentity.set(identity, id);
		taken.push(spot);
		addedPeople += 1;
		return id;
	};

	// Links already running each way, so a re-run adds nothing it added before.
	const drawn = new Set(
		Object.values(graph.edges ?? {}).map(edge => `${edge.a}>${edge.b}`),
	);

	let addedLinks = 0;
	for (const row of rows) {
		const a = ensureNode(row.from);
		const b = ensureNode(row.to);
		if (!a || !b || a === b) continue;
		if (drawn.has(`${a}>${b}`)) continue;
		const band = bandFor(row.hearts);
		const id = newId();
		const edge = addEdgePatch(id, {
			a, b,
			// The stored note is already a sentence about this pair, so it IS the label. The band
			// name is the fallback, and a poor one on its own — which is why the note wins.
			label: row.notes || bandLabel(band),
			ink: band.ink,
			// ONE WAY, because that is what the data says: this is A's regard for B and nothing
			// about B's regard for A. The reverse arrives as its own row if B has rated A.
			dir: "a-b",
		});
		if (!edge) continue;
		Object.assign(patch, edge);
		drawn.add(`${a}>${b}`);
		addedLinks += 1;
	}

	return { patch, addedPeople, addedLinks, considered: rows.length };
}

function bandLabel(band) {
	return game.i18n?.localize?.(`stonetop.relationships.lane.${band.key}`) ?? band.key;
}
