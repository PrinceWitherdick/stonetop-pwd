// The shape of a steading improvement, and the normalizers that keep every way of
// authoring one honest. Three paths produce a definition and they must all agree:
//
//   - the builder dialog (ImprovementBuilderDialog), typing one from scratch;
//   - a homebrew journal card, dropped onto a steading (steading-improvement-cards.js);
//   - the book's own IMPROVEMENT_DEFINITIONS in StonetopSteading.js.
//
// A definition is `{ name, category, flavor, sections[], effect, grants }`. The parts
// that used to be lost on the authored paths, and are the reason this file exists:
//
//   sections[].min    how many of the section's items must be ticked (absent = all of
//                     them), so "Requires 2 of the following" is authorable;
//   sections[].group  sections sharing a group id are ALTERNATIVES (OR) rather than
//                     each standing on their own (AND): Weapons of War's "either this,
//                     or all of these";
//   grants            the one-time mechanical effects applied when it is completed, the
//                     custom-improvement twin of IMPROVEMENT_GRANTS.
//
// The first two are already understood by improvementRequirementsMet and the third by
// setImprovementCompleted; what was missing was any way to author them, and anywhere
// for them to survive between the form and the steading.
//
// A heading, a requirement item and the effect prose are stored as HTML, because that is
// what the book's own definitions already are ("<em>Pull Together</em>") and what both
// readers paint unescaped. Authored text therefore passes through formatImprovementText
// on its way in: escaped once, then the single piece of markup the playbook actually
// uses, *asterisks* around a move name, resolved to <em>. unformatImprovementText is the
// way back out, for re-opening an improvement that already exists in the builder.

import { decodeEntities, escHtml } from "./strings.js";

/** Where each grantable steading stat lives, keyed by the name a grant uses. */
export const GRANT_STAT_PATHS = {
	fortunes:   "stats.fortunes.value",
	defenses:   "stats.defenses.value",
	prosperity: "attributes.prosperity.value",
	population: "attributes.population.value",
};

/** Display names for the same four, for the "here is what completing it did" notice. */
export const GRANT_STAT_LABELS = {
	fortunes: "Fortunes",
	defenses: "Defenses",
	prosperity: "Prosperity",
	population: "Population",
};

/** The four sizes a steading can be set to (matching the Size radios on the sheet). */
export const STEADING_SIZES = ["hamlet", "village", "town", "city"];

/**
 * A stat delta or population target as an integer; null when it is not a number.
 *
 * A BLANK field is not a zero. `Number("")` is 0, and that one coercion was enough to
 * make the untouched "Set Population to" box read as a real grant: every improvement the
 * builder saved carried `setPopulation: 0`, so completing any of them reset the
 * steading's Population to +0. An explicit "0" still means zero (Township sets exactly
 * that), which is why the emptiness test is on the input rather than on the result.
 */
function asInt(value) {
	if (value === null || value === undefined) return null;
	if (typeof value === "string" && !value.trim()) return null;
	const n = Number(value);
	return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** A line-per-entry textarea (or an array) as a list of trimmed, non-empty strings. */
export function toLines(value) {
	const list = Array.isArray(value) ? value : String(value ?? "").split("\n");
	return list.map(s => String(s ?? "").trim()).filter(Boolean);
}

/**
 * The heading an authored requirement group gets when its author left the field blank.
 * Written to read like the playbook's own: the first group states the requirement, a
 * later one continues it, and an alternative offers the other way to meet the one above.
 * @param {{index?: number, min?: number|null, count?: number, alternative?: boolean}} opts
 */
export function defaultSectionHeading({ index = 0, min = null, count = 0, alternative = false } = {}) {
	const partial = Number.isFinite(min) && min > 0 && min < count;
	if (alternative) return partial ? `Or ${min} of these:` : "Or all of these:";
	if (index > 0) return partial ? `And ${min} of the following:` : "And then:";
	return partial ? `Requires ${min} of the following:` : "Requires all of the following:";
}

/**
 * Turn the builder's requirement GROUPS, as the author filled them in, into definition
 * sections. Two things are resolved here rather than being asked of the author:
 *
 *  - a blank heading gets the one the playbook would print (defaultSectionHeading),
 *    which depends on the group's position, its count and its either/or state; and
 *  - "alternative to the group above" becomes the shared `group` id the requirement
 *    check reads (improvementRequirementsMet), minted on the first group of a run and
 *    stamped BACK onto its predecessor, which had no idea it was about to become one of
 *    two ways to meet a single requirement. A run of three alternatives shares one id.
 *
 * Pure, and separate from the DOM read in ImprovementBuilderDialog, because this is the
 * part with the rules in it.
 *
 * @param {Array<{heading?:string, items?:string|string[], partial?:boolean, min?:number, alternative?:boolean}>} groups
 */
export function sectionsFromGroups(groups = []) {
	const sections = [];
	let groupId = "";
	let runs = 0;

	for (const raw of groups) {
		// `rows` is what the dialog reads now: one control per checkbox, each with its own
		// repeat. `items` stays for a caller holding a plain line-list, which is what the
		// pure tests and a dropped card's payload hand over.
		const items = raw?.rows ? itemsFromRows(raw.rows) : toLines(raw?.items);
		const typed = String(raw?.heading ?? "").trim();
		// A group left completely blank is not a requirement, it is a row the author
		// added and did not use. Dropped here rather than kept with the heading that
		// would otherwise be written for it.
		if (!items.length && !typed) continue;

		const min = raw?.partial ? asInt(raw?.min) : null;
		const index = sections.length;
		const previous = sections[index - 1];
		// An alternative needs something to be an alternative TO: the first group has
		// nothing above it, and neither does one whose predecessors were all blank.
		const alternative = !!raw?.alternative && !!previous;

		if (alternative) {
			if (!groupId) { groupId = `alt${++runs}`; previous.group = groupId; }
		} else {
			groupId = "";
		}

		const section = {
			heading: typed || defaultSectionHeading({ index, min, count: items.length, alternative }),
			items,
		};
		if (min !== null) section.min = min;
		if (alternative) section.group = groupId;
		sections.push(section);
	}

	return sections;
}

/**
 * Normalize one authored requirement group. `min` is kept only when it is a real
 * "some of these" count: below 1, or at or above the item count, it means "all of them",
 * which is exactly what leaving it off already says (see sectionRequiredCount). `group`
 * is kept only when non-empty, since "" would read as a shared group id joining every
 * section that lacked one into a single OR.
 */
function normalizeSection(raw) {
	// The Array.isArray guard stays: `toLines` SPLITS a bare string on newlines, and a section
	// that arrived with `items` as a string should normalize to no items, not to a line list.
	const items = toLines(Array.isArray(raw?.items) ? raw.items : []);
	const section = { heading: String(raw?.heading ?? "").trim(), items };
	const min = asInt(raw?.min);
	if (min !== null && min >= 1 && min < items.length) section.min = min;
	const group = String(raw?.group ?? "").trim();
	if (group) section.group = group;
	return section;
}

/**
 * Normalize a whole requirement list, dropping groups that carry neither a heading nor
 * an item. A heading-only group is kept: it costs no checkbox (the stored `r` array is
 * indexed by ITEMS, so an empty group shifts nothing) and it is a legitimate note.
 */
export function normalizeImprovementSections(raw) {
	return (Array.isArray(raw) ? raw : [])
		.map(normalizeSection)
		.filter(s => s.heading || s.items.length);
}

/**
 * Normalize an improvement's auto-applied grants, or null when nothing survives. Mirrors
 * what StonetopSteading's grant engine can actually apply AND reverse, so an authored
 * improvement can never record an effect that completing it would not perform: unknown
 * stat keys, zero deltas, and a size outside the four tiers are dropped here rather than
 * sitting in the definition looking like they work.
 */
export function normalizeImprovementGrants(raw) {
	if (!raw || typeof raw !== "object") return null;
	const grants = {};

	const stats = {};
	for (const [key, value] of Object.entries(raw.stats ?? {})) {
		if (!GRANT_STAT_PATHS[key]) continue;
		const delta = asInt(value);
		if (delta) stats[key] = delta;
	}
	if (Object.keys(stats).length) grants.stats = stats;

	for (const key of ["resources", "fortifications", "removeFortifications"]) {
		const list = toLines(raw[key]);
		if (list.length) grants[key] = list;
	}

	if (STEADING_SIZES.includes(raw.setSize)) grants.setSize = raw.setSize;
	const population = asInt(raw.setPopulation);
	if (population !== null) grants.setPopulation = population;

	return Object.keys(grants).length ? grants : null;
}

/**
 * A normalized grant set as short display lines ("Fortunes +1", "Resources: Mill"), for
 * showing an authored improvement's automatic effects where its prose is shown.
 *
 * The twin of StonetopSteading's _summarizeGrantChanges, which reads the record of what
 * an improvement ACTUALLY applied to one steading (and so knows the size it changed
 * from). This one reads the definition, before anything has been applied.
 * @param {object|null} grants
 * @returns {string[]}
 */
/**
 * One stat line of a grant, signed. Shared with StonetopSteading#_summarizeGrantChanges, which
 * says the same thing about an APPLIED record: two twins reading different inputs is fair, two
 * copies of the wording is not — they had already drifted to different minus glyphs, so the same
 * ±1 printed two ways depending on which surface you read it from. U+2212 is the one that stays.
 */
export function statGrantLine(key, delta) {
	return `${GRANT_STAT_LABELS[key] ?? key} ${delta >= 0 ? "+" : "−"}${Math.abs(delta)}`;
}

export function summarizeImprovementGrants(grants) {
	if (!grants) return [];
	const lines = [];
	for (const [key, delta] of Object.entries(grants.stats ?? {})) {
		lines.push(statGrantLine(key, delta));
	}
	if (grants.resources?.length) lines.push(`Resources: ${grants.resources.join(", ")}`);
	if (grants.fortifications?.length) lines.push(`Fortifications: ${grants.fortifications.join(", ")}`);
	if (grants.removeFortifications?.length) lines.push(`Fortifications cleared: ${grants.removeFortifications.join(", ")}`);
	if (grants.setSize) lines.push(`Size becomes ${grants.setSize}`);
	if (Number.isFinite(grants.setPopulation)) lines.push(`Population becomes ${grants.setPopulation >= 0 ? "+" : ""}${grants.setPopulation}`);
	return lines;
}

// ── Authored text ───────────────────────────────────────────

/**
 * One line of authored text as the HTML a definition stores: escaped first, so nothing
 * typed can become markup, then *asterisks* resolved to <em>. Italics are the only thing
 * the playbook's improvements mark up, and they mark up a great deal with them (a move
 * name in nearly every requirement), which is why there is a shorthand for that and for
 * nothing else.
 *
 * A lone or unclosed asterisk is left alone rather than swallowed, so "Value 2 * 3" and a
 * half-typed emphasis both survive.
 */
export function formatImprovementText(raw) {
	return escHtml(String(raw ?? "").trim()).replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

/**
 * The inverse, for filling the builder from a definition that already exists: <em> back
 * to *asterisks*, then the escapes undone, so what the author is shown is what they would
 * have typed. Any other markup a built-in carries is shown as its own source, which is
 * honest about the fact that re-saving would escape it.
 *
 * Undone through `decodeEntities`, the system's one decoder, rather than a local table of the
 * six entities `escHtml` writes: the book's own definitions carry `&mdash;` and `&rsquo;`, and a
 * narrower table shows those raw on screen the moment an author presses "Start from".
 */
export function unformatImprovementText(html) {
	const starred = String(html ?? "").replace(/<em>([\s\S]*?)<\/em>/gi, "*$1*");
	return decodeEntities(starred).trim();
}

/** Ceiling on a row's repeat, so a mistyped count cannot mint a thousand checkboxes. */
export const MAX_REQUIREMENT_REPEAT = 20;

/** 1st, 2nd, 3rd, 4th: the suffix the book uses when a requirement is done N times. */
export function ordinal(n) {
	const num = Math.trunc(Number(n) || 0);
	const tens = Math.abs(num) % 100;
	const ones = Math.abs(num) % 10;
	const suffix = (tens >= 11 && tens <= 13) ? "th" : (["th", "st", "nd", "rd"][ones] ?? "th");
	return `${num}${suffix}`;
}

/**
 * A group's requirement ROWS as the flat item list a definition stores. A row repeated
 * more than once becomes that many boxes, numbered the way the playbook numbers them:
 * "Pull Together (1st)" through "(5th)". Additional Housing, Raincatching, Stone Wall,
 * Township and Weapons of War are all built that way, and typing the same line five times
 * with the ordinals spelled out by hand is the part of authoring one that nobody should
 * be doing.
 *
 * @param {Array<{text?: string, repeat?: number|string}>} rows
 * @returns {string[]}
 */
export function itemsFromRows(rows = []) {
	const items = [];
	for (const row of Array.isArray(rows) ? rows : []) {
		const text = String(row?.text ?? "").trim();
		if (!text) continue;
		const repeat = Math.min(Math.max(asInt(row?.repeat) ?? 1, 1), MAX_REQUIREMENT_REPEAT);
		if (repeat === 1) { items.push(text); continue; }
		for (let i = 1; i <= repeat; i++) items.push(`${text} (${ordinal(i)})`);
	}
	return items;
}

/**
 * The inverse of itemsFromRows: a stored item list back as authoring rows, collapsing any
 * run that itemsFromRows would have produced (the same text, ordinals running from one)
 * into a single repeated row. Anything else stays one row per item, which is the honest
 * reading: the Inn's numbered steps each carry their own cost text and are not one
 * requirement listed twice.
 * @param {string[]} items
 */
export function rowsFromItems(items = []) {
	const list = (Array.isArray(items) ? items : []).map(i => String(i ?? ""));
	const rows = [];
	for (let i = 0; i < list.length;) {
		const match = /^(.*) \(1st\)$/.exec(list[i]);
		let run = 1;
		if (match) {
			while (i + run < list.length && list[i + run] === `${match[1]} (${ordinal(run + 1)})`) run++;
		}
		if (match && run > 1) rows.push({ text: match[1], repeat: run });
		else rows.push({ text: list[i], repeat: 1 });
		i += run;
	}
	return rows;
}

/**
 * Carry an improvement's ticked requirement boxes across an EDIT to its requirements.
 *
 * The stored tick array `r` is FLAT and POSITIONAL, indexed by box across all sections, so
 * inserting a step at the top of a half-finished improvement would otherwise slide every
 * tick onto the wrong requirement. Boxes are matched on their TEXT instead: a step that
 * survived the edit keeps its tick wherever it moved to, a new one starts unticked, and a
 * deleted one takes its tick with it.
 *
 * Repeated text (the same row written twice, or a repeat's numbered boxes if they were
 * renumbered) is matched in order, first old occurrence to first new one, which is the only
 * reading available when the texts are identical.
 *
 * @param {string[]} oldItems  the flat item list the ticks were recorded against
 * @param {string[]} newItems  the flat item list after the edit
 * @param {boolean[]} ticks    the stored `r`
 * @returns {boolean[]} `r` for the new list
 */
export function remapRequirementTicks(oldItems = [], newItems = [], ticks = []) {
	const byText = new Map();
	(Array.isArray(oldItems) ? oldItems : []).forEach((item, i) => {
		const key = String(item ?? "");
		if (!byText.has(key)) byText.set(key, []);
		byText.get(key).push(!!ticks?.[i]);
	});
	return (Array.isArray(newItems) ? newItems : []).map(item => {
		const queue = byText.get(String(item ?? ""));
		return queue?.length ? queue.shift() : false;
	});
}

/** Every requirement box of a definition, flat and in order: the list `r` is indexed by. */
export function flatRequirementItems(def) {
	return (def?.sections ?? []).flatMap(section => section?.items ?? []);
}

/**
 * A definition's sections back as the builder's requirement GROUPS: the round trip of
 * sectionsFromGroups, so an improvement that already exists (one of the book's, or one
 * already added to a steading) can be opened in the builder and copied or corrected
 * rather than retyped out of the playbook.
 *
 * An authored heading comes back verbatim rather than being dropped for the written-for-
 * you one, because a built-in's heading is often not the one defaultSectionHeading would
 * write ("Requires either one of these:", "And these:"), and a copy that silently
 * reworded itself would not be a copy.
 * @param {Array<{heading?:string, items?:string[], min?:number, group?:string}>} sections
 */
export function groupsFromSections(sections = []) {
	const alternatives = alternativeSectionFlags(sections);
	return (Array.isArray(sections) ? sections : []).map((section, i) => {
		const items = section?.items ?? [];
		const partial = Number.isFinite(section?.min) && section.min > 0 && section.min < items.length;
		return {
			heading: unformatImprovementText(section?.heading ?? ""),
			rows: rowsFromItems(items.map(unformatImprovementText)),
			partial,
			min: partial ? section.min : 1,
			alternative: alternatives[i],
		};
	});
}

/**
 * A complete improvement definition from raw authored input, in the shape both save
 * targets and the steading's own tracking expect. `category` is NOT validated here: the
 * two consumers already validate it against IMPROVEMENT_CATEGORY_KEYS, which lives with
 * the categories themselves and importing it would make this file circular.
 */
export function buildImprovementDef(input = {}) {
	// `name` and `flavor` are plain text everywhere they are painted (both readers use a
	// double-stash), so they are trimmed and otherwise left alone. The other three are
	// HTML in the book's own definitions and are painted unescaped, so authored text is
	// escaped and its *asterisks* resolved once here rather than at each surface.
	return {
		name: String(input.name ?? "").trim(),
		category: String(input.category ?? "").trim(),
		flavor: String(input.flavor ?? "").trim(),
		sections: normalizeImprovementSections(input.sections).map(section => ({
			...section,
			heading: formatImprovementText(section.heading),
			items: section.items.map(formatImprovementText),
		})),
		effect: formatImprovementText(input.effect),
		grants: normalizeImprovementGrants(input.grants),
	};
}

/**
 * How many of a section's items must be ticked for it to count: its `min` when it declares
 * one, otherwise all of them.
 * @param {{min?: number, items?: string[]}} section
 */
export function sectionRequiredCount(section) {
	return Number.isFinite(section?.min) ? section.min : (section?.items?.length ?? 0);
}

/**
 * Total number of requirement checkboxes across an improvement's sections - i.e. the flat
 * length of its `r` tracking array.
 *
 * The one definition of that arithmetic, because three separate readers walk the same flat
 * index and must agree on it: the requirement check, the force-complete that fills every box
 * at once, and season-effects.js's two rules that turn on WHICH box was ticked while building.
 * If a heading-only section ever started consuming a box, a second copy of this sum would
 * leave one of those three quietly pointing at the wrong requirement.
 * @param {{sections?: Array}} def
 */
export function improvementRequirementCount(def) {
	return (def?.sections ?? []).reduce((n, s) => n + (s?.items?.length ?? 0), 0);
}

/**
 * Which sections of a definition are alternatives to the one before them, for display: a
 * section whose group id matches its predecessor's continues an either/or rather than
 * adding a further requirement. Returned as a parallel array of booleans so the sheet's
 * snapshot and the journal card can draw the same "or" divider from one rule.
 * @param {Array<{group?: string}>} sections
 */
export function alternativeSectionFlags(sections = []) {
	return sections.map((s, i) => !!s?.group && i > 0 && sections[i - 1]?.group === s.group);
}
