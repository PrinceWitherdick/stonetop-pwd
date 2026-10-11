import { SYSTEM_ID } from "../system-id.js";
import { answersFor } from "../hooks/DeathsDoorPrompt.js";
import { playsCharacter, whisperFor } from "../utils/playbook-actors.js";
import { isGmToolkitData, theGmToolkit } from "../actors/gmtoolkit/gm-toolkit-actor.js";
import { anyActiveGM } from "../utils/primary-gm.js";
import { deletionEntry } from "../utils/foundry-compat.js";
import { stonetopChatCard } from "../utils/chat.js";
import { layModes } from "../utils/roll-mode.js";
import { dieResultsText, markMissXp, rollStat } from "../utils/roll-engine.js";
import { ROLLED_FLAG } from "../utils/counted-tier.js";
import { format } from "../utils/i18n.js";
import { WE_HAPPY_FEW, fightStateActive } from "../actors/character/fight-states.js";
import {
	ROW_KIND, SPOTS, STRUGGLE_ASK_FLAG, STRUGGLE_FLAG, STRUGGLE_MESSAGE_FLAG, STRUGGLE_MOVE, STRUGGLE_ROLL_FLAG,
	STRUGGLE_STATUS, TIER, allowedStats, bundleChoices, halfMissesFor, isLive, newStruggleRecord, readStruggle,
	readStruggleRoll, rescueTargets, struggleBoard,
} from "./struggle-rules.js";
import { struggleCalledRows, struggleSummaryRows } from "./struggle-view.js";

/**
 * THE STRUGGLE'S DOCUMENTS. The rules are struggle-rules.js and the words are struggle-view.js; this
 * file reads and writes the actors and the chat log.
 *
 *  1. The struggle is one record on the GM Toolkit (STRUGGLE_FLAG), and only a GM writes it: calling
 *     it, sharing the results, ending it.
 *  2. Everything a player decides is written to their OWN character (STRUGGLE_ROLL_FLAG): their dice,
 *     the person their 10+ gets out, a Judge's Bundle of Sticks pick. A follower's row is written to
 *     the character who rolls for them.
 *  3. ONE CLIENT DRIVES A ROW, elected the way Make Camp elects who pays a share: the player the
 *     character is assigned to, then any logged-in player who owns them, then a GM. A GM owns every
 *     character, so without this the GM would get a second set of everybody's buttons; with it, the
 *     GM rolls only for the characters whose players are away.
 *
 * No socket, for the same reason as Make Camp: Foundry sends every actor update to every client.
 */

const STRUGGLE_PATH = `flags.${SYSTEM_ID}.${STRUGGLE_FLAG}`;
const ROLL_PATH     = `flags.${SYSTEM_ID}.${STRUGGLE_ROLL_FLAG}`;
const ASK_PATH      = `flags.${SYSTEM_ID}.${STRUGGLE_ASK_FLAG}`;

/** Bookkeeping, not an event in a character's life: the ledger hears about the XP, not the dice. */
const QUIET = { stonetopLedger: true };

/** Where the struggle is kept: the world's one GM Toolkit. */
export function struggleHost() {
	return theGmToolkit();
}

/** Whether an actor is the struggle's host. The type test first, so a character's update never scans the world. */
export function isStruggleHost(actor) {
	return isGmToolkitData(actor) && !!actor.id && actor.id === struggleHost()?.id;
}

/** The struggle on record, whatever state it is in, or null. */
export function currentStruggle() {
	return readStruggle(struggleHost()?.getFlag?.(SYSTEM_ID, STRUGGLE_FLAG));
}

/** The struggle being played right now, or null. */
export function liveStruggle() {
	const struggle = currentStruggle();
	return isLive(struggle) ? struggle : null;
}

/** A character's part of a struggle. */
export function recordOf(actor, struggleId) {
	return readStruggleRoll(actor?.getFlag?.(SYSTEM_ID, STRUGGLE_ROLL_FLAG), struggleId);
}

/** The struggle worked out from every participant's record, and every roll message this client can read. */
export function boardFor(struggle) {
	const records = new Map();
	const recordFor = actorId => {
		if (!records.has(actorId)) records.set(actorId, recordOf(game.actors?.get(actorId), struggle?.id));
		return records.get(actorId);
	};
	const liveTotals = {};
	for (const row of struggle?.rows ?? []) {
		const messageId = recordFor(row.actorId)?.rolls?.[row.key]?.messageId;
		const total = messageId ? game.messages?.get?.(messageId)?.rolls?.[0]?.total : null;
		if (Number.isFinite(total)) liveTotals[row.key] = total;
	}
	return struggleBoard(struggle, recordFor, { liveTotals });
}

/** Whether THIS client drives a character's rows: the one that answers for them. */
const drivesActor = answersFor;

/** How this client reads a struggle: whose rows it drives, and whose characters its user plays. */
export function readerFor(struggle, user = game.user) {
	const drives = new Set();
	const mine = new Set();
	for (const row of struggle?.rows ?? []) {
		const actor = game.actors?.get(row.actorId);
		if (!actor) continue;
		if (drivesActor(actor)) drives.add(row.key);
		if (playsCharacter(actor, user)) mine.add(row.key);
	}
	return { isGM: !!user?.isGM, drives, mine };
}

/** Whether this client belongs in a struggle's window at all: a GM, or anybody rolling or played in it. */
export function takesPart(struggle, user = game.user) {
	const reader = readerFor(struggle, user);
	return reader.isGM || reader.drives.size > 0 || reader.mine.size > 0;
}

/**
 * Whether this client still has a roll to make: the one case where the window pops up by itself
 * after a reload, rather than waiting to be reopened.
 */
export function owesARoll(struggle) {
	if (struggle?.status !== STRUGGLE_STATUS.ROLLING) return false;
	const reader = readerFor(struggle);
	const board = boardFor(struggle);
	return board.waiting.some(row => reader.drives.has(row.key));
}

// ── ASKING ─────────────────────────────────────────────────────────────────────────────────────

/** A player's ask on a character, or null. */
export function askOf(actor) {
	const raw = actor?.getFlag?.(SYSTEM_ID, STRUGGLE_ASK_FLAG);
	if (!raw?.id) return null;
	return {
		id: String(raw.id),
		danger: String(raw.danger ?? ""),
		approach: String(raw.approach ?? ""),
		userId: String(raw.userId ?? ""),
		at: Number(raw.at) || 0,
	};
}

/** Every character with an ask waiting on the GM. */
export function pendingAsks() {
	return (game.actors?.contents ?? [])
		.filter(a => a?.type === "character")
		.map(actor => ({ actor, ask: askOf(actor) }))
		.filter(({ ask }) => !!ask)
		.sort((a, b) => a.ask.at - b.ask.at);
}

/** The asks this client made this session, by character: how it tells a turned-down ask from a taken one. */
const myAsks = new Map();

/**
 * Ask the GM to call a Struggle as One. Anyone can ask; the GM decides (the user's rule, and the
 * book's: "When you call for them to Struggle as One, clarify the danger and the stakes", p.328).
 *
 * @returns {Promise<{ok: boolean, reason?: string}>}  reason "no-gm" when there is no GM to ask
 */
export async function askForStruggle(actor, { danger = "", approach = "" } = {}) {
	if (!anyActiveGM()) return { ok: false, reason: "no-gm" };
	const ask = { id: foundry.utils.randomID(), danger: String(danger).trim(), approach: String(approach).trim(), userId: game.user?.id ?? "", at: Date.now() };
	myAsks.set(actor.id, ask.id);
	await actor.update({ [ASK_PATH]: ask }, QUIET);
	return { ok: true };
}

/** Take a character's ask down: the GM answering it either way. */
export async function clearAsk(actor) {
	if (!askOf(actor)) return;
	const [key, value] = deletionEntry(ASK_PATH);
	await actor.update({ [key]: value }, QUIET);
}

/**
 * Whether an update took a character's ask down, and this client made it and the GM did not take it
 * up: the one moment its player hears "the GM didn't call it".
 */
export function askTurnedDown(actor, changes) {
	if (!myAsks.has(actor?.id) || !touchesFlag(changes, STRUGGLE_ASK_FLAG) || askOf(actor)) return false;
	const askId = myAsks.get(actor.id);
	myAsks.delete(actor.id);
	const struggle = currentStruggle();
	// Answered by a struggle the GM called on its own, with this character in it, is answered too.
	return struggle?.id !== askId && !(isLive(struggle) && struggle.rows.some(r => r.actorId === actor.id));
}

// ── CALLING IT ─────────────────────────────────────────────────────────────────────────────────

/**
 * Call the struggle: write it onto the toolkit, give every character in it a fresh record, and tell
 * the table. GM only.
 *
 * @param {object} setup  {danger, approach, journey, rows, helpers, askId, askActorId}
 * @returns {Promise<{ok: boolean, reason?: string, struggle?: object}>}
 */
export async function startStruggle(setup) {
	if (!game.user?.isGM) return { ok: false, reason: "not-gm" };
	const host = struggleHost();
	if (!host) return { ok: false, reason: "no-host" };
	if (liveStruggle()) return { ok: false, reason: "live" };
	const record = newStruggleRecord({
		id: setup.askId || foundry.utils.randomID(),
		danger: setup.danger,
		approach: setup.approach,
		journey: setup.journey,
		rows: setup.rows,
		helpers: setup.helpers,
		askedBy: setup.askActorId ?? "",
		now: Date.now(),
	});
	if (!record?.rows.length) return { ok: false, reason: "empty" };
	// Each character's leftovers from the last struggle go first, so no row can read as rolled before
	// anyone has touched the dice. One write each, the record's two maps removed and its id stamped.
	await Promise.all([...new Set(record.rows.map(r => r.actorId))]
		.map(actorId => game.actors?.get(actorId))
		.filter(Boolean)
		.map(actor => resetRecord(actor, record.id)));
	await host.update({ [STRUGGLE_PATH]: record }, QUIET);
	await postCard("Struggle as One", struggleCalledRows(record));
	// The ask it answers is taken down after, so its player's client already sees the struggle
	// (askTurnedDown) and does not read the ask going away as a no. So is any other ask from a character
	// it calls on: that player is in it now, and an ask left up would open a stale setup once it ends.
	const askers = new Set([setup.askActorId, ...record.rows.map(r => r.actorId)].filter(Boolean));
	for (const actorId of askers) {
		const asker = game.actors?.get(actorId);
		if (asker && askOf(asker)) await clearAsk(asker);
	}
	return { ok: true, struggle: record };
}

async function resetRecord(actor, struggleId) {
	const [rollsKey, rollsValue] = deletionEntry(`${ROLL_PATH}.rolls`);
	const [savesKey, savesValue] = deletionEntry(`${ROLL_PATH}.saves`);
	const update = { [`${ROLL_PATH}.id`]: struggleId, [`${ROLL_PATH}.bundleAlly`]: "" };
	if (actor.getFlag?.(SYSTEM_ID, STRUGGLE_ROLL_FLAG)?.rolls) update[rollsKey] = rollsValue;
	if (actor.getFlag?.(SYSTEM_ID, STRUGGLE_ROLL_FLAG)?.saves) update[savesKey] = savesValue;
	await actor.update(update, QUIET);
}

/** A character's record, made fresh for this struggle when it is not already this struggle's. */
async function ensureRecord(actor, struggleId) {
	if (actor.getFlag?.(SYSTEM_ID, STRUGGLE_ROLL_FLAG)?.id === struggleId) return;
	await resetRecord(actor, struggleId);
}

// ── ROLLING ────────────────────────────────────────────────────────────────────────────────────

/** Rows this client is rolling right now: a double click must not roll twice. */
const rolling = new Set();

/**
 * The move's own printed text: every roll card carries the move's ladder. fetchMoveRef caches it.
 * Laid out by `moveCardBody` as an item move's card is, since the raw prose has no ladder for
 * the card to mark the rolled rung on.
 */
async function struggleMoveText() {
	try {
		const { fetchMoveRef } = await import("../utils/move-refs.js");
		const { moveCardBody } = await import("../utils/move-tiers.js");
		return moveCardBody((await fetchMoveRef(STRUGGLE_MOVE)) ?? "", null);
	} catch {
		return "";
	}
}

/**
 * Roll one row. Only its driver may, only while the struggle is rolling, and only once.
 *
 * Through the character's own roll path for a PC (onDirectStatRoll), so forward, ongoing, a
 * debility and a held advantage all count as they do on any other roll, and through the Order
 * Followers roll for a follower (+0/+1/+2 instead of +STAT). Either way: the card goes only to its
 * player and the GM, and the automatic XP for a 6- is held back, because "If you roll a 6- but
 * someone saves you, don't mark XP" can only be answered when the struggle ends (endStruggle).
 *
 * @param {string} rowKey
 * @param {object} [opts]
 * @param {string} [opts.stat]  the stat the player picked, for a PC row
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function rollRow(rowKey, { stat = "" } = {}) {
	const struggle = liveStruggle();
	if (struggle?.status !== STRUGGLE_STATUS.ROLLING) return { ok: false, reason: "closed" };
	const row = struggle.rows.find(r => r.key === rowKey);
	const actor = row ? game.actors?.get(row.actorId) : null;
	if (!row || !actor) return { ok: false, reason: "gone" };
	if (!drivesActor(actor)) return { ok: false, reason: "not-yours" };
	const boardRow = boardFor(struggle).byKey.get(rowKey);
	if (boardRow?.rolled) return { ok: false, reason: "rolled" };
	const allowed = allowedStats(row);
	const statKey = row.kind === ROW_KIND.PC ? (allowed.includes(stat) ? stat : allowed[0]) : "";
	if (rolling.has(rowKey)) return { ok: false, reason: "rolling" };
	rolling.add(rowKey);
	try {
		await ensureRecord(actor, struggle.id);
		const { mode, adv, dis } = boardRow.rollMode;
		// A roll already in the log for this row IS its roll: a reload that landed between the dice and the
		// record below left the row looking unrolled, and rolling it again would be a second try at it.
		const posted = postedRoll(struggle.id, rowKey);
		if (posted) {
			const roll = posted.rolls?.[0];
			await writeRowRoll(actor, rowKey, {
				stat: posted.getFlag?.(SYSTEM_ID, ROLLED_FLAG)?.stat ?? statKey,
				roll, mode, messageId: posted.id,
			});
			return { ok: true };
		}
		const halfMiss = halfMissesFor(row, struggle)[0] ?? "";
		const nonce = foundry.utils.randomID();
		const options = {
			// The board's sides, not only the mode they net to (roll-mode.js#layModes): a GM's disadvantage
			// cancelled by an Aid stays cancelled when the roll lays a debility or a held promise on it.
			...layModes({ rollMode: "normal" }, [adv.length ? "adv" : "", dis.length ? "dis" : ""]),
			noXpOnMiss: true,
			// Shown before the GM shares it: every GM, and everyone who plays the character.
			whisper: whisperFor(actor),
			moveDescription: await struggleMoveText(),
			messageFlags: { [SYSTEM_ID]: { [STRUGGLE_MESSAGE_FLAG]: { id: struggle.id, row: rowKey, nonce } } },
			conditionNotes: [
				...adv.filter(s => s !== "The GM").map(s => `${s}: advantage`),
				...dis.filter(s => s !== "The GM").map(s => `${s}: disadvantage`),
			],
			...(halfMiss ? { missCountsAsPartial: halfMiss } : {}),
		};
		let roll;
		if (row.kind === ROW_KIND.FOLLOWER) {
			// The character's shaken nerves ride a follower's roll as they ride Order Followers' own
			// (StonetopCharacter#onOrderFollowersRoll): giving orders is still that character rolling.
			const nerves = fightStateActive(actor, "nerves");
			roll = await rollStat("follower", actor, {
				...(nerves ? layModes(options, ["dis"]) : options),
				...(nerves ? { conditionNotes: [...options.conditionNotes, format("stonetop.nerves.rollNote", { move: WE_HAPPY_FEW })] } : {}),
				statValue: row.bonus,
				modifier: 0,
				moveName: `${row.name}: ${STRUGGLE_MOVE}`,
			});
		} else {
			// Aimed at the struggle, not at whoever this user has targeted on the map: no grudge rides it.
			roll = await actor.typedActor.onDirectStatRoll(statKey, { ...options, moveName: STRUGGLE_MOVE, targets: [] });
		}
		if (!roll) return { ok: false, reason: "no-roll" };
		const message = (game.messages?.contents ?? [])
			.findLast(m => m?.getFlag?.(SYSTEM_ID, STRUGGLE_MESSAGE_FLAG)?.nonce === nonce);
		await writeRowRoll(actor, rowKey, { stat: statKey, roll, mode, messageId: message?.id ?? "" });
		return { ok: true };
	} finally {
		rolling.delete(rowKey);
	}
}

/** This struggle's roll card for a row, when there is one in this client's log. */
function postedRoll(struggleId, rowKey) {
	return (game.messages?.contents ?? []).findLast(m => {
		const tag = m?.getFlag?.(SYSTEM_ID, STRUGGLE_MESSAGE_FLAG);
		return tag?.id === struggleId && tag?.row === rowKey;
	}) ?? null;
}

/** A row's roll, written on the character who rolled it. */
async function writeRowRoll(actor, rowKey, { stat, roll, mode, messageId }) {
	await actor.update({
		[`${ROLL_PATH}.rolls.${rowKey}`]: {
			stat,
			total: roll?.total,
			dice: dieResultsText(roll),
			mode,
			messageId,
			at: Date.now(),
		},
	}, QUIET);
}

/**
 * A Judge's A Bundle of Sticks Unbroken: the ally who rolls with advantage beside them. Written on the
 * Judge, by the Judge's driver, before that ally rolls.
 */
export async function setBundleAlly(rowKey, allyKey) {
	const struggle = liveStruggle();
	if (struggle?.status !== STRUGGLE_STATUS.ROLLING) return;
	const row = struggle.rows.find(r => r.key === rowKey);
	const actor = row ? game.actors?.get(row.actorId) : null;
	if (!actor || !drivesActor(actor)) return;
	const board = boardFor(struggle);
	const judge = board.byKey.get(rowKey);
	if (allyKey && !bundleChoices(board, judge).some(r => r.key === allyKey)) return;
	await ensureRecord(actor, struggle.id);
	await actor.update({ [`${ROLL_PATH}.bundleAlly`]: allyKey || "" }, QUIET);
}

// ── SHARING, SPOTS AND RESCUES ─────────────────────────────────────────────────────────────────

/** Write the toolkit's record. GM only, and only onto the struggle it was read from. */
async function writeStruggle(struggle, patch) {
	const host = struggleHost();
	if (!game.user?.isGM || !host || currentStruggle()?.id !== struggle.id) return false;
	const update = {};
	for (const [key, value] of Object.entries(patch)) update[`${STRUGGLE_PATH}.${key}`] = value;
	await host.update(update, QUIET);
	return true;
}

/**
 * Share every result with the table: the struggle moves on to spots and rescues, and each roll's
 * chat card, whispered until now, becomes a public one, the same as core's "Reveal to Everyone".
 */
export async function revealStruggle() {
	const struggle = liveStruggle();
	if (struggle?.status !== STRUGGLE_STATUS.ROLLING) return false;
	if (!(await writeStruggle(struggle, { status: STRUGGLE_STATUS.REVEALED }))) return false;
	await Promise.all(boardFor(struggle).rows
		.map(row => (row.roll?.messageId ? game.messages?.get?.(row.roll.messageId) : null))
		.filter(message => message?.whisper?.length)
		.map(message => message.update({ whisper: [], blind: false })));
	return true;
}

/** The GM's call on how several people in a spot are placed (p.329). */
export async function setSpots(spots) {
	const struggle = liveStruggle();
	if (struggle?.status !== STRUGGLE_STATUS.REVEALED || !Object.values(SPOTS).includes(spots)) return;
	await writeStruggle(struggle, { spots });
}

/** A Judge outside the struggle jumps in: +1 to a row's roll (Many Hands Make Light Work). GM only. */
export async function bumpRow(rowKey, by) {
	const struggle = liveStruggle();
	if (!struggle) return;
	const rows = struggle.rows.map(r => (r.key === rowKey ? { ...r, bump: 1, bumpBy: String(by ?? "") } : r));
	await writeStruggle(struggle, { rows });
}

/** Take a row out before it rolls: a player gone quiet, or somebody the GM should not have called. GM only. */
export async function leaveOut(rowKey) {
	const struggle = liveStruggle();
	if (struggle?.status !== STRUGGLE_STATUS.ROLLING) return;
	if (boardFor(struggle).byKey.get(rowKey)?.rolled) return;
	await writeStruggle(struggle, { rows: struggle.rows.filter(r => r.key !== rowKey) });
}

/**
 * A 10+ gets someone out of their spot, "if you can tell us how" (p.78). Written on the rescuer's
 * character by their driver. In separate spots it names one person; in one shared spot, everybody in it.
 */
export async function rescue(rescuerKey, targetKeys) {
	const struggle = liveStruggle();
	if (struggle?.status !== STRUGGLE_STATUS.REVEALED) return;
	const row = struggle.rows.find(r => r.key === rescuerKey);
	const actor = row ? game.actors?.get(row.actorId) : null;
	if (!actor || !drivesActor(actor)) return;
	const board = boardFor(struggle);
	if (board.byKey.get(rescuerKey)?.tier !== TIER.SUCCESS) return;
	const allowed = new Set(rescueTargets(board, rescuerKey, struggle.spots).map(r => r.key));
	const targets = [...new Set(targetKeys)].filter(key => allowed.has(key));
	if (!targets.length) return;
	await ensureRecord(actor, struggle.id);
	await actor.update({ [`${ROLL_PATH}.saves.${rescuerKey}`]: struggle.spots === SPOTS.TOGETHER ? targets : targets.slice(0, 1) }, QUIET);
}

/** Take a rescue back: its player changing their mind, or the GM ruling it doesn't hold up. */
export async function undoRescue(rescuerKey) {
	const struggle = liveStruggle();
	if (struggle?.status !== STRUGGLE_STATUS.REVEALED) return;
	const row = struggle.rows.find(r => r.key === rescuerKey);
	const actor = row ? game.actors?.get(row.actorId) : null;
	if (!actor || !(drivesActor(actor) || game.user?.isGM)) return;
	await actor.update({ [`${ROLL_PATH}.saves.${rescuerKey}`]: [] }, QUIET);
}

// ── ENDING IT ──────────────────────────────────────────────────────────────────────────────────

/** Struggles this client is ending: the GM pressing End twice marks nobody's XP twice. */
const ending = new Set();

/**
 * Who a struggle's miss receipt is written as: a player of the character, one who is logged in first, so the
 * receipt's Undo is theirs. Null when only a GM plays them.
 *
 * Plays, not merely owns (playbook-actors.js#playsCharacter), as the asking cards and the end of a session
 * ask it: at a table where every player owns every sheet, ownership picked whoever came first in the list.
 */
export function struggleReceiptAuthor(actor, users = game.users) {
	const players = [...(users?.contents ?? users ?? [])].filter(user => !user.isGM && playsCharacter(actor, user));
	return (players.find(user => user.active) ?? players[0])?.id ?? null;
}

/**
 * End the struggle: everyone still in a spot marks the XP their 6- earned, and the table gets the
 * summary. GM only.
 *
 * The record says it is closed BEFORE the XP is marked, so a second press, or a second GM, finds it
 * closed and marks nothing. The keys marked ride on that same write.
 */
export async function endStruggle() {
	const struggle = liveStruggle();
	if (struggle?.status !== STRUGGLE_STATUS.REVEALED || ending.has(struggle.id)) return false;
	ending.add(struggle.id);
	try {
		const board = boardFor(struggle);
		const owed = board.xpOwed;
		const closed = await writeStruggle(struggle, {
			status: STRUGGLE_STATUS.CLOSED,
			closedAt: Date.now(),
			xpMarked: owed.map(o => o.key),
		});
		if (!closed) return false;
		for (const { actorId } of owed) {
			const actor = game.actors?.get(actorId);
			// Out loud, since the results are shared by now, and written as the character's player: a GM-written
			// receipt is the GM's to Undo (a chat message is "the GM, or whoever authored it" to change), and the
			// GM's own chat mode would have whispered it away from the player whose XP it is.
			if (actor?.type === "character") {
				await markMissXp(actor, STRUGGLE_MOVE, { rollMode: "publicroll", author: struggleReceiptAuthor(actor) });
			}
		}
		await postCard("Struggle as One: how it went", struggleSummaryRows(struggle, board));
		return true;
	} finally {
		ending.delete(struggle.id);
	}
}

/** Call the struggle off while it is still being rolled. Nothing is marked and nothing is posted. GM only. */
export async function cancelStruggle() {
	const struggle = liveStruggle();
	if (struggle?.status !== STRUGGLE_STATUS.ROLLING) return false;
	return writeStruggle(struggle, { status: STRUGGLE_STATUS.CANCELLED, closedAt: Date.now() });
}

// ── CARDS AND WATCHING ─────────────────────────────────────────────────────────────────────────

async function postCard(title, rowsHtml) {
	if (!globalThis.ChatMessage?.create || !rowsHtml) return;
	const content = stonetopChatCard(title,
		`<div class="card-content"><ul class="stonetop-homestead-chat-list">${rowsHtml}</ul></div>`,
		"stonetop-homestead-chat-card");
	// Spoken as the move, not as the GM's assigned toolkit, which would head the card "GM Toolkit".
	await ChatMessage.create({ content, speaker: { alias: STRUGGLE_MOVE } });
}

/** Whether an actor update wrote, or removed, one of this feature's flags. */
export function touchesFlag(changes, flag) {
	const scoped = changes?.flags?.[SYSTEM_ID];
	return !!scoped && Object.keys(scoped).some(key => key.replace(/^-=/, "") === flag);
}

/** Whether an update to the toolkit moved the struggle to a new state (called, shared, ended). */
export function struggleStateChanged(changes) {
	const delta = changes?.flags?.[SYSTEM_ID]?.[STRUGGLE_FLAG];
	return !!delta && typeof delta === "object" && ("status" in delta || "id" in delta);
}

