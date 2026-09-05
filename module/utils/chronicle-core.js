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

import { escHtml, decodeEntities } from "./strings.js";
import { step4Questions, step6Questions } from "../dialogs/introductions-data.js";
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

// A Q&A section (prompt/answer pairs), or null when no pair has an answer.
//
// ⚠ PROJECTED DOWN TO THE TWO FIELDS A PAGE STORES, and deliberately. `introQaPairs` also carries
// `who` (which player character the writer said the answer is about, picked during the
// introductions), and that is a LINK rather than prose: the relationship map draws it, the journal
// page has no field for it (LocationPageModel's pairs are prompt + answer), and the section
// signature `mergeChronicleSections` dedupes on is built from the whole pair. Letting it ride
// through would change every stored section's shape to carry something nothing here can show.
function qaSection(heading, pairs) {
	return pairs.length
		? { kind: "qa", heading, group: SECTION_GROUP, pairs: pairs.map(({ prompt, answer }) => ({ prompt, answer })) }
		: null;
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
		pairs.push({ prompt, answer, who: whoOf(rec), at });
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
 * Each pair is `{ prompt, answer, who, at }`, where `who` is the player character the writer said
 * the answer is about (see `whoOf`) and is null far more often than not, and `at` is the slot the
 * answer is stored in (see `answerEntries`). The journal pages drop both at `qaSection`; the
 * relationship map reads the first and its matcher writes through the second.
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
	const picked = chartPicked(chart);
	return CHART_GROUPS
		.map(group => {
			const mine = picked.filter(e => e.group === group.key);
			if (!mine.length) return "";
			const lis = mine.map(entry => {
				const text = chartEntryText(entry);
				const said = String(entry.answer ?? "").trim();
				// An authored line is the book's words; one the GM wrote is theirs, and is the
				// only user-authored string in this list.
				const line = entry.key
					? fillChartBlank(text, entry.key, route, said)
					: escHtml(text);
				const after = (entry.key && hasFillBlank(text)) ? "" : said;
				return `<li>${line}${after ? `: ${escHtml(after)}` : ""}</li>`;
			}).join("");
			return `<p><strong>${escHtml(group.label)}</strong></p><ul>${lis}</ul>`;
		})
		.filter(Boolean)
		.join("");
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
function buildExpeditionPage(exp, index) {
	const chart = exp?.chart ?? {};
	const home  = exp?.home ?? {};
	// The plotted route joins the section it belongs to rather than opening a new heading:
	// mergeChronicleSections matches on heading, so a brand-new one would churn every page that
	// already exists. It leads, because it is the answer the GM's own prose then elaborates on.
	const route = journeyRoute(exp?.journey);
	const sections = [
		proseSection("Destination & route", journeyProse(route) + journeyNote(chart, route)),
		proseSection("The way ahead", chartedGroups(chart, route) + paragraphs(chart.notes)),
		// LEGACY on the same terms as "Other preparations" below. The Outfit step's note box is
		// gone — the live party-load readout there answers "who's carrying what" off the sheets
		// themselves — so nothing writes `exp.outfit` any more. Trips logged while the box existed
		// still carry what a GM typed, and it goes on printing under the heading it was written
		// for. A trip logged since simply has no such heading.
		proseSection("Outfit & supplies", paragraphs(exp?.outfit)),
		// The ticked list is what fills this heading now: the Requisition step's note box is gone,
		// so `exp.requisition` is LEGACY in the same way `exp.outfit` above is, still printed
		// under the list for the trips that were logged with it.
		proseSection("Requisitioned", requisitionedList(exp?.requisitioned) + paragraphs(exp?.requisition)),
		// LEGACY, and kept deliberately. "Other preparations" is no longer a step of the
		// walkthrough (ExpeditionDialog's _STEPS), so nothing writes `exp.prep` any more — but
		// trips logged while it was a step still carry what a GM typed there, and dropping this
		// line would silently un-print it from every Chronicle page that already holds it.
		// `proseSection` returns nothing for empty prose and the list is filtered, so a trip
		// logged since the step went away simply has no such heading.
		proseSection("Other preparations", paragraphs(exp?.prep)),
		proseSection("The journey", paragraphs(exp?.running)),
		// LEGACY, like the three above. The arriving-home step's "Return Triumphant?" box is
		// gone — that step offers the MOVE now, and making it clears a steading debility (or
		// raises Fortunes), which the steading's own ledger records attributed to the move. So
		// nothing writes `home.notes` any more; trips logged with the box keep printing theirs.
		proseSection("Coming home", paragraphs(home.notes)),
	].filter(Boolean);
	if (!sections.length) return null;

	const title = String(exp?.title ?? "").trim();
	const name  = title ? `Expedition: ${title}` : expeditionLabel(exp, index);
	return { key: `${EXPEDITION_PAGE_KEY_PREFIX}${exp.id}`, name, sections };
}

/**
 * Merge freshly-compiled sections into a page's existing sections, folding in content
 * recorded since the page was first seeded while never clobbering a hand edit:
 *   • a section whose heading is new is appended;
 *   • a matching Q&A section gains any answer pairs it doesn't already have (matched on
 *     prompt+answer), so a question answered in a later round still lands;
 *   • a matching PROSE section is refreshed to the latest source text ONLY while it is
 *     still pristine — its stored body hashes to what we last wrote (tracked per heading
 *     in `proseManaged`). This is what lets a player's introduction fill the Chronicle in
 *     LIVE as they type: each background sync overwrites the previous auto-written prose.
 *     Once the GM edits that section in the journal its hash stops matching, so we leave
 *     it alone from then on and the edit sticks. A legacy page with no tracked hash is
 *     adopted (and thereafter kept in sync) only when its body already equals the freshly
 *     computed one — clearly still ours; otherwise it's assumed edited and frozen.
 *
 * `adoptLegacy` loosens that last rule for a page being AUTHORED right now (the PC whose
 * introduction is actively being typed in a live intro session): an UNTRACKED prose
 * section (no per-heading hash — the page predates hash tracking) is treated as ours and
 * refreshed to the live text, then stamped so it tracks from then on. Without this, a
 * page seeded before hash tracking existed would stay frozen forever, so re-running the
 * introductions for a reused character would never update its page. It only ever touches
 * UNTRACKED sections — a section already tracked-and-edited (hash present but not matching)
 * stays frozen even under adoptLegacy, so a genuine journal edit is never clobbered.
 *
 * @param {Array<object>} existing   the page's current sections (plain data)
 * @param {Array<object>} computed   freshly-compiled sections from the recorded source
 * @param {object}  [opts]
 * @param {object}  [opts.proseManaged]  per-heading hash of the prose body we last wrote
 * @param {boolean} [opts.adoptLegacy]   refresh an untracked prose section from the source
 *   (the actively-authored page in a live intro session); default false = conservative freeze
 * @returns {{ sections: Array<object>, added: number, proseManaged: object }}  the merged
 *   section list, the number of changes (new sections + new pairs + refreshed prose; 0
 *   when nothing changed), and the updated per-heading prose hashes to store back.
 */
export function mergeChronicleSections(existing = [], computed = [], { proseManaged = {}, adoptLegacy = false } = {}) {
	// Copy so the caller's stored array (and each Q&A section's pairs) isn't mutated.
	const merged      = (existing ?? []).map(s => ({ ...s, ...(s?.pairs ? { pairs: [...s.pairs] } : {}) }));
	const byHeading   = new Map(merged.map(s => [s.heading, s]));
	const nextManaged = { ...proseManaged };
	let added = 0;
	for (const section of computed ?? []) {
		const match = byHeading.get(section.heading);
		if (!match) {
			merged.push(section);
			byHeading.set(section.heading, section);
			if (section.kind === "prose") nextManaged[section.heading] = hashString(section.body ?? "");
			added += 1;
			continue;
		}
		// Same-heading Q&A: append pairs we don't already have, so a question answered in
		// a later round still lands. Dedupe on the (prompt, answer) tuple — JSON-encoded
		// so neither field can bleed across the boundary and cause a false match.
		if (match.kind === "qa" && section.kind === "qa") {
			match.pairs ??= [];
			const pairKey = p => JSON.stringify([p.prompt ?? "", p.answer ?? ""]);
			const have = new Set(match.pairs.map(pairKey));
			for (const pair of section.pairs ?? []) {
				const sig = pairKey(pair);
				if (!have.has(sig)) { match.pairs.push(pair); have.add(sig); added += 1; }
			}
			continue;
		}
		// Same-heading prose: refresh from the source while the stored body is still the
		// one we last wrote (pristine); freeze once it's been edited in the journal.
		if (match.kind === "prose" && section.kind === "prose") {
			const prev    = proseManaged[section.heading];
			const curHash  = hashString(match.body ?? "");
			const newHash  = hashString(section.body ?? "");
			// Tracked (prev set): ours only if the stored body still matches our last write.
			// Untracked (legacy page): ours if it already equals the source, OR — for the
			// actively-authored page — if adoptLegacy lets the live text take it over.
			const isOurs   = prev !== undefined ? curHash === prev : (adoptLegacy || curHash === newHash);
			if (isOurs) {
				if (curHash !== newHash) { match.body = section.body; added += 1; }
				nextManaged[section.heading] = newHash;
			}
			// else: hand-edited — leave the body, and keep `prev` (if any) as the tracked
			// hash so a later revert to our exact text resumes syncing.
		}
	}
	return { sections: merged, added, proseManaged: nextManaged };
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
 * @returns {Array<{key,name,sections}>}  One page per PC with recorded content, then a
 *   party "Let Spring Burst Forth" page when there's Spring Burst content, then one
 *   page per logged expedition. Empty when nothing has been recorded.
 */
export function buildChroniclePages({ pcs = [], introAnswers = {}, springAnswers = {}, expeditions = [] } = {}) {
	const pages   = [];
	const excites = springAnswers?.excites ?? {};

	for (const pc of pcs) {
		const a     = introAnswers?.[pc.id] ?? {};
		// The player-driven flow records a LIST per step, the legacy single-answer rounds fold in
		// behind it, and a stored question index is resolved back to its authored text. All of that
		// is `introQaPairs`, which the relationship map reads through as well so the two surfaces
		// cannot come to disagree about what somebody recorded.
		const said = introQaPairs(a, pc.slug);

		const sections = [
			proseSection("Introduction", paragraphs(a.r1)),
			proseSection("Possessions & contribution", paragraphs(a.r2)),
			proseSection("Their place in Stonetop", paragraphs(a.r3)),
			qaSection("Bonds & ties", said.step4),
			qaSection("Asked of the others", said.step6),
			proseSection("What excites their player", paragraphs(excites[pc.id])),
		].filter(Boolean);

		// Skip PCs with nothing recorded yet — a page appears once they have content.
		if (!sections.length) continue;

		const name = pc.playbookName ? `${pc.name} — ${pc.playbookName}` : pc.name;
		pages.push({ key: pc.id, name, sections });
	}

	// Party-level Spring Burst page (the per-PC "what excites you" already folded
	// into each page above). The omen section names the ticked seasonal gain(s),
	// then the hook prose the GM noted. (Who's "most hopeful" is a table decision the
	// walkthrough no longer records, so there's no section for it.)
	const omenGains = SEASONAL_GAINS.filter(g => springAnswers?.gains?.[g.key]).map(g => g.name);
	const omenBody  =
		(omenGains.length ? `<p><strong>${omenGains.length > 1 ? "Gains" : "Gain"} chosen:</strong> ${omenGains.join(", ")}</p>` : "")
		+ paragraphs(springAnswers?.hook);
	const spring = [
		proseSection("The season's omen", omenBody),
	].filter(Boolean);
	if (spring.length) pages.push({ key: SPRING_PAGE_KEY, name: SPRING_PAGE_NAME, sections: spring });

	// One page per logged expedition, oldest first (a growing campaign log).
	(expeditions ?? []).forEach((exp, i) => {
		const page = buildExpeditionPage(exp, i);
		if (page) pages.push(page);
	});

	return pages;
}
