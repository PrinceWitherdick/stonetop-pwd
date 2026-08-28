/**
 * The Blessed's roster of standing marks — who is wearing what, and the only place a mark can be
 * lifted.
 *
 * Opened from the triquetra in the character sheet header (`_onBlessedMarksOpen`), and by using
 * any of the five marking moves. Not a result dialog: nobody awaits an answer, because every act
 * in here writes straight through to the actor. It is a live view of one flag, so it re-renders
 * itself after each write rather than collecting a form and saving on close — a Blessed who lifts
 * a mark and then closes the window with the X must not have quietly re-laid it.
 *
 * THE STRUCTURAL DIFFERENCE FROM THE JUDGE'S ROSTER (CondemnedDialog, which this is otherwise
 * modelled on): rows are GROUPED BY KIND, because "Aeronwen is marked" says nothing and "Aeronwen
 * has Barkskin" is the whole fact. Each group carries its move's own rule line, so the window
 * answers "what is this actually doing for them" without a trip to the Moves tab, and two groups
 * carry something of their own besides: Shared Souls a Loyalty track, since that is the only kind
 * with a stopping condition the Blessed spends rather than declares, and Wards & Bindings a
 * repelled-or-trapped toggle, since that move asks a second question as the signs go on and the
 * roster is the only place its answer could live.
 *
 * READ-ONLY FOR A VIEWER WHO CANNOT WRITE, but still open to them. Unlike the Judge's brand these
 * marks are not public in the fiction, but the roster is on the Blessed's own sheet and answers to
 * that sheet's permissions: anyone who can already read the sheet can read this, and `editable`
 * withholds the laying, the lifting and the Loyalty.
 */
import { StonetopAutocomplete } from "../../../utils/autocomplete.js";
import { openLinkedActorSheet, ACTOR_LINK_MISSING } from "../../../utils/actor-link.js";
import { groupMarks, availableKinds, markKind, markSign, DEFAULT_KIND, WARD_SIGNS, DEFAULT_WARD_SIGN } from "../blessed-marks.js";
import { playbookIconPath } from "../../../utils/playbook-actors.js";
import { RosterDialog } from "./RosterDialog.js";

/** Whose moves these are. Matches `system.slug` on the playbook item, which is what names the art. */
const BLESSED_SLUG = "the-blessed";

export class BlessedMarksDialog extends RosterDialog {
	/**
	 * @param {Actor}  actor      the Blessed
	 * @param {object} character  their StonetopCharacter, which owns the writers
	 * @param {object} [options]  AppV1 options, plus `editable`
	 */
	constructor(actor, character, options = {}) {
		super(actor, character, "stonetop-blessed-marks", options);
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: "stonetop-blessed-marks-dialog",
			title: "Marks",
			template: "systems/stonetop-pwd/templates/dialogs/blessed-marks.hbs",
			// "stonetop" carries our window chrome; omitting it leaves the window half-styled,
			// picking up our own rules over Foundry's default dark header.
			classes: ["stonetop", "stonetop-blessed-marks-dialog"],
			width: 500,
			height: "auto",
			resizable: true,
			scrollY: [".stonetop-marks-body"],
		});
	}

	get title() {
		return `${this._actor?.name ?? "The Blessed"}: Marks`;
	}

	getData() {
		const stored = this._character.blessedMarks;
		// Only the kinds somebody is wearing — see blessed-marks.js. Nothing here needs a word for
		// an empty group, because a group that would be empty is not built.
		const groups = groupMarks(stored).map(group => ({
			key:   group.def.key,
			label: group.def.label,
			rule:  group.def.rule,
			rows:  group.rows.map(entry => this._row(entry, group.def)),
		}));
		// The kinds this Blessed can actually lay. A kind with rows but no move (a mark that
		// outlived the move that made it) is listed above but NOT offered here — there is nothing
		// left on the sheet that could lay another.
		const kinds = availableKinds(this._actor).map(def => ({
			key: def.key, label: def.label, subject: def.subject, signs: !!def.signs,
		}));
		// What the add row was last set to, not what the constants say — `_lay` promises that
		// marking three people with Trackless Step in a row, or warding three doorways against the
		// same thing, does not mean re-picking each time, and it finishes with a full re-render
		// (`renderIfOpen` -> `render(true)`), which rebuilds both `<select>`s from right here.
		// Reading the constants meant the promise was never kept: the kind fell back to `kinds[0]`
		// — never the ward, which MARK_KINDS lists last — and the sign fell back to "repelled", so
		// the second doorway in a row was quietly stored as a Ward where the player had said
		// Binding. Both are per-window view state and deliberately outlive nothing else.
		const defaultKind = kinds.some(k => k.key === this._addKind)
			? this._addKind
			: (kinds[0]?.key ?? DEFAULT_KIND);
		const defaultSign = WARD_SIGNS.some(s => s.key === this._addSign)
			? this._addSign
			: DEFAULT_WARD_SIGN;
		return {
			editable: this._editable,
			groups,
			hasGroups: groups.length > 0,
			kinds,
			canAdd: this._editable && kinds.length > 0,
			// Pre-selected so the add row is usable without touching the picker in the common case
			// of a Blessed who only owns one of the five.
			defaultKind,
			// Wards & Bindings' second question, asked in the add row rather than only on the row
			// afterwards: the move says to choose repelled or trapped AS the signs are inscribed, so
			// a ward laid here is answered from the moment it exists. Shown only while the kind
			// picker is on the ward (see `_syncSignPicker`) — the other four kinds have no such
			// choice and would read a stray control as one they had to make.
			signs: WARD_SIGNS,
			defaultSign,
			signsOpen: !!markKind(defaultKind)?.signs,
			// NOT filtered by who is already marked, which is the one place this departs from the
			// Judge's: the same person can perfectly well wear Barkskin AND a charm, so a name
			// already on the roster is still a name worth offering. Duplicates are refused per KIND
			// instead, at the write (see blessed-marks.js `scope`), where the refusal can say which
			// kind it means.
			suggestions: this._suggestionRows(this._rosterPool()),
			// The Blessed's own playbook mark, over the rule. THE BLESSED'S, not this character's:
			// the window belongs to the moves, and a Ranger who took one through Wild Soul should
			// still see whose marks they are carrying.
			playbookImg: playbookIconPath(BLESSED_SLUG),
		};
	}

	/**
	 * One roster row: the shared person half (portrait, name-as-link), plus the three things only a
	 * mark carries — the Loyalty track, the ward's repelled/trapped toggle, and a placeholder worded
	 * for what this kind marks.
	 */
	_row(entry, def) {
		return {
			...this._portraitRow(entry),
			// Null on every kind but Shared Souls, so nothing else renders a track (see
			// blessed-marks.js on why absent rather than zero).
			pips: entry.loyalty === null ? null : Array.from(
				{ length: def.loyalty ?? 0 },
				(_, i) => ({ index: i, filled: i < entry.loyalty }),
			),
			// Null on every kind but Wards & Bindings, for the same reason. BOTH options ride the row
			// with the chosen one flagged rather than just the chosen label, because this is a toggle
			// and not a badge: a Blessed who inscribed the wrong one has to be able to say so.
			signs: def.signs
				? def.signs.map(s => ({ ...s, active: s.key === entry.sign }))
				: null,
			// A ward laid before the toggle existed carries no answer, and the row says which one it
			// is missing rather than looking merely undecorated.
			signUnset: !!def.signs && !entry.sign,
			// The note is the move's OTHER half — "describe who or what they affect (using no more
			// words than your level)". It stopped having to carry repelled-or-trapped as well the
			// moment the toggle did, so it now asks for exactly the half it holds.
			notePlaceholder: def.subject === "place"
				? "Who or what the signs affect…"
				: "What this mark is for…",
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];

		// The name field's native <datalist> popup has no scrollbar in Chromium, and a world's
		// worth of NPCs is a long list; swap in ours. See utils/autocomplete.js.
		StonetopAutocomplete.upgradeAll(html);

		// Opening the marked person's sheet is looking, not writing, so it is wired before the
		// editable gate.
		root.addEventListener("click", async ev => {
			const link = ev.target.closest(".stonetop-mark-open");
			if (!link) return;
			ev.preventDefault();
			await openLinkedActorSheet(link, ACTOR_LINK_MISSING.npc);
		});

		if (!this._editable) return;

		// Enter in the name field is the same act as pressing the button — see RosterDialog.
		this._wireAddBar(root, {
			btnSelector: ".stonetop-marks-add-btn", nameSelector: ".stonetop-marks-name",
			add: () => this._addTyped(root),
		});

		// The sign picker only means anything while the ward is the kind being laid, so it follows
		// the kind picker rather than sitting there asking a question about Barkskin.
		this._syncSignPicker(root);
		root.addEventListener("change", ev => {
			// Remembered as they are picked, because the next `_lay` re-renders this row away and
			// `getData` has nowhere else to read the player's last answer from.
			const kind = ev.target.closest(".stonetop-marks-kind");
			if (kind) {
				this._addKind = String(kind.value ?? "").trim();
				this._syncSignPicker(root);
			}
			const sign = ev.target.closest(".stonetop-marks-sign");
			if (sign) this._addSign = String(sign.value ?? "").trim();
		});

		root.addEventListener("click", async ev => {
			const lift = ev.target.closest(".stonetop-mark-lift");
			if (lift) {
				ev.preventDefault();
				return this._lift(lift.dataset.rowId);
			}
			const pip = ev.target.closest(".stonetop-mark-loyalty-pip");
			if (pip) {
				ev.preventDefault();
				return this._setLoyalty(pip.dataset.rowId, Number(pip.dataset.index));
			}
			const sign = ev.target.closest(".stonetop-mark-sign-btn");
			if (sign) {
				ev.preventDefault();
				return this._setSign(sign.dataset.rowId, sign.dataset.sign);
			}
		});

		// Notes save on blur rather than per keystroke: each write is a document update that
		// re-renders every sheet showing this actor, and typing a sentence should not be twenty of
		// them. `change` fires on blur (and on Enter) with the final value.
		root.addEventListener("change", async ev => {
			const field = ev.target.closest(".stonetop-mark-note");
			if (!field) return;
			await this._character.setBlessedMarkNote(field.dataset.rowId, field.value);
		});

		this._wireDrop(root);
	}

	/**
	 * Drop an Actor onto the window to mark them. The one path that can never mistype a name or
	 * pick the wrong Alun of two, since it carries the document itself. What KIND it is — and for a
	 * ward, which of the two — comes from the add row's pickers, which is everything a drop cannot
	 * say for itself.
	 *
	 * `dragover` must preventDefault or the browser refuses the drop outright.
	 */
	_wireDrop(root) {
		this._wireDropZone(root.querySelector(".stonetop-marks-body") ?? root, {
			write: (entry, note) => this._lay(entry, note),
			wrongTypeKey:  "stonetop.blessedMarks.notMarkable",
			compendiumKey: "stonetop.blessedMarks.fromCompendium",
			// Read at drop time rather than at render, and through the same `_laying` the typed path
			// uses, so a dropped ward is answered exactly as a typed one is. A Blessed with no kind
			// to lay is told rather than silently given a default one.
			extra: () => {
				const kind = this._selectedKind(root);
				return kind ? this._laying(root, kind) : this._warn("stonetop.blessedMarks.noKind");
			},
		});
	}

	/** Which kind the add row is set to, or "" when this Blessed can lay none. */
	_selectedKind(root) {
		return String(root.querySelector(".stonetop-marks-kind")?.value ?? "").trim();
	}

	/**
	 * What the add row is about to write: the kind, and for a ward the sign along with it.
	 *
	 * Carried at the WRITE rather than left to a second click on the row, because the move asks for
	 * both in one breath — "describe who or what they affect … ALSO, choose whether the affected
	 * beings are repelled or trapped" — so a ward laid through this window is never a row with an
	 * unanswered half. Absent on the other four kinds, where coerceSign would null it anyway;
	 * omitting it keeps the stored row honest about which fields the kind actually has.
	 *
	 * Resolved through `markSign` rather than taken as typed: what comes back is a `<select>`'s
	 * value, and the roster is the one place a sign key is read from afterwards. Anything the table
	 * does not name falls back to the default, so a ward can never be stored wearing a sign the
	 * row rendering has no definition for.
	 */
	_laying(root, kind) {
		const def = markKind(kind);
		if (!def?.signs) return { kind };
		const sign = String(root.querySelector(".stonetop-marks-sign")?.value ?? "").trim();
		return { kind, sign: markSign(sign)?.key ?? DEFAULT_WARD_SIGN };
	}

	/**
	 * Show the sign picker only while the ward is selected.
	 *
	 * `hidden` rather than a re-render: the kind picker changes on every glance through the list,
	 * and re-rendering the window under the player's cursor would drop what they had typed in the
	 * name field. The value is left alone while it is away, so flicking off the ward and back does
	 * not silently reset a binding to a ward.
	 */
	_syncSignPicker(root) {
		const picker = root.querySelector(".stonetop-marks-sign");
		if (!picker) return;
		picker.hidden = !markKind(this._selectedKind(root))?.signs;
	}

	/**
	 * Mark whoever is named in the add field — the shared search ladder, told to speak in marks.
	 *
	 * The KIND is checked BEFORE the name, and that order is the one thing this adds: a Blessed who
	 * has typed a name but has no kind selected should be told what is actually missing.
	 *
	 * A warded doorway goes through the SAME field with nothing to tick. If the GM has made an
	 * Actor for the thing being bound then the search links it; if not, "the north gate" is stored
	 * as a name like any other unmodelled subject.
	 */
	_addTyped(root) {
		const kind = this._selectedKind(root);
		if (!kind) return this._warn("stonetop.blessedMarks.noKind");
		return this._addNamed({
			name:  String(root.querySelector(".stonetop-marks-name")?.value ?? "").trim(),
			i18n:  "stonetop.blessedMarks",
			write: (entry, note) => this._lay(entry, note),
			extra: this._laying(root, kind),
		});
	}

	/**
	 * Write a mark and redraw. A refusal means "already bears this KIND of mark" — the only way
	 * `added` comes back null once the name is non-empty. The dedupe is per kind, in the roster
	 * itself (see blessed-marks.js `scope`), so the same woman can wear Barkskin and a charm.
	 *
	 * `note` is an optional i18n key announced only on SUCCESS, for the things the search did that
	 * the player did not type (resolved a partial, or found nobody and stored a bare name).
	 */
	async _lay(entry, note = null) {
		const added = await this._character.layBlessedMark(entry);
		if (!added) return this._warn("stonetop.blessedMarks.already", {
			name: entry.name, kind: (markKind(entry.kind)?.label ?? "mark").toLowerCase(),
		});
		if (note) this._notify("info", note, { name: added.name });
		// The KIND and the ward's sign are deliberately left alone — marking three people with
		// Trackless Step in a row, or warding three doorways against the same thing, is one move
		// being used once, and re-picking either each time would be busywork.
		this._clearAddField(".stonetop-marks-name");
		this.renderIfOpen();
	}

	async _lift(id) {
		if (!id) return;
		if (await this._character.liftBlessedMark(id)) this.renderIfOpen();
	}

	/**
	 * Set a ward's signs to repel or to trap — one click, no toggling back to unset.
	 *
	 * NOT a two-way gesture, unlike the Loyalty pips beside it, and the difference is the move's:
	 * Loyalty is a quantity that goes both ways, while this is a choice the move requires you to
	 * have made. Clicking the side already chosen would mean un-choosing, which leaves a ward the
	 * signs of neither — a state only a pre-toggle row can honestly be in, and one no click should
	 * be able to create.
	 */
	async _setSign(id, sign) {
		if (!id || !sign) return;
		if (await this._character.setBlessedMarkSign(id, sign)) this.renderIfOpen();
	}

	/**
	 * Set a beast's remaining Loyalty from the pip that was clicked: clicking pip N sets N+1, and
	 * clicking the highest FILLED one clears back to N — the same two-way gesture every other
	 * Loyalty and Readiness track in the system uses, so nobody has to learn a new one.
	 *
	 * Spending the last one ends the mark, which the move says outright, so the row goes and a
	 * notice says why. The GOING rides the same write as the spend (`liftOnEnd`) — asked for here,
	 * because it is this window's decision, but not paid for twice: a second write would store the
	 * exhausted row, broadcast it to every client and repaint every sheet showing this actor before
	 * taking it back off again, which reads as a flicker on the roster the player is looking at.
	 * The notice is still ours, and still lands after their own click.
	 */
	async _setLoyalty(id, index) {
		if (!id || !Number.isFinite(index)) return;
		const row = this._character.blessedMarks.find(m => m.id === id);
		if (!row || row.loyalty === null) return;
		const next = row.loyalty === index + 1 ? index : index + 1;
		const { changed, ended } = await this._character.setBlessedMarkLoyalty(id, next, { liftOnEnd: true });
		if (!changed) return;
		if (ended) this._notify("info", "stonetop.blessedMarks.loyaltySpent", { name: row.name });
		this.renderIfOpen();
	}

}
