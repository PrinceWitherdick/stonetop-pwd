// THE LET FLY AN ARCANUM GRANTS, as its card prints it (data/weapons.js#ARCANA_GRANTED_WEAPONS): the Storm Markings'
// bolt of lightning, the Azure Hand's flung energy, the Aetherium Spear's warcry blast.
//
// Each is a weapon the Let Fly picker offers only while the card says it may be used, rolled with the stat the card
// prints in place of +DEX, and paid for with the price the card prints: ASKED, never taken silently, at the moment
// the attack is made (after the weapon and the targets, before the dice), so backing out of a window costs nothing.
// A price that cannot be paid (no Fury held, no debility left to mark) is FLAGGED, never refused (the stat-rules
// ruling): the attack goes ahead and its damage card says the price was not paid.

import { ARCANA_GRANTED_WEAPONS } from "../data/weapons.js";
import { backBoxChecked } from "../utils/glyphs.js";
import { heldOn, spendHeldCircle, markDebilityForBlow } from "../actors/character/arcana-blow-offers.js";
import { debilityPayments } from "../actors/character/invoke-consequences.js";
import { ARCANA_RIDERS, isArcanumWeapon, ruleTrack } from "../data/arcana-rules.js";
import { holdsArcanum } from "../actors/character/deaths-door-arcana.js";
import { confirmOutcome } from "../utils/ask-with-buttons.js";
import { format, localize } from "../utils/i18n.js";
import { escHtml } from "../utils/strings.js";

const KEY = "stonetop.fight.arcanaAttacks";

/** Storm's Fury (data/arcana-rules.js), whose hold track the bolt spends 1-for-1. */
const FURY = ARCANA_RIDERS.stormsFury;

/**
 * Whether `row`'s card lets this character use it now (its `gate`, see ARCANA_GRANTED_WEAPONS). Held and recovered
 * (owned, not a lead) always; then each printed condition.
 *
 * @param {Actor} actor
 * @param {object[]} gear  the carried gear records (StonetopCharacter#carriedWeaponGear)
 * @param {object} row
 */
export async function arcanaGrantOpen(actor, gear, row) {
	const arcana = actor?.typedActor?._arcana;
	if (!arcana || !row) return false;
	if (!holdsArcanum(actor.typedActor, row.card)) return false;
	const { gate = {} } = row;
	if (gate.identified && !arcana.identifiedSlugs?.has?.(row.card)) return false;
	if (gate.carried) {
		const open = gate.name
			? g => isArcanumWeapon(g, { slug: gate.carried, name: gate.name })
			: g => g?.slug === gate.carried;
		if (!(gear ?? []).some(open)) return false;
	}
	if (gate.backBoxes?.length) {
		if (!await arcana.isArcanumUnlocked?.(row.card)) return false;
		const card = await arcana.getArcanum?.(row.card);
		const back = card?.back?.description ?? "";
		const boxes = arcana.boxStates ?? {};
		if (!gate.backBoxes.every(label => backBoxChecked(back, row.card, label, boxes))) return false;
	}
	return true;
}

/**
 * The arcana Let Fly weapons this character may use now, as the attack flow's candidate records: a granted weapon
 * (`grantedBy`) carrying its `grant` (the stat, the price, the card). [] for a move other than a shot.
 *
 * @param {Actor} actor
 * @param {object[]} gear
 * @param {{filter: (meta: object) => boolean}} move  the attack move's weapon filter
 */
export async function arcanaAttackWeapons(actor, gear, move) {
	if (actor?.type !== "character") return [];
	const out = [];
	for (const [key, row] of Object.entries(ARCANA_GRANTED_WEAPONS)) {
		if (!move?.filter?.(row.meta) || !await arcanaGrantOpen(actor, gear, row)) continue;
		out.push({
			slug: row.slug, meta: row.meta, ammoStore: "inventory", ammoLabel: null, grantedBy: row.grantedBy,
			grant: { key, card: row.card, stat: row.stat, cost: row.cost, name: row.grantedBy, ...(row.gmDamage ? { gmDamage: true } : {}) },
		});
	}
	return out;
}

/**
 * Pay the price an arcana grant prints, ASKED first, as the attack is made. Answers:
 *   "cancel"            the player backed out: no attack;
 *   { paid: true }      the price is paid;
 *   { unpaid: words }   it could not be paid (no Fury held, no debility left): FLAGGED, the attack goes ahead.
 * Nothing for a weapon that is no arcana grant ({ paid: true }).
 *
 * @param {Actor} actor
 * @param {object|null} weapon  the serialized weapon, carrying `grant`
 * @param {{ask?: Function, spendFury?: Function, markDebility?: Function}} [deps]
 */
export async function payArcanaGrantCost(actor, weapon, { ask = confirmOutcome, spendFury = spendHeldCircle, markDebility = markDebilityForBlow } = {}) {
	const grant = weapon?.grant;
	if (!grant?.cost) return { paid: true };
	const name = actor?.name ?? "";
	const unpaid = key => {
		const words = format(`${KEY}.${key}`, { name, card: grant.name });
		globalThis.ui?.notifications?.warn?.(words);
		return { unpaid: words };
	};
	if (grant.cost === "fury") {
		// "You may spend Fury 1-for-1 to manifest one of the following" (Storm's Fury): no Fury held, no manifestation
		// by the book; flagged, not refused.
		const track = ruleTrack(FURY);
		if (!track || heldOn(actor?.typedActor?._arcana?.boxStates ?? {}, FURY.slug, track) < 1) return unpaid("noFury");
		const yes = await askPrice(ask, grant, "fury", name);
		if (!yes) return "cancel";
		// The circle spendHeldCircle takes (the last one held), read before it goes, so a roll that never lands
		// can tick that same circle back (refund).
		const spent = lastHeldCircle(actor?.typedActor?._arcana?.boxStates ?? {}, FURY.slug, track);
		if (!(await spendFury(actor, FURY.slug, track))) return unpaid("noFury");
		return { paid: true, refund: () => tickCircleBack(actor, FURY.slug, spent) };
	}
	if (grant.cost === "debility") {
		// "mark a debility and unleash a blast of lightning" (the Aetherium Spear): the player picks which.
		if (!debilityPayments(actor).length) return unpaid("noDebility");
		const before = new Set(markedDebilities(actor));
		if (!(await markDebility(actor, grant.name))) return "cancel";
		// The one just marked, cleared again by a roll that never lands (refund).
		const marked = markedDebilities(actor).find(key => !before.has(key));
		return marked ? { paid: true, refund: () => clearDebilityBack(actor, marked) } : { paid: true };
	}
	if (grant.cost === "vortex") {
		// Choosing to fling it is one of the "choose 1" that ends the vortex (the Azure Hand): nothing on the sheet to
		// spend, but it is said, and asked, so the energy is not thrown by a mis-click.
		return (await askPrice(ask, grant, "vortex", name)) ? { paid: true } : "cancel";
	}
	return { paid: true };
}

/** The index of a hold track's last held circle, the one spendHeldCircle unticks; null when none is held. PURE. */
function lastHeldCircle(boxes, slug, { from, length }) {
	for (let i = from + length - 1; i >= from; i--) if (boxes[`${slug}:backCircle:${i}`]) return i;
	return null;
}

/** The keys of this character's marked debilities (the Auspicious Birth circle among them). */
function markedDebilities(actor) {
	return (actor?.typedActor?.debilityMarkChoices ?? []).filter(d => d?.key && d.marked).map(d => d.key);
}

/** A Fury circle spent for a roll that never landed, ticked back. Never throws: a refund is a courtesy. */
async function tickCircleBack(actor, slug, index) {
	if (index === null) return;
	try { await actor?.typedActor?._arcana?.setArcanumBoxChecked?.(slug, "backCircle", index, true); }
	catch (err) { console.warn("Stonetop | could not tick the arcanum's circle back", err); }
}

/** A debility marked for a roll that never landed, cleared again. Never throws: a refund is a courtesy. */
async function clearDebilityBack(actor, key) {
	try { await actor?.typedActor?.receiveHealing?.({ clearDebilities: [key] }); }
	catch (err) { console.warn("Stonetop | could not clear the debility back", err); }
}

/** The price's question, in the card's own words (utils/ask-with-buttons.js#confirmOutcome). True on the pay button. */
async function askPrice(ask, grant, kind, name) {
	const answer = await ask({
		title: grant.name,
		content: `<p>${escHtml(format(`${KEY}.${kind}Ask`, { name, card: grant.name }))}</p>`,
		yes: { label: localize(`${KEY}.${kind}Pay`), icon: "fa-bolt" },
		no: { label: localize(`${KEY}.cancel`) },
		defaultYes: true,
	});
	return answer === true;
}
