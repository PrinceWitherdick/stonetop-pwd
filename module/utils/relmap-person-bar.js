// The bar a person raises: one field, the label under their name ("Iron Knight", "Deceased").
//
// THE SMALLEST OF THE THREE BARS, and it keeps the same house rules as the other two for the same
// reasons (utils/relmap-board-bar.js): it lives in the viewport and survives every repaint, it holds
// what is typed back a breath before writing it so "Acolyte of the Celebrated Seer" is one broadcast
// and one step of the undo, and it claims its keys from core.
//
// IT SITS WHERE THE LABEL DOES, under the name. The reader clicked the words (or the "Add a label"
// ghost) to get here, so that is where the field turns up, with the face and the name left showing.

import { RelmapBoardBar } from "./relmap-board-bar.js";
import { TIE_WRITE_DELAY_MS } from "./relmap-tie-bar.js";

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
	 */
	constructor(root, { surface, personAt, onField, onPicked, canEdit = () => true } = {}) {
		super(root, {
			bar: ".stonetop-relmap-personbar",
			press: "relmap-pbar",
			writing: { field: "subtitle", key: "subtitle" },
			held: PERSON_HELD,
		}, { surface, onField, onPicked, canEdit });
		this._personAt = personAt ?? (() => null);
		this.subtitle = this._field;
		this._wire();
	}

	_wire() {
		if (!this.el) return;
		if (this.subtitle) {
			this._on(this.subtitle, "input", () => this._defer("subtitle"));
			this._on(this.subtitle, "blur", () => this.flush());
			this._on(this.subtitle, "change", ev => ev.stopPropagation());
		}
		super._wire();
	}

	_key(ev) {
		if (ev.key === "Escape") {
			ev.preventDefault();
			ev.stopPropagation();
			// Back to what the document has: Escape is the way out of a label thought better of.
			this._forgetWriting();
			this.dismiss();
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
		this._at = held.at ?? this._at;
		this._lift = held.lift ?? this._lift;
		this._onPicked(this.id);
		this.place();
	}

	destroy() {
		super.destroy();
		this.subtitle = null;
	}
}
