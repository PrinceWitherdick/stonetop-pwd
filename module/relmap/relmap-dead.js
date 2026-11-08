// THE DEAD CHIP, PUT ON AND TAKEN OFF BY THE ACTOR (user, 2026-11-07: "we should already add the dead
// one by default if the token is dead").
//
// Somebody on a board whose actor is dead wears the Dead chip (RELMAP_CHIP_PRESETS): a character
// through the Last Door with no insert (the sheet's own Dead tag, `actorDeathsDoorState`), or an NPC
// whose status is Dead. It is WRITTEN, not drawn from the actor on each paint (the user's choice), so
// from then on it is an ordinary chip the table may take off. Two moments write it:
//  • ARRIVING: a dead actor put on a board arrives wearing it (`seatPatch`, the one patch every
//    seating writes, so one undo takes both back and no way of seating people can leave it out);
//  • DYING OR COMING BACK: an actor update that changes their death puts it on (or takes it off)
//    everyone standing for them on every board (`deadChipPatch`, run by relmap-faces.js
//    `keepDeadChipsCurrent` on updateActor).
//
// ⚠ NO DOCUMENT IMPORTS HERE. relmap-doc.js seats the party and village boards through `seatPatch`,
// so anything this file imported from it would be a cycle.

import { DEATHS_DOOR_FLAG, DEATHS_DOOR_STATE, effectiveDeathsDoorState } from "../actors/character/deaths-door.js";
import { readableFlags } from "../actors/character/StonetopFlags.js";
import { npcStatusMeta } from "../data-models/npc-status.js";
import { RELMAP_CHIP_PRESETS, addChipPatch, addNodesPatch, nodeChipsPatch } from "./relmap-store.js";

const DEAD = RELMAP_CHIP_PRESETS.find(preset => preset.id === "dead");

/** The Dead chip's id: the preset's. */
export const RELMAP_DEAD_CHIP = DEAD.id;

/**
 * Whether this actor is dead, as the map reads it. A document that cannot say is not dead.
 *
 * A character is read exactly as deaths-door-actor.js `actorDeathsDoorState` reads one (the sheet's
 * Dead tag), restated from its two parts because that file imports foundry-compat.js, which the board
 * window's tests stand in for whole.
 */
export function isDeadActor(actor) {
	if (!actor) return false;
	try {
		if (actor.type === "character") {
			const flags = readableFlags(actor);
			return effectiveDeathsDoorState({
				state: flags?.[DEATHS_DOOR_FLAG] ?? null,
				insertSlug: flags?.postDeathInsert?.slug ?? null,
			}) === DEATHS_DOOR_STATE.DEAD;
		}
		if (actor.type === "npc") return npcStatusMeta(actor.system?.status).value === "dead";
	} catch { /* a half-built actor */ }
	return false;
}

/** Whether an actor update could have changed their death: their Death's Door flag or an NPC's status. */
export function changedDeath(changed) {
	if (!changed || typeof changed !== "object") return false;
	return dottedKeys(changed).some(key => key === "system.status"
		|| key.split(".").some(part => part === DEATHS_DOOR_FLAG || part === `-=${DEATHS_DOOR_FLAG}`));
}

/** Every key path in an update, nested or already dotted ("flags.stonetop-pwd.deathsDoor"). */
function dottedKeys(value, prefix = "", out = []) {
	for (const [key, inner] of Object.entries(value)) {
		const path = prefix ? `${prefix}.${key}` : key;
		out.push(path);
		if (inner && typeof inner === "object" && !Array.isArray(inner) && Object.getPrototypeOf(inner) === Object.prototype) {
			dottedKeys(inner, path, out);
		}
	}
	return out;
}

/** The Dead chip as a board stores it, named in the reader's language. */
export function deadChipDef() {
	const name = globalThis.game?.i18n?.localize?.(DEAD.nameKey);
	return { name: name && name !== DEAD.nameKey ? name : "Dead", icon: DEAD.icon, ink: DEAD.ink };
}

/** The Dead chip's definition onto a board that has none yet, ahead of a write that puts it on. */
function defineDead(graph, patch) {
	if (graph?.chips?.[RELMAP_DEAD_CHIP] || !patch) return patch;
	return { ...(addChipPatch(RELMAP_DEAD_CHIP, deadChipDef()) ?? {}), ...patch };
}

/** Which of these newcomers stand for a dead actor, by id. */
export function deadArrivalIds(nodes, { resolve = defaultResolve } = {}) {
	return Object.entries(nodes ?? {})
		.filter(([, node]) => node?.uuid && isDeadActor(resolve(node.uuid)))
		.map(([id]) => id);
}

/**
 * The Dead chip on whichever of these NEWCOMERS stand for a dead actor, or {} for none.
 *
 * @param {object} graph  the board before they arrive, normalized.
 * @param {Record<string, {uuid?: string}>} nodes  id -> the person being seated.
 * @param {Function} [resolve]  uuid -> actor.
 */
export function deadArrivalPatch(graph, nodes, { resolve = defaultResolve } = {}) {
	const ids = deadArrivalIds(nodes, { resolve });
	if (!ids.length) return {};
	const patch = {};
	for (const id of ids) Object.assign(patch, nodeChipsPatch(id, [RELMAP_DEAD_CHIP]) ?? {});
	return defineDead(graph, patch);
}

/**
 * THE WRITE THAT SEATS PEOPLE ON A BOARD: everybody in `nodes` (relmap-store.js `addNodesPatch`) and
 * the Dead chip on whoever among them is dead, in one patch. Every seating goes through this rather
 * than adding the two up itself, so the next way of seating people cannot forget the chip.
 *
 * @param {object} graph  the board before they arrive, normalized.
 * @param {Record<string, object>} nodes  id -> the fields `addNodePatch` takes.
 * @param {Function} [resolve]  uuid -> actor.
 * @returns {object}  {} when nobody could be seated.
 */
export function seatPatch(graph, nodes, { resolve = defaultResolve } = {}) {
	const seated = addNodesPatch(nodes);
	if (!Object.keys(seated).length) return seated;
	return { ...seated, ...deadArrivalPatch(graph, nodes, { resolve }) };
}

/**
 * The same rule for a board made WHOLE rather than written to (a new page's graph): the same dead
 * newcomers (`deadArrivalIds`) wear the same chip (`deadChipDef`), and the board defines it if it has
 * none. Changes `graph` in place and hands it back.
 */
export function withDeadArrivals(graph, { resolve = defaultResolve } = {}) {
	const ids = deadArrivalIds(graph?.nodes, { resolve });
	if (!ids.length) return graph;
	graph.chips = { ...(graph.chips ?? {}), [RELMAP_DEAD_CHIP]: graph.chips?.[RELMAP_DEAD_CHIP] ?? deadChipDef() };
	for (const id of ids) graph.nodes[id] = { ...graph.nodes[id], chips: { ...(graph.nodes[id].chips ?? {}), [RELMAP_DEAD_CHIP]: true } };
	return graph;
}

/**
 * The patch that brings one board in line with one actor's death: Dead on everybody standing for them
 * who lacks it (`dead`), or off everybody wearing it (not). Null when there is nothing to change.
 */
export function deadChipPatch(graph, uuid, dead) {
	if (!uuid) return null;
	let patch = null;
	for (const [id, node] of Object.entries(graph?.nodes ?? {})) {
		if (node.uuid !== uuid) continue;
		const wears = !!node.chips?.[RELMAP_DEAD_CHIP];
		if (dead === wears) continue;
		const one = dead ? nodeChipsPatch(id, [RELMAP_DEAD_CHIP]) : nodeChipsPatch(id, [], [RELMAP_DEAD_CHIP]);
		patch = { ...(patch ?? {}), ...(one ?? {}) };
	}
	return dead ? defineDead(graph, patch) : patch;
}

/** foundry-compat.js#resolveSync, kept here for the reason above. */
function defaultResolve(uuid) {
	try { return globalThis.fromUuidSync?.(uuid, { strict: false }) ?? null; } catch { return null; }
}
