// The one place a character's XP total is changed.
//
// THE PROBLEM THIS EXISTS FOR. Every XP change in the system is a delta applied to a total that
// only the document holds, so each one is a read-modify-write:
//
//     const xp = actor.system.attributes.xp.value ?? 0;
//     await actor.update({ "system.attributes.xp.value": xp + 1 });
//
// There were four copies of that shape (a miss marking +1, Burn Brightly spending 2, a level-up
// spending the threshold, End of Session awarding the group's), each reading the total at its own
// moment and writing back a number computed from it. Two of them overlapping means both read the
// same starting total and the second write lands on top of the first: one change is simply gone,
// with no error on either side and nothing afterwards that could notice. XP is a running total
// nothing reconciles, so a lost mark is invisible until somebody levels a session late.
//
// Foundry has no atomic increment, so the fix is to stop the overlap: every delta goes through
// one queue per Actor, and the total is read INSIDE that queue, immediately before the write,
// rather than whenever the caller happened to ask.
//
// WHAT THIS DOES NOT FIX, said plainly because it matters: the queue is per client. Two people
// changing the same character's XP in the same instant, from two browsers, can still lose one
// change, because each client's queue only knows about its own writes. Closing that needs the
// deltas routed through a single client, which is a socket and a different piece of work. What
// this does close is every same-client overlap, which is all four writers above plus the case
// this was found through: a chat-card button firing while a roll is still resolving.
//
// Nor does it govern the XP INPUT on the character sheet. That is a person typing an absolute
// number, not a delta, and last-write-wins is the correct behaviour for it.

/**
 * Stonetop's XP-to-level rule: the total needed to level up at a given level is 6 + 2 x level.
 *
 * The single owner of that curve. Every "N / max" readout and affordability check calls this
 * rather than re-deriving it, so a change to the curve lands in exactly one place.
 */
export function xpToLevelUp(level) {
	return 6 + level * 2;
}

/**
 * One promise chain per Actor, keyed by UUID.
 *
 * UUID rather than id because an unlinked token's synthetic Actor reports the WORLD Actor's id
 * (ActorDelta#_initialize) while being a genuinely separate document. Keying by id would put two
 * documents on one queue: harmless, but it would serialise writes that never needed it and hide
 * the distinction from anyone reading this later.
 *
 * Entries delete themselves as they drain, so this never grows past the number of characters
 * being written to at one moment.
 */
const _queues = new Map();

/**
 * Run `work` with exclusive access to this Actor's XP, after anything already queued for it.
 *
 * For a change that is more than a delta: a level-up spends XP and raises the level in ONE
 * update, and splitting that into two writes would leave a moment where the character has the
 * new level and has not paid for it. Such a caller reads and writes inside `work`, which is what
 * makes the read safe.
 *
 * `work`'s own result is passed through, and its failure reaches its own caller and nobody else:
 * the queue holds a rejection-proof copy, so one caller throwing can never strand the next.
 *
 * @param {object} actor
 * @param {Function} work
 * @returns {Promise<*>}
 */
export function withXpLock(actor, work) {
	const key = actor?.uuid ?? actor?.id ?? null;
	// Nothing to serialise against. Still run: a caller must never silently do nothing because
	// the bookkeeping could not identify the document.
	if (!key) return Promise.resolve().then(() => work());

	const prior = _queues.get(key) ?? Promise.resolve();
	const run = prior.then(() => work());
	// What the NEXT caller waits on: `run` with its outcome swallowed, so a caller that throws
	// hands its failure to its own awaiter and to nobody else. The cleanup is part of this chain
	// rather than a second one hanging off it, so there is no unhandled promise here to reason
	// about — and since the chain absorbs rejections, this can never itself reject.
	//
	// Only the tail clears the entry. A caller that queued behind this one has already replaced
	// the value, and deleting it then would let the caller after THAT start a second chain
	// running in parallel with this one, which is the whole thing the queue exists to prevent.
	const settled = run.then(() => {}, () => {}).then(() => {
		if (_queues.get(key) === settled) _queues.delete(key);
	});
	_queues.set(key, settled);
	return run;
}

const _xpOf    = (actor) => Number(actor?.system?.attributes?.xp?.value ?? 0);
const _levelOf = (actor) => Number(actor?.system?.attributes?.level?.value ?? 1);

/**
 * Add `delta` to a character's XP, serialised against every other change to the same character.
 *
 * The total is read inside the queue, so `delta` is applied to whatever the character actually
 * has at the moment of writing and not to a number the caller read earlier.
 *
 * `require` is a precondition checked at that same moment, for a spend that is only legal above
 * some threshold. Burn Brightly is the case: it is affordable only at or above the level-up
 * total, and checking that when the button is CLICKED lets a second spend queued behind the
 * first go through against a total that no longer allows it. A failed precondition is not an
 * error, it is a no: nothing is written and `applied` comes back false for the caller to report.
 *
 * XP is floored at 0 (nobody owes XP) but deliberately NOT capped: the level-up total is a
 * threshold to cross, not a ceiling to sit under.
 *
 * @param {object} actor
 * @param {number} delta
 * @param {object} [options]
 * @param {string|null} [options.move]     attribute the change to this move in the ledger
 * @param {Function|null} [options.require] (currentXp, level) => boolean, checked at write time
 * @returns {Promise<{applied: boolean, before: number, after: number, max: number, level: number}>}
 */
export function adjustXp(actor, delta, { move = null, require: precondition = null } = {}) {
	return withXpLock(actor, async () => {
		const before = _xpOf(actor);
		const level  = _levelOf(actor);
		const max    = xpToLevelUp(level);
		const deny   = { applied: false, before, after: before, max, level };

		if (!actor?.update) return deny;
		if (precondition && !precondition(before, level)) return deny;

		const after = Math.max(0, before + delta);
		if (after === before) return deny;

		await actor.update(
			{ "system.attributes.xp.value": after },
			move ? { stonetopMove: move } : {},
		);
		return { applied: true, before, after, max, level };
	});
}
