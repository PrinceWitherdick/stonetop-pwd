// The two scales a group of monsters is fought at, and moving between them mid-fight.
//
// Book I gives a group two ways to be on the table. Each creature a token of its own, with its own HP,
// is the plain one. Or, when a group fights another group, "you can roll damage once per side and
// abstract the results. A group deals damage and has HP and armor as though it was one individual
// member of the group" (p.416): ONE token whose HP is the group's pool, read back as casualties. That
// is the monster sheet's "Group fight" switch (`system.fightAsGroup`) with its size in `system.count`.
//
// A GM moves between the two as the fight moves ("Foes that are engaged by individual PCs aren't
// really part of a group"), so the Fight tab offers both ways on a monster's row:
//  • MERGE INTO ONE GROUP: every token of that monster in the fight on this map (or, when the GM has
//    several of them selected, just those) becomes the one they right-clicked, fighting as a group of
//    however many were still standing. The others leave the map and the fight.
//  • SPLIT INTO SEPARATE TOKENS: a group token becomes one token per member still standing, each at a
//    member's full HP, gathered around where the group stood.
//
// WOUNDS DO NOT CROSS SCALES. A group's damage is casualties, not scratches spread over its members,
// and a scratch on one crinwin is not a casualty. So a merge opens the pool full at the number still
// standing, and a split gives each survivor a member's whole HP: the numbers carry over, the scratches
// do not. That is the abstraction as printed ("Damage represents casualties").
//
// ONLY UNLINKED TOKENS. A linked token's actor is the world's own, so switching it to a group would
// switch every token of it on every map.

import { SYSTEM_ID } from "../system-id.js";
import { format } from "../utils/i18n.js";
import { placeActors } from "../utils/token-drop.js";
import { combatantBodies, combatantSide, controlledTokenIds, tokenRect, tokenLevel, sceneRectOf, gridOf, SIDE_FLAG } from "./fight-state.js";
import { touching } from "./engagements.js";
import { fightsAsGroup } from "./fight-sides.js";
import { numberedNames, spotsAround } from "./group-size.js";
import { GROUP_WOUND_FLAG, GROUP_SIZE_FLAG, groupWound } from "./group-hits.js";

const KEY = "stonetop.fight.scale";

/** Whether a combatant is a monster on an unlinked token on the canvas scene, which the scale tools work on. */
function workable(combatant, scene = globalThis.canvas?.scene) {
	const token = combatant?.token;
	return !!token && !!scene && combatant.sceneId === scene.id && !token.actorLink
		&& combatant.actor?.type === "monster" && !combatantBodies(combatant).out;
}

/** Whether a combatant's monster is a group or a horde, so its token can fight as one group (p.416). */
function comesInNumbers(combatant) {
	const actor = combatant?.actor;
	return fightsAsGroup({ type: actor?.type, fightAsGroup: true, organization: actor?.system?.organization });
}

/** Whether a combatant's token is fighting as a group (p.416). */
function isGroupToken(combatant) {
	const actor = combatant?.actor;
	return fightsAsGroup({ type: actor?.type, fightAsGroup: actor?.system?.fightAsGroup, organization: actor?.system?.organization });
}

/** A monster's name without the number core or a split gave its token ("Crinwin (3)" is a Crinwin). */
function baseName(combatant) {
	const actor = globalThis.game?.actors?.get?.(combatant?.actorId) ?? null;
	return actor?.prototypeToken?.name || actor?.name || String(combatant?.token?.name ?? "").replace(/ \(\d+\)$/, "");
}

/** HP back to full, as an update, or nothing for an actor with no max. */
function fullHp(actor) {
	const max = Math.trunc(Number(actor?.system?.attributes?.hp?.max) || 0);
	return max > 0 ? { "system.attributes.hp.value": max } : {};
}

/**
 * What a token's actor turns into to fight as a group of `size`: the switch, the size, a full pool, no
 * member left hurt by a lone blow, and no earlier size kept (fight/group-hits.js): `size` is where it starts.
 */
export function groupChanges(actor, size) {
	return {
		"system.fightAsGroup": true,
		"system.count": Math.max(1, Math.trunc(size)),
		...fullHp(actor),
		[`flags.${SYSTEM_ID}.${GROUP_WOUND_FLAG}`]: 0,
		[`flags.${SYSTEM_ID}.${GROUP_SIZE_FLAG}`]: 0,
	};
}

/** Make one token fight as a group of `size`. The token must be unlinked (see the note at the top). */
export async function makeGroupToken(token, size) {
	const actor = token?.actor;
	if (!actor || token.actorLink || typeof actor.update !== "function") return false;
	await actor.update(groupChanges(actor, size));
	return true;
}

/**
 * The tokens a merge from `combatant`'s row would take in: every workable combatant of the same
 * monster in the fight, or only the GM's selected ones when two or more of them are selected (the
 * row's own always included). Individuals and groups alike: a group already there adds its standing.
 *
 * ONLY A MONSTER THAT COMES IN NUMBERS: a group or a horde, the organizations a group token can be fought
 * at (fight-sides.js#fightsAsGroup). Two bears merged were one token fighting as one bear, the other bear
 * deleted, and no Split to bring it back.
 */
export function mergeCandidates(combat, combatant, { scene = globalThis.canvas?.scene, controlled = null } = {}) {
	if (!workable(combatant, scene) || !comesInNumbers(combatant)) return [];
	const same = [...(combat?.combatants ?? [])].filter(c => c.actorId === combatant.actorId && workable(c, scene)
		&& comesInNumbers(c) && combatantSide(c) === combatantSide(combatant));
	const selected = new Set(controlled ?? controlledTokenIds());
	const picked = same.filter(c => selected.has(c.tokenId));
	const chosen = picked.length >= 2 ? [...new Set([combatant, ...picked])] : same;
	return chosen.length >= 2 ? chosen : [];
}

/** Whether a group token can be split: fighting as a group, with two or more still standing. */
export function canSplit(combatant, { scene = globalThis.canvas?.scene } = {}) {
	return workable(combatant, scene) && isGroupToken(combatant) && combatantBodies(combatant).bodies >= 2;
}

/**
 * Merge `combatant`'s monster into one group token: its own. See the note at the top.
 *
 * @returns {Promise<number>} the group's size, or 0 when there was nothing to merge
 */
export async function mergeIntoGroup(combat, combatant, { scene = globalThis.canvas?.scene, notify = globalThis.ui?.notifications, controlled = null } = {}) {
	if (!globalThis.game?.user?.isGM) return 0;
	const members = mergeCandidates(combat, combatant, { scene, controlled });
	if (members.length < 2) return 0;
	const size = members.reduce((sum, c) => sum + combatantBodies(c).bodies, 0);
	const others = members.filter(c => c !== combatant);
	const name = baseName(combatant);
	await combatant.token.actor.update(groupChanges(combatant.token.actor, size));
	if (combatant.token.name !== name && /\(\d+\)$/.test(combatant.token.name ?? "")) await combatant.token.update?.({ name });
	await combat.deleteEmbeddedDocuments("Combatant", others.map(c => c.id));
	await scene.deleteEmbeddedDocuments("Token", others.map(c => c.tokenId));
	notify?.info?.(format(`${KEY}.merged`, { name, count: size }));
	return size;
}

/**
 * Split a group token into one token per member still standing, gathered around it, all in the fight
 * on the group's side. See the note at the top.
 *
 * @returns {Promise<number>} how many tokens now stand for the group, or 0 when it could not be split
 */
export async function splitGroup(combat, combatant, { scene = globalThis.canvas?.scene, notify = globalThis.ui?.notifications } = {}) {
	if (!globalThis.game?.user?.isGM || !canSplit(combatant, { scene })) return 0;
	const standing = combatantBodies(combatant).bodies;
	const token = combatant.token;
	const actor = token.actor;

	// The members stay on whoever the group was fighting where there is room, so a split changes the scale
	// and not the fight: gathered round the group token alone, one crinwin of five ended up out of reach.
	//
	// THE NEW TOKENS FIRST, THE SCALE AFTER. Switched to one creature before the others were placed, a map
	// with room for only two more turned a group of six into three tokens, and the other three were simply
	// gone. Now whoever could not be placed stays on the group token, which stays a group of what is left.
	const level = tokenLevel(token);
	const grid = gridOf(scene);
	const foes = meleeFoes(combat, combatant, token, grid);
	const prefer = foes.length ? at => foes.some(rect => touching({ rect: at, level }, { rect, level }, grid)) : null;
	const more = await gatherAround(globalThis.canvas, scene, token, standing - 1, { prefer });
	const kept = Math.max(1, standing - more.tokens.length);

	// The member a lone blow left hurt (fight/group-hits.js) is on the token that stays, and keeps its wound:
	// as one creature, its HP takes the wound; as a smaller group, the wound stays on the group.
	const wound = groupWound(actor);
	const hp = fullHp(actor);
	// A world actor switched to fight as a group hands that to every token made from it. Switched off
	// BEFORE the group token is written: a new token linked to the world actor switches the world actor,
	// and a group token that only inherited the switch from it would stop being a group.
	await Promise.all(more.tokens.filter(extra => extra.actor !== actor && extra.actor?.system?.fightAsGroup)
		.map(extra => extra.actor.update({ "system.fightAsGroup": false })));
	if (kept > 1) {
		// The switch is written on the group token itself, so it holds whatever the world actor says.
		await actor.update({ "system.fightAsGroup": true, "system.count": kept, ...hp, [`flags.${SYSTEM_ID}.${GROUP_SIZE_FLAG}`]: 0 });
	} else {
		if (wound && "system.attributes.hp.value" in hp) hp["system.attributes.hp.value"] = Math.max(1, hp["system.attributes.hp.value"] - wound);
		await actor.update({ "system.fightAsGroup": false, ...hp, [`flags.${SYSTEM_ID}.${GROUP_WOUND_FLAG}`]: 0 });
	}
	const side = combatantSide(combatant);
	const data = more.tokens.map(extra => ({
		tokenId: extra.id, sceneId: scene.id, actorId: extra.actorId, hidden: !!token.hidden,
		...(side ? { flags: { [SYSTEM_ID]: { [SIDE_FLAG]: side } } } : {}),
	}));
	if (data.length) await combat.createEmbeddedDocuments("Combatant", data);
	const count = 1 + more.tokens.length;
	const name = baseName(combatant);
	if (kept > 1) notify?.warn?.(format(`${KEY}.splitPartly`, { name, placed: more.tokens.length, kept }));
	else if (more.missed.length) notify?.warn?.(format(`${KEY}.splitShort`, { name, count, wanted: standing }));
	else notify?.info?.(format(`${KEY}.split`, { name, count }));
	return count;
}

/**
 * Number a monster's new tokens the way core would ("Crinwin (2)"), after the numbers its tokens on
 * the map already use, and apply `extra` changes to them in the same write. A prototype that numbers
 * its own tokens has already been numbered by core.
 */
export async function settleNewcomers(scene, actor, tokens, extra = {}) {
	if (!tokens.length || typeof scene?.updateEmbeddedDocuments !== "function") return;
	const base = actor?.prototypeToken?.name || actor?.name || "";
	const fresh = new Set(tokens.map(t => t.id));
	const existing = [...(scene.tokens ?? [])].filter(t => t.actorId === actor?.id && !fresh.has(t.id)).map(t => t.name);
	const names = actor?.prototypeToken?.appendNumber || !base ? [] : numberedNames(base, existing, tokens.length);
	const updates = tokens
		.map((token, i) => ({ _id: token.id, ...(names[i] ? { name: names[i] } : {}), ...extra }))
		.filter(update => Object.keys(update).length > 1);
	if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
}

/** The footprints of the other side's fighters in melee with a combatant's token (engagements.js#touching). */
function meleeFoes(combat, combatant, token, grid) {
	const side = combatantSide(combatant);
	const level = tokenLevel(token);
	const mine = { rect: tokenRect(token), level };
	return [...(combat?.combatants ?? [])]
		.filter(other => other.id !== combatant.id && other.token && other.token.parent?.id === token.parent?.id)
		.filter(other => { const theirs = combatantSide(other); return theirs && theirs !== side; })
		.map(other => ({ rect: tokenRect(other.token), level: tokenLevel(other.token) }))
		.filter(other => touching(mine, other, grid))
		.map(other => other.rect);
}

/**
 * Put `count` more of a token's monster on the map around it, hidden when it is. `prefer` picks the spots
 * taken first (group-size.js#spotsAround).
 *
 * @returns {Promise<{tokens: object[], missed: string[]}>}
 */
export async function gatherAround(canvas, scene, token, count, { prefer = null } = {}) {
	const actor = globalThis.game?.actors?.get?.(token.actorId) ?? token.baseActor ?? null;
	const name = actor?.name ?? token.name ?? "";
	if (!(count > 0)) return { tokens: [], missed: [] };
	if (!actor || canvas?.scene?.id !== scene.id) return { tokens: [], missed: [name] };
	const size = canvas.dimensions?.size ?? scene.grid?.size ?? 100;
	const anchor = tokenRect(token);
	const level = tokenLevel(token);
	const others = [...(scene.tokens ?? [])]
		.filter(t => t.id !== token.id && tokenLevel(t) === level)
		.map(tokenRect);
	const spots = spotsAround({ anchor, count, size, others, sceneRect: sceneRectOf(canvas), prefer });
	const drop = await placeActors(canvas, spots.map(() => actor), i => ({ x: spots[i].x + anchor.w / 2, y: spots[i].y + anchor.h / 2 }));
	const tokens = drop.dropped.map(d => d.token).filter(t => t?.documentName === "Token");
	await settleNewcomers(scene, actor, tokens, token.hidden ? { hidden: true } : {});
	return { tokens, missed: tokens.length < count ? [name] : [] };
}
