// Bring the gear a special possession granted up to the grant as the playbook authors it now.
//
// A possession's `grantsItems` are materialized into real inventory items once, when it is chosen,
// and nothing revisits them afterwards. So a grant corrected in a later release stays wrong on
// every character who took it before: the Tannery's boiled leather cuirass was made as a
// `{modifier: 1}` from 1.3.2 to 1.6.0, which stacks on top of a hauberk (3 armor with a base-2
// hauberk) and reads as armored by modifier alone, long after the grant was fixed to `{base: 1}`.
//
// The rule, and everything it leaves alone (marks, track counts, hand-written gear), is
// StonetopCharacter#repairPossessionGrants. This is only the sweep that reaches every character in
// the world, run once per system version from Ready: a grant can only change with a release, so a
// world swept under this version has nothing left for it to find until the next one.

/**
 * @param {object} [options]
 * @param {Iterable} [options.actors]
 * @returns {Promise<number>} how many characters had gear rewritten
 */
export async function repairAllPossessionGrants({ actors = globalThis.game?.actors ?? [] } = {}) {
	let written = 0;
	for (const actor of actors) {
		if (actor?.type !== "character") continue;
		if (await actor.typedActor?.repairPossessionGrants?.()) written += 1;
	}
	return written;
}
