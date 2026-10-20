// The `settlement` Actor subtype's name, and the two ways to find one. A leaf: it imports nothing,
// so settlement-actor.js (which makes a settlement, and asks settlement-portrait.js for its picture)
// and settlement-portrait.js (which finds settlements to give pictures to) can both stand on it
// without importing each other. A module that needs only the type string (actor-types.js, the
// actor class, the singleton guard) imports it from here too, rather than pulling in
// settlement-actor.js and the whole book-art stack behind it.

/** The Actor subtype. Written once; everything else imports it. */
export const SETTLEMENT_TYPE = "settlement";

/** Is this an existing settlement, or creation data for one? */
export function isSettlementActor(actorOrData) {
	return actorOrData?.type === SETTLEMENT_TYPE;
}

/** Every settlement in the world. */
export function settlementActors(actors = globalThis.game?.actors) {
	return actors?.filter?.(isSettlementActor) ?? [];
}
