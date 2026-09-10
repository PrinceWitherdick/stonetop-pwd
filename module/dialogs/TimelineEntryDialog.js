// WRITING DOWN ONE THING THAT HAPPENED.
//
// A RESULT DIALOG and nothing else: it collects a date, a title, a place and an account, and
// resolves them. It does not know where entries are stored, which track it is writing to, or
// whether this is a new entry or an edit of an old one -- the panel that opened it holds all of
// that and does the write. One writer for a track's entries is what keeps the add path and the
// edit path from drifting, and it is the same split the custom-move and improvement dialogs make
// with their savers.
//
// THE DATE PICKER IS THE SEASONS CHANGE PICKER, reused rather than rebuilt: the same four cards and
// the same year field the GM already meets when the season turns, so "when did this happen" is
// asked in the shape the table already reads. Its markup and its year field come from
// season-picker.js; the only thing done differently here is that a card SELECTS rather than
// commits, because the answer is not final until the entry is saved.

import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { seasonPickerHtml, wireSeasonPicker, clampYear } from "../seasons/season-picker.js";
import { SEASON_IDS } from "../seasons/seasons-change-reminders.js";
import { placeSuggestions } from "../timeline/timeline-places.js";
import { wireDocumentDropZone } from "../utils/card-drop-zone.js";
import { StonetopAutocomplete } from "../utils/autocomplete.js";
import { localize } from "../utils/i18n.js";

export class TimelineEntryDialog extends StonetopDialog {
	/**
	 * @param {object}  [opts]
	 * @param {object}  [opts.entry]        The entry being edited; null to write a new one.
	 * @param {string}  [opts.season]       The season a NEW entry opens on (the campaign clock's).
	 * @param {number}  [opts.year]         The year a new entry opens on.
	 * @param {string}  [opts.trackName]    Whose thread this is, for the window title.
	 */
	constructor({ entry = null, season = "", year = 1, trackName = "" } = {}, options = {}) {
		super(options);
		this._entry = entry;
		this._trackName = trackName;
		// The chosen date lives on the instance rather than in the DOM, because the season is
		// chosen by clicking a card and there is no form control holding that answer. The year IS
		// a field, and is read back off the form at save time by the picker's own reader.
		this._season = SEASON_IDS.includes(entry?.season) ? entry.season
			: (SEASON_IDS.includes(season) ? season : "");
		this._year = clampYear(entry?.year ?? year, 1);
		// The document the place IS, when one was dropped on the field. On the instance for the
		// same reason the season is: there is no form control holding it, and the field beside it
		// holds only the NAME. Cleared the moment that name is edited by hand -- see the input
		// listener below for why that is the honest rule rather than a lossy one.
		this._placeUuid = String(entry?.placeUuid ?? "").trim();
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			// No fixed id: a GM correcting one entry while writing another is ordinary, and two
			// dialogs sharing a DOM id paint into each other.
			template: "systems/stonetop-pwd/templates/dialogs/timeline-entry.hbs",
			width:  520,
			height: "auto",
			resizable: false,
			classes: ["stonetop", "stonetop-timeline-entry-dialog"],
		});
	}

	/** Content-hugging: the account field is the only thing that grows, and it is capped. */
	get _autoHeight() { return true; }

	get title() {
		return localize(this._entry ? "stonetop.timeline.dialog.titleEdit" : "stonetop.timeline.dialog.titleNew");
	}

	getData() {
		return {
			isEdit: !!this._entry,
			trackName: this._trackName,
			// Built as a string by the picker rather than as a partial, which is how the Seasons
			// Change flow already renders it. `startYear` is the field's opening value AND its
			// fallback if it is somehow unreadable at save time.
			pickerHtml: seasonPickerHtml({
				prompt:    localize("stonetop.timeline.dialog.whenHint"),
				startYear: this._year,
				selected:  this._season || null,
			}),
			entryTitle: this._entry?.title ?? "",
			place:      this._entry?.place ?? "",
			placeLinked: !!this._placeUuid,
			body:       this._entry?.body ?? "",
			places:     placeSuggestions(),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];

		// The picker's own wiring gives us the year field for free. `onPick` fires on a card click,
		// and here that SELECTS rather than commits: the mark is moved by hand because the picker
		// draws it at render time only, and re-rendering to move it would throw away everything
		// typed into the fields below.
		wireSeasonPicker(root, {
			startYear: this._year,
			latestYear: this._year,
			onPick: (season, year) => {
				this._season = season;
				this._year = year;
				for (const card of root.querySelectorAll(".stonetop-season-card")) {
					const chosen = card.dataset.season === season;
					card.classList.toggle("is-selected", chosen);
					if (chosen) card.setAttribute("aria-current", "true");
					else card.removeAttribute("aria-current");
				}
			},
		});
		// The place field is a datalist input, and a bare one falls back to the browser's own
		// popup -- scrollbar-less in Chromium, which is the whole reason this helper exists. Every
		// other datalist-bearing dialog in the system upgrades it here; StonetopDialog does not do
		// it for you.
		StonetopAutocomplete.upgradeAll(html);

		this._wirePlaceDrop(root);
		this._wireBodyDrop(root);

		root.querySelector(".stonetop-timeline-entry-save")
			?.addEventListener("click", ev => this._guardBusy(ev, () => this._save(root)));
		root.querySelector(".stonetop-timeline-entry-cancel")
			?.addEventListener("click", () => this.close());
	}

	/**
	 * What was dropped on a field, as a name and a uuid.
	 *
	 * ⚠ `fromUuidSync` THROWS -- it does not answer null -- for a uuid naming a document EMBEDDED
	 * IN A COMPENDIUM, which is exactly what a JournalEntryPage out of this system's own shipped
	 * journal pack is, and so exactly what a GM is most likely to drag onto a Where field. So
	 * `{ strict: false }` is load-bearing rather than defensive, and the try/catch behind it is
	 * the belt to that brace. The sync call is still tried first because for every NON-embedded
	 * pack uuid it answers the pack index entry -- name included -- with no pack load and no await.
	 *
	 * A COMPENDIUM UUID IS KEPT HERE, unlike on the character rosters, which deliberately throw one
	 * away. Their reason does not apply: a roster row's uuid has to match a document in the world
	 * for the row to mean anything, where this one is only ever a link to follow, and a link into a
	 * compendium is a perfectly good link.
	 */
	async _resolveDropped(data) {
		const uuid = data?.uuid;
		if (!uuid) return null;

		let doc = null;
		try { doc = globalThis.fromUuidSync?.(uuid, { strict: false }) ?? null; } catch (_) { doc = null; }
		if (!doc) doc = await fromUuid(uuid).catch(() => null);
		if (!doc?.name) return null;
		return { name: doc.name, uuid };
	}

	/**
	 * Let a document be dropped on the Where field: it fills in the name and remembers what was
	 * dropped, so the card can print a real content link rather than a bare word.
	 *
	 * TYPING IN THE FIELD BREAKS THE LINK, and that is the rule rather than a limitation. The field
	 * holds a NAME; the uuid beside it is a claim that the name IS that document. Edit the name to
	 * something else and the claim is no longer true, and silently keeping it would leave an entry
	 * reading one place and linking to another. Dropping again re-links it.
	 */
	_wirePlaceDrop(root) {
		const field = root.querySelector(".stonetop-timeline-entry-place");
		const zone = field?.closest(".stonetop-timeline-entry-place-zone") ?? field;
		if (!field || !zone) return;

		const paint = () => zone.classList.toggle("is-linked", !!this._placeUuid);

		// Through the shared zone rather than three hand-written listeners: it already answers the
		// `dragover` the browser needs before it will fire a drop at all, negotiates `dropEffect`
		// against what the source allows (a source declaring "move" met by a hard-coded "copy" kills
		// the gesture silently), and clears the highlight on the `dragleave` containment test.
		wireDocumentDropZone(zone, async (data) => {
			const dropped = await this._resolveDropped(data);
			if (!dropped) return;
			field.value = dropped.name;
			this._placeUuid = dropped.uuid;
			paint();
		});

		field.addEventListener("input", () => {
			if (!this._placeUuid) return;
			this._placeUuid = "";
			paint();
		});

		paint();
	}

	/**
	 * Let a document be dropped into the account, where it becomes an `@UUID` link at the cursor.
	 *
	 * This is what makes crosslinks WRITABLE. The bodies are already enriched on the way out, so an
	 * `@UUID[...]` in one has always resolved -- but the field is a plain textarea, and nobody is
	 * going to hand-type a document id. Dropping an NPC into the middle of a sentence is how the
	 * entry ends up tying back to the rest of the world.
	 *
	 * Inserted AT THE CURSOR rather than appended, and the selection is put back after it, so a
	 * drop mid-sentence carries on where it left off.
	 */
	_wireBodyDrop(root) {
		const field = root.querySelector(".stonetop-timeline-entry-body");
		if (!field) return;

		// Same shared zone as the Where field. Its `dragleave` containment test is the part that
		// matters here: `dragleave` fires when the pointer crosses onto a child too, so the
		// hand-rolled handler this replaces flickered its highlight off mid-drag.
		wireDocumentDropZone(field, async (data) => {
			const dropped = await this._resolveDropped(data);
			if (!dropped) return;
			const link = `@UUID[${dropped.uuid}]{${dropped.name}}`;
			const at = field.selectionStart ?? field.value.length;
			const to = field.selectionEnd ?? at;
			field.value = `${field.value.slice(0, at)}${link}${field.value.slice(to)}`;
			const after = at + link.length;
			field.setSelectionRange?.(after, after);
			field.focus();
		});
	}

	/**
	 * The year as the form has it.
	 *
	 * Read off the field on the way OUT, not merely at pick time: the season picker takes the year
	 * when a card is clicked, so a reader who types a year and then saves without touching a card
	 * would otherwise have their typing quietly ignored.
	 */
	_readYear(root) {
		const field = root?.querySelector(".stonetop-season-year-input");
		return field ? clampYear(field.value, this._year) : this._year;
	}

	/**
	 * Collect the form and settle.
	 *
	 * An entry with nothing in it at all is refused by saving NOTHING rather than by an error: a
	 * reader who opened the dialog and changed their mind has pressed the wrong button, and the
	 * useful response is the one that costs them nothing.
	 */
	_save(root) {
		const title = StonetopDialog.readValue(root, ".stonetop-timeline-entry-title").trim();
		const place = StonetopDialog.readValue(root, ".stonetop-timeline-entry-place").trim();
		const body  = StonetopDialog.readValue(root, ".stonetop-timeline-entry-body").trim();
		if (!title && !place && !body) return this.close();

		return this._resolveWith({
			season: this._season,
			year:   this._readYear(root),
			title,
			place,
			// Dropped, never typed. An emptied field takes its link with it: a claim about a name
			// that is no longer there is not a claim worth keeping.
			placeUuid: place ? this._placeUuid : "",
			body,
		});
	}
}

/**
 * Ask for one entry. Resolves with `{season, year, title, place, body}`, or null if the reader
 * backed out.
 *
 * The one door in, so no caller stands the dialog up itself and quietly forgets to await it.
 */
export function promptForTimelineEntry(opts = {}, options = {}) {
	return new TimelineEntryDialog(opts, options).promise();
}
