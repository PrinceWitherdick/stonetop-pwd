// A follower Outfits, as a character does.
//
// "Followers need to Outfit, too! You might tell their player what they bring, or have the player decide"
// (Book I p.306), and "Followers Outfit (page 306) just like PCs" (p.310). So a follower with a gear list gets
// the character's own Outfit window (dialogs/OutfitMoveDialog.js) over the same village catalog, its load
// bands and its 4+Prosperity small-item allowance, with only what is the character's own left out: their
// arcana, treasures and special possessions, and any move that raises THEIR load. What the window confirms
// lands on the follower's gear checklist (ticked = carried, as the card reads it), an item the follower
// already carries by that name kept as it is, a hand-written line left alone; the undefined ◇/□ reserved,
// and the load they make, are kept beside the list so the card can say them.
//
// The crew is not here: its load is its pip list, and its Supplies have their own Restock (p.472).

import { STONETOP_SCOPE, readableFlags } from "./StonetopFlags.js";
import { followerDetailBase, followerDetailFlags } from "./follower-roster.js";
import { LOAD_LEVEL_LIMITS, deriveLoadLevel, loadBandLabels } from "../../utils/load.js";
import { clampInt } from "../../utils/custom-move-data.js";

const sameName = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/** The catalog's rows a follower can be Outfitted from: the regular items and the small ones. PURE. */
export function outfitCatalog(pcOutfit) {
	const regular = (pcOutfit?.regularSegments ?? []).flatMap(seg => seg?.items ?? []);
	return { regular, small: pcOutfit?.smallItems ?? [], smallGrid: pcOutfit?.smallGridItems ?? [] };
}

/**
 * The window's snapshot for a follower: the character's catalog, each row marked when the follower carries
 * an item by that name, and the reserves last confirmed for them. PURE.
 *
 * @param {object} pcOutfit  the character's OutfitSnapshot (for the catalog, Prosperity and its allowance)
 * @param {Array<{label: string, checked: boolean}>} gear  the follower's checklist
 * @param {{regular?: number, small?: number}} [reserved]  the undefined ◇/□ last confirmed
 */
export function followerOutfitSnapshot(pcOutfit, gear = [], reserved = {}) {
	const carried = item => (gear ?? []).some(g => g?.checked && sameName(g.label, item?.name));
	const mark = item => ({ ...item, checked: carried(item) });
	const { regular, small, smallGrid } = outfitCatalog(pcOutfit);
	return {
		regularSegments: [{ items: regular.map(mark) }],
		smallItems:      small.map(mark),
		smallGridItems:  smallGrid.map(mark),
		smallItemLimit:  pcOutfit?.smallItemLimit ?? 4,
		prosperityKnown: !!pcOutfit?.prosperityKnown,
		loadLimits:      LOAD_LEVEL_LIMITS,
		loadBands:       loadBandLabels(LOAD_LEVEL_LIMITS),
		loadBonus:       0,
		loadBonusFrom:   "",
		regularPool:     { current: clampInt(reserved?.regular, 0, Infinity) },
		smallPool:       { current: clampInt(reserved?.small, 0, Infinity) },
	};
}

/**
 * The follower's checklist after an Outfit: every catalog item marked is carried (ticked, added if it was
 * not on the list), every catalog item left unmarked is unticked, and every line that names no catalog item
 * is left exactly as it was. PURE.
 *
 * @param {Array<{label: string, checked: boolean}>} gear
 * @param {object[]} catalogItems  every row the window offered ({slug, name})
 * @param {Record<string, boolean>} checked  the window's marks, by slug
 */
export function gearAfterOutfit(gear = [], catalogItems = [], checked = {}) {
	const out = (gear ?? []).map(g => {
		const item = catalogItems.find(i => sameName(i.name, g?.label));
		return item ? { label: g.label, checked: !!checked[item.slug] } : { label: g?.label ?? "", checked: !!g?.checked };
	});
	for (const item of catalogItems) {
		if (checked[item.slug] && !out.some(g => sameName(g.label, item.name))) out.push({ label: item.name, checked: true });
	}
	return out;
}

/** The load a follower's Outfit makes: its marked regular items' weight plus the ◇ reserved. PURE. */
export function followerOutfitLoad(catalogRegular = [], checked = {}, undefinedRegular = 0) {
	const weight = catalogRegular.filter(i => checked[i.slug]).reduce((sum, i) => sum + (Number(i.weight) || 0), 0);
	return deriveLoadLevel(weight + Math.max(0, Number(undefinedRegular) || 0));
}

/**
 * What the Outfit window writes through, standing in for the character it usually outfits: the window keys
 * itself on `_actor.id` (one per follower here) and confirms through `applyOutfit`.
 */
export class FollowerOutfitter {
	constructor(character, ftype, slug, pcOutfit) {
		this._character = character;
		this._ftype = ftype;
		this._slug = slug ?? "";
		this._catalog = outfitCatalog(pcOutfit);
		this._actor = { id: `${character?.id ?? ""}-${ftype}-${this._slug}` };
	}

	get base() { return followerDetailBase(this._ftype, this._slug); }

	async applyOutfit(checked = {}, undefinedRegular = 0, undefinedSmall = 0) {
		const base = this.base;
		if (!base) return;
		const details = followerDetailFlags(readableFlags(this._character), this._ftype, this._slug);
		const items = [...this._catalog.regular, ...this._catalog.small, ...this._catalog.smallGrid];
		const gear = gearAfterOutfit(Array.isArray(details.gear) ? details.gear : [], items, checked);
		await this._character.update({
			[`flags.${STONETOP_SCOPE}.${base}.gear`]: gear,
			[`flags.${STONETOP_SCOPE}.${base}.outfit`]: {
				regular: clampInt(undefinedRegular, 0, Infinity),
				small: clampInt(undefinedSmall, 0, Infinity),
				load: followerOutfitLoad(this._catalog.regular, checked, undefinedRegular),
			},
		}, { stonetopMove: "Outfit" });
	}
}
