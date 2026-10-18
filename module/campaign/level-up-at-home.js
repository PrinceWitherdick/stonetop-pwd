// LEVEL UP ONLY AT HOME, AS A REMINDER.
//
// Book I p.528: "PCs can't Level Up 'in the field.' They need to head home." And p.582: "A PC can
// Level Up only at home." But also p.528: "don't be a stickler; if everyone has enough XP and they get
// just one quiet night before heading back out, let them Level Up." So this never blocks: the Level Up
// window says a trip is still underway and leaves the call to the table.
//
// WHERE "UNDERWAY" COMES FROM. The Expedition walkthrough (dialogs/ExpeditionDialog.js#_noteTripStep)
// stamps a trip `setOut` when the GM steps into Running the Journey, and `timelineRecorded` when they
// step into the homecoming. A trip with the first and not the second has left and not come home. A
// table that never walks the expedition window stamps neither, and gets no reminder: silence, never a
// false one. A character ticked out of that trip's party (`partyOut`) is at home whatever the others do.

import { getObjectSetting } from "../settings.js";
import { expeditionLabel, normalizeLog } from "../utils/expedition-log-core.js";
import { format } from "../utils/i18n.js";

/** The expedition log's world setting (settings.js). */
export const EXPEDITION_LOG_SETTING = "expeditionAnswers";

/** Whether a logged trip has set out and not yet come home. */
export function tripUnderway(trip) {
	return !!trip?.setOut && !trip?.timelineRecorded;
}

/**
 * The trip `actorId` is away on, as `{ trip, label }`, or null. The latest such trip when (oddly) there
 * are several: the walkthrough lists oldest first.
 *
 * @param {string} actorId
 * @param {object} log  the expedition log, raw or normalized
 */
export function expeditionUnderwayFor(actorId, log) {
	const { list } = normalizeLog(log);
	for (let i = list.length - 1; i >= 0; i--) {
		const trip = list[i];
		if (!tripUnderway(trip) || trip.partyOut?.[actorId]) continue;
		return { trip, label: expeditionLabel(trip, i) };
	}
	return null;
}

/**
 * The Level Up window's reminder for `actor`, or "" when they are not known to be away.
 *
 * @param {Actor} actor
 * @param {object} [log]  defaults to the world's expedition log
 */
export function levelUpAwayNote(actor, log = getObjectSetting(EXPEDITION_LOG_SETTING)) {
	if (!actor?.id) return "";
	const away = expeditionUnderwayFor(actor.id, log);
	return away ? format("stonetop.specialMoves.levelUp.awayWarning", { trip: away.label }) : "";
}
