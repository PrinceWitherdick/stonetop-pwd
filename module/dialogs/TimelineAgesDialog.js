// THE GM NAMING THE AGES: a row per Age (its name, the years it runs between, its colour) and a way
// to add one. Opened from the timeline toolbar's Ages button, or by pressing an Age's band.
//
// The rows are a DRAFT kept on the window until Save, so a press of Add or Delete can redraw the
// window without losing anything typed, and Cancel leaves the world as it was. Save writes the whole
// list at once (settings.js#setTimelineAges); every open timeline at the table repaints from the
// setting's onChange.
//
// The year fields show the years as the world CALLS them ("1247") and are read back as stored years
// (season-picker.js#readYearField), so a GM types the years they know and a later Set the Year moves
// every Age with the rest of the record.
//
// The draft keeps up with the table while it is open: a Set the Year re-expresses its years in the
// new start (else Save would read "1240" against the wrong start and move every Age), and an Age
// another GM saves meanwhile joins it (else this Save, writing the whole list, would delete it).

import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { themedDialogClasses } from "../utils/window-theme.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { localize } from "../utils/i18n.js";
import {
	START_YEAR_CHANGED_HOOK, displayYear, startYear, storedYear, typedYear,
} from "../seasons/campaign-year.js";
import { HISTORY_YEAR_BOUNDS, clampYear } from "../seasons/season-picker.js";
import {
	getTimelineAgeColourSeq, getTimelineAges, setTimelineAgeColourSeq, setTimelineAges,
} from "../settings.js";
import { AGES_CHANGED_HOOK, AGE_NAME_MAX, cleanAgeName, nextAgeColour } from "../timeline/timeline-ages.js";
import { customTagStyle } from "../timeline/timeline-tags.js";
import { normalizeHex } from "../relmap/relmap-ink.js";
import { timelineNow } from "../timeline/timeline-record.js";

/** The window's DOM id: one Ages editor at a time. */
export const TIMELINE_AGES_DIALOG_ID = "stonetop-timeline-ages";

/** One stored Age as a draft row: years as the TEXT the fields hold, so a half-typed year is kept. */
function draftRow(age) {
	return {
		id: age.id,
		name: age.name,
		fromText: String(displayYear(age.from)),
		toText: age.to === null ? "" : String(displayYear(age.to)),
		colour: age.colour,
	};
}

/**
 * A draft row as an Age to store, or a reason it cannot be: "name" or "from". Pure, so the tests
 * drive it. `to` left blank is an Age still running.
 */
export function readDraftRow(row, start = startYear()) {
	const name = cleanAgeName(row?.name);
	if (!name) return { error: "name" };
	const fromTyped = typedYear(row?.fromText);
	if (fromTyped === null) return { error: "from" };
	const from = clampYear(storedYear(fromTyped, start), 1, HISTORY_YEAR_BOUNDS);
	const toTyped = typedYear(row?.toText);
	const to = toTyped === null ? null : clampYear(storedYear(toTyped, start), from, HISTORY_YEAR_BOUNDS);
	return { age: { id: row.id, name, from, to, colour: normalizeHex(row.colour) || "#705409" } };
}

/**
 * Where a NEW Age opens: the year after the latest Age that has ended, else the clock's year. A
 * GM naming Ages in order (the First Age, the Second) gets each one starting where the last stopped.
 */
export function suggestedStart(rows, nowYear) {
	const ends = rows.map(row => readDraftRow(row).age?.to).filter(Number.isFinite);
	return ends.length ? Math.max(...ends) + 1 : nowYear;
}

/**
 * The draft's year fields re-expressed for a new start year, so each still names the stored year it
 * did. Text that is no year (half typed, or empty) is kept as it is. Pure.
 */
export function restartDraft(rows, oldStart, newStart) {
	const shift = text => {
		const typed = typedYear(text);
		return typed === null ? text : String(displayYear(storedYear(typed, oldStart), newStart));
	};
	return rows.map(row => ({ ...row, fromText: shift(row.fromText), toText: shift(row.toText) }));
}

/**
 * The stored Ages this draft has never seen (saved by another GM since it opened), as draft rows to
 * add. `known` = every id the draft has held, so an Age this GM deleted is not brought back. Pure.
 */
export function unseenAges(ages, known) {
	return ages.filter(age => !known.has(age.id)).map(draftRow);
}

export class TimelineAgesDialog extends StonetopDialog {
	/**
	 * @param {object} [opts]
	 * @param {string} [opts.focus]  An Age's id: the row to open on (its band was pressed).
	 */
	constructor({ focus = "" } = {}, options = {}) {
		super(options);
		this._rows = getTimelineAges().map(draftRow);
		// The start year the draft's year text is written in, and every id it has held.
		this._start = startYear();
		this._known = new Set(this._rows.map(row => row.id));
		this._hooks = [
			[START_YEAR_CHANGED_HOOK, globalThis.Hooks?.on?.(START_YEAR_CHANGED_HOOK, () => this._onStartYear())],
			[AGES_CHANGED_HOOK, globalThis.Hooks?.on?.(AGES_CHANGED_HOOK, () => this._onAgesChanged())],
		].filter(([, id]) => id !== undefined);
		// Where the colour walk stands for THIS draft: moved on by each Add, written on Save.
		this._seq = getTimelineAgeColourSeq();
		this._focusId = focus;
		// The rows a Save refused, marked until they are put right.
		this._invalid = new Set();
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: TIMELINE_AGES_DIALOG_ID,
			template: "systems/stonetop-pwd/templates/dialogs/timeline-ages.hbs",
			width: 560,
			height: "auto",
			resizable: true,
			classes: [...themedDialogClasses(), "stonetop", "stonetop-timeline-ages-dialog"],
		});
	}

	get title() { return localize("stonetop.timeline.ages.title"); }

	get _autoHeight() { return true; }

	get _keptScrollSelector() { return ".stonetop-timeline-ages-list"; }

	get _focusKeyAttribute() { return "data-ages-focus"; }

	getData() {
		return {
			rows: this._rows.map(row => ({
				...row,
				style: customTagStyle(row.colour),
				invalid: this._invalid.has(row.id),
			})),
			nameMax: AGE_NAME_MAX,
			minYear: displayYear(HISTORY_YEAR_BOUNDS.min),
			maxYear: displayYear(HISTORY_YEAR_BOUNDS.max),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		if (!root) return;

		// Every keystroke into the draft, so Add and Delete can redraw without losing it. The colour
		// repaints its own sample by hand: a redraw would shut the native picker under the GM's hand.
		root.addEventListener("input", ev => {
			const field = ev.target;
			const row = this._rowOf(field);
			if (!row) return;
			if (field.matches(".stonetop-timeline-ages-name")) row.name = field.value;
			else if (field.matches(".stonetop-timeline-ages-from")) row.fromText = field.value;
			else if (field.matches(".stonetop-timeline-ages-to")) row.toText = field.value;
			else if (field.matches(".stonetop-timeline-ages-colour")) {
				row.colour = normalizeHex(field.value) || row.colour;
				const sample = field.closest("[data-age-id]")?.querySelector(".stonetop-timeline-ages-sample");
				sample?.setAttribute("style", customTagStyle(row.colour));
			}
			if (this._invalid.delete(row.id)) field.closest("[data-age-id]")?.classList.remove("is-invalid");
		});

		root.addEventListener("click", ev => {
			const target = ev.target;
			if (target.closest(".stonetop-timeline-ages-add")) return this._onAdd();
			const remove = target.closest(".stonetop-timeline-ages-remove");
			if (remove) return this._onRemove(remove.closest("[data-age-id]")?.dataset.ageId);
		});

		root.querySelector(".stonetop-timeline-ages-save")
			?.addEventListener("click", ev => this._guardBusy(ev, () => this._save()));
		root.querySelector(".stonetop-timeline-ages-cancel")
			?.addEventListener("click", () => this.close());
	}

	/**
	 * The row asked for (a band pressed, a row just added), once, brought into view with its name in
	 * hand. After the base puts the reader's place back, or the Add button would take the keyboard
	 * straight back.
	 */
	_restorePlace(place) {
		super._restorePlace(place);
		if (!this._focusId) return;
		const row = this.element?.[0]?.querySelector?.(`[data-age-id="${CSS.escape(this._focusId)}"]`);
		this._focusId = "";
		row?.scrollIntoView?.({ block: "nearest" });
		row?.querySelector(".stonetop-timeline-ages-name")?.focus?.();
	}

	/** Open on another Age's row, for a band pressed while the window is already up. */
	focusAge(id) {
		this._focusId = id || "";
		this.render(false);
	}

	async close(options = {}) {
		for (const [name, id] of this._hooks.splice(0)) globalThis.Hooks?.off?.(name, id);
		return super.close(options);
	}

	_onStartYear() {
		const start = startYear();
		if (start === this._start) return;
		this._rows = restartDraft(this._rows, this._start, start);
		this._start = start;
		if (this.rendered) this.render(false);
	}

	_onAgesChanged() {
		const added = unseenAges(getTimelineAges(), this._known);
		if (!added.length) return;
		for (const row of added) this._known.add(row.id);
		this._rows.push(...added);
		if (this.rendered) this.render(false);
	}

	_rowOf(field) {
		const id = field?.closest?.("[data-age-id]")?.dataset?.ageId;
		return id ? this._rows.find(row => row.id === id) : null;
	}

	/** A new row, opening where the last Age stopped, in a colour no Age has worn. */
	_onAdd() {
		const start = suggestedStart(this._rows, timelineNow().year);
		const { hex, seq } = nextAgeColour({ seq: this._seq, inUse: this._rows.map(row => row.colour) });
		this._seq = seq;
		const id = foundry.utils.randomID();
		this._known.add(id);
		this._rows.push({ id, name: "", fromText: String(displayYear(start)), toText: "", colour: hex });
		this._focusId = id;
		this.render(false);
	}

	_onRemove(id) {
		if (!id) return;
		this._rows = this._rows.filter(row => row.id !== id);
		this._invalid.delete(id);
		this.render(false);
	}

	/**
	 * Write the draft, whole. A row with no name or no first year is refused rather than dropped: it
	 * is marked, the GM is told, and nothing is written until it is put right or deleted.
	 */
	async _save() {
		const read = this._rows.map(row => ({ row, ...readDraftRow(row, this._start) }));
		const bad = read.filter(r => r.error);
		if (bad.length) {
			this._invalid = new Set(bad.map(r => r.row.id));
			globalThis.ui?.notifications?.warn?.(localize(`stonetop.timeline.ages.invalid.${bad[0].error}`));
			this.render(false);
			return;
		}
		try {
			await setTimelineAges(read.map(r => r.age));
			await setTimelineAgeColourSeq(this._seq);
		} catch (err) {
			console.error("Stonetop | could not save the timeline's Ages", err);
			globalThis.ui?.notifications?.error?.(localize("stonetop.timeline.ages.saveFailed"));
			return;
		}
		return this._resolveWith(true);
	}
}

/** Open the GM's Ages editor, or bring it forward on the Age asked for. GM only: the Ages are a world setting. */
export function openTimelineAgesDialog({ focus = "" } = {}) {
	if (!game.user?.isGM) return null;
	const app = openOrFocus(TIMELINE_AGES_DIALOG_ID, () => new TimelineAgesDialog({ focus }).render(true));
	if (focus && app instanceof TimelineAgesDialog && app.rendered) app.focusAge(focus);
	return app;
}
