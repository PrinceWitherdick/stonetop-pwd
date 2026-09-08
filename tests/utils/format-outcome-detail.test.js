import { describe, it, expect } from "vitest";
import { formatOutcomeDetail } from "../../module/utils/strings.js";

describe("formatOutcomeDetail", () => {
	it("returns '' for blank input", () => {
		expect(formatOutcomeDetail("")).toBe("");
		expect(formatOutcomeDetail("   ")).toBe("");
		expect(formatOutcomeDetail(null)).toBe("");
		expect(formatOutcomeDetail(undefined)).toBe("");
	});

	it("just escapes a plain outcome with no pick list", () => {
		const text = "Your maneuver works, mostly (deal your damage), but you suffer your enemy's attack.";
		expect(formatOutcomeDetail(text)).toBe(
			"Your maneuver works, mostly (deal your damage), but you suffer your enemy&#x27;s attack.",
		);
	});

	it("splits a 'pick 1:' outcome into a spiral-bulleted list, keeping the lead-in", () => {
		const text =
			"Your maneuver works as expected (deal your damage) and pick 1: " +
			"Avoid, prevent, or counter your enemy's attack / " +
			"Strike hard and fast, for 1d6 extra damage, but suffer your enemy's attack.";
		const html = formatOutcomeDetail(text);
		expect(html).toContain(
			'<span class="stonetop-roll-result-lead">Your maneuver works as expected (deal your damage) and pick 1:</span>',
		);
		expect(html).toContain('<ul class="stonetop-roll-result-picks">');
		expect(html).toContain("<li>Avoid, prevent, or counter your enemy&#x27;s attack</li>");
		// The trailing sentence period is stripped from the last option.
		expect(html).toContain(
			"<li>Strike hard and fast, for 1d6 extra damage, but suffer your enemy&#x27;s attack</li>",
		);
		expect(html).not.toContain(" / ");
	});

	it("handles a leading 'Pick 1:' with more than two options (Let Fly)", () => {
		const text =
			"Pick 1: Deal your damage, but deplete your ammo / Hold steady and wait / " +
			"Move to get a clear shot / Rush the shot and deal your damage.";
		const html = formatOutcomeDetail(text);
		expect((html.match(/<li>/g) || []).length).toBe(4);
		expect(html).toContain('<span class="stonetop-roll-result-lead">Pick 1:</span>');
	});

	it("handles an em-dash 'choose 1:' hinge (Death's Door)", () => {
		const text =
			"Your time has come—choose 1: Make one last move as if you rolled a 12+ / " +
			"Refuse to go; gain the Revenant or Ghost insert / Call on one of the Things Below.";
		const html = formatOutcomeDetail(text);
		expect(html).toContain(
			'<span class="stonetop-roll-result-lead">Your time has come—choose 1:</span>',
		);
		expect((html.match(/<li>/g) || []).length).toBe(3);
	});

	it("splits '; OR' inline options while keeping an option's own lowercase 'or' (Danu's Grasp)", () => {
		const text =
			"Roots, vines, and earth pull at them, and they pick 1: " +
			"restrained until your focus slips or they tear free; OR " +
			"they take 2d4 damage (ignores armor).";
		const html = formatOutcomeDetail(text);
		expect((html.match(/<li>/g) || []).length).toBe(2);
		expect(html).toContain("<li>restrained until your focus slips or they tear free</li>");
		expect(html).toContain("<li>they take 2d4 damage (ignores armor)</li>");
	});

	it("splits multiple '; OR' options (Suck the Poison Out)", () => {
		const text =
			"You remove it, but choose 1: your patient suffers lingering harm or trauma; OR " +
			"you suffer some of the malady's effects; OR " +
			"it will be harmful and dangerous to discard.";
		const html = formatOutcomeDetail(text);
		expect((html.match(/<li>/g) || []).length).toBe(3);
	});

	it("splits a bare ' OR ' without breaking an unspaced 'quail/flee' (Formidable)", () => {
		const text = "Pick 1: lesser foes quail/flee OR doughty foes focus on you.";
		const html = formatOutcomeDetail(text);
		expect((html.match(/<li>/g) || []).length).toBe(2);
		expect(html).toContain("<li>lesser foes quail/flee</li>");
		expect(html).toContain("<li>doughty foes focus on you</li>");
	});

	it("leaves a lowercase-'or' comma list as prose (Urges — unsafe to split)", () => {
		const text =
			"Choose 1: struggle for control until something snaps you out of it, " +
			"start acting as compelled (putting yourself or an ally in a spot), " +
			"or harm yourself (d6 damage, ignores armor) to regain control.";
		const html = formatOutcomeDetail(text);
		expect(html).not.toContain("<ul");
		expect(html).not.toContain("<li>");
	});

	it("leaves a 'pick N from the list' outcome as prose (list lives in the description)", () => {
		expect(formatOutcomeDetail("Deal your damage and pick 2 from the list.")).not.toContain("<ul");
		expect(formatOutcomeDetail("Pick 1 from the list.")).not.toContain("<ul");
	});

	it("leaves a single-option 'pick' line as prose (no list)", () => {
		const text = "Pick 1: Deal your damage.";
		const html = formatOutcomeDetail(text);
		expect(html).not.toContain("<ul");
		expect(html).toBe("Pick 1: Deal your damage.");
	});

	// A LINE THAT ENDS ON A COLON introduces nothing, whichever way it got that way. A tier row
	// read back out of a move's own prose is cut at the colon its bullets followed (those bullets
	// print above the ladder, not in the row), which is how Formidable's weak hit came to read
	// "Pick 1:" and then stop. Eleven other shipped rows read the same way.
	it("closes a line that is nothing but a lead-in", () => {
		expect(formatOutcomeDetail("Pick 1:")).toBe("Pick 1.");
		expect(formatOutcomeDetail("All 3 apply:")).toBe("All 3 apply.");
		expect(formatOutcomeDetail("Your maneuver works as expected (deal your damage) and pick 1:"))
			.toBe("Your maneuver works as expected (deal your damage) and pick 1.");
	});

	// `introOnly` is set where the card already bullets these same options just above, so the
	// lead-in is the whole of what this line says. Its colon introduced a list that is no longer
	// coming, and left as one Formidable's weak hit read "Pick 1:" and simply stopped.
	describe("introOnly", () => {
		it("drops the options and closes the lead-in with a full stop", () => {
			const text = "Pick 1: lesser foes quail/flee OR doughty foes focus on you.";
			const html = formatOutcomeDetail(text, { introOnly: true });
			expect(html).not.toContain("<ul");
			expect(html).toBe('<span class="stonetop-roll-result-lead">Pick 1.</span>');
		});

		it("keeps whatever the lead-in said before the count", () => {
			const text = "Your maneuver works as expected (deal your damage) and pick 1: "
				+ "Avoid the attack / Strike hard and fast";
			expect(formatOutcomeDetail(text, { introOnly: true }))
				.toBe('<span class="stonetop-roll-result-lead">Your maneuver works as expected '
					+ "(deal your damage) and pick 1.</span>");
		});

		// The flag only speaks for a line that HAS a list to drop. A plain outcome is prose either
		// way, and its own punctuation is none of this function's business.
		it("leaves a line with no option list exactly as it was", () => {
			expect(formatOutcomeDetail("Deal your damage and pick 2 from the list.", { introOnly: true }))
				.toBe("Deal your damage and pick 2 from the list.");
			expect(formatOutcomeDetail("", { introOnly: true })).toBe("");
		});

		// The list still prints for every tier the card is NOT suppressing, colon and all: there the
		// colon does point at something.
		it("keeps the colon when the options follow it after all", () => {
			const text = "Pick 1: lesser foes quail/flee OR doughty foes focus on you.";
			const html = formatOutcomeDetail(text);
			expect(html).toContain('<span class="stonetop-roll-result-lead">Pick 1:</span>');
			expect(html).toContain('<ul class="stonetop-roll-result-picks">');
		});
	});
});
