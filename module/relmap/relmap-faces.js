// The saved copy of each person's name and picture on every board, kept up with their actor.
//
// A face on the map is drawn from the LIVE actor (RelationshipMapWindow `_personOnMap`). The node's
// own `name` and `img` are only the copy it falls back on once that actor is deleted, and that copy
// used to be written once, when the person was put down. So a character renamed and then deleted came
// back under the name and picture they had on the day they were seated. This keeps the copy current.
//
// ONE CLIENT WRITES EACH BOARD, or two clients would broadcast the same change twice:
//  • the client that made the change writes every board it may edit;
//  • the primary GM writes the boards that client may not (a board the GM kept back from players).
// With no GM connected, those wait for the GM's next load, which sweeps every board (`sweepStaleFaces`).
// The sweep is also what brings an older world's stale copies up to date.
//
// Never through the undo history: nobody did this to the map, so nobody's Ctrl+Z should take it back.

import { isPrimaryGM } from "../utils/primary-gm.js";
import { clipText } from "../utils/strings.js";
import { applyPatch, hasLegacyBoard, listMapPages, listRelationshipMaps, readGraph } from "./relmap-doc.js";
import { RELMAP_NAME_MAX, nodePatch } from "./relmap-store.js";

/** Whether an actor update changed what the saved copy holds: the name or the picture. */
export function changedSavedFace(changed) {
	return !!changed && typeof changed === "object" && ("name" in changed || "img" in changed);
}

/**
 * Every board in the world: each map's pages, and a version 1 map's own entry, whose flag is its board.
 * Hidden boards included, because the copy on a hidden board goes stale just the same.
 */
export function everyBoard(maps = listRelationshipMaps()) {
	const boards = [];
	for (const entry of maps) {
		const pages = listMapPages(entry);
		if (pages.length) boards.push(...pages);
		else if (hasLegacyBoard(entry)) boards.push(entry);
	}
	return boards;
}

/**
 * The patch that brings every node standing for `uuid` on one board up to `face`, or null when they
 * all already match. Only the fields that differ are written.
 *
 * @param {object} graph  the board, normalized.
 * @param {string} uuid
 * @param {{name: string, img: string}} face  the actor as it is now.
 */
export function freshFacePatch(graph, uuid, face = {}) {
	if (!uuid) return null;
	const want = savedFace(face);
	let patch = null;
	for (const [id, node] of Object.entries(graph?.nodes ?? {})) {
		if (node.uuid !== uuid) continue;
		patch = freshenNode(patch, id, node, want);
	}
	return patch;
}

/** An actor's name and picture as the saved copy holds them: the name clipped to what a node keeps. */
function savedFace({ name, img } = {}) {
	return { name: clipText(String(name ?? ""), RELMAP_NAME_MAX), img: String(img ?? "") };
}

/**
 * Add what one node needs to match `want` (from `savedFace`) onto `patch`, which may be null.
 * Returns the patch, still null when the node already matches.
 */
function freshenNode(patch, id, node, want) {
	const fields = {};
	// A blank name is never written over a good one: core refuses a nameless actor anyway, and the
	// copy is only worth keeping while it says something.
	if (want.name && node.name !== want.name) fields.name = want.name;
	if (node.img !== want.img) fields.img = want.img;
	if (!Object.keys(fields).length) return patch;
	return Object.assign(patch ?? {}, nodePatch(id, fields));
}

/** Write one board's patch, reporting a refusal rather than throwing into the hook that called it. */
async function writeBoard(doc, patch) {
	try { return await applyPatch(doc, patch); }
	catch (err) {
		console.warn(`Stonetop | could not refresh a saved name on the relationship map "${doc?.name}"`, err);
		return false;
	}
}

/**
 * Write every board's patch at once and count the ones that landed. The boards are separate
 * documents, so nothing is gained by waiting for one before sending the next; and `writeBoard`
 * never throws, so one refusal cannot stop the rest.
 *
 * @param {Array<[object, object]>} writes  `[doc, patch]` pairs, every patch already non-empty.
 */
async function writeBoards(writes) {
	const landed = await Promise.all(writes.map(([doc, patch]) => writeBoard(doc, patch)));
	return landed.filter(Boolean).length;
}

/**
 * `updateActor`: an actor's name or picture changed, so every board carrying them takes the new one.
 *
 * Returns how many boards this client wrote, for the tests; the hook ignores it.
 */
export async function keepSavedFacesCurrent(actor, changed, _options, userId) {
	if (!changedSavedFace(changed) || !actor?.uuid) return 0;
	const me = globalThis.game?.user;
	if (!me) return 0;
	const mine = userId === me.id;
	// The primary GM picks up only the boards the person who made the change could not write.
	const backstop = !mine && me.isGM && isPrimaryGM();
	if (!mine && !backstop) return 0;
	const maker = backstop ? globalThis.game.users?.get?.(userId) ?? null : null;

	const writes = [];
	for (const doc of everyBoard()) {
		if (mine && !doc.isOwner) continue;
		if (backstop && maker && doc.testUserPermission?.(maker, "OWNER")) continue;
		const patch = freshFacePatch(readGraph(doc), actor.uuid, actor);
		if (patch) writes.push([doc, patch]);
	}
	return writeBoards(writes);
}

/**
 * Bring every saved copy in the world up to its actor. Primary GM, every load, and idempotent: a
 * board whose copies already match is not written. A person whose actor is gone keeps the copy they
 * have, which is the whole point of keeping one.
 *
 * Only world actors are looked up: a compendium uuid resolves to an index entry at best, and nothing
 * renames a compendium actor while the table plays.
 */
export async function sweepStaleFaces({ resolve = uuid => globalThis.fromUuidSync?.(uuid, { strict: false }) } = {}) {
	const me = globalThis.game?.user;
	if (!me?.isGM || !isPrimaryGM()) return 0;
	// EACH ACTOR LOOKED UP ONCE FOR THE WHOLE SWEEP, and null for one that is not there to look up:
	// the same person stands on several boards, and on several spots of one.
	const faces = new Map();
	const faceOf = uuid => {
		if (faces.has(uuid)) return faces.get(uuid);
		let actor = null;
		try { actor = resolve(uuid); } catch { actor = null; }
		const face = actor?.documentName === "Actor" ? savedFace(actor) : null;
		faces.set(uuid, face);
		return face;
	};
	const writes = [];
	for (const doc of everyBoard()) {
		// ONE WALK OF THE BOARD, every node brought up to its own actor as it is passed.
		let patch = null;
		for (const [id, node] of Object.entries(readGraph(doc).nodes)) {
			if (!node.uuid || node.uuid.startsWith("Compendium.")) continue;
			const face = faceOf(node.uuid);
			if (face) patch = freshenNode(patch, id, node, face);
		}
		if (patch) writes.push([doc, patch]);
	}
	return writeBoards(writes);
}
