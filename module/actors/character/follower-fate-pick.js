// WHO PICKS A FALLEN FOLLOWER'S FATE (audit FOE-8, the user's ruling of 2026-10-23).
//
// Book I p.469, Followers at 0 HP: "When a follower is reduced to 0 HP, their fate is in your hands. If the
// source of damage was potentially lethal, then they're out of the action and you pick 1: They're dead,
// immediately / They trigger Death's Door ... Their PC's player rolls / They're dying". "You" is the GM.
// Two choices on the same moment stay the PLAYER'S, because they are their character's moves:
//
//   LOYAL TO THE END (the Ranger's companion, p.143), which REPLACES the GM's pick: it opens in front of the
//     player exactly as before.
//   SIR, PERMISSION TO DIE, SIR (the Marshal): "When one of your followers would die, you can spend 1 of their
//     Loyalty to have them survive ... If you let them go, mark XP." So a GM's "Dead" is handed to the
//     player, whose window then offers the spare and the let-go box before the death is written.
//
// The flow: whichever client noticed the drop (roster-fate.js, or the Followers tab's own HP box) calls
// openFollowerFate. With a GM connected, the primary GM's client opens the pick (asked by query when the
// noticing client is a player's). The GM's choice is then SETTLED on the player's client (queried back), so
// the Death's Door card is theirs to roll and the Marshal's move is theirs to use; with no player online the
// GM's own client settles it. With no GM connected, the player picks everything, as they always have.

import { FollowerFateDialog } from "./dialogs/FollowerFateDialog.js";
import { isCrewMemberRow, isCustomMemberRow } from "./follower-fate.js";
import { rowButtonData, rowFromButton } from "./follower-roster-shifts.js";
import { ownerUsers, autoOpenUserId } from "../../hooks/DeathsDoorPrompt.js";
import { askGMClient, queryAsker, resolveSync } from "../../utils/foundry-compat.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";
import { sendVerifiable, stillAsking, verifiedAsker } from "../../utils/owner-ask.js";
import { wireLatchedButtons, withCardLatch } from "../../utils/card-latch.js";
import { moveChatCard } from "../../utils/chat.js";
import { escHtml } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

/** Player's client to the GM's: open the GM's pick for this fallen follower. */
export const FOLLOWER_FATE_OPEN_QUERY = "stonetop.followerFateOpen";

/** GM's client to the player's: settle the fate the GM picked. */
export const FOLLOWER_FATE_SETTLE_QUERY = "stonetop.followerFateSettle";

/** How long the GM's client waits for the player's to take a pick, and how long that one checks back (ms). */
const SETTLE_WAIT_MS = 15000;
const SETTLE_VERIFY_MS = 8000;

/** How long the GM's client waits on the player's to say it still wants a late-arriving pick opened (ms). */
const OPEN_VERIFY_MS = 3000;

/** The message flag latching an "out of the action" card's "Decide their fate" button. */
export const FATE_REOPEN_FLAG = "followerFateReopened";
const REOPEN_SELECTOR = ".stonetop-follower-fate-reopen";
const FATE = "stonetop.character.followers.fate";

/** The GM's three outcomes (p.469); a closed window is "not lethal". */
export const GM_FATES = Object.freeze(["dead", "deathsdoor", "dying"]);

/** Whether the GM picks this follower's fate at all: everyone but the companion, whose Loyal to the End replaces it. PURE. */
export function gmPicksFate(fate) {
	return !!fate?.follower && fate.follower !== "animal-companion";
}

/**
 * Who opens the fate window for `fate`: "gm" when a GM is connected and it is the GM's pick, else "player".
 * PURE.
 *
 * @param {object} fate  `{follower, slug, index, name}`
 * @param {{gm?: User|null}} [o]
 */
export function fateOpener(fate, { gm = globalThis.game?.users?.activeGM ?? null } = {}) {
	return gm && gmPicksFate(fate) ? "gm" : "player";
}

/**
 * The player whose client settles a GM's pick: the character's assigned player, else a logged-in player who
 * owns them (DeathsDoorPrompt.js#autoOpenUserId, without its GM rung). Null when none is online. PURE but for
 * the user list.
 */
export function settlingPlayerId(character, { owners = ownerUsers(character) } = {}) {
	return autoOpenUserId((owners ?? []).filter(u => !u?.isGM));
}

/**
 * Open the fate window for a follower of `character` who just went down, on the right client (see the header).
 * Called on exactly one client: the one that noticed the drop.
 *
 * @param {Actor} character
 * @param {object} fate  `{follower, slug, index, name}`
 * @param {object} [deps]  for the tests
 * @returns {Promise<"player"|"gm"|null>}  whose window opened, or null for none
 */
export async function openFollowerFate(character, fate, deps = {}) {
	const { gm = globalThis.game?.users?.activeGM ?? null, me = globalThis.game?.user ?? null, ask = askGMClient, openGm = openGmFatePick } = deps;
	const sheet = character?.sheet;
	if (!sheet || !fate) return null;
	const playerWindow = () => {
		if (typeof sheet._openFollowerFate !== "function") return null;
		sheet._openFollowerFate(fate);
		return "player";
	};
	if (fateOpener(fate, { gm }) !== "gm") return playerWindow();
	if (me?.isGM) return openGm(character, fate) ? "gm" : playerWindow();
	// Verifiable (audit EDG-8): a GM's client lagging past the wait opens nothing once this one has gone ahead with
	// its own window, because it checks back first (handleFollowerFateOpenQuery) and the ask is no longer waited on.
	const opened = await sendVerifiable(askId => ask(gm, FOLLOWER_FATE_OPEN_QUERY, { characterUuid: character.uuid ?? null, fate, userId: me?.id ?? null, askId },
		{ fallback: null, what: "open a follower's fate" }));
	// The GM's client could not be reached after all: the player picks, as with no GM at all.
	return opened ? "gm" : playerWindow();
}

/**
 * The GM's pick window: Death's Door, Dying or Dead, nothing of the player's (gmPick). The choice is settled by
 * settleFatePick. Its Dead is worded as the player's would be: a crew or group member is struck off that roster.
 * Returns the dialog, or null.
 */
export function openGmFatePick(character, fate, { Dialog = FollowerFateDialog, settle = settleFatePick } = {}) {
	if (!character || !fate) return null;
	const dialog = new Dialog(character, {
		name: fate.name, loyalty: 0, gmPick: true,
		isCrewMember: isCrewMemberRow(fate.follower), isGroupMember: isCustomMemberRow(fate.follower),
		// Closed with nothing picked: not lethal, or decided later, and the table is told so (FOE-5).
		onDismiss: () => postFollowerOutOfAction(character, fate).catch(err => console.error("Stonetop | saying a follower is out of the action failed", err)),
	}, action => {
		if (GM_FATES.includes(action)) settle(character, fate, action).catch(err => console.error("Stonetop | settling a follower's fate failed", err));
	});
	dialog.render(true);
	return dialog;
}

/**
 * Settle the GM's pick: on the player's client when one is online (their Death's Door card, their Sir,
 * Permission to Die, Sir), else here. Answers where it was settled.
 *
 * @returns {Promise<"player"|"here"|null>}
 */
export async function settleFatePick(character, fate, action, deps = {}) {
	const { users = globalThis.game?.users, me = globalThis.game?.user ?? null, playerId = settlingPlayerId(character), here = settleHere } = deps;
	if (!character || !GM_FATES.includes(action)) return null;
	const player = playerId && playerId !== me?.id ? users?.get?.(playerId) : null;
	// askGMClient only sends a User query, so it asks a player's client just as well. Verifiable, because on
	// v13 the player's client checks back that this GM sent it (handleFollowerFateSettleQuery). The wait outlasts
	// that check-back, and an ask no longer waited on fails it, so a pick settled here is not settled there too.
	const done = !player ? null : await sendVerifiable(askId => askGMClient(player, FOLLOWER_FATE_SETTLE_QUERY,
		{ characterUuid: character.uuid ?? null, fate, action, userId: me?.id ?? null, askId },
		{ what: "settle a follower's fate (asked of the player's client); the GM's settles it", timeout: SETTLE_WAIT_MS }));
	if (done) return "player";
	await here(character, fate, action);
	return "here";
}

/**
 * Apply a GM's pick on this client: Dead goes through the "would die" window when the Marshal's Sir, Permission
 * to Die, Sir is theirs to use (the sheet's _followerDoorDeath, with the GM's Dead as the death it answers),
 * else is written; Death's Door posts the roll card, Dying its note (the sheet's _resolveFollowerFate).
 */
export async function settleHere(character, fate, action) {
	const sheet = character?.sheet;
	if (!sheet) return false;
	// `stamp`: the roster's number when they fell, so a cut made since finds the member again (FOE-2).
	const { follower, slug = "", index = null, name = "", stamp = null } = fate ?? {};
	if (action === "dead" && typeof sheet._followerDoorDeath === "function") {
		return sheet._followerDoorDeath({ follower, slug, index, name, stamp, gmDead: true });
	}
	if (typeof sheet._resolveFollowerFate !== "function") return false;
	const loyalty = typeof sheet._followerFateLoyalty === "function" ? sheet._followerFateLoyalty(follower, slug) : 0;
	return (await sheet._resolveFollowerFate(action, { name, loyalty, follower, slug, index, stamp })) !== false;
}

/** The character a fate query names, when the asker may act for it: null otherwise. */
function queriedCharacter(data, resolve) {
	const character = typeof data?.characterUuid === "string" ? resolve(data.characterUuid) : null;
	return character?.type === "character" ? character : null;
}

/**
 * FOLLOWER_FATE_OPEN_QUERY on the primary GM's client: the asker must own the character. Answers true once the
 * window is open (the pick itself is not waited on).
 */
export async function handleFollowerFateOpenQuery(data, context = {}, { users = globalThis.game?.users, resolve = resolveSync, open = openGmFatePick, asking = stillAsking } = {}) {
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return false;
	const asker = queryAsker(data, context, users);
	const character = queriedCharacter(data, resolve);
	if (!asker || !character || !character.testUserPermission?.(asker, "OWNER") || !gmPicksFate(data?.fate)) return false;
	// An ask that reached this client late, after the player's gave up waiting and opened its own window, opens no
	// second one (audit EDG-8). An ask from a client without this check carries no id, and is opened as before.
	if (data?.askId && !(await asking(asker, data, { timeout: OPEN_VERIFY_MS }))) return false;
	return !!open(character, data.fate);
}

/**
 * FOLLOWER_FATE_SETTLE_QUERY on the player's client: only a GM may hand a pick over, and only for a character this
 * user owns. On v13 the payload's GM id is the sender's own word, so that GM's client is asked whether it sent
 * it (owner-ask.js#verifiedAsker); a player naming the GM is refused. Answers true once it is being settled.
 */
export async function handleFollowerFateSettleQuery(data, context = {}, { users = globalThis.game?.users, resolve = resolveSync, settle = settleHere, verify = verifiedAsker, asking = stillAsking } = {}) {
	const character = queriedCharacter(data, resolve);
	if (!character?.isOwner || !GM_FATES.includes(data?.action) || !gmPicksFate(data?.fate)) return false;
	const asker = await verify(data, context, users, { timeout: SETTLE_VERIFY_MS });
	if (!asker?.isGM) return false;
	// v14 names the sender, so verify skips its check-back; the GM's client is still asked whether it waits on
	// this, since one that timed out has settled it itself already (audit EDG-15, the late settle). v13's verify asked.
	if (context?.user && !(await asking(asker, data, { timeout: SETTLE_VERIFY_MS }))) return false;
	settle(character, data.fate, data.action).catch(err => console.error("Stonetop | settling a follower's fate failed", err));
	return true;
}

/** Register both queries (from roster-fate.js#registerRosterFateHooks, at init). */
export function registerFollowerFateQueries(queries = globalThis.CONFIG?.queries) {
	if (!queries) return;
	queries[FOLLOWER_FATE_OPEN_QUERY] = (data, context) => handleFollowerFateOpenQuery(data, context);
	queries[FOLLOWER_FATE_SETTLE_QUERY] = (data, context) => handleFollowerFateSettleQuery(data, context);
}

// -- NOT LETHAL, OR DECIDED LATER (round-2 audit FOE-5) ---------------------------------------------
// "If the source of the damage wasn't lethal, then the follower is out of the action until you say otherwise or
// they regain HP" (Book I p.469). A fate window closed with nothing picked is that, or a pick put off: the table is
// told, on a card whose one button opens the pick again for whoever picks (openFollowerFate: the GM when one is
// here). Without it a stray Escape left the follower at 0 HP with no fate and no way back to one.

/** The card's "Decide their fate" button, carrying the fate it reopens (read back with rowFromButton). PURE. */
export function fateReopenButton(fate = {}) {
	return `<div class="stonetop-attack-actions"><button type="button" class="stonetop-follower-fate-reopen" ${rowButtonData(fate)}><i class="fas fa-skull"></i> ${escHtml(localize(`${FATE}.reopenButton`))}</button></div>`;
}

/** Post the "out of the action" card for a fate window closed with nothing picked. */
export async function postFollowerOutOfAction(character, fate) {
	if (!character || !fate?.follower) return null;
	const who = `<strong>${escHtml(fate.name || localize(`${FATE}.outFallbackName`))}</strong>`;
	return globalThis.ChatMessage?.create?.({
		content: moveChatCard(localize(`${FATE}.outTitle`), `<p>${format(`${FATE}.outOfAction`, { name: who })}</p>`, { actions: fateReopenButton(fate) }),
		speaker: globalThis.ChatMessage?.getSpeaker?.({ actor: character }),
	});
}

/** Wire the card's button (stonetop.js renderChatMessageHTML, by way of follower-deaths-door.js), once per card. */
export function wireFollowerFateReopen(message, html) {
	wireLatchedButtons(message, html, {
		selector: REOPEN_SELECTOR, flag: FATE_REOPEN_FLAG, what: "reopening a follower's fate",
		act: (actor, btn, buttons) => withCardLatch(message, FATE_REOPEN_FLAG, true, buttons,
			async () => !!(await openFollowerFate(actor, rowFromButton(btn)))),
	});
}
