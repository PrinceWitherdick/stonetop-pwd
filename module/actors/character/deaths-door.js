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
 *  • How the Heavy's moves bend the Death's Door roll (Book I p.113): Hard to Kill offers
 *    +CON or +nothing and a 7-9 escape hatch, Unstoppable defers the roll and charges -1 per
 *    circle marked.
 */

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

/** Move names the routing and roll rules key off, so no caller retypes the literals. */
export const HARD_TO_KILL  = "Hard to Kill";
export const UNSTOPPABLE   = "Unstoppable";

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
			+ "place of the GM's choosing. Clear the state on your Special Moves tab when you're back.",
		effects: [
			{ kind: "mark-gain",     label: "Gain a Mark of the GM's choice" },
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
 * How this character rolls Death's Door, given the Heavy's two moves that bend it (p.113).
 *
 *  • HARD TO KILL — "you can roll +CON or +nothing (your choice)", and "on a 7-9, you can
 *    mark a debility of your choice to regain 1 HP".
 *  • UNSTOPPABLE — "roll for Death's Door with a -1 penalty for each circle marked". The
 *    circles are Unstoppable's own resource track, so the penalty is read, not typed.
 *
 * @param {string[]} moveNames        every move name the character owns
 * @param {Object<string,number>} moveResources  move-name → marked count
 */
export function deathsDoorRollOptions(moveNames = [], moveResources = {}) {
	const has = (name) => moveNames.some(n => n?.toLowerCase() === name.toLowerCase());
	const hardToKill = has(HARD_TO_KILL);
	const marks = has(UNSTOPPABLE) ? Math.max(0, Math.trunc(Number(moveResources?.[UNSTOPPABLE]) || 0)) : 0;
	return {
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
