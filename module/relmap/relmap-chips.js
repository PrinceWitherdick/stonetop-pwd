// TAG CHIPS SHARED BETWEEN MAPS ("Dead", "Noble"): the list a person's Add chip menu offers, and an
// edit or a deletion carried to every other board that has the same chip.
//
// Each board keeps its OWN copy of every chip it uses (relmap-store.js `graph.chips`), so a board never
// depends on another one still being there. What makes a chip "the same" on two boards is its id: one
// worn from another board's list is copied over under that id (`chipWearPatch`).
//
// A world setting would be the plain home for a shared list, and a player cannot write one; every
// player owns the maps, which is the same reason the Timeline keeps its tags on its own journal.
//
// Changes to OTHER boards are made by the client that made the change, to the boards it may edit,
// and never through the undo history: only this board's part of an edit is somebody's Ctrl+Z.

import { canSeeMapPage, readChips, readGraph } from "./relmap-doc.js";
import { everyBoard, writeBoards } from "./relmap-faces.js";
import {
	RELMAP_CHIP_PRESETS, addChipPatch, chipPatch, compareChips, dropChipPatch, nodeChipsPatch,
} from "./relmap-store.js";

/** The built-in chips, named in the reader's language. */
export function presetChips(localize = key => globalThis.game?.i18n?.localize?.(key) ?? key) {
	return RELMAP_CHIP_PRESETS.map(({ id, nameKey, icon, ink }) => ({ id, name: localize(nameKey), icon, ink }));
}

/**
 * Every chip this reader can put on somebody on `graph`'s board: this board's own, every other board's
 * this reader may look at, and the presets. One per id (this board's copy first) and one per name, so
 * two boards that each made a "Noble" offer one.
 *
 * @param {object} graph  this board, normalized.
 * @param {object} [o]
 * @param {object} [o.doc]  this board's own document, skipped among the others.
 * @param {object[]} [o.boards]  every board in the world (`everyBoard`).
 * @returns {Array<{id: string, name: string, icon: string, ink: string, here: boolean}>}
 *          `here`: this board already has it.
 */
export function chipLibrary(graph, { doc = null, boards = everyBoard(), localize } = {}) {
	const byId = new Map();
	for (const [id, chip] of Object.entries(graph?.chips ?? {})) byId.set(id, { id, ...chip, here: true });
	for (const board of boards ?? []) {
		if (!board || board === doc || !canSeeMapPage(board)) continue;
		for (const [id, chip] of Object.entries(readChips(board))) {
			if (!byId.has(id)) byId.set(id, { id, ...chip, here: false });
		}
	}
	for (const preset of presetChips(localize)) if (!byId.has(preset.id)) byId.set(preset.id, { ...preset, here: false });

	const byName = new Map();
	for (const chip of byId.values()) {
		const key = chip.name.toLocaleLowerCase();
		const held = byName.get(key);
		// This board's copy wins a name tie, then the preset, then whichever sorts first.
		if (!held || (chip.here && !held.here) || (chip.here === held.here && compareChips(chip, held) < 0)) {
			byName.set(key, chip);
		}
	}
	return [...byName.values()].sort(compareChips);
}

/**
 * Put `chip` on one person, defining it on this board first when this board has never had it. ONE
 * patch, so the definition and the person wearing it land (and are undone) together.
 */
export function chipWearPatch(graph, nodeId, chip) {
	if (!chip?.id) return null;
	const wear = nodeChipsPatch(nodeId, [chip.id]);
	if (!wear) return null;
	if (graph?.chips?.[chip.id]) return wear;
	const define = addChipPatch(chip.id, chip);
	return define ? { ...define, ...wear } : null;
}

/**
 * Carry a chip's edit (`def`) or deletion (`def === null`) to every OTHER board that has it and this
 * reader may edit. Returns how many boards were written.
 *
 * @param {string} id
 * @param {{name: string, icon: string, ink: string}|null} def
 * @param {object} [o]
 * @param {object} [o.doc]  the board the change was made on, which the caller has already written.
 */
export async function spreadChip(id, def, { doc = null, boards = everyBoard() } = {}) {
	const writes = [];
	for (const board of boards ?? []) {
		if (!board || board === doc || !board.isOwner || !readChips(board)[id]) continue;
		// A deletion takes the chip off everybody wearing it, so only that needs the whole board.
		const patch = def ? chipPatch(id, def) : dropChipPatch(readGraph(board), id);
		if (patch) writes.push([board, patch]);
	}
	return writeBoards(writes, { why: "to carry a chip there" });
}

/**
 * How many OTHER boards a deletion of this chip reaches: what the delete question says. The same
 * boards `spreadChip` writes (the ones this reader owns), so the count never promises more than happens.
 */
export function chipElsewhere(id, { doc = null, boards = everyBoard() } = {}) {
	let count = 0;
	for (const board of boards ?? []) {
		if (!board || board === doc || !board.isOwner) continue;
		if (readChips(board)[id]) count++;
	}
	return count;
}
