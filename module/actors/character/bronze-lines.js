// BRONZE WEAPONS, ONE LINE EACH. Book I p.95 prices bronze weapons as two kinds, "Common weapons (spears,
// daggers, etc.)" and "Weapons of war (see above)", but each bronze weapon is a thing of its own: "a bronze
// spear" is a Value 0 special item (p.93), and a character may own a bronze spear and a bronze dagger at once.
//
// The handout row is one inventory row per character (inventory.addedSpecial is a list of slugs), so a SECOND
// bronze weapon of the same kind is its own line: a write-in (`inventory-custom`) stamped with the row it stands
// for (BRONZE_COPY_FLAG). Each line is asked once which weapon it is (combat/attack-flow.js#settleBronzeWeapon),
// and the answer is kept under that line's own key (the row's slug, or the write-in's item id), so every line
// keeps its own weapon. Selling one takes off the line the player names, and its answer with it.

import { ITEM_FLAG_SCOPE } from "../../system-id.js";
import { STONETOP_SCOPE } from "./StonetopFlags.js";
import { BRONZE_WEAPONS, bronzeMeta } from "../../data/weapons.js";
import { buildInventoryItemData } from "../../utils/inventory-item-data.js";
import { deletionEntry } from "../../utils/foundry-compat.js";

/** The item flag a write-in bronze line carries: the handout row's slug it stands for. */
export const BRONZE_COPY_FLAG = "bronzeOf";

/** Whether `slug` is one of the handout's bronze rows. */
export const isBronzeRow = slug => !!BRONZE_WEAPONS[slug];

/** The bronze row a write-in stands for, or null. */
export function bronzeRowOf(item) {
	const slug = item?.flags?.[ITEM_FLAG_SCOPE]?.[BRONZE_COPY_FLAG] ?? null;
	return isBronzeRow(slug) ? slug : null;
}

/** The write-in lines `actor` holds for the bronze row `slug`. */
export function bronzeCopies(actor, slug) {
	return [...(actor?.items ?? [])].filter(i => i?.type === "move" && i.system?.moveType === "inventory-custom" && bronzeRowOf(i) === slug);
}

/** Which weapon each bronze line was said to be, by line key. */
function bronzeAnswers(actor) {
	return actor?.getFlag?.(STONETOP_SCOPE, "inventory.bronzeAs") ?? {};
}

/**
 * Every line of the bronze row `slug` that `actor` holds, as `{key, item, label}`: the handout row itself (no
 * `item`) when it was added, then each write-in. The label is the weapon it was said to be ("Bronze spear"),
 * else the row's name, so a sale can name the one that goes.
 *
 * @param {Actor} actor
 * @param {string} slug
 * @param {{addedSpecial: string[]}} inventory  the character's inventory (CharacterInventory)
 * @param {string} rowName  the handout row's name ("Common weapons, bronze")
 */
export function bronzeLines(actor, slug, inventory, rowName) {
	const said = bronzeAnswers(actor);
	const label = (key, fallback) => bronzeMeta(said?.[key])?.name ?? fallback;
	const lines = inventory.addedSpecial.includes(slug) ? [{ key: slug, item: null, label: label(slug, rowName) }] : [];
	for (const item of bronzeCopies(actor, slug)) lines.push({ key: item.id, item, label: label(item.id, item.name || rowName) });
	return lines;
}

/** Add another bronze weapon of the row `special` names, as a write-in line of its own. */
export async function addBronzeLine(actor, special) {
	const data = buildInventoryItemData({
		name: `${special.name}, bronze`,
		weight: 1,
		note: `<em>${special.traits}</em>; no <em>x piercing</em>`,
		moveType: "inventory-custom",
	});
	data.flags = { [ITEM_FLAG_SCOPE]: { [BRONZE_COPY_FLAG]: special.slug } };
	await actor.createEmbeddedDocuments("Item", [data]);
}

/** Forget the answer kept under a bronze write-in's id, if there is one. */
async function forgetAnswer(actor, id) {
	if (!actor?.update || !(id in bronzeAnswers(actor))) return;
	const [path, value] = deletionEntry(`flags.${STONETOP_SCOPE}.inventory.bronzeAs.${id}`);
	await actor.update({ [path]: value });
}

/**
 * Take one bronze line off: the handout row (CharacterInventory#removeSpecial, which forgets its answer too), or
 * a write-in and the answer kept under its id. The answer goes first, so the deleteItem hook below finds nothing
 * left to forget.
 */
export async function removeBronzeLine(actor, slug, line, inventory) {
	if (!line?.item) return inventory.removeSpecial(slug);
	await forgetAnswer(actor, line.item.id);
	await actor.deleteEmbeddedDocuments("Item", [line.item.id]);
}

/**
 * `deleteItem`: a bronze write-in deleted any other way (its trash button on the sheet) takes its answer with it.
 * Written by the client that deleted it, the one that could.
 */
export function onBronzeLineDeleted(item, _options, userId, me = globalThis.game?.user?.id) {
	if (userId !== me || !bronzeRowOf(item)) return null;
	return forgetAnswer(item.parent, item.id).catch(err => console.warn("Stonetop | could not forget a bronze weapon's answer", err));
}

/** Registered once, at module scope in stonetop.js. */
export function registerBronzeLineHooks(hooks = globalThis.Hooks) {
	hooks?.on?.("deleteItem", onBronzeLineDeleted);
}
