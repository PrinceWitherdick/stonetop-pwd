import { OutfitItemBuilder } from "../../../model/OutfitItem.js";
import { FoundryPackStore } from "./FoundryPackStore.js";
import { ITEM_FLAG_SCOPE, ITEMS_PACK } from "../StonetopFlags.js";

const FIELDS = [
	"system.moveType",
	...["slug", "inventoryColumn", "sortOrder", "weight", "note", "resource",
	    "resourceFirst", "prosperityResource", "breakBefore", "smallGrid", "twoCol", "armor",
	    "special", "specialCategory", "isTreasure"]
		.map(f => `flags.${ITEM_FLAG_SCOPE}.${f}`),
];

export class FoundryOutfitItemRepository {
	constructor() {
		this._store = new FoundryPackStore(ITEMS_PACK, FIELDS);
		this._cache = null;
	}

	async getAll() {
		if (this._cache) return this._cache;
		// Book II treasures share the "inventory" moveType but are NOT part of the
		// buyable gear catalog — they live in the "Treasures & Wonders" folder and are
		// found/dragged in play. Keep them out of the outfit picker's shopping list.
		const entries = await this._store.filterEntries(e =>
			e.system?.moveType === "inventory" && !e.flags?.[ITEM_FLAG_SCOPE]?.isTreasure);
		this._cache = entries
			.sort((a, b) => (a.flags?.[ITEM_FLAG_SCOPE]?.sortOrder ?? 0) - (b.flags?.[ITEM_FLAG_SCOPE]?.sortOrder ?? 0))
			.map(item => {
				const st = item.flags?.[ITEM_FLAG_SCOPE] ?? {};
				return new OutfitItemBuilder()
					.withSlug(st.slug)
					.withName(item.name)
					.withWeight(st.weight ?? 0)
					.withNote(st.note ?? null)
					.withInventoryColumn(st.inventoryColumn ?? null)
					.withResource(st.resource ?? null)
					.withResourceFirst(st.resourceFirst ?? false)
					.withProsperityResource(st.prosperityResource ?? false)
					.withTwoCol(st.twoCol ?? false)
					.withSmallGrid(st.smallGrid ?? false)
					.withBreakBefore(st.breakBefore ?? false)
					.withArmor(st.armor ?? null)
					.withShield(st.shield ?? false)
					.withSpecial(st.special ?? false)
					.withSpecialCategory(st.specialCategory ?? null)
					.build();
			});
		return this._cache;
	}
}
