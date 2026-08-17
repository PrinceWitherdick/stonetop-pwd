// System data model for the "gmToolkit" Actor subtype — the GM's own sheet, the screen-side
// companion to the GM playbook (Book I, "Running the Game").
//
// Nearly everything the sheet shows is REFERENCE and lives in code rather than here: the GM move
// lists and the core-loop diagrams are transcribed from the playbook (module/gm-toolkit/), and the
// Threats and Sites tabs read their storage off the STEADING actor (see gm-prep-tabs.js). Reading
// preferences that persist (which sections are folded, the window's size) are client settings
// keyed by actor id, not document data.
//
// `wonders` is the one thing a GM AUTHORS on this sheet: the "I wonder..." list from Book I p.33,
// which the playbook prints as a column of ruled lines. It is world-level prep rather than one
// GM's private notes, which is why it sits on the toolkit (a singleton — see gm-toolkit-actor.js)
// and not on the User.
//
// A field added here must tolerate absence on toolkits created before it: `initial` covers that
// for every field type this system uses, which is what lets this stay additive with no migration.
import { wondersField } from "./fields.js";

export class GmToolkitModel extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		return {
			wonders: wondersField(),
		};
	}
}
