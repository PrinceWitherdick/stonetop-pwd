// A steading-stat roll's miss marks XP for whoever made the move.
//
// Book I p.209: "On a 6 or less, it's a miss. That means: They mark XP", and p.560: "Most moves don't
// say what happens on 6-, which means that the player marks XP". Only Trade & Barter, Requisition and
// Seasons Change say "don't mark XP" (p.77-83), and each carries `noXpOnMiss` on its entry in the
// steading's move list (StonetopSteadingSheet.js), so Muster, Pull Together, Deploy, the improvements'
// own moves and any move added later earn it. But the roll is made on the STEADING, which has no XP, so nothing knows whose it
// is: the miss's card carries a "Mark XP" button for the rolling user's own character, and a second to
// choose somebody else (a GM, who plays nobody, always chooses).
//
// The mark is the ordinary miss receipt, Undo and all, tied to the card (roll-engine.js#markMissXpByChoice)
// so a Shift that lifts the card off the miss takes it back and offers the buttons again. It is written on
// the card's writer, in the card's turn, where every rewrite of the card runs.

import { SYSTEM_ID } from "../../system-id.js";
import { markMissXpByChoice } from "../../utils/roll-engine.js";
import { pressRollCard, registerRollCardAction } from "../../utils/roll-card-writer.js";
import { inCardTurn } from "../../utils/card-queue.js";
import { cardCountedTier, ROLLED_FLAG } from "../../utils/counted-tier.js";
import { MISS_XP_ACTOR_FLAG } from "../../utils/undo-xp-mark.js";
import { canUserWriteCard } from "../../utils/chat.js";
import { getPlayerCharacters } from "../../utils/playbook-actors.js";
import { isOutOfPlay } from "../character/deaths-door-actor.js";
import { pickPersonOnMap } from "../../dialogs/RelationshipLinkDialog.js";
import { addTierActions, wireChooseThenWrite } from "./steading-card-actions.js";
import { escHtml, stripHtmlToText } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

const KEY = "stonetop.steading.missXp";

/** The roll card action that marks a steading miss's XP on the card's writer. */
export const STEADING_MISS_XP_ACTION = "steadingMissXp";

/** The miss tier's buttons: "Mark XP" for the rolling user's character, and one to choose who. */
export function steadingMissXpButtons() {
	return `<div class="card-buttons stonetop-roll-actions stonetop-steading-miss-xp-row">`
		+ `<button type="button" class="stonetop-steading-miss-xp" data-steading-xp="mine" data-tooltip="${escHtml(localize(`${KEY}.buttonTooltip`))}" data-tooltip-direction="UP">`
		+ `<i class="fas fa-star"></i> ${escHtml(localize(`${KEY}.button`))}</button>`
		+ `<button type="button" class="stonetop-steading-miss-xp" data-steading-xp="pick" data-tooltip="${escHtml(localize(`${KEY}.pickTooltip`))}" data-tooltip-direction="UP">`
		+ `<i class="fas fa-user"></i> ${escHtml(localize(`${KEY}.pick`))}</button>`
		+ `</div>`;
}

/**
 * `tierActions` with the miss's XP buttons appended to its failure tier, or as it is (null stays null)
 * for a move whose 6- says "don't mark XP" (`noXpOnMiss`, the name rollStat and the arcana parser use).
 */
export function withSteadingMissXp(tierActions = null, { noXpOnMiss = false } = {}) {
	if (noXpOnMiss) return tierActions;
	return addTierActions(tierActions, { failure: steadingMissXpButtons() });
}

/** The character "Mark XP" marks for `user` without asking: their own, and nobody for a GM. */
export function defaultSteadingXpActor(user) {
	if (!user || user.isGM) return null;
	const own = user.character;
	return own?.type === "character" && !isOutOfPlay(own) ? own : null;
}

/**
 * Ask which character made the move, through the people chooser (RelationshipLinkDialog.js#pickPersonOnMap),
 * the player's own picked to start with. Null when closed or there is nobody to name.
 */
export async function pickSteadingXpActor(user, pick = pickPersonOnMap) {
	const people = getPlayerCharacters().filter(actor => !isOutOfPlay(actor));
	if (!people.length) {
		globalThis.ui?.notifications?.warn?.(localize(`${KEY}.nobody`));
		return null;
	}
	const own = defaultSteadingXpActor(user);
	const id = await pick({
		options:  people.map(actor => ({ id: actor.id, name: actor.name, actor })),
		selected: [own?.id ?? people[0].id],
		title:    localize(`${KEY}.pickTitle`),
		hint:     stripHtmlToText(localize(`${KEY}.pickPrompt`)),
		icon:     "fa-star",
	});
	return id ? people.find(actor => actor.id === id) ?? null : null;
}

/**
 * The card writer's half: mark `data.actorId`'s XP for this card's miss, once, for the user who rolled it or
 * a GM. Refused (null) when the card no longer counts as a miss or its XP is already marked.
 */
export function handleSteadingMissXp({ message: card, user, data }) {
	const actor = globalThis.game?.actors?.get?.(data?.actorId) ?? null;
	if (actor?.type !== "character") return null;
	if (!user?.isGM && card?.author?.id !== user?.id) return null;
	return inCardTurn(card, async () => {
		if (card.getFlag(SYSTEM_ID, MISS_XP_ACTOR_FLAG)) return null;
		if (cardCountedTier(card, card.rolls?.at?.(0)?.total, SYSTEM_ID) !== "failure") return null;
		const move = card.getFlag(SYSTEM_ID, ROLLED_FLAG)?.move ?? "";
		await markMissXpByChoice(card, actor, move, { naming: true });
		return { marked: actor.id };
	});
}
registerRollCardAction(STEADING_MISS_XP_ACTION, handleSteadingMissXp);

/**
 * Wire a steading miss's XP buttons (stonetop.js renderChatMessageHTML). Once marked, the row says for whom;
 * only the user who rolled, or a GM, gets the buttons. Safe on every render.
 */
export function wireSteadingMissXp(message, html, { pick = pickPersonOnMap } = {}) {
	const root = html?.[0] ?? html;
	const row = root?.querySelector?.(".stonetop-steading-miss-xp-row");
	if (!row) return;
	const markedFor = message?.getFlag?.(SYSTEM_ID, MISS_XP_ACTOR_FLAG);
	if (markedFor) {
		const name = globalThis.game?.actors?.get?.(markedFor)?.name ?? "";
		row.innerHTML = `<p class="stonetop-steading-miss-xp-done">${format(`${KEY}.marked`, { name: escHtml(name) })}</p>`;
		return;
	}
	const user = globalThis.game?.user;
	if (!canUserWriteCard(message, user, { whenUnknown: !!user?.isGM })) { row.remove(); return; }
	wireChooseThenWrite([...row.querySelectorAll("[data-steading-xp]")], {
		what: "Could not mark a steading miss's XP",
		choose: async btn => (btn.dataset.steadingXp === "mine" ? defaultSteadingXpActor(user) : null)
			?? await pickSteadingXpActor(user, pick),
		write: async actor => {
			const out = await pressRollCard(message, STEADING_MISS_XP_ACTION, { actorId: actor.id });
			if (!out) globalThis.ui?.notifications?.warn?.(localize(`${KEY}.refused`));
			return !!out;
		},
	});
}
