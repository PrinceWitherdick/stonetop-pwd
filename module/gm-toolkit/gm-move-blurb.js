// One move's book text, cut in two so the sheet can show the start of it and grow the rest in
// place.
//
// The Moves tab shows every entry as a name and one line under it. That line used to be our own
// gloss, with the book's description hidden in a panel below, which meant opening an entry read as
// a summary followed by a paragraph saying roughly the same thing again in different words. It is
// ONE blurb: the line under the name is the book's own first sentence, and expanding continues
// that sentence rather than replacing it. The words on screen never move, they only carry on.
//
// So what is needed is the first sentence, verbatim, and everything after it. `gloss` is untouched
// and still ours: the Expedition walkthrough renders it, and the chat card leads with it.

/**
 * @typedef {object} MoveBlurb
 * @property {string}   lead        The book's first sentence. What the collapsed row shows.
 * @property {string}   rest        The remainder of that paragraph, revealed inline after it.
 * @property {string[]} paragraphs  The book's LATER paragraphs, revealed under the blurb.
 * @property {string}   hardness    The soft/hard line, if it did not become the lead itself.
 */

/**
 * Split a paragraph after its first sentence.
 *
 * A sentence ends at `.`, `!` or `?` followed by whitespace, which is enough here because these
 * are transcribed paragraphs rather than arbitrary input: the abbreviations they do contain
 * ("(e.g.)", "(messy, forceful, etc.)") close with a bracket rather than a space, so none of them
 * is mistaken for the end. A paragraph of one sentence keeps it all and leaves nothing to reveal.
 */
function splitFirstSentence(text) {
	const match = /^([\s\S]+?[.!?])\s+([\s\S]+)$/.exec(text.trim());
	return match ? [match[1], match[2]] : [text.trim(), ""];
}

/**
 * The book's text for one move, in the order the row shows it.
 *
 * A move with no description at all (Capture someone, whose whole entry IS its soft/hard
 * guidance) leads with that guidance instead, and does not then repeat it below.
 *
 * @param   {import("./gm-moves.js").GmMove} move
 * @returns {MoveBlurb}
 */
export function moveBlurb(move) {
	const paragraphs = [...(move?.detail ?? [])];
	let hardness = move?.hardness ?? "";
	let first = paragraphs.shift() ?? "";
	if (!first) {
		first = hardness;
		hardness = "";
	}
	// Falls back to our own gloss for an entry with no book text at all. Nothing in the shipped
	// table is in that state (a test says so), but a half-written new entry should still render a
	// row rather than a name with a blank line under it.
	const [lead, rest] = splitFirstSentence(first || move?.gloss || "");
	return { lead, rest, paragraphs, hardness };
}
