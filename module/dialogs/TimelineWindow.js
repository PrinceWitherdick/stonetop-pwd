// THE TIMELINE, OPEN.
//
// ONE CLASS, TWO SHAPES, and the whole of the difference between them is how many tracks it is
// handed. Given one track it draws that thread down a spine, which is what a sheet tab shows.
// Given all of them it draws one row per season with a lane per thread, which is the aggregate.
// Not two implementations: the same getData, the same listeners, the same writes, the same live
// sync. The tab is a third shape of the same thing again -- see TimelinePanel, which is this class
// mounted frameless, exactly as the relationship map's panel is its window.
//
// Either shape can be laid DOWN the page or ACROSS it, per reader (the toolbar's Vertical/Horizontal
// pair), and each reader chooses which KINDS of row they see, and on the aggregate which THREADS
// (the toolbar's Filter menu). All are client settings: they change how this reader reads the record, never the record.
//
// WHAT THIS FILE IS CAREFUL ABOUT:
//
//  • ONE WRITER. Every change to a track's entries goes through `_mutate` below, which hands one of
//    timeline-core's pure mutators to the store's single write path. The entry dialog collects
//    input and knows nothing about storage, so the add path and the edit path cannot drift.
//  • A LIVE UPDATE RE-RENDERS, and the reader keeps their place through it: the scroll column's
//    offset DOWN and ACROSS (a sideways timeline scrolls left to right) and the toolbar control
//    that had the keyboard, through StonetopDialog's kept place rather than core's `scrollY`, which
//    only knows about down. Throttled, because one Apply-damage press that drops three foes is
//    three page writes, and a reader on a magnifier must not watch the board flash three times. It
//    never re-renders under the entry dialog: that is a separate window holding its own state.
//  • THE HOOK COMES OFF ON CLOSE. It is a global journal hook, and a window closed without taking
//    it off leaves it firing on every journal write at the table for the rest of the session.

import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { themedDialogClasses } from "../utils/window-theme.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { registerRestorableWindow } from "../utils/window-restore.js";
import { openingSize } from "../utils/opening-size.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { playbookTitle } from "../utils/playbook-actors.js";
import { localize, format } from "../utils/i18n.js";
import { promptForTimelineEntry } from "./TimelineEntryDialog.js";
import { pickContentOption } from "./content-picker.js";
import { bringDialogToFront } from "../utils/front-on-open.js";
import { escHtml } from "../utils/strings.js";
import { GUTTER_LEFT_VAR, GUTTER_TOP_VAR, GUTTER_X_VAR, GUTTER_Y_VAR, wireDragScroll } from "../utils/drag-scroll.js";
import { clampScale, wireWheelZoom } from "../utils/wheel-zoom-scroll.js";
import {
	TIMELINE_JOURNAL_NAME, allTracks, findTimelineJournal, mutateTrack, pageTrackId, readTrack, trackDisplayName,
	trackForActor,
} from "../timeline/timeline-store.js";
import {
	TIMELINE_CARD_SOURCES, addEntry, moveEntry, patchEntry, removeEntry,
} from "../timeline/timeline-core.js";
import { SYSTEM_ID } from "../system-id.js";
import {
	getTimelineAges, getTimelineHiddenSources, getTimelineHiddenTracks, getTimelineOrientation, getTimelineShowAges,
	getTimelineThreadsChosen, isTimelineShown, refuseHiddenFeature,
	setTimelineHiddenSources, setTimelineHiddenTracks, setTimelineOrientation, setTimelineShowAges, setTimelineThreadsChosen,
} from "../settings.js";
import {
	buildAggregateVM, buildTrackVM, defaultHiddenTracks, enrichTrackVM, kindMenu, threadMenu,
} from "../timeline/timeline-view.js";
import { timelineNow } from "../timeline/timeline-record.js";
import { START_YEAR_CHANGED_HOOK } from "../seasons/campaign-year.js";
import { worldCustomTags } from "../timeline/timeline-tag-store.js";
import { TimelineColoursDraft } from "../timeline/timeline-colours-menu.js";
import { TIMELINE_TAGS_FLAG } from "../timeline/timeline-tags.js";
import { FINE_ZOOM_STEP } from "../utils/image-zoom.js";
import { SCRUB_MAX, scrubTicks, wireYearScrubber, yearStops } from "../timeline/timeline-scrub.js";
import { fitMenuToTimeline } from "../timeline/timeline-menu-room.js";
import { wireToolbarWrap } from "../timeline/timeline-toolbar-wrap.js";
import { onPaletteChange } from "../utils/palette.js";
import { AGES_CHANGED_HOOK, ageMarkYears, ageStrip } from "../timeline/timeline-ages.js";
import { wireAgeBands } from "../timeline/timeline-ages-band.js";
import { customTagStyle } from "../timeline/timeline-tags.js";
import { yearLabel } from "../seasons/seasons-chronicle.js";
import { openTimelineAgesDialog } from "./TimelineAgesDialog.js";

/**
 * How far past each edge the timeline can be dragged, as a share of the column it is seen in: three
 * quarters, so a reader can haul it nearly out of sight and a quarter of the window still has the
 * timeline in it to grab and bring back.
 */
const TIMELINE_DRAG_GUTTER = 0.75;


/** The toolbar's two dropdowns, the reader's Filter and the GM's Colours. */
const TIMELINE_MENUS = ".stonetop-timeline-show, .stonetop-timeline-colours-menu";

/**
 * What one wheel notch multiplies the timeline's zoom by: the relationship map's own gentle step,
 * so the two read the same under one hand.
 */
const TIMELINE_ZOOM_STEP = FINE_ZOOM_STEP;

/**
 * How far the wheel zooms the timeline. A quarter is a long campaign seen whole; four times is a
 * card's words large enough to read under a magnifier. Narrower than the map's range, because past
 * these a column of prose is either specks or one word to a screen.
 */
const TIMELINE_ZOOM_MIN = 0.25;
const TIMELINE_ZOOM_MAX = 4;

/** The aggregate window's DOM id, so a second open focuses the first. */
export const TIMELINE_WINDOW_ID = "stonetop-timeline-window";

// What utils/window-restore.js files the aggregate under, so a reload brings it back where it was.
const RESTORE_KIND = "timeline";
const AGGREGATE_RESTORE_KEY = `${RESTORE_KIND}:all`;

export class TimelineWindow extends StonetopDialog {
	/**
	 * ⚠ A TRACK DESCRIPTOR EXACTLY AS `trackForActor` HANDS ONE BACK, keys and all. The tab passes
	 * the store's answer straight through (timeline-tab.js → TimelinePanel → here), and
	 * `_trackDescriptor` below hands the same shape back OUT to `ensureTrackPage`. A key renamed on
	 * the way in reads as `""` and fails silently twice over: the title and the entry dialog lose
	 * the thread's name, and the first entry written on a track with no page yet mints one titled
	 * with the raw actor id.
	 *
	 * @param {object}  [track]           Which track to show. Omit entirely for the aggregate.
	 * @param {string}  [track.trackId]
	 * @param {string}  [track.trackKind]
	 * @param {string}  [track.name]
	 */
	constructor({ trackId = "", trackKind = "", name = "" } = {}, options = {}) {
		super(options);
		this._trackId = trackId;
		this._trackKind = trackKind;
		this._trackName = name;
		this._syncHooks = [];
		// Takes the grab-and-throw back off the scroll column a repaint is about to replace.
		this._unwireDragScroll = null;
		// The wheel's zoom, kept on the instance so a repaint (anyone's write at the table) leaves the
		// reader at the size they chose. Every open starts at 1, as the map's board starts fitted.
		this._zoom = 1;
		this._unwireWheelZoom = null;
		// The year scrubber along the bottom (timeline/timeline-scrub.js), and the stops getData found.
		this._unwireScrubber = null;
		this._scrubStops = [];
		// The Ages' strip over the column's foot (timeline/timeline-ages-band.js).
		this._unwireAgeBands = null;
		// The toolbar's watch for wrapping onto a second line (timeline/timeline-toolbar-wrap.js).
		this._unwireToolbarWrap = null;
		this._unwireShowMenuDismiss = null;
		// Whether this reader left the Filter menu open. Kept on the instance because every tick in it
		// re-renders the window, and a menu that shut itself after each tick would be a menu you
		// have to reopen ten times to hide ten things.
		this._showMenuOpen = false;
		// The GM's Colours menu, kept the same way, and the picks in it not yet saved: a repaint
		// while it is open (anyone's write at the table) draws its rows from the draft.
		this._coloursMenuOpen = false;
		this._coloursDraft = new TimelineColoursDraft();
		this._unwireColoursMenuDismiss = null;
		this._unwireColoursSkinWatch = null;
		// A sync repaint that came in while the GM had a colour picker in hand, run once they let go
		// (_syncRepaint).
		this._repaintHeld = false;
		// Where the reader was as the window went down; see `restoreView`.
		this._viewAtMinimize = null;
	}

	static get defaultOptions() {
		const size = openingSize({ share: 0.8, maxAspect: 1.4, fallbackWidth: 980, fallbackHeight: 760 });
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: TIMELINE_WINDOW_ID,
			template: "systems/stonetop-pwd/templates/dialogs/timeline.hbs",
			width: size.width,
			height: size.height,
			resizable: true,
			classes: [...themedDialogClasses(), "stonetop", "stonetop-timeline-app"],
		});
	}

	// The column that scrolls, kept DOWN and ACROSS through a repaint, so somebody else's entry
	// landing never throws the reader back to the start of the campaign; and the toolbar control
	// that had the keyboard, given back. See StonetopDialog#_keptScrollSelector.
	get _keptScrollSelector() { return ".stonetop-timeline-scroll"; }

	get _focusKeyAttribute() { return "data-timeline-focus"; }

	get title() {
		return this._trackId
			? format("stonetop.timeline.trackTitle", { name: this._trackName })
			: localize("stonetop.timeline.windowTitle");
	}

	/** Single-track mode, as against the aggregate. */
	get isSingleTrack() { return !!this._trackId; }

	/**
	 * What utils/window-restore.js saves this window under, and reopens it from after a reload. Only
	 * the aggregate has one: a single thread is only ever shown as a sheet's tab (TimelinePanel, which
	 * the restore skips as frameless), and comes back with its sheet.
	 */
	get restoreKey() {
		return this.isSingleTrack ? null : AGGREGATE_RESTORE_KEY;
	}

	/**
	 * Where the reader had got to inside the window, saved with its geometry by utils/window-restore.js
	 * and handed back as the reopening render's `view` option (see `_render`): the wheel's zoom, and
	 * the scroll offset counted from the timeline's own corner rather than the box's.
	 *
	 * ⚠ FROM THE CONTENT'S CORNER, past the drag gutter. The gutter is a share of the box, and the box
	 * after a reload may be another size (a smaller screen clamps the window), so a raw offset would
	 * land the reader somewhere else in the campaign.
	 */
	get restoreView() {
		// ⚠ A MINIMIZED WINDOW'S COLUMN IS HIDDEN and reads 0 down and across, which less the gutter
		// is the empty corner. So it answers with where it was when it went down (`minimize`).
		if (this._viewAtMinimize) return this._viewAtMinimize;
		const scroll = this._scrollColumn();
		if (!scroll) return null;
		const { x, y } = this._gutterOf(scroll);
		return {
			zoom: this._zoom,
			left: Math.round(scroll.scrollLeft - x),
			top:  Math.round(scroll.scrollTop - y),
		};
	}

	/** The view is read while the column can still be measured, and kept until the window comes back. */
	async minimize() {
		if (!this._minimized && !this._viewAtMinimize) this._viewAtMinimize = this.restoreView;
		return super.minimize();
	}

	async maximize() {
		const done = await super.maximize();
		this._viewAtMinimize = null;
		return done;
	}

	_scrollColumn() {
		return this.element?.[0]?.querySelector?.(".stonetop-timeline-scroll") ?? null;
	}

	/** The drag gutter as drag-scroll.js last sized it onto the column. */
	_gutterOf(scroll) {
		const px = (name) => Number.parseFloat(scroll.style?.getPropertyValue?.(name)) || 0;
		// The room ABOVE and to the LEFT is what the offset is counted past, and is 0 under a pinned
		// header row or name column.
		const top = scroll.style?.getPropertyValue?.(GUTTER_TOP_VAR);
		const left = scroll.style?.getPropertyValue?.(GUTTER_LEFT_VAR);
		return { x: left ? px(GUTTER_LEFT_VAR) : px(GUTTER_X_VAR), y: top ? px(GUTTER_TOP_VAR) : px(GUTTER_Y_VAR) };
	}

	/**
	 * A reload's reopening render carries the view the window was left at (`restoreView`). The zoom
	 * goes on BEFORE the draw, so the wheel wiring paints it onto the fresh column and the offset
	 * below is not clamped against an unzoomed picture; the offset goes on after, once the window
	 * has its saved size and the gutter is measured.
	 */
	async _render(force, options = {}) {
		const view = options?.view;
		if (view && Number.isFinite(view.zoom)) {
			this._zoom = clampScale(view.zoom, TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_MAX);
		}
		await super._render(force, options);
		const scroll = view ? this._scrollColumn() : null;
		if (!scroll) return;
		const { x, y } = this._gutterOf(scroll);
		if (Number.isFinite(view.left)) scroll.scrollLeft = x + view.left;
		if (Number.isFinite(view.top)) scroll.scrollTop = y + view.top;
	}

	// ── reading ────────────────────────────────────────────────────────────────

	/**
	 * The tracks this window draws. One in single-track mode, every track that has a page in the
	 * aggregate.
	 *
	 * ⚠ SINGLE-TRACK MODE DOES NOT REQUIRE A PAGE. A track nobody has written in yet has none, and
	 * `readTrack` answers `{page: null, entries: []}` for it: that is the invitation the tab shows,
	 * not an error. The aggregate only ever lists pages that exist, because a lane for a thread
	 * with no page is a column that cannot be written in.
	 */
	_tracks() {
		// A player's thread names their playbook under them ("The Seeker"), as it READS: the
		// Would-Be Hero's cross-off is honoured. Empty for the steading and anyone without one.
		return this._bareTracks().map(t => ({ ...t, playbook: playbookTitle(t.actor) }));
	}

	_bareTracks() {
		if (!this.isSingleTrack) return allTracks();
		const track = readTrack(this._trackId);
		return [{
			trackId:   this._trackId,
			trackKind: this._trackKind,
			name:      this._trackName,
			actor:     this._trackActor(),
			page:      track.page,
			entries:   track.entries,
		}];
	}

	/** The actor behind a track, for its portrait and its name. */
	_trackActor() {
		if (!this._trackId) return null;
		if (this._trackKind === "steading") return getStonetopSteadingActor();
		return game.actors?.get(this._trackId) ?? null;
	}

	/**
	 * May this reader write on a track?
	 *
	 * Asked of the PAGE and not of the actor, because the page is what the write actually lands on
	 * and core's own ownership is what will accept or refuse it. A track with no page yet is
	 * writable by anyone who could make one, which is the same question `ensureTrackPage` answers.
	 */
	_canEdit(trackId) {
		// ⚠ MEMOISED FOR THE LENGTH OF ONE RENDER, and not as a micro-optimisation. The
		// aggregate asks this once per LANE per PERIOD, so a table of five threads over twenty
		// seasons asks it a hundred times -- and each answer walks `game.journal` to find the
		// Timeline entry and then its pages to find the track. The cache is cleared at the top of
		// every getData, so ownership changing mid-session still shows up on the next repaint.
		if (this._editCache?.has(trackId)) return this._editCache.get(trackId);
		const page = readTrack(trackId).page;
		const answer = page
			? !!page.isOwner
			: !!(game.user?.isGM || findTimelineJournal()?.isOwner);
		this._editCache?.set(trackId, answer);
		return answer;
	}

	async getData() {
		// Fresh per render; see `_canEdit`.
		this._editCache = new Map();
		const tracks = this._tracks();
		// The world's custom tags: what a typed row's tag chip is named and coloured by, and the lines
		// after the kinds in the Filter menu. A hidden tag the world has since lost is dropped from
		// the count like an unknown kind.
		const tags = worldCustomTags();
		const hidden = getTimelineHiddenSources()
			.filter(source => TIMELINE_CARD_SOURCES.includes(source) || tags.some(tag => tag.id === source));
		const horizontal = getTimelineOrientation() === "horizontal";
		const single = this.isSingleTrack;
		const hiddenTracks = this._hiddenTracks(tracks);

		// The reader's filter is applied INSIDE the builders, before periods are formed, so a season
		// holding nothing but hidden rows leaves no empty block or column behind. Totals (kills,
		// counts) are of everything, hidden or not.
		// The clock's year, which history counts "N years ago" from.
		const nowYear = timelineNow().year;
		// The world's Ages, and whether this reader has their bands off: one more thing hidden. Each
		// shown Age's first and last years are opened even with nothing written in them, so every
		// Age has a band to draw.
		const worldAges = getTimelineAges();
		const showAges = getTimelineShowAges();
		const ageYears = showAges ? ageMarkYears(worldAges) : [];
		const vm = single
			? buildTrackVM(tracks[0], { canEdit: this._canEdit(this._trackId), hidden, tags, nowYear, ageYears })
			: buildAggregateVM(tracks, { canEdit: (id) => this._canEdit(id), hidden, hiddenTracks, tags, nowYear, ageYears });
		const hiddenCount = hidden.length + hiddenTracks.length + (worldAges.length && !showAges ? 1 : 0);

		// Enriched after the model is built rather than inside it, and by the shared walker rather
		// than here: the view model is pure so the three hosts can share it, and enrichment is async
		// and Foundry-only. Every shape is walked the same way because the cards are the same
		// objects either way.
		await enrichTrackVM(vm);

		// The year scrubber's stops, kept for `activateListeners` to wire against; none under two.
		this._scrubStops = yearStops(vm.periods);
		const stops = this._scrubStops;
		const ages = showAges ? this._ageStrip(worldAges, stops) : null;

		return {
			single,
			timeline: vm,
			trackId: this._trackId,
			trackName: this._trackName,
			// A missing page in single-track mode is a thread nobody can write in yet, which reads
			// differently from an empty one: the first is waiting on a GM, the second on the reader.
			hasPage: single ? !!tracks[0].page : true,
			canEdit: single ? this._canEdit(this._trackId) : tracks.some(t => this._canEdit(t.trackId)),
			// The aggregate has nowhere further to go, so it does not offer the door to itself.
			showOpenFull: single,
			horizontal,
			// Only a GM can write the world's colours, so only a GM is offered the menu.
			colours: game.user?.isGM ? { open: this._coloursMenuOpen, rows: this._coloursDraft.rows() } : null,
			kinds: kindMenu(hidden, tags),
			// The aggregate's threads, to hide whole lanes by. Only worth offering with two or more.
			threads: !single && tracks.length > 1 ? threadMenu(tracks, hiddenTracks) : [],
			hiddenCount,
			hiddenCountLabel: format("stonetop.timeline.show.hiddenCount", { count: hiddenCount }),
			showMenuOpen: this._showMenuOpen,
			ages,
			// The GM's door to the Ages, and the reader's switch for their bands (only once there are any).
			agesEditable: !!game.user?.isGM,
			agesToggle: worldAges.length ? { shown: showAges } : null,
			scrub: stops.length > 1
				? { max: SCRUB_MAX, first: stops[0].label, last: stops.at(-1).label, ticks: scrubTicks(stops) }
				: null,
			scrollLabel: single
				? format("stonetop.timeline.trackTitle", { name: this._trackName })
				: localize("stonetop.timeline.windowTitle"),
		};
	}

	/**
	 * The Ages' strip as the template draws it: the Ages with a year on screen, each in its row, named
	 * with its years for the tooltip. Null when none has a year shown.
	 */
	_ageStrip(worldAges, stops) {
		const { bands, rows } = ageStrip(worldAges, stops);
		if (!bands.length) return null;
		const ongoing = localize("stonetop.timeline.ages.ongoing");
		return {
			rows,
			bands: bands.map(band => ({
				id: band.id,
				name: band.name,
				first: band.first,
				last: band.last,
				row: band.row,
				style: customTagStyle(band.colour),
				tooltip: format("stonetop.timeline.ages.band", {
					name: band.name,
					from: yearLabel(band.from),
					to: band.to === null ? ongoing : yearLabel(band.to),
				}),
			})),
		};
	}

	// ── writing ────────────────────────────────────────────────────────────────

	/**
	 * The ONE write path. Hands a pure mutator to the store, which reads the track's page, runs it
	 * over the entries, and writes back only what moved.
	 *
	 * `mutate` returns timeline-core's own `{entries, added|removed|changed|moved}` shape, and a
	 * null result means nothing moved -- so a no-op write, which would re-render every open sheet
	 * and every other client's window to no effect, is skipped there rather than at each call site.
	 */
	async _mutate(trackId, mutate, { create = false } = {}) {
		try {
			const done = await mutateTrack(this._trackDescriptor(trackId), mutate, { create });
			return done?.moved ?? null;
		} catch (err) {
			// The reporting is what this window adds over the shared path: a reader who pressed a
			// button is owed the reason it did nothing.
			this.reportWriteFailure(localize("stonetop.timeline.windowTitle"), err);
			return null;
		}
	}

	/**
	 * What `ensureTrackPage` needs to mint a page for a track this window knows about.
	 *
	 * ⚠ THE NAME IS RESOLVED, not just passed on. A blank name here is a thread titled with its raw
	 * actor id -- `trackDisplayName` answers off the live actor and is what the rest of the system
	 * titles a thread by, which makes the two agree even if this window was opened without a name.
	 */
	_trackDescriptor(trackId) {
		if (trackId === this._trackId) {
			return { trackId, trackKind: this._trackKind, name: this._trackName || trackDisplayName(trackId) };
		}
		const actor = game.actors?.get(trackId);
		return trackForActor(actor) ?? { trackId, trackKind: "", name: trackId };
	}

	/**
	 * Which thread a new entry belongs to.
	 *
	 * ⚠ THE AGGREGATE'S New Entry BUTTON CARRIES NO TRACK, because the aggregate is every
	 * thread at once. Left unasked, the write would land on `readTrack("")`, find no page and do
	 * nothing at all -- a button that silently does nothing, which is the worst shape this can take.
	 * So it asks, through the same one-of-N chooser the rest of the system uses.
	 *
	 * Only the threads this reader may actually write on are offered: a list whose rows can be
	 * chosen and then refused is a worse answer than a shorter list.
	 */
	async _askWhichTrack() {
		// `page.isOwner` directly rather than `_canEdit`: every track `allTracks` returns already
		// HAS its page in hand, and `_canEdit` would re-resolve each one through the journal.
		const options = allTracks()
			.filter(track => track.page?.isOwner)
			.map(track => ({ id: track.trackId, label: track.name, icon: "fa-feather-pointed" }));
		if (!options.length) return null;
		// One writable thread is not a question worth asking.
		if (options.length === 1) return options[0].id;
		return pickContentOption({
			title: localize("stonetop.timeline.whichTrack.title"),
			options,
			buttonLabel: localize("stonetop.timeline.whichTrack.confirm"),
		});
	}

	async _onNewEntry(trackId) {
		const target = trackId || this._trackId || await this._askWhichTrack();
		if (!target) return;
		return this._writeNewEntry(target);
	}

	async _writeNewEntry(trackId) {
		// The clock's season -- the same "now" a milestone files under, so a row the reader types and
		// a row the system writes in the same moment land in the same season.
		const stamp = timelineNow();
		const input = await promptForTimelineEntry({
			season: stamp.season,
			year:   stamp.year,
			trackName: this._trackNameFor(trackId),
		});
		if (!input) return;

		await this._mutate(trackId, entries => addEntry(entries, {
			...input,
			source:    "hand",
			createdAt: Date.now(),
			authorId:  game.user?.id ?? "",
		}, foundry.utils.randomID), { create: true });
	}

	async _onEditEntry(trackId, entryId) {
		const entry = readTrack(trackId).entries.find(e => e.id === entryId);
		if (!entry) return;
		const input = await promptForTimelineEntry({ entry, nowYear: timelineNow().year, trackName: this._trackNameFor(trackId) });
		if (!input) return;
		await this._mutate(trackId, entries => patchEntry(entries, entryId, input));
	}

	async _onRemoveEntry(trackId, entryId) {
		// NAMED BUTTONS rather than Yes/No, and the affirmative first: the question can then be
		// answered off the buttons alone. The house shape, and the same one every other
		// delete-with-confirm in this system takes. `stonetop` in the classes or the window gets
		// none of our chrome at all.
		const entry = readTrack(trackId).entries.find(e => e.id === entryId);
		const removed = await new Promise(resolve => {
			new Dialog({
				title: localize("stonetop.timeline.remove.title"),
				content: `<p>${escHtml(entry?.title || localize("stonetop.timeline.remove.untitled"))}</p>`
					+ `<p>${localize("stonetop.timeline.remove.body")}</p>`,
				buttons: {
					remove: { label: localize("stonetop.timeline.remove.confirm"), callback: () => resolve(true) },
					keep:   { label: localize("stonetop.timeline.remove.cancel"),  callback: () => resolve(false) },
				},
				default: "keep",
				close:  () => resolve(false),
				render: bringDialogToFront,
			}, { classes: ["dialog", "stonetop"] }).render(true);
		});
		if (!removed) return;
		await this._mutate(trackId, entries => removeEntry(entries, entryId));
	}

	async _onMoveEntry(trackId, entryId, delta) {
		await this._mutate(trackId, entries => moveEntry(entries, entryId, delta));
	}

	/**
	 * A track's display name, for a dialog title opened from the aggregate.
	 *
	 * Resolved by id rather than by walking `allTracks`, which normalises and sorts every entry on
	 * every page to hand back a list this only reads one name off.
	 */
	_trackNameFor(trackId) {
		if (trackId === this._trackId) return this._trackName;
		return trackDisplayName(trackId);
	}

	// ── reading preferences (this reader only) ─────────────────────────────────

	/** Lay the timeline down the page or across it. Client-scoped; the re-render is the work. */
	async _onOrientation(orientation) {
		const next = orientation === "vertical" ? "vertical" : "horizontal";
		if (next === getTimelineOrientation()) return;
		await setTimelineOrientation(next);
		this.render(false);
	}

	/** Show or hide one kind of row. Client-scoped; nothing on the page changes. */
	async _onShowKind(source, shown) {
		const hidden = new Set(getTimelineHiddenSources());
		if (shown) hidden.delete(source);
		else hidden.add(source);
		await setTimelineHiddenSources([...hidden]);
		this.render(false);
	}

	/**
	 * The threads this reader has off the aggregate.
	 *
	 * A single thread is never hidden from its own tab. A PLAYER who has not yet chosen sees only
	 * their own characters' threads (timeline-view.js#defaultHiddenTracks), worked out from the board
	 * as it stands; once they tick anything, their own list is what counts. An id whose thread has
	 * since gone is dropped from the count like an unknown kind.
	 */
	_hiddenTracks(tracks) {
		if (this.isSingleTrack) return [];
		if (!game.user?.isGM && !getTimelineThreadsChosen()) {
			return defaultHiddenTracks(tracks, track => !!track.actor?.isOwner);
		}
		return getTimelineHiddenTracks().filter(id => tracks.some(track => track.trackId === id));
	}

	/**
	 * Show or hide one thread on the aggregate. Client-scoped, like the kinds.
	 *
	 * Starts from what the reader is LOOKING AT, the default included, so a player's first tick
	 * changes that one thread and does not throw every other back on. Then the default is spent.
	 */
	async _onShowThread(trackId, shown) {
		const hidden = new Set(this._hiddenTracks(this._tracks()));
		if (shown) hidden.delete(trackId);
		else hidden.add(trackId);
		await setTimelineHiddenTracks([...hidden]);
		await setTimelineThreadsChosen(true);
		this.render(false);
	}

	/** The Ages' bands on or off, for this reader. */
	async _onShowAges(shown) {
		await setTimelineShowAges(shown);
		this.render(false);
	}

	/** Everything back: every kind, the Ages, and on the aggregate every thread (a choice, so the default is spent). */
	async _onShowAll() {
		await setTimelineHiddenSources([]);
		if (!getTimelineShowAges()) await setTimelineShowAges(true);
		if (!this.isSingleTrack) {
			await setTimelineHiddenTracks([]);
			await setTimelineThreadsChosen(true);
		}
		this.render(false);
	}

	// ── wiring ─────────────────────────────────────────────────────────────────

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		if (!root) return;

		// Delegated, one listener for the whole board: the aggregate can hold a great many cards,
		// and binding four listeners to each of them is what makes a repaint expensive.
		root.addEventListener("click", async ev => {
			const target = ev.target;

			const add = target.closest?.(".stonetop-timeline-new");
			if (add) return this._onNewEntry(add.dataset.trackId || this._trackId);

			const full = target.closest?.(".stonetop-timeline-open-full");
			if (full) return openTimelineWindow();

			const orient = target.closest?.(".stonetop-timeline-orient");
			if (orient) return this._onOrientation(orient.dataset.orientation);

			if (target.closest?.(".stonetop-timeline-show-all")) return this._onShowAll();

			if (target.closest?.(".stonetop-timeline-colours-menu")) return this._onColoursClick(target);

			// The GM's Ages: the toolbar's door, or a band pressed to open on its own Age.
			if (target.closest?.(".stonetop-timeline-ages-open")) return openTimelineAgesDialog();
			const age = target.closest?.("button.stonetop-timeline-age");
			if (age) return openTimelineAgesDialog({ focus: age.dataset.ageId });

			const card = target.closest?.("[data-entry-id]");
			const trackId = target.closest?.("[data-track-id]")?.dataset?.trackId || this._trackId;
			if (!card || !trackId) return;
			const entryId = card.dataset.entryId;

			if (target.closest(".stonetop-timeline-edit"))   return this._onEditEntry(trackId, entryId);
			if (target.closest(".stonetop-timeline-remove")) return this._onRemoveEntry(trackId, entryId);
			const move = target.closest(".stonetop-timeline-move");
			if (move) return this._onMoveEntry(trackId, entryId, Number(move.dataset.delta));
		});

		// `input`, not `change`: the chip follows the picker while it is still open.
		root.addEventListener("input", ev => {
			const pick = ev.target?.closest?.(".stonetop-timeline-colours-pick");
			const row = pick?.closest?.("[data-kind]");
			if (!row) return;
			this._coloursDraft.pick(row.dataset.kind, pick.value);
			this._coloursDraft.repaintRow(row);
		});

		root.addEventListener("change", ev => {
			// A colour picker's change is the draft's, already taken on `input` above. It is also the
			// native picker shutting, so a repaint held while it was open can run now.
			if (ev.target?.closest?.(".stonetop-timeline-colours-menu")) return this._releaseHeldRepaint();
			const box = ev.target?.closest?.("[data-timeline-source]");
			if (box) return this._onShowKind(box.dataset.timelineSource, !!box.checked);
			const thread = ev.target?.closest?.("[data-timeline-thread]");
			if (thread) return this._onShowThread(thread.dataset.timelineThread, !!thread.checked);
			const ages = ev.target?.closest?.("[data-timeline-ages]");
			if (ages) this._onShowAges(!!ages.checked);
		});

		root.addEventListener("focusout", ev => {
			if (ev.target?.classList?.contains("stonetop-timeline-colours-pick")) this._releaseHeldRepaint();
		});

		// `toggle` does not bubble, so it is caught on the way DOWN (capture). Remembered so the
		// menu stays open across the re-render each tick in it causes.
		// Each menu, as it opens, is fitted to the room below it (timeline/timeline-menu-room.js): a
		// sheet's tab cannot be dragged taller to show a menu run off its foot.
		root.addEventListener("toggle", ev => {
			if (ev.target?.classList?.contains("stonetop-timeline-show")) this._showMenuOpen = !!ev.target.open;
			if (ev.target?.classList?.contains("stonetop-timeline-colours-menu")) this._onColoursToggle(ev.target);
			if (ev.target?.matches?.(TIMELINE_MENUS)) fitMenuToTimeline(ev.target);
		}, true);
		this._wireMenuDismiss(root.querySelector(".stonetop-timeline-show"));
		this._wireMenuDismiss(root.querySelector(".stonetop-timeline-colours-menu"), "_unwireColoursMenuDismiss");
		// A menu drawn open was drawn from the draft just now, so it only needs the skin watch back.
		this._watchColoursSkin(root.querySelector(".stonetop-timeline-colours-menu"));
		// A menu drawn open (a tick in it repaints the timeline) is fitted now, not on a toggle.
		for (const menu of root.querySelectorAll(TIMELINE_MENUS)) fitMenuToTimeline(menu);
		// A toolbar wrapped onto two lines lays the second under the first (timeline/timeline-toolbar-wrap.js).
		this._unwireToolbarWrap?.();
		this._unwireToolbarWrap = wireToolbarWrap(root.querySelector(".stonetop-timeline-toolbar"));

		// Drag the column about and throw it, as the relationship map's board is (utils/drag-scroll.js).
		// A fresh column every repaint, so the old one's wiring (and any glide still running on it) goes.
		// The gutter is empty room past every edge to drag the timeline off into, as the map's board
		// goes off any side; `.stonetop-timeline-canvas` is what spends it.
		// It stops where the hand leaves it, a column half under the pinned head or not: nothing
		// settles it afterwards (user, 2026-10-04: "the scrubber moves by itself after the sliding
		// stops"; the column snap that eased the board is gone).
		this._unwireDragScroll?.();
		// The aggregate has no room above, left of or below it to scroll into; only the right keeps its
		// drag-off room. Its two grids pin a header row to the top (the thread names read down, the
		// season heads read across) and a column to the left (the board's season cells, the swimlanes'
		// thread names), which would otherwise slide off those edges (user, 2026-10-03: "you can't
		// scroll past the left most season header"), and it stops at its foot (user, 2026-10-05). The
		// stylesheet drops its top inset and left pad to match (Down drops every left pad, the
		// swimlanes' own rule covers Across).
		//
		// A SINGLE THREAD (a sheet's tab) has one line and no pinned heads, and its line can be dragged
		// to the middle of the view (user, 2026-10-07): room on both sides ACROSS the line (above and
		// below it read across, left of it read down), none before its first season or past its foot
		// read down, as before.
		const readAcross = getTimelineOrientation() === "horizontal";
		const roomAcrossLine = this.isSingleTrack;
		this._unwireDragScroll = wireDragScroll(root.querySelector(".stonetop-timeline-scroll"), {
			gutter: TIMELINE_DRAG_GUTTER,
			pinTop: !(roomAcrossLine && readAcross),
			pinLeft: !(roomAcrossLine && !readAcross),
			pinBottom: !(roomAcrossLine && readAcross),
		});
		// And the wheel zooms it about the cursor, as the map's wheel zooms the board
		// (utils/wheel-zoom-scroll.js). The canvas's one child is the picture; the stylesheet spends
		// the scale on it, and the gutter round it stays a window's worth whatever the size.
		this._unwireWheelZoom?.();
		this._unwireWheelZoom = wireWheelZoom(root.querySelector(".stonetop-timeline-scroll"), {
			content: ".stonetop-timeline-canvas > *",
			get: () => this._zoom,
			set: scale => { this._zoom = scale; },
			step: TIMELINE_ZOOM_STEP,
			min: TIMELINE_ZOOM_MIN,
			max: TIMELINE_ZOOM_MAX,
		});
		// The year scrubber: slide and the column follows the thumb, free of any stop; move the
		// column any other way and the thumb follows it.
		this._unwireScrubber?.();
		this._unwireScrubber = wireYearScrubber(
			root.querySelector(".stonetop-timeline-scroll"),
			root.querySelector(".stonetop-timeline-scrub"),
			{
				stops: this._scrubStops,
				horizontal: readAcross,
				picture: ".stonetop-timeline-canvas > *",
				// The first child's own top inset (`.stonetop-timeline-scroll > :first-child`), and the
				// column's 12px left padding, kept when a year or a wide board is laid against an edge.
				inset: 12,
			},
		);
		// The Ages' bands, laid under their years wherever the column has them. Hidden under the
		// aggregate's pinned names (the swimlanes' thread column, the board's lane-name row), never
		// drawn over them.
		this._unwireAgeBands?.();
		this._unwireAgeBands = wireAgeBands(
			root.querySelector(".stonetop-timeline-scroll"),
			root.querySelector(".stonetop-timeline-ages"),
			{
				horizontal: readAcross,
				pinned: this.isSingleTrack ? "" : (readAcross ? ".stonetop-timeline-swim-lane-head" : ".stonetop-timeline-lane-heads"),
			},
		);

		this._wireSync();
	}

	/**
	 * Shut a toolbar menu (Filter, or the GM's Colours) when the reader presses anywhere outside it,
	 * as a dropdown does. `slot` is the property its unwire is kept in, one per menu.
	 *
	 * On the DOCUMENT, in capture, so a press the drag-scroll column (or another window) swallows
	 * still counts. Shutting it fires `toggle`, which clears the menu's open flag for the next
	 * repaint. The listener takes itself off once its menu leaves the page: a repaint draws a fresh
	 * menu, and the sheet-tab panel can be dropped with its sheet without ever passing through `close`.
	 */
	_wireMenuDismiss(menu, slot = "_unwireShowMenuDismiss") {
		this[slot]?.();
		this[slot] = null;
		if (!menu) return;
		const onPointerDown = ev => {
			if (!menu.isConnected) return unwire();
			if (menu.open && !menu.contains(ev.target)) menu.open = false;
		};
		const unwire = () => {
			document.removeEventListener("pointerdown", onPointerDown, true);
			if (this[slot] === unwire) this[slot] = null;
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		this[slot] = unwire;
	}

	/**
	 * The Colours menu opened or shut. Opening repaints every row from the draft, so a skin changed
	 * while it was shut shows. Shutting keeps the draft: only Save and Cancel end it.
	 */
	_onColoursToggle(menu) {
		this._coloursMenuOpen = !!menu.open;
		if (menu.open) this._coloursDraft.repaintAll(menu);
		this._watchColoursSkin(menu);
	}

	/**
	 * While the Colours menu is open, a change of skin (utils/palette.js) repaints its rows, so each
	 * row previews what THIS page now wears.
	 */
	_watchColoursSkin(menu) {
		this._unwireColoursSkinWatch?.();
		this._unwireColoursSkinWatch = null;
		if (!menu?.open) return;
		const unwire = onPaletteChange(() => {
			if (menu.isConnected) this._coloursDraft.repaintAll(menu);
			else this._unwireColoursSkinWatch?.();
		});
		this._unwireColoursSkinWatch = () => {
			unwire();
			this._unwireColoursSkinWatch = null;
		};
	}

	/**
	 * A press inside the Colours menu: Default on a row, Save, or Cancel. Save and Cancel shut the
	 * menu and hand the keyboard back to its summary, rather than leave it on a button now hidden.
	 */
	async _onColoursClick(target) {
		const menu = target.closest(".stonetop-timeline-colours-menu");
		const reset = target.closest(".stonetop-timeline-colours-reset");
		const row = reset?.closest?.("[data-kind]");
		if (row) {
			this._coloursDraft.reset(row.dataset.kind);
			this._coloursDraft.repaintRow(row, { syncPicker: true });
			row.querySelector(".stonetop-timeline-colours-pick")?.focus?.();
			return;
		}
		if (target.closest(".stonetop-timeline-colours-save")) {
			// A write that fails keeps the draft (TimelineColoursDraft#save) and the menu open on it.
			try {
				await this._coloursDraft.save();
			} catch (err) {
				console.error("Stonetop | could not save the timeline colours", err);
				globalThis.ui?.notifications?.error?.(localize("stonetop.timeline.colours.saveFailed"));
				return;
			}
		} else if (target.closest(".stonetop-timeline-colours-cancel")) {
			this._coloursDraft.discard();
			this._coloursDraft.repaintAll(menu, { syncPicker: true });
		} else return;
		menu.open = false;
		menu.querySelector("summary")?.focus?.();
	}

	/**
	 * Repaint when a track page changes, wherever the change came from.
	 *
	 * Gated on the CHEAP discriminators first, in order. These are global hooks: every journal write
	 * at the table reaches every open timeline host, and a table with the window up and a tab on
	 * five sheets has six of these handlers. So the first test is a string compare against the
	 * parent's name, and only a page that passes it pays for `findTimelineJournal` (two collection
	 * scans) to rule out a journal of the same name outside the Chronicle folder.
	 *
	 * A single-track host then narrows to its OWN thread. Without that, every player's sheet tab
	 * rebuilds its whole view model -- read, enrich every body -- each time anyone at the table
	 * writes on a thread they are not looking at.
	 *
	 * THROTTLED: one press that writes several rows (three foes dropped by one Apply) repaints once
	 * at the end of the burst, not once per row.
	 */
	_wireSync() {
		this._unwireSync();
		const ours = (page) => page?.parent?.name === TIMELINE_JOURNAL_NAME
			&& page.parent.id === findTimelineJournal()?.id
			&& (!this.isSingleTrack || pageTrackId(page) === this._trackId);
		const repaint = (page) => { if (ours(page)) this._syncRepaint(); };

		for (const hook of ["updateJournalEntryPage", "createJournalEntryPage", "deleteJournalEntryPage"]) {
			const id = Hooks.on(hook, repaint);
			this._syncHooks.push([hook, id]);
		}

		// The world's custom tags live on the journal itself (timeline-tag-store.js), so a tag made
		// at another seat lands as a JOURNAL update: repaint for that, and only that, so the Filter
		// menu offers it and any card wearing it is named and coloured.
		// Cheapest test first, as above: almost no journal write touches this flag.
		const tagsChanged = (journal, changes) => {
			if (!foundry.utils.hasProperty(changes ?? {}, `flags.${SYSTEM_ID}.${TIMELINE_TAGS_FLAG}`)) return;
			if (journal?.id === findTimelineJournal()?.id) this._syncRepaint();
		};
		this._syncHooks.push(["updateJournalEntry", Hooks.on("updateJournalEntry", tagsChanged)]);

		// The GM saving the Ages (timeline/timeline-ages.js): the strip is redrawn from the world's list.
		this._syncHooks.push([AGES_CHANGED_HOOK, Hooks.on(AGES_CHANGED_HOOK, () => this._syncRepaint())]);

		// The GM renaming the years (seasons/campaign-year.js): every heading and chip says a new name.
		this._syncHooks.push([START_YEAR_CHANGED_HOOK, Hooks.on(START_YEAR_CHANGED_HOOK, () => this._syncRepaint())]);
	}

	/**
	 * The repaint a write at the table owes, unless the GM has a colour picker from the Colours menu
	 * in hand: the repaint would replace the `<input type=color>` and shut the native picker under
	 * them. Held until the picker commits or loses the focus (_releaseHeldRepaint).
	 */
	_syncRepaint() {
		if (!this.rendered) return;
		const active = globalThis.document?.activeElement;
		if (active?.classList?.contains("stonetop-timeline-colours-pick") && this.element?.[0]?.contains?.(active)) {
			this._repaintHeld = true;
			return;
		}
		this.renderThrottled();
	}

	_releaseHeldRepaint() {
		if (!this._repaintHeld) return;
		this._repaintHeld = false;
		if (this.rendered) this.renderThrottled();
	}

	_unwireSync() {
		for (const [hook, id] of this._syncHooks) Hooks.off(hook, id);
		this._syncHooks = [];
	}

	async close(options) {
		// ⚠ BEFORE the super call, and unconditionally: the global journal hooks left on would
		// fire on every journal write at the table for the rest of the session, once per window
		// anybody ever opened. (A repaint still pending from the last burst is StonetopDialog's.)
		this._unwireSync();
		this._unwireDragScroll?.();
		this._unwireDragScroll = null;
		this._unwireWheelZoom?.();
		this._unwireWheelZoom = null;
		this._unwireScrubber?.();
		this._unwireScrubber = null;
		this._unwireAgeBands?.();
		this._unwireAgeBands = null;
		this._unwireToolbarWrap?.();
		this._unwireToolbarWrap = null;
		this._unwireShowMenuDismiss?.();
		this._unwireColoursMenuDismiss?.();
		this._unwireColoursSkinWatch?.();
		return super.close(options);
	}
}

/** Open the aggregate, or bring the open one to the front. Nothing while the world has it off. */
export function openTimelineWindow() {
	if (refuseHiddenFeature("timeline")) return null;
	return openOrFocus(TIMELINE_WINDOW_ID, () => new TimelineWindow().render(true));
}

/**
 * The aggregate a reload brings back, from the key it was saved under (TimelineWindow#restoreKey), or
 * null for any other key. Anyone may open the aggregate, so there is nothing else to ask.
 *
 * Handed back unrendered, since utils/window-restore.js draws it where it was left. Minted through
 * openOrFocus all the same, so the window opened by hand in the moment before the restore draws it is
 * this one rather than a second frame on the same id.
 */
export function reopenTimelineWindow(key) {
	if (key !== AGGREGATE_RESTORE_KEY || !isTimelineShown()) return null;
	return openOrFocus(TIMELINE_WINDOW_ID, () => new TimelineWindow());
}

/** Registered once, at module scope in stonetop.js. */
export function registerTimelineWindowRestore() {
	registerRestorableWindow(TimelineWindow, RESTORE_KIND, reopenTimelineWindow);
}
