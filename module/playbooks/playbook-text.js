// HOMEBREW PLAYBOOK TEXT: what a GM types (or a PDF / shared JSON hands us) for a homebrew
// playbook's backgrounds, possessions, lore and moves, turned into the HTML those fields are
// stored as, and back.
//
// THE STORED FORM IS RENDERED RAW. Onboarding draws a background's or a lore option's text with
// a triple-stache (templates/dialogs/character-onboarding.hbs), because the book's own entries
// carry <em> and <ul>. So nothing imported may ever be stored as it came: a shared JSON file is
// someone else's text, and a `<script>` or an `onerror=` in it would run in every player's
// browser. Everything goes through the audited escaper (utils/strings.js escHtml) FIRST, and the
// only markup that can come out afterwards is what this file adds: <p>, <br>, <ul>/<li>, and
// <strong>/<em> from the custom-move asterisks (***trigger***, **bold**, *italic*).
//
// Authoring rules, the same as a custom move's plus bullet lists:
//   - a blank line starts a new paragraph;
//   - a line starting "- ", "* " or "• " is a bullet; consecutive ones make one list;
//   - ***text*** is a move trigger (bold italic), **bold**, *italic*.

import { clipText } from "../utils/strings.js";
import { formatCustomMoveDescription, customMoveDescriptionToPlainText } from "../utils/custom-move-text.js";

const BULLET = /^\s*(?:[-*•])\s+/;

/** Inline emphasis on already-escaped text: reuse the custom-move formatter's, minus its <p>. */
function _inline(raw) {
	const html = formatCustomMoveDescription(String(raw ?? "").replace(/\n+/g, " "));
	return html.replace(/^<p>/, "").replace(/<\/p>$/, "");
}

/**
 * One line of text, escaped, with emphasis: for a label or a lore option, stored as HTML and
 * drawn raw, but never a paragraph.
 */
export function formatPlaybookInline(raw) {
	const text = String(raw ?? "").replace(/\s+/g, " ").trim();
	return text ? _inline(text) : "";
}

/**
 * A block of text (a background, a move, a lore prompt) as paragraphs and bullet lists.
 */
export function formatPlaybookText(raw) {
	const text = String(raw ?? "").replace(/\r\n?/g, "\n").trim();
	if (!text) return "";
	const out = [];
	for (const block of text.split(/\n\s*\n/)) {
		const lines = block.split("\n");
		let para = [];
		let list = [];
		const flushPara = () => {
			if (para.length) out.push(`<p>${para.map(_inline).join("<br>")}</p>`);
			para = [];
		};
		const flushList = () => {
			if (list.length) out.push(`<ul>${list.map(l => `<li>${_inline(l)}</li>`).join("")}</ul>`);
			list = [];
		};
		for (const line of lines) {
			if (BULLET.test(line)) {
				flushPara();
				list.push(line.replace(BULLET, "").trim());
			} else if (line.trim()) {
				flushList();
				para.push(line.trim());
			}
		}
		flushPara();
		flushList();
	}
	return out.join("");
}

/**
 * Back to the text a GM would type: the inverse of formatPlaybookText (and of formatPlaybookInline),
 * for the builder's text boxes and for a JSON export. Reads the shipped playbooks' HTML too, so a
 * GM can start a homebrew playbook from a copy of a book one.
 */
export function playbookTextFromHtml(html) {
	const withBullets = String(html ?? "")
		.replace(/<\s*ul[^>]*>/gi, "\n\n")
		.replace(/<\s*\/\s*ul\s*>/gi, "\n\n")
		.replace(/<\s*li[^>]*>/gi, "\n- ")
		.replace(/<\s*\/\s*li\s*>/gi, "");
	return customMoveDescriptionToPlainText(withBullets)
		.replace(/\n[ \t]+- /g, "\n- ")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/(^|\n)- ([^\n]*)\n\n(?=- )/g, "$1- $2\n")
		.trim();
}

/** One line of plain text (no markup at all), for the fields drawn escaped: instincts, appearance, names. */
export function plainLine(raw, max = 200) {
	return clipText(String(raw ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(), max);
}


/**
 * A playbook's name, read off its file name: "Stonetop_Abhorsen v_3.pdf" is "Abhorsen", "lexchxn -
 * The Familiar Face - v1.0.0.pdf" is "The Familiar Face". The system's name, "playbook", a version
 * and a part that is only the creator's handle are left out. Empty when nothing is left.
 */
export function playbookNameFromFileName(fileName) {
	const stem = String(fileName ?? "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
	const version = /^v(?:ersion)?\s*\d[\w.]*$/i;
	const clean = part => part
		.replace(/\b(?:stonetop|playbook|pdf|final|print)\b/gi, " ")
		.replace(/\bv(?:ersion)?\s*\d[\w.]*\s*$/i, " ")
		.replace(/\s+/g, " ").trim();
	const parts = stem.split(/\s+-\s+/).map(clean).filter(p => p && !version.test(p));
	// Several parts ("handle - Name - v1"): the one that reads like a playbook's name.
	const named = parts.find(p => /^the\s/i.test(p)) ?? parts.find(p => /\s/.test(p) || /^[A-Z]/.test(p)) ?? parts[0] ?? "";
	return named.replace(/^./, c => c.toUpperCase()).slice(0, 60);
}
