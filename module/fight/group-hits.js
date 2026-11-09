// One fighter's blow landing on a token that stands for a whole group.
//
// A group fought as one (p.416) has "HP and armor as though it was one individual member of the group",
// and "damage represents casualties". That is the arithmetic for a group trading blows with another group.
// A single fighter swinging into it is something else: "Foes that are engaged by individual PCs aren't
// really part of a group" (p.416), and Rhianna, cutting her way through six crinwin, drops the first and
// leaves the second "up but injured" (p.415). Taken off the pool, the same 3 damage from her would put all
// twelve crinwin of a horde out at once, because the pool is only one crinwin's 3 HP.
//
// SO A LONE ATTACKER'S BLOW HITS ONE MEMBER. It is measured against one member's HP (the pool's maximum):
// enough to drop them, and one fewer stands (the group's size goes down by one); short of that, the member
// is hurt, and the harm is kept on the token until the next lone blow finishes them. One blow drops one
// member however hard it lands: the others are not in the way of it. The pool itself is left to the group
// exchanges it was made for.
//
// A GROUP'S BLOW ON A GROUP stays on the pool, as the book has it, and so does anything aimed at a token
// that is not fighting as a group.
//
// A GROUP FOLLOWER (the Marshal's crew, a custom group) keeps its members on its character's roster, each
// with their own HP, so a lone blow on its token lands on ONE OF THEM there: the first still standing,
// and the card that applied it offers to give it to another (combat/attack-flow.js#wireRosterHitMove).
// The token's HP is the group's pool, left to group exchanges exactly as a monster group's is, and the
// fight counts the crew's bodies off the roster (fight-sides.js#bodiesFor), so they fall as members do.
// A crew member (or a custom group's member) dropped this way is a follower at 0 HP (p.469), so their
// fate is asked on the screen of whoever answers for the character, as the sheet's own HP box asks it
// (ROSTER_FATE_OPTION, roster-fate.js).

import { SYSTEM_ID } from "../system-id.js";
import { isFightTabEnabled } from "../settings.js";
import { groupCasualties } from "../data/follower-build.js";
import { fightsAsGroup } from "./fight-sides.js";
import { fightOnScene, combatantBodies, GROUP_SIZE_FLAG, groupStartSize } from "./fight-state.js";
import { rollerCombatant } from "./damage-seed.js";
import { followerCardFor } from "../actors/character/follower-masters.js";
import { readableFlags, STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { groupFollowerStanding, groupFollowerMembers } from "../utils/crew.js";
import { ARRAY_HP_ROWS, followerFateHpPath, rosterMemberKey, rosterMemberRow } from "../actors/character/follower-fate.js";
import { resolveRosterRef, rosterStamp } from "../actors/character/follower-roster-shifts.js";

/** The flag holding the HP the group's currently hurt member has lost. */
export const GROUP_WOUND_FLAG = "groupWound";

// The size a group started at (GROUP_SIZE_FLAG, groupStartSize) lives in fight-state.js, which counts bodies.
export { GROUP_SIZE_FLAG, groupStartSize };

/** The HP a group's hurt member has lost, as kept on its token's actor. */
export const groupWound = actor => Math.max(0, Math.trunc(Number(actor?.flags?.[SYSTEM_ID]?.[GROUP_WOUND_FLAG]) || 0));

/**
 * A group token's numbers, or null for a token that is not one group of several: a monster fighting
 * as a group, with more than one of them left.
 *
 * @param {Actor} actor  the token's actor
 * @returns {{hpMax: number, hp: number, count: number, standing: number, wound: number}|null}
 */
export function groupTokenInfo(actor) {
	const system = actor?.system ?? {};
	if (!fightsAsGroup({ type: actor?.type, fightAsGroup: system.fightAsGroup, organization: system.organization })) return null;
	const hpMax = Math.trunc(Number(system.attributes?.hp?.max) || 0);
	const count = Math.trunc(Number(system.count) || 0);
	if (hpMax <= 0 || count <= 1) return null;
	const hp = Number.isFinite(Number(system.attributes?.hp?.value)) ? Number(system.attributes.hp.value) : hpMax;
	const { standing } = groupCasualties({ hpMax, hpCurrent: hp, count });
	if (standing <= 1) return null;
	return { hpMax, hp, count, standing, wound: groupWound(actor) };
}

/**
 * How many bodies one blow dropped.
 *
 *  • One creature: one, if the blow took it from above 0 to 0.
 *  • A group fought as ONE pool (p.416, a group or horde with Group fight on): the members the blow
 *    put out of the fight, read off the pool as casualties before and after. A blow that routs the
 *    group counts every member still standing -- "routed, massacred, or otherwise defeated" is one
 *    outcome on the page, and the GM can correct the row if the survivors fled.
 *
 * @param {{oldHp: number, newHp: number, group?: {count: number, hpMax: number}|null}} hit
 * @returns {number}
 */
export function killsFromHit({ oldHp, newHp, group = null } = {}) {
	const before = Number(oldHp);
	const after = Number(newHp);
	if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) return 0;
	const count = Math.trunc(Number(group?.count) || 0);
	const hpMax = Math.trunc(Number(group?.hpMax) || 0);
	if (count > 1 && hpMax > 0) {
		const standingBefore = groupCasualties({ hpMax, hpCurrent: before, count }).standing;
		const standingAfter = groupCasualties({ hpMax, hpCurrent: after, count }).standing;
		return Math.max(0, standingBefore - standingAfter);
	}
	return after <= 0 ? 1 : 0;
}

/**
 * What one lone blow does to one member of a group. PURE.
 *
 * A POOL ALREADY DRAINED BY A GROUP'S BLOWS reads its casualties as a share of the size (p.416: "If one group
 * loses half its HP, then about half that group's numbers are out the action"), rounded to the nearest body. One
 * fewer in the size then need not mean one fewer standing: a horde of six at a third of its pool stands two, and
 * five at a third still stands two. So a member dropped from a drained pool is taken off the members STANDING:
 * the group goes on as the survivors at a full pool (`pool`), which is the same number of bodies read the same
 * way, and one fewer than before the blow, as the card says.
 *
 * @param {{hpMax: number, count: number, wound: number, hp?: number, standing?: number}} group  `hp` is the
 *   pool's current HP, `standing` the members it leaves up (groupTokenInfo)
 * @param {number} damage  after armor
 * @returns {{down: boolean, harmed: boolean, count: number, wound: number, memberHp: number, pool?: number}}
 *   `harmed` is false for a blow that did no damage, `count` is the group's size afterwards, `wound` the
 *   hurt member's HP lost afterwards, `memberHp` what that member has left (0 when they went down), and `pool`
 *   the pool's HP afterwards, only when a drained pool was set back to full round the survivors.
 */
export function memberHit({ hpMax, count, wound = 0, hp = hpMax, standing = count }, damage) {
	const dealt = Math.max(0, Math.round(Number(damage) || 0));
	const lost = Math.max(0, Math.trunc(Number(wound) || 0)) + dealt;
	const drained = Number.isFinite(Number(hp)) && Number(hp) < hpMax;
	if (dealt > 0 && lost >= hpMax && drained) {
		return { down: true, harmed: true, count: Math.max(0, Math.trunc(Number(standing) || 0) - 1), wound: 0, memberHp: 0, pool: hpMax };
	}
	if (dealt > 0 && lost >= hpMax) return { down: true, harmed: true, count: Math.max(0, count - 1), wound: 0, memberHp: 0 };
	return { down: false, harmed: dealt > 0, count, wound: lost, memberHp: Math.max(0, hpMax - lost) };
}

/**
 * Whether the attacker behind a damage card is itself a group on the map: a token standing for more than
 * one body in the fight where `scene` is. Anyone else, including an attacker the fight cannot place, is a
 * lone attacker.
 *
 * @param {Actor|null} attacker
 * @param {Scene|null} scene  the scene the target stands on
 */
export function attackerIsGroup(attacker, scene) {
	if (!attacker || !scene) return false;
	const combat = fightOnScene(scene);
	const combatant = rollerCombatant(combat, scene, attacker);
	return !!combatant && combatantBodies(combatant).bodies > 1;
}

/**
 * Whether damage from `attacker` onto `targetActor` is a lone blow into a group (see the note at the top):
 * the Fight tab on, the target a group token (a monster group, or a group follower with a roster), and
 * the attacker not a group.
 *
 * `attackerGroup` is that last answer as it stood when the blow was ROLLED (a damage card stamps it), which
 * wins over the fight as it stands now: a group's blow applied after its fight ended is still a group's.
 */
export function isLoneBlowOnGroup(targetActor, attacker, scene, { resolve, attackerGroup = null } = {}) {
	if (!isFightTabEnabled()) return false;
	const group = !!groupTokenInfo(targetActor) || !!rosterGroupFor(targetActor, { resolve });
	if (!group) return false;
	return !(typeof attackerGroup === "boolean" ? attackerGroup : attackerIsGroup(attacker, scene));
}

// ── A GROUP FOLLOWER'S ROSTER ───────────────────────────────────────────────────────────────────

/**
 * A group follower token's roster, or null for anyone else: the crew or a custom group, several strong,
 * with at least one member standing, whose character can be found.
 *
 * `hpMax` is one member's HP, which is what the token carries as its maximum (the pool is one member's
 * worth, follower-actor.js#followerHpMax), and what the roster rows are drawn against.
 *
 * `down` is for a heal (Bath of Healing Light, invocation-apply.js): the roster even with nobody standing,
 * and its members at 0 HP listed among the rest.
 *
 * @param {Actor} actor  the token's actor
 * @param {{resolve?: Function, down?: boolean}} [options]  `resolve` is passed to followerCardFor
 * @returns {null|{character: Actor, ftype: string, slug: string, hpMax: number, standing: number,
 *   size: number, members: Array<{key: string, name: string, dead?: boolean}>}}
 */
export function rosterGroupFor(actor, { resolve, down = false } = {}) {
	if (actor?.type !== "npc") return null;
	const card = followerCardFor(actor, resolve ? { resolve } : {});
	if (!card || (card.ftype !== "crew" && card.ftype !== "custom")) return null;
	const flags = readableFlags(card.character);
	const tally = groupFollowerStanding(flags, card);
	if (!tally || tally.size <= 1 || (tally.standing < 1 && !down)) return null;
	const hpMax = rosterMemberHpMax(actor, flags, card);
	if (hpMax <= 0) return null;
	// `dead` rides along for a custom group's member marked fallen, listed only with `down` (utils/crew.js).
	const members = groupFollowerMembers(flags, card, { down }).map(({ key, name, dead }) => ({ key, name, ...(dead ? { dead } : {}) }));
	return { character: card.character, ftype: card.ftype, slug: card.slug ?? "", hpMax, standing: tally.standing, size: tally.size, members };
}

/** One member's HP: a custom group's own stored maximum, else the token's (the crew's, kept in step by the sheet). */
function rosterMemberHpMax(actor, flags, { ftype, slug }) {
	if (ftype === "custom") {
		const own = Math.trunc(Number(flags?.customFollowers?.[slug]?.hpMax) || 0);
		if (own > 0) return own;
	}
	return Math.trunc(Number(actor?.system?.attributes?.hp?.max) || 0);
}

/**
 * A roster member's current HP, on the sheet's own terms (`_clampHp`): nothing stored is full HP.
 * PURE.
 *
 * @param {object} flags  the character's system flags
 * @param {{ftype: string, slug?: string}} card
 * @param {string} key  utils/crew.js#groupFollowerMembers's key: `named:i`, `anon:i` or `member:i`
 * @param {number} hpMax
 */
export function rosterMemberHp(flags, { ftype, slug = "" }, key, hpMax) {
	const row = rosterMemberRow(ftype, key);
	const path = row ? followerFateHpPath(row.follower, slug, row.index) : null;
	const raw = path ? foundry.utils.getProperty(flags ?? {}, path) : undefined;
	const n = Number(raw);
	return raw != null && Number.isFinite(n) ? Math.min(Math.max(0, n), hpMax) : hpMax;
}

/**
 * The actor update that writes roster members' HP: the same stores the character sheet's own HP boxes
 * write (follower-fate.js#followerHpWriteUpdate), a named crew member's by key, an anonymous one's or a
 * custom group member's as the whole array with that slot changed. PURE.
 *
 * @param {object} flags  the character's system flags, for the arrays the slots sit in
 * @param {{ftype: string, slug?: string}} card
 * @param {Record<string, number>} hpByKey  new HP per member key
 * @returns {object}  for `actor.update`
 */
export function rosterHpUpdate(flags, { ftype, slug = "" }, hpByKey) {
	const update = {};
	const arrays = new Map();
	for (const [key, value] of Object.entries(hpByKey)) {
		const row = rosterMemberRow(ftype, key);
		const path = row ? followerFateHpPath(row.follower, slug, row.index) : null;
		if (!path) continue;
		if (!ARRAY_HP_ROWS.has(row.follower)) {
			update[`flags.${STONETOP_SCOPE}.${path}`] = value;
			continue;
		}
		const store = path.slice(0, path.lastIndexOf("."));
		if (!arrays.has(store)) {
			const stored = foundry.utils.getProperty(flags ?? {}, store);
			arrays.set(store, [...(Array.isArray(stored) ? stored : [])]);
		}
		arrays.get(store)[row.index] = value;
	}
	// A slot left empty between two written ones is a member at full HP, which is what `null` reads as.
	for (const [store, list] of arrays) update[`flags.${STONETOP_SCOPE}.${store}`] = Array.from(list, v => v ?? null);
	return update;
}

// ── A ROSTER MEMBER DOWN: THEIR FATE ────────────────────────────────────────────────────────────────

/**
 * The `actor.update` option a roster write carries when it drops a roster member to 0 HP: the fate the
 * Marshal's sheet then asks (StonetopCharacterSheet#_openFollowerFate), in the shape it takes. Every
 * client sees the option with the update, and the one that answers for the Marshal opens the dialog
 * (fight/roster-fate.js). Only this write carries it, so the sheet's own HP box, which opens the
 * dialog itself, never opens a second.
 */
export const ROSTER_FATE_OPTION = "stonetopRosterFate";

/**
 * The fate dialog's arguments for a roster member, a crew member's or a custom group's (whose card
 * `slug` names the group), or null for anyone else. PURE.
 *
 * @param {{ftype: string, slug?: string, key: string, name: string}} roster  the member, as applyRosterHit records them
 * @returns {{follower: string, slug: string, index: number, name: string}|null}
 */
export function rosterFateArgs({ ftype, slug = "", key, name } = {}) {
	const row = rosterMemberRow(ftype, key);
	if (!row || (ftype === "custom" && !slug)) return null;
	return { follower: row.follower, slug: ftype === "custom" ? String(slug) : "", index: row.index, name: String(name ?? "") };
}

/**
 * The update options for a roster write: the fate to ask when it drops a roster member, and the move the
 * blow came from (`stonetopMove`, which the character's ledger names the HP change by), else none.
 */
function rosterWriteOptions(roster, down, stonetopMove = "") {
	const fate = down ? rosterFateArgs(roster) : null;
	const options = { ...(fate ? { [ROSTER_FATE_OPTION]: fate } : {}), ...(stonetopMove ? { stonetopMove } : {}) };
	return Object.keys(options).length ? options : null;
}

/** Write a roster update, with the fate option when it drops a roster member (rosterWriteOptions). */
function writeRoster(character, update, options) {
	return options ? character.update(update, options) : character.update(update);
}

/**
 * Land a lone blow on a group follower's token: on ONE member of its roster, the first standing (or the
 * one `memberKey` names), written on the character the roster belongs to. The token's pool is left alone.
 * Returns what happened, or null when the token is not a group follower with anyone standing.
 *
 * Written by whoever applies the card, which is the GM's client for a player's relayed press
 * (combat/attack-flow.js#handleApplyQuery): the GM may write any character, and a player applying their
 * own card owns the character whose crew it is.
 *
 * @param {Actor} targetActor  the token's actor
 * @param {number} damage  after armor
 * @param {{memberKey?: string, resolve?: Function, stonetopMove?: string}} [options]  `stonetopMove` names
 *   the blow's move on the character's ledger
 * @returns {Promise<null|{roster: object, down: boolean, harmed: boolean, before: number, after: number}>}
 *   `roster` is what the card records: whose roster, which member, and their HP before and after
 */
export async function applyRosterHit(targetActor, damage, { memberKey = null, resolve, stonetopMove = "" } = {}) {
	const group = rosterGroupFor(targetActor, { resolve });
	if (!group) return null;
	const member = (memberKey && group.members.find(m => m.key === memberKey)) || group.members[0];
	if (!member) return null;
	const card = { ftype: group.ftype, slug: group.slug };
	const dealt = Math.max(0, Math.round(Number(damage) || 0));
	const flags = readableFlags(group.character);
	const oldHp = rosterMemberHp(flags, card, member.key, group.hpMax);
	const newHp = Math.max(0, oldHp - dealt);
	const down = newHp === 0 && oldHp > 0;
	// A roster member dropped carries their fate with the write (ROSTER_FATE_OPTION).
	if (newHp !== oldHp) {
		await writeRoster(group.character, rosterHpUpdate(flags, card, { [member.key]: newHp }),
			rosterWriteOptions({ ...card, key: member.key, name: member.name }, down, stonetopMove));
	}
	const after = down ? group.standing - 1 : group.standing;
	return {
		roster: { characterUuid: group.character.uuid, ...card, key: member.key, name: member.name, oldHp, newHp, hpMax: group.hpMax, stamp: memberStamp(flags, card, member.key) },
		down,
		harmed: newHp < oldHp,
		before: group.standing,
		after,
	};
}

/** The roster's number (follower-roster-shifts.js#rosterStamp) for the roster `key`'s member sits on. PURE. */
function memberStamp(flags, card, key) {
	return rosterStamp(flags, rosterMemberRow(card.ftype, key)?.follower, card.slug ?? "");
}

/**
 * The key the member a damage card recorded (`roster.key`) sits at NOW, or null when they are gone or no longer
 * as the blow left them. Read back through the roster's cuts (round-2 audit FOE-2) like any remembered row
 * (follower-roster-shifts.js#resolveRosterRef), then held to the HP the card wrote. A card from before the cut
 * log carries no stamp, so its row is taken where it was and, for a named member, held to their name too.
 * PURE but for the flags handed in.
 */
export function rosterHitNow(flags, card, roster, hpMax) {
	const row = rosterMemberRow(card.ftype, roster?.key);
	if (!row) return null;
	const stamped = roster.stamp != null;
	const now = stamped ? resolveRosterRef(flags, { ...row, slug: card.slug ?? "", stamp: roster.stamp }) : row;
	const key = now ? rosterMemberKey(now.follower, now.index) : null;
	const member = key && groupFollowerMembers(flags, card, { down: true }).find(m => m.key === key);
	if (!member) return null;
	// Unstamped: a named member's name is theirs (an unnamed one's is a label made from where they sit), so it
	// tells whether somebody else moved into the row.
	if (!stamped && key.startsWith("named:") && roster.name && member.name !== roster.name) return null;
	return rosterMemberHp(flags, card, key, hpMax) === Math.min(hpMax, Math.max(0, Math.trunc(Number(roster.newHp) || 0))) ? key : null;
}

/**
 * The member a damage card's roster hit is on, where they sit now (rosterHitNow), for drawing the card's
 * "Took it" picker after rows have moved. Falls back to what the card recorded when they can't be found.
 *
 * @param {object} roster  what applyRosterHit recorded
 * @param {ReturnType<typeof rosterGroupFor>} group  the roster as it stands now, or null
 * @returns {{key: string, name: string}}
 */
export function rosterHitHolder(roster, group) {
	const recorded = { key: roster?.key, name: roster?.name ?? "" };
	if (!group?.character) return recorded;
	const card = { ftype: roster.ftype ?? group.ftype, slug: roster.slug ?? group.slug ?? "" };
	const hpMax = Math.max(1, Math.trunc(Number(roster.hpMax ?? group.hpMax) || 0));
	const key = rosterHitNow(readableFlags(group.character), card, roster, hpMax);
	if (!key) return recorded;
	return group.members.find(m => m.key === key) ?? { key, name: recorded.name };
}

/**
 * Give a blow a roster member took to another member still standing: the first gets back what it cost
 * them (never past their maximum), and `toKey` takes `damage` instead. Both are written in one update.
 *
 * @param {object} roster  what applyRosterHit recorded
 * @param {string} toKey   the member who takes it now
 * @param {number} damage  what the blow dealt, after armor
 * @param {{resolve?: Function, stonetopMove?: string}} [options]  `stonetopMove` as for applyRosterHit
 * @returns {Promise<null|{roster: object, down: boolean, after: number, from: {name: string, hp: number}}>}
 *   null when either member or the character cannot be found, or `toKey` is the member who took it
 */
export async function moveRosterHit(roster, toKey, damage, { resolve = globalThis.fromUuidSync, stonetopMove = "" } = {}) {
	// The member who took it is matched to `toKey` where they sit now (fromKey below): rows may have moved since.
	if (!roster?.characterUuid || !toKey) return null;
	let character = null;
	try { character = resolve?.(roster.characterUuid, { strict: false }) ?? null; } catch { character = null; }
	if (!character) return null;
	const card = { ftype: roster.ftype, slug: roster.slug ?? "" };
	const flags = readableFlags(character);
	const target = groupFollowerMembers(flags, card).find(m => m.key === toKey);
	if (!target) return null;
	const hpMax = Math.max(1, Math.trunc(Number(roster.hpMax) || 0));
	const taken = Math.max(0, Math.trunc(Number(roster.oldHp) || 0) - Math.trunc(Number(roster.newHp) || 0));
	// THE ROW MUST STILL BE THEIRS (round-2 audit FOE-2). Members are rows by index, and one struck off or named
	// since (the fate's Dead, a Remove) moves every row after them up: the old key would then name whoever moved
	// in, who would be "given back" HP they never lost while the one who took it kept the wound. So the member
	// is found where they sit now, still at the HP the blow left them on (rosterHitNow).
	const fromKey = rosterHitNow(flags, card, roster, hpMax);
	if (!fromKey) {
		globalThis.ui?.notifications?.warn?.(globalThis.game?.i18n?.format?.("stonetop.fight.groupHit.moveStale", { name: roster.name || "" }) ?? "");
		return null;
	}
	if (fromKey === toKey) return null;
	const wasHp = rosterMemberHp(flags, card, fromKey, hpMax);
	const fromHp = Math.min(hpMax, wasHp + taken);
	const oldHp = rosterMemberHp(flags, card, toKey, hpMax);
	const newHp = Math.max(0, oldHp - Math.max(0, Math.round(Number(damage) || 0)));
	// Standing afterwards, as the fight counts it: the first back up if the blow had dropped them, the
	// second down if it drops them now.
	const standing = groupFollowerStanding(flags, card)?.standing ?? 0;
	const down = newHp === 0 && oldHp > 0;
	const after = standing + (wasHp <= 0 && fromHp > 0 ? 1 : 0) - (down ? 1 : 0);
	// The member who takes it now, if it drops them, is asked their fate (ROSTER_FATE_OPTION).
	await writeRoster(character, rosterHpUpdate(flags, card, { [fromKey]: fromHp, [toKey]: newHp }),
		rosterWriteOptions({ ...card, key: toKey, name: target.name }, down, stonetopMove));
	return {
		roster: { ...roster, key: toKey, name: target.name, oldHp, newHp, stamp: memberStamp(flags, card, toKey) },
		down,
		after,
		from: { name: roster.name, hp: fromHp },
	};
}

/**
 * Land a lone blow on a group token: one member down (the size falls by one) or hurt (kept on the token).
 * Returns what happened, or null when the token is not a group of several.
 *
 * @param {Actor} targetActor
 * @param {number} damage  after armor
 */
export async function applyMemberHit(targetActor, damage) {
	const group = groupTokenInfo(targetActor);
	if (!group) return null;
	const hit = memberHit(group, damage);
	const update = {};
	if (hit.count !== group.count) update["system.count"] = hit.count;
	// A drained pool set back to full round the survivors (memberHit): the same bodies, one fewer than before.
	if (hit.pool !== undefined && hit.pool !== group.hp) update["system.attributes.hp.value"] = hit.pool;
	if (hit.wound !== group.wound) update[`flags.${SYSTEM_ID}.${GROUP_WOUND_FLAG}`] = hit.wound;
	// The first to go down: keep the size the group started at (GROUP_SIZE_FLAG).
	if (hit.down && groupStartSize(targetActor) < group.count) update[`flags.${SYSTEM_ID}.${GROUP_SIZE_FLAG}`] = group.count;
	if (Object.keys(update).length) await targetActor.update(update);
	const after = groupCasualties({ hpMax: group.hpMax, hpCurrent: hit.pool ?? group.hp, count: hit.count });
	return { ...hit, before: group.standing, after: after.standing, hpMax: group.hpMax };
}
