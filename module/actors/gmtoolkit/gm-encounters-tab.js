// The GM Toolkit's Encounters tab — what has been gathered for one session or one scene, in
// named bundles: the monsters, the read-aloud page, the battle map, the treasure table, the
// arcanum somebody is about to find.
//
// EVERYTHING THAT MAKES THIS TAB WORK IS IN gm-bundle-tab.js, and its header is the one worth
// reading: the two lists out of one array, the pointer-never-a-copy rule, the two kinds of write,
// the serialized queue, and why there is nothing to unwire. This file is the CONFIG that says
// which tab it is, plus the mixin that hands the sheet the names it has always called.
//
// WHY A CONFIG AND NOT A CLASS OF ITS OWN. The Expeditions tab (gm-expeditions-tab.js) wanted the
// same card — drop documents on it, note what each is for, tick it when it has been run — and a
// second copy of nine hundred lines is a second place to fix a stale read in. What differs
// between the two tabs is a handful of strings and one extra button, and that is exactly what is
// written down below.
//
// STORAGE IS THE TOOLKIT'S OWN, like the "I wonder..." list beside it and unlike the Threats and
// Sites tabs, whose JournalEntryPages stayed on the steading (gm-prep-tabs.js says so at length).
// It is a flat array on `actor.system.encounters`. On the toolkit rather than on the User for the
// same reason the toolkit is a singleton: a world has one set of prepared encounters whoever is
// running it, and a second GM opening their own toolkit should see the same list.
//
// THE MIXIN IS A ROW OF FORWARDERS, and that is deliberate rather than incidental. The engine is
// an object the sheet holds (it has to be — a mixin can only be applied to a class once, and this
// sheet now has two of these tabs), but the sheet, the templates and this tab's tests have always
// addressed it by these names. Keeping them is what let the extraction happen without touching a
// line of the behaviour they were written against.
import { GmBundleTab, STONETOP_ENCOUNTER_DRAG_TYPE } from "./gm-bundle-tab.js";

// Re-exported, every one of them, because this module's path is the one the rest of the system and
// the whole of this tab's test suite import from. The definitions moved; the address did not.
export {
	BUNDLE_DOC_TYPES as ENCOUNTER_DOC_TYPES,
	BUNDLE_TALLY_KINDS as ENCOUNTER_TALLY_KINDS,
	bumpBundleNotesGeneration as bumpEncounterNotesGeneration,
	groupBundleEntries as groupEncounterEntries,
	insertionIndexIn,
	moveWithin,
	normalizeBundle as normalizeEncounter,
	normalizeEntry,
	nudgeWithinGroup,
	resolveBundleEntry as resolveEncounterEntry,
	STONETOP_ENCOUNTER_DRAG_TYPE,
} from "./gm-bundle-tab.js";

/**
 * Which tab this is, in the terms gm-bundle-tab.js reads.
 *
 * `section` is the JOIN the pencil stands on: the template reads `stonetop.edit.encounters` and
 * the sheet's `isSectionEditable` is keyed by the same string, so a typo in either half gives a
 * section that can never be unlocked, with nothing logged.
 *
 * `panel` is the scope of every listener this tab binds, which is what keeps a click on an
 * expedition card out of this engine's handlers — both tabs print the same class names on purpose.
 *
 * No `actions`: the Encounters card carries only the controls every bundle card has.
 */
export const ENCOUNTERS_TAB = Object.freeze({
	path:       "system.encounters",
	section:    "encounters",
	contextKey: "encounters",
	panel:      ".tab.encounters",
	i18n:       "stonetop.gmToolkit.encounters",
	dragType:   STONETOP_ENCOUNTER_DRAG_TYPE,
});

export function withGmEncountersTab(Base) {
	return class GmEncountersTab extends Base {
		/**
		 * This tab, and every scrap of its state.
		 *
		 * The name is checked against AppV1's own members, as every field on this sheet has to be:
		 * a collision there is silent. `_encounters` collides with nothing in Application,
		 * FormApplication or ActorSheet.
		 */
		_encounters = new GmBundleTab(this, ENCOUNTERS_TAB);

		/* ── the sheet's three entry points ──────────────────────────────────────── */

		/** Publish the tab's context. Call from the host's getData. ASYNC — see `resolveBundleEntry`. */
		_addGmEncountersContext(context) { return this._encounters.addContext(context); }

		/** The tab's interactions, delegated on the sheet root. Call from activateListeners. */
		_activateGmEncountersListeners(root) { return this._encounters.activateListeners(root); }

		/** Save what is being TYPED before the sheet is redrawn under it. Call from _render and close. */
		_flushGmEncounterEdits() { return this._encounters.flushEdits(); }

		/* ── the rest, by the names this tab has always been driven by ───────────── */
		//
		// Straight forwarders, no logic. Every one is documented where it lives, on GmBundleTab.

		_encounterList()                        { return this._encounters.list(); }
		_mutateEncounters(transform, options)   { return this._encounters.mutate(transform, options); }
		_addEncounter(name, options)            { return this._encounters.add(name, options); }
		_setEncounterField(id, key, v, options) { return this._encounters.setField(id, key, v, options); }
		_setEncounterUsed(id, used)             { return this._encounters.setUsed(id, used); }
		_reorderEncounter(dragId, overId)       { return this._encounters.reorder(dragId, overId); }
		_nudgeEncounter(id, delta)              { return this._encounters.nudge(id, delta); }
		_moveEntry(fromId, entryId, toId, before = null) { return this._encounters.moveEntry(fromId, entryId, toId, before); }
		_nudgeEntry(encId, entryId, delta, groupIds = null) { return this._encounters.nudgeEntry(encId, entryId, delta, groupIds); }
		_setEntryNote(encId, entryId, note)     { return this._encounters.setEntryNote(encId, entryId, note); }
		_removeEntry(encId, entryId)            { return this._encounters.removeEntry(encId, entryId); }
		_onEncounterDrop(data, target)          { return this._encounters.onDrop(data, target); }
		_sameEntryKind(data, target)            { return this._encounters.sameEntryKind(data, target); }
		_deployEncounter(id)                    { return this._encounters.deploy(id); }
		_onEncounterRemove(id)                  { return this._encounters.onRemove(id); }
		_restoreGmEncounterFocus(root)          { return this._encounters.restoreFocus(root); }

		/* ── state the sheet and its tests reach for by name ─────────────────────── */

		/** Which encounters are expanded. THE ENGINE'S OWN Set, not a copy: callers mutate it. */
		get _encounterOpen() { return this._encounters.openIds; }

		/** Which control claims the caret after the next paint. Written as well as read. */
		get _encounterFocus() { return this._encounters.focusWant; }
		set _encounterFocus(want) { this._encounters.focusWant = want; }
	};
}
