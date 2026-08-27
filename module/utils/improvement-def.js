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

/** A stat delta or population target as an integer; null when it is not a number. */
function asInt(value) {
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
		const items = toLines(raw?.items);
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
	const items = (Array.isArray(raw?.items) ? raw.items : []).map(i => String(i ?? "").trim()).filter(Boolean);
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
export function summarizeImprovementGrants(grants) {
	if (!grants) return [];
	const lines = [];
	for (const [key, delta] of Object.entries(grants.stats ?? {})) {
		lines.push(`${GRANT_STAT_LABELS[key] ?? key} ${delta >= 0 ? "+" : "-"}${Math.abs(delta)}`);
	}
	if (grants.resources?.length) lines.push(`Resources: ${grants.resources.join(", ")}`);
	if (grants.fortifications?.length) lines.push(`Fortifications: ${grants.fortifications.join(", ")}`);
	if (grants.removeFortifications?.length) lines.push(`Fortifications cleared: ${grants.removeFortifications.join(", ")}`);
	if (grants.setSize) lines.push(`Size becomes ${grants.setSize}`);
	if (Number.isFinite(grants.setPopulation)) lines.push(`Population becomes ${grants.setPopulation >= 0 ? "+" : ""}${grants.setPopulation}`);
	return lines;
}

/**
 * A complete improvement definition from raw authored input, in the shape both save
 * targets and the steading's own tracking expect. `category` is NOT validated here: the
 * two consumers already validate it against IMPROVEMENT_CATEGORY_KEYS, which lives with
 * the categories themselves and importing it would make this file circular.
 */
export function buildImprovementDef(input = {}) {
	return {
		name: String(input.name ?? "").trim(),
		category: String(input.category ?? "").trim(),
		flavor: String(input.flavor ?? "").trim(),
		sections: normalizeImprovementSections(input.sections),
		effect: String(input.effect ?? "").trim(),
		grants: normalizeImprovementGrants(input.grants),
	};
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
