// AN EXPEDITION'S ROW, WRITTEN.
//
// The one writer for a trip on the timeline (the row itself is built, purely, in
// timeline-expedition.js). Two things reach for it: the Expedition walkthrough, when the GM steps
// into the homecoming by Next or presses its record button, and the Return Triumphant move, once
// the move has been made, from the walkthrough's last step or from the steading sheet's own move
// card. It used to live inside the walkthrough, and so a triumph made from the steading sheet never
// reached the trip's row at all.
//
// GM-ONLY. The trip's record is the world-scoped `expeditionAnswers` setting, and the row goes on
// several threads at once: everyone who went, and Stonetop's.
//
// WHICH COPY OF THE LOG. An open walkthrough keeps its own copy of the log for its lifetime and
// merges other writes into it (see ExpeditionDialog#onLogChanged), so while one is up its copy is
// the log: it is read through the window and written back through the window, or the window's
// next save would put its older copy back over this one. With no window up, the setting is read
// and written directly.

import { getSetting, setWorldSetting } from "../settings.js";
import { EXPEDITION_LOG_SETTING, addExpedition, currentExpedition, ensureCurrent, expeditionLabel, normalizeLog } from "../utils/expedition-log-core.js";
import { findOpenApp } from "../utils/open-windows.js";
import { charactersInPlay } from "../utils/characters-in-play.js";
import { getPlayerCharacters } from "../utils/playbook-actors.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { takesMissingFrom } from "../utils/requisition-asset.js";
import { inTurn } from "../utils/turn-queue.js";
import { localize } from "../utils/i18n.js";
import { warn } from "../utils/logger.js";
import { forgetMilestones, recordManyOnTracks, recordOnTracks, timelineNow } from "./timeline-record.js";
import { allTracks } from "./timeline-store.js";
import { expeditionMilestone, partySnapshot, tripBoundToName, tripCredits } from "./timeline-expedition.js";


/**
 * Change one trip in the store's log, read AFRESH: `patch(trip)` mutates a copy of it, or answers
 * `false` to write nothing. A trip not in
 * the log any more (deleted meanwhile) is left deleted, unless `mint` says it is the one a write is
 * minting, which is then added as it stands. Anything else written while the caller was busy (a
 * field saved, another GM's merge) is kept, because nothing here is a copy taken before an await.
 *
 * In the expedition log's turn, so two of these on one client cannot both start from one read.
 */
export function patchTrip(store, trip, patch, opts = {}) {
	return inTurn("expedition-log", () => patchTripNow(store, trip, patch, opts));
}

/**
 * `patchTrip` for a caller ALREADY in the expedition log's turn (one that also writes the steading
 * inside it): the same read-afresh patch, without queueing behind itself.
 */
export async function patchTripNow(store, trip, patch, { mint = false } = {}) {
	const now = store.read();
	const at = now.list.findIndex(e => e.id === trip.id);
	if (at < 0 && !mint) return false;
	const entry = structuredClone(at < 0 ? trip : now.list[at]);
	// `false` from the patch: nothing to change after all, so nothing is written.
	if (patch(entry) === false) return false;
	const log = at < 0
		? addExpedition(now, entry)
		: { currentId: now.currentId, list: now.list.map((e, i) => (i === at ? entry : e)) };
	await store.write(log);
	return true;
}

/** The trip a call means: the one named, else the store's current one. Null when there is none. */
function tripIn(log, tripId) {
	return tripId ? (log.list.find(e => e.id === tripId) ?? null) : currentExpedition(log);
}

/**
 * The GM-only opening every trip stamp shares: the store (the open walkthrough's, else the setting),
 * the trip the call means, then `act(store, trip)`. False for a player, or when there is no trip.
 */
async function withTrip({ store = null, tripId = null } = {}, act) {
	if (!game.user?.isGM) return false;
	store ??= tripLogStore();
	const trip = tripIn(store.read(), tripId);
	return trip ? act(store, trip) : false;
}

/**
 * Stamp the trip as having SET OUT now: the season, and who went (`partySnapshot`), which is the list
 * the homecoming credits. Redoing it re-stamps both. GM-only; never mints a trip.
 * @returns {Promise<boolean>}
 */
export async function stampSetOut(opts = {}) {
	return withTrip(opts, (store, trip) => {
		const when = timelineNow();
		return patchTrip(store, trip, t => {
			t.setOut = when;
			t.party = partySnapshot(t, charactersInPlay());
		});
	});
}

/** Take the set-out stamp back off: they have not left after all. GM-only. */
export async function clearSetOut(opts = {}) {
	return withTrip(opts, (store, trip) => patchTrip(store, trip, t => { delete t.setOut; delete t.party; }));
}

/**
 * Take a trip's rows off every thread, wherever they landed (the party may have changed since).
 * Never throws: `forgetMilestones` warns once and writes nothing it cannot.
 */
export async function forgetTripRows(tripId) {
	if (!tripId || !game.user?.isGM) return 0;
	const key = `expedition:${tripId}`;
	const results = await Promise.allSettled(allTracks().map(track => forgetMilestones(track, key)));
	return results.filter(r => r.status === "fulfilled" && r.value).length;
}

/**
 * They are NOT home yet: the homecoming stamp comes off, and with it the rows it wrote. GM-only.
 * The triumph, if one was made, stays on the trip.
 */
export async function clearTripHome(opts = {}) {
	return withTrip(opts, async (store, trip) => {
		await forgetTripRows(trip.id);
		return patchTrip(store, trip, t => { delete t.timelineRecorded; delete t.timelineTitle; });
	});
}

/**
 * A player's take reaches its trip's record as it happens (`updateActor` on the steading, from
 * hooks/Ready.js). A player cannot write the world-scoped log, so the asset's tag on the steading was
 * the only record of it, and an asset brought home or lost before the Chronicle was saved left the
 * Chronicle without it. The primary GM's client writes the line, once; with no GM connected the
 * walkthrough's save picks the takes up instead (ExpeditionDialog#_foldPlayerTakes).
 *
 * @param {object} steading  the StonetopSteading whose assets changed
 * @returns {Promise<number>} how many trips gained a line
 */
export async function recordExpeditionTakes(steading, { store = null } = {}) {
	if (!game.user?.isGM || !isPrimaryGM() || !steading?.getAssetsOnExpedition) return 0;
	store ??= tripLogStore();
	let wrote = 0;
	for (const trip of store.read().list) {
		if (!takesMissingFrom(trip.requisitioned, steading.getAssetsOnExpedition(trip.id)).length) continue;
		const added = await patchTrip(store, trip, entry => {
			// Asked again in the turn: the walkthrough's own take records its line while this waits.
			const extra = takesMissingFrom(entry.requisitioned, steading.getAssetsOnExpedition(entry.id));
			if (!extra.length) return false;
			entry.requisitioned = [...(Array.isArray(entry.requisitioned) ? entry.requisitioned : []), ...extra.map(name => ({ name }))];
		});
		if (added) wrote++;
	}
	return wrote;
}

/**
 * Where the expedition log is read from and written to, right now.
 *
 * A store is `{ read(), write(log), newTrip? }`. `read` answers a normalized `{ currentId, list }`;
 * `write` persists a whole log. `newTrip`, where a store has one, mints a trip when the log has no
 * current one: only the open walkthrough's does, because a GM standing in it is on a trip whether
 * or not anything has been typed into it yet. The bare setting has none, so a triumph made from the
 * steading sheet in a world that never logged a trip writes nothing rather than inventing one.
 */
export function tripLogStore() {
	const open = findOpenApp(w => w.id === "stonetop-expedition" && w.rendered);
	return open?.tripLogStore?.() ?? {
		read:  () => normalizeLog(getSetting(EXPEDITION_LOG_SETTING)),
		write: log => setWorldSetting(EXPEDITION_LOG_SETTING, log),
	};
}

/**
 * Did this trip come home THIS season? Its homecoming has written its row (`timelineRecorded`), and
 * in the season the clock reads now.
 *
 * ⚠ THE ONE TRIP A TRIUMPH FROM THE STEADING SHEET MAY CREDIT. That card cannot see which trip is
 * meant, and the log's "current" trip is just the one last opened in the walkthrough. That may be
 * one still being planned, which has not come home at all, or one that came home seasons ago.
 * Crediting either would write a homecoming that did not happen, or put an old trip's row on
 * characters who were never on it.
 */
export function cameHomeNow(trip) {
	const home = trip?.timelineRecorded;
	if (!home?.season) return false;
	const now = timelineNow();
	return home.season === now.season && Number(home.year) === Number(now.year);
}

/** A trip's row, its title, and the threads it goes on: everyone it credits, and Stonetop's. */
function tripRow(trip, at, { redate = false } = {}) {
	const credits = tripCredits(trip, getPlayerCharacters(), charactersInPlay());
	const label = expeditionLabel(trip, at);
	const milestone = expeditionMilestone({
		tripId:      trip.id,
		label,
		place:       tripBoundToName(trip),
		setOut:      trip.setOut ?? null,
		triumphant:  !!trip.returnedTriumphant,
		partyNames:  credits.names,
		redate,
		retitleFrom: trip.timelineTitle ?? null,
	});
	return { label, milestone, targets: [...credits.actors, getStonetopSteadingActor()] };
}

/**
 * The recorded trips whose positional name no longer matches their rows ("Expedition 3" became
 * "Expedition 2" when a trip before it was deleted): every row re-titled with one write per thread,
 * then every trip's `timelineTitle` with one log write. GM-only. Never throws.
 * @returns {Promise<number>} how many trips were re-titled
 */
export async function retitleRenumberedTrips({ store = null } = {}) {
	if (!game.user?.isGM) return 0;
	store ??= tripLogStore();
	const rows = store.read().list
		.map((trip, at) => ({ trip, row: tripRow(trip, at) }))
		.filter(({ trip, row }) => trip.timelineRecorded && trip.timelineTitle && trip.timelineTitle !== row.label);
	if (!rows.length) return 0;
	try {
		await recordManyOnTracks(rows.map(({ row }) => row), { strict: true });
	} catch (err) {
		warn("could not re-title the renumbered expeditions on every timeline", err);
		return 0;
	}
	const titles = new Map(rows.map(({ trip, row }) => [trip.id, row.label]));
	await inTurn("expedition-log", async () => {
		const now = store.read();
		await store.write({
			currentId: now.currentId,
			list: now.list.map(e => (titles.has(e.id) ? { ...structuredClone(e), timelineTitle: titles.get(e.id) } : e)),
		});
	});
	return rows.length;
}

/**
 * Write (or rewrite) the current trip's row on the timeline of everyone who went, and Stonetop's,
 * and stamp the trip `timelineRecorded` with the season it first went down in.
 *
 * Rewriting is safe: the row is keyed by the trip, so a second write patches the words of the
 * first (`refresh` in expeditionMilestone) rather than adding another.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.triumphant]  Mark the trip as having Returned Triumphant. Sticks: a later
 *                                     write without it does not take the triumph back off.
 * @param {object}  [opts.store]       The log to work on (see tripLogStore); defaults to whichever
 *                                     is live.
 * @param {boolean} [opts.homeOnly]    Only a trip that came home THIS season (see `cameHomeNow`).
 *                                     For a door that cannot see which trip is meant: the steading
 *                                     sheet's own move card.
 * @param {boolean} [opts.redate]      They came home NOW: the stamp and the rows move to this season
 *                                     (the homecoming's "redo"). Without it a rewrite keeps both.
 * @param {string}  [opts.tripId]      A trip other than the current one (a delete renumbering the
 *                                     unnamed trips after it re-titles their rows).
 * @returns {Promise<boolean>} whether anything was written.
 */
export async function recordTrip({ triumphant = false, store = null, homeOnly = false, redate = false, tripId = null } = {}) {
	if (!game.user?.isGM) return false;
	store ??= tripLogStore();
	const current = store.read();
	const found = tripIn(current, tripId);
	if (homeOnly && !cameHomeNow(found)) return false;
	if (!found && (tripId || !store.newTrip)) return false;
	const { log, entry: trip } = found
		? { log: current, entry: structuredClone(found) }
		: ensureCurrent(current, store.newTrip);
	const minted = !found;
	if (triumphant) trip.returnedTriumphant = true;
	const { label, milestone, targets } = tripRow(trip, log.list.findIndex(e => e.id === trip.id), { redate });
	const home = redate || !trip.timelineRecorded ? timelineNow() : trip.timelineRecorded;
	// The rows FIRST, and the trip stamped only once every one of them is down: stamped regardless,
	// a failed write left the homecoming saying "on the timeline" over threads that had no row, and
	// no later Next would try again. The row is keyed, so a retry patches what did land.
	try {
		await recordOnTracks(targets, milestone, { strict: true });
	} catch (err) {
		warn("could not put the expedition on every timeline", err);
		globalThis.ui?.notifications?.warn?.(localize("stonetop.timeline.expedition.failed"));
		return false;
	}
	return patchTrip(store, trip, t => {
		if (triumphant) t.returnedTriumphant = true;
		t.timelineRecorded = home;
		t.timelineTitle = label;
	}, { mint: minted });
}
