// Finding the regional map the journey screen draws on.
//
// The maps do not ship — `assets/maps/` is gitignored and the release refuses to build if it
// exists — so the picture only exists in a world whose GM ran "Import Book Art" over their own
// PDFs. This module answers one question for one map tier: is a copy on disk, what does a browser
// fetch it from, and how does a canonical map fraction land inside that particular copy.
//
// WHICH COPY. Up to three renders of the same map can be on disk at once (the GM playbook's 300
// dpi crop, Book II's smaller one, and a scan of the backer poster), and they are DIFFERENT CROPS
// of the same artwork. Rather than invent a preference, this reuses the one the importer already
// publishes: `settingOverviewMaps[].prefer`, read through `pageChain`, which is what decides the
// picture on the Setting Overview journal page. So the map in this window and the map on that page
// are always the same file, and the frame registration keyed to it is therefore the right one.
//
// GM-ONLY, WITHOUT A BRANCH. `FilePicker.browse` rejects for a player; browse.js catches that and
// returns an empty inventory, which is indistinguishable from "the GM never imported" — and that
// is already a state this screen handles by falling back to its destination list. So a player who
// somehow opens the walkthrough gets the list, not an error.

import { book2ArtRoot, book2ArtSrcWith } from "./art-root.js";
import { onArtBrowseCleared, servedPath } from "./browse.js";
import { browsePosterMapArt, probeImageSize } from "./poster-maps.js";
import { BOOK2_ART_APPLY_MANIFEST } from "./manifest.js";
import { pageChain } from "./reapply.js";
import { FULL_FRAME, frameFor, frameFitsImage } from "../data/travel-times.js";
import { error, warn } from "../utils/logger.js";

/** The importer's row for one tier, which carries the sharpest-first `prefer` chain. */
function manifestRow(manifestSlug) {
	return (BOOK2_ART_APPLY_MANIFEST.settingOverviewMaps ?? [])
		.find(row => row.slug === manifestSlug) ?? null;
}

/**
 * WHICH copy of one map tier this world has, without measuring it.
 *
 * Split from `resolveTravelMap` because the two questions cost wildly different amounts and the
 * caller usually only wants this one. "Is this tier's tab live?" is answered by the browse, which
 * is promise-cached for the session; "how is this file shaped?" needs the whole picture decoded.
 * The route step asks the first about every tier and the second only about the one it draws.
 *
 * Returns null when nothing in the chain is on disk, which is the ordinary state of a world that
 * has not imported the book art and is not an error.
 *
 * @param {object} map a TRAVEL_MAPS entry
 * @param {object} [present] a pre-built ArtInventory, when a caller is asking about several tiers
 * @returns {Promise<{slug, out, src}|null>}
 */
export async function travelMapFile(map, present = null) {
	const row = manifestRow(map.manifestSlug);
	if (!row) {
		error(`Travel maps: no importer manifest row named "${map.manifestSlug}"`);
		return null;
	}
	const root = book2ArtRoot();
	const inventory = present ?? await browseTravelMapArt();
	const out = pageChain(row).find(candidate => inventory.has(book2ArtSrcWith(root, candidate)));
	if (!out) return null;
	return { slug: map.slug, out, src: servedPath(inventory, book2ArtSrcWith(root, out)) };
}

/**
 * Every map file measured this session, by served path.
 *
 * A memo and not a nicety. The route step rebuilds its whole journey inside `getData`, so every
 * pin, every list row, every tier tab and every change of origin re-resolves the map — and these
 * are 300 dpi renders of a two-page spread, around 4.5 megapixels each. Unmemoized, a GM clicking
 * down the destination list decoded one of them per click, forever.
 *
 * The file CAN change under a running world, though — Import Book Art runs from a macro, and
 * re-running it at a different render resolution rewrites these very files — so this is dropped
 * whenever the browse beside it is. It was not, and the two then disagreed: the browse found the
 * rewritten file and `measure` still answered for the old one, so `aspect` sheared the picture and
 * `frameFitsImage` judged the registration against a ratio the file no longer had, either throwing
 * away a correct frame (every hotspot shifted to FULL_FRAME) or keeping a wrong one.
 *
 * The PROMISE is cached, not the result, so two callers in the same tick share one decode instead
 * of starting two. A rejected probe is dropped again, so a transient failure can be retried.
 */
const _measured = new Map();
onArtBrowseCleared(() => _measured.clear());

function measure(src) {
	if (!_measured.has(src)) {
		_measured.set(src, probeImageSize(src).catch(e => { _measured.delete(src); throw e; }));
	}
	return _measured.get(src);
}

/**
 * The best copy of one map tier that this world actually has, measured and registered.
 *
 * The aspect ratio comes from the FILE, not from a catalog constant, because it is written into the
 * wrapper's `aspect-ratio` and drives where every hotspot lands: a wrong one would shear the whole
 * map. A probe that fails costs only the ratio (the picture still draws) so it falls back to the
 * printed proportions rather than dropping the map.
 *
 * @param {object} map a TRAVEL_MAPS entry
 * @param {object} [present] a pre-built ArtInventory, when a caller is resolving several tiers
 * @returns {Promise<{slug, out, src, frame, aspect}|null>}
 */
export async function resolveTravelMap(map, present = null) {
	const file = await travelMapFile(map, present);
	if (!file) return null;

	// Zero means "not measured", which is a different thing from "measured and happens to match
	// the printed proportions" — see the frame check below for why the two must not be conflated.
	let measured = 0;
	try {
		const probed = await measure(file.src);
		if (probed?.w > 0 && probed?.h > 0) measured = probed.w / probed.h;
	} catch (e) {
		warn(`Travel maps: could not measure "${file.out}", falling back to the printed proportions`, e);
	}
	const aspect = measured || map.printedAspect;

	// A registration is a claim about the file's shape, so check it — AGAINST THE MEASUREMENT, and
	// only when there is one. A GM who saved their own, differently-trimmed scan over a filename we
	// know would otherwise get every hotspot shifted by the same wrong amount, which reads as bad
	// map data rather than a bad crop. But the fallback ratio is the PRINTED crop's, and the poster
	// frames are recorded precisely because the poster is a different crop — so checking a frame
	// against the fallback asks whether the poster is shaped like the page, answers no, and throws
	// away the correct registration on the one file that most needs it.
	let frame = frameFor(file.out);
	if (measured && !frameFitsImage(frame, measured, map.printedAspect)) {
		warn(`Travel maps: "${file.out}" is not shaped like the crop its hotspots were measured against `
			+ `(${measured.toFixed(3)} wide-to-tall); placing them against the whole image instead.`);
		frame = FULL_FRAME;
	}

	return { ...file, frame, aspect };
}

/**
 * The map images on disk, as one browse the caller can reuse across tiers.
 *
 * Through the poster maps' own browse rather than a second `browseArtDirs(root, ["assets/maps"])`
 * beside it: two functions in this folder answering "which map images are on disk" meant the
 * directory list was written twice, and the day the importer moves or splits that folder only one
 * of them would follow. The other would report an EMPTY inventory, which this module's header
 * notes is indistinguishable from "the GM never imported" — so the route step would quietly drop
 * to its destination list with nothing anywhere saying why.
 */
export function browseTravelMapArt() {
	return browsePosterMapArt(book2ArtRoot());
}
