import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// NO EM DASHES IN SHIPPED COPY. A house style rule, and one that only holds if something checks:
// the dash is the punctuation mark that turns up on its own when copy is written quickly, it reads
// as machine-written to the person shipping this system, and no linter has an opinion about it.
//
// WHAT COUNTS AS COPY: text a player or GM can read on screen. Strings in module/, rendered text in
// templates/, and every value in the language file. Not code COMMENTS, which are for whoever is
// reading the source and are written in this repo's own voice; not `packs/src`, which is Book I and
// Book II prose transcribed under CC BY-SA, where the punctuation is the author's and not ours.
//
// Both spellings are checked, because they render identically: the literal character and `&mdash;`.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FORMS = ["—", "&mdash;"];

/**
 * Where an em dash is still allowed, and why. Each of these was looked at rather than waived: the
 * rule is about PROSE, and none of these is prose.
 */
const ALLOWED = {
	// Parsers and decoders. The dash here is input being read, not output being written: these
	// split or normalize text that arrives with dashes in it (book prose pasted into a sheet, an
	// HTML entity out of a compendium, a "1-3" range on a roll table).
	"module/actors/character/CharacterPostDeath.js": "splits a book-formatted line on its dash",
	"module/actors/character/post-death-choices.js": "strips the lead-in dash off a printed option",
	"module/model/PlaybookSnapshot.js":              "normalizes entities out of playbook text",
	"module/utils/strings.js":                       "the entity encoder/decoder, and the shared instinct separator",
	"module/utils/journal-roll-tables.js":           "parses a dice range written with any dash",
	"module/utils/value-tooltips.js":                "parses a Value range written with any dash",
	"module/utils/treasure-drops.js":                "trims leading punctuation off enriched prose",

	// Quoted rules text. The Death's Door move as the book prints it, dashes and all. Rewriting
	// somebody else's punctuation inside a quotation is a worse fault than the house rule cures,
	// and a test in deaths-door.test.js pins this text against the entity form on purpose.
	"module/actors/character/dialogs/DeathsDoorDialog.js": "the Death's Door move, as printed",

	// TRANSCRIPTION, not copy. These files are Book I / Book II text carried into code so a sheet
	// or a dialog can render it, and they are transcription end to end rather than in patches —
	// the same reason `packs/src` is out of this check entirely. The punctuation in them is the
	// author's. A file here is NOT guarded at all, so nothing of ours should be written into one.
	"module/data/artifact-creation-tables.js":               "the Book II Artifact Creation tables",
	"module/data/arcana-summons.js":                         "stat blocks off each arcanum's reverse",
	"module/data/follower-moves.js":                         "the universal follower moves, generated from packs/src",
	"module/actors/character/dialogs/well-versed-topics.js": "the Lore journals' \"Everyone knows\" text",
	"module/utils/lore-terms.js":                            "the Lore glossary entries",
	"module/dialogs/spring-burst-data.js":                   "the Spring Burst omen table",
	"module/actors/steading/StonetopSteading.js":            "the steading improvements, as the playbook prints them",

	// Names that are also lookup keys. These strings are written into a Scene and a JournalEntry
	// page and then matched by name on the next run, so editing one orphans what it points at.
	"module/book2-art/poster-maps.js":  "scene names, matched by name on re-import",
	"module/utils/chronicle-core.js":   "chronicle page names, matched by name",
};

/**
 * Rules text quoted inside a file that is otherwise our own copy: a move's trigger printed on the
 * sheet, a steading condition's effect, a tooltip that reads a line out of the book.
 *
 * Named PHRASE by phrase rather than by file, unlike the transcription waivers above, because
 * these files are mostly ours and a whole-file waiver would take the sheet with the widest copy
 * surface in the system out of the check to protect four sentences. Each entry is the text either
 * side of one dash, so a second dash on the same line needs its own entry and is looked at rather
 * than carried in by a neighbour.
 */
const QUOTED = {
	"module/actors/character/StonetopCharacterSheet.js": [
		"\"When you return home in triumph — having saved your fellows, put do",
		"eat, seized the opportunity, etc. — clear one of the steading's debil",
		"\"6-: you find yourself in a spot — the GM will describe it or ask yo",
		"equence and they'll eventually go &mdash; otherwise they break free of your",
		"quired. Stabilizing isn't healing — that takes Convalesce.</p>",
	],
	"module/actors/character/deaths-door.js": [
		"\"My body was completely destroyed — burnt to ash, ground to jelly\",",
		"ss off a Mark that you don't have — you can never gain it\" },",
	],
	"module/actors/character/dialogs/UndeathDialog.js": [
		"is given up, so no HP comes back — you're out of the action until th",
	],
	"module/actors/steading/StonetopSteadingSheet.js": [
		"<div><strong>Winter</strong> — The <em>weariest</em> rolls 1d4+P",
		"g>return home in triumph</strong> — having saved your fellows, put do",
		"eat, seized the opportunity, etc. — clear one of the steading's debil",
		"ional items, don't Trade & Barter — Make a Plan with the GM or wait f",
		"il: \"from injuries/sickness/doubt — disadvantage to Deploy, Muster, P",
		"ue to shortages/hoarding/distrust — treat Prosperity as 1 lower\",",
		"detail: \"from fear/anger/despair — Fortunes reset to +0 each season;",
	],
	"module/dialogs/AddSteadingMemberDialog.js": [
		"alisade, market, and town council — though the old bandit Brennan and",
		"ss roamed by the nomadic Hillfolk — horselords and shepherds, fierce",
	],
	"module/item/arcanum-edit.js": [
		"ast mark, you unlock the mysteries—choose one of the moves on the rev",
	],
	"module/things-below/corrupt-being-dialog.js": [
		"s not truly part of a Thing Below &mdash; it is discharge, leavings, spawn,",
		"has corruption changed the being &mdash; are they merely a conduit for the",
	],
	"module/utils/roll-engine.js": [
		"\"<strong>Threats abound</strong> &mdash; and don't mark XP.\" },",
	],
	"templates/actor/partials/tab-followers.hbs": [
		"=\"Send them back whence they came — roll +CHA to dismiss this batch.\"",
	],
	"templates/dialogs/arcana-inspire.hbs": [
		"pur your creativity, not limit it — interpret them loosely.</p>",
	],
	"templates/dialogs/deaths-door.hbs": [
		"el\"><strong>Hard to Kill</strong> &mdash; mark a debility of your choice to",
	],
	"templates/dialogs/wound.hbs": [
		"re, or Make a Plan to adapt to it &mdash; write the requirements down as ti",
	],
};

/** The language file's quoted-rules entries, allowed for the same reason as the dialog above. */
const ALLOWED_EN_KEYS = [
	"stonetop.specialMoves.deathsDoor.description",
	"stonetop.specialMoves.recover.lockedHint",
	"stonetop.condemn.tagTooltip",
];

/**
 * A dash used as a PLACEHOLDER rather than as punctuation: the "no value" glyph in a table cell, an
 * empty `<option>`, a bracketing pair around the prompt in one ("- choose a card -"). Typography,
 * not prose, and the conventional mark for it.
 *
 * Recognized by what sits next to it: a quote, a tag edge, or a Handlebars branch, on one side or
 * the other, with only spaces between.
 */
const isPlaceholder = (before, after) =>
	/["'`>]\s*$/.test(before) || /^\s*["'`<]/.test(after) || /\}\}\s*$/.test(before) && /^\s*\{\{/.test(after);

/** Handlebars and JS comments, blanked so a line count survives. */
const stripComments = (src, ext) => {
	const blank = m => "\n".repeat((m.match(/\n/g) ?? []).length);
	return ext === ".hbs"
		? src.replace(/\{\{!--[\s\S]*?--\}\}|\{\{!(?!--)[\s\S]*?\}\}/g, blank)
		: src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, "");
};

function walk(dir, ext, out = []) {
	for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
		const rel = `${dir}/${entry.name}`;
		if (entry.isDirectory()) walk(rel, ext, out);
		else if (entry.name.endsWith(ext)) out.push(rel);
	}
	return out;
}

/** Every em dash left in one file's copy, as `path:line  ...context...`. */
function offenders(rel) {
	if (ALLOWED[rel]) return [];
	const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
	const text = stripComments(src, path.extname(rel));
	// Where this file's quoted rules text sits, as spans, so a dash inside one is left alone.
	const quoted = [];
	for (const phrase of QUOTED[rel] ?? []) {
		for (let i = text.indexOf(phrase); i >= 0; i = text.indexOf(phrase, i + 1)) quoted.push([i, i + phrase.length]);
	}
	const hits = [];
	for (const form of FORMS) {
		for (let i = text.indexOf(form); i >= 0; i = text.indexOf(form, i + 1)) {
			if (quoted.some(([from, to]) => i >= from && i < to)) continue;
			if (isPlaceholder(text.slice(Math.max(0, i - 40), i), text.slice(i + form.length, i + form.length + 40))) continue;
			const line = text.slice(0, i).split("\n").length;
			hits.push(`${rel}:${line}  ${text.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, " ")}`);
		}
	}
	return hits;
}

describe("shipped copy carries no em dashes", () => {
	it("in any module string", () => {
		const found = walk("module", ".js").flatMap(offenders);
		expect(found, `\n${found.join("\n")}\n`).toEqual([]);
	});

	it("in any rendered template text", () => {
		const found = walk("templates", ".hbs").flatMap(offenders);
		expect(found, `\n${found.join("\n")}\n`).toEqual([]);
	});

	// The language file is the one place a translator works, so a dash here is the one most likely
	// to be copied into every other language.
	it("in the language file", () => {
		const table = JSON.parse(fs.readFileSync(path.join(ROOT, "languages/en.json"), "utf8"));
		const found = [];
		const visit = (node, keyPath) => {
			if (typeof node === "string") {
				if (ALLOWED_EN_KEYS.includes(keyPath)) return;
				// A value that IS the dash: the "no organization" cell, the same placeholder the
				// templates use, with nothing around it for `isPlaceholder` to read.
				if (FORMS.includes(node.trim())) return;
				for (const form of FORMS) {
					const i = node.indexOf(form);
					if (i < 0) continue;
					if (isPlaceholder(node.slice(0, i), node.slice(i + form.length))) continue;
					found.push(`${keyPath}  ${node.slice(0, 90)}`);
				}
				return;
			}
			if (node && typeof node === "object") {
				for (const [key, value] of Object.entries(node)) visit(value, keyPath ? `${keyPath}.${key}` : key);
			}
		};
		visit(table, "");
		expect(found, `\n${found.join("\n")}\n`).toEqual([]);
	});

	// Every waiver above names a file that exists. A path that goes stale is a hole in the guard
	// that nothing else would report: the entry simply stops matching and stops protecting.
	it("waives only files that are still there", () => {
		for (const rel of Object.keys(ALLOWED)) {
			expect(fs.existsSync(path.join(ROOT, rel)), `${rel} is waived but missing`).toBe(true);
		}
	});

	// The same hole, one level finer. A quoted phrase that has been reworded or moved stops matching
	// anything, and a waiver that matches nothing protects nothing while still reading as deliberate.
	it("quotes only phrases that are still there", () => {
		for (const [rel, phrases] of Object.entries(QUOTED)) {
			expect(fs.existsSync(path.join(ROOT, rel)), `${rel} is quoted but missing`).toBe(true);
			const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
			for (const phrase of phrases) {
				expect(src.includes(phrase), `${rel} no longer contains: ${phrase}`).toBe(true);
			}
		}
	});
});
