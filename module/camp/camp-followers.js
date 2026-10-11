// MAKE CAMP for the followers fed at the fire (Book I p.240: "A PC or follower regains HP when ...
// they Make Camp, and choose to regain HP"). The user's ruling: when a camp settles, each follower who
// was fed regains half their max HP, rounded up, capped at their max, and a note says who regained
// what. The followers a camp feeds are the ones travelling with the party, of every kind
// (follower-party.js, the one reading of that toggle): the animal companion, the crew, initiates,
// beasts, and custom followers.
//
// Written where the Followers tab's HP boxes write, the same places Bath of Healing Light heals: one
// follower's box with the revive it makes (follower-fate.js#followerHpWriteUpdate, the box half of
// follower-hp.js#setFollowerHp), folded into the share's one write, and a group's members, the crew's
// roster or a custom group's, through group-hits.js#rosterHpUpdate, member by member (p.473). A
// follower with an NPC is healed on the NPC alone, whose HP is theirs (wave 3 audit FOL-2), through
// setFollowerHp after the share's write (camp-store.js#payShare); the box mirrors it. A
// follower or member at 0 HP is not raised: what happens to them is the GM's call (p.469, the fate
// dialog), not a night's sleep, so they are left as they are and the note says so. One marked dead,
// or a group member marked fallen, never ate and is never touched.

import { groupFollowerMembers } from "../utils/crew.js";
import { rosterHpUpdate, rosterMemberHp } from "../fight/group-hits.js";
import { followerFateHpPath, followerHpWriteUpdate, linkedFollowerNpc } from "../actors/character/follower-fate.js";
import { followerActorFromLink } from "../actors/character/follower-actors.js";
import { readableFlags } from "../actors/character/StonetopFlags.js";
import { partyFollowers } from "../actors/character/follower-party.js";
import { count, healTo } from "./camp-rules.js";

/** A group: the crew, or a custom follower fought and counted as a group. */
function isGroup(follower, flags) {
	return follower.ftype === "crew" || (follower.ftype === "custom" && !!flags?.customFollowers?.[follower.slug]?.isGroup);
}

/** One member's max HP in a group: the crew's per-member HP, a custom group's member HP. */
function memberMax(follower) {
	return count(follower.ftype === "crew" ? (follower.memberHp ?? follower.hpMax) : (follower.groupMemberHp ?? follower.hpMax));
}

/**
 * What a settled camp does for one character's fed followers. PURE.
 *
 * @param {object} flags  the character's resolved system flags
 * @param {object[]} followers  the character's follower records (follower-roster.js#followerRoster);
 *   only the ones travelling with the party, alive, are healed (partyFollowers)
 * @param {{npcFor?: Function}} [options]  `npcFor(follower)`: the NPC standing for a one-body follower,
 *   or null (follower-fate.js#linkedFollowerNpc). That NPC heals INSTEAD of the card's box, by half ITS max,
 *   capped at it (wave 3 audit FOL-2): its HP is the follower's while it exists, and the box mirrors it. It
 *   is not in `update` but in `npcHeals`, for follower-hp.js#setFollowerHp, and the note names its HP.
 *   `breads`: Break Bread's 1d8s when the followers shared the proper meal (camp-rules.js
 *   #followersBreakBread), one per mouth, handed out a body at a time in roster order. "Each of you
 *   recovers 1d8 (extra) HP", on top of the night's half: one down at 0 HP still uses up their die and
 *   takes nothing, as they take nothing from the night. The NPC heals by the same die, capped at its max.
 * @returns {{update: object, healed: Array<{name: string, from: number, to: number, bread?: number}>,
 *   down: string[], npcHeals: Array<{npc: Actor, ftype: string, slug: string, from: number, to: number}>}}
 */
export function campFollowerHeals(flags, followers = [], { npcFor = null, breads = [] } = {}) {
	const update = {};
	const healed = [];
	const down = [];
	const npcHeals = [];
	const dice = Array.isArray(breads) ? breads : [];
	let die = 0;
	const nextBread = () => count(dice[die++]);
	for (const fol of partyFollowers(followers)) {
		const slug = fol.slug ?? "";
		const name = String(fol.name ?? "").trim() || "A follower";
		if (!isGroup(fol, flags)) {
			const path = followerFateHpPath(fol.ftype, slug);
			const max = count(fol.hpMax);
			if (!path || !max || typeof fol.hpMax !== "number") continue;
			const from = Math.min(max, count(fol.hpCurrent));
			const npc = typeof npcFor === "function" ? npcFor(fol) : null;
			const npcHp = npc?.system?.attributes?.hp ?? null;
			const npcMax = count(npcHp?.max);
			const npcFrom = Math.min(npcMax, count(npcHp?.value));
			const bread = nextBread();
			// While there is an NPC, its HP is theirs: one down there is down, whatever the box says.
			if (from <= 0 || (npc && npcMax && npcFrom <= 0)) { down.push(name); continue; }
			// And it is the NPC that heals, the box following it (fight/roster-fate.js).
			const linked = !!(npc && npcMax);
			const [at, top] = linked ? [npcFrom, npcMax] : [from, max];
			const half = healTo(at, Math.ceil(top / 2), top);
			const to = healTo(half, bread, top);
			if (to > at) {
				if (linked) npcHeals.push({ npc, ftype: fol.ftype, slug, from: at, to });
				else Object.assign(update, followerHpWriteUpdate(flags, fol.ftype, slug, null, to));
				healed.push({ name, from: at, to, ...(to > half ? { bread: to - half } : {}) });
			}
			continue;
		}
		const max = memberMax(fol);
		if (!max) continue;
		const roster = { ftype: fol.ftype, slug };
		const hpByKey = {};
		for (const member of groupFollowerMembers(flags, roster, { down: true }).filter(m => !m.dead)) {
			const who = `${name}: ${member.name}`;
			const from = rosterMemberHp(flags, roster, member.key, max);
			const bread = nextBread();
			if (from <= 0) { down.push(who); continue; }
			const half = healTo(from, Math.ceil(max / 2), max);
			const to = healTo(half, bread, max);
			if (to > from) {
				hpByKey[member.key] = to;
				healed.push({ name: who, from, to, ...(to > half ? { bread: to - half } : {}) });
			}
		}
		if (Object.keys(hpByKey).length) Object.assign(update, rosterHpUpdate(flags, roster, hpByKey));
	}
	return { update, healed, down, npcHeals };
}

/** The note's rows for a camp's follower heals (campFollowerHeals' answer, or a shortfall's). */
export function campFollowerRows({ healed = [], down = [] } = {}, { fed = 0, party = 0 } = {}) {
	if (fed > 0 && fed < party) {
		return [{
			label: "Followers",
			value: `Only ${fed} of ${party} followers were fed at the fire, so none regained HP here: the table says who ate, and their HP goes on by hand (half their max, rounded up).`,
		}];
	}
	const rows = [];
	if (healed.length) {
		// Break Bread's share named on the follower it landed on: "each of you recovers 1d8 (extra) HP".
		const lead = healed.some(h => h.bread) ? "Half their max HP, rounded up, and Break Bread's 1d8 extra" : "Half their max HP, rounded up";
		rows.push({ label: "Followers", value: `${lead}: ${healed.map(h => `${h.name} ${h.from} → ${h.to}${h.bread ? ` (Break Bread +${h.bread})` : ""}`).join("; ")}.` });
	}
	if (down.length) {
		rows.push({ label: "Still down", value: `${down.join(", ")} at 0 HP: the night does not raise them, and what happens to them is the GM's call.` });
	}
	return rows;
}

/**
 * One character's fed followers, settled: the HP update to fold into their share's write, and the
 * note's rows. `entry.followersFed` is how many mouths beside their own the camp fed (camp-rules.js
 * #freezeCampPlan); `partyMouths` is how many of theirs travel with them (partyFollowerMouths), and
 * `followers` their party followers (follower-roster.js#partyFollowersOf), null when not read. When
 * fewer were fed than travel with them, nobody can say which went hungry, so none are healed and the
 * note says so.
 */
export async function campFollowerShare(actor, entry, { partyMouths = 0, followers = null } = {}) {
	const fed = count(entry?.followersFed);
	if (!fed || !actor) return { update: {}, rows: [] };
	const party = count(partyMouths);
	if (fed < party) return { update: {}, rows: campFollowerRows({}, { fed, party }) };
	if (!Array.isArray(followers)) return { update: {}, rows: [] };
	const flags = readableFlags(actor);
	const heals = campFollowerHeals(flags, followers, {
		npcFor: fol => linkedFollowerNpc(flags, fol.ftype, fol.slug ?? "", followerActorFromLink),
		breads: entry?.followerBreads ?? [],
	});
	return { update: heals.update, rows: campFollowerRows(heals), npcHeals: heals.npcHeals };
}
