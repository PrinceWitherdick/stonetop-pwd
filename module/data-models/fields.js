// Shared schema-field factories for the system DataModels. Several models store
// the same shapes (a single integer `value`, a `{value, max}` resource, a
// debility toggle), so the factory lives here once instead of being re-declared
// per model.
const fields = foundry.data.fields;

// A `{ value: <integer> }` sub-object (stats, armor, level, population, …).
export const valueField = (initial = 0) => new fields.SchemaField({
	value: new fields.NumberField({ required: true, integer: true, initial }),
});

// A `{ value, max }` integer resource pair (hp, xp). `extras` adds sibling fields for a
// resource that carries more than the pair (HP's permanent adjustment), so those stay
// grouped with the track they belong to instead of floating loose under `attributes`.
export const valueMaxField = (value = 0, max = 0, extras = {}) => new fields.SchemaField({
	value: new fields.NumberField({ required: true, integer: true, initial: value }),
	max:   new fields.NumberField({ required: true, integer: true, initial: max }),
	...extras,
});

// A debility toggle. Characters also tag each debility with the stats it covers;
// pass `stat` (an array of stat keys) to include that field, omit it otherwise.
export const debility = (label, stat) => {
	const schema = {
		label: new fields.StringField({ required: true, initial: label }),
		value: new fields.BooleanField({ required: true, initial: false }),
	};
	if (stat !== undefined) {
		schema.stat = new fields.ArrayField(new fields.StringField(), { initial: stat });
	}
	return new fields.SchemaField(schema);
};

// An irregularly-shaped sub-object preserved verbatim, defaulting to null (falsy)
// rather than {} so truthiness checks (e.g. `system.resource`) behave correctly.
export const looseObject = () => new fields.ObjectField({ required: false, nullable: true, initial: null });

// The character's problematic/permanent wounds — the 3rd/4th harm types from Book I
// (Harm & Healing) that aren't HP or debilities. An additive ArrayField, so existing
// worlds load with an empty list and need no migration. `status`/`origin` are plain
// StringFields (NOT `choices`-constrained) so a value written by a newer build can't
// wedge an older one on read; the snapshot layer coerces unknown values back to a
// safe default. Each element:
//   id              stable key (foundry.utils.randomID)
//   text            the fictional consequence ("Twisted ankle, can't bear weight")
//   status          "problematic" | "stabilized" | "permanent"
//   origin          "wound" | "deaths-door"
//   requirementNote GM-named requirement stored on the Recover "names a requirement" fork
//   planNote        Make-a-Plan / adaptation goal (permanent injuries)
//   planRequirements Make-a-Plan tick-box requirements [{text, done}] (Book I p.530)
//   mechanicalTag   lasting reminder text, e.g. "Let Fly at disadvantage until practiced"
//   reminderMove    move name the tag echoes onto at roll time ("" = none, "*" = all move rolls;
//                   the echo rides 2d6+stat move rolls only, not damage/formula/Death's-Door rolls)
//   healed          true → moved to the collapsed "Scars" disclosure rather than deleted
export const woundsField = () => new fields.ArrayField(new fields.SchemaField({
	id:              new fields.StringField({ required: true, blank: true, initial: () => foundry.utils.randomID() }),
	text:            new fields.StringField({ required: true, blank: true }),
	status:          new fields.StringField({ required: true, blank: true, initial: "problematic" }),
	origin:          new fields.StringField({ required: true, blank: true, initial: "wound" }),
	requirementNote: new fields.StringField({ required: true, blank: true }),
	planNote:        new fields.StringField({ required: true, blank: true }),
	planRequirements: new fields.ArrayField(new fields.SchemaField({
		text: new fields.StringField({ required: true, blank: true }),
		done: new fields.BooleanField({ required: true, initial: false }),
	}), { required: false, initial: [] }),
	mechanicalTag:   new fields.StringField({ required: true, blank: true }),
	reminderMove:    new fields.StringField({ required: true, blank: true }),
	healed:          new fields.BooleanField({ required: true, initial: false }),
}), { required: false, initial: [] });

// The GM's "I wonder..." list — the running list of open questions Book I p.33 asks a GM to
// keep, and the GM playbook prints a column of ruled lines for. Additive like `woundsField`, so
// a toolkit made before this field loads with an empty list and needs no migration. Each element:
//   id       stable key (foundry.utils.randomID)
//   question the thing wondered about, one line ("What did happen to the Forest Folk?")
//   answer   what play (or the GM) settled on, or a hunch, or nothing yet
//   settled  true -> moved to the collapsed "Answered" fold rather than deleted
//
// `trim: false` on both, because the sheet writes these on BLUR without re-rendering (see
// gm-wonder-tab.js): a field the model quietly trims would then hold one string while the box
// the GM is looking at holds another, and nothing on screen would say which one was saved.
// The add bar trims its own input instead, where trimming is what the GM means.
export const wondersField = () => new fields.ArrayField(new fields.SchemaField({
	id:       new fields.StringField({ required: true, blank: true, initial: () => foundry.utils.randomID() }),
	question: new fields.StringField({ required: true, blank: true, trim: false }),
	answer:   new fields.StringField({ required: true, blank: true, trim: false }),
	settled:  new fields.BooleanField({ required: true, initial: false }),
}), { required: false, initial: [] });

// The GM's Encounters list — what has been gathered for one session or one scene: the monsters,
// the read-aloud page, the map, the treasure table, the arcanum somebody is about to find. One
// flat list per encounter, because what a GM reaches for mid-scene is "everything for THIS", not
// "the actors, then the journals". Additive like `wondersField` and `woundsField`, so a toolkit
// made before this field loads with an empty list and needs no migration. Each element:
//   id       stable key (foundry.utils.randomID)
//   name     what the GM calls it ("The bridge at dusk")
//   notes    the prose box on the encounter itself, folded away with the row
//   used     true -> already run, marked down rather than deleted
//   entries  what was dropped into it, in the order the GM arranged
//
// AN ENTRY CACHES `name` AND `type` AND NOTHING ELSE, which is the one judgement in this shape:
//   uuid  kept WHOLE, compendium and all. RosterDialog throws a pack uuid away and stores the
//         bare name, and is right to — a Condemned row names a person in this world. An
//         encounter is the other case entirely: the bestiary, the arcana and the journals ARE
//         packs, so a list that could not point into one would be a list of almost nothing.
//   type  the documentName. It arrives free on core's own drag payload, so it never costs a
//         resolve; it picks the row's icon; it is what Deploy filters on; and it is the only
//         thing that still says what KIND of thing went missing once the uuid resolves to null.
//         A plain StringField, NOT `choices`-constrained, for the reason `woundsField` gives
//         above: a value written by a newer build must not wedge an older one on read.
//   name  the label a broken row keeps, so a GM can see WHICH thing went and re-add it. Never a
//         second source of truth: the resolver prefers the live document's name whenever there
//         is one, exactly as `resolvePersonRow` does on the steading.
//   NO `img`. It is derived chrome, it goes stale on every re-portrait, and the row that would
//         have needed it — the broken one — shows its type icon instead. A cached field with no
//         reader can only ever be wrong.
//   note  the per-entry line ("opens the door on round 2").
//
// `notes` is an HTMLField and the rest are plain: the encounter's own box holds read-aloud text
// and @UUID links and is edited in a pop-up ProseMirror (bundle-notes-dialog.js), while the
// name and the per-entry note are single lines typed in place.
//
// `trim: false` on the plain prose, for the reason `wondersField` gives: these save on BLUR
// without re-rendering, and a field the model quietly trimmed would leave the box holding one
// string and the document holding another with nothing on screen saying which was saved.
//
// SHARED WITH THE EXPEDITIONS TAB, which stores the same card — see `expeditionsField` below. The
// shape is built by a factory rather than written twice, because the two lists are read and
// written by ONE piece of machinery (actors/gmtoolkit/gm-bundle-tab.js) and a field it did not
// know about on one of them would be silently dropped on the first edit: an ArrayField is diffed
// by REPLACEMENT, so every write is the whole list.
const bundleSchema = (extra = {}) => ({
	id:    new fields.StringField({ required: true, blank: true, initial: () => foundry.utils.randomID() }),
	name:  new fields.StringField({ required: true, blank: true, trim: false }),
	notes: new fields.HTMLField({ required: true, blank: true }),
	used:  new fields.BooleanField({ required: true, initial: false }),
	entries: new fields.ArrayField(new fields.SchemaField({
		id:   new fields.StringField({ required: true, blank: true, initial: () => foundry.utils.randomID() }),
		uuid: new fields.StringField({ required: true, blank: true }),
		type: new fields.StringField({ required: true, blank: true }),
		name: new fields.StringField({ required: true, blank: true, trim: false }),
		note: new fields.StringField({ required: true, blank: true, trim: false }),
	}), { required: false, initial: [] }),
	...extra,
});

export const encountersField = () => new fields.ArrayField(new fields.SchemaField(bundleSchema()), { required: false, initial: [] });

// The GM Toolkit's Expeditions tab: a trip prepped in advance, gathering the maps, the sites, the
// monsters on the road and the page to read aloud when the party arrives — the same card the
// Encounters tab holds, with one field of its own.
//
// `tripId` is the JOIN to the walkthrough. The "Run an Expedition" window (dialogs/
// ExpeditionDialog.js) keeps its own LOG of trips in the world-scoped `expeditionAnswers`
// setting, because what it records is what happened at the table on a particular night — the
// route they took, what they were told, what they carried — and that is a different thing from
// the prep gathered here. Pressing Run on this card opens the walkthrough on the trip named here,
// minting one the first time; the id is written back so the second press reaches the SAME trip
// with everything already noted in it, rather than starting the night over.
//
// A STALE ID IS NOT AN ERROR. Deleting a trip from the walkthrough's own log leaves this pointing
// at nothing, and the next Run simply mints a fresh trip and overwrites it (see
// `ExpeditionDialog.openOnTrip`). Blank on every card until the first Run, which is also what
// every card written before this field existed reads as.
export const expeditionsField = () => new fields.ArrayField(new fields.SchemaField(bundleSchema({
	tripId: new fields.StringField({ required: true, blank: true }),
})), { required: false, initial: [] });

// Schema for the two minimal move subtypes (npcMove / monsterMove): just a
// rich-text description and an optional roll formula.
export const simpleMoveSchema = () => ({
	description: new fields.HTMLField({ required: true, blank: true }),
	rollFormula: new fields.StringField({ required: true, blank: true }),
});
