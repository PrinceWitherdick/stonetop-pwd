// What an inventory item's OWN sheet shows.
//
// The gear row on a character sheet has long printed a thing's whole entry: its ◇ load, its
// tags-and-Value parenthetical, its ○ uses track, and — since the artifact ladder landed
// (Book I pp.430-431) — the GM's hint, the book's write-up and the lead. The item's own sheet
// printed the name, a weight and a note, and nothing else. So a Book II treasure carried its
// write-up on the document, showed it on a character's Gear tab, and showed nothing of it in
// the Items sidebar or in the compendium the treasure was dragged out of.
//
// Two separate causes, both answered here:
//
//   1. Gear metadata lives in TWO places by design, and the sheet read only the flags half,
//      so a hand-written or dropped item's note and weight were simply absent. WHICH store
//      wins is decided by readInventoryItemData (utils/inventory-item-data.js, beside the
//      builder that writes them), so nothing here resolves a field for itself any more.
//   2. The artifact fields (`system.artifactHint` / `artifactLore` / `artifactLead`) were read
//      by buildSnapshot alone, so the write-up reached a character's Gear tab and nowhere else.
//
// Concealment is applied HERE, through the same concealArtifactFields the gear row uses, so an
// artifact the GM has hidden gives no more away on its own sheet than it does on the row — a
// player opening the item from their inventory must not be handed a write-up the ladder is
// still withholding.
//
// Pure: no Foundry calls, nothing read beyond the plain object handed in, so the rule is
// unit-testable on its own. The sheet enriches the HTML and does the DOM.

import { readInventoryItemData } from "../utils/inventory-item-data.js";
import { concealArtifactFields, artifactVisibility } from "../actors/character/artifact-identify.js";

/**
 * `move` is the catch-all Item sub-type, so `system.moveType` decides. These two are THINGS a
 * character carries — the only kinds with a load, tags, uses or an armor value to print. Every
 * other moveType (basic, playbook, special, …) is a move, and a move's readout is its
 * description alone. Same split utils/item-icon.js draws for the sidebar marker.
 */
const GEAR_MOVE_TYPES = new Set(["inventory", "inventory-custom"]);

/** Is this document a piece of carried gear rather than a move? */
export function isGearItem(item) {
	return item?.type === "move" && GEAR_MOVE_TYPES.has(item?.system?.moveType);
}

/**
 * The ○ uses track as a static readout: no actor owns this document, so there is no "current"
 * to fill in and every circle is drawn empty. Returns null for a thing with no track, so the
 * template's `{{#if}}` drops the whole chip.
 */
function usesTrack(resource) {
	const max = Number(resource?.max);
	if (!Number.isFinite(max) || max <= 0) return null;
	const labels = Array.isArray(resource.labels) ? resource.labels : [];
	// Cap the drawn circles the way the journal's treasure badge does: past a dozen a track is
	// a number rather than a picture, and drawing every one would wrap the card into a wall.
	const drawn = Math.min(Math.trunc(max), 12);
	return {
		title: resource.title ?? null,
		max:   Math.trunc(max),
		marks: Array.from({ length: drawn }, (_, i) => ({ label: labels[i] || null })),
	};
}

/**
 * The worn-armor value an authored item carries in `system.armor` — `base` for armor proper
 * (leather/mail, max-wins) and `modifier` for a shield (additive). CharacterInventory
 * .calculateArmor is what actually consumes these; this only prints them.
 *
 * Suppressed when the item's own tags already say it. Shipped catalog gear spells the value out
 * in its note ("+1 armor, +1 Readiness on 7+ to Defend") AND stores it structurally, so printing
 * both would have the shield say "+1 armor" twice on one card. An item typed through the Add
 * Item dialog stores the number with no tag to match, and that is the case this chip is for.
 */
function armorChip(armor, note) {
	const base = Number(armor?.base);
	const mod  = Number(armor?.modifier);
	const hasBase = Number.isFinite(base) && base > 0;
	const hasMod  = Number.isFinite(mod)  && mod !== 0;
	if (!hasBase && !hasMod) return null;
	if (/\barmou?r\b/i.test(String(note ?? ""))) return null;
	const parts = [];
	if (hasBase) parts.push(`${base} armor`);
	if (hasMod)  parts.push(`${mod > 0 ? "+" : ""}${mod} armor`);
	return parts.join(", ");
}

/**
 * Everything the item sheet's plain readout prints, gathered from wherever the document
 * actually stores it.
 *
 * @param {object}  item  anything shaped like an Item — `{ name, type, system, flags }`
 * @param {object}  [options]
 * @param {boolean} [options.viewerIsGM=false]  the GM sees a concealed artifact whole; defaults
 *        to false so a caller that forgets to say conceals rather than leaks.
 * @returns {object} `{ name, isGear, small, isTreasure, weight, note, uses, armor, artifact, description }`
 */
export function buildItemReadout(item, { viewerIsGM = false } = {}) {
	const sys   = item?.system ?? {};
	const gear  = isGearItem(item);
	// Flags first, `system` second, through the one reader that knows where each field lives
	// (utils/inventory-item-data.js) — so an item carrying both resolves to the same values here
	// as it does once it has been dropped onto a sheet.
	const read  = readInventoryItemData(item);
	const small = gear && read.column === "small";

	const artifact = concealArtifactFields({
		state:    read.artifact.state,
		note:     read.note || null,
		resource: read.resource,
		hint:     read.artifact.hint,
		lore:     read.artifact.lore,
		lead:     read.artifact.lead,
	}, { viewerIsGM });

	// The ◇ load. Small items carry none by definition, and a move has no load at all. NEVER
	// concealed, even on an unidentified artifact: p.428 has the PCs accounting for a thing's
	// load the moment they pick it up (see artifactVisibility).
	const rawWeight = Number(read.weight);
	const weight = (gear && !small && Number.isFinite(rawWeight)) ? Math.max(0, Math.trunc(rawWeight)) : 0;

	// The last two readouts are GEAR ones, gated on `gear` the same way the load and the "small"
	// chip are. A move can carry a resource track of its own — Piety's Blessing, the Logbook's
	// two uses — but the move's own text is what defines that track, and the chip's tooltip
	// speaks of ticking the circles on the sheet of "whoever is carrying it", which is nobody for
	// a move. Fifteen shipped playbook moves were drawing a gear chip on their own card.
	//
	// Armor is withheld exactly while the tags are (artifactVisibility): the value IS what a tag
	// would say, so printing it on a still-unidentified artifact hands over the thing the ladder
	// is holding back. And its "the tags already say it" suppression reads the item's OWN note
	// rather than the concealed one — a concealed note is null, which matches no /armor/, so the
	// test ran backwards and the hidden artifact printed the value the identified one hides.
	const showsTags = artifactVisibility(read.artifact.state, { viewerIsGM }).showNote;

	return {
		name:        item?.name ?? "",
		isGear:      gear,
		small,
		isTreasure:  read.isTreasure,
		weight,
		note:        artifact.note ?? "",
		uses:        gear ? usesTrack(artifact.resource) : null,
		armor:       (gear && showsTags) ? armorChip(read.armor, read.note) : null,
		artifact,
		description: sys.description ?? "",
	};
}
