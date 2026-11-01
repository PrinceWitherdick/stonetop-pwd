// The prayer beads' pips, moved onto Bolster's track.
//
// A length of prayer beads holds Preparation "as per the Bolster move", so its card's pips now read and write
// the Bolster track (roll-boosts.js#PREPARATION_ARCANA). Before that they were the card's own count, stored
// with every other arcanum's under the inventory's `resources`, and a world that ticked them would show the
// beads empty after the update.
//
// Per character, StonetopCharacter#adoptPrayerBeadPips puts the old count on the Bolster track (keeping the
// larger of the two) and drops the old key, in one write.

/**
 * @param {object} [options]
 * @param {Iterable} [options.actors]
 * @returns {Promise<number>} how many characters were written to
 */
export async function adoptAllPrayerBeadPips({ actors = globalThis.game?.actors ?? [] } = {}) {
	let written = 0;
	for (const actor of actors) {
		if (actor?.type !== "character") continue;
		if (await actor.typedActor?.adoptPrayerBeadPips?.()) written += 1;
	}
	return written;
}
