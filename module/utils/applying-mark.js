// The `applying` mark a damage card carries while its rows are applied (combat/attack-flow.js#applyOwedDamage).
// A leaf, so the fight's spends (fight/defend-spend.js) and the card boosts (actors/character/damage-card-boost.js)
// read it the same way without importing each other.

/**
 * Whether a damage card is being applied right now: its `applying` mark names a user who is still connected. A
 * mark left by someone who dropped mid-apply holds nothing. PURE apart from `users`.
 *
 * @param {object} damage  the card's damage flag
 * @param {{get?: Function}} [users]
 */
export function beingApplied(damage, users = globalThis.game?.users) {
	const by = damage?.applying;
	if (!by) return false;
	if (typeof by !== "string") return true;
	const user = users?.get?.(by);
	return user ? !!user.active : !users?.get;
}

/** Whether a damage card is past changing: some of it applied already, or being applied right now. */
export function cardSettled(damage, users) {
	return !!(damage?.applied ?? []).length || beingApplied(damage, users);
}
