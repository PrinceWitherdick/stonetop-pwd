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
import { currentExpedition, ensureCurrent, expeditionLabel, normalizeLog } from "../utils/expedition-log-core.js";
import { findOpenApp } from "../utils/open-windows.js";
import { charactersInPlay } from "../utils/characters-in-play.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { recordOnTracks, timelineNow } from "./timeline-record.js";
import { expeditionMilestone, expeditionParty, tripBoundToName } from "./timeline-expedition.js";

const LOG_SETTING = "expeditionAnswers";

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
		read:  () => normalizeLog(getSetting(LOG_SETTING)),
		write: log => setWorldSetting(LOG_SETTING, log),
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
 * @returns {Promise<boolean>} whether anything was written.
 */
export async function recordTrip({ triumphant = false, store = null, homeOnly = false } = {}) {
	if (!game.user?.isGM) return false;
	store ??= tripLogStore();
	const current = store.read();
	if (homeOnly && !cameHomeNow(currentExpedition(current))) return false;
	if (!store.newTrip && !currentExpedition(current)) return false;
	const { log, entry: trip } = ensureCurrent(current, store.newTrip);
	if (triumphant) trip.returnedTriumphant = true;
	const party = expeditionParty(trip, charactersInPlay());
	const milestone = expeditionMilestone({
		tripId:     trip.id,
		label:      expeditionLabel(trip, log.list.findIndex(e => e.id === trip.id)),
		place:      tripBoundToName(trip),
		setOut:     trip.setOut ?? null,
		triumphant: !!trip.returnedTriumphant,
		partyNames: party.map(pc => pc.name),
	});
	trip.timelineRecorded = trip.timelineRecorded ?? timelineNow();
	// Different documents, neither reading the other: the rows are journal pages, the stamp is the
	// world setting.
	await Promise.all([
		recordOnTracks([...party, getStonetopSteadingActor()], milestone),
		store.write(log),
	]);
	return true;
}
