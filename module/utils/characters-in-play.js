// The player characters still in play: utils/playbook-actors.js#getPlayerCharacters less the dead and those
// who left play (retired, gone, turned villain), as actors/character/deaths-door-actor.js#isOutOfPlay reads
// them. A module of its own so the player-character helpers stay free of the Death's Door rules.

import { getPlayerCharacters } from "./playbook-actors.js";
import { isOutOfPlay } from "../actors/character/deaths-door-actor.js";

/** Every player character still in play. */
export function charactersInPlay() {
	return getPlayerCharacters().filter(actor => !isOutOfPlay(actor));
}
