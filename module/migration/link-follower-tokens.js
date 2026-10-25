// Linking the tokens a one-body follower already has on the map (audit FOE-2).
//
// A follower recruited from an NPC the table already had walked the map on that NPC's prototype token,
// which Foundry leaves unlinked. Each such token held its own copy of the follower's hit points: a blow on
// the map landed in the token's copy (the mirror carried it to the card) while a heal written to the NPC
// never reached the token. New tokens now come out linked (hooks/FollowerDrop.js#linkRecruitedPrototype and
// #linkFollowerTokenOnCreate), so follower-hp.js writes the NPC alone; this links the ones placed before.
//
// WHICH HP IS KEPT. The card's box mirrors every HP write to ANY copy, the NPC's or a token's
// (fight/roster-fate.js#onUpdateActorFollowerHp), so it holds the latest one: a blow on the map and a heal
// written to the NPC both end there. That value goes onto the NPC before its tokens are linked. A card with
// no number in its box was never written, so the NPC keeps what it has. Only the HP is carried over: the
// rest of a token's own copy is dropped by the link, as core does when the Token Config box is ticked.
//
// Primary GM only (Ready.js), once per version: idempotent, and once a world is linked it finds nothing.

import { followerCardMemo } from "../actors/character/follower-masters.js";
import { followerFateHpPath } from "../actors/character/follower-fate.js";
import { readableFlags } from "../actors/character/StonetopFlags.js";
import { followerNpcHpTarget } from "../actors/character/follower-hp.js";
import { oneBodyFollowerCard } from "../hooks/FollowerDrop.js";

export const LINK_FOLLOWER_TOKENS_SWEEP = "linkFollowerTokens";

/**
 * The HP the card's box holds for `card`, or null when it holds no number. PURE.
 *
 * @param {{character: Actor, ftype: string, slug: string}} card
 */
export function cardBoxHp(card) {
	const path = followerFateHpPath(card?.ftype, card?.slug ?? "");
	if (!path || !card?.character) return null;
	const raw = foundry.utils.getProperty(readableFlags(card.character) ?? {}, path);
	if (raw == null || raw === "") return null;
	const n = Number(raw);
	return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}

/**
 * Every unlinked token on `scenes`, by the world NPC it stands for. PURE but for the actor lookup.
 *
 * @returns {Map<Actor, object[]>}
 */
export function unlinkedNpcTokens(scenes, actors) {
	const byNpc = new Map();
	for (const scene of scenes ?? []) {
		for (const token of scene?.tokens ?? []) {
			if (token?.actorLink) continue;
			const base = token?.baseActor ?? actors?.get?.(token?.actorId) ?? null;
			if (base?.type !== "npc") continue;
			if (!byNpc.has(base)) byNpc.set(base, []);
			byNpc.get(base).push(token);
		}
	}
	return byNpc;
}

/**
 * Link every placed token of a one-body follower's NPC, with the card's HP on the NPC first, and link the
 * NPC's prototype so the next token is linked too.
 *
 * @param {object} [o]
 * @param {Iterable<Scene>} [o.scenes]
 * @param {object} [o.actors]  the world's actors
 * @param {Function} [o.cardOf]  FollowerDrop.js#oneBodyFollowerCard, for the tests
 * @returns {Promise<{npcs: number, tokens: number}>}  how many NPCs and tokens were linked
 */
export async function linkFollowerTokens({ scenes = globalThis.game?.scenes ?? [], actors = globalThis.game?.actors, cardOf } = {}) {
	const cardFor = followerCardMemo();
	const card = cardOf ?? (actor => oneBodyFollowerCard(actor, { cardFor }));
	let npcs = 0, tokens = 0;
	for (const [npc, list] of unlinkedNpcTokens(scenes, actors)) {
		const found = card(npc);
		if (!found) continue;
		try {
			const hp = npc.system?.attributes?.hp ?? {};
			const boxed = cardBoxHp(found);
			const to = boxed == null ? null : followerNpcHpTarget(hp, boxed);
			// Quiet in the ledger: nobody's HP changed, two copies were made one.
			if (to != null && to !== Number(hp.value)) await npc.update({ "system.attributes.hp.value": to }, { stonetopLedger: true });
			if (npc.prototypeToken?.actorLink === false) await npc.update({ "prototypeToken.actorLink": true }, { stonetopLedger: true });
			npcs += 1;
		} catch (err) {
			console.error(`Stonetop | could not carry ${npc.name}'s HP over before linking their tokens`, err);
			continue;
		}
		// One token at a time, as link-character-tokens.js does: a scene-wide update fails as a unit.
		for (const token of list) {
			try {
				await token.update({ actorLink: true });
				tokens += 1;
			} catch (err) {
				console.error(`Stonetop | could not link ${npc.name}'s token on ${token.parent?.name ?? "a scene"}`, err);
			}
		}
	}
	return { npcs, tokens };
}
