// Shared view-model builders for the GM-prep cards (threat + hazard). The two cards use
// the same doom-track / GM-moves / custom-player-moves markup and data hooks, so the
// derivation of those pieces lives once here; each card's own builder adds only its
// unique fields (a threat's themes/aspects/stakes/nested, a hazard's damage line).
import { enrichHTML } from "../utils/foundry-compat.js";
import { escHtml, decodeEntities } from "../utils/strings.js";

// ── Plain text in an HTML field ─────────────────────────────────────────────────────────────
// The hazard wizard and the threat editor's custom-move rows are TEXTAREAS, but what they fill
// is an HTMLField that the card draws as markup. Stored raw, a GM's line breaks collapsed into
// one run-on block (the card has no pre-wrap) and a "<" opened a tag. So a textarea's text is
// stored as escaped paragraphs, read back into the textarea as clean text, and a value saved
// raw before this (plain text, no tags at all) is still drawn with its breaks.

/** Does this field value carry markup, as opposed to plain text saved straight from a textarea? */
const _HAS_TAG = /<\/?[a-z][^>]*>/i;

/**
 * A textarea's text as the HTML its field stores: blank-line-separated paragraphs become <p>,
 * single line breaks become <br>, and everything is escaped. Empty in, empty out.
 */
export function plainTextToHtml(text) {
	const t = String(text ?? "").replace(/\r\n?/g, "\n").trim();
	if (!t) return "";
	return t.split(/\n[ \t]*\n\s*/)
		.map(p => `<p>${escHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
		.join("");
}

/**
 * A stored field value as clean text for a textarea: the inverse of {@link plainTextToHtml},
 * and it also flattens richer HTML (a page edited elsewhere) to its words and breaks rather
 * than showing raw tags. A value with no tags is legacy plain text and comes back untouched.
 */
export function htmlToPlainText(value) {
	const s = String(value ?? "");
	if (!_HAS_TAG.test(s)) return s;
	return decodeEntities(s
		// Source whitespace in markup is not a line break; only the tags below are.
		.replace(/\s*\n\s*/g, " ")
		.replace(/<\s*br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|li|h[1-6]|blockquote)\s*>/gi, "\n\n")
		.replace(/<[^>]*>/g, ""))
		.replace(/[ \t]*\n[ \t]*/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Text as compared for "was it edited": line endings and outer whitespace do not count. */
const _proseKey = text => String(text ?? "").replace(/\r\n?/g, "\n").trim();

/**
 * The write-back half of a textarea over an HTML field, for values that came from the field.
 * Flattening richer HTML (bold, an @UUID link, a page edited in the rich editor) to the
 * textarea is lossy, so a text the GM left as it was hands back the value it was read from,
 * untouched; only an edited text is stored afresh through {@link plainTextToHtml}.
 * @param {Iterable<string>} originals  the stored values the textareas were filled from
 * @returns {(text: string) => string}
 */
export function plainTextKeeper(originals) {
	const byText = new Map();
	for (const value of originals ?? []) {
		const s = String(value ?? "");
		if (s) byText.set(_proseKey(htmlToPlainText(s)), s);
	}
	return text => byText.get(_proseKey(text)) ?? plainTextToHtml(text);
}

/** A field value ready to draw as card markup: HTML as-is, legacy plain text as paragraphs. */
export function asCardHtml(value) {
	const s = String(value ?? "");
	return _HAS_TAG.test(s) ? s : plainTextToHtml(s);
}

/** True when a value has non-whitespace text. */
export function hasText(s) {
	return !!String(s ?? "").trim();
}

/** Trimmed, non-empty strings from a string-list system field. */
export function stringList(arr) {
	return (Array.isArray(arr) ? arr : []).map(String).filter(hasText);
}

/** The grim-portent doom rows ({index, text, done}); keeps a ticked-but-blank row. */
export function buildDoomRows(sys) {
	const grim = Array.isArray(sys.grimPortents) ? sys.grimPortents : [];
	return grim
		.map((p, index) => ({ index, text: String(p?.text ?? ""), done: !!p?.done }))
		.filter(r => hasText(r.text) || r.done);
}

/** The impending-doom line VM ({text, done, hasText}). */
export function buildImpending(sys) {
	return {
		text: String(sys.impendingDoom?.text ?? ""),
		done: !!sys.impendingDoom?.done,
		hasText: hasText(sys.impendingDoom?.text),
	};
}

/** Custom player-move cards with enriched prose; drops fully-blank rows. Async. */
export async function buildCustomPlayerMoves(sys, enrich) {
	const raw = Array.isArray(sys.customPlayerMoves) ? sys.customPlayerMoves : [];
	const out = [];
	for (const m of raw) {
		if (!hasText(m?.label) && !hasText(m?.text)) continue;
		out.push({ label: String(m?.label ?? ""), text: await enrich(asCardHtml(m?.text)) });
	}
	return out;
}

/** The card prose enricher: resolves @UUID links / inline rolls, hiding GM secret blocks. */
export function cardEnricher() {
	return (html) => enrichHTML(String(html ?? ""), { secrets: false });
}
