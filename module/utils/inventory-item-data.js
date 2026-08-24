import { ITEM_FLAG_SCOPE } from "../system-id.js";

/**
 * Shape a custom inventory item's document data, shared by every save target: the
 * actor-embedded item (moveType "inventory-custom", via createCustomInventoryItem)
 * and the reusable world Item the GM drags onto any sheet (moveType "inventory",
 * whose drop re-plants an "inventory-custom" copy). Returns `{ name, type, system }`.
 * Pure (no Foundry calls) so it stays unit-testable.
 *
 * @param {object}  input
 * @param {string}  input.name
 * @param {string} [input.column="regular"]   "regular" | "small"
 * @param {number} [input.weight=1]           ◇ load (regular column only)
 * @param {string} [input.note=""]            freeform tags/notes (already <em>-wrapped)
 * @param {object|null} [input.resource=null] { max, title, labels } uses/ammo track
 * @param {object|null} [input.armor=null]    { modifier } worn armor
 * @param {string} [input.moveType="inventory"] item's moveType
 * @param {boolean} [input.isTreasure=false]  a Book II journal treasure — groups the
 *        item under the gear tab's "Treasures" heading rather than the write-in columns
 * @param {string|null} [input.img=null]      document art. Omitted when falsy so Foundry
 *        applies its own default rather than being pinned to an empty path.
 * @param {object|null} [input.artifact=null] identification state for an artifact the GM has
 *        hidden — { state, hint, lore, lead }, see actors/character/artifact-identify.js. Each
 *        key is written only when non-empty, so ordinary gear carries none of them and reads
 *        exactly as it did before the feature existed.
 */
export function buildInventoryItemData({ name, column = "regular", weight = 1, note = "", resource = null, armor = null, moveType = "inventory", isTreasure = false, img = null, artifact = null }) {
	const isRegular = column !== "small";
	const system = {
		moveType,
		inventoryColumn: isRegular ? "regular" : "small",
	};
	if (isRegular) {
		const w = Number(weight);
		system.weight = Math.max(1, Number.isFinite(w) ? w : 1);
	}
	if (note) system.note = note;
	if (resource) system.resource = resource;
	if (armor) system.armor = armor;
	if (isTreasure) system.isTreasure = true;
	if (artifact?.state) system.identifyState = artifact.state;
	if (artifact?.hint)  system.artifactHint  = artifact.hint;
	if (artifact?.lore)  system.artifactLore  = artifact.lore;
	if (artifact?.lead)  system.artifactLead  = artifact.lead;
	const data = { name: String(name ?? "").trim() || "New Item", type: "move", system };
	if (img) data.img = img;
	return data;
}


/**
 * The inverse of buildInventoryItemData: resolve one item document's gear metadata out of
 * WHEREVER it is actually stored.
 *
 * Gear metadata lives in two places by design. Shipped catalog items carry it under
 * `flags.stonetop` (packs/src/stonetop-items/inventory-items/*.json); anything authored in play
 * writes `system.*` through the builder above; a dragged Book II treasure writes both
 * (utils/treasure-drops.js). Flags win, because a catalog item that has been re-planted onto a
 * sheet carries the catalog values in its flags and the sheet copy's in `system`.
 *
 * One reader, for the same reason there is one builder: every consumer that resolved these
 * field-by-field for itself resolved a slightly different set in a slightly different order —
 * the item sheet read `system.armor` alone, so a hauberk that stores its 2 armor in flags showed
 * none at all, and it preferred `system.isTreasure` where the drop path prefers the flag.
 *
 * Returns raw values, NOT defaults: `undefined` means "the document does not say", which is what
 * lets each caller apply its own fallback (a drop lands at weight 1; a readout prints nothing).
 *
 * @param {object} itemData  anything shaped like an Item — `{ system, flags }`
 * @returns {{column: string|undefined, weight: *, note: string, resource: object|null,
 *           armor: object|null, isTreasure: boolean,
 *           artifact: {state: *, hint: string, lore: string, lead: string}}}
 */
export function readInventoryItemData(itemData) {
	const st  = itemData?.flags?.[ITEM_FLAG_SCOPE] ?? {};
	const sys = itemData?.system ?? {};
	return {
		// `column` is the legacy spelling of inventoryColumn; a drop off an old world can carry it.
		column:     st.inventoryColumn ?? sys.inventoryColumn ?? st.column ?? sys.column,
		weight:     st.weight ?? sys.weight,
		note:       st.note ?? sys.note ?? "",
		resource:   st.resource ?? sys.resource ?? null,
		armor:      st.armor ?? sys.armor ?? null,
		isTreasure: !!(st.isTreasure ?? sys.isTreasure),
		artifact: {
			state: st.identifyState ?? sys.identifyState,
			hint:  st.artifactHint  ?? sys.artifactHint  ?? "",
			lore:  st.artifactLore  ?? sys.artifactLore  ?? "",
			lead:  st.artifactLead  ?? sys.artifactLead  ?? "",
		},
	};
}
