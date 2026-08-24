import { isArcanumData } from "../../item/createArcanum.js";
import { CatalogSource, summarize, searchIndex } from "./CatalogSource.js";
import { stripHtmlToText } from "../../utils/strings.js";
import { MinorArcanum } from "../../model/MinorArcanum.js";
import { ITEM_FLAG_SCOPE, ARCANA_PACK } from "../../actors/character/StonetopFlags.js";
import { isMajorArcanumItem, arcanumCardImg } from "../../arcana-icons.js";
import { STONETOP_ITEM_ICONS } from "../../utils/item-icon.js";
import { ARCANUM_KINDS, ARCANUM_TIERS, arcanumKinds, arcanumTier } from "../../data/arcana-facets.js";
import { CURSE_FILTERS, arcanumCurse } from "../../data/arcana-curses.js";

/**
 * Every arcanum in the world, in one filterable list: the shipped compendium plus any
 * homebrew cards authored as world Items.
 *
 * The tab on a character sheet only ever shows the cards that character holds, and the
 * compendium lists 82 bare item names, so there was nowhere to simply LOOK at the arcana —
 * to find the ones that summon something, or the ones whose curse you'd regret. This is that
 * view. It writes nothing: filtering is one viewer's lens, and clicking a row opens the
 * card's own sheet.
 *
 * Its three chip groups, all single-select:
 *
 *  • TIER — Major / Minor. The only group that truly partitions the list.
 *  • GRANTS — Relic / Power / Conduit, derived per card by arcanumKinds(). These OVERLAP
 *    (most relics also grant a move), so the chips read as "show me the cards that do this",
 *    not as buckets that partition the list.
 *  • CURSES — Ruinous / Grim / Mild, the graded Consequences tracks, plus Ungraded for a
 *    homebrew major whose track this system has not presumed to rank (see arcana-curses.js;
 *    the chips come from there, so a grading can never exist without a chip to find it by).
 *    Only Major arcana have those, so lighting a curse chip necessarily narrows to majors —
 *    and Minor + any curse is legitimately empty, which the empty state says out loud.
 *
 * Deliberately NOT live: staleFor() stays at the base's no. Rebuilding this list re-pulls all
 * 82 pack documents, and the things that would stale it — a GM authoring a homebrew card —
 * are rare enough that paying that on every Item edit in the world would be the worse trade.
 * Closing and reopening the browser re-reads it.
 */
export class ArcanaSource extends CatalogSource {
	constructor() {
		super({
			key:   "arcana",
			label: "Arcana",
			icon:  "fas fa-wand-sparkles",
			noun:  "arcana",
			search: { title: "Search arcana", placeholder: "Filter arcana…" },
			// Minor + any curse chip is a real, reachable, empty combination — only majors carry
			// a Consequences track — so the line says why rather than leaving it a mystery.
			empty: "No arcana match those filters. (Only Major arcana carry a Consequences track.)",
			// Every row here is an arcanum Item, so a row drags as one: onto a character sheet to
			// plant the card face-down as a mystery (StonetopCharacterSheet#_onDropItemCreate), or
			// into the Items directory to pull a copy out of the pack to homebrew from.
			dragType: "Item",
		});
		// Which cards the character who opened the browser already holds, for the "held" badge.
		// Filled by retarget() rather than by a constructor argument, so that ONE writer answers
		// for both the window being opened and the one already up. Held as slugs rather than read
		// off an actor so the list works with no actor at all (a GM opening it from a macro), and
		// so it never has to know how a sheet stores them.
		this.ownedSlugs = new Set();
	}

	/**
	 * The "Held" badges are baked into the rows, so a different set of held cards means
	 * rebuilding them. Compared rather than assigned blind: a GM usually has no assigned
	 * character, so both sets are empty and reopening the macro must not cost a rebuild.
	 */
	retarget({ ownedSlugs = [] } = {}) {
		if (this.ownedSlugs.size === new Set(ownedSlugs).size && ownedSlugs.every(s => this.ownedSlugs.has(s))) {
			return false;
		}
		this.ownedSlugs = new Set(ownedSlugs);
		return true;
	}

	// ---------------------------------------------------------------- facets

	facetGroups() {
		return [
			{ key: "tier",  label: "Tier",   chips: ARCANUM_TIERS.map(t => ({ key: t.key, label: t.label, icon: t.icon, hint: t.hint })) },
			{ key: "kind",  label: "Grants", chips: ARCANUM_KINDS.map(k => ({ key: k.key, label: k.label, icon: k.icon, hint: k.hint })) },
			// Every grading arcanumCurse can hand back, chip list and all, straight from the module
			// that does the grading — including "Ungraded", the homebrew majors. A facet value with
			// no chip is HIDDEN by every chip in its group rather than merely unfilterable, so the
			// two lists have to be one (see arcana-curses.js#CURSE_FILTERS).
			{
				key:   "curse",
				label: "Curses",
				chips: CURSE_FILTERS.map(c => ({ key: c.key, label: c.label, icon: c.icon, hint: c.hint, mod: c.key })),
			},
		];
	}

	// ---------------------------------------------------------------- loading

	/**
	 * The compendium first, then homebrew world Items. A homebrew card that reuses a shipped
	 * slug is skipped rather than listed twice — the shipped card wins on slug, matching
	 * FoundryArcanaRepository's precedence.
	 */
	async loadRows() {
		const docs = [...await this._packDocs(), ...this._worldDocs()];
		const seen = new Set();
		const rows = [];
		for (const doc of docs) {
			const flags = doc.flags?.[ITEM_FLAG_SCOPE] ?? {};
			if (!flags.slug || seen.has(flags.slug)) continue;
			seen.add(flags.slug);
			rows.push(this._buildRow(doc, flags));
		}
		// Majors first (there are 18 of them and they're what people come looking for),
		// then alphabetical within each tier.
		rows.sort((a, b) => (b.isMajor - a.isMajor) || a.title.localeCompare(b.title));
		return rows;
	}

	/**
	 * The compendium half of the list, pulled once per window.
	 *
	 * Memoised (CatalogSource#_once) separately from the browser's row cache, exactly as
	 * MonsterSource#_packRows is and for the same reason: a compendium cannot change under us,
	 * while the rows CAN be dropped — retarget() does it whenever the held cards change. Without
	 * the memo, moving the "Held" badge from one card to another would re-pull all 82 documents
	 * to repaint a badge.
	 */
	async _packDocs() {
		return this._once("packDocs", async () => {
			const pack = game.packs.get(ARCANA_PACK);
			if (!pack) return [];
			// One query for the lot. getDocument() falls through to a getDocuments({_id}) per
			// uncached id, so asking per index entry is 82 server round-trips for the same data.
			return (await pack.getDocuments()).filter(doc => doc.system?.moveType === "arcanum");
		});
	}

	_worldDocs() {
		return [...(game.items ?? [])].filter(isArcanumData);
	}

	/** One browser row from an arcanum Item document. */
	_buildRow(doc, flags) {
		// Rebuild the model so kinds / curses are read through exactly the same accessors
		// the sheet uses. Front and back are defaulted because a half-authored homebrew
		// card can be missing one, and a browser that throws on it would be useless.
		const arc   = new MinorArcanum({ ...flags, front: flags.front ?? {}, back: flags.back ?? {}, img: doc.img });
		const kinds = arcanumKinds(arc);
		const curse = arcanumCurse(arc);
		const tier  = arcanumTier(arc);
		const title = arc.front?.title || doc.name || arc.slug;
		const note  = stripHtmlToText(arc.front?.item?.note ?? "");
		const held  = this.ownedSlugs.has(arc.slug);
		// Only the majors have card art; all 64 minors fall back to the books' triple-spiral
		// arcanum mark — the same marker an un-illustrated arcanum Item already wears in the
		// sidebar, so the browser and the item directory agree on what "no art" looks like.
		// It's a CATEGORY marker, not a picture of any one card, which is why it can head 64
		// different rows without claiming anything about them.
		const cardImg = arcanumCardImg(arc);
		// Hoisted: the row shows it and the search index covers it, and it is the longest
		// field on the card — summarising it twice per row parses the same prose twice.
		const summary = summarize(arc.front?.description ?? "");

		const flagChips = [{ label: tier === "major" ? "Major" : "Minor", mod: tier === "major" ? "strong" : "" }];
		if (held)      flagChips.push({ label: "Held", mod: "good" });
		if (!doc.pack) flagChips.push({ label: "Homebrew" });

		const badges = kinds.map(key => {
			const kind = ARCANUM_KINDS.find(k => k.key === key);
			return { label: kind.label, icon: kind.icon, hint: kind.hint };
		});
		if (curse) badges.push({ label: curse.label, icon: curse.icon, hint: curse.cost, mod: curse.key });

		return {
			key:      arc.slug,
			uuid:     doc.uuid,
			title,
			isMajor:  isMajorArcanumItem(arc),
			img:      cardImg ?? STONETOP_ITEM_ICONS.arcanum,
			// Dims the mark so the 18 cards with real art still lead the eye down the list.
			placeholderImg: !cardImg,
			marked:   held,
			summary,
			note,
			flags:    flagChips,
			badges,
			facets:   { tier, kind: kinds, curse: curse?.key ?? "" },
			// Built here rather than walked out of the DOM at search time so the search covers
			// the curse's cost line, which the row shows only as a tooltip.
			search:   searchIndex(
				title, tier, summary, note,
				arc.back?.move?.name, arc.back?.resource?.title,
				badges.map(b => b.label), curse?.cost,
			),
		};
	}
}
