// A CHARACTER WHO HAS LEFT PLAY ALIVE.
//
// Book I p.584, "Retiring PCs": "A PC might exit play because: they die and pass through the Last Door;
// they retire after a lasting injury ...; Surplus runs short in winter (page 518), and the weariest PC's
// player has them die, leave, or retire; they cross the line from protagonist to villain (page 587);
// their player decides to have them leave Stonetop or retire from adventuring; their player leaves the
// game."
//
// Death already has its state (deaths-door.js, `dead`). This is the rest: the PC who retires, who leaves
// Stonetop, or who becomes a threat under the GM's control. One flag on the character, read here and
// nowhere else, so deaths-door-actor.js#isOutOfPlay (the question every party list asks) can count them
// out the same way it counts out the dead.
//
// Pure but for the flag read: no Foundry global is touched.

import { resolvedFlagProperty } from "../actors/character/StonetopFlags.js";

/** The character flag (STONETOP_SCOPE) holding `{ how, at, npcUuid?, threatUuid? }`. */
export const LEFT_PLAY_FLAG = "leftPlay";

/** How a living PC leaves play. */
export const LEFT_PLAY_HOW = Object.freeze({
	/** Retires from adventuring and stays in the village or the region (p.584, "Retirement"). */
	RETIRED: "retired",
	/** Leaves Stonetop: "On the road to Lygos, wandering among the Hillfolk ..." (p.584, "Epilogues"). */
	LEFT:    "left",
	/** Becomes a threat under the GM's control (p.584, "Becoming a threat"; p.587). */
	VILLAIN: "villain",
});

const _HOWS = new Set(Object.values(LEFT_PLAY_HOW));

/** The record of how this character left play, or null for one still in it. Never throws. */
export function leftPlayRecord(actor) {
	if (!actor) return null;
	let record;
	try { record = resolvedFlagProperty(actor, LEFT_PLAY_FLAG); } catch { return null; }
	return record && typeof record === "object" && _HOWS.has(record.how) ? record : null;
}

/** Whether this character has retired, left, or turned villain. */
export function hasLeftPlay(actor) {
	return !!leftPlayRecord(actor);
}
