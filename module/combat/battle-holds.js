// The Marshal's holds that a battle fills: Stentorian's "When you go into battle, hold 2 Command" and
// Front Line Leader's "When you lead your crew into battle, hold 2 Presence".
//
// GOING INTO BATTLE IS JOINING A FIGHT. A character added to a combat (the Fight tab starting one or
// adding to it, or core's tracker) is going into battle, so that is when this asks. Asked, not simply
// filled: Front Line Leader wants a crew led in, which the sheet cannot see, so each hold is a ticked
// box the player can untick (the house rule for a clause the sheet cannot check).
//
// Both tracks already live on the moves (data/playbook-moves.json `resource`) and count what is HELD
// (actors/character/MoveResources.js), so holding the full amount is ticking every pip. A track
// already full asks nothing, which is also what keeps a second token for the same Marshal quiet.
//
// Asked on the Marshal's own screen, picked the way Death's Door picks it.
//
// AND THE ONE THE MARSHAL SPENDS BY ROLLING: Prepare a Welcome's "Once battle is joined, spend 1
// Surprise to reveal a ploy ... and roll +INT: on a 10+ ... regain 1 Surprise". Rolling the move IS the
// spend, so the pip comes off as it is rolled and one goes back on a 10+. A Marshal holding none still
// rolls (a sheet flags, it never blocks), and the card says the Surprise was not there.

import { bookMoveName, ownsLearnedMoveNamed, ownedMove } from "../actors/character/owns-move.js";
import { heldOnTrack, learnedTrack, takeBackHeld } from "../actors/character/MoveResources.js";
import { answersFor } from "../hooks/DeathsDoorPrompt.js";
import { postMoveNote } from "../utils/chat.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { contentElement } from "../utils/dialogv2-content.js";
import { escHtml, joinNames } from "../utils/strings.js";
import { format, localize } from "../utils/i18n.js";
import { HERO_MOVES } from "../fight/hero-moves.js";
import { commandHolders, deployCommandOffers } from "./command-holders.js";

const KEY = "stonetop.battleHolds";
const FIELD = "stonetop-battle-hold";

export const PREPARE_A_WELCOME = "Prepare a Welcome";

/** The moves a battle fills, in the order the window lists them, each with its row's language key. */
const HOLD_ROW_KEY = { "Stentorian": "stentorian", "Front Line Leader": "frontLine" };
export const BATTLE_HOLD_MOVES = Object.keys(HOLD_ROW_KEY);

/**
 * Every hold that is for ONE battle: the two a battle fills, and the Surprise lain in wait for it. The fight
 * ending clears them (clearFightHolds, run by combat/readiness-loss.js), so last fight's Command cannot buy
 * advantage on a Deploy weeks later (the user's ruling, 2026-10-18).
 */
export const FIGHT_HOLD_MOVES = Object.freeze([...BATTLE_HOLD_MOVES, PREPARE_A_WELCOME]);

// ── THE TRACK ITSELF ────────────────────────────────────────────────────────────────────────────
// The held copy's `resource`. A copy taken before the pack gave these moves their tracks (2026-06-09)
// is filled in once per version by migration/move-refresh.js.

/** A move's HELD count off its track, within its max, or null when this character has no such track. */
const heldOn = learnedTrack;

/**
 * Prepare a Welcome is being rolled: take the Surprise it spends. Returns the note the roll card should
 * carry and whether a Surprise came off (a roll that spent none regains none on its 10+: tier-effects.js),
 * or null for any other move, a player's own move of that name among them (owns-move.js#bookMoveName).
 *
 * @returns {Promise<{note: string, spent: boolean}|null>}
 */
export async function spendSurpriseForRoll(actor, item) {
	if (bookMoveName(item) !== PREPARE_A_WELCOME) return null;
	const track = heldOn(actor, PREPARE_A_WELCOME);
	if (!track) return null;
	if (track.held <= 0) return { note: localize(`${KEY}.noSurprise`), spent: false };
	await track.resources.setUses(PREPARE_A_WELCOME, track.held - 1, { stonetopMove: PREPARE_A_WELCOME });
	return { note: format(`${KEY}.spentSurprise`, { left: track.held - 1 }), spent: true };
}

/**
 * Put back the Surprise spendSurpriseForRoll took for a roll that then threw no dice (the roll failed or came to
 * nothing): it was never spent. Never past the track. A roll that landed keeps it spent, a 6- included.
 *
 * @returns {Promise<boolean>} whether one went back on
 */
export async function refundSurpriseForRoll(actor) {
	const track = heldOn(actor, PREPARE_A_WELCOME);
	if (!track || track.held >= track.max) return false;
	await track.resources.setUses(PREPARE_A_WELCOME, track.held + 1, { stonetopMove: PREPARE_A_WELCOME });
	return true;
}

/**
 * Prepare a Welcome's 10+: "you've still got a few tricks up your sleeve, regain 1 Surprise". Only for a
 * roll that spent one: the caller (tier-effects.js) asks it only then.
 *
 * @returns {Promise<boolean>} whether one went back on
 */
export async function regainSurpriseOnHit(actor, item, tier) {
	if (item?.name !== PREPARE_A_WELCOME || tier !== "success") return false;
	const track = heldOn(actor, PREPARE_A_WELCOME);
	if (!track || track.held >= track.max) return false;
	await track.resources.setUses(PREPARE_A_WELCOME, track.held + 1, { stonetopMove: PREPARE_A_WELCOME });
	return true;
}

/**
 * Take back Surprise a 10+ gave, when the card is moved off it (actors/character/tier-effects.js): never
 * below none, so a Surprise spent since is not taken twice.
 *
 * @returns {Promise<number>} how many came off
 */
export function takeBackSurprise(actor, count) {
	return takeBackHeld(actor, PREPARE_A_WELCOME, count);
}

// ── LYING IN WAIT ───────────────────────────────────────────────────────────────────────────────
// "When you have your allies fortify a position and lie in wait for battle, hold 1 Surprise if you're rushed
// or 2 Surprises if you can take your time" (Book I p.126). Two buttons on the learned move's card
// (move-group.hbs, `stonetop.moveActions`): each SETS what is held to at least its number, never past 2, so
// pressing one twice holds no more and Surprise already held is never lowered.

/** Each button's action key and the Surprise it holds. */
const LIE_IN_WAIT = Object.freeze({ lieInWaitRushed: 1, lieInWaitPrepared: 2 });
const LIE_IN_WAIT_MAX = 2;

/** Whether a move card's button is one of the lie-in-wait buttons (the sheet routes the rest elsewhere). */
export const isLieInWaitAction = action => Object.hasOwn(LIE_IN_WAIT, action);

/** What lying in wait with `n` would leave held: at least `n`, within 2 and the track, never less than now. */
const surpriseAfterLyingInWait = (track, n) => Math.max(track.held, Math.min(n, LIE_IN_WAIT_MAX, track.max));

/**
 * The lie-in-wait buttons for the move cards on this character's sheet, keyed by move name as move-group.hbs
 * looks them up: `{ label, icon, action, disabled, tooltip }` each. Only with Prepare a Welcome learned; a
 * button that would hold no more is disabled.
 */
export function lieInWaitActionsFor(actor) {
	const track = heldOn(actor, PREPARE_A_WELCOME);
	if (!track) return {};
	return {
		[PREPARE_A_WELCOME]: Object.entries(LIE_IN_WAIT).map(([action, n]) => {
			const disabled = surpriseAfterLyingInWait(track, n) <= track.held;
			return {
				action,
				icon:    "fas fa-chess-rook",
				label:   localize(`${KEY}.lieInWait.${action}.label`),
				tooltip: disabled ? format(`${KEY}.lieInWait.full`, { held: track.held }) : localize(`${KEY}.lieInWait.${action}.tooltip`),
				disabled,
			};
		}),
	};
}

/**
 * Lie in wait: hold the Surprise the button names, and say so in chat. Whether anything was held (nothing for a
 * character without the move learned, or one already holding that much).
 *
 * @param {Actor} actor
 * @param {string} action  a LIE_IN_WAIT key
 * @returns {Promise<boolean>}
 */
export async function lieInWait(actor, action) {
	const n = LIE_IN_WAIT[action];
	if (!n || actor?.isOwner === false) return false;
	const track = heldOn(actor, PREPARE_A_WELCOME);
	if (!track) return false;
	const next = surpriseAfterLyingInWait(track, n);
	if (next <= track.held) return false;
	await track.resources.setUses(PREPARE_A_WELCOME, next, { stonetopMove: PREPARE_A_WELCOME });
	await postMoveNote(actor, PREPARE_A_WELCOME, format(`${KEY}.lieInWait.${action}.note`, { name: actor.name ?? "", held: next }));
	return true;
}

// ── THE FIGHT ENDS ──────────────────────────────────────────────────────────────────────────────

/**
 * The `actor.update()` data that empties this character's fight holds (FIGHT_HOLD_MOVES), each only when it
 * holds any: `{}` when there is nothing to clear. Read off the stored tracks, learned or not, so a move
 * switched off since the fight still lets its hold go. A player's own move keeps its track under its item
 * id, not the book's name, so it is not touched.
 */
export function fightHoldsClearData(actor) {
	const resources = actor?.typedActor?.moveResources;
	const stored = resources?.getMoveResources?.() ?? {};
	const data = {};
	for (const move of FIGHT_HOLD_MOVES) {
		if (Number(stored[move]) > 0) Object.assign(data, resources.usesUpdate(move, 0));
	}
	return data;
}

/**
 * Clear a character's fight holds in ONE write. Whether there was anything to clear.
 *
 * @returns {Promise<boolean>}
 */
export async function clearFightHolds(actor) {
	const data = fightHoldsClearData(actor);
	if (!Object.keys(data).length) return false;
	await actor.update(data);
	return true;
}

/**
 * The holds this character could top up right now: a learned move with a track, not full.
 * PURE apart from reading the actor.
 *
 * @returns {{move: string, title: string, max: number, held: number}[]}
 */
export function battleHoldsToFill(actor) {
	if (actor?.type !== "character") return [];
	const resources = actor.typedActor?.moveResources;
	const holds = [];
	for (const move of BATTLE_HOLD_MOVES) {
		if (!ownsLearnedMoveNamed(actor, move)) continue;
		const resource = ownedMove(actor, move)?.system?.resource;
		const max = Math.trunc(Number(resource?.max) || 0);
		if (!max) continue;
		const held = heldOnTrack(resources, move, max);
		if (held < max) holds.push({ move, title: resource.title || move, max, held });
	}
	return holds;
}

/** The window's body: one ticked box per hold, each quoting its move's trigger. */
export function battleHoldsContent(actor, holds) {
	const rows = holds.map((hold, i) => `<label class="stonetop-battle-hold-row">
		<input type="checkbox" class="stonetop-battle-hold-check" name="${FIELD}" value="${i}" checked>
		<span><strong>${escHtml(hold.move)}:</strong> ${escHtml(format(`${KEY}.row.${HOLD_ROW_KEY[hold.move]}`, { max: hold.max, title: hold.title }))}</span>
	</label>`).join("");
	return `<p>${escHtml(format(`${KEY}.ask`, { name: actor.name }))}</p>${rows}`;
}

/**
 * Ask which holds to fill. Resolves to the ticked ones, or [] when closed or declined.
 */
export async function askBattleHolds(actor, holds, { document = globalThis.document } = {}) {
	if (!document || !holds.length) return [];
	const ticked = form => [...(form?.querySelectorAll?.(`input[name="${FIELD}"]:checked`) ?? [])]
		.map(input => holds[Number(input.value)])
		.filter(Boolean);
	const answer = await askWithButtons({
		title: format(`${KEY}.title`, { name: actor.name }),
		content: contentElement(battleHoldsContent(actor, holds), document),
		// Affirmative first, and the default: the move says "hold", and each box can be unticked.
		buttons: [
			{ key: "hold", label: localize(`${KEY}.hold`), icon: "fa-flag", value: ticked },
			{ key: "skip", label: localize(`${KEY}.skip`), value: [] },
		],
	});
	return Array.isArray(answer) ? answer : [];
}

/**
 * A character has gone into battle: offer to fill their battle holds, fill the ones ticked, and say so.
 *
 * @returns {Promise<string[]>} the moves whose holds were filled
 */
export async function offerBattleHolds(actor, { ask = askBattleHolds } = {}) {
	const holds = battleHoldsToFill(actor);
	if (!holds.length) return [];
	const picked = await ask(actor, holds);
	const resources = actor.typedActor?.moveResources;
	if (!picked.length || !resources) return [];
	for (const hold of picked) await resources.setUses(hold.move, hold.max, { stonetopMove: hold.move });
	const held = joinNames(picked.map(hold => `${hold.max} ${hold.title}`));
	await postMoveNote(actor, localize(`${KEY}.cardTitle`), format(`${KEY}.held`, { name: actor.name, held }));
	return picked.map(hold => hold.move);
}

// ── STENTORIAN'S "ADVANTAGE TO ... DEPLOY" ─────────────────────────────────────────────────────────
// "Spend 1 Command to shout an order or warning and pick 1: ... You have advantage to Order Followers or
// Deploy" (Book I p.127). "You have advantage": the advantage is the Marshal's own, so it rides a Deploy only
// that Marshal makes. Deploy is the STEADING's roll, so its window asks, UNTICKED, naming one Marshal: the
// user's own character when they are a Marshal holding Command, or else a pick among the Marshals this user may
// write who hold any (a GM, or a player rolling for someone else's Deploy). The Command comes off THAT Marshal
// before the dice, and a spend that fails gives no advantage (deployCommandAnswers, which the Deploy window's
// question runs as its `spend`: actors/steading/improvement-rolls.js). Order Followers' half is a
// box in that window (OrderFollowersDialog.js).

// Who holds Command lives in command-holders.js, light enough for the steading sheet to load; here for the
// callers that already ask this module.
export { commandHolders, deployCommandOffers };

/**
 * Spend 1 Command for a Deploy off the Marshal `marshalId` names, while this user may write them and they hold
 * any. Answers their name, or null when it could not be spent.
 */
export async function spendCommandForDeploy(marshalId, actors = globalThis.game?.actors) {
	const marshal = marshalId ? commandHolders(actors).find(actor => actor.id === marshalId) : null;
	if (!marshal) return null;
	return (await takeBackHeld(marshal, HERO_MOVES.STENTORIAN, 1)) ? marshal.name ?? "" : null;
}

/**
 * Deploy's window answers with the Stentorian line taken: spend the Command off the Marshal it named, and hand
 * back the answers the roll is adjusted by. A spend that fails clears `command`, so the roll gets no advantage
 * it did not pay for, and `commandRefused` names why for the caller to say.
 *
 * @returns {Promise<object>} the answers, `command` cleared when nothing was spent
 */
export async function deployCommandAnswers(answers = {}, { actors = globalThis.game?.actors, spend = spendCommandForDeploy } = {}) {
	if (!answers?.command) return answers;
	const name = await spend(String(answers.command), actors);
	if (name !== null && name !== undefined) return { ...answers, command: name || "yes" };
	return { ...answers, command: "", commandRefused: true };
}

// Whose question is open on this client: two tokens for one Marshal join together.
const asking = new Set();

/**
 * Ask a Marshal joining a fight whether they take up their battle holds.
 *
 * @param {{hooks?: object, offer?: typeof offerBattleHolds}} [deps]
 * @returns {() => void} stops listening
 */
export function installBattleHolds({ hooks = globalThis.Hooks, offer = offerBattleHolds } = {}) {
	const id = hooks.on("createCombatant", combatant => {
		const actor = combatant?.actor;
		if (actor?.type !== "character" || asking.has(actor.id)) return;
		if (!BATTLE_HOLD_MOVES.some(move => ownsLearnedMoveNamed(actor, move))) return;
		if (!answersFor(actor)) return;
		asking.add(actor.id);
		Promise.resolve(offer(actor))
			.catch(err => console.error("Stonetop | offering battle holds failed", err))
			.finally(() => asking.delete(actor.id));
	});
	return () => hooks.off("createCombatant", id);
}
