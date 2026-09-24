const key = "backgroundChoices";

/**
 * A hold pool's HELD count on `resources` (a MoveResources), within 0..max. Which way a track
 * counts is set out on MoveResources#setUses: a pool counts what is held, so a spend is `held - 1`.
 */
export function heldOnTrack(resources, moveName, max) {
	return Math.min(max, Math.max(0, Math.trunc(Number(resources?.getMoveResources?.()?.[moveName]) || 0)));
}

export class MoveResources {
	_flags;

	constructor(flags) {
		this._flags = flags;
	}

	/**
	 * @param {MoveResourceButton} moveResourceButton
	 * @returns {Promise<void>}
	 */
	async add(moveResourceButton) {
		const newValue = moveResourceButton.isChecked() ? moveResourceButton.index : moveResourceButton.index + 1;
		const current = this.getMoveResources();
		await this._addMoveResource(current, moveResourceButton.moveName, newValue);
	}

	getMoveResources() {
		return this._flags.getFlag(key) ?? {};
	}

	/**
	 * Set one move's track outright, for callers that compute the new count themselves (the
	 * Logbook spend on a chat card, say, rather than a pip click).
	 *
	 * WHICH WAY A TRACK COUNTS IS THE MOVE'S. A "hold N" pool (Command, Presence, Surprise,
	 * Resolve, Boon) counts what is HELD: a character holds none until the move triggers, so a
	 * fresh sheet's zero has to mean empty, and spending DECREMENTS. A per-use counter like the
	 * Logbook counts uses SPENT and spending increments — see `logbookUses` in know-things.js.
	 * Settled for the hold pools on 2026-09-23 (the user's call: a ticked pip is held).
	 *
	 * Written as a SUB-KEY so it cannot clobber a sibling move's track via a stale spread.
	 * `options` reaches `actor.update`, so a caller can attribute the write for the ledger
	 * with `{ stonetopMove }`.
	 */
	async setUses(moveName, value, options) {
		await this._flags.setSubKey(key, moveName, value, options);
	}

	async _addMoveResource(current, moveName, newValue) {
		await this._flags.setFlag(key, {...current, [moveName]: newValue});
	}

	/**
	 * Drop one move's stored track, for a move that is gone for good. Only meaningful for
	 * a key that will never come back: a custom move's key is its item id, and ids aren't
	 * reused, so the entry would sit in the flag forever. A shipped move keyed by NAME is
	 * deliberately left alone — re-adding it should restore the count where it left off.
	 * No-op when nothing is stored, so removing a track-less move costs no document write.
	 * @param {string} moveKey
	 */
	async clear(moveKey) {
		if (!moveKey || !(moveKey in this.getMoveResources())) return;
		await this._flags.batch({ deletes: { [key]: [moveKey] } });
	}

	// Per-option marks for moves like "Potential for Greatness":
	// { [moveName]: { [optionSlug]: value } }
	getMarks() {
		return this._flags.getFlag("moveMarks") ?? {};
	}

	// actor.update() fragment that writes one option's marks, so callers can batch
	// it into a single document update alongside other changes (e.g. stat deltas).
	markUpdate(moveName, optionSlug, value) {
		const current = this.getMarks();
		return this._flags.updateData("moveMarks", {
			...current,
			[moveName]: { ...(current[moveName] ?? {}), [optionSlug]: value },
		});
	}
}
