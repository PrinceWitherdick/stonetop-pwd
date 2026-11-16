// THIRD-PARTY PLAYBOOKS THE SYSTEM KNOWS: particular PDFs, recognised by their bytes, that import as
// the rulebook's playbooks do, with nothing left to ask. Every other PDF goes through the reader and
// the review as before (pdf/read-playbook.js, PlaybookImportReview).
//
// NONE OF A PLAYBOOK'S WORDS ARE KEPT HERE. The GM's own PDF is read as any other is; what is kept is
// what makes that one read come out right:
//   - `sha256`: the digest of each printing known (`sha256sum` of the file), to recognise it;
//   - `glyphs`: for a PDF whose words are drawn as shapes, the table that names them
//     (pdf/outline-text.js), as a font's character map would;
//   - `settle`: what the review would ask, answered: a piece the reader is unsure of, by a KEY of its
//     title, and the kind it is (`settle: { <key>: "note" }`); a question by its own key, answered with
//     a move's key (`answers: { "insert:i1": <key> }`);
//   - `backgrounds`: a background's moves or possessions the reader can't link by name (the PDF names
//     a move differently from the move's own title), by keys: `{ <label key>: { moves: [<move key>] } }`.
// A KEY is a hash of the words, lower case, letters and digits only (textKey): it names a piece without
// holding it. To add a playbook, read its PDF, and take textKey() of each title the review asks about.
//
// THE REVIEW IS SKIPPED only when every question is answered and no piece is left unsure: a later
// printing of a known playbook (other bytes) is read and reviewed like any other PDF.

import { hashText } from "../pdf/outline-text.js";
import { sha256Hex } from "../../utils/sha256.js";
import ABHORSEN_GLYPHS from "./abhorsen-glyphs.js";

/** A piece's key: its words, lower case, letters and digits only, hashed. */
export function textKey(text) {
	return hashText(`known:${String(text ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "")}`);
}

export const KNOWN_PLAYBOOKS = Object.freeze([
	{
		// The Standout v3. Read whole by the reader; known so it needs no review.
		id: "the-standout",
		sha256: ["1cbdfa79e7f0bf756a9275df1808470164282a0200040111694e31936102be26"],
	},
	{
		// The Familiar Face v1.0.0 (Lex C).
		id: "the-familiar-face",
		sha256: ["4d3737d0da886be628e2a6a28aadc686495753ddded4c86c164e933ee8493204"],
		settle: {
			// Its blank "Custom" move: left out, as for any playbook; a player makes one up with the GM.
			"7wggm7luql": "skip",
		},
	},
	{
		// The Stranger (Justin Ford).
		id: "the-stranger",
		sha256: ["37512a8c986ac8a1f1a81936220c71d158a4a9dc7a98c351ec72c82c9c427d09"],
		settle: {
			// The Monster Compendium's Traits ("pick 2 per bane plus terrifying and unnatural", which the
			// sheet counts as 2 and warns past) and its Instinct (options printed under options): its
			// lists, as read.
			"xhfnpuxdr9": "question",
			"36eup2nv1o": "question",
		},
		// The Monster Compendium insert, opened by Otherkin.
		answers: { "insert:i1": "12qh4u4x87d" },
	},
	{
		// The Abhorsen-in-Waiting v3 (Lina Breland), printed to PDF: its words are shapes.
		id: "abhorsen-in-waiting",
		sha256: ["516aa7449b08cfc9182cd8ec972dc9a967ba5e4ad70a2699c928d2858ec353d5"],
		glyphs: ABHORSEN_GLYPHS,
		settle: {
			// The Lady of Crows' opening words, before its first question: a note for the table.
			"1gk796qd38e": "note",
		},
		backgrounds: {
			// The Successor inherits the Enchiriodon; the Chosen starts with I Myself Am… Strange and
			// Unusual. The PDF spells both differently where the background names them.
			"wm5brnujrx": { moves: ["76zw3jlt06"] },
			"ls2zirlqtt": { moves: ["15umo8chg6y"] },
		},
	},
].map(Object.freeze));

// Bigger than any playbook: a rulebook picked by mistake isn't digested for nothing (on plain http the
// digest is worked out in JavaScript, a second or two for a whole book).
const MAX_PLAYBOOK_BYTES = 25 * 1024 * 1024;

/** The known playbook these bytes are, or null. */
export async function knownPlaybookFor(bytes) {
	if ((bytes?.byteLength ?? 0) > MAX_PLAYBOOK_BYTES) return null;
	const digest = await sha256Hex(bytes);
	return KNOWN_PLAYBOOKS.find(k => k.sha256.includes(digest)) ?? null;
}

/**
 * The glyph tables to try on a page with no text: the known playbook's own first, then every other
 * (a playbook printed to PDF the same way, from the same template, draws the same shapes).
 */
export function glyphTablesFor(known = null) {
	const tables = KNOWN_PLAYBOOKS.map(k => k.glyphs).filter(Boolean);
	return known?.glyphs ? [known.glyphs, ...tables.filter(t => t !== known.glyphs)] : tables;
}

/**
 * Answer what the review would ask about a known playbook's draft (pdf/read-playbook.js): its unsure
 * pieces settled, its questions answered. A piece or question this printing doesn't have is skipped.
 * @returns {boolean} true when nothing is left for the GM to answer, so the review can be skipped
 */
export function settleKnownDraft(draft, known) {
	if (!draft || !known) return false;
	for (const b of draft.blocks ?? []) {
		const kind = known.settle?.[textKey(b.title)];
		if (!kind) continue;
		b.kind = kind;
		b.unsure = false;
	}
	for (const q of draft.confirm ?? []) {
		const key = known.answers?.[q.key];
		if (!key) continue;
		const move = (draft.blocks ?? []).find(b => ["move", "startingMove"].includes(b.kind) && textKey(b.title) === key);
		if (move) q.value = move.title;
	}
	return draftSettled(draft);
}

/** Is there nothing left in a draft for the GM to answer? */
export function draftSettled(draft) {
	const answered = q => q.value !== null && q.value !== undefined && String(q.value).trim() !== "";
	return (draft?.confirm ?? []).every(answered) && !(draft?.blocks ?? []).some(b => b.unsure);
}

/** Finish a known playbook's assembled bundle (pdf/read-playbook.js#assemblePlaybook), in place. */
export function finishKnownBundle(bundle, known) {
	if (!bundle?.playbook || !known) return bundle;
	const moveNamed = key => bundle.moves.find(m => textKey(m.name) === key)?.name ?? null;
	const possessionNamed = key => bundle.playbook.possessions?.options?.find(o => textKey(o.label) === key)?.label ?? null;
	for (const [labelKey, fix] of Object.entries(known.backgrounds ?? {})) {
		const bg = bundle.playbook.backgrounds.find(x => textKey(x.label) === labelKey);
		if (!bg) continue;
		if (fix.moves) {
			const names = fix.moves.map(moveNamed).filter(Boolean);
			if (names.length) bg.moves = names;
		}
		if (fix.possessions) {
			const names = fix.possessions.map(possessionNamed).filter(Boolean);
			if (names.length) bg.possessions = names;
		}
	}
	return bundle;
}
