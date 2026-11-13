// A PLAYBOOK PDF'S TEXT -> A DRAFT the GM reviews, then a homebrew bundle. PURE: PageRuns in
// (pdf-text-source.js), never throws on a strange PDF.
//
// TWO HALVES, so the GM gets the last word on every guess:
//   1. readPlaybook reads the pages into a DRAFT: the playbook's fixed fields (name, stats, HP,
//      damage, looks, origins, introductions) and a list of movable BLOCKS, one per thing it found
//      (a background, an instinct, a possession, a move, a question, a note). Each block keeps its
//      own title and text, the hints the page gave (a ticked box, ☐☐☐, a pip track), the kind it
//      was read as, whether the reader is UNSURE of that and why. What needs the GM's answer
//      (an HP printed twice, a damage die printed as "d6/d8") is listed in `draft.confirm`.
//   2. assemblePlaybook turns a draft into a bundle, reading each block AS ITS CURRENT KIND. The
//      review window (PlaybookImportReview) lets the GM change a block's kind and answer the
//      confirmations, then assembles; a block moved from Moves to Questions is rebuilt from its
//      text, so moving it never loses any.
//
// Written against the community "Stonetop Playbook Template" that third-party playbooks are made
// from, and the book's own vocabulary (Background, Instinct, Appearance, Place of origin and
// name, Special possessions, Moves, Introductions). It reads:
//   - SECTIONS from the template's heading face (Avara), or any line set noticeably larger;
//   - ITEMS from a leading checkbox: "☐ NAME" (a background, an instinct, a move), "☑" a starting
//     move, "☐☐☐" a move taken up to three times, "●●●" after the name a resource track;
//   - everything else as prose, kept with the item or section it sits under.
// A section it has no slot for (Belonging, a Monster Compendium insert, its own advancement rules)
// is read as questions, moves or notes by its shape, and marked UNSURE for the GM to settle.

import { layoutDocument } from "./layout.js";
import { emptyBundle, HP_LIMITS, DAMAGE_DICE } from "../homebrew-bundle.js";
import { wholeWordPattern, looseName, slugify } from "../../utils/strings.js";
import { pickCountRange } from "../../actors/character/lore-pick-count.js";
import { parseTiersFromProse } from "../../utils/move-tiers.js";

// Brackets are taken off before this is tried ("(WIS)(WIS)" is " WIS  WIS "), so the bare
// abbreviations are here too: missed, the stat box's labels ran on into the move above them.
const STAT_WORDS = /^(?:strength|dexterity|intelligence|wisdom|constitution|charisma|\((?:str|dex|int|wis|con|cha)\)|str|dex|int|wis|con|cha|weakened|dazed|miserable|damage|hp|\(max|\d+\)|armor|xp|level|i|am|called…?|\s)+$/i;
const CREDIT = /\s*Created by\b.*?(?:from the Noun Project)?\s*$|^\s*from the Noun Project\s*$/i;
const BACK_PAGE = /^(inventory|small items|possessions, items, loot|other things|followers|player['’]?s (agenda|principles)|prosperity|when in doubt|triggering moves|hold and spend|notes|undefined)\b/i;
const TITLE_CAPS = /^[^a-z]*[A-Z][^a-z]*$/;

const KNOWN = [
	["stats", /^stats$/i],
	["moves", /^moves$/i],
	["backgrounds", /^backgrounds?\b/i],
	["instincts", /^(instincts?|drives?)\b/i],
	["appearance", /^appearance\b/i],
	["origin", /^place of origin\b/i],
	["possessions", /^special possessions\b/i],
	["intro", /^introductions\b/i],
];

const titleCase = s => String(s).toLowerCase().replace(/(^|[\s(“"'-])([a-z])/g, (m, a, b) => a + b.toUpperCase())
	.replace(/\b(Of|The|And|A|An|In|On|To|For|With|From|At|By|Or)\b/g, (m, w, i) => (i === 0 ? w : w.toLowerCase()))
	.replace(/^./, c => c.toUpperCase());

/** More pages than any playbook has: a book, or a bundle of playbooks, not one to read. */
export const TOO_MANY_PAGES = 16;
/** More pages than a playbook usually has: read, with a word of warning. */
const MANY_PAGES = 6;

/** Where a block can go, in the order the review window offers them. */
export const BLOCK_KINDS = Object.freeze([
	{ kind: "background", label: "Background" },
	{ kind: "instinct", label: "Instinct or Drive" },
	{ kind: "possession", label: "Special possession" },
	{ kind: "startingMove", label: "Starting move" },
	{ kind: "move", label: "Move" },
	{ kind: "question", label: "Question for character creation" },
	{ kind: "note", label: "Notes" },
	{ kind: "skip", label: "Leave it out" },
].map(Object.freeze));

/**
 * @param {object} pageRuns  PageRuns (pdf-text-source.js)
 * @returns {{ draft: object|null, report: { noText: boolean, template: boolean, pages: string[], sections: string[], issues: object[] } }}
 *   The draft goes to the review window; assemblePlaybook(draft) makes the bundle, as read or as reviewed.
 */
export function readPlaybook(pageRuns) {
	const report = { noText: false, tooLong: false, pageCount: 0, template: false, pages: [], sections: [], issues: [] };
	const issue = (severity, message, text = "") => report.issues.push({ severity, message, text });
	try {
		// A playbook is a few pages; a rulebook picked by mistake is hundreds. Say so, read nothing.
		report.pageCount = Number(pageRuns?.meta?.pageCount) || (pageRuns?.pages?.length ?? 0);
		if (report.pageCount > TOO_MANY_PAGES) {
			report.tooLong = true;
			return { draft: null, report };
		}
		const chars = (pageRuns?.pages ?? []).reduce((n, p) => n + p.runs.reduce((m, r) => m + r.str.trim().length, 0), 0);
		if (chars < 50) {
			report.noText = true;
			return { draft: null, report };
		}
		return { draft: _read(pageRuns, report, issue), report };
	} catch (err) {
		issue("missing", `The PDF could not be read all the way through (${err?.message ?? err}). What was read is in the builder.`);
		return { draft: null, report };
	}
}

// ---- Lines -> sections ----------------------------------------------------------------------

function _stream(pageRuns) {
	const lines = [];
	layoutDocument(pageRuns).pages.forEach((page, p) => page.columns.forEach((col, c) => {
		for (const line of col.lines) {
			const cleaned = { ...line, page: p + 1, col: c + 1, text: line.text.replace(CREDIT, "").trim() };
			if (!cleaned.text && !cleaned.lead.boxes) continue;
			if (!cleaned.lead.boxes && STAT_WORDS.test(cleaned.text.replace(/[()]/g, " ").replace(/StrengthStrength|DexterityDexterity/g, ""))) {
				// The stat box's own labels: kept only where the HP and damage are read from.
				cleaned.statChrome = true;
			}
			lines.push(cleaned);
		}
	}));
	return lines;
}

/** Is this line a section heading? Avara face, or set clearly larger than the body. */
function _isHeading(line, bodySize) {
	const h = line.headingText;
	if (h && /[a-z]{2,}/i.test(h)) return true;
	return !line.lead.boxes && line.maxSize >= bodySize * 1.35 && /[a-z]{3,}/i.test(line.text) && line.text.length < 60;
}

const SPAN_GAP = 30; // points of empty column a heading beside it can claim (see below)

/**
 * Lines into sections. A line belongs to the nearest heading above it in its own column, or, with
 * none, to the section still open in reading order (a list running on into the next column).
 *
 * ONE EXCEPTION, for the template's boxes that span two columns (Special possessions across the
 * stats' and introductions' columns): when a line sits below an EMPTY stretch of its own column,
 * and a heading in the column to its left falls inside that stretch, lower than this column's own
 * heading, the line is under that box and belongs to it.
 */
function _sections(lines) {
	const sizes = lines.flatMap(l => l.parts.filter(p => p.role === "body").map(p => Math.round(p.size)));
	const bodySize = _mode(sizes) || 8;
	const out = [{ kind: "preamble", title: "", note: "", lines: [] }];
	const headings = [];
	const streamSection = new Map();
	let current = out[0];
	for (const line of lines) {
		if (_isHeading(line, bodySize)) {
			const title = (line.headingText || line.text).trim();
			const note = line.text.slice(line.text.indexOf(title) + title.length).trim();
			current = { title, note, size: line.maxSize, face: !!line.headingText, page: line.page, col: line.col, y: line.y, lines: [] };
			out.push(current);
			headings.push(current);
		} else {
			streamSection.set(line, current);
		}
	}
	const nearestAbove = (page, col, below, above = -Infinity) => headings
		.filter(h => h.page === page && h.col === col && h.y < below && h.y > above)
		.sort((a, b) => b.y - a.y)[0] ?? null;
	let prev = null;
	let claimed = null; // a heading beside this column that has taken the rest of it
	for (const line of lines) {
		if (!streamSection.has(line)) continue;
		if (prev && (prev.page !== line.page || prev.col !== line.col)) { prev = null; claimed = null; }
		const own = nearestAbove(line.page, line.col, line.y);
		if (claimed && own && own.y > claimed.y) claimed = null; // this column's own next heading ends the claim
		const beside = prev && line.y - prev.y > SPAN_GAP ? nearestAbove(line.page, line.col - 1, line.y, prev.y) : null;
		// Not when this column's own heading opened in that same gap (it is this line's section),
		// and only for a heading clearly lower than this column's own: rows of the template line up
		// across columns, so two headings a point apart are side by side, not one under the other.
		const ownJustOpened = own && prev && own.y > prev.y;
		if (beside && !ownJustOpened && (!own || beside.y > own.y + 10)) claimed = beside;
		const target = claimed ?? own ?? streamSection.get(line);
		target.lines.push(line);
		if (!line.statChrome) prev = line;
	}
	return out;
}

function _mode(values) {
	const counts = new Map();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	let best = 0, bestN = 0;
	for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
	return best;
}

// ---- Items -----------------------------------------------------------------------------------

/** The line's prose with the book's emphasis typed as the builder's asterisks. */
function _lineText(line, { skipLead = true } = {}) {
	let out = "";
	let leading = skipLead;
	let afterGlyph = false;
	for (const p of line.parts) {
		if (p.role === "dingbat") {
			if (leading) continue;
			const s = p.text.replace(/\s+/g, "");
			out += s.replace(/l/g, "○").replace(/u/g, "◇").replace(/n/g, "☐").replace(/4/g, "✓");
			afterGlyph = !!s;
			continue;
		}
		if (leading && p.text.trim()) leading = false;
		if (p.role === "gap") { out += " "; continue; }
		const m = p.text.match(/^(\s*)(.*?)(\s*)$/s);
		const core = m[2];
		if (!core) { out += p.text; continue; }
		// "Poisoner's kit (○○○ uses)", "Spend ☐ to hold": the template sets the word right against
		// the glyph, the space being the glyph's own.
		if (afterGlyph && !m[1] && /^[\p{L}\p{N}]/u.test(core)) out += " ";
		afterGlyph = false;
		// Punctuation alone in a styled face (an italic comma after a tag) is not worth a span.
		const wrap = /^[\p{P}\s]+$/u.test(core) ? "" : p.role === "bolditalic" ? "***" : p.role === "italic" ? "*" : "";
		out += m[1] + (wrap ? wrap + core + wrap : core) + m[3];
	}
	return out.replace(/\s+/g, " ").trim().replace(CREDIT, "");
}

/** The item's caps title (bold, ALL CAPS) off its first line, and the rest of that line. */
function _title(line) {
	const parts = line.parts.filter(p => p.role !== "dingbat");
	let title = "";
	let i = 0;
	while (i < parts.length && !parts[i].text.trim()) i++;
	while (i < parts.length && (parts[i].role === "bold" || parts[i].role === "heading") && TITLE_CAPS.test(parts[i].text.trim() || "A")) {
		title += parts[i].text;
		i++;
	}
	title = title.replace(/\s+/g, " ").trim();
	if (title.replace(/[^A-Za-z]/g, "").length < 2) return { title: "", rest: _lineText(line) };
	let rest = _lineText({ ...line, parts: parts.slice(i) }, { skipLead: false });
	// "CURSED  Doom ●●●": the word before the pips names the track; it is not the prose.
	const label = line.pips?.[0]?.label;
	if (label && !title.toUpperCase().endsWith(label.toUpperCase())) {
		const word = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		rest = rest.replace(new RegExp(`^\\**${word}\\**\\s*`), "");
	}
	rest = rest.replace(/^○+\s*/, "");
	return { title, rest };
}

/**
 * Group a section's lines into items (a checkbox line and what follows it) and loose prose.
 * `titled`: items are named in caps (backgrounds, instincts, moves); an untitled checkbox line
 * inside one is part of its body (a move's own pick-list), and so is every plain line after it.
 */
function _items(lines, { greedy = false } = {}) {
	const items = [];
	const loose = [];
	let cur = null;
	for (const line of lines) {
		if (line.statChrome) continue;
		if (line.lead.boxes) {
			const t = _title(line);
			// A box set in under an item is one of ITS options (Weapons of War's weapons). Indents are
			// compared within a column: the next column's lines all sit further right.
			if (cur && !t.title && _sameColumn(line, cur.line) && line.indent > cur.line.indent + 6) { cur.body.push({ line, bullet: true }); continue; }
			if (t.title || !cur || !cur.title) {
				cur = { line, title: t.title, first: t.rest, body: [], boxes: line.lead.boxes, ticked: line.lead.ticked, pips: line.pips, x: line.x, subs: [] };
				items.push(cur);
				continue;
			}
			cur.body.push({ line, bullet: true });
			continue;
		}
		if (cur && (cur.title || line.indent > cur.line.indent + 6 || (greedy && line.y > cur.line.y))) { cur.body.push({ line }); continue; }
		cur = null;
		loose.push(line);
	}
	return { items, loose };
}

const _sameColumn = (a, b) => a.page === b.page && a.col === b.col;

/** Does this text end a sentence (so what follows may open a paragraph or a bullet of its own)? */
const _endsSentence = text => /[.!?:;…]["'”’)\]*]*$/.test(String(text).trim());

/**
 * Did `prev` run to the column's right edge, so the next line's first word didn't fit on it? The
 * template draws its list bullets (◎) as pictures, not text, so a bullet's second line sits at the
 * same x as a new bullet; this is what tells them apart. `right` is the column's right edge.
 */
function _ranFull(prev, prevText, nextText, right) {
	if (!prev || !Number.isFinite(prev.end) || !Number.isFinite(right)) return false;
	const word = String(nextText).split(/\s+/)[0] ?? "";
	// The word's width at the previous line's own letter width, and a space before it.
	const chars = String(prevText).replace(/\*/g, "").length || 1;
	const perChar = Math.max(1, (prev.end - prev.x) / chars);
	return prev.end + perChar * (word.length + 1) >= right - 1;
}

/** Lines of prose into builder text: paragraphs at wide gaps, bullets for indented or boxed lines. */
function _prose(entries, baseX = null) {
	let out = "";
	let prevY = null;
	let spacing = null;
	let prev = null;      // the last line written, and its text
	let prevText = "";
	let bulletX = null;   // the x of the bullet being written, while one is open
	const x0 = baseX ?? Math.min(...entries.map(e => (e.line ?? e).x));
	const right = Math.max(...entries.map(e => (e.line ?? e).end ?? -Infinity));
	for (const e of entries) {
		const line = e.line ?? e;
		if (line.statChrome) continue;
		const text = _lineText(line);
		if (!text) continue;
		const gap = prevY === null ? 0 : line.y - prevY;
		if (prevY !== null && spacing === null && gap > 0) spacing = gap;
		const boxed = !!line.lead?.boxes && e !== entries[0];
		const bullet = e.bullet || line.x > x0 + 8 || boxed;
		const near = gap <= (spacing ?? 9.5) * 1.5;
		// A bullet's sentence carried on to the next line: the line before ran to the edge, and this one
		// picks up in lower case ("…participate in something / monstrous."). A capital is a new bullet.
		const carried = !!prev && near && _ranFull(prev, prevText, text, right) && !/^[A-Z“"‘'(]/.test(text);
		if (!out) out = bullet ? `- ${text}` : text;
		else if (bullet && !e.bullet && !boxed && bulletX !== null && Math.abs(line.x - bulletX) < 2 && carried) out += ` ${text}`;
		else if (bullet) out += `\n- ${text}`;
		// A wide gap is a new paragraph, unless the line before stopped mid-sentence (the template's
		// leading is uneven: "(choose" over "1 or 2)" can sit as far apart as two paragraphs).
		else if (gap > (spacing ?? 9.5) * 1.5 && !(!_endsSentence(prevText) && (/^[^A-Z“"‘'(]/.test(text) || _ranFull(prev, prevText, text, right)))) out += `\n\n${text}`;
		else if (/\n- [^\n]*$/.test(out) && line.x <= x0 + 8) out += `\n\n${text}`;
		else out += (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(text) ? "" : " ") + text;
		bulletX = bullet ? line.x : null;
		prevY = line.y;
		prev = line;
		prevText = text;
	}
	return _mergeEmphasis(out.trim());
}

/** A trigger that wraps arrives as two spans ("***a*** ***b***"); make it one. */
function _mergeEmphasis(text) {
	return text.replace(/\*\*\* \*\*\*/g, " ").replace(/(?<!\*)\* \*(?!\*)/g, " ");
}

/** An item's lines run together as one plain line: an origin's names, a possession's contents. */
function _itemFlat(item) {
	return _mergeEmphasis([item.first, ...item.body.map(e => _lineText(e.line))].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
}

/** Like _itemFlat, but an option boxed in under the item stays a bullet of its own. */
function _itemBulleted(item) {
	let out = item.first ?? "";
	for (const e of item.body) {
		const t = _lineText(e.line);
		if (!t) continue;
		out += e.bullet ? `\n- ${t}` : ` ${t}`;
	}
	return _mergeEmphasis(out.replace(/[ \t]+/g, " ").trim());
}

function _itemText(item) {
	const head = item.first ? [{ line: { ...item.line, parts: [{ text: item.first, role: "body" }], x: item.x } }] : [];
	return _prose([...head, ...item.body], item.x);
}

// ---- The reader: sections -> a draft ---------------------------------------------------------

function _read(pageRuns, report, issue) {
	const lines = _stream(pageRuns);
	const sections = _sections(lines);
	let ids = 0;
	const draft = {
		fields: {
			name: "", description: "",
			// The creator, as the PDF records it (its Author), credited on the playbook.
			author: String(pageRuns?.meta?.author ?? "").trim().slice(0, 80),
			statsNote: emptyBundle().playbook.statsNote, hp: 16, damage: "d6",
			instinctLabel: "Instinct", startingMovesNote: "",
			possessions: { pickNote: "", pickCount: 0 },
			appearance: [], origin: [],
			introductions: { step3: "", step4: [], step6: [] },
		},
		confirm: [],
		blocks: [],
		// The playbook's INSERTS (the Stranger's Monster Compendium): plain data, so a review can be
		// stored and brought back. Each piece of one is an ordinary block whose `insert` is its id.
		inserts: [],
		report,
		/** Add a block. `from` says where on the page it was read, for the GM. */
		add(kind, { title = "", text = "", options = null, extra = {}, from = "", unsure = false, why = "", insert = "" } = {}) {
			const block = { id: `b${++ids}`, kind, readAs: kind, title, text, options, extra, from, unsure, why, insert, readInsert: insert };
			this.blocks.push(block);
			return block;
		},
	};
	const f = draft.fields;

	// The playbook's name: the largest heading on the first page that has one.
	const named = sections.filter(s => s.title).sort((a, b) => (a.page - b.page) || (b.size - a.size));
	const firstPage = named[0]?.page;
	const biggest = Math.max(...named.filter(n => n.page === firstPage).map(n => n.size));
	const nameSection = named.find(s => s.page === firstPage && s.size === biggest);
	if (nameSection && nameSection.size >= 14) {
		f.name = nameSection.title.trim();
		nameSection.kind = "name";
		f.description = _prose(nameSection.lines).replace(/\*/g, "");
	} else {
		draft.confirm.push({ key: "name", type: "text", label: "What is this playbook called?", why: "No name was found at the top of the first page.", value: "" });
	}

	// Before the known sections take their slots: an insert's own "Instinct" must never take the
	// playbook's.
	const inserts = _findInserts(sections, nameSection?.page ?? firstPage);
	draft.inserts = inserts.map(i => i.data);

	const seen = new Set();
	for (const s of sections) {
		if (s.kind) continue;
		if (BACK_PAGE.test(s.title)) { s.kind = "backpage"; continue; }
		if (!/[a-z]{2,}/i.test(s.title)) { s.kind = "skip"; continue; }
		const known = KNOWN.find(([, re]) => re.test(s.title));
		if (known && !seen.has(known[0])) { s.kind = known[0]; seen.add(known[0]); }
		else s.kind = "custom";
	}
	// Made with the community template? Its own headings are the tell.
	report.template = seen.size >= 3;

	const pages = new Map();
	for (const s of sections) {
		if (!s.page) continue;
		const list = pages.get(s.page) ?? [];
		if (s.kind === "insert" && !s.insertHead) continue;
		list.push(s.kind === "backpage" ? "the stock inventory sheet (skipped)"
			: s.kind === "name" ? `the name (${s.title})`
			: s.kind === "insert" ? `the ${s.insert.data.name} insert (${s.insert.sections.slice(1).map(x => x.title).join(", ") || "one part"})`
			: s.title);
		pages.set(s.page, list);
	}
	for (const [page, list] of pages) report.pages.push(`Page ${page}: ${[...new Set(list)].join(", ")}`);

	const customs = [];
	for (const s of sections) {
		switch (s.kind) {
			case "stats": _stats(s, draft, lines); break;
			case "moves": _moves(s, draft); break;
			case "backgrounds": _backgrounds(s, draft); break;
			case "instincts": _instincts(s, draft); break;
			case "appearance": f.appearance = s.lines.filter(l => l.lead.boxes && !l.statChrome).map(_options).filter(r => r.length); break;
			case "origin": _origin(s, draft); break;
			case "possessions": _possessions(s, draft); break;
			case "intro": _intro(s, draft); break;
			case "custom": customs.push(s); break;
			default: break;
		}
		if (s.kind === "insert") { if (s.insertHead) report.sections.push(`${s.title} → an insert`); continue; }
		if (s.kind && !["skip", "backpage", "preamble"].includes(s.kind)) report.sections.push(`${s.title} → ${_kindLabel(s.kind)}`);
	}
	for (const s of customs) _custom(s, draft);
	for (const ins of inserts) _insertParts(ins, draft);

	// A move the starting-moves line names is a starting move, ticked or not.
	for (const b of draft.blocks) {
		if (b.kind === "move" && !b.insert && _names(f.startingMovesNote, b.title)) { b.kind = "startingMove"; b.readAs = "startingMove"; }
	}
	for (const ins of inserts) _askInsert(ins, draft);

	if (!seen.has("stats")) {
		draft.confirm.push({ key: "hp", type: "number", label: "Max HP", why: "No stats box was found, so the HP is a guess.", value: f.hp, choices: [] });
	}
	for (const k of ["backgrounds", "instincts", "moves"]) {
		if (!seen.has(k)) issue("missing", `No "${_kindLabel(k)}" section was found; fill it in by hand if the playbook has one.`);
	}
	if (report.pageCount > MANY_PAGES) {
		issue("check", `This PDF has ${report.pageCount} pages, more than a playbook usually has. If it holds several playbooks, only one is read here; save each playbook as its own PDF to import the others.`);
	}
	if (!report.template) {
		issue("check", "This PDF doesn't look like it was made with the community Stonetop playbook template, so pieces of it may be in the wrong place: check each one. For an easier import next time, ask its creator to make it with that template.");
	}
	return draft;
}

const _names = (text, name) => !!name && wholeWordPattern(name, "i").test(String(text ?? ""));

function _kindLabel(kind) {
	return ({ stats: "Stats & HP", moves: "Moves", backgrounds: "Backgrounds", instincts: "Instincts", appearance: "Appearance",
		origin: "Origins", possessions: "Special Possessions", intro: "Introductions", custom: "its own section", name: "the name" })[kind] ?? kind;
}

function _stats(s, draft, lines) {
	const f = draft.fields;
	const note = s.note.match(/[^.]*assign[^.]*[+-]\d[^.]*\./i)?.[0]?.trim();
	if (note) f.statsNote = note;
	const scores = (note ?? "").match(/[+-]?\d+/g) ?? [];
	if (scores.length !== 6) {
		draft.confirm.push({ key: "statsNote", type: "text", label: "The stat scores characters assign",
			why: note ? "The stats line doesn't hand out exactly six scores." : "The stats line wasn't found.", value: f.statsNote });
	}

	const text = lines.filter(l => l.page === s.page).map(l => l.text).join(" ");
	const dice = [...text.matchAll(/\bd(4|6|8|10|12)\b(?:\s*\/\s*d(4|6|8|10|12))?/g)];
	if (dice.length) {
		f.damage = `d${dice[0][1]}`;
		if (dice[0][2]) {
			draft.confirm.push({ key: "damage", type: "choice", label: "Damage die", why: `The damage box says "${dice[0][0].replace(/\s+/g, "")}". Which does a new character start with? (Put any rule for the other in Notes.)`,
				value: null, choices: [`d${dice[0][1]}`, `d${dice[0][2]}`] });
		}
	} else {
		draft.confirm.push({ key: "damage", type: "choice", label: "Damage die", why: "No damage die was found in the stats box.", value: f.damage, choices: [...DAMAGE_DICE] });
	}

	const hps = [...new Set([...text.matchAll(/HP\s*\(max\s*(\d+)\)/gi)].map(m => Number(m[1])))];
	if (hps.length > 1) {
		f.hp = hps[0];
		draft.confirm.push({ key: "hp", type: "number", label: "Max HP", why: `The HP box holds two different numbers (${hps.join(" and ")}), printed one over the other, so the PDF can't say which one shows. Look at the playbook and pick the one you see.`, value: null, choices: hps });
	} else if (hps.length === 1) {
		f.hp = hps[0];
		if (hps[0] < HP_LIMITS.usualMin || hps[0] > HP_LIMITS.usualMax) {
			draft.confirm.push({ key: "hp", type: "number", label: "Max HP", why: `The HP box says ${hps[0]}, which is unusual (most playbooks start between ${HP_LIMITS.usualMin} and ${HP_LIMITS.usualMax}). Is that right?`, value: hps[0], choices: [hps[0]] });
		}
	} else {
		draft.confirm.push({ key: "hp", type: "number", label: "Max HP", why: "No HP was found in the stats box.", value: f.hp, choices: [] });
	}
}

function _moves(s, draft, { keepNote = false, from = "Moves" } = {}) {
	if (!keepNote) draft.fields.startingMovesNote = s.note.trim();
	const { items } = _items(s.lines);
	for (const item of items) {
		if (!item.title) continue;
		const title = titleCase(item.title.replace(/^\((.*)\)$/, "$1"));
		const extra = { ticked: !!item.ticked, boxes: item.boxes, pips: item.pips ?? [], rawTitle: item.title };
		if (/^custom$/i.test(title)) {
			draft.add("skip", { title: "Custom move", text: _itemText(item), extra, from, unsure: true,
				why: "A write-in move the player makes up with the GM. Left out unless you want it as a move or a note." });
			continue;
		}
		draft.add(item.ticked ? "startingMove" : "move", { title, text: _itemText(item), extra, from });
	}
}

function _backgroundMoves(text) {
	const plain = String(text).replace(/\*/g, "");
	const moves = [];
	let moveChoice = [];
	const list = plain.match(/one of the following moves:\s*([^.\n]+)/i)?.[1];
	if (list) {
		moveChoice = list.split(/\s*,\s*(?:or\s+)?|\s+or\s+/i)
			.map(x => x.replace(/\s+from\s+the\s+.*$/i, "").trim()).filter(Boolean).map(titleCase);
	}
	for (const m of plain.matchAll(/\b(?:gain|get|start with|take)\s+the\s+(.+?)\s+move\b/gi)) moves.push(titleCase(m[1].replace(/[“”"]/g, "")));
	return { moves: [...new Set(moves)], moveChoice };
}

/**
 * Special possessions a background gives on top of the pick, by the names it uses: "You get
 * Weapons of War as a special possession", "Add grave tender's tools as an additional special
 * possession". Matched to the playbook's own possessions when the playbook is written.
 */
function _backgroundPossessions(text) {
	const plain = String(text).replace(/\*/g, "");
	const out = [];
	// The name never runs across a colon or a sentence: "You get one of the following moves: … You get
	// Weapons of War as a special possession" names Weapons of War.
	for (const m of plain.matchAll(/\b(?:get|gain|add|take|start with)\s+([^.:;\n]+?)\s+as\s+(?:a|an|your)?\s*(?:additional|extra|bonus)?\s*special possession/gi)) {
		out.push(m[1].replace(/^(?:the|a|an|your)\s+/i, "").trim());
	}
	return [...new Set(out)];
}

function _backgrounds(s, draft) {
	for (const i of _items(s.lines).items.filter(x => x.title)) {
		draft.add("background", { title: titleCase(i.title), text: _itemText(i), extra: { pips: i.pips ?? [] }, from: "Background" });
	}
}

function _instincts(s, draft) {
	if (/^drive/i.test(s.title)) draft.fields.instinctLabel = "Drive";
	const label = draft.fields.instinctLabel;
	const { items, loose } = _items(s.lines);
	for (const i of items.filter(x => x.title)) draft.add("instinct", { title: titleCase(i.title), text: _itemText(i), from: label });
	const prose = _prose(loose);
	if (prose) draft.add("note", { title: `${label}s`, text: prose, from: label });
}

/** A line's options split at its checkboxes ("☐ grim ☐ ethereal ☐ tragic"). */
function _options(line) {
	const out = [];
	let cur = "";
	for (const p of line.parts) {
		if (p.role === "dingbat" && /n/.test(p.text)) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
		if (p.role === "dingbat") continue;
		cur += p.text;
	}
	if (cur.trim()) out.push(cur.trim());
	return out.map(o => o.replace(/\s+/g, " ").replace(/^[•\-–]\s*/, "")).filter(Boolean);
}

function _origin(s, draft) {
	const { items } = _items(s.lines, { greedy: true });
	const questions = [];
	for (const item of items) {
		const text = _itemFlat(item).replace(/\*/g, "");
		const i = text.indexOf(":");
		if (i < 0) continue;
		const region = text.slice(0, i).trim();
		const rest = text.slice(i + 1).trim();
		const names = rest.split(/\s*,\s*|\s+or\s+/).map(n => n.replace(/^or\s+/i, "").replace(/[.,]$/, "").trim()).filter(Boolean);
		const looksLikeNames = names.length >= 2 && names.every(n => /^[A-Z][\w'’-]*(\s[A-Z][\w'’-]*)?$/.test(n));
		if (/discuss with gm|tell us/i.test(region + rest) && !looksLikeNames) continue;
		draft.fields.origin.push({ region, names: looksLikeNames ? names : [] });
		if (!looksLikeNames && rest && !/pick a name/i.test(rest)) questions.push(`- ${region}: ${rest}`);
	}
	if (questions.length) draft.add("note", { title: "Place of origin questions", text: questions.join("\n"), from: "Place of origin" });
}

/**
 * The template sets Special Possessions in a box across the top of two columns and lets the move
 * list run on UNDER it, with no heading of its own. So, column by column: from the first move
 * (a caps-titled item) to the foot of that column, the lines are moves, not possessions.
 */
function _splitPossessionColumns(lines) {
	const possessions = [];
	const moves = [];
	let col = null;
	let inMoves = false;
	for (const line of lines) {
		const key = `${line.page}:${line.col}`;
		if (key !== col) { col = key; inMoves = false; }
		if (!inMoves && line.lead.boxes && _title(line).title) inMoves = true;
		(inMoves ? moves : possessions).push(line);
	}
	return { possessions, moves };
}

function _possessions(s, draft) {
	const f = draft.fields;
	const note = s.note.replace(/^\(|\)$/g, "").trim();
	f.possessions.pickNote = note;
	f.possessions.pickCount = Number(note.match(/\d+/)?.[0] ?? 0) || 2;
	const split = _splitPossessionColumns(s.lines);
	if (split.moves.length) _moves({ note: "", lines: split.moves }, draft, { keepNote: true, from: "Moves (set under Special possessions)" });
	const { items, loose } = _items(split.possessions, { greedy: true });
	let count = 0;
	for (const item of items) {
		const text = _itemBulleted(item);
		const plain = text.replace(/\*/g, "");
		if (/^\(?discuss with gm\)?$/i.test(plain.trim())) continue;
		// "Artist's tools: paint, brushes…" or "Poisoner's kit (○○○ uses): …": the name ends at the
		// first colon or bracket, and what follows is what it is.
		const m = text.match(/^(.*?)(?:\s*:\s*|\s+(?=\())(.*)$/s);
		const label = (m ? m[1] : text).replace(/\*/g, "").trim().slice(0, 80);
		draft.add("possession", { title: label, text: m ? m[2].trim() : "", extra: { ticked: !!item.ticked }, from: "Special possessions" });
		count++;
	}
	const prose = _prose(loose);
	if (prose) {
		draft.add("note", { title: "Special possessions", text: prose, from: "Special possessions", unsure: !count,
			why: count ? "" : "No possessions with checkboxes were found, only this text. If it describes possessions every character starts with, split it into one piece each, then put each in Special possessions." });
	}
}

function _intro(s, draft) {
	const intro = draft.fields.introductions;
	const steps = new Map();
	let step = 0;
	const free = [];
	for (const line of s.lines) {
		const digit = (line.headingText || "").match(/^(\d)$/)?.[1] ?? line.text.match(/^(\d)\s+On your/i)?.[1];
		if (digit) { step = Number(digit); steps.set(step, { text: [line], items: [] }); continue; }
		if (!step) { free.push(line); continue; }
		const cur = steps.get(step);
		if (line.lead.boxes) cur.items.push([line]);
		else if (cur.items.length && line.x > cur.items[cur.items.length - 1][0].x + 6) cur.items[cur.items.length - 1].push(line);
		else cur.text.push(line);
	}
	const join = ls => ls.map(l => _lineText(l)).join(" ").replace(/^\d\s+/, "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
	if (steps.has(3)) intro.step3 = join(steps.get(3).text).replace(/^On your third turn,?\s*/i, "");
	if (steps.has(4)) intro.step4 = steps.get(4).items.map(join).filter(Boolean);
	if (steps.has(6)) intro.step6 = steps.get(6).items.map(join).filter(Boolean);
	if (!steps.size) {
		const prose = _prose(free);
		if (prose) draft.add("note", { title: "Introductions", text: prose, from: "Introductions" });
	}
}

/**
 * "I was discovered and adopted by ____": the template draws the blank as a line, not text, so all
 * that is left of it is the word it hangs off. Give it back as the "___" the sheet makes a box of.
 */
function _blankAfterDanglingWord(text) {
	const t = String(text ?? "").trim();
	if (/_{3,}/.test(t)) return t;
	return /\b(?:from|by|with|of|to|for|at|about|named|called|into|toward|towards|against|than|as)$/i.test(t) ? `${t} ___` : t;
}

/**
 * A short title for one of several questions under a heading: its own question ("How did you
 * arrive in Stonetop?"), else the clause that leads into its options ("When you were young they …").
 */
function _questionTitle(prompt) {
	const plain = String(prompt ?? "").replace(/\*/g, "").replace(/\s*\((?:choose|pick)[^)]*\)\s*/gi, " ").replace(/\s+/g, " ").trim();
	if (!plain) return "";
	const sentences = plain.match(/[^.?!]+[.?!]?/g)?.map(x => x.trim()).filter(Boolean) ?? [plain];
	const asked = sentences.find(x => x.endsWith("?"));
	let title = (asked ?? sentences.at(-1)).replace(/^(?:tell us|so|and|but),\s*/i, "");
	title = title.charAt(0).toUpperCase() + title.slice(1);
	return title.length > 90 ? `${title.slice(0, 87).replace(/\s+\S*$/, "")}…` : title;
}

/** A section the book's playbooks don't have: read by its shape, every piece marked for the GM. */
function _custom(s, draft) {
	const { items, loose } = _items(s.lines);
	const titled = items.filter(i => i.title);
	const heading = s.title.trim();
	const from = `${heading} (page ${s.page})`;
	const retag = as => {
		const i = draft.report.sections.findIndex(x => x.startsWith(`${s.title} →`));
		if (i >= 0) draft.report.sections[i] = `${s.title} → ${as}`;
	};

	// A move printed as its own section ("Your Finest Hour"), named among the starting moves.
	if (!items.length && _names(draft.fields.startingMovesNote, heading)) {
		draft.add("startingMove", { title: heading, text: _prose(s.lines), from, unsure: true,
			why: `"${heading}" is printed as a section of its own, not as a move, but the starting moves name it.` });
		retag("a starting move");
		return;
	}
	// Moves of an insert ("Monster Moves"): caps-titled items with a body.
	if (titled.length && titled.length >= items.length / 2 && titled.some(i => i.body.length)) {
		const intro = [s.note, _prose(loose)].filter(Boolean).join(" ");
		if (intro) draft.add("note", { title: heading, text: intro, from, unsure: true, why: `The opening text of "${heading}", a part of the playbook the book's playbooks don't have.` });
		for (const item of titled) {
			const title = titleCase(item.title.replace(/^\((.*)\)$/, "$1"));
			if (draft.blocks.some(b => ["move", "startingMove"].includes(b.kind) && b.title.toLowerCase() === title.toLowerCase())) continue;
			draft.add("move", { title, text: _itemText(item), from, unsure: true,
				extra: { ticked: !!item.ticked, boxes: item.boxes, pips: item.pips ?? [], rawTitle: item.title, requires: `From the playbook's "${heading}"` },
				why: `Read as a move from "${heading}", a part of the playbook the book's playbooks don't have. Characters can take it only through whatever "${heading}" says.` });
		}
		retag("moves");
		return;
	}
	// Questions: checkbox options under prompts. Each prompt with its options is one question.
	if (items.length && !/advancement|level up|beginning/i.test(heading)) {
		const groups = [];
		let group = null;
		for (const line of s.lines) {
			if (line.statChrome) continue;
			if (line.lead.boxes) {
				if (!group) { group = { prompt: [], options: [] }; groups.push(group); }
				const opts = _options(line);
				if (!opts.length) group.options.push({ description: "Something else", max: 1, freeText: true });
				for (const o of opts) group.options.push({ description: o.replace(/\*/g, ""), max: 1, freeText: false });
				continue;
			}
			if (group && group.options.length && line.indent > 6) {
				const last = group.options[group.options.length - 1];
				last.description = `${last.description} ${_lineText(line).replace(/\*/g, "")}`.trim();
				continue;
			}
			if (!group || group.options.length) { group = { prompt: [], options: [] }; groups.push(group); }
			group.prompt.push(line);
		}
		const asked = groups.filter(g => g.options.length || _prose(g.prompt));
		for (const g of groups) {
			const text = _prose(g.prompt);
			if (!g.options.length && !text) continue;
			// Several questions under one heading (the Stranger's five under "Belonging"): each is
			// titled by its own question, and the heading stands over them as a group.
			const several = asked.length > 1;
			draft.add("question", { title: several ? (_questionTitle(text) || heading) : heading, text,
				extra: several ? { group: heading } : {},
				options: g.options.length
					? g.options.map(o => (o.freeText ? o : { ...o, description: _blankAfterDanglingWord(o.description) }))
					: [{ description: "Your answer", max: 1, freeText: true }],
				from, unsure: true,
				why: `"${heading}" isn't a section the book's playbooks have. Read as a question each player answers in character creation.` });
		}
		retag("questions");
		return;
	}
	const prose = _prose([...s.lines.filter(l => !l.statChrome)]);
	if (prose) {
		draft.add("note", { title: `${heading}${s.note ? ` ${s.note}` : ""}`, text: prose, from, unsure: true,
			why: `"${heading}" has no place on a character sheet, so it is kept as a note for the table.` });
	}
	retag("Notes");
}

// ---- Inserts ---------------------------------------------------------------------------------
//
// An INSERT is a page (or half of one) a playbook adds of its own: the Stranger's Monster
// Compendium, set beside the stock inventory sheet. On the template it has
//   - a TITLE in the heading face, a size up from the sections' headings (12pt over 10pt), with its
//     flavour run on after it on the same line;
//   - SUB-HEADINGS a size down (9pt: "Armament pick 2", "Instinct pick 1"), whose counts follow the
//     word;
//   - and usually a move elsewhere that names it ("Fill out the Stranger's Monster Compendium
//     insert"), which is the move that opens it.
// The stock pages beside it (Inventory, Followers, the Player's Agenda) are never one. Read as an
// insert, its "Instinct pick 1" is its own and can't take the playbook's instincts; its moves are
// its own and Level Up never offers them.

/** "the Stranger's Monster Compendium insert", "Monster Compendium insert": the title named as an insert. */
function _insertMention(title) {
	const words = String(title).trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	return new RegExp(`\\b${words.join("\\s+")}\\s+insert\\b`, "i");
}

const _isKnownTitle = title => KNOWN.some(([, re]) => re.test(title));
const _sectionText = s => [s.title, s.note, ...s.lines.map(l => l.text)].join(" ").replace(/\s+/g, " ");
const _hasCount = note => /\b(?:pick|choose)\s+(?:\d|one|two|three)\b/i.test(String(note ?? ""));

/**
 * Find the inserts and claim their sections (`kind = "insert"`). Runs before the known sections
 * take their slots.
 * @returns {Array<{data: object, sections: object[]}>}  `data` is the draft's plain record
 */
function _findInserts(sections, namePage) {
	const known = sections.filter(s => s.title && _isKnownTitle(s.title) && !BACK_PAGE.test(s.title) && s.kind !== "name");
	const sectionSize = _mode(known.map(s => Math.round(s.size * 2) / 2)) || 10;
	const titleSize = sectionSize * 1.15;
	const out = [];
	for (let i = 0; i < sections.length; i++) {
		const head = sections[i];
		if (head.kind || !head.title || !/[a-z]{2,}/i.test(head.title)) continue;
		if (BACK_PAGE.test(head.title) || _isKnownTitle(head.title)) continue;

		// Its region: the sections after it on its page, in its column or to the right, up to a stock
		// sheet's heading, another title, or one of the playbook's own sections at full size.
		const region = [head];
		for (let j = i + 1; j < sections.length; j++) {
			const s = sections[j];
			if (s.page !== head.page || s.col < head.col || s.kind) break;
			if (BACK_PAGE.test(s.title)) break;
			if (s.face && s.size >= titleSize) break;
			if (_isKnownTitle(s.title) && s.size >= sectionSize - 0.25) break;
			region.push(s);
		}
		const inRegion = new Set(region);
		const mention = _insertMention(head.title);
		const elsewhere = sections.filter(s => !inRegion.has(s) && s.kind !== "backpage" && mention.test(_sectionText(s)));

		const S1 = head.face && head.size >= titleSize;
		const S2 = elsewhere.length > 0;
		const S3 = region.slice(1).some(s => s.size < sectionSize - 0.25 || _hasCount(s.note));
		const S5 = sections.some(s => s.page === head.page && s.col < head.col && BACK_PAGE.test(s.title));
		const hasPieces = region.some(s => s.lines.some(l => l.lead.boxes));
		const offFront = head.page !== namePage;

		const sure = S1 && (offFront || S2) && (S2 || S3);
		const unsure = !sure && ((S1 && (offFront || S2)) || (S2 && head.size >= sectionSize - 0.25) || (S5 && hasPieces));
		if (!sure && !unsure) continue;

		const why = [];
		if (S1) why.push("its title is set like a page's own, larger than the playbook's sections");
		if (S2) why.push(`the playbook calls it an insert ("${head.title} insert")`);
		if (S3) why.push("its parts are headed like an insert's, each with its own count");
		if (S5) why.push("it sits beside the stock inventory sheet");
		const id = `i${out.length + 1}`;
		const data = {
			id,
			name: head.title.trim(),
			page: head.page,
			sure,
			why: why.join("; "),
			// Moves lists the insert holds ("Monster Moves pick 1"): the moves themselves are blocks.
			lists: [],
		};
		const record = { data, sections: region, mention };
		for (const s of region) { s.kind = "insert"; s.insert = record; }
		head.insertHead = true;
		out.push(record);
		i += region.length - 1;
	}
	return out;
}

/**
 * A line's options split at its boxes, keeping what the reader needs for an insert's lists: each
 * box's tick ("n4", printed ticked) and size (a nested option's box is smaller). A box with no
 * words after it is a write-in (`text` "").
 */
function _optionParts(line) {
	const out = [];
	let cur = null;
	for (const p of line.parts) {
		if (p.role === "dingbat") {
			for (const ch of p.text) {
				if (ch === "n") { cur = { text: "", ticked: false, size: p.size }; out.push(cur); }
				else if (ch === "4" && cur) cur.ticked = true;
			}
			continue;
		}
		if (cur) cur.text += p.text;
	}
	for (const o of out) o.text = o.text.replace(/\s+/g, " ").replace(/^[•\-–]\s*/, "").replace(CREDIT, "").trim();
	return out;
}

const PICK_NOTE = /\s*\((?:pick|choose)\s+(?:\d+|one|two|three)\)\s*$/i;

/**
 * An insert list's options, from its boxed lines. A smaller box under an option that asks for its
 * own count ("To devour (pick 1)" over "carrion", "gold & silver") is one of ITS choices: the two
 * become one option each ("To devour: carrion"), in the parent's place.
 * @returns {{options: object[], nested: boolean, prose: object[]}}
 */
function _insertOptions(lines) {
	const raw = [];
	const prose = [];
	for (const line of lines) {
		if (line.statChrome) continue;
		const parts = line.lead.boxes || line.parts.some(p => p.role === "dingbat" && /n/.test(p.text)) ? _optionParts(line) : [];
		if (!parts.length) {
			if (raw.length && line.indent > 6) raw[raw.length - 1].text = `${raw[raw.length - 1].text} ${line.text}`.trim();
			else prose.push(line);
			continue;
		}
		raw.push(...parts);
	}
	const base = _mode(raw.map(o => Math.round(o.size)));
	let parent = null;
	let nested = false;
	for (const o of raw) {
		const small = Math.round(o.size) < base - 0.5;
		if (!small) { if (PICK_NOTE.test(o.text)) parent = o; continue; }
		if (!parent) continue;
		(parent.children ??= []).push(o);
		o.child = true;
		nested = true;
	}
	const options = [];
	const add = (text, o) => options.push(text
		? { description: text.replace(/\*/g, ""), max: 1, freeText: false, ...(o.ticked ? { preselected: true } : {}) }
		: { description: "Something else", max: 1, freeText: true });
	for (const o of raw) {
		if (o.child) continue;
		if (!o.children) { add(o.text, o); continue; }
		const label = o.text.replace(PICK_NOTE, "").trim();
		for (const c of o.children) {
			if (c.text) add(`${label}: ${c.text}`, c);
			else options.push({ description: `${label}: something else`, max: 1, freeText: true });
		}
	}
	return { options, nested, prose };
}

/** An insert's sections into blocks, each carrying the insert's id. */
function _insertParts(record, draft) {
	const ins = record.data;
	const from = `${ins.name} (page ${ins.page})`;
	const doubt = ins.sure ? null : `The reader isn't sure "${ins.name}" is an insert (${ins.why}). Answer the question at the top to keep it as one, or say it isn't.`;
	const base = { from, insert: ins.id };
	for (const s of record.sections) {
		const { items, loose } = _items(s.lines);
		const titled = items.filter(i => i.title);
		if (s.insertHead) {
			const intro = [s.note, _prose(loose)].filter(Boolean).join(" ").trim();
			if (intro) draft.add("note", { ...base, title: ins.name, text: intro, unsure: !!doubt, why: doubt ?? "The insert's opening words: kept as its description." });
		}
		// Moves: caps-titled items with a body. The head's own (Metamorphosis) are held by anyone who
		// opens the insert when ticked; a sub-section's are a list to pick from.
		if (titled.length && titled.length >= items.length / 2 && titled.some(i => i.body.length)) {
			let listKey = "";
			if (!s.insertHead) {
				const range = pickCountRange(s.note);
				listKey = slugify(s.title) || `list-${ins.lists.length + 1}`;
				ins.lists.push({ key: listKey, title: titleCase(s.title), prompt: s.note.trim(), kind: "moves", pick: range?.max ?? 1, min: range?.min ?? 0 });
			}
			for (const item of titled) {
				const title = titleCase(item.title.replace(/^\((.*)\)$/, "$1"));
				const held = s.insertHead && !!item.ticked;
				draft.add(held ? "startingMove" : "move", { ...base, title, text: _itemText(item),
					extra: { ticked: !!item.ticked, boxes: item.boxes, pips: item.pips ?? [], rawTitle: item.title, insertList: listKey },
					unsure: !!doubt, why: doubt ?? (held ? `Printed ticked on "${ins.name}": everyone who opens the insert has it.` : "") });
			}
			continue;
		}
		if (s.insertHead) continue;
		// A list to tick: its count follows its heading ("Armament pick 2").
		if (items.length) {
			const { options, nested, prose } = _insertOptions(s.lines);
			const text = [s.note, _prose(prose)].filter(Boolean).join("\n\n").trim();
			const range = pickCountRange(s.note);
			const uncounted = /\bper\b|\bplus\b/i.test(s.note);
			const whys = [];
			if (doubt) whys.push(doubt);
			if (nested) whys.push("Some of its choices sit under another one; each became an option of its own.");
			if (!range) whys.push("It doesn't say how many to pick, so it counts as one.");
			else if (uncounted) whys.push(`It counts "${s.note.trim()}", which the sheet can't count for you: it takes ${range.max} and only says when there are more.`);
			draft.add("question", { ...base, title: titleCase(s.title), text, options: options.length ? options : [{ description: "Your answer", max: 1, freeText: true }],
				unsure: whys.length > 0, why: whys.join(" ") });
			continue;
		}
		const prose = _prose(s.lines.filter(l => !l.statChrome));
		if (prose || s.note) draft.add("note", { ...base, title: titleCase(s.title), text: [s.note, prose].filter(Boolean).join("\n\n"), unsure: !!doubt, why: doubt ?? "" });
	}
}

/**
 * The GM's question for an insert: which move opens it. The reader's guess is the move whose words
 * name the insert ("Fill out the Stranger's Monster Compendium insert"); only a sure insert with a
 * guess comes pre-answered.
 */
function _askInsert(record, draft) {
	const ins = record.data;
	const opener = draft.blocks.find(b => !b.insert && ["move", "startingMove"].includes(b.kind) && record.mention.test(`${b.text} ${blockOptionLines(b).join(" ")}`));
	ins.guess = opener?.title ?? "";
	draft.confirm.push({
		key: `insert:${ins.id}`, type: "choice", insert: ins.id,
		label: `Page ${ins.page} looks like an insert called "${ins.name}". Which move opens it?`,
		why: ins.sure
			? (ins.guess ? `"${ins.guess}" names it. Its parts are kept apart from the playbook's: its moves are never offered at Level Up, and its lists aren't asked in character creation.` : `Nothing names the move that opens it (${ins.why}).`)
			: `The reader isn't sure (${ins.why}). If it's an ordinary part of the playbook, say it isn't an insert.`,
		value: ins.sure && ins.guess ? ins.guess : null,
	});
}

/** The answer an insert's question holds: a move name, ALWAYS, NOT_INSERT, or null (unanswered). */
export const INSERT_ALWAYS = "__always";
export const INSERT_NONE = "__none";

// ---- The assembler: a draft -> a bundle -------------------------------------------------------

/** A block's checkbox options as the bullet lines they are written in with ("- Something (write in)"). */
export function blockOptionLines(b) {
	return (b.options ?? []).map(o => `- ${o.description}${o.freeText ? " (write in)" : ""}`);
}

/** A block's text with its checkbox options written in as bullets, for a kind that has no options. */
function _fullText(b) {
	return [b.text, blockOptionLines(b).join("\n")].filter(Boolean).join("\n\n").trim();
}

function _moveFromBlock(b, starting) {
	const text = _fullText(b);
	const reqMatch = text.match(/^\((Requires [^)]*)\)\s*/i);
	const requires = reqMatch ? reqMatch[1] : (b.extra?.requires ?? "");
	const description = reqMatch ? text.slice(reqMatch[0].length).trim() : text;
	const level = Number(requires.match(/level\s*(\d+)\s*\+/i)?.[1] ?? 1);
	const plain = description.replace(/\*/g, "");
	const results = { success: "", partial: "", failure: "" };
	// The tiers as the sheet itself reads them out of a move's words (move-tiers.js), "on a 7+" and
	// all. A "roll +STAT" with no tiers of its own that sits in a sentence naming another move ("when
	// you taste blood and Seek Insight you may roll +CON", Nightbreed) bends THAT move's roll; it is
	// not a roll of this one.
	const tiers = parseTiersFromProse(plain);
	const rollAt = plain.match(/roll\s*\+\s*(STR|DEX|CON|INT|WIS|CHA)\b/i);
	const sentence = rollAt ? plain.slice(0, rollAt.index).split(/[.!?]\s/).pop() + rollAt[0] : "";
	const bendsAnother = /\b(instead|seek insight|defy danger|clash|know things|persuade|let fly|defend|aid|interfere|forage|make camp|recover)\b/i.test(sentence);
	const roll = rollAt && (tiers || !bendsAnother) ? rollAt[1].toLowerCase() : "";
	if (roll && tiers) for (const k of Object.keys(results)) results[k] = String(tiers[k]?.value ?? "").trim();
	let resource = null;
	const pips = b.extra?.pips ?? [];
	const track = pips.find(p => p.count > 0);
	if (track) {
		const fromTitle = track.label && String(b.extra?.rawTitle ?? b.title).toUpperCase().includes(track.label.toUpperCase());
		const held = plain.match(/hold\s+\d+\s+([A-Z][a-z]+)/)?.[1] ?? "";
		resource = { max: Math.min(20, pips.reduce((n, p) => n + p.count, 0)), title: (!fromTitle && track.label) ? track.label : held, labels: [] };
	}
	return {
		name: b.title, description, starting, level, requires, requiresMoves: [],
		repeatMax: (b.extra?.boxes ?? 1) > 1 ? b.extra.boxes : 1, rollType: roll, results, resource,
	};
}

/**
 * A sentence or two of the playbook's own introduction, for the picker's hover blurb: whole
 * sentences up to about 160 characters, never cut mid-word ("In every community there are those
 * who embrace the things that others fear.").
 */
function _blurb(description) {
	const plain = String(description ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
	const sentences = plain.match(/[^.?!]+[.?!]+["'”’]?/g)?.map(x => x.trim()) ?? [];
	let out = "";
	for (const x of sentences) {
		if (out && out.length + x.length + 1 > 160) break;
		out = out ? `${out} ${x}` : x;
	}
	if (!out) out = plain;
	return out.length > 200 ? `${out.slice(0, 197).replace(/\s+\S*$/, "")}…` : out;
}

/** Options for a question built from a block that has none: its bullet lines, else a write-in. */
function _questionFromBlock(b) {
	if (b.options?.length) return { title: b.title, description: b.text, options: b.options.map(o => ({ ...o })) };
	const lines = String(b.text).split("\n");
	const bullets = lines.filter(l => /^- /.test(l)).map(l => ({ description: l.slice(2).replace(/\*/g, "").trim(), max: 1, freeText: false }));
	const prompt = lines.filter(l => !/^- /.test(l)).join("\n").trim();
	return { title: b.title, description: prompt, options: bullets.length ? bullets : [{ description: "Your answer", max: 1, freeText: true }] };
}

/**
 * Build the bundle from a draft, every block read as its current kind.
 * @returns {{ bundle: object, issues: object[] }}  issues the assembly itself found
 */
export function assemblePlaybook(draft) {
	const bundle = emptyBundle();
	const pb = bundle.playbook;
	const f = draft?.fields ?? {};
	const issues = [];
	for (const key of ["name", "author", "description", "statsNote", "hp", "damage", "instinctLabel", "startingMovesNote"]) {
		if (f[key] !== undefined && f[key] !== null && f[key] !== "") pb[key] = f[key];
	}
	// The picker's hover blurb, from the playbook's own opening words when the GM has none yet.
	if (!pb.summary && pb.description) pb.summary = _blurb(pb.description);
	pb.appearance = (f.appearance ?? []).map(r => [...r]);
	pb.origin = (f.origin ?? []).map(o => ({ region: o.region, names: [...o.names] }));
	pb.introductions = { step3: f.introductions?.step3 ?? "", step4: [...(f.introductions?.step4 ?? [])], step6: [...(f.introductions?.step6 ?? [])] };
	pb.possessions.pickNote = f.possessions?.pickNote || pb.possessions.pickNote;
	pb.possessions.pickCount = f.possessions?.pickCount ?? pb.possessions.pickCount;

	const moves = [];
	const notes = [];
	const inserts = _insertsFor(draft);
	let lastGroup = "";
	for (const b of draft?.blocks ?? []) {
		const ins = b.insert ? inserts.get(b.insert) : null;
		if (ins && !ins.dissolved && _insertPiece(b, ins, moves, issues)) continue;
		switch (b.kind) {
			case "background": {
				const text = _fullText(b);
				const pips = (b.extra?.pips ?? []).reduce((n, p) => n + p.count, 0);
				const label = b.extra?.pips?.find(p => p.label)?.label ?? "";
				pb.backgrounds.push({
					label: b.title, description: text, ..._backgroundMoves(text),
					possessions: _backgroundPossessions(text),
					// The background's own pip row ("CURSED  Doom ○○○"): a track of its own.
					track: pips ? { label: label && label.toUpperCase() !== label ? label : "Track", max: pips } : null,
				});
				break;
			}
			case "instinct": pb.instincts.push({ word: b.title, description: _fullText(b).replace(/\*/g, "").replace(/\s*\n+\s*/g, " ") }); break;
			case "possession": pb.possessions.options.push({ label: b.title, description: _fullText(b), preselected: !!b.extra?.ticked }); break;
			case "move":
			case "startingMove": {
				if (moves.some(m => m.name.toLowerCase() === b.title.toLowerCase())) {
					issues.push({ severity: "check", message: `Two pieces are both the move "${b.title}"; only the first was kept.` });
					break;
				}
				const move = _moveFromBlock(b, b.kind === "startingMove");
				// An insert the GM said isn't one: its moves are the playbook's, taken through it as printed.
				if (ins && !move.requires) move.requires = `From the playbook's "${ins.record.name}"`;
				moves.push(move);
				break;
			}
			case "question": {
				// Questions read from one heading go under it: a lore section with no options is the
				// umbrella character creation shows above each of them (the Heavy's "A History of Violence").
				const group = b.extra?.group ?? "";
				if (group && group !== lastGroup) pb.lore.push({ title: group, description: "", options: [] });
				lastGroup = group;
				pb.lore.push(_questionFromBlock(b));
				break;
			}
			case "note": {
				// A question moved to Notes keeps the heading it was asked under ("Belonging:").
				const title = b.extra?.group || b.title;
				notes.push(title ? `${title}:\n${_fullText(b)}` : _fullText(b));
				break;
			}
			default: break; // "skip"
		}
	}
	if (!pb.possessions.options.length) pb.possessions.pickCount = 0;

	const either = String(pb.startingMovesNote).match(/([A-Z][\w'’ ]+?)\s+OR\s+([A-Z][\w'’ ]+?)(?=[;,.]|$)/g) ?? [];
	pb.moveChoices = either.map(e => ({ label: "Choose one", options: e.split(/\s+OR\s+/).map(x => x.trim()) }));

	pb.inserts = [...inserts.values()].filter(i => !i.dissolved).map(i => _finishInsert(i, moves));
	_linkMoves(pb, moves, issues);
	bundle.moves = moves;
	pb.notes = notes.join("\n\n").trim();
	if (!moves.length) issues.push({ severity: "check", message: "No moves were found. If the playbook has moves of its own, add them on the Moves panel." });
	return { bundle, issues };
}

/**
 * The draft's inserts as the assembler builds them: the GM's answer for each (the move that opens
 * it, "always", or "not an insert"), and the lists its blocks fill, in page order.
 */
function _insertsFor(draft) {
	const out = new Map();
	// Two inserts read under one name each get a key of their own, minted the way normalizeBundle
	// would ("x", "x-2"), so it keeps them: left to it, the second's key changed after its moves had
	// taken the first's, and every move landed in the first insert.
	const used = new Set();
	for (const record of draft?.inserts ?? []) {
		const answer = (draft.confirm ?? []).find(c => c.insert === record.id)?.value ?? null;
		const base = slugify(record.name) || slugify(record.id) || "insert";
		let key = base;
		for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
		used.add(key);
		out.set(record.id, {
			record,
			dissolved: answer === INSERT_NONE,
			unlockedBy: answer === INSERT_ALWAYS ? "" : (answer || record.guess || ""),
			key,
			lists: [],
			description: [],
			metaUsed: new Set(),
		});
	}
	return out;
}

/** One block of a live insert into it. False when the block is of a kind an insert doesn't hold. */
function _insertPiece(b, ins, moves, issues) {
	switch (b.kind) {
		case "note": ins.description.push(_fullText(b)); return true;
		case "question": {
			const q = _questionFromBlock(b);
			const range = pickCountRange(q.description);
			const used = new Set(ins.lists.map(l => l.key));
			let key = slugify(q.title) || `list-${ins.lists.length + 1}`;
			for (let n = 2; used.has(key); n++) key = `${slugify(q.title) || "list"}-${n}`;
			ins.lists.push({ key, title: q.title, prompt: q.description, kind: "pick", pick: range?.max ?? 1, min: range?.min ?? 0,
				perUnlock: 0, bonusPicks: [], options: q.options.map(o => ({ ...o })) });
			return true;
		}
		case "move":
		case "startingMove": {
			if (moves.some(m => m.name.toLowerCase() === b.title.toLowerCase())) {
				issues.push({ severity: "check", message: `Two pieces are both the move "${b.title}"; only the first was kept.` });
				return true;
			}
			const move = _moveFromBlock(b, b.kind === "startingMove");
			move.insert = ins.key;
			const meta = (ins.record.lists ?? []).find(l => l.key === b.extra?.insertList);
			if (meta && b.kind === "move") {
				if (!ins.metaUsed.has(meta.key)) {
					ins.metaUsed.add(meta.key);
					ins.lists.push({ ...meta, kind: "moves", perUnlock: 0, bonusPicks: [], options: [] });
				}
				move.insertList = meta.key;
			} else move.insertList = "";
			moves.push(move);
			return true;
		}
		default: return false;
	}
}

const _stem = w => looseName(w, { article: true }).replace(/s$/, "");
/** The insert list a phrase names ("a new monster move" → Monster Moves, "monstrous armaments" → Armament). */
const _listNamed = (lists, phrase) => {
	const words = String(phrase).toLowerCase().split(/[^a-z]+/).filter(Boolean).map(_stem);
	return lists.find(l => {
		const title = String(l.title).toLowerCase().split(/[^a-z]+/).filter(Boolean).map(_stem);
		return title.length && title.every(t => words.includes(t));
	}) ?? lists.find(l => words.includes(_stem(String(l.title).toLowerCase().split(/[^a-z]+/).filter(Boolean).pop() ?? "")));
};
const NUMBER_WORDS = { one: 1, two: 2, three: 3, a: 1, an: 1 };

/**
 * An insert as the bundle holds it, with what its moves' words add: the opening move's "each time
 * you select this move, choose a new monster move" (an extra pick per copy), an insert move's
 * "choose 2 additional monstrous armaments" (a bonus to that list), and a FORM when it has gear to
 * take on or a move that turns into it and back.
 */
function _finishInsert(ins, moves) {
	const own = moves.filter(m => m.insert === ins.key);
	const opener = moves.find(m => !m.insert && looseName(m.name) === looseName(ins.unlockedBy));
	const each = String(opener?.description ?? "").replace(/\*/g, "")
		.match(/each time you (?:select|take|choose|pick) this move,?\s*(?:choose|pick|gain|take|add)\s+(?:a |an |another |one )?(?:new |more )?([a-z][a-z -]*?)(?:[.,;]|$)/im);
	if (each) {
		const list = _listNamed(ins.lists.filter(l => l.kind === "moves"), each[1]) ?? _listNamed(ins.lists, each[1]);
		if (list) list.perUnlock = 1;
	}
	for (const m of own) {
		const more = String(m.description).replace(/\*/g, "").match(/choose (\d+|one|two|three) additional ([a-z][a-z -]*?) from\b/i);
		if (!more) continue;
		const list = _listNamed(ins.lists.filter(l => l.kind === "pick"), more[2]);
		if (list) list.bonusPicks.push({ move: m.name, count: Number(more[1]) || NUMBER_WORDS[more[1].toLowerCase()] || 1 });
	}
	const gear = ins.lists.some(l => (l.options ?? []).some(o => /:\s*(?:\d*d\d+|armou?r\s*\d|\+?\d+\s*armou?r)/i.test(o.description)));
	const turns = [...own.map(m => m.description), ...ins.lists.map(l => l.prompt)].some(t => /\b(?:transform|revert|metamorphos)/i.test(t));
	return {
		key: ins.key,
		name: ins.record.name,
		description: ins.description.join("\n\n").trim(),
		unlockedBy: ins.unlockedBy,
		form: { enabled: gear || turns, on: "Transform", off: "Revert" },
		lists: ins.lists.map(({ key, title, prompt, kind, pick, min, perUnlock, bonusPicks, options }) => ({ key, title, prompt, kind, pick, min, perUnlock, bonusPicks, options })),
	};
}

/** Names that should match the playbook's own moves: backgrounds' and requirements'. */
function _linkMoves(pb, moves, issues) {
	const byName = new Map(moves.map(m => [m.name.toLowerCase(), m]));
	for (const b of pb.backgrounds) {
		b.moves = b.moves.map(n => byName.get(n.toLowerCase())?.name ?? n);
		b.moveChoice = b.moveChoice.map(n => byName.get(n.toLowerCase())?.name ?? n);
		// "Add grave tender's tools as an additional special possession": the playbook's own spelling.
		b.possessions = b.possessions.map(n => pb.possessions.options.find(o => looseName(o.label) === looseName(n))?.label ?? n);
	}
	// A requirement names moves joined by "and", and a move's own name may hold one ("Trick of
	// Light and Shadow"): find the playbook's own move names in it first, longest first, then split
	// what is left.
	const known = [...byName.values()].map(x => x.name).sort((a, b) => b.length - a.length);
	for (const m of moves) {
		if (!m.requires) continue;
		let rest = m.requires.replace(/^Requires\s*/i, "");
		const found = [];
		for (const name of known) {
			const re = wholeWordPattern(name, "i");
			if (name !== m.name && re.test(rest)) { found.push(name); rest = rest.replace(re, " "); }
		}
		const others = rest.split(/\s*(?:,|\band\b)\s*/i).map(x => x.trim())
			.filter(x => x && /[a-z]/i.test(x) && !/^level\b/i.test(x) && !/^the\s/i.test(x) && !/^from the playbook/i.test(x)).map(titleCase);
		m.requiresMoves = [...found, ...others].filter(n => n.toLowerCase() !== String(pb.name).toLowerCase());
	}
	const unknown = moves.flatMap(m => m.requiresMoves.filter(n => !byName.has(n.toLowerCase())).map(n => `${m.name} needs "${n}"`));
	if (unknown.length) issues.push({ severity: "check", message: `Some requirements name moves this playbook doesn't have: ${unknown.join("; ")}.` });
}
