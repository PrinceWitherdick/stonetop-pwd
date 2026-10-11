import { SYSTEM_ID } from "../system-id.js";
import { asArray, getPlayerCharacters, playsCharacter, whisperFor } from "../utils/playbook-actors.js";
import { isOutOfPlay } from "../actors/character/deaths-door-actor.js";
import { pickPersonOnMap } from "../dialogs/RelationshipLinkDialog.js";
import { moveChatCard } from "../utils/chat.js";
import { MOVE_TIERS_CLASS, TIER_KEYS } from "../utils/move-results.js";
import { markXpReceipt } from "../utils/roll-engine.js";
import { adjustXp } from "../utils/xp.js";
import { XP_MARK_FLAG, XP_UNDONE_FLAG } from "../utils/undo-xp-mark.js";
import { speakerActor } from "../utils/speaker-actor.js";
import { escHtml } from "../utils/strings.js";
import { currentChatMode } from "../utils/foundry-compat.js";
import {
	AID_MOVE, INTERFERE_MOVE, PERSUADE_PC_MOVE, PC_ANSWER_FLAG, PC_ASK_FLAG,
	aidLead, answerCardBody, answerListHtml, answerRowHtml, askPill, findPcAnswer, heldSource,
	isPcAskMove, mayAnswer, offersChoice, pcAskFor, persuadeTierActions, pickerText,
} from "./pc-ask-rules.js";

// The Foundry half of Aid, Interfere and Persuade (vs. PCs): asking who the move is aimed at,
// posting the card that asks them (or the GM), and settling the answer. The rules and every word
// are in pc-ask-rules.js.
//
// NO SOCKET, NO GM RELAY. Whoever answers posts a card of their own, spoken as the character the
// question was put to, stamped with the asking card's id. Foundry only lets a message's author or a
// GM change it, so a player answering another player's card could never have written it; a card of
// their own they can always post. The asking card then reads its answer off the log each time it is
// drawn, and every client redraws it when an answer arrives or is deleted. What the answer DOES is
// written by the answering client to the character it answers for, which that user owns (a player's
// own character, or any character for the GM).

const readAsk = message => message?.getFlag?.(SYSTEM_ID, PC_ASK_FLAG) ?? null;
const readAnswer = message => message?.getFlag?.(SYSTEM_ID, PC_ANSWER_FLAG) ?? null;

/** The answer already given to this card, if any. */
export function answerTo(message) {
	return findPcAnswer(game.messages ?? [], message?.id, readAnswer);
}

/**
 * Everyone this character could aim the move at: the other player characters, less whoever has left
 * play (deaths-door-actor.js#isOutOfPlay, a Ghost lost to the Final Consequence included). A Ghost or a
 * Revenant still in play is somebody you can help or get in the way of.
 */
export function aimableCharacters(actor) {
	return getPlayerCharacters().filter(other => other.id !== actor?.id && !isOutOfPlay(other));
}

const allUsers = () => asArray(game.users);

/** The player a character belongs to, as the picker's line under their name. */
function playedBy(actor) {
	const player = allUsers().find(user => !user.isGM && user.character?.id === actor.id);
	return player ? `Played by ${player.name}` : "";
}

/** The user who made the move: the asking card's author. Null when the card does not say. */
function askerOf(message) {
	return message?.author?.id ?? null;
}

/**
 * Whether a player who PLAYS this character is logged in, and so answers for them ("ask their player",
 * p.226). Plays, not merely owns (playbook-actors.js#playsCharacter): at a table where every player owns every
 * sheet, the one who made the move would otherwise answer for the character they aimed it at. The asker
 * never answers their own question.
 */
function playerHere(actor, askerId = null) {
	return !!actor && allUsers().some(user => user.active && !user.isGM && user.id !== askerId && playsCharacter(actor, user));
}

/**
 * Whether the roller's chat mode keeps the card from the table (GM only, blind, or self), in either
 * core's spelling (foundry-compat.js#currentChatMode). An in-character or public mode, or one that cannot
 * be read, is not private.
 */
function chatModeIsPrivate() {
	return ["gm", "blind", "self", "gmroll", "blindroll", "selfroll"].includes(currentChatMode());
}

/**
 * Ask who the move is aimed at.
 *
 * @returns {Promise<Actor|null|undefined>} the character; null when the question was closed without
 *   an answer; undefined when there was nobody to ask about, so the caller goes on without one.
 */
export async function pickAimedCharacter(actor, moveName) {
	const words = pickerText(moveName);
	const others = aimableCharacters(actor);
	if (!words || !others.length) return undefined;
	const id = await pickPersonOnMap({
		options: others.map(other => ({ id: other.id, name: other.name, actor: other, hint: playedBy(other) })),
		title: words.title,
		hint: words.hint,
		icon: words.icon,
		// Until somebody is picked, when it names them ("Help Bram"). The picker's own default says "Add".
		buttonLabel: "Choose someone",
		formatLabel: words.button,
	});
	if (!id) return null;
	return others.find(other => other.id === id) ?? null;
}

/** The asking card's flag. Names kept beside the ids, so a card outlives a renamed or deleted actor. */
function askFlag(move, by, target) {
	return { move, byId: by.id, byName: by.name, targetId: target.id, targetName: target.name };
}

/**
 * Before an Interfere or a Persuade (vs. PCs) is rolled: who is it aimed at?
 *
 * Called from StonetopCharacter#onRoll, after the stat and the pre-roll prompt and before the dice,
 * so every way of making the move asks it: the Moves tab, the hotbar and a guided move alike.
 *
 * @returns {Promise<null|"cancel"|object>} extra roll options (the card's flag, Persuade's answer
 *   rows, a pill naming the target, and Interfere's printed list left as prose for the answer to be
 *   drawn in); null for a move that asks nobody, or when there is nobody to ask; "cancel" when the
 *   question was closed, which rolls nothing.
 */
export async function aimPcAskRoll(actor, item) {
	const move = item?.name;
	if (move !== INTERFERE_MOVE && move !== PERSUADE_PC_MOVE) return null;
	// A player's own move that only shares the name acts as itself, as it does for Aid.
	if (!isPcAskMove(item)) return null;
	if (actor?.type !== "character") return null;
	const target = await pickAimedCharacter(actor, move);
	if (target === undefined) return null;
	if (!target) return "cancel";
	const ask = askFlag(move, actor, target);
	return {
		messageFlags: { [SYSTEM_ID]: { [PC_ASK_FLAG]: ask } },
		conditionNotes: [askPill(ask)],
		// Interfere answers in its own printed list, so the list stays prose on the card rather than
		// becoming a row of tick boxes the foiled player could not tick (the card is not theirs).
		...(move === INTERFERE_MOVE ? { pickable: false } : { tierActions: persuadeTierActions(ask) }),
		// The question is the target's player's to answer (p.218, p.226), so a GM-only, blind or self roll
		// still reaches them (roll-engine.js#rollStat's whisper); a public roll goes out as it always has.
		// A private card goes to every GM, and whoever plays the character it is aimed at.
		...(chatModeIsPrivate() ? { whisper: whisperFor(target) } : {}),
	};
}

/**
 * Aid, from the sheet or the hotbar: ask whom, then post the card the GM answers on.
 *
 * @param {Actor} actor  the helper
 * @param {Item} item    their Aid move
 * @returns {Promise<boolean>} true when the move was handled here (posted or backed out of); false
 *   when it is not the Aid move, or there was nobody to help, and the caller should post the move
 *   as it always has.
 */
export async function beginAid(actor, item) {
	if (item?.name !== AID_MOVE || !isPcAskMove(item)) return false;
	const target = await pickAimedCharacter(actor, AID_MOVE);
	if (target === undefined) return false;
	if (!target) return true;
	const ask = askFlag(AID_MOVE, actor, target);
	await ChatMessage.create({
		content: moveChatCard(AID_MOVE,
			`<p class="stonetop-pc-ask-lead">${escHtml(aidLead(ask))}</p>${item?.system?.description ?? ""}`),
		speaker: ChatMessage.getSpeaker({ actor }),
		flags: { [SYSTEM_ID]: { move: AID_MOVE, [PC_ASK_FLAG]: ask } },
	});
	return true;
}

/**
 * The card's result tier, read off its drawn result block; null for a card with none (Aid).
 *
 * A card shifted up to 12+ is drawn `critical` (counted-tier.js `totalTier`), which is a
 * 10+ to every move here, as it is to the shift's own tier rows.
 */
function cardTier(html) {
	const result = html.querySelector?.(".stonetop-roll-result");
	if (!result) return null;
	if (result.classList.contains("critical")) return "success";
	return TIER_KEYS.find(tier => result.classList.contains(tier)) ?? null;
}

/** Whether this client's user may answer this card: they play its target (and can write them), and did not ask it. */
function userMayAnswer(ask, message) {
	const target = game.actors?.get?.(ask.targetId) ?? null;
	const me = game.user ?? null;
	const asker = askerOf(message);
	const playsTarget = !!target?.isOwner && !!me && me.id !== asker && playsCharacter(target, me);
	return mayAnswer(ask, { isGM: !!me?.isGM, ownsTarget: playsTarget, playerHere: playerHere(target, asker) });
}

/**
 * Draw an asking card: its buttons for whoever answers, who is deciding for everyone else, or the
 * answer once it is given. Dispatched from stonetop.js renderChatMessageHTML; a no-op on any other
 * card.
 */
export function wirePcAskCard(message, html) {
	const ask = readAsk(message);
	if (!ask || !pcAskFor(ask.move) || !html?.querySelector) return;
	const answered = answerTo(message)?.choice ?? null;
	const canAnswer = userMayAnswer(ask, message);
	const tier = cardTier(html);

	// Aid and Interfere: the move's own printed list is where it is answered.
	const list = firstPrintedList(html);
	if (list) {
		const items = [...list.querySelectorAll(":scope > li")].map(li => li.innerHTML);
		const drawn = answerListHtml({ ask, items, tier, answered, canAnswer });
		if (drawn) list.outerHTML = drawn;
	}

	// Persuade: a row per tier under the result.
	for (const row of html.querySelectorAll(".stonetop-pc-ask[data-pc-ask-tier]")) {
		row.innerHTML = answerRowHtml({ ask, tier: row.dataset.pcAskTier, answered, canAnswer });
	}

	if (answered || !canAnswer) return;
	for (const button of html.querySelectorAll("[data-pc-answer]")) {
		button.addEventListener("click", event => {
			event.preventDefault();
			answerPcAsk(message, button.dataset.pcAnswer, cardTier(html));
		});
	}
}

/**
 * The move's printed option list on this card: in a roll card's description, or in the body of the
 * card Aid posts. The ladder (utils/move-tiers.js) is a `<ul>` too, and is never it.
 */
function firstPrintedList(html) {
	const bodies = html.querySelectorAll(".stonetop-roll-card-description, .stonetop-chat-move-description");
	for (const body of bodies) {
		for (const ul of body.querySelectorAll("ul")) {
			if (ul.classList.contains(MOVE_TIERS_CLASS)) continue;
			return ul;
		}
	}
	return null;
}

/** Answers in flight on this client, by asking card, so a double click answers once. */
const answering = new Set();

/**
 * Answer an asking card: do what the answer does, then post the card that records it.
 *
 * The effect is written FIRST. A held advantage or disadvantage, or the XP, is the thing the table
 * will act on; a card announcing a mode nobody holds would be worse than a mode held with no card.
 */
export async function answerPcAsk(message, choice, tier = null) {
	const ask = readAsk(message);
	if (!ask || !message?.id || answering.has(message.id)) return;
	if (!offersChoice(ask.move, choice, tier)) return;
	if (!userMayAnswer(ask, message)) return;
	answering.add(message.id);
	try {
		// Another client may have answered while this card sat on screen.
		if (answerTo(message)) { redraw(message); return; }
		const target = game.actors?.get?.(ask.targetId) ?? null;
		if (!target) {
			ui.notifications?.warn?.(`${ask.targetName || "That character"} is no longer in this world.`);
			return;
		}
		const flags = { [PC_ANSWER_FLAG]: { to: message.id, choice } };
		let content = moveChatCard(ask.move, answerCardBody(ask, choice));

		if (choice === "advantage") {
			await target.typedActor?.holdAdvantage?.(heldSource(ask));
		} else if (choice === "anyway") {
			await target.typedActor?.holdDisadvantage?.(heldSource(ask));
		} else if (choice === "agree") {
			const receipt = await markXpReceipt(target, {
				header: "Persuaded", move: PERSUADE_PC_MOVE, description: answerCardBody(ask, choice), amount: 1,
			});
			content = receipt.content;
			Object.assign(flags, receipt.flags);
		}

		// No redraw here: `createChatMessage` fires on this client too, and registerPcAskHooks redraws.
		await ChatMessage.create({
			content,
			speaker: ChatMessage.getSpeaker({ actor: target }),
			flags: { [SYSTEM_ID]: flags },
		});
	} catch (err) {
		console.error("Stonetop | could not answer that card:", err);
		ui.notifications?.error?.("That answer could not be recorded. See the console for details.");
	} finally {
		answering.delete(message.id);
	}
}

function redraw(message) {
	try { ui.chat?.updateMessage?.(message); } catch { /* the log is not drawn on this client */ }
}

/** The asking card an answer card points at, when it is in this client's log. */
function askedBy(answerMessage) {
	const to = readAnswer(answerMessage)?.to;
	return to ? game.messages?.get?.(to) ?? null : null;
}

/**
 * A deleted answer withdraws what it gave. Deleting the answer is how a question is reopened, and an
 * agreed Persuade's answer card IS its XP receipt, so leaving the XP behind would let the same
 * question pay twice. The same goes for the advantage an Aid gave and the disadvantage an Interfere
 * laid: taken back by the name they were held under, so a roll that already spent them, or another
 * promise held beside them, is left alone. Run by the client that deleted it (`userId`), the one that
 * could write either card; a receipt already undone has nothing left to hand back.
 *
 * ONLY WHILE THE QUESTION IS STILL ASKED. Clearing the chat log, or deleting the asking card along with
 * its answer, is the history going, not the answer being taken back. Core removes every deleted card
 * from the log before any delete hook runs, so the asking card's absence is what tells the two apart.
 *
 * @returns {Promise<object|null>} adjustXp's answer for an agreed Persuade, `{released}` for a held
 *   mode, or null when there was nothing to take back
 */
export async function withdrawDeletedAnswer(message, userId) {
	const answer = readAnswer(message);
	if (!answer || userId !== game.user?.id) return null;
	const asked = answer.to ? game.messages?.get?.(answer.to) ?? null : null;
	if (!asked) return null;
	const target = speakerActor(message);
	if (target?.type !== "character") return null;
	if (answer.choice === "advantage" || answer.choice === "anyway") {
		const ask = readAsk(asked);
		if (!ask) return null;
		const release = answer.choice === "advantage" ? "releaseHeldAdvantage" : "releaseHeldDisadvantage";
		return { released: !!(await target.typedActor?.[release]?.(heldSource(ask))) };
	}
	const marked = Number(message.getFlag?.(SYSTEM_ID, XP_MARK_FLAG) ?? 0);
	if (!marked || message.getFlag(SYSTEM_ID, XP_UNDONE_FLAG)) return null;
	return adjustXp(target, -marked, { move: `${PERSUADE_PC_MOVE} (answer withdrawn)` });
}

/**
 * On every client: an answer arriving (or being deleted, which reopens the question) redraws the
 * card it answers. Registered once, at module scope in stonetop.js.
 */
export function registerPcAskHooks() {
	// Only a card this client has drawn (`logged`, set by core's ChatLog): updateMessage on one it
	// has not would post it at the foot of the log, out of order.
	const redrawAsked = answerMessage => {
		const asked = askedBy(answerMessage);
		if (asked?.logged) redraw(asked);
	};
	Hooks.on("createChatMessage", redrawAsked);
	Hooks.on("deleteChatMessage", (answerMessage, _options, userId) => {
		redrawAsked(answerMessage);
		withdrawDeletedAnswer(answerMessage, userId)
			.catch(err => console.error("Stonetop | could not take back what a withdrawn answer gave:", err));
	});
	// A player logging in or out moves the answer between them and the GM (see mayAnswer), so the
	// GM's open questions are redrawn with the buttons or without.
	Hooks.on("userConnected", () => {
		if (!game.user?.isGM) return;
		for (const message of game.messages ?? []) {
			if (message.logged && readAsk(message) && !answerTo(message)) redraw(message);
		}
	});
}
