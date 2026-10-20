// EVERYONE'S WISHES, IN ONE PLACE FOR THE GM.
//
// End of Session has each player "offer up a wish for future sessions ... The GM will take notes" (Book I
// p.75), and dialogs/EndOfSessionDialog.js keeps them on each character (`sessionWishes`, stored here). The GM reads them
// back at two moments the book names: starting a session ("Outstanding wishes", p.581) and ending the game,
// whose planning session works from "a list of hanging threads ... active threats, stuff from your 'I
// wonder...' list, unsolved mysteries and unfinished projects, player wishes yet to be granted" (p.591). So
// the list sits on the GM Toolkit's "I wonder..." tab, beside the rest of the hanging threads.
//
// Read-only: what a player said is theirs. PURE but for the flag read.

import { SYSTEM_ID } from "../system-id.js";
import { readableFlags } from "../actors/character/StonetopFlags.js";
import { isOutOfPlaySafe } from "../actors/character/deaths-door-actor.js";

/**
 * Where a character's praise and wishes are kept (Book I p.75: "offer up a wish for future sessions ... The
 * GM will take notes"): `flags.<system>.sessionWishes`, a list of `{at, text}`, oldest first.
 */
export const WISHES_FLAG = "sessionWishes";
/** How many sessions' notes a character keeps. */
export const WISHES_KEPT = 20;

/** A character's stored notes, oldest first. Never throws. */
export function sessionWishes(actor) {
	const list = readableFlags(actor)?.[WISHES_FLAG];
	return Array.isArray(list) ? list.filter(w => w && typeof w.text === "string" && w.text.trim()) : [];
}

/** The latest note a character left, or null. */
export function latestWish(actor) {
	return sessionWishes(actor).at(-1) ?? null;
}

/** The update that adds `text` to a character's notes, keeping the last WISHES_KEPT; empty for no text. PURE but for the read. */
export function wishesUpdate(actor, text, at = Date.now()) {
	const said = String(text ?? "").trim();
	if (!said) return {};
	return { [`flags.${SYSTEM_ID}.${WISHES_FLAG}`]: [...sessionWishes(actor), { at, text: said }].slice(-WISHES_KEPT) };
}

/** How many of each character's notes the list shows, newest first. */
export const WISHES_SHOWN = 5;

/**
 * Each character in play who has said something, with their latest notes first.
 *
 * @param {Actor[]} characters
 * @param {object} [o]
 * @param {(at: number) => string} [o.when]  how a note's date reads
 * @returns {{id: string, name: string, img: string, wishes: {text: string, when: string}[]}[]}
 */
export function playerWishesView(characters = [], { when = at => (at ? new Date(at).toLocaleDateString() : "") } = {}) {
	return [...characters]
		.filter(actor => actor?.type === "character" && !isOutOfPlaySafe(actor))
		.map(actor => ({
			id:     actor.id,
			name:   actor.name,
			img:    actor.img ?? "",
			wishes: sessionWishes(actor).slice(-WISHES_SHOWN).reverse()
				.map(w => ({ text: w.text.trim(), when: when(w.at) })),
		}))
		.filter(row => row.wishes.length);
}
