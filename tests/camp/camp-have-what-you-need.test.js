import { afterEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_ID } from "../../module/system-id.js";
import {
	CAMP_STATE, HAD_ALL_ALONG, HAD_ALL_ALONG_REFUSAL, campLedger, foodAfterTonight, messKitAllAlong, messKitWouldHelp,
	provisionsAtFire, suppliesAllAlong, suppliesRowToMark,
} from "../../module/camp/camp-rules.js";
import { campWindowView, hadAllAlongRows } from "../../module/camp/camp-view.js";
import { campMembers, haveWhatYouNeedAtCamp, hostCamp, joinCamp } from "../../module/camp/camp-store.js";
import { CampWindow } from "../../module/camp/CampWindow.js";
import { applyUpdate, campParty, restoreCampWorld, seat } from "../fakes/camp.js";

/**
 * HAVE WHAT YOU NEED at the fire, and what else the camp tells its players about food.
 *
 * Book I p.78: "When you decide that you had something all along, transfer a mark (or marks) from
 * your 'undefined' inventory to a specific item or a slot." No roll. The book runs it at a campfire
 * on p.327: nobody packed supplies or a mess kit, and the GM says "you can Have What You Need for
 * supplies and a mess kit. One diamond of supplies gives you 4 uses, and the mess kit is one diamond
 * itself." It cannot make provisions: those are found in the field (p.89).
 */

afterEach(restoreCampWorld);

const aeliana = (over = {}) => seat({ id: "aeliana", name: "Aeliana", isHost: true, joinedAt: 1, ...over });
const bram    = (over = {}) => seat({ id: "bram", name: "Bram", joinedAt: 2, carried: {}, ...over });

const view = (members, over = {}) => campWindowView({
	state: CAMP_STATE.OPEN, hostName: "Aeliana", ledger: campLedger(members), manages: true,
	editable: ["aeliana", "bram"], mine: ["aeliana"], ...over,
});

describe("what an undefined ◇ can become at the fire", () => {
	it("becomes the first supplies row not yet marked, holding 4+Prosperity uses", () => {
		expect(suppliesAllAlong(bram({ undefinedMarks: 2, usesPerSupply: 5 })))
			.toEqual({ ok: true, row: "supplies", uses: 5 });
		expect(suppliesRowToMark(bram({ checked: { supplies: true } }))).toBe("more-supplies");
	});

	it("holds the book's 4 uses when Prosperity cannot be read", () => {
		expect(suppliesAllAlong(bram({ undefinedMarks: 1 })).uses).toBe(4);
	});

	it("needs an undefined ◇, and an unmarked supplies row to put it on", () => {
		expect(suppliesAllAlong(bram())).toEqual({ ok: false, reason: HAD_ALL_ALONG_REFUSAL.NO_MARKS });
		const full = { supplies: true, "more-supplies": true, "even-more-supplies": true };
		expect(suppliesAllAlong(bram({ undefinedMarks: 1, checked: full }))).toEqual({ ok: false, reason: HAD_ALL_ALONG_REFUSAL.NO_ROW });
	});

	it("offers a mess kit only when it saves a use tonight and the character has none", () => {
		const two = campLedger([aeliana(), bram()]);
		expect(messKitWouldHelp(two)).toBe(true);
		expect(messKitWouldHelp(campLedger([aeliana()]))).toBe(false);
		expect(messKitWouldHelp(campLedger([aeliana({ carriesMessKit: true, choices: { messKit: true } }), bram()]))).toBe(false);
		expect(messKitAllAlong(bram({ undefinedMarks: 1 }))).toBe(true);
		expect(messKitAllAlong(bram({ undefinedMarks: 1, carriesMessKit: true }))).toBe(false);
		expect(messKitAllAlong(bram())).toBe(false);
	});
});

describe("the food left after tonight", () => {
	it("counts every pack at the fire, less the meal", () => {
		const ledger = campLedger([aeliana({ carried: { supplies: 5 }, choices: { offer: { supplies: 2 } } }), bram({ carried: { provisions: 3 } })]);
		expect(foodAfterTonight(ledger)).toEqual({ left: 6, nights: 3 });
	});

	it("knows when anyone at the fire carries provisions", () => {
		expect(provisionsAtFire(campLedger([aeliana(), bram({ carried: { provisions: 1 } })]))).toBe(true);
		expect(provisionsAtFire(campLedger([aeliana()]))).toBe(false);
	});
});

describe("the camp window's food notes", () => {
	it("says how long the food lasts once the meal is paid", () => {
		const meal = view([aeliana({ carried: { supplies: 5 }, choices: { offer: { supplies: 1 } } })]).meal;
		expect(meal.afterText).toBe("After tonight, 4 uses of food stay in the packs at this fire: enough for 4 more nights like this one.");
		expect(meal.forageText).toBe("");
	});

	it("says so when the meal eats the last of it", () => {
		expect(view([aeliana({ carried: { supplies: 1 }, choices: { offer: { supplies: 1 } } })]).meal.afterText)
			.toBe("After tonight, the packs at this fire hold no more food.");
	});

	it("points a short meal at Forage", () => {
		expect(view([aeliana({ carried: {} })]).meal.forageText).toMatch(/^Or Forage first/);
	});

	it("warns that provisions keep worse than supplies", () => {
		expect(view([aeliana({ carried: { provisions: 2 } })]).meal.provisionsText).toMatch(/Provisions spoil and attract beasts/);
	});
});

describe("the Have What You Need buttons", () => {
	it("offer supplies on a short meal to a pack with nothing left to share", () => {
		const rows = view([aeliana({ carried: {} }), bram({ undefinedMarks: 1, usesPerSupply: 5 })]).rows;
		expect(rows[1].allAlong.supplies).toMatchObject({ show: true, can: true, label: "Had supplies all along (5 uses)", blocked: "" });
		expect(rows[1].allAlong.supplies.tip).toMatch(/^Have What You Need: 1 undefined ◇/);
	});

	it("say once, in the meal, what the move is and that anyone can veto it", () => {
		expect(view([aeliana({ carried: {} }), bram({ undefinedMarks: 1 })]).allAlongText).toMatch(/veto/);
		expect(view([aeliana({ carried: { supplies: 4 } })]).allAlongText).toBe("");
	});

	it("wait while the pack still holds food to share", () => {
		const rows = view([aeliana({ carried: { supplies: 4 } }), bram({ undefinedMarks: 1 })]).rows;
		expect(rows[0].allAlong.supplies.show).toBe(false);
	});

	it("hold the supplies button, saying why, when there is no undefined ◇", () => {
		const { supplies } = view([aeliana({ carried: {} })]).rows[0].allAlong;
		expect(supplies).toMatchObject({
			show: true, can: false,
			blocked: "Aeliana has no undefined ◇ left to turn into supplies.",
			tip:     "Aeliana has no undefined ◇ left to turn into supplies.",
		});
	});

	it("never appear on a row the reader cannot drive", () => {
		const rows = view([aeliana({ carried: {} }), bram({ undefinedMarks: 1 })], { editable: ["aeliana"] }).rows;
		expect(rows[1].allAlong.show).toBe(false);
	});

	it("offer a mess kit when it would save a use", () => {
		const rows = view([aeliana({ carried: {} }), bram({ undefinedMarks: 1 })]).rows;
		expect(rows[1].allAlong.messKit.show).toBe(true);
		expect(rows[0].allAlong.messKit.show).toBe(false);
	});

	it("post a card anyone can veto", () => {
		expect(hadAllAlongRows(HAD_ALL_ALONG.SUPPLIES, { row: "more-supplies", uses: 5 })).toEqual([
			{ label: "Had all along", value: "More supplies, 5 uses of food, for 1 undefined ◇." },
			{ label: "Any objection", value: "The GM or any player can veto something that could not have been there all along." },
		]);
	});
});

/** Bram's character model, as far as Have What You Need uses it: the same flag writes as the sheet's. */
function givePack(actor, { pool = 1, checked = {}, limit = 5 } = {}) {
	applyUpdate(actor, { [`flags.${SYSTEM_ID}.inventory.regularPool`]: pool, [`flags.${SYSTEM_ID}.inventory.checked`]: checked });
	Object.assign(actor.typedActor, {
		getUsesPerSupply: () => limit,
		toggleCarriedItem: vi.fn(async (slug, on, { weight, uses }) => {
			const inv = actor.flags[SYSTEM_ID].inventory;
			applyUpdate(actor, {
				[`flags.${SYSTEM_ID}.inventory.checked.${slug}`]: on,
				[`flags.${SYSTEM_ID}.inventory.regularPool`]: inv.regularPool - weight,
				...(uses === undefined ? {} : { [`flags.${SYSTEM_ID}.inventory.resources.${slug}`]: uses }),
			});
		}),
		setInventoryResource: vi.fn(),
	});
}

describe("having it all along, on the documents", () => {
	async function atCamp() {
		const party = campParty({ aeliana: { carried: {} } });
		const camp = await hostCamp(party.aeliana);
		await joinCamp(party.bram, camp);
		givePack(party.bram);
		return { ...party, camp };
	}

	it("turns an undefined ◇ into a full supplies row, and tells the table", async () => {
		const { bram: b, camp } = await atCamp();
		expect(await haveWhatYouNeedAtCamp(b, HAD_ALL_ALONG.SUPPLIES)).toEqual({ ok: true, row: "supplies", uses: 5 });
		expect(b.typedActor.toggleCarriedItem).toHaveBeenCalledWith("supplies", true, { weight: 1, uses: 5, stonetopMove: "Have What You Need" });
		expect(b.flags[SYSTEM_ID].inventory.resources.supplies).toBe(5);
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
		const bramRow = campMembers(camp.campId, camp.hostId).find(m => m.actorId === "bram");
		expect(bramRow.pack.undefinedMarks).toBe(0);
	});

	// A move-driven write names its move in the ledger (`{ stonetopMove }`).
	it("writes the new uses under Have What You Need's name, for the ledger, in the mark's own write", async () => {
		const { bram: b } = await atCamp();
		await haveWhatYouNeedAtCamp(b, HAD_ALL_ALONG.SUPPLIES);
		// The uses, the carried mark it ticks and the marks it draws are one write, and the move's.
		expect(b.typedActor.toggleCarriedItem).toHaveBeenCalledTimes(1);
		expect(b.typedActor.toggleCarriedItem.mock.calls[0][2]).toMatchObject({ uses: 5, stonetopMove: "Have What You Need" });
		expect(b.typedActor.setInventoryResource).not.toHaveBeenCalled();
	});

	it("shares what it made into the meal, from the window's button", async () => {
		const { bram: b, camp } = await atCamp();
		const win = Object.create(CampWindow.prototype);
		Object.assign(win, { _camp: camp, _writes: Promise.resolve() });
		const hit = { dataset: { campAction: "had-supplies", actorId: "bram" }, disabled: false };
		hit.closest = sel => (sel === "[data-camp-action]" ? hit : null);
		await win._onClick({ target: hit, preventDefault: vi.fn() });
		// Aeliana and Bram eat 1 use each, and neither had any food.
		expect(b.flags[SYSTEM_ID].camp.offer.supplies).toBe(2);
		expect(b.flags[SYSTEM_ID].inventory.resources.supplies).toBe(5);
	});

	it("turns an undefined ◇ into a mess kit the character cooks with", async () => {
		const { bram: b } = await atCamp();
		expect((await haveWhatYouNeedAtCamp(b, HAD_ALL_ALONG.MESS_KIT)).ok).toBe(true);
		const record = b.flags[SYSTEM_ID].camp;
		expect(record.vitals.messKit).toBe(true);
		expect(record.messKit).toBe(true);
	});

	it("does nothing without an undefined ◇, or once the camp is over", async () => {
		const { bram: b, aeliana: a } = await atCamp();
		givePack(b, { pool: 0 });
		expect((await haveWhatYouNeedAtCamp(b, HAD_ALL_ALONG.SUPPLIES)).ok).toBe(false);
		givePack(b, { pool: 1 });
		applyUpdate(a, { [`flags.${SYSTEM_ID}.camp.status`]: "cancelled" });
		expect((await haveWhatYouNeedAtCamp(b, HAD_ALL_ALONG.SUPPLIES)).ok).toBe(false);
		expect(b.typedActor.toggleCarriedItem).not.toHaveBeenCalled();
	});
});
