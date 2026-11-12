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
import { crewSuppliesOf } from "../../camp/camp-store.js";
import { plural } from "../../utils/plural.js";
import { SYSTEM_ID } from "../../system-id.js";
import { isShiftingRow, resolveRosterRef, rosterShiftsPath, rosterStamp } from "./follower-roster-shifts.js";

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
 * `lock` (Recover's) locks each body healed until it takes more damage (recoverLockUpdate, audit ROAD-4).
 * A box-held body's lock rides the box write itself, so a Recover is one update of the character and not
 * two: each one re-renders the sheet on every client and runs every updateActor hook. A body whose HP is
 * their NPC's is locked once the NPC has taken the heal, in one write for all of them.
 *
 * @returns {Promise<Array<{id: string, name: string, from: number, to: number}>>}  who regained HP
 */
export async function restFollowers(character, ids, {
	heal = null, moveName = null, bodies = null, lock = false, roster = followerRosterOf, link = followerActorFromLink, set = setFollowerHp,
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
	// Whether any HP box is written is asked BEFORE the locks join the write: a box-held body has regained HP
	// only when its box was written, never because its lock was.
	const boxed = Object.keys(update).length > 0;
	if (boxed) {
		const write = lock ? { ...update, ...recoverLockUpdate(heals.filter(h => !h.body.npcHeld).map(h => h.body), flags) } : update;
		await (moveName ? character.update(write, { stonetopMove: moveName }) : character.update(write));
	}
	const healed = [];
	const npcHealed = [];
	for (const { body, to } of heals) {
		const landed = body.npcHeld ? await set(character, body.row, to, { moveName, raiseOnly: true, link }) : boxed;
		if (!landed) continue;
		healed.push({ id: body.id, name: body.name, from: body.from, to });
		if (body.npcHeld) npcHealed.push(body);
	}
	const npcLocks = lock ? recoverLockUpdate(npcHealed, flags) : {};
	if (Object.keys(npcLocks).length) await character.update(npcLocks, { stonetopLedger: true });
	return healed;
}

/**
 * What a Recover can do for a character's hurt followers, worked out in ONE place for the Recover card, its
 * window and the press that applies it, so the three never disagree. `hurt` is hurtFollowerBodies' read;
 * the lock flags and the crew's Supplies are read off the character HERE, so a caller asks again at the
 * press rather than keeping a plan from when the window opened (a carer or a payer may take minutes to
 * answer in between). PURE but for those two reads.
 *
 * - `hurt`: the bodies below max (only those in `ids`, when the caller ticked some);
 * - `locked`: those whose Recover is spent until they take more damage (audit ROAD-4, the user's ruling E10);
 * - `bodies`: the rest, the ones a Recover can be made for. With `canPay` false nothing but the crew's own
 *   Supplies can pay, so only the crew's members, and none once those Supplies are empty;
 * - `waiting`: those of `bodies` whose HP is an NPC this client cannot write, with no GM here to write it
 *   (followerRestBodies' `healable: false`), so no use is spent on a heal that could not land;
 * - `healing`: `bodies` without `waiting`, the ones a press heals;
 * - `crewHeld`: what the crew's own Supplies hold, read only when one of `bodies` is a crew member, else 0;
 * - `crewPays`: how many of `healing` those Supplies pay for, "food that the followers brought with them"
 *   (Book I p.472-473, audit ROAD-3), before anything falls to a pack.
 *
 * @param {Actor} character
 * @param {object[]} hurt  followerRestBodies' records
 * @param {{ids?: string[]|null, canPay?: boolean, crewHeld?: (actor: Actor) => number}} [options]
 */
export function recoverFollowerPlan(character, hurt, { ids = null, canPay = true, crewHeld = actor => crewSuppliesOf(actor).held } = {}) {
	const wanted = ids ? new Set(ids) : null;
	const all = (Array.isArray(hurt) ? hurt : []).filter(b => !wanted || wanted.has(b.id));
	const open = recoverableBodies(readableFlags(character), all);
	const locked = all.filter(b => !open.includes(b));
	const isCrew = b => b.card?.ftype === "crew";
	const held = open.some(isCrew) ? crewHeld(character) : 0;
	const bodies = canPay ? open : held > 0 ? open.filter(isCrew) : [];
	const waiting = bodies.filter(b => b.healable === false);
	const healing = bodies.filter(b => b.healable !== false);
	return { hurt: all, locked, bodies, waiting, healing, crewHeld: held, crewPays: Math.min(healing.filter(isCrew).length, held) };
}

// ── A follower's Recover, once until they take more damage (audit ROAD-4, the user's ruling E10) ─────────
// "Once a given character regains HP via the Recover move, they can't do so again until they take more
// damage" (Book I p.246), a follower body included. The lock is per BODY, keyed by the rest-body id
// (followerRestBodies), on the character: `flags.<system>.recoverFollowers.<id>` holds the body's HP row
// ({follower, slug, index}) while locked and null once lifted. Set by Recover only (Convalesce heals with no
// lock), and lifted by the character's preUpdateActor hook when that row's HP box drops (recoverUnlockChanges):
// an NPC-held follower's box mirrors its NPC (fight/roster-fate.js#onUpdateActorFollowerHp), so a blow on the
// token lifts it too.
//
// A group member's row is an index into the roster, and a member struck off moves every later row up one, so a
// member's lock also keeps the roster's number when it was set (follower-roster-shifts.js#rosterStamp, as every
// other remembered row does) and is read back through the cuts made since: the lock follows its member, and one
// whose member was cut out matches nobody. Its key carries that number too, so a newcomer who moves into the
// same slot and Recovers gets a lock of their own instead of overwriting the first.

/** The flag (under the system scope) holding the follower Recover locks. */
export const RECOVER_FOLLOWERS_FLAG = "recoverFollowers";

/** The rest-body ids whose Recover is spent, off the character's resolved flags. PURE. */
export function recoverLockedIds(flags) {
	const locks = flags?.[RECOVER_FOLLOWERS_FLAG];
	return new Set(Object.entries(locks && typeof locks === "object" ? locks : {}).filter(([, v]) => !!v).map(([id]) => id));
}

/** A row's key for matching a lock against a body: follower type, slug, index. */
const rowKey = (follower, slug, index) => `${follower}|${slug ?? ""}|${index ?? ""}`;

/** The row a stored lock names NOW (resolveRosterRef), or null when its member was struck off since. PURE. */
function lockRowNow(flags, lock) {
	const now = resolveRosterRef(flags, lock);
	return now ? { follower: now.follower, slug: lock.slug ?? "", index: now.index } : null;
}

/** The bodies (followerRestBodies) whose Recover is not spent. PURE. */
export function recoverableBodies(flags, bodies) {
	const locks = flags?.[RECOVER_FOLLOWERS_FLAG];
	const lockedRows = new Set();
	for (const lock of Object.values(locks && typeof locks === "object" ? locks : {})) {
		if (!lock?.follower) continue;
		const now = lockRowNow(flags, lock);
		if (now) lockedRows.add(rowKey(now.follower, now.slug, now.index));
	}
	return (Array.isArray(bodies) ? bodies : []).filter(b => !lockedRows.has(rowKey(b.row?.follower, b.row?.slug, b.row?.index)));
}

/**
 * The update that locks each body Recover healed (`bodies` carry `id` and `row`). `flags` (the character's
 * resolved flags) stamps a group member's lock with the roster's number now. PURE.
 */
export function recoverLockUpdate(bodies, flags = null) {
	const update = {};
	for (const b of Array.isArray(bodies) ? bodies : []) {
		if (!b?.id || !b.row?.follower) continue;
		const slug = b.row.slug ?? "";
		const stamp = isShiftingRow(b.row.follower) ? rosterStamp(flags, b.row.follower, slug) : null;
		const key = stamp ? `${b.id}@${stamp}` : b.id;
		update[`flags.${SYSTEM_ID}.${RECOVER_FOLLOWERS_FLAG}.${key}`] = {
			follower: b.row.follower, slug, ...(b.row.index != null ? { index: b.row.index } : {}),
			...(stamp != null ? { stamp } : {}),
		};
	}
	return update;
}

/**
 * Lift, in the same write, the Recover lock of every body whose HP box this update LOWERS: the preUpdateActor
 * half of the lock. `changes` is Foundry's expanded diff; mutated in place. Returns the ids lifted.
 *
 * A member's row is read where it is before this write and where it is after it (a strike-off in this same
 * write moves it), so the box compared is the member's own on both sides. A lock whose member is gone, before
 * or by this write, is cleared.
 */
export function recoverUnlockChanges(actor, changes) {
	if (!changes?.flags?.[SYSTEM_ID]) return [];
	const flags = readableFlags(actor ?? {}) ?? {};
	const locks = flags[RECOVER_FOLLOWERS_FLAG];
	if (!locks || typeof locks !== "object") return [];
	const lifted = [];
	const lift = id => {
		foundry.utils.setProperty(changes, `flags.${SYSTEM_ID}.${RECOVER_FOLLOWERS_FLAG}.${id}`, null);
		lifted.push(id);
	};
	for (const [id, lock] of Object.entries(locks)) {
		if (!lock?.follower) continue;
		const was = lockRowNow(flags, lock);
		if (!was) { lift(id); continue; }
		let now = was;
		const shiftsPath = isShiftingRow(lock.follower) ? rosterShiftsPath(lock.follower, lock.slug ?? "") : null;
		const nextShifts = shiftsPath ? foundry.utils.getProperty(changes, `flags.${SYSTEM_ID}.${shiftsPath}`) : undefined;
		if (nextShifts !== undefined) {
			const after = {};
			foundry.utils.setProperty(after, shiftsPath, nextShifts);
			now = lockRowNow(after, lock);
			if (!now) { lift(id); continue; }
		}
		const pathBefore = followerFateHpPath(was.follower, was.slug, was.index);
		const pathAfter = followerFateHpPath(now.follower, now.slug, now.index);
		if (!pathBefore || !pathAfter) continue;
		const next = foundry.utils.getProperty(changes, `flags.${SYSTEM_ID}.${pathAfter}`);
		if (next === undefined || next === null || next === "") continue;
		const before = Number(foundry.utils.getProperty(flags, pathBefore));
		if (Number.isFinite(before) && Number(next) < before) lift(id);
	}
	return lifted;
}

/** The chat row for followers healed by a move, or null when nobody was. */
export function followerRestRow(healed) {
	if (!healed?.length) return null;
	return { label: plural(healed.length, "Follower"), value: healed.map(h => `${h.name} ${h.from} → ${h.to}`).join("; ") };
}
