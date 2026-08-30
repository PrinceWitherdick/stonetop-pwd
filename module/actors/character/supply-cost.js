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

function _remaining(resources, slug) {
	return Math.max(0, Math.trunc(Number(resources?.[slug]) || 0));
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
 * @returns {{eligible: Array<{slug: string, label: string, remaining: number}>,
 *           ineligible: Array<{slug: string, label: string, remaining: number, reason: string}>,
 *           total: number}}  `total` is what the eligible purses hold between them
 */
export function supplyPursesFor(resources, purpose) {
	const eligible = [];
	const ineligible = [];
	for (const purse of PURSES) {
		const remaining = _remaining(resources, purse.slug);
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

/**
 * Work out which purses a spend of `amount` uses actually comes out of.
 *
 * A camp of four eats four uses and one row rarely holds four, so a spend SPILLS: the purse the
 * player chose goes first and empties, then the rest in table order until the bill is paid. It
 * spills rather than refusing because refusing would be wrong — the food is there, it is just
 * spread across three rows of the same insert — and it starts where the player pointed because
 * "pay with provisions" should mean the larder empties before the supplies do, even when the
 * larder cannot cover the whole night.
 *
 * Returns what is short rather than throwing: a party can absolutely try to Make Camp with two
 * uses between five of them, and the move's own answer to that is deprivation (Book I p.335), not
 * a refused dialog.
 *
 * @param {object} purses  from supplyPursesFor
 * @param {number} amount  uses to spend
 * @param {string} [preferredSlug]  the purse the player picked; ignored if it cannot pay
 * @returns {{spends: Array<{slug: string, label: string, spend: number, left: number}>,
 *           spent: number, short: number}}
 */
export function spendSupplies(purses, amount, preferredSlug = null) {
	const want = Math.max(0, Math.trunc(Number(amount) || 0));
	const preferred = purses.eligible.filter(p => p.slug === preferredSlug);
	const order = [...preferred, ...purses.eligible.filter(p => p.slug !== preferredSlug)];

	const spends = [];
	let left = want;
	for (const purse of order) {
		if (left <= 0) break;
		const spend = Math.min(left, purse.remaining);
		if (!spend) continue;
		spends.push({ slug: purse.slug, label: purse.label, spend, left: purse.remaining - spend });
		left -= spend;
	}
	return { spends, spent: want - left, short: left };
}
