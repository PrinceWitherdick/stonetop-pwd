import { SYSTEM_ID } from "../system-id.js";
import { ALL_SYSTEM_IDS } from "../migration/compat.js";
import { book2ArtSrcWith } from "./art-root.js";
import { browseArtDirs, servedPath } from "./browse.js";
import { loadImage, artImageUrl } from "./rebuild-crops.js";
import { landmarkIcon, landmarkNoteData } from "../hooks/PlaceOfInterestDrop.js";
import {
	isPlaceMarkerNote, mapHasMarkers, placeMarkerNoteData, posterMapPins, publicPinDrift,
} from "../utils/map-pins.js";
import { placeNoteLink } from "../utils/places-chronicle.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import {
	openGazetteerEntriesToPlayers, worldGazetteerEntry, worldGazetteerIndex,
} from "../utils/gazetteer-notes.js";
import { getObjectSetting, setSetting } from "../settings.js";
import { error, info } from "../utils/logger.js";

// Turning the poster maps the GM already has on disk into world Scenes.
//
// The "Import Book Art" macro asks for the five Stonetop poster maps (images the GM owns,
// from their books or the free Setting Overview handout), converts them to WebP under
// `${book2ArtRoot}/assets/maps`, and builds a navigation Scene from each — with the village
// map's lettered places-of-interest pins placed for them.
//
// That folder is DURABLE: it sits outside `systems/stonetop-pwd`, so it survives a system
// update, a reinstall, and — crucially — a brand-new world. The Scenes do not: they are
// world documents, so a GM who imported once and then started a fresh campaign had their
// maps sitting right there on disk with nothing pointing at them, and no way to get the
// Scenes back short of re-running the whole PDF import. This module closes that gap: the
// ready flow browses the folder, and offers to build the Scenes from what it finds.
//
// The map catalog below MIRRORS `manifest.maps` in the importer macro
// (packs/src/stonetop-macros/import-book2-art.json). Nothing at runtime can derive it —
// the macro's manifest is not shipped as a module — so it is duplicated here on purpose
// and pinned by tests/book2-art/poster-maps.test.js, which reads the macro's own manifest
// out of the pack source and fails if the two ever drift.
//
// The BEHAVIOUR is not duplicated: the macro imports `upsertPosterMapScene` from this file
// at runtime rather than carrying its own copy, so a Scene the macro builds and one this
// offer builds are the same Scene, matched by the same rule. That makes this module part of
// the macro's runtime contract — changing that function's signature, or what it considers
// an existing Scene, changes the macro too.

/**
 * The world setting recording which poster maps have had their markers laid down.
 *
 * The KEY still says "regional" because it is written into every world that has run this, and
 * renaming it would orphan every record and re-lay every pin a GM has since deleted. It covered
 * the two regional maps when it was named; it covers the village too now.
 */
const MARKER_RECORD_SETTING = "regionalMapMarkers";

/** Background colour behind a fitted map, and the token fit mode. Both match the macro. */
const SCENE_BACKDROP = "#1a1a1a";
const SCENE_FIT = "fill";

/**
 * The five poster maps, in nav-bar order. `out` is the path within the durable art folder
 * the importer writes them to; `notes` are the village map's lettered pins, stored as
 * FRACTIONS of the scene so they land correctly whatever resolution the GM's image is.
 */
export const POSTER_MAPS = Object.freeze([
	{
		slug: "stonetop-village",
		name: "Stonetop — The Village",
		navName: "The Village",
		navOrder: 0,
		sort: 100000,
		out: "assets/maps/map-stonetop-village.webp",
		hint: "Book I or the free Setting Overview handout",
		width: 6000,
		height: 4714,
		notes: [
			{ key: "f",   letter: "f", name: "Watchtowers",         fx: 0.456,   fy: 0.22889 },
			{ key: "a",   letter: "a", name: "The Stone",           fx: 0.40783, fy: 0.33135 },
			{ key: "b",   letter: "b", name: "The Granary",         fx: 0.386,   fy: 0.27874 },
			{ key: "c",   letter: "c", name: "The Public House",    fx: 0.50833, fy: 0.31396 },
			{ key: "d",   letter: "d", name: "Cistern",             fx: 0.40533, fy: 0.39584 },
			{ key: "e",   letter: "e", name: "Pavilion of the Gods", fx: 0.50583, fy: 0.37802 },
			{ key: "f-2", letter: "f", name: "Watchtowers",         fx: 0.226,   fy: 0.44018 },
			{ key: "f-3", letter: "f", name: "Watchtowers",         fx: 0.62483, fy: 0.46542 },
		],
	},
	{
		slug: "vicinity", name: "The Vicinity", navName: "The Vicinity", navOrder: 1, sort: 200000,
		out: "assets/maps/map-vicinity.webp", hint: "Book I or the free Setting Overview handout",
		width: 6000, height: 4714,
	},
	{
		slug: "worlds-end", name: "The World's End", navName: "World's End", navOrder: 2, sort: 300000,
		out: "assets/maps/map-worlds-end.webp", hint: "Book I or the free Setting Overview handout",
		width: 6000, height: 4714,
	},
	{
		slug: "marshedge", name: "Marshedge", navName: "Marshedge", navOrder: 3, sort: 400000,
		out: "assets/maps/map-marshedge.webp", hint: "Book II",
		width: 6000, height: 4714,
	},
	{
		slug: "gordins-delve", name: "Gordin's Delve", navName: "Gordin's Delve", navOrder: 4, sort: 500000,
		out: "assets/maps/map-gordins-delve.webp", hint: "Book II",
		width: 6000, height: 4714,
	},
]);

/**
 * Is this Scene one of ours for `map`? Matched on the `posterMap` flag first, then by name
 * — the same two-step lookup the importer macro uses, so a Scene the macro built (or one the
 * GM renamed the system's way) is recognised rather than duplicated.
 *
 * The flag is read across every scope this package has shipped under, because the macro
 * stamps it with the RUNTIME `game.system.id` (the install folder name) while everything
 * else in this system writes the pinned SYSTEM_ID. On a normally-named install those are
 * the same string; on a renamed folder they are not, and a mismatch here would mean
 * building a second Scene beside the GM's existing one.
 */
export function isPosterMapScene(scene, map) {
	if (scopedFlag(scene, "posterMap") === map.slug) return true;
	return scene?.name === map.name;
}

/** Every flag scope our own documents could have been stamped with — see isPosterMapScene. */
function flagScopes() {
	return [...ALL_SYSTEM_IDS, globalThis.game?.system?.id].filter(Boolean);
}

/**
 * One of our flags off a Scene or a Note, under whichever scope it was stamped with.
 *
 * The scope walk, written once. Five places in this file asked the same question about a
 * different key, and a rename of the package is exactly the sort of change that has to reach
 * all five or none of them.
 */
function scopedFlag(doc, key) {
	const flags = doc?.flags ?? {};
	for (const scope of flagScopes()) {
		const value = flags[scope]?.[key];
		if (value) return value;
	}
	return null;
}

/**
 * What the offer should show: one row per poster map whose image is on disk, flagged with
 * whether this world already has its Scene.
 *
 * Pure — `present` is the set of fully-qualified paths from browsePosterMapArt and `scenes`
 * is any iterable of Scene-like `{ name, flags }` — so the decision can be tested without a
 * browser. A map with no image on disk is simply absent: we never offer to build a Scene
 * around a picture the GM does not have.
 */
export function planPosterMapScenes(present, root, scenes = []) {
	const all = Array.from(scenes ?? []);
	return POSTER_MAPS.flatMap(map => {
		const key = book2ArtSrcWith(root, map.out);
		if (!present.has(key)) return [];
		// Asked about by identity, but the Scene's background has to be something a browser can
		// fetch — the same string off a hosted setup, the Assets Library URL on The Forge.
		const src = servedPath(present, key);
		return [{ map, src, hasScene: all.some(scene => isPosterMapScene(scene, map)) }];
	});
}

/** Fully-qualified paths of the poster-map images currently on disk under `root`. GM-only. */
export function browsePosterMapArt(root) {
	return browseArtDirs(root, ["assets/maps"]);
}

/**
 * Every poster map with an image on disk in this world, each flagged with whether its Scene
 * already exists. Rows with `hasScene: false` are what makes the offer worth making at all;
 * the rest ride along so the GM can deliberately refresh one. Returns [] on any browse
 * failure — the safe "nothing to offer", and the offer is re-checked next load anyway.
 */
export async function posterMapScenePlan(root) {
	try {
		return planPosterMapScenes(await browsePosterMapArt(root), root, globalThis.game?.scenes ?? []);
	} catch (err) {
		error("Poster maps: could not browse the art folder", err);
		return [];
	}
}

/**
 * Natural size of an image already in the Foundry data folder, and the path to point a Scene
 * background at. Rejects when the image does not load, which is how a path that browse
 * reported but the browser cannot read (a truncated upload, say) fails its own row rather
 * than the whole batch. Ported from the macro's `probeMapPath`.
 */
export async function probeImageSize(src) {
	// `src` arrives already host-resolved from planPosterMapScenes — on The Forge that is a full
	// Assets Library URL, which must NOT be routed. artImageUrl decides; the Scene background keeps
	// the resolved string either way, since that is what a client has to fetch.
	const path = String(src ?? "");
	// `crossOrigin: null`, as loadImage's own note asks of any caller that never touches a canvas.
	// Two reasons here. An anonymous request FAILS outright against a host sending no CORS headers,
	// which loses the measurement for no gain — nothing below decodes pixels, only naturalWidth and
	// naturalHeight. And an anonymous request is a different fetch mode from a plain `<img>`, so it
	// gets its own cache entry: measuring a picture that is also being DISPLAYED (the travel maps)
	// downloaded and decoded the whole file a second time.
	const img = await loadImage(artImageUrl(path), { crossOrigin: null });
	return { src: path.replace(/^\/+/, ""), w: img.naturalWidth, h: img.naturalHeight };
}

/**
 * The Scene height for `map` given its probed image, at the catalog's fixed `map.width`.
 *
 * The GM's OWN image decides the aspect ratio — they may have a different scan of the same
 * poster — and the catalog's `height` is only the fallback for one whose dimensions came back
 * unusable. Same arithmetic as the macro, so a Scene built here matches one the macro built
 * from the same file.
 *
 * The ratio is tested for finiteness, not merely for truthiness, and that is the whole reason
 * this is a function of its own. A zero naturalWidth against a non-zero naturalHeight — a
 * truncated or undecodable file that still fires `load` — divides to Infinity, and Infinity
 * is a perfectly truthy number: it would sail through a `|| map.height` guard and put an
 * Infinity on the Scene. Only the both-zero case produces the NaN that guard actually caught.
 */
export function posterMapSceneHeight(map, img) {
	const ratio = (img?.h ?? 0) / (img?.w ?? 0);
	if (!Number.isFinite(ratio) || ratio <= 0) return map.height || map.width;
	return Math.max(1, Math.round(map.width * ratio));
}

/**
 * Create (or refresh) the world Scene for one poster map: gridless, unpadded, on the nav
 * bar, background fitted to fill. Ported from the macro's `upsertMapScene` so a Scene built
 * here is indistinguishable from one the macro built.
 *
 * v14 moved the scene background into the `levels` collection (Scene#background is a
 * read-only shim there, so legacy keys are silently dropped); v13 still uses
 * background/backgroundColor at the scene root. Both are handled.
 *
 * Refreshing an existing Scene only re-points its artwork and geometry — the GM's own
 * tweaks (lighting, walls, tokens, their renamed nav entry) are left alone.
 *
 * @returns {Promise<{created: boolean, pins: number}>}
 */
export async function upsertPosterMapScene(map, img) {
	const hasLevels = !!Scene.schema.fields.levels;
	const width = map.width;
	const height = posterMapSceneHeight(map, img);

	let scene = (game.scenes ?? []).find(s => isPosterMapScene(s, map)) ?? null;
	let created = false;
	if (!scene) {
		const backdrop = hasLevels
			? { levels: [{ name: map.name, background: { src: img.src, color: SCENE_BACKDROP }, textures: { fit: SCENE_FIT } }] }
			: { background: { src: img.src, fit: SCENE_FIT }, backgroundColor: SCENE_BACKDROP };
		scene = await Scene.create({
			name: map.name, navigation: true, navName: map.navName, navOrder: map.navOrder, sort: map.sort,
			...backdrop,
			width, height, padding: 0,
			grid: { type: 0, size: 100 }, tokenVision: false,
			flags: { [SYSTEM_ID]: { posterMap: map.slug } },
		});
		created = true;
	} else {
		// One write on v13, where the background lives at the scene root; on v14 the artwork
		// belongs to the level document and has to be its own update.
		const level = hasLevels ? scene.levels?.contents?.[0] : null;
		await scene.update({
			width, height, [`flags.${SYSTEM_ID}.posterMap`]: map.slug,
			...(hasLevels ? {} : { "background.src": img.src }),
		});
		if (level) await level.update({ "background.src": img.src });
	}

	// Two families, counted apart. Both the setup offer and the shipped macro report `pins` as
	// the village map's lettered discs, which is all it has ever meant, so folding the markers
	// into the same number would have a village map that carries eight pins reported as
	// carrying fourteen.
	const pins = await placeLetteredPins(scene, map, width, height);
	const { created: markers } = await layMarkers(scene, map, width, height);
	// Best-effort: a Scene with no thumbnail still works, it just looks bare in the sidebar.
	try {
		const thumb = await scene.createThumbnail();
		if (thumb?.thumb) await scene.update({ thumb: thumb.thumb });
	} catch (_) { /* thumbnails are cosmetic */ }
	return { created, pins, markers };
}

/**
 * Place the village map's lettered place-of-interest pins, skipping any already there.
 * Matched on our `posterPin` flag first and then on the "same name, same landmark glyph"
 * shape a pre-flag run left behind, so re-running never stacks a second set on top.
 */
async function placeLetteredPins(scene, map, width, height) {
	if (!map.notes?.length) return 0;
	const existing = scene.notes?.contents ?? [];
	// The icon filename comes from the same helper that writes it, so the "did a pre-flag run
	// already place this one?" test cannot drift from what a pin actually looks like.
	const iconFile = letter => landmarkIcon(letter).split("/").pop();
	const missing = map.notes.filter(note =>
		!existing.some(e => pinKeyOf(e) === note.key)
		&& !existing.some(e => e.text === note.name && String(e.texture?.src ?? "").endsWith(iconFile(note.letter))));
	if (!missing.length) return 0;

	// Point each pin at its Chronicle page, seeding the "Places of Interest" journal on the
	// first one that needs it. Resolved per pin rather than per map because the three
	// Watchtower pins all share the F page — the lookup is a cached find after the first.
	const links = new Map();
	for (const note of missing) {
		if (!links.has(note.letter)) links.set(note.letter, await placeNoteLink(note.letter));
	}

	// Same writer as a GM dragging a Place of Interest onto the canvas, so a pin laid down
	// here and one dropped by hand are the same document — which is also what lets
	// StonetopNoteLabels recognise both.
	await scene.createEmbeddedDocuments("Note", missing.map(note => ({
		...landmarkNoteData({
			x: Math.round(note.fx * width), y: Math.round(note.fy * height),
			letter: note.letter, name: note.name,
			...(links.get(note.letter) ?? {}),
		}),
		flags: { [SYSTEM_ID]: { posterPin: note.key } },
	})));
	return missing.length;
}

/**
 * Where the top-left of a Scene's PICTURE sits in the coordinate space its Notes live in.
 *
 * Not the same point, and the difference is a whole map's worth of misplacement. A Note's x/y are
 * canvas coordinates, and the canvas is the scene rectangle plus its padding margin, so a Scene
 * with any padding at all puts the artwork's own origin at `dimensions.sceneX/sceneY` rather than
 * at zero. Ours are built unpadded, where the two coincide, but nothing stops a GM from adding
 * padding to a Scene afterwards, and the failure mode is silent: every pin lands out on the blank
 * margin with the map itself untouched.
 *
 * Read defensively because it is a computed getter: a Scene stand-in in a test has no such thing,
 * and zero is exactly right for the unpadded case it stands in for.
 */
function sceneOrigin(scene) {
	const dims = scene?.dimensions;
	return { x: Number(dims?.sceneX) || 0, y: Number(dims?.sceneY) || 0 };
}

/** The `posterPin` key we stamped on a note, under any scope this package has shipped under. */
function pinKeyOf(note) {
	return scopedFlag(note, "posterPin");
}

/**
 * What we last wrote to this pin's position and label, or null for one stamped before we
 * started recording it. It is what lets a later pass tell "still exactly as we left it" from
 * "the GM has moved or renamed this", which are the two cases that must be treated differently.
 */
function pinSpecOf(note) {
	return scopedFlag(note, "markerSpec");
}

/**
 * What one map's markers should have written to them: the pins to create, and the changes to
 * pins already down.
 *
 * WHY THERE ARE UPDATES AT ALL, and not just creates. A marker is not a note the GM wrote; it is
 * a label this system draws, and its drawing is part of a design that changes. A create-only
 * pass means every improvement to that design (a smaller icon, a signpost for the arrows, a link
 * to the book's write-up) reaches only worlds that had no markers yet, and every table that
 * already ran it is frozen on whatever the first version happened to look like, with no way
 * forward but deleting all eighteen by hand.
 *
 * WHAT IS OURS AND WHAT IS THEIRS. The glyph, the sizes, the colours, the public-visibility pair
 * and the journal link are ours: they are the design, and we rewrite them whenever they drift.
 * The position and the label are the GM's the moment they touch either, so those are rewritten
 * only while the pin still says exactly what we last left it saying, which is what `markerSpec`
 * records. A pin stamped before that flag existed has no such record; it is treated as untouched,
 * because a pin nobody has edited is what it almost always is, and being wrong costs one pin
 * moving back to where the map says it goes.
 *
 * WHY A PIN CAN BE MISSING AND STAY MISSING. `placed` is every key this map has ever had laid
 * down. A pin whose key is in there and whose note is gone was deleted on purpose, so it is not
 * put back. A pin whose key is NOT in there has never existed here, which is what a newly
 * designed pin looks like, so it is created even on a map that was marked long ago.
 *
 * Pure, so all of that can be checked without a world.
 */
export function planMarkerWrites({ pins, notes = [], placed = [], origin = { x: 0, y: 0 }, links = new Map() }) {
	const seen = new Set(placed);
	const byKey = new Map();
	for (const note of notes) {
		const key = pinKeyOf(note);
		if (key && !byKey.has(key)) byKey.set(key, note);
	}

	// Which notes are already spoken for. A flagged note answers to exactly one key, so only the
	// fallback below can double-claim, and it is the fallback that must not: three of the village
	// signposts are all captioned "To the Old Wall", so ONE unflagged note with that text would
	// otherwise be handed to all three at once. Two of the three would then never be created, and
	// the same `_id` would go into one updateEmbeddedDocuments batch three times over.
	const claimed = new Set();
	const creates = [];
	const updates = [];
	for (const pin of pins) {
		const x = origin.x + pin.x;
		const y = origin.y + pin.y;
		const spec = { x, y, text: pin.name };
		const data = placeMarkerNoteData({
			x, y, name: pin.name, kind: pin.kind, entryId: links.get(pin.slug) ?? null,
		});
		const stamp = { [SYSTEM_ID]: { posterPin: pin.key, markerSpec: spec } };

		// Our flag first, then the shape a run before that flag existed would have left. The
		// fallback is what stops a Scene rebuilt from an older export ending up with two markers
		// standing on every place; it asks `isPlaceMarkerNote` rather than matching a filename,
		// so the writer and the reader are the same one predicate.
		const note = byKey.get(pin.key)
			?? notes.find(n => !pinKeyOf(n) && !claimed.has(n.id) && n.text === pin.name && isPlaceMarkerNote(n))
			?? null;

		if (!note) {
			if (!seen.has(pin.key)) creates.push({ ...data, flags: stamp });
			continue;
		}
		claimed.add(note.id);
		const change = markerDrift(note, data, spec);
		if (change) updates.push({ _id: note.id, ...change, flags: stamp });
	}
	return { creates, updates };
}

/** How one existing marker differs from what it should be, or null when it already agrees. */
function markerDrift(note, data, spec) {
	const change = {};

	// Ours, unconditionally: this is the design.
	if (note.texture?.src !== data.texture.src) change.texture = data.texture;
	for (const field of ["iconSize", "fontSize", "textAnchor", "textColor"]) {
		if (note[field] !== data[field]) change[field] = data[field];
	}
	if ((note.entryId ?? null) !== data.entryId) {
		change.entryId = data.entryId;
		change.pageId = null;
	}
	// Both halves of the "this pin is part of the map" pair, re-asserted rather than assumed:
	// a pin that lost either goes silently GM-only on Foundry 14. Asked of map-pins.js, beside
	// the constant that writes them.
	Object.assign(change, publicPinDrift(note));

	// Theirs the moment they touch it. A pin with no record is read as untouched.
	const last = pinSpecOf(note);
	if (!last || (note.x === last.x && note.y === last.y)) {
		if (note.x !== spec.x) change.x = spec.x;
		if (note.y !== spec.y) change.y = spec.y;
	}
	if ((!last || note.text === last.text) && note.text !== spec.text) change.text = spec.text;
	if (Object.keys(change).length) return change;

	// Nothing to correct, so the only reason left to write is that the RECORD is wrong.
	//
	// A pin with no record needs one, or the next pass cannot tell it from one since moved.
	//
	// And so does a pin the GM moved to somewhere the design has SINCE AGREED WITH, which is what
	// adopting a table's own placement back into travel-times.js looks like from here. Without
	// this the record would go on saying the pin was dragged off a position nothing claims any
	// more, and every later move of that place would be refused on behalf of an argument that
	// ended. Both cases settle in one write: the record then matches, and the pass goes quiet.
	if (!last) return {};
	const settled = note.x === spec.x && note.y === spec.y && note.text === spec.text;
	const stale = last.x !== spec.x || last.y !== spec.y || last.text !== spec.text;
	return settled && stale ? {} : null;
}

/**
 * Bring one map's markers up to the current design, creating the ones it has never had.
 *
 * Returns both counts because they mean different things to a GM: created is new furniture on
 * their map, updated is furniture they already had changing under them.
 */
async function placeMarkerPins(scene, pins, placed, index) {
	// Point each pin at the book's write-up of its place, where this world has one. Resolved for
	// the whole map at once: the index is one pass over the journal directory, and the entries
	// are opened to players in a single batched write rather than eighteen.
	const links = await markerJournalLinks(pins, index);

	const { creates, updates } = planMarkerWrites({
		pins,
		notes: scene.notes?.contents ?? [],
		placed,
		origin: sceneOrigin(scene),
		links,
	});

	if (creates.length) await scene.createEmbeddedDocuments("Note", creates);
	if (updates.length) await scene.updateEmbeddedDocuments("Note", updates);
	return { created: creates.length, updated: updates.length };
}

/**
 * The world JournalEntry id each of these pins should open, by place slug.
 *
 * Two things have to be true before a pin may carry a link, and only one of them is about
 * finding the entry. The other is that the players can SEE it: core gates a linked note on the
 * reader's permission over what it links to, so linking to a GM-only entry takes the pin off
 * every player's map. `openGazetteerEntriesToPlayers` raises each one to LIMITED and hands back
 * only the entries that write actually reached, so a failure there costs the click and never
 * the label.
 *
 * Best effort as a whole. A world that never imported the journals, or a directory this cannot
 * read, leaves every pin unlinked, which is exactly what the pins were before they could link.
 */
async function markerJournalLinks(pins, index = null) {
	const links = new Map();
	try {
		// Built here only for a caller that has just one map to do; a run over several hands the
		// same index down rather than walking the journal directory once per map.
		const gazetteer = index ?? worldGazetteerIndex();
		const found = new Map();
		for (const pin of pins) {
			const entry = worldGazetteerEntry(pin.journalId, gazetteer);
			if (entry) found.set(pin.slug, entry);
		}
		if (!found.size) return links;

		const safe = await openGazetteerEntriesToPlayers([...found.values()]);
		for (const [slug, entry] of found) if (safe.has(entry)) links.set(slug, entry.id);
	} catch (err) {
		error("Poster maps: could not link the place markers to their journal entries", err);
	}
	return links;
}

/**
 * Lay one map's markers and record that it has been done.
 *
 * The recording belongs HERE, beside the writing, and not only in the backfill that calls it.
 * Markers reach a Scene two ways — this, from the offer or the importer macro as the Scene is
 * built, and the backfill on a later load — and if only the second one latched then a GM whose
 * markers arrived the first way would delete one, reload, and watch it come back exactly once.
 *
 * Best effort on the write: the latch is a courtesy to a GM's later edits, and failing to store
 * it must not fail the Scene build it is riding on, which on the macro's path is the whole
 * import.
 */
async function layMarkers(scene, map, width, height, { read = getObjectSetting, write = setSetting, index = null } = {}) {
	const pins = posterMapPins(map, { width, height });
	if (!pins.length) return { created: 0, updated: 0 };

	const record = read(MARKER_RECORD_SETTING);
	const placed = placedKeys(record, map.slug, pins);
	const { created, updated } = await placeMarkerPins(scene, pins, placed, index);

	// Skipped outright when the record already says exactly this. The pass promises to be silent
	// on a load where nothing changed, and a setting write is not silent: it is a document lookup,
	// a stringify and a hook, per marked map, before the diff turns out empty.
	const known = new Set([...placed, ...pins.map(pin => pin.key)]);
	const stored = record?.[map.slug];
	if (Array.isArray(stored) && stored.length === known.size && stored.every(key => known.has(key))) {
		return { created, updated };
	}
	try {
		await write(MARKER_RECORD_SETTING, { ...record, [map.slug]: [...known] });
	} catch (err) {
		error(`Poster maps: could not record that "${map.name}" has been marked`, err);
	}
	return { created, updated };
}

/**
 * Which of this map's pins have ever been laid down, out of the world's record.
 *
 * A LIST rather than the boolean this setting first held, and reading the boolean is the whole
 * reason the function exists. "This map is done" was the wrong thing to store: it froze the map
 * against a design that had not finished changing, so the arrows added later could never appear
 * on any table that had already run the pass once. A list distinguishes the two cases that
 * actually matter, a pin deleted on purpose and a pin that never existed here.
 *
 * An old `true` is read as "every PLACE marker", because that is exactly the set the version
 * that wrote it laid down. So a place the GM deleted stays deleted across the upgrade, and the
 * arrows, which that version had never heard of, are created.
 *
 * That reads the pin's FAMILY and not its drawing, which is the only version of this that stays
 * true: the version that wrote `true` laid down every place, including the two since redrawn as
 * mountains, and asking about the glyph would quietly offer to put those two back on a map where
 * the GM had removed them.
 */
function placedKeys(record, slug, pins) {
	const value = record?.[slug];
	if (Array.isArray(value)) return value;
	if (value === true) return pins.filter(pin => pin.family === "place").map(pin => pin.key);
	return [];
}

/**
 * Put the named-place markers on the poster-map Scenes this world already has, once per map.
 *
 * WHY A BACKFILL EXISTS. A poster-map Scene is only ever built or refreshed from two places: the
 * once-per-world offer, which a world that already has its Scenes answered long ago, and the
 * Import Book Art macro, which nobody re-runs to get pins. Leaving the markers to those two
 * would mean every table that imported their maps before this shipped kept two beautifully
 * unlabelled maps, with no way short of starting a new world to put the names on them.
 *
 * WHY IT RUNS EVERY LOAD RATHER THAN ONCE. It used to latch per map, and that was wrong in a way
 * that only shows up on the second design: a pass that has "done" a map is a pass that can never
 * change one. Every improvement to how a marker looks (a smaller icon, a signpost for the arrows,
 * a link to the book's write-up) reached only worlds that had no markers yet, and a table that
 * had already run it was stuck on whatever the first version happened to be, with no way forward
 * but deleting every pin by hand. So the pass now reconciles: it brings the pins that are there
 * up to the current design, and writes nothing at all when they already agree.
 *
 * WHAT THE RECORD IS FOR NOW. Not "this map is finished" but "these pins have existed here",
 * which is the only thing a later pass genuinely cannot work out for itself. A pin whose key is
 * recorded and whose note is gone was deleted on purpose, so it stays gone: a GM who removes the
 * pin for a place the party has not found yet meant it, and that bargain is kept. A pin whose key
 * was never recorded has never existed here, which is exactly what a newly designed pin looks
 * like, so it is created even on a map marked long ago. Per map because the two Scenes can arrive
 * years apart, and a map with no Scene yet, or one whose picture the recorded positions do not
 * fit, is simply not visited and is tried again next load.
 *
 * WHY IT DEMANDS OUR OWN FLAG. `isPosterMapScene` also matches on the Scene's NAME, which is the
 * right answer to the question the offer asks it ("is there already something here, so that
 * building another would duplicate it?") and the wrong answer to the question this asks ("may I
 * write documents onto this?"). This pass runs unprompted on every load, and a world that happens
 * to contain a battle map somebody called "The World's End" must not wake up with eleven pins on
 * it. Only a Scene this system stamped is a Scene this system may write to.
 *
 * Primary GM only. Unlike the linking pass this CREATES documents, and two GMs loading a world at
 * the same moment would otherwise each lay down a full set.
 *
 * @param {object} [io] Injected world accessors, for tests.
 * @returns {Promise<{created: number, updated: number}>} Pins laid down, and pins brought up to date.
 */
export async function markPosterMapScenes({
	scenes = globalThis.game?.scenes ?? [],
	isGM = !!globalThis.game?.user?.isGM,
	primary = isPrimaryGM,
	read = getObjectSetting,
	write = setSetting,
} = {}) {
	const total = { created: 0, updated: 0 };
	if (!isGM || !primary()) return total;

	// One pass over the journal directory for the whole run, built on the first map that has a
	// Scene to mark: a seeded world holds a few hundred entries, and every marked map would
	// otherwise rebuild the identical index from scratch.
	let index = null;
	for (const map of POSTER_MAPS.filter(mapHasMarkers)) {
		const scene = scenes.find(s => isOurPosterMapScene(s, map));
		if (!scene) continue;
		index ??= worldGazetteerIndex();
		const { created, updated } = await layMarkers(scene, map, scene.width, scene.height, { read, write, index });
		total.created += created;
		total.updated += updated;
	}
	return total;
}

/** A poster-map Scene this system actually stamped, by flag alone. See markPosterMapScenes. */
function isOurPosterMapScene(scene, map) {
	return scopedFlag(scene, "posterMap") === map.slug;
}

/**
 * Build the Scenes for `rows` (entries from planPosterMapScenes). Each row is independent:
 * one that fails is recorded and the rest still land, because a single unreadable image
 * must not cost the GM the other four maps.
 *
 * `onProgress({ fraction, detail })` is called after each row, for the setup window's bar.
 *
 * @returns {Promise<{created: number, updated: number, pins: number, failures: string[]}>}
 */
export async function createPosterMapScenes(rows, { onProgress } = {}) {
	const result = { created: 0, updated: 0, pins: 0, markers: 0, failures: [] };
	for (const [index, row] of rows.entries()) {
		try {
			const img = await probeImageSize(row.src);
			const { created, pins, markers } = await upsertPosterMapScene(row.map, img);
			if (created) result.created++; else result.updated++;
			result.pins += pins;
			result.markers += markers;
		} catch (err) {
			error(`Poster maps: could not build the Scene for "${row.map.name}"`, err);
			result.failures.push(row.map.name);
		}
		onProgress?.({ fraction: (index + 1) / rows.length, detail: `${index + 1} of ${rows.length} maps` });
	}
	if (result.created || result.updated) {
		info(`Poster maps: ${result.created} scene(s) created, ${result.updated} refreshed, `
			+ `${result.pins} village pin(s) and ${result.markers} place marker(s) placed.`);
	}
	return result;
}
