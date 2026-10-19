// The Blessed's Raised by Wolves background (Book I): "Once per session, when your wild ways
// offend or alienate you from someone, mark XP." Whether they did is the table's call, so it is a
// button the player presses (the user's ruling of 2026-10-18), on the Details tab under the
// background, and only for a Blessed who took it.
//
// Once per session, like Never Gonna Keep Me Down's circle (deaths-door-actor.js#resetNeverGonnaKeepMeDown):
// pressing it marks the actor's WILD_WAYS_FLAG, which keeps the button filled and disabled until End of
// Session clears it (resetWildWays). The XP goes through roll-engine.js#markXpReceipt, the receipt a miss
// and In Over Your Head post (with its Undo), so the level-up threshold works as for any other XP.

import { SYSTEM_ID } from "../../system-id.js";
import { actorTookBackground } from "./took-background.js";
import { BLESSED_PLAYBOOK } from "./stock-cost.js";
import { markXpReceipt } from "../../utils/roll-engine.js";

/** The background, as took-background.js asks it. */
export const RAISED_BY_WOLVES = { playbook: BLESSED_PLAYBOOK, slug: "raised-by-wolves", label: "Raised by Wolves" };

/** Actor flag: this session's XP for the wild ways is marked. Cleared at End of Session. */
export const WILD_WAYS_FLAG = "wildWaysXpMarked";

/** Whether this character took Raised by Wolves. */
export function isRaisedByWolves(actor) {
	return actorTookBackground(actor, RAISED_BY_WOLVES);
}

/** Whether this session's wild-ways XP is already marked. */
export function wildWaysMarked(actor) {
	return !!actor?.getFlag?.(SYSTEM_ID, WILD_WAYS_FLAG);
}

/**
 * The Details tab's button, for the sheet: null for anyone not Raised by Wolves, else `{marked}`,
 * the once-per-session circle's state.
 */
export function wildWaysState(actor) {
	if (!isRaisedByWolves(actor)) return null;
	return { marked: wildWaysMarked(actor) };
}

/**
 * Mark the wild ways' XP: the session's circle FIRST (so a second click, or a second client, finds it
 * marked), then the XP and its receipt. A failure before the XP lands gives the circle back. Whether XP
 * was marked: false for anyone not Raised by Wolves, or with the circle already marked this session.
 */
export async function markWildWaysXp(actor, { create = (...args) => globalThis.ChatMessage.create(...args) } = {}) {
	if (!isRaisedByWolves(actor) || wildWaysMarked(actor) || typeof actor?.update !== "function") return false;
	await actor.update({ [`flags.${SYSTEM_ID}.${WILD_WAYS_FLAG}`]: true });
	let receipt;
	try {
		receipt = await markXpReceipt(actor, {
			header:      RAISED_BY_WOLVES.label,
			move:        RAISED_BY_WOLVES.label,
			description: `${actor.name}'s wild ways gave offence: marks XP.`,
			amount:      1,
		});
	} catch (err) {
		await actor.update({ [`flags.${SYSTEM_ID}.${WILD_WAYS_FLAG}`]: false }).catch(() => {});
		throw err;
	}
	await create({
		content: receipt.content,
		speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
		flags:   { [SYSTEM_ID]: receipt.flags },
	});
	return true;
}

/**
 * End of Session: a new session gives the wild ways' XP back. Clears the circle on every character it
 * walks that has it marked; how many were cleared. A character with it clear costs no write.
 *
 * @param {Iterable<Actor>} actors
 */
export async function resetWildWays(actors = []) {
	let cleared = 0;
	for (const actor of actors ?? []) {
		if (!wildWaysMarked(actor) || typeof actor?.update !== "function") continue;
		await actor.update({ [`flags.${SYSTEM_ID}.${WILD_WAYS_FLAG}`]: false }, { stonetopMove: "End of Session" });
		cleared += 1;
	}
	return cleared;
}
