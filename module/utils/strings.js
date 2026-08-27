import { isPersonPlaceholderImg } from "./person-portrait.js";

/** Capitalize the first character of a string. */
export function capitalizeFirst(str) {
	return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

/**
 * Lowercase kebab-case slug: NFKD-decomposes accented letters and drops the combining
 * diacritical marks (U+0300–U+036F), so "Café" → "cafe"; then any remaining run of
 * non-alphanumerics collapses to a single hyphen, with edge hyphens trimmed.
 */
export function slugify(name) {
	let out = "";
	for (const ch of String(name ?? "").normalize("NFKD")) {
		const c = ch.codePointAt(0);
		if (c >= 0x300 && c <= 0x36f) continue; // combining diacritical marks
		out += ch;
	}
	return out.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// The single, audited HTML-escaper for the whole system. Pure (no Foundry/DOM) so it
// is safe to import into unit-testable, Foundry-free modules (artifact-creation-tables,
// custom-move-text). Escapes the five characters that matter for both element and
// attribute contexts; do NOT add ad-hoc copies elsewhere — import this.
const _HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };

/** Escape a value for safe insertion into HTML (element text or attribute value). */
export function escHtml(v) {
	return String(v ?? "").replace(/[&<>"']/g, (c) => _HTML_ESCAPES[c]);
}

/**
 * Escape a value for literal use inside a RegExp. The one regex-escaper for the system —
 * pure, so Foundry-free modules can import it; do NOT add ad-hoc copies elsewhere.
 * `-` is escaped too, so the result is also safe to drop inside a character class.
 *
 * ⚠ That makes the output unsafe under the `u`/`v` flags: `\-` outside a character class
 * is a legal identity escape in a plain RegExp and a SyntaxError in a unicode one. Every
 * call site is flagless or "g"/"gi"; keep it that way, or escape without `-` there.
 */
export function escapeRegExp(v) {
	return String(v ?? "").replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
}

// Join names for display: ["Astor","Halix"] → "Astor & Halix"; three or more use an
// Oxford-free serial comma ("A, B & C"). Blanks are dropped, so a missing name can't leave a
// stray separator behind.
//
// The one list-joiner: every "you got A, B & C" toast in the system reads the same way, which
// it stops doing the moment a second one is written with a different conjunction.
export function joinNames(names) {
	const list = (names ?? []).filter(Boolean);
	if (list.length <= 1) return list[0] ?? "";
	if (list.length === 2) return `${list[0]} & ${list[1]}`;
	return `${list.slice(0, -1).join(", ")} & ${list[list.length - 1]}`;
}

// Collapse rich text (an HTML / ProseMirror field) to a single plain-text line for a tooltip or
// a ledger/preview: drop tags (turning a line or block BREAK into a space so words don't glue),
// decode the handful of named entities our authored prose uses, and squeeze whitespace. Returns
// "" for null/blank.
// The one strip-HTML helper — do NOT add ad-hoc copies elsewhere; import this.
export function stripHtmlToText(value) {
	if (value == null) return "";
	return String(value)
		// <br> and the END of a block become a space so words on either side of the break don't
		// glue: two paragraphs would otherwise come back as "…the ford is watched.They cross at
		// dusk…", run together at exactly the place a reader needs the break. Every other tag
		// drops to nothing so an inline tag next to punctuation ("Together</em>,") leaves no gap.
		.replace(/<\s*br\s*\/?>/gi, " ")
		.replace(/<\/(?:p|div|li|h[1-6]|blockquote|tr|td|th|section|article)\s*>/gi, " ")
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&mdash;/gi, "—")
		.replace(/&ndash;/gi, "–")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&rsquo;/gi, "'")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Decode the entities our authored prose carries, PRESERVING typography.
 *
 * NUMERIC forms are decoded alongside the named ones, and the match is case-insensitive. Both
 * matter: move-picks.js used to keep a private decoder purely because it needed `&#8211;`, and
 * its own comment explains the stakes — a tier written `7&#8211;9` that one pattern sees and
 * another does not is "not a missed cap but a WRONG one". `&#x27;` is here because escHtml
 * EMITS it, so anything that escapes text and later reads it back needs to get its apostrophe
 * home again.
 *
 * The one entity decoder — do NOT add ad-hoc copies. There used to be two, and neither was a
 * superset of the other: one knew `&mdash; &ndash; &hellip; &rsquo; &lsquo;` and the other knew
 * `&lt; &gt; &#39;`, so text routed through the wrong one came out with raw entities still in it.
 * Both call sites (the Chronicle's stored qa prompt, the FAQ's section/question labels) produce
 * PLAIN TEXT labels rather than markup, so decoding `&lt;`/`&gt;` here can't inject anything.
 *
 * `&amp;` is decoded LAST so a double-encoded source (`&amp;mdash;`) can't decode twice.
 *
 * Distinct from {@link stripHtmlToText}, which deliberately flattens `&rsquo;` to an ASCII `'`
 * for one-line tooltips and ledger previews. This one keeps the curly mark.
 */
export function decodeEntities(text) {
	return String(text ?? "")
		.replace(/&mdash;|&#8212;|&#x2014;/gi, "—")
		.replace(/&ndash;|&#8211;|&#x2013;/gi, "–")
		.replace(/&hellip;|&#8230;/gi, "…")
		.replace(/&rsquo;|&#8217;/gi, "’")
		.replace(/&lsquo;|&#8216;/gi, "‘")
		.replace(/&nbsp;|&#160;/gi, " ")
		.replace(/&quot;|&#34;/gi, '"')
		.replace(/&#39;|&#x27;/gi, "'")
		.replace(/&lt;|&#60;/gi, "<")
		.replace(/&gt;|&#62;/gi, ">")
		.replace(/&amp;|&#38;/gi, "&");
}

// A move outcome's flattened value reads "<lead-in> pick 1: <option> / <option> / …"
// (the source <ul><li> list is collapsed to slash-separated text by the move pipeline).
// This marker finds the "pick N:" / "choose N:" / "select N:" hinge so we can split the
// trailing options back onto their own bulleted lines. The {0,40} keeps the match from
// running past the colon into unrelated prose.
const _PICK_MARKER = /\b(?:pick|choose|select)\b[^:]{0,40}:/i;

// Options after the hinge are separated by " / " (from a collapsed <ul>) or by a
// deliberate capitalised "OR" / "; OR". "OR" is matched case-SENSITIVELY so an option's
// own natural-language "or" (and lowercase comma lists) stay intact — those read as prose.
//
// Exported because the post-death chooser splits the same kind of list out of an insert
// option's own prose ("Pick 1: still-warm blood / dying breaths / …"); the two must agree
// about what separates one alternative from the next.
export const PICK_SEPARATOR = /\s+\/\s+|\s*;?\s*\bOR\b\s+/;

/**
 * Split a "…pick N: <option> / <option> / …" outcome into its lead-in and its options, or
 * return null when the text presents no such list (no hinge, or fewer than two options
 * after it). PLAIN TEXT in, plain text out — escaping is the caller's job.
 *
 * The one pick-list parser: {@link formatOutcomeDetail} renders it, and the move card's tier
 * ladder (utils/move-tiers.js) asks the same question to decide whether a tier's options are
 * already listed in the move's own prose above it. Two parsers would disagree the moment one
 * learned a separator the other didn't.
 */
export function splitPickList(text) {
	const raw = String(text ?? "").trim();
	if (!raw) return null;
	const m = raw.match(_PICK_MARKER);
	if (!m) return null;
	const markerEnd = m.index + m[0].length;
	const intro   = raw.slice(0, markerEnd).trim();
	const rest    = raw.slice(markerEnd).trim().replace(/\.\s*$/, "");
	const options = rest.split(PICK_SEPARATOR).map((s) => s.trim()).filter(Boolean);
	if (options.length < 2) return null;
	return { intro, options };
}

/**
 * Render a move-result outcome string as HTML. When the text presents a "pick N:" list
 * of slash-separated options, the lead-in stays as prose and the options become a
 * spiral-bulleted <ul class="stonetop-roll-result-picks"> — otherwise the text is just
 * HTML-escaped. Pure (no DOM), so both the server-side card builder (roll-engine) and the
 * GM shift-tier reformatter (stonetop.js) can share it. Returns "" for empty input.
 *
 * `introOnly` keeps the lead-in and DROPS the option list: the move card's tier ladder sets
 * it when the very same options are already bulleted in the move's description right above
 * the ladder, so a "pick 1" move doesn't print its list twice.
 */
export function formatOutcomeDetail(text, { introOnly = false } = {}) {
	const raw = String(text ?? "").trim();
	if (!raw) return "";
	const split = splitPickList(raw);
	if (split) {
		if (introOnly) return `<span class="stonetop-roll-result-lead">${escHtml(split.intro)}</span>`;
		const items = split.options.map((o) => `<li>${escHtml(o)}</li>`).join("");
		return `<span class="stonetop-roll-result-lead">${escHtml(split.intro)}</span>`
			+ `<ul class="stonetop-roll-result-picks">${items}</ul>`;
	}
	return escHtml(raw);
}

/** Ensure miss result labels are visually emphasized in rendered move text. */
export function boldMissText(html) {
	return String(html ?? "").replace(/(<strong>\s*)?\b(on a 6(?:-|\u2212|\u00e2\u02c6\u2019))(\s*<\/strong>)?/gi, (match, open, label, close) => {
		if (open && close) return match;
		return `<strong>${label}</strong>`;
	});
}

/**
 * Strip "... +STAT to ..." option lines from a move description that don't
 * match the chosen stat, for "ask"-type moves (Defy Danger, Interfere) where
 * the player picks one stat from a list of several presented in the text.
 */
export function filterStatOptionLines(html, statKey) {
	if (!statKey) return String(html ?? "");
	const want = String(statKey).toUpperCase();
	return String(html ?? "").replace(/<p>\s*\.\.\.\s*\+([A-Z]{3})\b[^<]*<\/p>/g, (match, stat) =>
		stat === want ? match : ""
	);
}

/**
 * Returns true when `img` is absent or a placeholder rather than real, author-chosen art:
 * one of Foundry's stock defaults (the mystery-man portrait, the item-bag Item icon) or
 * this system's own people silhouette, which art-less NPCs now wear in mystery-man's place
 * (see utils/person-portrait.js). Swapping one placeholder for another must not turn a
 * person with no picture into a person with one, so both answer the same here.
 */
export function isDefaultImg(img) {
	const defaultToken = globalThis.CONST?.DEFAULT_TOKEN ?? "icons/svg/mystery-man.svg";
	return !img
		|| img === "icons/svg/mystery-man.svg"
		|| img === "icons/svg/item-bag.svg"
		|| img === defaultToken
		|| isPersonPlaceholderImg(img);
}

// Mis-decoded UTF-8 sequences seen in the transcribed playbook text → their real
// glyph. Used to clean playbook option text (instincts, costs, tags, choices)
// wherever it is shown or stored, so the onboarding dialog and the character
// sheet normalise identically.
const _PLAYBOOK_GLYPH_FIXES = [
	[[0xe2, 0x2014, 0x2039], [0x25cb]], // circle
	[[0xe2, 0x2014, 0x2021], [0x25c7]], // diamond
	[[0xe2, 0x2014, 0x2020], [0x25c6]], // filled diamond
	[[0xe2, 0x2013, 0x00a1], [0x25a1]], // square
	[[0x00c2, 0x00b7], [0x00b7]],       // middle dot
	[[0xe2, 0x20ac, 0x201d], [0x2014]], // em dash
	[[0xe2, 0x20ac, 0x201c], [0x2013]], // en dash
	[[0xe2, 0x20ac, 0x00a6], [0x2026]], // ellipsis
	[[0xe2, 0x20ac, 0x2122], [0x2019]], // apostrophe
	[[0xe2, 0x20ac, 0x0153], [0x201c]], // opening quote
	[[0xe2, 0x20ac, 0x009d], [0x201d]], // closing quote
].map(([from, to]) => [String.fromCodePoint(...from), String.fromCodePoint(...to)]);

/** Repair mis-decoded glyphs in transcribed playbook text. */
export function normalizePlaybookGlyphs(value) {
	let text = String(value ?? "");
	for (const [from, to] of _PLAYBOOK_GLYPH_FIXES) text = text.replaceAll(from, to);
	return text;
}

// ── Instinct format ─────────────────────────────────────────────────────────
// A character's instinct reads "Word — Description" (e.g. "Delight — To find
// beauty…"). Custom instincts follow the same shape so they sit alongside the
// playbook's suggestions. These compose / split the two halves around the
// shared space-em-dash-space separator.

export const INSTINCT_SEPARATOR = " — ";

/** Reduce a custom instinct's word to a single token (an instinct is one word). */
function oneWord(value) {
	return String(value ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * Compose a "Word — Description" instinct value from its two halves. The
 * separator is kept whenever there's a description (even with an empty word) so
 * the value round-trips through {@link parseInstinct} losslessly: a
 * description-only instinct stays a description and never collapses into the word
 * half. A word with no description has no separator.
 */
export function composeInstinct(word, description) {
	const w = oneWord(word);
	const d = String(description ?? "").trim();
	if (!w && !d) return "";
	if (!d) return w;
	return `${w}${INSTINCT_SEPARATOR}${d}`;
}

/** Split a stored instinct value back into { word, description }. */
export function parseInstinct(value) {
	const v = String(value ?? "").trim();
	if (!v) return { word: "", description: "" };
	const idx = v.indexOf(INSTINCT_SEPARATOR);
	if (idx === -1) return { word: v, description: "" };
	return {
		word:        v.slice(0, idx).trim(),
		description: v.slice(idx + INSTINCT_SEPARATOR.length).trim(),
	};
}
