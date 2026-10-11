// Shared "player character" helpers. Only player characters carry a playbook, so
// "has a playbook" is the system-wide test for which actors are PCs — used by the
// Introductions and Let-Spring-Burst walkthroughs, the playbook picker, and the
// character sheet's avatar art.

import { WBH_PLAYBOOK_NAME, WBH_HERO_FLAG, heroDisplayName } from "../actors/character/WouldBeHeroAsterisk.js";
import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { playbookSlug } from "./playbook-slug.js";

// Lives one module down, and is re-exported from here because this is where callers look
// for it and twenty of them already import it by this path. It had to move: the Would-Be
// Hero's own rules guards need it, and this file imports THEM for the epithet below, so
// leaving it here made the two files import each other. See playbook-slug.js.
export { playbookSlug };

/**
 * A character's playbook as it should READ — "The Lightbearer", "The Blessed" — or "" for
 * an actor who hasn't picked one. This is the sheet header's name, not the stored one: a
 * Would-Be Hero who has crossed off "Would-be" is "The Hero" everywhere they are named.
 *
 * Crossed off means the flag (WBH_HERO_FLAG), written on the first USE of an asterisked
 * move and never taken back: owning one is not using it (WouldBeHeroAsterisk.js).
 */
export function playbookTitle(actor) {
	const name = actor?.system?.playbook?.name ?? "";
	if (name !== WBH_PLAYBOOK_NAME) return name;
	return heroDisplayName(name, !!actor?.getFlag?.(STONETOP_SCOPE, WBH_HERO_FLAG));
}

/**
 * Whether an actor update touched what `playbookTitle` reads: the playbook itself (picked, swapped
 * or cleared from the sheet) or the Would-Be Hero's cross-off flag, which renames the playbook
 * without touching it.
 *
 * `changed` reaches an update hook expanded, so a dotted `system.playbook.name` write and a
 * whole-object `system.playbook` one both land here. Both deletion shapes count too: dropping a
 * playbook has to drop its title as readily as picking one adds it.
 *
 * ⚠ The flag bag is read with BRACKETS: the package id is hyphenated, so a dotted
 * `changed.flags.stonetop-pwd` parses as a subtraction and throws at runtime.
 *
 * @param {object} changed  the update that was applied
 */
export function playbookTitleChanged(changed) {
	const bag = changed?.flags?.[STONETOP_SCOPE];
	if (bag && (WBH_HERO_FLAG in bag || `-=${WBH_HERO_FLAG}` in bag)) return true;
	const sys = changed?.system;
	return !!sys && ("playbook" in sys || "-=playbook" in sys);
}

/**
 * A player character named the way the table says them out loud: "Pim The Lightbearer".
 *
 * DISPLAY ONLY — the Actor document keeps the bare name it was given. The playbook is not
 * part of who somebody is on disk: it can be swapped, and it renames itself mid-campaign (see
 * `playbookTitle`). What a document is NAMED is therefore the least stable thing about it, and
 * every subsystem that has to remember a particular person keys off something else — the
 * steading roster stores `{uuid, id, name}` pointers, relationships are a map of actor id,
 * follower cards carry `actorUuid`/`sourceUuid`, and the chronicle finds a page by its
 * `chronicleKey` flag. None of them would be stranded by an epithet; they would simply carry a
 * stale label until the next resolve.
 *
 * (An earlier version of this note claimed all four matched BY name and cited that as the reason
 * not to bake the epithet in. It was not true of any of them. The reason below is, and it is
 * enough on its own.)
 *
 * The reason is doubling: the name on disk is already spoken in places that add the title
 * themselves, so a chat speaker would come out "Pim The Lightbearer The Lightbearer" (see the
 * alias stamp in stonetop.js). Surfaces that want the long form ask for it here.
 *
 * Falls back to the plain name, so it is safe to call on any actor.
 */
export function characterFullName(actor) {
	const name  = actor?.name ?? "";
	const title = playbookTitle(actor);
	return title && name ? `${name} ${title}` : name;
}

/** Every world actor that is a player character (a `character` with a playbook). */
export function getPlayerCharacters() {
	return (game.actors?.contents ?? []).filter(a => a.type === "character" && playbookSlug(a));
}

/**
 * The characters a relationships table offers as rows: every `character` actor except
 * `exclude` (an actor id — a sheet never rates itself), preferring the player-owned ones
 * when any exist. The fallback to all characters keeps the section populated while a GM
 * preps, before players have been assigned. Shared so the NPC and character sheets can
 * never disagree about who counts as the party.
 */
export function partyCharacters({ exclude = null } = {}) {
	const chars = (game.actors?.contents ?? []).filter(a => a.type === "character" && a.id !== exclude);
	const owned = chars.filter(a => a.hasPlayerOwner);
	return owned.length ? owned : chars;
}

/**
 * Every `character` the given user explicitly owns — using the per-user OWNER
 * entry, not a GM's blanket ownership, so it returns only the PCs actually
 * assigned to that player.
 */
export function charactersOwnedBy(userId) {
	const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
	return (game.actors?.contents ?? []).filter(
		a => a.type === "character" && (a.ownership?.[userId] ?? 0) >= owner,
	);
}

/** A world collection (`game.users`, `game.actors`) as a plain array, whatever shape it arrives in. */
export function asArray(users) {
	if (Array.isArray(users)) return users;
	if (Array.isArray(users?.contents)) return users.contents;
	return typeof users?.[Symbol.iterator] === "function" ? [...users] : [];
}

/**
 * Whether `user` plays this character, as opposed to merely being allowed to edit it.
 *
 * A table that lets the party read each other's sheets gives every player ownership of every
 * character, and a GM owns them all, so ownership cannot say whose row is whose. The assigned
 * character can, when there is one; a player with none assigned plays what they own.
 */
export function playsCharacter(actor, user = game.user) {
	if (!actor || !user) return false;
	if (user.character) return user.character.id === actor.id;
	return !user.isGM && !!actor.testUserPermission?.(user, "OWNER");
}

/** Who a private card about this character goes to: every GM, and everyone who plays the character. */
export function whisperFor(actor, users = game.users) {
	return [...new Set(asArray(users).filter(u => u.isGM || playsCharacter(actor, u)).map(u => u.id))];
}

/**
 * Is `actor` some OTHER user's assigned character (their `User#character`)? Then it is theirs,
 * whoever else has been given ownership of it: a GM who lets Bob run Alice's PC while she is away
 * has not made it Bob's. hooks/Ready.js asks this before greeting a player with "your" character,
 * and createCharacterForUser asks it before listing a player's characters for replacement.
 */
export function assignedToAnother(actor, userId, users = game.users) {
	if (!actor?.id) return false;
	return asArray(users).some(u => u && u.id !== userId && u.character?.id === actor.id);
}

/**
 * The characters a player PLAYS: the ones they explicitly own (charactersOwnedBy), less any that
 * another user holds as their assigned character.
 */
export function charactersPlayedBy(userId, users = game.users) {
	return charactersOwnedBy(userId).filter(a => !assignedToAnother(a, userId, users));
}

/**
 * Path to a playbook's avatar art (`assets/icons/playbooks/<slug>_icon.webp`), or
 * `null` for a slug-less actor. Server-root-relative (no leading slash) — the same
 * string stored as the character's avatar on pick, so previews match the art.
 */
export function playbookIconPath(slug) {
	return slug
		? `systems/stonetop-pwd/assets/icons/playbooks/${slug.replace(/-/g, "_")}_icon.webp`
		: null;
}

/**
 * Is this picture one of the playbook badges — the art `playbookIconPath` hands out, and which a
 * character who picks a playbook with no portrait of their own is given?
 *
 * ⚠ ASKED BY SURFACES THAT DRAW A RING ROUND A FACE. Every badge is a woodcut with a hand-drawn
 * ring already painted round its edge, so a circular frame of our own lands a second ring a few
 * pixels inside the first and the face reads as a target rather than as a portrait. A caller that
 * gets `true` here should leave its own rim off and let the drawn one be the rim — see
 * `.stonetop-relmap-node.is-own-ring` in the stylesheet, which is what the relationship map does.
 *
 * MATCHED ON THE FOLDER, not by rebuilding each slug's path: the ghost, the revenant and the
 * thrall are drawn in the same hand and sit in the same place, and no playbook slug names them.
 * The `_icon.webp` suffix is what separates the badges from the marks sharing that folder — the
 * blood drops, the diamonds, the arrow — which carry no ring and are not portraits.
 *
 * The front of the path is deliberately unanchored. The same file is quoted server-root-relative
 * by `playbookIconPath` and with a leading slash by hand, and both are the same art.
 */
export function hasOwnRingArt(img) {
	return /(^|\/)assets\/icons\/playbooks\/[^/]+_icon\.webp$/.test(String(img ?? ""));
}
