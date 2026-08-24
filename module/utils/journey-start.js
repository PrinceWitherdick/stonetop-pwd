// Where a journey SETS OUT FROM, which is three things wearing one name.
//
// WHY THIS EXISTS. The trip's far end has always been able to be anywhere: a way laid out by hand
// (utils/custom-route.js) ends wherever the GM last clicked, and the bare mark it ends on is priced
// off the map rather than out of the table. The near end could not. It was a slug and only a slug,
// one of the eighteen places the books letter, chosen from a dropdown — so a party camped in the
// Flats, or setting out from the barrow they cleared last session, had to claim they were leaving
// Stonetop. This is what makes the two ends the same kind of thing.
//
// TWO SHAPES, AND AT MOST ONE OF THEM PER TRIP. A slug names a place the travel table knows and
// stores no position, so a correction to that place's coordinates reaches a trip planned last
// season; a `{ tier, fx, fy }` mark is a fraction of ONE printed map and carries its own. That is
// the same pair `normalizeMark` reads for the points of a drawn way, and it is deliberately the
// same pair: a start and a stop are the same kind of fact about a journey.
//
// AND THE THIRD IS NEITHER: NOWHERE. A right-click on the route map peels the trip back a mark at
// a time, and past the last mark it takes the start away as well, so that the next click can put
// it wherever the party actually is. While that state is on the trip has no start, and every
// reader here says so rather than guessing — because the alternative, filling the gap with the
// steading, is a party silently teleported home in the one moment the GM is telling the screen
// they are not there. `hasStart` is the question, `storedStart` is what keeps an UNWRITTEN trip
// (which is most of them, and every trip planned before any of this) leaving Stonetop as it always
// has.
//
// A MARK BELONGS TO ITS MAP, ALWAYS. 0.44 means "44% of the way across the Vicinity" and means
// nothing whatever on the World's End, so a start laid by hand carries the tier it was laid on and
// every map question about it answers for that tier alone. That is not a limitation to work
// around; it is what a hand-placed mark IS.
//
// PURE ON PURPOSE, like the three modules it sits beside: no Foundry globals, so the Chronicle
// compiler can print where a trip set out from with nothing but the stored value in hand. It
// depends on the frozen table and nothing else, which is what lets `route-path.js`,
// `custom-route.js` and `travel-route.js` all import it without a cycle between them.

import { homePlace, isFraction, roundMark, travelMap, travelPlace } from "../data/travel-times.js";
/**
 * A start that is neither a place nor a mark: nobody has said where the party is.
 *
 * Frozen and shared rather than built per call, because it is the answer to every read of a trip
 * whose start has been peeled off, on every render of the route step — and because a caller that
 * mutated it would be changing what "nowhere" means for the rest of the session.
 */
const NOWHERE = Object.freeze({ slug: null, tier: null, fx: null, fy: null });

/**
 * A stored start read back as something the rest of the system can trust.
 *
 * ONE definition, for the same reason `normalizeJourney` and `normalizeCustom` are each one: the
 * walkthrough draws from it, the popout draws from it, the Scene paints from it and the Chronicle
 * prints from it, and five readings of "where does this trip start?" would come apart at the first
 * half-written value.
 *
 * IDEMPOTENT, and every function below leans on that: they all take "a start" and normalize it
 * themselves rather than insisting on an already-clean one, so a caller holding a raw stored value
 * and a caller holding a normalized one can use the same function.
 *
 * ACCEPTS THE BARE SLUG, which is not tolerance of a legacy shape so much as the storage the
 * common case still uses: a trip setting out from Stonetop stores the string "stonetop", exactly as
 * it always has, and nothing about the file on disk changes for the great majority of trips.
 *
 * NOWHERE IS A REAL ANSWER, and it is the one thing here that is not about storage. A right-click
 * on the map peels the trip back a mark at a time, and past the last mark it takes the start away
 * too — so that the next click can put it wherever the party actually is (see ExpeditionDialog
 * `_undoJourneyMark`). While that state is on there is no green pin, no line and no solved time,
 * because there is genuinely no journey yet, and every reader below answers accordingly: `startEnd`
 * is null, `startName` has no name to give, `solveFrom` has nowhere to solve from.
 *
 * WHICH IS NOT THE SAME AS AN UNWRITTEN TRIP, and `storedStart` is where those two part company.
 * A trip that has never been told where it sets out from leaves Stonetop, exactly as it always
 * did; only a start somebody deliberately took away is nowhere.
 */
export function normalizeStart(origin) {
	// A place the table letters, however it was written down: a bare slug is what a trip planned
	// before hand-placed starts existed holds, and `{ slug }` is what one written through
	// `startEnd` holds when the GM picked a pin.
	const place = travelPlace(typeof origin === "string" ? origin : origin?.slug);
	if (place) return { slug: place.slug, tier: null, fx: null, fy: null };

	// A mark the GM put down. Both halves are required, and so is the map: a fraction with no
	// picture to be a fraction OF is not a position, and honouring one would put the start
	// wherever the reader happened to be looking.
	const tier = travelMap(origin?.tier)?.slug ?? null;
	if (tier && isFraction(origin?.fx) && isFraction(origin?.fy)) {
		return {
			slug: null, tier,
			fx: roundMark(origin.fx),
			fy: roundMark(origin.fy),
		};
	}

	return NOWHERE;
}

/**
 * Has anybody said where they set out from?
 *
 * THE ONE TEST, because five surfaces ask it and they have to agree: the map decides whether to
 * draw a pin, the drawing watch decides whether the next click lays a leg or plants the start, the
 * readout decides whether there is a journey to describe, the list decides whether its times mean
 * anything, and the right-click ladder decides whether there is anything left to peel back.
 *
 * Takes a start OR a raw stored value, like everything else here, so a caller holding either can
 * ask without knowing which.
 */
export function hasStart(start) {
	const at = normalizeStart(start);
	return !!(at.slug || at.tier);
}

/**
 * What a TRIP's stored `origin` means, which is the one reading that has to know about absence.
 *
 * TAKEN AWAY IS NOWHERE; EVERYTHING ELSE UNREADABLE IS HOME. Those are two different facts wearing
 * very similar shapes, and this is the only place in the system that tells them apart.
 *
 * An explicit stored `null` is the one thing that means nowhere, because it is the one thing only
 * the last rung of the right-click ladder writes (ExpeditionDialog `_undoJourneyMark`). A trip that
 * has never been asked holds no `origin` at all; one holding a slug the table has never heard of
 * holds a typo, or a place a later edition dropped. Neither of those is somebody saying "the party
 * is nowhere", and reading them that way would take the route off a trip planned last season
 * because of a spelling — so both still leave the steading, exactly as they always have.
 *
 * `normalizeJourney` is the sole caller, deliberately: every other reader takes the start it hands
 * back, so there is exactly one place the default is applied and no way for two readers of one
 * trip to disagree about whether it has a start.
 */
export function storedStart(origin) {
	if (origin === null) return normalizeStart(null);
	const at = normalizeStart(origin);
	return hasStart(at) ? at : normalizeStart(homePlace().slug);
}

/** The bare mark a trip sets out from, or null when it sets out from a place — or from nowhere. */
export function startMark(start) {
	const at = normalizeStart(start);
	return at.tier ? { fx: at.fx, fy: at.fy } : null;
}

/** Which map a hand-placed start belongs to, or null for a place (which belongs to no one map). */
export function startTier(start) {
	return normalizeStart(start).tier;
}

/**
 * What to call it: the place's own name, or the map the mark stands on.
 *
 * PLAIN ENGLISH IN A PURE MODULE, as `customStops` already writes "point 2" in plain English and
 * for the same reason: this name goes into a leg of a route, and a route is read by the panel, the
 * popout, the Scene's own message and the Chronicle's paragraph alike. A name that only one of
 * those could resolve would be four different sentences about one journey.
 *
 * IT NAMES THE MAP RATHER THAN THE FRACTION. "a point on The Vicinity" is what a GM can picture;
 * "0.4412, 0.6180" is a fact about a file. The picture is where the precision lives, and the pin
 * standing on it is what says exactly where.
 *
 * NULL FOR A START NOBODY HAS SET, and the callers word that for themselves. There is no honest
 * name for it — inventing one ("nowhere", "unset") would put a placeholder into a route leg, a
 * Scene message and a Chronicle paragraph, which is the very thing the home fallback used to do.
 */
export function startName(start) {
	const at = normalizeStart(start);
	if (at.slug) return travelPlace(at.slug)?.name ?? at.slug;
	if (!at.tier) return null;
	return `a point on ${travelMap(at.tier)?.name ?? "the map"}`;
}

/**
 * The start reduced to the ONE value that stands for it: a slug, or the bare mark.
 *
 * BOTH THE STORED FORM AND THE MAP-QUESTION FORM, and that is on purpose rather than a coincidence
 * worth splitting into two functions. `drawnOn`, `tierDraws` and `tierDrawingEnds` all take an
 * "end" that is either a place or a mark; a journey's start is exactly such an end; and what those
 * questions need is exactly what the trip needs written down. Keeping it one value is what makes a
 * start round-trip through `normalizeStart` unchanged, which is what stops a trip's start from
 * drifting a decimal place every time it is read and written back.
 *
 * AND NULL IS ITSELF SUCH A VALUE, twice over. A start nobody has set is nothing to draw, which is
 * exactly what `drawnOn` and `tierDraws` already read a null end as; and it is what the trip stores
 * for a start peeled off with a right-click, which `storedStart` reads back as nowhere. So the
 * round trip holds for the empty state as well as for the two full ones.
 */
export function startEnd(start) {
	const at = normalizeStart(start);
	if (!at.slug && !at.tier) return null;
	return at.slug ?? { tier: at.tier, fx: at.fx, fy: at.fy };
}

/**
 * A stable string for one start, for the keys that compare two trips.
 *
 * Not for reading. `journeyKey` is what decides whether the Scene in front of the table is already
 * showing the journey being planned, and two starts that are the same point have to key the same
 * however they were written down.
 *
 * A start nobody has set keys as the empty string, which is a key like any other and not a
 * refusal: it has to differ from every real start, and it has to equal itself, so that a Scene
 * showing a journey from Stonetop is not mistaken for one whose start has just been peeled off.
 */
export function startKey(start) {
	const at = normalizeStart(start);
	if (!at.slug && !at.tier) return "";
	return at.slug ?? `${at.tier}@${at.fx},${at.fy}`;
}
