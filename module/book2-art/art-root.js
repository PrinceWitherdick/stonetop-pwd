import { SYSTEM_ID } from "../system-id.js";
// Where the Book II art the GM imported lives, and how a manifest `out` path resolves
// against it.
//
// Two sides depend on this agreeing exactly: the apply pass (reapply.js) browses the folder
// to learn which files are on disk, and treasure-drops.js points a dragged item at a file
// that pass said was there. Resolve the path two different ways and the index reports "on
// disk" while the item points somewhere else — a broken image with nothing to catch it. So
// the root rule, its default, and `${root}/${out}` live here and nowhere else.

export const DEFAULT_ROOT = "stonetop-book-art";

/**
 * Read one of this module's settings, or null.
 *
 * Tolerant of a missing/unregistered setting, which both readers below need for the same two
 * reasons: treasure-drops.js is unit-tested outside Foundry, and a world on an older system
 * version hasn't registered these settings yet. Shared so the tolerance is one decision rather
 * than two copies that could come to disagree about what "not there" means.
 */
function artSetting(key) {
	try {
		return globalThis.game?.settings?.get?.(SYSTEM_ID, key) ?? null;
	} catch (_) { /* setting not registered in this world */ }
	return null;
}

/**
 * The configured durable art folder, with trailing slashes normalized away so `${root}/${out}`
 * never yields a double slash — which wouldn't match the paths FilePicker.browse returns, and
 * would silently no-op the whole apply pass.
 */
export function book2ArtRoot() {
	return String(artSetting("book2ArtRoot") || DEFAULT_ROOT).replace(/\/+$/, "");
}

/**
 * The IDENTITY of one manifest `out` path inside an already-resolved root: the one definition of
 * the `${root}/${out}` join. Callers that hoist the root for a batch (reapply's per-pass loop)
 * pass it in here rather than re-inlining the join, so both sides resolve alike.
 *
 * This is what a picture IS, not necessarily where a browser fetches it from. Use it to ask the
 * browse whether a file is on disk, and to key an art index. For something a document or an
 * <img src> has to load, use `book2ArtSrc` / `book2ArtServedWith` — see below.
 */
export function book2ArtSrcWith(root, out) {
	return `${root}/${out}`;
}

/**
 * Whatever a host puts in FRONT of `${root}/…`, learned from a real browse and broadcast so
 * clients that cannot browse still resolve art.
 *
 * Empty on a self-hosted Foundry, where the art folder is served straight out of the user data
 * path and the identity above IS the URL. Non-empty where user files live somewhere else: The
 * Forge redirects a `data` upload into its Assets Library and serves the result from
 * `https://assets.forge-vtt.com/<userId>/`, so the identity alone 404s. Nothing here knows or
 * cares which host it is — the value is observed (browse.js's ArtInventory), published by the
 * GM-side passes, and read back by everyone else.
 *
 * World-scoped, so a PLAYER opening the People gallery — who can never run a browse of their own
 * — gets it broadcast like any other setting.
 */
export function book2ArtPrefix() {
	// A prefix has to end in a separator to be a prefix; a value stored without one would
	// silently weld itself onto the root ("…/uidstonetop-book-art/…").
	const s = String(artSetting("book2ArtPrefix") || "");
	return !s || s.endsWith("/") ? s : `${s}/`;
}

/**
 * Where a browser actually fetches one manifest `out` from, with the root already resolved.
 * The identity above with the host's prefix in front — the two are the same string off a
 * hosted setup, which is why this was not needed until one turned up.
 */
export function book2ArtServedWith(root, out, prefix = book2ArtPrefix()) {
	return `${prefix}${book2ArtSrcWith(root, out)}`;
}

/** Where a browser actually fetches one manifest `out` from, inside the durable folder. */
export function book2ArtSrc(out) {
	return book2ArtServedWith(book2ArtRoot(), out);
}
