import { arcanaSummonFollowers } from "./arcana-summons.js";
import { isMajorArcanumItem } from "../arcana-icons.js";

/**
 * What an arcanum DOES, derived from its own data — the browse facets behind the
 * Relic / Power / Conduit chips in the arcana browser (see dialogs/catalog/ArcanaSource.js).
 *
 * Nothing in the pack tags an arcanum this way, so these are read off the card's shape
 * rather than curated: an arcanum that hands you something to carry is a Relic, one that
 * grants a move or a resource track is a Power, one that manifests a follower is a
 * Conduit. Deliberately NOT mutually exclusive — most relics also grant a move — so the
 * chips filter as an OR of "does this", not as buckets. A card can therefore carry two or
 * three kinds, and a few (a pure lore card) carry none.
 *
 * Takes a resolved arcanum ({@link MinorArcanum} or its snapshot), so homebrew cards are
 * classified by exactly the same rules as shipped ones — including a homebrew `summon`,
 * which arcanaSummonFollowers resolves ahead of the shipped ARCANA_SUMMONS map.
 */
export const ARCANUM_KINDS = [
	{
		key:   "relic",
		label: "Relic",
		icon:  "fas fa-gem",
		hint:  "Carries or places a thing: the arcanum itself is an item in your load",
	},
	{
		key:   "power",
		label: "Power",
		icon:  "fas fa-hand-sparkles",
		hint:  "Grants a move, a spell, or a resource track you spend",
	},
	{
		key:   "conduit",
		label: "Conduit",
		icon:  "fas fa-ghost",
		hint:  "Manifests a spirit, servant, or beast you treat as a follower",
	},
];


/**
 * The Major / Minor split, as a chip group for the browser's filter bar.
 *
 * Unlike the kinds above these ARE mutually exclusive — every arcanum is one or the other —
 * so the pair partitions the list cleanly. Solid FA icons in both cases: the system loads no
 * `far` weight anywhere, so a "regular star" for Minor would render as a blank box.
 *
 * The taxonomy itself is not re-derived here: {@link isMajorArcanumItem} owns it, honouring a
 * homebrew card's own `major` flag ahead of the shipped MAJOR_ARCANA_ICONS allowlist.
 */
export const ARCANUM_TIERS = [
	{
		key:   "major",
		label: "Major",
		icon:  "fas fa-star",
		hint:  "The 18 great arcana: card art, a Consequences track, and a hold on whoever carries them",
	},
	{
		key:   "minor",
		label: "Minor",
		icon:  "fas fa-star-half-stroke",
		hint:  "The lesser arcana: smaller powers, paid for as you use them rather than by a curse",
	},
];


/** "major" or "minor" for a resolved arcanum. */
export function arcanumTier(arc) {
	return isMajorArcanumItem(arc) ? "major" : "minor";
}

/**
 * Is this arcanum's item worn INSIDE you rather than carried?
 *
 * Book II tags two majors `implanted` — Storm Markings, which course up and down your skin, and
 * the Ineffable Words, emblazoned on your soul and tongue. They carry an `item` only so the card
 * can print its tag line; there is nothing in your hands and nothing in your load. Keyed off the
 * printed tag rather than a list of slugs, so a homebrew card tagged the same way behaves the
 * same way, and so the rule reads as what the book actually says.
 */
export function isImplantedArcanumItem(item) {
	return /\bimplanted\b/i.test(String(item?.note ?? ""));
}

/**
 * True when the arcanum's front hands the holder an item to carry (`front.item`).
 *
 * An implanted one does not count: the Relic chip promises "the arcanum itself is an item in
 * your load", and these never enter it.
 */
function _isRelic(arc) {
	const item = arc?.front?.item;
	return !!item && !isImplantedArcanumItem(item);
}

/**
 * Back headings that introduce granted moves or spells: "Moves", "Move", "Spells of the
 * Codex". A card that grants several of them writes them as a prose section under one of
 * these rather than filling the single structured `back.move` field — four shipped majors
 * (the Hungering Maw, Ineffable Words, the Redwood Effigy, Storm Markings) grant nothing
 * BUT prose, so a Power test that only read `back.move` called them powerless.
 *
 * Matched on the heading tag rather than anywhere in the body, which is thick with the word
 * "move" in ordinary prose ("when you Defy Danger", "this move"). "Mastered Words" and
 * "The Mighty Servant" are deliberately not in the pattern: every card carrying one also
 * carries a Moves heading, so widening it would buy nothing and cost precision.
 */
const _POWER_HEADING_RE = /<h[1-6]\b[^>]*>[^<]*\b(moves?|spells?)\b[^<]*<\/h[1-6]>/i;

/**
 * True when the back grants a move, a spell list, or a resource track. The structured
 * fields count only when filled in — a few cards carry an empty `move` / `resource` husk.
 */
function _isPower(arc) {
	if (arc?.back?.move?.name || arc?.back?.resource?.title) return true;
	return _POWER_HEADING_RE.test(arc?.back?.description ?? "");
}

/** True when the arcanum manifests follower(s), homebrew `summon` or shipped registry. */
function _isConduit(arc) {
	return !!arcanaSummonFollowers(arc)?.length;
}

/**
 * The kind keys an arcanum carries, in ARCANUM_KINDS order. May be empty.
 * @param {object} arc  A resolved arcanum (MinorArcanum or snapshot).
 * @returns {string[]}
 */
export function arcanumKinds(arc) {
	const kinds = [];
	if (_isRelic(arc))   kinds.push("relic");
	if (_isPower(arc))   kinds.push("power");
	if (_isConduit(arc)) kinds.push("conduit");
	return kinds;
}

