import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";

// The fight curtain (module/fight/fight-curtain.js): once per fight, on the client that has just met
// it, never for a fight under way at load, and never for an ambush a player cannot see yet.

const played = [];
vi.mock("../../module/moments/moment-overlay.js", () => ({ playMoment: view => { played.push(view); return !!view; } }));
let nextStop = null;
vi.mock("../../module/utils/shared-route.js", () => ({
	readSharedRoute: () => (nextStop ? { id: "share" } : null),
	sharedNextStop: shared => (shared ? nextStop : null),
}));

const {
	curtainStep, seedFightCurtain, syncFightCurtain, fightRoadLine, _resetFightCurtain,
} = await import("../../module/fight/fight-curtain.js");

describe("curtainStep", () => {
	const state = (ids = [], seeded = true) => ({ announced: new Set(ids), seeded });
	const input = p => ({ fightId: "f1", canSee: true, enabled: true, ...p });

	it("plays once for a fight this reader has just met", () => {
		expect(curtainStep(state(), input())).toBe(true);
		expect(curtainStep(state(["f1"]), input())).toBe(false);
	});

	it("plays nothing before ready, with Table moments off, with no fight, or with nobody to see", () => {
		expect(curtainStep(state([], false), input())).toBe(false);
		expect(curtainStep(state(), input({ enabled: false }))).toBe(false);
		expect(curtainStep(state(), input({ fightId: null }))).toBe(false);
		expect(curtainStep(state(), input({ canSee: false }))).toBe(false);
	});
});

describe("the curtain at the table", () => {
	let saved;
	let momentsOn;

	beforeEach(() => {
		saved = { game: globalThis.game, canvas: globalThis.canvas };
		played.length = 0;
		nextStop = null;
		momentsOn = true;
		_resetFightCurtain();
	});
	afterEach(() => {
		globalThis.game = saved.game;
		globalThis.canvas = saved.canvas;
	});

	/** Bram and a crinwin in a fight on the reader's map; `combats` starts empty unless `already`. */
	function table({ user = { id: "gm", isGM: true }, hidden = false, already = false } = {}) {
		const bram = fakeToken({ id: "tBram", hidden, actor: fakeActor({ id: "bram" }) });
		const crinwin = fakeToken({ id: "tCrin", col: 1, hidden, actor: fakeActor({ id: "crinwin", type: "monster" }) });
		const scene = fakeScene({ tokens: [bram, crinwin] });
		const combat = fakeCombat({
			scene,
			combatants: [
				fakeCombatant({ id: "cBram", token: bram, scene, side: "heroes", hidden, visible: !hidden }),
				fakeCombatant({ id: "cCrin", token: crinwin, scene, side: "foes", hidden, visible: !hidden }),
			],
		});
		globalThis.game = {
			...saved.game,
			ready: true,
			user,
			users: collection([]),
			combats: collection(already ? [combat] : []),
			settings: { get: (_ns, key) => (key === "tableMoments" ? momentsOn : undefined) },
		};
		globalThis.canvas = { scene };
		seedFightCurtain();
		globalThis.game.combats = collection([combat]);
		return { combat };
	}

	it("plays the fight band once, however often the fight redraws", () => {
		table();
		expect(syncFightCurtain()).toBe(true);
		expect(syncFightCurtain()).toBe(false);
		expect(played.map(view => view.kind)).toEqual(["fight"]);
		expect(played[0].sub).toBe("");
	});

	it("plays nothing for a fight already under way when this client loaded", () => {
		table({ already: true });
		expect(syncFightCurtain()).toBe(false);
		expect(played).toEqual([]);
	});

	it("waits for a player to see someone, then plays when a combatant is revealed", () => {
		const { combat } = table({ user: { id: "player", isGM: false }, hidden: true });
		expect(syncFightCurtain()).toBe(false);
		const crin = combat.combatants.get("cCrin");
		Object.assign(crin, { hidden: false, visible: true });
		Object.assign(crin.token, { hidden: false });
		expect(syncFightCurtain()).toBe(true);
		expect(played).toHaveLength(1);
	});

	it("plays for a GM at once, hidden foes and all", () => {
		table({ hidden: true });
		expect(syncFightCurtain()).toBe(true);
	});

	it("does not replay a fight met while Table moments was off", () => {
		table();
		momentsOn = false;
		expect(syncFightCurtain()).toBe(false);
		momentsOn = true;
		expect(syncFightCurtain()).toBe(false);
		expect(played).toEqual([]);
	});

	it("does nothing before the game is ready", () => {
		table();
		globalThis.game.ready = false;
		expect(syncFightCurtain()).toBe(false);
	});

	it("names the next stop only from the route the players were shown", () => {
		table();
		nextStop = "the Crossroads";
		expect(fightRoadLine()).toBe("On the road to the Crossroads");
		syncFightCurtain();
		expect(played[0].sub).toBe("On the road to the Crossroads");
		nextStop = null;
		expect(fightRoadLine()).toBe("");
	});
});
