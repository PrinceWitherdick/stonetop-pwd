// Weapon metadata for gear the curated WEAPON_META table does not cover.
//
// WEAPON_META is keyed by catalog slug, which is right for the book's equipment list but leaves
// out everything a character picks up in play: the Blood-quenched Sword and the Thunderbolt Bow
// (arcana), the makerglass blades and hauberks of Book II (treasures), and a player's own
// write-ins. None of those has a slug in the table, so none was ever offered for Clash or Let Fly
// — however plainly its tag line stated "close, +1 damage, 1 piercing, messy".
//
// That tag line IS the statement of record: the book writes a weapon's mechanics there in a fixed
// vocabulary, the same one the Add-Item dialog's chips insert and gear-terms.js documents. So the
// metadata is READ off it rather than hand-authored per item, which keeps a single source of
// truth and means a homebrew arcanum written the book's way works with no code change.
//
// Deliberately conservative: no range tag means no weapon. A rope is "close" in no sense the
// attack flow should offer, and the ranges are exactly what isClashWeapon / isLetFlyWeapon gate
// on, so an item that names none of them simply isn't a weapon and this returns null.
//
// AND A RANGE TAG ALONE IS NOT ENOUGH EITHER, because the book writes two other things in this
// same vocabulary. A LIGHT SOURCE states how far it shines and how long it burns in exactly the
// words a weapon states its reach — the torch's "lasts ~1 hour; reach, area, dangerous", the
// lantern's "5 hours, reach, area, magical" — and a BEAST states the damage IT deals, not the
// damage you deal with it ("HP 10, d6+3 damage (hand, close, forceful)"). Both are read off
// below and refused, so a player carrying a lit torch and a donkey is not asked which of the
// three they are swinging.

import { M, MELEE_RANGES, RANGED_RANGES } from "./weapons.js";
import { DAMAGE_DIE_RE, IGNORES_ARMOR_RE, PIERCING_RE } from "../utils/damage.js";
import { stripHtmlToText } from "../utils/strings.js";

// The book's range vocabulary, built from the sets isClashWeapon / isLetFlyWeapon gate on
// rather than restated, so a range added there is understood here too. `thrown` is both a
// range and the Let Fly qualifier.
const RANGES = [...MELEE_RANGES, ...RANGED_RANGES, "thrown"];

// Flavour tags with no damage-number effect, recognised so they survive onto the card and the
// picker's subtitle (isForcefulWeapon / isMessyWeapon read them). Anything not listed is prose
// and is dropped rather than guessed at.
const TAGS = [
	"forceful", "messy", "awkward", "dangerous", "grabby", "slow", "reload",
	"loud", "silver", "iron", "magical", "crude", "beautiful", "indestructible", "terrifying",
];

const has = (text, word) => new RegExp(`(^|[\\s,(])${word}\\b`, "i").test(text);

// A CREATURE'S own stat line, which the catalog writes beside a pack animal and a follower dog:
// "HP 10, d6+3 damage (hand, close, forceful)". That die is the horse's.
const CREATURE_LINE_RE = /\bHP\s*\d/i;

// HOW LONG IT LASTS — the half of a light source's line that a weapon never has. Both spellings
// the catalog uses: the verb ("lasts ~1 hour", "enough to last 1 full night") and the bare unit
// ("5 hours", "~15-30 minutes").
const BURNS_FOR_RE = /\blasts?\b|\b(?:hours?|minutes?|days?|nights?)\b/i;

// "x piercing", whose value is the steading's Prosperity. The one piercing form PIERCING_RE does
// not cover, and read in two places below — as a piercing value, and as evidence of a weapon.
const PROSPERITY_PIERCING_RE = /(^|[\s,(])x\s*piercing\b/i;

/**
 * Does this tag line state DAMAGE — any of the four ways the book writes it? This is what tells a
 * weapon apart from a thing that merely has a reach: the naphtha's "damage d10, thrown, area,
 * dangerous, ignores armor" is a weapon with an area, and the self-burning lamp's "reach, area,
 * hours" is a light with neither.
 */
function statesDamage(text) {
	return DAMAGE_DIE_RE.test(text)
		|| /\+\s*\d+\s*damage\b/i.test(text)
		|| PIERCING_RE.test(text)
		|| PROSPERITY_PIERCING_RE.test(text)
		|| IGNORES_ARMOR_RE.test(text);
}

// A gear CHOICE hands its whole printed line as the name, because the book prints the name and
// the tag line as one sentence: "<strong>Black iron maul</strong>, utterly immune to all magic
// (<em>close, forceful, awkward</em>, +1 damage)". The BOLDED RUN is the weapon's name there, and
// everything after it is prose and tags the picker's subtitle and the chat card already state.
// An item with a real name field — a treasure, an arcanum's curio, a write-in — carries no markup
// and is taken whole.
const BOLD_RUN_RE = /<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/i;

function displayName(raw) {
	const text = String(raw ?? "");
	const bold = BOLD_RUN_RE.exec(text);
	return stripHtmlToText(bold ? bold[2] : text).replace(/\s+/g, " ").trim();
}

/**
 * WEAPON_META-shaped metadata read off an item's own name + tag line, or null when the tag line
 * does not describe a weapon.
 *
 * @param {string} name  the item's name, used only as the weapon's display name — markup and, for
 *        a gear choice that prints its name and its line as one, the trailing prose are dropped
 * @param {string} note  its tag line ("close, +1 damage, 1 piercing, messy, magical")
 * @param {{ammo?: boolean}} [opts]  `ammo` when the item carries a uses/ammo track, which is what
 *        gates Let Fly's "deplete your ammo" pick — a property of the ITEM's resource track, not
 *        something the tag line states.
 */
export function weaponMetaFromNote(name, note, { ammo = false } = {}) {
	const text = stripHtmlToText(note);
	if (!text.trim()) return null;

	const range = RANGES.filter(r => has(text, r));
	if (!range.length) return null;

	// A BEAST'S OWN DAMAGE IS NOT YOURS TO SWING. The catalog gives the dog, the donkey, the
	// horse and the mule a die in the same shape a weapon's, because in a fight the animal bites.
	if (CREATURE_LINE_RE.test(text)) return null;

	// A REACH WITH NO DAMAGE BESIDE IT, on a thing that lights an area or says how long it burns,
	// is an ILLUMINATION radius and not a weapon's reach. This is the whole of the difference
	// between the torch and the naphtha, which the book otherwise writes alike. A knife saying
	// only "hand, magical" is untouched: it claims neither an area nor an hour.
	if (!statesDamage(text) && (has(text, "area") || BURNS_FOR_RE.test(text))) return null;

	// "+N damage". The bare "damage" in a stat block ("damage d10") is not a bonus, so the sign
	// is required — which is exactly how the book writes a weapon's bonus.
	const dmg = /\+\s*(\d+)\s*damage\b/i.exec(text);
	// "2 piercing" - the same clause the damage flow reads off a stat block, shared so the two
	// cannot word it differently. The iron weapons' "x piercing", whose value is the steading's
	// Prosperity, is the one form PIERCING_RE does not cover and stays local.
	const pierceN = PIERCING_RE.exec(text);
	const pierceX = PROSPERITY_PIERCING_RE.exec(text);

	// Through weapons.js's own factory, so a field added to WEAPON_META defaults here too
	// rather than being silently absent on every arcanum, treasure and write-in weapon.
	return M({
		name: displayName(name) || "Weapon",
		range,
		damageBonus: dmg ? Number(dmg[1]) : 0,
		piercing: pierceX ? "prosperity" : (pierceN ? Number(pierceN[1]) : 0),
		ignoresArmor: IGNORES_ARMOR_RE.test(text),
		area: has(text, "area"),
		ammo: !!ammo,
		iron: has(text, "iron"),
		tags: TAGS.filter(t => has(text, t)),
	});
}
