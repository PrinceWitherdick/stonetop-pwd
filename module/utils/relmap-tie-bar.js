// The bar that appears over a line on a relationship map when somebody clicks it: what the line
// says, what colour it is, which way it is read, and whether its stroke is broken.
//
// WHY THIS EXISTS AT ALL. Clicking a line opened a modal window asking six questions. Four of them
// are the ones a table changes while they are talking -- the words, the colour, the arrows, the
// dashes -- and a window that has to be opened, aimed at and dismissed for each is four windows
// between one thought and the next. The other two (what family tie this is, and the notes behind
// the line) are real questions that are simply not asked forty times an evening, so the dialog is
// still there and the last button on this bar opens it.
//
// ⚠ IT LIVES IN THE VIEWPORT AND NOT ON THE BOARD, and that is not a positioning convenience. The
// board's markup is REPLACED wholesale on every live update -- somebody else at the table moving a
// portrait rewrites its innerHTML -- so a bar drawn on the board would be destroyed under the
// reader's hands mid-sentence, taking a half-typed caption and the focus with it. Out in the
// viewport it survives every repaint and is only re-placed. That is also why `place()` is called
// from the surface's `onChange`: nothing moves this thing except being told to.
//
// ⚠ AND IT IS PLACED IN SCREEN PIXELS, NOT BOARD PERCENTAGES. The board is scaled and rotated type
// is set on it; this is chrome. A bar that rode the board's transform would shrink to nothing at
// the zoom a forty-person map is read at, which is exactly the board that most needs it.

import { RELMAP_DASH_DEFAULT, RELMAP_DIR_DEFAULT, RELMAP_INK_DEFAULT } from "../relmap/relmap-store.js";

/**
 * How long the caption field sits still before what is in it is written to the shared document.
 *
 * A WRITE PER KEYSTROKE IS A BROADCAST PER KEYSTROKE. Every client at the table repaints its board
 * on each one, and the board is not a cheap thing to repaint -- so typing a sentence would repaint
 * everybody else's map thirty times, each one throwing away the lit web under their pointer.
 *
 * AND IT IS NOT THE ONLY WAY OUT. Enter writes at once, closing the bar writes, and so does the
 * window asking whether it may repaint (`isWriting`), so nothing waits on this timer to be saved --
 * it only decides how quiet the field has to go before the save happens by itself.
 */
export const TIE_WRITE_DELAY_MS = 600;

/** How far above the line the bar floats, and how near the viewport's edges it may come. */
const TIE_BAR_GAP_PX = 14;
const TIE_BAR_EDGE_PX = 6;

/** Which way each one-way arrow points, given a line whose second end is to the RIGHT of its first. */
const DIR_ICONS = {
	rightwards: { "a-b": "fa-arrow-right-long", "b-a": "fa-arrow-left-long" },
	leftwards: { "a-b": "fa-arrow-left-long", "b-a": "fa-arrow-right-long" },
};

/**
 * The icon each direction button is BUILT with, keyed by the answer it stands for.
 *
 * Exported because the window prints these buttons from `RELMAP_DIRS` rather than writing four of
 * them out by hand, and the icons are the one thing that table cannot supply. The two one-way ones
 * start out pointing rightwards and are rewritten by `_nameDirs` from where the faces actually are.
 */
export const TIE_DIR_ICONS = Object.freeze({
	none: "fa-minus",
	"a-b": DIR_ICONS.rightwards["a-b"],
	"b-a": DIR_ICONS.rightwards["b-a"],
	both: "fa-arrows-left-right",
});

/** The groups on the bar that are one-of-N, in the order a reader meets them. */
const TIE_GROUPS = ["ink", "dir", "dash"];

/**
 * Mark exactly one of a group as chosen -- in the class, in the ARIA, and in the TAB ORDER.
 *
 * ⚠ THE TAB ORDER IS THE THIRD OF THOSE AND IS NOT DECORATION. These are `role="radio"` buttons in
 * a `role="radiogroup"`, and a radio group is ONE tab stop with the arrow keys inside it. Left as
 * fourteen ordinary buttons, this bar would put fourteen stops between the board and whatever comes
 * after it -- on a floating strip a reader arrives at by clicking a line, which is the worst place
 * in the window to lose somebody. So exactly one button per group is reachable by Tab (the one that
 * is set), and `_groupKey` moves the focus between the rest.
 */
function markChosen(buttons, value) {
	// A group whose stored answer is not among its buttons -- which cannot happen from the store,
	// but can from a template that has drifted -- would otherwise have NO tab stop at all and be
	// unreachable. The first button takes it in that case.
	const list = [...buttons];
	const found = list.some(button => button.dataset?.relmapTieValue === value);
	list.forEach((button, index) => {
		const mine = found ? button.dataset?.relmapTieValue === value : index === 0;
		button.classList?.toggle("is-chosen", mine);
		button.setAttribute?.("aria-checked", mine ? "true" : "false");
		button.setAttribute?.("tabindex", mine ? "0" : "-1");
	});
}

export class RelmapTieBar {
	/**
	 * @param {HTMLElement} root  the window's root element.
	 * @param {object} handlers
	 * @param {Function} handlers.surface   `() => ZoomPanSurface|null` — asked rather than held,
	 *                   because a re-render builds a new one and this bar outlives that.
	 * @param {Function} handlers.tieAt     `id => {edge, from, to, at}|null` — everything about one
	 *                   line as it stands RIGHT NOW: its stored fields, the two people's names, and
	 *                   where on the board (in percentages) the bar should sit. Null when the line
	 *                   is not on this board any more, which closes the bar.
	 * @param {Function} handlers.onField   `(id, fields) => Promise` — write these fields.
	 * @param {Function} handlers.onMore    `id => void` — open the full editor.
	 * @param {Function} handlers.onPicked  `id => void` — mark which stroke on the board this bar
	 *                   belongs to, or none for "". The BOARD'S OWN MARKUP IS THE BOARD'S: its
	 *                   strokes, targets and captions are built and replaced by the window, and a bar
	 *                   that walked them for itself would be a second module enumerating the same
	 *                   three element families -- which is how the invisible hit layer came to need
	 *                   adding in two places at once.
	 * @param {Function} handlers.canEdit   `() => boolean` — re-asked per gesture, as everything
	 *                   else on this board is: ownership can change under an open window.
	 */
	constructor(root, { surface, tieAt, onField, onMore, onPicked, canEdit = () => true } = {}) {
		this.root = root ?? null;
		this._surface = surface ?? (() => null);
		this._tieAt = tieAt ?? (() => null);
		this._onField = onField ?? (() => {});
		this._onMore = onMore ?? (() => {});
		this._onPicked = onPicked ?? (() => {});
		this._canEdit = canEdit;

		this.el = root?.querySelector?.(".stonetop-relmap-tiebar") ?? null;
		this.words = this.el?.querySelector?.("[data-relmap-tie='words']") ?? null;
		// The viewport this bar is clamped into, found ONCE. `place()` runs on every painted frame of
		// a pan, and a lookup per frame is a lookup per frame for an element that cannot change: this
		// bar is thrown away and rebuilt with the root it was given.
		this._view = root?.querySelector?.(".stonetop-relmap-view") ?? null;

		/** Which line is open, or "" for none. */
		this.id = "";
		/**
		 * Where on the board (in percentages) that line's middle is.
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
		 * Its width is a fixed field and a fixed row of presses, so nothing but its CONTENTS changing
		 * can move it -- and the two places that change them (`open` and `refresh`) throw this away.
		 */
		this._box = null;
		/** What the caption said when the field was last in step with the document. */
		this._saved = "";
		this._timer = 0;
		/** Where the focus goes when the bar is dismissed with Escape. */
		this._returnTo = null;
		this._bound = [];

		this._wire();
	}

	/** Whether a line is open. */
	get isOpen() { return !!this.id && !!this.el && !this.el.hidden; }

	/**
	 * Is there writing in the field that the document does not have yet?
	 *
	 * ⚠ THE WINDOW'S REPAINT ASKS THIS, and it is the affirmative guard the old `_isBusy` note said
	 * to add if a text field ever landed on this window. A repaint does not touch this bar -- it is
	 * outside the board -- but it DOES rebuild the lines underneath, and the write that follows
	 * would then land on a caption the reader had gone on typing into. Asked about unsaved WRITING
	 * rather than about focus: a field somebody is merely resting in obstructs nothing.
	 */
	isWriting() {
		return this.isOpen && !!this._timer;
	}

	// ── Wiring ──────────────────────────────────────────────────────────────

	_on(el, type, handler, opts) {
		if (!el?.addEventListener) return;
		el.addEventListener(type, handler, opts);
		this._bound.push([el, type, handler, opts]);
	}

	_wire() {
		if (!this.el) return;

		for (const button of this.el.querySelectorAll("[data-relmap-tie]")) {
			const what = button.dataset.relmapTie;
			if (what === "words") continue;
			this._on(button, "click", ev => {
				ev.preventDefault();
				ev.stopPropagation();
				this._press(what, button.dataset.relmapTieValue ?? "");
			});
		}

		if (this.words) {
			// EVERY keystroke arms the timer; nothing writes until it runs out. See TIE_WRITE_DELAY_MS.
			this._on(this.words, "input", () => this._arm());
			// A field that loses the focus has finished being typed into, whatever the timer thinks.
			this._on(this.words, "blur", () => this.flush());
		}

		// ⚠ CLAIMED ON THE BAR ITSELF, and stopped rather than merely defaulted. Core's
		// KeyboardManager binds keydown in the BUBBLE phase and never looks at `defaultPrevented`,
		// so an Escape meant to dismiss this bar closes the whole window as well, and the arrow keys
		// inside the caption field pan the scene behind it. The board's own keydown handler
		// (utils/relmap-drag.js) has the same note for the same reason.
		this._on(this.el, "keydown", ev => this._key(ev));
	}

	_key(ev) {
		if (this._groupKey(ev)) return;
		if (ev.key === "Escape") {
			ev.preventDefault();
			ev.stopPropagation();
			// The writing goes back to what the document has: Escape is the way OUT of a sentence
			// somebody has thought better of, and one that saved it would leave no way out at all.
			if (this.words) this.words.value = this._saved;
			this._disarm();
			// `dismiss` and not `close`: a reader who opened this from the keyboard has to be put
			// back on the caption they pressed Enter on, rather than at the top of the window.
			this.dismiss();
			return;
		}
		if (ev.key === "Enter" && ev.target === this.words) {
			ev.preventDefault();
			ev.stopPropagation();
			this.flush();
			return;
		}
		// Everything else the field takes is the field's own business, and none of it is the
		// scene's. Only the arrows and Delete would otherwise reach the canvas, but a list of keys
		// to stop is a list to keep in step with core; the field simply keeps what it is given.
		if (ev.target === this.words) ev.stopPropagation();
	}

	/**
	 * The arrow keys inside one group of presses.
	 *
	 * ⚠ FOCUS MOVES AND THE ANSWER DOES NOT, which is the one place this departs from what a plain
	 * radio group does. Every one of these presses WRITES TO A SHARED DOCUMENT the moment it is
	 * made, so "selection follows focus" would mean arrowing from rose to slate wrote four colours
	 * onto everybody's board on the way past. The reader chooses with Space or Enter, which is what
	 * the button does for itself. (ARIA allows exactly this for a group whose selection has side
	 * effects, and it is why these are buttons rather than inputs.)
	 *
	 * @returns {boolean} whether the key was this group's.
	 */
	_groupKey(ev) {
		const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[ev.key];
		if (!step) return false;
		const button = ev.target?.closest?.("[data-relmap-tie]");
		const what = button?.dataset?.relmapTie;
		if (!TIE_GROUPS.includes(what)) return false;
		ev.preventDefault();
		// Stopped whatever comes of it: an arrow that reached core's KeyboardManager would pan the
		// scene behind this window, which is the note every keydown handler on this board carries.
		ev.stopPropagation();
		const list = [...(this.el?.querySelectorAll?.(`[data-relmap-tie='${what}']`) ?? [])];
		const at = list.indexOf(button);
		if (at < 0 || !list.length) return true;
		// Wrapping, as a radio group does: eight colours in a row is exactly the case where running
		// off the end and stopping feels like the control has jammed.
		const next = list[(at + step + list.length) % list.length];
		// The focus has to be able to LAND, and only the set button carries a tab stop.
		next?.setAttribute?.("tabindex", "0");
		button?.setAttribute?.("tabindex", "-1");
		next?.focus?.();
		return true;
	}

	_press(what, value) {
		if (!this.id || !this._canEdit()) return;
		if (what === "more") {
			const id = this.id;
			// Written first: the dialog is about to ask the same question this field answers, and
			// two windows disagreeing about what a line says is the one thing worse than either.
			//
			// ⚠ AND WAITED FOR, WHICH IS THE WHOLE OF IT. The write is a round trip through the
			// document; the editor opens by reading the board SYNCHRONOUSLY. Fired off rather than
			// waited for, the dialog fills itself from the caption as it stood BEFORE this flush
			// lands — so the reader sees the old sentence, and saving puts it back over the one
			// they had just finished typing. `close` flushes too, and finds nothing left to write.
			//
			// Handed back rather than swallowed, exactly as `flush` hands its own write back: the
			// press itself is over, and the only caller that could care is a test waiting for the
			// dialog to have been asked for.
			const written = this.flush();
			this.close();
			return Promise.resolve(written).then(() => this._onMore(id));
		}
		if (!TIE_GROUPS.includes(what)) return;
		// Painted before the write rather than after it. The write is a round trip through the
		// document and comes back as a repaint; a bar that waited for it would sit there looking
		// unpressed for as long as that took, on the one control a reader presses repeatedly.
		this._markGroup(what, value);
		this._onField(this.id, { [what]: value });
	}

	// ── Opening and closing ─────────────────────────────────────────────────

	/**
	 * Take hold of one line.
	 *
	 * @param {string} id  the link.
	 * @param {object} [opts]
	 * @param {HTMLElement} [opts.returnTo]  where the focus goes if this is dismissed with Escape:
	 *        the caption or the stroke the reader came from. A keyboard reader who pressed Enter on
	 *        a caption and then thought better of it must not be dropped at the top of the window.
	 */
	open(id, { returnTo = null } = {}) {
		if (!this.el || !id) return false;
		const tie = this._tieAt(id);
		if (!tie) return false;
		// A DIFFERENT LINE, so whatever was being typed into the last one is written before the
		// field is refilled. Without this, clicking straight from one line to another throws the
		// sentence away silently.
		if (this.id && this.id !== id) this.flush();
		this.id = id;
		this._returnTo = returnTo ?? null;
		this._at = tie.at ?? null;
		this._box = null;
		this._fill(tie);
		this.el.hidden = false;
		this._onPicked(id);
		this.place();
		// After `place`, so the browser does not scroll the field into view at its old position.
		this._focusWords();
		return true;
	}

	/** Let go, writing anything outstanding. */
	close() {
		if (!this.el) return;
		// ⚠ NOTHING HELD, NOTHING TO PUT DOWN. Every click that lands on bare board comes through
		// here, and there is no mark to take off a board this bar was never opened over.
		if (!this.id) { this.el.hidden = true; return; }
		this.flush();
		this.id = "";
		this._returnTo = null;
		this._at = null;
		this._box = null;
		this.el.hidden = true;
		this._onPicked("");
	}

	/** Let go and put the focus back where the reader came from. */
	dismiss() {
		const back = this._returnTo;
		this.close();
		back?.focus?.();
	}

	_focusWords() {
		const field = this.words;
		if (!field?.focus) return;
		field.focus();
		// THE CARET GOES TO THE END and nothing is selected, which is the whole of "click a line and
		// start typing": the next letter is added to what the line already says. Selecting the text
		// would make the first keystroke DELETE the caption, which is the opposite promise.
		const end = field.value?.length ?? 0;
		field.setSelectionRange?.(end, end);
	}

	// ── Painting ────────────────────────────────────────────────────────────

	_fill(tie) {
		const edge = tie.edge ?? {};
		if (this.words) {
			this.words.value = edge.label ?? "";
			this._saved = this.words.value;
			this.words.disabled = !this._canEdit();
		}
		this._disarm();
		this._paintTie(tie);
	}

	/**
	 * Everything on the bar that says what this line IS: which swatch, which arrow, which stroke.
	 *
	 * In one place because opening and refreshing both do exactly this and differ only over the
	 * caption -- and a fifth group added to one of two copies is wrong only AFTER a live update,
	 * which is the failure nobody would find.
	 */
	_paintTie(tie) {
		const edge = tie.edge ?? {};
		this._markGroup("ink", edge.ink || RELMAP_INK_DEFAULT);
		this._markGroup("dir", edge.dir || RELMAP_DIR_DEFAULT);
		this._markGroup("dash", edge.dash || RELMAP_DASH_DEFAULT);
		this._nameDirs(tie);
	}

	/**
	 * Say what each arrow button means, in the two people's own names, and point it the right way.
	 *
	 * ⚠ NEITHER THE WORDS NOR THE ICONS CAN BE WRITTEN IN THE TEMPLATE. Which of the pair is drawn
	 * on the left is a fact about where two portraits happen to be sitting, and it changes the
	 * moment either is dragged: a fixed left arrow would mean "towards Sonya" on one board and
	 * "towards Mike" on the same board a minute later. So both are written from where the faces
	 * actually are, every time the bar opens.
	 */
	_nameDirs(tie) {
		const dirs = this.el?.querySelectorAll?.("[data-relmap-tie='dir']") ?? [];
		// The second end drawn to the RIGHT of the first, or level with it, reads left-to-right.
		const rightwards = (tie.to?.x ?? 0) >= (tie.from?.x ?? 0);
		const icons = rightwards ? DIR_ICONS.rightwards : DIR_ICONS.leftwards;
		// Keyed by the answer each button stands for, the same four `RELMAP_DIRS` holds and the same
		// four the buttons carry: a second vocabulary re-keyed on arrival is two names for one enum.
		const said = tie.said ?? {};
		for (const button of dirs) {
			const key = button.dataset.relmapTieValue;
			const words = said[key] ?? "";
			if (words) {
				button.setAttribute("data-tooltip", words);
				button.setAttribute("aria-label", words);
			}
			const glyph = icons[key];
			const icon = button.querySelector?.("i");
			if (glyph && icon) icon.className = `fas ${glyph}`;
		}
	}

	/** Which button in one group is pressed. */
	_markGroup(what, value) {
		markChosen(this.el?.querySelectorAll?.(`[data-relmap-tie='${what}']`) ?? [], value);
	}

	/**
	 * Put the bar back over its line, wherever the board has got to.
	 *
	 * Called from the surface's `onChange`, so it runs on every painted frame of a pan and every
	 * zoom step, and NOTHING IN IT MAY MEASURE. It runs immediately after the surface has written a
	 * transform and the caption pass has toggled a class on the root, so every read here is a forced
	 * style-and-layout flush over a board carrying forty portraits and a hundred and sixty paths.
	 * So: the surface is asked for the viewport's size (it keeps that measured anyway), the viewport
	 * element was found in the constructor, and the bar's own box is measured once per opening.
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
		// measured yet answers {0, 0}, and the clamp below then pins the bar to the top-left corner
		// of the board instead of floating it over its line.
		const measured = surface.viewSize;
		const room = measured?.width
			? measured
			: this._view?.getBoundingClientRect?.() ?? { width: 0, height: 0 };
		const w = this._box.width || 0;
		const h = this._box.height || 0;

		// ABOVE THE LINE, because the caption is drawn IN the stroke and a bar sitting on top of it
		// would cover the thing being edited. Underneath instead when there is no room above, which
		// is a line near the top of a board zoomed right in.
		let top = y - h - TIE_BAR_GAP_PX;
		if (top < TIE_BAR_EDGE_PX) top = y + TIE_BAR_GAP_PX;
		let left = x - w / 2;

		// Clamped into the viewport, so a line at the edge of a board dragged half off screen still
		// has a bar the reader can reach. `Math.max` last, or a viewport narrower than the bar
		// pushes it off the left instead of the right.
		const maxLeft = Math.max(TIE_BAR_EDGE_PX, (room.width || 0) - w - TIE_BAR_EDGE_PX);
		const maxTop = Math.max(TIE_BAR_EDGE_PX, (room.height || 0) - h - TIE_BAR_EDGE_PX);
		left = Math.max(TIE_BAR_EDGE_PX, Math.min(left, maxLeft));
		top = Math.max(TIE_BAR_EDGE_PX, Math.min(top, maxTop));

		this.el.style.left = `${Math.round(left)}px`;
		this.el.style.top = `${Math.round(top)}px`;
	}

	/**
	 * The board has been repainted underneath: re-take the mark, and let go of a line that has gone.
	 *
	 * ⚠ THE MARK HAS TO BE RE-TAKEN. `is-picked` is a class on markup the repaint has just thrown
	 * away, so without this the bar goes on floating over a board with nothing on it saying which
	 * line it belongs to -- and the reader's next press writes to a line they can no longer see they
	 * chose. It is the same repair `_lightPerson` makes for the lit web, one line further down.
	 *
	 * ⚠ AND THE FIELD IS NOT REFILLED. Somebody else at the table renaming this line while it is
	 * open is a real thing that happens, and the reader typing here has the newer sentence: quietly
	 * replacing what is under their caret is the one outcome nobody would forgive. What is re-read
	 * is everything they are NOT holding -- the colour, the arrows, the dashes -- which is where a
	 * change made elsewhere should show.
	 */
	refresh() {
		if (!this.isOpen) return;
		const tie = this._tieAt(this.id);
		if (!tie) { this.close(); return; }
		// Where it is drawn NOW, which a repaint can have moved: somebody else dragged one of the
		// two faces, or this reader switched to a view that seats them itself.
		this._at = tie.at ?? this._at;
		this._box = null;
		this._paintTie(tie);
		this._onPicked(this.id);
		this.place();
	}

	// ── The caption ─────────────────────────────────────────────────────────

	_arm() {
		this._disarm();
		this._timer = setTimeout(() => { this._timer = 0; this.flush(); }, TIE_WRITE_DELAY_MS);
	}

	_disarm() {
		if (this._timer) { clearTimeout(this._timer); this._timer = 0; }
	}

	/** Write what is in the field, if it says anything the document does not already have. */
	/**
	 * ⚠ IT HANDS BACK WHAT THE WRITE IS DOING, which most callers ignore and one must not. Nearly
	 * everywhere this is a "get it saved and carry on" — a blur, an Escape, a re-render throwing the
	 * bar away. The undo is the exception: it has to know the caption has actually LANDED before it
	 * reads the board it is about to reverse, and before it takes a step off a stack the caption's
	 * own recording is about to change. Fire-and-forget there, and a redo peeks at a stack the
	 * caption empties a microtask later. See `_stepHistory` in dialogs/RelationshipMapWindow.js.
	 *
	 * @returns {Promise<*>|undefined}  the write, where there was one to make.
	 */
	flush() {
		this._disarm();
		if (!this.id || !this.words || !this._canEdit()) return undefined;
		const said = this.words.value ?? "";
		if (said === this._saved) return undefined;
		this._saved = said;
		return this._onField(this.id, { label: said });
	}

	destroy() {
		this._disarm();
		for (const [el, type, handler, opts] of this._bound) {
			el.removeEventListener?.(type, handler, opts);
		}
		this._bound = [];
		this.id = "";
		if (this.el) this.el.hidden = true;
		this.el = null;
		this.words = null;
		this._view = null;
		this.root = null;
	}
}
