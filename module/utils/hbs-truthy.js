/**
 * The truth test Handlebars' own `{{#if}}` applies, for the logic helpers we register
 * beside it (`and` / `or` / `not` in stonetop.js).
 *
 * They have to agree, and plain JS truthiness does NOT: an EMPTY ARRAY is truthy in JS
 * and falsy to `{{#if}}` (Handlebars' `isEmpty` special-cases it, which is why
 * `{{#if items}}` skips an empty list without anyone writing `.length`). So a helper
 * built on `Boolean` reads one way and the block helper right next to it reads the
 * other, and `{{#if (and edit items)}}` renders a heading over an empty `{{#each}}`
 * while `{{#if items}}` correctly draws nothing.
 *
 * That divergence is invisible at the call site and only shows up on the empty case,
 * which is rarely the one anybody opens the sheet on. Closing it here means a template
 * author can pass a list straight into `and` / `or` / `not` and get what they'd get from
 * `{{#if}}`, with no `.length` to remember.
 *
 * Handlebars' rule, exactly: falsy in JS is falsy here, an empty array is falsy, and
 * everything else — `{}` and `[0]` included — is truthy. (Handlebars would call 0
 * non-empty, but its `if` still rejects it via the plain `!conditional` half of its own
 * test, so `Boolean` covers that case for us.)
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function hbsTruthy(value) {
	return Array.isArray(value) ? value.length > 0 : Boolean(value);
}
