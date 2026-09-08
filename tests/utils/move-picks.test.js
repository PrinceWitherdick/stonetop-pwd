import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { isReferenceList, pickLimitsFrom, pickTiersFrom } from "../../module/utils/move-picks.js";

// How many of a move's printed options you may take is printed too, in the lead-in above the
// list. It is read from there rather than restated anywhere, so it cannot drift from the move —
// but reading prose is a guess, and the guess is DELIBERATELY TIMID: a cap that is too low
// blocks a player from taking what the move grants, which is worse than no cap at all.

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("pickLimitsFrom", () => {
	it("reads a flat count", () => {
		expect(pickLimitsFrom("When you help someone who has not yet rolled, the GM picks 1:")).toBe(1);
		expect(pickLimitsFrom("you can ask the GM 2 of the following and get a useful answer:")).toBe(2);
		expect(pickLimitsFrom("take turns asking a PC or NPC one of the following.")).toBe(1);
	});

	it("ties each count to the tier it follows", () => {
		expect(pickLimitsFrom("on a 10+, deal your damage and pick 2; on a 7-9, deal damage and pick 1:"))
			.toEqual({ success: 2, partial: 1 });
		// "10+" ends in a non-word character, so a `\b` after it can never match — the bug this
		// case exists for read every tiered move as "only the 7-9 is capped".
		expect(pickLimitsFrom("on a 10+, pick 2; on a 7-9, pick 1:")).toEqual({ success: 2, partial: 1 });
		expect(pickLimitsFrom("on a 6-, your time has come, choose 1:")).toEqual({ failure: 1 });
	});

	it("reads tiers written with an en dash, as the book writes them", () => {
		// Raw "7&ndash;9" is not "7-9" to any pattern here. Left undecoded, the preceding
		// "on a 10+" swallows the 7-9's own count and caps the strong hit with it.
		expect(pickLimitsFrom("on a 10+, your actions are your own; on a 7&ndash;9, choose 1:"))
			.toEqual({ partial: 1 });
	});

	// A per-person count is a count times the people choosing, so the question is whether the
	// sentence names them. Read per SEGMENT, so the plain "choose 1" on the tier beside it is
	// untouched by the tier that says "each".
	it("multiplies a per-person count by the pair the sentence names", () => {
		expect(pickLimitsFrom("on a 10+, you must choose 1 consequence; on a 7-9, you and the GM each choose 1."))
			.toEqual({ success: 1, partial: 2 });
		expect(pickLimitsFrom("you and the GM each pick 1 from the list:")).toBe(2);
		expect(pickLimitsFrom("you and another player each choose 2:")).toBe(4);
	});

	// And leaves it uncapped when they cannot be counted. Refusing a player what their move
	// grants is the failure this reader fears most, so an unnamed "each" gets no cap rather than
	// a guessed one — a table of five choosing one apiece must not be held to two.
	it("will not read a per-person count as a cap when the people are not named", () => {
		expect(pickLimitsFrom("each player picks 1 from the list:")).toBeNull();
		expect(pickLimitsFrom("everyone at the table each picks 1:")).toBeNull();
		expect(pickLimitsFrom("on a 10+, you must choose 1; on a 7-9, each player chooses 1."))
			.toEqual({ success: 1 });
	});

	it("falls back to the flat count when the tiers carry none of their own", () => {
		expect(pickLimitsFrom("they pick 1 from the list below; on a 10+, you also have advantage."))
			.toBe(1);
	});

	// Read against the TIER'S OWN sentence, not the whole lead-in. A tier that hands over the
	// entire list has no business speaking for its neighbours — a closing "all 3 apply" used to
	// veto the two real counts along with itself, leaving a player who rolled a 10+ with no cap
	// and no "0/1" over their boxes, on a move whose own text says choose 1.
	it("gives each tier its own count when they differ", () => {
		// Dark Succor and Undying, as the book prints them.
		expect(pickLimitsFrom("on a 10+, choose 1; on a 7-9, choose 2; on a 6-, all 3 apply:"))
			.toEqual({ success: 1, partial: 2, failure: 3 });
		expect(pickLimitsFrom("on a 10+, regain half your max HP and choose 1; on a 7-9, regain half your max HP and choose 2; on a 6-, either regain 1 HP and all 3 apply, or give up this insert."))
			.toEqual({ success: 1, partial: 2, failure: 3 });
	});

	// A tier that takes the WHOLE list states a count too — the book just spells it rather than
	// digits it. Read as nothing, those five tiers reached the card uncapped, which is the answer
	// an unreadable sentence gets; read as a number, the cap covers the list, and the card can
	// tick a roll that left nothing to choose (see grantsWholeList in tests/utils/pick-count).
	it("reads a tier that hands over the whole list as the count it is", () => {
		expect(pickLimitsFrom("on a 10+, choose 1; on a 6-, all 3 apply:")).toEqual({ success: 1, failure: 3 });
		expect(pickLimitsFrom("on a 6-, all three apply:")).toEqual({ failure: 3 });
		// Danger Sense: "both" naming the list it sits above.
		expect(pickLimitsFrom("on a 10+, ask the GM both of the questions below; on a 7-9, ask 1; either way, gain advantage on your next roll to act on the answer(s)."))
			.toEqual({ success: 2, partial: 1 });
		// Formidable: "both" as the tier's entire answer.
		expect(pickLimitsFrom("on a 10+, both; on a 7-9, pick 1:")).toEqual({ success: 2, partial: 1 });
		// Danu's Grasp in full: the shared "on a 7+" states the 7-9's count, and the 10+ that
		// follows raises its own to the whole list without disturbing it.
		expect(pickLimitsFrom("on a 7+, roots, vines, and earth pull at them, and they pick 1; on a 10+, as a 7-9, but both apply."))
			.toEqual({ success: 2, partial: 1 });
	});

	// "On a 7+" is one clause for two tiers — what a hit of either strength gets. Read as a tier
	// of its own it belonged to neither, so Danu's Grasp's "they pick 1" attached to nothing and
	// its weak hit reached the card free to tick both options, with the move's own text beside
	// the boxes saying pick one.
	it("spreads a shared 'on a 7+' across both halves of a hit", () => {
		// Alpha: the 7+ carries the count and the 10+ adds something that is not one, so the
		// count stands for both. The 6- picks nothing from the list and stays uncapped.
		expect(pickLimitsFrom("on a 7+, they must pick 1 from the list below; on a 10+, you also have advantage on your next roll against them."))
			.toEqual({ success: 1, partial: 1 });
		// A narrower tier that comes after overrides what the shared clause left it — the shape
		// Danu's Grasp, Muster and Burgle all use.
		expect(pickLimitsFrom("on a 7+, you make it back. Then, on a 10+, also pick 2; on a 7-9, also pick 1:"))
			.toEqual({ success: 2, partial: 1 });
		// A 7+ that states no count of its own leaves both halves to the tiers below it.
		expect(pickLimitsFrom("on a 7+, it answers but on a 10+, pick 1; on a 7-9, pick 2:"))
			.toEqual({ success: 1, partial: 2 });
	});

	// "Both" is a count only where it plainly stands for the options. Everywhere else it is an
	// ordinary word in an ordinary sentence, and reading it as a cap would put a number on a list
	// nobody was talking about.
	it("does not take every 'both' in a move for a count", () => {
		expect(pickLimitsFrom("on a 10+, you can spend 1 Readiness to both halve an attack's effects/damage and strike back at the attacker:")).toBeNull();
		expect(pickLimitsFrom("When you Invoke the Sun God, roll once and apply any consequences to both Invocations. Then pick 1:")).toBe(1);
		expect(pickLimitsFrom("on a 10+, you keep both hands free and pick 1:")).toEqual({ success: 1 });
		// "All" needs its number: a tally of everything true is not a count of anything.
		expect(pickLimitsFrom("on a 6-, mark all that apply:")).toBeNull();
	});

	// A tier can state itself UNDER the bullets, and Formidable is the move that does it: the
	// lead-in above the list answers for the 10+ and the 7-9, and the 6- is a paragraph beneath
	// it. Read from the lead-in alone the miss stamped no count at all, which reads as "tick
	// freely" — so a Heavy who rolled a 6- could take BOTH options on the one tier the book holds
	// hardest to one.
	it("reads a tier stated BELOW the bullets, where the lead-in was silent", () => {
		const lead = "you can choose to roll +CHA: on a 10+, both; on a 7-9, pick 1:";
		const below = "On a 6-, pick 1 but ask the GM what you've missed.";
		expect(pickLimitsFrom(lead, below)).toEqual({ success: 2, partial: 1, failure: 1 });
	});

	// FILL-INS ONLY, and only where the text below NAMES a tier. Both halves of that rule are the
	// difference between fixing Formidable and breaking Forage.
	it("lets the lead-in outrank the prose below it", () => {
		expect(pickLimitsFrom("on a 7-9, pick 1:", "On a 7-9 you may also pick 3 of these later."))
			.toEqual({ partial: 1 });
	});

	it("takes nothing at all from a sentence below the list that names no tier", () => {
		// Forage, whose closing line is about Make Camp rather than about its own options. Read as
		// one string with the lead-in that "1-for-1" lands inside the 7-9's segment and vetoes the
		// "pick 1" that tier plainly states, which is why the two halves are read apart.
		const lead = "roll+WIS. On a 10+, pick 2. On a 7-9, pick 1:";
		const below = "Provisions can substitute for supplies when you Make Camp, 1-for-1.";
		expect(pickLimitsFrom(lead, below)).toEqual({ success: 2, partial: 1 });
		expect(pickLimitsFrom(lead, below)).toEqual(pickLimitsFrom(lead));
	});

	it("is unchanged by prose below the list that says nothing about a count", () => {
		expect(pickLimitsFrom("on a 10+, pick 2; on a 7-9, pick 1:", "")).toEqual({ success: 2, partial: 1 });
		expect(pickLimitsFrom("on a 10+, pick 2; on a 7-9, pick 1:")).toEqual({ success: 2, partial: 1 });
		expect(pickLimitsFrom("", "On a 6-, pick 1.")).toBeNull();
	});

	it("refuses to cap what it cannot read confidently", () => {
		// Spent one at a time for as long as the resource lasts.
		expect(pickLimitsFrom("hold 2 Resolve. You can spend your Resolve 1-for-1 to:")).toBeNull();
		// A tally, not a choice.
		expect(pickLimitsFrom('Answer these questions as a group. For each "yes," everyone marks XP.')).toBeNull();
		// A move that ADDS to a question list rather than choosing from it.
		expect(pickLimitsFrom("When you Seek Insight, add the following to the list of questions you can ask:")).toBeNull();
		// The one shipped move whose rules DO let you go over the count — the extra options are
		// paid for, not forbidden — so it must reach the card with no cap at all.
		expect(pickLimitsFrom("the world becomes clear and pick 1. For each additional option you pick, lose 1d4 HP:")).toBeNull();
		// Two different numbers with no tier to hang them on.
		expect(pickLimitsFrom("pick 1 of these, then choose 3 of these:")).toBeNull();
		// Take the Measure: a count that GROWS on a condition nothing here can weigh, so the
		// number it opens with is a floor rather than a cap. Refusing the second question a
		// Marshal earned is the one failure worse than no cap at all.
		expect(pickLimitsFrom("ask their player one of the questions below and get an honest answer. If they fear or respect you (their call), you can ask another question.")).toBeNull();
		// No count at all.
		expect(pickLimitsFrom("hold Preparation based on the amount of time you devote:")).toBeNull();
		expect(pickLimitsFrom("")).toBeNull();
	});
});

// Two lists in this system were never a choice at all, and a checkbox on either offers something
// the move does not: a resource's SPEND MENU (what the Readiness you now hold buys, one point at
// a time, over the rest of the fight — the same line twice if you like), and a list a move ADDS
// to a different move (Situational Awareness' questions are appended to Seek Insight's list and
// chosen from there, never here).
// WHICH tiers reach the list is a different question from how many each may take, and until it
// was asked separately a tier that stated no count got the same answer as a tier that stated an
// unreadable one: "tick freely". Helior's Unblinking Eye on a 6- is "the GM makes a move", and
// its three options were still printed under a "0 options selected".
//
// The timidity runs the OTHER WAY here, because the costs are not symmetric: a tier wrongly left
// out loses a player options their move grants, while a tier wrongly left in only shows a list
// that need not have shown.
describe("pickTiersFrom", () => {
	it("names the tiers whose own clause sends the reader to the list", () => {
		expect(pickTiersFrom("on a 10+, glimpse your subject and choose 2; on a 7-9, glimpse it and choose 1."))
			.toEqual(["success", "partial"]);
		expect(pickTiersFrom("on a 6-, your time has come, choose 1:")).toEqual(["failure"]);
	});

	it("leaves out a tier that says nothing about the list at all", () => {
		// The reported case: a miss where the GM makes a move and the player picks nothing.
		expect(pickTiersFrom("on a 10+, choose 2; on a 7-9, choose 1. On a 6-, the GM makes a move."))
			.toEqual(["success", "partial"]);
		// And the same the other way up: Let Fly's 10+ is a clear shot, not a choice.
		expect(pickTiersFrom("on a 10+, you have a clear shot, deal your damage; on a 7-9, pick 1:"))
			.toEqual(["partial"]);
	});

	it("keeps a tier whose count it refuses to read as a cap", () => {
		// An "each" whose people the sentence does not name: pickLimitsFrom leaves the tier
		// uncapped rather than guess at a table's size, and that must not read as "there is
		// nothing to choose here" — the tier still sends everyone to the list.
		const lead = "on a 10+, you must choose 1 consequence; on a 7-9, each player chooses 1.";
		expect(pickLimitsFrom(lead)).toEqual({ success: 1 });
		expect(pickTiersFrom(lead)).toEqual(["success", "partial"]);
	});

	it("keeps both hits of Invoke the Sun God, whose 7-9 names the pair choosing", () => {
		const lead = "on a 10+, you must choose 1 consequence; on a 7-9, you and the GM each choose 1.";
		expect(pickLimitsFrom(lead)).toEqual({ success: 1, partial: 2 });
		expect(pickTiersFrom(lead)).toEqual(["success", "partial"]);
	});

	it("keeps a tier that hands the whole list over", () => {
		expect(pickTiersFrom("on a 10+, choose 1; on a 7-9, choose 2; on a 6-, all 3 apply:"))
			.toEqual(["success", "partial", "failure"]);
		expect(pickTiersFrom("on a 10+, both; on a 7-9, pick 1:")).toEqual(["success", "partial"]);
	});

	it("reads an 'on a 7+' as both halves of a hit, the way the count is read", () => {
		expect(pickTiersFrom("on a 7+, roots and vines pull at them and they pick 1; on a 10+, both apply."))
			.toEqual(["success", "partial"]);
	});

	it("reads the tiers a move states BELOW its bullets", () => {
		// Formidable, whose 6- is a whole paragraph under the list. Read from the lead-in alone it
		// looked like a tier that never reached the options, and "pick 1 but ask the GM what
		// you've missed" would have had its list taken away.
		expect(pickTiersFrom("on a 10+, both; on a 7-9, pick 1: On a 6-, pick 1 but ask the GM what you've missed."))
			.toEqual(["success", "partial", "failure"]);
	});

	it("takes a tier at a bare pointer, with no number to read", () => {
		expect(pickTiersFrom("on a 7-9, the GM picks something from the list below."))
			.toEqual(["partial"]);
	});

	it("says nothing at all about a move that names no tier", () => {
		// Which its caller must read as "nothing is known here", never as "no tier picks" — an
		// empty answer stamps no attribute and every tier goes on showing its list.
		expect(pickTiersFrom("When you help someone who has not yet rolled, the GM picks 1:")).toEqual([]);
		expect(pickTiersFrom("")).toEqual([]);
		expect(pickTiersFrom(null)).toEqual([]);
	});

	it("reads tiers written with an en dash, as the book writes them", () => {
		expect(pickTiersFrom("on a 10+, your actions are your own; on a 7&ndash;9, choose 1:"))
			.toEqual(["partial"]);
	});
});

describe("isReferenceList", () => {
	it("knows the shipped spend menus by their shape, not by name", () => {
		for (const lead of [
			"On a 7-9, hold 1 Readiness (or 2 with a shield). You can spend Readiness 1-for-1 to:",
			"You may spend Nerve, 1-for-1, to:",
			"Your allies can spend their Inspiration at any time, 1-for-1 to:",
			"Hold 2 Resolve. You can spend your Resolve 1-for-1 to:",
			"Spend your follower's Loyalty 1-for-1 to have them:",
			"Spend Guise, 1-for-1 to:",
		]) expect(isReferenceList(lead)).toBe(true);
	});

	it("knows a list a move adds to another move's list", () => {
		expect(isReferenceList("When you Seek Insight, add the following to the list of questions you can ask:")).toBe(true);
		expect(isReferenceList("When you Seek Insight, add the following to the list of questions you can ask."
			+ " When acting on the answer to either question, deal an extra 1d4 damage.")).toBe(true);
	});

	// A menu can be a menu without saying "1-for-1". Up With People is the shipped one: you hold
	// 2 Rapport and they hold 1, so three questions come off that one list over a conversation,
	// and boxes capped at the "one" in the sentence released each other as they were ticked.
	it("knows a spend menu that never says '1-for-1'", () => {
		expect(isReferenceList("During the conversation, either of you can spend 1 Rapport to ask"
			+ " the other player one of the following and get an honest answer.")).toBe(true);
		// A named resource with no number in front of it is the same menu.
		expect(isReferenceList("Spend your Preparation to pick one of these:")).toBe(true);
	});

	// THE CAPITAL LETTER is what separates a resource from an hour of work, and it is the only
	// case-sensitive test in the file. Stonetop capitalises what you hold and spend.
	it("will not read a lower-case 'spend' as a resource menu", () => {
		expect(isReferenceList("Spend a moment to pick one of the following:")).toBe(false);
		expect(isReferenceList("Spend 2 hours preparing, then choose one of these:")).toBe(false);
		expect(isReferenceList("Spend 1 stock to pick one of the following:")).toBe(false);
	});

	// A list the group goes round rather than choosing from once. One set of boxes cannot record
	// who asked what, and a cap of 1 asked the second person to un-tick the first person's.
	it("knows a list the table takes turns over", () => {
		expect(isReferenceList("Take turns asking a PC or NPC one of the following.")).toBe(true);
		expect(isReferenceList("If they do, take turns asking one of these and answer honestly:")).toBe(true);
		// "Turn" in its other sense is not this: one scene, picked once, on your go.
		expect(isReferenceList("Go around the table. On your turn, pick one of the following:")).toBe(false);
	});

	// The near misses run CLOSE, which is why the verb is part of each pattern rather than "the
	// following" on its own: asking 1 of the following IS a choice, and keeps its boxes.
	it("leaves 'ask N of the following' alone — that one is a choice", () => {
		for (const lead of [
			"You can ask the GM 1 of these and get an honest answer:",
			"Ask the GM one of the following; gain advantage on your next roll to act on the answer.",
			"You can ask the GM 2 of the following and get a useful answer:",
		]) expect(isReferenceList(lead)).toBe(false);
	});

	// NARROWER than the UNBOUNDED veto beside it, which refuses a COUNT for several reasons that
	// have nothing to do with this one. Conflating the two would strip the boxes off the most
	// tickable list in the book.
	it("is not the same question as 'the count could not be read'", () => {
		expect(isReferenceList('Answer these questions as a group. For each "yes," everyone marks XP.')).toBe(false);
		expect(isReferenceList("On a 10+, choose 1; on a 7-9, choose 2; on a 6-, all 3 apply:")).toBe(false);
		expect(isReferenceList("They pick 1; on a 10+, as a 7-9, but both apply.")).toBe(false);
		expect(isReferenceList("")).toBe(false);
	});

	// Sentence-bounded, so neither verb can reach across a full stop to meet its other half.
	it("does not reach across a full stop to pair the halves of either pattern", () => {
		expect(isReferenceList("Spend 1 Stock to craft it. Damage is dealt 1-for-1 against Armor:")).toBe(false);
		expect(isReferenceList("Spend 1 Stock and choose 1:")).toBe(false);
		expect(isReferenceList("Add 1 to your damage. Pick one of the following:")).toBe(false);
	});
});

// The whole point of the guard: what the parse ACTUALLY derives for the shipped moves, pinned so
// a change to the reader (or to a move's text) shows up here as a diff rather than as a table
// quietly unable to tick what its move allows.
describe("what the shipped moves derive", () => {
	const strip = h => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	const derived = new Map();
	const offered = new Map();
	const prose = new Set();
	const walk = d => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) { walk(p); continue; }
			if (!e.name.endsWith(".json")) continue;
			let j; try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
			if (j?.type !== "move") continue;
			const desc = j.system?.description ?? "";
			const ul = /<ul\b[^>]*>([\s\S]*?)<\/ul>/i.exec(desc);
			if (!ul || /<ul\b/i.test(ul[1]) || !/<li\b/i.test(ul[1])) continue;
			const lead = strip(desc.slice(0, ul.index));
			// Lead-in AND the prose below the bullets, for BOTH questions and the way
			// chat.js#pickableMoveDescription asks them: Formidable, Burgle and Trade & Barter all
			// state their 6- under the list. (The cap reader takes the two halves apart rather than
			// joined, which is why it is handed them as two arguments — see pickLimitsFrom.)
			const below = strip(desc.slice(ul.index + ul[0].length));
			derived.set(j.name, pickLimitsFrom(lead, below));
			offered.set(j.name, pickTiersFrom(`${lead} ${below}`));
			if (isReferenceList(lead)) prose.add(j.name);
		}
	};
	walk(path.resolve(HERE, "../../packs/src/stonetop-items"));

	it.each([
		["Aid", 1], ["Censure", 1], ["Mighty Thews", 1], ["Read the Land", 1],
		["Under Your Skin", 1], ["Rapier Wit", 1], ["Make Camp", 1],
		// Keep Company and Up With People still READ as 1, and the number is right for one asking
		// — but both lists are returned to, so neither reaches a checklist to be capped by it.
		// The roster below is the pin that matters for those two.
		["Keep Company", 1], ["Up With People", 1],
		["Meet with Disaster", 1], ["Stentorian", 1], ["Clash", { success: 1 }],
		["Magpie", 2], ["Warden of the Wild", 2],
		["Ambush", { success: 2, partial: 1 }], ["Forage", { success: 2, partial: 1 }],
		["Burgle", { success: 2, partial: 1 }], ["Call the Shot", { success: 2, partial: 1 }],
		["Muster", { success: 2, partial: 1 }], ["Seek Insight", { success: 3, partial: 1 }],
		["Interfere", { success: 1, partial: 1 }], ["Urges", { partial: 1 }],
		// The four that state their count once, in an "on a 7+" that covers both halves of a
		// hit. Alpha and Danu's Grasp carry the count IN that clause, so both tiers take it (and
		// the 6-, which picks nothing from the list, is left free); Muster and Burgle say
		// nothing countable there and are capped by the narrower tiers that follow.
		["Alpha", { success: 1, partial: 1 }],
		// "Ask THEIR PLAYER 1 question from the list below, plus <a question not on it>".
		["All is Illuminated", { success: 1, partial: 1 }],
		// "You and the GM each choose 1": one apiece, and the sentence names the pair, so its 7-9
		// is two consequences off the one shared list — not the four it used to allow.
		["Invoke the Sun God", { success: 1, partial: 2 }],
		["Death's Door", { failure: 1 }], ["Let Fly", { partial: 1 }], ["Deploy", { partial: 1 }],
		// The five that hand a whole tier's list over, in the book's own words. Each cap here
		// EQUALS the number of options printed below it, which is what tells the card there is
		// nothing left to choose and the boxes should come ticked.
		["Danger Sense", { success: 2, partial: 1 }],
		// Formidable's 6- is the one cap stated UNDER the bullets, and the only reason its miss is
		// held to the one option the book allows it.
		["Formidable", { success: 2, partial: 1, failure: 1 }],
		// Danu's Grasp is the only one of the five whose whole-list tier sits beside a count for
		// the OTHER half of the same hit: "on a 7+ … they pick 1; on a 10+, as a 7-9, but both
		// apply". A 10+ ticks both boxes; a 7-9 still chooses between them.
		["Danu's Grasp", { success: 2, partial: 1 }],
		["Dark Succor", { success: 1, partial: 2, failure: 3 }],
		["Undying", { success: 1, partial: 2, failure: 3 }],
	])("%s caps at %o", (name, expected) => {
		expect(derived.has(name), `${name} prints no option list`).toBe(true);
		expect(derived.get(name)).toEqual(expected);
	});

	// Left uncapped on purpose — each says "as often as you like" in its own way, or says
	// nothing this reader is willing to guess at.
	it.each([
		"Anger is a Gift", "Defend", "Silver Tongued", "We Happy Few", "Strengthen Your Bond",
		"End of Session", "Situational Awareness", "Predator", "Order Followers", "Outfit",
		"Bolster", "Disembodied", "Denouement",
		"Take the Measure",
	])("%s ticks freely", name => {
		expect(derived.has(name), `${name} prints no option list`).toBe(true);
		expect(derived.get(name)).toBeNull();
	});

	// The other half of what a shipped move derives: which tiers reach its list at all. Pinned
	// move by move because this is what decides whether a roll card SHOWS its options, and a
	// mistake either way is visible at the table.
	it.each([
		// A miss that ends the question. Every one of these is "the GM makes a move" or its
		// equivalent, and every one of them used to print the move's options under a
		// "0 options selected" as though the player still had a choice.
		["Helior's Unblinking Eye", ["success", "partial"]],
		["Forage", ["success", "partial"]],
		["Seek Insight", ["success", "partial"]],
		["Danger Sense", ["success", "partial"]],
		["Muster", ["success", "partial"]],
		["Burgle", ["success", "partial"]],
		["Danu's Grasp", ["success", "partial"]],
		["Interfere", ["success", "partial"]],
		["Ambush", ["success", "partial"]],
		["Alpha", ["success", "partial"]],
		["Call the Shot", ["success", "partial"]],
		["The Hammer and the Book", ["success", "partial"]],
		["All is Illuminated", ["success", "partial"]],
		["Work With What You've Got", ["success", "partial"]],
		// A hit that ends it too: a clear shot, a job done, a fair price, actions that are
		// your own. The list belongs to the weak hit alone.
		["Let Fly", ["partial"]],
		["Deploy", ["partial"]],
		["Pull Together", ["partial"]],
		["Trade & Barter", ["partial"]],
		["Urges", ["partial"]],
		["Clash", ["success"]],
		// And the one whose list belongs to the MISS: only a 6- opens the Last Door.
		["Death's Door", ["failure"]],
		// Three tiers, three offers. Formidable states its 6- below the bullets, which is why
		// the read runs over the whole move and not just the lead-in.
		["Formidable", ["success", "partial", "failure"]],
		["Dark Succor", ["success", "partial", "failure"]],
		["Seasons Change", ["success", "partial", "failure"]],
		["Undying", ["success", "partial", "failure"]],
		// Its 6- is "the GM makes a move" and reaches no list at all; the two hits both do.
		["Invoke the Sun God", ["success", "partial"]],
	])("%s offers its list on %o", (name, expected) => {
		expect(offered.has(name), `${name} prints no option list`).toBe(true);
		expect(offered.get(name)).toEqual(expected);
	});

	// A move that never splits by tier says nothing here, and a caller reads that as "nothing is
	// known" rather than "no tier picks" — so these go on showing their list on every result.
	it.each([
		"Aid", "Keep Company", "Make Camp", "Outfit", "Order Followers", "Bolster",
		"Meet with Disaster", "Rapier Wit", "Under Your Skin", "Mighty Thews", "Censure",
		"Read the Land", "Stentorian", "Take the Measure", "Warden of the Wild", "Magpie",
		"Blot Out the Sun", "Disembodied", "Denouement", "End of Session",
	])("%s names no tier, so nothing is hidden from it", name => {
		expect(offered.has(name), `${name} prints no option list`).toBe(true);
		expect(offered.get(name)).toEqual([]);
	});

	// EVERY shipped list that prints as prose rather than as a checklist, pinned as a whole set
	// rather than one by one: this is the roster the reader has to keep exactly, and the failure
	// worth catching is a NEW name appearing in it. A move that quietly stopped being tickable
	// loses its table the boxes and the tally both, and nothing else in the suite would notice.
	it("prints exactly these lists as prose, with no boxes on them", () => {
		expect([...prose].sort()).toEqual([
			// Resources spent one point at a time, over and over, for as long as they last.
			"Anger is a Gift", "Defend", "Silver Tongued", "Strengthen Your Bond", "We Happy Few",
			// The same menu, said without the words "1-for-1".
			"Up With People",
			// A list the group goes round for as long as the stretch of time lasts.
			"Keep Company",
			// Questions appended to Seek Insight's list and chosen from THERE, never here.
			"Predator", "Situational Awareness",
		].sort());
	});
});
