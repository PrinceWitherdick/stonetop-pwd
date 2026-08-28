/**
 * The Blessed's marks — the five moves that spend Stock to leave a sign on somebody, and then say
 * some version of "so long as the mark remains".
 *
 *   Barkskin           "When you mark another with 1 Stock, they gain this benefit SO LONG AS THE
 *                       MARK REMAINS." (2 armor while touching the earth)
 *   Trackless Step     the same clause, and 1 Stock marks up to LEVEL + INT people at once
 *   Shared Souls       "When you mark a beast with 1 Stock … Treat it as a follower with 3
 *                       Loyalty; when you spend its last Loyalty, the effect ends."
 *   Amulets & Talismans a charm on a named person against a named harm; "it loses its potency
 *                       after 1 use"
 *   Wards & Bindings   sacred signs on a boundary, standing until first tested
 *
 * Five moves, one problem: every one of them is a promise the Blessed made to a particular person
 * about a particular thing, none of them expires on a clock, and nothing on any sheet wrote any of
 * it down. A Blessed three sessions in is carrying the same unwritten list the Judge was — see
 * condemn.js, whose header note this one is the twin of, and marked-people.js for the algebra both
 * share.
 *
 * WHAT IS DIFFERENT FROM THE BRAND, and why this is not just Condemn with another icon:
 *
 *  • A row has a KIND. "Aeronwen is marked" says nothing; "Aeronwen has Barkskin" is the whole
 *    fact. The kind is what the roster groups by and what its rule line quotes.
 *  • One kind counts down. Shared Souls ends when the beast's last Loyalty is spent, so those rows
 *    carry a 3-pip track and dismiss themselves at zero. Nothing else does, so `loyalty` is null
 *    everywhere else rather than 0 — a 0 would render an exhausted track on a ward.
 *  • One kind asks a question at the moment it is laid. Wards & Bindings says "ALSO, CHOOSE whether
 *    the affected beings are repelled or trapped by the signs" — the difference between a ward and
 *    a binding, and the only thing that says which of the two a row is. Same null discipline as
 *    Loyalty: `sign` is null on the four kinds that never had one, and "" on a ward nobody has
 *    answered for yet, so an unanswered ward reads as a question rather than as a quiet default.
 *
 * WHAT IS DELIBERATELY NOT HERE: spending the Stock. Every one of these moves costs 1 Stock, and
 * the roster still does not touch the Sacred Pouch's track, because the cost is not per-ROW —
 * Trackless Step marks "a number of individuals up to your level + INT" for that single Stock, so
 * a roster that debited a pip per name would overcharge a Blessed for using the move correctly.
 * The cost is quoted in each kind's rule line and paid on the pouch, where the player can see it.
 *
 * Kept Foundry-free so all of this can be tested without a world in sight.
 */

import { ownsMoveNamed, ownedNamesOr } from "./owns-move.js";
import { createRoster, showStandingList } from "./marked-people.js";

// Re-exported so the dialog and this playbook's tests keep reaching the predicate through the
// feature module they already import.
export { ownsMoveNamed };

export const BLESSED_MARKS_FLAG = "blessedMarks";

export const BARKSKIN            = "Barkskin";
export const TRACKLESS_STEP      = "Trackless Step";
export const SHARED_SOULS        = "Shared Souls";
export const AMULETS_TALISMANS   = "Amulets & Talismans";
export const WARDS_BINDINGS      = "Wards & Bindings";

/** Shared Souls' beast starts at 3 Loyalty and the mark ends when the last one is spent. */
export const SHARED_SOULS_LOYALTY = 3;

/**
 * Wards & Bindings' one per-row choice: "choose whether the affected beings are repelled or
 * trapped by the signs".
 *
 * ONE MOVE, TWO OUTCOMES — which is why this is a field on a ward row and NOT a sixth entry in
 * MARK_KINDS. A ward and a binding are the same move, cost the same Stock, quote the same rule and
 * roll the same +INT when first tested; splitting them into two kinds would put two pickers'
 * worth of choice where the move has one, and would break the per-kind dedupe below into letting
 * one doorway carry two rows of what the fiction calls one set of signs.
 *
 * `key` is the move's OWN word, stored; `label` is the word a player uses for the thing that word
 * makes. Storing "repelled" rather than "ward" keeps the flag readable against the move text, and
 * keeps this key out of collision with the `ward` KIND key, which means something else entirely.
 */
export const WARD_SIGNS = [
	{ key: "repelled", label: "Ward",    rule: "The affected beings are repelled by the signs." },
	{ key: "trapped",  label: "Binding", rule: "The affected beings are trapped by the signs." },
];

/** What the add row offers first. Visible in the picker, so it is a shown default, not a silent one. */
export const DEFAULT_WARD_SIGN = WARD_SIGNS[0].key;

/**
 * The kinds a mark can be, in the order the roster lists them.
 *
 * `move` is matched against the move NAMES in the packs, and is what earns a kind its place in the
 * add form — a Blessed who has not taken Shared Souls is not offered a beast to mark. `rule` is
 * the clause that makes the row worth keeping, quoted rather than paraphrased so the window
 * answers "what does this actually do" without a trip to the Moves tab.
 *
 * `subject` is what the add field is asking FOR, which is not "a person" in two of the five cases:
 * Shared Souls marks a beast and Wards & Bindings marks a threshold. Getting that wrong turns a
 * perfectly good roster row into a puzzle about who "the north gate" is.
 */
export const MARK_KINDS = [
	{
		key: "barkskin", move: BARKSKIN, label: "Barkskin", subject: "person",
		rule: "They have 2 armor while touching the earth, so long as the mark remains. Costs 1 Stock.",
	},
	{
		key: "trackless", move: TRACKLESS_STEP, label: "Trackless Step", subject: "person",
		rule: "They make no sound, leave no trace and ignore hindering terrain, so long as the mark "
			+ "remains. 1 Stock marks up to your level + INT of them.",
	},
	{
		key: "beast", move: SHARED_SOULS, label: "Shared Souls", subject: "beast",
		rule: "You direct this beast and perceive through its senses at any distance. Treat it as a "
			+ "follower with 3 Loyalty; when you spend its last Loyalty, the effect ends. Costs 1 Stock.",
		loyalty: SHARED_SOULS_LOYALTY,
	},
	{
		key: "charm", move: AMULETS_TALISMANS, label: "Amulet or talisman", subject: "person",
		rule: "Name the harm it wards against. When they would suffer it while bearing your charm, "
			+ "roll +INT. One charm at a time each, and it loses its potency after 1 use. Costs 1 Stock.",
	},
	{
		key: "ward", move: WARDS_BINDINGS, label: "Ward or binding", subject: "place",
		rule: "Sacred signs on a boundary: name who or what they affect in no more words than your "
			+ "level, and whether those beings are repelled or trapped. Roll +INT when first tested. "
			+ "Costs 1 Stock.",
		signs: WARD_SIGNS,
	},
];

const KIND_BY_KEY = Object.fromEntries(MARK_KINDS.map(k => [k.key, k]));

/** The kind fallback for a row whose stored kind means nothing here. See `coerceKind`. */
export const DEFAULT_KIND = MARK_KINDS[0].key;

/**
 * A stored kind, coerced to one this build knows.
 *
 * An unknown kind falls back rather than dropping the row: the row still names somebody the
 * Blessed marked, and a mark that vanished from the roster because a future build renamed a key
 * would be worse than one listed under the wrong heading — the first cannot be dismissed at all.
 */
function coerceKind(raw) {
	const key = String(raw ?? "").trim();
	return KIND_BY_KEY[key] ? key : DEFAULT_KIND;
}

/**
 * Loyalty, which only a Shared Souls row has.
 *
 * Null for every other kind, and clamped to 0..3 for that one. Null rather than 0 on purpose: 0 is
 * a real Shared Souls state (the last Loyalty just went, the mark is over) and rendering that on a
 * ward would show an exhausted track on a row that never had one.
 */
function coerceLoyalty(raw, row) {
	const def = KIND_BY_KEY[coerceKind(row?.kind)];
	if (!def?.loyalty) return null;
	// `undefined` is a fresh row rather than a spent one — a beast marked a moment ago is at full
	// Loyalty, so an absent value fills the track rather than emptying it.
	if (raw === undefined || raw === null || raw === "") return def.loyalty;
	const n = Math.trunc(Number(raw));
	if (!Number.isFinite(n)) return def.loyalty;
	return Math.min(def.loyalty, Math.max(0, n));
}

/**
 * Which of the two a ward row is, and null on every kind that never had the choice.
 *
 * THREE STATES, DELIBERATELY. Null means "this kind has no such choice" — the four kinds that are
 * not Wards & Bindings, which must not render a toggle. "" means "a ward whose signs nobody has
 * said repel or trap yet", which is every ward laid before this field existed and is a real,
 * answerable state rather than an error. Only the move's own two words are anything else.
 *
 * An unrecognised value lands on "" rather than on a default, for the reason the whole field
 * exists: a row that quietly claims to be a ward when the player never said so is exactly the
 * silence this is here to break.
 */
function coerceSign(raw, row) {
	const def = KIND_BY_KEY[coerceKind(row?.kind)];
	if (!def?.signs) return null;
	const key = String(raw ?? "").trim();
	return def.signs.some(s => s.key === key) ? key : "";
}

const roster = createRoster({
	prefix: "mark",
	fields: { kind: coerceKind, loyalty: coerceLoyalty, sign: coerceSign },
	// Duplicates are refused WITHIN A KIND, not across the roster. That is the rule the moves state:
	// "one can benefit from only 1 charm at a time" is Amulets & Talismans' own sentence, while
	// nothing stops the same woman wearing Barkskin and Trackless Step at once. Scope-blind dedupe
	// would have made the second of those impossible to record.
	scope: entry => coerceKind(entry?.kind),
});

/** The kind definition for a key, or null. Used by the dialog for labels and rule lines. */
export function markKind(key) {
	return KIND_BY_KEY[coerceKind(key)] ?? null;
}

/** The ward-sign definition for a stored key, or null for "" and for anything unrecognised. */
export function markSign(key) {
	return WARD_SIGNS.find(s => s.key === key) ?? null;
}

/**
 * The kinds this character can actually lay, in roster order. Empty for anyone who is not one.
 *
 * One pass over the items for all five kinds, not one pass each. The per-kind form short-circuits
 * on a hit, so a Blessed paid little — but everybody ELSE paid all five scans in full, and that is
 * most sheets in most worlds. Takes the sheet's one-pass Set when it has one, so the header glyphs
 * and the add form share a single walk instead of each paying for their own.
 */
export function availableKinds(actor, owned = null) {
	const names = ownedNamesOr(actor, owned);
	return MARK_KINDS.filter(def => names.has(def.move));
}

/**
 * Whether this character can mark anybody at all — what earns the glyph in the header.
 *
 * Literally "is there a kind available", asked of `availableKinds` rather than of a second walk
 * of the same table: written twice, the glyph could light while the add form offered nothing, or
 * the reverse. Five entries, so building the list costs nothing worth short-circuiting past.
 */
export function canMarkBlessed(actor, owned = null) {
	return availableKinds(actor, owned).length > 0;
}

/**
 * Whether to render the glyph at all.
 *
 * Standing marks are always shown, even on a sheet that owns none of the five moves — otherwise
 * dropping a new playbook over a Blessed strands live marks with nothing left that could lift
 * them. The same rule the scales follow, for the same reason, so it is the same function.
 */
export const showBlessedMarks = showStandingList;

// ── The stored list ─────────────────────────────────────────────────────────────

export const readMarks    = roster.readList;
export const addMark      = roster.add;
export const removeMark   = roster.remove;

/** Re-word what a mark is for. `{ entries, changed }`, `changed` null when nothing moved. */
export function noteMark(list, id, note) {
	return roster.patch(list, id, { note });
}

/**
 * Say whether a ward's signs repel or trap. Same `{ entries, changed }` contract as the rest.
 *
 * A no-op on the four kinds that never had the choice: coerceSign answers null there whatever is
 * passed, so the patch compares equal and nothing is written. Unlike Loyalty this needs no early
 * return to say so, because there is no second result field whose value would be a lie.
 */
export function setMarkSign(list, id, sign) {
	return roster.patch(list, id, { sign });
}

/**
 * Set a Shared Souls beast's remaining Loyalty.
 *
 * Returns the shared `{ entries, changed }`, plus `ended` — true when this write took the last
 * Loyalty, which is where the move says the effect stops. What to SAY about that is the caller's
 * (the dialog names whose mark ended), so the rule lives in one place and the announcement stays
 * where the player can watch it happen.
 *
 * `liftOnEnd` folds the row's removal into THIS result instead of leaving the caller to write a
 * second time. A beast with an empty three-pip track is a state nothing should ever see: two
 * writes store it, broadcast it to every client and repaint every open sheet, and only then take
 * it away again. One write never shows it at all.
 *
 * A no-op on any other kind: coerceLoyalty answers null there, so the patch would compare equal
 * and change nothing anyway, but returning early says why rather than leaving it to a coincidence.
 */
export function setMarkLoyalty(list, id, loyalty, { liftOnEnd = false } = {}) {
	const before = readMarks(list).find(m => m.id === id);
	if (!before || before.loyalty === null) return { entries: readMarks(list), changed: null, ended: false };
	const result = roster.patch(list, id, { loyalty });
	const ended  = result.changed?.loyalty === 0;
	if (!ended || !liftOnEnd) return { ...result, ended };
	// Cut from the PATCHED list, and reported as `changed` rather than `removed`, so the write
	// still reads as the one act it was: the player spent a Loyalty, and the mark went with it.
	return { entries: roster.remove(result.entries, id).entries, changed: result.changed, ended };
}

/**
 * The roster split into its kinds, each with its definition and rows, ready to render.
 *
 * ONLY KINDS SOMEBODY IS ACTUALLY WEARING. A group with no rows is a heading and a rule line about
 * nobody, and five of those is most of the window on a Blessed who has laid two marks — this roster
 * answers "who is wearing what", so a kind nobody wears has nothing to answer with. Which kinds can
 * be LAID is a different question, and the add row answers it from availableKinds, so an owned move
 * with no marks out is still one pick away from its first: the empty group was never the way in.
 *
 * No longer asks what the character owns, and so no longer asks for the actor. A Blessed who has
 * since dropped the move still sees the marks they laid with it, because those rows are still on
 * the list and still need lifting.
 */
export function groupMarks(list) {
	const rows = readMarks(list);
	return MARK_KINDS
		.map(def => ({ def, rows: rows.filter(m => m.kind === def.key) }))
		.filter(group => group.rows.length);
}
