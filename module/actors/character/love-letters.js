// Love letters (Book I, "Writing Moves & Love Letters", p.568) — single-use, GM-authored
// moves addressed to one PC. Mechanically a love letter is an embedded `move` item, forced
// to moveType "other" (so it's a plain narrative/roll move) and flagged loveLetter so the
// sheet surfaces it in its own top-of-Moves section. Resolving it HIDES it (the resolved
// flag) rather than deleting it: the player stops seeing it, and the GM keeps it, dimmed,
// with a Resend that hands it back. Unlike a player custom move it is NOT flagged `custom`, so it never
// shows the player an edit affordance and never lands in the "Other Moves" list.
//
// The document shaping lives here so both the authoring dialog (LoveLetterDialog, launched
// from the GM hotbar macro) and any later edit reuse the exact same shape.

import { STONETOP_SCOPE } from "./StonetopFlags.js";
import { normalizeRollType, STAT_KEYS } from "../../utils/roll-types.js";
import { formatCustomMoveDescription } from "../../utils/custom-move-text.js";
import { buildMoveTierResults, parseTierInput } from "../../utils/move-results.js";
import { clampInt } from "../../utils/custom-move-data.js";

export const LOVE_LETTER_FLAG = "loveLetter";
export const LOVE_LETTER_RESOLVED_FLAG = "loveLetterResolved";
// When the letter last reached its reader: stamped on creation and on every Resend, never on an
// edit. The arrival notice (love-letter-notice.js) compares it for EQUALITY only, so the GM's and
// the player's clocks never have to agree.
export const LOVE_LETTER_SENT_FLAG = "loveLetterSentAt";
// A letter the GM saved without sending. It sits on the recipient's sheet where only the GM
// sees it (no card, no arrival notice, no move name for the player) until the GM sends it.
export const LOVE_LETTER_DRAFT_FLAG = "loveLetterDraft";

// What a letter can roll: the six stats, or +Fortunes (the steading's, rolled by the PC the
// way Requisition rolls it), for a letter about the steading rather than the hero.
export const LOVE_LETTER_ROLL_TYPES = [...STAT_KEYS, "fortunes"];

// Coerce the dialog's pick-options input (a newline-separated textarea string, or an
// already-split array) into a clean array of non-blank option strings.
function normalizeOptions(raw) {
	const list = Array.isArray(raw) ? raw : String(raw ?? "").split("\n");
	return list.map((o) => String(o).trim()).filter(Boolean);
}

// True for a love letter (flagged at creation in buildLoveLetterData). The flag keeps it
// out of the custom-move / foreign-move "other" list and into its own section.
export function isLoveLetter(item) {
	return !!item?.flags?.[STONETOP_SCOPE]?.[LOVE_LETTER_FLAG];
}

// True once the player has resolved the letter. Hidden from the player, kept for the GM.
export function isResolvedLoveLetter(item) {
	return !!item?.flags?.[STONETOP_SCOPE]?.[LOVE_LETTER_RESOLVED_FLAG];
}

// True for a letter the GM saved as a draft and hasn't sent yet.
export function isDraftLoveLetter(item) {
	return !!item?.flags?.[STONETOP_SCOPE]?.[LOVE_LETTER_DRAFT_FLAG];
}

// What tells one arrival of a letter from the next: its sent stamp, or for a letter written
// before the stamp existed, when it was created. Null for no letter.
export function loveLetterArrivalKey(item) {
	const sent = item?.flags?.[STONETOP_SCOPE]?.[LOVE_LETTER_SENT_FLAG];
	return sent ?? item?._stats?.createdTime ?? null;
}

// Resolve (true) or resend (false) a letter. Edits leave this flag alone, so fixing a typo
// in a resolved letter doesn't put it back in front of the player. A Resend is a new arrival,
// so it restamps the sent time and the player's notice comes back.
export async function setLoveLetterResolved(item, resolved) {
	if (!item) return;
	const update = { [`flags.${STONETOP_SCOPE}.${LOVE_LETTER_RESOLVED_FLAG}`]: !!resolved };
	if (!resolved) update[`flags.${STONETOP_SCOPE}.${LOVE_LETTER_SENT_FLAG}`] = Date.now();
	await item.update(update);
}

// The roll's label for the reader and the GM's chip: "Fortunes" for a steading roll, else
// the stat's own label.
export function loveLetterRollLabel(rollType) {
	const rt = normalizeRollType(rollType);
	if (!rt) return "";
	if (rt === "fortunes") return game.i18n.localize("stonetop.character.moves.loveLetter.fortunes");
	return Handlebars.helpers.statLabel(rt);
}

// Shape raw dialog input into the embedded-item document data (used by both create and
// update). A love letter is a single-use move: name (its title), body prose, and an
// optional fixed-stat (or +Fortunes) roll with 10+/7-9/6- result text. moveResults follows
// the shape rollStat consumes: { success|partial|failure: { label, value, pick } }, or null
// for a no-roll (read-aloud) letter; a tier may carry both a pick count and its own text.
// rollType is limited to the six stats and Fortunes — a love letter is authored for one
// specific scene, so "ask a stat each time" isn't offered. `noXpOnMiss`
// mirrors the "Mark XP on a miss" checkbox (inverted), and `signed` is the closing sign-off.
export function buildLoveLetterData(input) {
	const { rollType, success, partial, failure } = parseTierInput(input, LOVE_LETTER_ROLL_TYPES);

	// A shared "choose from this list" pool (one option per line) plus a per-tier count of
	// how many to pick — the book's "on a 10+, pick 1; on a 7-9, pick 2; …" love letters.
	const options = normalizeOptions(input?.options);
	const p = input?.picks ?? {};
	const pickN = (v) => clampInt(v, 0, 20);
	const pS = pickN(p.success), pP = pickN(p.partial), pF = pickN(p.failure);

	const moveResults = (rollType && (success || partial || failure || pS || pP || pF || options.length))
		? buildMoveTierResults({ success, partial, failure }, { success: pS, partial: pP, failure: pF })
		: null;

	return {
		name: String(input?.name ?? "").trim() || "Love Letter",
		type: "move",
		system: {
			moveType: "other",
			description: formatCustomMoveDescription(input?.description ?? ""),
			rollType,
			moveResults,
			// The shared pick-from pool only makes sense alongside a roll (the roll picks how
			// many); a no-roll read-aloud letter carries none.
			pickOptions: rollType ? options : [],
			// A miss on a PbtA move marks XP by default; the GM opts out per-letter when
			// they don't want to reward a failed love letter (see rollStat's noXpOnMiss).
			noXpOnMiss: !!input?.noXpOnMiss,
			// Closing sign-off rendered at the foot of the posted letter.
			signed: String(input?.signed ?? "").trim(),
		},
		flags: { [STONETOP_SCOPE]: { [LOVE_LETTER_FLAG]: true } },
	};
}

// Create a love letter on the given recipient character. Returns the created item (or null).
// `draft: true` saves it unsent: no arrival stamp, and only the GM sees it until sendLoveLetter.
export async function createLoveLetter(actor, input, { draft = false } = {}) {
	if (!actor) return null;
	const data = buildLoveLetterData(input);
	// Stamped here, not in buildLoveLetterData, which edits reuse: an edit is not an arrival.
	if (draft) data.flags[STONETOP_SCOPE][LOVE_LETTER_DRAFT_FLAG] = true;
	else data.flags[STONETOP_SCOPE][LOVE_LETTER_SENT_FLAG] = Date.now();
	const created = await actor.createEmbeddedDocuments("Item", [data]);
	return created?.[0] ?? null;
}

// Rewrite an existing love letter in place (GM edit).
export async function updateLoveLetter(item, input) {
	if (!item) return;
	// name/type/system/flags — the same shape create uses, so an edit fully re-derives
	// the roll block (adding or clearing a roll as the GM changes it).
	await item.update(buildLoveLetterData(input));
}

// Send a draft: it stops being a draft and arrives now, so the player's notice comes.
export async function sendLoveLetter(item) {
	if (!item) return;
	await item.update({
		[`flags.${STONETOP_SCOPE}.${LOVE_LETTER_DRAFT_FLAG}`]: false,
		[`flags.${STONETOP_SCOPE}.${LOVE_LETTER_RESOLVED_FLAG}`]: false,
		[`flags.${STONETOP_SCOPE}.${LOVE_LETTER_SENT_FLAG}`]: Date.now(),
	});
}

// Every unsent draft in the world, for the writing window's "pick up a draft" list:
// { actor, item } rows, newest first.
export function loveLetterDrafts(actors = game.actors) {
	const rows = [];
	for (const actor of actors ?? []) {
		if (actor?.type !== "character") continue;
		for (const item of actor.items ?? []) {
			if (isLoveLetter(item) && isDraftLoveLetter(item)) rows.push({ actor, item });
		}
	}
	const when = (row) => Number(row.item?._stats?.modifiedTime ?? row.item?._stats?.createdTime) || 0;
	return rows.sort((a, b) => when(b) - when(a));
}

// The character actors a love letter can be addressed to, for the recipient picker. Every
// world character the GM can see, most-recently-updated ish (game.actors order), as
// { id, name, selected } rows.
export function loveLetterRecipientOptions(selectedId = null) {
	return game.actors
		.filter(a => a.type === "character")
		.map(a => ({ id: a.id, name: a.name, selected: a.id === selectedId }));
}

// The roll-type dropdown options: no-roll + the six stats + Fortunes (no "ask"). `stat` is
// the currently-selected value ("" for none).
export function loveLetterRollOptions(stat = "") {
	const current = normalizeRollType(stat) ?? "";
	return [
		{ value: "", label: game.i18n.localize("stonetop.character.moves.loveLetter.rollNone"), selected: current === "" },
		...LOVE_LETTER_ROLL_TYPES.map(k => ({
			value: k,
			label: k === "fortunes"
				? game.i18n.localize("stonetop.character.moves.loveLetter.fortunesOption")
				: Handlebars.helpers.statLabel(k),
			selected: current === k,
		})),
	];
}
