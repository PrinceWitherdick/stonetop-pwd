// What a roll's TIER does to the character who rolled it, kept in step with the card's tier after the dice.
//
// A handful of moves change the roller's own state by the tier they land on:
//  - We Happy Few's 6- shakes the Marshal's nerves (fight-states.js).
//  - Prepare a Welcome's 10+ regains 1 Surprise (combat/battle-holds.js).
//  - Commune with Aratis's 10+ holds 2 Sanction (roll-boosts.js).
//  - Wielder of the White Flame's 7+ lights the holy light; Luminous Shield's 6- snuffs it (holy-light.js).
//  - Defend holds Readiness by tier (combat/defend-readiness.js), and so does a follower ORDERED to Defend
//    (Book I p.469: "When a PC Orders Followers to Defend and gets a 7+, the follower holds Readiness"),
//    on the follower's own track, which the order's card names in its record (followerReadiness below).
//  - Alpha's 10+ has advantage on the next roll against the foes it was aimed at (fight/hero-moves.js).
//  - Omens of Fate's 7+ loses all Omens, and its 6- holds +1 (destined.js).
//
// The tier is not settled when the dice land: a GM's Shift Up/Down, a +1 pressed on the card (Diligence,
// Sanction, Many Hands, a Blessing), Burn Brightly, all move it. So each effect is SETTLED, not fired: told
// the tier and what it did for this card so far, it does or undoes whatever the difference is, and answers
// what it has done now. The answer rides on the card (message flag `tierEffects`), written after the roll
// and after each move of its total, which is what lets a lift undo only what THIS card did: nerves already
// shaken before the roll were not shaken by it, and a lift leaves them.
//
// ONE SEAM for every way the tier moves: stonetop.js calls reconcileTierEffects wherever a card's total is
// rewritten, on whichever client rewrote it (a GM's Shift, the card's own player, or the GM's client
// answering a relayed +1: roll-boosts.js#handleBoostQuery). A client that cannot write the character does
// nothing.

import { SYSTEM_ID } from "../../system-id.js";
import { cardCountedTier, outcomeTier } from "../../utils/counted-tier.js";
import { speakerActor } from "../../utils/speaker-actor.js";
import { shakeNervesOnMiss, setFightState, WE_HAPPY_FEW } from "./fight-states.js";
import { regainSurpriseOnHit, takeBackSurprise, PREPARE_A_WELCOME } from "../../combat/battle-holds.js";
import { holdSanctionOnHit, releaseSanction, sanctionTrack, COMMUNE_WITH_ARATIS } from "./roll-boosts.js";
import { LUMINOUS_SHIELD, WIELDER_OF_THE_WHITE_FLAME } from "./holy-light.js";
import { DEFEND_MOVE, defendReadinessHold, readinessForTier } from "../../combat/defend-readiness.js";
import { moveChatCard } from "../../utils/chat.js";
import { escHtml } from "../../utils/strings.js";
import { HERO_MOVES, foeKey, recordAlphaOver, forgetAlphaOver } from "../../fight/hero-moves.js";
import { OMENS_OF_FATE, settleOmensTier } from "./destined.js";
import { reconcileGivenAdvantage } from "./give-advantage-flow.js";

/** The message flag holding what a roll's tier effects have done, keyed as TIER_EFFECTS is. */
export const TIER_EFFECTS_FLAG = "tierEffects";

const count = value => Math.max(0, Math.trunc(Number(value) || 0));

/**
 * A follower ordered to Defend (wave 3 audit FOL-5): bring the follower's Readiness track to what `tier`
 * holds (1 on a 7-9, 3 on a 10+, none on a 6-; a shield's +1 stays the player's pip), given what this
 * card raised it to so far. `done` is `{path, prior, set, name}`: the track's flag path under the system
 * scope, what was held before the roll, and what this card's tier set. Readiness spent since stays spent
 * (readinessForTier). Resolves to the card's new record. `announce` posts a note when a moved card raises
 * the pool; the order's own roll posts its own.
 */
export async function settleFollowerReadiness(actor, tier, done, { announce = false, scope = SYSTEM_ID } = {}) {
	if (!actor || !done?.path) return done ?? undefined;
	const current = count(foundry.utils.getProperty(actor.flags?.[scope] ?? {}, done.path));
	const prior = count(done.prior);
	const { next, set } = readinessForTier({ prior, set: done.set ?? prior, current, hold: defendReadinessHold(tier) });
	if (next !== current) {
		await actor.update({ [`flags.${scope}.${done.path}`]: next }, { stonetopMove: DEFEND_MOVE });
		if (announce && next > current) {
			await globalThis.ChatMessage?.create?.({
				content: moveChatCard("Defend: Readiness held",
					`<p><strong>${escHtml(done.name || "Your follower")}</strong> holds <strong>${next}</strong> Readiness.</p>`),
				speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
			});
		}
	}
	return { ...done, prior, set };
}

/**
 * Each effect: the moves it belongs to, and `settle(actor, move, tier, done, character, {targets})`, which
 * brings the character to what `tier` asks given what this card has `done` so far (undefined at the roll
 * itself), and resolves to what the card has done now. `targets` are the foes the roll was aimed at, given
 * at the roll only: an effect that needs them later keeps them in its own record.
 */
const TIER_EFFECTS = {
	// true: this card shook the nerves.
	nerves: {
		moves: [WE_HAPPY_FEW],
		async settle(actor, move, tier, done) {
			const wants = tier === "failure";
			if (wants && !done) return shakeNervesOnMiss(actor, { name: move }, tier);
			if (!wants && done) { await setFightState(actor, "nerves", false); return false; }
			return !!done;
		},
	},
	// How many Surprise this card gave back (0 or 1).
	surpriseRegained: {
		moves: [PREPARE_A_WELCOME],
		async settle(actor, move, tier, done) {
			const wants = tier === "success";
			const n = count(done);
			if (wants && !n) return (await regainSurpriseOnHit(actor, { name: move }, tier)) ? 1 : 0;
			if (!wants && n) { await takeBackSurprise(actor, n); return 0; }
			return n;
		},
	},
	// How many Sanction this card filled.
	sanctionFilled: {
		moves: [COMMUNE_WITH_ARATIS],
		async settle(actor, move, tier, done) {
			const wants = tier === "success";
			const n = count(done);
			if (wants && !n) {
				const before = sanctionTrack(actor);
				return before && await holdSanctionOnHit(actor, { name: move }, tier) ? before.max - before.held : 0;
			}
			if (!wants && n) { await releaseSanction(actor, n); return 0; }
			return n;
		},
	},
	// The holy light: true when this card lit it (Wielder), or what it snuffed (Luminous Shield).
	holyLight: {
		moves: [WIELDER_OF_THE_WHITE_FLAME, LUMINOUS_SHIELD],
		settle: (_actor, move, tier, done, character) => character?.settleHolyLightTier?.(move, tier, done) ?? done ?? false,
	},
	// A follower's order to Defend: matched by its RECORD, not a move name, since the card is titled for the
	// follower ("Glaw: Defend"). Settled at the roll by the sheet (_maybeHoldReadinessOnDefend), and here
	// whenever the card's total moves.
	followerReadiness: {
		moves: [],
		recorded: true,
		settle: (actor, _move, tier, done) => settleFollowerReadiness(actor, tier, done, { announce: true }),
	},
	// `{prior, set}`: the Readiness held before the roll, and what this card's tier raised it to.
	readiness: {
		moves: [DEFEND_MOVE],
		settle: (_actor, _move, tier, done, character) => character?.settleDefendReadinessTier?.(tier, done) ?? done ?? null,
	},
	// `{foes, set}`: the foes the Alpha was aimed at (`{key, name}`), and whether this card's 10+ has them
	// remembered. Aimed at nobody, nothing: there is no "them" to have advantage against.
	alphaOver: {
		moves: [HERO_MOVES.ALPHA],
		async settle(actor, _move, tier, done, _character, { targets = [] } = {}) {
			const foes = done?.foes ?? (targets ?? []).map(t => ({ key: foeKey(t), name: t?.name ?? "" })).filter(f => f.key);
			if (!foes.length) return undefined;
			const wants = tier === "success";
			if (wants && !done?.set) return { foes, set: await recordAlphaOver(actor, foes) };
			if (!wants && done?.set) { await forgetAlphaOver(actor, foes.map(f => f.key)); return { foes, set: false }; }
			return { foes, set: !!done?.set };
		},
	},
	// `{prior, set}`: the Omens held before the roll, and what this card's tier asked for (none on a 7+, one
	// more on a 6-). Nothing for a character who is not Destined.
	omens: {
		moves: [OMENS_OF_FATE],
		settle: (actor, _move, tier, done, character) => settleOmensTier(actor, tier, done ?? null, character ?? actor?.typedActor),
	},
};

/** The moves whose tier does something to the roller. */
export const TIER_EFFECT_MOVES = Object.freeze([...new Set(Object.values(TIER_EFFECTS).flatMap(e => e.moves))]);

/**
 * Bring the roller to what `tier` asks of `move`, given what the card has `done` so far (null at the roll).
 * Resolves to the card's new record: `{}` for a move with no tier effects.
 *
 * @param {Actor} actor
 * @param {string} move  the move's name, as its card's `move` flag has it
 * @param {"success"|"partial"|"failure"} tier
 * @param {object|null} [done]  the card's `tierEffects` flag
 * @param {object} [options]
 * @param {StonetopCharacter} [options.character]  the actor's character model (default `actor.typedActor`)
 * @param {object[]} [options.targets]  the foes the roll was aimed at (at the roll itself; Alpha keeps them)
 * @returns {Promise<object>}
 */
export async function settleTierEffects(actor, move, tier, done = null, { character = actor?.typedActor, targets = [] } = {}) {
	const record = {};
	for (const [key, effect] of Object.entries(TIER_EFFECTS)) {
		if (!effect.moves.includes(move) && !(effect.recorded && done?.[key] != null)) continue;
		const now = await effect.settle(actor, move, tier, done?.[key], character, { targets });
		// An effect with nothing to keep (an Alpha aimed at nobody) leaves no trace on the card.
		if (now !== undefined) record[key] = now;
	}
	return record;
}

/** Write a record on its card, when there is anything to write. Whether it wrote. */
export async function recordTierEffects(message, record, { scope = SYSTEM_ID } = {}) {
	if (!message?.setFlag || !record || !Object.keys(record).length) return false;
	try {
		await message.setFlag(scope, TIER_EFFECTS_FLAG, record);
		return true;
	} catch (err) {
		console.warn("Stonetop | could not note a roll's tier effects on its card", err);
		return false;
	}
}

/**
 * A roll card's total has moved (a Shift, a +1, Burn Brightly): bring its roller to the new tier's
 * effects, undoing only what this card did. A card without the flag was rolled before this was kept (or by
 * a move with no tier effects) and is left alone. Whether anything was written.
 *
 * @param {ChatMessage} message
 * @param {number} total  the card's new total
 * @param {object} [options]
 * @param {Actor|null} [options.actor]  the roller (default: the card's speaker)
 */
export async function reconcileTierEffects(message, total, { actor = undefined, scope = SYSTEM_ID } = {}) {
	// A held advantage the card's tier gave someone (Everything Burns' 10+): taken back once the card is moved
	// off that tier. Kept on the card apart from `tierEffects`, since it is pressed after the roll and may go
	// to another character than the roller (give-advantage-flow.js#reconcileGivenAdvantage).
	try {
		await reconcileGivenAdvantage(message, total, { scope });
	} catch (err) {
		console.error("Stonetop | taking back the advantage a moved roll card gave failed", err);
	}
	const done = message?.getFlag?.(scope, TIER_EFFECTS_FLAG);
	if (!done || typeof done !== "object" || !Number.isFinite(Number(total))) return false;
	const roller = actor === undefined ? speakerActor(message) : actor;
	if (roller?.type !== "character") return false;
	if (roller.isOwner === false) {
		console.warn(`Stonetop | this client cannot write ${roller.name}, so the tier effects of their shifted roll were not brought up to date`);
		return false;
	}
	const move = message.getFlag(scope, "move");
	// The tier the card COUNTS as: a roll that treats a 7-9 as a 10+ (or a 6- as a 7-9) lifted within the
	// bent tier has not moved, and one lifted into it settles as what it counts as (utils/counted-tier.js).
	const tier = outcomeTier(cardCountedTier(message, Number(total), scope));
	try {
		const next = await settleTierEffects(roller, move, tier, done);
		if (!Object.keys(next).length || JSON.stringify(next) === JSON.stringify(done)) return false;
		return recordTierEffects(message, next, { scope });
	} catch (err) {
		console.error("Stonetop | bringing a shifted roll's tier effects up to date failed", err);
		return false;
	}
}
