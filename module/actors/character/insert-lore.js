// ── A post-death insert's lore, off the raw actor ──────────────────────────
// Which insert a character wears and whether one of its lore options (a Consequence, a Mark) is marked,
// read straight off the actor's flags with nothing behind it but the flag reader, so the roll engine,
// the camp and the update hooks can ask without importing the character model or Death's Door's rules.
// The camp reads raw actors on every client (camp/camp-store.js), and the update hooks run on every
// write. And the one spelling of a lore follower's `sourceUuid`, for the same reason.

import { resolvedFlagProperty } from "./StonetopFlags.js";

/** The slug of the insert a character wears ("ghost", "revenant", "thrall"), or undefined for none. */
export function wornInsertSlug(actor) {
	return resolvedFlagProperty(actor, "postDeathInsert.slug");
}

/**
 * Whether a character wearing insert `insert` has its lore option `key` ("marks:ravenous",
 * "consequences:bodysnatcher") marked. An option left on a sheet whose insert was taken away or
 * swapped (removal prunes nothing, so it can be undone) no longer counts.
 *
 * @param {Actor} actor
 * @param {string} key  the option's key in the insert's lore counts
 * @param {{insert: string}} opts  the insert the option belongs to
 */
export function holdsLoreOption(actor, key, { insert } = {}) {
	if (!actor || !key || !insert || wornInsertSlug(actor) !== insert) return false;
	return Number(resolvedFlagProperty(actor, "postDeathLore.counts")?.[key]) > 0;
}

/**
 * What the `sourceUuid` of every follower card a lore option makes starts with (post-death-moves.js
 * #LORE_FOLLOWERS): how a card already made is found again, and how follower-party.js knows them.
 */
export const LORE_FOLLOWER_SOURCE = "post-death:";

/** Whether a custom follower record was made by a lore option (a Revenant's vermin, a Thrall's tentacle). PURE. */
export function isLoreFollowerRecord(record) {
	return String(record?.sourceUuid ?? "").startsWith(LORE_FOLLOWER_SOURCE);
}
