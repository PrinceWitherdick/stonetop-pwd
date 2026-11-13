// WHAT AN INSERT'S OPTION GIVES A CHARACTER WHILE THEY WEAR ITS FORM, read off its own words. PURE.
//
// A homebrew insert's pick list (the Stranger's Monster Compendium, "Armament pick 2") prints its
// gear the way the book prints a weapon or an armor:
//   "Razor Claws: d8+2 (close, messy)"            a weapon with a die of its own and its tags;
//   "Chitinous Shell or Thick Hide: Armor 2"     a worn armor (the best one worn counts);
//   "Hard Plates: +1 armor"                      armor on top, as a shield is.
// Anything else ("Leathery Wings: allow for short bouts of flight") is a trait the table plays out,
// and gives nothing here.
//
// A weapon's note is written the way the shared tag-line reader reads a weapon's own die
// (data/weapon-from-note.js: "damage d8+2, close, messy"), so a monster's claws attack through the
// same path as a write-in weapon or an artifact's.

const WEAPON = /^([^:]+):\s*(\d*d\d+(?:\s*[+-]\s*\d+)?)\s*(?:\(([^)]*)\))?/i;
const ARMOR_BASE = /^([^:]+):\s*(?:armou?r\s*(\d+)|(\d+)\s*armou?r)\b/i;
const ARMOR_BONUS = /^([^:]+):\s*\+\s*(\d+)\s*armou?r\b/i;

/**
 * @param {string} text  the option's words, plain (no markup)
 * @returns {null | {kind: "weapon", name: string, note: string} | {kind: "armor", name: string, armor: {base?: number, modifier?: number}}}
 */
export function insertGearFromOption(text) {
	const t = String(text ?? "").replace(/\s+/g, " ").trim();
	let m = t.match(WEAPON);
	if (m) {
		const die = m[2].replace(/\s+/g, "");
		const tags = String(m[3] ?? "").trim();
		return { kind: "weapon", name: m[1].trim(), note: `damage ${die}${tags ? `, ${tags}` : ""}` };
	}
	m = t.match(ARMOR_BONUS);
	if (m) return { kind: "armor", name: m[1].trim(), armor: { modifier: Number(m[2]) } };
	m = t.match(ARMOR_BASE);
	if (m) return { kind: "armor", name: m[1].trim(), armor: { base: Number(m[2] ?? m[3]) } };
	return null;
}
