/**
 * Keep the "Condemned" tag honest on the sheets of the people wearing it.
 *
 * The brand is stored on the JUDGE (see condemn.js for why it cannot live on the branded actor),
 * and a branded actor's sheet derives its tag by asking the world. That derivation is the problem
 * this file exists to solve: Foundry re-renders the sheets of the document that CHANGED, and the
 * document that changed is the Judge. Nothing tells Brennan's open NPC sheet that somebody, three
 * windows away, just condemned him — so without this the tag appears on the next reload, which at
 * a live table means it appears never.
 *
 * The same two-entry-point shape as ActorDirectoryNames.js and for the same reason: derived
 * presentation that core has no way to know about has to be repainted by hand.
 *
 * Only the AFFECTED sheets are re-rendered, resolved from the difference between the Judge's old
 * and new lists, rather than every open sheet on the flag touching. A Judge dismissing one brand
 * should not redraw the whole table's worth of windows.
 */

import { SYSTEM_ID } from "../system-id.js";
import { CONDEMNED_FLAG, readCondemned, actorMatchKeys, trailingActorId } from "../actors/character/condemn.js";
import { openApplications } from "../utils/open-windows.js";

/**
 * The id set this client last saw on each Judge's list, keyed by Judge id.
 *
 * Kept per client rather than read back off the update, because what we need is the difference
 * between what is ON SCREEN and what is now true — and a Map we maintain here answers that on
 * every client without depending on the pre-update value reaching this hook or surviving the
 * socket. Entries for deleted Judges are a handful of strings and are left to the page lifetime.
 */
const seenByJudge = new Map();

/**
 * The document ids in one Judge's stored list, folded exactly as condemnersOf folds them.
 *
 * FOLDED, never raw. A brand laid from the sidebar stores `Actor.abc`, while the same person's
 * unlinked token sheet is the document `Scene.s.Token.t.Actor.abc` — so comparing stored strings
 * against `target.uuid` decided "not affected" for precisely the sheet that condemnedContext was
 * about to put the tag on. The tag then waited for a reload, which at a live table is never, which
 * is the whole failure this file exists to prevent.
 */
function listedIds(actor) {
	return new Set(readCondemned(actor.getFlag(SYSTEM_ID, CONDEMNED_FLAG))
		.map(e => trailingActorId(e.uuid)).filter(Boolean));
}

/** The ids that changed side — the only sheets whose tag can differ from what they are showing. */
function changedSides(before, after) {
	const out = new Set();
	for (const id of before) if (!after.has(id)) out.add(id);
	for (const id of after) if (!before.has(id)) out.add(id);
	return out;
}

/** Does this sheet's document answer to any of these ids? The same key set condemnersOf matches on. */
function answersTo(target, ids) {
	for (const key of actorMatchKeys(target)) if (ids.has(key)) return true;
	return false;
}

/**
 * @param {Actor}  actor    the Judge whose list changed
 * @param {object} changed  the update that was applied
 */
export function onUpdateCondemned(actor, changed) {
	if (actor?.type !== "character") return;
	// ⚠ BRACKETS off SYSTEM_ID, never a dotted path: the package id is hyphenated, so a dotted
	// `changed.flags.stonetop-pwd` parses as a subtraction and throws at runtime. Same trap
	// ActorDirectoryNames.js documents.
	const bag = changed?.flags?.[SYSTEM_ID];
	if (!bag) return;
	// Both shapes: a normal write, and the unset that a future "clear them all" would produce.
	if (!(CONDEMNED_FLAG in bag) && !(`-=${CONDEMNED_FLAG}` in bag)) return;

	// `actor` already carries the applied update, so this is the list AFTER the change.
	const listed = listedIds(actor);
	const before = seenByJudge.get(actor.id);
	seenByJudge.set(actor.id, listed);

	// A brand laid or lifted moves exactly one uuid across the line, and only that person's sheet
	// can be showing the wrong thing. Everything else on this flag — a note typed, a note cleared,
	// a reorder — changes what the JUDGE's roster window draws and nothing a target sheet does:
	// the tag renders `by` / `byLabel`, the Judges' NAMES, and nothing else (condemned-tag.hbs).
	// So an unchanged uuid set means there is nothing to repaint, and note edits (which fire on
	// every blur in the roster) stop costing a full getData + render on every open actor sheet.
	const affected = before ? changedSides(before, listed) : null;
	if (affected && !affected.size) return;

	for (const app of renderedActorSheets()) {
		const target = app.document;
		if (!target || target === actor) continue;
		// First change seen for this Judge this session — with nothing to diff against, fall back
		// to the conservative sweep: the currently-listed targets, plus any sheet already showing
		// a tag that may now be stale. Costs one DOM probe per open sheet, once per Judge.
		const repaint = affected ? answersTo(target, affected) : (answersTo(target, listed) || showsCondemnedTag(app));
		if (repaint) app.render(false);
	}
}

/** Is this rendered sheet currently painting a Condemned tag? */
function showsCondemnedTag(app) {
	const root = app.element?.jquery ? app.element[0] : app.element;
	return !!root?.querySelector?.(".stonetop-condemned-tag");
}

/**
 * Every rendered Actor sheet, from both application registries (see `openApplications`: AppV1
 * sheets live in `ui.windows` and AppV2 ones in `foundry.applications.instances`, and this system
 * still has sheets of both kinds).
 *
 * Filtered on `document`, NOT on `actor`. An ItemSheet for an owned item also answers `.actor` —
 * with the item's PARENT — so an `.actor` test would sweep in every open move and inventory card
 * belonging to a branded person and re-render them all for a tag they do not draw. `document` is
 * the sheet's own subject, so it is the Item there and the Actor only on an actual actor sheet.
 */
function renderedActorSheets() {
	return openApplications().filter(app => app?.document?.documentName === "Actor" && app.rendered);
}
