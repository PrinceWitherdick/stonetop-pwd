// What the two bars that float over a relationship map have in common: the line's
// (utils/relmap-tie-bar.js) and the group's (utils/relmap-group-bar.js).
//
// WRITTEN ONCE BECAUSE IT HAD BEEN WRITTEN TWICE. The group bar was built as the tie bar's smaller
// sibling and came out carrying a copy of its machinery: the listeners it has to take back off, the
// sentence held back a breath before it is written, the arithmetic that floats it over one point of
// a board that pans, the keys it claims from core and the arrow-key walk along a row of presses. Two
// copies of that are two places for the next fix to land in only one of -- and a bar that leaks
// Delete to the scene, or loses a half-typed name to a repaint, is not a fault a table would ever
// trace back to which of the two bars it happened on.
//
// ⚠ ONLY WHAT THE TWO DO THE SAME IS HERE. Where they differ they differ on purpose, and that stays
// with the bar it belongs to: the eight seats the tie bar tries so as to keep off its own stroke, its
// panels and the colours held back beside the caption, what Escape and Enter each mean, and which
// keys each lets through.
//
// THE HOUSE RULES BOTH KEEP, said at length in the tie bar and once more here:
//
//  • THEY LIVE IN THE VIEWPORT AND NOT ON THE BOARD. The board's markup is replaced on every live
//    update, and a bar drawn on it would go with it, half-typed words and the focus included. Out
//    here a bar survives every repaint and is only re-placed; nothing moves it except `place`.
//  • THEY ARE PLACED IN SCREEN PIXELS, NOT BOARD PERCENTAGES. A bar riding the board's transform
//    would shrink to nothing at the zoom a forty-person map is read at.
//  • THEY WRITE ONTO MARKUP A RENDER LEFT STANDING (`hidden`, never behind an `{{#if}}`), and carry
//    no i18n: every word they show arrives on the markup.
//  • WHAT IS TYPED IS HELD BACK BEFORE IT IS WRITTEN, so a sentence typed out is one broadcast and one
//    step of the undo rather than one per letter. `isWriting` is what the window's repaint asks
//    before it paints over a field.
//  • KEYS ARE CLAIMED ON THE BAR AND STOPPED, because core's KeyboardManager listens in the bubble
//    phase and never looks at `defaultPrevented`.

import { deepenInk, normalizeHex } from "../relmap/relmap-ink.js";

/** The four keys that walk a row of presses, and which way along it each one goes. */
const ROVE_ARROWS = Object.freeze({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 });

/**
 * Mark exactly one of a group as chosen -- in the class, in the ARIA, and in the TAB ORDER.
 *
 * ⚠ THE TAB ORDER IS THE THIRD OF THOSE AND IS NOT DECORATION. These are `role="radio"` buttons in
 * a `role="radiogroup"`, and a radio group is ONE tab stop with the arrow keys inside it. Left as
 * ordinary buttons, a bar would put a stop at every one of them between the board and whatever
 * comes after it -- on a floating strip a reader arrives at by clicking the board, which is the worst
 * place in the window to lose somebody. So exactly one button per group is reachable by Tab (the
 * one that is set), and `RelmapBoardBar#_rove` moves the focus between the rest.
 *
 * ⚠ AND A HIDDEN BUTTON IS NOT IN THE GROUP AT ALL. The tie bar's palette carries a fixed set of
 * slots for the colours already on the board and shows only as many as there are -- a `hidden` slot
 * given the tab stop is a group with no reachable button in it, which is a radiogroup a keyboard
 * cannot enter.
 *
 * ⚠ `may` IS FOR THE ONE GROUP WHOSE ANSWER HONESTLY MIGHT NOT BE ON THE LIST. Everywhere else, a
 * value that matches no button is a template that has drifted from the store, and the first button
 * taking the mark is a defence against a group nobody can reach. The sizes are different in kind: a
 * reader may type any number in the bounds, and 22 is a perfectly good answer that no step stands
 * for -- so the first step must NOT come up looking pressed, which would say the line is set in ten
 * when it is set in twenty-two. Passed `false`, nothing shows as chosen and the tab stop goes to the
 * first button anyway, because the group still has to be reachable.
 *
 * `key` is the dataset field a button's value is read from, which is how both bars share this.
 */
export function markChosen(buttons, value, { may = true, key = "relmapTieValue" } = {}) {
	// A group whose stored answer is not among its buttons -- which cannot happen from the store,
	// but can from a template that has drifted -- would otherwise have NO tab stop at all and be
	// unreachable. The first button takes it in that case.
	const list = [...buttons].filter(button => !button.hidden);
	const found = list.some(button => button.dataset?.[key] === value);
	list.forEach((button, index) => {
		const first = index === 0;
		const mine = found ? button.dataset?.[key] === value : may && first;
		button.classList?.toggle("is-chosen", mine);
		button.setAttribute?.("aria-checked", mine ? "true" : "false");
		button.setAttribute?.("tabindex", mine || (!found && first) ? "0" : "-1");
	});
}

/** `relmap-tie` -> `relmapTie`: the attribute as `dataset` spells it. */
const datasetKey = attr => String(attr ?? "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

export class RelmapBoardBar {
	/**
	 * @param {HTMLElement} root  the window's root element.
	 * @param {object} parts  what this bar IS, which the bar knows and the window does not.
	 * @param {string} parts.bar  the selector of the bar's own element, in the viewport.
	 * @param {string} parts.press  the data attribute every control on the bar carries, without its
	 *        `data-` (`relmap-tie`, `relmap-gbar`). Its value says which control it is.
	 * @param {object} [parts.writing]  the one field a reader types into, as `{field, key}`: the
	 *        `press` value that finds it, and the stored field what is typed there is written as.
	 *        Its held write is the row of `held` under the same name.
	 * @param {object} [parts.held]  what this bar holds back before writing, as
	 *        `{kind: {ms, flush: bar => *}}`: how long each waits, and what writing it is. See `_defer`.
	 * @param {object} [parts.spacing]  `{gap, edge, drop}`, in screen pixels, for the plain seat a bar
	 *        takes over its point: see `_seat`. A bar that chooses its own seat needs none.
	 * @param {object} handlers
	 * @param {Function} handlers.surface  `() => ZoomPanSurface|null` -- asked rather than held,
	 *        because a re-render builds a new one and the bar outlives that.
	 * @param {Function} handlers.onField  `(id, fields) => Promise` -- write these fields.
	 * @param {Function} handlers.onPicked  `id => void` -- mark what on the board this bar belongs to,
	 *        or nothing for "". The board's markup is the window's to walk, not the bar's.
	 * @param {Function} handlers.canEdit  `() => boolean` -- re-asked per gesture, as everything else
	 *        on this board is: ownership can change under an open window.
	 */
	constructor(root, { bar, press, writing = null, held = {}, spacing = null } = {}, {
		surface, onField, onPicked, canEdit = () => true,
	} = {}) {
		this.root = root ?? null;
		this._surface = surface ?? (() => null);
		// ⚠ A WRITE STARTED HERE IS THE WINDOW'S TO KEEP TRACK OF, not the bar's: every one goes through
		// the window's own write (RelationshipMapWindow `_write`), which an undo waits on.
		this._onField = onField ?? (() => {});
		this._onPicked = onPicked ?? (() => {});
		this._canEdit = canEdit;
		// ⚠ NOT `_press`, which is the name both bars give the method a click on a control calls.
		this._pressAttr = press;
		this._pressKey = datasetKey(press);
		this._writing = writing;
		this._held = held;
		this._spacing = spacing;

		this.el = root?.querySelector?.(bar) ?? null;
		/** The field a reader types into. Each bar also keeps it under its own name. */
		this._field = writing
			? this.el?.querySelector?.(`[data-${press}='${writing.field}']`) ?? null
			: null;
		// The viewport this bar is clamped into, found ONCE. `place()` runs on every painted frame of
		// a pan, and a lookup per frame is a lookup per frame for an element that cannot change: a bar
		// is thrown away and rebuilt with the root it was given.
		this._view = root?.querySelector?.(".stonetop-relmap-view") ?? null;

		/** Which thing on the board is open, or "" for none. */
		this.id = "";
		/**
		 * Where on the board (in percentages) the point this bar floats over is.
		 *
		 * ⚠ REMEMBERED RATHER THAN ASKED FOR IN `place()`, which is the difference between a pan
		 * that costs one style write per frame and one that rebuilds the board's whole geometry
		 * sixty times a second. Nothing can move it without a repaint, and a repaint calls
		 * `refresh`, which is where it is written.
		 */
		this._at = null;
		/**
		 * The bar's own box, measured once per opening rather than once per frame.
		 *
		 * Its width is a fixed field and fixed rows of presses, so nothing but its CONTENTS changing
		 * can move it -- and every place that changes them throws this away: `open`, `refresh`, and
		 * on the group bar the two membership buttons coming and going with the selection.
		 */
		this._box = null;
		/** What the field said when it was last in step with the document. */
		this._saved = "";
		/**
		 * The pending write for each row of `held`: 0 when nothing is waiting.
		 *
		 * One object rather than a field apiece so that `isWriting` and `destroy` can ask about all
		 * of them at once, and so that neither can be left behind when another is added.
		 */
		this._timers = Object.fromEntries(Object.keys(held).map(kind => [kind, 0]));
		/** Where the focus goes when the bar is dismissed with Escape. */
		this._returnTo = null;
		this._bound = [];
	}

	/** Whether anything is open. */
	get isOpen() { return !!this.id && !!this.el && !this.el.hidden; }

	/**
	 * Is there anything the reader has settled that the document does not have yet?
	 *
	 * Every row of `held` is asked: each is held back briefly before it is written, and a repaint
	 * arriving in any of those gaps would paint over the answer under the reader's hand.
	 *
	 * ⚠ THE WINDOW'S REPAINT ASKS THIS, and it is the affirmative guard the old `_isBusy` note said
	 * to add if a text field ever landed on that window. A repaint does not touch a bar -- it is
	 * outside the board -- but it DOES rebuild what is underneath, and the write that follows would
	 * then land on a board the reader had gone on typing over. Asked about unsaved WRITING rather
	 * than about focus: a field somebody is merely resting in obstructs nothing.
	 */
	isWriting() {
		return this.isOpen && Object.values(this._timers).some(Boolean);
	}

	// ── Wiring ──────────────────────────────────────────────────────────────

	/** Listen, and remember to stop: `destroy` takes back every listener added through here. */
	_on(el, type, handler, opts) {
		if (!el?.addEventListener) return;
		el.addEventListener(type, handler, opts);
		this._bound.push([el, type, handler, opts]);
	}

	/**
	 * What every bar wires: the keys. Each bar wires its own controls and then asks for this.
	 *
	 * ⚠ CLAIMED ON THE BAR ITSELF, and stopped rather than merely defaulted. Core's KeyboardManager
	 * binds keydown in the BUBBLE phase and never looks at `defaultPrevented`, so an Escape meant to
	 * dismiss a bar closes the whole window as well, a Space on one of its buttons pauses the game,
	 * and the arrow keys inside its field pan the scene behind it. The board's own keydown handler
	 * (utils/relmap-drag.js) has the same note for the same reason. What each key MEANS is the bar's
	 * own, in `_key`.
	 */
	_wire() {
		this._on(this.el, "keydown", ev => this._key(ev));
		if (this.inkHex) {
			// ⚠ THE ELEMENT'S OWN `change`, NOT ITS TWO INPUTS'. `HTMLColorPickerElement` stops the
			// events its hex field and its swatch fire and dispatches one of its own from the value
			// setter, which is the only one that has been through its own normalising.
			this._on(this.inkHex, "change", ev => {
				// Painting is not choosing: see `_paintPicker`. Stopped as well as ignored, because
				// this event bubbles and the window has its own `change` handlers on the bar above.
				ev.stopPropagation();
				if (this._paintingInk) return;
				this._pickCustomInk(this.inkHex.value ?? "");
			});
		}
	}

	/** One key pressed somewhere on the bar. Every bar answers this for itself. */
	_key(_ev) {}

	/**
	 * The arrow keys inside one row of presses: the focus walks along it, wrapping.
	 *
	 * ⚠ FOCUS MOVES AND THE ANSWER DOES NOT, which is the one place this departs from what a plain
	 * radio group does. Every one of these presses WRITES TO A SHARED DOCUMENT the moment it is
	 * made, so "selection follows focus" would mean arrowing across a row wrote every answer on the
	 * way past onto everybody's board. The reader chooses with Space or Enter, which is what the
	 * button does for itself. (ARIA allows exactly this for a group whose selection has side
	 * effects, and it is why these are buttons rather than inputs.)
	 *
	 * ⚠ AN ARROW ANYWHERE ON THE BAR IS STOPPED, ROW OR NOT. One that reached core's KeyboardManager
	 * would pan the scene behind this window -- from a field's caret as much as from a press. Off a
	 * row it is stopped and NOT prevented, so the caret and the spinner still move.
	 *
	 * @param {KeyboardEvent} ev
	 * @param {string[]} groups  the `press` values that are rows of presses, walked like this.
	 * @param {Function} [stride]  `button => number`: how far Up and Down step from this button.
	 *        One, which is a single row's answer, unless the bar knows its row is a grid.
	 * @returns {boolean} whether the key was a row's.
	 */
	_rove(ev, groups, stride = () => 1) {
		const way = ROVE_ARROWS[ev.key];
		if (!way) return false;
		ev.stopPropagation();
		const button = ev.target?.closest?.(`[data-${this._pressAttr}]`);
		const what = button?.dataset?.[this._pressKey];
		if (!groups.includes(what)) return false;
		ev.preventDefault();
		// A hidden slot is not in the group: see `markChosen`. Arrowing onto one would move the
		// focus to something nobody can see, which reads as the arrow keys having stopped working.
		const list = [...(this.el?.querySelectorAll?.(`[data-${this._pressAttr}='${what}']`) ?? [])]
			.filter(one => !one.hidden);
		const at = list.indexOf(button);
		if (at < 0 || !list.length) return true;
		const upDown = ev.key === "ArrowUp" || ev.key === "ArrowDown";
		const step = way * (upDown ? stride(button) : 1);
		// Wrapping, as a radio group does: a short row of presses is exactly the case where running
		// off the end and stopping feels like the control has jammed. A row's stride wraps the same
		// way, which lands a reader stepping down off the last row of a grid back near its top.
		const next = list[((at + step) % list.length + list.length) % list.length];
		// The focus has to be able to LAND, and only the set button carries a tab stop.
		next?.setAttribute?.("tabindex", "0");
		button?.setAttribute?.("tabindex", "-1");
		next?.focus?.();
		return true;
	}

	// ── Letting go ──────────────────────────────────────────────────────────

	/** Let go, writing anything outstanding. */
	close() {
		if (!this.el) return;
		// ⚠ NOTHING HELD, NOTHING TO PUT DOWN. Every click that lands on bare board comes through
		// here, and there is no mark to take off a board this bar was never opened over.
		if (!this.id) { this.el.hidden = true; return; }
		this.flush();
		this._letGo();
		this.id = "";
		this._returnTo = null;
		this._at = null;
		this._box = null;
		this.el.hidden = true;
		this._onPicked("");
	}

	/** Whatever else a bar has to put down as it lets go, after the flush and before the id goes. */
	_letGo() {}

	/** Let go WITHOUT writing, for a thing whose board has gone out from under the reader. */
	discard() {
		this._forgetWriting();
		this.close();
	}

	/**
	 * Let go and put the focus back where the reader came from.
	 *
	 * `returnTo` may be a FUNCTION that finds the element, asked only now. The board is repainted
	 * wholesale under an open bar, and the element the reader came from is replaced each time: a group
	 * just drawn is named in a bar raised by the repaint that drew it, and an element remembered before
	 * that paint is no longer on the page to take the focus. Left on `<body>`, the next key went to
	 * Foundry -- Delete removing the GM's selected tokens, the arrows panning the scene.
	 */
	dismiss() {
		const back = typeof this._returnTo === "function" ? this._returnTo() : this._returnTo;
		this.close();
		back?.focus?.();
	}

	// ── Placing ─────────────────────────────────────────────────────────────

	/**
	 * Put the bar back over its point, wherever the board has got to.
	 *
	 * Called from the surface's `onChange`, so it runs on every painted frame of a pan and every
	 * zoom step, and NOTHING IN IT MAY MEASURE. It runs immediately after the surface has written a
	 * transform and the caption pass has toggled a class on the root, so every read here is a forced
	 * style-and-layout flush over a board carrying forty portraits and a hundred and sixty paths.
	 * So: the surface is asked for the viewport's size (it keeps that measured anyway), the viewport
	 * element was found in the constructor, and the bar's own box is measured once per opening.
	 *
	 * WHERE OVER THE POINT is `_seat`'s to say, which is the one part the two bars do differently.
	 */
	place() {
		if (!this.isOpen || !this.el) return;
		const surface = this._surface();
		const at = this._at;
		if (!surface || !at) return;

		const painted = surface.painted?.();
		const offset = surface.offset;
		if (!painted?.width || !offset) return;

		const x = offset.x + (painted.width * (at.left ?? 0)) / 100;
		const y = offset.y + (painted.height * (at.top ?? 0)) / 100;

		this._box ??= this.el.getBoundingClientRect?.() ?? { width: 0, height: 0 };
		// The measured viewport where the surface has one, and its box otherwise -- which is what a
		// surface that has not been attached to a real element can offer.
		//
		// ⚠ ASKED OF THE MEASUREMENT AND NOT OF THE OBJECT. `viewSize` is a getter that always
		// hands back a pair, so `??` never reached the fallback: a surface that has not been
		// measured yet answers {0, 0}, and the clamp then pins the bar to the top-left corner of
		// the board instead of floating it over its point.
		const measured = surface.viewSize;
		const room = measured?.width
			? measured
			: this._view?.getBoundingClientRect?.() ?? { width: 0, height: 0 };
		const w = this._box.width || 0;
		const h = this._box.height || 0;

		const seat = this._seat({ x, y, w, h, room, offset, painted });
		this.el.style.left = `${Math.round(seat.left)}px`;
		this.el.style.top = `${Math.round(seat.top)}px`;
	}

	/**
	 * The plain seat: centred over the point and above it where there is room, dropped under it
	 * where there is not, and always inside the viewport. All in screen pixels, from `spacing`.
	 *
	 * Enough for a point with nothing around it the bar has to keep off, which is a group's name.
	 * The tie bar's point is the middle of a line that runs on either side of it, and seats itself.
	 *
	 * @returns {{left: number, top: number}}
	 */
	_seat({ x, y, w, h, room }) {
		const { gap = 0, edge = 0, drop = 0 } = this._spacing ?? {};
		// `Math.max` last, or a viewport narrower than the bar pushes it off the left rather than
		// the right -- and the left is the edge a reader cannot pan back to.
		const maxLeft = Math.max(edge, (room.width || 0) - w - edge);
		const maxTop = Math.max(edge, (room.height || 0) - h - edge);
		const above = y - h - gap;
		return {
			left: Math.max(edge, Math.min(x - w / 2, maxLeft)),
			top: above >= edge ? above : Math.min(y + drop, maxTop),
		};
	}

	// ── Writing ─────────────────────────────────────────────────────────────

	/**
	 * Hold one of `held`'s answers back, and write it when the reader stops.
	 *
	 * @param {string} kind  which held answer to arm. Re-arming restarts its wait.
	 */
	_defer(kind) {
		this._disarm(kind);
		const { ms, flush } = this._held[kind];
		this._timers[kind] = setTimeout(() => { this._timers[kind] = 0; flush(this); }, ms);
	}

	/** Stop one held answer's write from landing. What was held is left alone; see the `_forget`s. */
	_disarm(kind) {
		if (this._timers[kind]) { clearTimeout(this._timers[kind]); this._timers[kind] = 0; }
	}

	/**
	 * Throw away what is typed and not written yet, so nothing later saves it.
	 *
	 * The field goes back to what the document has rather than merely being disarmed, because
	 * `_flushWriting` compares the two: a timer cancelled but a field left holding newer words is a
	 * write waiting for the next blur. Escape takes the same two steps for the same reason.
	 */
	_forgetWriting() {
		if (!this._writing) return;
		this._disarm(this._writing.field);
		if (this._field) this._field.value = this._saved;
	}

	/**
	 * Write what is in the field, if it says anything the document does not already have.
	 * @returns {Promise<*>|undefined}  the write, where there was one.
	 */
	_flushWriting() {
		if (!this._writing) return undefined;
		this._disarm(this._writing.field);
		if (!this.id || !this._field) return undefined;
		const said = this._field.value ?? "";
		if (said === this._saved) return undefined;
		// ⚠ SAID, NOT DROPPED QUIETLY. Edit rights taken away mid-sentence (the GM changing who owns the
		// map) used to throw the words away with nothing on screen to say so.
		// Once per lot of words, though: every later flush (the next blur, a board switch, Undo,
		// closing) would otherwise say it again about the same words.
		if (!this._canEdit()) {
			if (this._lostSaid !== said) {
				this._lostSaid = said;
				globalThis.ui?.notifications?.warn?.(globalThis.game?.i18n?.localize?.("stonetop.relmap.editLost") ?? "");
			}
			return undefined;
		}
		this._saved = said;
		return this._onField(this.id, { [this._writing.key]: said });
	}

	// ── A colour of the reader's own ─────────────────────────────────────────
	// Both bars hold a picked colour in `_inkPending` under their `held.ink`, and seed one picker.

	/** Throw away a colour that has not been written yet, so nothing later saves it. */
	_forgetInk() {
		this._disarm("ink");
		this._inkPending = "";
	}

	/** Write the chosen colour, if one is waiting. */
	_flushInk() {
		this._disarm("ink");
		const ink = this._inkPending;
		this._inkPending = "";
		if (!ink || !this.id || !this._canEdit()) return undefined;
		return this._onField(this.id, { ink });
	}

	/**
	 * Set what the colour picker (`inkHex`) is holding. ⚠ WRITTEN BEHIND THE FLAG: assigning to its
	 * `value` makes it dispatch `change`, which is indistinguishable from the reader having chosen,
	 * so each bar's `change` handler ignores it while `_paintingInk` is up.
	 */
	_paintPicker(hex) {
		const picker = this.inkHex;
		if (!picker || !hex || picker.value === hex) return;
		this._paintingInk = true;
		try { picker.value = hex; } finally { this._paintingInk = false; }
	}

	/**
	 * A colour the reader chose for themselves: check it can be followed, then treat it as any pick.
	 *
	 * ⚠ DEEPENED RATHER THAN REFUSED, and the reader is TOLD. A dialog that says no to a colour has
	 * taken the choice away and given nothing back; what somebody picking a pale yellow wants is a
	 * yellow line, and there is one -- a darker one. So the hue is kept and only the lightness moves,
	 * the picker is set to what was actually used so its swatch is not lying about the board, and
	 * `onNudged` says what happened. See `deepenInk`. Held back a breath before it is written.
	 *
	 * What showing the colour means is each bar's own `_markInk`, which with `_hexAsked` up keeps the
	 * picker open on the deepened hex.
	 */
	_pickCustomInk(said) {
		if (!this.id || !this._canEdit()) return;
		const chose = normalizeHex(said);
		// A half-typed hex in the picker's text field is not a colour yet. Ignored rather than
		// refused out loud: the reader is still typing it.
		if (!chose) return;
		const { hex, nudged, ratio } = deepenInk(chose);
		if (!hex) return;
		if (nudged) this._onNudged(chose, hex, ratio);
		this._hexAsked = true;
		this._inkPending = hex;
		this._markInk(hex);
		this._defer("ink");
	}

	/**
	 * Write everything the reader has settled that the document does not have yet: here, the field.
	 * A bar that holds back more than that says so in its own.
	 * @returns {Promise<*>|undefined}  the write, where there was one to make.
	 */
	flush() {
		return this._flushWriting();
	}

	destroy() {
		// EVERY HELD ANSWER, from the table rather than by hand: a timer missed here is a write
		// landing on a bar that no longer exists.
		for (const kind of Object.keys(this._held)) this._disarm(kind);
		for (const [el, type, handler, opts] of this._bound) {
			el.removeEventListener?.(type, handler, opts);
		}
		this._bound = [];
		this.id = "";
		if (this.el) this.el.hidden = true;
		this.el = null;
		this._field = null;
		this._view = null;
		this.root = null;
	}
}
