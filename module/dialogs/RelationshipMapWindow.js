// One relationship map, open.
//
// The board is a fixed-size virtual sheet the reader pans and zooms as a whole
// (utils/zoom-pan-surface.js); the portraits, the lines and the labels are all positioned in
// percentages of it (utils/relmap-geometry.js); and the data is a flag on a JournalEntry every
// player owns (relmap/relmap-doc.js), so a change one person makes reaches everyone else's open
// window through Foundry's own document broadcast with no socket of ours.
//
// WHAT THIS FILE IS CAREFUL ABOUT, in one place, because both are easy to get wrong and neither
// fails loudly:
//
//  • A live update NEVER re-renders the Application. It repaints the board's markup and swaps it
//    in. A render would re-fit the board and throw away the corner the reader had zoomed into,
//    which is the exact state they were using when somebody else's change arrived.
//  • A live update that lands mid-drag, or mid-edit of a label, is BUFFERED rather than applied.
//    Repainting under a drag replaces the element the pointer is holding.

import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { themedDialogClasses } from "../utils/window-theme.js";
import { escHtml } from "../utils/strings.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { openingSize } from "../utils/opening-size.js";
import { getDragEventData, renderTemplate } from "../utils/foundry-compat.js";
import { openLinkedActorSheet } from "../utils/actor-link.js";
import { documentPortraitFrame, portraitOrNone } from "../utils/portrait-frame.js";
import { format, localize } from "../utils/i18n.js";
import { SYSTEM_ID } from "../system-id.js";
import { ZoomPanSurface } from "../utils/zoom-pan-surface.js";
import { wireRelmapDrag } from "../utils/relmap-drag.js";
import {
	RELMAP_BOARD_ASPECT, RELMAP_BOARD_WIDTH, RELMAP_CAPTION_FLOOR_PX, RELMAP_CAPTION_PX,
	ROUTE_HEAD_PATH, ROUTE_HEAD_VIEWBOX,
	boardMetrics,
	captionRoomPx, captionSize, clampPct, clearanceBow, curveWithGap, edgeArrowheads, edgeBow,
	edgeCurve, edgeLabelAnchor, freeSpot, spreadLabels,
} from "../utils/relmap-geometry.js";
import {
	RELMAP_DASHES, RELMAP_DASH_DEFAULT, RELMAP_DIRS, RELMAP_FLAG, RELMAP_INKS, RELMAP_LABEL_MAX,
	RELMAP_SIZES, RELMAP_SIZE_MAX, RELMAP_SIZE_MIN,
	addEdgePatch,
	addNodePatch, addNodesPatch, dropEdgePatch, dropNodePatch, edgePatch, fanIndexes,
	nodePatch, seatArrivals, takenSpots,
} from "../relmap/relmap-store.js";
import { RELMAP_INK_ACROSS, RELMAP_INK_PRESETS, inkPaint, normalizeHex }
	from "../relmap/relmap-ink.js";
import { rememberBoard } from "../relmap/relmap-last.js";
import { penFor, rememberPen } from "../relmap/relmap-pen.js";
import { getLastSize, rememberSize } from "../relmap/relmap-size.js";
import {
	describeWrite, forgetHistory, historyFor, stepPatch,
} from "../relmap/relmap-history.js";
import { RelmapTieBar, TIE_DIR_ICONS } from "../utils/relmap-tie-bar.js";
import { hasOwnRingArt, partyCharacters } from "../utils/playbook-actors.js";
import {
	applyPatch, canDeleteRelationshipMap, canEditRelationshipMap, canHideMapPages, createMapPage,
	deleteMapPage, deleteRelationshipMap,
	ensureFirstMapPage, getMapPage, isMapPageHidden, listMapPages, listVisibleMapPages, mapBoardDoc,
	mapPageName, readGraph, relationshipMapName, renameMapPage, renameRelationshipMap,
	setMapPageHidden, syncPartyPage, syncVillagePage,
} from "../relmap/relmap-doc.js";
import { steadingListActors } from "../actors/steading/steading-people.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { introRegards } from "../relmap/relmap-intros.js";
// ⚠ NOTHING FROM relmap-intro-match.js OR IntroMatchDialog.js. "Match answers to people" was a
// button in this window and is gone; what it wrote (the recorded introduction answers, and the
// player characters' own flags) is no longer reachable from a map.
import { getObjectSetting } from "../settings.js";
import { playbookSlug } from "../utils/playbook-slug.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { pickPersonToAdd, pickPersonToLink } from "./RelationshipLinkDialog.js";
import { promptForText } from "./content-picker.js";

// Plain literals, not built from SYSTEM_ID: tests/templates/partial-registration.test.js proves
// every precached template is actually reached by finding its PATH in the JS, and an interpolated
// one is a path that appears nowhere in the source for it to find.
const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/relationship-map.hbs";
const BOARD_PARTIAL = "systems/stonetop-pwd/templates/dialogs/partials/relationship-map-board.hbs";

/** How long a burst of remote writes is allowed to coalesce before the board repaints. */
const SYNC_DEBOUNCE_MS = 50;

/**
 * What one wheel notch multiplies the board's zoom by, and it is DELIBERATELY GENTLER than the
 * shared `ZOOM_STEP` the picture viewer uses (user, 2026-09-07).
 *
 * The two are doing different jobs. A flowchart is READ: the reader wants it fitted or wants it
 * legible, those are the only two sizes that matter, and a fifth a notch gets between them in a
 * handful of turns. This board is ARRANGED. A GM sizing it to place one portrait beside another,
 * or to bring a corner of a forty-person web to a size they can read the captions on, is aiming at
 * a particular size -- and at a fifth a notch there is no notch that lands on it: the board goes
 * from a little too small to a lot too big and back, which is exactly the complaint.
 *
 * Under a tenth a notch, so it takes roughly two and a half turns of the wheel to do what one used
 * to. The travel is still there for anyone crossing the whole range -- fit to full size is a dozen
 * or so notches, which is one unhurried flick -- and a wheel that is nudged rather than spun now
 * nudges. Fractional deltas (`wheelNotches`) make a trackpad finer still.
 */
const RELMAP_ZOOM_STEP = 1.08;

/**
 * The size, ON SCREEN, that the held line's caption is kept at while the board is zoomed out.
 *
 * The tie bar has no text box on it: what a reader is typing shows on the LINE. A board fitted
 * whole into the window sits under `RELMAP_CAPTION_FLOOR_PX`, which is the zoom the map opens at --
 * so without this, clicking a line on a forty-person map and typing would put the words somewhere
 * three pixels tall. The rest of the board's captions are painted at that zoom too, at whatever
 * size the board is showing them; this is only the one the reader is writing on, held at a size
 * they can actually read it back at. See `_paintCaptionZoom` and `_sayLine`.
 */
const CAPTION_READ_PX = 13;

/**
 * How long after the last arrow key a nudge is written.
 *
 * A held arrow repeats about thirty times a second. Writing each one is thirty document
 * updates, each a round trip broadcast to every client, each repainting the board on all of
 * them — and each repaint replaces the very button the reader is holding the key on, so the
 * focus they were nudging from is gone mid-press. The portrait moves on every key; the
 * document learns about it once the reader stops.
 */
const NUDGE_COMMIT_MS = 250;

/**
 * How many colours of the table's own the palette keeps a slot for.
 *
 * ⚠ IT IS A LIMIT ON THE PALETTE AND NOT ON THE BOARD. A map may be drawn in thirty colours nobody
 * named and every one of them keeps being drawn; this is how many the last row of the palette
 * offers back, and it is `RELMAP_INK_ACROSS` because every block in that palette is laid out at one
 * width -- which is what lets one arrow-key stride carry a reader down through all three. The ones
 * past it are still on the board, still readable, and still reachable through the picker.
 *
 * ⚠ AND FEWER OF THEM REACH IT NOW THAN THE NUMBER SUGGESTS. `_paintCustoms` keeps out any colour
 * the preset grid above already offers, so this row holds only what somebody typed for themselves.
 *
 * ⚠ AND THE SLOTS ARE RENDERED, which is why this is a fixed number rather than however many there
 * happen to be. `RelmapTieBar` writes onto markup a render left standing -- the house rule for
 * every panel over this board -- so the row is printed once and filled in.
 */

/**
 * Which children of the viewport a LEFT press must NOT start a pan from.
 *
 * ⚠ THIS LIST IS THE WHOLE OF WHAT MAKES A CONTROL CLICKABLE IN HERE. A press the surface does not
 * recognise takes a pointer capture, and that capture retargets the later click at the viewport, so
 * the delegated handler never sees it and the control is dead on a dead-centre click that never
 * moved a pixel (utils/zoom-pan-surface.js explains it at length). Anything clickable added inside
 * the viewport has to be named here — including `[data-relmap-action]`, which is in the viewport
 * because the panel that covers an empty board carries a button: "Add someone". That is the press
 * somebody meeting a map that looks broken reaches for, so it is the last one that may quietly do
 * nothing.
 */
const BOARD_CONTROLS =
	"[data-relmap-node], [data-relmap-handle], [data-relmap-remove], [data-relmap-edge], "
	+ "[data-relmap-hit], [data-relmap-open], [data-relmap-action], .stonetop-relmap-tiebar";

/**
 * And which of them a RIGHT press must not start one from either.
 *
 * THE RIGHT BUTTON DRAGS THE BOARD FROM ANYWHERE, which is why this list is nearly empty and the
 * one above is not (user, 2026-09-06: a press aimed at open paper lands on a line, and the board
 * will not move). The lines are the reason: they are laid across the whole diagram and every one of
 * them is a control, so on a crowded map there is barely any paper left to take hold of. A right
 * press asks none of that. It also risks none of it — the retargeting the list above exists to
 * avoid spoils a `click`, and a right press does not make one.
 *
 * WHAT IS LEFT IS THE ONE THING THAT IS NOT THE BOARD. The tie bar floats OVER the diagram on a
 * strip of chrome, and a reader pressing it is aiming at its buttons and its palette: sliding the
 * board out from under that press would move the very thing they were reading while they chose. So
 * the bar refuses the drag, and everything actually drawn on the board gives way to it.
 */
const BOARD_MENUS = ".stonetop-relmap-tiebar";

/**
 * WHAT EACH BUTTON ON THE BAR DOES, AND WHETHER IT IS AN EDIT.
 *
 * A TABLE RATHER THAN A CHAIN, because the permission gate used to be POSITIONAL: a tool was gated
 * by being written below `if (!this.canEdit) return;` and ungated by being written above it, and
 * nothing at the moment a tool was added said which side it belonged on. A tool put on the wrong
 * side is silently gated or silently ungated, and no reader of the code -- and no test -- can tell
 * a button placed there on purpose from one placed there by accident.
 *
 * ONE OF THEM IS NOT AN EDIT and says so outright. It touches nothing in the document: it decides
 * whether the words along the lines are drawn for a moment, which belongs to the reader rather
 * than to the map, and the person most in need of turning a hundred captions down is exactly the
 * player who may only read it.
 */
const TOOLS = Object.freeze({
	hidelabels: { needsEdit: false, run: (app, button) => app._toggleLabels(button) },
	// AND THE OTHER ONE THAT IS NOT AN EDIT. Opening a board in a window of its own writes
	// nothing anywhere, and a reader who may only look wants it more than anybody: they cannot
	// move a portrait to see what is under it, so all they have is more room. Rendered only on a
	// surface that has somewhere to pop out FROM (see `canPopOut`), which today is the steading
	// sheet's tab -- a window offering to open itself would be a button that flashes and does
	// nothing.
	popout: { needsEdit: false, run: app => app._popOut() },
	// ⚠ NO "BRING THE PARTY IN" AND NO "BRING THE VILLAGE IN". Both boards still fill themselves on
	// open; what is gone is the pair of buttons that asked for the same pass out loud. They were two
	// controls for something the map already has two plainer answers to -- drag somebody on, or press
	// "Add someone" -- and a bar of tools is worth more when every button on it does something the
	// others do not. The seating passes that remain (`_syncPartyPage`, `_syncVillagePage`) are
	// therefore automatic ONLY, which is why the primary-GM guard on them is now unconditional.
	// ⚠ NO "matchintros". A GM-only button stood in this table and wrote the recorded introduction
	// answers onto the people they were about — an edit twice over, and neither half of it the map:
	// a world setting, and the player characters' own flags. It is gone from the window, and so is
	// the entry that ran it, which is why nothing here reaches relmap-intro-match.js any more.
	// TAKING A CHANGE BACK, AND PUTTING IT FORWARD AGAIN. Behind the editing gate, obviously. They
	// reverse whatever the reader last did on this board, wherever they did it, and they say out
	// loud what they took back. See `_stepHistory`.
	undo: { needsEdit: true, run: app => app._stepHistory("back") },
	redo: { needsEdit: true, run: app => app._stepHistory("forward") },
	add: { needsEdit: true, run: app => app._addPerson() },
	// ⚠ NO "droppulled", AND NO "hidepulled" EITHER. Everything the old "Pull in ratings" button
	// left behind is read the way every other line on the board is read now: rubbed out one at a
	// time from the tie bar, with undo behind it. What the checkbox under the board does instead is
	// turn the WORDS off, which is the thing a hundred lines of any origin make unreadable.
	// THE PAGE STRIP'S FOUR, and all four are edits — they make, show, rename and destroy a document.
	// They are in this table rather than beside the strip's own click handler for the reason the
	// table exists at all: a tool gated by where it happens to be written is a tool nobody can tell
	// was gated on purpose. Switching between pages is NOT here, because it is not a tool and not an
	// edit: it is the strip's own value, and a reader who may only look still gets to look at every
	// page they are allowed to (see `showPage`).
	pagenew: { needsEdit: true, run: app => app._addPage() },
	// ⚠ `needsEdit` IS NOT THE GATE THAT MATTERS HERE, and it is written all the same. Who may hide
	// a board is a narrower question than who may edit one — only a GM, because core's own sanitizer
	// refuses an ownership change from anybody else — and `_hidePage` asks it. This entry keeps the
	// table's own rule true for the tool: it writes to a document, so it is behind the edit gate,
	// and being behind two gates is not a fault.
	pagehide: { needsEdit: true, run: app => app._hidePage() },
	pagerename: { needsEdit: true, run: app => app._renamePage() },
	pagedelete: { needsEdit: true, run: app => app._removePage() },
});

export class RelationshipMapWindow extends StonetopDialog {
	constructor(entry, options = {}) {
		super(options);
		this._entry = entry;
		this._entryId = entry?.id ?? null;
		// WHICH BOARD OF THIS MAP IS UP. The reader's own: two people at one table can and should be
		// looking at different pages of the same map at the same moment, so this is never written to
		// the document. Null means "whichever page comes first", which is what a map opened from the
		// sidebar wants; the sidebar's own page rows, and a window restored across a reload, both
		// arrive carrying one.
		this._pageId = options.pageId ?? null;
		// Set once the first render has made sure this map HAS a page. See `_ensurePage`.
		this._pagesReady = false;
		// The strip as it was last written, so a repaint can tell a set of pages that has changed
		// from one that has not and leave the reader's focus alone when it has not.
		this._pagesSaid = null;
		this._surface = null;
		this._teardownDrag = null;
		/**
		 * Every world hook this window has registered, as `[name, handler]`, for `close` to undo.
		 *
		 * ⚠ A LIST AND NOT A FIELD APIECE. These are GLOBAL listeners: one left registered by a
		 * window that has closed goes on running, holding the whole window and the board it drew
		 * alive, and firing on every journal write at the table for the rest of the session. Five
		 * fields meant five `Hooks.on` calls in one place and five three-line teardowns in another,
		 * with nothing tying a registration to its removal but the reader's attention -- and the
		 * one that gets missed leaks silently and forever.
		 */
		this._hooks = [];
		// Whether the words along the lines are drawn at all. The reader's own, off to begin with,
		// and never written to the map: see `_toggleLabels`.
		this._hideLabels = false;
		// Whose web is lit up right now, or null. Held so that a repaint arriving while the
		// pointer rests on a portrait can put the highlight back where it was.
		this._lit = null;
		// Whose trash can is showing, or "". A right press on a portrait opens one and any ordinary
		// click puts it away; see `_armRemove`. Held on the window for the reason `_lit` is: the
		// board's markup is the window's, and a repaint replaces every portrait on it.
		this._armed = "";
		// The stroke, its click target and its caption, as `_paintPickedLine` last marked them. Held
		// so that taking the mark OFF again is three writes rather than a walk of the whole board.
		this._pickedParts = [];
		// Set while a repaint arrived at a moment it could not be applied. Flushed by whatever was
		// in the way once it is out of the way.
		this._pendingSync = false;
		this._root = null;
		// The board inside `_root`, remembered by `_boardEl()`, and the root it was found in.
		this._board = null;
		this._boardRoot = null;
		// Set only by a restored window that was minimized when this client last reloaded; see
		// openMinimized.
		this._minimizeOnRender = false;
		// What the next render is to announce once its live region is on screen; see `showPage`.
		this._sayOnRender = null;
		// Which control that same render is to put the reader's focus back onto, as a selector; see
		// `_takeFocusBack`. Null on an ordinary render, which must never move anybody's focus.
		this._focusOnRender = null;
		// The plan `getData` built for the render now in flight, for the listeners wired onto it a
		// moment later. Lives for one render and is taken, never kept: see `_takePlan`.
		this._renderPlan = null;
		// Shut, and by whose arguments — the pair `_render` reads to find out that the render it
		// just finished was for a window nobody is holding any more. See `close`.
		this._closed = false;
		this._closeOptions = null;
		// Where an arrow-key nudge has put a portrait that is not written yet, and the debounced
		// write that will. Held on the instance so `nodeAt` can answer from it: the next key must
		// step on from where the portrait IS, not from the stale spot still in the document.
		//
		// A MAP AND NOT ONE SLOT, because the debounce is one timer for the whole board: a reader
		// who moves one face and tabs to the next inside it has two portraits waiting on the same
		// write, and a single slot would keep whichever was touched last. See `_writeNudge`.
		this._pendingNudge = new Map();
		// A LINE DRAWN A MOMENT AGO, WAITING FOR THE BOARD TO CATCH UP. The bar is placed from the
		// last PAINT (`_drawn`), and a line drawn this instant is in the document but not yet in
		// any paint -- so it cannot be taken hold of until the repaint the write set off arrives.
		// Held here for that one repaint to find. See `_createLink`.
		this._pendingPick = "";
		// THE GEOMETRY THE MARKUP NOW ON SCREEN WAS BUILT FROM, kept for exactly one reason: the
		// gap cut in each stroke has to be re-cut against the caption that actually painted, and
		// that cannot be known until the caption is in a document. See `_fitGapsToPaint`.
		this._drawn = null;
		// Set while a re-measure is waiting on a webfont that had not arrived; see the same.
		this._awaitingFonts = false;
		this._commitNudge = foundry.utils.debounce(() => this._writeNudge(), NUDGE_COMMIT_MS);
	}

	static get defaultOptions() {
		const { width, height } = openingSize({ maxAspect: 1.2 });
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["stonetop", "stonetop-relmap-app"],
			template: TEMPLATE,
			width,
			height,
			resizable: true,
		});
	}

	get entry() {
		// Re-read rather than held: the document this window was opened on can be replaced under it
		// by a re-import, and a stale handle writes into a document nothing is watching.
		return game.journal?.get?.(this._entryId) ?? this._entry ?? null;
	}

	/** Every named board of this map THIS READER MAY LOOK AT, in strip order. Asked afresh, never
	 * held: somebody at the far end of the table adds, renames and reveals these while this window
	 * is open.
	 *
	 * ⚠ THE VISIBLE STRIP AND NOT THE WHOLE ONE. Every board starts hidden from the players and is
	 * shown one at a time with the eye (relmap/relmap-doc.js), so for a player this is a subset and
	 * for a GM it is always the lot. Everything the window draws, counts and steps through comes
	 * from here; the two places that must reason about boards a reader cannot see say so out loud
	 * and reach for `listMapPages` themselves. */
	get mapPages() {
		return listVisibleMapPages(this.entry);
	}

	/** The page this reader is on, or the first one. Null on a map still carrying its board on the
	 * entry, which `boardDoc` below is what answers for, and null again for a player on a map whose
	 * every board is still the GM's own, which `noBoardForMe` is what tells the two apart.
	 *
	 * ONE WALK OF THE STRIP, the same economy `mapBoardDoc` keeps: asking `getMapPage` and then
	 * falling back to `this.mapPages` filtered and sorted the same pages twice per call, and this is
	 * a getter the render pass reaches several times over. */
	get mapPage() {
		const pages = this.mapPages;
		return pages.find(page => page.id === this._pageId) ?? pages[0] ?? null;
	}

	/**
	 * THIS MAP HAS BOARDS AND NONE OF THEM IS THIS READER'S TO SEE.
	 *
	 * The state a player is in on a map whose every board the GM has kept back, and it has to be
	 * told apart from the other way `mapPage` comes back null — a map still on version 1, whose one
	 * board is on the entry and is perfectly editable. Both leave `boardDoc` resolving to the ENTRY,
	 * and on a converted map the entry's graph is empty by design, so without this the reader would
	 * be offered an empty board with an "add somebody" button on it, and every person they added
	 * would be written into the entry's dead flag where nobody, themselves included, would ever see
	 * them again.
	 *
	 * ⚠ `mapPage` FIRST, so the ordinary case costs one walk and stops. The second walk only happens
	 * for a reader who has no board at all, which is the two rare shapes above and never a GM.
	 */
	get noBoardForMe() {
		if (this.mapPage) return false;
		return listMapPages(this.entry).length > 0;
	}

	/**
	 * ⚠ THE DOCUMENT EVERY READ AND EVERY WRITE IN THIS WINDOW GOES THROUGH, and the whole of what
	 * the board below has to know about pages existing.
	 *
	 * On an ordinary map it is a JournalEntryPage; on one still on version 1, whose graph is on the
	 * entry itself, it is the ENTRY — and the flag is the same shape either way, so nothing
	 * downstream branches. `this.entry` is now only for the three questions that are genuinely
	 * about the MAP rather than about the board: its name, who may edit it, and which document
	 * window-restore reopens.
	 */
	get boardDoc() {
		return mapBoardDoc(this.entry, this._pageId);
	}

	/**
	 * Which page to come back to after a reload, for utils/window-restore.js.
	 *
	 * The same bargain `document` above strikes: the restorer works over document sheets, this is
	 * not one, so what it needs is exposed by name rather than reached for. Which page a board was
	 * on is part of where the window was — a table that leaves this open all session leaves it open
	 * ON something — and it travels back in through the render options, the same way the geometry
	 * does (journal/RelationshipMapEntrySheet.js forwards both).
	 */
	get restorePageId() {
		return this.mapPage?.id ?? null;
	}

	/**
	 * The same entry, under the name a window over a document is expected to expose.
	 *
	 * WHY IT EXISTS. utils/window-restore.js reopens the windows this client had open when it last
	 * reloaded, and the one thing it asks a window for is `document` — the uuid it saves, and the
	 * `doc.sheet` it reopens through. Everything else it tracks is a real DocumentSheet; this board
	 * is a StonetopDialog only because it could not be both a dialog and a registered sheet
	 * (journal/RelationshipMapEntrySheet.js explains at length), so it says so here instead. People
	 * leave this window open for a whole session, which is what makes it worth restoring at all.
	 */
	get document() {
		return this.entry;
	}

	/**
	 * MAY THIS READER CHANGE THE BOARD IN FRONT OF THEM?
	 *
	 * ASKED, NEVER HELD, and asked afresh by everything below including the drag layer's per-gesture
	 * questions: permission can change under an open window.
	 *
	 * ⚠ OF THE BOARD, AND NOT OF THE MAP, now that a board carries its own ownership. The server
	 * checks a page write against the PAGE, so the page is the only document whose answer this can
	 * safely be. On the ordinary map the two agree by construction: a board the players can see is
	 * `INHERIT`, which takes the map's own ownership, and a map is owned by everybody at the table.
	 * SO EVERY PLAYER WHO CAN SEE A BOARD CAN EDIT IT, exactly as the GM can, and that is the whole
	 * of what "shown" means. They part company only where a GM has reached past this window for
	 * core's own ownership dialog and set a page to OBSERVER by hand, and there the honest answer is
	 * a board that reads as read-only rather than one whose every tool is live and whose every write
	 * the server throws away.
	 *
	 * ⚠ AND A READER WITH NO BOARD AT ALL MAY NOT EDIT ONE. A player on a map whose every board is
	 * still the GM's own owns the entry, and `boardDoc` for them falls back to that entry: they
	 * would have every tool enabled over a flag that is drawn nowhere. The fallthrough is told from
	 * the other document that reaches it -- a map still on version 1, whose board really is on the
	 * entry and really is editable -- by whether the map has any pages at all.
	 *
	 * ONE WALK OF THE STRIP in the ordinary case, which matters: this is asked several times per
	 * render, again on every repaint, and again on every gesture. The second walk is only paid by a
	 * reader who has no board, which is the two rare shapes above and never a GM.
	 */
	get canEdit() {
		const page = this.mapPage;
		if (page) return canEditRelationshipMap(page);
		return !listMapPages(this.entry).length && canEditRelationshipMap(this.entry);
	}

	/** May this reader hide a board from the players, and show it again? Only a GM, and asked afresh
	 * for the reason `canEdit` is: a role can change under an open window. */
	get canHidePages() {
		return canHideMapPages() && canEditRelationshipMap(this.entry);
	}

	async getData() {
		const plan = this._plan();
		// HANDED FORWARD to the listeners this render is about to wire, which want the sheet out of
		// it and would otherwise rebuild the whole thing to get two numbers. See `_takePlan`.
		this._renderPlan = plan;
		// ⚠ THE STRIP AND THE BOARD ON IT, RESOLVED ONCE FOR THE WHOLE PASS. Every one of the eight
		// answers below used to reach `this.mapPages` or `this.mapPage` on its own, and each of those
		// filters the entry's whole page collection and sorts it again. Read here, they are also
		// guaranteed to agree with each other — a page deleted at the far end of the table halfway
		// down this function cannot leave the strip saying one thing and the panel another.
		const pages = this.mapPages;
		const page = this.mapPage;
		// THE CHROME IS DERIVED ONCE AND SPREAD, rather than spread straight into the return: the
		// same answers are written again by `_paintChrome` after every repaint, and one derivation
		// with two writers is what keeps the two from drifting apart.
		const chrome = this._chrome(plan);
		// ⚠ PINNED TO A CONCRETE PAGE, on every render, and this is load-bearing rather than tidy.
		// Null means "whichever board comes first", which is what a map opened from the sidebar
		// starts as — and left null, the delete hook cannot tell "the page this reader was standing
		// on has just been rubbed out" from "some other page has", because by the time it is asked
		// the page is gone and `mapPage` has already fallen through to another one. The reader would
		// be left looking at a board that no longer exists, with every write vanishing. Resolved
		// through `mapPage`, so it also heals an id that has gone stale.
		this._pageId = page?.id ?? null;
		// AND REMEMBERED FOR THE NEXT OPEN, so the hotbar macro lands back here rather than asking
		// which map. Per client and skipped when nothing moved, so this stays true to what `showPage`
		// promises a page later: which board somebody is on is theirs, and writes nothing shared.
		rememberBoard(this.entry?.id, this._pageId);
		// THE STRIP IS REMEMBERED AS WELL AS RENDERED, for the reason the person chooser is: the
		// set of pages is exactly the thing somebody at the far end of the table changes while this
		// reader is looking at it, and a repaint has to be able to tell a strip that has changed
		// from one that has not. See `_paintPages`.
		const pageTabs = this._pageTabs(pages, this._pageId ?? "");
		this._pagesSaid = pageTabs;
		return {
			// NO `title` HERE. The bar used to open with the map's name, which the window's own
			// title bar was already saying an inch above it; the name the template still needs is
			// the PAGE's, and that is written into the tab strip below.
			canEdit: this.canEdit,
			// WHICH BOARD OF THIS MAP IS UP, as a strip of named tabs under the bar.
			//
			// SHOWN TO A READER WHO MAY ONLY LOOK ONLY WHEN THERE IS SOMETHING TO CHOOSE BETWEEN. A
			// single tab over a board, with no way to add a second, is a row of chrome that answers
			// a question nobody asked; but the moment a map has two boards, knowing which one you
			// are on is the most important thing on the window, whether or not you may write to it.
			showPages: this.canEdit || pages.length > 1,
			// ⚠ DROPPED IN WHOLE, like the board and the person chooser, and NOT written out here
			// as an `{{#each}}`. Pages are made, renamed and deleted under an open window, and the
			// repaint that keeps up with that can only reach the DOM. One builder, two writers.
			pageTabs,
			// Which tab the board below is the panel FOR. Written again by `_paintPages`, because
			// the reader can be moved off a page that has just been deleted elsewhere.
			pagePanelId: this._pageTabId(this._pageId ?? ""),
			pagesLabel: localize("stonetop.relmap.pages.label"),
			// ⚠ THE HINTS ARE THE LABELS. The three page tools are bare glyphs, and each one's
			// hint is both its tooltip and its `aria-label` -- there is no second, shorter string
			// on the button for it to compete with. (`pages.new` is still localized elsewhere: it
			// names the confirm button of the dialog the "+" opens.)
			pageNewHint: localize("stonetop.relmap.pages.newHint"),
			pageRenameHint: localize("stonetop.relmap.pages.renameHint"),
			pageDeleteHint: localize("stonetop.relmap.pages.deleteHint"),
			// ⚠ THE EYE IS DERIVED, NOT SPELT, and by the same function `_paintPages` writes it
			// from. Everything about that button changes without a render — the GM presses it, or
			// somebody at another GM's screen does — so a render and a repaint deriving it
			// separately would be two spellings of one question with the wrong one right until the
			// next full render. See `_seenTool`.
			...this._seenTool(page),
			// ⚠ THE LAST BOARD MAY NOT BE RUBBED OUT, and the button is absent rather than disabled
			// on a one-page map. A map with no pages is one whose next opener silently gives it a
			// fresh empty board, so the delete would read as the map emptying itself.
			canDropPage: this.canEdit && pages.length > 1,
			// ⚠ NO `showMatchIntros`, `matchIntrosLabel` OR `matchIntrosHint`. The three of them
			// dressed one GM-only button on the party's board, and the button is gone. Named here
			// so a key resurrected by accident is recognised as a resurrection rather than as a
			// key the template happens not to use yet.
			board: await this._renderBoard(plan),
			addLabel: localize("stonetop.relmap.add"),
			addHint: localize("stonetop.relmap.addHint"),
			// ⚠ THE VISIBLE NAMES ONLY. What each of these two can actually do, and what it would
			// take back, is written onto the elements by `_paintHistory` — the history is this
			// reader's own and is not part of the document a render was built from. They come up
			// disabled and saying so, which is the truth for a bar that has just appeared.
			// ⚠ AND NOTHING ELSE. The buttons carry no words -- only the two curved arrows --
			// so what a render supplies for them is the name they answer to while they are off.
			undoNothing: localize("stonetop.relmap.history.backNothing"),
			redoNothing: localize("stonetop.relmap.history.forwardNothing"),
			// ⚠ THE TIE BAR'S SHELL, AND ONLY ITS SHELL. Everything about it that depends on WHICH
			// line is open -- which colour the chooser shows, what the two arrow buttons are called, which
			// way they point -- is written by `RelmapTieBar` when it opens, because a render knows
			// nothing about a line the reader has not clicked yet. What is settled here is the part
			// that never changes: the eight colours to choose between, the two kinds of stroke, and the
			// field.
			maxLength: RELMAP_LABEL_MAX,
			labelField: localize("stonetop.relmap.labelField"),
			inkLabel: localize("stonetop.relmap.inkField"),
			dirLabel: localize("stonetop.relmap.dirField"),
			dashLabel: localize("stonetop.relmap.dashField"),
			inks: RELMAP_INKS.map(key => ({ key, name: localize(`stonetop.relmap.inks.${key}`) })),
			// The word the bar puts beside its disc, and its spoken name. A PATTERN and not a
			// finished phrase: which colour it names changes with every line the reader clicks, and
			// `RelmapTieBar` has no i18n in it to build one with -- see `_said` there.
			inkNamed: localize("stonetop.relmap.inkNamed"),
			// THE REST OF THE WHEEL, under the eight: forty colours nobody named, each stored and
			// drawn as exactly what a hex typed into the picker is. See `RELMAP_INK_PRESETS`, which
			// says why they are frozen hexes and what a preset costs against one of the eight.
			//
			// ⚠ NAMED HERE AND NOWHERE ELSE. `RelmapTieBar` has no i18n in it, so a swatch's name has
			// to arrive on the swatch -- and these need one more than anything else in this window
			// does, because the words came off the discs when this became a grid, and a tooltip
			// reading "#0c6d78" is not a name to anybody choosing by reading.
			inkPresets: RELMAP_INK_PRESETS.map(({ key, hex }) => ({
				hex, name: localize(`stonetop.relmap.inkPresets.${key}`),
			})),
			// How wide the palette is laid out, which is the ARROW KEYS as much as the stylesheet:
			// Up and Down step by a row, and this is what a row is. See `RELMAP_INK_ACROSS`.
			inkAcross: RELMAP_INK_ACROSS,
			// THE LAST ROW OF THE PALETTE, and deliberately NOT part of `RELMAP_INKS`: that is the
			// eight this system ships and a test holds it to the eight the stylesheet paints. These
			// are the colours the table has typed for itself on THIS board, which the bar fills in
			// from `inksInUse` -- so what the render supplies is the empty slots and the words.
			inkCustomSlots: [...Array(RELMAP_INK_ACROSS).keys()],
			inkCustomHeading: localize("stonetop.relmap.inkCustomHeading"),
			inkCustomNamed: localize("stonetop.relmap.inkCustomNamed"),
			inkCustomField: localize("stonetop.relmap.inkCustomField"),
			// From `RELMAP_DIRS` and not four buttons written out by hand, which is what the ink and
			// dash groups beside it already do: a direction the store knows and the template does not
			// is a stored answer with no button, and `markChosen` carries a defensive branch for
			// exactly that drift. The two one-way icons are rewritten on open from where the faces
			// actually sit -- see `_nameDirs` -- so these are only what they are BUILT with.
			dirs: RELMAP_DIRS.map(key => ({
				key, icon: TIE_DIR_ICONS[key], name: localize(`stonetop.relmap.dirs.${key}`),
			})),
			// No icon: each of these DRAWS the line it means, from the stylesheet. See the template,
			// and `--st-relmap-dotted` / `--st-relmap-dashed` for the patterns they are drawn with.
			//
			// ⚠ THE ORDER IS `RELMAP_DASHES`' OWN and is read down the panel: whole, broken, barely.
			// A third answer is what turned this row of presses into a chooser -- three 26px squares
			// on a strip that floats over the drawing is a third of the bar spent on the question a
			// table asks least, and the panel costs the width only while it is open.
			dashes: RELMAP_DASHES.map(key => ({
				key, name: localize(`stonetop.relmap.dashes.${key}`),
			})),
			// The spoken name of whichever stroke the open line has, as a PATTERN: which one that is
			// changes with every line the reader clicks, and `RelmapTieBar` has no i18n in it to
			// build a phrase with. The colour's trigger is given its own the same way -- see `_said`.
			dashNamed: localize("stonetop.relmap.dashNamed"),
			// HOW BIG THE WRITING IS, from `RELMAP_SIZES` and not five rows written out by hand, for
			// the reason the inks and the strokes are: a step the store would keep and the template
			// does not offer is an answer a reader can be looking at and cannot choose.
			//
			// ⚠ THE VALUE IS THE NUMBER ITSELF, in board pixels, and it is the same number twice
			// over: the row is marked by it and the sample in that row is SET in it, so what a
			// reader is choosing between is what they are looking at.
			sizeLabel: localize("stonetop.relmap.sizeField"),
			sizes: RELMAP_SIZES.map(({ key, px }) => ({
				px, name: localize(`stonetop.relmap.sizes.${key}`),
			})),
			// The spoken name of whichever size the open line is set in, as a PATTERN, exactly as
			// the colour and the stroke are given theirs. See `_said` in the bar.
			sizeNamed: localize("stonetop.relmap.sizeNamed"),
			// What the trigger shows before a line has been clicked. The bar rewrites it on every
			// open; this is here so the first paint is a number rather than a hole.
			sizeBase: RELMAP_CAPTION_PX,
			// The bounds on a size somebody types, said to the browser as well so the spinner cannot
			// walk out of them. `readSize` is still what holds a TYPED number to them: an input's
			// `min` is a hint to the control, not a promise about its value.
			sizeMin: RELMAP_SIZE_MIN,
			sizeMax: RELMAP_SIZE_MAX,
			sizeOwnLabel: localize("stonetop.relmap.sizeOwnLabel"),
			sizeOwnField: localize("stonetop.relmap.sizeOwnField"),
			// No placeholder: the writing field is clipped off the bar now and what a reader sees
			// while they type is the line itself, so a prompt printed in a box nobody can see would
			// be a string kept in step with nothing.
			tie: {
				label: localize("stonetop.relmap.tie.label"),
				rub: localize("stonetop.relmap.tie.rub"),
			},
			labelsLabel: localize("stonetop.relmap.hideLabels"),
			labelsHint: localize("stonetop.relmap.hideLabelsHint"),
			// EVERY PANEL THAT CAN GO OUT OF DATE UNDER AN OPEN WINDOW, from the one derivation
			// `_paintChrome` writes back after a repaint. See `_chrome`.
			...chrome,
		};
	}

	/**
	 * EVERYTHING ONE PASS OVER THIS MAP HAS TO AGREE ABOUT, worked out once.
	 *
	 * WHAT IT IS FOR IS THE AGREEMENT, not the arithmetic. A render and a repaint each used to ask
	 * the same questions three and four times over -- which lines this reader is looking at, and how
	 * big a sheet that wants -- and every one of those askings was free to answer slightly
	 * differently.
	 *
	 * STILL WORKED OUT FRESH each pass, never held on the window. The graph changes under an open
	 * board, and a cached plan is a board drawn from a map that has moved on, which looks exactly
	 * like the layout being broken.
	 *
	 * ⚠ `plan.graph` IS THE BOARD IN FRONT OF THE READER, and there is no second graph behind it.
	 * There used to be: a filter that dropped the lines an old import had written, so the picture
	 * and the map could differ. Everything the reader can now put away is put away by the
	 * STYLESHEET -- the captions, and nothing else -- which is why one graph does for both. Every
	 * measurement (the fan indexes, `edgeShapes`' clearance dodges, the room each caption has, the
	 * spreader's obstacle list, the cast the partial walks) reads it, so they cannot come apart.
	 */
	_plan(graph = null) {
		const whole = graph ?? readGraph(this.boardDoc);
		return {
			graph: whole,
			// THE SHEET GROWS WITH THE CAST, so a portrait's radius is not a constant: it is
			// smaller, as a share of the board, on a board carrying more people.
			board: boardMetrics(Object.keys(whole.nodes).length),
		};
	}

	/**
	 * Everybody on this map as rows for a chooser: by name, in name order.
	 *
	 * ONE BUILDER, and it stays one. This was written twice over -- once for "draw a line to whom"
	 * and once for a chooser since removed -- and the two had already come apart: one listed the
	 * STORED name in whatever order the flag came back in, the other the live actor's name sorted.
	 * Somebody renamed on their sheet appeared under two different names in two lists on the same
	 * board, and the unsorted one was in an order nothing could predict, which on a map of forty
	 * people is a list you have to read all of.
	 */
	_peopleOnMap(graph) {
		return Object.keys(graph?.nodes ?? {})
			.map(id => this._personOnMap(graph, id))
			// By name, then by id: two people can share a name, and object key order is not stable
			// across a flag merge (see relmap-store.js `edgesBetween`).
			.sort((a, b) => (a.name === b.name ? (a.id < b.id ? -1 : 1) : a.name < b.name ? -1 : 1));
	}

	/**
	 * One person on this map as a chooser row: the id the board knows them by, what they are
	 * called, and the sheet behind them where there is one.
	 *
	 * THE ACTOR IS PART OF THE ROW because the chooser sorts by it: the people picker offers the
	 * village's own lists, and a row that carried only a name would land everybody under "Everyone
	 * else". Resolved ONCE here rather than by the name reader and again by the chooser.
	 */
	_personOnMap(graph, id) {
		const node = graph?.nodes?.[id];
		const actor = node?.uuid ? fromUuidSync(node.uuid, { strict: false }) : null;
		return {
			id,
			name: actor?.name || node?.name || localize("stonetop.relmap.someone"),
			actor,
		};
	}

	/** What somebody on the map is called, for a sentence about them. The live actor wins where it
	 * resolves, exactly as the portrait does, so a rename shows up here too. */
	_nameOf(graph, id) {
		return this._personOnMap(graph, id).name;
	}

	/**
	 * How big this map's sheet is, and how small a portrait is on it, for the two callers that want
	 * a clear spot and nothing else.
	 *
	 * STRAIGHT OFF THE GRAPH, not out of a plan. This used to be `this._plan(graph).board`, which
	 * re-read the document and re-ran the visible-graph filter to reach a one-line measurement.
	 * Both callers are an ADD (the button and a sidebar drop), and both want the sheet the WHOLE
	 * cast is measured for -- not the one whatever this reader has put away leaves behind.
	 */
	_boardSize(graph = null) {
		return boardMetrics(Object.keys((graph ?? readGraph(this.boardDoc))?.nodes ?? {}).length);
	}

	/**
	 * The plan THIS render was drawn from, handed forward to the listeners being wired onto it.
	 *
	 * WHY IT IS WORTH KEEPING. `_plan` is not free — it normalizes the whole map through `readGraph`
	 * — and its own doc-block records that building one four times per render was a cost that had to
	 * be paid down. `activateListeners` needs two numbers out of the sheet
	 * and was going back through `_boardSize()` for them, which reads the document again and
	 * rebuilds the whole plan: the fifth build, on the pass that had just finished the first.
	 *
	 * NOT A CACHE, and the difference matters. It is set by `getData` and TAKEN by the listeners
	 * that follow it in the same render, so it is only ever read once and only ever by the pass that
	 * wrote it. A plan held across renders would be a board drawn from a map that has moved on,
	 * which is exactly what `_plan` refuses to do.
	 */
	_takePlan() {
		const plan = this._renderPlan ?? null;
		this._renderPlan = null;
		return plan;
	}

	/**
	 * The board's markup for one graph.
	 *
	 * Separate from `getData` because it is rendered on its own for every live update — see `sync`.
	 */
	async _renderBoard(plan) {
		return renderTemplate(BOARD_PARTIAL, this._boardContext(plan));
	}

	/**
	 * Everything the board partial draws, worked out once.
	 *
	 * The three renderers of one line — the stroke, its label and its heads — all take their
	 * numbers from the same `edgeCurve` call here, which is what keeps a label on its own stroke.
	 *
	 * IT NEVER ASKS WHICH VIEW IS UP. `plan.graph` is already the board in front of the reader —
	 * the right cast, at the right seats, with the right lines and no others — so every number
	 * below is measured against what is actually drawn. That is not tidiness: the fan indexes, the
	 * clearance dodges and the spreader's obstacle list all have to agree about which board they
	 * are on, and a ternary per question is three chances for one of them to be looking at a
	 * different one.
	 */
	_boardContext({ graph, board }) {
		const r = board.r;
		const fans = fanIndexes(graph);
		const canEdit = this.canEdit;
		// The right-press hint, added to whatever a face's tooltip already says -- and NOT added on
		// a board this reader may only look at, where it would teach a gesture that does nothing.
		// One sentence, appended rather than woven in, so the three tooltips below stay the three
		// sentences they are.
		const gesture = canEdit ? ` ${localize("stonetop.relmap.removeGesture")}` : "";
		// ⚠ WITH A FULL STOP PUT IN WHERE THE SENTENCE BEFORE IT HAS NONE. Two of the three
		// tooltips below end in one; the third is a bare name, and "The Miller Right-click for the
		// button" is one broken sentence rather than two. Asked of the words rather than of which
		// branch produced them, so a fourth tooltip cannot be added without it.
		const withHint = said => {
			if (!gesture) return said;
			const base = String(said).trim();
			return `${/[.!?]$/.test(base) ? base : `${base}.`}${gesture}`;
		};

		// WHO IS ON THE BOARD, and where: the graph's own people at the graph's own coordinates.
		// Anybody this reader has put away is dropped from the RENDER rather than hidden by
		// the stylesheet, because a portrait nobody can see is still something the lines have to be
		// routed round and the geometry has to measure; and they are all still on the map, coming
		// back the moment the reader unticks the box.
		const nodes = Object.entries(graph.nodes).map(([id, node]) => {
			// The live actor wins where it resolves; the stored name and picture are the fallback
			// that keeps somebody on the map after their actor is deleted or moved out of reach.
			// Through `_personOnMap` and not spelled again here: that function's own doc-block
			// records what the split cost last time, which was one person under two different names
			// in two lists on the same board.
			const { name, actor } = this._personOnMap(graph, id);
			const portrait = portraitOrNone(actor?.img ?? node.img, documentPortraitFrame(actor));
			// A person the map still knows by uuid whose actor no longer resolves. READ TWICE
			// below, and the two readings are a pair: it marks the face, and it is the difference
			// between a tooltip that offers a sheet and one that says why there is not one. A node
			// with NO uuid is a different thing entirely — somebody typed onto the board who never
			// had an actor — and neither reading may catch it.
			const gone = !!node.uuid && !actor;
			return {
				id,
				name,
				left: node.x,
				top: node.y,
				img: portrait.src,
				imgStyle: portrait.style,
				// A face that came with a rim already drawn on it — the playbook badge a character
				// who never picked a portrait wears. The stylesheet takes this board's own rim off
				// those, because the two land three pixels apart and the face reads as a target.
				// Asked of the resolved `src` and not of the actor, so the same answer covers the
				// picture stored on a node whose actor has since gone.
				ownRing: hasOwnRingArt(portrait.src),
				// A person whose actor has gone. Drawn differently rather than dropped: the links
				// they are part of are still somebody's notes about the story.
				missing: gone,
				// A GONE PERSON SAYS SO IN WORDS. The dashed rim is the mark, but a mark has to be
				// learned, and a reader meeting one of these for the first time has no way to tell
				// a deleted actor from a decoration — so resting on the face spells it out. It also
				// keeps the promise above: this face opens no sheet, and the tooltip stops offering
				// one. Said HERE and not only in the rim so it reaches the reader on a magnifier and
				// the reader on a screen reader by the same route, and so the notice on CLICKING it
				// (`relmap.gone`) is no longer the first anybody hears of it.
				// ⚠ AND THE THIRD GESTURE IS NAMED HERE TOO, on every one of the three sentences
				// above and only for a reader who can act on it. Right-pressing a portrait is what
				// puts the trash can on it, and a gesture with nothing on screen to suggest it is
				// a gesture nobody finds: this tooltip already teaches the click and the drag, so
				// the one route to taking somebody off belongs in the same breath rather than in a
				// note somewhere the reader is not looking. It matters most on the deleted-actor
				// sentence, which is exactly the face somebody is about to want gone.
				tooltip: withHint(gone
					? format("stonetop.relmap.deletedActor", { name })
					: actor
						? format("stonetop.relmap.openSheet", { name })
						: name),
				linkLabel: format("stonetop.relmap.linkFrom", { name }),
				removeLabel: format("stonetop.relmap.removeLabel", { name }),
			};
		});

		const edges = [];
		const labels = [];
		const heads = [];
		const shapes = edgeShapes(graph, {
			r, fans, spread: true, boardWidthPx: board.width,
		});
		// HELD BACK for the second pass over this same markup. `_fitGapsToPaint` needs the curve, the
		// anchor and the sheet these were worked out on, and re-deriving them from the document would
		// be a second answer to a question that already has one.
		this._drawn = {
			// THE WHOLE SHEET, not just its width, because a caption is placed in the caption
			// layer's own pixels and that space is as tall as the board is, not as wide. Kept for
			// `_fitGapsToPaint`, which re-seats every caption once it can measure one. Its width is
			// read straight off it: a second copy of that number beside it was one more field to
			// keep in step for nothing.
			board,
			shapes: new Map(shapes.map(shape => [shape.id, shape])),
			painted: null,
			// Each line's markup, indexed by edge id. Walked once by `_fitGapsToPaint` and kept for
			// `_sayLine`, which reaches for one line on every keystroke.
			parts: null,
			// How to measure a caption in the face that actually painted, once there is one on
			// screen to read it off. Filled by `_fitGapsToPaint`; read by `_sayLine`.
			measure: null,
			// ⚠ THE GRAPH THESE SHAPES WERE DRAWN FROM, kept beside them so that anything asking
			// about a line the reader can SEE has one answer rather than two. A second reader that
			// went to the document instead would be reading it at whatever moment it asked, and a
			// repaint is exactly the moment that answer changes -- so the tie bar would come to
			// float over an empty patch of paper for as long as it took the next one to arrive.
			//
			// AND IT SAVES A SECOND `readGraph` PER REPAINT, which normalizes the whole map's
			// worth of nodes and edges into a fresh object; the repaint has already paid for one.
			graph,
		};
		for (const shape of shapes) {
			const { id, edge, curve, anchor } = shape;
			// Two portraits stacked on each other have no line between them to draw. The link is
			// still stored, and reappears the moment either is dragged clear.
			if (!curve) continue;
			// Both ends ride on every piece of a line, so that resting on a portrait can light up
			// that person's whole web without asking the graph again. Read off `dataset`, never
			// built into a selector: a stored id goes into a selector as text.
			edges.push({
				// ⚠ NOT THE STORED INK, but how it is DRAWN: one of the eight is a class the
				// stylesheet owns, and a colour of the reader's own is the `custom` class plus the
				// colour itself, written inline because there is no token for it to be. `inkPaint`
				// is the one place that branch is taken -- see relmap-ink.js.
				id, a: edge.a, b: edge.b, d: shape.d, ...inkPaint(edge.ink),
				// HOW the reader broke this stroke, where they broke it: the key itself, and ""
				// for a whole one. A class and not a dash pattern written out here, for the reason
				// the ink is a class -- what a mark RESOLVES to is the stylesheet's business and
				// has to stay retunable under the accessibility skin.
				//
				// ⚠ MEASURED AGAINST THE DEFAULT rather than against a list of the broken ones, so
				// a fourth kind of stroke added to `RELMAP_DASHES` arrives here drawn rather than
				// silently whole. Anything the store did not recognise is already `solid` by then.
				broken: edge.dash && edge.dash !== RELMAP_DASH_DEFAULT ? edge.dash : "",
				// THE WHOLE CURVE, not the broken one the stroke is painted along. What this feeds
				// is the invisible target laid over the line, and cutting the caption's gap out of
				// THAT would leave a dead patch in the middle of every captioned line -- which is
				// the exact spot a reader aims at.
				hit: shape.curve?.d ?? "",
			});
			// The id and the end ride on every head, because the live drag finds these elements
			// again by them: a link may wear two, and each has to go back to its own end.
			for (const head of shape.heads) heads.push({ ...head, id, ...inkPaint(edge.ink) });
			if (anchor) {
				const spot = captionSpot(anchor, board);
				labels.push({
					id, a: edge.a, b: edge.b, text: edge.label,
					// WHERE THE WORDS SIT AND HOW FAR THEY ARE TURNED OVER, in ABSOLUTE board
					// pixels — the only space type can be set in without shearing it, and the space
					// the caption layer's viewBox is in.
					x: spot.x, y: spot.y, angle: anchor.angle,
					// HOW BIG THIS ONE IS SET, where the reader has said, and ZERO on every other
					// line — which is nearly all of them. The template prints the property only for
					// a line that has one, so an ordinary board carries no size markup at all and
					// follows the stylesheet, as every board written before this did.
					px: edge.size,
					// THE TOOLTIP IS THE SENTENCE AND NOTHING ELSE. What it is for is the words the
					// chip could not fit, so on a crowded board it is the only place the whole of a
					// caption can be read; telling the reader what clicking does, on every one of
					// eighty lines, buries that under an instruction they learned the first time.
					tooltip: edge.label,
					// THE ACCESSIBLE NAME STILL SAYS. A screen reader announces a button by this and
					// gets no other clue that it is one, so the instruction the tooltip drops is
					// exactly what a reader who cannot see the chip needs to hear.
					ariaLabel: canEdit
						? format("stonetop.relmap.editLink", { label: edge.label })
						: edge.label,
				});
			}
		}

		return {
			nodes, edges, labels, heads,
			// The caption layer's own coordinate space, which is the board's pixels at 1:1. Sent
			// out rather than written into the stylesheet because the sheet GROWS with the number
			// of people on it (`boardMetrics`), so there is no constant to write.
			boardWidth: board.width,
			boardHeight: board.height,
			canEdit,
			headD: ROUTE_HEAD_PATH,
			headBox: ROUTE_HEAD_VIEWBOX,
			linkHint: localize("stonetop.relmap.linkHint"),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];

		// Everything below points into the render being replaced.
		this._surface?.destroy();
		this._teardownDrag?.();
		// ⚠ WRITTEN OUT BEFORE IT IS THROWN AWAY. A re-render is not a reason to lose a sentence
		// somebody was in the middle of: `destroy` flushes nothing, so the flush is asked for here,
		// while the old bar still has both the id and the field.
		this._tieBar?.flush();
		this._tieBar?.destroy();
		this._surface = null;
		this._teardownDrag = null;
		this._tieBar = null;

		// Adopted BEFORE the early return. Left until after it, a render that somehow produced no
		// viewport would leave this pointing at the PREVIOUS render, and the next live update would
		// paint the board into a node that has already left the document.
		this._root = root;
		// Every element the last render's preview was holding has just been thrown away.
		this._preview = null;

		const view = root.querySelector(".stonetop-relmap-view");
		const board = root.querySelector(".stonetop-relmap-board");
		if (!view || !board) return;

		// The sheet THIS render was drawn on, from the plan `getData` just built. Falling back to a
		// fresh one for a render that somehow reached here without going through `getData` — and
		// for the tests, which call this directly.
		const sheet = (this._takePlan() ?? this._plan()).board;
		this._surface = new ZoomPanSurface({
			view, content: board,
			naturalWidth: sheet.width,
			naturalHeight: sheet.height,
			controls: BOARD_CONTROLS,
			menus: BOARD_MENUS,
			// A gentler wheel than a picture gets, because this board is arranged rather than
			// read. See `RELMAP_ZOOM_STEP`.
			zoomStep: RELMAP_ZOOM_STEP,
			// Every pan and every zoom step, because how big the held line's caption has to be set
			// to stay readable is a question about the scale. See `_paintCaptionZoom`.
			//
			// AND THE TIE BAR COMES WITH IT. The bar is chrome in the viewport rather than a thing
			// on the board (utils/relmap-tie-bar.js says why at length), so nothing moves it unless
			// it is told to -- and a bar left behind while the board slid out from under it is a bar
			// pointing at somebody else's line.
			onChange: surface => {
				this._paintCaptionZoom(surface);
				this._tieBar?.place();
			},
		}).attach();
		this._paintCaptionZoom(this._surface);

		// AFTER the surface, which it asks for its numbers, and after the board, which it marks.
		this._tieBar = new RelmapTieBar(root, {
			surface: () => this._surface,
			tieAt: id => this._tieAt(id),
			// ONE STEP FOR A BURST OF TYPING, keyed by the line. The bar writes within a breath of
			// the last keystroke, so a caption typed out in full is half a dozen writes; recorded
			// separately they would fill the history and take six presses to undo.
			//
			// ⚠ AND THE PEN IS PICKED UP ON THE WAY PAST. A colour, a stroke or a caption size
			// chosen here is what the NEXT line drawn on this map is born in; nothing already on
			// the board moves. Caught here rather than inside the bar because the bar is a DOM
			// component with no globals and no documents in it -- the same reason `onNudged` is a
			// handler rather than a notification raised there -- and because this is the one place
			// every route to those three passes through: the swatches, the five size steps, the hex
			// field, the number field, and the flush that a closing bar makes. See `_rememberPen`.
			onField: (id, fields) => {
				this._rememberPen(fields);
				return this._write(edgePatch(id, fields), {
					label: localize("stonetop.relmap.history.editedLink"), coalesce: `edge:${id}`,
				});
			},
			// THE KEYSTROKES THEMSELVES, WHICH ARE NOT A WRITE. The bar has no text box on it any
			// more: what the reader is typing goes on the line, here, at once -- while the write
			// above still waits out its delay so the table is not repainted per letter.
			onSaying: (id, said) => this._sayLine(id, said),
			// AND RUBBED OUT FROM THE SAME BAR, which is the one thing the window that used to open
			// here did that a table does mid-sentence. No confirm: see the button in the template.
			onRub: id => this._rubOutLink(id),
			// ⚠ SAID OUT LOUD WHEN A CHOSEN COLOUR HAD TO BE MOVED. A colour quietly swapped for a
			// different one is the board lying about what the reader chose; a colour refused is the
			// choice taken away and nothing given back. So it is deepened, used, and reported -- and
			// the notice NAMES the colour that was actually used, so somebody who wanted that exact
			// hex knows at once that they have not got it, and why. See `deepenInk`.
			onNudged: (chose, used) => ui.notifications?.info?.(
				format("stonetop.relmap.inkDeepened", { chose, used }),
			),
			// ⚠ THE COLOURS ALREADY ON THIS BOARD, READ OFF THE BOARD. Not a list remembered per
			// reader in a setting: a table that has settled on one particular purple wants that
			// purple on the next line too, and every client at that table wants the same offer --
			// which is exactly what the map itself already says, with nothing stored to say it
			// twice. It also stays true by itself: a colour the table stops using stops being
			// offered, because the lines drawn in it are gone.
			inksInUse: () => this._inksInUse(),
			// THE BOARD'S MARKUP IS THE WINDOW'S, and this is the fourth mark a repaint has to put
			// back, beside the lit web, the caption mode and the history buttons.
			onPicked: id => this._paintPickedLine(id),
			canEdit: () => this.canEdit,
		});

		this._teardownDrag = wireRelmapDrag(root, {
			surface: this._surface,
			canEdit: () => this.canEdit,
			// Asked per gesture, like `canEdit` above and for the same reason: ownership can change
			// under an open board, and a drag that writes to a map the reader may no longer edit is
			// a drag that appears to work and is silently thrown away.
			canMove: () => this.canEdit,
			canRemove: () => this.canEdit,
			nodeAt: id => {
				// An unwritten nudge is where the portrait actually is, so it answers first.
				if (this._pendingNudge.has(id)) return { ...this._pendingNudge.get(id) };
				const node = readGraph(this.boardDoc).nodes[id];
				return node ? { x: node.x, y: node.y } : null;
			},
			onMove: (id, at) => this._moveNode(id, at),
			onNudge: (id, at) => this._nudgeNode(id, at),
			onDragMove: (id, at) => this._previewMove(id, at),
			onDragEnd: (id, restore) => this._endPreview(id, restore),
			onLink: (a, b) => this._createLink(a, b),
			onLinkFrom: id => this._linkFrom(id),
			onOpen: id => this._openPerson(id),
			// A LINE TAKEN HOLD OF, which is the bar and no longer a window: everything a line
			// says is on the bar, and rubbing it out is the last press on it.
			onPickEdge: (id, from) => this._tieBar?.open(id, { returnTo: from ?? null }),
			// AND LET GO AGAIN, by a click that landed on bare paper. The board is the surface a
			// reader clicks around on while talking, so letting go has to be as easy as taking
			// hold: an X on the bar would be the only way out of a thing that opens on a click.
			onPickNone: () => this._tieBar?.close(),
			onRemove: id => this._removePerson(id),
			// THE MOUSE'S ROUTE TO THAT, and until now there was none: taking somebody off was the
			// Delete key and nothing else, which is a gesture with nothing on screen to suggest it
			// exists. A right press asks for the person's trash can; the next ordinary click
			// anywhere puts it away again.
			onArm: id => this._armRemove(id),
		});

		// The drag layer owns the board; these are the window's own chrome.
		root.querySelectorAll("[data-relmap-action]").forEach(button => {
			button.addEventListener("click", ev => this._onToolClick(ev));
		});

		// WHICH BOARD OF THIS MAP IS UP. Delegated from the strip rather than bound per tab,
		// because `_paintPages` replaces every tab in it whenever somebody at the far end of the
		// table adds or renames one, and handlers bound to the old buttons would go with them —
		// leaving a strip that looks right and does nothing.
		const strip = root.querySelector(".stonetop-relmap-pages-strip");
		strip?.addEventListener("click", ev => {
			const tab = ev.target.closest?.("[data-relmap-page]");
			if (tab) this.showPage(tab.dataset.relmapPage);
		});
		strip?.addEventListener("keydown", ev => this._onPageKey(ev));

		// CTRL+Z AND CTRL+SHIFT+Z, on the window as a whole rather than on the board. The reader's
		// hands are wherever they last were — a tool on the bar, a portrait, a tab in the strip —
		// and an undo bound to the board alone would be one that works only when it is focused.
		// What it refuses to take is a keystroke inside a text field; see `_onHistoryKey`.
		root.addEventListener("keydown", ev => this._onHistoryKey(ev));

		// A repaint held back while a drag or an edit was in the way, let through the moment it
		// clears. Both on a timeout so the handlers that END the obstruction run first: the drag
		// layer takes its class off in its own pointerup, which is bound before this one.
		const flush = () => setTimeout(() => this._flushPendingSync(), 0);
		root.addEventListener("focusout", flush);
		view.addEventListener("pointerup", flush);

		// The board is in the document but not yet painted, which is the first and cheapest moment
		// the captions can be measured and their gaps cut to what they really came out at.
		this._fitGapsToPaint();
		this._wireLighting(board);
		this._wireDrop(view);
		this._wireSync();
		// What this reader can take back lives on their own machine, not in the markup a render was
		// built from, and a fresh bar comes up with both buttons enabled until it is told otherwise.
		this._paintHistory();
		if (this._lit) this._lightPerson(this._lit);
		// A change that arrived WHILE this render was in flight, let through now that there is
		// markup to paint it into. On a timeout for the reason the other two flushes are: this
		// method is still running, and `_state` is not RENDERED until it returns, so a repaint
		// started here would meet the same "not rendered" guard that held the change back.
		setTimeout(() => this._flushPendingSync(), 0);
	}

	// ── Live updates ────────────────────────────────────────────────────────

	/**
	 * Repaint when this map changes anywhere in the world.
	 *
	 * Filtered cheapest-first, because EVERY journal write in the world arrives here.
	 *
	 * ⚠ `changed.flags[SYSTEM_ID]` in BRACKETS, never a dotted path. The package id is hyphenated,
	 * so `changed.flags.stonetop-pwd` parses as a subtraction and throws — inside a global hook,
	 * which takes down every other listener registered on it. See hooks/CondemnedTag.js.
	 */
	_wireSync() {
		if (this._hooks.length) return;
		const repaint = foundry.utils.debounce(() => this.sync(), SYNC_DEBOUNCE_MS);
		// Registered and remembered in one breath, so that a hook added here cannot be forgotten in
		// `close`. See `_hooks`.
		const on = (name, handler) => {
			Hooks.on(name, handler);
			this._hooks.push([name, handler]);
		};
		on("updateJournalEntry", (doc, changed) => {
			if (doc?.id !== this._entryId) return;
			// ⚠ WHO MAY EDIT THIS MAP IS NOT IN THE FLAG, and the window has to learn about it
			// anyway. Ownership decides the bar's tools, the link handles, the drag, the drop and
			// the `is-readonly` class on the root — none of which a repaint can change, because a
			// repaint replaces the board's markup and nothing else. So this one takes the full
			// render the rest of this handler goes out of its way to avoid.
			if (changed?.ownership || changed?.permission) { this.render(); return; }
			const bag = changed?.flags?.[SYSTEM_ID];
			if (!bag) return;
			// A deletion arrives as `-=key`, so the prefix is stripped before the comparison.
			const touched = Object.keys(bag).some(key => key.replace(/^-=/, "") === RELMAP_FLAG);
			if (touched) repaint();
		});

		// ⚠ AND THE MAP CAN BE DELETED OUT FROM UNDER THIS WINDOW. Nothing else would notice: this
		// is a StonetopDialog rather than a DocumentSheet (journal/RelationshipMapEntrySheet.js
		// explains why), so it is not in `entry.apps` and core's own sweep on delete never reaches
		// it — and the `entry` getter deliberately falls back to the document it was handed, which
		// after a delete is a stale in-memory copy still carrying its last flags and still
		// answering `isOwner`. The board would go on looking live, with every tool enabled, writing
		// into a document that is not there.
		on("deleteJournalEntry", doc => {
			if (doc?.id === this._entryId) this.close();
		});

		// ── And the same three questions again, one document down ────────────────────────────
		//
		// The graph lives on a PAGE now, so the writes this window makes all its evening arrive on
		// this hook rather than the one above. The entry's own hook is still wired, and still earns
		// it: ownership, and a map still on version 1 whose board is on the entry itself.
		//
		// FILTERED BY THE PARENT FIRST, because every page write in the world arrives here — a GM
		// typing in a lore entry at the other end of the sidebar included.
		on("updateJournalEntryPage", (page, changed) => {
			if (page?.parent?.id !== this._entryId) return;
			// A NAME OR AN ORDER IS THE STRIP'S BUSINESS, whichever page it happened to. Somebody
			// renaming the board this reader is NOT on still changes what the strip says.
			if ("name" in (changed ?? {}) || "sort" in (changed ?? {})) this._paintPages();
			// ⚠ AND SO IS A BOARD BEING HIDDEN OR SHOWN, which for a player is a tab APPEARING OR
			// VANISHING and not a mark changing on one. Handled here rather than left to the strip's
			// repaint because of the one case that is more than a repaint: the GM hiding the board
			// this player is standing on. `mapPage` falls through to the next one they may see, so
			// what that reader needs is the same full render a deletion gets — a different board is
			// a different shape, a different bar and a different fit. The `_pageId` is dropped
			// first, for the reason the delete path drops it: it names a board that is no longer
			// theirs, and left standing it would pin them to nothing.
			if ("ownership" in (changed ?? {})) {
				// ⚠ A REVEAL IS AS MUCH A RENDER AS A HIDE, and asking "was this a hide of the
				// board they are on" was the wrong question. `_paintPages` can only rewrite a strip
				// that is already there, and the two readers it cannot help are exactly the ones a
				// reveal is for: a player on a map whose every board was the GM's own has no strip
				// AND no board (`showPages` was false and `mapPage` null), and a player on a map
				// with one visible board has no strip either — so the GM presses the eye and the
				// first stays on "there is nothing here for you to see yet" while the second never
				// sees the new tab, both until they close the window and open it again.
				//
				// So the question is asked the other way round, in the two terms the render itself
				// is built from: has the BOARD under this reader changed, or has the strip's being
				// there at all? Either one is a different shape, a different bar and a different
				// fit, and the hide-the-board-I-am-standing-on case above is the first of them.
				const pages = this.mapPages;
				const board = this.mapPage;
				const moved = (board?.id ?? null) !== this._pageId;
				const strip = !!this._root?.querySelector(".stonetop-relmap-pages-strip");
				if (this.rendered && (moved || strip !== (this.canEdit || pages.length > 1))) {
					// Only where the board actually changed, and for the reason the delete path
					// drops it: the id names a board that is no longer theirs, and left standing it
					// would pin them to nothing. A strip appearing over the SAME board is not a
					// reason to put out the line this reader was holding.
					if (moved) {
						// While `_pageId` still names the board they belong to. See `_leaveBoard`.
						this._leaveBoard();
						this._pageId = null;
						this._lit = null;
						this._armed = "";
					}
					this.render();
					return;
				}
				this._paintPages();
			}
			// A graph is only this window's business when it is the graph being LOOKED AT. Two
			// people at one table working on two pages of the same map must not repaint each other;
			// that is the whole reason a board is its own document rather than another object
			// inside one shared flag.
			if (page.id !== this.mapPage?.id) return;
			const bag = changed?.flags?.[SYSTEM_ID];
			if (!bag) return;
			if (Object.keys(bag).some(key => key.replace(/^-=/, "") === RELMAP_FLAG)) repaint();
		});

		// A BOARD ARRIVING OR LEAVING IS A STRIP THAT HAS CHANGED, and one of the two is more than
		// that: the page this reader is standing on can be rubbed out from another client, and a
		// window left pointing at a deleted document would go on looking live while every write it
		// made vanished. `mapPage` falls through to the first surviving page, so what this needs is
		// a full render — the board, its shape and the whole bar all belong to a different page now.
		const onPageChange = (page, gone) => {
			if (page?.parent?.id !== this._entryId) return;
			// ⚠ NOTHING IS DRIVEN FROM A WINDOW THAT IS NOT ON SCREEN. `rendered` is false for a
			// CLOSED window as well as a mid-render one, and a `render()` from here would reopen a
			// board the reader had shut a moment before somebody else touched the map.
			if (!this.rendered) return;
			// The `|| !this._pageId` is a rail rather than an ordinary case: every render pins
			// `_pageId` to a concrete page, so an unpinned window is one that has not rendered yet,
			// and "whichever board comes first" is a board ANY deletion may have changed.
			if (gone && (page.id === this._pageId || !this._pageId)) {
				// The board under this reader has just been rubbed out at the far end of the table.
				// `mapPage` falls through to the first surviving page, and all three of these
				// belonged to the one that is gone — as does anything half-written, which is asked
				// for first so that it cannot be filed against the page fallen through to. A flush
				// aimed at the deleted document writes nothing, which is the right amount to write
				// to a board that no longer exists. See `_leaveBoard`.
				this._leaveBoard();
				this._pageId = null;
				this._lit = null;
				this._armed = "";
				this.render();
				return;
			}
			this._paintPages();
		};
		on("createJournalEntryPage", page => onPageChange(page, false));
		on("deleteJournalEntryPage", page => onPageChange(page, true));
	}

	/**
	 * Redraw the board, WITHOUT touching the zoom or the pan.
	 *
	 * The markup is replaced and the surface is left alone: scale and offset live on the surface,
	 * not in the DOM, so the reader keeps the corner they were looking at. A `render()` here would
	 * re-fit and throw it away — which is the state they were using when the change arrived.
	 *
	 * Deferred rather than dropped when it cannot be applied. A repaint under a live drag replaces
	 * the element the pointer is holding; one that arrives while the window is part-way through a
	 * render has no markup to paint into yet. Both flush the moment the obstruction clears, so
	 * nothing is ever silently lost.
	 *
	 * ⚠ "NOT RENDERED" IS TWO DIFFERENT ANSWERS. AppV1 sets `_state` to RENDERING before it awaits
	 * `getData` and only back to RENDERED after `activateListeners`, so `this.rendered` is false
	 * both for a window that is CLOSED — where the change is genuinely not this window's business
	 * any more — and for one that is mid-render, which is exactly the deferrable case. Dropped, the
	 * change is simply lost until somebody makes another. It matters because this window renders
	 * itself -- switching page does -- rather than only when Foundry makes it.
	 */
	async sync() {
		if (!this._root) return;
		if (!this.rendered) {
			// Mid-render: hold it. The render finishing is what lets it through (`activateListeners`
			// flushes), and a closed window keeps the old behaviour of dropping it on the floor.
			//
			// ⚠ THE STATE IS COMPARED ONLY WHEN THERE IS ONE TO COMPARE. `RENDER_STATES.RENDERING`
			// is 1, and a truthy number is the whole of the guard: written as
			// `this._state === Application.RENDER_STATES?.RENDERING` it reads `undefined ===
			// undefined` as TRUE wherever core's table is absent — under the test harness, and on
			// any future base class that does not carry one — so every closed window would start
			// hoarding changes it can never paint.
			const rendering = Application?.RENDER_STATES?.RENDERING;
			if (rendering !== undefined && this._state === rendering) this._pendingSync = true;
			return;
		}
		if (this._isBusy()) { this._pendingSync = true; return; }
		this._pendingSync = false;
		return this._repaintBoard();
	}

	/**
	 * The repaint itself, with no question asked about whether now is the moment for one.
	 *
	 * Separate from `sync` because the two callers differ on exactly that. A change from somebody
	 * else arrives whenever it arrives, and has to be held back if it would land under a live
	 * drag. This reader ticking a box in their own window IS the moment, and a deferred one would
	 * be a control that does nothing until they happen to click elsewhere — which is precisely
	 * what would happen, since the box takes focus on the click and a focused field is one of the
	 * things `_isBusy` counts.
	 */
	async _repaintBoard() {
		if (!this._root || !this.rendered) return;
		const board = this._boardEl();
		if (!board) return;
		const plan = this._plan();
		board.innerHTML = await this._renderBoard(plan);
		// The captions exist now, so the gaps cut for them can stop being guesses.
		this._fitGapsToPaint();
		// The sheet itself may have changed size, because somebody else put another person on it.
		// The reader keeps their zoom either way: the surface only re-fits a board nobody has placed.
		this._surface?.setNaturalSize(plan.board.width, plan.board.height);
		// The lines and labels the preview was holding are gone with the markup.
		this._preview = null;
		// So is every mark the highlight had put on them. The pointer is very likely still resting
		// on the same face, and a repaint that quietly dropped the web it was lighting would look
		// like the highlight failing at the moment somebody else touched the board.
		if (this._lit) this._lightPerson(this._lit);
		// AND SO IS THE TRASH CAN THE READER HAS JUST ASKED FOR, for exactly the same reason: the
		// portrait it was painted on is gone with the rest of the markup, and a can that vanished
		// because somebody at the far end of the table nudged a different portrait would look like
		// the button failing at the moment it was aimed at. `_armRemove` drops it by itself when the
		// repaint is the one that carried that person off — somebody else got there first, and
		// there is nobody left to bin.
		if (this._armed) this._armRemove(this._armed);
		// AND SO IS THE MARK ON THE LINE THE READER IS HOLDING, for the same reason and with one
		// more: the bar itself survives (it is outside the board), so without this it would go on
		// floating over a picture with nothing on it saying which line it belongs to. `refresh`
		// also lets go of a line somebody else has just rubbed out. It deliberately does NOT
		// refill the caption field -- see its own note.
		this._tieBar?.refresh();
		// A LINE DRAWN A MOMENT AGO, now that there is a paint with it in. `_tieAt` answers off
		// `_drawn`, which is what the two lines above have just rebuilt, so this is the first
		// moment the bar can be placed over a line that did not exist when it was drawn.
		if (this._pendingPick) {
			const pick = this._pendingPick;
			this._pendingPick = "";
			this._tieBar?.open(pick);
		}
		this._paintChrome(plan);
	}

	/**
	 * Lay one measured caption on its line: the words, the rail they sit on, the hole cut for them.
	 *
	 * ⚠ ONE COPY BECAUSE THE TWO CALLERS HAVE TO AGREE. A full pass (`_fitGapsToPaint`) and the
	 * live caption a reader is typing (`_sayLine`) both land here, and `_sayLine` exists to show
	 * exactly what the next paint will show -- the same cut at the same place and a hole in the
	 * stroke cut for exactly that, so that nothing jumps when the write finally comes back round.
	 * Written out twice that promise was kept only by the two copies staying identical, and nothing
	 * checked that they did; the caption size a line can carry was threaded through both by hand.
	 *
	 * ⚠ AND THE CAPTION IS RE-SEATED, which it did not used to be. A caption is a straight run laid
	 * over a bowed line, and WHICH straight run depends on how long the words are: the one whose two
	 * ends land on the stroke either side of the hole (`edgeLabelAnchor`). Cut the sentence shorter
	 * -- or grow it a letter at a time, as somebody typing does -- and that run turns a little and
	 * moves a little, so a caption left at the seat the estimate chose is a caption pointing a few
	 * degrees off the hole now cut for it. It is where ALONG the line it sits that does not move:
	 * the spreader settled that, and `anchor.t` is carried through untouched.
	 *
	 * @param {object} shape The line's geometry, from `edgeShapes`. Its seat and its gap are updated.
	 * @param {object} parts That line's markup, from `indexEdgeParts`.
	 * @param {{text: string, width: number}} fit What `fitCaption` said would fit, and its width.
	 * @returns {number} The painted width, for `_drawn.painted`.
	 */
	_seatCaption(shape, parts, fit) {
		const drawn = this._drawn;
		if (parts.words.textContent !== fit.text) parts.words.textContent = fit.text;
		const size = captionSize(shape.edge.label, shape.curve, {
			boardWidthPx: drawn.board.width, paintedPx: fit.width, px: shape.edge.size,
		});
		shape.size = size;
		shape.anchor = edgeLabelAnchor(shape.curve, RELMAP_BOARD_ASPECT, shape.anchor.t, size.w)
			?? shape.anchor;
		placeCaption(parts, shape.anchor, drawn.board);
		shape.d = curveWithGap(shape.curve, {
			t: shape.anchor.t, span: size.w, boardWidthPx: drawn.board.width, dir: shape.edge.dir,
		});
		parts.line?.setAttribute("d", shape.d);
		return fit.width;
	}

	/**
	 * Fit every caption to the words that are actually in it, now that there is a board to ask.
	 *
	 * WHY THERE IS A SECOND PASS OVER MARKUP THAT WAS JUST BUILT. Three things about a caption are
	 * its own width and nothing else: the words it can hold at all, how far along its line the words
	 * reach, and the hole cut in the stroke for them to sit in (`curveWithGap`). Until this window
	 * opened, that width was a character count times a
	 * constant. The estimate errs large on purpose -- it is what keeps the spreader from packing
	 * two captions that turn out to touch -- and on this face at this size it errs large by about
	 * a fifth. On a chip of two words nobody could see it. On the full sentences a caption now
	 * carries it is a hundred and forty pixels of line rubbed out for words that were never there,
	 * seventy at each end, and the reader sees a sentence floating in a hole far too big for it
	 * with its line picking up again somewhere off in the distance.
	 *
	 * SO THE WORDS ARE MEASURED, in the face the stylesheet actually painted in, against a canvas
	 * rather than against the element (`captionMeasurer` says why). Then: cut to what will fit,
	 * re-railed to what that measured, and the stroke re-broken for exactly that. Nothing here
	 * moves a caption -- where each one SITS was settled by the spreader and stays settled; what
	 * changes is how much room it was given credit for.
	 *
	 * THE ESTIMATE IS STILL WHAT PLACED THEM, and that is right rather than a shortcut: the
	 * spreader has to run before there is anything to measure, and slack in the direction of
	 * "leave a little more room than needed" is the direction a spreader should err in anyway.
	 * What is fixed here is everywhere the slack was visible.
	 */
	_fitGapsToPaint() {
		const drawn = this._drawn;
		const board = this._boardEl();
		if (!drawn?.shapes?.size || !board) return;
		const parts = indexEdgeParts(board);
		// KEPT BEFORE THE EARLY RETURN BELOW, because a board with no caption on it to measure is
		// still a board `_sayLine` will be asked to write one onto. Dies with `_drawn` on the next
		// paint, alongside the markup it points into.
		drawn.parts = parts;
		const measurer = captionMeasurer(parts);
		if (!measurer) return;
		const { font, px, measure } = measurer;
		// What the captions are actually set in, for the zoom at which they stop being worth
		// drawing. Kept with the rest of what this pass measured, and re-asked here rather than
		// once at open: a reader who changes the interface font size changes this too.
		if (px) drawn.captionPx = px;
		// KEPT FOR THE LIVE CAPTION, which re-fits ONE of these on every keystroke and has no
		// business asking the document for a computed style on each -- building a measurer reads
		// one off a real caption. Thrown away with the rest of `_drawn` on the next paint, so it
		// cannot outlive the face it was built from.
		drawn.measure = measure;
		this._paintCaptionZoom(this._surface);
		const painted = new Map();
		for (const [id, shape] of drawn.shapes) {
			if (!shape.curve || !shape.anchor) continue;
			const found = parts.get(id);
			if (!found?.words) continue;
			// WHAT WILL FIT, AND WHAT IT MEASURES. A caption longer than the room its line has is
			// cut here rather than by the stylesheet: SVG has no `text-overflow`, so a caption left
			// uncut would simply run on past both ends of the line it belongs to. The whole
			// sentence is in the tooltip either way.
			//
			// ⚠ MEASURED AT THE SIZE THIS LINE IS SET IN, not at the board's. A line the reader has
			// made bigger fits FEWER words in the same stretch of stroke -- the room is the line's
			// length and does not grow with the type -- so a cut made against the ordinary twelve
			// would run a big caption on past both ends of its line and open a hole far too small
			// for it.
			const said = fitCaption(
				shape.edge.label, shape.labelMax, measureAt(measure, shape.edge.size),
			);
			painted.set(id, this._seatCaption(shape, found, said));
		}
		// KEPT FOR THE LIVE DRAG, which re-cuts these same gaps sixty times a second and has no
		// business asking the document for a layout on any of those frames. Measured once here and
		// read from `_beginPreview`, so a dragged line breaks for the same words as a still one.
		drawn.painted = painted;
		// LAST, because the loop above has just written the BROKEN `d` onto every stroke. Where the
		// captions are not being drawn at all those holes have to go again — and the flag is cleared
		// first, so this is not mistaken for a state the board is already in.
		drawn.healed = null;
		this._paintLineGaps();

		// A CAPTION MEASURED IN THE WRONG FACE is a rail cut for the wrong words, and a caption
		// longer than its rail loses the words that fall off the end of it. This all but never fires
		// -- the map is opened out of a world whose sheets have been drawing in this face since it
		// loaded -- but when it does, everything on the board is measured wrong at once.
		//
		// ASKED WITH `check` AND LOADED BY NAME, not left to `ready`. A face nothing has painted
		// with yet is not a PENDING load, so `document.fonts.ready` resolves perfectly happily
		// while the face this board is about to be set in has never been fetched — which is exactly
		// the state a window opening first in a fresh session would be in. `check` asks the only
		// question that matters, and `load` is what makes the answer become yes.
		const fonts = this._root?.ownerDocument?.fonts;
		if (fonts?.check && !fonts.check(font) && !this._awaitingFonts) {
			this._awaitingFonts = true;
			// The flag goes back either way, so a face that never arrives cannot wedge the
			// re-measure off for the rest of the window's life.
			(fonts.load ? fonts.load(font) : fonts.ready)
				.then(() => {
					this._awaitingFonts = false;
					if (this.rendered) this._fitGapsToPaint();
					return null;
				})
				.catch(() => { this._awaitingFonts = false; });
		}
	}

	/**
	 * Put what the reader is typing onto one line, now, without writing anything.
	 *
	 * THIS IS WHERE THE TIE BAR'S TEXT BOX WENT. A caption is words drawn along a stroke; a box on
	 * a strip of chrome showed the sentence somewhere other than the thing it belonged to, and the
	 * reader only found out how it really looked -- how much of it fitted, how big a hole it opened
	 * in the line -- once they had stopped typing and the write had come back round. So the letters
	 * land here instead, on the line, as they are typed.
	 *
	 * ⚠ IT WRITES NOTHING AND BROADCASTS NOTHING. One caption in this reader's own window: the
	 * document still waits out TIE_WRITE_DELAY_MS, because a write is a repaint of every board at
	 * the table and a sentence is thirty of them. The next repaint rebuilds this caption from the
	 * document like any other, and the bar puts a half-typed one back afterwards (`refresh`).
	 *
	 * ⚠ AND `shape.edge.label` IS MOVED WITH IT, which is not bookkeeping. `_fitGapsToPaint` and
	 * the drag preview both re-cut this line's gap from that field, and a font arriving or a
	 * portrait moving mid-sentence would otherwise re-cut it for the words the reader has stopped
	 * saying. The graph in `_drawn` is a fresh object built by `readGraph` for this paint, so
	 * nothing outside this window can see the change.
	 *
	 * THE SAME FIT AND THE SAME GAP AS A REAL PAINT, so nothing jumps when the write finally lands
	 * -- a caption cut at the same place by the same measurer, and a hole in the stroke cut for
	 * exactly that. Except when the captions are away entirely: see below.
	 */
	_sayLine(id, said) {
		const drawn = this._drawn;
		const shape = drawn?.shapes?.get(id);
		if (!shape?.curve) return;
		// FOUND IN THE INDEX THE PAINT ALREADY WALKED, and walked afresh only when there is not one.
		// This fires on every keystroke, and re-walking every line's markup on the board to reach
		// one of them was the whole board's work for one caption. The index is kept on `_drawn` and
		// dies with it, so it cannot outlive the markup it points into -- which is the failure a
		// second module keeping its own list of a line's parts has already had once.
		let index = drawn.parts;
		if (!index) {
			const board = this._boardEl();
			if (!board) return;
			index = indexEdgeParts(board);
		}
		let parts = index.get(id);
		shape.edge.label = said;
		// NOTHING WRITTEN ON IT IS NOT A CAPTION OF NO WORDS. A reader who rubs out what they had
		// typed gets back the line they started with -- the words away, the stroke whole -- which
		// is exactly what the next real paint gives them: `edgeShapes` hands a line with no label
		// no seat and no caption at all. Left to fall through, an empty sentence would still be
		// seated, and the halo's own trim would hold a small hole open in the stroke for words
		// that are no longer there.
		if (!said) {
			if (parts?.words) parts.words.textContent = "";
			shape.anchor = null;
			shape.size = null;
			shape.d = shape.unbroken ?? shape.d;
			parts?.line?.setAttribute?.("d", shape.d);
			drawn.painted?.delete(id);
			return;
		}
		// ⚠ A LINE NOBODY HAS WRITTEN ON YET HAS NO CAPTION TO WRITE ONTO, and that is the commonest
		// way into this method rather than a corner of it: draw a line, the bar opens over it, type.
		// A line with no label is given no seat and no `<text>` by the paint (`edgeShapes`, and the
		// `labels` loop in `getData`), so every keystroke found nothing here and returned -- and
		// since the bar's own field is clipped to a pixel, the reader typed a whole word into a
		// window that showed it nowhere until the debounced write came back round.
		//
		// So the caption is MINTED, and the seat taken from the honest middle of the stroke -- the
		// same spot the tie bar is already floating over, which is where a first caption should
		// appear. From the next keystroke on this is an ordinary live caption; the write that
		// follows replaces the whole board's markup with a properly built one.
		if (!parts?.words) {
			parts = mintCaption(this._boardEl(), id, shape, index);
			if (!parts) return;
		}
		shape.anchor ??= shape.mid;
		if (!shape.anchor) return;
		// HOW WIDE THIS ONE MAY GET, worked out here for the same reason: `edgeShapes` only asks it
		// of a line that already had a caption. Asked once and kept on the shape, as that loop
		// keeps it -- it is the line's length, and nothing being typed changes that.
		shape.labelMax ??= Math.round(captionRoomPx(shape.curve, {
			boardWidthPx: drawn.board.width,
		}));
		// ⚠ NOT FITTED AND NOT GAPPED WHILE THE READER HAS THE WORDS TURNED OFF. In that state the
		// board shows this one caption and no other (the stylesheet keeps the held line's, so that
		// whoever is typing can still see what they are typing), and every stroke on it is healed.
		// Cutting a hole under the one visible caption would be the only broken line on the board,
		// and cutting the sentence to fit would hide the tail of what they are writing behind an
		// ellipsis. Zoom does not reach this: a board zoomed out is still drawing every caption.
		const tiny = this._captionsHidden();
		// At the size THIS line is set in, as the full pass measures it: the same cut and the same
		// gap, or the words would jump the moment the write lands. See `_fitGapsToPaint`.
		const fit = (!tiny && drawn.measure)
			? fitCaption(said, shape.labelMax, measureAt(drawn.measure, shape.edge.size))
			: { text: said, width: null };
		if (tiny) {
			if (parts.words.textContent !== fit.text) parts.words.textContent = fit.text;
			return;
		}
		// THE SAME SEAT AND THE SAME HOLE A REAL PAINT WOULD CUT, because it is the same code that
		// cuts them (`_seatCaption`) -- including the re-seat as the sentence grows, without which
		// the words would swing out of the hole being cut for them, one letter at a time, in front
		// of whoever is typing.
		//
		// ⚠ SEATED FIRST AND FILED AFTERWARDS, in two statements and not one. Written as
		// `painted?.set(id, this._seatCaption(...))` the optional call swallows its own ARGUMENTS:
		// where nothing has been measured yet -- which is exactly a board whose only line is the one
		// being written on, since `_fitGapsToPaint` gives up on a board with no caption to measure
		// -- the seating never happened at all and the keystroke went nowhere.
		const width = this._seatCaption(shape, parts, fit);
		drawn.painted?.set(id, width);
	}

	/**
	 * The window's chrome outside the board: what each panel says, and whether it shows at all.
	 *
	 * ONE DERIVATION, TWO WRITERS OF IT. `getData` spreads this into the first render's markup and
	 * `_paintChrome` writes the same answers onto the elements afterwards, because a repaint
	 * replaces the board and nothing else -- the chrome has to stay put while the board is panned
	 * and zoomed underneath it. Derived separately in the two places it would be two spellings of
	 * one question, and the wrong one would be right until the moment somebody else touched the map.
	 *
	 * ALL OF IT CAN CHANGE UNDER AN OPEN WINDOW, which is why none of it is left to the render that
	 * first drew it: somebody at the far end of the table taking the last person off the board is
	 * the moment the empty panel is wanted, and somebody rubbing out the last of the lines an old
	 * import left behind is the moment this reader stops having anything to hide.
	 */
	_chrome(plan) {
		const nobody = !Object.keys(plan.graph.nodes).length;
		// ⚠ A MAP WITH BOARDS AND NOT ONE OF THEM THIS READER'S TO SEE, which is a different empty
		// from an empty board and has to say so. Every board starts hidden from the players, so this
		// is what a player meets on a map the GM has not shown them any of yet — and told "nobody is
		// on this board yet, add somebody" they would reasonably conclude the map was broken, or
		// theirs to fill in. It is also the state in which the window has nothing to write to (see
		// `noBoardForMe`), which is why `canEdit` is already false here and the button already gone.
		const unshared = this.noBoardForMe;
		return {
			empty: nobody || unshared,
			// ⚠ THE HEADLINE IS DERIVED HERE TOO, though it never changes, because `_paintChrome`
			// WRITES every part of the panel it repaints. Left in `getData` alone, as it was, this
			// came back `undefined` on every repaint and the writer blanked the sentence outright:
			// the empty board would appear carrying only its hint and its button until the next full
			// render. Nothing in a panel may be settled in one of the two writers only.
			emptyLead: localize(
				unshared ? "stonetop.relmap.unsharedLead" : "stonetop.relmap.emptyLead",
			),
			// ⚠ AND SO IS WHAT IT OFFERS, for the same reason and one step further on: whether the
			// reader may add anybody is an ownership question, and ownership changes under an open
			// window.
			emptyHint: localize(
				unshared ? "stonetop.relmap.unsharedHint"
					: this.canEdit ? "stonetop.relmap.emptyHint" : "stonetop.relmap.emptyHintReadonly",
			),
			emptyAction: this.canEdit
				? { action: "add", label: localize("stonetop.relmap.add"), icon: "fa-user-plus" }
				: null,
			// ⚠ IN THE CHROME AND NOT ONLY IN `getData`, for the reason everything else here is: a
			// repaint that rebuilt the box from a render's context would tick it back on, or off,
			// under a reader who had just set it the other way. See `_chrome`.
			hideLabels: this._hideLabels,
		};
	}

	/**
	 * One panel over the board: its two sentences and its one button.
	 *
	 * ⚠ THE BUTTON IS THE HALF THAT IS EASY TO MISS. A panel is `inset: 0` and takes no pointer
	 * events; its button is the only thing inside it that opts back in, and so the only thing in the
	 * whole viewport a reader can tab to while it is up. It is WRITTEN rather than merely unhidden
	 * because whether there is one at all changes without a render: an ownership change takes away
	 * the right to add anybody.
	 */
	_paintPanel(panel, { lead, hint, action }) {
		if (!panel) return;
		const words = panel.querySelector(".stonetop-relmap-empty-lead");
		if (words) words.textContent = lead ?? "";
		const said = panel.querySelector(".stonetop-relmap-empty-hint");
		if (said) said.textContent = hint ?? "";
		const cta = panel.querySelector(".stonetop-relmap-empty-cast");
		if (!cta) return;
		cta.hidden = !action;
		if (!action) return;
		cta.dataset.relmapAction = action.action;
		const label = cta.querySelector("span");
		if (label) label.textContent = action.label;
		const icon = cta.querySelector("i");
		if (icon) icon.className = `fas ${action.icon}`;
	}

	/**
	 * That same chrome, written onto the elements a repaint has left standing.
	 *
	 * THE PANEL'S WORDS ARE WRITTEN TOO, not just its `hidden`. A panel that appeared still carrying
	 * the sentence the last render happened to leave in it would be a panel telling the reader about
	 * a situation they are no longer in.
	 */
	_paintChrome(plan) {
		const root = this._root;
		if (!root) return;
		const said = this._chrome(plan);
		this._toggleEmpty(said.empty);
		this._paintPanel(root.querySelector(".stonetop-relmap-empty"), {
			lead: said.emptyLead, hint: said.emptyHint, action: said.emptyAction,
		});
		// THE CAPTIONS BOX, WRITTEN BACK RATHER THAN LEFT ALONE. Nothing but the reader moves it, so
		// on nearly every repaint both of these are already right; they are written anyway because a
		// repaint that left them out would be a state settled in one of the two writers only, which
		// is the fault `emptyLead` above was fixed for. The class is what actually takes the words
		// off the board -- see `_toggleLabels`.
		root.classList?.toggle?.("captions-off", !!said.hideLabels);
		const box = root.querySelector("[data-relmap-action='hidelabels']");
		if (box) box.checked = !!said.hideLabels;
	}

	// ── The pages of one map ────────────────────────────────────────────────

	/**
	 * Give this map its first page, once, before anything is drawn.
	 *
	 * A map written before pages existed keeps its whole board on the entry, and this is where it
	 * is moved onto one — as an ordinary write by whoever opened it, not as a world migration. See
	 * `ensureFirstMapPage`, which does the work and refuses politely for a reader who may only look.
	 *
	 * THE GUARD IS SET BEFORE THE AWAIT, deliberately. A second render starting while the create is
	 * still in flight would otherwise find no pages either and make a second one, and the map would
	 * open with its board duplicated across two tabs.
	 *
	 * Its failure is swallowed and logged rather than thrown: the board behind it is perfectly
	 * readable off the entry, and a window that refuses to open is a worse answer to "the page could
	 * not be created" than a window with one unnamed tab.
	 */
	async _ensurePage() {
		if (this._pagesReady) return;
		this._pagesReady = true;
		try { await ensureFirstMapPage(this.entry); }
		catch (err) { console.warn("Stonetop | relationship map could not be given its first page", err); }
		// AND THEN THE PARTY'S OWN BOARD, in the same guarded once-per-window pass and after the
		// first page for the reason `createMapPage` gives. Its own try/catch, so a map that cannot
		// be given a party board still opens with everything else it has.
		try { await this._syncPartyPage(); }
		catch (err) { console.warn("Stonetop | relationship map could not update the party board", err); }
		// AND THE VILLAGE ONTO THE MAP'S OWN BOARD, last and in its own try/catch for the same
		// reason: a steading that cannot be read must not cost the map its party board or its pages.
		try { await this._syncVillagePage(); }
		catch (err) { console.warn("Stonetop | relationship map could not seat the village", err); }
	}

	/**
	 * Make or top up the board called "The Party".
	 *
	 * ⚠ THE ONE PLACE THIS WINDOW READS ANYTHING BUT THE MAP, and it is what the whole feature was
	 * asked for: "I don't want to have to manually add the party members. I want them to
	 * automatically be on their own sheet named The Party." So the party seat themselves on a board
	 * of their own, with an arrow for every introduction answer that names another of them.
	 *
	 * ⚠ THE CHRONICLE'S OWN STORE, `introductionsAnswers`, and NOT the PC flags underneath it.
	 * Those flags are where a player types; the primary GM harvests them into this setting, and the
	 * Chronicle's pages are compiled from the setting. Reading the flags instead would draw a line
	 * for an answer still being typed, and the board would show a bond the Chronicle page beside it
	 * does not.
	 *
	 * ⚠ `getObjectSetting` AND NOT `getSetting`, which THROWS on a key a world never registered. A
	 * throw here is not one missing line: it is inside `_render`, so it is a window that will not
	 * open, on a world whose only fault is that it never ran the introductions.
	 *
	 * THROUGH `partyCharacters()`, the same reader every other part of this system uses, so nothing
	 * here can form a second opinion about who the player characters are.
	 *
	 * ⚠ THE PRIMARY GM AND NOBODY ELSE, which is a RACE guard and the one thing here that is not
	 * obvious. This runs unasked, on open, on every client that may edit -- and the ids it mints are
	 * fresh each time. Two people opening the map in the same minute after a new answer was recorded
	 * would each work out the same missing line, mint a different id for it, and both write: two
	 * copies of one answer, and no way afterwards to tell which to rub out. The first page's own
	 * create race is survivable because it costs one duplicate tab once ever; this one would keep
	 * costing, every time the Chronicle grew.
	 *
	 * The same guard the harvest itself runs under (dialogs/IntroductionsDialog.js), and for the
	 * same reason: `introductionsAnswers` is a world setting only the primary GM writes, so the
	 * board that follows it belongs to the same client. A player opening the map sees whatever the
	 * GM's client has already put there, which on any table where the GM has opened the map once is
	 * all of it.
	 */
	async _syncPartyPage() {
		// ⚠ THE GUARD IS UNCONDITIONAL, because the automatic pass is now the only pass. This runs
		// on open on every client that may edit and mints fresh ids, so two people opening the map
		// in the same minute would each write the same missing line under a different id.
		if (!isPrimaryGM()) return null;
		const pcs = this._partyReaders();
		const said = await syncPartyPage(
			this.entry, pcs, introRegards(pcs, getObjectSetting("introductionsAnswers")),
		);
		if (!said) return null;
		// SAID OUT LOUD, and it is worth saying even though nobody asked: a tab appearing by itself,
		// or lines arriving on a board somebody is not looking at, is a change to a shared document
		// that nobody pressed a button for.
		ui.notifications?.info?.(format("stonetop.relmap.pages.partySeeded", {
			name: said.page?.name ?? localize("stonetop.relmap.pages.party"),
			people: said.addedPeople,
			lines: said.addedLines,
		}));
		return said;
	}

	/**
	 * The party, in the shape everything that reads the introductions wants them in.
	 *
	 * ONE SPELLING, and through `partyCharacters()` like everything else: three readers with three
	 * ideas of who the player characters are is three boards that disagree. The `slug` is what a
	 * stored question INDEX is an index into, so it travels with them. (It was shared with the
	 * answer matcher until that button was taken off this window; the party board's own seeding is
	 * what reads it now.)
	 */
	_partyReaders() {
		return (partyCharacters() ?? []).map(actor => ({
			id: actor.id, uuid: actor.uuid, name: actor.name, img: actor.img ?? "",
			slug: playbookSlug(actor),
		}));
	}

	/**
	 * Seat the steading's residents on this map's village board.
	 *
	 * ⚠ THE PRIMARY GM ALONE ON THE AUTOMATIC PASS, the guard `_syncPartyPage` explains at length
	 * and for the identical reason: this runs unasked on open on every client that may edit, and it
	 * mints a fresh id per person, so two people opening the map in the same minute would each seat
	 * the whole village under different ids and the board would hold everybody twice. ASKED, it is
	 * one person pressing one button and watching the count come back.
	 *
	 * THE RESIDENTS AND NOBODY ELSE, off the steading's own roster. Neighbours are a different list
	 * on that sheet and are added by hand from the chooser, which is where the reader can see which
	 * list somebody is on before they put them anywhere.
	 */
	async _syncVillagePage() {
		if (!isPrimaryGM()) return null;
		const steading = getStonetopSteadingActor();
		const residents = steadingListActors("residents", steading)
			.map(actor => ({ uuid: actor.uuid, name: actor.name, img: actor.img ?? "" }));
		if (!residents.length) return null;
		const said = await syncVillagePage(this.entry, residents);
		if (!said) return null;
		// SAID OUT LOUD EITHER WAY. A dozen faces arriving on a shared board that somebody else is
		// looking at is a change nobody pressed a button for, and the count is how they know what
		// happened rather than that the map broke.
		ui.notifications?.info?.(format("stonetop.relmap.pages.villageSeeded", {
			name: said.page?.name ?? "",
			people: said.addedPeople,
		}));
		return said;
	}

	/** The DOM id of one page's tab. Per WINDOW, not per page: two maps can be open at once, and an
	 * id repeated across two windows is an `aria-labelledby` pointing at the wrong board. */
	_pageTabId(pageId) {
		return `${this.id}-page-${pageId}`;
	}

	/**
	 * THE STRIP, as markup.
	 *
	 * Built here rather than in the template for the reason the board is: it is
	 * written twice — once by the render and once by a repaint, when somebody at the far end of the
	 * table has added or renamed a board — and only one of those two writers can use Handlebars. So
	 * the window builds the string and the template drops it in whole.
	 *
	 * ⚠ WHICH MEANS THE ESCAPING IS OURS. A page name is text somebody at this table typed.
	 *
	 * A MAP STILL ON VERSION 1 GETS ONE TAB NAMED AFTER ITSELF. It has no pages — its board is on
	 * the entry — and an empty strip above a board full of people reads as a window that has lost
	 * something. The tab carries no id, so pressing it does nothing, which is right: there is
	 * nowhere else to go. A reader who may edit will not see this for longer than one render, since
	 * `_ensurePage` is converting the map underneath them as they look at it.
	 *
	 * ROVING TABINDEX, so the strip is ONE tab stop with arrow keys inside it rather than one stop
	 * per board. On a map with eight pages the other spelling puts eight stops between the bar and
	 * the board for every reader who moves by keyboard.
	 *
	 * ⚠ A TAB SAYS THE BOARD'S NAME AND NOTHING ELSE. It briefly carried an eye in front of the
	 * names of the boards the players could see, and that was one mark too many: every board starts
	 * hidden, so what the mark actually did was put a second glyph on a row whose whole job is to
	 * say WHICH BOARD IS UP, competing with the underline that answers that. Where a board stands is
	 * the eye in the tools beside the strip, which is one place and not eight. (This also means the
	 * strip's markup does not change when a board is hidden or shown, which `_paintPages` has to
	 * know: see the note at the top of it.)
	 */
	_pageTabs(pages = this.mapPages, chosen = this.mapPage?.id ?? "") {
		// The system's one audited escaper (utils/strings.js), not foundry.utils.escapeHTML: same
		// five-character map, and Foundry-free, which is what lets the tests exercise this method.
		const esc = escHtml;
		const rows = pages.length
			? pages.map(page => ({ id: page.id, name: page.name }))
			: [{ id: "", name: this.entry?.name ?? localize("stonetop.relmap.untitled") }];
		return rows.map(row => {
			const on = row.id === chosen;
			return `<button type="button" class="stonetop-relmap-page${on ? " is-current" : ""}"`
				+ ` role="tab" id="${esc(this._pageTabId(row.id))}"`
				+ ` aria-selected="${on ? "true" : "false"}" tabindex="${on ? "0" : "-1"}"`
				+ ` data-relmap-page="${esc(row.id)}">${esc(row.name)}</button>`;
		}).join("");
	}

	/**
	 * THE EYE: whether it is there at all, what it shows, and what it says.
	 *
	 * ONE DERIVATION AND TWO WRITERS OF IT, the shape `_chrome` keeps and for the same reason. Every
	 * part of this changes without a render — the GM presses the button, or a second GM presses
	 * theirs, or the reader moves to another board — so a render spelling it one way and a repaint
	 * another would leave the wrong one right until something else forced a full render.
	 *
	 * ⚠ THE GLYPH SAYS WHERE THE BOARD STANDS AND THE HINT SAYS WHAT PRESSING DOES, which is the
	 * only pairing that reads correctly on a control that is both a state and a switch. An open eye
	 * on a shown board, a struck one on a hidden board; the sentence under the pointer names the
	 * outcome, as every button in this system does.
	 */
	_seenTool(page = this.mapPage) {
		const dark = isMapPageHidden(page);
		return {
			// ⚠ THE BUTTON IS ALWAYS IN THE MARKUP AND HIDDEN WHEN IT DOES NOT APPLY, for the reason
			// the delete button beside it is: a repaint can only write onto what a render left
			// standing, and behind an `{{#if}}` this control would exist only on the maps that
			// already had a board when the window last rendered.
			pageHideOn: this.canHidePages && !!page,
			pageHidden: dark,
			pageHideIcon: dark ? "fa-eye-slash" : "fa-eye",
			pageHideHint: localize(
				dark ? "stonetop.relmap.pages.showHint" : "stonetop.relmap.pages.hideHint",
			),
		};
	}

	/**
	 * Write the strip again after a repaint, and only when it has actually changed.
	 *
	 * THE GUARD IS THE POINT, not an optimization. This runs on every repaint — which is every time
	 * anybody at the table moves a portrait — and rewriting the strip's markup destroys the element
	 * the reader may have their keyboard focus on, mid arrow-key walk along the tabs. Compared as
	 * the STRING it was built from.
	 */
	_paintPages() {
		// ⚠ THE EYE IS WRITTEN BEFORE THE GUARD, AND THAT IS LOAD-BEARING. Hiding or showing a board
		// leaves the strip's markup untouched — a tab says the board's name and nothing about who
		// can see it (`_pageTabs`) — so the string comparison below returns before anything else
		// runs, and the glyph would go on saying "the table can see this" over a board the GM had
		// just taken back. It was briefly safe under the guard, when a tab carried a mark of its
		// own; the mark is gone and this is what the guard no longer covers.
		// RESOLVED ONCE FOR THE WHOLE PASS, the same hoist `getData` makes and for the same reason.
		// `mapPages` filters the entry's pages by what this reader may see and sorts them, and
		// `mapPage` walks that again; the eye, the tabs, the panel's label and the delete button
		// between them were asking five times over for the same two answers, on a method that runs
		// on every page created, deleted, renamed or shown at the table, per open board.
		const pages = this.mapPages;
		const page = pages.find(one => one.id === this._pageId) ?? pages[0] ?? null;
		this._paintSeen(page);
		const strip = this._root?.querySelector(".stonetop-relmap-pages-strip");
		if (!strip) return;
		const tabs = this._pageTabs(pages, page?.id ?? "");
		if (tabs === this._pagesSaid) return;
		this._pagesSaid = tabs;
		strip.innerHTML = tabs;
		// The board is the panel for whichever tab is now selected, and which tab that is can have
		// changed without a render: somebody else deleting the page this reader was on moves them.
		const view = this._root?.querySelector(".stonetop-relmap-view");
		if (view) view.setAttribute("aria-labelledby", this._pageTabId(page?.id ?? ""));
		// Whether the last board can be rubbed out depends on how many there are, which is exactly
		// what has just changed.
		const drop = this._root?.querySelector("[data-relmap-action=\"pagedelete\"]");
		if (drop) drop.hidden = !(this.canEdit && pages.length > 1);
	}

	/**
	 * Write the eye onto the button a repaint left standing.
	 *
	 * ⚠ CALLED FROM `_paintPages` AHEAD OF ITS GUARD, never under it. The guard compares the strip's
	 * markup, and a tab says the board's name and nothing about who can see it, so hiding or showing
	 * a board changes nothing the guard can notice. See the note at the top of that method.
	 *
	 * IT WRITES THE WHOLE BUTTON EVERY TIME rather than only what changed. Nothing here costs
	 * anything worth counting, and a writer that skipped a part is a part settled in one of the two
	 * writers only, which is the fault `_chrome` carries its own warning about.
	 *
	 * THE HINT IS THE LABEL, so both attributes take the same sentence. A tooltip that said one
	 * thing to a pointer and another to a screen reader would be two controls wearing one glyph.
	 */
	_paintSeen(page = this.mapPage) {
		const eye = this._root?.querySelector("[data-relmap-action=\"pagehide\"]");
		if (!eye) return;
		const said = this._seenTool(page);
		eye.hidden = !said.pageHideOn;
		eye.dataset.tooltip = said.pageHideHint;
		eye.setAttribute("aria-label", said.pageHideHint);
		eye.classList.toggle("is-hidden-board", said.pageHidden);
		const icon = eye.querySelector("i");
		if (icon) icon.className = `fas ${said.pageHideIcon}`;
	}

	/**
	 * Show another board of this map.
	 *
	 * NOT AN EDIT, and not gated: a reader who may only look still gets to look at every page. It
	 * writes nothing anybody else can see, and only this client's own note of where it left off
	 * (relmap/relmap-last.js) — which page somebody is on is theirs, and two people at one table
	 * reading different pages of one map is the ordinary case rather than a conflict.
	 *
	 * A FULL RENDER, unlike the repaint a live change gets, and this is the one place that is right:
	 * a different board is a different sheet with a different shape, so the surface has to be
	 * rebuilt and re-fitted. There is no zoomed-into corner to protect here, because the corner
	 * belonged to the board being left.
	 */
	showPage(id, { said = null } = {}) {
		const want = String(id ?? "");
		if (!want || want === this.mapPage?.id) return;
		const page = getMapPage(this.entry, want);
		if (!page) return;
		// ⚠ FIRST, AND BEFORE `_pageId` MOVES. A nudge or a caption still waiting on its debounce
		// belongs to the board being LEFT, and written a line later it would land on the one being
		// arrived at — moving a portrait on a page the reader never touched, by an id that very
		// likely names nobody there. See `_leaveBoard`.
		this._leaveBoard();
		this._pageId = want;
		// All three point at the board being left, and `_lightPerson` and `_armRemove` would only
		// have to throw what they name away.
		this._lit = null;
		this._armed = "";
		this._pendingSync = false;
		// "Showing the Millers" for an ordinary switch, and whatever the caller has to say instead
		// where arriving at the board is the second half of something else it did. `_addPage` is the
		// one so far, and "the Millers has been added" is news where "showing" is not.
		this._sayOnRender = said ?? format("stonetop.relmap.pages.now", { name: page.name });
		this._focusOnRender = `[data-relmap-page="${want}"]`;
		this.render();
	}

	/**
	 * Move focus along the strip with the arrow keys.
	 *
	 * MOVES FOCUS ONLY; the space bar or Enter is what actually switches board, because a `<button>`
	 * already does that. The other spelling — selecting on every arrow key — is a render per
	 * keypress, and each render throws away the very element the reader is arrowing from.
	 */
	_onPageKey(ev) {
		const steps = { ArrowLeft: -1, ArrowRight: 1 };
		const step = steps[ev.key];
		if (step === undefined && ev.key !== "Home" && ev.key !== "End") return;
		const tabs = Array.from(this._root?.querySelectorAll("[data-relmap-page]") ?? []);
		const from = tabs.indexOf(ev.target);
		if (from < 0 || tabs.length < 2) return;
		ev.preventDefault();
		const to = ev.key === "Home" ? 0
			: ev.key === "End" ? tabs.length - 1
				: (from + step + tabs.length) % tabs.length;
		for (const tab of tabs) tab.tabIndex = -1;
		tabs[to].tabIndex = 0;
		tabs[to].focus?.();
	}

	/**
	 * Add a board to this map, and go to it.
	 *
	 * OPENED ON, not merely created. A new page appears at the end of a strip the reader may not
	 * even be looking at the end of, and one that is made but not shown is a button whose only
	 * visible effect is a tab lighting up somewhere off-screen.
	 */
	async _addPage() {
		const name = await this._askPageName(
			localize("stonetop.relmap.pages.newTitle"),
			localize("stonetop.relmap.pages.new"),
			"",
		);
		if (name === null) return;
		const page = await createMapPage(this.entry, name);
		if (!page) {
			ui.notifications?.warn?.(localize("stonetop.relmap.pages.failed"));
			return;
		}
		// Through the ordinary switch, which already drops the focus and the highlight, lands any
		// unwritten nudge on the board being left, and puts the reader's keyboard focus on the new
		// tab. Only what it SAYS differs: this is news, not navigation.
		this.showPage(page.id, {
			said: format("stonetop.relmap.pages.added", { name: page.name }),
		});
	}

	/**
	 * Hide the board that is up from the players, or show it to them.
	 *
	 * NOT ASKED FIRST, and that is the whole difference between this and the delete beside it.
	 * Nothing is destroyed and nothing is lost: the board, its people and every line on it are
	 * exactly where they were, and one more press puts the map back the way it was. A confirm on a
	 * control whose entire cost is one more click is a confirm a GM learns to dismiss without
	 * reading, which is how the confirms that matter stop working.
	 *
	 * SAID OUT LOUD, because the visible change is small and lands somewhere the presser is not
	 * looking: the glyph swaps, and a mark appears on a tab whose name their eye is not on. What
	 * actually changed is who at the table can see this board, which is worth a sentence.
	 *
	 * ⚠ NOTHING IS RE-RENDERED HERE. The write broadcasts, and the page's own update hook is what
	 * repaints the strip and the eye — one path, whether the board was hidden from this window or
	 * from a second GM's. A render here would race it and throw away the live region this speaks
	 * into.
	 */
	async _hidePage() {
		const page = this.mapPage;
		if (!page || !this.canHidePages) return;
		const dark = !isMapPageHidden(page);
		if (!await setMapPageHidden(page, dark)) return;
		this._announce(format(
			dark ? "stonetop.relmap.pages.hidden" : "stonetop.relmap.pages.shown",
			{ name: page.name },
		));
	}

	/**
	 * NAMING AND RUBBING OUT THE WHOLE MAP, in the title bar rather than on the page strip.
	 *
	 * ⚠ THESE TWO ARE HERE BECAUSE THE SIDEBAR IS NOT. A map is a JournalEntry, and the Journal
	 * directory used to be where a GM renamed or deleted one; its rows are taken out of that list
	 * now (hooks/journal-directory-maps.js), so without these the map would be a document with no
	 * way left to name it or be rid of it.
	 *
	 * AND THEY ARE IN THE TITLE BAR, not beside the page tools, because that row acts on the BOARD
	 * that is up: it already carries a pen and a trash of its own, and a second pen and trash an
	 * inch away meaning "the whole map" is the arrangement in which somebody deletes six boards
	 * meaning to delete one. The title bar is where an application's own document is named.
	 *
	 * Each is offered only to a reader who may use it: renaming to anybody who may edit the map,
	 * deleting to a GM alone (`canDeleteRelationshipMap` says why that is stricter than the server).
	 */
	_getHeaderButtons() {
		const buttons = super._getHeaderButtons();
		const entry = this.entry;
		// Unshifted in reverse, so the pen sits in front of the trash and both in front of Close.
		if (canDeleteRelationshipMap(entry)) {
			buttons.unshift({
				label: localize("stonetop.relmap.maps.delete"),
				class: "stonetop-relmap-map-delete",
				icon: "fas fa-trash",
				onclick: () => this._removeMap(),
			});
		}
		if (canEditRelationshipMap(entry)) {
			buttons.unshift({
				label: localize("stonetop.relmap.maps.rename"),
				class: "stonetop-relmap-map-rename",
				icon: "fas fa-pen",
				onclick: () => this._renameMap(),
			});
		}
		return buttons;
	}

	/** Rename the whole map. The box opens on the name it has, the way the board's own rename does,
	 * so a reader fixing a typo edits rather than retypes. */
	async _renameMap() {
		const entry = this.entry;
		if (!entry) return;
		const name = await this._askPageName(
			localize("stonetop.relmap.maps.renameTitle"),
			localize("stonetop.relmap.maps.renameGo"),
			entry.name,
		);
		if (name === null) return;
		if (await renameRelationshipMap(entry, name)) {
			this._announce(format("stonetop.relmap.maps.renamed", { name: relationshipMapName(name) }));
		}
	}

	/**
	 * Delete the whole map, after asking.
	 *
	 * ASKED WITH BOTH COUNTS IN IT, for the reason the board's own delete carries one: this is the
	 * largest thing anybody can destroy from this window, and "Delete this map?" over a year of a
	 * table's work understates it by every board and every face on them. The button that commits it
	 * wears the system's destructive skin, like the board's.
	 *
	 * ⚠ SAID THROUGH A NOTIFICATION AND NOT THE LIVE REGION, which is the one place this parts
	 * company with `_removePage`. That one leaves a window standing to speak into; this one closes
	 * it (the entry's own delete hook does that, on every client), so a sentence written into the
	 * live region here would be thrown away with the markup holding it, unread.
	 */
	/**
	 * The window's one "are you sure", asked three times: dropping a map, dropping a board, and
	 * taking somebody off one.
	 *
	 * ONE SHELL, because all three are the same question and the parts that must not drift are the
	 * ones nobody looks at twice — the themed classes that give the dialog our chrome at all, and
	 * `rejectClose: false`, which is what makes dismissing the window mean "no" instead of throwing.
	 * The buttons NAME the outcome rather than answering a question the reader has to hold in their
	 * head, and the affirmative one is first, which is this system's order everywhere.
	 *
	 * `danger` wears the destructive skin (styles/stonetop.css), which is for the two that destroy
	 * work nobody can get back; removing a person is undoable and so is not red.
	 *
	 * @param {{title: string, body: string, confirm: string, cancel: string, danger?: boolean}} q
	 * @returns {Promise<boolean>} Whether the reader pressed the affirmative button.
	 */
	async _confirm({ title, body, confirm, cancel, danger = false }) {
		const go = await foundry.applications.api.DialogV2.wait({
			classes: themedDialogClasses(),
			window: { title },
			content: `<p>${escHtml(body)}</p>`,
			buttons: [
				{ action: "go", label: confirm, default: true, ...(danger ? { class: "stonetop-dialog-btn--danger" } : {}) },
				{ action: "keep", label: cancel },
			],
			rejectClose: false,
		});
		return go === "go";
	}

	async _removeMap() {
		const entry = this.entry;
		if (!canDeleteRelationshipMap(entry)) return;
		const boards = listMapPages(entry);
		// Every face on the map, not only the ones on the board that is up: the same person seated
		// on two boards is two of them, which is exactly what is about to be lost.
		const people = boards.reduce((n, page) => n + Object.keys(readGraph(page).nodes).length, 0);
		const ok = await this._confirm({
			title: localize("stonetop.relmap.maps.deleteTitle"),
			body: format("stonetop.relmap.maps.deleteBody", { name: entry.name, boards: boards.length, people }),
			confirm: localize("stonetop.relmap.maps.deleteConfirm"),
			cancel: localize("stonetop.relmap.maps.deleteCancel"),
			danger: true,
		});
		if (!ok) return;
		// ⚠ FORGOTTEN BEFORE THE DELETE, board by board, for the reason `_removePage` forgets one:
		// after the delete there is no uuid left to forget a board's history by, and an undo step
		// pointing at a page that has stopped existing writes into nothing.
		for (const page of boards) forgetHistory(page);
		const name = entry.name;
		if (await deleteRelationshipMap(entry)) {
			ui.notifications?.info(format("stonetop.relmap.maps.deleted", { name }));
		}
	}

	/** Rename the board that is up. The box opens on the name it already has, so a reader fixing a
	 * typo edits rather than retypes. */
	async _renamePage() {
		const page = this.mapPage;
		if (!page) return;
		const name = await this._askPageName(
			localize("stonetop.relmap.pages.renameTitle"),
			localize("stonetop.relmap.pages.renameGo"),
			page.name,
		);
		if (name === null) return;
		if (await renameMapPage(page, name)) {
			this._announce(format("stonetop.relmap.pages.renamed", { name: mapPageName(name) }));
		}
	}

	/**
	 * Delete the board that is up, after asking.
	 *
	 * ASKED WITH THE COUNT IN IT, because this is the one control in the window that destroys work
	 * nobody can get back — a page carries its whole cast and every line on it — and the title
	 * alone, over a board of thirty people, understates what is about to happen. The count is in the
	 * BODY of the question, and the button that commits it is the window's only red one.
	 */
	async _removePage() {
		const page = this.mapPage;
		if (!page || this.mapPages.length <= 1) return;
		const people = Object.keys(readGraph(page).nodes).length;
		// RED: it is one of the two controls here that destroy work nobody can get back, and the
		// footer's other button is a plain "keep". The skin comes from `_confirm`'s `danger`, not a
		// colour typed here.
		const ok = await this._confirm({
			title: localize("stonetop.relmap.pages.deleteTitle"),
			body: format(
				people ? "stonetop.relmap.pages.deleteBodyPeople" : "stonetop.relmap.pages.deleteBody",
				{ name: page.name, count: people },
			),
			confirm: localize("stonetop.relmap.pages.deleteConfirm"),
			cancel: localize("stonetop.relmap.pages.deleteCancel"),
			danger: true,
		});
		if (!ok) return;
		// ⚠ SAID BEFORE THE WRITE, and the window is NOT re-rendered here. The delete's own hook is
		// what moves this reader onto a surviving board and renders — one path, whether the page was
		// deleted from this window or from somebody else's — and that render throws away the live
		// region this would otherwise have spoken into. `_render` says it once the new one is up.
		this._sayOnRender = format("stonetop.relmap.pages.deleted", { name: page.name });
		// ⚠ FORGOTTEN BEFORE THE DELETE, not after, because after it the handle has no uuid to
		// forget it by. Every step in it names a page that is about to stop existing, so pressing
		// undo on the board this reader lands on next would write into nothing.
		forgetHistory(page);
		if (await deleteMapPage(page)) return;
		// Refused, so nothing was written and nothing is going to re-render. The announcement must
		// not be left waiting to be said by the next change somebody else makes.
		this._sayOnRender = null;
	}

	/**
	 * One text field, asking for a page's name.
	 *
	 * Through the shared prompt (dialogs/content-picker.js), which is where the rule about how a
	 * DialogV2 must be handed its content lives. This method used to build the window itself and
	 * got that rule wrong, which is a thrown error inside the constructor and a button that
	 * silently does nothing.
	 *
	 * Hands back null for a cancel and a string for a save, so "" — meaning "saved without typing
	 * anything" — stays tellable from "never mind". `mapPageName` is what turns the empty one into
	 * a name a document will accept.
	 */
	async _askPageName(title, confirm, current) {
		return promptForText({
			title,
			buttonLabel: confirm,
			value: current ?? "",
			placeholder: localize("stonetop.relmap.pages.placeholder"),
		});
	}

	/**
	 * Is this a moment a repaint would interrupt?
	 *
	 * The live drag is read off the CLASS the drag layer sets rather than a flag mirrored here.
	 * One source of truth: a flag would have to be cleared on every one of the four ways a drag can
	 * end, and the one that got missed would wedge the board's live updates off for good with no
	 * sign of why.
	 */
	_isBusy() {
		const board = this._boardEl();
		if (board?.classList.contains("is-dragging")) return true;
		// A nudge not written yet is the same kind of obstruction: a repaint would redraw the
		// portrait at the spot the document still holds, undoing the keys already pressed.
		if (this._pendingNudge.size) return true;
		// ⚠ AND THAT IS ALL OF IT. There used to be a third obstruction here — "a field has focus" —
		// and it could never fire while collecting two exemptions that each undid a false positive
		// it had created for itself. This window carries one form control, the hide-imported-lines
		// box, and it holds no unsaved writing; the board partial carries none at all. What that
		// guard was written to protect is a half-typed
		// sentence, and there is no sentence to half-type here — a caption is edited in a separate
		// dialog, whose focus is outside this window entirely. Meanwhile a repaint replaces only
		// the BOARD's markup, so the two controls it was stopping for were never at risk, and the
		// things that genuinely are (a focused caption, a focused portrait) it never covered.
		//
		// If a text field ever does land on this bar, the guard to add is an affirmative one about
		// UNSAVED WRITING, not a list of tag names with exceptions carved out of it.
		//
		// ⚠ AND ONE DID: the caption field on the tie bar. So here is that guard, asked exactly the
		// way the paragraph above says to ask it -- about writing the document does not have yet,
		// and never about focus. A reader merely resting in that field obstructs nothing, and the
		// bar writes what it holds within a breath of the last keystroke (TIE_WRITE_DELAY_MS), so
		// this can only ever hold a repaint back for that long.
		if (this._tieBar?.isWriting()) return true;
		return false;
	}

	/** Flush a repaint that arrived while something was in the way. */
	_flushPendingSync() {
		if (this._pendingSync) this.sync();
	}

	_toggleEmpty(empty) {
		const panel = this._root?.querySelector(".stonetop-relmap-empty");
		if (panel) panel.hidden = !empty;
	}

	// ── Editing ─────────────────────────────────────────────────────────────

	/**
	 * EVERY EDIT THIS WINDOW MAKES, and now the only place that remembers one.
	 *
	 * ⚠ THE HISTORY IS TAKEN HERE AND NOWHERE ELSE, for the reason this funnel exists at all: a
	 * write recorded at the call site is a write somebody adds a tenth of later without recording,
	 * and the cost of that miss is an undo button that skips a change — pressing it takes back the
	 * one BEFORE the one the reader is looking at. Recorded here, a new edit is remembered by
	 * having been written.
	 *
	 * `remember: false` is for the undo and the redo themselves, which are the only writes that
	 * must not become steps of their own. See `_stepHistory`.
	 *
	 * @param {object} patch  a patch from relmap/relmap-store.js.
	 * @param {object} [options]
	 * @param {string} [options.announce]  what to say into the live region, for a reader who cannot
	 *        see the board change.
	 * @param {string} [options.label]  what this change is called when the undo button offers to
	 *        take it back. A short noun phrase: "moving someone", "taking Ordga off".
	 * @param {string} [options.coalesce]  a key naming the GESTURE, where several writes are one.
	 *        See RELMAP_COALESCE_MS in relmap/relmap-history.js.
	 * @param {boolean} [options.remember]  whether this is a change to remember at all.
	 */
	async _write(patch, { announce = "", label = "", coalesce = "", remember = true } = {}) {
		if (!patch) return false;
		const doc = this.boardDoc;
		// ⚠ READ BEFORE THE WRITE. What would put a change back can only be worked out from the
		// board as it stands now — after `applyPatch` the old values are gone. The cost is one
		// extra normalize per edit, which is a fraction of what a repaint already does and only
		// happens on a write the reader made by hand.
		const change = remember ? describeWrite(readGraph(doc), patch) : null;
		// Announced BEFORE the write. The write repaints the board and takes the live region's
		// neighbours with it; announcing afterwards can land on a node already replaced.
		if (announce) this._announce(announce);
		try {
			if (!await applyPatch(doc, patch)) return false;
		} catch (err) {
			this.reportWriteFailure(localize("stonetop.relmap.noun"), err);
			return false;
		}
		if (change) {
			historyFor(doc).record({
				...change,
				label: label || localize("stonetop.relmap.history.change"),
				coalesce,
			});
			this._paintHistory();
		}
		return true;
	}

	/**
	 * PICK UP THE PEN A READER JUST DREW WITH, so the next line on this map starts in it.
	 *
	 * ⚠ TWO RECORDS AND THEY ARE NOT THE SAME RECORD, which is the whole of why this is a method
	 * with a name rather than two lines in a closure.
	 *
	 *  • THE MAP'S, and it is what actually decides: the colour, the stroke and the caption size a
	 *    new line is born in, shared by everybody editing that map, exactly as the table asked. It
	 *    reads what is there before writing, so an unchanged choice -- most presses, the choosers
	 *    being painted on every open of the bar -- broadcasts nothing. See relmap/relmap-pen.js.
	 *  • THIS READER'S OWN SIZE, still, and it is not redundant. That one is flat across every
	 *    world (relmap/relmap-size.js), so it is what a reader on a screen magnifier carries onto a
	 *    map nobody has set a size on yet. `penFor` is where the two meet, and the map wins the
	 *    moment anybody at the table has an answer.
	 *
	 * NEITHER IS AWAITED and neither may hold the line up. The write the reader is actually watching
	 * is the one to the line itself, and a pen that failed to stick is not worth a word over a
	 * colour that landed.
	 */
	_rememberPen(fields) {
		rememberPen(this.entry, fields);
		if ("size" in (fields ?? {})) rememberSize(fields.size);
	}

	// ── Taking a change back ────────────────────────────────────────
	//
	// The stacks themselves are in relmap/relmap-history.js, which opens with why an undo on this
	// board is a reversing WRITE rather than a saved copy of the graph, and why the history is this
	// reader's own rather than the table's.

	/**
	 * This board's history. Asked afresh every time, never held: the reader flicks between boards
	 * with the tab strip, and each of them keeps its own.
	 *
	 * ⚠ UNDERSCORED, like every other member this window adds. A public `history` is a name core
	 * could take for something of its own on any Application subclass, and a collision there is
	 * silent — see the property-collision rule this codebase keeps.
	 */
	get _history() {
		return historyFor(this.boardDoc);
	}

	/**
	 * Take one change back, or put it forward again.
	 *
	 * @param {"back"|"forward"} way  which stack to step along. The step itself is stored under the
	 *        same two names, so this is the key as well as the direction.
	 */
	async _stepHistory(way) {
		if (!this.canEdit) return false;
		// ⚠ THE TIE BAR IS FLUSHED FIRST, AWAITED, and before the step is even peeked at. It holds a
		// caption the document has not got yet, and that caption is a change like any other:
		// written after this it would land on top of the undo, and merely STARTED here it would
		// record itself a microtask later — emptying the forward stack under a redo already in
		// flight, and leaving the board right while the two stacks were wrong.
		await this._tieBar?.flush();
		const history = this._history;
		const entry = way === "back" ? history.peekUndo() : history.peekRedo();
		const commit = () => (way === "back" ? history.commitUndo() : history.commitRedo());
		if (!entry) {
			ui.notifications?.info?.(localize(`stonetop.relmap.history.${way}Nothing`));
			return false;
		}
		const patch = stepPatch(readGraph(this.boardDoc), entry[way]);
		if (!patch) {
			// Everybody this step named has been taken off the board since, so there is nothing
			// left to write. The step is spent either way, so it moves across rather than sitting
			// at the top of the stack refusing to do anything every time it is pressed.
			commit();
			ui.notifications?.info?.(localize("stonetop.relmap.history.gone"));
			this._paintHistory();
			return false;
		}
		const said = format(`stonetop.relmap.history.${way}Done`, { what: entry.label });
		// `remember: false`: an undo that recorded itself would be a change the next undo takes
		// back, and the button would flip the same edit on and off for ever.
		if (!await this._write(patch, { announce: said, remember: false })) return false;
		commit();
		ui.notifications?.info?.(said);
		this._paintHistory();
		return true;
	}

	/**
	 * Ctrl+Z, and Ctrl+Shift+Z or Ctrl+Y the other way.
	 *
	 * ⚠ NEVER OUT FROM UNDER A FIELD. The tie bar carries a caption box inside this window, and
	 * Ctrl+Z in a text field is the browser's own undo of what the reader is typing. Taken here, a
	 * reader fixing a typo would instead silently take back a change to the shared board — and
	 * would have no way of telling that was what happened.
	 */
	_onHistoryKey(ev) {
		if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
		const key = String(ev.key ?? "").toLowerCase();
		if (key !== "z" && key !== "y") return;
		if (ev.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
		if (!this.canEdit) return;
		ev.preventDefault();
		// Stopped as well as prevented: this window can sit over a sheet, and an unhandled Ctrl+Z
		// reaching core's own keybindings is core's undo of the last canvas operation.
		ev.stopPropagation();
		this._stepHistory(key === "y" || ev.shiftKey ? "forward" : "back");
	}

	/**
	 * The two buttons, told what they can do.
	 *
	 * REPAINTED RATHER THAN RENDERED, and DISABLED rather than hidden. What they can do changes on
	 * every edit the reader makes, and a pair of buttons that appeared and vanished as the reader
	 * worked would shuffle every other tool on the bar sideways under the pointer. Disabled, they
	 * hold their place and say why they are off in their own name.
	 */
	_paintHistory() {
		const root = this._root;
		if (!root) return;
		const history = this._history;
		this._paintHistoryButton(root.querySelector("[data-relmap-action='undo']"), {
			can: history.canUndo, what: history.undoLabel, way: "back",
		});
		this._paintHistoryButton(root.querySelector("[data-relmap-action='redo']"), {
			can: history.canRedo, what: history.redoLabel, way: "forward",
		});
	}

	/** One of them. The accessible name carries WHAT would be taken back, not just "Undo": a reader
	 * who cannot see the board is exactly the one who needs to be told what a press would change
	 * before they make it. */
	_paintHistoryButton(button, { can, what, way }) {
		if (!button) return;
		button.disabled = !can;
		const said = can
			? format(`stonetop.relmap.history.${way}Hint`, { what })
			: localize(`stonetop.relmap.history.${way}Nothing`);
		button.dataset.tooltip = said;
		button.setAttribute("aria-label", said);
	}

	_announce(message) {
		const live = this._root?.querySelector(".stonetop-relmap-live");
		if (live) live.textContent = message;
	}

	// ── The live drag ────────────────────────────────────────────────
	//
	// A portrait under the pointer is moved by a transform on the one element, which is cheap and
	// leaves the rest of the board alone. Its LINES are not on that element, so without the two
	// methods below they stay pinned to the spot the portrait was picked up from until the pointer
	// is released — the map looking like it has not noticed the drag.
	//
	// WHY NOT SIMPLY REPAINT THE BOARD PER FRAME. It would replace the element the pointer is
	// holding, which is the very thing `sync` refuses to do mid-drag, and it would rebuild every
	// node's markup to move a handful of lines. So the geometry is recomputed for the links that
	// actually moved, and written straight onto the elements already on the board.

	/**
	 * Redraw the links touching one portrait, at a spot it has not been dropped at yet.
	 *
	 * NOT CLAMPED, deliberately, though the write on release is: the point of this is that the line
	 * stays welded to the portrait the reader is holding, and a line that stopped at the board's
	 * edge while the portrait carried on past it would read as the line coming loose. The drop
	 * reconciles the two.
	 */
	_previewMove(id, at) {
		const preview = this._preview?.id === id ? this._preview : this._beginPreview(id);
		if (!preview) return;
		// The cached graph is a private copy — `readGraph` normalizes into a fresh object on every
		// call — so moving the node in it costs nothing and is thrown away with the preview.
		const node = preview.graph.nodes[id];
		node.x = at.x;
		node.y = at.y;
		for (const shape of edgeShapes(preview.graph, {
			r: preview.board.r, fans: preview.fans, only: id,
			boardWidthPx: preview.board.width, painted: preview.painted,
		})) {
			const parts = preview.parts.get(shape.id);
			// A BOARD WITH NO CAPTIONS ON IT HAS NO HOLES IN ITS LINES, and a line being dragged has
			// to agree with the still ones it is dragged past. `_paintLineGaps` cannot do it: that
			// writes what the last repaint worked out, and this line is being recomputed.
			if (parts) {
				redrawEdge(parts, this._drawn?.healed ? { ...shape, d: shape.unbroken } : shape, preview.board);
			}
		}
	}

	/**
	 * The state one drag's worth of previewing needs, gathered ONCE.
	 *
	 * Per drag rather than per frame because all of it is stable for the length of one: the graph
	 * cannot change under a drag (`sync` defers while the board is busy), the fan indexes come from
	 * the graph, and the elements are only replaced by a repaint. Rebuilding it per frame would
	 * re-parse the flag and re-walk the board sixty times a second to learn the same answers.
	 */
	_beginPreview(id) {
		const board = this._boardEl();
		if (!board) return null;
		const whole = readGraph(this.boardDoc);
		if (!whole.nodes[id]) return null;
		// ONE PLAN PER GESTURE. `_plan` reads the document when it is not given a graph, and asking
		// it once is the entire point of gathering this here.
		//
		// ⚠ AND IT IS THE PLAN'S GRAPH THAT IS PREVIEWED. The board on screen was drawn through
		// `_plan`, and a drag that measured a graph of its own would fan the pairs apart
		// differently and leave the captions different room: a line would slide to another fan index
		// for the length of the drag, take a different bow past the same face, and snap back on the
		// drop. Same graph in, same geometry out.
		const plan = this._plan(whole);
		const graph = plan.graph;
		this._preview = {
			id,
			graph,
			fans: fanIndexes(graph),
			// THE WHOLE SHEET, and its radius and width read straight off it. A caption is placed in
			// the caption layer's own pixels and that space is as tall as the board is, not as wide;
			// second copies of two of its numbers beside it were two more fields to keep in step for
			// nothing.
			board: plan.board,
			// WHAT THE CAPTIONS ON SCREEN MEASURED, from the repaint that drew them
			// (`_fitGapsToPaint`). Read here rather than per frame, because reading an element's
			// width forces the browser to lay the board out and doing that sixty times a second is
			// how a drag on a busy board starts to stutter. A caption whose line is being dragged
			// SHORTER is still right, because `captionSize` holds it to the room the line has left;
			// one whose line was too short to fit its words and is being dragged longer may break a
			// few pixels narrow until the drop repaints. One gesture, and nothing is written wrong.
			painted: this._drawn?.painted ?? null,
			parts: indexEdgeParts(board),
		};
		return this._preview;
	}

	/**
	 * That drag is over.
	 *
	 * `restore` is where the portrait went back to when the drag was ABANDONED — Escape, a lost
	 * pointer, a board that stopped being editable mid-gesture. The drag layer puts the portrait
	 * back itself by dropping its transform, and the lines have to follow or they are left hanging
	 * where the pointer stopped with nothing coming to correct them.
	 *
	 * On a real drop it is null and the lines are left exactly where they were previewed: the write
	 * is already on its way, and its repaint draws the same geometry over the top with nothing to
	 * see in between. Putting them back first would flash every line to the old spot for a frame.
	 */
	_endPreview(id, restore) {
		if (restore) this._previewMove(id, restore);
		this._preview = null;
	}

	/**
	 * One arrow key: move the portrait and its lines NOW, and remember to write it.
	 *
	 * The same split a pointer drag makes — the board follows the gesture, the document hears
	 * about it at the end — so that holding an arrow key costs one write rather than one per
	 * repeat, and so that no repaint arrives to take away the button the key is being held on.
	 */
	_nudgeNode(id, at) {
		const el = this._root?.querySelector(`[data-relmap-node="${id}"]`);
		if (!el) return;
		// CLAMPED HERE, unlike the drag preview. A drag is bounded by the pointer and its drop
		// reconciles the two; a held arrow key is bounded by nothing, so showing it unclamped would
		// walk the portrait off the board and snap it back the moment the write landed. Clamping to
		// the same rule `nodePatch` applies means what the keys show is what gets written — and it
		// is what stops `nodeAt` handing the next key a spot further off the board again.
		const spot = { x: clampPct(at.x), y: clampPct(at.y) };
		el.style.left = `${spot.x}%`;
		el.style.top = `${spot.y}%`;
		this._previewMove(id, spot);
		this._pendingNudge.set(id, spot);
		this._commitNudge();
	}

	/** Write the nudges the reader has stopped making, and let repaints back in. */
	_writeNudge() {
		const pending = [...this._pendingNudge];
		if (!pending.length) return;
		this._pendingNudge.clear();
		this._preview = null;
		// ONE STEP FOR A RUN OF ARROW KEYS, keyed by the portrait. A reader walking somebody across
		// the board pauses several times on the way, and each pause is a write; recorded separately
		// they would be a dozen undos to put one person back where they started. A drag does NOT
		// pass this key: a drag is one gesture already, and two deliberate drags a second apart are
		// two changes.
		//
		// EVERY PORTRAIT WAITING, not just the last one touched. The debounce restarts on each key,
		// so a reader who tabs from one face to the next inside it has moved two people on one
		// timer, and writing only the second would put the first back where the document still has
		// it — in front of somebody who watched themselves move it.
		for (const [id, at] of pending) this._moveNode(id, at, { coalesce: `node:${id}` });
		// A repaint that was held back while the keys were coming lands now.
		this._flushPendingSync();
	}

	/**
	 * Everything half-written on the board being left, written down while it is still the board.
	 *
	 * ⚠ CALLED BEFORE `_pageId` MOVES, every time it moves — a switch of board, a board deleted or
	 * hidden under the reader, and the close. Both of these resolve their target through `boardDoc`,
	 * which answers for whatever page the window points at NOW, so either one flushed a line later
	 * lands on the board being ARRIVED at: a portrait moved on a page the reader never touched, or
	 * a caption filed against an edge that page does not have, leaving a label nothing draws and an
	 * "edited a link" step in the undo of a board with no such link.
	 */
	_leaveBoard() {
		this._writeNudge();
		this._tieBar?.flush();
	}

	/**
	 * No read first. `readGraph` normalizes every node and every edge to build a fresh object, and
	 * the only thing this wanted from it was whether the node still exists — which decides nothing:
	 * `nodePatch` clamps the coordinates itself, and a patch naming a node that has since been
	 * removed is dropped by `normalizeGraph` on the next repaint rather than resurrecting it.
	 *
	 * ⚠ THE PORTRAIT IS PAINTED HERE, BEFORE THE AWAIT, and that placement is the whole of it.
	 * A drag moves the portrait by the two custom properties the drag layer writes, never by its
	 * `left`/`top`, which go on saying where it was picked up for the length of the gesture. The
	 * drop drops those properties, so between the release and the repaint the write eventually
	 * causes, the portrait is painted from coordinates that are still the OLD ones: it flashes back
	 * to where it came from for a document round trip and a full render, then appears where it was
	 * put. The lines never did this, because `_endPreview` deliberately leaves them where the
	 * pointer left them on a committed drop; the portrait itself was the one thing left behind.
	 *
	 * Writing the spot on first, in the same task as the release (`onMove` is called synchronously
	 * from the drag layer's pointerup, and this runs to the `await` without yielding), means the
	 * old coordinates are never painted at all. The repaint then writes the same numbers over the
	 * top with nothing to see in between — the same bargain the lines already had, and the same one
	 * `_nudgeNode` makes for the arrow keys.
	 *
	 * CLAMPED, so what is painted is what `nodePatch` is about to store. A drop past the edge of
	 * the board is a real gesture (the preview is deliberately unclamped so the lines stay welded
	 * to the cursor), and painting it unclamped here would only move the snap-back later.
	 */
	async _moveNode(id, { x, y }, { coalesce = "" } = {}) {
		const spot = { x: clampPct(x), y: clampPct(y) };
		const el = this._root?.querySelector(`[data-relmap-node="${id}"]`);
		if (el) {
			el.style.left = `${spot.x}%`;
			el.style.top = `${spot.y}%`;
		}
		await this._write(nodePatch(id, spot), {
			label: localize("stonetop.relmap.history.moved"), coalesce,
		});
	}

	async _openPerson(id) {
		const node = readGraph(this.boardDoc).nodes[id];
		if (!node) return;
		if (!node.uuid) {
			ui.notifications?.info?.(format("stonetop.relmap.noSheet", { name: node.name }));
			return;
		}
		// ⚠ `actorUuid`, WHICH IS NOT WHAT THE NODE CALLS IT. `resolveLinkedActor` reads
		// `link.dataset ?? link`, so a hand-built object has to be spelled the way a row's `data-`
		// attributes are, and a key it does not recognise is not an error: it resolves nobody and
		// warns that the person is gone. Every other caller in the system hands it a real element
		// and never meets this. Passing `{uuid}` here made a portrait's sheet unopenable on every
		// map, for every person, including the ones plainly still in the world.
		// RETURNED rather than fired off, so that whoever opened a portrait can wait for the sheet.
		// The drag layer does not, and does not need to; a test cannot tell whether the sheet opened
		// or the warning fired without it, because both happen inside the resolve.
		return openLinkedActorSheet({ actorUuid: node.uuid }, "stonetop.relmap.gone");
	}

	/** The handle CLICKED rather than dragged: ask who, then draw the same line. */
	async _linkFrom(id) {
		const graph = readGraph(this.boardDoc);
		const others = this._peopleOnMap(graph).filter(person => person.id !== id);
		// THROUGH THE SAME READER AS THE ROWS. Built off the stored name instead, the heading called
		// somebody by the name the map remembers while every row beneath it used the name on their
		// sheet — two names for one person in one small window.
		const from = this._nameOf(graph, id);
		if (!others.length) {
			ui.notifications?.info?.(localize("stonetop.relmap.nobodyToLink"));
			return;
		}
		const to = await pickPersonToLink({ from, options: others });
		if (to) await this._createLink(id, to);
	}

	/**
	 * The colours of the table's own that this board is already drawn in, most-used first.
	 *
	 * ⚠ READ OFF THE GRAPH AND NOT OFF `_drawn`, which is the one place in this window that says
	 * so. Every other question the bar asks is about the board IN FRONT OF THE READER -- where a
	 * line's middle is, which of two faces is on the left. This one is about the MAP: with the
	 * pulled-in lines put away, `_drawn` would offer only the colours of what is still showing, and
	 * the reader would find their purple missing for a reason nothing on screen explains.
	 *
	 * MOST-USED FIRST, so a board where one colour means "owes money" and another was tried once
	 * offers the first of them first. Ties keep the order the lines were drawn in, which is stable
	 * across clients: `Object.values` walks a graph's edges in insertion order, and every client
	 * reads the same stored object.
	 */
	_inksInUse() {
		const edges = Object.values(readGraph(this.boardDoc)?.edges ?? {});
		const counted = new Map();
		for (const edge of edges) {
			const hex = normalizeHex(edge?.ink);
			if (hex) counted.set(hex, (counted.get(hex) ?? 0) + 1);
		}
		// `sort` is stable, so equal counts come out in the order they were first met.
		return [...counted.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
	}

	/**
	 * One line as the bar needs it: what it stores, who it joins, and where to float.
	 *
	 * ⚠ ASKED OF THE BOARD IN FRONT OF THE READER, not of the document. Where a line's middle is
	 * depends on the bow the geometry gave it and on how far its pair was fanned apart, and neither
	 * of those is in the stored coordinates -- a bar placed from the document would float beside the
	 * stroke rather than over it. `_drawn` is the geometry the last paint actually used.
	 *
	 * NULL FOR A LINE THAT IS NOT DRAWN, which is how the bar learns to let go: somebody else
	 * rubbing it out, or the reader putting the pulled-in lines away.
	 */
	_tieAt(id) {
		const shape = this._drawn?.shapes?.get(id);
		const graph = this._drawn?.graph;
		const edge = graph?.edges?.[id];
		if (!shape || !edge) return null;
		// The caption where there is one, and the honest middle of the stroke where there is not.
		// See `edgeShapes`, which works both out from one curve.
		const at = shape.anchor ?? shape.mid;
		if (!at) return null;
		const from = graph.nodes[edge.a];
		const to = graph.nodes[edge.b];
		const names = { a: from?.name ?? "", b: to?.name ?? "" };
		return {
			edge,
			// `x` is what decides which way the two one-way arrows point, and it is the SEAT this
			// view gave them rather than the stored one, for the reason above.
			from: { name: names.a, x: from?.x ?? 0 },
			to: { name: names.b, x: to?.x ?? 0 },
			// The arrow buttons in the two people's own names. A tie set the wrong way round is
			// invisible in the writing and glaring on the board, and "which end did I draw from" is
			// not a thing anybody remembers -- the same reasoning the dialog's family-tie options
			// are named under.
			// Keyed by the four answers themselves (`RELMAP_DIRS`), which is what the buttons carry and
			// what the bar reads: a second set of names re-keyed on arrival was two vocabularies for one
			// four-valued enum.
			said: {
				none: localize("stonetop.relmap.dirs.none"),
				both: localize("stonetop.relmap.dirs.both"),
				"a-b": format("stonetop.relmap.dirToward", { name: names.b }),
				"b-a": format("stonetop.relmap.dirToward", { name: names.a }),
			},
			at,
			// WHERE THE WHOLE STROKE RUNS, and not only where its middle is. `at` is one point, and one
			// point cannot tell the bar which way the line leaves it: a near-vertical link has its top
			// half directly above its own middle, so a bar seated "above the middle" sits across it.
			// Handed over as the drawn curve for the bar to walk. See `place`.
			curve: shape.curve ?? null,
		};
	}

	/**
	 * Draw a line between two people, and hand it straight to the reader to say what it is.
	 *
	 * NOTHING IS ASKED FIRST. This used to open the editor window, which meant the gesture was
	 * drag, release, wait for a window, type, press Save -- five steps to draw one line, on a board
	 * where somebody is drawing six while the table talks. The line exists the moment it is
	 * released, in the map's own pen, saying nothing; the bar opens over it with the caret in the
	 * writing field, which is the same place clicking an existing line lands. So "draw a line and
	 * say what it is" and "click a line and say what it is" are now one gesture with one shape.
	 *
	 * A LINE SAYING NOTHING IS A REAL ANSWER, which is what makes that safe: two people joined by a
	 * line nobody has captioned is exactly what a table draws while working out who knows whom, and
	 * it can be typed on at any point afterwards. Drawn by mistake, it is one press on the undo --
	 * or the trash at the end of the bar that is already open over it.
	 *
	 * IT ARRIVES IN THE MAP'S OWN PEN, though, and not in the shipped defaults: whatever colour,
	 * stroke and caption size were last chosen on this map, by anybody at the table. See
	 * relmap/relmap-pen.js.
	 *
	 * ⚠ AND NO FAMILY TIE IS GUESSED AT. The editor guessed one from the caption as it was typed,
	 * and there is no caption yet at the moment this runs. Left UNSET, which is not the same as
	 * "not family": it is the state "find family ties" looks for, so a line captioned "her mother"
	 * a moment from now is still caught by the one press that catches all of them.
	 */
	async _createLink(a, b) {
		if (a === b) return;
		const graph = readGraph(this.boardDoc);
		if (!graph.nodes[a] || !graph.nodes[b]) return;
		const id = foundry.utils.randomID();
		// ⚠ IN THE PEN THIS MAP IS BEING DRAWN WITH, which is the one thing about a new line that
		// is not the shipped default: its colour, its stroke and its caption size are whichever were
		// last chosen on this map, by anybody at the table. A table that has settled on dotted plum
		// for the rumours would otherwise get slate and solid on every line and have to say it again
		// on the bar afterwards, on a board where six lines are drawn while they talk. See
		// relmap/relmap-pen.js, which is also where the one field NOT remembered -- which way the
		// line is read -- is argued out.
		//
		// The shipped defaults on a map nobody has chosen anything on, which is `addEdgePatch`'s own
		// answer and every line ever drawn before this existed. The size this READER last asked for
		// is the seed for that case alone; `penFor` says why it still gets a say.
		const pen = penFor(this.entry, { size: getLastSize() });
		const written = await this._write(addEdgePatch(id, { a, b, ...pen }), {
			announce: format("stonetop.relmap.linked", {
				a: graph.nodes[a].name, b: graph.nodes[b].name,
			}),
			label: localize("stonetop.relmap.history.linked"),
		});
		// ⚠ NOT OPENED HERE, AND THIS IS THE TRAP THIS LINE EXISTS TO NAME. The bar places itself
		// over a line from the last PAINT -- `_tieAt` reads `_drawn`, the geometry the markup on
		// screen was built from -- and the paint standing at this moment was made before this line
		// existed. Asked now, it would find nothing, refuse to open, and the gesture would end with
		// a line drawn and no way to say what it is. So the id is left for the repaint the write
		// has already set off, which is the first moment there is a stroke to float over.
		if (written) this._pendingPick = id;
	}

	/**
	 * Rub one line off the map.
	 *
	 * ⚠ IT ASKS NOTHING, which is deliberate and is the one destructive gesture in this window that
	 * does not. Taking a PERSON off asks, because the portrait is not all that goes -- every line
	 * touching them goes too, and on a board zoomed into one corner the reader cannot see what they
	 * are agreeing to. A line is the opposite: it is one thing, the reader is
	 * looking straight at it, the bar asking is open ON it, and one press on the undo puts it back
	 * with everything it said. A confirm here would be the modal this bar exists to be rid of, on
	 * the surface a table clicks around on while talking.
	 *
	 * The bar has already let go by the time this runs -- `close` before `onRub` -- so nothing is
	 * left floating over a line that is no longer there.
	 */
	async _rubOutLink(id) {
		if (!readGraph(this.boardDoc).edges[id]) return;
		await this._write(dropEdgePatch(id), {
			announce: localize("stonetop.relmap.unlinked"),
			label: localize("stonetop.relmap.history.unlinked"),
		});
	}

	/**
	 * Take somebody off the map, with every line that touched them.
	 *
	 * TWO WAYS IN, one confirm. Delete on a focused portrait, and the trash can a right press puts
	 * on one (`_armRemove`); both land here, because a gesture that removed somebody without asking
	 * would be a different rule for the mouse than for the keyboard on the same board.
	 *
	 * Confirmed, where rubbing out a LINE is not, and the difference is what else goes: a line is
	 * one thing the reader is looking straight at, and a person takes every line touching them with
	 * them — on a board zoomed into one corner, that is a list the reader cannot see. So the count
	 * is IN the question, and nobody learns about those lines afterwards. The undo would put it all
	 * back (`_write` records this as one step), but it is this reader's own and lasts as long as
	 * their window, which is not a thing to spend somebody else's notes on. The buttons NAME the
	 * outcome rather than answering a question the reader has to hold in their head.
	 */
	async _removePerson(id) {
		const graph = readGraph(this.boardDoc);
		const node = graph.nodes[id];
		if (!node) return;
		const links = Object.values(graph.edges).filter(e => e.a === id || e.b === id).length;
		const ok = await this._confirm({
			title: localize("stonetop.relmap.removeTitle"),
			body: links
				? format("stonetop.relmap.removeBodyLinks", { name: node.name, count: links })
				: format("stonetop.relmap.removeBody", { name: node.name }),
			confirm: format("stonetop.relmap.removeConfirm", { name: node.name }),
			cancel: localize("stonetop.relmap.removeCancel"),
		});
		if (!ok) return;
		await this._write(dropNodePatch(graph, id), {
			announce: format("stonetop.relmap.removed", { name: node.name }),
			label: format("stonetop.relmap.history.removed", { name: node.name }),
		});
	}

	// ── The bar ─────────────────────────────────────────────────────────────

	async _onToolClick(ev) {
		const tool = TOOLS[ev.currentTarget.dataset.relmapAction];
		if (!tool || (tool.needsEdit && !this.canEdit)) return;
		return tool.run(this, ev.currentTarget);
	}

	async _addPerson() {
		const graph = readGraph(this.boardDoc);
		const already = new Set(Object.values(graph.nodes).map(n => n.uuid).filter(Boolean));
		const actors = (game.actors?.contents ?? [])
			.filter(actor => ["character", "npc"].includes(actor.type) && !already.has(actor.uuid));
		if (!actors.length) {
			ui.notifications?.info?.(localize("stonetop.relmap.everyoneAdded"));
			return;
		}
		// THE ACTOR RIDES ALONG on each row, and not only their name: it is what sorts the chooser
		// into the village's own lists (players, residents, neighbours) and what puts each person's
		// face beside their name. See utils/people-groups.js.
		const chosen = await pickPersonToAdd({
			options: actors.map(actor => ({ id: actor.uuid, name: actor.name, actor })),
		});
		// An array, because that window takes as many answers as the reader ticks. Nobody ticked
		// cannot happen (its button is dead until somebody is), so an empty one means backing out.
		// Keyed rather than scanned: a reader adding half the village to a board with the rest of it
		// already on would otherwise walk the candidate list once per person they ticked.
		const byUuid = new Map(actors.map(actor => [actor.uuid, actor]));
		const picked = (chosen ?? []).map(uuid => byUuid.get(uuid)).filter(Boolean);
		if (!picked.length) return;
		if (picked.length === 1) {
			const [actor] = picked;
			await this._addNodeFor(actor, freeSpot(takenSpots(graph), { r: this._boardSize(graph).r }));
			return;
		}
		await this._addNodesFor(graph, picked);
	}

	/**
	 * Seat several people at once, in ONE write.
	 *
	 * NOT A LOOP OVER `_addNodeFor`, and the difference is what the table sees. Six calls is six
	 * document updates, six broadcasts and six repaints on every open window, six lines in the chat
	 * of announcements, and six steps to undo something the reader did once. It is also six seatings
	 * worked out against a board that has not been written yet, so the second arrival lands on the
	 * first: `freeSpot` reads the graph, and the graph does not know about anybody still in flight.
	 *
	 * `seatArrivals` is the same seater the party and village boards fill themselves with, which is
	 * what keeps a newcomer off somebody's lap here too: it sizes the portraits for the board these
	 * people are about to MAKE (the sheet grows with its cast), keeps its own list of what is taken
	 * as it goes, and lays a whole ring out where the board it is filling is empty.
	 */
	async _addNodesFor(graph, actors) {
		const seating = seatArrivals(graph, actors.map(actor => ({
			uuid: actor.uuid, name: actor.name, img: actor.img ?? "",
		})));
		const patch = addNodesPatch(seating.nodes);
		if (!Object.keys(patch).length) return;
		const count = Object.keys(seating.nodes).length;
		return this._write(patch, {
			announce: format("stonetop.relmap.addedCount", { count }),
			label: format("stonetop.relmap.history.addedCount", { count }),
		});
	}

	async _addNodeFor(actor, spot) {
		const id = foundry.utils.randomID();
		return this._write(addNodePatch(id, {
			uuid: actor.uuid, name: actor.name, img: actor.img ?? "",
			x: spot.left, y: spot.top,
		}), {
			announce: format("stonetop.relmap.added", { name: actor.name }),
			label: format("stonetop.relmap.history.added", { name: actor.name }),
		});
	}

	// ── The words along the lines ────────────────────────────────────────────

	/**
	 * Take the writing off every line on this board, or put it back.
	 *
	 * WHAT IT IS FOR IS A BOARD NOBODY CAN READ. A village of forty carries a hundred lines, every
	 * one of them captioned, and at the zoom that fits the whole board into the window the words
	 * are a grey thicket over the diagram: the shape of who knows whom -- which is the question a
	 * whole board is being looked at to answer -- is the thing the writing buries. Off, the same
	 * board is a web of coloured strokes between faces, and every caption is still one press away.
	 *
	 * THE READER'S OWN, AND IT WRITES NOTHING. No caption is changed, shortened or rubbed out;
	 * nobody else's window moves; unticking it brings every word straight back. It is the one
	 * control in here that a reader who may only look can reach, and deliberately so -- the person
	 * most in need of quieting a hundred captions is exactly the player who may not touch them.
	 *
	 * ⚠ A CLASS AND NOT A REPAINT, which is the difference between this and the filter it replaced.
	 * The old checkbox took whole LINES out of the picture, and lines are measured: the fans, the
	 * dodges and the room each caption has all had to be worked out again, so it had to repaint.
	 * Words are only painted. The gaps cut in the strokes for them are the one thing a stylesheet cannot put
	 * back -- a gap is a length missing from the path data -- and `_paintLineGaps` writes the
	 * unbroken form that every shape has been carrying all along.
	 *
	 * ⚠ EXCEPT THE LINE THE READER IS HOLDING: with no text box on the tie bar, the caption IS where
	 * typing shows. A reader who turned the words off and then clicked a line to write on it would
	 * be typing into nothing.
	 *
	 * ⚠ AND THIS IS THE ONLY WAY THE WORDS GO. Zooming out does not take them: the board paints its
	 * captions at every scale (`_paintCaptionZoom`), so a quiet board is one somebody asked for.
	 */
	_toggleLabels(box) {
		this._hideLabels = !!box?.checked;
		// Said BEFORE the board changes under it, as every other announcement in this window is: a
		// message posted after a repaint can land on markup that has already been thrown away.
		this._announce(localize(`stonetop.relmap.labelsNow.${this._hideLabels ? "on" : "off"}`));
		this._root?.classList?.toggle?.("captions-off", this._hideLabels);
		// The holes in the strokes, healed or cut again. The class alone leaves a board of lines
		// with conspicuous breaks in them for nothing.
		this._paintLineGaps();
	}

	/**
	 * Open the board in front of the reader as a window of its own.
	 *
	 * ⚠ THE PAGE GOES WITH IT. A reader presses this while looking at one particular board of
	 * this map, and a window that opened on whichever page comes first would be a different
	 * picture than the one they were pointing at. `openRelationshipMap` forwards a `pageId` both
	 * to a window it makes and to one already open, which is the same route the Journal sidebar
	 * and window-restore take.
	 *
	 * WRITTEN HERE RATHER THAN ON THE PANEL because it says something true of any surface: bring
	 * up a window on this board. On the window itself that resolves to bringing itself to the
	 * front, which is harmless and is why the button is gated on the CONTEXT rather than on a
	 * method existing. The two boards that result are peers, not a copy and an original -- both
	 * read the same document and both repaint from the same hooks -- exactly as the expedition's
	 * map panel and its popped-out window are.
	 */
	_popOut() {
		const entry = this.entry;
		if (!entry) return null;
		return openRelationshipMap(entry, this._pageId ? { pageId: this._pageId } : {});
	}

	/**
	 * Light up one person's whole web, or nobody's.
	 *
	 * WHAT IT IS FOR IS THE QUESTION A DENSE BOARD CANNOT ANSWER: not "what does this one line
	 * say" but "what does everybody think of her". Resting on a face marks every line and caption
	 * touching it, and the stylesheet quiets the rest. It is what lets a board with two hundred
	 * lines on it still be read a person at a time, and it is the whole of what a crowded board has
	 * now that the captions cycle is gone.
	 *
	 * Written straight onto the elements rather than through a repaint: this fires on every
	 * pointer crossing a portrait, and a repaint per crossing would be a re-render of the whole
	 * board at the speed of a moving mouse.
	 */
	_lightPerson(id) {
		const want = id ?? null;
		const root = this._root;
		if (!root) { this._lit = want; return; }
		// Found by walking and reading `dataset`, never by building a selector out of a stored id:
		// an id goes into a selector as TEXT, and the first one with a colon or a quote in it is a
		// syntax error. `indexEdgeParts` at the foot of this file makes the same choice.
		// SOMEBODY NO LONGER ON THE BOARD IS NOBODY. This is put back after every repaint, and the
		// repaint may be the one that carried away the very person the pointer was resting on:
		// another player taking them off the map. Left alone, the board would dim everything to
		// light up a web that is not there any more. Walked rather than spread into an array: this
		// runs on every change of the lit person, which is dozens a second across a busy board.
		let onBoard = false;
		for (const el of root.querySelectorAll?.("[data-relmap-node]") ?? []) {
			if (el.dataset.relmapNode === want) { onBoard = true; break; }
		}
		this._lit = onBoard ? want : null;
		root.classList.toggle("is-lit", !!this._lit);
		// EVERY STROKE SAYS WHO IT JOINS, in one list and one attribute, whether it joins two
		// people or a whole household. A household's stroke stands for as many ties as it has
		// children, so resting on any one of them lights the parents, the bar, the rail and every
		// sibling; an ordinary line's list is simply its two ends. Two encodings of one idea would
		// be two loops here and a third the day a stroke joins three people some other way.
		//
		// THE STROKES AND THE CAPTIONS, AND NOT THE FACES. Marking the people at the far end of a
		// lit line was what let the stylesheet dim the rest of them, and that dimming is gone: the
		// faces stay at full strength and the quieting is done on the ties alone.
		//
		// Matched on the padded string rather than by splitting it: the list is space-separated ids,
		// which cannot themselves hold a space, so a padded `includes` is the same test without the
		// two arrays per element that `split().filter()` cost — and this sweep visits every stroke
		// AND every caption on the board each time the pointer crosses a face.
		const lit = this._lit;
		const needle = lit ? ` ${lit} ` : "";
		root.querySelectorAll?.("[data-relmap-who]")?.forEach?.(el => {
			el.classList.toggle("is-lit", !!lit && ` ${el.dataset.relmapWho ?? ""} `.includes(needle));
		});
		this._paintLitCaptions(root);
	}

	/**
	 * Show one person's trash can, or nobody's.
	 *
	 * WHAT IT IS FOR. Taking somebody off this map was the Delete key and nothing else — a gesture
	 * with nothing on screen to say it existed, so in practice a board could be added to and never
	 * subtracted from. A right press on a portrait puts a trash can on it (utils/relmap-drag.js
	 * decides what counts as one, and says why it is not built on `contextmenu`); the button is the
	 * mouse's route to the same confirm the key opens.
	 *
	 * ONE AT A TIME, and it is a sweep rather than a remembered element for that reason: the class
	 * moves between at most two nodes on a board of forty, and the sweep is what guarantees there
	 * is never a second can left showing on somebody the reader has stopped pointing at. (The
	 * held-line mark opposite makes the other choice, and says why: it moves between THREE elements
	 * out of two hundred and forty, on every repaint.)
	 *
	 * ⚠ SOMEBODY NO LONGER ON THE BOARD IS NOBODY, exactly as in `_lightPerson`. This is put back
	 * after every repaint, and the repaint may be the one that carried that very person away —
	 * another player taking them off, or this reader's own removal landing. Written back from what
	 * the sweep actually found, so the state can never name a portrait that is not there.
	 *
	 * Straight onto the elements rather than through a repaint: a repaint per right-click would
	 * rebuild the whole board to show one 22px button.
	 */
	_armRemove(id) {
		const want = id ?? "";
		// NOTHING SHOWING AND NOTHING ASKED FOR. Every click anywhere on this board asks for
		// `null`, which is how the can closes, and on all but one of them there was no can open:
		// without this, reading a map would be a sweep of forty portraits per click to take a class
		// off none of them.
		if (!want && !this._armed) return;
		const root = this._root;
		if (!root) { this._armed = want; return; }
		let found = false;
		// Walked and read off `dataset`, never a selector built out of a stored id: an id goes into
		// a selector as TEXT, and the first one carrying a colon or a quote is a syntax error. The
		// same choice `_lightPerson` and `indexEdgeParts` make, for the same reason.
		root.querySelectorAll?.("[data-relmap-node]")?.forEach?.(el => {
			const mine = !!want && el.dataset.relmapNode === want;
			if (mine) found = true;
			el.classList?.toggle("is-arming", mine);
		});
		this._armed = found ? want : "";
	}

	/**
	 * Mark which stroke on the board the tie bar is holding, and unmark the last one.
	 *
	 * ON THE WINDOW because the board's markup is the window's: it builds those elements and throws
	 * them away wholesale on every repaint, and `indexEdgeParts` is the one walker that knows which
	 * families a line is made of. The bar had a private copy of that list, which meant the invisible
	 * click target had to be added in two files at once with nothing to fail if one was missed. It
	 * asks for this instead, the way it asks for everything else about the board it cannot know.
	 *
	 * TAKEN OFF THE ELEMENTS IT WAS PUT ON rather than swept off the board. This runs on every
	 * repaint -- every remote edit, every drag end -- and a sweep is a `classList` write per stroke,
	 * per target and per caption on a board that carries eighty of each, to move one class between
	 * three of them. The remembered elements may have been detached by then, which costs nothing.
	 */
	_paintPickedLine(id) {
		for (const el of this._pickedParts ?? []) el.classList?.remove("is-picked");
		this._pickedParts = [];
		const board = id ? this._boardEl() : null;
		if (!board) return;
		// Found by walking and reading `dataset`, never by a selector built out of a stored id -- see
		// `indexEdgeParts` itself, which says why.
		const parts = indexEdgeParts(board).get(id);
		for (const el of [parts?.line, parts?.hit, parts?.label]) {
			if (!el) continue;
			el.classList?.add("is-picked");
			this._pickedParts.push(el);
		}
	}

	/**
	 * Mark the board when its captions have gone under the size type is legible at.
	 *
	 * ⚠ THE CAPTIONS ARE PAINTED AT EVERY ZOOM. This used to take them away below the floor and it
	 * no longer does: what a line SAYS is said on the line, and a reader who zooms out to see the
	 * shape of the whole web is exactly the reader who wants to see where the writing is. Small
	 * type they can lean into beats a diagram that has silently stopped saying anything.
	 *
	 * WHAT THAT COSTS, AND WHY IT IS AFFORDABLE NOW. Hiding them was once the map's performance fix:
	 * the words were warped onto a `<textPath>` and stroked with a halo, which misses the glyph
	 * cache on every glyph, and the cost is per glyph ON SCREEN — worst at exactly this scale, where
	 * the whole board is in the viewport. Measured then: 5.3 SECONDS of raster at a third size. The
	 * words are set STRAIGHT now, turned to their line's angle, and the same board rasters a tile in
	 * 1.2ms. The floor was carrying a bill that has already been paid. (Do not put the rail back —
	 * see the board partial, and never give the caption layer a `will-change`.)
	 *
	 * SO THE CLASS SAYS ONLY THAT THE TYPE IS TINY, and one rule hangs off it: the held line's
	 * caption is blown up so that whoever is typing can read what they typed. The rule is the
	 * PAINTED SIZE OF THE TYPE and not a zoom number, so it moves with whatever the stylesheet sets
	 * the captions in — `_fitGapsToPaint` has already read that off a real caption.
	 * `RELMAP_CAPTION_FLOOR_PX` is the smallest type that reads as type, and this is the one board
	 * in the system with a reader on a screen magnifier looking at it, so it is generous.
	 */
	_paintCaptionZoom(surface) {
		const root = this._root;
		if (!root?.classList) return;
		const scale = Number(surface?.scale);
		const px = Number(this._drawn?.captionPx) || RELMAP_CAPTION_PX;
		// Unknown scale means treat the type as ordinary: a board that has not been sized yet must
		// not open with one caption blown up over the rest.
		const tiny = scale > 0 && scale * px < RELMAP_CAPTION_FLOOR_PX;
		root.classList.toggle("captions-tiny", tiny);
		// ⚠ AND THE CAPTION THE READER IS HOLDING IS BLOWN UP TO BE READABLE. With the box gone off
		// the tie bar, the line they are holding is the only place their typing shows -- and a whole
		// board fitted into the window is under this threshold, which is the zoom it OPENS at. Every
		// other caption is painted at the size the board is showing it; this is the size the held
		// one keeps: board pixels chosen to come out at `CAPTION_READ_PX` on screen, so the words
		// stay the same size to read while the board shrinks under them. Above the threshold the
		// variable goes and the caption is set like every other one.
		const say = tiny ? `${Math.round((CAPTION_READ_PX / scale) * 10) / 10}px` : "";
		// Written only when it CHANGES. This runs on every painted frame of a pan, where the scale
		// is the one thing that has not moved.
		if (say !== this._sayPx) {
			this._sayPx = say;
			if (say) root.style?.setProperty?.("--relmap-say-px", say);
			else root.style?.removeProperty?.("--relmap-say-px");
		}
		this._paintLineGaps();
	}

	/**
	 * Heal the holes in the strokes when there is no caption to sit in them.
	 *
	 * Every line is drawn BROKEN, with a length of it cut out exactly where its caption goes
	 * (`curveWithGap`), because the words sit in the line rather than over it. Take the words away —
	 * which only the reader turning the captions off does — and what is left is a web of lines with
	 * conspicuous breaks in them for nothing, which reads as a broken diagram rather than a quiet
	 * one.
	 *
	 * NOT IN `hover` MODE. There the captions are still being painted, one person's at a time, and a
	 * line healed until the pointer arrives would have to break again underneath the caption the
	 * moment it did.
	 *
	 * BY REDRAWING AND NOT BY A CLASS, because a gap is a length missing from the path data and no
	 * stylesheet can put it back. Both forms were worked out at render time and are held on the
	 * shape, so this is a write and never a calculation; and it happens only when the answer
	 * changes, which is when the reader ticks the box and at no other time -- a pan and a zoom reach
	 * this on every painted frame and leave at the early-out below.
	 */
	/**
	 * The board element, looked up ONCE per render rather than per call.
	 *
	 * ⚠ CACHED BECAUSE OF WHERE THIS IS ASKED FROM. Five callers wanted it, and two of them are on
	 * paths that run many times a second: `_paintLineGaps`, which a pan reaches through `onChange`
	 * on every painted frame, and `_isBusy`, inside the hover handler. A `querySelector` per call
	 * on those is a tree walk the render already did.
	 *
	 * KEYED ON `_root` AND NOT SIMPLY ASSIGNED, which is what makes it safe: the cache is thrown
	 * away the moment the root it was found in is not the current one, so a re-render cannot leave
	 * this pointing into a document fragment that has already been replaced. `_repaintBoard` writes
	 * this element's innerHTML and never the element itself, so a repaint keeps it.
	 */
	_boardEl() {
		if (this._boardRoot !== this._root) {
			this._boardRoot = this._root;
			this._board = this._root?.querySelector?.(".stonetop-relmap-board") ?? null;
		}
		return this._board;
	}

	/**
	 * Is the board drawing its captions at all?
	 *
	 * ONE WAY TO ARRIVE HERE, AND IT IS THE READER'S OWN: the words are off because they turned them
	 * off (`_toggleLabels`). Zoom does not answer this any more -- the board paints its captions at
	 * every scale, however small the type gets (`_paintCaptionZoom` says why) -- so a board zoomed
	 * out keeps its gaps cut, its sentences fitted, and its writing on it.
	 *
	 * STILL A QUESTION AND NOT A FLAG READ, and still asked of the ROOT'S CLASSES rather than of the
	 * flag behind them, because the stylesheet is what actually decides: the class IS the state, and
	 * asking anything else invites the paint and the arithmetic to disagree about which board is on
	 * screen. Everything downstream asks here, so there is one answer to change.
	 */
	_captionsHidden() {
		return !!this._root?.classList?.contains?.("captions-off");
	}

	_paintLineGaps() {
		const drawn = this._drawn;
		if (!drawn?.shapes?.size) return;
		// ⚠ THE ANSWER IS WORKED OUT BEFORE THE BOARD IS TOUCHED, because this runs on every
		// painted frame of a pan (through `onChange` -> `_paintCaptionZoom`) and nearly every one
		// of those leaves at the line below with nothing to do. Reading the element and its
		// classes first spent a lookup and a style read per frame to reach an early-out.
		const whole = this._captionsHidden();
		if (drawn.healed === whole) return;
		const board = this._boardEl();
		if (!board) return;
		drawn.healed = whole;
		for (const line of board.querySelectorAll?.("[data-relmap-line]") ?? []) {
			const shape = drawn.shapes.get(line.dataset?.relmapLine);
			if (!shape?.curve) continue;
			// ⚠ `shape.unbroken` AND NOT `shape.curve.d`. Healing a line means putting the caption's
			// hole back, and nothing else: the curve's own `d` runs to the very tip of any
			// arrowhead on it, which is the one place a stroke must not go.
			line.setAttribute("d", whole ? (shape.unbroken ?? shape.curve.d) : (shape.d ?? shape.curve.d));
		}
	}

	/**
	 * Draw the lit person's captions a second time, over the dimmed layer and over the portraits.
	 *
	 * ⚠ WHY THE HIGHLIGHT IS A COPY RATHER THAN A CLASS. Dimming the quiet captions used to be an
	 * `opacity` on each of a hundred `<g>` elements, and opacity on a group costs the browser an
	 * offscreen buffer apiece — a hundred of them, thrown away and rebuilt every time the pointer
	 * crossed onto or off a portrait. One opacity on the layer as a whole costs one.
	 *
	 * So the layer is dimmed entire, and the handful of captions that should stay bright are drawn
	 * AGAIN here, over the top. (What makes a hundred captions affordable at all is that the words
	 * are set STRAIGHT rather than warped onto a rail — see below, and the board partial.)
	 *
	 * A CAPTION IS A GROUP AND ONE `<text>`, which is why there is nothing to unpick here beyond the
	 * attributes below. It used to be words warped along a `<path>` rail, and the copy had to strip
	 * that rail and point back at the original's by id; the rail is gone (warped text that is also
	 * stroked costs a repaint per raster tile, which froze the whole canvas while panning), and with
	 * it went the only part of a caption a clone could not simply carry.
	 *
	 * AND IT IS NOT A TARGET. Every hook a reader could reach it by is stripped: the caption it
	 * copies is still in the layer above, still focusable, still what a click means, and a second
	 * copy of the same button would be announced twice and aimable twice.
	 */
	_paintLitCaptions(root) {
		const lift = root.querySelector?.(".stonetop-relmap-labels-lit");
		if (!lift) return;
		// Cleared first and unconditionally: the previous person's web is never part of this one.
		lift.replaceChildren?.();
		if (!this._lit) return;
		const doc = root.ownerDocument;
		if (!doc?.createElement) return;
		for (const caption of root.querySelectorAll?.(".stonetop-relmap-labels .stonetop-relmap-label") ?? []) {
			if (!caption.classList?.contains?.("is-lit")) continue;
			const copy = caption.cloneNode?.(true);
			if (!copy) continue;
			// Everything that makes the original findable, aimable or announceable.
			for (const el of [copy, ...(copy.querySelectorAll?.("*") ?? [])]) {
				for (const gone of ["id", "tabindex", "role", "aria-label", "data-tooltip",
					"data-relmap-edge", "data-relmap-who", "data-relmap-words"]) {
					el.removeAttribute?.(gone);
				}
			}
			lift.appendChild?.(copy);
		}
	}

	// ── Resting on a face ───────────────────────────────────────────────────

	/**
	 * Light one person's web while the pointer, or the keyboard, is on them.
	 *
	 * DELEGATED FROM THE BOARD and bound to `pointerover`/`pointerout`, which bubble, rather than
	 * to `mouseenter` on each portrait, which does not: there are forty of them and they are
	 * replaced wholesale by every repaint, so a listener each is forty listeners to lose track of.
	 *
	 * FOCUS COUNTS AS RESTING. The whole board is reachable by keyboard (that is why the handle is
	 * a button and the arrow keys nudge), and a highlight only a mouse can summon would take the one
	 * thing that makes a crowded board readable away from everybody who does not use one.
	 *
	 * NOT WHILE A DRAG IS LIVE. The pointer crosses half the board during one, and re-marking every
	 * line at each crossing is work per frame for a highlight nobody asked for mid-gesture.
	 */
	_wireLighting(board) {
		const at = target => target?.closest?.("[data-relmap-node]")?.dataset?.relmapNode ?? null;
		// ARRIVING READS THE TARGET, LEAVING READS WHERE IT WENT, which is what keeps this from
		// flickering. A pointer crossing from a portrait's face to the name underneath it fires a
		// `pointerout` on the way to the `pointerover` a moment later, and both are inside the same
		// portrait: asking where the pointer WENT answers the same person both times and nothing
		// is repainted. Asking what it LEFT would unlight the board between every pair of events.
		// THE IDENTITY CHECK FIRST, and `_isBusy` only when there is something to do. These fire on
		// every element boundary the pointer crosses inside the board -- a path, a caption, a name
		// -- and the answer is almost always "the same person as a moment ago", which is no work at
		// all. Asking `_isBusy` first put a board lookup and an `activeElement` walk in front of it.
		const rest = target => {
			const id = at(target);
			if (id === this._lit || this._isBusy()) return;
			this._lightPerson(id);
		};
		board.addEventListener("pointerover", ev => rest(ev.target));
		board.addEventListener("pointerout", ev => rest(ev.relatedTarget));
		// Focus counts as resting: the whole board is reachable from the keyboard, and `relatedTarget`
		// on a focusout is where the focus is going, which is null when it has left the board.
		board.addEventListener("focusin", ev => rest(ev.target));
		board.addEventListener("focusout", ev => rest(ev.relatedTarget));
	}

	// ── Dropping an actor from the sidebar ──────────────────────────────────

	/**
	 * The one HTML5-drag path in the feature, because the sidebar is the drag SOURCE and there is
	 * no choice about it. Safe here where it is not on a character sheet: this window installs no
	 * capture-phase drop handler for it to fight with.
	 */
	_wireDrop(view) {
		// ⚠ ASKED ON `dragenter`, NOT ON `dragover`. `dragover` fires continuously for as long as the
		// pointer is over the board, and `canEdit` is not a field read: it walks the entry's pages,
		// sorts them by name and asks core for a permission per page. That answer cannot change
		// halfway through one drag, so it is resolved once when the drag arrives. The `drop` handler
		// below still asks fresh, which is the check that actually gates the write.
		let mayDrop = null;
		view.addEventListener("dragenter", () => { mayDrop = this.canEdit; });
		view.addEventListener("dragover", ev => {
			mayDrop ??= this.canEdit;   // a drag that began without an enter still gets one answer
			if (!mayDrop) return;
			ev.preventDefault();
			view.classList.add("is-dropping");
		});
		view.addEventListener("dragleave", () => view.classList.remove("is-dropping"));
		view.addEventListener("drop", async ev => {
			view.classList.remove("is-dropping");
			if (!this.canEdit) return;
			ev.preventDefault();
			// Through the compat helper, which already knows where this moved between cores. The
			// version dance was written out here once and that is one more place to fix it.
			const data = getDragEventData(ev);
			if (data?.type !== "Actor") return;
			const actor = await fromUuid(data.uuid);
			if (!actor) return;
			const graph = readGraph(this.boardDoc);
			if (Object.values(graph.nodes).some(node => node.uuid === actor.uuid)) {
				ui.notifications?.info?.(format("stonetop.relmap.alreadyHere", { name: actor.name }));
				return;
			}
			// Where they were dropped, or a clear spot when the drop landed off the board.
			const at = this._surface?.pointToPercent(ev);
			const spot = at && at.left >= 0 && at.left <= 100 && at.top >= 0 && at.top <= 100
				? { left: at.left, top: at.top }
				: freeSpot(takenSpots(graph), { r: this._boardSize(graph).r });
			await this._addNodeFor(actor, spot);
		});
	}

	/**
	 * Come up minimized, once there is a window to minimize.
	 *
	 * A restored board is asked for this the instant it is opened (utils/window-restore.js, via the
	 * bouncer sheet), which is before its first render has finished — and `Application#minimize`
	 * returns without doing anything for a window that is not on screen yet, silently, so asking
	 * then would simply lose the state the reader left the window in. Held instead, and applied by
	 * the render below.
	 */
	openMinimized() {
		if (this.rendered) return this.minimize();
		this._minimizeOnRender = true;
		return Promise.resolve();
	}

	/**
	 * Say whatever the render that has just finished was asked to say.
	 *
	 * For the callers that cannot wait for a render to speak for themselves — `showPage`, which
	 * is the only one so far. Cleared before it is said, so a render nobody asked anything of does
	 * not repeat the last thing somebody did.
	 */
	_saySoFar() {
		const said = this._sayOnRender;
		if (!said) return;
		this._sayOnRender = null;
		this._announce(said);
	}

	/**
	 * Put the reader's keyboard focus back on the control they just used.
	 *
	 * AppV1 replaces the window's whole content on a render, so focus goes to the document body —
	 * and switching page is the one thing in this window that renders. Without this, changing board
	 * from the keyboard means tabbing in from the top of the window again every single time, on a
	 * strip the whole point of which is that it is walked along. The announcement is the only
	 * other thing a reader who cannot see the board gets from the press, and an unfocused one is
	 * easy to miss.
	 *
	 * A SELECTOR AND NOT AN ELEMENT, because the element it names was thrown away by the render
	 * that this is putting right. Absent unless something asked, so an ordinary render — a live
	 * update that could not be repainted, a resize — never steals focus from wherever the reader
	 * actually is.
	 */
	_takeFocusBack() {
		const want = this._focusOnRender;
		if (!want) return;
		this._focusOnRender = null;
		this._root?.querySelector(want)?.focus?.();
	}

	async _render(force, options) {
		// A window shut earlier and opened again is this same instance, so the note that it was
		// shut is cleared by the render rather than carried into it. See `close`.
		this._closed = false;
		// BEFORE ANYTHING IS DRAWN, because a map still on version 1 has no page for the strip to
		// name and the board would come up under a tab called after the map itself. Once, and
		// nothing at all on every map made since. See `_ensurePage`.
		await this._ensurePage();
		await super._render(force, options);
		// ⚠ SHUT WHILE THIS WAS DRAWING, and nothing has been torn down. Both awaits above give a
		// close somewhere to land — `_ensurePage` on a version-1 map is a document round trip — and
		// AppV1's `close` returns at once for anything that is not RENDERED, so it neither stopped
		// this render nor unwired the window: THIS render is what wires the window up, a moment from
		// now in `activateListeners`. Left alone, five world hooks, a pan surface, a tie bar and a
		// drag belong to a window nobody holds, and every journal write at the table for the rest of
		// the session repaints a board that is not on screen — once for every sheet ever opened on
		// the steading's map tab.
		if (this._closed) {
			this._teardown();
			// The state is RENDERED now, so the close that could not run can. Straight to the
			// parent, because our own `close` already ran everything it does before this line.
			return super.close(this._closeOptions ?? {});
		}
		// The live region is only NOW the one the reader is on, and so is the control they pressed.
		this._saySoFar();
		this._takeFocusBack();
		if (!this._minimizeOnRender) return;
		this._minimizeOnRender = false;
		await this.minimize();
	}

	/**
	 * Unwire everything a render wired: the pan surface, the drag, the tie bar, and every world hook
	 * this window registered.
	 *
	 * IDEMPOTENT, AND IT HAS TO BE — two callers reach it. The close is the ordinary one; the other
	 * is a render finishing after a close that could do nothing, which is the only way this window
	 * can be wired up and unheld at the same time. See `_render`.
	 */
	_teardown() {
		this._surface?.destroy();
		this._surface = null;
		this._tieBar?.destroy();
		this._tieBar = null;
		this._teardownDrag?.();
		this._teardownDrag = null;
		// EVERY WORLD HOOK THIS WINDOW REGISTERED, from the list rather than by name: see `_hooks`.
		// Emptied as well as unregistered, so that a window reopened on the same instance wires
		// itself up again rather than meeting `_wireSync`'s already-wired guard and going deaf.
		for (const [name, handler] of this._hooks) Hooks.off(name, handler);
		this._hooks = [];
	}

	async close(options = {}) {
		// ⚠ READ BACK BY `_render`, and that is why it is a flag on the window rather than a local.
		// A close can arrive while the FIRST render is still in the air, and AppV1 answers it by
		// doing nothing at all — see there for what would otherwise be left running.
		this._closed = true;
		this._closeOptions = options;
		// A nudge or a caption still waiting on its debounce would otherwise go with the window: the
		// last thing somebody typed before closing one is the last thing they expect to have lost.
		// BEFORE the teardown, while the bar still holds both the id and the field.
		this._leaveBoard();
		this._teardown();
		return super.close(options);
	}
}

/**
 * Every link's geometry for one graph, each of them from ONE `edgeCurve` call.
 *
 * WHY IT IS SHARED. The three renderers of a line — the stroke, its label and its arrowheads — have
 * to agree to the pixel, or a label sits off its own stroke. There are now two callers wanting
 * those numbers, the board's markup and the live drag, and the second working them out its own way
 * is exactly how the two would come to disagree.
 *
 * `only` narrows it to the links touching one person, which is all that a drag of that person can
 * move: everybody else's lines are where they were, and recomputing them would be work per frame
 * for no pixel changed.
 */
function edgeShapes(graph, {
	r, fans, only = null, spread = false, boardWidthPx = RELMAP_BOARD_WIDTH,
	painted = null,
} = {}) {
	// Every face on the board, which each line has to get past. Gathered once for the whole
	// walk rather than per link: the list is the same for all of them, and a link's own two ends
	// are recognised by where they are and left out by `clearanceBow` itself.
	const faces = Object.values(graph.nodes).map(node => ({ left: node.x, top: node.y }));
	const out = [];
	for (const [id, edge] of Object.entries(graph.edges)) {
		if (only && edge.a !== only && edge.b !== only) continue;
		const from = graph.nodes[edge.a];
		const to = graph.nodes[edge.b];
		const ends = {
			from: { left: from.x, top: from.y },
			to: { left: to.x, top: to.y },
		};
		// The fan keeps this link off its own twins; the clearance keeps it off everybody else's
		// face. Added rather than either one winning, so a second link between two people is still
		// spread from the first even when both have to dodge the same person.
		// The dodge is measured on the pair's UNFANNED route, so every link between the same two
		// people is bent aside by the same amount and they part company by their fan index alone.
		// `edgeBow` puts the two together, and says why they cannot simply be added.
		const dodge = clearanceBow({ ...ends, avoid: faces, aspect: RELMAP_BOARD_ASPECT, r });
		const curve = edgeCurve({
			...ends,
			bow: edgeBow(fans[id] ?? 0, dodge),
			aspect: RELMAP_BOARD_ASPECT,
			r,
		});
		// WHERE THE MIDDLE OF THIS LINE IS, worked out for every line and not only the ones with
		// something written on them. It is the caption's anchor where there IS a caption, and it is
		// also where the tie bar floats -- which a line with nothing written on it needs just as
		// much, since the bar is the only way to write anything on it.
		//
		// ⚠ ONE CALL, TWO FIELDS, AND THE SPREADER MOVES ONLY ONE OF THEM. `anchor` is reassigned
		// below (never mutated) when the captions are spread apart, so `mid` keeps the honest
		// middle of the stroke while `anchor` follows the words wherever they were nudged to. Both
		// are wanted: the bar sits over the caption a reader can see, and falls back to the middle
		// of the line when there is no caption to sit over.
		const middle = curve ? edgeLabelAnchor(curve, RELMAP_BOARD_ASPECT) : null;
		// HOW LONG THIS CAPTION IS, worked out here rather than with the gap below because the
		// caption's SEAT depends on it: the words are a straight run over a bowed line, and which
		// straight run is the one whose two ends land on the stroke either side of them. See
		// `edgeLabelAnchor`. Kept on the shape, so the seat, the spreader's obstacle box and the
		// hole cut in the stroke are all measured off one number.
		const size = curve && edge.label
			? captionSize(edge.label, curve, {
				boardWidthPx, paintedPx: painted?.get(id) ?? null, px: edge.size,
			})
			: null;
		out.push({
			id,
			edge,
			curve,
			size,
			mid: middle,
			anchor: size ? edgeLabelAnchor(curve, RELMAP_BOARD_ASPECT, 0.5, size.w) : null,
			// The sheet goes through because the head stands off the rim by a PIXEL distance and
			// this board may be any width: see `RELMAP_HEAD_PX`.
			heads: curve ? edgeArrowheads(curve, RELMAP_BOARD_ASPECT, edge.dir, { boardWidthPx }) : [],
		});
	}

	// WHERE THE CAPTIONS SETTLE, and only on a full repaint. `spread` is false for the live drag
	// because that path recomputes ONE person's links per frame and knows nothing about the other
	// captions on the board: re-placing them from a partial view would shuffle chips belonging to
	// links nobody is touching, sixty times a second. The drop's repaint puts them all right, and
	// in between a caption riding the middle of its own moving line is exactly what it looks like.
	if (spread) {
		const anchors = spreadLabels({
			// ⚠ AND THE SIZE EACH ONE IS SET IN, because a caption the reader has made bigger takes
			// more room in the pile. Left out, the spreader would measure every chip at the ordinary
			// twelve, slide the board's quiet captions apart perfectly, and leave the one the table
			// cares about lying across two of them.
			labels: out.filter(shape => shape.anchor).map(shape => ({
				id: shape.id, curve: shape.curve, text: shape.edge.label, px: shape.edge.size,
			})),
			nodes: faces,
			aspect: RELMAP_BOARD_ASPECT,
			r,
			boardWidthPx,
		});
		for (const shape of out) {
			if (shape.anchor) shape.anchor = anchors.get(shape.id) ?? shape.anchor;
		}
	}

	// WHERE THE LINE GETS OUT OF ITS CAPTION'S WAY, and the last thing done because it depends on
	// where the caption finally settled. Both callers come through here, so a line is broken the
	// same way on a full repaint and under a live drag: without that, dragging a portrait would
	// heal every one of its lines for the length of the gesture and break them again on release.
	for (const shape of out) {
		if (!shape.curve) { shape.d = ""; shape.unbroken = ""; continue; }
		// THE SAME LINE WITH NO HOLE IN IT, kept beside the broken one because the reader turning
		// the captions off puts it back (`_paintLineGaps`). It may not reach for `curve.d` -- that
		// is the run end to end, and an end wearing an arrowhead has to stop short of it.
		shape.unbroken = curveWithGap(shape.curve, { boardWidthPx, dir: shape.edge.dir });
		if (!shape.anchor) { shape.d = shape.unbroken; continue; }
		// HOW WIDE THIS ONE CAPTION MAY GET, which is its own line's business and not the board's:
		// a long line carries its whole sentence, a short one is still promised a few words. Sent
		// out with the shape because the stylesheet has to paint at exactly the width the gap below
		// was cut for, and the two are only the same number if there is only one of them.
		shape.labelMax = Math.round(captionRoomPx(shape.curve, { boardWidthPx }));
		// THE CAPTION AS IT WAS PAINTED, where anybody has been able to measure it. Counting
		// characters overshoots this font by about a fifth, and every pixel of that overshoot is a
		// pixel of stroke rubbed out for a word that was never there: see `labelSize`. Absent on a
		// first paint, where there is nothing on screen yet to measure -- `_fitGapsToPaint` cuts
		// those gaps again as soon as there is.
		//
		// MEASURED ONCE, ABOVE, because the same number seats the caption: the hole and the words
		// have to be the same stretch of the same line or the words sit beside their own hole.
		shape.d = curveWithGap(shape.curve, {
			t: shape.anchor.t, span: shape.size.w, boardWidthPx, dir: shape.edge.dir,
		});
	}
	return out;
}

/**
 * Every piece of every line already on the board, found once and filed under its link's id.
 *
 * By one walk into a Map rather than a selector per link: an id goes into a selector as text, and a
 * selector built by hand out of a stored id is a syntax error waiting for the first id with a
 * quote or a colon in it. Reading `dataset` back off the elements asks no such question.
 */
function indexEdgeParts(board) {
	const parts = new Map();
	const partsFor = id => {
		let found = parts.get(id);
		if (!found) parts.set(id, found = { line: null, hit: null, label: null, words: null, heads: {} });
		return found;
	};
	const each = (selector, put) => board.querySelectorAll?.(selector)?.forEach?.(put);
	each("[data-relmap-line]", el => { partsFor(el.dataset.relmapLine).line = el; });
	// The invisible wide stroke a click lands on. Found and moved with the painted one, or a line
	// dragged across the board would leave its target behind at the spot it was picked up from --
	// which is worse than no target, because the reader would be clicking a line that is not there.
	each("[data-relmap-hit]", el => { partsFor(el.dataset.relmapHit).hit = el; });
	each("[data-relmap-edge]", el => { partsFor(el.dataset.relmapEdge).label = el; });
	// The words themselves, which are the whole of a caption: found the same way as everything else
	// here rather than by reaching into the group with a selector built out of a stored id.
	each("[data-relmap-words]", el => { partsFor(el.dataset.relmapWords).words = el; });
	each("[data-relmap-head]", el => { partsFor(el.dataset.relmapHead).heads[el.dataset.relmapEnd] = el; });
	return parts;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * A caption for a line that has never had one, put on the board now.
 *
 * ONE CALLER AND ONE REASON: `_sayLine`, for the first letter typed onto a line the reader has just
 * drawn. Every other caption on this board is built by the template out of the `labels` list, and
 * that stays the one place a caption is really made -- the write behind this keystroke replaces the
 * whole board's markup a few hundred milliseconds later, and the caption this mints goes with it.
 * What is built here is therefore the SHAPE of one and not the whole of it: the class hooks the
 * stylesheet paints by, the data hooks the index and the click handling find it by, and the size
 * the reader has set on this line. The tooltip and the accessible name are the sentence itself and
 * are built with the rest of the board (see the `labels` loop in `getData`), so a caption half typed
 * carries no stale copy of either.
 *
 * ⚠ IT IS FILED IN THE INDEX IT WAS ASKED FOR, not left for the next walk to find. That index is
 * what `_sayLine` reaches into on every one of the keystrokes that follow this one, and a caption on
 * the board but not in it would be minted again on each of them.
 *
 * @param {HTMLElement|null} board  the board these lines are drawn on.
 * @param {string} id     the link this caption belongs to.
 * @param {object} shape  that line's geometry, from `edgeShapes`.
 * @param {Map} index     the parts index to file the new elements in.
 * @returns {object|null} the line's parts, with `label` and `words` now filled in.
 */
function mintCaption(board, id, shape, index) {
	const layer = board?.querySelector?.(".stonetop-relmap-labels");
	const doc = layer?.ownerDocument;
	if (!doc?.createElementNS) return null;
	const group = doc.createElementNS(SVG_NS, "g");
	group.setAttribute("class", "stonetop-relmap-label");
	group.setAttribute("data-relmap-edge", id);
	// Both ends, as every other piece of a line carries them: resting on a portrait lights that
	// person's whole web, and a caption left out of that would be the one part of the line that
	// stayed dark.
	group.setAttribute("data-relmap-who", `${shape.edge.a} ${shape.edge.b}`);
	const words = doc.createElementNS(SVG_NS, "text");
	words.setAttribute("class", "stonetop-relmap-label-text");
	words.setAttribute("role", "button");
	words.setAttribute("tabindex", "0");
	words.setAttribute("data-relmap-words", id);
	// A CUSTOM PROPERTY AND NOT A `font-size`, for the reason the template gives at length: an
	// inline size is the top of the cascade and would beat the rule that blows the held line's
	// caption up while the board is zoomed too far out to read anything.
	if (shape.edge.size) words.style?.setProperty?.("--relmap-caption-px", `${shape.edge.size}px`);
	group.append(words);
	layer.append(group);
	const found = index.get(id) ?? { line: null, hit: null, label: null, words: null, heads: {} };
	found.label = group;
	found.words = words;
	index.set(id, found);
	return found;
}

/** Where one thing that rides on a line sits, and how far it is turned over. */
function placeOnLine(el, { left, top, angle }) {
	if (!el) return;
	el.style.left = `${left}%`;
	el.style.top = `${top}%`;
	el.style.setProperty("--relmap-turn", `${angle}deg`);
}

/** What a caption that has run out of room ends in. */
const ELLIPSIS = "…";

/**
 * How to measure a caption, given a board that has one on it.
 *
 * A CANVAS AND NOT THE ELEMENT. What is wanted is the advance width of a string in the face the
 * stylesheet ended up painting in, and asking the element costs a layout of the whole board every
 * time — which is unaffordable at the dozens of probes the truncation below takes. A 2D context
 * set to the same font answers the same question with no document work at all; measured against a
 * laid-out caption in this very face, the two agree to a thousandth of a pixel.
 *
 * BUILT FROM A REAL CAPTION rather than from a font written out here. The face comes down the
 * cascade from the dialog, and a copy of it in this file would be a second answer to drift from.
 */
/**
 * The scratch canvas the measuring is done on, kept for the life of the page.
 *
 * ONE OF IT, and not one per pass. `captionMeasurer` runs on every repaint of the board — which is
 * every flag write any client makes to the page — and a canvas minted and thrown away each time is
 * an allocation on the path this feature has a measured raster budget for. Nothing about it is
 * per-board: `ctx.font` is assigned below from the live caption's own computed style, which is the
 * part that has to stay read rather than remembered.
 *
 * Keyed by document because a dialog can be popped out into a second window, and a canvas belongs
 * to the document that made it.
 */
const CAPTION_CANVASES = new WeakMap();

function measuringContext(doc) {
	if (CAPTION_CANVASES.has(doc)) return CAPTION_CANVASES.get(doc);
	const ctx = doc.createElement("canvas").getContext?.("2d") ?? null;
	CAPTION_CANVASES.set(doc, ctx);
	return ctx;
}

/**
 * Whether the reader has set a size on this one caption.
 *
 * ASKED OF THE INLINE STYLE AND NOT OF THE COMPUTED ONE, because the computed answer is the same
 * for a caption that inherited the sheet's size as for one that was given it: the whole point of
 * `--relmap-caption-px` is that it resolves to a `font-size` either way. The template prints the
 * property only where somebody actually chose (see relationship-map-board.hbs), so its PRESENCE is
 * the question, and the attribute is read as well as the declaration because a host with no custom
 * property support in its `CSSStyleDeclaration` still has the markup that was handed to it.
 */
function captionResized(el) {
	if (el.style?.getPropertyValue?.("--relmap-caption-px")) return true;
	return (el.getAttribute?.("style") ?? "").includes("--relmap-caption-px");
}

function captionMeasurer(parts) {
	// ⚠ THE BASE SIZE COMES OFF A CAPTION NOBODY HAS RESIZED, which is what this first walk is for.
	// It used to come off whichever caption the index happened to hold first, and that was wrong in
	// three places at once now that a line can carry a size of its own: one line set in thirty-two
	// made `measure(text, 0)` answer for thirty-two, so every ORDINARY caption on the board was cut
	// to about half the words that fit it, `curveWithGap` opened a hole twice the width the words
	// needed, and `captionPx` -- the size `_paintCaptionZoom` asks about -- said the board was
	// showing writing twice as big as it is.
	//
	// STILL READ OFF A LAID-OUT CAPTION rather than written down here: `_paintCaptionZoom` wants
	// what the sheet actually painted, and the accessibility skin has a say in that. What the walk
	// looks for is one the sheet alone decided -- the board's ORDINARY size, which is what a
	// judgement about the board as a whole has to be left to, rather than whatever one line the
	// reader happened to set large or small.
	//
	// It stops at the first plain caption, which on a real board is the first one it looks at:
	// the property is absent on nearly every line. A board where the reader has sized EVERY line
	// falls back to the number the stylesheet would have used (`RELMAP_CAPTION_PX`, which is the
	// `var()` fallback in the rule itself), because there is no plain caption left to ask.
	let plain = null;
	let any = null;
	for (const found of parts.values()) {
		const words = found?.words;
		const doc = words?.ownerDocument;
		if (!doc?.defaultView?.getComputedStyle || !doc.createElement) continue;
		any ??= words;
		if (!captionResized(words)) { plain = words; break; }
	}
	const words = plain ?? any;
	if (!words) return null;
	const doc = words.ownerDocument;
	const ctx = measuringContext(doc);
	if (!ctx) return null;
	const style = doc.defaultView.getComputedStyle(words);
	// ⚠ COPIED OUT AS PLAIN STRINGS, not read off the live declaration later. `measure` below is
	// kept on `_drawn` for the rest of the paint and probed a dozen times per caption; each read
	// of a `CSSStyleDeclaration` is a question to the layout engine, asked here in among the
	// writes `_fitGapsToPaint` is making to the same document, which is what turns a measure
	// into a forced reflow. Holding the declaration also held the caption, its board and its
	// document alive behind the closure for a paint at a time.
	const { fontStyle, fontWeight, fontSize, fontFamily } = style;
	// The size the captions came out at, which is what tells a board zoomed this far out that its
	// type has gone under the legibility floor. Read here rather than written down twice: the
	// stylesheet owns the number and this is already the one place that asks it -- except where
	// the caption in hand is a resized one, which by then is the only caption there is.
	const read = Number.parseFloat(fontSize);
	const px = plain && read > 0 ? read : RELMAP_CAPTION_PX;
	// BUILT FROM `px` AND NOT FROM `fontSize`, so the face this board is checked for and the size
	// everything is measured at are the same one answer.
	const font = `${fontStyle} ${fontWeight} ${px}px ${fontFamily}`;
	ctx.font = font;
	// The font string goes back with it so the caller can ask whether that face has actually
	// ARRIVED. See `_fitGapsToPaint`: the answer is nearly always yes and the one time it is
	// not, every caption on the board is measured in the wrong face.
	return {
		font,
		px,
		// ⚠ MEASURED AT THE SIZE THE CAPTION IS ACTUALLY SET IN, which is why this takes a size
		// at all. The context above is set to the face and the BOARD'S size; a line the reader
		// has made half again as big has words half again as wide, and a sentence cut and a
		// stroke broken against the wrong number is a caption floating in a hole that does not
		// fit it -- the very failure `paintedPx` exists to have fixed.
		//
		// THE FONT STRING IS ONLY REBUILT WHEN THE SIZE CHANGES. `fitCaption` probes a dozen
		// times per caption, and assigning `ctx.font` re-parses the shorthand on each; a board
		// of a hundred ordinary captions never leaves the size it starts at.
		measure: (text, size = 0) => {
			const want = Number(size) > 0 ? Number(size) : px;
			const wanted = want > 0 && want !== px
				? `${fontStyle} ${fontWeight} ${want}px ${fontFamily}`
				: font;
			if (ctx.font !== wanted) ctx.font = wanted;
			return ctx.measureText(typeof text === "string" ? text : "").width;
		},
	};
}

/**
 * One caption's own measurer: the pass's, bound to the size that line is set in.
 *
 * `fitCaption` takes a function of the words alone, and every caller of it has one line in hand --
 * so the size is bound here rather than threaded through the cutting.
 */
function measureAt(measure, px) {
	return text => measure(text, px);
}

/**
 * The words that fit one caption, and what they measure.
 *
 * CUT HERE AND NOT BY THE STYLESHEET, because there is no `text-overflow` for text on a path: a
 * glyph past the end of its rail is not drawn, and a caption left uncut would lose its last words
 * silently, with no ellipsis to say that it had. The whole sentence stays in the tooltip.
 *
 * By halving rather than by walking back a character at a time: a sentence cut to a short line can
 * be a hundred characters over, and every probe is free — the measurer is a canvas.
 */
function fitCaption(text, roomPx, measure) {
	const said = typeof text === "string" ? text : "";
	const full = measure(said);
	// ⚠ NO ROOM IS NOT NO LIMIT, and reading it as one is how the words used to end up on
	// somebody's face. `captionRoomPx` answers ZERO for a line whose two portraits stand close
	// enough together that nothing can sit between them and still keep its clearance, and a zero
	// taken for "nobody said" put the whole sentence back across both of them. Only a room that is
	// no number at all means as much as it likes; a zero cuts the caption back to its ellipsis,
	// which is still a mark saying there is something written here to open.
	const room = Number.isFinite(Number(roomPx)) ? Math.max(0, Number(roomPx)) : Infinity;
	if (full <= room) return { text: said, width: full };
	const cutAt = n => `${said.slice(0, n).trimEnd()}${ELLIPSIS}`;
	let lo = 0;
	let hi = said.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (measure(cutAt(mid)) <= room) lo = mid;
		else hi = mid - 1;
	}
	const cut = cutAt(lo);
	return { text: cut, width: measure(cut) };
}

/**
 * Where one caption's words sit, in the caption layer's own space.
 *
 * That layer's viewBox is the board's pixels at 1:1, and an anchor is in the percentages everything
 * on the board is placed in — of the WIDTH across and of the HEIGHT down, which are not the same
 * number on a sheet wider than it is tall.
 */
function captionSpot(anchor, board) {
	return {
		x: Math.round(((anchor.left ?? 0) * (board?.width ?? 0)) / 100),
		y: Math.round(((anchor.top ?? 0) * (board?.height ?? 0)) / 100),
	};
}

/**
 * Put one caption where its line has moved to.
 *
 * TWO WRITES AND NO MEASUREMENT. The words are centred on the anchor (`text-anchor: middle`,
 * `dominant-baseline: central`) and turned to the line's angle THERE, so placing a caption is a
 * point and a turn — the same two numbers the arrowheads ride on, and the same two the chips this
 * replaced rode on.
 *
 * ⚠ STRAIGHT AND NOT ON THE CURVE, and that is a measured decision rather than a simpler one. Text
 * set on a path is warped glyph by glyph, which gives every glyph its own transform and misses the
 * browser's glyph cache every time; with the halo stroked around each warped outline as well, one
 * tile of this board cost 73ms to raster and panning it was a slideshow. Straight, the same words
 * with the same halo cost 1.2ms — sixty times less. Most lines are near enough straight across the
 * stretch one caption covers that the two are hard to tell apart; a strongly bowed line now carries
 * its caption as a chord rather than an arc. See tests/dialogs for the numbers.
 */
function placeCaption({ words }, anchor, board) {
	if (!words?.setAttribute || !anchor) return;
	const { x, y } = captionSpot(anchor, board);
	words.setAttribute("x", x);
	words.setAttribute("y", y);
	words.setAttribute("transform", `rotate(${anchor.angle ?? 0} ${x} ${y})`);
}

const showPart = el => { if (el) el.style.display = ""; };
const hidePart = el => { if (el) el.style.display = "none"; };

/**
 * Move one link's stroke, its label and its heads onto a curve just recomputed.
 *
 * A link whose two portraits have come to sit on top of each other has no curve at all, and is
 * HIDDEN rather than left drawn: that is what a repaint does with it, and a stroke frozen at its
 * last good position while the portraits pile up on it is worse than no stroke. It comes back the
 * moment the drag pulls them apart, without a repaint.
 */
function redrawEdge(parts, { curve, d, anchor, heads: arrows }, board) {
	const { line, hit, label, heads } = parts;
	if (!curve) {
		hidePart(line);
		hidePart(hit);
		hidePart(label);
		for (const head of Object.values(heads)) hidePart(head);
		return;
	}
	if (line) {
		showPart(line);
		// The BROKEN path, not the whole curve: `edgeShapes` has already cut the caption's gap out
		// of it, and writing the whole one here would heal every line under the pointer.
		line.setAttribute("d", d ?? curve.d);
	}
	if (hit) {
		showPart(hit);
		// THE WHOLE CURVE here, and the one place in this function the two differ on purpose: the
		// target is not painted, so it has no gap to keep, and giving it one would put a dead patch
		// in the middle of exactly the stretch a reader aims at.
		hit.setAttribute("d", curve.d);
	}
	if (label && anchor) {
		showPart(label);
		// Written every frame for the same reason the broken `d` above is: the caption sits in the
		// hole cut for it, and a caption left at the last frame's anchor is a caption beside its
		// own line.
		//
		// THE WORDS THEMSELVES ARE LEFT ALONE for the length of the gesture. Re-cutting a sentence
		// to a shortening line means measuring it, and measuring it sixty times a second is the
		// forced layout this whole path exists to avoid. The drop repaints and puts it right.
		placeCaption(parts, anchor, board);
	}
	// Hidden first and then shown, so a head the new geometry has no place for cannot be left
	// behind pointing at nothing. One frame either way: nothing is painted in between.
	for (const head of Object.values(heads)) hidePart(head);
	for (const arrow of arrows) {
		const head = heads[arrow.end];
		if (!head) continue;
		showPart(head);
		placeOnLine(head, arrow);
	}
}

/**
 * Open (or re-focus) one map's window.
 *
 * PER DOCUMENT, via `perDocumentOptions`. AppV1 resolves an Application's element by its id, so two
 * windows sharing one id both resolve to the FIRST one's frame: the second paints into the first's
 * window and the first's handlers are left bound to nodes nothing will re-render. Several named
 * maps is exactly the case that hits this.
 *
 * `where` is the geometry a restored window comes back at, forwarded by the bouncer sheet from
 * utils/window-restore.js. Nothing else passes it: a map opened from the sidebar, a macro or the GM
 * toolkit takes the opening size defaultOptions works out. Only finite numbers are honoured, so a
 * partial snapshot (an auto-height window stores no height) falls back per key rather than pinning
 * the window at NaN.
 */
export function openRelationshipMap(entry, where = {}) {
	if (!entry) return null;
	const geometry = {};
	for (const key of ["left", "top", "width", "height"]) {
		if (Number.isFinite(where?.[key])) geometry[key] = where[key];
	}
	// WHICH BOARD TO COME UP ON, where the caller knows. Three of them do: a window restored across
	// a reload (utils/window-restore.js saved the page it was left on), a click on one of the map's
	// pages in the Journal sidebar, which is core's own `pageId` option, and a second call while
	// the window is already open. Everything else — the hotbar macro, the GM toolkit, a fresh click
	// on the sidebar row — says nothing and gets the first page.
	const pageId = typeof where?.pageId === "string" ? where.pageId : null;
	// ONE FIXED TITLE, THE SAME OVER EVERY MAP AND EVERY BOARD. The bar used to read the entry's
	// name, which on the map most tables keep is the name of the steading: a window titled
	// "Stonetop", saying nothing about what is in it. What this window IS does not change with the
	// map it holds, and it must not change with whichever of that map's boards is up either, so the
	// title says what it is and the strip an inch below it says which board is showing.
	const options = StonetopDialog.perDocumentOptions("stonetop-relmap", entry.id, {
		title: localize("stonetop.relmap.windowTitle"),
		...geometry,
		...(pageId ? { pageId } : {}),
	});
	const app = openOrFocus(options.id, () => {
		const made = new RelationshipMapWindow(entry, options);
		made.render(true);
		return made;
	});
	// ⚠ AND ON AN ALREADY-OPEN WINDOW THE OPTIONS ARE NOT ENOUGH. `openOrFocus` brings the existing
	// board to the top and hands it back unchanged — it never reaches the constructor — so a reader
	// clicking a second page of a map they already have open would be brought to the front of the
	// page they were already on, which looks exactly like the click doing nothing.
	if (pageId) app?.showPage?.(pageId);
	return app;
}
