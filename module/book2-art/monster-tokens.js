import { RECT_SUFFIX_GROUPS, rectSuffix, outWithSuffix, stripRectSuffix } from "./people-portraits.js";

/**
 * The square a bestiary creature's TOKEN shows on the battle map.
 *
 * The art is book illustration, drawn for a printed page: a tall standing giant, a wide coiled
 * serpent, two creatures sharing one picture. A token is a square on a grid, and Foundry fits a
 * portrait into it with `cover` — a blind centre slice, which on a 3:1 drawing is as often empty
 * page as creature. So the square is CHOSEN by hand in the picker, once per creature, and cut as
 * its own small file.
 *
 * ONLY the token points at it. `actor.img` stays the whole illustration, which is what the
 * bestiary sheet header, the catalog rows, the codex journal page and an image-hover popup all
 * read — so hovering a token on the map still gives the artist's whole composition, at size.
 * A person's square face (people-portraits.js) is now laid out the same way, having started out
 * as the `img` itself; the difference left is that it still needs a square <-> whole index to swap
 * back, because worlds hold paths from both sides of that move. Nothing needs to swap back here:
 * the whole illustration never left.
 *
 * A monster row has no `crop` (that is a people-only field), so the rect is fractional against
 * the illustration itself and there is only ever one coordinate space to reason about.
 *
 * Nothing at RUNTIME derives a token path from these: the manifest ships `tokenOut` already
 * spelled out, and reapply.js and rebuild-crops.js read that field. What these are for is holding
 * the manifest to it — monster-tokens.test.js re-derives every shipped `tokenOut` from its `out`
 * and rect and checks they agree, so a hand-edited row or a drifted generator is caught here
 * rather than as a 404 on somebody's battle map. Pure and Foundry-free so that check can run as a
 * plain unit test.
 */

/**
 * A token's filename suffix: per-mille of each fractional coordinate, zero-padded. Mirrors
 * merge-art-picker.py's `token_suffix`.
 *
 * `t`, not the person square's `q`, and deliberately so: in this system a `-q` file is the one an
 * actor's `img` points at, and a creature's token square explicitly is not that. One glance at a
 * listing of `assets/bestiary/` should not have to guess which kind of square it is holding.
 */
export const tokenSuffix = (rect) => rectSuffix("t", rect);

/** The token's own `out` path: the creature's path with the suffix spliced before its extension. */
export const tokenOutFor = (out, rect) => outWithSuffix(out, tokenSuffix(rect));

/**
 * Matched before the extension (or at end of string), because this runs against PATHS. The digit
 * groups come from RECT_SUFFIX_GROUPS so the 3-OR-4 rule (per-mille of 1.0 is `1000`, four
 * digits) is stated once for every suffix in the pipeline — a `\d{3}` pattern silently misses
 * every rect flush with an edge, which is most of them, and that mistake has already cost this
 * project one wrong number.
 */
const TOKEN_SUFFIX_RX = new RegExp(`-t${RECT_SUFFIX_GROUPS}(?=\\.[^.]+$|$)`);

/** Shape-only test, for callers with no manifest to hand (the manifest's own parity checks). */
export const hasTokenSuffix = (path) => TOKEN_SUFFIX_RX.test(String(path ?? ""));

/**
 * The illustration a token square was cut from: the path with its `-t<rect>` spliced back OUT,
 * or null when it carries no such suffix.
 *
 * The inverse of `tokenOutFor`, and the reason it can exist at all is that the suffix is a pure
 * naming convention over one source file — so a caller holding only a stored token path can ask
 * "which picture is this a square of?" without a manifest, a compendium or a network round trip.
 *
 * That question has one caller and one purpose: deciding whether a creature's token is one the
 * ART PIPELINE cut from this actor's own portrait, as opposed to one a GM chose by hand. See
 * `tokenFollowsPortrait` in utils/portrait-token-frame.js — a square that fails to be recognised
 * there makes an in-world crop silently stop at the sheet and never reach the map.
 *
 * The splice itself — and the cache-buster strip it depends on, since the suffix is anchored to the
 * EXTENSION and `…-t250-000-750-500.webp?1699999999` would otherwise hide it — is `stripRectSuffix`,
 * the same letter-parameterised reader the person square uses. `t` here, `q` there: the anchor and
 * the 3-or-4-digit rule are stated once for every kind of square this pipeline cuts, exactly as
 * `tokenSuffix` and `tokenOutFor` above are thin specialisations of the shared writers.
 */
export const tokenSourceFor = (path) => stripRectSuffix("t", path);
