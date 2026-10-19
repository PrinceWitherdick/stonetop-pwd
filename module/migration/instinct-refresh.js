// Bring a character's chosen instinct up to the playbook's wording.
//
// The instinct is stored as the whole "Word + separator + description" string the player picked
// (utils/strings.js#composeInstinct), not as a slug, so a playbook whose instinct text is corrected
// leaves every character who took it holding a value the playbook no longer offers: the Details tab
// shows no instinct ticked and the post-death prune would drop it. Each corrected text is listed here,
// old to new, by playbook word:
//   • the Blessed's Delight and Reverence, as Book I prints them (2026-10-18).
//
// THE SAME RULE AS THE HELD MOVES (move-refresh.js): a stored value is rewritten only while it is
// exactly what an older release offered, so an instinct the player wrote themselves stays. Per
// version, from Ready.

import { StonetopFlags } from "../actors/character/StonetopFlags.js";
import { composeInstinct } from "../utils/strings.js";
import { SweepFailures } from "./sweep-failures.js";

/** Every instinct text an older release offered and no longer does: [word, old description, new description]. */
export const INSTINCT_SUPERSEDED = [
	["Delight",   "To find beauty, in even the ugliest things.",   "To find beauty, in even the most ugly thing."],
	["Reverence", "To honor the spirits and give them their due.", "To demand sacrifice to the spirits and Danu."],
];

const REPLACEMENTS = new Map(INSTINCT_SUPERSEDED.map(([word, was, now]) => [composeInstinct(word, was), composeInstinct(word, now)]));

/** The value a stored instinct should become, or null to leave it. PURE. */
export function instinctRefresh(selected) {
	return REPLACEMENTS.get(String(selected ?? "")) ?? null;
}

/**
 * Rewrite every character's superseded instinct. Per version, from Ready.
 *
 * @param {object} [options]
 * @param {Iterable} [options.actors]
 * @returns {Promise<number>} how many characters were written to
 */
export async function refreshInstincts({ actors = globalThis.game?.actors ?? [] } = {}) {
	let written = 0;
	const failures = new SweepFailures("refreshing instincts");
	for (const actor of actors) {
		if (actor?.type !== "character") continue;
		const flags = new StonetopFlags(actor, "instinct");
		const now = instinctRefresh(flags.getFlag("selected"));
		if (!now) continue;
		await failures.attempt(actor.name, async () => {
			// Quiet in the ledger: the playbook's wording corrected, not a new pick.
			await actor.update(flags.updateData("selected", now), { stonetopLedger: true });
			written += 1;
		});
	}
	failures.throwIfAny();
	return written;
}
