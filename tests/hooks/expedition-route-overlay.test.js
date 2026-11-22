import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SYSTEM_ID } from "../../module/system-id.js";
import { POSTER_MAPS } from "../../module/book2-art/poster-map-catalog.js";
import { SCENE_ROUTE_FLAG, SCENE_ROUTE_PROGRESS_FLAG, sceneRoutePlan } from "../../module/utils/scene-route.js";
import {
	moveExpeditionParty, partyWalkPoints, refreshExpeditionRoute, registerExpeditionRouteHooks,
} from "../../module/hooks/ExpeditionRouteOverlay.js";
import { journeyKey } from "../../module/utils/travel-route.js";
import { useFakeHooks } from "../fakes/hooks.js";

// The party mark on the canvas scene (hooks/ExpeditionRouteOverlay.js). PIXI, the canvas and its
// ticker are stand-ins, so this proves the bookkeeping (which Graphics exist, where the mark is
// put, when a walk starts and stops) and the walk's maths, NOT what a live canvas paints.

// A way drawn by hand through three marks, so there are three legs to walk.
const JOURNEY = {
	origin: "stonetop",
	destination: null,
	custom: { tier: "vicinity", points: [{ fx: 0.4, fy: 0.6 }, { fx: 0.5, fy: 0.45 }, { fx: 0.6, fy: 0.55 }] },
};

class FakeGraphics {
	constructor() {
		this.destroyed = false;
		this.position = { x: 0, y: 0, set: (x, y) => { this.position.x = x; this.position.y = y; } };
	}
	lineStyle() {}
	beginFill() {}
	endFill() {}
	drawCircle() {}
	drawPolygon() {}
	moveTo() {}
	quadraticCurveTo() {}
	destroy() { this.destroyed = true; }
}

function sceneWith(reached) {
	const map = POSTER_MAPS.find(m => m.slug === "vicinity");
	return {
		id: "scene-vicinity",
		width: map.width,
		height: map.height,
		flags: { [SYSTEM_ID]: {
			posterMap: "vicinity",
			[SCENE_ROUTE_FLAG]: JOURNEY,
			...(reached === null ? {} : { [SCENE_ROUTE_PROGRESS_FLAG]: { reached, key: journeyKey(JOURNEY) } }),
		} },
	};
}

let hooks, children, ticker, now;
const party = () => children.filter(c => !c.destroyed)[1] ?? null;
const setProgress = reached => {
	globalThis.canvas.scene = sceneWith(reached);
	return { flags: { [SYSTEM_ID]: { [SCENE_ROUTE_PROGRESS_FLAG]: { reached } } } };
};

beforeEach(() => {
	hooks = useFakeHooks();
	children = [];
	now = 0;
	ticker = { callbacks: new Set(), add: vi.fn(fn => ticker.callbacks.add(fn)), remove: vi.fn(fn => ticker.callbacks.delete(fn)) };
	globalThis.PIXI = { Graphics: FakeGraphics, LINE_CAP: { ROUND: "round" }, LINE_JOIN: { ROUND: "round" } };
	globalThis.canvas = {
		ready: true,
		scene: sceneWith(0),
		app: { ticker },
		drawings: { addChild: g => (children.push(g), g) },
	};
	vi.spyOn(performance, "now").mockImplementation(() => now);
	registerExpeditionRouteHooks();
});

afterEach(() => {
	hooks.fire("canvasTearDown");
	hooks.restore();
	vi.restoreAllMocks();
	delete globalThis.PIXI;
	delete globalThis.canvas;
	delete globalThis.matchMedia;
});

const tick = ms => {
	now += ms;
	for (const fn of [...ticker.callbacks]) fn();
};

describe("partyWalkPoints", () => {
	it("walks the plan's own legs from one stop to the next, in scene pixels", () => {
		const plan = sceneRoutePlan(sceneWith(0));
		const total = plan.reach.length - 1;
		const points = partyWalkPoints(plan, 0, total);
		expect(points[0].left).toBeCloseTo(plan.legs[0].from.x, 6);
		expect(points.at(-1).top).toBeCloseTo(plan.legs.at(-1).to.y, 6);
		expect(total).toBe(3);
		const back = partyWalkPoints(plan, total, 0);
		expect(back).toHaveLength(points.length);
		expect(back[0].left).toBeCloseTo(points.at(-1).left, 6);
		expect(back.at(-1).top).toBeCloseTo(points[0].top, 6);
	});

	it("has nothing to walk without legs or a move", () => {
		expect(partyWalkPoints(null, 0, 1)).toEqual([]);
		expect(partyWalkPoints(sceneRoutePlan(sceneWith(0)), 1, 1)).toEqual([]);
	});
});

describe("the party mark on the canvas", () => {
	it("is drawn on top of the line, at the stop the scene names", () => {
		refreshExpeditionRoute();
		expect(children).toHaveLength(2);
		const plan = sceneRoutePlan(globalThis.canvas.scene);
		expect(party().position.x).toBeCloseTo(plan.party.x, 6);
		expect(party().position.y).toBeCloseTo(plan.party.y, 6);
	});

	it("is not drawn for a trip with no progress on the scene", () => {
		globalThis.canvas.scene = sceneWith(null);
		refreshExpeditionRoute();
		expect(children).toHaveLength(1);
	});

	it("walks there on a progress-only update, then stands exactly on the stop", () => {
		refreshExpeditionRoute();
		const line = children[0];
		hooks.fire("updateScene", globalThis.canvas.scene, setProgress(1));
		expect(line.destroyed).toBe(false);
		expect(ticker.add).toHaveBeenCalledTimes(1);
		const goal = sceneRoutePlan(globalThis.canvas.scene).party;
		tick(400);
		expect(party().position.x).not.toBeCloseTo(goal.x, 0);
		tick(2000);
		expect(ticker.callbacks.size).toBe(0);
		expect(party().position.x).toBeCloseTo(goal.x, 6);
		expect(party().position.y).toBeCloseTo(goal.y, 6);
	});

	it("jumps for a reader who asked for less motion", () => {
		globalThis.matchMedia = () => ({ matches: true });
		refreshExpeditionRoute();
		hooks.fire("updateScene", globalThis.canvas.scene, setProgress(1));
		expect(ticker.add).not.toHaveBeenCalled();
		const goal = sceneRoutePlan(globalThis.canvas.scene).party;
		expect(party().position.x).toBeCloseTo(goal.x, 6);
	});

	it("repaints rather than walks when the route itself changed", () => {
		refreshExpeditionRoute();
		const line = children[0];
		hooks.fire("updateScene", globalThis.canvas.scene, { flags: { [SYSTEM_ID]: { [SCENE_ROUTE_FLAG]: JOURNEY } } });
		expect(line.destroyed).toBe(true);
		expect(ticker.add).not.toHaveBeenCalled();
	});

	it("takes the mark down when the progress is cleared", () => {
		refreshExpeditionRoute();
		hooks.fire("updateScene", globalThis.canvas.scene, setProgress(null));
		expect(children.filter(c => !c.destroyed)).toHaveLength(1);
	});

	it("lets go of the ticker before a repaint and when the canvas comes down", () => {
		refreshExpeditionRoute();
		hooks.fire("updateScene", globalThis.canvas.scene, setProgress(1));
		expect(ticker.callbacks.size).toBe(1);
		refreshExpeditionRoute();
		expect(ticker.callbacks.size).toBe(0);

		hooks.fire("updateScene", globalThis.canvas.scene, setProgress(2));
		expect(ticker.callbacks.size).toBe(1);
		hooks.fire("canvasTearDown");
		expect(ticker.callbacks.size).toBe(0);
		expect(moveExpeditionParty()).toBe(false);
	});
});
