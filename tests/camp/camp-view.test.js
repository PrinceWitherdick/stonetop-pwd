import { describe, expect, it } from "vitest";
import { CAMP_STATE, SETTLE_REFUSAL, campLedger, freezeCampPlan } from "../../module/camp/camp-rules.js";
import {
	campCardClosedText, campJoinCardBody, campSummaryRows, campWindowView, closedCampNotice, departedCampNotice,
	settleRefusalText,
} from "../../module/camp/camp-view.js";
import { seat } from "../fakes/camp.js";

/**
 * What a camp says: to the table on its cards, and to each reader in its window. The arithmetic
 * underneath is camp-rules.test.js's; these check the sentences it turns into and who gets
 * controls rather than sentences.
 */

const aeliana = (over = {}) => seat({ id: "aeliana", name: "Aeliana", isHost: true, joinedAt: 1, ...over });
const bram    = (over = {}) => seat({ id: "bram", name: "Bram", joinedAt: 2, carried: {}, ...over });
const cora    = (over = {}) => seat({ id: "cora", name: "Cora", joinedAt: 3, carried: {}, ...over });

const view = (members, over = {}) => campWindowView({
	state: CAMP_STATE.OPEN, hostName: "Aeliana", ledger: campLedger(members), manages: true,
	editable: ["aeliana"], mine: ["aeliana"], ...over,
});

// ── the cards ────────────────────────────────────────────────────────────────

describe("the join card", () => {
	it("names the host, safely", () => {
		expect(campJoinCardBody("<b>Aeliana</b>")).toContain("<strong>&lt;b&gt;Aeliana&lt;/b&gt;</strong> is making camp.");
	});

	// Foundry's sanitizer strips a bare `data-camp-join`, and the wiring would never find the slot.
	it("marks its button's slot with a valued attribute the sanitizer keeps", () => {
		const body = campJoinCardBody("Aeliana");
		expect(body).toMatch(/data-camp-join="1"/);
		expect(body).toContain('class="stonetop-camp-join"');
	});

	it("says how the camp ended once it is over", () => {
		expect(campCardClosedText(CAMP_STATE.SETTLED, "Aeliana")).toBe("Aeliana's camp ate and settled in for the night.");
		expect(campCardClosedText(CAMP_STATE.CANCELLED, "Aeliana")).toBe("Aeliana's camp broke up before anyone ate.");
		expect(campCardClosedText(CAMP_STATE.COLD, "Aeliana")).toBe("Aeliana's camp was left without anyone eating.");
		expect(campCardClosedText(CAMP_STATE.GONE, undefined)).toBe("This camp is over.");
	});

	// The summary card has just told everyone how the night went.
	it("closes a settled camp's window without a second telling", () => {
		expect(closedCampNotice(CAMP_STATE.SETTLED, "Aeliana")).toBeNull();
		expect(closedCampNotice(CAMP_STATE.CANCELLED, "Aeliana")).toBe("Aeliana's camp broke up. Nothing was eaten or spent.");
	});

	it("tells whoever pressed Make Camp too early what the camp is waiting for", () => {
		expect(settleRefusalText(SETTLE_REFUSAL.SHORT)).toBe("Not everyone eating has food yet. Share more, or mark who goes without.");
	});
});

describe("the settled camp's card", () => {
	it("says what the meal cost, whose food paid, and what each person took from the night", () => {
		const ledger = campLedger([
			aeliana({ choices: { offer: { supplies: 1 } } }),
			bram({ carried: { provisions: 3 }, hp: 10, maxHp: 10, marked: ["dazed"], choices: { offer: { provisions: 1 }, benefit: "debility", debility: "dazed" } }),
			cora({ choices: { eats: false } }),
		]);
		expect(campSummaryRows(ledger, freezeCampPlan(ledger))).toEqual([
			{ label: "The meal", value: "2 fed on 2 uses of food." },
			{ label: "From Aeliana's pack", value: "1 use of supplies" },
			{ label: "From Bram's pack", value: "1 use of provisions" },
			{ label: "Aeliana", value: "HP 4 → 12 (half max)." },
			{ label: "Bram", value: "Cleared Dazed." },
			{ label: "Cora", value: "Went without food, so took no pick tonight." },
		]);
	});

	// Post-death audit: a Thrall's Marks on the settled card.
	it("says a Ravenous Thrall's extra, whose nightmares troubled whom, and a slow healer's halving", () => {
		const rook = { ...bram({ name: "Rook", choices: { hunger: 2 } }), ravenous: true, nightmarish: true, slowToHeal: true };
		const ledger = campLedger([aeliana({ choices: { offer: { supplies: 4 } } }), rook]);
		const rows = campSummaryRows(ledger, freezeCampPlan(ledger));
		expect(rows[0].value).toBe("2 fed on 4 uses of food. Ravenous: Rook eats 2 extra uses (1d4).");
		expect(rows.find(r => r.label === "The night").value)
			.toBe("Quicksilver Dreams: everyone with Rook suffers nightmares and has disadvantage on their next roll.");
		expect(rows.find(r => r.label === "Aeliana").value)
			.toBe("HP 4 → 12 (half max); nightmares from Rook's Quicksilver Dreams, so disadvantage is held for the next roll.");
		expect(rows.find(r => r.label === "Rook").value)
			.toBe("HP 4 → 12 (half max); Torment's Blessing recovers only half of that, rounded up, HP 4 → 8.");
	});

	it("names the mess kit that stretched the meal", () => {
		const ledger = campLedger([aeliana({ carriesMessKit: true, choices: { messKit: true, followers: 4, offer: { supplies: 2 } } })]);
		expect(campSummaryRows(ledger, freezeCampPlan(ledger))[0].value).toBe("5 fed on 2 uses of food, cooked in Aeliana's mess kit.");
	});

	it("adds the bedroll and the peaceful night to the pick", () => {
		const ledger = campLedger([aeliana({ carriesBedroll: true, choices: { offer: { supplies: 1 }, bedroll: true, peaceful: true } })]);
		const plan = freezeCampPlan(ledger, { bedrolls: { aeliana: 5 } });
		expect(campSummaryRows(ledger, plan).at(-1).value)
			.toBe("HP 4 → 12 (half max); bedroll rolled 5, HP 12 → 15; a peaceful night, so advantage is held for the next roll.");
	});

	it("says the fur-lined bedroll's advantage is held, beside a peaceful night's", () => {
		const ledger = campLedger([aeliana({ carriesFurBedroll: true, choices: { offer: { supplies: 1 }, bedroll: true, peaceful: true } })]);
		const plan = freezeCampPlan(ledger, { bedrolls: { aeliana: 2 } });
		expect(campSummaryRows(ledger, plan).at(-1).value)
			.toBe("HP 4 → 12 (half max); bedroll rolled 2, HP 12 → 14; a peaceful night, so advantage is held for the next roll; slept in the fur-lined bedroll, so advantage is held for the next roll.");
	});

	it("adds Break Bread after the bedroll, and names the proper meal", () => {
		const ledger = campLedger([
			aeliana({ breaksBread: true, carriesBedroll: true, choices: { offer: { supplies: 2 }, bedroll: true } }),
			bram({ choices: { benefit: "none" } }),
		]);
		const rows = campSummaryRows(ledger, freezeCampPlan(ledger, { bedrolls: { aeliana: 1 }, breads: { aeliana: 6, bram: 2 } }));
		expect(rows[0].value).toBe("2 fed on 2 uses of food. A proper meal (Break Bread).");
		expect(rows.find(r => r.label === "Aeliana").value)
			.toBe("HP 4 → 12 (half max); bedroll rolled 1, HP 12 → 13; Break Bread rolled 6, HP 13 → 15.");
		expect(rows.find(r => r.label === "Bram").value)
			.toBe("Ate, but got no real sleep, so took no pick tonight; Break Bread rolled 2, HP 4 → 6.");
	});

	it("names the hearth ash on its own row, and adds the home fires' HP to everyone who made camp", () => {
		const ledger = campLedger([
			// A follower eats with Aeliana, so her Break Bread has someone to be shared with.
			aeliana({ breaksBread: true, choices: { offer: { supplies: 2 }, followers: 1 } }),
			bram({ hearthCha: 2, choices: { eats: false } }),
		]);
		const rows = campSummaryRows(ledger, freezeCampPlan(ledger, { breads: { aeliana: 1 } }));
		expect(rows[1]).toEqual({
			label: "The fire",
			value: "Ash from Bram's hearth (Keep the Home-Fires Burning): everyone making camp here is free from nightmares or bad dreams and recovers 2 extra HP.",
		});
		expect(rows.find(r => r.label === "Aeliana").value)
			.toBe("HP 4 → 12 (half max); Break Bread rolled 1, HP 12 → 13; the home fires gave 2 extra HP, HP 13 → 15.");
		expect(rows.find(r => r.label === "Bram").value)
			.toBe("Went without food, so took no pick tonight; the home fires gave 2 extra HP, HP 4 → 6.");
	});

	it("says nothing of the fire once the host unticks the hearth ash, and still speaks of nightmares at CHA 0", () => {
		const unticked = campLedger([aeliana({ hearthCha: 2, choices: { offer: { supplies: 1 }, hearthAsh: false } })]);
		expect(campSummaryRows(unticked, freezeCampPlan(unticked)).map(r => r.label)).not.toContain("The fire");
		const plain = campLedger([aeliana({ hearthCha: 0, choices: { offer: { supplies: 1 } } })]);
		expect(campSummaryRows(plain, freezeCampPlan(plain))[1].value)
			.toBe("Ash from Aeliana's hearth (Keep the Home-Fires Burning): everyone making camp here is free from nightmares or bad dreams.");
	});

	it("names the background track a camp cleared", () => {
		const circle = [{ key: "auspicious-birth", name: "Auspicious Birth's background circle" }];
		const ledger = campLedger([aeliana({ clearsTonight: circle, choices: { offer: { supplies: 1 } } }), bram({ clearsTonight: circle, choices: { eats: false } })]);
		const rows = campSummaryRows(ledger, freezeCampPlan(ledger));
		expect(rows.find(r => r.label === "Aeliana").value).toBe("HP 4 → 12 (half max); cleared Auspicious Birth's background circle.");
		expect(rows.find(r => r.label === "Bram").value).toBe("Went without food, so took no pick tonight; cleared Auspicious Birth's background circle.");
	});

	it("says so when there was no healing left to do", () => {
		const ledger = campLedger([aeliana({ hp: 15, choices: { offer: { supplies: 1 } } })]);
		expect(campSummaryRows(ledger, freezeCampPlan(ledger)).at(-1).value).toBe("HP already full at 15.");
	});

	it("tells a sleepless night and an Unliving guest apart from going hungry", () => {
		const ledger = campLedger([
			aeliana({ choices: { offer: { supplies: 1 }, benefit: "none" } }),
			bram({ unliving: true }),
		]);
		const rows = campSummaryRows(ledger, freezeCampPlan(ledger));
		expect(rows.find(r => r.label === "Aeliana").value).toBe("Ate, but got no real sleep, so took no pick tonight.");
		expect(rows.find(r => r.label === "Bram").value).toBe("Needs no food or sleep, and took nothing from the night.");
	});
});

// ── the window ───────────────────────────────────────────────────────────────

describe("the camp window's rows", () => {
	it("gives the reader controls on their own row and sentences on everyone else's", () => {
		const rows = view([
			aeliana({ choices: { offer: { supplies: 1 } } }),
			bram({ carried: { provisions: 3 }, marked: ["dazed"], choices: { offer: { provisions: 1 }, benefit: "debility", debility: "dazed" } }),
		]).rows;
		expect(rows[0]).toMatchObject({ canEdit: true, isMine: true, says: [] });
		expect(rows[1]).toMatchObject({ canEdit: false, isMine: false });
		expect(rows[1].says).toEqual(["Sharing 1 use of provisions.", "Eating tonight.", "Clearing Dazed."]);
	});

	it("stops offering more food once the meal is paid for", () => {
		const [row] = view([aeliana({ choices: { offer: { supplies: 1 } } })]).rows;
		expect(row.purses[0]).toMatchObject({ n: 1, canAdd: false, canTake: true });
	});

	it("has nothing to take back from a purse nothing was shared from", () => {
		const [row] = view([aeliana()]).rows;
		expect(row.purses[0]).toMatchObject({ n: 0, canAdd: true, canTake: false });
	});

	it("offers to cover the rest of the meal, or as much of it as the pack can", () => {
		expect(view([aeliana({ carried: { supplies: 5 } }), bram(), cora()]).rows[0].cover)
			.toEqual({ show: true, label: "Cover the last 3 uses" });
		expect(view([aeliana({ carried: { supplies: 1 } }), bram(), cora()]).rows[0].cover)
			.toEqual({ show: true, label: "Share the 1 use still in this pack" });
	});

	it("says when some of what a row shared will go back into the pack", () => {
		expect(view([aeliana({ choices: { offer: { supplies: 3 } } })]).rows[0].givesBackText)
			.toBe("2 uses shared here stay in the pack: the meal is already paid for.");
	});

	it("heads the host's row with the camp, and every other row with whether they are ready", () => {
		const rows = view([aeliana(), bram({ choices: { ready: true } }), cora()]).rows;
		expect(rows.map(r => r.stateText)).toEqual(["Making camp", "Ready", "Still choosing"]);
		// The host settles the camp, so has no ready tick to give, but can still go without.
		expect(rows[0]).toMatchObject({ showFoot: true, showReady: false });
		expect(rows[1]).toMatchObject({ showFoot: true, showReady: true, stateClass: "is-ready" });
	});

	// Book I p.335: no food, so no pick from the night. The seat, the share and the followers stay.
	it("keeps a row going without at the fire, marked, with no night to pick", () => {
		const rows = view([
			aeliana({ choices: { offer: { supplies: 2 } } }),
			bram({ choices: { eats: false, followers: 1 } }),
		], { editable: ["aeliana", "bram"] }).rows;
		expect(rows[0]).toMatchObject({ goesWithout: false, readyLabel: "Ready to eat and rest", night: { show: true } });
		expect(rows[1]).toMatchObject({ goesWithout: true, readyLabel: "Ready to settle in", night: { show: false }, showFoot: true, followers: 1 });
	});

	it("says a row is going without once, in its mark, and names only who still eats with them", () => {
		const rows = view([aeliana(), bram({ choices: { eats: false, followers: 2 } }), cora({ choices: { eats: false } })]).rows;
		expect(rows[1].says).toEqual(["Sharing no food yet.", "2 followers eat tonight."]);
		expect(rows[2].says).toEqual(["Sharing no food yet."]);
	});

	it("gives the Unliving no meal to go without, and an Unliving host no foot", () => {
		const rows = view([aeliana({ unliving: true }), bram({ unliving: true })]).rows;
		expect(rows[0]).toMatchObject({ goesWithout: false, showFoot: false });
		expect(rows[1]).toMatchObject({ goesWithout: false, showFoot: true, showReady: true, readyLabel: "Ready to settle in" });
	});

	it("picks healing when the debility the row chose is no longer marked", () => {
		const [row] = view([aeliana({ choices: { benefit: "debility", debility: "dazed" } })]).rows;
		expect(row.night).toMatchObject({ hp: true, debility: false, hasDebilities: false, hpBefore: 4, hpAfter: 12 });
	});

	// Settling clears whichever one this names (camp-rules.js#debilityToClear), so no row may say another.
	it("names the first marked debility when the row's choice names none still marked", () => {
		const rows = view([
			aeliana({ marked: ["weakened"], choices: { benefit: "debility", debility: "" } }),
			bram({ marked: ["weakened"], choices: { benefit: "debility", debility: "dazed" } }),
		]).rows;
		expect(rows[0].night.debilities).toEqual([{ key: "weakened", name: "Weakened", selected: true }]);
		expect(rows[1].says).toContain("Clearing Weakened.");
	});

	it("gives each row its own set of night radios", () => {
		const rows = view([aeliana(), bram()], { editable: ["aeliana", "bram"] }).rows;
		expect(rows.map(r => r.night.radioName)).toEqual(["campBenefit-aeliana", "campBenefit-bram"]);
	});
});

describe("the camp window's roster", () => {
	it("lets a GM send away anyone at the fire but the host", () => {
		expect(view([aeliana(), bram(), cora()], { sendsAway: true }).sendAway)
			.toEqual({ show: true, options: [{ id: "bram", name: "Bram" }, { id: "cora", name: "Cora" }] });
	});

	it("offers nobody else the list, nor a camp of only its host, nor a camp that is over", () => {
		expect(view([aeliana(), bram()]).sendAway.show).toBe(false);
		expect(view([aeliana()], { sendsAway: true }).sendAway.show).toBe(false);
		expect(view([aeliana(), bram()], { sendsAway: true, state: CAMP_STATE.SETTLED }).sendAway.show).toBe(false);
	});

	it("puts Bring someone and Send them away on one line, shown while either has anyone to list", () => {
		expect(view([aeliana(), bram()], { sendsAway: true }).roster.show).toBe(true);
		expect(view([aeliana()], { addable: [{ id: "cora", name: "Cora" }] }).roster.show).toBe(true);
		expect(view([aeliana()], { sendsAway: true }).roster.show).toBe(false);
		expect(view([aeliana(), bram()], { sendsAway: true, state: CAMP_STATE.SETTLED }).roster.show).toBe(false);
	});

	it("tells a player whose window closed who was taken from the fire", () => {
		expect(departedCampNotice(["Bram"], "Aeliana")).toBe("Bram is no longer at Aeliana's camp.");
		expect(departedCampNotice(["Bram", "Cora"], "")).toBe("Bram & Cora are no longer at the camp.");
	});
});

describe("the camp window's meal", () => {
	it("says how short the meal is and what to do about it", () => {
		expect(view([aeliana()]).meal).toEqual({
			mouthsText: "1 to feed.",
			cookText:   "With no mess kit, each use feeds 1.",
			costText:   "The meal costs 1 use of food, and 0 have been shared.",
			statusText: "1 more use needed. Share more food, decide someone had supplies all along, or mark who goes without.",
			forageText: "Or Forage first: a few hours seeking food in the wild, rolling +WIS.",
			afterText:  "",
			provisionsText: "",
			hungerText: "",
			nightmaresText: "",
			isShort:    true,
			isPaid:     false,
		});
	});

	// Post-death audit: a Thrall's Ravenous and Quicksilver Dreams, said where the bill and the night are.
	it("says a Ravenous Thrall's rolled extra, and whose Quicksilver Dreams trouble the night", () => {
		const rook = { ...bram({ name: "Rook", choices: { hunger: 2 } }), ravenous: true, nightmarish: true };
		const { meal } = view([aeliana(), rook]);
		expect(meal.costText).toBe("The meal costs 4 uses of food, and 0 have been shared.");
		expect(meal.hungerText).toBe("Ravenous: Rook eats 2 extra uses (1d4).");
		expect(meal.nightmaresText).toBe("Quicksilver Dreams: everyone with Rook suffers nightmares and has disadvantage on their next roll.");
		const warded = view([aeliana({ hearthCha: 1 }), rook]).meal.nightmaresText;
		expect(warded).toBe("Quicksilver Dreams: the ash from Aeliana's hearth keeps Rook's nightmares from everyone here.");
	});

	it("shows a slow healer's night halved on their card", () => {
		const night = view([{ ...aeliana(), slowToHeal: true }]).rows[0].night;
		// 4 of 15: half max would reach 12; Torment's Blessing recovers 4 of those 8.
		expect(night).toMatchObject({ hpBefore: 4, hpAfter: 8, halvedText: "(halved: Torment's Blessing)" });
	});

	// The settle restores a dying character none of their own HP (camp-rules.js#freezeCampPlan), so
	// their card must not promise the pick's HP, a bedroll's die or a peaceful night's advantage.
	it("promises a dying character no HP from the pick, and offers no bedroll or peaceful night", () => {
		const dying = { ...aeliana({ hp: 0, carriesBedroll: true, choices: { bedroll: true, peaceful: true } }), dying: true };
		const row = view([dying]).rows[0];
		expect(row.night).toMatchObject({ hpBefore: 0, hpAfter: 0, halvedText: "" });
		expect(row.night.dyingText).toContain("Dying, so the night itself restores no HP");
		expect(row.bedroll.carries).toBe(false);
		expect(row.showPeaceful).toBe(false);
		const read = view([dying], { editable: [] }).rows[0].says.join(" ");
		expect(read).toContain("Dying, so the night itself restores no HP");
		expect(read).not.toMatch(/Regaining HP|bedroll|peaceful/);
		// Up and about, the same card promises all three.
		const up = view([aeliana({ hp: 0, carriesBedroll: true })]).rows[0];
		expect(up).toMatchObject({ night: { hpAfter: 8, dyingText: "" }, bedroll: { carries: true }, showPeaceful: true });
	});

	it("counts the followers apart from the people at the fire", () => {
		expect(view([aeliana({ choices: { followers: 2 } })]).meal.mouthsText).toBe("3 to feed: 1 at the fire and 2 followers.");
	});

	it("says a meal with food to spare is paid for, and that the spare is kept", () => {
		expect(view([aeliana({ choices: { offer: { supplies: 3 } } })]).meal)
			.toMatchObject({ statusText: "Paid for, with 2 to spare. Only what the meal needs is eaten, and the rest stays in the packs.", isPaid: true });
	});
});

describe("the camp window's Break Bread box", () => {
	const paid = (over = {}) => aeliana({ ...over, choices: { offer: { supplies: 2 }, ...over.choices } });

	it("shows, ticked, once the meal is paid and someone eating has Break Bread learned", () => {
		expect(view([paid(), bram({ breaksBread: true })]).breakBread).toMatchObject({
			show: true, canTick: true, hostId: "aeliana", ticked: true,
			label: "A proper meal (Break Bread): everyone eating their fill recovers 1d8 extra HP",
		});
	});

	it("stays hidden with nobody holding it, or while the meal is short", () => {
		expect(view([paid(), bram()]).breakBread.show).toBe(false);
		expect(view([aeliana({ breaksBread: true }), bram()]).breakBread.show).toBe(false);
	});

	it("shows unticked once the host unticks it", () => {
		expect(view([paid({ breaksBread: true, choices: { properMeal: false } }), bram()]).breakBread.ticked).toBe(false);
	});

	it("is a sentence for a reader who does not settle the camp", () => {
		const box = view([paid({ breaksBread: true }), bram()], { manages: false }).breakBread;
		expect(box).toMatchObject({ show: true, canTick: false, says: "A proper meal (Break Bread): everyone eating recovers 1d8 extra HP." });
	});
});

describe("the camp window's hearth-ash box (Keep the Home-Fires Burning)", () => {
	it("shows, ticked, whenever someone at the fire has the move learned, with their CHA in it", () => {
		expect(view([aeliana(), bram({ hearthCha: 2 })]).homeFires).toMatchObject({
			show: true, canTick: true, hostId: "aeliana", ticked: true,
			label: "Ash from your own hearth (Keep the Home-Fires Burning): everyone making camp here is free from nightmares or bad dreams and recovers 2 extra HP",
			holders: "Bram has Keep the Home-Fires Burning. Untick this if the fire is not sprinkled with ash from their own hearth.",
		});
	});

	it("stays hidden with nobody holding it", () => {
		expect(view([aeliana(), bram()]).homeFires.show).toBe(false);
	});

	it("shows unticked once the host unticks it, and is a sentence for a reader who does not settle the camp", () => {
		expect(view([aeliana({ hearthCha: 1, choices: { hearthAsh: false } })]).homeFires.ticked).toBe(false);
		expect(view([aeliana(), bram({ hearthCha: 2 })], { manages: false }).homeFires).toMatchObject({
			show: true, canTick: false,
			says: "Ash from Bram's hearth: everyone making camp here is free from nightmares or bad dreams and recovers 2 extra HP.",
		});
	});
});

describe("the camp window's footer", () => {
	it("holds Make Camp while anyone eating has no food", () => {
		expect(view([aeliana()]).nav).toEqual({
			manages: true, canSettle: false, hint: "Make Camp waits until everyone eating has food.",
			blocked: "The meal is 1 use of food short. Share more food, decide someone had supplies all along, or press Go without on the card of anyone not eating.",
		});
	});

	it("names who is still choosing", () => {
		const nav = view([aeliana({ choices: { offer: { supplies: 3 } } }), bram(), cora()]).nav;
		expect(nav).toEqual({ manages: true, canSettle: true, hint: "Still choosing: Bram & Cora.", blocked: "" });
	});

	it("tells a player who cannot settle the camp who will", () => {
		expect(view([aeliana(), bram()], { manages: false, editable: ["bram"], mine: ["bram"] }).nav)
			.toEqual({ manages: false, canSettle: false, hint: "Aeliana makes camp once everyone is ready.", blocked: "" });
	});

	it("draws a camp that is over as over", () => {
		const closed = view([aeliana()], { state: CAMP_STATE.SETTLED, addable: [{ id: "cora", name: "Cora" }] });
		expect(closed).toMatchObject({ isOpen: false, closedText: "Aeliana's camp ate and settled in for the night.", add: { show: false } });
		expect(closed.rows[0].canEdit).toBe(false);
		expect(closed.nav.canSettle).toBe(false);
		expect(closed.nav.blocked).toBe("That camp is no longer open.");
	});
});
