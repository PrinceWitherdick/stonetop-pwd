// System data model for the "monster" Actor subtype — the lean stat block. The
// codex prose (questions/lore/origins/discoveries/…) moved to the bestiary
// JournalEntryPage, so this schema only carries what the stat block stores.
import { monsterArmorGate } from "../data/monster-armor.js";

const fields = foundry.data.fields;

export class MonsterModel extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		return {
			attributes: new fields.SchemaField({
				hp: new fields.SchemaField({
					value: new fields.NumberField({ required: true, integer: true, initial: 0 }),
					max:   new fields.NumberField({ required: true, integer: true, initial: 0 }),
				}),
				armor: new fields.SchemaField({
					value:  new fields.NumberField({ required: true, integer: true, initial: 0 }),
					source: new fields.StringField({ required: true, blank: true }),
					// `conditional` / `conditionalSource` are DERIVED, not stored: see prepareDerivedData.
				}),
				damage: new fields.SchemaField({
					value:       new fields.StringField({ required: true, blank: true }),
					rollFormula: new fields.StringField({ required: true, blank: true }),
				}),
				instinct: new fields.SchemaField({
					value: new fields.StringField({ required: true, blank: true }),
				}),
			}),
			concept:      new fields.StringField({ required: true, blank: true }),
			organization: new fields.StringField({ required: true, blank: true }),
			creatureType: new fields.StringField({ required: true, blank: true }),
			size:         new fields.StringField({ required: true, blank: true }),
			tags:         new fields.StringField({ required: true, blank: true }),
			// Rich text edited via ProseMirror on the sheet.
			qualities:    new fields.HTMLField({ required: true, blank: true }),
			notes:        new fields.HTMLField({ required: true, blank: true }),
			count:        new fields.NumberField({ required: true, integer: true, initial: 0 }),
			// Whether a horde/group is being run as ONE combatant (Book I p.416, "Abstracting
			// groups"), which makes its HP the group's pool, read back as casualties. Off, the stat
			// block is one creature. Monster tokens are unlinked, so each token keeps its own.
			fightAsGroup: new fields.BooleanField({ required: true, initial: false }),
			// UUID of the bestiary codex JournalEntry/page this stat block belongs to.
			entry:        new fields.StringField({ required: true, blank: true }),
		};
	}

	/**
	 * The stat block's printed armor exception ("Armor 0 vs. bronze", Book I p.397 "list any variants or
	 * exceptions"), read off its own text (data/monster-armor.js) into the fields an NPC follower's
	 * "2 (0 vs. iron)" is stored in (NpcModel): how much of `value` the named thing takes away, and what it
	 * is ("vs. bronze"). The damage card offers it back with a ticked box (combat/attack-flow.js
	 * #wireConditionalArmor). Derived on every prepare, so an edit to the qualities, the armor, its source
	 * or an armor boost is read again at once, token copies included, and nothing has to keep it in sync.
	 * @override
	 */
	prepareDerivedData() {
		super.prepareDerivedData?.();
		Object.assign(this.attributes.armor, monsterArmorGate(this));
	}
}
