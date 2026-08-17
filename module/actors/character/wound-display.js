// Wound presentation tables, shared by the sheet's wound line (StonetopCharacterSheet
// `_buildWoundsView`) and the wound editor (dialogs/WoundDialog.js). One copy so a row's
// glyph/label and the editor's pickers can't drift apart.

// Wound status → sheet presentation. Untreated wounds glow the bestiary red, treated
// ones fade to a bandage, permanent ones lock. Labels feed the row tooltip.
export const WOUND_STATUS_GLYPH = { problematic: "fa-droplet", stabilized: "fa-bandage", permanent: "fa-lock" };

export const WOUND_STATUS_LABEL = {
	problematic: "Problematic: untreated, still hindering",
	stabilized:  "Stabilized: treated, but not yet healed",
	permanent:   "Permanent: this one can't heal",
};

// Picker options. The label stays one word so the tiles read as a short list; `hint`
// carries the state's meaning and which move moves a wound out of it.
export const WOUND_STATUS_OPTIONS = [
	{ value: "problematic", label: "Problematic", hint: "Untreated, still hindering. Recover stabilizes it." },
	{ value: "stabilized",  label: "Stabilized",  hint: "Treated, not yet healed. Convalesce heals it." },
	{ value: "permanent",   label: "Permanent",   hint: "Can't heal. Retire, or Make a Plan to adapt." },
];

export const WOUND_ORIGIN_OPTIONS = [
	{ value: "wound",       label: "Wound" },
	{ value: "deaths-door", label: "Death's-Door mark" },
];
