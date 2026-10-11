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

import { decodeEntities, escHtml, signed } from "./strings.js";

export { signed };

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

/** The four seasons, in the year's order: what a yield's or an upkeep's `seasons` may name. */
export const SEASON_IDS = ["spring", "summer", "autumn", "winter"];

/**
 * The steading moves a `rollAdvantage` grant may name, spelled as their roll cards spell them
 * (improvement-rolls.js#STEADING_MOVE). The homefront moves the book's improvements give
 * advantage to; the improvement-moves (Aurochs Hunt, Heroic Reputation) are their own rules.
 */
export const ROLL_ADVANTAGE_MOVES = ["Deploy", "Muster", "Pull Together", "Trade & Barter", "Requisition"];

/**
 * THE TWO KINDS OF GRANT, and why the split matters.
 *
 *   ONE-TIME  applied once, the moment the improvement is completed, and recorded on its
 *             `applied` record so un-completing reverses exactly that. An edit to these after
 *             completion is NOT retroactive: the steading keeps what completion did.
 *   LIVE      the "Henceforth..." rules. Nothing is written on completion; every reader
 *             (the Seasons Change window, a move's roll, the holds tray) asks the improvement's
 *             grants each time, so an edit applies as soon as it is saved. `lapse` and
 *             `condition` are live too: their stat change is reconciled on the save.
 *
 * `completionNote` is neither: a reminder said once, when the improvement is completed.
 */
export const ONE_TIME_GRANT_KEYS = ["stats", "resources", "fortifications", "removeFortifications", "setSize", "setPopulation", "replaceAssets", "markImprovements"];
export const LIVE_GRANT_KEYS = ["seasonalYield", "harvestBonus", "winterConsumption", "winterPopulation", "surplusBonus", "upkeep", "rollAdvantage", "lapse", "condition"];

/**
 * Which kinds of grant differ between two grant sets: what an edit's notice has to say (one-time
 * edits are not retroactive; live ones apply at once).
 * @returns {{oneTime: boolean, live: boolean, note: boolean}}
 */
export function grantKindsChanged(before, after) {
	const differs = key => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null);
	return {
		oneTime: ONE_TIME_GRANT_KEYS.some(differs),
		live: LIVE_GRANT_KEYS.some(differs),
		note: differs("completionNote"),
	};
}

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

	const stats = statDeltas(raw.stats);
	if (stats) grants.stats = stats;

	for (const key of ["resources", "fortifications", "removeFortifications"]) {
		const list = toLines(raw[key]);
		if (list.length) grants[key] = list;
	}

	if (STEADING_SIZES.includes(raw.setSize)) grants.setSize = raw.setSize;
	const population = asInt(raw.setPopulation);
	if (population !== null) {
		grants.setPopulation = population;
		// "Set Population to N" and "Population +M" cannot both hold: the set reads the Population
		// it starts from before the delta lands, so "+1 and set to 2" from 2 used to end at 3, and
		// un-completing it restored a figure that was never there. The set is the stronger
		// statement of what the author wants Population to BE, so it wins and the delta goes.
		if (grants.stats) {
			delete grants.stats.population;
			if (!Object.keys(grants.stats).length) delete grants.stats;
		}
	}

	// Replace an Assets entry: `{match, name}`, the entry whose name CONTAINS `match` swapped for
	// a fresh row called `name`. A built-in's `beast` (the Herd of Horses' herd row) is not
	// carried: a custom swap writes a plain asset (see StonetopSteading#_collectGrantEffects).
	const swaps = assetSwaps(raw.replaceAssets);
	if (swaps.length) grants.replaceAssets = swaps;

	// Other improvements that completing this one also marks complete ("automatically mark the
	// Greater Harvest improvement"), by slug. An unknown slug is harmless: the engine skips it.
	const marks = [...new Set(toLines(raw.markImprovements).filter(s => /^[A-Za-z][\w-]*$/.test(s)))];
	if (marks.length) grants.markImprovements = marks;

	const note = plainLine(raw.completionNote);
	if (note) grants.completionNote = note;

	// ── The live ("Henceforth") kinds ──
	const yields = seasonalYieldOf(raw.seasonalYield);
	if (yields) grants.seasonalYield = yields;

	const harvest = harvestBonusOf(raw.harvestBonus);
	if (harvest !== null) grants.harvestBonus = harvest;

	for (const key of ["winterConsumption", "winterPopulation"]) {
		const n = asInt(raw[key]);
		if (n) grants[key] = n;
	}

	const bonus = asInt(raw.surplusBonus);
	if (bonus && bonus > 0) grants.surplusBonus = bonus;

	const upkeep = upkeepOf(raw.upkeep);
	if (upkeep) grants.upkeep = upkeep;

	const advantage = rollAdvantageOf(raw.rollAdvantage);
	if (advantage) grants.rollAdvantage = advantage;

	const lapse = statDeltas(raw.lapse?.stats);
	if (lapse) grants.lapse = { stats: lapse };

	const conditionText = plainLine(raw.condition?.text);
	const conditionStats = statDeltas(raw.condition?.stats);
	if (conditionText && conditionStats) grants.condition = { text: conditionText, stats: conditionStats };

	return Object.keys(grants).length ? grants : null;
}

/** Integer stat deltas keyed by GRANT_STAT_PATHS, zeroes and unknown keys dropped; null when none. */
function statDeltas(raw) {
	const stats = {};
	for (const [key, value] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
		if (!GRANT_STAT_PATHS[key]) continue;
		const delta = asInt(value);
		if (delta) stats[key] = delta;
	}
	return Object.keys(stats).length ? stats : null;
}

/** A trimmed single line of plain text (runs of whitespace, newlines included, become one space). */
function plainLine(value) {
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** A checkbox's answer, however a form or a payload spells it. */
function isOn(value) {
	return value === true || value === "true" || value === "on" || value === 1 || value === "1";
}

/** The named seasons, in the year's order, unknown names dropped. */
function seasonsOf(value) {
	const named = new Set((Array.isArray(value) ? value : [value]).map(s => String(s ?? "").trim().toLowerCase()));
	return SEASON_IDS.filter(s => named.has(s));
}

/**
 * `replaceAssets` as `[{match, name}]`, from the definition's own array or from the builder's
 * lines ("draft horses => A herd of horses"; `->` and `→` read the same).
 */
function assetSwaps(raw) {
	const list = Array.isArray(raw) ? raw : toLines(raw);
	const out = [];
	for (const entry of list) {
		let match = "";
		let name = "";
		if (entry && typeof entry === "object") {
			match = plainLine(entry.match);
			name = plainLine(entry.name);
		} else {
			const parts = String(entry ?? "").split(/\s*(?:=>|->|→)\s*/);
			if (parts.length !== 2) continue;
			match = plainLine(parts[0]);
			name = plainLine(parts[1]);
		}
		if (match && name) out.push({ match, name });
	}
	return out;
}

/**
 * `seasonalYield`: Surplus the improvement generates when the Seasons Change.
 *
 *   seasons         which seasons it pays out in
 *   surplus         how much (with `plusPopulation`, added to Population: Township's "Population+1")
 *   needsHit        only "when you roll a 7+ with Fortunes" (Raincatching, Harnessing the Stream)
 *   minPopulation   only while Population is at least this (the Market's "+1 or better")
 *   minSurplus      only when the steading already has this much ("and Stonetop has at least 1 Surplus")
 *   whileMet        only while its requirements are still met (the Market's "and the market is active")
 */
function seasonalYieldOf(raw) {
	if (!raw || typeof raw !== "object") return null;
	const seasons = seasonsOf(raw.seasons);
	const surplus = Math.max(0, asInt(raw.surplus) ?? 0);
	const plusPopulation = isOn(raw.plusPopulation);
	if (!seasons.length || (!surplus && !plusPopulation)) return null;
	const out = { seasons, surplus };
	if (plusPopulation) out.plusPopulation = true;
	if (isOn(raw.needsHit)) out.needsHit = true;
	const minPopulation = asInt(raw.minPopulation);
	if (minPopulation !== null) out.minPopulation = minPopulation;
	const minSurplus = asInt(raw.minSurplus);
	if (minSurplus && minSurplus > 0) out.minSurplus = minSurplus;
	if (isOn(raw.whileMet)) out.whileMet = true;
	return out;
}

/** `harvestBonus`: a flat Surplus (1, the Mill's) or dice ("1d4", Greater Harvest's). Null when neither. */
function harvestBonusOf(raw) {
	if (typeof raw === "number" || /^\s*[+-]?\d+\s*$/.test(String(raw ?? ""))) return asInt(raw) || null;
	const dice = /^\s*\+?\s*(\d*)\s*d\s*(\d+)\s*$/i.exec(String(raw ?? ""));
	if (!dice) return null;
	const count = Math.max(1, Math.trunc(Number(dice[1]) || 1));
	const faces = Math.trunc(Number(dice[2]) || 0);
	return faces > 1 ? `${count}d${faces}` : null;
}

/** `upkeep`: Surplus owed in the named seasons, or the improvement is lost (Book I p. 514). */
function upkeepOf(raw) {
	if (!raw || typeof raw !== "object") return null;
	const seasons = seasonsOf(raw.seasons);
	const surplus = asInt(raw.surplus);
	return seasons.length && surplus && surplus > 0 ? { seasons, surplus } : null;
}

/**
 * `rollAdvantage`: advantage on the named moves. With `ask`, only when the table says so: the
 * move's window asks it as an unticked box ("Taking advantage of the palisade").
 */
function rollAdvantageOf(raw) {
	if (!raw || typeof raw !== "object") return null;
	const named = new Set((Array.isArray(raw.moves) ? raw.moves : [raw.moves])
		.map(m => decodeEntities(String(m ?? "")).trim().toLowerCase()));
	const moves = ROLL_ADVANTAGE_MOVES.filter(m => named.has(m.toLowerCase()));
	if (!moves.length) return null;
	const ask = plainLine(raw.ask);
	return ask ? { moves, ask } : { moves };
}

/**
 * One stat line of a grant DEFINITION, signed: "Fortunes +1". Says what a grant would do before
 * anything is applied (the card's "On completion:" lines, a condition's "(Prosperity +1 while
 * ticked)"). A change that HAS a before and an after (a completion, a revert, a standing effect)
 * is said with statChangeLine instead. U+2212 is the minus, everywhere a stat is signed.
 */
export function statGrantLine(key, delta) {
	return `${GRANT_STAT_LABELS[key] ?? key} ${signed(delta)}`;
}

/** Every stat of a `{ key: delta }` map as statGrantLine says it, comma-joined. */
export function statGrantLines(stats = {}) {
	return Object.entries(stats).map(([k, d]) => statGrantLine(k, d)).join(", ");
}

/**
 * One stat as the transition a write makes, "Fortunes +1 → +2": the house form for a stat change
 * (a bare "Fortunes +1" after "Reverted" read as though Fortunes had just gone UP). The literal
 * arrow rather than `&rarr;`, because these lines reach both a notification (HTML) and a dialog
 * that escapes them, and an entity only survives the first.
 */
export function statChangeLine(key, from, to) {
	return `${GRANT_STAT_LABELS[key] ?? key} ${signed(Number(from) || 0)} → ${signed(Number(to) || 0)}`;
}

/** A Resources/Fortifications/Assets entry put on or taken off its list, said as a sentence. */
export function listChangeLine(name, listKey, added) {
	const list = { resources: "Resources", fortifications: "Fortifications", assets: "Assets" }[listKey] ?? listKey;
	return added ? `${name} added to ${list}` : `${name} removed from ${list}`;
}

/**
 * The ONE-TIME half of a grant set, as the "On completion:" lines: what completing it applies
 * (and un-completing takes back), plus the reminder it says when it is built.
 *
 * The twin of StonetopSteading's _summarizeGrantChanges, which reads the record of what an
 * improvement ACTUALLY applied to one steading (and so can say what each stat moved from and
 * to). This one reads the definition, before anything has been applied.
 * @param {object|null} grants
 * @param {{improvementLabel?: (slug: string) => string}} [opts]  names a `markImprovements` slug
 * @returns {string[]}
 */
export function summarizeImprovementGrants(grants, { improvementLabel = humanizeSlug } = {}) {
	if (!grants) return [];
	const lines = [];
	for (const [key, delta] of Object.entries(grants.stats ?? {})) {
		lines.push(statGrantLine(key, delta));
	}
	if (grants.resources?.length) lines.push(`Resources: ${grants.resources.join(", ")}`);
	if (grants.fortifications?.length) lines.push(`Fortifications: ${grants.fortifications.join(", ")}`);
	if (grants.removeFortifications?.length) lines.push(`Fortifications cleared: ${grants.removeFortifications.join(", ")}`);
	for (const { match, name } of grants.replaceAssets ?? []) lines.push(`Assets: "${match}" → ${String(name).split(" (")[0]}`);
	if (grants.setSize) lines.push(`Size becomes ${grants.setSize}`);
	if (Number.isFinite(grants.setPopulation)) lines.push(`Population becomes ${grants.setPopulation >= 0 ? "+" : ""}${grants.setPopulation}`);
	if (grants.markImprovements?.length) lines.push(`Also marks complete: ${grants.markImprovements.map(improvementLabel).join(", ")}`);
	if (grants.completionNote) lines.push(`Reminder: ${grants.completionNote}`);
	return lines;
}

/** "spring", "spring and summer", "spring, summer, and autumn". */
function seasonList(seasons = []) {
	if (seasons.length === 4) return "every season";
	if (seasons.length < 3) return seasons.join(" and ");
	return `${seasons.slice(0, -1).join(", ")}, and ${seasons[seasons.length - 1]}`;
}

/** A slug as a name, for when nothing better is to hand: "greaterHarvest" → "Greater Harvest". */
export function humanizeSlug(slug) {
	return String(slug ?? "")
		.replace(/^custom-/, "")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/-/g, " ")
		.replace(/\b\w/g, c => c.toUpperCase());
}

/** A yield's amount in words: "1 Surplus", "Surplus equal to Population+1". */
export function yieldAmountText(y) {
	if (!y) return "";
	if (y.plusPopulation) return y.surplus ? `Surplus equal to Population+${y.surplus}` : "Surplus equal to Population";
	return `${y.surplus} Surplus`;
}

/**
 * A yield as one line, conditions and all: "Spring, summer, and autumn: generates 1 Surplus (while
 * Population is +1 or better, while its requirements are met)". The Seasons Change window shows
 * it under the yield's row, and the card's "Henceforth:" line is the same words.
 */
export function yieldRuleLine(y) {
	if (!y) return "";
	const when = [
		y.needsHit ? "on a 7+ with Fortunes" : "",
		Number.isFinite(y.minPopulation) ? `while Population is ${signed(y.minPopulation)} or better` : "",
		y.minSurplus ? `if the steading has at least ${y.minSurplus} Surplus` : "",
		y.whileMet ? "while its requirements are met" : "",
	].filter(Boolean);
	const season = seasonList(y.seasons ?? []);
	return `${season.charAt(0).toUpperCase()}${season.slice(1)}: generates ${yieldAmountText(y)}${when.length ? ` (${when.join(", ")})` : ""}`;
}

/**
 * The LIVE half of a grant set, as the "Henceforth:" lines: the rules every reader asks the grants
 * for each time (season window, move rolls, holds tray), so an edit to them applies at once.
 * @param {object|null} grants
 * @returns {string[]}
 */
export function summarizeImprovementRules(grants) {
	if (!grants) return [];
	const lines = [];
	if (grants.seasonalYield) lines.push(yieldRuleLine(grants.seasonalYield));
	if (grants.harvestBonus) {
		const bonus = typeof grants.harvestBonus === "number" ? signed(grants.harvestBonus) : `+${grants.harvestBonus}`;
		lines.push(`Autumn harvest: ${bonus} Surplus`);
	}
	if (grants.winterConsumption) {
		const n = Math.abs(grants.winterConsumption);
		lines.push(`Winter: consumes ${n} ${grants.winterConsumption < 0 ? "less" : "more"} Surplus`);
	}
	if (grants.winterPopulation) {
		const n = Math.abs(grants.winterPopulation);
		lines.push(`Winter: Population counts ${n} ${grants.winterPopulation < 0 ? "lower" : "higher"} when consuming Surplus`);
	}
	if (grants.surplusBonus) lines.push(`+${grants.surplusBonus} Surplus whenever the steading generates Surplus`);
	if (grants.upkeep) {
		const when = grants.upkeep.seasons.length === 4 ? "at the start of each season" : `each ${seasonList(grants.upkeep.seasons)}`;
		lines.push(`Upkeep: ${grants.upkeep.surplus} Surplus ${when}, or it is lost`);
	}
	if (grants.rollAdvantage) {
		const moves = grants.rollAdvantage.moves;
		const named = moves.length < 3 ? moves.join(" or ") : `${moves.slice(0, -1).join(", ")}, or ${moves[moves.length - 1]}`;
		lines.push(`Advantage to ${named}${grants.rollAdvantage.ask ? ` (when: ${grants.rollAdvantage.ask})` : ""}`);
	}
	if (grants.lapse?.stats) {
		lines.push(`${statGrantLines(grants.lapse.stats)} while its requirements are not met`);
	}
	if (grants.condition) {
		lines.push(`${statGrantLines(grants.condition.stats)} as long as: ${grants.condition.text}`);
	}
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

/** The inline markup a stored heading, requirement or effect may carry, attribute-free. */
const SAFE_IMPROVEMENT_TAG = /<(\/?)(em|strong|i|b|br)\s*\/?>/gi;

/** Text between safe tags: `<` and `>` escaped, a bare `&` escaped, an entity left alone. */
function escapeImprovementText(text) {
	return text
		.replace(/&(?!(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);)/gi, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * A stored heading, requirement or effect made safe to paint with a triple stash.
 *
 * Every reader paints those three unescaped (they are HTML in the book's own definitions), and
 * the builder escapes what it writes (formatImprovementText), but a journal card dropped onto a
 * sheet arrives as whatever its page carried: a card edited by hand, or one from another world,
 * could put a `<script>` or an `onerror=` into the steading. So the steading's two writers run
 * the text through this, and the snapshot runs a custom definition through it again on the way
 * out for one stored before this existed.
 *
 * An allowlist, not a cleaner: the five inline tags the playbook's improvements actually use, with
 * no attributes, survive; everything else is escaped to text. Idempotent, and an entity already
 * escaped (`&lt;`, `&mdash;`) is left as it is, so the builder's own output passes through
 * unchanged.
 * @param {string} html
 * @returns {string}
 */
export function sanitizeImprovementHtml(html) {
	const source = String(html ?? "");
	let out = "";
	let last = 0;
	for (const match of source.matchAll(SAFE_IMPROVEMENT_TAG)) {
		out += escapeImprovementText(source.slice(last, match.index));
		out += `<${match[1]}${match[2].toLowerCase()}>`;
		last = match.index + match[0].length;
	}
	return out + escapeImprovementText(source.slice(last));
}

/** A definition's three HTML fields sanitized (see sanitizeImprovementHtml); the rest untouched. */
export function sanitizeImprovementDef(def) {
	if (!def) return def;
	return {
		...def,
		effect: sanitizeImprovementHtml(def.effect),
		sections: (def.sections ?? []).map(section => ({
			...section,
			heading: sanitizeImprovementHtml(section?.heading),
			items: (section?.items ?? []).map(sanitizeImprovementHtml),
		})),
	};
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

/**
 * A row's repeat as a usable count: at least one box, never more than the ceiling. Shared
 * with the builder, which shows the same number back in its count field; a second copy of
 * the clamp there could disagree with the boxes this one actually expands into.
 * @param {number|string|null|undefined} value
 * @returns {number}
 */
export function clampRepeat(value) {
	return Math.min(Math.max(asInt(value) ?? 1, 1), MAX_REQUIREMENT_REPEAT);
}

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
		const repeat = clampRepeat(row?.repeat);
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
 * targets and the steading's own tracking expect. `category` is only trimmed here: the
 * two consumers validate it through improvementCategoryKey (data/improvement-categories.js).
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
	return flatRequirementItems(def).length;
}

/**
 * The fewest extra ticks that meet an improvement's requirements: what "earn it now" writes when
 * the table force-completes an improvement it has not finished.
 *
 * NOT every box. Ticking them all ticked both sides of every either/or, and some boxes are
 * CHOICES with consequences of their own: Additional Housing's "Building on parts of the fields"
 * docks every autumn's harvest, every militia tactic past the second is +1 Defenses the table
 * never drilled for (Cavalry without a herd to ride), and Weapons of War recorded both ways of
 * arming the militia. So:
 *
 *   - every box already ticked stays ticked;
 *   - a section is topped up to its required count (sectionRequiredCount) and no further, first
 *     unticked box first;
 *   - of sections sharing a `group` (alternatives), only ONE is satisfied: the one already
 *     closest to met (fewest boxes short; then the one with more already done; then the first),
 *     and a group already met by any of its sections is left alone.
 *
 * @param {{sections?: Array}} def
 * @param {boolean[]} [r]  the stored ticks
 * @returns {boolean[]} the ticks to write, one per box
 */
export function forceCompleteTicks(def, r = []) {
	const out = Array.from({ length: improvementRequirementCount(def) }, (_, i) => r?.[i] === true);
	for (const members of requirementGroups(def, out)) {
		if (members.some(m => m.short === 0)) continue;
		const pick = closestAlternative(members, m => m.done);
		let need = pick.short;
		for (let k = 0; k < pick.count && need > 0; k++) {
			if (out[pick.offset + k]) continue;
			out[pick.offset + k] = true;
			need--;
		}
	}
	return out;
}

/**
 * How far along an improvement's requirements are, counted the way they are MET: "2 of 3".
 * Each requirement (an ungrouped section, or a set of either/or sections sharing a group) counts
 * its required boxes (sectionRequiredCount) and no more; of alternatives, the one closest to met
 * is counted, by forceCompleteTicks' own rule (fewest boxes short, then more done, then first), so
 * a card offering two ways to meet one requirement doesn't count both ways' boxes as owed. A tick
 * beyond a section's minimum (a third militia tactic) isn't progress toward building it.
 * @param {{sections?: Array}} def
 * @param {boolean[]} [r]  the stored ticks
 * @returns {{ticked: number, needed: number}}
 */
export function improvementRequirementProgress(def, r = []) {
	let ticked = 0;
	let needed = 0;
	// A tick past a section's minimum is not progress, so it doesn't break a tie either.
	const counted = m => Math.min(m.done, m.need);
	for (const members of requirementGroups(def, r)) {
		const pick = closestAlternative(members, counted);
		ticked += counted(pick);
		needed += pick.need;
	}
	return { ticked, needed };
}

/**
 * An improvement's requirements: one list per requirement (an ungrouped section, or the either/or
 * sections sharing a group), each section as `{ offset, count, done, need, short }`, its flat
 * offset into the ticks, its boxes, how many are ticked, its required count, and how far short.
 */
function requirementGroups(def, ticks) {
	const groups = new Map();
	let offset = 0;
	(def?.sections ?? []).forEach((section, i) => {
		const count = section?.items?.length ?? 0;
		let done = 0;
		for (let k = 0; k < count; k++) if (ticks?.[offset + k]) done++;
		const need = sectionRequiredCount(section);
		const key = section?.group ?? `__${i}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push({ offset, count, done, need, short: Math.max(0, need - done) });
		offset += count;
	});
	return groups.values();
}

/** Of alternatives, the one closest to met: fewest boxes short; on a tie, more done (`doneOf`); then the first. */
function closestAlternative(members, doneOf) {
	return members.reduce((best, m) =>
		(m.short < best.short || (m.short === best.short && doneOf(m) > doneOf(best)) ? m : best));
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

/**
 * An improvement's requirement sections as HTML: the "or" divider above a continued
 * either/or, the written-for-you heading, and one list per section.
 *
 * The ONE emitter of that markup, because two readers draw it - the journal's draggable
 * card and the builder's preview - and the preview's whole promise is that it looks like
 * the card. Two copies looked identical and nothing enforced it. Only the box differs, so
 * the caller passes `itemHtml`: the card renders a `check-bullet`, the preview a disabled
 * checkbox. Items are already HTML on a definition (see buildImprovementDef) and are
 * emitted unescaped by both, which is why this takes them as-is.
 *
 * @param {Array<{heading?: string, items?: string[]}>} sections
 * @param {(item: string) => string} itemHtml  the <li> for one requirement box
 * @returns {string}
 */
export function requirementSectionsHtml(sections = [], itemHtml) {
	const list = sections ?? [];
	const alternatives = alternativeSectionFlags(list);
	const out = [];
	list.forEach((section, i) => {
		if (alternatives[i]) out.push(`<p class="steading-req-or">or</p>`);
		if (section?.heading) out.push(`<p class="steading-req-heading">${section.heading}</p>`);
		const items = section?.items ?? [];
		if (items.length) out.push(`<ul class="steading-req-list">${items.map(item => itemHtml(item)).join("")}</ul>`);
	});
	return out.join("");
}
