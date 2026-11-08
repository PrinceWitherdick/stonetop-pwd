import { HARD_TO_KILL, NEVER_GONNA_KEEP_ME_DOWN, UNSTOPPABLE } from "./deaths-door.js";
import { format } from "../../utils/i18n.js";

// The moves that turn on Death's Door, which an insert takes away (each insert has its own 0-HP move):
// the note key each one gets for a character wearing one. Said, never hidden or blocked (Book I p.529:
// the player picks any move they qualify for; "consider ... whether it creates a weird rules
// interaction"). Never Gonna Keep Me Down's first half still works, so its note says which half.
// Shared by the Level Up window and the Moves tab's other-playbook picker.
const _INSERT_INERT = {
	[HARD_TO_KILL]:             "insertInert",
	[UNSTOPPABLE]:              "insertInert",
	[NEVER_GONNA_KEEP_ME_DOWN]: "insertInertHalf",
};

/** The note for move `name` when `zeroHpMoveName` (the insert's 0-HP move) is not Death's Door, else null. */
export function insertInertNote(name, zeroHpMoveName) {
	const key = _INSERT_INERT[name];
	return key && zeroHpMoveName ? format(`stonetop.specialMoves.levelUp.${key}`, { move: zeroHpMoveName }) : null;
}

/** The 0-HP move name of the insert `character` (a StonetopCharacter) wears, or null while Death's Door is theirs. */
export function insertZeroHpMoveName(character) {
	const move = character?.postDeathSlug ? character?.zeroHpMove : null;
	return move && !move.dialog ? move.name ?? null : null;
}
