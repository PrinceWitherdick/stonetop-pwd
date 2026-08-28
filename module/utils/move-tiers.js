import { capitalizeFirst, escHtml, formatOutcomeDetail, splitPickList, stripHtmlToText } from "./strings.js";
import { firstOptionList, pickableMoveDescription } from "./chat.js";
import { MOVE_TIERS, MOVE_TIERS_CLASS, ROLLED_TIER_ATTR } from "./move-results.js";

/**
 * Move cards used to print the book's prose verbatim, and the book states a move's outcomes as
 * a run-on sentence ("…roll +STR: on a 10+, your maneuver works…; on a 7-9, …"). Every rollable
 * move already carries those same outcomes as STRUCTURED data in `system.moveResults`, so this
 * module lifts them out of the paragraph and re-lays them as the labelled ladder the love
 * letter reader and the Death's Door dialog already use (.stonetop-love-letter-read-tiers,
 * .deaths-door-outcome).
 *
 * Done at RENDER time rather than in the pack source on purpose: a move already copied onto a
 * character in a live world carries its own description, and so does any homebrew move, so a
 * pack edit would fix neither. Nothing here mutates a document.
 *
 * It also fills a hole. A handful of moves (the Blessed's Borrow Power, Suck the Poison Out)
 * and EVERY player-authored custom move keep their outcomes only in `moveResults` and leave
 * them out of the description — so until now their results were invisible on the sheet and
 * only ever appeared on a roll card.
 */


// Block-level elements the description is cut into. Only <p> has its interior rewritten;
// every other block (chiefly the <ul> of "pick 1" options) is carried through verbatim, so a
// list can never be separated from the sentence that introduces it.
const _BLOCK_RE = /<(p|ul|ol|h[1-6]|blockquote|div|table)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

// Whether a fragment left over after the blocks have been taken out still holds block markup —
// a stray unclosed <ul>, say. Anything that does is passed through untouched; anything that does
// not is one implicit paragraph, INLINE MARKUP AND ALL. That last part is the whole point: a
// description authored as a bare run of text with <em>/<strong> in it and no wrapping <p> is how
// a localized string reads (the Death's Door tile) and how homebrew typed into a stat block
// reads, and a tag test strict enough to reject those left them as the only move surfaces the
// ladder never reached.
const _BLOCKISH_RE = /<\s*(?:p|ul|ol|li|div|table|h[1-6]|blockquote)\b/i;

// Tags that never close, so the inline-balancer must not push them onto its stack.
const _VOID_TAGS = new Set(["br", "hr", "img", "input", "wbr", "source", "col"]);

// A semicolon that closes an HTML entity rather than a clause — see `splitClauses`. Matched
// against the run from the nearest preceding "&", which is why it is anchored at both ends.
const _ENTITY_RE = /^&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});$/;
// The longest an entity can be: "&" + the 32-character name the pattern above allows + ";".
const _ENTITY_MAX = 34;

// A clause that RESTATES one of the tiers, i.e. the prose the ladder is about to replace, and
// the ONE pattern that both recognises such a clause and says which rung it names. Built from
// the phrasings the shipped moves actually use: "on a 10+", "on a 7-9" (hyphen or en dash),
// "on a 6-", plus the "on a 7+" a few playbook moves state.
// "on a miss" / "on a failure" is the same statement in words rather than numbers; no shipped
// move writes its 6- that way, but our own steading copy does and so does homebrew, and half a
// ladder (the numbered tiers lifted out, the worded one left behind) is worse than no ladder.
// Leading connectives are tolerated so Burgle's "Then, on a 10+, also pick 2" is caught too.
//
// The number stays penned to 6-10 rather than any two digits on purpose. Widened, "on a 20-foot
// drop" reads as a tier and its sentence would vanish out of a move card. And 11+/12+ is
// deliberately NOT a rung: the ladder has the three the sheet rolls for, and a "on a 12+, say
// how you turn the tables" bonus line (Slippery) is an extra ON TOP of the 10+ rather than a
// restatement of it — folded into the success row it would be labelled 10+ and read as a lie,
// so it stays in the prose where its author put it.
//
// Captures: 1 = the threshold, 2 = "+" when it is a threshold rather than a range,
// 3 = the range's upper bound ("7-9"), 4 = "miss" / "failure".
const _TIER_HEAD_RE = /^(?:(?:and|then|also|but|or|otherwise|next|finally)\b[,;:]?\s+)*on an?\s+(?:(10|[6-9])\s*(?:(\+)|[-\u2010-\u2015]\s*([6-9])?)|(miss|failure)\b)/i;

/**
 * Which rungs a matched tier head names. A "7+" line is stated once and applies to BOTH the
 * hit and the partial (Muster, Burgle, Alpha), which is exactly how those moves' own stored
 * moveResults spell it out — the same sentence on each of the two rows.
 */
function _tierKeysFor(match) {
	if (match[4]) return ["failure"];
	const n = Number(match[1]);
	if (match[2]) return n >= 10 ? ["success"] : ["success", "partial"];
	if (match[3]) return ["partial"];
	return n <= 6 ? ["failure"] : ["partial"];
}

// A trailing "either way, …" rider — the clause the book hangs off the END of a tier sentence
// (Know Things' "the GM might ask 'how do you know this?'", Danger Sense's advantage). It reads
// as a non-sequitur once the tiers between it and the trigger are lifted out, so it moves BELOW
// the ladder as a footnote instead of dangling after "roll +INT:".
const _RIDER_RE = /^(?:(?:and|but)\b[,;:]?\s+)*either way\b/i;

// How much of a clause's wording must already appear in the ladder before the clause is treated
// as something the ladder now says, and dropped. Deliberately high: a false positive silently
// deletes authored rules text, while a false negative only leaves a sentence stated twice.
const _COVERED = 0.7;
// A TAIL clause — a rider, or the lower-case remainder of the sentence a cut landed in — is held
// to a looser bar. It is short, so it shares far fewer words with the ladder even when it IS the
// same statement (Seek Insight's "either way, gain advantage…"). A tail that clears neither bar
// is not thrown away: it becomes a footnote under the ladder.
const _TAIL_COVERED = 0.55;
// Two option lists count as the same list at this much word overlap. The ladder's copy is often
// an abridgement of the description's ("lesser foes quail/flee" vs "Lesser foes will quail,
// hesitate, or flee before you"), so this compares the SHORTER against the longer.
const _SAME_OPTION = 0.6;

// Words too common to be evidence of anything, dropped before any overlap is measured.
const _STOP_WORDS = new Set(["a", "an", "and", "the", "or", "of", "to", "in", "on", "at", "it",
	"is", "as", "be", "by", "for", "you", "your", "so", "if", "but", "that", "this",
	"with", "from", "s", "t"]);

/** Significant lowercase word tokens of a plain-text string. */
function _words(text) {
	return String(text ?? "").toLowerCase().match(/[a-z0-9]+/g)?.filter(w => !_STOP_WORDS.has(w)) ?? [];
}

/** Fraction of `text`'s significant words that also appear in `corpus`. 0 for an empty text. */
function _coverage(text, corpus) {
	const words = _words(text);
	if (!words.length) return 0;
	const have = new Set(_words(corpus));
	return words.filter(w => have.has(w)).length / words.length;
}

/**
 * A clause as plain text, for a leading-phrase test and for the ladder rows the prose path
 * builds out of it. `stripHtmlToText` rather than a local tag-stripper: it turns a `<br>` and
 * every closing block tag into a SPACE, so "alert<br>and ready" reads as two words here rather
 * than "alertand ready" — and this text is printed, not only tested.
 *
 * The opening punctuation trimmed here is written as escapes, not as the characters themselves:
 * this is input being READ, but the no-em-dashes copy check reads source and cannot tell the
 * difference, and a waiver would take the whole file out of a check it should stay inside.
 */
function _headText(html) {
	return stripHtmlToText(html).replace(/^[\s"'\u2018\u201c(\u2014\u2013-]+/, "").trim();
}

/**
 * Close any inline tag left open by a cut, and drop any closer whose opener was cut away.
 * Clause boundaries fall between tags in every shipped move, but a homebrew description can
 * put one anywhere, and half a `<strong>` escaping into the card would embolden the rest of
 * the sheet.
 */
export function balanceInlineHtml(html) {
	const open = [];
	let out = "";
	let last = 0;
	const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
	let m;
	while ((m = re.exec(html)) !== null) {
		const [tag, slash, rawName, selfClose] = m;
		const name = rawName.toLowerCase();
		out += html.slice(last, m.index);
		last = m.index + tag.length;
		if (_VOID_TAGS.has(name) || selfClose) { out += tag; continue; }
		if (slash) {
			// An orphan closer (its opener sat in a dropped clause) goes with it.
			const at = open.lastIndexOf(name);
			if (at === -1) continue;
			// Anything opened INSIDE the element being closed is implicitly closed too.
			for (let i = open.length - 1; i > at; i--) out += "</" + open[i] + ">";
			open.length = at;
			out += tag;
			continue;
		}
		open.push(name);
		out += tag;
	}
	out += html.slice(last);
	for (let i = open.length - 1; i >= 0; i--) out += "</" + open[i] + ">";
	return out;
}

/**
 * Cut a paragraph's interior into clauses at `;`, `.` and `:` boundaries that fall OUTSIDE a
 * tag. The separator stays with the clause it ends and the whitespace after it is dropped, so
 * re-joining every clause with a single space reproduces the original text (up to that one
 * space) — which is what makes over-splitting (on "e.g. ", say) harmless.
 *
 * A TAG counts as following whitespace. The transcribed book text is not typeset to a standard:
 * Know Things reads "…to make it useful;<strong><em>either way</em></strong>, the GM might ask…"
 * with no space after the semicolon, and 275 shipped descriptions have a separator butted
 * straight against a tag like that. Requiring real whitespace left every one of those glued to
 * the clause before it — so Know Things' "either way" rider was swallowed by the 7-9 clause and
 * deleted along with it, off one of the six moves every character owns.
 *
 * An HTML ENTITY ends in a semicolon, and that one is never a boundary. Dark Succor is written
 * "<strong>on a 6&ndash;</strong>, all 3 apply:", where the `&ndash;` closes right before a tag
 * and so met the rule above exactly: the clause split inside the entity, "on a 6" went out as a
 * tier while ", all 3 apply:" stayed behind as a fragment, and the move lost its 6- rung and
 * gained a sentence starting with a comma.
 */
export function splitClauses(inner) {
	const parts = [];
	let start = 0;
	let inTag = false;
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === "<") { inTag = true; continue; }
		if (ch === ">") { inTag = false; continue; }
		if (inTag) continue;
		if (ch !== ";" && ch !== "." && ch !== ":") continue;
		// The tail of "&ndash;" / "&#8211;", not a separator. Read backwards from the "&" rather
		// than by slicing the whole prefix, which made every semicolon cost the length of the text
		// before it.
		if (ch === ";") {
			const amp = inner.lastIndexOf("&", i);
			if (amp !== -1 && i - amp <= _ENTITY_MAX && _ENTITY_RE.test(inner.slice(amp, i + 1))) continue;
		}
		// A boundary needs whitespace, a tag, or the end of the string after it, so "1-for-1"
		// and a decimal keep their neighbours while "GM's call. Then" splits.
		const rest = inner.slice(i + 1);
		if (rest && !/^[\s<]/.test(rest)) continue;
		parts.push(inner.slice(start, i + 1));
		start = i + 1 + (rest.match(/^\s*/)?.[0].length ?? 0);
		i = start - 1;
	}
	if (start < inner.length) parts.push(inner.slice(start));
	return parts.filter(p => p.trim() !== "");
}

/** Uppercase the first letter that isn't inside a tag, so a lifted rider reads as a sentence. */
function _capitalizeVisible(html) {
	let inTag = false;
	for (let i = 0; i < html.length; i++) {
		const ch = html[i];
		if (ch === "<") { inTag = true; continue; }
		if (ch === ">") { inTag = false; continue; }
		if (inTag) continue;
		if (/[a-z]/.test(ch)) return html.slice(0, i) + ch.toUpperCase() + html.slice(i + 1);
		if (/[A-Z]/.test(ch)) return html;
	}
	return html;
}

// A clause ending in ":" introduces whatever follows it. That reads well when the ladder is
// what follows (the last kept clause of the last kept block) and badly when more of the
// author's own prose does — "roll +CON: You can spend Readiness 1-for-1 to:" — so a colon with
// kept text after it becomes a full stop. Trailing closers are stepped over.
//
// ONE regex, read both ways: `_colonToStop` rewrites the colon it finds, and the block walk
// below TESTS for it to ask whether what survives a cut still leads into the next block. The
// "step over the trailing closers" half is subtle enough that a second copy would drift.
const _ENDS_ON_COLON = /:(\s*(?:<\/[a-zA-Z][a-zA-Z0-9]*\s*>\s*)*)$/;

function _colonToStop(clause) {
	return clause.replace(_ENDS_ON_COLON, ".$1");
}

// The LAST kept clause of a paragraph was joined to the clause that got cut out from under it
// ("…you need not choose a consequence; | on a 7-9, …"), so it can be left ending on the
// separator that used to lead into the tier. A ":" is left alone — that one introduces the
// ladder now — but a hanging ";" or "," is settled to a full stop.
function _trailingStop(clause) {
	return clause.replace(/[;,](\s*(?:<\/[a-zA-Z][a-zA-Z0-9]*\s*>\s*)*)$/, ".$1");
}

/** The tier rows worth rendering: those whose stored outcome text is non-empty. */
export function moveTierRows(moveResults) {
	if (!moveResults) return [];
	// A stored row's own label wins so a hand-built moveResults from an older world keeps
	// whatever it says; MOVE_TIERS supplies the label when it carries none, and the order always.
	return MOVE_TIERS
		.map(({ key, label }) => {
			const row = moveResults[key];
			const value = String(row?.value ?? "").trim();
			if (!value) return null;
			return { key, label: String(row?.label ?? "").trim() || label, value };
		})
		.filter(Boolean);
}

/** Every tier's outcome text as one blob, for the "does the ladder already say this" tests. */
function _tierCorpus(moveResults) {
	return moveTierRows(moveResults).map(r => r.value).join(" ");
}

/**
 * Build a moveResults-shaped object out of a description's OWN tier prose, for every move that
 * has no stored results to draw on.
 *
 * Only character moves carry `system.moveResults`. An NPC or monster move is `description` +
 * `rollFormula` and nothing else (data-models/fields.js#simpleMoveSchema), the steading's moves
 * are hand-authored HTML on the sheet, and a GM writing a move into a stat block by hand has
 * nowhere to put structured tiers either. Reading the tiers back out of the sentence they are
 * already written in gives every one of those surfaces the same ladder with no new field to
 * fill in and no migration.
 *
 * This can only ever RE-ARRANGE what the description already said: each rung's text is the
 * remainder of the clause that named it, so nothing is invented and nothing that was not
 * already on the card can appear. Returns null when the prose names no tier.
 */
export function parseTiersFromProse(description) {
	const src = String(description ?? "");
	if (!src.trim()) return null;
	const parts = { success: [], partial: [], failure: [] };
	let found = false;

	const readParagraph = (inner) => {
		// A rung's text runs on past the clause that named it ("on a 6-, don't mark XP; you know
		// there's a trap") — so a lower-case clause straight after one belongs to the same rung.
		// `current` holds that rung until a clause opens something new, and never crosses a
		// paragraph, which is where one move's tiers stop and the next sentence starts.
		let current = null;
		for (const clause of splitClauses(inner)) {
			const head = _headText(clause);
			const m = head.match(_TIER_HEAD_RE);
			if (m) {
				current = _tierKeysFor(m);
				found = true;
				const rest = head.slice(m[0].length).replace(/^[\s,;:.]+/, "").trim();
				for (const key of current) if (rest) parts[key].push(rest);
				continue;
			}
			// A rider belongs to every rung equally, so it belongs to none of them: it is lifted
			// out separately, under the finished ladder.
			if (current && _RIDER_RE.test(head)) { current = null; continue; }
			if (current && /^[a-z]/.test(head)) {
				for (const key of current) parts[key].push(head);
				continue;
			}
			current = null;
		}
	};

	_BLOCK_RE.lastIndex = 0;
	let last = 0;
	let m;
	while ((m = _BLOCK_RE.exec(src)) !== null) {
		last = m.index + m[0].length;
		// Only <p> is read. A <ul> under a tier clause is that clause's option list, and it stays
		// in the body where its lead-in is, rather than being swallowed into a rung.
		const p = m[0].match(/^<p\b[^>]*>([\s\S]*?)<\/p\s*>$/i);
		if (p) readParagraph(p[1]);
	}
	const tail = src.slice(last);
	if (tail.trim() && !_BLOCKISH_RE.test(tail)) readParagraph(tail);

	if (!found) return null;
	const results = {};
	for (const { key, label } of MOVE_TIERS) {
		const value = _joinParts(parts[key]);
		if (!value) continue;
		results[key] = { label, value: _sentence(value) };
	}
	// TWO rungs at least. One rung read out of prose is nearly always half a sentence rather
	// than a ladder — Glorious Servant's "when you Invoke the Sun God and roll a 10+, you need
	// not choose a consequence; on a 7-9, you choose one" states its hit as part of the TRIGGER,
	// so only the 7-9 is quotable, and hoisting that alone leaves a one-row ladder under a
	// sentence that now trails off. Below the bar the description is simply left as written.
	// Stored moveResults are exempt: a custom move with one rung filled in meant it.
	return moveTierRows(results).length >= 2 ? results : null;
}

/**
 * Join a rung's collected fragments back into prose. A rung is often written across two
 * sentences ("on a 7+, the steading is alert…. On a 10+, also pick 2"), and once the second
 * one's own "On a 10+," lead-in is stripped away it starts mid-sentence — so a fragment that
 * lands after a full stop is given its capital back.
 */
function _joinParts(parts) {
	return parts.reduce((acc, part) => {
		if (!acc) return part;
		return acc + " " + (/[.!?]["')\]]?$/.test(acc) ? capitalizeFirst(part) : part);
	}, "").trim();
}

/**
 * Plain tier text as a sentence: leading capital, and the separator the clause was cut at
 * settled to a full stop — unless the clause already ended on one of its own. All is
 * Illuminated's hit ends on a quoted question, so blindly swapping its ";" for "." spelled
 * the row `…loved, beautiful, or worthy?".`
 */
function _sentence(text) {
	const trimmed = String(text).trim().replace(/\s*[;,]+$/, "");
	// A colon counts as terminal. A rung that ends on one is introducing the option list now
	// hanging under the ladder ("…and pick 1:" — Clash, Forage, Let Fly), and a full stop added
	// after it spelled the row "pick 1:." with the list it was pointing at right underneath.
	return capitalizeFirst(/[.!?:]["'’”)\]]?$/.test(trimmed) ? trimmed : trimmed + ".");
}

/**
 * Strip the tier restatements out of a move's description.
 *
 * Returns `{ body, riders }` — the description with every tier clause removed (blocks that end
 * up empty are dropped whole), the "either way, …" riders lifted out to sit under the ladder,
 * and `listLeadCut`: whether the move's option list lost the sentence that introduced it.
 * Content that is NOT a tier restatement always survives: Defend's "You can spend Readiness
 * 1-for-1 to:" and the `<ul>` under it, Seek Insight's six questions, Defy Danger's six
 * "… +STAT to …" lines. A description that restates no tier comes back verbatim.
 *
 * `moveResults` is what the ladder will say, and is consulted only to decide whether a clause
 * left behind by a cut is already covered there — see `_COVERED`.
 */
export function stripTierProse(description, moveResults = null) {
	const src = String(description ?? "");
	if (!src.trim()) return { body: "", riders: [], listLeadCut: false };
	const corpus = _tierCorpus(moveResults);
	const riders = [];
	let dropped = false;

	// Returns `{ html, leadLost }` — the rewritten block, and whether it has stopped introducing
	// whatever follows it. `leadLost` is HANDED BACK rather than set on a variable the block walk
	// reads afterwards: the two are a step apart in the same loop, and as shared state the
	// ordering ("rewrite before you read it, clear it after every other block") was a rule written
	// down nowhere but in the assignments themselves.
	const rewriteParagraph = (block) => {
		const m = block.match(/^(<p\b[^>]*>)([\s\S]*?)(<\/p\s*>)$/i);
		if (!m) return { html: block, leadLost: false };
		const [, openTag, inner, closeTag] = m;
		const clauses = splitClauses(inner);
		if (!clauses.length) return { html: block, leadLost: false };
		const kept = [];
		let droppedHere = false;
		// Was the paragraph's LAST clause one of the ones cut? If so, nothing at all now stands
		// between what survives and whatever block follows.
		let lastClauseCut = false;
		// Set by a tier cut and held until a clause that clearly starts something new: the
		// clauses immediately after a cut are usually the rest of the sentence it was in.
		let armed = false;
		for (const clause of clauses) {
			const head = _headText(clause);
			if (_TIER_HEAD_RE.test(head)) { armed = droppedHere = dropped = lastClauseCut = true; continue; }
			if (armed) {
				// A rider, or a lower-case opening — the tail of the sentence the cut landed in
				// ("On a 7-9 when you're looking to sell: | you can sell it now, but…"). Left
				// inline it dangles off the trigger, so it either goes (the ladder already says
				// it: Danger Sense's 6- carries its own "you know there's a trap") or becomes a
				// footnote under the ladder (Shake It Off's NPC caveat, which the ladder only
				// abbreviates). Never simply dropped on the strength of its lower case.
				if (_RIDER_RE.test(head) || /^[a-z]/.test(head)) {
					if (_coverage(head, corpus) < _TAIL_COVERED) {
						riders.push(_capitalizeVisible(balanceInlineHtml(clause.trim())));
					}
					continue;
				}
				// A new sentence, but one the ladder already states in its own words.
				if (_coverage(head, corpus) >= _COVERED) continue;
				armed = false;
			}
			lastClauseCut = false;
			kept.push(clause.trim());
		}
		if (!droppedHere) return { html: block, leadLost: false };
		const joined = kept
			.map((c, i) => (i < kept.length - 1 ? _colonToStop(c) : _trailingStop(c)))
			.join(" ");
		const body = balanceInlineHtml(joined).trim();
		// What is left introduces the next block only if it ENDS on a colon and that colon was
		// still the paragraph's last word after the cut. Both halves are needed and each catches
		// a real move:
		//   Clash keeps "…roll +STR:" and then loses "on a 10+, … pick 1:" from under it — a
		//     trailing colon that now introduces the LADDER, not the list (`_trailingStop` leaves
		//     it there for exactly that reason), so the colon alone must not hold the list here.
		//   All is Illuminated loses "ask them 2 questions from the list below" out of the MIDDLE
		//     and keeps "In any case, they must answer truthfully." — its last clause survived, so
		//     nothing was cut from the end, and yet the list above is stranded all the same.
		return {
			html: body ? openTag + body + closeTag : "",
			leadLost: lastClauseCut || !_ENDS_ON_COLON.test(body),
		};
	};

	// Walk the top-level blocks, rewriting only <p>. Bare text outside any block (a homebrew
	// description typed as a plain string) is treated as one implicit paragraph.
	let out = "";
	let last = 0;
	let m;
	// Whether the FIRST `<ul>` lost the sentence that introduced it. A move's option list is led
	// into either by a tier clause ("on a 10+, pick 2; on a 7-9, pick 1:" — Clash, Forage,
	// Interfere) or by prose that is not a tier at all ("You can spend Readiness 1-for-1 to:" —
	// Defend, Silver Tongued). The first kind is lifted into the ladder and the list is left
	// pointing at nothing; the second stays exactly where its author put it. This is the flag
	// that tells the two apart, and it is answered by what was CUT rather than by reading the
	// remaining sentence for a colon: an introducer can end any way at all.
	let listLeadCut = false;
	let seenList = false;
	// What the block just before this one said about whether it still introduces the next.
	let prevLeadLost = false;
	_BLOCK_RE.lastIndex = 0;
	while ((m = _BLOCK_RE.exec(src)) !== null) {
		out += src.slice(last, m.index);
		last = m.index + m[0].length;
		if (/^<p\b/i.test(m[0])) {
			const rewritten = rewriteParagraph(m[0]);
			out += rewritten.html;
			prevLeadLost = rewritten.leadLost;
			continue;
		}
		if (!seenList && /^<ul\b/i.test(m[0])) {
			seenList = true;
			listLeadCut = prevLeadLost;
		}
		prevLeadLost = false;
		out += m[0];
	}
	const tail = src.slice(last);
	if (tail.trim() && !_BLOCKISH_RE.test(tail)) {
		out += rewriteParagraph("<p>" + tail + "</p>").html.replace(/^<p>|<\/p>$/g, "");
	} else {
		out += tail;
	}
	// No `dropped &&` guard: `leadLost` is only ever true past the `droppedHere` return above, and
	// `droppedHere` and `dropped` are set in the same statement, so a cut has always happened.
	return { body: dropped ? out : src, riders, listLeadCut };
}

/**
 * True when a tier's "pick 1: a / b / c" options are the list the description already bullets
 * above the ladder, in which case the ladder prints the lead-in alone. The ladder's copy is
 * often an abridgement, so each option is matched by word overlap rather than equality.
 */
function _optionsAlreadyListed(value, listed) {
	if (!listed.length) return false;
	const split = splitPickList(value);
	if (!split) return false;
	const matched = split.options.filter(opt => listed.some((li) => {
		const [short, long] = _words(opt).length <= _words(li).length ? [opt, li] : [li, opt];
		return _coverage(short, long) >= _SAME_OPTION;
	}));
	return matched.length >= Math.ceil(split.options.length / 2);
}

/**
 * The ladder itself: one labelled row per tier that has text. "" when there is nothing to show.
 * `listedOptions` is the plain text of the bullets the description already shows, so a tier
 * whose outcome is a choice from that same list doesn't reprint it.
 *
 * Each row names its rung in `data-tier` as well as in its class. The class is what the row is
 * PAINTED from; the attribute is what the rolled-rung mark SELECTS by, so a result card's
 * `[data-rolled-tier="partial"] > [data-tier="partial"]` reaches its row without depending on
 * how that row happens to be painted. Same split the rest of the roll card already uses for
 * anything it holds one of per tier.
 */
export function moveTiersHtml(moveResults, listedOptions = []) {
	const rows = moveTierRows(moveResults);
	if (!rows.length) return "";
	const items = rows.map(r =>
		'<li class="stonetop-move-tier stonetop-move-tier--' + r.key + '" data-tier="' + r.key + '">'
		+ '<span class="stonetop-move-tier-label">' + escHtml(r.label) + '</span>'
		+ '<span class="stonetop-move-tier-text">'
		+ formatOutcomeDetail(r.value, { introOnly: _optionsAlreadyListed(r.value, listedOptions) })
		+ '</span>'
		+ '</li>'
	).join("");
	return '<ul class="' + MOVE_TIERS_CLASS + '">' + items + '</ul>';
}

/**
 * Rung-by-rung overlay: `primary`'s row wherever it has one, `fallback`'s otherwise. Returns
 * null only when neither side states anything, so callers can test one value.
 */
function _mergeTiers(primary, fallback) {
	if (!primary) return fallback ?? null;
	if (!fallback) return primary;
	const out = { ...fallback };
	for (const { key } of MOVE_TIERS) if (primary[key]) out[key] = primary[key];
	return out;
}

/**
 * A move card's full body: the trigger prose with its tier restatements lifted out, then the
 * tier ladder, then any "either way" rider. A move that names no tier either in its description
 * or in its stored results comes back untouched, so this is safe to use wherever a move
 * description is printed.
 */
export function moveBodyHtml(description, moveResults) {
	// THE DESCRIPTION'S OWN PROSE WINS. `moveResults` was authored for the roll card, where one
	// tier is shown at a time and terse is right, so it abbreviates: measured over the 54 shipped
	// moves that carry both, the stored rows drop 110 words of the book's wording that the prose
	// keeps, against 6 the other way. Some of what goes is real rules text — All is Illuminated's
	// second question, Muster's "until the threat passes, the Seasons Change, or you cease to
	// oversee the muster", Wielder of the White Flame's whole description of the flame. This
	// module exists to RE-LAY the printed text, not to swap it for a summary of itself.
	//
	// Stored results fill in PER RUNG rather than only standing in for the whole ladder. The book
	// routinely prints no 6- at all — a miss is the GM's move, so there is nothing to quote — and
	// this system authored one anyway for the roll card. Reading only the prose would take that
	// row off the sheet while a miss still printed it in chat. So: the prose wins every rung it
	// states, and stored rows fill the rest, which also carries the moves whose descriptions state
	// no outcome at all (every player-authored custom move, plus the Blessed's Borrow Power and
	// Suck the Poison Out — 5 of the 54 shipped, and the reason this argument exists).
	const results = _mergeTiers(parseTiersFromProse(description), moveResults);
	if (!moveTierRows(results).length) return String(description ?? "");
	const { body, riders, listLeadCut } = stripTierProse(description, results);
	const notes = riders.map(r => '<p class="stonetop-move-tiers-note">' + r + '</p>').join("");

	// THE move's printed option list, found ONCE and used for both questions below — which
	// options the ladder must not reprint, and which list gets re-hung under it. `firstOptionList`
	// (utils/chat.js) is where "what is a move's printed option list" is decided for the whole
	// system: the FIRST list, since a second one is a note about the first, and never a nested
	// one. Asking it twice invited the two answers to disagree.
	const list = firstOptionList(body);
	const ladder = moveTiersHtml(results, (list?.items ?? []).map(stripHtmlToText).filter(Boolean));

	// THE LIST FOLLOWS THE ROWS THAT SEND YOU TO IT. A move whose options were introduced by a
	// tier clause — "on a 10+, pick 2; on a 7-9, pick 1:" (Clash, Forage, Interfere, Let Fly) —
	// has that sentence lifted into the ladder, which left the bullets stranded above the rows
	// that now say "pick 1 from the list" and pointed the reader upwards to find it.
	//
	// Only a list whose introducer was CUT moves (`listLeadCut`). Defend's "You can spend
	// Readiness 1-for-1 to:" and Silver Tongued's "You may spend Nerve, 1-for-1, to:" are not
	// tier clauses and survive the strip, and their lists are a separate offer rather than the
	// outcome of a roll — those stay attached to the sentence that opens them.
	if (!listLeadCut || !list) return body + ladder + notes;
	// Moved WHOLE and unmodified, ticked options and all: `data-index` is positional within its
	// own `<ul>`, so a message's saved ticks still land on the option they were put on. The rider
	// goes last of all — it comments on the whole move ("either way, gain advantage on your next
	// roll to act on the answer"), and the answers it means are in the list above it.
	const withoutList = (body.slice(0, list.index) + body.slice(list.index + list.length)).trim();
	return withoutList + ladder + body.slice(list.index, list.index + list.length) + notes;
}

/**
 * The body of a move's CHAT CARD: its printed options made tickable, then its outcomes re-laid
 * as the ladder. A move that states no outcome comes back exactly as it was, so every card
 * posted through here is safe to build this way.
 *
 * THE ORDER IS LOAD-BEARING, both ways round.
 *
 * Ticking first, because `pickableMoveDescription` reads the lead-in ABOVE the list for a cap,
 * and that cap is written in the very tier prose the ladder is about to lift out: "on a 10+,
 * pick 2; on a 7-9, pick 1:". Stripping first would leave every option list uncapped.
 *
 * And the ladder second, because it is a `<ul>` of its own. On a move that prints no options of
 * its own it would be the FIRST list in the body, which is the other half of why
 * `firstOptionList` refuses it by class: either order alone would have handed the tier rows a
 * checkbox each.
 *
 * @param {string} description   The move's HTML, already filtered for an "ask" move's chosen stat.
 * @param {object|null} [moveResults]  `system.moveResults`, or null on a move that stores none
 *   (an NPC or monster move, an arcanum's mystery), whose tiers are read out of the prose.
 * @param {{pickable?: boolean}} [opts]  `pickable: false` for a move that declares its own pool
 *   in `system.pickOptions` (a love letter), whose list is the card's own checklist instead.
 */
export function moveCardBody(description, moveResults = null, { pickable = true } = {}) {
	const body = pickable ? pickableMoveDescription(description) : String(description ?? "");
	return moveBodyHtml(body, moveResults ?? null);
}

/**
 * Mark the rung a roll landed on, so the ladder on a RESULT card says which of the three
 * outcomes actually happened rather than leaving the reader to match the total against the
 * labels themselves.
 *
 * A stamp on the `<ul>` naming the rung, not a class on the row: the row is then chosen in CSS
 * (`[data-rolled-tier="partial"] > [data-tier="partial"]`), which means the mark MOVES when a
 * GM's Shift Up/Down rewrites one attribute, with no row to find and no second row to unmark.
 * It also keeps the mark out of `moveTiersHtml`, whose output is the same ladder on eighteen
 * sheet surfaces where no dice have been rolled and nothing should be lit.
 *
 * Only the FIRST ladder is stamped, which is the only one a card can have — a move's description
 * is laid out once. A body with no ladder in it (a move that states no outcome, a damage roll)
 * comes back untouched, so every roll can be run through this.
 *
 * @param {string} html      A move card body, as `moveCardBody` built it.
 * @param {string} tierKey   "success" | "partial" | "failure". A 12+ is a strong hit, so a caller
 *                           holding "critical" passes "success".
 */
export function markRolledTier(html, tierKey) {
	const src = String(html ?? "");
	if (!MOVE_TIERS.some(t => t.key === tierKey)) return src;
	// Matched on the opening tag alone. The ladder is built here and never nested, so there is
	// nothing to balance, and rewriting only the tag leaves the rows exactly as they were.
	//
	// The tag is matched by CLASS rather than by the exact string `moveTiersHtml` writes: an `id`
	// or a second class added there would have slid a byte-identical literal out from under this
	// one silently, leaving an unmarked ladder and no failure to read.
	// The attribute is appended AFTER whatever the tag already carries, so the ladder's markup is
	// the same string it always was with one attribute more on the end.
	const open = new RegExp(
		`<ul\\b(?![^>]*\\b${ROLLED_TIER_ATTR}=)([^>]*\\bclass="[^"]*\\b${MOVE_TIERS_CLASS}\\b[^>]*)>`);
	return src.replace(open, `<ul$1 ${ROLLED_TIER_ATTR}="${tierKey}">`);
}
