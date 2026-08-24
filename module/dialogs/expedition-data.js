// ── Expedition walkthrough: Chart-a-Course / arriving-home checklists ───────────
// The authored requirement/challenge prompts (Chart a Course, Book I p.302–303) and
// the arriving-home questions (p.338). Kept free of Foundry globals so both
// ExpeditionDialog.js — which renders them as tickable checklists — and the
// Chronicle compiler (utils/chronicle-core.js), which resolves a ticked key back to
// its text for the expedition page, can import them. Mirrors introductions-data.js;
// keep this the single source so the dialog and the recorded journal agree.
//
// Item `text` is trusted authored HTML (entities, no tags); both consumers render it
// without escaping.

// Chart a Course requirements & challenges — the MENU a GM picks from, not a list the step
// prints. All twelve used to stand on the page at once with a tick beside each, which is
// twelve rows of mostly-unticked boxes on a step read as a to-do list; now each group offers
// its options through its own add button and the step shows only what was actually presented.
// `key` on a group is what an add button and a stored entry name it by; `addLabel` is what
// that button says and what titles the picker it opens.
export const CHART_GROUPS = [
	{
		key:      "requirements",
		label:    "Requirements",
		addLabel: "Add a requirement",
		empty:    "Nothing required of them yet.",
		items: [
			{ key: "firstTravel", text: "First travel to ___, and from there to your destination" },
			{ key: "waitUntil",   text: "Wait until ___ (season, daybreak, a sign)" },
			{ key: "guide",       text: "A knowledgeable guide / accurate map / detailed directions" },
			{ key: "days",        text: "It'll take at least ___ days (and a corresponding amount of supplies)" },
			{ key: "bring",       text: "You'll need to bring ___ (warm clothes, a cart, rope&hellip;)" },
		],
	},
	{
		key:      "challenges",
		label:    "Challenges",
		addLabel: "Add a challenge",
		empty:    "Nothing standing in their way yet.",
		items: [
			{ key: "watchOut",  text: "Watch out for ___" },
			{ key: "perilous",  text: "The way is perilous, plagued with danger" },
			{ key: "lost",      text: "You risk getting lost" },
			{ key: "surmount",  text: "You must surmount / cross / brave ___" },
			{ key: "terrain",   text: "The terrain is treacherous; you risk injury" },
			{ key: "grueling",  text: "The way is grueling; you risk exhausting yourselves / your resources" },
			{ key: "attention", text: "You risk drawing the attention of ___" },
		],
	},
];

// Arriving home — the questions to settle before the PCs walk back in. Prompts only:
// unlike CHART_GROUPS these are never ticked, so they carry no key for anything to
// resolve back.
export const HOME_GROUP = [
	{
		label: "Before they arrive, consider",
		items: [
			{ text: "How long have they been gone, and how has their absence been felt?" },
			{ text: "If they suffered casualties, who back home is most affected or upset?" },
			{ text: "What have folks back home been up to?" },
			{ text: "If they Requisitioned assets, how has that impacted the village?" },
			{ text: "Did any threats advance toward their dooms while they were away?" },
			{ text: "Are they Returning Triumphant, or could they, with some effort?" },
			{ text: "Could their return cause panic or reveal calamity (Meet With Disaster)?" },
		],
	},
];

// ── What a trip actually presented ────────────────────────────────────────────
// A trip's charted requirements and challenges are a LIST the GM adds to, stored at
// `chart.picked`. Each entry is:
//
//   { id, group, key, text, answer }
//
// `key` names one of the authored items above and `text` is then empty — the wording stays
// in this file, so a fix to a prompt reaches every trip that ever picked it. A line the GM
// wrote themselves carries `key: null` and its own `text`. `answer` is what they actually
// told the table, which is the half the old tick-only list threw away.
//
// Pure, and here rather than in the dialog, because the Chronicle compiler
// (utils/chronicle-core.js) has to read exactly the list the walkthrough drew — the same
// reason CHART_GROUPS itself lives in this file.

/** The authored item with this key, or null. Keys are unique across both groups. */
export function chartAuthoredItem(key) {
	for (const group of CHART_GROUPS) {
		const found = (group.items ?? []).find(it => it.key === key);
		if (found) return found;
	}
	return null;
}

/** Which group an authored key belongs to, or "" for one no group claims. */
export function chartGroupOf(key) {
	return CHART_GROUPS.find(g => (g.items ?? []).some(it => it.key === key))?.key ?? "";
}

/**
 * One stored entry in the shape above, or null for a row nothing can render.
 *
 * A stored `key` that no longer names an authored item is dropped rather than drawn blank:
 * the wording lives in this file, so there is nothing left to print for it.
 */
function normalizeChartEntry(raw, index) {
	if (!raw || typeof raw !== "object") return null;
	const key  = typeof raw.key === "string" && raw.key ? raw.key : null;
	const item = key ? chartAuthoredItem(key) : null;
	if (key && !item) return null;
	const text = key ? "" : String(raw.text ?? "").trim();
	if (!key && !text) return null;
	return {
		// The id is what a row's answer box and its trash button address it by. A row stored
		// without one (or derived from the legacy pair below) falls back to a stable stand-in
		// rather than a fresh random, which would change under the GM on every render.
		id:     typeof raw.id === "string" && raw.id ? raw.id : `chart-${index}`,
		group:  typeof raw.group === "string" && raw.group ? raw.group : chartGroupOf(key),
		key,
		text,
		answer: typeof raw.answer === "string" ? raw.answer : "",
		// Put here by plotting a route rather than chosen off the menu, which is what lets a
		// change of route take it back off again — see ExpeditionDialog `_carryToChart`. Carried
		// through normalization deliberately: dropped, every route-added row would read as the
		// GM's own the moment it was re-read, and nothing could ever clear it.
		fromRoute: !!raw.fromRoute,
	};
}

/**
 * What a trip presented, in the order it was added.
 *
 * LEGACY IN THE SAME BREATH. Before this was a list it was a pair of maps — `chart.checks`
 * (was it ticked?) and `chart.fills` (what was said), both keyed by authored key — and trips
 * logged then still carry them. A trip with no `picked` list is read out of that pair
 * instead, in the authored order, so an expedition charted under the old step opens under
 * the new one with every requirement it presented still on it and every word still under it.
 * The first edit writes the list and drops the pair (ExpeditionDialog `_mutateChart`).
 */
export function chartPicked(chart) {
	const stored = chart?.picked;
	if (Array.isArray(stored)) return stored.map(normalizeChartEntry).filter(Boolean);

	const checks = chart?.checks;
	const fills  = chart?.fills;
	if (!checks && !fills) return [];
	return CHART_GROUPS.flatMap(group => (group.items ?? [])
		.filter(it => checks?.[it.key])
		.map(it => ({
			id:     `legacy-${it.key}`,
			group:  group.key,
			key:    it.key,
			text:   "",
			answer: String(fills?.[it.key] ?? ""),
			// A tick carried no record of who made it, so an upgraded row is the GM's: the one
			// mistake worth avoiding here is silently un-presenting something they told the table.
			fromRoute: false,
		})));
}

/** The words of one entry: the authored prompt it names, or the line the GM wrote. */
export function chartEntryText(entry) {
	return entry?.key ? (chartAuthoredItem(entry.key)?.text ?? "") : (entry?.text ?? "");
}
