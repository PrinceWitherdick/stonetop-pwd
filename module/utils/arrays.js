/**
 * One member of `pool` at random, preferring anything OTHER than `exclude`.
 *
 * The shape every "surprise me" button in this system wants: the caller passes what it drew
 * last, so pressing twice always moves on. A randomizer that repeats reads as broken rather
 * than random, and with seven items in the shortest list that is a one-in-seven event. Falls
 * back to the whole pool when excluding would leave nothing, which is only a one-item pool.
 *
 * Compared through `keyOf`, so the two sides can be spelled differently and still be the same
 * thing (the portrait gallery passes `portraitIdentity`; the GM moves compare by name). The
 * RETURN is always a raw member of `pool`, because callers look the winner up by it.
 *
 * `rng` is injectable so the tests pin the roll rather than hoping for one.
 *
 * @param {Array} pool
 * @param {object} [options]
 * @param {*} [options.exclude]                 The thing to avoid repeating.
 * @param {() => number} [options.rng]
 * @param {(item: any) => any} [options.keyOf]  Identity, for comparing against `exclude`.
 */
export function pickRandomExcluding(pool, { exclude = "", rng = Math.random, keyOf = (x) => x } = {}) {
	const items = (pool ?? []).filter(Boolean);
	if (!items.length) return null;
	const held = keyOf(exclude);
	const fresh = items.filter(item => keyOf(item) !== held);
	const choices = fresh.length ? fresh : items;
	// Clamp rather than trust rng() < 1: a stub (or an edge-case 1) would index past the end.
	return choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))];
}

// Return a Fisher–Yates shuffled copy of `arr`; the input is left untouched.
export function shuffle(arr) {
	const out = [...arr];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}
