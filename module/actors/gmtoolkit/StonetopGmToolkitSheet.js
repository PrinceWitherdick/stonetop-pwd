// Sheet for the "gmToolkit" Actor subtype — the GM's own sheet, the screen-side companion to
// the GM playbook (the "Playbook - GM" spread). Its job is the one the paper playbook does:
// hold the things a GM reaches for mid-sentence, on one surface, in the book's own order.
//
// MODERN LAYOUT ONLY. Every other actor sheet in this system can be rendered in the
// pre-redesign CLASSIC layout as well (see module/utils/sheet-layout.js and the
// `classicLayout*` settings), because those sheets existed before the icon rail and people
// had learned where things were. This one is new, so it has no "as it was" to preserve and
// there is nothing to toggle: no `layoutClasses()` in `classes`, no `stonetop.classicLayout`
// in the context, no `{{#if}}` branches in the template, and `settings.js` deliberately has
// no `classicLayoutGmToolkit` key. `isClassicLayout` answers false for an unregistered key,
// so nothing has to be excluded for that to hold.
//
// `mountTabRail` is still called unconditionally, which is not a contradiction: the helper is
// also the cleanup path that sweeps stale rails off the frame, and a guarded call is the one
// way to strand a live rail there (tests/actors/classic-layout.test.js says so for the other
// three sheets, and the reasoning is the same here).
//
// Almost everything here is reference, so this class has no global edit mode, no header
// edit/lock toggle, and no `_updateObject` work beyond the base class. The one exception is the
// "I wonder..." tab, which a GM authors: its writes go straight to `actor.system.wonders` through
// gm-wonder-tab.js rather than through the form, so the absence of an edit mode still holds.
import { stripHeaderChrome } from "../../utils/sheet-chrome.js";
import { mountTabRail } from "../../utils/tab-rail.js";
import { withSheetSizeMemory } from "../../utils/sheet-size.js";
import { withSectionEditing } from "../../utils/section-editing.js";
import { gmMoveSections } from "../../gm-toolkit/gm-moves.js";
import { bookPageRef } from "../../gm-toolkit/book-ref.js";
import { moveBlurb } from "../../gm-toolkit/gm-move-blurb.js";
import { GmMoveDrawer } from "../../gm-toolkit/gm-move-drawer.js";
import { toggleDisclosure } from "../../utils/disclosure.js";
import { gmDiagrams } from "../../gm-toolkit/gm-diagrams.js";
import { openImageZoom } from "../../utils/image-zoom-window.js";
import { runImportBookArtMacro } from "../../book2-art/macro.js";
import { withGmPrepTabs } from "./gm-prep-tabs.js";
import { withGmWonderTab } from "./gm-wonder-tab.js";
import { withGmEncountersTab } from "./gm-encounters-tab.js";
import { localizedHomefrontSections } from "../../gm-toolkit/homefront-view.js";
import { readCurrentSeason, currentSeasonView, isCurrentSeasonChange } from "../../seasons/current-season.js";
import { localize } from "../../utils/i18n.js";
import { localizedOnce } from "../../utils/localized-once.js";
import { getStonetopSteadingActor, stonetopSteadingHeaderButton } from "../../utils/world.js";

/**
 * What counts as a foldable section heading on this sheet — see `_wireSectionCollapse`.
 * Two shapes: the move groups' own `<h3>`, and the proximity / Hazards headings on the
 * Threats tab, which reuse the steading's heading class along with the rest of that markup.
 */
const HEADING_SELECTOR = ".stonetop-move-group-title, .steading-residents-heading";

/**
 * The GM moves, localized once.
 *
 * The catalog is a module constant and the rest is i18n keys, so the finished list never differs
 * between renders — and this sheet re-renders on every prep-page write in the world, which is a
 * lot of rebuilding for a list of static reference text.
 *
 * Lazy rather than a top-level constant because `game.i18n` is not ready at import time; never
 * invalidated because the language cannot change without a reload. `localizedOnce` is what makes
 * "not ready yet" safe rather than permanent, and freezes the result — see its header.
 */
const localizedMoveSections = localizedOnce(() =>
	gmMoveSections().map(section => ({
		key:        section.key,
		title:      localize(section.titleKey),
		note:       localize(section.noteKey),
		collapseId: section.collapseId,
		// The moves, each with its book citation resolved and its book text cut into the part the
		// row shows and the part it grows into (gm-move-blurb.js). A shallow copy per move rather
		// than the frozen table's own objects, because the citation is localized and the table is
		// not allowed to hold localized text (it is imported by the Expedition dialog too, and
		// that module is loaded long before `game.i18n` exists).
		moves:      section.moves.map(move => ({
			...move, pageRef: bookPageRef(move), blurb: moveBlurb(move),
		})),
		// The die beside the note, and the tooltip on every entry's disclosure. Carried
		// per-section rather than hung on the context beside the list, so a section stays one
		// self-contained object: the heading partial then needs no `../` walk at all, and the
		// entries need exactly one level of it.
		randomizeTitle: localize("stonetop.gmToolkit.moves.randomize"),
		expandTitle:    localize("stonetop.gmToolkit.moves.expand"),
	})));

export function createStonetopGmToolkitSheetClass(Base) {
	// withSheetSizeMemory: reopen at the size this GM last left the toolkit at. This sheet has
	// a fixed default height rather than `height: "auto"`, so the mixin only ever has to
	// restore a size the user actually dragged to (its `_stonetopUserSized` latch), and an
	// untouched toolkit keeps the default forever.
	//
	// withSectionEditing: the fold carets on every tab, plus the per-section edit pencil the
	// Encounters and Wonder tabs carry. NOT Threats or Sites: both had one and lost it, because
	// the only control it ended up locking was the trash while everything around it needed
	// exempting by name — see the note at the head of gm-prep-tabs.js.
	//
	// withGmPrepTabs: the Threats & Dangers and Sites tabs, moved here from the steading sheet.
	// Its file header explains the one thing that must not drift: the STORAGE stayed on the
	// steading, so those tabs resolve it rather than using `this.actor`.
	//
	// withGmWonderTab: the "I wonder..." tab, the one authored surface on this sheet. Its storage
	// IS the toolkit's own (`actor.system.wonders`), which is the opposite of the line above and
	// stated here so the two are never confused for one another.
	return class StonetopGmToolkitSheet extends withGmEncountersTab(withGmWonderTab(withGmPrepTabs(withSectionEditing(withSheetSizeMemory(Base))))) {
		// Read by the mixin's `isSectionEditable`. Constant, not state: this sheet has no global
		// edit wrench, so a section is editable exactly when its own pencil is on.
		_editMode = false;

		// The randomizer beside each GM Moves heading: what it last drew per section (so the next
		// draw from that section can avoid repeating it) and the walk currently running, so a
		// second click can abandon the first. Neither is persisted and neither is on the actor —
		// it is one click's worth of memory, and a "don't repeat" that survived a reload would be
		// a stored preference nobody asked for. Reopening the sheet starts it empty, correctly.
		//
		// ONE PER SHEET rather than per section: the light is tab-wide, and a GM who clicks
		// Homefront's die while Basic's is still travelling is asking for the second answer, not
		// for both. Rows come from the pressed SECTION though, not the whole tab — a light running
		// through Homefront's entries off a click on the Basic die would be showing moves that
		// were never in the draw.
		//
		// The name is checked against AppV1's own members: a property collision there is silent
		// (see the character sheet's notes on `_element`), and `_moveDrawer` collides with nothing
		// in Application, FormApplication or ActorSheet.
		_moveDrawer = new GmMoveDrawer({
			scope: ".stonetop-gm-toolkit-moves",
			group: ".stonetop-move-group",
			row:   ".stonetop-gm-move",
		});

		// The `updateActor` registration that keeps the Homefront tab's "now" mark in step with
		// the steading's clock, or null while unbound. See `_wireSeasonSync`. Null rather than
		// undefined so the `!= null` gate there reads as a state and not as an absence, and
		// checked against Application, FormApplication and ActorSheet's own members, because a
		// property collision with core is silent.
		_seasonSyncHook = null;

		static get defaultOptions() {
			return foundry.utils.mergeObject(super.defaultOptions, {
				// No `...layoutClasses("gmToolkit")` — see the modern-only note at the top.
				// "gm-toolkit" is what the frame rules in stonetop.css hang off; "stonetop" is
				// what gets the window chrome.
				classes:   ["stonetop", "sheet", "actor", "gm-toolkit"],
				// Wide enough that the Moves list reads in its two columns without every gloss
				// wrapping. The column COUNT is fixed at two in stonetop.css, so width here buys
				// line length rather than tracks: this frame spends 60px before the content
				// starts (16px window-content padding + 10px container scrollbar gutter +
				// 24px tab padding + 10px tab gutter), leaving 760px, which is two 368px tracks
				// either side of a 24px gutter — measured, 14 of the 30 glosses take a second
				// line there, against 26 at the 560px floor. Narrower is not broken, only
				// wrappier, and the Threats and Sites tabs want the room regardless.
				width:     820,
				// A DEFINITE height, unlike the NPC's `height: "auto"`. The moves tab is long
				// and its length is fixed (the lists are transcribed, not authored), so an
				// auto-height window would simply open near the full height of the screen every
				// time. A definite frame is also what gives the container something to scroll
				// inside: at `"auto"` the window grows to the content and nothing ever overflows,
				// so the banner would never leave the top of the screen.
				height:    660,
				// Mirrors the CSS floor in stonetop.css. This frame has no `pbta` class, so
				// like the monster and NPC it would otherwise have no floor at all.
				minHeight: 420,
				resizable: true,
				// NOTHING on this sheet is a drop target. ActorSheet's default `dragDrop` entry
				// declares a dragSelector but no DROP selector, which makes the whole
				// `.window-content` accept drops, and the inherited `_onDropItem` then attaches
				// the dropped Item (or a whole Folder's worth) to the actor. On a sheet that
				// renders thirty move cards, dropping a Move onto it is a natural gesture, and
				// the result is invisible: this template iterates `stonetop.moveSections` only,
				// so nothing appears, nothing errors, and there is no UI anywhere to find or
				// delete what just landed. Empty array, not a no-op override, so `DragDrop#bind`
				// never binds at all.
				dragDrop:  [],
				tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "moves" }],
				// THE WHOLE SHEET is one scrollport on this frame, and the container is the element
				// that scrolls (stonetop.css) — header banner, tab body and all, so the banner
				// scrolls off the top the way the window title above it never can. Every other
				// actor sheet pins its header and scrolls the active tab instead, which is why
				// this is not `.sheet-body > .tab.active` like the character sheet's.
				//
				// AppV1 only saves and restores offsets for the selectors named here, and it
				// matters more on this sheet than on any other: `_wirePrepPageSync` re-renders it
				// on every threat, hazard and site write, so without this a GM ticking the second
				// of a threat's grim portents is thrown back to the top of the list between ticks.
				//
				// The selector has to resolve from INSIDE the form. `_restoreScrollPositions` is
				// handed the freshly rendered inner form and jQuery's `.find()` searches
				// descendants only, so `.window-content` — an ancestor of the form — saves fine
				// and then silently restores nothing. The container is the outermost element that
				// is still inside it.
				//
				// One scrollport means one offset shared by all six tabs; see the CSS for why
				// that trade is the right one here and the wrong one on the character sheet.
				scrollY:   [".stonetop-gm-toolkit-container"],
			});
		}

		get template() {
			return "systems/stonetop-pwd/templates/actor/gm-toolkit.hbs";
		}

		async _render(force, options) {
			// Before the paint, so a page written between here and the first render is not
			// missed. Idempotent; see the mixin for why it binds on render rather than in the
			// constructor.
			//
			// Gated on the render actually proceeding, which is the condition AppV1 applies
			// INSIDE `super._render` ("not rendered and not forced, return") and therefore too
			// late to stop these lines. Without the gate, a debounced re-render landing after
			// `close()` re-registers world-wide hooks on a dead sheet — the three JournalEntryPage
			// ones and the season clock's — and the `close()` that would have dropped them has
			// already run, leaving them live for the rest of the session.
			//
			// Both syncs under ONE gate: it is the same condition for the same reason, and a
			// second copy of it is a second thing to remember when a third sync is added.
			if (force || this.rendered) {
				this._wirePrepPageSync();
				// The Homefront tab's "now" mark, kept in step with the steading's clock.
				this._wireSeasonSync();
			}
			// Anything half-typed in the "I wonder..." tab, saved before the repaint takes the box
			// away. Those two fields save on blur, and the sync above redraws this sheet on every
			// prep-page write in the WORLD — a redraw no blur precedes. See the mixin.
			await this._flushGmWonderEdits();
			// The Encounters tab has two boxes with the same problem and the same fix: an
			// encounter name and a collected row's note, both saved on blur. See the mixin.
			await this._flushGmEncounterEdits();
			await super._render(force, options);
			stripHeaderChrome(this);
		}

		async close(options = {}) {
			// The same flush, for the close that no blur precedes: Escape shuts an AppV1 window
			// straight from the focused field, so its `change` event never fires.
			await this._flushGmWonderEdits();
			await this._flushGmEncounterEdits();
			this._unwirePrepPageSync();
			this._unwireSeasonSync();
			this._unwireGmPrepMasonry();
			return super.close(options);
		}

		/**
		 * Re-render when the steading's season clock moves, so the Homefront tab's "now" mark
		 * follows it.
		 *
		 * A sheet is only told about documents it owns, and this one is not the steading — so
		 * without this, a GM who runs Seasons Change with the toolkit open is left with a Homefront
		 * tab marking the season that just ended, beside a steading header that has already moved
		 * on. Nothing about that looks broken, which is exactly the problem: the mark's whole claim
		 * is that it is live.
		 *
		 * Registered on FIRST RENDER and dropped on close, the shape `_wirePrepPageSync` uses and
		 * for the reason its comment gives. `!= null` rather than a truth test, because a hook id
		 * of 0 is a valid registration a falsy check would re-register on every re-render.
		 *
		 * The FLAG is tested before the steading is resolved, and that order is load-bearing rather
		 * than stylistic: every actor update in the world arrives here — every HP tick on every
		 * character — while `getStonetopSteadingActor` is an unindexed scan of `game.actors`. So
		 * the cheap question goes first, and it is asked through `isCurrentSeasonChange` rather
		 * than by spelling the flag path here: where the clock is kept is `current-season.js`'s
		 * to know, and a sheet that knew it too would keep compiling after the key moved.
		 *
		 * Not `createActor`: a world that gains its first steading while this sheet is open has no
		 * clock to have moved yet, and the mark it would gain is the un-stamped fallback — which
		 * the next render picks up anyway. Watching creation as well would buy one repaint of a
		 * value nobody has set.
		 */
		_wireSeasonSync() {
			if (this._seasonSyncHook != null) return;
			// Debounced for the same reason the prep sync is: `recordCurrentSeason` is one write,
			// but the Seasons Change flow lands it alongside the steading's own updates, and a
			// burst should cost one repaint rather than four.
			const rerender = foundry.utils.debounce(() => { if (this.rendered) this.render(false); }, 100);
			this._seasonSyncHook = Hooks.on("updateActor", (actor, changed) => {
				if (!this.rendered) return;
				if (!isCurrentSeasonChange(changed)) return;
				if (actor?.id !== getStonetopSteadingActor()?.id) return;
				rerender();
			});
		}

		/** Drop the season-clock hook. */
		_unwireSeasonSync() {
			if (this._seasonSyncHook != null) Hooks.off("updateActor", this._seasonSyncHook);
			this._seasonSyncHook = null;
		}

		// The gear goes, a "Stonetop" shortcut takes its place. Sheet configuration picks an
		// alternate sheet class for a document, and this actor subtype has exactly one — so the
		// gear here only ever offers the sheet already on screen. What a GM actually wants from
		// this header is the jump the character sheet's header already offers: the steading,
		// whose Threats and Sites STORAGE these tabs read (see gm-prep-tabs.js). Built from the
		// shared descriptor in utils/world.js so the label, marker and unset-state class match
		// the same button everywhere else it appears.
		_getHeaderButtons() {
			const buttons = super._getHeaderButtons().filter(b => b.class !== "configure-sheet");
			buttons.unshift(stonetopSteadingHeaderButton());
			return buttons;
		}

		async getData() {
			const context = await super.getData();
			context.stonetop ??= {};

			// Localized at the boundary rather than in the template, so the sections are one
			// list of plain objects the tests can assert on without a Handlebars environment.
			// Built once for the life of the page — see `localizedMoveSections`.
			context.stonetop.moveSections = localizedMoveSections();

			// The Homefront tab's seven sections, built once for the life of the page in the same
			// way and for the same reason (module/gm-toolkit/homefront-view.js).
			context.stonetop.homefrontSections = localizedHomefrontSections();

			// Which of the year's-work blocks is marked "now". Read LIVE off the steading's clock
			// on every render, and deliberately not stamped onto the frozen section table: a
			// campaign turns its seasons mid-session, and a reference page that has to be reopened
			// to stop naming the wrong one is worse than one that names none. `_wireSeasonSync`
			// is what makes "on every render" mean something when the clock is the thing that
			// moved.
			//
			// Through `currentSeasonView` rather than off `readCurrentSeason` directly, so this
			// mark and the steading header's clock cannot disagree: a world that has recorded no
			// Seasons Change yet is in the season it opened in (DEFAULT_SEASON), and the header
			// already says so. Reading the flag raw would leave the header naming Spring while
			// this tab marked nothing.
			//
			// NO steading is the one case that marks nothing, and an empty string rather than null
			// says so: the value is compared against a season KEY in the template, where null
			// would coerce to the string "null" — matching nothing either way, but reading in the
			// DOM as though something had gone wrong. With no steading there is no campaign clock
			// to be in step with, and inventing a season for one would be the invention.
			const steading = getStonetopSteadingActor();
			context.stonetop.homefrontSeason = steading
				? currentSeasonView(readCurrentSeason(steading)).season
				: "";

			// The Core Loop tab's two figures. Localized and resolved to a servable path at the
			// boundary, same as the move sections, so the template gets plain data and the tests
			// can assert on it without Handlebars. A diagram with no `src` is one this world has
			// not imported; the template draws a placeholder rather than the entry being dropped.
			context.stonetop.diagrams = gmDiagrams();

			// What the shared `section-edit-toggle` partial reads. `editMode` is the GLOBAL edit
			// wrench, which this sheet does not have: the partial hides every pencil while it is
			// on, so leaving it undefined would be read as "on" by an `{{#unless}}` and no pencil
			// would ever draw.
			context.stonetop.canEdit  = this.isEditable;
			context.stonetop.editMode = this._editMode;
			// The Core Loop tab's Import Book Art button asks, because the macro browses and
			// writes files. This sheet is GM-only by ownership, so it is always true in practice.
			context.stonetop.isGM = game.user?.isGM ?? false;

			// Both prep tabs. They publish no edit flags — neither has a pencil.
			// The steading resolved above, handed down rather than looked up again: it is an
			// unindexed `game.actors` scan, and the mixin's own note says both its builders
			// sharing one resolution is the point.
			await this._addGmPrepContext(context, steading);

			// The "I wonder..." list, off `actor.system.wonders`, split into the open questions
			// and the answered ones, plus the book's guidance on keeping it.
			this._addGmWonderContext(context);

			// The Encounters list, off actor.system.encounters, with every collected row resolved
			// to the document it points at. Awaited, unlike the wonder call above: a row pointing
			// into a compendium can need a pack load to name itself (see resolveEncounterEntry).
			await this._addGmEncountersContext(context);

			return context;
		}

		activateListeners(html) {
			super.activateListeners(html);
			// Hang the tab rail off the window's right edge (module/utils/tab-rail.js). Done
			// first so anything below sees the nav in its final home on the frame.
			mountTabRail(this, html);
			// NO mountScrollFrost here, unlike the character and steading sheets. The frosted
			// seam softens text being sliced off as it passes under a PINNED header, and this
			// sheet has none: the banner scrolls away with the content (see `scrollY` above).
			// The helper reads the active TAB's offset, and no tab on this frame scrolls, so
			// mounting it would bind a listener that can never fire and gate a band that can
			// never paint.
			// Folding a section is a reading preference, so this is wired outside any
			// editability guard, exactly as the character and steading sheets wire theirs.
			this._wireSectionCollapse(html, HEADING_SELECTOR);
			// The per-section edit pencil, now Encounters' and Wonder's only. Same class hook the
			// steading used, because the shared `section-edit-toggle` partial emits it and moved
			// here unchanged along with the rest of that markup.
			this._wireSectionEditToggle(html, ".steading-section-edit-toggle");
			// Threats and Sites: doom tracks, prep tools, card collapse, drag-to-scene and the
			// journal threat-seed drop. Self-gated per action, so it goes outside the editable
			// guard the same way the steading wired it.
			this._activateGmPrepListeners(html[0]);
			// The "I wonder..." tab: the add bar, its two text fields, and the three per-row
			// buttons. Delegated on the same root and independent of everything above it.
			this._activateGmWonderListeners(html[0]);
			// The Encounters tab: the add bar, the per-row buttons, the two text fields, the
			// keyboard reorder, and both halves of the drag. Delegated on the same root, and the
			// only thing on this sheet that takes a drop.
			this._activateGmEncountersListeners(html[0]);
			// This sheet's own two buttons. Both are delegated rather than bound per element,
			// because both are re-emitted whenever their tab re-renders and either may be absent
			// (the import button depends on which diagrams this world already has).
			this._wireToolkitButtons(html[0]);
		}

		/**
		 * The Core Loop tab's "Import Book Art" button and the die beside each GM Moves heading.
		 *
		 * ONE delegated listener for both: they are two `closest` checks on the same event on the
		 * same root, and a second `addEventListener` for the second check buys nothing.
		 *
		 * Neither re-renders the sheet. The randomizer's move goes to CHAT, and the page it was
		 * drawn from is reference that never changes; a render would cost a scroll jump for
		 * nothing — the same reasoning the fold in section-editing.js gives for toggling classes
		 * in place, and the same reason the drawn row is lit by a class rather than by re-rendering
		 * the list with the draw marked on it.
		 */
		_wireToolkitButtons(root) {
			root.addEventListener("click", async (ev) => {
				// A diagram, opened big. In OUR zoom window rather than a browser tab: the picture
				// is a page of the GM's own rulebook, and reading it should not mean leaving the
				// game to do it. Keyed by slug, so the two charts of the spread open as two windows
				// and a second click on either raises the one already showing it.
				const diagram = ev.target.closest(".stonetop-gm-diagram-zoom");
				if (diagram) {
					ev.preventDefault();
					openImageZoom({
						src: diagram.dataset.src,
						title: diagram.dataset.caption,
						key: diagram.dataset.slug,
					});
					return;
				}

				// Only rendered for a GM in the first place (the macro browses and writes files);
				// asked again here because a delegated handler cannot rely on that.
				if (ev.target.closest(".stonetop-gm-diagram-import")) {
					ev.preventDefault();
					if (game.user?.isGM) runImportBookArtMacro();
					return;
				}

				// An entry's own name, opening what the book prints under it. Before the
				// randomizer check because both live inside the same move list, and this one is
				// the more specific of the two.
				const toggle = ev.target.closest(".stonetop-gm-move-toggle");
				if (toggle) {
					ev.preventDefault();
					this._toggleMoveBook(toggle);
					return;
				}

				const button = ev.target.closest(".stonetop-section-randomize");
				if (!button) return;
				ev.preventDefault();
				// Draw, walk the light, whisper — the order and the don't-repeat memory both live
				// in the drawer (gm-move-drawer.js), shared with the expedition walkthrough's rail.
				await this._moveDrawer.draw(button, { speaker: ChatMessage.getSpeaker({ actor: this.actor }) });
			});
		}

		/**
		 * Open or shut what Book I prints under one move: its description, the soft/hard line,
		 * its examples of play, and the page they came off.
		 *
		 * A class toggle on the panel's `hidden`, not a re-render. The tab is thirty entries of
		 * static reference text and a render would cost a scroll jump, which is the same reasoning
		 * the fold in section-editing.js gives. It also means the open entry does NOT survive a
		 * re-render, and this sheet re-renders on every prep-page write in the world: a GM who
		 * opens an entry and then edits a threat finds it shut again. Persisting it would mean a
		 * per-entry fold record thirty deep, per user, for a disclosure whose whole purpose is to
		 * be read once and closed.
		 *
		 * TWO parts move together, and that is why the selector names both: the remainder of the
		 * lead paragraph, which lives INSIDE the button and grows the visible sentence in place,
		 * and the panel under it. One call rather than two, so the halves of one blurb cannot end
		 * up in different states.
		 *
		 * The `hidden`/`aria-expanded` pair is moved by utils/disclosure.js, shared with the
		 * Threats tab's type list, because moving one without the other leaves the panel open
		 * while a screen reader is told it is shut and nothing visible says so.
		 */
		_toggleMoveBook(toggle) {
			toggleDisclosure(toggle, ".stonetop-gm-move-rest, .stonetop-gm-move-book");
		}
	};
}
