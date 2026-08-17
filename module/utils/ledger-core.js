/**
 * The parts of a changes ledger that have nothing to do with WHICH actor is being logged.
 *
 * Three ledgers write history — CharacterLedger, SteadingLedger, NpcLedger — and they differ
 * only in which paths they watch and how they phrase an entry. Everything else was the same
 * code three times: the value formatters, the run-merging engine, the noun parser, and an
 * ~18-line `append` that stamps ids/timestamps/users and trims to the cap. That last one had
 * already drifted (the NPC copy never got run merging), which is what a shared engine is for.
 *
 * Each ledger class keeps its own actor-type guard and its own default category, and calls
 * {@link appendLedgerEntries} for the rest.
 */
import { stripHtmlToText } from "./strings.js";
import { SYSTEM_ID } from "../system-id.js";

export const LEDGER_SCOPE = SYSTEM_ID;
export const LEDGER_KEY = "ledger";
/** Hard cap on stored entries. The ledger is a flag, so it cannot grow forever. */
export const LEDGER_MAX_ENTRIES = 300;

export const LEDGER_FLAG_PATH = `flags.${LEDGER_SCOPE}.${LEDGER_KEY}`;

/**
 * True when `path` addresses the ledger flag itself. Every diff skips these: writing the
 * ledger is what produces them, so logging them would have each entry log its own arrival.
 */
export function isLedgerPath(path) {
	return path === LEDGER_FLAG_PATH || String(path ?? "").startsWith(`${LEDGER_FLAG_PATH}.`);
}

/**
 * An incoming update path, restated in the CURRENT flag scope. A world written under the legacy
 * `flags.stonetop.` scope still sends paths in it, and every label table here is keyed by the
 * current one — an un-normalized path simply finds no label and the change is dropped, silently.
 *
 * The boundary every ledger funnels through, and therefore where the legacy scope is named. It
 * lives beside the tables it has to agree with rather than once per ledger: two identical copies
 * of a rename rule are two chances to rename only one.
 */
export function normalizeFlagPath(path) {
	return String(path ?? "").replace(/^flags\.stonetop\./, `flags.${LEDGER_SCOPE}.`);
}

/**
 * Read `path` off an actor, falling back to the legacy scope. The mirror of `normalizeFlagPath`
 * on the read side: a world that has not been migrated stores the value under `flags.stonetop.`,
 * so asking only the current scope returns undefined and the diff reports every field as newly
 * set. `undefined` (not null) is the miss, because a stored null is a real value.
 */
export function getActorProperty(actor, path) {
	const value = foundry.utils.getProperty(actor, path);
	if (value !== undefined) return value;
	if (String(path).startsWith(`flags.${LEDGER_SCOPE}.`)) {
		return foundry.utils.getProperty(actor, path.replace(`flags.${LEDGER_SCOPE}.`, "flags.stonetop."));
	}
	return undefined;
}

// ── Value formatting ────────────────────────────────────────────────────────

export function isBlank(v) {
	return v === undefined || v === null || v === "";
}

// Longest a single value may run inside a ledger action before it is elided. A rich-text
// field (a steading's Notes, a lore answer) can hold thousands of characters of HTML; pasting
// that whole blob into an action string made one entry unreadable and blew out the flag.
const VALUE_MAX_CHARS = 72;

/**
 * Shorten a value phrase to {@link VALUE_MAX_CHARS}, cutting on a word boundary when one is
 * reasonably close to the limit so the tail doesn't end mid-word.
 */
export function truncateValue(text, max = VALUE_MAX_CHARS) {
	const t = String(text ?? "").trim();
	if (t.length <= max) return t;
	const slice = t.slice(0, max);
	const lastSpace = slice.lastIndexOf(" ");
	return `${(lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

// Words that stay lowercase inside a prettified slug unless they lead the phrase, so
// "symbol-of-authority" reads "Symbol of Authority" rather than "Symbol Of Authority".
const _SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in",
	"nor", "of", "on", "or", "the", "to", "vs", "with"]);

export function formatValue(value) {
	if (isBlank(value)) return "blank";
	if (typeof value === "boolean") return value ? "on" : "off";
	if (Array.isArray(value)) return value.length ? truncateValue(value.join(", ")) : "none";
	if (typeof value === "object") return "changed";
	// Rich-text fields arrive as HTML; flatten to one line before measuring so the cap counts
	// readable characters rather than markup.
	return truncateValue(stripHtmlToText(String(value)) || String(value));
}

export function valuesEqual(a, b) {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
	return false;
}

export function actionForField(label, oldValue, newValue) {
	if (isBlank(oldValue)) return `${label} set to ${formatValue(newValue)}`;
	if (isBlank(newValue)) return `${label} cleared`;
	return `${label} changed from ${formatValue(oldValue)} to ${formatValue(newValue)}`;
}

export function coalesceEntries(entries) {
	const seen = new Set();
	return entries.filter(entry => {
		if (seen.has(entry.action)) return false;
		seen.add(entry.action);
		return true;
	});
}

export function prettifySlug(slug) {
	const parts = String(slug ?? "").split(/[-_:]/).filter(Boolean);
	if (!parts.length) return "Unknown";
	return parts
		.map((part, i) => (i > 0 && _SMALL_WORDS.has(part.toLowerCase()))
			? part.toLowerCase()
			: part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

// ── Run merging ─────────────────────────────────────────────────────────────
// A single player action often lands as a burst of separate actor.update calls: picking the
// four appearance lines, answering nine lore questions, clicking XP up three times, walking a
// character from level 1 to level 34. Each update is its own ledger entry, so the burst reads
// as dozens of near-identical lines and eats the entry cap.
//
// Entry builders can therefore attach a `merge` descriptor; append() folds adjacent entries
// that share one. Merging is deliberately conservative: same subject key, same causing move,
// same user, and within MERGE_WINDOW_MS — so tonight's "Level 5 → 6" never absorbs next
// week's "Level 6 → 7".
const MERGE_WINDOW_MS = 60_000;
// Ceiling on how many items one list run accumulates. The run descriptor is stored on the entry,
// so without a cap a long burst would keep growing the ledger flag.
const LIST_RUN_MAX_ITEMS = 24;

/** A "5 → 6 → 7 collapses to 5 → 7" run: consecutive changes to one numeric/scalar field. */
export function numericMerge(label, key, oldValue, newValue) {
	return { kind: "numeric", key, label, from: oldValue ?? null, to: newValue ?? null };
}

/** An "A, then B, then C collapses to A, B, C" run: repeated picks that accumulate into a list. */
export function listMerge(label, key, items) {
	return { kind: "list", key, label, items: [...items] };
}

/** A real number, as opposed to a boolean, a string, or a blank. */
const isNumericValue = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * One changed scalar field, as a ledger entry — with run-merging attached when the field holds a
 * NUMBER, so nudging HP 6 → 5 → 4 lands as one line rather than three.
 *
 * Whether a field merges is asked of its VALUE rather than looked up in a per-ledger allowlist.
 * The two allowlists this replaces were, on inspection, exactly the numeric-valued subset of each
 * ledger's label map (their omissions were the string `name` fields and the boolean debilities) —
 * so they were restating in a hand-kept list something the value already knows, once per ledger,
 * and the third ledger simply never got a list, which is why an NPC's HP walked down 6 → 5 → 4
 * still logged three lines.
 *
 * `old OR new` numeric, not both: first setting a blank HP to 5 is as mergeable as changing it,
 * and that is the behaviour the allowlists had (they keyed on the path, so the value's type at
 * the time never came into it).
 *
 * @param {string} label   the field's display name
 * @param {string} key     the path, which is what makes two entries part of the same run
 */
export function scalarEntry(label, oldValue, newValue, key) {
	const entry = { action: actionForField(label, oldValue, newValue) };
	if (isNumericValue(oldValue) || isNumericValue(newValue)) {
		entry.merge = numericMerge(label, key, oldValue, newValue);
	}
	return entry;
}

/**
 * "These two cancel out — drop the pair." Returned in place of an entry rather than stamped ONTO
 * one: every sibling key of a ledger entry is persisted to `flags.stonetop-pwd.ledger`, so a
 * marker field on a copy of a real entry is one missed `pop()` away from being written into world
 * data permanently, with nothing in the storage layer to object. A Symbol cannot survive that.
 */
const DROP_PAIR = Symbol("drop-pair");

/**
 * Fold `entry` into `previous` when the two form a run, returning the rewritten previous entry
 * (with a refreshed action string and timestamp), `DROP_PAIR` when they annihilate, or null when
 * they don't merge.
 */
function mergeInto(previous, entry) {
	const a = previous?.merge, b = entry?.merge;
	if (!a || !b || a.kind !== b.kind || a.key !== b.key) return null;
	if ((previous.move ?? null) !== (entry.move ?? null)) return null;
	if ((previous.userId ?? null) !== (entry.userId ?? null)) return null;
	if (Math.abs((entry.timestamp ?? 0) - (previous.timestamp ?? 0)) > MERGE_WINDOW_MS) return null;

	if (a.kind === "numeric") {
		// Only a contiguous run collapses: the previous entry must end where this one starts,
		// so 5→6 then 6→7 merges but 5→6 then 9→10 stays two entries.
		if (formatValue(a.to) !== formatValue(b.from)) return null;
		// A round trip (3 → 4 → 3) leaves the field where it started; drop the pair entirely
		// rather than logging a no-op "changed from 3 to 3".
		const merge = { ...a, to: b.to };
		if (formatValue(merge.from) === formatValue(merge.to)) return DROP_PAIR;
		return { ...previous, timestamp: entry.timestamp, merge, action: actionForField(a.label, merge.from, merge.to) };
	}

	if (a.kind === "list") {
		// The descriptor is persisted alongside the entry, so a run can't grow without bound.
		// Past the cap the run closes and the next entry starts a fresh one, which keeps every
		// change visible rather than silently swallowing it.
		if (a.items.length >= LIST_RUN_MAX_ITEMS) return null;
		const items = [...a.items];
		for (const item of b.items) if (!items.includes(item)) items.push(item);
		// The run already names everything this entry would add (the same trait picked onto a
		// second appearance line, say). Absorb it into the run rather than leaving a second,
		// word-for-word identical line behind.
		if (items.length === a.items.length) return previous;
		const merge = { ...a, items };
		return { ...previous, timestamp: entry.timestamp, merge, action: `${a.label} set to ${truncateValue(items.join(", "))}` };
	}

	return null;
}

/**
 * Fold runs across a newest-first slice of ledger entries.
 * @param {object[]} newestFirst entries in storage order (newest first)
 * @returns {object[]} the same slice with runs collapsed
 */
export function mergeRuns(newestFirst) {
	const out = [];
	// Walk oldest → newest so each entry folds into the run already accumulated before it.
	for (const entry of [...newestFirst].reverse()) {
		const previous = out[out.length - 1];
		const merged = previous ? mergeInto(previous, entry) : null;
		if (!merged) { out.push(entry); continue; }
		if (merged === DROP_PAIR) out.pop();
		else out[out.length - 1] = merged;
	}
	return out.reverse();
}

// ── Subject parsing ─────────────────────────────────────────────────────────

// Verb phrases that separate a change's subject (noun) from its detail. Ordered
// longest/most-specific first isn't required — we take the earliest match.
const LEDGER_VERB_MARKERS = [
	" changed from ",
	" renamed from ",
	" set to ",
	" cleared",
	" selected",
	" deselected",
	" marked",
	" unmarked",
	" completed",
	" learned",
	" removed",
	" added",
];

/**
 * Derive the "noun" (subject) of a ledger action string — the phrase before its
 * verb — so entries can be grouped and filtered. e.g. "HP changed from 5 to 3"
 * → "HP", "Longsword selected" → "Longsword", "Asset added: Wagon" → "Asset".
 * Falls back to the whole (trimmed) action when no known verb is present.
 */
export function ledgerNoun(action) {
	const text = String(action ?? "").trim();
	if (!text) return "";
	let cut = text.length;
	for (const marker of LEDGER_VERB_MARKERS) {
		const idx = text.indexOf(marker);
		if (idx >= 0 && idx < cut) cut = idx;
	}
	return text.slice(0, cut).trim() || text;
}

// ── Storage ─────────────────────────────────────────────────────────────────

/** Stored entries, newest first. */
export function getLedgerEntries(actor) {
	return actor?.getFlag?.(LEDGER_SCOPE, LEDGER_KEY) ?? [];
}

/**
 * One promise chain per actor, so two ledger writes for the same actor can never interleave.
 *
 * Both writers below are read-whole-array / write-whole-array, and they are driven from
 * StonetopActor#_onUpdate, which fires once per actor update. Several places deliberately fire
 * CONCURRENT updates on a single actor — CharacterArcana's `Promise.all` of three setFlags,
 * CharacterInventory.resetSelections' four unsetFlags. Each of those flag writes survives on its
 * own, because they touch different keys and the server merges them; but the ledger appends they
 * trigger all read the SAME stored array, and the last write back wins. Every entry but one was
 * dropped, and mergeRuns folding the head made the loss read as intended behaviour rather than
 * as a bug.
 *
 * Chaining rather than locking: the work runs only after the previous write for this actor has
 * RESOLVED, which is exactly the point at which `actor.getFlag` returns what that write stored.
 * Same shape as `ensurePackIndex`'s `_pending` chain in utils/pack-index.js.
 */
const _ledgerWrites = new Map();

function _serializeLedgerWrite(actor, work) {
	const key = actor?.id ?? actor?.uuid;
	// No identity to key a chain on (some test fakes): run unserialized rather than
	// funnelling every such actor through one shared chain.
	if (!key) return work();
	const prev = _ledgerWrites.get(key) ?? Promise.resolve();
	// `.then(work, work)` — a failed write must not stop the next one from being attempted.
	const run = prev.then(work, work);
	// The rejection belongs to the caller; the stored link is neutralised so one failed write
	// can't reject every write queued behind it.
	//
	// The tail drops the chain once it is idle. An entry is only needed while a write for that
	// actor is in flight; without this the map keeps one settled promise per actor id touched for
	// the life of the session, including actors since deleted. The identity check is what makes it
	// safe: a write queued behind this one has already replaced the value, and must stay.
	const link = run.then(() => {}, () => {}).then(() => {
		if (_ledgerWrites.get(key) === link) _ledgerWrites.delete(key);
	});
	_ledgerWrites.set(key, link);
	return run;
}

/**
 * Stamp `entries` with id / timestamp / user / category, fold any runs, and write the
 * result back trimmed to {@link LEDGER_MAX_ENTRIES}.
 *
 * Callers have already applied their own actor-type guard; this one only skips the write
 * when there is nothing to write.
 *
 * @param {Actor}  actor
 * @param {object[]} entries          `{action, move?, category?, merge?}` in the order they happened
 * @param {object}  [options]
 * @param {string}  [options.userId]           who made the change
 * @param {string}  [options.defaultCategory]  filter category for entries that don't stamp one
 */
export async function appendLedgerEntries(actor, entries, {
	userId = globalThis.game?.user?.id,
	defaultCategory = "other",
} = {}) {
	if (!actor || !entries?.length) return;
	const user = userId ? globalThis.game?.users?.get?.(userId) : null;
	// Reversed at the end: callers hand entries over in the order they happened, while both
	// storage and mergeRuns are newest-first. Without the flip a single update carrying several
	// entries was walked backwards — a list run accumulated its items in reverse ("Appearance
	// set to <4th>, <3rd>, …"), and the entry nearest the stored head was the one that happened
	// LAST, so a change that should have folded into the stored run found a sibling in the way.
	const stamped = entries.map(entry => ({
		id: globalThis.foundry?.utils?.randomID?.() ?? `${Date.now()}-${Math.random()}`,
		timestamp: Date.now(),
		userId: userId ?? null,
		userName: user?.name ?? globalThis.game?.user?.name ?? "Unknown",
		action: entry.action,
		// Name of the move that caused this change, when the change was a move's automated
		// effect (e.g. "+1 XP on a miss" → the rolled move). null for plain sheet edits.
		move: entry.move ?? null,
		// Filter category for the ledger dialog's grouped subject dropdown.
		category: entry.category ?? defaultCategory,
		// Run descriptor (see mergeRuns): present only on entries that can absorb a
		// following change to the same subject.
		...(entry.merge ? { merge: entry.merge } : {}),
	})).reverse();

	// Stamping happens above, OUTSIDE the queue, so `timestamp` records when the change
	// happened rather than when its turn to write came up. Only the read-merge-write below
	// has to be serialized.
	return _serializeLedgerWrite(actor, async () => {
		const current = getLedgerEntries(actor);

		// Fold runs across the new entries and the single newest stored entry, so a burst that
		// arrives as several updates (four appearance lines, a climb from level 1 to 34) lands
		// as one entry. Only the head is offered for merging — older history is never rewritten.
		const merged = mergeRuns(stamped.concat(current.slice(0, 1)));

		await actor.update({
			[LEDGER_FLAG_PATH]: merged.concat(current.slice(1)).slice(0, LEDGER_MAX_ENTRIES),
		}, { stonetopLedger: true, render: false });
	});
}

/** Drop the entries whose ids are in `ids`. */
export async function deleteLedgerEntries(actor, ids) {
	if (!actor || !ids?.size) return;
	// Same chain as the appends: a delete that read the array before a concurrent append wrote
	// it would put the appended entries straight back.
	return _serializeLedgerWrite(actor, async () => {
		const current = getLedgerEntries(actor);
		await actor.update({
			[LEDGER_FLAG_PATH]: current.filter(e => !ids.has(e.id)),
		}, { stonetopLedger: true });
	});
}
