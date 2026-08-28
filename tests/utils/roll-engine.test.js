import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeActorBuilder } from "../fakes/FakeActorBuilder.js";
import { rollDamage, rollFormula, rollSeasonsCard, rollStat, sign, SPRING_SEASONS_RESULT } from "../../module/utils/roll-engine.js";

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
			label: "icy touch d6 w/disadvantage (hand, ignores armor)",
			rollMode: "dis",
		});

		expect(rollInstances[0].formula).toBe("2d6kl1");
		expect(rollMessages[0].flavor).toContain("icy touch d6 w/disadvantage");
		expect(rollMessages[0].flavor).toContain("stonetop-condition-disadvantage");
	});

	it("rolls an advantaged die twice and keeps the higher, preserving the modifier", async () => {
		await rollDamage("d8+2", makeActor(), { label: "Maw", rollMode: "adv" });

		expect(rollInstances[0].formula).toBe("2d8kh1+2");
		expect(rollMessages[0].flavor).toContain("stonetop-condition-advantage");
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
