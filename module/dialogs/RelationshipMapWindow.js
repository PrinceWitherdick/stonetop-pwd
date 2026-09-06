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
	RELMAP_BOARD_ASPECT, RELMAP_BOARD_WIDTH, ROUTE_HEAD_PATH, ROUTE_HEAD_VIEWBOX, boardMetrics,
	captionRoomPx, captionSize, clampPct, clearanceBow, curveWithGap, edgeArrowheads, edgeBow,
	edgeCurve, edgeLabelAnchor, freeSpot, graphCapPx, spreadLabels,
} from "../utils/relmap-geometry.js";
import {
	RELMAP_SHAPE_CLUSTERS, RELMAP_SHAPE_RING, layoutGraph, normalizeShape,
} from "../utils/relmap-layout.js";
import {
	RELMAP_DASHES, RELMAP_DASH_DOTTED, RELMAP_DIRS, RELMAP_FLAG, RELMAP_INKS, RELMAP_LABEL_MAX,
	addEdgePatch,
	addNodePatch, dropEdgePatch, dropNodePatch, edgePatch, fanIndexes, isImportedEdge, nodeIdentity,
	nodePatch, takenSpots, tidyPatch,
} from "../relmap/relmap-store.js";
import {
	describeWrite, forgetHistory, historyFor, stepPatch,
} from "../relmap/relmap-history.js";
import { RelmapTieBar, TIE_DIR_ICONS } from "../utils/relmap-tie-bar.js";
import { unmarkedKin } from "../utils/relmap-kin.js";
import { familyPlan } from "../utils/relmap-tree.js";
import {
	RELMAP_VIEWS, RELMAP_VIEW_EVERYONE, RELMAP_VIEW_FAMILY, RELMAP_VIEW_FOCUS, RELMAP_VIEW_PARTY,
	defaultCentre, focusPlan, normalizeView, partyPlan, reseat, seatsItself, subgraph,
} from "../utils/relmap-views.js";
import { hasOwnRingArt, partyCharacters } from "../utils/playbook-actors.js";
import {
	applyPatch, canEditRelationshipMap, createMapPage, deleteMapPage, ensureFirstMapPage, getMapPage,
	listMapPages, mapBoardDoc, mapBoardRole, mapPageName, readGraph, renameMapPage,
	syncPartyPage, syncVillagePage,
} from "../relmap/relmap-doc.js";
import { steadingListActors } from "../actors/steading/steading-people.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { introRegards } from "../relmap/relmap-intros.js";
import {
	applyIntroPicks, applyPicksToFlagList, hasIntroAnswers, introAnswerRows, picksByWriter,
} from "../relmap/relmap-intro-match.js";
import { openIntroMatch } from "./IntroMatchDialog.js";
import { getObjectSetting, setWorldSetting } from "../settings.js";
import { playbookSlug } from "../utils/playbook-slug.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { openLinkEditor, pickPersonToAdd, pickPersonToLink } from "./RelationshipLinkDialog.js";
import { pickContentOption, promptForText } from "./content-picker.js";

// Plain literals, not built from SYSTEM_ID: tests/templates/partial-registration.test.js proves
// every precached template is actually reached by finding its PATH in the JS, and an interpolated
// one is a path that appears nowhere in the source for it to find.
const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/relationship-map.hbs";
const BOARD_PARTIAL = "systems/stonetop-pwd/templates/dialogs/partials/relationship-map-board.hbs";

/** How long a burst of remote writes is allowed to coalesce before the board repaints. */
const SYNC_DEBOUNCE_MS = 50;

/**
 * The smallest a caption may be PAINTED before the board stops drawing captions at all.
 *
 * A legibility floor first — eight pixels of type is not writing, it is texture — and the map's
 * performance rule second, because the two turn out to be the same line. See `_paintCaptionZoom`.
 * Generous rather than tight: there is a reader at this table on a screen magnifier.
 */
const CAPTION_FLOOR_PX = 8;

/** What a caption is assumed to be set in before anything has measured one. Matches the sheet. */
const CAPTION_FALLBACK_PX = 12;

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
 * Which children of the viewport a press must NOT start a pan from.
 *
 * ⚠ THIS LIST IS THE WHOLE OF WHAT MAKES A CONTROL CLICKABLE IN HERE. A press the surface does not
 * recognise takes a pointer capture, and that capture retargets the later click at the viewport, so
 * the delegated handler never sees it and the control is dead on a dead-centre click that never
 * moved a pixel (utils/zoom-pan-surface.js explains it at length). Anything clickable added inside
 * the viewport has to be named here — including `[data-relmap-action]`, which is in the viewport
 * because the panels that cover the board carry buttons: "Add someone" on an empty map, "Find
 * family ties" on a tree with nothing marked, "Show everyone" on a narrow view that turns out to be
 * showing nobody. Those are the presses somebody meeting a map that looks broken reaches for, so
 * they are the last ones that may quietly do nothing.
 */
const BOARD_CONTROLS =
	"[data-relmap-node], [data-relmap-handle], [data-relmap-edge], [data-relmap-hit], "
	+ "[data-relmap-open], [data-relmap-action], .stonetop-relmap-tiebar";

/**
 * How much of the board's prose is showing.
 *
 * A READER'S SETTING AND NOT THE MAP'S, which is why it lives on the window beside `_lit`
 * rather than in the document. Two people at the same table want different things from the same
 * board at the same moment: the GM reading out what everybody thinks of the new arrival wants
 * every caption, and the player trying to find one face in forty wants none of them. A shape is
 * something the board IS and is stored; this is something one person is doing with it.
 *
 * `hover` shows the captions on the person under the pointer, and only those. It is what makes a
 * board too dense to caption still answer the question anyone actually has of it, which is what
 * one person's web looks like.
 */
const LABEL_MODES = Object.freeze(["all", "hover", "off"]);
const LABEL_MODE_DEFAULT = "all";

/**
 * Which question this reader is asking of the map. Four of them, and the names live one module down
 * in utils/relmap-views.js beside the seating each one derives.
 *
 * `everyone` is the board itself: the web the table has arranged, every line on it, everybody where
 * somebody put them. The other three are NARROWER QUESTIONS asked of the same data, and that is the
 * point of them rather than a side effect — a board with forty people and two hundred lines is not
 * badly laid out, it is being asked to say too much at once, and no layout wins that back.
 * `party` is the introductions read back: only the player characters, and only the lines between
 * two of them. `focus` is one person and everybody with a line straight to them. `family` is the
 * same map read as generations, drawn from the ties marked on the lines and from nothing else.
 *
 * ALL FOUR ARE THE READER'S OWN, and never stored, exactly like `_labels` beside it. Two people at
 * one table want different things from one map in the same moment: the GM tracing who is descended
 * from the old miller, and the player checking what the rest of the party made of them. And the
 * three narrow ones write NOTHING, which is the other half of why they can be views at all rather
 * than more shapes for Tidy up: the arrangement the table has built up over a season is still
 * there, untouched, the moment they switch back.
 */

/**
 * WHAT EACH BUTTON ON THE BAR DOES, AND WHETHER IT IS AN EDIT.
 *
 * A TABLE RATHER THAN A CHAIN, because the permission gate used to be POSITIONAL: a tool was gated
 * by being written below `if (!this.canEdit) return;` and ungated by being written above it, and
 * nothing at the moment a tool was added said which side it belonged on. A tool put on the wrong
 * side is silently gated or silently ungated, and no reader of the code -- and no test -- can tell
 * a button placed there on purpose from one placed there by accident.
 *
 * THREE OF THEM ARE NOT EDITS and now say so outright. None touches the document: they change how
 * much of the writing shows, whether the lines an old import left behind are put away for a moment,
 * and which view is up. All three belong to the reader rather than to the map, and the person most
 * in need of turning a hundred lines down is exactly the player who may only read it.
 *
 * NEITHER CHOOSER IS HERE: both are a `<select>` with its own `change` handler, because one-of-N is
 * a radio group's question and not N buttons' (see `activateListeners`). Which view is up is one of
 * those, and so is whose web the focus view is about — that one used to be a button here, opening a
 * modal list, and it is a dropdown on the bar now: switching from one person to the next is the
 * whole of what that view is for, and a window to open and dismiss between each of them is a window
 * between the reader and the comparison they are making. `showall` is here because it is genuinely
 * a button — the one offered on the panel a narrow view puts up when it turns out to be showing
 * nobody, and the way back out of it.
 */
const TOOLS = Object.freeze({
	labels: { needsEdit: false, run: (app, button) => app._cycleLabels(button) },
	hidepulled: { needsEdit: false, run: (app, button) => app._togglePulled(button) },
	showall: { needsEdit: false, run: app => app._setView(RELMAP_VIEW_EVERYONE) },
	findkin: { needsEdit: true, run: app => app._findKin() },
	// ⚠ NO "BRING THE PARTY IN" AND NO "BRING THE VILLAGE IN". Both boards still fill themselves on
	// open; what is gone is the pair of buttons that asked for the same pass out loud. They were two
	// controls for something the map already has two plainer answers to -- drag somebody on, or press
	// "Add someone" -- and a bar of tools is worth more when every button on it does something the
	// others do not. The seating passes that remain (`_syncPartyPage`, `_syncVillagePage`) are
	// therefore automatic ONLY, which is why the primary-GM guard on them is now unconditional.
	// ⚠ AN EDIT TWICE OVER, and neither of them is the map. It writes the recorded introduction
	// answers (a world setting) and the player characters' own flags, and only then tops the board
	// up. It is in this table because it is a button on this bar; the guard that matters to it is
	// GM-only, and that one is on the button itself. See `_matchIntros`.
	matchintros: { needsEdit: true, run: app => app._matchIntros() },
	// TAKING A CHANGE BACK, AND PUTTING IT FORWARD AGAIN. Behind the editing gate, obviously, and
	// deliberately NOT behind the "does this view seat its own portraits" gate the board tools are:
	// the tools beside them act on the arrangement a computed view is not showing, but these two
	// reverse whatever the reader last did on this board, wherever they did it, and they say out
	// loud what they took back. See `_stepHistory`.
	undo: { needsEdit: true, run: app => app._stepHistory("back") },
	redo: { needsEdit: true, run: app => app._stepHistory("forward") },
	add: { needsEdit: true, run: app => app._addPerson() },
	tidy: { needsEdit: true, run: app => app._tidy() },
	// THE LAST TRACE OF A BUTTON THAT IS GONE. "Pull in ratings" wrote a line into the shared board
	// for every rating anybody in the world had stored, both ways round; what it is replaced by is
	// the party view, which derives the same information on the reader's own machine and stores
	// nothing. This is the way OUT of what the old button left behind: it appears only on a board
	// that still carries some, and disappears for good once they are gone.
	droppulled: { needsEdit: true, run: app => app._dropImported() },
	// THE PAGE STRIP'S THREE, and all three are edits — they make, rename and destroy a document.
	// They are in this table rather than beside the strip's own click handler for the reason the
	// table exists at all: a tool gated by where it happens to be written is a tool nobody can tell
	// was gated on purpose. Switching between pages is NOT here, because it is not a tool and not an
	// edit: it is the strip's own value, and a reader who may only look still gets to look at every
	// page (see `showPage`).
	pagenew: { needsEdit: true, run: app => app._addPage() },
	pagerename: { needsEdit: true, run: app => app._renamePage() },
	pagedelete: { needsEdit: true, run: app => app._removePage() },
});

/**
 * THE TWO BUTTONS A PANEL OVER THE BOARD CAN OFFER, each written once.
 *
 * A table for the same reason `TOOLS` above is one: these were five separate object literals across
 * two methods, three of them the same button spelled three times, and a set of identical literals
 * is a set that stops being identical the day one of them is changed. Functions rather than frozen
 * objects because a label has to be localized at CALL time -- `game.i18n` does not exist when this
 * module is evaluated.
 *
 * The tree's "Find family ties" is genuinely one of a kind (it is the only one that WRITES, so it
 * is the only one behind a permission gate) and stays where it is used.
 */
const PANEL_BUTTONS = Object.freeze({
	showall: () => ({ action: "showall", label: localize("stonetop.relmap.showAll"), icon: "fa-users" }),
	add: () => ({ action: "add", label: localize("stonetop.relmap.add"), icon: "fa-user-plus" }),
});

/**
 * THE FIVE WAYS A VIEW COMES OUT EMPTY, and what the panel over the board says about each.
 *
 * A TABLE RATHER THAN A CHAIN, for the reason `TOOLS` above gives: five `if (plan.bare === "x")`
 * blocks of one shape is five chances for a row to quietly lack the read-only wording or the way
 * out, and no way to see at a glance which ones do.
 *
 * `readonlyHintKey` is the wording for a reader who cannot make the edit the ordinary hint tells
 * them to make -- telling somebody to go and do a thing the map will not let them do is worse than
 * telling them nothing. Its ABSENCE is meaningful and not an oversight: `gone` and `nobody` are the
 * focus view with no centre, whose remedy is the chooser on the bar, which anybody may use.
 *
 * `action` defaults to "back to the whole board", which is what four of the five want and which
 * anybody may do. Only the tree offers something else, and only to an editor, because it writes.
 */
const BARE_PANELS = Object.freeze({
	family: {
		leadKey: "stonetop.relmap.familyNone",
		hintKey: "stonetop.relmap.familyNoneHint",
		readonlyHintKey: "stonetop.relmap.familyNoneHintReadonly",
		action: app => (app.canEdit
			? { action: "findkin", label: localize("stonetop.relmap.findKin"), icon: "fa-wand-magic-sparkles" }
			: null),
	},
	party: {
		leadKey: "stonetop.relmap.partyNone",
		hintKey: "stonetop.relmap.partyNoneHint",
		readonlyHintKey: "stonetop.relmap.partyNoneHintReadonly",
	},
	focus: {
		lead: (app, plan) => format("stonetop.relmap.focusNone", { name: app._nameOf(plan.all, plan.centre) }),
		hintKey: "stonetop.relmap.focusNoneHint",
		readonlyHintKey: "stonetop.relmap.focusNoneHintReadonly",
	},
	gone: {
		leadKey: "stonetop.relmap.focusGone",
		hintKey: "stonetop.relmap.focusGoneHint",
	},
	nobody: {
		leadKey: "stonetop.relmap.focusUnset",
		hintKey: "stonetop.relmap.focusUnsetHint",
	},
});

/**
 * ONE ROW OF THE PERSON CHOOSER, and one group of them.
 *
 * MARKUP BUILT HERE RATHER THAN IN THE TEMPLATE, which is the one thing about this that wants
 * saying. The list is written twice over — the render puts it in, and a repaint writes it again
 * when the cast has changed under the reader — and the second writer can only reach the DOM, never
 * Handlebars. Spelt in both places it is two spellings of one list, and the day the two disagree
 * the map still looks right until somebody else adds a person. So the window builds the rows, the
 * template drops them in whole (as it already does with the board), and `_paintFocusPick` writes
 * exactly the same string.
 *
 * ⚠ WHICH MEANS THE ESCAPING IS OURS. Every label here is a name off an actor sheet, i.e. text
 * somebody at this table typed, and it is going into markup rather than through Handlebars.
 */
function personOption(id, label, chosen) {
	const esc = foundry.utils.escapeHTML;
	return `<option value="${esc(id)}"${chosen ? " selected" : ""}>${esc(label)}</option>`;
}

function personGroup(label, rows) {
	return `<optgroup label="${foundry.utils.escapeHTML(label)}">${rows.join("")}</optgroup>`;
}

export class RelationshipMapWindow extends StonetopDialog {
	constructor(entry, options = {}) {
		super(options);
		this._entry = entry;
		this._entryId = entry?.id ?? null;
		// WHICH BOARD OF THIS MAP IS UP. The reader's own, like the view and the captions beside
		// it: two people at one table can and should be looking at different pages of the same map
		// at the same moment, so this is never written to the document. Null means "whichever page
		// comes first", which is what a map opened from the sidebar wants; the sidebar's own page
		// rows, and a window restored across a reload, both arrive carrying one.
		this._pageId = options.pageId ?? null;
		// Set once the first render has made sure this map HAS a page. See `_ensurePage`.
		this._pagesReady = false;
		// The strip as it was last written, so a repaint can tell a set of pages that has changed
		// from one that has not and leave the reader's focus alone when it has not. Exactly the
		// bookkeeping `_pickSaid` does for the person chooser, for exactly the same reason.
		this._pagesSaid = null;
		this._surface = null;
		this._teardownDrag = null;
		this._onUpdate = null;
		// How much prose is showing. The reader's own, per open window: see LABEL_MODES.
		this._labels = LABEL_MODE_DEFAULT;
		// Which question this reader is asking of the map. Theirs alone too: see RELMAP_VIEW_EVERYONE.
		this._view = RELMAP_VIEW_EVERYONE;
		// Whose web the focus view is about, or null before they have said. ON THE WINDOW and never
		// on the document, like every other thing on this list: a per-reader choice written to a
		// shared JournalEntry would be one reader deciding what everybody else's board is about.
		// It is re-checked against the map on every pass, because the person it names can be taken
		// off the board by somebody at the far end of the table while this window is open.
		this._focus = null;
		// Whether the lines a past import left on this board are put away for the moment. The reader's
		// own, and off to begin with: see `_togglePulled`.
		this._hidePulled = false;
		// Whose web is lit up right now, or null. Held so that a repaint arriving while the
		// pointer rests on a portrait can put the highlight back where it was.
		this._lit = null;
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
		// What the next render is to announce once its live region is on screen; see `_setView`.
		this._sayOnRender = null;
		// Which control that same render is to put the reader's focus back onto, as a selector; see
		// `_takeFocusBack`. Null on an ordinary render, which must never move anybody's focus.
		this._focusOnRender = null;
		// The plan `getData` built for the render now in flight, for the listeners wired onto it a
		// moment later. Lives for one render and is taken, never kept: see `_takePlan`.
		this._renderPlan = null;
		// Why this view was last showing nobody, or null. Held only so that a panel APPEARING can be
		// said out loud once rather than on every repaint after it; see `_paintChrome`.
		this._saidBare = null;
		// The rows now standing in the person chooser, as the markup they were written from. Held
		// so that a repaint can tell a cast that has changed from one that has not, and leave the
		// control alone when it has not; see `_paintFocusPick`.
		this._pickSaid = null;
		// Where an arrow-key nudge has put a portrait that is not written yet, and the debounced
		// write that will. Held on the instance so `nodeAt` can answer from it: the next key must
		// step on from where the portrait IS, not from the stale spot still in the document.
		this._pendingNudge = null;
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

	/** Every named board this map has, in strip order. Asked afresh, never held: somebody at the
	 * far end of the table adds and renames these while this window is open. */
	get mapPages() {
		return listMapPages(this.entry);
	}

	/** The page this reader is on, or the first one. Null only on a map still carrying its board on
	 * the entry, which `boardDoc` below is what answers for.
	 *
	 * ONE WALK OF THE STRIP, the same economy `mapBoardDoc` keeps: asking `getMapPage` and then
	 * falling back to `this.mapPages` filtered and sorted the same pages twice per call, and this is
	 * a getter the render pass reaches several times over. */
	get mapPage() {
		const pages = this.mapPages;
		return pages.find(page => page.id === this._pageId) ?? pages[0] ?? null;
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

	// ASKED, NEVER HELD, and asked afresh by everything below including the drag layer's
	// per-gesture questions: permission can change under an open window.
	get canEdit() {
		return canEditRelationshipMap(this.entry);
	}

	async getData() {
		const plan = this._plan();
		// HANDED FORWARD to the listeners this render is about to wire, which want the sheet out of
		// it and would otherwise rebuild the whole thing to get two numbers. See `_takePlan`.
		this._renderPlan = plan;
		// THE CHROME IS DERIVED ONCE AND SPREAD, rather than spread straight into the return: the
		// person chooser's rows have to be REMEMBERED as well as rendered, so that a repaint can
		// tell a cast that has changed from one that has not. See `_paintFocusPick`.
		// ⚠ THE BOARD TOOLS' SHARED GATE, ASKED ONCE. Every tool on the bar that writes is off on a
		// view that seats its own portraits -- what it added would not be drawn there, so the press
		// would look like it had failed -- and off for a reader who may not write. Spelled into each
		// gate separately, this was three copies of one rule, and a fourth tool added without it is
		// a button whose effect is invisible from where the reader is standing.
		const tools = this.canEdit && !plan.seated;
		// ⚠ THE STRIP AND THE BOARD ON IT, RESOLVED ONCE FOR THE WHOLE PASS. Every one of the eight
		// answers below used to reach `this.mapPages` or `this.mapPage` on its own, and each of those
		// filters the entry's whole page collection and sorts it again. Read here, they are also
		// guaranteed to agree with each other — a page deleted at the far end of the table halfway
		// down this function cannot leave the strip saying one thing and the panel another.
		const pages = this.mapPages;
		const page = this.mapPage;
		// WHICH KIND OF BOARD THIS IS, resolved once. Three gates below ask it.
		const role = this._boardRole(page);
		const chrome = this._chrome(plan);
		this._pickSaid = chrome.focusPick;
		// ⚠ PINNED TO A CONCRETE PAGE, on every render, and this is load-bearing rather than tidy.
		// Null means "whichever board comes first", which is what a map opened from the sidebar
		// starts as — and left null, the delete hook cannot tell "the page this reader was standing
		// on has just been rubbed out" from "some other page has", because by the time it is asked
		// the page is gone and `mapPage` has already fallen through to another one. The reader would
		// be left looking at a board that no longer exists, with every write vanishing. Resolved
		// through `mapPage`, so it also heals an id that has gone stale.
		this._pageId = page?.id ?? null;
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
			pageNewLabel: localize("stonetop.relmap.pages.new"),
			pageNewHint: localize("stonetop.relmap.pages.newHint"),
			pageRenameLabel: localize("stonetop.relmap.pages.rename"),
			pageRenameHint: localize("stonetop.relmap.pages.renameHint"),
			pageDeleteLabel: localize("stonetop.relmap.pages.delete"),
			pageDeleteHint: localize("stonetop.relmap.pages.deleteHint"),
			// ⚠ THE LAST BOARD MAY NOT BE RUBBED OUT, and the button is absent rather than disabled
			// on a one-page map. A map with no pages is one whose next opener silently gives it a
			// fresh empty board, so the delete would read as the map emptying itself.
			canDropPage: this.canEdit && pages.length > 1,
			// WHICH QUESTION IS BEING ASKED, as a list of four rows for the chooser. A `<select>`
			// and not four pressed buttons: one-of-four is a radio group's question, and the group
			// buys one tab stop, arrow keys between the views, and a spoken name for the whole
			// control — where four toggles announce as four unrelated pressed/unpressed buttons
			// with no group and no "2 of 4". It also fits, which four labelled buttons do not:
			// ~150px against 350-450, on a bar measured already over the edge at 1366px wide. The
			// bar wraps now too, but wrapping keeps an over-long row reachable; it is not a reason
			// to build one.
			views: RELMAP_VIEWS.map(view => ({
				id: view,
				label: localize(`stonetop.relmap.view.${view}`),
				chosen: view === this._view,
			})),
			viewLabel: localize("stonetop.relmap.viewLabel"),
			viewHint: localize("stonetop.relmap.viewHint"),
			// The board's own tools act on an arrangement the narrow views do not show — laying it
			// out again, adding somebody they would not draw, pulling in lines they would not
			// display — so they are off while one is up rather than merely disabled. A button whose
			// effect is invisible from where the reader is standing is worse than one that is not
			// there. Asked AFFIRMATIVELY of the plan and never as "am I not the tree?": that
			// spelling is what silently handed the first two extra views every permission the board
			// has.
			showBoardTools: tools,
			showFindKin: this.canEdit && plan.view === RELMAP_VIEW_FAMILY,
			// ⚠ THE SAME BOARD, AND A GM ON TOP OF IT, because what this writes is a world setting
			// and core refuses a player that outright rather than quietly no-opping. And only where
			// there is something to match: on a world that never ran its introductions it would be a
			// button that opens an empty window. `hasIntroAnswers` is the cheap half of the read for
			// exactly that reason -- this is asked on every repaint, where the full read (every
			// answer scanned for every name at the table) would not be welcome.
			showMatchIntros: tools && role === "party" && !!game.user?.isGM
				&& hasIntroAnswers(this._partyReaders(), getObjectSetting("introductionsAnswers")),
			matchIntrosLabel: localize("stonetop.relmap.match.button"),
			matchIntrosHint: localize("stonetop.relmap.match.buttonHint"),
			// Does this view draw captioned lines at all? The captions cycle is offered exactly
			// when it does. Affirmative, and off the plan, so the two narrow views — which DO carry
			// captions — keep the one control that rescues a dense board.
			captions: plan.captions,
			// THE ONE CONTROL THE FOCUS VIEW NEEDS OF ITS OWN: whose web it is showing. A second
			// `<select>` beside the first, so the bar reads as one sentence — "Showing one person's
			// web of Ordga" — and moving from one person to the next is a single gesture on a
			// control that is already under the reader's hand. Its ROWS come off the chrome below,
			// because they go out of date under an open window; only its wrapper is settled here,
			// since which view is up cannot change without a render.
			showFocusPick: plan.view === RELMAP_VIEW_FOCUS,
			focusOf: localize("stonetop.relmap.focusOf"),
			focusAria: localize("stonetop.relmap.focusAria"),
			focusHint: localize("stonetop.relmap.focusHint"),
			findKinLabel: localize("stonetop.relmap.findKin"),
			findKinHint: localize("stonetop.relmap.findKinHint"),
			board: await this._renderBoard(plan),
			addLabel: localize("stonetop.relmap.add"),
			addHint: localize("stonetop.relmap.addHint"),
			tidyLabel: localize("stonetop.relmap.tidy"),
			tidyHint: localize("stonetop.relmap.tidyHint"),
			labelsHint: localize("stonetop.relmap.labelsHint"),
			// ⚠ THE VISIBLE NAMES ONLY. What each of these two can actually do, and what it would
			// take back, is written onto the elements by `_paintHistory` — the history is this
			// reader's own and is not part of the document a render was built from. They come up
			// disabled and saying so, which is the truth for a bar that has just appeared.
			undoLabel: localize("stonetop.relmap.history.undo"),
			redoLabel: localize("stonetop.relmap.history.redo"),
			undoNothing: localize("stonetop.relmap.history.backNothing"),
			redoNothing: localize("stonetop.relmap.history.forwardNothing"),
			// ⚠ THE TIE BAR'S SHELL, AND ONLY ITS SHELL. Everything about it that depends on WHICH
			// line is open -- which swatch is pressed, what the two arrow buttons are called, which
			// way they point -- is written by `RelmapTieBar` when it opens, because a render knows
			// nothing about a line the reader has not clicked yet. What is settled here is the part
			// that never changes: the eight colours, the two kinds of stroke, and the field.
			maxLength: RELMAP_LABEL_MAX,
			labelField: localize("stonetop.relmap.labelField"),
			inkLabel: localize("stonetop.relmap.inkField"),
			dirLabel: localize("stonetop.relmap.dirField"),
			dashLabel: localize("stonetop.relmap.dashField"),
			inks: RELMAP_INKS.map(key => ({ key, name: localize(`stonetop.relmap.inks.${key}`) })),
			// From `RELMAP_DIRS` and not four buttons written out by hand, which is what the ink and
			// dash groups beside it already do: a direction the store knows and the template does not
			// is a stored answer with no button, and `markChosen` carries a defensive branch for
			// exactly that drift. The two one-way icons are rewritten on open from where the faces
			// actually sit -- see `_nameDirs` -- so these are only what they are BUILT with.
			dirs: RELMAP_DIRS.map(key => ({
				key, icon: TIE_DIR_ICONS[key], name: localize(`stonetop.relmap.dirs.${key}`),
			})),
			// No icon: each of these buttons DRAWS the line it means, from the stylesheet. See the
			// template, and `--st-relmap-dotted` for the pattern the dotted one is drawn with.
			dashes: RELMAP_DASHES.map(key => ({
				key, name: localize(`stonetop.relmap.dashes.${key}`),
			})),
			tie: {
				label: localize("stonetop.relmap.tie.label"),
				placeholder: localize("stonetop.relmap.tie.placeholder"),
				more: localize("stonetop.relmap.tie.more"),
			},
			dropPulledLabel: localize("stonetop.relmap.dropPulled"),
			dropPulledHint: localize("stonetop.relmap.dropPulledHint"),
			pulledLabel: localize("stonetop.relmap.hidePulled"),
			pulledHint: localize("stonetop.relmap.hidePulledHint"),
			// EVERY PANEL THAT CAN GO OUT OF DATE UNDER AN OPEN WINDOW, from the one derivation
			// `_paintChrome` writes back after a repaint. See `_chrome`.
			...chrome,
		};
	}

	/**
	 * EVERYTHING ONE PASS OVER THIS MAP HAS TO AGREE ABOUT, worked out once.
	 *
	 * WHAT IT IS FOR IS THE AGREEMENT, not the arithmetic. A render and a repaint each used to ask
	 * the same three questions three and four times over -- which lines this reader is looking at,
	 * what chart they make, how big a sheet that wants -- and every one of those askings was free
	 * to phrase "am I a tree?" in slightly different words. Two of them already had: the two
	 * spellings of "the tree has nobody on it" disagreed about which graph to count.
	 *
	 * IT IS ALSO NOT FREE. `familyPlan` relaxes a column per generation and settles every row, and
	 * the family view was building one four times per render and three times per repaint -- on a
	 * repaint that arrives every time anybody at the table touches the map.
	 *
	 * STILL WORKED OUT FRESH each pass, never held on the window. The graph and the view both
	 * change under an open board, and a cached plan is a chart drawn from a map that has moved on,
	 * which looks exactly like the layout being broken.
	 *
	 * ⚠ `plan.graph` IS THE BOARD IN FRONT OF THE READER, not the map. Every narrow view hands back
	 * its own subgraph with the computed seats WRITTEN INTO the nodes, so that everything downstream
	 * -- the fan indexes, the caption cap, `edgeShapes`' clearance dodges, the spreader's obstacle
	 * list, the cast the partial walks -- measures what is actually drawn without being told a view
	 * is on. Carrying seats beside the full graph instead would draw every line between the
	 * positions people hold on the REAL board while their faces stood somewhere else, and pruning
	 * the people without their lines is a TypeError inside `getData` (`edgeShapes` reads an end's
	 * `x` with no guard) and a window that renders blank. utils/relmap-views.js says all this at
	 * length; it is repeated here because this is the function that has to keep it true.
	 *
	 * THE THREE FLAGS ARE NAMED, and that is deliberate. This used to hand back one `tree` object
	 * that thirteen downstream branches read as "computed seats" AND "draws no web" AND "no board
	 * tools" at once, and there was no way to say "computed seats, ordinary lines" -- which is
	 * exactly what the two narrow views are. `seated`, `chart` and `captions` are asked by name.
	 */
	_plan(graph = null) {
		const whole = graph ?? readGraph(this.boardDoc);
		// LESS WHATEVER THIS READER HAS PUT AWAY, before a single number is worked out: a line the
		// stylesheet merely stopped drawing would still be routed around, still fan its pair apart,
		// and still count towards the room this board promises its captions.
		const visible = this._visibleGraph(whole);
		const view = normalizeView(this._view);
		// Whether this MAP has anybody on it, as opposed to whether this VIEW is showing anybody.
		// The two panels answer to different questions and must not both claim the same blank board.
		const peopleOnMap = !!Object.keys(visible.nodes).length;
		const base = {
			// WHICH VIEW THIS PASS IS, normalized, so that nothing downstream re-derives it. The
			// flags below are the questions worth asking by name; this is here for the handful of
			// controls that genuinely belong to ONE view (the tree's "find family ties", the focus
			// view's own picker) and would otherwise each re-normalize `this._view` and compare it
			// themselves -- which is a fifth view inheriting its answers by accident.
			view,
			whole,
			// THE WHOLE VISIBLE CAST, kept beside the narrowed one. `empty` has to keep meaning
			// "this map has nobody on it": counted off the subgraph instead, a party view of a
			// forty-person map with no player characters would greet the reader with "Nobody is on
			// this map yet. Drag a character in from the sidebar" -- a flat lie, in a view that
			// refuses drops.
			all: visible,
			// Does this view place its own portraits? The one question behind whether a drag, an
			// arrow-key nudge, a Delete, a sidebar drop or a board tool makes any sense here.
			seated: seatsItself(view),
			// The households' strokes, on the tree alone.
			chart: null,
			// Does this view draw ordinary bowed, captioned lines? Everything but the tree does,
			// and the captions control is offered exactly when this is true.
			captions: view !== RELMAP_VIEW_FAMILY,
			// Whose web the focus view settled on, once it has been checked against the map.
			centre: null,
			// What the corner aside says about who is not being shown, or "".
			said: "",
			// Why this view is showing nobody, as a key, or null when it is showing somebody.
			bare: null,
		};

		if (view === RELMAP_VIEW_PARTY) {
			const plan = partyPlan(visible, this._isParty());
			return {
				...base,
				graph: plan.graph,
				board: plan.board,
				// NOT SAID TWICE. The corner footnote is for a reader looking at a picture that is
				// missing people; when the view is showing nobody at all the panel is up and says
				// so at length, and a second sentence in the corner counting the same absence is
				// noise over the one message that matters.
				said: plan.people.length && plan.omitted
					? format("stonetop.relmap.partyOmitted", { count: plan.omitted })
					: "",
				// ⚠ NOT ON A MAP WITH NOBODY ON IT. There the EMPTY panel is the right one — "nobody
				// is on this map yet" is the news, not "nobody here is a player character" — and
				// two panels claiming the same blank board would leave whichever the stylesheet
				// happened to paint last. The family branch already guarded this; these did not.
				//
				// AND NOT WHEN THE RING IS DRAWN WITH NO LINES ON IT. That view is showing somebody
				// — the party, which is what it promised — so the panel would be a flat lie over a
				// picture the reader can see people in. The aside above says what is missing.
				bare: peopleOnMap && !plan.people.length ? "party" : null,
			};
		}

		if (view === RELMAP_VIEW_FOCUS) {
			// RE-CHECKED AGAINST THE MAP EVERY PASS, never trusted from the last one. The person
			// this view is about can be taken off the board by anybody who may edit it, and this
			// runs inside the repaint that carries them away. `focusPlan` answers null, and the
			// window puts up a panel that says so rather than quietly re-centring on a stranger.
			const plan = focusPlan(visible, this._focus);
			// TWO WAYS TO HAVE NO CENTRE and they are not the same news. "Nobody is chosen yet" is
			// the state a reader arrives in; "the person you were looking at has been taken off the
			// map" is something that HAPPENED, to them, while they watched — and telling them the
			// first when the second is true reads as the window having forgotten what they asked.
			const gone = !plan.centre && !!this._focus && peopleOnMap;
			return {
				...base,
				graph: plan.graph,
				board: plan.board,
				centre: plan.centre,
				said: plan.centre && plan.rim.length && plan.omitted
					? format("stonetop.relmap.focusOmitted", {
						count: plan.omitted, name: this._nameOf(visible, plan.centre),
					})
					: "",
				bare: !peopleOnMap ? null
					: plan.centre ? (plan.rim.length ? null : "focus") : (gone ? "gone" : "nobody"),
			};
		}

		if (view === RELMAP_VIEW_FAMILY) {
			const tree = familyPlan(visible);
			return {
				...base,
				// THE SAME CONTRACT AS THE OTHER TWO: the people it keeps, at the seats it worked
				// out, and NO LINES AT ALL -- a descent is drawn as the household's own square
				// stroke, and drawing the same tie again as a bowed line between two faces would
				// put a curve across the chart saying what the chart already says. Dropping the
				// edges here rather than with a ternary further down is what makes that true by
				// construction instead of by remembering.
				graph: reseat(subgraph(visible, new Set(tree.people), () => false), tree.seats),
				chart: tree.paths,
				// The tree sizes its own sheet, because six people in six generations want a tall
				// board and four cousins in one row want a wide one, and neither is what "six
				// people" asks for.
				board: tree.board,
				said: tree.people.length && tree.omitted
					? format("stonetop.relmap.familyOmitted", { count: tree.omitted })
					: "",
				bare: peopleOnMap && !tree.people.length ? "family" : null,
			};
		}

		return {
			...base,
			graph: visible,
			// THE SHEET GROWS WITH THE CAST, so a portrait's radius is not a constant: it is
			// smaller, as a share of the board, on a board carrying more people.
			board: boardMetrics(Object.keys(visible.nodes).length),
		};
	}

	/**
	 * Who counts as a player character, as the question `partyPlan` wants it.
	 *
	 * THROUGH THE SYSTEM'S OWN READER, `partyCharacters()`, and not a fresh scan of `game.actors`.
	 * That function already decides what the party is for every sheet in this system (the
	 * player-owned characters where there are any, all of them otherwise, which is what a GM
	 * prepping before ownership is assigned actually wants), and a second opinion here is how the
	 * map comes to disagree with the sheets — the same rule `_regardOf` below follows, and it must,
	 * because the two together decide who gets a face on the party ring and who gets lines drawn to it.
	 *
	 * MATCHED ON THE NODE'S STORED UUID, so somebody who is on the map as a plain named circle — a
	 * settlement, a person nobody has made a sheet for — is not the party, which is right.
	 */
	_isParty() {
		const party = new Set((partyCharacters() ?? []).map(actor => actor.uuid));
		return node => !!node?.uuid && party.has(node.uuid);
	}

	/**
	 * Everybody on this map as rows for a chooser: by name, in name order.
	 *
	 * ONE BUILDER FOR BOTH QUESTIONS this window asks of a person -- "draw a line to whom" and
	 * "whose web should this show". They are the same act to a reader, and built separately they
	 * had already come apart: one listed the STORED name in whatever order the flag came back in,
	 * the other the live actor's name sorted. Somebody renamed on their sheet appeared under two
	 * different names in two lists on the same board, and the unsorted one was in an order nothing
	 * could predict, which on a map of forty people is a list you have to read all of.
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
	 * re-ran the visible-graph filter, the view normalization and the whole branch chain -- and on
	 * the family view would have settled a tree -- to reach a one-line measurement. Both callers are
	 * an ADD (the button and a sidebar drop), and both are refused outright on any view that seats
	 * itself, so the sheet they want is always the one the whole cast is measured for.
	 */
	_boardSize(graph = null) {
		return boardMetrics(Object.keys((graph ?? readGraph(this.boardDoc))?.nodes ?? {}).length);
	}

	/**
	 * The plan THIS render was drawn from, handed forward to the listeners being wired onto it.
	 *
	 * WHY IT IS WORTH KEEPING. `_plan` is not free — the family view relaxes a column per generation
	 * and settles every row — and its own doc-block records that building one four times per render
	 * was a cost that had to be paid down. `activateListeners` needs two numbers out of the sheet
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
	 * The map as this reader has asked to see it: the whole of it, or the whole of it less the
	 * lines a past "Pull in ratings" wrote into it.
	 *
	 * ⚠ RENDERING ONLY. Everything that WRITES reads the stored board itself (`readGraph` off
	 * `boardDoc`), and has to keep doing so: `dropNodePatch` takes a person off the board along
	 * with every link that touched them, and handed a filtered graph it would leave the hidden ones
	 * behind, dangling from a portrait that is gone. Hiding is something one reader is doing to
	 * their own view for a minute; it must never reach anybody's data.
	 *
	 * THE PEOPLE ARE UNTOUCHED, deliberately. Somebody who is on this map only because an import
	 * put them there is still on it, and a portrait that vanished when the box was ticked would
	 * look like the map losing people rather than like lines being put away.
	 */
	_visibleGraph(graph) {
		if (!this._hidePulled) return graph;
		const edges = Object.fromEntries(
			Object.entries(graph?.edges ?? {}).filter(([, edge]) => !isImportedEdge(edge)),
		);
		return { ...graph, edges };
	}

	/**
	 * Was anything on this map written into it by the "Pull in ratings" button that used to exist?
	 *
	 * TWO CONTROLS HANG OFF THIS, and both are offered exactly when it is true: the checkbox that
	 * puts those lines away for one reader, and the tool that rubs them out for everybody.
	 *
	 * Asked of the WHOLE graph and never of `_visibleGraph`, or ticking the box would take away
	 * the box: the last hidden line disappears from the graph the question was asked of, the answer
	 * turns false, and both controls — including the only one that could bring them back — go with
	 * it. The tool beside it would go the same way, on a board that still has every one of them.
	 */
	_hasPulledLinks(graph) {
		return Object.values(graph?.edges ?? {}).some(isImportedEdge);
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
	 * caption cap, the clearance dodges and the spreader's obstacle list all have to agree about
	 * which board they are on, and a ternary per question is four chances for one of them to be
	 * looking at a different one.
	 */
	_boardContext({ graph, chart, seated, centre, board }) {
		const r = board.r;
		const fans = fanIndexes(graph);
		const canEdit = this.canEdit;
		// The width a caption is PROMISED on a board this crowded, worked out once from how many it
		// carries. What a caption actually gets is its own line's length or this, whichever is
		// bigger (`captionRoomPx`), and that per-line answer is what both the spreader and the
		// stylesheet work from — one number for the two of them, or the spreader clears overlaps
		// that are not there.
		const labelMax = graphCapPx(graph);

		// WHO IS ON THE BOARD, and where. A narrow view has already dropped everybody it is not
		// showing and moved the rest to its own seats, so this is simply the graph's own people at
		// the graph's own coordinates. They are filtered out of the RENDER rather than hidden by
		// the stylesheet because a portrait nobody can see is still something the lines have to be
		// routed round and the geometry has to measure; and they are all still on the map, coming
		// back the moment the reader switches views.
		const nodes = Object.entries(graph.nodes).map(([id, node]) => {
			// The live actor wins where it resolves; the stored name and picture are the fallback
			// that keeps somebody on the map after their actor is deleted or moved out of reach.
			// Through `_personOnMap` and not spelled again here: that function's own doc-block
			// records what the split cost last time, which was one person under two different names
			// in two lists on the same board.
			const { name, actor } = this._personOnMap(graph, id);
			const portrait = portraitOrNone(actor?.img ?? node.img, documentPortraitFrame(actor));
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
				// The one person the focus view is about, marked so the stylesheet can say which
				// face the ring is around. Nothing else reads it; the lines already say it, and
				// this is for the reader who has to find the middle of a picture at four times
				// magnification.
				centre: id === centre,
				// A person whose actor has gone. Drawn differently rather than dropped: the links
				// they are part of are still somebody's notes about the story.
				missing: !!node.uuid && !actor,
				// ⚠ AND IT MUST NOT PROMISE THE DRAG unless there is one. This is both the tooltip
				// and the accessible name of the face, so on a view that places its own portraits
				// "drag to move them" is an instruction the board refuses — read out to the one
				// reader who cannot see that nothing moved when they tried.
				tooltip: node.uuid && actor
					? format(seated ? "stonetop.relmap.openSheetFixed" : "stonetop.relmap.openSheet", { name })
					: name,
				linkLabel: format("stonetop.relmap.linkFrom", { name }),
			};
		});

		const edges = [];
		const labels = [];
		const heads = [];
		// NO TERNARY: the tree's plan hands back a graph with no edges on it at all, so this walk is
		// empty there by construction rather than by remembering to skip it. (Why the tree draws no
		// web: a descent is the household's own square stroke, and drawing the same tie a second
		// time as a bowed line between two faces would put a curve across the chart saying what the
		// chart already says.)
		const shapes = edgeShapes(graph, {
			r, fans, spread: true, capPx: labelMax, boardWidthPx: board.width,
		});
		// HELD BACK for the second pass over this same markup. `_fitGapsToPaint` needs the curve, the
		// anchor and the sheet these were worked out on, and re-deriving them from the document would
		// be a second answer to a question that already has one.
		this._drawn = {
			boardWidthPx: board.width,
			capPx: labelMax,
			shapes: new Map(shapes.map(shape => [shape.id, shape])),
			painted: null,
			// ⚠ THE GRAPH THESE SHAPES WERE DRAWN FROM, kept beside them so that anything asking
			// about a line the reader can SEE has one answer rather than two. Three of the four
			// views hand back a subgraph with computed seats written into it (`_plan`), so a second
			// reader that went to the document instead would get a line's stored coordinates while
			// the geometry beside it holds the seat this view gave it -- which is how the tie bar
			// would come to float over an empty patch of paper on every view but one.
			//
			// AND IT SAVES A SECOND PLAN PER REPAINT. `_plan` relaxes a column per generation on
			// the family view and is not cheap; the repaint has already paid for one.
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
				id, a: edge.a, b: edge.b, d: shape.d, ink: edge.ink,
				// Whether the reader broke this stroke themselves. A class and not a dash pattern
				// written out here, for the reason the ink is a class: what a mark RESOLVES to is
				// the stylesheet's business and has to stay retunable under the accessibility skin.
				dotted: edge.dash === RELMAP_DASH_DOTTED,
				// THE WHOLE CURVE, not the broken one the stroke is painted along. What this feeds
				// is the invisible target laid over the line, and cutting the caption's gap out of
				// THAT would leave a dead patch in the middle of every captioned line -- which is
				// the exact spot a reader aims at.
				hit: shape.curve?.d ?? "",
			});
			// The id and the end ride on every head, because the live drag finds these elements
			// again by them: a link may wear two, and each has to go back to its own end.
			for (const head of shape.heads) heads.push({ ...head, id, ink: edge.ink });
			if (anchor) {
				const spot = captionSpot(anchor, board);
				labels.push({
					id, a: edge.a, b: edge.b, text: edge.label,
					// WHERE THE WORDS SIT AND HOW FAR THEY ARE TURNED OVER, in ABSOLUTE board
					// pixels — the only space type can be set in without shearing it, and the space
					// the caption layer's viewBox is in.
					x: spot.x, y: spot.y, angle: anchor.angle,
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
			// ⚠ NO NEW LINE FROM ANY VIEW THAT SEATS ITSELF, and there are three reasons rather
			// than one, all of which have to be fixed together before this could be relaxed. The
			// rubber band a drag draws starts at the person's STORED position (`nodeAt` answers
			// from the document), so on a computed board it springs out of an empty patch of paper
			// somewhere else entirely. The "draw a line to whom" picker offers everybody on the
			// map, including the people this view is not showing. And a line the view has no way of
			// drawing — one between two of the focus ring, say — would be written, saved, and then
			// simply not appear, which reads as the save having failed. Everything else an editor
			// can do still works: a caption on any of these views still opens its own line.
			canLink: canEdit && !seated,
			// Each household as one stroke, with everybody it joins named on it so that resting on
			// any one of them can light the whole thing. A string and not the array, because an
			// array rendered into an attribute comes out comma-separated and the reader of it
			// (`_lightPerson`) splits on spaces.
			tree: (chart ?? []).map(path => ({
				d: path.d, couple: path.couple, who: path.people.join(" "),
			})),
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
			// Every pan and every zoom step, because whether the writing is big enough to be worth
			// drawing at all is a question about the scale. See `_paintCaptionZoom`.
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
			onField: (id, fields) => this._write(edgePatch(id, fields), {
				label: localize("stonetop.relmap.history.editedLink"), coalesce: `edge:${id}`,
			}),
			onMore: id => this._editLink(id),
			// THE BOARD'S MARKUP IS THE WINDOW'S, and this is the fourth mark a repaint has to put
			// back, beside the lit web, the caption mode and the history buttons.
			onPicked: id => this._paintPickedLine(id),
			canEdit: () => this.canEdit,
		});

		this._teardownDrag = wireRelmapDrag(root, {
			surface: this._surface,
			canEdit: () => this.canEdit,
			// A NARROW VIEW PLACES ITS OWN PORTRAITS, so on one there is nowhere for a drag to be
			// remembered: a dropped face would spring back to the seat the view gives it on the
			// next repaint, which reads as a broken board rather than as a computed one. Asked per
			// gesture, like `canEdit`, because the reader can switch views under an open board.
			//
			// ⚠ ASKED AFFIRMATIVELY, and this is the whole reason `_placesOwnSeats` exists as a
			// named question rather than a comparison written out here. This was `_view !==
			// RELMAP_VIEW_FAMILY` — a DENYLIST — and so were the two drop gates and the board tools, which
			// meant every view added after the tree inherited "yes" from all four without anybody
			// deciding: portraits draggable on a computed board, each drag silently writing the
			// shared document while the reader watches nothing move.
			canMove: () => this.canEdit && !this._placesOwnSeats(),
			// AND NEITHER MAY IT DELETE. The one writing gesture the keyboard still offers on a
			// computed board would otherwise be the destructive one: Tab to a face, press Delete,
			// and that person and every line touching them — including the ones this view is not
			// drawing — come off the shared map. These are the views a reader tabs around in,
			// because they hold six faces instead of forty. The board you can rearrange is the
			// board you can remove from.
			canRemove: () => this.canEdit && !this._placesOwnSeats(),
			nodeAt: id => {
				// An unwritten nudge is where the portrait actually is, so it answers first.
				if (this._pendingNudge?.id === id) return { ...this._pendingNudge.at };
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
			// A LINE TAKEN HOLD OF, which is the bar and no longer the dialog. What the dialog
			// still asks -- the family tie, the notes -- is a button further on, on the bar itself.
			onPickEdge: (id, from) => this._tieBar?.open(id, { returnTo: from ?? null }),
			// AND LET GO AGAIN, by a click that landed on bare paper. The board is the surface a
			// reader clicks around on while talking, so letting go has to be as easy as taking
			// hold: an X on the bar would be the only way out of a thing that opens on a click.
			onPickNone: () => this._tieBar?.close(),
			onRemove: id => this._removePerson(id),
		});

		// The drag layer owns the board; these are the window's own chrome.
		root.querySelectorAll("[data-relmap-action]").forEach(button => {
			button.addEventListener("click", ev => this._onToolClick(ev));
		});

		// WHICH QUESTION IS BEING ASKED. Its own handler and not a `data-relmap-action`, because it
		// is a `<select>`: the thing a reader changes is its VALUE, and a click on it means "open
		// the list", not "do something". See `getData` for why one-of-four is a select here rather
		// than four pressed buttons.
		root.querySelector("[data-relmap-view]")
			?.addEventListener("change", ev => this._setView(ev.target.value));

		// WHOSE WEB IS BEING SHOWN, the same way and for the same reason. Only on the bar while the
		// focus view is up, so this finds nothing on the other three.
		root.querySelector("[data-relmap-focus]")
			?.addEventListener("change", ev => this._setFocus(ev.target.value));

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
		// This render's markup knows nothing of either setting: both live on the window, and both
		// have to be put back onto the fresh elements or a re-render would silently turn the
		// captions back on and drop the highlight the pointer is still resting on.
		this._paintLabelMode();
		// The same reason: what this reader can take back lives on their own machine, not in the
		// markup a render was built from, and a fresh bar comes up with both buttons enabled until
		// it is told otherwise.
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
		if (this._onUpdate) return;
		const repaint = foundry.utils.debounce(() => this.sync(), SYNC_DEBOUNCE_MS);
		this._onUpdate = (doc, changed) => {
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
		};
		Hooks.on("updateJournalEntry", this._onUpdate);

		// ⚠ AND THE MAP CAN BE DELETED OUT FROM UNDER THIS WINDOW. Nothing else would notice: this
		// is a StonetopDialog rather than a DocumentSheet (journal/RelationshipMapEntrySheet.js
		// explains why), so it is not in `entry.apps` and core's own sweep on delete never reaches
		// it — and the `entry` getter deliberately falls back to the document it was handed, which
		// after a delete is a stale in-memory copy still carrying its last flags and still
		// answering `isOwner`. The board would go on looking live, with every tool enabled, writing
		// into a document that is not there.
		this._onDelete = doc => {
			if (doc?.id === this._entryId) this.close();
		};
		Hooks.on("deleteJournalEntry", this._onDelete);

		// ── And the same three questions again, one document down ────────────────────────────
		//
		// The graph lives on a PAGE now, so the writes this window makes all its evening arrive on
		// this hook rather than the one above. The entry's own hook is still wired, and still earns
		// it: ownership, and a map still on version 1 whose board is on the entry itself.
		//
		// FILTERED BY THE PARENT FIRST, because every page write in the world arrives here — a GM
		// typing in a lore entry at the other end of the sidebar included.
		this._onPageUpdate = (page, changed) => {
			if (page?.parent?.id !== this._entryId) return;
			// A NAME OR AN ORDER IS THE STRIP'S BUSINESS, whichever page it happened to. Somebody
			// renaming the board this reader is NOT on still changes what the strip says.
			if ("name" in (changed ?? {}) || "sort" in (changed ?? {})) this._paintPages();
			// A graph is only this window's business when it is the graph being LOOKED AT. Two
			// people at one table working on two pages of the same map must not repaint each other;
			// that is the whole reason a board is its own document rather than another object
			// inside one shared flag.
			if (page.id !== this.mapPage?.id) return;
			const bag = changed?.flags?.[SYSTEM_ID];
			if (!bag) return;
			if (Object.keys(bag).some(key => key.replace(/^-=/, "") === RELMAP_FLAG)) repaint();
		};
		Hooks.on("updateJournalEntryPage", this._onPageUpdate);

		// A BOARD ARRIVING OR LEAVING IS A STRIP THAT HAS CHANGED, and one of the two is more than
		// that: the page this reader is standing on can be rubbed out from another client, and a
		// window left pointing at a deleted document would go on looking live while every write it
		// made vanished. `mapPage` falls through to the first surviving page, so what this needs is
		// a full render — the board, its shape and the whole bar all belong to a different page now.
		this._onPageChange = (page, gone) => {
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
				// belonged to the one that is gone.
				this._pageId = null;
				this._focus = null;
				this._lit = null;
				this.render();
				return;
			}
			this._paintPages();
		};
		this._onPageCreate = page => this._onPageChange(page, false);
		this._onPageDelete = page => this._onPageChange(page, true);
		Hooks.on("createJournalEntryPage", this._onPageCreate);
		Hooks.on("deleteJournalEntryPage", this._onPageDelete);
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
	 * change is simply lost until somebody makes another. This mattered the day switching views
	 * became a render: before that, this window only re-rendered when Foundry made it.
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
		// AND SO IS THE MARK ON THE LINE THE READER IS HOLDING, for the same reason and with one
		// more: the bar itself survives (it is outside the board), so without this it would go on
		// floating over a picture with nothing on it saying which line it belongs to. `refresh`
		// also lets go of a line somebody else has just rubbed out. It deliberately does NOT
		// refill the caption field -- see its own note.
		this._tieBar?.refresh();
		this._paintChrome(plan);
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
		const measurer = captionMeasurer(parts);
		if (!measurer) return;
		const { font, px, measure } = measurer;
		// What the captions are actually set in, for the zoom at which they stop being worth
		// drawing. Kept with the rest of what this pass measured, and re-asked here rather than
		// once at open: a reader who changes the interface font size changes this too.
		if (px) drawn.captionPx = px;
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
			const said = fitCaption(shape.edge.label, shape.labelMax, measure);
			if (found.words.textContent !== said.text) found.words.textContent = said.text;
			painted.set(id, said.width);
			// NOTHING TO RE-PLACE. The words are centred on the anchor and turned to the line's
			// angle there, and neither of those moves when the sentence is cut shorter — which is
			// one thing the straight setting buys outright. What the measurement is still for is
			// the hole in the stroke below.
			const size = captionSize(shape.edge.label, shape.curve, {
				boardWidthPx: drawn.boardWidthPx, capPx: drawn.capPx, paintedPx: said.width,
			});
			shape.d = curveWithGap(shape.curve, {
				t: shape.anchor.t, span: size.w, boardWidthPx: drawn.boardWidthPx,
			});
			found.line?.setAttribute("d", shape.d);
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
	 * The window's chrome outside the board: what each panel says, and whether it shows at all.
	 *
	 * ONE DERIVATION, TWO WRITERS OF IT. `getData` spreads this into the first render's markup and
	 * `_paintChrome` writes the same answers onto the elements afterwards, because a repaint
	 * replaces the board and nothing else -- the chrome has to stay put while the board is panned
	 * and zoomed underneath it. Derived separately in the two places, as it was, the two spellings
	 * of "the tree has nobody on it" had already come apart, and the wrong one would have been
	 * right until the moment somebody else touched the map.
	 *
	 * ALL OF IT CAN CHANGE UNDER AN OPEN WINDOW, which is why none of it is left to the render that
	 * first drew it: somebody at the far end of the table marking a line as a family tie turns a
	 * bare chart into a populated one, and somebody else rubbing out the last of the lines an old
	 * import left behind is the moment this reader stops having anything to hide.
	 */
	_chrome(plan) {
		// ⚠ COUNTED OFF THE WHOLE VISIBLE CAST, never off what the view is showing. "Nobody is on
		// this map yet. Drag a character in from the sidebar" is a statement about the MAP, and a
		// party view of a forty-person board with no player characters on it would otherwise greet
		// its reader with that sentence — untrue, and in a view that refuses drops. What a narrow
		// view showing nobody says is the `bare` panel's business, below.
		const nobody = !Object.keys(plan.all.nodes).length;
		return {
			empty: nobody,
			// ⚠ THE HEADLINE IS DERIVED HERE TOO, though it never changes, because `_paintChrome`
			// WRITES every part of the panel it repaints. Left in `getData` alone, as it was, this
			// came back `undefined` on every repaint and the writer blanked the sentence outright:
			// the empty board would appear carrying only its hint and its button until the next full
			// render. Nothing in a panel may be settled in one of the two writers only.
			emptyLead: localize("stonetop.relmap.emptyLead"),
			// ⚠ WHAT THE EMPTY BOARD SAYS AND OFFERS DEPENDS ON WHICH VIEW IT IS EMPTY IN, and it
			// lives HERE rather than in `getData` so a repaint can write it. "Drag a character in
			// from the sidebar, or use Add someone" is true of the whole board and of nothing else:
			// a view that seats itself refuses drops outright and has no Add someone on its bar, so
			// there that sentence names two routes that are both closed and offers a button whose
			// result the view would not draw. What it offers there is the way back.
			//
			// The way back is NOT behind the permission gate — getting to the whole board is not an
			// edit, and a reader who may only look is the one most likely to have arrived here
			// without knowing which view they are in.
			emptyHint: localize(
				plan.seated ? "stonetop.relmap.emptyHintNarrow"
					: this.canEdit ? "stonetop.relmap.emptyHint"
						: "stonetop.relmap.emptyHintReadonly",
			),
			emptyAction: plan.seated ? PANEL_BUTTONS.showall()
				: this.canEdit ? PANEL_BUTTONS.add() : null,
			// THIS VIEW HAS NOBODY IN IT, though the map does. Three situations rather than one and
			// each gets its own words and its own way out: no family tie marked anywhere, nobody on
			// the map is a player character, nothing is linked to the person in the middle. All
			// three are the picture the reader sees when a view looks broken and is not, so all
			// three have to be said in words rather than left as a blank sheet.
			noKin: !nobody && !!plan.bare,
			...this._bareSaid(plan),
			omittedSaid: plan.said,
			// OFFERED ONLY WHERE THERE IS SOMETHING TO PUT AWAY, which is what both the checkbox and
			// the "Rub out pulled-in lines" tool are gated on. Nothing creates such a line any more, so
			// on nearly every board this is false for good and neither control is ever seen; on the
			// boards that button was pressed on, they are the two ways out and they go together.
			hasPulled: this._hasPulledLinks(plan.whole),
			hidePulled: this._hidePulled,
			labelMode: this._labels,
			labelsLabel: localize(`stonetop.relmap.labels.${this._labels}`),
			labelsAria: labelsAria(this._labels),
			// WHOSE WEB THE FOCUS VIEW CAN BE POINTED AT, as the rows of its chooser. Chrome rather
			// than render context because the cast is exactly the thing somebody at the far end of
			// the table changes while this reader is looking at it.
			focusPick: this._focusOptions(plan),
		};
	}

	/**
	 * The rows of the person chooser: everybody on this map, with the one it is showing picked.
	 *
	 * THE PLAYER CHARACTERS FIRST, IN THEIR OWN GROUP, because "whose web am I looking at" is
	 * nearly always asked of one of them — this control exists so that a table can walk round the
	 * party one player at a time — and on a village of forty a list in flat name order buries the
	 * six faces it is usually about. Grouped only when there is something to group: a map that is
	 * all player characters, or has none on it, gets one plain list rather than a heading over the
	 * whole of itself. `_isParty` decides, so this agrees with the party view standing next to it.
	 *
	 * BUILT FROM THE MAP'S OWN PEOPLE and never from `game.actors`. A settlement, or anybody put on
	 * the board as a plain named circle, has no actor behind them and would be unreachable from a
	 * list of actors — and the steading everybody is linked to is one of the most useful centres a
	 * map has. It is also the only way the list can be exactly what the reader can see.
	 *
	 * THE READER'S OWN PERSON SAYS SO, and only they ever do: `_myNode` answers with the reader's
	 * character IF it is on this map, which for the GM — whose assigned character in this system is
	 * their GM Toolkit actor — is nobody at all. Marking the row the view happens to have OPENED on
	 * would be marking a stranger as somebody's own.
	 *
	 * ⚠ AND IT CARRIES A ROW FOR NOBODY when there is no centre, which is not decoration. A
	 * `<select>` whose value matches none of its options shows its FIRST option instead, so a
	 * chooser with the centre gone would silently name somebody the board is not showing, beside a
	 * panel explaining that the person it was showing has left the map.
	 */
	_focusOptions(plan) {
		if (plan.view !== RELMAP_VIEW_FOCUS) return null;
		const graph = plan.all;
		const mine = this._myNode(graph);
		const isParty = this._isParty();
		const row = person => personOption(
			person.id,
			person.id === mine ? format("stonetop.relmap.focusYours", { name: person.name }) : person.name,
			person.id === plan.centre,
		);
		const people = this._peopleOnMap(graph);
		const party = people.filter(person => isParty(graph.nodes[person.id]));
		const others = people.filter(person => !isParty(graph.nodes[person.id]));
		const rows = plan.centre ? [] : [personOption("", localize("stonetop.relmap.focusNoneChosen"), true)];
		if (party.length && others.length) {
			rows.push(personGroup(localize("stonetop.relmap.focusGroups.party"), party.map(row)));
			rows.push(personGroup(localize("stonetop.relmap.focusGroups.others"), others.map(row)));
		} else {
			rows.push(...people.map(row));
		}
		return rows.join("");
	}

	/**
	 * What the "this view is showing nobody" panel says, and what its one button does.
	 *
	 * A KEY RATHER THAN A BOOLEAN, because the ways a view can come out empty want their own
	 * sentences and, more to the point, their own ways out. A tree with nothing marked wants "Find
	 * family ties", which writes and so is offered to editors only. Every other one wants the same
	 * thing: back to the whole board, which anybody may do.
	 *
	 * ⚠ AND THE THREE FOCUS CASES WANT IT TOO, though they used to offer "Focus on..." instead.
	 * That button opened the modal list that has since become the chooser on the bar — which is on
	 * screen, three inches above this panel, whenever one of these is up. A panel offering a second
	 * route to a control the reader is already looking at is a panel spending its one button on
	 * nothing; the thing it can offer that the bar cannot is the way out of the view entirely.
	 *
	 * EVERY REMEDY HERE IS AN EDIT — mark a family tie, put a player character on the map, draw a
	 * line to somebody — so all three need a wording for the reader who cannot make one. Telling
	 * somebody to go and do a thing the map will not let them do is worse than telling them nothing.
	 * (This doc-block used to claim the tree was the only one; its own sibling strings said
	 * otherwise, which is how the claim was caught.)
	 */
	_bareSaid(plan) {
		const row = BARE_PANELS[plan.bare];
		if (!row) return { bareLead: "", bareHint: "", bareAction: null };
		return {
			bareLead: row.lead ? row.lead(this, plan) : localize(row.leadKey),
			// The read-only wording where there is one and the reader cannot edit. Three of the five
			// have one; `gone` and `focus`-with-nobody do not, because their remedy is to pick
			// somebody else out of the chooser on the bar, which anybody may do.
			bareHint: localize(!this.canEdit && row.readonlyHintKey ? row.readonlyHintKey : row.hintKey),
			bareAction: row.action ? row.action(this) : PANEL_BUTTONS.showall(),
		};
	}

	/**
	 * One panel over the board: its two sentences and its one button.
	 *
	 * ⚠ THE BUTTON IS THE HALF THAT IS EASY TO MISS. A panel is `inset: 0` and takes no pointer
	 * events; its button is the only thing inside it that opts back in, and so the only thing in the
	 * whole viewport a reader can tab to while it is up. It is WRITTEN rather than merely unhidden
	 * because which button it is depends on why the panel is up, and that changes without a render:
	 * ticking the hide box empties a focus ring, somebody at the far end of the table removes the
	 * last player character, an ownership change takes away the right to add anybody.
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
	 * THE PANEL'S WORDS ARE WRITTEN TOO, not just its `hidden`. They name a person and a view, and
	 * both can change without a render: the reader ticks the box that puts the pulled-in lines away
	 * and the focus ring empties, or somebody at the far end of the table removes the last player
	 * character from the board. A panel that appeared still carrying the sentence the last render
	 * happened to leave in it would be a panel telling the reader about a situation they are no
	 * longer in.
	 */
	_paintChrome(plan) {
		const root = this._root;
		if (!root) return;
		const said = this._chrome(plan);
		// BOTH PANELS THROUGH ONE WRITER. They carry the same three parts and the same rule, and
		// written twice one of them ends up learning something the other does not — which is
		// exactly what had happened: the no-kin panel's button was repainted and the empty panel's
		// was not, though the empty panel's changes with the view too.
		this._toggleEmpty(said.empty);
		this._paintPanel(root.querySelector(".stonetop-relmap-empty"), {
			lead: said.emptyLead, hint: said.emptyHint, action: said.emptyAction,
		});
		const panel = root.querySelector(".stonetop-relmap-nokin");
		if (panel) panel.hidden = !said.noKin;
		this._paintPanel(panel, { lead: said.bareLead, hint: said.bareHint, action: said.bareAction });
		// ⚠ A PANEL THAT APPEARS IS NEWS, AND NEWS IS SAID OUT LOUD. Switching view announces itself
		// because the reader asked for it; this is the other way round — the board they were reading
		// emptied under them, because somebody at the far end of the table took the last player
		// character off it or removed the person their focus view was about. A reader who cannot see
		// the panel gets no other sign that anything happened at all.
		//
		// ON THE CHANGE ONLY, never on every repaint: this runs each time anybody touches the map,
		// and a live region that repeats itself is one people learn to ignore.
		const bare = said.noKin ? plan.bare : null;
		if (bare !== this._saidBare) {
			this._saidBare = bare;
			if (bare) this._announce(said.bareLead);
		}
		const aside = root.querySelector(".stonetop-relmap-aside");
		if (aside) {
			aside.textContent = said.omittedSaid;
			aside.hidden = !said.omittedSaid;
		}
		const foot = root.querySelector(".stonetop-relmap-foot");
		if (foot) foot.hidden = !said.hasPulled;
		// THE WAY OUT OF WHAT AN OLD IMPORT LEFT BEHIND, shown only while there is something to
		// clear. It has to be repainted for the same reason the checkbox below it does, and one step
		// further on: the moment somebody at the table presses it, every other open window on this
		// board must stop offering a button whose work is already done. Absent entirely on a view
		// that hides the board tools, which is why this is asked of the element rather than of a
		// flag — `null` is the honest answer there and needs no branch.
		const drop = root.querySelector("[data-relmap-action='droppulled']");
		if (drop) drop.hidden = !said.hasPulled;
		this._paintFocusPick(said.focusPick);
	}

	/**
	 * The person chooser's rows, rewritten when the cast has changed under the reader.
	 *
	 * IT HAS TO BE REPAINTED AT ALL because this is the one control on the bar whose CONTENTS come
	 * off the shared document: somebody at the far end of the table adds a person, and until this
	 * runs the chooser cannot be pointed at them. Removal is the worse half — a row for somebody
	 * who has left the map is a row that, picked, warns and does nothing.
	 *
	 * ⚠ AND ONLY WHEN IT HAS CHANGED, which is the whole reason the last rows written are held on
	 * the window. A repaint arrives every time anybody at the table touches this map — a portrait
	 * dragged, a caption edited — and `innerHTML` on a `<select>` throws away the option elements,
	 * which shuts an open dropdown and drops the focus of a reader who has tabbed to it. Comparing
	 * the MARKUP rather than a signature of it needs nothing kept in step: the selected row is in
	 * the string too, so a centre that moved is a change and a board that merely shifted is not.
	 *
	 * The held rows are updated only once the element is actually found, so a repaint that lands
	 * between renders leaves the next one still knowing the list is stale.
	 */
	_paintFocusPick(rows) {
		if (rows === this._pickSaid) return;
		const pick = this._root?.querySelector("[data-relmap-focus]");
		if (!pick) return;
		this._pickSaid = rows;
		pick.innerHTML = rows ?? "";
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
	 * THROUGH `partyCharacters()`, the same reader `_isParty` uses, so the board and the party view
	 * cannot form two opinions about who the player characters are.
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
	 * ONE SPELLING, shared by the seeder and the matcher, and through `partyCharacters()` like the
	 * party view: three readers with three ideas of who the player characters are is three boards
	 * that disagree. The `slug` is what a stored question INDEX is an index into, so it travels
	 * with them.
	 */
	_partyReaders() {
		return (partyCharacters() ?? []).map(actor => ({
			id: actor.id, uuid: actor.uuid, name: actor.name, img: actor.img ?? "",
			slug: playbookSlug(actor),
		}));
	}

	/**
	 * Match answers recorded before the introductions started asking who they were about.
	 *
	 * WHAT IT IS FOR, in the user's own words: a popup that can "help you quickly figure out which
	 * answer belongs to which person in the case they ran introductions before we made this fix".
	 * The window reads out every answer anybody recorded, offers the name-match beside each, and
	 * writes back what the reader confirms. relmap/relmap-intro-match.js does the working out.
	 *
	 * ⚠ GM ONLY, and the button says so by not being there. `introductionsAnswers` is a WORLD
	 * setting, which core refuses a player outright rather than quietly no-opping, so a player
	 * offered this would fill the whole window in and watch it throw.
	 *
	 * ⚠ BOTH COPIES OF THE ANSWERS ARE WRITTEN: the world setting the Chronicle and the board read,
	 * and each player character's own `intro` flag that the setting is harvested FROM. Writing only
	 * the setting holds until the next time anybody opens the introductions, and is then silently
	 * overwritten by the flag it was mirrored from. See `applyPicksToFlagList`.
	 *
	 * IT TOPS THE BOARD UP ON THE WAY OUT, so the arrows appear from the same press. A tool whose
	 * whole point is the lines it makes possible, followed by a second button the reader has to
	 * know to press, is a tool that looks like it did nothing.
	 */
	async _matchIntros() {
		const pcs = this._partyReaders();
		const answers = getObjectSetting("introductionsAnswers");
		const rows = introAnswerRows(pcs, answers);
		if (!rows.length) {
			ui.notifications?.info?.(localize("stonetop.relmap.match.nothing"));
			return null;
		}
		const picks = await openIntroMatch({ rows, pcs });
		if (!picks?.length) return null;

		// ⚠ READ AGAIN ON THE WAY OUT, and applied to THAT. This window can stand open for as long
		// as it takes to read seventy answers, and the setting it writes is one blob: applying the
		// picks to the copy taken before it opened would put back whatever anybody else recorded in
		// the meantime. Each pick names the record it belongs to, so it lands the same either way.
		const { answers: next, changed } = applyIntroPicks(getObjectSetting("introductionsAnswers"), picks);
		if (!changed) return null;
		await setWorldSetting("introductionsAnswers", next);
		await this._mirrorPicksToActors(picks);
		ui.notifications?.info?.(format("stonetop.relmap.match.saved", { count: changed }));
		// The board only draws what it can read, so the answers have to land before this runs.
		return this._syncPartyPage({ asked: true });
	}

	/**
	 * Put the same picks on the player characters' own answer flags.
	 *
	 * BEST EFFORT, PER PERSON. A character this GM cannot write (it has been locked down, or has
	 * gone away since the answers were recorded) costs that one actor's mirror and nothing else:
	 * the setting is already written, so the board draws either way, and the only thing at risk is
	 * a later harvest putting that one PC's answers back as they were.
	 */
	async _mirrorPicksToActors(picks) {
		// WHICH PICKS HAVE A FLAG TO MIRROR INTO is asked of relmap-intro-match.js, which owns both
		// the step list and the "is this a legacy slot" rule. Spelled here as two literal
		// comparisons, this was a third copy of the record's shape.
		for (const [writerId, steps] of picksByWriter(picks)) {
			const actor = game.actors?.get(writerId);
			if (!actor?.isOwner) continue;
			const intro = actor.getFlag(SYSTEM_ID, "intro") ?? {};
			const patch = {};
			for (const [step, stepPicks] of steps) {
				const { list, changed } = applyPicksToFlagList(intro?.[step]?.answers ?? [], stepPicks);
				// Written WHOLE, because an array does not merge: a dotted write of one index is
				// how a list comes back with the other entries gone.
				if (changed) patch[`flags.${SYSTEM_ID}.intro.${step}.answers`] = list;
			}
			if (!Object.keys(patch).length) continue;
			try { await actor.update(patch); }
			catch (err) { console.warn("Stonetop | Relationship map: could not mirror a match onto", actor?.name, err); }
		}
	}

	/**
	 * WHICH KIND OF BOARD the reader is looking at: "party", "village", or "" for a map's own board.
	 *
	 * ONE QUESTION RATHER THAN TWO BOOLEANS. The two used to be `_onPartyPage()` and
	 * `_onVillagePage()`, asked separately by three gates that between them walked the entry's pages
	 * twice on every render; and being booleans, "which board is this" had no name, so a third
	 * self-seating board would have arrived as a third predicate rather than a third answer here.
	 *
	 * Asked of the PAGE and never of its name, for the reason `getPartyPage` gives: a board is
	 * renameable like any other, and a table that calls it "Us" must not thereby lose its tools —
	 * and asked of the page's own FLAG rather than by looking the board up on the entry, which is
	 * what `mapBoardRole` is for and why this is now one line.
	 */
	_boardRole(page = this.mapPage) {
		return mapBoardRole(page);
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
	 * Built here rather than in the template for the reason `personOption` gives at length: it is
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
	 */
	_pageTabs(pages = this.mapPages, chosen = this.mapPage?.id ?? "") {
		const esc = foundry.utils.escapeHTML;
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
	 * Write the strip again after a repaint, and only when it has actually changed.
	 *
	 * THE GUARD IS THE POINT, not an optimization. This runs on every repaint — which is every time
	 * anybody at the table moves a portrait — and rewriting the strip's markup destroys the element
	 * the reader may have their keyboard focus on, mid arrow-key walk along the tabs. Compared as
	 * the STRING it was built from, exactly as `_paintFocusPick` compares the chooser's rows.
	 */
	_paintPages() {
		const strip = this._root?.querySelector(".stonetop-relmap-pages-strip");
		if (!strip) return;
		const tabs = this._pageTabs();
		if (tabs === this._pagesSaid) return;
		this._pagesSaid = tabs;
		strip.innerHTML = tabs;
		// The board is the panel for whichever tab is now selected, and which tab that is can have
		// changed without a render: somebody else deleting the page this reader was on moves them.
		const view = this._root?.querySelector(".stonetop-relmap-view");
		if (view) view.setAttribute("aria-labelledby", this._pageTabId(this.mapPage?.id ?? ""));
		// Whether the last board can be rubbed out depends on how many there are, which is exactly
		// what has just changed.
		const drop = this._root?.querySelector("[data-relmap-action=\"pagedelete\"]");
		if (drop) drop.hidden = !(this.canEdit && this.mapPages.length > 1);
	}

	/**
	 * Show another board of this map.
	 *
	 * NOT AN EDIT, and not gated: a reader who may only look still gets to look at every page. It
	 * writes nothing at all — which page somebody is on is theirs, exactly like the view and the
	 * captions, and two people at one table reading different pages of one map is the ordinary case
	 * rather than a conflict.
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
		// ⚠ FIRST, AND BEFORE `_pageId` MOVES. A nudge still waiting on its debounce belongs to the
		// board being LEFT, and written a line later it would land on the one being arrived at —
		// moving a portrait on a page the reader never touched, by an id that very likely names
		// nobody there.
		this._writeNudge();
		this._pageId = want;
		// All three point at the board being left. The focus view's centre is not even on this
		// page in the general case, and `_lightPerson` would only have to throw the highlight away.
		this._focus = null;
		this._lit = null;
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
	 * Rub out the board that is up, after asking.
	 *
	 * ASKED WITH THE COUNT IN IT, because this is the one control in the window that destroys work
	 * nobody can get back — a page carries its whole cast and every line on it — and "delete this
	 * page?" over a board of thirty people understates what is about to happen.
	 */
	async _removePage() {
		const page = this.mapPage;
		if (!page || this.mapPages.length <= 1) return;
		const people = Object.keys(readGraph(page).nodes).length;
		const ok = await foundry.applications.api.DialogV2.wait({
			classes: themedDialogClasses(),
			window: { title: localize("stonetop.relmap.pages.deleteTitle") },
			content: `<p>${escHtml(format(
				people ? "stonetop.relmap.pages.deleteBodyPeople" : "stonetop.relmap.pages.deleteBody",
				{ name: page.name, count: people },
			))}</p>`,
			buttons: [
				{ action: "drop", label: format("stonetop.relmap.pages.deleteConfirm", { name: page.name }), default: true },
				{ action: "keep", label: localize("stonetop.relmap.pages.deleteCancel") },
			],
			rejectClose: false,
		});
		if (ok !== "drop") return;
		// ⚠ SAID BEFORE THE WRITE, and the window is NOT re-rendered here. The delete's own hook is
		// what moves this reader onto a surviving board and renders — one path, whether the page was
		// rubbed out from this window or from somebody else's — and that render throws away the live
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
		if (this._pendingNudge) return true;
		// ⚠ AND THAT IS ALL OF IT. There used to be a third obstruction here — "a field has focus" —
		// and it could never fire while collecting two exemptions that each undid a false positive
		// it had created for itself. This window carries exactly three form controls, the two
		// choosers and the hide-imported-lines box, and NONE of them holds unsaved writing; the
		// board partial carries none at all. (The person chooser is the one a repaint could
		// genuinely disturb, because its rows come off the shared document — which is why
		// `_paintFocusPick` leaves it alone unless the cast has actually changed, rather than why
		// the whole repaint should wait.) What that guard was written to protect is a half-typed
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
			r: preview.r, fans: preview.fans, only: id,
			boardWidthPx: preview.width, capPx: preview.capPx, painted: preview.painted,
		})) {
			const parts = preview.parts.get(shape.id);
			// A BOARD WITH NO CAPTIONS ON IT HAS NO HOLES IN ITS LINES, and a line being dragged has
			// to agree with the still ones it is dragged past. `_paintLineGaps` cannot do it: that
			// writes what the last repaint worked out, and this line is being recomputed.
			if (parts) {
				redrawEdge(parts, this._drawn?.healed ? { ...shape, d: shape.curve?.d } : shape, preview.board);
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
		// ONE PLAN PER GESTURE. `_plan` reads the document when it is not given a graph and builds
		// a whole family plan on the tree, and asking it once is the entire point of gathering this
		// here.
		//
		// ⚠ AND IT IS THE PLAN'S GRAPH THAT IS PREVIEWED, not the whole one. The board on screen
		// was drawn from `_visibleGraph`, so with the imported lines put away the two graphs fan
		// their pairs apart differently and promise their captions different room: a hand-drawn
		// line sharing its pair with a hidden one would slide to another fan index for the length
		// of the drag and snap back on the drop, and the caption cap would step to a different
		// tier than the one the paint used. Same graph in, same geometry out.
		const plan = this._plan(whole);
		const graph = plan.graph;
		this._preview = {
			id,
			graph,
			fans: fanIndexes(graph),
			r: plan.board.r,
			width: plan.board.width,
			// The whole sheet, because a caption is placed in the caption layer's own pixels and
			// that space is as tall as the board is, not as wide.
			board: plan.board,
			// The width the captions were PAINTED at. Recomputed from a different count, the gaps
			// cut under the drag would be a different size from the ones already on the board.
			capPx: graphCapPx(graph),
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
		this._pendingNudge = { id, at: spot };
		this._commitNudge();
	}

	/** Write the nudge the reader has stopped making, and let repaints back in. */
	_writeNudge() {
		const pending = this._pendingNudge;
		if (!pending) return;
		this._pendingNudge = null;
		this._preview = null;
		// ONE STEP FOR A RUN OF ARROW KEYS, keyed by the portrait. A reader walking somebody across
		// the board pauses several times on the way, and each pause is a write; recorded separately
		// they would be a dozen undos to put one person back where they started. A drag does NOT
		// pass this key: a drag is one gesture already, and two deliberate drags a second apart are
		// two changes.
		this._moveNode(pending.id, pending.at, { coalesce: `node:${pending.id}` });
		// A repaint that was held back while the keys were coming lands now.
		this._flushPendingSync();
	}

	/**
	 * No read first. `readGraph` normalizes every node and every edge to build a fresh object, and
	 * the only thing this wanted from it was whether the node still exists — which decides nothing:
	 * `nodePatch` clamps the coordinates itself, and a patch naming a node that has since been
	 * removed is dropped by `normalizeGraph` on the next repaint rather than resurrecting it.
	 */
	async _moveNode(id, { x, y }, { coalesce = "" } = {}) {
		await this._write(nodePatch(id, { x, y }), {
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
	 * One line as the bar needs it: what it stores, who it joins, and where to float.
	 *
	 * ⚠ ASKED OF THE BOARD IN FRONT OF THE READER, not of the document. Three of the four views
	 * seat the portraits themselves, so a line's middle on THIS screen is nowhere near where the
	 * stored coordinates put it -- and a bar placed from the document would sit over an empty patch
	 * of paper on every view but one. `_drawn` is the geometry the last paint actually used, which
	 * is the only answer that can be right on all four.
	 *
	 * NULL FOR A LINE THAT IS NOT DRAWN, which is how the bar learns to let go: somebody else
	 * rubbing it out, or the reader switching to a view that does not show it.
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
		};
	}

	/** Every label already used on this map, for the editor to suggest. */
	_labelSuggestions(graph) {
		return [...new Set(Object.values(graph.edges).map(edge => edge.label).filter(Boolean))].sort();
	}

	async _createLink(a, b) {
		if (a === b) return;
		const graph = readGraph(this.boardDoc);
		if (!graph.nodes[a] || !graph.nodes[b]) return;
		const link = await openLinkEditor({
			from: graph.nodes[a].name, to: graph.nodes[b].name,
			suggestions: this._labelSuggestions(graph),
		});
		if (!link || link.deleted) return;
		await this._write(addEdgePatch(foundry.utils.randomID(), { a, b, ...link }), {
			announce: format("stonetop.relmap.linked", {
				a: graph.nodes[a].name, b: graph.nodes[b].name,
			}),
			label: localize("stonetop.relmap.history.linked"),
		});
	}

	async _editLink(id) {
		const graph = readGraph(this.boardDoc);
		const edge = graph.edges[id];
		if (!edge) return;
		const result = await openLinkEditor({
			edge,
			from: graph.nodes[edge.a]?.name ?? "", to: graph.nodes[edge.b]?.name ?? "",
			suggestions: this._labelSuggestions(graph),
		});
		if (!result) return;
		if (result.deleted) {
			await this._write(dropEdgePatch(id), {
				announce: localize("stonetop.relmap.unlinked"),
				label: localize("stonetop.relmap.history.unlinked"),
			});
			return;
		}
		await this._write(edgePatch(id, result), {
			label: localize("stonetop.relmap.history.editedLink"),
		});
	}

	/**
	 * Take somebody off the map, with every line that touched them.
	 *
	 * Confirmed, because it is not only the portrait that goes: the links are somebody's notes
	 * about the story and there is no undo. The buttons NAME the outcome rather than answering a
	 * question the reader has to hold in their head, and the count of lines is in the question so
	 * nobody learns about them afterwards.
	 */
	async _removePerson(id) {
		const graph = readGraph(this.boardDoc);
		const node = graph.nodes[id];
		if (!node) return;
		const links = Object.values(graph.edges).filter(e => e.a === id || e.b === id).length;
		const ok = await foundry.applications.api.DialogV2.wait({
			classes: themedDialogClasses(),
			window: { title: localize("stonetop.relmap.removeTitle") },
			content: `<p>${escHtml(links
				? format("stonetop.relmap.removeBodyLinks", { name: node.name, count: links })
				: format("stonetop.relmap.removeBody", { name: node.name }))}</p>`,
			buttons: [
				{ action: "remove", label: format("stonetop.relmap.removeConfirm", { name: node.name }), default: true },
				{ action: "keep", label: localize("stonetop.relmap.removeCancel") },
			],
			rejectClose: false,
		});
		if (ok !== "remove") return;
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
		if (!chosen) return;
		const actor = actors.find(a => a.uuid === chosen);
		if (!actor) return;
		await this._addNodeFor(actor, freeSpot(takenSpots(graph), { r: this._boardSize(graph).r }));
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

	/**
	 * Lay the whole board out again, in a shape the reader picks.
	 *
	 * IT ASKS, and asks every time rather than silently repeating what it did last. The two shapes
	 * are not better and worse, they are for different boards and different moments: a ring is the
	 * poster of who is at this table, and clusters are the diagram of who the factions are. The
	 * same map wants each of them on different evenings, and a button that quietly did whatever it
	 * did last would be a button whose behaviour depends on something invisible.
	 *
	 * The last shape is still remembered, and is what the chooser opens on, so saying yes twice is
	 * two clicks and not a decision made twice.
	 */
	async _tidy() {
		const asked = readGraph(this.boardDoc);
		if (!Object.keys(asked.nodes).length) return;
		const shape = await this._askShape(asked.shape);
		if (!shape) return;
		// RE-READ AFTER THE CHOOSER, because a board is a shared document and the chooser is a
		// window somebody can leave open. Laying out the graph as it was when the question was
		// asked would seat everybody except the person another player added while it was up, and
		// they would be the one left standing where the board had been piled.
		const graph = readGraph(this.boardDoc);
		if (!Object.keys(graph.nodes).length) return;
		await this._write(tidyPatch(layoutGraph(graph, shape), shape), {
			announce: localize(`stonetop.relmap.tidied.${shape}`),
			label: localize("stonetop.relmap.history.tidied"),
		});
	}

	/**
	 * Which shape, opening on the one this board is already in.
	 *
	 * ⚠ SAID WITH `selected` AND NOT BY REORDERING THE LIST, which is what this did. Sorting the
	 * current shape to the top is how a reader loses the order they had learned — Ring is above
	 * Clusters on one board and below it on the next, so the row under the pointer depends on
	 * something the reader was not thinking about — and it gives no hint why the second row is the
	 * pre-selected one. The picker takes a default for exactly this reason.
	 */
	async _askShape(current) {
		const shapes = [RELMAP_SHAPE_RING, RELMAP_SHAPE_CLUSTERS];
		const chosen = await pickContentOption({
			title: localize("stonetop.relmap.tidyTitle"),
			buttonLabel: localize("stonetop.relmap.tidyGo"),
			selected: normalizeShape(current),
			options: shapes.map(shape => ({
				id: shape,
				label: localize(`stonetop.relmap.shape.${shape}`),
				hint: localize(`stonetop.relmap.shapeHint.${shape}`),
				icon: shape === RELMAP_SHAPE_CLUSTERS ? "fa-diagram-project" : "fa-circle-nodes",
			})),
		});
		return chosen ? normalizeShape(chosen) : null;
	}

	// ── Which question this map is being asked ──────────────────────────────

	/** Does the view this reader is in place its own portraits? The ONE question behind whether a
	 * drag, an arrow-key nudge, a Delete, a sidebar drop or a board tool means anything here — and
	 * a named one, so that the next view added cannot land on the wrong side of it by default. */
	_placesOwnSeats() {
		return seatsItself(this._view);
	}

	/**
	 * Show this map as something else.
	 *
	 * A FULL RE-RENDER, and this is the one place in this window where that is the right answer
	 * rather than the lazy one. Everything else that repaints goes out of its way NOT to render
	 * (see `sync`): a render re-fits the board and throws away the corner the reader had zoomed
	 * into, which is the state they were using. But this changes which tools are on the bar, and it
	 * changes the size and the whole content of the sheet, so there is no corner to keep: each view
	 * occupies a different board from the last, and being shown it fitted is exactly what somebody
	 * asking for it wants.
	 *
	 * ⚠ AND IT EARLY-RETURNS ON THE VIEW ALREADY UP. With a toggle that could not happen; with a
	 * chooser, picking the row you are already on is the commonest idle gesture there is, and it
	 * would otherwise re-fit the board and cost the reader the corner they had zoomed into for no
	 * change at all.
	 *
	 * NOTHING IS WRITTEN, here or anywhere the three narrow views touch. That is what makes them
	 * views at all: the arrangement the table has built up is still in the document, untouched, and
	 * coming back to "Everyone on the map" puts the reader in front of it exactly as they left it.
	 */
	_setView(name) {
		const want = normalizeView(name);
		if (want === this._view) return;
		this._view = want;
		// Dropped rather than carried over: it points at a person who may not even be on the board
		// the next render draws, and `_lightPerson` would only have to throw it away again.
		this._lit = null;
		// WHO THE FOCUS VIEW IS ABOUT, settled on the way in rather than left for the reader to
		// discover is missing. Only when there is nobody chosen yet or the person chosen has left
		// the map: a reader coming back to this view finds it still about whoever it was about.
		if (want === RELMAP_VIEW_FOCUS) {
			const graph = readGraph(this.boardDoc);
			if (!this._focus || !graph.nodes[this._focus]) this._focus = this._defaultFocus(graph);
		}
		// HANDED TO THE RENDER, not said around it. `render()` is fire-and-forget -- it starts the
		// work and returns the window -- so writing into the live region on either side of this
		// call speaks into a region the render is about to throw away, and a reader on a screen
		// reader hears nothing at all about the view they just changed. `_render` says it once the
		// new region is on screen.
		this._sayOnRender = this._viewSaid();
		this._focusOnRender = "[data-relmap-view]";
		this.render();
	}

	/**
	 * What a screen reader is told about the view that has just come up.
	 *
	 * WITH ITS COUNTS IN IT, for the two narrow views, and that is the whole reason this is not a
	 * flat string per view. After the render focus is on the document body, so this announcement is
	 * the ONLY thing a reader who cannot see the board learns about the press — and "showing the
	 * focus view" tells them nothing they did not already know. How many people are on the ring,
	 * and whose it is, is also the sighted reader's only check that the filter did what they meant.
	 */
	_viewSaid() {
		const plan = this._plan();
		// ⚠ A VIEW SHOWING NOBODY IS NOT A COUNT OF ZERO. "Showing the 0 player characters and the 0
		// lines between them" is arithmetic where the reader needs news, and after the render this
		// is the ONLY thing somebody who cannot see the board is told: the panel that explains what
		// happened is on screen but nothing reads it out. So it says what the panel says.
		if (plan.bare) return this._bareSaid(plan).bareLead;
		if (plan.view === RELMAP_VIEW_PARTY) {
			return format("stonetop.relmap.viewNow.party", {
				count: Object.keys(plan.graph.nodes).length,
				links: Object.keys(plan.graph.edges).length,
			});
		}
		if (plan.view === RELMAP_VIEW_FOCUS) {
			if (!plan.centre) return localize("stonetop.relmap.focusUnset");
			return format("stonetop.relmap.viewNow.focus", {
				name: this._nameOf(plan.all, plan.centre),
				count: Math.max(0, Object.keys(plan.graph.nodes).length - 1),
			});
		}
		return localize(`stonetop.relmap.viewNow.${plan.view}`);
	}

	/**
	 * Who the focus view opens on, before the reader has said.
	 *
	 * RESOLVED THROUGH THE MAP and never straight off the user, which is the trap here: this system
	 * assigns a full GM's `user.character` to their GM Toolkit actor (hooks/Ready.js), and that is
	 * not somebody who can be on a relationship map at all. So the reader's own person is offered
	 * only if they are actually on this board, and `defaultCentre` falls through to whoever has the
	 * most lines drawn to them — the most useful centre any map has, and the one a GM opening
	 * somebody else's board is most likely to want.
	 *
	 * MATCHED WITH `nodeIdentity`, the store's own rule for recognising a person, so this agrees
	 * with everything else in the feature about who is already on the map.
	 *
	 * ⚠ ASKED OF THE VISIBLE GRAPH, not the stored one. "Whoever has the most lines" counted over
	 * lines this reader has put away lands them on somebody whose web they cannot see — the focus
	 * view opening on a person with an empty ring, for a reason nothing on screen explains.
	 */
	_defaultFocus(graph) {
		return this._myNode(graph) ?? defaultCentre(this._visibleGraph(graph), null);
	}

	/**
	 * The reader's own person, IF they are on this map. Null otherwise, and null is the common case.
	 *
	 * ITS OWN FUNCTION so that "this is the default" and "this is YOURS" stay two different facts.
	 * They are not the same one: this system assigns a full GM's `user.character` to their GM
	 * Toolkit actor (hooks/Ready.js), which cannot be on a relationship map at all, so for the
	 * reader who opens this window most the default is the fallback and calling it theirs is simply
	 * untrue. The picker labels the row it pre-selects, and a label naming a stranger as your own
	 * character is worse than no label.
	 */
	_myNode(graph) {
		const mine = game.user?.character ?? null;
		if (!mine) return null;
		const wanted = nodeIdentity({ uuid: mine.uuid, name: mine.name });
		return defaultCentre(graph, node => nodeIdentity(node) === wanted, { onlyMine: true });
	}

	/**
	 * Show somebody else's web, because the reader picked them out of the chooser on the bar.
	 *
	 * A WHOLE RENDER, exactly as `_setView` is and for the same reason: this is a different board,
	 * not the same one changed. A different cast on a differently sized sheet, everybody at a seat
	 * this view has just worked out, and being shown it fitted is what somebody who asked for it
	 * wants. Nothing is written; the arrangement the table built is untouched, as it is under every
	 * one of these views.
	 *
	 * ⚠ RE-READ BEFORE IT IS BELIEVED. The rows were built when this window last painted, and a
	 * board is a shared document: somebody at the far end of the table can take a person off it
	 * between the repaint that listed them and the moment this reader opens the list. Centring on
	 * them would put up an empty view explaining that they have gone, which is a worse answer than
	 * saying so.
	 *
	 * THE EMPTY ROW IS NOT A CHOICE. It stands in the list only while there is no centre at all, to
	 * stop the control naming somebody the board is not showing (see `_focusOptions`), and picking
	 * it again is the reader landing back where they started.
	 */
	_setFocus(id) {
		const want = String(id ?? "");
		if (!want || want === this._focus) return;
		if (!readGraph(this.boardDoc).nodes[want]) {
			// NOT `relmap.gone`, which says a character SHEET has left the world. What happened here
			// is that somebody took this person off the MAP a moment ago, and their sheet is very
			// probably fine.
			ui.notifications?.warn?.(localize("stonetop.relmap.focusLeftMap"));
			return;
		}
		this._focus = want;
		// Dropped rather than carried over: it points at somebody who may not be on the ring this
		// person's web draws, and `_lightPerson` would only have to throw it away again.
		this._lit = null;
		this._sayOnRender = this._viewSaid();
		// Back onto the chooser they used, not the view select beside it: they are most likely to
		// use it again, walking the party one player at a time. See `_setView` on why an AppV1
		// render has to be told to put focus back at all.
		this._focusOnRender = "[data-relmap-focus]";
		this.render();
	}

	/**
	 * Read the writing on every unmarked line and mark the ones that name a family tie.
	 *
	 * THE ONE PLACE A GUESS IS EVER APPLIED, and it is applied because somebody pressed a button
	 * that says so. A map written before family ties existed has all of this in its captions
	 * already, and asking a table to reopen forty lines by hand to say what forty lines already say
	 * is how a feature goes unused. What the guess must never be is silent: the toast says how many
	 * it marked and warns which way round a line is read, because the one mistake it can make that
	 * the reader would not otherwise notice is a tie set backwards.
	 *
	 * A LINE ALREADY MARKED IS NEVER TOUCHED, including one marked "not a family tie": an answer
	 * somebody has given is an answer, and overruling it is worse than never guessing.
	 *
	 * ONE WRITE for the whole pass, so the board repaints once rather than once per line.
	 */
	async _findKin() {
		const found = unmarkedKin(readGraph(this.boardDoc));
		if (!found.length) {
			ui.notifications?.info?.(localize("stonetop.relmap.findKinNone"));
			return;
		}
		const patch = {};
		for (const row of found) Object.assign(patch, edgePatch(row.id, { kin: row.kin }) ?? {});
		const said = format("stonetop.relmap.findKinFound", { count: found.length });
		// ONE STEP FOR THE WHOLE PASS, because it is one press. It marks however many lines read
		// like a family tie, and a reader who does not like the guesses wants the lot gone again in
		// one press back, not one press per line it happened to find.
		const label = localize("stonetop.relmap.history.foundKin");
		if (await this._write(patch, { announce: said, label })) ui.notifications?.info?.(said);
	}

	// ── How much of the board's prose is showing ────────────────────────────

	/**
	 * Step the captions on to the next setting.
	 *
	 * NO RE-RENDER, deliberately, and this is the difference between it and the tools beside it. A
	 * render rebuilds the surface and re-fits the board, which throws away the corner the reader
	 * had zoomed into. A tool that changes who is ON the board has to pay that; this changes
	 * nothing but what is painted, so it is a class on the root and the stylesheet does the rest. The reader turns the captions down precisely BECAUSE they are deep
	 * in a crowded corner, and taking that corner away from them would be the worst possible
	 * moment for it.
	 */
	_cycleLabels(button) {
		const next = LABEL_MODES[(LABEL_MODES.indexOf(this._labels) + 1) % LABEL_MODES.length];
		this._labels = next;
		this._paintLabelMode(button);
		this._announce(localize(`stonetop.relmap.labelsNow.${next}`));
	}

	/** The one place the caption setting reaches the DOM, so the button and the board cannot come
	 * to disagree about which setting is on. */
	_paintLabelMode(button = null) {
		const root = this._root;
		if (!root) return;
		for (const mode of LABEL_MODES) root.classList.toggle(`labels-${mode}`, mode === this._labels);
		// Turning the captions off leaves every stroke broken for words that are not there.
		this._paintLineGaps();
		const control = button ?? root.querySelector("[data-relmap-action='labels']");
		if (!control) return;
		const text = control.querySelector(".stonetop-relmap-tool-text");
		if (text) text.textContent = localize(`stonetop.relmap.labels.${this._labels}`);
		control.dataset.relmapLabels = this._labels;
		control.setAttribute("aria-label", labelsAria(this._labels));
	}

	// ── The lines an old import left behind ──────────────────────────

	/**
	 * Put away the lines a past "Pull in ratings" wrote into this board, or bring them back.
	 *
	 * WHY IT IS STILL WORTH A CONTROL NOW NOTHING CREATES SUCH LINES. That button wrote one for
	 * every rating anybody had stored, one way round each, so a table that pressed it while
	 * introducing their characters is still carrying a line per pair per direction — dozens at once,
	 * most of them saying roughly the same thing — with the handful of ties they drew by hand
	 * underneath. The caption setting beside it turns the WORDS down on every line together; this
	 * takes one whole kind of line off the board and leaves the other at full strength.
	 *
	 * ⚠ AND IT IS THE HALF OF THIS PAIR A PLAYER CAN REACH. `_dropImported` is the other, and it is
	 * an edit: it rubs them out for everybody, so it is behind the permission gate. A reader who may
	 * only look still has to be able to see past a hundred lines, and this asks nothing of anyone.
	 *
	 * THE READER'S OWN, like the captions and the views, and it RUBS NOTHING OUT. The lines are
	 * still in the document, still on everybody else's screen, and unticking the box brings them
	 * straight back.
	 *
	 * ONLY WHAT THAT BUTTON WROTE can be recognised, because the mark is a stamp made at the moment
	 * of writing (`RELMAP_SRC_HEARTS`) and never a guess made afterwards. Lines pulled in before the
	 * stamp existed read as hand-drawn and stay showing, which is the safe way round: the
	 * alternative is a box that quietly hides ties somebody drew themselves.
	 *
	 * A REPAINT AND NOT A RENDER, for the reason `_cycleLabels` gives: a render re-fits the board
	 * and costs the reader the corner they had zoomed into. What changes here is which lines the
	 * board is drawn from, which is exactly what a repaint is for.
	 */
	_togglePulled(box) {
		this._hidePulled = !!box?.checked;
		// Said BEFORE the repaint, as every other announcement in this window is: the repaint
		// replaces the live region's neighbours, and a message posted after it can land on markup
		// that has already been thrown away.
		this._announce(localize(`stonetop.relmap.pulledNow.${this._hidePulled ? "on" : "off"}`));
		return this._repaintBoard();
	}

	/**
	 * Light up one person's whole web, or nobody's.
	 *
	 * WHAT IT IS FOR IS THE QUESTION A DENSE BOARD CANNOT ANSWER: not "what does this one line
	 * say" but "what does everybody think of her". Resting on a face marks every line and caption
	 * touching it, and the stylesheet quiets the rest. In the `hover` caption setting it is also
	 * the ONLY thing that shows a caption, which is what lets a board with two hundred lines on it
	 * still be read a person at a time.
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
		const faces = [...(root.querySelectorAll?.("[data-relmap-node]") ?? [])];
		// SOMEBODY NO LONGER ON THE BOARD IS NOBODY. This is put back after every repaint, and the
		// repaint may be the one that carried away the very person the pointer was resting on:
		// another player taking them off the map. Left alone, the board would dim everything to
		// light up a web that is not there any more.
		this._lit = faces.some(el => el.dataset.relmapNode === want) ? want : null;
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
		root.querySelectorAll?.("[data-relmap-who]")?.forEach?.(el => {
			const who = (el.dataset.relmapWho ?? "").split(" ").filter(Boolean);
			el.classList.toggle("is-lit", !!this._lit && who.includes(this._lit));
		});
		this._paintLitCaptions(root);
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
	 * Put the captions away while the board is too small to read them on.
	 *
	 * ⚠ THE MAP'S PERFORMANCE FIX, and it is a legibility rule that happens to be one. Text on a
	 * path is expensive to RASTER — the browser warps every glyph onto its curve and, with the halo,
	 * strokes each warped outline as well. The cost is per glyph ON SCREEN, so it is worst at the
	 * scale the window opens at, where the whole board is fitted into the viewport and every one of
	 * a hundred captions is being drawn at once. Measured on this table's own map (36 people, 102
	 * captions of ~85 characters): 5.3 SECONDS of raster at a third size, 2.6s at 0.4, 76ms at 0.7,
	 * 3ms at 1. Zoomed in the browser rasters only what is in view and the cost is bounded by the
	 * window; zoomed out there is no bound but the board.
	 *
	 * AND AT THOSE SCALES THE WRITING IS THREE PIXELS TALL. It was never readable; it was a grey
	 * thicket over the diagram, costing seconds of raster to say nothing. Putting it away is what
	 * the reader would have asked for.
	 *
	 * SO THE RULE IS THE PAINTED SIZE OF THE TYPE and not a zoom number: the threshold has to move
	 * with whatever the stylesheet sets the captions in, and `_fitGapsToPaint` has already read that
	 * off a real caption. `CAPTION_FLOOR_PX` is the smallest type worth drawing — and this is the
	 * one board in the system with a reader on a screen magnifier looking at it, so it is generous.
	 *
	 * NOT A FOURTH SETTING. The captions control still says what the reader asked for; this is the
	 * board declining to paint what it could not show them. Zooming in brings them back.
	 */
	_paintCaptionZoom(surface) {
		const root = this._root;
		if (!root?.classList) return;
		const scale = Number(surface?.scale);
		const px = Number(this._drawn?.captionPx) || CAPTION_FALLBACK_PX;
		// Unknown scale means show them: a board that has not been sized yet must not open blank.
		const tiny = scale > 0 && scale * px < CAPTION_FLOOR_PX;
		root.classList.toggle("captions-too-small", tiny);
		this._paintLineGaps();
	}

	/**
	 * Heal the holes in the strokes when there is no caption to sit in them.
	 *
	 * Every line is drawn BROKEN, with a length of it cut out exactly where its caption goes
	 * (`curveWithGap`), because the words sit in the line rather than over it. Take the words away —
	 * the reader turning the captions off, or the board zoomed out past the size at which they are
	 * worth drawing — and what is left is a web of lines with conspicuous breaks in them for nothing,
	 * which reads as a broken diagram rather than a quiet one.
	 *
	 * NOT IN `hover` MODE. There the captions are still being painted, one person's at a time, and a
	 * line healed until the pointer arrives would have to break again underneath the caption the
	 * moment it did.
	 *
	 * BY REDRAWING AND NOT BY A CLASS, because a gap is a length missing from the path data and no
	 * stylesheet can put it back. Both forms were worked out at render time and are held on the
	 * shape, so this is a write and never a calculation; and it happens only when the answer
	 * changes, which on a zoom is once, at the threshold.
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

	_paintLineGaps() {
		const drawn = this._drawn;
		if (!drawn?.shapes?.size) return;
		// ⚠ THE ANSWER IS WORKED OUT BEFORE THE BOARD IS TOUCHED, because this runs on every
		// painted frame of a pan (through `onChange` -> `_paintCaptionZoom`) and nearly every one
		// of those leaves at the line below with nothing to do. Reading the element and its
		// classes first spent a lookup and a style read per frame to reach an early-out.
		const whole = this._labels === "off"
			|| (this._labels !== "hover" && !!this._root?.classList?.contains?.("captions-too-small"));
		if (drawn.healed === whole) return;
		const board = this._boardEl();
		if (!board) return;
		drawn.healed = whole;
		for (const line of board.querySelectorAll?.("[data-relmap-line]") ?? []) {
			const shape = drawn.shapes.get(line.dataset?.relmapLine);
			if (!shape?.curve) continue;
			line.setAttribute("d", whole ? shape.curve.d : (shape.d ?? shape.curve.d));
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
	 * AGAIN here, over the top. (What makes the captions affordable in the first place is a
	 * different rule and a bigger one: `_paintCaptionZoom`.)
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

	/**
	 * Rub out the lines a past "Pull in ratings" wrote into this board.
	 *
	 * ⚠ THE WAY OUT OF A BUTTON THAT NO LONGER EXISTS. That one wrote a line into the shared
	 * document for every rating anybody in the world had stored, one each way round — dozens at
	 * once on a table that filled its sheets in during the introductions — and it is gone, replaced
	 * by the party view, which shows the same information without writing any of it (see
	 * relmap/relmap-intros.js). But a board somebody already pressed it on is still carrying every
	 * line it made, and there is no other way to be rid of a hundred lines than a hundred presses.
	 *
	 * IT TOUCHES ONLY WHAT THE IMPORT STAMPED. `RELMAP_SRC_HEARTS` is a mark made at the moment of
	 * writing and never a guess made afterwards, which is exactly what makes this safe: everything
	 * anybody drew by hand is unmarked and stays. The same rule leaves lines pulled in BEFORE the
	 * stamp existed alone, which is the safe way round — the alternative is a button that quietly
	 * rubs out ties somebody drew themselves.
	 *
	 * PEOPLE ARE LEFT ON THE MAP, deliberately, though some of them may only be on it because the
	 * import put them there. Taking somebody off is a separate act with its own confirmation, and a
	 * button that removed a dozen portraits as a side effect of tidying up lines would be a button
	 * nobody could predict.
	 *
	 * CONFIRMED, and the count is in the question: there is no undo, and the whole point of the
	 * press is that the reader cannot see how many there are.
	 *
	 * ONE WRITE for all of them. Several would broadcast several times, and every other client at
	 * the table would watch the lines vanish one at a time over a second or two.
	 */
	async _dropImported() {
		const graph = readGraph(this.boardDoc);
		const ids = Object.entries(graph.edges)
			.filter(([, edge]) => isImportedEdge(edge))
			.map(([id]) => id);
		if (!ids.length) {
			// Said out loud rather than left silent: a press that does nothing looks exactly like a
			// broken button, and this one is only offered when there IS something to do — so
			// arriving here at all means somebody else got there first.
			ui.notifications?.info?.(localize("stonetop.relmap.dropPulledNothing"));
			return;
		}
		const ok = await foundry.applications.api.DialogV2.wait({
			classes: themedDialogClasses(),
			window: { title: localize("stonetop.relmap.dropPulledTitle") },
			content: `<p>${escHtml(format("stonetop.relmap.dropPulledBody", { count: ids.length }))}</p>`,
			buttons: [
				{ action: "drop", label: format("stonetop.relmap.dropPulledConfirm", { count: ids.length }), default: true },
				{ action: "keep", label: localize("stonetop.relmap.dropPulledCancel") },
			],
			rejectClose: false,
		});
		if (ok !== "drop") return;
		const patch = {};
		for (const id of ids) Object.assign(patch, dropEdgePatch(id) ?? {});
		const said = format("stonetop.relmap.dropPulledDone", { count: ids.length });
		// ⚠ AND THE CONFIRMATION ABOVE STILL SAYS "THERE IS NO UNDO", ON PURPOSE. What that sentence
		// promises is that nothing at this table brings these lines back for everyone once they are
		// gone, and that stays exactly true: this reader can take it back while their own window is
		// open, and nobody else can, ever. A confirmation about rubbing something out for the whole
		// table is not the place to offer a rope that lasts as long as one browser tab.
		const label = localize("stonetop.relmap.history.droppedPulled");
		if (await this._write(patch, { announce: said, label })) ui.notifications?.info?.(said);
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
	 * a button and the arrow keys nudge), and a highlight only a mouse can summon would take the
	 * `hover` caption setting away from everybody who does not use one.
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
		// NOT ONTO A VIEW THAT SEATS ITSELF. Whoever was dropped would be added to the shared map
		// and then not drawn — a stranger on the tree has no family tie recorded, an NPC in the
		// party view is not a player character, and somebody new has no line to the person the
		// focus view is about — so from where the dropper is standing the drop simply failed, and
		// they will do it again. Refused rather than accepted quietly, and said out loud.
		const takesDrops = () => this.canEdit && !this._placesOwnSeats();
		view.addEventListener("dragover", ev => {
			if (!takesDrops()) return;
			ev.preventDefault();
			view.classList.add("is-dropping");
		});
		view.addEventListener("dragleave", () => view.classList.remove("is-dropping"));
		view.addEventListener("drop", async ev => {
			view.classList.remove("is-dropping");
			if (!this.canEdit) return;
			if (this._placesOwnSeats()) {
				ev.preventDefault();
				ui.notifications?.info?.(localize("stonetop.relmap.noDrop"));
				return;
			}
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
	 * For the callers that cannot wait for a render to speak for themselves — `_setView`, which
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
	 * and switching views is the one thing in this window that renders. Without this, changing view
	 * from the keyboard means tabbing in from the top of the window again every single time, on a
	 * control the whole point of which is that it is flicked between. The announcement is the only
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
		// BEFORE ANYTHING IS DRAWN, because a map still on version 1 has no page for the strip to
		// name and the board would come up under a tab called after the map itself. Once, and
		// nothing at all on every map made since. See `_ensurePage`.
		await this._ensurePage();
		await super._render(force, options);
		// The live region is only NOW the one the reader is on, and so is the control they pressed.
		this._saySoFar();
		this._takeFocusBack();
		if (!this._minimizeOnRender) return;
		this._minimizeOnRender = false;
		await this.minimize();
	}

	async close(options = {}) {
		this._surface?.destroy();
		this._surface = null;
		// A nudge still waiting on its debounce would otherwise be lost with the window.
		this._writeNudge();
		// And so would a caption still waiting on its own. Written BEFORE the teardown, in the same
		// breath and for the same reason: the last thing somebody typed before closing a window is
		// the last thing they expect to have lost.
		this._tieBar?.flush();
		this._tieBar?.destroy();
		this._tieBar = null;
		this._teardownDrag?.();
		this._teardownDrag = null;
		if (this._onUpdate) {
			Hooks.off("updateJournalEntry", this._onUpdate);
			this._onUpdate = null;
		}
		if (this._onDelete) {
			Hooks.off("deleteJournalEntry", this._onDelete);
			this._onDelete = null;
		}
		if (this._onPageUpdate) {
			Hooks.off("updateJournalEntryPage", this._onPageUpdate);
			this._onPageUpdate = null;
		}
		if (this._onPageCreate) {
			Hooks.off("createJournalEntryPage", this._onPageCreate);
			this._onPageCreate = null;
		}
		if (this._onPageDelete) {
			Hooks.off("deleteJournalEntryPage", this._onPageDelete);
			this._onPageDelete = null;
		}
		return super.close(options);
	}
}

/** The caption button's accessible name: what the control is, and which of its three settings is
 * on. ONE SPELLING, because the first render writes it into the markup and every press after that
 * writes it onto the element, and a screen reader hearing two shapes of the same sentence is a
 * screen reader that has found two different buttons. */
function labelsAria(mode) {
	return `${localize("stonetop.relmap.labelsToggle")}: ${localize(`stonetop.relmap.labels.${mode}`)}`;
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
	r, fans, only = null, spread = false, capPx = null, boardWidthPx = RELMAP_BOARD_WIDTH,
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
		out.push({
			id,
			edge,
			curve,
			mid: middle,
			anchor: middle && edge.label ? middle : null,
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
			labels: out.filter(shape => shape.anchor).map(shape => ({
				id: shape.id, curve: shape.curve, text: shape.edge.label,
			})),
			nodes: faces,
			aspect: RELMAP_BOARD_ASPECT,
			r,
			// The width the caller is going to PAINT the captions at. Passed in rather than worked
			// out here, so the measurement and the paint are the same number by construction.
			capPx,
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
		if (!shape.curve) { shape.d = ""; continue; }
		if (!shape.anchor) { shape.d = shape.curve.d; continue; }
		// HOW WIDE THIS ONE CAPTION MAY GET, which is its own line's business and not the board's:
		// a long line carries its whole sentence, a short one is still promised a few words. Sent
		// out with the shape because the stylesheet has to paint at exactly the width the gap below
		// was cut for, and the two are only the same number if there is only one of them.
		shape.labelMax = Math.round(captionRoomPx(shape.curve, { boardWidthPx, capPx }));
		// THE CAPTION AS IT WAS PAINTED, where anybody has been able to measure it. Counting
		// characters overshoots this font by about a fifth, and every pixel of that overshoot is a
		// pixel of stroke rubbed out for a word that was never there: see `labelSize`. Absent on a
		// first paint, where there is nothing on screen yet to measure -- `_fitGapsToPaint` cuts
		// those gaps again as soon as there is.
		const size = captionSize(shape.edge.label, shape.curve, {
			boardWidthPx, capPx, paintedPx: painted?.get(shape.id) ?? null,
		});
		shape.d = curveWithGap(shape.curve, { t: shape.anchor.t, span: size.w, boardWidthPx });
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

function captionMeasurer(parts) {
	for (const found of parts.values()) {
		const words = found?.words;
		const doc = words?.ownerDocument;
		const view = doc?.defaultView;
		if (!view?.getComputedStyle || !doc?.createElement) continue;
		const ctx = measuringContext(doc);
		if (!ctx) continue;
		const style = view.getComputedStyle(words);
		const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
		ctx.font = font;
		// The size the captions came out at, which is what decides whether a board zoomed this far
		// out is showing writing or texture. Read here rather than written down twice: the
		// stylesheet owns the number and this is already the one place that asks it.
		const px = Number.parseFloat(style.fontSize);
		// The font string goes back with it so the caller can ask whether that face has actually
		// ARRIVED. See `_fitGapsToPaint`: the answer is nearly always yes and the one time it is
		// not, every caption on the board is measured in the wrong face.
		return {
			font,
			px: px > 0 ? px : null,
			measure: text => ctx.measureText(typeof text === "string" ? text : "").width,
		};
	}
	return null;
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
	if (!(roomPx > 0) || full <= roomPx) return { text: said, width: full };
	const cutAt = n => `${said.slice(0, n).trimEnd()}${ELLIPSIS}`;
	let lo = 0;
	let hi = said.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (measure(cutAt(mid)) <= roomPx) lo = mid;
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
	const options = StonetopDialog.perDocumentOptions("stonetop-relmap", entry.id, {
		title: entry.name,
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
