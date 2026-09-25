/**
 * Skins of fine whisky: "(○○ uses, grants advantage to Persuade)". The Distillery hands them over
 * (the Fox, the Heavy, the Judge, the Lightbearer, the Marshal and the Seeker can all take one), and
 * the Special Items handout sells the same skin ("share a use to get advantage on Persuade").
 *
 * The book leaves it to the player whether a skin is SHARED, so the sheet does not pour it for
 * them: it is a pre-ticked line in the Persuade roll window (dialogs/RollDialog.js#promptRoll, the
 * user's ruling). Left ticked, the roll gets advantage as a SOURCE, which nets against a
 * disadvantage like every other source, and 1 use is marked after the dice. Unticked, nothing.
 *
 * Pure: the character hands in its carried gear and its tracks (StonetopCharacter#fineWhiskyOffer).
 */

import { localize } from "../../utils/i18n.js";

/** The key the roll window names the line by, and the answer comes back under. */
export const FINE_WHISKY_OFFER = "fine-whisky";

/** What the roll card names as the advantage's source. */
export const FINE_WHISKY_SOURCE = "Fine whisky";

/** The book's ○○, for a granted skin made before its grant carried its own track. */
const FINE_WHISKY_USES = 2;

/** The moves a skin sweetens: "grants advantage to Persuade", either of the two. */
export function isPersuadeMove(moveName) {
	return /^Persuade\b/.test(String(moveName ?? ""));
}

/**
 * Whether a name is a SKIN of FINE whisky. The Distillery's grant ("Skins of fine whisky", keyed
 * "Fine whisky (advantage to Persuade)"), the handout's "Whisky, skin, fine" and "Skin of whisky,
 * fine" all are; a common skin is not (it grants nothing), and neither is a firkin or a barrel,
 * which are trade goods rather than something you pass round a table.
 */
export function isFineWhiskyName(name) {
	const text = String(name ?? "");
	return /\bwhisky\b/i.test(text) && /\bfine\b/i.test(text) && !/\b(firkin|barrel)s?\b/i.test(text);
}

/**
 * The skin to offer, or null: the first CARRIED fine whisky with a use left.
 *
 * @param {object} opts
 * @param {Array<{slug: string, name: string, sourceKey?: string, ammoMax?: number|null, legacyUsed?: number|null}>} opts.gear
 *   every gear record (StonetopCharacter#_gearSources), with a granted item's `sourceKey`.
 * @param {object} opts.marks      slug → carried
 * @param {object} opts.resources  slug → uses MARKED (an inventory track counts what is spent)
 * @returns {{key: string, label: string, applied: boolean, slug: string, used: number, max: number}|null}
 */
export function fineWhiskyOffer({ gear = [], marks = {}, resources = {} } = {}) {
	for (const g of gear) {
		if (!marks[g.slug]) continue;
		if (![g.name, g.sourceKey].some(isFineWhiskyName)) continue;
		const max  = Number(g.ammoMax) || FINE_WHISKY_USES;
		const used = Number(resources[g.slug] ?? g.legacyUsed ?? 0) || 0;
		if (used >= max) continue;
		return { key: FINE_WHISKY_OFFER, label: localize("stonetop.rollOffers.fineWhisky"), applied: true, slug: g.slug, used, max };
	}
	return null;
}
