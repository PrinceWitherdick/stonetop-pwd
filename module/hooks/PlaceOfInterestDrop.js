// Drag-a-Place-of-Interest-onto-a-scene support.
//
// Each "Places of Interest" entry on the steading Overview tab carries a lettered
// disc (A–R) and a name. Dragging that disc onto the canvas drops a map Note at the
// cursor: a matching landmark-<letter>.svg icon labelled with the place name in ink brown,
// anchored below. Its size is the one every map pin this system draws shares, which lives in
// utils/map-pins.js; whether the label shows always or on hover is one world setting over all
// of them (see hooks/StonetopNoteLabels.js).
//
// The steading sheet writes { type, letter, name } into the drag payload
// (StonetopSteadingSheet.activateListeners). This dropCanvasData hook claims that
// payload and creates the Note. Note creation is async but the hook must answer
// synchronously, so we fire-and-forget and return false to tell core we handled it.

import { SYSTEM_ID } from "../system-id.js";
import { systemAssetVariants } from "../migration/compat.js";
import { getSetting, setSetting } from "../settings.js";
import {
	MAP_PIN_FONT_SIZE, MAP_PIN_ICON_SIZE, MAP_PIN_TEXT_COLOR, mapPinNoteData, publicPinDrift,
} from "../utils/map-pins.js";
import { findPlacePage, placeNoteLink, writePlacesOfInterest } from "../utils/places-chronicle.js";

export const PLACE_OF_INTEREST_DRAG_TYPE = "StonetopPlaceOfInterest";

// Where the lettered discs live, authored once. StonetopNoteLabels recognises OUR notes by
// this path, so the writer and the reader must not be able to drift apart.
export const LANDMARK_ICON_SUFFIX = "assets/icons/landmarks";
const _ICON_DIR = `systems/${SYSTEM_ID}/${LANDMARK_ICON_SUFFIX}`;
const _FALLBACK_ICON = "icons/svg/book.svg";

// Every spelling of that folder this package has shipped under, so a pin placed before a
// system-id rename is still recognised as ours.
const _LANDMARK_ICON_DIRS = systemAssetVariants(`${LANDMARK_ICON_SUFFIX}/`);

// Pin formatting. Both numbers are map-pins.js's and are imported rather than written out again,
// which is what stops the two families from drifting the next time either moves.
//
// They are shared rather than each family's own because the village map carries BOTH, inches
// apart: its eight lettered discs and the six captions its printing letters. A disc that is a
// third larger than the pin beside it reads as an accident rather than as a distinction, and the
// distinction that does matter between them is already carried by the drawing and by when the
// name shows, not by size.
const NOTE_ICON_SIZE = MAP_PIN_ICON_SIZE;
const NOTE_FONT_SIZE = MAP_PIN_FONT_SIZE;
const NOTE_TEXT_COLOR = MAP_PIN_TEXT_COLOR;
const NOTES_CONTROL = "notes";
const SELECT_TOOL = "select";

/**
 * Map a place letter to its lettered-disc icon; anything outside A–R (there are only
 * 18 places) falls back to a generic book icon rather than a broken image.
 */
export function landmarkIcon(letter) {
	const l = String(letter ?? "").trim().toLowerCase();
	return /^[a-r]$/.test(l) ? `${_ICON_DIR}/landmark-${l}.svg` : _FALLBACK_ICON;
}

/**
 * True when this Note document is one of the map pins this system lays down: a lettered
 * place-of-interest disc, or one of the regional maps' place markers, both of which live in
 * the `landmarks` folder.
 *
 * Judged by the icon it wears rather than by a flag, so a pin dropped by hand years ago is
 * claimed alongside one the poster-map builder stamped — the same rule StonetopNoteLabels
 * uses to decide whose label to restyle, off the same suffix.
 *
 * Deliberately the WIDE test, because its callers are the ones that should be wide: making a
 * pin public (revealLandmarkNotesOnce) is right for every pin of ours. The narrow question —
 * "which lettered place is this?" — is `landmarkLetterOf`, which answers null for a marker and
 * so keeps the Chronicle-page linking to the discs it was written for.
 */
export function isLandmarkNote(noteDoc) {
	const src = noteDoc?.texture?.src;
	if (!src) return false;
	return _LANDMARK_ICON_DIRS.some((dir) => String(src).includes(dir));
}

/**
 * Which lettered place a pin already on a scene stands for, read back out of its icon —
 * `…/landmark-d.svg` → `"d"`. Null for anything that isn't one of ours.
 *
 * The letter is not stored on the note anywhere else: the drag payload carries it, but the
 * document that comes out the other end keeps only the icon and the label. Recovering it
 * from the icon is what lets a pin placed long before any of this find its page.
 */
export function landmarkLetterOf(noteDoc) {
	if (!isLandmarkNote(noteDoc)) return null;
	const match = /landmark-([a-r])\.svg$/i.exec(String(noteDoc.texture.src));
	return match ? match[1].toLowerCase() : null;
}

/**
 * Point the lettered pins already on this world's scenes at their Chronicle pages, seeding
 * the "Places of Interest" journal if the world has pins but no journal yet.
 *
 * Every load rather than once, and safe for it: a pin that HAS an entry is never touched —
 * including one a GM deliberately re-pointed at a journal of their own — so the only notes
 * this can match are ones with nothing behind them, and each stops matching the moment it
 * is linked. That is also what lets a place named into a blank letter later pick up its
 * page without anyone re-dragging the pin.
 *
 * @param {object} [io] Injected world accessors, for tests.
 * @returns {Promise<number>} How many pins were linked.
 */
export async function linkLandmarkNotes({
	scenes = globalThis.game?.scenes ?? [],
	isGM = !!globalThis.game?.user?.isGM,
	seed = writePlacesOfInterest,
	findPage = findPlacePage,
} = {}) {
	if (!isGM) return 0;

	// One pass to find the work, so a world with nothing to link never creates a journal.
	const pending = [];
	for (const scene of scenes) {
		const notes = [...(scene.notes ?? [])].filter(note => !note.entryId && landmarkLetterOf(note));
		if (notes.length) pending.push({ scene, notes });
	}
	if (!pending.length) return 0;

	const journal = await seed();
	if (!journal) return 0;

	let linked = 0;
	for (const { scene, notes } of pending) {
		const updates = [];
		for (const note of notes) {
			const page = findPage(journal, landmarkLetterOf(note));
			// No page means the letter is a blank slot on the steading sheet. Leave the pin
			// alone; naming that place later is all it takes for the next load to link it.
			if (page) updates.push({ _id: note.id, entryId: journal.id, pageId: page.id });
		}
		if (!updates.length) continue;
		await scene.updateEmbeddedDocuments("Note", updates);
		linked += updates.length;
	}
	return linked;
}

/**
 * Walk every scene's notes, collect what one pass wants changed, and write it a scene at a time.
 *
 * Three passes in this file carried their own copy of this loop, and a fourth would have copied it
 * again. What actually differs between them is two questions: which notes a pass claims, and what
 * it wants changed about one. Everything else - the empty-update skip that keeps a quiet load
 * silent, the single write per scene, the running count - is the same bargain every time.
 *
 * @param {Iterable} scenes
 * @param {(note: object) => boolean} claims  Which notes this pass owns.
 * @param {(note: object) => object} changeFor  What to write, empty when the note already agrees.
 * @returns {Promise<number>} How many notes were written.
 */
async function sweepLandmarkNotes(scenes, claims, changeFor) {
	let written = 0;
	for (const scene of scenes) {
		const updates = [];
		for (const note of scene.notes ?? []) {
			if (!claims(note)) continue;
			const change = changeFor(note);
			if (change && Object.keys(change).length) updates.push({ _id: note.id, ...change });
		}
		if (!updates.length) continue;
		await scene.updateEmbeddedDocuments("Note", updates);
		written += updates.length;
	}
	return written;
}
/**
 * Bring the lettered discs already on this world's scenes up to the current formatting.
 *
 * WHY THIS HAD TO EXIST. A disc is written once, when a GM drops a Place of Interest or when the
 * poster-map builder lays out the village, and nothing has ever gone back to one afterwards. That
 * was survivable while the discs were the only pins on their map. They are not any more: the
 * village map now carries the six captions its printing letters as well, and the two families sit
 * inches apart, so the moment either changes size the other is visibly stale on every table that
 * ran the old one. The regional markers grew a reconcile for exactly this reason and this is the
 * same bargain in smaller print.
 *
 * WHAT IT CLAIMS, AND WHAT IT LEAVES ALONE. Only the three fields that are the DESIGN: the type
 * size, the icon size and the ink. Never the position, the label or the link, which are the GM's
 * the moment they touch them, and never a note it did not put there.
 *
 * It asks `landmarkLetterOf` rather than `isLandmarkNote`, and the difference matters: the wide
 * test claims the place markers too, since both families live in the same folder, and rewriting a
 * marker's iconSize to a disc's 90 here would have this pass and the marker reconcile take turns
 * resizing the same pin on every load, forever.
 *
 * @param {object} [io] Injected world accessors, for tests.
 * @returns {Promise<number>} How many pins were brought up to date.
 */
export async function refitLandmarkNotes({
	scenes = globalThis.game?.scenes ?? [],
	isGM = !!globalThis.game?.user?.isGM,
} = {}) {
	if (!isGM) return 0;
	// Silence in the steady state is the whole budget: this runs on every load, and the sweep
	// writes nothing for a scene whose discs already agree.
	return sweepLandmarkNotes(scenes, landmarkLetterOf, note => {
		const change = {};
		if (note.fontSize !== NOTE_FONT_SIZE) change.fontSize = NOTE_FONT_SIZE;
		if (note.iconSize !== NOTE_ICON_SIZE) change.iconSize = NOTE_ICON_SIZE;
		if (note.textColor !== NOTE_TEXT_COLOR) change.textColor = NOTE_TEXT_COLOR;
		return change;
	});
}

/**
 * The Note payload for one lettered landmark pin, at scene coordinates `x`/`y`.
 *
 * The single writer of this shape. Two things place these pins — a GM dragging a Place of
 * Interest onto the canvas, and the poster-map Scene builder laying out the village map's
 * lettered places — and a pin from one must be indistinguishable from a pin from the other,
 * both to the eye and to StonetopNoteLabels, which recognises ours by the icon path. Callers
 * merge in their own `flags`.
 *
 * `entryId`/`pageId` point the pin at its Chronicle page, so clicking the disc opens what
 * the table knows about that place (see utils/places-chronicle.js). Both are optional and
 * default to an unlinked pin: a label that opens nothing still beats no pin at all, which
 * is what a player-side drop or a world with no steading yet has to fall back to.
 */
export function landmarkNoteData({ x, y, letter, name, entryId = null, pageId = null }) {
	// Everything a disc shares with the regional maps’ markers — the sizes, the ink, the tint, and
	// the pair of fields that make a pin part of the map rather than somebody’s private note — comes
	// from the one builder in utils/map-pins.js, with the reasoning. What a disc chooses for itself
	// is its lettered glyph and a name hung underneath.
	return mapPinNoteData({
		x, y, name, entryId, pageId,
		icon: landmarkIcon(letter),
		textAnchor: CONST.TEXT_ANCHOR_POINTS?.BOTTOM ?? 1,
	});
}

/**
 * Show the lettered pins already on this world's scenes to the players they were always for.
 *
 * Every pin placed before this shipped — the eight the poster-map builder lays on the village
 * map, and any a GM dragged off the steading's Places of Interest list — was written with
 * `global` unset and owned by the GM who placed it, which is precisely the combination Foundry
 * 14 reads as a private note (see landmarkNoteData). The whole village map quietly went GM-only
 * on that upgrade. This is the same two-field fix, applied to the pins already down.
 *
 * Once per world, not every load: after this a GM who deliberately hides a pin — a place the
 * party has not found yet — keeps that decision, and pins placed later are born public.
 *
 * @param {object} [io] Injected world accessors, for tests.
 * @returns {Promise<number>} How many pins were opened up.
 */
export async function revealLandmarkNotesOnce({
	scenes = globalThis.game?.scenes ?? [],
	isGM = !!globalThis.game?.user?.isGM,
	read = getSetting,
	write = setSetting,
} = {}) {
	if (!isGM || read("landmarkNotesRevealed")) return 0;

	// Which of the public pair a pin is missing is map-pins.js’s to answer, beside the constant
	// that writes it: a copy of that test which drifts from the writer is a pin that goes silently
	// GM-only on Foundry 14.
	const revealed = await sweepLandmarkNotes(scenes, isLandmarkNote, publicPinDrift);
	// Stamped only once the writes have landed: a run that throws part-way leaves the flag
	// unset, so the next load picks up the scenes it never reached.
	await write("landmarkNotesRevealed", true);
	return revealed;
}

// dropCanvasData hook: claim only our place-of-interest payload and leave every other
// drop (tokens, tiles, journal pins, other systems') to core by returning nothing.
export function onDropPlaceOfInterest(canvas, data) {
	if (data?.type !== PLACE_OF_INTEREST_DRAG_TYPE) return;
	_createPlaceNote(canvas, data);
	return false;
}

export function switchToJournalNotesControls(controls = globalThis.ui?.controls) {
	if (!controls) return;
	if (typeof controls.activate === "function") {
		return controls.activate({ control: NOTES_CONTROL, tool: SELECT_TOOL });
	}
	if (typeof controls.initialize === "function") {
		return controls.initialize({ layer: NOTES_CONTROL, control: NOTES_CONTROL, tool: SELECT_TOOL });
	}
	if (typeof controls.render === "function") {
		return controls.render({ control: NOTES_CONTROL, tool: SELECT_TOOL });
	}
}

// Core sets data.x/data.y to scene coordinates at the cursor before firing the hook,
// so the note lands where it was dropped (anchored at its centre).
async function _createPlaceNote(canvas, data) {
	const scene = canvas?.scene;
	if (!scene) return;
	if (!game.user.can("NOTE_CREATE")) {
		ui.notifications.warn("You don't have permission to create map notes on this scene.");
		return;
	}

	const name = String(data.name ?? "").trim();
	// Seeds the place's Chronicle page if this world hasn't built one yet, so the pin is
	// clickable the moment it lands. Never throws and never blocks the drop — a pin with
	// no page behind it is the old behaviour, not a failure.
	const link = await placeNoteLink(data.letter);
	const noteData = landmarkNoteData({ x: data.x, y: data.y, letter: data.letter, name, ...link });

	try {
		await scene.createEmbeddedDocuments("Note", [noteData]);
		await switchToJournalNotesControls();
		ui.notifications.info(`Placed "${name || data.letter}" on ${scene.name}.`);
	} catch (err) {
		console.error("Stonetop | Failed to create place-of-interest note", err);
		ui.notifications.error("Couldn't create the map note (see the console for details).");
	}
}
