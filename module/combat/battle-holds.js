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

// ── THE TRACK ITSELF ────────────────────────────────────────────────────────────────────────────
// The held copy's `resource`. A copy taken before the pack gave these moves their tracks (2026-06-09)
// is filled in once per version by migration/move-refresh.js.

/** A move's HELD count off its track, within its max, or null when this character has no such track. */
const heldOn = learnedTrack;

/**
 * Prepare a Welcome is being rolled: take the Surprise it spends. Returns the note the roll card should
 * carry, or null for any other move, a player's own move of that name among them (owns-move.js#bookMoveName).
 *
 * @returns {Promise<string|null>}
 */
export async function spendSurpriseForRoll(actor, item) {
	if (bookMoveName(item) !== PREPARE_A_WELCOME) return null;
	const track = heldOn(actor, PREPARE_A_WELCOME);
	if (!track) return null;
	if (track.held <= 0) return localize(`${KEY}.noSurprise`);
	await track.resources.setUses(PREPARE_A_WELCOME, track.held - 1, { stonetopMove: PREPARE_A_WELCOME });
	return format(`${KEY}.spentSurprise`, { left: track.held - 1 });
}

/**
 * Prepare a Welcome's 10+: "you've still got a few tricks up your sleeve, regain 1 Surprise".
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
		<input type="checkbox" name="${FIELD}" value="${i}" checked>
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
