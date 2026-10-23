import { ownedLearnedMove } from "./owns-move.js";
import { inSpenderTurn } from "../../utils/spender-queue.js";

const key = "backgroundChoices";

/**
 * A hold pool's HELD count on `resources` (a MoveResources), within 0..max. Which way a track
 * counts is set out on MoveResources#setUses: a pool counts what is held, so a spend is `held - 1`.
 */
export function heldOnTrack(resources, moveName, max) {
	return Math.min(max, Math.max(0, Math.trunc(Number(resources?.getMoveResources?.()?.[moveName]) || 0)));
}

/**
 * A learned move's hold track, `{held, max, resources}`, or null for a character without the move
 * learned or a move with no track. The max is the LEARNED copy's `resource` (a copy taken before the pack
 * gave it one is filled in by migration/move-refresh.js), so a switched-off second copy cannot set it.
 */
export function learnedTrack(actor, move) {
	const learned = ownedLearnedMove(actor, move);
	if (!learned) return null;
	const max = Math.trunc(Number(learned.system?.resource?.max) || 0);
	const resources = actor?.typedActor?.moveResources;
	if (!max || !resources) return null;
	return { held: heldOnTrack(resources, move, max), max, resources };
}

/**
 * Take up to `count` off what a learned move's track HOLDS: a spend (Safety First's Protection), or
 * what a 10+ put there taken back when the card is moved off it (tier-effects.js). Never below none,
 * so hold spent since is not taken twice. Read and written in the actor's spending turn
 * (utils/spender-queue.js). How many came off (0 = nothing held to take).
 */
export function takeBackHeld(actor, move, count) {
	const n = Math.max(0, Math.trunc(Number(count) || 0));
	if (!n) return Promise.resolve(0);
	return inSpenderTurn(actor, async () => {
		const track = learnedTrack(actor, move);
		if (!track || track.held <= 0) return 0;
		const next = Math.max(0, track.held - n);
		await track.resources.setUses(move, next, { stonetopMove: move });
		return track.held - next;
	});
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
		// One track's sub-key, not the whole flag re-spread from a read: a spend on a sibling track that
		// landed since would otherwise be written back over.
		await this.setUses(moveResourceButton.moveName, newValue);
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

	/** `setUses` as an actor.update() fragment, for a caller folding it into a write of its own. */
	usesUpdate(moveName, value) {
		return this._flags.subKeyData(key, moveName, value);
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

	// The same for several options of one move at once (`values` is option slug to value), so a
	// caller that works out a run of marks in memory writes them in ONE update, not one per option.
	marksUpdate(moveName, values) {
		const current = this.getMarks();
		return this._flags.updateData("moveMarks", {
			...current,
			[moveName]: { ...(current[moveName] ?? {}), ...values },
		});
	}
}
