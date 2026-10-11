// Give the large and huge monsters already in a world a token their size.
//
// Until now every stat block's prototype token was 1x1, whatever its size tag said, so a horse-sized
// aurochs and an elephant-sized mammoth dropped onto a scene as one square apiece. The bestiary pack
// and the worksheet (data/monster-builder.js#monsterTokenSize) now give large 2x2 and huge 3x3. This
// brings the monster actors a world already holds (seeded from the pack, imported, or made with the
// worksheet before) up to the same rule.
//
// ONLY WHILE THE TOKEN IS STILL 1x1: a footprint anybody set by hand is theirs, and is left. And only
// the PROTOTYPE: tokens already standing on a scene keep the size they were placed at, so nothing
// moves under a GM's feet mid-campaign; the next one dropped is the right size.
//
// ONCE PER WORLD, the follower-whole-party.js pattern: after the first sweep a 1x1 large monster is a
// GM's choice (a small-grid map), not a leftover, and a later version's run must not grow it again.
// Everything made since is sized at creation by the pack and the worksheet.

import { monsterTokenSize } from "../data/monster-builder.js";
import { SweepFailures } from "./sweep-failures.js";
import { sweepVersion } from "./once-per-version.js";

export const MONSTER_TOKEN_SIZE_SWEEP = "monsterTokenSize";

/**
 * The prototype-token update one monster needs, as `{ path: value }`, or null. PURE.
 *
 * @param {object} actor  a world actor (or its plain data)
 */
export function monsterTokenSizeUpdate(actor) {
	if (actor?.type !== "monster") return null;
	const want = monsterTokenSize(actor.system?.size);
	if (want <= 1) return null;
	const token = actor.prototypeToken ?? {};
	const width = Number(token.width ?? 1);
	const height = Number(token.height ?? 1);
	if (width !== 1 || height !== 1) return null;
	return { "prototypeToken.width": want, "prototypeToken.height": want };
}

/**
 * Resize every world monster whose prototype token is still the 1x1 its size outgrew. From Ready,
 * and does nothing in a world that has run it before, under any version. Throws when any write
 * failed, so the gate (stamping only on success) retries on the next load.
 *
 * @param {object} [options]
 * @param {Iterable} [options.actors]
 * @returns {Promise<number>} how many monsters were written to
 */
export async function sizeMonsterTokens({ actors = globalThis.game?.actors ?? [] } = {}) {
	if (sweepVersion(MONSTER_TOKEN_SIZE_SWEEP)) return 0;
	let written = 0;
	const failures = new SweepFailures("sizing monster tokens");
	for (const actor of actors) {
		const update = monsterTokenSizeUpdate(actor);
		if (!update) continue;
		await failures.attempt(actor.name, async () => {
			await actor.update(update);
			written += 1;
		});
	}
	failures.throwIfAny();
	return written;
}
