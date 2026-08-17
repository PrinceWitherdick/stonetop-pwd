import { SYSTEM_ID } from "../system-id.js";
// Drag-a-move-onto-the-hotbar support.
//
// Dragging a learned, rollable move off a character sheet produces standard Foundry
// Item drag data ({ type: "Item", uuid: "Actor.<id>.Item.<id>" }) — the sheet's
// dragDrop config plus the inherited ActorSheet._onDragStart give us that for free.
// When that lands on the macro hotbar, `onHotbarDrop` turns it into a script macro
// that re-rolls the move through the same flow a click on its dice icon would, and
// drops the macro into the slot the player aimed at.
//
// The macro command routes through game.stonetop.rollMoveMacro (wired in Ready.js →
// rollMoveFromUuid) so the roll works with the sheet closed and survives the macro
// being copied around; the actor and move are re-resolved from the move's uuid.

const _FLAG_SCOPE = SYSTEM_ID;
const _MOVE_MACRO_FLAG = "moveMacro";
const _FALLBACK_IMG = "icons/svg/d20-black.svg";

// hotbarDrop hook: intercept only an owned move dragged from a character sheet, and
// leave every other drop (plain macros, non-move items, other systems' payloads) to
// core by returning nothing. Returning false tells core we've handled this one.
export function onHotbarDrop(hotbar, data, slot) {
	if (data?.type !== "Item" || !data.uuid) return;

	// Resolve synchronously so we can decide, in this sync hook, whether to claim the
	// drop. fromUuidSync returns the in-memory embedded item for an owned move; a
	// compendium move resolves to an index stub with no parent actor and is ignored
	// (there's no character to roll it against).
	let item = null;
	try {
		item = fromUuidSync(data.uuid);
	} catch {
		return;
	}
	if (item?.type !== "move" || !item.parent) return;

	// The macro is a script macro; a player without that permission can't create one.
	// Warn and still claim the drop (returning false) so core's default doesn't drop a
	// broken/confusing fallback into the slot.
	if (!game.user.can("MACRO_SCRIPT")) {
		ui.notifications.warn("You don't have permission to create script macros, so this move can't become a hotbar macro.");
		return false;
	}

	// Fire-and-forget: Macro.create/assignHotbarMacro are async, but the hook must return
	// synchronously to suppress core's default handling. Catch here so an async failure
	// surfaces as a notification instead of an unhandled rejection with an empty slot.
	_createMoveHotbarMacro(item, slot).catch(err => {
		console.error("Stonetop | Couldn't create the move hotbar macro:", err);
		ui.notifications.error(`Couldn't create a hotbar macro for ${item.name} (see the console for details).`);
	});
	return false;
}

// Find-or-create the script macro for this move and place it in the dropped slot.
// Idempotent per move: a macro we already made for the same move uuid is reused (and
// its name/icon refreshed if the move was renamed/re-arted) rather than duplicated.
async function _createMoveHotbarMacro(item, slot) {
	const uuid = item.uuid;
	const command = `game.stonetop?.rollMoveMacro?.(${JSON.stringify(uuid)});`;
	const img = item.img || _FALLBACK_IMG;

	let macro = game.macros.find(m => m.getFlag(_FLAG_SCOPE, _MOVE_MACRO_FLAG) === uuid);
	if (!macro) {
		macro = await Macro.create({
			name: item.name,
			type: "script",
			img,
			command,
			scope: "global",
			flags: { [_FLAG_SCOPE]: { [_MOVE_MACRO_FLAG]: uuid } },
		});
	} else {
		const patch = {};
		if (macro.name !== item.name) patch.name = item.name;
		if (macro.img !== img) patch.img = img;
		if (macro.command !== command) patch.command = command;
		if (Object.keys(patch).length) await macro.update(patch);
	}

	if (macro) await game.user.assignHotbarMacro(macro, slot);
}

// Roll a move from its uuid — the entry point every move hotbar macro calls. Re-resolves
// the actor and move so the macro keeps working with the sheet closed, then hands off to
// the character sheet's rollMoveById (guided/ask-stat/alt-stat/modifier-prompt flow). Any
// non-Stonetop sheet falls back to a plain item.roll().
export async function rollMoveFromUuid(uuid) {
	let item = null;
	try {
		item = await fromUuid(uuid);
	} catch {
		item = null;
	}
	if (!item) return void ui.notifications.warn("That move no longer exists.");

	const actor = item.parent;
	if (!actor) return void ui.notifications.warn("That move isn't attached to a character.");

	const sheet = actor.sheet;
	if (typeof sheet?.rollMoveById === "function") return sheet.rollMoveById(item.id);

	// Fallback for a non-Stonetop character sheet: roll the move directly, without the
	// sheet-driven pre-roll prompts.
	return item.roll();
}
