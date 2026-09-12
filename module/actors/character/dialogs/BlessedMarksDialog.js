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
 * ONE KIND AT A TIME, BEHIND THE SHARED RAIL (RosterDialog `_railFor`). Five stacked groups each
 * growing without bound is a window taller than the screen, which is the rail's whole reason — but
 * it also answers a question the old layout had to answer with a picker. THE PANEL YOU ARE ON IS
 * THE KIND YOU ARE LAYING: each kind's panel carries its own add bar and is its own drop target, so
 * there is no "which mark" `<select>` to set and nothing to forget to set, and a dropped actor can
 * no longer land as a kind you had stopped looking at. That is also why the rail lists every kind
 * this Blessed COULD lay and not only the ones somebody wears: an empty panel is the way in to its
 * first mark. A Blessed who owns exactly one of the five gets no rail and the plain window.
 *
 * READ-ONLY FOR A VIEWER WHO CANNOT WRITE, but still open to them. Unlike the Judge's brand these
 * marks are not public in the fiction, but the roster is on the Blessed's own sheet and answers to
 * that sheet's permissions: anyone who can already read the sheet can read this, and `editable`
 * withholds the laying, the lifting and the Loyalty.
 */
import { StonetopAutocomplete } from "../../../utils/autocomplete.js";
import { openLinkedActorSheet, ACTOR_LINK_MISSING } from "../../../utils/actor-link.js";
import { groupMarks, availableKinds, markKind, markSign, WARD_SIGNS, DEFAULT_WARD_SIGN } from "../blessed-marks.js";
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
			// The rail's 168px ON TOP OF the 500 the rows themselves want (a mark's row carries a
			// Loyalty track or a pair of sign buttons beside the name), so a railed window's content
			// column is exactly as wide as the unrailed one has always been.
			width: 670,
			// "auto" is the UNRAILED height, re-fitted per render. With more than one kind in play
			// RosterDialog swaps in a fixed one so the frame does not jump per tab.
			height: "auto",
			resizable: true,
			// The LISTS scroll, not the body: each kind's add bar has to stay pinned under its own
			// list however many people wear that mark. One saved position per list, in document
			// order, so the kinds you are not looking at keep their place too.
			scrollY: [".stonetop-marks-list"],
		});
	}

	get title() {
		return `${this._actor?.name ?? "The Blessed"}: Marks`;
	}

	getData() {
		const stored = this._character.blessedMarks;
		// The kinds this Blessed can actually lay. A kind with rows but no move (a mark that
		// outlived the move that made it) still gets a panel — groupMarks keeps any kind with rows
		// whether or not it was included — but that panel carries no add bar, because there is
		// nothing left on the sheet that could lay another.
		//
		// Resolved ONCE and asked twice: it is what groupMarks keeps an EMPTY panel for, and what
		// says which of those panels gets an add bar.
		const canLay = new Set(availableKinds(this._actor).map(def => def.key));
		// NOT filtered by who is already marked, which is the one place this departs from the
		// Judge's: the same person can perfectly well wear Barkskin AND a charm, so a name already
		// on the roster is still a name worth offering. Duplicates are refused per KIND instead, at
		// the write (see blessed-marks.js `scope`), where the refusal can say which kind it means.
		// Resolved ONCE and shared by every panel's field, rather than scanned per kind.
		const suggestions = this._suggestionRows(this._rosterPool());
		// What the sign picker was last set to, not what the constants say — `_lay` promises that
		// warding three doorways against the same thing does not mean re-picking each time, and it
		// finishes with a full re-render (`renderIfOpen` -> `render(true)`), which rebuilds the
		// `<select>` from right here. Reading the constant meant the promise was never kept: the
		// sign fell back to "repelled", so the second doorway in a row was quietly stored as a Ward
		// where the player had said Binding. Per-window view state, outliving nothing else.
		const defaultSign = WARD_SIGNS.some(s => s.key === this._addSign)
			? this._addSign
			: DEFAULT_WARD_SIGN;

		const groups = groupMarks(stored, { include: canLay }).map(({ def, rows }) => ({
			key:   def.key,
			label: def.label,
			rule:  def.rule,
			icon:  def.icon,
			rows:  rows.map(entry => this._row(entry, def)),
			hasRows: rows.length > 0,
			// This panel's own add bar, or none at all where the move has gone. The bar's suggestion
			// list is NOT per panel: all five offer the same names, so one list is emitted beside
			// the panels and every bar names it (see the template).
			canAdd: this._editable && canLay.has(def.key),
			// Wards & Bindings' second question, asked in the add bar rather than only on the row
			// afterwards: the move says to choose repelled or trapped AS the signs are inscribed, so
			// a ward laid here is answered from the moment it exists. Absent (not empty) on the
			// other four kinds, which have no such choice and would read a stray control as one
			// they had to make. It no longer has to be shown and hidden as a picker moves: it lives
			// in the one panel it means anything in.
			signs: def.signs ? WARD_SIGNS.map(s => ({ ...s, selected: s.key === defaultSign })) : null,
		}));

		return {
			editable: this._editable,
			groups,
			hasGroups: groups.length > 0,
			// The one suggestion list every panel's add field reads, and the id they name it by.
			listId: "stonetop-marks-suggestions",
			suggestions,
			// The rail over those panels, with each kind's standing count beside it — "is anything
			// out under Trackless Step" is exactly the question you have of a list you are not
			// looking at. One kind renders with no rail and its panel showing; see `_railFor`.
			...this._railFor(groups.map(g => ({
				key: g.key, title: g.label, icon: g.icon, count: g.rows.length,
			}))),
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

		for (const panel of root.querySelectorAll(".stonetop-marks-group")) this._wirePanel(panel);

		root.addEventListener("change", ev => {
			// Remembered as it is picked, because the next `_lay` re-renders this control away and
			// `getData` has nowhere else to read the player's last answer from.
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
		// them. `change` fires on blur with the final value — on blur ALONE, a note being a
		// textarea rather than a one-line input, so Enter breaks the line instead of committing.
		root.addEventListener("change", async ev => {
			const field = ev.target.closest(".stonetop-mark-note");
			if (!field) return;
			await this._character.setBlessedMarkNote(field.dataset.rowId, field.value);
		});

	}

	/**
	 * Both ways INTO one kind's panel: the add bar under its list, and the panel itself as a drop
	 * target. Wired together, per panel, on one pass over the five.
	 *
	 * WIRED INSIDE ITS OWN PANEL, which is what retired the old "which mark" picker. Five bars wear
	 * the same classes, so a window-wide lookup would hand every button the first panel's field
	 * (see the `scope` note on RosterDialog `_wireAddBar`), and a drop onto the window as a whole
	 * could not say which of the five kinds it meant — it had to ask a `<select>` that might have
	 * been left anywhere. The panel you typed or dropped into answers for itself. Only the ward's
	 * second question survives, in the one panel it means anything in. Enter in the name field is
	 * the same act as pressing the button beside it.
	 *
	 * A PANEL WITH NO ADD BAR (a kind whose move has gone) IS NOT A WAY IN AT ALL — not typed and
	 * not dropped. One guard for both, because they are one rule: there is nothing left on the
	 * sheet that could lay another, and a silent accept through either door would be the way round
	 * a gate the rest of the window keeps. Kept apart, the drop half enforced it and the add half
	 * merely happened not to find a button.
	 *
	 * `dragover` must preventDefault or the browser refuses the drop outright.
	 */
	_wirePanel(panel) {
		if (!panel.querySelector(".stonetop-marks-add-btn")) return;
		this._wireAddBar(panel, {
			btnSelector: ".stonetop-marks-add-btn", nameSelector: ".stonetop-marks-name",
			add: () => this._addTyped(panel),
		});
		this._wireDropZone(panel, {
			write: (entry, note) => this._lay(entry, note, panel),
			wrongTypeKey:  "stonetop.blessedMarks.notMarkable",
			compendiumKey: "stonetop.blessedMarks.fromCompendium",
			// Read at drop time rather than at render, and through the same `_laying` the typed
			// path uses, so a dropped ward is answered exactly as a typed one is.
			extra: () => this._laying(panel),
		});
	}

	/**
	 * What this panel's add bar is about to write: the kind, and for a ward the sign along with it.
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
	 *
	 * THE PANEL IS THE ONLY ARGUMENT, because it is the only thing either caller knows: the kind is
	 * read off it here rather than passed in beside it, so there is no two-argument call whose
	 * halves could be made to disagree.
	 */
	_laying(panel) {
		const kind = panel.dataset.markKind;
		// The picker is rendered in the ward's panel and nowhere else, so its absence IS the answer
		// for the other four kinds: no lookup into the kind table, and nothing to keep in step.
		const picker = panel.querySelector(".stonetop-marks-sign");
		if (!picker) return { kind };
		return { kind, sign: markSign(String(picker.value ?? "").trim())?.key ?? DEFAULT_WARD_SIGN };
	}

	/**
	 * Mark whoever is named in a panel's add field — the shared search ladder, told to speak in
	 * marks.
	 *
	 * The KIND no longer has to be checked first, and that is the point of a bar per panel: it is
	 * the panel's own, read off the section the field sits in, so there is no state in which a name
	 * has been typed and the kind has not been chosen. "Pick which mark you are laying first" was
	 * the warning for a question this layout does not ask.
	 *
	 * A warded doorway goes through the SAME field with nothing to tick. If the GM has made an
	 * Actor for the thing being bound then the search links it; if not, "the north gate" is stored
	 * as a name like any other unmodelled subject.
	 */
	_addTyped(panel) {
		return this._addNamed({
			name:  String(panel.querySelector(".stonetop-marks-name")?.value ?? "").trim(),
			i18n:  "stonetop.blessedMarks",
			write: (entry, note) => this._lay(entry, note, panel),
			extra: this._laying(panel),
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
	async _lay(entry, note = null, panel = null) {
		const added = await this._character.layBlessedMark(entry);
		if (!added) return this._warn("stonetop.blessedMarks.already", {
			name: entry.name, kind: (markKind(entry.kind)?.label ?? "mark").toLowerCase(),
		});
		if (note) this._notify("info", note, { name: added.name });
		// The ward's sign is deliberately left alone — warding three doorways against the same
		// thing is one move being used once, and re-picking each time would be busywork. The kind
		// needs no such care now that it is the panel you are standing in.
		//
		// Cleared within THAT panel: five fields wear this class, and clearing window-wide would
		// empty the first kind's field while the one just used kept the name in it.
		this._clearAddField(".stonetop-marks-name", panel);
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
