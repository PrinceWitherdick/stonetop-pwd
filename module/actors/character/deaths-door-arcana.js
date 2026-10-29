import { backBoxChecked } from "./CharacterArcana.js";

/**
 * Arcana whose marked Consequence decides a 6- at Death's Door (Book II). The Death's Door window flags the
 * fate each one dictates and suggests it; the other fates stay open, since a rule broken is flagged, never
 * blocked.
 *
 *   Redwood Effigy: "When you roll 6- at Death's Door, you have no choice: gain the Revenant insert until the
 *     effigy is destroyed (and you become a wraith controlled by the GM) or it is buried in a Red Grove".
 *   Noruba's Ice Sphere: "When you roll 6- at Death's Door, you have no choice: gain the Ghost insert (with the
 *     Ice Sphere as your tether)".
 *   Hungering Maw of Hlad: "Should you roll a 6- on Death's Door, you die and become a wraith (a monster in the
 *     GM's control)". That is the Last Door: they die, and what comes back is the GM's.
 *
 * `label` is the box's printed words, found in the card's back text (backBoxChecked); `fate` and `insert` are
 * DeathsDoorDialog's fate key and post-death insert slug; `tether` fills the Ghost's tether with the card's name;
 * `i18n` names the caution (`stonetop.specialMoves.deathsDoor.dictated.<i18n>`).
 *
 * Left out: the Rune-laden Scales' PROOF AGAINST HARM (a choice made before the roll) and Carvings in a cave
 * (a bound soul you MAY release on a 6-). Neither dictates the fate.
 */
export const DEATHS_DOOR_ARCANA = Object.freeze([
	Object.freeze({ slug: "redwood-effigy",        label: "When you roll 6- at Death's Door",     fate: "refuse",    insert: "revenant", tether: false, i18n: "redwoodEffigy" }),
	Object.freeze({ slug: "norubas-ice-sphere",    label: "When you roll 6- at Death's Door",     fate: "refuse",    insert: "ghost",    tether: true,  i18n: "iceSphere" }),
	Object.freeze({ slug: "hungering-maw-of-hlad", label: "Should you roll a 6- on Death's Door", fate: "last-door", insert: null,       tether: false, i18n: "hungeringMaw" }),
]);

/**
 * The fates the held cards dictate, in table order. `cards` are `{ slug, name, back }` (back = the back's text,
 * HTML), one per arcanum the character holds; `boxStates` is the arcana box map (`slug:back:index`). A card
 * counts only when the box with its Death's Door words is ticked.
 */
export function dictatedFates(cards = [], boxStates = {}) {
	const held = new Map((cards ?? []).filter(c => c?.slug).map(c => [c.slug, c]));
	const out = [];
	for (const rule of DEATHS_DOOR_ARCANA) {
		const card = held.get(rule.slug);
		if (!card || !backBoxChecked(card.back, rule.slug, rule.label, boxStates ?? {})) continue;
		out.push({ ...rule, name: card.name || rule.slug });
	}
	return out;
}

/**
 * The one dictate to suggest when several are marked: the first, in table order. Two that disagree (an Effigy
 * AND an Ice Sphere) are both flagged, and the table settles it.
 */
export function suggestedDictate(dictates = []) {
	return dictates?.[0] ?? null;
}

/**
 * Everything heldDeathsDoorDictates reads off the character, as one string: which of the three cards they own,
 * which are still leads, and which of their back boxes are ticked. The same key, the same answer, so a window
 * redrawn for any other reason need not read the cards again. Synchronous.
 */
export function deathsDoorDictatesKey(character) {
	const arcana = character?._arcana;
	if (!arcana) return "";
	const owned = arcana.ownedSlugs ?? new Set();
	const leads = arcana.leadSlugs ?? new Set();
	const boxes = arcana.boxStates ?? {};
	return JSON.stringify(DEATHS_DOOR_ARCANA.map(({ slug }) => [
		owned.has(slug), leads.has(slug),
		Object.keys(boxes).filter(k => k.startsWith(`${slug}:back:`) && boxes[k]).sort(),
	]));
}

/**
 * What a character holds, read for dictatedFates: the cards they own and have recovered (a lead is not yet in
 * their hands), with the back text and name from the card itself. Only the three cards above are fetched.
 */
export async function heldDeathsDoorDictates(character) {
	const arcana = character?._arcana;
	if (!arcana) return [];
	const owned = arcana.ownedSlugs ?? new Set();
	const leads = arcana.leadSlugs ?? new Set();
	const slugs = DEATHS_DOOR_ARCANA.map(d => d.slug).filter(s => owned.has(s) && !leads.has(s));
	if (!slugs.length) return [];
	const cards = (await Promise.all(slugs.map(s => arcana.getArcanum(s)))).filter(Boolean).map(item => ({
		slug: item.slug,
		name: item.front?.title ?? item.back?.title ?? "",
		back: item.back?.description ?? "",
	}));
	return dictatedFates(cards, arcana.boxStates ?? {});
}
