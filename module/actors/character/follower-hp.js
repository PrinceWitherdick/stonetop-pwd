// ONE WRITE PATH FOR A FOLLOWER'S HP (wave 3 audit FOL-1, the user's ruling of 2026-10-09). While a
// follower who is one person has an NPC (follower-fate.js#linkedFollowerNpc), the NPC's hit points are
// theirs and the card's box MIRRORS them (fight/roster-fate.js#onUpdateActorFollowerHp). A box written
// beside such an NPC would be overwritten by the mirror at the NPC's next HP change, so every writer of a
// follower's HP comes through setFollowerHp: the Followers tab's HP box, Death's Door's 10+, Make Camp,
// Bath of Healing Light and Lend it your strength (invocation-apply.js#restoreFollowerCardHp).
//
// It writes the NPC when there is one, on the primary GM's client when this one cannot write it
// (FOLLOWER_NPC_HP_QUERY), the way a hand-off or a Loyalty change for another's follower goes; with no GM
// connected nothing is written and the player is told. Everyone else takes the card's box, and so does
// a follower whose NPC already holds the value set (no update would fire to mirror it), with the revive
// a value above 0 makes (follower-fate.js#followerHpWriteUpdate, the pure half a caller batching its own
// write uses).

import { followerHpWriteUpdate, linkedFollowerNpc } from "./follower-fate.js";
import { followerActorFromLink } from "./follower-actors.js";
import { readableFlags } from "./StonetopFlags.js";
import { askGMClient, queryAsker, resolveSync } from "../../utils/foundry-compat.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";
import { format } from "../../utils/i18n.js";

/**
 * The query a player's client sends the primary GM's to set the HP of a follower's NPC it cannot write.
 * Registered by fight/roster-fate.js#registerRosterFateHooks, beside the mirror.
 */
export const FOLLOWER_NPC_HP_QUERY = "stonetop.followerNpcHp";

/** The warning when nobody can write the NPC; Make Camp passes its own. */
const NO_GM_KEY = "stonetop.character.followers.npcHp.noGm";

/** A whole number, never below 0. */
function hpCount(value) {
	return Math.max(0, Math.trunc(Number(value) || 0));
}

/**
 * The HP an NPC ends on when set to `value`: never past its max (one that cannot be read caps nothing),
 * and with `raiseOnly` never below what it holds, so a stale or repeated heal cannot lower it. PURE.
 */
export function followerNpcHpTarget(hp, value, { raiseOnly = false } = {}) {
	const max = Number(hp?.max);
	const capped = Number.isFinite(max) && max > 0 ? Math.min(value, max) : value;
	return raiseOnly ? Math.max(hpCount(hp?.value), capped) : capped;
}

/** Actor#update with the move named, or with no options at all when there is none. */
function updateWith(doc, update, moveName) {
	return moveName ? doc.update(update, { stonetopMove: moveName }) : doc.update(update);
}

/** The NPC standing for a character's one-body follower `{ftype, slug}`, or null. */
function followerNpcOf(character, ftype, slug) {
	return linkedFollowerNpc(readableFlags(character), ftype, slug ?? "", followerActorFromLink);
}

/**
 * Set one follower row's HP to `value`, wherever it lives (see the header).
 *
 * @param {Actor} character  the follower's leader
 * @param {{follower: string, slug?: string, index?: number|string|null}} row  the HP row, as the
 *   Followers tab's inputs and follower-fate.js#followerFateHpPath name it
 * @param {number} value
 * @param {object} [options]
 * @param {string} [options.moveName]    the move the writes are made for (`stonetopMove`)
 * @param {boolean} [options.raiseOnly]  a heal: the NPC is never lowered by it
 * @param {Function} [options.link]      follower-actors.js#followerActorFromLink, for the tests
 * @param {string} [options.noGmKey]     the warning's i18n key when nobody can write the NPC
 * @param {User|null} [options.gm]       the active GM, for the tests
 * @param {User|null} [options.user]     this client's user, for the tests
 * @returns {Promise<"npc"|"box"|null>}  where it was written ("npc": the mirror carries it to the box
 *   and asks the fate of a drop to 0), or null when nothing was: a row with no box, or an NPC nobody
 *   here could write
 */
export async function setFollowerHp(character, row, value, options = {}) {
	const {
		moveName = null, raiseOnly = false, link = followerActorFromLink, noGmKey = NO_GM_KEY,
		gm = globalThis.game?.users?.activeGM ?? null, user = globalThis.game?.user ?? null,
	} = options;
	if (!character || !row?.follower) return null;
	const { follower, index = null } = row;
	const slug = row.slug ?? "";
	const flags = readableFlags(character);
	const npc = linkedFollowerNpc(flags, follower, slug, link);
	const hp = npc?.system?.attributes?.hp ?? {};
	const to = npc ? followerNpcHpTarget(hp, value, { raiseOnly }) : null;
	// A heal the NPC already holds (it was raised meanwhile) is done; nothing is lowered or copied back.
	if (npc && raiseOnly && !(to > Number(hp.value))) return "npc";
	if (npc && Number(hp.value) !== to) {
		if (npc.isOwner) {
			await updateWith(npc, { "system.attributes.hp.value": to }, moveName);
			return "npc";
		}
		const done = await askGMClient(gm, FOLLOWER_NPC_HP_QUERY, {
			characterUuid: character.uuid ?? null, npcUuid: npc.uuid ?? null, ftype: follower, slug,
			to, raiseOnly: !!raiseOnly, moveName: moveName ?? null, userId: user?.id ?? null,
		}, { fallback: null, what: "set a follower's NPC's HP" });
		if (done) return "npc";
		globalThis.ui?.notifications?.warn?.(format(noGmKey, { name: npc.name ?? "" }));
		return null;
	}
	const update = followerHpWriteUpdate(flags, follower, slug, index, value);
	if (!Object.keys(update).length) return null;
	await updateWith(character, update, moveName);
	return "box";
}

/**
 * The GM's side of FOLLOWER_NPC_HP_QUERY, primary GM only. The asker must own the character, and the NPC
 * must be the one standing for that character's follower `{ftype, slug}`. Never past the NPC's max, and a
 * heal (`raiseOnly`) never lowers it. Answers `{to}`, or null when refused.
 */
export async function handleFollowerNpcHpQuery(data, context = {}, deps = {}) {
	const { users = globalThis.game?.users, resolve = resolveSync, npcOf = followerNpcOf } = deps;
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return null;
	const asker = queryAsker(data, context, users);
	const character = data?.characterUuid ? resolve(data.characterUuid) : null;
	const npc = data?.npcUuid ? resolve(data.npcUuid) : null;
	if (character?.type !== "character" || !npc || !asker || !character.testUserPermission?.(asker, "OWNER")) return null;
	const linked = npcOf(character, data.ftype, data.slug);
	if (!linked || (linked.uuid ?? linked.id) !== (npc.uuid ?? npc.id)) return null;
	const hp = npc.system?.attributes?.hp ?? {};
	const to = followerNpcHpTarget(hp, hpCount(data.to), { raiseOnly: !!data.raiseOnly });
	const moveName = typeof data.moveName === "string" && data.moveName ? data.moveName : null;
	if (Number(hp.value) !== to) await updateWith(npc, { "system.attributes.hp.value": to }, moveName);
	return { to };
}
