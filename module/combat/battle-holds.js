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

import { ownsLearnedMoveNamed, ownedMove } from "../actors/character/owns-move.js";
import { heldOnTrack } from "../actors/character/MoveResources.js";
import { answersFor } from "../hooks/DeathsDoorPrompt.js";
import { postMoveNote } from "../utils/chat.js";
import { themedDialogClasses } from "../utils/window-theme.js";
import { contentElement } from "../dialogs/content-picker.js";
import { escHtml, joinNames } from "../utils/strings.js";
import { format, localize } from "../utils/i18n.js";

const KEY = "stonetop.battleHolds";
const FIELD = "stonetop-battle-hold";

export const PREPARE_A_WELCOME = "Prepare a Welcome";

/** A move's HELD count off its track, within its max, or null when this character has no such track. */
function heldOn(actor, move) {
	if (!ownsLearnedMoveNamed(actor, move)) return null;
	const max = Math.trunc(Number(ownedMove(actor, move)?.system?.resource?.max) || 0);
	const resources = actor.typedActor?.moveResources;
	if (!max || !resources) return null;
	return { held: heldOnTrack(resources, move, max), max, resources };
}

/**
 * Prepare a Welcome is being rolled: take the Surprise it spends. Returns the note the roll card should
 * carry, or null for any other move.
 *
 * @returns {Promise<string|null>}
 */
export async function spendSurpriseForRoll(actor, item) {
	if (item?.name !== PREPARE_A_WELCOME) return null;
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

/** The moves a battle fills, in the order the window lists them, each with its row's language key. */
const HOLD_ROW_KEY = { "Stentorian": "stentorian", "Front Line Leader": "frontLine" };
export const BATTLE_HOLD_MOVES = Object.keys(HOLD_ROW_KEY);

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
export async function askBattleHolds(actor, holds, { DialogV2 = globalThis.foundry?.applications?.api?.DialogV2, document = globalThis.document } = {}) {
	if (!DialogV2 || !document || !holds.length) return [];
	const ticked = form => [...(form?.querySelectorAll?.(`input[name="${FIELD}"]:checked`) ?? [])]
		.map(input => holds[Number(input.value)])
		.filter(Boolean);
	const answer = await DialogV2.wait({
		classes: themedDialogClasses("stonetop-ask"),
		window: { title: format(`${KEY}.title`, { name: actor.name }) },
		content: contentElement(battleHoldsContent(actor, holds), document),
		// Affirmative first, and the default: the move says "hold", and each box can be unticked.
		buttons: [
			{ action: "hold", label: localize(`${KEY}.hold`), icon: "fa-solid fa-flag", default: true, callback: (_event, button) => ticked(button?.form) },
			{ action: "skip", label: localize(`${KEY}.skip`), callback: () => [] },
		],
		rejectClose: false,
	}).catch(() => null);
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
		if (!battleHoldsToFill(actor).length) return;
		if (!answersFor(actor)) return;
		asking.add(actor.id);
		Promise.resolve(offer(actor))
			.catch(err => console.error("Stonetop | offering battle holds failed", err))
			.finally(() => asking.delete(actor.id));
	});
	return () => hooks.off("createCombatant", id);
}
