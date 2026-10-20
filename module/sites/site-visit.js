// "THEY WENT THERE": the GM marks a site visited, from its card in the GM Toolkit.
//
// Asks who went -- the current expedition's party ticked to start with, since a site is most often
// an expedition's destination or a find along its way -- then puts the visit on each of their
// timelines and on Stonetop's, and remembers the season on the site page so the card can say so.
// GM-only: the page is GM prep, and so is the decision that the party has been there.

import { pickPersonOnMap } from "../dialogs/RelationshipLinkDialog.js";
import { charactersInPlay } from "../utils/characters-in-play.js";
import { tripLogStore } from "../timeline/timeline-expedition-record.js";
import { currentExpedition } from "../utils/expedition-log-core.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { SYSTEM_ID } from "../system-id.js";
import { format, localize } from "../utils/i18n.js";
import { expeditionParty } from "../timeline/timeline-expedition.js";
import { recordOnTracks, timelineNow } from "../timeline/timeline-record.js";
import { SITE_VISITS_FLAG, addVisit, siteVisitMilestone } from "./site-visits-core.js";

/** Ask who went, ticking `party` to start with. Settles on an array of actor ids, or null. */
function askWhoWent(page, characters, party) {
	return pickPersonOnMap({
		options:     characters.map(actor => ({ id: actor.id, name: actor.name, actor })),
		title:       format("stonetop.sites.visit.title", { name: page.name }),
		hint:        localize("stonetop.sites.visit.hint"),
		buttonLabel: localize("stonetop.sites.visit.confirm"),
		formatManyLabel: count => format("stonetop.sites.visit.confirmMany", { count }),
		icon:        "fa-mountain-sun",
		multiple:    true,
		selected:    party.map(pc => pc.id),
	});
}

/**
 * Mark a site visited this season.
 *
 * @param {JournalEntryPage} page  The site page.
 * @returns {Promise<{season: string, year: number}|null>} When it was marked, or null if the GM
 *          backed out.
 */
export async function markSiteVisited(page) {
	if (!game.user?.isGM || !page) return null;
	const characters = charactersInPlay();
	let went = [];
	if (characters.length) {
		const trip = currentExpedition(tripLogStore().read());
		const party = trip ? expeditionParty(trip, characters) : characters;
		const picked = await askWhoWent(page, characters, party);
		if (!Array.isArray(picked)) return null;
		went = characters.filter(pc => picked.includes(pc.id));
	}
	const when = timelineNow();
	await Promise.all([
		recordOnTracks([...went, getStonetopSteadingActor()], siteVisitMilestone(page, when)),
		page.setFlag(SYSTEM_ID, SITE_VISITS_FLAG, addVisit(page.getFlag(SYSTEM_ID, SITE_VISITS_FLAG), when)),
	]);
	return when;
}
