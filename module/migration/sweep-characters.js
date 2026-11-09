// The loop every per-character repair sweep shares (tulpa-move-boxes.js, arcana-audit-1104.js...):
// each character in turn, counting the ones the repair wrote to.

/**
 * @param {(actor: object) => Promise<boolean>} settle  repairs one character; whether it wrote
 * @param {object} [options]
 * @param {Iterable} [options.actors]
 * @param {boolean} [options.own]  only the characters this user can write (a player's own client)
 * @returns {Promise<number>} how many characters were written to
 */
export async function sweepCharacters(settle, { actors = globalThis.game?.actors ?? [], own = false } = {}) {
	let written = 0;
	for (const actor of actors) {
		if (actor?.type !== "character" || (own && !actor.isOwner)) continue;
		if (await settle(actor)) written += 1;
	}
	return written;
}
