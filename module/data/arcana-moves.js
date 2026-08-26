import { capitalizeFirst, escHtml, slugify, stripHtmlToText } from "../utils/strings.js";

/**
 * The mysteries on an arcanum's BACK are moves — "choose one of the moves on the reverse"
 * (Book I p.437) — but they ship as prose inside one authored HTML blob, not as Items, so
 * nothing on the sheet treated them as moves: no name to click, no roll, no options to tick.
 * This module reads that blob back into move records so the arcana tab can give each one the
 * same affordances a playbook move has (click the name to post it, or to open its dialog).
 *
 * Deliberately a PARSER over the shipped prose rather than a new data shape on the card: the
 * 16 shipped major arcana are already authored, a homebrew card authored in the same house
 * style gets the behaviour for free, and the printed text stays the single source of truth
 * (no second copy of a move's options to drift out of step with the card you're reading).
 *
 * House style, as the shipped cards print it:
 *
 *     <h3>Moves</h3>
 *     <p><strong>□ EYE OF THE STORM</strong><br>When you <strong><em>…</em></strong>, roll +CON: …</p>
 *     <ul><li>…</li></ul>
 *
 * The name is SHOUTED — that is what tells a move head from the other bold runs in the same
 * section (a follower's name, "HP", "Tags:", "on a 10+"). A leading □ is the "learned" box;
 * a trailing ○○○ / ◇◇◇ run is the move's own charge track and is not part of its name.
 */

// A bold run that opens a paragraph — the only place a move name is printed. Captured in three
// parts so the name's offset inside the description is known (the □ index below needs it).
const _MOVE_HEAD_RE = /(<p\b[^>]*>\s*<strong>)([^<]*)(<\/strong>)/g;

// The learned box, and the charge-track glyphs that may trail a name ("STORM'S FURY ○○○○",
// "BATTERY ○ ____"). Underscores are the printed write-in rule on the same line.
const _LEARN_BOX = "□";
const _NAME_RE   = /^([A-Z0-9][A-Z0-9'’&.,\-! ]*?)\s*(?:[○◇_]|$)/;

// A move name is SHOUTED and has some substance to it: "HP", "Tags:" and a follower's
// "Astor" are bold runs in the same section that are not moves.
function _moveNameFrom(inner) {
	const rest = inner.replace(_LEARN_BOX, "").trim();
	const name = _NAME_RE.exec(rest)?.[1]?.trim() ?? "";
	if ((name.match(/[A-Z]/g) ?? []).length < 3) return "";
	return name;
}

// The "Moves" section of a back description: from its heading to the next heading (or the
// end). Same slice rule the front-side Consequences lift uses, for the same reason — it keeps
// nested lists intact without balanced-tag matching. Returns null when the card prints none.
const _MOVES_HEADING_RE = /<h([1-6])\b[^>]*>\s*Moves\s*<\/h\1>/i;

function _movesSection(description) {
	if (!description) return null;
	const m = _MOVES_HEADING_RE.exec(description);
	if (!m) return null;
	const start = m.index + m[0].length;
	const after = description.slice(start);
	const next  = after.search(/<h[1-6]\b/i);
	return { start, end: next >= 0 ? start + next : description.length };
}

/** Roll a move asks for: a stat key, or "nothing" for the book's "roll +nothing". */
const _ROLL_RE = /\broll\s*\+\s*(str|dex|con|int|wis|cha|nothing)\b/i;

/** The options list a move offers — the first <ul> in its block, one entry per <li>. */
function _picksFrom(blockHtml) {
	const ul = /<ul\b[^>]*>([\s\S]*?)<\/ul>/i.exec(blockHtml);
	if (!ul) return { picks: [], picksLabel: "", listHtml: "" };
	const picks = [...ul[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
		.map(m => stripHtmlToText(m[1]))
		.filter(Boolean);
	// What the prose calls the list, taken from the clause that introduces it ("choose 2 from
	// the list below", "Spend Guise, 1-for-1 to"). Long lead-ins fall back to a plain label
	// rather than dragging half a paragraph into the dialog's heading.
	const lead  = stripHtmlToText(blockHtml.slice(0, ul.index));
	const claim = /([^.;:]*\b(?:choose|pick|spend)\b[^.;:]*)[.;:]?\s*$/i.exec(lead)?.[1]?.trim() ?? "";
	const picksLabel = claim && claim.length <= 80
		? `${capitalizeFirst(claim)}:`
		: "Choose:";
	return { picks, picksLabel, listHtml: ul[0] };
}

/**
 * Every move printed on an arcanum's back, in the order the card prints them.
 *
 * @param {string} description  The card's raw `back.description` HTML.
 * @returns {{slug: string, name: string, boxIndex: number|null, description: string,
 *            roll: string|null, picks: string[], picksLabel: string}[]}
 *   `boxIndex` is the move's learned-box index within the back side's □ run — the same index
 *   {@link module:actors/character/CharacterArcana} writes under `boxes[`slug:back:i`]`, so a
 *   caller can tell a learned mystery from one still to come. null when the move prints no box.
 */
export function parseArcanumMoves(description) {
	const section = _movesSection(description);
	if (!section) return [];
	const body = description.slice(section.start, section.end);

	// Pass 1: every move head in the section, with the offset of its name inside the FULL
	// description (the □ index counts boxes across the whole back side, not just this section).
	const heads = [];
	_MOVE_HEAD_RE.lastIndex = 0;
	for (let m; (m = _MOVE_HEAD_RE.exec(body)); ) {
		const name = _moveNameFrom(m[2]);
		if (!name) continue;
		heads.push({
			name,
			blockStart: m.index,
			headEnd:    m.index + m[0].length,
			innerStart: section.start + m.index + m[1].length,
			hasBox:     m[2].includes(_LEARN_BOX),
		});
	}

	const usedSlugs = new Set();
	return heads.map((head, i) => {
		const block = body.slice(head.blockStart, heads[i + 1]?.blockStart ?? body.length);
		// The prose that follows the name: the rest of its opening paragraph plus whatever
		// runs on until the next move. Drop the <br> or dash that only separated name from
		// text, then re-open the paragraph the head's own <p> started.
		const tail = body.slice(head.headEnd, heads[i + 1]?.blockStart ?? body.length)
			.replace(/^\s*(?:<br\s*\/?>|[\u2014\u2013-])\s*/, "");
		const { picks, picksLabel, listHtml } = _picksFrom(block);
		// A slug per card, so two moves that shout the same name still address separately.
		let slug = slugify(head.name);
		for (let n = 2; usedSlugs.has(slug); n++) slug = `${slugify(head.name)}-${n}`;
		usedSlugs.add(slug);
		return {
			slug,
			name:        head.name,
			boxIndex:    head.hasBox
				? (description.slice(0, head.innerStart + description.slice(head.innerStart).indexOf(_LEARN_BOX))
					.match(/□/g) ?? []).length
				: null,
			description: `<p>${tail}`,
			roll:        _ROLL_RE.exec(stripHtmlToText(block))?.[1]?.toLowerCase() ?? null,
			picks,
			picksLabel,
			listHtml,
		};
	});
}

/** One move by slug, or null. */
export function findArcanumMove(description, moveSlug) {
	return parseArcanumMoves(description).find(m => m.slug === moveSlug) ?? null;
}

/**
 * Wrap each move's NAME in the back description with a clickable handle, so the arcana tab
 * renders a move head the way the moves tab renders a move title. Only the name is wrapped:
 * the learned □ and any trailing ○○○ track stay outside it, both so they keep their own
 * click behaviour and so the marker pass that follows still sees (and indexes) every glyph.
 *
 * @param {string} description  The card's raw `back.description` HTML.
 * @param {string} arcanumSlug  Card slug, carried on the handle for the sheet's handler.
 */
export function markArcanumMoveNames(description, arcanumSlug) {
	const moves = parseArcanumMoves(description);
	if (!moves.length) return description;
	const section = _movesSection(description);
	const byName = new Map(moves.map(m => [m.name, m]));
	const head = description.slice(0, section.start);
	const tail = description.slice(section.end);
	const body = description.slice(section.start, section.end).replace(_MOVE_HEAD_RE, (whole, open, inner, close) => {
		const move = byName.get(_moveNameFrom(inner));
		if (!move) return whole;
		// Replace only the name's own run of characters — `inner` is plain text (the capture
		// stops at the next `<`), so a plain indexOf split is exact and nothing is escaped
		// twice. The attributes carry authored slugs, but escape them anyway: a homebrew
		// card's name is user input all the way down.
		const at = inner.indexOf(move.name);
		return `${open}${inner.slice(0, at)}<span class="stonetop-arcanum-move-name"`
			+ ` data-arcanum-slug="${escHtml(arcanumSlug)}" data-move-slug="${escHtml(move.slug)}"`
			+ ` role="button" tabindex="0">${inner.slice(at, at + move.name.length)}</span>`
			+ `${inner.slice(at + move.name.length)}${close}`;
	});
	return head + body + tail;
}
