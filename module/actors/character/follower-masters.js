// Whose follower an NPC is, and which of their cards it stands for.
//
// A follower is flag data on a character, and the NPC Actor that stands for them on the map is linked
// back to that character in one of two ways, depending on how the NPC came to exist:
//  • MADE FOR THE CARD (follower-actors.js#createFollowerActor): the actor carries its provenance,
//    `flags.<system>.followerOrigin`, which names the character AND the card.
//  • RECRUITED (an existing NPC turned follower, "a follower is first an NPC", Book I p.475): the
//    NPC carries nothing, and the link is on the character's side, as the card's `sourceUuid`. A
//    card whose actor was made later remembers it as `actorUuid` too.
//
// Both are read here, so a list that wants a character's followers beside them (the Start a fight
// window) finds the recruited ones as well as the made ones, and so a token on the map can be traced
// back to the card it stands for (the fight ring's Order buttons, fight/follower-fight.js). The NPC
// sheet's "Following" line reads the second of these for itself.

import { SYSTEM_ID } from "../../system-id.js";
import { readableFlags } from "./StonetopFlags.js";
import { initiateActive } from "./initiates.js";

/**
 * Whether a card is one of the character's followers at all. Every card is, except an initiate of
 * Danu while the Initiate background is not the one taken: their card and their NPC are kept for a
 * return to it (initiates.js), but meanwhile they follow nobody.
 */
function cardStands(flags, ftype, slug) {
	return ftype !== "initiate" || initiateActive(flags, slug);
}

/**
 * Where a character keeps its followers, and what kind of card each root holds. These are the roots
 * of the character sheet's own `_FOLLOWER_FLAGS` paths; a `keyed` root holds one card per follower,
 * filed under the slug that names it.
 */
const FOLLOWER_ROOTS = Object.freeze({
	animalCompanion: { ftype: "animal-companion", keyed: false, detailBase: "animalCompanion.details" },
	crew:            { ftype: "crew",             keyed: false, detailBase: "crew.details" },
	initiateDetails: { ftype: "initiate",         keyed: true,  detailBase: "initiateDetails.{slug}" },
	beastDetails:    { ftype: "beast",            keyed: true,  detailBase: "beastDetails.{slug}" },
	customFollowers: { ftype: "custom",           keyed: true,  detailBase: "customFollowers.{slug}" },
});

/** ftype -> its row above, so a reader with a card in hand need not know which root holds it. */
const BY_FTYPE = Object.freeze(Object.fromEntries(
	Object.entries(FOLLOWER_ROOTS).map(([root, info]) => [info.ftype, { ...info, root }]),
));

/**
 * Where one follower card keeps its hand-edited extras and overrides: the same ".details" namespace
 * the character sheet writes through (its _followerDetailBase), for any of the five types.
 *
 * This lives here because this module already had to know which root holds which ftype in order to
 * say what card a link sits on. A reader outside the sheet that wants a card's own stored field --
 * the fight ring asking whether a follower is exceptional, say -- builds its path from this instead
 * of keeping a private copy of part of the sheet's flag map.
 *
 * @returns {string|null}  the dotted flag path, or null for an ftype that is no follower's
 */
export function followerDetailBase(ftype, slug = "") {
	const base = BY_FTYPE[ftype]?.detailBase;
	return base ? base.replaceAll("{slug}", slug ?? "") : null;
}
const LINK_KEYS = new Set(["actorUuid", "sourceUuid"]);

/**
 * The uuids one actor can be known by on a card.
 *
 * A token's actor is a copy of the Actor it was dropped from, and an UNLINKED copy -- Foundry's
 * default for a prototype token -- has a uuid of its own, `Scene.<id>.Token.<id>.Actor.<id>`, which
 * no card ever stored: a recruited follower's card names the world Actor the token was made from.
 * So the world Actor behind the token is tried as well, and a follower who walks the map unlinked is
 * still traced back to their card.
 *
 * @returns {string[]}  the token actor's own uuid first, then the world Actor's
 */
function linkUuidsFor(actor) {
	const uuids = [];
	if (typeof actor?.uuid === "string" && actor.uuid) uuids.push(actor.uuid);
	if (!actor?.isToken) return uuids;
	const token = actor.token;
	const base = token?.baseActor ?? (token?.actorId ? globalThis.game?.actors?.get?.(token.actorId) : null) ?? null;
	if (typeof base?.uuid === "string" && base.uuid && !uuids.includes(base.uuid)) uuids.push(base.uuid);
	return uuids;
}

/**
 * Every actor link stored under a character's followers, and which card each one sits on.
 *
 * @returns {Map<string, {ftype: string, slug: string}>}  actor uuid -> the card holding the link
 */
function followerLinks(character) {
	const links = new Map();
	const walk = (node, depth, root, slug) => {
		if (!node || typeof node !== "object" || depth > 3) return;
		for (const [key, value] of Object.entries(node)) {
			if (LINK_KEYS.has(key)) {
				const uuid = typeof value === "string" ? value.trim() : "";
				// The first card to claim a uuid keeps it, the same rule the index below follows.
				if (uuid && !links.has(uuid)) links.set(uuid, { ftype: root.ftype, slug: root.keyed ? slug : "" });
			} else if (value && typeof value === "object") {
				// A keyed root's first rung IS the slug; everything below that is the card's own shape.
				walk(value, depth + 1, root, root.keyed && depth === 0 ? key : slug);
			}
		}
	};
	const flags = readableFlags(character);
	for (const [name, root] of Object.entries(FOLLOWER_ROOTS)) walk(flags[name], 0, root, "");
	for (const [uuid, card] of links) if (!cardStands(flags, card.ftype, card.slug)) links.delete(uuid);
	return links;
}

/**
 * Which character each follower NPC follows.
 *
 * Only `npc` actors are followers: a card's `sourceUuid` can also point at the bestiary monster a
 * follower was converted from, or the item behind a possession, and neither of those is the follower.
 * An NPC claimed by two characters goes to the first, in the order the characters are given.
 *
 * @param {object} p
 * @param {Actor[]} p.characters  the characters whose followers to find
 * @param {Actor[]} p.actors      every actor that might be one
 * @returns {Map<string, Actor>}  follower actor id -> the character
 */
export function followerMasterIndex({ characters = [], actors = [] } = {}) {
	const byUuid = new Map();
	for (const character of characters) {
		if (character?.uuid && !byUuid.has(character.uuid)) byUuid.set(character.uuid, character);
	}
	const claimed = new Map();
	for (const character of characters) {
		for (const uuid of followerLinks(character).keys()) if (!claimed.has(uuid)) claimed.set(uuid, character);
	}
	const masters = new Map();
	for (const actor of actors) {
		if (actor?.type !== "npc" || !actor.id) continue;
		const origin = actor.flags?.[SYSTEM_ID]?.followerOrigin;
		let stamped = byUuid.get(origin?.characterUuid) ?? null;
		if (stamped && !cardStands(readableFlags(stamped), origin.ftype, origin.slug ?? "")) stamped = null;
		const master = stamped ?? claimed.get(actor.uuid) ?? null;
		if (master && master.id !== actor.id) masters.set(actor.id, master);
	}
	return masters;
}

/**
 * Which follower card ONE NPC stands for, and whose it is.
 *
 * The stamp is read first, because an actor made for a card names its character and its card
 * outright. A recruited NPC carries nothing, so the character's own links are searched instead, and
 * where the link sits says which card holds it — which is the card a Defend's Readiness is written
 * to, so it cannot be guessed.
 *
 * @param {Actor} actor
 * @param {object} [p]
 * @param {Actor[]} [p.characters]  the characters to search (default: every character in the world)
 * @param {Function} [p.resolve]    uuid -> document, for a character outside that list
 * @returns {{character: Actor, ftype: string, slug: string}|null}
 */
export function followerCardFor(actor, { characters = null, resolve = globalThis.fromUuidSync } = {}) {
	if (actor?.type !== "npc") return null;
	// Built on first use only: an actor made for a card names its character outright, and resolving
	// that uuid answers without walking the world's actors at all.
	let list = characters;
	const searchable = () => {
		if (!list) {
			const world = globalThis.game?.actors;
			list = typeof world?.[Symbol.iterator] === "function" ? [...world].filter(a => a?.type === "character") : [];
		}
		return list;
	};
	const origin = actor.flags?.[SYSTEM_ID]?.followerOrigin;
	if (origin?.characterUuid && origin.ftype) {
		// Not strict: a character in a compendium, or one since deleted, must read as missing rather
		// than throw — the same care fight-vitals.js takes resolving this very stamp.
		let character = null;
		if (typeof resolve === "function") {
			try { character = resolve(origin.characterUuid, { strict: false }); } catch { character = null; }
		}
		character ??= searchable().find(c => c?.uuid === origin.characterUuid) ?? null;
		if (character?.type === "character") {
			// Named outright, so the answer is this card or nobody: a dormant initiate's NPC is not
			// somebody else's follower just because it is not this character's.
			return cardStands(readableFlags(character), origin.ftype, origin.slug ?? "")
				? { character, ftype: origin.ftype, slug: origin.slug ?? "" }
				: null;
		}
	}
	const uuids = linkUuidsFor(actor);
	for (const character of searchable()) {
		const links = followerLinks(character);
		for (const uuid of uuids) {
			const card = links.get(uuid);
			if (card) return { character, ftype: card.ftype, slug: card.slug };
		}
	}
	return null;
}
