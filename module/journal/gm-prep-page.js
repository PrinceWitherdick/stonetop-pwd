// Helpers that span ALL the GM-prep page families (threats, hazards and sites). They live
// here rather than in any one store because they reference all three; the scene-pin code
// and the on-canvas overlay treat those pins identically, resolving whichever kind an
// entry/page id or a document flag names.
import { threatPageById, threatsEntryId } from "../threats/threat-store.js";
import { hazardPageById, hazardsEntryId } from "../hazards/hazard-store.js";
import { sitePageById, sitesEntryId } from "../sites/site-store.js";
import { buildThreatCardVM } from "../threats/threat-view.js";
import { buildHazardCardVM } from "../hazards/hazard-view.js";
import { buildSiteCardVM, wireSiteTableRoll } from "../sites/site-view.js";
import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { SYSTEM_ID } from "../system-id.js";

const CARD_PARTIALS = "systems/stonetop-pwd/templates/journal/partials";

// ── What a kind's scene pin is drawn from ────────────────────────────────────────────────────
// Here rather than beside the hook that writes the pins, for the reason the table below exists:
// which picture a kind wears is one more thing that varies by kind, and a fourth kind declared
// upstairs and forgotten here would silently come out wearing a threat's torn note.

/** Threats and hazards are both things the GM wrote down about the world: one torn note. */
export const THREAT_PIN_ICON_SUFFIX = "assets/icons/threat-note.svg";

// A SITE IS NOT A TORN NOTE. A site is a PLACE, and a place dropped on a map should look like the
// place it is. The mound the GM Toolkit's Sites tab wears is already that drawing, and this is the
// same FILE rather than a copy of it, so the tab and the map can never end up showing two
// different pictures of one idea. (The rail paints it as a CSS mask; on a Note it is a texture,
// which is what the tint is for.)
export const SITE_PIN_ICON_SUFFIX = "assets/icons/tabs/site-mound.svg";

/** The ink a prep pin's own name is written in. */
export const GM_PREP_PIN_TEXT_COLOR = "#1b1009";

// The tab glyph is authored WHITE on transparent, because a mask only cares about alpha. Dropped
// on a map untinted it would be an invisible white mound on cream book art. Tinted to the same ink
// the pin's name is written in, it reads as the solid silhouette the rail paints, and the pin and
// its label are visibly one mark.
const DEFAULT_PIN_TINT = "#ffffff";

/**
 * Everything that varies by GM-prep kind, in ONE table.
 *
 * The flag that marks a document as this kind, how to resolve one of its pages, where that kind
 * keeps its journal entry, what its card is drawn from, how the tab lists it, and any card wiring
 * only this kind carries. Kept together because they are the same fact — "the kinds are threat,
 * hazard and site" — and spelling it several ways is how a fourth kind comes to be added to some
 * of them. It was five tables across three modules before this one absorbed them, and adding a
 * kind meant finding every one.
 *
 * Each column, and who reads it:
 *   pageById           resolve one of this kind's pages from an entry/page id pair
 *   entryId            where this kind keeps its journal entry on the steading
 *   noun               what to call one, in a window title or a button ("Delete Threat")
 *   cardTemplate       the card partial, for the hosts that draw cards of every kind
 *   cardVM             the view-model builder that feeds it
 *   collapsedByDefault the prep tabs open this kind's cards shut
 *   wireCard           card controls only this kind has
 *   pinIcon            the texture this kind's scene pin wears (shared: a hazard is a threat's note)
 *   pinTint            what to tint that texture, when white is wrong for it
 *
 * `wireCard` is a DELEGATED wiring: it binds one listener to a root that may hold cards of any
 * kind, and finds nothing when no card of its kind is there. That is what lets every host wire
 * the whole table blindly instead of testing which kinds it is about to draw.
 *
 * Everything here is DATA. What a kind's edit and add buttons do is not — those are methods on the
 * sheet holding the tab — so they stay in that sheet's own small table, keyed by these same names.
 */
const GM_PREP_KINDS = {
	threat: {
		pageById: threatPageById, entryId: threatsEntryId, noun: "Threat",
		cardTemplate: `${CARD_PARTIALS}/threat-card.hbs`, cardVM: buildThreatCardVM,
		pinIcon: THREAT_PIN_ICON_SUFFIX,
	},
	hazard: {
		pageById: hazardPageById, entryId: hazardsEntryId, noun: "Hazard",
		cardTemplate: `${CARD_PARTIALS}/hazard-card.hbs`, cardVM: buildHazardCardVM,
		pinIcon: THREAT_PIN_ICON_SUFFIX,
	},
	site: {
		pageById: sitePageById, entryId: sitesEntryId, noun: "Site",
		cardTemplate: `${CARD_PARTIALS}/site-card.hbs`, cardVM: buildSiteCardVM,
		pinIcon: SITE_PIN_ICON_SUFFIX, pinTint: GM_PREP_PIN_TEXT_COLOR,
		// A site write-up is a page long, so the tab reads as a list of titles you expand into;
		// a threat is a few lines and opens expanded.
		collapsedByDefault: true,
		// A site card carries its own random tables (Book I p. 369), rollable in place.
		wireCard: wireSiteTableRoll,
	},
};

/** One kind's row, or an empty object. The accessors below are what hosts should reach for. */
const kind = (id) => GM_PREP_KINDS[id] ?? {};

/** What to call one of this kind in a title or a button ("Threat"). */
export const gmPrepKindNoun = (id) => kind(id).noun ?? "";
/** The card partial for a kind, for a host that draws cards of more than one. */
export const gmPrepCardTemplate = (id) => kind(id).cardTemplate ?? null;
/** The card view-model builder for a kind. */
export const gmPrepCardVM = (id) => kind(id).cardVM ?? null;
/** Do this kind's cards open collapsed? */
export const gmPrepStartsCollapsed = (id) => !!kind(id).collapsedByDefault;

/**
 * The texture one kind of GM-prep pin wears.
 *
 * The WHOLE texture rather than the glyph alone, because the pass that brings old pins up to date
 * has to compare a note against exactly what a fresh drop would have written.
 */
export function gmPrepPinTexture(id) {
	return {
		src: `systems/${SYSTEM_ID}/${kind(id).pinIcon ?? THREAT_PIN_ICON_SUFFIX}`,
		tint: kind(id).pinTint ?? DEFAULT_PIN_TINT,
		anchorX: 0.5,
		anchorY: 0.5,
		fit: "contain",
	};
}

/**
 * The distinct pin glyphs across every kind, as path suffixes.
 *
 * Derived rather than listed, so the pass that refits old pins and the hook that styles their
 * labels both widen the moment a kind above declares a picture of its own.
 */
export const GM_PREP_PIN_ICON_SUFFIXES = Object.freeze([
	...new Set(Object.values(GM_PREP_KINDS).map(k => k.pinIcon ?? THREAT_PIN_ICON_SUFFIX)),
]);

/**
 * The kind names alone, for the hosts that need to iterate or test them without caring how a
 * kind resolves its pages — the prep tabs key their collapse state and view-model caches off
 * this, and use it as the cheap `doc.type` discriminator on world-wide page hooks.
 *
 * Exported so that list is not spelled a fourth time: this table is the one place a kind is
 * declared, and the docblock above says why.
 */
export const GM_PREP_KIND_IDS = Object.freeze(Object.keys(GM_PREP_KINDS));

/** Resolve the threat, hazard OR site page an entry/page id pair links to (as a scene Note
 *  does), or null. */
export function gmPrepPageById(entryId, pageId) {
	for (const { pageById } of Object.values(GM_PREP_KINDS)) {
		const page = pageById(entryId, pageId);
		if (page) return page;
	}
	return null;
}

/**
 * Delete a GM-prep page of ANY kind: the page, its scene pins, and the journal entry behind it
 * once nothing is left in it.
 *
 * Re-offered here so a caller holding a page and no particular kind in mind can reach it from the
 * module that owns the kind table, rather than importing one kind's store to delete another's.
 * It LIVES in gm-prep-page-store.js, beside the CRUD it is the other half of — see there for why
 * one behaviour is no longer three names.
 */
export { deleteGmPrepPage } from "./gm-prep-page-store.js";

/**
 * The journal entries a steading files its prep in, by id — every kind's, with the ones this
 * steading has not minted yet dropped.
 *
 * From the table for the reason the table exists: a host asking "is this page write one of
 * ours?" should not be re-listing the kinds by hand, because a kind added above but missed
 * there renders and wires correctly and then never refreshes, which reads as a stale tab
 * rather than as a missing registration.
 */
export function gmPrepEntryIds(steading) {
	if (!steading) return [];
	// Optional-called, like `wireCard` below. This runs inside the world-wide page hooks, so a kind
	// registered without an `entryId` would throw on EVERY journal page write in the world, on every
	// open toolkit — turning the missed registration this function exists to soften into something
	// far worse than the stale tab it is meant to leave behind.
	return Object.values(GM_PREP_KINDS).map(({ entryId }) => entryId?.(steading)).filter(Boolean);
}

/** Whether a JournalEntry / Note document is one of our GM-prep kinds. */
export function isGmPrepDoc(doc) {
	return Object.keys(GM_PREP_KINDS).some(flag => !!doc?.getFlag?.(STONETOP_SCOPE, flag));
}

/**
 * Wire every kind's own card controls on a delegated root.
 *
 * For the hosts that draw cards of MORE than one kind at once — the steading sheet's prep tabs
 * and the on-canvas overlay — so neither has to name a particular kind, and a fourth kind's
 * controls light up in both the moment its entry above gains a `wireCard`. (A single-kind host,
 * like a page sheet, reaches for `gmPrepCardWiring` instead.)
 *
 * @param {HTMLElement} root
 * @param {(el:HTMLElement) => any} resolvePage  the page (or a promise of it) for a clicked element
 */
export function wireGmPrepCardExtras(root, resolvePage) {
	for (const { wireCard } of Object.values(GM_PREP_KINDS)) wireCard?.(root, resolvePage);
}

/** One kind's card wiring, or undefined where that kind's card has no controls of its own. */
export function gmPrepCardWiring(kind) {
	return GM_PREP_KINDS[kind]?.wireCard;
}
