// The Core Loop tab's running-the-game reference (gm-agenda-text.js), as plain objects for the
// template: headings localized, citations resolved. Built once for the life of the page, like the
// Homefront tab's sections (homefront-view.js), since every input is a constant or an i18n key.
import { localize } from "../utils/i18n.js";
import { localizedOnce } from "../utils/localized-once.js";
import { bookPageCites } from "./book-ref.js";
import { escHtml } from "../utils/strings.js";
import {
	GM_AGENDA, GM_PRINCIPLES, GM_THE_LINE, GM_DONTS, FIRST_ADVENTURE_PREP, FIRST_ADVENTURE_HOOKS,
} from "./gm-agenda-text.js";

const KEY = "stonetop.gmToolkit.running";

/** Rows with their own citation where they name a page. */
const cited = items => items.map(item => ({ ...item, pageCites: bookPageCites(item) }));

/** One foldable section: heading, note, the section's citation, and its name-and-line rows. */
function section(key, { items, page = null, footer = "" }) {
	return {
		key,
		title:      localize(`${KEY}.${key}`),
		note:       localize(`${KEY}.${key}Note`),
		collapseId: `gmRunning-${key}`,
		pageCites:  page ? bookPageCites({ page }) : [],
		items:      cited(items),
		footer,
	};
}

/**
 * The four short sections (agenda, principles, the Line, what not to do), then the first adventure
 * as its own shape: goals, prep steps, the opening scene's moves, and the per-result hook guidance.
 */
export const localizedRunningReference = localizedOnce(() => ({
	sections: [
		section("agenda", { items: GM_AGENDA.items, page: GM_AGENDA.page, footer: GM_AGENDA.note }),
		section("principles", { items: GM_PRINCIPLES }),
		section("line", { items: GM_THE_LINE.items, page: GM_THE_LINE.page }),
		section("donts", { items: GM_DONTS.items, page: GM_DONTS.page }),
	],
	firstAdventure: {
		title:          localize(`${KEY}.firstAdventure`),
		note:           localize(`${KEY}.firstAdventureNote`),
		collapseId:     "gmRunning-firstAdventure",
		pageCites:      bookPageCites({ page: FIRST_ADVENTURE_PREP.page }),
		goalsLabel:     localize(`${KEY}.goals`),
		goals:          FIRST_ADVENTURE_PREP.goals,
		steps:          cited(FIRST_ADVENTURE_PREP.steps),
		sceneLabel:     localize(`${KEY}.sceneMoves`),
		sceneMoves:     FIRST_ADVENTURE_PREP.sceneMoves,
		sceneCaution:   FIRST_ADVENTURE_PREP.sceneCaution,
		hooksLabel:     localize(`${KEY}.hooks`),
		hooksHtml:      firstAdventureHooksHtml(),
	},
}));

/**
 * The per-result hook guidance (Book I pp.255-259) as markup: one block per result, each gain a
 * row tagged `data-gain` with its spring-burst-data.js key. Shared by the toolkit's Core Loop tab
 * and the Let Spring Burst Forth walkthrough, which marks the rows of the gains already ticked
 * (`picked`, a presence map by key) and re-marks them as boxes are ticked, without a render.
 *
 * Built here rather than as a Handlebars partial so both windows draw it with nothing to register;
 * every string is escaped.
 *
 * @param {{picked?: object}} [opts]
 * @returns {string}
 */
export function firstAdventureHooksHtml({ picked = {} } = {}) {
	const tiers = FIRST_ADVENTURE_HOOKS.map(tier => {
		const gains = tier.gains.map(g => {
			const on = picked?.[g.gain] ? " is-picked" : "";
			return `<li class="stonetop-hook-gain${on}" data-gain="${escHtml(g.gain)}"><strong>${escHtml(g.name)}</strong> ${escHtml(g.line)}</li>`;
		}).join("");
		return `<div class="stonetop-hook-tier" data-tier="${escHtml(tier.key)}">`
			+ `<p class="stonetop-hook-tier-head"><strong>${escHtml(tier.tier)}: ${escHtml(tier.name)}</strong> <span class="stonetop-hook-tier-page">(Book I p.${tier.page})</span></p>`
			+ `<p class="stonetop-hook-tier-line">${escHtml(tier.line)}</p>`
			+ (gains ? `<ul class="stonetop-hook-gains">${gains}</ul>` : "")
			+ `</div>`;
	}).join("");
	return `<div class="stonetop-hook-guide">${tiers}</div>`;
}
