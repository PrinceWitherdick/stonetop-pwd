// A crew member (or a custom group's member) a lone blow drops in a fight gets the fate dialog (Book I
// p.469), as one dropped from the sheet's own HP box does.
//
// The blow is written by whoever applies the damage card, which is the GM's client whenever a player's
// press is relayed (combat/attack-flow.js#handleApplyQuery), and the fate is the Marshal's player's to
// answer. So the roster write carries the fate as an update option (fight/group-hits.js
// #ROSTER_FATE_OPTION; Foundry hands update options to every client with the update), and the one
// client that answers for the Marshal opens it: their player, else any player who owns them, else the
// GM (hooks/DeathsDoorPrompt.js#answersFor), the same rungs the dying walkthrough climbs.
//
// Not twice: the sheet's HP box opens the dialog itself and writes without the option, and only the
// answering client acts on it.

import { ROSTER_FATE_OPTION } from "./group-hits.js";
import { answersFor } from "../hooks/DeathsDoorPrompt.js";
import { followerCardFor } from "../actors/character/follower-masters.js";
import { SINGLE_HP_ROWS, followerFateHpPath, followerReviveUpdate, wasStanding } from "../actors/character/follower-fate.js";
import { readableFlags } from "../actors/character/StonetopFlags.js";
import { FOLLOWER_NPC_HP_QUERY, handleFollowerNpcHpQuery } from "../actors/character/follower-hp.js";
import { BEAST_CATALOG } from "../data/beasts.js";
import { SYSTEM_ID } from "../system-id.js";
import { writtenHp } from "./out-of-the-fight.js";

/**
 * `updateActor`: open the fate dialog a roster write asked for, on the client that answers for the
 * character. Returns whether this client opened it.
 *
 * @param {Actor} actor
 * @param {object} _changes
 * @param {object} [options]  the update's options; `options[ROSTER_FATE_OPTION]` is the fate to ask
 * @param {string} [_userId]
 * @param {{answers?: Function}} [deps]  for the tests
 * @returns {boolean}
 */
export function onUpdateActorRosterFate(actor, _changes, options = {}, _userId = null, { answers = answersFor } = {}) {
	const fate = options?.[ROSTER_FATE_OPTION];
	if (!fate || actor?.type !== "character") return false;
	try {
		if (!answers(actor)) return false;
		const sheet = actor.sheet;
		if (typeof sheet?._openFollowerFate !== "function") return false;
		sheet._openFollowerFate(fate);
		return true;
	} catch (err) {
		console.error("Stonetop | Could not open the roster member's fate:", err);
		return false;
	}
}

// ── A ONE-BODY FOLLOWER'S NPC: ITS HIT POINTS ARE THEIRS ─────────────────────────────────────────────
// (wave 3 audit FOL-1, the user's ruling of 2026-10-09.) While a follower who is one person has an NPC
// (an actor made for the card, or the NPC they were recruited from), the NPC's HP is the follower's and
// the card's box MIRRORS it, whatever wrote it: a blow applied on the map, a GM's hand on the token, a heal.
// And a drop from above 0 to 0 is "a follower ... reduced to 0 HP" (Book I p.469): the fate dialog opens,
// with Loyal to the End for the animal companion (p.143), exactly once, on the client that answers for the
// character (the player, else an owner, else the GM). "Before" is the card's own box, which this keeps in
// step: a write that leaves the box at 0 already is not a fresh drop, so nothing asks twice. Every writer of
// a follower's HP writes the NPC when there is one (actors/character/follower-hp.js#setFollowerHp, the
// sheet's HP box among them) and lets this mirror it, so the box's own fate path never fires for such a
// follower.

/** Whether a card's follower meets their fate at 0 HP: not livestock (a beast the rules call no follower). */
function takesFate({ ftype, slug }) {
	return ftype !== "beast" || !!BEAST_CATALOG[slug]?.follower;
}

/**
 * What an NPC's HP write means for the follower card it stands for: the character, the update that
 * mirrors the value into the card's box (with the revive a value above 0 makes), and the fate to ask when
 * it is a drop to 0 from standing. Null for anything else: not an HP write, not a follower's NPC, a group.
 * PURE but for the card lookup.
 *
 * @returns {null|{character: Actor, update: object, fate: object|null}}
 */
export function followerHpMirror(actor, changes, { cardFor = followerCardFor } = {}) {
	// The HP the diff wrote (out-of-the-fight.js#writtenHp), as a card's box holds it: a whole number, never below 0.
	const written = writtenHp(changes);
	if (written == null || actor?.type !== "npc") return null;
	const value = Math.max(0, Math.trunc(written));
	const card = cardFor(actor);
	if (!card?.character || !SINGLE_HP_ROWS.has(card.ftype)) return null;
	const flags = readableFlags(card.character);
	if (card.ftype === "custom" && flags?.customFollowers?.[card.slug]?.isGroup) return null;
	const path = followerFateHpPath(card.ftype, card.slug ?? "");
	if (!path) return null;
	const before = foundry.utils.getProperty(flags ?? {}, path);
	const update = {};
	if (before == null || before === "" || Number(before) !== value) update[`flags.${SYSTEM_ID}.${path}`] = value;
	Object.assign(update, followerReviveUpdate(card.ftype, card.slug ?? "", value, flags) ?? {});
	const fate = value === 0 && wasStanding(before) && takesFate(card)
		? { follower: card.ftype, slug: card.slug ?? "", index: null, name: String(actor.name ?? "") }
		: null;
	return { character: card.character, update, fate };
}

/**
 * `updateActor`: mirror a one-body follower's NPC HP onto their card and, on a drop to 0, open the fate
 * dialog, on the client that answers for the character. Returns whether this client acted.
 */
export async function onUpdateActorFollowerHp(actor, changes, options = {}, _userId = null, { answers = answersFor, cardFor = followerCardFor } = {}) {
	try {
		const plan = followerHpMirror(actor, changes, { cardFor });
		if (!plan || !answers(plan.character)) return false;
		if (Object.keys(plan.update).length) {
			await plan.character.update(plan.update, options?.stonetopMove ? { stonetopMove: options.stonetopMove } : {});
		}
		if (plan.fate && typeof plan.character.sheet?._openFollowerFate === "function") plan.character.sheet._openFollowerFate(plan.fate);
		return true;
	} catch (err) {
		console.error("Stonetop | Could not mirror the follower's HP onto their card:", err);
		return false;
	}
}

/** Registered once, at module scope in stonetop.js. */
export function registerRosterFateHooks() {
	Hooks.on("updateActor", onUpdateActorRosterFate);
	Hooks.on("updateActor", onUpdateActorFollowerHp);
	// The GM's half of setting the HP of a follower's NPC the writing player cannot write (follower-hp.js).
	Hooks.once("init", () => {
		if (CONFIG.queries) CONFIG.queries[FOLLOWER_NPC_HP_QUERY] = (data, context) => handleFollowerNpcHpQuery(data, context);
	});
}
