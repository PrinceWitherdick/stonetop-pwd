// The `settlement` Actor subtype, as the rest of the system needs to talk about it: a steading that
// is not Stonetop (Marshedge, Gordin's Delve, a Hillfolk band, a homebrew city).
//
// Where callers ask for the type string and the ways to find one (both written in settlement-type.js),
// and the one place for the way to make one, and the
// two ways a new one is filled in: from a named place's printed stat block, or from one of Book
// II's "typical" blocks (data/settlement-stats.js). Shaped like gmtoolkit/gm-toolkit-actor.js, but
// NOT a singleton: a world may hold as many as its map does.
//
// STONETOP STAYS THE ONE HOME STEADING. Nothing here is found by `getStonetopSteadingActor()` or
// `isSteadingActor()`, which is deliberate: those answer "the steading the seasons, the timeline,
// the GM Toolkit and the expeditions belong to", and a second answer would split every one of
// them. A settlement is a separate type precisely so none of that has to learn which one is meant.

import { isActorTypeAvailable, ownershipLevels } from "../../utils/foundry-compat.js";
import { SETTLEMENTS } from "../../data/settlements.js";
import { settlementPortraitFor } from "./settlement-portrait.js";
import { BOOK_SETTLEMENT_STATS, settlementTemplate } from "../../data/settlement-stats.js";
import { STEADING_SIZES } from "../../utils/improvement-def.js";
import { SETTLEMENT_TYPE, isSettlementActor, isWorldSettlement, settlementActors } from "./settlement-type.js";
import { settlementRow } from "./settlement-rows.js";
import { homeKey } from "./settlement-residents.js";
import { isSteadingActor } from "../../utils/world.js";
import { openApplications } from "../../utils/open-windows.js";

// The type string and the finders live in a leaf (settlement-type.js), because settlement-portrait.js
// needs them too and this module needs it; handed on from here, which is where callers ask.
export { SETTLEMENT_TYPE, isSettlementActor, settlementActors } from "./settlement-type.js";

/** The roster row (data/settlements.js) for a slug, or null. */
export function rosterSettlement(slug) {
	return SETTLEMENTS.find(s => s.slug === slug) ?? null;
}

/**
 * The key of Stonetop's standing with this settlement, in Stonetop's `system.relationships`.
 *
 * A named place uses its roster slug, which is the key the Other Settlements table has always
 * stored; so a sheet made for Marshedge shows the hearts Stonetop already gave Marshedge, and the
 * two never disagree. Anywhere else (a template band, a homebrew city) uses the actor's own id,
 * which is dot-free like a slug and can never collide with one (ids carry no hyphen).
 */
export function standingKey(actor) {
	const slug = actor?.system?.sourceSlug ?? "";
	return rosterSettlement(slug) ? slug : (actor?.id ?? "");
}

/**
 * A Trade-with row's roster slug once its partner's name is `partner`, the row having been `was`
 * (null for a new row). The slug is what links the partner's name to that place's sheet, so it
 * follows the name: kept while the partner is not renamed, else the roster place the new name
 * names, else none. A book row's partner text need not be the roster's spelling, which is why an
 * edit that leaves the partner alone keeps the slug it came with. Pure.
 */
export function tradePartnerSlug(partner, was = null) {
	if (was && homeKey(partner) === homeKey(was.partner)) return was.slug ?? "";
	const key = homeKey(partner);
	return (key && SETTLEMENTS.find(s => homeKey(s.name) === key)?.slug) || "";
}

/**
 * Whether a settlement is hidden from the players, as the sheet's header chip shows it and
 * StonetopSettlementSheet#_onToggleHidden sets it: no default level a player can see it by, and no
 * player of their own seeing it (LIMITED or OBSERVER). A player who OWNS it is not asked: hiding
 * leaves them owning it, so counting them would make a hidden place read as shown, and the chip
 * could never show it again. Pure.
 *
 * @param {object} ownership  the actor's `ownership` (`default` and per-user levels)
 * @param {Iterable<{id: string, isGM: boolean}>} users
 */
export function settlementHiddenFromPlayers(ownership = {}, users = []) {
	const { LIMITED, OWNER } = ownershipLevels();
	if ((ownership?.default ?? 0) >= LIMITED) return false;
	return ![...users].some(user => {
		if (!user || user.isGM) return false;
		const level = ownership?.[user.id];
		return typeof level === "number" && level >= LIMITED && level < OWNER;
	});
}

/**
 * Every settlement by its `sourceSlug`, the first winning: `settlements` in settlementActors()'s order
 * (oldest first, so the same sheet on every load). One pass for a render that looks up several slugs.
 */
export function settlementsBySlug(settlements = settlementActors()) {
	const bySlug = new Map();
	for (const actor of settlements) {
		const slug = actor.system?.sourceSlug;
		if (slug && !bySlug.has(slug)) bySlug.set(slug, actor);
	}
	return bySlug;
}

// What other sheets draw from a settlement: Stonetop's Other Settlements rows (a row per sheet, its
// name, picture and link, and whether this user may see it), and another settlement's trade links.
const DRAWN_ELSEWHERE = ["name", "img", "ownership", "system.sourceSlug", "system.kind"];

/**
 * `createActor` / `updateActor` / `deleteActor`: redraw the open sheets that draw from a
 * settlement (Stonetop's, another settlement's) when one comes, goes, or changes what they show.
 * Core redraws a sheet only for its OWN document. `changed` is the update's diff; omitted for a
 * create or a delete, which always redraw.
 */
export function redrawForSettlement(actor, changed = null) {
	// A compendium's or a token's copy is on no other sheet.
	if (!isWorldSettlement(actor)) return;
	const hasProperty = globalThis.foundry?.utils?.hasProperty;
	if (changed && hasProperty && !DRAWN_ELSEWHERE.some(key => hasProperty(changed, key))) return;
	for (const app of openApplications()) {
		const doc = app.document ?? app.actor;
		if (!app.rendered || !doc || doc === actor) continue;
		if (isSteadingActor(doc) || isSettlementActor(doc)) app.render(false);
	}
}

/**
 * The settlements made from something other than a roster row: template bands and homebrew
 * places. These get rows of their own on Stonetop's Other Settlements table, keyed by actor id.
 */
export function customSettlementActors(actors = globalThis.game?.actors) {
	return settlementActors(actors).filter(a => !rosterSettlement(a.system?.sourceSlug ?? ""));
}

// ── Filling one in ────────────────────────────────────────────────────────────────

/** A stat block's rows for one list, in the sheet's columns (settlement-rows.js). */
const rows = (block, list) => (block?.[list] ?? []).map(row => settlementRow(list, row));

/**
 * The `system` data for a settlement made from a stat block, named or typical. Pure: the block is
 * read, never kept, so a later edit to the table cannot reach a sheet already made from it.
 *
 * @param {object} block  a BOOK_SETTLEMENT_STATS entry or a SETTLEMENT_TEMPLATES entry
 * @param {string} sourceSlug  the roster slug or template id it was made from
 */
export function settlementSystemFrom(block, sourceSlug = "") {
	const size = STEADING_SIZES.includes(block?.size) ? block.size : "village";
	return {
		kind:       block?.kind ?? "",
		size,
		headcount:  block?.headcount ?? "",
		region:     block?.region ?? "",
		government: block?.government ?? "",
		stats: {
			population: { value: block?.population ?? 0 },
			prosperity: { value: block?.prosperity ?? 0 },
			defenses:   { value: block?.defenses ?? 0 },
		},
		statRanges:     { ...(block?.statRanges ?? {}) },
		resources:      rows(block, "resources"),
		fortifications: rows(block, "fortifications"),
		tradeWith:      rows(block, "tradeWith"),
		groups:         rows(block, "groups"),
		leaders:        rows(block, "leaders"),
		sourceSlug,
		journalId:  block?.journalId ?? "",
		sourcePage: block?.page ?? "",
		setupNote:  block?.setupNote ?? "",
	};
}

/**
 * Creation data for a named place from the roster, or null when the books print nothing to fill
 * it with (the Fae, Ustrina).
 */
export function settlementDataFromBook(slug) {
	const row = rosterSettlement(slug);
	const block = BOOK_SETTLEMENT_STATS[slug];
	if (!row || !block) return null;
	return { name: row.name, system: settlementSystemFrom(block, slug) };
}

/** Creation data for one of Book II's typical blocks, or null for an unknown id. */
export function settlementDataFromTemplate(id) {
	const block = settlementTemplate(id);
	if (!block) return null;
	return { name: block.label, system: settlementSystemFrom(block, id) };
}

/** A settlement's name when nobody gave it one. */
const DEFAULT_NAME = "New Settlement";

/** Creation data for a blank settlement. */
export function blankSettlementData() {
	return { name: DEFAULT_NAME, system: {} };
}

// ── Making one ────────────────────────────────────────────────────────────────────

const RELAUNCH_WARNING =
	"This world was launched before settlement sheets existed. Return to Setup and launch the world again, then try once more.";

/**
 * Create a settlement actor from creation data ({name, system}), or null if it could not be made.
 * The GM's alone: preCreateActor (hooks/StonetopSingleton.js) refuses a player's.
 */
export async function createSettlement({ name, system = {} } = {}, { folder = null } = {}) {
	// A world launched before the subtype existed (utils/foundry-compat.js#isActorTypeAvailable).
	if (!isActorTypeAvailable(SETTLEMENT_TYPE)) {
		ui.notifications?.warn?.(RELAUNCH_WARNING, { permanent: true });
		return null;
	}
	try {
		const cls = globalThis.getDocumentClass?.("Actor") ?? globalThis.Actor;
		const finalName = name?.trim() || DEFAULT_NAME;
		// Its square of book art when there is one on disk, else its letter; the token wears the same.
		const img = await settlementPortraitFor(system?.sourceSlug ?? "", finalName);
		return await cls.create({
			name: finalName,
			type: SETTLEMENT_TYPE,
			folder,
			img,
			system,
			prototypeToken: { texture: { src: img } },
		}) ?? null;
	} catch (err) {
		console.error("Stonetop | failed to create settlement", err);
		ui.notifications?.error?.("Couldn't create the settlement. See the console for details.");
		return null;
	}
}
