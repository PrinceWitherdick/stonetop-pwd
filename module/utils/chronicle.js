// ── Chronicle journal writer (Foundry wrapper) ─────────────────────────────────
// Gathers the recorded Introductions + Spring Burst answers (and the expedition
// log), compiles them with the pure core (chronicle-core.js), and SEEDS a "The
// Chronicle" journal FOLDER holding two journals:
//   • "Player Introductions" — a page per character + the party "Let Spring Burst
//     Forth" page. OBSERVER, so players can read it.
//   • "Expeditions"          — a page per logged expedition. GM-only, since trips
//     carry GM prep alongside the record.
// (Foundry folders hold journal entries, not pages, so grouping the record into
// folders means splitting it across two entries.) Pages use the structured
// "chronicle" JournalEntryPage subtype (LocationPageModel), so their Bonds / Asked-
// of-the-others Q&A is inline-editable like a location's "In Play" questions.
//
// Seed and follow, and the journal edit wins. A page is created the first time its key appears.
// After that each save brings it up to date with what was recorded, but only where the page
// still holds exactly what we last wrote there: new answers and sections land, untouched text
// follows its source (and goes when its source is cleared), an untouched title follows a renamed
// PC or trip. Anything the GM edited, renamed or deleted in the journal stays as they left it,
// and a Q&A pair we wrote once is never written again (see mergeChronicleSections). A save never
// prunes a page on its own; deleting a trip can take its page with it when the GM ticks that box
// in the delete dialog (`deleteExpeditionChroniclePage`).

import { getSetting } from "../settings.js";
import { writePlacesOfInterest } from "./places-chronicle.js";
import { playbookSlug } from "./playbook-actors.js";
import { introductionsRoster } from "./introductions-order.js";
import { ensureChronicleJournal, seedChroniclePages, findChronicleJournal } from "./chronicle-journals.js";
import { SYSTEM_ID } from "../system-id.js";
import {
	buildChroniclePages,
	INTRODUCTIONS_JOURNAL_NAME,
	EXPEDITIONS_JOURNAL_NAME,
	EXPEDITION_PAGE_KEY_PREFIX,
} from "./chronicle-core.js";

// Shape the roster for the compiler: player characters in the order the introductions went
// around the table, with any PC that order does not mention appended in roster order, so every
// PC gets a page. See utils/introductions-order.js.
function chroniclePcs() {
	return introductionsRoster().map(a => ({
		id:           a.id,
		name:         a.name,
		playbookName: a.system?.playbook?.name ?? "",
		slug:         playbookSlug(a),
	}));
}

/**
 * Shared "Save the Chronicle" button handler for the session-zero dialogs:
 * disable the button while compiling, surface failures, then re-enable it.
 * `context` labels the error log line; `beforeSave` lets a dialog flush a pending
 * draft to its setting first (the compiler reads the persisted values).
 * Returns `true` if the save completed without error, `false` if it threw — so a
 * caller can decide whether to proceed (e.g. close its dialog).
 *
 * `keepDisabled` leaves the button disabled after a save that worked, for a button whose
 * dialog goes on to finish and close: re-enabled there, a second click lands while the
 * finish is still running and runs it twice. A failed save always re-enables it, so the
 * GM can try again. A click on a button that is already disabled (a save still running) is
 * refused.
 */
export async function saveChronicleFromButton(button, { context = "Chronicle", beforeSave, keepDisabled = false } = {}) {
	if (button?.disabled) return false;
	if (button) button.disabled = true;
	let ok = false;
	try {
		await beforeSave?.();
		await game.stonetop?.saveChronicle?.();
		ok = true;
		return true;
	} catch (err) {
		console.error(`Stonetop | ${context}: failed to save the Chronicle`, err);
		ui.notifications.error("Couldn't save the Chronicle.");
		return false;
	} finally {
		if (button && !(ok && keepDisabled)) button.disabled = false;
	}
}

// The page in `journal` with this chronicleKey: an actor's id, or an expedition's
// prefixed trip id. Matched by that stable flag, so it survives renames.
function findChroniclePage(journal, key) {
	return journal?.pages?.find(p => p.getFlag?.(SYSTEM_ID, "chronicleKey") === key) ?? null;
}

/**
 * The Chronicle page an expedition was saved to, or null. Read-only: creates no folder or
 * journal just by asking, since the delete dialog asks whether there is anything to offer.
 */
export function findExpeditionChroniclePage(tripId) {
	if (!tripId) return null;
	return findChroniclePage(findChronicleJournal(EXPEDITIONS_JOURNAL_NAME), `${EXPEDITION_PAGE_KEY_PREFIX}${tripId}`);
}

/** Remove a deleted trip's Chronicle page, when the GM asked for it. Quiet if there is none. */
export async function deleteExpeditionChroniclePage(tripId) {
	const page = findExpeditionChroniclePage(tripId);
	if (page) await page.delete();
	return !!page;
}

/**
 * Open the Chronicle ("Player Introductions") page that belongs to `actor`, jumping
 * straight to it. If the page hasn't been seeded yet, a GM gets a one-shot save to
 * create it (a save never undoes an inline edit; see the file header); a player is told it
 * isn't set up yet. A page only exists once the PC has
 * recorded introductions, so a PC with nothing recorded still gets the notice. Returns
 * true once a page is opened.
 */
export async function openChroniclePageForActor(actor) {
	if (!actor) return false;
	let journal = findChronicleJournal(INTRODUCTIONS_JOURNAL_NAME);
	let page = findChroniclePage(journal, actor.id);
	if (!page && game.user?.isGM) {
		journal = (await writeChronicle()) ?? journal;
		page = findChroniclePage(journal, actor.id);
	}
	if (!page) {
		ui.notifications?.warn?.(game.user?.isGM
			? `${actor.name} has no Chronicle page yet: record their introductions to create one.`
			: `${actor.name} doesn't have a Chronicle page yet.`);
		return false;
	}
	journal.sheet.render(true, { pageId: page.id, focus: true });
	return true;
}

// The compiled pages, split by destination journal: PC + Spring pages go to the player-readable
// introductions journal; expedition pages to the GM-only one. With the pages that have nothing in
// them now, so a page whose text was cleared at its source loses what is still ours on it. Those
// are never created.
function compileChroniclePages() {
	const expeditionLog = getSetting("expeditionAnswers") ?? {};
	const pages = buildChroniclePages({
		pcs:           chroniclePcs(),
		introAnswers:  getSetting("introductionsAnswers") ?? {},
		springAnswers: getSetting("springBurstAnswers") ?? {},
		expeditions:   Array.isArray(expeditionLog.list) ? expeditionLog.list : [],
		withEmpty:     true,
	});
	return {
		introPages: pages.filter(p => !p.key.startsWith(EXPEDITION_PAGE_KEY_PREFIX)),
		expePages:  pages.filter(p =>  p.key.startsWith(EXPEDITION_PAGE_KEY_PREFIX)),
	};
}

/**
 * Compile the recorded answers into the "The Chronicle" folder's two journals, seeding the
 * pages that don't exist yet (creating the folder/journals the first time) and bringing the
 * rest up to date wherever they still hold exactly what we last wrote: inline edits survive
 * re-saves (see the file header). Returns the Player Introductions journal (so the API can
 * open it), or the Expeditions journal when only trips have been logged. GM-only; returns
 * null when there's nothing recorded yet, or on a non-GM call. `opts.silent` suppresses the
 * info/warn toasts, for the background "live" saves the Introductions dialog fires as
 * answers are recorded. `opts.adoptLegacyKeys` is the set of page keys (actor ids) being
 * authored live right now, whose untracked (pre-hash) prose the live intro sync may refresh
 * from the current text instead of freezing (see seedChroniclePages / mergeChronicleSections).
 *
 * A live sync and a Save pressed during it cannot both create the same folder, journal or page:
 * ensureChronicleJournal makes each journal once, and seedChroniclePages queues page passes per journal.
 */
export async function writeChronicle({ silent = false, adoptLegacyKeys = null } = {}) {
	if (!game.user?.isGM) {
		if (!silent) ui.notifications?.warn?.("Only the GM can save the Chronicle.");
		return null;
	}
	// The village's places are chronicled alongside the PCs, so an EXPLICIT save picks up a place
	// the GM has since named or renamed. Its own journal, seeded from the steading rather than
	// from recorded answers, so it runs before the "nothing recorded yet" exit below and never
	// blocks the save if it fails — see utils/places-chronicle.js.
	//
	// Skipped on the silent live saves, which the Introductions dialog fires on a timer while a
	// player is still typing. This re-derives the roster from a full `game.journal` scan and
	// re-seeds up to 18 place pages, to catch something that changes maybe once a session — and
	// the ready hook and every pin placement already seed it. An autosave is not the place.
	if (!silent) {
		try { await writePlacesOfInterest(); }
		catch (err) { console.error("Stonetop | Chronicle: could not write the Places of Interest", err); }
	}

	const { introPages, expePages } = compileChroniclePages();
	const hasContent = list => list.some(p => p.sections.length);

	// A journal is made only for pages that have something to show; one that already exists is
	// still brought up to date, so a cleared answer leaves it.
	const introJournal = findChronicleJournal(INTRODUCTIONS_JOURNAL_NAME);
	const expeJournal  = findChronicleJournal(EXPEDITIONS_JOURNAL_NAME);
	const needIntro = hasContent(introPages);
	const needExpe  = hasContent(expePages);
	if (!needIntro && !needExpe && !introJournal && !expeJournal) {
		if (!silent) ui.notifications?.info?.("Nothing has been recorded for the Chronicle yet.");
		return null;
	}

	const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
	const NONE     = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;

	// OBSERVER on create only: a GM who has since closed the journal to players keeps it closed.
	// The folder is made only when a journal has to be; one that exists is written where the GM keeps it.
	// An existing one goes through ensureChronicleJournal too, which stamps a journal (and folder) seeded before
	// the stamp existed, so a rename after this save still finds them.
	const intro = introJournal || needIntro ? await ensureChronicleJournal(INTRODUCTIONS_JOURNAL_NAME, OBSERVER) : null;
	const expe  = expeJournal  || needExpe  ? await ensureChronicleJournal(EXPEDITIONS_JOURNAL_NAME, NONE) : null;
	if ((needIntro && !intro) || (needExpe && !expe)) return null;

	let created = 0, updated = 0, kept = 0;
	for (const [target, part, opts] of [
		// A PC's page follows a rename while it wears the name we gave it.
		[intro, "introPages", { followNames: true }],
		// Expedition pages follow their trip's name: every generated one starts "Expedition".
		[expe, "expePages", { renamePrefix: "Expedition" }],
	]) {
		if (!target) continue;
		// Compiled again once this journal's turn comes: a save that waited behind another must
		// write what is recorded now, not what was recorded when it was asked for.
		const result = await seedChroniclePages(target, () => compileChroniclePages()[part], { adoptLegacyKeys, ...opts });
		created += result.created;
		updated += result.updated;
		kept    += result.kept;
	}

	const parts = [];
	if (created) parts.push(`added ${created} ${created === 1 ? "page" : "pages"}`);
	if (updated) parts.push(`updated ${updated} ${updated === 1 ? "page" : "pages"}`);
	const keptNote = kept
		? `${kept} ${kept === 1 ? "section was" : "sections were"} left as edited in the journal`
		: "";
	if (!silent) {
		let message;
		if (parts.length) message = `Chronicle: ${parts.join(", ")}${keptNote ? `; ${keptNote}` : ""}.`;
		else if (keptNote) message = `Chronicle: nothing new to add; ${keptNote}.`;
		else message = "The Chronicle is already up to date: edit its pages there directly.";
		ui.notifications?.info?.(message);
	}
	return intro ?? expe;
}
