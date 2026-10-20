import { CREW_SUPPLIES_LABEL, CREW_SUPPLIES_SLUG, campUsesNeeded } from "../actors/character/supply-cost.js";
import { campPurses, count, crewMealUses } from "../camp/camp-rules.js";

/**
 * DAYS ON THE ROAD: what feeding the party costs while the GM glosses the travel (Book I p.89,
 * p.304).
 *
 *  · "By default, each person on an expedition consumes 1 use of supplies per day. But, if you have
 *    a mess kit (which requires water and fire), then 1 use of supplies can cover up to four
 *    people" (p.89). Per day, so a party of 5-8 eats 2 a day and 9-12 eats 3 (p.304): the round-up
 *    is per day, never across the whole trip. That is camp's own arithmetic (supply-cost.js
 *    #campUsesNeeded), used here a day at a time.
 *  · "Expend provisions in place of supplies when you Make Camp, or to feed yourself as you
 *    travel" (p.89), and they keep worse than supplies, so a pack is eaten provisions first: the
 *    same order Make Camp eats it (camp-rules.js#campPurses).
 *  · "If the party travels with a pack animal or a cart laden with at least 1 Surplus worth of
 *    supplies, then there's no need to track individual meals and uses" (p.304). A day costs
 *    nothing then. Whether the cart is laden is the GM's to say, so it is a box, never a guess.
 *
 * A night they Make Camp is paid at the fire (p.334, "each member of the party must consume 1 use
 * of supplies or provisions"), so these are the days the GM glosses: "you don't need the move every
 * night while you're glossing days of road travel (just use up their supplies and move on)" (p.320).
 *
 * THE CREW PAYS ITS OWN MOUTHS, on the road as at the fire (the user's ruling; the Crew insert, Book I
 * p.144, gives the crew "Supplies (4+Prosperity uses per crew member)"): the crew's mouths come out of
 * the crew's own supplies first, a day's meal at a time (camp-rules.js#crewMealUses), with no figure
 * for the GM to set, and only what they cannot cover falls to the packs with everyone else's.
 *
 * Pure. RoadRationsDialog reads the packs and writes the spend.
 */

/**
 * @typedef {object} RoadMember  One PC on the trip, as the dialog reads them.
 * @property {string}  actorId
 * @property {string}  name
 * @property {boolean} eats       a living mouth (a Ghost or Revenant need not eat)
 * @property {number}  followers  the party followers they feed besides themselves
 * @property {number}  [crewMouths]  how many of `followers` are their crew's (camp-store.js#partyCrewMouths)
 * @property {{held: number}} [crew]  what the crew's own supplies hold (camp-store.js#crewSuppliesOf)
 * @property {object}  resources  what their pack can spend (camp-store.js#packResources)
 */

/** The mouths one member brings: themselves when they eat, and their followers. */
export function roadMouths(member) {
	return (member?.eats === false ? 0 : 1) + count(member?.followers);
}

/** What one day costs the party: 0 with a laden pack animal or cart, else camp's per-head bill. */
export function roadUsesPerDay(mouths, { messKit = false, packAnimal = false } = {}) {
	return packAnimal ? 0 : campUsesNeeded(mouths, messKit);
}

/**
 * Who pays what by default: each their share of the bill by mouths (largest remainder, so the
 * shares add up to the bill), capped at what their pack holds, and whatever one pack cannot cover
 * picked up by the next with food to spare, in row order. A suggestion: the GM can move any of it.
 */
export function defaultRoadShares(rows, bill) {
	const total = rows.reduce((sum, r) => sum + r.mouths, 0);
	const shares = rows.map(r => (total ? (bill * r.mouths) / total : 0));
	const out = shares.map(Math.floor);
	let left = bill - out.reduce((a, b) => a + b, 0);
	const order = shares.map((s, i) => ({ i, frac: s - Math.floor(s) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
	for (const { i } of order) {
		if (left <= 0) break;
		out[i] += 1;
		left -= 1;
	}
	let owed = 0;
	rows.forEach((r, i) => {
		const paid = Math.min(out[i], r.holds);
		owed += out[i] - paid;
		out[i] = paid;
	});
	rows.forEach((r, i) => {
		const add = Math.min(owed, r.holds - out[i]);
		if (add > 0) { out[i] += add; owed -= add; }
	});
	return Object.fromEntries(rows.map((r, i) => [r.actorId, out[i]]));
}

/** `n` uses out of a pack's purses, provisions first: `[{slug, label, n}]`. */
export function drainPurses(purses, n) {
	let need = count(n);
	const spend = [];
	for (const p of purses) {
		if (need <= 0) break;
		const take = Math.min(need, p.remaining);
		if (take > 0) spend.push({ slug: p.slug, label: p.label, n: take });
		need -= take;
	}
	return spend;
}

/**
 * What each member's crew pays out of its own supplies for `days`, set on the rows: `crewBill` (what
 * the crew eats, its meal a day at a time, camp-rules.js#crewMealUses), `crewHeld` and `crewPays`
 * (as far as its supplies go). Nothing with a laden pack animal or cart, when nobody counts meals.
 * Only two crews over one mess kit can come to more than the party's whole bill on their own; then
 * the later rows' crews pay less, as Make Camp gives the crew's supplies back (camp-rules.js#trimToBill).
 */
function crewPayments(rows, { days, messKit, packAnimal, bill }) {
	for (const r of rows) {
		r.crewMouths = Math.min(count(r.crewMouths), count(r.followers));
		r.crewBill = packAnimal ? 0 : crewMealUses(r.crewMouths, r.followers, messKit) * days;
		r.crewHeld = count(r.crew?.held);
		r.crewPays = Math.min(r.crewHeld, r.crewBill);
	}
	let over = rows.reduce((sum, r) => sum + r.crewPays, 0) - bill;
	for (let i = rows.length - 1; i >= 0 && over > 0; i--) {
		const back = Math.min(rows[i].crewPays, over);
		rows[i].crewPays -= back;
		rows[i].crewBill -= back;
		over -= back;
	}
}

/**
 * The mouths a member's pack still feeds once the crew has paid: their own and their followers', less
 * the share of the crew its supplies covered. The packs split what is left of the bill by these.
 */
function packMouths(r) {
	return r.mouths - (r.crewBill ? (r.crewMouths * r.crewPays) / r.crewBill : 0);
}

/**
 * The whole account for `days` on the road: the bill, and who pays what out of which purse. A crew's
 * own supplies pay its mouths first (crewPayments, `crewSpend`); the packs share the rest by default
 * (defaultRoadShares, `pays` and `spend`), and the GM's figure for a member is their pack's alone.
 *
 * @param {RoadMember[]} members
 * @param {object} [opts]
 * @param {number}  [opts.days=1]
 * @param {boolean} [opts.messKit]     someone cooks for the party with a mess kit
 * @param {boolean} [opts.packAnimal]  a pack animal or cart laden with 1 Surplus of supplies
 * @param {object}  [opts.paid]        actorId -> uses, the GM's own figure for that member's pack
 */
export function roadLedger(members = [], { days = 1, messKit = false, packAnimal = false, paid = {} } = {}) {
	const rows = members.map(m => {
		const purses = campPurses(m.resources);
		return { ...m, mouths: roadMouths(m), purses, holds: purses.reduce((sum, p) => sum + p.remaining, 0) };
	});
	const mouths = rows.reduce((sum, r) => sum + r.mouths, 0);
	const n = count(days);
	const perDay = roadUsesPerDay(mouths, { messKit, packAnimal });
	const bill = perDay * n;
	crewPayments(rows, { days: n, messKit, packAnimal, bill });
	const crewPaid = rows.reduce((sum, r) => sum + r.crewPays, 0);
	const shares = defaultRoadShares(rows.map(r => ({ ...r, mouths: packMouths(r) })), bill - crewPaid);
	for (const r of rows) {
		const asked = paid?.[r.actorId];
		r.suggested = shares[r.actorId] ?? 0;
		r.pays = Math.min(r.holds, asked === undefined || asked === null ? r.suggested : count(asked));
		r.spend = drainPurses(r.purses, r.pays);
		r.crewSpend = r.crewPays ? [{ slug: CREW_SUPPLIES_SLUG, label: CREW_SUPPLIES_LABEL, n: r.crewPays }] : [];
	}
	const paidTotal = crewPaid + rows.reduce((sum, r) => sum + r.pays, 0);
	return {
		rows, days: n, mouths, messKit: !!messKit && !packAnimal, packAnimal: !!packAnimal,
		perDay, bill, crewPaid, paid: paidTotal,
		short: Math.max(0, bill - paidTotal),
		over:  Math.max(0, paidTotal - bill),
	};
}

/**
 * What a member's crew purse says in the window, in place of a figure to set (as Make Camp's does,
 * camp-view.js#crewPurseText), or "" for a member whose crew eats nothing on this trip.
 */
export function crewRoadText(row) {
	const bill = count(row?.crewBill);
	if (!bill) return "";
	const n = count(row.crewPays);
	if (n >= bill) return `Feeds the crew first: ${usesWord(n)}, all the crew eats.`;
	if (!n) return `Empty, so what the crew eats (${usesWord(bill)}) comes out of the packs.`;
	const rest = bill - n;
	return `Feeds the crew first: ${n} of the ${usesWord(bill)} the crew eats. The other ${rest} ${rest === 1 ? "comes" : "come"} out of the packs.`;
}

/** "2 provisions, 1 supplies": a spend in words. */
export function spendWords(spend) {
	return (spend ?? []).map(s => `${s.n} ${String(s.label).toLowerCase()}`).join(", ");
}

/** "1 use", "3 uses". */
export function usesWord(n) {
	return `${n} ${n === 1 ? "use" : "uses"}`;
}

/**
 * The chat card's rows for a ledger that was applied: the bill, each payer, and any shortfall.
 * `{label, value}` rows, the shape chat.js#postMoveToChat takes.
 */
export function roadSummaryRows(ledger) {
	const days = `${ledger.days} ${ledger.days === 1 ? "day" : "days"}`;
	if (ledger.packAnimal) {
		return [{
			label: "On the road",
			value: `${days}. With a pack animal or cart carrying at least 1 Surplus of supplies, nobody counts meals: they re-Outfit from the stash (Book I p.304).`,
		}];
	}
	const kit = ledger.messKit ? ", a mess kit going" : "";
	const rows = [{
		label: "On the road",
		value: `${days}, ${ledger.mouths} ${ledger.mouths === 1 ? "mouth" : "mouths"}${kit}: ${usesWord(ledger.perDay)} a day, ${usesWord(ledger.bill)} in all.`,
	}];
	for (const r of ledger.rows) {
		const pack = r.pays ? `${usesWord(r.pays)} (${spendWords(r.spend)})` : "";
		// What the crew's own supplies paid is named apart from the pack, as Make Camp's card names it.
		if (r.crewPays) {
			const crew = `${usesWord(r.crewPays)} from the crew's own supplies`;
			rows.push({ label: r.name, value: pack ? `${crew}; ${pack} from the pack` : crew });
		} else if (pack) {
			rows.push({ label: r.name, value: pack });
		}
	}
	if (ledger.short) {
		rows.push({
			label: "Went short",
			value: `${usesWord(ledger.short)} nobody had: someone goes without, and that is deprivation (Book I p.335).`,
		});
	}
	return rows;
}
