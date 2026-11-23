import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { deployLayout, fightersOn, partyTokensOn } from "../../module/fight/deploy-layout.js";
import { viewRectWorld } from "../../module/fight/start-fight.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection, GRID } from "../fakes/fight.js";

// Where the GM Toolkit's Deploy puts things (module/fight/deploy-layout.js): the party on the left,
// what was deployed on the right. Two traps it guards: a fight already going on is laid out ROUND,
// not on top of (its fighters handed to the line-up where they stand), and a recruited follower
// walking the map unlinked still lines up with their character.

const saved = {};
beforeEach(() => {
	saved.game = globalThis.game;
	saved.canvas = globalThis.canvas;
	saved.ui = globalThis.ui;
	saved.CONST = globalThis.CONST;
	globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } };
	globalThis.ui = { combat: { viewed: null } };
});
afterEach(() => {
	globalThis.game = saved.game;
	globalThis.canvas = saved.canvas;
	globalThis.ui = saved.ui;
	globalThis.CONST = saved.CONST;
});

const monster = id => ({ ...fakeActor({ id, type: "monster" }), prototypeToken: { disposition: -1, width: 1, height: 1 } });

function setUp({ tokens = [], combats = [] } = {}) {
	const scene = fakeScene({ tokens });
	for (const t of tokens) t.getSnappedPosition = ({ x, y }) => ({ x, y });
	globalThis.game = { ...saved.game, user: { id: "gm", isGM: true }, combats: collection(combats), actors: collection([]) };
	globalThis.canvas = {
		scene,
		dimensions: { size: GRID, sceneRect: { x: 0, y: 0, width: 8000, height: 6000 }, rect: { contains: () => true } },
		grid: { size: GRID },
		stage: { worldTransform: { applyInverse: ({ x, y }) => ({ x: x + 1000, y: y + 500 }) } },
	};
	return scene;
}

/** The grid square the middle of the view falls on. */
function viewMiddle() {
	const view = viewRectWorld(globalThis.canvas);
	return { col: Math.round((view.x + view.w / 2) / GRID), row: Math.round((view.y + view.h / 2) / GRID) };
}

describe("deployLayout", () => {
	it("puts the party left of what was deployed, round the middle of the view with no fight here", () => {
		const bram = { ...fakeActor({ id: "bram", type: "character" }), uuid: "Actor.bram" };
		setUp({ tokens: [fakeToken({ id: "tBram", col: 2, row: 2, actor: bram })] });
		const { points, moves } = deployLayout({ actors: [monster("wolf")] });
		expect(moves).toHaveLength(1);
		expect(moves[0].x).toBeLessThan(points[0].x);
	});

	it("lays the newcomers out clear of a fight already going on, and moves nobody in it", () => {
		// The fight stands in the middle of the view, which is where a deploy with no regard for it
		// put the newcomers. Read off the canvas, so it is set up first.
		setUp();
		const { col, row } = viewMiddle();
		const bram = { ...fakeActor({ id: "bram", type: "character" }), uuid: "Actor.bram" };
		const crin = fakeActor({ id: "crin", type: "monster" });
		const tBram = fakeToken({ id: "tBram", col, row, actor: bram });
		const tCrin = fakeToken({ id: "tCrin", col: col + 1, row, actor: crin });
		const scene = fakeScene({ tokens: [tBram, tCrin] });
		const fight = fakeCombat({ scene, combatants: [
			fakeCombatant({ id: "cBram", token: tBram, scene, side: "heroes" }),
			fakeCombatant({ id: "cCrin", token: tCrin, scene, side: "foes" }),
		] });
		setUp({ tokens: [tBram, tCrin], combats: [fight] });
		globalThis.canvas.scene = fight.scene = scene;
		expect(fightersOn(scene).map(f => f.side)).toEqual(["heroes", "foes"]);

		const { points, moves } = deployLayout({ actors: [monster("wolf"), monster("rat")] });
		expect(moves).toEqual([]);
		const fighters = [tBram, tCrin].map(t => t._source);
		for (const p of points) {
			expect(p).not.toBeNull();
			const at = { col: Math.floor(p.x / GRID), row: Math.floor(p.y / GRID) };
			for (const f of fighters) {
				const apart = Math.max(Math.abs(at.col - f.x / GRID), Math.abs(at.row - f.y / GRID));
				expect(apart, "an arrival landed touching the fight").toBeGreaterThan(1);
			}
		}
	});
});

describe("partyTokensOn", () => {
	it("lines up a recruited follower walking the map unlinked with their character", () => {
		const bram = {
			...fakeActor({ id: "bram", type: "character", flags: { [SYSTEM_ID]: { crew: { details: { sourceUuid: "Actor.crew" } } } } }),
			uuid: "Actor.bram",
		};
		const crew = {
			...fakeActor({ id: "crew", type: "npc" }),
			uuid: "Scene.scene1.Token.tCrew.Actor.crew",
			isToken: true,
			token: { actorId: "crew", baseActor: { uuid: "Actor.crew" } },
		};
		const scene = setUp({ tokens: [
			fakeToken({ id: "tBram", col: 2, row: 2, actor: bram }),
			fakeToken({ id: "tCrew", col: 30, row: 20, actor: crew }),
		] });
		expect(partyTokensOn(scene).map(t => t.id)).toEqual(["tBram", "tCrew"]);
	});
});
