/**
 * What the Judge is holding over people, in one window: the brands laid by Condemn, and the oaths
 * witnessed under Binding Arbitration. The only place either can be ended.
 *
 * TWO LISTS, ONE WINDOW, and that is a decision rather than an economy. They are the same act
 * twice — the Judge took note of somebody, and only the Judge can let them go — and a second
 * header glyph for the second list would have said "the Judge has two kinds of paperwork" rather
 * than "here is what you are keeping". Each section stands on its own gate, so a Judge who owns
 * one move and not the other sees only their half. See condemn.js and oaths.js.
 *
 * Opened from the scales in the character sheet header (`_onCondemnOpen`). Not a result dialog:
 * nobody awaits an answer, because every act in here writes straight through to the actor. It is
 * a live view of two flags, so it re-renders itself after each write rather than collecting a
 * form and saving on close — a Judge who dismisses a brand and then closes the window with the X
 * must not have quietly un-dismissed it.
 *
 * READ-ONLY FOR A VIEWER WHO CANNOT WRITE, but still open to them. Condemn's brand is public by
 * construction — "any intelligent creature who sees the mark recognizes the bearer as an agent of
 * chaos" — so who is branded is not the Judge's secret, and an oath was sworn in front of a
 * witness by definition. What IS theirs is the laying and the lifting, and `editable` withholds
 * exactly those.
 */
import { StonetopAutocomplete } from "../../../utils/autocomplete.js";
import { openLinkedActorSheet, ACTOR_LINK_MISSING } from "../../../utils/actor-link.js";
import { brandIndex, isBrandedBy, showCondemn } from "../condemn.js";
import { oathIndex, isSwornBy, showOaths } from "../oaths.js";
import { playbookIconPath } from "../../../utils/playbook-actors.js";
import { RosterDialog } from "./RosterDialog.js";

/** Whose move this is. Matches `system.slug` on the playbook item, which is what names the art. */
const JUDGE_SLUG = "the-judge";

export class CondemnedDialog extends RosterDialog {
	/**
	 * @param {Actor}  actor      the Judge
	 * @param {object} character  their StonetopCharacter, which owns the three writers
	 * @param {object} [options]  AppV1 options, plus `editable`
	 */
	constructor(actor, character, options = {}) {
		super(actor, character, "stonetop-condemned", options);
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: "stonetop-condemned-dialog",
			title: "The Condemned",
			template: "systems/stonetop-pwd/templates/dialogs/condemned.hbs",
			// "stonetop" carries our window chrome; omitting it leaves the window half-styled,
			// picking up our own rules over Foundry's default dark header.
			classes: ["stonetop", "stonetop-condemned-dialog"],
			width: 480,
			height: "auto",
			resizable: true,
			scrollY: [".stonetop-condemned-list"],
		});
	}

	/**
	 * Named for what is actually inside it. A Judge who only owns Condemn sees a window of brands
	 * and should not have to wonder what "& the Sworn" is hiding, and the reverse holds for one who
	 * only witnesses oaths.
	 */
	get title() {
		const who = this._actor?.name ?? "The Judge";
		const brands = this._showBrands();
		const oaths  = this._showOaths();
		if (brands && oaths) return `${who}: The Condemned & the Sworn`;
		if (oaths) return `${who}: The Sworn`;
		return `${who}: The Condemned`;
	}

	/**
	 * Whether the brands half renders. Kept while brands stand on a sheet that lost the move.
	 *
	 * Takes the list rather than fetching it, because every `condemned` read re-normalises the whole
	 * stored array through readEntry — see getData, which now asks for each list exactly once.
	 */
	_showBrands(brands = this._character.condemned) {
		return showCondemn({ owns: this._character.canCondemn, count: brands.length });
	}

	/** Whether the oaths half renders, on exactly the same terms. */
	_showOaths(sworn = this._character.oaths) {
		return showOaths({ owns: this._character.canBindOaths, count: sworn.length });
	}

	getData() {
		// Each stored list read ONCE, for the reason `pool` below is resolved once: the getter is
		// not a field read, it re-maps and re-filters the whole flag array through readEntry, and
		// this render wanted the answer three times over per list.
		const brands = this._character.condemned;
		const oathList = this._character.oaths;
		const rows = brands.map(entry => this._portraitRow(entry));
		const oaths = oathList.map(entry => this._portraitRow(entry));
		const showBrands = this._showBrands(brands);
		const showSworn  = this._showOaths(oathList);
		// Resolved ONCE for both lists. Each half excludes different people, so the two suggestion
		// lists genuinely differ — but they are drawn from the same pool, and scanning every actor
		// in the world twice per render to say so was the window's whole cost on a large world.
		const pool = this._rosterPool();
		const branded = brandIndex(brands);
		const sworn   = oathIndex(oathList);
		return {
			editable: this._editable,
			showBrands,
			showOaths: showSworn,
			// Both halves at once is the ordinary case for a level-6 Judge, and two lists stacked
			// with no headings would read as one list with a strange gap in it. Headings appear
			// only when there is something to tell apart.
			showHeadings: showBrands && showSworn,
			rows,
			hasRows: rows.length > 0,
			oaths,
			hasOaths: oaths.length > 0,
			// Can this Judge still lay a NEW one of each? Distinct from `show` above: a sheet that
			// lost the move keeps its list (so the rows can be lifted) but is offered no add form.
			canBrand:   this._editable && this._character.canCondemn,
			canWitness: this._editable && this._character.canBindOaths,
			// Every world actor either list could name, for the add fields' suggestions. Both
			// fields stay free-type regardless: a Censure often lands on a bandit nobody has made
			// an Actor for, and a Proclamation's faction may have none at all.
			//
			// Parameterised over WHICH list, because the two halves exclude different people:
			// somebody the Judge has branded may perfectly well also have sworn an oath, and one
			// shared suggestion pool would have hidden them from the field that still needed them.
			suggestions:     this._suggestionRows(pool, actor => isBrandedBy(branded, actor)),
			oathSuggestions: this._suggestionRows(pool, actor => isSwornBy(sworn, actor)),
			// The Judge's own playbook mark, over the rule. THE JUDGE'S, not this character's:
			// the window belongs to the moves, and a Fox who took Condemn through Versatile should
			// still see whose brand they are carrying rather than their own fox.
			playbookImg: playbookIconPath(JUDGE_SLUG),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];

		// The name field's native <datalist> popup has no scrollbar in Chromium, and a world's
		// worth of NPCs is a long list; swap in ours. See utils/autocomplete.js.
		StonetopAutocomplete.upgradeAll(html);

		// Opening the branded person's sheet is looking, not writing, so it is wired before the
		// editable gate — a player reading a GM's Judge can still see who these people are.
		root.addEventListener("click", async ev => {
			const link = ev.target.closest(".stonetop-condemned-open");
			if (!link) return;
			ev.preventDefault();
			await openLinkedActorSheet(link, ACTOR_LINK_MISSING.npc);
		});

		if (!this._editable) return;

		// Enter in a name field is the same act as pressing its button — stated once, in the base
		// class, for both bars here and the Blessed's third.
		this._wireAddBar(root, {
			btnSelector: ".stonetop-condemned-add-btn", nameSelector: ".stonetop-condemned-name",
			add: () => this._addTyped(root),
		});
		this._wireAddBar(root, {
			btnSelector: ".stonetop-oath-add-btn", nameSelector: ".stonetop-oath-name",
			add: () => this._addTypedOath(root),
		});

		// Both lists' rows carry their id under ONE attribute (`data-row-id`, written by the shared
		// roster-row partial), so each control below reads it the same way and a third list would
		// need no third spelling.
		root.addEventListener("click", async ev => {
			const btn = ev.target.closest(".stonetop-condemned-dismiss");
			if (btn) {
				ev.preventDefault();
				return this._dismiss(btn.dataset.rowId);
			}
			const release = ev.target.closest(".stonetop-oath-release");
			if (release) {
				ev.preventDefault();
				return this._release(release.dataset.rowId);
			}
		});

		// Notes save on blur rather than per keystroke: each write is a document update that
		// re-renders every sheet showing this actor, and typing a sentence should not be twenty of
		// them. `change` fires on blur (and on Enter) with the final value, which is exactly the
		// grain wanted — and both setters are a no-op when the text did not actually move.
		//
		// The broken tick box arrives on the same event and is handled here for that reason: it is
		// a checkbox, so `change` is its only sensible moment, and splitting the two by listener
		// would have meant two delegated handlers on one event for one form.
		root.addEventListener("change", async ev => {
			const note = ev.target.closest(".stonetop-condemned-note");
			if (note) return void await this._character.setCondemnedNote(note.dataset.rowId, note.value);
			const oathNote = ev.target.closest(".stonetop-oath-note");
			if (oathNote) return void await this._character.setOathNote(oathNote.dataset.rowId, oathNote.value);
			const broken = ev.target.closest(".stonetop-oath-broken");
			if (!broken) return;
			// Re-rendered, unlike the notes: this one changes how the row READS (an oathbreaker is
			// called out in red and carries the advantage the move grants), so the window has to
			// repaint rather than leave the tick sitting on an unchanged row.
			if (await this._character.setOathBroken(broken.dataset.rowId, broken.checked)) this.renderIfOpen();
		});

		this._wireDrop(root);
	}

	/**
	 * Drop an Actor onto a SECTION to brand or to witness them. The one path that can never mistype
	 * a name or pick the wrong Alun of two, since it carries the document itself.
	 *
	 * Per section rather than per window, because with both lists open a drop onto the window as a
	 * whole could not say which of the two it meant — and guessing would have made the fast path
	 * the one you have to undo. Each section is a full-width band, so the target is a large one.
	 */
	_wireDrop(root) {
		this._wireDropZone(root.querySelector(".stonetop-condemned-section"), {
			write: (entry, note) => this._brand(entry, note),
			wrongTypeKey:  "stonetop.condemn.notBrandable",
			compendiumKey: "stonetop.condemn.fromCompendium",
			selfKey:       "stonetop.condemn.notSelf",
		});
		this._wireDropZone(root.querySelector(".stonetop-oath-section"), {
			write: (entry, note) => this._witness(entry, note),
			wrongTypeKey:  "stonetop.condemn.notSwearable",
			compendiumKey: "stonetop.condemn.fromCompendium",
			selfKey:       "stonetop.condemn.notSelf",
		});
	}

	/**
	 * Brand whoever is named in the add field, and witness whoever is named in the oath field —
	 * the same search and the same three outcomes against the two lists, so both are the shared
	 * ladder (RosterDialog#_addNamed) told which vocabulary to speak.
	 *
	 * "The character need not be present", says Binding Arbitration, and a promise sworn by somebody
	 * nobody has made an Actor for is as binding as any other — so the oath field is as free-type as
	 * the brand field beside it, and a Proclamation's faction goes through the same one.
	 */
	_addTyped(root) {
		return this._addNamed({
			name:  String(root.querySelector(".stonetop-condemned-name")?.value ?? "").trim(),
			i18n:  "stonetop.condemn",
			write: (entry, note) => this._brand(entry, note),
		});
	}

	_addTypedOath(root) {
		return this._addNamed({
			name:  String(root.querySelector(".stonetop-oath-name")?.value ?? "").trim(),
			i18n:  "stonetop.oaths",
			write: (entry, note) => this._witness(entry, note),
		});
	}

	/**
	 * A Judge cannot brand or swear in HIMSELF — the one narrowing this roster puts on the shared
	 * pool. Condemn is passed on somebody, and an oath is witnessed rather than made.
	 */
	_rosterPool() {
		return super._rosterPool().filter(a => a.id !== this._actor?.id);
	}

	/**
	 * Write a brand and redraw. A refusal means "already branded" — the only way `added` is null
	 * once the name is non-empty — so it is reported rather than swallowed.
	 *
	 * `note` is an optional i18n key announced only on SUCCESS, for the things the search did that
	 * the player did not type (resolved a partial, or found nobody and stored a bare name).
	 */
	async _brand(entry, note = null) {
		const added = await this._character.brandCondemned(entry);
		if (!added) return this._warn("stonetop.condemn.already", { name: entry.name });
		if (note) this._notify("info", note, { name: added.name });
		this._clearAddField(".stonetop-condemned-name");
		this.renderIfOpen();
	}

	async _dismiss(id) {
		if (!id) return;
		if (await this._character.dismissCondemned(id)) this.renderIfOpen();
	}

	/** Witness an oath and redraw. A refusal means this person has already sworn one to this Judge. */
	async _witness(entry, note = null) {
		const added = await this._character.witnessOath(entry);
		if (!added) return this._warn("stonetop.oaths.already", { name: entry.name });
		if (note) this._notify("info", note, { name: added.name });
		this._clearAddField(".stonetop-oath-name");
		this.renderIfOpen();
	}

	async _release(id) {
		if (!id) return;
		if (await this._character.releaseOath(id)) this.renderIfOpen();
	}
}
