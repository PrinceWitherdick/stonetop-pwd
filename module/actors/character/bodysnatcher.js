// ── Bodysnatcher's host (Book I p.149) ─────────────────────────────────────
// "When you possess an unconscious or willing person, lose 1d4 HP and control their actions. ... On a 6-,
// they force you from their body and you mark a consequence. You'll never be able to possess them again.
// When your host takes damage, you lose an equal amount of HP."
//
// WHO THE HOST IS lives on the Ghost: Possess (post-death-actions.js#possess) records the targeted token's
// actor, `{uuid, name}`, in the same write as its 1d4. The record holds only while the Ghost still wears
// Bodysnatcher (possessionHolds), and it goes when the possession ends: the card's End possession, the 6-'s
// "Forced out" button, the Ghost reaching 0 HP (their essence disperses, Tethered), and the Consequence or the
// insert no longer being theirs (onUpdateGhost).
//
// THE HOST'S DAMAGE IS THE GHOST'S HP LOSS, automatically (the user's ruling R1, 2026-10-27). DAMAGE only, as
// printed ("When your host takes damage", the user's ruling 2026-10-28): the damage card's Apply, or a GM typing
// the number down (damage applied by hand, as a rule). HP the host LOSES ("lose 1d4 HP", the Vessel's 2d4, Lend
// it your strength) is no blow, and every such writer says so on its update (HP_LOSS_OPTION). It is read
// where the outgoing HP still is (preUpdateActor, the writer's client), carried on the update's options to
// every client, and lost by the ONE client that answers for the Ghost (hooks/DeathsDoorPrompt.js#answersFor),
// through the plain HP writer (post-death-actions.js#loseHp): HP lost, not damage, so Disembodied does not
// stand in its way. "If your host dies while you still have HP, you can keep them alive" stays the table's.
//
// Kept free of the heavy imports (the sheet, the attack flow) so the roll options table can read it: the
// three that need them are handed in, or imported when first used.

import { SYSTEM_ID } from "../../system-id.js";
import { readableFlags, HP_CEILING_OPTION, HP_LOSS_OPTION } from "./StonetopFlags.js";
import { isOutOfPlay } from "./deaths-door-actor.js";
import { deletionEntry } from "../../utils/foundry-compat.js";
import { escHtml } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

export const BODYSNATCHER = "Bodysnatcher";

/** The Ghost's Consequence, as its count is keyed in the insert's lore. */
const BODYSNATCHER_LORE = "consequences:bodysnatcher";

/** Actor flag key (under the system scope) holding the host: `{uuid, name}`. */
export const HOST_FLAG = "bodysnatcherHost";

/** Update option carrying the HP a write just took off a possessed host, from the preUpdate half to every client. */
export const HOST_HP_LOST_OPTION = "stonetopHostHpLost";

const KEY = "stonetop.postDeathMoves";

/** Whether this character is a Ghost holding BODYSNATCHER and still in play: the only one a record speaks for. */
export function possessionHolds(actor) {
	if (actor?.type !== "character" || isOutOfPlay(actor)) return false;
	const flags = readableFlags(actor);
	return flags.postDeathInsert?.slug === "ghost" && Number(flags.postDeathLore?.counts?.[BODYSNATCHER_LORE]) > 0;
}

/** The host as recorded, whether or not it still holds. */
function storedHost(actor) {
	const host = readableFlags(actor)?.[HOST_FLAG];
	return host?.uuid ? { uuid: String(host.uuid), name: String(host.name ?? "") } : null;
}

/** The person this Ghost possesses, `{uuid, name}`, or null. */
export function possessedHost(actor) {
	return possessionHolds(actor) ? storedHost(actor) : null;
}

/** The record as an update fragment. */
export function hostUpdate(host) {
	return { [`flags.${SYSTEM_ID}.${HOST_FLAG}`]: { uuid: host.uuid, name: host.name } };
}

/** The record's removal as an update fragment (writes nothing harmful where there is none). */
export function endPossessionUpdate() {
	return Object.fromEntries([deletionEntry(`flags.${SYSTEM_ID}.${HOST_FLAG}`)]);
}

/**
 * Every Ghost possessing `host` (an Actor, a token's synthetic one included), out of `actors`. Runs on every
 * HP write, so the cheap record match comes before the in-play check (possessionHolds), which resolves flags.
 */
export function possessorsOf(host, actors = globalThis.game?.actors ?? []) {
	if (!host?.uuid) return [];
	const found = [];
	for (const a of actors) {
		if (a === host || a?.uuid === host.uuid) continue;
		if (storedHost(a)?.uuid === host.uuid && possessionHolds(a)) found.push(a);
	}
	return found;
}

/** Whether `changes` wrote this character's current HP and left it at 0 or less (read after the write lands). */
export function wroteZeroHp(actor, changes) {
	const hpWritten = globalThis.foundry?.utils?.getProperty?.(changes, "system.attributes.hp.value") !== undefined;
	return hpWritten && (Number(actor?.system?.attributes?.hp?.value) || 0) <= 0;
}

/** The HP a write takes off: before less after, floored at 0 on both. PURE. */
export function hostHpLost(oldHp, newHp) {
	const before = Math.max(0, Number(oldHp) || 0);
	const after = Number(newHp);
	if (!Number.isFinite(after)) return 0;
	return Math.max(0, before - Math.max(0, after));
}

// ── The roll card ──────────────────────────────────────────────────────────

/**
 * Bodysnatcher's own roll card (move-roll-options.js): its 6- row carries "Forced out: mark a consequence",
 * which the card buttons pay (post-death-actions.js#pressCardButton): a Consequence and the end of the
 * possession, in one write. Only for a Ghost who holds the Consequence; null for anyone else.
 */
export function bodysnatcherRollOptions(actor) {
	if (!possessionHolds(actor)) return null;
	const label = escHtml(localize(`${KEY}.forcedOut`));
	return { tierActions: {
		failure: `<button type="button" class="stonetop-pd-card-btn stonetop-pd-forced-out" data-key="forced-out" data-move="${BODYSNATCHER}"><i class="fas fa-person-walking-arrow-right"></i> ${label}</button>`,
	} };
}

// ── The hooks ──────────────────────────────────────────────────────────────

/** The three collaborators the hooks need, imported when first asked for unless a test hands them in. */
async function collaborators(deps = {}) {
	const out = { ...deps };
	if (!out.loseHp) out.loseHp = (await import("./post-death-actions.js")).loseHp;
	if (!out.answersFor) out.answersFor = (await import("../../hooks/DeathsDoorPrompt.js")).answersFor;
	if (!out.postMoveNote) out.postMoveNote = (await import("../../utils/chat.js")).postMoveNote;
	return out;
}

/**
 * preUpdateActor, on the writer's client: what this write takes off a possessed host's HP, onto the options.
 * Not a fall in max (HP_CEILING_OPTION) and not HP lost rather than damage taken (HP_LOSS_OPTION). Never
 * throws, since a throw here would stop the damage being written at all.
 */
export function onPreUpdateHost(actor, changes, options, { actors } = {}) {
	try {
		if (!options || options[HP_CEILING_OPTION] || options[HP_LOSS_OPTION]) return;
		const raw = globalThis.foundry?.utils?.getProperty?.(changes, "system.attributes.hp.value");
		if (raw === undefined) return;
		if (!possessorsOf(actor, actors).length) return;
		const lost = hostHpLost(actor.system?.attributes?.hp?.value, raw);
		if (lost > 0) options[HOST_HP_LOST_OPTION] = lost;
	} catch (err) {
		console.error("Stonetop | reading a possessed host's HP lost failed", err);
	}
}

/**
 * updateActor, on every client: each Ghost possessing this host loses as much HP, on the one client that
 * answers for that Ghost. Resolves to the Ghosts that lost it.
 */
export async function onUpdateHost(actor, _changes, options, _userId, { actors, ...deps } = {}) {
	const lost = Number(options?.[HOST_HP_LOST_OPTION]) || 0;
	if (lost <= 0) return [];
	const ghosts = possessorsOf(actor, actors);
	if (!ghosts.length) return [];
	const { loseHp, answersFor } = await collaborators(deps);
	const paid = [];
	for (const ghost of ghosts) {
		if (!answersFor(ghost)) continue;
		const host = possessedHost(ghost)?.name || actor.name || "";
		await loseHp(ghost, String(lost), { moveName: BODYSNATCHER, detail: format(`${KEY}.hostHurt`, { host, n: lost }) });
		paid.push(ghost);
	}
	return paid;
}

/**
 * updateActor, on the writer's client (who could write this character, having just done so): the record
 * goes when the possession can no longer stand. At 0 HP their essence disperses (Tethered) and the card
 * says they were forced out; a Consequence cleared, an insert swapped or a character out of play drops it
 * quietly. Resolves to whether it went.
 */
export async function onUpdateGhost(actor, changes, _options, userId, deps = {}) {
	if (actor?.type !== "character" || !storedHost(actor)) return false;
	if (userId && userId !== globalThis.game?.user?.id) return false;
	const atZero = wroteZeroHp(actor, changes);
	const holds = possessionHolds(actor);
	if (holds && !atZero) return false;
	const host = storedHost(actor);
	await actor.update(endPossessionUpdate(), { stonetopMove: BODYSNATCHER });
	if (holds) {
		const { postMoveNote } = await collaborators(deps);
		await postMoveNote(actor, BODYSNATCHER, format(`${KEY}.possessionEndedAtZero`, { name: actor.name ?? "", host: host.name }));
	}
	return true;
}

/**
 * Listen. Registered once, from stonetop.js.
 * @returns {() => void} stops listening
 */
export function installBodysnatcherHooks({ hooks = globalThis.Hooks } = {}) {
	const ids = [
		["preUpdateActor", hooks.on("preUpdateActor", (actor, changes, options) => onPreUpdateHost(actor, changes, options))],
		["updateActor", hooks.on("updateActor", (actor, changes, options, userId) => {
			onUpdateHost(actor, changes, options, userId).catch(err => console.error("Stonetop | Bodysnatcher could not mirror the host's damage", err));
			onUpdateGhost(actor, changes, options, userId).catch(err => console.error("Stonetop | Bodysnatcher could not end a possession", err));
		})],
	];
	return () => { for (const [name, id] of ids) hooks.off(name, id); };
}
