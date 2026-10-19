import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	battleHoldsToFill, battleHoldsContent, askBattleHolds, offerBattleHolds, installBattleHolds,
	spendSurpriseForRoll, refundSurpriseForRoll, regainSurpriseOnHit, PREPARE_A_WELCOME, commandHolders, spendCommandForDeploy,
	deployCommandOffers, deployCommandAnswers,
	FIGHT_HOLD_MOVES, fightHoldsClearData, clearFightHolds, lieInWaitActionsFor, isLieInWaitAction, lieInWait,
} from "../../module/combat/battle-holds.js";
import { refreshHeldMoves } from "../../module/migration/move-refresh.js";
import { stubAsk } from "../fakes/confirm.js";

// The Marshal going into battle: Stentorian's "hold 2 Command" and Front Line Leader's "hold 2
// Presence" (when leading a crew in). Both tracks count what is HELD, so holding them full is max.

function marshal({ moves = ["Stentorian", "Front Line Leader"], held = {}, id = "m" } = {}) {
	const tracks = { ...held };
	const titles = { "Stentorian": "Command", "Front Line Leader": "Presence", "Prepare a Welcome": "Surprise" };
	const actor = {
		id, name: "Maddoc", type: "character",
		items: moves.map(name => ({ type: "move", name, flags: {}, system: { resource: { max: 2, title: titles[name] ?? "Hold" } } })),
		typedActor: {
			moveResources: {
				getMoveResources: () => tracks,
				setUses: vi.fn(async (move, value) => { tracks[move] = value; }),
			},
		},
	};
	return { actor, tracks };
}

let saved;
let posted;
beforeEach(() => {
	saved = { ChatMessage: globalThis.ChatMessage, document: globalThis.document, applications: globalThis.foundry.applications };
	posted = [];
	globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: ({ actor }) => ({ alias: actor.name }) };
	globalThis.document = { createElement: () => ({}) };
});
afterEach(() => {
	globalThis.ChatMessage = saved.ChatMessage;
	globalThis.document = saved.document;
	globalThis.foundry.applications = saved.applications;
});

describe("battleHoldsToFill", () => {
	it("lists each battle hold that is not full, a fresh Marshal's included (they hold none yet)", () => {
		const { actor } = marshal({ held: { "Front Line Leader": 1 } });
		expect(battleHoldsToFill(actor)).toEqual([
			{ move: "Stentorian", title: "Command", max: 2, held: 0 },
			{ move: "Front Line Leader", title: "Presence", max: 2, held: 1 },
		]);
	});

	it("asks nothing of a track already full, or a character without the moves", () => {
		expect(battleHoldsToFill(marshal({ held: { "Stentorian": 2, "Front Line Leader": 2 } }).actor)).toEqual([]);
		expect(battleHoldsToFill(marshal({ moves: [] }).actor)).toEqual([]);
	});

	it("quotes Front Line Leader's crew clause, since the sheet cannot see it", () => {
		const { actor } = marshal({ held: { "Stentorian": 2 } });
		expect(battleHoldsContent(actor, battleHoldsToFill(actor))).toContain("if you are leading your crew into battle");
	});
});

describe("offerBattleHolds", () => {
	it("fills the ticked holds up and says so", async () => {
		const { actor, tracks } = marshal();
		const moves = await offerBattleHolds(actor, { ask: async (_a, holds) => holds.filter(h => h.move === "Stentorian") });
		expect(moves).toEqual(["Stentorian"]);
		expect(tracks).toEqual({ "Stentorian": 2 });
		expect(posted[0].content).toContain("goes into battle holding 2 Command");
	});

	it("writes nothing when they decline", async () => {
		const { actor, tracks } = marshal({ held: { "Stentorian": 1 } });
		expect(await offerBattleHolds(actor, { ask: async () => [] })).toEqual([]);
		expect(tracks).toEqual({ "Stentorian": 1 });
		expect(posted).toEqual([]);
	});
});

describe("askBattleHolds", () => {
	it("takes the ticked rows on the affirmative button, and nothing on the other", async () => {
		const { actor } = marshal();
		const holds = battleHoldsToFill(actor);
		// The ticked boxes, as the form hands them over: only Front Line Leader's.
		const form = { querySelectorAll: vi.fn(() => [{ value: "1" }]) };
		const asked = stubAsk("hold", form);
		expect(await askBattleHolds(actor, holds)).toEqual([holds[1]]);
		expect(form.querySelectorAll).toHaveBeenCalledWith('input[name="stonetop-battle-hold"]:checked');
		const spec = asked.mock.calls[0][0];
		expect(spec.buttons.map(b => b.action)).toEqual(["hold", "skip"]);
		expect(spec.buttons.find(b => b.default)?.action).toBe("hold");
		stubAsk("skip");
		expect(await askBattleHolds(actor, holds)).toEqual([]);
		stubAsk(null);
		expect(await askBattleHolds(actor, holds)).toEqual([]);
	});
});

describe("installBattleHolds", () => {
	let savedGame;
	beforeEach(() => { savedGame = { user: globalThis.game.user, users: globalThis.game.users }; });
	afterEach(() => { globalThis.game.user = savedGame.user; globalThis.game.users = savedGame.users; });

	it("asks on the Marshal's own player's screen when they join a fight", async () => {
		let fire;
		const hooks = { on: (_name, fn) => { fire = fn; return 1; }, off: vi.fn() };
		const offer = vi.fn(async () => []);
		installBattleHolds({ hooks, offer });
		const { actor } = marshal();
		const gm = { id: "gm", isGM: true, active: true, character: null };
		const player = { id: "p1", isGM: false, active: true, character: actor };
		actor.testUserPermission = () => true;
		globalThis.game.users = [gm, player];

		globalThis.game.user = gm;
		fire({ actor });
		expect(offer).not.toHaveBeenCalled();

		globalThis.game.user = player;
		fire({ actor });
		expect(offer).toHaveBeenCalledWith(actor);
	});
});

// Prepare a Welcome: "Once battle is joined, spend 1 Surprise to reveal a ploy ... and roll +INT: on a
// 10+ ... regain 1 Surprise". Rolling it is the spend.
describe("Prepare a Welcome's Surprise", () => {
	const welcome = { name: PREPARE_A_WELCOME };
	const planner = held => marshal({ moves: [PREPARE_A_WELCOME], held: { [PREPARE_A_WELCOME]: held } });

	it("spends 1 Surprise as it is rolled, and names it on the card", async () => {
		const { actor, tracks } = planner(2);
		expect(await spendSurpriseForRoll(actor, welcome)).toEqual({ note: "Spent 1 Surprise (1 left)", spent: true });
		expect(tracks[PREPARE_A_WELCOME]).toBe(1);
	});

	it("puts the Surprise back for a roll that threw no dice, never past the track", async () => {
		const { actor, tracks } = planner(2);
		await spendSurpriseForRoll(actor, welcome);
		expect(await refundSurpriseForRoll(actor)).toBe(true);
		expect(tracks[PREPARE_A_WELCOME]).toBe(2);
		expect(await refundSurpriseForRoll(actor)).toBe(false);
		expect(tracks[PREPARE_A_WELCOME]).toBe(2);
		expect(await refundSurpriseForRoll(marshal({ moves: [] }).actor)).toBe(false);
	});

	it("still rolls with none held, and says so rather than blocking", async () => {
		const { actor, tracks } = planner(0);
		expect(await spendSurpriseForRoll(actor, welcome)).toEqual({ note: "No Surprise held to spend", spent: false });
		expect(tracks[PREPARE_A_WELCOME]).toBe(0);
	});

	it("regains 1 on a 10+, never past the track, and nothing on a 7-9", async () => {
		const { actor, tracks } = planner(1);
		expect(await regainSurpriseOnHit(actor, welcome, "partial")).toBe(false);
		expect(await regainSurpriseOnHit(actor, welcome, "success")).toBe(true);
		expect(tracks[PREPARE_A_WELCOME]).toBe(2);
		expect(await regainSurpriseOnHit(actor, welcome, "success")).toBe(false);
	});

	it("leaves every other move alone", async () => {
		const { actor } = planner(2);
		expect(await spendSurpriseForRoll(actor, { name: "Clash" })).toBeNull();
		expect(await regainSurpriseOnHit(actor, { name: "Clash" }, "success")).toBe(false);
	});
});

// Prepare a Welcome: "When you have your allies fortify a position and lie in wait for battle, hold 1 Surprise
// if you're rushed or 2 Surprises if you can take your time." Two buttons on the move's card.
describe("lying in wait", () => {
	const planner = (held, moves = [PREPARE_A_WELCOME]) => marshal({ moves, held: { [PREPARE_A_WELCOME]: held } });

	it("offers both buttons on the learned move, the one that would hold no more disabled", () => {
		const fresh = lieInWaitActionsFor(planner(0).actor)[PREPARE_A_WELCOME];
		expect(fresh.map(a => [a.action, a.disabled])).toEqual([["lieInWaitRushed", false], ["lieInWaitPrepared", false]]);
		expect(fresh.map(a => a.label)).toEqual(["Lie in wait: hold 1 (rushed)", "Lie in wait: hold 2 (time to prepare)"]);
		const one = lieInWaitActionsFor(planner(1).actor)[PREPARE_A_WELCOME];
		expect(one.map(a => a.disabled)).toEqual([true, false]);
		expect(one[0].tooltip).toBe("You already hold 1 Surprise.");
		expect(lieInWaitActionsFor(planner(2).actor)[PREPARE_A_WELCOME].every(a => a.disabled)).toBe(true);
	});

	it("offers nothing without the move", () => {
		expect(lieInWaitActionsFor(planner(0, ["Stentorian"]).actor)).toEqual({});
		const off = planner(0);
		off.actor.items[0].flags = { "stonetop-pwd": { learned: false } };
		expect(lieInWaitActionsFor(off.actor)).toEqual({});
	});

	it("knows its own buttons from the post-death ones", () => {
		expect(isLieInWaitAction("lieInWaitRushed")).toBe(true);
		expect(isLieInWaitAction("lieInWaitPrepared")).toBe(true);
		expect(isLieInWaitAction("getAngry")).toBe(false);
		expect(isLieInWaitAction("toString")).toBe(false);
	});

	it("sets the hold to at least the number named, and says so", async () => {
		const { actor, tracks } = planner(0);
		expect(await lieInWait(actor, "lieInWaitRushed")).toBe(true);
		expect(tracks[PREPARE_A_WELCOME]).toBe(1);
		expect(posted[0].content).toContain("in a hurry. Maddoc holds 1 Surprise.");
		expect(await lieInWait(actor, "lieInWaitPrepared")).toBe(true);
		expect(tracks[PREPARE_A_WELCOME]).toBe(2);
		expect(posted[1].content).toContain("taking their time. Maddoc holds 2 Surprise.");
	});

	it("never lowers what is held, never adds past 2, and posts nothing when it holds no more", async () => {
		const { actor, tracks } = planner(2);
		expect(await lieInWait(actor, "lieInWaitRushed")).toBe(false);
		expect(await lieInWait(actor, "lieInWaitPrepared")).toBe(false);
		expect(tracks[PREPARE_A_WELCOME]).toBe(2);
		expect(posted).toEqual([]);
		// A longer track (a homebrewed max) still holds 2 at most from lying in wait.
		const long = planner(0);
		long.actor.items[0].system.resource.max = 3;
		await lieInWait(long.actor, "lieInWaitPrepared");
		expect(long.tracks[PREPARE_A_WELCOME]).toBe(2);
	});

	it("does nothing for a character this client cannot write, or an unknown button", async () => {
		const { actor, tracks } = planner(0);
		expect(await lieInWait(actor, "getAngry")).toBe(false);
		actor.isOwner = false;
		expect(await lieInWait(actor, "lieInWaitPrepared")).toBe(false);
		expect(tracks[PREPARE_A_WELCOME]).toBe(0);
	});

	it("is wired on the move card's buttons by the sheet", async () => {
		const { readRepo } = await import("../fakes/css.js");
		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toContain("...lieInWaitActionsFor(this.actor)");
		expect(sheet).toContain("if (isLieInWaitAction(btn.dataset.moveAction)) await lieInWait(this.actor, btn.dataset.moveAction);");
	});
});

// The Marshal's battle holds are for ONE battle (the user's ruling, 2026-10-18): the fight ending clears them
// (combat/readiness-loss.js runs clearFightHolds).
describe("clearing the fight holds", () => {
	const holder = held => {
		const made = marshal({ moves: ["Stentorian", "Front Line Leader", PREPARE_A_WELCOME], held });
		made.actor.typedActor.moveResources.usesUpdate = (move, value) => ({ [`flags.stonetop-pwd.backgroundChoices.${move}`]: value });
		made.actor.update = vi.fn(async data => {
			for (const [path, value] of Object.entries(data)) made.tracks[path.split(".").at(-1)] = value;
		});
		return made;
	};

	it("names Command, Presence and Surprise", () => {
		expect(FIGHT_HOLD_MOVES).toEqual(["Stentorian", "Front Line Leader", PREPARE_A_WELCOME]);
	});

	it("empties every hold that holds any, in one write, and leaves the other tracks alone", async () => {
		const { actor, tracks } = holder({ "Stentorian": 2, "Front Line Leader": 0, [PREPARE_A_WELCOME]: 1, "Logbook": 3 });
		expect(fightHoldsClearData(actor)).toEqual({
			"flags.stonetop-pwd.backgroundChoices.Stentorian": 0,
			[`flags.stonetop-pwd.backgroundChoices.${PREPARE_A_WELCOME}`]: 0,
		});
		expect(await clearFightHolds(actor)).toBe(true);
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(tracks).toEqual({ "Stentorian": 0, "Front Line Leader": 0, [PREPARE_A_WELCOME]: 0, "Logbook": 3 });
	});

	it("clears a hold on a move switched off since, and writes nothing when none is held", async () => {
		const off = holder({ "Stentorian": 1 });
		off.actor.items.forEach(item => { item.flags = { "stonetop-pwd": { learned: false } }; });
		expect(await clearFightHolds(off.actor)).toBe(true);
		expect(off.tracks.Stentorian).toBe(0);
		const empty = holder({});
		expect(await clearFightHolds(empty.actor)).toBe(false);
		expect(empty.actor.update).not.toHaveBeenCalled();
		expect(await clearFightHolds({ type: "character" })).toBe(false);
	});
});

// A copy embedded before the moves' `resource` was added to the pack (2026-06-09) has no track of its
// own: the pack definition's is read instead, as the sheet draws it.
describe("a stale embedded copy with no track", () => {
	// Taken before the pack gave these moves their tracks: the held copy has none until the
	// once-per-version refresh (migration/move-refresh.js) fills it from the pack, and then it works.
	const stale = ({ moves = ["Stentorian", "Front Line Leader", PREPARE_A_WELCOME], held = {} } = {}) => {
		const made = marshal({ moves, held });
		made.actor.items.forEach((item, i) => { item.system = {}; item._id = `i${i}`; });
		made.actor.updateEmbeddedDocuments = vi.fn(async (_type, updates) => {
			for (const { _id, ...paths } of updates) {
				const item = made.actor.items.find(it => it._id === _id);
				for (const [path, value] of Object.entries(paths)) item.system[path.replace(/^system\./, "")] = value;
			}
		});
		return made;
	};
	const index = Object.entries({
		"Stentorian": { max: 2, title: "Command" },
		"Front Line Leader": { max: 2, title: "Presence" },
		[PREPARE_A_WELCOME]: { max: 3, title: "Surprise" },
	}).map(([name, resource]) => ({ name, type: "move", system: { resource } }));
	const refreshed = async made => {
		expect(await refreshHeldMoves({ actors: [made.actor], entries: index })).toBe(1);
		return made;
	};

	it("offers nothing until it is refreshed, then the pack's tracks", async () => {
		const made = stale({ held: { "Front Line Leader": 1 } });
		expect(battleHoldsToFill(made.actor)).toEqual([]);
		await refreshed(made);
		expect(battleHoldsToFill(made.actor)).toEqual([
			{ move: "Stentorian", title: "Command", max: 2, held: 0 },
			{ move: "Front Line Leader", title: "Presence", max: 2, held: 1 },
		]);
	});

	it("fills them on joining a fight, once refreshed", async () => {
		const { actor, tracks: held } = await refreshed(stale());
		const moves = await offerBattleHolds(actor, { ask: async (_a, holds) => holds });
		expect(moves).toEqual(["Stentorian", "Front Line Leader"]);
		expect(held).toMatchObject({ "Stentorian": 2, "Front Line Leader": 2 });
	});

	it("spends and regains a Surprise, once refreshed", async () => {
		const { actor, tracks: held } = await refreshed(stale({ moves: [PREPARE_A_WELCOME], held: { [PREPARE_A_WELCOME]: 3 } }));
		expect(await spendSurpriseForRoll(actor, { name: PREPARE_A_WELCOME })).toEqual({ note: "Spent 1 Surprise (2 left)", spent: true });
		expect(held[PREPARE_A_WELCOME]).toBe(2);
		expect(await regainSurpriseOnHit(actor, { name: PREPARE_A_WELCOME }, "success")).toBe(true);
		expect(held[PREPARE_A_WELCOME]).toBe(3);
	});
});

// Coverage pass (2026-10-16): Stentorian's "advantage to ... Deploy" (Book I p.127) spends 1 Command off a
// Marshal this user may write, as the steading's Deploy is rolled (StonetopSteadingSheet.js).
// Rules fix (2026-10-17): "YOU have advantage to ... Deploy" is the Marshal's own, so the line names the Marshal
// Deploying, the Command comes off THAT Marshal, and a spend that fails gives no advantage.
describe("Command spent for a steading's Deploy", () => {
	it("lists the Marshals this user may write who hold Command", () => {
		const bryn = marshal({ held: { Stentorian: 2 }, id: "b" });
		const empty = marshal({ held: { Stentorian: 0 }, id: "e" });
		const theirs = marshal({ held: { Stentorian: 2 }, id: "t" });
		theirs.actor.isOwner = false;
		expect(commandHolders([empty.actor, theirs.actor, bryn.actor])).toEqual([bryn.actor]);
	});

	it("offers only the user's own Marshal when they hold Command, else every one they may write", () => {
		const own = marshal({ held: { Stentorian: 1 }, id: "own" });
		const other = marshal({ held: { Stentorian: 2 }, id: "other" });
		other.actor.name = "Bryn";
		const actors = [other.actor, own.actor];
		expect(deployCommandOffers(actors, { character: own.actor })).toEqual([{ id: "own", name: "Maddoc" }]);
		// A GM (no character), or a player whose own character holds none: a pick among the rest.
		expect(deployCommandOffers(actors, { character: null })).toEqual([{ id: "other", name: "Bryn" }, { id: "own", name: "Maddoc" }]);
		const spent = marshal({ held: { Stentorian: 0 }, id: "spent" });
		expect(deployCommandOffers([...actors, spent.actor], { character: spent.actor }).map(o => o.id)).toEqual(["other", "own"]);
	});

	it("spends from the Marshal named, not the first holder found", async () => {
		const first = marshal({ held: { Stentorian: 2 }, id: "first" });
		const named = marshal({ held: { Stentorian: 2 }, id: "named" });
		const actors = [first.actor, named.actor];
		expect(await spendCommandForDeploy("named", actors)).toBe("Maddoc");
		expect(named.tracks.Stentorian).toBe(1);
		expect(first.tracks.Stentorian).toBe(2);
		expect(await spendCommandForDeploy("nobody", actors)).toBeNull();
		expect(await spendCommandForDeploy("", actors)).toBeNull();
	});

	it("clears the advantage when the Command cannot be spent", async () => {
		const empty = marshal({ held: { Stentorian: 0 }, id: "e" });
		const out = await deployCommandAnswers({ command: "e", strength: "yes" }, { actors: [empty.actor] });
		expect(out).toEqual({ command: "", commandRefused: true, strength: "yes" });
		const full = marshal({ held: { Stentorian: 1 }, id: "f" });
		expect(await deployCommandAnswers({ command: "f" }, { actors: [full.actor] })).toEqual({ command: "Maddoc" });
		expect(full.tracks.Stentorian).toBe(0);
		const untouched = { strength: "" };
		expect(await deployCommandAnswers(untouched, { actors: [full.actor] })).toBe(untouched);
	});

	it("is spent before the steading's Deploy is adjusted, from the window's own offer", async () => {
		const { readRepo } = await import("../fakes/css.js");
		const sheet = readRepo("module/actors/steading/StonetopSteadingSheet.js");
		expect(sheet).toContain("command: deployCommandOffers(),");
		// Generically: whichever taken answers' questions carry a `spend` (improvement-rolls.js).
		const spend = sheet.indexOf("await spendImprovementAnswers(askedQuestions, windowAnswers)");
		const adjust = sheet.indexOf("const adjusted = await settleSteadingRoll(");
		expect(spend).toBeGreaterThan(0);
		expect(spend).toBeLessThan(adjust);
		expect(sheet).not.toContain("deployCommandAnswers");
	});
});
