// What Book II art is on disk right now.
//
// Its own leaf module because two passes ask the question and neither should own it: the
// art re-apply sweeps all seven durable directories (reapply.js), while the portrait-crop
// rebuild only cares about `assets/people` (rebuild-crops.js). Sharing the walk means one
// browse and one cache rather than two of each. Which FilePicker class to walk WITH is a
// version question, so it lives with the other version shims (`filePicker`, foundry-compat.js).
//
// WHAT A BROWSE HANDS BACK IS NOT ALWAYS WHAT WE ASKED FOR. On a self-hosted Foundry the
// files come back as the data-relative paths we built (`stonetop-book-art/assets/people/x.webp`).
// On a hosted setup that keeps user files somewhere else they come back fully qualified —
// The Forge redirects a `data` browse into its Assets Library and returns
// `https://assets.forge-vtt.com/<userId>/stonetop-book-art/assets/people/x.webp`, and an S3
// source behaves the same way. Comparing those to a path we reassembled ourselves fails for
// every single file, which reads exactly like "the GM never imported": the document-less art
// indexes (`peopleArt`, `peoplePortraitArt`, `treasureArt`) are authoritative, so they get
// republished as empty and the People gallery goes blank on a world whose art is all present.
//
// So a browse result is no longer a bare Set of strings. It is an ArtInventory, which files
// every path under a ROOT-RELATIVE key — the `${root}/${out}` that art-root.js builds and that
// every caller already asks with — and remembers the part in front of it. That gives callers
// two separate questions with two separate answers:
//
//   present.has(`${root}/${out}`)      is this picture on disk?     (identity)
//   present.resolve(`${root}/${out}`)  what do I point a document/<img> at?  (servable path)
//
// Off a hosted setup the two are the same string and nothing changes.

import { filePicker } from "../utils/foundry-compat.js";

/** Every directory the importer writes durable art into. */
export const DURABLE_ART_DIRS = [
	"assets/bestiary", "assets/locations", "assets/maps",
	"assets/treasures", "assets/people", "assets/steading",
	"assets/diagrams",
];

// One in-flight-or-settled browse per `${root}|${dir}`.
//
// A single GM load asks the same directories over and over: the art re-apply sweeps all seven,
// the finishing self-heal sweeps them again, the Welcome guide sweeps them a third time for
// one boolean, and the poster-map offer reads assets/maps a fourth. `assets/people` (~155
// files) and `assets/bestiary` (~200) are the two largest listings the system has, and none
// of those passes can see a different answer from the one before it — nothing writes to the
// folder in between.
//
// Something eventually does, though, which is what clearArtBrowseCache is for. The promise is
// cached rather than the result, so concurrent callers share one round trip instead of racing
// to start their own.
//
// The entry lives for the SESSION, so what it is really claiming is that every writer we know
// of announces itself — see clearArtBrowseCache for the three that do. A file that arrives any
// other way (copied in over the OS, uploaded through Foundry's own file browser) is invisible
// until the next reload. That is the deliberate trade: the alternative is re-listing ~350 files
// several times per load to catch something that essentially only happens on a dev's machine,
// where `game.stonetop.reapplyBook2Art()` busts the cache anyway.
const _browseCache = new Map();

/**
 * Session caches elsewhere that are keyed off these same files, forgotten when this one is.
 *
 * Registered rather than imported: every one of them already imports THIS module for the browse
 * itself, so a call the other way would be a cycle. A cache that measures or reads a file the
 * browse found is only as fresh as the browse, and a GM who re-runs Import Book Art mid-session
 * gets one cleared and not the other — which is worse than either, because the two then disagree
 * about a file that is right there on disk.
 */
const _dependents = new Set();

/** Have a cache of your own forgotten whenever the art browse is. */
export function onArtBrowseCleared(forget) {
	_dependents.add(forget);
}

/**
 * Forget everything browseArtDirs has cached. Call after anything writes to the durable art
 * folder. Three callers today: the crop rebuild does it directly, the Import Book Art macro is
 * caught by the settings hook in stonetop.js (publishing its art index is the last thing it
 * does), and `game.stonetop.reapplyBook2Art()` clears it for the by-hand case that nothing can
 * hook. A fourth writer must join them, or its files will not be seen this session.
 */
export function clearArtBrowseCache() {
	_browseCache.clear();
	for (const forget of _dependents) forget();
}

/** One directory's file list, from cache when we have already asked this session. */
function browseDir(root, dir) {
	const key = `${root}|${dir}`;
	let pending = _browseCache.get(key);
	if (!pending) {
		const FP = filePicker();
		// A rejected browse means the directory does not exist yet (the GM hasn't imported)
		// -> nothing on disk from there. Cached like any other answer: an absent directory
		// stays absent until something creates it, and that clears the cache.
		pending = FP.browse("data", `${root}/${dir}`).catch(() => null);
		_browseCache.set(key, pending);
	}
	return pending;
}

/**
 * Split a browsed path into the part that leads up to our art root and the root-relative
 * remainder — i.e. into the bit that varies by host and the bit the manifest can predict.
 *
 * The root is the landmark because it is the one segment both sides always share: callers ask
 * with `${root}/${out}`, and whatever the host prepends necessarily sits in front of it.
 * `lastIndexOf` so a root that also appears higher up a URL resolves to the deepest match.
 *
 * A path with no `/<root>/` in it is already root-relative (the self-hosted case, where the
 * browse echoes back the path we asked with) and splits to an empty prefix.
 */
export function splitAtArtRoot(path, root) {
	const p = String(path ?? "");
	if (!root) return { prefix: "", key: p };
	const marker = `/${root}/`;
	const i = p.lastIndexOf(marker);
	return i >= 0 ? { prefix: p.slice(0, i + 1), key: p.slice(i + 1) } : { prefix: "", key: p };
}

/**
 * The art on disk under one root, keyed so a caller can ask about it in the only vocabulary it
 * has — the `${root}/${out}` it builds from the manifest — whatever the host actually called it.
 *
 * Deliberately Set-shaped for `has`/`size`, because every existing caller asks those two
 * questions and a pure-function plan helper is unit-tested by handing it a plain Set. Anything
 * that also wants the servable path calls `resolve`, and the tests that pass a bare Set simply
 * get `undefined` from an optional call and fall back to the path they built — which is correct
 * for them, since off a hosted setup the two are equal.
 */
export class ArtInventory {
	constructor(root = "") {
		this.root = String(root ?? "");
		// root-relative key -> the path the host actually served it as
		this._byKey = new Map();
		this._prefix = "";
	}

	/** File one browsed path. First writer wins, so a duplicate listing can't shuffle the answer. */
	add(path) {
		const { prefix, key } = splitAtArtRoot(path, this.root);
		// One prefix per host, so the first non-empty one is the answer; recording it here rather
		// than deriving it later is what lets a client that CANNOT browse (a player, who never runs
		// this) still resolve art — see `book2ArtPrefix` in art-root.js.
		if (prefix && !this._prefix) this._prefix = prefix;
		if (!this._byKey.has(key)) this._byKey.set(key, String(path ?? ""));
		return this;
	}

	/** How many distinct pictures are on disk. */
	get size() { return this._byKey.size; }

	/** Whatever sits in front of `${root}/…` on this host; "" when nothing does. */
	get prefix() { return this._prefix; }

	/** Is this `${root}/${out}` on disk? */
	has(path) { return this._byKey.has(String(path ?? "")); }

	/** What to point a document or an <img> at for this `${root}/${out}`, or null if it is absent. */
	resolve(path) { return this._byKey.get(String(path ?? "")) ?? null; }

	/**
	 * The identities on disk, so `[...present]` still means what it did when this was a Set.
	 * Canonical paths, never served ones: a caller spreading an inventory is building a set of
	 * things to compare against, and comparisons are done in identity space.
	 */
	*[Symbol.iterator]() { yield* this._byKey.keys(); }

	/**
	 * A copy that also assumes `paths` (canonical) are present — for a plan drawn against what disk
	 * WILL hold once the current pass finishes writing (rebuild-crops.js cuts squares out of details
	 * the same run creates).
	 *
	 * Those files do not exist yet, so there is nothing to have observed: their served path is
	 * PREDICTED from this host's prefix. Safe because they are written into the very directories
	 * this inventory was just built from, so they can only come back from the same place.
	 */
	plus(paths = []) {
		const next = new ArtInventory(this.root);
		next._prefix = this._prefix;
		for (const [key, served] of this._byKey) next._byKey.set(key, served);
		for (const p of paths ?? []) {
			const key = String(p ?? "");
			if (key && !next._byKey.has(key)) next._byKey.set(key, `${this._prefix}${key}`);
		}
		return next;
	}
}

/**
 * What to fetch one identity from, falling back to the identity itself.
 *
 * The companion to `ArtInventory#resolve` for the two questions that differ: `resolve` answers
 * "is it there, and where?" with null for absent, while this answers "what would I fetch?" and so
 * always has an answer. Optional-called throughout because the inventory is deliberately
 * Set-shaped (see above) and every pure-function unit test passes a plain Set — which has nothing
 * to resolve with, and off a self-hosted setup is right not to: there, the identity IS the URL.
 *
 * One definition because three passes need it (the crop planner's parent images, reapply's
 * document targets, the poster-map scene backgrounds) and a fallback written three ways is three
 * chances to write `?? null` and hand a caller an unfetchable path.
 */
export const servedPath = (present, path) => present?.resolve?.(path) ?? path;

/**
 * The art currently on disk under `root`.
 *
 * The dirs are independent, so they are browsed in parallel.
 *
 * GM-only, since only a GM can browse the data files.
 */
export async function browseArtDirs(root, dirs = DURABLE_ART_DIRS) {
	const present = new ArtInventory(root);
	const results = await Promise.all(dirs.map(dir => browseDir(root, dir)));
	for (const res of results) {
		if (!res) continue;
		// A malformed %-escape in a stray filename must not reject the whole pass — keep the
		// raw name on decode failure so the caller still gets everything else.
		for (const f of res.files) {
			try { present.add(decodeURIComponent(f)); }
			catch { present.add(f); }
		}
	}
	return present;
}
