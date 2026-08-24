// The named-place markers the poster maps wear, and the visibility contract every map pin this
// system lays down shares.
//
// WHY THIS EXISTS AT ALL. The village, the Vicinity and the World's End ship as POSTER art, and
// the poster printing of all three is the UNLABELLED one: beautiful hand-drawn hills and wood
// and river, and not one word of type anywhere on it. The same artwork is printed labelled in
// the books, which is where module/data/travel-times.js got the position of every named place
// from in the first place — it read the labels' own centres out of the PDF's text layer. So the
// system already knows, to a fraction of a percent, where each name belongs on a map that is
// missing all of them. These pins put them back.
//
// That is also why the name is ALWAYS SHOWN. The village map carries lettered discs as well,
// against a list on the steading sheet, and those hide their name until hovered: the disc is an
// index, the hover is the lookup, and eighteen names printed over a village that already prints
// its own would be noise. A marker is not an index into anything. It is the label the printing
// left out, and a label you have to go hunting for with a mouse is not a label.
//
// The positions are NOT a second copy of anything. `travel-times.js` is the single source of
// truth for where a place sits on these two maps, because the Run an Expedition walkthrough's
// travel maps are already tapping exactly these spots; this module only converts a spot into a
// Scene coordinate and dresses it as a Note.

import { SYSTEM_ID } from "../system-id.js";
import { systemAssetVariants } from "../migration/compat.js";
import {
	captionsOnMap, exitsOnMap, frameFitsImage, frameFor, markedMap, placeMapLabel, placesOnMap,
	spotPercent, travelPlace,
} from "../data/travel-times.js";

/**
 * The two fields that make a Note part of the MAP rather than somebody's private annotation.
 * Authored once because every pin this system places needs both, the reasoning behind them is
 * long, and getting either wrong fails silently and invisibly — in the literal sense that the
 * whole map's pins vanish for every player and nobody at the table sees an error.
 *
 * `global` waives line of sight. Our poster-map Scenes ship with token vision off, where core
 * skips the sight test entirely, but a GM who turns vision on for one of these maps would
 * otherwise have every pin hide behind unexplored fog.
 *
 * `author` decides who a pin with no journal entry behind it belongs to. Foundry 14 made such a
 * note visible only to its author, falling back for everyone else to "nobody wrote it, or a
 * player did" — so a pin laid down by a GM is GM-only, and `global` never even gets consulted.
 * Nulling the author is core's own way of saying this pin is part of the map rather than
 * someone's note, which is exactly what it is.
 *
 * Safe from either side: the server rewrites this to the creating user's id for a player, which
 * lands on the other half of that same fallback and is just as visible, and v13 has no `author`
 * field at all, so it drops the key without complaint.
 */
export const PUBLIC_MAP_PIN = Object.freeze({ global: true, author: null });

/**
 * The marker glyph, authored once. StonetopNoteLabels recognises the pins that label themselves
 * permanently by this exact path, so the writer and the reader cannot drift apart.
 *
 * It lives in the `landmarks` folder beside the lettered discs deliberately: everything that
 * claims "a pin of ours" does so on that folder prefix, so a marker inherits the cream-on-ink
 * label treatment and the public-visibility repair without either having to learn a second path.
 * Nothing that keys on a LETTER picks it up, because `landmarkLetterOf` matches
 * `landmark-<a-r>.svg` and this is not one.
 */
export const PLACE_MARKER_ICON_SUFFIX = "assets/icons/landmarks/place-marker.svg";

/**
 * And the glyph for the other kind of caption these maps carry: the edge-of-page arrows, which
 * do not mark a place at all. They say the road goes on, off this paper, towards somewhere drawn
 * on the next map out.
 *
 * A signpost rather than a second teardrop because the two mean opposite things. A pin says the
 * thing you want is HERE; an arrow says it is emphatically NOT here and this is the way to it.
 * Drawing both the same would make the Vicinity look like it contains Gordin's Delve.
 */
export const PLACE_EXIT_ICON_SUFFIX = "assets/icons/landmarks/place-exit.svg";

/**
 * And the glyph for MOUNTAINS, which the World's End map is largely made of: the two ranges it
 * letters names across, and the two places on it that are themselves mountain.
 *
 * A terrain symbol rather than a third kind of pin. What separates it from the teardrop is not
 * size but what the mark CLAIMS: a teardrop says "here", which is true of a settlement and true
 * nowhere along a range, while a drawing of peaks says "mountains", which is true of the whole
 * arc the Whitefang Mountains' name is lettered on. That is why this one glyph serves a caption
 * naming country and a place standing in it, and why the sibling for a wood or a road is blank.
 */
export const PLACE_PEAK_ICON_SUFFIX = "assets/icons/landmarks/place-peak.svg";

/**
 * And the non-glyph for a REGION or a ROAD, which is a caption naming country rather than a
 * point on it. A pin on the Great Wood would claim the wood is somewhere you can stand in the
 * middle of; the file it points at is deliberately blank, so the name lies over the country and
 * nothing points anywhere. See the file's own comment.
 */
export const PLACE_REGION_ICON_SUFFIX = "assets/icons/landmarks/place-region.svg";

/**
 * The four drawings, and the one number each needs that the others cannot supply: where its ink
 * STANDS inside its own box.
 *
 * `tipVertex` is read straight off the path in the file named beside it, and is the lowest
 * VERTEX rather than the lowest ink: the stroke is centred on the path and joined round, so half
 * of it hangs below, which `markerTipLift` adds back. The teardrop stands on its point, the
 * signpost on the foot of its post and the range on its own foothills, and all three are checked
 * against the shipped file by tests/utils/map-pins.test.js so none can drift from the art.
 *
 * `stroke` is per file rather than shared because the peaks are drawn 473 of 512 wide with five
 * inner folds in them where the other two are single silhouettes drawn barely half that, so the
 * weight that reads as one clean pen differs. It matters here only because half of it is the
 * difference between the lowest vertex and the lowest ink.
 *
 * A KIND IS A DRAWING, NOT AN IDENTITY. Nothing here decides what a pin IS: `place` and `peak`
 * are both worn by places, and `peak` and `region` are both worn by captions. That separation is
 * the point, because a pin's key has to survive its drawing changing on a map a table already
 * has open. See `markerPinKey`.
 */
const MARKER_KINDS = Object.freeze({
	place: Object.freeze({ suffix: PLACE_MARKER_ICON_SUFFIX, tipVertex: 494.892, stroke: 20, anchor: "BOTTOM" }),
	exit: Object.freeze({ suffix: PLACE_EXIT_ICON_SUFFIX, tipVertex: 486.4, stroke: 20, anchor: "BOTTOM" }),
	peak: Object.freeze({ suffix: PLACE_PEAK_ICON_SUFFIX, tipVertex: 452.08, stroke: 14, anchor: "BOTTOM" }),
	// A caption has no drawing and therefore no foot to stand on, so it is not lifted at all and
	// its name is CENTRED: the spot recorded for it is where the printed map set the words
	// themselves, not a thing the words are labelling.
	region: Object.freeze({ suffix: PLACE_REGION_ICON_SUFFIX, tipVertex: null, stroke: 0, anchor: "CENTER" }),
});

/** Every drawing is set in the same square, so the outline maths is shared. */
const MARKER_VIEWBOX = 512;

/** One drawing’s row, falling back to the teardrop for a kind nothing has declared. */
const kindSpec = (kind) => MARKER_KINDS[kind] ?? MARKER_KINDS.place;

/** Every spelling of both paths this package has shipped under, for recognising an old pin. */
const _MARKER_ICONS = Object.values(MARKER_KINDS).flatMap(k => systemAssetVariants(k.suffix));

/**
 * The size EVERY map pin this system draws is set at, markers and lettered discs alike, with the
 * label size below it.
 *
 * Small on purpose. These maps carry up to eighteen names that are all on screen at once and
 * never turn off, and at the 90px the discs first shipped at they stopped being labels on a
 * drawing and became a layer over it, which is the failure this whole feature exists to avoid in
 * the other direction.
 *
 * One number rather than one per family, and exported for hooks/PlaceOfInterestDrop.js to read
 * rather than written out again there. The village map is the reason: it carries the lettered
 * discs AND the six captions its printing letters, inches apart, so two sizes on one drawing
 * reads as an accident rather than a distinction.
 */
export const MAP_PIN_ICON_SIZE = 70;

/** And the label size, on the same terms. */
export const MAP_PIN_FONT_SIZE = 45;

/**
 * And the ink and the tint, on the same terms and for the same reason. The lettered discs are
 * written in exactly this brown over exactly this tint, so a second copy of either is the pair
 * drifting apart the next time one of them moves.
 */
export const MAP_PIN_TEXT_COLOR = "#1b1009";
export const MAP_PIN_TINT = "#ffffff";

/**
 * One colour written as the one string a comparison can be made on.
 *
 * WHY THIS HAD TO EXIST, and it is not a tidying. A Note's `textColor` and its `texture.tint` are
 * ColorFields, and v13's `ColorField#initialize` hands back a `Color` — a subclass of Number —
 * rather than the "#rrggbb" string its `_source` holds and every writer in this system declares.
 * So `note.textColor !== MAP_PIN_TEXT_COLOR` is ALWAYS true, whatever the pin is actually wearing.
 * Every refit pass here promises to be silent once the pins agree, and that promise is what makes
 * it safe to run one on every world load; compared this way it instead rewrites every pin on every
 * map, on every load, for every GM, and the "did the GM touch this?" tests downstream of it never
 * get to run.
 *
 * Tolerant of the shapes the tests build as well as the ones Foundry hands over: a plain string, a
 * bare 0xrrggbb number, a Color, and nothing at all.
 */
export function colorKey(value) {
	if (value === null || value === undefined) return "";
	// A `Color` is a Number OBJECT, so this arm catches it and any bare number alike. A hex string
	// is not a string this arm sees, so "" cannot be read as black.
	if (typeof value !== "string") {
		const n = Number(value);
		return Number.isFinite(n) ? `#${(Math.trunc(n) >>> 0).toString(16).padStart(6, "0")}` : "";
	}
	const text = value.trim().toLowerCase();
	// "#abc" and "#aabbcc" are one colour. Core writes only the long form, so this arm is for a pin
	// hand-edited to the short one, which should be left alone rather than rewritten every load.
	return /^#[0-9a-f]{3}$/.test(text) ? `#${[...text.slice(1)].map(c => c + c).join("")}` : text;
}

/** Do these two spellings of a colour mean the same colour? */
export const sameColor = (a, b) => colorKey(a) === colorKey(b);

/**
 * How far above its recorded spot a marker's note sits, so the drawing STANDS on that spot.
 *
 * This exists because core centres a note's icon on the note's position — `Note#_drawControlIcon`
 * does `icon.x -= iconSize / 2; icon.y -= iconSize / 2` — which is the right anchor for a disc and
 * the wrong one for anything that has a foot. A pin means the place it is pointing at, so a
 * marker whose middle is on the spot is a marker whose point is half a pin below it, hanging
 * under the valley it is supposed to be naming. Lifting the note by the difference sets it down,
 * and because core hangs the label a fixed distance under the NOTE rather than under the ink, it
 * also drops the name into very nearly the place the printed map set it.
 *
 * The stroke is half the calculation, not a rounding detail. It is centred on the path and joined
 * round, so the lowest ink a reader sees is half a stroke below the lowest vertex. Taking the
 * vertex alone puts every pin more than a pixel high at the size these ship at, and proportionally
 * further at any larger one.
 */
export function markerTipLift(kind = "place") {
	const { tipVertex, stroke } = kindSpec(kind);
	// Nothing to stand up: a caption is centred on its spot, which is where its words already are.
	if (tipVertex === null) return 0;
	return Math.round(((tipVertex + stroke / 2) / MARKER_VIEWBOX - 0.5) * MAP_PIN_ICON_SIZE);
}

/**
 * Where a pin's name sits relative to the pin, as core's own anchor-point number.
 *
 * Hung BELOW anything with a drawing, so the drawing keeps the spot and the name reads under it
 * the way a caption reads under a picture. CENTRED on a region, whose "pin" is blank and whose
 * spot is the words' own position on the printed page: there is nothing for the name to be below.
 */
export function markerTextAnchor(kind = "place") {
	const { anchor } = kindSpec(kind);
	const points = CONST.TEXT_ANCHOR_POINTS ?? {};
	return points[anchor] ?? (anchor === "CENTER" ? 0 : 1);
}

/**
 * Does this poster map carry named-place markers at all?
 *
 * True for exactly the maps this system has recorded label positions for, which is the two
 * regional ones and the village. The two town maps have no recorded positions for anything.
 *
 * The village map already carries the lettered discs, and these do not replace them: a disc is an
 * INDEX into the steading sheet's list of places, which is why it shows a letter and hides its
 * name until hovered. These are the names the poster printing left out, which is a different job,
 * and the two are drawn differently enough not to be read as one set.
 */
export function mapHasMarkers(map) {
	return !!markedMap(map?.slug);
}

/** The full path to one family's glyph, resolved against the installed package id. */
export function placeMarkerIcon(kind = "place") {
	return `systems/${SYSTEM_ID}/${kindSpec(kind).suffix}`;
}

/**
 * True when this Note document is one of our always-labelled regional markers, whichever of the
 * drawings it happens to be wearing.
 *
 * One predicate for all of them on purpose. Everything that reads this is asking the same question
 * about every one: does this pin wear its name permanently (StonetopNoteLabels), and is this pin
 * already on the map (the poster builder's dedupe). An arrow is as much a label the printing left
 * out as a place is, and so is a blank caption.
 *
 * It reads MARKER_KINDS rather than a list of its own, so adding a drawing cannot leave a whole
 * family of pins failing to recognise themselves next load.
 */
export function isPlaceMarkerNote(noteDoc) {
	const src = noteDoc?.texture?.src;
	if (!src) return false;
	return _MARKER_ICONS.some(path => String(src).includes(path));
}

/**
 * The Note payload EVERY map pin this system lays down shares, whichever family it belongs to.
 *
 * Authored once because the two families differ in three fields and agree in nine, and the nine
 * are the ones that decide whether a pin is legible, whether it is the right size beside its
 * neighbour, and whether the players can see it at all. A second copy of them is nine more
 * chances for the village map to end up carrying two subtly different sorts of pin.
 *
 * What a caller still chooses is what actually distinguishes them: the `icon` it wears, where its
 * name hangs (`textAnchor`), and whether it names a page as well as an entry.
 */
export function mapPinNoteData({ x, y, name, icon, textAnchor, entryId = null, pageId = null }) {
	return {
		x, y,
		entryId,
		pageId,
		texture: {
			src: icon,
			anchorX: 0.5,
			anchorY: 0.5,
			fit: "contain",
			tint: MAP_PIN_TINT,
		},
		iconSize: MAP_PIN_ICON_SIZE,
		text: String(name ?? "").trim(),
		fontSize: MAP_PIN_FONT_SIZE,
		textAnchor,
		textColor: MAP_PIN_TEXT_COLOR,
		...PUBLIC_MAP_PIN,
	};
}

/**
 * The READER half of PUBLIC_MAP_PIN: which of the pair this note is missing, or an empty object
 * when it already carries both.
 *
 * Beside the constant it checks, because the two are one rule. Every pass that repairs an old pin
 * asks exactly this question, and a copy of it that drifts from what the writer writes is a pin
 * that goes GM-only on Foundry 14 with nothing on screen to say so.
 */
export function publicPinDrift(note) {
	const change = {};
	if (note?.global !== true) change.global = true;
	// `_source.author` rather than the resolved author, which is a User document, and is simply
	// absent on v13 where the field does not exist and no pin needs re-owning.
	if ((note?._source?.author ?? null) !== null) change.author = null;
	return change;
}

/**
 * The Note payload for one named-place marker at scene coordinates `x`/`y`.
 *
 * The single writer of this shape, for the same reason `landmarkNoteData` is: a marker has to be
 * recognisable by its icon alone, because that is how both the label styling and the "show these
 * to the players" repair find it, and a second place that builds one slightly differently is a
 * pin that quietly opts out of both.
 *
 * `entryId` points the pin at the book's write-up of the place, so clicking it opens what
 * Stonetop knows about there. It is OPTIONAL and defaults to an unlinked pin, because linking is
 * not free: core decides a note's visibility by testing the reader against what it links to, so a
 * pin linked to an entry a player cannot see is a pin that is gone from their map, name and all.
 * utils/gazetteer-notes.js is the only thing that should be resolving one, and it opens the entry
 * to players before it hands the id over. A label that opens nothing still beats no label.
 *
 * `pageId` is deliberately never set even though every gazetteer entry has exactly one page.
 * Core tests `page ?? entry` for that visibility gate, so naming the page would move the decision
 * onto a document whose ownership is INHERIT and away from the entry we actually opened up.
 */
export function placeMarkerNoteData({ x, y, name, entryId = null, kind = "place" }) {
	return mapPinNoteData({
		x, y, name, entryId,
		icon: placeMarkerIcon(kind),
		textAnchor: markerTextAnchor(kind),
	});
}

/**
 * The flag value stamping one marker, so re-running the poster-map build recognises the pin it
 * already placed. Namespaced away from the village map's letter keys ("f-2"), which share the
 * same flag, because both are laid on different Scenes by the same code and a bare slug could one
 * day collide with a letter. And namespaced by family, because the Vicinity carries an arrow TO
 * Gordin's Delve while the World's End carries the place itself.
 *
 * IT TAKES THE FAMILY, NOT THE DRAWING, and those are two different things: a place is a place
 * whether it is drawn as a teardrop or as a range of mountains. This key is a pin's IDENTITY, and
 * identity is exactly what a reconcile needs to hold still while the design moves. Keying on the
 * glyph would mean that re-drawing Tor's Fist as a mountain made it, as far as the next pass could
 * tell, a different pin: one to create and one that had vanished, which is two markers standing on
 * one place on every map that already had it.
 */
export function markerPinKey(slug, family = "place") {
	return family === "place" ? `marker:${slug}` : `marker:${family}:${slug}`;
}

/**
 * One canonical map fraction as a point in a poster Scene's own pixels.
 *
 * THE ONE ARITHMETIC, and it is shared on purpose. Two quite different things land marks on these
 * Scenes — the book's own place markers below, and the GM's site pins (module/sites/site-scene-pins.js)
 * — and both are converting the same kind of number: a fraction of the PRINTED PAGE crop, which is
 * not the same rectangle as the poster scan. A second copy of this would be the two families of pin
 * standing in slightly different valleys on one picture, which is exactly the failure the fractions
 * exist to prevent.
 *
 * `frame` is the caller's, resolved once with `frameFor` and checked once with `frameFitsImage`,
 * because what to DO about a Scene that is not the shape the fractions were measured against
 * differs: the marker builder draws no pins at all, while a site placement says so out loud.
 *
 * The result is the point the fraction names, and nothing about how a drawing sits on it. A pin
 * with a foot wants lifting off it (see `markerTipLift`); a mark that covers its spot does not.
 */
export function posterSpotPixels({ spot, frame, width, height }) {
	const { left, top } = spotPercent(spot, frame);
	return {
		x: Math.round((left / 100) * width),
		y: Math.round((top / 100) * height),
	};
}

/**
 * Every named-place marker one poster map should carry, as `{ key, slug, name, x, y }` in Scene
 * pixels, ready to be dressed by `placeMarkerNoteData`.
 *
 * Pure, so the arithmetic can be checked without a browser or a picture.
 *
 * THE ARITHMETIC. A place's `spots` fraction is measured against the PRINTED PAGE CROP, which is
 * not the same rectangle as the poster scan: the printed maps are 1.384 and 1.223 wide-to-tall
 * and both posters are 1.273, so the printed page sits inset inside the poster with margin above
 * and below. `frameFor` returns that inset for the file this Scene is built from and
 * `spotPercent` composes the two, which is the same pair the travel-map window already uses to
 * put its hotspots on whichever copy of the map a world happens to have.
 *
 * REFUSED RATHER THAN DRAWN WRONG. A frame is a claim about the shape of a particular file, and
 * a GM who saved their own differently-trimmed scan over one of the names we know breaks that
 * claim without breaking anything a caller could notice. `frameFitsImage` re-derives the printed
 * page's proportions from the Scene's actual ones and returns nothing at all if they disagree,
 * because a map with no pins is obviously missing them, while a map with every pin in the wrong
 * valley looks finished and is worse than useless.
 *
 * @param {{slug: string, out: string}} map   A POSTER_MAPS row.
 * @param {{width: number, height: number}} scene  The Scene's own dimensions, in pixels.
 */
export function posterMapPins(map, { width, height } = {}) {
	// The maps this system has label positions for: the two travel tiers and the village. The two
	// town maps have none recorded and fall out here.
	const tier = markedMap(map?.slug);
	if (!tier || !(width > 0) || !(height > 0)) return [];

	// A tier's fractions are against the printed crop and `frameFor` insets them into the poster;
	// the village's are against the poster already, and the identity frame a file with no entry
	// gets is exactly that. Either way the guard asks the one question worth asking, which is
	// whether this Scene is the shape the numbers were measured against.
	const frame = frameFor(map.out);
	if (!frameFitsImage(frame, width / height, tier.printedAspect)) return [];

	// The note's position, which is not quite the caption's: see markerTipLift. The conversion
	// itself is `posterSpotPixels`, so a marker and a site pin cannot be laid by two arithmetics.
	const at = (spot, kind) => {
		const { x, y } = posterSpotPixels({ spot, frame, width, height });
		return { x, y: y - markerTipLift(kind) };
	};

	// `family` is what the pin IS and `kind` is what it is DRAWN AS, and they are separate fields
	// because they move independently: two of these places are mountains and wear the terrain
	// symbol rather than a teardrop, without ceasing to be places or changing their key.
	const places = placesOnMap(map.slug).map(place => {
		const kind = place.marker ?? "place";
		return {
			key: markerPinKey(place.slug, "place"),
			family: "place",
			kind,
			slug: place.slug,
			name: placeMapLabel(place),
			// The compendium entry this place is written up in, for whoever is placing the pin to
			// resolve against the world. Carried rather than resolved here so this stays pure.
			journalId: place.journalId ?? null,
			...at(place.spots[map.slug], kind),
		};
	});

	// The edge arrows, which are captions on the same map doing the opposite job. They come out
	// of the same call because they are the same question ("what does this map say?") and because
	// every caller wants both: they dedupe together, they are laid down together, and they wear
	// the same permanent label. An arrow that names a single place borrows that place's write-up,
	// which is the whole of what a reader wants from "To Gordin's Delve" anyway.
	const exits = exitsOnMap(map.slug).map(exit => ({
		key: markerPinKey(exit.slug, "exit"),
		family: "exit",
		kind: "exit",
		slug: exit.slug,
		name: exit.mapLabel ?? exit.label,
		journalId: travelPlace(exit.node)?.journalId ?? null,
		...at(exit, "exit"),
	}));

	// The country the map letters across itself: regions, roads and ranges. Last because they are
	// the backdrop the other two stand on, and because a caption is the one family that names no
	// single point, so nothing about it wants to interleave with things that do. Most wear no
	// drawing at all, and the ones that do borrow another family's: see `kind` in travel-times.js
	// for what earns a caption a mark, since neither reason is "it is really a place".
	const captions = captionsOnMap(map.slug).map(caption => {
		const kind = caption.kind ?? "region";
		return {
			key: markerPinKey(caption.slug, "region"),
			family: "region",
			kind,
			slug: caption.slug,
			name: caption.mapLabel,
			journalId: caption.journalId ?? null,
			...at(caption, kind),
		};
	});

	return [...places, ...exits, ...captions];
}
