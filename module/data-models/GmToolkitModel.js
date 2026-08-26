// System data model for the "gmToolkit" Actor subtype — the GM's own sheet, the screen-side
// companion to the GM playbook (Book I, "Running the Game").
//
// Nearly everything the sheet shows is REFERENCE and lives in code rather than here: the GM move
// lists and the core-loop diagrams are transcribed from the playbook (module/gm-toolkit/), and the
// Threats and Sites tabs read their storage off the STEADING actor (see gm-prep-tabs.js). Reading
// preferences that persist (which sections are folded, the window's size) are client settings
// keyed by actor id, not document data.
//
// Two fields, and both are things a GM AUTHORS on this sheet rather than reads:
//
//   `wonders`    the "I wonder..." list from Book I p.33, which the playbook prints as a column
//                of ruled lines.
//   `encounters` what has been gathered for a session or a scene — the monsters, the map, the
//                read-aloud page — each bundle pointing at documents by uuid rather than copying
//                them (see gm-encounters-tab.js).
//
//   `expeditions` a trip prepped in advance: the same card, gathering the regional map, the sites
//                on the way, whatever is waiting at the end. It carries one field the encounter
//                card has not, `tripId`, which is what ties a prepped expedition to the trip the
//                "Run an Expedition" walkthrough is recording (see gm-expeditions-tab.js). The
//                walkthrough's own log stays where it is, in the `expeditionAnswers` world
//                setting: what it holds is what happened at the table, which is a different thing
//                from what was gathered beforehand.
//
// All three sit on the toolkit (a singleton — see gm-toolkit-actor.js) rather than on the User,
// because all three are world-level prep: a world has one set of open questions, one set of
// prepared encounters and one set of prepared trips whoever is running it, and a second GM
// opening their own toolkit should see the same lists.
//
// A field added here must tolerate absence on toolkits created before it: `initial` covers that
// for every field type this system uses, which is what lets this stay additive with no migration
// — and is exactly what let `expeditions` be added to worlds whose toolkit already existed.
import { wondersField, encountersField, expeditionsField } from "./fields.js";

export class GmToolkitModel extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		return {
			wonders: wondersField(),
			encounters: encountersField(),
			expeditions: expeditionsField(),
		};
	}
}
