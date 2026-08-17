/**
 * The Judge's brand — Condemn, the level 2-5 move that turns a Censure into something that
 * outlasts the scene: "they are marked with a mystical brand that cannot be removed or hidden
 * UNTIL YOU DISMISS IT."
 *
 * That last clause is the whole reason this module exists. Every other Judge move resolves and
 * is over; this one leaves state behind, the Judge is the only person who can end it, and
 * nothing on any sheet recorded it. A Judge four sessions in is carrying an unwritten list.
 *
 * A LIST, not a boolean — which is the one structural difference from the Lightbearer's holy
 * light (holy-light.js), whose "one slot, never a counter" note is worth reading beside this
 * one. Consecrated Flame replaces the flame before it, so one slot says everything. Condemn
 * names no cap at all, and Proclamation explicitly widens a single Censure to "a group or
 * faction ... regardless of distance", so the store has to hold many at once and each has to be
 * dismissible on its own.
 *
 * The list algebra itself lives in marked-people.js, shared with the Judge's other standing list
 * (oaths.js) and the Blessed's (blessed-marks.js) — all three are "people I have marked, until I
 * lift it", and this file is now only what is TRUE OF CONDEMN: which move earns the scales, when
 * they show, and how a branded person's own sheet asks whether it wears the tag.
 *
 * WHERE IT LIVES: on the JUDGE, as one flag array, and nowhere else. The obvious alternative —
 * stamping a flag on each branded actor, so their sheet can read its own state locally — cannot
 * work here: a player-owned Judge branding a GM-owned NPC has no write permission on that
 * document, so half the brands in a real game would silently fail to store. Reading is
 * unrestricted, so the target sheets ask the question the other way round (condemnersOf) and
 * everybody can render the tag regardless of who owns what.
 */

import { SYSTEM_ID } from "../../system-id.js";
import { ownsMoveNamed, ownsAnyMoveNamed } from "./owns-move.js";
import { createRoster, findNamedActor, actorMatchKeys, trailingActorId, showStandingList } from "./marked-people.js";

// Re-exported so this playbook's tests and dialog keep reaching the predicates through the feature
// module they already import, rather than each learning where the shared algebra now lives.
export { ownsMoveNamed, actorMatchKeys, trailingActorId };
export { findNamedActor as findBrandTarget };

export const CONDEMNED_FLAG = "condemned";
export const CONDEMN        = "Condemn";
export const CENSURE        = "Censure";
export const PROCLAMATION   = "Proclamation";

// No extra per-row fields: a brand is a name, an optional link, and why. There is deliberately no
// person/faction distinction stored — a Proclamation's target ("the Claws", "House Kadros") is a
// body of people rather than a person, but nothing downstream did anything different with that
// fact, and it cost the add form a tick box that had to be got right before typing a name. The
// name says which it is.
const roster = createRoster({ prefix: "condemned" });

/**
 * Whether this character can brand anyone. ONLY Condemn — deliberately narrower than the family
 * of moves involved.
 *
 * Censure alone marks nobody: it is a reaction move whose four options all resolve on the spot.
 * Proclamation widens Condemn's reach but creates no brand without it, and it requires Censure,
 * not Condemn — so a Judge can own Proclamation and still have nothing to list. Condemn is the
 * only move in the playbook that leaves a mark behind, so it is the only one that earns the icon.
 */
export function canCondemn(actor, owned = null) {
	return ownsAnyMoveNamed(actor, [CONDEMN], owned);
}

/**
 * Whether to render the scales at all.
 *
 * A non-empty list is always shown, even on a sheet that no longer owns Condemn — otherwise
 * dropping a new playbook over a Judge strands live brands with nothing left on the sheet that
 * could dismiss them. Exactly the reason showHolyLight keeps a lit candle on a sheet that can no
 * longer make one. The rule itself is shared with the other two standing lists; this is Condemn's
 * name for it.
 */
export const showCondemn = showStandingList;

/**
 * The whole gate on the header scales, which open one window carrying BOTH of the Judge's standing
 * lists — the brands here and the oaths in oaths.js.
 *
 * Either list is enough on its own: a Judge with Binding Arbitration and no Condemn has oaths to
 * keep and nowhere else to keep them, and a Judge who has dismissed every brand but still owns the
 * move keeps the scales so they can lay the next one. Each half asks showCondemn's own question,
 * so "shown while rows stand on a sheet that lost the move" holds for both.
 */
export function showJudgeMarks({ ownsCondemn, brandCount, ownsOaths, oathCount }) {
	return showCondemn({ owns: ownsCondemn, count: brandCount })
		|| showCondemn({ owns: ownsOaths, count: oathCount });
}

// ── The stored list ─────────────────────────────────────────────────────────────
// Thin, named re-exports of the shared roster. Named rather than passed around as an object so
// every call site still reads as Condemn's own vocabulary ("brand", "dismiss") and so the tests
// that already import these names go on doing so.

export const readEntry      = roster.readEntry;
export const readCondemned  = roster.readList;
export const condemnKey     = roster.keyOf;
export const addCondemned   = roster.add;
export const removeCondemned = roster.remove;
export const brandIndex     = roster.buildIndex;
export const isBrandedBy    = roster.isOnIndex;
export const isBranded      = roster.isOn;

/** Re-word why somebody is branded. Same `{ entries, changed }` no-op contract as the others. */
export function noteCondemned(list, id, note) {
	return roster.patch(list, id, { note });
}

/**
 * Who is holding a brand on this actor, out of the characters given. Returns the Judges, so a
 * tooltip can name them ("Condemned by Aldric") rather than asserting a bare state.
 */
export function condemnersOf(actor, judges, readFlag) {
	return roster.holdersOf(actor, judges, readFlag);
}

/**
 * What a BRANDED actor's own sheet needs in order to wear the tag: whether anyone has condemned
 * them, and who. Called from the NPC, monster and character sheets' getData.
 *
 * Asked of the world rather than of a flag on the actor itself, for the permission reason in this
 * file's header.
 *
 * PRE-FILTERED TO JUDGES WHO HAVE ACTUALLY BRANDED SOMEBODY, and bailing outright when there are
 * none, because of where this is called from: the getData of every character, NPC and monster
 * sheet, which re-runs on every HP tick, every note blur, every flag write, and on every open
 * sheet at once when onUpdateCondemned re-renders them. Left unfiltered, a world with no Judge in
 * it still paid a readCondemned — a rebuild-and-trim of every stored row — per character per
 * render. The filter is a bare property read, so the empty case is now a single pass and no
 * normalisation at all.
 *
 * A COMPENDIUM actor is never branded. Its `game.actors` counterpart (if any) is a different
 * document, and matching the two would put the tag on every unmodified copy of a bestiary entry
 * the moment one instance of it was condemned.
 *
 * `judges` / `readFlag` are injectable so the tests can drive this without a world.
 */
export function condemnedContext(actor, { judges, readFlag } = {}) {
	if (!actor || actor.pack) return { condemned: false, by: [], byLabel: "" };
	const pool = judges ?? [...(globalThis.game?.actors ?? [])]
		.filter(a => a?.type === "character" && a.flags?.[SYSTEM_ID]?.[CONDEMNED_FLAG]?.length);
	if (!pool.length) return { condemned: false, by: [], byLabel: "" };
	const read = readFlag ?? (judge => judge?.getFlag?.(SYSTEM_ID, CONDEMNED_FLAG));
	const by = condemnersOf(actor, pool, read).map(j => j?.name).filter(Boolean);
	// Joined HERE rather than in the template, so the tag's tooltip needs no `join` helper and the
	// two-Judges case (rare, but a party can hold two) says both names instead of the first.
	return { condemned: by.length > 0, by, byLabel: by.join(", ") };
}
