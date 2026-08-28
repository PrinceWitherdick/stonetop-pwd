import { describe, it, expect } from "vitest";
import {
	balanceInlineHtml,
	markRolledTier,
	moveBodyHtml,
	moveCardBody,
	moveTierRows,
	moveTiersHtml,
	parseTiersFromProse,
	splitClauses,
	stripTierProse,
} from "../../module/utils/move-tiers.js";
import { declarations, readCss, readRepo } from "../fakes/css.js";
import { MOVE_TIERS_CLASS } from "../../module/utils/move-results.js";

// The shipped moveResults for the moves each case is drawn from, verbatim from
// packs/src/stonetop-items — the transform is only ever as good as the pairing of a
// real description with its real stored outcomes.
const CLASH = {
	success: { label: "10+", value: "Your maneuver works as expected (deal your damage) and pick 1: Avoid, prevent, or counter your enemy's attack / Strike hard and fast, for 1d6 extra damage, but suffer your enemy's attack." },
	partial: { label: "7-9", value: "Your maneuver works, mostly (deal your damage), but you suffer your enemy's attack." },
	failure: { label: "6-",  value: "Your maneuver fails and you suffer your enemy's attack." },
};
const KNOW_THINGS = {
	success: { label: "10+", value: "The GM will tell you something interesting and useful about the topic at hand." },
	partial: { label: "7-9", value: "The GM will tell you something interesting—it's on you to make it useful." },
	failure: { label: "6-",  value: "The GM makes a move." },
};

const text = (html) => String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

describe("splitClauses", () => {
	it("cuts at ';', '.' and ':' followed by whitespace, keeping the separator", () => {
		expect(splitClauses("roll +STR: on a 10+, it works; on a 7-9, it doesn't.")).toEqual([
			"roll +STR:", "on a 10+, it works;", "on a 7-9, it doesn't.",
		]);
	});

	// An HTML entity ends in a semicolon, and Dark Succor is written "<strong>on a 6&ndash;
	// </strong>, all 3 apply:" — the entity closes right in front of a tag, which is exactly
	// what the rule above counts as a boundary. Split there, "on a 6" went out as a tier and
	// ", all 3 apply:" stayed behind as a fragment, taking the move's 6- rung with it.
	it("does not cut inside an HTML entity", () => {
		expect(splitClauses("<strong>on a 6&ndash;</strong>, all 3 apply:"))
			.toEqual(["<strong>on a 6&ndash;</strong>, all 3 apply:"]);
		expect(splitClauses("<em>on a 7&#8211;9</em>, choose 2; then stop."))
			.toEqual(["<em>on a 7&#8211;9</em>, choose 2;", "then stop."]);
	});

	it("does not cut inside a tag, so markup is never split mid-attribute", () => {
		expect(splitClauses('<a data-x="a. b">one</a> two. three')).toEqual([
			'<a data-x="a. b">one</a> two.', "three",
		]);
	});

	it("does not cut a separator with no whitespace after it (1-for-1, a decimal)", () => {
		expect(splitClauses("spend Readiness 1-for-1 and 2.5 gold")).toEqual([
			"spend Readiness 1-for-1 and 2.5 gold",
		]);
	});

	it("re-joining every clause with one space reproduces the text", () => {
		const inner = "When you <strong>act</strong>, roll +STR: it works. Then it doesn't; really.";
		expect(splitClauses(inner).join(" ")).toBe(inner);
	});
});

describe("balanceInlineHtml", () => {
	it("closes a tag left open by a cut", () => {
		expect(balanceInlineHtml("<strong>bold")).toBe("<strong>bold</strong>");
	});

	it("drops a closer whose opener was cut away", () => {
		expect(balanceInlineHtml("plain</em> text")).toBe("plain text");
	});

	it("closes nested tags in order", () => {
		expect(balanceInlineHtml("<strong><em>x")).toBe("<strong><em>x</em></strong>");
	});

	it("leaves void elements alone", () => {
		expect(balanceInlineHtml("a<br>b")).toBe("a<br>b");
	});
});

describe("moveTierRows", () => {
	it("is empty for a move with no stored results", () => {
		expect(moveTierRows(null)).toEqual([]);
		expect(moveTierRows({})).toEqual([]);
	});

	it("skips a tier whose text is blank, so a two-tier move renders two rows", () => {
		const rows = moveTierRows({ success: { label: "10+", value: "yes" }, partial: { label: "7-9", value: "  " } });
		expect(rows.map(r => r.key)).toEqual(["success"]);
	});

	it("falls back to the standard label when a stored row carries none", () => {
		expect(moveTierRows({ failure: { value: "bad" } })[0].label).toBe("6-");
	});
});

describe("moveTiersHtml", () => {
	it("renders one labelled row per tier, in ladder order", () => {
		const html = moveTiersHtml(KNOW_THINGS);
		expect(html.indexOf("10+")).toBeLessThan(html.indexOf("7-9"));
		expect(html.indexOf("7-9")).toBeLessThan(html.indexOf("6-"));
		expect((html.match(/stonetop-move-tier /g) || []).length).toBe(3);
	});

	it("escapes the stored outcome text", () => {
		const html = moveTiersHtml({ success: { label: "10+", value: "<script>x</script>" } });
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("bullets a tier's 'pick 1:' options when the description does not list them", () => {
		expect(moveTiersHtml(CLASH)).toContain('<ul class="stonetop-roll-result-picks">');
	});

	it("keeps only the lead-in when the description already bullets those options", () => {
		const listed = [
			"Avoid, prevent, or counter your enemy's attack",
			"Strike hard and fast, for 1d6 extra damage, but suffer your enemy's attack",
		];
		const html = moveTiersHtml(CLASH, listed);
		expect(html).not.toContain('<ul class="stonetop-roll-result-picks">');
		expect(html).toContain("and pick 1:");
	});

	it("matches an abridged option against the description's fuller wording (Formidable)", () => {
		const results = { partial: { label: "7-9", value: "Pick 1: lesser foes quail/flee OR doughty foes focus on you." } };
		const listed = [
			"Lesser foes will quail, hesitate, or flee before you.",
			"Doughty foes will focus on you, seeing you as the greatest threat.",
		];
		expect(moveTiersHtml(results, listed)).not.toContain("<li>");
	});
});

describe("stripTierProse", () => {
	it("returns the description untouched when it restates no tier", () => {
		const desc = "<p>When you take an easy shot, deal your damage.</p>";
		expect(stripTierProse(desc, CLASH).body).toBe(desc);
	});

	it("cuts the tier clauses out of the trigger paragraph", () => {
		const desc = "<p>When you <strong>fight</strong>, roll +STR: <strong>on a 10+</strong>, it works and pick 1:</p>";
		const { body } = stripTierProse(desc, CLASH);
		expect(text(body)).toBe("When you fight , roll +STR:");
	});

	it("drops a paragraph that is nothing but tier prose", () => {
		const desc = "<p>Trigger.</p><p>On a 10+, good; on a 7-9, less good.</p>";
		expect(stripTierProse(desc, CLASH).body).toBe("<p>Trigger.</p>");
	});

	it("keeps a list and the sentence that introduces it (Defend)", () => {
		const desc = "<p>When you defend, roll +CON: on a 10+, hold 3 Readiness; On a 7-9, hold 1. "
			+ "You can spend Readiness 1-for-1 to:</p><ul><li>Halve an attack</li></ul>";
		const { body } = stripTierProse(desc, { success: { label: "10+", value: "Hold 3 Readiness." } });
		expect(text(body)).toContain("You can spend Readiness 1-for-1 to:");
		expect(text(body)).toContain("Halve an attack");
		expect(text(body)).not.toContain("hold 3 Readiness");
	});

	it("settles a separator the cut left hanging at the end of the body", () => {
		const results = { partial: { label: "7-9", value: "You choose." }, failure: { label: "6-", value: "Bad." } };
		const desc = "<p>You need not choose a consequence; on a 7-9, you choose.</p>";
		expect(text(stripTierProse(desc, results).body)).toBe("You need not choose a consequence.");
	});

	it("turns a colon into a full stop when the author's own prose follows it", () => {
		const desc = "<p>When you defend, roll +CON: on a 10+, hold 3. You can spend it to:</p>";
		const { body } = stripTierProse(desc, { success: { label: "10+", value: "Hold 3 Readiness." } });
		expect(text(body)).toBe("When you defend, roll +CON. You can spend it to:");
	});

	it("keeps the colon when the ladder is what follows it", () => {
		const desc = "<p>When you consult your knowledge, roll +INT: on a 10+, good.</p>";
		expect(text(stripTierProse(desc, KNOW_THINGS).body)).toBe("When you consult your knowledge, roll +INT:");
	});

	it("lifts an 'either way' rider out to a footnote when the ladder does not carry it", () => {
		const desc = "<p>Roll +INT: on a 10+, good; on a 7-9, less good; either way, the GM might ask how you know.</p>";
		const { body, riders } = stripTierProse(desc, KNOW_THINGS);
		expect(text(body)).toBe("Roll +INT:");
		expect(riders).toHaveLength(1);
		expect(text(riders[0])).toBe("Either way, the GM might ask how you know.");
	});

	it("drops a rider the ladder already states on every tier (Seek Insight)", () => {
		const results = {
			success: { label: "10+", value: "Ask the GM 3 questions from the list. Gain advantage on your next move that acts on the answers." },
			partial: { label: "7-9", value: "Ask the GM 1 question from the list. Gain advantage on your next move that acts on the answers." },
		};
		const desc = "<p>Roll +WIS: on a 10+, ask 3; on a 7-9, ask 1; either way, gain advantage on your next move that acts on the answers.</p>";
		expect(stripTierProse(desc, results).riders).toEqual([]);
	});

	it("does not leave the lower-case tail of a cut sentence dangling after the trigger", () => {
		const results = { partial: { label: "7-9", value: "Selling: you can sell it now but won't get its full worth." } };
		const desc = "<p>Roll +Prosperity. On a 7-9 when you're looking to sell: you can sell it now, but you won't get its full worth.</p>";
		const { body, riders } = stripTierProse(desc, results);
		expect(text(body)).toBe("Roll +Prosperity.");
		expect(riders).toEqual([]);
	});

	it("keeps such a tail as a footnote when the ladder only abbreviates it (Shake It Off)", () => {
		const results = { partial: { label: "7-9", value: "A PC gets advantage to do it; an NPC does it but at a cost (GM decides)." } };
		const desc = "<p>Roll +CHA: on a 10+, they do it; on a 7-9, a PC gets advantage to do it; "
			+ "an NPC will do it, but they'll need time, they'll resent you, or they'll feel humiliated (GM decides).</p>";
		const { body, riders } = stripTierProse(desc, results);
		expect(text(body)).toBe("Roll +CHA:");
		expect(riders).toHaveLength(1);
		expect(text(riders[0])).toContain("they'll resent you");
	});

	it("keeps a new sentence after the cut that the ladder does not state (Struggle as One)", () => {
		const results = { failure: { label: "6-", value: "You find yourself in a spot." } };
		const desc = "<p>Each roll +STAT: on a 6-, you find yourself in a spot. If you roll a 6- but someone saves you, don't mark XP.</p>";
		expect(text(stripTierProse(desc, results).body))
			.toBe("Each roll +STAT. If you roll a 6- but someone saves you, don't mark XP.");
	});

	it("cuts a tier written in words rather than numbers ('On a miss')", () => {
		const desc = "<p><strong>On a 10+:</strong> good.</p><p><strong>On a miss:</strong> bad.</p><p>A note.</p>";
		expect(stripTierProse(desc, KNOW_THINGS).body).toBe("<p>A note.</p>");
	});

	it("never leaves an inline tag unclosed by a cut", () => {
		const desc = "<p>Trigger, <strong>on a 10+ it works</strong> and more.</p>";
		const { body } = stripTierProse(desc, CLASH);
		expect((body.match(/<strong>/g) || []).length).toBe((body.match(/<\/strong>/g) || []).length);
	});
});

// Only character moves store `system.moveResults`. An NPC / monster move is description +
// rollFormula, the steading's moves are hand-authored HTML, and homebrew has nowhere to put
// structured tiers — so on those sheets the ladder is read back out of the prose itself.
describe("parseTiersFromProse", () => {
	it("is null when the prose names no tier", () => {
		expect(parseTiersFromProse("<p>When the ogre is cornered, it rends flesh.</p>")).toBeNull();
		expect(parseTiersFromProse("")).toBeNull();
		expect(parseTiersFromProse(null)).toBeNull();
	});

	it("reads the three rungs out of one run-on sentence", () => {
		const r = parseTiersFromProse("<p>Roll +WIS: on a 10+, you see it clearly; on a 7-9, you catch a glimpse; on a 6-, you see nothing.</p>");
		expect(r.success.value).toBe("You see it clearly.");
		expect(r.partial.value).toBe("You catch a glimpse.");
		expect(r.failure.value).toBe("You see nothing.");
	});

	// The list the rung is pointing at is right underneath it now, so the colon is where the
	// sentence ends. Left to the full-stop rule it read "…and pick 1:." above its own options.
	it("lets a rung end on the colon that leads into the option list", () => {
		const r = parseTiersFromProse("<p>Roll +STR: on a 10+, it works and pick 1:</p>"
			+ "<ul><li>A</li></ul><p>On a 7-9, it mostly works.</p>");
		expect(r.success.value).toBe("It works and pick 1:");
	});

	// The entity's own semicolon is not a clause boundary, so a rung written with an en dash
	// keeps its text (Dark Succor's 6-, which used to vanish entirely).
	it("reads a rung whose dash is written as an entity", () => {
		const r = parseTiersFromProse("<p>Roll +Favor: <strong>on a 10+</strong>, choose 1;"
			+ " <strong>on a 7&ndash;9</strong>, choose 2; <strong>on a 6&ndash;</strong>, all 3 apply.</p>");
		expect(r.partial.value).toBe("Choose 2.");
		expect(r.failure.value).toBe("All 3 apply.");
	});

	it("reads the steading's own labelled lines, 'On a miss' included", () => {
		const r = parseTiersFromProse(
			"<p>Roll +Fortunes.</p><p><strong>On a 10+:</strong> they go along with it.</p>"
			+ "<p><strong>On a 7–9:</strong> they need something in return.</p>"
			+ "<p><strong>On a miss:</strong> they refuse outright.</p>");
		expect(r.success.value).toBe("They go along with it.");
		expect(r.partial.value).toBe("They need something in return.");
		expect(r.failure.value).toBe("They refuse outright.");
	});

	it("gives a '7+' line to BOTH the hit and the partial, then adds each one's own extra", () => {
		const r = parseTiersFromProse("<p>Roll +Population. On a 7+: the muster holds. On a 10+, also pick 2; on a 7-9, also pick 1.</p>");
		expect(r.success.value).toBe("The muster holds. Also pick 2.");
		expect(r.partial.value).toBe("The muster holds. Also pick 1.");
		expect(r.failure).toBeUndefined();
	});

	it("carries a rung's text on past the clause that named it", () => {
		const r = parseTiersFromProse("<p>Roll +INT: on a 10+, ask 2; on a 6-, don't mark XP; you know there's a trap, but nothing happens yet.</p>");
		expect(r.failure.value).toBe("Don't mark XP; you know there's a trap, but nothing happens yet.");
	});

	it("leaves a rider out of the rungs, since it belongs to all of them", () => {
		const r = parseTiersFromProse("<p>Roll +INT: on a 10+, ask 2; on a 7-9, ask 1; either way, gain advantage.</p>");
		expect(r.success.value).toBe("Ask 2.");
		expect(r.partial.value).toBe("Ask 1.");
		expect(r.failure).toBeUndefined();
	});

	it("does not read a measurement as a tier ('on a 20-foot drop')", () => {
		expect(parseTiersFromProse("<p>When you fall, roll. On a 20-foot drop, take 1d6.</p>")).toBeNull();
	});

	it("reads a description authored as bare text with inline markup and no <p>", () => {
		// How a localized string reads (the Death's Door tile) and how homebrew typed straight
		// into a stat block reads. A tag test strict enough to reject these once left them as
		// the only move surfaces the ladder never reached.
		const r = parseTiersFromProse(
			"When you <em><strong>are dying</strong></em>, roll +nothing: on a 10+ return to 1 HP; "
			+ "on a 7-9 you're out of action; on a 6- choose a dark fate.");
		expect(r.success.value).toBe("Return to 1 HP.");
		expect(r.partial.value).toBe("You're out of action.");
		expect(r.failure.value).toBe("Choose a dark fate.");
	});

	it("leaves a fragment holding block markup alone", () => {
		expect(parseTiersFromProse("<ul><li>on a 10+, good</li></ul>")).toBeNull();
	});

	it("does not reach across a paragraph for a rung's continuation", () => {
		const r = parseTiersFromProse("<p>On a 10+, you win.</p><p>this is a separate thought.</p><p>On a 6-, you lose.</p>");
		expect(r.success.value).toBe("You win.");
		expect(r.failure.value).toBe("You lose.");
	});

	it("does not treat a 12+ bonus line as the hit rung (Slippery)", () => {
		// A 12+ is an extra ON TOP of the 10+, not a restatement of it, so labelling that row
		// "10+" would read as a lie. Below the two-rung bar the description is left alone.
		const desc = "<p>When you roll to escape being caught or controlled, treat a 6- as a 7-9. "
			+ "On a 12+, say how you turn the tables.</p>";
		expect(parseTiersFromProse(desc)).toBeNull();
		expect(moveBodyHtml(desc, null)).toBe(desc);
	});

	it("needs two rungs, so half a ladder is left as the prose it was (Glorious Servant)", () => {
		// The hit is stated as part of the TRIGGER ("…and roll a 10+, you need not choose"), so
		// only the 7-9 is quotable; hoisting that one row would leave the sentence trailing off.
		const desc = "<p>When you Invoke the Sun God and roll a 10+, you need not choose a consequence; "
			+ "on a 7-9, you choose a consequence but the GM does not.</p>";
		expect(parseTiersFromProse(desc)).toBeNull();
		expect(moveBodyHtml(desc, null)).toBe(desc);
	});
});

describe("moveBodyHtml", () => {
	it("returns the description untouched when nothing names a tier", () => {
		const desc = "<p>When you are Condemned, bad things happen.</p>";
		expect(moveBodyHtml(desc, null)).toBe(desc);
		expect(moveBodyHtml(desc, {})).toBe(desc);
	});

	it("builds the ladder from the prose when there are no stored results (NPC / steading move)", () => {
		const desc = "<p>When the villagers are pressed, roll +Fortunes: on a 10+, they hold; on a 6-, they scatter.</p>";
		const html = moveBodyHtml(desc, null);
		expect(html).toContain('<ul class="stonetop-move-tiers">');
		expect(html).toContain("They hold.");
		expect(html).toContain("They scatter.");
		expect(html).not.toContain("on a 10+");
	});

	it("prefers the description's own prose over the stored results", () => {
		// moveResults was authored for the roll card, where one tier shows at a time and terse is
		// right, so it abbreviates. Across the 54 shipped moves carrying both, the stored rows
		// drop 110 words of the book's wording the prose keeps — real rules text among them.
		const desc = "<p>Roll +INT: on a 10+, the description's own fuller wording; on a 6-, nothing.</p>";
		const html = moveBodyHtml(desc, KNOW_THINGS);
		expect(html).toContain("The description&#x27;s own fuller wording.");
		expect(html).not.toContain("The GM will tell you something interesting and useful");
	});

	it("fills a rung the prose omits from the stored results (the book prints no 6-)", () => {
		// 35 of the 54 shipped moves that carry both are in this shape: the book states a hit and
		// a partial and leaves the miss to the GM, while this system authored a 6- for the roll
		// card. Reading only the prose would take that row off the sheet while a miss still
		// printed it in chat.
		const desc = "<p>Roll +WIS: on a 10+, ask 3 questions from the list below; on a 7-9, ask 1.</p>";
		const html = moveBodyHtml(desc, KNOW_THINGS);
		expect(html).toContain("Ask 3 questions from the list below.");   // prose wins the hit
		expect(html).toContain("The GM makes a move.");                    // stored fills the miss
		expect(html).not.toContain("something interesting and useful");    // stored hit not used
	});

	it("falls back to stored results when the description states no outcome (a custom move)", () => {
		const desc = "<p>When you do the thing, roll +WIS.</p>";
		const html = moveBodyHtml(desc, KNOW_THINGS);
		expect(html.startsWith(desc)).toBe(true);
		expect(html).toContain("The GM will tell you something interesting and useful");
	});

	it("keeps a rider whose separator is butted straight against a tag (Know Things)", () => {
		// The transcribed book text has no space after that semicolon. Requiring real whitespace
		// glued the rider to the 7-9 clause and deleted it with that clause — off one of the six
		// moves every character owns.
		const desc = "<p>Roll +INT: <strong>on a 10+</strong>, useful; <strong><em>On a 7-9</em></strong>, "
			+ "less useful;<strong><em>either way</em></strong>, the GM might ask how you know.</p>";
		const html = moveBodyHtml(desc, null);
		expect(html).toContain("stonetop-move-tiers-note");
		// The rider keeps the emphasis the book set it in, so match on its text.
		expect(text(html)).toContain("Either way , the GM might ask how you know.");
	});

	it("puts the ladder after the description and any rider after the ladder", () => {
		const desc = "<p>Roll +INT: on a 10+, good; either way, the GM might ask how you know.</p>";
		const html = moveBodyHtml(desc, KNOW_THINGS);
		expect(html.indexOf("stonetop-move-tiers")).toBeLessThan(html.indexOf("stonetop-move-tiers-note"));
	});

	it("states an outcome once, not twice (Clash keeps its option list in the description only)", () => {
		const desc = "<p>When you fight, roll +STR: on a 10+, it works and pick 1:</p>"
			+ "<ul><li>Avoid, prevent, or counter your enemy's attack</li>"
			+ "<li>Strike hard and fast, for 1d6 extra damage, but suffer your enemy's attack</li></ul>"
			+ "<p>On a 7-9, it mostly works.</p>";
		const html = moveBodyHtml(desc, CLASH);
		expect((html.match(/Avoid, prevent, or counter/g) || []).length).toBe(1);
		expect(html).not.toContain("On a 7-9, it mostly works");
	});

	it("handles a description with no block markup at all", () => {
		const html = moveBodyHtml("Roll +INT: on a 10+, good.", KNOW_THINGS);
		expect(html).toContain('<ul class="stonetop-move-tiers">');
		expect(html.startsWith("Roll +INT:")).toBe(true);
	});
});

// A move's option list is introduced either by a tier clause ("on a 10+, pick 2; on a 7-9, pick
// 1:") or by prose that is not a tier at all ("You can spend Readiness 1-for-1 to:"). Lifting the
// tier prose into the ladder strands the first kind: the bullets end up ABOVE the rows that say
// "pick 1 from the list", pointing the reader back up the card to find what they mean.
describe("where the option list ends up", () => {
	const INTERFERE = "<p>When you foil another PC, roll...</p>"
		+ "<p>On a 10+, they pick 1 from the list below; on a 7-9, they pick 1 but you are exposed.</p>"
		+ "<ul><li>Do it anyway, with disadvantage</li><li>Relent and be foiled</li></ul>";
	const RESULTS = {
		success: { label: "10+", value: "They pick 1 from the list below." },
		partial: { label: "7-9", value: "They pick 1 but you are exposed." },
		failure: { label: "6-",  value: "The GM makes a hard move." },
	};

	const order = (html) => ({
		ladder: html.indexOf('<ul class="stonetop-move-tiers"'),
		list:   html.search(/<ul(?![^>]*stonetop-move-tiers)/i),
	});

	it("hangs the list under the ladder when a tier clause was its lead-in", () => {
		const { ladder, list } = order(moveBodyHtml(INTERFERE, RESULTS));
		expect(ladder).toBeGreaterThan(-1);
		expect(list).toBeGreaterThan(ladder);
	});

	it("moves the list whole, options and markup intact", () => {
		const html = moveBodyHtml(INTERFERE, RESULTS);
		expect(html).toContain("<ul><li>Do it anyway, with disadvantage</li><li>Relent and be foiled</li></ul>");
		expect((html.match(/Relent and be foiled/g) ?? []).length).toBe(1);
	});

	// Defend's list is a separate offer rather than the outcome of a roll, and the sentence that
	// opens it survives the strip — so it stays where its author put it, above the ladder.
	it("leaves a list whose own prose lead-in survived exactly where it was", () => {
		const defend = "<p>When you defend, roll +CON: on a 10+, hold 3 Readiness; on a 7-9, hold 1."
			+ " You can spend Readiness 1-for-1 to:</p>"
			+ "<ul><li>Suffer an attack's damage instead of your ward</li><li>Halve an attack's damage</li></ul>";
		const { ladder, list } = order(moveBodyHtml(defend, null));
		expect(ladder).toBeGreaterThan(-1);
		expect(list).toBeLessThan(ladder);
	});

	// A trailing colon is not enough on its own to hold the list: Clash keeps "roll +STR:" and
	// then loses "on a 10+, … pick 1:" from under it, so that colon introduces the LADDER.
	it("still moves the list when the surviving colon leads into the ladder instead", () => {
		const clash = "<p>When you fight, roll +STR: on a 10+, it works and pick 1:</p>"
			+ "<ul><li>Avoid the attack</li><li>Strike hard and fast</li></ul>";
		const { ladder, list } = order(moveBodyHtml(clash, CLASH));
		expect(list).toBeGreaterThan(ladder);
	});

	// All is Illuminated loses its lead-in out of the MIDDLE of the paragraph and keeps a last
	// clause that introduces nothing, so the list is stranded even though the cut was not at
	// the end.
	it("moves the list when the lead-in was cut from the middle of the paragraph", () => {
		const illuminated = "<p>When you look closely, roll +WIS: on a 10+, ask 2 questions from the"
			+ " list below; on a 7-9, ask 1. In any case, they must answer truthfully.</p>"
			+ "<ul><li>Of what are they most ashamed?</li><li>What do they most desire?</li></ul>";
		const html = moveBodyHtml(illuminated, null);
		const { ladder, list } = order(html);
		expect(list).toBeGreaterThan(ladder);
		expect(html).toContain("they must answer truthfully");
	});

	// The rider comments on the whole move, and the answers it talks about are in the list.
	it("puts the either-way rider after the moved list, not between it and the ladder", () => {
		const seekInsight = "<p>When you study a situation, roll +WIS: on a 10+, ask 3 from the list"
			+ " below; on a 7-9, ask 1; either way, gain advantage on your next move.</p>"
			+ "<ul><li>What happened here recently?</li><li>What is about to happen?</li></ul>";
		const html = moveBodyHtml(seekInsight, null);
		const { ladder, list } = order(html);
		expect(list).toBeGreaterThan(ladder);
		expect(html.indexOf("stonetop-move-tiers-note")).toBeGreaterThan(list);
	});

	it("says so on the strip itself, so the decision has one home", () => {
		expect(stripTierProse(INTERFERE, RESULTS).listLeadCut).toBe(true);
		expect(stripTierProse("<p>Pick 1:</p><ul><li>A</li></ul>", null).listLeadCut).toBe(false);
	});

	// Moved by `moveCardBody` too, ticks and cap and all: `data-index` is positional within the
	// list's own <ul>, so a message's saved ticks still land on the option they were put on.
	it("carries a ticked list under the ladder with its indices unchanged", () => {
		const html = moveCardBody(INTERFERE, RESULTS);
		const { ladder, list } = order(html);
		expect(list).toBeGreaterThan(ladder);
		expect(html).toContain('data-index="0"');
		expect(html).toContain('data-index="1"');
	});
});

// The ladder reached every SHEET surface a commit ago, and the CHAT CARD was the one that still
// printed the book's run-on sentence: rolling Defy Danger, or posting any move's text, put a
// paragraph in the log with "on a 10+ … on a 7-9 …" buried in the middle of it, while the same
// move on the moves tab laid the three rungs out in a column.
describe("moveCardBody", () => {
	const CLASH_DESC = "<p>When you fight, roll +STR: on a 10+, it works and pick 1:</p>"
		+ "<ul><li>Avoid, prevent, or counter your enemy's attack</li>"
		+ "<li>Strike hard and fast, for 1d6 extra damage, but suffer your enemy's attack</li></ul>"
		+ "<p>On a 7-9, it mostly works.</p>";

	it("ticks the move's options AND lays out its tiers", () => {
		const html = moveCardBody(CLASH_DESC, CLASH);
		expect(html).toContain("stonetop-picklist-check");
		expect(html).toContain('<ul class="stonetop-move-tiers">');
	});

	// The cap is written in the very tier prose the ladder lifts out ("on a 10+, it works and
	// pick 1:"), so stripping first would leave the list uncapped and every option tickable.
	it("reads the pick cap before the sentence stating it is lifted out", () => {
		expect(moveCardBody(CLASH_DESC, CLASH)).toContain('data-pick-max-success="1"');
	});

	// The other half of the same ordering problem: the ladder is a <ul> too, and on a move that
	// prints no options of its own it is the only list in the body.
	it("never hands the tier rows a checkbox each", () => {
		const html = moveCardBody("<p>Roll +INT: on a 10+, good; on a 7-9, less good.</p>", KNOW_THINGS);
		expect(html).toContain('<ul class="stonetop-move-tiers">');
		expect(html).not.toContain("stonetop-picklist");
	});

	it("leaves the list alone for a move that declares its own pool", () => {
		const html = moveCardBody(CLASH_DESC, CLASH, { pickable: false });
		expect(html).not.toContain("stonetop-picklist");
		expect(html).toContain('<ul class="stonetop-move-tiers">');
	});

	it("returns a move that states no outcome exactly as it was", () => {
		const plain = "<p>You are hard to kill.</p>";
		expect(moveCardBody(plain, null)).toBe(plain);
	});
});

// The ladder inherits its container's ink and indent everywhere else, which is why it declares
// almost nothing of its own. Chat is the exception: both card description containers give every
// list item a spiral bullet through a selector carrying an ID, so the row's own "content: none"
// loses to it and the "10+" that IS the row's marker grows a second marker in front of it.
describe("the ladder in a chat card", () => {
	const CSS = readCss();
	const CHAT = ":is(#chat, #chat-notifications, #chat-popout) .message ul.stonetop-move-tiers";

	// `declarations` splits a prelude at paren depth 0 (tests/fakes/css.js), so the `:is(…)`
	// these selectors are built on no longer hides them from it — and a rule that states one
	// declaration for both the sheet and the chat arm answers to either.
	const ruleFor = (selector) => declarations(CSS, selector);

	it("kills the spiral on a tier row with an ID in front of the selector", () => {
		expect(ruleFor(`${CHAT} li.stonetop-move-tier::before`)).toContain("content: none");
	});

	it("keeps the hairline over the ladder that the chat list rules would zero", () => {
		const rule = ruleFor(CHAT);
		expect(rule).toContain("border-top");
		expect(rule).toContain("margin: 5px 0 0");
	});

	it("keeps the label and its outcome on one row", () => {
		expect(ruleFor(`${CHAT} li.stonetop-move-tier`)).toContain("display: flex");
	});

	// The mark is selected by pairing the list's `data-rolled-tier` with the row's `data-tier`,
	// which is what lets a GM's Shift Up/Down move it by rewriting one attribute. Each rung
	// names its own ink and the mark reads it, so the ink is stated once per rung and the paint
	// once for all three.
	for (const tier of ["success", "partial", "failure"]) {
		it(`names the ${tier} rung's ink from the shared tier token`, () => {
			const rule = ruleFor(`ul.stonetop-move-tiers[data-rolled-tier="${tier}"] > li[data-tier="${tier}"]`);
			expect(rule).toContain(`--st-rolled-ink: var(--st-tier-${tier}-text)`);
		});
	}

	it("paints the rolled row from whichever ink its rung named", () => {
		// The failure arm is last in the shared rule's prelude, so it is the one `ruleFor` can
		// look up whole; the block it returns is the one all three rungs share.
		const rule = ruleFor(`${CHAT}[data-rolled-tier="failure"] > li[data-tier="failure"]`);
		expect(rule).toContain("box-shadow: inset");
		expect(rule).toContain("var(--st-rolled-ink)");
		// Never the hardcoded greens and reds — an inverted undead card re-points the tokens.
		expect(rule).not.toMatch(/#[0-9a-f]{3,6}/i);
	});

	// A list re-hung under the ladder is butted straight against the last rung, where it reads
	// as a fourth rung with an empty label. The gap is the only thing that says otherwise.
	it("gives a re-hung option list room to read as its own block", () => {
		expect(ruleFor("ul.stonetop-move-tiers + ul")).toContain("margin-top: 7px");
		// In chat that list is a `.stonetop-picklist` whose margin is zeroed at (1,3,0) far
		// below, so the chat arm has to carry the same three classes to outrank it.
		const chatArm = CSS.match(/\.stonetop-roll-card-description\)\s*ul\.stonetop-move-tiers \+ ul \{([^{}]*)\}/);
		expect(chatArm?.[1]).toContain("margin-top: 7px");
	});

	// A marked row is padded so the wash has room, and the padding is taken straight back out
	// as negative margin — otherwise the row would step right as the mark landed on it, and
	// step back again on a Shift. Matched by regex, not by `ruleFor`: this one rule is shared
	// by all three rungs, so its prelude is three selectors rather than the one to look up.
	it("marks a row without moving it", () => {
		const shared = CSS.match(/\[data-rolled-tier="failure"\][^{}]*\{([^{}]*margin: 3px -8px[^{}]*)\}/);
		expect(shared?.[1]).toContain("padding: 3px 8px");
	});
});

// THE SAME LADDER ON A HOVER PANEL. The tier inks are chosen for the light paper a sheet and a
// chat card are, and one of the four panels that show a move under the pointer is near-black, so
// on it the labels were the one part of the move that could not be read. A hover panel has no
// roll attached to it either, so there is no rung to pick out: the labels take the panel's ink.
describe("the ladder on a hover panel", () => {
	const CSS = readCss();
	// The two hosts the CSS names. The test below proves these are all four panels, rather than
	// the two someone happened to remember.
	const HOSTS = [".stonetop-basic-move-panel", ".stonetop-word-tooltip"];

	for (const host of HOSTS) {
		it(`drops the tier tint on ${host}`, () => {
			const rule = declarations(CSS, `${host} .stonetop-move-tier .stonetop-move-tier-label`);
			expect(rule).toContain("color: inherit");
			// Never a second palette for the dark host: `inherit` is the point, and a hex here
			// would be a third set of tier inks to keep in step with the other two.
			expect(rule).not.toMatch(/#[0-9a-f]{3,6}/i);
		});
	}

	// The rule reaches PAST the row (0,3,0) rather than tying with `.stonetop-move-tier--success
	// .stonetop-move-tier-label` at (0,2,0), so it wins on specificity wherever either rule ends
	// up in the file — this one sits beside them today, and a later move of either must not
	// silently put the tint back.
	it("out-specifies the tint rather than tying with it", () => {
		for (const host of HOSTS) {
			const prelude = CSS.match(
				new RegExp(`\\${host} \\.stonetop-move-tier \\.stonetop-move-tier-label`)
			);
			expect(prelude).not.toBeNull();
		}
	});

	// Every surface that runs the shared hover pass (utils/move-hover.js) is one of the hosts
	// above. Read off the sources rather than listed here, because the failure mode is a FIFTH
	// panel added later with a class of its own: it would show the ladder like the other four
	// and be tinted like a card, and nothing else would notice.
	it("covers every panel that runs the shared hover pass", () => {
		const SOURCES = [
			"module/actors/character/StonetopCharacterSheet.js",
			"module/actors/character/dialogs/CharacterOnboardingDialog.js",
			"module/actors/steading/StonetopSteadingSheet.js",
		];
		const sites = [];
		for (const rel of SOURCES) {
			const src = readRepo(rel);
			for (const [, ident] of src.matchAll(/prepareMoveHoverBody\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
				const named = src.match(new RegExp(`\\b${ident}\\.className\\s*=\\s*"([^"]+)"`));
				expect(named, `${rel}: no class literal found for ${ident}`).not.toBeNull();
				sites.push(`.${named[1]}`);
			}
		}
		// Four call sites, and between them only the two hosts the CSS de-tints. The count is
		// asserted so the scan cannot pass by finding nothing at all.
		expect(sites.length).toBe(4);
		for (const host of sites) expect(HOSTS).toContain(host);
	});
});

// Which rung the dice landed on, said on the ladder itself. The result block above already
// states that one outcome; the mark is what puts it back among the other two.
describe("markRolledTier", () => {
	const LADDER = '<p>Roll +INT.</p><ul class="stonetop-move-tiers">'
		+ '<li class="stonetop-move-tier stonetop-move-tier--success" data-tier="success">10+</li>'
		+ '<li class="stonetop-move-tier stonetop-move-tier--partial" data-tier="partial">7-9</li></ul>';

	it("stamps the rolled rung on the list", () => {
		expect(markRolledTier(LADDER, "partial")).toContain('<ul class="stonetop-move-tiers" data-rolled-tier="partial">');
	});

	it("leaves the rows themselves alone, so nothing has to be unmarked later", () => {
		const html = markRolledTier(LADDER, "partial");
		expect(html).toContain('<li class="stonetop-move-tier stonetop-move-tier--success" data-tier="success">');
		expect((html.match(/data-rolled-tier/g) ?? []).length).toBe(1);
	});

	it("passes a body with no ladder through untouched", () => {
		const plain = "<p>You are hard to kill.</p>";
		expect(markRolledTier(plain, "success")).toBe(plain);
	});

	it("refuses a tier it does not know, rather than stamping a class nothing paints", () => {
		// "critical" is the shifted 12+ label, and the caller is expected to fold it into the
		// strong hit — the ladder has the three rungs a move states and no fourth.
		expect(markRolledTier(LADDER, "critical")).toBe(LADDER);
		expect(markRolledTier(LADDER, "")).toBe(LADDER);
	});

	it("is idempotent, so a re-render cannot stack a second stamp", () => {
		const once = markRolledTier(LADDER, "success");
		expect(markRolledTier(once, "failure")).toBe(once);
	});

	// A GM's Shift Up/Down rewrites a landed card's tier, and every per-tier thing on that card
	// has to follow it. The ladder follows by MOVING the stamp — not by joining the hide/show
	// loop beside it, which would take two thirds of a move's printed text off the card.
	it("is moved, not re-hidden, when the GM shifts a landed card", () => {
		const boot = readRepo("stonetop.js");
		// Selected off the shared constants rather than a retyped selector, so this asserts the
		// shift handler finds the ladder and re-stamps it — not how the string was spelled.
		expect(boot).toContain("ul.${MOVE_TIERS_CLASS}[${ROLLED_TIER_ATTR}]");
		expect(boot).toContain("ladder.setAttribute(ROLLED_TIER_ATTR, activeTier)");
		// And it must NOT be swept into the hide/show loop beside it.
		expect(boot).not.toContain(`${MOVE_TIERS_CLASS} [hidden]`);
	});
});

// The rows have to be selectable by rung for any of the above to hold.
describe("the ladder's rows name their rung", () => {
	it("carries data-tier alongside the class it is painted from", () => {
		const html = moveTiersHtml(KNOW_THINGS);
		expect(html).toContain('class="stonetop-move-tier stonetop-move-tier--success" data-tier="success"');
		expect(html).toContain('data-tier="failure"');
	});
});
