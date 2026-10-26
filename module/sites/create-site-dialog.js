import { StepperDialog } from "../dialogs/StepperDialog.js";
import { SaveForNow } from "../dialogs/save-for-now.js";
import {
	SITE_MANNERS, REGIONS, siteManner, region, visibleTables, pickLines,
	regionTables, regionPickLines, REGION_TABLE_PREFIX,
	rollOnTable, againPool, againSpec, claimedAfter, combineMax, maxExtraPicks,
	slotPool, findRow, currentPickText, splitCombined, joinCombined,
	SITE_STORY_QUESTIONS, SITE_CONNECTIONS, SITE_QUESTION_PROMPTS,
	SITE_DANGER_KINDS, SITE_DISCOVERY_KINDS, AREA_DETAIL_PROMPTS,
	SITE_LAYOUT_TIPS, SITE_REVIEW_CHECKS,
} from "../data/site-tables.js";
import { shapeSiteSystem, setSiteName } from "./site-store.js";
import { MAX_ROW_SPAN, SITE_LINE_LISTS, SITE_PAIR_LISTS, clampRowSpan, expandTableRows, numberTableRows, pairKeys, tableRowRanges } from "./site-schema.js";

// ── CreateSiteDialog ─────────────────────────────────────────────────────────
// A walkthrough for "Creating sites" (Book I, Sites, pp. 355-370). The book's procedure
// is four phases with sub-steps, and it is emphatic that you do only as much of it as you
// need for the next session, improvising the rest. So this is a nine-step stepper that
// follows the book's order, with a jump-to-step rail: fill in the foundation, then dip
// into whichever later phases are worth your time and leave the others empty.
//
//   1-2  Lay the foundation        (what you know, then the Book II tables + terrain)
//   3-4  Build up its story        (connections + questions, then a timeline)
//   5-7  Sketch out its contents   (denizens/dangers/discoveries, environment, areas)
//   8    Write it up               (plans, and the lists and tables you'll roll on)
//   9    Review
//
// Mirrors CreateHazardDialog: created without a page it resolves the collected SEED via
// promise() (the caller, gm-prep-actions.js#createSiteFlow, then calls createSite); created with
// `{ page }` it opens pre-filled, the final button becomes "Save site", and it applies the update
// to the page itself. The wizard IS the site editor, so there is no separate editor dialog.
//
// Every step but the last also has Save for now (Save, when editing): the book says to do only
// as much as next session needs, so the GM can stop anywhere and pick it up from the site's
// pencil. Closing with unsaved answers asks first (utils/close-guard.js).

const _STEPS = [
	{
		key:   "foundation",
		title: "Lay the foundation",
		icon:  "fa-seedling",
		body:  `<p>A site is an interesting place the PCs can explore. It should <strong>tell a story</strong>, be <strong>exciting to explore</strong>, and present <strong>meaningful decisions</strong>.</p>
				<p>Start with what you've already got: what you've told the players, what they've told you, and what you've decided in your heart of hearts. If a PC might know this place, ask them what it's like.</p>`,
	},
	{
		key:   "manner",
		title: "Theme",
		icon:  "fa-book-atlas",
		body:  `<p>Decide what <strong>manner of site</strong> this is, then use that Book II entry's tables to develop the concept. Treat them as creative prompts: pick what catches your eye, or roll and make sense of what you get.</p>
				<p>Unlikely combinations make the most memorable sites. But you're not beholden to the dice, so re-roll or pick instead if a result really doesn't feel right.</p>`,
	},
	{
		key:   "story",
		title: "Build up its story",
		icon:  "fa-link",
		body:  `<p><em>Optional.</em> Look for <strong>connections</strong> between what you've got and the rest of the world, then let those connections prompt <strong>questions</strong> and answer them.</p>
				<p>If no answer occurs to you, roll on a Book II table, or set the question aside and come back to it. Let your answers spawn new questions.</p>`,
	},
	{
		key:   "timeline",
		title: "Create a timeline",
		icon:  "fa-hourglass-half",
		body:  `<p><em>Optional.</em> Put the key events in relative order: this happened, then this, then this. Vague times are usually fine (centuries ago, last winter, last week).</p>
				<p>Read it back when you're done and look for holes or contradictions.</p>`,
	},
	{
		key:   "contents",
		title: "Populate it",
		icon:  "fa-users",
		body:  `<p><em>Optional.</em> Who or what lives here, visits, or is just passing through? Note the relationships between them: factions and rivalries, debts and feuds, love and hate and jealousy.</p>
				<p>Then list the <strong>dangers</strong> and <strong>discoveries</strong> the site's story implies. Just name them for now; placing and writing them up comes later.</p>`,
	},
	{
		key:   "environment",
		title: "Describe the environment",
		icon:  "fa-tree",
		body:  `<p><em>Optional.</em> Build a vocabulary of imagery, impressions and details you can pull from while framing scenes. Reflect the site's story: what traces remain of its original purpose, and how have its denizens shaped it?</p>`,
	},
	{
		key:   "areas",
		title: "Areas & rooms",
		icon:  "fa-diagram-project",
		body:  `<p><em>Optional.</em> Write out the distinct rooms or places the site's story and common sense suggest. If it was built for a purpose, start with the rooms that purpose needed.</p>
				<p>Note each area's <strong>exits</strong> to fix the layout without drawing a map.</p>`,
	},
	{
		key:   "plans",
		title: "Make plans, lists & tables",
		icon:  "fa-list-check",
		body:  `<p><em>Optional.</em> How will the denizens react to the PCs? What happens when they enter an area, and how long after X does Y happen? Note it as if/then tactics, a timetable, or GM moves you mean to make.</p>
				<p>Some content exists in a quantum state (sentries walk a perimeter, the bears might be out foraging). Put that in a <strong>table</strong> and roll on it from the card when the PCs enter a new area.</p>`,
	},
	{
		key:     "review",
		title:   "Review",
		icon:    "fa-clipboard-check",
		isFinal: true,
		body:    `<p>Read it over. Is anything missing? Add it. Is anything no longer needed? Cut it. It'll never be perfect, and that's fine: if anyone even notices, you can fix it during play.</p>
				<p>Its card lives at the foot of the GM Toolkit's Expeditions tab. Drag it onto a scene to pin it to the map, and edit it any time.</p>`,
	},
];

// Every pick control on the "Theme" step speaks the same language — a list of combined values
// against a list of table rows — so the manner's tables and the region's terrain share one set of
// handlers rather than two that can drift. Terrain is addressed by this reserved key, which no
// table key can collide with (site-tables.test.js says so).
export const TERRAIN_KEY = "#terrain";

/**
 * How a combinable table's limit reads beside its die, in the book's own two phrasings.
 *
 * HERE and not in `data/site-tables.js`, which is otherwise a faithful transcription of the
 * book's tables: how many answers a table takes is a fact about the table (`combineMax`), but
 * how that limit is WORDED on screen is this dialog's business. Keeping the two apart is what
 * lets the note strings say `combine: 3` and leave the phrasing to whoever is painting it.
 */
const combineHint = (max) => (max <= 1 ? "" : max === 2 ? "pick 1, or combine 2" : `pick or roll 1 to ${max}`);

// The free-text scalar fields the generic [data-field] change handler may persist onto
// `_sel`; list-row fields are captured by their own classed handlers.
const _TEXT_FIELDS = new Set(["name", "why", "description"]);

// Which lists exist and what keys their rows hold is site-schema.js's to say — the shaper and the
// card view-model read the same table, which is what makes "collected on the wizard" and "saved to
// the page" one fact instead of three that can disagree.

// The paired lists' field CHROME: which control each key gets, what it suggests, and any class it
// carries. Keyed by list, then by the key names the schema declares — a key added there and missed
// here still renders, as a plain single-line field, rather than not rendering at all.
//
// Here rather than in the template because the row markup is a loop over these: a fixed keyA/keyB
// pair of hash arguments could not serve areas' four keys, and quietly dropped everything past the
// second while the schema went on advertising them.
// `inline` puts every field of a row on ONE control row (the timeline: a date and what happened,
// which read as one line); the default stacks the first field with the delete button and indents
// the rest under it. `rowClass` is the wrapper each row gets.
const _PAIR_FIELDS = {
	questions: {
		rowClass: "stonetop-cs-pair-row",
		fields: {
			prompt: { placeholder: "Why didn't the Fae gut the tomb during their uprising?" },
			answer: { placeholder: "The inner vault is guarded by powerful, loyal Fae…", cls: "stonetop-cs-answer" },
		},
	},
	timeline: {
		inline: true,
		fields: {
			when: { placeholder: "Last autumn", cls: "stonetop-cs-when" },
			text: { placeholder: "Sajra arrives with crinwin thralls in tow; Thornthumb is made to stay away" },
		},
	},
	denizens: {
		rowClass: "stonetop-cs-pair-row",
		fields: {
			name:  { placeholder: '"Trusted" crinwin' },
			notes: { placeholder: "Nest inside, lord over the others, jealous of the kids, mimic Sajra's voice", cls: "stonetop-cs-answer" },
		},
	},
	areas: {
		rowClass: "stonetop-cs-area",
		fields: {
			title:       { placeholder: "Entrance chamber (A)", cls: "stonetop-cs-area-title" },
			description: { placeholder: "Dimly lit from outside. Soil and debris piled nearly 4 feet high at the entrance, sloping down into the room. Beyond, the floor is filthy, muddy…", multiline: true, lines: 3 },
			contents:    { placeholder: "Contents: who's here, what they're doing, dangers, discoveries, questions to ask the PCs…", multiline: true, lines: 2 },
			exits:       { placeholder: "Exits: outside (north), collapsed hallway (B), central chamber (C)" },
		},
	},
};

// Every hash argument the list partials read. Handlebars MERGES a partial's hash into the enclosing
// context, so any of these left sitting on the dialog's own context would be inherited by every
// list that was not passed one — silently handing the denizens the questions' suggestion chips.
// getData clears them rather than trusting nobody will ever add one.
const _PARTIAL_PARAMS = ["list", "label", "hint", "chips", "kinds", "rows", "cells", "addLabel",
	"placeholder", "rowClass", "frameClass", "inline"];

// The review step's tally, in step order, and which shaped lists each line counts. Two of the
// wizard's lists share a line (the two impression lists read as one "Impressions"), so this cannot
// simply be the schema's keys — but it IS checked against them, in _previewCard, so a list added to
// the site and left out here says so instead of quietly going uncounted on the step whose whole job
// is to tell the GM what they have.
const _COUNT_GROUPS = [
	["Connections",  ["connections"]],
	["Questions",    ["questions"]],
	["Timeline",     ["timeline"]],
	["Denizens",     ["denizens"]],
	["Dangers",      ["dangers"]],
	["Discoveries",  ["discoveries"]],
	["Impressions",  ["outside", "inside"]],
	["Areas",        ["areas"]],
	["Plans",        ["plans"]],
	["Tables",       ["randomTables"]],
];

// `picks` is a list too, but the review card prints it in full a few lines up rather than counting
// it, so it is the one list the coverage check below expects to be absent.
const _UNCOUNTED = new Set(["picks"]);

/**
 * The review step's "what you have" tally, and the check that it is telling the whole truth.
 *
 * Exported for the tests: the point of the check is that adding a list to the site without adding
 * it here is caught, and a warning nobody asserts on is a warning nobody notices.
 *
 * @param {object} shaped  shapeSiteSystem's output
 * @returns {{label: string, n: number}[]}  non-empty lines, in step order
 */
export function _countLines(shaped = {}) {
	const counted = new Set(_COUNT_GROUPS.flatMap(([, keys]) => keys));
	const missed = Object.keys(shaped)
		.filter(k => Array.isArray(shaped[k]) && !counted.has(k) && !_UNCOUNTED.has(k));
	if (missed.length) console.warn(`Stonetop | the site review step is not counting: ${missed.join(", ")}`);
	return _COUNT_GROUPS
		.map(([label, keys]) => ({ label, n: keys.reduce((n, k) => n + (shaped[k]?.length ?? 0), 0) }))
		.filter(c => c.n > 0);
}

/** A blank row for a list, so add-a-row and seeding agree on the shape. */
function blankRow(list) {
	const keys = pairKeys(list);
	return keys ? Object.fromEntries(keys.map(k => [k, ""])) : "";
}

export class CreateSiteDialog extends SaveForNow(StepperDialog) {
	/** @param {{ page?: JournalEntryPage|null }} [config] pass a site page to edit it in place. */
	constructor({ page = null, quietSave = false } = {}, options = {}) {
		// Editing gets a per-page window id so two sites can be open side by side; creation
		// keeps the fixed id (one "Create a Site" at a time).
		super(page ? foundry.utils.mergeObject({ id: `stonetop-create-site-${page.id}` }, options) : options);
		this._page = page;
		// The caller announces a saved site itself (the content picker), so Save for now doesn't.
		this._quietSave = quietSave;
		this._sel = page ? this._seedFromPage(page) : {
			name: "", why: "", description: "",
			manner: "", picks: {}, regionId: "", terrain: [], regionPicks: {},
			connections: [], questions: [], timeline: [],
			denizens: [], dangers: [], discoveries: [],
			outside: [], inside: [],
			areas: [], plans: [], randomTables: [],
		};
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-create-site",
			template:  "systems/stonetop-pwd/templates/dialogs/create-site.hbs",
			// Wide enough that the 168px jump-to-step rail sits beside the content column
			// rather than eating into it (the same reason Create a Follower is 728).
			width:     760,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-create-site-dialog"],
		});
	}

	get title() { return this._page ? `Site: ${this._page.name}` : "Create a Site"; }

	get _steps() { return _STEPS; }
	get _autoHeight() { return true; }

	// Working state seeded from an existing page (edit mode). The stored picks are ordered
	// label/value pairs; the wizard keys them by table, so they're matched back by label
	// against the manner's own tables (a pick whose table has since gone is dropped).
	_seedFromPage(page) {
		const sys = page.system ?? {};
		const manner = siteManner(sys.manner ?? "");
		const reg = region(String(sys.regionId ?? ""));
		// Each answer comes back in its row's CURRENT wording, so a page saved before a row was
		// reworded (the roll-again instructions that moved off the text) re-opens on that row
		// rather than on an empty control. An answer no row carries is kept exactly as written.
		const current = (rows, value) => splitCombined(value).map(v => currentPickText(rows, v));
		const picks = {};
		const regionPicks = {};
		for (const p of sys.picks ?? []) {
			const key = String(p?.key ?? "");
			// A region's further table (the Ruined Tower's building and purpose).
			if (key.startsWith(REGION_TABLE_PREFIX)) {
				const sub = reg?.tables?.find(t => REGION_TABLE_PREFIX + t.key === key);
				if (sub) regionPicks[sub.key] = current(sub.rows, p?.value);
				continue;
			}
			// Match on the table's id; fall back to its label for a page written before picks
			// carried a key. A pick whose table has since gone is dropped.
			const table = manner?.tables.find(t => t.key === p?.key) ?? manner?.tables.find(t => t.label === p?.label);
			// Split back into the rows combined into it, so each lands in its own field.
			if (table) picks[table.key] = current(table.rows, p?.value);
		}
		// Read back UNTRIMMED and with blank rows kept: this is the editor re-opening, so a row the
		// GM half-filled is theirs to finish, not ours to drop. The shaper applies that rule once,
		// on the way out.
		const pairs = (arr, keys) => (Array.isArray(arr) ? arr : [])
			.map(row => Object.fromEntries(keys.map(k => [k, String(row?.[k] ?? "")])));
		// Both families are seeded FROM the schema rather than re-listed here. A list added to it
		// but forgotten in this method was collected on the wizard, saved to the page, and then
		// silently dropped the next time the site was opened to edit.
		return {
			name: page.name ?? "",
			why: String(sys.why ?? ""),
			description: String(sys.description ?? ""),
			manner: manner?.id ?? "",
			picks,
			regionId: String(sys.regionId ?? ""),
			terrain: reg ? current(reg.terrain.rows, sys.terrain) : splitCombined(sys.terrain),
			regionPicks,
			...Object.fromEntries(SITE_LINE_LISTS.map(list => [list, [...(sys[list] ?? [])].map(String)])),
			...Object.fromEntries(Object.entries(SITE_PAIR_LISTS).map(([list, { keys }]) => [list, pairs(sys[list], keys)])),
			// Held as ranged rows while editing ({text, span}); expanded back to one row per
			// face in _seed. See tableRowRanges.
			randomTables: (sys.randomTables ?? []).map(t => ({
				caption: String(t?.caption ?? ""),
				rows: tableRowRanges(t?.rows, { maxSpan: MAX_ROW_SPAN }).map(({ text, span }) => ({ text, span })),
			})),
		};
	}

	/** The chosen manner object, or null. */
	get _manner() { return siteManner(this._sel.manner); }

	getData() {
		const nav  = this._stepNav();
		const step = nav.step;
		const sel  = this._sel;
		const ctx  = { ...nav, sel, isEdit: !!this._page };

		if (step.key === "foundation") {
			ctx.storyQuestions = SITE_STORY_QUESTIONS;
		}
		if (step.key === "manner") {
			ctx.manners = SITE_MANNERS.map(m => ({ id: m.id, label: m.label, selected: m.id === sel.manner }));
			const manner = this._manner;
			ctx.mannerHint = manner?.hint ?? "";
			ctx.mannerPage = manner?.page ?? "";
			// Only the tables of the branch actually taken (lingering signs vs a ruin, a
			// barrow vs a reclaimed Maker-ruin) are offered.
			ctx.tables = manner ? visibleTables(manner, sel.picks)
				.map(t => ({ note: t.note ?? "", ...this._pickSlots(t.key) })) : [];
			ctx.regions = REGIONS.map(r => ({ id: r.id, label: r.label, selected: r.id === sel.regionId }));
			const chosenRegion = region(sel.regionId);
			ctx.regionNote = chosenRegion?.note ?? "";
			ctx.regionPage = chosenRegion?.page ?? "";
			ctx.terrainPick = this._pickSlots(TERRAIN_KEY);
			// The further tables a terrain answer has opened (the Ruined Tower's building, then its
			// purpose), through the same controls under their own reserved keys.
			ctx.terrainTables = regionTables(chosenRegion, sel.terrain, sel.regionPicks)
				.map(t => ({ note: t.note ?? "", ...this._pickSlots(REGION_TABLE_PREFIX + t.key) }));
		}
		if (step.key === "story") {
			ctx.connectionRows = this._lineRows("connections");
			ctx.connectionChips = this._lineChips("connections", SITE_CONNECTIONS);
			ctx.questionRows = this._pairRows("questions");
			ctx.questionChips = this._pairChips("questions", SITE_QUESTION_PROMPTS);
		}
		if (step.key === "timeline") {
			ctx.timelineRows = this._pairRows("timeline");
		}
		if (step.key === "contents") {
			ctx.denizenRows = this._pairRows("denizens");
			ctx.dangerRows = this._lineRows("dangers");
			ctx.discoveryRows = this._lineRows("discoveries");
			ctx.dangerKinds = SITE_DANGER_KINDS;
			ctx.discoveryKinds = SITE_DISCOVERY_KINDS;
		}
		if (step.key === "environment") {
			ctx.outsideRows = this._lineRows("outside");
			ctx.insideRows = this._lineRows("inside");
		}
		if (step.key === "areas") {
			ctx.areaRows = this._pairRows("areas");
			ctx.areaPrompts = AREA_DETAIL_PROMPTS;
			ctx.layoutTips = SITE_LAYOUT_TIPS;
		}
		if (step.key === "plans") {
			ctx.planRows = this._lineRows("plans");
			ctx.maxRowSpan = MAX_ROW_SPAN;
			ctx.tableRows = sel.randomTables.map((t, index) => {
				// The faces each row covers, as the card will number them ("1-3", "4").
				const rows = numberTableRows(t.rows.map((row, rowIndex) => ({ rowIndex, text: row.text, span: clampRowSpan(row.span) })));
				const faces = rows.at(-1)?.to ?? 0;
				return { index, caption: t.caption, die: faces ? `1d${faces}` : "", rows };
			});
		}
		if (step.isFinal) {
			ctx.preview = this._previewCard();
			ctx.reviewChecks = SITE_REVIEW_CHECKS;
		}
		// Nothing above may leave a bare partial parameter on the context; see _PARTIAL_PARAMS.
		for (const name of _PARTIAL_PARAMS) {
			if (name in ctx) {
				console.error(`Stonetop | create-site context carries "${name}", which every list partial would inherit as its own; dropping it.`);
				delete ctx[name];
			}
		}
		return ctx;
	}

	/**
	 * The list of rows combined into one pick, and the row pool + label chrome its controls need.
	 * Returns null for a control that isn't on screen (a table of an untaken branch, terrain with
	 * no region chosen yet). `set` writes the list back, so callers never need to know whether a
	 * pick lives in `_sel.picks` or in `_sel.terrain`.
	 *
	 * TERRAIN IS AN ORDINARY TABLE HERE. It reads its die, its label and how many answers it takes
	 * off the row in `REGIONS`, exactly as a manner's tables do off `siteManner`. This used to
	 * substitute those three literals in code behind a `key === TERRAIN_KEY` branch, which meant a
	 * region whose terrain table was not 1d12, or a change to what it combines, was a code change
	 * rather than a data one. The reserved key now says only WHICH SLOT the answer is stored in,
	 * which is the one thing about terrain that really is different.
	 */
	_pickTarget(key) {
		if (String(key).startsWith(REGION_TABLE_PREFIX)) return this._regionTarget(key);
		const terrain = key === TERRAIN_KEY;
		const table = terrain ? region(this._sel.regionId)?.terrain : this._manner?.tables.find(t => t.key === key);
		if (!table) return null;
		// Seeded from a page written before a pick could be combined, it is still a string.
		const cur = terrain ? this._sel.terrain : this._sel.picks[key];
		return {
			key, table, rows: table.rows, combine: combineMax(table), label: table.label, die: table.die,
			values: Array.isArray(cur) ? cur : splitCombined(cur),
			set: terrain ? (v) => { this._sel.terrain = v; } : (v) => { this._sel.picks[key] = v; },
		};
	}

	/** `_pickTarget` for one of the region's further tables, or null while it is not open. */
	_regionTarget(key) {
		const sub = String(key).slice(REGION_TABLE_PREFIX.length);
		const picks = (this._sel.regionPicks ??= {});
		const table = regionTables(region(this._sel.regionId), this._sel.terrain, picks).find(t => t.key === sub);
		if (!table) return null;
		return {
			key, table, rows: table.rows, combine: combineMax(table), label: table.label, die: table.die,
			values: Array.isArray(picks[sub]) ? picks[sub] : splitCombined(picks[sub]),
			set: (v) => { picks[sub] = v; },
		};
	}

	/**
	 * One pick's controls: a field for the row chosen, then one more for each row combined into it.
	 *
	 * The roll NUMBER is deliberately absent from the options. It is the table's own bookkeeping,
	 * not part of the answer, and printing it in front of every result made the control read as a
	 * transcription of the book rather than as a choice.
	 *
	 * How many extras a pick may hold is the chosen row's business: a row carrying "and roll 1d8
	 * again" asks for one more (or two, for the "roll twice" rows) off that sub-die, and a table
	 * the book says to take several of ("pick 1, or combine 2", "pick or roll 1 to 3") allows that
	 * many freely. Each rides on its own control, with its own roll button, so the GM can re-roll
	 * or re-pick just the one.
	 */
	_pickSlots(key) {
		const target = this._pickTarget(key);
		if (!target) return { key, slots: [], canAdd: false };
		const { rows, table, combine, values, label, die } = target;
		// The row's own sub-die rolls AND the table's free combines; see `maxExtraPicks` for why
		// those add rather than compete.
		const maxExtras = maxExtraPicks(table, rows, values);
		// An answer no row carries (reworded since it was saved, or written in by hand) is offered
		// as it stands and kept selected. A select with nothing selected reads as unanswered while
		// the answer rides along unseen, and picking anything at all would silently replace it.
		const options = (list, value) => {
			const out = list.map(r => ({ text: r.text, selected: r.text === value }));
			if (value && !out.some(o => o.selected)) out.push({ text: value, selected: true });
			return out;
		};
		const hint = combineHint(combine);
		const slots = [{
			key, slot: 0, label,
			hint: hint ? `${die} (${hint})` : die,
			rollTip: `Roll ${die}`,
			rows: options(rows, values[0] ?? ""),
		}];
		for (let i = 1; i < values.length; i++) {
			slots.push({
				key, slot: i, extra: true, label: "combined with", hint: "", rollTip: "Roll again",
				// The sub-die of the row that owns THIS slot, or the whole table for a free combine.
				rows: options(slotPool(rows, values, i), values[i]),
			});
		}
		// `label`, `die` and `combine` are NOT republished here. Everything a slot needs rides on
		// the slot — the partial says so in its own header, and reading them off the table would
		// need a `../` chain whose depth depends on how the partial was called. Leaving them off
		// also gives this function ONE shape, matching the early return above.
		return { key, slots, canAdd: !!values[0] && values.length - 1 < maxExtras };
	}

	/** {index, list, text} rows for a string list. `list` rides along for the reason _pairRows gives. */
	_lineRows(list) {
		return this._sel[list].map((text, index) => ({ index, list, text }));
	}

	/** Suggestion chips for a string list, marked when the list already carries one. */
	_lineChips(list, prompts = []) {
		return prompts.map(text => ({ list, text, used: this._sel[list].includes(text) }));
	}

	/**
	 * Rows for a paired list, as `{index, cells}` — one cell per key the schema declares, in the
	 * order it declares them. The template loops the cells rather than naming two fields, so the
	 * four-key areas list and the two-key ones render through the same block.
	 */
	_pairRows(list) {
		const ui = _PAIR_FIELDS[list] ?? {};
		const chrome = ui.fields ?? {};
		const keys = pairKeys(list) ?? [];
		// `list` and `index` ride on the ROWS and on the CELLS rather than being walked back to
		// with `../`. Inside a partial's block the hash arguments have pushed a frame, so the
		// depth a `../` chain lands on depends on how the partial was called — and getting it
		// wrong fails by reading undefined, which is a `data-list=""` that no handler matches.
		return this._sel[list].map((row, index) => ({
			index,
			list,
			rowClass: ui.rowClass ?? "",
			inline: !!ui.inline,
			cells: keys.map((key, i) => ({
				list,
				index,
				key,
				first: i === 0,
				value: row?.[key] ?? "",
				placeholder: chrome[key]?.placeholder ?? "",
				cls: chrome[key]?.cls ?? "",
				multiline: !!chrome[key]?.multiline,
				// `lines`, not `rows`: a cell sits inside the partial's own `rows` loop, and a
				// second meaning of that name on the inner context is a trap for no gain.
				lines: chrome[key]?.lines ?? 3,
			})),
		}));
	}

	/**
	 * Suggestion chips for a paired list, marked when the list already carries one.
	 *
	 * The chip's "already added" state and the click handler's "add it once" guard are the same
	 * question, so they read the same key — the list's FIRST, whatever it is called. Asking for a
	 * hardcoded `prompt` made both correct for questions alone: on any other list the chip never
	 * lit up and every click appended another row.
	 */
	_pairChips(list, prompts = []) {
		const [first] = pairKeys(list) ?? [];
		return prompts.map(text => ({ list, text, used: this._sel[list].some(r => r?.[first] === text) }));
	}

	// A compact summary of the site-to-be, shown on the final step.
	_previewCard() {
		const sel = this._sel;
		// Counted off the SHAPER's output rather than off `_sel` with a second set of filters.
		// The shaper decides what actually gets saved — it keeps an area that has only contents or
		// exits, and a table that has only a caption — so any other reckoning of "empty" tells the
		// GM they have nothing where they in fact have something, which is how work written in one
		// step gets thrown away in the next. One rule, the same one `_seed` points at.
		const shaped = shapeSiteSystem(this._seed());
		const foundation = [shaped.mannerLabel, shaped.regionLabel, shaped.terrain].filter(Boolean);
		return {
			name:        sel.name.trim() || "Unnamed site",
			foundation,
			why:         shaped.why,
			description: shaped.description.trim(),
			picks:       this._pickLines(),
			counts:      _countLines(shaped),
			areas: shaped.areas.map(a => a.title).filter(Boolean),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._bindStepNav(html);

		html.find(".stonetop-cs-create").on("click", () => this._finish());
		html.find(".stonetop-guide-save-for-now").on("click", () => this._saveForNow());

		// Scalar text fields persist on blur (no re-render, so focus survives typing).
		html.find("[data-field]").on("change", ev => {
			const el = ev.currentTarget;
			if (_TEXT_FIELDS.has(el.dataset.field)) this._sel[el.dataset.field] = el.value;
		});

		// ── Manner + its tables ──────────────────────────────────────────────
		// Changing the manner drops the old picks: they belong to the old entry's tables.
		html.find(".stonetop-cs-manner").on("change", ev => {
			this._sel.manner = ev.currentTarget.value;
			this._sel.picks = {};
			this.render(false);
		});
		// A pick can open or close a branch, so every pick re-renders.
		html.find(".stonetop-cs-pick").on("change", ev => {
			const { key, slot } = ev.currentTarget.dataset;
			this._setPick(key, Number(slot), ev.currentTarget.value);
			this.render(false);
		});
		html.find(".stonetop-cs-roll").on("click", ev => {
			const { key, slot } = ev.currentTarget.dataset;
			this._rollPick(key, Number(slot));
			this.render(false);
		});
		// "Pick 1, or combine 2": an empty second field to answer by hand or roll.
		html.find(".stonetop-cs-combine").on("click", ev => {
			const target = this._pickTarget(ev.currentTarget.dataset.key);
			if (!target) return;
			target.set([...target.values, ""]);
			this.render(false);
		});
		html.find(".stonetop-cs-uncombine").on("click", ev => {
			const { key, slot } = ev.currentTarget.dataset;
			const target = this._pickTarget(key);
			if (!target) return;
			const next = [...target.values];
			next.splice(Number(slot), 1);
			target.set(next);
			this.render(false);
		});
		html.find(".stonetop-cs-roll-all").on("click", () => {
			this._rollAll();
			this.render(false);
		});

		// ── Region + terrain ─────────────────────────────────────────────────
		html.find(".stonetop-cs-region").on("change", ev => {
			this._sel.regionId = ev.currentTarget.value;
			this._sel.terrain = [];
			this._sel.regionPicks = {};
			this.render(false);
		});
		// Terrain has no handlers of its own: its controls carry TERRAIN_KEY and go through the
		// pick handlers above, which is what keeps "and roll 1d10 again" working on a terrain row.

		// ── Row lists (add / remove / suggest) ───────────────────────────────
		html.find(".stonetop-cs-add").on("click", ev => {
			this._captureLiveFields();
			const list = ev.currentTarget.dataset.list;
			this._sel[list].push(blankRow(list));
			this.render(false);
		});
		html.find(".stonetop-cs-remove").on("click", ev => {
			this._captureLiveFields();
			const { list, index } = ev.currentTarget.dataset;
			this._sel[list].splice(Number(index), 1);
			this.render(false);
		});
		// A suggestion chip appends the book's own prompt as a new row (once).
		html.find(".stonetop-cs-suggest").on("click", ev => {
			this._captureLiveFields();
			const { list, text } = ev.currentTarget.dataset;
			const [first] = pairKeys(list) ?? [];
			if (first) {
				// Read and written through the same key, so the guard holds for every paired list
				// rather than only the one whose first key happens to be called "prompt".
				if (!this._sel[list].some(r => r?.[first] === text)) {
					this._sel[list].push({ ...blankRow(list), [first]: text });
				}
			} else if (!this._sel[list].includes(text)) {
				this._sel[list].push(text);
			}
			this.render(false);
		});

		// ── Random tables ────────────────────────────────────────────────────
		html.find(".stonetop-cs-table-add").on("click", () => {
			this._captureLiveFields();
			this._sel.randomTables.push({ caption: "", rows: [{ text: "", span: 1 }] });
			this.render(false);
		});
		html.find(".stonetop-cs-table-remove").on("click", ev => {
			this._captureLiveFields();
			this._sel.randomTables.splice(Number(ev.currentTarget.dataset.index), 1);
			this.render(false);
		});
		html.find(".stonetop-cs-trow-add").on("click", ev => {
			this._captureLiveFields();
			this._sel.randomTables[Number(ev.currentTarget.dataset.table)]?.rows.push({ text: "", span: 1 });
			this.render(false);
		});
		html.find(".stonetop-cs-trow-remove").on("click", ev => {
			this._captureLiveFields();
			const { table, index } = ev.currentTarget.dataset;
			this._sel.randomTables[Number(table)]?.rows.splice(Number(index), 1);
			this.render(false);
		});
	}

	/**
	 * Set (or clear) one field of one pick, then drop the picks of a branch that just closed.
	 *
	 * Changing the row a pick was made on clears whatever was combined into it — the extras belong
	 * to the row that asked for them, and a leftover from a wider sub-die is not even offered by
	 * the new one — and then follows that row's own "and roll 1d8 again" instruction, which is the
	 * whole reason the instruction is no longer printed in the result.
	 *
	 * A COMBINED SLOT FOLLOWS THAT INSTRUCTION TOO, and it used to be dropped there. The extra
	 * slots are offered from the same table (the whole of it, whenever the first pick asked for no
	 * sub-die), so the GM can perfectly well combine in a row that itself says "and roll 1d8
	 * again" — and since the wording was taken out of the row text on purpose, nothing rolled it
	 * and nothing said so. Re-picking such a slot drops only what THAT row brought with it
	 * (`claimedAfter`); a row combined freely off the table's own budget is the GM's choice and is
	 * not this row's to throw away.
	 */
	_setPick(key, slot, value) {
		const target = this._pickTarget(key);
		if (!target) return;
		const { rows, values } = target;
		if (slot === 0 && !value) { target.set([]); this._dropOrphanPicks(); return; }

		let next;
		if (slot === 0 && value !== values[0]) {
			next = [value, ...this._againRolls(rows, value)];
		} else if (slot > 0 && value !== values[slot]) {
			next = [...values];
			next.splice(slot, 1 + claimedAfter(rows, values, slot), value, ...this._againRolls(rows, value));
		} else {
			next = [...values];
			next[slot] = value;
		}
		target.set(next);
		this._dropOrphanPicks();
	}

	/** What a chosen row's own "and roll 1d8 again" asks for, rolled on the sub-die it names. */
	_againRolls(rows, value) {
		const row = findRow(rows, value);
		const spec = againSpec(row);
		if (!spec) return [];
		const pool = againPool(rows, row);
		return Array.from({ length: spec.count }, () => rollOnTable(pool)?.text ?? "");
	}

	/**
	 * Roll one field of one pick: the whole table for the pick itself, and for an extra the sub-die
	 * of the row that owns that slot (or the whole table, for a slot combined in freely).
	 */
	_rollPick(key, slot, rng = Math.random) {
		const target = this._pickTarget(key);
		if (!target) return;
		const { rows, values } = target;
		const pool = slot === 0 ? rows : slotPool(rows, values, slot);
		this._setPick(key, slot, rollOnTable(pool, rng)?.text ?? "");
	}

	/**
	 * Roll every table of the manner, in order, so a branch table's result opens the right branch
	 * before its own tables are rolled.
	 *
	 * A table the book makes conditional (`conditional`: a haunted site's feature, which you skip
	 * once the place is established; its cause of death, only if the origins involved deaths; a
	 * cave's natural beast, only if one dwells there) is left for the GM to roll on its own.
	 */
	_rollAll(rng = Math.random) {
		const manner = this._manner;
		if (!manner) return;
		this._sel.picks = {};
		// Bounded by the table count: each pass rolls the first not-yet-picked visible
		// table, which is how a branch opened mid-way still gets filled.
		for (let i = 0; i < manner.tables.length; i++) {
			const next = visibleTables(manner, this._sel.picks)
				.find(t => !t.conditional && !splitCombined(this._sel.picks[t.key]).length);
			if (!next) break;
			// Through _setPick, so a rolled "and roll again" row is followed up here too.
			this._setPick(next.key, 0, rollOnTable(next.rows, rng)?.text ?? "");
		}
	}

	/**
	 * A branch pick that changed leaves the other branch's answers orphaned; drop any pick whose
	 * table is no longer visible so it can't ride along into the write-up. The same for a region's
	 * further tables, once the terrain or building row that opened them is gone.
	 */
	_dropOrphanPicks() {
		const manner = this._manner;
		if (manner) {
			const visible = new Set(visibleTables(manner, this._sel.picks).map(t => t.key));
			for (const k of Object.keys(this._sel.picks)) if (!visible.has(k)) delete this._sel.picks[k];
		}
		const picks = this._sel.regionPicks;
		if (picks) {
			const open = new Set(regionTables(region(this._sel.regionId), this._sel.terrain, picks).map(t => t.key));
			for (const k of Object.keys(picks)) if (!open.has(k)) delete picks[k];
		}
	}

	// Capture any focused-but-unblurred field before leaving the step (Back/Next/jump) or
	// mutating a row list, so a just-typed value isn't lost. Row inputs deliberately have
	// no per-keystroke handler (that would re-render and steal focus), so this is the only
	// thing that reads them back.
	_onBeforeStepChange() {
		this._captureLiveFields();
	}

	// Save for now and the close-guard's question (dialogs/save-for-now.js).
	get _saveCopy() {
		return { noun: "site", keptAt: "at the foot of the GM Toolkit's Expeditions tab" };
	}

	_captureLiveFields() {
		const root = this.element?.[0];
		if (!root) return;
		root.querySelectorAll("[data-field]").forEach(el => {
			if (_TEXT_FIELDS.has(el.dataset.field)) this._sel[el.dataset.field] = el.value;
		});
		// Plain string rows: <input class="stonetop-cs-line" data-list data-index>
		for (const list of SITE_LINE_LISTS) {
			this._captureRowInputs(root, `.stonetop-cs-line[data-list="${list}"]`, this._sel[list]);
		}
		// Paired rows, areas among them: <input|textarea class="stonetop-cs-pair" data-list
		// data-index data-key>. One sweep for every key of every paired list, because the key is
		// on the element rather than implied by which list it belongs to.
		root.querySelectorAll(".stonetop-cs-pair").forEach(el => {
			const row = this._sel[el.dataset.list]?.[Number(el.dataset.index)];
			if (row && el.dataset.key in row) row[el.dataset.key] = el.value;
		});
		// Random tables: caption + rows.
		root.querySelectorAll(".stonetop-cs-table-caption").forEach(el => {
			const t = this._sel.randomTables[Number(el.dataset.index)];
			if (t) t.caption = el.value;
		});
		root.querySelectorAll(".stonetop-cs-trow").forEach(el => {
			const t = this._sel.randomTables[Number(el.dataset.table)];
			const i = Number(el.dataset.index);
			if (t && i in t.rows) t.rows[i].text = el.value;
		});
		// How many faces each row covers (a book row printed "1-3" covers three).
		root.querySelectorAll(".stonetop-cs-trow-span").forEach(el => {
			const t = this._sel.randomTables[Number(el.dataset.table)];
			const i = Number(el.dataset.index);
			if (t && i in t.rows) t.rows[i].span = clampRowSpan(el.value);
		});
	}

	/** Every table answer for the page: the manner's, then the region's further tables. */
	_pickLines() {
		const sel = this._sel;
		return [
			...pickLines(this._manner, sel.picks),
			...regionPickLines(region(sel.regionId), sel.terrain, sel.regionPicks ?? {}),
		];
	}

	// The collected seed, in the shape shapeSiteSystem / createSite expect. Blank rows are
	// left in place here and dropped by the shaper, so one rule decides what "empty" means.
	_seed() {
		const sel = this._sel;
		const manner = this._manner;
		return {
			...sel,
			// Only the DERIVED fields are named. Everything else is the collected value as it
			// stands, so a new list on the wizard reaches the seed by existing rather than by being
			// remembered here as well — which is how a field came to be collected and never saved.
			name:        sel.name.trim() || "New Site",
			manner:      manner?.id ?? "",
			mannerLabel: manner?.label ?? "",
			picks:       this._pickLines(),
			regionLabel: region(sel.regionId)?.label ?? "",
			terrain:     joinCombined(sel.terrain),
			// Back to one stored row per face of the die.
			randomTables: sel.randomTables.map(t => ({ caption: t.caption, rows: expandTableRows(t.rows) })),
		};
	}

	async _finish() {
		this._captureLiveFields();
		const seed = this._seed();
		if (this._page) {
			// Edit mode: apply in place. The name is the site's identity across the page and
			// its scene pins, so it routes through setSiteName.
			await this._page.update({ system: shapeSiteSystem(seed) });
			await setSiteName(this._page, seed.name);
			this._resolveWith(this._page);
		} else {
			this._resolveWith(seed);
		}
	}
}
