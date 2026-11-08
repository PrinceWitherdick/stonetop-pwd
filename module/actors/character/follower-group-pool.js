// A GROUP FOLLOWER'S POOL, ON THE CARD AND ON THE MAP (the FGT-2 hand-off, round-2 audit).
//
// The crew and a custom group fight as one combatant whose HP is "as per a single individual member" (Book I
// p.416), a pool whose losses are casualties: "If one group loses half its HP, then about half that group's
// numbers are out the action". The card keeps that pool (`crew.groupHp`, `customFollowers.<id>.groupHp`) and
// prints its casualty line from it; the Fight tab reads the crew TOKEN's own HP (fight/fight-sides.js, FGT-2).
// Nothing joined the two: a group blow landing on the token lowered the token and left the card at full, and a
// number typed in the card's box never reached the token. So the two are kept as one, while there is one token
// for the group on the scene (a group split into several tokens is several bodies, each its own pool, and the
// card's one number stands for none of them):
//   * the token's HP written, whoever wrote it: the card's box follows (fight/roster-fate.js#onUpdateActorGroupPool);
//   * the card's box written (actors/character/follower-hp.js#setFollowerHp): the token follows.
// Either write then finds the other already holding the value, so neither echoes back.

import { followerCardFor, followerCardMemo } from "./follower-masters.js";
import { SYSTEM_ID } from "../../system-id.js";
import { readableFlags } from "./StonetopFlags.js";
import { followerFateHpPath } from "./follower-fate.js";
import { each } from "../../fight/in-battle.js";

/** The card's pool row type for a group card, or null for anyone else. PURE. */
export function groupPoolRow({ ftype = "", slug = "" } = {}, flags = null) {
	if (ftype === "crew") return { follower: "crew-group", slug: "" };
	if (ftype === "custom" && slug && flags?.customFollowers?.[slug]?.isGroup) return { follower: "custom-group", slug };
	return null;
}

/** The card a group pool row stands for. PURE. */
export function groupPoolCard(row) {
	if (row?.follower === "crew-group") return { ftype: "crew", slug: "" };
	if (row?.follower === "custom-group" && row.slug) return { ftype: "custom", slug: row.slug };
	return null;
}

/** Whether `card` (followerCardFor's answer) is the character's card `{ftype, slug}`. */
function sameCard(card, character, { ftype, slug = "" }) {
	return !!card && card.character?.uuid === character?.uuid && card.ftype === ftype && (card.slug ?? "") === (slug ?? "");
}

/**
 * Whether an NPC's own stamp already rules it out as `character`'s card `which`, with no lookup: stamped for
 * this character but another card. A stamp naming this character always resolves to it (it is the list
 * searched), so followerCardFor's answer would be the stamped card or nobody.
 */
function stampRulesOut(actor, character, { ftype, slug = "" }) {
	const origin = actor.flags?.[SYSTEM_ID]?.followerOrigin;
	if (!origin?.characterUuid || !origin.ftype || origin.characterUuid !== character?.uuid) return false;
	return origin.ftype !== ftype || (origin.slug ?? "") !== (slug ?? "");
}

/**
 * The group's tokens on `scene`, as their own actors: every token whose actor stands for that card. `limit`
 * stops the walk once that many are found.
 *
 * @param {Actor} character
 * @param {{ftype: string, slug?: string}} which
 * @param {{scene?: Scene|null, cardFor?: Function, limit?: number}} [o]
 * @returns {Actor[]}
 */
export function groupTokensOn(character, which, { scene = globalThis.canvas?.scene ?? null, cardFor = followerCardFor, limit = Infinity } = {}) {
	// One pass writes nothing between lookups, so the stock lookup walks the character's links once, not per token.
	const lookup = cardFor === followerCardFor ? followerCardMemo({ characters: [character] }) : actor => cardFor(actor, { characters: [character] });
	const found = [];
	for (const token of each(scene?.tokens)) {
		const actor = token?.actor;
		if (actor?.type !== "npc" || stampRulesOut(actor, character, which)) continue;
		if (sameCard(lookup(actor), character, which) && found.push(actor) >= limit) break;
	}
	return found;
}

/** The group's ONE token's actor on `scene`, or null when it has none or several. */
export function loneGroupToken(character, which, options = {}) {
	const found = groupTokensOn(character, which, { ...options, limit: 2 });
	return found.length === 1 ? found[0] : null;
}

/**
 * The card's pool update a token's HP write asks for, or null: not a group follower's token, the group split into
 * several tokens on that scene, the card already holding the value, or (given `answers`) a character this client
 * does not answer for, checked before the scene's tokens are walked. PURE but for the card and token lookups.
 *
 * @param {Actor} actor  the token's actor
 * @param {number} value  the HP written
 * @returns {null|{character: Actor, path: string, value: number}}
 */
export function poolMirrorFor(actor, value, { cardFor = followerCardFor, answers = null } = {}) {
	if (actor?.type !== "npc" || !Number.isFinite(Number(value))) return null;
	const card = cardFor(actor);
	if (!card?.character || (answers && !answers(card.character))) return null;
	const flags = readableFlags(card.character);
	const row = groupPoolRow(card, flags);
	if (!row) return null;
	const scene = actor.token?.parent ?? globalThis.canvas?.scene ?? null;
	if (!loneGroupToken(card.character, card, { scene, cardFor })) return null;
	const path = followerFateHpPath(row.follower, row.slug);
	const to = Math.max(0, Math.trunc(Number(value)));
	const before = foundry.utils.getProperty(flags ?? {}, path);
	const max = Number(actor.system?.attributes?.hp?.max);
	// An unset pool tracks the max: a token at full is the card's unset box, already.
	if ((before == null || before === "") && Number.isFinite(max) && to >= max) return null;
	if (before != null && before !== "" && Number(before) === to) return null;
	return { character: card.character, path, value: to };
}
