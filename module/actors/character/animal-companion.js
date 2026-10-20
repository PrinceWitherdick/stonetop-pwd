// The Ranger's Animal Companion as numbers (the Animal Companion insert, Book I p.143).
//
// Each companion Type prints a base line ("HP 12; Armor 0; Damage d6 (hand)") and a list of options
// to pick from. Some options change that line ("+4 HP", "+1 armor (hide)", "Damage is +2 damage,
// forceful", "large (+4 HP, +1 damage, +close)"), the rest are tags. The playbook's type data says
// which do what in its `effects` map (packs/src .../playbooks/the-ranger.json), keyed by the option's
// label, and the companion's line is worked out from those here and nowhere else: the Followers-tab
// card, the NPC that stands for the companion (it copies the card's damage line) and the fight
// (which reads its piercing and tags off that same line, utils/damage.js#printedBlow) all see this.
//
// A stored pick is matched by its label, so a label the data renames keeps an `aliases` entry from
// the old spelling, and an option the data drops from a type (the Brute's old "cautious") is listed
// in `legacyTraits` so a companion that took it keeps it, shown and counted, until it is unpicked.
//
// Pure: no Foundry global is touched, so all of it is testable with plain objects.

import { normalizePlaybookGlyphs } from "../../utils/strings.js";

/** The move that brings the companion: the Ranger's own, or one taken through another playbook's. */
export const ANIMAL_COMPANION_MOVE = "Animal Companion";

/** The playbook whose Animal Companion insert every companion is drawn from. */
export const RANGER_SLUG = "the-ranger";

/** The Ranger move whose every copy gives the companion 2 more options. */
export const MAGNIFICENT_SPECIMEN_MOVE = "Magnificent Specimen";

/** "Each time you take this move, your companion gains 2 additional options of your choice." */
export const COMPANION_TRAIT_PICKS_PER_SPECIMEN = 2;

/**
 * How many options the companion may hold beyond its pre-ticked one: the type's "Pick N more" plus
 * 2 per Magnificent Specimen counted by the caller (LEARNED book copies on a sheet, a free pick in
 * onboarding).
 */
export function companionTraitAllowance(typeData, specimens = 0) {
	return (Number(typeData?.pickCount) || 0) + COMPANION_TRAIT_PICKS_PER_SPECIMEN * Math.max(0, Number(specimens) || 0);
}

/** A type's kinds, from its examples ("hawk, owl, raven..."), for the companion's kind picker. */
export function companionKindOptions(typeData) {
	return normalizePlaybookGlyphs(typeData?.examples ?? "").replace(/[.…]+$/g, "")
		.split(",").map(v => v.trim()).filter(Boolean);
}

/** A stored pick under the label the type prints it with now (its `aliases`), else unchanged. */
export function canonicalCompanionTrait(typeData, trait) {
	return typeData?.aliases?.[trait] ?? trait;
}

/** Every stored pick under its current label, each once. */
export function canonicalCompanionTraits(typeData, traits) {
	return [...new Set((traits ?? []).map(t => canonicalCompanionTrait(typeData, t)))];
}

/**
 * Whether an option is a stat option rather than a tag: one the type's `effects` map gives a change
 * to the line ("+4 HP", "+1 armor (hide)", "Improved damage die (d6)", "Damage is messy, 1 piercing"),
 * unless its entry says `isTag` (Brute "large (+4 HP, +1 damage, +close)" is the tag "large" that
 * also changes the line). A stat option is drawn into the companion's numbers, so it is no tag to
 * earn Order Followers' +1 (p.462). Every other option (cautious, keen-nosed, Steed "large", a
 * write-in, a legacy pick) is a tag. Old spellings are read through the type's `aliases`.
 */
export function isCompanionStatOption(typeData, trait) {
	const effect = typeData?.effects?.[canonicalCompanionTrait(typeData, trait)];
	return !!effect && !effect.isTag;
}

/** The held options that are tags (isCompanionStatOption's complement), in the order given. */
export function companionTagOptions(typeData, traits) {
	return (traits ?? []).filter(t => !isCompanionStatOption(typeData, t));
}

/**
 * The picks that spend the allowance: everything held but the type's pre-ticked option, which is
 * free (Bird "tiny", Brute "tough", ...).
 */
export function companionPaidTraits(typeData, traits) {
	const mandatory = typeData?.mandatoryTrait ?? null;
	return canonicalCompanionTraits(typeData, traits).filter(t => t !== mandatory);
}

/**
 * The stored picks cut back to `allowance`, dropping the latest first: the stored list's end is its
 * newest pick (onboarding appends in pick order, the card's picker appends its write-in last). The
 * pre-ticked option is never dropped and never counted. Returns the list unchanged when it fits.
 */
export function trimCompanionTraits(typeData, traits, allowance) {
	const list = [...(traits ?? [])];
	const mandatory = typeData?.mandatoryTrait ?? null;
	const paid = list.filter(t => canonicalCompanionTrait(typeData, t) !== mandatory);
	const over = paid.length - Math.max(0, Number(allowance) || 0);
	if (over <= 0) return list;
	const drop = new Set(paid.slice(paid.length - over));
	return list.filter(t => !drop.has(t));
}

// "1 (size)" -> {value: 1, sources: ["size"]}; "0" -> {value: 0, sources: []}.
function _readArmor(text) {
	const s = String(text ?? "").trim();
	const value = Number(s.match(/^-?\d+/)?.[0]) || 0;
	const inner = s.match(/\(([^)]*)\)/)?.[1]?.trim();
	return { value, sources: inner ? [inner] : [] };
}

// "d6+1 (hand, close)" -> {die: "d6", bonus: 1, tags: ["hand", "close"]}.
function _readDamage(text) {
	const s = String(text ?? "").trim();
	const m = s.match(/^(\d*d\d+)\s*([+-]\s*\d+)?/i);
	const inner = s.match(/\(([^)]*)\)/)?.[1] ?? "";
	return {
		die:   m?.[1] ?? "",
		bonus: m?.[2] ? Number(m[2].replace(/\s+/g, "")) : 0,
		tags:  inner.split(",").map(t => t.trim()).filter(Boolean),
	};
}

/**
 * The companion's line: the type's base, each held option's `effects`, then the move bonuses the
 * caller hands over (Beast of Legend's "+4 HP and +1 armor", StonetopCharacter#_buildCompanionBonuses).
 *
 * @param {object} typeData   one of the playbook's `animalCompanion.types`
 * @param {string[]} traits   the stored picks (old labels are read through `aliases`)
 * @param {{hp?: number, armor?: number}} [bonuses]
 * @returns {{hp: number, armor: string, damage: string, damageRoll: string, damageForm: string}}
 *   `armor` and `damage` in the insert's own shape ("2 (size, agility)", "d6+3 (hand, close, forceful,
 *   1 piercing)"); `damageRoll` the rollable die; `damageForm` the base parenthetical ("hand"), which
 *   is what the card's "attacks with its ..." label names.
 */
export function companionStats(typeData, traits, bonuses = {}) {
	const effects = typeData?.effects ?? {};
	const held = canonicalCompanionTraits(typeData, traits).map(t => effects[t]).filter(Boolean);

	const hp = (Number(typeData?.hp) || 0)
		+ held.reduce((sum, e) => sum + (Number(e.hp) || 0), 0)
		+ (Number(bonuses?.hp) || 0);

	const armor = _readArmor(typeData?.armor);
	for (const e of held) {
		armor.value += Number(e.armor) || 0;
		if (e.armorSource && !armor.sources.includes(e.armorSource)) armor.sources.push(e.armorSource);
	}
	armor.value += Number(bonuses?.armor) || 0;
	const armorText = armor.sources.length ? `${armor.value} (${armor.sources.join(", ")})` : String(armor.value);

	const base = _readDamage(typeData?.damage);
	let die = base.die;
	let bonus = base.bonus;
	const tags = [...base.tags];
	let piercing = 0;
	for (const e of held) {
		if (e.damageDie) die = e.damageDie;
		bonus += Number(e.damage) || 0;
		for (const tag of (e.tags ?? [])) if (!tags.includes(tag)) tags.push(tag);
		piercing += Number(e.piercing) || 0;
	}
	if (piercing) tags.push(`${piercing} piercing`);
	const roll = die ? `${die}${bonus > 0 ? `+${bonus}` : bonus < 0 ? bonus : ""}` : "";
	const damage = roll ? `${roll}${tags.length ? ` (${tags.join(", ")})` : ""}` : String(typeData?.damage ?? "");

	return { hp, armor: armorText, damage, damageRoll: roll, damageForm: base.tags.join(", ") };
}
