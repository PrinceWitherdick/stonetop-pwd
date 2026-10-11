// ── What a character's carried gear says about THEM, for the GM to remember ──────────────────
// A hauberk is *cumbersome*, a cloak is *warm*, a maul is *awkward*: tags that change the fiction
// around whoever carries the thing, and that the sheet only ever printed on the inventory row,
// where the GM is not looking. This is the one rule that gathers them, worked out from the same
// gear picture armor is (StonetopCharacter#_gearSources) and mirrored onto
// `system.attributes.gearTags` with the armor (StonetopCharacter#syncStoredVitals), so the roll
// card, the Fight tab and the steading's PC table can read it off the document.
//
// Beside them, `system.reminders`: whatever else the table wants kept in view, typed by hand.
//
// Pure: no Foundry global is touched.

import { stripHtmlToText } from "../../utils/strings.js";
import { artifactVisibility } from "./artifact-identify.js";
import { GEAR_TERMS } from "../../data/gear-terms.js";
import { wornArmorBaseOf } from "./CharacterInventory.js";

/**
 * The tags that say something about the PERSON carrying the gear, in the order they are shown.
 * Tags about the thing itself (fragile, magical, messy) or how it is used in a fight (hand, close,
 * forceful) are left out: they matter when the item is picked up, not all session long. `clumsy`
 * is not in the book's gear glossary but is printed on the Rime Lords' giant-sized robes.
 */
export const WEARER_TAGS = Object.freeze(["cumbersome", "warm", "awkward", "clumsy", "beautiful"]);

/**
 * The tags in a tag line, lower-cased: the comma-separated words, with a gear choice's printed
 * parenthesis ("Scale coat (2 armor, warm, cumbersome)") opened up. A tag is a WHOLE entry, so prose
 * that only mentions a word (Snowembers' "warm even in deep winter") is not read as the tag.
 */
function tagsIn(text) {
	return new Set(text.split(/[,;()]/).map(part => part.trim().replace(/\.+$/, "").toLowerCase()).filter(Boolean));
}

/** The Heavy's, Judge's and Marshal's Armored: "you can ignore the cumbersome tag on any armor you wear". */
export const ARMORED_MOVE = "Armored";

/**
 * Whether a gear record is armor you WEAR (not a shield you bear): a worn-armor base, read through
 * CharacterInventory's own per-item rule, or for a record that carries no armor field (a gear
 * choice, a write-in) an "N armor" in its tag line. "+1 armor" is a shield's or a bonus's, not armor.
 */
function isWornArmor(item, text) {
	if ((Number(wornArmorBaseOf(item)) || 0) > 0) return true;
	if (item.shield) return false;
	return /(?:^|[^+\d])\d+\s+armor\b/i.test(text);
}

/**
 * The wearer tags on the gear this character is carrying, as `[{ tag, items: [name, …] }]` in
 * WEARER_TAGS order, each name listed once. Empty when nothing carried has one.
 *
 * Read off the item's tag line as whole comma-separated tags, so the catalog's `<em>warm</em>, <em>cumbersome</em>`
 * and a treasure's bare "warm, clumsy" read alike. A gear choice's record carries its printed label
 * as its note ("Scale armor (2 armor, warm, cumbersome)"), which is where its tags are.
 *
 * An artifact the GM has not let the players work out keeps its tags to itself (Book I p.430): this
 * list is mirrored onto the character for every viewer, so a hidden one adds nothing.
 *
 * @param {{items: object[], marks: object}} gear  StonetopCharacter#_gearSources' answer
 * @param {{ignoresCumbersomeArmor?: boolean}} [opts]  the owner has learned Armored
 * @returns {{tag: string, items: string[]}[]}
 */
export function carriedGearTags(gear, { ignoresCumbersomeArmor = false } = {}) {
	const byTag = new Map(WEARER_TAGS.map(tag => [tag, []]));
	const marks = gear?.marks ?? {};
	for (const item of gear?.items ?? []) {
		if (!item || !marks[item.slug]) continue;
		if (item.artifactState && !artifactVisibility(item.artifactState).showNote) continue;
		const text = stripHtmlToText(item.note);
		if (!text) continue;
		const name = stripHtmlToText(item.name) || text;
		const tags = tagsIn(text);
		for (const tag of WEARER_TAGS) {
			if (!tags.has(tag)) continue;
			if (tag === "cumbersome" && ignoresCumbersomeArmor && isWornArmor(item, text)) continue;
			const names = byTag.get(tag);
			if (!names.includes(name)) names.push(name);
		}
	}
	return [...byTag].filter(([, items]) => items.length).map(([tag, items]) => ({ tag, items }));
}

/** A stored `gearTags` list as it should compare and be written: the same shape, nothing extra. */
export function normalizeGearTags(list) {
	if (!Array.isArray(list)) return [];
	return list
		.filter(e => e && WEARER_TAGS.includes(e.tag))
		.map(e => ({ tag: e.tag, items: Array.isArray(e.items) ? e.items.map(String) : [] }));
}

/** Whether two gear-tag lists say the same thing. */
export function sameGearTags(a, b) {
	return JSON.stringify(normalizeGearTags(a)) === JSON.stringify(normalizeGearTags(b));
}

/** The typed reminders, trimmed, with blanks dropped. */
export function normalizeReminders(list) {
	if (!Array.isArray(list)) return [];
	return list.map(r => String(r ?? "").trim()).filter(Boolean);
}

/** A tag as a word to show: "Cumbersome". */
export function gearTagLabel(tag) {
	return tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : "";
}

/**
 * Everything a reader off the sheet shows for one character, from the STORED fields: one chip per
 * gear tag (`{ kind: "gear", label: "Cumbersome", detail: "Hauberk", tooltip }`) then one per typed
 * reminder (`{ kind: "note", label }`). The tooltip names the gear and quotes the book's gloss of
 * the tag where it has one.
 *
 * @param {object} actor  a character
 * @returns {{kind: "gear"|"note", label: string, detail?: string, tooltip: string}[]}
 */
export function reminderChips(actor) {
	if (actor?.type && actor.type !== "character") return [];
	const system = actor?.system ?? {};
	return chipsFrom(system.attributes?.gearTags, system.reminders);
}

/** reminderChips' arithmetic, for a caller that already holds the two lists (the sheet's live snapshot). */
export function chipsFrom(gearTags, reminders) {
	const gear = normalizeGearTags(gearTags).map(({ tag, items }) => {
		const chip = { kind: "gear", tag, label: gearTagLabel(tag), detail: items.join(", ") };
		const gloss = GEAR_TERMS[tag] ?? "";
		return { ...chip, tooltip: gloss ? `${chipLine(chip)}: ${gloss}` : chipLine(chip) };
	});
	const notes = normalizeReminders(reminders).map(label => ({ kind: "note", label, tooltip: label }));
	return [...gear, ...notes];
}

/** One chip as a line of text: "Cumbersome (Hauberk)", as the chip itself reads. The roll card, the
 *  chip's tooltip and the Fight tab's redraw key all say it this way. */
export function chipLine(chip) {
	return chip.kind === "gear" ? `${chip.label} (${chip.detail})` : chip.label;
}
