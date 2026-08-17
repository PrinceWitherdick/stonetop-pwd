import { BOOK2_ART_APPLY_MANIFEST } from "./manifest.js";

/**
 * The square face cut out of a "People of Stonetop" portrait, and how it relates to the whole
 * illustration it came from.
 *
 * The art is book illustration: standing figures. Across the shipped manifest the median person
 * image is h/w 1.52, the tallest is 3.28, and 115 of 155 are taller than 1.2. Every place a face
 * appears in play is small and round — 22px steading roster circles, 26px relationship hearts,
 * 75px follower cards, the Actors sidebar, a token. Cropping a tall figure to a circle with CSS
 * alone takes a blind top slice, which on a 3:1 figure is as likely to be sky and hat brim as a
 * face. So the square is CHOSEN by hand in the picker, once per portrait, and cut as its own
 * small file.
 *
 * WHERE THAT SQUARE NOW SITS. It was originally what `actor.img` pointed at — every small surface
 * already read `.img`, so that cost no per-surface work. It is not any more: `actor.img` is the
 * WHOLE illustration, the square rides as a frame rect over it, and the square FILE is what the
 * token draws. See repoint-portraits.js for why (a module reading `actor.img` got a cropped face
 * where the same gesture on a monster gave the artist's whole composition) and for the migration.
 * The square <-> whole index below outlives that move: a world still holds paths from either side
 * of it, and the hover preview and the token still need to get from one to the other.
 *
 * Everything here is pure and Foundry-free so it can be unit-tested, and so a caller in a
 * template helper or a data-model getter can use it without dragging settings in.
 */

/**
 * The four per-mille coordinate groups every rect suffix is made of, as regex source.
 *
 * The groups are 3 OR 4 digits long, because per-mille of 1.0 is `1000`. A `\d{3}` pattern
 * silently misses every rect touching an edge — which is most of them, since a square is
 * usually flush with the top of the figure. That mistake has already cost this project one
 * wrong number, and it was then restated in a second regex for crops, which is two chances to
 * make it again. Both suffixes now build on this: only the leading letter and the anchor
 * differ, and each site supplies its own.
 */
const RECT_DIGITS = String.raw`\d{3,4}`;
export const RECT_SUFFIX_GROUPS = `${RECT_DIGITS}(?:-${RECT_DIGITS}){3}`;

/** The same four groups, CAPTURING, for reading a rect back out of a name it was written into.
 *  Built from the same `RECT_DIGITS` literal so the 3-or-4 rule above cannot drift between the
 *  pattern that matches a suffix and the one that parses it. */
const RECT_SUFFIX_CAPTURE = `(${RECT_DIGITS})-(${RECT_DIGITS})-(${RECT_DIGITS})-(${RECT_DIGITS})`;

// One compiled matcher per suffix letter (`q`, `t`, `c`). `rectFromSuffix` runs once per stored
// `img` across every actor in the world and every follower flag on them, and a RegExp built per
// call would be the only allocation in an otherwise pure lookup.
const rectMatchers = new Map();
const rectMatcher = (letter) => {
	let rx = rectMatchers.get(letter);
	if (!rx) rectMatchers.set(letter, rx = new RegExp(`-${letter}${RECT_SUFFIX_CAPTURE}(?=\\.[^.]+$|$)`));
	return rx;
};

/**
 * A path with any `?query` or `#hash` removed.
 *
 * Stated once because it is load-bearing in five places for one reason. Every suffix in this
 * pipeline is anchored to the EXTENSION, and paths here routinely carry a cache-buster: the
 * Tokenizer module (vtta-tokenizer) rewrites `actor.img` to `<path>?<timestamp>` on every run, and
 * this system's own frame bake does the same on every re-frame so the browser repaints. Left on,
 * that stamp hides the suffix — the manifest lookup misses, the hover preview silently stops
 * swapping in the whole illustration, and the on-disk square resolver stops matching. Nothing
 * throws, so nothing announces it.
 */
export const stripQuery = (p) => String(p ?? "").split("#")[0].split("?")[0];

/**
 * The rect a filename ENCODES, read back out: the inverse of `rectSuffix`.
 *
 * The suffix is per-mille of four fractions, so the round trip is exact to the 3dp everything in
 * this pipeline stores rects at — which is what makes a filename a usable source of truth for a
 * rect nobody wrote down anywhere else. That is the whole reason this exists: the hand-chosen
 * square of every shipped person lives ONLY in its square's name, and moving a world onto the
 * "portrait is the whole illustration, the square is a frame over it" layout needs that rect back.
 *
 * Query and hash are stripped first — the suffix is anchored to the EXTENSION, and a cache-buster
 * would otherwise hide it (see `basenameOf` for who appends those and why).
 *
 * Returns null rather than a partial rect for anything that does not carry the suffix, so a
 * caller can use it as the "is this one of ours?" test as well as the parse.
 */
export function rectFromSuffix(letter, path) {
	const m = rectMatcher(letter).exec(stripQuery(path));
	if (!m) return null;
	const rect = m.slice(1, 5).map((n) => Number(n) / 1000);
	return isValidRect(rect) ? rect : null;
}

/**
 * The same path with its `-<letter><rect>` suffix spliced back OUT, or null when it carries none.
 *
 * The inverse of `outWithSuffix`, and the counterpart to `rectFromSuffix`: one reads the rect out
 * of a name, this reads the SOURCE FILE out of it. Both can exist at all because the suffix is a
 * pure naming convention over one source file, so a caller holding only a stored path can ask
 * "which picture is this a square of?" with no manifest, compendium or network round trip.
 *
 * Parameterised by letter for the same reason everything else here is — `q` for a person's face,
 * `t` for a creature's token square, `c` for a crop — so the anchor and the 3-or-4-digit rule are
 * stated once rather than restated per kind of square. Query and hash go first (see `stripQuery`).
 */
export function stripRectSuffix(letter, path) {
	const s = stripQuery(path);
	const m = rectMatcher(letter).exec(s);
	if (!m) return null;
	return s.slice(0, m.index) + s.slice(m.index + m[0].length);
}

/** The square rect a `-q…` portrait filename encodes, in the PERSON image's coordinate space. */
export const portraitRectOf = (path) => rectFromSuffix("q", path);

/**
 * A square's filename suffix: per-mille of each fractional coordinate, zero-padded. Mirrors
 * merge-art-picker.py's `portrait_suffix`, and deliberately mirrors the `-c` CROP suffix in
 * shape so the two read alike in a directory listing.
 *
 * Matched before the extension (or at end of string), because this runs against PATHS —
 * unlike the crop suffix, which is end-anchored because it runs against slugs.
 */
const PORTRAIT_SUFFIX_RX = new RegExp(`-q${RECT_SUFFIX_GROUPS}(?=\\.[^.]+$|$)`);

/** Four fractions in [0,1] describing a positive-area rect. Same contract as a crop. */
export function isValidRect(rect) {
	if (!Array.isArray(rect) || rect.length !== 4) return false;
	const [x0, y0, x1, y1] = rect.map(Number);
	if (![x0, y0, x1, y1].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return false;
	return x1 > x0 && y1 > y0;
}

// NB: a fractional rect is NOT square just because its two spans are equal — the image
// underneath is not square, so equal fractions describe a rect as lopsided as the image.
// Squareness is only meaningful in pixels, which is why all four numbers are stored rather than
// an origin and a side. Nothing in the system needs to ASK whether a rect came out square: the
// picker settles that when the square is chosen, and merge-art-picker.py checks it there.

const permille = (f) => String(Math.round(f * 1000)).padStart(3, "0");

/**
 * `-<letter><x0>-<y0>-<x1>-<y1>`, per-mille. MUST agree with the Python, or a re-export orphans
 * files.
 *
 * The letter is the only thing that varies between the kinds of rect this pipeline names: `q` for
 * a person's square face, `t` for a creature's token square (monster-tokens.js), `c` for a crop.
 * The rounding and the padding are stated once here, because those are what have to match
 * merge-art-picker.py exactly — a half-up tie resolved differently in one place mints a filename
 * nothing ever writes.
 */
export const rectSuffix = (letter, rect) => `-${letter}${rect.map(permille).join("-")}`;

/**
 * A derived path: the source path with a rect suffix spliced in before its extension.
 *
 * Shared with monster-tokens.js. The splice is only three lines, but the edge case (a path with
 * no extension, or a dot that belongs to a DIRECTORY name rather than a file) is the kind that
 * looks handled in each copy and is only handled in one.
 */
export function outWithSuffix(out, suffix) {
	const s = String(out);
	const dot = s.lastIndexOf(".");
	const slash = s.lastIndexOf("/");
	if (dot <= slash) return s + suffix;   // no extension to splice before
	return s.slice(0, dot) + suffix + s.slice(dot);
}

/** `-q<x0>-<y0>-<x1>-<y1>`, per-mille. MUST agree with the Python, or a re-export orphans files. */
export function portraitSuffix(rect) {
	return rectSuffix("q", rect);
}

/** The square's own `out` path: the person's path with the suffix spliced before its extension. */
export function portraitOutFor(out, rect) {
	return outWithSuffix(out, portraitSuffix(rect));
}

// A square is always measured against the PERSON image — after `crop`, not before. There is
// deliberately no "compose these two rects" helper: both extraction paths apply them in
// sequence instead (the importer cuts crop then square out of the same lifted stencil; the
// in-Foundry rebuild cuts the square straight out of the person file on disk). Sequencing IS
// the composition, and it leaves no combined rect to compute and get subtly wrong.

// Filename <-> filename, both directions, built once per people list.
//
// Keying on the BASENAME rather than the full path is what keeps this root-agnostic: the durable
// art folder is configurable, so a caller holding a resolved `stonetop-book-art/assets/people/x`
// would otherwise have to know the root to say anything about it. A square always sits in the
// same directory as its person image, so swapping one basename for the other is enough — and
// slugs are unique, so a basename identifies a row on its own.
const cache = new WeakMap();
// A stable identity for "no people at all", so an older build whose manifest predates this
// field does not mint a fresh array on every call and defeat the cache.
const NONE = [];

function index(people) {
	const rows = people ?? BOOK2_ART_APPLY_MANIFEST.people ?? NONE;
	const hit = cache.get(rows);
	if (hit) return hit;
	const toFull = new Map();
	const toSquare = new Map();
	const base = (p) => String(p).slice(String(p).lastIndexOf("/") + 1);
	for (const p of rows) {
		if (!p?.out || !p.portraitOut) continue;
		toFull.set(base(p.portraitOut), base(p.out));
		toSquare.set(base(p.out), base(p.portraitOut));
	}
	const built = { toFull, toSquare };
	cache.set(rows, built);
	return built;
}

const swapBasename = (src, file) => String(src).slice(0, String(src).lastIndexOf("/") + 1) + file;

/** The filename part of a path, with any `?query` or `#hash` removed — see `stripQuery` for why
 *  that strip is load-bearing rather than tidiness. */
export const basenameOf = (p) => {
	const s = String(p);
	return stripQuery(s.slice(s.lastIndexOf("/") + 1));
};

/**
 * The whole illustration behind a square portrait path, or null if this is not one.
 *
 * Checked against the manifest rather than merely stripping the suffix, so a GM's own file that
 * happens to look like a square resolves to nothing instead of to a path that does not exist.
 */
export function fullPortraitSrc(src, people) {
	if (!src) return null;
	const s = String(src);
	const full = index(people).toFull.get(basenameOf(s));
	// The swap drops any query string with the basename, which is correct: the caller wants the
	// illustration's real path, and a cache-buster minted for a different file means nothing here.
	return full ? swapBasename(stripQuery(s), full) : null;
}

/**
 * The picture to SHOW when this path is enlarged: the whole illustration behind a shipped
 * square, or the path itself when it is not one (a GM's own browsed file is its own identity).
 *
 * `fullPortraitSrc` must keep returning null for "not gallery art" — `avatar-preview.js` and
 * `resolvePortrait` both branch on that — so this is the ` ?? src` half of the pair, named once
 * rather than re-derived at every popout and hover. Empty in, empty out.
 */
export function displayPortraitSrc(src, people) {
	return src ? (fullPortraitSrc(src, people) ?? src) : "";
}

/** The square cut from this illustration, or null. The inverse of `fullPortraitSrc`. */
export function squarePortraitSrc(src, people) {
	if (!src) return null;
	const s = String(src);
	const square = index(people).toSquare.get(basenameOf(s));
	return square ? swapBasename(stripQuery(s), square) : null;
}

/** Shape-only test, for callers with no manifest to hand (the manifest's own parity checks). */
export const hasPortraitSuffix = (path) => PORTRAIT_SUFFIX_RX.test(String(path ?? ""));
