// Player-authored custom-move descriptions are authored as PLAIN TEXT (v1 / Tier
// 0). They render RAW on the sheet (triple-stache `{{{ }}}`) and in chat, so they
// must never carry live markup — otherwise a player could inject script into the
// GM's / other players' browsers. formatCustomMoveDescription escapes the text (via
// the shared, audited escHtml) and wraps it into paragraphs for storage;
// customMoveDescriptionToPlainText reverses that — including every entity escHtml can
// emit — so the edit form shows the author's plain text, not stored HTML, and the
// pair round-trips losslessly.

import { escHtml } from "./strings.js";

export function formatCustomMoveDescription(raw) {
	const text = String(raw ?? "").trim();
	if (!text) return "";
	return text
		.split(/\n{2,}/)
		.map((para) => `<p>${escHtml(para).replace(/\n/g, "<br>")}</p>`)
		.join("");
}

export function customMoveDescriptionToPlainText(html) {
	// Deliberately NOT stripHtmlToText: this round-trips into a textarea, so the line structure
	// is the point — the shared helper collapses every run of whitespace to a single space.
	return String(html ?? "")
		.replace(/<\s*br\s*\/?>/gi, "\n")
		.replace(/<\/\s*p\s*>/gi, "\n\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&amp;/g, "&") // must be last: reverses the escape applied first
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
