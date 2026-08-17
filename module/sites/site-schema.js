// The shape of a site's keyed-row lists, and the one rule for what a row is worth keeping.
//
// A leaf module on purpose. Four things need this — the wizard (blank rows, seeding, row
// view-models, live capture), the shaper that decides what is SAVED, the card view-model that
// decides what is SHOWN, and the wizard's own review tally — and any of them importing another
// would be a cycle. Written out per consumer, a list named in only some of them was collected on
// the wizard and then silently dropped, at save time or at re-open time, with nothing failing.

/**
 * Which keys each paired list's rows hold, in the order they render.
 *
 * `multiline` names the keys backed by a textarea: their interior line breaks are the GM's own
 * paragraphing, so those keys are kept exactly as typed rather than trimmed. Every other key is
 * a single-line field, where leading and trailing space is only ever a slip.
 */
export const SITE_PAIR_LISTS = {
	questions: { keys: ["prompt", "answer"] },
	timeline:  { keys: ["when", "text"] },
	denizens:  { keys: ["name", "notes"] },
	areas:     { keys: ["title", "description", "contents", "exits"], multiline: ["description", "contents"] },
};

/** The keys of a paired list, or null if that list is not one. */
export const pairKeys = (list) => SITE_PAIR_LISTS[list]?.keys ?? null;

/** The plain string-list fields, keyed by the `data-list` value their rows carry. */
export const SITE_LINE_LISTS = ["connections", "dangers", "discoveries", "outside", "inside", "plans"];

/** Keep a row only if at least one of its fields carries text. */
export const someText = (row, keys) => keys.some(k => String(row?.[k] ?? "").trim());

/**
 * Keyed rows from a stored or collected list, dropping rows where every key is blank.
 *
 * ONE spelling of "what a keyed row is, and which of them are worth keeping", shared by the
 * shaper and the card view-model. Written twice, the two drifted over which blank counted as
 * blank, and a row could be saved and then never rendered.
 *
 * @param {Array} arr
 * @param {string[]} keys
 * @param {string[]} [keep]  keys whose interior whitespace is the author's own (textareas)
 */
export function keyedRows(arr, keys, keep = []) {
	return (Array.isArray(arr) ? arr : [])
		.map(row => Object.fromEntries(keys.map(k => {
			const raw = String(row?.[k] ?? "");
			return [k, keep.includes(k) ? raw : raw.trim()];
		})))
		.filter(row => someText(row, keys));
}

/** Keyed rows for one named paired list, honouring its own multiline keys. */
export function shapePairList(list, arr) {
	const spec = SITE_PAIR_LISTS[list];
	if (!spec) return [];
	return keyedRows(arr, spec.keys, spec.multiline ?? []);
}

/** A list of trimmed, non-empty strings from a seed's list field. */
export const cleanLines = (arr) => (Array.isArray(arr) ? arr : []).map(s => String(s ?? "").trim()).filter(Boolean);
