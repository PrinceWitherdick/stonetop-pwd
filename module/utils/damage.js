import {getStonetopProsperity} from "./world.js";
import {DAMAGE_DIE_RE, isWholeDamageDie, attackSeparatorRe} from "./damage-die.js";

// The canonical damage-die grammar is DEFINED in damage-die.js (which has no Foundry in it, so
// the Foundry-free Dangers worksheet can share it) and re-exported here, where most of the
// system already reaches for it.
export {DAMAGE_DIE_RE};

/** The first die expression in a free-text damage string, or null. */
export function dieFromDamage(str) {
	return String(str ?? "").match(DAMAGE_DIE_RE)?.[0] ?? null;
}

/**
 * One extra damage-dice term, cleaned up for concatenation onto a damage formula — the
 * "+1d6" the Storm Markings' Storm's Fury imbues a strike with, the "+1d4" a Blood-Soaked
 * Past deals fighting without mercy, the "1d6" Clash's strike-hard already folds in.
 *
 * Accepts what a player would actually type: a leading `+` or `-`, spaces anywhere, and an
 * optional flat tail (`2d6 + 1`). Returns the term WITHOUT a leading `+` (a `-` is kept, since
 * the sign is part of the term) so the caller decides how to join it, or `""` for anything
 * that is not a single die expression — a blank field, prose, a bare number, two terms at once.
 *
 * DELIBERATELY NARROWER than handing the string to `Roll`: this text comes from a free-typed
 * field that reaches an evaluated formula, and a rejected term is a preview that visibly does
 * not change, where a thrown Roll is a damage roll that never happens.
 */
export function normalizeDamageBonusDice(input) {
	const raw = String(input ?? "").trim();
	if (!raw) return "";
	const negative = raw.startsWith("-");
	const body = raw.replace(/^[+-]\s*/, "");
	if (!isWholeDamageDie(body)) return "";
	return `${negative ? "-" : ""}${body.replace(/\s+/g, "")}`;
}

/**
 * A damage formula with a one-off adjustment folded in: the base die (already carrying the
 * weapon's own `+N`) plus any extra dice and a flat bonus.
 *
 * Strike-hard's "1d6 extra damage" and a player's own typed dice DO stack, but not through
 * this argument: the attack flow folds the tier's dice into `base` before the damage window
 * opens (damageFormula in combat/attack-flow.js), so what arrives here is the one term the
 * window answered with. `extraDice` still accepts an array for a caller that has several
 * terms in hand at once; no shipped surface passes one today.
 *
 * Terms that don't parse (see {@link normalizeDamageBonusDice}) are dropped, so a half-typed
 * field can never break the roll.
 *
 * Order matters and is not cosmetic: the base die stays FIRST because advantage /
 * disadvantage on damage doubles the formula's first dice term (see `damageRollFormula`),
 * and "roll damage twice, take the higher" means the damage die — not the bonus dice.
 */
export function composeDamageFormula(base, { bonus = 0, extraDice = "" } = {}) {
	const terms = [];
	const first = String(base ?? "").trim();
	if (first) terms.push(first);
	for (const term of (Array.isArray(extraDice) ? extraDice : [extraDice]).map(normalizeDamageBonusDice)) {
		if (term) terms.push(term.startsWith("-") ? term : `+${term}`);
	}
	const flat = Math.trunc(Number(bonus)) || 0;
	if (flat) terms.push(flat > 0 ? `+${flat}` : String(flat));
	// A bonus with no base leaves the leading sign stranded at the head of the formula, which
	// Roll rejects. Nothing at all rolls a flat 0 rather than throwing on an empty formula.
	return terms.join("").replace(/^\+/, "") || "0";
}

/**
 * Resolve a weapon's piercing value. A number is a fixed count of armor points to
 * ignore; the string "prosperity" is the iron-weapon "x piercing" whose value equals
 * the party steading's CURRENT Prosperity — resolved live here so a mid-fight change
 * is honoured and never baked onto the weapon. Anything else → 0.
 */
export function resolvePiercing(piercing) {
	if (typeof piercing === "number") return Math.max(0, piercing);
	if (piercing === "prosperity") return Math.max(0, Number(getStonetopProsperity()) || 0);
	return 0;
}

/**
 * Reduce raw damage by a target's armor, honouring piercing and full-bypass:
 * effective = ignoresArmor ? raw : max(0, raw − max(0, armor − piercing)).
 * `messy` / `forceful` are pure fiction and never enter this math.
 *
 * `unpierceable` is the portion of that armor which piercing cannot reduce and "ignores armor"
 * cannot bypass — the Rune-laden Scales' PROOF AGAINST HARM ("3 armor, even against piercing and
 * attacks that normally ignore armor"). It is a FLOOR under the effective armor rather than a
 * separate pool, so a character in 3 unpierceable armor plus a +1 shield facing 1 piercing still
 * soaks 3: piercing eats the shield's point first and then stops at the floor.
 */
export function mitigateDamage(raw, { armor = 0, piercing = 0, ignoresArmor = false, unpierceable = 0 } = {}) {
	const dmg = Math.max(0, Math.round(Number(raw) || 0));
	// Never more than the armor actually present: a floor can't invent protection a character
	// isn't wearing (it is only ever set from armor that IS in the total).
	const floor = Math.max(0, Math.min(Number(unpierceable) || 0, Number(armor) || 0));
	if (ignoresArmor) return Math.max(0, dmg - floor);
	const effectiveArmor = Math.max(floor, (Number(armor) || 0) - (Number(piercing) || 0));
	return Math.max(0, dmg - effectiveArmor);
}

/**
 * Subtract `amount` HP from an actor, clamped at 0, and return the transition
 * `{ oldHp, newHp }` (null if the actor has no HP attribute). Writes
 * system.attributes.hp.value; the caller must have permission to update the actor
 * (monster targets ⇒ GM; the acting PC ⇒ its owner).
 */
export async function applyDamageToActor(targetActor, amount, updateOptions = {}) {
	const hp = targetActor?.system?.attributes?.hp;
	if (!hp) return null;
	const oldHp = Number(hp.value) || 0;
	const newHp = Math.max(0, oldHp - Math.max(0, Math.round(Number(amount) || 0)));
	if (newHp !== oldHp) await targetActor.update({ "system.attributes.hp.value": newHp }, updateOptions);
	return { oldHp, newHp };
}

/**
 * A printed option that DEALS damage, read out of the option's own words.
 *
 * Danu's Grasp's 7-9 is "roots, vines, and earth pull at them, and they pick 1", and one of the
 * two things they may pick is "They take 2d4 damage (ignores armor)". That is a whole damage
 * roll the move owes, stated in the move's own text and nowhere else: no weapon, no damage die,
 * no attack flow. Until this, the only way to pay it was to open a calculator, roll a d4 twice in
 * your head, and hand-edit the target's HP, which leaves no record on any card.
 *
 * TEXT-MATCHED, not declared, for the same reason `provisions.js#readProvisionsYield` is: the
 * line IS the book's own wording, it appears on a move card, on an arcanum's back and in a
 * treasure's list of outcomes, and a table that has reworded any of them (or written a homebrew
 * move that burns someone for 1d6) gets the same button without anyone wiring it up one at a time.
 *
 * WHAT IT REFUSES, and why each refusal matters:
 *
 * A BONUS ON A ROLL YOU ARE ALREADY MAKING. "Deal +1d4 damage" (Ambush), "Deal +1d6 damage" (The
 * Hammer and the Book), "for 1d6 extra damage" (Clash), "Ignore armor or deal +1d4 damage" (Call
 * the Shot), "Add 1d6 to a damage roll they just made" (We Happy Few), "you take +1d6 damage"
 * (the Redwood Effigy). None of those is a roll of its own: the five attack moves already fold
 * theirs into the one Confirm button their card carries (combat/attack-flow.js#PICK_EFFECTS), and
 * offering a second button beside the bullet would be the two-list miscount all over again, in
 * dice this time. The `+` and the word "extra" are what the book uses to say "on top of", so they
 * are what is read.
 *
 * A NUMBER THAT IS NOT BEING DEALT TO ANYONE. The Ring of Daagon's summoning table prints
 * "1 = horde (2d6, HP 3, d6 damage)", and the Mindgem's "its damage becomes 1d10+5" is a weapon
 * being rewritten. Both name a die beside the word damage and neither is a blow anybody is
 * striking now, so a VERB is required as well: someone has to take, suffer, deal or lose it.
 *
 * WHO TAKES IT is read off the pronouns, because it decides which side of the table the card
 * points at. "They take 2d4 damage" is the foe you just bound; "take 2d4 damage (ignores armor)
 * and mark weakened" (the cracked femur), sitting in a sentence about YOUR heat being sucked
 * away, is you. Nothing is applied on the strength of that reading alone: the card names whose
 * HP it is aimed at and waits for a second, deliberate click before a point of it moves.
 *
 * @param {string} text  one printed option's plain text
 * @returns {{formula: string, isRoll: boolean, self: boolean, ignoresArmor: boolean,
 *            piercing: number, tags: string[]}|null}
 *   null when the line deals no damage of its own. `formula` is always something Foundry's Roll
 *   accepts (a flat "3" is as valid a formula as "2d4"), and `isRoll` says whether there is
 *   really a die to throw, which is the difference between a button that offers to roll and one
 *   that just deals the number.
 */

// The die (or flat count) immediately before the word "damage": "2d4 damage", "1d10+2 damage",
// "3 points of damage". Anchored on "damage" rather than scanning for a die anywhere in the line,
// so an option that mentions a foe's HP, a debility count or a Value in the same breath cannot
// have one of those numbers read as the blow.
const OPTION_DAMAGE_RE = /(\d*\s*d\s*\d+(?:\s*[+-]\s*\d+)?|\d+)\s*(?:points?\s+of\s+)?damage\b/i;

// Someone has to be taking it. A roll-call of the verbs the books actually use, not a wildcard:
// what this keeps out is a stat line that names a damage die without anybody striking with it.
const DAMAGE_VERB_RE = /\b(?:takes?|taking|suffers?|suffering|deals?|dealing|inflicts?|inflicting|loses?|losing|burns?|hurts?)\b/i;

// "1d6 extra damage", "add 1d6 to a damage roll": a number that rides another roll rather than
// being one, said in words. The other half of that rule is the SIGN, and it is not read here but
// against what sits immediately before the match (see below), because a sign inside the die
// expression itself is not a bonus at all: "d10+2 damage" is one number, and a pattern scanning
// the raw line for a signed damage term finds its "+2" and throws the whole blow away.
const BONUS_DAMAGE_RE = /\bextra\s+damage\b|\badds?\b[^.;]*\bdamage\s+roll\b/i;

// The armor clauses the books print beside a damage number, in the two forms the flow already
// knows how to apply (utils/damage.js#mitigateDamage): a full bypass, and a count of armor points
// pierced. Read here so a "(ignores armor)" on the bullet reaches the card that applies it.
export const IGNORES_ARMOR_RE = /\bignores?\s+armou?r\b/i;
export const PIERCING_RE = /\b(\d+)\s+piercing\b/i;

/**
 * The flavour tags that live ONLY in the fiction, and so the ones the damage card reminds the
 * table about (combat/attack-flow.js#TAG_NOTES, which carries one note per name here).
 *
 * `+N damage`, piercing and "ignores armor" are NOT on this list: they ride the numbers and are
 * already printed in the card's own fine print (attack-flow.js#damageRowDetail), so a note would
 * be saying twice what the card says once. Neither is `area`, which is said by the several
 * targets the card is already rolling for, nor `awkward`, which is about swinging the thing and
 * so applies before the roll rather than to the blow that landed.
 *
 * THE ORDER HERE IS THE ORDER THEY PRINT IN, and it is this list's rather than the book's: the
 * Bear of Winter's "(close, hand, reach, forceful, grabby, messy, 1 piercing)" and the Stone
 * Sentinel's "(hand, close, grabby, messy, forceful, 3 piercing)" are the same three
 * consequences, and a table reading one after the other should meet them the same way down.
 */
export const FICTION_DAMAGE_TAGS = ["messy", "forceful", "grabby", "crude", "reload", "dangerous"];

// Read out of a printed line by WORD BOUNDARY rather than matched whole, because the books don't
// always print a tag alone in its slot: the Nine-Fingered Stranger swings "(tags by weapon,
// +forceful)" and the Adventurer "(hand, close, maybe forceful or messy)". Both are the tag said
// with a qualifier, and a lookup keyed on the whole slot drops them without a word.
const FICTION_TAG_RE = new RegExp(String.raw`\b(${FICTION_DAMAGE_TAGS.join("|")})\b`, "gi");

/**
 * The fiction tags a printed line carries, in FICTION_DAMAGE_TAGS order.
 *
 * ONE SCAN FOR BOTH READERS. A move's ticked bullet is read off a sentence and a stat block's is
 * read off a tag list, but "which of these six words is in there" is the same question and the
 * word-boundary rule above is the same answer; asked twice it is two chances to drift, and the
 * card that prints the notes (combat/attack-flow.js#tagNoticesHtml) was compiling six regexes of
 * its own per post to ask it.
 *
 * The ORDER IS THIS LIST'S, not the line's, which is the reason to filter the list rather than
 * collect the matches: the Bear of Winter and the Stone Sentinel print the same three
 * consequences in different sequences, and a table meeting them should meet them the same way
 * down whichever one just swung.
 *
 * @param {string} text  a TAG LIST — a stat block's parenthetical, or one joined from an item's
 *   tags. Not free prose: see {@link _tagListsIn} for why a bullet is narrowed down first.
 * @returns {string[]}   the tags present, deduped, in declaration order.
 */
export function fictionTagsIn(text) {
	const found = new Set(Array.from(String(text ?? "").matchAll(FICTION_TAG_RE), m => m[1].toLowerCase()));
	return FICTION_DAMAGE_TAGS.filter(tag => found.has(tag));
}

/**
 * The tag list printed WITH a damage expression — the parenthetical the die sits inside, or the
 * one that follows it. "" when the die was printed with no tags at all.
 *
 * A move's bullet is a sentence, and four of the six fiction tags are ordinary English words. Read
 * off the whole bullet, "they take 2d4 damage and are left in a dangerous position" grows a
 * "Dangerous. It causes trouble and collateral damage…" note on the damage card. When two of the
 * six were `messy` and `forceful` the scan could afford a whole sentence; with `crude`, `reload`,
 * `dangerous` and `grabby` in it, it cannot.
 *
 * NOT EVERY PARENTHETICAL EITHER, because a line can carry two and mean different things by them:
 * "Bright-sticks (fragile, dangerous, Value 1): snap one and whoever holds it takes d8 damage
 * (messy)" tags the BOX dangerous and the burn messy, and only the burn is what the card is about.
 * So the list is found from the die outwards, which is also how the book prints one: "(1d8 damage,
 * messy, ignores armor)" wraps its die, "d8+2 damage (area, forceful)" follows it.
 *
 * @param {string} line  the whole bullet
 * @param {number} at    where the damage expression starts within it
 */
function _damageTagList(line, at) {
	for (const group of String(line ?? "").matchAll(/\(([^)]*)\)/g)) {
		// The die inside this list, or this list the first thing printed after the die. A list
		// that closed before the die belongs to whatever was being described before it.
		if (at < group.index + group[0].length) return group[1];
	}
	return "";
}

export function readOptionDamage(text) {
	const line = String(text ?? "");
	if (!line || BONUS_DAMAGE_RE.test(line)) return null;
	if (!DAMAGE_VERB_RE.test(line)) return null;
	const match = OPTION_DAMAGE_RE.exec(line);
	if (!match) return null;

	// A SIGN IN FRONT OF THE NUMBER means it is being added to something else, and the something
	// else is not on this card: "Deal +1d4 damage" (Ambush) is a die the attack's own Confirm
	// folds in, and "small (-2 HP, -2 damage, hand)" is a beast being sized on a summoning table.
	// Read off what precedes the MATCH rather than off the line, so the "+2" inside "d10+2
	// damage" (which the pattern above has already taken as part of the die) is left alone.
	const before = line.slice(0, match.index).trimEnd();
	if (before.endsWith("+") || before.endsWith("-")) return null;

	// Foundry's Roll wants "1d6", not "d6" or "2d4 + 1".
	const formula = match[1].replace(/\s+/g, "").replace(/^d/i, "1d");
	// "They" wins over "you" wherever both appear: "they take 2d4 damage" in a move whose trigger
	// is written at you is the foe's damage, and the trigger is in the same string.
	const them = /\b(?:they|them|their|its|the\s+target)\b/i.test(line);
	return {
		formula,
		isRoll: /d/i.test(formula),
		self: !them && /\byou(?:r|rself)?\b/i.test(line),
		ignoresArmor: IGNORES_ARMOR_RE.test(line),
		piercing: Number(PIERCING_RE.exec(line)?.[1]) || 0,
		tags: fictionTagsIn(_damageTagList(line, match.index)),
	};
}

/**
 * The printed attacks in a monster's damage line, one entry per die the GM could roll.
 *
 * A stat block's `damage.value` is PROSE, and for 68 of the 211 shipped bestiary entries that
 * prose holds more than one attack: the Rime Lord's "conjured ice d12+3 (any range, area, grabby,
 * forceful) or heat-drain d12+1 (reach, ignores armor)", the Bronze Colossus's three, the
 * Spirit-talker's four. `damage.rollFormula` carries exactly ONE of them — the primary — which is
 * all a single auto-rolled number ever needed. It is not enough to ASK which attack was made, and
 * the difference is not cosmetic: those two Rime Lord attacks differ by a point of damage and by
 * whether the victim's armor counts at all.
 *
 * THE SEPARATOR IS COMMA-OR-"OR", AND ONLY OUTSIDE PARENTHESES. Every tag list is itself
 * comma-separated, so a flat split on "," tears "antler of jagged bone d10+2 (close, messy, 1
 * piercing)" into three pieces, two of which are tags wearing an attack's clothes.
 *
 * A BARE FRAGMENT WITH NO DIE IS PART OF THE NEXT ATTACK'S NAME, not an attack of its own. The
 * books write one blow under several names — "bite, maul d12+5", "talons, antlers d6+2",
 * "whirlwind of pecks, claws, and buffets d8+3" — and those commas are the same character as the
 * separator. The die is what settles it: the Spirit-talker's "flint-tipped spear d8 (close,
 * thrown, crude), club, adz d8 (hand, crude), bow d8 (near)" is three attacks, the middle one
 * named "club, adz".
 *
 * ⚠ UNLESS IT BROUGHT ITS OWN TAG LIST, in which case it is a WHOLE printed attack that happens
 * to roll no damage. The Thraulgwyn Raider's "…, hair-rope net (thrown, crude, grabby), bite d6
 * (hand)" is four attacks, and the net is one of them: it is thrown, it grabs, and it deals
 * nothing. Folding it into the bite lost the raider an attack, put "hair-rope net, bite" on one
 * button, and handed the bite the net's tags — which is how an "ignores armor" or an "N piercing"
 * clause ends up on the wrong blow, changing what reaches the character. A name fragment never
 * carries parentheses; a printed attack that deals no damage always does.
 *
 * Each entry carries its OWN armor clause, because that is the whole point of being asked:
 *   label        the attack's name as printed ("heat-drain"), "" when it has none
 *   formula      its die, as printed ("d12+1") — fed to Roll, which takes a bare leading `d`
 *   tags         its parenthesised tags, lowercased
 *   piercing     armor points this attack pierces, 0 when it says nothing
 *   ignoresArmor whether it bypasses armor entirely
 *   rollMode     "adv" | "dis" | "normal" — the stat line's own "w/advantage" on the DAMAGE die
 *
 * Falls back to `rollFormula` as a single unnamed attack when the prose holds no die at all, so a
 * hand-written stat block that filled in only the formula still rolls. Returns [] when there is
 * nothing to roll — the 22 spirits whose damage line reads "none" with no formula beside it.
 *
 * Verified against every shipped stat block: for the 121 single-attack entries carrying both, the
 * die read out of the prose and `rollFormula` agree in all 121 cases, so reading the prose first
 * changes no number that was already being rolled.
 */
export function parseMonsterAttacks(damageValue, rollFormula = "") {
	// The split keeps a trailing name that never found a die, because the SHEET still has to print
	// it. Here it is not an attack: "none" and "by weapon" are lines with nothing to roll, and an
	// attack read out of them would be a die the book never gave this foe.
	const attacks = _splitPrintedAttacks(damageValue)
		.map(entry => entry.mechanical)
		.filter(text => DAMAGE_DIE_RE.test(text) || _TAG_LIST_RE.test(text))
		.map(_readAttack);
	if (attacks.length) return attacks;

	const fallback = String(rollFormula ?? "").trim();
	return fallback ? [_readAttack(fallback)] : [];
}

/**
 * The same split, handed back as the PRINTED TEXT of each attack rather than as its parts —
 * "bite or maul d12+5 (close, hand, …)", separators and all.
 *
 * The stat-block sheet lists a foe's attacks one per line, each with its own roll button, and it
 * prints the book's own words beside the die. So it needs exactly the grouping
 * {@link parseMonsterAttacks} does — that is how it learns the Assassin's "dagger d10 (hand, 1
 * piercing) or garrote d8 (hand, grabby, ignores armor)" is TWO attacks and owes the garrote a
 * button of its own — but it must not lose the wording to a reconstruction from the parts.
 *
 * Names folded into ONE attack keep the separator that joined them, so the Bear of Winter's blow
 * still reads "bite or maul" and not "bite, maul". A trailing fragment with no die of its own
 * names nothing; it joins the attack before it, so no printed word is dropped.
 *
 * @param {string} damageValue A stat block's `system.attributes.damage.value`.
 * @returns {string[]} One verbatim string per printed attack.
 */
export function splitMonsterAttackProse(damageValue) {
	return _splitPrintedAttacks(damageValue).map(entry => entry.printed);
}

/**
 * The split both readers share, each attack given twice over:
 *   printed     the book's own words, which is what the sheet puts on the line
 *   mechanical  the part of them that says what the attack DOES, which is what gets parsed
 *
 * They differ in exactly one place, and it is the trailing fragment. A fragment with no die names
 * nothing, so `printed` hands it to the attack before it rather than drop a word the book wrote —
 * but {@link _readAttack} scans the string it is given for a tag list, an "N piercing" and an
 * "ignores armor", and would read the fragment's words as that attack's own. A line ending
 * "…, and 2 piercing on a charge" would give the blow before it `piercing: 2`, which
 * `wireApplyDamage` then takes off the target's armor: an attack made stronger by a clause that
 * was never part of it. `mechanical` stops at the last thing that was actually an attack.
 */
function _splitPrintedAttacks(damageValue) {
	const attacks = [];
	// Names seen since the last die, with the separators that joined them, waiting for the attack
	// whose name they are part of. Kept as text, not a list, so the joins stay the book's own.
	let pending = "";
	// The separator that ended the last attack pushed. A trailing fragment is given back to that
	// attack with the punctuation the book put between them, for the same reason the folded names
	// keep theirs: re-joining "claws d8 (close) or thrashing tail" with a comma prints a line the
	// book never wrote.
	let joinSeparator = "";
	const push = (printed, separator) => {
		attacks.push({ printed, mechanical: printed });
		pending = "";
		joinSeparator = separator;
	};
	for (const { text, separator } of _splitAttackSegments(String(damageValue ?? ""))) {
		const printed = pending + text;
		if (!DAMAGE_DIE_RE.test(text)) {
			// Its own tag list makes it an attack in its own right, die or no die — so it is
			// flushed here, ahead of anything still pending, rather than joining the next blow.
			if (_TAG_LIST_RE.test(text)) push(printed, separator);
			else pending = printed + separator;
			continue;
		}
		push(printed, separator);
	}
	// Names left at the end have no attack to name. Rather than drop what the book printed, give
	// them to the last attack; with no attack at all they stand alone, as a line with no die.
	const leftover = pending.replace(_TRAILING_SEPARATOR_RE, "");
	if (leftover) {
		if (attacks.length) attacks[attacks.length - 1].printed += `${joinSeparator || ", "}${leftover}`;
		else attacks.push({ printed: leftover, mechanical: leftover });
	}
	return attacks;
}

/** The separator left dangling on a trailing fragment, which has nothing after it to join to. */
const _TRAILING_SEPARATOR_RE = /\s*(?:,\s*)?(?:\bor\b)?\s*$/i;

/** A parenthesised tag list, which is what a die-less segment needs to be an attack of its own
 *  rather than another name for the next one. */
const _TAG_LIST_RE = /\([^)]*\)/;

/**
 * Split a damage line on its attack separators, ignoring the ones inside a tag list.
 * Depth-counted rather than split by regex because the two uses share the same comma.
 *
 * Each segment carries the separator that ENDED it, so a caller re-joining two of them can print
 * the book's own " or " rather than inventing a comma in its place.
 */
function _splitAttackSegments(prose) {
	// One separator regex per scan: it is sticky, so `lastIndex` is state, and a shared instance
	// would carry this scan's stopping point into whatever asked next (damage-die.js says more).
	const separatorRe = attackSeparatorRe();
	const out = [];
	let depth = 0;
	let start = 0;
	let i = 0;
	while (i < prose.length) {
		const ch = prose[i];
		if (ch === "(") depth++;
		else if (ch === ")") depth = Math.max(0, depth - 1);
		if (depth === 0) {
			separatorRe.lastIndex = i;
			const hit = separatorRe.exec(prose);
			if (hit) {
				out.push({ text: prose.slice(start, i), separator: hit[0] });
				i += hit[0].length;
				start = i;
				continue;
			}
		}
		i++;
	}
	out.push({ text: prose.slice(start), separator: "" });
	return out
		.map(segment => ({ text: segment.text.trim(), separator: segment.separator }))
		.filter(segment => segment.text);
}

/**
 * "w/advantage", "w/disadvantage", or the bare word inside a tag list (a few stat blocks print it
 * that way). `(dis)?` is part of ONE pattern rather than two tests because "disadvantage" contains
 * "advantage", and a test for the shorter one first calls every disadvantage an advantage.
 */
const _ATTACK_ADVANTAGE_RE = /\b(dis)?advantage\b/i;

/**
 * Whether a printed attack rolls its damage at advantage or disadvantage: "adv", "dis", or "" for
 * the ordinary single roll. One rule, read the same way by the stat-block sheet's roll buttons and
 * by the attack the combat flow asks about.
 *
 * @param {string} text One printed attack, as the book writes it.
 * @returns {"adv"|"dis"|""}
 */
export function attackRollMode(text) {
	const hit = _ATTACK_ADVANTAGE_RE.exec(String(text ?? ""));
	return hit ? (hit[1] ? "dis" : "adv") : "";
}

/** The item types a stat block keeps its moves in: a monster's, and a person's. */
const _MOVE_ITEM_TYPES = new Set(["monsterMove", "npcMove"]);

/**
 * EVERY attack a foe could have just made: the ones printed on its damage line, and then the ones
 * its MOVES roll.
 *
 * A SECOND ATTACK DOES NOT HAVE TO LIVE ON THE DAMAGE LINE, and the book is the reason. The
 * Dangers worksheet gives a monster one damage value and routes anything else through a move —
 * "it has a special form of attack: a move describing it, with tags and (if appropriate) an
 * alternative damage value" — so 19 shipped stat blocks put a whole second blow on a
 * `monsterMove` carrying its own `rollFormula`: Draventao's sticky fire, Bhoka's lightning, the
 * Gwraig Wen's wail.
 *
 * Reading only `damage.value` left every one of them unreachable from Clash: the Gwyllgi offered
 * its claws and its bite and never its baleful cloud, and 13 foes whose printed line holds one
 * blow struck with that blow automatically, their second never on offer at all. Across the 212
 * shipped stat blocks, 17 gain an attack here.
 *
 * A MOVE'S NAME IS ITS PRINTED ATTACK, and it reads exactly the way a damage line does: "Breathe
 * sticky fire, d10+3 damage (near, area, grabby, messy, reload, ignores armor)" names the blow,
 * lists its tags, and says it ignores armor. Only the DIE comes from elsewhere — `rollFormula`,
 * the same field the sheet's own roll button uses — because a few names print it as "1d10+3" or
 * bury it inside the tag list, and the field is the one the GM edited.
 *
 * A move with no `rollFormula` is not an attack and is not offered. That field is the whole
 * signal: it is what makes the sheet draw the move a roll button in the first place.
 *
 * @param {Actor} actor The foe, or null.
 * @returns {ReturnType<typeof parseMonsterAttacks>} Printed attacks first, then move attacks.
 */
export function foeAttacks(actor) {
	const damage = actor?.system?.attributes?.damage ?? {};
	const printed = parseMonsterAttacks(damage.value, damage.rollFormula);
	const moves = actor?.items?.filter?.(item =>
		_MOVE_ITEM_TYPES.has(item?.type) && String(item?.system?.rollFormula ?? "").trim()) ?? [];
	return [...printed, ...moves.map(_readMoveAttack)];
}

/** One attack a MOVE rolls: read out of its name, at the die its own field carries. */
function _readMoveAttack(item) {
	const name = String(item?.name ?? "");
	const attack = _readAttack(name);
	return {
		...attack,
		// A name that is nothing but its die ("d8+2 damage") leaves no label behind; the move's own
		// name is then the only thing to call it, which is better on a button than "Attack".
		label: attack.label || name.trim(),
		formula: String(item?.system?.rollFormula ?? "").trim().replace(/\s+/g, ""),
	};
}

/** One printed attack — its name, its die, and the armor clause it carries. */
function _readAttack(text) {
	const formula = (dieFromDamage(text) ?? "").replace(/\s+/g, "");
	// Everything before the die is what the book calls this blow; the parenthesised tail is tags.
	// With no die at all, the tag list is still the tail and still not part of the name — the
	// raider's net is called "hair-rope net", not "hair-rope net (thrown, crude, grabby)".
	const named = formula ? text.slice(0, text.search(DAMAGE_DIE_RE)) : text.replace(/\([^)]*\)/g, " ");
	// A trailing "(" or ":" is punctuation the die was about to follow, not part of the name:
	// "Smother a prone foe with soil, leaves, and wood (d8+1 damage, near, grabby)" is called
	// "…and wood", and "Spew a cloud of corrosive goo: d8 damage (area, close)" drops its colon.
	const label = named.replace(/\s+/g, " ").trim().replace(/[,;:(]+$/, "").trim();
	return {
		label,
		formula,
		tags: Array.from(text.matchAll(/\(([^)]*)\)/g))
			.flatMap(group => group[1].split(","))
			.map(tag => tag.trim().toLowerCase())
			.filter(Boolean),
		piercing: Number(PIERCING_RE.exec(text)?.[1]) || 0,
		ignoresArmor: IGNORES_ARMOR_RE.test(text),
		rollMode: attackRollMode(text) || "normal",
	};
}
