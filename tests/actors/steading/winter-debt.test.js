import { describe, it, expect, vi } from "vitest";
import { readRepo as read } from "../../fakes/css.js";
import {
	winterDebtState, applyWinterShortfall, winterConsequencesHtml,
	WINTER_CONSEQUENCES, WINTER_DEBT_MOVE,
} from "../../../module/actors/steading/winter-debt.js";
import { StonetopSteading } from "../../../module/actors/steading/StonetopSteading.js";
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
function steadingWith({ season = "winter", year = 1, pickerYear = year, winterDebt = null, torsBlessing = null, surplus = 4 } = {}) {
	const flags = {
		seasonsCurrent: season ? { season, year } : undefined,
		seasonsCurrentYear: pickerYear,
		steading: { winterDebt, torsBlessing, system: { attributes: { surplus: { value: surplus } } } },
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
		expect(s.winterDebt()).toEqual({ amount: 3, surplus: 4 });
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

		const stamped = steadingWith();
		await stamped.setWinterDebt(3, 1, "winter");
		expect(stamped._actor.setFlag).toHaveBeenCalledWith(
			STONETOP_SCOPE, "steading",
			expect.objectContaining({ winterDebt: { stamp: "1:winter", amount: 3 } }));
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
		expect(s.winterDebt()).toEqual({ amount: 3, surplus: 4 });
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
			setSystemValues: vi.fn(),
		};
	}

	it("empties the Surplus and takes a Fortune, in one write", async () => {
		const s = fake();
		await applyWinterShortfall(s, "npc");
		expect(s.setSystemValues).toHaveBeenCalledTimes(1);
		const [updates, opts] = s.setSystemValues.mock.calls[0];
		expect(updates).toEqual({ "attributes.surplus.value": 0, "stats.fortunes.value": 0 });
		expect(opts.stonetopMove).toBe(WINTER_DEBT_MOVE);
	});

	it("takes the Population too, but only for the consequence that says so", async () => {
		const s = fake();
		const out = await applyWinterShortfall(s, "population");
		expect(s.setSystemValues.mock.calls[0][0]["attributes.population.value"]).toBe(1);
		expect(out.population).toBe(1);

		const narrative = fake();
		await applyWinterShortfall(narrative, "resource");
		expect(narrative.setSystemValues.mock.calls[0][0]).not.toHaveProperty("attributes.population.value");
	});

	// Both stats bottom out at -1, which is the floor the sheet's own steppers use.
	it("floors Fortunes and Population at -1 rather than running negative", async () => {
		const s = fake({ fortunes: -1, population: -1 });
		const out = await applyWinterShortfall(s, "population");
		expect(out.fortunes).toBe(-1);
		expect(out.population).toBe(-1);
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
		expect(body).toContain("winterConsumption({ population: pop, has, second: true })");
	});

	// This button sits BELOW the shortfall list in the same window, and taking "Population loss"
	// there is the likeliest route to needing it — so the Population it rolls has to be the one
	// the steading has NOW, not the one captured when the window opened.
	it("reads Population live, not off the value the window opened with", () => {
		const at = SHEET.indexOf("record-winter-debt']");
		const body = SHEET.slice(at, at + 1800);
		expect(body).toContain(`getStatValue("population")`);
	});

	// A roll of 0 is a real outcome at Population -1, and a debt of nothing is not a debt.
	it("records nothing when the roll comes up zero", () => {
		const at = SHEET.indexOf("record-winter-debt']");
		expect(SHEET.slice(at, at + 1400)).toContain("if (!owed)");
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
