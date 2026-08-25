// Running a one-time repair sweep once per system version instead of once per world load.
//
// THE PROBLEM THIS EXISTS FOR. Every upgrade brings a repair or two — give the cards built before
// `_preCreate` stamped them a slug, bring pins laid under the old design up to the new one, fill in
// a write-up the packs gained. Each is written as a full-world scan on the primary GM's blocking
// `onReady`: every Item in the sidebar, every Note on every Scene, every embedded item on every
// Actor. Each arrived ungated, and each was justified the same way — "it is idempotent, so it needs
// no gate and is a no-op in a world that has none."
//
// Idempotent is the right property and it is not the same as free. It buys correctness on the
// second run; it does not buy the scan, which a stocked world pays on every load of every session,
// forever, to discover that there is nothing to do. Two dozen of them now run one after another
// before the UI settles.
//
// The subtler cost is that an ungated sweep RECORDS NOTHING. Nobody can later tell a repair still
// doing real work in the wild from one that has been a no-op in every world for a year, so none of
// them can safely be deleted and the list only grows. A stamped version is the difference between
// "we do not know" and "every world this system has seen is past that."
//
// KEYED BY VERSION, NOT LATCHED TO A BOOLEAN, because these are two different jobs wearing one
// shape. A true one-shot repair ("give the slugless a slug") never runs again either way. A
// bring-up-to-date pass ("pins laid before this wear the wrong marker") has to run again the next
// time the design changes — and it does, because the stamp trails the new version.
//
// STAMPED ONLY ON SUCCESS, the same bargain `reapplyBook2ArtOnVersionChange` strikes: a sweep that
// throws leaves the version unstamped and is retried on the next load rather than being written
// off. Errors are the caller's to log, since it knows what to call the thing that failed.


import { getObjectSetting, setSetting } from "../settings.js";

const SETTING = "repairSweepVersions";

/** The running system version, or "" where there is nothing to stamp against (tests, early boot). */
function systemVersion() {
	return String(globalThis.game?.system?.version ?? "");
}

/** The version `key` last completed under, or "" for never. */
export function sweepVersion(key) {
	return String(getObjectSetting(SETTING)[key] ?? "");
}

/**
 * Has this sweep already run under the version now in play?
 *
 * Exported so a caller can skip the SETUP for a sweep as well as the sweep — building the catalog
 * map or resolving the steading is often as costly as the scan it feeds.
 */
export function sweptThisVersion(key) {
	const version = systemVersion();
	return !!version && sweepVersion(key) === version;
}

/**
 * Run `work` unless it has already run under this system version, then record that it has.
 *
 * With no version to stamp against, `work` simply runs: a caller must never silently do nothing
 * because the gate could not read its own bookkeeping.
 *
 * @param {string} key       the sweep's name, stable across versions
 * @param {Function} work    the sweep. Anything it throws is re-thrown, unstamped.
 * @returns {Promise<boolean>} whether the sweep ran this time.
 */
export async function oncePerVersion(key, work) {
	const version = systemVersion();
	if (version && sweepVersion(key) === version) return false;

	await work();

	if (version) {
		const stamped = { ...getObjectSetting(SETTING), [key]: version };
		await setSetting(SETTING, stamped);
	}
	return true;
}

/** For tests and the dev loop: forget a stamp so the sweep runs again on the next load. */
export async function forgetSweep(key) {
	const stamped = { ...getObjectSetting(SETTING) };
	delete stamped[key];
	await setSetting(SETTING, stamped);
}

export const REPAIR_SWEEP_SETTING = SETTING;
