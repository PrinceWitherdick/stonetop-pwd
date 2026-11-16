// A marking move's marks (`moves.moveMarks[moveName][optionSlug]`), read the one way for every
// reader that asks how many are FILLED: the Potential for Greatness card, Superior Stat's "(Requires
// all 6 marks in Potential for Greatness)", and the stat-roll reminder.
//
// Counting the stored entries is not the same thing. A stat slot (`choice: "stat"`) is stored at its
// index, so picking the third slot first pads the first two with empty `{ stat: "", level: null }`
// entries (StonetopCharacter#setStatSlot), and un-picking a slot leaves one behind. A stat slot is
// filled only while it names a stat. A checkbox option (max HP, damage die) stores one entry per
// ticked box (StonetopCharacter#setCountMark truncates on untick), so every entry there is a mark.
//
// Pure: plain data in, plain data out.

/** The Would-be Hero's marking move, as the mark store and the pack name it. */
export const POTENTIAL_FOR_GREATNESS = "Potential for Greatness";

/**
 * The marking moves taken "Once per level" (Potential for Greatness: "Once per level, when you roll
 * a stat and get a 10+, mark one of the following (note the level during which you marked it)").
 * Name-keyed, as stat-rules.js#MARK_STAT_CAPS is: the rule lives in the move's prose, not its data.
 * Flagged, never blocked (oncePerLevelCautions below).
 */
export const ONCE_PER_LEVEL_MARKS = new Set([POTENTIAL_FOR_GREATNESS]);

/**
 * A stored mark value as an array of `{ stat, level }` entries (plus `creation` where onboarding
 * stamped one). Legacy shapes: a plain count (number), or an array of stat strings.
 */
export function markEntries(stored) {
	if (Array.isArray(stored)) {
		return stored.map(e => (e && typeof e === "object")
			// `text`: what the player wrote in a write-in mark ("Something else: ___").
			? { stat: e.stat ?? "", level: e.level ?? null, ...(e.creation ? { creation: true } : {}), ...(e.text ? { text: String(e.text) } : {}) }
			: { stat: typeof e === "string" ? e : "", level: null });
	}
	if (typeof stored === "number") return Array.from({ length: stored }, () => ({ stat: "", level: null }));
	return [];
}

/**
 * Whether one stored entry is a mark. `opt` is its option (`{ slug, choice, marks }`), or null when
 * the option is not known: then an entry that names a stat or carries a level is one, which is what
 * both writers leave on a real mark and neither leaves on a stat slot's padding.
 */
export function isFilledMark(entry, opt = null) {
	if (!entry || typeof entry !== "object") return false;
	if (opt?.choice === "stat") return !!entry.stat;
	if (opt) return true;
	return !!entry.stat || entry.level != null;
}

/**
 * Every filled mark of one move, as `{ slug, index, stat, level }` in option order. `moveMarks` is
 * the move's entry in the mark store (option slug to stored value); `markOptions` its options, off
 * the pack definition or the owned copy. Each option counts no more than its own boxes (`marks`),
 * so a stray duplicate never reads as an extra mark. Without `markOptions` every stored option is
 * read, by entry shape alone (isFilledMark).
 */
export function filledMarks(moveMarks = {}, markOptions = null) {
	const known = Array.isArray(markOptions) && markOptions.length > 0;
	const options = known ? markOptions : Object.keys(moveMarks ?? {}).map(slug => ({ slug }));
	const out = [];
	for (const opt of options) {
		const boxes = known ? (opt.marks ?? 1) : Infinity;
		markEntries(moveMarks?.[opt.slug]).forEach((entry, index) => {
			if (index < boxes && isFilledMark(entry, known ? opt : null)) {
				out.push({ slug: opt.slug, index, stat: entry.stat ?? "", level: entry.level ?? null });
			}
		});
	}
	return out;
}

/** How many of a move's marks are filled (filledMarks). */
export function filledMarkCount(moveMarks = {}, markOptions = null) {
	return filledMarks(moveMarks, markOptions).length;
}

/** How many boxes a move's options print in all (Potential for Greatness: 4 + 1 + 1 = 6). */
export function markCapacity(markOptions = []) {
	return (markOptions ?? []).reduce((n, opt) => n + (opt.marks ?? 1), 0);
}

/** Whether any filled mark of the move was noted at `level`. */
export function hasMarkAtLevel(moveMarks = {}, markOptions = null, level = null) {
	return level != null && filledMarks(moveMarks, markOptions).some(m => m.level === level);
}

/**
 * A stat slot's entries with the empty ones at the END dropped, so un-picking the last filled slot
 * leaves no padding behind. An empty slot BEFORE a filled one stays: a slot's place is its index.
 */
export function trimEmptyTail(entries = []) {
	let end = entries.length;
	while (end > 0 && !entries[end - 1]?.stat) end--;
	return entries.slice(0, end);
}

/**
 * The "Once per level" cautions for one move: a Map from `"<slug>:<index>"` to why that mark is off,
 * `"shared"` when another filled mark was noted at the same level, `"ahead"` when it was noted at a
 * level above `currentLevel`. A mark with no level noted is never flagged. Flag, never block: the
 * sheet shows a caution and changes nothing.
 */
export function oncePerLevelCautions(moveMarks = {}, markOptions = null, currentLevel = null) {
	const marks = filledMarks(moveMarks, markOptions).filter(m => Number.isFinite(m.level));
	const perLevel = new Map();
	for (const m of marks) perLevel.set(m.level, (perLevel.get(m.level) ?? 0) + 1);
	const out = new Map();
	for (const m of marks) {
		const key = `${m.slug}:${m.index}`;
		if (Number.isFinite(currentLevel) && m.level > currentLevel) out.set(key, "ahead");
		else if (perLevel.get(m.level) > 1) out.set(key, "shared");
	}
	return out;
}
