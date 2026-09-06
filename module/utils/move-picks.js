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
import { decodeEntities } from "./strings.js";

// The two phrasings that appear in BOTH questions below — the veto on a count, and the narrower
// "this list is not a choice" test. Named once because they are the same book wording read twice
// for different purposes, and a fix to either spelling (an en dash in "1-for-1", a "the
// following ones") has to reach both or the two answers start disagreeing about one sentence.
const ONE_FOR_ONE = String.raw`1[-\s]for[-\s]1`;
const THE_FOLLOWING = String.raw`(?:the )?(?:following|these)\b`;

// "…and then one more, if". Take the Measure states a count and then grows it on a condition
// nothing here can weigh — "ask their player one of the questions below … if they fear or respect
// you (their call), you can ask another question" — so the number it opens with is a floor, not a
// cap. Vetoed rather than read, on the file's own rule that too tight is worse than uncapped: a
// Marshal who earned the second question must not find the box refusing it.
const ANOTHER = String.raw`\b(?:pick|choose|select|take|ask)\s+another\b`;

const UNBOUNDED = new RegExp(
	`${ONE_FOR_ONE}|for each\\b|add ${THE_FOLLOWING}|as many\\b|${ANOTHER}`
	+ `|(?:all(?: \\d| three| that)?|both) apply`, "i");

/**
 * The narrower question: is this list something the move SHOWS you rather than asks you to
 * choose from? Two shapes qualify, and neither is a choice the move ever offers.
 *
 * A RESOURCE'S SPEND MENU. "You can spend Readiness 1-for-1 to:" (Defend), and the same on
 * Silver Tongued's Nerve, We Happy Few's Inspiration, Anger is a Gift's Resolve, Strengthen
 * Your Bond's Loyalty. What follows is what the points you are now holding BUY, one at a time,
 * over the rest of the fight — you may buy the same line twice, and the roll never asked you to
 * choose between them.
 *
 * A LIST ADDED TO ANOTHER MOVE. "When you Seek Insight, add the following to the list of
 * questions you can ask:" (Situational Awareness, Predator). Those questions are not picked
 * here at all; they are appended, permanently, to a list that lives on a different move and is
 * chosen from there.
 *
 * Either way a tick would record a decision nobody made, so these print as prose with the
 * system's spiral bullets instead of as a checklist (see chat.js#pickableMoveDescription).
 *
 * Deliberately NARROWER than `UNBOUNDED` above, which vetoes a COUNT for several reasons that
 * have nothing to do with this one. End of Session's questions are vetoed by "for each 'yes'"
 * and are the most tickable list in the book; Dark Succor and Danu's Grasp are vetoed by "all 3
 * apply" and "both apply" while their lists are still choices. Only these two shapes stop being
 * a choice, so only they are named here — and note how close the near misses run: "ask 1 of the
 * following" (Under Your Skin, Read the Land, Warden of the Wild) IS a choice and keeps its
 * boxes, which is why the verb is part of each pattern rather than "the following" alone.
 *
 * Both are sentence-bounded (`[^.;:]*`), so a "spend" or an "add" earlier in the move's text
 * cannot reach across a full stop to meet a phrase belonging to a different sentence.
 *
 * @param {string} lead  The move's text BEFORE its options list, tags already stripped.
 */
const SPEND_MENU = new RegExp(String.raw`\bspends?\b[^.;:]*\b${ONE_FOR_ONE}`, "i");
const ADDED_TO_ANOTHER_MOVE = new RegExp(String.raw`\badds?\b[^.;:]*\b${THE_FOLLOWING}`, "i");

export function isReferenceList(lead) {
	const text = decodeEntities(String(lead ?? ""));
	return SPEND_MENU.test(text) || ADDED_TO_ANOTHER_MOVE.test(text);
}


/**
 * Result tiers as the book writes them, mapped to the card's own tier keys.
 *
 * DELIBERATELY not the same table as the move card's ladder (utils/move-tiers.js#_TIER_HEAD_RE):
 * that one refuses "12+" because a 12+ line is a bonus ON TOP of the hit and labelling its row
 * "10+" would read as a lie, while a 12+ HERE names the same pick count the hit does and must
 * cap it. The two also anchor differently — this scans a whole lead for every marker in it, that
 * one tests a single clause's opening. They share the spellings, not the semantics; keep the
 * dash variants in step, and see the note there before adding a tier to either.
 *
 * A marker names a LIST of tiers, because one of them covers two. "On a 7+" is how the book
 * writes what a hit of either strength gets — Danu's Grasp, Alpha, Muster, Burgle, the Mindgem,
 * the Seeker's fire-in-the-hands — and the count it states belongs to the 10+ AND the 7-9. Read
 * as a tier of its own it belonged to neither, so Danu's Grasp's "on a 7+ … they pick 1" attached
 * to nothing and its weak hit reached the card uncapped, with the move's own text beside the
 * boxes saying pick one. A later marker still wins (see the loop below), which is how the same
 * move's "on a 10+, … both apply" raises its strong hit back to 2 without touching the 7-9.
 */
const TIER_KEYS = [
	[/^(?:10\+|12\+)$/, ["success"]],
	[/^7\+$/,           ["success", "partial"]],
	[/^7[-\u2013\u2014]9$/,       ["partial"]],
	[/^6[-\u2013\u2014]$/,        ["failure"]],
];
const tierKeys = text => TIER_KEYS.find(([re]) => re.test(String(text).trim()))?.[1] ?? [];

/**
 * A count in the phrasings the shipped moves actually use, and nothing else:
 *   "pick 1" / "picks 1" / "choose 2" / "chooses 1" / "do 1" / "select 1"
 *   "ask 1" / "asks 2" / "ask them 1 question" / "ask the GM 2" / "ask their player 1 question"
 *   "one of the following" / "2 of these"
 *
 * Who is being asked sits between the verb and the number, and the alternation is a roll-call of
 * the ways the shipped moves name them rather than a wildcard: a `\w+` there would read "pick 2
 * seasonal gains" as "pick <someone> seasonal" and, worse, let any noun at all stand between a
 * verb and a digit that was never its count. "their player" is All is Illuminated's — its 10+ is
 * "ask their player 1 question from the list below", and unread it left a Seeker's strong hit
 * free to tick all four questions when the move grants one.
 */
const COUNT_RE = new RegExp(
	"\\b(?:pick|picks|choose|chooses|select|selects|take|takes|do|does|ask|asks)\\b"
	+ "(?:\\s+(?:them|their\\s+player|the\\s+GM|another\\s+player|a\\s+PC(?:\\s+or\\s+NPC)?))?\\s+"
	+ "(one|two|three|four|\\d)\\b"
	+ "|\\b(one|two|three|four|\\d)\\s+of\\s+(?:the\\s+following|these)\\b",
	"gi",
);

/**
 * Where each "on a 10+ / 7+ / 7-9 / 6-" begins, in the order the move writes them.
 *
 * Closed with a lookahead, NOT `\b`: "10+" and "6-" end in a non-word character, so a word
 * boundary after them can only match when the next character IS a word character — the exact
 * opposite of what is wanted. `\b` here silently matched "7-9" (ends in a digit) and nothing
 * else, which read as "this move only caps its 7-9" for every tiered move in the book.
 *
 * "7-9" is offered ahead of "7+" for reading order alone: the two cannot collide, because what
 * follows the 7 is what tells them apart.
 */
const TIER_MARK_RE = /on\s+an?\s+(10\+|12\+|7[-\u2013\u2014]9|7\+|6[-\u2013\u2014])(?=[\s,;:.]|$)/gi;

/**
 * "You and the GM EACH choose 1" — a count that is per person, not per list. Two get chosen, and
 * how many people are choosing is not something this can count, so the number is not a cap and
 * the list is left free. Checked per SEGMENT rather than over the whole text, so Invoke the Sun
 * God (the one move that says it) keeps the plain "choose 1" its 10+ states and only frees its
 * 7-9 — capping that at 1 would have blocked the GM's half of the choice.
 */
const PER_PERSON = /\beach\s+(?:\w+\s+){0,2}?(?:pick|picks|choose|chooses|select|selects|take|takes|ask|asks)\b/i;

/**
 * A tier that hands over the WHOLE list, and the number that is — "ask the GM BOTH of the
 * questions below" (Danger Sense), "on a 10+, both" (Formidable), "as a 7-9, but both apply"
 * (Danu's Grasp), "on a 6-, all 3 apply" (Dark Succor, Undying).
 *
 * These are counts the book states in words rather than digits, and until they were read the
 * five moves that say them reached the card as "no cap" — the same answer a sentence nothing
 * could parse gets. That is wrong twice over: the tier's boxes tick past what the move grants,
 * and, worse, a roll that leaves NO CHOICE TO MAKE still asks the player to tick every box by
 * hand. Read as a count, the cap covers the list, and the surface showing the list ticks it for
 * them (utils/pick-tally.js#grantsWholeList) — which is the rule the Undying / Dark Succor
 * walkthrough has always applied to that same 6- (see dialogs/UndeathDialog.js#_syncForcedPicks,
 * where a tier whose pick covers every effect ticks them all).
 *
 * Only the shipped shapes, because a false positive here is a cap read off a sentence that was
 * not talking about the list at all. "Both" counts only where it plainly stands for the options
 * — followed by "apply", followed by "of …", or standing alone as the tier's whole answer —
 * which is why Parry & Riposte's "spend 1 Readiness to both halve an attack's effects/damage"
 * and Burn Twice as Bright's "apply any consequences to both Invocations" are not counts. "All"
 * needs its number: "all 3 apply" is a count, while "all that apply" is a tally and stays with
 * the UNBOUNDED phrases above.
 *
 * Captures: 1 = "both" before "apply"/"of", 2 = the number after "all", 3 = a lone "both".
 */
const TAKE_ALL_RE = new RegExp(
	String.raw`\b(?:(both)|all\s+(\d+|two|three|four))\b(?=\s+(?:appl(?:y|ies)\b|of\s+))`
	+ String.raw`|(?:^|[,;:]\s*)(both)\s*(?=[;:.]|$)`, "i");

const takeAllCount = segment => {
	const m = TAKE_ALL_RE.exec(String(segment));
	if (!m) return null;
	return (m[1] || m[3]) ? 2 : toCount(m[2]);
};

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
	// Entities decoded BEFORE anything is read: the book writes its tiers with en dashes, and a
	// raw "7&ndash;9" is not "7-9" to any pattern here. The cost is not a missed cap but a WRONG
	// one - the tier marker before it ("on a 10+") then swallows the 7-9's own count and caps the
	// strong hit with it. strings.js#decodeEntities knows the numeric forms this used to keep a
	// private table for.
	const text = decodeEntities(String(lead ?? ""));
	if (!text) return null;

	const marks = [...text.matchAll(TIER_MARK_RE)];
	const byTier = {};
	// LAST occurrence of a tier wins, not the first: the statement that introduces THIS list is
	// the one nearest it. Seasons Change is the case that needs it — one item whose text runs
	// through all four seasons, each with its own 10+/7-9/6-, and whose list belongs to the last
	// of them. (Its card is not what a table actually sees; the steading sheet rolls that move
	// through its own path.)
	//
	// That same rule is what makes an "on a 7+" safe to spread across two tiers: the book always
	// writes the shared clause first and then narrows it ("on a 7+, … they pick 1; on a 10+, …
	// both apply"), so the tier that says something of its own overwrites what the shared clause
	// left it, and the tier that says nothing more keeps it.
	marks.forEach((mark, i) => {
		const tiers = tierKeys(mark[1]);
		if (!tiers.length) return;
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
		// A tier that hands over the whole list is read FIRST, because the veto above is where
		// "both apply" and "all 3 apply" used to end their journey — counted as unreadable and
		// left uncapped, on the two tiers in the book that leave the player nothing to decide.
		const all = takeAllCount(segment);
		if (all) { for (const tier of tiers) byTier[tier] = all; return; }
		if (UNBOUNDED.test(segment)) return;
		const n = firstCountIn(segment);
		if (n) for (const tier of tiers) byTier[tier] = n;
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
