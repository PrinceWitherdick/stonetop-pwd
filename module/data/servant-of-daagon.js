// Servant of Daagon — the deep ones the Ring of Daagon's "Call Up the Deep Ones"
// mystery summons (Book II arcana, "Mysteries of the Ring of Daagon"). Unlike every
// other arcana summon, a Servant batch is ROLLED and CHOSEN at summon time: roll five
// d4s and assign each to a DIFFERENT aspect (a bijection); the die assigned to an aspect
// shapes that aspect. For Traits and Moves the assigned die value is HOW MANY to choose
// from a fixed list. This module owns the aspect tables and the resolver that turns a set
// of assignments/choices into buildCustomFollower() input. It is framework-free (no
// Foundry globals) so it unit-tests and is reused by CallUpDeepOnesDialog.

import { buildCustomFollower, normalizeTags } from "./follower-build.js";
import { arcanaSummon } from "./arcana-summons.js";

// Stable identity markers shared with the arcana-summons registry: the Ring itself is
// one follower, the Servants another. Call Up dedupes nothing (a fresh batch each time),
// but the sheet uses these to link a Servant batch's Loyalty to the Ring's pool.
export const RING_SOURCE_UUID    = "ring-of-daagon:the-ring";
export const SERVANT_SOURCE_UUID = "ring-of-daagon:servant-of-daagon";
// The Ring's arcanum slug: its summon is the one gated on the card's mysteries being unlocked
// (its arcana-summons.js entry's `untilUnlocked`).
export const RING_ARCANUM_SLUG   = "ring-of-daagon";

/**
 * The Ring of Daagon and its Servants share one Loyalty pool (Book II p.561). Find the Ring
 * follower in a customFollowers map so a Servant batch's pips, Call Up and Send Them Back act on
 * the Ring's track. Callers pass an in-hand map (getData) or a freshly read flag.
 */
export function findRingFollower(map = {}) {
	const entry = Object.entries(map ?? {}).find(([, f]) => f?.sourceUuid === RING_SOURCE_UUID);
	return {
		id:      entry?.[0] ?? null,
		name:    entry?.[1]?.name || "the Ring of Daagon",
		loyalty: Math.max(0, Number(entry?.[1]?.loyalty) || 0),
		hasRing: !!entry,
	};
}

/**
 * Whether an arcanum's "Add as follower" may manifest yet. A summon marked `untilUnlocked`
 * (arcana-summons.js) waits on the card being unlocked: the Ring becomes a follower only "when you
 * make the last mark" (Book II p.560). Every other summon is as it was.
 */
export function summonUnlocked(slug, unlocked) {
	return !arcanaSummon(slug)?.untilUnlocked || !!unlocked;
}

// The five aspects, in the order the rulebook lists them. Each rolled d4 is assigned to
// exactly one aspect; the assigned die's VALUE resolves that aspect.
export const SERVANT_ASPECTS = [
	{ key: "tags",   label: "Tags",          hint: "which extra tag they gain" },
	{ key: "number", label: "No. Appearing", hint: "how many show up, and their base HP / damage" },
	{ key: "size",   label: "Size",          hint: "how big they are (HP, damage, reach)" },
	{ key: "traits", label: "Traits",        hint: "how many traits you pick" },
	{ key: "moves",  label: "Moves",         hint: "how many moves you pick" },
];

// Every Servant batch starts terrifying, violent and wretched.
export const SERVANT_BASE_TAGS = ["terrifying", "violent", "wretched"];
export const SERVANT_INSTINCT  = "to devour";
export const SERVANT_COST       = "shares the Ring's Loyalty";

// Tags aspect: the assigned die picks ONE extra tag. A 4 makes the batch "exceptional",
// which in play means +2 (not +1) when a tag applies to an Order Followers roll — so it
// carries no literal "exceptional" tag chip beyond the gated flag.
export const SERVANT_TAG_OPTIONS = {
	1: { tag: "craven",   exceptional: false },
	2: { tag: "ravenous", exceptional: false },
	3: { tag: "cunning",  exceptional: false },
	4: { tag: null,       exceptional: true, label: "exceptional (roll +2 for moves)" },
};

// No. Appearing aspect: horde / group / solitary, each with a headcount formula, the
// per-member HP, and the base damage die.
export const SERVANT_NUMBER_OPTIONS = {
	1: { key: "horde",    label: "horde",    countFormula: "2d6",   hp: 3,  die: "d6"  },
	2: { key: "group",    label: "group",    countFormula: "1d6+1", hp: 6,  die: "d8"  },
	3: { key: "group",    label: "group",    countFormula: "1d6+1", hp: 6,  die: "d8"  },
	4: { key: "solitary", label: "solitary", countFormula: "1",     hp: 12, die: "d10" },
};

// Size aspect: adjusts HP and damage and sets the melee range tag.
export const SERVANT_SIZE_OPTIONS = {
	1: { key: "small",  label: "small",  hpMod: -2, dmgMod: -2, ranges: ["hand"] },
	2: { key: "medium", label: "medium", hpMod: 0,  dmgMod: 0,  ranges: ["close"] },
	3: { key: "medium", label: "medium", hpMod: 0,  dmgMod: 0,  ranges: ["close"] },
	4: { key: "large",  label: "large",  hpMod: 4,  dmgMod: 1,  ranges: ["close", "reach"] },
};

// Traits aspect: the assigned die is HOW MANY of these to choose. Each trait folds into
// armor, tags, or the damage line (flat modifier and/or damage tags).
export const SERVANT_TRAIT_OPTIONS = [
	{ key: "hide",        label: "Blubbery/scaly hide",     detail: "2 armor",              armor: 2 },
	{ key: "stealthy",    label: "Stealthy and cautious",   detail: "+stealthy, +cautious", tags: ["stealthy", "cautious"] },
	{ key: "powerful",    label: "Powerful",                detail: "+2 damage, forceful",  dmgMod: 2, dmgTags: ["forceful"] },
	{ key: "tentacles",   label: "Tentacles/pincers, etc.", detail: "reach, grabby",        dmgTags: ["reach", "grabby"] },
	{ key: "claws",       label: "Big claws/fangs",         detail: "1 piercing, messy",    dmgTags: ["1 piercing", "messy"] },
	{ key: "projectiles", label: "Projectiles",             detail: "+near",                dmgTags: ["near"] },
];

// Moves aspect: the assigned die is HOW MANY of these to choose. The book's words
// (Book II p.561, the Mysteries side; p.560 is the Ring's front), which become the batch's move
// lines as written.
export const SERVANT_MOVE_OPTIONS = [
	"Wriggle free of danger/restraint",
	"Heal at a prodigious rate",
	"Smother/constrict/engulf them",
	"Dissolve organic material",
	"Mesmerize the weak-willed",
	"Paralyze them with venom",
];

// Clamp a rolled d4 to 1-4, or 0 when unassigned (so a live preview tolerates a
// half-finished assignment).
function _die(v) {
	const n = Math.trunc(Number(v) || 0);
	return n >= 1 && n <= 4 ? n : 0;
}

// A signed flat modifier for a damage die, e.g. 2 → "+2", -2 → "-2", 0 → "". ASCII on
// purpose: this feeds a Roll formula string (buildCustomFollower stores the raw text).
function _flat(n) {
	const v = Math.trunc(Number(n) || 0);
	return v > 0 ? `+${v}` : v < 0 ? `-${Math.abs(v)}` : "";
}

/**
 * Resolve a Call Up into buildCustomFollower() input.
 *
 * @param {object}   p
 * @param {object}   p.aspectDie     - die value (1-4) assigned to each aspect key
 *                                     ({ tags, number, size, traits, moves }); 0/absent = unresolved.
 * @param {number}   p.count         - headcount rolled from the No. Appearing formula (or overridden).
 * @param {string[]} p.chosenTraits  - SERVANT_TRAIT_OPTIONS keys the player picked.
 * @param {string[]} p.chosenMoves   - SERVANT_MOVE_OPTIONS labels the player picked.
 * @param {string}   p.name          - the batch's name (defaults by count).
 * @returns {object} buildCustomFollower() input, plus `exceptional`, `repeatable` and `sourceUuid`.
 */
export function resolveServantBatch({ aspectDie = {}, count, chosenTraits = [], chosenMoves = [], name } = {}) {
	const tagsDie   = _die(aspectDie.tags);
	const numberDie = _die(aspectDie.number);
	const sizeDie   = _die(aspectDie.size);

	const tagOpt  = SERVANT_TAG_OPTIONS[tagsDie]  ?? null;
	const numOpt  = SERVANT_NUMBER_OPTIONS[numberDie] ?? SERVANT_NUMBER_OPTIONS[2]; // sensible group default for a preview
	const sizeOpt = SERVANT_SIZE_OPTIONS[sizeDie] ?? SERVANT_SIZE_OPTIONS[2];

	// Resolve the chosen traits into their effects.
	const traitSet = new Set(chosenTraits);
	const traits   = SERVANT_TRAIT_OPTIONS.filter(t => traitSet.has(t.key));
	const armor    = traits.reduce((a, t) => Math.max(a, t.armor ?? 0), 0);
	const dmgFlat  = (sizeOpt.dmgMod ?? 0) + traits.reduce((s, t) => s + (t.dmgMod ?? 0), 0);

	// Tags: base three, the Tags-aspect tag (a 4 grants no literal tag, just exceptional),
	// and any tags contributed by traits (stealthy & cautious). De-duped, order preserved.
	const tags = normalizeTags([
		...SERVANT_BASE_TAGS,
		tagOpt?.tag,
		...traits.flatMap(t => t.tags ?? []),
	]);
	const exceptional = !!tagOpt?.exceptional;

	// Damage: base die from No. Appearing, the flat size/trait modifier, and the range +
	// trait damage tags (melee reach from size, plus whatever the traits add).
	const dmgTags = normalizeTags([
		...(sizeOpt.ranges ?? []),
		...traits.flatMap(t => t.dmgTags ?? []),
	]);
	const die    = numOpt.die;
	const damage = `${die}${_flat(dmgFlat)}${dmgTags.length ? ` (${dmgTags.join(", ")})` : ""}`;

	const hp = Math.max(1, (numOpt.hp ?? 6) + (sizeOpt.hpMod ?? 0));

	// Headcount: solitary is one creature; horde/group are a group follower with a roster.
	const headcount = Math.max(1, Math.trunc(Number(count) || 0) || (numOpt.key === "solitary" ? 1 : 2));
	const isGroup   = headcount > 1;

	const displayName = String(name ?? "").trim()
		|| (isGroup ? "Servants of Daagon" : "Servant of Daagon");

	return {
		name:         displayName,
		pronoun:      isGroup ? "they" : "it",
		typeLabel:    isGroup ? "deep ones" : "deep one",
		portraitIcon: "fas fa-fish",
		tags,
		hp,
		armor,
		damage,
		instinct:     SERVANT_INSTINCT,
		moves:        (chosenMoves ?? []).map(m => String(m).trim()).filter(Boolean).join("\n"),
		cost:         SERVANT_COST,
		exceptional,
		isGroup,
		size:         isGroup ? headcount : 0,
		repeatable:   true,
		sourceUuid:   SERVANT_SOURCE_UUID,
	};
}

/**
 * Build the stored custom-follower object for a Servant batch (buildCustomFollower plus the
 * `exceptional` flag the resolver derives). The caller stamps id/order and persists it under
 * flags.stonetop-pwd.customFollowers.<id>.
 */
export function buildServantFollower(input) {
	return { ...buildCustomFollower(input), exceptional: !!input?.exceptional };
}
