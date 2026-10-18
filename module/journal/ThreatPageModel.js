// Data model for the "threat" JournalEntryPage subtype — the 4th custom page type
// after bestiary / location / chronicle (see stonetop.js). A threat is GM prep
// (Book I, "Threats"): a named problem with a type, an instinct, a proximity, some
// prose, an optional "doom track" (ordered grim portents ending in one impending
// doom), stakes questions, GM moves, and optional custom player moves.
//
// Threats are canonically JournalEntryPages (not steading-actor flags) for ONE
// decisive reason: players co-own the steading actor to make Homefront moves, so
// anything in its flags is replicated to their client and only soft-hidden at
// render. Every threat is a page of the steading's single "<Steading> Threats" journal,
// which stays `ownership.default: NONE` — threats are pure GM prep and are never shared
// with players (there is no per-threat "reveal"), so the tab, its pins, and the overlay
// are all GM-only.
//
// This is UI-level hiding: v14 still broadcasts world JournalEntries in full to every
// client regardless of ownership (see reference_foundry-world-docs-broadcast), so a
// player with console access could read the underlying entry. Acceptable for GM prep;
// a compendium pack would be needed for a hard secret.
import { THREAT_TYPE_IDS, THREAT_PROXIMITY_IDS, DEFAULT_THREAT_TYPE, DEFAULT_PROXIMITY } from "../threats/threat-types.js";
import { doomTrackFields, customPlayerMovesField } from "./shared-page-fields.js";

const fields = foundry.data.fields;

export class ThreatPageModel extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		return {
			// One of the eight threat types; drives the suggested GM moves + card accent.
			type: new fields.StringField({
				required: true, blank: false, initial: DEFAULT_THREAT_TYPE, choices: THREAT_TYPE_IDS,
			}),
			// Short instinct phrase, e.g. "to indulge its ego".
			instinct: new fields.StringField({ required: true, blank: true, initial: "" }),
			// Which tracker it's pinned to.
			proximity: new fields.StringField({
				required: true, blank: false, initial: DEFAULT_PROXIMITY, choices: THREAT_PROXIMITY_IDS,
			}),
			// Freeform prose: who/what it is, how it became a problem, its relationships.
			description: new fields.HTMLField({ required: true, blank: true, initial: "" }),
			// "Things Below" write-ups (Book II, pp. 416-423) add themes + aspects that flavor a
			// Thing (magicalEntity) and a corrupted site's cleansing requirements (macguffin). All
			// three are optional and empty on an ordinary threat, so no migration is needed.
			themes: new fields.ArrayField(new fields.StringField({ required: true, blank: true })),
			aspects: new fields.ArrayField(new fields.StringField({ required: true, blank: true })),
			cleansing: new fields.ArrayField(new fields.StringField({ required: true, blank: true })),
			// The ordered doom track (2-4 grim portents + one impending doom); shared with
			// the hazard page so the common doom-track wiring reads the same fields on both.
			...doomTrackFields(),
			// Future-facing stakes questions the GM is curious about.
			stakes: new fields.ArrayField(new fields.StringField({ required: true, blank: true })),
			// GM moves for this threat: seeded from the type catalog, freely editable.
			gmMoves: new fields.ArrayField(new fields.StringField({ required: true, blank: true })),
			// Optional player-facing custom moves (a roll move, an Outfit/Recover modifier, etc.).
			customPlayerMoves: customPlayerMovesField(),
			// Lesser threats embedded parenthetically (name + type + instinct), per the book.
			nested: new fields.ArrayField(new fields.SchemaField({
				name: new fields.StringField({ required: true, blank: true, initial: "" }),
				type: new fields.StringField({ required: true, blank: true, initial: "", choices: [...THREAT_TYPE_IDS, ""] }),
				instinct: new fields.StringField({ required: true, blank: true, initial: "" }),
			})),
			// Optional linked monster stat-block (to pull its moves / open on the scene).
			linkedMonsterUuid: new fields.StringField({ required: true, blank: true, initial: "" }),
			// Crossed off the tracker: "if it's no longer a threat (because it's dead, it's left, the
			// conflict has been resolved, etc.), then cross it off the threat tracker" (Book I p.299).
			// Kept, greyed and off the active board, and reversible. A page written before this field
			// reads the initial, false: every existing threat is still active.
			resolved: new fields.BooleanField({ required: true, initial: false }),
		};
	}
}
