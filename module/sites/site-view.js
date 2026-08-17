// Builds the shared view-model for a site card, used by all three renderers: the page
// sheet (view mode), the steading tab's Sites tab, and the on-canvas overlay. The site
// card reuses the threat card's markup conventions (.threat-card wrapper, collapse
// chrome, whole-card drag) so threat-view's shared wiring works on site cards without a
// parallel set of handlers; site-only rows carry .site-* classes on top.
//
// A site has no doom track, so the doom wiring simply finds nothing to bind.
import { hasText, stringList, cardEnricher } from "../journal/card-vm.js";
import { keyedRows, pairKeys } from "./site-schema.js";

/** Card/pin accent for sites: weathered stone, distinct from the threat hues and hazard moss. */
export const SITE_ACCENT = "#5a5f6b";

// Rows are read back through the SCHEMA's helper, not a private copy of it. The store and this
// file each spelled out "map the keys, trim, drop the blank rows" and so each owned a definition
// of "blank" — a site could be saved with a row the card then declined to render.
const rowsOf = (arr, list) => keyedRows(arr, pairKeys(list) ?? []);

/**
 * View-model for one site page. Async because prose fields are enriched. Pass
 * `{ forOwner }` to force the owner/editable affordances (defaults to page.isOwner).
 */
export async function buildSiteCardVM(page, { forOwner } = {}) {
	const sys = page.system ?? {};
	// Enrich prose (resolve @UUID links, inline rolls) without revealing GM secret blocks.
	const enrich = cardEnricher();

	// The foundation line: what manner of site, where it sits, in what terrain. Joined into
	// one strip because each piece alone is a fragment.
	const foundation = [sys.mannerLabel, sys.regionLabel, sys.terrain]
		.map(s => String(s ?? "").trim())
		.filter(Boolean);

	// Picks are the manner tables' own output rather than a wizard list, so they name their two
	// shown keys here; the rest read theirs off the schema.
	const picks = keyedRows(sys.picks, ["label", "value"]);
	const questions = rowsOf(sys.questions, "questions");
	const timeline = rowsOf(sys.timeline, "timeline");
	const denizens = rowsOf(sys.denizens, "denizens");

	const connections = stringList(sys.connections);
	const dangers = stringList(sys.dangers);
	const discoveries = stringList(sys.discoveries);
	const outside = stringList(sys.outside);
	const inside = stringList(sys.inside);
	const plans = stringList(sys.plans);

	// Enriching is an async round-trip per prose field, and no area depends on any other, so they
	// go out together rather than one after the next: a six-area site was serialising twelve of
	// them. Worth doing because of where this runs — the steading tab rebuilds a card per site on
	// every render of the sheet, so the walk WAS the tab's cost.
	//
	// `index` stays the row's place in the STORED array (blank rows are dropped afterwards, not
	// before), because that is what the table-roll wiring indexes back into.
	const areas = (await Promise.all(
		(Array.isArray(sys.areas) ? sys.areas : []).map(async (area, index) => {
			const title = String(area?.title ?? "").trim();
			const description = String(area?.description ?? "").trim();
			const contents = String(area?.contents ?? "").trim();
			const exits = String(area?.exits ?? "").trim();
			if (!title && !description && !contents && !exits) return null;
			const [descriptionHtml, contentsHtml] = await Promise.all([enrich(description), enrich(contents)]);
			return {
				index,
				title: title || `Area ${index + 1}`,
				description: descriptionHtml,
				hasDescription: !!description,
				contents: contentsHtml,
				hasContents: !!contents,
				exits,
				hasExits: !!exits,
			};
		}),
	)).filter(Boolean);

	// Each table's rows carry their roll span so the card can show "1-2" beside a row and
	// the roll button can land on it. Rows are dealt out evenly across the table's die,
	// which is what "assign numbers 1-6 or 1-12 to the options" means (Book I p. 369).
	const randomTables = (Array.isArray(sys.randomTables) ? sys.randomTables : [])
		.map((t, index) => {
			const rows = stringList(t?.rows);
			return {
				index,
				caption: String(t?.caption ?? "").trim(),
				die: rows.length ? `1d${rows.length}` : "",
				rows: rows.map((text, i) => ({ roll: i + 1, text })),
				hasRows: rows.length > 0,
			};
		})
		.filter(t => t.caption || t.hasRows);

	return {
		id: page.id,
		uuid: page.uuid,
		name: page.name,
		accent: SITE_ACCENT,
		foundation,
		hasFoundation: foundation.length > 0,
		why: String(sys.why ?? ""),
		hasWhy: hasText(sys.why),
		description: await enrich(sys.description),
		hasDescription: hasText(sys.description),
		picks,
		hasPicks: picks.length > 0,
		connections,
		hasConnections: connections.length > 0,
		questions,
		hasQuestions: questions.length > 0,
		timeline,
		hasTimeline: timeline.length > 0,
		denizens,
		hasDenizens: denizens.length > 0,
		dangers,
		hasDangers: dangers.length > 0,
		discoveries,
		hasDiscoveries: discoveries.length > 0,
		outside,
		hasOutside: outside.length > 0,
		inside,
		hasInside: inside.length > 0,
		hasEnvironment: outside.length > 0 || inside.length > 0,
		areas,
		hasAreas: areas.length > 0,
		plans,
		hasPlans: plans.length > 0,
		randomTables,
		hasRandomTables: randomTables.length > 0,
		isOwner: forOwner ?? page.isOwner,
	};
}

/**
 * Roll one row off a site's own random table (Book I p. 369: "assign numbers 1-6 or 1-12
 * to the options and have a player roll the Die of Fate"). Rows are equally weighted, so
 * the die is however many results the table has.
 * @param {object} page  the site page
 * @param {number} index the table's index in system.randomTables
 * @param {() => number} rng
 * @returns {{roll:number, text:string, die:string}|null} null when there's nothing to roll
 */
export function rollSiteTable(page, index, rng = Math.random) {
	const rows = stringList(page?.system?.randomTables?.[index]?.rows);
	if (!rows.length) return null;
	const i = Math.min(rows.length - 1, Math.max(0, Math.floor((rng() || 0) * rows.length)));
	return { roll: i + 1, text: rows[i], die: `1d${rows.length}` };
}

/**
 * Wire "roll this site's own table" on a delegated `root`. Every host that renders a site
 * card (page sheet, steading tab, canvas overlay) wires this, so the roll behaves the same
 * everywhere: the result is marked on the card in place and announced to the roller alone.
 * The result is deliberately NOT written to the page: these tables are rolled repeatedly
 * in play, and a stored "last result" would be noise the GM has to clear.
 * @param {HTMLElement} root
 * @param {(btn:HTMLElement) => any} resolvePage  the page (or a promise of it) for a button
 */
export function wireSiteTableRoll(root, resolvePage) {
	root.addEventListener("click", async ev => {
		const btn = ev.target.closest?.(".site-table-roll");
		if (!btn) return;
		ev.preventDefault();
		ev.stopPropagation();
		const page = await resolvePage(btn);
		if (!page) return;
		const index = Number(btn.dataset.tableIndex);
		const result = rollSiteTable(page, index);
		if (!result) return;
		// Mark the rolled row on this table only; a fresh roll clears the previous mark.
		const host = btn.closest(".site-table");
		host?.querySelectorAll("li.is-rolled").forEach(li => li.classList.remove("is-rolled"));
		host?.querySelector(`li[data-roll="${result.roll}"]`)?.classList.add("is-rolled");
		globalThis.ui?.notifications?.info?.(`${result.die}: ${result.roll} ${result.text}`);
	});
}
