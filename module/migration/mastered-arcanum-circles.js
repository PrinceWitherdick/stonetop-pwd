// The Seeker's mastered card, finished where the old grant left it short.
//
// masterArcanum used to count the unlock lead's ○ by RUN, so a card printing "○○○" was mastered
// with `unlock:0` ticked and nothing after it. The carried item read the same run count, so the
// card still carried its back. Counting now goes per glyph, as the sheet's checkboxes always
// did, and a card mastered the old way reads as locked: its front curio comes back, and a re-run
// of creation no longer knows the card as the one it gave.
//
// Per character, CharacterArcana#repairMasteredUnlock ticks the rest of the mastered card's
// circles. Only that one card: a part-marked track anywhere else is play.

import { sweepCharacters } from "./sweep-characters.js";

/**
 * @param {object} [options]
 * @param {Iterable} [options.actors]
 * @returns {Promise<number>} how many characters were written to
 */
export async function repairMasteredArcanumCircles({ actors } = {}) {
	return sweepCharacters(actor => actor.typedActor?.repairMasteredUnlock?.(), { actors });
}
