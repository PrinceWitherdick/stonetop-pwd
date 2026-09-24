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
// Seed-once: the journals are the source of truth. A page is created the first time
// its key appears; thereafter it's left alone, so inline edits stick across re-saves
// (a save never prunes a page on its own). New PCs / expeditions get new pages on the next
// save. Two exceptions, both for expedition pages and both the GM's doing: a trip renamed in the
// walkthrough has its page retitled on the next save while the page still wears the name we gave
// it, and deleting a trip can take its page with it when the GM ticks that box in the delete
// dialog (`deleteExpeditionChroniclePage`).

import { getSetting } from "../settings.js";
import { writePlacesOfInterest } from "./places-chronicle.js";
import { playbookSlug } from "./playbook-actors.js";
import { introductionsRoster } from "./introductions-order.js";
import { ensureChronicleFolder, ensureChronicleJournal, seedChroniclePages, findChronicleFolder } from "./chronicle-journals.js";
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
 */
export async function saveChronicleFromButton(button, { context = "Chronicle", beforeSave } = {}) {
	if (button) button.disabled = true;
	try {
		await beforeSave?.();
		await game.stonetop?.saveChronicle?.();
		return true;
	} catch (err) {
		console.error(`Stonetop | ${context}: failed to save the Chronicle`, err);
		ui.notifications.error("Couldn't save the Chronicle.");
		return false;
	} finally {
		if (button) button.disabled = false;
	}
}

// One of the journals inside "The Chronicle" folder ("Player Introductions",
// "Expeditions"), if it's been seeded. Read-only lookup (doesn't create anything), for
// callers that just want to jump to or check for an existing page.
function findChronicleJournal(name) {
	const folder = findChronicleFolder();
	if (!folder) return null;
	return (game.journal?.contents ?? []).find(j => j.folder?.id === folder.id && j.name === name) ?? null;
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
 * create it (writeChronicle is seed-once, so existing pages and inline edits are left
 * untouched); a player is told it isn't set up yet. A page only exists once the PC has
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

/**
 * Compile the recorded answers into the "The Chronicle" folder's two journals,
 * seeding any pages that don't exist yet (creating the folder/journals the first
 * time). Existing pages are left untouched — the journals are the source of truth, so
 * inline edits survive re-saves (see file header). Returns the Player Introductions
 * journal (so the API can open it). GM-only; returns null when there's nothing recorded
 * yet, or on a non-GM call. `opts.silent` suppresses the info/warn toasts, for the
 * background "live" saves the Introductions dialog fires as answers are recorded.
 * `opts.adoptLegacyKeys` is the set of page keys (actor ids) being authored live right
 * now, whose untracked (pre-hash) prose the live intro sync may refresh from the current
 * text instead of freezing (see seedChroniclePages / mergeChronicleSections).
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

	const expeditionLog = getSetting("expeditionAnswers") ?? {};
	const pages = buildChroniclePages({
		pcs:           chroniclePcs(),
		introAnswers:  getSetting("introductionsAnswers") ?? {},
		springAnswers: getSetting("springBurstAnswers") ?? {},
		expeditions:   Array.isArray(expeditionLog.list) ? expeditionLog.list : [],
	});
	if (!pages.length) {
		if (!silent) ui.notifications?.info?.("Nothing has been recorded for the Chronicle yet.");
		return null;
	}

	const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
	const NONE     = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;

	// Split the flat page list by destination journal: PC + Spring pages go to the
	// player-readable introductions journal; expedition pages to the GM-only one.
	const introPages = pages.filter(p => !p.key.startsWith(EXPEDITION_PAGE_KEY_PREFIX));
	const expePages  = pages.filter(p =>  p.key.startsWith(EXPEDITION_PAGE_KEY_PREFIX));

	// "The Chronicle" journal folder, holding the two journals.
	const folder = await ensureChronicleFolder();
	if (!folder) return null;

	const intro = await ensureChronicleJournal(INTRODUCTIONS_JOURNAL_NAME, folder.id, OBSERVER, { ensureObserver: true });
	const expe  = expePages.length
		? await ensureChronicleJournal(EXPEDITIONS_JOURNAL_NAME, folder.id, NONE)
		: null;

	let created = 0, updated = 0;
	for (const [target, list] of [[intro, introPages], [expe, expePages]]) {
		// Expedition pages follow their trip's name: every generated one starts "Expedition".
		const renamePrefix = target === expe ? "Expedition" : null;
		const { created: c, updated: u } = await seedChroniclePages(target, list, { adoptLegacyKeys, renamePrefix });
		created += c;
		updated += u;
	}

	const parts = [];
	if (created) parts.push(`added ${created} ${created === 1 ? "page" : "pages"}`);
	if (updated) parts.push(`updated ${updated} ${updated === 1 ? "page" : "pages"}`);
	if (!silent) ui.notifications?.info?.(parts.length
		? `Chronicle: ${parts.join(", ")}.`
		: "The Chronicle is already up to date: edit its pages there directly.");
	return intro;
}
