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
import { deletionEntry, isForcedDeletion, replacementEntry, serverNow } from "./foundry-compat.js";
import { SYSTEM_ID, isCutOver } from "../system-id.js";

export const LEDGER_SCOPE = SYSTEM_ID;
export const LEDGER_KEY = "ledger";
/** Hard cap on stored entries. The ledger is a flag, so it cannot grow forever. */
export const LEDGER_MAX_ENTRIES = 300;

export const LEDGER_FLAG_PATH = `flags.${LEDGER_SCOPE}.${LEDGER_KEY}`;

// Every write the ledger makes to its own flag carries `stonetopLedgerWrite: true` (beside the
// `stonetopLedger` kill switch, which other quiet writes share), so a hook can tell the ledger's
// bookkeeping, which nothing on a sheet draws, from a quiet change that is on the sheet.

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
	// A cut-over actor's active scope is authoritative on its own (system-id.js#isCutOver). The
	// migration leaves the old scope in place, so falling back there read a key the system had
	// since DELETED as still holding its pre-migration value.
	if (isCutOver(actor)) return undefined;
	if (String(path).startsWith(`flags.${LEDGER_SCOPE}.`)) {
		return foundry.utils.getProperty(actor, path.replace(`flags.${LEDGER_SCOPE}.`, "flags.stonetop."));
	}
	return undefined;
}

// ── Value formatting ────────────────────────────────────────────────────────

export function isBlank(v) {
	return v === undefined || v === null || v === "" || isForcedDeletion(v);
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

/**
 * A "5 → 6 → 7 collapses to 5 → 7" run: consecutive changes to one numeric/scalar field.
 * `style` picks how the folded run is worded (see numericAction): the default "changed from",
 * "delta" for a signed change, "rename" for a name.
 */
export function numericMerge(label, key, oldValue, newValue, style) {
	return { kind: "numeric", key, label, from: oldValue ?? null, to: newValue ?? null, ...(style ? { style } : {}) };
}

/** "Max HP (permanent) +4": a stored delta reported as the change it made, signed. */
export function deltaAction(label, from, to) {
	const d = (Number(to) || 0) - (Number(from) || 0);
	return `${label} ${d < 0 ? "-" : "+"}${Math.abs(d)}`;
}

/** One change to a field that stores a signed DELTA, worded as that delta and run-merged. */
export function deltaEntry(label, oldValue, newValue, key) {
	return { action: deltaAction(label, oldValue, newValue), merge: numericMerge(label, key, oldValue, newValue, "delta") };
}

/** The action a numeric run reads as, in the wording its `style` asks for. */
export function numericAction(merge) {
	if (merge?.style === "delta") return deltaAction(merge.label, merge.from, merge.to);
	if (merge?.style === "rename") return `${merge.label} renamed from ${formatValue(merge.from)} to ${formatValue(merge.to)}`;
	return actionForField(merge?.label, merge?.from, merge?.to);
}

// Ceiling on the field names one edit run names; past it the run closes, as a list run does.
const EDIT_RUN_MAX_FIELDS = 8;

/** "Longsword edited: description, uses": several edits to one thing fold into one line. */
export function editMerge(subject, key, fields) {
	return { kind: "edit", key, label: subject, items: [...fields] };
}

export function editAction(subject, fields) {
	return `${subject} edited: ${truncateValue(fields.join(", "))}`;
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
		return { ...previous, timestamp: entry.timestamp, merge, action: numericAction(merge) };
	}

	if (a.kind === "edit") {
		const items = [...a.items];
		for (const item of b.items) if (!items.includes(item)) items.push(item);
		if (items.length > EDIT_RUN_MAX_FIELDS) return null;
		const merge = { ...a, items };
		return { ...previous, timestamp: entry.timestamp, merge, action: editAction(a.label, items) };
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
	" answered",
	" recorded",
	" healed",
	" reopened",
	" became",
	" stabilized",
	" gained",
	" identified",
	" chosen",
	" carried",
	" set down",
	" updated",
	" edited",
	" written",
];

/**
 * Derive the "noun" (subject) of a ledger action string — the phrase before its
 * verb — so entries can be grouped and filtered. e.g. "HP changed from 5 to 3"
 * → "HP", "Longsword selected" → "Longsword", "Asset added: Wagon" → "Asset".
 *
 * Verbs are looked for only BEFORE the first quotation mark: a quoted value is somebody's own
 * words, and a wound written as "Arm marked by fire" cut the subject mid-quote. With no verb,
 * a colon ends the subject ("Minor arcanum (found): The Key"), and a trailing signed number is
 * dropped ("Max HP (permanent) +4"), so neither leaves a one-off subject per entry.
 * Falls back to the whole (trimmed) action when none of that applies.
 */
export function ledgerNoun(action) {
	const text = String(action ?? "").trim();
	if (!text) return "";
	const quote = text.search(/[“"]/);
	const head = quote >= 0 ? text.slice(0, quote) : text;
	let cut = head.length;
	for (const marker of LEDGER_VERB_MARKERS) {
		const idx = head.indexOf(marker);
		if (idx >= 0 && idx < cut) cut = idx;
	}
	if (cut === head.length) {
		const colon = head.indexOf(":");
		if (colon > 0) cut = colon;
		else {
			const signed = head.match(/^(.*\S)\s+[+-]\d+$/);
			if (signed) cut = signed[1].length;
		}
	}
	return text.slice(0, cut).trim() || text;
}

/**
 * The subject an entry is filed under: the one stamped when it was written (appendLedgerEntries),
 * else, for an entry written before subjects were stamped, the one its action reads as.
 */
export function ledgerSubject(entry) {
	return String(entry?.subject ?? "").trim() || ledgerNoun(entry?.action);
}

// ── Storage ─────────────────────────────────────────────────────────────────

// ONE FLAG KEY PER ENTRY, keyed by the entry's id: `flags.<scope>.ledger.<id>`. The ledger used to
// be one ARRAY, written back whole on every change, and arrays replace on merge: two clients
// appending inside one round trip each wrote back the array they had read, and the later write
// erased the other's entry. Keyed, each append writes only its own keys, which the server merges.
//
// A world written before this holds the old array. It still reads (getLedgerEntries takes either
// shape), and the next write converts it whole, with a forced REPLACEMENT so the array is not
// merged into the object.

/** A stored id that is safe as one flag-path segment: no dots, nothing expandObject would split. */
const SAFE_LEDGER_ID = /^[A-Za-z0-9_-]+$/;

function newLedgerId() {
	return globalThis.foundry?.utils?.randomID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

const isLedgerEntry = (e) => !!e && typeof e === "object" && !Array.isArray(e) && typeof e.action === "string";

function rawLedger(actor) {
	return actor?.getFlag?.(LEDGER_SCOPE, LEDGER_KEY);
}

const isKeyedLedger = (raw) => !!raw && typeof raw === "object" && !Array.isArray(raw);

/**
 * Newest first: by timestamp, then by `seq` (the order within one write, where every entry
 * shares a timestamp). The sort is stable, so legacy array entries with neither keep the order
 * they were stored in.
 */
export function sortLedgerEntries(entries) {
	return [...entries].sort((a, b) =>
		((Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
		|| ((Number(b.seq) || 0) - (Number(a.seq) || 0)));
}

/** Stored entries, newest first, from either storage shape. */
export function getLedgerEntries(actor) {
	const raw = rawLedger(actor);
	if (Array.isArray(raw)) return sortLedgerEntries(raw.filter(isLedgerEntry));
	if (!isKeyedLedger(raw)) return [];
	// The key is the id: an entry is addressed by it, so it wins over any `id` field inside.
	return sortLedgerEntries(Object.entries(raw)
		.filter(([, entry]) => isLedgerEntry(entry))
		.map(([key, entry]) => (entry.id === key ? entry : { ...entry, id: key })));
}

/**
 * The update that makes the stored ledger read as `next` (newest first).
 *
 * Keyed storage: sets each entry in `write`, deletes every stored id `next` no longer holds, and
 * touches nothing else, so a concurrent append from another client survives. Legacy array (or
 * anything else): the whole of `next` replaces it as the keyed form, with ids made unique and
 * path-safe and `seq` stamped from position so entries sharing a timestamp keep their order.
 */
function ledgerWriteData(raw, current, next, write) {
	// Nothing stored yet is the keyed form, empty: a first write needs no replacement, and two
	// clients making the first writes at once must not replace each other.
	if (raw == null || isKeyedLedger(raw)) {
		const keep = new Set(next.map(e => e.id));
		const data = {};
		for (const entry of write) if (keep.has(entry.id)) data[`${LEDGER_FLAG_PATH}.${entry.id}`] = entry;
		for (const entry of current) {
			if (keep.has(entry.id)) continue;
			const [key, value] = deletionEntry(`${LEDGER_FLAG_PATH}.${entry.id}`);
			data[key] = value;
		}
		return data;
	}
	const seen = new Set();
	const keyed = {};
	next.forEach((entry, index) => {
		const id = SAFE_LEDGER_ID.test(String(entry.id ?? "")) && !seen.has(entry.id) ? entry.id : newLedgerId();
		seen.add(id);
		keyed[id] = { ...entry, id, seq: next.length - index };
	});
	const [key, value] = replacementEntry(LEDGER_FLAG_PATH, keyed);
	return { [key]: value };
}

/** Whether the GM wrote `entry`: `byGM` when stamped, else the author's role, else no. */
function writtenByGM(entry) {
	if (typeof entry?.byGM === "boolean") return entry.byGM;
	if (!entry?.userId) return false;
	return !!globalThis.game?.users?.get?.(entry.userId)?.isGM;
}

/**
 * May `user` delete `entry` from `actor`'s ledger? Owners may, except that only a GM may delete an
 * entry a GM wrote: a player cannot quietly erase the record of what the GM did to their sheet.
 * A legacy entry with no recorded author stays deletable by its owners.
 */
export function canDeleteLedgerEntry(actor, entry, user = globalThis.game?.user) {
	if (user?.isGM) return true;
	if (actor?.isOwner === false) return false;
	return !writtenByGM(entry);
}

/**
 * One promise chain per actor, so two ledger writes for the same actor can never interleave.
 *
 * Both writers below read the stored entries and decide what to write from them (the head a run
 * folds into, the oldest entries a trim drops), and they are driven from
 * StonetopActor#_onUpdate, which fires once per actor update. Several places deliberately fire
 * CONCURRENT updates on a single actor — CharacterArcana's `Promise.all` of three setFlags, and
 * the Inventory Reset's four unsetFlags as it once was. Each of those flag writes survives on its
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

/** How many actors have a ledger write in flight on this client. For tests: idle is zero. */
export function pendingLedgerWrites() {
	return _ledgerWrites.size;
}

function _serializeLedgerWrite(actor, work) {
	// The uuid first: every unlinked token of one NPC shares its base actor's id, but each keeps a
	// ledger of its own.
	const key = actor?.uuid ?? actor?.id;
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
	// The server's clock: each client's own `Date.now()` interleaved a GM's rows and a player's wrongly.
	const now = serverNow();
	// Kept in the order they happened: callers hand entries over chronologically, while both
	// storage and mergeRuns are newest-first. Flipped inside the queue, once the stored head is
	// known (see headRunFirst). Walked backwards, a list run accumulated its items in reverse
	// ("Appearance set to <4th>, <3rd>, …").
	const stamped = entries.map(entry => ({
		id: newLedgerId(),
		timestamp: now,
		userId: userId ?? null,
		userName: user?.name ?? globalThis.game?.user?.name ?? "Unknown",
		// Whether the author is a GM, fixed at the time of writing: only a GM may delete it
		// (canDeleteLedgerEntry), even after that user is demoted or deleted.
		byGM: !!(user ?? (userId === globalThis.game?.user?.id ? globalThis.game?.user : null))?.isGM,
		action: entry.action,
		// What the change is TO, for the filter dropdown's subjects (ledgerSubject). Stamped here,
		// once, rather than parsed out of the sentence on every read: a builder that knows its
		// subject says so (an item named "Cloak marked with the Rime sigil" is not "Cloak"), and the
		// rest is read as it is worded now, so a run that rewords the action later keeps it.
		subject: String(entry.subject ?? "").trim() || ledgerNoun(entry.action),
		// Name of the move that caused this change, when the change was a move's automated
		// effect (e.g. "+1 XP on a miss" → the rolled move). null for plain sheet edits.
		move: entry.move ?? null,
		// Filter category for the ledger dialog's grouped subject dropdown.
		category: entry.category ?? defaultCategory,
		// Run descriptor (see mergeRuns): present only on entries that can absorb a
		// following change to the same subject.
		...(entry.merge ? { merge: entry.merge } : {}),
	}));

	// Stamping happens above, OUTSIDE the queue, so `timestamp` records when the change
	// happened rather than when its turn to write came up. Only the read-merge-write below
	// has to be serialized.
	return _serializeLedgerWrite(actor, async () => {
		const raw = rawLedger(actor);
		const current = getLedgerEntries(actor);
		const head = current[0];

		// Fold runs across the new entries and the single newest stored entry, so a burst that
		// arrives as several updates (four appearance lines, a climb from level 1 to 34) lands
		// as one entry. Only the head is offered for merging — older history is never rewritten.
		const merged = mergeRuns([...headRunFirst(stamped, head)].reverse().concat(head ? [head] : []));
		// One write's entries share a timestamp; `seq` is what keeps them in order once stored, and
		// it counts on from the head's so a second write in the same millisecond still sorts above.
		// A head that nothing folded into comes back as the same object, and is not rewritten.
		const base = Number(head?.seq) || 0;
		const written = merged.map((entry, index) => (entry === head ? entry : { ...entry, seq: base + merged.length - index }));
		const next = written.concat(current.slice(1)).slice(0, LEDGER_MAX_ENTRIES);

		await actor.update(
			ledgerWriteData(raw, current, next, written.filter(entry => entry !== head)),
			{ stonetopLedger: true, stonetopLedgerWrite: true, render: false },
		);
	});
}

/**
 * One update's entries, with those that continue the stored head's run moved to the front.
 *
 * Entries from one update happened together, so their order among themselves is only the order
 * the diff walked the paths in. mergeRuns folds only ADJACENT entries, so when one update wrote
 * Level and then XP, the XP entry found the Level entry between it and the stored XP run and
 * started a second XP line. Putting the run's continuation first lets it fold.
 */
function headRunFirst(chronological, head) {
	const run = head?.merge;
	if (!run) return chronological;
	const continues = (e) => e.merge?.kind === run.kind && e.merge?.key === run.key;
	return [...chronological.filter(continues), ...chronological.filter(e => !continues(e))];
}

/**
 * Drop the entries whose ids are in `ids`, of those `user` may delete (canDeleteLedgerEntry).
 * @returns {Promise<string[]>} the ids actually deleted
 */
export async function deleteLedgerEntries(actor, ids, { user = globalThis.game?.user } = {}) {
	if (!actor || !ids?.size) return [];
	// Same chain as the appends: a delete that read the stored entries before a concurrent append
	// wrote would decide its trim from a stale list.
	return _serializeLedgerWrite(actor, async () => {
		const raw = rawLedger(actor);
		const current = getLedgerEntries(actor);
		const doomed = new Set(current.filter(e => ids.has(e.id) && canDeleteLedgerEntry(actor, e, user)).map(e => e.id));
		if (!doomed.size) return [];
		await actor.update(ledgerWriteData(raw, current, current.filter(e => !doomed.has(e.id)), []), { stonetopLedger: true, stonetopLedgerWrite: true });
		return [...doomed];
	});
}
