// The order Character Introductions go around the table in, held by the introductions themselves.
//
// WHY NOT THE COMBAT TRACKER, which is where this order lived until the Fight tab replaced it. The
// dialog used to create a Combat, drop every player character into it and read the order back as
// initiative, so "set the order" meant rolling or typing initiative in a tracker that has nothing to
// do with introductions. Two things went wrong with that the moment fights got a tab of their own:
//  • THE TRACKER NO LONGER HAS INITIATIVE. Stonetop has no turn order in a fight (Book I p.417), so
//    the tab that replaces it shows engagements instead, and there is nowhere left to type a number.
//  • OPENING INTRODUCTIONS JOINED A FIGHT. It added every PC to whatever `game.combat` happened to be,
//    so a table that opened the window with a fight running on the scene put the whole party into
//    that fight, tokenless.
//
// So the order is a world setting of its own: a list of actor ids, written only by a GM, read by
// everyone. A world that had already arranged its table in the tracker keeps that order: the first
// time a GM opens the window, the old turn order is copied across once (`adoptLegacyIntroOrder`),
// and from then on the setting is the only thing read.
//
// The arithmetic is pure and unit-tested; only the last four functions touch Foundry.

import { getObjectSetting, setSetting } from "../settings.js";
import { getPlayerCharacters } from "./playbook-actors.js";
import { isActingPrimaryGM } from "./primary-gm.js";
import { moveWithin } from "./list-reorder.js";
import { isFight } from "../fight/fight-state.js";

/** The world setting holding `{ids: string[], adopted: "combat"|"none"}`. See settings.js. */
export const INTRO_ORDER_SETTING = "introductionsOrder";

/**
 * The roster in introduction order: the saved order first (names no longer on the roster dropped,
 * duplicates dropped), then anyone the saved order does not mention, in roster order.
 *
 * APPENDED RATHER THAN LEFT OUT. A character made after the order was set has not been placed yet,
 * not refused a turn, and a pre-check that silently skipped them would begin without them.
 *
 * @param {Array<{id: string}>} actors  the player characters, in world order
 * @param {string[]} storedIds          the saved order
 * @returns {Array} the same actor objects, reordered
 */
export function orderForIntroductions(actors = [], storedIds = []) {
	const roster = (Array.isArray(actors) ? actors : []).filter(actor => typeof actor?.id === "string");
	const byId = new Map(roster.map(actor => [actor.id, actor]));
	const seen = new Set();
	const ordered = [];
	for (const id of Array.isArray(storedIds) ? storedIds : []) {
		const actor = byId.get(id);
		if (!actor || seen.has(id)) continue;
		seen.add(id);
		ordered.push(actor);
	}
	for (const actor of roster) {
		if (seen.has(actor.id)) continue;
		seen.add(actor.id);
		ordered.push(actor);
	}
	return ordered;
}

/** Foundry's `Number.isNumeric`, which a pure module cannot reach: null and "" are not numbers. */
function isNumeric(value) {
	if (value === null || value === "" || Array.isArray(value)) return false;
	return !Number.isNaN(Number(value));
}

/** Core's own combatant order (`Combat#_sortCombatants`): initiative high to low, then id. */
function byInitiative(a, b) {
	const ia = isNumeric(a.initiative) ? Number(a.initiative) : -Infinity;
	const ib = isNumeric(b.initiative) ? Number(b.initiative) : -Infinity;
	return (ib - ia) || (String(a.id) > String(b.id) ? 1 : -1);
}

/** Whether combat score `a` should be preferred over `b` as the one the table arranged. */
function arrangedBetter(a, b) {
	if (a.pcs !== b.pcs) return a.pcs > b.pcs;
	if (a.tokenless !== b.tokenless) return a.tokenless > b.tokenless;
	if (a.active !== b.active) return a.active > b.active;
	return a.modified > b.modified;
}

/**
 * The introduction order a world had arranged in the Combat tracker before the order moved here, as
 * actor ids. Empty when no combat holds a player character.
 *
 * WHICH COMBAT. A world can hold several, so the one the table arranged is the one holding the most
 * PCs; among those, the one with the most TOKENLESS PC combatants (the old dialog added PCs by actor
 * alone, which nothing else does), then the active one, then the most recently changed. A combat the
 * Fight tab started is never it: its order is where people happen to be standing.
 *
 * @param {Array<{active?: boolean, modified?: number, isFight?: boolean,
 *   combatants: Array<{id: string, actorId: string, tokenId?: string|null, initiative?: *}>}>} combats
 * @param {string[]} pcIds  the player characters' actor ids
 * @returns {string[]}
 */
export function legacyIntroOrderIds(combats = [], pcIds = []) {
	const pcs = new Set(Array.isArray(pcIds) ? pcIds : []);
	let best = null;
	for (const combat of Array.isArray(combats) ? combats : []) {
		if (!combat || combat.isFight) continue;
		const members = (Array.isArray(combat.combatants) ? combat.combatants : [])
			.filter(c => c && pcs.has(c.actorId));
		if (!members.length) continue;
		const score = {
			pcs:       new Set(members.map(c => c.actorId)).size,
			tokenless: members.filter(c => !c.tokenId).length,
			active:    combat.active ? 1 : 0,
			modified:  Number(combat.modified) || 0,
		};
		if (!best || arrangedBetter(score, best.score)) best = { members, score };
	}
	if (!best) return [];
	const ids = [];
	for (const combatant of [...best.members].sort(byInitiative)) {
		if (!ids.includes(combatant.actorId)) ids.push(combatant.actorId);
	}
	return ids;
}

/**
 * The order with one name moved a place earlier (`delta` < 0) or later (`delta` > 0), or null when
 * that name is not in the order or is already at that end. Null rather than the same list, so a
 * caller can skip a write that would change nothing.
 */
export function moveId(ids = [], id, delta) {
	const order = Array.isArray(ids) ? ids : [];
	const from = order.indexOf(id);
	const step = Math.sign(Number(delta) || 0);
	return from < 0 || !step ? null : moveWithin(order, from, from + step);
}

/**
 * A random order that is not the one it started from, whenever there are two or more names to
 * shuffle. A Randomize press that lands on the same order looks exactly like a button that did
 * nothing, so it rolls again (a bounded number of times: with two names, that is a coin flip each).
 */
export function reshuffle(ids = [], shuffleFn) {
	const order = Array.isArray(ids) ? [...ids] : [];
	if (order.length < 2 || typeof shuffleFn !== "function") return order;
	let next = shuffleFn(order);
	let guard = 0;
	while (next.every((id, i) => id === order[i]) && guard++ < 10) next = shuffleFn(order);
	return next;
}

// ── Foundry side ──────────────────────────────────────────────────────────────

/** The saved order, read tolerantly: `{ids: [], adopted: null}` for a world that has none. */
export function readIntroOrder() {
	const value = getObjectSetting(INTRO_ORDER_SETTING);
	return {
		ids: Array.isArray(value.ids) ? value.ids.filter(id => typeof id === "string" && id) : [],
		adopted: typeof value.adopted === "string" ? value.adopted : null,
	};
}

/** The world's combats as plain data for `legacyIntroOrderIds`. */
function legacyCombats() {
	return (globalThis.game?.combats?.contents ?? []).map(combat => ({
		active:   !!combat.active,
		modified: combat._stats?.modifiedTime ?? 0,
		isFight:  isFight(combat),
		combatants: [...(combat.combatants ?? [])].map(c => ({
			id: c.id, actorId: c.actorId, tokenId: c.tokenId ?? null, initiative: c.initiative,
		})),
	}));
}

/**
 * The player characters in introduction order: the saved order, or, in a world that has not yet
 * copied its tracker order across, that old order, so a player who opens the window before the GM
 * does sees the same table the GM arranged.
 */
export function introductionsRoster() {
	const pcs = getPlayerCharacters();
	const { ids, adopted } = readIntroOrder();
	const order = ids.length || adopted
		? ids
		: legacyIntroOrderIds(legacyCombats(), pcs.map(actor => actor.id));
	return orderForIntroductions(pcs, order);
}

/**
 * Copy the tracker's old turn order into the setting, once, on the primary GM's client.
 *
 * ONCE, EVEN WHEN THERE IS NOTHING TO COPY: the marker is written either way, because a combat that
 * turns up later is a fight, not an introductions order someone arranged.
 *
 * @returns {Promise<boolean>} whether an order was copied
 */
export async function adoptLegacyIntroOrder() {
	if (!isActingPrimaryGM()) return false;
	const { ids, adopted } = readIntroOrder();
	if (ids.length || adopted) return false;
	const legacy = legacyIntroOrderIds(legacyCombats(), getPlayerCharacters().map(actor => actor.id));
	await setSetting(INTRO_ORDER_SETTING, { ids: legacy, adopted: legacy.length ? "combat" : "none" });
	return legacy.length > 0;
}

/** Save a new order (GM only; a world setting). Marks the world as owning its order from here on. */
export async function writeIntroOrder(ids) {
	if (!globalThis.game?.user?.isGM) return;
	const { adopted } = readIntroOrder();
	await setSetting(INTRO_ORDER_SETTING, {
		ids: (Array.isArray(ids) ? ids : []).filter(id => typeof id === "string" && id),
		adopted: adopted ?? "none",
	});
}
