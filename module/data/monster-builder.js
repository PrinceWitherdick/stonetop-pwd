// The "make a monster" worksheet from Book I, "Dangers" (pp.392-398), as data +
// a pure calculator. Every option below is one row of the book's fill-in tables,
// and computeMonster() turns a set of picks into the finished stat block's HP,
// Armor, Damage, and tag line. Kept Foundry-free so it can be unit tested and
// reused by the CreateMonsterDialog (and, in principle, the importer).
//
// The dialog owns presentation; this module owns the arithmetic and the book's
// numbers, so the two never drift and the math is verifiable in isolation.

import { DIE_ORDER, isWholeDamageDie, joinAttackProse, stripDamageDice, stepDie as stepLadder } from "../utils/damage-die.js";
import { byId as _byId, signedBonus } from "./table-utils.js";

// ── Step 3/4/6: organization (every monster has exactly one) ──────────────────
// Organization drives the base HP and base damage die in one pick.
export const ORGANIZATIONS = [
	{ id: "horde",    label: "Horde",    hint: "In large groups (6 or more)", hp: 3,  die: "d6",  count: 6 },
	{ id: "group",    label: "Group",    hint: "In small groups (2-5)",       hp: 6,  die: "d8",  count: 3 },
	{ id: "solitary", label: "Solitary", hint: "By itself",                   hp: 12, die: "d10", count: 1 },
];

// ── Step 3/4/6: size (medium is the human-sized default and carries no tag) ───
// Size modifies HP and damage, and nudges the attack's range (advisory only).
export const SIZES = [
	{ id: "tiny",   tag: "tiny",  label: "Tiny",   hint: "Cat-sized or smaller",   hp: -2, damage: -2, range: "reduce" },
	{ id: "small",  tag: "small", label: "Small",  hint: "Like a human child",     hp: 0,  damage: 0,  range: "reduce" },
	{ id: "medium", tag: "",      label: "Medium", hint: "Adult human-sized",      hp: 0,  damage: 0,  range: null },
	{ id: "large",  tag: "large", label: "Large",  hint: "Like a horse or cart",   hp: 4,  damage: 1,  range: "add" },
	{ id: "huge",   tag: "huge",  label: "Huge",   hint: "Like an elephant, or bigger", hp: 8, damage: 3, range: "add" },
];

// ── Step 3: nature tags (add all that apply) ──────────────────────────────────
export const NATURE_TAGS = [
	{ id: "spirit",     label: "Spirit",     hint: "Lacks physical form" },
	{ id: "fae",        label: "Fae",        hint: "Between physical and spiritual" },
	{ id: "construct",  label: "Construct",  hint: "Made by someone" },
	{ id: "corrupted",  label: "Corrupted",  hint: "Changed by the Things Below" },
	{ id: "emanation",  label: "Emanation",  hint: "A manifestation of a greater power, not a body of its own" },
	{ id: "primordial", label: "Primordial", hint: "From the first age of creation" },
	{ id: "undead",     label: "Undead",     hint: "Dead, but in denial" },
];

// ── Step 3: "notable for" tags (add all that apply) ───────────────────────────
export const NOTABLE_TAGS = [
	{ id: "hoarder",    label: "Hoarder",    hint: "Amasses trinkets and treasure" },
	{ id: "cautious",   label: "Cautious",   hint: "Avoids fights, flees early" },
	{ id: "cunning",    label: "Cunning",    hint: "Intelligent, cunning, or devious" },
	{ id: "terrifying", label: "Terrifying", hint: "Disturbing or terrible presence" },
	{ id: "stealthy",   label: "Stealthy",   hint: "Sneaks, surprises, ambushes" },
	{ id: "magical",    label: "Magical",    hint: "Uses spells or magic" },
	{ id: "organized",  label: "Organized",  hint: "Works well in groups" },
];

// ── Step 4: extra HP modifiers (pick all that apply) ──────────────────────────
export const HP_MODIFIERS = [
	{ id: "tough",    label: "Particularly tough or durable", hp: 4 },
	{ id: "fated",    label: "Smiled upon by the fates",      hp: 2 },
	{ id: "animated", label: "Animated by more than biology", hp: 4 },
	{ id: "noOrgans", label: "Lacks vital organs",            hp: 3 },
];

// ── Step 5: base armor (pick one) ─────────────────────────────────────────────
export const ARMOR_BASES = [
	{ id: 0, label: "Naught but cloth and flesh",                  source: "" },
	{ id: 1, label: "Leathers or thick hide",                      source: "hide" },
	{ id: 2, label: "Mail, scale, or similar",                     source: "mail" },
	{ id: 3, label: "Steel armor, boney plates, carapace",         source: "plate" },
	{ id: 4, label: "Potent magical wards or supernatural resilience", source: "resilience" },
];

// ── Step 5: extra armor modifiers (pick all that apply) ───────────────────────
// "tiny" is applied automatically from the size pick, so it isn't offered here.
export const ARMOR_MODIFIERS = [
	{ id: "shield",   label: "Bears a shield or similar", armor: 1, source: "shield" },
	{ id: "skilled",  label: "Skilled in defense",        armor: 1, source: "skill" },
	{ id: "noOrgans", label: "Lacks vital organs",        armor: 1, source: "" },
];

// ── Step 6: attack tags (add all that apply) — descriptive, no arithmetic ─────
// These assemble into the Damage line's parenthetical. Range tags come first.
export const DAMAGE_RANGE_TAGS = [
	{ id: "hand",  label: "hand",  hint: "Up close and personal" },
	{ id: "close", label: "close", hint: "At sword's reach" },
	{ id: "reach", label: "reach", hint: "Keeps foes at bay (3-4 steps)" },
	{ id: "near",  label: "near",  hint: "Up to ~30 steps" },
	{ id: "far",   label: "far",   hint: "Up to ~100 steps or more" },
];

// The two piercing rows are printed WITH messy ("Can slice through thick hide: 1 piercing, messy",
// Book I p.398), so picking one brings both tags. `piercing` is the row's armor-piercing value, which
// "strikes deftly and precisely" adds to rather than prints beside (see computeMonster).
export const DAMAGE_EFFECT_TAGS = [
	{ id: "area",          label: "area",          hint: "Can hurt many foes at once" },
	{ id: "grabby",        label: "grabby",        hint: "Latches on, pins, grapples" },
	{ id: "messy",         label: "messy",         hint: "Rips foes and things apart" },
	{ id: "1 piercing",    label: "1 piercing, messy", hint: "Can slice through thick hide", piercing: 1, also: ["messy"] },
	{ id: "3 piercing",    label: "3 piercing, messy", hint: "Can tear metal apart",         piercing: 3, also: ["messy"] },
	{ id: "ignores armor", label: "ignores armor", hint: "Bypasses armor entirely" },
	{ id: "crude",         label: "crude",         hint: "Prone to breakage" },
];

// ── Step 6: damage modifiers that change the numbers/die (pick all that apply) ─
// die: steps up/down the die ladder; damage: flat bonus; adv/dis: roll-twice; piercing: ADDED to the
// attack's piercing ("+1 piercing", Book I p.399), so 1 piercing plus deft is 2 piercing.
export const DAMAGE_MODIFIERS = [
	{ id: "weak",       label: "Small and weak",                     die: -1 },
	{ id: "vicious",    label: "Vicious and obvious",                damage: 2 },
	{ id: "relentless", label: "Relentless or overwhelming",         adv: 1 },
	{ id: "strong",     label: "Impressively strong",                damage: 2, tag: "forceful" },
	{ id: "deft",       label: "Strikes deftly and precisely",       piercing: 1 },
	{ id: "subtle",     label: "Physical injury isn't its worst danger", die: -1 },
	{ id: "ancient",    label: "Ancient and noteworthy",             die: 1 },
	{ id: "abhorrent",  label: "Abhors violence",                    dis: 1 },
];

// ── Step 9: monster moves (Book I, "Moves") ───────────────────────────────────
// Each pick seeds a monsterMove Item; `name` is a ready verb-phrase the GM can
// rename, `description` is the book's prompt so guidance rides along in the item.
export const MOVE_SUGGESTIONS = [
	{ id: "trick",    name: "Pull a dirty trick",       hint: "Deceptive and sneaky",                    description: "It is deceptive and sneaky: a move about its dirty tricks." },
	{ id: "magic",    name: "Unleash its magic",        hint: "Uses spells or magic",                    description: "It uses spells or magic: a move that describes its powers." },
	{ id: "rally",    name: "Call on its allies",       hint: "Works well in groups",                    description: "It works well in groups: a move about how it calls on or coordinates with others." },
	{ id: "manifest", name: "Manifest or possess a body", hint: "A spirit that takes physical form",     description: "It is a spirit but can manifest or possess a physical form: a move describing how it does so." },
	{ id: "true",     name: "Inflict its true danger",  hint: "Its worst threat isn't physical injury",  description: "It poses a primary danger other than physical injury: a move reflecting the true threat it poses." },
	{ id: "defend",   name: "Defend itself",            hint: "Actively defends itself",                 description: "It actively defends itself: a move describing that defense." },
	{ id: "special",  name: "Use a special attack",     hint: "Has a special form of attack",            description: "It has a special form of attack: a move describing it, with tags and (if appropriate) an alternative damage value." },
	{ id: "notable",  name: "Do what it's notable for", hint: "Fill out a thin move list",               description: "Another move describing what the monster is notable for doing." },
];


/** Step one die up (+n) or down (-n) the ladder, clamped to d4..d12.
 *  Off-ladder input defaults to d6, then reuses the shared ladder stepper. */
export function stepDie(die, steps) {
	return stepLadder(DIE_ORDER.includes(die) ? die : "d6", steps);
}

// Split a free-text tag blob on commas. Trimming, lowercasing and de-duping are left to
// _joinTags, which every caller pipes the result through.
function _splitCustom(text) {
	return String(text ?? "").split(",");
}

/**
 * A typed attack name, cleaned up enough that it cannot corrupt the line it is about to head.
 *
 * The damage line is PROSE that gets read back apart again — by the sheet, for its roll buttons,
 * and by the combat flow, for the blow a character just suffered — so the two things a name must
 * not smuggle in are the two the readers key on:
 *   a DIE      "claws d6" ahead of a d8+2 line makes d6 the first die in the string, so every
 *              reader rolls d6 while `rollFormula` still says d8+2. EVERY die goes, not the
 *              first: a name is free text, so "claws d6 and fangs d10" is a thing a GM types,
 *              and taking one die out of it leaves the other one heading the line.
 *   PARENS     the tag list is found by counting depth; an unclosed "(" swallows the rest.
 * A trailing comma goes too, since the name is about to be followed by a space and a die.
 */
function _cleanAttackName(input) {
	return stripDamageDice(input)
		.replace(/[()]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[,;:]+$/, "")
		.trim();
}

/**
 * One of the creature's OTHER printed attacks, written the way the book writes it.
 *
 * It takes the creature's die unless the GM typed one of its own, because that is how the book
 * goes: the Rime Lord's two blows are d12+3 and d12+1, the Assassin's d10 and d8. A typed die is
 * only honoured if it is a whole die expression — prose in that field would reach `new Roll` and
 * throw at the table, and falling back to the creature's die is a preview that visibly does not
 * change, which the live summary shows before anything is created.
 *
 * The creature-level advantage note rides along, since the picks that produce it ("Relentless or
 * overwhelming", "Abhors violence") describe the CREATURE and not one of its blows. So do the
 * other damage modifiers' tags when the blow takes the creature's die: that die already carries
 * "impressively strong"'s +2, so it carries its forceful too, and "strikes deftly" adds its +1
 * piercing (Book I p.399). A blow with a die of its own was sized by the GM, and keeps its own tags.
 */
function _renderExtraAttack(extra, { rollFormula, advStr, modTags, piercingBonus }) {
	const name = _cleanAttackName(extra?.name);
	const typed = String(extra?.die ?? "").trim();
	const ownDie = isWholeDamageDie(typed);
	const picked = _joinTags(extra?.tags ?? []);
	// An entry that says nothing is not a blow. Left in, it would print as the creature's own die
	// with no name beside it — "claws d8 or d8" — which every reader of the line then counts as a
	// second attack, and the GM gets a phantom button to press.
	if (!name && !picked.length && !typed) return "";
	const tags = _attackTagList(picked, ownDie ? {} : { modTags, piercingBonus });
	const die = ownDie ? typed.replace(/\s+/g, "") : rollFormula;
	return `${name ? `${name} ` : ""}${die}${advStr}${tags.length ? ` (${tags.join(", ")})` : ""}`;
}

/**
 * One attack's tag list, in first-seen order: the picked tags, then the damage modifiers' own.
 *
 * Piercing is a NUMBER, not a tag to stack. A piercing row brings the messy printed beside it ("Can
 * slice through thick hide: 1 piercing, messy", Book I p.398), and "strikes deftly and precisely"
 * is "+1 piercing" (p.399): ADDED to the row's value, so thick hide plus deft is "2 piercing" and
 * tearing metal plus deft is "4 piercing". Printed as one tag where the row was picked, or at the end
 * when only deft gives any, because every reader of the line takes the first "N piercing" it finds.
 */
function _attackTagList(picked, { modTags = [], piercingBonus = 0 } = {}) {
	const out = [];
	let piercing = 0;
	let slot = -1;
	for (const tag of picked) {
		const row = DAMAGE_EFFECT_TAGS.find(o => o.id === tag && o.piercing);
		if (!row) { out.push(tag); continue; }
		piercing = Math.max(piercing, row.piercing);
		if (slot < 0) { slot = out.length; out.push(null); }
		out.push(...(row.also ?? []));
	}
	out.push(...modTags);
	const total = piercing + piercingBonus;
	if (slot >= 0) out[slot] = `${total} piercing`;
	else if (total > 0) out.push(`${total} piercing`);
	return _joinTags(out);
}

// Join tags in first-seen order, dropping blanks and case-insensitive dupes.
function _joinTags(parts) {
	const seen = new Set();
	const out = [];
	for (const raw of parts) {
		const tag = String(raw ?? "").trim();
		if (!tag) continue;
		const key = tag.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(key);
	}
	return out;
}

/**
 * Fold a worksheet of picks into a finished stat block.
 *
 * @param {object} sel  Selections from the dialog:
 *   organization, size, natureTags[], notableTags[], customTags,
 *   hpMods[], armorBase, armorSource, attackName, damageTags[], damageMods[],
 *   extraAttacks[] ({ name, die, tags[] } — the creature's other printed blows),
 *   concept, name, instinct, creatureType, moves[]
 * @returns {{
 *   hp:number, armorValue:number, armorSource:string,
 *   damageDie:string, damageBonus:number, rollMode:""|"adv"|"dis",
 *   rollFormula:string, damageValue:string, damageTags:string[],
 *   tags:string, count:number, rangeAdvice:null|"reduce"|"add",
 * }}
 */
export function computeMonster(sel = {}) {
	const org  = _byId(ORGANIZATIONS, sel.organization) ?? ORGANIZATIONS[1]; // default: group
	const size = _byId(SIZES, sel.size) ?? _byId(SIZES, "medium");

	// ── HP ────────────────────────────────────────────────────────────────────
	let hp = org.hp + size.hp;
	for (const id of sel.hpMods ?? []) hp += _byId(HP_MODIFIERS, id)?.hp ?? 0;
	hp = Math.max(1, hp); // a monster always has at least 1 HP (e.g. a tiny horde)

	// ── Armor ─────────────────────────────────────────────────────────────────
	const armorBase = _byId(ARMOR_BASES, Number(sel.armorBase)) ?? ARMOR_BASES[0];
	let armorValue = armorBase.id;
	const armorSources = [];
	if (armorBase.source) armorSources.push(armorBase.source);
	// "It's tiny: +1" (Book I p.397); Book II writes the source "(size)", as the Blue Magpie's is.
	if (size.id === "tiny") { armorValue += 1; armorSources.push("size"); }
	for (const id of sel.armorMods ?? []) {
		const mod = _byId(ARMOR_MODIFIERS, id);
		if (!mod) continue;
		armorValue += mod.armor;
		if (mod.source) armorSources.push(mod.source);
	}
	// A typed source overrides the auto-derived list; else fall back to the picks.
	const armorSource = String(sel.armorSource ?? "").trim() || armorSources.join(", ");

	// ── Damage ────────────────────────────────────────────────────────────────
	let dieSteps = 0;
	let damageBonus = size.damage;
	let advCount = 0;
	let disCount = 0;
	let piercingBonus = 0;
	const modTags = [];
	for (const id of sel.damageMods ?? []) {
		const mod = _byId(DAMAGE_MODIFIERS, id);
		if (!mod) continue;
		dieSteps += mod.die ?? 0;
		damageBonus += mod.damage ?? 0;
		advCount += mod.adv ?? 0;
		disCount += mod.dis ?? 0;
		piercingBonus += mod.piercing ?? 0;
		if (mod.tag) modTags.push(mod.tag);
	}
	const damageDie = stepDie(org.die, dieSteps);
	const rollMode = advCount > disCount ? "adv" : disCount > advCount ? "dis" : "";

	// Descriptive attack tags: chosen range tags, chosen effect tags, then any
	// contributed by damage modifiers (forceful, deft's piercing). First-seen order.
	const chosenRange  = (sel.damageTags ?? []).filter(t => DAMAGE_RANGE_TAGS.some(o => o.id === t));
	const chosenEffect = (sel.damageTags ?? []).filter(t => DAMAGE_EFFECT_TAGS.some(o => o.id === t));
	const damageTags = _attackTagList(_joinTags([...chosenRange, ...chosenEffect]), { modTags, piercingBonus });

	const bonusStr = signedBonus(damageBonus);
	const rollFormula = `${damageDie}${bonusStr}`;
	const advStr = rollMode === "adv" ? " w/advantage" : rollMode === "dis" ? " w/disadvantage" : "";
	const tagStr = damageTags.length ? ` (${damageTags.join(", ")})` : "";
	// WHAT IT HITS WITH, first, exactly where every printed stat block puts it: "rusty sword d8+2
	// (close, forceful)". Without a name the line is a bare die, and everything downstream that
	// reads the damage line for the blow's NAME comes back empty-handed — the combat flow's
	// "which attack?" buttons say nothing, and the damage card's fine print names no weapon.
	const attackName = _cleanAttackName(sel.attackName);
	const primary = `${attackName ? `${attackName} ` : ""}${rollFormula}${advStr}${tagStr}`;

	// …and then any OTHER blows this creature is printed with. 81 of the 212 shipped stat blocks
	// list more than one — the Assassin's "dagger d10 (hand, 1 piercing) or garrote d8 (hand,
	// grabby, ignores armor)" — and each is a separate die with its own armor clause, which is
	// why the sheet gives each its own roll button and Clash asks which one struck.
	const damageValue = joinAttackProse([
		primary,
		...(sel.extraAttacks ?? []).map(extra => _renderExtraAttack(extra, { rollFormula, advStr, modTags, piercingBonus })),
	]);

	// ── Tag line (organization + size + nature + notable + custom) ──────────────
	const tags = _joinTags([
		org.id,
		size.tag,
		...(sel.natureTags ?? []),
		...(sel.notableTags ?? []),
		..._splitCustom(sel.customTags),
	]).join(", ");

	return {
		hp,
		armorValue,
		armorSource,
		damageDie,
		damageBonus,
		rollMode,
		rollFormula,
		damageValue,
		damageTags,
		tags,
		count: org.count,
		rangeAdvice: size.range,
	};
}

/**
 * A stat block's max HP worked out again from the book's table, and its current HP after it.
 *
 * The same arithmetic the worksheet does (computeMonster): organization, plus size, plus each "what
 * else applies?" row (Book I p.396). The rows are not stored on a stat block, so the caller asks
 * which apply. Damage already taken stays taken: a crinwin down 1 of 3 is down 1 of the new max
 * too, floored at 0 and never above the new max. Null when there is no organization to start from,
 * since the base HP is the organization's.
 *
 * @param {{organization?: string, size?: string, hpMods?: string[], hpMax?: number, hpValue?: number}} o
 * @returns {{max: number, value: number}|null}
 */
export function rederiveMonsterHp({ organization, size, hpMods = [], hpMax = 0, hpValue = 0 } = {}) {
	const org = String(organization ?? "").trim().toLowerCase();
	if (!_byId(ORGANIZATIONS, org)) return null;
	const sizeId = String(size ?? "").trim().toLowerCase();
	const max = computeMonster({ organization: org, size: _byId(SIZES, sizeId) ? sizeId : "medium", hpMods }).hp;
	const taken = Math.max(0, (Number(hpMax) || 0) - (Number(hpValue) || 0));
	return { max, value: Math.min(max, Math.max(0, max - taken)) };
}

// Shape a `monster` Actor creation payload from an already-derived, flat options object.
// Shared by the Make-a-Monster worksheet (CreateMonsterDialog) and the corruption wizards
// (CorruptBeingDialog) so the two paths can never drift on the actor schema (the attributes
// block, the hostile prototype token, the empty `entry`). Foundry-free: returns a plain
// object; the HOSTILE disposition falls back to its constant (-1) when CONST is absent.
export function buildMonsterActorData({
	name, img, folder, creatureType,
	hp = 0, armorValue = 0, armorSource = "", damageValue = "", rollFormula = "", instinct = "",
	concept = "", organization = "", size = "", tags = "", qualities = "", notes = "", count = 1,
	items = [],
} = {}) {
	return {
		name,
		type: "monster",
		folder: folder ?? undefined,
		img,
		system: {
			attributes: {
				hp:       { value: hp, max: hp },
				armor:    { value: armorValue, source: armorSource },
				damage:   { value: damageValue, rollFormula },
				instinct: { value: instinct },
			},
			concept,
			organization,
			creatureType,
			size,
			tags,
			qualities,
			notes,
			count,
			entry: "",
		},
		prototypeToken: {
			name,
			actorLink: false,
			disposition: globalThis.CONST?.TOKEN_DISPOSITIONS?.HOSTILE ?? -1,
			texture: img ? { src: img } : undefined,
			width:  monsterTokenSize(size),
			height: monsterTokenSize(size),
		},
		items,
	};
}

/**
 * A creature's token footprint in grid squares, off its size tag: "Like a horse, cart, etc." takes
 * two squares a side, "Like an elephant, or bigger" three (Book I p.395's size rows). Tiny and small
 * stay a whole square rather than shrinking: a half-square token is too small a thing to click.
 */
const MONSTER_TOKEN_SIZES = Object.freeze({ large: 2, huge: 3 });

/** Grid squares a side for a monster of `size` (its `system.size`); 1 for anything else. */
export function monsterTokenSize(size) {
	return MONSTER_TOKEN_SIZES[String(size ?? "").trim().toLowerCase()] ?? 1;
}
