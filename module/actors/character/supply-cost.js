import { PROVISIONS_SLUG } from "./provisions.js";

/**
 * WHAT CAN PAY A USE OF SUPPLIES — and, just as importantly, what cannot, and why.
 *
 * Three things on the Inventory insert hold "uses of supplies" and two more stand in for them in
 * particular circumstances, and the circumstances are not the same for both. Book I p.89 is
 * explicit about provisions: "Expend provisions in place of supplies when you Make Camp, or to
 * feed yourself as you travel." Not to Recover — that move says "expend 1 use of supplies"
 * (p.246), and the one thing the books do let you Recover on instead is a vial of Twisting Pine
 * sap, "used in lieu of supplies to Recover" (Book II p.462), which correspondingly does NOT
 * feed anybody at camp.
 *
 * So eligibility runs both ways, and neither surface can be trusted to remember its half of it.
 * The table below is the whole rule, read by every spend path, and the reason a purse is refused
 * travels with the refusal — a player looking at four uses of provisions and a Recover button
 * that will not take them is owed the sentence that explains it, not a greyed-out row.
 */
export const SUPPLY_PURPOSE = {
	/** Recover (Book I p.246): 1 use of supplies, regain 4+Prosperity HP. */
	RECOVER: "recover",
	/** Make Camp (p.248), and feeding yourself on the road: 1 use per person per day. */
	CAMP: "camp",
};

// `purposes: null` means "every purpose" — the printed supplies rows, which are what all of this
// is denominated in. Anything else names the purposes it is good for and carries the sentence
// said when it is asked to do the other job.
const PURSES = [
	{ slug: "supplies",           label: "Supplies",           purposes: null },
	{ slug: "more-supplies",      label: "More supplies",      purposes: null },
	{ slug: "even-more-supplies", label: "Even more supplies", purposes: null },
	{
		slug: PROVISIONS_SLUG, label: "Provisions", purposes: [SUPPLY_PURPOSE.CAMP],
		reason: "Provisions substitute for supplies when you Make Camp or feed yourself as you travel, not to Recover (Book I p.89).",
	},
	{
		slug: "twisting-pine", label: "Twisting Pine sap", purposes: [SUPPLY_PURPOSE.RECOVER],
		reason: "The sap seals wounds: it stands in for supplies to Recover, but it is not food (Book II p.462).",
	},
];

/**
 * The printed supplies rows, in the order a spend drains them.
 *
 * Derived from the table above rather than listed again: the printed rows ARE the purses good
 * for every purpose, so a fourth one added to PURSES joins this by saying so once. A hand-kept
 * second copy could go stale without anything failing, because nothing but this reads it.
 */
export const SUPPLY_SLUGS = PURSES.filter(p => p.purposes === null).map(p => p.slug);

/**
 * Every purse that can pay for `purpose`, empty or not, in the order a spend drains them.
 *
 * supplyPursesFor answers "what can this character spend right now", so it leaves empty rows out.
 * This answers "which rows is this purpose paid from at all", which a record naming each of them
 * needs whether or not any are full: a camp offer writes a count for every one, so that writing a
 * fresh offer over an old one resets them all.
 */
export function supplyPurseSlugsFor(purpose) {
	return PURSES.filter(p => p.purposes === null || p.purposes.includes(purpose)).map(p => p.slug);
}

function _remaining(resources, slug) {
	return Math.max(0, Math.trunc(Number(resources?.[slug]) || 0));
}

/** Every purse's slug, whatever it pays for. */
const PURSE_SLUGS = PURSES.map(p => p.slug);

/**
 * The uses a character can actually reach into: `resources` with every printed supplies row they
 * are not CARRYING read as empty, and every purse capped at its current size.
 *
 * Carried, because a printed supplies row is a ◆ on the Inventory insert like any other item: the
 * uses belong to the mark, and a row left unmarked (Reset at home, "clear the marks from your
 * Inventory insert", Book I p.89) is food left in the larder, not in the pack. The three printed
 * rows only: the other purses (provisions, Twisting Pine sap) are tracks the book prints no ◆ row
 * for, and a haul of provisions that claimed no ◆ ("an extra 1d6 uses", Forage, p.79) is food in
 * hand all the same. Capped, because the sheet draws a row's track at its current size
 * (4+Prosperity, which a Lacking steading or a lost Mill shrinks) and a spend must not reach uses
 * the track no longer shows.
 *
 * Pure. Only the purse slugs change; every other track in `resources` passes through as it is.
 *
 * @param {object} resources  `flags.stonetop.inventory.resources`
 * @param {object} [limits]
 * @param {object|null} [limits.checked]  `inventory.checked`; null leaves carrying unasked
 * @param {object|null} [limits.max]      slug → the purse's current size; a slug absent is uncapped
 * @returns {object}
 */
export function spendablePurseResources(resources, { checked = null, max = null } = {}) {
	const out = { ...(resources ?? {}) };
	for (const slug of PURSE_SLUGS) {
		if (!(slug in out)) continue;
		if (checked && !checked[slug] && SUPPLY_SLUGS.includes(slug)) { out[slug] = 0; continue; }
		const cap = Number(max?.[slug]);
		if (Number.isFinite(cap)) out[slug] = Math.min(_remaining(out, slug), Math.max(0, cap));
	}
	return out;
}

/**
 * WHEN A ◆ OF SUPPLIES IS FULL. A printed supplies row's stored uses are the food in that ◆, and
 * ticking it on and off moves the ◆, not the food. New food comes in two ways only:
 *
 *   · Outfit packs it: every supplies row the Outfit leaves marked is full, 4+Prosperity (p.77, p.88).
 *   · Have What You Need turns an undefined ◆ into supplies (p.78; the party at Titan Bones "each
 *     convert one of their undefined ◆ into supplies", p.327). So a tick that DREW an undefined ◆
 *     packs a fresh, full one.
 *
 * And the other half, so a tick can never refill for free: a ◆ of supplies some of whose food has
 * gone is a real item now ("Once they use this move to produce an item, that item is now in their
 * inventory. They can drop it, use it up...", p.326; Caradoc doesn't mark a ◆ of supplies he'll eat
 * whole, p.327). Un-marking it hands back no undefined ◆; only one still full, a mark taken back
 * before anything was eaten, gives back what it drew. Camp's Have What You Need
 * (camp-rules.js#suppliesRowToMark) packs the same fresh ◆ onto an unmarked row.
 *
 * An EMPTY row marked without a draw is a fresh ◆ too: there is no food left on it to pick back up,
 * and the sheet can't tell a ◆ marked by hand at home (Outfit without the window) or bought in a
 * market from a misclick, so it packs full rather than sending the PC out with an empty ◆. Only a
 * row still holding food keeps what it holds, which is the refill this rule exists to stop.
 */

/**
 * The uses a supplies row holds once it is marked: full when the mark drew an undefined ◆ or the
 * row was empty (a fresh one), else what it held (a ◆ picked back up with its food in it).
 *
 * @param {object} o
 * @param {number} o.drew       undefined ◆ the mark took from the reserve
 * @param {number} o.uses       the uses stored on the row now
 * @param {number} o.perSupply  the uses in one ◆ of supplies now (getUsesPerSupply)
 * @returns {number}
 */
export function suppliesUsesOnMark({ drew = 0, uses = 0, perSupply = 4 } = {}) {
	const held = Math.max(0, Math.trunc(Number(uses) || 0));
	return Number(drew) > 0 || held === 0 ? Math.max(0, Math.trunc(Number(perSupply) || 0)) : held;
}

/**
 * The undefined ◆ un-marking a supplies row hands back: what its mark drew, while the ◆ is still
 * full; nothing once any of its food is gone (see above).
 *
 * @param {object} o
 * @param {number} o.drawn      what the row's mark drew (inventory.drawn)
 * @param {number} o.uses       the uses stored on the row now
 * @param {number} o.perSupply  the uses in one ◆ of supplies now
 * @returns {number}
 */
export function suppliesGiveBack({ drawn = 0, uses = 0, perSupply = 4 } = {}) {
	const full = Math.max(0, Math.trunc(Number(uses) || 0)) >= Math.max(1, Math.trunc(Number(perSupply) || 0));
	return full ? Math.max(0, Math.trunc(Number(drawn) || 0)) : 0;
}

/**
 * Split what the character is carrying into what can pay for `purpose` and what cannot.
 *
 * Empty purses are in neither list: a row at zero is not a choice, and refusing a purse the
 * player does not have is a sentence about nothing. Pure — takes the resources map rather than an
 * Actor — so both the sheet and its tests read the same rule.
 *
 * @param {object} resources  `flags.stonetop.inventory.resources`
 * @param {string} purpose    one of SUPPLY_PURPOSE
 * @param {object} [limits]   what is carried and how big each purse is now (spendablePurseResources);
 *                            StonetopCharacter#supplyPurseLimits answers it for a character
 * @returns {{eligible: Array<{slug: string, label: string, remaining: number}>,
 *           ineligible: Array<{slug: string, label: string, remaining: number, reason: string}>,
 *           total: number}}  `total` is what the eligible purses hold between them
 */
export function supplyPursesFor(resources, purpose, limits = undefined) {
	const reachable = limits ? spendablePurseResources(resources, limits) : resources;
	const eligible = [];
	const ineligible = [];
	for (const purse of PURSES) {
		const remaining = _remaining(reachable, purse.slug);
		if (!remaining) continue;
		const row = { slug: purse.slug, label: purse.label, remaining };
		if (purse.purposes === null || purse.purposes.includes(purpose)) eligible.push(row);
		else ineligible.push({ ...row, reason: purse.reason });
	}
	return { eligible, ineligible, total: eligible.reduce((sum, p) => sum + p.remaining, 0) };
}

/**
 * The purse a spend should come out of unless the player says otherwise: the first eligible one
 * in table order, which drains the printed supplies rows left to right before touching anything
 * that stood in for them. A larder or a vial is the thing you have fewer of and the thing whose
 * loss is felt, so it should not go first by accident.
 */
export function defaultSupplyPurse(purses) {
	return purses?.eligible?.[0] ?? null;
}

/**
 * What a night at camp costs to feed: 1 use per person, or 1 per four when a mess kit is going
 * (Book I p.334, "if you use a mess kit (requires fire & water), then 1 use can provide for up to
 * four people").
 *
 * Rounded UP, as halves are everywhere in Stonetop: five mouths and one mess kit is two uses, not
 * one and a quarter. Rounding the other way would feed a fifth person free.
 */
export function campUsesNeeded(people, messKit = false) {
	const heads = Math.max(0, Math.trunc(Number(people) || 0));
	return Math.ceil(heads / (messKit ? 4 : 1));
}
