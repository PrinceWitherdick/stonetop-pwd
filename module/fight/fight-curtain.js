// The fight curtain: the "A fight breaks out" table moment, played on each client once per fight, when
// that fight first becomes visible to this reader. Local to each client, no socket: every client has
// the combat documents, and whether a player can see anyone (an ambush of hidden tokens is nobody)
// is answered per reader, by the Fight window's own picks (fight-window.js#fightThisReaderMeets).
// Guarded by tests/fight/fight-curtain.test.js.

import { isTableMomentsOn } from "../settings.js";
import { momentView } from "../moments/moment-view.js";
import { playMoment } from "../moments/moment-overlay.js";
import { readSharedRoute, sharedNextStop } from "../utils/shared-route.js";
import { format } from "../utils/i18n.js";
import { warn } from "../utils/logger.js";
import { fightThisReaderMeets } from "./fight-window.js";

/** The fights this client has already met, played or not. */
const announced = new Set();
/** False until ready: a fight already under way when this client loads never plays. */
let seeded = false;

/**
 * Whether the curtain plays now. PURE.
 *
 * @param {{announced: Set<string>, seeded: boolean}} state
 * @param {{fightId: string|null, canSee: boolean, enabled: boolean}} input
 * @returns {{play: boolean}}
 */
export function curtainStep({ announced: met, seeded: ready }, { fightId, canSee, enabled }) {
	return { play: !!(ready && enabled && fightId && canSee && !met.has(fightId)) };
}

/** Count every fight there is now as met. Once, at ready. */
export function seedFightCurtain() {
	for (const combat of globalThis.game?.combats ?? []) if (combat?.id) announced.add(combat.id);
	seeded = true;
}

/**
 * "On the road to the Crossroads", while the route the players were shown is part-travelled, else "".
 * Named from the share (shared-route.js#sharedNextStop), so a player never reads a name the GM kept back.
 */
export function fightRoadLine() {
	const place = sharedNextStop(readSharedRoute());
	return place ? format("stonetop.moments.fight.onTheRoad", { place }) : "";
}

/** Play the curtain if this reader has just met a fight. Called wherever the Fight window syncs. */
export function syncFightCurtain() {
	try {
		if (!globalThis.game?.ready) return false;
		const { fightId, canSee } = fightThisReaderMeets();
		const { play } = curtainStep({ announced, seeded }, { fightId, canSee, enabled: isTableMomentsOn() });
		// Met once seen, played or not, so switching Table moments on later never replays an old fight.
		if (fightId && canSee && seeded) announced.add(fightId);
		if (play) playMoment(momentView({ kind: "fight", sub: fightRoadLine() }));
		return play;
	} catch (err) {
		warn("the fight curtain failed", err);
		return false;
	}
}

/** Test seam: forget every fight met, as a reload does. */
export function _resetFightCurtain() {
	announced.clear();
	seeded = false;
}
