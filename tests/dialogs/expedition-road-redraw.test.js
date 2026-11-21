// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";

// The road panel's in-place redraw after a Travel press (ExpeditionDialog#_refreshRoadPanel), on a real
// DOM. The `where` line is the panel's live region, and it must STAY IN THE DOCUMENT while its words
// change: one taken out and put back is a fresh region inserted with its text already in, which not
// every screen reader reads out. And a redraw that fails after the step is saved must not cost the
// players their arrival band.

vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));
const sent = vi.hoisted(() => []);
vi.mock("../../module/moments/moment-broadcast.js", () => ({ sendMoment: payload => { sent.push(payload); return true; } }));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");
const { sharedRoutePayload } = await import("../../module/utils/shared-route.js");
const { journeyKey, journeyRoute } = await import("../../module/utils/travel-route.js");

const TRAIL = "systems/stonetop-pwd/templates/dialogs/partials/expedition-trail.hbs";
const JOURNEY = { origin: "stonetop", destination: "three-coven-lake" };
const LEGS = journeyRoute(JOURNEY).legs;

let store;

const trip = reached => ({
	id: "trip-1", title: "The Long Walk", createdAt: 0, journey: JOURNEY,
	progress: { reached, key: journeyKey(JOURNEY) },
});

/** A dialog with the road panel drawn on the page, as the walkthrough's render leaves it. */
async function mounted(t) {
	store.expeditionAnswers = { currentId: t.id, list: [t] };
	const d = Object.create(ExpeditionDialog.prototype);
	d._rolls = {};
	d._step = ExpeditionDialog.prototype._steps.findIndex(s => s.key === "running");
	d.render = vi.fn();
	const root = document.createElement("div");
	root.innerHTML = `<div class="stonetop-exp-trail-wrap">${await renderTemplate(TRAIL, { road: d._roadContext() })}</div>`;
	document.body.append(root);
	d.element = [root];
	return { d, root };
}

beforeEach(() => {
	sent.length = 0;
	document.body.replaceChildren();
	store = { expeditionAnswers: {} };
	global.game = {
		i18n: global.game.i18n,
		user: { isGM: true, id: "gm" },
		actors: Object.assign([], { contents: [] }),
		settings: {
			settings: new Map([
				["stonetop-pwd.expeditionAnswers", { scope: "world" }],
				["stonetop-pwd.sharedRoute", { scope: "world" }],
			]),
			get: (_ns, key) => store[key],
			set: (_ns, key, value) => { store[key] = value; return Promise.resolve(value); },
		},
	};
});

describe("the road panel's redraw", () => {
	it("keeps the where line and its section in the document, and changes only the words", async () => {
		const { d, root } = await mounted(trip(0));
		const section = root.querySelector(".stonetop-exp-trail");
		const where = root.querySelector(".stonetop-exp-trail-where");
		const removed = [];
		new MutationObserver(records => records.forEach(r => removed.push(...r.removedNodes))).observe(root, { childList: true, subtree: true });

		await d._travel(1);
		await Promise.resolve();

		expect(root.querySelector(".stonetop-exp-trail")).toBe(section);
		expect(root.querySelector(".stonetop-exp-trail-where")).toBe(where);
		expect(where.isConnected).toBe(true);
		expect(removed).not.toContain(where);
		expect(removed).not.toContain(section);
		expect(where.textContent).toBe(`Leg 2 of ${LEGS.length}: next stop ${LEGS[1].toName}.`);
		// Everything around the line is the new draw: the travelled leg says so, in order after the line.
		expect(root.querySelector('[data-leg="0"] .stonetop-exp-trail-leg-state').textContent).toBe("travelled");
		expect([...section.children].map(el => el.className.split(" ")[0]))
			.toEqual(["stonetop-guide-aside-head", "stonetop-exp-trail-where", "stonetop-exp-trail-track", "stonetop-exp-trail-buttons"]);
	});

	it("still counts the step and still sends the arrival band when the redraw fails", async () => {
		const shown = trip(0);
		const { d } = await mounted(shown);
		store.sharedRoute = sharedRoutePayload({ trip: shown, tier: "worlds-end", id: "share-1", now: 1 });
		d._refreshRoadPanel = vi.fn(() => Promise.reject(new Error("template went missing")));
		const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(d._travel(1)).resolves.toBe(true);

		expect(store.expeditionAnswers.list[0].progress.reached).toBe(1);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ kind: "arrive", title: `Reached ${LEGS[0].toName}` });
		// The panel is drawn again whole, so it does not keep the old leg's words.
		expect(d.render).toHaveBeenCalledWith(false);
		quiet.mockRestore();
	});
});
