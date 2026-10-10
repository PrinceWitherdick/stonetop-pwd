/**
 * The Heavy's Unstoppable (the Heavy's playbook sheet; requires Hard to Kill):
 *
 *   "When you are reduced to 0 HP in battle, you can keep fighting. Each time you take damage while
 *    at 0 HP, mark 1. If you would regain HP while fighting, clear one mark instead. When you stop
 *    fighting, roll for Death's Door with a -1 penalty for each circle marked. If you survive,
 *    clear all your circles."
 *
 * The circles are the move's own resource track (MoveResources, keyed by the move's name). Each
 * sentence is kept at the seam it belongs to, and they all ask the predicates here:
 *
 *  • keep fighting ............... keepsFightingAtZero: fight/fight-state.js counts them as a body
 *                                  still in the fight, and combat/readiness-loss.js lets them keep
 *                                  their Readiness
 *  • mark 1 on damage at 0 HP .... a ticked row on the damage card (combat/attack-flow.js)
 *  • clear one mark instead ...... regainInstead, in the HP write's preUpdate (hooks/DeathsDoorPrompt.js)
 *  • the penalty, and the clear .. deaths-door.js#deathsDoorRollOptions and DeathsDoorDialog
 *
 * STILL FIGHTING IS THE DYING STATE: at 0 HP with Death's Door not yet rolled, reduced there in battle
 * (the UNSTOPPABLE_FIGHTING_FLAG stamp, laid at the drop). Rolling it is what "when you stop fighting"
 * asks for, and every state the roll leaves behind is off this track.
 *
 * Rules ask for a LEARNED Unstoppable (owns-move.js#ownsLearnedMoveNamed): one kept on the sheet
 * switched off keeps its circles on show and does nothing with them.
 */

import { MoveResources } from "./MoveResources.js";
import { STONETOP_SCOPE, StonetopFlags, resolvedFlagProperty } from "./StonetopFlags.js";
import {
	DEATHS_DOOR_FLAG, DEATHS_DOOR_STATE, POST_DEATH_INSERT_SLUGS, UNSTOPPABLE, UNSTOPPABLE_FIGHTING_FLAG,
} from "./deaths-door.js";
import { deletionEntry } from "../../utils/foundry-compat.js";
import { inBattle } from "../../fight/in-battle.js";
import { ownedLearnedMove, ownsLearnedMoveNamed } from "./owns-move.js";
import { confirmOutcome } from "../../utils/ask-with-buttons.js";
import { postMoveNote } from "../../utils/chat.js";
import { escHtml } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

/**
 * Document-update options for "clear one mark instead" (see regainInstead). INSTEAD is stamped by
 * the preUpdate that swapped the hit points for a mark, so the committed half can offer them back;
 * REGAIN marks the write that takes that offer, so the preUpdate lets its hit points through.
 */
export const UNSTOPPABLE_INSTEAD_OPTION = "stonetopUnstoppableInstead";
export const UNSTOPPABLE_REGAIN_OPTION  = "stonetopUnstoppableRegain";

/** The circles the sheet prints, for a copy of the move that carries no track size of its own. */
const PRINTED_CIRCLES = 5;

const tracks = actor => new MoveResources(new StonetopFlags(actor, "moves"));

/**
 * Is this character down at 0 HP and still in the fight on Unstoppable's word? A character, with
 * Unstoppable learned, at 0 HP, dying with Death's Door not yet rolled, and reduced to 0 IN BATTLE:
 * "When you are reduced to 0 HP in battle, you can keep fighting" (Book I p.114).
 *
 * "In battle" is read AT THE DROP, not now: the HP write that drops them stamps UNSTOPPABLE_FIGHTING_FLAG
 * when they stood in a fight (fightsOnWhenDropped), and this reads the stamp. So a Heavy who drops with no
 * fight running (a fall, a trap) takes the ordinary road to Death's Door even if a combat starts round them
 * later; one put back on the Door by the GM's fiat after being out of the action was not reduced to 0 in
 * battle by it either; and one who dropped in a fight still fights on once that combat is deleted, until
 * the fight's end hands them the Door (combat/battle-joy-offer.js#actionStops) and lifts the stamp.
 *
 * Not one who carries a post-death insert: their 0-HP move is the insert's own (deaths-door.js
 * #zeroHpMove), and the move defers Death's Door, which is behind them.
 */
export function keepsFightingAtZero(actor) {
	return downOnUnstoppable(actor) && resolvedFlagProperty(actor, UNSTOPPABLE_FIGHTING_FLAG) === true;
}

/**
 * keepsFightingAtZero without the stamp: down at 0 HP, dying, with Unstoppable learned, however they got
 * there. For "If you survive, clear all your circles" (hooks/DeathsDoorPrompt.js#markNotLethal), which
 * clears whatever is marked.
 */
export function downOnUnstoppable(actor) {
	if (actor?.type !== "character") return false;
	if ((Number(actor?.system?.attributes?.hp?.value) || 0) > 0) return false;
	if (resolvedFlagProperty(actor, DEATHS_DOOR_FLAG) !== DEATHS_DOOR_STATE.DYING) return false;
	return holdsUnstoppable(actor);
}

/**
 * keepsFightingAtZero, asked of a character still on their feet: WOULD dropping to 0 HP leave them
 * fighting on? For the write that makes them dying (hooks/DeathsDoorPrompt.js), which decides before the
 * hit points and the state it reads are on the document, and stamps the answer. Here the fight IS read
 * live, since this is the moment of the drop.
 */
export function fightsOnWhenDropped(actor, { combats = globalThis.game?.combats } = {}) {
	return holdsUnstoppable(actor) && inBattle(actor, combats);
}

/** The update fragment that lifts the "fighting on" stamp: they have stopped fighting. Empty when none is laid. */
export function stopFightingUpdate(actor) {
	if (resolvedFlagProperty(actor, UNSTOPPABLE_FIGHTING_FLAG) == null) return {};
	return Object.fromEntries([deletionEntry(`flags.${STONETOP_SCOPE}.${UNSTOPPABLE_FIGHTING_FLAG}`)]);
}

/** A character whose 0-HP move is Death's Door, with Unstoppable learned. */
function holdsUnstoppable(actor) {
	if (actor?.type !== "character") return false;
	if (POST_DEATH_INSERT_SLUGS.includes(resolvedFlagProperty(actor, "postDeathInsert.slug"))) return false;
	return ownsLearnedMoveNamed(actor, UNSTOPPABLE);
}

/** How many of Unstoppable's circles are marked. */
export function unstoppableMarks(actor) {
	return Math.max(0, Math.trunc(Number(tracks(actor).getMoveResources()?.[UNSTOPPABLE]) || 0));
}

/**
 * "If you survive, clear all your circles", as an update fragment to fold into the write that says they
 * survived (the GM's not-lethal ruling, hooks/DeathsDoorPrompt.js#markNotLethal). Empty, with `marks` 0,
 * when none is marked.
 *
 * @returns {{marks: number, update: object}}  how many were marked, and the write that clears them
 */
export function clearCirclesUpdate(actor) {
	const marks = unstoppableMarks(actor);
	return { marks, update: marks ? tracks(actor).usesUpdate(UNSTOPPABLE, 0) : {} };
}

function circlesOf(actor) {
	const max = Math.trunc(Number(ownedLearnedMove(actor, UNSTOPPABLE)?.system?.resource?.max) || 0);
	return max > 0 ? max : PRINTED_CIRCLES;
}

/**
 * "Each time you take damage while at 0 HP, mark 1." The caller has already asked whether it
 * applies (keepsFightingAtZero, before the blow, and the damage card's box). With every circle
 * already marked there is nothing left to mark, and `full` says so rather than writing.
 *
 * @returns {Promise<{marks: number, max: number, full: boolean}>}  the count after
 */
export async function markUnstoppable(actor) {
	const max = circlesOf(actor);
	const now = unstoppableMarks(actor);
	if (now >= max) return { marks: now, max, full: true };
	await tracks(actor).setUses(UNSTOPPABLE, now + 1, { stonetopMove: UNSTOPPABLE });
	return { marks: now + 1, max, full: false };
}

/**
 * "If you would regain HP while fighting, clear one mark instead." Whether this HP change is that,
 * and if so what to write in its place: the mark cleared, as an update fragment to fold into the
 * same write, and the hit points left where they were.
 *
 * Null when it is not: HP not going up, a character not fighting on at 0, or no mark to clear (with
 * none marked there is nothing to do "instead", so the hit points come back as usual).
 *
 * @param {Actor} actor  as it stands BEFORE the write
 * @returns {{hp: number, marks: number, update: object}|null}  `hp` is what they would have
 *   regained to, `marks` what is left marked
 */
export function regainInstead(actor, { oldHp, newHp }) {
	if (!(Number(newHp) > Number(oldHp)) || !keepsFightingAtZero(actor)) return null;
	const marks = unstoppableMarks(actor);
	if (!marks) return null;
	return { hp: Number(newHp), marks: marks - 1, update: tracks(actor).usesUpdate(UNSTOPPABLE, marks - 1) };
}

/**
 * The committed half of regainInstead: the mark is already cleared, and this offers the hit points
 * back, asked of whoever made the change (the raise prompt's reasoning in hooks/DeathsDoorPrompt.js:
 * `updateActor` fires everywhere, and the one who healed them is the one who can answer).
 *
 * The book's way is the default and the first button, and closing the window keeps it: the clause
 * the sheet cannot check is whether they are still in the fight, and the ordinary case for a Heavy
 * fighting on at 0 HP is that they are. Either answer is said in chat.
 */
export function onUpdateActorUnstoppable(actor, _changes, options = {}, userId = null) {
	const instead = options?.[UNSTOPPABLE_INSTEAD_OPTION];
	if (actor?.type !== "character" || !instead) return;
	if (userId && userId !== globalThis.game?.user?.id) return;
	return offerRegain(actor, instead).catch(err => console.error("Stonetop | Unstoppable could not offer the HP back:", err));
}

async function offerRegain(actor, { hp, marks }) {
	const name = actor.name ?? "This character";
	const keep = await confirmOutcome({
		title:   localize("stonetop.unstoppable.insteadTitle"),
		content: `<p>${escHtml(format("stonetop.unstoppable.insteadAsk", { name, hp, marks }))}</p>`,
		yes:     { label: localize("stonetop.unstoppable.insteadKeep"), icon: "fa-shield-halved" },
		no:      { label: localize("stonetop.unstoppable.insteadRegain"), icon: "fa-heart" },
		defaultYes: true,
	});
	if (keep === false) {
		await actor.update(
			{ "system.attributes.hp.value": hp, ...tracks(actor).usesUpdate(UNSTOPPABLE, marks + 1) },
			{ [UNSTOPPABLE_REGAIN_OPTION]: true, stonetopMove: UNSTOPPABLE },
		);
		await postMoveNote(actor, UNSTOPPABLE, format("stonetop.unstoppable.regainedNote", { name, hp }));
		return;
	}
	await postMoveNote(actor, UNSTOPPABLE, format("stonetop.unstoppable.insteadNote", { name, marks }));
}
