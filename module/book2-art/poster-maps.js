import { SYSTEM_ID } from "../system-id.js";
import { ALL_SYSTEM_IDS } from "../migration/compat.js";
import { book2ArtSrcWith } from "./art-root.js";
import { browseArtDirs, servedPath } from "./browse.js";
import { loadImage, artImageUrl } from "./rebuild-crops.js";
import { landmarkIcon, landmarkNoteData } from "../hooks/PlaceOfInterestDrop.js";
import { placeNoteLink } from "../utils/places-chronicle.js";
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
	const flags = scene?.flags ?? {};
	if (flagScopes().some(scope => flags[scope]?.posterMap === map.slug)) return true;
	return scene?.name === map.name;
}

/** Every flag scope our own documents could have been stamped with — see isPosterMapScene. */
function flagScopes() {
	return [...ALL_SYSTEM_IDS, globalThis.game?.system?.id].filter(Boolean);
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
	const img = await loadImage(artImageUrl(path));
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

	const pins = await placePosterMapPins(scene, map, width, height);
	// Best-effort: a Scene with no thumbnail still works, it just looks bare in the sidebar.
	try {
		const thumb = await scene.createThumbnail();
		if (thumb?.thumb) await scene.update({ thumb: thumb.thumb });
	} catch (_) { /* thumbnails are cosmetic */ }
	return { created, pins };
}

/**
 * Place the village map's lettered place-of-interest pins, skipping any already there.
 * Matched on our `posterPin` flag first and then on the "same name, same landmark glyph"
 * shape a pre-flag run left behind, so re-running never stacks a second set on top.
 */
async function placePosterMapPins(scene, map, width, height) {
	if (!map.notes?.length) return 0;
	const existing = scene.notes?.contents ?? [];
	// The icon filename comes from the same helper that writes it, so the "did a pre-flag run
	// already place this one?" test cannot drift from what a pin actually looks like.
	const iconFile = letter => landmarkIcon(letter).split("/").pop();
	const missing = map.notes.filter(note =>
		!existing.some(e => flagScopes().some(scope => e.flags?.[scope]?.posterPin === note.key))
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
 * Build the Scenes for `rows` (entries from planPosterMapScenes). Each row is independent:
 * one that fails is recorded and the rest still land, because a single unreadable image
 * must not cost the GM the other four maps.
 *
 * `onProgress({ fraction, detail })` is called after each row, for the setup window's bar.
 *
 * @returns {Promise<{created: number, updated: number, pins: number, failures: string[]}>}
 */
export async function createPosterMapScenes(rows, { onProgress } = {}) {
	const result = { created: 0, updated: 0, pins: 0, failures: [] };
	for (const [index, row] of rows.entries()) {
		try {
			const img = await probeImageSize(row.src);
			const { created, pins } = await upsertPosterMapScene(row.map, img);
			if (created) result.created++; else result.updated++;
			result.pins += pins;
		} catch (err) {
			error(`Poster maps: could not build the Scene for "${row.map.name}"`, err);
			result.failures.push(row.map.name);
		}
		onProgress?.({ fraction: (index + 1) / rows.length, detail: `${index + 1} of ${rows.length} maps` });
	}
	if (result.created || result.updated) {
		info(`Poster maps: ${result.created} scene(s) created, ${result.updated} refreshed, ${result.pins} pin(s) placed.`);
	}
	return result;
}
