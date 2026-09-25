// System data model for the "npc" Actor subtype — a person the PCs interact with
// (Book I, ch.14 "NPCs & Followers", pp.449-481). Per the rules an NPC is defined
// by personality and interaction, NOT combat stats: "If it has a personality, and
// the PCs can communicate with it, it's an NPC." Game stats (HP, armor, damage,
// GM moves) are an OPTIONAL overlay borrowed from the monster/follower systems and
// only filled in when an NPC "might get into a fight" or "regularly act on a PC's
// orders" (p.459). Hence the split below: identity/drives are always present; the
// `attributes` block is gated behind `hasStats`.
//
// GM moves are carried as embedded `npcMove` items (same schema as monsterMove),
// so the moves list reuses the existing item type rather than duplicating it here.
import { valueMaxField } from "./fields.js";

const fields = foundry.data.fields;

// Re-exported for back-compat; the definitions live in the Foundry-free npc-status.js
// so the steading roster + tests can import them without loading this data-model class.
export { NPC_STATUSES, npcStatusMeta } from "./npc-status.js";

export class NpcModel extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		return {
			// — Who they are (always shown) —
			pronouns:    new fields.StringField({ required: true, blank: true }),
			// "farmer, humorless, ex-mercenary" — their lot in life + memorable traits,
			// rendered next to the name like the book's shorthand (ELIOS example, p.457).
			occupation:  new fields.StringField({ required: true, blank: true }),
			traits:      new fields.StringField({ required: true, blank: true }),
			// Where they live — for neighbors, their home steading/settlement (e.g.
			// "Marshedge"); blank for residents of Stonetop itself. Mirrors the Steading
			// sheet's Neighbors "Home" column so a linked NPC is the row's source of truth.
			home:        new fields.StringField({ required: true, blank: true }),
			// A quick one-line relationships headline ("Blodwen's uncle; loyal to the
			// Council"), matching the Steading Residents/Neighbors "Relations" column. The
			// richer `connections` HTMLField below is for deeper GM prose + @UUID links.
			relations:   new fields.StringField({ required: true, blank: true }),
			// Up to 3 sensory impressions (face / voice / scent / …), p.454. A fixed-length
			// array; blank slots render as empty lines. trim:false so a deliberately blank
			// middle slot round-trips rather than collapsing the list.
			impressions: new fields.ArrayField(
				new fields.StringField({ required: true, blank: true, trim: false }),
				{ required: true, initial: ["", "", ""] },
			),
			// The anchor field — "to [do something]" (p.457). Guides how the NPC behaves
			// and reacts; when unsure what they'd do, the GM looks here.
			instinct:    new fields.StringField({ required: true, blank: true }),
			// Lifecycle status (blank = active; see npc-status.js). Records the between-
			// session review outcome (pp.480-481) — a retired/dead NPC no longer reads as
			// a living, active one. A plain string (validated by the sheet's select) so a
			// hand-edited/imported value round-trips instead of failing schema validation.
			status:      new fields.StringField({ required: true, blank: true, initial: "" }),

			// — What drives them (collapsible) — rich text so connections can @UUID-link
			// to other actors/NPCs. Prompts (related to / loyal to / dislikes; wants /
			// fears / longs for) live as placeholder text on the sheet, not as fields, so
			// the GM isn't boxed in.
			connections: new fields.HTMLField({ required: true, blank: true }),
			motivations: new fields.HTMLField({ required: true, blank: true }),
			// GM-only acting note (voice / picture / trick), p.457. Not shown to players.
			embodiment:  new fields.StringField({ required: true, blank: true }),
			// How much this NPC likes each player character: a map of character actor id →
			// hearts (1-5). Sparse — a PC with no stored entry defaults to 3 hearts, so a
			// fresh NPC shows every PC at 3 without persisting anything. Keys are actor ids
			// (no dots), so `system.relationships.<id>` updates merge cleanly.
			relationships: new fields.ObjectField({ required: true }),

			// — Game stats (optional overlay, collapsed until enabled) —
			// When false the whole stat block is hidden; the NPC is "just a person."
			hasStats:    new fields.BooleanField({ required: true, initial: false }),
			attributes:  new fields.SchemaField({
				hp:    valueMaxField(0, 0),
				armor: new fields.SchemaField({
					value:  new fields.NumberField({ required: true, integer: true, initial: 0 }),
					source: new fields.StringField({ required: true, blank: true }),
					// The part of `value` a printed clause takes away, and what takes it: a follower's
					// "2 (0 vs. iron)" is value 2, conditional 2, conditionalSource "vs. iron". Written
					// from the follower's card (data/follower-actor.js) and offered back on a damage card
					// with a ticked box (combat/attack-flow.js#wireConditionalArmor), the same fields a
					// character's Barkskin rides in (CharacterModel).
					conditional:       new fields.NumberField({ required: true, integer: true, initial: 0 }),
					conditionalSource: new fields.StringField({ required: true, blank: true, initial: "" }),
				}),
				damage: new fields.SchemaField({
					value:       new fields.StringField({ required: true, blank: true }),
					rollFormula: new fields.StringField({ required: true, blank: true }),
				}),
			}),
			tags:        new fields.StringField({ required: true, blank: true }),

			// Cross-links, so an NPC who's also a monster/threat points at that write-up
			// instead of duplicating its combat numbers or doom track (@UUID or plain UUID).
			statBlock:   new fields.StringField({ required: true, blank: true }),
			threat:      new fields.StringField({ required: true, blank: true }),

			// Free-form GM notes (rich text so it can hold formatting + @UUID links).
			// Shared field: edited both on the NPC sheet AND, via a pop-up rich editor,
			// from the Steading Residents/Neighbors table's "Notes" column — so a change in
			// either place shows in the other. See steading/npc-notes-dialog.js.
			notes:       new fields.HTMLField({ required: true, blank: true }),
		};
	}
}
