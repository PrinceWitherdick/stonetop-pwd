// WRITING DOWN ONE THING THAT HAPPENED.
//
// A RESULT DIALOG and nothing else: it collects a date, a title, a place and an account, and
// resolves them. It does not know where entries are stored, which track it is writing to, or
// whether this is a new entry or an edit of an old one -- the panel that opened it holds all of
// that and does the write. One writer for a track's entries is what keeps the add path and the
// edit path from drifting, and it is the same split the custom-move and improvement dialogs make
// with their savers.
//
// A TYPED ROW MAY WEAR ONE TAG: a kind's chip borrowed, or a tag of the table's own, which can be
// made here, named and coloured, without leaving the dialog (timeline-tags.js). A milestone row's
// kind IS its tag, so editing one offers no choice.
//
// THE DATE PICKER IS THE SEASONS CHANGE PICKER, reused rather than rebuilt: the same four cards and
// the same year field the GM already meets when the season turns, so "when did this happen" is
// asked in the shape the table already reads. Its markup and its year field come from
// season-picker.js; the only thing done differently here is that a card SELECTS rather than
// commits, because the answer is not final until the entry is saved.
//
// AND THE TABLE'S HISTORY: unlike the clock, a timeline holds years from before play ("the Forest
// Folk vanished ten years ago"), so this picker alone goes below the first year of play, offers a
// fifth card for a year whose season nobody remembers, and lets the year be given as "years ago".

import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { HISTORY_YEAR_BOUNDS, seasonPickerHtml, wireSeasonPicker, clampYear, readYearField } from "../seasons/season-picker.js";
import { SEASON_IDS } from "../seasons/seasons-change-reminders.js";
import { placeSuggestions } from "../timeline/timeline-places.js";
import { wireDocumentDropZone } from "../utils/card-drop-zone.js";
import { StonetopAutocomplete } from "../utils/autocomplete.js";
import { localize } from "../utils/i18n.js";
import { TIMELINE_KILLS_SOURCE, foesToLines, linesToFoes } from "../timeline/timeline-core.js";
import { TIMELINE_COLOUR_KINDS } from "../timeline/timeline-colours.js";
import { customTagChip, kindChip } from "../timeline/timeline-view.js";
import { DEFAULT_TAG_COLOUR, TAG_NAME_MAX, liveTag } from "../timeline/timeline-tags.js";
import { createCustomTag, worldCustomTags } from "../timeline/timeline-tag-store.js";
import { renderTemplate } from "../utils/foundry-compat.js";

/** One chip in the Tag row: the template's own partial, so a tag made after render matches the rest. */
const TAG_CHIP_TEMPLATE = "systems/stonetop-pwd/templates/dialogs/partials/timeline-entry-tag.hbs";

export class TimelineEntryDialog extends StonetopDialog {
	/**
	 * @param {object}  [opts]
	 * @param {object}  [opts.entry]        The entry being edited; null to write a new one.
	 * @param {string}  [opts.season]       The season a NEW entry opens on (the campaign clock's).
	 * @param {number}  [opts.year]         The year a new entry opens on, and what "years ago" counts
	 *                                      back from (the clock's, stored).
	 * @param {number}  [opts.nowYear]      The clock's stored year, when it is not `year` (an edit).
	 * @param {string}  [opts.trackName]    Whose thread this is, for the window title.
	 */
	constructor({ entry = null, season = "", year = 1, nowYear = year, trackName = "" } = {}, options = {}) {
		super(options);
		this._entry = entry;
		this._trackName = trackName;
		// The chosen date lives on the instance rather than in the DOM, because the season is
		// chosen by clicking a card and there is no form control holding that answer. The year IS
		// a field, and is read back off the form at save time by the picker's own reader.
		this._season = SEASON_IDS.includes(entry?.season) ? entry.season
			: (SEASON_IDS.includes(season) ? season : "");
		this._year = clampYear(entry?.year ?? year, 1, HISTORY_YEAR_BOUNDS);
		// "Some time that year": the fifth card. Only a blank season can be it.
		this._yearOnly = !this._season && entry?.yearOnly === true;
		this._nowYear = clampYear(nowYear, 1);
		// The document the place IS, when one was dropped on the field. On the instance for the
		// same reason the season is: there is no form control holding it, and the field beside it
		// holds only the NAME. Cleared the moment that name is edited by hand -- see the input
		// listener below for why that is the honest rule rather than a lossy one.
		this._placeUuid = String(entry?.placeUuid ?? "").trim();
		// A KILLS row's foes, as the text the Slain field opens with. Kept so `_save` can tell an
		// edited list from an untouched one -- see there for why that matters.
		this._isKills = entry?.source === TIMELINE_KILLS_SOURCE;
		this._foesText = this._isKills ? foesToLines(entry?.foes ?? []) : "";
		// The tag, for a TYPED row only. On the instance like the season: it is chosen by pressing a
		// chip, and a tag made in this dialog is added to the row of chips by hand rather than by a
		// re-render that would throw away everything typed. A custom tag the world has since lost
		// opens as no tag, which is how the card already reads it.
		this._showTags = !entry || (entry.source ?? "hand") === "hand";
		this._tag = this._showTags ? liveTag(entry, worldCustomTags()) : "";
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
				unknownCard: true,
				unknownSelected: this._yearOnly,
				minYear:   HISTORY_YEAR_BOUNDS.min,
				maxYear:   HISTORY_YEAR_BOUNDS.max,
				agoFrom:   this._nowYear,
			}),
			entryTitle: this._entry?.title ?? "",
			place:      this._entry?.place ?? "",
			placeLinked: !!this._placeUuid,
			body:       this._entry?.body ?? "",
			places:     placeSuggestions(),
			isKills:    this._isKills,
			foesText:   this._foesText,
			showTags:   this._showTags,
			tagOptions: this._showTags ? this._tagOptions() : [],
			tagNameMax: TAG_NAME_MAX,
			tagColour:  DEFAULT_TAG_COLOUR,
		};
	}

	/**
	 * Every tag a typed row may wear, as chips: none, then each kind the system records (its own
	 * chip and colour), then the world's own tags by name.
	 */
	_tagOptions() {
		const none = { id: "", kind: "none", icon: "fa-minus", label: localize("stonetop.timeline.dialog.tagNone"), style: "" };
		const kinds = TIMELINE_COLOUR_KINDS.map(kind => ({ id: kind, ...kindChip(kind) }));
		const custom = worldCustomTags().map(tag => customTagOption(tag));
		return [none, ...kinds, ...custom].map(option => ({ ...option, selected: option.id === this._tag }));
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
			latestYear: Math.max(this._year, this._nowYear),
			minYear:   HISTORY_YEAR_BOUNDS.min,
			maxYear:   HISTORY_YEAR_BOUNDS.max,
			agoFrom:   this._nowYear,
			onPick: (season, year) => {
				// The "Season unknown" card picks a blank season, which here means the year alone.
				this._season = season;
				this._yearOnly = !season;
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
		this._wireTags(root);

		root.querySelector(".stonetop-timeline-entry-save")
			?.addEventListener("click", ev => this._guardBusy(ev, () => this._save(root)));
		root.querySelector(".stonetop-timeline-entry-cancel")
			?.addEventListener("click", () => this.close());
	}

	/**
	 * The tag chips and the New tag form.
	 *
	 * Pressing a chip marks it and unmarks the rest by hand, for the reason the season cards are
	 * marked by hand: a re-render would throw away the title and account already typed. A tag made
	 * here is written to the world AT ONCE (every thread offers the same list) and then pressed, so
	 * the reader goes straight back to writing.
	 */
	_wireTags(root) {
		const row = root.querySelector(".stonetop-timeline-entry-tags");
		const form = root.querySelector(".stonetop-timeline-entry-tag-form");
		const opener = root.querySelector(".stonetop-timeline-entry-tag-new");
		if (!row) return;

		const press = (id) => {
			this._tag = id;
			for (const chip of row.querySelectorAll("[data-tag]")) {
				chip.setAttribute("aria-pressed", String(chip.dataset.tag === id));
			}
		};
		row.addEventListener("click", ev => {
			const chip = ev.target.closest?.("[data-tag]");
			if (chip) press(chip.dataset.tag);
		});

		if (!form || !opener) return;
		const name = form.querySelector(".stonetop-timeline-entry-tag-name");
		const colour = form.querySelector(".stonetop-timeline-entry-tag-colour");

		const showForm = (open) => {
			form.hidden = !open;
			opener.setAttribute("aria-expanded", String(open));
			this.setPosition({ height: "auto" });
			if (open) name?.focus();
		};
		opener.addEventListener("click", () => showForm(form.hidden));

		const make = async () => {
			if (!name?.value.trim()) return name?.focus();
			// A write the server refuses (the journal gone, or ownership changed under the reader) is
			// said as the journal refusal it is, rather than escaping as an unhandled rejection.
			const made = await createCustomTag({ name: name.value, colour: colour?.value }).catch(err => {
				console.error("Stonetop | the new timeline tag was not written", err);
				return { tag: null, reason: "journal" };
			});
			if (!made.tag) {
				ui.notifications?.warn(localize(`stonetop.timeline.dialog.tagRefused.${made.reason}`));
				return;
			}
			// A name the world already had answers with that tag: press it rather than add a twin.
			if (![...row.querySelectorAll("[data-tag]")].some(chip => chip.dataset.tag === made.tag.id)) {
				opener.insertAdjacentHTML("beforebegin", await renderTemplate(TAG_CHIP_TEMPLATE, customTagOption(made.tag)));
			}
			press(made.tag.id);
			name.value = "";
			showForm(false);
		};
		// A latch of its own rather than `_guardBusy`, which leaves its control disabled on success
		// because its callers close or re-render. This dialog stays open, and the Add button is
		// wanted again for the next tag.
		let making = false;
		const run = async () => {
			if (making) return;
			making = true;
			try { await make(); } finally { making = false; }
		};
		form.querySelector(".stonetop-timeline-entry-tag-add")?.addEventListener("click", run);
		// Enter in the name field makes the tag. The form has no submit, and Enter must not reach it.
		name?.addEventListener("keydown", ev => {
			if (ev.key !== "Enter") return;
			ev.preventDefault();
			run();
		});
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
		return field ? readYearField(field, this._year, HISTORY_YEAR_BOUNDS) : this._year;
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
		// A kills row is worth saving with every text field blank: its foes are the content.
		if (!title && !place && !body && !this._isKills) return this.close();

		const result = {
			season: this._season,
			year:   this._readYear(root),
			// Always sent, so an edit that gives a year-only row a season (or takes it away) lands.
			yearOnly: !this._season && this._yearOnly,
			title,
			place,
			// Dropped, never typed. An emptied field takes its link with it: a claim about a name
			// that is no longer there is not a claim worth keeping.
			placeUuid: place ? this._placeUuid : "",
			body,
		};
		// Only a typed row carries a tag; a milestone's dialog never offered one, so it sends none.
		if (this._showTags) result.tag = this._tag;

		// ⚠ THE FOES GO BACK ONLY IF THE SLAIN FIELD WAS EDITED. The GM's client appends to this row
		// whenever a foe drops, and a player can have this dialog open across a whole fight. Sending
		// back the list the dialog OPENED with would quietly delete every kill made since.
		if (this._isKills) {
			const text = StonetopDialog.readValue(root, ".stonetop-timeline-entry-foes");
			if (text.trim() !== this._foesText.trim()) result.foes = linesToFoes(text);
		}
		return this._resolveWith(result);
	}
}

/** One custom tag as a chip in the dialog's row. */
function customTagOption(tag) {
	return { id: tag.id, ...customTagChip(tag) };
}

/**
 * Ask for one entry. Resolves with `{season, year, title, place, placeUuid, body}` (plus `foes` when
 * a kills row's Slain field was edited, and `tag` for a typed row), or null if the reader backed out.
 *
 * The one door in, so no caller stands the dialog up itself and quietly forgets to await it.
 */
export function promptForTimelineEntry(opts = {}, options = {}) {
	return new TimelineEntryDialog(opts, options).promise();
}
