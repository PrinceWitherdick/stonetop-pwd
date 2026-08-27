import { describe, it, expect } from "vitest";
import {
	balanceInlineHtml,
	moveBodyHtml,
	moveTierRows,
	moveTiersHtml,
	parseTiersFromProse,
	splitClauses,
	stripTierProse,
} from "../../module/utils/move-tiers.js";

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
