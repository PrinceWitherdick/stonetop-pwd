// The one place English plurals are picked for user-facing lines, so a wording rule changes once.

/** `one` when there is exactly one, otherwise `many` ("s" on the end unless given). */
export function plural(n, one, many = `${one}s`) {
	return n === 1 ? one : many;
}

/** "1 journal", "3 journals": the count and its noun together. */
export function countOf(n, one, many) {
	return `${n} ${plural(n, one, many)}`;
}
