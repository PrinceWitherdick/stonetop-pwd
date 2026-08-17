/**
 * The shared window behind every "list of people this character has marked, standing until they
 * lift it" roster: the Judge's brands and oaths (CondemnedDialog) and the Blessed's marks
 * (BlessedMarksDialog).
 *
 * marked-people.js already owns the list ALGEBRA those features share. This is its other half —
 * the window that algebra is operated through — which had been copied rather than shared, so the
 * same drop zone, the same portrait row, the same suggestion list and the same "type a name,
 * search the world, report one of three outcomes" ladder existed three times over (twice inside
 * CondemnedDialog alone, once per list). Each copy carried the same subtleties, and a fix to any
 * of them landed in one.
 *
 * WHAT IS SHARED IS THE MECHANISM, NOT THE VOCABULARY. Every method here takes the i18n stem it
 * should speak in, so a brand still says "already bears your brand" and a mark still says "already
 * bears this kind of mark". The three stems are symmetric by construction — `condemn`, `oaths` and
 * `blessedMarks` each define needName / ambiguous / nameOnly / sameName / matched / already — which
 * is what lets the prefix be the only variable.
 *
 * WHAT SUBCLASSES STILL OWN: their getData, their template, their writers, and the rules that are
 * genuinely theirs — whether the roster may name its own character (a Judge cannot brand himself;
 * a Blessed may perfectly well put Barkskin on herself), and what extra fields a row carries.
 */
import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { getDragEventData } from "../../../utils/foundry-compat.js";
import { resolvePortrait, documentPortraitFrame } from "../../../utils/portrait-frame.js";
import { PERSON_ROSTER_IMG } from "../../../utils/person-portrait.js";
import { isDefaultImg } from "../../../utils/strings.js";
import { findNamedActor } from "../marked-people.js";

/**
 * Actor types a roster row can name — the same three for all of them.
 *
 * A steading is a place rather than somebody who can be denounced, so it is not here. The list
 * matters more to the Blessed than to the Judge (a marked BEAST is very often a monster document,
 * and a warded threshold is very often nothing at all), but the answer came out the same both
 * times, so it is asked once.
 */
export const ROSTER_ACTOR_TYPES = ["npc", "character", "monster"];

export class RosterDialog extends StonetopDialog {
	/**
	 * @param {Actor}  actor      whose roster this is
	 * @param {object} character  their StonetopCharacter, which owns the writers
	 * @param {string} idPrefix   window id stem, made per-document (two Judges, two windows)
	 * @param {object} [options]  AppV1 options, plus `editable`
	 */
	constructor(actor, character, idPrefix, options = {}) {
		super(StonetopDialog.perDocumentOptions(idPrefix, actor?.id, options));
		this._actor = actor;
		this._character = character;
		// Frozen after super() (see the AppV2/AppV1 options note in stonetop-dialog.js), so it is
		// read once here rather than off this.options at every call site.
		this._editable = options.editable !== false;
	}

	/** Hug the content: a roster is one row per person and usually three or four of them. */
	get _autoHeight() { return true; }

	/**
	 * The actor behind a stored uuid, SYNCHRONOUSLY — getData cannot await, and a world Actor is
	 * already in memory. `fromUuidSync` answers null for a compendium document that is not indexed,
	 * which is correct here (a row on a pack entry names nobody in this world) and is why such a
	 * row degrades to plain text.
	 */
	_resolveActor(uuid) {
		try {
			const doc = fromUuidSync(uuid);
			return doc?.documentName === "Actor" ? doc : null;
		} catch { return null; }
	}

	/**
	 * One roster row's shared half. The portrait and the name-as-link are the affordances a
	 * relationship row carries, resolved through the same helpers, so a person listed here looks
	 * and behaves like the same person listed anywhere else in the system.
	 *
	 * A row whose actor has since been DELETED keeps its name and simply stops being a link: losing
	 * the document does not lift a brand, release an oath or end a mark, and the character still has
	 * to be able to end it. Subclasses spread this and add whatever their own rows carry.
	 */
	_portraitRow(entry) {
		const actor = entry.uuid ? this._resolveActor(entry.uuid) : null;
		const portrait = actor
			? resolvePortrait(isDefaultImg(actor.img) ? null : actor.img, documentPortraitFrame(actor))
			: { src: "", style: "" };
		return {
			...entry,
			linked:   !!actor,
			img:      portrait.src || PERSON_ROSTER_IMG,
			imgStyle: portrait.style,
		};
	}

	/**
	 * Everyone in the world this roster could name — the search pool AND the suggestion source, so
	 * the list cannot come to offer a name the search would then fail to resolve. That drift is
	 * exactly what turns a picked suggestion into an inert name-only row.
	 *
	 * Subclasses narrow it: the Judge's excludes the Judge.
	 */
	_rosterPool() {
		return [...(game.actors ?? [])].filter(a => ROSTER_ACTOR_TYPES.includes(a.type));
	}

	/**
	 * The add field's suggestions: each person's name, and where they live beside it.
	 *
	 * The home rides a SEPARATE `hint` (rendered as the option's `label`, which the autocomplete
	 * turns into a dimmed second column) rather than being folded into the name. That is the whole
	 * point: only the value is inserted into the field, so a picked "Brennan the Claw / Marshedge"
	 * types "Brennan the Claw" and resolves cleanly. A "Name (Home)" value string would have to be
	 * unpicked again before the search could use it, and would silently break for anyone whose real
	 * name ends in a parenthetical.
	 *
	 * Only NPCs carry a home, and it is blank for residents of Stonetop itself (NpcModel), so most
	 * rows have no hint and simply show the name. Monsters and player characters never do.
	 *
	 * De-duplicated by name+home rather than by name alone: two different Aeronwens are exactly what
	 * the hint exists to separate, and collapsing them would hide the one it was added for. The
	 * separator is a NUL so that a name ending in a space cannot collide with a hint beginning with
	 * one.
	 *
	 * `skip` runs BEFORE the de-duplication, not after, and that order is load-bearing: of two
	 * identically-named people it drops the one already on the list and keeps the one still worth
	 * offering. Filtering afterwards would let the excluded twin win the slot and take the other
	 * down with it.
	 *
	 * @param {Array<Actor>} pool  from `_rosterPool()`, resolved ONCE by the caller — a window with
	 *   two lists in it asks twice, and re-scanning every actor in the world per list is the cost
	 *   this parameter exists to avoid.
	 * @param {?function(Actor): boolean} skip  who is already on THIS list. Offering them is
	 *   offering a pick whose only outcome is an "already listed" refusal. The SEARCH still sees
	 *   them, so typing an already-listed name still resolves and still gets told why.
	 */
	_suggestionRows(pool, skip = null) {
		const seen = new Set();
		const rows = [];
		for (const actor of pool) {
			if (skip?.(actor)) continue;
			const value = String(actor.name ?? "").trim();
			if (!value) continue;
			const hint = String(actor.system?.home ?? "").trim();
			const key = `${value}\u0000${hint}`;
			if (seen.has(key)) continue;
			seen.add(key);
			rows.push({ value, hint });
		}
		return rows.sort((a, b) => a.value.localeCompare(b.value) || a.hint.localeCompare(b.hint));
	}

	/**
	 * Add whoever was typed into an add field, having SEARCHED the world for them first.
	 *
	 * The search is the point: a row that carries a uuid links to that person's sheet, and one that
	 * carries only a name links to nobody. Nearly everybody a Judge condemns already has an Actor —
	 * so resolving "brennan" to Brennan the Claw is the difference between the mark appearing where
	 * it belongs and a lookalike row sitting inert on the roster. Typing a name and dropping the
	 * actor should record the same thing, and this is what makes them agree.
	 *
	 * Three outcomes, each SAYING what happened rather than resolving quietly:
	 *  • several people match a partial → nobody is added, and the notice names them, because
	 *    branding the wrong Aeronwen is worse than asking which;
	 *  • one person matches → added and LINKED, and if the actor's real name differs from what was
	 *    typed the notice says whose sheet just took it;
	 *  • nobody matches → added by name alone, and the notice says so, or a typo would produce a row
	 *    that silently tags nothing and looks identical to one that works.
	 *
	 * An unmodelled subject goes through the SAME field with nothing to tick — a Proclamation's
	 * faction, a warded doorway. If the GM has made an Actor for the Claws then the search links it;
	 * if not, "the Claws" is stored as a name like any other. There is no stored distinction, and the
	 * roster reads the same either way.
	 *
	 * @param {string} name   the typed text, already trimmed
	 * @param {string} i18n   this list's key stem ("stonetop.condemn", "stonetop.oaths", …)
	 * @param {function(object, ?string): any} write  commits the row; takes an optional note key
	 *   announced only on success
	 * @param {object} [extra]  fields this roster's rows carry beyond the person (a mark's `kind`)
	 */
	_addNamed({ name, i18n, write, extra = {} }) {
		if (!name) return this._warn(`${i18n}.needName`);

		const { match, candidates, ambiguous } = findNamedActor(name, this._rosterPool());
		if (!match && candidates.length) {
			return this._warn(`${i18n}.ambiguous`, { name, names: candidates.map(a => a.name).join(", ") });
		}
		if (!match) return write({ ...extra, name }, `${i18n}.nameOnly`);
		// Two actors really do share this name; the typed text cannot say which, so the first is
		// taken and the drop path is pointed at. See findNamedActor.
		if (ambiguous) this._notify("info", `${i18n}.sameName`, { name: match.name });
		// Only worth saying when the search actually moved: "Brennan" → "Brennan the Claw" is news,
		// "brennan" → "Brennan" is not.
		const note = match.name.toLowerCase() === name.toLowerCase() ? null : `${i18n}.matched`;
		return write({ ...extra, name: match.name, uuid: match.uuid }, note);
	}

	/**
	 * Make a zone accept a dropped Actor. The one path that can never mistype a name or pick the
	 * wrong Alun of two, since it carries the document itself.
	 *
	 * `dragover` must preventDefault or the browser refuses the drop outright — the same
	 * synchronous-preventDefault rule the character sheet's own drop target follows.
	 *
	 * @param {HTMLElement|null} zone  absent when that half of the window is not shown
	 * @param {object} cfg
	 * @param {function(object): any} cfg.write   what to do with the resolved `{name, uuid}`
	 * @param {string} cfg.wrongTypeKey           i18n key for a document this list cannot name
	 * @param {string} cfg.compendiumKey          i18n key for the pack-entry case below
	 * @param {?string} [cfg.selfKey]             set to refuse this character's own document
	 * @param {?function(): ?object} [cfg.extra]  extra row fields read at drop time (a mark's kind);
	 *        returning null aborts, having already said why
	 */
	_wireDropZone(zone, { write, wrongTypeKey, compendiumKey, selfKey = null, extra = null }) {
		if (!zone) return;
		zone.addEventListener("dragover", ev => { ev.preventDefault(); zone.classList.add("is-drop-target"); });
		zone.addEventListener("dragleave", ev => { if (!zone.contains(ev.relatedTarget)) zone.classList.remove("is-drop-target"); });
		zone.addEventListener("drop", async ev => {
			ev.preventDefault();
			zone.classList.remove("is-drop-target");
			const data = getDragEventData(ev);
			if (data?.type !== "Actor") return;
			const actor = await fromUuid(data.uuid);
			if (!actor) return;
			if (!ROSTER_ACTOR_TYPES.includes(actor.type)) return this._warn(wrongTypeKey, { name: actor.name });
			if (selfKey && actor.id === this._actor?.id) return this._warn(selfKey);
			const fields = extra ? extra() : {};
			if (!fields) return;   // the extra step refused, and has already said why
			// A pack entry's uuid resolves nowhere in this world once the dialog is reopened, so
			// storing it would give a row that can never be a link and never match a sheet. Keep the
			// NAME, which is the honest half of what was dropped, and say so.
			if (actor.pack) {
				await write({ ...fields, name: actor.name });
				return this._warn(compendiumKey, { name: actor.name });
			}
			await write({ ...fields, name: actor.name, uuid: actor.uuid });
		});
	}

	/**
	 * Wire one add bar: its button, and Enter in its name field.
	 *
	 * Both are the same act, and saying so in one place is the point — the Enter guard in
	 * particular was written out once per bar (three times across the two dialogs), and a bar whose
	 * copy was missed reads as a dead field rather than as an unwired one, because the button
	 * beside it still works. This class already owns the other end of the same control in
	 * `_clearAddField`, so the bar's lifecycle lives together.
	 *
	 * @param {HTMLElement} root
	 * @param {object} bar
	 * @param {string} bar.btnSelector   the add button
	 * @param {string} bar.nameSelector  the text field Enter should fire from
	 * @param {() => any} bar.add        what pressing either one does
	 */
	_wireAddBar(root, { btnSelector, nameSelector, add }) {
		root.querySelector(btnSelector)?.addEventListener("click", () => add());
		// Without this the fields sit inside a dialog with no form, so Enter does nothing at all.
		root.querySelector(nameSelector)?.addEventListener("keydown", ev => {
			if (ev.key !== "Enter") return;
			ev.preventDefault();
			add();
		});
	}

	/**
	 * Empty an add field after a successful write, so the next one starts clean.
	 *
	 * Reached through the live element rather than left to the re-render: `height: "auto"` windows
	 * re-render into fresh nodes, but the value is cleared here so the field is already empty in the
	 * frame the player sees, rather than briefly showing the name they just used.
	 */
	_clearAddField(selector) {
		const field = this.element?.[0]?.querySelector(selector);
		if (field) field.value = "";
	}

	_warn(key, data) {
		return this._notify("warn", key, data);
	}

	_notify(level, key, data) {
		const text = data ? game.i18n.format(key, data) : game.i18n.localize(key);
		ui.notifications?.[level]?.(text);
		return null;
	}
}
