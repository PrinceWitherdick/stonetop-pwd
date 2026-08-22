import { ALL_SYSTEM_IDS } from "../migration/compat.js";

// The poster-map catalog, and the rule for telling which of them a Scene IS.
//
// Split out of poster-maps.js so that BOTH ends of the question can read it. The importer and
// the Scene builder live next door in poster-maps.js, which reaches into settings.js for the
// records it keeps; the per-map "does this map's pins wear their names?" switch lives in
// settings.js, which has to name the same five maps. An import back the other way would be a
// cycle, so the shared half sits here instead, in a module that depends on nothing but the
// list of system ids this package has shipped under.
//
// Nothing in here touches the world, the canvas or the filesystem: it is a table and two
// pure lookups over it.

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

/**
 * Every flag scope our own documents could have been stamped with — see isPosterMapScene.
 *
 * Held once it is worth holding. This is read per note per canvas pass, and the answer only
 * moves when the package is renamed, which cannot happen mid-session. The cache is filled ONLY
 * once `game.system.id` is actually readable, because a first call from module scope — before
 * `game` exists — would otherwise freeze a list missing the very id the walk is for.
 */
let _flagScopes = null;
export function flagScopes() {
	if (_flagScopes) return _flagScopes;
	const live = globalThis.game?.system?.id;
	const scopes = [...ALL_SYSTEM_IDS, live].filter(Boolean);
	if (live) _flagScopes = scopes;
	return scopes;
}

/**
 * One of our flags off a Scene or a Note, under whichever scope it was stamped with.
 *
 * The scope walk, written once. Five places in this file asked the same question about a
 * different key, and a rename of the package is exactly the sort of change that has to reach
 * all five or none of them.
 */
export function scopedFlag(doc, key) {
	const flags = doc?.flags ?? {};
	for (const scope of flagScopes()) {
		const value = flags[scope]?.[key];
		if (value) return value;
	}
	return null;
}

/**
 * The Scene's background image, wherever this generation keeps it.
 *
 * v14 moved the artwork into the `levels` collection; v13 has it at the Scene root. `background`
 * is a read-only shim on v14 and usually answers, so it is asked first and the level is the
 * fallback — and a Scene stand-in in a test has neither, which answers "" and is right.
 */
function sceneBackgroundSrc(scene) {
	const levels = scene?.levels;
	const level = levels?.contents?.[0] ?? (Array.isArray(levels) ? levels[0] : null);
	return String(scene?.background?.src ?? level?.background?.src ?? "");
}

/**
 * Is this Scene actually PAINTED with `map`'s printing?
 *
 * Compared on the file's own name rather than the whole path, because the same artwork is served
 * from a different place on every host: a local data path, a Forge CDN url with a query string,
 * a world moved between the two. The basename is what all of those agree on.
 */
function showsPosterArt(scene, map) {
	const src = sceneBackgroundSrc(scene).split("?")[0];
	if (!src) return false;
	return src.slice(src.lastIndexOf("/") + 1) === map.out.slice(map.out.lastIndexOf("/") + 1);
}

/**
 * WHICH poster map this Scene is, or null for a Scene that is none of them.
 *
 * The same two-step lookup as isPosterMapScene, asked the other way round: that one tests a
 * Scene against a map already in hand (the builder knows which map it is about to write), this
 * one starts from a Scene and has to find the map (a map pin being drawn knows only what it
 * is sitting on).
 *
 * The flag is checked against the catalog rather than trusted outright, so a slug left behind
 * by a map this package no longer ships cannot name a row that is not there.
 *
 * THE NAME IS NOT ENOUGH ON ITS OWN, and this is the half that differs from isPosterMapScene.
 * That one is asked by the BUILDER, which is about to paint the map onto whatever it finds and so
 * may fairly adopt a Scene by name alone. This one is asked by readers who then treat the answer
 * as a fact about the picture — "do this map's pins wear their names", "may this Scene carry a
 * route whose coordinates are fractions of that exact printing". A GM's own dungeon named
 * "Marshedge" or "Gordin's Delve" would inherit both, silently and with nothing on screen saying
 * why. So a Scene claimed by name has to be showing the printing as well, which is exactly what
 * the Scenes this fallback exists for — the ones our importer built before it stamped the flag —
 * all do.
 */
export function posterMapSlugOf(scene) {
	const flagged = scopedFlag(scene, "posterMap");
	if (flagged && posterMapFor(flagged)) return flagged;
	const named = POSTER_MAPS.find(map => map.name === scene?.name);
	return named && showsPosterArt(scene, named) ? named.slug : null;
}

/** The catalog row for a slug, or null. The one place that reads the table by key. */
export function posterMapFor(slug) {
	return POSTER_MAPS.find(map => map.slug === slug) ?? null;
}

/**
 * This world's Scene for one poster map, or null when nothing has built it yet.
 *
 * `scenes` is a Foundry Collection in every real call, which has `find` of its own, so it is
 * searched in place: spreading it first copied every Scene in the world into a throwaway array
 * on each of the five lookups a book-art import makes. The `= []` default still works, arrays
 * having the same method.
 */
export function posterSceneFor(slug, scenes = []) {
	const map = posterMapFor(slug);
	if (!map) return null;
	return scenes.find(scene => isPosterMapScene(scene, map)) ?? null;
}

/**
 * Where the top-left of a Scene's PICTURE sits in the coordinate space its Notes and Drawings
 * live in.
 *
 * Not the same point, and the difference is a whole map's worth of misplacement. A placeable's
 * x/y are canvas coordinates, and the canvas is the scene rectangle PLUS its padding margin, so a
 * Scene with any padding at all puts the artwork's own origin at `dimensions.sceneX/sceneY`
 * rather than at zero. Ours are built unpadded, where the two coincide, but nothing stops a GM
 * from adding padding to a Scene afterwards, and the failure mode is silent: everything measured
 * as a fraction of the picture lands out on the blank margin with the map itself untouched.
 *
 * HERE rather than in either caller because both the pins (book2-art/poster-maps.js) and the
 * route line (utils/scene-route.js) measure in fractions of the same printing and must land on
 * the same point; the route was drawn without it and painted a whole map's width off on any
 * padded Scene.
 *
 * Read defensively because it is a computed getter: a Scene stand-in in a test has no such thing,
 * and zero is exactly right for the unpadded case it stands in for.
 */
export function sceneOrigin(scene) {
	const dims = scene?.dimensions;
	return { x: Number(dims?.sceneX) || 0, y: Number(dims?.sceneY) || 0 };
}
