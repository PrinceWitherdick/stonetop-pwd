// Where a relationship map LIVES: one JournalEntry per map, in a folder of its own.
//
// WHY A JOURNAL ENTRY AND NOT A WORLD SETTING. The expedition log is a world setting and this map
// cannot be, because the table decided every player edits these. `Setting.canUserCreate` requires
// SETTINGS_MODIFY, which is an assistant-GM right, so a player writing a world setting is refused
// by the server no matter what the window lets them click. A document they OWN is different:
// JournalEntry inherits `update: "OWNER"` from the base document, so an entry whose default
// ownership is OWNER can be written by anybody at the table — and the server broadcasts the change
// to every other client for free, which is the whole live-repaint story with no socket of ours.
//
// THE ONE ASYMMETRY, and it is a real one: CREATING a JournalEntry needs JOURNAL_CREATE, which is
// TRUSTED by default. So a plain player can edit every map in the world and cannot make a new one.
// That is gated honestly (`canCreateRelationshipMap`) rather than papered over by quietly widening
// the permission — journal creation reaches far beyond this feature, and a system that grants it
// behind the GM's back to ship a mind map has overstepped.
//
// ── AND WHY EACH BOARD IS A PAGE ────────────────────────────────────────────────────────────────
//
// One map is several NAMED BOARDS, and each board is a JournalEntryPage of that entry carrying its
// own graph. A page is its own board outright: its own people, its own lines, its own layout. The
// same person may sit on two pages at once, in different places, with different lines drawn to
// them, because "the Millers at home" and "who owes the smith money" are different pictures and
// forcing them onto one sheet is the crowding the whole feature's views exist to escape.
//
// PAGES ARE WHERE THE ASYMMETRY ABOVE STOPS. `BaseJournalEntryPage.metadata.permissions` is
// `{create: "OWNER", delete: "OWNER"}` and update inherits "OWNER" from the base document; a page's
// own ownership is INHERIT, so `getUserLevel` defers to the entry, and the entry is owned by the
// whole table. The server tests exactly that (`canUserModify(user, "create")` on the page, with its
// parent set) — so a plain PLAYER who cannot make a new map can add, rename and delete the pages of
// every map they already have. That is not a workaround; it is the reason to store a board this way
// rather than as another object inside the entry's own flag.
//
// WHAT ELSE COMES FREE with a real document, and would otherwise have had to be built: a name that
// core validates and the sidebar search can find, a `sort` that orders the strip, a delete that is
// a delete rather than a nested `-=` inside an object-typed flag (which the two live cores disagree
// about — see utils/foundry-compat.js), and a change broadcast per board, so a table working on
// two pages at once is not repainting each other's.

import { SYSTEM_ID } from "../system-id.js";
import { localize } from "../utils/i18n.js";
import { deletionEntry } from "../utils/foundry-compat.js";
import {
	RELMAP_FLAG, RELMAP_VERSION, addEdgesPatch, addNodesPatch, edgePatch, emptyGraph, normalizeGraph,
	relmapFlagPath, relmapPath,
} from "./relmap-store.js";
import { RELMAP_PARTY_FLAG, RELMAP_PARTY_MARK, partyBoardPlan } from "./relmap-party.js";
import { RELMAP_VILLAGE_FLAG, RELMAP_VILLAGE_MARK, villageBoardPlan } from "./relmap-village.js";

/** The folder every map is filed under. Its own colour: not the Chronicle's, and not one of the
 * seeded gazetteer tints, whose signature-checked scheme is a different lane entirely. */
export const RELMAP_FOLDER_NAME = "Relationship Maps";
export const RELMAP_FOLDER_COLOR = "#7E6BA8";

/** The registered sheet id stamped onto every map so the sidebar opens the board and not a blank
 * prose entry. Kept beside the creator that writes it; the registration reads the same constant. */
export const RELMAP_SHEET_CLASS = `${SYSTEM_ID}.StonetopRelationshipMapSheet`;

/**
 * The maps folder if this world has one, or null.
 *
 * READ-ONLY, and separate from `ensure` for the reason chronicle-journals.js gives: a player
 * opening a map must never conjure a folder just by asking. `Folder.canUserCreate` is role-gated
 * on its own, so for most of the table the create would fail anyway, noisily, in the middle of
 * something else.
 */
export function findRelationshipMapFolder() {
	return (game.folders?.contents ?? [])
		.find(f => f.type === "JournalEntry" && f.name === RELMAP_FOLDER_NAME) ?? null;
}

/**
 * Find or create the maps folder.
 *
 * Returns null rather than throwing when this user may not create folders, so the caller can file
 * the map at the root instead. A map in the wrong place is a tidiness problem; a thrown error in
 * the middle of "add a map" is a broken button.
 */
export async function ensureRelationshipMapFolder() {
	const existing = findRelationshipMapFolder();
	if (existing) return existing;
	if (!globalThis.Folder?.canUserCreate?.(game.user)) return null;
	return await Folder.create({
		name: RELMAP_FOLDER_NAME, type: "JournalEntry", color: RELMAP_FOLDER_COLOR,
	}) ?? null;
}

/**
 * Every relationship map in this world.
 *
 * Found by the FLAG, not by folder membership. A GM who drags a map into another folder, or renames
 * the folder, or files it beside the front it belongs to, has not stopped it being a map — and a
 * lookup that went by folder would quietly lose it. The folder is filing, the flag is identity.
 */
export function listRelationshipMaps() {
	return (game.journal?.contents ?? [])
		.filter(entry => !!entry.getFlag?.(SYSTEM_ID, RELMAP_FLAG))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Is there a map in this world at all?
 *
 * Separate from {@link listRelationshipMaps} because the callers that only want the yes/no are on
 * a render path -- the steading sheet builds its context on every write to the actor, a season
 * turning included -- and the list pays a full walk of the journal plus a `localeCompare` sort to
 * answer a question the first hit settles.
 */
export function hasRelationshipMap() {
	return (game.journal?.contents ?? []).some(entry => !!entry.getFlag?.(SYSTEM_ID, RELMAP_FLAG));
}

/** One map by id, or null when it is not one of ours. */
export function getRelationshipMap(id) {
	const entry = game.journal?.get?.(id) ?? null;
	return entry?.getFlag?.(SYSTEM_ID, RELMAP_FLAG) ? entry : null;
}

/** May this user make a new map? Editing needs only OWNER; creating needs TRUSTED. */
export function canCreateRelationshipMap() {
	// Through globalThis, because these document classes are globals that may simply not be there:
	// this is read while a sheet builds its context, which happens on clients and in suites where
	// the world is only half up, and a bare reference throws a ReferenceError rather than answering
	// no. Nobody can create a map before JournalEntry exists, so absent means false.
	return !!globalThis.JournalEntry?.canUserCreate?.(game.user);
}

/**
 * May this user change THIS map, or THIS board of it? The question every control is gated on.
 *
 * ⚠ TAKES EITHER DOCUMENT, the way `readGraph` does and for a related reason. Asked of the ENTRY it
 * means "may I add and remove BOARDS", which is what the page strip's tools need; asked of a PAGE it
 * means "may I put people on THIS board", which is what everything on the board itself needs. They
 * are not the same question now that a board carries its own ownership, and the server answers the
 * second one: an update to a page is checked against the PAGE. A shown board inherits the map's
 * ownership, so on the ordinary map the two agree and every player who can see a board can edit it.
 * They part company the moment a GM reaches for core's own ownership dialog on a page, and a window
 * that asked only the entry would then offer a player every tool over a board whose every write the
 * server refuses.
 */
export function canEditRelationshipMap(doc) {
	return !!doc?.isOwner;
}

/**
 * Make a new map, owned by everybody, with its first page already on it.
 *
 * ONE create call carrying all five things: the mark that makes it a map, its first board, the
 * ownership that lets the table edit it, the sheet class that makes the sidebar row open the board,
 * and the folder. Written together because a map that arrives without any one of them is subtly
 * broken in a way nobody notices until a player tries to move a portrait — and a map that arrives
 * with no page at all is a board the FIRST person to open it has to conjure, which for a plain
 * player watching a GM's screen share is a window that sits blank until somebody else clicks.
 */
export async function createRelationshipMap(name) {
	if (!canCreateRelationshipMap()) return null;
	const folder = await ensureRelationshipMapFolder();
	const title = name || RELMAP_FOLDER_NAME;
	return await globalThis.JournalEntry.create({
		name: title,
		folder: folder?.id ?? null,
		ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
		pages: [mapPageData(title, emptyGraph(), 0)],
		flags: {
			core: { sheetClass: RELMAP_SHEET_CLASS },
			// The MARK, not a graph: on the entry this flag says only "this is a map". See
			// RELMAP_FLAG in relmap-store.js, which is the one place the two meanings are written
			// down together.
			[SYSTEM_ID]: { [RELMAP_FLAG]: { version: RELMAP_VERSION } },
		},
	}) ?? null;
}

/**
 * The longest a MAP may be named.
 *
 * Its own bound rather than the pages' (`RELMAP_PAGE_NAME_MAX`), because the two names are read in
 * different places and cut for different reasons: a board's name is a TAB in a strip that has to
 * hold several across one window, while a map's is a window title with a whole title bar to itself.
 * Trimmed on the way in rather than refused, as every name in this feature is: silently losing the
 * tail of a name is kinder than rejecting somebody's save.
 */
export const RELMAP_MAP_NAME_MAX = 60;

/** A map's name, made safe to store: trimmed, shortened, and never blank, since core's `name` field
 * refuses an empty one outright and would throw rather than answer. */
export function relationshipMapName(raw) {
	const want = String(raw ?? "").trim().slice(0, RELMAP_MAP_NAME_MAX).trim();
	return want || localize("stonetop.relmap.untitled");
}

/**
 * Rename a whole map.
 *
 * Gated on OWNER like every other write here, so the table can rename the map they all draw on.
 * Nothing is written for a name that came back the same, so a reader who opens the box and saves
 * without typing does not broadcast a change to everybody — the rule `renameMapPage` keeps.
 *
 * ⚠ THIS AND THE DELETE BELOW ARE HERE BECAUSE THE SIDEBAR NO LONGER OFFERS THEM. Map rows are
 * taken out of the Journal directory (hooks/journal-directory-maps.js), and renaming or deleting a
 * whole map was the one thing that list was still good for; without these two the map window would
 * be a window onto a document with no way left to name or be rid of it.
 */
export async function renameRelationshipMap(entry, name) {
	if (!entry || !canEditRelationshipMap(entry)) return false;
	const want = relationshipMapName(name);
	if (want === entry.name) return false;
	await entry.update({ name: want });
	return true;
}

/**
 * May this reader rub out a whole map?
 *
 * ⚠ A GM ALONE, AND THAT IS STRICTER THAN THE SERVER. A map is owned by the whole table so that
 * anybody may draw on it, and core's own rule for deleting a JournalEntry is that same OWNER — so
 * the server would take this delete from any player at the table. That is a fine rule for a
 * document one person made and a poor one for the shared board everybody has been drawing on all
 * campaign: one mis-aimed click by anybody, and the map every other player is looking at is gone.
 * The same asymmetry the eye keeps (`canHideMapPages`), for the same reason.
 */
export function canDeleteRelationshipMap(entry) {
	return !!entry && !!game?.user?.isGM;
}

/** Rub out a whole map, boards and all. The caller confirms with the reader; this is the rule
 * underneath that, because the confirm dialog is UI and this is not. */
export async function deleteRelationshipMap(entry) {
	if (!canDeleteRelationshipMap(entry)) return false;
	await entry.delete();
	return true;
}

// ── The pages a map is made of ──────────────────────────────────────────────────────────────────

/**
 * The longest a page may be named.
 *
 * Core would take very much more — `name` is a plain StringField — but the strip these are drawn
 * in is one row of tabs across the top of a board, and one page called after a paragraph pushes
 * every other page off the end of it. Trimmed on the way in rather than refused, exactly as a
 * link's caption is: silently losing the tail of a name is kinder than rejecting the save.
 */
export const RELMAP_PAGE_NAME_MAX = 40;

/**
 * The gap left between one page's `sort` and the next.
 *
 * Core's own spacing for sortable documents, and the reason to leave a gap at all is that a page
 * dropped between two others wants a number to land on without renumbering the strip.
 */
const PAGE_SORT_STEP = 100000;

/** Is this page one of ours, rather than a prose page somebody filed on the same entry? */
export function isMapPage(page) {
	return !!page?.getFlag?.(SYSTEM_ID, RELMAP_FLAG);
}

/**
 * A map's boards, in the order the strip draws them.
 *
 * BY THE FLAG, for the reason `listRelationshipMaps` goes by the flag: a GM is perfectly entitled
 * to file a page of ordinary prose on a map — notes about the village, a scrap of read-aloud — and
 * a strip that drew a tab for it would offer a board that is not one. What makes a page a board is
 * carrying a graph.
 *
 * SORTED BY `sort` AND THEN BY NAME. The tie-break is not decoration: `sort` is only unique because
 * this file keeps it so, and two pages created in the same second by two people at opposite ends of
 * the table can land on the same number. Object order would then differ per client, and the two
 * readers would be looking at strips in different orders while talking to each other about "the
 * third tab".
 */
export function listMapPages(entry) {
	return (entry?.pages?.contents ?? [])
		.filter(isMapPage)
		.sort((a, b) => ((Number(a.sort) || 0) - (Number(b.sort) || 0))
			|| String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

// ── Which boards the players may look at ────────────────────────────────────────────────────────
//
// A board is hidden or shown one page at a time, and it is CORE'S OWN OWNERSHIP that says which,
// rather than a flag of ours. A flag would have been a line shorter and wrong in three ways: the
// server enforces ownership and refuses a hidden board's write outright, where a flag only asks our
// own window nicely; core's journal sheet, its search and its content links all already read
// ownership, so a page our board called hidden would still turn up in the sidebar under a flag; and
// a GM who reaches for the ownership dialog on a page is entitled to have it mean what it says.
//
// HIDDEN IS `default: NONE`, AND SHOWN IS `default: INHERIT`. Shown is not OBSERVER: the map entry
// is owned by everybody at the table (see `createRelationshipMap`), and a board that inherits that
// is a board the players may EDIT, which is most of the point of a map they share. A flat OBSERVER
// would have quietly turned every board the GM revealed read-only.
//
// ⚠ THE MAKER KEEPS THEIR OWN BOARD, and it costs us nothing to arrange: core's server writes
// `ownership[creator] = OWNER` into every document as it is created, whatever the default beside it
// says. So a player pressing "+" on a map they may edit gets a board they can still see, hidden
// from the rest of the table until the GM shows it. Without that, a new page would vanish the
// instant it was made, which is the shape this defaulting would otherwise have taken for everybody
// but the GM.
//
// ⚠ AND IT IS UI-LEVEL HIDING, stated honestly here rather than discovered later. Foundry ships
// every world JournalEntry to every client in full, pages and all, and gates only what is DRAWN, so
// a determined player at a console can read a hidden board. That is true of every hidden thing in
// Foundry and is not something a system can fix from this side. It is a screen, not a vault.

/** Core's ownership numbers, with the literals behind them. Read through a function rather than
 * held at module scope because this module is loaded by suites where `CONST` is not up yet, and a
 * bare reference there throws a ReferenceError rather than answering. */
function ownershipLevels() {
	return globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS
		?? { INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
}

/**
 * Is this board hidden from the players?
 *
 * ⚠ READ OFF THE RECORDED OWNERSHIP AND NOT THROUGH `testUserPermission`, because the only reader
 * ever asked this is a GM, and a GM tests as OWNER over everything in the world. Asked the
 * permission question instead, the eye would report every board visible and the GM would have no
 * way at all to tell which ones the table can actually see.
 */
export function isMapPageHidden(page) {
	const levels = ownershipLevels();
	return (page?.ownership?.default ?? levels.INHERIT) === levels.NONE;
}

/**
 * May THIS reader look at this board?
 *
 * Fails open for a document that cannot answer: a map still on version 1 is the ENTRY itself, whose
 * own ownership has already been tested by everything that got this far.
 */
export function canSeeMapPage(page, user = undefined) {
	return page?.testUserPermission?.(user ?? game?.user, "OBSERVER") ?? true;
}

/**
 * The boards this reader may look at, in strip order.
 *
 * ⚠ THIS AND `listMapPages` ARE NOT INTERCHANGEABLE, and the split is the load-bearing part of the
 * whole feature. Everything a reader SEES goes through this one; everything the document layer
 * REASONS about goes through the raw one. `ensureFirstMapPage` asking this would find no pages on a
 * map whose every board is hidden, helpfully make a fresh one, and sweep the entry's flags on the
 * way past; `deleteMapPage`'s "never the last one" rail asking this would let the last board on a
 * map be rubbed out because the reader happened to see only one of four.
 */
export function listVisibleMapPages(entry) {
	return listMapPages(entry).filter(page => canSeeMapPage(page));
}

/** May this user hide and show boards? Only a GM. Core's own sanitizer refuses an `ownership`
 * change from anybody else outright, so the button offered to a player would be a button that
 * throws on the server; and it is the right rule on its own terms besides. */
export function canHideMapPages() {
	return !!game?.user?.isGM;
}

/**
 * Hide this board from the players, or show it to them.
 *
 * Writes nothing when the board is already the way it is being asked for, so a GM pressing the eye
 * twice does not broadcast the same state to the whole table twice over.
 *
 * ⚠ THE OBJECT AND NOT A DOTTED KEY. `ownership` is an ObjectField, whose update merges rather than
 * replaces, so this changes `default` and leaves every per-user grant beside it standing. Which
 * matters most for the grant core wrote itself: the player who made the board keeps it.
 */
export async function setMapPageHidden(page, hidden) {
	if (!page || !canHideMapPages()) return false;
	if (isMapPageHidden(page) === !!hidden) return false;
	const levels = ownershipLevels();
	await page.update({ ownership: { default: hidden ? levels.NONE : levels.INHERIT } });
	return true;
}

/** One page of a map by id, or null when it is not a board of this map, or not one this reader may
 * look at. Never falls back to another page: a caller asking for a named page and being handed a
 * different one silently is how a write meant for one board lands on another. */
export function getMapPage(entry, pageId) {
	return listVisibleMapPages(entry).find(page => page.id === pageId) ?? null;
}

/**
 * THE DOCUMENT WHOSE FLAG HOLDS THE BOARD IN FRONT OF THE READER.
 *
 * The one function the window asks, and the whole of what it has to know about pages existing: on
 * a converted map it is a page, and on a map still on version 1 it is the ENTRY itself, whose flag
 * is still a perfectly good graph. So every read and every write in the window goes through one
 * handle that is always a document, and the legacy shape needs no second code path anywhere.
 *
 * Falls back to the first page when the id names nothing, which is the honest answer to a page
 * being deleted at the far end of the table while this reader was looking at it.
 *
 * ⚠ AND ONLY EVER TO A BOARD THIS READER MAY LOOK AT. It is the reader's handle, so it walks the
 * visible strip: a player whose GM has just hidden the board under them falls through to the next
 * one they can see, exactly as they would if it had been deleted, rather than to a board that is
 * not theirs to read.
 */
export function mapBoardDoc(entry, pageId = null) {
	if (!entry) return null;
	// ONE WALK OF THE STRIP, not two. This is the handle every read and every write in the window
	// goes through, so it is asked several times per render and again on every repaint — and asking
	// `getMapPage` and then falling back to `listVisibleMapPages[0]` filtered and sorted the same
	// pages twice over each time.
	const pages = listVisibleMapPages(entry);
	return pages.find(page => page.id === pageId) ?? pages[0] ?? entry;
}

/** A page's name, made safe to store: trimmed, shortened, and never blank — core's `name` field
 * refuses a blank one outright, so a caller handing us an empty string would throw rather than
 * being told no. */
export function mapPageName(raw) {
	const want = String(raw ?? "").trim().slice(0, RELMAP_PAGE_NAME_MAX).trim();
	return want || localize("stonetop.relmap.pages.untitled");
}

/** What one page is created from. `text` because a page must be SOME core type and this is the
 * only one that needs nothing else to be valid; nobody ever renders it as prose, since the entry's
 * sheet class bounces every click straight to the board (journal/RelationshipMapEntrySheet.js).
 *
 * `marks` IS TAKEN HERE rather than merged by the caller, and that is not tidiness. A caller that
 * spells its own `flags` out overwrites this whole object, so it has to restate the graph as well
 * as its mark -- and `createPartyPage`, which did, was building the seeded graph twice over with
 * only the second copy surviving. One place builds the scope's object; a caller says what to put
 * beside the board in it.
 *
 * ⚠ A NEW BOARD IS BORN HIDDEN FROM THE PLAYERS, and this is the one place that is decided. What a
 * board is FOR is a picture the GM is still working out: who the party has not met yet, who is
 * lying to whom, which of the villagers answers to something under the hill. A board that arrived
 * shared would show all of that the moment it had a single face on it, which is the wrong way round
 * for the one control this feature adds. So every board starts as the GM's own and is shown with
 * the eye when it is ready. See the ownership section above, including why the maker keeps theirs.
 *
 * `shown: true` is for the one board that is not new: the version 1 conversion, which is moving a
 * board the table could already see and must not take it away from them. */
function mapPageData(name, graph, sort, marks = {}, { shown = false } = {}) {
	const levels = ownershipLevels();
	// ⚠ THE MAKER'S OWN GRANT IS WRITTEN HERE and not left to the server. Core's `_preCreate` adds
	// `ownership[creator] = OWNER` to a document it is handed on its own, which covers the "+" on an
	// open map; it does NOT reach a page created INSIDE its parent's create, which is how a map's
	// first board arrives (`createRelationshipMap`). Left to core, a trusted player making a map
	// would be handed one whose only board they cannot see. Spelt for every page rather than only
	// that one, so the two creation paths land on the same document. Core's sanitizer allows a
	// non-GM to set their OWN key at creation time, and only their own.
	const mine = game?.user?.id;
	return {
		name: mapPageName(name),
		type: "text",
		sort,
		ownership: {
			default: shown ? levels.INHERIT : levels.NONE,
			...(mine ? { [mine]: levels.OWNER } : {}),
		},
		flags: { [SYSTEM_ID]: { [RELMAP_FLAG]: graph, ...marks } },
	};
}

/**
 * Give a map its first page if it has none, moving whatever the entry was carrying onto it.
 *
 * THIS IS THE WHOLE OF THE VERSION 1 STORY, and it is deliberately not a world migration. A map is
 * converted the first time somebody who may edit it opens it, one map at a time, as an ordinary
 * write anybody at the table is allowed to make — so a world with forty maps pays for the two its
 * table actually uses, and a GM who never opens the rest never has them rewritten underneath them.
 *
 * IN THIS ORDER, and it matters: the page is created FIRST and the entry is stripped only once it
 * exists. The other way round, a create that failed — a lost connection, a permission lowered
 * between the two calls — would have already thrown the graph away.
 *
 * THE MARK STAYS. `listRelationshipMaps` finds every map in the world by the entry's flag being
 * truthy, so the version is written in the same update that removes the graph; an entry left with
 * an empty object, or with no flag at all, would stop being a map the moment it became one with
 * pages.
 *
 * Returns null, and writes nothing, for a reader who may not edit. They see the entry's own graph
 * instead (`mapBoardDoc` falls back to it), read-only, which is exactly what they had before.
 *
 * ONE KNOWN RACE, and it is left alone deliberately: two people opening the same version 1 map
 * within the same round trip both find no pages and both make one, so the board arrives duplicated
 * across two tabs. It costs one delete to put right, it can only happen to a map made before pages
 * existed, and it can only happen ONCE to any given map. The cure — a deterministic page id so the
 * second create is refused by the server — would leave the losing client rendering a board it
 * cannot see yet, which is a worse thing to be wrong about than a spare tab.
 */
export async function ensureFirstMapPage(entry) {
	if (!entry) return null;
	const already = listMapPages(entry);
	if (already.length) return already[0];
	if (!canEditRelationshipMap(entry)) return null;

	const carried = normalizeGraph(entry.getFlag?.(SYSTEM_ID, RELMAP_FLAG));
	// ⚠ SHOWN, AND THE ONLY BOARD IN THE SYSTEM THAT IS MADE THAT WAY. Every new board starts hidden
	// (see `mapPageData`), but this one is not new: it is the board the whole table has been looking
	// at since before pages existed, being carried onto a page underneath them. Made hidden it would
	// read as the conversion having stolen the map, and for whoever happened to open it first rather
	// than as anybody's decision.
	const made = await entry.createEmbeddedDocuments?.("JournalEntryPage", [
		mapPageData(entry.name, carried, 0, {}, { shown: true }),
	]);
	const page = made?.[0] ?? null;
	if (!page) return null;

	// The graph is on the page now, so the copy on the entry is a second truth waiting to be read
	// by something that has not heard about pages. Dropped through `deletionEntry`, because a
	// nested key inside an object-typed flag is removed differently on the two live cores and the
	// v13 spelling is silently ignored on v14 (utils/foundry-compat.js).
	await entry.update(Object.fromEntries([
		[relmapPath("version"), RELMAP_VERSION],
		deletionEntry(relmapPath("nodes")),
		deletionEntry(relmapPath("edges")),
		deletionEntry(relmapPath("shape")),
	]));
	return page;
}

/**
 * Add a board to a map.
 *
 * Gated on OWNER and nothing else — which is the point of pages being documents. A player who
 * cannot make a new MAP can make as many boards on this one as the table needs.
 *
 * Sorted AFTER the last page rather than at the end of nothing: a new page belongs on the end of
 * the strip, where the reader pressed the button, and a sort of 0 would put it at the front.
 */
export async function createMapPage(entry, name) {
	if (!canEditRelationshipMap(entry)) return null;
	// ⚠ THE FIRST BOARD BEFORE THE SECOND. A map still on version 1 has its whole board on the
	// ENTRY and no page at all, and adding a second board to it would leave `mapBoardDoc` resolving
	// to the new EMPTY page — the map would look as though pressing "New page" had swept everybody
	// off it. The window converts on open, but that can have failed (it swallows its error on
	// purpose, so a map with no page still opens readable), and this is the one call where a
	// failure downstream is destructive rather than untidy.
	await ensureFirstMapPage(entry);
	const pages = listMapPages(entry);
	const last = pages[pages.length - 1];
	const sort = (Number(last?.sort) || 0) + PAGE_SORT_STEP;
	const made = await entry.createEmbeddedDocuments?.("JournalEntryPage", [
		mapPageData(name, emptyGraph(), sort),
	]);
	return made?.[0] ?? null;
}

/** Rename one board. Nothing is written for a name that came back the same, so a reader who opens
 * the rename box and presses save without typing does not broadcast a change to the whole table. */
export async function renameMapPage(page, name) {
	if (!page) return false;
	const want = mapPageName(name);
	if (want === page.name) return false;
	await page.update({ name: want });
	return true;
}

/**
 * Rub out one board, and everything on it.
 *
 * ⚠ NEVER THE LAST ONE. A map with no pages is a map whose next opener silently converts it from
 * its own long-dead entry graph — which is empty — so deleting the last page reads as "the map
 * emptied itself". The caller confirms with the reader; this is the rail underneath that, because
 * the confirm dialog is UI and this is the rule.
 */
export async function deleteMapPage(page) {
	const entry = page?.parent ?? null;
	if (!entry || !canEditRelationshipMap(entry)) return false;
	if (listMapPages(entry).length <= 1) return false;
	await entry.deleteEmbeddedDocuments?.("JournalEntryPage", [page.id]);
	return true;
}

/**
 * A board's graph, normalized. Never trusts what it reads: see `normalizeGraph`.
 *
 * TAKES EITHER DOCUMENT, and that is not laziness. On a converted map it is handed a page; on one
 * still on version 1 it is handed the entry, and the flag it reads is the same shape either way.
 * One reader for both is what keeps the legacy map a board somebody can still look at rather than
 * a special case threaded through the window.
 */
export function readGraph(doc) {
	return normalizeGraph(doc?.getFlag?.(SYSTEM_ID, RELMAP_FLAG));
}

/**
 * Apply one patch built by relmap-store.js.
 *
 * Everything funnels through here so the failure has one voice. A write can fail for a reason the
 * reader can act on (their ownership was lowered while the window was open) and for reasons they
 * cannot, and either way the board they are looking at is now out of step with the world — so the
 * caller is told, rather than left believing the drag landed.
 */
export async function applyPatch(doc, patch) {
	if (!doc || !patch || !Object.keys(patch).length) return false;
	await doc.update(patch);
	return true;
}


/**
 * EVERY BOARD THIS SYSTEM SEATS FOR ITSELF, by the page flag that marks one: role -> flag.
 *
 * ⚠ ONE LIST, because `homeBoard` below has to be able to say "carries no board flag of ITS OWN"
 * and mean it. Spelled there as a hand-written conjunction of the two flags that happen to exist
 * today, that function keeps its stated guarantee only by somebody remembering to add a clause --
 * and the cost of the miss is the whole of Stonetop seated onto a board meant to hold six people.
 * A third board that seats itself should be a row here and nothing else.
 */
const RELMAP_SELF_SEATING = Object.freeze({
	party: RELMAP_PARTY_FLAG,
	village: RELMAP_VILLAGE_FLAG,
});

/**
 * WHICH KIND OF BOARD one page is: "party", "village", or "" for a map's own board.
 *
 * ⚠ ASKED OF THE PAGE, which is both truer and very much cheaper than looking the board up on the
 * entry. The window used to ask `getPartyPage(entry)?.id === page.id` and then the same of the
 * village — walking, filtering and re-sorting the whole strip twice over on every render and every
 * repaint, and a repaint arrives whenever anybody at the table nudges a portrait — to learn
 * something the page was carrying all along.
 *
 * Never of its NAME, for the reason `getPartyPage` gives: a board is renameable like any other, and
 * a table that calls it "Us" must not thereby lose its tools.
 */
export function mapBoardRole(page) {
	return Object.entries(RELMAP_SELF_SEATING)
		.find(([, flag]) => page?.getFlag?.(SYSTEM_ID, flag))?.[0] ?? "";
}


// ── The party's own board ───────────────────────────────────────────────────────────────────────

/** This map's party board, or null. Found by the flag and never by the name, because the page is
 * renameable like any other and a table that calls it "Us" must not get a second one. */
export function getPartyPage(entry) {
	return listMapPages(entry).find(page => page.getFlag?.(SYSTEM_ID, RELMAP_PARTY_FLAG)) ?? null;
}

/** Has this map ever been given a party board? Read off the ENTRY, so the answer survives the page
 * being deleted -- which is what makes deleting it stick. */
export function hadPartyPage(entry) {
	return !!entry?.getFlag?.(SYSTEM_ID, RELMAP_FLAG)?.[RELMAP_PARTY_MARK];
}

/**
 * Give this map its party board, or bring the one it has up to date.
 *
 * WHAT IT IS FOR, in the user's own words: "I don't want to have to manually add the party members.
 * I want them to automatically be on their own sheet named The Party." So the board makes itself,
 * seats the party on a ring, and draws an arrow for every introduction answer that names another of
 * them (relmap/relmap-party.js does the working out, and relmap/relmap-intros.js reads the
 * Chronicle).
 *
 * ⚠ IT ONLY EVER ADDS, and never on a board that has been deleted. A page that came back on the
 * next open is a page nobody can be rid of; a page that re-seated itself would throw away the
 * arrangement the table built, which is the only reason it is a page rather than a computed view.
 * See relmap/relmap-party.js, which states all three rules at length.
 *
 * RUN ON OPEN, BY WHOEVER OPENS IT, and gated on OWNER like every other write here. It writes
 * nothing at all when there is nothing new, which is nearly every open: `applyPatch` refuses an
 * empty patch, so the ordinary case costs one read of the flag.
 *
 * THE FIRST PAGE FIRST, for the reason `createMapPage` gives: a map still on version 1 keeps its
 * whole board on the ENTRY, and adding a page to it before converting would leave `mapBoardDoc`
 * resolving to the new one and the map would look as though it had been swept clean.
 *
 * @param {JournalEntry} entry
 * @param {Array<{id, uuid, name, img}>} pcs  the party, from the caller's own reader.
 * @param {Map} regards  from `introRegards`.
 * @returns {Promise<{page, addedPeople, addedLines}|null>}  null when nothing was ADDED — which
 *          includes the pass that only adopts a board's existing lines. That pass does write; what
 *          it has is nothing to say. See `adoptBareLines`.
 */
export async function syncPartyPage(entry, pcs = [], regards = new Map()) {
	if (!entry || !canEditRelationshipMap(entry)) return null;
	const party = (pcs ?? []).filter(pc => pc?.uuid);
	const page = getPartyPage(entry);

	// Nobody to put on it. A world where no character has been made yet gets no empty tab; it gets
	// one the first time somebody opens the map after there IS a party.
	if (!page && (!party.length || hadPartyPage(entry))) return null;
	if (!page) return createPartyPage(entry, party, regards);

	// Where it belongs on the strip, before anything is added to what is on it. Its own write and
	// not part of the top-up below: a map whose board is complete still wants its tab in front, and
	// this is the one thing here that has something to do on a map where nothing has changed.
	await liftPartyPage(entry, page);

	const plan = partyBoardPlan(readGraph(page), party, regards);
	// ONE WRITE for the whole top-up, as leaf paths so it merges with somebody else's concurrent
	// drag rather than replacing the `nodes` object out from under it.
	const patch = { ...addNodesPatch(plan.nodes), ...addEdgesPatch(plan.edges) };
	// The keys onto the lines that had none, in the SAME write: a board whose newcomers landed and
	// whose adoption did not is a board that would be guessed about again on the next open. See
	// `adoptBareLines`.
	for (const [id, origin] of Object.entries(plan.marks)) {
		Object.assign(patch, edgePatch(id, { origin }) ?? {});
	}
	if (!Object.keys(patch).length) return null;
	await applyPatch(page, patch);
	// ⚠ ADOPTION ALONE IS NOT NEWS. Nobody was seated and no line was drawn; what happened is that
	// the board learned which answers its existing lines came from, which is bookkeeping and would
	// otherwise reach the reader as "0 people, 0 lines" on a map they only opened.
	if (!plan.addedPeople && !plan.addedLines) return null;
	return { page, addedPeople: plan.addedPeople, addedLines: plan.addedLines };
}

/**
 * Where the party board sits on the strip: FIRST, in front of every other board.
 *
 * WHY THE FRONT. Every other board is somewhere the table went — a household, a village down the
 * road, who owes whom. This one is who the table IS, and it is the board a map is opened to look
 * at, so it is the tab the eye starts from rather than the one on the end of a strip that scrolls.
 *
 * A whole step in FRONT of the first board rather than a fixed number, so the gap between it and
 * what follows is the same gap every other pair of boards has, and a strip that has already been
 * pushed into negative numbers by this keeps stepping down instead of colliding.
 */
function partySort(pages) {
	const first = pages[0];
	return first ? (Number(first.sort) || 0) - PAGE_SORT_STEP : 0;
}

/**
 * Put the party board back at the front of a strip that has it somewhere else.
 *
 * ⚠ FOR THE MAPS THAT ALREADY HAVE ONE, which is every map made before this was decided: the board
 * used to be created on the END of the strip, so on those maps it sits behind the boards that were
 * made before it. Without this, "the party board is the first tab" would be true of new maps only,
 * and the table that has been using this since the spring would be the one it was never true for.
 *
 * IT IS NOT UNDOING AN ARRANGEMENT, which is the rule everything else about this board keeps.
 * Nothing can order the strip: `sort` is a number this file assigns at creation and there is no
 * way for a reader to drag a tab, so there is no order of anybody's to lose. If pages ever become
 * draggable, this has to go.
 *
 * Writes only when the board is not already first, so the ordinary open costs one comparison.
 */
async function liftPartyPage(entry, page) {
	const pages = listMapPages(entry);
	if (!page || pages[0]?.id === page.id) return false;
	await page.update({ sort: partySort(pages) });
	return true;
}

/**
 * The party board, made and seeded in one go, and marked on the entry so it is never made twice.
 *
 * THE MARK IS WRITTEN AFTER THE PAGE EXISTS, and that order is the same one `ensureFirstMapPage`
 * keeps for the same reason: a mark written first, followed by a create that failed, is a map that
 * believes it has a party board and will never make one.
 */
async function createPartyPage(entry, party, regards) {
	await ensureFirstMapPage(entry);
	const plan = partyBoardPlan(emptyGraph(), party, regards);
	const made = await entry.createEmbeddedDocuments?.("JournalEntryPage", [
		mapPageData(
			localize("stonetop.relmap.pages.party"),
			{ ...emptyGraph(), nodes: plan.nodes, edges: plan.edges },
			partySort(listMapPages(entry)),
			// The mark that says WHICH board this is, written in the same create as the board itself.
			{ [RELMAP_PARTY_FLAG]: true },
		),
	]);
	const page = made?.[0] ?? null;
	if (!page) return null;
	await entry.update({ [relmapPath(RELMAP_PARTY_MARK)]: true });
	return { page, addedPeople: plan.addedPeople, addedLines: plan.addedLines };
}


// ── The village's own board ─────────────────────────────────────────────────────────────────────
//
// The other board that fills itself, and the one that does it to a page the map already had. See
// relmap/relmap-village.js for the four rules it keeps, and why the ledger is one of them.

/** This map's village board, or null. By the flag and never by the name, for the reason the party
 * board's lookup gives: the page is renameable, and a table that calls it "Home" must not get a
 * second one. */
export function getVillagePage(entry) {
	return listMapPages(entry).find(page => page.getFlag?.(SYSTEM_ID, RELMAP_VILLAGE_FLAG)) ?? null;
}

/** Has this map ever been given its village? Off the ENTRY, so the answer survives the board being
 * deleted -- which is what makes deleting it stick. */
export function hadVillagePage(entry) {
	return !!entry?.getFlag?.(SYSTEM_ID, RELMAP_FLAG)?.[RELMAP_VILLAGE_MARK];
}

/**
 * The board a map is CREATED with: the first one that is not a board this system makes for itself.
 *
 * ⚠ NOT `listMapPages(entry)[0]`, WHICH IS THE PARTY'S. That board sorts to the front of the strip
 * on purpose, so "the first page" stopped meaning "the map's own board" the day it did — and a
 * village adopted onto the party's board would seat the whole of Stonetop on the one board that is
 * meant to hold six people.
 *
 * Asked as "carries no board flag of its own" rather than "is not the party's", so a third board
 * that seats itself cannot quietly become the one this adopts.
 */
function homeBoard(entry) {
	return listMapPages(entry).find(page => !selfSeating(page)) ?? null;
}

/** Does this page carry any of the marks that say a board seats itself? */
function selfSeating(page) {
	return !!mapBoardRole(page);
}

/** Who this board has been handed before. Absent, or half-written, reads as nobody. */
function villageSeated(page) {
	const seated = page?.getFlag?.(SYSTEM_ID, RELMAP_VILLAGE_FLAG)?.seated;
	return Array.isArray(seated) ? seated : [];
}

/**
 * Seat the steading's residents on this map's village board, or top up the one it has.
 *
 * WHICH BOARD, which is the whole of what is decided here: the one carrying the flag, and failing
 * that -- on a map that has never had one -- THE FIRST BOARD. That is the board every map is
 * created with and is named after the map, so on the map this was asked for it is the "Stonetop"
 * tab, and on any other map it is that map's own home board. Adoption happens once and is written
 * down, so a map cannot acquire a second village board later.
 *
 * ⚠ IT ADOPTS A BOARD THAT MAY ALREADY HAVE PEOPLE ON IT, which is the point of adopting rather
 * than making one: the residents join whoever the table has already put there, nobody is moved and
 * nobody is taken off. What it must never do is argue about somebody removed on purpose, so every
 * resident it has handed over is written down beside the graph and the automatic pass never offers
 * the same person twice. See relmap/relmap-village.js.
 *
 * RUN ON OPEN, BY WHOEVER OPENS IT, and gated on OWNER like every other write here. It writes
 * nothing at all when there is nothing new, which is nearly every open.
 *
 * @param {JournalEntry} entry
 * @param {Array<{uuid, name, img}>} people  the Residents roster, from the caller's own reader.
 * @returns {Promise<{page, addedPeople}|null>}  null when nobody was SEATED — which includes the
 *          pass that only writes the ledger down. That pass does write; what it has is nothing to
 *          say, and said out loud it is a "0 people seated" toast nobody asked for.
 */
export async function syncVillagePage(entry, people = []) {
	if (!entry || !canEditRelationshipMap(entry)) return null;
	const villagers = (people ?? []).filter(person => person?.uuid);
	// A world whose steading lists no residents yet gets no board marked and nothing written. It
	// gets its village the first time the map is opened after there IS one.
	if (!villagers.length) return null;

	const marked = getVillagePage(entry);
	// Deleted deliberately: that is an answer, and it stands.
	if (!marked && hadVillagePage(entry)) return null;
	// THE MAP'S OWN BOARD, converting a version 1 map first for the reason `createMapPage` gives:
	// such a map keeps its whole board on the ENTRY, so there is no page to adopt until it has one.
	// A map whose home board has been deleted outright adopts nothing: every board it has left is
	// one this system made for a purpose of its own.
	const page = marked ?? (listMapPages(entry).length ? homeBoard(entry) : await ensureFirstMapPage(entry));
	if (!page) return null;

	const seated = villageSeated(page);
	const plan = villageBoardPlan(readGraph(page), villagers, { seated });
	// Nothing new to seat AND nothing new to remember. The second half earns its keep on the pass
	// that adopts a board somebody had already filled in by hand: nobody is added, and what has to
	// be written down is that those residents are accounted for.
	if (!plan.addedPeople && plan.seated.length === seated.length) return null;

	// ONE WRITE for the whole thing, as leaf paths so it merges with somebody else's concurrent drag
	// rather than replacing the `nodes` object out from under it. The ledger rides along in the same
	// write, so a board cannot end up holding people it has no record of handing over.
	const patch = {
		[relmapFlagPath(RELMAP_VILLAGE_FLAG, "seated")]: plan.seated,
		...addNodesPatch(plan.nodes),
	};
	await applyPatch(page, patch);
	// THE MARK AFTER THE BOARD, the order `createPartyPage` keeps and for the same reason: a mark
	// written first, followed by a write that failed, is a map that believes it has seated its
	// village and never will.
	if (!hadVillagePage(entry)) await entry.update({ [relmapPath(RELMAP_VILLAGE_MARK)]: true });
	// ⚠ THE LEDGER GROWING ON ITS OWN IS NOT NEWS. That is the pass that adopts a board somebody had
	// already filled in by hand: nobody was seated, and what was written down is that those
	// residents are accounted for. Reported, it reaches the reader as an unprompted "0 people
	// seated" toast on a map they only opened.
	if (!plan.addedPeople) return null;
	return { page, addedPeople: plan.addedPeople };
}
