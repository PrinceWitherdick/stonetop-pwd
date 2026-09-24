import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeActorBuilder } from "../fakes/FakeActorBuilder.js";
import { rollDamage, rollFormula, rollSeasonsCard, rollStat, sign, SPRING_SEASONS_RESULT } from "../../module/utils/roll-engine.js";
import { moveCardBody } from "../../module/utils/move-tiers.js";
import fs from "node:fs";
import path from "node:path";

let rollMessages;
let rollTotal;
let rollInstances;
let rollDice;

beforeEach(() => {
	rollMessages = [];
	rollTotal = 6;
	rollInstances = [];
	rollDice = [{ results: [{ result: 2, active: true }, { result: 4, active: true }] }];
	global.game.settings = { get: vi.fn(() => "publicroll") };
	global.ChatMessage = {
		getSpeaker: vi.fn(({ actor } = {}) => ({ alias: actor?.name ?? "Speaker" })),
		create: vi.fn(),
	};
	global.Roll = class {
		constructor(formula, data = {}, options = {}) {
			this.formula = formula;
			this.data = data;
			this.options = options;
			this.total = rollTotal;
			this.dice = rollDice;
			rollInstances.push(this);
		}

		async evaluate() {
			return this;
		}

		async toMessage(message) {
			rollMessages.push(message);
		}
	};
});

function makeActor() {
	return new FakeActorBuilder()
		.withXp(2, 8)
		.withLevel(1)
		.build();
}

// Clash's 10+ outcome, verbatim from the shipped move. Its options live in its own prose rather
// than in `system.pickOptions`, so the card has no declared pool to build a checklist from -- the
// bullets are ticked up in the move's description instead (utils/chat.js#pickableMoveDescription),
// which is a list this module never built and so never has to suppress.
const CLASH_SUCCESS = "Your maneuver works as expected (deal your damage) and pick 1: "
	+ "Avoid, prevent, or counter your enemy's attack / "
	+ "Strike hard and fast, for 1d6 extra damage, but suffer your enemy's attack.";

describe("sign", () => {
	it("formats positive, zero, and negative modifiers", () => {
		expect(sign(2)).toBe("+2");
		expect(sign(0)).toBe("+0");
		expect(sign(-1)).toBe("-1");
	});
});

describe("rollStat", () => {
	it("posts the miss XP award using the styled Stonetop roll card", async () => {
		const actor = makeActor();

		await rollStat("str", actor);

		const rollMessage = rollMessages[0];
		expect(rollMessage.flavor).toContain("stonetop-roll-card");
		expect(rollMessage.flavor).toContain("result failure");
		expect(rollMessage.flavor).toContain("Miss");
		expect(actor.update).toHaveBeenCalledWith({ "system.attributes.xp.value": 3 }, {});
		expect(ChatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
			content: expect.stringContaining("stonetop-roll-card"),
		}));
		const xpMessage = ChatMessage.create.mock.calls[0][0];
		expect(xpMessage.content).toContain("result success");
		expect(xpMessage.content).toContain("+1 XP (3 / 8)");
	});

	it("attributes the miss XP to the rolled move so the ledger can name it", async () => {
		const actor = makeActor();

		await rollStat("str", actor, { moveName: "Defy Danger" });

		expect(actor.update).toHaveBeenCalledWith({ "system.attributes.xp.value": 3 }, { stonetopMove: "Defy Danger" });
	});

	it("shows each rolled die face as a tooltip on the result total", async () => {
		rollTotal = 8;
		rollDice = [{ results: [{ result: 3, active: true }, { result: 5, active: true }] }];

		await rollStat("str", makeActor(), { noXpOnMiss: true });

		expect(rollMessages[0].flavor).toContain('class="stonetop-roll-result-number" data-tooltip="3, 5"');
	});

	it("brackets the dropped die on an advantage/disadvantage roll", async () => {
		rollTotal = 9;
		rollDice = [{ results: [
			{ result: 2, active: false, discarded: true },
			{ result: 4, active: true },
			{ result: 5, active: true },
		] }];

		await rollStat("str", makeActor(), { rollMode: "adv", noXpOnMiss: true });

		expect(rollMessages[0].flavor).toContain('data-tooltip="(2), 4, 5"');
	});

	it.each([
		{ total: 6, label: "Miss",       resultClass: "failure" },
		{ total: 7, label: "Weak Hit",   resultClass: "partial" },
		{ total: 10, label: "Strong Hit", resultClass: "success" },
	])("renders $label for a total of $total", async ({ total, label, resultClass }) => {
		rollTotal = total;

		await rollStat("wis", makeActor(), { noXpOnMiss: true });

		expect(rollMessages[0].flavor).toContain(`result ${resultClass}`);
		expect(rollMessages[0].flavor).toContain(label);
	});

	it("uses the expected formula, data, and roll options", async () => {
		rollTotal = 10;

		await rollStat("dex", makeActor(), {
			rollMode: "adv",
			statValue: 2,
			modifier: 3,
			stonetopDebility: "Weakened",
			stonetopDebilityTooltip: "Shaky",
		});

		expect(rollInstances[0]).toMatchObject({
			formula: "3d6kh2+@stat+@mod",
			data: { stat: 2, mod: 3 },
			options: {
				stonetopDebility: "Weakened",
				stonetopDebilityTooltip: "Shaky",
			},
		});
	});

	it("renders move descriptions and roll condition pills", async () => {
		rollTotal = 10;

		await rollStat("str", makeActor(), {
			moveName: "Clash",
			moveDescription: "<p>Trade blows.</p>",
			rollMode: "dis",
			modifier: 4,
			forward: 1,
			ongoing: 2,
		});

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain("Clash");
		expect(flavor).toContain("stonetop-roll-card-description");
		expect(flavor).toContain("<p>Trade blows.</p>");
		expect(flavor).toContain("stonetop-roll-conditions");
		expect(flavor).toContain("Disadvantage");
		expect(flavor).toContain("Forward +1");
		expect(flavor).toContain("Ongoing +2");
		expect(flavor).toContain("Situational +1");
	});

	it("does not award XP when noXpOnMiss is true", async () => {
		const actor = makeActor();

		await rollStat("str", actor, { noXpOnMiss: true });

		expect(actor.update).not.toHaveBeenCalled();
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("renders the matched-tier move outcome and stashes every tier for shifting", async () => {
		rollTotal = 10;
		const moveResults = {
			success: { value: "You pull it off." },
			partial: { value: "A cost or consequence." },
			failure: { value: "Things get worse." },
		};

		await rollStat("str", makeActor(), { noXpOnMiss: true, moveResults });

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain("You pull it off.");
		expect(flavor).toContain('data-outcome-success="You pull it off."');
		expect(flavor).toContain('data-outcome-partial="A cost or consequence."');
		expect(flavor).toContain('data-outcome-failure="Things get worse."');
	});

	// The card's description carries the move's whole ladder (utils/move-tiers.js), and the roll
	// is what says which of its rungs actually happened. Without the mark the reader is left
	// matching the total against the labels themselves, on the one card that already knows.
	it("marks the rung the dice landed on in the move's own ladder", async () => {
		rollTotal = 8;
		const description = '<p>Roll +STR.</p><ul class="stonetop-move-tiers">'
			+ '<li class="stonetop-move-tier stonetop-move-tier--partial" data-tier="partial">7-9</li></ul>';

		await rollStat("str", makeActor(), { noXpOnMiss: true, moveDescription: description });

		expect(rollMessages[0].flavor).toContain('<ul class="stonetop-move-tiers" data-rolled-tier="partial">');
	});

	it("leaves a description with no ladder alone", async () => {
		rollTotal = 8;

		await rollStat("str", makeActor(), { noXpOnMiss: true, moveDescription: "<p>Roll +STR.</p>" });

		expect(rollMessages[0].flavor).not.toContain("data-rolled-tier");
	});

	it("shows the failure outcome on a miss", async () => {
		rollTotal = 6;

		await rollStat("str", makeActor(), {
			noXpOnMiss: true,
			moveResults: { failure: { value: "Disaster strikes." } },
		});

		expect(rollMessages[0].flavor).toContain("Disaster strikes.");
	});

	it("escapes HTML in outcome text", async () => {
		rollTotal = 10;

		await rollStat("str", makeActor(), {
			noXpOnMiss: true,
			moveResults: { success: { value: "A & B < C" } },
		});

		expect(rollMessages[0].flavor).toContain("A &amp; B &lt; C");
	});

	it("renders tier actions for the matching result tier", async () => {
		rollTotal = 6;

		await rollStat("str", makeActor(), {
			noXpOnMiss: true,
			resultLegend: "<strong>Results</strong>",
			tierActions: {
				failure: '<button type="button" class="stonetop-requisition-miss-cost">Take it on a miss</button>',
			},
		});

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain("stonetop-roll-card-results");
		expect(flavor).toContain("<strong>Results</strong>");
		expect(flavor).toContain("stonetop-roll-tier-actions");
		expect(flavor).toContain('data-active-tier="failure"');
		expect(flavor).toContain("stonetop-requisition-miss-cost");
		expect(flavor).toContain(">Take it on a miss</button>");
		expect(flavor).not.toContain('data-tier="failure" hidden');
	});

	it("renders non-matching tier actions hidden, so a GM shift can reveal them", async () => {
		rollTotal = 10;

		await rollStat("str", makeActor(), {
			noXpOnMiss: true,
			tierActions: {
				failure: '<button type="button" class="stonetop-requisition-miss-cost">Take it on a miss</button>',
			},
		});

		const flavor = rollMessages[0].flavor;
		// The container is present with the rolled tier active, and the failure action sits in the
		// DOM but hidden — ready for _shiftRollCardFlavor to unhide it if the card is shifted down.
		// The hide is VALUED (hidden="hidden"), not a bare boolean: Foundry v14's flavor sanitizer
		// (sanitize-html) strips valueless attributes, so a bare `hidden` would vanish and every
		// tier would render visible in chat.
		expect(flavor).toContain("stonetop-roll-tier-actions");
		expect(flavor).toContain('data-active-tier="success"');
		expect(flavor).toContain('data-tier="failure" hidden="hidden"');
		expect(flavor).toContain("stonetop-requisition-miss-cost");
	});

	// A love letter draws every tier from ONE list, and the tier only says how many to take.
	it("renders a shared pick pool once, always visible", async () => {
		rollTotal = 10;

		await rollStat("str", makeActor(), {
			noXpOnMiss: true,
			pickOptions: ["Alpha", "Beta"],
			moveResults: { success: { value: "", pick: 1 }, partial: { value: "", pick: 0 }, failure: { value: "", pick: 0 } },
		});

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain("stonetop-roll-card-picklist");
		expect(flavor).toContain('data-index="0"');
		expect(flavor).toContain('data-index="1"');
		// One list, no per-tier wrapper, and the tier's outcome names the count.
		expect(flavor).not.toContain("stonetop-roll-tier-picklists");
		expect(flavor).toContain("Pick 1 from the list below");
	});

	// A homefront move names a list per tier: Deploy chooses its 10+/7-9 outcome from one list
	// and its 6- consequences from another, so only the rolled tier's is on show.
	it("renders per-tier pick pools with all but the rolled tier hidden", async () => {
		rollTotal = 6;

		await rollStat("str", makeActor(), {
			noXpOnMiss: true,
			pickOptions: {
				success: ["It is more effective than expected."],
				partial: ["It is more effective than expected."],
				failure: ["Injuries abound.", "A named NPC dies."],
			},
		});

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain("stonetop-roll-tier-picklists");
		expect(flavor).toContain('data-active-tier="failure"');
		// Valued hidden, for the same sanitize-html reason the tier actions carry.
		expect(flavor).toContain('data-tier="success" hidden="hidden"');
		expect(flavor).toContain('data-tier="partial" hidden="hidden"');
		expect(flavor).not.toContain('data-tier="failure" hidden');
		expect(flavor).toContain("Injuries abound.");
		// data-index runs across the WHOLE card, hidden tiers included, so the persisted
		// checked-state array lines up with whichever list is showing.
		for (const i of [0, 1, 2, 3]) expect(flavor).toContain(`data-index="${i}"`);
		expect(flavor).not.toContain('data-index="4"');
	});

	it("leaves out a tier that names no pick pool, and the wrapper when none do", async () => {
		rollTotal = 10;

		await rollStat("str", makeActor(), {
			noXpOnMiss: true,
			pickOptions: { partial: ["Only on a 7-9."] },
		});
		expect(rollMessages[0].flavor).not.toContain('data-tier="success"');
		expect(rollMessages[0].flavor).toContain('data-tier="partial" hidden="hidden"');

		rollMessages.length = 0;
		await rollStat("str", makeActor(), { noXpOnMiss: true, pickOptions: {} });
		expect(rollMessages[0].flavor).not.toContain("stonetop-roll-card-picklist");
	});

	// The result block and the boxes below it are the same list; printing it in both makes the
	// card say every option twice, once unclickable. The block keeps the lead-in only.
	it("prints the lead-in alone in the result block when the boxes below list the options", async () => {
		rollTotal = 10;

		await rollStat("str", makeActor(), {
			noXpOnMiss: true,
			pickOptions: ["Avoid, prevent, or counter your enemy's attack", "Strike hard and fast"],
			moveResults: {
				success: { value: "Your maneuver works as expected and pick 1: Avoid, prevent, or counter your enemy's attack / Strike hard and fast" },
				partial: { value: "" },
				failure: { value: "" },
			},
		});

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain("stonetop-roll-result-lead");
		expect(flavor).not.toContain("stonetop-roll-result-picks");
		// The options appear exactly where they can be ticked, and nowhere else.
		expect(flavor).toContain("stonetop-picklist-check");
		// Every tier a shared pool serves is stamped, so a GM Shift Up/Down keeps the block short.
		expect(flavor).toContain('data-picked-tiers="success partial failure"');
	});

	// ...but a tier with no boxes of its own still shows its options, or they would be nowhere.
	it("keeps the options in the result block on a tier the card lists no boxes for", async () => {
		rollTotal = 6;

		await rollStat("str", makeActor(), {
			noXpOnMiss: true,
			pickOptions: { success: ["Alpha", "Beta"] },
			moveResults: {
				success: { value: "" },
				partial: { value: "" },
				failure: { value: "The GM will choose 1: a hard bargain / a worse spot" },
			},
		});

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain("stonetop-roll-result-picks");
		expect(flavor).toContain("a hard bargain");
		expect(flavor).toContain('data-picked-tiers="success"');
	});

	// The SHIPPED Clash, made pickable exactly as StonetopItem.roll makes it: its options are in
	// its own prose, so the boxes go up in the description rather than into a declared pool.
	const CLASH = JSON.parse(fs.readFileSync(
		path.resolve("packs/src/stonetop-items/basic-moves/clash.json"), "utf8")).system;

	it("prints the lead-in alone when the description already offers that tier's options", async () => {
		rollTotal = 10;

		await rollStat("str", makeActor(), {
			noXpOnMiss: true,
			moveResults: CLASH.moveResults,
			moveDescription: moveCardBody(CLASH.description, CLASH.moveResults, { pickable: true }),
			tierActions: { success: "<button>Roll your damage</button>" },
		});

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain("stonetop-roll-result-lead");
		// Said once: the boxes above are the list, so the block does not spell it out again.
		expect(flavor).not.toContain("stonetop-roll-result-picks");
		// ...and only for the tier that offers them. Clash's 7-9 names no pick, so a GM's Shift
		// Down onto it must not be told its list is elsewhere.
		expect(flavor).toContain('data-picked-tiers="success"');
	});

	// ⚠ AND THE READER WHO TURNED DESCRIPTIONS OFF MUST STILL SEE THE BOXES. The list the block
	// above just stopped spelling out lives INSIDE `.stonetop-roll-card-description`, and the client
	// setting hides that whole — so without an exemption a 10+ on Clash reads "...and pick 1." with
	// nothing anywhere on the card to pick from, until the reader thinks to press the "?".
	it("keeps that list on the card for a reader who hid descriptions", () => {
		const css = fs.readFileSync(path.resolve("styles/stonetop.css"), "utf8");
		// The framed box comes back when there is a live list in it...
		// (or a list someone else answers in, pc-asks/pc-ask-flow.js)...
		expect(css).toContain(".stonetop-roll-card-description:has(:is(.stonetop-picklist, .stonetop-pc-answers):not([hidden]))");
		// ...and nothing else in it comes back with it.
		expect(css).toContain(
			".stonetop-roll-card-description > *:not(.stonetop-picklist, .stonetop-pc-answers):not(:has(:is(.stonetop-picklist, .stonetop-pc-answers):not([hidden])))"
		);
	});

	it("keeps the options in the block when the description carries no boxes", async () => {
		rollTotal = 10;

		await rollStat("str", makeActor(), {
			noXpOnMiss: true,
			moveResults: { success: { value: CLASH_SUCCESS }, partial: { value: "" }, failure: { value: "" } },
			moveDescription: CLASH.description,
		});

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain("stonetop-roll-result-picks");
		expect(flavor).toContain("Strike hard and fast");
		expect(flavor).not.toContain("data-picked-tiers");
	});

	it("omits the outcome line when the move has no moveResults", async () => {
		rollTotal = 10;

		await rollStat("str", makeActor(), { noXpOnMiss: true });

		expect(rollMessages[0].flavor).toContain('<span class="stonetop-roll-result-details"></span>');
	});

	// A Would-Be Hero who owns an unmarked Potential for Greatness.
	function makeWouldBeHero(level = 3) {
		return new FakeActorBuilder()
			.withPlaybook("the-would-be-hero", "The Would-Be Hero")
			.withLevel(level)
			.withItems([{ type: "move", name: "Potential for Greatness", system: { markOptions: [
				{ slug: "stat", marks: 4, choice: "stat" }, { slug: "hp", marks: 1 }, { slug: "damage", marks: 1 },
			] } }])
			.build();
	}

	const pfgReminder = () => ChatMessage.create.mock.calls.find(c => c[0].content?.includes("Potential for Greatness"));

	it("reminds a Would-Be Hero to mark Potential for Greatness on a 10+ stat roll", async () => {
		rollTotal = 11;
		await rollStat("str", makeWouldBeHero(), { noXpOnMiss: true });
		expect(pfgReminder()).toBeTruthy();
	});

	it("does not remind on a miss (6-) even for a Would-Be Hero", async () => {
		rollTotal = 6;
		await rollStat("str", makeWouldBeHero(), { noXpOnMiss: true });
		expect(pfgReminder()).toBeFalsy();
	});
});

describe("rollSeasonsCard", () => {
	it("posts the full result legend on seasonal roll cards", async () => {
		rollTotal = 7;

		await rollSeasonsCard({
			formula: "2d6 + 1",
			title: "Seasons Change — Spring",
			resultTable: SPRING_SEASONS_RESULT,
		});

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain("stonetop-roll-card-results");
		expect(flavor).toContain("<strong>Results</strong>");
		expect(flavor).toContain("Pick <strong>one seasonal gain</strong>");
		expect(flavor).toContain("<strong>Threats abound</strong>");
	});
});

// Herd of Horses: "When you Requisition half the herd or less, treat a 6- as a 7-9." Applied to
// the TIER, so everything the card keys off a tier reads the 7-9, and said on the card.
describe("a 6- that counts as a 7-9", () => {
	const steadingActor = () => ({ type: "stonetop", name: "Stonetop", system: {} });

	it("reads a miss as a weak hit on a stat roll, and says why", async () => {
		rollTotal = 5;
		await rollStat("fortunes", steadingActor(), { statValue: 0, moveName: "Requisition", missCountsAsPartial: "Half the herd or less" });
		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain("result partial");
		expect(flavor).toContain("Rolled a 6-, counted as a 7-9 (Half the herd or less)");
	});

	it("leaves a real hit alone, and says nothing", async () => {
		rollTotal = 8;
		await rollStat("fortunes", steadingActor(), { statValue: 0, moveName: "Requisition", missCountsAsPartial: "Half the herd or less" });
		expect(rollMessages[0].flavor).not.toContain("counted as a 7-9");
	});

	it("does the same on the expedition guide's card", async () => {
		rollTotal = 4;
		const rolled = await rollSeasonsCard({
			formula: "2d6", alias: "Requisition", missCountsAsPartial: "Half the herd or less",
			resultTable: {
				success: { label: "10+", line: "Go." },
				partial: { label: "7-9", line: "Convince them." },
				failure: { label: "6-", line: "No." },
			},
		});
		expect(rolled.tier).toBe("partial");
		expect(rollMessages[0].flavor).toContain("Convince them.");
		expect(rollMessages[0].flavor).toContain("counted as a 7-9");
	});
});

describe("rollDamage", () => {
	it("posts damage rolls using the Stonetop card shell", async () => {
		await rollDamage("d6+1", makeActor(), { label: "Hammer" });

		expect(rollInstances[0].formula).toBe("d6+1");
		expect(rollMessages[0]).toMatchObject({
			rollMode: "publicroll",
			speaker: { alias: "Brakken" },
		});
		expect(rollMessages[0].flavor).toContain("stonetop-roll-card");
		expect(rollMessages[0].flavor).toContain("Hammer");
		expect(rollMessages[0].flavor).toContain("stonetop-card-buttons");
	});

	it("rolls a disadvantaged die twice and keeps the lower, with a pill", async () => {
		await rollDamage("d6", makeActor(), {
			label: "Icy touch",
			keywords: "hand, ignores armor",
			rollMode: "dis",
		});

		expect(rollInstances[0].formula).toBe("2d6kl1");
		expect(rollMessages[0].flavor).toContain("Icy touch");
		expect(rollMessages[0].flavor).toContain("stonetop-condition-disadvantage");
	});

	it("rolls an advantaged die twice and keeps the higher, preserving the modifier", async () => {
		await rollDamage("d8+2", makeActor(), { label: "Maw", rollMode: "adv" });

		expect(rollInstances[0].formula).toBe("2d8kh1+2");
		expect(rollMessages[0].flavor).toContain("stonetop-condition-advantage");
	});

	// The one-off adjustment from the pre-roll damage window (RollDialog.js#promptDamage) — the
	// only route a bonus the sheet cannot know about ("when you roil with anger, you do +1
	// damage until you calm down") has to the dice. Folded in HERE rather than by each caller,
	// so the formula and the pills that explain it are built once.
	it("folds a flat bonus into the formula and names it on the card", async () => {
		await rollDamage("d10", makeActor(), { label: "Clash: hafted spear", bonus: 1 });

		expect(rollInstances[0].formula).toBe("d10+1");
		expect(rollMessages[0].flavor).toContain("Damage +1");
	});

	it("folds extra dice in and names them", async () => {
		await rollDamage("d10", makeActor(), { label: "Storm's Fury", extraDice: "1d6" });

		expect(rollInstances[0].formula).toBe("d10+1d6");
		expect(rollMessages[0].flavor).toContain("Extra +1d6");
	});

	it("keeps advantage on the DAMAGE die when extra dice ride along", async () => {
		// Not "2d10kh1+2d6kh1": Stonetop's advantage is "roll your damage twice, take the
		// higher", and the die that is rolled twice is the damage die, not the bonus dice.
		await rollDamage("d10", makeActor(), { rollMode: "adv", bonus: 1, extraDice: "1d6" });

		expect(rollInstances[0].formula).toBe("2d10kh1+1d6+1");
	});

	it("drops a half-typed dice term rather than throwing on it", async () => {
		await rollDamage("d6", makeActor(), { extraDice: "1d" });

		expect(rollInstances[0].formula).toBe("d6");
		expect(rollMessages[0].flavor).not.toContain("Extra");
	});

	it("says nothing extra when nothing was added", async () => {
		await rollDamage("d6", makeActor(), { label: "Hammer" });

		expect(rollMessages[0].flavor).not.toContain("stonetop-condition-situational");
	});

	// A stat block's attack reaches the card in two halves (utils/damage.js#damageCardText): its name
	// for the title and its tags for the body. The die is the formula chip's to print, not the title's.
	it("prints an attack's keywords beside the total, and only its name in the title", async () => {
		await rollDamage("d8", makeActor(), { label: "Garrote", keywords: "hand, grabby, ignores armor" });

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain(`<h2 class="cell__title">Garrote</h2>`);
		const resultBody = flavor.slice(flavor.indexOf(`class="stonetop-roll-result-body"`));
		expect(resultBody).toContain("stonetop-damage-keywords");
		expect(resultBody).toContain(">hand</strong>, <strong");
		expect(resultBody).toContain(">ignores armor</strong></span>");
	});

	it("bolds each known keyword and hovers its meaning, leaving unknown words plain", async () => {
		await rollDamage("d8", makeActor(), { label: "Smash", keywords: "grabby, loud · scales with size" });

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain(`<strong class="stonetop-damage-keyword" data-tooltip="Can grapple or restrain targets.">grabby</strong>, loud · scales with size`);
	});

	it("escapes the keywords, which can be a GM's own typing", async () => {
		await rollDamage("d6", makeActor(), { label: "Knife", keywords: "hand, <b>sneaky</b>" });

		expect(rollMessages[0].flavor).toContain(">hand</strong>, &lt;b&gt;sneaky&lt;/b&gt;");
		expect(rollMessages[0].flavor).not.toContain("<b>sneaky");
	});

	it("prints no keyword line for a damage roll that has none", async () => {
		await rollDamage("d6", makeActor(), { label: "Hammer" });

		expect(rollMessages[0].flavor).not.toContain("stonetop-damage-keywords");
	});

	// A monster move that states its blow in its description (the Crinwin's "Choke with sinewy
	// fingers") keeps that text on the damage card, behind the same toggle a move roll's card has.
	it("carries a move's description on the damage card", async () => {
		await rollDamage("d6", makeActor(), {
			label: "Choke with sinewy fingers",
			description: "<p>Clammy, too-cold fingers close around a throat.</p>",
		});

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain(`<div class="stonetop-roll-card-description"><p>Clammy, too-cold fingers close around a throat.</p></div>`);
		expect(flavor).toContain("stonetop-roll-card-desc-toggle");
		expect(flavor).toContain("stonetop-damage-roll-card");
	});
});

describe("rollFormula", () => {
	it("posts generic formula rolls with formula and description", async () => {
		await rollFormula("1d4+2", makeActor(), {
			label: "Supply",
			description: "<p>Roll surplus.</p>",
		});

		expect(rollInstances[0].formula).toBe("1d4+2");
		expect(rollMessages[0].flavor).toContain("Supply");
		expect(rollMessages[0].flavor).toContain("1d4+2");
		expect(rollMessages[0].flavor).toContain("<p>Roll surplus.</p>");
		expect(rollMessages[0].flavor).toContain("stonetop-card-buttons");
	});
});

describe("rollStat lasting-injury reminder", () => {
	function actorWithWounds(wounds) {
		const actor = makeActor();
		actor.system.attributes.wounds = wounds;
		return actor;
	}

	it("echoes a wound's lasting tag onto its reminder move's card", async () => {
		rollTotal = 10;
		const actor = actorWithWounds([
			{ id: "w1", text: "Bad arm", status: "permanent", origin: "deaths-door", healed: false,
			  mechanicalTag: "Volley at disadvantage until practiced", reminderMove: "Volley" },
		]);
		await rollStat("dex", actor, { moveName: "Volley" });
		expect(rollMessages[0].flavor).toContain("Lasting injury");
		expect(rollMessages[0].flavor).toContain("Volley at disadvantage until practiced");
	});

	it("echoes a '*' reminder onto any move", async () => {
		rollTotal = 10;
		const actor = actorWithWounds([
			{ id: "w1", text: "Migraines", status: "permanent", healed: false,
			  mechanicalTag: "Splitting headache", reminderMove: "*" },
		]);
		await rollStat("wis", actor, { moveName: "Discern Realities" });
		expect(rollMessages[0].flavor).toContain("Splitting headache");
	});

	it("echoes on an 'ask'/alt-stat roll that arrives as '<Name> with <STAT>'", async () => {
		// Defy Danger (and any move rolled with a chosen/alternate stat) reaches rollStat as
		// "Defy Danger with WIS"; a reminder keyed to the bare "Defy Danger" must still fire.
		rollTotal = 10;
		const actor = actorWithWounds([
			{ id: "w1", text: "Bum knee", status: "permanent", healed: false,
			  mechanicalTag: "Knee buckles under strain", reminderMove: "Defy Danger" },
		]);
		await rollStat("wis", actor, { moveName: "Defy Danger with WIS" });
		expect(rollMessages[0].flavor).toContain("Lasting injury");
		expect(rollMessages[0].flavor).toContain("Knee buckles under strain");
	});

	it("only strips a trailing ' with <STAT>', not a 'with' inside the move's real name", async () => {
		// The strip is anchored to the exact " with <STAT>" suffix rollStat appends for
		// ask/alt-stat rolls — a stat abbreviation right at the end. A move whose real name
		// merely contains "with" (and ends in a non-stat word) must not be mangled, so a
		// reminder keyed to that full name still matches.
		rollTotal = 10;
		const actor = actorWithWounds([
			{ id: "w1", text: "Bad arm", status: "permanent", healed: false,
			  mechanicalTag: "Reload only", reminderMove: "Parley with the Elder" },
		]);
		await rollStat("cha", actor, { moveName: "Parley with the Elder" });
		expect(rollMessages[0].flavor).toContain("Reload only");
	});

	it("does not echo when the reminder move doesn't match", async () => {
		rollTotal = 10;
		const actor = actorWithWounds([
			{ id: "w1", text: "Bad arm", status: "permanent", healed: false,
			  mechanicalTag: "Volley at disadvantage", reminderMove: "Volley" },
		]);
		await rollStat("str", actor, { moveName: "Hack and Slash" });
		expect(rollMessages[0].flavor).not.toContain("Lasting injury");
	});

	it("does not echo a healed wound", async () => {
		rollTotal = 10;
		const actor = actorWithWounds([
			{ id: "w1", text: "Old break", status: "permanent", healed: true,
			  mechanicalTag: "Aches", reminderMove: "*" },
		]);
		await rollStat("con", actor, { moveName: "Anything" });
		expect(rollMessages[0].flavor).not.toContain("Lasting injury");
	});


	it("does not echo a wound with a reminder move but no tag text", async () => {
		rollTotal = 10;
		const actor = actorWithWounds([
			{ id: "w1", text: "Sore", status: "problematic", healed: false, mechanicalTag: "", reminderMove: "*" },
		]);
		await rollStat("int", actor, { moveName: "Anything" });
		expect(rollMessages[0].flavor).not.toContain("Lasting injury");
	});
});

describe("rollStat problematic-wound prompt", () => {
	function actorWithWounds(wounds) {
		const actor = makeActor();
		actor.system.attributes.wounds = wounds;
		return actor;
	}

	/** The per-tier wrapper the prompt ships in, and which of its rows is visible. */
	function justifyRows(flavor) {
		const open = flavor.indexOf('<div class="stonetop-roll-wound-justify"');
		if (open < 0) return null;
		const activeTier = /data-active-tier="([^"]*)"/.exec(flavor.slice(open))?.[1] ?? null;
		// The rows are siblings at a known depth rather than arbitrary nesting, so splitting on the
		// row opener is enough to say which tiers were emitted and which of them carry the hide.
		const rows = [...flavor.slice(open).matchAll(/<div data-tier="(\w+)"( hidden="hidden")?>/g)]
			.map(m => ({ tier: m[1], hidden: !!m[2] }));
		return { activeTier, rows };
	}

	const BLEEDING = { id: "w1", text: "Gut wound, still seeping", status: "problematic", healed: false,
		mechanicalTag: "", reminderMove: "" };

	it("prompts the GM on a miss, naming the wound and what to do with it", async () => {
		rollTotal = 5;
		await rollStat("str", actorWithWounds([BLEEDING]), { moveName: "Clash" });

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain("Problematic wound");
		expect(flavor).toContain("Maybe one of these explains the result.");
		expect(flavor).toContain("Gut wound, still seeping");
	});

	it("prompts on a 7-9 as well, which is the other tier the book names", async () => {
		rollTotal = 8;
		await rollStat("str", actorWithWounds([BLEEDING]), { moveName: "Clash" });

		const { activeTier, rows } = justifyRows(rollMessages[0].flavor);
		expect(activeTier).toBe("partial");
		expect(rows.find(r => r.tier === "partial").hidden).toBe(false);
	});

	it("emits BOTH prompted tiers so a GM Shift Down can reveal the other one", async () => {
		rollTotal = 5;
		await rollStat("str", actorWithWounds([BLEEDING]), { moveName: "Clash" });

		const { activeTier, rows } = justifyRows(rollMessages[0].flavor);
		expect(activeTier).toBe("failure");
		expect(rows.map(r => r.tier)).toEqual(["partial", "failure"]);
		// Valued `hidden="hidden"`, never a bare one: Foundry v14 sanitizes valueless boolean
		// attributes off the flavor HTMLField, and a stripped hide reveals every tier at once.
		expect(rows.find(r => r.tier === "partial").hidden).toBe(true);
	});

	it("hides every row on a 10+, so a hit carries no prompt", async () => {
		rollTotal = 11;
		await rollStat("str", actorWithWounds([BLEEDING]), { moveName: "Clash" });

		const { activeTier, rows } = justifyRows(rollMessages[0].flavor);
		expect(activeTier).toBe("success");
		expect(rows.every(r => r.hidden)).toBe(true);
	});

	it("names a permanent injury too, which is a problematic wound that can never heal", async () => {
		rollTotal = 5;
		await rollStat("dex", actorWithWounds([
			{ id: "w1", text: "Left hand gone at the wrist", status: "permanent", healed: false },
		]), { moveName: "Volley" });

		expect(rollMessages[0].flavor).toContain("Left hand gone at the wrist");
	});

	it("stays quiet about a stabilized wound, which has already been tended", async () => {
		rollTotal = 5;
		await rollStat("con", actorWithWounds([
			{ id: "w1", text: "Cracked ribs, bound up", status: "stabilized", healed: false },
		]), { moveName: "Defy Danger" });

		expect(rollMessages[0].flavor).not.toContain("stonetop-roll-wound-justify");
	});

	it("stays quiet about a healed wound", async () => {
		rollTotal = 5;
		await rollStat("con", actorWithWounds([
			{ id: "w1", text: "Old break", status: "problematic", healed: true },
		]), { moveName: "Defy Danger" });

		expect(rollMessages[0].flavor).not.toContain("stonetop-roll-wound-justify");
	});

	it("says nothing at all for a character carrying no wounds", async () => {
		rollTotal = 5;
		await rollStat("wis", makeActor(), { moveName: "Discern Realities" });

		expect(rollMessages[0].flavor).not.toContain("stonetop-roll-wound-justify");
		expect(rollMessages[0].flavor).not.toContain("Problematic wound");
	});

	it("falls back to the mechanical tag for a wound entered as a bare rule", async () => {
		rollTotal = 5;
		await rollStat("str", actorWithWounds([
			{ id: "w1", text: "", status: "problematic", healed: false,
			  mechanicalTag: "Can't grip with the off hand", reminderMove: "Volley" },
		]), { moveName: "Clash" });

		// Escaped on the way in, as everything a player typed is: this string lands in the
		// message flavor, which Foundry stores and re-renders as HTML.
		expect(rollMessages[0].flavor).toContain("Can&#x27;t grip with the off hand");
	});

	it("drops a stub with nothing to narrate, and prints no block when that is all there is", async () => {
		rollTotal = 5;
		await rollStat("str", actorWithWounds([
			{ id: "w1", text: "   ", status: "problematic", healed: false, mechanicalTag: "" },
		]), { moveName: "Clash" });

		expect(rollMessages[0].flavor).not.toContain("stonetop-roll-wound-justify");
	});

	it("sits alongside the lasting-injury reminder without restating it", async () => {
		// The two notices answer different questions about one wound -- what it DOES to the roll,
		// and whether it is why the roll went wrong -- so both belong on a 6- card, each naming the
		// wound by its own string.
		rollTotal = 5;
		await rollStat("dex", actorWithWounds([
			{ id: "w1", text: "Bad arm, barely holds a bow", status: "permanent", healed: false,
			  mechanicalTag: "Volley at disadvantage until practiced", reminderMove: "Volley" },
		]), { moveName: "Volley" });

		const flavor = rollMessages[0].flavor;
		expect(flavor).toContain("Lasting injury");
		expect(flavor).toContain("Volley at disadvantage until practiced");
		expect(flavor).toContain("Problematic wound");
		expect(flavor).toContain("Bad arm, barely holds a bow");
	});

	it("goes quiet when the table turns the prompt off", async () => {
		// 9- is where most 2d6 rolls land and a permanent injury never heals, so the prompt is
		// unconditional on those tiers for the rest of a maimed character's campaign. The world
		// switch is the way out (settings.js `chatWoundPrompt`).
		global.game.settings = { get: vi.fn((ns, key) =>
			key === "chatWoundPrompt" ? false : "publicroll") };
		rollTotal = 5;
		await rollStat("str", actorWithWounds([BLEEDING]), { moveName: "Clash" });

		const flavor = rollMessages[0].flavor;
		expect(flavor).not.toContain("stonetop-roll-wound-justify");
		// The lasting-injury reminder is NOT what this switch is for: that one fires only on the
		// move a player deliberately keyed it to, so it is already opt-in per wound.
		expect(flavor).toContain("stonetop-roll-card");
	});

	it("keeps prompting in a world that never registered the setting", async () => {
		// An older world, or any caller reaching rollStat before registerSettings ran: OUR namespace
		// throws on an unknown key while core's own settings still answer. A thrown lookup that
		// escaped the guard would take the whole card down, not just the prompt.
		global.game.settings = { get: vi.fn((ns, key) => {
			if (ns === "core") return "publicroll";
			throw new Error(`not a registered setting: ${key}`);
		}) };
		rollTotal = 5;
		await rollStat("str", actorWithWounds([BLEEDING]), { moveName: "Clash" });

		expect(rollMessages[0].flavor).toContain("stonetop-roll-wound-justify");
	});

	it("pluralizes the heading when more than one wound is in play", async () => {
		rollTotal = 5;
		await rollStat("str", actorWithWounds([
			BLEEDING,
			{ id: "w2", text: "Burned hands", status: "problematic", healed: false },
		]), { moveName: "Clash" });

		expect(rollMessages[0].flavor).toContain("Problematic wounds");
	});
});
