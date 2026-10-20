// FRONT LINE LEADER (the Marshal, Book I p.126): "When you lead your crew into battle, hold 2 Presence.
// Spend Presence in lieu of your crew's Loyalty or as Readiness (as if you Defended them)."
//
// The hold is the move's own track (front-line-leader.json `resource`, filled when the Marshal goes into
// battle by combat/battle-holds.js), and a ticked pip is HELD, so a spend is `held - 1` (MoveResources.js).
// Read off the LEARNED copy only: a switched-off Front Line Leader holds nothing to spend.
//
// WHERE IT IS SPENT (the user's ruling, 2026-10-18: "everywhere the crew pays"). In lieu of the crew's
// Loyalty: the crew card's Spend Loyalty, a balk on Order Followers, and Sir, Permission to Die, Sir's
// "spend 1 of their Loyalty to have them survive". As Readiness, as if the Marshal had Defended the crew:
// the crew card's Spend Readiness, and a blow on the crew on the damage card (fight/defend-spend.js), where
// the MARSHAL halves it or takes it for them, the crew being their ward.
//
// ONLY THE CREW. "Your crew" is the character's own crew card (ftype "crew", the one
// StonetopCharacter#crewSource draws), never a custom group, an initiate or any other follower.

import { learnedTrack } from "./MoveResources.js";
import { followerCardFor } from "./follower-masters.js";
import { escHtml } from "../../utils/strings.js";

export const FRONT_LINE_LEADER = "Front Line Leader";

/** The follower type Presence pays for: the character's own crew card. */
const CREW = "crew";

/** The Presence a character holds on their learned Front Line Leader, 0 without it. */
export function presenceHeld(actor) {
	return learnedTrack(actor, FRONT_LINE_LEADER)?.held ?? 0;
}

/**
 * Whether Presence may pay for this follower at all: the character's own crew, while Front Line Leader is
 * learned (and has its track). Says nothing of how much is held (presenceFor).
 */
export function presenceCovers(actor, ftype) {
	return ftype === CREW && !!learnedTrack(actor, FRONT_LINE_LEADER);
}

/** The Presence a character could spend for this follower right now: what they hold, for their crew only. */
export function presenceFor(actor, ftype) {
	return presenceCovers(actor, ftype) ? presenceHeld(actor) : 0;
}

/**
 * Spend 1 Presence, off what is held, attributed to the move in the ledger. Answers `{from, to}`, or null
 * when nothing was held to spend (or the move is not learned).
 *
 * @returns {Promise<{from: number, to: number}|null>}
 */
export async function spendPresence(actor) {
	const track = learnedTrack(actor, FRONT_LINE_LEADER);
	if (!track || track.held <= 0) return null;
	await track.resources.setUses(FRONT_LINE_LEADER, track.held - 1, { stonetopMove: FRONT_LINE_LEADER });
	return { from: track.held, to: track.held - 1 };
}

/**
 * Whether a spend comes out of Presence, given what each purse holds and the one asked for: the asked one
 * while it holds any, else whichever does. False for the follower's own track, and for neither. PURE.
 *
 * @param {number} own        what the follower's own track holds
 * @param {number} presence   the Presence that may pay for them (presenceFor)
 * @param {string} [asked]    "presence" to pay with Presence, anything else for their own
 */
export function paysWithPresence(own, presence, asked = "") {
	const hasOwn = Math.max(0, Number(own) || 0) > 0;
	const hasPresence = Math.max(0, Number(presence) || 0) > 0;
	if (asked === "presence" && hasPresence) return true;
	return !hasOwn && hasPresence;
}

/** The radio a spend window names its purse by. */
export const PURSE_FIELD = "stonetop-spend-purse";

/**
 * The "which purse" choice a spend window carries while Presence may pay: the follower's own track (greyed
 * when it holds none) or Presence, the one with something in it ticked, their own first. Empty when no
 * Presence is held, so the window reads as it always did. PURE.
 *
 * @param {{own: number, ownLabel: string, presence: number, presenceLabel: string}} p  labels as plain text
 */
export function purseChoiceHtml({ own = 0, ownLabel = "", presence = 0, presenceLabel = "" } = {}) {
	if (!(Math.max(0, Number(presence) || 0) > 0)) return "";
	const hasOwn = Math.max(0, Number(own) || 0) > 0;
	const radio = (value, label, { checked = false, disabled = false } = {}) =>
		`<label class="stonetop-spend-choice stonetop-spend-choice--purse"><input type="radio" class="stonetop-spend-radio" name="${PURSE_FIELD}" value="${value}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}> <span>${escHtml(label)}</span></label>`;
	return `<div class="stonetop-spend-purse">`
		+ radio("own", ownLabel, { checked: hasOwn, disabled: !hasOwn })
		+ radio("presence", presenceLabel, { checked: !hasOwn })
		+ `</div>`;
}

/** The purse a spend window's choice names: "presence", or "" for the follower's own. */
export function pickedPurse(root) {
	return root?.querySelector?.(`input[name="${PURSE_FIELD}"]:checked`)?.value === "presence" ? "presence" : "";
}

/**
 * The character whose Presence may guard this actor as a Defender's ward: the leader of the crew that this
 * NPC stands for on the map, while they hold any. Null for anyone else.
 *
 * @param {Actor} actor  the one a blow is aimed at
 * @returns {Actor|null}
 */
export function presenceKeeperFor(actor, { cardFor = followerCardFor } = {}) {
	if (actor?.type !== "npc") return null;
	const card = cardFor(actor);
	if (card?.ftype !== CREW || !card.character) return null;
	return presenceHeld(card.character) > 0 ? card.character : null;
}
