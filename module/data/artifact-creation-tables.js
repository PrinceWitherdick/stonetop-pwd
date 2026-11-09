// The "Artifact Creation" pick-or-roll tables (Stonetop Book II, Appendix B "Artifact
// Creation", pp. 499-506), transcribed for the in-app inspiration wizard
// (StonetopArcanaInspireDialog). Kept free of Foundry/DOM so the tables + roll/seed helpers
// are unit-testable; the dialog wires them to controls and feeds the chosen results into
// createArcanumItem.

import { escHtml } from "../utils/strings.js";
import { againPool, againSpec } from "./roll-again.js";
//
// A table is an array of entries. Range entries carry { min, max } — the 1d12 rolls that
// land on that result, so a weighted roll reproduces the book's odds. Flat entries carry
// an explicit { weight } (used by "What is it?", which blends two 1d12 tables).
//
// Two row keys carry the book's directions, and the row TEXT keeps the printed instruction
// too, so a pick shown or seeded on its own still says what to do next:
//   opens   field keys (see FIELDS) the row sends you to: "go to step 2e" opens the binding and
//           spirit tables as follow-ups beneath it.
//   again   "roll again" on the same table, in the shape every generator table shares
//           (roll-again.js): { min?, max?, group? } narrows the reroll (1d8 again is { max: 8 };
//           1d8+1 is { min: 2, max: 9 }), and the row itself is never rerolled. `againCount: 2`
//           is "roll twice". The wizard rolls these follow-ups for you.

/** Build a straight 1d12 table from twelve rows, each a string or a { text, ... } object. */
const seq = rows => rows.map((row, i) => ({ min: i + 1, max: i + 1, ...(typeof row === "string" ? { text: row } : row) }));

/** Build a ranged 1d12 table from [min, max, text, extra?] rows. */
const ranges = rows => rows.map(([min, max, text, extra]) => ({ min, max, text, ...(extra ?? {}) }));

// ── Step 1: Origin / theme (1d12), p. 499 ─────────────────────────────────────
export const ORIGINS = seq([
	"The Barrow Builders",
	"Death and the undying",
	"The Fae",
	"The Forge Lords (or the Ustrina)",
	{ text: "Gods and religion (roll 1d12 for which)", opens: ["god"] },
	"The Green Lords (or the Fomoraij)",
	"Primordial powers",
	"The Rime Lords",
	"Spirits of the wild (or the Forest Folk)",
	"The Stone Lords",
	"The Tempest Lords",
	"The Things Below",
]);

// ── Step 2: Nature (1d12) — `key` branches the detail step ─────────────────────
export const NATURES = [
	{ min: 1,  max: 3,  key: "mundane",   text: "A mundane item, relic, or artifact" },
	{ min: 4,  max: 6,  key: "material",  text: "An object or amount of strange material" },
	{ min: 7,  max: 7,  key: "priceless", text: "It's priceless" },
	{ min: 8,  max: 8,  key: "property",  text: "It has an extraordinary property" },
	{ min: 9,  max: 9,  key: "spirit",    text: "It houses a spirit or sentience" },
	{ min: 10, max: 11, key: "lore",      text: "It's a source of lore" },
	{ min: 12, max: 12, key: "magic",     text: "It produces a magical effect" },
];

// "Gods and religion, roll 1d12" (p. 499), the follow-up to ORIGINS 5.
export const GODS = ranges([
	[1,  2,  "Aratis"],
	[3,  4,  "Danu"],
	[5,  6,  "Helior"],
	[7,  8,  "Tor"],
	[9,  12, "Other gods"],
]);

// ── Step 2a-2g: Detail tables (branch on nature), pp. 499-504 ──────────────────
// 2a. Mundane, p. 499.
export const WHY_THEY_CARE = ranges([
	[1,  1,  "It'd make a good trophy / gift (Value 0)"],
	[2,  2,  "It's useful — a tool, weapon, or supplies (Value 0 or 1)"],
	[3,  3,  "Useful but unusual, specialized, uncommon (Value 1)"],
	[4,  4,  "It's fine, beautiful, excellent (Value 1)"],
	[5,  5,  "It's of a distinct origin or style (Value 1 or 2 to a collector)"],
	[6,  6,  "Inherently valuable — silver, trade goods (Value 2)"],
	[7,  7,  "A true luxury and/or a symbol of status (Value 2)"],
	[8,  8,  "Precious, but only to the right buyer (Value 2 or 3)"],
	[9,  9,  "Exquisitely made, a thing of beauty (Value 3)"],
	[10, 10, "Inherently valuable — gold, gems, exotic goods (Value 3)"],
	[11, 11, "It's a clue, or it hints at the bigger picture (and roll 1d10 again)", { again: { max: 10 } }],
	[12, 12, "It presents an opportunity: a key, a resource, a map…"],
]);

// 2b. Strange material, p. 500.
export const MATERIALS = ranges([
	[1,  2,  "Makerglass, most associated with the Stone Lords (pick or roll its form and characteristic, p. 388)"],
	[3,  4,  "Aetherium, found near Tempest Lord sites (pick or roll its form and characteristic, p. 404)"],
	[5,  5,  "Orichalcum, most associated with the Forge Lords (pick or roll its variety, p. 162)"],
	[6,  7,  "Dark ice, created by the Rime Lords and their disciples (pick or roll its form and characteristic, p. 322)"],
	[8,  8,  "Black iron, associated with primordial powers and Aratis (pick or roll its form, p. 307)"],
	[9,  10, "Red crystal, a manifestation of the Things Below (roll on the red crystal/redwood table)", { opens: ["crystal"] }],
	[11, 12, "Redwood, a tether for spirits of the wild, used by the Forest Folk (roll on the red crystal/redwood table)", { opens: ["crystal"] }],
]);

// "1d12 red crystal/redwood" (p. 500), the follow-up to MATERIALS 9-12.
export const RED_CRYSTAL_REDWOOD = ranges([
	[1,  4,  "Full of untapped potential (Value 1 or 2 to the right buyer)"],
	[5,  7,  "Has an extraordinary property (step 2d)", { opens: ["property", "extra"] }],
	[8,  10, "Houses a spirit or sentience (step 2e)", { opens: ["binding", "spirit"] }],
	[11, 12, "Produces a magical effect (step 2g)", { opens: ["function", "drawback", "usage"] }],
]);

// 2c. Priceless, p. 500.
export const PRICELESS = ranges([
	[1,  1,  "Causes those who see it to covet it (Value 4)"],
	[2,  2,  "Great historical / religious importance (Value 4)"],
	[3,  3,  "Only a few were ever made, if you trust the tales (Value 4)"],
	[4,  4,  "Haunting beauty (Value 4)"],
	[5,  6,  "Beyond meager mortal arts (Value 4)"],
	[7,  8,  "Made of or with precious metals, gems, or materials (Value 4)"],
	[9,  9,  "Transcendent — it inspires those who see it (Value 4)"],
	[10, 10, "A symbol of authority over a people (Value 5)"],
	[11, 11, "Some other property that makes it Value 4 or 5"],
	[12, 12, "It's a hoard of various treasures (Value 5, immobile); roll its form (step 3) as many times as you like"],
]);

// 2d. Extraordinary property, p. 501.
export const PROPERTIES = seq([
	"Moves and acts of its own accord",
	"Absorbs ___, stores its power (fire, lightning, hatred, stillness…)",
	"Seamlessly blends materials in an impossible way",
	"Emits ___ (flame, light, sound, silence, a feeling…)",
	"Is much, much ___ than it should be (heavier, harder, faster, quieter…)",
	"Cannot be ___ (broken, burned, melted, detected…)",
	"Fills those who look upon it with ___ (greed, rage, peace, joy…)",
	"Cuts right through / can harm ___ (stone, ghosts…)",
	"Can only / cannot be perceived by ___ (Fae, spirits, the dead, murderers…)",
	"Glows / thrums / vibrates near ___ (gold, magic, lies, poison…)",
	"Protects against / repels ___ (emotional magic, fire, ghosts…)",
	{ text: "Roll twice, but treat one result as a drawback or flaw", again: {}, againCount: 2 },
]);

// "1d12 extra characteristic?" (p. 501), asked of every artifact with an extraordinary property.
export const EXTRA_CHARACTERISTIC = ranges([
	[1,  6,  "Nope, nothing more"],
	[7,  8,  "It houses a spirit or sentience (step 2e)", { opens: ["binding", "spirit"] }],
	[9,  10, "It's a source of lore (step 2f)", { opens: ["knowledge", "recording"] }],
	[11, 12, "It produces a magical effect (step 2g)", { opens: ["function", "drawback", "usage"] }],
]);

// 2e. Spirit or sentience, p. 502.
export const BINDINGS = ranges([
	[1,  2,  "Imprisoned and locked away (though imperfectly)"],
	[3,  5,  "Fettered, enslaved, forced to serve"],
	[6,  7,  "Serves willingly, bound by its own nature or desires"],
	[8,  9,  "Trapped by accident, desperation, a twist of fate"],
	[10, 12, "Dwells here naturally, spontaneously"],
]);

export const SPIRITS = seq([
	{ text: "A corrupted spirit (and roll again)", again: {} },
	"A ghost",
	"A shade or imprint of someone's personality",
	"Something from beyond the Last Door (a dool spirit, a gwyllgi)",
	"A Fae, oddly enough",
	"A little god",
	"A tulpa, or the intellect of a construct",
	"A spirit of the wild",
	"An emanation of a Thing Below",
	{ text: "A fledgling spirit (and roll 1d8+1 again)", again: { min: 2, max: 9 } },
	"An archon or other primordial entity",
	{ text: "A multitude of… (roll again)", again: {} },
]);

// 2f. Source of lore, p. 503.
export const KNOWLEDGE = ranges([
	[1,  1,  "The truth / secrets behind a group or figure of legend"],
	[2,  2,  "The weakness / history / origins / lair of a major threat"],
	[3,  4,  "The hazards / secrets / history / location of a mysterious place"],
	[5,  6,  "The workings / secrets / history / location of a magical item or arcanum"],
	[7,  9,  "An artifice or technique lost to antiquity"],
	[10, 12, "The workings of a ritual or spell (pick or roll its function and drawback, step 2g)", { opens: ["function", "drawback"] }],
]);

export const RECORDING = ranges([
	[1,  1,  "Known to an entity bound to the artifact (go back to step 2e for the spirit or sentience)", { opens: ["binding", "spirit"] }],
	[2,  5,  "Inscribed in ancient runes or a long-dead language"],
	[6,  7,  "Adorning it: carvings, paintings, decorations, diagrams"],
	[8,  9,  "Scrawled: a cypher, mad ramblings, strange annotations"],
	[10, 10, "As a vision or dream, imparted on whoever touches it"],
	[11, 12, "Inscribed clearly, for those who can read the language"],
]);

// 2g. Magical effect, p. 504.
export const FUNCTIONS = seq([
	"Create / conjure / craft",
	"Defend / repel / secure",
	"Destroy / slay / consume",
	"Contain / bind / capture",
	"Enhance / refine / purify",
	"Reduce / diminish / suppress",
	"Sustain / heal / repair",
	"Sense / identify / reveal",
	"Hide / disguise / confuse",
	"Manipulate / control / compel",
	"Transform / combine / reshape",
	{ text: "Roll twice and combine", again: {}, againCount: 2 },
]);

export const DRAWBACKS = seq([
	"Scarring: leaves a lasting thematic mark",
	"Dangerous: can have destructive, unwanted side effects",
	"Demanding: takes great effort to trigger or maintain",
	"Discordant: draws unwanted attention",
	"Fickle: fails at inopportune times",
	"Weak: easily countered by will / fortitude / preparation",
	"Indiscriminate: imprecise in its targets / duration / effect",
	"Withering: weakens you / the artifact / the target",
	"Restricted: works only in specific, thematic conditions",
	"Costly: requires sacrifice, consumes resources",
	"Slow: takes time to manifest",
	{ text: "Roll twice", again: {}, againCount: 2 },
]);

export const USAGE = ranges([
	[1,  3,  "1d6 uses, then it's consumed / ruined / powerless"],
	[4,  6,  "1d6 uses, then it must be recharged / replenished"],
	[7,  8,  "A few charges, lost with use; recharges with time or effort"],
	[9,  9,  "At will, but each use is riskier / weaker / costlier"],
	[10, 10, "At will, but with a cost or risk each use"],
	[11, 11, "At will, though limited by practicalities"],
	[12, 12, "Continuous — it's always going"],
]);

// ── Step 3: Form, pp. 505-506 ──────────────────────────────────────────────────
// The first printing reads "A item or object" for both 3-4 and 5-6 (a word was lost); the
// sizes between "small" and "immobile" are read as an item and a large item.
export const SIZES = ranges([
	[1,  2,  "A small item"],
	[3,  4,  "An item or object"],
	[5,  6,  "A large item or object"],
	[7,  8,  "An immobile object or place"],
	[9,  10, "Roll 1d8 again, but it's hard to extract, access, and/or take advantage of", { again: { max: 8 } }],
	[11, 12, "Roll 1d10 again, but it's also crude, fragile, cumbersome, and/or dangerous", { again: { max: 10 } }],
]);

// "What is it?" blends two 1d12 tables: a roll of 1–8 hits "more common", 9–12 hits
// "less common". A weighted roll reproduces those odds — each common entry is twice as
// likely as each less-common one ((8/12)/12 vs (4/12)/12) — so common entries weight 2.
const WHAT_COMMON = [
	"Agriculture: seed, spade, flail, hoe, scythe, plow, millstone…",
	"Construction: nail, brick, tile, trowel, timber, masonry, wall…",
	"Container: lock & key, pouch, box, urn, chest, vault…",
	"Domestic: utensil, spindle, vessel, broom, foodstuffs, loom…",
	"Fire: incense, oil, candle, lamp, lantern, brazier, hearth…",
	"Liquid: oil, spirits, vial, wineskin, cup, jug, barrel, fount…",
	"Protection: talisman, helm, cloak, armor, shield, door, wall…",
	"Remains: ashes, scale, fang, horn, organ, bone, hide…",
	"Textile: fibers, scarf, footwear, rope, clothes, furs, tapestry…",
	"Tool: needle, file, chisel, saw, mallet, shovel, anvil…",
	"Trade: coin, satchel, scales, wheel, sled, cart, wagon…",
	"Violence: knife, poison, sword, rod, staff, bow, spear, banner…",
].map(text => ({ weight: 2, group: "more common", text }));

const WHAT_LESS_COMMON = [
	"Art: pigments, brushes, carving, figurine, painting, statuary…",
	"Beauty: cosmetics, jewelry, comb, torc, circlet, mirror, regalia…",
	"Curiosity: a wonder, device, enigma, doohickey, toy…",
	"Husbandry: collar, brush, prod, bridle, saddle, harness, stable…",
	"Raw material: powder, salt, grains, ingot, ore, slab, timber…",
	"Music: bell, chime, flute, rattle, horn, lyre, lute, drum…",
	"Natural: flower, feather, shell, rock, wood, tree, spring, cave…",
	"Prosthesis: eye, teeth, hand, foot, arm, leg, crutch…",
	{ text: "Religion: symbol, offering, idol, altar, ceremonial ___ (roll again)", again: {} },
	"Specialized: astrolabe, level, gear, decanter, still, kiln…",
	"Writing: ink, runes, stylus, scroll, parchment, tablet, codex…",
	{ text: "A highly decorated / exquisitely made more common object (roll on the more common table)", again: { group: "more common" } },
].map(row => ({ weight: 1, group: "less common", ...(typeof row === "string" ? { text: row } : row) }));

export const WHAT_IS_IT = [...WHAT_COMMON, ...WHAT_LESS_COMMON];

// Every field the wizard can show, by key: the base field of each step and the follow-ups a
// row's `opens` names. `page` is where the table is printed in Book II.
export const FIELDS = {
	origin:    { key: "origin",    label: "Origin / theme",         table: ORIGINS,              page: 499 },
	god:       { key: "god",       label: "Which god",              table: GODS,                 page: 499 },
	nature:    { key: "nature",    label: "Nature",                 table: NATURES,              page: 499 },
	care:      { key: "care",      label: "Why they might care",    table: WHY_THEY_CARE,        page: 499 },
	material:  { key: "material",  label: "Strange material",       table: MATERIALS,            page: 500 },
	crystal:   { key: "crystal",   label: "Red crystal / redwood",  table: RED_CRYSTAL_REDWOOD,  page: 500 },
	priceless: { key: "priceless", label: "Priceless because…",     table: PRICELESS,            page: 500 },
	property:  { key: "property",  label: "Extraordinary property", table: PROPERTIES,           page: 501 },
	extra:     { key: "extra",     label: "Extra characteristic?",  table: EXTRA_CHARACTERISTIC, page: 501 },
	binding:   { key: "binding",   label: "Type of binding",        table: BINDINGS,             page: 502 },
	spirit:    { key: "spirit",    label: "Spirit or sentience",    table: SPIRITS,              page: 502 },
	knowledge: { key: "knowledge", label: "Knowledge imparted",     table: KNOWLEDGE,            page: 503 },
	recording: { key: "recording", label: "How it's recorded",      table: RECORDING,            page: 503 },
	function:  { key: "function",  label: "Function",               table: FUNCTIONS,            page: 504 },
	drawback:  { key: "drawback",  label: "Drawback",               table: DRAWBACKS,            page: 504 },
	usage:     { key: "usage",     label: "Usage",                  table: USAGE,                page: 504 },
	size:      { key: "size",      label: "Size",                   table: SIZES,                page: 505 },
	form:      { key: "form",      label: "What is it?",            table: WHAT_IS_IT,           page: 506 },
};

// The fields shown on the Form step (size + what-is-it), in order.
export const FORM_FIELDS = [FIELDS.size, FIELDS.form];

// Which detail tables a given nature opens. Keyed by NATURES[].key. Every artifact with an
// extraordinary property also asks the extra-characteristic question (p. 501).
export const DETAIL_FIELDS = {
	mundane:   [FIELDS.care],
	material:  [FIELDS.material],
	priceless: [FIELDS.priceless],
	property:  [FIELDS.property, FIELDS.extra],
	spirit:    [FIELDS.binding, FIELDS.spirit],
	lore:      [FIELDS.knowledge, FIELDS.recording],
	magic:     [FIELDS.function, FIELDS.drawback, FIELDS.usage],
};

/** Detail fields opened by a nature key (empty array for an unknown key). */
export function detailFieldsForNature(key) {
	return DETAIL_FIELDS[key] ?? [];
}

// ── Follow-ups: "go to" and "roll again" ───────────────────────────────────────

/** How deep a chain of "roll again" may run. Most chains end on their own (a size reroll
 *  narrows to 1d8), but "a corrupted spirit (and roll again)" can land on "a multitude of...
 *  (roll again)", which can land back on it, so the wizard stops adding more after this many. */
export const MAX_AGAIN_DEPTH = 4;

/** The rows a row's `again` rerolls on (roll-again.js#againPool). */
export const againTable = (table, entry) => againPool(table, entry);

/** The "rolled again" fields a picked row adds beneath its own field (two for "roll twice"). */
export function againFields(field, entry, depth = 0) {
	// A reroll of a reroll is still made on the WHOLE printed table (a corrupted spirit's
	// "roll again" can land on the multitude, whose own reroll may land back on it).
	const base = field?.againOf ?? field;
	const table = againTable(base?.table, entry);
	if (!table.length || depth >= MAX_AGAIN_DEPTH) return [];
	const count = againSpec(entry).count;
	return Array.from({ length: count }, (_, i) => ({
		key:     `${field.key}-again${count > 1 ? i + 1 : ""}`,
		label:   count > 1 ? `${base.label}, rolled again (${i + 1} of ${count})` : `${base.label}, rolled again`,
		table,
		page:    base.page,
		againOf: base,
		depth:   depth + 1,
	}));
}

/**
 * A step's base fields with every follow-up its picks open, each placed right after the field
 * that opened it: a "go to" row's `opens` fields and a "roll again" row's again-fields, to any
 * depth. A field opened twice (two rows sending you to step 2e) is shown once. `picks` maps a
 * field key to the chosen row's index in that field's table.
 */
export function expandFields(fields, picks = {}) {
	const out = [];
	const seen = new Set();
	const visit = field => {
		if (!field || seen.has(field.key)) return;
		seen.add(field.key);
		out.push(field);
		const idx = picks?.[field.key];
		const entry = Number.isInteger(idx) ? field.table[idx] : null;
		if (!entry) return;
		for (const f of againFields(field, entry, field.depth ?? 0)) visit(f);
		for (const key of entry.opens ?? []) visit(FIELDS[key]);
	};
	for (const f of fields ?? []) visit(f);
	return out;
}

/**
 * Roll `field` and follow its "roll again" rows, writing each result's index into `picks`
 * (mutated and returned). Follow-ups a roll REPLACES are cleared first, so a reroll never
 * leaves a stale "rolled again" pick under a row that no longer asks for one. "Go to"
 * follow-ups are left for the user to pick or roll: they are new questions, not rerolls.
 */
export function rollField(field, picks = {}, rng = Math.random) {
	clearAgainPicks(field?.key, picks);
	const entry = rollOnTable(field?.table, rng);
	if (!entry) return picks;
	picks[field.key] = field.table.indexOf(entry);
	return followAgain(field, picks, rng);
}

/** Roll the "rolled again" fields the current pick on `field` asks for (and theirs, in turn). */
export function followAgain(field, picks = {}, rng = Math.random) {
	const idx = picks[field?.key];
	const entry = Number.isInteger(idx) ? field.table[idx] : null;
	for (const f of againFields(field, entry, field?.depth ?? 0)) rollField(f, picks, rng);
	return picks;
}

/** Drop every "rolled again" pick hanging under `key` (its rerolls, and theirs). */
export function clearAgainPicks(key, picks = {}) {
	if (!key) return picks;
	for (const k of Object.keys(picks)) if (k.startsWith(`${key}-again`)) delete picks[k];
	return picks;
}

// ── Roll helpers ───────────────────────────────────────────────────────────────

/** A table entry's roll weight: explicit `weight`, else its 1d12 span, else 1. */
export function weightOf(entry) {
	if (entry && typeof entry.weight === "number") return entry.weight;
	if (entry && typeof entry.min === "number" && typeof entry.max === "number") return entry.max - entry.min + 1;
	return 1;
}

/**
 * Pick a random entry from a table, weighted so range tables reproduce 1d12 odds and the
 * blended "What is it?" table keeps its more/less-common split. `rng` returns a float in
 * [0, 1) (Math.random by default; inject a stub in tests).
 */
export function rollOnTable(table, rng = Math.random) {
	if (!Array.isArray(table) || !table.length) return null;
	const total = table.reduce((sum, e) => sum + weightOf(e), 0);
	let r = Math.floor((rng() || 0) * total);
	for (const e of table) {
		r -= weightOf(e);
		if (r < 0) return e;
	}
	return table[table.length - 1];
}

// ── Seed builders (feed the chosen results into the new card) ─────────────────────

/**
 * Build the GM-notes seed for a created card (flags.stonetop.gmNotes) from the chosen result lines:
 * an italic "Inspiration" heading + a bullet per pick (label: text). `lines` is an ordered
 * array of { label, text }; blank/empty entries are skipped. Returns "" for no lines.
 */
export function seedDescriptionHtml(lines) {
	const rows = (lines ?? []).filter(l => l && l.text);
	if (!rows.length) return "";
	const items = rows
		.map(l => `<li><strong>${escHtml(l.label)}:</strong> ${escHtml(l.text)}</li>`)
		.join("");
	return `<p><em>Inspiration (Artifact Creation)</em></p><ul>${items}</ul>`;
}
