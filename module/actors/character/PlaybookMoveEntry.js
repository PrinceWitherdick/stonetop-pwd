import { statRequirementLabel, statRequirementsUnmet } from "./stat-requirement.js";

export class PlaybookMoveEntry {
	constructor(entry, ownedInstances, bgMoveNames, ownedAllByName, actorLevel, actorPlaybook, actorStats = {}) {
		const isFromPlaybook   = entry.isStarting;
		const isFromBackground = bgMoveNames.has(entry.name);
		const req              = entry.requirement;
		const requiresMoves    = req?.moves ?? [];
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
		this.requires = requiresMoves[0] ?? null;
		const requiresParts = [];
		if (requiresMoves.length > 0) requiresParts.push(requiresMoves.join(", "));
		// `req.stats` (e.g. Musclebound's { str: 2 }) is a machine-checkable per-stat
		// prerequisite — its label rides here and it DOES feed `locked` below.
		if (requiresStats)            requiresParts.push(statRequirementLabel(requiresStats));
		// `req.note` is a display-only prerequisite (e.g. "All 6 marks in Potential for
		// Greatness") that the engine can't check mechanically — it's shown to the player
		// but never feeds `locked`, so it can't permanently lock the move the way an
		// un-matchable `requirement.moves` string does.
		if (req?.note)                requiresParts.push(req.note);
		if (this.minLevel)            requiresParts.push(`level ${this.minLevel}+`);
		this.requiresLabel = requiresParts.length > 0 ? requiresParts.join("; ") : null;
		// Per-stat ceiling for stat-increase moves (Improved Stat = +2, Superior Stat =
		// +3). Drives the level-up stat picker's cap enforcement and marks the move as
		// one that needs a stat choice when taken.
		this.cap = entry.cap ?? null;
		this.repeatable = repeatMax > 1;
		this.repeatMax = repeatMax;
		this.locked = !this.isStarting && !!(
			requiresMoves.some(m => !ownedAllByName.has(m)) ||
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
				disabled: this.isStarting || (!(i < ownedInstances.length) && i !== ownedInstances.length),
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
