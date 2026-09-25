import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createStonetopItemClass } from "../../module/item/StonetopItem.js";

// A roll card used to carry no identity at all — the move's name survived only as escaped text in
// the card header, and that header reads "Know Things with WIS" for an alt-stat roll. The message
// flag stamped here is what lets a chat handler recognise WHICH move a card came from.

const rollStat = vi.hoisted(() => vi.fn(async () => ({ total: 7 })));
const rollFormula = vi.hoisted(() => vi.fn(async () => ({ total: 0 })));
// A monster's rolling move goes through the damage WINDOW and then the damage CARD, which are two
// different modules: the window is asked by combat/attack-flow.js so a ticked line can be paid for,
// and the card is posted by utils/roll-engine.js. Both stood in for, so a test can read the mode and
// the Shift skip off the window's arguments and the title, keywords and description off the card's.
const rollDamage = vi.hoisted(() => vi.fn(async () => ({ total: 0 })));
vi.mock("../../module/utils/roll-engine.js", () => ({
	rollStat,
	rollFormula,
	rollDamage,
}));

const promptDamage = vi.hoisted(() => vi.fn(async () => ({ rollMode: "", bonus: 0, extraDice: "" })));
vi.mock("../../module/dialogs/RollDialog.js", () => ({ promptDamage }));

const move = (name, system = {}) => ({ type: "move", name, system });

function makeItem(name, system, actorItems = []) {
	const Base = class {
		constructor() {
			this.name = name;
			this.system = system;
			this.parent = { type: "character", name: "Vahid", items: actorItems };
		}
	};
	return new (createStonetopItemClass(Base))();
}

const KNOW_THINGS = { moveType: "basic", rollType: "int", description: "<p>x</p>" };

beforeEach(() => { rollStat.mockClear(); });

describe("StonetopItem.roll — move identity on the card", () => {
	it("stamps the base move name, not the stat-decorated header", async () => {
		await makeItem("Know Things", KNOW_THINGS).roll({ statOverride: "wis" });
		const opts = rollStat.mock.calls[0][2];
		expect(opts.messageFlags["stonetop-pwd"].move).toBe("Know Things");
		expect(opts.moveName).toBe("Know Things with WIS");   // the header still names the stat
	});

	it("merges into an existing producer's flags rather than replacing them", async () => {
		// The attack flow already stamps its own payload under the same scope key.
		await makeItem("Clash", { rollType: "str" }).roll({
			messageFlags: { "stonetop-pwd": { attack: { move: "clash" } } },
		});
		const flags = rollStat.mock.calls[0][2].messageFlags["stonetop-pwd"];
		expect(flags.attack).toEqual({ move: "clash" });
		expect(flags.move).toBe("Clash");
	});
});

describe("StonetopItem.roll — Never at a Loss", () => {
	it("defers the miss XP and carries the choice when the character owns the move", async () => {
		const item = makeItem("Know Things", KNOW_THINGS, [move("Know Things"), move("Never at a Loss")]);
		await item.roll();
		const opts = rollStat.mock.calls[0][2];
		expect(opts.noXpOnMiss).toBe(true);
		expect(opts.tierActions.failure).toContain("stonetop-know-things-xp");
	});

	it("beats the item's own noXpOnMiss default rather than being overwritten by it", async () => {
		// The spread order in roll() matters here: system.noXpOnMiss is false for Know Things.
		const item = makeItem("Know Things", { ...KNOW_THINGS, noXpOnMiss: false },
			[move("Never at a Loss")]);
		await item.roll();
		expect(rollStat.mock.calls[0][2].noXpOnMiss).toBe(true);
	});

	it("leaves a character without the move rolling exactly as before", async () => {
		await makeItem("Know Things", KNOW_THINGS, [move("Know Things")]).roll();
		const opts = rollStat.mock.calls[0][2];
		expect(opts.noXpOnMiss).toBe(false);
		expect(opts.tierActions).toBeUndefined();
	});

	it("does not fire on a different move, even for a Seeker who owns it", async () => {
		const item = makeItem("Seek Insight", { rollType: "wis" }, [move("Never at a Loss")]);
		await item.roll();
		expect(rollStat.mock.calls[0][2].noXpOnMiss).toBe(false);
	});
});

// A move on a stat block: a monster's, or an NPC's.
function statBlockMove(type, name, system) {
	const Base = class {
		constructor() {
			this.type = type;
			this.name = name;
			this.system = system;
			this.parent = { type: type === "npcMove" ? "npc" : "monster", name: "Stat block", items: [] };
		}
	};
	return new (createStonetopItemClass(Base))();
}

// A monster's move is its name ("Block their path"), and almost none carry a description, so a card
// headed with the name held the whole move over an empty body. It is headed "Move" instead.
describe("StonetopItem.roll: a monster's move posted without a roll", () => {
	const realChatMessage = globalThis.ChatMessage;
	const heading = content => /<h3 class="stonetop-chat-move-name">([^<]*)<\/h3>/.exec(content)?.[1];

	beforeEach(() => {
		rollFormula.mockClear();
		rollDamage.mockClear();
		promptDamage.mockClear();
		// Hands back what was posted, so a test reads the card it made.
		globalThis.ChatMessage = { create: vi.fn(async data => data), getSpeaker: vi.fn(() => ({ alias: "Stat block" })) };
	});
	afterEach(() => { globalThis.ChatMessage = realChatMessage; });

	it("heads the card \"Move\" and opens the body with the move's words", async () => {
		// The Bronze Colossus, verbatim.
		const posted = await statBlockMove("monsterMove", "Block their path", { description: "", rollFormula: "" }).roll();

		expect(rollFormula).not.toHaveBeenCalled();
		expect(rollDamage).not.toHaveBeenCalled();
		expect(heading(posted.content)).toBe("Move");
		expect(posted.content).toContain('<div class="stonetop-chat-move-description"><p>Block their path</p>');
	});

	it("keeps a description, under the move's words", async () => {
		// The Crinwin's, verbatim.
		const posted = await statBlockMove("monsterMove", "Hide or vanish into the trees", {
			description: "<p>It scurries, leaps, and swings up into the boughs and is simply gone.</p>",
			rollFormula: "",
		}).roll();

		expect(posted.content).toContain("<p>Hide or vanish into the trees</p><p>It scurries, leaps,");
	});

	it("stamps the move's name on the message, since the heading no longer carries it", async () => {
		const posted = await statBlockMove("monsterMove", "Block their path", { description: "", rollFormula: "" }).roll();

		expect(posted.flags["stonetop-pwd"].move).toBe("Block their path");
	});

	it("escapes the name, which a GM can edit on the stat block", async () => {
		const posted = await statBlockMove("monsterMove", "Screech <b>loudly</b>", { description: "", rollFormula: "" }).roll();

		expect(posted.content).not.toContain("<b>");
		expect(posted.content).toContain("<p>Screech &lt;b&gt;loudly");
	});

	it("leaves an NPC's move headed with its own name", async () => {
		const posted = await statBlockMove("npcMove", "Call the watch", { description: "", rollFormula: "" }).roll();

		expect(heading(posted.content)).toBe("Call the watch");
		expect(posted.content).not.toContain("<p>Call the watch</p>");
	});

	// A Stock move made from the hotbar (rollMoveById) posts through here, and needs the same
	// Spend button the Moves tab's card carries: inside the card, with the `move` stamp kept.
	it("carries a caller's button row inside the card, keeping the move stamp", async () => {
		const actions = `<div class="card-buttons"><button class="stonetop-spend-stock">Spend 1 Stock</button></div>`;
		const posted = await makeItem("Call the Spirits", { description: "<p>When you spend 1 Stock…</p>" }).roll({ actions });

		expect(posted.content).toContain("stonetop-spend-stock");
		expect(posted.content.indexOf("stonetop-spend-stock")).toBeLessThan(posted.content.lastIndexOf("</div>"));
		expect(posted.flags["stonetop-pwd"].move).toBe("Call the Spirits");
	});
});

// A monster's move that rolls dice is an attack (utils/damage.js#foeAttacks), so it rolls on the
// damage card: titled with the blow's name, its tags beside the total, its printed advantage on the die.
describe("StonetopItem.roll: a monster's rolling move", () => {
	beforeEach(() => { rollFormula.mockClear(); rollDamage.mockClear(); promptDamage.mockClear(); });

	it("rolls on the damage card, titled with the blow's name and its tags as the body", async () => {
		// Draventao, verbatim.
		const item = statBlockMove("monsterMove",
			"Breathe sticky fire, d10+3 damage (near, area, grabby, messy, reload, ignores armor)",
			{ description: "", rollFormula: "d10+3" });
		await item.roll();

		expect(rollFormula).not.toHaveBeenCalled();
		expect(rollDamage).toHaveBeenCalledWith("d10+3", item.parent, expect.objectContaining({
			label: "Breathe sticky fire",
			keywords: "near, area, grabby, messy, reload, ignores armor",
			description: "",
		}));
	});

	it("rolls the advantage its name prints, which the plain formula card never applied", async () => {
		// Ulliam Unlucky, verbatim.
		await statBlockMove("monsterMove",
			"Lose his temper and drain heat from someone, d10 damage w/advantage (hand, close, reach, ignores armor)",
			{ description: "", rollFormula: "d10" }).roll();

		expect(rollDamage.mock.calls[0][2]).toMatchObject({ label: "Lose his temper and drain heat from someone" });
		expect(promptDamage.mock.calls[0][0]).toMatchObject({ rollMode: "adv" });
	});

	it("keeps a plain name as the title, and its description on the card", async () => {
		// The Crinwin's, verbatim: this blow is stated in the description rather than the name.
		await statBlockMove("monsterMove", "Choke with sinewy fingers", {
			description: "<p>Clammy, too-cold fingers close around a throat. Claws, rocks, choking: d6 damage (hand).</p>",
			rollFormula: "d6",
		}).roll();

		const opts = rollDamage.mock.calls[0][2];
		expect(opts).toMatchObject({ label: "Choke with sinewy fingers", keywords: "", rollMode: "" });
		expect(opts.description).toContain("Clammy, too-cold fingers close around a throat.");
	});

	it("lets Shift skip the damage window", async () => {
		// The Caribou, verbatim.
		await statBlockMove("monsterMove", "Stampede, d6+4 damage (hand, area, messy, forceful, 1 piercing)",
			{ description: "", rollFormula: "d6+4" }).roll({ shiftKey: true });

		expect(promptDamage.mock.calls[0][0].shiftKey).toBe(true);
	});

	it("leaves an NPC's rolling move on the plain formula card", async () => {
		// Typed: a GM writes these, and one may roll something other than damage.
		await statBlockMove("npcMove", "Call the watch", { description: "", rollFormula: "d4" }).roll();

		expect(rollDamage).not.toHaveBeenCalled();
		expect(rollFormula).toHaveBeenCalledWith("d4", expect.anything(), expect.objectContaining({ label: "Call the watch" }));
	});
});

// The roll card is where the ROLLER is known, so it is where their extra picks are laid over the
// move's printed caps (actors/character/move-pick-bonuses.js).
describe("StonetopItem.roll — the roller's own picks", () => {
	const SEEK = {
		moveType: "basic", rollType: "wis",
		description: "<p>When you study a situation, roll +WIS: <strong>on a 10+</strong>, ask the GM 3 questions from the list below; <strong>on a 7-9</strong>, ask 1:</p><ul><li>What happened here recently?</li><li>What is about to happen?</li></ul>",
	};

	it("counts a Perceptive Fox's extra question, and her question on a 6-", async () => {
		await makeItem("Seek Insight", SEEK, [move("Perceptive")]).roll();
		const card = rollStat.mock.calls[0][2].moveDescription;
		expect(card).toContain('data-pick-max-success="4"');
		expect(card).toContain('data-pick-max-partial="2"');
		expect(card).toContain('data-pick-max-failure="1"');
	});

	it("leaves everyone else on the move's own caps", async () => {
		await makeItem("Seek Insight", SEEK, []).roll();
		const card = rollStat.mock.calls[0][2].moveDescription;
		expect(card).toContain('data-pick-max-success="3"');
		expect(card).not.toContain("data-pick-max-failure");
	});
});
