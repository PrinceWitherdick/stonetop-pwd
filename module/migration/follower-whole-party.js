// A custom follower's one "Party follower" switch is now two (wave 3 audit FOL-6, the user's ruling of
// 2026-10-09; actors/character/follower-party.js): `party`, travels with the party, and `wholeParty`,
// follows the party as a whole (Book I p.464: any PC may then pay its cost or spend its Loyalty).
//
// Before the split the card LABELLED the switch "any PC pays/spends its Loyalty" while Make Camp READ it
// as travel, so a follower switched on meant both, and keeps both: `wholeParty` is turned on beside it.
// ONCE PER WORLD, the creation-finished-grandfather.js pattern: after the split a fresh follower switched
// on for travel alone must not be swept into following the party as a whole by a later version's run.

import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { sweepVersion } from "./once-per-version.js";

export const FOLLOWER_WHOLE_PARTY_SWEEP = "followerWholePartySplit";

/** The update for one character: every custom follower with the old switch on and no new one set. PURE. */
export function wholePartySplitUpdate(customFollowers) {
	const update = {};
	for (const [id, record] of Object.entries(customFollowers ?? {})) {
		if (record?.party === true && typeof record.wholeParty !== "boolean") {
			update[`flags.${STONETOP_SCOPE}.customFollowers.${id}.wholeParty`] = true;
		}
	}
	return update;
}

/**
 * Split every character's switched-on custom followers (see above). Does nothing in a world that has
 * run it before, under any version.
 *
 * @param {object} [options]
 * @param {Iterable} [options.actors]
 * @returns {Promise<number>} how many characters were written to
 */
export async function splitFollowerWholeParty({ actors = globalThis.game?.actors ?? [] } = {}) {
	if (sweepVersion(FOLLOWER_WHOLE_PARTY_SWEEP)) return 0;
	let written = 0;
	for (const actor of Array.from(actors ?? [])) {
		if (actor?.type !== "character") continue;
		const update = wholePartySplitUpdate(actor.flags?.[STONETOP_SCOPE]?.customFollowers);
		if (!Object.keys(update).length) continue;
		// Quiet in the ledger: the switch was split, nobody changed a follower.
		await actor.update(update, { stonetopLedger: true });
		written += 1;
	}
	return written;
}
