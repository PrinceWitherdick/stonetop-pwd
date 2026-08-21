// Pointing a map pin at the book's write-up of the place it names.
//
// `module/data/travel-times.js` records a `journalId` for most of the places it knows, which is
// the id of an entry in the shipped `stonetop-journal` compendium. A scene Note cannot link a
// compendium document: `entryId` has to name a JournalEntry in THIS WORLD. The world does get
// one, because hooks/SeedCompendiums.js imports every journal pack on first load, but
// `fromCompendium` drops the compendium id on the way in and stamps `_stats.compendiumSource`
// instead. So the compendium id in our data and the world id a Note needs are two different
// strings, and this module is the bridge between them.
//
// THE PERMISSION TRAP, which is the reason this module is careful rather than three lines. Core
// decides whether a map Note is visible by testing the reader against WHAT IT LINKS TO:
//
//     const accessTest = this.document.page ?? this.document.entry;
//     const access = accessTest?.testUserPermission(game.user, "LIMITED") ?? true;
//     if ( (access === false) || ... ) return access;
//
// Every seeded gazetteer entry ships `ownership: { default: 0 }`, which is NONE. So linking a
// pin to one, and doing nothing else, does not merely fail to open anything for a player: it
// deletes the pin from their map entirely, label and all. The pins exist to put names back on an
// unlabelled map, so that is the exact opposite of the point, and it fails silently and only on
// the players' screens.
//
// The fix is to raise the WORLD copy to LIMITED, which is the least that keeps the pin on the
// map. It is deliberately not OBSERVER: these are the GM's location write-ups, and a table that
// has not reached Marshedge should not be able to read what is waiting there. A player therefore
// sees the pin and its name, and clicking it opens a journal with nothing in it, because a page
// still needs OBSERVER to be read and these pages inherit. The GM, who sees everything, gets what
// they actually asked for, which is a map where clicking a place opens the book on that place.
//
// Editing a world copy's ownership so players can reach something is an established move here,
// not a new liberty: hooks/SeedCompendiums.js `openSettingOverviewToPlayers` does the same to the
// Setting Overview, and like that one this touches the world copy only. The compendium source
// stays exactly as shipped.

import { error } from "./logger.js";
import { compendiumRefTail } from "../migration/compat.js";
import { compendiumSourceOf } from "./foundry-compat.js";
import { SYSTEM_ID, LEGACY_FLAG_SCOPES } from "../system-id.js";

/** The one shipped journal pack every gazetteer entry lives in. */
const JOURNAL_PACK = "stonetop-journal";

/** LIMITED, resolved defensively so this module is testable without Foundry's globals. */
function limitedLevel() {
	return globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.LIMITED ?? 1;
}

/**
 * The flag that records "this system has already opened this entry up once".
 *
 * ONCE is the whole of it. Raising an entry every load would mean a GM cannot ever close one
 * again: they hit the share button, set it back to NONE, and the next reload silently puts the
 * name back in every player's Journal sidebar. Nothing would say so, because the share dialog
 * tests for OBSERVER and goes on reading "hidden" at LIMITED. With this stamp the pass is a
 * one-time favour instead of a standing policy: an entry we have already opened is the GM's from
 * then on, whatever they set it to.
 */
const OPENED_FLAG = "gazetteerPinOpened";

/** Whether we have opened this entry before, under whichever scope this package shipped under. */
export function alreadyOpened(entry) {
	const flags = entry?.flags ?? {};
	return [SYSTEM_ID, ...LEGACY_FLAG_SCOPES].some(scope => !!flags?.[scope]?.[OPENED_FLAG]);
}

/**
 * The package-id-free identity of one gazetteer entry, which is how a world copy is recognised.
 *
 * Without the package id on purpose. A world seeded before the system-id rename carries a stamp
 * spelled with the old id, and it is the same entry; keying on the tail is the same rule the
 * seeder itself uses to decide it has already imported something.
 */
export function gazetteerRefTail(journalId) {
	return journalId ? `${JOURNAL_PACK}.JournalEntry.${journalId}` : null;
}

/**
 * Every world JournalEntry that came out of a compendium, keyed by that identity.
 *
 * Built once per pass rather than searched per pin: a seeded world holds a few hundred journal
 * entries and this is asked eighteen times in a row. First stamp wins, so a GM who duplicated an
 * entry gets the original rather than the copy.
 */
export function worldGazetteerIndex(journals = globalThis.game?.journal ?? []) {
	const index = new Map();
	for (const entry of journals) {
		const tail = compendiumRefTail(compendiumSourceOf(entry));
		if (tail && !index.has(tail)) index.set(tail, entry);
	}
	return index;
}

/**
 * The world JournalEntry for one of travel-times' `journalId`s, or null when this world has
 * never imported the journals (a GM who cleared them, or a world seeded with the packs off).
 * A pin with nothing to point at is left unlinked, which is a plain label and still the feature.
 */
export function worldGazetteerEntry(journalId, index) {
	const tail = gazetteerRefTail(journalId);
	return tail ? (index?.get(tail) ?? null) : null;
}

/**
 * What this pass should write to these entries, once and never again.
 *
 * Pure, and separated from the writing so the decision can be checked without a world. Every
 * entry it has not stamped yet gets a row, and the row carries the ownership only when the entry
 * is actually shut:
 *
 *   NOT STAMPED, below LIMITED  - raise it, and stamp it. The seeded default, the case the pins
 *                                 need opening for.
 *   NOT STAMPED, LIMITED+       - stamp it ALONE. Nothing to change, but the record has to say
 *                                 we have been here, or a GM who later closes this one is argued
 *                                 with on the next load. This is what a world that ran an earlier
 *                                 version of the pass looks like, and its one catch-up write.
 *   STAMPED                     - nothing, whatever it sits at now. The favour was one-time; the
 *                                 entry is the GM's from then on.
 *
 * The stamp is the whole mechanism, because "never touched, still at the seeded NONE" and
 * "deliberately shut again" are the same thing read off ownership alone.
 */
export function ownershipRaises(entries) {
	const level = limitedLevel();
	return [...new Set(entries)]
		.filter(entry => entry && !alreadyOpened(entry))
		.map(entry => (Number(entry.ownership?.default) || 0) < level
			? { _id: entry.id, "ownership.default": level, [`flags.${SYSTEM_ID}.${OPENED_FLAG}`]: true }
			: { _id: entry.id, [`flags.${SYSTEM_ID}.${OPENED_FLAG}`]: true });
}

/**
 * Raise these entries to LIMITED so a pin linked to one stays on the players' map.
 *
 * One batched write rather than a document at a time, and best effort: a pin that could not be
 * opened up is a pin we must not link, so the caller is told which entries actually made it.
 *
 * @returns {Promise<Set>} The entries a pin may now safely link to.
 */
export async function openGazetteerEntriesToPlayers(entries, { update = null } = {}) {
	const level = limitedLevel();
	// The one question that decides whether a pin may link: can a player see this at all? Asked
	// of the entry as it stands, so an entry we opened months ago and the GM has since shut is
	// read as shut. Linking to it would take the pin off their map, label and all.
	const visible = entry => (Number(entry.ownership?.default) || 0) >= level;
	const wanted = [...new Set(entries)].filter(Boolean);
	const raises = ownershipRaises(wanted);
	if (!raises.length) return new Set(wanted.filter(visible));

	// Only the rows that actually move the ownership; the stamp-only ones change nothing a pin
	// depends on, so their entries are judged by what they already are.
	const raised = new Set(raises.filter(r => "ownership.default" in r).map(r => r._id));
	const write = update ?? (data => globalThis.JournalEntry?.updateDocuments?.(data));
	try {
		await write(raises);
		return new Set(wanted.filter(entry => raised.has(entry.id) || visible(entry)));
	} catch (err) {
		error("Could not open gazetteer entries to players", err);
		// Only the ones that already passed are safe: linking a pin to an entry a player cannot
		// see would take the pin off their map, and a missing name is worse than a dead one.
		return new Set(wanted.filter(entry => !raised.has(entry.id) && visible(entry)));
	}
}
