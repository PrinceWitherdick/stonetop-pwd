import { describe, it, expect, vi } from "vitest";
import { readRepo as read } from "../../fakes/css.js";
import {
	winterDebtState, applyWinterShortfall, winterConsequencesHtml, shortfallNotice,
	winterDebtDialogHtml, winterDebtStepHtml, wireWinterDebtStep,
	WINTER_CONSEQUENCES, WINTER_DEBT_MOVE,
} from "../../../module/actors/steading/winter-debt.js";
import { StonetopSteading, WINTER_DEBT_STEP } from "../../../module/actors/steading/StonetopSteading.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";

// Winter's second bite: "7-9: the steading must consume 1d4+Population more Surplus before
// winter ends, or suffer the consequences again."
//
// The one seasonal obligation that is NOT derivable from state the steading already keeps. It
// is created by a roll, its size is another roll, and it outlives the window it was rolled in,
// so it is the one hold with storage of its own and the one with a control of its own.

describe("winterDebtState", () => {
	it("offers payment when the steading can cover it", () => {
		const s = winterDebtState({ amount: 3, surplus: 5 });
		expect(s.canPay).toBe(true);
		expect(s.owed).toBe(3);
		expect(s.surplus).toBe(5);
	});

	it("offers it on the exact amount, not just above it", () => {
		expect(winterDebtState({ amount: 3, surplus: 3 }).canPay).toBe(true);
	});

	it("names the shortfall when it cannot be covered", () => {
		const s = winterDebtState({ amount: 4, surplus: 1 });
		expect(s.canPay).toBe(false);
		// The shortfall is what the window prints, and it is derived where it is printed:
		// owed minus surplus, from the two numbers stored here.
		expect(s.owed - s.surplus).toBe(3);
	});

	it("reads a debt of nothing as settled, and never as payable", () => {
		const s = winterDebtState({ amount: 0, surplus: 5 });
		expect(s.owed).toBe(0);
		expect(s.canPay).toBe(false);
	});

	// Junk in the flag is the shape a hand-edited world produces; a negative debt must not
	// become a Surplus refund.
	it("floors a garbage amount at zero rather than paying it out", () => {
		expect(winterDebtState({ amount: -2, surplus: 5 }).owed).toBe(0);
		expect(winterDebtState({ amount: "x", surplus: 5 }).owed).toBe(0);
		expect(winterDebtState().owed).toBe(0);
	});
});

// ── The debt on the steading ────────────────────────────────────────────────────
// The stamp is the deadline: it expires by ceasing to match the clock, the way Tor's blessing
// does, so nothing has to remember to sweep it up when the season turns.

// `pickerYear` is the second half of the clock, and it is a SEPARATE argument on purpose: for
// the whole of a completed winter it runs a year ahead of the stamp, which is the state every
// other fixture here quietly declined to model. See the last describe in this file.
function steadingWith({ season = "winter", year = 1, pickerYear = year, winterDebt = null, torsBlessing = null, surplus = 4, steading = {} } = {}) {
	const flags = {
		seasonsCurrent: season ? { season, year } : undefined,
		seasonsCurrentYear: pickerYear,
		steading: { winterDebt, torsBlessing, system: { attributes: { surplus: { value: surplus } } }, ...steading },
	};
	return new StonetopSteading({
		type: "stonetop",
		system: {},
		flags: { "stonetop-pwd": flags },
		getFlag: (scope, key) => (scope === "stonetop-pwd" ? flags[key] ?? null : null),
		setFlag: vi.fn(),
		update: vi.fn(),
	});
}

describe("StonetopSteading#winterDebt", () => {
	it("reads a debt stamped for the season the clock is in", () => {
		const s = steadingWith({ winterDebt: { stamp: "1:winter", amount: 3 } });
		expect(s.winterDebt()).toEqual({ stamp: "1:winter", amount: 3, surplus: 4 });
	});

	// "Before winter ends" is the whole rule. Once the clock has moved on the debt is no longer
	// collectable, and the glyph goes out without anything having swept the flag away.
	it("expires when the clock leaves that winter, without being swept up", () => {
		const held = { stamp: "1:winter", amount: 3 };
		expect(steadingWith({ season: "spring", winterDebt: held }).winterDebt()).toBeNull();
		expect(steadingWith({ season: "winter", year: 2, winterDebt: held }).winterDebt()).toBeNull();
	});

	it("reads nothing on a world whose clock was never stamped", () => {
		expect(steadingWith({ season: "", winterDebt: { stamp: "1:winter", amount: 3 } }).winterDebt()).toBeNull();
	});

	it("treats a zeroed or missing debt as no debt", () => {
		expect(steadingWith({ winterDebt: { stamp: "1:winter", amount: 0 } }).winterDebt()).toBeNull();
		expect(steadingWith({ winterDebt: null }).winterDebt()).toBeNull();
	});

	// Empty rather than a stamp of "undefined": a debt rolled before any Seasons Change has
	// nothing to expire against, and a flag it could never match would be a debt that never
	// shows and never clears.
	it("writes no flag at all when there is no season to stamp against", async () => {
		const unstamped = steadingWith();
		await unstamped.setWinterDebt(3, 1, "");
		expect(unstamped._actor.setFlag).not.toHaveBeenCalled();
		expect(unstamped._actor.update).not.toHaveBeenCalled();

		// Only the keys it changes, each as its own path: the whole steading, rebuilt from the
		// cached flags, put back anything another write changed inside the round trip.
		const stamped = steadingWith();
		await stamped.setWinterDebt(3, 1, "winter");
		expect(stamped._actor.update.mock.calls[0][0]).toMatchObject({
			[`flags.${STONETOP_SCOPE}.steading.winterDebt`]: { stamp: "1:winter", amount: 3 },
		});
	});

	// Once a winter: the roll and the marker that says it was made go out together, so a reopened
	// window cannot roll the debt again (and so bring back one already paid).
	it("closes the once-a-winter step in the same write", async () => {
		const s = steadingWith();
		await s.setWinterDebt(3, 1, "winter");
		const written = s._actor.update.mock.calls[0][0];
		expect(written[`flags.${STONETOP_SCOPE}.steading.seasonSteps`][WINTER_DEBT_STEP]).toBe("1:winter");
	});
});

// ── Winter's end: an unpaid debt comes due in spring ────────────────────────────
// "Before winter ends, or suffer the consequences again." The glyph goes out with the clock, but
// the debt does not lapse: spring's Seasons Change reads it back by the stamp it was rolled under.
describe("StonetopSteading#winterDebtFor", () => {
	const held = { stamp: "1:winter", amount: 3 };

	it("finds last winter's debt from spring, though the clock has left that winter", () => {
		const s = steadingWith({ season: "spring", year: 2, winterDebt: held });
		expect(s.winterDebt()).toBeNull();
		expect(s.winterDebtFor("1:winter")).toEqual({ stamp: "1:winter", amount: 3, surplus: 4 });
	});

	it("finds nothing under any other stamp, nor a settled debt", () => {
		expect(steadingWith({ winterDebt: held }).winterDebtFor("2:winter")).toBeNull();
		expect(steadingWith({ winterDebt: null }).winterDebtFor("1:winter")).toBeNull();
		expect(steadingWith({ winterDebt: { stamp: "1:winter", amount: 0 } }).winterDebtFor("1:winter")).toBeNull();
		expect(steadingWith({ winterDebt: held }).winterDebtFor("")).toBeNull();
	});
});

describe("the Winter's end step", () => {
	it("says winter is over, and offers both ways out", () => {
		const html = winterDebtStepHtml(winterDebtState({ amount: 2, surplus: 5 }));
		expect(html).toContain("Winter has ended");
		expect(html).toContain(`data-action="pay-winter-debt"`);
		for (const c of WINTER_CONSEQUENCES) expect(html).toContain(`data-consequence="${c.id}"`);
		expect(html).toContain("data-winter-debt-settled");
	});

	it("names Meet with Disaster where it used to say only a Fortune", () => {
		expect(winterDebtDialogHtml(winterDebtState({ amount: 4, surplus: 1 }))).toContain("Meets with Disaster");
	});

	it("is opened by spring's Seasons Change, off last winter's stamp", () => {
		const sheet = read("module/actors/steading/StonetopSteadingSheet.js");
		expect(sheet).toContain("const lastWinter = `${year - 1}:winter`;");
		expect(sheet).toContain(`seasonId === "spring" ? this._stonetopSteading.winterDebtFor(lastWinter)`);
		expect(sheet).toContain(`step("winterEnd", "Winter's end"`);
		expect(sheet).toContain("data-season-debt-unpaid");
	});
});

// ── Winter's first consumption, rolled but not yet taken ────────────────────────
// Rolling and taking are two clicks. Kept between them, so closing the window cannot buy a reroll.
describe("StonetopSteading#winterConsumptionRolled", () => {
	const withRolled = winterConsumption => steadingWith({ steading: { winterConsumption } });

	it("reads back the roll made for that winter, a 0 included", () => {
		expect(withRolled({ stamp: "1:winter", amount: 4 }).winterConsumptionRolled(1, "winter")).toBe(4);
		expect(withRolled({ stamp: "1:winter", amount: 0 }).winterConsumptionRolled(1, "winter")).toBe(0);
	});

	it("reads nothing for another winter, or none rolled", () => {
		expect(withRolled({ stamp: "1:winter", amount: 4 }).winterConsumptionRolled(2, "winter")).toBeNull();
		expect(withRolled(undefined).winterConsumptionRolled(1, "winter")).toBeNull();
	});

	it("is resumed on a reopen instead of offering a fresh roll", () => {
		const sheet = read("module/actors/steading/StonetopSteadingSheet.js");
		expect(sheet).toContain("winterConsumptionRolled(year, seasonId)");
		expect(sheet).toContain("setWinterConsumptionRolled(consumption, year, seasonId)");
	});
});

// ── The state every other fixture skipped ───────────────────────────────────────
// Done on a winter does two things in one write: it stamps `{winter, Y}` and it advances the
// PICKER's year to Y+1, because a completed winter closes the year out. So for the whole of
// that winter the two halves of the clock name different years, and a reader that took the
// year from the picker asked for "Y+1:winter" — a key nothing has ever written.
//
// This is not an edge case. It is every winter, from the moment the window that rolled the
// debt is closed, which is to say the entire life of the only season winter's debt exists in.
describe("through a winter whose Done has already run", () => {
	it("still sees a debt rolled in that winter", () => {
		const s = steadingWith({ season: "winter", year: 1, pickerYear: 2, winterDebt: { stamp: "1:winter", amount: 3 } });
		expect(s.winterDebt()).toEqual({ stamp: "1:winter", amount: 3, surplus: 4 });
	});

	// The blessing is stamped the same way and was read back the same way, so it went out the
	// instant the Seasons Change that granted it finished granting it.
	it("still holds a Tor's blessing granted in that winter", () => {
		expect(steadingWith({ season: "winter", year: 1, pickerYear: 2, torsBlessing: "1:winter" }).torsBlessingActive()).toBe(true);
	});

	// The other side of the same coin: the picker running ahead must not resurrect a debt from
	// the winter BEFORE, which the stamp still tells apart.
	it("does not revive last winter's debt", () => {
		expect(steadingWith({ season: "winter", year: 2, pickerYear: 3, winterDebt: { stamp: "1:winter", amount: 3 } }).winterDebt()).toBeNull();
	});
});

describe("applyWinterShortfall", () => {
	function fake({ fortunes = 1, population = 2 } = {}) {
		return {
			getStatValue: k => ({ fortunes, population }[k] ?? 0),
			applyChanges: vi.fn(),
		};
	}
	const written = s => s.applyChanges.mock.calls[0][0].system;

	it("empties the Surplus and takes a Fortune, in one write", async () => {
		const s = fake();
		await applyWinterShortfall(s, "npc");
		expect(s.applyChanges).toHaveBeenCalledTimes(1);
		const [changes, opts] = s.applyChanges.mock.calls[0];
		expect(changes).toEqual({ system: { "attributes.surplus.value": 0, "stats.fortunes.value": 0 }, flags: {} });
		expect(opts.stonetopMove).toBe(WINTER_DEBT_MOVE);
	});

	// The step it closes (winter's `consumption`, or the debt itself) rides the same update.
	it("carries the caller's flags in that one write", async () => {
		const s = fake();
		await applyWinterShortfall(s, "npc", { alsoFlags: { winterDebt: null } });
		expect(s.applyChanges).toHaveBeenCalledTimes(1);
		expect(s.applyChanges.mock.calls[0][0].flags).toEqual({ winterDebt: null });
	});

	it("takes the Population too, but only for the consequence that says so", async () => {
		const s = fake();
		const out = await applyWinterShortfall(s, "population");
		expect(written(s)["attributes.population.value"]).toBe(1);
		expect(out.population).toBe(1);

		const narrative = fake();
		await applyWinterShortfall(narrative, "resource");
		expect(written(narrative)).not.toHaveProperty("attributes.population.value");
	});

	// Both stats bottom out at -1, which is the floor the sheet's own steppers use.
	it("floors Fortunes and Population at -1 rather than running negative", async () => {
		const s = fake({ fortunes: -1, population: -1 });
		const out = await applyWinterShortfall(s, "population");
		expect(out.fortunes).toBe(-1);
		expect(out.population).toBe(-1);
	});

	// "Surplus drops to 0, then the village Meets with Disaster" (Book I p. 518, p. 84). Meet
	// With Disaster at the floor does not lower Fortunes, it has the GM pick a debility instead
	// (p. 532), so the write leaves Fortunes alone and the caller is told the pick is owed.
	it("Meets with Disaster at Fortunes -1: no Fortunes write, and the pick is owed", async () => {
		const s = fake({ fortunes: -1 });
		const out = await applyWinterShortfall(s, "npc", { alsoFlags: { winterDebt: null } });
		expect(out.disaster).toBe(true);
		expect(written(s)).toEqual({ "attributes.surplus.value": 0 });
		// Owed on the steading from this write on, so a pick shut unmade leaves a header glyph.
		expect(s.applyChanges.mock.calls[0][0].flags).toEqual({ winterDebt: null, disasterOwed: { cause: "winter's shortfall", season: null } });
	});

	it("owes no pick above the floor", async () => {
		expect((await applyWinterShortfall(fake({ fortunes: 0 }), "npc")).disaster).toBe(false);
	});

	it("says which of the two happened", () => {
		expect(shortfallNotice({ fortunes: 0, population: null, disaster: false })).toContain("Fortunes to +0");
		expect(shortfallNotice({ fortunes: -1, population: 1, disaster: true })).toContain("Meets with Disaster");
		expect(shortfallNotice({ fortunes: -1, population: 1, disaster: true })).toContain("Population to +1");
	});

	// Every window that takes a shortfall goes through the one helper that opens the pick.
	it("opens the Meet with Disaster pick from every window that takes a shortfall", () => {
		const src = read("module/actors/steading/winter-debt.js");
		const at = src.indexOf("export async function sufferWinterShortfall");
		expect(src.slice(at, at + 700)).toContain("if (out.disaster)");
		expect(src.slice(at, at + 700)).toContain("openDisasterPicker(");
		expect(src).toContain("await sufferWinterShortfall(steading, consequenceId");
		expect(read("module/actors/steading/StonetopSteadingSheet.js")).toContain("await sufferWinterShortfall(this._stonetopSteading");
	});

	// The dialog stays open while the sheet behind it changes, so the arithmetic has to be done
	// against what the steading holds NOW, not against a value captured when a window opened.
	it("reads the stats live rather than being handed them", async () => {
		const src = read("module/actors/steading/winter-debt.js");
		const at = src.indexOf("export async function applyWinterShortfall");
		expect(src.slice(at, at + 600)).toContain('steading.getStatValue("fortunes")');
	});
});

describe("how the debt is wired", () => {
	const DEBT = read("module/actors/steading/winter-debt.js");
	const STEADING = read("module/actors/steading/StonetopSteading.js");
	const SHEET = read("module/actors/steading/StonetopSteadingSheet.js");

	// The dialog cannot read the roll's tier: the +Fortunes roll is posted to chat, and the
	// same roll can be made from the Moves tab or handed to a player. So recording the debt is
	// a deliberate GM button, like every other mechanical effect in that walkthrough.
	it("is recorded by a button in the Seasons Change window, not inferred from the roll", () => {
		expect(SHEET).toContain(`data-action="record-winter-debt"`);
		expect(SHEET).toContain("setWinterDebt(owed, year, seasonId)");
	});

	// The same builder the first consumption uses, so a Township's 2d6 and Additional Housing's
	// lower Population reach winter's second bite too. `second: true` is what withholds the Stone
	// Wall's flat −1 from it; see the note on winterConsumption for why one wall must not pay
	// twice for one winter.
	it("rolls what the first consumption rolls, off the same builder", () => {
		const at = SHEET.indexOf("record-winter-debt']");
		expect(at).toBeGreaterThan(-1);
		const body = SHEET.slice(at, at + 2000);
		expect(body).toContain("const { formula } = winterAgainNow();");
	});

	// This button sits BELOW the shortfall list in the same window, and taking "Population loss"
	// there is the likeliest route to needing it — so the Population it rolls has to be the one
	// the steading has NOW, not the one captured when the window opened.
	it("reads Population live, not off the value the window opened with", () => {
		const at = SHEET.indexOf("const winterAgainNow = () => winterConsumption({");
		expect(at).toBeGreaterThan(-1);
		expect(SHEET.slice(at, at + 300)).toContain(`population: this._stonetopSteading.getStatValue("population"), rules, size, second: true`);
	});

	// A roll of 0 is a real outcome at Population -1, and a debt of nothing is not a debt.
	it("records nothing when the roll comes up zero", () => {
		const at = SHEET.indexOf("record-winter-debt']");
		expect(SHEET.slice(at, at + 2200)).toContain("if (!owed)");
	});

	it("is rolled once a winter", () => {
		expect(SHEET).toContain("_disableIfSeasonStepDone(winterDebtBtn, WINTER_DEBT_STEP, year, seasonId)");
	});

	it("is settled from the header glyph, which is the only way back to it", () => {
		// Dispatched from the shared hold-action map, keyed by the `action` HOLD_DEFS declares.
		expect(SHEET).toContain(`"settle-winter-debt":`);
		expect(SHEET).toContain("openWinterDebtDialog(this._stonetopSteading");
	});

	// Spend and clear ride ONE update, so the ledger names Seasons Change once rather than
	// carding the Surplus and the settled debt separately.
	it("pays and clears in a single write", () => {
		expect(DEBT).toContain("alsoFlags: { winterDebt: null }");
		const at = STEADING.indexOf("async spendSurplus(");
		expect(STEADING.slice(at, at + 600)).toContain("...alsoFlags");
	});

	it("has art, a mask rule and a credit, like every other hold", () => {
		expect(read("assets/icons/holds/winter-debt.svg")).toContain("<svg");
		expect(read("styles/stonetop.css")).toContain("steading-hold--winter-debt");
		expect(read("assets/icons/holds/ATTRIBUTION.md")).toContain("winter-debt.svg");
	});
});

// ── Two windows on one debt ─────────────────────────────────────────────────────
// Spring's "Winter's end" and the header glyph's window can both be open on the same debt. The
// one pressed second must find it settled, never pay it or take its shortfall a second time.
describe("settling the debt from spring's step", () => {
	function stepRoot() {
		const listeners = new Map();
		const el = key => ({
			hidden: false,
			dataset: key.startsWith("consequence:") ? { consequence: key.split(":")[1] } : {},
			addEventListener: (type, fn) => listeners.set(key, fn),
		});
		const pay = el("pay"), npc = el("consequence:npc"), open = { hidden: false,
			querySelector: sel => (sel === "[data-action='pay-winter-debt']" ? pay : null),
			querySelectorAll: () => [npc],
		};
		const settled = { hidden: true };
		return {
			open, settled,
			click: key => listeners.get(key)(),
			querySelector: sel => (sel === "[data-winter-debt-open]" ? open : sel === "[data-winter-debt-settled]" ? settled : null),
		};
	}
	function steading({ debt = { stamp: "1:winter", amount: 3, surplus: 5 } } = {}) {
		return {
			winterDebtFor: vi.fn(stamp => (debt && stamp === debt.stamp ? debt : null)),
			spendSurplus: vi.fn(async amount => 5 - amount),
			getStatValue: () => 1,
			applyChanges: vi.fn(),
		};
	}

	it("pays what stands at the click, by the debt's stamp", async () => {
		const root = stepRoot(), s = steading({ debt: { stamp: "1:winter", amount: 4, surplus: 5 } });
		const onSettled = vi.fn();
		wireWinterDebtStep(root, s, { stamp: "1:winter", onSettled });
		await root.click("pay");
		expect(s.winterDebtFor).toHaveBeenCalledWith("1:winter");
		expect(s.spendSurplus).toHaveBeenCalledWith(4, expect.objectContaining({ alsoFlags: { winterDebt: null } }));
		expect(root.open.hidden).toBe(true);
		expect(onSettled).toHaveBeenCalledTimes(1);
	});

	it("charges nothing for a debt the other window already settled", async () => {
		const root = stepRoot(), s = steading({ debt: null });
		wireWinterDebtStep(root, s, { stamp: "1:winter" });
		await root.click("pay");
		expect(s.spendSurplus).not.toHaveBeenCalled();
		expect(root.open.hidden).toBe(true);

		const again = stepRoot(), t = steading({ debt: null });
		wireWinterDebtStep(again, t, { stamp: "1:winter" });
		await again.click("consequence:npc");
		expect(t.applyChanges).not.toHaveBeenCalled();
	});

	it("is wired with the stamp, not the amount the window opened with", () => {
		expect(read("module/actors/steading/StonetopSteadingSheet.js")).toContain("stamp: lastWinter,");
		expect(read("module/actors/steading/winter-debt.js")).toContain("await payWinterDebt(steading, held.stamp)");
	});
});

describe("the shared winter consequences", () => {
	// They used to be a hand-written list of <li>s inside the season dialog. The debt asks the
	// same question with the same four answers some sessions later, and a second copy of a
	// rules list is how two windows start disagreeing about what a bad winter costs.
	it("is one table, read by both the season window and the settle window", () => {
		expect(WINTER_CONSEQUENCES.map(c => c.id)).toEqual(["population", "resource", "npc", "pc"]);
		expect(read("module/actors/steading/StonetopSteadingSheet.js")).toContain("winterConsequencesHtml()");
	});

	it("leaves no hand-written copy behind in the season dialog", () => {
		const sheet = read("module/actors/steading/StonetopSteadingSheet.js");
		expect(sheet).not.toContain(`<span class="stonetop-disaster-choice-label">Population loss</span>`);
	});

	it("renders the hook both windows' listeners bind to", () => {
		const html = winterConsequencesHtml();
		for (const c of WINTER_CONSEQUENCES) expect(html).toContain(`data-consequence="${c.id}"`);
		expect(html).toContain("stonetop-disaster-choices");
	});
});
