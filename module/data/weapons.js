// Structured weapon metadata for the Clash / Let Fly attack flow.
//
// Stonetop weapons are NOT their own document type — every weapon is an inventory
// OutfitItem (a `move` with system.moveType === "inventory") whose range and tags
// live only as free-text prose in its `note`. This map is the ONE structured source
// that lets the attack flow (a) tell melee from thrown/ranged, (b) apply a weapon's
// `+N damage` and piercing to the damage it deals, (c) gate Let Fly's ammo pick, and
// (d) recognise `area` weapons (the only RAW justification for hitting many targets).
//
// A Stonetop PC has ONE damage die (system.attributes.damage.value, playbook-derived);
// the weapon never changes that die — it only rides these modifiers on top of it. The
// sole exception is a weapon with its own fixed `damageDie` (naphtha), which replaces
// the PC die for that attack.
//
// Keyed by the inventory-item slug (packs/src/stonetop-items/inventory-items/<slug>.json),
// transcribed from those notes and the Weapons of War handout (module/data/special-items.js).
// Field semantics mirror module/data/gear-terms.js.
//
//   range        Range/throw keywords: hand | close | reach (melee) · near | far (ranged) · thrown.
//   damageBonus  The "+N damage" tag — added to the dealt damage.
//   piercing     Ignores this many points of the target's armor. A number is fixed;
//                "prosperity" is the iron-weapon "x piercing" whose value = the party
//                steading's CURRENT Prosperity, resolved live at apply time (never baked).
//   ignoresArmor Damage fully bypasses the target's armor (naphtha).
//   area         Affects everything in an area — the RAW basis for multi-target damage.
//   damageDie    Overrides the PC's own damage die (e.g. naphtha "d8"); null = use the PC die.
//   ammo         Weapon tracks ammo statuses (low ammo / all out); gates Let Fly's
//                "deplete your ammo" 7-9 pick.
//   iron         Iron weapon (relevant to "x piercing = Prosperity" and some fiction).
//   tags         Display-only flavour tags with no damage-number effect (forceful, messy,
//                awkward, reload, dangerous, silver, grabby).
//
// NOTE: battleaxe is recorded here as the rulebook-canonical `messy` (Weapons of War,
// special-items.js). The battleaxe pack note currently reads "+1 damage" — a data bug
// (copied from Sword); this map uses the correct value.

import { altStatGrantForMove } from "./alt-stat-grants.js";

const M = (over = {}) => ({
	range: [],
	damageBonus: 0,
	piercing: 0,
	ignoresArmor: false,
	area: false,
	damageDie: null,
	ammo: false,
	iron: false,
	tags: [],
	...over,
});

export const WEAPON_META = {
	// ---- Melee ---------------------------------------------------------------
	"staff":              M({ name: "Staff",              range: ["close"] }),
	"knife-dagger":       M({ name: "Knife or dagger",    range: ["hand"] }),
	"silver-alloy-dagger":M({ name: "Silver-alloy dagger",range: ["hand"], tags: ["silver"] }),
	"spear":              M({ name: "Spear",              range: ["close", "thrown"], piercing: "prosperity" }),
	"long-spear":         M({ name: "Long spear",         range: ["reach"], piercing: "prosperity" }),
	"maul":               M({ name: "Maul",               range: ["close"], tags: ["forceful", "awkward"] }),
	"hatchet":            M({ name: "Hatchet",            range: ["hand", "thrown"], piercing: "prosperity" }),
	"mattock":            M({ name: "Mattock",            range: ["close"], piercing: "prosperity", tags: ["messy", "awkward"] }),
	"mace-or-flail":      M({ name: "Mace or flail",      range: ["close"], iron: true, tags: ["forceful"] }),
	"battleaxe":          M({ name: "Battleaxe",          range: ["close"], iron: true, tags: ["messy"] }),
	"short-sword":        M({ name: "Short sword",        range: ["hand", "close"], iron: true }),
	"sword":              M({ name: "Sword",              range: ["hand", "close"], iron: true, damageBonus: 1 }),
	"warhammer":          M({ name: "Warhammer",          range: ["close"], iron: true, piercing: 2 }),

	// ---- Thrown / ranged (Let Fly) -------------------------------------------
	"javelins":           M({ name: "Javelins",           range: ["thrown"], piercing: "prosperity", damageBonus: 1 }),
	"bow-arrows":         M({ name: "Bow & arrows",       range: ["near"], piercing: "prosperity" }),
	"sling":              M({ name: "Sling",              range: ["near"], tags: ["reload", "awkward"] }),
	"crossbow":           M({ name: "Crossbow",           range: ["far"], damageBonus: 1, piercing: "prosperity", ammo: true, tags: ["reload"] }),
	"composite-bow":      M({ name: "Composite bow",      range: ["far"], damageBonus: 1, piercing: "prosperity", ammo: true }),
	"naphtha":            M({ name: "Naphtha",            range: ["thrown"], area: true, ignoresArmor: true, damageDie: "d8", tags: ["dangerous"] }),
};

// Weapons a MOVE grants rather than the pack carries. The Lightbearer's holy light
// "counts as a weapon (d10 damage, hand, close, area, 2 piercing)" under Purifying
// Flames — a d10 that replaces the PC's own damage die (the naphtha case), which is the
// whole reason the move is worth taking. Keyed by the granting move's name; `slug` is
// virtual (no inventory item backs it) but unique, so the attack flow serializes and
// pre-selects it exactly like a carried weapon.
export const MOVE_GRANTED_WEAPONS = {
	"Purifying Flames": {
		slug: "purifying-flames-holy-light",
		meta: M({ name: "Holy light", range: ["hand", "close"], area: true, piercing: 2, damageDie: "d10" }),
		// A holy light has to actually be BURNING to swing it — but that, like whether the foe is a
		// creature of darkness, is the table's call rather than ours to enforce. So the row names
		// the state to look at and the line to say when it is off, and the sheet only reads them:
		// the next granted weapon with a precondition of its own adds two fields here instead of a
		// branch in the shared roll path.
		//   readyWhen      a property of the actor's StonetopCharacter that must be truthy
		//   unreadyNotice  the i18n key for the reminder posted when it is not
		readyWhen: "holyLight",
		unreadyNotice: "stonetop.holyLight.unlitAttackNotice",
	},
};

/**
 * Attacking with nothing in hand. Not carried, and not a weapon anyone owns — the attack flow
 * shows it as a row beside a move-granted weapon so a weapon nobody picked up is never the only
 * answer on offer. Damage falls back to the PC's own die, which is what unarmed already did.
 */
export const UNARMED_META = M({ name: "Unarmed", range: ["hand"] });

/**
 * The weapon a move grants, or null.
 *
 * `whenStat` and `viaMove` come back with it, both read off the move's alt-stat grant rather
 * than recorded a second time here, so changing that one row changes every side:
 *   whenStat  the stat whose choice implies this weapon, so picking +WIS pre-selects the holy
 *             light in the weapon prompt;
 *   viaMove   the attack move the weapon rides on ("Clash"), which is what lets USING the
 *             granting move be that attack with this weapon already in hand.
 */
export function grantedWeaponForMove(moveName) {
	const granted = MOVE_GRANTED_WEAPONS[moveName];
	if (!granted) return null;
	const grant = altStatGrantForMove(moveName);
	return { ...granted, whenStat: grant?.altStat ?? null, viaMove: grant?.whenMove ?? null };
}

const MELEE_RANGES  = new Set(["hand", "close", "reach"]);
const RANGED_RANGES = new Set(["near", "far"]);

/** Metadata for a weapon slug, or null if the slug isn't a known weapon
 *  (tools, supplies, and write-ins fall through here). */
export function weaponMeta(slug) {
	return WEAPON_META[slug] ?? null;
}

/** A melee weapon can be used with Clash (has a hand/close/reach range). */
export function isMeleeWeapon(meta) {
	return !!meta && meta.range.some(r => MELEE_RANGES.has(r));
}

/** A thrown weapon (spear, hatchet, javelins, naphtha) — usable with Let Fly. */
export function isThrownWeapon(meta) {
	return !!meta && meta.range.includes("thrown");
}

/** A true ranged weapon (bow/sling/crossbow) — usable with Let Fly. */
export function isRangedWeapon(meta) {
	return !!meta && meta.range.some(r => RANGED_RANGES.has(r));
}

/** Weapons offered for Clash — melee. */
export function isClashWeapon(meta) {
	return isMeleeWeapon(meta);
}

/** Weapons offered for Let Fly — thrown or ranged. Thrown weapons (e.g. Spear)
 *  therefore appear in BOTH the Clash and Let Fly lists. */
export function isLetFlyWeapon(meta) {
	return isThrownWeapon(meta) || isRangedWeapon(meta);
}

/** A `messy` weapon — its attacks are especially destructive (Weapons of War). Accepts
 *  either a WEAPON_META entry or the serialized weapon baked into a chat card, since both
 *  carry `tags`. */
export function isMessyWeapon(weapon) {
	return !!weapon?.tags?.includes("messy");
}

/** A `forceful` weapon — it can knock a target around, maybe off their feet. Accepts a
 *  WEAPON_META entry or a serialized card weapon (both carry `tags`). */
export function isForcefulWeapon(weapon) {
	return !!weapon?.tags?.includes("forceful");
}

/** The armor-facing half of a weapon's traits: what it does to the target's armor when the
 *  damage is applied. Split out so the damage card, which has room for nothing else, still
 *  words piercing exactly as the picker's full readout does. Accepts a WEAPON_META entry or
 *  a serialized card weapon. */
export function weaponArmorBits(meta) {
	const bits = [];
	if (meta.piercing === "prosperity") bits.push("x piercing");
	else if (meta.piercing) bits.push(`${meta.piercing} piercing`);
	if (meta.ignoresArmor) bits.push("ignores armor");
	return bits;
}

/** A short readout of a weapon's mechanically-relevant traits — the weapon picker's
 *  subtitle, and the stat picker's note for a move-granted weapon. Accepts a WEAPON_META
 *  entry or a serialized card weapon. Lives here, not in the attack flow, so both callers
 *  word a weapon the same way. */
export function weaponTraitText(meta) {
	const bits = [meta.range.join(", ")];
	if (meta.damageBonus) bits.push(`${meta.damageBonus > 0 ? "+" : ""}${meta.damageBonus} damage`);
	bits.push(...weaponArmorBits(meta));
	if (meta.area) bits.push("area");
	if (meta.damageDie) bits.push(`${meta.damageDie} damage`);
	if (meta.tags?.length) bits.push(meta.tags.join(", "));
	return bits.filter(Boolean).join(" · ");
}
