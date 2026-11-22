// WHICH MAP A SHARED ROUTE GOES OUT ON, and that map's resolved file.
//
// One answer for the two writers of a share: the walkthrough's Show players button
// (ExpeditionDialog#_shareRouteNow) and the test-fixtures macro's trip on the road
// (expedition-macro-api.js). A copy in the macro would go on choosing the old map after a rule
// here changed, and the players would be shown a picture the GM's own button never picks.

import { TRAVEL_MAPS, travelMap } from "../data/travel-times.js";
import { browseTravelMapArt, resolveTravelMap } from "../book2-art/travel-map-art.js";
import { tierDraws, tierDrawing } from "../utils/route-path.js";

/**
 * The map that draws the whole way, else `shownTier` (the one the GM's panel is showing); and WHERE
 * THE WORLD HAS NO COPY OF THAT ONE, the other map, if it draws the way too (audit RTE-7). A world
 * that imported only the World's End still shows the players a walk to the Red Grove on it, through
 * the anchors that map keeps for exactly that. A way pinned to one map (drawn by hand, or setting out
 * from a mark) has that map or none: its marks mean nothing on the other.
 *
 * @returns {Promise<{tier: string|null, art: object|null, preferred: object|null}>}
 */
export async function shareMapFor(route, shownTier = null) {
	const first = tierDrawing(route) ?? shownTier ?? null;
	const preferred = travelMap(first);
	const candidates = route?.pinned
		? [route.tier]
		: [first, ...TRAVEL_MAPS.map(m => m.slug)]
			.filter((slug, i, all) => slug && all.indexOf(slug) === i)
			.filter(slug => slug === first || tierDraws(slug, [route?.legs?.[0]?.from, route?.legs?.at(-1)?.to]));
	const present = candidates.length ? await browseTravelMapArt().catch(() => null) : null;
	for (const slug of candidates) {
		const map = travelMap(slug);
		if (!map || !present) continue;
		// Null where the world has no copy of this map's file.
		const art = await resolveTravelMap(map, present).catch(() => null);
		if (art) return { tier: slug, art, preferred };
	}
	return { tier: first, art: null, preferred };
}
