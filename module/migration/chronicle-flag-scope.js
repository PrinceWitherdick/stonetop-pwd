/**
 * Repair for chronicle pages whose flags were filed under the literal key "SYSTEM_ID".
 *
 * When the package id was centralised into a constant, five object literals took the constant as
 * a PLAIN key instead of a computed one — `{ SYSTEM_ID: {…} }` rather than `{ [SYSTEM_ID]: {…} }`.
 * The one that reached a world is seedChroniclePages. That pass is find-or-create keyed on the
 * flag it writes itself, so a key written where `getFlag` cannot read it back means the lookup
 * never matches: every save re-created every page it had already made. Six saves of the Places of
 * Interest journal left six copies of every place beside the original.
 *
 * The write is fixed (utils/chronicle-journals.js) and a lint rule now refuses the shape
 * (eslint.config.js), but neither un-duplicates a world that already ran it. This does.
 *
 * WHAT IT WILL DELETE, and why that is safe:
 *   Only a page that BOTH carries the literal `SYSTEM_ID` block — the fingerprint of the buggy
 *   write, nothing else produces it — AND shares its chronicle identity with a page being kept.
 *   A misfiled page with an identity all its own is repaired in place, never removed. A properly
 *   filed page is never removed at all, even when it duplicates another: that is not damage this
 *   understands, and a human should look at it.
 *
 * Nothing is dropped on the floor either way: a doomed page's BODY is merged into the keeper
 * first, so anything that existed only on a duplicate survives and identical content collapses
 * instead of doubling. A page keeps that body in one of two places and this has to know both —
 * our own chronicle pages hold structured `system.sections`, while the Seasons Change journal is
 * made of core `text` pages whose whole record is `text.content`. Sections fold through
 * foldDuplicateSections, which never lets a duplicate's text replace the keeper's: a section the
 * keeper lacks is added, missing Q&A pairs are added, and prose that differs is kept beside the
 * keeper's under "<heading> (recovered copy)". Text pages fold by season (mergeSeasonBlock).
 *
 * Idempotent by construction — after a run no page carries the literal block, so there is nothing
 * left to match. It needs no once-per-world flag and is swept on every load.
 */

import { SYSTEM_ID } from "../system-id.js";
import { mergeSeasonBlock } from "../seasons/seasons-chronicle.js";
import { cloneChronicleSection, normaliseChronicleHtml } from "../utils/chronicle-core.js";
import { CHRONICLE_PROSE_FLAG } from "../utils/chronicle-journals.js";
import { deletionEntry } from "../utils/foundry-compat.js";
import { isPrimaryGM } from "../utils/primary-gm.js";

/** The property name a plain (uncomputed) `SYSTEM_ID` key lands under. */
export const LITERAL_SCOPE_KEY = "SYSTEM_ID";

/** One `<section data-season>` block — the unit a Seasons Change year page is built from. */
const SEASON_BLOCK_RE = /<section class="stonetop-season-block"[\s\S]*?<\/section>/g;

const seasonOf = block => (block.match(/data-season="([^"]+)"/) ?? [])[1] ?? "";

/**
 * Is this body nothing BUT season blocks?
 *
 * The gate on folding season by season. mergeSeasonBlock keeps whatever surrounds the blocks, but
 * a page with a GM's own writing in it is one this cannot read the shape of, so it falls through
 * to the blunt append below, which keeps every word of both.
 */
function isSeasonBody(html) {
	const text = String(html ?? "").trim();
	const blocks = text.match(SEASON_BLOCK_RE) ?? [];
	return blocks.length > 0 && blocks.join("") === text;
}

/**
 * Fold a doomed page's `text.content` into the keeper's.
 *
 * `system.sections` is where our own chronicle pages keep their body; a core `text` page keeps
 * it here instead, and the Seasons Change journal — the one journal this repair groups by YEAR
 * rather than by key — is made entirely of those. Merging only sections meant every de-duplicated
 * year page lost three of its four seasons.
 *
 * A page of season blocks merges BY SEASON through the very function that wrote it, so a season
 * recorded twice collapses to one and the result comes back in canonical Spring→Winter order
 * however the copies happened to be ordered. Anything else is appended whole unless the keeper
 * already holds it verbatim: this cannot know what a hand-written page means, and a paragraph
 * kept twice is something a GM can fix where one deleted is not.
 */
export function mergeChronicleText(keeperHtml = "", doomedHtml = "") {
	const keeper = String(keeperHtml ?? "");
	const doomed = String(doomedHtml ?? "").trim();
	if (!doomed || keeper.includes(doomed)) return { content: keeper, added: false };

	if (isSeasonBody(keeper) && isSeasonBody(doomed)) {
		let content = keeper;
		let added = false;
		for (const block of doomed.match(SEASON_BLOCK_RE) ?? []) {
			const season = seasonOf(block);
			// A season the keeper already records is the same season written twice, not two
			// different records — the keeper's copy stands, exactly as re-recording a season does.
			if (!season || content.includes(`data-season="${season}"`)) continue;
			content = mergeSeasonBlock(content, season, block);
			added = true;
		}
		return { content, added };
	}

	return { content: keeper ? `${keeper}${doomed}` : doomed, added: true };
}

/** The heading a duplicate's differing prose is kept under, beside the keeper's own. */
export const RECOVERED_SUFFIX = " (recovered copy)";

const sameSection = (a, b) => {
	if (a?.kind === "prose" && b?.kind === "prose") {
		return normaliseChronicleHtml(a.body) === normaliseChronicleHtml(b.body);
	}
	return JSON.stringify(a) === JSON.stringify(b);
};

/**
 * Fold a doomed duplicate's sections into the keeper's, losing nothing and overwriting nothing.
 *
 * Never through mergeChronicleSections: that refreshes a "pristine" section from its source, and
 * a duplicate is not a source. Fed one, it let a deleted copy's different prose replace the
 * keeper's untouched prose and stamped it as ours (so a later save could overwrite a GM edit),
 * and it threw away the deleted copy's prose whenever the keeper's had been edited.
 *
 *   • a heading the keeper lacks: the section is added as it stands;
 *   • the same Q&A heading: pairs the keeper lacks (by prompt and answer) are added;
 *   • the same heading with other text: the duplicate's section is kept beside the keeper's,
 *     under "<heading> (recovered copy)", unless that exact copy is already there.
 * Nothing added here is recorded as written by us, so no later save treats it as ours to change.
 *
 * @returns {{sections: Array<object>, added: boolean}}
 */
export function foldDuplicateSections(keeperSections = [], doomedSections = []) {
	const sections = (keeperSections ?? []).map(cloneChronicleSection);
	let added = false;
	for (const dup of doomedSections ?? []) {
		if (!dup) continue;
		const match = sections.find(sec => sec.heading === dup.heading);
		if (!match) {
			sections.push(cloneChronicleSection(dup));
			added = true;
			continue;
		}
		if (match.kind === "qa" && dup.kind === "qa") {
			match.pairs ??= [];
			const sig = p => JSON.stringify([p?.prompt ?? "", p?.answer ?? ""]);
			const have = new Set(match.pairs.map(sig));
			for (const pair of dup.pairs ?? []) {
				if (have.has(sig(pair))) continue;
				match.pairs.push({ ...pair });
				have.add(sig(pair));
				added = true;
			}
			continue;
		}
		if (sameSection(match, dup)) continue;
		const heading = `${dup.heading ?? ""}${RECOVERED_SUFFIX}`;
		const recovered = { ...dup, heading };
		if (sections.some(sec => sec.heading === heading && sameSection(sec, recovered))) continue;
		sections.push(recovered);
		added = true;
	}
	return { sections, added };
}

/**
 * What a page is filed as, reading the correct scope first and the misfiled block second.
 * `null` identity means the page is not a chronicle page this repair knows how to group.
 */
function pageIdentity(page, scope) {
	const misfiled = page?.flags?.[LITERAL_SCOPE_KEY];
	const proper   = page?.flags?.[scope];
	const key  = proper?.chronicleKey  ?? misfiled?.chronicleKey  ?? null;
	const year = proper?.chronicleYear ?? misfiled?.chronicleYear ?? null;
	return {
		identity: key != null ? `key:${key}` : (year != null ? `year:${year}` : null),
		misfiled: misfiled && typeof misfiled === "object" ? misfiled : null,
		hasProper: !!proper,
	};
}

/**
 * Decide the repair for one journal's pages.
 *
 * Pure: takes plain page data, returns plain instructions, so every rule above is testable
 * without a world. `pages` must be in the order the journal holds them; the FIRST page of a
 * group is the fallback keeper, which keeps the outcome stable across runs.
 *
 * @param {Array<object>} pages   plain page data ({_id, sort, flags, system:{sections}})
 * @returns {{updates: Array<object>, deleteIds: string[]}}
 */
export function planChronicleFlagRepair(pages, { scope = SYSTEM_ID } = {}) {
	const rows = (pages ?? []).map(page => ({ page, ...pageIdentity(page, scope) }));
	if (!rows.some(row => row.misfiled)) return { updates: [], deleteIds: [] };

	const groups = new Map();
	for (const row of rows) {
		if (row.identity == null) continue;
		groups.set(row.identity, [...(groups.get(row.identity) ?? []), row]);
	}

	const updates = [];
	const deleteIds = [];

	// A misfiled page with no identity at all still has a stray block to sweep off it.
	for (const row of rows) {
		if (row.identity == null && row.misfiled) updates.push(adoptUpdate(row, scope, null));
	}

	for (const group of groups.values()) {
		// Prefer a page the readers can already resolve; otherwise the first one, so a re-run
		// makes the same choice.
		const keeper = group.find(row => row.hasProper) ?? group[0];
		const doomed = group.filter(row => row !== keeper && row.misfiled);

		// Fold anything that exists only on a doomed copy into the keeper before it goes — BOTH
		// bodies, since which of the two a page uses depends on its type and this repair groups
		// structured chronicle pages and core text pages alike.
		let sections = keeper.page?.system?.sections ?? [];
		const proseManaged = keeper.page?.flags?.[scope]?.[CHRONICLE_PROSE_FLAG]
			?? keeper.misfiled?.[CHRONICLE_PROSE_FLAG]
			?? {};
		let content = keeper.page?.text?.content ?? "";
		let merged = false;
		let textMerged = false;
		for (const row of doomed) {
			// The keeper's prose hashes stand as they are: nothing folded in is ours.
			const result = foldDuplicateSections(sections, row.page?.system?.sections ?? []);
			if (result.added) merged = true;
			sections = result.sections;
			const body = mergeChronicleText(content, row.page?.text?.content ?? "");
			if (body.added) textMerged = true;
			content = body.content;
		}

		if (keeper.misfiled || merged || textMerged) {
			updates.push(adoptUpdate(keeper, scope, {
				sections: merged ? sections : null,
				proseManaged,
				content: textMerged ? content : null,
			}));
		}
		for (const row of doomed) deleteIds.push(row.page._id);
	}

	return { updates, deleteIds };
}

/**
 * The update that moves a page's misfiled flags into the real scope and takes the stray block
 * off it. `body` carries whichever of the two bodies a doomed sibling contributed to — either
 * may be null, since a page uses one or the other and never both.
 *
 * The adopted sub-keys are written individually rather than as one object so an existing proper
 * block is topped up, not replaced — a page repaired here may already hold flags of its own.
 */
function adoptUpdate(row, scope, body) {
	const update = { _id: row.page._id };
	for (const [key, value] of Object.entries(row.misfiled ?? {})) {
		// Never let a fossil overwrite the live value; the proper scope is authoritative.
		if (row.page?.flags?.[scope]?.[key] === undefined) update[`flags.${scope}.${key}`] = value;
	}
	if (row.misfiled) {
		const [deleteKey, deleteValue] = deletionEntry(`flags.${LITERAL_SCOPE_KEY}`);
		update[deleteKey] = deleteValue;
	}
	if (body?.sections) {
		update["system.sections"] = body.sections;
		update[`flags.${scope}.${CHRONICLE_PROSE_FLAG}`] = body.proseManaged;
	}
	if (body?.content != null) update["text.content"] = body.content;
	return update;
}

/**
 * Apply the repair to one JournalEntry. Returns what it did, for the sweep's tally.
 * Updates land before deletes so a keeper never briefly loses content it is about to inherit.
 */
export async function repairChronicleFlagScope(entry) {
	// Answer "is there anything to do here" off the live documents, before cloning any of them.
	// This sweep runs on every load forever, and after the first successful run — and in every
	// world that never hit the bug — the answer is no. `toObject()` is a full recursive clone of
	// a page's source data, so cloning a whole journal to discover that costs more than the
	// repair itself ever does. The plan only ever reads flags, so this is the same question.
	const raw = entry?.pages ?? [];
	if (!raw.some(page => page?.flags?.[LITERAL_SCOPE_KEY])) return { updated: 0, deleted: 0 };

	const pages = raw.map(page => (page.toObject ? page.toObject() : page));
	const { updates, deleteIds } = planChronicleFlagRepair(pages);
	if (!updates.length && !deleteIds.length) return { updated: 0, deleted: 0 };
	if (updates.length) await entry.updateEmbeddedDocuments("JournalEntryPage", updates);
	if (deleteIds.length) await entry.deleteEmbeddedDocuments("JournalEntryPage", deleteIds);
	return { updated: updates.length, deleted: deleteIds.length };
}

/**
 * Sweep every journal in the world. Primary GM only — it writes, and two GMs racing would both
 * try to delete the same pages (the loser throwing on documents that no longer exist).
 */
export async function repairAllChronicleFlagScopes() {
	if (!game.user?.isGM || !isPrimaryGM()) return { updated: 0, deleted: 0, journals: 0 };
	let updated = 0, deleted = 0, journals = 0;
	for (const entry of game.journal?.contents ?? []) {
		try {
			const result = await repairChronicleFlagScope(entry);
			if (result.updated || result.deleted) {
				journals += 1;
				updated += result.updated;
				deleted += result.deleted;
				console.log(`Stonetop | repaired chronicle flags in "${entry.name}": `
					+ `${result.updated} page(s) re-filed, ${result.deleted} duplicate(s) removed`);
			}
		} catch (err) {
			console.error(`Stonetop | chronicle flag repair failed for "${entry?.name}"`, err);
		}
	}
	return { updated, deleted, journals };
}
