// What a roll's TIER does to the character who rolled it, kept in step with the card's tier after the dice.
//
// A handful of moves change the roller's own state by the tier they land on:
//  - We Happy Few's 6- shakes the Marshal's nerves (fight-states.js).
//  - Prepare a Welcome's 10+ regains 1 Surprise (combat/battle-holds.js).
//  - Commune with Aratis's 10+ holds 2 Sanction (roll-boosts.js).
//  - Silver Tongued's 10+ holds 3 Nerve and its 7-9 holds 1, as any move whose data says what a roll holds
//    (heldOnRoll below).
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
import { fillSanctionOnHit, releaseSanction, COMMUNE_WITH_ARATIS } from "./roll-boosts.js";
import { inSpenderTurn } from "../../utils/spender-queue.js";
import { LUMINOUS_SHIELD, WIELDER_OF_THE_WHITE_FLAME } from "./holy-light.js";
import { DEFEND_MOVE, defendReadinessHold, readinessForTier } from "../../combat/defend-readiness.js";
import { moveChatCard } from "../../utils/chat.js";
import { escHtml } from "../../utils/strings.js";
import { HERO_MOVES, alphaKeysHeld, foeKey, recordAlphaOver, forgetAlphaOver } from "../../fight/hero-moves.js";
import { OMENS_OF_FATE, settleOmensTier } from "./destined.js";
import { reconcileGivenAdvantage } from "./give-advantage-flow.js";
import { learnedTrack, takeBackHeld } from "./MoveResources.js";
import { ownedLearnedMove, bookMoveName } from "./owns-move.js";
import { homebrewInsertOf, homebrewMoveSlug, homebrewPlaybookInserts } from "../../playbooks/playbook-catalog.js";

/** The message flag holding what a roll's tier effects have done, keyed as TIER_EFFECTS is. */
export const TIER_EFFECTS_FLAG = "tierEffects";

/** The Fox's Silver Tongued, whose roll holds Nerve on its own track. */
export const SILVER_TONGUED = "Silver Tongued";

/**
 * What a roll holds for a BOOK move whose pack entry says so (`system.resource.holdOnRoll`), for a copy a
 * character took before the pack carried it: the held copy is what holdOnRollFor reads, and one taken
 * earlier has the track without the numbers until the move refresh brings it up to the pack.
 */
const BOOK_HOLD_ON_ROLL = Object.freeze({
	// "On a 10+, hold 3 Nerve; on a 7-9, hold 1 Nerve." Nothing on a 6-.
	[SILVER_TONGUED]: Object.freeze({ success: 3, partial: 1 }),
});

const count = value => Math.max(0, Math.trunc(Number(value) || 0));

/**
 * A move whose roll holds on its own track (Silver Tongued: "When you use words to avoid suspicion or
 * trouble, roll +CHA: on a 10+, hold 3 Nerve; on a 7-9, hold 1 Nerve"). Read as "you now hold 3" (or 1):
 * the LEARNED copy's track (MoveResources.js#learnedTrack, which counts what is held) is raised to what
 * `holds[tier]` holds, never lowered by the roll and never past its max. `added` is how many pips this card
 * has put there so far (0 at the roll). What the track would hold without this card is what it holds now
 * less those, so a hold spent since stays spent and one held before the roll is never taken back, as
 * Defend's Readiness is settled (defend-readiness.js#readinessForTier). Resolves to how many this card has
 * added now; undefined for a character without the move learned, so their card carries no record.
 */
async function settleHeld(actor, move, holds, tier, added, bonus = 0) {
	if (!learnedTrack(actor, move)) return added === undefined ? undefined : count(added);
	const done = count(added);
	// Read and raised in the character's spending turn (utils/spender-queue.js); a take-back takes its own turn.
	const { now, takeBack } = await inSpenderTurn(actor, async () => {
		const track = learnedTrack(actor, move);
		if (!track) return { now: done, takeBack: 0 };
		const hold = Math.min(track.max, count(holds?.[tier]));
		// What the track would hold without this card; a bonus (holdMoreBonus) rides on top of the hold.
		const base = Math.max(0, track.held - done);
		const want = Math.max(0, Math.min(track.max, Math.max(base, hold) + count(bonus)) - base);
		if (want > done) {
			const next = Math.min(track.max, track.held + want - done);
			if (next !== track.held) await track.resources.setUses(move, next, { stonetopMove: move });
			return { now: done + (next - track.held), takeBack: 0 };
		}
		return { now: want, takeBack: done - want };
	});
	if (takeBack > 0) await takeBackHeld(actor, move, takeBack);
	return now;
}

/**
 * A move whose own track says what a roll holds: `system.resource.holdOnRoll = {success, partial, failure}`
 * ("on a 10+, hold 3 Fear; on a 7-9, hold 1"). Written by the Playbook Builder for a homebrew move
 * (playbooks/homebrew-bundle.js), read from the move's words, and carried by the pack for a book move that
 * holds on a roll (Silver Tongued; BOOK_HOLD_ON_ROLL for a copy taken before it did). Null for every other move.
 */
export function holdOnRollFor(actor, move) {
	const item = ownedLearnedMove(actor, move);
	const holds = item?.system?.resource?.holdOnRoll ?? BOOK_HOLD_ON_ROLL[bookMoveName(item)];
	return holds && typeof holds === "object" && Object.values(holds).some(v => count(v) > 0) ? holds : null;
}

/**
 * More to hold on a roll, by tier (`{success, partial, failure}`), from a line taken in its roll window (the
 * Stranger's Ephemera: "Spend ☐ to hold +1 Fear when you roll the Pariah move, even on a 6-"), in the one
 * shape kept; null for none. Paid after the dice and handed to settleTierEffects as `holdMore`
 * (StonetopCharacter#onRoll), so nothing waits between the two. PURE.
 */
export function holdMoreBonus(bonus) {
	const out = { success: count(bonus?.success), partial: count(bonus?.partial), failure: count(bonus?.failure) };
	return Object.values(out).some(Boolean) ? out : null;
}

// A tier's words that put the form on: "take on its traits, armament, moves…", "you transform". Not when the
// words say it doesn't happen ("you fail to transform", "you can't turn into it").
const TAKES_FORM = /\b(?:take\s+on|transform|turn\s+into)/gi;
const NOT_BEFORE = /\b(?:fail(?:s|ed)?\s+to|don['’]?t|do\s+not|can['’]?t|cannot|won['’]?t|not|never|unable\s+to|without|instead\s+of)\s+(?:\w+\s+){0,2}$/i;
// A tier that opens on another's outcome ("as a 7+ but you lose yourself"): it does what that tier does.
const AS_TIER = /^\W*as\s+(?:on\s+)?a\s+(7\+|7-9|10\+)/i;
const AS_TIERS = { "7+": ["success", "partial"], "7-9": ["partial"], "10+": ["success"] };

function _takesForm(text) {
	for (const m of text.matchAll(TAKES_FORM)) if (!NOT_BEFORE.test(text.slice(0, m.index))) return true;
	return false;
}

/** Which of a move's tiers put its form on: by their own words, or by opening "as a 7+" on a tier that does. */
function _formTiers(results) {
	const text = t => String(results[t]?.value ?? "");
	const own = Object.fromEntries(["success", "partial", "failure"].map(t => [t, _takesForm(text(t))]));
	return Object.fromEntries(Object.entries(own).map(([t, on]) => {
		const as = text(t).match(AS_TIER)?.[1];
		return [t, on || (!!as && AS_TIERS[as].some(other => other !== t && own[other]))];
	}));
}

/**
 * A homebrew insert's own rolled move that puts its form on (the Stranger's Metamorphosis: "When you reveal
 * the monster within roll +CON: on a 7+, take on its traits, armament, moves…; on a 6-, as a 7+ but you lose
 * yourself to your instinct"): `{key, tiers: {success, partial, failure}}`, the insert and which tiers do,
 * read off the move's results; null for any other move, or an insert with no form switch. A move on one of
 * the insert's lists is a pick, not the way in, so only a move the insert always gives counts.
 */
export function insertFormRollFor(actor, move) {
	const item = ownedLearnedMove(actor, move);
	const ins = homebrewInsertOf(item);
	if (!ins || ins.list) return null;
	const def = homebrewPlaybookInserts(homebrewMoveSlug(item)).find(i => i?.key === ins.key);
	if (!def?.form?.enabled) return null;
	const results = item.system?.moveResults ?? {};
	const tiers = _formTiers(results);
	return Object.values(tiers).some(Boolean) ? { key: ins.key, tiers } : null;
}

/**
 * Put an insert's form on, or take it back off, by the tier of the roll that reveals it (insertFormRollFor).
 * `done` is `{key, prior, set}`: whether the form was worn before the roll, and whether THIS card put it on.
 * A form already worn is left alone, and a Shift off a form-giving tier takes off only what this card put on.
 */
async function settleInsertForm(actor, move, tier, done, character) {
	const form = insertFormRollFor(actor, move);
	const inserts = (character ?? actor?.typedActor)?._homebrewInserts;
	if (!form || !inserts) return done ?? undefined;
	const wearing = inserts.wearing(form.key);
	const prior = done ? !!done.prior : wearing;
	const wants = !!form.tiers[tier];
	if (wants && !wearing && !prior) {
		await inserts.setWearing(form.key, true);
		return { key: form.key, prior, set: true };
	}
	if (!wants && done?.set) {
		if (wearing) await inserts.setWearing(form.key, false);
		return { key: form.key, prior, set: false };
	}
	return { key: form.key, prior, set: !!done?.set };
}

/**
 * A follower ordered to Defend (wave 3 audit FOL-5): bring the follower's Readiness track to what `tier`
 * holds (1 on a 7-9, 3 on a 10+, none on a 6-; a shield's +1 stays the player's pip), given what this
 * card raised it to so far. `done` is `{path, prior, set, name, bonus?}`: the track's flag path under the
 * system scope, what was held before the roll, what this card's tier set, and the Readiness a 7+ adds on its
 * own (the Marshal's Shield Wall, +2 for a crew formed bearing shields: fight/shield-wall.js), kept on the
 * record so a Shift or a +1 settles the same hold. Readiness spent since stays spent (readinessForTier).
 * Resolves to the card's new record. `announce` posts a note when a moved card raises the pool; the order's
 * own roll posts its own.
 */
export async function settleFollowerReadiness(actor, tier, done, { announce = false, scope = SYSTEM_ID } = {}) {
	if (!actor || !done?.path) return done ?? undefined;
	const current = count(foundry.utils.getProperty(actor.flags?.[scope] ?? {}, done.path));
	const prior = count(done.prior);
	const hold = defendReadinessHold(tier) + (tier === "failure" ? 0 : count(done.bonus));
	const { next, set } = readinessForTier({ prior, set: done.set ?? prior, current, hold });
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
	// `{spent, regained}`: whether this card's roll spent a Surprise, and how many its 10+ gave back (0 or 1).
	// "Spend 1 Surprise ... on a 10+ ... regain 1": a roll made holding none spent nothing, so it regains
	// nothing, however its tier moves. Told at the roll (`surpriseSpent`, StonetopCharacter#onRoll's spend);
	// a card from before this was kept carries the bare count, and is read as having spent one.
	surpriseRegained: {
		moves: [PREPARE_A_WELCOME],
		async settle(actor, move, tier, done, _character, { surpriseSpent = false } = {}) {
			const legacy = done != null && typeof done !== "object";
			const spent = done == null ? !!surpriseSpent : (legacy || !!done.spent);
			const n = count(legacy ? done : done?.regained);
			const wants = spent && tier === "success";
			if (wants && !n) return { spent, regained: (await regainSurpriseOnHit(actor, { name: move }, tier)) ? 1 : 0 };
			if (!wants && n) { await takeBackSurprise(actor, n); return { spent, regained: 0 }; }
			return { spent, regained: n };
		},
	},
	// How many Sanction this card filled.
	sanctionFilled: {
		moves: [COMMUNE_WITH_ARATIS],
		async settle(actor, move, tier, done) {
			const wants = tier === "success";
			const n = count(done);
			if (wants && !n) return fillSanctionOnHit(actor, { name: move }, tier);
			if (!wants && n) { await releaseSanction(actor, n); return 0; }
			return n;
		},
	},
	// How many this card put on a track whose move says what a roll holds (holdOnRollFor): matched by the
	// move's DATA, not its name, so any move can carry it (Silver Tongued's Nerve, a homebrew "Pariah": "on a
	// 10+, hold 3 Fear"). `{added, bonus}` instead when a line taken on the roll held more (`holdMore`,
	// holdMoreBonus): the bonus is kept on the card, so a Shift settles the new tier with it.
	heldOnRoll: {
		moves: [],
		matches: (actor, move) => !!holdOnRollFor(actor, move),
		async settle(actor, move, tier, done, _character, { holdMore = null } = {}) {
			const bonus = done == null ? holdMoreBonus(holdMore) : (done?.bonus ?? null);
			const added = done != null && typeof done === "object" ? done.added : done;
			const now = await settleHeld(actor, move, holdOnRollFor(actor, move), tier, added, bonus?.[tier] ?? 0);
			return bonus && now !== undefined ? { added: now, bonus } : now;
		},
	},
	// `{key, prior, set}`: a homebrew insert's form this card put on (insertFormRollFor), matched by the move's
	// data, as heldOnRoll is.
	insertForm: {
		moves: [],
		matches: (actor, move) => !!insertFormRollFor(actor, move),
		settle: (actor, move, tier, done, character) => settleInsertForm(actor, move, tier, done, character),
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
	// An Amulets & Talismans charm's roll (fight/defend-spend.js#rollCharm): `{card, row, by, markId, tier}`, the
	// damage card and row it was rolled for and the tier that card recorded. Matched by its RECORD (the roll card is
	// a bare +INT titled for the move). A Shift or a +1 moving this roll card moves the damage card's tier too
	// (defend-spend.js#retierCharm), and the charm's potency with it.
	charmSpend: {
		moves: [],
		recorded: true,
		async settle(actor, _move, tier, done) {
			if (!done?.card || done.tier === tier) return done ?? undefined;
			const { retierCharm } = await import("../../fight/defend-spend.js");
			return (await retierCharm(actor, done, tier)) ? { ...done, tier } : done;
		},
	},
	// `{prior, set}`: the Readiness held before the roll, and what this card's tier raised it to.
	readiness: {
		moves: [DEFEND_MOVE],
		settle: (_actor, _move, tier, done, character) => character?.settleDefendReadinessTier?.(tier, done) ?? done ?? null,
	},
	// `{foes, set, added}`: the foes the Alpha was aimed at (`{key, name}`), whether this card's 10+ has them
	// remembered, and which of them THIS card put there (`added`, their keys). A foe already held from an earlier
	// Alpha 10+ is that card's, so a Shift taking this card off its 10+ lets go only of what this card added.
	// Aimed at nobody, nothing: there is no "them" to have advantage against.
	alphaOver: {
		moves: [HERO_MOVES.ALPHA],
		async settle(actor, _move, tier, done, _character, { targets = [] } = {}) {
			const foes = done?.foes ?? (targets ?? []).map(t => ({ key: foeKey(t), name: t?.name ?? "" })).filter(f => f.key);
			if (!foes.length) return undefined;
			const wants = tier === "success";
			if (wants && !done?.set) {
				const held = new Set(alphaKeysHeld(actor));
				const added = foes.map(f => f.key).filter(key => !held.has(key));
				return { foes, set: await recordAlphaOver(actor, foes), added };
			}
			if (!wants && done?.set) {
				// A card from before `added` was kept takes back every foe it named, as it always did.
				await forgetAlphaOver(actor, done.added ?? foes.map(f => f.key));
				return { foes, set: false };
			}
			return { foes, set: !!done?.set, ...(done?.added ? { added: done.added } : {}) };
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
 * @param {boolean} [options.surpriseSpent]  whether the roll spent a Surprise (at the roll itself; Prepare a
 *   Welcome keeps it), combat/battle-holds.js#spendSurpriseForRoll
 * @param {string[]|null} [options.only]  only these effects (a homebrew move: HOMEBREW_TIER_EFFECTS)
 * @param {object|null} [options.holdMore]  more to hold by tier, from a line taken on the roll (holdMoreBonus)
 * @returns {Promise<object>}
 */
export async function settleTierEffects(actor, move, tier, done = null, { character = actor?.typedActor, targets = [], surpriseSpent = false, only = null, holdMore = null } = {}) {
	const record = {};
	for (const [key, effect] of Object.entries(TIER_EFFECTS)) {
		if (only && !only.includes(key)) continue;
		if (!effect.moves.includes(move) && !(effect.recorded && done?.[key] != null) && !effect.matches?.(actor, move)) continue;
		const now = await effect.settle(actor, move, tier, done?.[key], character, { targets, surpriseSpent, holdMore });
		// An effect with nothing to keep (an Alpha aimed at nobody) leaves no trace on the card.
		if (now !== undefined) record[key] = now;
	}
	return record;
}

/**
 * What a move a player or a homebrew playbook wrote can do when rolled: only what its own DATA says (a
 * homebrew Pariah's "on a 10+, hold 3 Fear"), never a book move's effect it happens to share a name with
 * (owns-move.js#bookMoveName). `TIER_EFFECTS` keys.
 */
export const HOMEBREW_TIER_EFFECTS = Object.freeze(["heldOnRoll", "insertForm"]);

/**
 * The tier effects a rolled move may settle, `{moveName, only}`, or null for none. A book move settles every
 * one (`only` null) under its book name (owns-move.js#bookMoveName); one written by a player or a homebrew
 * playbook settles HOMEBREW_TIER_EFFECTS under its own, and only when its data gives it one. `item` is the
 * rolled move's Item.
 */
export function tierEffectsAllowed(actor, item) {
	const book = bookMoveName(item);
	if (book) return { moveName: book, only: null };
	const name = item?.name;
	return name && (holdOnRollFor(actor, name) || insertFormRollFor(actor, name))
		? { moveName: name, only: HOMEBREW_TIER_EFFECTS }
		: null;
}

/**
 * A card recorded before Silver Tongued's Nerve was settled as any other move's hold kept it as `nerveHeld`:
 * read as heldOnRoll, so a later Shift still undoes what that card added.
 */
function withLegacyKeys(done) {
	if (done?.nerveHeld == null || done.heldOnRoll != null) return done;
	const { nerveHeld, ...rest } = done;
	return { ...rest, heldOnRoll: nerveHeld };
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
	const recorded = message?.getFlag?.(scope, TIER_EFFECTS_FLAG);
	if (!recorded || typeof recorded !== "object" || !Number.isFinite(Number(total))) return false;
	const done = withLegacyKeys(recorded);
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
	// A move a player or a homebrew playbook wrote only ever settles its own data's effects, as at the roll
	// (tierEffectsAllowed). A card for no move the roller holds (a follower's order, titled for the
	// follower) settles whatever it recorded.
	const item = roller.items?.find?.(i => i.type === "move" && i.name === move);
	const gate = item ? tierEffectsAllowed(roller, item) : { only: null };
	if (!gate) return false;
	try {
		const next = await settleTierEffects(roller, move, tier, done, { only: gate.only });
		if (!Object.keys(next).length || JSON.stringify(next) === JSON.stringify(done)) return false;
		return recordTierEffects(message, next, { scope });
	} catch (err) {
		console.error("Stonetop | bringing a shifted roll's tier effects up to date failed", err);
		return false;
	}
}
