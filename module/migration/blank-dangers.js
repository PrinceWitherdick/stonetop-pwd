/**
 * Take the blank entries back out of location and Chronicle pages' Dangers lists.
 *
 * From 2026-06-14 until 43ca5442 the page sheet read a Dangers list back off its edit form by
 * `[data-group-index]`, which the row AND the editor inside it both carry, so every entry was read
 * twice, the second time blank. Every save of a Dangers list therefore wrote a blank entry after
 * each real one, and so did closing a book page's pop-out, because the editors save themselves as
 * they are taken off the page. Reading never shows a blank entry, so nobody saw them; editing
 * shows each one as an empty row, and a list saved a few times had more blanks than entries.
 *
 * WHAT IS BLANK: no title, and a body with no words in it and nothing else a person put there (a
 * picture, a table, a divider). That is exactly what the bug wrote. A GM's own "Add danger" left
 * unfilled looks the same and goes too, which loses nothing: it is invisible when reading, and
 * the button makes another.
 *
 * SAFE FOR THE MANAGED BOOK UPDATES: no shipped Dangers list has a blank entry, so a page still
 * as shipped is never written, and stays pristine.
 *
 * Idempotent: a second pass finds nothing. Run once per version from Ready.js.
 */

import { isActingPrimaryGM } from "../utils/primary-gm.js";

// The page types drawn by StonetopLocationPageSheet, whose sections carry the Dangers lists.
const PAGE_TYPES = new Set(["location", "chronicle"]);

// Markup that is content in its own right, with or without any words around it.
const CONTENT_TAGS = /<(?:img|table|hr|iframe|video|audio|embed|object|svg|figure)\b/i;

/** Is this Dangers entry blank: no title, and a body holding nothing at all? */
export function isBlankDanger(entry) {
	if (String(entry?.heading ?? "").trim()) return false;
	const body = String(entry?.body ?? "");
	if (CONTENT_TAGS.test(body)) return false;
	return !body.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;|\u00a0/gi, " ").trim();
}

/**
 * The page's sections with every blank Dangers entry taken out, or null when there is none.
 *
 * Pure: plain section data in, plain section data out.
 * @param {Array<object>} sections
 * @returns {Array<object>|null}
 */
export function withoutBlankDangers(sections) {
	if (!Array.isArray(sections)) return null;
	let changed = false;
	const out = sections.map(section => {
		if (section?.kind !== "groups" || !Array.isArray(section.groups)) return section;
		const groups = section.groups.filter(entry => !isBlankDanger(entry));
		if (groups.length === section.groups.length) return section;
		changed = true;
		return { ...section, groups };
	});
	return changed ? out : null;
}

/**
 * Clear the blanks from one JournalEntry's pages, in one write. Returns how many pages changed.
 * @param {JournalEntry} entry
 */
export async function clearBlankDangers(entry) {
	const updates = [];
	for (const page of entry?.pages ?? []) {
		if (!PAGE_TYPES.has(page.type)) continue;
		// Ruled out off the live data before anything is cloned: this runs over every page in the
		// world and the answer is "nothing here" for almost all of them.
		const live = page.system?.sections;
		if (!live?.some?.(s => s?.kind === "groups" && s.groups?.some?.(isBlankDanger))) continue;
		const sections = withoutBlankDangers(page.system.toObject?.().sections ?? live);
		if (sections) updates.push({ _id: page.id, "system.sections": sections });
	}
	if (!updates.length) return 0;
	await entry.updateEmbeddedDocuments("JournalEntryPage", updates);
	return updates.length;
}

/**
 * Sweep every journal in the world. Primary GM only: it writes, and two GMs would both write it.
 * @returns {Promise<{pages: number, journals: number}>}
 */
export async function clearAllBlankDangers() {
	if (!isActingPrimaryGM()) return { pages: 0, journals: 0 };
	let pages = 0, journals = 0;
	for (const entry of game.journal?.contents ?? []) {
		try {
			const count = await clearBlankDangers(entry);
			if (!count) continue;
			journals += 1;
			pages += count;
			console.log(`Stonetop | cleared blank Dangers entries from ${count} page(s) in "${entry.name}"`);
		} catch (err) {
			console.error(`Stonetop | clearing blank Dangers entries failed for "${entry?.name}"`, err);
		}
	}
	return { pages, journals };
}
