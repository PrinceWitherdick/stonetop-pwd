// RESET INVENTORY, BACK HOME, for a character's followers and crew.
//
// "When you return home, clear the marks from your Inventory insert; it rarely matters what you're carrying
// while you're in town" (Book I p.89), and the GM's downtime list says it in two words: "Reset Inventory"
// (p.496). A character's own reset is StonetopCharacter#inventoryResetData. Followers "Outfit (page 306) just
// like PCs" (p.310), so they unpack the same way: what they carried is set down, what they reserved goes,
// and the food they took is eaten or put back in the larder. The lines on their lists stay, as a PC's
// special possessions do ("When you return home, leave it on your insert", p.90): only the marks go.
//
// Each reader returns an update FRAGMENT for the character the followers belong to, empty when there is
// nothing to clear, so a caller can merge several into ONE actor.update and ask "anything to clear?" with
// the same call. PURE: `flags` is the character's resolved flags (StonetopFlags.js#readableFlags).

import { STONETOP_SCOPE } from "./StonetopFlags.js";
import { followerDetailBase, followerDetailFlags } from "./follower-roster.js";
import { SUPPLY_SLUGS } from "./supply-cost.js";
import { deletionUpdate } from "../../utils/foundry-compat.js";

const count = v => Math.max(0, Math.trunc(Number(v) || 0));
const anyMarked = map => Object.values(map ?? {}).some(v => v === true || count(v) > 0);

/**
 * The crew unpacks: every gear pip emptied ("crew.gear", slug -> pips filled) and every member's set of
 * Supplies eaten ("crew.supplies", one count per member). The written-in lines (crew.writtenGear) stay,
 * and the supplies array keeps its length, so the roster's sets are where they were.
 */
export function crewResetData(flags) {
	const crew = flags?.crew ?? null;
	if (!crew) return {};
	const out = {};
	const gear = crew.gear && typeof crew.gear === "object" ? crew.gear : {};
	if (anyMarked(gear)) {
		out[`flags.${STONETOP_SCOPE}.crew.gear`] = Object.fromEntries(Object.keys(gear).map(slug => [slug, 0]));
	}
	const supplies = Array.isArray(crew.supplies) ? crew.supplies : [];
	if (supplies.some(n => count(n) > 0)) {
		out[`flags.${STONETOP_SCOPE}.crew.supplies`] = supplies.map(() => 0);
	}
	return out;
}

/**
 * One follower unpacks: every line on their gear checklist unticked, and what their last Outfit came to
 * (the load and the undefined ◇/□ it reserved, follower-outfit.js#FollowerOutfitter) forgotten, so the card
 * stops saying it. The crew's load is its pips and its Supplies (crewResetData); what one member produced
 * with Have What They Need sits on the crew's own checklist (crew.details.gear), unticked here like any
 * follower's.
 *
 * @param {object} flags  the character's resolved flags
 * @param {string} ftype  "animal-companion" | "initiate" | "beast" | "custom" | "crew"
 * @param {string} [slug]
 */
export function followerResetData(flags, ftype, slug = "") {
	const base = followerDetailBase(ftype, slug);
	if (!base) return {};
	const details = followerDetailFlags(flags, ftype, slug);
	const out = ftype === "crew" ? crewResetData(flags) : {};
	const gear = Array.isArray(details?.gear) ? details.gear : [];
	if (gear.some(g => g?.checked)) {
		out[`flags.${STONETOP_SCOPE}.${base}.gear`] = gear.map(g => ({ ...g, checked: false }));
	}
	if (details?.outfit && typeof details.outfit === "object") {
		Object.assign(out, deletionUpdate(`flags.${STONETOP_SCOPE}.${base}.outfit`));
	}
	return out;
}

/**
 * Whether a character has anything on their own Inventory to clear: an item or a special possession's
 * gear marked, a ◇/□ held in reserve, or food left in a supplies row. What their Reset Inventory would
 * change that a player can see.
 */
export function pcHasInventoryToClear(flags) {
	const inv = flags?.inventory ?? {};
	return anyMarked(inv.checked)
		|| count(inv.regularPool) > 0
		|| count(inv.smallPool) > 0
		|| anyMarked(flags?.possessions?.choiceCarried)
		|| SUPPLY_SLUGS.some(slug => count(inv.resources?.[slug]) > 0);
}

/** Whether a follower (or the crew) has anything to clear (followerResetData). */
export function followerHasInventoryToClear(flags, ftype, slug = "") {
	return Object.keys(followerResetData(flags, ftype, slug)).length > 0;
}
