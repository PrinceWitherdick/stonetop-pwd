/**
 * Take the "Marked D on the village map." line back out of the Places of Interest pages.
 *
 * Every place page used to open with that line (utils/places-chronicle.js wrote it ahead of the
 * book's paragraph). Nothing writes it any more, but a page seeded before then still carries it.
 *
 * A PAGE STILL AS WE WROTE IT would lose the line on the next seeding pass anyway, but that pass
 * runs only on a Chronicle save or a new pin, and never for a place whose name has since been
 * cleared. So the line is cut here, and the section's prose hash restamped to the cut text: the
 * page stays pristine and goes on following its source.
 *
 * A PAGE THE GM WROTE INTO loses the line and nothing else. Its hash is left alone, so it still
 * reads as edited and the seeding pass still leaves it be.
 *
 * Idempotent: a second pass finds nothing. Run once per version from Ready.js.
 */

import { isPrimaryGM } from "../utils/primary-gm.js";
import { bodyHashMatches, chronicleBodyHash } from "../utils/chronicle-core.js";
import { CHRONICLE_PROSE_FLAG, withChronicleLock } from "../utils/chronicle-journals.js";
import { findPlacesJournal, PLACE_PAGE_KEY_PREFIX } from "../utils/places-chronicle.js";
import { replacementEntry } from "../utils/foundry-compat.js";
import { SYSTEM_ID } from "../system-id.js";

// The paragraph exactly as it was written. The letter went through escHtml, so it holds no "<".
const MAP_LINE = /<p>\s*Marked <strong>[^<]*<\/strong> on the village map\.\s*<\/p>\s*/g;

const hasMapLine = body => typeof body === "string" && body.search(MAP_LINE) !== -1;

/**
 * A page's sections with the map line cut from every prose body, and its prose hashes restamped
 * where the body was still the one we wrote. Null when no section carries the line.
 *
 * Pure: plain data in, plain data out.
 * @param {Array<object>} sections
 * @param {object} [proseManaged]  per-heading hash of the prose body we last wrote
 * @returns {{ sections: Array<object>, proseManaged: object, restamped: boolean }|null}
 */
export function withoutMapLine(sections, proseManaged = {}) {
	if (!Array.isArray(sections)) return null;
	const nextProse = { ...(proseManaged ?? {}) };
	let changed = false;
	let restamped = false;
	const out = sections.map(section => {
		if (section?.kind !== "prose" || !hasMapLine(section.body)) return section;
		changed = true;
		const body = section.body.replace(MAP_LINE, "");
		const prev = nextProse[section.heading];
		if (prev !== undefined && bodyHashMatches(prev, section.body)) {
			nextProse[section.heading] = chronicleBodyHash(body);
			restamped = true;
		}
		return { ...section, body };
	});
	return changed ? { sections: out, proseManaged: nextProse, restamped } : null;
}

/**
 * Cut the line from one journal's place pages, in one write. Returns how many pages changed.
 * @param {JournalEntry} journal
 */
export async function clearPlaceMapLines(journal) {
	if (!journal) return 0;
	// In the journal's page queue: a seeding pass reads a page's sections and hashes together.
	return withChronicleLock(journal, async () => {
		const updates = [];
		for (const page of journal.pages ?? []) {
			const key = page.getFlag?.(SYSTEM_ID, "chronicleKey");
			if (!String(key ?? "").startsWith(PLACE_PAGE_KEY_PREFIX)) continue;
			const live = page.system?.sections;
			if (!live?.some?.(s => s?.kind === "prose" && hasMapLine(s.body))) continue;
			const result = withoutMapLine(
				page.system.toObject?.().sections ?? live,
				page.getFlag?.(SYSTEM_ID, CHRONICLE_PROSE_FLAG) ?? {},
			);
			if (!result) continue;
			const change = { _id: page.id, "system.sections": result.sections };
			if (result.restamped) {
				const [k, v] = replacementEntry(`flags.${SYSTEM_ID}.${CHRONICLE_PROSE_FLAG}`, result.proseManaged);
				change[k] = v;
			}
			updates.push(change);
		}
		if (!updates.length) return 0;
		await journal.updateEmbeddedDocuments("JournalEntryPage", updates);
		return updates.length;
	});
}

/**
 * Clear this world's Places of Interest journal. Primary GM only: it writes, and two GMs would
 * both write it.
 * @returns {Promise<number>} how many pages changed.
 */
export async function clearAllPlaceMapLines() {
	if (!game.user?.isGM || !isPrimaryGM()) return 0;
	const count = await clearPlaceMapLines(findPlacesJournal());
	if (count) console.log(`Stonetop | took the village-map line out of ${count} Places of Interest page(s)`);
	return count;
}
