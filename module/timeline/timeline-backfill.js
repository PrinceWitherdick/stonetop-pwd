// THE LEVELS A CHARACTER GAINED BEFORE THE TIMELINE WAS WATCHING.
//
// The timeline records a level-up as it happens. A table that has been playing for months before
// the timeline shipped would otherwise open it to find every character's thread empty of the one
// milestone they all have. Their change ledgers DO remember: "Level changed from 2 to 3", with the
// real-world moment it happened. The season log (timeline-seasons.js, collected since long before
// the timeline was switched on) turns that moment into the season it fell in.
//
// LEVEL-UPS ONLY. They are the one kind the ledger records cleanly, with a number to key on; every
// other milestone either has no ledger line at all (a death) or one that cannot be told apart from
// bookkeeping (a wound edited, an arcanum flag rewritten).
//
// ONCE PER WORLD, and safe to repeat anyway: each row carries the same `levelup:<n>` key a live
// level-up writes, so a level the timeline already has is never written twice, whichever got there
// first. The once-only marker is a flag on the Timeline journal itself, so a world whose journal is
// rebuilt simply backfills again into the fresh one.

import { getLedgerEntries } from "../utils/ledger-core.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { isActingPrimaryGM } from "../utils/primary-gm.js";
import { format } from "../utils/i18n.js";
import { warn } from "../utils/logger.js";
import { SYSTEM_ID } from "../system-id.js";
import { readSeasonLog, seasonForTimestamp } from "./timeline-seasons.js";
import { findTimelineJournal } from "./timeline-store.js";
import { recordMilestones } from "./timeline-record.js";
import { LEVELUP_TITLE_KEY, levelUpKey } from "./timeline-milestones.js";

/** The flag on the Timeline journal that says the backfill has run in this world. */
export const BACKFILL_FLAG = "timelineBackfill";

const LEVEL_KEY = "system.attributes.level.value";
const LEVEL_TEXT = /^Level changed from (\d+) to (\d+)$/;

/** One ledger entry as a level change, or null. */
function levelChange(entry) {
	const merge = entry?.merge;
	if (merge?.kind === "numeric" && merge.key === LEVEL_KEY) {
		return { from: Number(merge.from), to: Number(merge.to) };
	}
	// Entries written before the ledger learned to merge carry only their words.
	const match = String(entry?.action ?? "").match(LEVEL_TEXT);
	return match ? { from: Number(match[1]), to: Number(match[2]) } : null;
}

/**
 * Every level a character's ledger says they gained, oldest first, one per level.
 *
 * A merged run ("Level changed from 2 to 4", two clicks folded into one line) is TWO level-ups. A
 * level that went down and back up again is gained once, at the first time it was reached: a GM
 * correcting a mis-click has not given the character a second fourth level. A decrease records
 * nothing.
 *
 * @param {Array} entries  The ledger, newest first, as the actor stores it.
 * @returns {Array<{level: number, timestamp: number}>}
 */
export function levelUpsFromLedger(entries) {
	const reached = new Map();
	const oldestFirst = [...(Array.isArray(entries) ? entries : [])].reverse();
	for (const entry of oldestFirst) {
		const change = levelChange(entry);
		if (!change || !Number.isFinite(change.from) || !Number.isFinite(change.to) || change.to <= change.from) continue;
		for (let level = change.from + 1; level <= change.to; level++) {
			if (!reached.has(level)) reached.set(level, Number(entry.timestamp) || 0);
		}
	}
	return [...reached].map(([level, timestamp]) => ({ level, timestamp })).sort((a, b) => a.level - b.level);
}

/** The milestone a level-up writes, live or backfilled: one shape, so the two share their key. */
export function levelUpMilestone(level, extra = {}) {
	return {
		source: "levelup",
		key:    levelUpKey(level),
		title:  format(LEVELUP_TITLE_KEY, { level }),
		...extra,
	};
}

/**
 * Write every character's past level-ups onto their thread, once per world.
 *
 * Primary GM only: one client does it, and only a GM can be sure of writing every character's page.
 * Each row is dated by the season log; a level gained before the log began files as undated.
 *
 * @returns {Promise<number>} How many level-ups were offered to the timeline.
 */
export async function backfillLevelUpsOnce() {
	if (!isActingPrimaryGM()) return 0;
	const journal = findTimelineJournal();
	if (!journal || journal.getFlag?.(SYSTEM_ID, BACKFILL_FLAG)) return 0;

	const log = readSeasonLog(getStonetopSteadingActor());
	const writes = [];
	for (const actor of game.actors?.contents ?? []) {
		if (actor.type !== "character") continue;
		const milestones = levelUpsFromLedger(getLedgerEntries(actor)).map(({ level, timestamp }) => {
			const when = seasonForTimestamp(log, timestamp);
			return levelUpMilestone(level, { season: when?.season ?? "", year: when?.year ?? 1, createdAt: timestamp });
		});
		if (milestones.length) writes.push([actor, milestones]);
	}
	// One page per character, so the writes go out together.
	const results = await Promise.allSettled(writes.map(([actor, milestones]) => recordMilestones(actor, milestones, { strict: true })));
	const offered = writes.reduce((sum, [, milestones]) => sum + milestones.length, 0);
	// ⚠ MARKED DONE ONLY IF EVERY WRITE LANDED. A character whose page refused the write is tried
	// again at the next load; the keys keep the ones that did land from being written twice.
	const failed = results.filter(r => r.status === "rejected");
	if (failed.length) {
		warn(`timeline backfill: ${failed.length} character(s) not written, will try again next load`, failed[0].reason);
		return offered;
	}
	await journal.setFlag(SYSTEM_ID, BACKFILL_FLAG, 1);
	return offered;
}
