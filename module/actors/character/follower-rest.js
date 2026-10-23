// FOLLOWERS WHO RECOVER OR CONVALESCE (Book I p.240): "A PC or follower regains HP when ... they Recover
// (page 328); ... they have a few days of downtime and Convalesce (page 249)". A follower at 0 HP from
// harm that wasn't lethal is "out of the action until you say otherwise or they regain HP (because of
// magic, someone's move, or because someone tends to their wounds and they Recover)" (p.469), so one who
// is down may be picked too; one marked dead, or a group member marked fallen, never is.
//
// A group's members are healed one by one: "When a group ... Recovers, then each member who regains HP
// must consume 1 use of Supplies" (p.473). So Recover costs a use per BODY that regains HP, and heals each
// by the move's 4+Prosperity; Convalesce sets each back to their max and costs nothing.
//
// The boxes on the character's own sheet are written together, in ONE update (as Make Camp's heals are,
// camp-followers.js#campFollowerHeals), so healing five followers is one write and one redraw, not five.
// A follower with an NPC of their own heals on the NPC, whose HP is theirs, and the card's box follows
// it: those go through follower-hp.js#setFollowerHp, the one writer of an NPC-held follower's HP.

import { followerRoster, followerRosterOf } from "./follower-roster.js";
import { followerFateHpPath, followerHpWriteUpdate, linkedFollowerNpc, rosterMemberRow } from "./follower-fate.js";
import { followerActorFromLink } from "./follower-actors.js";
import { readableFlags } from "./StonetopFlags.js";
import { npcHpWritable, setFollowerHp } from "./follower-hp.js";
import { groupFollowerMembers } from "../../utils/crew.js";
import { rosterHpUpdate, rosterMemberHp } from "../../fight/group-hits.js";
import { count } from "../../camp/camp-rules.js";
import { memberMax } from "../../camp/camp-followers.js";

/**
 * Every follower body below their max HP, alive, as a list a window can offer: `id` is stable for the
 * pick, `row` is the HP row setFollowerHp writes. `npcHeld` marks a one-body follower whose HP is their
 * NPC's; a group's member carries its `card` and roster `key` (fight/group-hits.js#rosterHpUpdate). PURE.
 *
 * @param {object} flags  the character's resolved flags
 * @param {object[]} followers  follower-roster.js#followerRoster's records
 * `healable: false` marks an NPC-held body this client cannot heal right now (follower-hp.js#npcHpWritable:
 * not its owner, and no GM here to write it for them), which a window offers greyed out and a Recover
 * leaves out before it spends a use on them.
 *
 * @param {{npcFor?: Function, gm?: User|null}} [options]  `npcFor(follower)`: the NPC standing for a one-body
 *   follower, or null (follower-fate.js#linkedFollowerNpc); while there is one, its HP is the follower's
 * @returns {Array<{id: string, name: string, from: number, max: number, row: {follower: string, slug: string, index?: number},
 *   npcHeld?: boolean, healable?: boolean, card?: {ftype: string, slug: string}, key?: string}>}
 */
export function followerRestBodies(flags, followers = [], { npcFor = null, gm = globalThis.game?.users?.activeGM ?? null } = {}) {
	const out = [];
	for (const fol of Array.isArray(followers) ? followers : []) {
		if (!fol?.ftype || fol.dead) continue;
		const slug = fol.slug ?? "";
		const name = String(fol.name ?? "").trim() || "A follower";
		const group = fol.ftype === "crew" || (fol.ftype === "custom" && !!fol.isGroup);
		if (!group) {
			if (typeof fol.hpMax !== "number" || !followerFateHpPath(fol.ftype, slug)) continue;
			const npc = typeof npcFor === "function" ? npcFor(fol) : null;
			const npcHp = npc?.system?.attributes?.hp ?? null;
			const linked = !!(npc && count(npcHp?.max));
			const max = linked ? count(npcHp.max) : count(fol.hpMax);
			const from = Math.min(max, count(linked ? npcHp.value : fol.hpCurrent));
			if (!max || from >= max) continue;
			out.push({
				id: `${fol.ftype}:${slug}`, name, from, max, row: { follower: fol.ftype, slug }, npcHeld: !!npc,
				...(npc ? { healable: npcHpWritable(npc, { gm }) } : {}),
			});
			continue;
		}
		const max = memberMax(fol);
		if (!max) continue;
		const card = { ftype: fol.ftype, slug };
		for (const member of groupFollowerMembers(flags, card, { down: true })) {
			if (member.dead) continue;
			const row = rosterMemberRow(fol.ftype, member.key);
			const from = rosterMemberHp(flags, card, member.key, max);
			if (!row || from >= max) continue;
			out.push({ id: `${fol.ftype}:${slug}:${member.key}`, name: `${name}: ${member.name}`, from, max, row: { ...row, slug }, card, key: member.key });
		}
	}
	return out;
}

/**
 * A character's follower bodies below max (followerRestBodies), read live. Never throws.
 *
 * `inputs` is what follower-roster.js#followerRoster reads (the playbook, the crew and companion
 * inserts and their bonuses), when the caller has them already: the sheet's getData has worked them
 * all out for the Followers tab, and would otherwise build them a second time on every render.
 */
export async function hurtFollowerBodies(character, { inputs = null, roster = followerRosterOf, link = followerActorFromLink } = {}) {
	if (!character) return [];
	try {
		const flags = readableFlags(character);
		const followers = inputs ? followerRoster(character, flags, inputs) : await roster(character);
		return followerRestBodies(flags, followers, {
			npcFor: fol => linkedFollowerNpc(flags, fol.ftype, fol.slug ?? "", link),
		});
	} catch (err) {
		console.warn(`Stonetop | could not read ${character?.name ?? "a character"}'s followers' HP`, err);
		return [];
	}
}

/**
 * Heal the picked follower bodies (`ids`, from followerRestBodies) of `character`: by `heal` HP each,
 * capped at their max (Recover), or with `heal` null back to their max (Convalesce). Read again HERE, so
 * a body healed or hurt since the window opened is healed from where it is now, and one no longer below
 * max is skipped; a caller that has just read them live hands them in as `bodies` instead.
 *
 * Every box on the character's sheet lands in ONE update; a body whose HP is their NPC's goes through
 * setFollowerHp, a heal that never lowers the NPC.
 *
 * @returns {Promise<Array<{id: string, name: string, from: number, to: number}>>}  who regained HP
 */
export async function restFollowers(character, ids, {
	heal = null, moveName = null, bodies = null, roster = followerRosterOf, link = followerActorFromLink, set = setFollowerHp,
} = {}) {
	const wanted = new Set(ids ?? []);
	if (!character || !wanted.size) return [];
	const picked = (bodies ?? await hurtFollowerBodies(character, { roster, link })).filter(b => wanted.has(b.id));
	const flags = readableFlags(character);
	const update = {};
	// A group's members' HP is one array per card, so each card's are written together (rosterHpUpdate).
	const groups = new Map();
	const heals = [];
	for (const body of picked) {
		const to = heal == null ? body.max : Math.min(body.max, body.from + count(heal));
		if (to <= body.from) continue;
		heals.push({ body, to });
		if (body.npcHeld) continue;
		if (body.card && body.key != null) {
			const id = `${body.card.ftype}:${body.card.slug}`;
			if (!groups.has(id)) groups.set(id, { card: body.card, hpByKey: {} });
			groups.get(id).hpByKey[body.key] = to;
		} else {
			Object.assign(update, followerHpWriteUpdate(flags, body.row.follower, body.row.slug ?? "", body.row.index ?? null, to));
		}
	}
	for (const { card, hpByKey } of groups.values()) Object.assign(update, rosterHpUpdate(flags, card, hpByKey));
	const boxed = Object.keys(update).length > 0;
	if (boxed) await (moveName ? character.update(update, { stonetopMove: moveName }) : character.update(update));
	const healed = [];
	for (const { body, to } of heals) {
		const landed = body.npcHeld ? await set(character, body.row, to, { moveName, raiseOnly: true, link }) : boxed;
		if (landed) healed.push({ id: body.id, name: body.name, from: body.from, to });
	}
	return healed;
}

/** The chat row for followers healed by a move, or null when nobody was. */
export function followerRestRow(healed) {
	if (!healed?.length) return null;
	return { label: healed.length === 1 ? "Follower" : "Followers", value: healed.map(h => `${h.name} ${h.from} → ${h.to}`).join("; ") };
}
