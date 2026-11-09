// When an arcanum's follower may manifest, and what else the table should know before it does.
// Framework-free (no Foundry globals), so the sheet's button, its handler and the tests read one rule.
//
// A4 (arcana audit 2026-11-04): every summon, shipped or homebrew, waits on the card's back being
// REALISED, identified and unlocked. Book I p.444 says an arcanum's followers are gained "by a PC who
// unlocks its mysteries"; the Mindgem's "When you've completed all the requirements, gain the Mighty
// Servant"; the Ring's "When you make the last mark ... The ring itself becomes a follower" (Book II
// p.560). The Demonhide Cloak's follower is one of its Consequences (p.545, "You begin to hear the
// voices of the dark creatures sewn into the Cloak. The Cloak becomes a follower"), so it also waits
// on that box being ticked.
//
// A16: the same card on two characters can summon the same named follower twice ("Only one dool spirit
// will serve you at a time"). That is flagged in gold, never blocked: the table may have a reason.

import { backBoxChecked } from "../utils/glyphs.js";
import { joinNames } from "../utils/strings.js";
import { summonEntryFor } from "./arcana-summons.js";

/**
 * Summons that wait on a ticked back box as well, by the printed words of that box (backBoxChecked
 * finds the □ at or before them), so an edit to the card's text cannot re-point it.
 */
export const SUMMON_BOX_GATES = Object.freeze({
	"demonhide-cloak": "You begin to hear the voices of the dark creatures sewn into the Cloak",
});

/**
 * Why a card's "Add as follower" may not manifest yet, or null when it may.
 *
 * @param {string} slug
 * @param {{identified?: boolean, unlocked?: boolean, backDescription?: string, boxStates?: object}} o
 *   `unlocked` as CharacterArcana reads it (its unlock latch included); `backDescription` the card's
 *   RAW back text (not the sheet's injected copy), read only for a card in SUMMON_BOX_GATES
 * @returns {null|"identify"|"unlock"|"box"}
 */
export function summonBlocker(slug, { identified = false, unlocked = false, backDescription = "", boxStates = {} } = {}) {
	if (!identified) return "identify";
	if (!unlocked) return "unlock";
	const label = SUMMON_BOX_GATES[slug];
	if (!label) return null;
	return backBoxChecked(backDescription, slug, label, boxStates ?? {}) ? null : "box";
}

/** Whether a card's follower may manifest now (summonBlocker found nothing in the way). */
export function summonRealised(slug, state) {
	return summonBlocker(slug, state) === null;
}

/**
 * summonBlocker for a character's card, read off the character (StonetopCharacter). `known` passes
 * what the caller already has (the sheet's snapshot flags, the resolved card) so it is not read again;
 * the raw back text is fetched only for a card in SUMMON_BOX_GATES.
 *
 * @param {object} character  StonetopCharacter
 * @param {string} slug
 * @param {{identified?: boolean, unlocked?: boolean, arcanum?: object}} [known]
 * @returns {Promise<null|"identify"|"unlock"|"box">}
 */
export async function characterSummonBlocker(character, slug, { identified, unlocked, arcanum } = {}) {
	const card = SUMMON_BOX_GATES[slug] ? (arcanum ?? await character.getArcanum(slug)) : null;
	return summonBlocker(slug, {
		identified:      identified ?? character.identifiedArcanaSlugs.has(slug),
		unlocked:        unlocked ?? await character.isArcanumUnlocked(slug),
		backDescription: card?.back?.description ?? "",
		boxStates:       character.arcanaBoxStates ?? {},
	});
}

/**
 * What the handler says when it refuses, in words a player can act on. `title` is the card's front
 * title; `names` the followers' names joined ("The Cloak").
 */
export function summonBlockedMessage(blocker, { slug = "", title = "", names = "" } = {}) {
	const card = title || "this arcanum";
	const who = names || "its follower";
	if (blocker === "identify") return `Identify ${card} first: ${who} comes only once you have unlocked its mysteries.`;
	if (slug === "ring-of-daagon" && blocker === "unlock") return "Make the last mark on the Ring of Daagon first: then the Ring becomes a follower.";
	if (blocker === "unlock") return `Unlock the mysteries of ${card} first: then ${who} becomes a follower.`;
	if (blocker === "box") return `${who} becomes a follower with the Consequence "${SUMMON_BOX_GATES[slug] ?? ""}": mark it on ${card} first.`;
	return "";
}

/**
 * Every other character's living followers, by `sourceUuid`, in one pass over the world, so a sheet
 * with several summon cards reads the actors once (summonHeldElsewhere's `holders`). One entry per
 * character and source; `seq` keeps the order the actors and their followers come in.
 *
 * @param {Iterable<{id: string, name: string, type?: string, getFlag?: Function}>} actors  every actor in the world
 * @param {string} selfId  this character's id, left out
 * @param {{scope: string}} o  the flag scope the followers live under
 * @returns {Map<string, {actorId: string, actorName: string, name: string, seq: number}[]>}
 */
export function summonHoldersBySource(actors, selfId, { scope } = {}) {
	const out = new Map();
	let seq = 0;
	for (const actor of actors ?? []) {
		if (!actor || actor.id === selfId || (actor.type && actor.type !== "character")) continue;
		const seen = new Set();
		for (const record of Object.values(actor.getFlag?.(scope, "customFollowers") ?? {})) {
			const uuid = record?.sourceUuid;
			if (!uuid || seen.has(uuid) || record.dead) continue;
			seen.add(uuid);
			if (!out.has(uuid)) out.set(uuid, []);
			out.get(uuid).push({ actorId: actor.id, actorName: actor.name ?? "", name: record.name, seq: seq++ });
		}
	}
	return out;
}

/**
 * Other characters who already have one of these followers on their Followers tab, matched by the
 * follower's stable `sourceUuid`. A repeatable follower (the Ring's Servants) is never matched: a fresh
 * batch each time is the rule. One entry per character and follower, in the order the actors come.
 *
 * @param {Iterable<object>} actors  every actor in the world (summonHoldersBySource)
 * @param {string} selfId  this character's id, left out
 * @param {Array<{name: string, sourceUuid?: string, repeatable?: boolean}>} followers  the card's summons
 * @param {{scope: string, holders?: Map}} o  the flag scope the followers live under; `holders` a
 *   summonHoldersBySource answer already in hand, read instead of the actors
 * @returns {{actorId: string, actorName: string, followerName: string}[]}
 */
export function summonHeldElsewhere(actors, selfId, followers = [], { scope, holders } = {}) {
	const wanted = new Map((followers ?? []).filter(f => f?.sourceUuid && !f.repeatable).map(f => [f.sourceUuid, f.name]));
	if (!wanted.size) return [];
	const bySource = holders ?? summonHoldersBySource(actors, selfId, { scope });
	return [...wanted]
		.flatMap(([uuid, name]) => (bySource.get(uuid) ?? []).map(h => ({ ...h, followerName: h.name || name })))
		.sort((a, b) => a.seq - b.seq)
		.map(({ actorId, actorName, followerName }) => ({ actorId, actorName, followerName }));
}

/** The gold caution line for summonHeldElsewhere's answer, or "" when nobody else has them. */
export function summonHeldElsewhereText(held = []) {
	if (!held?.length) return "";
	const list = joinNames(held.map(h => `${h.actorName} already has ${h.followerName}`));
	return `${list} as a follower. The same arcanum's creature serving two characters at once is the GM's call.`;
}

// ── Readiness a summon holds beyond the usual ────────────────────────────────────────────────
// The Bronze Protector "holds +1 Readiness on a 7+ to Defend" (metal-man, Book II p.533), and its card
// prints Readiness ○○○○. A summon row says so with `readinessBonus`; the follower record carries it once
// summoned (follower-build.js#buildCustomFollower), and a record summoned before it did is matched back
// to its row by `sourceUuid`.

/** The extra Readiness a follower holds on a 7+ Defend (and the cap it raises), 0 for most. */
export function followerReadinessBonus(record) {
	const own = Math.trunc(Number(record?.readinessBonus) || 0);
	if (own > 0) return own;
	return Math.max(0, Math.trunc(Number(summonEntryFor(record)?.readinessBonus) || 0));
}
