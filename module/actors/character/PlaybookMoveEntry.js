import { statRequirementsUnmet } from "./stat-requirement.js";
import { effectiveRequiredMoves, requiredMovesUnmet, requirementLabel } from "./move-requirement.js";

/**
 * Whether box `i` of a repeatable move owned `current` times is closed to a click. Boxes are taken
 * in order: every ticked box and the next free one are open, the rest wait their turn.
 *
 * A STARTING move locks only its FIRST box, the take it started with. A second Well Versed is an
 * ordinary pick, ticked on the Moves tab like any repeatable move's (the level-up dialog always
 * allowed it). The other half of an either/or taken later is not starting at all (`demotedStarting`
 * below), so none of its boxes lock. The sheet's `repeatChecks` helper (stonetop.js) asks this too.
 */
export function repeatBoxLocked(i, current, isStarting) {
	return (isStarting && i === 0) || (!(i < current) && i !== current);
}

export class PlaybookMoveEntry {
	// `demotedStarting`: the "either X OR Y" options this character did not start with
	// (StonetopCharacter#demotedStartingChoices). Every option carries isStartingMove, but the
	// other half taken later is an ordinary pick: counted in the level's budget, labelled as
	// nothing, and free to untick.
	constructor(entry, ownedInstances, bgMoveNames, ownedAllByName, actorLevel, actorPlaybook, actorStats = {}, demotedStarting = null) {
		const isFromPlaybook   = entry.isStarting && !demotedStarting?.has(entry.name);
		const isFromBackground = bgMoveNames.has(entry.name);
		const req              = entry.requirement;
		// The replaced move is folded into the required moves so every lock/sort reader sees it.
		const replaces         = entry.replaces ?? null;
		const requiresMoves    = effectiveRequiredMoves(req, replaces);
		const requiresStats    = req?.stats ?? null;
		const repeatMax        = entry.repeatMax ?? 1;
		const lastOwnedId      = ownedInstances[ownedInstances.length - 1]?._id ?? null;

		this.name = entry.name;
		this.description = entry.description ?? "";
		// The move's own 10+/7-9/6- outcome text, carried through so the card can print it as
		// a tier ladder under the description instead of leaving it buried in the paragraph.
		this.moveResults = entry.moveResults ?? null;
		this.compendiumId = entry.id;
		this.owned = ownedInstances.length > 0;
		this.ownedId = lastOwnedId;
		this.ownedIds = ownedInstances.map(i => i._id);
		this.rollType = entry.rollType;
		this.isStarting = isFromPlaybook || isFromBackground;
		this.source = isFromPlaybook ? "Starting move" : isFromBackground ? "Background" : null;
		this.requiresPlaybook = req?.playbook ?? null;
		this.minLevel = req?.level ?? null;
		// Alpha's "Wild Speech or Spirit Tongue" (`req.anyMoves`) sorts under its first option.
		this.requires = requiresMoves[0] ?? req?.anyMoves?.[0] ?? null;
		this.replaces = replaces;
		// `req.stats` (Musclebound's { str: 2 }) is labelled here and DOES feed `locked` below;
		// `req.note` is labelled but never does (move-requirement.js#requirementLabel).
		this.requiresLabel = requirementLabel(req, { replaces, level: this.minLevel });
		// Per-stat ceiling for stat-increase moves (Improved Stat = +2, Superior Stat =
		// +3). Drives the level-up stat picker's cap enforcement and marks the move as
		// one that needs a stat choice when taken.
		this.cap = entry.cap ?? null;
		this.repeatable = repeatMax > 1;
		this.repeatMax = repeatMax;
		// Taking a replacing move gives up the one it replaces, so once this move is owned
		// the replaced move's absence is the expected state, not a broken prerequisite.
		const moveMissing = m => !ownedAllByName.has(m) && !(m === replaces && ownedInstances.length > 0);
		this.locked = !this.isStarting && !!(
			requiredMovesUnmet({ moves: requiresMoves, anyMoves: req?.anyMoves }, m => !moveMissing(m)) ||
			(this.requiresPlaybook && this.requiresPlaybook !== actorPlaybook) ||
			(this.minLevel && actorLevel < this.minLevel) ||
			statRequirementsUnmet(requiresStats, actorStats)
		);
		// The player OWNS this move but its mechanically-checkable prerequisites
		// (a required move / playbook / level / stat minimum) are no longer satisfied —
		// e.g. they edited their learned moves and removed a prerequisite, or lowered a
		// stat below the gate in edit mode. Note-only ("display") prerequisites never set
		// this, since the engine can't verify them. Drives a warning cue on the sheet so
		// the broken prerequisite doesn't pass unnoticed.
		this.requirementsUnmet = this.owned && this.locked;
		this.repeatChecks = this.repeatable
			? Array.from({ length: repeatMax }, (_, i) => ({
				checked: i < ownedInstances.length,
				ownedId: i < ownedInstances.length ? (ownedInstances[i]?._id ?? null) : null,
				// `this.locked` is intentionally NOT a disabler: a move whose requirements
				// aren't met stays faded (.move-locked) but can still be ticked in edit mode
				// so a player may deliberately take it anyway (the row then shows the
				// "requirement not met" warning). The (not movesEdit) gate in the template
				// still keeps every box read-only outside edit mode.
				disabled: repeatBoxLocked(i, ownedInstances.length, this.isStarting),
			}))
			: null;
		this.resource = entry.resource;
		this.resourceChecks = null;
		this.markOptions = entry.markOptions ?? null;
		// Repeat-scaling selection budget for markOptions ({ base, perExtra }); null ⇒ uncapped.
		this.markBudget = entry.markBudget ?? null;
		// Cross-playbook foreign-move config ({ playbooks, grantsPossession }); null otherwise.
		this.crossPlaybook = entry.crossPlaybook ?? null;
		// Load-gate metadata (see MoveDefinition): heaviest tolerated load tier + unarmored
		// requirement, surfaced onto the move snapshot for the expedition load readout.
		this.maxLoad           = entry.maxLoad           ?? "";
		this.requiresUnarmored = entry.requiresUnarmored ?? false;
	}
}
