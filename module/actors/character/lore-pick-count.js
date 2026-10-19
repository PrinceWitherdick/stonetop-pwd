/**
 * How many options a playbook lore list asks for, read off the book's own words in its description:
 * "(choose 3)", "(choose 2 or 3)", "(pick 1-2)", "(choose 1, maybe 2)". One reading for both places
 * that hold a player to it, the creation wizard (CharacterOnboardingDialog) and the Details tab's
 * boxes (StonetopCharacterSheet), so the sheet can never take a tick the wizard would refuse.
 *
 * THE TOP OF THE COUNT IS A CAP, THE BOTTOM IS A FLAG. A list at its most disables what is left
 * unticked, as a background's "choose 3 or 4" does on the Details tab; one short of its least is
 * said and never refused (the house rule for stat and pick counts alike).
 *
 * Kept Foundry-free so the reading can be tested with plain objects.
 */

// "choose N-M" (hyphen or en dash), "choose N or M", "choose N, maybe M", in that order; then a
// lone "choose N". With no count at all, a list of single-take boxes is a "pick 1".
function _countRange(section) {
	const desc = String(section?.description ?? "").toLowerCase();
	const pair = desc.match(/(?:choose|pick)\s+(\d+)\s*[\u2013-]\s*(\d+)/)
		?? desc.match(/(?:choose|pick)\s+(\d+)\s+or\s+(\d+)/)
		?? desc.match(/(?:choose|pick)\s+(\d+)[,\s]+maybe\s+(\d+)/);
	if (pair) return { min: parseInt(pair[1], 10), max: parseInt(pair[2], 10) };
	const single = desc.match(/(?:choose|pick)\s+(\d+)/);
	if (single) return { min: parseInt(single[1], 10), max: parseInt(single[1], 10) };
	const opts = section?.options ?? [];
	if (opts.length > 0 && opts.every(o => !o.type && (o.max ?? 1) === 1)) return { min: 1, max: 1 };
	return null;
}

/**
 * How many tales a section's count is for. The Fox's tall tales are "a couple of your more
 * memorable adventures", and each list says "(choose 1 per tale)": `tales` on the section turns
 * that into a count for the whole list. Every other section is one.
 */
export function loreTales(section) {
	return Math.max(1, Math.floor(Number(section?.tales) || 1));
}

/** The most a section takes per tale; Infinity for no count, or for an "Answer at least N" set. */
export function lorePickMaxPerTale(section) {
	if (/answer\s+at\s+least/.test(String(section?.description ?? "").toLowerCase())) return Infinity;
	return _countRange(section)?.max ?? Infinity;
}

/** The least a section asks for per tale; 0 for no count. */
export function lorePickMinPerTale(section) {
	return _countRange(section)?.min ?? 0;
}

/** The most a section takes across all its tales (Infinity: no cap). */
export function lorePickMax(section) {
	return lorePickMaxPerTale(section) * loreTales(section);
}

/** The least a section asks for across all its tales. */
export function lorePickMin(section) {
	return lorePickMinPerTale(section) * loreTales(section);
}

/**
 * Whether one option's count can go to `next` within its section's cap. Every tick counts, so an
 * option taken twice (a tall tale's `max: 2`) is two of the section's. Going down always fits, so
 * a list left over its cap (written before the cap, or by hand) can still be brought back under.
 *
 * @param {number} max            the section's lorePickMax
 * @param {object} sectionCounts  the section's stored counts, by option slug
 * @param {string} optionSlug     the option being changed
 * @param {number} next           its count after the change
 */
export function loreTickFits(max, sectionCounts, optionSlug, next) {
	const counts  = sectionCounts ?? {};
	const current = Math.max(0, Number(counts[optionSlug]) || 0);
	if (next <= current) return true;
	const total = Object.values(counts).reduce((sum, n) => sum + Math.max(0, Number(n) || 0), 0);
	return total - current + next <= max;
}

/**
 * Mark the Details tab's lore entries at their cap: each pick option of a full section gets `atCap`,
 * which disables its unticked boxes (its ticked ones stay live, so a pick can be taken back), and
 * `capDisabled` when it has no tick at all, which fades the row as a full background list fades
 * what is left. A section with no count is left alone.
 *
 * @param {object[]} entries      the snapshot's lore entries (PlaybookSnapshot LoreEntrySnapshot)
 * @param {object[]} rawSections  the playbook's own lore sections, for the count and `tales`
 * @returns {Map<string, number>}  each capped section's slug and its most, for the tick guard
 */
export function markLoreCaps(entries, rawSections) {
	const caps = new Map();
	const raw = new Map((rawSections ?? []).map(s => [s?.slug, s]));
	for (const entry of (entries ?? [])) {
		const section = raw.get(entry?.slug);
		if (!section) continue;
		const max = lorePickMax(section);
		if (!Number.isFinite(max)) continue;
		caps.set(entry.slug, max);
		const picks = (entry.options ?? []).filter(o => o.type !== "text");
		const atCap = picks.reduce((sum, o) => sum + (Number(o.count) || 0), 0) >= max;
		for (const opt of picks) {
			opt.atCap       = atCap;
			opt.capDisabled = atCap && !(Number(opt.count) > 0);
		}
	}
	return caps;
}
