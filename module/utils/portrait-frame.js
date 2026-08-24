import { isValidRect, fullPortraitSrc } from "../book2-art/people-portraits.js";
import { isDefaultImg } from "./strings.js";
import { SYSTEM_ID } from "../system-id.js";

/**
 * The square FRAME a user chooses over a person's portrait, and the inline style that paints it.
 *
 * The shipped "People of Stonetop" art solves this by cutting a square face to its own file and
 * pointing `actor.img` at it (see module/book2-art/people-portraits.js). That works because those
 * squares are chosen once, at build time, by a tool with the whole library in front of it. A GM's
 * own browsed art gets none of that: it falls through to one CSS rule (`object-fit: cover;
 * object-position: center top`), which takes a blind top slice, and on a tall figure that is as
 * often sky and hat brim as a face.
 *
 * So a frame chosen in-world is stored as DATA rather than cut to a file:
 *
 *     flags["stonetop-pwd"].portraitFrame = { src, rect: [x0, y0, x1, y1] }
 *
 * Fractions of the image named by `src`. Storing the rect rather than baking a file is what lets
 * a PLAYER frame their own follower's portrait — cutting a file needs FILES_UPLOAD, which most
 * worlds do not grant — and it is what lets the source live anywhere a path can point, including
 * a module's assets folder or an external URL, neither of which we may write beside. It is also
 * reversible: clearing the flag restores the blind crop, and no orphan file is left behind.
 *
 * ⚠ THE STAMP KEY IS `src`, NEVER `img`. module/book2-art/repoint-portraits.js walks every object
 * under `flags["stonetop-pwd"]` to depth 6 and rewrites any key literally named `img` from an
 * illustration path to its square. A frame stored as `{ img, rect }` would be silently repointed
 * at the square, permanently detaching every authored rect from the picture it was measured on —
 * with no error and no way to tell afterwards. `isValidFrame` rejects that alias on purpose.
 *
 * WHY NO MEASUREMENT AT RENDER TIME. With the image absolutely positioned inside a
 * `position: relative; overflow: hidden` box whose padding box is W×H, source pixel `u` paints at
 * `X = -W·x0/fw + (u/nw)·W/fw`. The rect's near corner `u = x0·nw` gives `X = 0`; its far corner
 * `u = x1·nw` gives `X = W`. The natural dimensions cancel out entirely, so both corners pin
 * exactly for any rect and any box without decoding the image first. That is the whole reason a
 * producer can emit a style string from data alone. Distortion (never displacement) appears only
 * if the rect is not square in PIXELS; the editor guarantees it is, and the 3dp storage rounding
 * bounds the anisotropy under 0.45%, i.e. under a third of a CSS pixel on the 75px follower card.
 * Do not compensate for it, and do not write a display-time "is this square?" predicate — it
 * would need the natural dimensions this side deliberately does not have.
 *
 * Everything here is pure and Foundry-free so it can be unit-tested, and so a producer building a
 * template context can call it without dragging settings or documents in.
 */

/**
 * The frame a document carries, or null.
 *
 * ⚠ Bracketed and built from SYSTEM_ID, never written out: the package id is hyphenated, so a
 * dotted `flags.stonetop-pwd.portraitFrame` parses as a subtraction and throws "pwd is not
 * defined". Every display surface goes through here rather than spelling the read out, so a
 * scope rename moves one literal instead of six — and six that silently resolve to `undefined`
 * would revert every hand-chosen crop to the blind top slice with no error to notice.
 *
 * Takes any object with a `flags` bag, so a real Document, a plain index row and a test fixture
 * all work — nothing here touches a Foundry global.
 */
export const documentPortraitFrame = (doc) => doc?.flags?.[SYSTEM_ID]?.portraitFrame ?? null;

/**
 * What tapping a portrait will DO, in one string for the tooltip AND the aria-label — so a copy
 * edit cannot leave the sighted and the screen-reader name disagreeing.
 *
 * Shared by every small face in the system (the follower card's portrait button, the roster row's
 * avatar disc), because those surfaces describe the SAME three states and a reader who meets both
 * should not be told about one act two ways.
 */
export function portraitActionLabel(name, { editable, hasPortrait } = {}) {
	const who = name || "this member";
	if (!editable) return `View ${who}'s portrait`;
	return hasPortrait ? `Change ${who}'s portrait` : `Choose a portrait for ${who}`;
}


/**
 * The folder every baked square is written to, under the world's own data.
 *
 * A rect is invisible to anything that does not know about this feature — the canvas draws a token
 * straight from `prototypeToken.texture.src`, and Foundry's token texture has no crop rect — so a
 * frame that has to be seen on the MAP is cut to a real file. That bake is a one-way export; the
 * rect stays the source of truth and re-framing simply overwrites the file.
 *
 * The name lives here, in the module that owns the frame concept and imports nothing heavy, so
 * that `isPortraitFrameBake` can be asked by the Actor document class (which must not drag the
 * canvas machinery in) as well as by the baker itself.
 */
export const PORTRAIT_FRAME_BAKE_DIR = "stonetop-portrait-frames";

/**
 * Is `path` one of our baked squares?
 *
 * What it buys: a token pointing at a bake is a token FOLLOWING the portrait, not one somebody
 * chose. Without that, changing a framed person's portrait would leave the old baked crop on the
 * map for ever, with the sheet showing one face and the token another.
 *
 * Tolerant of the cache-busting query string a bake is pointed at with (the file is overwritten
 * under one name, so a re-frame would otherwise paint from the browser's cache).
 */
export function isPortraitFrameBake(path) {
	if (!path) return false;
	return String(path).split("?")[0].split("#")[0].includes(`/${PORTRAIT_FRAME_BAKE_DIR}/`);
}

/**
 * Display floor for a rect's span. Below this the percentages explode: a span of 0.001 asks for
 * `width: 100000%`, which is a browser's problem rather than a user's intent.
 *
 * 0.01 keeps ~2.4x headroom over the smallest span the editor can actually produce — SQ_MIN on
 * the library's tallest source (h/w 3.28) bottoms out around fh 0.024.
 */
export const MIN_SPAN = 0.01;

/** The editor's smallest square, as a share of the stage's SHORT side. Doubles as the
 *  accidental-click threshold: a "draw" gesture smaller than this is a click, not a square. */
export const SQ_MIN = 0.08;

/**
 * Suggested side for a figure taller than it is wide, as a share of its height.
 *
 * Chosen by RENDERING portraits (aspect 0.35 to 2.97) at 1.0/.55/.45/.38/.30 of height in the
 * circle they are actually used in: 1.0 keeps head AND torso, barely better than the blind crop,
 * and .30 starts cutting heads off. Inherited from the art picker's HEAD_SHARE so a suggestion
 * made in-world matches one made at build time.
 */
export const HEAD_SHARE = 0.4;

/** Corner hit radius in stage pixels, capped against the box so a small square stays grabbable
 *  in the middle rather than being all corner. */
export const GRIP_MAX = 16;

/** Decimals in the emitted percentages. NEVER round these to integers: `left` is amplified by
 *  1/fw, up to about 42x, so a whole-percent error there is a visibly wrong crop. */
export const STYLE_DECIMALS = 4;

/** Rects are stored to 3dp, matching the art picker and merge-art-picker.py. */
const RECT_DECIMALS = 3;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const round = (n, places) => {
	const f = 10 ** places;
	return Math.round(n * f) / f;
};

/**
 * `[x0, y0, x1, y1]` clamped into [0,1] and rounded to 3dp, or null if the result is not a usable
 * rect.
 *
 * Round FIRST and validate the rounded value, never the reverse: rounding can collapse a sliver
 * to zero area, and it is the rounded numbers that get stored and later re-read. Exact 0 and
 * exact 1 survive untouched, which matters because flush-to-an-edge is the common case for a
 * square cut from the top of a standing figure, not the exception.
 */
export function normalizeRect(rect) {
	if (!Array.isArray(rect) || rect.length !== 4) return null;
	const nums = rect.map(Number);
	if (!nums.every((n) => Number.isFinite(n))) return null;
	const out = nums.map((n) => round(clamp01(n), RECT_DECIMALS));
	if (!isValidRect(out)) return null;
	if (out[2] - out[0] < MIN_SPAN || out[3] - out[1] < MIN_SPAN) return null;
	return out;
}

/**
 * Is this a storable frame? A plain object carrying a non-empty `src` and a rect that survives
 * normalisation.
 *
 * Never throws, whatever it is handed — it runs against flag data, which a hand-edit or a
 * half-finished migration can leave in any shape at all. An object using `img` as the path key is
 * rejected rather than accommodated; see the repoint warning in the module header.
 */
export function isValidFrame(frame) {
	if (!frame || typeof frame !== "object" || Array.isArray(frame)) return false;
	if (typeof frame.src !== "string" || frame.src.trim() === "") return false;
	return normalizeRect(frame.rect) !== null;
}

/** `{ src, rect }` with the rect normalised, or null. The only shape a write path may store. */
export function normalizeFrame(frame) {
	if (!isValidFrame(frame)) return null;
	return { src: String(frame.src), rect: normalizeRect(frame.rect) };
}

/** Rect equality, for the editor's dirty check. Tolerant of float noise from the box round trip. */
export function rectEq(a, b) {
	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 4 || b.length !== 4) return false;
	return a.every((n, i) => Math.abs(Number(n) - Number(b[i])) < 1e-9);
}

/**
 * Do two paths name the same picture?
 *
 * Query strings and hashes are stripped, which is not cosmetic: the Tokenizer module rewrites
 * `actor.img` to `<path>?<timestamp>` every time it runs (a deliberate cache-buster), so a frame
 * stamped before a tokenize would go stale on every actor it touched. A leading "./" is dropped
 * and percent-escapes are decoded so a path that made a round trip through a URL still matches.
 *
 * Compared CASE-SENSITIVELY: Foundry data paths are case-sensitive on a Linux host, and treating
 * them otherwise would make a frame apply to a different file there than it does here.
 */
export function sameSrc(a, b) {
	const norm = (v) => {
		if (typeof v !== "string") return null;
		let s = v.trim();
		if (!s) return null;
		s = s.split("#")[0].split("?")[0];
		if (s.startsWith("./")) s = s.slice(2);
		// A malformed escape ("%zz") throws; the raw string is the honest fallback.
		try { s = decodeURIComponent(s); } catch { /* keep the raw form */ }
		return s;
	};
	const x = norm(a);
	const y = norm(b);
	return x !== null && y !== null && x === y;
}

/**
 * The picture the EDITOR should put on its stage for a portrait currently showing `img`.
 *
 * For a shipped square that is the whole illustration it was cut from: higher resolution, and the
 * picture a user actually recognises. For anything else it is the image itself. Whatever loads is
 * what gets stamped, so a frame's `src` is proven-loadable by construction.
 */
export function frameSourceFor(img, { fullSrc = fullPortraitSrc } = {}) {
	return fullSrc(img) ?? img;
}

/**
 * The inline style that paints `rect` inside a square clipping box, or "" for an unusable rect.
 *
 * Every declaration earns its place against a rule that would otherwise beat it:
 *  - `object-fit: fill` beats the grouped `object-fit: cover` in styles/stonetop.css, which has
 *    the same specificity and would win on source order. The box already matches the image's own
 *    aspect ratio, so "fill" is exact rather than a stretch.
 *  - `max-width`/`max-height: none` beat core Foundry's `img { max-width: 100% }`, which would
 *    otherwise cap an image that is deliberately sized past its box.
 *  - `border-radius: 0` defuses a 50% radius inherited from the surface class. On an image sized
 *    to 250% of its box that radius is a giant ellipse, and it bites curved chunks out of pixels
 *    well inside the visible circle.
 *
 * Rendered through Handlebars' double stash. The emitted characters are only `[a-z0-9:;%.-]`,
 * none of which HTML-escaping touches, so the value survives intact without a triple stash — and
 * a triple stash would turn a corrupted flag into attribute injection.
 */
export function frameStyle(rect, { decimals = STYLE_DECIMALS } = {}) {
	const r = normalizeRect(rect);
	if (!r) return "";
	const [x0, y0, x1, y1] = r;
	const fw = x1 - x0;
	const fh = y1 - y0;
	// Trailing zeros stripped so the common whole-image case reads "100%" rather than "100.0000%".
	const pct = (n) => `${Number(round(n, decimals).toFixed(decimals))}%`;
	return "position:absolute;object-fit:fill;max-width:none;max-height:none;border-radius:0;"
		+ `width:${pct(100 / fw)};height:${pct(100 / fh)};`
		+ `left:${pct((-100 * x0) / fw)};top:${pct((-100 * y0) / fh)}`;
}

/**
 * What a producer renders for a portrait: the src to put in the `src` attribute, and the inline
 * style that frames it.
 *
 *  1. no frame, or an unusable one   -> the image, unframed
 *  2. the frame names this image     -> the image, framed
 *  3. the frame names the whole
 *     illustration this square came
 *     from                           -> THE ILLUSTRATION, framed
 *  4. the frame names something else -> the image, unframed
 *
 * Case 3 is the only one that changes the src, and it must: a rect measured on the illustration
 * cannot be applied to the square cut out of it. It is also what makes the feature survive
 * `repoint-portraits.js` moving an actor's `img` from an illustration to its square — the frame
 * keeps working, at higher resolution, instead of going stale.
 *
 * Case 4 is a deliberate silent fallback rather than an error: the user replaced the picture, and
 * a rect measured on the old one would crop the new one to an arbitrary rectangle. Better a blind
 * top crop that looks unremarkable than a confident crop of the wrong thing.
 *
 * `img` passes THROUGH unchanged in cases 1, 2 and 4 — including null and "" — so a caller's
 * `{{#if img}}` branch test behaves exactly as it did before this feature existed.
 */
export function resolvePortrait(img, frame, { fullSrc = fullPortraitSrc } = {}) {
	const unframed = { src: img, style: "", framed: false };
	if (!isValidFrame(frame)) return unframed;
	const style = frameStyle(frame.rect);
	if (!style) return unframed;
	if (sameSrc(frame.src, img)) return { src: img, style, framed: true };
	const full = fullSrc(img);
	if (full && sameSrc(frame.src, full)) return { src: frame.src, style, framed: true };
	return unframed;
}

/**
 * `resolvePortrait` for a document that may have no art of its own.
 *
 * Foundry hands every document a default silhouette, and a caller drawing an avatar wants to know
 * "is there a picture" rather than "is `img` non-empty" — so the default has to become null before
 * it reaches `resolvePortrait`, whose `src` passes through unchanged and would otherwise paint the
 * placeholder as though it were art. Every avatar-drawing surface wanted that same conversion and
 * wrote the ternary out for itself; this is it, once.
 *
 * @param {string|null|undefined} img    the document's `img`, default silhouette and all
 * @param {object|null} [frame]          its `portraitFrame` flag, see documentPortraitFrame
 * @returns {{src: string|null, style: string, framed: boolean}}  `src` is null when there is no
 *          real art, which is what a caller's `{{#if img}}` is asking.
 */
export function portraitOrNone(img, frame = null) {
	return resolvePortrait(isDefaultImg(img) ? null : (img || null), frame ?? null);
}

/**
 * A first guess at the face: top-anchored, horizontally centred, and only as tall as a head is
 * likely to be.
 *
 * A square image is framed whole. A tall one takes the smaller of its full width and HEAD_SHARE
 * of its height, so a 3:1 figure (where the full width IS the head-and-shoulders square) and a
 * 1.5:1 one (where it is not) both land on the face rather than on the torso.
 */
export function suggestSquare(pw, ph, headShare = HEAD_SHARE) {
	if (!Number.isFinite(pw) || !Number.isFinite(ph) || pw <= 0 || ph <= 0) return null;
	const side = ph <= pw ? ph : Math.min(pw, ph * headShare);
	const fw = side / pw;
	const fh = side / ph;
	const x0 = (1 - fw) / 2;
	return normalizeRect([x0, 0, x0 + fw, fh]);
}

/**
 * Stage size for the editor: the image scaled UNIFORMLY to fit the dialog.
 *
 * Uniform is the invariant the whole editor rests on — because the stage is the image at one
 * scale, a square in stage pixels is a square in image pixels, so the constraint needs no aspect
 * arithmetic and only the conversion back to fractions does.
 *
 * Note this floors the SCALE where the art picker floored each axis independently. Flooring the
 * axes breaks uniformity on a lopsided source that hits the height cap, which would silently make
 * every square the editor produced non-square.
 *
 * `minSide` is a wish and the two caps are law: the floor exists so a postage-stamp source is not
 * rendered unusably small, so it may override `maxUpscale`, but it is itself capped by the fit or
 * a long thin image would be floored into a stage wider than the dialog.
 *
 * Rounding to whole pixels leaves the two axis ratios differing by under a pixel. That is the
 * same order as the 3dp storage rounding and is bounded by it in practice; see the module header.
 */
export function stageFor(pw, ph, { maxW = 520, maxH = 560, viewH = 0, maxUpscale = 4, minSide = 140 } = {}) {
	if (!Number.isFinite(pw) || !Number.isFinite(ph) || pw <= 0 || ph <= 0) return null;
	const heightCap = viewH > 0 ? Math.min(maxH, viewH * 0.66) : maxH;
	const fit = Math.min(maxW / pw, heightCap / ph);
	const scale = Math.max(Math.min(fit, maxUpscale), Math.min(fit, minSide / Math.min(pw, ph)));
	return { w: Math.round(pw * scale), h: Math.round(ph * scale), scale };
}

/**
 * Rect -> stage box. `side` comes from the X span ALONE, which silently re-squares a rect whose
 * axes drifted apart (3dp rounding, or a hand-edited flag). That self-correction is why the
 * editor's dirty check compares NORMALISED rects: an untouched open/close would otherwise look
 * like a 0.001 change and queue a pointless document update.
 */
export function rectToBox(rect, w, h) {
	const r = normalizeRect(rect);
	if (!r) return null;
	return { left: r[0] * w, top: r[1] * h, side: (r[2] - r[0]) * w };
}

/** Stage box -> rect. Spans are written back per axis, which is where a stage-pixel square
 *  becomes the two different fractions an unequal-sided image needs. */
export function boxToRect(box, w, h) {
	if (!box || !(w > 0) || !(h > 0)) return null;
	const { left, top, side } = box;
	return [left / w, top / h, (left + side) / w, (top + side) / h];
}

/** Corner grab radius, capped against the box so a small square stays mostly middle. */
const gripFor = (side) => Math.min(GRIP_MAX, side * 0.3);

/**
 * Which gesture a press at (x, y) starts.
 *
 * Getting a square right is two motions — put it roughly there, then nudge it — so an editor that
 * can only redraw makes you redo the size every time you fix the position, and the reverse. The
 * test is geometric rather than DOM-based, which is why the corner grips can be (and are)
 * `pointer-events: none` decoration that can never swallow the press that starts a resize.
 *
 * No box yet returns "draw", which is how the first drag on an unframed image works.
 */
export function hitTestBox(x, y, box) {
	if (!box) return { mode: "draw" };
	const { left, top, side } = box;
	const g = gripFor(side);
	const corners = [
		["nw", left, top],
		["ne", left + side, top],
		["sw", left, top + side],
		["se", left + side, top + side]
	];
	for (const [corner, cx, cy] of corners) {
		if (Math.abs(x - cx) <= g && Math.abs(y - cy) <= g) return { mode: "resize", corner };
	}
	if (x >= left && x <= left + side && y >= top && y <= top + side) {
		return { mode: "move", dx: x - left, dy: y - top };
	}
	return { mode: "draw" };
}

/**
 * Slide a box back inside the stage. It SLIDES rather than shrinks: dragging past an edge should
 * move the square, not resize it out from under the pointer.
 *
 * Produces garbage when `side` exceeds the stage, so every caller caps the side first.
 */
export function clampBox(box, w, h) {
	if (!box) return null;
	const side = box.side;
	return {
		side,
		left: Math.min(Math.max(box.left, 0), w - side),
		top: Math.min(Math.max(box.top, 0), h - side)
	};
}

/** Which corner stays pinned while each grip is dragged, and which way the side grows from it. */
const ANCHORS = {
	se: [0, 0, 1, 1],
	nw: [1, 1, -1, -1],
	ne: [0, 1, 1, -1],
	sw: [1, 0, -1, 1]
};

/**
 * Resize from a corner, pinning the OPPOSITE corner.
 *
 * The side follows the LONGER of the two axis distances from the anchor, so the box tracks
 * whichever axis is actually being pulled instead of stalling on the other. It is then capped by
 * the room available from that anchor, which is why this never needs `clampBox` — the cap already
 * bounds it, and clamping afterwards would slide a box the user is resizing.
 */
export function resizeBox(corner, box, x, y, w, h) {
	const anchor = ANCHORS[corner];
	if (!anchor || !box) return box;
	const [ax0, ay0, sx, sy] = anchor;
	const ax = box.left + ax0 * box.side;
	const ay = box.top + ay0 * box.side;
	const room = Math.min(sx > 0 ? w - ax : ax, sy > 0 ? h - ay : ay);
	const min = Math.min(w, h) * SQ_MIN;
	let side = Math.max(sx * (x - ax), sy * (y - ay));
	side = Math.min(Math.max(side, min), room);
	return { side, left: sx > 0 ? ax : ax - side, top: sy > 0 ? ay : ay - side };
}

/** A square drawn from an empty press, flipping its origin when the drag goes up or left. */
export function boxFromDrag(x0, y0, x, y, w, h) {
	const side = Math.min(Math.max(Math.abs(x - x0), Math.abs(y - y0)), w, h);
	return clampBox({ side, left: x < x0 ? x0 - side : x0, top: y < y0 ? y0 - side : y0 }, w, h);
}

/**
 * Keyboard adjustment, or null for a key this editor does not handle — which is how Tab and
 * Escape still reach the dialog instead of being swallowed by a blanket preventDefault.
 *
 * `+`/`-` resize about the CENTRE, so growing a square already flush with the top pushes it down
 * rather than refusing to grow.
 */
export function nudgeBox(box, key, { shift = false } = {}, w, h) {
	if (!box) return null;
	const step = shift ? 10 : 2;
	const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key];
	if (move) return clampBox({ ...box, left: box.left + move[0], top: box.top + move[1] }, w, h);
	const grow = { "+": step, "=": step, "-": -step, _: -step }[key];
	if (grow === undefined) return null;
	const min = Math.min(w, h) * SQ_MIN;
	const side = Math.min(Math.max(box.side + grow, min), w, h);
	const delta = (side - box.side) / 2;
	return clampBox({ side, left: box.left - delta, top: box.top - delta }, w, h);
}
