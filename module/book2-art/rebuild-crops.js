import { BOOK2_ART_APPLY_MANIFEST } from "./manifest.js";
import { book2ArtRoot, book2ArtSrcWith } from "./art-root.js";
import { browseArtDirs, clearArtBrowseCache, servedPath } from "./browse.js";
import { isValidRect, RECT_SUFFIX_GROUPS } from "./people-portraits.js";
import { uploadFile } from "../utils/foundry-compat.js";

/**
 * Rebuild missing "People of Stonetop" detail portraits from art the GM has ALREADY imported,
 * without touching their PDFs.
 *
 * A person row may be a `crop`: a fractional [x0,y0,x1,y1] sub-rect of one illustration, so a
 * drawing with several figures yields one portrait per person. Those crops were added after the
 * first release that shipped whole-illustration portraits, which leaves an upgrading GM holding
 * every PARENT illustration on disk but none of the details cut from it. Re-running the importer
 * would work, but it means finding the books again and re-extracting everything.
 *
 * There is a shortcut: the crop rect is fractional, so cutting it out of the parent's webp gives
 * the same framing as cutting it out of the PDF. The only cost is resolution — the parent on disk
 * was already downscaled once (the importer caps the long side), so a detail derived from it is
 * smaller than one lifted from the full-resolution stencil. Measured over the current manifest
 * that is a median long side of ~525px against ~682px, with nothing below 200px, which is ample
 * for a gallery thumbnail or a sheet portrait. A GM who wants the maximum can still re-import.
 *
 * The parent's path is not stored anywhere: it is derivable from the crop's own slug, which is
 * the parent slug plus a `-cNNN-NNN-NNN-NNN` suffix (see merge-art-picker.py's `crop_suffix`).
 * That is what makes this possible with no extra manifest data beyond the rect itself.
 *
 * GM-only — it browses and uploads data files.
 */

// The slug suffix merge-art-picker.py appends for a crop: per-mille of each fractional
// coordinate, zero-padded. The digit groups come from RECT_SUFFIX_GROUPS so the 3-OR-4 rule
// (1000 is four digits) is stated once for both suffixes — writing it out a second time here is
// what let a `\d{3}` pattern miss every rect touching an edge. End-anchored, unlike the square's:
// this one runs against SLUGS, which have no extension.
const CROP_SUFFIX_RX = new RegExp(`-c${RECT_SUFFIX_GROUPS}$`);

export const isCropSlug = (slug) => CROP_SUFFIX_RX.test(String(slug ?? ""));
export const parentSlugOf = (slug) => String(slug ?? "").replace(CROP_SUFFIX_RX, "");

/**
 * The one planner behind all three of the rebuilds below.
 *
 * Every one of them asks the same question — "which fractional rects could I cut out of files
 * already on disk?" — and the answer is the same eight steps each time. Only three things vary,
 * so they are the three parameters: where the row keeps its RECT, where it wants the cut WRITTEN,
 * and which file it is cut FROM. Written out per kind, the guards and the plan shape were spelled
 * three times, and the dedupe rule below had reached only the last of them.
 *
 * `parentOutOf` returning null means this row cannot name a source, which is how the crop rebuild
 * says "that slug is not a crop slug" — the only place that test can actually bite is the slug
 * arithmetic itself.
 *
 * @param {Set|object} present    art inventory: what is already on disk
 * @param {string} root           the durable art folder
 * @param {Array} rows            manifest rows (people or monsters)
 * @param {object} accessors      {rectOf, outOf, parentOutOf}
 */
function plannedRectCuts(present, root, rows, { rectOf, outOf, parentOutOf }) {
	const srcOf = (out) => book2ArtSrcWith(root, out);
	const plan = [];
	// A plan is a list of FILES to write, not of rows. Two subjects drawn in one picture who framed
	// the same rect share one output file — gen-pack-macro's duplicate-art collapse points them
	// both at it deliberately, since the extraction is identical. Planning it once per row would
	// decode, encode and upload the same pixels twice, and would make the offer print a number
	// higher than the files the button actually writes.
	//
	// It follows that where two rows DO disagree — same destination, different rects — the FIRST
	// row's framing is what lands. Before this rule was shared, the crop and square passes planned
	// both and the last write won. Neither is more right than the other, and no such pair exists in
	// the shipped manifest (checked across all people and monster rows); what matters is that the
	// rule is now one rule, stated, rather than three passes that had each drifted to their own.
	const planned = new Set();
	for (const row of rows ?? []) {
		const crop = rectOf(row);
		const out  = outOf(row);
		if (!crop || !out || !isValidRect(crop)) continue;
		const dest = srcOf(out);
		if (present.has(dest) || planned.has(dest)) continue;   // already have it, or already planned
		const parentOut = parentOutOf(row);
		if (!parentOut) continue;                      // this row cannot name a source
		const parentKey = srcOf(parentOut);
		if (!present.has(parentKey)) continue;         // nothing to cut it from
		planned.add(dest);
		plan.push({ slug: row.slug, name: row.name, out, crop, dest, parentKey, parentSrc: servedPath(present, parentKey) });
	}
	return plan;
}

/**
 * Which detail portraits could be rebuilt right now, given what is on disk.
 *
 * Pure and side-effect free so it can be unit-tested and so the prompt can count the work
 * without doing any of it. `present` is the art browse's inventory (or, in tests, a plain Set of
 * the paths it would report).
 */
export function plannedCropRebuilds(present, root, people = BOOK2_ART_APPLY_MANIFEST.people ?? []) {
	return plannedRectCuts(present, root, people, {
		rectOf: (p) => p?.crop,
		outOf:  (p) => p?.out,
		// The parent keeps its own filename in the same folder, whether or not it is still a
		// person row itself — a parent superseded by its crops stays on disk, just unreferenced.
		// Only a crop slug has a parent to recover, which is what gates the arithmetic.
		parentOutOf: (p) => (isCropSlug(p?.slug)
			? `${p.out.slice(0, p.out.lastIndexOf("/") + 1)}${parentSlugOf(p.slug)}.webp`
			: null),
	});
}

/**
 * Which SQUARE faces could be cut right now, given what is on disk.
 *
 * Same shape and same runner as a crop rebuild, because it is the same operation: cut a
 * fractional rect out of an image already on disk. What differs is only where the rect is
 * measured — a square is measured against the PERSON image, so the source is that image
 * directly (`p.out`), with no slug arithmetic to recover a parent.
 *
 * This is the whole upgrade path for squares. A GM who already imported holds every person
 * image; the squares are new files cut from those, so nobody has to find their PDFs again. The
 * cost is resolution only, and a square is the smallest thing this pipeline produces.
 */
export function plannedPortraitRebuilds(present, root, people = BOOK2_ART_APPLY_MANIFEST.people ?? []) {
	return plannedRectCuts(present, root, people, {
		rectOf:      (p) => p?.portrait,
		outOf:       (p) => p?.portraitOut,
		parentOutOf: (p) => p?.out,
	});
}

/**
 * Which creature TOKEN squares could be cut right now, given what is on disk.
 *
 * The third of the same operation, and the simplest: a token square is measured against the
 * creature's illustration itself (a monster row has no `crop` — that is a people-only field), so
 * the source is that file directly with no slug arithmetic and no composition.
 *
 * This is the whole upgrade path for tokens. A GM who already imported holds every bestiary
 * illustration; the squares are new files cut from those, so nobody has to find their PDFs again.
 * Until one lands, the creature's token keeps pointing at the whole illustration — reapply.js
 * gates on the file being present — so nothing is ever broken while this is pending.
 */
export function plannedMonsterTokenRebuilds(present, root, monsters = BOOK2_ART_APPLY_MANIFEST.monsters ?? []) {
	return plannedRectCuts(present, root, monsters, {
		rectOf:      (m) => m?.token,
		outOf:       (m) => m?.tokenOut,
		parentOutOf: (m) => m?.out,
	});
}

/**
 * Cut a fractional sub-rect out of a loaded image, at the parent's own resolution. Shared with
 * the Tokenizer bridge (utils/portrait-tokenizer.js), which bakes a chosen frame the same way —
 * the never-floor-a-span-to-zero rule below has to hold for both, and one copy of it is one
 * place to fix.
 */
export function cropToCanvas(img, [x0, y0, x1, y1]) {
	const iw = img.naturalWidth ?? img.width;
	const ih = img.naturalHeight ?? img.height;
	// Round to whole pixels, but never to nothing: a sliver rect on a small parent could
	// otherwise floor to a zero-width canvas, which throws on toBlob.
	const sx = Math.round(x0 * iw);
	const sy = Math.round(y0 * ih);
	const sw = Math.max(1, Math.round((x1 - x0) * iw));
	const sh = Math.max(1, Math.round((y1 - y0) * ih));
	const canvas = document.createElement("canvas");
	canvas.width = sw;
	canvas.height = sh;
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
	return canvas;
}

/**
 * Load an image from the Foundry data folder, rejecting when it does not load — which is how
 * a path that browse reported but the browser cannot read (a truncated upload, say) fails its
 * own item rather than the whole batch. Shared with the poster-map scene builder.
 */
export function loadImage(src, { crossOrigin = "anonymous" } = {}) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		// The art folder is same-origin (it is served out of the user's own data path), but ask
		// for anonymous CORS anyway so the canvas is never tainted — a tainted canvas throws only
		// at toBlob, i.e. after all the work.
		//
		// A caller that never touches a canvas passes null instead, because this default makes the
		// load FAIL outright against any host sending no CORS headers — which is most of the web,
		// and exactly the external art the portrait framer is expected to open.
		if (crossOrigin !== null) img.crossOrigin = crossOrigin;
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`could not load ${src}`));
		img.src = src;
	});
}

/**
 * The URL a browser fetches one art path from.
 *
 * A data-relative path goes through Foundry's route, which is what puts the world's route prefix
 * in front of it. An ALREADY-ABSOLUTE url is handed back untouched: where user files live off the
 * data path (The Forge's Assets Library serves them from `https://assets.forge-vtt.com/<uid>/`)
 * every art path resolves to a full URL, and routing one produces `/https://assets.forge-vtt.com/…`
 * — which no browser can fetch, so the load fails and the item silently does nothing.
 *
 * Shared by every caller that turns an art path into something loadImage can take, because each of
 * them can be handed either shape and the three of them getting this right separately is how one
 * of them gets it wrong.
 */
export function artImageUrl(src) {
	const s = String(src ?? "");
	if (!s) return "";
	if (/^(https?:|data:|blob:)/i.test(s)) return s;
	return encodeURI(foundry.utils.getRoute(s.replace(/^\/+/, "")));
}

const WEBP_QUALITY = 0.85; // matches the importer's CONFIG.QUALITY

/**
 * Do the rebuild. Returns { written, failed, skipped } — `skipped` is work that was planned but
 * whose parent turned out unreadable, so a partial run is honest rather than silently short.
 * Each file is written independently: one bad parent must not abandon the other 142.
 */
export async function rebuildPeopleCrops({ plan, onProgress = null } = {}) {
	const root = book2ArtRoot();
	// The plan is REQUIRED, with no browse-and-plan fallback of its own. This runs whichever of the
	// three kinds of cut it is handed — people details, their squares, creature tokens — across two
	// directories, and the only thing that knows the right ordering between them is planBookArt. A
	// default that browsed people-only and planned crops-only would quietly do a third of the job
	// for a caller who trusted the signature.
	const work = plan ?? [];
	const result = { written: 0, failed: 0, skipped: [], total: work.length };
	if (!work.length) return result;

	// Derived per item rather than fixed: the same cut writes people portraits into
	// `assets/people` and creature tokens into `assets/bestiary`, and the destination is already
	// stated exactly once — in the manifest row's own `out`.
	//
	// An `out` with no separator at all has no directory to take, and must yield the root rather
	// than `slice(0, -1)` — which would chop the last character off the filename and upload into a
	// directory named after a truncated file.
	const dirOf = (out) => {
		const i = String(out).lastIndexOf("/");
		return i < 0 ? root : `${root}/${String(out).slice(0, i)}`;
	};
	let done = 0;
	// One fetch + decode per PARENT, not per crop: the shipped manifest cuts ~143 details out
	// of ~51 illustrations, and the busiest parent feeds eleven of them. Grouping by parent is
	// what makes a single-slot cache enough — it also means only ONE decoded full-page image
	// is held at a time, rather than a map of all 51 for the length of the run.
	const grouped = [...work].sort((a, b) => String(a.parentSrc).localeCompare(String(b.parentSrc)));
	let loadedSrc = null;
	let loadedImg = null;
	for (const item of grouped) {
		try {
			if (loadedSrc !== item.parentSrc) {
				// Claim the slot BEFORE awaiting, and drop the previous image first: a parent
				// that fails to load is then attempted once, not once per crop cut from it, and
				// each of its crops still records an honest reason of its own.
				loadedSrc = item.parentSrc;
				loadedImg = null;
				loadedImg = await loadImage(item.parentSrc);
			}
			if (!loadedImg) throw new Error(`could not load ${item.parentSrc}`);
			const canvas = cropToCanvas(loadedImg, item.crop);
			const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
			if (!blob) throw new Error("encode returned no blob");
			const name = item.out.slice(item.out.lastIndexOf("/") + 1);
			// Null means the server refused it — see uploadFile, which owns that rule for every
			// upload in the system. Turned into the failure it is, so it lands in `skipped` with
			// everything else rather than being counted among the files this run wrote.
			const written = await uploadFile("data", dirOf(item.out),
				new File([blob], name, { type: "image/webp" }));
			if (!written) throw new Error("the server rejected the upload");
			result.written++;
		} catch (err) {
			result.failed++;
			// `dest` as well as the slug: a later pass cuts squares out of the very files this one
			// writes, and it can only skip the ones that never arrived if it is told their paths.
			result.skipped.push({ slug: item.slug, dest: item.dest, reason: String(err?.message ?? err) });
			console.warn(`Stonetop | could not rebuild portrait ${item.slug}:`, err);
		}
		onProgress?.(++done, work.length);
	}
	// New files in assets/people, so anything holding a listing of it is now out of date.
	if (result.written) clearArtBrowseCache();
	return result;
}

/** Everything this file can cut from: the people portraits and the bestiary illustrations. */
export const browseCuttableArt = (root = book2ArtRoot()) =>
	browseArtDirs(root, ["assets/people", "assets/bestiary"]);

/**
 * Everything cuttable from the durable art on disk, as two ordered passes.
 *
 * Two passes, in that order, and NOT one merged plan — because a person's square is cut from the
 * person image, and for 143 of the 155 people that image is itself a detail this very run is
 * about to create. Merging them would let the runner's parent-grouping sort interleave the two
 * and ask for a square before its source exists.
 *
 * Creature TOKENS ride the FIRST pass, beside the crops rather than beside the squares they
 * otherwise resemble: a token is cut from the creature's illustration, which nothing here ever
 * creates, so it has no ordering constraint at all and waiting for the second pass would only
 * delay it behind work it does not depend on.
 *
 * The square plan is still worked out UP FRONT, against what disk WILL hold once the details
 * land, so a caller gets an honest total to count against rather than a progress bar that grows
 * halfway through. That makes it OPTIMISTIC by construction: it assumes every detail cuts. The
 * runner is where the assumption is settled — rebuildBookArt drops the squares whose source
 * never arrived, rather than asking for a file nothing wrote.
 *
 * Stated once, here, because the counter and the runner have to agree about that total: two
 * copies of this ordering rule could drift into offering a number the run then disproves.
 */
async function planBookArt(root = book2ArtRoot()) {
	const present = await browseCuttableArt(root);
	const tokens = plannedMonsterTokenRebuilds(present, root);
	const first = [...plannedCropRebuilds(present, root), ...tokens];
	const dests = first.map((c) => c.dest);
	// `plus` carries this host's prefix onto the not-yet-written files, so a square planned against
	// a detail that does not exist yet still gets a fetchable `parentSrc`. `browseCuttableArt`
	// always hands back an ArtInventory, so the prefix is always there to carry.
	const afterFirst = present.plus(dests);
	// The token COUNT rides out as well as the cuts themselves inside `first`, because the caller
	// has to know whether this run creates any CREATURE squares: those are the only cut that
	// changes what a compendium document should point at, and re-pointing the compendium is the
	// expensive half the rebuild otherwise skips. See runBookArtRebuild.
	return { first, tokensPlanned: tokens.length, squares: plannedPortraitRebuilds(afterFirst, root) };
}

/**
 * Split the square plan by whether its source actually made it onto disk.
 *
 * The plan was drawn against what disk WOULD hold once the details landed (see planPeopleArt),
 * which makes it optimistic: a detail that could not be cut never arrives, and the square cut
 * from it then has no source. Attempting it anyway fails a SECOND time over the same single bad
 * file — the GM is told "2 could not be read" about one, and the console names a path no browse
 * ever reported as present.
 *
 * So the orphans come out separately rather than being dropped: they are still counted as done
 * and still listed as skipped, because a run that quietly produces fewer files than it announced
 * is the other half of the same dishonesty. They are simply not a second failure.
 *
 * Pure, and given the crop pass's own skip list rather than reading it, so the arithmetic that
 * decides all of the above is testable without a canvas.
 */
export function splitSquaresBySource(squares, cropSkips) {
	const unwritten = new Set((cropSkips ?? []).map((s) => s?.dest).filter(Boolean));
	const cuttable = [], orphaned = [];
	// Compared on the IDENTITY, never on `parentSrc`: a skip list records the `dest` a write was
	// aimed at, which is always canonical, while `parentSrc` is where the file would be fetched
	// from — the same string off a hosted setup and a different one on. Matching those would let
	// every orphan through on The Forge and fail each square a second time over one bad source.
	// `parentKey` falls back to `parentSrc` for a hand-built plan from before it existed.
	for (const s of squares ?? []) (unwritten.has(s.parentKey ?? s.parentSrc) ? orphaned : cuttable).push(s);
	return { cuttable, orphaned };
}

/** Cut everything cuttable: the detail portraits and creature tokens, then the square faces. */
export async function rebuildBookArt({ onProgress = null } = {}) {
	const { first, tokensPlanned, squares } = await planBookArt();
	const total = first.length + squares.length;
	let done = 0;
	const step = () => onProgress?.(++done, total);
	const a = await rebuildPeopleCrops({ plan: first, onProgress: step });

	const { cuttable, orphaned } = splitSquaresBySource(squares, a.skipped);
	for (const _ of orphaned) step();   // counted as done, so the bar reaches the announced total

	const b = await rebuildPeopleCrops({ plan: cuttable, onProgress: step });
	return {
		written: a.written + b.written,
		failed: a.failed + b.failed,
		skipped: [
			...a.skipped,
			...b.skipped,
			...orphaned.map((s) => ({
				slug: s.slug,
				dest: s.dest,
				reason: `source ${s.parentSrc} could not be rebuilt`,
			})),
		],
		total,
		// How many CREATURE token squares this run set out to cut. The caller re-points the
		// compendium only when this is non-zero — that is the one cut whose result a compendium
		// document points at, and the pass that does it is the expensive one.
		tokensPlanned,
	};
}

/** How much `rebuildBookArt` would do, without doing any of it. Used to decide whether to ask. */
export async function plannedBookArtRebuilds(root = book2ArtRoot()) {
	const { first, squares } = await planBookArt(root);
	return [...first, ...squares];
}
