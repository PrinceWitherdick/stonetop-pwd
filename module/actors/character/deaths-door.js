/**
 * Death and dying (Book I, Harm & Healing, p.245).
 *
 * Everything here is Foundry-free so it can be unit-tested and imported by the hook, the
 * sheet and the dialog without any one of them owning the rules. Three things live here:
 *
 *  • WHICH move a character triggers at 0 HP. This is not always Death's Door. Once a PC
 *    carries a post-death insert they have their own 0-HP move and Death's Door is behind
 *    them — the Revenant rolls Undying (+CON), the Ghost disperses via Tethered, the Thrall's
 *    master intercedes via Dark Succor. Prompting an undead PC to roll Death's Door would
 *    teach the wrong rule, so the routing table is the single source of that answer.
 *
 *  • The dying/out-of-action/dead STATE, which HP alone can't express. At 0 HP a PC is
 *    dying only until they face the move; after a 7-9 they're at 0 HP and explicitly NOT
 *    dying ("the Lady waves you off"), so a bare `hp <= 0` test would let them roll again
 *    and again off one brush with death.
 *
 *  • How the Heavy's moves bend the Death's Door roll (Book I p.114): Hard to Kill offers
 *    +CON or +nothing and a 7-9 escape hatch, Unstoppable defers the roll and charges -1 per
 *    circle marked. And the Would-Be Hero's: Never Gonna Keep Me Down skips it for a 10+ once
 *    a session, and a Destined hero's tier moves up a step until their destiny is fulfilled.
 */

import { destinyUnfulfilled, DESTINED_LABEL } from "./destined.js";
import { SYSTEM_ID } from "../../system-id.js";
import { ROLLED_FLAG, cardCountedTier, outcomeTier } from "../../utils/counted-tier.js";

// The state a character is in with respect to their current brush with death. Stored on the
// actor (see DEATHS_DOOR_FLAG); absent/null is the ordinary living state.
export const DEATHS_DOOR_STATE = {
	/** At 0 HP and has not yet faced their 0-HP move. */
	DYING: "dying",
	/**
	 * Death's Door 6- rolled, fate not yet chosen. Its own state because the roll is spent —
	 * the GM is asking why they refuse to go, which the book expects to take a moment — and
	 * nothing in that conversation should let them roll the fatal result again.
	 */
	FATE_PENDING: "fate-pending",
	/** Death's Door 7-9: no longer dying, but unconscious "until you say otherwise" (p.245). */
	OUT_OF_ACTION: "out-of-action",
	/** Death's Door 6-, having stepped through the Last Door. "There's no saving them." */
	DEAD: "dead",
};

/** Actor flag key (under the system scope) holding the DEATHS_DOOR_STATE value. */
export const DEATHS_DOOR_FLAG = "deathsDoor";

/**
 * Actor flag key (under the system scope): Hard to Kill's 7-9 trade is still open ("on a 7-9, you can mark a
 * debility of your choice to regain 1 HP"). Written with the 7-9 that opens it, so the sheet's Death's Door card
 * can offer it once the window that rolled is gone, and cleared by the trade or by the next brush with death.
 */
export const HARD_TO_KILL_TRADE_FLAG = "hardToKillTrade";

/**
 * Actor flag key (under the system scope): this Heavy was reduced to 0 HP IN BATTLE with Unstoppable learned,
 * and fights on ("When you are reduced to 0 HP in battle, you can keep fighting", Book I p.114). Stamped by the
 * HP write that drops them (hooks/DeathsDoorPrompt.js#onPreUpdateActorDeathsDoor), so whether they were in a fight
 * is read at the drop, not later. Cleared when they stop fighting: any write that moves them off dying (the Door
 * rolled, the GM's not-lethal ruling, hit points back above 0) and the fight's end (combat/battle-joy-offer.js).
 */
export const UNSTOPPABLE_FIGHTING_FLAG = "unstoppableFighting";

/**
 * Whether Hard to Kill's trade is on offer: out of the action off a 7-9 that opened it, with Hard to Kill learned.
 * Pure, for the sheet's card.
 */
export function hardToKillTradeOpen({ state = null, latched = false, hardToKill = false } = {}) {
	return !!latched && !!hardToKill && state === DEATHS_DOOR_STATE.OUT_OF_ACTION;
}

/** Move names the routing and roll rules key off, so no caller retypes the literals. */
export const HARD_TO_KILL  = "Hard to Kill";
export const UNSTOPPABLE   = "Unstoppable";
export const NEVER_GONNA_KEEP_ME_DOWN = "Never Gonna Keep Me Down";

/**
 * The tier a Death's Door card counts as at `total`: the Destined's "treat a 6- on Death's Door as a 7-9, and
 * a 7-9 as a 10+" is stamped on the card (utils/counted-tier.js), and a 12+ is this move's 10+. For the window
 * and the GM's client alike (dialogs/DeathsDoorDialog.js, deaths-door-relay.js).
 */
export function deathsDoorCardTier(card, total) {
	return outcomeTier(cardCountedTier(card, total, SYSTEM_ID));
}

/** Who moves a Death's Door card's tier up a step (the Destined), as the window's tier note names it, or null. */
export function deathsDoorCardTierShift(card) {
	const record = card?.getFlag?.(SYSTEM_ID, ROLLED_FLAG) ?? null;
	return record?.partialCountsAsSuccessWhy || record?.missCountsAsPartialWhy || null;
}

/**
 * Every post-death insert there is, in the order Death's Door offers them (p.245): refuse to
 * go and you take Revenant or Ghost, call on a Thing Below and you take Thrall. The book names
 * three and no more, so this is the closed set — not a hint, and not a default that a fourth
 * could be added to.
 *
 * Kept here beside ZERO_HP_MOVES because the two answer the same question from either end: a
 * character carries one of these, and it decides their 0-HP move. Anything listing the inserts
 * for the player reads this rather than asking the items compendium what it happens to hold —
 * that pack carries every move, item and treasure in the system, so an unfiltered read of it
 * offers hundreds of "fates".
 */
export const POST_DEATH_INSERT_SLUGS = ["revenant", "ghost", "thrall"];

/**
 * Where the Thrall's Favor track lives in its insert's lore. Stated once because three things
 * need the same coordinates: the +Favor roll reads it, "regardless, reset your Favor to 0"
 * writes it, and CharacterPostDeath resolves the track through it.
 */
export const FAVOR_TRACK = { entry: "favor", option: "favor-track" };

/** The most Favor a Thrall can hold: "can go no higher than 3". */
export const FAVOR_MAX = 3;

/**
 * The move a character triggers when reduced to 0 HP, keyed by their active post-death
 * insert slug ("null" = no insert). Trigger text is the book's, verbatim — players read it
 * on the prompt card, so it must read as the move reads.
 *
 * `roll.stat` is the stat the system can actually roll; null means the move calls for a roll
 * we don't model (the Thrall's +Favor is tracked on the insert, not as a character stat), so
 * the prompt hands the player their own move rather than faking the maths.
 */
export const ZERO_HP_MOVES = {
	null: {
		name:    "Death's Door",
		trigger: "When you <strong><em>are dying</em></strong>, you glimpse the Last Door and the Lady of Crows (describe them).",
		roll:    { stat: "", label: "+nothing" },
		// Death's Door has its own walkthrough dialog; every other 0-HP move is rolled or
		// resolved from the character's own move list.
		dialog:  true,
	},
	revenant: {
		name:    "Undying",
		trigger: "When you are <strong><em>reduced to 0 HP</em></strong>, roll +CON: on a 10+, regain half your max HP and choose 1; on a 7-9, regain half your max HP and choose 2; on a 6-, either regain 1 HP and all 3 apply, or give up this insert and gain the Ghost insert instead.",
		roll:    { stat: "con", label: "+CON" },
		dialog:  false,
	},
	ghost: {
		name:    "Tethered",
		trigger: "When you are <strong><em>reduced to 0 HP</em></strong>, mark a consequence and your essence disperses until the next sunset. You reform near your tether with half your max HP. If your tether has been destroyed, mark the Final Consequence.",
		roll:    null,
		dialog:  false,
	},
	thrall: {
		name:    "Dark Succor",
		trigger: "When you are <strong><em>dying or killed outright</em></strong>, your master intercedes on your behalf. You will recover, here and now or at a time and place of the GM's choosing. Then, roll +Favor: on a 10+, choose 1; on a 7-9, choose 2; on a 6-, all 3 apply.",
		roll:    { stat: null, label: "+Favor", loreCount: FAVOR_TRACK },
		dialog:  false,
	},
};

/**
 * How each insert's 0-HP move resolves, in the shape the walkthrough enacts.
 *
 * `effects` are the move's own numbered options, and `tiers[key].pick` says how many of them
 * the roll makes you take — the "choose 1 / choose 2 / all 3" ladder all three moves share.
 * Each effect names a `kind` the dialog knows how to apply; the label is the book's text, since
 * it's what the player reads while choosing.
 *
 * `hp` is what the move restores on that tier: "half" = half your max HP, a number = exactly
 * that, null = the move doesn't say (Dark Succor's "you will recover, here and now or at a time
 * and place of the GM's choosing" is a GM call, not an arithmetic one, so nothing is written).
 */
export const ZERO_HP_RESOLUTIONS = {
	revenant: {
		effects: [
			{ kind: "consequence",   label: "Mark a consequence" },
			{ kind: "out-of-action", label: "You're out of the action until the next sunset" },
			{ kind: "maim",          label: "Your body is permanently maimed in some way of the GM's choosing" },
		],
		tiers: {
			success: { pick: 1, hp: "half" },
			partial: { pick: 2, hp: "half" },
			failure: {
				pick: 3,
				hp: 1,
				// "…or give up this insert and gain the Ghost insert instead" — a whole different
				// answer to the 6-, not one of the three, so it stands beside them.
				alternative: {
					key:    "become-ghost",
					label:  "Give up this insert and gain the Ghost insert instead",
					insert: "ghost",
				},
			},
		},
		// "If your body is completely destroyed (burnt to ash, ground to jelly, etc.), treat it
		// as if you were reduced to 0 HP and rolled a 6-." Whether the body is gone is a fiction
		// call, so it's offered as a way in rather than detected.
		forcedMiss: {
			label: "My body was completely destroyed — burnt to ash, ground to jelly",
			hint:  "Skip the roll and resolve it as a 6-.",
		},
	},

	ghost: {
		effects: [
			{ kind: "consequence", label: "Mark a consequence" },
		],
		tiers: { always: { pick: 1, hp: null } },
		// "You reform near your tether with half your max HP" — at the next sunset, not now, so
		// the HP lands when they reform rather than the moment they disperse.
		disperses: { hp: "half" },
		// "If your tether has been destroyed, mark the Final Consequence." That replaces the
		// reforming: there is nothing left to reform beside.
		tetherDestroyed: {
			label: "My tether has been destroyed",
			hint:  "Mark the Final Consequence instead of reforming.",
		},
	},

	thrall: {
		// "Your master's succor has no number" — Dark Succor is the one move that leaves the
		// recovery to the GM, so the card says why rather than showing a blank where the HP goes.
		hpNote: "Your master's succor has no number: you recover here and now, or at a time and "
			+ "place of the GM's choosing. When you do, press Back on your feet on your Special Moves tab.",
		effects: [
			{ kind: "mark-gain",     label: "Gain a new Mark of the GM's choice" },
			{ kind: "mark-crossoff", label: "Cross off a Mark that you don't have — you can never gain it" },
			{ kind: "task",          label: "Your master gives you a task; until you complete it, your Favor stays at 0" },
		],
		tiers: {
			success: { pick: 1, hp: null },
			partial: { pick: 2, hp: null },
			failure: { pick: 3, hp: null },
		},
		// "Regardless, reset your Favor to 0."
		alwaysResetFavor: FAVOR_TRACK,
	},
};

/**
 * The 0-HP move for a character carrying `insertSlug` (null/unknown → Death's Door).
 * Unknown slugs fall back to Death's Door rather than throwing: a homebrew insert dropped
 * on a sheet shouldn't leave a dying PC with no move at all.
 */
export function zeroHpMove(insertSlug) {
	return ZERO_HP_MOVES[insertSlug ?? "null"] ?? ZERO_HP_MOVES.null;
}

/**
 * Whether a roll card is a Death's Door roll, read off what rollStat stamps on it (ROLLED_FLAG's `move`).
 * Its own window settles the outcome the moment the dice land (dialogs/DeathsDoorDialog.js), and offers
 * Burn Brightly and Impetuous Youth's "give it your all" there, before it does. So the card's own buttons
 * for them stay off: a lift pressed on the card afterwards would relabel it and change nothing.
 */
export function isDeathsDoorCard(message) {
	return message?.getFlag?.(SYSTEM_ID, ROLLED_FLAG)?.move === ZERO_HP_MOVES.null.name;
}

/** The inserts' own 0-HP moves by name: Undying, Tethered, Dark Succor. */
export const UNDEATH_MOVE_NAMES = POST_DEATH_INSERT_SLUGS.map(slug => ZERO_HP_MOVES[slug].name);

/**
 * Whether a roll card is one of the inserts' 0-HP moves (Undying's +CON, Dark Succor's +Favor), read the same
 * way as isDeathsDoorCard. UndeathDialog classifies the tier the moment the dice land and applies what it
 * says, so a +1, a Burn Brightly or a GM's Shift pressed on the card afterwards would relabel it while the
 * sheet kept the old tier's costs.
 */
export function isUndeathCard(message) {
	return UNDEATH_MOVE_NAMES.includes(message?.getFlag?.(SYSTEM_ID, ROLLED_FLAG)?.move);
}

/**
 * Any 0-HP move's card: Death's Door or an insert's. The question the card's Burn Brightly and the GM's Shift
 * ask (stonetop.js), since every one of them is settled by its own window. The +1s ask isUndeathCard alone
 * (roll-boosts.js#isBoostableRoll), since a Door card takes them while its window waits; Impetuous Youth's
 * card button asks isDeathsDoorCard, since the Door's give it your all is its window's own.
 */
export function isZeroHpMoveCard(message) {
	return isDeathsDoorCard(message) || isUndeathCard(message);
}

/**
 * The state taking an insert leaves a character in, given the state they were in (the user's ruling,
 * 2026-09-27). Coming back from the Door is not getting up: whoever takes an insert while dying, owing a
 * fate or dead is returned OUT OF THE ACTION at 0 HP, and the Special Moves card's "Back on your feet"
 * (a Ghost's "Reform at your tether") is what brings them up with half their max HP.
 *
 * Any other state stands. A character already out of the action stays there, and a living one given an
 * insert by the GM away from any brush with death has nothing to return from. `atTheDoor` says whether
 * the hit points go to 0 with it.
 *
 * @returns {{state: string|null, atTheDoor: boolean}}
 */
export function stateOnTakingInsert(state = null) {
	const atTheDoor = state === DEATHS_DOOR_STATE.DYING || state === DEATHS_DOOR_STATE.FATE_PENDING
		|| state === DEATHS_DOOR_STATE.DEAD;
	return { state: atTheDoor ? DEATHS_DOOR_STATE.OUT_OF_ACTION : state, atTheDoor };
}

/** Where THE FINAL CONSEQUENCE is ticked on a Ghost or Revenant: the lore section and option. */
export const FINAL_CONSEQUENCE = { section: "consequences", option: "final-consequence" };

/**
 * How a character past the Door left play, when it was not through the Last Door: null for everyone else.
 *
 *  • "monster"  a Ghost or Revenant who marked THE FINAL CONSEQUENCE: "your tenuous connection to humanity
 *               is lost and you become a monster under the GM's control."
 *  • "threat"   a Thrall lost to Unholy Vessel: "your humanity is utterly lost. You become a threat in the
 *               GM's control." A Thrall has no other way to `dead` (Dark Succor always intercedes).
 *
 * A Ghost or Revenant who is `dead` without the Final Consequence finished their Terrible Purpose and did
 * pass through the Last Door, which is what the plain card says. Pure, for the sheet's card to word.
 */
export function lostToTheGm({ state = null, insertSlug = null, finalConsequence = false } = {}) {
	if (state !== DEATHS_DOOR_STATE.DEAD) return null;
	if (insertSlug === "thrall") return "threat";
	if ((insertSlug === "ghost" || insertSlug === "revenant") && finalConsequence) return "monster";
	return null;
}

/**
 * The resolution spec for an insert's 0-HP move, or null for a character without one.
 *
 * The move's `name` and `roll` come from ZERO_HP_MOVES rather than being restated here: the two
 * tables are keyed by the same slugs, and a rename or a stat change that landed in only one of
 * them would put the chat header and the roll out of step with the move the player is reading.
 */
export function zeroHpResolution(insertSlug) {
	const res = ZERO_HP_RESOLUTIONS[insertSlug];
	if (!res) return null;
	const move = ZERO_HP_MOVES[insertSlug];
	return { ...res, move: move?.name ?? "", roll: move?.roll ?? null };
}

/**
 * How many of a move's effects a tier makes you take, and what HP it restores. Ghost's Tethered
 * doesn't roll, so its single tier is keyed "always" — callers pass `null` for the tier.
 */
export function resolutionTier(resolution, tierKey) {
	if (!resolution) return null;
	return resolution.tiers[tierKey ?? "always"] ?? resolution.tiers.always ?? null;
}

/**
 * "Regain half your max HP", rounded up — the convention Stonetop states wherever it halves
 * anything in a PC-facing move (Undying's own "take half damage (after armor, rounded up)").
 * Applied in exactly one place so the two moves that use the phrase can't drift apart.
 */
export function halfMaxHp(maxHp) {
	return Math.max(1, Math.ceil((Number(maxHp) || 0) / 2));
}

/** The HP a tier restores: a number, or null when the move leaves it to the GM. */
export function resolvedHp(tier, maxHp) {
	if (!tier || tier.hp === null || tier.hp === undefined) return null;
	return tier.hp === "half" ? halfMaxHp(maxHp) : Number(tier.hp) || 0;
}

/**
 * The state a character should be in after an HP change, given the state they were in.
 * Pure — the hook applies the result, this decides it.
 *
 * Crossing to 0 makes them dying (the trigger is "reduced to 0 HP"), so a PC who is already
 * down and takes another hit isn't re-prompted. Coming back above 0 clears `dying` — they
 * were patched up before they had to face the move.
 *
 * Nothing else is HP's to undo: `out-of-action` stands "until you say otherwise", `dead` is
 * final, and `fate-pending` means a fatal roll is already on the table — healing a character
 * mid-conversation can't retract the 6- they rolled.
 */
export function nextDeathsDoorState({ oldHp, newHp, state = null }) {
	if (state === DEATHS_DOOR_STATE.DEAD || state === DEATHS_DOOR_STATE.FATE_PENDING) return state;
	if (newHp <= 0 && oldHp > 0) return DEATHS_DOOR_STATE.DYING;
	if (newHp > 0 && state === DEATHS_DOOR_STATE.DYING) return null;
	return state;
}

/**
 * Whether the character may face their 0-HP move right now. Being at 0 HP is not enough:
 * a 7-9 leaves them at 0 HP and no longer dying, and a PC who stepped through the Last Door
 * doesn't roll anything.
 */
export function canFaceDeathsDoor({ hp, state = null }) {
	return hp <= 0 && state === DEATHS_DOOR_STATE.DYING;
}

/**
 * Actor flag key (under the system scope) holding the Death's Door roll in progress:
 * `{ userId, userName, at, nonce, messageId, total, tier, boosts }`.
 *
 * The walkthrough is one client's window, and nothing it decides reaches the actor until the tier
 * lands; the character stays `dying` through the dice and through the Burn Brightly / "give it your
 * all" pause. So every other owner's window would offer a fresh roll meanwhile. This is what tells
 * them not to: written before the dice (`nonce` names the roll, and is stamped on its card as
 * DEATHS_DOOR_ROLL_FLAG), by the primary GM's client when one is connected so two owners' claims
 * are ruled on one at a time (deathsDoorClaimRuling), filled in with the card, the total, the
 * counted tier and the boosts still on offer (`boosts`: "burn", "giveAll") the moment the dice land,
 * and cleared when the tier lands. What it carries is all a window taking the roll over has of a
 * private roll's card, which that window's client was never sent.
 */
export const DEATHS_DOOR_ROLLING_FLAG = "deathsDoorRolling";

/** Message flag key (under the system scope) on a Death's Door card: the roll's `nonce`, as its marker names it. */
export const DEATHS_DOOR_ROLL_FLAG = "deathsDoorRoll";

/**
 * How long a roll in progress may sit untouched before another owner may take it over. Measured from the
 * holder's last write to it (the start, the dice landing, each boost), so a player still pressing buttons
 * never goes stale; a window left on "Accept this result" does, after five minutes. A holder who has left
 * the game can be taken over at once.
 */
export const DEATHS_DOOR_ROLL_STALE_MS = 5 * 60 * 1000;

/**
 * What a Death's Door window should make of the roll in progress on its character. Pure: the window reads
 * the marker, the users and the clock, and this rules on them.
 *
 *  • "none"      nothing to follow: no marker, one set aside here (`ignoredNonce`), or the character is not
 *                dying any more (a marker is honoured only while `dying` stands, so one left behind by a
 *                write that failed can never hold a later brush with death).
 *  • "own"       this window's own roll (`ownNonce`), still under this user's name.
 *  • "resume"    this user's roll that no window here is holding (their page was reloaded mid-roll):
 *                the window picks it back up rather than offering the dice again.
 *  • "watch"     someone else's roll, live: the window waits on it.
 *  • "orphaned"  someone else's roll nobody is finishing: `reason` "away" (they have left the game) or
 *                "stale" (untouched for DEATHS_DOOR_ROLL_STALE_MS). Another owner may take it over.
 *
 * A roll this window made and then lost (another owner took it over) is someone else's again.
 *
 * @returns {{kind: "none"|"own"|"resume"|"watch"|"orphaned", marker: object|null, reason?: "away"|"stale"}}
 */
export function deathsDoorRollWatch({
	marker = null, state = null, me = null, ownNonce = null, ignoredNonce = null,
	heldHere = false, holderActive = false, now = 0,
} = {}) {
	if (!marker?.userId || !marker?.nonce || state !== DEATHS_DOOR_STATE.DYING) return { kind: "none", marker: null };
	if (marker.nonce === ignoredNonce) return { kind: "none", marker: null };
	if (marker.userId === me) {
		if (marker.nonce === ownNonce) return { kind: "own", marker };
		// Another window on this same client is still holding it (one closed while the dice were in the air).
		return heldHere ? { kind: "watch", marker } : { kind: "resume", marker };
	}
	if (!holderActive) return { kind: "orphaned", marker, reason: "away" };
	if (now - (Number(marker.at) || 0) > DEATHS_DOOR_ROLL_STALE_MS) return { kind: "orphaned", marker, reason: "stale" };
	return { kind: "watch", marker };
}

/**
 * Whether the primary GM grants a user's claim on a character's Death's Door roll. Every owner's window puts its
 * claim to the GM's client before its dice (deaths-door-relay.js#handleDeathsDoorClaimQuery), which rules on one
 * claim at a time: that is what turns two presses of Roll inside one round trip into one roll. Pure: the GM reads
 * the stored marker, the users and the clock, and this rules on them, from the claimant's side of
 * deathsDoorRollWatch.
 *
 *  • Refused while the character is not dying: the Door was settled (or they were brought back up) before the
 *    claim arrived, and a roll now would land a second tier.
 *  • A fresh roll is refused while another user's roll is live, and over an abandoned one that reached the table
 *    (`posted`): that one is taken over and accepted, never rolled again. Otherwise granted: nothing under way,
 *    this user's own, or another's that nobody is finishing.
 *  • Taking over (`takeOver`, with `nonce` the roll being taken) is granted only while the stored marker still
 *    names that roll and it is still nobody's to finish (or already this user's).
 *
 * @returns {{granted: boolean, holder: object|null}}  on a refusal, `holder` is the roll that stands, if any
 */
export function deathsDoorClaimRuling({
	marker = null, state = null, userId = null, nonce = null, takeOver = false,
	holderActive = false, posted = false, now = 0,
} = {}) {
	const refused = holder => ({ granted: false, holder: holder ?? null });
	if (!userId || !nonce || state !== DEATHS_DOOR_STATE.DYING) return refused(null);
	const watch = deathsDoorRollWatch({ marker, state, me: userId, ownNonce: nonce, holderActive, now });
	if (takeOver) {
		const still = marker?.nonce === nonce && (watch.kind === "orphaned" || watch.kind === "own");
		return still ? { granted: true, holder: null } : refused(watch.marker);
	}
	if (watch.kind === "watch") return refused(watch.marker);
	if (posted && (watch.kind === "orphaned" || watch.kind === "resume")) return refused(watch.marker);
	return { granted: true, holder: null };
}

/**
 * The state as it should be READ, given what the character is now wearing.
 *
 * `fate-pending` means a 6- is on the table and the fate it demands has not been chosen. An
 * insert IS that fate — it is only ever reached by choosing one — so the two together are a
 * contradiction, and the insert is the half that can be trusted: it brought three moves onto the
 * sheet with it, where the state is one flag.
 *
 * They can end up together because taking an insert is two writes, and only the first of them is
 * the insert. A reload between the two (2026-08-08, in play: a Ghost taken, the page refreshed a
 * beat later) left `fate-pending` standing on a character who had already chosen, which told
 * every surface that reads this that Death's Door was still owed — a Ghost at 0 HP was offered
 * the fate fork again instead of Tethered, the move they actually have. The write is one update
 * now (see StonetopCharacter#setPostDeathInsert), so it can't be torn again; this is what heals
 * the sheets it was already torn on, and it costs a comparison.
 *
 * Only that one pairing is reinterpreted. `out-of-action` and `dead` mean what they say on a
 * character with an insert: a dispersed Ghost is out of the action, and having an insert doesn't
 * make it untrue.
 */
export function effectiveDeathsDoorState({ state = null, insertSlug = null } = {}) {
	if (state !== DEATHS_DOOR_STATE.FATE_PENDING) return state;
	return POST_DEATH_INSERT_SLUGS.includes(insertSlug) ? null : state;
}

/**
 * Whether a character is PAST death, and in what way — for anything that wants to show it
 * rather than rule on it. Returns their insert slug ("revenant"/"ghost"/"thrall"), "dead" for
 * one who stepped through the Last Door, or null for the living.
 *
 * The insert wins over the state because it is the more specific answer: a Ghost did die, but
 * "Ghost" is what they are now. In practice the two never overlap — taking an insert at the
 * Door means they came back, which clears the dead state — so the order only decides what a
 * hand-edited sheet reports.
 *
 * Deliberately narrower than "has been at 0 HP": every other DEATHS_DOOR_STATE is a brush with
 * death that can still be walked back. `dying` and `fate-pending` are mid-conversation, and
 * `out-of-action` is unconscious rather than gone.
 */
export function pastDeathKind({ state = null, insertSlug = null } = {}) {
	if (POST_DEATH_INSERT_SLUGS.includes(insertSlug)) return insertSlug;
	return state === DEATHS_DOOR_STATE.DEAD ? "dead" : null;
}

/**
 * Every answer {@link pastDeathKind} can give, for a caller that has to clear the ones that no
 * longer apply as well as set the one that does.
 */
export const PAST_DEATH_KINDS = [...POST_DEATH_INSERT_SLUGS, "dead"];

/**
 * The window classes that carry the Death's Door black — the sheet's own, and any window opened
 * from it. Empty for the living, so a call site can spread this unconditionally.
 *
 * Named here rather than at each window because the pair is a unit: the base class is the whole
 * repaint and the kind modifier only says which tint the paper takes, so a window that got one
 * without the other would come out black with nothing of what brought them back in it.
 *
 * This used to be for the three INSERTS only: a character who simply died was left on parchment,
 * on the reasoning that their sheet is a record of a life and announcing the ending in its own
 * chrome would be in poor taste. The user asked for the black on them too (2026-08-08), which is
 * the call to make — a sheet that has been through the Last Door should say so at a glance, and
 * the dead take the base grey ink with no wash over it, so nothing warms that paper the way the
 * three returns do.
 */
export function pastDeathClasses(kind) {
	return kind ? ["stonetop-past-death", `stonetop-past-death--${kind}`] : [];
}

/**
 * Is this HP change someone being raised? The one transition that walks `dead` back.
 *
 * "There's no saving them. Only the rarest of magic can bring them back" (p.245) — so the rules
 * don't say this can't happen, only that it takes something extraordinary. Which means the system
 * must not decide it silently either way: nothing here clears the state, it only recognises the
 * moment worth ASKING about (see DeathsDoorPrompt's raise prompt). A GM correcting a typo in the
 * HP box and a GM working a resurrection look identical from here.
 */
export function raisedFromDead({ oldHp, newHp, state = null }) {
	return state === DEATHS_DOOR_STATE.DEAD && oldHp <= 0 && newHp > 0;
}

/**
 * How this character rolls Death's Door, given the Heavy's two moves that bend it (p.114).
 *
 *  • HARD TO KILL — "you can roll +CON or +nothing (your choice)", and "on a 7-9, you can
 *    mark a debility of your choice to regain 1 HP".
 *  • UNSTOPPABLE — "roll for Death's Door with a -1 penalty for each circle marked". The
 *    circles are Unstoppable's own resource track, so the penalty is read, not typed.
 *
 * And the Would-Be Hero's two (p.137-138):
 *
 *  • NEVER GONNA KEEP ME DOWN: "Once per session, when you are at Death's Door, don't roll. You
 *    get a 10+." Its one circle is marked when used and cleared at End of Session.
 *  • DESTINED: "Until your destiny is fulfilled, treat a 6- on Death's Door as a 7-9, and a 7-9
 *    as a 10+." Read off the background and its "Destiny fulfilled" box (destined.js).
 *
 * @param {string[]} moveNames        every move name the character has LEARNED (an un-ticked move
 *   bends nothing; see StonetopCharacter#deathsDoorRollOptions)
 * @param {Object<string,number>} moveResources  move-name → marked count
 * @param {{backgroundSlug?: string, setupResources?: object}} [background]  the background taken
 *   and its stored setup tracks
 */
export function deathsDoorRollOptions(moveNames = [], moveResources = {}, background = {}) {
	const has = (name) => moveNames.some(n => n?.toLowerCase() === name.toLowerCase());
	const hardToKill = has(HARD_TO_KILL);
	const marks = has(UNSTOPPABLE) ? Math.max(0, Math.trunc(Number(moveResources?.[UNSTOPPABLE]) || 0)) : 0;
	const neverGonna = has(NEVER_GONNA_KEEP_ME_DOWN);
	const neverGonnaUsed = neverGonna && Number(moveResources?.[NEVER_GONNA_KEEP_ME_DOWN]) > 0;
	return {
		// Offered only while this session's use is still to come; `neverGonnaUsed` says why it is not.
		skipRollMove:   neverGonna && !neverGonnaUsed ? NEVER_GONNA_KEEP_ME_DOWN : null,
		neverGonnaUsed,
		// Who moves the tier up a step, named on the card; null when nobody does.
		tierShift:      destinyUnfulfilled(background ?? {}) ? DESTINED_LABEL : null,
		hardToKill,
		// Which of their own moves opened the choice up, so the dialog can print that move's own
		// words next to it rather than leaving a +CON option to be taken on faith. A NAME, not the
		// prose: this module is fed move names and nothing else, and the description lives on the
		// owned Item (see StonetopCharacter.deathsDoorRollOptions).
		statChoiceMove: hardToKill ? HARD_TO_KILL : null,
		// +nothing stays first: it's the move as written, and the choice is the Heavy's to make.
		statChoices: hardToKill
			? [{ stat: "", label: "+nothing" }, { stat: "con", label: "+CON" }]
			: [{ stat: "", label: "+nothing" }],
		unstoppableMarks: marks,
		// `-marks` alone yields -0 with no circles marked, which reads as "-0" wherever it's
		// printed and is a non-zero `modifier` as far as a `!== 0` test is concerned.
		penalty: marks ? -marks : 0,
	};
}
