/**
 * Phase 3 entry point: the once-per-world sweep that runs on the first launch AFTER the
 * world has been re-pointed at the renamed system.
 *
 * Deliberately not part of the bridge's own migration. Rewriting asset paths and
 * compendiumSource stamps while the OLD system is still the running one immediately
 * breaks the features that recognise their own content by those strings. Once only one
 * system has to be consistent, the sweep is safe.
 *
 * Two things here that `finishDocuments` cannot reach on its own, because neither is an
 * asset path or a compendium reference:
 *   - `core.sheetClasses`, whose stale entries actively SUPPRESS `makeDefault` on the
 *     newly registered sheets, so actors open on Foundry's generic sheet with no error.
 *   - `core.compendiumConfiguration`, keyed by `<packageId>.<packName>`, which carries the
 *     GM's per-pack lock, folder and ownership choices.
 *
 * Both are read at init, so their fix only takes effect on the next reload. That is why
 * the run finishes by asking for one.
 */

import { SYSTEM_ID } from "../system-id.js";
import { PRIOR_SYSTEM_IDS } from "./compat.js";
import { finishDocuments, residualCount, rewriteSheetClasses, rewriteCompendiumConfiguration, walkTargets } from "./finish.js";
import { allTargets } from "./run.js";
import { getSetting, setSetting } from "../settings.js";
import { isActingPrimaryGM } from "../utils/primary-gm.js";
import { progressSlice } from "../utils/progress-slice.js";
import { openProgressNotification } from "../utils/progress-notification.js";

/** Records which system id the sweep last completed for, so a later rename re-runs it. */
export const FINISH_SETTING = "idMigrationFinishedFor";

// Where the sweep's two passes sit on one bar. Both walk every document in the world, so they
// cost roughly the same to plan; the rewrite pass also writes, which is what buys it the
// larger share. Boundaries rather than widths so the pair visibly tiles 0..1 (progressSlice).
const FINISH_PHASES = {
	rewrite: [0, 0.8],
	verify:  [0.8, 1],
};

/**
 * Rewrite the two core settings that key on the package id.
 * Both are registered by core, so the normal settings API works and no document surgery
 * is needed.
 */
export async function rewriteCoreSettings(game, options = {}) {
	const changed = [];

	const sheetClasses = game?.settings?.get?.("core", "sheetClasses");
	const nextSheets = rewriteSheetClasses(sheetClasses, options);
	if (nextSheets.changed) {
		await game.settings.set("core", "sheetClasses", nextSheets.value);
		changed.push("core.sheetClasses");
	}

	const packConfig = game?.settings?.get?.("core", "compendiumConfiguration");
	const nextPacks = rewriteCompendiumConfiguration(packConfig, options);
	if (nextPacks.changed) {
		await game.settings.set("core", "compendiumConfiguration", nextPacks.value);
		changed.push("core.compendiumConfiguration");
	}

	return { changed };
}

/**
 * Count what still names an older id after the sweep, so a partial run is visible rather
 * than silent. Reports the worst offenders instead of just a total.
 *
 * Async only so it can breathe. This is a second full walk of every document in the world
 * with no writes in it, which is to say no awaits of its own: left alone it is the single
 * longest uninterrupted block of main thread in the whole run, and it lands right where the
 * bar is supposed to be finishing.
 */
export async function scanResiduals(targets, options = {}) {
	let total = 0;
	const worst = [];
	await walkTargets(targets, options.onProgress, (target) => {
		let count = 0;
		for (const doc of target.docs) {
			count += residualCount(typeof doc.toObject === "function" ? doc.toObject() : doc, options);
		}
		if (!count) return;
		total += count;
		worst.push({ label: target.label, count });
	});
	worst.sort((a, b) => b.count - a.count);
	return { total, worst: worst.slice(0, 5) };
}

/**
 * Run the sweep once per world.
 *
 * @param {object} game
 * @param {object} [options]
 * @param {Function} [options.read]      () => string|null  the completion stamp
 * @param {Function} [options.write]     (value) => Promise
 * @param {Function} [options.canRun]    () => boolean      primary-GM gate
 * @param {Function} [options.onProgress]
 */
export async function runFinishOnce(game, options = {}) {
	const {
		read, write, canRun,
		systemId = SYSTEM_ID,
		priorIds = PRIOR_SYSTEM_IDS,
		onProgress
	} = options;

	// Nothing has ever been renamed, so there is nothing to sweep.
	if (!priorIds.length) return { ran: false, reason: "no-prior-ids" };
	if (canRun && !canRun()) return { ran: false, reason: "not-primary-gm" };
	if (read && read() === systemId) return { ran: false, reason: "already-done" };

	const targets = await allTargets(game);
	const settings = await rewriteCoreSettings(game, { systemId, priorIds });
	const documents = await finishDocuments(targets, {
		systemId, priorIds, onProgress: progressSlice(onProgress, FINISH_PHASES.rewrite)
	});
	const residual = await scanResiduals(targets, {
		systemId, onProgress: progressSlice(onProgress, FINISH_PHASES.verify)
	});

	await write?.(systemId);

	return {
		ran: true,
		documents: documents.updated,
		settings: settings.changed,
		residual,
		// core.sheetClasses is consumed at init, so the sheet defaults only settle on reload.
		needsReload: settings.changed.includes("core.sheetClasses")
	};
}

/**
 * The Ready-hook entry point. Wires runFinishOnce to this world's settings and the
 * primary-GM gate, and tells the GM when a reload is needed to settle sheet defaults.
 *
 * Narrated, because this is the one wait in the system nobody chose: it is awaited on the
 * ready path before any sheet renders, and on a world that actually carries a rename it is
 * seconds of a world that looks finished loading and is not. A notification rather than a
 * window because the setup window is about to want the screen, and because most worlds settle
 * inside the bar's own delay and should never see one at all.
 */
export async function finishSystemIdMigration(game = globalThis.game) {
	const bar = openProgressNotification("Stonetop: moving this world to its new system ID");
	let result;
	try {
		result = await runFinishOnce(game, {
			read:   () => getSetting(FINISH_SETTING),
			write:  (value) => setSetting(FINISH_SETTING, value),
			// Not isPrimaryGM() alone, which is true when NO GM is connected: a lone player would run
			// the whole sweep on the awaited ready path and then fail on the world-setting write.
			canRun: isActingPrimaryGM,
			onProgress: p => bar.update(p)
		});
	} catch (err) {
		// Take the bar away rather than completing it. A sweep that died part-way leaves the
		// world half-rewritten and the completion stamp unwritten, so the next load retries it;
		// signing off with a full bar would tell the GM the opposite. Either way the bar goes,
		// because core never times a progress notification out on its own.
		bar.abandon();
		throw err;
	}
	bar.close();

	if (!result.ran) return result;

	console.log("Stonetop | system-id sweep:", JSON.stringify({
		documents: result.documents, settings: result.settings, residual: result.residual.total
	}));

	if (result.residual.total) {
		console.warn("Stonetop | system-id sweep left residual references:", result.residual.worst);
	}

	if (result.needsReload) {
		ui.notifications?.info?.("Stonetop finished moving this world to its new ID. Press F5 to reload once.", { permanent: true });
	}
	return result;
}
