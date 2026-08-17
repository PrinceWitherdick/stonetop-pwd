import { hasText } from "../actors/bestiary/codex.js";
import { slugify, escHtml } from "../utils/strings.js";

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

/** A consequence line weighted with 1–3 □ boxes (the cost it occupies on the track). */
export function consequenceHtml(weight = 1) {
	const w = Math.max(1, Math.min(3, Math.round(Number(weight) || 1)));
	return `<p>${"□".repeat(w)} Describe the consequence the bearer suffers.</p>`;
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

	return issues;
}
