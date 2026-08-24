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
 * The card's four foldable beats: which written-up sections fold together, and what the fold is
 * called.
 *
 * A fully written-up site is a page long — the barrow with a timeline, six areas and two tables
 * is about 900px — and the Sites tab tiles several of them side by side, so the body folds
 * rather than running. FOUR named folds rather than a caret on every heading: a dozen carets is
 * as hard to read as the wall it replaced, and the walkthrough already collects a site in four
 * clusters (create-site-dialog.js: steps 3-4 the story, 5 what lives there, 6-7 the place, 8 what
 * you roll in play). Folding along the same seams means the card reads back the way it was
 * written, and the book's own order (Book I pp. 355-370) survives.
 *
 * The section names inside each group are carried so a SHUT fold can say what it is holding —
 * "The place itself · Outside · Areas" tells you whether it is worth opening. They are paired
 * with the view-model key they render from, so a group cannot come to claim a section the card
 * no longer draws.
 */
const SITE_CARD_GROUPS = [
	{ id: "story", label: "Its story", sections: [
		["timeline", "Timeline"], ["questions", "Questions"], ["connections", "Connections"]] },
	{ id: "within", label: "What's in it", sections: [
		["denizens", "Denizens"], ["dangers", "Dangers"], ["discoveries", "Discoveries"]] },
	{ id: "place", label: "The place itself", sections: [
		["outside", "Outside"], ["inside", "Inside"], ["areas", "Areas"]] },
	{ id: "play", label: "Plans & tables", sections: [
		["plans", "Plans"], ["randomTables", "Tables"]] },
];

/** The group ids, in card order, for a host that wants to walk them without the labels. */
export const SITE_CARD_GROUP_IDS = Object.freeze(SITE_CARD_GROUPS.map(g => g.id));

/**
 * The foldable groups for one site's parts, KEYED BY ID rather than listed.
 *
 * The card's four bodies are hand-written markup in the book's order, not a loop over a list, so
 * the template asks for its group by name (`groups.place.open`); an array would make every one of
 * those a lookup helper. A group with nothing written up in it is still present, marked
 * `show: false`, for the same reason.
 *
 * `open` is the BUILD-TIME default and says "drawn whole": a site page sheet or a pinned card on
 * the canvas is a site you opened on purpose. The GM Toolkit's Sites tab, which is where the
 * height actually hurts, overrides it per card — see `_cardVMsFor` in gm-prep-tabs.js.
 */
export function siteCardGroups(parts) {
	return Object.fromEntries(SITE_CARD_GROUPS.map(({ id, label, sections }) => {
		const holds = sections.filter(([key]) => parts[key]?.length).map(([, name]) => name);
		return [id, { id, label, holds, show: holds.length > 0, open: true }];
	}));
}

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
		// The four folds the body is drawn in. Built from the same arrays the sections render
		// from, so an empty group is empty for the one reason there is.
		groups: siteCardGroups({
			timeline, questions, connections, denizens, dangers, discoveries,
			outside, inside, areas, plans, randomTables,
		}),
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
