import { info, error } from "../utils/logger.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { WorldSetupDialog } from "../dialogs/WorldSetupDialog.js";
import { PosterMapScenesDialog } from "../dialogs/PosterMapScenesDialog.js";
import {
	needsJournalSeed, needsJournalSync, seedCompendiumJournalsOnce, restampSeededJournalSources,
	updateSeededJournalsOnVersionChange, syncSeededFolderColors, unnestSeededWorldRootOnce,
} from "./SeedCompendiums.js";
import { openProgressNotification } from "../utils/progress-notification.js";
import { needsBestiaryActorSeed, seedBestiaryActorsOnce, collapseBestiaryActorSubfoldersOnce } from "./SeedActors.js";
import { needsTreasureItemSeed, seedTreasureItemsOnce, backfillTreasureWriteups } from "./SeedItems.js";
import { reapplyBook2ArtOnVersionChange, reapplyBook2Art } from "../book2-art/reapply.js";
import { book2ArtRoot } from "../book2-art/art-root.js";
import { offerDurableArtOnce } from "../book2-art/offer-once.js";
import { posterMapScenePlan, createPosterMapScenes } from "../book2-art/poster-maps.js";

// The GM's first load of a world, narrated.
//
// A brand-new Stonetop world quietly imports ~160 journal entries, ~200 monster actors and
// 168 treasure items before it is usable. That work already ran in the background; what it
// never did was say so, which left a first-time GM staring at an empty sidebar with no idea
// whether anything was happening or whether they had broken something. This module owns
// that sequence and reports it through WorldSetupDialog.
//
// Three things run CONCURRENTLY, exactly as they did before:
//   • the journal chain — art re-apply, then the gazetteer seed, then the journal-version
//     sync and folder tidy-ups. Callers await this one (the Setting Overview and the
//     Welcome guide's premise both read from it);
//   • the bestiary actor import; and
//   • the treasure item import.
// When all three settle, a finishing pass wires any book art the GM already had on disk
// into everything that was just created, and then offers to build Scenes from the poster
// maps they already own. Both are the point of the "you should never have to re-run the PDF
// import" promise: the art folder is durable and outlives the world it was imported in, so
// a new world can and should pick it back up by itself.
//
// Everything here is best-effort. A step that throws is reported and abandoned; nothing
// downstream waits on it, and the guards that gate each seed leave their flag unset so the
// next load retries.

// One row of the setup window, and the three strings that row can show. Everything a lane
// varies by lives here, so adding a fourth library is a row plus its work function rather
// than another copy of the report/try/catch shape below.
//
// `key` is stamped on from the id below rather than restated inside each row: the two must
// agree — `runLane` narrates under the inner one while `steps`/`pendingSetupWork` select by the
// outer one — and a typo between them is silent in both directions, producing a row that simply
// never reports rather than an error.
const STEP_DEFS = Object.fromEntries(Object.entries({
	art: {
		label: "Book art you have already imported",
		starting: "Looking for book art on your disk",
		failed:   "Could not apply your book art: it will retry next load",
	},
	journals: {
		label: "Journals, gazetteer and bestiary codex",
		starting: "Reading the Stonetop compendium",
		failed:   "Could not finish importing the journals: it will retry next load",
	},
	// Not the same row as `journals`, and never shown alongside it. That one is the one-time
	// import a new world owes; this is the per-version update channel an ESTABLISHED world runs
	// forever, and on such a world it is the only thing happening. Sharing the import's row
	// would have told a GM three releases in that their world was still importing journals.
	journalSync: {
		label: "Journal updates from this release",
		starting: "Comparing your journals with the new version",
		failed:   "Could not finish updating the journals. It will retry next load.",
	},
	monsters: {
		label: "Monster sheets",
		starting: "Reading the Monsters compendium",
		failed:   "Could not finish importing the monsters: it will retry next load",
	},
	treasures: {
		label: "Treasures & Wonders",
		starting: "Reading the Treasures & Wonders compendium",
		failed:   "Could not finish importing the treasures: it will retry next load",
	},
	finish: {
		label: "Finishing touches",
		starting: "Applying your book art to the new content",
		failed:   "Could not finish applying your book art: it will retry next load",
	},
}).map(([key, def]) => [key, { key, ...def }]));

/**
 * Which one-time content imports this world still owes, so the window can list only the work
 * that is really coming — a world that already has the monsters should not be shown a
 * "Monster sheets" row that instantly ticks itself off.
 *
 * Each seed owns and exports its own guard, so this cannot drift from what will actually
 * run: a seed that gains a condition narrows its row with it.
 */
export function pendingSetupWork() {
	return {
		journals:  needsJournalSeed(),
		monsters:  needsBestiaryActorSeed(),
		treasures: needsTreasureItemSeed(),
	};
}

/**
 * Run one narrated lane: announce the step, do the work, report what it came to. `work`
 * returns the line to show on success, or a `{ skip: detail }` for "there was nothing to
 * do" — a normal outcome, not a failure.
 *
 * `work` receives a progress reporter, or UNDEFINED when the lane isn't narrated: the seeds
 * report per document through `onProgress?.(…)`, so handing them nothing means an unwatched
 * import builds no progress objects and no detail strings at all.
 *
 * Best-effort by construction: a lane that throws is logged and reported, and nothing
 * downstream waits on it. The seeds leave their flags unset on failure, so the next load
 * retries — which is what every `failed` line promises.
 */
async function runLane(dialog, { key, starting, failed }, work) {
	dialog?.start(key, starting);
	try {
		const outcome = await work(dialog ? (p => dialog.step(key, p)) : undefined);
		if (outcome?.skip) dialog?.skip(key, outcome.skip);
		else dialog?.done(key, outcome ?? "");
	} catch (err) {
		error(`World setup: the ${key} step failed`, err);
		dialog?.fail(key, failed);
	}
}

/**
 * Kick off this world's setup. GM-only; call once from the ready hook.
 *
 * Returns the promise that settles when the art re-apply and the whole journal chain are
 * done — what the ready flow keys the Setting Overview / Welcome-guide refresh off. It never
 * rejects. The imports, the finishing art pass and the poster-map offer carry on behind it;
 * nothing in the ready flow waits on those.
 */
export function runWorldSetup() {
	const pending = pendingSetupWork();
	// The version sync is the established world's equivalent of an import: it walks every
	// seeded journal on the first load after each release, which is a real wait on a world
	// that will never have a `pending` anything again. Gated separately from pendingSetupWork
	// because it answers a different question (see needsJournalSync), and suppressed while the
	// seed is pending because the seed stamps the sync's version on its way out, so the two
	// can never both have work in the same run.
	const syncingJournals = !pending.journals && needsJournalSync();
	const anyWork = pending.journals || pending.monsters || pending.treasures || syncingJournals;

	// The window only opens when there is genuinely a wait to explain. On a settled world
	// this whole module is a couple of guarded no-ops and a self-heal, and popping a
	// progress window for that would be noise.
	const steps = [
		STEP_DEFS.art,
		...(pending.journals  ? [STEP_DEFS.journals]    : []),
		...(syncingJournals   ? [STEP_DEFS.journalSync] : []),
		...(pending.monsters  ? [STEP_DEFS.monsters]    : []),
		...(pending.treasures ? [STEP_DEFS.treasures]   : []),
		STEP_DEFS.finish,
	];
	const dialog = anyWork ? WorldSetupDialog.open(steps) : null;

	// Every lane runs on every GM load, exactly as before. `pending` decides only whether the
	// lane is NARRATED — each of these chains carries one-time repairs and per-version syncs
	// (the journal update channel, the retired-folder un-nest, the Bestiary tree collapse)
	// that an already-seeded world still needs, and every call self-guards.
	const journals = runArtAndJournals(dialog, { narrateSeed: pending.journals, narrateSync: syncingJournals });
	const monsters = runLane(pending.monsters ? dialog : null, STEP_DEFS.monsters, async report => {
		// The seed is once-per-world; the collapse is a one-time repair for worlds seeded
		// under the old deep folder tree, so it has to keep running on already-seeded worlds
		// until it lands.
		await seedBestiaryActorsOnce({ onProgress: report });
		await collapseBestiaryActorSubfoldersOnce();
		return "The Bestiary folder is ready in your Actors sidebar";
	});
	const treasures = runLane(pending.treasures ? dialog : null, STEP_DEFS.treasures, async report => {
		await seedTreasureItemsOnce({ onProgress: report });
		// Then the same bargain the monsters lane strikes above: a per-load repair an
		// already-seeded world still needs. The treasures shipped for years with only their
		// tags, so every copy in an established world — sidebar and sheet alike — is missing
		// the book's write-up that a freshly-seeded one now arrives with. Fills blanks only,
		// and is silent once there are none. See backfillTreasureWriteups.
		await backfillTreasureWriteups();
		return "The treasure library is ready in your Items sidebar";
	});

	void Promise.allSettled([journals, monsters, treasures])
		.then(() => runFinishingTouches(dialog))
		.catch(err => error("World setup: the finishing pass failed", err));

	return journals;
}

// -- the three concurrent lanes ----------------------------------------------

// Book art first, then the journal chain. The order matters and always has: the re-apply
// writes the durable art onto the COMPENDIUM pages, so seeding afterwards copies
// art-bearing journals into the world in one step instead of two. Two lanes in one function
// because of that ordering; the art row is always narrated, the journal row only when there
// is a seed coming.
//
// The chain after the seed is NOT part of the seed: restamp / version-sync / un-nest /
// recolour are per-load and per-version maintenance an already-seeded world still needs,
// so they run whether or not there is anything to import.
//
// Split across two lanes rather than one because the two halves belong to different worlds: a
// fresh world does the seed and finds the sync already stamped, an established one does the
// reverse. They stay in one function, and in this order, because the order is load-bearing.
// The restamp has to precede the sync (it puts back the compendiumSource stamps the sync keys
// on), and the un-nest has to precede the recolour (which matches folders by top-level name).
async function runArtAndJournals(dialog, { narrateSeed, narrateSync } = {}) {
	await runLane(dialog, STEP_DEFS.art, async () => {
		const result = await reapplyBook2ArtOnVersionChange();
		if (!result) return { skip: "No imported book art found: you can import it later" };
		return result.total
			? `Found your book art and wired it into ${result.total} ${result.total === 1 ? "entry" : "entries"}`
			: "Your imported book art is already in place";
	});

	await runLane(narrateSeed ? dialog : null, STEP_DEFS.journals, async report => {
		await seedCompendiumJournalsOnce({ onProgress: report });
		await restampSeededJournalSources();
		return `${game.journal?.size ?? 0} journal entries are in your sidebar`;
	});

	// A seed that failed leaves `seedingComplete` unset, which is the sync's own guard, so
	// this lane no-ops rather than working against a half-imported sidebar.
	await runLane(narrateSync ? dialog : null, STEP_DEFS.journalSync, async report => {
		const sync = await updateSeededJournalsOnVersionChange({ onProgress: report });
		// These two are per-load repairs rather than part of the sync, so they run either way.
		await unnestSeededWorldRootOnce();
		await syncSeededFolderColors();
		// The sync reports a failed baseline write by leaving this version unrecorded, on
		// purpose, so the next load retries it. That is a failed step, not a finished one, and
		// the row has to say so or the GM is told a write landed that did not.
		if (!sync?.stamped) throw new Error("journal baselines were not stamped; the next load will retry");
		return "Your journals are up to date with this release";
	});
}

// -- the finishing pass -------------------------------------------------------

/**
 * Everything that has to happen AFTER the imports land:
 *
 *  1. a world-only art self-heal. The re-apply at the top of the run happened before the
 *     journals and monsters existed, so nothing it found could be written onto them. This
 *     is what actually gives a fresh world the art the GM imported in a previous one —
 *     without it they would see placeholder monster portraits and art-less journals on
 *     their first session and reasonably conclude they had to run the PDF import again.
 *     It is idempotent and near-free once everything matches, which is why the every-load
 *     GM path runs it too; and
 *  2. the poster-map offer, which is a dialog, so it waits for the progress window to be
 *     off the screen before asking anything.
 */
async function runFinishingTouches(dialog) {
	// The self-heal has just walked every durable art directory, so it already knows whether
	// the GM has any art at all — it returns null when the folder is empty. Passing that on
	// saves the map offer a browse of its own on every load of a world with no imported art.
	let artOnDisk = null;
	await runLane(dialog, STEP_DEFS.finish, async () => {
		const result = await reapplyBook2Art({ worldOnly: true, cheapWorldSkip: true });
		artOnDisk = result !== null;
		const total = result?.total ?? 0;
		return total ? `Art added to ${total} ${total === 1 ? "entry" : "entries"}` : "Everything is in place";
	});

	// Resolves once the window has actually gone (auto-close, or the GM closing it first),
	// so the map offer never lands on top of it.
	await dialog?.finish();
	await offerPosterMapScenesOnce({ artOnDisk });
}

/**
 * Offer to rebuild the poster-map Scenes from map images already on disk, once per world.
 *
 * The once-per-world rules — including "found nothing, so do not latch" — belong to
 * offerDurableArtOnce; what is local here is what counts as something to offer, and what to
 * do with the answer.
 */
export async function offerPosterMapScenesOnce({ artOnDisk = null } = {}) {
	if (!game.user?.isGM || !isPrimaryGM()) return;

	let chosen = [];
	await offerDurableArtOnce({
		setting: "posterMapScenesOffered",
		findWork: async () => {
			// The caller may already have walked the whole art folder and found it empty; there
			// is nothing to offer, and browsing again would only confirm it.
			if (artOnDisk === false) return null;
			const rows = await posterMapScenePlan(book2ArtRoot());
			// Maps that already have their Scene ride along so the GM can deliberately refresh
			// one, but a plan of nothing BUT those is not worth asking about.
			return rows.some(row => !row.hasScene) ? rows : null;
		},
		offer: async rows => { chosen = await PosterMapScenesDialog.ask(rows); },
	});
	if (!chosen.length) return;

	// Each map is a probe, a Scene write and a thumbnail render of an image up to ~28 megapixels,
	// so five of them is ten seconds or so. The setup window has already closed itself by now
	// and reopening it for a five-item job would be more furniture than the wait deserves, so
	// this rides the notification bar instead. No delay before it appears: the GM just pressed
	// the button and is watching for something to happen.
	//
	// createPosterMapScenes has always reported per map; until now nothing was listening, so
	// the only feedback was a toast that faded after five seconds while the work ran on.
	const bar = openProgressNotification(
		`Stonetop: building ${chosen.length} map scene${chosen.length === 1 ? "" : "s"}`,
		{ delayMs: 0 }
	);
	let result;
	try {
		result = await createPosterMapScenes(chosen, { onProgress: p => bar.update(p) });
	} catch (err) {
		// Take the bar away rather than completing it — close() drives it to 100% first, which
		// would sign a died-part-way run off as finished. Same contract as the id sweep's bar
		// (see migration/finish-run.js).
		bar.abandon();
		throw err;
	}
	bar.close();
	const built = result.created + result.updated;
	if (built) {
		ui.notifications?.info(`Stonetop: ${result.created} map scene${result.created === 1 ? "" : "s"} created`
			+ `${result.updated ? `, ${result.updated} refreshed` : ""}`
			+ `${result.pins ? `, ${result.pins} village pins placed` : ""}`
			+ `${result.markers ? `, ${result.markers} places marked` : ""}.`);
	}
	if (result.failures.length) {
		ui.notifications?.warn(`Stonetop: could not build a scene for ${result.failures.join(", ")}. See the console.`);
	}
	info(`Poster-map offer: ${chosen.length} chosen, ${built} scene(s) written, ${result.failures.length} failed.`);
}
