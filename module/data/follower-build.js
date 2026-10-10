// Follower-building data & helpers (Book I, "NPCs & Followers" — Creating
// followers, pp.474–479). This is the rules content behind the Create-a-Follower
// walkthrough and the monster→follower conversion. It's deliberately
// framework-free (no Foundry globals) so the derivations can be unit-tested and
// reused by both dialogs and the character sheet.

import { creatureTypeFaIcon } from "../bestiary/creature-types.js";
import { isDefaultImg } from "../utils/strings.js";
import { customGroupSize } from "../utils/crew.js";
import { addDamageBonus } from "../utils/damage-die.js";
import { documentPortraitFrame } from "../utils/portrait-frame.js";

// ── Step 3: hit points (p.476–477) ───────────────────────────────────────────
// "How resilient are they? (pick 1)" then "What else applies? (pick all)".
export const FOLLOWER_HP_BASE = [
	{ key: "weak",  label: "Weak / frail / soft", hp: 3 },
	{ key: "able",  label: "Able-bodied",         hp: 6 },
	{ key: "tough", label: "Tough / strong / hard", hp: 9 },
];
export const FOLLOWER_HP_MODS = [
	{ key: "tiny",  label: "They are tiny",         hp: -2 },
	{ key: "large", label: "They are large",        hp: 4 },
	{ key: "fates", label: "The fates smile on them", hp: 2 },
];

// ── Step 4: armor (p.477) ────────────────────────────────────────────────────
export const FOLLOWER_ARMOR_BASE = [
	{ key: "cloth",   label: "Naught but cloth and flesh", armor: 0 },
	{ key: "leather", label: "Leathers or thick hide",     armor: 1 },
	{ key: "mail",    label: "Mail, scale, or similar",    armor: 2 },
	{ key: "steel",   label: "Steel, boney plates, carapace", armor: 3 },
	{ key: "magical", label: "Potent magical wards or supernatural resilience", armor: 4 },
];
export const FOLLOWER_ARMOR_MODS = [
	{ key: "tiny",    label: "They are tiny",          armor: 1 },
	{ key: "shield",  label: "They bear a shield or similar", armor: 1 },
	{ key: "skilled", label: "They are skilled in defense", armor: 1 },
	{ key: "organs",  label: "They lack vital organs", armor: 1 },
];

// ── Step 5: damage (p.477) ───────────────────────────────────────────────────
// "How dangerous are they? (pick 1)". Range and other tags come from gear.
export const FOLLOWER_DAMAGE_OPTIONS = [
	{ key: "weak",    label: "Not very",                  die: "d4" },
	{ key: "defends", label: "Can defend themselves",     die: "d6" },
	{ key: "veteran", label: "Veteran fighter or predator", die: "d8" },
];

// "Range and other tags come from their gear." Offered as chips on the damage
// step (grounded in the weapon ranges & tags used across Stonetop's gear); the
// player can also type their own. Selected chips + custom entries become the
// damage parenthetical, e.g. d6 (near, low ammo, forceful).
export const FOLLOWER_DAMAGE_TAG_GROUPS = [
	{ label: "Range", tags: ["hand", "close", "reach", "near", "far"] },
	{ label: "Gear tags", tags: [
		"forceful", "messy", "piercing", "thrown", "reload", "low ammo",
		"precise", "slow", "stun", "dangerous", "awkward", "grabby",
	] },
];

// ── Step 2: tags (p.476) ─────────────────────────────────────────────────────
// "Give followers a mix of tags that are useful, problematic, and mixed
// blessings." Offered as suggestions; the walkthrough also takes free-text tags.
export const FOLLOWER_TAG_GROUPS = [
	{ label: "Useful", tags: [
		"agile", "archer", "athletic", "beautiful", "brave", "cunning", "fast",
		"fierce", "hardy", "healer", "intimidating", "magical", "observant",
		"organized", "patient", "respected", "self-sufficient", "sharp-eyed",
		"stealthy", "tireless", "tracker", "warrior",
	] },
	{ label: "Problematic", tags: [
		"bigoted", "drunk", "greedy", "gullible", "lecherous", "naive", "proud",
		"rookie", "reckless", "short-fused", "stubborn", "frail",
	] },
	{ label: "Mixed blessing", tags: [
		"animal-lover", "annoying", "big", "bully", "callous", "cautious",
		"devious", "eager", "thieving", "gossipy", "honest", "kind", "little",
		"shameless", "terrifying",
	] },
];

// ── Step 6: instinct prompts for a follower (p.478) ──────────────────────────
// A follower's instinct "should cause trouble for the PC who leads them."
export const FOLLOWER_INSTINCT_EXAMPLES = [
	"To take things too far",
	"To question leadership and authority",
	"To cling tightly to tradition",
	"To act impulsively",
	"To give in to temptation",
	"To not take things seriously",
	"To freeze up in the face of danger",
];

// ── Step 8: cost (p.479) ─────────────────────────────────────────────────────
export const FOLLOWER_COST_EXAMPLES = [
	"Coin, payment, treasure",
	"Renown, public recognition",
	"Affection, respect (from you)",
	"Knowledge (about what?)",
	"Wrongs righted, good deeds done",
	"Amusement, entertainment",
	"Progress (towards a particular goal)",
];

// Sum a base option's value with the chosen modifiers' values, never below the
// floor (HP can't fall below 1; armor not below 0).
function _sum(base, mods, picks, field, floor) {
	const baseVal = base.find(o => o.key === picks?.base)?.[field] ?? 0;
	const set = new Set(Array.isArray(picks?.mods) ? picks.mods : []);
	const modVal = mods.reduce((t, o) => t + (set.has(o.key) ? o[field] : 0), 0);
	return Math.max(floor, baseVal + modVal);
}

/** Derived max HP from a {base, mods} pick. Floors at 1. */
export function deriveHp(picks) {
	return _sum(FOLLOWER_HP_BASE, FOLLOWER_HP_MODS, picks, "hp", 1);
}

/** Derived armor from a {base, mods} pick. Floors at 0. */
export function deriveArmor(picks) {
	return _sum(FOLLOWER_ARMOR_BASE, FOLLOWER_ARMOR_MODS, picks, "armor", 0);
}

/** The damage die for a chosen "how dangerous" key (e.g. "defends" → "d6"). */
export function deriveDamageDie(key) {
	return FOLLOWER_DAMAGE_OPTIONS.find(o => o.key === key)?.die ?? "d6";
}

// Join a damage die with an optional parenthetical form, e.g. ("d6", "hand") →
// "d6 (hand)". A form already wrapped in parens is left as-is.
export function formatDamage(die, form) {
	const d = String(die ?? "").trim();
	const f = String(form ?? "").trim().replace(/^\(|\)$/g, "").trim();
	if (!d) return f ? `(${f})` : "";
	return f ? `${d} (${f})` : d;
}

// Extract a follower's numeric armor from a value that may already be a number,
// a plain string ("2"), the book's conditional form ("2 (0 vs. iron)"), or a
// placeholder ("—"). Returns the leading non-negative integer, or 0 when there's
// no number. Followers don't model conditional armor, so the "(0 vs. iron)"
// remainder is dropped here — keep it in a notes field if it matters.
export function parseFollowerArmor(raw) {
	if (typeof raw === "number") return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
	const m = String(raw ?? "").match(/-?\d+/);
	return m ? Math.max(0, parseInt(m[0], 10)) : 0;
}

// Normalize a free-text or array tag list into a clean, de-duplicated array of
// trimmed strings (case-insensitive de-dupe, first spelling wins).
export function normalizeTags(tags) {
	const out = [];
	const seen = new Set();
	const push = (t) => {
		const s = String(t ?? "").trim();
		if (!s) return;
		const k = s.toLowerCase();
		if (seen.has(k)) return;
		seen.add(k);
		out.push(s);
	};
	if (Array.isArray(tags)) tags.forEach(push);
	else String(tags ?? "").split(",").forEach(push);
	return out;
}

// ── Hand-edited tags (Updating followers, p.480) ─────────────────────────────
// "If any of their tags or moves no longer ring true, then delete them or revise them ... if
// they've shown a new aptitude, skill or behavior, consider adding it as a tag." A custom
// follower's tags are its own stored list, edited in place (editTagList). Every other type
// derives its tags from the rules (a crew's picks, a companion's traits, a beast's catalog
// entry), so its edits are a layer over them: tags added, and derived tags dropped.

const _tagKey = t => String(typeof t === "string" ? t : t?.label ?? "").trim().toLowerCase();

/**
 * A card's tags with its edit layer applied: the derived ones less any dropped, then any added
 * that it doesn't already carry. Matched without case. Entries may be strings or `{label}`
 * chips and come back as chips, the added ones marked `added`.
 */
export function applyTagEdits(tags, { extraTags, droppedTags } = {}) {
	const dropped = new Set(normalizeTags(droppedTags).map(_tagKey));
	const kept = (tags ?? [])
		.map(t => (typeof t === "string" ? { label: t } : t))
		.filter(t => t?.label && !dropped.has(_tagKey(t)));
	const have = new Set(kept.map(_tagKey));
	const added = normalizeTags(extraTags).filter(t => !have.has(_tagKey(t))).map(label => ({ label, added: true }));
	return [...kept, ...added];
}

/**
 * The edit layer after adding or removing `tags` (a list, or comma-separated text). Adding a
 * dropped tag puts it back rather than adding a copy; removing an added tag takes it off the
 * list rather than dropping it.
 *
 * @param {{extraTags?: string[], droppedTags?: string[]}} layer
 * @param {"add"|"remove"} action
 * @returns {{extraTags: string[], droppedTags: string[]}}
 */
export function editTagLayer({ extraTags, droppedTags } = {}, action, tags) {
	let extras  = normalizeTags(extraTags);
	let dropped = normalizeTags(droppedTags);
	const has = (list, k) => list.some(t => _tagKey(t) === k);
	const without = (list, k) => list.filter(t => _tagKey(t) !== k);
	for (const tag of normalizeTags(tags)) {
		const k = _tagKey(tag);
		if (action === "add") {
			if (has(dropped, k)) dropped = without(dropped, k);
			else extras = normalizeTags([...extras, tag]);
		} else if (action === "remove") {
			if (has(extras, k)) extras = without(extras, k);
			else dropped = normalizeTags([...dropped, tag]);
		}
	}
	return { extraTags: extras, droppedTags: dropped };
}

/** A custom follower's own tag list after adding or removing `tags`. */
export function editTagList(list, action, tags) {
	const edits = normalizeTags(tags);
	if (action === "add") return normalizeTags([...normalizeTags(list), ...edits]);
	const gone = new Set(edits.map(_tagKey));
	return normalizeTags(list).filter(t => !gone.has(_tagKey(t)));
}

/**
 * Build the stored shape for a custom follower (the object kept at
 * flags.stonetop-pwd.customFollowers.<id>). Pure: the caller assigns the id and
 * an `order` for stable sorting. hpCurrent defaults to full unless given.
 */
export function buildCustomFollower(input = {}) {
	const hpMax = Math.max(0, Math.trunc(Number(input.hp) || 0));
	const hpCurrent = input.hpCurrent == null
		? hpMax
		: Math.min(hpMax, Math.max(0, Math.trunc(Number(input.hpCurrent) || 0)));
	const gear = (Array.isArray(input.gear) ? input.gear : [])
		.map(g => (typeof g === "string"
			? { label: g.trim(), checked: false }
			: { label: String(g?.label ?? "").trim(), checked: !!g?.checked }))
		.filter(g => g.label);
	// Group followers (NPCs & Followers p.470): a warband, posse, or converted
	// group-organization monster. `isGroup` turns on the roster + group-fight tools
	// (per-member HP against the shared `hpMax`, an abstracted group-HP pool, and the
	// outnumber calculator); `size` is the headcount. A group is at least 2 strong.
	const isGroup = !!input.isGroup;
	const size = isGroup ? customGroupSize(input) : 0;
	return {
		name:         String(input.name ?? "").trim(),
		pronoun:      String(input.pronoun ?? "").trim(),
		typeLabel:    String(input.typeLabel ?? "").trim() || (isGroup ? "group follower" : "follower"),
		portraitIcon: String(input.portraitIcon ?? "").trim() || (isGroup ? "fas fa-users" : "fas fa-user"),
		// A chosen portrait, shown on the card in place of the glyph above. Empty is the
		// normal state and means "no portrait", which is exactly what falls the card back to
		// portraitIcon — so a follower never needs one and nothing has to be migrated.
		img:          String(input.img ?? "").trim(),
		// The square of that portrait the source actor was already framed to (a People of Stonetop
		// face cropped on the steading roster), kept only beside a portrait it was measured on.
		...(String(input.img ?? "").trim() && input.portraitFrame && typeof input.portraitFrame === "object"
			? { portraitFrame: input.portraitFrame } : {}),
		tags:         normalizeTags(input.tags),
		hpMax,
		hpCurrent,
		armor:        parseFollowerArmor(input.armor),
		damage:       String(input.damage ?? "").trim(),
		instinct:     String(input.instinct ?? "").trim(),
		moves:        String(input.moves ?? "").trim(),
		cost:         String(input.cost ?? "").trim(),
		notes:        String(input.notes ?? "").trim(),
		gear,
		butcher:      input.butcher ? String(input.butcher).trim() : null,
		loyalty:      Math.max(0, Math.trunc(Number(input.loyalty) || 0)),
		isGroup,
		size,
		sourceUuid:   input.sourceUuid ? String(input.sourceUuid) : null,
	};
}

/**
 * The portrait a follower recruited from an existing actor should wear: that actor's own
 * art, so the card shows the face the table already knows rather than a generic glyph.
 *
 * A stock placeholder is not art. Carrying one across would trade the follower type's
 * meaningful glyph (a paw, a seedling, a crowd) for Foundry's mystery-man silhouette, so
 * it resolves to "" and the glyph keeps the slot.
 */
function sourceActorImg(img) {
	return isDefaultImg(img) ? "" : String(img ?? "").trim();
}

// ── Order Followers roll math (p.462) ────────────────────────────────────────
// "Instead of rolling +STAT, roll and… +1 if they have at least one appropriate
// tag or move, or +2 if they're also exceptional; +0 if no relevant tag or move;
// roll with disadvantage if any of their tags would get in the way." Which tags
// help or hinder is a table judgment call, so the caller passes the counts the
// player resolved rather than this guessing from tag text.
//
// `helps` is how many of the follower's tags AND moves the player marked as
// applicable — the book counts both toward the bonus ("at least one appropriate
// tag or move"). `hinders` is tags only: only a tag can get in the way.
// `advantage`/`disadvantage` are the outside sources that don't come from the
// follower at all (Stentorian, Aid, Seek Insight; Interfere, a GM move), which is
// why they're separate toggles rather than more chips.
//
// Returns { bonus, rollMode } ready for rollStat. Note the rulebook edge case: an
// exceptional follower with no other applicable tag is still +0 — only helps > 0
// earns the +1/+2.
export function orderFollowersBonus({ helps = 0, hinders = 0, exceptional = false, advantage = false, disadvantage = false } = {}) {
	const h = Math.max(0, Math.trunc(Number(helps)   || 0));
	const x = Math.max(0, Math.trunc(Number(hinders) || 0));
	const bonus = h <= 0 ? 0 : (exceptional ? 2 : 1);
	// Advantage and disadvantage are binary and CANCEL each other out (p.230), so a
	// hindering tag does not simply beat an outside source of advantage: a Marshal
	// spending Command on Stentorian to order a follower whose mischievous tag is in
	// the way rolls a straight 2d6. Neither side stacks either — "by default, it
	// doesn't matter if you have multiple sources of advantage vs. a single source of
	// disadvantage" — so this is a boolean XOR, not a tally.
	const sources = orderFollowersModeSources({ hinders: x, advantage, disadvantage });
	const adv = sources.includes("adv");
	const dis = sources.includes("dis");
	const rollMode = adv === dis ? "normal" : (adv ? "adv" : "dis");
	return { bonus, rollMode };
}

/**
 * The sides that spoke on an Order Followers roll, `["adv"]`, `["adv", "dis"]` and so on: what
 * orderFollowersBonus nets into its `rollMode`, kept as SOURCES for the roll, so a cancelled pair stays
 * cancelled when one more side is laid on it (We Happy Few's nerves: roll-mode.js#layModes).
 */
export function orderFollowersModeSources({ hinders = 0, advantage = false, disadvantage = false } = {}) {
	const dis = Math.trunc(Number(hinders) || 0) > 0 || !!disadvantage;
	return [...(advantage ? ["adv"] : []), ...(dis ? ["dis"] : [])];
}

// ── Readiness cap (Defend, p.216 / followers p.469) ──────────────────────────
// A follower (or crew) holds up to 3 Readiness on a 10+ Defend, 1 on a 7–9; a
// borne shield adds +1 to either, raising the cap to 4. Centralized so the pip
// builders and the on-sheet tooltips read the same numbers.
export const READINESS_BASE_CAP = 3;
export const READINESS_SHIELD_BONUS = 1;
// The Marshal's "Shield Wall" upgrades the shield bonus from +1 to +2 (they hold +2
// Readiness on a 7+ "instead of the usual +1 for shields"), so a Shield-Wall crew
// with shields can hold up to 5 — the cap has to allow it.
export const READINESS_SHIELD_WALL_BONUS = 2;
export function readinessCap(hasShield = false, shieldBonus = READINESS_SHIELD_BONUS) {
	return READINESS_BASE_CAP + (hasShield ? shieldBonus : 0);
}
// The move whose presence grants a crew the Shield-Wall Readiness bonus. Kept as data
// (like FOLLOWER_EXCEPTIONAL's move names) so the sheet doesn't hardcode the literal.
export const SHIELD_WALL_MOVE = "Shield Wall";

// ── The crew's kit (the Crew insert's Inventory) ─────────────────────────────
// Each row is a slug with a load `weight`, and `crew.gear[slug]` records its filled pips: a
// number, or the boolean an older sheet stored for "all of it". A row counts as CARRIED once
// every pip is filled, which is the one rule the shield's Readiness and the crew's armor share.
export function crewGearCarried(item, flagVal) {
	const weight = Number(item?.weight) || 1;
	return typeof flagVal === "number" ? flagVal >= weight : !!flagVal;
}

/**
 * The armor the crew's carried kit gives them: "Armor: Starts at 0" on the insert, and the
 * inventory raises it (thick hides "1 armor", a shield "+1 armor"; Book I, a follower "has 0 armor
 * unless ... Outfit him with thick hides or a shield"). Data on the rows, never read from labels:
 * `armor` is a worn BASE (bases do not stack, the highest counts, as on a character) and
 * `armorBonus` ADDS on top (the shield).
 *
 * @param {object[]} inventory  the playbook's crew inventory rows
 * @param {object}   gearFlags  crew.gear, slug -> filled pips (or boolean)
 * @param {number}   base       the crew's own armor before any kit (the playbook's 0)
 * @returns {number}
 */
export function crewGearArmor(inventory = [], gearFlags = {}, base = 0) {
	let worn = Number(base) || 0;
	let bonus = 0;
	for (const item of inventory ?? []) {
		if (!crewGearCarried(item, gearFlags?.[item?.slug])) continue;
		worn   = Math.max(worn, Number(item?.armor) || 0);
		bonus += Number(item?.armorBonus) || 0;
	}
	return worn + bonus;
}

// ── FIGHTING IN NUMBERS: two rules, deliberately kept apart ───────────────────
//
// The book pays a side for having more bodies in the fight in TWO different ways,
// and they agree on exactly one case — a single foe — which is how they get
// conflated. Each is its own function so each readout can name the rule it is
// applying, and so a GM reaching for one cannot silently be handed the other.
//
//   SWARM ONE TARGET (Followers in Fights). When a group "Clashes or Lets Fly at
//   a single foe (or Aids a PC in doing so), roll the move once (likely with
//   advantage) and roll ONE attacker's damage, +1 per each additional attacker."
//   N attackers on that target → +(N-1) damage. No armor: this rule pays damage
//   only, and it is per-TARGET, so it does not care how many the other side has.
//
//   ABSTRACTING GROUP EXCHANGES (Dangers — the optional group-vs-group rule).
//   "Each group deals damage and has HP/armor as per a single individual member.
//   Larger groups deal +1 damage and have +1 armor for each multiple they
//   outnumber their foe by (e.g. 3:1 gets +2 damage and armor)." Both sides run
//   as one combatant; the bonus is a RATIO, not a headcount.
//
// Where they part: six creatures against four PCs is +0 under the abstraction
// (6/4 is not yet a second whole multiple) and +5 against whichever one of the
// four they all pile onto. A single "outnumber" box answering both questions with
// one number is wrong for one of them every time, so the sheets show both rows.
//
// Shared by the crew / custom-group follower cards and the monster stat block so
// the rule, the readout string, and the roll rebuild can't drift between them.

/** SWARM ONE TARGET: N attackers on one foe → one attacker's damage, +1 each extra. */
export function pileOnBonus(attackers) {
	const n = Math.max(1, parseInt(attackers, 10) || 1);
	const bonus = n - 1;
	return {
		bonus,
		// Damage only — the armor half belongs to the other rule, and reading it here
		// would hand a swarming horde armor the book never gives it.
		label:   bonus > 0 ? `+${bonus} damage` : "no bonus",
		rollFor: (base) => addDamageBonus(base, bonus),
	};
}

/** ABSTRACTING GROUP EXCHANGES: +1 damage AND +1 armor per whole multiple past 1:1. */
export function outnumberBonus(yours, theirs) {
	const y = Math.max(1, parseInt(yours, 10)  || 1);
	const t = Math.max(1, parseInt(theirs, 10) || 1);
	const bonus = Math.max(0, Math.floor(y / t) - 1);
	return {
		bonus,
		// The armor half is a fiction note the GM applies by hand — nothing auto-applies
		// armor to incoming damage on either the monster or the follower side — but it is
		// half the printed rule, so the readout says it.
		label:   bonus > 0 ? `+${bonus} damage, +${bonus} armor` : "no bonus",
		rollFor: (base) => addDamageBonus(base, bonus),
	};
}

/**
 * A readout's clauses, each kept whole: "+5 damage, +5 armor" is ["+5 damage,", "+5 armor"]. A row
 * that runs out of room then breaks BETWEEN them, "+5 damage," above and "+5 armor" below, rather
 * than stranding "+5" above "damage" or carrying the whole readout down a line.
 */
export function numbersClauses(label) {
	const parts = String(label ?? "").split(", ");
	return parts.map((part, i) => (i < parts.length - 1 ? `${part},` : part));
}

// A readout that asks for clauses (`data-numbers-clauses`) gets one span per clause, the same markup
// its template drew on first paint; any other readout keeps its plain text.
function writeNumbersResult(el, label) {
	if (!("numbersClauses" in (el.dataset ?? {}))) {
		el.textContent = label;
		return;
	}
	el.replaceChildren(...numbersClauses(label).flatMap((clause, i) => {
		const span = el.ownerDocument.createElement("span");
		span.className = "stonetop-numbers-clause";
		span.textContent = clause;
		return i ? [" ", span] : [span];
	}));
}

/**
 * Keep each fighting-in-numbers row's readout and roll in step with its own counts as they are
 * typed. Scoped to the ROW that owns the input, never the section: the two rules keep separate
 * counts and separate dice, and a listener that reached across would answer one rule's question
 * with the other's number. The rows name their parts by data attribute, so the follower cards and
 * the monster stat block share this one listener; `rollKey` / `baseKey` are the dataset keys each
 * sheet's roll button reads its formula from.
 */
export function wireFightingInNumbers(root, { rollKey, baseKey }) {
	root.addEventListener("input", ev => {
		if (!ev.target.dataset?.numbersCount) return;
		const row = ev.target.closest("[data-rule]");
		if (!row) return;
		const count = (which) => row.querySelector(`[data-numbers-count="${which}"]`)?.value;
		const { label, rollFor } = row.dataset.rule === "swarm"
			? pileOnBonus(count("attackers"))
			: outnumberBonus(count("yours"), count("theirs"));
		const result = row.querySelector("[data-numbers-result]");
		if (result) writeNumbersResult(result, label);
		const button = row.querySelector("[data-numbers-roll]");
		const roll   = rollFor(button?.dataset[baseKey]);
		if (button) button.dataset[rollKey] = roll;
		const formula = row.querySelector("[data-numbers-formula]");
		if (formula) formula.textContent = roll;
	}, true);
}

/**
 * What an abstracted group's remaining HP means in bodies.
 *
 * "Damage represents casualties; if a group loses half its HP, then half of its members are out
 * of the action. At 0 HP, it's routed, massacred, or otherwise defeated." The book states one
 * data point and it is a proportion, so casualties track the FRACTION of the pool lost (which
 * reproduces that point exactly), rounded to the nearest body with a half going up, the way
 * Stonetop rounds a half.
 *
 * Nearest, not always up: rounding every fraction up puts a body out of the action for any
 * scratch at all, so a pair on a 6 HP pool read "1 of 2 out of the action" at 5 HP, with a sixth
 * of the pool gone. The arithmetic stays in integers so a half lands on exactly .5.
 */
export function groupCasualties({ hpMax = 0, hpCurrent = 0, count = 0 } = {}) {
	const max  = Math.max(0, Math.trunc(Number(hpMax) || 0));
	const size = Math.max(0, Math.trunc(Number(count) || 0));
	const hp   = Math.min(max, Math.max(0, Math.trunc(Number(hpCurrent) || 0)));
	// size × lost / max, rounded half up: floor((2 × size × lost + max) / (2 × max)).
	const out  = max > 0 && size > 0 ? Math.min(size, Math.floor((2 * size * (max - hp) + max) / (2 * max))) : 0;
	return {
		out,
		standing: Math.max(0, size - out),
		routed:   max > 0 && hp <= 0,
	};
}

/**
 * {@link groupCasualties} as the one line a card prints, so the crew, a custom warband and a
 * monster stat block all say the same thing about the same numbers. Null when there is nothing
 * to divide — no recorded headcount, or no HP pool to read casualties off.
 */
export function casualtyNote({ hpMax = 0, hpCurrent = 0, count = 0 } = {}) {
	const size = Math.max(0, Math.trunc(Number(count) || 0));
	const max  = Math.max(0, Math.trunc(Number(hpMax) || 0));
	if (!size || !max) return null;
	const { out, standing, routed } = groupCasualties({ hpMax: max, hpCurrent, count: size });
	if (routed)  return "routed, massacred, or otherwise defeated";
	if (out > 0) return `${standing} of ${size} still standing`;
	return `all ${size} still standing`;
}

/**
 * What a group's two closed folds say about themselves: the Roster line and the Group Fight
 * line, plus the swarm bonus the Group Fight fold offers. The crew and a custom warband are
 * the same card with different sources, so the wording, the rounding and what counts as
 * "down" live here rather than being written out once per caller and drifting.
 *
 * TWO HP PAIRS, deliberately. The roster totals (summed member by member) are what the Roster
 * fold reports; the abstracted group pool (`groupHpCurrent`/`groupHpMax`, ONE member's HP by
 * the rule) is what the Group Fight fold reports and what casualties are read off. They are
 * not interchangeable and the caller supplies both.
 *
 * `aliveCount` is the members still on their feet: it sets the down-count and is the opening
 * count for BOTH rows, since a member who is out of the action is not one of the attackers and
 * not one of the side's numbers. `size` is the recorded headcount, which the casualty line divides.
 * It is never the swarm's fallback: a crew with everyone down offering "+5 damage" beside a
 * group-vs-group row offering nothing is two answers to one headcount.
 */
export function groupFightCardSummaries({
	roster = [], aliveCount = 0, size = 0, groupHpCurrent = 0, groupHpMax = 0, damageRoll = "",
} = {}) {
	let hp = 0, max = 0;
	for (const m of roster) {
		hp  += Number(m?.hpCurrent) || 0;
		max += Number(m?.hpMax)     || 0;
	}
	const down = roster.length - aliveCount;
	const note = casualtyNote({ hpMax: groupHpMax, hpCurrent: groupHpCurrent, count: size });
	// Floored at the input's own minimum of one attacker, which is what the group-vs-group row's
	// `outnumberBonus` reads a zero as too.
	const swarmCount = Math.max(1, aliveCount);
	const swarm = pileOnBonus(swarmCount);
	// The group-vs-group row opens at the members on their feet against one foe, and is answered here
	// for the reason the monster sheet answers its own: "6 vs 1" beside "no bonus" and the bare die is
	// a state the card does not mean.
	const exchange = outnumberBonus(aliveCount, 1);
	return {
		rosterSummary: `${roster.length} member${roster.length === 1 ? "" : "s"}`
			+ (max ? ` · ${hp}/${max} HP` : "")
			+ (down > 0 ? ` · ${down} down` : ""),
		// The pool is one member's HP, so the number alone reads like a typo beside a
		// six-strong roster. The casualty line is what makes it legible: that pool is the
		// whole crew's staying power in an abstracted exchange, and what it has left is a
		// count of bodies still on their feet.
		groupFightSummary: `${groupHpCurrent}/${groupHpMax} HP` + (note ? ` · ${note}` : ""),
		swarmCount,
		swarmLabel: swarm.label,
		swarmRoll:  swarm.rollFor(damageRoll),
		exchangeLabel: exchange.label,
		exchangeRoll:  exchange.rollFor(damageRoll),
	};
}

// Next creation-order stamp for a custom follower: one past the largest existing
// `order` in the map, floored at Date.now() so two followers added the same
// millisecond still sort by insertion. Shared by the sheet and the dialogs that
// materialize followers (Requisition / arcana / possession summons).
export function nextFollowerOrder(existing = {}) {
	const max = Object.values(existing).reduce((m, f) => Math.max(m, Number(f?.order) || 0), 0);
	return Math.max(max + 1, Date.now());
}

// A monster's flavor tags are its tag string minus the organization and size,
// which the follower card surfaces differently (mirrors the monster sheet's
// display-tag split, NPCs & Followers vs. Dangers).
export function monsterFollowerTags(system = {}) {
	const org  = String(system.organization ?? "").trim().toLowerCase();
	const size = String(system.size ?? "").trim().toLowerCase();
	return normalizeTags(system.tags).filter(t => {
		const k = t.toLowerCase();
		return k !== org && k !== size;
	});
}

/**
 * Convert a monster's stats into custom-follower data (NPCs & Followers p.475:
 * "use its stats as-is", plus added tags, a chosen cost, and a Loyalty track).
 * `monster` carries { name, system, moves } (moves = array of move names); opts
 * supplies the player's added tags, cost, and pronoun.
 */
export function followerFromMonster(monster = {}, opts = {}) {
	const system = monster.system ?? {};
	const attrs  = system.attributes ?? {};
	const tags   = [...monsterFollowerTags(system), ...normalizeTags(opts.tags)];
	const hpMax  = Number(attrs.hp?.max ?? attrs.hp?.value) || 0;
	const damage = String(attrs.damage?.value ?? attrs.damage?.rollFormula ?? "").trim();
	return buildCustomFollower({
		name:         monster.name ?? "",
		pronoun:      opts.pronoun ?? "",
		typeLabel:    "follower",
		// Match the conversion dialog's banner: a follower keeps its monster's
		// creature-type glyph (an Adept is human → fa-user, not the generic paw).
		portraitIcon: `fas ${creatureTypeFaIcon(system.creatureType)}`,
		// …and its art, when the monster has any. The glyph above still backs it up for a
		// monster that never got a portrait.
		img:          sourceActorImg(monster.img),
		portraitFrame: documentPortraitFrame(monster),
		tags,
		hp:           hpMax,
		// Carry current HP as-is (buildCustomFollower clamps/normalizes); `?? hpMax`
		// only fills in when the monster has no current value. A `||` here would wrongly
		// promote a monster sitting at 0 HP to full.
		hpCurrent:    attrs.hp?.value ?? hpMax,
		armor:        parseFollowerArmor(attrs.armor?.value),
		damage,
		instinct:     String(attrs.instinct?.value ?? "").trim(),
		moves:        (Array.isArray(monster.moves) ? monster.moves : []).join("\n"),
		cost:         opts.cost ?? "",
		// A group- or horde-organization monster keeps its group identity as a
		// follower (the roster + group-fight tools), instead of collapsing to one
		// creature. The conversion dialog decides this from system.organization.
		isGroup:      !!opts.isGroup,
		size:         opts.size,
		sourceUuid:   monster.uuid ?? null,
	});
}

/**
 * Build custom-follower data from an "npc" Actor (NPCs & Followers p.475: "First,
 * create them as an NPC," then give tags / HP / armor / damage / instinct / cost).
 * An NPC that already carries game stats (system.hasStats) seeds its HP, armor,
 * damage and tags; one without stats seeds the book's able-bodied follower baseline
 * (6 HP, 0 armor, p.477). The dialog's editable fields (opts.hp/armor/damage) override
 * either. The follower keeps the NPC's uuid as its sourceUuid, so the card links back
 * to the actor it was recruited from and can never orphan.
 *
 * `npc` carries { name, system, uuid }; `opts` supplies the player's added tags, cost,
 * pronoun, moves (an array of GM-move names), any stat overrides, and group flags.
 */
export function followerFromNpc(npc = {}, opts = {}) {
	const system   = npc.system ?? {};
	const attrs    = system.attributes ?? {};
	const hasStats = !!system.hasStats;
	// Seed HP from the NPC's stats, else the "able-bodied" default (6). An explicit
	// opts.hp (the conversion dialog's editable field) always wins.
	const npcHp = hasStats ? (Number(attrs.hp?.max ?? attrs.hp?.value) || 0) : 0;
	const hpMax = opts.hp != null ? opts.hp : (npcHp || 6);
	const armor = opts.armor != null ? opts.armor : (hasStats ? attrs.armor?.value : 0);
	const damage = opts.damage != null
		? String(opts.damage)
		: (hasStats ? String(attrs.damage?.value ?? attrs.damage?.rollFormula ?? "").trim() : "");
	// A statted NPC carries its game-stat tags onto the follower; an unstatted one has none.
	const keptTags = hasStats ? normalizeTags(system.tags) : [];
	return buildCustomFollower({
		name:         npc.name ?? "",
		pronoun:      opts.pronoun ?? system.pronouns ?? "",
		typeLabel:    "follower",
		portraitIcon: "fas fa-user",
		// An NPC recruited off the steading's roster is usually already wearing a People of
		// Stonetop portrait, so the follower card shows the same face without being asked.
		img:          sourceActorImg(npc.img),
		// …and the square of it the roster was already showing, so a recruited NPC arrives on
		// the card wearing the face someone chose rather than a fresh blind top crop.
		portraitFrame: documentPortraitFrame(npc),
		tags:         [...keptTags, ...normalizeTags(opts.tags)],
		hp:           hpMax,
		hpCurrent:    opts.hpCurrent ?? (hasStats ? (attrs.hp?.value ?? hpMax) : hpMax),
		armor,
		damage,
		instinct:     String(system.instinct ?? "").trim(),
		moves:        (Array.isArray(opts.moves) ? opts.moves : []).join("\n"),
		cost:         opts.cost ?? "",
		isGroup:      !!opts.isGroup,
		size:         opts.size,
		sourceUuid:   npc.uuid ?? null,
	});
}

// Whether a monster's organization means it should become a GROUP follower, and a
// sensible starting headcount for it (NPCs & Followers p.470; the exact number is
// a table call, so these are just defaults the conversion dialog pre-fills).
export function monsterGroupDefaults(system = {}) {
	const org = String(system.organization ?? "").trim().toLowerCase();
	const count = Math.trunc(Number(system.count) || 0);
	if (org === "horde") return { isGroup: true, size: count > 1 ? count : 6 };
	if (org === "group") return { isGroup: true, size: count > 1 ? count : 3 };
	return { isGroup: false, size: 0 };
}
