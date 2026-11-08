// Answers set aside per choice: a dropdown whose choice decides what the fields below it hold (Make a
// Site's Manner and Region, a Thing Below's preset) keeps what was written under the choice being
// left, so switching back brings it back instead of losing it to one stray click.

/**
 * Put `current` aside under `fromKey` and take out what was set aside under `toKey`.
 * @param {object} store  the answers set aside, keyed by choice (a plain object, so it saves as JSON)
 * @param {string} fromKey  the choice being left
 * @param {string} toKey  the choice arrived at
 * @param {*} current  what was written under `fromKey`; null keeps nothing (there was nothing worth keeping)
 * @param {() => *} makeDefault  what a choice with nothing set aside starts with
 * @returns {*} the answers for `toKey`, which leave the store
 */
export function swapAside(store, fromKey, toKey, current, makeDefault) {
	if (current !== null && current !== undefined) store[fromKey] = current;
	if (!Object.hasOwn(store, toKey)) return makeDefault();
	const kept = store[toKey];
	delete store[toKey];
	return kept;
}
