import { escHtml, sign } from "../../utils/strings.js";
import { openGazetteerEntry } from "../../utils/gazetteer-notes.js";
import { BOOK_SETTLEMENT_STATS, settlementTemplate } from "../../data/settlement-stats.js";

// ── The seasonal gains, applied ───────────────────────────────────────────────
// Five gains a Seasons Change can hand out (Book I p.518), and three of them change the sheet:
//   • Population boom: "Increase Population by 1 (max +3)."
//   • Unexpected bounty: "1 Surplus, now."
//   • Tor's blessing: "+1 to Pull Together this season, and any time you roll the Die of Fate
//     for weather, roll twice and take your pick." Leaves a flag behind, stamped to the season.
// The other two (trade opportunity, interesting news) are the GM's to play out and leave nothing.
//
// ONE place for this, because two flows make the move: the steading's Seasons Change window
// (StonetopSteadingSheet._saveSeasonChange) and the session-zero first spring
// (SpringBurstDialog). The second used to record the gains' NAMES in the Chronicle and apply
// none of them, so a Tor's blessing taken at the very first spring never held.

/** The move every gain is filed under in the ledger. */
export const SEASONAL_GAINS_MOVE = "Seasons Change";

/**
 * The gains' changes, WITHOUT writing them, so a caller with more to say in the same move (the
 * muster lapsing) can fold it into one update.
 *
 * @param {object}   steading  The StonetopSteading (an actor's `typedActor`).
 * @param {string[]} keys      SEASONAL_GAINS keys ticked.
 * @param {object}   season
 * @param {number}   season.year      The campaign year the season belongs to.
 * @param {string}   season.seasonId  The season beginning.
 * @returns {{system: object, flags: object, notices: string[], surplus: number}}  `surplus` is
 *   the Surplus the steading will have once the bounty (if any) lands.
 */
export function seasonalGainChanges(steading, keys, { year, seasonId } = {}) {
	const picked  = new Set(keys ?? []);
	const system  = {};
	const flags   = {};
	const notices = [];

	if (picked.has("population")) {
		const population = Math.min(steading.getStatValue("population") + 1, 3);
		system["attributes.population.value"] = population;
		notices.push(`Population boom: Population increased to ${sign(population)}.`);
	}

	const surplus = steading.getStatValue("surplus") + (picked.has("bounty") ? 1 : 0);
	if (picked.has("bounty")) {
		system["attributes.surplus.value"] = surplus;
		notices.push(`Unexpected bounty: Surplus increased to ${surplus}.`);
	}

	// Recorded against this year+season so it expires by simply ceasing to match the clock.
	if (picked.has("tor")) {
		Object.assign(flags, steading.torsBlessingFlags(year, seasonId));
		notices.push("Tor's blessing holds for the season.");
	}

	return { system, flags, notices, surplus };
}

/**
 * Apply the ticked gains in ONE steading update named for the move, so the ledger appends once
 * and the stat changes card together, then say what changed.
 *
 * @param {object}   steading
 * @param {string[]} keys
 * @param {object}   options
 * @param {number}   options.year
 * @param {string}   options.seasonId
 * @param {{system?: object, flags?: object, notices?: string[]}} [options.also]  Anything else
 *   the same move changes, carried in the same write; its notices follow the gains'.
 * @returns {Promise<ReturnType<typeof seasonalGainChanges>>}
 */
export async function applySeasonalGains(steading, keys, { year, seasonId, also = {} } = {}) {
	const gains = seasonalGainChanges(steading, keys, { year, seasonId });
	await steading.applyChanges(
		{ system: { ...gains.system, ...(also.system ?? {}) }, flags: { ...gains.flags, ...(also.flags ?? {}) } },
		{ stonetopMove: SEASONAL_GAINS_MOVE });
	for (const notice of [...gains.notices, ...(also.notices ?? [])]) globalThis.ui?.notifications?.info?.(notice);
	return gains;
}

// ── "Trade opportunity": the neighbours' lists ────────────────────────────────
// "If they pick a trade opportunity ... pick a community you'd like to feature (Barrier Pass, the Hillfolk,
// etc.), look up their entry in Book II, and pick one of the listed Trade Opportunities for that group"
// (Book I p.519). These are the gazetteer entries that print a "Trade opportunities" list, by their id in the
// merged journal pack: the world's seeded copy opens when there is one, the compendium's otherwise.

/**
 * The communities whose Book II entry lists Trade Opportunities, in the order a GM would look. Each id is
 * the one the settlement tables (data/settlement-stats.js) already carry for that place's gazetteer
 * link: the named places' stat blocks, and for the Hillfolk and the Manmarch the typical band / hamlet
 * the same entry prints.
 */
export const TRADE_OPPORTUNITY_SOURCES = Object.freeze([
	{ name: "Marshedge",         journalId: BOOK_SETTLEMENT_STATS["marshedge"].journalId },
	{ name: "Gordin's Delve",    journalId: BOOK_SETTLEMENT_STATS["gordins-delve"].journalId },
	{ name: "Barrier Pass",      journalId: BOOK_SETTLEMENT_STATS["barrier-pass"].journalId },
	{ name: "The Hillfolk",      journalId: settlementTemplate("hillfolk-band").journalId },
	{ name: "North Manmarch",    journalId: settlementTemplate("manmarch-hamlet").journalId },
	{ name: "Lygos & the South", journalId: BOOK_SETTLEMENT_STATS["lygos"].journalId },
	// The Fae are no settlement, so neither table has them: their entry in stonetop-lore/factions.
	{ name: "The Fae",           journalId: "Ej5WiMs30baKNXW3" },
]);

/** The links under the "Trade opportunity" gain: one button per community. PURE. */
export function tradeOpportunityLinksHtml() {
	return `<div class="stonetop-season-trade-links">
		<span class="stonetop-season-gains-hint">Pick one of a community's listed Trade Opportunities (Book II):</span>
		${TRADE_OPPORTUNITY_SOURCES.map(s => `<button type="button" class="stonetop-season-trade-link" data-action="open-trade-opportunities" data-journal-id="${escHtml(s.journalId)}">
			<i class="fas fa-book-open" aria-hidden="true"></i> ${escHtml(s.name)}
		</button>`).join("")}
	</div>`;
}

/**
 * Open one community's gazetteer entry, where its Trade Opportunities are listed. Whether it was found.
 * @param {string} journalId
 * @param {{resolve?: (uuid: string) => Promise<object|null>}} [deps]
 */
export async function openTradeOpportunities(journalId, deps = {}) {
	if (await openGazetteerEntry(journalId, deps)) return true;
	globalThis.ui?.notifications?.warn?.("That community's entry could not be found in the journals.");
	return false;
}

/** Wire the links (the Seasons Change window's render). */
export function wireTradeOpportunityLinks(root, deps = {}) {
	for (const btn of root?.querySelectorAll?.("[data-action='open-trade-opportunities']") ?? []) {
		btn.addEventListener("click", ev => {
			ev?.preventDefault?.();
			openTradeOpportunities(btn.dataset.journalId, deps)
				.catch(err => console.error("Stonetop | could not open a community's Trade Opportunities", err));
		});
	}
}
