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
// EVERYTHING ON THE BAR SHOWS ON THE BOARD AT ONCE AND IS KEPT ON SAVE, AND NOT BEFORE: the label, the
// side, the italics, chips put on or taken off, and a chip made or changed in the chip form (as it is
// chosen, before the form's own Save). The bar hands the window its CHANGE (`onPreview`) on every edit,
// and the window paints the board with it laid over the stored map, for this reader alone. Save, or
// Ctrl+Enter, writes the whole change as ONE write and one step of the undo (`onSave`), and puts the bar
// away. Escape, the x, or a click away keeps none of it, and the board goes back to what is stored.
//
// The box is three lines tall and Enter starts a new line in it (up to `RELMAP_SUBTITLE_LINES`); the
// side (below, above, left, right) moves the name, label and chips round the face together; Italic is
// on unless turned off. After Dom Bosco's tags pull request (domfortunato), which brought the lines, the
// side and the Save button.
//
// Add chip drops a menu of every chip on every board (utils/suggestion-menu.js: suggestions are a menu
// off the Add button, never a row of chips), led by "New chip". The chip FORM makes a new chip or
// changes one; its Save keeps that in the bar's change, and Cancel or Escape lets the form's edits go.
// Deleting a chip is asked first, then shown at once (gone from everybody on this board) and done on Save,
// on this board and every other one that has it.

import { RelmapBoardBar, markChosen } from "./relmap-board-bar.js";
import { chipPaint, chipPillHtml, esc } from "./relmap-chip-pill.js";
import { closeSuggestionMenu, openSuggestionMenu } from "./suggestion-menu.js";
import { deepenInk, normalizeHex, resolveInkHex } from "../relmap/relmap-ink.js";
import {
	RELMAP_INK_DEFAULT, RELMAP_SIDE_DEFAULT, RELMAP_SUBTITLE_LINES, chipNameOf, readItalic, readSide, subtitleOf,
} from "../relmap/relmap-store.js";

/** How close the bar may come to the viewport's edge, in screen pixels. */
const PERSON_BAR_EDGE = 6;
/** One of the system's strings; the window hands over every other word the bar says. */
const localize = key => globalThis.game?.i18n?.localize?.(key) ?? "";

/** The rows of presses that the arrow keys walk: the chip form's two. (The sides are real radios.) */
const FORM_RADIOS = Object.freeze(["chipink", "chipicon"]);
/** Each bar's side radios are named for that bar alone, so two windows' groups never join. */
let sideGroups = 0;
/** How many icons stand in one row of the form's grid (`.stonetop-relmap-chipform-icons`). */
export const CHIP_ICON_COLUMNS = 9;

const markRadio = (buttons, value) => markChosen(buttons, value, { may: false, key: "relmapPbarValue" });
/** A pattern from the markup with its `{chip}` filled in. */
const said = (pattern, chip) => String(pattern ?? "").replaceAll("{chip}", chip ?? "");

/** Whether two chip definitions look the same. */
const sameChip = (a, b) => !!a && !!b && a.name === b.name && a.icon === b.icon && a.ink === b.ink;

/** How many lines a label box holds now. */
const linesIn = text => String(text ?? "").split("\n").length;

/**
 * The id a NEW chip goes by on the board while its form is open and it has no id of its own yet. Never
 * stored: the form's Save swaps it for a real id, or for the chip already called that.
 */
export const DRAFT_CHIP_ID = "stonetop-relmap-draft-chip";

/** How long typing must pause before the board shows it, and the longest it is ever left unshown. */
export const PREVIEW_PAUSE_MS = 150;
export const PREVIEW_MAX_MS = 400;

export class RelmapPersonBar extends RelmapBoardBar {
	/**
	 * @param {HTMLElement} root  the window's root element.
	 * @param {object} handlers
	 * @param {Function} handlers.surface  `() => ZoomPanSurface|null`.
	 * @param {Function} handlers.personAt  `id => {node, at}|null`: the person as painted now, and the
	 *        point on the board (percentages) the bar's top edge is centred on. Null when they are gone,
	 *        which closes the bar.
	 * @param {Function} handlers.onSave  `(id, change) => Promise`: write the bar's change as one step.
	 *        `change` is `{fields, wear, off, defs, drop}`: the label, side and italics that changed; chips
	 *        put on (`{id, name, icon, ink}`) and the ids taken off; chips changed, `{chipId: def}`; and
	 *        the ids of chips deleted from the board.
	 * @param {Function} [handlers.onPreview]  `(id, change|null) => void`: show this change on the board
	 *        without writing it, or nothing (null) to show the board as stored.
	 * @param {Function} [handlers.onPicked]  `id => void`: mark whose label this bar is holding.
	 * @param {Function} handlers.canEdit  `() => boolean`.
	 * @param {Function} [handlers.library]  `id => chip[]`: every chip that can be put on this person.
	 * @param {Function} [handlers.onNewChip]  `def => chip`: the chip a new one named in the form is: the
	 *        one already called that, or `def` under a new id.
	 * @param {Function} [handlers.onDropChip]  `chipId => Promise<boolean>`: ask whether to delete a chip
	 *        (on Save); false when the reader thought better of it. Writes nothing.
	 * @param {Function} [handlers.italicDefault]  `() => boolean`: whether a NEW label starts in italics,
	 *        as the last one saved on this map was.
	 * @param {Function} [handlers.onNudged]  `(chose, used) => void`: a picked colour was deepened.
	 * @param {Function} [handlers.onNeedName]  `() => void`: Save pressed with no name.
	 */
	constructor(root, {
		surface, personAt, onSave, onPreview, onPicked, canEdit = () => true,
		library, onNewChip, onDropChip, onNudged, onNeedName, italicDefault,
	} = {}) {
		// NOTHING HELD BACK ON A TIMER: the change is written on Save (`_save`), never as it is made.
		super(root, {
			bar: ".stonetop-relmap-personbar",
			press: "relmap-pbar",
			writing: { field: "subtitle", key: "subtitle" },
		}, { surface, onPicked, canEdit });
		this._personAt = personAt ?? (() => null);
		this._onSave = onSave ?? (() => {});
		this._onPreview = onPreview ?? (() => {});
		this._library = library ?? (() => []);
		this._onNewChip = onNewChip ?? (() => null);
		this._onDropChip = onDropChip ?? (() => false);
		this._onNudged = onNudged ?? (() => {});
		this._onNeedName = onNeedName ?? (() => {});
		this._italicDefault = italicDefault ?? (() => true);
		this.subtitle = this._field;
		this.sides = [...(this.el?.querySelectorAll?.("[data-relmap-pbar='side']") ?? [])];
		const group = `relmap-side-${++sideGroups}`;
		for (const radio of this.sides) radio.name = group;
		this.title = this.el?.querySelector?.(".stonetop-relmap-personbar-title") ?? null;
		this.head = this.el?.querySelector?.(".stonetop-relmap-personbar-head") ?? null;
		/**
		 * WHERE THE READER DRAGGED THE BAR TO, in the viewport's pixels, or null while it rides under
		 * its person. Once moved it stays where it was put, through pans and zooms, until it is let go.
		 */
		this._moved = null;
		this.italicBox = this.el?.querySelector?.("[data-relmap-pbar='italic']") ?? null;
		/** The side and the italics as this bar has them, and as the document had them when it opened. */
		this._side = RELMAP_SIDE_DEFAULT;
		this._italic = true;
		this._savedSide = RELMAP_SIDE_DEFAULT;
		this._savedItalic = true;
		/**
		 * FOR SOMEBODY WITH NO LABEL YET, the italics the box starts on: the map's last saved choice
		 * (`italicDefault`), or null once the reader has ticked the box themselves or for a label already
		 * there. Only a label that gets words is written with it: an empty one has no italics to keep.
		 */
		this._italicSeed = null;
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
		/** The person as stored, for which chips they already wear. */
		this._node = null;
		/** Chips put on in this bar (id -> chip), taken off (ids), and changed in the form (id -> def). */
		this._wear = new Map();
		this._off = new Set();
		this._defs = new Map();
		/** Chips deleted in this bar: gone from the board as shown, and deleted on Save. */
		this._drop = new Set();
		/** The ids of the chips this board already has, which are the ones Delete can reach. */
		this._boardChips = new Set();
		/** Typing waiting to be shown (`_previewSoon`), and the change last shown, as said. */
		this._previewTimer = 0;
		this._previewSince = null;
		this._shown = "null";
		/** What the worn row was last painted from, so a repaint that changes nothing keeps the focus. */
		this._wornSaid = "";
		this._wire();
	}

	_wire() {
		if (!this.el) return;
		if (this.subtitle) {
			this._on(this.subtitle, "change", ev => ev.stopPropagation());
			this._on(this.subtitle, "input", () => this._previewSoon());
		}
		this._wireMove();
		// THE SIDES ARE RADIOS: the one checked is what Save will write. Stopped for Italic's reason below.
		for (const radio of this.sides) {
			this._on(radio, "change", ev => {
				ev.stopPropagation();
				if (!radio.checked) return;
				this._side = readSide(radio.value);
				this._preview();
			});
		}
		// ITALIC IS A CHECKBOX: the box says what Save will write. Stopped, as the window has `change`
		// handlers of its own above the bar.
		if (this.italicBox) {
			this._on(this.italicBox, "change", ev => {
				ev.stopPropagation();
				this._italic = !!this.italicBox.checked;
				this._italicSeed = null;
				this._preview();
			});
		}
		this._on(this.el, "click", ev => {
			const button = ev.target?.closest?.("[data-relmap-pbar]");
			if (!button || button.tagName !== "BUTTON") return;
			this._press(button.dataset.relmapPbar, button.dataset.relmapPbarValue ?? "");
		});
		if (this.chipName) {
			// The pill in the form follows every key; the board waits for a pause, as the label does.
			this._on(this.chipName, "input", () => { this._paintPreview(); this._previewSoon(); });
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

	/** One press on the bar's controls. */
	_press(what, value) {
		if (!this.id || !this._canEdit()) return;
		switch (what) {
			case "save": return this._save();
			// The title's x: Escape's way out, keeping nothing.
			case "close": {
				this._closeForm();
				this._forgetWriting();
				return this.dismiss();
			}
			case "chipadd": return this._openMenu();
			// The new chip the open form is making is worn on the board already: its pill leads back to it.
			case "chipedit": return value === DRAFT_CHIP_ID ? this.chipName?.focus?.() : this._openForm(value);
			case "chipoff": {
				// The focus goes to Add chip: the button pressed is about to be painted away.
				this.addChip?.focus?.();
				if (value === DRAFT_CHIP_ID) return this._closeForm();
				return this._takeOff(value);
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
				this._paintPreview();
				return this._preview();
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
		// IN THE LABEL BOX, Enter starts a new line (while there is room for one) and Ctrl+Enter saves.
		if (ev.key === "Enter" && ev.target === this.subtitle) {
			ev.stopPropagation();
			// ⚠ NOT A HELD ONE. The Enter that opened this bar keeps repeating into the box.
			if (ev.repeat) { ev.preventDefault(); return; }
			if (ev.ctrlKey || ev.metaKey) {
				ev.preventDefault();
				this._save();
				return;
			}
			if (linesIn(this.subtitle.value) >= RELMAP_SUBTITLE_LINES) ev.preventDefault();
			return;
		}
		if (ev.key === "Enter" && ev.target === this.chipName) {
			ev.preventDefault();
			ev.stopPropagation();
			if (!ev.repeat) this._saveChip();
			return;
		}
		// Enter on a button is the button's own press.
		if (ev.key === "Enter") {
			ev.stopPropagation();
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
		// Somebody else taken hold of: the last one's change is let go, on the board too.
		if (this.id && !again) {
			this.flush();
			this._unshow();
		}
		this.id = id;
		// Opened on somebody else, it starts under them again.
		if (!again) this._moved = null;
		this._returnTo = returnTo ?? null;
		this._at = held.at ?? null;
		this._lift = held.lift ?? null;
		this._box = null;
		if (!again) {
			this._clearChips();
			this._fill(held.node);
		}
		this._holdStored(held);
		if (held.label) this.el.setAttribute?.("aria-label", held.label);
		this._paintTitle(held);
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
		// As near the viewport's edge as the tie bar may come.
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
	 * ⚠ THE BAR IS REFILLED ONLY WHILE IT HOLDS NOTHING UNSAVED: the label, the side and the italics
	 * all still what the document had when it was opened. A reader part way through a change keeps it
	 * until they Save or let go. But a bar left standing untouched while an undo or another player
	 * changed the person shows the change, so Save never writes the OLD words back over it.
	 */
	refresh() {
		if (!this.isOpen) return;
		const held = this._personAt(this.id);
		if (!held) { this.discard(); return; }
		if (!this._dirty()) this._fill(held.node, { keepCaret: true });
		this._holdStored(held);
		if (held.label) this.el?.setAttribute?.("aria-label", held.label);
		this._paintTitle(held);
		this._paintWorn(held);
		this._at = held.at ?? this._at;
		this._lift = held.lift ?? this._lift;
		this._onPicked(this.id);
		this.place();
	}

	// ── Moving the bar by its title ─────────────────────────────────────────

	/**
	 * A PRESS ON THE TITLE (not its x) AND A DRAG MOVE THE BAR, as a window is moved by its title bar,
	 * so it can be taken off whatever it covers. The pointer is captured on the title, so the drag
	 * carries on wherever it goes and nothing on the board under it hears it.
	 */
	_wireMove() {
		const head = this.head;
		if (!head) return;
		this._on(head, "pointerdown", ev => {
			if (ev.button !== 0 || ev.target?.closest?.("button")) return;
			ev.preventDefault();
			const from = { x: ev.clientX, y: ev.clientY, left: Number.parseFloat(this.el.style.left) || 0, top: Number.parseFloat(this.el.style.top) || 0 };
			head.setPointerCapture?.(ev.pointerId);
			const move = e => {
				this._moved = { left: from.left + e.clientX - from.x, top: from.top + e.clientY - from.y };
				this.place();
			};
			const end = e => {
				head.releasePointerCapture?.(e.pointerId);
				head.removeEventListener("pointermove", move);
				head.removeEventListener("pointerup", end);
				head.removeEventListener("pointercancel", end);
			};
			head.addEventListener("pointermove", move);
			head.addEventListener("pointerup", end);
			head.addEventListener("pointercancel", end);
		});
	}

	/** Where the bar goes: where the reader dragged it, kept inside the view, or under its person. */
	place() {
		if (!this._moved) { super.place(); return; }
		if (!this.isOpen || !this.el) return;
		const measured = this._surface()?.viewSize;
		const room = measured?.width ? measured : this._view?.getBoundingClientRect?.() ?? { width: 0, height: 0 };
		this._box ??= this.el.getBoundingClientRect?.() ?? { width: 0, height: 0 };
		const edge = PERSON_BAR_EDGE;
		const maxLeft = Math.max(edge, (room.width || 0) - (this._box.width || 0) - edge);
		const maxTop = Math.max(edge, (room.height || 0) - (this._box.height || 0) - edge);
		this.el.style.left = `${Math.round(Math.max(edge, Math.min(this._moved.left, maxLeft)))}px`;
		this.el.style.top = `${Math.round(Math.max(edge, Math.min(this._moved.top, maxTop)))}px`;
	}

	// ── The label, its side and its italics ─────────────────────────────────

	/** Fill the bar from the document's copy of one person. `keepCaret` leaves an unchanged box alone. */
	_fill(node, { keepCaret = false } = {}) {
		const words = node?.subtitle ?? "";
		if (this.subtitle && !(keepCaret && this.subtitle.value === words)) this.subtitle.value = words;
		this._saved = words;
		this._side = this._savedSide = readSide(node?.side);
		this._italic = this._savedItalic = readItalic(node?.italic);
		// NO LABEL YET: the box starts on the italics this map's last saved label chose.
		this._italicSeed = subtitleOf(words) ? null : !!this._italicDefault();
		if (this._italicSeed !== null) this._italic = this._italicSeed;
		this._markSide();
		this._markItalic();
	}

	/**
	 * Whether the italics are a change to keep: unlike the document's, and not merely the starting
	 * italics of a label still without words.
	 */
	_italicChanged(words) {
		if (this._italic === this._savedItalic) return false;
		return !(this._italicSeed === this._italic && !subtitleOf(words));
	}

	/** Whether the bar holds anything the document does not: words, a side or the italics. */
	_dirty() {
		const words = this.subtitle?.value ?? this._saved;
		return words !== this._saved || this._side !== this._savedSide || this._italicChanged(words);
	}

	_markSide() {
		for (const radio of this.sides) radio.checked = radio.value === this._side;
	}

	/** "Label for Lord Elroy", over the bar. */
	_paintTitle(held) {
		if (this.title) this.title.textContent = held?.title ?? "";
	}

	_markItalic() {
		if (this.italicBox) this.italicBox.checked = this._italic;
	}

	/** The person as stored, and which chips the board has: what the bar's chip change is measured from. */
	_holdStored(held) {
		this._node = held?.node ?? null;
		this._boardChips = new Set(held?.boardChips ?? []);
	}

	/**
	 * SAVE: the bar's whole change (the label, the side, the italics and the chips), as one write and one
	 * step of the undo, and the bar put away. Nothing changed, nothing is written, and the bar still goes.
	 * @returns {Promise<*>|undefined}  the write, where there was one.
	 */
	_save() {
		if (!this.id) return undefined;
		// ⚠ WITH THE CHIP FORM OPEN, SAVE KEEPS THE CHIP TOO, as the form's own Save would. Putting the
		// bar away closes the form, and a chip named and coloured there was lost with it.
		if (this._chip) return this._saveWithChip();
		return this._saveLabel();
	}

	/**
	 * The chip form first, then the label: a chip with a name is saved; a NEW one never named is let go,
	 * as nothing was made; an existing one whose name was rubbed out is asked about, and nothing is saved
	 * until it has one, since saving the label and closing would lose the reader's edit to it.
	 */
	_saveWithChip() {
		const named = chipNameOf(this.chipName?.value ?? "");
		if (named) {
			this._saveChip();
		} else if (this._chip?.id) {
			this._onNeedName();
			this.chipName?.focus?.();
			return undefined;
		} else {
			this._closeForm();
		}
		return this._saveLabel();
	}

	/** The whole change, in one write, and the bar put away. */
	_saveLabel() {
		if (!this.id) return undefined;
		const id = this.id;
		const change = this._change();
		if (!change) { this.dismiss(); return undefined; }
		// ⚠ SAID, NOT DROPPED QUIETLY: edit rights taken away while the bar was up (the GM changing who
		// owns the map) would otherwise lose the change with nothing on screen to say so.
		if (!this._canEdit()) {
			globalThis.ui?.notifications?.warn?.(localize("stonetop.relmap.editLost"));
			return undefined;
		}
		if (this.subtitle) this._saved = this.subtitle.value;
		this._savedSide = this._side;
		this._savedItalic = this._italic;
		const write = this._onSave(id, change);
		this.dismiss();
		return write;
	}

	/**
	 * What this bar holds that the document does not, as `onSave` and `onPreview` take it, or null for
	 * nothing. The chip form, while it is open, is in it as it stands: a new chip as worn under
	 * `DRAFT_CHIP_ID`, a worn one as changed. A form with no name yet adds nothing.
	 */
	_change() {
		const fields = {};
		const words = subtitleOf(this.subtitle?.value ?? this._saved);
		if (words !== subtitleOf(this._saved)) fields.subtitle = words;
		if (this._side !== this._savedSide) fields.side = this._side;
		if (this._italicChanged(words)) fields.italic = this._italic;
		const wear = [...this._wear.values()];
		const defs = Object.fromEntries(this._defs);
		const form = this._formDef();
		if (form && !this._chip.id) wear.push({ id: DRAFT_CHIP_ID, ...form });
		else if (form && !sameChip(form, this._chip.was)) defs[this._chip.id] = form;
		const off = [...this._off];
		const drop = [...this._drop];
		const empty = !Object.keys(fields).length && !wear.length && !off.length && !drop.length;
		if (empty && !Object.keys(defs).length) return null;
		return { fields, wear, off, defs, drop };
	}

	/**
	 * Show the bar's change on the board, as it stands now. A press (a side, Italic, a chip) shows at
	 * once; typing waits for a pause (`_previewSoon`), and anything waiting is shown with this.
	 *
	 * ⚠ THE SAME CHANGE IS NOT SHOWN TWICE. Every one repaints the whole board, and a key that changes
	 * nothing once tidied (a second space, a trailing one) would be a repaint for nothing.
	 */
	_preview() {
		this._stopPreviewTimer();
		if (!this.id) return;
		const change = this._change();
		const said = JSON.stringify(change);
		if (said === this._shown) return;
		this._shown = said;
		this._onPreview(this.id, change);
	}

	/**
	 * TYPING IS SHOWN AFTER A PAUSE, and never left waiting longer than `PREVIEW_MAX_MS`: the board is
	 * repainted whole for each showing, so a word typed is one repaint rather than one per key, and a
	 * long sentence typed without stopping still keeps up a few times a second.
	 */
	_previewSoon() {
		const now = Date.now();
		this._previewSince ??= now;
		clearTimeout(this._previewTimer);
		const wait = Math.max(0, Math.min(PREVIEW_PAUSE_MS, this._previewSince + PREVIEW_MAX_MS - now));
		this._previewTimer = setTimeout(() => this._preview(), wait);
	}

	_stopPreviewTimer() {
		clearTimeout(this._previewTimer);
		this._previewTimer = 0;
		this._previewSince = null;
	}

	/**
	 * NOTHING IS WRITTEN BUT ON SAVE. Every way of letting go of a bar asks it to flush, and for this one
	 * that keeps nothing: what is not saved is put back, so the next opening starts from the document.
	 */
	flush() {
		return undefined;
	}

	_forgetWriting() {
		super._forgetWriting();
		this._side = this._savedSide;
		this._italic = this._savedItalic;
		this._markSide();
		this._markItalic();
	}

	/**
	 * LETTING GO KEEPS NOTHING ON THE BOARD: the chips' change goes with the bar, and the board is shown
	 * as stored again. After a Save the window holds the change on the board until the write lands.
	 */
	_letGo() {
		this._clearChips();
		this._unshow();
	}

	/** The board shown as stored again, with nothing left waiting to be shown. */
	_unshow() {
		this._stopPreviewTimer();
		this._shown = "null";
		if (this.id) this._onPreview(this.id, null);
	}

	_clearChips() {
		this._wear.clear();
		this._off.clear();
		this._defs.clear();
		this._drop.clear();
	}

	// ── Chips ───────────────────────────────────────────────────────────────

	/** Whether the stored person wears this chip. */
	_wornStored(chipId) {
		return !!this._node?.chips?.[chipId];
	}

	/** Put a chip on, in the bar's change. One taken off in this bar goes back on. */
	_putOn(chip) {
		if (!chip?.id) return;
		if (this._off.has(chip.id)) this._off.delete(chip.id);
		else if (!this._wornStored(chip.id)) this._wear.set(chip.id, { ...chip });
		this._preview();
	}

	/** Take a chip off, in the bar's change. One put on in this bar is simply let go. */
	_takeOff(chipId) {
		if (this._wear.has(chipId)) this._wear.delete(chipId);
		else if (this._wornStored(chipId)) this._off.add(chipId);
		this._preview();
	}

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
		// A chip deleted in this bar is not offered again until the bar is let go.
		const chips = (this._library(id) ?? []).filter(chip => !this._drop.has(chip.id));
		openSuggestionMenu(button, {
			heading: button.dataset?.relmapSaidHeading ?? "",
			blankLabel: button.dataset?.relmapSaidNew ?? "",
			usedHint: localize("stonetop.relmap.chips.added"),
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
				if (chip) this._putOn({ id: chip.id, name: chip.name, icon: chip.icon, ink: chip.ink });
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
			// The chip as the form opened on it, so opening it and changing nothing changes nothing.
			was: chip ? { name: chip.name, icon: chip.icon ?? "", ink: chip.ink ?? RELMAP_INK_DEFAULT } : null,
		};
		if (this.chipName) this.chipName.value = chip?.name ?? "";
		// Only a chip this board has can be deleted: one put on in this bar is not on it until Save.
		if (this.chipDrop) this.chipDrop.hidden = !chip || !this._boardChips.has(chip.id);
		markRadio(this.el.querySelectorAll("[data-relmap-pbar='chipicon']"), this._chip.icon);
		this._markChipInk(this._chip.ink);
		this.form.hidden = false;
		this._box = null;
		this._paintPreview();
		this.place();
		this.chipName?.focus?.();
		this._preview();
	}

	/**
	 * Put the form away, keeping nothing of it its Save did not keep, and the board shows that.
	 * `refocus` hands the focus back to Add chip.
	 */
	_closeForm({ refocus = false } = {}) {
		const had = !!this._chip;
		if (this._chip && refocus) this.addChip?.focus?.();
		this._chip = null;
		if (this.form && !this.form.hidden) {
			this.form.hidden = true;
			this._showPicker(false);
			this._box = null;
			this.place();
		}
		if (had) this._preview();
	}

	/** The chip as the open form has it, or null with no form or no name. */
	_formDef() {
		if (!this._chip) return null;
		const name = chipNameOf(this.chipName?.value ?? "");
		return name ? { name, icon: this._chip.icon, ink: this._chip.ink } : null;
	}

	/** One of the eight, or a hex of the reader's own: the form's answer, painted on its presses. */
	_setChipInk(ink) {
		if (!this._chip) return;
		this._chip.ink = ink;
		this._markChipInk(ink);
		this._paintPreview();
		this._preview();
	}

	_markChipInk(ink) {
		markRadio(this.el?.querySelectorAll?.("[data-relmap-pbar='chipink']") ?? [], ink);
		const hex = normalizeHex(ink);
		this.chipInkMore?.classList?.toggle("is-chosen", !!hex);
		this._showPicker(!!this._chip?.hexAsked || !!hex, hex);
	}

	_showPicker(open, hex = "") {
		if (!open && this._chip) this._chip.hexAsked = false;
		const picker = this.chipHex;
		if (!picker) return;
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
		this._chip.hexAsked = true;
		if (nudged) this._onNudged(chose, hex);
		this._setChipInk(hex);
	}

	/** The pill as it will be drawn, under the form's choices. */
	_paintPreview() {
		if (!this.preview || !this._chip) return;
		const name = chipNameOf(this.chipName?.value ?? "") || this.chipName?.placeholder || "";
		this.preview.innerHTML = chipPillHtml(chipPaint({ name, icon: this._chip.icon, ink: this._chip.ink }));
	}

	/**
	 * The form's Save: the chip kept in the bar's change and the form put away, to be written with the
	 * rest on the bar's own Save. A new chip is the one already called that, where there is one.
	 */
	_saveChip() {
		if (!this._chip || !this.id || !this._canEdit()) return;
		const def = this._formDef();
		if (!def) { this._onNeedName(); this.chipName?.focus?.(); return; }
		const chipId = this._chip.id;
		if (!chipId) {
			const chip = this._onNewChip(def);
			if (chip?.id) this._putOn({ id: chip.id, name: chip.name, icon: chip.icon, ink: chip.ink });
		} else if (!sameChip(def, this._chip.was)) this._defs.set(chipId, def);
		this._closeForm({ refocus: true });
	}

	/** Delete: asked, then gone from the board as shown, and deleted on every board on Save. */
	async _dropChip() {
		const chipId = this._chip?.id;
		if (!chipId) return;
		const gone = await this._onDropChip(chipId);
		// Let go, or moved on to somebody else, while the question was up: nothing to delete here.
		if (!gone || !this.isOpen || this._chip?.id !== chipId) return;
		this._wear.delete(chipId);
		this._off.delete(chipId);
		this._defs.delete(chipId);
		this._drop.add(chipId);
		this._closeForm({ refocus: true });
		this._preview();
	}

	close() {
		this._closeMenu();
		this._closeForm();
		super.close();
		// Let go, it is put back under its person the next time it opens.
		this._moved = null;
	}

	destroy() {
		this._closeMenu();
		this._stopPreviewTimer();
		super.destroy();
		this.subtitle = null;
		this.sides = [];
		this.italicBox = null;
		this.title = null;
		this.head = null;
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
