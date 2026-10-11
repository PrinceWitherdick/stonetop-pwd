// A follower at Death's Door (wave 3 audit FOL-4, rules as written, the user's ruling of 2026-10-09).
//
// Book I p.469, Followers at 0 HP: "They trigger Death's Door (even if they weren't directed to by their
// PC). Their PC's player rolls." And the move, p.244: "When you are dying, you glimpse the Last Door and the
// Lady of Crows (describe them). Then, roll +nothing: on a 10+, you wrest yourself back to the realm of the
// living--return to 1 HP but say how your brush with death has marked you; on a 7-9, the Lady waves you
// off--you're no longer dying but you're out of the action; on a 6-, your time has come". The GM's side of
// the same page: "On a 7-9+, the character is no longer dying but they're unconscious (or close enough)
// until you say otherwise. On a 6-, their time has come ... They can make one last move, but after that
// they're dead."
//
// So the fate dialog's Death's Door posts a card with a Roll button; the roll is +nothing, made by the
// leader's player on the leader's sheet, and a miss marks no XP (a 0-HP roll, no-xp-on-miss.md). Its 10+
// carries "Back to 1 HP" and its 6- "Mark dead", which writes the fate dialog's own Dead (the sheet's
// _resolveFollowerFate). The 6- choices printed for a PC (refuse to go, call on a Thing Below) are the
// Ghost, Revenant and Thrall inserts, which are PC-only, so a follower is never offered them.
//
// A 6- IS "WOULD DIE". The Marshal's SIR, PERMISSION TO DIE, SIR: "When one of your followers would die,
// you can spend 1 of their Loyalty to have them survive (out of the action, but alive). If you let them go,
// mark XP." That specific move beats p.244's PC-facing "There's no saving them" (the user's ruling of
// 2026-10-09, re-check FO-1), so with it learned "Mark dead" opens the fate dialog's own Dead and spare,
// let-go box and all (the sheet's _followerDoorDeath), instead of writing Dead past them.
//
// A FOLLOWER'S ROLL, NOT THE LEADER'S (re-check FO-2). It is rolled as "follower" (roll-engine.js#rollStat),
// so the leader's wounds stay off its card, and named "<follower>: Death's Door", as an ordered follower's
// roll is ("Glaw: Let Fly"), so it is not read as the leader's own Door card (deaths-door.js
// #isDeathsDoorCard): no window settles this one, so the +1s and the GM's Shift stay on it, and its two
// buttons read the tier the card ends on. It gets the pre-roll window, and "If someone tries to save the
// dying ... they're Aiding the Death's Door roll" (p.244): an Aid answered with "they gain advantage on
// their roll" (p.212) is held on the leader, the character the helper aimed at, so that advantage, and
// only that one, is offered on the window as a ticked line. The leader's other held promises, their
// +forward, ongoing, debilities and sticky mode are theirs and stay out of it, as Order Followers keeps them.

import { setFollowerHp } from "./follower-hp.js";
import { followerActorFromLink } from "./follower-actors.js";
import { withCardLatch, wireLatchedButtons } from "../../utils/card-latch.js";
import { cardTierNow } from "../../utils/counted-tier.js";
import { foldModes } from "../../utils/roll-mode.js";
import { AID_MOVE } from "../../pc-asks/pc-ask-rules.js";
import { SYSTEM_ID } from "../../system-id.js";
import { escHtml } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

const KEY = "stonetop.character.followers.door";

export const FOLLOWER_DEATHS_DOOR = "Death's Door";

/** The message flags latching the card's buttons, each once. */
export const DOOR_ROLLED_FLAG = "followerDoorRolled";
export const DOOR_SETTLED_FLAG = "followerDoorSettled";

/** The data attributes a card button carries to say whose follower and which HP row. PURE. */
export function doorButtonData({ follower = "", slug = "", index = null, name = "" } = {}) {
	return `data-follower="${escHtml(follower)}" data-slug="${escHtml(slug ?? "")}" data-index="${index == null ? "" : escHtml(String(index))}" data-name="${escHtml(name)}"`;
}

/** Read a button's row back, the inverse of doorButtonData. PURE. */
export function doorRowFromButton(btn) {
	const d = btn?.dataset ?? {};
	const index = d.index === "" || d.index == null ? null : Number(d.index);
	return { follower: d.follower ?? "", slug: d.slug ?? "", index: Number.isInteger(index) ? index : null, name: d.name ?? "" };
}

/** The Follower Down card's body for the Death's Door outcome, with its Roll button. PURE. */
export function followerDoorCardHtml(row, leaderName = "") {
	const who = `<strong>${escHtml(row?.name || "Your follower")}</strong>`;
	return `<p>${format(`${KEY}.triggers`, { name: who, leader: escHtml(leaderName) })}</p>`
		+ `<button type="button" class="stonetop-follower-door-roll" ${doorButtonData(row)}>`
		+ `<i class="fas fa-dice"></i> ${escHtml(localize(`${KEY}.rollButton`))}</button>`;
}

/** The roll card's header, "Maeve: Death's Door", the way an ordered follower's roll is named. PURE. */
export function followerDoorMoveName(name) {
	return `${name || localize(`${KEY}.fallbackName`)}: ${FOLLOWER_DEATHS_DOOR}`;
}

/** The roll's options: +nothing, no XP on a miss, the book's three tiers, the 10+ and 6- buttons. PURE. */
export function followerDoorRollOptions(row) {
	const name = row?.name || localize(`${KEY}.fallbackName`);
	const attrs = doorButtonData(row);
	return {
		statValue:   0,
		modifier:    0,
		moveName:    followerDoorMoveName(name),
		noXpOnMiss:  true,
		moveDescription: `<p>${escHtml(format(`${KEY}.rule`, { name }))}</p>`,
		moveResults: {
			success: { label: "10+", value: format(`${KEY}.success`, { name }) },
			partial: { label: "7–9", value: format(`${KEY}.partial`, { name }) },
			failure: { label: "6–", value: format(`${KEY}.failure`, { name }) },
		},
		tierActions: {
			success: `<button type="button" class="stonetop-follower-door-up" ${attrs}><i class="fas fa-heart"></i> ${escHtml(localize(`${KEY}.upButton`))}</button>`,
			failure: `<button type="button" class="stonetop-follower-door-dead" ${attrs}><i class="fas fa-skull-crossbones"></i> ${escHtml(localize(`${KEY}.deadButton`))}</button>`,
		},
	};
}

/**
 * The 10+: "return to 1 HP", through the one HP writer (follower-hp.js#setFollowerHp): the follower's NPC
 * at 1 when they have one, since its HP is theirs and the card mirrors it, else the card's box at 1 (and
 * the revive it makes). Answers whether anything was written.
 */
export async function followerDoorUp(character, row, { link = followerActorFromLink } = {}) {
	if (!character || !row?.follower) return false;
	return !!(await setFollowerHp(character, row, 1, { moveName: FOLLOWER_DEATHS_DOOR, link }));
}

/**
 * The names in a held advantage (StonetopCharacter#heldAdvantage's `sources`) that an Aid gave ("Dewi's
 * Aid", pc-ask-rules.js#heldSource), which StonetopCharacter#releaseHeldAdvantage takes back one by one.
 * Every other promise held beside them is left out. PURE.
 */
export function aidAdvantageSources(held) {
	return (held?.sources ?? []).filter(part => String(part).endsWith(`'s ${AID_MOVE}`));
}

/** The pre-roll window's line for those Aids, ticked (the player can untick it), or none. PURE. */
export function doorAidOffers(sources) {
	return sources?.length
		? [{ key: "aid", label: format(`${KEY}.aidOffer`, { source: sources.join(" & ") }), applied: true }]
		: [];
}

/**
 * Roll it for the leader's player: the pre-roll window (its mode, its one-off modifier, the Aid's line),
 * then +nothing as a follower's roll (see the header). An Aid's advantage taken is spent from the leader
 * before the dice and given back when no dice are thrown. Answers the roll, or null when the window was
 * closed.
 *
 * @param {Actor} character  the follower's leader
 * @param {{follower: string, slug?: string, index?: number|null, name?: string}} row
 * @param {{roll?: Function, prompt?: Function, shiftKey?: boolean}} [deps]
 */
export async function rollFollowerDeathsDoor(character, row, { roll, prompt, shiftKey = false } = {}) {
	const rollStat = roll ?? (await import("../../utils/roll-engine.js")).rollStat;
	const promptRoll = prompt ?? (await import("../../dialogs/RollDialog.js")).promptRoll;
	const options = followerDoorRollOptions(row);
	const typed = character?.typedActor ?? null;
	const aids = aidAdvantageSources(typed?.heldAdvantage?.());
	const answer = await promptRoll({ title: options.moveName, shiftKey, offers: doorAidOffers(aids) });
	if (!answer) return null;
	const taken = [];
	if (aids.length && (answer.takenOffers ?? []).includes("aid")) {
		for (const source of aids) if (await typed.releaseHeldAdvantage?.(source)) taken.push(source);
	}
	const sources = [answer.rollMode, taken.length ? "adv" : ""].filter(mode => mode === "adv" || mode === "dis");
	const giveBack = async () => { if (taken.length) await typed.holdAdvantage?.(taken); };
	let result = null;
	try {
		result = await rollStat("follower", character, {
			...options,
			rollMode: foldModes(sources, "normal"),
			modifier: Math.trunc(Number(answer.situational) || 0),
			...(taken.length ? { conditionNotes: taken } : {}),
		});
	} catch (err) {
		await giveBack();
		throw err;
	}
	if (!result) await giveBack();
	return result;
}

/** The tier a follower's Door card counts as NOW (after a Shift or a +1), or null with no roll. */
export function followerDoorCardTier(message) {
	return cardTierNow(message, SYSTEM_ID);
}

/** Wire the three buttons (stonetop.js renderChatMessageHTML), each once per card. */
export function wireFollowerDeathsDoor(message, html) {
	wireLatchedButtons(message, html, {
		selector: ".stonetop-follower-door-roll", flag: DOOR_ROLLED_FLAG, what: "rolling a follower's Death's Door",
		act: (actor, btn, buttons) => withCardLatch(message, DOOR_ROLLED_FLAG, true, buttons,
			async () => !!(await rollFollowerDeathsDoor(actor, doorRowFromButton(btn)))),
	});
	wireLatchedButtons(message, html, {
		selector: ".stonetop-follower-door-up, .stonetop-follower-door-dead", flag: DOOR_SETTLED_FLAG, what: "settling a follower's Death's Door",
		act: (actor, btn, buttons) => {
			const up = btn.classList.contains("stonetop-follower-door-up");
			// A Shift or a +1 may have moved the card since it was drawn: act on the tier it reads now.
			if (followerDoorCardTier(message) !== (up ? "success" : "failure")) {
				globalThis.ui?.notifications?.warn?.(localize(`${KEY}.tierMoved`));
				return Promise.resolve(false);
			}
			return withCardLatch(message, DOOR_SETTLED_FLAG, up ? "up" : "dead", buttons, async () => {
				const row = doorRowFromButton(btn);
				if (up) return followerDoorUp(actor, row);
				// The fate dialog's own Dead (a custom follower marked fallen, a roster member struck off), through
				// SIR, PERMISSION TO DIE, SIR's choice when it is learned (see the header).
				const sheet = actor?.sheet;
				if (typeof sheet?._followerDoorDeath !== "function") return false;
				return sheet._followerDoorDeath(row);
			});
		},
	});
}

