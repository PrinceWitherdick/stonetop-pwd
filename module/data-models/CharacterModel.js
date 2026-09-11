// System data model for the "character" Actor subtype. Replaces the character
// block of the former template.json. The bulk of a character lives in embedded
// Items (moves, playbook) and flags; this schema is just the core sheet data.
import { valueField, valueMaxField, debility, woundsField } from "./fields.js";

const fields = foundry.data.fields;

export class CharacterModel extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		return {
			stats: new fields.SchemaField({
				str: valueField(),
				dex: valueField(),
				int: valueField(),
				wis: valueField(),
				con: valueField(),
				cha: valueField(),
			}),
			attributes: new fields.SchemaField({
				hp:      valueMaxField(16, 16, {
					// A lasting, hand-set change to max HP, for the arcana and post-death
					// consequences that grant or cost it outright ("reducing your max HP by 4",
					// "gain +1 armor and +4 max HP"). Stored as a signed DELTA rather than a
					// replacement so it keeps riding on top of the playbook's number and its
					// move bonuses as the character grows; see StonetopCharacter#setMaxHp.
					adjustment: new fields.NumberField({ required: true, integer: true, initial: 0 }),
				}),
				xp:      valueMaxField(0, 8),
				level:   valueField(1),
				// `value` is DERIVED — mirrored from the snapshot by the sheet's _syncStoredArmor
				// so combat, which reads this document rather than the render context, sees the
				// real number. Never hand-edit it; type in the sheet's Armor box instead, which
				// banks the difference as `adjustment`.
				armor:   new fields.SchemaField({
					value: new fields.NumberField({ required: true, integer: true, initial: 0 }),
					// The hand-set armor delta, exactly parallel to hp.adjustment above: a signed
					// DELTA, so a boon or a curse keeps its size as the gear underneath it changes
					// rather than pinning a total the next equip would fight. See setArmor.
					adjustment: new fields.NumberField({ required: true, integer: true, initial: 0 }),
					// Also DERIVED and mirrored: how much of `value` shrugs off piercing and
					// "ignores armor" (the Rune-laden Scales' PROOF AGAINST HARM). Combat reads
					// this document, so the floor has to travel with the total.
					unpierceable: new fields.NumberField({ required: true, integer: true, initial: 0 }),
				}),
				forward: valueField(),
				ongoing: valueField(),
				damage:  new fields.SchemaField({
					value: new fields.StringField({ required: true, blank: true, initial: "d4" }),
					// A die set by hand on the sheet, which wins over the playbook-derived one.
					// Blank means "no override": the die follows the playbook (plus move bonuses)
					// as it always has. Kept apart from `value` so clearing it can revert, and so
					// a later playbook/move change can't be mistaken for the player's own choice.
					override: new fields.StringField({ required: true, blank: true, initial: "" }),
				}),
				debilities: new fields.SchemaField({
					options: new fields.SchemaField({
						weakened:  debility("Weakened",  ["str", "dex"]),
						dazed:     debility("Dazed",     ["int", "wis"]),
						miserable: debility("Miserable", ["con", "cha"]),
					}),
				}),
				// Problematic / permanent wounds — the fictional-harm track (see fields.js).
				wounds: woundsField(),
			}),
			playbook: new fields.SchemaField({
				name: new fields.StringField({ required: true, blank: true }),
				slug: new fields.StringField({ required: true, blank: true }),
				uuid: new fields.StringField({ required: true, blank: true }),
			}),
			// Free-form player notes (rich text), edited on the sheet's Notes tab.
			// Additive/blank-default field, so it needs no world migration.
			notes: new fields.HTMLField({ required: true, blank: true }),
			// How this character feels about each of the OTHER player characters: a map
			// of character actor id → { hearts (1-5), notes }. Same shape as the NPC
			// sheet's relationships map (see utils/relationship-hearts.js), so both
			// directions of a tie read alike. Sparse — a PC with no stored entry defaults
			// to 3 hearts, so nothing is persisted until someone moves a heart.
			relationships: new fields.ObjectField({ required: true }),
		};
	}
}
