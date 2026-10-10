// THE TIMELINE'S DOCUMENTS: one journal, one page per track.
//
// A "Timeline" JournalEntry filed in The Chronicle folder, beside Player Introductions, Expeditions,
// Places of Interest and Seasons Change, and built with the same shared find-or-create so it cannot
// end up in a folder of its own the day somebody renames that one. Each track -- Stonetop, and each
// player character -- is one page of it, matched by a `chronicleKey` flag and never by name, which
// is the rule every other writer in that folder follows: a page found by name loses its history the
// day the character is renamed.
//
// ⚠ THE JOURNAL IS CREATED OWNER BY DEFAULT, and that is deliberate rather than careless. It is the
// same bargain the relationship map already strikes (relmap-doc.js): every player can write on it,
// including on somebody else's thread. The alternative is per-user page ownership recomputed
// whenever an actor's ownership changes, which is a synchronisation problem with a silent failure
// mode -- a player who quietly cannot save what they just typed. A shared record a table can all
// write in is what this feature is for, and the journal keeps its own version history.
//
// CREATING a JournalEntry needs TRUSTED, which a plain player is not, so the pages are minted by the
// GM-load lane (`syncTrackPages`) and no player ever needs that right. Adding an entry is a page
// UPDATE, which OWNER covers.

import { ensureChronicleFolder, findChronicleFolder, ensureChronicleJournal } from "../utils/chronicle-journals.js";
import { isSteadingActor, getStonetopSteadingActor } from "../utils/world.js";
import { SYSTEM_ID } from "../system-id.js";
import { inTurn } from "../utils/turn-queue.js";
import {
	TIMELINE_TRACK_STEADING, entriesById, entriesDiff, isLeftover, trackKey, trackIdFromKey, readEntries, sortEntries,
} from "./timeline-core.js";
import { deletionEntry, replacementEntry } from "../utils/foundry-compat.js";

/** The journal, inside The Chronicle folder. */
export const TIMELINE_JOURNAL_NAME = "Timeline";

/** The page subtype every track page carries. */
export const TIMELINE_PAGE_TYPE = "timeline";

/** Spacing between page sort values, so a new track appends after the existing ones. */
const SORT_STEP = 10;

/** Core's ownership numbers, read through a function so this module imports cleanly outside Foundry. */
function ownershipLevels() {
	return globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS ?? { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
}

/**
 * The Timeline journal if this world has one, or null. Creates NOTHING.
 *
 * Every read goes through here. `ensureTimelineJournal` conjures a folder as a side effect of
 * asking, which a player resolving their own tab must never do (and may not do anyway).
 */
export function findTimelineJournal() {
	const folder = findChronicleFolder();
	if (!folder) return null;
	return (game.journal?.contents ?? [])
		.find(j => j.folder?.id === folder.id && j.name === TIMELINE_JOURNAL_NAME) ?? null;
}

/** Find or create the journal. GM-only in practice, since both halves need creation rights. */
export async function ensureTimelineJournal() {
	const existing = findTimelineJournal();
	if (existing) return existing;
	const folder = await ensureChronicleFolder();
	if (!folder) return null;
	return ensureChronicleJournal(TIMELINE_JOURNAL_NAME, folder.id, ownershipLevels().OWNER);
}

/**
 * Which track an actor is, or null for an actor that has no thread of its own.
 *
 * ⚠ The steading's actor TYPE is "stonetop", not "steading" -- `isSteadingActor` carries both that
 * and the legacy `system.customType` form, so this must not hand-roll a type test.
 */
export function trackForActor(actor) {
	if (!actor) return null;
	if (isSteadingActor(actor)) return { trackId: TIMELINE_TRACK_STEADING, trackKind: "steading", name: actor.name };
	if (actor.type === "character") return { trackId: actor.id, trackKind: "character", name: actor.name };
	return null;
}

/** Every track this world should have a page for: the steading first, then the characters. */
export function worldTracks() {
	const tracks = [];
	const steading = getStonetopSteadingActor();
	if (steading) tracks.push(trackForActor(steading));
	for (const actor of game.actors?.contents ?? []) {
		if (actor.type === "character") tracks.push(trackForActor(actor));
	}
	return tracks.filter(Boolean);
}

/**
 * The track a page belongs to, read off its flag (or its data, for a page minted without one). The
 * one rule: the lanes, the writes and the GM's top-up all find a page by it, so a page one of them
 * counts is never a page another misses and mints again.
 */
export function pageTrackId(page) {
	return trackIdFromKey(page?.getFlag?.(SYSTEM_ID, "chronicleKey")) || page?.system?.trackId || "";
}

/** The journal's thread pages, whatever else it holds: what `pageTrackId` is read off. */
function timelinePages(journal) {
	return (journal?.pages ?? []).filter(p => p.type === TIMELINE_PAGE_TYPE);
}

/** The page holding one track's entries, or null. Creates nothing. */
export function findTrackPage(trackId) {
	const journal = findTimelineJournal();
	// Trimmed as `trackKey` trims it on the way into a page's key, so a stray space finds the page
	// rather than reading as a track with none (and `ensureTrackPage` minting a second).
	const id = String(trackId ?? "").trim();
	if (!journal || !id) return null;
	return timelinePages(journal).find(p => pageTrackId(p) === id) ?? null;
}

/** The actor a track belongs to, if any. The steading's own track resolves to the steading. */
export function trackActor(trackId) {
	if (!trackId) return null;
	if (trackId === TIMELINE_TRACK_STEADING) return getStonetopSteadingActor() ?? null;
	return game.actors?.get(trackId) ?? null;
}

/**
 * What a track is called.
 *
 * The ACTOR's current name wins, so renaming a character renames their thread; the page's name is
 * the fallback and is what the thread was called at the time. One home for that rule, because a
 * dialog title that disagrees with the lane heading above it reads as two different threads.
 */
export function trackDisplayName(trackId) {
	return trackActor(trackId)?.name ?? findTrackPage(trackId)?.name ?? "";
}

/**
 * One track, ready to render: its page (or null) and its entries in reading order.
 *
 * A missing page is not an error and not an empty result: it is a track nobody has written in yet,
 * and the tab renders its invitation off `page === null`.
 */
export function readTrack(trackId) {
	const page = findTrackPage(trackId);
	return {
		trackId,
		page,
		entries: sortEntries(page?.system?.entries ?? []),
	};
}

/**
 * Find or create one track's page.
 *
 * Attempted by anyone who OWNS the journal rather than by the GM alone, so a player who reaches a
 * brand new character's tab before their GM's next load is not simply stuck. It returns null rather
 * than throwing when the right is missing, and the caller shows the invitation.
 */
/** The highest `sort` in a journal, so a new page lands after everything already there. */
function maxSort(journal) {
	return (journal?.pages ?? []).reduce((m, p) => Math.max(m, Number(p.sort) || 0), 0);
}

/**
 * The creation payload for one track's page.
 *
 * ONE FACTORY, because two paths mint these -- a tab reaching a track that has no page yet, and the
 * world-setup lane topping up every track at once -- and a page minted by one that differs from a
 * page minted by the other is a track that reads back wrong depending on who got there first. A
 * field added to TimelinePageModel is added here, once.
 */
function trackPageData(track, sort) {
	return {
		name: track.name || track.trackId,
		type: TIMELINE_PAGE_TYPE,
		sort,
		system: { trackKind: track.trackKind, trackId: track.trackId, entries: {}, keyed: true },
		flags: { [SYSTEM_ID]: { chronicleKey: trackKey(track.trackId) } },
	};
}

/**
 * The turn every page (and the journal itself) is minted in on this client. See `syncTrackPages`.
 */
const PAGES_TURN = "timeline:pages";

export async function ensureTrackPage(track) {
	if (!track?.trackId) return null;
	const existing = findTrackPage(track.trackId);
	if (existing) return existing;

	return inTurn(PAGES_TURN, async () => {
		// Asked again in turn: a sync queued ahead of this one may have minted it meanwhile.
		const minted = findTrackPage(track.trackId);
		if (minted) return minted;

		const journal = game.user?.isGM ? await ensureTimelineJournal() : findTimelineJournal();
		if (!journal?.isOwner) return null;

		const [page] = await journal.createEmbeddedDocuments(
			"JournalEntryPage",
			[trackPageData(track, maxSort(journal) + SORT_STEP)],
		);
		return page ?? null;
	});
}

/**
 * Write a track's entries back: ONLY WHAT MOVED. An entry added is written whole at
 * `system.entries.<id>`, a changed one only in the fields that changed, a removed one deleted by its
 * key, so a write from another client to some other row (or some other field) is left standing.
 * See TimelinePageModel for why the entries are keyed.
 *
 * ⚠ A PAGE STILL STORING A LIST is replaced whole, once, and marked `keyed`. The server merges an
 * update into what it STORES, and a keyed patch merged into a list would fold the two together;
 * the model already reads such a page as keyed, so the client cannot tell from the entries alone.
 */
export async function writeEntries(page, entries) {
	if (!page) return null;
	if (!page.system?.keyed) {
		await page.update(Object.fromEntries([
			replacementEntry("system.entries", entriesById(entries)),
			["system.keyed", true],
		]));
		return page;
	}
	const diff = entriesDiff(page.system?.entries, entries);
	if (!diff) return page;
	const update = {};
	for (const [id, entry] of Object.entries(diff.added)) update[`system.entries.${id}`] = entry;
	for (const [id, fields] of Object.entries(diff.changed)) {
		for (const [field, value] of Object.entries(fields)) update[`system.entries.${id}.${field}`] = value;
	}
	// ⚠ A FIELD PATCH CAN LAND ON A ROW ANOTHER CLIENT HAS JUST DELETED, and the server then keeps a
	// partial row under that key. Nobody reads it (timeline-core.js#isLeftover); the next write clears
	// it out of storage too.
	const leftovers = Object.entries(page.system?.entries ?? {}).filter(([, entry]) => isLeftover(entry)).map(([id]) => id);
	for (const id of [...diff.removed, ...leftovers]) {
		const [key, value] = deletionEntry(`system.entries.${id}`);
		update[key] = value;
	}
	await page.update(update);
	return page;
}

/**
 * THE ONE WRITE PATH for a track's entries: read the page, run a pure mutator over what it holds,
 * write back what the mutator moved.
 *
 * Down HERE rather than on the window, because the window is not the only writer. A Seasons Change
 * records its own line, and a future one (an expedition, a death) will too; each of those
 * hand-rolling read/create/no-op/write is how the add path and the season path drift apart. The
 * mutators it is handed are timeline-core's, which answer a null result for "nothing moved" -- so a
 * re-record that changes nothing writes nothing and re-renders nobody.
 *
 * Errors are NOT caught here. A caller with a window to report into wants them; a caller writing a
 * footnote may not. Both are honest, and swallowing them at this level would take the choice away.
 *
 * @param {{trackId: string, trackKind?: string, name?: string}} track  `create` mints its page.
 * @param {(entries: Array) => {entries: Array, added?, removed?, changed?, moved?}} mutate
 * @param {{create?: boolean}} [opts]
 * @returns {Promise<{page: object, moved: object}|null>}  null when there is no page to write, or
 *          when the mutator moved nothing.
 */
export async function mutateTrack(track, mutate, { create = false } = {}) {
	if (!track?.trackId) return null;
	return inTurn(trackTurnKey(track.trackId), async () => {
		let page = findTrackPage(track.trackId);
		if (!page && create) page = await ensureTrackPage(track);
		if (!page) return null;

		const result = mutate(readEntries(page.system?.entries));
		const moved = result?.added ?? result?.removed ?? result?.changed ?? result?.moved ?? null;
		if (!moved) return null;

		await writeEntries(page, result.entries);
		return { page, moved };
	});
}

/**
 * The turn-queue key for one track, so two writes to the same track on this client never interleave.
 *
 * ⚠ EVERY WRITE IS WORKED OUT FROM WHAT THE PAGE HELD WHEN IT STARTED, and milestones arrive in
 * BURSTS: one Apply-damage press that drops three foes, an arcanum gained and identified by two flag
 * writes in one `Promise.all`, a level gained with a move learned in the same breath. Two upserts of
 * the same key, or two appends to one season's kills row, that both read before either landed
 * would write the same row twice or keep only one list of foes. Taking turns means each write reads
 * only after the previous one has RESOLVED, which is exactly when the page holds what it stored.
 *
 * Writes from DIFFERENT clients are not ordered by this, and do not need to be for the common case:
 * the entries are keyed (TimelinePageModel), so writers to different rows both land. Two clients
 * changing the SAME field of the same row at the same instant still leave the later one.
 */
export const trackTurnKey = trackId => `timeline:${trackId}`;

/**
 * Keep a track page's NAME in step with its actor's.
 *
 * A page is minted once, usually while the character is still "New Character", and the Journal
 * sidebar reads the page's own name. The sheets and the aggregate already read the live actor's
 * name; this is only so the sidebar row agrees with them. Answers the page, or null if there was
 * nothing to rename.
 */
export async function renameTrackPage(trackId, name) {
	const page = findTrackPage(trackId);
	const next = String(name ?? "").trim();
	if (!page || !next || page.name === next || !page.isOwner) return null;
	await page.update({ name: next });
	return page;
}

/**
 * Every track that has a page, for the aggregate view. In page sort order, which puts the steading
 * first because its page is the first one the lane mints.
 *
 * Tracks whose actor has since been deleted are kept: the page is the record, and a character who
 * died and was removed from the world is exactly the thread a chronicle should still be able to
 * read back. The name falls back to the page's own, which is what it was called at the time.
 */
export function allTracks() {
	const journal = findTimelineJournal();
	if (!journal) return [];
	// ⚠ ONE LANE PER TRACK, even if two clients minted a page for it at the same instant. The page
	// kept is the one `findTrackPage` answers (the first in the journal), which is the one every
	// write goes to.
	const seen = new Set();
	return timelinePages(journal)
		.map(page => ({ page, trackId: pageTrackId(page) }))
		.filter(({ trackId }) => !trackId || (!seen.has(trackId) && seen.add(trackId)))
		.sort((a, b) => (a.page.sort ?? 0) - (b.page.sort ?? 0))
		.map(({ page, trackId }) => {
			const actor = trackActor(trackId);
			return {
				trackId,
				trackKind: page.system?.trackKind ?? "",
				name: actor?.name ?? page.name,
				actor: actor ?? null,
				page,
				entries: sortEntries(page.system?.entries ?? []),
			};
		});
}

/**
 * Top up the journal so every track in the world has a page. GM-only, run from the world-setup lane
 * on each load and after a character is created.
 *
 * Idempotent by construction: it only ever creates a page whose key is absent, so a GM's own
 * deletion of a track page comes back on the next load -- which is the right answer for a page that
 * is the storage rather than a view of it, and matches how the Places of Interest pages behave.
 *
 * ⚠ RUN IN TURN (`PAGES_TURN`). Characters arrive in batches -- a compendium import, several made in
 * one `createDocuments` -- and each fires its own `createActor`. Run side by side, every one of those
 * syncs would read the journal before any of the others' pages landed and mint the same pages again.
 * In turn, each reads what the one before it made. A fresh world's journal is minted in the same
 * turn, so it is not made twice either.
 *
 * @returns {Promise<number>} how many pages were minted.
 */
export async function syncTrackPages() {
	if (!game.user?.isGM) return 0;
	return inTurn(PAGES_TURN, async () => {
		const tracks = worldTracks();
		if (!tracks.length) return 0;
		const journal = await ensureTimelineJournal();
		if (!journal) return 0;

		const have = new Set(timelinePages(journal).map(pageTrackId).filter(Boolean));
		const missing = tracks.filter(t => !have.has(t.trackId));
		if (!missing.length) return 0;

		let sort = maxSort(journal);
		await journal.createEmbeddedDocuments(
			"JournalEntryPage",
			missing.map(track => trackPageData(track, sort += SORT_STEP)),
		);
		return missing.length;
	});
}
