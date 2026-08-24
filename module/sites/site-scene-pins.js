// A site's pin on the table's own copy of the map.
//
// WHY THIS EXISTS. `site-map-spots.js` records where one of the GM's sites stands as a fraction of
// a printed regional map, and the expedition walkthrough draws that as a pin on its own little
// picture of the Vicinity. That picture is a planning aid in a dialog. The map the TABLE looks at is
// a Scene, built out of the same artwork by the poster-map importer, and until this module the two
// knew nothing about each other: a GM who marked the Sunken Barrow on the walkthrough's map had to
// go and drag the page onto the Scene a second time to put it where the players could see the pin,
// and then keep the two in step by hand.
//
// So a placement is now ONE act with two results. Choosing a spot on the travel map puts the mark
// on the Scene as well, moves it when the spot moves, and takes it off when the pin is lifted.
//
// IT IS THE SAME FRACTION EITHER WAY, which is the whole reason this is a dozen lines rather than a
// coordinate system. A spot is stored against the printed page crop, `frameFor` says where that
// crop sits inside the poster file the Scene was built from, and `posterSpotPixels` composes the
// two — the very same conversion the book's own place markers land through. A pin dropped on the
// walkthrough's inch-wide map therefore stands in the same valley on the table's 6000px one.
//
// WHAT DRESSES THE PIN IS NOT HERE. A Note linked to a GM-prep page is textured, labelled and made
// fog-proof by the `preCreateNote` seam in hooks/ThreatNotePins.js, off the one kind table in
// journal/gm-prep-page.js. So this module writes a position and a link and nothing else, and a site
// pin laid here is indistinguishable from one the GM dragged on by hand — which is what keeps the
// refit pass, the label styling and the delete-with-the-page cleanup working on both.
//
// AND THE PLAYERS STILL CANNOT SEE IT. Core decides a Note's visibility by testing the reader
// against what it LINKS to, and a site is one page of the steading's hidden Sites entry
// (`ownership: NONE`). The pin is therefore GM-only for free, by the same rule that makes a pin
// linked to a closed journal vanish — which is a trap for the gazetteer pins next door and exactly
// the behaviour prep wants.

import { posterMapFor, posterMapSlugOf, sceneOrigin } from "../book2-art/poster-map-catalog.js";
import { TRAVEL_MAPS, frameFitsImage, frameFor, markedMap } from "../data/travel-times.js";
import { posterSpotPixels } from "../utils/map-pins.js";
import { warn } from "../utils/logger.js";

/**
 * This world's Scene for one travel tier's poster map, or null when nothing has built it.
 *
 * Through `posterMapSlugOf` rather than `posterSceneFor`, and the difference matters here. That one
 * adopts a Scene by NAME alone, which is fair for the builder that is about to paint the artwork
 * onto it; this is a reader that treats the answer as a fact about the picture, because it is about
 * to place a mark at a fraction of that exact printing. A GM's own dungeon named "The Vicinity"
 * would otherwise collect site pins in whichever corner the arithmetic happened to land them.
 */
export function posterSceneForTier(tier, scenes = globalThis.game?.scenes ?? []) {
	if (!tier) return null;
	return scenes.find?.(scene => posterMapSlugOf(scene) === tier) ?? null;
}

/**
 * Where a recorded spot lands on that Scene, in the coordinates its Notes live in, or null when
 * this Scene is not the picture the fraction was measured against.
 *
 * `sceneOrigin` is the half that is easy to forget: a placeable's x/y are canvas coordinates and
 * the canvas is the scene rectangle PLUS its padding, so on a Scene a GM has since padded, a
 * fraction of the picture measured from zero lands out on the blank margin with the map untouched.
 *
 * CENTRED ON THE SPOT, with no lift. The book's own markers are teardrops and signposts, drawings
 * with a foot, so they are raised until that foot stands on the point (see `markerTipLift`). A site
 * wears the Sites tab's mound, which is not a pointer but a picture of the place itself, and the
 * walkthrough's own site pin is centred on its spot for the same reason. A mark that COVERS where
 * it stands wants no lifting.
 */
export function siteScenePoint(spot, scene) {
	const map = posterMapFor(spot?.tier);
	const tier = markedMap(spot?.tier);
	const width = Number(scene?.width);
	const height = Number(scene?.height);
	if (!map || !tier || !(width > 0) || !(height > 0)) return null;
	const frame = frameFor(map.out);
	// A frame is a claim about the shape of a particular file, and a GM who saved their own
	// differently-trimmed scan over one of the names we know has broken it without breaking
	// anything a caller could notice. Refused rather than placed wrong: a missing pin is obviously
	// missing, and a pin in the wrong valley looks finished.
	if (!frameFitsImage(frame, width / height, tier.printedAspect)) return null;
	const at = posterSpotPixels({ spot, frame, width, height });
	const origin = sceneOrigin(scene);
	return { x: origin.x + at.x, y: origin.y + at.y };
}

/** Every Note on a Scene that stands for this very site page. */
function sitePinsOn(scene, page) {
	const entryId = page?.parent?.id;
	const pageId = page?.id;
	if (!entryId || !pageId) return [];
	return [...(scene?.notes ?? [])].filter(note => note.entryId === entryId && note.pageId === pageId);
}

/**
 * Bring every regional poster Scene into line with where this site now stands: one pin on the map
 * it is on, and none on the other.
 *
 * ONE FUNCTION FOR ALL FOUR CASES, because they are one question asked of each Scene — "should this
 * site be marked here, and where?" — and answering it per Scene is what makes the awkward cases
 * fall out rather than needing code of their own:
 *
 *   placed on a map with a Scene   a pin appears
 *   moved on that same map         that pin moves; nothing is created
 *   moved to the OTHER map         a pin appears there, and the one left behind is taken off
 *   lifted off the map (no spot)   both Scenes lose it
 *
 * ONLY THE TWO REGIONAL POSTER SCENES ARE EVER TOUCHED, and on them only Notes linked to this exact
 * page. A pin the GM dragged onto a dungeon of their own is not a claim about where the site sits on
 * the Vicinity, so nothing here has any business moving it.
 *
 * EVERY matching pin on the right Scene moves, not merely the first. A site stands in one place, so
 * a second pin naming it is a second mark for one thing, and leaving one of them behind while the
 * other moves is the one outcome that could not be right.
 *
 * Best effort. This rides on the back of a placement that has already been written and reported, so
 * a Scene that refuses the write must not turn a successful placement into a failed one.
 *
 * @param {JournalEntryPage} page   the site
 * @param {object|null} spot        its map spot as `site-map-spots.js` stores it, or null for none
 * @returns {Promise<{scene: object, moved: boolean}|null>} the Scene it was marked on and whether
 *          the mark already existed, or null when nothing was marked anywhere.
 */
export async function syncSitePin(page, spot, { scenes = globalThis.game?.scenes ?? [] } = {}) {
	if (!page?.parent?.id || !globalThis.game?.user?.isGM) return null;
	// A travel tier and its poster map share one slug for the two regional maps, which is what lets
	// a spot recorded by the walkthrough name a Scene at all. `posterMapFor` is what would answer
	// null if that ever stopped being true, and `siteScenePoint` refuses on it.
	//
	// ONE PASS over the collection for both tiers. Asking `posterSceneForTier` per tier walks every
	// Scene in the world twice, reading a flag and searching the poster catalogue for each — and
	// the common case is two tiers over a world with a good many Scenes in it.
	const byTier = new Map();
	for (const scene of scenes) {
		const slug = posterMapSlugOf(scene);
		if (slug && !byTier.has(slug)) byTier.set(slug, scene);
	}

	// What each Scene needs doing, decided before anything is written. The two writes a move costs
	// — the pin off the map it left, the pin onto the map it arrived on — are independent documents
	// on independent Scenes, so they go together rather than one after the other.
	const writes = [];
	for (const map of TRAVEL_MAPS) {
		const scene = byTier.get(map.slug);
		if (!scene) continue;
		const pins = sitePinsOn(scene, page);
		// Not this site's map any more, or not any map at all: the mark comes off.
		const point = map.slug === spot?.tier ? siteScenePoint(spot, scene) : null;
		if (!point) {
			if (pins.length) writes.push({ scene, verb: "delete", payload: pins.map(note => note.id) });
		} else if (pins.length) {
			writes.push({
				scene, verb: "update", moved: true,
				payload: pins.map(note => ({ _id: note.id, ...point })),
			});
		} else {
			// The position and the link, and nothing else: what a prep pin LOOKS like is the
			// `preCreateNote` seam's, so a pin laid here matches one the GM dragged on themselves.
			writes.push({
				scene, verb: "create", moved: false,
				payload: [{ entryId: page.parent.id, pageId: page.id, ...point }],
			});
		}
	}

	const done = await Promise.all(writes.map(w => wrote(w.scene, w.verb, w.payload)));
	// Only a write that PUT the pin somewhere answers the caller, and only if the Scene took it:
	// the notification is worded from this, so a refused write must not claim a mark.
	const put = writes.findIndex((w, i) => w.moved !== undefined && done[i]);
	return put < 0 ? null : { scene: writes[put].scene, moved: writes[put].moved };
}

/**
 * One embedded-Note write, reported rather than thrown.
 *
 * This whole pass rides on the back of a placement that has already been written to the site and
 * reported to the GM, so a Scene that refuses must not turn a successful placement into a failed
 * one. What it must not do either is claim a pin that is not there: the caller's answer is what the
 * notification is worded from, so a refused write has to come back false.
 */
async function wrote(scene, verb, payload) {
	try {
		// The verb IS the method: "create" / "update" / "delete" name the three
		// `*EmbeddedDocuments` calls exactly, so a table mapping one to the other would only be a
		// second place for the two to come apart.
		await scene[`${verb}EmbeddedDocuments`]("Note", payload);
		return true;
	} catch (err) {
		warn(`couldn't ${verb} a site pin on a scene`, err);
		return false;
	}
}
