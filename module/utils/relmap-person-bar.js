// The bar a person raises: the label under their name ("Iron Knight", "Deceased") and the tag chips
// they wear ("Dead", "Noble").
//
// THE SMALLEST OF THE THREE BARS, and it keeps the same house rules as the other two for the same
// reasons (utils/relmap-board-bar.js): it lives in the viewport and survives every repaint, it holds
// what is typed back a breath before writing it so "Acolyte of the Celebrated Seer" is one broadcast
// and one step of the undo, and it claims its keys from core.
//
// IT SITS WHERE THE LABEL DOES, under the name. The reader clicked the words (or the "Add a label"
// ghost) to get here, so that is where the field turns up, with the face and the name left showing.
//
// CHIPS ARE WRITTEN AT ONCE, unlike the label: each is one press (put on, take off) and one step of the
// undo. Add chip drops a menu of every chip on every board (utils/suggestion-menu.js: suggestions are a
// menu off the Add button, never a row of chips), led by "New chip". The chip FORM makes a new chip or
// changes one, and writes only on Save: a chip is shared by every board, so a half-chosen colour must
// not be broadcast as the reader tries them.

import { RelmapBoardBar, markChosen } from "./relmap-board-bar.js";
import { TIE_WRITE_DELAY_MS } from "./relmap-tie-bar.js";
import { chipPaint, chipPillHtml, esc } from "./relmap-chip-pill.js";
import { closeSuggestionMenu, openSuggestionMenu } from "./suggestion-menu.js";
import { deepenInk, normalizeHex, resolveInkHex } from "../relmap/relmap-ink.js";
import { RELMAP_INK_DEFAULT, chipNameOf } from "../relmap/relmap-store.js";

/** The two rows of presses on the chip form that the arrow keys walk. */
const FORM_RADIOS = Object.freeze(["chipink", "chipicon"]);
/** How many icons stand in one row of the form's grid (`.stonetop-relmap-chipform-icons`). */
export const CHIP_ICON_COLUMNS = 9;

const markRadio = (buttons, value) => markChosen(buttons, value, { may: false, key: "relmapPbarValue" });
/** A pattern from the markup with its `{chip}` filled in. */
const said = (pattern, chip) => String(pattern ?? "").replaceAll("{chip}", chip ?? "");

/** How close the bar may come to the viewport's edge, in screen pixels. */
const PERSON_BAR_EDGE = 6;

/** The label is held back before it is written, for the tie bar's caption's reason. */
const PERSON_HELD = Object.freeze({
	subtitle: { ms: TIE_WRITE_DELAY_MS, flush: bar => bar.flush() },
});

export class RelmapPersonBar extends RelmapBoardBar {
	/**
	 * @param {HTMLElement} root  the window's root element.
	 * @param {object} handlers
	 * @param {Function} handlers.surface  `() => ZoomPanSurface|null`.
	 * @param {Function} handlers.personAt  `id => {node, at}|null`: the person as painted now, and the
	 *        point on the board (percentages) the bar's top edge is centred on. Null when they are gone,
	 *        which closes the bar.
	 * @param {Function} handlers.onField  `(id, fields) => Promise`: write the label.
	 * @param {Function} [handlers.onPicked]  `id => void`: mark whose label this bar is holding.
	 * @param {Function} handlers.canEdit  `() => boolean`.
	 * @param {Function} [handlers.library]  `id => chip[]`: every chip that can be put on this person.
	 * @param {Function} [handlers.onWear]  `(id, chip) => Promise`: put a chip on them.
	 * @param {Function} [handlers.onTakeOff]  `(id, chipId) => Promise`: take one off.
	 * @param {Function} [handlers.onSaveChip]  `(id, chipId|null, def) => Promise`: change a chip (an
	 *        id) or make one and put it on this person (null).
	 * @param {Function} [handlers.onDropChip]  `chipId => Promise<boolean>`: delete a chip; false when
	 *        the reader thought better of it.
	 * @param {Function} [handlers.onNudged]  `(chose, used) => void`: a picked colour was deepened.
	 * @param {Function} [handlers.onNeedName]  `() => void`: Save pressed with no name.
	 */
	constructor(root, {
		surface, personAt, onField, onPicked, canEdit = () => true,
		library, onWear, onTakeOff, onSaveChip, onDropChip, onNudged, onNeedName,
	} = {}) {
		super(root, {
			bar: ".stonetop-relmap-personbar",
			press: "relmap-pbar",
			writing: { field: "subtitle", key: "subtitle" },
			held: PERSON_HELD,
		}, { surface, onField, onPicked, canEdit });
		this._personAt = personAt ?? (() => null);
		this._library = library ?? (() => []);
		this._onWear = onWear ?? (() => {});
		this._onTakeOff = onTakeOff ?? (() => {});
		this._onSaveChip = onSaveChip ?? (() => {});
		this._onDropChip = onDropChip ?? (() => false);
		this._onNudged = onNudged ?? (() => {});
		this._onNeedName = onNeedName ?? (() => {});
		this.subtitle = this._field;
		this.worn = this.el?.querySelector?.(".stonetop-relmap-personbar-worn") ?? null;
		this.addChip = this.el?.querySelector?.("[data-relmap-pbar='chipadd']") ?? null;
		this.form = this.el?.querySelector?.(".stonetop-relmap-chipform") ?? null;
		this.chipName = this.el?.querySelector?.("[data-relmap-pbar='chipname']") ?? null;
		this.chipHex = this.el?.querySelector?.("[data-relmap-pbar='chiphex']") ?? null;
		this.chipInkMore = this.el?.querySelector?.("[data-relmap-pbar='chipinkmore']") ?? null;
		this.chipDrop = this.el?.querySelector?.("[data-relmap-pbar='chipdrop']") ?? null;
		this.preview = this.el?.querySelector?.(".stonetop-relmap-chipform-preview") ?? null;
		/** The chip form's answers while it is open: which chip (null for a new one), its ink and icon. */
		this._chip = null;
		/** What the worn row was last painted from, so a repaint that changes nothing keeps the focus. */
		this._wornSaid = "";
		this._wire();
	}

	_wire() {
		if (!this.el) return;
		if (this.subtitle) {
			this._on(this.subtitle, "input", () => this._defer("subtitle"));
			this._on(this.subtitle, "blur", () => this.flush());
			this._on(this.subtitle, "change", ev => ev.stopPropagation());
		}
		this._on(this.el, "click", ev => {
			const button = ev.target?.closest?.("[data-relmap-pbar]");
			if (!button || button.tagName !== "BUTTON") return;
			this._press(button.dataset.relmapPbar, button.dataset.relmapPbarValue ?? "");
		});
		if (this.chipName) {
			this._on(this.chipName, "input", () => this._paintPreview());
			this._on(this.chipName, "change", ev => ev.stopPropagation());
		}
		if (this.chipHex) {
			// The picker's own `change` (see the base's `_wire` on `inkHex`): painting is not choosing.
			this._on(this.chipHex, "change", ev => {
				ev.stopPropagation();
				if (this._paintingInk) return;
				this._pickChipHex(this.chipHex.value ?? "");
			});
		}
		super._wire();
	}

	/** One press on the bar's chip controls. */
	_press(what, value) {
		if (!this.id || !this._canEdit()) return;
		const id = this.id;
		switch (what) {
			case "chipadd": return this._openMenu();
			case "chipedit": return this._openForm(value);
			case "chipoff": {
				// The focus goes to Add chip: the button pressed is about to be painted away.
				this.addChip?.focus?.();
				return this._onTakeOff(id, value);
			}
			case "chipink": {
				this._showPicker(false);
				return this._setChipInk(value);
			}
			case "chipinkmore": return this._openHex();
			case "chipicon": {
				if (!this._chip) return undefined;
				this._chip.icon = value;
				markRadio(this.el.querySelectorAll("[data-relmap-pbar='chipicon']"), value);
				return this._paintPreview();
			}
			case "chipsave": return this._saveChip();
			case "chipcancel": return this._closeForm({ refocus: true });
			case "chipdrop": return this._dropChip();
			default: return undefined;
		}
	}

	_key(ev) {
		if (this._rove(ev, FORM_RADIOS, button => (
			button?.dataset?.relmapPbar === "chipicon" ? CHIP_ICON_COLUMNS : 1
		))) return;
		if (ev.key === "Escape") {
			ev.preventDefault();
			ev.stopPropagation();
			// The chip form first, then the bar: one Escape steps back one thing.
			if (this._chip) { this._closeForm({ refocus: true }); return; }
			// Back to what the document has: Escape is the way out of a label thought better of.
			this._forgetWriting();
			this.dismiss();
			return;
		}
		if (ev.key === "Enter" && ev.target === this.chipName) {
			ev.preventDefault();
			ev.stopPropagation();
			if (!ev.repeat) this._saveChip();
			return;
		}
		// Enter on a button is the button's own press; only the label field closes the bar with it.
		if (ev.key === "Enter" && ev.target !== this.subtitle) {
			ev.stopPropagation();
			return;
		}
		if (ev.key === "Enter") {
			ev.preventDefault();
			ev.stopPropagation();
			// ⚠ NOT A HELD ONE. The Enter that opened this bar keeps repeating into the field, and closing
			// on it handed the focus back to the label, whose next repeat opened the bar again.
			if (ev.repeat) return;
			this.flush();
			this.dismiss();
			return;
		}
		// Every other key is the field's: stopped, not prevented, so it still types and the caret's
		// arrows never pan the scene behind the window.
		ev.stopPropagation();
	}

	/**
	 * Take hold of one person's label, with the caret at the end of it: the only reason to raise this
	 * bar is to type.
	 *
	 * @param {string} id
	 * @param {object} [opts]
	 * @param {HTMLElement|Function} [opts.returnTo]  where the focus goes back to on Escape or Enter.
	 */
	open(id, { returnTo = null } = {}) {
		if (!this.el || !id || !this._canEdit()) return false;
		const held = this._personAt(id);
		if (!held) return false;
		// The same person taken hold of again keeps what is being typed: it was never written.
		const again = this.isOpen && this.id === id;
		if (this.id && !again) this.flush();
		this.id = id;
		this._returnTo = returnTo ?? null;
		this._at = held.at ?? null;
		this._lift = held.lift ?? null;
		this._box = null;
		if (!again && this.subtitle) {
			this.subtitle.value = held.node?.subtitle ?? "";
			this._saved = this.subtitle.value;
			this._disarm("subtitle");
		}
		if (held.label) this.el.setAttribute?.("aria-label", held.label);
		if (!again) this._closeForm();
		this._paintWorn(held);
		this.el.hidden = false;
		this._onPicked(id);
		this.place();
		if (this.subtitle) {
			this.subtitle.focus?.();
			const end = this.subtitle.value?.length ?? 0;
			this.subtitle.setSelectionRange?.(end, end);
		}
		return true;
	}

	/**
	 * UNDER THE POINT, not over it: the point is the foot of the name, and the bar takes the place of
	 * the label it is changing. Lifted above the face only where the viewport has no room below.
	 */
	_seat({ x, y, w, h, room, offset, painted }) {
		const edge = PERSON_BAR_EDGE;
		const maxLeft = Math.max(edge, (room.width || 0) - w - edge);
		const maxTop = Math.max(edge, (room.height || 0) - h - edge);
		// ⚠ ABOVE THE FACE, NOT ON IT. Clamped up from under the name, a bar near the bottom of the view
		// sat over the very face it is about. `_lift` is the top of the face; the bar goes above that.
		const lift = this._lift && offset && painted?.height
			? offset.y + (painted.height * this._lift.top) / 100 - h - edge
			: null;
		const top = y <= maxTop || lift === null || lift < edge ? y : lift;
		return {
			left: Math.max(edge, Math.min(x - w / 2, maxLeft)),
			top: Math.max(edge, Math.min(top, maxTop)),
		};
	}

	/**
	 * The board has been repainted underneath. The person may have moved or been taken off.
	 *
	 * ⚠ THE FIELD IS REFILLED ONLY WHEN NOBODY IS TYPING IN IT: not focused, nothing held back, and
	 * still saying what was last saved. The reader typing has the newer words (the tie bar's reason),
	 * and a write trims, so refilling a focused field would eat the space just typed after "Iron".
	 * But a bar left standing idle while an undo or another player changed the label kept the OLD
	 * words, and Escape then "put back" those, and the next keystroke wrote them over the change.
	 */
	refresh() {
		if (!this.isOpen) return;
		const held = this._personAt(this.id);
		if (!held) { this.discard(); return; }
		const field = this.subtitle;
		const typing = !field || field.ownerDocument?.activeElement === field
			|| this._timers?.subtitle || field.value !== this._saved;
		if (!typing) {
			field.value = held.node?.subtitle ?? "";
			this._saved = field.value;
		}
		if (held.label) this.el?.setAttribute?.("aria-label", held.label);
		this._paintWorn(held);
		this._at = held.at ?? this._at;
		this._lift = held.lift ?? this._lift;
		this._onPicked(this.id);
		this.place();
	}

	// ── Chips ───────────────────────────────────────────────────────────────

	/**
	 * The chips this person wears, as pills to press (the chip's form) with an x beside each (take it
	 * off). Painted only when they changed, so a repaint under the reader's hand keeps their focus.
	 */
	_paintWorn(held) {
		const list = this.worn;
		if (!list) return;
		const chips = held?.chips ?? [];
		const sig = JSON.stringify(chips.map(chip => [chip.id, chip.name, chip.icon, chip.ink]));
		if (sig === this._wornSaid && list.childElementCount === chips.length) return;
		this._wornSaid = sig;
		const edit = list.dataset?.relmapSaidEdit ?? "";
		const off = list.dataset?.relmapSaidOff ?? "";
		list.innerHTML = chips.map(chip => {
			const id = esc(chip.id);
			const pill = chipPillHtml(chipPaint(chip), {
				tag: "button",
				attrs: ` type="button" data-relmap-pbar="chipedit" data-relmap-pbar-value="${id}" aria-label="${esc(said(edit, chip.name))}"`,
			});
			const takeOff = esc(said(off, chip.name));
			return `<li class="stonetop-relmap-personbar-worn-item">${pill}`
				+ `<button type="button" class="stonetop-relmap-personbar-chipoff" data-relmap-pbar="chipoff" data-relmap-pbar-value="${id}"`
				+ ` aria-label="${takeOff}" data-tooltip="${takeOff}"><i class="fas fa-xmark" aria-hidden="true"></i></button></li>`;
		}).join("");
		list.hidden = !chips.length;
		this._box = null;
	}

	/** Add chip: the menu of every chip there is, led by a new one. Chips already worn say so. */
	_openMenu() {
		const button = this.addChip;
		if (!button) return;
		const id = this.id;
		const worn = new Set((this._personAt(id)?.chips ?? []).map(chip => chip.id));
		const chips = this._library(id) ?? [];
		openSuggestionMenu(button, {
			heading: button.dataset?.relmapSaidHeading ?? "",
			blankLabel: button.dataset?.relmapSaidNew ?? "",
			items: chips.map(chip => {
				const { inkKey, inkHex } = chipPaint(chip);
				return {
					value: chip.id,
					label: chip.name,
					used: worn.has(chip.id),
					icon: chip.icon || "fa-tag",
					iconClass: `stonetop-relmap-ink--${inkKey}`,
					iconStyle: inkHex ? `--relmap-ink-raw:${inkHex}` : "",
				};
			}),
			onPick: value => {
				if (this.id !== id) return;
				if (value === null) { this._openForm(null); return; }
				const chip = chips.find(one => one.id === value);
				if (chip) this._onWear(id, chip);
			},
		});
	}

	/** Put the menu away, if it is this bar's. */
	_closeMenu() {
		if (this.addChip?.getAttribute?.("aria-expanded") === "true") closeSuggestionMenu();
	}

	/**
	 * The chip form, on one worn chip (`chipId`) or on a new one (null). A new chip starts in the
	 * default ink with no icon; the caret goes into the name either way.
	 */
	_openForm(chipId) {
		if (!this.form || !this.id) return;
		this._closeMenu();
		const held = this._personAt(this.id);
		const chip = chipId ? (held?.chips ?? []).find(one => one.id === chipId) : null;
		if (chipId && !chip) return;
		this._chip = {
			id: chip?.id ?? null,
			ink: chip?.ink ?? RELMAP_INK_DEFAULT,
			icon: chip?.icon ?? "",
			hexAsked: !!normalizeHex(chip?.ink),
		};
		if (this.chipName) this.chipName.value = chip?.name ?? "";
		if (this.chipDrop) this.chipDrop.hidden = !chip;
		markRadio(this.el.querySelectorAll("[data-relmap-pbar='chipicon']"), this._chip.icon);
		this._markChipInk(this._chip.ink);
		this.form.hidden = false;
		this._box = null;
		this._paintPreview();
		this.place();
		this.chipName?.focus?.();
	}

	/** Put the form away, keeping nothing. `refocus` hands the focus back to Add chip. */
	_closeForm({ refocus = false } = {}) {
		if (this._chip && refocus) this.addChip?.focus?.();
		this._chip = null;
		if (this.form && !this.form.hidden) {
			this.form.hidden = true;
			this._showPicker(false);
			this._box = null;
			this.place();
		}
	}

	/** One of the eight, or a hex of the reader's own: the form's answer, painted on its presses. */
	_setChipInk(ink) {
		if (!this._chip) return;
		this._chip.ink = ink;
		this._markChipInk(ink);
		this._paintPreview();
	}

	_markChipInk(ink) {
		markRadio(this.el?.querySelectorAll?.("[data-relmap-pbar='chipink']") ?? [], ink);
		const hex = normalizeHex(ink);
		this.chipInkMore?.classList?.toggle("is-chosen", !!hex);
		this._showPicker(!!this._chip?.hexAsked || !!hex, hex);
	}

	_showPicker(open, hex = "") {
		const picker = this.chipHex;
		if (!picker) return;
		if (!open && this._chip) this._chip.hexAsked = false;
		if (picker.hidden === open) {
			picker.hidden = !open;
			this.chipInkMore?.setAttribute?.("aria-expanded", open ? "true" : "false");
			this._box = null;
		}
		if (open && hex) this._paintChipPicker(hex);
	}

	/** Set what the picker holds without it reading as the reader's choice (see `_paintPicker`). */
	_paintChipPicker(hex) {
		const picker = this.chipHex;
		if (!picker || picker.value === hex) return;
		this._paintingInk = true;
		try { picker.value = hex; } finally { this._paintingInk = false; }
	}

	/** The `+`: the picker, opened on the colour the form has now. */
	_openHex() {
		if (!this._chip) return;
		this._chip.hexAsked = true;
		const ink = this._chip.ink || RELMAP_INK_DEFAULT;
		this._showPicker(true, normalizeHex(ink) || resolveInkHex(ink) || "#000000");
		this.place();
		this.chipHex?.focus?.();
	}

	/** A colour the reader picked: deepened if it cannot be read on the board, and they are told. */
	_pickChipHex(value) {
		if (!this._chip) return;
		const chose = normalizeHex(value);
		if (!chose) return;
		const { hex, nudged } = deepenInk(chose);
		if (!hex) return;
		if (nudged) this._onNudged(chose, hex);
		this._chip.hexAsked = true;
		this._setChipInk(hex);
	}

	/** The pill as it will be drawn, under the form's choices. */
	_paintPreview() {
		if (!this.preview || !this._chip) return;
		const name = chipNameOf(this.chipName?.value ?? "") || this.chipName?.placeholder || "";
		this.preview.innerHTML = chipPillHtml(chipPaint({ name, icon: this._chip.icon, ink: this._chip.ink }));
	}

	async _saveChip() {
		if (!this._chip || !this.id || !this._canEdit()) return;
		const name = chipNameOf(this.chipName?.value ?? "");
		if (!name) { this._onNeedName(); this.chipName?.focus?.(); return; }
		const { id: chipId, icon, ink } = this._chip;
		const personId = this.id;
		this._closeForm({ refocus: true });
		await this._onSaveChip(personId, chipId, { name, icon, ink });
	}

	async _dropChip() {
		const chipId = this._chip?.id;
		if (!chipId) return;
		const gone = await this._onDropChip(chipId);
		if (gone) this._closeForm({ refocus: true });
	}

	close() {
		this._closeMenu();
		this._closeForm();
		super.close();
	}

	destroy() {
		this._closeMenu();
		super.destroy();
		this.subtitle = null;
		this.worn = null;
		this.addChip = null;
		this.form = null;
		this.chipName = null;
		this.chipHex = null;
		this.chipInkMore = null;
		this.chipDrop = null;
		this.preview = null;
		this._chip = null;
	}
}
