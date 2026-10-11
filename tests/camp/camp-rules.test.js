import { describe, expect, it } from "vitest";
import { SYSTEM_ID } from "../../module/system-id.js";
import {
	CAMP_BENEFIT, CAMP_LEFT_MAX, CAMP_STALE_MS, CAMP_STATE, CAMP_STATUS, FUR_LINED_BEDROLL, PEACEFUL_NIGHT,
	isFurLinedBedrollName, sleepsInFurBedroll,
	blankOffer, breakBreadOffered, followersBreakBread, campLedger, campShareUpdate, campState, coverTheRest, freezeCampPlan,
	homeFiresHp, homeFiresHpFor, homeFiresKeeper, homeFiresOffered, isSettledRecord, newCampRecord, planExtra, planExtras, CAMP_EXTRA, offerStep, readCampRecord, readOwedCamps, rollsBedroll, rollsBreakBread, spareUses,
} from "../../module/camp/camp-rules.js";
import { seat } from "../fakes/camp.js";

/**
 * MAKE CAMP AS A PARTY (Book I p.334), as arithmetic: who eats, what the meal costs, whose food
 * pays for it, and what the night buys each person. Reading and writing the actors is
 * camp-store.test.js's business, and the words are camp-view.test.js's.
 */

const host = (over = {}) => seat({ id: "aeliana", name: "Aeliana", isHost: true, joinedAt: 1, ...over });
const bram = (over = {}) => seat({ id: "bram", name: "Bram", joinedAt: 2, carried: {}, ...over });
const cora = (over = {}) => seat({ id: "cora", name: "Cora", joinedAt: 3, carried: {}, ...over });

/** The host, paying for their own supper out of four supplies unless told otherwise. */
const paying = (choices = {}, over = {}) => host({ ...over, choices: { offer: { supplies: 1 }, ...choices } });

// ── the record ───────────────────────────────────────────────────────────────

describe("a camp record", () => {
	it("is nothing without a camp id", () => {
		expect(readCampRecord(null)).toBeNull();
		expect(readCampRecord({ offer: { supplies: 2 } })).toBeNull();
	});

	it("reads a sparse record as the defaults", () => {
		const record = readCampRecord({ id: "camp-1" });
		expect(record).toMatchObject({ eats: true, benefit: CAMP_BENEFIT.HP, followers: 0, ready: false, applied: false, plan: null });
		expect(record.offer).toEqual(blankOffer());
	});

	// Twisting Pine sap closes wounds, but it is not food (Book II p.462).
	it("offers from the supplies rows and the larder, and never the sap", () => {
		expect(Object.keys(blankOffer())).toEqual(["supplies", "more-supplies", "even-more-supplies", "provisions"]);
		expect(readCampRecord({ id: "camp-1", offer: { "twisting-pine": 3 } }).offer).not.toHaveProperty(["twisting-pine"]);
	});

	it("keeps its counts whole and inside their bounds", () => {
		const record = readCampRecord({ id: "camp-1", followers: 25.6, offer: { supplies: -2, provisions: 2.7 }, benefit: "feast" });
		// Every mouth eats (Book I p.79): no most on the followers.
		expect(record.followers).toBe(25);
		expect(readCampRecord({ id: "camp-1", followers: -3 }).followers).toBe(0);
		expect(record.offer.supplies).toBe(0);
		expect(record.offer.provisions).toBe(2);
		expect(record.benefit).toBe(CAMP_BENEFIT.HP);
	});

	it("reads a host's owed camps as a list, whatever was stored", () => {
		expect(readOwedCamps(undefined)).toEqual([]);
		expect(readOwedCamps([{ id: "camp-1", plan: [{ actorId: "bram" }] }, { id: "", plan: [] }, { id: "camp-2" }, null]))
			.toEqual([{ id: "camp-1", plan: [{ actorId: "bram" }] }]);
	});
});

describe("sitting down at a camp", () => {
	const sitting = (over = {}) => newCampRecord({
		id: "camp-1", hostId: "aeliana", actorId: "bram", now: 500, vitals: { maxHp: 15 }, hpValue: 4, ...over,
	});

	// Foundry merges a flag write into what is already there, so a record that left a field out
	// would keep the last camp's value for it: a ready tick, an applied mark, a settled plan.
	it("writes every field a camp record has, so one write clears the last camp", () => {
		expect(Object.keys(sitting()).sort()).toEqual(Object.keys(readCampRecord({ id: "x" })).sort());
		expect(sitting()).toMatchObject({ plan: null, applied: false, ready: false, settledAt: 0, offer: blankOffer() });
	});

	it("opens the camp for its host, and only for its host", () => {
		expect(sitting({ actorId: "aeliana" })).toMatchObject({ status: CAMP_STATUS.OPEN, openedAt: 500, joinedAt: 500 });
		expect(sitting()).toMatchObject({ status: null, openedAt: 0, joinedAt: 500 });
	});

	it("starts on healing, or on a debility when there is nothing to heal", () => {
		expect(sitting({ activeDebilityKeys: ["dazed"] })).toMatchObject({ benefit: CAMP_BENEFIT.HP, debility: "dazed" });
		expect(sitting({ hpValue: 15, activeDebilityKeys: ["dazed"] })).toMatchObject({ benefit: CAMP_BENEFIT.DEBILITY, debility: "dazed" });
		expect(sitting({ hpValue: 15 })).toMatchObject({ benefit: CAMP_BENEFIT.HP, debility: "" });
	});

	it("brings the bedroll and the mess kit that are actually carried", () => {
		expect(sitting({ vitals: { maxHp: 15, bedroll: true, messKit: true } })).toMatchObject({ bedroll: true, messKit: true });
		expect(sitting()).toMatchObject({ bedroll: false, messKit: false });
	});

	it("does not sit a Ghost or a Revenant down to eat", () => {
		expect(sitting({ unliving: true }).eats).toBe(false);
	});
});

describe("where a camp stands", () => {
	const camp = { campId: "camp-1", hostId: "aeliana" };
	const hostRecord = (over = {}) => readCampRecord({ id: "camp-1", host: "aeliana", status: "open", openedAt: 1000, ...over });

	it("is open while its host keeps it open", () => {
		expect(campState(hostRecord(), camp, 2000)).toBe(CAMP_STATE.OPEN);
	});

	it("goes cold when nobody settles it", () => {
		expect(campState(hostRecord(), camp, 1000 + CAMP_STALE_MS + 1)).toBe(CAMP_STATE.COLD);
	});

	it("is settled or broken up when its host says so", () => {
		expect(campState(hostRecord({ status: "settled" }), camp, 2000)).toBe(CAMP_STATE.SETTLED);
		expect(campState(hostRecord({ status: "cancelled" }), camp, 2000)).toBe(CAMP_STATE.CANCELLED);
	});

	// A Break up confirmed just after somebody else settled the camp lands on top of the plan.
	it("stays settled once it has a plan, whatever status lands on top of it", () => {
		const eaten = hostRecord({ status: "cancelled", plan: [{ actorId: "aeliana" }] });
		expect(isSettledRecord(eaten)).toBe(true);
		expect(campState(eaten, camp, 2000)).toBe(CAMP_STATE.SETTLED);
		expect(isSettledRecord(hostRecord({ status: "cancelled" }))).toBe(false);
	});

	// Only the host can say. A member's record goes on naming the camp they sat at long after it
	// is over.
	it("is gone once its host is at some other camp, or at none", () => {
		expect(campState(hostRecord({ id: "camp-2" }), camp, 2000)).toBe(CAMP_STATE.GONE);
		expect(campState(hostRecord({ host: "bram", status: null }), camp, 2000)).toBe(CAMP_STATE.GONE);
		expect(campState(null, camp, 2000)).toBe(CAMP_STATE.GONE);
	});

	// Walking over to another fire breaks the host's own camp up, and the record that said so is gone.
	it("is broken up when its host left it for another camp", () => {
		expect(campState(hostRecord({ id: "camp-2", status: null, leftCamps: ["camp-1"] }), camp, 2000)).toBe(CAMP_STATE.CANCELLED);
		expect(campState(hostRecord({ id: "camp-3", status: null, leftCamps: ["camp-1", "camp-2"] }), camp, 2000)).toBe(CAMP_STATE.CANCELLED);
		expect(campState(hostRecord({ id: "camp-2", status: null, leftCamps: ["camp-9"] }), camp, 2000)).toBe(CAMP_STATE.GONE);
	});

	it("remembers only the latest camps a character broke up", () => {
		const ids = Array.from({ length: CAMP_LEFT_MAX + 2 }, (_, i) => `camp-${i}`);
		expect(readCampRecord({ id: "x", leftCamps: ids }).leftCamps).toEqual(ids.slice(-CAMP_LEFT_MAX));
		expect(readCampRecord({ id: "x", leftCamps: "camp-1" }).leftCamps).toEqual([]);
	});
});

// ── the bill ─────────────────────────────────────────────────────────────────

describe("the meal's bill", () => {
	// "Each member of the party must consume 1 use of supplies or provisions."
	it("costs one use a mouth", () => {
		expect(campLedger([host(), bram(), cora()])).toMatchObject({ mouths: 3, bill: 3 });
	});

	it("feeds the followers too", () => {
		expect(campLedger([host({ choices: { followers: 2 } })])).toMatchObject({ mouths: 3, bill: 3 });
	});

	// CAMP-11: "each member of the party" eats (Book I p.79), and the book names no most. A cap of 20
	// billed 25 followers as 20, then fed fewer than travel with them and healed none.
	it("bills every follower, however many, and feeds them all", () => {
		expect(newCampRecord({ id: "camp-1", hostId: "aeliana", actorId: "aeliana", followers: 25 }).followers).toBe(25);
		const short = campLedger([host({ carried: { supplies: 30 }, choices: { followers: 25, offer: { supplies: 21 } } })]);
		expect(short).toMatchObject({ mouths: 26, bill: 26, short: 5, canSettle: false });
		const fed = campLedger([host({ carried: { supplies: 30 }, choices: { followers: 25, offer: { supplies: 26 } } })]);
		expect(fed).toMatchObject({ mouths: 26, bill: 26, short: 0, canSettle: true });
		expect(freezeCampPlan(fed)[0].followersFed).toBe(25);
	});

	it("does not feed whoever goes without, or the Unliving", () => {
		expect(campLedger([host(), bram({ choices: { eats: false } }), cora({ unliving: true })]).mouths).toBe(1);
	});

	// "If you use a mess kit (requires fire & water), then 1 use can provide for up to four people."
	it("stretches each use over four with a mess kit, rounding up", () => {
		const cook = host({ carriesMessKit: true, choices: { messKit: true, followers: 4 } });
		expect(campLedger([cook])).toMatchObject({ mouths: 5, bill: 2, messKit: true, cooks: ["Aeliana"] });
	});

	it("needs the kit both carried and put to use", () => {
		expect(campLedger([host({ carriesMessKit: true, choices: { followers: 4 } })]).bill).toBe(5);
		expect(campLedger([host({ choices: { messKit: true, followers: 4 } })]).bill).toBe(5);
	});

	it("settles once everyone eating has food, and not before", () => {
		const fed = campLedger([host({ choices: { offer: { supplies: 2 } } }), bram(), cora({ choices: { eats: false } })]);
		expect(fed).toMatchObject({ bill: 2, offered: 2, short: 0, canSettle: true });
		const hungry = campLedger([host({ choices: { offer: { supplies: 1 } } }), bram()]);
		expect(hungry).toMatchObject({ bill: 2, offered: 1, short: 1, canSettle: false });
	});

	it("has nothing to settle with nobody at the fire", () => {
		expect(campLedger([]).canSettle).toBe(false);
	});

	it("waits on everyone but the host to say they are ready", () => {
		expect(campLedger([host(), bram({ choices: { ready: true } }), cora()]).waitingOn).toEqual(["Cora"]);
	});
});

describe("the food shared", () => {
	it("counts only what the pack still holds", () => {
		expect(campLedger([host({ carried: { supplies: 2 }, choices: { offer: { supplies: 4 } } })]).offered).toBe(2);
	});

	it("counts nothing from a purse emptied since it was offered", () => {
		const ledger = campLedger([host({ carried: { supplies: 1 }, choices: { offer: { provisions: 3 } } })]);
		expect(ledger.offered).toBe(0);
		expect(ledger.offers[0].purses.map(p => p.slug)).toEqual(["supplies"]);
	});

	it("never offers the sap, however much of it is carried", () => {
		expect(campLedger([host({ carried: { "twisting-pine": 3 } })]).offers[0].purses).toEqual([]);
	});

	// Two people reaching for the same last use at once. Only the bill is eaten.
	it("spends only the bill, giving back from whoever sat down last", () => {
		const ledger = campLedger([
			host({ choices: { offer: { supplies: 2 }, followers: 1 } }),
			bram({ carried: { supplies: 3 }, choices: { offer: { supplies: 2 } } }),
		]);
		expect(ledger).toMatchObject({ bill: 3, offered: 4, over: 1 });
		expect(ledger.spends.map(s => s.total)).toEqual([2, 1]);
	});

	// Book I p.89: provisions "are more likely to spoil or attract beasts than supplies are", and the
	// book's party eats "a use of provisions when you Make Camp rather than using up supplies". The
	// order a meal eats a pack, run backwards, so supplies go back first and the provisions stay eaten.
	it("eats provisions first, since they spoil, and gives the supplies rows back first (Book I p.89)", () => {
		const ledger = campLedger([host({
			carried: { supplies: 4, provisions: 5 },
			choices: { offer: { supplies: 2, provisions: 1 }, followers: 1 },
		})]);
		expect(ledger.spends[0].spend).toEqual([
			{ slug: "provisions", label: "Provisions", n: 1 },
			{ slug: "supplies", label: "Supplies", n: 1 },
		]);
	});
});

describe("sharing food from a row", () => {
	it("steps an offer up and down inside what the purse holds", () => {
		const aeliana = host({ carried: { supplies: 2 }, choices: { offer: { supplies: 1 } } });
		expect(offerStep(aeliana, "supplies", 1)).toBe(2);
		expect(offerStep(host({ carried: { supplies: 2 }, choices: { offer: { supplies: 2 } } }), "supplies", 1)).toBe(2);
		expect(offerStep(host({ carried: { supplies: 2 } }), "supplies", -1)).toBe(0);
		expect(offerStep(aeliana, "provisions", 1)).toBe(0);
	});

	// Provisions spoil (Book I p.89), so they are what a meal reaches for first.
	it("covers what the meal is short from the provisions first, then the printed rows", () => {
		const aeliana = host({ carried: { supplies: 1, provisions: 5 } });
		const ledger = campLedger([aeliana, bram({ carried: { supplies: 1 }, choices: { offer: { supplies: 1 } } }), cora()]);
		expect(ledger.short).toBe(2);
		expect(coverTheRest(ledger, aeliana)).toEqual({ ...blankOffer(), provisions: 2 });
		const light = host({ carried: { supplies: 1, provisions: 1 } });
		expect(coverTheRest(campLedger([light, bram(), cora()]), light)).toEqual({ ...blankOffer(), supplies: 1, provisions: 1 });
	});

	it("covers as much as a light pack can", () => {
		const aeliana = host({ carried: { supplies: 1 } });
		expect(coverTheRest(campLedger([aeliana, bram(), cora()]), aeliana)).toEqual({ ...blankOffer(), supplies: 1 });
	});

	it("counts the food in a pack not yet shared", () => {
		const aeliana = host({ carried: { supplies: 4, provisions: 2 }, choices: { offer: { supplies: 1 } } });
		expect(spareUses(campLedger([aeliana]), aeliana)).toBe(5);
	});
});

// ── the plan ─────────────────────────────────────────────────────────────────

describe("the frozen plan", () => {
	// "Regain HP equal to ½ your max." Halves round up: 15 gives 8, not 7.
	it("heals half the max, rounded up", () => {
		expect(freezeCampPlan(campLedger([paying()]))[0]).toMatchObject({
			rests: true, benefit: CAMP_BENEFIT.HP, halfMax: 8, hpBefore: 4, hpAfterPick: 12, hpAfter: 12,
		});
	});

	it("never heals past the max", () => {
		expect(freezeCampPlan(campLedger([paying({}, { hp: 14 })]))[0].hpAfter).toBe(15);
	});

	// Book I p.335: going without food is going without the pick. What they shared is still eaten.
	it("gives whoever went without no pick, and still spends what they shared", () => {
		const [aeliana] = freezeCampPlan(campLedger([paying({ eats: false, followers: 1 })]));
		expect(aeliana).toMatchObject({ eats: false, rests: false, benefit: null });
		expect(aeliana.spend).toEqual([{ slug: "supplies", label: "Supplies", n: 1 }]);
	});

	it("gives the Unliving nothing from the night", () => {
		const plan = freezeCampPlan(campLedger([paying(), bram({ unliving: true })]));
		expect(plan[1]).toMatchObject({ unliving: true, eats: false, rests: false, benefit: null });
	});

	it("gives a night without real sleep no pick", () => {
		expect(freezeCampPlan(campLedger([paying({ benefit: "none" })]))[0]).toMatchObject({ rests: false, benefit: null });
	});

	it("clears the chosen debility instead, while it is still marked", () => {
		const [aeliana] = freezeCampPlan(campLedger([paying({ benefit: "debility", debility: "dazed" }, { marked: ["weakened", "dazed"] })]));
		expect(aeliana).toMatchObject({ benefit: CAMP_BENEFIT.DEBILITY, debility: { key: "dazed", name: "Dazed" }, hpAfter: 4 });
	});

	it("heals instead when the chosen debility was cleared some other way", () => {
		const [aeliana] = freezeCampPlan(campLedger([paying({ benefit: "debility", debility: "dazed" })]));
		expect(aeliana).toMatchObject({ benefit: CAMP_BENEFIT.HP, debility: null, hpAfter: 12 });
	});

	// The window shows such a row the first marked debility, selected, and the plan must clear that
	// one rather than quietly healing instead.
	it("clears the first marked debility when the row's choice names none still marked", () => {
		const joinedWithNone = freezeCampPlan(campLedger([paying({ benefit: "debility", debility: "" }, { marked: ["weakened"] })]))[0];
		expect(joinedWithNone).toMatchObject({ benefit: CAMP_BENEFIT.DEBILITY, debility: { key: "weakened", name: "Weakened" }, hpAfter: 4 });
		const choiceCleared = freezeCampPlan(campLedger([paying({ benefit: "debility", debility: "dazed" }, { marked: ["weakened"] })]))[0];
		expect(choiceCleared.debility).toEqual({ key: "weakened", name: "Weakened" });
	});

	// The bedroll's printed "recover 1d6 extra HP when you Make Camp": extra, so it stacks.
	it("adds a carried bedroll's die to the pick", () => {
		const ledger = campLedger([paying({ bedroll: true }, { carriesBedroll: true })]);
		expect(rollsBedroll(ledger.rows[0], ledger)).toBe(true);
		expect(freezeCampPlan(ledger, { bedrolls: { aeliana: 2 } })[0]).toMatchObject({
			hpAfterPick: 12, extras: [{ source: "bedroll", amount: 2, from: 12, to: 14 }], hpAfter: 14,
		});
	});

	it("rolls no bedroll that is not carried, or for a night without sleep", () => {
		const notCarried = campLedger([paying({ bedroll: true })]);
		expect(rollsBedroll(notCarried.rows[0], notCarried)).toBe(false);
		const sleepless = campLedger([paying({ bedroll: true, benefit: "none" }, { carriesBedroll: true })]);
		expect(rollsBedroll(sleepless.rows[0], sleepless)).toBe(false);
		expect(planExtra(freezeCampPlan(sleepless, { bedrolls: { aeliana: 6 } })[0], CAMP_EXTRA.BEDROLL)).toBe(0);
	});

	it("holds a peaceful night's advantage only for someone who rested", () => {
		expect(freezeCampPlan(campLedger([paying({ peaceful: true })]))[0].peaceful).toBe(true);
		expect(freezeCampPlan(campLedger([paying({ peaceful: true, eats: false, followers: 1 })]))[0].peaceful).toBe(false);
	});
});

// Book II, Spirits of the Wild: "When you Make Camp in the fur-lined bedroll, you regain 1d6 (extra)
// HP and gain advantage on your next roll." The user's ruling (CAMP-5): it is a bedroll for the 1d6,
// under the bedroll's own gates, one 1d6 even beside a plain bedroll, and its advantage is held on
// its own, peaceful night or not.
describe("the fur-lined bedroll", () => {
	const furNight = (choices = {}, over = {}) => campLedger([paying({ bedroll: true, ...choices }, { carriesFurBedroll: true, ...over })]);

	it("knows the treasure by its name", () => {
		expect(isFurLinedBedrollName("A fur-lined bedroll")).toBe(true);
		expect(isFurLinedBedrollName("Fur lined bedroll")).toBe(true);
		expect(isFurLinedBedrollName("Bedroll")).toBe(false);
		expect(isFurLinedBedrollName("A wolf pelt")).toBe(false);
	});

	it("sits down as a bedroll, ticked for the night", () => {
		const record = newCampRecord({ id: "camp-1", hostId: "aeliana", actorId: "aeliana", vitals: { maxHp: 15, furBedroll: true }, hpValue: 4 });
		expect(record).toMatchObject({ bedroll: true, vitals: { bedroll: true, furBedroll: true } });
	});

	it("rolls the bedroll's one 1d6 and holds advantage for someone who rests in it", () => {
		const ledger = furNight();
		expect(rollsBedroll(ledger.rows[0], ledger)).toBe(true);
		expect(sleepsInFurBedroll(ledger.rows[0], ledger)).toBe(true);
		const [entry] = freezeCampPlan(ledger, { bedrolls: { aeliana: 2 } });
		expect(entry).toMatchObject({ furBedroll: true, peaceful: false, hpAfter: 14 });
		expect(entry.extras).toEqual([{ source: "bedroll", amount: 2, from: 12, to: 14 }]);
	});

	it("gives one 1d6, not two, beside a plain bedroll carried too", () => {
		const ledger = furNight({}, { carriesBedroll: true });
		const [entry] = freezeCampPlan(ledger, { bedrolls: { aeliana: 3 } });
		expect(entry.extras.filter(x => x.source === CAMP_EXTRA.BEDROLL)).toEqual([{ source: "bedroll", amount: 3, from: 12, to: 15 }]);
		expect(entry.furBedroll).toBe(true);
	});

	it("gives nothing to a member who does not rest in it", () => {
		const sleepless = freezeCampPlan(furNight({ benefit: "none" }), { bedrolls: { aeliana: 6 } })[0];
		expect(sleepless).toMatchObject({ furBedroll: false });
		expect(planExtra(sleepless, CAMP_EXTRA.BEDROLL)).toBe(0);
		// Went without food: they eat nothing and take nothing from the night.
		expect(freezeCampPlan(furNight({ eats: false, followers: 1 }))[0].furBedroll).toBe(false);
		// Their row left the bedroll unrolled.
		expect(freezeCampPlan(furNight({ bedroll: false }))[0].furBedroll).toBe(false);
		// Dying at the fire, they can't save themselves (Book I p.240).
		const dying = campLedger([{ ...paying({ bedroll: true }, { carriesFurBedroll: true }), dying: true }]);
		expect(freezeCampPlan(dying)[0].furBedroll).toBe(false);
		// Somebody else at the fire, resting in a plain bedroll of their own.
		const shared = campLedger([
			paying({ bedroll: true, offer: { supplies: 2 } }, { carriesFurBedroll: true }),
			bram({ choices: { bedroll: true }, carriesBedroll: true }),
		]);
		const [, bramEntry] = freezeCampPlan(shared, { bedrolls: { aeliana: 1, bram: 1 } });
		expect(bramEntry.furBedroll).toBe(false);
	});

	it("is its own promise, not the peaceful night's", () => {
		const [both] = freezeCampPlan(furNight({ peaceful: true }));
		expect(both).toMatchObject({ furBedroll: true, peaceful: true });
		const [plain] = freezeCampPlan(campLedger([paying({ bedroll: true, peaceful: true }, { carriesBedroll: true })]));
		expect(plain).toMatchObject({ furBedroll: false, peaceful: true });
	});
});

// The Judge's "When you share a proper meal with someone and each of you eats their fill, each of
// you recovers 1d8 (extra) HP."
describe("Break Bread at the fire", () => {
	/** Aeliana paying for two, Bram eating with her. */
	const supper = (hostOver = {}, bramOver = {}, hostChoices = {}) =>
		campLedger([paying({ offer: { supplies: 2 }, ...hostChoices }, hostOver), bram(bramOver)]);

	it("is on the table only when someone eating holds it and the meal is paid", () => {
		expect(breakBreadOffered(supper({ breaksBread: true }))).toBe(true);
		expect(breakBreadOffered(supper({}, { breaksBread: true }))).toBe(true);
		expect(breakBreadOffered(supper())).toBe(false);
		// Short a use: Bram has nothing, and Aeliana shares only her own.
		expect(breakBreadOffered(campLedger([paying({}, { breaksBread: true }), bram()]))).toBe(false);
	});

	it("is not on the table when the only holder goes without", () => {
		expect(breakBreadOffered(supper({}, { breaksBread: true, choices: { eats: false } }))).toBe(false);
	});

	it("reads the host's proper-meal box, ticked unless the host unticked it", () => {
		expect(supper().properMeal).toBe(true);
		expect(supper({}, {}, { properMeal: false }).properMeal).toBe(false);
	});

	it("gives everyone who eats a 1d8 of extra HP, stacked beside the bedroll", () => {
		const ledger = supper({ breaksBread: true, carriesBedroll: true }, {}, { bedroll: true });
		expect(ledger.rows.map(m => rollsBreakBread(m, ledger))).toEqual([true, true]);
		const [aeliana, bramEntry] = freezeCampPlan(ledger, { bedrolls: { aeliana: 1 }, breads: { aeliana: 2, bram: 5 } });
		expect(aeliana).toMatchObject({ hpAfterPick: 12, extras: [{ source: "bedroll", amount: 1, from: 12, to: 13 }, { source: "breakBread", amount: 2, from: 13, to: 15 }], hpAfter: 15 });
		expect(bramEntry).toMatchObject({ hpAfterPick: 12, extras: [{ source: "breakBread", amount: 5, from: 12, to: 15 }], hpAfter: 15 });
	});

	it("rolls nothing when the host unticks the proper meal", () => {
		const ledger = supper({ breaksBread: true }, {}, { properMeal: false });
		expect(ledger.rows.map(m => rollsBreakBread(m, ledger))).toEqual([false, false]);
		expect(freezeCampPlan(ledger, { breads: { aeliana: 6, bram: 6 } }).map(e => planExtra(e, CAMP_EXTRA.BREAK_BREAD))).toEqual([0, 0]);
	});

	it("gives nothing to whoever does not eat", () => {
		const ledger = campLedger([paying({ offer: { supplies: 2 } }, { breaksBread: true }), bram({ choices: { eats: false } }), cora()]);
		expect(ledger.rows.map(m => rollsBreakBread(m, ledger))).toEqual([true, false, true]);
		const unliving = campLedger([paying({}, { breaksBread: true }), bram({ unliving: true })]);
		expect(rollsBreakBread(unliving.rows[1], unliving)).toBe(false);
	});

	// It is the meal's, not the night's.
	it("still reaches someone who ate but got no real sleep", () => {
		const ledger = supper({ breaksBread: true }, { choices: { benefit: "none" } });
		expect(freezeCampPlan(ledger, { breads: { aeliana: 3, bram: 3 } })[1]).toMatchObject({ rests: false, extras: [{ source: "breakBread", amount: 3, from: 4, to: 7 }], hpAfter: 7 });
	});

	// "When you share a proper meal with someone": a holder eating alone shares it with nobody. A
	// follower at the fire is somebody.
	it("needs someone to share the meal with: a holder eating alone rolls nothing, and a follower counts", () => {
		const alone = campLedger([paying({}, { breaksBread: true })]);
		expect(breakBreadOffered(alone)).toBe(false);
		expect(rollsBreakBread(alone.rows[0], alone)).toBe(false);
		const withHound = campLedger([paying({ followers: 1, offer: { supplies: 2 } }, { breaksBread: true })]);
		expect(breakBreadOffered(withHound)).toBe(true);
		expect(rollsBreakBread(withHound.rows[0], withHound)).toBe(true);
	});

	// "each of you recovers 1d8 (extra) HP": the follower the meal is shared with is one of "each of you"
	// (RAW re-check CX-1). One die per follower mouth, frozen on the plan for the followers' own heal.
	it("gives a fed follower its own 1d8 too, frozen on the plan one die per mouth", () => {
		const withHounds = campLedger([paying({ followers: 2, offer: { supplies: 3 } }, { breaksBread: true })]);
		expect(followersBreakBread(withHounds.rows[0], withHounds)).toBe(true);
		expect(freezeCampPlan(withHounds, { breads: { aeliana: 2 }, followerBreads: { aeliana: [3, 8] } })[0].followerBreads).toEqual([3, 8]);
		// No proper meal, no Break Bread at the fire, or no followers: no follower dice on the plan.
		const unticked = campLedger([paying({ followers: 2, offer: { supplies: 3 }, properMeal: false }, { breaksBread: true })]);
		expect(followersBreakBread(unticked.rows[0], unticked)).toBe(false);
		expect(freezeCampPlan(unticked, { followerBreads: { aeliana: [3, 8] } })[0].followerBreads).toBeUndefined();
		const noHolder = campLedger([paying({ followers: 2, offer: { supplies: 3 } })]);
		expect(followersBreakBread(noHolder.rows[0], noHolder)).toBe(false);
		expect(followersBreakBread(supper({ breaksBread: true }).rows[1], supper({ breaksBread: true }))).toBe(false);
	});

	it("is one meal, so two holders at the fire still give one 1d8 each", () => {
		const ledger = supper({ breaksBread: true }, { breaksBread: true });
		expect(ledger.breadBreakers).toEqual(["Aeliana", "Bram"]);
		expect(freezeCampPlan(ledger, { breads: { aeliana: 1, bram: 1 } }).map(e => [planExtra(e, CAMP_EXTRA.BREAK_BREAD), e.hpAfter])).toEqual([[1, 13], [1, 13]]);
	});
});

// The Lightbearer's "When you build a camp fire and sprinkle it with ash from your own hearth,
// anyone who Makes Camp with you is free from nightmares or bad dreams and recovers (extra) HP equal
// to your CHA."
describe("Keep the Home-Fires Burning at the fire", () => {
	/** Aeliana paying for two, Bram eating with her. */
	const supper = (hostOver = {}, bramOver = {}, hostChoices = {}) =>
		campLedger([paying({ offer: { supplies: 2 }, ...hostChoices }, hostOver), bram(bramOver)]);

	it("is on offer whenever someone at the fire has it learned, ticked unless the host unticks it", () => {
		expect(homeFiresOffered(supper({}, { hearthCha: 2 }))).toBe(true);
		expect(homeFiresOffered(supper())).toBe(false);
		expect(supper().hearthAsh).toBe(true);
		expect(homeFiresHp(supper({}, { hearthCha: 2 }))).toBe(2);
		expect(homeFiresHp(supper({}, { hearthCha: 2 }, { hearthAsh: false }))).toBe(0);
	});

	it("gives everyone making camp the holder's CHA, the holder too, eating or not", () => {
		const ledger = supper({}, { hearthCha: 2, choices: { eats: false } });
		const [aeliana, bramEntry] = freezeCampPlan(ledger);
		expect(aeliana).toMatchObject({ hpAfterPick: 12, extras: [{ source: "homeFires", amount: 2, from: 12, to: 14 }], hpAfter: 14 });
		expect(bramEntry).toMatchObject({ rests: false, hpBefore: 4, extras: [{ source: "homeFires", amount: 2, from: 4, to: 6 }], hpAfter: 6 });
	});

	it("never takes HP away for a negative CHA, and two holders give the higher CHA once", () => {
		expect(homeFiresHp(supper({ hearthCha: -1 }))).toBe(0);
		const two = supper({ hearthCha: 1 }, { hearthCha: 3 });
		expect(homeFiresHp(two)).toBe(3);
		expect(homeFiresKeeper(two).name).toBe("Bram");
		expect(freezeCampPlan(two).map(e => planExtra(e, CAMP_EXTRA.HOME_FIRES))).toEqual([3, 3]);
	});

	it("gives the Unliving nothing", () => {
		const ledger = campLedger([paying({}, { hearthCha: 2 }), bram({ unliving: true })]);
		expect(freezeCampPlan(ledger).map(e => planExtra(e, CAMP_EXTRA.HOME_FIRES))).toEqual([2, 0]);
	});

	it("comes on top of Break Bread, and stops at max HP", () => {
		const ledger = supper({ breaksBread: true, hearthCha: 3 });
		const [aeliana] = freezeCampPlan(ledger, { breads: { aeliana: 2, bram: 2 } });
		expect(aeliana).toMatchObject({ hpAfterPick: 12, extras: [{ source: "breakBread", amount: 2, from: 12, to: 14 }, { source: "homeFires", amount: 3, from: 14, to: 15 }], hpAfter: 15 });
	});
});

// Auspicious Birth: "Clear it when you Make Camp or Convalesce."
describe("a background track a camp clears", () => {
	const circle = [{ key: "auspicious-birth", name: "Auspicious Birth's background circle" }];

	it("is cleared for anyone making camp, eating or not, and never for the Unliving", () => {
		const ledger = campLedger([
			paying({}, { clearsTonight: circle }),
			bram({ clearsTonight: circle, choices: { eats: false } }),
			cora({ clearsTonight: circle, unliving: true }),
		]);
		expect(freezeCampPlan(ledger).map(e => e.clears)).toEqual([circle, circle, []]);
	});

	it("names nothing for someone with no marked track", () => {
		expect(freezeCampPlan(campLedger([paying()]))[0].clears).toEqual([]);
	});
});

// ── one share ────────────────────────────────────────────────────────────────

describe("one character's share", () => {
	const resourcePath = slug => `flags.${SYSTEM_ID}.inventory.resources.${slug}`;
	const APPLIED = `flags.${SYSTEM_ID}.camp.applied`;
	const HELD    = `flags.${SYSTEM_ID}.heldAdvantage`;
	const HP      = "system.attributes.hp.value";

	const entry = (over = {}) => ({
		spend: [{ slug: "supplies", label: "Supplies", n: 2 }],
		eats: true, rests: true, benefit: CAMP_BENEFIT.HP, debility: null,
		maxHp: 15, halfMax: 8, bedroll: 0, peaceful: false,
		...over,
	});
	// These mirror StonetopCharacter's own fragment builders, so the paths asserted are the ones
	// that actually land.
	const live = (over = {}) => ({
		resources:     { supplies: 4 },
		hpValue:       4,
		resourceData:  (slug, count) => ({ [resourcePath(slug)]: count }),
		advantageData: source => ({ [HELD]: { sources: [source].flat() } }),
		...over,
	});
	const share = (e, l) => campShareUpdate(entry(e), live(l));

	// What lands is an absolute count, so it is worked from the pack as it is when the share is
	// paid: a Forage payout between the settle and the write must not be undone.
	it("spends the planned uses from what the pack holds when the share is paid", () => {
		expect(share({}, { resources: { supplies: 6 } }).update[resourcePath("supplies")]).toBe(4);
	});

	it("spends from every purse the plan names, in one update", () => {
		const { update } = share({ spend: [{ slug: "supplies", n: 1 }, { slug: "provisions", n: 2 }] }, { resources: { supplies: 1, provisions: 5 } });
		expect(update[resourcePath("supplies")]).toBe(0);
		expect(update[resourcePath("provisions")]).toBe(3);
	});

	it("says how much a pack emptied since the settle could not pay", () => {
		const { update, shortfall } = share({}, { resources: { supplies: 1 } });
		expect(update[resourcePath("supplies")]).toBe(0);
		expect(shortfall).toBe(1);
	});

	// They took 3 harm while the camp sat open, so the night is 1 + 8 = 9, not 12.
	it("heals from the HP the character has when the share is paid", () => {
		expect(share({}, { hpValue: 1 }).update[HP]).toBe(9);
	});

	it("never heals past the max", () => {
		expect(share({}, { hpValue: 14 }).update[HP]).toBe(15);
	});

	it("clears the debility instead, when that was the pick", () => {
		const { update } = share({ benefit: CAMP_BENEFIT.DEBILITY, debility: { key: "dazed", name: "Dazed" } });
		expect(update["system.attributes.debilities.options.dazed.value"]).toBe(false);
		expect(Object.keys(update)).not.toContain(HP);
	});

	// Walk It Off: "Clear it as you would a debility". Its box is the move's track, not a debility box.
	it("clears a Ranger's Walk It Off box when that was the pick", () => {
		const { update } = share({ benefit: CAMP_BENEFIT.DEBILITY, debility: { key: "walkItOff", name: "Walk It Off" } });
		expect(update["flags.stonetop-pwd.moves.backgroundChoices.Walk It Off"]).toBe(0);
		expect(Object.keys(update).filter(k => k.startsWith("system.attributes.debilities"))).toEqual([]);
	});

	it("adds the bedroll's roll on top of either pick", () => {
		expect(share({ bedroll: 3 }).update[HP]).toBe(15);
		const cleared = share({ benefit: CAMP_BENEFIT.DEBILITY, debility: { key: "dazed" }, bedroll: 3 }, { hpValue: 10 }).update;
		expect(cleared[HP]).toBe(13);
	});

	// A HELD advantage, not the sticky roll-modifier selector: see StonetopCharacter#heldAdvantage.
	it("holds the peaceful night's advantage for the next roll", () => {
		expect(share({ peaceful: true }).update[HELD]).toEqual({ sources: [PEACEFUL_NIGHT] });
	});

	// One write, one held flag, both names: a second advantageData call would overwrite the first.
	it("holds the fur-lined bedroll's advantage under its own name, beside a peaceful night's", () => {
		expect(share({ furBedroll: true }).update[HELD]).toEqual({ sources: [FUR_LINED_BEDROLL] });
		expect(share({ furBedroll: true, peaceful: true }).update[HELD]).toEqual({ sources: [PEACEFUL_NIGHT, FUR_LINED_BEDROLL] });
		expect(share({ furBedroll: false, peaceful: false }).update).not.toHaveProperty([HELD]);
		expect(share({ rests: false, benefit: null, furBedroll: true }).update).not.toHaveProperty([HELD]);
	});

	it("gives someone who did not rest nothing but their part of the bill", () => {
		const { update } = share({ rests: false, benefit: null, bedroll: 3, peaceful: true });
		expect(Object.keys(update)).toEqual([resourcePath("supplies"), APPLIED]);
	});

	it("adds Break Bread's roll beside the bedroll, and to an eater who got no real sleep", () => {
		expect(share({ bedroll: 1, breakBread: 2 }).update[HP]).toBe(15);
		expect(share({ breakBread: 2 }, { hpValue: 1 }).update[HP]).toBe(11);
		expect(share({ rests: false, benefit: null, breakBread: 4 }).update[HP]).toBe(8);
	});

	it("adds the home fires' HP to anyone who made camp, rested or not", () => {
		expect(share({ homeFires: 2 }).update[HP]).toBe(14);
		expect(share({ rests: false, benefit: null, homeFires: 2 }).update[HP]).toBe(6);
	});

	it("empties the background tracks the plan names, in the same update", () => {
		const { update } = share({ rests: false, benefit: null, clears: [{ key: "auspicious-birth", name: "Auspicious Birth's background circle" }] });
		expect(update[`flags.${SYSTEM_ID}.background.setupResources.auspicious-birth`]).toBe(0);
	});

	it("marks the share paid in the same update", () => {
		expect(share().update[APPLIED]).toBe(true);
	});

	it("heals nothing when the max could not be read, rather than capping anyone down to 0", () => {
		expect(Object.keys(share({ maxHp: 0, halfMax: 0 }).update)).not.toContain(HP);
	});
});

// An owed camp frozen by an earlier version carries the old separate fields, not `extras`: it is read
// the same way, replayed from the pick, so it still pays and still says what it did.
describe("a plan frozen before the extras list", () => {
	const legacy = { rests: true, maxHp: 15, hpBefore: 4, hpAfterPick: 12, bedroll: 1, breakBread: 2, homeFires: 3, hpAfter: 15 };

	it("reads the old fields in the order they landed", () => {
		expect(planExtras(legacy)).toEqual([
			{ source: CAMP_EXTRA.BEDROLL, amount: 1, from: 12, to: 13 },
			{ source: CAMP_EXTRA.BREAK_BREAD, amount: 2, from: 13, to: 15 },
			{ source: CAMP_EXTRA.HOME_FIRES, amount: 3, from: 15, to: 15 },
		]);
	});

	it("gives no bedroll to a night without sleep", () => {
		expect(planExtras({ ...legacy, rests: false, hpAfterPick: 4 }).map(x => x.source))
			.toEqual([CAMP_EXTRA.BREAK_BREAD, CAMP_EXTRA.HOME_FIRES]);
	});
});

// ── a Thrall's Marks at the fire (post-death audit, 2026-09-27) ───────────────

describe("a Thrall's Marks at the fire", () => {
	const HP   = "system.attributes.hp.value";
	const DIS  = `flags.${SYSTEM_ID}.heldDisadvantage`;
	const live = (over = {}) => ({
		resources:        { supplies: 4 },
		hpValue:          4,
		resourceData:     (slug, n) => ({ [`flags.${SYSTEM_ID}.inventory.resources.${slug}`]: n }),
		advantageData:    source => ({ [`flags.${SYSTEM_ID}.heldAdvantage`]: { sources: [source].flat() } }),
		disadvantageData: source => ({ [DIS]: { sources: [source].flat() } }),
		...over,
	});

	// Ravenous: "When you Make Camp, consume an extra 1d4 provisions or uses of supplies."
	it("adds a Ravenous Thrall's rolled 1d4 to the bill, beyond what a mess kit stretches", () => {
		const rook = { ...bram({ name: "Rook", choices: { hunger: 3 } }), ravenous: true };
		const ledger = campLedger([paying(), rook]);
		expect(ledger.mouths).toBe(2);
		expect(ledger.hunger).toBe(3);
		expect(ledger.bill).toBe(5);
		expect(ledger.ravenous).toEqual([{ actorId: "bram", name: "Rook", uses: 3 }]);
		const cooked = campLedger([paying({ messKit: true }, { carriesMessKit: true }), rook]);
		expect(cooked.bill).toBe(1 + 3);
	});

	it("eats nothing extra for a Ravenous Thrall who goes without, or for one without the Mark", () => {
		const fasting = { ...bram({ choices: { hunger: 3, eats: false } }), ravenous: true };
		expect(campLedger([paying(), fasting]).bill).toBe(1);
		expect(campLedger([paying(), bram({ choices: { hunger: 3 } })]).bill).toBe(2);
	});

	// Quicksilver Dreams: "When you Make Camp, everyone with you suffers nightmares and has
	// disadvantage on their next roll." With you: never the Thrall themselves. Nor a Ghost or a
	// Revenant, who "need not eat nor drink nor sleep" (the user's ruling, 2026-10-08); somebody who
	// only got no real sleep tonight still camped with the Thrall, and still has them.
	it("gives everyone but the Thrall and the Unliving nightmares, sleepless or not, and holds disadvantage on their share", () => {
		const rook = { ...bram({ name: "Rook" }), nightmarish: true };
		const dara = seat({ id: "dara", name: "Dara", joinedAt: 4, carried: {}, choices: { benefit: "none" } });
		const plan = freezeCampPlan(campLedger([paying({ offer: { supplies: 4 } }), rook, cora({ unliving: true }), dara]));
		expect(plan.map(e => e.nightmares)).toEqual([["Rook"], [], [], ["Rook"]]);
		expect(campShareUpdate(plan[2], live()).update).not.toHaveProperty(DIS);
		expect(campShareUpdate(plan[3], live()).update[DIS]).toEqual({ sources: ["Nightmares (Quicksilver Dreams)"] });
		expect(campShareUpdate(plan[0], live()).update[DIS]).toEqual({ sources: ["Nightmares (Quicksilver Dreams)"] });
		expect(campShareUpdate(plan[1], live()).update).not.toHaveProperty(DIS);
	});

	it("is warded off by ash from a hearth, which keeps anyone free from nightmares", () => {
		const rook = { ...bram({ name: "Rook", hearthCha: 0 }), nightmarish: true };
		const plan = freezeCampPlan(campLedger([paying({ offer: { supplies: 2 } }), rook]));
		expect(plan.map(e => e.nightmares)).toEqual([[], []]);
		const unticked = freezeCampPlan(campLedger([paying({ offer: { supplies: 2 }, hearthAsh: false }), rook]));
		expect(unticked[0].nightmares).toEqual(["Rook"]);
	});

	// Torment's Blessing: "When you recover HP, recover only half the amount that you should."
	it("halves a slow healer's whole night once, rounding up, from the HP they have when it is paid", () => {
		const rook = { ...host({ choices: { offer: { supplies: 1 }, bedroll: true }, carriesBedroll: true }), slowToHeal: true };
		const [entry] = freezeCampPlan(campLedger([rook]), { bedrolls: { aeliana: 3 } });
		// 4 of 15: half max is 8, then 3 from the bedroll, so they should reach 15; they recover 6 of the 11.
		expect(entry).toMatchObject({ hpBefore: 4, hpAfterPick: 12, slowToHeal: true, hpAfter: 10 });
		expect(campShareUpdate(entry, live()).update[HP]).toBe(10);
		// Hurt by 2 since the settle: they should reach 13, and recover 6 of the 11.
		expect(campShareUpdate(entry, live({ hpValue: 2 })).update[HP]).toBe(8);
	});

	it("heals everyone else in full", () => {
		const [entry] = freezeCampPlan(campLedger([paying()]));
		expect(entry.slowToHeal).toBe(false);
		expect(campShareUpdate(entry, live()).update[HP]).toBe(12);
	});
});

// ── wounds audit #9 and #10 (user rulings, 2026-10-02) ───────────────────────

describe("a dying character at the fire, and the followers the meal fed", () => {
	const HP   = "system.attributes.hp.value";
	const live = (over = {}) => ({
		resources:        { supplies: 4 },
		hpValue:          0,
		resourceData:     (slug, n) => ({ [`flags.${SYSTEM_ID}.inventory.resources.${slug}`]: n }),
		advantageData:    source => ({ [`flags.${SYSTEM_ID}.heldAdvantage`]: { sources: [source].flat() } }),
		disadvantageData: source => ({ [`flags.${SYSTEM_ID}.heldDisadvantage`]: { sources: [source].flat() } }),
		...over,
	});
	const dying = (choices = {}, over = {}) => ({ ...paying(choices, { hp: 0, ...over }), dying: true });

	// Book I p.240: a PC out of the action "can't save themselves"; p.245: whoever tends them Aids the roll.
	it("restores a dying character none of their own HP: not the pick, their bedroll, their own Break Bread or hearth", () => {
		// The same character up and about rolls both, so it is the dying that stops them. A follower
		// eats with them, so Break Bread has someone to be shared with.
		const choices = { bedroll: true, followers: 1, offer: { supplies: 2 } };
		const up = campLedger([paying(choices, { hp: 0, carriesBedroll: true, breaksBread: true, hearthCha: 2 })]);
		expect(rollsBedroll(up.rows[0], up)).toBe(true);
		expect(rollsBreakBread(up.rows[0], up)).toBe(true);
		expect(homeFiresHpFor(up.rows[0], up)).toBe(2);
		const ledger = campLedger([dying(choices, { carriesBedroll: true, breaksBread: true, hearthCha: 2 })]);
		expect(rollsBedroll(ledger.rows[0], ledger)).toBe(false);
		expect(rollsBreakBread(ledger.rows[0], ledger)).toBe(false);
		expect(homeFiresHpFor(ledger.rows[0], ledger)).toBe(0);
		const [entry] = freezeCampPlan(ledger, { bedrolls: { aeliana: 6 }, breads: { aeliana: 8 } });
		expect(entry).toMatchObject({ dying: true, hpBefore: 0, hpAfterPick: 0, hpAfter: 0, extras: [] });
		expect(campShareUpdate(entry, live()).update).not.toHaveProperty(HP);
	});

	// The user's ruling (2026-10-08): an ally's healing still works on one dying at the fire.
	it("lets another character's Break Bread and hearth ash reach a dying character", () => {
		const ledger = campLedger([dying({ offer: { supplies: 2 } }), bram({ breaksBread: true, hearthCha: 2 })]);
		expect(rollsBreakBread(ledger.rows[0], ledger)).toBe(true);
		expect(homeFiresHpFor(ledger.rows[0], ledger)).toBe(2);
		const [entry] = freezeCampPlan(ledger, { breads: { aeliana: 3, bram: 4 } });
		expect(entry).toMatchObject({
			dying: true, hpAfterPick: 0, hpAfter: 5,
			extras: [{ source: "breakBread", amount: 3, from: 0, to: 3 }, { source: "homeFires", amount: 2, from: 3, to: 5 }],
		});
		expect(campShareUpdate(entry, live()).update[HP]).toBe(5);
	});

	it("warms a dying holder at another holder's hearth, never at their own", () => {
		const keepers = { hearthCha: 3 };
		const ledger = campLedger([dying({ offer: { supplies: 3 } }, keepers), bram({ hearthCha: 1 }), cora()]);
		expect(homeFiresHpFor(ledger.rows[0], ledger)).toBe(1);
		expect(homeFiresHpFor(ledger.rows[2], ledger)).toBe(3);
	});

	// A night at Death's Door is no peaceful rest, and the advantage would land on the roll at the Door.
	it("holds no peaceful-night advantage for a dying character", () => {
		const [entry] = freezeCampPlan(campLedger([dying({ peaceful: true })]));
		expect(entry.peaceful).toBe(false);
		expect(campShareUpdate(entry, live()).update).not.toHaveProperty(`flags.${SYSTEM_ID}.heldAdvantage`);
		expect(freezeCampPlan(campLedger([paying({ peaceful: true })]))[0].peaceful).toBe(true);
	});

	it("still clears the debility a dying character picked", () => {
		const [entry] = freezeCampPlan(campLedger([dying({ benefit: "debility", debility: "dazed" }, { marked: ["dazed"] })]));
		expect(entry).toMatchObject({ benefit: CAMP_BENEFIT.DEBILITY, debility: { key: "dazed", name: "Dazed" } });
		expect(campShareUpdate(entry, live()).update["system.attributes.debilities.options.dazed.value"]).toBe(false);
	});

	it("heals one who is not dying as it always did", () => {
		const [entry] = freezeCampPlan(campLedger([paying()]));
		expect(entry.dying).toBeUndefined();
		expect(campShareUpdate(entry, live({ hpValue: 4 })).update[HP]).toBe(12);
	});

	it("says on the plan how many followers the meal fed", () => {
		const [entry] = freezeCampPlan(campLedger([paying({ followers: 2, offer: { supplies: 3 } })]));
		expect(entry.followersFed).toBe(2);
		expect(freezeCampPlan(campLedger([paying()]))[0].followersFed).toBe(0);
	});
});
