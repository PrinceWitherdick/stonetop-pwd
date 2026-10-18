// Who holds Stentorian's Command (Book I p.127), apart from the fight code that spends it (battle-holds.js,
// fight/hero-moves.js): the steading's Deploy window asks who could shout an order, and loading the whole
// fight to ask that would make it a dependency of the steading sheet.

import { learnedTrack } from "../actors/character/MoveResources.js";
import { HERO_MOVES } from "../fight/hero-move-names.js";
import { asArray } from "../utils/playbook-actors.js";

/** How much Command a Marshal holds on Stentorian's track (Book I p.127): 0 without the move learned. */
export function commandHeld(actor) {
	return learnedTrack(actor, HERO_MOVES.STENTORIAN)?.held ?? 0;
}

/** The characters this user may write who hold Command right now, out of `actors` (the world's by default). */
export function commandHolders(actors = globalThis.game?.actors) {
	return asArray(actors).filter(actor => actor?.type === "character"
		&& actor.isOwner !== false && commandHeld(actor) > 0);
}

/**
 * The Marshals Deploy's window may offer the Stentorian line for, as `{id, name}`: the user's own character
 * alone when it is one of the holders (they are the one Deploying), else every holder this user may write.
 */
export function deployCommandOffers(actors = globalThis.game?.actors, user = globalThis.game?.user) {
	const holders = commandHolders(actors);
	const own = user?.character ? holders.find(actor => actor.id === user.character.id) : null;
	return (own ? [own] : holders).map(actor => ({ id: actor.id, name: actor.name ?? "" }));
}
