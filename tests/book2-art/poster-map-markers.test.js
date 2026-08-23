import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { markPosterMapScenes } from "../../module/book2-art/poster-maps.js";
import { markerPinKey, placeMarkerIcon } from "../../module/utils/map-pins.js";
import { asColor } from "../fakes/color.js";

// Putting the names back on the two regional maps of a world that already has their Scenes.
//
// The offer that builds a poster-map Scene is latched once per world and the importer macro is
// not something a GM re-runs to get pins, so without this pass every table that imported their
// maps before the markers existed would keep two unlabelled maps forever.

let _const;
let _journal;
let _journalClass;
beforeEach(() => {
	_const = globalThis.CONST;
	_journal = globalThis.game?.journal;
	_journalClass = globalThis.JournalEntry;
	globalThis.CONST = {
		TEXT_ANCHOR_POINTS: { CENTER: 0, BOTTOM: 1, TOP: 2, LEFT: 3, RIGHT: 4 },
		DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 },
	};
});
afterEach(() => {
	// Restored rather than deleted: vitest shares a worker across files, and tests/setup.js owns
	// `game`. Leaving a journal directory on it would change what an unrelated suite sees.
	globalThis.CONST = _const;
	globalThis.JournalEntry = _journalClass;
	if (globalThis.game) globalThis.game.journal = _journal;
});

/** Seed the world with the imported gazetteer, and record every ownership write. */
function seedJournals(places) {
	const raises = [];
	const entries = places.map(([slug, journalId], i) => ({
		id: `world-${i}`,
		name: slug,
		ownership: { default: 0 },
		_stats: { compendiumSource: `Compendium.stonetop-pwd.stonetop-journal.JournalEntry.${journalId}` },
	}));
	globalThis.game.journal = entries;
	globalThis.JournalEntry = {
		updateDocuments: async data => {
			raises.push(...data);
			for (const d of data) {
				const hit = entries.find(e => e.id === d._id);
				if (hit) hit.ownership = { default: d["ownership.default"] };
			}
		},
	};
	return { entries, raises };
}

/**
 * A Scene stand-in that records what would be written to it.
 *
 * `dimensions` is here because a Note's x/y are PADDED-canvas coordinates, not image ones: an
 * unpadded Scene puts the picture's origin at 0,0 and a padded one does not. Ours ship unpadded,
 * which is the default below; `padded()` covers the other case.
 */
function fakeScene(posterMap, notes = [], dimensions = { sceneX: 0, sceneY: 0 }) {
	return {
		name: `scene-${posterMap}`,
		width: 6000,
		height: 4714,
		dimensions,
		flags: { "stonetop-pwd": { posterMap } },
		notes: { contents: notes },
		created: [],
		updated: [],
		async createEmbeddedDocuments(type, data) {
			expect(type).toBe("Note");
			this.created.push(...data);
			// What Foundry hands back: the same documents, now on the Scene.
			this.notes.contents = [...this.notes.contents, ...data.map((d, i) => ({ id: `made-${this.created.length}-${i}`, ...d }))];
			return data;
		},
		async updateEmbeddedDocuments(type, data) {
			expect(type).toBe("Note");
			this.updated.push(...data);
			for (const change of data) {
				const hit = this.notes.contents.find(n => n.id === change._id);
				if (hit) Object.assign(hit, change);
			}
			return data;
		},
	};
}

/**
 * The world's "which maps are done" record, as a store the caller can inspect.
 *
 * Modelled on the REAL contract rather than on something convenient, because a lenient fake here
 * hides the exact bug it is meant to catch. `getObjectSetting(key)` reads ONE named key and
 * `setSetting(key, value)` REPLACES the whole stored object, so this fake refuses a key it does
 * not know (the real one throws for a setting that was never registered) and replaces rather than
 * merges (so a write that drops the other map's latch shows up as a lost latch, not as a pass).
 */
function latch(initial = {}) {
	const state = { value: { ...initial } };
	const check = key => {
		if (key !== "regionalMapMarkers") throw new Error(`"${key}" is not a registered game setting`);
	};
	return {
		get store() { return state.value; },
		io: {
			read: key => { check(key); return state.value; },
			write: (key, value) => { check(key); state.value = value; },
		},
	};
}

/** One primary GM, with a record that starts empty unless a test says otherwise. */
function run(scenes, { store = {}, isGM = true, primary = () => true } = {}) {
	const l = latch(store);
	return markPosterMapScenes({ scenes, isGM, primary, ...l.io })
		.then(counts => ({ ...counts, placed: counts.created, ...l }));
}

describe("markPosterMapScenes", () => {
	it("labels every map with recorded positions and touches nothing else", async () => {
		const vicinity = fakeScene("vicinity");
		const worldsEnd = fakeScene("worlds-end");
		const village = fakeScene("stonetop-village");
		const marshedge = fakeScene("marshedge");
		const { placed, store } = await run([vicinity, worldsEnd, village, marshedge]);

		// Vicinity: seven places, three edge arrows, four region and road captions. World's End:
		// eleven places, one arrow, six captions. Village: four roads out, the wood, the water,
		// the fields and the wall that wraps them.
		expect(placed).toBe(40);
		expect(vicinity.created).toHaveLength(14);
		expect(worldsEnd.created).toHaveLength(18);
		expect(village.created).toHaveLength(8);
		// Marshedge is a poster map with no measured label position on it, and gets nothing.
		expect(marshedge.created).toHaveLength(0);
		// The record is the pin KEYS laid down, not "this map is finished": a map that can never
		// be revisited is a map whose pins can never be brought up to a later design.
		expect(Object.keys(store).sort()).toEqual(["stonetop-village", "vicinity", "worlds-end"]);
		expect(store.vicinity).toHaveLength(14);
		expect(store["worlds-end"]).toHaveLength(18);
		expect(store["stonetop-village"]).toHaveLength(8);
	});

	it("dresses every pin as a public, unlinked marker", async () => {
		const scene = fakeScene("vicinity");
		await run([scene]);
		for (const note of scene.created) {
			expect(note.global).toBe(true);
			expect(note.author).toBe(null);
			expect(note.entryId).toBe(null);
			expect(note.text).toBeTruthy();
			expect(note.flags["stonetop-pwd"].posterPin).toMatch(/^marker:/);
		}
	});

	it("gives a place a pin and a way off the map a signpost", async () => {
		// The two mean opposite things, so they must not be the same drawing: a pin says the thing
		// you want is here, an arrow says it is somewhere else and this is the way to it.
		const scene = fakeScene("vicinity");
		await run([scene]);
		const glyph = text => scene.created.find(n => n.text === text).texture.src;
		expect(glyph("Stonetop")).toBe(placeMarkerIcon("place"));
		expect(glyph("To Gordin's Delve")).toBe(placeMarkerIcon("exit"));
		expect(placeMarkerIcon("place")).not.toBe(placeMarkerIcon("exit"));
		// And their keys cannot collide, since an arrow and the place it points at share a name.
		const keys = scene.created.map(n => n.flags["stonetop-pwd"].posterPin);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("gives the World's End's mountains a mountain, whether they are a place or a range", async () => {
		// One drawing for two families, because what the mark claims is true of both: "mountains"
		// is true of the Whitefang Mountains along their whole arc, and true of Tor's Fist, which
		// is a point made of the same rock. The teardrop claims "here", which is true of one.
		const scene = fakeScene("worlds-end");
		await run([scene]);
		const note = text => scene.created.find(n => n.text === text);
		for (const text of ["Tor's Fist", "Barrier Pass", "Whitefang Mountains", "Huffel Peaks"]) {
			expect(note(text)?.texture.src, text).toBe(placeMarkerIcon("peak"));
		}
		expect(note("Marshedge").texture.src).toBe(placeMarkerIcon("place"));

		// The re-drawn places keep the key a place has always had. This is the whole reason the
		// key is a family and not a glyph: a table that already has Tor's Fist on their map must
		// get their pin RE-DRESSED next load, not a second pin standing beside the first.
		const key = text => note(text).flags["stonetop-pwd"].posterPin;
		expect(key("Tor's Fist")).toBe(markerPinKey("tors-fist"));
		expect(key("Barrier Pass")).toBe(markerPinKey("barrier-pass"));
		expect(key("Huffel Peaks")).toBe(markerPinKey("huffel-peaks", "region"));
	});

	it("leaves a GM who deleted a pin alone, rather than putting it back every reload", async () => {
		// The whole reason this latches. A deleted marker is a decision — a place the party has
		// not found yet — and the once-per-map record is what lets it stand.
		const scene = fakeScene("vicinity");
		const after = await run([scene]);
		scene.notes.contents = scene.notes.contents.filter(n => n.text !== "The Maw");
		scene.created = [];

		const { placed } = await run([scene], { store: { vicinity: after.store.vicinity } });
		expect(placed).toBe(0);
		expect(scene.created).toHaveLength(0);
	});

	it("upgrades a world the old boolean record froze, without undoing its deletions", async () => {
		// The exact state a table is in after running an earlier version: the place markers down,
		// no arrows, and `{vicinity: true}` stored. That boolean meant "finished", which is why
		// nothing new could ever reach them. It is read as "every PLACE key", because that is
		// precisely what the version that wrote it laid down.
		const scene = fakeScene("vicinity");
		await run([scene]);
		const isPlacePin = n => !/^marker:(exit|region):/.test(n.flags["stonetop-pwd"].posterPin);
		// Wind the world back: places only, at the old sizing, and the GM deleted one of them.
		scene.notes.contents = scene.notes.contents.filter(isPlacePin)
			.filter(n => n.text !== "Cave Bears")
			.map(n => ({ ...n, iconSize: 100, fontSize: 60 }));
		scene.created = [];
		scene.updated = [];

		const { created, updated, store } = await run([scene], { store: { vicinity: true } });
		// The arrows and the region captions arrive, because the old record never knew about them.
		expect(scene.created.map(n => n.text)).toEqual([
			"To Barrier Pass", "To Gordin's Delve", "To Steplands & Marshedge",
			"The Great Wood", "The Highway", "The West Road", "The Flats",
		]);
		expect(created).toBe(7);
		// Cave Bears stays deleted: its key was a place key, so the boolean covered it.
		expect(scene.created.map(n => n.text)).not.toContain("Cave Bears");
		// And the six survivors are brought up to the current sizing.
		expect(updated).toBe(6);
		expect(scene.updated.every(u => u.iconSize === 70 && u.fontSize === 45)).toBe(true);
		expect(store.vicinity).toHaveLength(14);
	});

	it("leaves a marker alone when the Scene hands its ink back as a Color", async () => {
		// A second pass over a map this ran on before, in the shape a REAL world is in: the fake
		// Scene above stores what we wrote, so the ink comes back as the string we sent, while a
		// Note document answers with a `Color`. Compared with ===, every marker on both regional
		// maps reports drift on every load, forever, and the "theirs the moment they touch it"
		// tests below the ink never get to run at all.
		const scene = fakeScene("vicinity");
		const first = await run([scene]);
		scene.notes.contents = scene.notes.contents.map(n => ({ ...n, textColor: asColor(n.textColor) }));
		scene.created = [];
		scene.updated = [];

		const { created, updated } = await run([scene], { store: { vicinity: first.store.vicinity } });
		expect(created).toBe(0);
		expect(updated).toBe(0);
		expect(scene.updated).toHaveLength(0);
	});

	it("still repaints a marker somebody left in the wrong ink", async () => {
		const scene = fakeScene("vicinity");
		const first = await run([scene]);
		scene.notes.contents = scene.notes.contents.map(n => ({ ...n, textColor: asColor("#ffffff") }));
		scene.updated = [];

		const { updated } = await run([scene], { store: { vicinity: first.store.vicinity } });
		expect(updated).toBe(14);
		expect(scene.updated.every(u => u.textColor === "#1b1009")).toBe(true);
	});

	it("still marks a map whose Scene only arrives later", async () => {
		// Per map, not one flag for the pair: the two Scenes can be imported years apart, and a
		// single latch would have been spent on whichever existed first.
		const { store } = await run([fakeScene("vicinity")]);
		expect(Object.keys(store)).toEqual(["vicinity"]);

		const worldsEnd = fakeScene("worlds-end");
		const later = await run([fakeScene("vicinity"), worldsEnd], { store });
		expect(later.placed).toBe(18);
		expect(worldsEnd.created).toHaveLength(18);
	});

	it("recognises a pin whose flag was lost, by its label and its glyph", async () => {
		// A Scene rebuilt by hand, or restored from an export that dropped our flags. The
		// fallback is what stops the map ending up with two markers standing on every place.
		const scene = fakeScene("vicinity", [
			{ text: "Stonetop", texture: { src: placeMarkerIcon() }, flags: {} },
		]);
		await run([scene]);
		expect(scene.created.map(n => n.text)).not.toContain("Stonetop");
		expect(scene.created).toHaveLength(13);
	});

	it("fills only the gap when a GM has moved a pin and renamed it", async () => {
		const scene = fakeScene("vicinity", [
			{ text: "moved by hand", texture: { src: placeMarkerIcon() }, flags: { "stonetop-pwd": { posterPin: markerPinKey("the-maw") } } },
		]);
		await run([scene]);
		expect(scene.created).toHaveLength(13);
		expect(scene.created.map(n => n.text)).not.toContain("The Maw");
	});

	it("claims a Scene the macro stamped under a legacy package id", async () => {
		const scene = fakeScene("vicinity");
		scene.flags = { stonetop_pwd: { posterMap: "vicinity" } };
		expect((await run([scene])).placed).toBe(14);
	});

	it("will not write onto a Scene it never stamped, however it is named", async () => {
		// isPosterMapScene also matches a Scene by NAME, which is the right answer to the offer's
		// question ("would building another duplicate this?") and the wrong answer to this one
		// ("may I create documents here?"). This pass fires unprompted on every load, so a world
		// with a battle map somebody called "The World's End" must not wake up wearing eleven pins.
		const impostor = fakeScene("worlds-end");
		impostor.name = "The World's End";
		impostor.flags = {};
		const { placed, store } = await run([impostor]);
		expect(placed).toBe(0);
		expect(impostor.created).toHaveLength(0);
		expect(store).toEqual({});
	});

	it("offsets every pin by the padding when a GM has padded the Scene", async () => {
		// A Note's x/y live in the padded canvas, where the picture starts at sceneX/sceneY. Miss
		// this and the pins land out on the blank margin with the map itself untouched.
		const plain = fakeScene("vicinity");
		await run([plain]);
		const padded = fakeScene("vicinity", [], { sceneX: 1600, sceneY: 1200 });
		await run([padded]);

		expect(padded.created).toHaveLength(plain.created.length);
		for (const [i, note] of padded.created.entries()) {
			expect(note.x).toBe(plain.created[i].x + 1600);
			expect(note.y).toBe(plain.created[i].y + 1200);
		}
	});

	it("points a pin at the book's write-up of its place, and opens it far enough to survive", async () => {
		// Linking is the half that is easy to get wrong: core decides a note's visibility by
		// testing the reader against WHAT IT LINKS TO, so a pin linked to a GM-only entry is gone
		// from every player's map. LIMITED is the least that keeps it, and no more than that.
		const { entries, raises } = seedJournals([
			["stonetop", "6yScslDfqrcCQ6CJ"],
			["the-maw", "vwP9YSr3qrc4Tq7k"],
		]);
		const scene = fakeScene("vicinity");
		await run([scene]);

		const linked = scene.created.filter(n => n.entryId);
		expect(linked.map(n => n.text).sort()).toEqual(["Stonetop", "The Maw"]);
		expect(linked.map(n => n.entryId).sort()).toEqual(entries.map(e => e.id).sort());
		// One batched write covering both, at LIMITED and no higher. Order is the map's reading
		// order rather than the seed's, which is an implementation detail not worth pinning.
		expect(raises).toHaveLength(2);
		expect(raises.map(r => r._id).sort()).toEqual(["world-0", "world-1"]);
		expect(new Set(raises.map(r => r["ownership.default"]))).toEqual(new Set([1]));
		// The page is never named, so the visibility test lands on the entry we actually opened.
		expect(linked.every(n => n.pageId === null)).toBe(true);
	});

	it("leaves a pin whose place this world has no entry for as a plain label", async () => {
		seedJournals([["stonetop", "6yScslDfqrcCQ6CJ"]]);
		const scene = fakeScene("vicinity");
		await run([scene]);
		const unlinked = scene.created.filter(n => !n.entryId);
		expect(unlinked).toHaveLength(13);
		expect(unlinked.every(n => n.entryId === null)).toBe(true);
	});

	it("still lays every pin on a world that never imported the journals", async () => {
		// The label is the feature; the link is a courtesy on top of it.
		const scene = fakeScene("vicinity");
		const { placed } = await run([scene]);
		expect(placed).toBe(14);
		expect(scene.created.every(n => n.entryId === null)).toBe(true);
	});

	it("does not link a pin whose entry could not be opened up", async () => {
		// A failed ownership write must cost the click, never the label: an unlinked pin is
		// merely not clickable, where a wrongly linked one disappears for the whole table.
		seedJournals([["stonetop", "6yScslDfqrcCQ6CJ"]]);
		globalThis.JournalEntry = { updateDocuments: async () => { throw new Error("denied"); } };
		const scene = fakeScene("vicinity");
		const { placed } = await run([scene]);
		expect(placed).toBe(14);
		expect(scene.created.every(n => n.entryId === null)).toBe(true);
	});

	it("talks to the setting it says it does, and never drops the other map's latch", async () => {
		// The fake refuses an unregistered key and replaces rather than merges, so a write to the
		// wrong key, or one that rebuilds the record from a single slug, fails here rather than
		// passing quietly and leaving the real latch permanently unset.
		const { store } = await run([fakeScene("vicinity"), fakeScene("worlds-end")]);
		expect(Object.keys(store).sort()).toEqual(["vicinity", "worlds-end"]);
	});

	it("leaves a map pending rather than spending its latch on nothing", async () => {
		// No Scene at all, and a Scene whose picture is not the shape the positions were measured
		// against. Both are "try again next load", not "this map is done".
		expect((await run([])).store).toEqual({});
		const square = fakeScene("vicinity");
		square.height = square.width;
		const { placed, store } = await run([square]);
		expect(placed).toBe(0);
		expect(store).toEqual({});
		expect(square.created).toHaveLength(0);
	});

	it("writes from one client only, so two GMs loading at once cannot double up", async () => {
		const scene = fakeScene("vicinity");
		expect((await run([scene], { primary: () => false })).placed).toBe(0);
		expect((await run([scene], { isGM: false })).placed).toBe(0);
		expect(scene.created).toHaveLength(0);
	});
});
