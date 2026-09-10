// THE TIMELINE, OPEN.
//
// ONE CLASS, TWO SHAPES, and the whole of the difference between them is how many tracks it is
// handed. Given one track it draws that thread down a spine, which is what a sheet tab shows.
// Given all of them it draws one row per season with a lane per thread, which is the aggregate.
// Not two implementations: the same getData, the same listeners, the same writes, the same live
// sync. The tab is a third shape of the same thing again -- see TimelinePanel, which is this class
// mounted frameless, exactly as the relationship map's panel is its window.
//
// WHAT THIS FILE IS CAREFUL ABOUT:
//
//  • ONE WRITER. Every change to a track's entries goes through `_mutate` below, which reads the
//    page, runs one of timeline-core's pure mutators, and writes the whole array back. The entry
//    dialog collects input and knows nothing about storage, so the add path and the edit path
//    cannot drift.
//  • A LIVE UPDATE RE-RENDERS, and that is safe here in a way it is not on the relationship map:
//    there is no zoom or pan to throw away, and AppV1's `scrollY` puts the reader back where they
//    were. What it must NOT do is re-render while the reader is mid-edit in the entry dialog, and
//    it does not have to guard that: the dialog is a separate window holding its own state.
//  • THE HOOK COMES OFF ON CLOSE. It is a global journal hook, and a window closed without taking
//    it off leaves it firing on every journal write at the table for the rest of the session.

import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { themedDialogClasses } from "../utils/window-theme.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { openingSize } from "../utils/opening-size.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { seasonStampParts } from "../seasons/current-season.js";
import { localize, format } from "../utils/i18n.js";
import { promptForTimelineEntry } from "./TimelineEntryDialog.js";
import { pickContentOption } from "./content-picker.js";
import { bringDialogToFront } from "../utils/front-on-open.js";
import { escHtml } from "../utils/strings.js";
import {
	TIMELINE_JOURNAL_NAME, allTracks, findTimelineJournal, mutateTrack, readTrack, trackDisplayName,
	trackForActor,
} from "../timeline/timeline-store.js";
import {
	addEntry, isDerivedEntryId, moveEntry, patchEntry, removeEntry, sortEntries, trackIdFromKey,
} from "../timeline/timeline-core.js";
import { autoRowsForTrack } from "../timeline/timeline-auto-rows.js";
import { SYSTEM_ID } from "../system-id.js";
import { readSeasonLog } from "../timeline/timeline-seasons.js";
import { getTimelineAutoRows, setTimelineAutoRows } from "../settings.js";
import { buildAggregateVM, buildTrackVM, enrichTrackVM } from "../timeline/timeline-view.js";

/** The aggregate window's DOM id, so a second open focuses the first. */
export const TIMELINE_WINDOW_ID = "stonetop-timeline-window";

export class TimelineWindow extends StonetopDialog {
	/**
	 * ⚠ A TRACK DESCRIPTOR EXACTLY AS `trackForActor` HANDS ONE BACK, keys and all. The tab passes
	 * the store's answer straight through (timeline-tab.js → TimelinePanel → here), and
	 * `_trackDescriptor` below hands the same shape back OUT to `ensureTrackPage`. A key renamed on
	 * the way in reads as `""` and fails silently twice over: the title and the entry dialog lose
	 * the thread's name, and the first entry written on a track with no page yet mints one titled
	 * with the raw actor id, which nothing renames afterwards.
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
			// The spine is what scrolls, so a repaint after somebody else's entry lands puts the
			// reader back where they were rather than at the top of the campaign.
			scrollY: [".stonetop-timeline-scroll"],
		});
	}

	get title() {
		return this._trackId
			? format("stonetop.timeline.trackTitle", { name: this._trackName })
			: localize("stonetop.timeline.windowTitle");
	}

	/** Single-track mode, as against the aggregate. */
	get isSingleTrack() { return !!this._trackId; }

	// ── reading ────────────────────────────────────────────────────────────────

	/**
	 * Is this id one of the derived ledger rows rather than a stored entry?
	 *
	 * ⚠ EVERY WRITE PATH ASKS THIS FIRST. A ledger row is a view of another record: it has no
	 * stored counterpart to patch, and `patchEntry` against an id that is not in the array answers
	 * `changed: null` and writes nothing -- which is the right outcome reached for the wrong reason,
	 * and would start writing the moment somebody merged these rows into the page. The cards carry
	 * no controls, so this is a second guard behind a first; it is here because the cost of being
	 * wrong is a silent write against the wrong record.
	 */
	_isDerived(entryId) {
		return isDerivedEntryId(entryId);
	}

	/** Does this reader want what the system recorded folded in? Per client, off by default. */
	get _showAutoRows() { return getTimelineAutoRows(); }

	/**
	 * One track's entries, with the derived rows folded in when this reader wants them.
	 *
	 * Merged at READ time and never stored, which is what makes the toggle free: turning it off is
	 * a re-render, not an unpicking of anything written. The log comes from the steading, which is
	 * resolved once per call rather than per track -- it is an unindexed `game.actors` scan.
	 */
	_withAutoRows(track, log) {
		if (!this._showAutoRows) return track;
		const rows = autoRowsForTrack(track, log);
		if (!rows.length) return track;
		return { ...track, entries: sortEntries([...track.entries, ...rows]) };
	}

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
		const steading = getStonetopSteadingActor();
		const log = readSeasonLog(steading);
		const tracks = this._tracks().map(track => this._withAutoRows(track, log));

		const single = this.isSingleTrack;
		const vm = single
			? buildTrackVM(tracks[0], { canEdit: this._canEdit(this._trackId) })
			: buildAggregateVM(tracks, { canEdit: (id) => this._canEdit(id) });

		// Enriched after the model is built rather than inside it, and by the shared walker rather
		// than here: the view model is pure so the three hosts can share it, and enrichment is async
		// and Foundry-only. Both shapes are walked the same way because the cards are the same
		// objects either way.
		await enrichTrackVM(vm);

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
			autoRows: this._showAutoRows,
			autoRowsLabel: localize(this._showAutoRows
				? "stonetop.timeline.auto.hide"
				: "stonetop.timeline.auto.show"),
		};
	}

	// ── writing ────────────────────────────────────────────────────────────────

	/**
	 * The ONE write path. Reads a track's page, runs a pure mutator over its entries, and writes
	 * the whole array back if anything moved.
	 *
	 * `mutate` returns timeline-core's own `{entries, added|removed|changed|moved}` shape, and a
	 * null result means nothing moved -- so a no-op write, which would re-render every open sheet
	 * and every other client's window to no effect, is skipped here rather than at each call site.
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
	 * ⚠ THE NAME IS RESOLVED, not just passed on. A page is minted ONCE and nothing renames it
	 * afterwards, so a blank name here is a thread permanently titled with its raw actor id --
	 * `trackDisplayName` answers off the live actor and is what the rest of the system titles a
	 * thread by, which makes the two agree even if this window was opened without a name.
	 */
	_trackDescriptor(trackId) {
		if (trackId === this._trackId) {
			return { trackId, trackKind: this._trackKind, name: this._trackName || trackDisplayName(trackId) };
		}
		const actor = game.actors?.get(trackId);
		return trackForActor(actor) ?? { trackId, trackKind: "", name: trackId };
	}

	/** The date a new entry opens on: whatever season the campaign clock is actually in. */
	_currentStamp() {
		const { seasonId, year } = seasonStampParts(getStonetopSteadingActor());
		return { season: seasonId, year };
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
		const stamp = this._currentStamp();
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
		if (this._isDerived(entryId)) return;
		const entry = readTrack(trackId).entries.find(e => e.id === entryId);
		if (!entry) return;
		const input = await promptForTimelineEntry({ entry, trackName: this._trackNameFor(trackId) });
		if (!input) return;
		await this._mutate(trackId, entries => patchEntry(entries, entryId, input));
	}

	async _onRemoveEntry(trackId, entryId) {
		if (this._isDerived(entryId)) return;
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
		if (this._isDerived(entryId)) return;
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

	/** The track a changed page belongs to, for the sync gate. Reads the key, writes nothing. */
	_pageTrackId(page) {
		return trackIdFromKey(page?.getFlag?.(SYSTEM_ID, "chronicleKey")) || page?.system?.trackId || "";
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

			const auto = target.closest?.(".stonetop-timeline-auto-toggle");
			if (auto) {
				// Client-scoped, so this never reaches anybody else at the table. The re-render is
				// the whole of the work: the rows are derived, so nothing is written or unpicked.
				await setTimelineAutoRows(!this._showAutoRows);
				return this.render(false);
			}

			const card = target.closest?.("[data-entry-id]");
			const trackId = target.closest?.("[data-track-id]")?.dataset?.trackId || this._trackId;
			if (!card || !trackId) return;
			const entryId = card.dataset.entryId;

			if (target.closest(".stonetop-timeline-edit"))   return this._onEditEntry(trackId, entryId);
			if (target.closest(".stonetop-timeline-remove")) return this._onRemoveEntry(trackId, entryId);
			const move = target.closest(".stonetop-timeline-move");
			if (move) return this._onMoveEntry(trackId, entryId, Number(move.dataset.delta));
		});

		this._wireSync();
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
	 * rebuilds its whole view model -- read, merge the ledger, enrich every body -- each time anyone
	 * at the table writes on a thread they are not looking at.
	 */
	_wireSync() {
		this._unwireSync();
		const ours = (page) => page?.parent?.name === TIMELINE_JOURNAL_NAME
			&& page.parent.id === findTimelineJournal()?.id
			&& (!this.isSingleTrack || this._pageTrackId(page) === this._trackId);
		const repaint = (page) => { if (ours(page) && this.rendered) this.render(false); };

		for (const hook of ["updateJournalEntryPage", "createJournalEntryPage", "deleteJournalEntryPage"]) {
			const id = Hooks.on(hook, repaint);
			this._syncHooks.push([hook, id]);
		}
	}

	_unwireSync() {
		for (const [hook, id] of this._syncHooks) Hooks.off(hook, id);
		this._syncHooks = [];
	}

	async close(options) {
		// ⚠ BEFORE the super call, and unconditionally: three global journal hooks left on would
		// fire on every journal write at the table for the rest of the session, once per window
		// anybody ever opened.
		this._unwireSync();
		return super.close(options);
	}
}

/** Open the aggregate, or bring the open one to the front. */
export function openTimelineWindow() {
	return openOrFocus(TIMELINE_WINDOW_ID, () => new TimelineWindow().render(true));
}
