import { describe, expect, it, vi } from "vitest";
import {
	STEADING_MOVE, herdShareMet, improvementQuestions, netRollMode, rollAdjustments, rollConditionNotes,
	spendImprovementAnswers, nervesAnswer,
} from "../../../module/actors/steading/improvement-rolls.js";
import { builtInImprovementRules } from "../../../module/actors/steading/StonetopSteading.js";

/**
 * What the steading's improvements do to a homefront move at the moment it is rolled (the
 * Stonetop Steading playbook, and Book I's Deploy). The season-change effects are
 * season-effects.test.js's; these are the ones that change a MOVE.
 */

// The rules list (improvement-rules.js) for these book improvements, built: what every reader is handed.
const built = (...slugs) => builtInImprovementRules(slugs);
const TACTICS = [
	{ index: 1, label: "Archery: barrages, ranged ambushes, sniping, etc." },
	{ index: 3, label: "Formations: shield walls, wedges, phalanx, etc." },
];
const names = questions => questions.map(q => q.name);

describe("the questions a move's window asks", () => {
	it("asks every Deploy about a position of strength, since the move itself turns on it", () => {
		expect(names(improvementQuestions(STEADING_MOVE.DEPLOY, "defenses"))).toEqual(["strength"]);
	});

	it("offers the militia's trained tactics, the wall to take advantage of, and the watch", () => {
		const asks = improvementQuestions(STEADING_MOVE.DEPLOY, "defenses", {
			rules: built("wellTrainedMilitia", "palisade", "standingWatch"), tactics: TACTICS,
		});
		expect(names(asks)).toEqual(["strength", "tactic", "advantage-palisade", "watch"]);
		expect(asks.find(q => q.name === "tactic").options.map(o => o.value)).toEqual(["", "1", "3"]);
		expect(asks.find(q => q.name === "advantage-palisade").label).toBe("Taking advantage of the palisade: advantage");
	});

	it("names the stone wall once it has replaced the palisade", () => {
		const asks = improvementQuestions(STEADING_MOVE.DEPLOY, "defenses", { rules: built("palisade", "stoneWall") });
		// The Stone Wall erases the Palisade, so only the one wall is asked about.
		expect(names(asks)).toEqual(["strength", "advantage-stoneWall"]);
		expect(asks[1].label).toMatch(/stone wall/);
	});

	it("asks nothing about a militia with no tactics trained, or improvements not built", () => {
		expect(names(improvementQuestions(STEADING_MOVE.DEPLOY, "defenses", { rules: built("wellTrainedMilitia") }))).toEqual(["strength"]);
		expect(improvementQuestions(STEADING_MOVE.MUSTER, "population")).toEqual([]);
	});

	it("asks about the watch on any +Defenses roll, and the herd on Pull Together and Requisition", () => {
		expect(names(improvementQuestions(STEADING_MOVE.AUROCHS_HUNT, "defenses", { rules: built("standingWatch") }))).toEqual(["watch"]);
		expect(names(improvementQuestions(STEADING_MOVE.PULL_TOGETHER, "population", { rules: built("herdOfHorses") }))).toEqual(["herd"]);
		expect(names(improvementQuestions(STEADING_MOVE.REQUISITION, "fortunes", { rules: built("herdOfHorses") }))).toEqual(["herdCount"]);
	});

	// Ruling: the herd question is a COUNT, capped at the grown horses, and the take uses it too.
	it("asks Requisition how many horses come from the herd, capped at its grown horses", () => {
		const ask = improvementQuestions(STEADING_MOVE.REQUISITION, "fortunes", {
			rules: built("herdOfHorses"), herd: { grown: 9, total: 14 },
		})[0];
		expect(ask).toMatchObject({ name: "herdCount", type: "number", min: 0, max: 9, value: 0 });
		expect(ask.label).toMatch(/of 14/);
	});
});

// The Marshal's Logistics: "When you have a steading Muster or Pull Together, or when you
// Requisition, you have advantage." Asked, ticked, only once some character has it learned.
describe("the Marshal's Logistics", () => {
	it("asks a ticked line on Muster, Pull Together and Requisition, naming who has it", () => {
		for (const move of [STEADING_MOVE.MUSTER, STEADING_MOVE.PULL_TOGETHER, STEADING_MOVE.REQUISITION]) {
			const ask = improvementQuestions(move, "x", { logistics: ["Wren"] }).find(q => q.name === "logistics");
			expect(ask, move).toMatchObject({ type: "checkbox", checked: true });
			expect(ask.label, move).toMatch(/^Logistics \(Wren\): they are the one/);
		}
		expect(improvementQuestions(STEADING_MOVE.MUSTER, "population", { logistics: ["Wren", "Ash"] })[0].label)
			.toBe("Logistics (Wren or Ash): one of them is the one having the steading Muster, advantage");
	});

	it("asks nothing when nobody has it, or on any other move", () => {
		expect(improvementQuestions(STEADING_MOVE.MUSTER, "population", { logistics: [] })).toEqual([]);
		for (const move of [STEADING_MOVE.DEPLOY, STEADING_MOVE.TRADE_BARTER, STEADING_MOVE.AUROCHS_HUNT]) {
			expect(names(improvementQuestions(move, "x", { logistics: ["Wren"] })), move).not.toContain("logistics");
		}
	});

	it("gives advantage while ticked, named, and cancels against Diminished", () => {
		const muster = answers => rollAdjustments({ moveName: STEADING_MOVE.MUSTER, statKey: "population", answers, diminished: true });
		expect(muster({ logistics: "yes" }).adv).toEqual(["Logistics"]);
		expect(muster({ logistics: "" }).adv).toEqual([]);
		expect(netRollMode("normal", muster({ logistics: "yes" }).adv, muster({ logistics: "yes" }).dis)).toBe("normal");
		expect(rollConditionNotes(rollAdjustments({ moveName: STEADING_MOVE.REQUISITION, statKey: "fortunes", answers: { logistics: true } })))
			.toEqual(["Logistics: advantage"]);
		expect(rollAdjustments({ moveName: STEADING_MOVE.TRADE_BARTER, statKey: "prosperity", answers: { logistics: "yes" } }).adv).toEqual([]);
	});
});

// Marshal re-audit (2026-10-18), We Happy Few's 6-: "you have disadvantage on all rolls until you share your
// nagging doubts with someone else". A steading roll the shaken Marshal is behind is one of them.
describe("We Happy Few's shaken nerves", () => {
	it("asks on every move once someone is shaken: ticked for the user's own, unticked for another", () => {
		for (const move of [STEADING_MOVE.MUSTER, STEADING_MOVE.DEPLOY, STEADING_MOVE.REQUISITION, STEADING_MOVE.TRADE_BARTER]) {
			const own = improvementQuestions(move, "x", { nerves: [{ name: "Wren", own: true }] }).find(q => q.name === "nerves");
			expect(own, move).toMatchObject({ type: "checkbox", value: "Wren", checked: true });
			expect(own.label).toBe("Wren's nerves are shaken (We Happy Few): they are the one behind this roll, disadvantage");
			const other = improvementQuestions(move, "x", { nerves: [{ name: "Wren", own: false }] }).find(q => q.name === "nerves");
			expect(other.checked, move).toBe(false);
		}
		expect(names(improvementQuestions(STEADING_MOVE.MUSTER, "population", { nerves: [] }))).not.toContain("nerves");
	});

	it("asks a pick among several, defaulting to no one", () => {
		const ask = improvementQuestions(STEADING_MOVE.MUSTER, "population", { nerves: [{ name: "Wren" }, { name: "Ash" }] })
			.find(q => q.name === "nerves");
		expect(ask.type).toBe("select");
		expect(ask.options).toEqual([{ value: "", label: "No" }, { value: "Wren", label: "Wren" }, { value: "Ash", label: "Ash" }]);
	});

	it("is disadvantage named for whoever it is, and cancels with Logistics' advantage", () => {
		const req = answers => rollAdjustments({ moveName: STEADING_MOVE.REQUISITION, statKey: "fortunes", answers });
		expect(req({ nerves: "Wren" }).dis).toEqual(["Wren's shaken nerves (We Happy Few)"]);
		expect(req({ nerves: "" }).dis).toEqual([]);
		expect(netRollMode("normal", req({ nerves: "Wren" }).adv, req({ nerves: "Wren" }).dis)).toBe("dis");
		const both = req({ nerves: "Wren", logistics: "yes" });
		expect(netRollMode("normal", both.adv, both.dis)).toBe("normal");
		expect(rollConditionNotes(both)).toEqual(["Logistics: advantage", "Wren's shaken nerves (We Happy Few): disadvantage"]);
		// A bare tick (no name) still bites, named by the move.
		expect(req({ nerves: true }).dis).toEqual(["Shaken nerves (We Happy Few)"]);
	});

	it("reads a window's own control: a ticked box's name, a pick's value, or nothing", () => {
		const root = field => ({ querySelector: () => field });
		expect(nervesAnswer(root({ type: "checkbox", checked: true, value: "Wren" }))).toBe("Wren");
		expect(nervesAnswer(root({ type: "checkbox", checked: false, value: "Wren" }))).toBe("");
		expect(nervesAnswer(root({ type: "select-one", value: "Ash" }))).toBe("Ash");
		expect(nervesAnswer(root(null))).toBe("");
		expect(nervesAnswer(null)).toBe("");
	});
});

// Ranger audit M5, the Ranger's Pathfinder: "When you lead your people to Pull Together or Deploy
// beyond sight of home, you have advantage." Beyond sight of home is fiction, so it is asked
// UNTICKED, and only once some character has it learned.
describe("the Ranger's Pathfinder", () => {
	it("asks an unticked line on Deploy and Pull Together, naming who has it", () => {
		for (const move of [STEADING_MOVE.DEPLOY, STEADING_MOVE.PULL_TOGETHER]) {
			const ask = improvementQuestions(move, "x", { pathfinder: ["Rook"] }).find(q => q.name === "pathfinder");
			expect(ask, move).toMatchObject({ type: "checkbox" });
			expect(ask.checked, move).toBeFalsy();
			expect(ask.label, move).toBe("Pathfinder (Rook): they lead the people beyond sight of home, advantage");
		}
		expect(improvementQuestions(STEADING_MOVE.PULL_TOGETHER, "x", { pathfinder: ["Rook", "Wren"] })[0].label)
			.toBe("Pathfinder (Rook or Wren): one of them leads the people beyond sight of home, advantage");
	});

	it("asks nothing when nobody has it, or on any other move", () => {
		expect(names(improvementQuestions(STEADING_MOVE.PULL_TOGETHER, "x", { pathfinder: [] }))).not.toContain("pathfinder");
		for (const move of [STEADING_MOVE.MUSTER, STEADING_MOVE.TRADE_BARTER, STEADING_MOVE.REQUISITION]) {
			expect(names(improvementQuestions(move, "x", { pathfinder: ["Rook"] })), move).not.toContain("pathfinder");
		}
	});

	it("gives advantage while ticked, named, and cancels against Diminished", () => {
		const deploy = answers => rollAdjustments({ moveName: STEADING_MOVE.DEPLOY, statKey: "defenses", answers, diminished: true });
		expect(deploy({ pathfinder: "yes" }).adv).toEqual(["Pathfinder"]);
		expect(deploy({ pathfinder: "" }).adv).toEqual([]);
		expect(netRollMode("normal", deploy({ pathfinder: "yes" }).adv, deploy({ pathfinder: "yes" }).dis)).toBe("normal");
		expect(rollConditionNotes(rollAdjustments({ moveName: STEADING_MOVE.PULL_TOGETHER, statKey: "x", answers: { pathfinder: "yes" } })))
			.toEqual(["Pathfinder: advantage"]);
		expect(rollAdjustments({ moveName: STEADING_MOVE.MUSTER, statKey: "population", answers: { pathfinder: "yes" } }).adv).toEqual([]);
	});
});

describe("what the improvements do to the roll", () => {
	it("gives a Township advantage to Muster, Pull Together and Trade & Barter, and nothing else", () => {
		for (const move of [STEADING_MOVE.MUSTER, STEADING_MOVE.PULL_TOGETHER, STEADING_MOVE.TRADE_BARTER]) {
			expect(rollAdjustments({ moveName: move, statKey: "x", rules: built("township") }).adv, move).toEqual(["Township"]);
		}
		expect(rollAdjustments({ moveName: STEADING_MOVE.DEPLOY, statKey: "defenses", rules: built("township") }).adv).toEqual([]);
	});

	it("gives a Deploy advantage only when it takes advantage of the wall", () => {
		const deploy = answers => rollAdjustments({ moveName: STEADING_MOVE.DEPLOY, statKey: "defenses", rules: built("stoneWall"), answers });
		expect(deploy({ "advantage-stoneWall": "yes" }).adv).toEqual(["Stone Wall"]);
		expect(deploy({}).adv).toEqual([]);
	});

	it("treats Defenses as 1 higher when the standing watch is involved", () => {
		const adj = rollAdjustments({ moveName: STEADING_MOVE.DEPLOY, statKey: "defenses", rules: built("standingWatch"), answers: { watch: "yes" } });
		expect(adj.statBonus).toBe(1);
		expect(adj.notes).toContain("Standing watch: Defenses +1");
	});

	it("puts a Deploy in a position of strength by the table's say, or by a trained tactic", () => {
		const deploy = answers => rollAdjustments({
			moveName: STEADING_MOVE.DEPLOY, statKey: "defenses", rules: built("wellTrainedMilitia"), tactics: TACTICS, answers,
		});
		expect(deploy({}).strength).toBe(false);
		expect(deploy({ strength: "yes" }).strength).toBe(true);
		const tactic = deploy({ tactic: "3" });
		expect(tactic.strength).toBe(true);
		expect(tactic.notes).toContain("Trained tactic: Formations");
	});

	it("counts a Requisition of half the herd or less as a 7-9 on a 6-", () => {
		const req = answers => rollAdjustments({ moveName: STEADING_MOVE.REQUISITION, statKey: "fortunes", rules: built("herdOfHorses"), answers });
		expect(req({ herdShare: true }).missAsPartial).toMatch(/half the herd/i);
		expect(req({}).missAsPartial).toBe("");
		const count = (n, total) => rollAdjustments({
			moveName: STEADING_MOVE.REQUISITION, statKey: "fortunes", rules: built("herdOfHorses"), answers: { herdCount: n }, herdTotal: total,
		}).missAsPartial;
		expect(count("6", 12)).toMatch(/half the herd/i);
		expect(count("7", 12)).toBe("");
		expect(count("0", 12)).toBe("");
		expect(herdShareMet(1, 0)).toBe(false);
	});

	// Book I p. 509: Size. "Hamlet ... Muster, Pull Together, and Trade & Barter with
	// disadvantage"; "Town ... with advantage"; "City ... with advantage".
	it("reads Size on Muster, Pull Together and Trade & Barter, folding a Township into one source", () => {
		const adj = (moveName, size, rules = built()) => rollAdjustments({ moveName, statKey: "x", rules, size });
		expect(adj(STEADING_MOVE.MUSTER, "hamlet")).toMatchObject({ adv: [], dis: ["A hamlet"] });
		expect(adj(STEADING_MOVE.TRADE_BARTER, "town").adv).toEqual(["A town"]);
		expect(adj(STEADING_MOVE.PULL_TOGETHER, "city").adv).toEqual(["A city"]);
		expect(adj(STEADING_MOVE.MUSTER, "village")).toMatchObject({ adv: [], dis: [] });
		// The Township made it a town: one source, not two.
		expect(adj(STEADING_MOVE.MUSTER, "town", built("township")).adv).toEqual(["Township"]);
		// A Township shrunk back to a hamlet: the two cancel at the netting.
		expect(adj(STEADING_MOVE.MUSTER, "hamlet", built("township"))).toMatchObject({ adv: ["Township"], dis: ["A hamlet"] });
		expect(adj(STEADING_MOVE.DEPLOY, "hamlet").dis).toEqual([]);
	});

	it("collects Diminished, winter and a held advantage as sources", () => {
		const muster = rollAdjustments({ moveName: STEADING_MOVE.MUSTER, statKey: "population", rules: built("township"), diminished: true });
		expect(muster).toMatchObject({ adv: ["Township"], dis: ["Diminished"] });
		expect(rollAdjustments({ moveName: STEADING_MOVE.TRADE_BARTER, statKey: "prosperity", winter: true }).dis).toEqual(["Winter"]);
		expect(rollAdjustments({ moveName: "Persuade", statKey: "fortunes", held: "A sacrifice" }).adv).toEqual(["A sacrifice"]);
		// Diminished touches only Deploy, Muster and Pull Together.
		expect(rollAdjustments({ moveName: "Persuade", statKey: "fortunes", diminished: true }).dis).toEqual([]);
	});
});

describe("advantage and disadvantage", () => {
	// Book I: "If you have advantage and disadvantage on the same roll, they cancel each other out."
	it("cancel each other out, the player's own choice included", () => {
		expect(netRollMode("normal", ["Township"], ["Diminished"])).toBe("normal");
		expect(netRollMode("adv", [], ["Winter"])).toBe("normal");
		expect(netRollMode("dis", ["Township"], [])).toBe("normal");
		expect(netRollMode("normal", ["Township"], [])).toBe("adv");
		expect(netRollMode("normal", [], ["Diminished"])).toBe("dis");
		expect(netRollMode("normal")).toBe("normal");
	});

	it("say on the card where each came from, leaving Diminished to its debility pill", () => {
		expect(rollConditionNotes({ adv: ["Township"], dis: ["Diminished", "Winter"], notes: ["Standing watch: Defenses +1"] }))
			.toEqual(["Township: advantage", "Winter: disadvantage", "Standing watch: Defenses +1"]);
	});
});

// Coverage pass (2026-10-16): Stentorian's "Spend 1 Command ... You have advantage to Order Followers or Deploy"
// (Book I p.127). Spending is the Marshal's choice, so Deploy's window asks UNTICKED while a Marshal holds Command.
describe("the Marshal's Stentorian on Deploy", () => {
	it("asks an unticked line on Deploy alone, naming the one Marshal it spends from by id", () => {
		const bryn = { id: "b1", name: "Bryn" };
		const ask = improvementQuestions(STEADING_MOVE.DEPLOY, "defenses", { command: [bryn] }).find(q => q.name === "command");
		expect(ask).toMatchObject({ type: "checkbox", value: "b1" });
		expect(ask.checked).toBeFalsy();
		expect(ask.label).toBe("Stentorian (Bryn): spend 1 Command to shout an order or warning, advantage to Deploy");
		expect(names(improvementQuestions(STEADING_MOVE.DEPLOY, "defenses", { command: [] }))).not.toContain("command");
		expect(names(improvementQuestions(STEADING_MOVE.MUSTER, "population", { command: [bryn] }))).not.toContain("command");
	});

	// Rules fix (2026-10-17): "YOU have advantage", so with several Marshals the window asks which one is Deploying.
	it("asks which Marshal is Deploying when several hold Command, defaulting to none", () => {
		const ask = improvementQuestions(STEADING_MOVE.DEPLOY, "defenses", {
			command: [{ id: "b1", name: "Bryn" }, { id: "m1", name: "Maddoc" }],
		}).find(q => q.name === "command");
		expect(ask.type).toBe("select");
		expect(ask.options).toEqual([{ value: "", label: "No" }, { value: "b1", label: "Bryn" }, { value: "m1", label: "Maddoc" }]);
	});

	// The question carries what its answer costs, and the sheet pays every taken answer's cost generically,
	// before the roll is adjusted: a spend that fails clears its answer, so the roll gets no advantage.
	it("carries its spend, which runs only for a taken answer and can take the advantage back", async () => {
		const spendCommand = vi.fn(async answers => ({ answers: { ...answers, command: "" }, refused: "No Command" }));
		const questions = improvementQuestions(STEADING_MOVE.DEPLOY, "defenses", { command: [{ id: "b1", name: "Bryn" }], spendCommand });
		expect(questions.find(q => q.name === "command").spend).toBe(spendCommand);
		expect(questions.find(q => q.name === "strength").spend).toBeUndefined();
		const warn = vi.fn();
		expect(await spendImprovementAnswers(questions, { strength: "yes", command: "" }, { warn })).toEqual({ strength: "yes", command: "" });
		expect(spendCommand).not.toHaveBeenCalled();
		const out = await spendImprovementAnswers(questions, { strength: "", command: "b1" }, { warn });
		expect(spendCommand).toHaveBeenCalledWith({ strength: "", command: "b1" });
		expect(out.command).toBe("");
		expect(warn).toHaveBeenCalledWith("No Command");
		expect(rollAdjustments({ moveName: STEADING_MOVE.DEPLOY, statKey: "defenses", answers: out }).adv).toEqual([]);
	});

	it("spends by default through the Marshal's Command (battle-holds.js), refusing when none can be spent", async () => {
		const questions = improvementQuestions(STEADING_MOVE.DEPLOY, "defenses", { command: [{ id: "b1", name: "Bryn" }] });
		const warn = vi.fn();
		const out = await spendImprovementAnswers(questions, { command: "b1" }, { warn });
		expect(out).toEqual({ command: "", commandRefused: true });
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no Stentorian advantage/));
	});

	it("gives advantage while ticked, named, on Deploy alone", () => {
		expect(rollAdjustments({ moveName: STEADING_MOVE.DEPLOY, statKey: "defenses", answers: { command: "yes" } }).adv).toEqual(["Stentorian"]);
		expect(rollAdjustments({ moveName: STEADING_MOVE.DEPLOY, statKey: "defenses", answers: { command: "" } }).adv).toEqual([]);
		expect(rollAdjustments({ moveName: STEADING_MOVE.MUSTER, statKey: "population", answers: { command: "yes" } }).adv).toEqual([]);
	});
});
