import { describe, it, expect, beforeEach } from "vitest";

// A site's pin on the table's own copy of the map.
//
// The walkthrough's route step records where one of the GM's sites stands as a fraction of a
// PRINTED regional map. The Scene the table plays on is built from the poster scan of that same
// artwork, which is a different crop of it, so what is proven here is that one placement lands in
// one valley on both — and that the four things that can happen to a spot (placed, moved, moved to
// the other map, lifted) each leave the Scenes saying the same thing the site does.
//
// What DRESSES the pin is not proven here and is not this module's: a Note linked to a prep page is
// textured and labelled by the `preCreateNote` seam (tests/hooks/threat-note-pins.test.js).

import { POSTER_MAPS } from "../../module/book2-art/poster-map-catalog.js";
import { MAP_FRAMES, TRAVEL_MAPS } from "../../module/data/travel-times.js";
import { posterSceneForTier, siteScenePoint, syncSitePin } from "../../module/sites/site-scene-pins.js";

const VICINITY = POSTER_MAPS.find(m => m.slug === "vicinity");
const WORLDS_END = POSTER_MAPS.find(m => m.slug === "worlds-end");

/** The steading's single hidden Sites entry, and one page of it. */
const SITES_ENTRY = { id: "sites-entry" };
const sitePage = (name) => ({ id: name, name, parent: SITES_ENTRY });
const BARROW = sitePage("The Sunken Barrow");

let noteId = 0;

/**
 * A Scene stand-in for one poster map, recognised by the flag the importer stamps.
 *
 * Its own note collection, and writers that behave the way Foundry's do: create assigns an id,
 * update patches by `_id`, delete removes. `calls` records what was asked of it, so a test can
 * prove that a Scene with nothing to change was not written to at all.
 */
function posterScene(map, notes = []) {
	const scene = {
		name: map.name,
		width: map.width,
		height: map.height,
		flags: { "stonetop-pwd": { posterMap: map.slug } },
		notes,
		calls: [],
		createEmbeddedDocuments(_type, data) {
			scene.calls.push("create");
			const made = data.map(d => ({ id: `note-${++noteId}`, ...d }));
			scene.notes.push(...made);
			return Promise.resolve(made);
		},
		updateEmbeddedDocuments(_type, updates) {
			scene.calls.push("update");
			for (const change of updates) Object.assign(scene.notes.find(n => n.id === change._id), change);
			return Promise.resolve(updates);
		},
		deleteEmbeddedDocuments(_type, ids) {
			scene.calls.push("delete");
			scene.notes = scene.notes.filter(n => !ids.includes(n.id));
			return Promise.resolve(ids);
		},
	};
	return scene;
}

/** A pin already down, linked the way core's own page drop links one. */
const pinFor = (page, at = { x: 0, y: 0 }) =>
	({ id: `note-${++noteId}`, entryId: page.parent.id, pageId: page.id, ...at });

/** A spot in the middle of the printed crop, which is NOT the middle of the poster file. */
const MIDDLE = { fx: 0.5, fy: 0.5 };

beforeEach(() => {
	noteId = 0;
	global.game = { user: { isGM: true }, system: { id: "stonetop-pwd" } };
});

describe("finding the Scene a spot belongs on", () => {
	it("takes the Scene the importer stamped for that tier", () => {
		const scenes = [posterScene(WORLDS_END), posterScene(VICINITY)];
		expect(posterSceneForTier("vicinity", scenes)?.name).toBe("The Vicinity");
	});

	// `posterMapSlugOf`, not `posterSceneFor`: this is a reader about to place a mark at a fraction
	// of one exact printing, so a Scene claimed by NAME alone has to be showing that printing. A
	// GM's own dungeon called "The Vicinity" would otherwise collect site pins.
	it("will not adopt a Scene by name unless it is painted with that map", () => {
		const impostor = { name: "The Vicinity", width: 4000, height: 3000, flags: {}, notes: [] };
		expect(posterSceneForTier("vicinity", [impostor])).toBeNull();

		const painted = { ...impostor, background: { src: "worlds/x/assets/maps/map-vicinity.webp" } };
		expect(posterSceneForTier("vicinity", [painted])).toBe(painted);
	});

	it("answers null for a world that has never built one", () => {
		expect(posterSceneForTier("vicinity", [])).toBeNull();
		expect(posterSceneForTier("", [posterScene(VICINITY)])).toBeNull();
	});
});

describe("where a spot lands on the Scene", () => {
	// THE WHOLE POINT OF THE FRACTIONS. The printed page is inset inside the poster scan, so the
	// middle of the printed crop is NOT the middle of the file: it is halfway between the frame's
	// own edges. Getting this wrong puts every site pin in the wrong valley on the table's map,
	// which is the one failure that looks finished.
	it("reads the fraction against the printed crop inside the poster file", () => {
		const frame = MAP_FRAMES[VICINITY.out];
		const scene = posterScene(VICINITY);
		expect(siteScenePoint({ tier: "vicinity", ...MIDDLE }, scene)).toEqual({
			x: Math.round((frame.x0 + 0.5 * (frame.x1 - frame.x0)) * VICINITY.width),
			y: Math.round((frame.y0 + 0.5 * (frame.y1 - frame.y0)) * VICINITY.height),
		});
	});

	// A placeable's x/y are CANVAS coordinates, and the canvas is the scene rectangle plus its
	// padding. Measured from zero on a Scene a GM has since padded, every pin lands out on the
	// blank margin with the map itself untouched.
	it("measures from the picture's own corner, not the canvas's", () => {
		const scene = posterScene(VICINITY);
		scene.dimensions = { sceneX: 200, sceneY: 140 };
		const padded = siteScenePoint({ tier: "vicinity", ...MIDDLE }, scene);
		const bare = siteScenePoint({ tier: "vicinity", ...MIDDLE }, posterScene(VICINITY));
		expect(padded).toEqual({ x: bare.x + 200, y: bare.y + 140 });
	});

	// A frame is a claim about the shape of one file, and a GM who saved their own differently
	// trimmed scan over a name we know has broken it without breaking anything a caller could see.
	it("refuses a Scene that is not the shape the fractions were measured against", () => {
		const wrong = posterScene(VICINITY);
		wrong.height = wrong.width;                     // a square, which no printing of this is
		expect(siteScenePoint({ tier: "vicinity", ...MIDDLE }, wrong)).toBeNull();
	});

	it("refuses a spot on no map, and a Scene with no size", () => {
		expect(siteScenePoint(null, posterScene(VICINITY))).toBeNull();
		expect(siteScenePoint({ tier: "beyond", ...MIDDLE }, posterScene(VICINITY))).toBeNull();
		expect(siteScenePoint({ tier: "vicinity", ...MIDDLE }, { width: 0, height: 0 })).toBeNull();
	});
});

describe("keeping the Scenes in step with the spot", () => {
	it("puts a pin down, linked to the page so it opens the write-up", async () => {
		const vicinity = posterScene(VICINITY);
		const answer = await syncSitePin(BARROW, { tier: "vicinity", ...MIDDLE }, { scenes: [vicinity] });

		expect(answer.scene).toBe(vicinity);
		expect(answer.moved).toBe(false);
		expect(vicinity.notes).toHaveLength(1);
		expect(vicinity.notes[0]).toMatchObject({
			entryId: SITES_ENTRY.id,
			pageId: BARROW.id,
			...siteScenePoint({ tier: "vicinity", ...MIDDLE }, vicinity),
		});
	});

	// Nothing else is written: what a prep pin LOOKS like belongs to the preCreateNote seam, so a
	// pin laid here is indistinguishable from one the GM dragged on by hand.
	it("writes a position and a link and nothing else", async () => {
		const vicinity = posterScene(VICINITY);
		await syncSitePin(BARROW, { tier: "vicinity", ...MIDDLE }, { scenes: [vicinity] });
		expect(Object.keys(vicinity.notes[0]).sort()).toEqual(["entryId", "id", "pageId", "x", "y"]);
	});

	it("moves the pin already there rather than laying a second one", async () => {
		const already = pinFor(BARROW, { x: 10, y: 20 });
		const vicinity = posterScene(VICINITY, [already]);

		const answer = await syncSitePin(BARROW, { tier: "vicinity", fx: 0.25, fy: 0.75 }, { scenes: [vicinity] });

		expect(answer.moved).toBe(true);
		expect(vicinity.calls).toEqual(["update"]);
		expect(vicinity.notes).toHaveLength(1);
		expect(vicinity.notes[0].id).toBe(already.id);
		expect(vicinity.notes[0]).toMatchObject(
			siteScenePoint({ tier: "vicinity", fx: 0.25, fy: 0.75 }, vicinity));
	});

	// A site stands in ONE place, so a second pin naming it is a second mark for one thing, and
	// leaving one behind while the other moves is the one outcome that could not be right.
	it("moves every pin that names the same site", async () => {
		const vicinity = posterScene(VICINITY, [pinFor(BARROW), pinFor(BARROW, { x: 99, y: 99 })]);
		await syncSitePin(BARROW, { tier: "vicinity", ...MIDDLE }, { scenes: [vicinity] });
		const at = siteScenePoint({ tier: "vicinity", ...MIDDLE }, vicinity);
		for (const note of vicinity.notes) expect(note).toMatchObject(at);
	});

	// Re-placing a site on the OTHER regional map is still a move: the spot it had is gone, so the
	// mark that pictured it has to go with it or the two Scenes disagree about where the site is.
	it("takes the pin off the map the site has left", async () => {
		const vicinity = posterScene(VICINITY, [pinFor(BARROW)]);
		const worldsEnd = posterScene(WORLDS_END);

		const answer = await syncSitePin(BARROW, { tier: "worlds-end", ...MIDDLE },
			{ scenes: [vicinity, worldsEnd] });

		expect(answer.scene).toBe(worldsEnd);
		expect(vicinity.notes).toEqual([]);
		expect(worldsEnd.notes).toHaveLength(1);
	});

	it("takes it off everywhere when the pin is lifted", async () => {
		const vicinity = posterScene(VICINITY, [pinFor(BARROW)]);
		const worldsEnd = posterScene(WORLDS_END, [pinFor(BARROW)]);

		expect(await syncSitePin(BARROW, null, { scenes: [vicinity, worldsEnd] })).toBeNull();
		expect(vicinity.notes).toEqual([]);
		expect(worldsEnd.notes).toEqual([]);
	});

	// Silence where there is nothing to do: this runs on every placement, and a Scene with no pin
	// for this site and no reason to gain one should not be written to at all.
	it("writes nothing to a Scene with nothing to change", async () => {
		const worldsEnd = posterScene(WORLDS_END);
		await syncSitePin(BARROW, { tier: "vicinity", ...MIDDLE }, { scenes: [worldsEnd] });
		expect(worldsEnd.calls).toEqual([]);
	});

	// A mark the GM dragged onto a dungeon of their own is not a claim about where the site sits on
	// the Vicinity, and neither is another site's pin on the poster map itself.
	it("touches no Scene but the regional posters, and no pin but this site's", async () => {
		const other = pinFor(sitePage("The Old Mill"));
		const vicinity = posterScene(VICINITY, [other]);
		const dungeon = {
			name: "Bandit Camp", width: 2000, height: 2000, flags: {},
			notes: [pinFor(BARROW)],
			deleteEmbeddedDocuments: () => Promise.reject(new Error("must not be touched")),
			updateEmbeddedDocuments: () => Promise.reject(new Error("must not be touched")),
			createEmbeddedDocuments: () => Promise.reject(new Error("must not be touched")),
		};

		await syncSitePin(BARROW, { tier: "vicinity", ...MIDDLE }, { scenes: [vicinity, dungeon] });

		expect(dungeon.notes).toHaveLength(1);
		expect(vicinity.notes).toContain(other);
		expect(vicinity.notes).toHaveLength(2);
	});

	// Drawing pins is GM work: a player's client has no business writing to a Scene, and would be
	// refused anyway.
	it("does nothing at all for a player", async () => {
		global.game.user.isGM = false;
		const vicinity = posterScene(VICINITY);
		expect(await syncSitePin(BARROW, { tier: "vicinity", ...MIDDLE }, { scenes: [vicinity] })).toBeNull();
		expect(vicinity.calls).toEqual([]);
	});

	// It rides on the back of a placement already written and already reported, so a Scene that
	// refuses must not be reported as marked — and must not throw, either.
	it("reports nothing placed when the Scene refuses the write", async () => {
		const vicinity = posterScene(VICINITY);
		vicinity.createEmbeddedDocuments = () => Promise.reject(new Error("no"));
		expect(await syncSitePin(BARROW, { tier: "vicinity", ...MIDDLE }, { scenes: [vicinity] })).toBeNull();
	});

	it("does nothing for a page that is not filed in an entry", async () => {
		const vicinity = posterScene(VICINITY);
		expect(await syncSitePin({ id: "loose", name: "Loose" }, { tier: "vicinity", ...MIDDLE },
			{ scenes: [vicinity] })).toBeNull();
		expect(vicinity.calls).toEqual([]);
	});
});

describe("the two vocabularies this depends on", () => {
	// A travel tier and its poster map share one slug, which is the whole reason a spot recorded by
	// the walkthrough can name a Scene. Nothing enforces it but this.
	it("names a poster map for every travel tier", () => {
		for (const tier of TRAVEL_MAPS) {
			expect(POSTER_MAPS.map(m => m.slug), tier.slug).toContain(tier.slug);
		}
	});
});
