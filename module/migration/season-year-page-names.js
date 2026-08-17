/**
 * Rename Seasons Change year pages left over from the ordinal naming scheme.
 *
 * A campaign year used to be called "First Year", "Second Year", … and is now "Year One",
 * "Year Two", … (see `yearLabel` in seasons/seasons-chronicle.js for why). The steading
 * header's clock and the season picker's chip build that string fresh every render, so they
 * changed the moment the function did — but a Chronicle page carries its name in the world's
 * own data, written once when the year was first recorded.
 *
 * Nothing BREAKS if they disagree: `recordSeasonsChange` finds its page by the `chronicleYear`
 * flag, never by name, so an old page keeps taking new seasons exactly as before. What breaks
 * is the reading. The Seasons Change journal is a column of year titles a table scans down,
 * player-visible, beside a sheet header that now says something else — and the years that go
 * stale are precisely the ones nobody will touch again, since a closed-out year is never
 * re-recorded. So it is swept rather than healed on write.
 *
 * WHAT IT WILL RENAME, and why that is safe:
 *   Only a page whose name is EXACTLY what one of the naming schemes would have produced for
 *   the year on its own `chronicleYear` flag. A GM who has titled a page "Year One — the
 *   Hillfolk winter" has said something this cannot improve on, and it is left alone. That is
 *   also what makes the sweep safe to run forever: it recognises a generated name, and the
 *   name it writes is one of the ones it recognises, so a second pass has nothing to do.
 *
 * Idempotent by construction and needs no once-per-world flag, exactly like the flag-scope
 * repair beside it in Ready.js.
 */

import { SYSTEM_ID } from "../system-id.js";
import { yearLabel } from "../seasons/seasons-chronicle.js";
import { isPrimaryGM } from "../utils/primary-gm.js";

/**
 * The ordinal scheme, kept here rather than in the live code: recognising an old name is this
 * migration's job, and nothing else in the system has a reason to spell a year that way again.
 */
const LEGACY_ORDINAL_WORDS = [
	"", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth",
	"Ninth", "Tenth", "Eleventh", "Twelfth", "Thirteenth", "Fourteenth", "Fifteenth",
	"Sixteenth", "Seventeenth", "Eighteenth", "Nineteenth", "Twentieth",
];

/** English ordinal for a positive integer: 1 → "1st", 11 → "11th", 22 → "22nd". */
function legacyOrdinal(n) {
	const v = n % 100;
	if (v >= 11 && v <= 13) return `${n}th`;
	return `${n}${({ 1: "st", 2: "nd", 3: "rd" })[n % 10] ?? "th"}`;
}

/** What year `n` was called before the rename — "First Year", "Twentieth Year", "21st Year". */
export function legacyYearName(n) {
	return `${LEGACY_ORDINAL_WORDS[n] ?? legacyOrdinal(n)} Year`;
}

/**
 * Every name this system has ever generated for a campaign year, current scheme first.
 *
 * A page wearing ANY of them is a page nobody has titled by hand, which is the whole test. It
 * includes the current name on purpose: that is what makes a second run a no-op rather than a
 * rule that happens to hold today.
 */
export function generatedYearNames(year) {
	return [yearLabel(year), legacyYearName(year)];
}

/**
 * Decide the renames for one journal's pages.
 *
 * Pure — takes plain page data, returns plain update rows — so every rule above is testable
 * without a world.
 *
 * @param {Array<object>} pages  plain page data ({_id, name, flags})
 * @returns {Array<{_id: string, name: string}>}
 */
export function planYearPageRenames(pages) {
	const updates = [];
	for (const page of pages ?? []) {
		const year = Number(page?.flags?.[SYSTEM_ID]?.chronicleYear);
		if (!Number.isInteger(year) || year < 1) continue;
		// Current scheme first, so the wanted name comes out of the same list that decides
		// whether a page is ours to rename — one call, and no second opinion about what a year
		// is called. Anything not on the list belongs to whoever typed it.
		const [want, ...older] = generatedYearNames(year);
		if (page.name === want || !older.includes(page.name)) continue;
		updates.push({ _id: page._id, name: want });
	}
	return updates;
}

/** Does this journal hold anything the sweep could possibly touch? */
function hasYearPage(pages) {
	return pages.some(page => page?.flags?.[SYSTEM_ID]?.chronicleYear != null);
}

/** Apply the renames to one JournalEntry. Returns how many pages moved, for the sweep's tally. */
export async function renameSeasonYearPages(entry) {
	// Answer "is there anything to do here" off the live documents before cloning any of them.
	// This runs on every load forever and the answer is no in every world that has already been
	// swept, so paying for a recursive `toObject()` of a whole journal to find that out would
	// cost more than the rename ever does. The plan only reads `name` and flags, which the live
	// page exposes just as well.
	//
	// The flag test comes BEFORE the map, as it does in the flag-scope sweep beside this one: a
	// seeded world carries hundreds of pages across the Chronicle, Places and Lore journals, and
	// all but a handful of them can be ruled out without allocating anything at all.
	const raw = [...(entry?.pages ?? [])];
	if (!hasYearPage(raw)) return 0;
	const updates = planYearPageRenames(raw.map(page => ({
		_id:   page.id ?? page._id,
		name:  page.name,
		flags: page.flags,
	})));
	if (!updates.length) return 0;
	await entry.updateEmbeddedDocuments("JournalEntryPage", updates);
	return updates.length;
}

/**
 * Sweep every journal in the world. Primary GM only — it writes, and two GMs racing would both
 * issue the same update.
 *
 * Every journal rather than the Seasons Change one by name, because the name is not what makes
 * a page one of these: the `chronicleYear` flag is, and a GM is free to have moved a page or
 * renamed the journal around it.
 */
export async function renameAllSeasonYearPages() {
	if (!game.user?.isGM || !isPrimaryGM()) return { renamed: 0, journals: 0 };
	let renamed = 0, journals = 0;
	for (const entry of game.journal?.contents ?? []) {
		try {
			const count = await renameSeasonYearPages(entry);
			if (!count) continue;
			journals += 1;
			renamed += count;
			console.log(`Stonetop | renamed ${count} year page(s) in "${entry.name}" to the "Year One" scheme`);
		} catch (err) {
			console.error(`Stonetop | year-page rename failed for "${entry?.name}"`, err);
		}
	}
	return { renamed, journals };
}
