import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	battleHoldsToFill, battleHoldsContent, askBattleHolds, offerBattleHolds, installBattleHolds,
	spendSurpriseForRoll, regainSurpriseOnHit, PREPARE_A_WELCOME, commandHolders, spendCommandForDeploy,
	deployCommandOffers, deployCommandAnswers,
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
		expect(await spendSurpriseForRoll(actor, welcome)).toBe("Spent 1 Surprise (1 left)");
		expect(tracks[PREPARE_A_WELCOME]).toBe(1);
	});

	it("still rolls with none held, and says so rather than blocking", async () => {
		const { actor, tracks } = planner(0);
		expect(await spendSurpriseForRoll(actor, welcome)).toBe("No Surprise held to spend");
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
		expect(await spendSurpriseForRoll(actor, { name: PREPARE_A_WELCOME })).toBe("Spent 1 Surprise (2 left)");
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
