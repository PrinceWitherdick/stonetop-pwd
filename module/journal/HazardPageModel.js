// Data model for the "hazard" JournalEntryPage subtype — the 5th custom page type
// after bestiary / location / chronicle / threat (see stonetop.js). A hazard is GM
// prep (Book I, "Dangers", pp. 381-389): an environmental danger the PCs must avoid,
// endure, thwart, or overcome. The book's prep approaches map onto the fields: a
// detailed description, GM moves (with an instinct for dynamic hazards), an impending
// doom track, and/or custom player-facing moves, plus the damage worksheet (die +
// effect picks, or outright certain death).
//
// Hazards share threats' storage/visibility architecture verbatim: every hazard is a
// page of the steading's ONE "<Steading> Hazards" JournalEntry (steading flag
// `hazardsEntryId`), which stays `ownership.default: NONE`. There is no player reveal;
// hazards are pure GM prep, and the hiding is UI-level only (see ThreatPageModel.js and
// threat-store.js for the full rationale; the same caveats apply).
import { HAZARD_DAMAGE_DICE, HAZARD_DAMAGE_EFFECTS } from "../hazards/hazard-data.js";
import { doomTrackFields, customPlayerMovesField } from "./shared-page-fields.js";

const fields = foundry.data.fields;

export class HazardPageModel extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		return {
			// Freeform prose: where it is, what it looks like, what triggers it, how it works.
			description: new fields.HTMLField({ required: true, blank: true, initial: "" }),
			// Damage worksheet (Book I p. 383). The die comes from the worst plausible
			// outcome for a normal person; blank means it doesn't deal damage at all.
			damageDie: new fields.StringField({
				required: true, blank: true, initial: "", choices: HAZARD_DAMAGE_DICE.map(d => d.id),
			}),
			// The "if... effect" picks, stored as ids so the creator round-trips exactly.
			damageEffects: new fields.ArrayField(new fields.StringField({
				required: true, blank: false, choices: HAZARD_DAMAGE_EFFECTS.map(e => e.id),
			})),
			// Free-form extras appended to the damage parenthetical (e.g. "area, poison").
			damageExtra: new fields.StringField({ required: true, blank: true, initial: "" }),
			// Would definitely kill a normal person: no damage roll, straight to Death's Door.
			certainDeath: new fields.BooleanField({ required: true, initial: false }),
			// For dynamic hazards (storms, wildfires): "to [do something]".
			instinct: new fields.StringField({ required: true, blank: true, initial: "" }),
			// GM moves: how it's foreshadowed, harms, escalates, thwarts.
			gmMoves: new fields.ArrayField(new fields.StringField({ required: true, blank: true })),
			// When the doom track advances, e.g. "each time a pillar is struck, or as a GM move".
			advanceTrigger: new fields.StringField({ required: true, blank: true, initial: "" }),
			// The ordered doom track (1-4 grim portents + one impending doom); shared with
			// the threat page so the common doom-track wiring reads the same fields on both.
			...doomTrackFields(),
			// Optional player-facing custom moves ("When you fall from the boughs, roll +CON...").
			customPlayerMoves: customPlayerMovesField(),
		};
	}
}
