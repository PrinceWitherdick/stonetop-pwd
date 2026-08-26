// The GM Toolkit's Expeditions tab — a trip prepped before the night it is run, in named cards:
// the regional map, the sites along the way, whatever waits at the end, and the page to read aloud
// when they get there.
//
// THE SAME CARD THE ENCOUNTERS TAB HOLDS, and deliberately so. Book I's "what to prep" for an
// expedition (p.340, quoted in full on the walkthrough's opening step) is a list of DOCUMENTS to
// have ready — draw the map, identify the points of interest, write up the followers, prepare the
// encounters — which is exactly what a bundle card is for. Everything that makes it work lives in
// gm-bundle-tab.js; this file is the config that says which tab it is, plus the one control the
// Encounters card has not.
//
// TWO STORES, ONE JOIN. What is gathered here is PREP and lives on the toolkit actor
// (`system.expeditions`). What the "Run an Expedition" walkthrough records — the route they took,
// the requirements they were told, what they carried, what they found — is a different thing and
// stays where it was, in the world-scoped `expeditionAnswers` setting keyed by trip
// (utils/expedition-log-core.js). The card holds a `tripId` into that log, written the first time
// Run is pressed, so pressing it again reaches the trip already half-filled in rather than
// starting the night over. Neither store has to know how the other is shaped.
//
// A STALE `tripId` IS NOT AN ERROR. A GM who deletes a trip from the walkthrough's own log leaves
// a card pointing at nothing; the next Run mints a fresh trip and writes the new id back. That is
// why nothing here watches the log for deletions, and why there is no reconciliation pass: the
// pointer is repaired by being used.
import { GmBundleTab, STONETOP_EXPEDITION_DRAG_TYPE, normalizeBundle } from "./gm-bundle-tab.js";
import { ExpeditionDialog } from "../../dialogs/ExpeditionDialog.js";

/**
 * One prepped expedition, in the shape the schema and the sheet agree on.
 *
 * `normalizeBundle` and then the one field it does not know about. Written this way round rather
 * than as a second copy of the shared shape, so a field added to the card reaches both tabs.
 *
 * NORMALIZING IS NOT OPTIONAL HERE. Foundry diffs an ArrayField by REPLACEMENT, so every write is
 * the whole list — a normalizer that dropped `tripId` would unbind every OTHER card on the tab the
 * moment any one of them was renamed.
 */
export function normalizeExpedition(row = {}) {
	return {
		...normalizeBundle(row),
		tripId: typeof row?.tripId === "string" ? row.tripId : "",
	};
}

/**
 * Open the walkthrough on this card's trip, and remember which trip that was.
 *
 * THE WRITE IS UNCONDITIONAL-LOOKING BUT IS NOT: `setField` no-ops on an unchanged value, so the
 * common case — pressing Run a second time on a card already bound to a live trip — sends nothing
 * and re-renders nothing. The id only actually changes on the first press, and again after a GM
 * has deleted the trip out of the walkthrough's own log.
 *
 * NAMED AFTER THE CARD. A trip minted here takes the card's name, so the walkthrough's log bar,
 * the banner over every step and the label copied onto whatever the trip takes out of the
 * steading's stores all say what the GM called it here rather than "Expedition 3".
 *
 * RENDERS, because the write is a `setField` with the tab's default: the button's own state does
 * not change, but a card bound for the first time has become a card that reopens rather than one
 * that starts something, and nothing else would repaint to say so.
 */
async function runExpedition(tab, id) {
	const card = tab.card(id);
	if (!card) return;
	const tripId = await ExpeditionDialog.openOnTrip({ tripId: card.tripId, title: card.name });
	if (tripId) await tab.setField(id, "tripId", tripId, { render: true });
}

/**
 * Which tab this is, in the terms gm-bundle-tab.js reads.
 *
 * `section` is the JOIN the pencil stands on: the template reads `stonetop.edit.expeditions` and
 * the sheet's `isSectionEditable` is keyed by the same string, so a typo in either half gives a
 * section that can never be unlocked, with nothing logged.
 *
 * `panel` is the scope of every listener this tab binds. It is what keeps a click on an ENCOUNTER
 * card out of this engine's handlers: both tabs print the same card markup with the same class
 * names on purpose, so that one stylesheet and one partial serve both.
 *
 * `dragType` is its own, so a card cannot be dragged from one tab into the other's list — the two
 * are different arrays, and such a drop would name an id the receiving list has never heard of.
 */
export const EXPEDITIONS_TAB = Object.freeze({
	path:       "system.expeditions",
	section:    "expeditions",
	contextKey: "expeditions",
	panel:      ".tab.expeditions",
	i18n:       "stonetop.gmToolkit.expeditions",
	dragType:   STONETOP_EXPEDITION_DRAG_TYPE,
	normalize:  normalizeExpedition,
	actions:    Object.freeze([
		Object.freeze({ selector: ".stonetop-gm-expedition-run", run: runExpedition }),
	]),
});

export function withGmExpeditionsTab(Base) {
	return class GmExpeditionsTab extends Base {
		/**
		 * This tab, and every scrap of its state.
		 *
		 * The name is checked against AppV1's own members, as every field on this sheet has to be:
		 * a collision there is silent. `_expeditions` collides with nothing in Application,
		 * FormApplication or ActorSheet — nor with `_encounters`, the other one of these the sheet
		 * holds.
		 */
		_expeditions = new GmBundleTab(this, EXPEDITIONS_TAB);

		/** Publish the tab's context. Call from the host's getData. ASYNC — see `resolveBundleEntry`. */
		_addGmExpeditionsContext(context) { return this._expeditions.addContext(context); }

		/** The tab's interactions, delegated on the sheet root. Call from activateListeners. */
		_activateGmExpeditionsListeners(root) { return this._expeditions.activateListeners(root); }

		/** Save what is being TYPED before the sheet is redrawn under it. Call from _render and close. */
		_flushGmExpeditionEdits() { return this._expeditions.flushEdits(); }
	};
}
