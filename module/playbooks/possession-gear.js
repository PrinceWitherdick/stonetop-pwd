// WHAT A HOMEBREW SPECIAL POSSESSION'S WORDS GIVE A CHARACTER, in the book's own shapes: its uses
// ("Poisoner's kit (○○○ uses): …") as the possession's `resource`, and the gear it lists ("spades,
// ◇ shovel (close, clumsy, forceful), incense, …, etc.") as `grantsItems`, which the sheet puts in
// the inventory when the possession is picked (possession-grants.js), as the Fox's Burglar's kit does.
// A ◇ item is a regular item weighing its ◇s; a bare one a small item. Pure: words in, data out.

// The possession's own uses, opening its words: "(○○○ uses):", "○○○○○ uses:", "(○ per session) :".
const USES_LEAD = /^\s*\(?\s*(○+)\s*(?:uses?\b|per\s+(?:session|day|adventure|expedition|season|fight)\b)[^)\n:]*\)?\s*:?\s*/i;

// How long a listed thing may be and still be one thing ("a grappling hook", "needle and thread"):
// longer, the words are a sentence ("expend a use to know where to find ___"), not a list.
const MAX_ITEM_WORDS = 5;

/**
 * The possession's own uses track: `{max, title: null, labels: []}`, or null when its words don't
 * open with one. As the book's: "(○○○ uses)" stays in its words, and the track is drawn beside them.
 */
export function possessionUsesFrom(words) {
	const m = String(words ?? "").replace(/\*/g, "").match(USES_LEAD);
	return m ? { max: Math.min(20, m[1].length), title: null, labels: [] } : null;
}

/** Split `text` at `sep` where no bracket is open. */
function _splitOutside(text, sep) {
	const out = [];
	let depth = 0, from = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === "(") depth++;
		else if (c === ")") depth = Math.max(0, depth - 1);
		else if (c === sep && depth === 0) { out.push(text.slice(from, i)); from = i + 1; }
	}
	out.push(text.slice(from));
	return out;
}

/** The words up to the end of the first sentence, a full stop outside any bracket. */
function _firstSentence(text) {
	return text.slice(0, _sentenceEnd(text));
}

function _sentenceEnd(text) {
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === "(") depth++;
		else if (c === ")") depth = Math.max(0, depth - 1);
		else if ((c === "." || c === ";") && depth === 0 && !/\d/.test(text[i + 1] ?? "")) return i;
	}
	return text.length;
}

/**
 * What a gear-listing possession says after its list ("Spend ~1 week of careful work to refresh 1
 * use.", "Each spring, d4 uses of bendis root…"): the book keeps it as the possession's `rulesNote`,
 * which the sheet shows once the list itself is drawn as the gear it gave. "" when there is none.
 * Its *emphasis* is kept.
 */
export function possessionRulesFrom(words) {
	const text = String(words ?? "").replace(/\s+/g, " ").trim();
	const plain = text.replace(/\*/g, "");
	const lead = plain.match(USES_LEAD)?.[0].length ?? 0;
	const end = lead + _sentenceEnd(plain.slice(lead));
	// Back to the same place in the words with their emphasis: count the plain characters through.
	let seen = 0, at = 0;
	while (at < text.length && seen <= end) { if (text[at] !== "*") seen++; at++; }
	return text.slice(at).replace(/^[\s*]*[.;]?\s*/, "").trim();
}

const _cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The gear a possession's words list, as `grantsItems` rows ({name, column, weight?, note?,
 * resource?, resourceSuffix?}), or null when they list none. A list is three or more short things,
 * or any short thing marked ◇ ("◇ nightshade oil (applied, dangerous, damage +1d4)").
 */
export function possessionGearFrom(words) {
	const plain = String(words ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
	const rest = plain.replace(USES_LEAD, "");
	const list = _firstSentence(rest);
	if (/_{2,}/.test(list) || /\byour?\b/i.test(list)) return null;
	const parts = _splitOutside(list, ",")
		.map(p => p.trim().replace(/^and\s+/i, ""))
		.filter(p => p && !/^etc\.?$/i.test(p) && !/^and (?:so on|more)$/i.test(p));
	if (!parts.length) return null;
	const rows = [];
	for (const part of parts) {
		const diamonds = (part.match(/^[◇\s]*/)?.[0].match(/◇/g) ?? []).length;
		const body = part.replace(/^[◇\s]+/, "");
		const paren = body.match(/\(([^)]*)\)?/);
		const name = _cap(body.replace(/\s*\(.*$/, "").replace(/^(?:a|an|the)\s+/i, "").trim());
		if (!name || name.split(/\s+/).length > MAX_ITEM_WORDS || /[○◇☐]/.test(name)) return null;
		const row = { name, column: diamonds ? "regular" : "small", ...(diamonds ? { weight: diamonds } : {}) };
		if (paren) {
			const inside = paren[1].trim();
			const pips = (inside.match(/○/g) ?? []).length;
			if (pips) {
				// "a lantern (○○○○○ hours, close, area)": hours to mark off, the rest said after them.
				row.resource = { max: Math.min(20, pips), title: null, labels: [] };
				const suffix = inside.replace(/○/g, "").replace(/^[\s,;:]+|[\s,;:]+$/g, "").replace(/\s+,/g, ",");
				if (suffix) row.resourceSuffix = suffix;
			} else if (inside) row.note = inside;
		}
		rows.push(row);
	}
	return rows.length >= 3 || rows.some(r => r.column === "regular") ? rows : null;
}
