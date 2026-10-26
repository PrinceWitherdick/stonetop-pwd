// ── Chronicle compiler (pure core) ─────────────────────────────────────────────
// Turns the answers recorded during the guided Character Introductions (and the
// Spring Burst notes folded in) into structured pages for the shared "Chronicle".
// Kept free of Foundry globals so it's unit-testable; utils/chronicle.js wraps it
// to gather the world data and upsert the actual JournalEntry.
//
// Each page is { key, name, sections }, where every section is one of:
//   • prose — { kind:"prose", heading, group:"glance", body }   (rich HTML)
//   • qa    — { kind:"qa",    heading, group:"glance", pairs }   ([{prompt, answer}])
// This is the same shape the location page model (LocationPageModel) stores, so the
// Chronicle reuses that page sheet and its inline Q&A editor (Bonds & ties / Asked
// of the others become editable prompt/answer pairs, like a location's "In Play"
// questions). `group:"glance"` keeps the sheet from drawing act banners.

import { escHtml, decodeEntities, normaliseEditorText } from "./strings.js";
import { step4Questions, step6Questions, SUPERSEDED_INTRO_QUESTIONS } from "../dialogs/introductions-data.js";
import { CHART_GROUPS, chartPicked, chartEntryText } from "../dialogs/expedition-data.js";
import {
	journeyRoute, routePhrase, routeLegLines, routeLine, fillChartBlank,
} from "./travel-route.js";
import { hasFillBlank } from "./fill-blanks.js";
import { SEASONAL_GAINS } from "../dialogs/spring-burst-data.js";
// One name for an unnamed trip: the switcher, the steading's held assets and this page all
// have to agree, so the fallback wording lives in one place rather than three.
import { expeditionLabel } from "./expedition-log-core.js";
// Change-detection hash (pure, Foundry-free) — lets us tell a page's still-pristine
// prose (safe to refresh from the source) from one the GM has edited in the journal.
import { hashString } from "../hooks/journal-sync-core.js";

// "The Chronicle" is a Journal FOLDER holding two journals — the player
// introductions and the expedition log. (Foundry folders hold entries, not pages, so
// grouping the record means splitting it across two entries.) PC + Spring Burst pages
// live in the introductions journal; expedition pages in the expeditions journal.
export const CHRONICLE_FOLDER_NAME = "The Chronicle";
export const CHRONICLE_FOLDER_COLOR = "#959BB8";
export const INTRODUCTIONS_JOURNAL_NAME = "Player Introductions";
export const EXPEDITIONS_JOURNAL_NAME = "Expeditions";
export const SPRING_PAGE_NAME = "Let Spring Burst Forth";

// Stable per-page key, stored on the page so re-saves match it (rather than matching
// by name, which breaks when a PC is renamed). The party Spring Burst page uses a
// fixed sentinel; PC pages use the actor id; expedition pages use this prefix plus
// the trip's id.
export const SPRING_PAGE_KEY = "__spring__";
export const EXPEDITION_PAGE_KEY_PREFIX = "expedition:";

// Sections all sit in the opening "act" so the page sheet draws no act banner.
const SECTION_GROUP = "glance";

// Escape user-entered text and turn blank-line-separated blocks into paragraphs,
// single newlines into <br>. Returns "" for blank input.
function paragraphs(text) {
	const trimmed = String(text ?? "").trim();
	if (!trimmed) return "";
	return trimmed
		.split(/\n{2,}/)
		.map(block => `<p>${escHtml(block).replace(/\n/g, "<br>")}</p>`)
		.join("");
}

// Entity decoding for the authored question text (e.g. "heart &amp; soul"), so the stored qa
// prompt reads as plain text in its edit input. Shared with the FAQ parser via utils/strings.js
// — the local copy this replaced didn't know &lt;/&gt;/&#39;, so those came through raw.

// A list-bearing prose body gets the location-body wrapper so its bullets render as
// spirals (matching the rest of this system's prose; see styles/stonetop.css
// `.stonetop-location-body`). Paragraph-only bodies are left untouched.
function withSpiralBullets(html) {
	return /<[uo]l[\s>]/i.test(html) ? `<div class="stonetop-location-body">${html}</div>` : html;
}

// A prose section, or null when there's no body to show.
function proseSection(heading, bodyHtml) {
	return bodyHtml ? { kind: "prose", heading, group: SECTION_GROUP, body: withSpiralBullets(bodyHtml) } : null;
}

// Every heading a page CAN have, with the section it has now or null: the sections that exist,
// and the headings whose source is empty (`cleared`), which the merge takes off the page while
// what is there is still ours to take (see mergeChronicleSections).
const proseCandidate = (heading, bodyHtml) => [heading, proseSection(heading, bodyHtml)];
const qaCandidate    = (heading, pairs) => [heading, qaSection(heading, pairs)];
function sectionsAndCleared(candidates) {
	return {
		sections: candidates.map(([, section]) => section).filter(Boolean),
		cleared:  candidates.filter(([, section]) => !section).map(([heading]) => heading),
	};
}

// A Q&A section (prompt/answer pairs), or null when no pair has an answer.
//
// ⚠ PROJECTED DOWN TO THE TWO FIELDS A PAGE STORES, and deliberately. `introQaPairs` also carries
// `who` (which player character the writer said the answer is about, picked during the
// introductions), and that is a LINK rather than prose: the relationship map draws it, the journal
// page has no field for it (LocationPageModel's pairs are prompt + answer), and the section
// signature `mergeChronicleSections` dedupes on is built from the whole pair. Letting it ride
// through would change every stored section's shape to carry something nothing here can show.
//
// `pairKeys` rides beside the pairs, one per pair, and is never stored: it is the STABLE source key
// (`qaSourceKey`) mergeChronicleSections remembers each written pair by, so a pair the GM edited or
// deleted in the journal is never written again (see mergeChronicleSections).
function qaSection(heading, pairs) {
	return pairs.length
		? {
			kind: "qa", heading, group: SECTION_GROUP,
			pairs:    pairs.map(({ prompt, answer }) => ({ prompt, answer })),
			pairKeys: pairs.map(({ q, answer }) => qaSourceKey(q, answer)),
		}
		: null;
}

// Whitespace-normalised plain text, the form every Q&A hash and key is taken over.
const normText = value => String(value ?? "").replace(/\s+/g, " ").trim();

/**
 * The stable SOURCE key of one recorded answer: which question it answers (its stored index, or ""
 * when none was chosen) and a hash of the answer itself. Deliberately not the question's TEXT, so
 * a reworded question, or a playbook change that resolves the same index to other words, is the
 * same pair with a new prompt rather than a new pair.
 */
export function qaSourceKey(q, answer) {
	return `${Number.isInteger(q) ? q : ""}#${hashString(normText(answer))}`;
}

/** The hash of a Q&A pair's text as it stands, whitespace-normalised. */
export function qaPairHash(pair) {
	return hashString(JSON.stringify([normText(pair?.prompt), normText(pair?.answer)]));
}

// The question part of a source key: two keys with the same group answer the same question.
const keyGroup = key => String(key ?? "").split("#")[0];

/**
 * The form a prose body is hashed in: entities decoded, line breaks spelled one way, whitespace
 * collapsed. The journal's editor re-serialises what it saves (`&#x27;` comes back as `'`), and a
 * hash of the raw string would read that as a GM edit and freeze the section after one open-and-save.
 */
export function normaliseChronicleHtml(html) {
	return normaliseEditorText(html)
		.replace(/<br\s*\/?>/gi, "<br>")
		.replace(/>\s+</g, "><");
}

/** The change-detection hash a prose body is stamped with now. */
export function chronicleBodyHash(html) {
	return hashString(normaliseChronicleHtml(html));
}

// Is `stored` the hash of `html`? Accepts the normalised hash written now AND the raw hash pages
// were stamped with before, so a page seeded by an older version keeps syncing.
function bodyHashMatches(stored, html) {
	return stored === chronicleBodyHash(html) || stored === hashString(String(html ?? ""));
}

// Build the prompt/answer pairs for the answer/ask step, from a flat list of { q, a }
// records — the PC's new step4/step6 answer list (the player-driven flow can record up
// to four) plus the two legacy single-answer rounds (r4/r5 or r6/r7) folded in for
// back-compat. Each record's stored question index is resolved back to its authored
// text. Records with no answer are dropped; a record with an answer but no chosen
// question keeps a blank prompt. Callers dedupe on (prompt, answer) via
// mergeChronicleSections, so a legacy round later normalized into the step list never
// doubles. The question strings are trusted authored text (entities decoded); answers
// are user text (the page sheet escapes them on display).
function qaPairsFrom(entries, questions) {
	const seen  = new Set();
	const pairs = [];
	for (const { rec, at } of entries ?? []) {
		const answer = String(rec?.a ?? "").trim();
		if (!answer) continue;
		const qIdx   = Number.isInteger(rec?.q) ? rec.q : null;
		const prompt = qIdx != null ? decodeEntities(questions?.[qIdx] ?? "") : "";
		// Dedupe on the (prompt, answer) tuple — JSON-encoded like mergeChronicleSections
		// so neither field bleeds across the boundary — so a legacy round that overlaps a
		// step-list entry (or a doubly-recorded answer) folds to one pair on first compile.
		const key = JSON.stringify([prompt, answer]);
		if (seen.has(key)) continue;
		seen.add(key);
		pairs.push({ prompt, answer, who: whoOf(rec), at, q: qIdx });
	}
	return pairs;
}

// One step's records IN READING ORDER, each with the slot it is stored in: the step's own list
// first, then the legacy single-answer rounds behind it.
//
// ⚠ THE SLOT TRAVELS WITH THE ANSWER because something has to be able to WRITE one. "Match answers
// to people" (relmap/relmap-intro-match.js) sets `who` on an answer recorded before that pick
// existed, and an answer read out of here is otherwise unfindable again: the same prose can be a
// list entry, `r4`, or both, and the dedupe above deliberately hides which. Handing back where it
// came from is what stops the matcher from having to walk the blob a second way and disagree with
// this one about what counts as an answer.
/**
 * WHERE ONE STEP'S ANSWERS LIVE: its own list, plus the legacy single-answer rounds that fold in
 * behind it. The whole shape of the `introductionsAnswers` record, in one table.
 *
 * ⚠ EXPORTED FOR THE SAME REASON `introQaPairs` IS, and it is the half that is easy to re-spell:
 * a caller that only needs to know whether ANYTHING was written (the relationship map's matcher,
 * deciding whether to offer its button) has no use for the full read and would otherwise inline
 * `rec.r4, rec.r5, rec.r6, rec.r7` and be a second place to edit when the introductions grow a
 * round. That kind of miss is silent -- a button that stops appearing, or one that opens on nothing.
 */
export const INTRO_ANSWER_SLOTS = Object.freeze({
	step4: Object.freeze(["r4", "r5"]),
	step6: Object.freeze(["r6", "r7"]),
});

function answerEntries(step, source, legacy) {
	const entries = (Array.isArray(step?.answers) ? step.answers : [])
		.map((rec, index) => ({ rec, at: { source, index } }));
	for (const [legacySource, rec] of legacy) entries.push({ rec, at: { source: legacySource, index: null } });
	return entries;
}

// Which player character the writer said this answer is about: an actor id, chosen from the table
// while the answer was being recorded (IntroductionsDialog's "Who is this about?"). Null on every
// answer recorded before that picker existed, and on every answer about somebody outside the party,
// which is most of the "Bonds & ties" ones. The relationship map's party board reads it and falls
// back to looking for a name in the writing (relmap/relmap-intros.js); the Chronicle's own pages
// do not show it, so a blank one costs nothing.
//
// ⚠ NOT PART OF THE DEDUPE KEY ABOVE, on purpose. The step list comes first and the legacy r4/r5
// rounds fold in behind it, so a legacy round that duplicates a step entry has to collide with it
// on (prompt, answer) alone. Keying on `who` as well would let the pick's presence split the two
// apart and print the same answer twice.
const whoOf = rec => (typeof rec?.who === "string" && rec.who.trim() ? rec.who.trim() : null);

/**
 * What ONE player character answered during the introductions, as prompt/answer pairs per step.
 *
 * Each pair is `{ prompt, answer, who, at, q }`, where `who` is the player character the writer said
 * the answer is about (see `whoOf`) and is null far more often than not, `at` is the slot the
 * answer is stored in (see `answerEntries`), and `q` is the stored question index (or null). The
 * journal pages drop all three at `qaSection`, keeping only `q` inside the pair's source key; the
 * relationship map reads `who` and its matcher writes through `at`.
 *
 * ⚠ EXPORTED SO THAT NOTHING SPELLS THIS RULE TWICE. "What did they record" is four things at once,
 * and none of them is obvious: the player-driven flow keeps a LIST per step, the two legacy
 * single-answer rounds fold in behind it, a stored question is an INDEX that has to be resolved
 * back through that playbook's authored text, and the whole lot dedupes on (prompt, answer). The
 * Chronicle's pages are built from this, and so is the relationship map's party view
 * (relmap/relmap-intros.js) -- which draws a line for every answer that names another player
 * character. Two readings of one record is how the map comes to show a bond the Chronicle does not.
 *
 * @param {object} record  one PC's entry in the `introductionsAnswers` blob.
 * @param {string} slug    their playbook, which is what the question indexes are indexes INTO.
 */
export function introQaPairs(record, slug) {
	const a = record ?? {};
	const slots = step => INTRO_ANSWER_SLOTS[step].map(source => [source, a[source]]);
	return {
		step4: qaPairsFrom(answerEntries(a.step4, "step4", slots("step4")), step4Questions(slug) ?? []),
		step6: qaPairsFrom(answerEntries(a.step6, "step6", slots("step6")), step6Questions(slug) ?? []),
	};
}

// Render what a trip's Chart a Course presented — its requirements and its challenges — as a
// per-group bulleted list: the journey's shape, in the GM's own words. Returns "" for a trip
// that presented nothing.
//
// THE LIST IS THE RECORD, read through `chartPicked` so this and the walkthrough are looking
// at one thing (and so a trip logged under the older tick-and-fill pair prints the same here
// as it draws there — that adapter is where the legacy shape is dealt with, once).
//
// Each line is either an authored prompt named by key, whose wording lives in expedition-data
// as trusted HTML, or a sentence the GM wrote, which is escaped. What they said about it goes
// through the SAME resolver the walkthrough's own rows use, in the same order of preference:
// most of the authored requirements carry a literal blank ("at least ___ days", "watch out for
// ___"), and what was written is spliced into it, else what the plotted route works out, else
// the blank stands. Filling in one place and not the other would print a blank in the journal
// where the GM had read an answer.
//
// A line with no blank in it ("the way is perilous") has nowhere to splice, so what was said is
// printed after it instead. Same field either way: the record does not care which shape the step
// drew it in.
function chartedGroups(chart, route = null) {
	return chartedLines(chart, route)
		.map(group => {
			const lis = group.entries
				.map(({ line, said }) => `<li>${line}${said ? `: ${escHtml(said)}` : ""}</li>`)
				.join("");
			return `<p><strong>${escHtml(group.label)}</strong></p><ul>${lis}</ul>`;
		})
		.join("");
}

/**
 * The charted list resolved line by line, grouped as Chart a Course groups it: the one resolver
 * the Chronicle (chartedGroups, above) and the walkthrough's Running to-do both read.
 *
 * `line` is HTML: an authored prompt with the answer spliced into its blank, or the GM's own
 * sentence escaped (the only user-authored string in this list). `said` is plain text, what was
 * said after a line with no blank to splice it into, and "" otherwise.
 *
 * @returns {Array<{label: string, entries: Array<{id: string, line: string, said: string, done: boolean}>}>}
 *   only the groups with something in them
 */
export function chartedLines(chart, route = null) {
	const picked = chartPicked(chart);
	return CHART_GROUPS
		.map(group => ({
			label:   group.label,
			entries: picked.filter(e => e.group === group.key).map(entry => {
				const text = chartEntryText(entry);
				const said = String(entry.answer ?? "").trim();
				return {
					id:   entry.id,
					line: entry.key ? fillChartBlank(text, entry.key, route, said) : escHtml(text),
					said: (entry.key && hasFillBlank(text)) ? "" : said,
					done: !!entry.done,
				};
			}),
		}))
		.filter(group => group.entries.length);
}

// "Stonetop to Marshedge to Lygos: at least 40 days", then a line per leg.
function journeyProse(route) {
	if (!route) return "";
	const legs = routeLegLines(route).map(line => `<li>${escHtml(line)}</li>`).join("");
	return `<p><strong>${escHtml(routeLine(route))}</strong>: `
		+ `${escHtml(routePhrase(route))}.</p><ul>${legs}</ul>`;
}

// The GM's own words about the route — with OUR words dropped back out.
//
// Picking a destination seeds the empty "Destination & route" field with the plotted route line,
// so the walkthrough's Chart a Course step shows an answer rather than a blank. That line is
// exactly what `journeyProse` above already leads with, so printing the field verbatim underneath
// it said the same sentence twice, once bold and once not. A GM who typed their own words (or
// added to ours) keeps every one of them: only text that still matches the generated line is
// recognised as ours to drop.
function journeyNote(chart, route) {
	const written = String(chart?.route ?? "").trim();
	if (route && written === routeLine(route)) return "";
	return paragraphs(chart?.route);
}

// What the trip took out of the steading's common stores, as ticked on the Requisition
// step. The whole of the section now, and above whatever a GM typed back when the step
// carried a note box: this list, and the "out on <trip>" tag the steading sheet wears
// while they are gone, are the two halves of the answer to "where did the wagon go?".
function requisitionedList(taken) {
	const names = (taken ?? [])
		.map(t => String(t?.name ?? "").trim())
		.filter(Boolean);
	if (!names.length) return "";
	const lis = names.map(n => `<li>${escHtml(n)}</li>`).join("");
	return `<p><strong>Taken from the steading</strong></p><ul>${lis}</ul>`;
}

// Compile one logged expedition into a Chronicle page, or null when it holds nothing
// worth recording. The arriving-home list is GM prep — questions, not answers — and has
// never been printed here; what came of Returning Triumphant is written on the steading.
function buildExpeditionPage(exp, index, { withEmpty = false } = {}) {
	const chart = exp?.chart ?? {};
	const home  = exp?.home ?? {};
	// The plotted route joins the section it belongs to rather than opening a new heading:
	// mergeChronicleSections matches on heading, so a brand-new one would churn every page that
	// already exists. It leads, because it is the answer the GM's own prose then elaborates on.
	const route = journeyRoute(exp?.journey);
	const { sections, cleared } = sectionsAndCleared([
		proseCandidate("Destination & route", journeyProse(route) + journeyNote(chart, route)),
		proseCandidate("The way ahead", chartedGroups(chart, route) + paragraphs(chart.notes)),
		// LEGACY on the same terms as "Other preparations" below. The Outfit step's note box is
		// gone — the live party-load readout there answers "who's carrying what" off the sheets
		// themselves — so nothing writes `exp.outfit` any more. Trips logged while the box existed
		// still carry what a GM typed, and it goes on printing under the heading it was written
		// for. A trip logged since simply has no such heading.
		proseCandidate("Outfit & supplies", paragraphs(exp?.outfit)),
		// The ticked list is what fills this heading now: the Requisition step's note box is gone,
		// so `exp.requisition` is LEGACY in the same way `exp.outfit` above is, still printed
		// under the list for the trips that were logged with it.
		proseCandidate("Requisitioned", requisitionedList(exp?.requisitioned) + paragraphs(exp?.requisition)),
		// Written by the note under "Other preparations" at the foot of the Requisition step
		// (ExpeditionDialog's _STEPS), the same `prep` field it had when it was a step of its own,
		// so trips logged either side of that change print under the one heading. `proseSection`
		// returns nothing for empty prose and the list is filtered, so a trip with no note simply
		// has no such heading.
		proseCandidate("Other preparations", paragraphs(exp?.prep)),
		proseCandidate("The journey", paragraphs(exp?.running)),
		// LEGACY, like the three above. The arriving-home step's "Return Triumphant?" box is
		// gone — that step offers the MOVE now, and making it clears a steading debility (or
		// raises Fortunes), which the steading's own ledger records attributed to the move. So
		// nothing writes `home.notes` any more; trips logged with the box keep printing theirs.
		proseCandidate("Coming home", paragraphs(home.notes)),
	]);
	if (!sections.length && !withEmpty) return null;

	const title = String(exp?.title ?? "").trim();
	const name  = title ? `Expedition: ${title}` : expeditionLabel(exp, index);
	return { key: `${EXPEDITION_PAGE_KEY_PREFIX}${exp.id}`, name, sections, cleared };
}

/** A copy of a stored section, its Q&A pairs copied too, so changing the copy leaves the record alone. */
export const cloneChronicleSection = s => ({ ...s, ...(s?.pairs ? { pairs: [...s.pairs] } : {}) });

/**
 * Merge freshly-compiled sections into a page's existing sections, folding in content
 * recorded since the page was first seeded while never clobbering a hand edit. THE JOURNAL
 * EDIT WINS: whatever we wrote once and the GM then changed or removed in the journal stays
 * as the GM left it.
 *
 *   • PROSE is refreshed to the latest source text ONLY while it is still pristine: its stored
 *     body hashes to what we last wrote (tracked per heading in `proseManaged`). This is what
 *     lets a player's introduction fill the Chronicle in LIVE as they type. Once the GM edits
 *     it the hash stops matching and the section freezes. A legacy section with no tracked
 *     hash is adopted only when its body already equals the source (or under `adoptLegacy`,
 *     below). A still-pristine section whose source was CLEARED (its heading is in `cleared`)
 *     is removed; an edited one stays.
 *   • Q&A pairs are remembered one by one in `qaManaged` (per heading: the pair's stable source
 *     key, see `qaSourceKey`, mapped to the hash of the text we wrote). A pair written once is
 *     never added again. While its journal copy is unchanged it follows the source: a reworded
 *     question or an answer corrected in the Introductions dialog is rewritten in place, and an
 *     answer deleted there is removed. Once the GM edits or deletes the journal copy, it is
 *     theirs and left alone. A legacy section (no record yet) is seeded by matching each source
 *     pair to an existing pair with the same answer, so a world whose questions were reworded
 *     does not gain a second copy of every answer; existing pairs nothing matches are the GM's.
 *     A copy that still wears a wording of its question an earlier release SHIPPED
 *     (`SUPERSEDED_INTRO_QUESTIONS`) is ours, legacy or tracked, and is brought up to the current
 *     wording; any other wording is a GM edit and stands.
 *   • A SECTION the GM deleted (its heading was written before but is gone from the page) is not
 *     recreated, unless a Q&A section gains a pair never written before; then it comes back with
 *     only the new pairs.
 *   • A section whose heading is new is appended.
 *
 * `adoptLegacy` loosens the legacy prose rule for a page being AUTHORED right now (the PC
 * whose introduction is actively being typed in a live intro session): an UNTRACKED prose
 * section is treated as ours and refreshed to the live text, then stamped so it tracks from
 * then on. It only ever touches UNTRACKED sections: a tracked-and-edited one stays frozen.
 *
 * @param {Array<object>} existing   the page's current sections (plain data)
 * @param {Array<object>} computed   freshly-compiled sections from the recorded source
 * @param {object}  [opts]
 * @param {object}  [opts.proseManaged]  per-heading hash of the prose body we last wrote
 * @param {object}  [opts.qaManaged]     per-heading { sourceKey: pairHash } of the pairs we wrote
 * @param {string[]} [opts.cleared]      headings the source knows but has nothing for now
 * @param {boolean} [opts.adoptLegacy]   refresh an untracked prose section from the source
 * @returns {{ sections: Array<object>, added: number, kept: number, proseManaged: object, qaManaged: object }}
 *   the merged section list; `added`, the number of visible changes (0 when nothing changed);
 *   `kept`, how many sections hold a GM edit the newer source would otherwise have changed; and
 *   the updated records to store back.
 */
export function mergeChronicleSections(existing = [], computed = [], {
	proseManaged = {}, qaManaged = {}, cleared = [], adoptLegacy = false,
} = {}) {
	// Copy so the caller's stored array (and each Q&A section's pairs) isn't mutated.
	let merged        = (existing ?? []).map(cloneChronicleSection);
	const byHeading   = new Map(merged.map(s => [s.heading, s]));
	const nextProse   = { ...(proseManaged ?? {}) };
	const nextQa      = Object.fromEntries(Object.entries(qaManaged ?? {}).map(([h, rec]) => [h, { ...rec }]));
	const dropped     = new Set();
	let added = 0;
	let kept  = 0;

	for (const section of computed ?? []) {
		const heading = section.heading;
		const match   = byHeading.get(heading);

		if (section.kind === "qa" && (!match || match.kind === "qa")) {
			const result = mergeQaPairs(match ? match.pairs ?? [] : null, sourcePairs(section), qaManaged?.[heading]);
			nextQa[heading] = result.managed;
			added += result.changes;
			if (result.kept) kept += 1;
			if (match) {
				match.pairs = result.pairs;
				// Emptied by our own removals: the heading goes too, and comes back with a new answer.
				if (!result.pairs.length && result.removed) dropped.add(match);
			} else if (result.pairs.length) {
				const fresh = storedSection(section, result.pairs);
				merged.push(fresh);
				byHeading.set(heading, fresh);
			}
			continue;
		}

		if (!match) {
			// Written before and gone now: the GM deleted it, and it stays deleted.
			if (section.kind === "prose" && nextProse[heading] !== undefined) {
				kept += 1;
				continue;
			}
			const fresh = storedSection(section);
			merged.push(fresh);
			byHeading.set(heading, fresh);
			if (section.kind === "prose") nextProse[heading] = chronicleBodyHash(section.body ?? "");
			added += 1;
			continue;
		}

		// Same-heading prose: refresh from the source while the stored body is still the
		// one we last wrote (pristine); freeze once it's been edited in the journal.
		if (match.kind === "prose" && section.kind === "prose") {
			const prev    = proseManaged?.[heading];
			const same    = normaliseChronicleHtml(match.body) === normaliseChronicleHtml(section.body);
			// Tracked (prev set): ours only if the stored body still matches our last write.
			// Untracked (legacy page): ours if it already equals the source, OR (for the
			// actively-authored page) if adoptLegacy lets the live text take it over.
			const isOurs  = prev !== undefined ? bodyHashMatches(prev, match.body) : (adoptLegacy || same);
			if (isOurs) {
				if (!same) { match.body = section.body; added += 1; }
				nextProse[heading] = chronicleBodyHash(match.body);
			} else if (!same) {
				// Hand-edited: leave the body, and keep `prev` (if any) as the tracked hash so a
				// later revert to our exact text resumes syncing.
				kept += 1;
			}
		}
	}

	// A heading the source has nothing for any more: take away what is still exactly ours.
	for (const heading of cleared ?? []) {
		const match = byHeading.get(heading);
		if (!match || dropped.has(match)) continue;
		if (match.kind === "prose") {
			const prev = proseManaged?.[heading];
			if (prev !== undefined && bodyHashMatches(prev, match.body)) {
				dropped.add(match);
				delete nextProse[heading];
				added += 1;
			}
		} else if (match.kind === "qa" && qaManaged?.[heading]) {
			const result = mergeQaPairs(match.pairs ?? [], [], qaManaged[heading]);
			nextQa[heading] = result.managed;
			added += result.changes;
			match.pairs = result.pairs;
			if (!result.pairs.length && result.removed) dropped.add(match);
		}
	}

	if (dropped.size) merged = merged.filter(s => !dropped.has(s));
	return { sections: merged, added, kept, proseManaged: nextProse, qaManaged: nextQa };
}

// A compiled section as a page stores it: the source keys that ride beside a Q&A section's
// pairs are the merge's business, not the page's.
function storedSection(section, pairs = null) {
	const { pairKeys: _keys, ...rest } = section;
	if (rest.kind === "qa") rest.pairs = (pairs ?? rest.pairs ?? []).map(p => ({ prompt: p.prompt ?? "", answer: p.answer ?? "" }));
	return rest;
}

// A compiled Q&A section's pairs, each with its source key. A section built without keys (a
// test, a repair) falls back to a key made of its own text.
function sourcePairs(section) {
	const keys = Array.isArray(section?.pairKeys) ? section.pairKeys : [];
	return (section?.pairs ?? []).map((p, i) => {
		const pair = { prompt: p?.prompt ?? "", answer: p?.answer ?? "" };
		return { key: keys[i] ?? `=${qaPairHash(pair)}`, pair, hash: qaPairHash(pair) };
	});
}

/**
 * One heading's Q&A pairs, merged by the rules in mergeChronicleSections' header.
 *
 * @param {Array<object>|null} current  the journal's pairs, or null when the section is absent
 * @param {Array<{key, pair, hash}>} source  the compiled pairs with their source keys
 * @param {object|undefined} record  { sourceKey: hash written } for this heading; undefined = legacy
 * @returns {{pairs: Array<object>, managed: object, changes: number, removed: number, kept: boolean}}
 */
function mergeQaPairs(current, source, record) {
	const pairs   = [...(current ?? [])];
	const managed = { ...(record ?? {}) };
	const claimed = new Set();
	let changes = 0;
	let kept    = false;
	const claim = hash => {
		const i = pairs.findIndex((p, j) => !claimed.has(j) && qaPairHash(p) === hash);
		if (i >= 0) claimed.add(i);
		return i;
	};
	// The journal copy of `s` written before its question was reworded: the same answer under a
	// wording an earlier release shipped. A GM's own rewording matches none of them.
	const claimOldWording = s => {
		for (const old of SUPERSEDED_INTRO_QUESTIONS[normText(s.pair.prompt)] ?? []) {
			const i = claim(qaPairHash({ prompt: old, answer: s.pair.answer }));
			if (i >= 0) return i;
		}
		return -1;
	};
	const takeOver = (i, s) => { pairs[i] = s.pair; managed[s.key] = s.hash; changes += 1; };

	// LEGACY: no record yet. Whatever already stands for a source pair (the same text, else the
	// same answer under other wording) is taken as written; only the rest is added.
	if (record === undefined) {
		const unmatched = [];
		for (const s of source) {
			if (claim(s.hash) >= 0) managed[s.key] = s.hash;
			else unmatched.push(s);
		}
		for (const s of unmatched) {
			const old = claimOldWording(s);
			if (old >= 0) { takeOver(old, s); continue; }
			const answer = normText(s.pair.answer);
			const i = pairs.findIndex((p, j) => !claimed.has(j) && normText(p.answer) === answer);
			if (i >= 0) {
				// Recorded as written with the SOURCE text, which this copy does not match: a GM's
				// edit (a shipped older wording was taken over above). It stands, and is never
				// written twice.
				claimed.add(i);
				managed[s.key] = s.hash;
				continue;
			}
			pairs.push(s.pair);
			managed[s.key] = s.hash;
			changes += 1;
		}
		return { pairs, managed, changes, removed: 0, kept };
	}

	const sourceKeys = new Set(source.map(s => s.key));
	const unwritten  = [];
	// Written before: follow the source while the journal copy is still what we wrote.
	for (const s of source) {
		if (!(s.key in managed)) { unwritten.push(s); continue; }
		const wrote = managed[s.key];
		const i = claim(wrote);
		if (i < 0) {
			// Still in a shipped older wording of its question: ours, so it follows the source.
			const old = claimOldWording(s);
			if (old >= 0) { takeOver(old, s); continue; }
			// The GM edited or deleted it. Theirs now.
			if (s.hash !== wrote) kept = true;
			continue;
		}
		if (s.hash !== wrote) takeOver(i, s);
	}
	// Written before and gone from the source (an answer deleted or corrected in the dialog).
	const vanished = [];
	for (const [key, wrote] of Object.entries(managed)) {
		if (sourceKeys.has(key)) continue;
		const i = claim(wrote);
		// No unchanged copy: the GM changed it. The record stays, so it is never written again.
		if (i >= 0) vanished.push({ key, index: i, used: false });
	}
	// New answers: a corrected answer takes its old pair's place, so the page keeps its order.
	for (const s of unwritten) {
		const old = vanished.find(v => !v.used && keyGroup(v.key) === keyGroup(s.key));
		if (old) {
			old.used = true;
			pairs[old.index] = s.pair;
			delete managed[old.key];
		} else {
			pairs.push(s.pair);
		}
		managed[s.key] = s.hash;
		changes += 1;
	}
	const gone = new Set();
	for (const v of vanished) {
		if (v.used) continue;
		gone.add(v.index);
		delete managed[v.key];
	}
	changes += gone.size;
	return { pairs: pairs.filter((_, i) => !gone.has(i)), managed, changes, removed: gone.size, kept };
}

/**
 * Build the Chronicle's pages from the recorded answers.
 *
 * @param {object}  opts
 * @param {Array<{id,name,playbookName,slug}>} opts.pcs  Player characters, in display order.
 * @param {object}  opts.introAnswers   `introductionsAnswers` blob, keyed by actor id.
 *   Per PC: r1–r3 narration strings; the player-driven answer/ask steps as
 *   step4/step6 `{ answers: [{q,a}], passed }`; and legacy single-answer r4–r7 `{q,a}`
 *   (folded into the step lists on compile for back-compat).
 * @param {object}  opts.springAnswers  `springBurstAnswers` blob ({ gains, hook, excites }).
 * @param {Array<object>} opts.expeditions  The expedition log (`expeditionAnswers.list`),
 *   oldest first; each trip with content becomes its own page.
 * @param {boolean} [opts.withEmpty]  Also return the pages that have nothing recorded now (with no
 *   sections), so a save can take cleared text off a page that already exists. Off by default.
 * @returns {Array<{key,name,sections,cleared}>}  One page per PC with recorded content, then a
 *   party "Let Spring Burst Forth" page when there's Spring Burst content, then one
 *   page per logged expedition. Empty when nothing has been recorded. `cleared` names the
 *   headings whose source is empty now.
 */
export function buildChroniclePages({ pcs = [], introAnswers = {}, springAnswers = {}, expeditions = [], withEmpty = false } = {}) {
	const pages   = [];
	const excites = springAnswers?.excites ?? {};

	for (const pc of pcs) {
		const a     = introAnswers?.[pc.id] ?? {};
		// The player-driven flow records a LIST per step, the legacy single-answer rounds fold in
		// behind it, and a stored question index is resolved back to its authored text. All of that
		// is `introQaPairs`, which the relationship map reads through as well so the two surfaces
		// cannot come to disagree about what somebody recorded.
		const said = introQaPairs(a, pc.slug);

		const { sections, cleared } = sectionsAndCleared([
			proseCandidate("Introduction", paragraphs(a.r1)),
			proseCandidate("Possessions & contribution", paragraphs(a.r2)),
			proseCandidate("Their place in Stonetop", paragraphs(a.r3)),
			qaCandidate("Bonds & ties", said.step4),
			qaCandidate("Asked of the others", said.step6),
			proseCandidate("What excites their player", paragraphs(excites[pc.id])),
		]);

		// Skip PCs with nothing recorded yet: a page appears once they have content.
		if (!sections.length && !withEmpty) continue;

		const name = pc.playbookName ? `${pc.name} — ${pc.playbookName}` : pc.name;
		pages.push({ key: pc.id, name, sections, cleared });
	}

	// Party-level Spring Burst page (the per-PC "what excites you" already folded
	// into each page above). The omen section names the ticked seasonal gain(s),
	// then the hook prose the GM noted. (Who's "most hopeful" is a table decision the
	// walkthrough no longer records, so there's no section for it.)
	const omenGains = SEASONAL_GAINS.filter(g => springAnswers?.gains?.[g.key]).map(g => g.name);
	const omenBody  =
		(omenGains.length ? `<p><strong>${omenGains.length > 1 ? "Gains" : "Gain"} chosen:</strong> ${omenGains.join(", ")}</p>` : "")
		+ paragraphs(springAnswers?.hook);
	const spring = sectionsAndCleared([
		proseCandidate("The season's omen", omenBody),
	]);
	if (spring.sections.length || withEmpty) pages.push({ key: SPRING_PAGE_KEY, name: SPRING_PAGE_NAME, ...spring });

	// One page per logged expedition, oldest first (a growing campaign log).
	(expeditions ?? []).forEach((exp, i) => {
		const page = buildExpeditionPage(exp, i, { withEmpty });
		if (page) pages.push(page);
	});

	return pages;
}
