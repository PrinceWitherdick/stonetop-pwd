import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { applyGuideRail, guideRailStep } from "../utils/guide-rail.js";
import { IMPROVEMENT_CATEGORIES, IMPROVEMENT_DEFINITIONS, IMPROVEMENT_GRANTS } from "../actors/steading/StonetopSteading.js";
import { createImprovementCard, readImprovementCard } from "../journal/steading-improvement-cards.js";
import { improvementCategoryKey } from "../data/improvement-categories.js";
import {
	MAX_REQUIREMENT_REPEAT,
	ROLL_ADVANTAGE_MOVES,
	SEASON_IDS,
	STEADING_SIZES,
	buildImprovementDef,
	clampRepeat,
	defaultSectionHeading,
	groupsFromSections,
	itemsFromRows,
	normalizeImprovementGrants,
	normalizeImprovementSections,
	sectionsFromGroups,
	unformatImprovementText,
} from "../utils/improvement-def.js";
import { improvementPreviewHtml, improvementPreviewNotes } from "../utils/improvement-preview.js";
import { confirmOutcome } from "../utils/ask-with-buttons.js";
import { hasUnsavedWork, notePristineWork } from "../utils/close-guard.js";
import { escHtml } from "../utils/strings.js";
import { persistOpenWindowsSoon } from "../utils/window-restore.js";
import { IMPROVEMENT_BUILDER_RESTORE_KIND, authoringRestoreKey } from "./authoring-restore.js";

/**
 * The authoring sheet for a steading improvement, in the shape the book's own
 * improvements have: a name and flavor, any number of requirement GROUPS (each with its
 * own heading, its own "all of these" or "N of these" rule, and the option to be an
 * ALTERNATIVE to the group above it), the effect prose, and the mechanical effects that
 * are applied automatically on completion.
 *
 * It replaces the two hand-rolled forms that came before, which between them could
 * author one flat all-of-these requirement list and no automatic effects at all: not
 * enough to reproduce Weapons of War (either/or), Aurochs Hunting (2 of 3), or any
 * improvement whose completion is supposed to move a stat. Both entry points now open
 * THIS window and differ only in where the finished definition is written:
 *
 *   improvementCardSaver()          a reusable, draggable card in the homebrew journal
 *                                   (sidebar "Create Stonetop Content" flow);
 *   steadingImprovementSaver(...)   straight onto the open steading's Improvements tab.
 *
 * Four things make it possible to actually reproduce one of the book's improvements
 * rather than merely to store the same fields:
 *
 *   - a requirement is a ROW, not a line of a textarea, so it can be moved, dropped, and
 *     repeated: "Pull Together" times five becomes five boxes numbered (1st) to (5th),
 *     which is how Additional Housing, Raincatching, Stone Wall and Township are built;
 *   - *asterisks* mark the italics the playbook puts on every move name;
 *   - "Start from" fills the whole form from an improvement that already exists, either
 *     one of the seventeen built-ins or one already added to this steading; and
 *   - a Preview panel draws the card the Improvements tab will draw.
 *
 * Laid out as a left-rail stepped sheet, the same shared .stonetop-guide-* chrome as the
 * custom-move dialog and Make a Monster.
 */

// The rail's panels, in authoring order. `key` matches a `<section data-tab>` in the
// template and its rail button. `hint` is the banner's subtitle while that panel shows; the
// first panel's is the saver's own (what this window writes, and where), which is the thing
// to know before starting and is noise on every panel after it.
export const SECTIONS = [
	{ key: "improvement",  title: "The improvement", icon: "fa-screwdriver-wrench", hint: null },
	{ key: "requirements", title: "Requirements",    icon: "fa-list-check",
		hint: "What has to be done before it can be ticked complete." },
	{ key: "effect",       title: "Effect",          icon: "fa-wand-sparkles",
		hint: "What completing it does, and which part of that the sheet applies by itself." },
	{ key: "preview",      title: "Preview",         icon: "fa-eye",
		hint: "Check that it reads the way you meant, then save it." },
];

/** The auto-applied stat deltas the Effect panel offers, in sheet order. */
const GRANT_STAT_FIELDS = [
	{ key: "fortunes",   label: "Fortunes" },
	{ key: "defenses",   label: "Defenses" },
	{ key: "prosperity", label: "Prosperity" },
	{ key: "population", label: "Population" },
];

/**
 * Every Effect-panel field, by form name, and what kind of control it is: `value` (a text, number,
 * select or textarea), `check` (one checkbox), `checks` (a group of checkboxes sharing the name,
 * read as the list of values ticked). The DOM half of the round trip reads and writes through this,
 * and the definition half is grantFormValues / grantsFromFormValues below.
 */
const stat = prefix => GRANT_STAT_FIELDS.map(f => [`${prefix}-${f.key}`, "value"]);
export const GRANT_FORM_FIELDS = Object.freeze(Object.fromEntries([
	...stat("grant"),
	["grant-resources", "value"], ["grant-fortifications", "value"], ["grant-remove-fortifications", "value"],
	["grant-size", "value"], ["grant-set-population", "value"],
	["grant-replace-assets", "value"], ["grant-mark", "value"], ["grant-completion-note", "value"],
	["grant-yield-seasons", "checks"], ["grant-yield-surplus", "value"], ["grant-yield-population", "check"],
	["grant-yield-hit", "check"], ["grant-yield-while-met", "check"],
	["grant-yield-min-population", "value"], ["grant-yield-min-surplus", "value"],
	["grant-harvest", "value"], ["grant-surplus-bonus", "value"], ["grant-winter", "value"], ["grant-winter-population", "value"],
	["grant-upkeep-seasons", "checks"], ["grant-upkeep-surplus", "value"],
	["grant-adv-moves", "checks"], ["grant-adv-ask", "value"],
	...stat("grant-lapse"),
	["grant-condition-text", "value"], ...stat("grant-condition"),
]));

/** A number as the form shows it: blank for none. */
const numText = v => (Number.isFinite(v) ? String(v) : "");

/**
 * A definition's grants as the Effect panel's field values, by form name (GRANT_FORM_FIELDS).
 *
 * ONE PAIR, this and grantsFromFormValues, read by `_fillFrom` and `_readGrants`. Enumerated
 * separately, the two directions drift — and the direction that silently loses is the fill: an
 * author who opens a finished improvement to fix a typo in its flavour text, and saves, writes back
 * a definition missing whatever grant the fill forgot, with nothing said about it. The homebrew-copy
 * test runs every built-in through exactly this pair.
 *
 * @param {object|null} grants
 * @param {{improvementLabel?: (slug: string) => string}} [opts]  names a `markImprovements` slug
 * @returns {{[field: string]: string|boolean|string[]}}
 */
export function grantFormValues(grants, { improvementLabel = slug => slug } = {}) {
	const g = grants ?? {};
	const y = g.seasonalYield ?? {};
	const values = {};
	for (const f of GRANT_STAT_FIELDS) {
		values[`grant-${f.key}`] = numText(g.stats?.[f.key]);
		values[`grant-lapse-${f.key}`] = numText(g.lapse?.stats?.[f.key]);
		values[`grant-condition-${f.key}`] = numText(g.condition?.stats?.[f.key]);
	}
	Object.assign(values, {
		"grant-resources": (g.resources ?? []).join("\n"),
		"grant-fortifications": (g.fortifications ?? []).join("\n"),
		"grant-remove-fortifications": (g.removeFortifications ?? []).join("\n"),
		"grant-size": g.setSize ?? "",
		"grant-set-population": numText(g.setPopulation),
		"grant-replace-assets": (g.replaceAssets ?? []).map(a => `${a.match} => ${a.name}`).join("\n"),
		"grant-mark": (g.markImprovements ?? []).map(improvementLabel).join("\n"),
		"grant-completion-note": g.completionNote ?? "",
		"grant-yield-seasons": [...(y.seasons ?? [])],
		"grant-yield-surplus": g.seasonalYield ? String(y.surplus ?? 0) : "",
		"grant-yield-population": !!y.plusPopulation,
		"grant-yield-hit": !!y.needsHit,
		"grant-yield-while-met": !!y.whileMet,
		"grant-yield-min-population": numText(y.minPopulation),
		"grant-yield-min-surplus": numText(y.minSurplus),
		"grant-harvest": g.harvestBonus === undefined || g.harvestBonus === null ? "" : String(g.harvestBonus),
		"grant-surplus-bonus": numText(g.surplusBonus),
		"grant-winter": numText(g.winterConsumption),
		"grant-winter-population": numText(g.winterPopulation),
		"grant-upkeep-seasons": [...(g.upkeep?.seasons ?? [])],
		"grant-upkeep-surplus": numText(g.upkeep?.surplus),
		"grant-adv-moves": [...(g.rollAdvantage?.moves ?? [])],
		"grant-adv-ask": g.rollAdvantage?.ask ?? "",
		"grant-condition-text": g.condition?.text ?? "",
	});
	return values;
}

/**
 * The Effect panel's field values back as RAW grants, for normalizeImprovementGrants (which drops
 * whatever is blank or incomplete).
 * @param {{[field: string]: string|boolean|string[]}} values
 * @param {{improvementSlug?: (name: string) => string}} [opts]  resolves an "Also marks complete" name
 */
export function grantsFromFormValues(values, { improvementSlug = name => name } = {}) {
	const v = key => values?.[key];
	const lines = key => String(v(key) ?? "").split("\n").map(s => s.trim()).filter(Boolean);
	const stats = prefix => Object.fromEntries(GRANT_STAT_FIELDS.map(f => [f.key, v(`${prefix}-${f.key}`)]));
	return {
		stats: stats("grant"),
		resources: v("grant-resources"),
		fortifications: v("grant-fortifications"),
		removeFortifications: v("grant-remove-fortifications"),
		setSize: v("grant-size"),
		setPopulation: v("grant-set-population"),
		replaceAssets: v("grant-replace-assets"),
		markImprovements: lines("grant-mark").map(improvementSlug),
		completionNote: v("grant-completion-note"),
		seasonalYield: {
			seasons: v("grant-yield-seasons") ?? [],
			surplus: v("grant-yield-surplus"),
			plusPopulation: !!v("grant-yield-population"),
			needsHit: !!v("grant-yield-hit"),
			whileMet: !!v("grant-yield-while-met"),
			minPopulation: v("grant-yield-min-population"),
			minSurplus: v("grant-yield-min-surplus"),
		},
		harvestBonus: v("grant-harvest"),
		surplusBonus: v("grant-surplus-bonus"),
		winterConsumption: v("grant-winter"),
		winterPopulation: v("grant-winter-population"),
		upkeep: { seasons: v("grant-upkeep-seasons") ?? [], surplus: v("grant-upkeep-surplus") },
		rollAdvantage: { moves: v("grant-adv-moves") ?? [], ask: v("grant-adv-ask") },
		lapse: { stats: stats("grant-lapse") },
		condition: { text: v("grant-condition-text"), stats: stats("grant-condition") },
	};
}

/** "Greater Harvest" for "greaterHarvest", from the improvements this window knows of; the slug otherwise. */
function improvementNameIndex(sourceGroups = []) {
	const bySlug = new Map(IMPROVEMENT_DEFINITIONS.map(d => [d.slug, d.label]));
	for (const group of sourceGroups) {
		for (const option of group.options ?? []) {
			if (String(option.value).startsWith("custom:") && option.def?.slug) bySlug.set(option.def.slug, option.label);
		}
	}
	const byName = new Map([...bySlug].map(([slug, label]) => [String(label).trim().toLowerCase(), slug]));
	return {
		label: slug => bySlug.get(slug) ?? slug,
		slug: name => byName.get(String(name).trim().toLowerCase()) ?? null,
	};
}

/**
 * The book's own seventeen, as "Start from" sources. Their one-time mechanical effects
 * live in IMPROVEMENT_GRANTS keyed by slug rather than on the definition, so they are
 * folded back on here: a copy of Palisade that came back without its +1 Fortunes would
 * be a copy of the prose only.
 */
function builtinSources() {
	return {
		label: "From the playbook",
		options: IMPROVEMENT_DEFINITIONS.map(def => ({
			value: `builtin:${def.slug}`,
			label: def.label,
			def: { ...def, name: def.label, grants: IMPROVEMENT_GRANTS[def.slug] ?? null },
		})),
	};
}

/** The attribute a draggable improvement card carries its definition in (steading-improvement-cards.js). */
const CARD_MARKER = "data-steading-improvement";

/**
 * Every string in a journal page's stored source that holds a baked improvement card.
 *
 * Walked rather than read off one known field: a homebrew card is a text page
 * (`text.content`), but the book's own Book II cards are baked into the Location and Lore
 * page types' `system.sections[].body`, and a card is the same card wherever it was put.
 */
function cardHtmlIn(source, out = []) {
	if (typeof source === "string") {
		if (source.includes(CARD_MARKER)) out.push(source);
	} else if (Array.isArray(source)) {
		for (const value of source) cardHtmlIn(value, out);
	} else if (source && typeof source === "object") {
		for (const value of Object.values(source)) cardHtmlIn(value, out);
	}
	return out;
}

/**
 * The card elements in a piece of journal HTML. Parsed in an inert <template>, which runs no
 * script and fetches no image, since this reads every page the viewer can see.
 */
function cardsInHtml(html) {
	const doc = globalThis.document;
	if (!doc?.createElement) return [];
	const tpl = doc.createElement("template");
	tpl.innerHTML = html;
	return [...tpl.content.querySelectorAll(`[${CARD_MARKER}]`)];
}

/**
 * A card's payload in the shape `addCustomImprovement` would store it: the SAME normalizers the
 * drop path runs (category kept only when it is a real one, sections and grants through
 * improvement-def.js). A card copied through "Start from" and the same card dropped on the tab
 * should be the same improvement.
 */
function journalCardDef(raw) {
	return {
		name: String(raw?.name ?? "").trim(),
		category: improvementCategoryKey(raw?.category),
		flavor: String(raw?.flavor ?? ""),
		effect: String(raw?.effect ?? ""),
		sections: normalizeImprovementSections(raw?.sections),
		grants: normalizeImprovementGrants(raw?.grants),
	};
}

/** Whether `user` may read `doc`. Anything that cannot say (a test double) is readable. */
function readableBy(doc, user) {
	if (!user || typeof doc?.testUserPermission !== "function") return true;
	return doc.testUserPermission(user, "OBSERVER");
}

/**
 * The improvement cards in the world's journals, as a "Start from" group: the homebrew ones
 * authored through this window's card target, and the Book II ones baked into the seeded
 * Location and Lore journals. Until this, the only way onto a steading for either was a drag
 * from an open journal page.
 *
 * World journals only. The compendium copies of the Book II pages are not read: finding the
 * seven cards among the pack's 200-odd entries means loading every one, and a world seeded
 * from the pack already holds the same pages. One entry per name, first found wins, so a card
 * pasted into two journals is offered once.
 *
 * @param {Iterable} [journals]  JournalEntry documents (default: the world's)
 * @param {{user?: object, parse?: (html: string) => Element[]}} [opts]  `parse` finds the card
 *   elements in a page's HTML; the default parses in the DOM.
 * @returns {{label: string, options: Array}|null}  null when there are none
 */
export function journalImprovementSources(journals = globalThis.game?.journal, { user = globalThis.game?.user, parse = cardsInHtml } = {}) {
	const options = [];
	const seen = new Set();
	for (const entry of journals ?? []) {
		if (!readableBy(entry, user)) continue;
		for (const page of entry.pages ?? []) {
			if (!readableBy(page, user)) continue;
			let n = 0;
			for (const html of cardHtmlIn(page._source ?? page)) {
				for (const card of parse(html)) {
					const raw = readImprovementCard(card);
					if (!raw) continue;
					const def = journalCardDef(raw);
					const key = def.name.toLowerCase();
					if (!def.name || seen.has(key)) continue;
					seen.add(key);
					options.push({ value: `journal:${page.uuid ?? page.id ?? entry.id}:${n++}`, label: def.name, def });
				}
			}
		}
	}
	if (!options.length) return null;
	options.sort((a, b) => a.label.localeCompare(b.label));
	return { label: "Cards in the journals", options };
}

// The world's journal cards, scanned once and kept until a journal or a page is created,
// changed or deleted (an ownership change is an update too), or another user asks: every
// builder that opens reads the same answer instead of walking every page again.
const JOURNAL_CHANGE_HOOKS = ["create", "update", "delete"].flatMap(op => [`${op}JournalEntry`, `${op}JournalEntryPage`]);
let _worldCards = null;
let _worldCardsWatched = false;

/** journalImprovementSources over the world's journals for the current user, cached. */
export function worldJournalCardSources() {
	if (!_worldCardsWatched && typeof globalThis.Hooks?.on === "function") {
		for (const hook of JOURNAL_CHANGE_HOOKS) globalThis.Hooks.on(hook, () => { _worldCards = null; });
		_worldCardsWatched = true;
	}
	const userId = globalThis.game?.user?.id ?? null;
	// Uncached until the hooks watch for changes, so nothing stale is ever served.
	if (!_worldCardsWatched) return journalImprovementSources();
	if (!_worldCards || _worldCards.userId !== userId) _worldCards = { userId, value: journalImprovementSources() };
	// A copy: a window may fill its form from these definitions.
	return _worldCards.value ? structuredClone(_worldCards.value) : null;
}

/**
 * A name the write target will actually accept, by marking a copy as one until a free name
 * turns up. Only used when the target says the original is taken: a homebrew card in the
 * journal may share a name with the book's improvement, and does, so nothing is suffixed
 * there. Bounded, and falls back to the plain name so the saver can refuse and say why
 * rather than this looping.
 */
export function freeImprovementName(name, taken) {
	if (!taken?.(name)) return name;
	for (let n = 1; n <= 99; n++) {
		const candidate = n === 1 ? `${name} (homebrew)` : `${name} (homebrew ${n})`;
		if (!taken(candidate)) return candidate;
	}
	return name;
}

/** Write target: a reusable homebrew card in the journal, dragged onto a steading later. */
export function improvementCardSaver() {
	return {
		// What a reload rebuilds this saver from (dialogs/authoring-restore.js).
		restoreAs: { saver: "improvementCard" },
		submitLabel: "Create card",
		hint: "Author a reusable improvement card, then drag it onto any steading's Improvements tab.",
		sources: () => [builtinSources()],
		async create(def) {
			const page = await createImprovementCard(def);
			return { ok: !!page };
		},
	};
}

/**
 * Write target: the open steading, which tracks the improvement immediately.
 * @param {object}   steading  StonetopSteading wrapper
 * @param {Function} [onSaved] called after a successful add (to re-render the sheet)
 */
export function steadingImprovementSaver(steading, onSaved = null) {
	return {
		restoreAs: { saver: "steadingImprovement", actor: steading?._actor?.uuid ?? null },
		submitLabel: "Add improvement",
		hint: "Add a custom improvement to track alongside the book's built-ins.",
		// This steading's own additions are offered too, as a starting point for a variant
		// (one is corrected in place through improvementEditSaver, the pencil on its card).
		// So are the improvement cards in the world's journals, homebrew and Book II alike,
		// which otherwise reach a steading only by being dragged from an open journal page.
		// A steading holds one improvement per name (the book's own included), so a copy of
		// Palisade made HERE is offered as "Palisade (homebrew)" rather than filled in and
		// then refused on save. The journal-card target has no such rule and declares none.
		nameTaken: name => !!steading?.improvementNameTaken?.(name),
		sources: () => {
			const custom = steading?.customImprovements ?? [];
			const journal = worldJournalCardSources();
			return [
				builtinSources(),
				...(custom.length ? [{
					label: "Already on this steading",
					options: custom.map(def => ({ value: `custom:${def.slug}`, label: def.label, def: { ...def, name: def.label } })),
				}] : []),
				...(journal ? [journal] : []),
			];
		},
		async create(def) {
			const result = await steading.addCustomImprovement(def);
			if (result.ok) {
				ui.notifications?.info?.(`Added steading improvement: ${result.label}.`);
				onSaved?.();
			} else if (result.reason === "duplicate") {
				ui.notifications?.warn?.(`${result.label} is already a steading improvement.`);
			}
			return result;
		},
	};
}

/**
 * Write target: an improvement already on the steading, rewritten in place. The window opens
 * filled in (`editing`), keeps the improvement's slug and so its ticked steps, and says what
 * an edit could not do by itself.
 * @param {object}   steading  StonetopSteading wrapper
 * @param {string}   slug      the improvement being rewritten
 * @param {Function} [onSaved] called after a successful write (to re-render the sheet)
 */
export function improvementEditSaver(steading, slug, onSaved = null) {
	const def = steading?.improvementDef?.(slug) ?? null;
	return {
		restoreAs: { saver: "improvementEdit", actor: steading?._actor?.uuid ?? null, slug },
		submitLabel: "Save changes",
		hint: "Rewrite this improvement. Its ticked steps are kept wherever they still apply.",
		title: `Edit ${def?.label ?? "Improvement"}`,
		// Opens filled in rather than blank: this is a correction, not a new improvement.
		editing: def ? { ...def, name: def.label } : null,
		// Its own name is not a clash with itself; every other improvement's still is.
		nameTaken: name => !!steading?.improvementNameTaken?.(name, { except: slug }),
		sources: () => steadingImprovementSaver(steading).sources(),
		async create(next) {
			const result = await steading.updateCustomImprovement(slug, next);
			if (result.ok) {
				ui.notifications?.info?.(...editSavedNotice(result));
				onSaved?.();
			} else if (result.reason === "duplicate") {
				ui.notifications?.warn?.(`${result.label} is already a steading improvement.`);
			} else if (result.reason === "missing") {
				ui.notifications?.warn?.("That improvement is no longer on the steading.");
			}
			return result;
		},
	};
}

/**
 * What saving an edit says, as `[message, options]` for `ui.notifications.info`.
 *
 * What an edit did and did not do, said only when it applies, so the notice stays worth reading
 * (see updateCustomImprovement). The two kinds of grant differ here (utils/improvement-def.js):
 *
 *   ONE-TIME effects (stats, list entries, Size...) were applied when it was completed, and an
 *     edit does not move them again. That asks the GM to DO something, and a notice that fades on a
 *     timer takes the instruction with it, so it stays up until dismissed.
 *   The "Henceforth" rules are read every time, so an edit to them applies at once; a standing
 *     stat they move (a `lapse` or `condition`) is said with the change it just made.
 *
 * @param {{label: string, structureChanged?: boolean, grantsChanged?: boolean, oneTimeChanged?: boolean,
 *   liveChanged?: boolean, standingChanged?: string[], completed?: boolean}} result
 * @returns {[string, object]}
 */
export function editSavedNotice(result) {
	const sentences = [`Saved ${result.label}.`];
	if (result.structureChanged) sentences.push("Its ticked steps were matched to the new requirements by their wording.");
	// A result without the split (an older caller) is read as one-time, the cautious reading.
	const oneTime = result.oneTimeChanged ?? result.grantsChanged;
	const act = !!(oneTime && result.completed);
	if (act) {
		sentences.push("Its one-time effects changed, but the steading still has the old ones from when it was completed."
			+ " To swap them for the new ones, un-tick it complete and tick it again.");
	}
	if (result.liveChanged && result.completed) {
		const moved = result.standingChanged ?? [];
		sentences.push(`Its ongoing rules changed, and apply from now on${moved.length ? `: ${moved.join("; ")}` : ""}.`);
	}
	return [sentences.join(" "), act ? { permanent: true } : {}];
}

/**
 * Move `el` one place up (`delta < 0`) or down among its siblings.
 *
 * Answers whether anything moved, so the caller re-labels only when it did. Shared by the group
 * list and the requirement rows: the two lists renumber differently but reorder identically, and
 * two copies of "which neighbour, and which side of it" is two places to get the ends wrong.
 *
 * ⚠ THE NEIGHBOUR is what moves, never `el`. `el` holds the button that was just pressed, and a
 * node taken out of the document, even for the instant of a re-insert, drops the keyboard to
 * <body>: a keyboard user pressing "Move up" three times got one move and then nowhere to be.
 */
function swapSibling(el, delta) {
	const sibling = delta < 0 ? el.previousElementSibling : el.nextElementSibling;
	if (!sibling) return false;
	if (delta < 0) el.after(sibling);
	else el.before(sibling);
	return true;
}

/**
 * Keep the keyboard on a move button that has just gone dead at the end of its list (a disabled
 * button cannot hold focus, so the browser drops it to <body>): hand it to the opposite one,
 * which is the press that still means something there.
 */
function keepMoveFocus(pressed, opposite) {
	if (pressed?.disabled && opposite && !opposite.disabled) opposite.focus();
}

// Numbers each window's generated ids, since two builders may be open at once (see defaultOptions).
let builderSerial = 0;

/** Grey out the up/down buttons on the item at either end of its list, which has nowhere to go. */
function disableEnds(el, i, total, prefix) {
	el.querySelector(`${prefix}-up`)?.toggleAttribute("disabled", i === 0);
	el.querySelector(`${prefix}-down`)?.toggleAttribute("disabled", i === total - 1);
}


export class ImprovementBuilderDialog extends StonetopDialog {
	/**
	 * @param {{submitLabel: string, hint: string, create: Function}} saver
	 */
	constructor(saver, options = {}) {
		super(options);
		this._saver = saver;
		// Keeps a new improvement's window apart from any other new one for a reload (`restoreKey`);
		// a reload hands back the id it was saved under (dialogs/authoring-restore.js).
		this._restoreId = options?.restoreId || foundry.utils.randomID(8);
		// The definition the form makes, as last typed, for a reload; and a reload's, to put back.
		this._liveDef = null;
		this._restoredDef = null;
		// Which rail panel is showing. Switching is client-side (see _selectTab), so this
		// only seeds the first render and nothing typed is ever re-rendered away.
		this._activeTab = SECTIONS[0].key;
		// Definitions the "Start from" picker can copy, keyed by its option value. Built
		// once here rather than per pick, so the list the window offers and the list it
		// can actually fill from cannot come apart.
		// The groups are kept too, for getData: `sources()` now reads every journal page the
		// viewer can see, which is worth doing once per window rather than once per call.
		this._sourceGroups = saver.sources?.() ?? [];
		// Improvement names, both ways, for "Also marks complete" (stored as slugs).
		this._names = improvementNameIndex(this._sourceGroups);
		this._sources = new Map();
		for (const group of this._sourceGroups) {
			for (const option of group.options ?? []) this._sources.set(option.value, option.def);
		}
		// Set while a save is in flight, so a second press of Save cannot write a second copy.
		this._saving = false;
		this._root = null;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			// No fixed id: two of these may be open at once (one per steading, or one of
			// each kind), and a shared DOM id would have the second paint into the first.
			template: "systems/stonetop-pwd/templates/dialogs/improvement-builder.hbs",
			width: 660,
			height: 560,
			resizable: true,
			classes: ["stonetop", "stonetop-improvement-builder"],
			scrollY: [".stonetop-improvement-builder-main"],
		});
	}

	get title() { return this._saver.title ?? "Create Steading Improvement"; }

	// ---- Reload --------------------------------------------------------------------------
	// utils/window-restore.js reopens this window after a reload (dialogs/authoring-restore.js) with
	// the improvement as typed: the definition the form makes, filled back in the way an edit opens.

	get restoreKey() {
		return authoringRestoreKey(IMPROVEMENT_BUILDER_RESTORE_KIND, this._saver, { windowId: this._restoreId });
	}

	/** The panel and the definition, as last typed. Read as the page unloads too, so never off the form. */
	get restoreView() {
		return { tab: this._activeTab, def: this._liveDef };
	}

	async _render(force, options = {}) {
		if (options?.view && !this.rendered) this._takeRestoredView(options.view);
		return super._render(force, options);
	}

	_takeRestoredView(view) {
		if (this._restoredDef) return;
		const def = view?.def;
		const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
		if (isMap(def) && (def.sections === undefined || Array.isArray(def.sections))
			&& (def.grants === undefined || def.grants === null || isMap(def.grants))) this._restoredDef = def;
		if (SECTIONS.some(sec => sec.key === view?.tab)) this._activeTab = view.tab;
	}

	/** Keep the definition the form makes, for a reload: typing never re-renders. */
	_noteWork(root) {
		try { this._liveDef = this._readDef(root); }
		catch (_err) { /* keeps what it last had */ }
		persistOpenWindowsSoon();
	}

	getData() {
		const activeIndex = Math.max(0, SECTIONS.findIndex(s => s.key === this._activeTab));
		return {
			// Prefixes every id in the template, so two builders open at once never share one: a
			// `for` or `aria-describedby` would otherwise land in whichever window rendered first.
			uid: this._uid ??= `stonetop-ib-${++builderSerial}`,
			submitLabel: this._saver.submitLabel,
			activeTab: this._activeTab,
			sections: SECTIONS.map((s, i) => ({ ...s, selected: i === activeIndex })),
			active: {
				icon: SECTIONS[activeIndex].icon,
				title: SECTIONS[activeIndex].title,
				hint: this._panelHint(SECTIONS[activeIndex]),
				count: `${activeIndex + 1} / ${SECTIONS.length}`,
			},
			atFirst: activeIndex === 0,
			atLast: activeIndex === SECTIONS.length - 1,
			categories: IMPROVEMENT_CATEGORIES.map(c => ({ key: c.key, label: c.label })),
			statFields: GRANT_STAT_FIELDS,
			maxRepeat: MAX_REQUIREMENT_REPEAT,
			sizes: STEADING_SIZES.map(size => ({ value: size, label: size })),
			seasons: SEASON_IDS.map(season => ({ value: season, label: season.charAt(0).toUpperCase() + season.slice(1) })),
			advantageMoves: ROLL_ADVANTAGE_MOVES,
			sourceGroups: (this._sourceGroups ?? this._saver.sources?.() ?? []).map(group => ({
				label: group.label,
				options: (group.options ?? []).map(({ value, label }) => ({ value, label })),
			})),
		};
	}

	/** The banner's subtitle for a panel: its own line, or the saver's for the first one. */
	_panelHint(section) {
		return section?.hint ?? this._saver.hint ?? "";
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		this._root = root;

		root.querySelectorAll(".stonetop-improvement-builder-tab").forEach(btn =>
			btn.addEventListener("click", () => this._selectTab(root, btn.dataset.tab)));
		root.querySelector(".stonetop-improvement-builder-back")?.addEventListener("click", ev => this._step(root, -1, ev.currentTarget));
		root.querySelector(".stonetop-improvement-builder-next")?.addEventListener("click", ev => this._step(root, 1, ev.currentTarget));

		root.querySelector(".stonetop-improvement-builder-add-group")?.addEventListener("click", () => this._addGroup(root));
		// Editing an improvement opens on it. Otherwise one empty group to start, because a
		// requirement list is what most improvements are, and an empty panel with only an
		// "Add" button reads as though there is nothing to do.
		if (this._saver.editing) this._fillFrom(root, this._saver.editing);
		else this._addGroup(root);
		// A reload's improvement goes over that. What the window would have opened with is taken for
		// the close-guard FIRST, so what came back through the reload still counts as unsaved work.
		if (this._restoredDef) {
			const def = this._restoredDef;
			this._restoredDef = null;
			notePristineWork(this);
			try { this._fillFrom(root, def); }
			catch (err) { console.warn("Stonetop | couldn't put a reloaded improvement back in the form", err); }
		}
		// Typing, ticking, adding and moving rows: kept as they happen. Clicks are how rows come and go.
		for (const type of ["input", "change", "click"]) root.addEventListener(type, () => this._noteWork(root));
		this._noteWork(root);

		root.querySelector(".stonetop-improvement-builder-source")
			?.addEventListener("change", event => this._onPickSource(root, event.currentTarget));

		// The preview is redrawn on every keystroke, but only while its own panel is the
		// one showing: everywhere else it would be rebuilding a card nobody is looking at
		// on each character typed.
		root.addEventListener("input", () => { if (this._activeTab === "preview") this._renderPreview(root); });

		// A taken name is said where the name is, as soon as the author leaves the field,
		// rather than only after a whole improvement has been written and Save pressed.
		const name = root.querySelector("[name=name]");
		name?.addEventListener("blur", () => this._checkName(root, { onlyTaken: true }));
		// Once flagged, the flag follows the typing, so it goes away the moment it is fixed.
		name?.addEventListener("input", () => { if (name.getAttribute("aria-invalid") === "true") this._checkName(root); });

		root.querySelector(".stonetop-improvement-builder-save")?.addEventListener("click", () => this._save(root));
		root.querySelector(".stonetop-improvement-builder-cancel")?.addEventListener("click", () => this.close());
	}

	// ── Closing without saving ──────────────────────────────────
	// Cancel, Escape and the title bar's X go through StonetopDialog.close, whose close-guard
	// (utils/close-guard.js) asks before losing work. A successful save closes with `{discard: true}`.

	/**
	 * What the form holds, as a string to compare: the definition it would save. Measured on the
	 * definition rather than on the raw fields, so an empty row or group added and never used is
	 * not "work" (the save would drop it anyway) while every typed word, tick and number is.
	 */
	_formState(root) {
		try { return JSON.stringify(this._readDef(root)); }
		catch (_e) { return null; }
	}

	/** The close-guard's snapshot: the form, once it is drawn. */
	_workState() {
		return this._root ? this._formState(this._root) : null;
	}

	_discardCopy() {
		return this._saver.editing
			? { title: "Discard your changes?", body: "Your changes to this improvement have not been saved. Closing the window now loses them." }
			: { title: "Discard this improvement?", body: "This improvement has not been saved. Closing the window now loses what you have written." };
	}

	// ── The rail ────────────────────────────────────────────────

	/**
	 * Back / Next. At either end of the rail the button just pressed goes dead, and a disabled
	 * button cannot hold the keyboard: it fell to <body> on the last panel. It goes to the other
	 * one of the pair instead, which is the press that still means something there.
	 */
	_step(root, delta, pressed = null) {
		const next = guideRailStep(SECTIONS, this._activeTab, delta);
		if (next) this._selectTab(root, next.key);
		if (pressed?.disabled) {
			root.querySelector(delta > 0 ? ".stonetop-improvement-builder-back" : ".stonetop-improvement-builder-next")?.focus();
		}
	}

	// Show one panel and light its rail entry. Purely DOM: the form is never re-rendered,
	// so moving around keeps every field, and the requirement groups added so far.
	_selectTab(root, key) {
		const index = SECTIONS.findIndex(s => s.key === key);
		if (index < 0) return;
		this._activeTab = key;
		const active = SECTIONS[index];
		// Built on the way in rather than kept in step with every edit: the panel is only
		// ever read when it is the one showing.
		if (key === "preview") this._renderPreview(root);

		applyGuideRail(root, {
			key, dataKey: "tab",
			tabSelector: ".stonetop-improvement-builder-tab",
			sectionSelector: ".stonetop-improvement-builder-section",
			iconSelector: ".stonetop-improvement-builder-banner-icon",
			icon: active.icon,
			iconExtraClass: "stonetop-improvement-builder-banner-icon",
			mainSelector: ".stonetop-improvement-builder-main",
			titleSelector: ".stonetop-improvement-builder-banner-title", title: active.title,
			countSelector: ".stonetop-improvement-builder-banner-count",
			backSelector: ".stonetop-improvement-builder-back", nextSelector: ".stonetop-improvement-builder-next",
			index, total: SECTIONS.length,
		});
		const sub = root.querySelector(".stonetop-improvement-builder-banner-sub");
		if (sub) sub.textContent = this._panelHint(active);
	}

	// ── Requirement groups ──────────────────────────────────────

	/**
	 * Clone the empty-group markup out of the template's <template> and wire its controls.
	 * @param {HTMLElement} root
	 * @param {{heading?:string, rows?:Array, partial?:boolean, min?:number, alternative?:boolean}} [values]
	 *   a group to fill it with, when the form is being filled from an existing improvement
	 * @returns {HTMLElement} the group element, so a caller can keep filling it
	 */
	_addGroup(root, values = null) {
		const tpl = root.querySelector(".stonetop-improvement-builder-group-tpl");
		const list = root.querySelector(".stonetop-improvement-builder-groups");
		if (!tpl || !list) return null;
		const group = tpl.content.firstElementChild.cloneNode(true);

		group.querySelector(".stonetop-improvement-builder-group-remove")
			?.addEventListener("click", () => this._removeGroup(root, group));
		group.querySelector(".stonetop-improvement-builder-group-up")
			?.addEventListener("click", ev => this._moveGroup(root, group, -1, ev.currentTarget));
		group.querySelector(".stonetop-improvement-builder-group-down")
			?.addEventListener("click", ev => this._moveGroup(root, group, 1, ev.currentTarget));
		const mode = group.querySelector(".stonetop-improvement-builder-group-mode");
		mode?.addEventListener("change", () => { this._syncGroupMode(group); this._syncGroupHeading(group); });
		group.querySelector(".stonetop-improvement-builder-group-min")
			?.addEventListener("input", () => this._syncGroupHeading(group));
		group.querySelector(".stonetop-improvement-builder-group-alt input")
			?.addEventListener("change", () => this._syncGroupHeading(group));
		group.querySelector(".stonetop-improvement-builder-add-row")
			?.addEventListener("click", () => this._addRow(root, group));

		list.appendChild(group);

		if (values) {
			const set = (sel, v) => { const el = group.querySelector(sel); if (el) el.value = v; };
			set(".stonetop-improvement-builder-group-heading", values.heading ?? "");
			set(".stonetop-improvement-builder-group-mode", values.partial ? "min" : "all");
			set(".stonetop-improvement-builder-group-min", String(values.min ?? 1));
			const alt = group.querySelector(".stonetop-improvement-builder-group-alt input");
			if (alt) alt.checked = !!values.alternative;
			for (const row of values.rows ?? []) this._addRow(root, group, row);
		}
		// One empty requirement in a fresh group, for the same reason a fresh window gets
		// one group: a panel offering only an "Add" button reads as though it is broken.
		if (!group.querySelector(".stonetop-improvement-builder-req")) this._addRow(root, group);

		this._syncGroupMode(group);
		this._renumberGroups(root);
		return group;
	}

	/** Swap a group with its neighbour, then re-label and re-check the whole list. */
	_moveGroup(root, group, delta, pressed = null) {
		if (!swapSibling(group, delta)) return;
		this._renumberGroups(root);
		keepMoveFocus(pressed, group.querySelector(`.stonetop-improvement-builder-group-${delta < 0 ? "down" : "up"}`));
	}

	/**
	 * Drop a group, asking first when it holds anything: a heading typed, or a requirement written.
	 * Every row in it goes with it, which one stray click on a trash can should not do unasked.
	 * The keyboard then goes to the group that took its place (or the one above, or the Add
	 * button when none is left), rather than falling to <body> with the removed button.
	 */
	async _removeGroup(root, group) {
		if (this._groupIsWritten(group)) {
			const num = this._groupNumber(group);
			const count = itemsFromRows(this._readRows(group)).length;
			const what = count ? `its ${count === 1 ? "requirement" : `${count} requirements`}` : "its heading";
			const remove = await confirmOutcome({
				title: `Remove group ${num}?`,
				content: `<p>Group ${num} and ${escHtml(what)} will be taken out of the form.</p>`,
				yes: { label: `Remove group ${num}`, icon: "fa-trash" },
				no: { label: "Keep it", icon: "fa-xmark" },
			});
			if (remove !== true) return;
		}
		const neighbour = group.nextElementSibling ?? group.previousElementSibling;
		group.remove();
		this._renumberGroups(root);
		(neighbour?.querySelector(".stonetop-improvement-builder-group-heading")
			?? root.querySelector(".stonetop-improvement-builder-add-group"))?.focus();
	}

	/** A group's 1-based position in the list, which is the number its labels carry. */
	_groupNumber(group) {
		const siblings = [...(group.parentElement?.children ?? [])];
		return Math.max(0, siblings.indexOf(group)) + 1;
	}

	/** The "at least N" box only means anything in the matching mode. */
	_syncGroupMode(group) {
		const partial = group.querySelector(".stonetop-improvement-builder-group-mode")?.value === "min";
		group.querySelector(".stonetop-improvement-builder-group-min-wrap")?.classList.toggle("is-hidden", !partial);
		this._syncGroupHeading(group);
	}

	/**
	 * Show, as the heading field's placeholder, the heading that would actually be written
	 * for this group if it is left blank. "Leave it blank and it is written for you" is
	 * only a useful offer if you can see what it writes, and what it writes turns on the
	 * group's position, its item count and its either/or state, all of which move.
	 */
	_syncGroupHeading(group) {
		const field = group.querySelector(".stonetop-improvement-builder-group-heading");
		if (!field) return;
		const partial = group.querySelector(".stonetop-improvement-builder-group-mode")?.value === "min";
		const alt = group.querySelector(".stonetop-improvement-builder-group-alt");
		// ⚠ WHERE THIS GROUP WILL LAND, not where it sits. A group with neither a heading nor a box
		// is not a requirement, and the save drops it (utils/improvement-def.js#sectionsFromGroups)
		// — so an unused group above this one shifts every heading below it up by one. Read off the
		// DOM, the field promised "And then:" over an improvement that saved as "Requires all of
		// the following:", which is the one thing a placeholder showing you what will be written
		// must never do. The builder opens with an empty group, so this is the ordinary case.
		const index = this._keptIndex(group);
		field.placeholder = defaultSectionHeading({
			index,
			min: partial ? Number(group.querySelector(".stonetop-improvement-builder-group-min")?.value) : null,
			// Boxes, not rows: "2 of the following" is measured against the checkboxes the
			// group actually makes, and a repeated row makes several. Counting rows here had
			// the placeholder saying "And then:" for a group whose written heading would have
			// been "And 2 of the following:", which is the one thing it must not do.
			count: itemsFromRows(this._readRows(group)).length,
			// `index` again, for the same reason: an alternative needs something above it to be an
			// alternative TO, and the save counts that among the groups it KEEPS. A ticked box on a
			// group whose predecessors were all blank writes a plain heading, so the placeholder
			// has to promise one.
			alternative: index > 0
				&& !alt?.classList.contains("is-hidden")
				&& !!alt?.querySelector("input")?.checked,
		});
	}

	/**
	 * Where a group will sit once the save has dropped the blank ones, and whether it is one of
	 * them. The pair of them is `sectionsFromGroups`' own rule, asked of the DOM: a group with no
	 * boxes and no typed heading is a row the author added and did not use, and it is not written.
	 */
	_keptIndex(group) {
		let kept = 0;
		for (const sibling of group.parentElement?.children ?? []) {
			if (sibling === group) break;
			if (this._groupIsWritten(sibling)) kept += 1;
		}
		return kept;
	}

	/** True when this group would survive the save: it makes a box, or somebody typed a heading. */
	_groupIsWritten(group) {
		const typed = group.querySelector(".stonetop-improvement-builder-group-heading")?.value?.trim();
		return !!typed || itemsFromRows(this._readRows(group)).length > 0;
	}

	/**
	 * Re-label the groups after one is added, removed or moved, and hide the "alternative
	 * to the group above" checkbox on the FIRST group, which has nothing above it to be an
	 * alternative to. Unticked as well as hidden, so a group promoted to first by a removal
	 * cannot carry a stale either/or into the saved definition.
	 */
	_renumberGroups(root) {
		const groups = [...root.querySelectorAll(".stonetop-improvement-builder-group")];
		groups.forEach((group, i) => {
			const num = group.querySelector(".stonetop-improvement-builder-group-num");
			if (num) num.textContent = `Group ${i + 1}`;
			this._labelGroup(group, i + 1);
			const alt = group.querySelector(".stonetop-improvement-builder-group-alt");
			alt?.classList.toggle("is-hidden", i === 0);
			if (i === 0 && alt) alt.querySelector("input").checked = false;
			// A group at either end has nothing to swap with in that direction.
			disableEnds(group, i, groups.length, ".stonetop-improvement-builder-group");
			this._syncGroupHeading(group);
		});
	}

	/**
	 * Name every control in a group by its group's number. Cloned from one <template>, each group's
	 * fields were otherwise announced alike ("Heading", "Requirement" over and over), with no way
	 * to tell by ear which group or which line the keyboard was on. Re-run on every add, move and
	 * remove, since all three change the numbers.
	 *
	 * The heading gets a real `for`/`id` pair (so clicking its label lands in it too); the rest,
	 * whose visible text is a glyph or sits mid-sentence, get an aria-label that contains it.
	 */
	_labelGroup(group, n) {
		this._uid ??= `stonetop-ib-${++builderSerial}`;
		group.setAttribute("aria-label", `Requirement group ${n}`);
		const headingId = `${this._uid}-group-${n}-heading`;
		const heading = group.querySelector(".stonetop-improvement-builder-group-heading");
		if (heading) {
			heading.id = headingId;
			heading.setAttribute("aria-label", `Group ${n} heading`);
		}
		const headingLabel = group.querySelector(".stonetop-improvement-builder-group-heading-label");
		if (headingLabel) headingLabel.htmlFor = headingId;
		const attr = (sel, value) => group.querySelector(sel)?.setAttribute("aria-label", value);
		attr(".stonetop-improvement-builder-group-mode", `Must tick in group ${n}`);
		attr(".stonetop-improvement-builder-group-min", `Minimum to tick in group ${n}`);
		attr(".stonetop-improvement-builder-group-up", `Move group ${n} up`);
		attr(".stonetop-improvement-builder-group-down", `Move group ${n} down`);
		attr(".stonetop-improvement-builder-group-remove", `Remove group ${n}`);
		attr(".stonetop-improvement-builder-rows", `Requirements in group ${n}`);
		attr(".stonetop-improvement-builder-add-row", `Add requirement to group ${n}`);
		this._labelRows(group, n);
	}

	/** Name each requirement row's controls by its place: "Requirement 3 of group 1". */
	_labelRows(group, n = this._groupNumber(group)) {
		const rows = [...group.querySelectorAll(".stonetop-improvement-builder-req")];
		rows.forEach((row, i) => {
			const which = `requirement ${i + 1} of group ${n}`;
			const attr = (sel, value) => row.querySelector(sel)?.setAttribute("aria-label", value);
			attr(".stonetop-improvement-builder-req-text", `Requirement ${i + 1} of group ${n}`);
			attr(".stonetop-improvement-builder-req-count", `Boxes for ${which}`);
			attr(".stonetop-improvement-builder-req-up", `Move ${which} up`);
			attr(".stonetop-improvement-builder-req-down", `Move ${which} down`);
			attr(".stonetop-improvement-builder-req-remove", `Remove ${which}`);
		});
	}

	// ── Requirement rows ────────────────────────────────────────

	/**
	 * One requirement: the text beside its checkbox and how many boxes it makes. A row per
	 * requirement rather than a line of a textarea is what lets a step be moved, dropped,
	 * or repeated without retyping the ones around it.
	 * @param {{text?: string, repeat?: number}} [values]
	 */
	_addRow(root, group, values = null) {
		const tpl = root.querySelector(".stonetop-improvement-builder-row-tpl");
		const list = group.querySelector(".stonetop-improvement-builder-rows");
		if (!tpl || !list) return null;
		const row = tpl.content.firstElementChild.cloneNode(true);

		row.querySelector(".stonetop-improvement-builder-req-remove")?.addEventListener("click", () => {
			// The keyboard goes to the row that took this one's place, or the one above it, or
			// the fresh row a group left empty is given back; never down to <body> with the
			// button that was removed.
			const neighbour = row.nextElementSibling ?? row.previousElementSibling;
			row.remove();
			// A group with no rows left gets one back rather than becoming un-addable.
			const landing = neighbour ?? this._addRow(root, group);
			this._renumberRows(group);
			landing?.querySelector(".stonetop-improvement-builder-req-text")?.focus();
		});
		row.querySelector(".stonetop-improvement-builder-req-up")?.addEventListener("click", ev => this._moveRow(group, row, -1, ev.currentTarget));
		row.querySelector(".stonetop-improvement-builder-req-down")?.addEventListener("click", ev => this._moveRow(group, row, 1, ev.currentTarget));
		// The heading the group would be given counts its requirements, so it changes as
		// rows and repeats do ("Requires 2 of the following" vs "Requires all of them").
		row.querySelector(".stonetop-improvement-builder-req-count")
			?.addEventListener("input", () => this._syncGroupHeading(group));

		if (values) {
			const text = row.querySelector(".stonetop-improvement-builder-req-text");
			if (text) text.value = values.text ?? "";
			const count = row.querySelector(".stonetop-improvement-builder-req-count");
			if (count) count.value = String(clampRepeat(values.repeat));
		}

		list.appendChild(row);
		this._renumberRows(group);
		return row;
	}

	/** Swap a row with its neighbour inside its own group. */
	_moveRow(group, row, delta, pressed = null) {
		if (!swapSibling(row, delta)) return;
		this._renumberRows(group);
		keepMoveFocus(pressed, row.querySelector(`.stonetop-improvement-builder-req-${delta < 0 ? "down" : "up"}`));
	}

	/** Grey out the move buttons at each end, re-label the rows, and refresh the group's written heading. */
	_renumberRows(group) {
		const rows = [...group.querySelectorAll(".stonetop-improvement-builder-req")];
		rows.forEach((row, i) => disableEnds(row, i, rows.length, ".stonetop-improvement-builder-req"));
		this._labelRows(group);
		this._syncGroupHeading(group);
	}

	/** One group's requirement rows, as authored. */
	_readRows(group) {
		return [...group.querySelectorAll(".stonetop-improvement-builder-req")].map(row => ({
			text: row.querySelector(".stonetop-improvement-builder-req-text")?.value ?? "",
			repeat: row.querySelector(".stonetop-improvement-builder-req-count")?.value ?? "1",
		})).filter(r => r.text.trim());
	}

	/**
	 * The requirement groups as the author filled them in. Reading only: what a group
	 * MEANS (the heading it gets when blank, the boxes a repeat expands into, the shared
	 * id an either/or run needs) is decided by sectionsFromGroups and itemsFromRows, which
	 * have no DOM in them and are tested on their own.
	 */
	_readGroups(root) {
		return [...root.querySelectorAll(".stonetop-improvement-builder-group")].map(el => {
			const value = sel => el.querySelector(sel)?.value ?? "";
			return {
				heading: value(".stonetop-improvement-builder-group-heading"),
				rows: this._readRows(el),
				partial: value(".stonetop-improvement-builder-group-mode") === "min",
				min: value(".stonetop-improvement-builder-group-min"),
				alternative: !!el.querySelector(".stonetop-improvement-builder-group-alt input")?.checked,
			};
		});
	}

	// ── Starting from an improvement that already exists ─────────

	/**
	 * Copy the picked improvement into every panel. The select is put back to its blank
	 * entry afterwards, so it reads as an action taken rather than as a state the window
	 * is now in, and so picking the same one twice works.
	 */
	async _onPickSource(root, select) {
		const def = this._sources.get(select?.value);
		select.value = "";
		if (!def) return;
		// It replaces the whole form, so work already in it is asked about first.
		if (hasUnsavedWork(this)) {
			const replace = await confirmOutcome({
				title: "Replace what is in the form?",
				content: `<p>Starting from ${escHtml(def.name)} replaces everything in the form, on every panel. What you have written so far will be lost.</p>`,
				yes: { label: `Replace it with ${def.name}`, icon: "fa-file-import" },
				no: { label: "Keep what I have", icon: "fa-xmark" },
			});
			if (replace !== true) return;
		}
		const name = freeImprovementName(def.name, this._saver.nameTaken);
		this._fillFrom(root, { ...def, name });
		// A copy nobody has touched yet is not work to lose: closing straight after picking
		// one closes without asking, and so does picking a different one.
		this._pristineWork = null;
		notePristineWork(this);
		this._clearNameError(root);
		ui.notifications?.info?.(name === def.name
			? `Copied ${def.name} into the form.`
			: `Copied ${def.name} into the form as "${name}", since the steading already has one by that name.`);
	}

	/**
	 * Fill the form from a definition. Stored text is HTML (see improvement-def.js), so it
	 * comes back through unformatImprovementText into the *asterisk* form that was typed;
	 * requirement items come back through groupsFromSections, which re-collapses a
	 * numbered run into the single repeated row that produced it.
	 */
	_fillFrom(root, def) {
		const set = (sel, v) => { const el = root.querySelector(sel); if (el) el.value = v; };
		set("[name=name]", def.name ?? "");
		set("[name=category]", def.category ?? "");
		set("[name=flavor]", def.flavor ?? "");
		set("[name=effect]", unformatImprovementText(def.effect ?? ""));

		const list = root.querySelector(".stonetop-improvement-builder-groups");
		if (list) list.replaceChildren();
		const groups = groupsFromSections(def.sections ?? []);
		for (const group of groups.length ? groups : [null]) this._addGroup(root, group);

		const values = grantFormValues(def.grants ?? null, { improvementLabel: this._names.label });
		for (const [field, kind] of Object.entries(GRANT_FORM_FIELDS)) {
			const controls = [...root.querySelectorAll(`[name="${field}"]`)];
			if (kind === "checks") for (const box of controls) box.checked = (values[field] ?? []).includes(box.value);
			else if (kind === "check") for (const box of controls) box.checked = !!values[field];
			else for (const el of controls) el.value = values[field] ?? "";
		}
		this._clearMarkError(root);

		if (this._activeTab === "preview") this._renderPreview(root);
		// "Start from" fills the form after a question, with no event of its own to note it by.
		this._noteWork(root);
	}

	// ── Preview ─────────────────────────────────────────────────

	/** Draw the card the Improvements tab will draw, from the definition the form makes. */
	_renderPreview(root) {
		const def = this._readDef(root);
		const target = root.querySelector(".stonetop-improvement-builder-preview");
		if (target) target.innerHTML = improvementPreviewHtml(def, { improvementLabel: this._names.label });
		// What the card cannot show by itself: that it has no boxes at all (so it can be ticked
		// complete at once), and that some rows were left blank and will not be written.
		const notes = root.querySelector(".stonetop-improvement-builder-preview-notes");
		if (notes) {
			const lines = improvementPreviewNotes(def, { blankRows: this._blankRowCount(root) });
			notes.replaceChildren(...lines.map(text => {
				const p = root.ownerDocument.createElement("p");
				p.className = "stonetop-improvement-builder-preview-note";
				p.textContent = text;
				return p;
			}));
			notes.hidden = !lines.length;
		}
	}

	/** Requirement rows with nothing typed in them, which the save leaves out. */
	_blankRowCount(root) {
		return [...root.querySelectorAll(".stonetop-improvement-builder-req-text")]
			.filter(field => !String(field.value ?? "").trim()).length;
	}

	// ── Saving ──────────────────────────────────────────────────

	_readGrants(root) {
		return grantsFromFormValues(this._readGrantValues(root), {
			// An unknown name stays as typed, and the normalizer drops it; Save refuses it first
			// (_checkMarks), so it never goes silently.
			improvementSlug: name => this._names.slug(name) ?? name,
		});
	}

	/** Every Effect-panel field's value, by form name (GRANT_FORM_FIELDS). */
	_readGrantValues(root) {
		const values = {};
		for (const [field, kind] of Object.entries(GRANT_FORM_FIELDS)) {
			const controls = [...root.querySelectorAll(`[name="${field}"]`)];
			if (kind === "checks") values[field] = controls.filter(box => box.checked).map(box => box.value);
			else if (kind === "check") values[field] = controls.some(box => box.checked);
			else values[field] = StonetopDialog.readValue(root, `[name="${field}"]`);
		}
		return values;
	}

	/**
	 * "Also marks complete" names no improvement this window knows of: the problem, or null. Said
	 * beside the field, like the name's, rather than letting the save drop the line without a word.
	 */
	_checkMarks(root) {
		const field = root.querySelector("[name=grant-mark]");
		const unknown = String(field?.value ?? "").split("\n").map(s => s.trim()).filter(Boolean)
			.filter(name => !this._names.slug(name));
		if (!unknown.length) { this._clearMarkError(root); return null; }
		const problem = `No improvement is called ${unknown.join(", ")}. Use an improvement's name as its card shows it.`;
		const message = root.querySelector(".stonetop-improvement-builder-mark-error");
		if (message) { message.textContent = problem; message.hidden = false; }
		field?.setAttribute("aria-invalid", "true");
		if (message?.id) field?.setAttribute("aria-describedby", message.id);
		return problem;
	}

	_clearMarkError(root) {
		const field = root.querySelector("[name=grant-mark]");
		field?.removeAttribute("aria-invalid");
		field?.removeAttribute("aria-describedby");
		const message = root.querySelector(".stonetop-improvement-builder-mark-error");
		if (message) { message.textContent = ""; message.hidden = true; }
	}

	/**
	 * The definition the form currently describes. The ONE place the window turns itself
	 * into a definition, so the Preview panel cannot be showing a card that differs from
	 * the one Save would write.
	 */
	_readDef(root) {
		const value = sel => StonetopDialog.readValue(root, sel);
		return buildImprovementDef({
			name: value("[name=name]"),
			category: value("[name=category]"),
			flavor: value("[name=flavor]"),
			effect: value("[name=effect]"),
			sections: sectionsFromGroups(this._readGroups(root)),
			grants: this._readGrants(root),
		});
	}

	/**
	 * What is wrong with the name as typed, or null when nothing is. The two things Save refuses
	 * on: no name, and a name the target already holds (the saver's own `nameTaken`, so the
	 * window and the write cannot disagree; the journal-card target declares none).
	 */
	_nameProblem(name) {
		const trimmed = String(name ?? "").trim();
		if (!trimmed) return "Enter a name for the improvement.";
		if (this._saver.nameTaken?.(trimmed)) {
			return `This steading already has an improvement called ${trimmed}. Choose another name.`;
		}
		return null;
	}

	/**
	 * Check the name field and say what is wrong with it beside it: the message under the field,
	 * the field marked invalid and pointing at the message, so a screen reader announces both.
	 * `onlyTaken` is the blur check: leaving the field empty is not worth a red line while the
	 * author is still finding their way round the form, but a clash is.
	 * @returns {string|null} the problem, or null when the name will do
	 */
	_checkName(root, { onlyTaken = false } = {}) {
		const field = root.querySelector("[name=name]");
		const problem = this._nameProblem(field?.value);
		if (!problem || (onlyTaken && !String(field?.value ?? "").trim())) {
			this._clearNameError(root);
			return problem;
		}
		const message = root.querySelector(".stonetop-improvement-builder-name-error");
		if (message) {
			message.textContent = problem;
			message.hidden = false;
		}
		field?.setAttribute("aria-invalid", "true");
		if (message?.id) field?.setAttribute("aria-describedby", message.id);
		return problem;
	}

	_clearNameError(root) {
		const field = root.querySelector("[name=name]");
		field?.removeAttribute("aria-invalid");
		field?.removeAttribute("aria-describedby");
		const message = root.querySelector(".stonetop-improvement-builder-name-error");
		if (message) {
			message.textContent = "";
			message.hidden = true;
		}
	}

	async _save(root) {
		// A second press while the first is still writing would write a second copy: with the
		// journal-card target that is a second page, and on first use even a second journal.
		if (this._saving) return;
		const def = this._readDef(root);

		const problem = this._checkName(root);
		if (problem) {
			ui.notifications?.warn?.(problem);
			// The name lives on the first panel, which may not be the one showing when Save
			// is pressed: swing back to it so the focus lands somewhere the author can see.
			this._selectTab(root, SECTIONS[0].key);
			root.querySelector("[name=name]")?.focus();
			return;
		}

		const marks = this._checkMarks(root);
		if (marks) {
			ui.notifications?.warn?.(marks);
			this._selectTab(root, "effect");
			root.querySelector("[name=grant-mark]")?.focus();
			return;
		}

		const button = root.querySelector(".stonetop-improvement-builder-save");
		this._saving = true;
		if (button) button.disabled = true;
		let result;
		try {
			result = await this._saver.create(def);
		} catch (err) {
			console.error("Stonetop | The improvement could not be saved.", err);
			ui.notifications?.error?.("The improvement could not be saved. Try again, or ask your GM to check your permissions.");
			result = { ok: false };
		}
		// A rejected write (duplicate name, no permission) has already said so through the
		// saver; leaving the window open keeps everything typed rather than making the
		// author start over from a notification. The latch stays set on success, since the
		// window is closing and Save has nothing left to do.
		if (result?.ok !== false) {
			this.close({ discard: true });
			return;
		}
		this._saving = false;
		if (button) button.disabled = false;
	}
}
