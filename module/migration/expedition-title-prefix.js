// The "Expedition: " older expedition rows were written with, taken off once.
//
// An expedition's row on a timeline used to be titled "Expedition: <trip>" (the i18n key
// `stonetop.timeline.milestone.expedition`, English only). The card's kind chip already says
// Expedition, so the writer now stores the trip's name alone (timeline-expedition.js). The rows
// written before that are rewritten here, ONCE PER WORLD, rather than stripped on every read: a
// read-time strip ran forever, and took the word off a title a GM had typed that way on purpose.
//
// Only a row the expedition writer made (`source: "expedition"`, keyed `expedition:<trip>`) is
// touched. The once-only marker is a flag on the Timeline journal, as timeline-backfill.js does.

import { SYSTEM_ID } from "../system-id.js";
import { isActingPrimaryGM } from "../utils/primary-gm.js";
import { findTimelineJournal, allTracks, mutateTrack } from "../timeline/timeline-store.js";

/** The flag on the Timeline journal that says the prefix has been taken off in this world. */
export const EXPEDITION_TITLE_FLAG = "expeditionTitlePrefix";

/** What the old writer put in front of the trip's name. */
const OLD_PREFIX = /^Expedition:\s*/;

/**
 * A track's entries with the old prefix taken off every expedition row the writer made, as a
 * mutateTrack result, or null when none has it. PURE.
 */
export function withoutExpeditionPrefix(entries = []) {
	let changed = 0;
	const out = entries.map(entry => {
		if (entry?.source !== "expedition" || !String(entry.key ?? "").startsWith("expedition:")) return entry;
		if (!OLD_PREFIX.test(entry.title ?? "")) return entry;
		changed += 1;
		return { ...entry, title: entry.title.replace(OLD_PREFIX, "") };
	});
	return changed ? { entries: out, changed } : null;
}

/**
 * Take the prefix off every track's old expedition rows, once per world. Primary GM only. Marked
 * done only when every track was written, so a refused write is tried again next load.
 *
 * @returns {Promise<number>} how many tracks were rewritten
 */
export async function stripExpeditionTitlePrefixesOnce() {
	if (!isActingPrimaryGM()) return 0;
	const journal = findTimelineJournal();
	if (!journal || journal.getFlag?.(SYSTEM_ID, EXPEDITION_TITLE_FLAG)) return 0;
	const results = await Promise.allSettled(allTracks().map(track => mutateTrack(track, withoutExpeditionPrefix)));
	const failed = results.filter(r => r.status === "rejected");
	if (failed.length) {
		console.warn(`Stonetop | ${failed.length} timeline track(s) kept their "Expedition: " titles; will try again next load`, failed[0].reason);
	} else {
		await journal.setFlag(SYSTEM_ID, EXPEDITION_TITLE_FLAG, 1);
	}
	return results.filter(r => r.status === "fulfilled" && r.value).length;
}
