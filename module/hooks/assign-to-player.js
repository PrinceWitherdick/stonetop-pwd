import { contextMenuEntry, deletionEntry } from "../utils/foundry-compat.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { escHtml as esc } from "../utils/strings.js";
import { PERSON_ACTOR_TYPES } from "../utils/actor-types.js";

/**
 * "Assign to Player…" on an actor's right-click menu in the Actors sidebar, GM only.
 *
 * User Configuration's Character dropdown offers playbook characters alone
 * (user-config-characters.js), which is right for the everyday case. This is the way round
 * it on purpose: a GM handing a player an NPC to run (a hireling taking over after a death,
 * say) picks the actor first, then the player.
 *
 * Setting `User#character` grants nothing by itself, so the pick also makes the player an
 * owner of the actor; without that they could not open the sheet or move the token. Anyone
 * who held the actor before is released, since one actor is one player's character: no longer
 * their character, and no longer an owner of it either, or they could still run it.
 */

/** The users a GM can hand an actor to. */
function players() {
	return game.users.filter(u => !u.isGM);
}

/** The world actor a sidebar row stands for. */
function actorOfRow(target) {
	return game.actors.get(target?.dataset?.entryId) ?? null;
}

/** The menu entry, readable by both v13 and v14 cores. */
export function assignToPlayerEntry() {
	return contextMenuEntry({
		label: "Assign to Player…",
		icon: "fa-solid fa-user-plus",
		visible: target => {
			const actor = actorOfRow(target);
			return !!game.user.isGM && !!actor && PERSON_ACTOR_TYPES.has(actor.type) && players().length > 0;
		},
		run: target => assignToPlayer(actorOfRow(target)),
	});
}

/** Put the entry just after core's Configure Ownership, the nearest thing to it. */
function addEntry(_directory, options) {
	const after = options.findIndex(o => (o.label ?? o.name) === "OWNERSHIP.Configure");
	options.splice(after < 0 ? options.length : after + 1, 0, assignToPlayerEntry());
}

/** Ask which player takes the actor, then hand it over (or release it). */
export async function assignToPlayer(actor) {
	if (!actor) return;
	const holder = game.users.find(u => u.character?.id === actor.id) ?? null;
	const content = [
		`<p>Who should play <strong>${esc(actor.name)}</strong>?</p>`,
		holder ? `<p>${esc(holder.name)} plays ${esc(actor.name)} now.</p>` : "",
		`<p class="hint">The player becomes an owner of ${esc(actor.name)}, and it becomes their character in place of any they have now. A character they had stays theirs to own.${holder ? ` ${esc(holder.name)} stops owning ${esc(actor.name)}.` : ""}</p>`,
	].join("");
	const choice = await askWithButtons({
		title: `Assign ${actor.name} to a Player`,
		content,
		buttons: [
			...players().map(user => user === holder
				? { key: user.id, label: `Release from ${user.name}`, icon: "fa-user-minus", value: { user, release: true } }
				: {
					key: user.id,
					label: user.character ? `Give to ${user.name}, instead of ${user.character.name}` : `Give to ${user.name}`,
					icon: "fa-user-plus",
					value: { user, release: false },
				}),
			{ key: "cancel", label: "Leave it as it is", icon: "fa-xmark", value: null },
		],
		// This writes to users and the actor, so Enter does nothing.
		defaultKey: "cancel",
	});
	if (!choice) return;
	const { user, release } = choice;
	// The previous holder's own ownership entry goes, so the actor falls back to its default for them.
	const disown = who => actor.update(Object.fromEntries([deletionEntry(`ownership.${who.id}`)]));
	try {
		if (release) {
			await user.update({ character: null });
			await disown(user);
			ui.notifications?.info?.(`${actor.name} is no longer ${user.name}'s character.`);
			return;
		}
		if (!actor.testUserPermission(user, "OWNER")) {
			await actor.update({ [`ownership.${user.id}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
		}
		if (holder && holder !== user) {
			await holder.update({ character: null });
			await disown(holder);
		}
		await user.update({ character: actor.id });
		ui.notifications?.info?.(`${actor.name} is now ${user.name}'s character.`);
	} catch (err) {
		console.error("Stonetop | failed to assign actor to player", err);
		ui.notifications?.error?.(`Couldn't make ${actor.name} ${user.name}'s character.`);
	}
}

/** Register the menu entry. Call once, in init. */
export function registerAssignToPlayer() {
	Hooks.on("getActorContextOptions", addEntry);
}
