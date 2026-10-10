// A follower at 0 HP: who gets the fate dialog, what each row is called in it, and what
// "Dead" and SIR, PERMISSION TO DIE, SIR do to the character's flags. Pure but for the one card
// poster at the bottom, so the sheet's handler (StonetopCharacterSheet#_openFollowerFate /
// #_resolveFollowerFate) stays a thin caller.
//
// THE CREW'S MEMBERS COUNT (user's ruling, Marshal audit 2026-09-26). Book I p.469 is written for
// every follower ("When a follower is reduced to 0 HP, their fate is in your hands"), and a crew
// member is one: the roster tracks each of them against their own HP (p.470/472). So a named
// individual or an anonymous member crossing to 0 gets the same dialog a custom follower does.
//
// WHAT "DEAD" MEANS FOR A ROSTER ROW. The member is struck off the crew, the way Rhianna "erases
// Eira from her Crew insert" when Eira leaves it (p.481): a named individual leaves
// `crew.individuals` (their index-keyed HP re-keyed behind them), an anonymous member leaves
// `crew.memberHp` and the parallel
// `crew.memberPortrait`, and `crew.size` drops by one either way. At 0 HP the member had already
// stopped counting as standing (utils/crew.js#groupFollowerStanding, which is what the fight's
// `bodiesFor` roster path reads), so the standing count is unchanged by the removal; what changes
// is that nobody can heal a dead member back onto their feet, and the headcount says "5 of 5"
// rather than "5 of 6". It is the same write as the Roster's own Remove button, minus the confirm:
// clicking "Dead" in the fate dialog IS the choice.
//
// A CUSTOM GROUP'S MEMBERS COUNT THE SAME WAY. A custom follower flagged `isGroup` (a hired warband,
// an arcana summon, a converted group monster) keeps a roster just like the crew's anonymous tail:
// `customFollowers.<id>.memberHp` and the parallel `memberPortrait`, headcount `size`. A member
// crossing to 0 gets the dialog, named by their roster row (utils/crew.js#customGroupMemberLabel),
// spends the GROUP's own Loyalty track (`customFollowers.<id>.loyalty`), and Dead cuts them out of
// both arrays and drops `size` by one (customMemberDeathUpdate). Except at two: a group of one is a
// single follower, a different card (utils/crew.js#customGroupSize floors at 2), so the last two keep
// their slots and the dead one stays on the roster at 0 HP, which the card says. At 0 HP they would
// read as merely down, and a heal could raise the dead, so they are MARKED fallen as a custom follower
// is (`customFollowers.<id>.memberDead`, parallel to memberHp, utils/crew.js#customMemberFallen): the
// roster row greys with a "Fallen" badge, nothing counts them standing, the Bath cannot pick them, and
// setting their HP box above 0 by hand clears it (followerReviveUpdate).
//
// SIR, PERMISSION TO DIE, SIR (Marshal): "When one of your followers would die, you can spend 1 of
// their Loyalty to have them survive (out of the action, but alive). If you let them go, mark XP."
// Offered only while the move is LEARNED (owns-move.js#ownsLearnedMoveNamed) and, for the spend,
// only while the follower holds Loyalty (the crew's is one shared track). "Out of the action" needs
// no mark of its own: the follower stays at 0 HP, and 0 HP is already out for the fight
// (fight-sides.js#bodiesFor, the roster's standing count). Letting them go is a clause the sheet
// cannot check, so it is a pre-ticked box beside "Dead" that marks the XP when that is chosen.

import {
	effectiveCrewSize, crewIndividualLabel, crewAnonMemberLabel, customGroupSize, customGroupMemberLabel, customMemberFallen,
} from "../../utils/crew.js";
import { deletionEntry } from "../../utils/foundry-compat.js";
import { markXpReceipt } from "../../utils/roll-engine.js";
import { SYSTEM_ID } from "../../system-id.js";
import { ownsLearnedMoveNamed } from "./owns-move.js";
import { followerDetailBase } from "./follower-masters.js";
import { STONETOP_SCOPE } from "./StonetopFlags.js";

export const SIR_PERMISSION_TO_DIE = "Sir, Permission to Die, Sir";

/** The HP rows whose crossing to 0 opens the fate dialog. Not livestock, not a group's pooled HP. */
export const FOLLOWER_FATE_TYPES = new Set([
	"animal-companion", "initiate", "beast", "custom", "crew-individual", "crew-member", "custom-member",
]);

/** A crew roster row (named individual or anonymous member)? */
export function isCrewMemberRow(follower) {
	return follower === "crew-individual" || follower === "crew-member";
}

/** A custom GROUP follower's roster row? */
export function isCustomMemberRow(follower) {
	return follower === "custom-member";
}

/**
 * The flag path (under the system scope) that holds this row's current HP, or null: every HP input the
 * Followers tab draws, a group's pooled box (`crew-group`, `custom-group`) among them.
 */
export function followerFateHpPath(follower, slug, index) {
	switch (follower) {
		case "animal-companion": return "animalCompanion.hpCurrent";
		case "initiate":         return `initiatesHp.${slug}`;
		case "beast":            return `beastHp.${slug}`;
		case "custom":           return `customFollowers.${slug}.hpCurrent`;
		case "crew-individual":  return `crew.individualsHp.${Number(index)}`;
		case "crew-member":      return `crew.memberHp.${Number(index)}`;
		case "custom-member":    return `customFollowers.${slug}.memberHp.${Number(index)}`;
		case "crew-group":       return "crew.groupHp";
		case "custom-group":     return `customFollowers.${slug}.groupHp`;
		default:                 return null;
	}
}

/** The rows whose HP store is an ARRAY, written whole; every other row's is an index- or slug-keyed map. */
export const ARRAY_HP_ROWS = new Set(["crew-member", "custom-member"]);

/**
 * The actor update that sets one row's HP box to `value`: a slug- or index-keyed box by its dotted path,
 * an array row's whole array with that slot changed, plus the revive a value above 0 makes
 * (followerReviveUpdate). Empty for a row with no box. PURE. `flags` is the character's resolved flags.
 * The box half of follower-hp.js#setFollowerHp, which every live write goes through; a caller batching
 * several rows into one write of its own (Make Camp) builds them with this.
 */
export function followerHpWriteUpdate(flags, follower, slug, index, value) {
	const path = followerFateHpPath(follower, slug, index);
	if (!path) return {};
	const update = {};
	if (ARRAY_HP_ROWS.has(follower)) {
		const store = path.slice(0, path.lastIndexOf("."));
		const stored = foundry.utils.getProperty(flags ?? {}, store);
		const list = Array.from(Array.isArray(stored) ? stored : [], v => v ?? null);
		list[Number(index)] = value;
		update[`flags.${SYSTEM_ID}.${store}`] = Array.from(list, v => v ?? null);
	} else {
		update[`flags.${SYSTEM_ID}.${path}`] = value;
	}
	return { ...update, ...(followerReviveUpdate(follower, slug, value, flags, index) ?? {}) };
}

/** The follower kinds that are ONE body with one HP box, and so can have an NPC of their own on the map. */
export const SINGLE_HP_ROWS = new Set(["animal-companion", "initiate", "beast", "custom"]);

/**
 * The NPC that stands for a one-body follower (an actor made for the card, or the NPC they were recruited
 * from), or null: a group, a roster row, or a card with no NPC. While there is one, ITS hit points are the
 * follower's and the card's box mirrors them (wave 3 audit FOL-1, the user's ruling of 2026-10-09;
 * fight/roster-fate.js#onUpdateActorFollowerHp; follower-hp.js#setFollowerHp writes it). `link` is
 * follower-actors.js#followerActorFromLink.
 */
export function linkedFollowerNpc(flags, follower, slug, link) {
	if (!SINGLE_HP_ROWS.has(follower) || typeof link !== "function") return null;
	const base = followerDetailBase(follower, slug);
	const details = base ? foundry.utils.getProperty(flags ?? {}, base) : null;
	if (!details || (follower === "custom" && details.isGroup)) return null;
	return link({ actorUuid: details.actorUuid, sourceUuid: details.sourceUuid }) ?? null;
}

/**
 * The HP row a roster member sits on, `{follower, index}` in this file's row types, or null: the one
 * translation between a roster's member keys (utils/crew.js#groupFollowerMembers: `named:i` and `anon:i`
 * on the crew, `member:i` on a custom group) and the rows the Followers tab draws.
 *
 * @param {string} ftype  the card's type, "crew" or "custom"
 * @param {string} key
 */
export function rosterMemberRow(ftype, key) {
	const [kind, at] = String(key ?? "").split(":");
	const index = Math.trunc(Number(at));
	if (at == null || at === "" || !Number.isInteger(index) || index < 0) return null;
	const follower = ftype === "crew" ? { named: "crew-individual", anon: "crew-member" }[kind]
		: ftype === "custom" ? { member: "custom-member" }[kind]
		: undefined;
	return follower ? { follower, index } : null;
}

/**
 * The follower TYPE whose Loyalty a row spends: a crew member spends the crew's shared track, a
 * custom group's member their group's (the "custom" track under the same slug).
 */
export function followerFateLoyaltyType(follower) {
	if (isCrewMemberRow(follower)) return "crew";
	return isCustomMemberRow(follower) ? "custom" : follower;
}

/**
 * Was this row standing before the write? Nothing stored is full HP (the sheet's `_clampHp`), so
 * only an explicit 0 means they were already down.
 */
export function wasStanding(raw) {
	return raw == null || raw === "" || Number(raw) !== 0;
}

/**
 * What raising a follower's HP above 0 clears: a custom follower marked "Dead" by the fate dialog
 * comes back as a normal card, the mirror of that outcome, and so does a custom group's member marked
 * fallen (`index` names their roster row). The update to merge, or null. Shared by the HP box's change
 * handler and anything else that raises a card's HP (Bath of Healing Light, invocation-apply.js), so a
 * revive is one rule. `flags` is the character's resolved flags.
 */
export function followerReviveUpdate(follower, slug, val, flags, index = null) {
	if (!slug || !(Number(val) > 0)) return null;
	if (follower === "custom") {
		return flags?.customFollowers?.[slug]?.dead ? { [`flags.${SYSTEM_ID}.customFollowers.${slug}.dead`]: false } : null;
	}
	// A custom group's member marked fallen at the group's floor (customMemberDeathUpdate): their slot
	// in the parallel `memberDead` array cleared, the array written whole as memberHp is.
	if (follower === "custom-member") {
		const record = flags?.customFollowers?.[slug];
		const i = Number(index);
		if (!Number.isInteger(i) || i < 0 || !customMemberFallen(record, i)) return null;
		const marks = Array.from(record.memberDead, v => v ?? null);
		marks[i] = null;
		return { [`flags.${SYSTEM_ID}.customFollowers.${slug}.memberDead`]: marks };
	}
	return null;
}

/** What a crew roster row is called, as the Roster draws it. */
export function crewMemberFateName(crew, follower, index) {
	const named = Array.isArray(crew?.individuals) ? crew.individuals : [];
	const i = Number(index);
	if (follower === "crew-individual") return String(named[i]?.name ?? "").trim() || crewIndividualLabel(i);
	if (follower === "crew-member") return crewAnonMemberLabel(named.length, i);
	return "";
}

/** What a custom group's roster row is called, as the Roster draws it ("Member 2"). */
export function customMemberFateName(index) {
	return customGroupMemberLabel(Number(index));
}

/**
 * What SIR, PERMISSION TO DIE, SIR offers for this follower right now.
 *
 * @returns {{canSpare: boolean, letGo: boolean}}
 *   `canSpare`: the spend button (learned and Loyalty held); `letGo`: the "mark XP" box beside Dead.
 */
export function sirPermissionOffer(actor, loyalty) {
	const learned = ownsLearnedMoveNamed(actor, SIR_PERMISSION_TO_DIE);
	return { canSpare: learned && Math.max(0, Number(loyalty) || 0) > 0, letGo: learned };
}

/**
 * The actor update that takes named crew member `index` off the roster, whatever their HP: the Roster's
 * Remove button, and the fate dialog's "Dead" (crewMemberDeathUpdate). Null for an index not there.
 *
 * `individualsHp` is an index-keyed MAP beside the array, so it is re-keyed to follow the splice, and the
 * keys the shift leaves behind are deleted (a merge would keep them). `size` drops by one, so the freed
 * slot does not come back as a fresh full-HP anonymous member.
 *
 * @param {object} crew  the character's `crew` flag object
 * @param {number} index
 * @returns {object|null}  dotted `flags.<scope>.crew.*` paths
 */
export function crewIndividualRemovalUpdate(crew, index) {
	const idx = Number(index);
	const individuals = Array.isArray(crew?.individuals) ? [...crew.individuals] : [];
	if (!Number.isInteger(idx) || idx < 0 || idx >= individuals.length) return null;
	const base = `flags.${STONETOP_SCOPE}.crew`;
	const sizeBefore = effectiveCrewSize(crew?.size, individuals.length);
	individuals.splice(idx, 1);
	const oldHp = crew?.individualsHp ?? {};
	const newHp = {};
	for (const [k, v] of Object.entries(oldHp)) {
		const i = Number(k);
		if (i < idx) newHp[i] = v;
		else if (i > idx) newHp[i - 1] = v;
	}
	const update = { [`${base}.individuals`]: individuals };
	for (const k of Object.keys(oldHp)) {
		if (k in newHp) continue;
		const [key, value] = deletionEntry(`${base}.individualsHp.${k}`);
		update[key] = value;
	}
	for (const [k, v] of Object.entries(newHp)) update[`${base}.individualsHp.${k}`] = v;
	update[`${base}.size`] = Math.max(individuals.length, sizeBefore - 1);
	return update;
}

/**
 * The actor update that strikes a dead crew member off the roster, or null when the row named is
 * not there or is not down (healed, or the roster shifted, since the dialog opened: a stale index
 * must never erase somebody else).
 *
 * @param {object} crew      the character's `crew` flag object
 * @param {string} follower  "crew-individual" | "crew-member"
 * @param {number} index     the row's index, as its HP input carries it
 * @returns {object|null}    dotted `flags.<scope>.crew.*` paths
 */
export function crewMemberDeathUpdate(crew, follower, index) {
	const idx = Number(index);
	if (!Number.isInteger(idx) || idx < 0) return null;
	const base = `flags.${STONETOP_SCOPE}.crew`;
	const individuals = Array.isArray(crew?.individuals) ? [...crew.individuals] : [];
	const sizeBefore = effectiveCrewSize(crew?.size, individuals.length);

	if (follower === "crew-individual") {
		if (idx >= individuals.length || wasStanding(crew?.individualsHp?.[idx])) return null;
		return crewIndividualRemovalUpdate(crew, idx);
	}

	if (follower === "crew-member") {
		const anonCount = Math.max(0, sizeBefore - individuals.length);
		if (idx >= anonCount) return null;
		const memberHp = Array.isArray(crew?.memberHp) ? [...crew.memberHp] : [];
		if (wasStanding(memberHp[idx])) return null;
		memberHp.splice(idx, 1);
		const update = {
			[`${base}.memberHp`]: memberHp,
			[`${base}.size`]:     Math.max(individuals.length, sizeBefore - 1),
		};
		// Their face is an array slot parallel to memberHp, so it goes by the same cut.
		const portraits = crew?.memberPortrait;
		if (Array.isArray(portraits) && idx < portraits.length) {
			const next = [...portraits];
			next.splice(idx, 1);
			update[`${base}.memberPortrait`] = next;
		}
		return update;
	}
	return null;
}

/**
 * The actor update that strikes a dead member off a custom GROUP follower's roster: their slot cut out
 * of `memberHp` and the parallel `memberPortrait`, `size` down by one, as crewMemberDeathUpdate does for
 * the crew's anonymous tail. Null when the row is not there or is not down (the same stale-index guard).
 * When the group is down to two, the floor a group keeps (utils/crew.js#customGroupSize), the member
 * stays on the roster at 0 HP, MARKED fallen: the update writes only their slot of `memberDead` (the
 * whole array, true for the fallen), and customMemberStruckOff tells the two apart.
 *
 * @param {object} record  the group's `customFollowers.<id>` flag object
 * @param {string} slug    that id
 * @param {number} index   the row's index, as its HP input carries it
 * @returns {object|null}  dotted `flags.<scope>.customFollowers.<id>.*` paths
 */
export function customMemberDeathUpdate(record, slug, index) {
	const idx = Number(index);
	if (!record?.isGroup || !slug || !Number.isInteger(idx) || idx < 0) return null;
	const sizeBefore = customGroupSize(record);
	if (idx >= sizeBefore) return null;
	const memberHp = Array.isArray(record.memberHp) ? [...record.memberHp] : [];
	if (wasStanding(memberHp[idx])) return null;
	const base = `flags.${STONETOP_SCOPE}.customFollowers.${slug}`;
	const marks = Array.isArray(record.memberDead) ? Array.from(record.memberDead, v => v ?? null) : [];
	if (sizeBefore <= customGroupSize({ size: 0 })) {
		while (marks.length < idx) marks.push(null);
		marks[idx] = true;
		return { [`${base}.memberDead`]: marks };
	}
	memberHp.splice(idx, 1);
	const update = {
		[`${base}.memberHp`]: memberHp,
		[`${base}.size`]:     sizeBefore - 1,
	};
	const portraits = record.memberPortrait;
	if (Array.isArray(portraits) && idx < portraits.length) {
		const next = [...portraits];
		next.splice(idx, 1);
		update[`${base}.memberPortrait`] = next;
	}
	// Anyone already marked fallen keeps the mark on their own row, which moves up with the cut.
	if (idx < marks.length) {
		marks.splice(idx, 1);
		update[`${base}.memberDead`] = marks;
	}
	return update;
}

/** Whether a customMemberDeathUpdate strikes the member off the roster (rather than marking them fallen at the floor). */
export function customMemberStruckOff(update, slug) {
	return !!update && `flags.${STONETOP_SCOPE}.customFollowers.${slug}.size` in update;
}

/**
 * "If you let them go, mark XP": the follower's death card and the XP receipt as ONE card, the
 * way an agreed Persuade is (pc-asks/pc-ask-flow.js). markXpReceipt writes the XP through the
 * serialised adjustXp, attributes it to the move in the ledger, and gives the card its Undo.
 *
 * @param {Actor}  actor  the Marshal
 * @param {string} body   the death card's own HTML
 */
export async function postLetGoReceipt(actor, body) {
	const receipt = await markXpReceipt(actor, {
		header:      SIR_PERMISSION_TO_DIE,
		move:        SIR_PERMISSION_TO_DIE,
		description: body + `<p>${game.i18n.localize("stonetop.character.followers.fate.letGoCard")}</p>`,
		amount:      1,
	});
	return ChatMessage.create({
		content: receipt.content,
		speaker: ChatMessage.getSpeaker({ actor }),
		flags:   { [SYSTEM_ID]: receipt.flags },
	});
}
