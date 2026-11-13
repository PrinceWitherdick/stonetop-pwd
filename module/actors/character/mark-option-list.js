// A move's mark options, listed under its words where a move is CHOSEN (character creation's moves
// step, Level Up's move cards). The words of a move with mark options stop at the lead-in ("Mark
// one:", the book's Veteran Crew's "Each time you take this move, pick 1:"), because on the sheet the
// options are the move's boxes and a list printed twice is two lists that can't count each other. A
// card read before the move is taken has no boxes, so it lists them. PURE.

import { escHtml } from "../../utils/strings.js";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: "\"", ldquo: "\"", ndash: "-", mdash: "-", hellip: "..." };

// Words as read, for telling whether the description names an option already: tags and entities
// gone, curly quotes and dashes straightened, spaces folded.
function _loose(text) {
	return String(text ?? "")
		.replace(/<[^>]*>/g, " ")
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
		.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, "\"").replace(/[\u2013\u2014]/g, "-")
		.replace(/[\s\u00a0]+/g, " ")
		.trim();
}

// The lead-in a mark list goes under: "Mark one:", "Each time you take this move, pick 1:". A roll's
// "On a 10+, choose 2:" leads into its own list, never this one.
const MARK_LEAD = /\bmark\b|each time you take this move/i;
const ROLL_LEAD = /^on an? (?:\d|hit|miss|success|failure)|\bon a \d+[+-]/i;

/**
 * @param {string} html            the move's description
 * @param {object[]} markOptions   system.markOptions ({ label, choice? })
 * @returns {string}  the description with the options as a list under the words that lead into
 *   them ("Mark one:"), else after it all; unchanged when it names every one already
 */
export function withMarkOptionList(html, markOptions) {
	const labels = (markOptions ?? [])
		.filter(o => o && o.choice !== "stat")
		.map(o => String(o.label ?? "").trim())
		.filter(Boolean);
	const words = String(html ?? "");
	if (!labels.length) return words;
	const plain = _loose(words);
	if (labels.every(l => plain.includes(_loose(l)))) return words;
	const list = `<ul>${labels.map(l => `<li>${escHtml(l)}</li>`).join("")}</ul>`;
	// The lead that names marking, else the first one that isn't a roll's.
	let at = -1;
	let fallback = -1;
	for (const m of words.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
		const text = _loose(m[1]);
		if (!text.endsWith(":")) continue;
		const end = m.index + m[0].length;
		if (MARK_LEAD.test(text)) { at = end; break; }
		if (fallback < 0 && !ROLL_LEAD.test(text)) fallback = end;
	}
	if (at < 0) at = fallback;
	return at < 0 ? `${words}${list}` : `${words.slice(0, at)}${list}${words.slice(at)}`;
}
