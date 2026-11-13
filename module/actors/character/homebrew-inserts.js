// A HOMEBREW PLAYBOOK'S INSERTS ON A CHARACTER (the Stranger's Monster Compendium): whether one is
// open to them, how many picks each of its lists allows, what they have picked, and what its FORM
// gives them while they wear it. PURE: plain data in (the playbook's `inserts` flags,
// homebrew-bundle.js#insertToFlags; the character's items; the stored picks), plain data out.
//
// THE PICK COUNT IS A FLAG, NEVER A BLOCK (the house rule for stat and pick counts): a character
// may tick more than a list allows (a GM's ruling, a move the sheet can't count), and the sheet
// says so beside each pick rather than refusing it.
//
// Where it is stored (CharacterHomebrewInserts.js): the picks in `flags.stonetop.insertLore`
// (`counts["<insert>-<list>:<option>"]`, `texts[...]`, the lore store's shape), and whether the
// character wears an insert's form in `flags.stonetop.insertForm[<insert key>]`.

import { looseName } from "../../utils/strings.js";
import { moveLearnedIn } from "./owns-move.js";
import { homebrewInsertOf } from "../../playbooks/playbook-catalog.js";
import { insertGearFromOption } from "../../playbooks/insert-gear.js";

/** The sheet tab an insert is drawn on. */
export const insertTabKey = key => `hb-insert-${key}`;
export const INSERT_TAB_PREFIX = "hb-insert-";

/** The lore store's key for an insert list: `<insert key>-<list key>` (homebrew-bundle.js#insertToFlags). */
export const insertListSlug = (insert, list) => list?.slug || `${insert.key}-${list.key}`;

const _moves = items => [...(items ?? [])].filter(i => i?.type === "move");

/** An option's words without their markup, for a label or the gear reader. */
export function plainOption(html) {
	return String(html ?? "").replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
		.replace(/&quot;/g, "\"").replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/**
 * Is `insert` open to the character, and how many learned copies of the move that opens it do
 * they hold? An insert with no opening move is open to everyone (once).
 * @returns {{open: boolean, copies: number}}
 */
export function insertOpening(insert, items) {
	if (!insert?.unlockedBy) return { open: true, copies: 1 };
	const want = looseName(insert.unlockedBy);
	const copies = _moves(items).filter(i => looseName(i.name) === want && !homebrewInsertOf(i) && moveLearnedIn(i, items)).length;
	return { open: copies > 0, copies };
}

/**
 * How many picks a list allows the character: its own count, plus `perUnlock` for every copy of
 * the opening move after the first (Otherkin taken again: "choose a new monster move"), plus what
 * each learned move it names gives ("choose 2 additional monstrous armaments").
 */
export function listAllowance(list, copies, items) {
	const learned = new Set(_moves(items).filter(i => moveLearnedIn(i, items)).map(i => looseName(i.name)));
	const bonus = (list?.bonusPicks ?? []).reduce((n, b) => n + (learned.has(looseName(b.move)) ? (Number(b.count) || 1) : 0), 0);
	return Math.max(0, Number(list?.pick) || 0) + (Number(list?.perUnlock) || 0) * Math.max(0, (copies || 0) - 1) + bonus;
}

/**
 * How many of a list's `allowance` picks are OWED, for the tab's "picks still to make": a list that
 * reads "pick 1 or 2" (min 1) owes one, its second being the player's choice; the extras a move or a
 * second copy of the opening move gives are owed in full. A list with no minimum owes its whole count.
 */
export function listRequirement(list, allowance) {
	const pick = Math.max(0, Number(list?.pick) || 0);
	const min = Number(list?.min) || 0;
	const base = min > 0 ? Math.min(min, pick) : pick;
	return Math.max(0, allowance - pick + base);
}

/** An option's count: what is stored, else 1 for one printed ticked (`preselected`), else 0. */
export function optionCount(counts, listSlug, opt) {
	const key = `${listSlug}:${opt.slug}`;
	if (counts && Object.prototype.hasOwnProperty.call(counts, key)) return Math.max(0, Number(counts[key]) || 0);
	return opt.preselected ? 1 : 0;
}

/**
 * The picks a pick list holds: each tick of an option that wasn't printed ticked, and each
 * write-in with words in it. The printed-ticked ones come with the insert and cost nothing.
 */
export function picksMade(insert, list, counts = {}, texts = {}) {
	const slug = insertListSlug(insert, list);
	let n = 0;
	for (const o of list?.options ?? []) {
		if (o.type === "text") { if (String(texts[`${slug}:${o.slug}`] ?? "").trim()) n++; continue; }
		if (o.preselected) continue;
		n += optionCount(counts, slug, o);
	}
	return n;
}

/** The options ticked (or written in) on a pick list, as plain labels. */
export function pickedLabels(insert, list, counts = {}, texts = {}) {
	const slug = insertListSlug(insert, list);
	const out = [];
	for (const o of list?.options ?? []) {
		if (o.type === "text") {
			const t = String(texts[`${slug}:${o.slug}`] ?? "").trim();
			if (t) out.push(t);
			continue;
		}
		if (optionCount(counts, slug, o) > 0) out.push(plainOption(o.description));
	}
	return out;
}

/**
 * What the insert's FORM gives while the character wears it: a record per ticked option that
 * reads as gear (insert-gear.js), in the shape the character's gear sources take
 * (StonetopCharacter#_gearSources). Nothing for an insert with no form, one not open, or one the
 * character isn't wearing.
 * @returns {Array<{slug: string, name: string, note: string|null, armor: object|null, kind: string}>}
 */
export function insertFormGear(insert, { counts = {}, open = true, wearing = false } = {}) {
	if (!insert?.form?.enabled || !open || !wearing) return [];
	const out = [];
	for (const list of insert.lists ?? []) {
		if (list.kind === "moves") continue;
		const slug = insertListSlug(insert, list);
		for (const o of list.options ?? []) {
			if (o.type === "text" || optionCount(counts, slug, o) < 1) continue;
			const gear = insertGearFromOption(plainOption(o.description));
			if (!gear) continue;
			out.push({
				slug: `hbinsert:${insert.key}:${list.key}:${o.slug}`,
				name: gear.name,
				note: gear.kind === "weapon" ? gear.note : null,
				armor: gear.kind === "armor" ? gear.armor : null,
				kind: gear.kind,
			});
		}
	}
	return out;
}

/**
 * Mark every ticked option of a list that is over its count with a caution, and say on the list
 * how many are picked. Changes the built lore entry's options in place (the post-death insert's
 * cautions are set the same way, post-death-outcomes.js).
 */
export function flagOverPicks(entry, { allowance, made, listTitle }) {
	if (made <= allowance) return;
	const caution = `${made} picked from ${listTitle || "this list"}, which allows ${allowance}. Fine if the table agreed; otherwise untick one.`;
	for (const opt of entry.options ?? []) {
		if (opt.type === "text" ? !!String(opt.textValue ?? "").trim() : opt.count > 0) opt.caution = caution;
	}
}
