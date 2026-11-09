import { describe, it, expect, vi, afterEach } from "vitest";
import { stubConfirm } from "../../fakes/confirm.js";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";

// The Seeker draws three minor arcana at random during onboarding. Alongside the full
// "Draw again" re-roll, a player can swap a SINGLE drawn card for a specific one from the
// pool (the "I've got 2 of 3 I want, let me just pick the third" path). These tests drive
// _swapSeekerMinorArcana directly — it's pure over this._selections.arcana, touching no
// Foundry APIs — via the same Object.create path the other onboarding tests use.

function makeDialog(minorDraw, minorRoles = { mastered: "", found: "", lead: "" }) {
	const d = Object.create(CharacterOnboardingDialog.prototype);
	d._selections = { arcana: { minorDraw: [...minorDraw], minorRoles: { ...minorRoles } } };
	return d;
}

describe("Seeker minor arcana single-card swap", () => {
	it("replaces just the target card, leaving the other two (and their positions) untouched", () => {
		const d = makeDialog(["alpha", "beta", "gamma"]);
		d._swapSeekerMinorArcana("beta", "delta");
		expect(d._selections.arcana.minorDraw).toEqual(["alpha", "delta", "gamma"]);
	});

	it("moves a role from the swapped-out card to the incoming card", () => {
		const d = makeDialog(["alpha", "beta", "gamma"], { mastered: "beta", found: "", lead: "" });
		d._swapSeekerMinorArcana("beta", "delta");
		expect(d._selections.arcana.minorRoles).toEqual({ mastered: "delta", found: "", lead: "" });
	});

	it("leaves roles untouched when the swapped card had no role", () => {
		const d = makeDialog(["alpha", "beta", "gamma"], { mastered: "alpha", found: "", lead: "" });
		d._swapSeekerMinorArcana("beta", "delta");
		expect(d._selections.arcana.minorRoles).toEqual({ mastered: "alpha", found: "", lead: "" });
	});

	it("is a no-op when the target card would duplicate one already drawn", () => {
		const d = makeDialog(["alpha", "beta", "gamma"]);
		d._swapSeekerMinorArcana("beta", "gamma");
		expect(d._selections.arcana.minorDraw).toEqual(["alpha", "beta", "gamma"]);
	});

	it("is a no-op when the old slug isn't currently drawn", () => {
		const d = makeDialog(["alpha", "beta", "gamma"]);
		d._swapSeekerMinorArcana("zeta", "delta");
		expect(d._selections.arcana.minorDraw).toEqual(["alpha", "beta", "gamma"]);
	});

	it("is a no-op when no incoming card is given (empty picker value)", () => {
		const d = makeDialog(["alpha", "beta", "gamma"], { mastered: "beta", found: "", lead: "" });
		d._swapSeekerMinorArcana("beta", "");
		expect(d._selections.arcana.minorDraw).toEqual(["alpha", "beta", "gamma"]);
		expect(d._selections.arcana.minorRoles).toEqual({ mastered: "beta", found: "", lead: "" });
	});
});

// "Draw again" deals three fresh cards and clears the roles, so it asks first once a role has been
// given or a card picked by hand; an untouched draw is redrawn without a word.
describe("Seeker minor arcana Draw again", () => {
	const OPTIONS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].map(slug => ({ slug, name: `The ${slug[0].toUpperCase()}${slug.slice(1)}` }));

	function redrawDialog(minorDraw, minorRoles) {
		const d = makeDialog(minorDraw, minorRoles);
		d._heldMinorArcana = new Set();
		d._loadArcanaOptions = vi.fn(async () => ({ minor: OPTIONS }));
		d.render = vi.fn(async () => {});
		return d;
	}

	afterEach(() => { delete globalThis.foundry?.applications?.api?.DialogV2; });

	it("an untouched draw is redrawn without asking", async () => {
		const ask = stubConfirm(false);
		const d = redrawDialog(["alpha", "beta", "gamma"]);
		await d._redrawSeekerMinorArcana();
		expect(ask).not.toHaveBeenCalled();
		expect(d._selections.arcana.minorDraw).toHaveLength(3);
		expect(d.render).toHaveBeenCalled();
	});

	it("with a role given, keeping the cards leaves the draw and the roles as they were", async () => {
		const ask = stubConfirm(false);
		const d = redrawDialog(["alpha", "beta", "gamma"], { mastered: "beta", found: "", lead: "gamma" });
		await d._redrawSeekerMinorArcana();
		const asked = ask.mock.calls[0][0];
		expect(asked.window.title).toBe("Draw three new cards?");
		expect(asked.content).toContain("<strong>The Alpha</strong>");
		expect(asked.content).toContain("Mastered (The Beta)");
		expect(asked.content).toContain("Lead (The Gamma)");
		expect(asked.buttons.find(b => b.default).action).toBe("no");
		expect(d._selections.arcana.minorDraw).toEqual(["alpha", "beta", "gamma"]);
		expect(d._selections.arcana.minorRoles).toEqual({ mastered: "beta", found: "", lead: "gamma" });
		expect(d.render).not.toHaveBeenCalled();
	});

	it("a card swapped in by hand is enough to ask, and is named as picked by hand", async () => {
		const ask = stubConfirm(false);
		const d = redrawDialog(["alpha", "beta", "gamma"]);
		d._swapSeekerMinorArcana("beta", "delta");
		await d._redrawSeekerMinorArcana();
		expect(ask).toHaveBeenCalledTimes(1);
		expect(ask.mock.calls[0][0].content).toContain("That includes The Delta, which you picked by hand.");
		expect(d._selections.arcana.minorDraw).toEqual(["alpha", "delta", "gamma"]);
	});

	it("drawing again anyway deals three cards and clears the roles and the hand-picked mark", async () => {
		stubConfirm(true);
		const d = redrawDialog(["alpha", "beta", "gamma"], { mastered: "alpha", found: "", lead: "" });
		d._swapSeekerMinorArcana("beta", "delta");
		await d._redrawSeekerMinorArcana();
		expect(d._selections.arcana.minorDraw).toHaveLength(3);
		expect(d._selections.arcana.minorRoles).toEqual({ mastered: "", found: "", lead: "" });
		expect(d._selections.arcana.minorSwappedIn).toEqual([]);
		expect(d.render).toHaveBeenCalled();
	});
});
