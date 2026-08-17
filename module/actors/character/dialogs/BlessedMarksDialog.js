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
 * answers "what is this actually doing for them" without a trip to the Moves tab, and one group —
 * Shared Souls — carries a Loyalty track, since that is the only kind with a stopping condition
 * the Blessed spends rather than declares.
 *
 * READ-ONLY FOR A VIEWER WHO CANNOT WRITE, but still open to them. Unlike the Judge's brand these
 * marks are not public in the fiction, but the roster is on the Blessed's own sheet and answers to
 * that sheet's permissions: anyone who can already read the sheet can read this, and `editable`
 * withholds the laying, the lifting and the Loyalty.
 */
import { StonetopAutocomplete } from "../../../utils/autocomplete.js";
import { openLinkedActorSheet, ACTOR_LINK_MISSING } from "../../../utils/actor-link.js";
import { groupMarks, availableKinds, markKind, DEFAULT_KIND } from "../blessed-marks.js";
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
		const groups = groupMarks(stored, this._actor).map(group => ({
			key:   group.def.key,
			label: group.def.label,
			rule:  group.def.rule,
			rows:  group.rows.map(entry => this._row(entry, group.def)),
			// Said per group rather than once at the bottom: "name a beast" and "name a doorway"
			// are different asks, and a single placeholder could only get one of them right.
			empty: this._emptyLabel(group.def),
		}));
		// The kinds this Blessed can actually lay. A kind with rows but no move (a mark that
		// outlived the move that made it) is listed above but NOT offered here — there is nothing
		// left on the sheet that could lay another.
		const kinds = availableKinds(this._actor).map(def => ({
			key: def.key, label: def.label, subject: def.subject,
		}));
		return {
			editable: this._editable,
			groups,
			hasGroups: groups.length > 0,
			kinds,
			canAdd: this._editable && kinds.length > 0,
			// Pre-selected so the add row is usable without touching the picker in the common case
			// of a Blessed who only owns one of the five.
			defaultKind: kinds[0]?.key ?? DEFAULT_KIND,
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

	/** What a group with nothing in it says, in the terms of what that move marks. */
	_emptyLabel(def) {
		if (def.subject === "beast") return "No beast bears this mark.";
		if (def.subject === "place") return "Nothing is warded.";
		return "Nobody bears this mark.";
	}

	/**
	 * One roster row: the shared person half (portrait, name-as-link), plus the two things only a
	 * mark carries — the Loyalty track and a placeholder worded for what this kind marks.
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
			notePlaceholder: def.subject === "place"
				? "What the signs keep out, or in…"
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
	 * pick the wrong Alun of two, since it carries the document itself. The KIND comes from the add
	 * row's picker, which is the only thing a drop cannot say.
	 *
	 * `dragover` must preventDefault or the browser refuses the drop outright.
	 */
	_wireDrop(root) {
		this._wireDropZone(root.querySelector(".stonetop-marks-body") ?? root, {
			write: (entry, note) => this._lay(entry, note),
			wrongTypeKey:  "stonetop.blessedMarks.notMarkable",
			compendiumKey: "stonetop.blessedMarks.fromCompendium",
			// The KIND comes from the add row's picker, which is the only thing a drop cannot say —
			// so it is read at drop time, and a Blessed with no kind to lay is told rather than
			// silently given a default one.
			extra: () => {
				const kind = this._selectedKind(root);
				return kind ? { kind } : this._warn("stonetop.blessedMarks.noKind");
			},
		});
	}

	/** Which kind the add row is set to, or "" when this Blessed can lay none. */
	_selectedKind(root) {
		return String(root.querySelector(".stonetop-marks-kind")?.value ?? "").trim();
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
			extra: { kind },
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
		// The KIND is deliberately left alone — marking three people with Trackless Step in a row is
		// one move being used once, and re-picking the kind each time would be busywork.
		this._clearAddField(".stonetop-marks-name");
		this.renderIfOpen();
	}

	async _lift(id) {
		if (!id) return;
		if (await this._character.liftBlessedMark(id)) this.renderIfOpen();
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
