import { ResourceDef } from "./Resource.js";
import { normalizeRollType } from "../utils/roll-types.js";

export class MoveDefinition {
	constructor(data) {
		this.id          = data._id;
		this.name        = data.name;
		this.playbook    = data.system?.playbook        ?? null;
		this.rollType    = normalizeRollType(data.system?.rollType);
		this.description = data.system?.description     ?? null;
		// The move's own 10+/7-9/6- outcome text, as { success|partial|failure: {label, value} }.
		// The roll card reads it, and so does the move card's tier ladder (utils/move-tiers.js).
		this.moveResults = data.system?.moveResults     ?? null;
		this.isStarting  = data.system?.isStartingMove  ?? false;
		this.requirement = data.system?.requirement     ?? null;
		this.repeatMax   = data.system?.repeatMax       ?? null;
		// Per-stat ceiling for stat-increase moves (+2 / +3); null otherwise. A non-null
		// cap marks the move as needing a stat-choice picker at level-up.
		this.cap         = data.system?.cap             ?? null;
		this.resource    = data.system?.resource ? new ResourceDef(data.system.resource) : null;
		this.hpBonus     = data.system?.hpBonus         ?? 0;
		this.armorBonus  = data.system?.armorBonus      ?? 0;
		this.loadBonus   = data.system?.loadBonus       ?? 0;
		// Load-gate metadata surfaced to the expedition Outfit readout: the heaviest load
		// tier the move's fiction tolerates ("light"/"normal"/"heavy"; blank = no gate), and
		// whether it also needs the carrier unarmored (Uncanny Reflexes).
		this.maxLoad          = data.system?.maxLoad          ?? "";
		this.requiresUnarmored = data.system?.requiresUnarmored ?? false;
		// Per-option marks (e.g. WBH "Potential for Greatness"): each option carries a
		// checkbox count and optional hp/armor/crewHp effect applied per checked box.
		this.markOptions = data.system?.markOptions     ?? null;
		// Repeat-scaling selection budget for markOptions: { base, perExtra }. Total picks
		// = base + perExtra*(ownedCount-1). Null ⇒ unbudgeted (the prior, uncapped behavior).
		this.markBudget  = data.system?.markBudget      ?? null;
		// Cross-playbook foreign-move config ({ playbooks, grantsPossession }) or null. A
		// non-null value marks this as a move that grants a foreign-playbook move pick.
		this.crossPlaybook = data.system?.crossPlaybook ?? null;
	}
}
