import { capitalizeFirst, escHtml, slugify, stripHtmlToText } from "../utils/strings.js";
import { pickLimitsFrom } from "../utils/move-picks.js";
import { firstOptionList } from "../utils/chat.js";
import { normalizeRollType } from "../utils/roll-types.js";

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
//
// The heading is singular on a card that grants just one: the Hec'tumel Codex prints "Move" over
// DARKSOME VESSEL, which a plural-only match left as unclickable prose. "Spells of the Codex" stays
// out on purpose: its entries are cast through the front's Cast a Codex Spell, not moves of their
// own, and their names are not SHOUTED, so the head walk would find nothing there anyway.
const _MOVES_HEADING_RE = /<h([1-6])\b[^>]*>\s*Moves?\s*<\/h\1>/i;

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

/**
 * A move whose 6- says "don't mark XP" (the Timeless Vault's runes, Book II p.518: "on a 6-, ... (and
 * don't mark XP)"). Read off the printed text, since a card carries no field for it and a homebrew card
 * says it the same way; the shipped arcana use the phrase for nothing else.
 */
const _NO_XP_RE = /\b(?:don['’]t|do not)\s+mark\s+XP\b/i;
const _noXpOnMiss = html => _NO_XP_RE.test(stripHtmlToText(String(html ?? "")));

/**
 * The options list a move offers — the first <ul> in its block, one entry per <li>.
 *
 * Through `firstOptionList` (utils/chat.js), which is where "what is a move's printed option
 * list" is decided for the whole system and whose docblock names THIS function as the reading
 * it matches. Two copies of the same pair of regexes plus the offset arithmetic on both sides
 * of one rule is how the two ends up disagreeing.
 *
 * It is slightly stricter than the local regexes were, both ways that matter here: it skips a
 * tier-ladder `<ul>` (never a choice, wherever it lands) and refuses a nested list rather than
 * flattening one. Neither can turn a real list of options into no list.
 */
function _picksFrom(blockHtml) {
	const list = firstOptionList(blockHtml);
	if (!list) return { picks: [], picksLabel: "", listHtml: "", pickMax: 0 };
	const picks = list.items.map(stripHtmlToText).filter(Boolean);
	// What the prose calls the list, taken from the clause that introduces it ("choose 2 from
	// the list below", "Spend Guise, 1-for-1 to"). Long lead-ins fall back to a plain label
	// rather than dragging half a paragraph into the dialog's heading.
	const lead  = stripHtmlToText(blockHtml.slice(0, list.index));
	const claim = /([^.;:]*\b(?:choose|pick|spend)\b[^.;:]*)[.;:]?\s*$/i.exec(lead)?.[1]?.trim() ?? "";
	const picksLabel = claim && claim.length <= 80
		? `${capitalizeFirst(claim)}:`
		: "Choose:";
	// How many of the list the mystery allows, out of that same lead-in and through the same
	// timid reader every other move's count goes through (utils/move-picks.js). A mystery makes
	// its choice in a DIALOG rather than on a chat card, so this is what gives the tally over
	// those boxes its denominator — the one number, read the one way, on either surface.
	//
	// A tiered answer collapses to its HIGHEST count. Two shipped mysteries state a count per
	// result (the Azure Hand's Eye of the Storm, "on a 10+ … choose 2 … on a 7-9 … choose 1"; the
	// Demonhide Cloak's The Flesh Remembers, "on a 7-9, choose 1"), and the dialog they are picked
	// in posts BEFORE the dice — so at the moment the boxes are ticked, which tier applies is not
	// yet known. The most generous tier is the only cap that cannot be wrong in the direction that
	// matters: too loose lets a player tick one box more than their roll turned out to allow, and
	// the move's own text beside them still says so; too tight would refuse them what a strong hit
	// plainly grants. Taking nothing at all (which this used to do) just loses the denominator.
	const limits  = pickLimitsFrom(lead);
	const pickMax = typeof limits === "number"
		? limits
		: Math.max(0, ...Object.values(limits ?? {}).map(n => Math.trunc(Number(n)) || 0));
	return { picks, picksLabel, listHtml: blockHtml.slice(list.index, list.index + list.length), pickMax };
}

/**
 * Every move printed on an arcanum's back, in the order the card prints them.
 *
 * @param {string} description  The card's raw `back.description` HTML.
 * @returns {{slug: string, name: string, boxIndex: number|null, description: string,
 *            roll: string|null, picks: string[], picksLabel: string, pickMax: number}[]}
 *   `boxIndex` is the move's learned-box index within the back side's □ run — the same index
 *   {@link module:actors/character/CharacterArcana} writes under `boxes[`slug:back:i`]`, so a
 *   caller can tell a learned mystery from one still to come. null when the move prints no box.
 */
export function parseArcanumMoves(description) {
	const key = String(description ?? "");
	const hit = _MOVES_CACHE.get(key);
	if (hit !== undefined) return hit;
	const built = _parseArcanumMoves(description);
	if (_MOVES_CACHE.size >= _MOVES_CACHE_MAX) _MOVES_CACHE.clear();
	_MOVES_CACHE.set(key, built);
	return built;
}

/**
 * Parsed backs, keyed by the description they were parsed from.
 *
 * THREE CALLERS, ALL HOT. `markArcanumMoveNames` parses the card it was just handed and then
 * walks the same heads a second time; `findArcanumMove` parses a whole card on every click and
 * throws away all but one row; and both run out of `CharacterArcana.buildSnapshot`, i.e. once
 * per owned arcanum on every character-sheet render — and AppV1 sheets re-render on every actor
 * update. The parse is a section slice, a head walk, a `_picksFrom` per move and a multi-KB
 * substring per box index.
 *
 * Safe to cache: descriptions are pack or item strings, and nothing here mutates a document.
 * The returned array is shared between callers, so treat it as read-only — every caller today
 * reads or `.find()`s it.
 *
 * Cleared wholesale at the cap rather than evicted one at a time, for the reason move-tiers.js
 * gives: the bound exists only so homebrew cannot grow it without limit.
 */
const _MOVES_CACHE = new Map();
const _MOVES_CACHE_MAX = 200;

function _parseArcanumMoves(description) {
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
		const { picks, picksLabel, listHtml, pickMax } = _picksFrom(block);
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
			noXpOnMiss:  _noXpOnMiss(block),
			picks,
			picksLabel,
			pickMax,
			listHtml,
		};
	});
}

/** One move by slug, or null. */
export function findArcanumMove(description, moveSlug) {
	return parseArcanumMoves(description).find(m => m.slug === moveSlug) ?? null;
}

/**
 * The handle slug of a card's CONDENSED move: the structured `back.move` a minor arcanum carries
 * (trigger + effect), as opposed to the mysteries parsed out of the back's prose. Not a slug
 * `slugify` can mint from a SHOUTED name, so it can never shadow a mystery.
 */
export const CONDENSED_MOVE_SLUG = "~condensed";

/**
 * A card's condensed move in the same record shape `parseArcanumMoves` returns, so a click on it
 * takes the mysteries' path: a dialog when it rolls or offers a list, a chat card when it doesn't.
 *
 * The stat comes from the card's own `rollType` (what the editor sets), and failing that from the
 * text ("roll +INT"), the way a mystery's does: most shipped minors say it only in the prose.
 *
 * @param {{name?: string, rollType?: *, description?: string}|null} move  `back.move`
 * @returns {object|null}
 */
export function condensedArcanumMove(move, { backDescription = "" } = {}) {
	if (!move || !(String(move.name ?? "").trim() || String(move.description ?? "").trim())) return null;
	const description = String(move.description ?? "");
	const roll = normalizeRollType(move.rollType)?.toLowerCase()
		?? _ROLL_RE.exec(stripHtmlToText(description))?.[1]?.toLowerCase()
		?? null;
	// "Don't mark XP" from the move's own fields, its own text, or the back's full prose when that prose is this
	// one move written out at length (no mysteries section): the Timeless Vault's condensed text leaves the
	// clause out, and only its back says it.
	const noXpOnMiss = move.noXpOnMiss === true || _noXpOnMiss(description)
		|| (!!backDescription && !_movesSection(String(backDescription)) && _noXpOnMiss(backDescription));
	return {
		slug: CONDENSED_MOVE_SLUG,
		name: String(move.name ?? "").trim(),
		boxIndex: null,
		description,
		roll,
		noXpOnMiss,
		..._picksFrom(description),
	};
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

// -- Front-side moves ---------------------------------------------------------------------------------

/**
 * The moves printed on a card's FRONT that roll a stat: "When you <strong><em>brandish the Azure Hand
 * at a source of elemental energy</em></strong>, roll +CON: on a 10+ ...". Mind Over Magic reads "When
 * you roll to study or use an arcanum, you can roll +INT instead of the stat you'd normally roll", and
 * these are the rolls that USE one, so each gets a handle like a mystery's name: the same dialog, the
 * printed stat's button, and Mind Over Magic's +INT beside it.
 *
 * A front move has no learned box. It is the card's to use as soon as its owner can read the front.
 *
 * Read off the same prose the back's mysteries are, in the house style the shipped fronts print:
 *  - the ROLL is "roll +STAT" (or "rolling +STAT", the Makerglass Chime) anywhere outside a list item,
 *    since a list item that rolls is one of a move's options (the Azure Hand's "Fling the energy,
 *    rolling +INT to Let Fly"), not a move;
 *  - the HANDLE is the last bold-italic trigger before the roll in its paragraph, or, when that
 *    paragraph prints none, in the nearest paragraph before it (the Ice Sphere asks its question in
 *    one paragraph and rolls in a later one); with no trigger at all (an unlock lead, a requirement
 *    line) it is the "roll +STAT" itself;
 *  - the NAME is a SHOUTED head opening the paragraph ("CAST A CODEX SPELL", "INFLAME"), else the
 *    trigger, else `fallbackName` (the card's title);
 *  - the TEXT runs from the move's paragraph to the next paragraph that opens with another trigger or
 *    a bold head (an "On a 6-" head is the move's own), or the next heading, and stops after a later
 *    paragraph that prints the move's 6- (the Mindgem goes on to its body's tasks after it).
 *
 * The handle wraps plain text only, so the □/○/◇ that the marker pass indexes are left exactly where
 * they were, on either side.
 */
const _FRONT_ROLL_RE    = /\broll(?:s|ing)?\s*\+\s*(str|dex|con|int|wis|cha|nothing)\b/gi;
const _FRONT_TRIGGER_RE = /<strong>\s*<em>([^<]+)<\/em>\s*<\/strong>/g;
const _HAS_TRIGGER_RE   = /<strong>\s*<em>[^<]+<\/em>\s*<\/strong>/;
const _PARA_OPEN_RE     = /<p\b[^>]*>/gi;

// Whether `at` sits inside an <li> (more opened than closed before it).
function _insideListItem(html, at) {
	const before = html.slice(0, at);
	return (before.match(/<li\b/gi) ?? []).length > (before.match(/<\/li>/gi) ?? []).length;
}

// Every paragraph's [start, end) in the html; text outside any <p> is one span of its own.
function _paragraphs(html) {
	const out = [];
	_PARA_OPEN_RE.lastIndex = 0;
	for (let m; (m = _PARA_OPEN_RE.exec(html)); ) {
		const close = html.indexOf("</p>", m.index);
		out.push({ start: m.index, end: close < 0 ? html.length : close + 4 });
	}
	return out;
}

// The last trigger printed in html[from, to), as {text, start, end} offsets of its plain text.
function _lastTrigger(html, from, to) {
	let found = null;
	_FRONT_TRIGGER_RE.lastIndex = 0;
	for (let m; (m = _FRONT_TRIGGER_RE.exec(html)); ) {
		if (m.index < from) continue;
		if (m.index + m[0].length > to) break;
		const start = m.index + m[0].indexOf(m[1]);
		found = { text: m[1].trim(), start, end: start + m[1].length };
	}
	return found;
}

// Where a front move's text ends: see parseArcanumFrontMoves.
function _frontMoveEnd(html, paras, first) {
	let end = html.length;
	for (let i = first + 1; i < paras.length; i++) {
		const p = html.slice(paras[i].start, paras[i].end);
		const opensBold = /^<p\b[^>]*>\s*<strong>(?!\s*on a\b)/i.test(p);
		if (opensBold || _HAS_TRIGGER_RE.test(p)) { end = paras[i].start; break; }
	}
	const heading = html.slice(paras[first].end, end).search(/<h[1-6]\b/i);
	if (heading >= 0) end = paras[first].end + heading;
	if (/6-/.test(html.slice(paras[first].start, paras[first].end))) return end;
	for (let i = first + 1; i < paras.length && paras[i].start < end; i++) {
		if (/6-/.test(html.slice(paras[i].start, paras[i].end))) return paras[i].end;
	}
	return end;
}

/**
 * Every rolling move printed in one stretch of a card's front (its description, its unlock lead, or
 * one unlock requirement's line), in card order.
 *
 * @param {string} html  the raw front text
 * @param {{prefix?: string, fallbackName?: string}} [o]  `prefix` starts each slug (`${prefix}:${n}`),
 *   which says which stretch of the front the move is in (FRONT_MOVE_PREFIX)
 * @returns {{slug: string, name: string, boxIndex: null, description: string, roll: string,
 *            front: true, handle: {start: number, end: number}}[]}  `handle` is the offsets of the
 *   plain text the tab wraps
 */
export function parseArcanumFrontMoves(html, { prefix = FRONT_MOVE_PREFIX.front, fallbackName = "" } = {}) {
	const text = String(html ?? "");
	const key = `${prefix}\u0000${fallbackName}\u0000${text}`;
	const hit = _MOVES_CACHE.get(key);
	if (hit !== undefined) return hit;
	const built = _parseArcanumFrontMoves(text, prefix, fallbackName);
	if (_MOVES_CACHE.size >= _MOVES_CACHE_MAX) _MOVES_CACHE.clear();
	_MOVES_CACHE.set(key, built);
	return built;
}

function _parseArcanumFrontMoves(text, prefix, fallbackName) {
	if (!text) return [];
	let paras = _paragraphs(text);
	// A stretch printed without paragraphs (an unlock lead, a requirement line) is one.
	if (!paras.length) paras = [{ start: 0, end: text.length }];
	const moves = [];
	const usedParas = new Set();
	_FRONT_ROLL_RE.lastIndex = 0;
	for (let m; (m = _FRONT_ROLL_RE.exec(text)); ) {
		if (_insideListItem(text, m.index)) continue;
		let at = paras.findIndex(p => m.index >= p.start && m.index < p.end);
		if (at < 0) continue;
		let trigger = _lastTrigger(text, paras[at].start, m.index);
		// No trigger in the roll's own paragraph: the move's trigger is the nearest one printed before
		// it, as long as no other move's roll stands in between.
		if (!trigger) {
			for (let i = at - 1; i >= 0 && !usedParas.has(i); i--) {
				const t = _lastTrigger(text, paras[i].start, paras[i].end);
				if (t) { trigger = t; at = i; break; }
			}
		}
		if (usedParas.has(at)) continue;
		usedParas.add(at);
		const para = text.slice(paras[at].start, paras[at].end);
		const head = /^<p\b[^>]*>\s*<strong>([^<]*)<\/strong>/i.exec(para);
		const shouted = head ? _moveNameFrom(head[1]) : "";
		const end = _frontMoveEnd(text, paras, at);
		const handle = trigger
			? { start: trigger.start, end: trigger.end }
			: { start: m.index, end: m.index + m[0].length };
		const block = text.slice(paras[at].start, end);
		moves.push({
			slug:        `${prefix}:${moves.length}`,
			name:        shouted || capitalizeFirst(trigger?.text ?? "") || String(fallbackName ?? "").trim() || "Arcanum move",
			boxIndex:    null,
			description: block,
			roll:        m[1].toLowerCase(),
			noXpOnMiss:  _noXpOnMiss(block),
			front:       true,
			handle,
			..._picksFrom(block),
		});
	}
	return moves;
}

/**
 * Which stretch of a card's front a front move's slug points into: `~front:n` the description,
 * `~unlock:n` the unlock lead, `~req:<option slug>:n` one unlock requirement. None can be minted by
 * `slugify`, so a front move never shadows a mystery or the condensed move.
 */
export const FRONT_MOVE_PREFIX = Object.freeze({ front: "~front", unlock: "~unlock", req: "~req" });

/** Whether a move slug is a front move's (FRONT_MOVE_PREFIX). */
export function isArcanumFrontMoveSlug(moveSlug) {
	return /^~(?:front|unlock|req):/.test(String(moveSlug ?? ""));
}

/**
 * One front move by slug, off a card's `front`, or null.
 *
 * @param {{title?: string, description?: string, unlock?: {description?: string, requirements?: object[]}}} front
 * @param {string} moveSlug
 */
export function findArcanumFrontMove(front, moveSlug) {
	const slug = String(moveSlug ?? "");
	if (!front || !isArcanumFrontMoveSlug(slug)) return null;
	const fallbackName = front.title ?? "";
	const find = (html, prefix) => parseArcanumFrontMoves(html, { prefix, fallbackName }).find(m => m.slug === slug) ?? null;
	if (slug.startsWith(`${FRONT_MOVE_PREFIX.front}:`))  return find(front.description, FRONT_MOVE_PREFIX.front);
	if (slug.startsWith(`${FRONT_MOVE_PREFIX.unlock}:`)) return find(front.unlock?.description, FRONT_MOVE_PREFIX.unlock);
	for (const req of front.unlock?.requirements ?? []) {
		if (req?.type !== "option" || !req.slug) continue;
		const prefix = `${FRONT_MOVE_PREFIX.req}:${req.slug}`;
		if (slug.startsWith(`${prefix}:`)) return find(req.description, prefix);
	}
	return null;
}

/**
 * Wrap each front move's handle (parseArcanumFrontMoves) in the same clickable span a mystery's name
 * gets, so the tab's one click handler opens either. Wraps plain text only: no glyph moves.
 *
 * @param {string} html  the raw front text
 * @param {string} arcanumSlug
 * @param {{prefix?: string, fallbackName?: string}} [o]  as parseArcanumFrontMoves
 */
export function markArcanumFrontMoves(html, arcanumSlug, o = {}) {
	const moves = parseArcanumFrontMoves(html, o);
	if (!moves.length) return html;
	let out = String(html);
	for (const move of [...moves].sort((a, b) => b.handle.start - a.handle.start)) {
		const { start, end } = move.handle;
		out = `${out.slice(0, start)}<span class="stonetop-arcanum-move-name"`
			+ ` data-arcanum-slug="${escHtml(arcanumSlug)}" data-move-slug="${escHtml(move.slug)}"`
			+ ` role="button" tabindex="0">${out.slice(start, end)}</span>${out.slice(end)}`;
	}
	return out;
}
