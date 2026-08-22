// The GM Toolkit's Encounters tab — what has been gathered for one session or one scene, in
// named bundles: the monsters, the read-aloud page, the battle map, the treasure table, the
// arcanum somebody is about to find.
//
// STORAGE IS THE TOOLKIT'S OWN, like the "I wonder..." list beside it and unlike the Threats and
// Sites tabs, whose JournalEntryPages stayed on the steading (gm-prep-tabs.js says so at length).
// It is a flat array on `actor.system.encounters`, and `this.actor` is the right document. On the
// toolkit rather than on the User for the same reason the toolkit is a singleton: a world has one
// set of prepared encounters whoever is running it, and a second GM opening their own toolkit
// should see the same list.
//
// WHAT IS STORED IS A POINTER, NEVER A COPY. Each collected row is a uuid plus the two things
// that stay useful once that uuid resolves to nothing (see `encountersField`). Compendium uuids
// are kept WHOLE, which is the deliberate opposite of RosterDialog's actor drop: that one
// discards a pack uuid and keeps the bare name, and is right to, because a Condemned row names a
// person in this world. Here the bestiary, the arcana and the journals ARE packs, so a list that
// could not point into one would be a list of almost nothing.
//
// TWO KINDS OF WRITE, the same split the wonder tab makes and for the same reason:
//
//   STRUCTURAL (add, collect, move, remove, mark used) re-renders. The list changed shape.
//
//   TEXT (renaming an encounter, an entry's note, the notes box) does NOT, and passes
//   `{ render: false }`. These save on `change`, which fires on BLUR, and an actor update
//   re-renders every sheet showing that actor — which would tear out the node that just took
//   focus. The cost is that a second GM does not see the typing until something else redraws
//   their copy. On a shared list that is slightly more visible than it is for wonders, and it is
//   still the right trade on a sheet only GMs can open.
//
// WRITES ARE SERIALIZED, which is not belt-and-braces here either. Dropping a document while a
// note box has focus fires `change` (one async write) and then `drop` (a second) with nothing
// between them. Both would read `actor.system.encounters` before either landed, and the second to
// finish would win: the note just typed would vanish with no error. The queue that prevents it is
// ActorListStore (actor-list-store.js), shared with the "I wonder..." tab.
//
// NOTHING TO UNWIRE. This mixin registers no world hooks, because the storage is `this.actor` and
// core's own `Document#_onUpdate -> app.render` already keeps a second GM's open toolkit in step.
// That is exactly what `{ render: false }` above gives up, and it is why there is no
// `_unwireGmEncounters` here to pair with `close()`.
import { wireDocumentDropZone } from "../../utils/card-drop-zone.js";
import { clusterPoint, dropActorOnCanvas } from "../../utils/token-drop.js";
import { enrichHTML } from "../../utils/foundry-compat.js";
import { compendiumRefTail, worldCopiesBySource } from "../../migration/compat.js";
import { escHtml, joinNames } from "../../utils/strings.js";
import { localize, format } from "../../utils/i18n.js";
import { error } from "../../utils/logger.js";
import { openEncounterNotesDialog } from "./encounter-notes-dialog.js";
import { ActorListStore } from "./actor-list-store.js";
import { localizedOnce } from "../../utils/localized-once.js";

/**
 * The tab's one edit section, and the JOIN it stands for: the template reads
 * `stonetop.edit.encounters`, and the sheet's `isSectionEditable` is keyed by the same string. A
 * typo in either half gives a section that can never be unlocked, with nothing logged.
 */
/**
 * "The world's copy of this pack document, if it has one", asked cheaply many times over.
 *
 * The index itself is `worldCopiesBySource` in migration/compat.js, beside `seededSourceKeys`,
 * which asks the same question of the same walk for the seeders. Deferred to the first question
 * so a deploy of world actors alone never pays to build it.
 */
function worldActorsBySource() {
	let index = null;
	const find = tail => {
		if (!tail) return null;
		index ??= worldCopiesBySource(game.actors ?? []);
		return index.get(tail) ?? null;
	};
	// IT HAS TO LEARN, or the index defeats the very duplication it exists to prevent. The map is
	// built on the first question and the deploy that asked it goes on to IMPORT what it could not
	// find, so a second row pointing at the same pack Actor -- "three hillfolk raiders", listed
	// three times -- would miss against a snapshot taken before the first import and mint a second
	// and a third copy into the world's Actors directory from one press. The live `.find()` this
	// index replaced could not: it saw the copy the previous entry had just made.
	find.remember = (tail, actor) => {
		if (tail && actor && index) index.set(tail, actor);
	};
	return find;
}

const ENCOUNTER_SECTION = "encounters";

/**
 * Reordering an encounter among its siblings.
 *
 * The ONE custom drag type this tab needs, because an encounter is the one thing on it that is
 * not a document. Everything else — dragging a collected row out to the canvas, moving it to
 * another encounter, reordering it in place — rides core's own `{type, uuid}` payload (see
 * `_wireGmEncounterDrag`). Named like the four that already exist (`FOLLOWER_DRAG_TYPE` and
 * friends).
 */
export const STONETOP_ENCOUNTER_DRAG_TYPE = "StonetopEncounter";

/**
 * What this tab collects, and the only place that list is written down.
 *
 * One table serves three readers that must never disagree: the drop filter (a payload whose type
 * is not a key here is refused), the row's icon, and the kind label under the name. Keyed by
 * `documentName`, which is what core's drag payload carries in `type`.
 *
 * Deploy filters on `"Actor"` directly rather than on a flag here, because "can a token be made
 * of it" is a fact about the canvas and not about this table.
 */
export const ENCOUNTER_DOC_TYPES = Object.freeze({
	Actor:            { icon: "fas fa-user",            labelKey: "stonetop.gmToolkit.encounters.kind.actor" },
	Item:             { icon: "fas fa-gem",             labelKey: "stonetop.gmToolkit.encounters.kind.item" },
	JournalEntry:     { icon: "fas fa-book",            labelKey: "stonetop.gmToolkit.encounters.kind.journal" },
	// A page has no window worth showing, so it opens its PARENT at itself.
	JournalEntryPage: {
		icon: "fas fa-file-lines", labelKey: "stonetop.gmToolkit.encounters.kind.page",
		open: doc => doc.parent?.sheet?.render(true, { pageId: doc.id }),
	},
	// VIEWED rather than configured, which is what a GM means by opening a battle map. A Scene in
	// a pack cannot be viewed, so it falls back to its sheet like everything else.
	Scene: {
		icon: "fas fa-map", labelKey: "stonetop.gmToolkit.encounters.kind.scene",
		open: doc => (doc.pack ? null : doc.view?.()),
	},
	RollTable:        { icon: "fas fa-dice-d20",        labelKey: "stonetop.gmToolkit.encounters.kind.table" },
	Macro:            { icon: "fas fa-code",            labelKey: "stonetop.gmToolkit.encounters.kind.macro" },
});

/**
 * Bumped whenever anything a note could LINK to is renamed, which the enriched-notes cache below
 * checks alongside the prose it was built from.
 *
 * The prose alone is not enough to key on. `enrichHTML` resolves an @UUID link to the target's
 * CURRENT name, so renaming a linked monster leaves a byte-identical `notes` string enriching to
 * different HTML -- and the cache went on serving the old name for the rest of the session while
 * every other surface in the world showed the new one. A counter rather than a targeted
 * invalidation because a rename is rare and re-enriching a handful of notes is cheap, whereas
 * working out which notes mention which document means parsing them.
 *
 * Registered in stonetop.js, so a sheet that is never opened costs nothing.
 */
let _notesGeneration = 0;
export function bumpEncounterNotesGeneration() {
	_notesGeneration += 1;
}

/** The glyph for a type this build does not know, so an unknown row still draws. */
const UNKNOWN_KIND = Object.freeze({ icon: "fas fa-circle-question", labelKey: "stonetop.gmToolkit.encounters.kind.unknown" });

/**
 * The same table with its labels already localized, built on the first render and held.
 *
 * Seven constant keys, and this sheet re-renders on every threat, hazard and site write ANYWHERE
 * in the world -- so a GM with six encounters of five rows was paying thirty `localize` lookups
 * each time another client ticked a doom track. The prep tab next door holds `threatReference` the
 * same way and says so for the same reason. Never invalidated, because the language cannot change
 * without a reload; `localizedOnce` is what makes it safe to build before i18n is ready.
 */
const encounterKinds = localizedOnce(() => {
	const kinds = {};
	for (const [type, kind] of Object.entries(ENCOUNTER_DOC_TYPES)) {
		kinds[type] = { icon: kind.icon, typeLabel: localize(kind.labelKey) };
	}
	kinds._unknown = { icon: UNKNOWN_KIND.icon, typeLabel: localize(UNKNOWN_KIND.labelKey) };
	return kinds;
});

/**
 * One collected row, in the shape the schema and the sheet agree on.
 *
 * `keepId: false` mints a new id, which is what the collect path wants; every other path keeps
 * the one already there. Same shape and same reasoning as `normalizeWonder`.
 */
export function normalizeEntry(e = {}, { keepId = true } = {}) {
	return {
		id:   (keepId && e?.id) ? e.id : foundry.utils.randomID(),
		uuid: typeof e?.uuid === "string" ? e.uuid : "",
		type: typeof e?.type === "string" ? e.type : "",
		name: typeof e?.name === "string" ? e.name : "",
		note: typeof e?.note === "string" ? e.note : "",
	};
}

/**
 * One encounter, ditto, entries and all.
 *
 * No `keepId` of its own, unlike `normalizeEntry`: an encounter is only ever normalized on the
 * way OUT of storage or with an id already minted for it, so there is no caller that wants a
 * fresh one. Only the collect path mints, and it calls `normalizeEntry` directly.
 */
export function normalizeEncounter(enc = {}) {
	return {
		id:      enc?.id || foundry.utils.randomID(),
		name:    typeof enc?.name === "string" ? enc.name : "",
		notes:   typeof enc?.notes === "string" ? enc.notes : "",
		used:    !!enc?.used,
		entries: Array.isArray(enc?.entries) ? enc.entries.map(e => normalizeEntry(e)) : [],
	};
}

/**
 * Move one element of `list` to `to`, clamped. Returns null for a no-op so an unchanged order
 * stays off the wire.
 *
 * Identity comparison is enough for the no-op test because nothing here rebuilds an element.
 */
export function moveWithin(list, from, to) {
	if (from < 0 || from >= list.length) return null;
	const next = [...list];
	const [moved] = next.splice(from, 1);
	next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
	return next.every((x, i) => x === list[i]) ? null : next;
}

/**
 * Where a drop lands: before the row it hit, or `fallback` when it named no neighbour.
 *
 * ALWAYS called against a list the dragged row has already been taken OUT of — see `_moveEntry`
 * for why that ordering is the whole trick.
 */
export function insertionIndexIn(rows, beforeId, fallback) {
	if (!beforeId) return fallback;
	const i = rows.findIndex(r => r.id === beforeId);
	return i < 0 ? fallback : i;
}

/**
 * One stored entry, in the shape the row renders from.
 *
 * NEVER DROPS A SLOT — the rule `resolvePersonRow` states on the steading. Every control on a row
 * is addressed by an id read off the rendered node, so a list that silently skipped its missing
 * rows would leave those controls acting on the wrong one.
 *
 * A missing target keeps its CACHED name and stops being draggable, which is the whole reason the
 * name and the type are stored at all: a uuid on its own resolves to nothing and says nothing.
 *
 * `fromUuidSync` FIRST, and `{ strict: false }` on that call is NOT optional. With the default it
 * THROWS for a compendium JournalEntryPage uuid — an embedded document inside a pack, which is
 * exactly what a page dragged out of the shipped journal pack is — and takes the whole render
 * with it. With the flag, that one case answers null and falls through to the async path, while
 * every other kind (any world document; a pack Actor, Item, Scene, RollTable or Macro, whose
 * INDEX entry already carries the name) answers with no await at all. This sheet re-renders on
 * every threat, hazard and site write anywhere in the world, so "no pack load per row per render"
 * is the difference between a tab and a stutter.
 */
export async function resolveEncounterEntry(entry) {
	const kinds = encounterKinds();
	const kind = kinds[entry?.type] ?? kinds._unknown;
	const base = {
		id: entry?.id ?? "",
		uuid: entry?.uuid ?? "",
		type: entry?.type ?? "",
		note: entry?.note ?? "",
		name: entry?.name ?? "",
		icon: kind.icon,
		typeLabel: kind.typeLabel,
		unresolved: true,
		inPack: false,
	};
	if (!base.uuid) return base;

	let doc = null;
	try {
		doc = globalThis.fromUuidSync?.(base.uuid, { strict: false }) ?? null;
	} catch (_) {
		doc = null;
	}
	if (!doc) doc = await fromUuid(base.uuid).catch(() => null);
	if (!doc) return base;

	// The LIVE name wins whenever there is one, so a renamed monster reads as renamed here. The
	// stored one is a fallback, never a second source of truth.
	return { ...base, name: doc.name || base.name, unresolved: false, inPack: !!doc.pack };
}

export function withGmEncountersTab(Base) {
	return class GmEncountersTab extends Base {
		/**
		 * This tab's list, and the whole protocol for writing to it: the queue that makes each
		 * mutation read what the last one left, the whole-array update, and the swallow at the
		 * tail that keeps one failed write from wedging every write behind it. Shared with the
		 * "I wonder..." tab, which keeps its own list the same way — see actor-list-store.js.
		 *
		 * The name is checked against AppV1's own members, as every field on this sheet has to
		 * be: a collision there is silent. `_encounters` collides with nothing in Application,
		 * FormApplication or ActorSheet.
		 */
		_encounters = new ActorListStore(this, {
			path: "system.encounters",
			normalize: normalizeEncounter,
			writeFailedKey: "stonetop.gmToolkit.encounters.writeFailed",
		});

		/**
		 * Which encounters are expanded. Reading state, in memory only, like `_cardCollapse` on
		 * the prep tabs next door.
		 *
		 * Deliberately NOT the shared `section-collapse` machinery: `_wireSectionCollapse` binds a
		 * CAPTURE-phase click on `.stonetop-section-collapse` and folds by walking
		 * HEADING_SELECTOR siblings, so a per-row caret wearing that class would be swallowed
		 * before this file saw it and would fold the wrong run of nodes.
		 *
		 * Collides with nothing in Application, FormApplication or ActorSheet.
		 */
		_encounterOpen = new Set();

		/**
		 * Each encounter's enriched notes, keyed by id, against the prose they were built from.
		 * Read and pruned by `_addGmEncountersContext`; see `_encounterNotesHtml` for why.
		 *
		 * Collides with nothing in Application, FormApplication or ActorSheet.
		 */
		_notesHtmlCache = new Map();

		/**
		 * Which control claims the caret after the next paint, and whether to select what is in
		 * it.
		 *
		 * A new encounter is named "New encounter" and the GM's next act is always to type over
		 * that, so the add path hands the caret on with the text selected. A REORDER hands it on
		 * without selecting: the GM is holding a row and moving it, and alt+ArrowDown three times
		 * has to reach the row three times rather than falling to `<body>` after the first.
		 *
		 * `entryId` addresses a collected row's open button; without one the encounter's own name
		 * box takes it. Two controls rather than one because both reorder paths re-render, and both
		 * therefore replace the node the GM was holding.
		 *
		 * It travels as a stash rather than as a `focus()` call for the reason `_onWonderAdd` gives:
		 * the render is kicked off from inside `Document.update`, so by the time the write's await
		 * returns the node we would have focused has already been replaced.
		 *
		 * Collides with nothing in Application, FormApplication or ActorSheet.
		 */
		_encounterFocus = null;

		/* ── reading ─────────────────────────────────────────────────────────────── */

		/** Every encounter, normalized. Read fresh on each call — this is the live document. */
		_encounterList() {
			return this._encounters.list();
		}

		/** One encounter by id, or null. */
		_encounter(id) {
			return this._encounters.get(id);
		}

		/**
		 * Is this tab's pencil on? The one gate on the two destructive buttons.
		 *
		 * A method rather than a read of `stonetop.edit`, because the click handlers run against
		 * the sheet and not against a render's context.
		 */
		_encounterEditing() {
			return this.isSectionEditable(ENCOUNTER_SECTION);
		}

		/* ── writing ─────────────────────────────────────────────────────────────── */

		/** Apply `transform` to the list and save the result. See ActorListStore#mutate. */
		_mutateEncounters(transform, options) {
			return this._encounters.mutate(transform, options);
		}

		/**
		 * Add an encounter, optionally holding what was just dropped on it.
		 *
		 * The id is minted HERE rather than by the schema, so the caret can be claimed for it
		 * before the write goes out — see `_encounterFocus`.
		 *
		 * @returns {Promise<string>} the new encounter's id.
		 */
		async _addEncounter(name, { entries = [] } = {}) {
			const id = foundry.utils.randomID();
			this._encounterOpen.add(id);
			this._encounterFocus = { id, select: true };
			await this._mutateEncounters(list => [
				...list,
				normalizeEncounter({ id, name: String(name ?? "").trim(), entries }),
			]);
			return id;
		}

		/**
		 * A new encounter named after the document just dropped on empty space, holding it.
		 *
		 * ONE write, not add-then-add: two would leave a nameless empty encounter on screen if the
		 * second failed, and would re-render the tab twice for one gesture.
		 */
		_createEncounterFrom(entry) {
			return this._addEncounter(entry.name, { entries: [entry] });
		}

		/** Set one field of one encounter. No write at all when the value is unchanged. */
		_setEncounterField(id, key, value, options) {
			return this._encounters.setField(id, key, value, options);
		}

		/** Mark an encounter run, or put it back. */
		_setEncounterUsed(id, used) {
			return this._setEncounterField(id, "used", !!used, { render: true });
		}

		/** Drop an encounter, and everything gathered into it, for good. */
		_removeEncounter(id) {
			return this._encounters.remove(id);
		}

		/**
		 * Move an encounter to sit before `overId`, or last when the drop named no neighbour.
		 *
		 * Last is what a drop on empty tab space can unambiguously mean, and it is the only place
		 * a neighbourless drop CAN mean something: there is no "before nothing".
		 */
		_reorderEncounter(dragId, overId) {
			return this._mutateEncounters(list => {
				const from = list.findIndex(e => e.id === dragId);
				if (from < 0 || dragId === overId) return null;
				// Through the SAME primitive the keyboard path uses, including its no-op contract:
				// this used to re-implement the splice and the identity test inline, so a fix to
				// `moveWithin` reached the nudge and not the drag. The destination is computed against
				// a list the row has already been taken OUT of, for the reason spelt out on
				// `_moveEntry`, and `moveWithin` then does the removal itself from the original index.
				const without = list.filter((_, i) => i !== from);
				return moveWithin(list, from, insertionIndexIn(without, overId, without.length));
			});
		}

		/**
		 * Nudge an encounter one place up or down. The keyboard path; same primitive.
		 *
		 * The caret is handed on because this RENDERS: every name box is re-emitted, so the input
		 * the GM is holding is replaced and focus falls to `<body>`. Without the stash, moving an
		 * encounter three places cost three manual re-focuses and the second keypress went to the
		 * document instead of the row.
		 */
		_nudgeEncounter(id, delta) {
			this._encounterFocus = { id };
			return this._mutateEncounters(list => {
				const from = list.findIndex(e => e.id === id);
				return from < 0 ? null : moveWithin(list, from, from + delta);
			});
		}

		/**
		 * Rewrite ONE encounter's collected rows, whatever the edit is.
		 *
		 * Five callers used to hand-roll the same preamble and postamble -- find the encounter,
		 * clone the list, rebuild `next[i].entries` -- which meant any change to how an encounter's
		 * rows are written (an audit stamp, a `used` side effect, a different no-op rule) had to
		 * land in five places or in none. `fn` is handed the rows and returns the new ones, or null
		 * for a no-op, which is the same contract `mutate` itself keeps.
		 */
		_mutateEntries(encId, fn, options) {
			return this._mutateEncounters(list => {
				const i = list.findIndex(e => e.id === encId);
				if (i < 0) return null;
				const entries = fn(list[i].entries);
				if (!entries) return null;
				const next = [...list];
				next[i] = { ...next[i], entries };
				return next;
			}, options);
		}

		/** Collect a document into an encounter, before `beforeEntryId` or at the end. */
		_addEncounterEntry(encId, entry, beforeEntryId = null) {
			return this._mutateEntries(encId, rows => {
				const entries = [...rows];
				entries.splice(insertionIndexIn(entries, beforeEntryId, entries.length), 0, normalizeEntry(entry, { keepId: false }));
				return entries;
			});
		}

		/**
		 * Move a collected row: within its own encounter, or into another one.
		 *
		 * Both in one transform because they are one gesture — the GM drags a row and lets go
		 * somewhere — and splitting them would mean the destination was decided by which handler
		 * happened to claim the drop.
		 */
		_moveEntry(fromEncId, entryId, toEncId, beforeEntryId = null) {
			return this._mutateEncounters(list => {
				const from = list.findIndex(e => e.id === fromEncId);
				const to   = list.findIndex(e => e.id === toEncId);
				if (from < 0 || to < 0) return null;
				const i = list[from].entries.findIndex(x => x.id === entryId);
				if (i < 0 || entryId === beforeEntryId) return null;   // dropped on itself

				const next  = [...list];
				const moved = next[from].entries[i];
				// TAKEN OUT FIRST, always, even when it is going back into the same list.
				// Computing the destination against an array that still holds the row is the
				// off-by-one every hand-written reorder has: "before the third row" is index 2
				// before the removal and index 3 after it, and which one is right depends on which
				// way the row travelled.
				next[from] = { ...next[from], entries: next[from].entries.filter((_, n) => n !== i) };
				const dest = next[to].entries;                          // the same array when from === to
				const entries = [...dest];
				entries.splice(insertionIndexIn(dest, beforeEntryId, dest.length), 0, moved);
				next[to] = { ...next[to], entries };
				// THE SAME NO-OP CONTRACT `_reorderEncounter` and `moveWithin` keep, and "dropped on
				// itself" is not the whole of it: dropping a row on the one immediately BELOW it, or on
				// its own encounter's dropzone when it is already last, both put it back where it
				// started. Without this the gesture still wrote the whole array and re-rendered the
				// toolkit on every GM's client, for an order nobody changed.
				if (from === to && entries.every((x, n) => x === list[from].entries[n])) return null;
				return next;
			});
		}

		/**
		 * Nudge a collected row one place up or down inside its own encounter.
		 *
		 * Hands the caret on for the reason `_nudgeEncounter` gives: this renders, so the open
		 * button the GM is holding is replaced and the next keypress would reach the document.
		 */
		_nudgeEntry(encId, entryId, delta) {
			this._encounterFocus = { id: encId, entryId };
			return this._mutateEntries(encId, rows => {
				const from = rows.findIndex(x => x.id === entryId);
				return from < 0 ? null : moveWithin(rows, from, from + delta);
			});
		}

		/** Write a collected row's GM note. No render — it saves on blur. */
		_setEntryNote(encId, entryId, note) {
			return this._mutateEntries(encId, rows => {
				const n = rows.findIndex(x => x.id === entryId);
				if (n < 0 || rows[n].note === note) return null;
				const entries = [...rows];
				entries[n] = { ...entries[n], note };
				return entries;
			}, { render: false });
		}

		/** Take one collected row out. */
		_removeEntry(encId, entryId) {
			return this._mutateEntries(encId, rows => {
				const entries = rows.filter(x => x.id !== entryId);
				return entries.length === rows.length ? null : entries;
			});
		}

		/* ── context ─────────────────────────────────────────────────────────────── */

		/**
		 * Publish the tab's context. Call from the host's getData.
		 *
		 * ASYNC, unlike the wonder tab's — see `resolveEncounterEntry` for what it has to wait on
		 * and, more to the point, for what it manages not to.
		 */
		/**
		 * One encounter's notes as enriched HTML, held against the prose it was built from.
		 *
		 * Enriching is a regex sweep plus content-link resolution, and this sheet re-renders on
		 * every prep write ANYWHERE in the world — a burst of ticks on another client used to
		 * re-enrich the whole list, repeatedly, for prose that was identical every time. The source
		 * string is the key, so an edit still rebuilds on the very next paint.
		 */
		async _encounterNotesHtml(enc) {
			if (!enc.notes) return "";
			const hit = this._notesHtmlCache.get(enc.id);
			if (hit?.src === enc.notes && hit.gen === _notesGeneration) return hit.html;
			const html = await enrichHTML(enc.notes, { secrets: true });
			this._notesHtmlCache.set(enc.id, { src: enc.notes, gen: _notesGeneration, html });
			return html;
		}

		async _addGmEncountersContext(context) {
			const list = this._encounterList();
			context.stonetop.encounters = await Promise.all(list.map(async enc => ({
				...enc,
				open:        this._encounterOpen.has(enc.id),
				entryCount:  enc.entries.length,
				// Enriched for every encounter and not only the open ones, because the body is in
				// the DOM either way: expanding is a CSS class this file toggles in place, so that
				// it costs no render and cannot lose a caret (see `_activateGmEncountersListeners`).
				notesHtml:   await this._encounterNotesHtml(enc),
				entries:     await Promise.all(enc.entries.map(resolveEncounterEntry)),
			})));
			// Rows the list no longer holds, so a session of adding and removing cannot grow the
			// enrich cache without bound.
			const live = new Set(list.map(enc => enc.id));
			for (const id of this._notesHtmlCache.keys()) if (!live.has(id)) this._notesHtmlCache.delete(id);
			// MERGED, never assigned over: the prep mixin publishes `threats` and `sites` into
			// this same object and the wonder mixin publishes two more, and whichever of the three
			// ran last would drop the others' flags — which renders those sections permanently
			// read-only with nothing logged.
			context.stonetop.edit = {
				...(context.stonetop.edit ?? {}),
				[ENCOUNTER_SECTION]: this.isSectionEditable(ENCOUNTER_SECTION),
			};
		}

		/* ── drops ───────────────────────────────────────────────────────────────── */

		/**
		 * The stored row for a dropped payload, or null for a payload this tab does not collect.
		 *
		 * Resolved through `fromUuid` rather than `fromUuidSync`, and here that IS unconditional:
		 * this runs once per DROP, not once per render, and a name read off the real document
		 * beats one read off an index that may not have loaded. A pack we cannot load still gets a
		 * row rather than a silent refusal — the uuid and the type are enough to draw one, and
		 * enough to resolve it later once the pack is there.
		 */
		async _encounterEntryFrom(data) {
			if (!ENCOUNTER_DOC_TYPES[data?.type]) return null;
			const uuid = String(data?.uuid ?? "").trim();
			// Reachable, not defensive: `utils/treasure-drops.js` emits `{type: "Item", data: {…}}`
			// with the item's data embedded and no uuid at all, and there is nothing stable in
			// that to point at.
			if (!uuid) {
				this._encounterWarn("noUuid");
				return null;
			}
			const doc = await fromUuid(uuid).catch(() => null);
			return {
				uuid,
				type: data.type,
				name: doc?.name || String(data?.name ?? "").trim() || localize("stonetop.gmToolkit.encounters.unnamedEntry"),
				note: "",
			};
		}

		/**
		 * Every drop that lands anywhere on the tab.
		 *
		 * ONE handler rather than three nested zones, because all four gestures arrive as the same
		 * event and the only thing telling them apart is the payload plus where it landed. Split
		 * across nested zones, "where it landed" becomes "which zone claimed it first", which is a
		 * fact about DOM nesting rather than about what the GM did.
		 *
		 * `preventDefault` has already run, synchronously, before the payload was read — inside
		 * `wireDocumentDropZone`. That order is load-bearing; the helper says why.
		 */
		async _onEncounterDrop(data, target) {
			const overEncounter = target?.closest?.("[data-encounter-id]")?.dataset?.encounterId ?? null;
			const overEntry     = target?.closest?.("[data-entry-id]")?.dataset?.entryId ?? null;

			// An encounter dragged by its grip. The only gesture here whose subject is not a
			// document, and so the only one needing a drag type of our own.
			if (data.type === STONETOP_ENCOUNTER_DRAG_TYPE) {
				return this._reorderEncounter(data.encounterId, overEncounter);
			}
			if (!ENCOUNTER_DOC_TYPES[data.type]) return;

			// One of OUR OWN rows, dragged from elsewhere on this tab. Core reads only `type` and
			// `uuid` off this payload, so the two extra keys ride along invisibly to every other
			// drop target in Foundry and mean "move me" here and nowhere else.
			if (data.stonetopEntryId) {
				// Dropped on empty tab space: it already lives here, so making a second encounter
				// out of it would be a copy nobody asked for.
				if (!overEncounter) return;
				return this._moveEntry(data.stonetopEncounterId, data.stonetopEntryId, overEncounter, overEntry);
			}

			const entry = await this._encounterEntryFrom(data);
			if (!entry) return;
			if (overEncounter) return this._addEncounterEntry(overEncounter, entry, overEntry);
			return this._createEncounterFrom(entry);
		}

		/**
		 * Two drags leave this tab, and one delegated listener claims both. Delegated because
		 * every node here is re-emitted on a re-render, and this sheet re-renders for reasons that
		 * have nothing to do with this tab.
		 *
		 * The entry handle emits CORE'S OWN payload, `{type, uuid}` — the same thing
		 * `Document#toDragData` puts on the wire from the sidebar — so the canvas places a token
		 * (importing a pack actor on the way), the hotbar makes a macro, the sidebar directories
		 * import a copy, and this system's own sheets route it exactly as they route a sidebar
		 * drag, with nothing here having to know about any of them. The two `stonetop*` keys ride
		 * ALONGSIDE rather than replacing anything: no core target reads an unknown key, and
		 * `_onEncounterDrop` uses them to tell "this came from another encounter of mine, move it"
		 * from "this is new, collect it".
		 *
		 * That is one payload doing three jobs, which is why there is no separate grip on a
		 * collected row and only one custom drag type in this file.
		 *
		 * It CANNOT be async: a dragstart that awaits has already lost its `dataTransfer`, which
		 * is the other reason every value here is read off the element rather than resolved.
		 *
		 * The contract for the second branch is what the HANDLE is (draggable, carrying a uuid and
		 * a type), not which row kind it belongs to — the same shape `StonetopSteadingSheet` uses
		 * for its actor handles, and for the same reason its comment gives.
		 */
		_wireGmEncounterDrag(root) {
			root.addEventListener("dragstart", ev => {
				const grip = ev.target.closest?.(".stonetop-gm-encounter-grip[draggable='true']");
				if (grip) {
					const encounterId = grip.closest("[data-encounter-id]")?.dataset?.encounterId;
					if (!encounterId) { ev.preventDefault(); return; }
					ev.stopPropagation();
					ev.dataTransfer.setData("text/plain", JSON.stringify({ type: STONETOP_ENCOUNTER_DRAG_TYPE, encounterId }));
					ev.dataTransfer.effectAllowed = "move";
					return;
				}

				const handle = ev.target.closest?.("[draggable='true'][data-uuid][data-doc-type]");
				if (!handle) return;
				const { uuid, docType } = handle.dataset;
				if (!uuid || !docType) { ev.preventDefault(); return; }
				ev.stopPropagation();
				ev.dataTransfer.setData("text/plain", JSON.stringify({
					type: docType,
					uuid,
					stonetopEncounterId: handle.closest("[data-encounter-id]")?.dataset?.encounterId ?? "",
					stonetopEntryId:     handle.closest("[data-entry-id]")?.dataset?.entryId ?? "",
				}));
				ev.dataTransfer.effectAllowed = "copyMove";
			});
		}

		/* ── deploy ──────────────────────────────────────────────────────────────── */

		/**
		 * Put every Actor in this encounter on the map at once.
		 *
		 * Actors ONLY, and everything else is SKIPPED rather than refused: an encounter
		 * deliberately holds the scene, the roll table and the read-aloud page beside the
		 * monsters, and a Deploy that stopped at the first journal page would be a button a GM
		 * could never press.
		 */
		async _deployEncounter(id) {
			const encounter = this._encounter(id);
			if (!encounter) return;
			if (!globalThis.canvas?.scene) return this._encounterWarn("noScene");
			// Asked here as well as inside core's own path, which warns per call: one toast for a
			// deploy of eight, rather than eight identical ones.
			if (!game.user?.can?.("TOKEN_CREATE")) return this._encounterWarn("noTokens");

			const wanted = encounter.entries.filter(e => e.type === "Actor");
			if (!wanted.length) return this._encounterWarn("nothingToDeploy");

			const actors = [];
			const missed = [];
			let imported = 0;
			// ONE pass over the world's actors for the whole deploy. The lookup below used to scan
			// `game.actors` per entry, and this world seeds ~180 bestiary monsters, so an eight-
			// monster encounter walked ~1,400 actors reading a compendium source off each. Built
			// lazily, because an encounter of world actors never asks for it at all.
			const worldCopy = worldActorsBySource();
			// SEQUENTIAL, and here that is not incidental: each miss may IMPORT, and the next row has
			// to see what the last one imported or the same monster listed twice lands twice. The
			// waiting is `fromUuid` per row, which answers from the pack index without a load for
			// anything already resolved once.
			for (const entry of wanted) {
				const found = await this._deployableActor(entry, worldCopy);
				if (!found) { missed.push(entry.name); continue; }
				if (found.imported) imported += 1;
				actors.push(found.actor);
			}

			// SEQUENTIAL, not Promise.all. Each placement reads `getMaxSort()` off the layer to
			// stack the next token above the last, and a batch fired at once reads the same value
			// for all of them. It is also one create per token, which is exactly what a GM
			// dragging them in one at a time would produce.
			let placed = 0;
			for (const [i, actor] of actors.entries()) {
				const point = clusterPoint(globalThis.canvas, i, actors.length);
				// Core returns FALSE for a point outside the scene rect and places nothing,
				// silently, so the count that gets reported has to know about it before it asks.
				if (!point) { missed.push(actor.name); continue; }
				try {
					await dropActorOnCanvas(globalThis.canvas, actor, point, { altKey: false, shiftKey: false });
					placed += 1;
				} catch (err) {
					error("failed to deploy an encounter actor", err);
					missed.push(actor.name);
				}
			}

			if (placed) {
				ui.notifications?.info?.(format("stonetop.gmToolkit.encounters.deployed", {
					count: placed, name: encounter.name || localize("stonetop.gmToolkit.encounters.removeUnnamed"),
				}));
			}
			// Stated out loud rather than left as a side effect: importing writes new documents
			// into the world's Actors directory, and a GM should never find them there without
			// having been told.
			if (imported) {
				ui.notifications?.info?.(format("stonetop.gmToolkit.encounters.deployImported", { count: imported }));
			}
			// Through the system's ONE list-joiner, so this reads like every other "you got A, B & C"
			// toast rather than being the one place with a different conjunction.
			if (missed.length) this._encounterWarn("deploySkipped", { names: joinNames(missed) });
		}

		/**
		 * The world Actor to make a token of, and whether making it available meant importing one.
		 *
		 * A token needs a WORLD actor to point at, so a compendium entry has to become one. Core's
		 * own canvas drop (`TokenLayer#_onDropActorData`) imports unconditionally, without ever
		 * looking for a copy already in the world — and this world SEEDS the whole bestiary into
		 * `game.actors` on ready (hooks/SeedActors.js). Handed a pack uuid, core would therefore
		 * mint a duplicate of an already-imported monster on every deploy of every encounter, for
		 * the life of the campaign. The check below is the difference.
		 *
		 * Matched on the compendium source with the package id stripped (`compendiumRefTail`), so
		 * a world seeded under an older system id still counts as having it.
		 *
		 * The stored uuid is NOT rewritten to the imported copy. The pack entry is the stable
		 * identity — a world copy can be deleted, and the row should still point at the monster —
		 * and this check finds the copy again next time without help.
		 */
		async _deployableActor(entry, worldCopy = worldActorsBySource()) {
			const doc = await fromUuid(entry.uuid).catch(() => null);
			if (doc?.documentName !== "Actor") return null;
			if (!doc.pack) return { actor: doc, imported: false };

			const tail = compendiumRefTail(doc.uuid);
			const copy = worldCopy(tail);
			if (copy) return { actor: copy, imported: false };

			if (!Actor.canUserCreate(game.user)) return null;
			const created = await Actor.create(game.actors.fromCompendium(doc), { fromCompendium: true });
			if (!created) return null;
			// Told to the index straight away: the next entry in this same deploy asks the same
			// question of a map that was built before this import, and would otherwise import again.
			worldCopy.remember?.(tail, created);
			return { actor: created, imported: true };
		}

		/* ── listeners ───────────────────────────────────────────────────────────── */

		/**
		 * The tab's interactions, delegated on the sheet root: the add bar, the per-row buttons,
		 * the two text fields, the keyboard reorder, and both halves of the drag.
		 *
		 * Delegated rather than bound per element because every one of these nodes is re-emitted
		 * whenever the tab re-renders, which a structural write does on purpose.
		 */
		_activateGmEncountersListeners(root) {
			if (!root) return;

			// Before any of them: this render's name boxes are new nodes, and a caret handed on by
			// the last add is still only in memory.
			this._restoreGmEncounterFocus(root);

			root.addEventListener("click", async ev => {
				if (ev.target.closest(".stonetop-gm-encounter-add-btn")) {
					ev.preventDefault();
					return this._onEncounterAdd();
				}

				// Expanding is a CLASS TOGGLE, not a render. The body is in the DOM either way, so
				// there is nothing to fetch and nothing to rebuild — and a render here would be one
				// that could land while a note box two rows down had focus.
				const toggle = ev.target.closest(".stonetop-gm-encounter-toggle");
				if (toggle) {
					ev.preventDefault();
					const row = toggle.closest("[data-encounter-id]");
					const id = row?.dataset?.encounterId;
					if (!id) return;
					const collapsed = row.classList.toggle("is-collapsed");
					// Both, and by hand: nothing re-renders here, so the markup's own conditional
					// never runs again and a screen reader would keep reading the state it opened in.
					toggle.setAttribute("aria-expanded", String(!collapsed));
					toggle.setAttribute("aria-label", localize(`stonetop.gmToolkit.encounters.${collapsed ? "expand" : "collapse"}`));
					if (collapsed) this._encounterOpen.delete(id); else this._encounterOpen.add(id);
					return;
				}

				const notes = ev.target.closest(".stonetop-gm-encounter-notes-edit");
				if (notes) {
					ev.preventDefault();
					const id = this._encounterIdFrom(notes);
					const encounter = id ? this._encounter(id) : null;
					if (!encounter) return;
					// Rendered on save, unlike every other text write on this tab: what changed is
					// in a separate window, so there is no caret on the sheet for a repaint to take
					// away, and the read-only block behind the dialog would otherwise still show
					// the old prose.
					return openEncounterNotesDialog(encounter, html => this._setEncounterField(id, "notes", html, { render: true }));
				}

				const deploy = ev.target.closest(".stonetop-gm-encounter-deploy");
				if (deploy) {
					ev.preventDefault();
					const id = this._encounterIdFrom(deploy);
					if (id) await this._deployEncounter(id);
					return;
				}

				const used = ev.target.closest(".stonetop-gm-encounter-used");
				if (used) {
					ev.preventDefault();
					const id = this._encounterIdFrom(used);
					if (id) await this._setEncounterUsed(id, !this._encounter(id)?.used);
					return;
				}

				// The two destructive buttons, both behind the pencil. The template does not draw
				// them at all while it is off, so this is the second lock and not the first — but a
				// delegated handler outlives the markup it was written against (a re-render lands
				// new nodes under the same listener), and "the button isn't there" is a claim about
				// CSS that this file cannot check.
				const removeEntry = ev.target.closest(".stonetop-gm-encounter-entry-remove");
				if (removeEntry) {
					ev.preventDefault();
					if (!this._encounterEditing()) return;
					const encId = this._encounterIdFrom(removeEntry);
					const entryId = this._entryIdFrom(removeEntry);
					if (encId && entryId) await this._removeEntry(encId, entryId);
					return;
				}

				const removeEncounter = ev.target.closest(".stonetop-gm-encounter-remove");
				if (removeEncounter) {
					ev.preventDefault();
					if (!this._encounterEditing()) return;
					const id = this._encounterIdFrom(removeEncounter);
					if (id) await this._onEncounterRemove(id);
					return;
				}

				const open = ev.target.closest(".stonetop-gm-encounter-entry-open");
				if (open) {
					ev.preventDefault();
					await this._openEncounterEntry(open.dataset.uuid);
					return;
				}
			});

			root.addEventListener("keydown", async ev => {
				// alt+Arrow is the keyboard half of the reorder, so a list can still be arranged
				// without a mouse. It rides the same pure index primitives the drag does.
				if (ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
					const delta = ev.key === "ArrowUp" ? -1 : 1;
					const entry = ev.target.closest?.(".stonetop-gm-encounter-entry-open");
					if (entry) {
						ev.preventDefault();
						const encId = this._encounterIdFrom(entry);
						const entryId = this._entryIdFrom(entry);
						if (encId && entryId) await this._nudgeEntry(encId, entryId, delta);
						return;
					}
					const name = ev.target.closest?.(".stonetop-gm-encounter-name");
					if (name) {
						ev.preventDefault();
						const id = this._encounterIdFrom(name);
						if (id) await this._nudgeEncounter(id, delta);
					}
					return;
				}

				if (ev.key !== "Enter") return;
				// The name box lives inside the sheet's <form>, where an unhandled Enter is
				// IMPLICIT SUBMISSION: core would submit and re-render the whole sheet, which looks
				// exactly like the rename being swallowed. Blurring commits it through the `change`
				// below and needs no write of its own.
				if (ev.target.closest(".stonetop-gm-encounter-name, .stonetop-gm-encounter-entry-note")) {
					ev.preventDefault();
					ev.target.blur();
				}
			});

			// `change`, not `input`: it fires on blur (and on Enter) with the final value, so a
			// sentence is one document write rather than one per keystroke.
			root.addEventListener("change", async ev => {
				const name = ev.target.closest(".stonetop-gm-encounter-name");
				if (name) {
					const id = this._encounterIdFrom(name);
					if (!id) return;
					// An emptied box is refused and put back, rather than saved. A row with no name
					// is unreadable and cannot be told apart from a rendering fault; removing an
					// encounter is what the trash is for.
					if (!name.value.trim()) {
						name.value = this._encounter(id)?.name ?? "";
						return;
					}
					await this._setEncounterField(id, "name", name.value);
					return;
				}

				const note = ev.target.closest(".stonetop-gm-encounter-entry-note");
				if (note) {
					const encId = this._encounterIdFrom(note);
					const entryId = this._entryIdFrom(note);
					// Emptied on purpose is a real edit here, unlike the name: a note that no longer
					// applies is one a GM clears.
					if (encId && entryId) await this._setEntryNote(encId, entryId, note.value);
				}
			});

			this._wireGmEncounterDrag(root);
			wireDocumentDropZone(root.querySelector(".tab.encounters"), (data, target) => this._onEncounterDrop(data, target));
		}

		/** The encounter an element sits in. */
		_encounterIdFrom(el) {
			return el?.closest("[data-encounter-id]")?.dataset?.encounterId ?? null;
		}

		/** The collected row an element sits in. */
		_entryIdFrom(el) {
			return el?.closest("[data-entry-id]")?.dataset?.entryId ?? null;
		}

		/**
		 * Open what a collected row points at.
		 *
		 * A page opens its PARENT at that page, because a JournalEntryPage has no window of its
		 * own worth showing. A world Scene is VIEWED rather than configured, which is what a GM
		 * means by opening a battle map; a Scene in a pack cannot be viewed, so it falls back to
		 * its sheet like everything else.
		 */
		async _openEncounterEntry(uuid) {
			if (!uuid) return this._encounterWarn("entryGone");
			const doc = await fromUuid(uuid).catch(() => null);
			if (!doc) return this._encounterWarn("entryGone");
			// Per-type, off the ONE table that already says what this tab collects: a kind added
			// there becomes droppable, iconed, labelled AND openable in one edit rather than three.
			// A type with no `open`, and one whose `open` declines (a Scene inside a pack), both fall
			// through to the sheet, which is the right answer for everything else.
			return ENCOUNTER_DOC_TYPES[doc.documentName]?.open?.(doc) ?? doc.sheet?.render(true);
		}

		/** Add an encounter from the bar, with the caret already handed to its name box. */
		_onEncounterAdd() {
			return this._addEncounter(localize("stonetop.gmToolkit.encounters.newName"));
		}

		/**
		 * Delete an encounter, after asking.
		 *
		 * Asked because it is the only irreversible button on the tab, and it is NOT the one a GM
		 * reaches for after running something: that is "mark used", which takes the encounter off
		 * the live list, keeps everything gathered into it, and is one click both ways. So the
		 * frequent act stays one click and the final one asks.
		 */
		async _onEncounterRemove(id) {
			const encounter = this._encounter(id);
			if (!encounter) return;
			const ok = await Dialog.confirm({
				title:   localize("stonetop.gmToolkit.encounters.removeTitle"),
				content: `<p>${format("stonetop.gmToolkit.encounters.removeBody", {
					name:  escHtml(encounter.name || localize("stonetop.gmToolkit.encounters.removeUnnamed")),
					count: encounter.entries.length,
				})}</p>`,
				options: { classes: ["dialog", "stonetop", "stonetop-remove-encounter-dialog"] },
			});
			if (!ok) return;
			await this._removeEncounter(id);
		}

		/** One notification path, so every refusal is stated out loud and in the language file. */
		_encounterWarn(key, data) {
			const full = `stonetop.gmToolkit.encounters.${key}`;
			ui.notifications?.warn?.(data ? format(full, data) : localize(full));
		}

		/**
		 * Put the caret into a freshly rendered name box, one-shot.
		 *
		 * Found by SCANNING the name boxes and comparing each one's row, rather than by building
		 * an attribute selector: ids are random but a selector built from one still has to be
		 * escaped, and `CSS.escape` does not exist in the node test environment.
		 */
		_restoreGmEncounterFocus(root) {
			const want = this._encounterFocus;
			if (!want?.id) return;

			const selector = want.entryId
				? ".stonetop-gm-encounter-entry-open"
				: ".stonetop-gm-encounter-name";
			for (const field of root.querySelectorAll(selector)) {
				if (this._encounterIdFrom(field) !== want.id) continue;
				if (want.entryId && this._entryIdFrom(field) !== want.entryId) continue;
				// CLEARED HERE, on the paint that actually found the control, and not on the way in.
				// Writes are queued, so a render belonging to an EARLIER write can land between the
				// stash and the write that creates the row — "mark used" then "+ Add" is enough. A
				// stash blanked by that first paint left the new box with neither the caret nor the
				// selection, and the GM typed over whatever had focus before.
				this._encounterFocus = null;
				field.focus();
				// A new encounter opens named "New encounter" and the GM's next act is to type over
				// it, so the placeholder name is handed over selected rather than left for them to
				// clear. A reorder does not select: the GM is moving a row, not renaming it.
				if (want.select) field.select?.();
				return;
			}
		}

		/**
		 * Save what is being TYPED before the sheet is redrawn under it.
		 *
		 * The two text fields save on blur, and this sheet has a redraw that does not wait for one:
		 * `_wirePrepPageSync` re-renders it on every threat, hazard and site write anywhere in the
		 * world. A GM part-way through renaming an encounter when another client ticks a grim
		 * portent would otherwise watch the name revert, with nothing logged and nothing to undo.
		 *
		 * Reading the DOM here is correct, and is the one case where it is: unwritten keystrokes
		 * live ONLY in the box. The trap this pattern has (a pre-render flush reads the previous
		 * paint, so it can write stale state back over a fresh write) applies to fields a CLICK
		 * already committed to the document; neither of these has one, and `_setEncounterField`
		 * no-ops on an unchanged value, so a flush with nothing to say costs nothing.
		 *
		 * The notes box needs no flush: it lives in a dialog the sheet's redraw cannot reach.
		 */
		async _flushGmEncounterEdits() {
			return this._encounters.flushFocused(this.element?.[0], [
				{
					selector: ".stonetop-gm-encounter-name",
					// Same refusal the `change` handler makes: an emptied name is not saved as one.
					// Nothing is put back here, because the repaint about to happen restores the box.
					required: true,
					save: field => {
						const id = this._encounterIdFrom(field);
						return id ? this._setEncounterField(id, "name", field.value) : null;
					},
				},
				{
					selector: ".stonetop-gm-encounter-entry-note",
					save: field => {
						const encId = this._encounterIdFrom(field);
						const entryId = this._entryIdFrom(field);
						return encId && entryId ? this._setEntryNote(encId, entryId, field.value) : null;
					},
				},
			]);
		}
	};
}
