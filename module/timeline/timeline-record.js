// MILESTONES, ONTO THE TIMELINE.
//
// The one place the system writes a row for itself: a level gained, a foe slain, an expedition home,
// a site visited, a death, a lasting wound, an arcanum, a follower gained or lost. Each caller says
// WHAT happened; this says WHEN (the campaign clock, now) and does the writing.
//
// THE RULES EVERY MILESTONE FOLLOWS:
//
//  • STORED, NOT DERIVED. A milestone is an ordinary entry. The table can retitle it, re-date it,
//    add a note to it, or delete it, exactly like a row somebody typed -- it is their history, and
//    the system only wrote the first draft.
//  • WRITTEN ONCE, by `key`. The same event recorded twice (a correction, a reload mid-dialog, two
//    clients noticing the same change) patches the row it already wrote instead of adding a second.
//    See `upsertByKey` in timeline-core.js.
//  • A FOOTNOTE, NEVER A FAILURE. Nothing here throws. A world with no steading, a reader who may not
//    write the page, a page mid-delete: the milestone is skipped with one console warning, and the
//    thing that happened (the damage, the level, the death) goes ahead regardless.

import { addKills, readEntries, removeEntry, upsertByKey } from "./timeline-core.js";
import { mutateTrack, trackForActor } from "./timeline-store.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { currentSeasonView, readCurrentSeason, readCurrentYear } from "../seasons/current-season.js";
import { warn } from "../utils/logger.js";

/**
 * When "now" is on the campaign clock, as the season and year a milestone files under.
 *
 * ⚠ AN UNSTAMPED WORLD IS SPRING OF YEAR ONE, not "before the record". The steading header already
 * reads that way for a world whose first Seasons Change has not been recorded yet
 * (`currentSeasonView`'s display default), and a table that has been playing for three sessions
 * without stamping the clock is still IN its first spring. Filing their level-ups as undated would
 * put the start of the campaign in a block called "Before the record".
 *
 * No steading at all is the one case with no clock to read, and that IS undated.
 *
 * @returns {{season: string, year: number}}
 */
export function timelineNow(steading = getStonetopSteadingActor()) {
	if (!steading) return { season: "", year: 1 };
	const view = currentSeasonView(readCurrentSeason(steading), readCurrentYear(steading));
	return { season: view.season, year: view.year };
}

/** A track descriptor from an actor, or a descriptor passed straight through. */
function trackOf(target) {
	if (!target) return null;
	if (typeof target.trackId === "string" && target.trackId) return target;
	return trackForActor(target);
}

let warned = false;

/** One warning per session: a table that cannot write the page should hear it once, not per kill. */
function warnOnce(err) {
	if (warned) return;
	warned = true;
	warn("could not record a milestone on the timeline", err);
}

/**
 * The one write every recorder shares: the track's page (minted if missing), stamped with who and
 * when, and never a throw unless `strict` asks for one. `mutate(stored, meta)` gets
 * `meta = { now, createdAt, authorId }`.
 *
 * `strict` is for a caller that must tell "failed" from "nothing to write", which a null answers
 * for both: the backfill, which marks itself done only once every write has landed.
 */
async function writeOnTrack(track, mutate, now, { strict = false, create = true } = {}) {
	try {
		const meta = { now: now ?? timelineNow(), createdAt: Date.now(), authorId: globalThis.game?.user?.id ?? "" };
		const done = await mutateTrack(track, stored => mutate(stored, meta), { create });
		return done?.page ?? null;
	} catch (err) {
		if (strict) throw err;
		warnOnce(err);
		return null;
	}
}

/**
 * Record milestones on one track, in ONE write.
 *
 * Each milestone is `{ source, key, title, body?, place?, placeUuid?, season?, year?, refresh? }`.
 * A missing date is the clock's now. `refresh` names the fields a repeat of the same `key` may
 * update (an expedition's "Returned triumphant." line arriving after its row was written); with
 * none, a repeat leaves the row alone.
 *
 * @param {Actor|{trackId: string, trackKind?: string, name?: string}} target  A character, the
 *        steading, or a track descriptor.
 * @param {object|object[]} milestones
 * @param {{now?: {season: string, year: number}, strict?: boolean}} [opts]  A caller writing several
 *        tracks reads the clock once and passes it. `strict` lets a failed write throw (see
 *        writeOnTrack).
 * @returns {Promise<JournalEntryPage|null>} The page written, or null when nothing was.
 */
export async function recordMilestones(target, milestones = [], { now, strict = false } = {}) {
	const track = trackOf(target);
	const list = (Array.isArray(milestones) ? milestones : [milestones]).filter(m => m?.source);
	if (!track || !list.length) return null;
	return writeOnTrack(track, (stored, { now, createdAt, authorId }) => {
		let entries = stored;
		let moved = null;
		for (const { refresh = [], ...fields } of list) {
			const result = upsertByKey(entries, { season: now.season, year: now.year, createdAt, authorId, ...fields }, {
				refresh, makeId: foundry.utils.randomID,
			});
			entries = result.entries;
			moved = moved ?? result.added ?? result.changed;
		}
		return { entries, changed: moved };
	}, now, { strict });
}

/**
 * Take milestones back off a track, by key: the thing that wrote them was UNDONE (user, 2026-10-10)
 * -- "Would-be" written back in, an oath's broken tick taken off, an improvement unticked in the
 * season it was ticked. Only a row the system wrote under that key goes; a typed row has none. Mints
 * no page: a track with none has nothing to forget.
 *
 * @param {Actor|{trackId: string}} target
 * @param {string|string[]} keys
 */
export async function forgetMilestones(target, keys = []) {
	const track = trackOf(target);
	const wanted = new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean));
	if (!track || !wanted.size) return null;
	return writeOnTrack(track, (stored) => {
		let entries = stored;
		const gone = [];
		for (const entry of readEntries(stored)) {
			if (!entry.key || !wanted.has(entry.key)) continue;
			const result = removeEntry(entries, entry.id);
			entries = result.entries;
			if (result.removed) gone.push(result.removed);
		}
		return { entries, removed: gone.length ? gone : null };
	}, null, { create: false });
}

/**
 * The same milestone on several tracks: everyone on an expedition, everyone who saw a site, and
 * Stonetop's own thread. Different pages, so the writes go out together.
 */
export async function recordOnTracks(targets = [], milestone) {
	const seen = new Set();
	const tracks = targets.map(trackOf).filter(t => t && !seen.has(t.trackId) && seen.add(t.trackId));
	const now = timelineNow();
	return Promise.all(tracks.map(track => recordMilestones(track, [milestone], { now })));
}

/**
 * Add kills to a character's row for the current season.
 *
 * @param {Actor} character
 * @param {string[]} names  One name per foe slain, as the table saw it.
 */
export async function recordKills(character, names = []) {
	const track = trackOf(character);
	if (!track || track.trackKind !== "character" || !names.length) return null;
	return writeOnTrack(track, (stored, { now, ...meta }) => addKills(stored, now, names, meta, foundry.utils.randomID));
}
