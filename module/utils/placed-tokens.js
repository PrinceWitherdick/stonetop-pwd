// Reach the tokens ALREADY STANDING ON SCENES, not just the prototype.
//
// A TokenDocument copies its fields out of `prototypeToken` at the moment it is placed and never
// looks at them again. So any sweep that stops at the prototype changes the NEXT token dragged out
// and leaves everything already in play showing the old value — which is precisely the token
// somebody is looking at, and reads exactly like the change not working.
//
// Three sweeps needed that and each had written the same per-scene batching by hand: the nameplate
// backfill and the shoot-marker lift in hooks/Ready.js, and the crop re-point in
// utils/portrait-token-frame.js. Three copies of one rule is three places to fix when the rule
// changes, and they had already drifted on error handling — so it is stated once here.

/**
 * Update every placed token `match` accepts, one batched request per affected scene.
 *
 * `match(token, scene)` picks the tokens to touch; `patch(token, scene)` returns the update body
 * for one of them, with the `_id` added here. A falsy patch skips that token, so a caller with a
 * per-token decision can make it in either half.
 *
 * NO REQUEST AT ALL for a scene with nothing to change — which, for the idempotent startup sweeps,
 * is every scene on every load after the first.
 *
 * THE SCENES ARE WRITTEN CONCURRENTLY. They are distinct documents, so nothing orders them against
 * each other, and awaiting them in turn spent a full server round trip per scene on the blocking
 * startup path. (Within one scene the tokens still go in a single batched call, which is what keeps
 * this one broadcast and one canvas repaint rather than one per token.)
 *
 * BEST-EFFORT PER SCENE: a scene this user may not write to is warned about and skipped, rather
 * than failing the sweep and taking the scenes behind it down with it. Every caller has already
 * saved the thing that matters — the prototype, the frame, the actor — before reaching here, and
 * all of them are idempotent, so a scene missed now is simply picked up next time. `what` names the
 * job in that warning.
 *
 * @param {(token: object, scene: object) => boolean} match
 * @param {(token: object, scene: object) => object|null} patch
 * @param {object} [opts]
 * @param {string} [opts.what]  what this sweep is doing, for the per-scene warning
 * @returns {Promise<number>} how many placed tokens were updated
 */
export async function updatePlacedTokens(match, patch, { what = "update" } = {}) {
	const pending = [];
	for (const scene of globalThis.game?.scenes ?? []) {
		const updates = [];
		// Iterated rather than filter/map'd into three arrays: this walks every token on every
		// scene, and on the loads where it matches nothing (the common case) the copies were the
		// only work it did.
		for (const token of scene.tokens ?? []) {
			if (!match(token, scene)) continue;
			const body = patch(token, scene);
			if (body) updates.push({ _id: token.id, ...body });
		}
		if (updates.length) pending.push({ scene, updates });
	}
	if (!pending.length) return 0;

	const counts = await Promise.all(pending.map(({ scene, updates }) =>
		Promise.resolve(scene.updateEmbeddedDocuments("Token", updates))
			.then(() => updates.length)
			.catch((err) => {
				console.warn(`stonetop | could not ${what} the placed tokens on "${scene.name}"`, err);
				return 0;
			})));
	return counts.reduce((total, n) => total + n, 0);
}
