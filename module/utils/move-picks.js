/**
 * How many of a move's printed options you may take — read out of the move's own lead-in.
 *
 * "The GM picks 1", "on a 10+, pick 2; on a 7-9, pick 1", "ask the GM 2 of the following": the
 * count is in the prose, so it is read from the prose rather than restated anywhere. What comes
 * back caps the checklist on the card (see chat.js#pickableMoveDescription and the wiring in
 * stonetop.js), so ticking a third option on a "pick 2" clears the first.
 *
 * DELIBERATELY TIMID. A cap that is too low is a player blocked from taking what the move
 * grants — worse than no cap at all, which is only the status quo of trusting the table to read
 * the line above the boxes. So anything the patterns below do not plainly recognise returns null
 * and stays uncapped, and any phrase that means "as often as you like" vetoes a count that
 * happened to match elsewhere in the sentence.
 *
 * @param {string} lead  The move's text BEFORE its options list, tags already stripped.
 * @returns {number|{success?: number, partial?: number, failure?: number}|null}
 *   A number caps every tier; an object caps the tiers it names and leaves the rest free;
 *   null means no cap.
 */

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4 };
const toCount = word => WORD_NUMBERS[String(word).toLowerCase()] ?? (Number(word) || null);

/**
 * Phrases that mean "there is no fixed number": a resource spent one at a time for as long as it
 * lasts, a question list a move ADDS to rather than chooses from, or a tally where every true
 * line counts. Each of these sentences also contains a digit that the count patterns would
 * otherwise seize on ("spend Readiness 1-for-1", "hold 1 Rapport"), which is exactly why the
 * veto is checked first.
 */
const UNBOUNDED = /1[-\s]for[-\s]1|for each\b|add (?:the )?(?:following|these)\b|as many\b|(?:all(?: \d| three| that)?|both) apply/i;

/**
 * The handful of entities the shipped move text actually uses. Decoded BEFORE anything is read,
 * because the book writes its tiers with en dashes: a raw "7&ndash;9" is not "7-9" to any
 * pattern here, and the cost is not a missed cap but a WRONG one — the tier marker before it
 * ("on a 10+") then swallows the 7-9's own count and caps the strong hit with it.
 */
const ENTITIES = { "&ndash;": "\u2013", "&mdash;": "\u2014", "&nbsp;": " ", "&amp;": "&", "&#8211;": "\u2013", "&#8212;": "\u2014" };
const decode = text => text.replace(/&(?:ndash|mdash|nbsp|amp|#8211|#8212);/gi, m => ENTITIES[m.toLowerCase()] ?? m);

/** Result tiers as the book writes them, mapped to the card's own tier keys. */
const TIER_KEYS = [
	[/^(?:10\+|12\+)$/, "success"],
	[/^7[-\u2013\u2014]9$/,       "partial"],
	[/^6[-\u2013\u2014]$/,        "failure"],
];
const tierKey = text => TIER_KEYS.find(([re]) => re.test(String(text).trim()))?.[1] ?? null;

/**
 * A count in the phrasings the shipped moves actually use, and nothing else:
 *   "pick 1" / "picks 1" / "choose 2" / "chooses 1" / "do 1" / "select 1"
 *   "ask 1" / "asks 2" / "ask them 1 question" / "ask the GM 2"
 *   "one of the following" / "2 of these"
 */
const COUNT_RE = new RegExp(
	"\\b(?:pick|picks|choose|chooses|select|selects|take|takes|do|does|ask|asks)\\b"
	+ "(?:\\s+(?:them|the\\s+GM|another\\s+player|a\\s+PC(?:\\s+or\\s+NPC)?))?\\s+"
	+ "(one|two|three|four|\\d)\\b"
	+ "|\\b(one|two|three|four|\\d)\\s+of\\s+(?:the\\s+following|these)\\b",
	"gi",
);

/**
 * Where each "on a 10+ / 7-9 / 6-" begins, in the order the move writes them.
 *
 * Closed with a lookahead, NOT `\b`: "10+" and "6-" end in a non-word character, so a word
 * boundary after them can only match when the next character IS a word character — the exact
 * opposite of what is wanted. `\b` here silently matched "7-9" (ends in a digit) and nothing
 * else, which read as "this move only caps its 7-9" for every tiered move in the book.
 */
const TIER_MARK_RE = /on\s+an?\s+(10\+|12\+|7[-\u2013\u2014]9|6[-\u2013\u2014])(?=[\s,;:.]|$)/gi;

/**
 * "You and the GM EACH choose 1" — a count that is per person, not per list. Two get chosen, and
 * how many people are choosing is not something this can count, so the number is not a cap and
 * the list is left free. Checked per SEGMENT rather than over the whole text, so Invoke the Sun
 * God (the one move that says it) keeps the plain "choose 1" its 10+ states and only frees its
 * 7-9 — capping that at 1 would have blocked the GM's half of the choice.
 */
const PER_PERSON = /\beach\s+(?:\w+\s+){0,2}?(?:pick|picks|choose|chooses|select|selects|take|takes|ask|asks)\b/i;

const firstCountIn = segment => {
	if (PER_PERSON.test(segment)) return null;
	for (const m of segment.matchAll(COUNT_RE)) {
		const n = toCount(m[1] ?? m[2]);
		if (n) return n;
	}
	return null;
};

/**
 * Read by SEGMENT rather than by one regex over the whole sentence. "On a 10+, deal your damage
 * and pick 2; on a 7-9, deal damage and pick 1" needs each count tied to the tier it follows, and
 * an optional tier prefix inside one pattern does not do that reliably — a lazy match happily
 * skips the "on a 10+" and files its count as tier-less, at which point the 7-9 count is the only
 * tier answer and the 10+ is silently lost. Cutting the text at each tier marker cannot make that
 * mistake: a count belongs to the marker it sits after, and there is nowhere else for it to go.
 */
export function pickLimitsFrom(lead) {
	const text = decode(String(lead ?? ""));
	if (!text) return null;

	const marks = [...text.matchAll(TIER_MARK_RE)];
	const byTier = {};
	// LAST occurrence of a tier wins, not the first: the statement that introduces THIS list is
	// the one nearest it. Seasons Change is the case that needs it — one item whose text runs
	// through all four seasons, each with its own 10+/7-9/6-, and whose list belongs to the last
	// of them. (Its card is not what a table actually sees; the steading sheet rolls that move
	// through its own path.)
	marks.forEach((mark, i) => {
		const tier = tierKey(mark[1]);
		if (!tier) return;
		const segment = text.slice(mark.index, marks[i + 1]?.index ?? text.length);
		// The veto is read against THIS TIER'S sentence, not the whole lead. A tier that hands
		// over the entire list is not a tier without a count — it is a different tier, and it has
		// no business speaking for its neighbours. Undying and Dark Succor are the moves that
		// need it: both say "on a 10+, choose 1; on a 7-9, choose 2; on a 6-, all 3 apply", and
		// read as one sentence that closing "all 3 apply" vetoed the two real counts along with
		// itself, leaving a player who rolled a 10+ with no "0/1" over the boxes at all.
		//
		// The tier that IS unbounded still stops here, which is what leaves it uncapped — right
		// for every phrasing this catches: "all 3 apply" takes the whole list, and "spend it
		// 1-for-1" is not choosing from a list at all.
		if (UNBOUNDED.test(segment)) return;
		const n = firstCountIn(segment);
		if (n) byTier[tier] = n;
	});
	if (Object.keys(byTier).length) return byTier;

	// No tier answered. Either none is named, or the ones that are carry no count of their own —
	// and here the veto IS read over the whole text, because there is no tier to confine it to and
	// a move that says "spend Readiness 1-for-1" means it about everything below.
	if (UNBOUNDED.test(text)) return null;

	// What is left is a move that states the count up front and only then splits by tier ("…they
	// pick 1 from the list below; on a 10+, you also have advantage"), or one that never splits at
	// all. Both are one rule for the whole list, and it has to be
	// said consistently: "choose 1 … and choose 1" is one rule stated twice, while two different
	// numbers with no tier to hang them on is a sentence this is not confident enough to read.
	if (PER_PERSON.test(text)) return null;
	const all = [...text.matchAll(COUNT_RE)].map(m => toCount(m[1] ?? m[2])).filter(Boolean);
	if (!all.length) return null;
	return new Set(all).size === 1 ? all[0] : null;
}

/**
 * The running tally shown above a pick list: "0/1 options selected", "1/3 options selected".
 *
 * The count a move allows is stated in prose ABOVE its list, and on a roll card it is stated in
 * the result line — either way it is a sentence to be read, and by the third option a player has
 * lost count of how many boxes they ticked. The tally says it as a number, beside the boxes.
 *
 * A list whose count could not be read confidently (pickLimitsFrom returned null, or a homefront
 * tier that states its own count in the result text) still gets a tally, just without the
 * denominator: "2 options selected" is the honest thing to say when nothing knows the cap. The
 * noun stays plural at every count — the alternative is a per-language plural rule for a string
 * whose whole job is to be scanned, not read.
 *
 * @param {number} picked  How many boxes are ticked.
 * @param {number|null} limit  The cap, or null/0 when the list is uncapped.
 */
export function pickCountLabel(picked, limit) {
	const n = Math.max(0, Math.trunc(Number(picked)) || 0);
	const max = Math.trunc(Number(limit)) || 0;
	return `${max > 0 ? `${n}/${max}` : n} options selected`;
}
