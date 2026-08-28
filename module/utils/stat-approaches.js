/**
 * The approach a move prints beside each stat, read out of the move's own text.
 *
 * Defy Danger and Interfere don't just say "roll +STAT" — they print six lines that say what
 * each stat MEANS here ("... +STR to power through or test your might", "... +DEX to employ
 * speed, agility, or finesse"). Those lines are the whole content of the choice the stat picker
 * puts to the player, and a picker that shows six bare stat abbreviations asks the book's
 * question while withholding the book's answer key.
 *
 * Read from the move's description rather than restated in a table here, for the same reason the
 * roll card ticks the move's OWN printed list: a second copy of somebody else's text drifts, and
 * a homebrew or re-worded move written the same way gets the same treatment for free. A move
 * that prints no such list yields {} and the picker stays exactly as it was.
 *
 * The leading ellipsis is REQUIRED, and is what keeps this from firing on an ordinary trigger
 * line: "roll +STR:" opens Clash, "... +STR to power through" is an item in a list of approaches.
 */

import { stripHtmlToText } from "./strings.js";

/** Block elements, so each printed line is tested on its own. The book sets these as paragraphs;
 *  a homebrew move may well use a bulleted list, so both are split here. */
const _BLOCK_SPLIT = /<\/(?:p|li|div|h[1-6]|blockquote)\s*>/i;

/** "... +STR to power through or test your might" — ellipsis, stat, then the clause. Both the
 *  three-dot and the single-character ellipsis are accepted, since either can survive a paste. */
const _APPROACH = /^(?:\.\s*\.\s*\.|…)\s*\+\s*(str|dex|con|int|wis|cha)\b[\s:]*(.+)$/i;

/**
 * @param {string} description  The move's rich-text description.
 * @returns {Record<string, string>} stat key → the clause as printed ("to power through or test
 *   your might"), for whichever stats the move actually lists. Empty when it lists none.
 */
export function statApproaches(description) {
	const out = {};
	for (const block of String(description ?? "").split(_BLOCK_SPLIT)) {
		const line = stripHtmlToText(block).trim();
		if (!line) continue;
		const match = _APPROACH.exec(line);
		if (!match) continue;
		// A trailing ellipsis belongs to the NEXT line in the printed layout ("... +CON to endure
		// or hold steady ..."), not to this clause, so it comes off before the text is shown.
		const clause = match[2].replace(/(?:\s*\.\s*\.\s*\.|\s*…)\s*$/, "").trim();
		const key = match[1].toLowerCase();
		if (clause && !out[key]) out[key] = clause;
	}
	return out;
}
