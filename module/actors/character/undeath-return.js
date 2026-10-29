// ── Coming back from out of the action, after the move already gave the HP ─────────────────────
// Undying's second cost is "You're out of the action until the next sunset", and the move has
// already said what HP they have: half their max on a 10+ or 7-9, 1 HP on a 6-. "Back on your feet"
// ends that cost and nothing else (the user's ruling, 2026-10-27), so it leaves the HP where the move
// put it. The half-max return stays for the two outs that gave no HP: an insert taken at the Door
// (out of the action at 0 HP) and a Ghost's reform at their tether.
//
// Which of those a character is in is not readable off the state (it is `out-of-action` either way)
// nor off the HP (healed in between, or not), so the walkthrough says so: UndeathDialog stamps
// UNDEATH_KEPT_HP_FLAG in the same write that takes them out of the action, and the return lifts it.
import { STONETOP_SCOPE, resolvedFlagProperty } from "./StonetopFlags.js";
import { deletionEntry } from "../../utils/foundry-compat.js";
import { format } from "../../utils/i18n.js";
import { escHtml } from "../../utils/strings.js";
import { DEATHS_DOOR_STATE, halfMaxHp } from "./deaths-door.js";
import { deathsDoorRollMarker, rollMarkerDeletion } from "./deaths-door-actor.js";
import { postOutcomeCard } from "./post-death-outcomes.js";

/** The flag: out of the action on Undying's own cost, with the HP the move gave already theirs. */
export const UNDEATH_KEPT_HP_FLAG = "undeathKeptHp";

/**
 * Whether "Back on your feet" keeps the HP they have rather than bringing them to half their max.
 * Never for a move that disperses them (the Ghost's Tethered reforms them with half), which is also
 * what lets a stamp left behind by a Revenant who then became a Ghost go unread.
 */
export function keepsHpOnReturn(actor, resolution) {
	return !!actor && !!resolution && !resolution.disperses && !!resolvedFlagProperty(actor, UNDEATH_KEPT_HP_FLAG);
}

/** The HP the return leaves them at: what they have, or half their max (rounded up) if that is more. PURE. */
export function returnHp({ hpNow = 0, maxHp = 0, keepsHp = false } = {}) {
	const now = Math.max(0, Math.trunc(Number(hpNow) || 0));
	return keepsHp ? now : Math.max(now, halfMaxHp(maxHp));
}

/**
 * The stamp as an update fragment: set (`on`), or lifted when the actor carries it. Empty when there is
 * nothing to change, so a write that has no stamp to lift carries no key for it.
 */
export function keptHpUpdate(actor, on) {
	const path = `flags.${STONETOP_SCOPE}.${UNDEATH_KEPT_HP_FLAG}`;
	if (on) return { [path]: true };
	return actor && resolvedFlagProperty(actor, UNDEATH_KEPT_HP_FLAG) ? Object.fromEntries([deletionEntry(path)]) : {};
}

/** The nonce prefix an Undeath roll's marker carries (dialogs/UndeathDialog.js), so a Death's Door one is never taken for it. */
export const UNDEATH_ROLL_NONCE_PREFIX = "undeath:";

/** Whether a roll marker (deaths-door-actor.js#deathsDoorRollMarker) is an Undeath roll's rather than a Death's Door one's. */
export function isUndeathRollMarker(marker) {
	return !!marker && String(marker.nonce ?? "").startsWith(UNDEATH_ROLL_NONCE_PREFIX);
}

/**
 * What an insert taken or removed leaves behind of the old one's 0-HP move, as one update fragment: Undying's
 * kept-HP stamp and an Undeath roll still in progress (audit LC-2). A Death's Door roll's marker is not
 * touched. Empty when there is nothing to lift.
 */
export function undeathRecordsLifted(actor) {
	return {
		...keptHpUpdate(actor, false),
		...(isUndeathRollMarker(deathsDoorRollMarker(actor)) ? rollMarkerDeletion() : {}),
	};
}

/**
 * The Special Moves card's "Back on your feet" / "Reform at your tether" / "Clear": the end of a lingering
 * state. What it answers: "back" (returned, HP as above), "final" (a Ghost whose tether was destroyed while they
 * were dispersed), "cleared" (a state that was not a return: `dead` undone by mistake, or no insert), or null
 * (the question was put aside).
 *
 * The return is not a heal, so Torment's Blessing does not halve it (the user's ruling, 2026-09-30), and it is
 * the state's own write, with the HP. A dispersed Ghost is asked first whether their tether is still intact:
 * "If your tether has been destroyed, mark the Final Consequence" (Book I p.148), and it can be lost while they
 * are gone. `askTetherIntact(tether)` answers true, false, or null for not yet.
 *
 * @param {object} character  the character model
 * @param {{askTetherIntact?: (tether: string) => Promise<boolean|null>}} [o]
 */
export async function comeBack(character, { askTetherIntact = null } = {}) {
	const actor = character?._actor;
	const resolution = character?.zeroHpResolution ?? null;
	if (!resolution || character.deathsDoorState !== DEATHS_DOOR_STATE.OUT_OF_ACTION) {
		// Not a return, so a kept-HP stamp has nothing left to speak for: it goes in the same write (audit LC-2).
		const lift = keptHpUpdate(actor, false);
		if (Object.keys(lift).length) await actor.update({ ...character.deathsDoorStateUpdateData(null), ...lift });
		else await character.setDeathsDoorState(null);
		return "cleared";
	}
	if (resolution.disperses && askTetherIntact) {
		const intact = await askTetherIntact(String(character.tether ?? "").trim());
		if (intact === null || intact === undefined) return null;
		if (intact === false) {
			await character.applyUpdate({ ...character.finalConsequenceUpdateData(), ...keptHpUpdate(actor, false) }, resolution.move);
			await postOutcomeCard(character, resolution.move, [format("stonetop.specialMoves.deathsDoor.tetherLost",
				{ name: escHtml(actor?.name ?? "") })]);
			return "final";
		}
	}
	const hp = returnHp({
		hpNow: character.hp, maxHp: await character.computedMaxHp(), keepsHp: keepsHpOnReturn(actor, resolution),
	});
	await character.restoreHp(hp, resolution.move, { clearsDeathsDoor: true, unhalved: true, alsoUpdate: keptHpUpdate(actor, false) });
	return "back";
}
