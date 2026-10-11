// A custom follower handed from one PC to another, and the NPC that stands for them on the map.
//
// Book I p.480 (Updating followers): "if they shift their loyalty from one PC to another (or their
// current leader passes off responsibility for them to another PC), then tell the players ... Tell the
// players to update their notes accordingly." The card moves to the other character with a fresh id,
// Loyalty, HP and notes riding along, as it always did.
//
// THE NPC GOES WITH THEM (wave 3 audit FOL-3). An NPC made for a card carries `followerOrigin`, naming
// the character AND the card (follower-actors.js#createFollowerActor), and its ownership is that
// character's. Left alone, the token kept answering to the old PC: the ring's Order went to their sheet,
// the Start-a-fight roster listed it with them, and the new leader's player could not move it. So the
// stamp is rewritten to the new card and the ownership to the new character's.
//
// ANY OTHER PC (FOL-7). The book names no limit, so every other character is offered. A player cannot
// write a character they do not own, nor change any document's ownership, so a non-GM's hand-off is
// done by the primary GM's client (FOLLOWER_HANDOFF_QUERY), after it checks the asker owns the follower's
// current leader. With no GM online, a player who owns both characters still moves the card and the
// stamp; the NPC's ownership then waits for a GM, and they are told so.
//
// REMOVED, THE LINK GOES TOO. A card removed from the sheet leaves its NPC in the sidebar (deleting it
// is the GM's decision), but the NPC's `followerOrigin` is taken off, so it is nobody's follower.

import { SYSTEM_ID } from "../../system-id.js";
import { readableFlags } from "./StonetopFlags.js";
import { followerActorFromLink } from "./follower-actors.js";
import { nextFollowerOrder } from "../../data/follower-build.js";
import { askGMClient, deletionEntry, queryAsker, resolveSync } from "../../utils/foundry-compat.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";

export const FOLLOWER_HANDOFF_QUERY = "stonetop.followerHandoff";

/** The characters a follower can be handed to: every character but the leader. PURE. */
export function handOffTargets(from, actors = globalThis.game?.actors ?? []) {
	return [...(actors ?? [])].filter(a => a?.type === "character" && a.id !== from?.id);
}

/**
 * The NPC made for this card, when the card's `actorUuid` names one that carries this card's stamp
 * (a recruited NPC keeps no stamp, so it has nothing to rewrite).
 */
export function stampedFollowerNpc(record, character, slug, resolve = followerActorFromLink) {
	const npc = record?.actorUuid ? resolve({ actorUuid: record.actorUuid }) : null;
	const origin = npc?.flags?.[SYSTEM_ID]?.followerOrigin;
	if (!origin || origin.ftype !== "custom") return null;
	return origin.characterUuid === character?.uuid && (origin.slug ?? "") === slug ? npc : null;
}

/**
 * Everything a hand-off writes, PURE: the new card on `to` under `newId`, the card's deletion on
 * `from`, and the NPC's new stamp and (with `ownership`) owners.
 */
export function handOffPlan({ to, slug, newId, record, withOwnership = true }) {
	const targetMap = readableFlags(to)?.customFollowers ?? {};
	const [delKey, delVal] = deletionEntry(`flags.${SYSTEM_ID}.customFollowers.${slug}`);
	return {
		target: { [`flags.${SYSTEM_ID}.customFollowers.${newId}`]: { ...record, order: nextFollowerOrder(targetMap) } },
		source: { [delKey]: delVal },
		npc: {
			[`flags.${SYSTEM_ID}.followerOrigin`]: { characterUuid: to?.uuid ?? null, ftype: "custom", slug: newId },
			...(withOwnership ? { ownership: foundry.utils.deepClone(to?.ownership ?? {}) } : {}),
		},
	};
}

/**
 * Do the hand-off on this client: the writes it is allowed. Answers `{newId, npcOwnership}` (whether the
 * NPC's owners were moved too), or null when the card is not there.
 */
export async function performHandOff(from, to, slug, { newId = foundry.utils.randomID(16), withOwnership = !!globalThis.game?.user?.isGM, resolve } = {}) {
	const record = readableFlags(from)?.customFollowers?.[slug];
	if (!record || !to || to.id === from?.id) return null;
	const npc = stampedFollowerNpc(record, from, slug, resolve);
	const plan = handOffPlan({ to, slug, newId, record, withOwnership });
	await to.update(plan.target);
	if (npc?.isOwner) await npc.update(plan.npc, { stonetopLedger: true });
	await from.update(plan.source);
	return { newId, npcOwnership: !!npc && withOwnership };
}

/**
 * Hand a custom follower from `from` to `to`, here or through the GM's client (see the header). Answers
 * what performHandOff does, or null when it could not be done.
 */
export async function requestHandOff(from, to, slug, deps = {}) {
	const { gm = globalThis.game?.users?.activeGM ?? null, user = globalThis.game?.user ?? null } = deps;
	if (user?.isGM) return performHandOff(from, to, slug, { ...deps, withOwnership: true });
	if (gm) {
		return askGMClient(gm, FOLLOWER_HANDOFF_QUERY,
			{ fromUuid: from?.uuid ?? null, toUuid: to?.uuid ?? null, slug, userId: user?.id ?? null },
			{ fallback: null, what: "hand the follower off" });
	}
	if (from?.isOwner && to?.isOwner) return performHandOff(from, to, slug, { ...deps, withOwnership: false });
	return null;
}

/** The GM's side of FOLLOWER_HANDOFF_QUERY: the asker must own the follower's current leader. */
export async function handleFollowerHandoffQuery(data, context = {}, deps = {}) {
	const { users = globalThis.game?.users, resolve = resolveSync } = deps;
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return null;
	const asker = queryAsker(data, context, users);
	const from = data?.fromUuid ? resolve(data.fromUuid) : null;
	const to = data?.toUuid ? resolve(data.toUuid) : null;
	if (from?.type !== "character" || to?.type !== "character" || !data?.slug) return null;
	if (!asker || !from.testUserPermission?.(asker, "OWNER")) return null;
	return performHandOff(from, to, String(data.slug), { withOwnership: true, ...(deps.newId ? { newId: deps.newId } : {}) });
}

/**
 * The NPC update that makes a removed card's NPC nobody's follower, or null when the card has no
 * stamped NPC. PURE but for the resolve.
 */
export function unlinkRemovedFollower(character, slug, resolve = followerActorFromLink) {
	const record = readableFlags(character)?.customFollowers?.[slug];
	const npc = stampedFollowerNpc(record, character, slug, resolve);
	if (!npc) return null;
	const [key, value] = deletionEntry(`flags.${SYSTEM_ID}.followerOrigin`);
	return { npc, update: { [key]: value } };
}
