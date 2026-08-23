import { describe, it, expect } from "vitest";
import { readRepo } from "../fakes/css.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { POSTER_MAPS, posterSceneFor } from "../../module/book2-art/poster-map-catalog.js";
import { frameFor, spotPercent, travelPlace } from "../../module/data/travel-times.js";
import { journeyRoute } from "../../module/utils/travel-route.js";
import { MAP_PIN_ICON_SIZE } from "../../module/utils/map-pins.js";
import { tierDrawing } from "../../module/utils/route-path.js";
import {
	ROUTE_CASE_WIDTH, ROUTE_DOT_GAP, ROUTE_DOT_SIZE, ROUTE_HEAD_SIZE,
	ROUTE_INK_FALLBACK, ROUTE_WAYPOINT_HEAD_SIZE, SCENE_ROUTE_FLAG,
	clearRouteOnScene, routeFlagTouched, routeInk, sceneJourney, sceneRouteCheck,
	sceneRoutePlan, sceneRouteRefusal, sceneShowsJourney, showRouteOnScene,
} from "../../module/utils/scene-route.js";

// Putting an expedition's route on the GM's own Scene of the same poster map.
//
// The curve itself is proven next door (tests/utils/route-path.test.js and the walkthrough's own
// journey tests). What is covered here is everything that only matters once the line is going onto
// a real Scene: whether THIS Scene is allowed to carry it, what the GM is told when it is not, and
// where on it the marks actually land.


/** A poster-map Scene as the catalog builds one: the shipped size, flagged with its slug. */
function posterScene(slug, over = {}) {
	const map = POSTER_MAPS.find(m => m.slug === slug);
	return {
		id: `scene-${slug}`,
		name: map.name,
		width: map.width,
		height: map.height,
		flags: { [SYSTEM_ID]: { posterMap: slug } },
		...over,
	};
}

/** The route the graph solves between two places. */
const routeTo = (destination, origin = "stonetop") => journeyRoute({ origin, destination });

describe("which scene a route may go on", () => {
	it("takes a journey both ends of which the scene's map draws", () => {
		const check = sceneRouteCheck(posterScene("vicinity"), routeTo("the-crossroads"));
		expect(check.ok).toBe(true);
		expect(check.tier).toBe("vicinity");
		expect(check.tierName).toBe("The Vicinity");
		expect(check.path.legs.length).toBeGreaterThan(0);
	});

	// The reason the check asks the SCENE which map it is rather than taking the walkthrough's
	// word for it. The panel follows a destination out to the World's End while the table is still
	// looking at the Vicinity, and a walk to the Crossroads is drawable on both (it is lettered on
	// the Vicinity and anchored on the World's End): refusing because the two windows disagreed
	// would be refusing something that plainly works.
	it("takes the same journey on the other map, when that map draws it too", () => {
		expect(sceneRouteCheck(posterScene("worlds-end"), routeTo("the-crossroads")).ok).toBe(true);
	});

	it("refuses a scene that is no map of ours, and names the one that is", () => {
		const check = sceneRouteCheck({ name: "The Barrow", width: 4000, height: 3000, flags: {} },
			routeTo("the-crossroads"));
		expect(check.ok).toBe(false);
		expect(check.reason).toBe("not-a-map");
		expect(check.wanted).toBe("vicinity");
	});

	// A poster map this system knows and the travel table charts nothing across. You do not chart
	// a course to your own steading, and none of what the village map letters is a node with legs.
	it("refuses the village map, which is a poster and not a tier", () => {
		const check = sceneRouteCheck(posterScene("stonetop-village"), routeTo("the-crossroads"));
		expect(check.reason).toBe("wrong-map");
		expect(check.onName).toBe("Stonetop — The Village");
		expect(check.wantedName).toBe("The Vicinity");
	});

	it("refuses a journey with an end this map does not place, and says which end", () => {
		// Tor's Fist is a World's End place; ask the Vicinity for the way there.
		expect(travelPlace("tors-fist").spots.vicinity).toBeUndefined();
		const check = sceneRouteCheck(posterScene("vicinity"), routeTo("tors-fist"));
		expect(check.reason).toBe("off-map");
		// `names` is the ARRAY of places this map cannot draw; the words are made by offMapNames.
		expect(check.note.names).toEqual(["Tor's Fist"]);
		expect(check.wanted).toBe("worlds-end");
	});

	// A frame is a claim about the shape of a particular file, and a GM who saved their own
	// differently-trimmed scan over one of the names we know breaks that claim silently. A map with
	// no route on it is obviously missing one; a map with the route through the wrong valleys looks
	// finished and is worse than useless.
	it("refuses a scene whose picture is not the shape the positions were measured against", () => {
		const check = sceneRouteCheck(posterScene("vicinity", { height: 6000 }), routeTo("the-crossroads"));
		expect(check.reason).toBe("wrong-shape");
	});

	it("refuses with nothing to draw, and with nowhere to draw it", () => {
		expect(sceneRouteCheck(posterScene("vicinity"), null).reason).toBe("no-destination");
		expect(sceneRouteCheck(null, routeTo("the-crossroads")).reason).toBe("no-scene");
		expect(sceneRouteCheck(posterScene("vicinity", { width: 0 }), routeTo("the-crossroads")).reason).toBe("no-size");
	});

	// Both ends, not just the far one. Stonetop is the only place drawn on both maps, so asking
	// about the destination alone sends a walk from the Red Grove out to the map of the whole
	// continent, where the Red Grove has no pin at all.
	it("picks the closest map that draws BOTH ends", () => {
		expect(tierDrawing(routeTo("stonetop", "the-red-grove"))).toBe("vicinity");
		expect(tierDrawing(routeTo("lygos"))).toBe("worlds-end");
		expect(tierDrawing(null)).toBeNull();
	});
});

describe("what the GM is told when it will not draw", () => {
	const refusal = (scene, route, opts) => sceneRouteRefusal(sceneRouteCheck(scene, route), opts);

	it("names the map that would take it, and says to open it", () => {
		const said = refusal(posterScene("stonetop-village"), routeTo("the-crossroads"), { hasScene: true });
		expect(said).toContain("The Vicinity");
		expect(said).toContain("Open The Vicinity and try again");
	});

	// A world that never imported the book art has no Scene to open, and sending the reader
	// looking for one is worse than saying nothing.
	it("sends them to the macro instead when this world has no such scene", () => {
		const said = refusal(posterScene("stonetop-village"), routeTo("the-crossroads"), { hasScene: false });
		expect(said).toContain("Import Book Art");
		expect(said).not.toContain("Open The Vicinity");
	});

	it("names the end the map cannot place", () => {
		const said = refusal(posterScene("vicinity"), routeTo("tors-fist"), { hasScene: true });
		expect(said).toContain("The Vicinity");
		expect(said).toContain("Tor");
		expect(said).toContain("The World's End");
	});

	it("has something to say for every refusal it can produce", () => {
		for (const reason of ["no-scene", "no-destination", "not-a-map", "wrong-map", "no-size",
			"wrong-shape", "off-map"]) {
			const said = sceneRouteRefusal({ ok: false, reason, onName: "A Map", wantedName: null });
			expect(said.length).toBeGreaterThan(10);
			// The house rule, and this file is copy the GM reads on screen.
			expect(said).not.toContain("—");
		}
	});
});

describe("where the marks land on the scene", () => {
	const drawn = () => {
		const scene = posterScene("vicinity", {
			flags: {
				[SYSTEM_ID]: {
					posterMap: "vicinity",
					[SCENE_ROUTE_FLAG]: { origin: "stonetop", destination: "the-crossroads", title: "A trip" },
				},
			},
		});
		return { scene, plan: sceneRoutePlan(scene) };
	};

	it("draws nothing for a scene carrying no route", () => {
		expect(sceneRoutePlan(posterScene("vicinity"))).toBeNull();
	});

	it("puts the first bead on the place they set out from", () => {
		const { scene, plan } = drawn();
		const home = spotPercent(travelPlace("stonetop").spots.vicinity, frameFor("assets/maps/map-vicinity.webp"));
		expect(plan.dots[0].x).toBeCloseTo((home.left / 100) * scene.width, 3);
		expect(plan.dots[0].y).toBeCloseTo((home.top / 100) * scene.height, 3);
	});

	it("spaces the beads a gap apart in scene pixels", () => {
		const { plan } = drawn();
		expect(plan.dots.length).toBeGreaterThan(4);
		for (let i = 1; i < plan.dots.length; i++) {
			const step = Math.hypot(plan.dots[i].x - plan.dots[i - 1].x, plan.dots[i].y - plan.dots[i - 1].y);
			expect(step).toBeCloseTo(ROUTE_DOT_GAP, 0);
		}
	});

	it("keeps every mark inside the scene", () => {
		const { scene, plan } = drawn();
		for (const dot of [...plan.dots, ...plan.heads]) {
			expect(dot.x).toBeGreaterThanOrEqual(0);
			expect(dot.y).toBeGreaterThanOrEqual(0);
			expect(dot.x).toBeLessThanOrEqual(scene.width);
			expect(dot.y).toBeLessThanOrEqual(scene.height);
		}
	});

	it("gives the destination the larger head and the stops along the way the smaller", () => {
		const scene = posterScene("worlds-end", {
			flags: {
				[SYSTEM_ID]: {
					posterMap: "worlds-end",
					[SCENE_ROUTE_FLAG]: { origin: "stonetop", destination: "lygos" },
				},
			},
		});
		const heads = sceneRoutePlan(scene).heads;
		expect(heads.length).toBeGreaterThan(1);
		expect(heads.at(-1).size).toBe(ROUTE_HEAD_SIZE);
		expect(heads.slice(0, -1).every(h => h.size === ROUTE_WAYPOINT_HEAD_SIZE)).toBe(true);
	});

	it("hands the ribbon back as quadratics, since PIXI cannot read the SVG string", () => {
		const { plan } = drawn();
		for (const leg of plan.legs) {
			for (const point of [leg.from, leg.control, leg.to]) {
				expect(Number.isFinite(point.x)).toBe(true);
				expect(Number.isFinite(point.y)).toBe(true);
			}
		}
	});
});

// The line and the pins are the same annotation layer, drawn by the same hand, so their weights
// hold to each other rather than to the picture underneath. Written as a derivation and pinned
// here, because a bare number could not say so: re-tuning the pin size used to move every pin out
// from under a route that stayed exactly where it was.
describe("how heavily the line is drawn", () => {
	it("is measured against the pins already standing on the map", () => {
		expect(ROUTE_CASE_WIDTH).toBe(MAP_PIN_ICON_SIZE * 0.4);
	});

	// The walkthrough draws one 7px cream stroke dashed so finely it reads as a ribbon, with 3.5px
	// red beads riding down it one stroke-width apart. The bead and the gap are those proportions
	// scaled up together, so the Scene and the dialog are two pictures of one drawing.
	it("keeps the walkthrough's own proportions for the ribbon and its beads", () => {
		expect(ROUTE_DOT_SIZE).toBe(ROUTE_CASE_WIDTH / 2);
		expect(ROUTE_DOT_GAP).toBe(ROUTE_CASE_WIDTH);
	});

	// The heads are written out rather than scaled, and this is the relationship that has to
	// survive a retune of either end: a head is louder than the ribbon it sits on and quieter than
	// the pin it stops short of, with the waypoints' quieter still than the destination's.
	it("keeps each head between the ribbon it sits on and the pin it points at", () => {
		expect(ROUTE_WAYPOINT_HEAD_SIZE).toBeLessThan(ROUTE_HEAD_SIZE);
		expect(ROUTE_CASE_WIDTH).toBeLessThan(ROUTE_WAYPOINT_HEAD_SIZE);
		expect(ROUTE_HEAD_SIZE).toBeLessThan(MAP_PIN_ICON_SIZE);
	});
});

// A placeable's x/y are CANVAS coordinates, and the canvas is the scene rectangle plus its
// padding margin — so on a padded Scene the artwork's own origin is not (0,0). Every number in a
// plan is measured as a fraction of the PICTURE, so without the offset the whole route lands up
// and to the left of the country it names, with the map itself untouched and nothing logged. The
// pins already standing on the same map are placed through the same helper for the same reason.
describe("where on a padded scene the marks land", () => {
	const padded = (pad) => {
		const scene = posterScene("vicinity", {
			flags: {
				[SYSTEM_ID]: {
					posterMap: "vicinity",
					[SCENE_ROUTE_FLAG]: { origin: "stonetop", destination: "the-crossroads" },
				},
			},
		});
		scene.dimensions = { sceneX: pad, sceneY: pad };
		return sceneRoutePlan(scene);
	};

	it("offsets every leg, bead and head by the scene's own origin", () => {
		const flush = padded(0);
		const shifted = padded(500);
		expect(flush.legs.length).toBeGreaterThan(0);
		expect(flush.dots.length).toBeGreaterThan(0);
		expect(flush.heads.length).toBeGreaterThan(0);
		for (const [i, leg] of shifted.legs.entries()) {
			expect(leg.from.x).toBeCloseTo(flush.legs[i].from.x + 500, 6);
			expect(leg.to.y).toBeCloseTo(flush.legs[i].to.y + 500, 6);
			expect(leg.control.x).toBeCloseTo(flush.legs[i].control.x + 500, 6);
		}
		expect(shifted.dots[0].x).toBeCloseTo(flush.dots[0].x + 500, 6);
		expect(shifted.heads[0].y).toBeCloseTo(flush.heads[0].y + 500, 6);
		// The head's size and angle are the picture's, not the canvas's, so neither moves.
		expect(shifted.heads[0].angle).toBe(flush.heads[0].angle);
		expect(shifted.heads[0].size).toBe(flush.heads[0].size);
	});

	// A Scene stand-in has no computed `dimensions`, and zero is exactly right for the unpadded
	// case it stands in for.
	it("treats a scene with no dimensions as unpadded", () => {
		expect(padded(0).legs[0].from.x).toBeGreaterThan(0);
	});
});

describe("what the scene remembers", () => {
	/**
	 * A Scene stand-in with just enough of the document API to be written to.
	 *
	 * `update` rather than `setFlag`, because that is what the writes use: a flag stamped under a
	 * system id this package no longer answers to cannot be reached through `setFlag`/`unsetFlag`
	 * at all, since core validates the scope against the ACTIVE package ids and throws otherwise.
	 * So this expands the dotted paths and honours the `-=` deletion key, which is the whole of
	 * what those writes rely on.
	 */
	function writableScene(slug = "vicinity") {
		const scene = posterScene(slug);
		scene.update = async (changes) => {
			for (const [path, value] of Object.entries(changes ?? {})) {
				const parts = path.split(".");
				const key = parts.pop();
				let node = scene;
				for (const part of parts) node = (node[part] ??= {});
				if (key.startsWith("-=")) delete node[key.slice(2)];
				else node[key] = value;
			}
		};
		return scene;
	}

	it("stores the two slugs and nothing solved", async () => {
		const scene = writableScene();
		// The trip's own id and title are handed in and DELIBERATELY not kept: nothing reads them
		// back, and a title copied onto the scene goes stale the moment the trip is renamed.
		const where = await showRouteOnScene(scene, { origin: "stonetop", destination: "the-crossroads", id: "t1", title: "A trip" });
		expect(where).toBe("the Crossroads");
		expect(scene.flags[SYSTEM_ID][SCENE_ROUTE_FLAG])
			.toEqual({ origin: "stonetop", destination: "the-crossroads" });
	});

	// The read walks every id this package has shipped under, so the delete has to as well. It
	// used to unset the pinned id alone, which after a rename removed a key that had never been
	// written: the panel went on offering to take off a line it could no longer take off.
	it("takes a route off whichever id it was stamped under", async () => {
		const scene = writableScene();
		scene.flags.stonetop = { [SCENE_ROUTE_FLAG]: { origin: "stonetop", destination: "the-crossroads" } };
		expect(sceneJourney(scene)?.destination).toBe("the-crossroads");
		expect(await clearRouteOnScene(scene)).toBe(true);
		expect(sceneJourney(scene)).toBeNull();
		expect(scene.flags.stonetop[SCENE_ROUTE_FLAG]).toBeUndefined();
	});

	// A legacy scope is walked FIRST, so one left standing would outrank the route being drawn.
	it("clears a legacy copy on its way past when a new route is drawn", async () => {
		const scene = writableScene();
		scene.flags.stonetop = { [SCENE_ROUTE_FLAG]: { origin: "stonetop", destination: "lygos" } };
		await showRouteOnScene(scene, { origin: "stonetop", destination: "the-crossroads" });
		expect(scene.flags.stonetop[SCENE_ROUTE_FLAG]).toBeUndefined();
		expect(sceneJourney(scene)?.destination).toBe("the-crossroads");
	});

	it("reads it back, and knows when the scene is showing this very journey", async () => {
		const scene = writableScene();
		await showRouteOnScene(scene, { origin: "stonetop", destination: "the-crossroads" });
		expect(sceneJourney(scene).destination).toBe("the-crossroads");
		expect(sceneShowsJourney(scene, { origin: "stonetop", destination: "the-crossroads" })).toBe(true);
		expect(sceneShowsJourney(scene, { origin: "stonetop", destination: "lygos" })).toBe(false);
		expect(sceneShowsJourney(posterScene("vicinity"), { destination: "the-crossroads" })).toBe(false);
	});

	it("takes it off again", async () => {
		const scene = writableScene();
		await showRouteOnScene(scene, { origin: "stonetop", destination: "the-crossroads" });
		expect(await clearRouteOnScene(scene)).toBe(true);
		expect(sceneJourney(scene)).toBeNull();
		// Nothing to clear is not a failure, it is a scene with no line on it.
		expect(await clearRouteOnScene(scene)).toBe(false);
	});

	it("writes nothing for a journey with no destination", async () => {
		const scene = writableScene();
		expect(await showRouteOnScene(scene, { origin: "stonetop", destination: "" })).toBeNull();
		expect(sceneJourney(scene)).toBeNull();
	});

	// A world that predates the rename must not read as bare, the same walk `posterMapSlugOf`
	// already does for the poster flag itself.
	it("reads a route stamped under an id this package has shipped under before", () => {
		const scene = posterScene("vicinity", {
			flags: { stonetop: { [SCENE_ROUTE_FLAG]: { origin: "stonetop", destination: "the-crossroads" } },
				[SYSTEM_ID]: { posterMap: "vicinity" } },
		});
		expect(sceneJourney(scene)?.destination).toBe("the-crossroads");
	});

	// Two watchers repaint off this one, and a Scene is written to constantly.
	it("notices the flag being set and unset, and nothing else", () => {
		expect(routeFlagTouched({ flags: { [SYSTEM_ID]: { [SCENE_ROUTE_FLAG]: {} } } })).toBe(true);
		expect(routeFlagTouched({ flags: { [SYSTEM_ID]: { [`-=${SCENE_ROUTE_FLAG}`]: null } } })).toBe(true);
		expect(routeFlagTouched({ flags: { [SYSTEM_ID]: { posterMap: "vicinity" } } })).toBe(false);
		expect(routeFlagTouched({ darkness: 0.5 })).toBe(false);
		expect(routeFlagTouched(null)).toBe(false);
	});

	it("finds this world's scene for a map, by flag or by the shipped name", () => {
		const byFlag = posterScene("vicinity", { name: "Renamed by the GM" });
		expect(posterSceneFor("vicinity", [byFlag])).toBe(byFlag);
		expect(posterSceneFor("worlds-end", [{ name: "The World's End", flags: {} }])).toBeTruthy();
		expect(posterSceneFor("worlds-end", [byFlag])).toBeNull();
	});
});

// Two renderers of one line have to agree about the colour of the road. The stylesheet's
// `--stonetop-route-*` tokens are the one authority now and the Scene painter reads them back, so
// what is left to guard is the MIRROR: the fallbacks the painter uses before the stylesheet is up
// (and in these tests, where there is no document at all) must be what the tokens say.
describe("the scene draws the line in the same ink the dialog does", () => {
	const css = readRepo("styles/stonetop.css");
	const hex = n => `#${n.toString(16).padStart(6, "0")}`;
	// Read without a regex: the value is everything between the token's colon and the next
	// semicolon, and a hand-escaped pattern here has already been wrong once.
	const token = (name) => {
		const key = `--stonetop-route-${name}:`;
		const at = css.indexOf(key);
		return at < 0 ? null : css.slice(at + key.length, css.indexOf(";", at)).trim();
	};

	it("declares the ink as tokens the walkthrough's own rules consume", () => {
		expect(css).toContain("stroke: var(--stonetop-route-ink)");
		expect(css).toContain("stroke: var(--stonetop-route-case)");
		expect(css).toContain("stroke-opacity: var(--stonetop-route-case-alpha)");
	});

	it("keeps the painter's fallbacks equal to those tokens", () => {
		expect(token("ink")).toBe(hex(ROUTE_INK_FALLBACK.ink));
		expect(token("case")).toBe(hex(ROUTE_INK_FALLBACK.case));
		expect(Number(token("case-alpha"))).toBe(ROUTE_INK_FALLBACK.caseAlpha);
	});

	// No document in these tests, which is the pre-paint case the fallback exists for.
	it("answers with the fallbacks when there is no stylesheet to read", () => {
		expect(routeInk()).toEqual(ROUTE_INK_FALLBACK);
	});

	// The bead is half the ribbon and the gap is the ribbon, which is what the dialog's
	// `stroke-dasharray: 0.1 7` on a 7px case with a 3.5px ink amounts to.
	it("keeps the proportions the dialog's dash pattern has", () => {
		expect(ROUTE_DOT_SIZE).toBe(ROUTE_CASE_WIDTH / 2);
		expect(ROUTE_DOT_GAP).toBe(ROUTE_CASE_WIDTH);
	});
});

// ── A way the GM drew, on the table's own map ────────────────────────────────
//
// The flag carries the trip and every client works the line out again, which is what lets a
// correction to the travel table reach a route already on a Scene. A hand-drawn way is the same
// bargain with a different payload: the map it was drawn on, and the marks on it.

/** A trip with a way drawn on one map. */
const drawnTrip = (points, { origin = "stonetop", tier = "vicinity" } = {}) =>
	({ origin, destination: "lygos", custom: { on: true, tier, points } });

/** A Scene already showing whatever `showRouteOnScene` would have written for `trip`. */
async function sceneShowing(slug, trip) {
	const scene = posterScene(slug);
	scene.update = update => {
		for (const [key, value] of Object.entries(update)) {
			if (key.startsWith("flags.") && !key.includes("-=")) {
				scene.flags[SYSTEM_ID] = { ...scene.flags[SYSTEM_ID], [SCENE_ROUTE_FLAG]: value };
			}
		}
		return Promise.resolve(scene);
	};
	await showRouteOnScene(scene, trip);
	return scene;
}

describe("putting a hand-drawn way on a scene", () => {
	it("writes the map and the marks, and not the destination", async () => {
		const trip = drawnTrip([{ fx: 0.4, fy: 0.6 }]);
		const scene = await sceneShowing("vicinity", trip);
		expect(scene.flags[SYSTEM_ID][SCENE_ROUTE_FLAG]).toEqual({
			origin: "stonetop",
			custom: { on: true, tier: "vicinity", points: [{ fx: 0.4, fy: 0.6 }] },
		});
	});

	it("reads back as the way that was drawn", async () => {
		const trip = drawnTrip([{ fx: 0.4, fy: 0.6 }]);
		const scene = await sceneShowing("vicinity", trip);
		expect(sceneJourney(scene).custom.points).toEqual([{ fx: 0.4, fy: 0.6 }]);
		expect(sceneShowsJourney(scene, trip)).toBe(true);
	});

	// The destination is remembered while the box is ticked and it is NOT what the line is about,
	// so changing it must not make the button offer to redraw a line already there.
	it("stays in step when the destination changes underneath it", async () => {
		const trip = drawnTrip([{ fx: 0.4, fy: 0.6 }]);
		const scene = await sceneShowing("vicinity", trip);
		expect(sceneShowsJourney(scene, { ...trip, destination: "marshedge" })).toBe(true);
		expect(sceneShowsJourney(scene, drawnTrip([{ fx: 0.4, fy: 0.7 }]))).toBe(false);
	});

	it("is not a route until a mark is put down", () => {
		const scene = posterScene("vicinity", {
			flags: { [SYSTEM_ID]: { posterMap: "vicinity", [SCENE_ROUTE_FLAG]: { origin: "stonetop", custom: { on: true, tier: "vicinity", points: [] } } } },
		});
		expect(sceneJourney(scene)).toBeNull();
	});

	// A drawn way's marks are fractions of ONE picture. Named here rather than left to fall through
	// to the geometry, whose refusal would come out as "this map doesn't draw <place>" — the wrong
	// problem, sending the reader after a place when what they need is the other map.
	it("refuses the other map by name, and says which one would take it", () => {
		const route = journeyRoute(drawnTrip([{ fx: 0.4, fy: 0.6 }]));
		const check = sceneRouteCheck(posterScene("worlds-end"), route);
		expect(check.ok).toBe(false);
		expect(check.reason).toBe("wrong-map");
		expect(check.wanted).toBe("vicinity");
		expect(sceneRouteRefusal(check, { hasScene: true })).toContain("The Vicinity");
	});

	it("lands its marks on the scene in the same places the dialog draws them", () => {
		const scene = posterScene("vicinity", {
			flags: {
				[SYSTEM_ID]: {
					posterMap: "vicinity",
					[SCENE_ROUTE_FLAG]: { origin: "stonetop", custom: { on: true, tier: "vicinity", points: [{ fx: 0.25, fy: 0.5 }] } },
				},
			},
		});
		const plan = sceneRoutePlan(scene);
		expect(plan.legs).toHaveLength(1);
		const wanted = spotPercent({ fx: 0.25, fy: 0.5 }, frameFor(POSTER_MAPS.find(m => m.slug === "vicinity").out));
		expect(plan.legs[0].to.x).toBeCloseTo((wanted.left / 100) * scene.width, 4);
		expect(plan.legs[0].to.y).toBeCloseTo((wanted.top / 100) * scene.height, 4);
	});
});
