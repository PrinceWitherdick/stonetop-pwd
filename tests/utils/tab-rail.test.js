import { describe, it, expect } from "vitest";
import { railHangsLeft, railTopFor } from "../../module/utils/tab-rail.js";
import { readRepo, readCss, declarations } from "../fakes/css.js";

// The vertical icon rail hangs OUTSIDE the window frame, which buys it the dnd5e silhouette
// and costs it every guarantee a child of the sheet gets for free. Two of those are geometry,
// and both fail silently — the rail still renders, just in the wrong place or off the screen:
//
//  1. `--st-rail-top` is measured with client rects (post-transform) and then consumed inside
//     the transformed frame (scaled again). Right at scale 1, adrift at any other.
//  2. `left: 100%` puts the rail past the viewport whenever the window is flush right, and
//     there is no horizontal strip to fall back to — the classic tab strip is behind an
//     off-by-default client setting, so the sheet simply has no reachable tabs.
//
// The arithmetic for both is pure and exported so it can be checked here; the placement itself
// is verified in a browser.

const read = readRepo;

const RAIL_JS = read("module/utils/tab-rail.js");
const CSS = readCss();

/** Everything an exact selector declares, across every rule that names it — see fakes/css.js. */
const block = (selector) => declarations(CSS, selector);

describe("railTopFor", () => {
	// The header banner ends 154px below the frame's top; + the 1rem gap dnd5e uses.
	it("hangs the rail one rem below the sheet's own header banner", () => {
		const top = railTopFor({ bottom: 354 }, { top: 200, width: 960 }, 960);
		expect(top).toBe(170);
	});

	// The bug this exists for. At scale 1.5 the rects report 1.5x the distance, and the value is
	// then scaled AGAIN by the frame's own transform when `top:` consumes it — so the rail would
	// start 2.25x as far down as the header actually ends.
	it("divides the transform back out, so a scaled window measures the same", () => {
		const unscaled = railTopFor({ bottom: 354 }, { top: 200, width: 960 }, 960);
		// Same window at scale 1.5: every client-rect number is multiplied, offsetWidth is not.
		const scaled = railTopFor({ bottom: 531 }, { top: 300, width: 1440 }, 960);
		expect(scaled).toBe(unscaled);
	});

	// A frame still `display: none` on its first render measures 0 for everything, and 0/0 is
	// NaN — which would be written into the custom property and blank the rail's `top`.
	it("falls back to scale 1 rather than dividing by zero", () => {
		expect(railTopFor({ bottom: 100 }, { top: 0, width: 0 }, 0)).toBe(116);
	});

	// The GM Toolkit scrolls as ONE unit with its banner inside the scroll, and it re-renders on
	// every threat, hazard and site write. A re-render landing mid-scroll measures the banner
	// where it has ridden up to, so without the scroll term the rail — which lives on the window
	// frame, outside the scroll — would be re-stamped further up the window every tick, and off
	// the top of it entirely once the sheet is scrolled past the banner's own height.
	it("reads the banner's at-rest position, so a scrolled sheet stamps the same number", () => {
		const atRest = railTopFor({ bottom: 354 }, { top: 200, width: 960 }, 960, 0);
		// Same sheet scrolled 300px: the banner's rect has moved up by exactly that much.
		const scrolled = railTopFor({ bottom: 54 }, { top: 200, width: 960 }, 960, 300);
		expect(scrolled).toBe(atRest);
	});

	// `scrollTop` is untransformed and the rects are not, so the term has to land on the far side
	// of the divide. Added before it, a scrolled sheet at scale 1.5 would under-correct by a
	// third and the rail would still creep up the window.
	it("adds the scroll back after dividing the transform out, not before", () => {
		const scaled = railTopFor({ bottom: 81 }, { top: 300, width: 1440 }, 960, 300);
		expect(scaled).toBe(railTopFor({ bottom: 354 }, { top: 200, width: 960 }, 960, 0));
	});

	// Every other sheet pins its header, so the default must be a no-op — this is one call site
	// shared by all of them.
	it("defaults to no scroll, leaving a pinned header measured exactly as before", () => {
		expect(railTopFor({ bottom: 354 }, { top: 200, width: 960 }, 960))
			.toBe(railTopFor({ bottom: 354 }, { top: 200, width: 960 }, 960, 0));
	});
});

describe("railHangsLeft", () => {
	const VIEWPORT = 1920;

	it("stays on the right whenever the right has room", () => {
		// A 960px sheet sitting well inside a 1920px viewport.
		expect(railHangsLeft({ left: 400, right: 1360 }, 44, VIEWPORT)).toBe(false);
	});

	// Core clamps a window's left to `Math.max(innerWidth - scaledWidth, 0)`, so flush right is
	// a position it hands out on any drag toward that edge.
	it("flips left when the window is flush against the viewport's right edge", () => {
		expect(railHangsLeft({ left: 960, right: 1920 }, 44, VIEWPORT)).toBe(true);
	});

	// The 960px character sheet on a 1024px browser window: no room either side, but the left
	// has more of it, and an overhanging rail still beats one that is entirely off-screen.
	it("prefers the roomier side when neither can hold the whole rail", () => {
		expect(railHangsLeft({ left: 64, right: 1024 }, 44, 1024)).toBe(true);
	});

	// Once flipped, the frame's own box is unchanged — an absolutely positioned rail contributes
	// nothing to it — so re-measuring must return the same answer. Otherwise the drag handler,
	// which re-measures every frame, would flap the rail between the two edges.
	it("gives a stable answer, so re-measuring cannot flap the rail", () => {
		const frameRect = { left: 960, right: 1920 };
		expect(railHangsLeft(frameRect, 44, VIEWPORT)).toBe(true);
		expect(railHangsLeft(frameRect, 44, VIEWPORT)).toBe(true);
	});

	// A sheet narrower than the rail, pinned left, has nowhere better to go.
	it("stays on the right when the left is no better", () => {
		expect(railHangsLeft({ left: 0, right: 1920 }, 44, VIEWPORT)).toBe(false);
	});
});

describe("the mounted rail", () => {
	// A drag never re-renders — Foundry drives it entirely through setPosition — so a side
	// decision taken only at render time is a decision taken before the user moves the window
	// to the edge that breaks it.
	it("re-checks its edge on every window move, not only on render", () => {
		expect(RAIL_JS).toContain("watchRailSide(app, frame)");
		const watch = RAIL_JS.slice(RAIL_JS.indexOf("function watchRailSide"));
		expect(watch).toContain("app.setPosition = function");
		// Installed once per sheet: a second wrapper would call the first, and so on per render.
		expect(watch).toContain("if (app._stonetopRailSideWatched) return;");
		// A drag calls in at 60Hz and stampRailSide reads layout, so one measurement per frame.
		expect(watch).toContain("requestAnimationFrame");
	});

	// A character with no playbook yet renders the create call-to-action instead of the tabs.
	// The marker has to come off with the rail or the next sheet on that frame is styled for an
	// edge it is not on.
	it("clears the edge marker along with the rail", () => {
		const mount = RAIL_JS.slice(RAIL_JS.indexOf("export function mountTabRail"));
		expect(mount).toContain('frame.classList.remove("stonetop-tab-rail-left")');
	});

	// A first render measures 0 for everything — the frame is still `display: none` behind
	// _injectHTML's fadeIn. The TOP survives that (the frame keeps the previous render's value
	// and re-stamps on the next), but on a first open the edge has no previous value, and the
	// default one is exactly the case that hides the tabs. So the edge check has to wait the
	// fade out, and it has to run even when the header anchor is the thing that measures 0.
	it("keeps trying until the rail has a width, independently of the top stamp", () => {
		const side = RAIL_JS.slice(RAIL_JS.indexOf("function stampRailSide"));
		expect(side).toMatch(/if \(retries > 0\) requestAnimationFrame\(\(\) => stampRailSide\(frame, retries - 1\)\)/);
		// Bounded, or a sheet that never lays out spins a rAF for the life of the session.
		expect(RAIL_JS).toMatch(/const RAIL_MEASURE_RETRIES = \d+;/);
		// Ahead of both of stampRailTop's bail-outs.
		const top = RAIL_JS.slice(RAIL_JS.indexOf("function stampRailTop"));
		expect(top.indexOf("stampRailSide(frame)")).toBeLessThan(top.indexOf("if (!anchor) return;"));
	});
});

describe("the mirrored rail CSS", () => {
	const flipped = () => block(".stonetop.stonetop-tab-rail-left .sheet-tabs.stonetop-tab-rail");

	it("exists, and moves the rail to the other edge", () => {
		const rule = flipped();
		expect(rule, "no rule for the left-hand rail").toBeTruthy();
		expect(rule).toMatch(/right:\s*100%/);
		// `left: 100%` is still in the base rule and would otherwise pin both edges at once.
		expect(rule).toMatch(/left:\s*auto/);
	});

	// The panel reads as one piece with the sheet because it is open on the edge that meets it.
	// Mirroring the position without mirroring the chrome leaves a border down the seam and a
	// rounded corner where the sheet is.
	it("mirrors the chrome, not just the position", () => {
		const rule = flipped();
		expect(rule, "border").toMatch(/border-left:\s*2px solid slategrey/);
		expect(rule, "border").toMatch(/border-right:\s*none/);
		expect(rule, "radius").toMatch(/border-radius:\s*8px 0 0 8px/);
		expect(rule, "shadow casts away from the seam").toMatch(/box-shadow:\s*-3px/);
	});

	// One class heavier than the base rule and written after it, so it wins outright — no
	// `!important` needed, and no dependence on source order alone.
	it("comes after the rule it overrides", () => {
		expect(CSS.indexOf(".stonetop.stonetop-tab-rail-left .sheet-tabs.stonetop-tab-rail"))
			.toBeGreaterThan(CSS.indexOf(".stonetop .sheet-tabs.stonetop-tab-rail {"));
	});

	// It must not restate `display`, or it would undo the `.minimized` hide that collapses the
	// rail with the window — that rule sits above this one and is no heavier.
	it("leaves the minimized-window hide alone", () => {
		expect(flipped()).not.toMatch(/display:/);
		expect(CSS).toContain(".stonetop.stonetop-has-tab-rail.minimized .sheet-tabs.stonetop-tab-rail");
	});
});
