import { describe, it, expect, vi, afterEach } from "vitest";
import { readRepo as read, readCss, declarations } from "../fakes/css.js";
import { pbtaDiceFormula, postSeasonsRollPrompt } from "../../module/utils/roll-engine.js";

// ── Handing the spring roll to the table ────────────────────────────────────────
// Spring's Seasons Change is the ONE roll in the system decided in one place and made in
// another: the window offers no roll button of its own, only "ask the most hopeful to roll",
// which posts a card that whoever is playing that character clicks.
//
// That split had swallowed the roll's conditions whole. Rites of the Land buys "advantage on
// the steading's NEXT +Fortunes roll" for a sacrificed Surplus, and the chat card rolled a flat
// 2d6 — so the one roll the hold names by description was the one roll it could not reach. The
// hold stayed lit on the header afterwards too, since nothing had spent it.
//
// The fix is that the GM's side settles the conditions and stamps them onto the card. It has to
// be that way round rather than the button reading the steading: the player who clicks may not
// own the steading actor, so they can neither read the flag nor clear it.

afterEach(() => { delete globalThis.ChatMessage; });

function postedContent(opts) {
	const create = vi.fn();
	globalThis.ChatMessage = { create };
	postSeasonsRollPrompt(opts);
	return create.mock.calls[0]?.[0]?.content ?? "";
}

describe("pbtaDiceFormula", () => {
	it("rolls three and keeps the best two at advantage, the worst two at disadvantage", () => {
		expect(pbtaDiceFormula("adv")).toBe("3d6kh2");
		expect(pbtaDiceFormula("dis")).toBe("3d6kl2");
	});

	// Anything unrecognised is a plain roll, which is what an old card with no `data-roll-mode`
	// on its button deserves — those are already in people's chat logs.
	it("rolls two for a normal roll, and for anything it does not know", () => {
		expect(pbtaDiceFormula("normal")).toBe("2d6");
		expect(pbtaDiceFormula(undefined)).toBe("2d6");
		expect(pbtaDiceFormula("")).toBe("2d6");
	});
});

describe("postSeasonsRollPrompt", () => {
	it("carries the mode on the button, where the roll can find it", () => {
		expect(postedContent({ fortunes: 1, rollMode: "adv" })).toContain(`data-roll-mode="adv"`);
	});

	// Two extra dice with nothing explaining them is a table wondering whether the button is
	// broken. The sacrifice that bought them is named on the card.
	it("names what bought the advantage", () => {
		const html = postedContent({ fortunes: 1, rollMode: "adv", why: "Sacrifice (Rites of the Land)" });
		expect(html).toContain("advantage");
		expect(html).toContain("Sacrifice (Rites of the Land)");
	});

	it("says nothing at all on a plain roll", () => {
		const html = postedContent({ fortunes: 1 });
		expect(html).toContain(`data-roll-mode="normal"`);
		expect(html).not.toContain("stonetop-seasons-prompt-mode");
	});
});

describe("how the hand-off is wired", () => {
	const SHEET = read("module/actors/steading/StonetopSteadingSheet.js");
	const BOOT  = read("stonetop.js");

	it("builds the chat roll's dice from the mode the card carried", () => {
		expect(BOOT).toContain("pbtaDiceFormula(btn.dataset.rollMode)");
		// The flat 2d6 that used to drop the advantage on the floor.
		expect(BOOT).not.toContain("`2d6 + ${fortunes}`");
	});

	// Handing the roll over IS making it, so the hold is spent at that moment — on the GM's
	// machine, which is the only one that may write the steading.
	it("spends the held advantage when the roll is handed to the table", () => {
		const at = SHEET.indexOf("data-action='ask-hopeful'");
		expect(at).toBeGreaterThan(-1);
		const body = SHEET.slice(at, at + 1200);
		expect(body).toContain("fortunesAdvantage()");
		expect(body).toContain("clearFortunesAdvantage()");
		expect(body).toContain(`rollMode: held ? "adv"`);
	});
});

// ── Winter's second half, on a reopened window ──────────────────────────────────
// Winter is the only season that runs in two halves, and steps 2 and 3 un-hide only as a side
// effect of the consumption button being clicked. The consumption is also a once-per-season
// step, so on a reopen that button comes back disabled and nothing un-hides them: a GM who
// closed the window between winter's halves could not reach the second one from anywhere —
// including the +Fortunes roll and the button that records what winter still wants.
describe("reopening a winter whose consumption is settled", () => {
	const SHEET = read("module/actors/steading/StonetopSteadingSheet.js");

	it("opens on what is left instead of on a dead button", () => {
		const at = SHEET.indexOf(`_disableIfSeasonStepDone(rollConsumptionBtn`);
		expect(at).toBeGreaterThan(-1);
		const body = SHEET.slice(at - 200, at + 500);
		expect(body).toContain("#stonetop-winter-step3");
		expect(body).toContain("#stonetop-winter-settled");
	});

	// `.stonetop-season-actions` sets `display: flex`, which out-specifies the UA's
	// `[hidden] { display: none }` — the same trap `.stonetop-roll-tier-action[hidden]` is in
	// the stylesheet for. Step 1 IS an action row, so without this rule the dead roll button
	// stayed on screen above the result the whole time, hidden attribute and all.
	it("can actually hide an action row", () => {
		expect(declarations(readCss(), ".stonetop-season-actions[hidden]"))
			.toMatch(/display:\s*none/);
	});
});
