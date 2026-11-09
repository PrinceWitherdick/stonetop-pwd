// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";

// The players' route window says out loud when the GM shows them a new way (audit RTE-3). It has
// to do it through a live region that EXISTS before the words change: the window's content is
// replaced on every render and swapped in parts by `follow`, and a region replaced along with its
// words is never announced. So the region sits on the window frame, outside `.window-content`.

vi.mock("../../module/utils/open-or-focus.js", () => ({ openOrFocus: (_id, make) => make() }));

const { SharedRouteWindow } = await import("../../module/dialogs/SharedRouteWindow.js");
const { sharedRoutePayload } = await import("../../module/utils/shared-route.js");
const { frameFor } = await import("../../module/data/travel-times.js");

const ART = { src: "art/gm-vicinity.webp", out: "assets/maps/gm-vicinity.webp", frame: frameFor("assets/maps/gm-vicinity.webp"), aspect: 584 / 422 };
const share = (destination, id) => sharedRoutePayload({
	trip: { id: "trip-1", title: "", journey: { origin: "stonetop", destination } }, tier: "vicinity", art: ART, id,
});

let store;
beforeEach(() => {
	store = {};
	global.game = {
		i18n: global.game.i18n,
		user: { isGM: false },
		settings: {
			settings: new Map([["stonetop-pwd.sharedRoute", { scope: "world" }]]),
			get: (_ns, key) => store[key],
			set: (_ns, key, value) => { store[key] = value; return Promise.resolve(value); },
		},
	};
});

/** A live window on a real element, whose "render" replaces the content the way AppV1 does. */
function mounted() {
	const frame = document.createElement("div");
	frame.className = "app stonetop-shared-route-app";
	frame.innerHTML = `<div class="window-content"><div class="stonetop-shared-route-head">old</div></div>`;
	document.body.append(frame);
	const app = new SharedRouteWindow({ live: true });
	app.rendered = true;
	app._element = [frame];
	Object.defineProperty(app, "element", { get: () => app._element });
	app.setOverlay = () => {};
	app.render = async () => {
		frame.querySelector(".window-content").innerHTML = `<div class="stonetop-shared-route-head">new</div>`;
	};
	return { app, frame };
}

describe("the window's announcement channel", () => {
	it("is made once, on the frame, and outlives the content being replaced", async () => {
		store.sharedRoute = share("the-crossroads", "a");
		const { app, frame } = mounted();
		const region = app._liveRegion();
		expect(region.getAttribute("aria-live")).toBe("polite");
		expect(region.parentElement).toBe(frame);

		// A new way across a different map: a full render.
		store.sharedRoute = { ...share("the-maw", "b"), art: { ...ART, src: "art/other.webp" } };
		await app.follow();
		expect(app._liveRegion()).toBe(region);
		expect(frame.querySelectorAll(".stonetop-shared-route-live")).toHaveLength(1);
		expect(region.textContent).toContain("The way to the Maw");

		// And the GM stopping: said too.
		store.sharedRoute = {};
		await app.follow();
		expect(region.textContent).toContain("isn’t showing a route right now");
	});
});
