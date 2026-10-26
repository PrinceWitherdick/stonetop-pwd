import { describe, it, expect } from "vitest";
import { readRepo } from "../fakes/css.js";

/**
 * The two buttons on a crew card's Inventory fold, and the list one of them fills.
 *
 * The Supplies button used to be captioned "Outfit crew" and cited p.472 for it. Outfit is a
 * real move and it is not what the button does: "when you prepare for an expedition in a
 * friendly community, mark as many ◇ on your Inventory insert as you wish to carry" (p.306) —
 * a follower's WHOLE load, gear and undefined marks both, which p.307 is explicit applies to
 * followers ("Followers need to Outfit, too!"). The crew's load is the diamond list ABOVE this
 * section, and the button has only ever refilled the row of Supplies below it. So it is named
 * for what it does, and Outfit stays available to mean the move.
 *
 * The list is the other half of that same p.472 sidebar, the half that used to be missing:
 * "the PC can direct one crew member to Have What They Need and add an item to their
 * inventory, without the rest of the crew each producing the same item." That item belongs to
 * one member, so it cannot go in the shared pip map — it goes in its own list, wired to the
 * free-text gear checklist every other follower card already carries (crew.details.gear), so
 * the shared toggle / rename / remove handlers reach it with no second implementation.
 */

const TAB = readRepo("templates/actor/partials/tab-followers.hbs");

// The button in the Supplies heading — the ELEMENT, not the {{!-- --}} comment above it,
// which is free to discuss the move this button is deliberately not.
const SUPPLIES_HEADING = /<p class="stonetop-follower-section-heading">Supplies[\s\S]*?<\/p>/.exec(TAB)?.[0] ?? "";
const RESTOCK = /<button[\s\S]*?<\/button>/.exec(SUPPLIES_HEADING)?.[0] ?? "";

// The per-member produced list, sliced to where the Supplies section starts: the block has
// {{#if}}s nested in it, so it cannot be closed on the first {{/if}}.
const PRODUCED = TAB.slice(TAB.indexOf("{{#if produced.length}}"), TAB.indexOf('<div class="stonetop-crew-supplies-section">'));

describe("the crew's Supplies button", () => {
	it("is captioned for what it does", () => {
		expect(RESTOCK).toContain("Restock supplies");
	});

	// The old caption and its class both claimed the move. A stale class is worse than a stale
	// caption: it is what the click handler binds to, so it has to move with the name.
	it("no longer claims to be Outfit", () => {
		expect(RESTOCK).not.toContain("Outfit");
		expect(RESTOCK).toContain("stonetop-crew-restock");
		// Nothing else in the tab may still bind the old name, or the click lands nowhere.
		expect(TAB).not.toContain("stonetop-crew-outfit");
	});

	// A ◇ of supplies is "4 uses, but you add Stonetop's current Prosperity to that" (p.88) —
	// a different rule from the small-item allotment that happens to share its arithmetic, so
	// the tooltip cites the one it means.
	it("cites the supplies rule rather than the group sidebar", () => {
		expect(RESTOCK).toContain("p.88");
		expect(RESTOCK).not.toContain("p.472");
	});
});

describe("the crew's per-member produced list", () => {
	it("is rendered at all", () => {
		expect(PRODUCED).not.toBe("");
	});

	// crew.details.gear, reached by the ftype/slug pair every gear handler reads. `data-slug`
	// must be present and empty: the crew is the singular type whose flag path takes no slug,
	// and followerDetailPath fills "" into it.
	it("wires every row to the shared follower-gear handlers", () => {
		for (const cls of ["stonetop-follower-gear-check", "stonetop-follower-gear-label", "stonetop-follower-gear-remove"]) {
			expect(PRODUCED).toContain(cls);
		}
		expect(PRODUCED).toContain('data-ftype="crew"');
		expect(PRODUCED).toContain('data-slug=""');
		expect(PRODUCED).toContain('data-index="{{this.index}}"');
	});

	// Every other follower's gear list keeps rename and remove under the card's pencil. Always
	// live here, one stray click on the red cross deleted an item mid-session, with no confirm.
	it("keeps renaming and removing behind the card's pencil, as every other gear list does", () => {
		const gate = PRODUCED.indexOf("{{#if ../edit.gear}}");
		const reading = PRODUCED.indexOf("{{else}}", gate);
		expect(gate).toBeGreaterThan(-1);
		expect(reading).toBeGreaterThan(gate);
		for (const cls of ["stonetop-follower-gear-label", "stonetop-follower-gear-remove"]) {
			expect(PRODUCED.indexOf(cls)).toBeGreaterThan(gate);
			expect(PRODUCED.indexOf(cls, reading)).toBe(-1);
		}
		// Reading the card, the tick stays live: what they carry changes in play.
		expect(PRODUCED.slice(reading)).toContain("stonetop-follower-gear-check");
	});

	// It sits under the shared kit and above Supplies, so the fold reads: what they all carry,
	// what one of them dug out, how much food is left.
	it("sits between the crew's shared kit and its Supplies", () => {
		const produced = TAB.indexOf("{{#if produced.length}}");
		const gear     = TAB.indexOf('<div class="stonetop-crew-gear-list">');
		const supplies = TAB.indexOf('<div class="stonetop-crew-supplies-section">');
		expect(gear).toBeGreaterThan(-1);
		expect(produced).toBeGreaterThan(gear);
		expect(supplies).toBeGreaterThan(produced);
	});
});

describe("the Have what they need button", () => {
	const BUTTON = /<button type="button" class="stonetop-follower-have-need[\s\S]*?<\/button>/.exec(TAB)?.[0] ?? "";

	// A group produces for ONE member (p.472); a singular follower is the member, and reaches
	// the move through Order Followers (p.462) like any other player move (p.326).
	it("says who produces, and cites the rule for the kind of follower it is on", () => {
		expect(BUTTON).toContain("{{#if haveNeedPicksMember}}");
		expect(BUTTON).toContain("p.472");
		expect(BUTTON).toContain("p.326");
		expect(BUTTON).toContain("p.462");
	});
});
