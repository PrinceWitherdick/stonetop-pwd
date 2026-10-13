/**
 * User Configuration's Character dropdown offers playbook characters only.
 *
 * Core builds that list from every actor the player can observe (UserConfig's private
 * #characterChoiceWidget, identical in v13 and v14), so a world's NPCs, monsters, the
 * steading and the GM Toolkit all show up beside the PCs. A player's character in
 * Stonetop is always a `character` actor, so the hook prunes everything else.
 *
 * And a PLAYER choosing for themselves is offered only the characters they own. Every
 * player can observe every character (actors/character/shared-sheets.js), and core lets a
 * player set their own `character`, so without this one could claim a friend's unassigned
 * PC or one the GM is still preparing, and everything that reads `user.character` as "mine"
 * would follow them there. A GM assigning someone is choosing on purpose and sees the lot.
 *
 * The one exception is whatever the user already has assigned: dropping that option
 * would leave the select blank and Save would quietly release it. It stays listed so
 * the GM sees it and can release it on purpose.
 */

/** Actor type a player may take as their character. */
const PLAYER_CHARACTER_TYPE = "character";

/** Strip non-PC actors from a rendered UserConfig's Character select. */
export function pruneCharacterChoices(app, element) {
	// v13+ passes the root HTMLElement; tolerate jQuery like window-theme.js does.
	const root = element?.jquery ? element[0] : element;
	const select = root?.querySelector?.("select[name=character]");
	if (!select) return;
	const user = app?.document ?? null;
	const assignedId = user?.character?.id ?? null;
	const ownedOnly = !game.user?.isGM;
	for (const option of [...select.querySelectorAll("option")]) {
		if (!option.value || option.value === assignedId) continue;
		const actor = game.actors.get(option.value);
		if (actor?.type !== PLAYER_CHARACTER_TYPE) option.remove();
		else if (ownedOnly && !actor.testUserPermission?.(user, "OWNER")) option.remove();
	}
	// Core groups the choices by Owner / Observer; drop a group pruning left empty.
	for (const group of [...select.querySelectorAll("optgroup")]) {
		if (!group.querySelector("option")) group.remove();
	}
}

/** Register the prune on User Configuration. Call once, in init. */
export function registerUserConfigCharacterFilter() {
	Hooks.on("renderUserConfig", pruneCharacterChoices);
}
