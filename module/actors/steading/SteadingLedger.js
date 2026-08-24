import {
	LEDGER_SCOPE, isLedgerPath, normalizeFlagPath, getActorProperty,
	appendLedgerEntries, deleteLedgerEntries, getLedgerEntries,
	isBlank, valuesEqual, actionForField, coalesceEntries, prettifySlug,
	truncateValue, scalarEntry,
} from "../../utils/ledger-core.js";
import { IMPROVEMENT_DEFINITIONS } from "./StonetopSteading.js";
import { stripHtmlToText as stripHtml } from "../../utils/strings.js";
import { isSteadingActor } from "../../utils/world.js";

const IMPROVEMENTS_PATH = `flags.${LEDGER_SCOPE}.steading.improvements`;
const CUSTOM_IMPROVEMENTS_PATH = `flags.${LEDGER_SCOPE}.steading.customImprovements`;

const SYSTEM_PATH_LABELS = {
	"system.stats.fortunes.value":   "Fortunes",
	"system.stats.defenses.value":   "Defenses",
	"system.attributes.population.value": "Population",
	"system.attributes.prosperity.value": "Prosperity",
	"system.attributes.surplus.value":    "Surplus",
	"system.attributes.debilities.options.diminished.value":  "Diminished debility",
	"system.attributes.debilities.options.lacking.value":     "Lacking debility",
	"system.attributes.debilities.options.malcontent.value":  "Malcontent debility",
};

/**
 * Key a table by steading flag path, given the paths WITHOUT the `flags.<scope>.steading.` head.
 *
 * Every path this ledger cares about shares that head, so it is stated once here rather than on
 * all twenty-three rows. Built from LEDGER_SCOPE for the same reason `NOTES_PATH` below always
 * was: these tables are matched against paths `normalizeFlagPath` has already rewritten into that
 * scope, so a row in a stale scope matches nothing and drops its change silently.
 */
const bySteadingPath = (rows) => Object.fromEntries(
	Object.entries(rows).map(([suffix, value]) => [`flags.${LEDGER_SCOPE}.steading.${suffix}`, value]),
);

const FLAG_PATH_LABELS = bySteadingPath({
	"size": "Size",
});

// The Notes tab is a rich-text field. Running it through the generic scalar formatter pasted the
// entire HTML document — headings, tables, newlines and all — into one action string, which was
// by far the longest entry any ledger produced. Record that it changed, with a short preview.
const NOTES_PATH = `flags.${LEDGER_SCOPE}.steading.notes`;

function notesEntry(oldValue, newValue) {
	const before = stripHtml(oldValue);
	const after  = stripHtml(newValue);
	if (before === after) return [];
	if (!after) return [{ category: "notes", action: "Notes cleared" }];
	return [{ category: "notes", action: `Notes ${before ? "edited" : "written"}: “${truncateValue(after)}”` }];
}

// Steading counters (Population, Surplus, Fortunes…) get nudged one click at a time; collapse a
// run of those into a single "Surplus changed from 1 to 4" rather than three consecutive lines.
const FLAG_NAMESPACE_LABELS = bySteadingPath({
	"resources":      "Resources",
	"fortifications": "Fortifications",
	"assets":         "Assets",
	"neighbors":      "Neighbors",
	"players":        "Players",
	"improvements":   "Improvements",
	"places":         "Places of interest",
});

const SORTED_NAMESPACE_PREFIXES = Object.keys(FLAG_NAMESPACE_LABELS).sort((a, b) => b.length - a.length);

function labelForPath(path) {
	if (SYSTEM_PATH_LABELS[path]) return SYSTEM_PATH_LABELS[path];
	if (FLAG_PATH_LABELS[path]) return FLAG_PATH_LABELS[path];
	const namespace = SORTED_NAMESPACE_PREFIXES.find(p => path === p || path.startsWith(`${p}.`));
	if (namespace) return FLAG_NAMESPACE_LABELS[namespace];
	return null;
}

function itemName(item) {
	return String(item?.name ?? "").trim();
}

function neighborLabel(item) {
	const name = itemName(item);
	const home = String(item?.home ?? "").trim();
	return home ? `${name} (from ${home})` : name;
}

function listEntries(label, oldValue, newValue) {
	if (!Array.isArray(oldValue) || !Array.isArray(newValue)) return null;
	const entries = [];
	const max = Math.max(oldValue.length, newValue.length);

	for (let i = 0; i < max; i++) {
		const oldItem = oldValue[i] ?? {};
		const newItem = newValue[i] ?? {};
		const oldName = itemName(oldItem);
		const newName = itemName(newItem);

		if (oldName !== newName) {
			if (!oldName && newName) entries.push({ action: `${label} added: ${newName}` });
			else if (oldName && !newName) entries.push({ action: `${label} removed: ${oldName}` });
			else entries.push({ action: `${label} renamed from ${oldName} to ${newName}` });
		}

		if (oldName || newName) {
			const toggle = checkedToggleEntry(newName || oldName, oldItem, newItem);
			if (toggle) entries.push(toggle);
		}
	}

	return entries;
}

function placeEntries(oldValue, newValue) {
	if (!Array.isArray(oldValue) || !Array.isArray(newValue)) return null;
	const entries = [];
	const max = Math.max(oldValue.length, newValue.length);

	for (let i = 0; i < max; i++) {
		const oldPlace = oldValue[i] ?? {};
		const newPlace = newValue[i] ?? {};
		const letter = newPlace.letter ?? oldPlace.letter ?? "?";
		const oldName = itemName(oldPlace);
		const newName = itemName(newPlace);
		if (oldName === newName) continue;
		if (!oldName && newName) entries.push({ action: `Place ${letter} set to ${newName}` });
		else if (oldName && !newName) entries.push({ action: `Place ${letter} cleared (${oldName})` });
		else entries.push({ action: `Place ${letter} changed from ${oldName} to ${newName}` });
	}

	return entries;
}

// The shared "this row's checkbox flipped" ledger line, used by every {name, checked} people
// list so the selected/deselected wording lives in one place.
function checkedToggleEntry(name, oldItem, newItem) {
	const oldChecked = !!oldItem.checked;
	const newChecked = !!newItem.checked;
	if (oldChecked === newChecked) return null;
	return { action: `${name} ${newChecked ? "selected" : "deselected"}` };
}

function neighborEntries(oldValue, newValue) {
	if (!Array.isArray(oldValue) || !Array.isArray(newValue)) return null;
	const entries = [];
	const max = Math.max(oldValue.length, newValue.length);

	for (let i = 0; i < max; i++) {
		const oldItem = oldValue[i] ?? {};
		const newItem = newValue[i] ?? {};
		const oldName = itemName(oldItem);
		const newName = itemName(newItem);

		if (oldName !== newName) {
			if (!oldName && newName) entries.push({ action: `Neighbor added: ${neighborLabel(newItem)}` });
			else if (oldName && !newName) entries.push({ action: `Neighbor removed: ${neighborLabel(oldItem)}` });
			else entries.push({ action: `Neighbor renamed from ${oldName} to ${newName}` });
		}

		if (oldName || newName) {
			// Every field of one neighbour reports under that neighbour's name, so an edit to
			// Tierney files under "Tierney" rather than splitting across a "Neighbor" subject for
			// the home and a "Tierney trait" subject for the traits. Naming the field also fixes
			// the old home-change wording, which rendered as the useless
			// "Neighbor changed from Tierney (from Marshedge) to Tierney".
			const name = newName || oldName;
			// On an add or a remove the "Neighbor added/removed: Tovia (from Lygos)" line already
			// names them and their home, so neither is restated as its own entry. It carries
			// nothing else though — a neighbour entered complete with a trait would otherwise
			// lose it entirely — so an add still reports the traits. A remove reports neither:
			// the removal line is the whole story, and "Tovia traits cleared" after it would
			// read as an edit to somebody still on the list.
			const fields = oldName && newName ? ["home", "traits"]
				: newName ? ["traits"]
				: [];
			for (const field of fields) {
				const before = String(oldItem?.[field] ?? "").trim();
				const after  = String(newItem?.[field] ?? "").trim();
				if (before === after) continue;
				if (!before) entries.push({ action: `${name} ${field} set to ${after}` });
				else if (!after) entries.push({ action: `${name} ${field} cleared (was ${before})` });
				else entries.push({ action: `${name} ${field} changed from ${before} to ${after}` });
			}

			const toggle = checkedToggleEntry(name, oldItem, newItem);
			if (toggle) entries.push(toggle);
		}
	}

	return entries;
}

/**
 * Build a `slug → { label, steps }` lookup spanning the book improvements and any
 * journal-sourced custom ones tracked on this actor, so ledger entries can name an
 * improvement (and its requirement steps) instead of its raw slug. `steps` is the
 * requirement labels flattened across sections, matching the running index used by
 * the tracking array `r` (see StonetopSteading.buildSnapshot).
 */
function improvementDefs(actor) {
	const defs = new Map();
	const add = def => {
		if (!def?.slug) return;
		defs.set(def.slug, {
			label: def.label || prettifySlug(def.slug),
			steps: (def.sections ?? []).flatMap(s => s.items ?? []).map(stripHtml),
		});
	};
	IMPROVEMENT_DEFINITIONS.forEach(add);
	const custom = getActorProperty(actor, CUSTOM_IMPROVEMENTS_PATH);
	if (Array.isArray(custom)) custom.forEach(add);
	return defs;
}

/**
 * Reconstruct the post-update improvements map from the flattened changes. The
 * store is an object keyed by slug, so a single toggle arrives as leaf sub-paths
 * (`…improvements.<slug>.completed` / `.r`) rather than one whole-object key.
 */
function readChangedImprovements(flat) {
	const result = {};
	for (const [rawPath, value] of Object.entries(flat)) {
		const path = normalizeFlagPath(rawPath);
		if (path === IMPROVEMENTS_PATH) return value && typeof value === "object" ? value : {};
		if (!path.startsWith(`${IMPROVEMENTS_PATH}.`)) continue;
		const [slug, field] = path.slice(IMPROVEMENTS_PATH.length + 1).split(".");
		(result[slug] ??= {})[field] = value;
	}
	return result;
}

function improvementEntries(actor, oldImps, newImps) {
	const defs = improvementDefs(actor);
	const entries = [];
	for (const slug of new Set([...Object.keys(oldImps ?? {}), ...Object.keys(newImps ?? {})])) {
		const def = defs.get(slug);
		const label = def?.label ?? prettifySlug(slug);
		const before = oldImps?.[slug] ?? {};
		const after = newImps?.[slug] ?? {};

		const wasComplete = !!before.completed;
		const isComplete = !!after.completed;
		if (wasComplete !== isComplete) {
			entries.push({ action: isComplete ? `Improvement completed: ${label}` : `Improvement marked incomplete: ${label}` });
		}

		const beforeR = Array.isArray(before.r) ? before.r : [];
		const afterR = Array.isArray(after.r) ? after.r : [];
		const max = Math.max(beforeR.length, afterR.length);
		for (let i = 0; i < max; i++) {
			if (!!beforeR[i] === !!afterR[i]) continue;
			const step = def?.steps?.[i] || `requirement ${i + 1}`;
			// Improvement then step, separated by the same middle dot the sheets use to join two
			// fields on one line. A comma would read as one list ("Mill, A full-time miller") and
			// the line already spends its colon on "marked:".
			entries.push({ action: `Improvement step ${afterR[i] ? "marked" : "unmarked"}: ${label} · ${step}` });
		}
	}
	return entries;
}

const _currencyEntry = (label, o, n) =>
	valuesEqual(o, n) ? [] : [{ action: actionForField(label, o, n) }];

// Herd tiers write the whole {grown,yearlings,foals} object, so seeding a herd (or the
// first write to a defaulted legacy herd) diffs each tier from blank → its number. Treat
// a blank → 0 transition as no change so seeding only logs the tiers that are non-zero.
const _herdTierEntry = (label, o, n) =>
	(valuesEqual(o, n) || (isBlank(o) && Number(n) === 0)) ? [] : [{ action: actionForField(label, o, n) }];

const PATH_HANDLERS = bySteadingPath({
	"resources":       (o, n) => listEntries("Resource",      o, n),
	"fortifications":  (o, n) => listEntries("Fortification", o, n),
	"assets":          (o, n) => listEntries("Asset",         o, n),
	"neighbors":       neighborEntries,
	"players":         (o, n) => listEntries("Player",        o, n),
	"places":          placeEntries,
	"silver.purses":   (o, n) => _currencyEntry("Silver purses",    o, n),
	"silver.handfuls": (o, n) => _currencyEntry("Silver handfuls",  o, n),
	"silver.coins":    (o, n) => _currencyEntry("Silver coins",     o, n),
	"gold.purses":     (o, n) => _currencyEntry("Gold purses",      o, n),
	"gold.handfuls":   (o, n) => _currencyEntry("Gold handfuls",    o, n),
	"gold.coins":      (o, n) => _currencyEntry("Gold coins",       o, n),
	"herd.grown":      (o, n) => _herdTierEntry("Herd: grown horses", o, n),
	"herd.yearlings":  (o, n) => _herdTierEntry("Herd: yearlings",     o, n),
	"herd.foals":      (o, n) => _herdTierEntry("Herd: foals",         o, n),
});

function actorUpdateEntries(actor, changed) {
	const flat = foundry.utils.flattenObject(changed);
	const entries = [];
	let improvementsHandled = false;
	for (const [path, newValue] of Object.entries(flat)) {
		const normalizedPath = normalizeFlagPath(path);
		if (!normalizedPath || isLedgerPath(normalizedPath)) continue;

		// Improvements are an object keyed by slug, so a toggle arrives as leaf
		// sub-paths; diff the whole map once rather than per sub-path.
		if (normalizedPath === IMPROVEMENTS_PATH || normalizedPath.startsWith(`${IMPROVEMENTS_PATH}.`)) {
			if (!improvementsHandled) {
				improvementsHandled = true;
				const oldImps = getActorProperty(actor, IMPROVEMENTS_PATH) ?? {};
				entries.push(...improvementEntries(actor, oldImps, readChangedImprovements(flat)));
			}
			continue;
		}

		if (normalizedPath === NOTES_PATH) {
			entries.push(...notesEntry(getActorProperty(actor, NOTES_PATH), newValue));
			continue;
		}

		const handler = PATH_HANDLERS[normalizedPath];
		if (handler) {
			const oldValue = getActorProperty(actor, normalizedPath);
			entries.push(...(handler(oldValue, newValue) ?? []));
			continue;
		}

		// Skip sub-paths of namespace prefixes — handlers above cover the
		// top-level path; sub-paths (e.g. resources.0.name) would produce noise.
		const isSubPath = SORTED_NAMESPACE_PREFIXES.some(p => normalizedPath !== p && normalizedPath.startsWith(`${p}.`));
		if (isSubPath) continue;

		const oldValue = getActorProperty(actor, normalizedPath);
		if (valuesEqual(oldValue, newValue)) continue;
		const label = labelForPath(normalizedPath);
		if (!label) continue;
		// The counters gain a run descriptor; the debilities, being booleans, do not — which
		// scalarEntry works out from the value rather than from a hand-kept path list.
		entries.push(scalarEntry(label, oldValue, newValue, normalizedPath));
	}
	return coalesceEntries(entries);
}

export class SteadingLedger {
	static getEntries(actor) {
		return getLedgerEntries(actor);
	}

	static async append(actor, entries, options = {}) {
		if (!isSteadingActor(actor)) return;
		// Every steading change files under one category; the dropdown groups by subject
		// within it (Neighbor, Surplus, Improvement, …).
		await appendLedgerEntries(actor, entries, { defaultCategory: "steading", ...options });
	}

	static async deleteEntries(actor, ids) {
		if (!isSteadingActor(actor)) return;
		await deleteLedgerEntries(actor, ids);
	}

	static entriesForActorUpdate(actor, changed) {
		return actorUpdateEntries(actor, changed);
	}
}
