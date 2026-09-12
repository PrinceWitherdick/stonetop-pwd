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
 * THE OTHER THING SHARED IS THE SHAPE OF THE WINDOW. A roster with more than one list shows them
 * one at a time behind a left rail (the `.stonetop-guide-*` chrome every stepped sheet here wears),
 * because stacked lists that each grow without bound make a window taller than the screen: a Judge
 * four sessions in has brands and oaths both, and a Blessed can hold five kinds of mark at once.
 * `_railFor` builds the rail, `_selectTab` switches it, and a roster with only ONE list gets no
 * rail at all and keeps hugging its content. See templates/dialogs/partials/guide-tabs.hbs.
 *
 * WHAT SUBCLASSES STILL OWN: their getData, their template, their writers, and the rules that are
 * genuinely theirs — whether the roster may name its own character (a Judge cannot brand himself;
 * a Blessed may perfectly well put Barkskin on herself), and what extra fields a row carries.
 */
import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { getDragEventData } from "../../../utils/foundry-compat.js";
import { portraitOrNone, documentPortraitFrame } from "../../../utils/portrait-frame.js";
import { PERSON_ROSTER_IMG } from "../../../utils/person-portrait.js";
import { findNamedActor } from "../marked-people.js";
import { wireGrowableFields, refitGrowableFields } from "../../../utils/growable-fields.js";
import { applyGuideRail } from "../../../utils/guide-rail.js";

/**
 * Actor types a roster row can name — the same three for all of them.
 *
 * A steading is a place rather than somebody who can be denounced, so it is not here. The list
 * matters more to the Blessed than to the Judge (a marked BEAST is very often a monster document,
 * and a warded threshold is very often nothing at all), but the answer came out the same both
 * times, so it is asked once.
 */
export const ROSTER_ACTOR_TYPES = ["npc", "character", "monster"];

/**
 * How tall a railed roster opens.
 *
 * A pixel number rather than the `height: "auto"` these windows use without a rail, and that is
 * the whole point of the rail: a window that hugged whichever panel was showing would resize under
 * the cursor every time a tab was clicked, which is worse than the tall window this replaced. The
 * one panel scrolls inside a stable frame instead, and the frame is drag-resizable like every
 * other window here.
 */
const RAIL_HEIGHT = 520;

/** Shared markup contract for the rail. Both templates carry these; the wiring below is told once. */
const RAIL_TAB    = "stonetop-roster-tab";
const RAIL_PANEL  = "stonetop-roster-panel";
const RAIL_MAIN   = "stonetop-roster-main";

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
		// Which panel the rail is showing. Instance state, not view state, because these windows
		// re-render after every write (see renderIfOpen) — a tab held only in the DOM would snap
		// back to the first list every time a mark was lifted or a note was blurred.
		this._activeTab = null;
		// Filled by _railFor each getData: the keys the rail actually offered, so a click can be
		// checked against them, and whether there was a rail at all.
		this._railKeys = [];
		this._railed = false;
	}

	/**
	 * Hug the content — but only WITHOUT a rail.
	 *
	 * One list is one row per person and usually three or four of them, and a window that fits
	 * itself to that is the right window. The moment there are several lists the height is
	 * whichever panel happens to be showing, and re-fitting it per tab would make the frame jump
	 * about under the cursor; RAIL_HEIGHT holds it still and the panel scrolls inside it.
	 */
	get _autoHeight() { return !this._railed; }

	/**
	 * Turn this roster's lists into the left rail's view-model, and settle which one is showing.
	 *
	 * ONE LIST GETS NO RAIL. A rail of one entry is a label dressed as a choice, and it would cost
	 * 168px of width and a fixed height to tell a Judge who only owns Condemn something the window
	 * title already says. The caller's template is written so that the single section renders
	 * anyway — `_activeTab` is pointed at it — so neither template needs a second layout.
	 *
	 * THE ACTIVE TAB IS RE-CHECKED EVERY RENDER, not just carried. A list can stop existing under
	 * the player's hands: lifting the last Barkskin retires that kind's panel, releasing the last
	 * oath retires the Sworn half. Left pointing at a key nothing renders, the window would come
	 * back with every panel hidden and a rail with nothing lit — a blank window that looks broken
	 * and is only one click from fixed, which is the worst kind of bug to be told about.
	 *
	 * @param {Array<{key: string, title: string, icon: string, count?: number}>} sections
	 *   the lists this render actually draws, in rail order.
	 * @returns {{railed: boolean, tabs: Array, activeTab: ?string}} for the template.
	 */
	_railFor(sections) {
		this._railKeys = sections.map(s => s.key);
		const wasRailed = this._railed;
		this._railed = sections.length > 1;
		// Settled HERE, where the rail is decided and while getData still runs ahead of the
		// positioning at the end of `Application#_render`. On the TRANSITION only: growing a rail
		// takes the window to RAIL_HEIGHT, losing the last list hands it back to hugging, and an
		// ordinary re-render in between leaves alone whatever height the frame has — including one
		// the player dragged for themselves.
		if (this._railed !== wasRailed) this._setFrameHeight(this._railed ? RAIL_HEIGHT : "auto");
		if (!this._railKeys.includes(this._activeTab)) this._activeTab = this._railKeys[0] ?? null;
		return {
			railed:    this._railed,
			activeTab: this._activeTab,
			tabs:      this._railed
				? sections.map(s => ({ ...s, selected: s.key === this._activeTab }))
				: [],
		};
	}

	/**
	 * Show one list and light its rail entry.
	 *
	 * Purely DOM, through the shared rail sync — no re-render, so a half-typed name in one list's
	 * add field is still there when you come back to it, and the scroll position of the list you
	 * left is not disturbed. The same reason every other rail sheet in the system switches this
	 * way (see utils/guide-rail.js).
	 */
	_selectTab(key) {
		if (!this._railKeys.includes(key)) return;
		this._activeTab = key;
		applyGuideRail(this.element?.[0], {
			key, dataKey: "tab",
			tabSelector:     `.${RAIL_TAB}`,
			sectionSelector: `.${RAIL_PANEL}`,
			mainSelector:    `.${RAIL_MAIN}`,
		});
	}

	/**
	 * Every roster's shared listeners: the RAIL, which switches which list is shown, and the notes,
	 * which are chrome-less textareas that fit what is written into them (see the roster-row partial
	 * and utils/growable-fields.js).
	 *
	 * Subclasses call `super.activateListeners(html)` first and then wire their own, so a note grows
	 * and a tab switches on every one of these windows without any of them saying so.
	 *
	 * THE PREVIOUS RENDER'S OBSERVER IS DROPPED FIRST. A render replaces every field under the
	 * root, and a ResizeObserver holds its targets strongly — left connected, each render's dead
	 * textareas stay pinned for the life of the page. These windows re-render after every write,
	 * so that is a leak per note per dismissal.
	 */
	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];

		// WIRED BEFORE THE EDITABLE GATE subclasses return at: reading somebody else's roster is
		// looking, not writing, and a viewer who cannot lift a mark must still be able to see the
		// list it is on. Delegated, so the buttons a re-render replaces stay live.
		root.addEventListener("click", ev => {
			const tab = ev.target.closest(`.${RAIL_TAB}`);
			if (!tab) return;
			ev.preventDefault();
			this._selectTab(tab.dataset.tab);
		});

		this._dropNoteGrowth?.();
		this._dropNoteGrowth = wireGrowableFields(root);
		// A note that grew should be VISIBLE, not pushed under the window's lower edge: the height
		// was fitted to the content at render time, and the content has just got taller. Same
		// re-fit the render path does, at the other moment the content moves.
		//
		// ONLY WHEN THE FIELD ACTUALLY MOVED, which is a handful of keystrokes out of a sentence.
		// The field's own listener (utils/growable-fields.js) has already run by the time this
		// one does — a listener on the element beats this one on the root — so `style.height` is
		// the string that fit just wrote, and comparing it costs no layout. Re-fitting the WINDOW
		// does: setPosition resolves the frame's computed style and re-lays the whole dialog out,
		// rail and all, so per character it was a third forced reflow on top of the two the fit
		// itself pays, to arrive at the height the window already had.
		if (this._autoHeight) {
			const heights = new WeakMap();
			root.addEventListener("input", ev => {
				const field = ev.target;
				if (field.tagName !== "TEXTAREA") return;
				if (heights.get(field) === field.style.height) return;
				heights.set(field, field.style.height);
				this.setPosition({ height: "auto" });
			});
		}
	}

	/**
	 * Fit the notes once the window is actually on the page, so the height the base class then
	 * takes is the height of the grown notes.
	 *
	 * Needed because AppV1 injects a pop-out hidden and fades it in, so a field measured during
	 * `activateListeners` can measure NOTHING — a four-line note would open as one line and only
	 * find its height when somebody typed in it.
	 */
	_settleContent() {
		refitGrowableFields(this.element?.[0]);
	}

	/**
	 * Take the window to a fixed pixel height, or hand it back to hugging its content.
	 *
	 * BOTH FIELDS, and neither is optional. `options.height` is what core consults every time it
	 * is asked to position the frame: while it reads "auto" the positioner blanks `style.height`
	 * and measures the content, so a pixel height written anywhere else is measured away again on
	 * the next render. And `position.height` is the value actually passed to that positioner —
	 * `Application#_render` ends with `setPosition(this.position)` — so a frame whose options had
	 * changed but whose position still said "auto" would spend this render being measured too.
	 *
	 * This is the shape every other railed window in the system is BORN in: CustomMoveDialog 480,
	 * WoundDialog 545, CreateMonsterDialog 620. A roster is railed only sometimes, so it arrives
	 * at that shape here instead of in `defaultOptions`.
	 */
	_setFrameHeight(height) {
		this.options.height = height;
		if (this.position) this.position.height = height;
	}

	async close(options = {}) {
		this._dropNoteGrowth?.();
		this._dropNoteGrowth = null;
		return super.close(options);
	}

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
			? portraitOrNone(actor.img, documentPortraitFrame(actor))
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
	 * @param {HTMLElement} scope  what the two selectors are looked up INSIDE. The whole window for
	 *   a roster whose bars carry distinct classes (the Judge's brand bar and his oath bar), and the
	 *   PANEL for one whose bars are a loop over identical markup (the Blessed's, one per kind of
	 *   mark) — a window-wide lookup there would wire every kind's button to the first kind's field.
	 * @param {object} bar
	 * @param {string} bar.btnSelector   the add button
	 * @param {string} bar.nameSelector  the text field Enter should fire from
	 * @param {() => any} bar.add        what pressing either one does
	 */
	_wireAddBar(scope, { btnSelector, nameSelector, add }) {
		scope.querySelector(btnSelector)?.addEventListener("click", () => add());
		// Without this the fields sit inside a dialog with no form, so Enter does nothing at all.
		scope.querySelector(nameSelector)?.addEventListener("keydown", ev => {
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
	 *
	 * `scope` for the same reason `_wireAddBar` takes one: where a roster draws one bar per panel
	 * they all wear the same class, and clearing window-wide would empty the first panel's field
	 * while the one just used kept the name in it.
	 */
	_clearAddField(selector, scope = null) {
		const field = (scope ?? this.element?.[0])?.querySelector(selector);
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
