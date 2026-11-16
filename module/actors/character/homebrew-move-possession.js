// A HOMEBREW move that hands its character one of the playbook's special possessions ("Mark the Poisons
// special possession", the Stranger's Poisoner): when the move is learned, however it arrives (Level Up,
// a tick on the Moves tab, character creation, a drop), the possession is marked as if picked, its gear
// with it (StonetopCharacter#selectPossession). Taking the move away leaves the possession: it is the
// player's to untick, as any possession is.
//
// A book move's possession rules are the code's own (crossPlaybook.grantsPossession), never read here.

import { possessionMarkedFrom, possessionMatching } from "../../playbooks/move-words.js";
import { playbookTextFromHtml } from "../../playbooks/playbook-text.js";
import { HOMEBREW_MOVE_FLAG } from "../../playbooks/playbook-catalog.js";
import { SYSTEM_ID } from "../../system-id.js";
import { moveLearnedIn } from "./owns-move.js";

/**
 * The possession option (`{slug, label}`) a learned homebrew `item`'s words hand over, from `options`
 * (the playbook's special possessions), or null. Pure.
 */
export function possessionGrantedByMove(item, options, items = item?.parent?.items) {
	if (item?.type !== "move" || !item.flags?.[SYSTEM_ID]?.[HOMEBREW_MOVE_FLAG]) return null;
	if (items && !moveLearnedIn(item, items)) return null;
	const name = possessionMarkedFrom(playbookTextFromHtml(item.system?.description ?? ""));
	return name ? possessionMatching(name, options) : null;
}

/**
 * Mark the possession `item` hands over on its character, when it isn't held already. Whether it did.
 * A book move hands over nothing here, so it never waits on the playbook.
 */
export async function markPossessionFromMove(item) {
	const actor = item?.parent;
	const character = actor?.type === "character" ? actor.typedActor : null;
	if (!character?.playbook || !item.flags?.[SYSTEM_ID]?.[HOMEBREW_MOVE_FLAG]) return false;
	const playbookData = await character.playbook();
	const opt = possessionGrantedByMove(item, playbookData?.specialPossessions?.options ?? []);
	if (!opt || await character.holdsPossession(opt.slug, playbookData)) return false;
	await character.selectPossession(opt.slug);
	ui.notifications?.info?.(`${actor.name}: ${item.name} marks ${playbookTextFromHtml(opt.label ?? opt.slug)}.`);
	return true;
}

export function registerMovePossessionGrants() {
	// On the client that made the move, so it is done once. A move switched on later (learned) counts too.
	const run = (item, userId) => {
		if (userId !== globalThis.game?.user?.id || item?.parent?.type !== "character" || item.type !== "move") return;
		markPossessionFromMove(item).catch(err => console.error("Stonetop | marking a move's possession failed", err));
	};
	Hooks.on("createItem", (item, _opts, userId) => run(item, userId));
	Hooks.on("updateItem", (item, change, _opts, userId) => { if (change?.flags?.[SYSTEM_ID]?.learned === true) run(item, userId); });
}
