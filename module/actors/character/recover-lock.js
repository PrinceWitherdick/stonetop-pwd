// RECOVER'S LOCK: "You can't gain this benefit again until you take more damage" (Book I p.78), and p.246:
// "no, a PC can't just 'nick their arm for 1 HP damage' in order to Recover again. It doesn't work like that."
//
// The character's own lock is `flags.<system>.recover.spent`, set by the Recover write and lifted here, on the
// write that LOWERS their HP by damage. Not by HP LOST (StonetopFlags.js#HP_LOSS_OPTION: a Vessel's 2d4 for
// Stock, Lend Strength), and not by a fall in max HP clamping the box (HP_CEILING_OPTION): neither is damage
// taken (audit ROAD-5). A follower body's lock is lifted the same way, when its HP box drops
// (follower-rest.js#recoverUnlockChanges, audit ROAD-4).

import { HP_CEILING_OPTION, HP_LOSS_OPTION } from "./StonetopFlags.js";
import { recoverUnlockChanges } from "./follower-rest.js";
import { SYSTEM_ID } from "../../system-id.js";

/** The preUpdateActor half of Recover's lock: mutates `changes`. Never throws (a throw aborts the update). */
export function onPreUpdateActorRecoverLock(actor, changes, options = {}) {
	if (actor?.type !== "character") return;
	try {
		// HP lost or clamped by a falling max is no damage, for the character or a follower on them.
		if (options?.[HP_LOSS_OPTION] || options?.[HP_CEILING_OPTION]) return;
		// A follower's box drops whatever else wrote it: their damage is the box (or their NPC, mirrored onto it).
		recoverUnlockChanges(actor, changes);
		const newHp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
		if (newHp === undefined) return;
		const oldHp = actor.system?.attributes?.hp?.value ?? 0;
		if (Number(newHp) < Number(oldHp) && actor.getFlag?.(SYSTEM_ID, "recover.spent")) {
			foundry.utils.setProperty(changes, `flags.${SYSTEM_ID}.recover.spent`, false);
		}
	} catch (err) {
		console.error("Stonetop | Error updating Recover's lock:", err);
	}
}
