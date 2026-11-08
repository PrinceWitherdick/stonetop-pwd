// WHAT AN ARCANUM ADDS TO A BLOW, as lines in the damage window (audit EDG-5, 2026-11-06).
//
// fight/hero-moves.js#blowOffers asks this once, for the character's own blow, beside the playbook moves. Each
// rider follows the card's printed words (Book II), and the user's call for them ("imposed when the text makes it
// automatic and the sheet can check it; a line where it costs a spend or depends on fiction"):
//
//   Flaming Sword (the rusty steel blade's back, p.534): "When you deal damage with the sword, add the Blaze
//     die." IMPOSED (ticked) when the blow is the Flaming Sword's and the Blaze die is lit (its track marked:
//     "the fire goes out ... until the Blaze die is nil").
//   Aetherium Spear (the corroded spearhead's back, p.531): "When you Clash with the aetherium spear and get a 7+,
//     you can mark a debility to blast your foe with lightning, dealing +1d6 damage (forceful, loud)." A line that
//     costs a debility, on a Clash's damage with the spear.
//   Thunderbolt Bow (the bow with no string's back, p.532): after drawing back the lightning for ten deep breaths,
//     "Your next shot deals +1d4 damage (+area, +dangerous)". Fiction the sheet cannot see: a line, on a shot.
//   Storm Markings, STORM'S FURY (pp.566-567): "spend Fury 1-for-1 to ... Imbue your next strike with the force of
//     thunder (+1d6 damage, forceful, loud)". A line that spends 1 Fury, while Fury is held.
//   Twisted Spear, PROMISE OF DOOM (pp.542-543): "you do +2d4 damage against them and -4 damage to everything
//     else". Who was sworn against is fiction: two lines, the sworn foe's and everything else's.
//   Shield of the Wisent Witch, SPIRITS OF THE HERD (pp.554-555): "Treat the herd as a weapon (+2d4 damage,
//     forceful, messy, area, dangerous, terrifying) as you Clash." Called up in the fiction: a line, on a Clash.
//   Blood-quenched Sword, its blood-rage consequence (pp.552-553): "When you attack the nearest living creature,
//     you have advantage on damage rolls." Who is nearest is fiction: a line of advantage.
//
// Lines that cost something, or that depend on what happened in the fiction, open UNTICKED, as every such line in
// blowOffers does (Anger is a Gift's spend, Predator, Blood-Soaked Past): a ticked spend would pay a Fury or a
// debility the player never chose to pay. The cost is paid only once the window comes back with the line ticked,
// and a line whose cost can no longer be paid is left off the blow (attack-flow.js#askDamageAdjustment).
//
// Each card's rider is a row of data/arcana-rules.js#ARCANA_RIDERS: its weapon, the blows it rides on, its dice,
// tags and price, and the boxes it reads, each box named by its printed label and found on the card's back text
// (#ruleMarked, #ruleTrack). Only the Blaze die, read off the sword's track, is worked out here.

import { format, localize } from "../../utils/i18n.js";
import { askWithButtons } from "../../utils/ask-with-buttons.js";
import { escHtml } from "../../utils/strings.js";
import { holdsArcanum } from "./deaths-door-arcana.js";
import { ARCANA_RIDERS, isArcanumWeapon, ruleMarked, ruleTrack } from "../../data/arcana-rules.js";

const KEY = "stonetop.fight.arcanaBlows";


/** The Flaming Sword's Blaze die by marks on its track (its card's `resource.labels`). */
const BLAZE_DICE = Object.freeze(["1d4", "1d6", "1d8", "1d10"]);

/** The character's arcana state, read so it never throws. */
export function arcanaOf(actor) {
	const arcana = actor?.typedActor?._arcana ?? null;
	return {
		arcana,
		owned: arcana?.ownedSlugs ?? new Set(),
		boxes: arcana?.boxStates ?? {},
	};
}

/** How many ○ of a held track are ticked: HELD (the user's ruling on a hold track's pips). PURE. */
export function heldOn(boxes, slug, { from, length }) {
	let held = 0;
	for (let i = from; i < from + length; i++) if (boxes[`${slug}:backCircle:${i}`]) held++;
	return held;
}

/** A line in the window's shape (dialogs/RollDialog.js#withOffers), its words under KEY. */
function line(key, dice, { applied = false, tags = [], spend = null, mode = null, card = "", what = "" } = {}) {
	return {
		key: `arcana-${key}`, applied, tags, ...(dice ? { dice } : {}), ...(mode ? { mode } : {}), ...(spend ? { spend } : {}),
		label: format(`${KEY}.${key}.label`, { dice: dice ?? "", what }),
		pill:  format(`${KEY}.${key}.pill`, { dice: dice ?? "", card }),
	};
}

/**
 * Untick the last held ○ of a card's hold track. Answers true when one came off, null when none was held by then
 * (spent elsewhere while the window was open): the window reads null as unpaid.
 */
export async function spendHeldCircle(actor, slug, track) {
	const arcana = actor?.typedActor?._arcana;
	if (!arcana) return null;
	const boxes = arcana.boxStates ?? {};
	for (let i = track.from + track.length - 1; i >= track.from; i--) {
		if (!boxes[`${slug}:backCircle:${i}`]) continue;
		await arcana.setArcanumBoxChecked(slug, "backCircle", i, false);
		return true;
	}
	return null;
}

/**
 * Mark a debility of the player's choice, the Aetherium Spear's price. Answers true once one is marked, null when
 * none is left to mark or the player backed out (the +1d6 is then left off).
 */
export async function markDebilityForBlow(actor, moveName, { ask = askWithButtons } = {}) {
	const character = actor?.typedActor;
	// Named as the sheet names them (the Auspicious Birth circle included), unlike debilityPayments.
	const open = (character?.debilityMarkChoices ?? []).filter(d => !d.marked);
	if (!open.length) {
		globalThis.ui?.notifications?.info?.(format(`${KEY}.noDebility`, { name: actor?.name ?? "" }));
		return null;
	}
	const key = await ask({
		title: moveName,
		content: `<p>${escHtml(format(`${KEY}.debilityAsk`, { name: actor?.name ?? "" }))}</p>`,
		buttons: [
			...open.map(d => ({ key: `debility-${d.key}`, label: d.name, value: d.key })),
			{ key: "cancel", label: localize(`${KEY}.debilityCancel`), value: null },
		],
	});
	if (!key) return null;
	return (await character.markDebility(key, { moveName })) ? true : null;
}

/** What a rider's ticked line costs, by its card's `spend` (data/arcana-rules.js#ARCANA_RIDERS): paid only once ticked. */
const RIDER_SPENDS = Object.freeze({
	// The Aetherium Spear's lightning: a debility of the player's choice.
	debility: rule => hero => markDebilityForBlow(hero, rule.name),
	// Storm's Fury: 1 Fury off its hold track, as the track read when the line was offered.
	track: rule => {
		const track = ruleTrack(rule);
		return hero => spendHeldCircle(hero, rule.slug, track);
	},
});

/**
 * Whether a rider speaks to this blow: its card held, the blow its move (`on`, `strikeBack`) and its weapon, its
 * box marked, its hold track holding one. PURE but for reading the actor.
 */
function riderOn(rule, { actor, boxes, weapon, moveKey, strikeBack }) {
	if (rule.on === "clash" && moveKey !== "clash") return false;
	if (rule.on === "shot" && moveKey === "clash") return false;
	if (rule.strikeBack === false && strikeBack) return false;
	if (!holdsArcanum(actor.typedActor, rule.slug)) return false;
	if (rule.weapon && !isArcanumWeapon(weapon, rule)) return false;
	if (rule.label && !ruleMarked(boxes, rule)) return false;
	if (!rule.track) return true;
	const track = ruleTrack(rule);
	return !!track && heldOn(boxes, rule.slug, track) > 0;
}

/** The Flaming Sword's Blaze die as its track stands, or null while it is nil. */
function blazeDie(actor, rule) {
	const blaze = Math.min(BLAZE_DICE.length, Math.trunc(Number(actor.typedActor?._inventory?.resources?.[rule.slug]) || 0));
	return blaze > 0 ? BLAZE_DICE[blaze - 1] : null;
}

/**
 * The lines this character's arcana add to a blow (see the header). PURE but for reading the actor; the spends
 * write only when called.
 *
 * @param {Actor} actor  the character striking
 * @param {{weapon?: object|null, moveKey?: string, strikeBack?: boolean}} [blow]
 * @returns {object[]}
 */
export function arcanaBlowOffers(actor, { weapon = null, moveKey = "", strikeBack = false } = {}) {
	if (actor?.type !== "character") return [];
	const { arcana, boxes } = arcanaOf(actor);
	if (!arcana) return [];
	const blow = { actor, boxes, weapon, moveKey, strikeBack };
	const out = [];
	for (const rule of Object.values(ARCANA_RIDERS)) {
		if (!riderOn(rule, blow)) continue;
		const spend = RIDER_SPENDS[rule.spend]?.(rule) ?? null;
		for (const { key, dice, blaze, applied = false, tags, mode } of rule.lines) {
			// The Flaming Sword's Blaze die, lit while its track is marked.
			const die = blaze ? blazeDie(actor, rule) : dice;
			if (blaze && !die) continue;
			out.push(line(key, die ?? "", { applied, tags: [...(tags ?? [])], mode, spend, card: rule.name }));
		}
	}
	return out;
}
