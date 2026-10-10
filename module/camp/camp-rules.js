import { SYSTEM_ID } from "../system-id.js";
import { PROVISIONS_SLUG } from "../actors/character/provisions.js";
import { SUPPLY_PURPOSE, SUPPLY_SLUGS, campUsesNeeded, supplyPurseSlugsFor, supplyPursesFor } from "../actors/character/supply-cost.js";
import { clearTracksData } from "../actors/character/background-tracks.js";
import { debilityData } from "../actors/character/walk-it-off.js";
import { UNLIVING_KINDS, recoveredHpTo } from "../actors/character/deaths-door-actor.js";

/**
 * MAKE CAMP, AS A PARTY (Book I p.334).
 *
 * "Each member of the party must consume 1 use of supplies or provisions; if you use a mess kit
 * (requires fire & water), then 1 use can provide for up to four people." The bill is the whole
 * party's, and anyone carrying food can pay it. What the night buys is each person's own: "If you
 * eat and drink your fill, and get at least a few hours of sleep, pick 1", and a rest that was
 * peaceful, comfortable or enjoyable adds advantage on the next roll.
 *
 * So a camp is shared state with one writer per character. Each player keeps their own part on
 * their own character: what they offer from their pack, who else eats with them, what they take
 * from the night. That is the one document a player can always write, and it means nobody's pack
 * is opened by anyone but its owner. The character who opened the camp (its host) holds the rest:
 * whether the camp is still open and, once it is settled, the plan every share is paid from.
 *
 * This file is the arithmetic. It never reaches for Foundry, so the rules can be tested as rules;
 * camp-store.js reads the documents and lands the writes.
 */

/** The flag, on each character at the fire, holding their part of the camp. */
export const CAMP_FLAG = "camp";

/**
 * The flag, on a character who hosted a settled camp, keeping that camp's plan while somebody's
 * share of it is still unpaid, as `[{id, plan}]`. The plan lives on the host's camp record, and
 * that record is replaced the next time the host sits down at any camp; a share owed to a player
 * who was away when the camp settled would otherwise go with it.
 */
export const CAMP_OWED_FLAG = "campOwed";

/** What a host's record can say about its camp. Only the host's record carries one. */
export const CAMP_STATUS = Object.freeze({
	OPEN:      "open",
	SETTLED:   "settled",
	CANCELLED: "cancelled",
});

/**
 * How a camp reads from outside: its host's status, or one of the two ways a camp stops being
 * joinable without anybody settling or breaking it. COLD is a camp left open past CAMP_STALE_MS.
 * GONE is a camp whose host has since opened another, left it, or been deleted.
 */
export const CAMP_STATE = Object.freeze({
	...CAMP_STATUS,
	COLD: "cold",
	GONE: "gone",
});

/** The night's pick (p.334), and the night that bought nothing because nobody really slept. */
export const CAMP_BENEFIT = Object.freeze({
	HP:       "hp",
	DEBILITY: "debility",
	NONE:     "none",
});

/**
 * How long an unsettled camp stays joinable. A camp is minutes of table time. One still open the
 * next evening was abandoned when a session ended, and treating it as live would fold a new
 * night's camp into it.
 */
export const CAMP_STALE_MS = 8 * 60 * 60 * 1000;

// The extra mouths a character brings to the fire have NO cap: "each member of the party" eats
// (Book I p.79), and the book names no most. A cap billed a big crew short and then, with fewer fed
// than travel with them, healed none of them (camp-followers.js#campFollowerShare).

/** How many camps a character remembers breaking up, latest kept. Older ones read as simply gone. */
export const CAMP_LEFT_MAX = 10;

/** The held advantage a peaceful night leaves, named the way the sheet's chip shows it. */
export const PEACEFUL_NIGHT = "A peaceful night's rest";

/**
 * The held advantage the fur-lined bedroll leaves (Book II, Spirits of the Wild): "When you Make Camp
 * in the fur-lined bedroll, you regain 1d6 (extra) HP and gain advantage on your next roll." Its own
 * name, so it is held beside a peaceful night's and never mistaken for it.
 */
export const FUR_LINED_BEDROLL = "A fur-lined bedroll";

/**
 * Whether a carried thing is the fur-lined bedroll. A dropped treasure lands on the sheet as a
 * write-in keyed by its item id with no catalog slug, so its name is what says what it is (the way
 * fine-whisky.js#isFineWhiskyName reads a skin).
 */
export function isFurLinedBedrollName(name) {
	return /\bfur[\s-]*lined\s+bedroll\b/i.test(String(name ?? ""));
}

/**
 * The held disadvantage a Thrall's Quicksilver Dreams leaves on everyone else at the fire: "When you
 * Make Camp, everyone with you suffers nightmares and has disadvantage on their next roll."
 */
export const QUICKSILVER_NIGHTMARES = "Nightmares (Quicksilver Dreams)";

/** The most a Ravenous Thrall's 1d4 can come to. */
const RAVENOUS_MAX = 4;

/**
 * The Judge's move: "When you share a proper meal with someone and each of you eats their fill, each
 * of you recovers 1d8 (extra) HP." Any character can hold it, through a pick from another playbook.
 */
export const BREAK_BREAD = "Break Bread";

/**
 * The Lightbearer's move: "When you build a camp fire and sprinkle it with ash from your own hearth,
 * anyone who Makes Camp with you is free from nightmares or bad dreams and recovers (extra) HP equal
 * to your CHA." Any character can hold it, through a pick from another playbook.
 */
export const HOME_FIRES = "Keep the Home-Fires Burning";

/** Why a press of Make Camp did not settle the camp. */
export const SETTLE_REFUSAL = Object.freeze({
	CLOSED:    "closed",
	NOT_YOURS: "not-yours",
	SHORT:     "short",
});

/**
 * The post-death inserts whose Unliving move reads "You need not eat nor drink nor sleep ... You
 * gain no benefit from ... Make Camp". They can still sit at the fire and share out their food;
 * they are simply not a mouth, and the night buys them nothing. A Thrall eats and sleeps like
 * anyone else. The list is Death's Door's (Recover, Convalesce and magical healing ask it too), and
 * named here as well so the camp's own readers find it beside the rest of the camp's rules.
 */
export { UNLIVING_KINDS };

/** Every purse a camp can be fed from, in the order a spend drains them. */
const CAMP_PURSE_SLUGS = supplyPurseSlugsFor(SUPPLY_PURPOSE.CAMP);

/** A whole number from 0 to `max`; anything that is not a number reads as 0. */
export function count(value, max = Infinity) {
	return Math.min(max, Math.max(0, Math.trunc(Number(value) || 0)));
}

/** An offer of nothing, with a zero for every purse so a write of it clears an old offer. */
export function blankOffer() {
	return Object.fromEntries(CAMP_PURSE_SLUGS.map(slug => [slug, 0]));
}

/**
 * The derived numbers a character publishes when they join, because another client cannot work
 * them out: max HP is COMPUTED by the character model (the stored field lags it), and whether a
 * bedroll or a mess kit is actually carried is an outfit question. Debility names ride along so a
 * row can name one; whether it is marked is read live off the actor. So do the background tracks a
 * Make Camp clears (`clears`, Auspicious Birth's circle), which the playbook's data names.
 */
function readVitals(raw) {
	const named = list => (Array.isArray(list) ? list : [])
		.filter(d => d?.key)
		.map(d => ({ key: String(d.key), name: String(d.name ?? d.key) }));
	return {
		maxHp:      count(raw?.maxHp),
		// Any bedroll, the fur-lined one included: it is a bedroll as well as a treasure.
		bedroll:    !!raw?.bedroll || !!raw?.furBedroll,
		furBedroll: !!raw?.furBedroll,
		messKit:    !!raw?.messKit,
		debilities: named(raw?.debilities),
		clears:     named(raw?.clears),
	};
}

/**
 * A stored camp flag in one dependable shape, or null for a character at no camp.
 *
 * Every read goes through here, so a record written by an older build, or half-written by a merge,
 * reads as defaults rather than as `undefined` arithmetic.
 */
export function readCampRecord(raw) {
	if (!raw || typeof raw !== "object" || !raw.id) return null;
	const offer = blankOffer();
	for (const slug of CAMP_PURSE_SLUGS) offer[slug] = count(raw.offer?.[slug]);
	return {
		id:        String(raw.id),
		host:      String(raw.host ?? ""),
		status:    Object.values(CAMP_STATUS).includes(raw.status) ? raw.status : null,
		openedAt:  count(raw.openedAt),
		joinedAt:  count(raw.joinedAt),
		offer,
		followers: count(raw.followers),
		eats:      raw.eats !== false,
		messKit:   !!raw.messKit,
		benefit:   Object.values(CAMP_BENEFIT).includes(raw.benefit) ? raw.benefit : CAMP_BENEFIT.HP,
		debility:  String(raw.debility ?? ""),
		bedroll:   !!raw.bedroll,
		peaceful:  !!raw.peaceful,
		ready:     !!raw.ready,
		// On a host: whether tonight's meal is a proper one, for Break Bread. Ticked unless the host
		// unticked it, since "a proper meal" and "eats their fill" are the fiction's to say.
		properMeal: raw.properMeal !== false,
		// On a host: whether the fire is sprinkled with ash from a hearth, for Keep the Home-Fires
		// Burning. Ticked unless the host unticked it, like the proper meal.
		hearthAsh: raw.hearthAsh !== false,
		// A Ravenous Thrall's "extra 1d4 provisions or uses of supplies", rolled once when they sat
		// down (camp-store.js#sitDown) so every reader's window shows the same bill. 0 for anyone else.
		hunger:    count(raw.hunger, RAVENOUS_MAX),
		vitals:    readVitals(raw.vitals),
		plan:      Array.isArray(raw.plan) ? raw.plan : null,
		settledAt: count(raw.settledAt),
		// On a host: the latest press of Make Camp by someone whose client does not settle this camp,
		// as a fresh token each time (camp-store.js#settleCamp).
		settleAsk: String(raw.settleAsk ?? ""),
		// On a host: the settling client's answer to a `settleAsk` it could not settle, as `{ask, reason}`,
		// so the client that asked can say why (camp-store.js#onUpdateActorCamp). Null otherwise.
		settleRefused: raw.settleRefused?.ask ? { ask: String(raw.settleRefused.ask), reason: String(raw.settleRefused.reason ?? "") } : null,
		// The user whose client claimed this share to pay it (camp-store.js#payShare), "" before anyone has.
		paidBy:    String(raw.paidBy ?? ""),
		applied:   !!raw.applied,
		// The unsettled camps this character was hosting when they sat down somewhere else instead,
		// which those moves broke up (campState). Carried from record to record, latest last.
		leftCamps: readLeftCamps(raw.leftCamps),
	};
}

/** A host's owed camps (CAMP_OWED_FLAG) in one dependable shape: `[{id, plan}]`, never null. */
export function readOwedCamps(raw) {
	return (Array.isArray(raw) ? raw : [])
		.filter(camp => camp?.id && Array.isArray(camp.plan))
		.map(camp => ({ id: String(camp.id), plan: camp.plan }));
}

/**
 * The record a character writes on hosting or joining a camp.
 *
 * EVERY FIELD, always. Foundry merges a flag write into what is already there, so a record that
 * left one out would inherit it from whatever camp this character sat at last: last week's ready
 * tick, or a settled plan. Writing all of them makes one write a clean slate without an unset
 * first.
 */
export function newCampRecord({
	id, hostId, actorId, now = 0, vitals = {}, followers = 0,
	hpValue = 0, activeDebilityKeys = [], unliving = false, leftCamps = [], hunger = 0,
}) {
	const read    = readVitals(vitals);
	const hosting = actorId === hostId;
	const hurt    = read.maxHp > 0 && count(hpValue) < read.maxHp;
	return {
		id:        String(id),
		host:      String(hostId),
		status:    hosting ? CAMP_STATUS.OPEN : null,
		openedAt:  hosting ? count(now) : 0,
		joinedAt:  count(now),
		offer:     blankOffer(),
		followers: count(followers),
		eats:      !unliving,
		messKit:   read.messKit,
		// Healing is the pick unless there is nothing to heal and a debility to clear instead.
		benefit:   !hurt && activeDebilityKeys.length ? CAMP_BENEFIT.DEBILITY : CAMP_BENEFIT.HP,
		debility:  activeDebilityKeys[0] ?? "",
		bedroll:   read.bedroll,
		peaceful:  false,
		ready:     false,
		properMeal: true,
		hearthAsh: true,
		hunger:    count(hunger, RAVENOUS_MAX),
		vitals:    read,
		plan:      null,
		settledAt: 0,
		settleAsk: "",
		settleRefused: null,
		paidBy:    "",
		applied:   false,
		leftCamps: readLeftCamps(leftCamps),
	};
}

/** A list of broken-up camp ids in one dependable shape: strings, no repeats, the latest CAMP_LEFT_MAX. */
function readLeftCamps(raw) {
	const ids = (Array.isArray(raw) ? raw : []).filter(Boolean).map(String);
	return [...new Set(ids)].slice(-CAMP_LEFT_MAX);
}

/**
 * Where the camp `campId`, hosted by `hostId`, stands, read off its host's record.
 *
 * The host is the only authority on this. A member's record names the camp they joined, and that
 * stays true after the camp is long over, so asking the member would keep a broken-up camp alive.
 *
 * A host who walked over to another fire replaced the record this camp was read from, and named
 * this camp among the ones they left: it broke up, it did not simply end.
 */
export function campState(hostRecord, { campId, hostId }, now = 0) {
	if (hostRecord?.leftCamps?.includes(campId)) return CAMP_STATE.CANCELLED;
	if (!hostRecord || hostRecord.id !== campId || hostRecord.host !== hostId) return CAMP_STATE.GONE;
	// A camp with a plan was eaten at, whatever its status says since: a Break up confirmed a moment
	// after somebody else settled it lands on top of the settle, and must not unsay the meal.
	if (isSettledRecord(hostRecord)) return CAMP_STATE.SETTLED;
	if (hostRecord.status === CAMP_STATUS.OPEN) {
		return now - hostRecord.openedAt > CAMP_STALE_MS ? CAMP_STATE.COLD : CAMP_STATE.OPEN;
	}
	return hostRecord.status ?? CAMP_STATE.GONE;
}

/**
 * Whether a host's record is a settled camp: its plan is written. The plan, not the status, because
 * only settling writes a plan and nothing takes one away but a fresh record.
 */
export function isSettledRecord(record) {
	return !!record && (record.status === CAMP_STATUS.SETTLED || Array.isArray(record.plan));
}

/** Host first, then in the order people sat down, so the rows (and the trimming) never reshuffle. */
function byJoinOrder(a, b) {
	return (b.isHost - a.isHost) || (a.record.joinedAt - b.record.joinedAt)
		|| String(a.name).localeCompare(String(b.name));
}

/** Whether this member is one of the mouths the meal has to feed. */
export function eatsTonight(member) {
	return member.record.eats && !member.unliving;
}

/**
 * The purses a member's pack can feed the camp from, in the order a meal eats them: PROVISIONS FIRST.
 * "Provisions, though, are more likely to spoil or attract beasts than supplies are" (Book I p.89),
 * and the book's own party eats "a use of provisions when you Make Camp rather than using up
 * supplies". So Cover the rest reaches for the larder first, and an over-offer gives supplies back
 * first (trimToBill runs this order backwards).
 */
function campPurses(resources) {
	const { eligible } = supplyPursesFor(resources, SUPPLY_PURPOSE.CAMP);
	return [...eligible.filter(p => p.slug === PROVISIONS_SLUG), ...eligible.filter(p => p.slug !== PROVISIONS_SLUG)];
}

/** What a member has offered, clamped purse by purse to what that purse still holds. */
function offerFrom(member) {
	const purses = campPurses(member.resources).map(p => ({
		slug: p.slug, label: p.label, remaining: p.remaining,
		n: Math.min(member.record.offer[p.slug] ?? 0, p.remaining),
	}));
	return { actorId: member.actorId, purses, total: purses.reduce((sum, p) => sum + p.n, 0) };
}

/**
 * What each offer actually pays once the bill is met.
 *
 * Two people reaching for the same last use at once is ordinary, and so is a bill that shrinks
 * after the offers are in (somebody decides to go without), so offers can come to more than the
 * camp eats. Only the bill is spent. The latest to sit down gives back first, and within one pack
 * the printed supplies rows go back before the larder: the same order a meal eats them (campPurses),
 * run backwards, so the provisions that would spoil are what stays eaten.
 */
function trimToBill(offers, bill) {
	let excess = Math.max(0, offers.reduce((sum, o) => sum + o.total, 0) - bill);
	const spends = offers.map(o => ({
		actorId: o.actorId,
		spend:   o.purses.filter(p => p.n > 0).map(p => ({ slug: p.slug, label: p.label, n: p.n })),
	}));
	for (let i = spends.length - 1; i >= 0 && excess > 0; i--) {
		const spend = spends[i].spend;
		for (let j = spend.length - 1; j >= 0 && excess > 0; j--) {
			const back = Math.min(spend[j].n, excess);
			spend[j].n -= back;
			excess -= back;
		}
		spends[i].spend = spend.filter(s => s.n > 0);
	}
	for (const s of spends) s.total = s.spend.reduce((sum, x) => sum + x.n, 0);
	return spends;
}

/**
 * @typedef {object} CampMember  One character at the fire, as camp-store.js reads them.
 * @property {string}  actorId
 * @property {string}  name
 * @property {boolean} isHost
 * @property {object}  record     readCampRecord's shape
 * @property {object}  resources  the character's inventory.resources, read live
 * @property {number}  hpValue    read live
 * @property {number}  maxHp      the COMPUTED max
 * @property {Array<{key: string, name: string}>} activeDebilities  read live
 * @property {boolean} unliving
 * @property {boolean} [breaksBread]  has Break Bread learned, read live
 * @property {number|null} [hearthCha]  CHA, when Keep the Home-Fires Burning is learned (read live);
 *   null without it
 * @property {Array<{key: string, name: string}>} [clearsTonight]  the marked background tracks a
 *   Make Camp clears (Auspicious Birth's circle), read live
 * @property {object}  [pack]     what Have What You Need can draw on, read live: `undefinedMarks`
 *   (the undefined ◇ left), `checked` (which inventory rows are marked) and `usesPerSupply`
 *   (4+Prosperity)
 * @property {boolean} [slowToHeal]   a Thrall with Torment's Blessing: recovers only half the HP
 * @property {boolean} [ravenous]     a Thrall with Ravenous: eats an extra 1d4 (`record.hunger`)
 * @property {boolean} [nightmarish]  a Thrall with Quicksilver Dreams: everyone else at the fire has
 *   nightmares
 */

/**
 * The camp's whole account: who eats, what that costs, what has been offered, and whether it can
 * be settled.
 *
 * A camp that cannot feed everyone eating tonight does not settle. That is not the old solo
 * dialog's refusal to let a hungry camp happen: going hungry is still one tick away on any row.
 * It is the move asking who. "Each member of the party must consume 1 use", and deprivation
 * (p.335) lands on a person, so the button waits until the table has said which one.
 *
 * @param {CampMember[]} members
 */
export function campLedger(members = []) {
	const rows    = [...members].sort(byJoinOrder);
	const cooks   = rows.filter(m => m.record.messKit && m.record.vitals.messKit);
	const messKit = cooks.length > 0;
	const mouths  = rows.reduce((sum, m) => sum + (eatsTonight(m) ? 1 : 0) + m.record.followers, 0);
	// Ravenous: "When you Make Camp, consume an extra 1d4 provisions or uses of supplies." On top of
	// the meal, so a mess kit does not stretch it, and only for a Thrall who eats: one who goes
	// without consumes nothing at all.
	const ravenous = rows.filter(m => m.ravenous && eatsTonight(m)).map(m => ({ actorId: m.actorId, name: m.name, uses: m.record.hunger }));
	const hunger  = ravenous.reduce((sum, r) => sum + r.uses, 0);
	const bill    = campUsesNeeded(mouths, messKit) + hunger;
	const offers  = rows.map(offerFrom);
	const offered = offers.reduce((sum, o) => sum + o.total, 0);
	const short   = Math.max(0, bill - offered);
	return {
		rows,
		offers,
		spends:    trimToBill(offers, bill),
		messKit,
		cooks:     cooks.map(m => m.name),
		mouths,
		ravenous,
		hunger,
		bill,
		offered,
		short,
		over:      Math.max(0, offered - bill),
		canSettle: rows.length > 0 && short === 0,
		// The host settles the camp, so the host is never waited on.
		waitingOn: rows.filter(m => !m.isHost && !m.record.ready).map(m => m.name),
		// Break Bread is "when you share a meal", so a holder who goes without (or cannot eat) brings
		// nothing to it.
		breadBreakers: rows.filter(m => m.breaksBread && eatsTonight(m)).map(m => m.name),
		// The same holders by actor id, so one dying at the fire can tell another's meal from their own.
		breadBreakerIds: rows.filter(m => m.breaksBread && eatsTonight(m)).map(m => m.actorId),
		properMeal:    rows.find(m => m.isHost)?.record.properMeal ?? true,
		// Keep the Home-Fires Burning is the fire's, not the meal's: a holder who goes without still
		// sprinkles the ash.
		hearthKeepers: rows.filter(m => m.hearthCha !== null && m.hearthCha !== undefined)
			.map(m => ({ actorId: m.actorId, name: m.name, cha: Math.trunc(Number(m.hearthCha) || 0) })),
		hearthAsh:     rows.find(m => m.isHost)?.record.hearthAsh ?? true,
		// Quicksilver Dreams is the Thrall's, whether or not they eat or sleep: "When you Make Camp".
		dreamers:      rows.filter(m => m.nightmarish).map(m => ({ actorId: m.actorId, name: m.name })),
	};
}

/** Where a member sits in the ledger's rows, or -1. */
function rowOf(ledger, member) {
	return ledger.rows.findIndex(m => m.actorId === member.actorId);
}

/**
 * A member's offer from one purse after a press of + or -, clamped to what the purse holds so a
 * stepper can never promise food that is not in the pack.
 */
export function offerStep(member, slug, delta) {
	const purse   = supplyPursesFor(member.resources, SUPPLY_PURPOSE.CAMP).eligible.find(p => p.slug === slug);
	const holds   = purse?.remaining ?? 0;
	const current = Math.min(member.record.offer[slug] ?? 0, holds);
	return Math.max(0, Math.min(holds, current + Math.trunc(Number(delta) || 0)));
}

/** How many more uses this member could still offer on top of what they already have. */
export function spareUses(ledger, member) {
	const at = rowOf(ledger, member);
	if (at < 0) return 0;
	return ledger.offers[at].purses.reduce((sum, p) => sum + p.remaining - p.n, 0);
}

/**
 * The offer that covers whatever the camp is still short, out of this member's pack, draining it
 * in the usual order. Covers as much as the pack can when it cannot cover all of it.
 */
export function coverTheRest(ledger, member) {
	const next = { ...member.record.offer };
	const at   = rowOf(ledger, member);
	if (at < 0) return next;
	let need = ledger.short;
	for (const purse of ledger.offers[at].purses) {
		if (need <= 0) break;
		const add = Math.min(need, purse.remaining - purse.n);
		if (add <= 0) continue;
		next[purse.slug] = purse.n + add;
		need -= add;
	}
	return next;
}

/** Whether this member eats, sleeps, and so takes a pick from the night. */
export function restsTonight(member, ledger) {
	return ledger.short === 0 && eatsTonight(member) && member.record.benefit !== CAMP_BENEFIT.NONE;
}

/** Whether a bedroll's "recover 1d6 extra HP when you Make Camp" is owed to this member. */
export function rollsBedroll(member, ledger) {
	return restsTonight(member, ledger) && member.record.bedroll && member.record.vitals.bedroll && !member.dying;
}

/**
 * Whether this member sleeps in the fur-lined bedroll tonight, and so is owed its "advantage on your
 * next roll". The same night the bedroll's 1d6 asks for (rollsBedroll): they rest, they are not dying,
 * and their row is sleeping in a bedroll. Its 1d6 is that one 1d6, never a second beside a plain
 * bedroll carried too; the advantage is its own, peaceful night or not.
 */
export function sleepsInFurBedroll(member, ledger) {
	return rollsBedroll(member, ledger) && member.record.vitals.furBedroll;
}

/**
 * Whether Break Bread is on the table tonight: somebody eating at the fire has it learned, the meal
 * is paid for, and there is somebody to share it WITH ("When you share a proper meal with someone"):
 * at least two mouths, a follower counting as one. The host's "A proper meal" box shows exactly then.
 */
export function breakBreadOffered(ledger) {
	return ledger.short === 0 && (ledger.breadBreakers?.length ?? 0) > 0 && count(ledger.mouths) >= 2;
}

/**
 * Whether Break Bread's "each of you recovers 1d8 (extra) HP" is owed to this member: it is on the
 * table, the host left the proper meal ticked, and this member eats. One meal, so one 1d8 each,
 * however many at the fire hold the move.
 *
 * One dying at the fire can't save themselves (Book I p.240), but an ally's healing still reaches
 * them: somebody ELSE's Break Bread does, and their own does not.
 */
export function rollsBreakBread(member, ledger) {
	if (!breakBreadOffered(ledger) || ledger.properMeal === false || !eatsTonight(member)) return false;
	if (!member.dying) return true;
	const holders = ledger.breadBreakerIds ?? [];
	return holders.some(id => id !== member.actorId);
}

/**
 * Whether the followers this member feeds at the fire share Break Bread's proper meal, and so are owed
 * its "each of you recovers 1d8 (extra) HP": a follower counts as somebody to share it with
 * (breakBreadOffered), so it is one of the "each of you" too. One 1d8 per mouth, rolled when the camp
 * settles (camp-store.js#settleHere); which of them it heals, and which are down at 0 HP and take
 * nothing, is the followers' own camp heal's call (camp-followers.js#campFollowerHeals).
 */
export function followersBreakBread(member, ledger) {
	return breakBreadOffered(ledger) && ledger.properMeal !== false && count(member?.record?.followers) > 0;
}

/**
 * Whether Keep the Home-Fires Burning is on offer tonight: somebody at the fire has it learned. The
 * host's "Ash from your own hearth" box shows exactly then.
 */
export function homeFiresOffered(ledger) {
	return (ledger.hearthKeepers?.length ?? 0) > 0;
}

/**
 * Whose hearth the ash comes from: the holder at the fire with the highest CHA, as `{name, cha}`, or
 * null with nobody holding the move. One fire, so two holders at it give one helping, the better.
 */
export function homeFiresKeeper(ledger) {
	return (ledger.hearthKeepers ?? []).reduce((best, k) => (!best || k.cha > best.cha ? k : best), null);
}

/**
 * The extra HP Keep the Home-Fires Burning gives everyone making camp tonight: the keeper's CHA, never
 * below 0 (a negative CHA takes nothing away, as Healer's Arts treats WIS), or 0 while the host has
 * the ash unticked.
 */
export function homeFiresHp(ledger) {
	if (!homeFiresOffered(ledger) || ledger.hearthAsh === false) return 0;
	return Math.max(0, homeFiresKeeper(ledger).cha);
}

/**
 * The extra HP the home fires give THIS member: homeFiresHp, except for one dying at the fire, who
 * can't save themselves (Book I p.240) but is still warmed by an ally's hearth. So their own ash
 * gives them nothing, and the best of the OTHER holders' CHA counts instead (0 with none).
 */
export function homeFiresHpFor(member, ledger) {
	if (!member?.dying) return homeFiresHp(ledger);
	if (!homeFiresOffered(ledger) || ledger.hearthAsh === false) return 0;
	const others = (ledger.hearthKeepers ?? []).filter(k => k.actorId !== member.actorId);
	return others.length ? Math.max(0, ...others.map(k => k.cha)) : 0;
}

/**
 * Whether this member gets Keep the Home-Fires Burning's HP: "anyone who Makes Camp with you", the
 * holder too, and whether or not they eat. Not the Unliving, who "gain no benefit from ... Make Camp".
 */
export function warmsAtHomeFires(member, ledger) {
	return homeFiresHpFor(member, ledger) > 0 && !member.unliving;
}

/**
 * Whether the fire's ash keeps a Thrall's Quicksilver Dreams away tonight. Keep the Home-Fires
 * Burning makes anyone who Makes Camp there "free from nightmares or bad dreams", which is exactly
 * what the Mark inflicts, so with the ash on the fire nobody suffers them. At any CHA, 0 included.
 */
export function nightmaresWarded(ledger) {
	return (ledger.dreamers?.length ?? 0) > 0 && homeFiresOffered(ledger) && ledger.hearthAsh !== false;
}

/**
 * The Thralls whose Quicksilver Dreams give this member nightmares tonight, by name: "When you Make
 * Camp, everyone with you suffers nightmares and has disadvantage on their next roll." Everyone WITH
 * the Thrall, so never the Thrall themselves (a second such Thrall at the fire still troubles the
 * first). Anyone at the fire, eating or not, sleeping or not: the Mark asks only that they camp
 * together. Never a Ghost or a Revenant, who "need not eat nor drink nor sleep", so have no dreams to
 * trouble. Empty with none at the fire, or with the nightmares warded off (nightmaresWarded).
 */
export function nightmaresFor(member, ledger) {
	if (member?.unliving || nightmaresWarded(ledger)) return [];
	return (ledger.dreamers ?? []).filter(d => d.actorId !== member.actorId).map(d => d.name);
}

// ── Extra HP ────────────────────────────────────────────────────────────────
// What a night at the fire heals ON TOP of the pick, each landing after the last, in this order. Each
// is "(extra) HP", never "instead of", so they stack: the bedroll's is the night's (only for someone who
// rests), Break Bread's the meal's (anyone who ate, sleep or no sleep), the home fires' the fire's
// (anyone who Makes Camp there). A new source is one row here and its words in camp-view.js.

export const CAMP_EXTRA = Object.freeze({ BEDROLL: "bedroll", BREAK_BREAD: "breakBread", HOME_FIRES: "homeFires" });

/** Each source's extra HP for member `m` tonight, from `rolls` ({bedrolls, breads}: 1d6 and 1d8 by actor id). */
const CAMP_EXTRAS = [
	{ source: CAMP_EXTRA.BEDROLL,     amount: (m, ledger, rolls) => (rollsBedroll(m, ledger) ? count(rolls.bedrolls?.[m.actorId]) : 0) },
	{ source: CAMP_EXTRA.BREAK_BREAD, amount: (m, ledger, rolls) => (rollsBreakBread(m, ledger) ? count(rolls.breads?.[m.actorId]) : 0) },
	{ source: CAMP_EXTRA.HOME_FIRES,  amount: (m, ledger) => (warmsAtHomeFires(m, ledger) ? homeFiresHpFor(m, ledger) : 0) },
];

/** `[source, amount]` pairs healed in turn from `start`, as `[{source, amount, from, to}]`, the empty left out. */
function healInTurn(start, amounts, maxHp) {
	const out = [];
	let hp = count(start);
	for (const [source, amount] of amounts) {
		const n = count(amount);
		if (!n) continue;
		const to = healTo(hp, n, maxHp);
		out.push({ source, amount: n, from: hp, to });
		hp = to;
	}
	return out;
}

/**
 * A plan entry's extra HP, `[{source, amount, from, to}]` in the order it lands. A plan frozen before the
 * list (an owed camp from an earlier version) is read off its old separate fields, replayed from the pick
 * with the same arithmetic that froze them.
 */
export function planExtras(entry) {
	if (Array.isArray(entry?.extras)) return entry.extras;
	return healInTurn(entry?.hpAfterPick ?? entry?.hpBefore, [
		[CAMP_EXTRA.BEDROLL, entry?.rests ? entry.bedroll : 0],
		[CAMP_EXTRA.BREAK_BREAD, entry?.breakBread],
		[CAMP_EXTRA.HOME_FIRES, entry?.homeFires],
	], entry?.maxHp);
}

/** How much `source` gave on a plan entry, 0 for none. */
export function planExtra(entry, source) {
	return planExtras(entry).find(extra => extra.source === source)?.amount ?? 0;
}

/** HP after healing `gain`, capped at `max`. */
export function healTo(hp, gain, max) {
	// Never below where they started: a max that could not be read (0) heals nothing rather than
	// "capping" somebody down to it.
	return Math.max(hp, Math.min(hp + count(gain), count(max)));
}

/**
 * The debility a member's night clears when that is their pick: the one their row chose while it is
 * still marked, or else the first one that is, or null when nothing is marked.
 *
 * A row's choice can name nothing marked: somebody who sat down with no debility and has gained one
 * since, or whose chosen one Recover cleared while another stays marked. The window shows that row
 * the first marked one, selected; the plan clears this same one, so what the table read at the fire
 * is what settling does.
 */
export function debilityToClear(member) {
	const marked = member?.activeDebilities ?? [];
	return marked.find(d => d.key === member.record.debility) ?? marked[0] ?? null;
}

/**
 * Freeze the camp into the plan every share is paid from.
 *
 * Frozen, because the shares are written on several machines: each character's own player lands
 * their own part. If each of those clients worked the camp out again from the flags it could see,
 * an offer changed a heartbeat after the host pressed the button would settle one pack against
 * one version of the bill and the next pack against another. The plan is the one version.
 *
 * @param {object} ledger  campLedger's result
 * @param {object} [o]
 * @param {Object<string, number>} [o.bedrolls]  each bedroll's 1d6, by actor id
 * @param {Object<string, number>} [o.breads]    each eater's Break Bread 1d8, by actor id
 * @param {Object<string, number[]>} [o.followerBreads]  the Break Bread 1d8s of each member's fed
 *        followers, one per mouth, by actor id (followersBreakBread)
 */
export function freezeCampPlan(ledger, { bedrolls = {}, breads = {}, followerBreads = {} } = {}) {
	return ledger.rows.map((m, at) => {
		const rests   = restsTonight(m, ledger);
		const cleared = rests && m.record.benefit === CAMP_BENEFIT.DEBILITY ? debilityToClear(m) : null;
		// With no debility marked any more there is nothing to pick but the HP, and the night still
		// buys a pick.
		const benefit  = !rests ? null : cleared ? CAMP_BENEFIT.DEBILITY : CAMP_BENEFIT.HP;
		const maxHp    = count(m.maxHp);
		const halfMax  = Math.ceil(maxHp / 2);
		const hpBefore = count(m.hpValue);
		// Dying at the fire (their 0-HP move still to face): they "can't save themselves" (Book I p.240),
		// so the night's own HP (the pick, their bedroll, their own Break Bread or hearth) restores
		// nothing; whoever tends them Aids the roll (p.245). An ally's healing still reaches them:
		// somebody else's Break Bread or hearth ash (CAMP_EXTRAS ask rollsBreakBread and homeFiresHpFor).
		const dying    = !!m.dying;
		const picked   = benefit === CAMP_BENEFIT.HP && !dying ? healTo(hpBefore, halfMax, maxHp) : hpBefore;
		const extras   = healInTurn(picked, CAMP_EXTRAS.map(x => [x.source, x.amount(m, ledger, { bedrolls, breads })]), maxHp);
		// What the night SHOULD heal, pick and extras alike; Torment's Blessing then halves the whole of
		// it once (deaths-door-actor.js#recoveredHpTo). The steps above stay what they should have been,
		// so the card can say what was halved.
		const healed   = extras.at(-1)?.to ?? picked;
		const slow     = !!m.slowToHeal && healed > hpBefore;
		return {
			actorId:  m.actorId,
			name:     m.name,
			spend:    ledger.spends[at].spend,
			unliving: m.unliving,
			eats:     eatsTonight(m),
			rests,
			benefit,
			debility: cleared ? { key: cleared.key, name: cleared.name } : null,
			maxHp,
			halfMax,
			hpBefore,
			hpAfterPick: picked,
			extras,
			slowToHeal: slow,
			hpAfter:  recoveredHpTo(hpBefore, healed, slow),
			...(dying ? { dying: true } : {}),
			// The mouths beside their own the meal fed, whose HP the night restores (camp-followers.js).
			followersFed: ledger.short === 0 ? count(m.record.followers) : 0,
			// Their Break Bread 1d8s, one per follower mouth, when the followers shared the proper meal.
			...(followersBreakBread(m, ledger) && followerBreads[m.actorId]?.length
				? { followerBreads: followerBreads[m.actorId].map(n => count(n)) } : {}),
			// Not for one dying at the fire: a night spent at Death's Door is no peaceful rest, and the
			// advantage would otherwise land on the roll at the Door.
			peaceful: rests && m.record.peaceful && !dying,
			// Slept in the fur-lined bedroll: advantage held for the next roll, beside any peaceful night's.
			furBedroll: sleepsInFurBedroll(m, ledger),
			// Whose Quicksilver Dreams trouble this member's night, as names; held disadvantage when any.
			nightmares: nightmaresFor(m, ledger),
			// Auspicious Birth's circle: "Clear it when you Make Camp", so whoever sits at the fire,
			// eating or not. Not the Unliving, whom Make Camp gives nothing.
			clears:   m.unliving ? [] : (m.clearsTonight ?? []).map(t => ({ key: t.key, name: t.name })),
		};
	});
}

/**
 * One character's share of a settled camp, as a single update: the food out of their pack, then
 * the night's pick, the bedroll, Break Bread, the home fires, the peaceful night and any background
 * track the camp clears, and the mark that says it is done.
 *
 * What is carried and the current HP are read LIVE, by the caller, at the moment of writing, and
 * what lands is still an absolute count and an absolute HP. So the plan says how many uses and how
 * much healing, never "leave 2 in the pack" or "set HP to 12": a Forage payout or a blow landing
 * between the button and this write would otherwise be silently undone.
 *
 * @param {object} entry  one freezeCampPlan entry
 * @param {object} live
 * @param {object} live.resources  the character's inventory.resources now
 * @param {number} live.hpValue    their HP now
 * @param {(slug: string, count: number) => object} live.resourceData  StonetopCharacter#inventoryResourceData
 * @param {(source: string|string[]) => object} live.advantageData   StonetopCharacter#heldAdvantageData
 * @param {(source: string) => object} [live.disadvantageData]       StonetopCharacter#heldDisadvantageData
 * @returns {{update: object, shortfall: number}}  `shortfall` counts uses the pack no longer had
 */
export function campShareUpdate(entry, { resources = {}, hpValue = 0, resourceData, advantageData, disadvantageData }) {
	const update = {};
	let shortfall = 0;
	for (const s of entry.spend ?? []) {
		const have = count(resources?.[s.slug]);
		const paid = Math.min(have, count(s.n));
		shortfall += count(s.n) - paid;
		Object.assign(update, resourceData(s.slug, have - paid));
	}
	const before = count(hpValue);
	let hp = before;
	if (entry.rests) {
		if (entry.benefit === CAMP_BENEFIT.DEBILITY && entry.debility?.key) {
			// Walk It Off's box, when that is the one picked (walk-it-off.js).
			Object.assign(update, debilityData(entry.debility.key, false));
		} else if (entry.benefit === CAMP_BENEFIT.HP && !entry.dying) {
			// Not for one dying at the fire (freezeCampPlan): they can't save themselves.
			hp = healTo(hp, entry.halfMax, entry.maxHp);
		}
		// Held, not the sticky roll-modifier selector: "advantage on your next roll" is a promise
		// about one roll. See StonetopCharacter#heldAdvantage.
		// A peaceful night and the fur-lined bedroll are two promises, laid in ONE call with both
		// names: heldAdvantageData lays its names beside what the sheet already holds, so a second
		// call in the same update would overwrite the first.
		const promises = [entry.peaceful && PEACEFUL_NIGHT, entry.furBedroll && FUR_LINED_BEDROLL].filter(Boolean);
		if (promises.length) Object.assign(update, advantageData(promises));
	}
	// The extra HP, each on top of what came before (CAMP_EXTRAS), healed from their HP now.
	for (const extra of planExtras(entry)) hp = healTo(hp, extra.amount, entry.maxHp);
	// Torment's Blessing: only half of all that, halved once and from their HP now.
	hp = recoveredHpTo(before, hp, !!entry.slowToHeal);
	if (hp !== before) update["system.attributes.hp.value"] = hp;
	// A Thrall's Quicksilver Dreams: disadvantage held for the next roll, a promise kept on the sheet
	// the way the peaceful night's advantage is (the two cancel at the roll).
	if (entry.nightmares?.length && disadvantageData) Object.assign(update, disadvantageData(QUICKSILVER_NIGHTMARES));
	// Auspicious Birth's circle, cleared by making camp at all.
	Object.assign(update, clearTracksData((entry.clears ?? []).filter(t => t?.key), SYSTEM_ID));
	update[`flags.${SYSTEM_ID}.${CAMP_FLAG}.applied`] = true;
	return { update, shortfall };
}

// ── Have What You Need, at the fire ─────────────────────────────────────────

/**
 * What a character can decide they had all along to feed the camp (Book I p.78): "transfer a mark
 * (or marks) from your 'undefined' inventory to a specific item or a slot." The book plays exactly
 * this at a campfire (p.327): nobody had packed supplies or a mess kit, and the GM says "you can
 * Have What You Need for supplies and a mess kit. One diamond of supplies gives you 4 uses, and the
 * mess kit is one diamond itself."
 *
 * There is no roll. It never makes PROVISIONS: those are food found in the field (p.89), not
 * something that could have been in the pack all along.
 */
export const HAD_ALL_ALONG = Object.freeze({
	SUPPLIES: "supplies",
	MESS_KIT: "mess-kit",
});

/** Why a character cannot produce supplies at the fire, when they cannot. */
export const HAD_ALL_ALONG_REFUSAL = Object.freeze({
	NO_MARKS: "no-marks",
	NO_ROW:   "no-row",
});

/** A member's pack as Have What You Need reads it, with the defaults filled in. */
function packOf(member) {
	const pack = member?.pack ?? {};
	return {
		undefinedMarks: count(pack.undefinedMarks),
		checked:        pack.checked ?? {},
		// "By default, one ◇ of supplies contains 4 uses, but you add Stonetop's current Prosperity" (p.89).
		usesPerSupply:  count(pack.usesPerSupply) || 4,
	};
}

/**
 * The printed supplies row an undefined ◇ would become: the first one not already marked, or null
 * when all three are. A marked row eaten empty stays marked and is not refilled: its ◇ already
 * counts toward the load, so filling it for one undefined ◇ would make a mark vanish. The unmarked
 * row it picks is packed fresh and full, as a tick on the sheet that draws an undefined ◇ packs it
 * (supply-cost.js#suppliesUsesOnMark, one rule for both).
 */
export function suppliesRowToMark(member) {
	const { checked } = packOf(member);
	return SUPPLY_SLUGS.find(slug => !checked[slug]) ?? null;
}

/**
 * Whether a member can decide they had supplies all along, and what that brings: `{ok: true, row,
 * uses}`, or `{ok: false, reason}` with a HAD_ALL_ALONG_REFUSAL.
 */
export function suppliesAllAlong(member) {
	const { undefinedMarks, usesPerSupply } = packOf(member);
	if (!undefinedMarks) return { ok: false, reason: HAD_ALL_ALONG_REFUSAL.NO_MARKS };
	const row = suppliesRowToMark(member);
	if (!row) return { ok: false, reason: HAD_ALL_ALONG_REFUSAL.NO_ROW };
	return { ok: true, row, uses: usesPerSupply };
}

/**
 * Whether a mess kit somebody had all along would make tonight's meal cheaper: nobody at the fire
 * is cooking with one yet, and a pot for four actually saves a use (one mouth eats 1 use either way).
 */
export function messKitWouldHelp(ledger) {
	// A Ravenous Thrall's extra is on top of the meal, and no pot stretches it.
	return !ledger.messKit && campUsesNeeded(ledger.mouths, true) + (ledger.hunger ?? 0) < ledger.bill;
}

/** Whether this member could produce a mess kit tonight: they carry none, and have an undefined ◇ to spend. */
export function messKitAllAlong(member) {
	return !member?.record?.vitals?.messKit && packOf(member).undefinedMarks > 0;
}

/**
 * What the packs at this fire still hold to eat once tonight's meal is paid, and how many more
 * nights like this one that feeds. Book I p.327's party does this sum before the next leg ("We've
 * got another eight days ahead of us... so that's 16 more uses").
 */
export function foodAfterTonight(ledger) {
	const held = ledger.offers.reduce((sum, o) => sum + o.purses.reduce((s, p) => s + p.remaining, 0), 0);
	const left = Math.max(0, held - Math.min(ledger.bill, ledger.offered));
	return { left, nights: ledger.bill ? Math.floor(left / ledger.bill) : 0 };
}

/** Whether anyone at this fire is carrying provisions, which keep worse than supplies (p.89). */
export function provisionsAtFire(ledger) {
	return ledger.rows.some(m => count(m.resources?.[PROVISIONS_SLUG]) > 0);
}
