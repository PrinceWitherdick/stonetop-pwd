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

/**
 * A settlement that lives in the world itself: not a compendium's copy, not a token's synthetic one.
 * Only these take residents or answer to a Home.
 */
export function isWorldSettlement(actor) {
	return isSettlementActor(actor) && !actor.pack && !actor.isToken;
}

/** Every settlement in the world, oldest first (oldestSettlementsFirst), so any "first match" is the same on every load. */
export function settlementActors(actors = globalThis.game?.actors) {
	return oldestSettlementsFirst(actors?.filter?.(isSettlementActor) ?? []);
}

/**
 * Settlements oldest first: by when each was made, then by id. Where two sheets share a name or a
 * book place, "the first" has to mean the same sheet on every load and every client. The world's
 * actor list is no good for that: a sheet made this session goes on its end, but a reload hands the
 * list back in the server's storage order (by id), which can put the newer sheet first. A sheet made
 * before Foundry stamped creation times sorts after every stamped one, among themselves by id.
 */
export function oldestSettlementsFirst(settlements) {
	const made = s => {
		const t = Number(s?._stats?.createdTime);
		return Number.isFinite(t) && t > 0 ? t : Infinity;
	};
	// Each key read once, not in every comparison.
	return [...(settlements ?? [])]
		.map(s => ({ s, t: made(s), id: String(s?.id ?? "") }))
		.sort((a, b) => (a.t !== b.t ? (a.t < b.t ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
		.map(({ s }) => s);
}
