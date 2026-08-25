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
import { TRAVEL_MAPS, frameFitsImage, frameFor, markedMap, percentSpot } from "../data/travel-times.js";
import { posterSpotPixels } from "../utils/map-pins.js";
import { warn } from "../utils/logger.js";
import { listSitePages, sitePageById } from "./site-store.js";
import { siteMapSpot, setSiteMapSpot } from "./site-map-spots.js";

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

/**
 * The other direction: a point on the Scene back to the fraction of the PRINTED crop it stands on.
 *
 * The inverse of `siteScenePoint`, through the same frame and the same origin. `percentSpot` is
 * declared as the inverse of `spotPercent` and rounds to the precision marks are stored at.
 *
 * INVERSE IN PIXELS, NOT IN FRACTIONS, and the difference is worth stating because it looks like a
 * bug and is not. `siteScenePoint` rounds to a whole pixel, and one pixel of a 4000px poster is
 * 0.00025 of it — coarser than the 0.0001 a mark is stored at. So a spot converted out and back
 * can differ in its last digit, and the round trip is only exact once the answer is put back
 * through `siteScenePoint`: the fraction that comes back always lands on the very pixel it was
 * read from. That is the property that matters here, because it is what stops a pin from drifting
 * — the flag this writes and the pin the flag draws agree, so nothing walks on a re-sync.
 *
 * Refused on the same terms the forward conversion is refused on: a Scene whose picture is not the
 * shape the fractions were measured against cannot say where anything on it stands, in either
 * direction.
 *
 * @returns {{tier: string, fx: number, fy: number}|null}
 */
export function siteSpotFromScenePoint(point, scene, tier) {
	const map = posterMapFor(tier);
	const marked = markedMap(tier);
	const width = Number(scene?.width);
	const height = Number(scene?.height);
	if (!map || !marked || !(width > 0) || !(height > 0)) return null;
	if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
	const frame = frameFor(map.out);
	if (!frameFitsImage(frame, width / height, marked.printedAspect)) return null;
	const origin = sceneOrigin(scene);
	const at = percentSpot({
		left: ((point.x - origin.x) / width) * 100,
		top: ((point.y - origin.y) / height) * 100,
	}, frame);
	return { tier: marked.slug, ...at };
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
	let refused = false;
	for (const map of TRAVEL_MAPS) {
		const scene = byTier.get(map.slug);
		if (!scene) continue;
		const pins = sitePinsOn(scene, page);
		const mine = map.slug === spot?.tier;
		const point = mine ? siteScenePoint(spot, scene) : null;
		// THIS SITE'S MAP, BUT NOT A SCENE THAT CAN SAY WHERE. `siteScenePoint` refuses a Scene whose
		// picture is not the shape the fractions were measured against — a GM who nudged the Scene's
		// dimensions past `frameFitsImage`'s tolerance, say. That is a refusal, and a refusal leaves
		// what is there alone: taking the pin off would delete a mark the GM put on the table's map
		// over a Scene setting that has nothing to do with where the site stands. A missing pin is
		// obviously missing; a pin silently removed while the placement is announced is not.
		if (mine && !point) {
			refused = true;
			continue;
		}
		// Not this site's map any more, or not any map at all: the mark comes off.
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
	// A Scene that could not take the mark is REPORTED rather than folded into "no Scene at all".
	// Those read the same from here — no pin was laid — but they are different things to be told:
	// one world has no map to mark, the other has one this system will not measure against, and
	// only the second is something the GM can go and put right.
	if (put < 0) return refused ? { scene: null, moved: false, refused: true } : null;
	return { scene: writes[put].scene, moved: writes[put].moved, refused: false };
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

/**
 * `updateNote` hook: a site pin the GM dragged writes where it landed back onto the site.
 *
 * THE OTHER DIRECTION OF THE SAME FACT, and its absence was the one thing this module got wrong.
 * A spot was pushed OUT to the Scene and never read back, while the pin was deliberately made
 * "indistinguishable from one the GM dragged on by hand" -- so dragging it was the obvious gesture
 * and the only one that did not work. The walkthrough's map and the table's map then disagreed
 * about where the Sunken Barrow stands, with nothing on screen saying which was right, until the
 * next placement snapped the Note back and threw the drag away.
 *
 * MOVES ONLY. A Note is written for a dozen reasons -- its icon, its label, its fog setting -- and
 * a write-back on any of them would rewrite the flag with the position it already had, and echo.
 *
 * GM-ONLY and best effort: this rides on a write core has already accepted, so a refusal here must
 * not fail the drag. It leaves the two maps disagreeing, which the next placement corrects.
 */
export async function onUpdateSiteNote(note, changes) {
	if (!globalThis.game?.user?.isGM) return;
	if (changes?.x === undefined && changes?.y === undefined) return;

	const scene = note?.parent;
	const tier = posterMapSlugOf(scene);
	if (!tier) return;

	// A SITE page, not a threat's pin, a hazard's, or one of the book's own lettered discs. The
	// site store's own resolver is what says: `gmPrepPageById` would answer for any of the three
	// kinds, and writing a threat's drag into a site's flag is worse than not writing it at all.
	const page = sitePageById(note.entryId, note.pageId);
	if (!page) return;

	const at = siteSpotFromScenePoint({ x: note.x, y: note.y }, scene, tier);
	if (!at) return;
	// Already saying this, to the precision a spot is stored at: a drag that rounds back to where
	// the site already stands is not news, and writing it would re-render the walkthrough for
	// nothing.
	const now = siteMapSpot(page);
	if (now && now.tier === at.tier && now.fx === at.fx && now.fy === at.fy) return;

	try { await setSiteMapSpot(page, at); }
	catch (err) { warn("couldn't write a dragged site pin back to its site", err); }
}


/**
 * Put every placed site back on the table's maps.
 *
 * FOR THE WORLD THAT GAINED ITS SCENES LATER, which is an ordinary order to do things in: writing
 * sites up and pinning them on the walkthrough's map needs no Scene at all, and `placeSiteOnMap`
 * has a message for exactly that world. Import the book art afterwards and the poster Scenes are
 * built with the book's own place markers laid on them by `markPosterMapScenes` -- and not one of
 * the GM's sites, because `syncSitePin` only ever ran from a placement. The cards went on saying
 * "already on The Vicinity" while the map the table plays on had nothing, and the only fix was to
 * lift and re-place every site by hand.
 *
 * Idempotent by construction -- it asks the same question `syncSitePin` always asks, and a site
 * already pinned where it belongs is an update to the position it already has.
 *
 * @returns {Promise<number>} how many sites were marked or moved.
 */
export async function reconcileSitePins(steading) {
	if (!steading || !globalThis.game?.user?.isGM) return 0;
	let marked = 0;
	for (const page of listSitePages(steading)) {
		const spot = siteMapSpot(page);
		if (!spot) continue;
		const answer = await syncSitePin(page, spot);
		if (answer?.scene) marked += 1;
	}
	return marked;
}
