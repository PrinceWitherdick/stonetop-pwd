import { describe, it, expect } from "vitest";
import { readRepo as read } from "../../fakes/css.js";

// Muster is the one steading move whose 7+ leaves a STATE behind: "the steading is alert and
// ready for action until the threat passes, the Seasons Change, or you cease to oversee the
// muster." Three exits, only one of which the system can see coming, so the state is stored
// against the season it was raised in and read back against the clock.

const STEADING = read("module/actors/steading/StonetopSteading.js");
const SHEET = read("module/actors/steading/StonetopSteadingSheet.js");
const MAIN = read("stonetop.js");

describe("raising the muster", () => {
	// On a 6- there is no muster to raise, and asking before the dice were read would be
	// asking about an outcome nobody has yet. Same reasoning as Deploy's diminished button.
	it("is offered from the card's 7+ tiers, not from the pre-roll dialog", () => {
		const at = SHEET.indexOf("const MUSTER_RAISE_ACTIONS");
		expect(at).toBeGreaterThan(-1);
		const flow = SHEET.slice(SHEET.indexOf("\tmuster: {"), SHEET.indexOf("\tdeploy: {"));
		expect(flow).toContain("success: MUSTER_RAISE_ACTIONS");
		expect(flow).toContain("partial: MUSTER_RAISE_ACTIONS");
		expect(flow).not.toContain("failure: MUSTER_RAISE_ACTIONS");
	});

	it("offers the Defenses pick as its own button, since that half must be given back", () => {
		const at = SHEET.indexOf("const MUSTER_RAISE_ACTIONS");
		const block = SHEET.slice(at, at + 700);
		expect(block.match(/data-action="muster-raise"/g) ?? []).toHaveLength(2);
		expect(block).toContain('data-defenses="1"');
	});

	// One card is one use of the move, raised once however many clients render it.
	it("stamps the card so it cannot be raised twice", () => {
		const at = MAIN.indexOf("function _chatWireMusterRaise");
		expect(at).toBeGreaterThan(-1);
		const body = MAIN.slice(at, at + 2200);
		// The latch itself lives in the shared card-button wiring; this card names the flag it
		// latches on and stamps WHICH button was pressed, so a re-render can relabel it.
		expect(body).toContain(`flag: "musterRaised"`);
		expect(body).toContain("stamp: { defenses }");
		expect(body).toContain("raiseMuster({ defenses })");
		const wiring = MAIN.indexOf("function _wireSteadingCardButtons");
		expect(wiring).toBeGreaterThan(-1);
		const shared = MAIN.slice(wiring, wiring + 1400);
		expect(shared).toContain("message.getFlag(SYSTEM_ID, flag)");
		expect(shared).toContain("message.setFlag(SYSTEM_ID, flag, stamp)");
		expect(MAIN).toContain("_chatWireMusterRaise(message, html);");
	});
});

describe("the muster's three exits", () => {
	// Raised in a season the clock has since left: it lapsed with the season, per the book.
	it("lapses on its own when the season turns", () => {
		const at = STEADING.indexOf("musterHold() {");
		expect(at).toBeGreaterThan(-1);
		const body = STEADING.slice(at, at + 700);
		expect(body).toContain("readCurrentSeason(this._actor)");
		expect(body).toContain("return null");
	});

	// The stranded-bonus case: a muster that took +1 Defenses and then lapsed by the clock
	// still has that +1 on the sheet, which is exactly when it must be given back.
	// Both the glyph's stand-down and the Seasons Change's lapse resolve the give-back here.
	it("gives the Defenses back off the RAW flag, not the clock-filtered read", () => {
		const at = STEADING.indexOf("musterLapseChanges() {");
		expect(at).toBeGreaterThan(-1);
		const body = STEADING.slice(at, at + 600);
		expect(body).toContain("this._flags.musterHold");
		expect(body).not.toContain("this.musterHold()");
		expect(body).toContain('stats.defenses.value');
		expect(body).toContain("- 1");
	});

	it("stands down through the header glyph, behind a confirm", () => {
		expect(SHEET).toContain(`data-action='stand-down-muster'`);
		expect(SHEET).toContain("async _standDownMuster()");
		expect(SHEET).toContain(`title: "Stand Down the Muster"`);
	});

	// Deliberately NOT `Dialog.confirm`: its buttons are hard-wired to Yes/No, and "Yes" under a
	// paragraph about Defenses does not say what it agrees to. Both labels name an outcome, and
	// the affirmative is declared first so it renders LEFT (Foundry's order).
	it("names both outcomes on its buttons rather than asking Yes/No", () => {
		const at = SHEET.indexOf("async _standDownMuster()");
		const body = SHEET.slice(at, at + 2600);
		expect(body).not.toContain("Dialog.confirm");
		expect(body).toContain(`label: "Stand the muster down"`);
		expect(body).toContain(`label: "No, keep it mustered"`);
		expect(body.indexOf("Stand the muster down")).toBeLessThan(body.indexOf("keep it mustered"));
	});

	// "Defenses: +1 to 0" read as an instruction to ADD +1. The house before/after form is
	// `<before> &rarr; <after>`, and the reason for the change is spelled out beside it.
	it("shows the Defenses give-back as a before/after, not as an operation", () => {
		const at = SHEET.indexOf("async _standDownMuster()");
		const body = SHEET.slice(at, at + 2600);
		expect(body).toContain("${sign(defenses)} &rarr; ${sign(defenses - 1)}");
		expect(body).not.toContain("</strong> to <strong>");
		// The no-bonus case answers the same question in the same box rather than in a stray note.
		expect(body).toContain("Nothing on the sheet.");
		expect(body.match(/stonetop-muster-change-head/g)).toHaveLength(1);
	});

	it("styles the change block it renders", () => {
		const css = read("styles/stonetop.css");
		for (const cls of ["stonetop-muster-change", "stonetop-muster-change-head",
			"stonetop-muster-change-row", "stonetop-muster-change-why"]) {
			expect(css).toContain(`.${cls}`);
		}
	});

	// `.stonetop-inn-trigger` is scoped per window on purpose, so wearing the class is not
	// enough: a window that borrows the quoted-trigger line has to be named in that rule or
	// its lead paragraph silently renders as body text.
	it("is named in the shared trigger-line rule it borrows", () => {
		expect(read("styles/stonetop.css")).toContain(".stonetop-muster-body .stonetop-inn-trigger");
	});

	// Seasons Change must stand it DOWN rather than let it lapse silently, or a muster that
	// took the bonus leaves it on the sheet with nothing left to explain it. It takes the
	// give-back as pending CHANGES and folds them into the season's own single write, so the
	// returned Defenses cards with the rest of the season instead of on its own.
	it("is stood down by the Seasons Change, not merely forgotten", () => {
		const at = SHEET.indexOf("_saveSeasonChange(seasonId");
		const body = SHEET.slice(at, at + 4000);
		expect(body).toContain("musterLapseChanges()");
		expect(body).toContain("Object.assign(updates, lapse.system)");
		expect(body).toContain("lapse.held.defenses");
	});
});

describe("Tor's blessing", () => {
	// The one seasonal gain that leaves something behind. Stored as "<year>:<season>" so it
	// expires by ceasing to match the clock; nothing has to sweep it up.
	it("is recorded against the season it was granted for", () => {
		expect(STEADING).toContain("torsBlessingActive()");
		const at = STEADING.indexOf("torsBlessingFlags(year, seasonId)");
		expect(at).toBeGreaterThan(-1);
		expect(STEADING.slice(at, at + 220)).toContain("torsBlessing: `${year}:${seasonId}`");
	});

	it("is granted when its gain is ticked at the Seasons Change", () => {
		const at = SHEET.indexOf("_saveSeasonChange(seasonId");
		const body = SHEET.slice(at, at + 4000);
		expect(body).toContain(`checkedKeys.includes("tor")`);
		expect(body).toContain("torsBlessingFlags(year, seasonId)");
		// Folded into the season's single applyChanges rather than written on its own, so the
		// blessing does not card separately from the Fortunes reset it arrives with.
		expect(body).toContain("applyChanges(");
	});
});

describe("Weapons of War upkeep", () => {
	// "Each SPRING, the village must expend 1 Surplus to maintain and replace the town's
	// weapons." Spring only, and the book names no penalty for skipping it.
	it("appears in spring only, and only once the weapons exist", () => {
		const at = SHEET.indexOf("const weaponsBlock =");
		expect(at).toBeGreaterThan(-1);
		const block = SHEET.slice(at, at + 900);
		expect(block).toContain(`seasonId === "spring"`);
		expect(block).toContain(`this._hasImprovement("weaponsOfWar")`);
		expect(block).toContain(`data-action="pay-weapons"`);
		// No disband twin: what a neglected ballista costs is the GM's call.
		expect(block).not.toContain("disband");
	});

	it("settles its own once-per-season step", () => {
		const at = SHEET.indexOf("const payWeaponsBtn");
		expect(at).toBeGreaterThan(-1);
		const block = SHEET.slice(at, at + 1100);
		// Spent and settled in the one shared write; the live Surplus re-read lives there too.
		expect(block).toContain("step: WEAPONS_SEASON_STEP, year, seasonId");
		expect(block).toContain("spendSurplus(1,");
	});
});
