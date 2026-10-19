// "They balk": the GM reveals that a follower won't do as they're told, and the player answers.
//
// Book I p.466-467: followers "might resist orders if ... they're angry, miserable, shocked, or otherwise
// overwhelmed; the order is unreasonable, foolish, degrading, distasteful, etc.; and/or the order goes against
// the follower's instinct, tags, cost, or other traits", and they get scared. "When you decide that a follower
// doesn't want to do as they're told, then reveal that to the player! ... The player can then choose to spend
// the follower's Loyalty (if they hold any) to have them 'do something they don't want to do.' Or the PC can
// Persuade the follower, or use a different move to convince them. Or they could let it drop and do something
// else."
//
// THE GM'S CALL, THE PLAYER'S ANSWER. Nothing here decides a follower balks: the GM does, and says so. The
// "They balk" button on the follower's own card (tab-followers.hbs) is pressed by the GM or by the leader's
// player putting it on the table for them, and asks why. The card goes to the table with the player's three
// answers on it, and the player presses one. The GM is never asked to judge whether the answer was right.
//
// ANSWERED BY A NEW CARD, as Aid, Interfere and Persuade (vs. PCs) are (pc-asks/pc-ask-flow.js): a player
// cannot update the GM's message, so the answer is a card of its own stamped `followerBalkAnswer.to`, and the
// balk card reads whether it was answered off the log on every render. Deleting the answer reopens it.
// Who may answer: the leader's owners, or the GM while none of them is logged in.

import { SYSTEM_ID } from "../system-id.js";
import { escHtml } from "../utils/strings.js";
import { format, localize } from "../utils/i18n.js";
import { stonetopChatCard } from "../utils/chat.js";
import { resolveSync } from "../utils/foundry-compat.js";
import { BALK_REASONS, BALK_RULE } from "./follower-text.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { contentElement } from "../utils/dialogv2-content.js";
import { changeFollowerLoyalty, followerLoyalty, SPEND_LOYALTY } from "../actors/character/follower-bond.js";
import { findPcAnswer } from "../pc-asks/pc-ask-rules.js";

const KEY = "stonetop.character.followers.balk";
export const BALK_FLAG = "followerBalk";
export const BALK_ANSWER_FLAG = "followerBalkAnswer";
export const BALK_CHOICES = Object.freeze(["spend", "persuade", "drop"]);
const PERSUADE_MOVE = "Persuade (vs. NPCs)";

const readBalk = message => message?.flags?.[SYSTEM_ID]?.[BALK_FLAG] ?? null;
const readAnswer = message => message?.flags?.[SYSTEM_ID]?.[BALK_ANSWER_FLAG] ?? null;

/** The answer card a balk card has had, from this client's log, or null. Read as an Aid's answer is. */
export function balkAnswerFor(message, messages = globalThis.game?.messages) {
	return findPcAnswer(messages, message?.id, readAnswer)?.message ?? null;
}

/**
 * The balk card's body. PURE.
 *
 * @param {{name: string, leaderName: string, reason: string, order?: string, loyalty: number}} balk
 */
export function balkCardBody({ name, leaderName, reason, order = "", loyalty = 0 }) {
	const why = BALK_REASONS.find(r => r.key === reason)?.text ?? "";
	const what = order ? `<p>${escHtml(format(`${KEY}.order`, { order }))}</p>` : "";
	return `<p><strong>${escHtml(format(`${KEY}.lead`, { name, leader: leaderName }))}</strong></p>`
		+ what
		+ (why ? `<p><em>${escHtml(why)}</em></p>` : "")
		+ `<p class="stonetop-balk-rule">${escHtml(BALK_RULE)} (p.466)</p>`
		+ `<div class="card-buttons stonetop-balk-answers">`
		+ `<button type="button" class="stonetop-balk-answer" data-choice="spend"${loyalty > 0 ? "" : " disabled"}><i class="fas fa-hand-holding-heart"></i> ${escHtml(format(`${KEY}.spend`, { loyalty }))}</button>`
		+ `<button type="button" class="stonetop-balk-answer" data-choice="persuade"><i class="fas fa-comments"></i> ${escHtml(localize(`${KEY}.persuade`))}</button>`
		+ `<button type="button" class="stonetop-balk-answer" data-choice="drop"><i class="fas fa-hand"></i> ${escHtml(localize(`${KEY}.drop`))}</button>`
		+ `</div>`;
}

/**
 * Post the balk card: the GM reveals that a follower won't do as they're told.
 *
 * @param {{character: Actor, ftype: string, slug?: string, loyaltySlug?: string, name: string, reason: string, order?: string}} p
 */
export async function postFollowerBalk({ character, ftype, slug = "", loyaltySlug = slug, name, reason, order = "" }) {
	if (!character) return null;
	const loyalty = followerLoyalty(character, ftype, loyaltySlug);
	return globalThis.ChatMessage?.create?.({
		content: stonetopChatCard(localize(`${KEY}.title`), `<div class="card-content">${balkCardBody({ name, leaderName: character.name, reason, order, loyalty })}</div>`, "stonetop-balk-card"),
		speaker: { alias: name },
		flags: { [SYSTEM_ID]: { [BALK_FLAG]: { characterUuid: character.uuid, ftype, slug, loyaltySlug, name, reason } } },
	});
}

/**
 * Ask why the follower won't do as they're told (and, optionally, what the order was), then post the card.
 * Answers the card, or null when the window was cancelled.
 *
 * @param {{character: Actor, ftype: string, slug?: string, loyaltySlug?: string, name: string}} ref
 */
export async function askFollowerBalk(ref) {
	if (!ref?.character) return null;
	const form = contentElement(`<p>${escHtml(format(`${KEY}.ask`, { name: ref.name }))}</p>`
		+ `<label class="stonetop-balk-order">${escHtml(localize(`${KEY}.orderLabel`))} <input type="text" name="order" placeholder="${escHtml(localize(`${KEY}.orderPlaceholder`))}"></label>`);
	let order = "";
	const reason = await askWithButtons({
		title: format(`${KEY}.askTitle`, { name: ref.name }),
		content: form,
		buttons: [
			...BALK_REASONS.map(r => ({ key: r.key, label: localize(`${KEY}.reason.${r.key}`), value: r.key })),
			{ key: "cancel", label: localize(`${KEY}.cancel`), value: null },
		],
		// The window keeps only the markup it is handed, so the typed order is read as it is typed.
		render: root => {
			const input = root?.querySelector?.('input[name="order"]');
			input?.addEventListener("input", () => { order = String(input.value ?? "").trim(); });
		},
	});
	if (!reason) return null;
	return postFollowerBalk({ ...ref, reason, order });
}

/** Whether this user may answer for the leader: an owner, or the GM while no owning player is logged in. */
export function mayAnswerBalk(character, user = globalThis.game?.user, users = globalThis.game?.users) {
	if (!character || !user) return false;
	if (!user.isGM) return !!character.testUserPermission?.(user, "OWNER");
	const playerHere = [...(users ?? [])].some(u => u?.active && !u.isGM && character.testUserPermission?.(u, "OWNER"));
	return !playerHere;
}

/** Draw a balk card: answered, or its buttons live for whoever may answer. Called on every render. */
export function wireFollowerBalkCard(message, html) {
	const balk = readBalk(message);
	if (!balk) return;
	const root = html?.[0] ?? html;
	const area = root?.querySelector?.(".stonetop-balk-answers");
	if (!area) return;
	const answered = balkAnswerFor(message);
	if (answered) {
		const choice = readAnswer(answered)?.choice ?? "";
		area.replaceChildren();
		const note = document.createElement("p");
		note.className = "stonetop-balk-answered";
		note.textContent = format(`${KEY}.answered`, { choice: localize(`${KEY}.choice.${choice}`) });
		area.appendChild(note);
		return;
	}
	let character = null;
	try { character = resolveSync(balk.characterUuid); } catch { character = null; }
	const may = mayAnswerBalk(character);
	for (const btn of area.querySelectorAll(".stonetop-balk-answer")) {
		if (!may) { btn.disabled = true; continue; }
		if (btn.dataset.wired === "1") continue;
		btn.dataset.wired = "1";
		btn.addEventListener("click", () => {
			for (const b of area.querySelectorAll(".stonetop-balk-answer")) b.disabled = true;
			answerFollowerBalk(message, btn.dataset.choice, character)
				.catch(err => console.error("Stonetop | answering a follower's balk failed", err));
		});
	}
}

/**
 * Answer a balk: spend 1 of the follower's Loyalty so they do it anyway, Persuade them (the leader's own
 * Persuade (vs. NPCs) roll, the move the book names), or let it drop. The answer is a card of its own.
 * Answers whether it was answered.
 */
export async function answerFollowerBalk(message, choice, character) {
	const balk = readBalk(message);
	if (!balk || !character || !BALK_CHOICES.includes(choice) || balkAnswerFor(message)) return false;
	let line;
	if (choice === "spend") {
		const step = await changeFollowerLoyalty(character, { ftype: balk.ftype, slug: balk.loyaltySlug ?? balk.slug, delta: -1, move: SPEND_LOYALTY });
		if (!step) {
			globalThis.ui?.notifications?.warn?.(format(`${KEY}.spendFailed`, { name: balk.name }));
			redrawBalk(message);
			return false;
		}
		line = format(`${KEY}.spent`, { leader: character.name, name: balk.name, loyalty: step.to });
	} else if (choice === "persuade") {
		line = format(`${KEY}.persuading`, { leader: character.name, name: balk.name });
	} else {
		line = format(`${KEY}.dropped`, { leader: character.name, name: balk.name });
	}
	await globalThis.ChatMessage?.create?.({
		content: stonetopChatCard(localize(`${KEY}.answerTitle`), `<div class="card-content"><p>${escHtml(line)}</p></div>`, "stonetop-balk-answer-card"),
		speaker: globalThis.ChatMessage?.getSpeaker?.({ actor: character }),
		flags: { [SYSTEM_ID]: { [BALK_ANSWER_FLAG]: { to: message.id, choice } } },
	});
	if (choice === "persuade") {
		const item = character.items?.find?.(i => i.type === "move" && i.name === PERSUADE_MOVE);
		const sheet = character.sheet;
		if (item && typeof sheet?.rollMoveById === "function") await sheet.rollMoveById(item.id);
		else if (item) await item.roll?.();
	}
	return true;
}

function redrawBalk(message) {
	try { globalThis.ui?.chat?.updateMessage?.(message); } catch { /* the log is not drawn on this client */ }
}

/** Redraw a balk card when its answer card arrives or is deleted (deleting it reopens the question). */
export function registerFollowerBalkHooks() {
	const redrawAsked = answer => {
		const to = readAnswer(answer)?.to;
		const asked = to ? globalThis.game?.messages?.get?.(to) : null;
		if (asked?.logged) redrawBalk(asked);
	};
	Hooks.on("createChatMessage", redrawAsked);
	Hooks.on("deleteChatMessage", redrawAsked);
}
