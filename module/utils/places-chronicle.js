// ── Places of Interest chronicle ───────────────────────────────────────────────
// A "Places of Interest" journal inside the shared "The Chronicle" folder, holding one
// page per named place on the steading's lettered A–R list — the same shape as the
// Player Introductions journal's page per PC, and player-readable (OBSERVER) for the
// same reason: it is the table's shared record of the village, not GM prep.
//
// The point of it is the map. A lettered pin on the village scene links to its page here
// (see hooks/PlaceOfInterestDrop.js), so clicking the disc marked D opens what the party
// knows about the Cistern. Before this the pins were labels and nothing more.
//
// Pages are seeded, never overwritten: the six places the book names open with the
// gazetteer's own paragraph, and once the GM writes into a section it stops syncing (the
// prose-hash rule in mergeChronicleSections). A place the GM invents gets a page with just
// its map letter, ready to be written into.
//
// Seeded from the LIVE steading, so a renamed or newly-named place gets its page on the
// next pass. Keyed by LETTER rather than name — the letter is the slot, the name is what
// the GM happens to be calling it this season — so renaming a place keeps its page and
// everything written on it.

import { escHtml } from "./strings.js";
import { villagePlaceBlurb } from "../data/village-places.js";
import { ensureChronicleFolder, ensureChronicleJournal, seedChroniclePages, findChronicleFolder } from "./chronicle-journals.js";
import { getStonetopSteadingActor } from "./world.js";
import { STEADING_DEFAULTS } from "../actors/steading/StonetopSteading.js";
import { resolvedFlagProperty } from "../actors/character/StonetopFlags.js";
import { SYSTEM_ID } from "../system-id.js";

export const PLACES_JOURNAL_NAME = "Places of Interest";

// Stable per-page key: the map letter, which is the slot a place occupies whatever it is
// currently called. Matches the shape of the other Chronicle keys (see chronicle-core.js).
export const PLACE_PAGE_KEY_PREFIX = "place:";

// The seeded world journal a place page points at for the rest of the village's detail.
const VILLAGE_JOURNAL_NAME = "The Village of Stonetop";

// Sections sit in the opening "act" so the page sheet draws no act banner, matching the
// Chronicle's other pages.
const SECTION_GROUP = "glance";

/** The page key for the place at `letter`. */
export function placePageKey(letter) {
	return `${PLACE_PAGE_KEY_PREFIX}${String(letter ?? "").trim().toLowerCase()}`;
}

/**
 * The steading's lettered places, as `{ letter, name }` — the live list if this world has
 * a steading, else the printed defaults, so the pages can be built before session zero.
 */
export function steadingPlaces(steading = getStonetopSteadingActor()) {
	const stored = steading ? resolvedFlagProperty(steading, "steading")?.places : null;
	return (Array.isArray(stored) && stored.length ? stored : STEADING_DEFAULTS.places)
		.map(place => ({ letter: String(place?.letter ?? "").trim(), name: String(place?.name ?? "").trim() }))
		.filter(place => place.letter);
}

/**
 * Compile the place pages. Pure — `places` is any `[{letter, name}]` and `villageLink` is
 * the ready-made "read more" HTML (or "") — so the whole shape is unit-testable without a
 * world.
 *
 * A place with no name is skipped: a blank letter is an empty slot on the sheet, not a
 * place, and seeding a page for one would put twelve untitled entries in a journal the
 * players read.
 *
 * @returns {Array<{key, name, sections}>} in the sheet's own letter order.
 */
export function buildPlacePages(places = [], { villageLink = "" } = {}) {
	return places
		// Trimmed here rather than trusted from the caller: a row typed into and cleared
		// again leaves a whitespace name behind, which is an empty slot, not a place.
		.map(place => ({ letter: String(place?.letter ?? "").trim(), name: String(place?.name ?? "").trim() }))
		.filter(place => place.letter && place.name)
		.map(place => {
			const letter = place.letter;
			const blurb = villagePlaceBlurb(place.name);
			// The map line is always true and always worth having: it is what ties the page
			// back to the disc someone just clicked. The book's paragraph follows it when the
			// gazetteer describes this place, and the pointer to the full village entry only
			// when it does — an invented place has nothing to read on over there.
			const body = `<p>Marked <strong>${escHtml(letter.toUpperCase())}</strong> on the village map.</p>`
				+ blurb
				+ (blurb ? villageLink : "");
			return {
				key: placePageKey(letter),
				name: place.name,
				sections: [{ kind: "prose", heading: "Overview", group: SECTION_GROUP, body }],
			};
		});
}

/**
 * A `@UUID` link to this world's seeded "The Village of Stonetop" journal, or "" when it
 * has not been seeded (or the reader cannot see it) — in which case the page simply ends
 * after the book's paragraph rather than offering a link that resolves to nothing.
 */
function villageJournalLink() {
	const journal = game.journal?.find(j => j.name === VILLAGE_JOURNAL_NAME) ?? null;
	if (!journal) return "";
	// Bolded like every other crosslink we write (see gazetteer-linkify): a link reads as a
	// link in our journals because it is bold, not because of its colour.
	return `<p>More about the village: <strong>@UUID[JournalEntry.${journal.id}]{${VILLAGE_JOURNAL_NAME}}</strong></p>`;
}

/** Find (or create) the "Places of Interest" journal in the Chronicle folder. GM-only. */
async function ensurePlacesJournal() {
	const folder = await ensureChronicleFolder();
	if (!folder) return null;
	return ensureChronicleJournal(
		PLACES_JOURNAL_NAME, folder.id, CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER, { ensureObserver: true }
	);
}

/**
 * Seed (and top up) the Places of Interest journal from the steading's current list, and
 * return it. GM-only; returns null for anyone else, and for a world whose steading has no
 * named places at all.
 *
 * Idempotent and cheap to re-run: seedChroniclePages creates only the keys that are
 * missing and refreshes only prose still untouched by the GM, so this can ride the ready
 * flow and every pin placement without ever undoing someone's writing.
 */
export async function writePlacesOfInterest() {
	if (!game.user?.isGM) return null;
	const pages = buildPlacePages(steadingPlaces(), { villageLink: villageJournalLink() });
	if (!pages.length) return null;

	const journal = await ensurePlacesJournal();
	if (!journal) return null;
	await seedChroniclePages(journal, pages);
	return journal;
}

/** The already-seeded Places of Interest journal, or null. Read-only — creates nothing. */
export function findPlacesJournal() {
	const folder = findChronicleFolder();
	if (!folder) return null;
	return (game.journal?.contents ?? []).find(j => j.folder?.id === folder.id && j.name === PLACES_JOURNAL_NAME) ?? null;
}

/** The page in `journal` for the place at `letter`, matched by its stable key. */
export function findPlacePage(journal, letter) {
	const key = placePageKey(letter);
	return journal?.pages?.find(p => p.getFlag?.(SYSTEM_ID, "chronicleKey") === key) ?? null;
}

/**
 * The `{ entryId, pageId }` a lettered pin should link to, seeding the journal first if
 * this world has not built it yet. Returns `{}` — a pin with no page behind it, exactly as
 * before — for a player (who may not create journals), for a letter with no named place,
 * or if anything goes wrong: a map note must still land even when its page cannot.
 */
export async function placeNoteLink(letter) {
	try {
		let journal = findPlacesJournal();
		let page = findPlacePage(journal, letter);
		if (!page && game.user?.isGM) {
			journal = (await writePlacesOfInterest()) ?? journal;
			page = findPlacePage(journal, letter);
		}
		return page ? { entryId: journal.id, pageId: page.id } : {};
	} catch (err) {
		console.error("Stonetop | could not resolve the Chronicle page for a place pin", err);
		return {};
	}
}
