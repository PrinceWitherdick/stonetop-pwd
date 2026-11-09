import { hasText } from "../actors/bestiary/codex.js";
import { slugify, escHtml } from "../utils/strings.js";
import { maskGlyphLabels } from "../utils/glyphs.js";
import { movesSection } from "../data/arcana-moves.js";
import { arcanumHasUnlockStep, consequencesSection } from "../actors/character/CharacterArcana.js";

// The editor's unlock-step check is the sheet's own; re-exported for the editor's callers.
export { arcanumHasUnlockStep };

// Pure helpers for the arcanum editor (StonetopArcanumSheet edit mode). Kept free of
// Foundry/DOM so they're unit-testable; the sheet wires them to controls + item.update().

/** A blank carried-item line (front.item / back.item). */
export function defaultArcanumItemLine() {
	return { name: "", weight: null, note: "", inventoryColumn: null };
}

/** A blank resource track (back.resource / item.resource). */
export function defaultResourceDef() {
	return { max: 3, maxStat: null, title: "", labels: [] };
}

/** A blank condensed back move. */
export function defaultBackMove() {
	return { name: "", rollType: null, description: "" };
}

/** A blank manifested follower (the buildCustomFollower input shape the summon button uses). */
export function defaultFollower() {
	return {
		name: "", pronoun: "it", typeLabel: "follower", tags: "",
		hp: 6, armor: 0, damage: "", instinct: "", moves: "", cost: "",
		loyalty: 0, notes: "", repeatable: false,
	};
}

/** A fresh unlock requirement row of the given kind. */
export function newUnlockRequirement(type = "option", slug = "") {
	return type === "text"
		? { type: "text", content: "" }
		: { type: "option", slug, description: "", max: 1 };
}

/**
 * A stable, unique option slug for a new unlock-requirement option, given the slugs
 * already used on the card. Prefers "option-1", "option-2", … Option slugs key the
 * per-character unlock-count flag, so they must stay stable once in use.
 */
export function nextOptionSlug(takenSlugs = []) {
	const taken = takenSlugs instanceof Set ? takenSlugs : new Set(takenSlugs);
	let n = 1;
	while (taken.has(`option-${n}`)) n++;
	return `option-${n}`;
}

/**
 * Rebuild an option slug from its description when the author hasn't set one explicitly.
 * Falls back to a unique "option-N" so the slug is never empty (an empty slug would
 * collide with other blank options in the per-character unlock-count flag).
 */
export function ensureOptionSlug(slug, description, takenSlugs = []) {
	const cleaned = slugify(slug);
	if (cleaned) return cleaned;
	return slugify(description) || nextOptionSlug(takenSlugs);
}

// ── Major-mode authoring snippets ─────────────────────────────────────────────
// Guided HTML blocks the editor appends for the major-arcanum pattern. Pure + testable;
// the load-bearing glyphs (○ unlock track, □ mystery/consequence boxes) are emitted as
// literal runs so the character-sheet marker pipeline turns them into checkboxes.

/** The unlock "consequence" mark track: N circles + the canonical "make the last mark" lead. */
export function markTrackHtml(n = 4) {
	const count = Math.max(1, Math.min(9, Math.round(Number(n) || 4)));
	const circles = "○".repeat(count);
	return `<p>${circles} Each time you mark 1, ask the GM how the power grows harder to control. `
		+ `When you make the last mark, you unlock the mysteries—choose one of the moves on the reverse, and erase all marks above.</p>`;
}

/** A reverse-side mystery move block, led by a □ box the player checks to choose it. */
export function mysteryHtml(name = "NEW MYSTERY") {
	// escHtml because the result is appended into back.description and rendered via a
	// triple-stache ({{{...}}}) on the card — any author-supplied name must not inject HTML.
	const safe = escHtml(String(name || "NEW MYSTERY").trim() || "NEW MYSTERY");
	return `<p><strong>□ ${safe}</strong><br>When you <strong><em>do something specific</em></strong>, `
		+ `describe the effect. On a 10+, choose 2; on a 7&ndash;9, choose 1.</p>`;
}

/**
 * A consequence line weighted with 1-3 □ boxes (the cost it occupies on the track), as a list
 * item: the shipped majors print their Consequences as a `<ul>` of `<li>□ ...</li>`, the shape the
 * ladder, the curse badge and the nested gates read.
 */
export function consequenceHtml(weight = 1) {
	const w = Math.max(1, Math.min(3, Math.round(Number(weight) || 1)));
	return `<li>${"□".repeat(w)} Describe the consequence the bearer suffers.</li>`;
}

// The two back sections are found by the sheet's own parsers: a "Moves" (or "Move") heading opens
// the clickable mysteries (data/arcana-moves.js#movesSection), a "Consequences" heading the marked
// costs (CharacterArcana.js#consequencesSection). Each runs to the next heading of any level, or the end.

/** Offset (within `body`) of the closing tag of the LAST top-level `<ul>`, or -1 when there is none. */
function _lastTopListClose(body) {
	let depth = 0;
	let close = -1;
	for (const m of body.matchAll(/<(\/?)ul\b[^>]*>/gi)) {
		if (!m[1]) { depth++; continue; }
		if (depth === 0) continue;
		depth--;
		if (depth === 0) close = m.index;
	}
	return close;
}

/**
 * How many back □ come before `offset` in `html`, counted as the sheet indexes the back's checkboxes
 * (one per glyph, display-only labels skipped): the index a □ inserted at `offset` takes.
 */
function _boxesBefore(html, offset) {
	return (maskGlyphLabels(html.slice(0, offset)).match(/□/g) || []).length;
}

/** `html` with `block` set in at `offset`, the index its first □ takes (`at`) and how many □ it adds (`by`). */
function _insertBlock(html, offset, block) {
	return {
		html: html.slice(0, offset) + block + html.slice(offset),
		at:   _boxesBefore(html, offset),
		by:   _boxesBefore(block, block.length),
	};
}

/**
 * The back description with one more mystery in it, inside its Moves section, and the index its
 * □ takes (`at`). The section is made the first time (`<h3>Moves</h3>`, set before the Consequences
 * heading when there is one, the order every shipped major prints them in), so the mystery's □ and
 * name are a move the sheet can click and learn, not prose after the costs. Every back □ from `at`
 * on moves `by` (one) index along: holders' marks follow with shiftHolderBackMarks.
 */
export function insertMystery(description, name) {
	const html  = String(description ?? "");
	const block = mysteryHtml(name);
	const moves = movesSection(html);
	if (moves) return _insertBlock(html, moves.end, block);
	const section = `<h3>Moves</h3>${block}`;
	const cons = consequencesSection(html);
	if (cons) return _insertBlock(html, cons.index, section);
	return _insertBlock(html, html.length, section);
}

/** insertMystery's description alone. */
export function insertMysteryHtml(description, name) {
	return insertMystery(description, name).html;
}

/**
 * The back description with one more Consequence, as a `<li>` at the end of the list under its
 * Consequences heading, and the index its first □ takes (`at`). The heading and list are made the
 * first time, at the end of the back.
 */
export function insertConsequence(description, weight = 1) {
	const html = String(description ?? "");
	const item = consequenceHtml(weight);
	const cons = consequencesSection(html);
	if (!cons) return _insertBlock(html, html.length, `<h3>Consequences</h3><ul>${item}</ul>`);
	const { start } = cons;
	const end   = start + cons.body.length;
	const close = _lastTopListClose(cons.body);
	if (close >= 0) return _insertBlock(html, start + close, item);
	return _insertBlock(html, end, `<ul>${item}</ul>`);
}

/** insertConsequence's description alone. */
export function insertConsequenceHtml(description, weight = 1) {
	return insertConsequence(description, weight).html;
}

/**
 * The Consequences section of a back, counted the way the sheet counts it: each run of □ is one
 * consequence, each □ one checkbox. Null when the back has no Consequences heading.
 */
export function consequenceTally(backDescription) {
	const cons = consequencesSection(maskGlyphLabels(backDescription ?? ""));
	if (!cons) return null;
	return { consequences: (cons.body.match(/□+/g) ?? []).length, boxes: (cons.body.match(/□/g) ?? []).length };
}

/**
 * Validate a card's `flags.stonetop` payload for the editor's status line. Errors block a
 * "complete" card; warnings are advisory. Pure — returns an ordered list of issues.
 */
export function validateArcanumFlags(flags) {
	const f = flags ?? {};
	const issues = [];
	const front = f.front ?? {};
	const back  = f.back ?? {};

	if (!String(f.slug ?? "").trim())        issues.push({ level: "error", message: "Slug is required (it identifies the card and keys saved marks)." });
	if (!String(front.title ?? "").trim())   issues.push({ level: "error", message: "Front title is required." });

	const hasFrontBody = hasText(front.description)
		|| hasText(front.unlock?.description)
		|| (front.unlock?.requirements ?? []).length > 0;
	if (!hasFrontBody) issues.push({ level: "warn", message: "The front has no description, unlock text, or requirements." });

	if (!String(back.title ?? "").trim()) issues.push({ level: "warn", message: "The back (revealed power) has no title." });

	const hasPayoff = hasText(back.description) || !!back.move || !!back.item || !!back.resource;
	if (!hasPayoff) issues.push({ level: "warn", message: "The back has no payoff yet: add a description, move, item, or resource track." });

	// Book I p.444: a minor is unlocked by "a series of checkbox steps". With none, nothing a player
	// does can unlock the card, so it waits on the GM's reveal.
	if (!arcanumHasUnlockStep(f)) {
		issues.push({ level: "warn", message: "Nothing on the front unlocks this card yet: add an unlock option, a ○ track or □ boxes in the unlock text, or □ tasks on the front. Until then it stays locked until the GM reveals it." });
	}

	// Book I p.446, advice for majors, never a block: "Create 5-10 consequences ... A major arcanum
	// should have ~8 checkboxes total."
	if (f.major) {
		const tally     = consequenceTally(back.description);
		const backBoxes = (maskGlyphLabels(back.description ?? "").match(/□/g) ?? []).length;
		if (!tally && backBoxes) {
			issues.push({ level: "warn", message: "The back has □ boxes but no Consequences heading, so the sheet can't count them as Consequences. Use the Consequence buttons to add them." });
		} else if (tally) {
			if (tally.consequences < 5 || tally.consequences > 10) {
				issues.push({ level: "warn", message: `The book suggests 5-10 Consequences for a major arcanum (Book I p.446); this one has ${tally.consequences}.` });
			}
			if (tally.boxes < 6 || tally.boxes > 10) {
				issues.push({ level: "warn", message: `The book suggests about 8 Consequence checkboxes in all (Book I p.446); this one has ${tally.boxes}.` });
			}
		}
	}

	return issues;
}
