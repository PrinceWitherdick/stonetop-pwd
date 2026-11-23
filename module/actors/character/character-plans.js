// A character's own Plans (Make a Plan, Book I p.530: "Give the list to the player who's making the plan,
// or put it somewhere public for everyone to see"). Kept in the character's `plans` flag and drawn on the
// Notes tab by Stonetop's own Plans partial and code (actors/steading/steading-plans.js,
// SteadingPlanDialog.js), through the store below. Guarded by tests/actors/character/character-plans.test.js.

import { STONETOP_SCOPE } from "./StonetopFlags.js";
import { inTurn } from "../../utils/turn-queue.js";

/**
 * The character as Stonetop's Plans code addresses a steading (settlement-plans.js is the same idea). The
 * list is read inside the turn, so a second tick pressed before the first write lands starts from the
 * first's rows, and `edit` gets a deep copy, so the stored rows are never changed before the write.
 */
export function characterPlanStore(actor) {
	return {
		/** Whose plans these are, for the editor's window id (SteadingPlanDialog.js). */
		actorId: actor.id,
		get _flags() { return { plans: actor.getFlag(STONETOP_SCOPE, "plans") ?? [] }; },
		editList: (list, edit) => inTurn(`character-plans:${actor.uuid ?? actor.id}`, async () => {
			const rows = foundry.utils.deepClone(actor.getFlag(STONETOP_SCOPE, list) ?? []);
			if (edit(rows) === false) return false;
			await actor.update({ [`flags.${STONETOP_SCOPE}.${list}`]: rows });
			return true;
		}),
	};
}
